// OTP generation, delivery and brute-force throttling.
//
// Delivery: real providers (Resend for email, Twilio WhatsApp API for
// WhatsApp) are used whenever their env vars are configured; otherwise this
// falls back to logging the code server-side only (never returned to the
// HTTP caller — see security review, item 1) so local development keeps
// working without real provider accounts. See server/.env.example for
// exactly which env vars each provider needs.
//
// Throttling: two independent counters, both stored on the user row since
// every OTP flow (signup, resend, forgot-password, profile phone/email
// change) already shares the same otp_code/otp_expires_at columns:
//   - verify attempts against the CURRENT code (otp_attempt_count) — 5
//     wrong tries locks verification for 15 minutes, regardless of flow.
//   - how many codes an account can have issued within a 1-hour sliding
//     window (otp_send_count/otp_window_started_at) — capped at 5, which
//     also bounds total guesses/hour even if an attacker resets their
//     attempt counter by requesting a fresh code (5 sends/hour × 5
//     attempts/code = 25 guesses/hour at most, down from unlimited).

const { pool } = require('../db');

const OTP_TTL_MINUTES = 10;
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const OTP_VERIFY_LOCK_MINUTES = 15;
const OTP_SEND_MAX_PER_WINDOW = 5;
const OTP_SEND_WINDOW_MINUTES = 60;
// Matches public/app.js's startOtpResendCountdown() (45s) — the server-side
// floor that's actually enforced; the client countdown is just UX, never trusted.
const OTP_RESEND_COOLDOWN_SECONDS = 45;

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function otpExpiry() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

function envTrim(name) {
  const v = process.env[name];
  if (v == null) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

// ---------- real delivery providers ----------

async function sendEmailViaResend({ to, code }) {
  const apiKey = envTrim('RESEND_API_KEY');
  const from = envTrim('OTP_FROM_EMAIL');
  if (!apiKey || !from) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `كود التحقق: ${code} — تشليح الخليج`,
      html: `<div dir="rtl" style="font-family:sans-serif;font-size:16px;">
        <p>كود التحقق الخاص بك في تشليح الخليج هو:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p>
        <p>صالح لمدة ${OTP_TTL_MINUTES} دقائق. إذا لم تطلب هذا الكود، تجاهل هذه الرسالة.</p>
      </div>`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${body.slice(0, 300)}`);
  }
  return true;
}

async function sendWhatsAppViaTwilio({ to, code }) {
  const sid = envTrim('TWILIO_ACCOUNT_SID');
  const token = envTrim('TWILIO_AUTH_TOKEN');
  const from = envTrim('TWILIO_WHATSAPP_FROM');
  if (!sid || !token || !from) return false;

  const body = new URLSearchParams({
    From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
    To: `whatsapp:${to}`,
    Body: `كود التحقق الخاص بك في تشليح الخليج هو: ${code}\nصالح لمدة ${OTP_TTL_MINUTES} دقائق.`,
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Twilio API error (${res.status}): ${errBody.slice(0, 300)}`);
  }
  return true;
}

// Sends the code for real when the relevant provider is configured; always
// also logs server-side (never returned to the HTTP caller) so a developer
// with server/log access can read it during local testing either way.
async function sendOtp({ channel, destination, code }) {
  // eslint-disable-next-line no-console
  console.log(`[OTP] channel=${channel} to=${destination} code=${code}`);
  try {
    if (channel === 'email') {
      const sent = await sendEmailViaResend({ to: destination, code });
      if (!sent) console.log('[OTP] RESEND_API_KEY/OTP_FROM_EMAIL not configured — email not actually sent, code logged above only.');
    } else if (channel === 'whatsapp') {
      const sent = await sendWhatsAppViaTwilio({ to: destination, code });
      if (!sent) console.log('[OTP] TWILIO_* env vars not configured — WhatsApp message not actually sent, code logged above only.');
    }
  } catch (err) {
    // Delivery failure never blocks the flow (the code is still valid and
    // logged above) — but it's surfaced loudly server-side since a user who
    // never receives their code otherwise looks like a silent, confusing bug.
    console.error(`[OTP] delivery via ${channel} failed:`, err.message || err);
  }
}

// Back-compat alias — some callers historically named this sendOtpMock.
const sendOtpMock = sendOtp;

