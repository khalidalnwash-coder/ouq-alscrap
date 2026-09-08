// Phase-1 decision (confirmed with product owner): OTP delivery is fully mocked.
// No real WhatsApp/email provider is wired up yet — WhatsApp needs a Meta-approved
// Business API account (spec Section 3 implementation note), which isn't set up.
// The code is generated for real and returned to the caller (+ logged server-side)
// so the flow can be exercised end-to-end; swap this module for a real provider
// call in Phase 2 without touching the routes that use it.

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

const OTP_TTL_MINUTES = 10;

function otpExpiry() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

function sendOtpMock({ channel, destination, code }) {
  // eslint-disable-next-line no-console
  console.log(`[MOCK OTP] channel=${channel} to=${destination} code=${code}`);
}

module.exports = { generateOtp, otpExpiry, sendOtpMock, OTP_TTL_MINUTES };
