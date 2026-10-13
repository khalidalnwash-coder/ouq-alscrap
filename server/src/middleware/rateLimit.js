// IP-based rate limiting (security review item 2/1) — a "per device" layer
// that sits alongside the per-account throttles in utils/otp.js and the
// per-account login lockout in routes/auth.js. Needed because an attacker
// rotating through many different accounts/phone numbers from one machine
// isn't slowed down by a per-account limit alone.
//
// This requires app.set('trust proxy', ...) to be configured correctly in
// index.js so req.ip reflects the real client behind Render's reverse
// proxy rather than the proxy's own address for everyone.

const rateLimit = require('express-rate-limit');

function arabicLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    // Default keying is req.ip, which is exactly the "per device" axis
    // wanted here (combined with trust proxy, below).
  });
}

const FIFTEEN_MIN = 15 * 60 * 1000;

// Signup / resend / forgot-password-request / profile-verify-request: an
// account-creation or new-code-request action, generous enough for a real
// user who fumbles the form a couple of times, tight enough to blunt mass
// automated requests from one IP.
const otpSendLimiter = arabicLimiter({
  windowMs: FIFTEEN_MIN,
  max: 8,
  message: 'طلبات كثيرة من نفس الجهاز، حاول لاحقاً',
});

// Verify endpoints: looser than the send limiter since legitimate typos are
// common, but still capped — the real defense against guessing is the
// per-account attempt lockout in utils/otp.js; this is a second layer.
const otpVerifyLimiter = arabicLimiter({
  windowMs: FIFTEEN_MIN,
  max: 20,
  message: 'محاولات كثيرة من نفس الجهاز، حاول لاحقاً',
});

const loginLimiter = arabicLimiter({
  windowMs: FIFTEEN_MIN,
  max: 20,
  message: 'محاولات دخول كثيرة من نفس الجهاز، حاول لاحقاً',
});

module.exports = { otpSendLimiter, otpVerifyLimiter, loginLimiter };