// ---------- send-rate throttle (per account, "once per number") ----------

// Returns {allowed:true} or {allowed:false, retryAfterSeconds, reason}.
function checkOtpSendAllowed(user) {
  const now = Date.now();
  if (user.otp_last_sent_at) {
    const sinceLastMs = now - new Date(user.otp_last_sent_at).getTime();
    if (sinceLastMs < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      return { allowed: false, retryAfterSeconds: Math.ceil((OTP_RESEND_COOLDOWN_SECONDS * 1000 - sinceLastMs) / 1000), reason: 'cooldown' };
    }
  }
  const windowActive =
    user.otp_window_started_at &&
    now - new Date(user.otp_window_started_at).getTime() < OTP_SEND_WINDOW_MINUTES * 60 * 1000;
  if (windowActive && user.otp_send_count >= OTP_SEND_MAX_PER_WINDOW) {
    const windowEnd = new Date(user.otp_window_started_at).getTime() + OTP_SEND_WINDOW_MINUTES * 60 * 1000;
    return { allowed: false, retryAfterSeconds: Math.ceil((windowEnd - now) / 1000), reason: 'window' };
  }
  return { allowed: true };
}

// Call right after generating+storing a fresh code. Also resets the verify
// attempt counter/lock, since a brand new code deserves a fresh attempt budget.
async function recordOtpSent(userId, { resetWindow }) {
  if (resetWindow) {
    await pool.query(
      `UPDATE users SET otp_send_count = 1, otp_window_started_at = now(), otp_last_sent_at = now(),
         otp_attempt_count = 0, otp_locked_until = NULL WHERE id = $1`,
      [userId]
    );
  } else {
    await pool.query(
      `UPDATE users SET otp_send_count = otp_send_count + 1, otp_last_sent_at = now(),
         otp_attempt_count = 0, otp_locked_until = NULL WHERE id = $1`,
      [userId]
    );
  }
}

// Convenience wrapper: checks the throttle, and if allowed, bumps the
// counters (resetting the 1h window if it had expired). Returns the same
// shape as checkOtpSendAllowed.
async function throttleAndRecordOtpSend(user) {
  const check = checkOtpSendAllowed(user);
  if (!check.allowed) return check;
  const windowExpired =
    !user.otp_window_started_at ||
    Date.now() - new Date(user.otp_window_started_at).getTime() >= OTP_SEND_WINDOW_MINUTES * 60 * 1000;
  await recordOtpSent(user.id, { resetWindow: windowExpired });
  return { allowed: true };
}

// ---------- verify-attempt throttle (per account, "guessing the code") ----------

function checkOtpVerifyAllowed(user) {
  if (user.otp_locked_until && new Date(user.otp_locked_until) > new Date()) {
    const retryAfterSeconds = Math.ceil((new Date(user.otp_locked_until).getTime() - Date.now()) / 1000);
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true };
}

// Call on every wrong code. Locks once OTP_MAX_VERIFY_ATTEMPTS is reached.
async function recordOtpFailure(userId, currentAttemptCount) {
  const next = (currentAttemptCount || 0) + 1;
  if (next >= OTP_MAX_VERIFY_ATTEMPTS) {
    await pool.query(
      `UPDATE users SET otp_attempt_count = $1, otp_locked_until = now() + interval '${OTP_VERIFY_LOCK_MINUTES} minutes' WHERE id = $2`,
      [next, userId]
    );
  } else {
    await pool.query('UPDATE users SET otp_attempt_count = $1 WHERE id = $2', [next, userId]);
  }
}

async function resetOtpAttempts(userId) {
  await pool.query('UPDATE users SET otp_attempt_count = 0, otp_locked_until = NULL WHERE id = $1', [userId]);
}

module.exports = {
  generateOtp,
  otpExpiry,
  sendOtp,
  sendOtpMock,
  OTP_TTL_MINUTES,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_VERIFY_LOCK_MINUTES,
  OTP_SEND_MAX_PER_WINDOW,
  OTP_SEND_WINDOW_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
  checkOtpSendAllowed,
  throttleAndRecordOtpSend,
  checkOtpVerifyAllowed,
  recordOtpFailure,
  resetOtpAttempts,
};
