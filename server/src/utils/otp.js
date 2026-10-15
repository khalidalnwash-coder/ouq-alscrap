// OTP generation, delivery and brute-force throttling.
//
// Delivery: email goes through the official `resend` SDK whenever
// RESEND_API_KEY/EMAIL_FROM are configured; WhatsApp goes through Twilio
// whenever its env vars are configured (not wired up in production yet —
// see public/app.js, WhatsApp is only offered client-side as "coming
// soon"). With no provider configured, this falls back to logging the code
// server-side only (never returned to the HTTP caller — see security
// review, item 1) so local development keeps working without real
// provider accounts. See server/.env.example for exactly which env vars
// each provider needs.
//
// sendOtp()'s return value distinguishes "not configured" (silent, never
// surfaced to the user — the established "don't break signup locally"
// behavior) from "configured but genuinely failed to send" (surfaced to
// the user as a clear error by the calling route — see routes/auth.js).
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

const { Resend } = require('resend');
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

// Built lazily (not at module load) so a missing RESEND_API_KEY never
// crashes the server at boot — it only matters the first time an email is
// actually sent, and that path already handles "not configured" gracefully.
let resendClient = null;
let resendClientKey = null;
function getResendClient() {
  const apiKey = envTrim('RESEND_API_KEY');
  if (!apiKey) return null;
  if (!resendClient || resendClientKey !== apiKey) {
    resendClient = new Resend(apiKey);
    resendClientKey = apiKey;
  }
  return resendClient;
}

// Simple, inline-styled, table-based layout (no flexbox/grid, no <style>
// block) since that's what reliably survives the HTML stripping most email
// clients apply — dir="rtl" set at every level that holds Arabic text.
function otpEmailHtml(code) {
  return `<!doctype html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background-color:#F3F5F8; font-family:Tahoma,'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F5F8; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:420px; background-color:#FFFFFF; border-radius:16px; overflow:hidden;" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="background-color:#1E3A5F; padding:24px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="padding-left:10px;"><img src="https://tashleehalkhaleej.com/icons/icon-192.png" width="36" height="36" alt="" style="display:block; border-radius:8px;"></td>
                <td><span style="color:#FFFFFF; font-size:20px; font-weight:bold;">تشليح الخليج</span></td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px; text-align:right;">
              <p style="margin:0 0 20px; font-size:15px; color:#151C26; line-height:1.8;">كود التحقق الخاص بك هو:</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr><td align="center" style="background-color:#EAF0F6; border-radius:12px; padding:18px 0;">
                  <span style="font-size:36px; font-weight:bold; letter-spacing:10px; color:#1E3A5F; direction:ltr; display:inline-block;">${code}</span>
                </td></tr>
              </table>
              <p style="margin:0 0 8px; font-size:13.5px; color:#5B6B7C; line-height:1.8;">هذا الرمز صالح لمدة ${OTP_TTL_MINUTES} دقائق فقط.</p>
              <p style="margin:0; font-size:13.5px; color:#5B6B7C; line-height:1.8;">إذا ما طلبت هذا الرمز، تجاهل هذه الرسالة ولا داعي لأي إجراء.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px; border-top:1px solid #E4E8EE; text-align:center;">
              <span style="font-size:11.5px; color:#93A1AF;">تشليح الخليج — سوق السيارات المصدومة وقطع الغيار في الخليج</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Returns {attempted:false} when RESEND_API_KEY/EMAIL_FROM aren't set (the
// caller treats this as "dev mode, logged only" and never surfaces an
// error). Throws when a real send was attempted and genuinely failed, so
// the caller can tell that apart from "not configured" and surface a clear
// error to the user instead of silently pretending it worked.
async function sendEmailViaResend({ to, code }) {
  const client = getResendClient();
  const from = envTrim('EMAIL_FROM');
  if (!client || !from) return { attempted: false };

  const { error } = await client.emails.send({
    from,
    to: [to],
    subject: `كود التحقق: ${code} — تشليح الخليج`,
    html: otpEmailHtml(code),
  });
  if (error) {
    // error.message/name come from Resend's own API response — safe to
    // log (never the OTP code or the API key, neither of which appear in
    // this object), unsafe to ever send back to the HTTP caller.
    throw new Error(`Resend ${error.name || 'error'}: ${error.message || 'unknown error'}`);
  }
  return { attempted: true };
}

async function sendWhatsAppViaTwilio({ to, code }) {
  const sid = envTrim('TWILIO_ACCOUNT_SID');
  const token = envTrim('TWILIO_AUTH_TOKEN');
  const from = envTrim('TWILIO_WHATSAPP_FROM');
  if (!sid || !token || !from) return { attempted: false };

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
  return { attempted: true };
}

// Sends the code for real when the relevant provider is configured; always
// also logs server-side (never returned to the HTTP caller, and never the
// API key either) so a developer with server/log access can read it during
// local testing either way.
//
// Returns {attempted, delivered}:
//   - {attempted:false, delivered:false} — provider not configured (dev
//     mode). The caller must NOT surface this as an error to the user.
//   - {attempted:true, delivered:true} — sent successfully.
//   - {attempted:true, delivered:false} — a real send was tried and
//     genuinely failed. The caller SHOULD surface a clear error.
async function sendOtp({ channel, destination, code }) {
  // eslint-disable-next-line no-console
  console.log(`[OTP] channel=${channel} to=${destination} code=${code}`);
  if (channel === 'email') {
    try {
      const { attempted } = await sendEmailViaResend({ to: destination, code });
      if (!attempted) {
        console.log('[OTP] RESEND_API_KEY/EMAIL_FROM not configured — email not actually sent, code logged above only.');
        return { attempted: false, delivered: false };
      }
      return { attempted: true, delivered: true };
    } catch (err) {
      console.error('[OTP] email delivery via Resend failed:', err.message || err);
      return { attempted: true, delivered: false };
    }
  }
  if (channel === 'whatsapp') {
    try {
      const { attempted } = await sendWhatsAppViaTwilio({ to: destination, code });
      if (!attempted) {
        console.log('[OTP] TWILIO_* env vars not configured — WhatsApp message not actually sent, code logged above only.');
        return { attempted: false, delivered: false };
      }
      return { attempted: true, delivered: true };
    } catch (err) {
      console.error('[OTP] WhatsApp delivery via Twilio failed:', err.message || err);
      return { attempted: true, delivered: false };
    }
  }
  return { attempted: false, delivered: false };
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
