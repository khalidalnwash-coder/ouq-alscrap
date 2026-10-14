require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const authRoutes = require('./routes/auth');
const listingsRoutes = require('./routes/listings');
const usersRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const reportsRoutes = require('./routes/reports');
const transactionsRoutes = require('./routes/transactions');
const conversationsRoutes = require('./routes/conversations');
const supportRoutes = require('./routes/support');
const { uploadsDir, storageStatus } = require('./utils/storage');
const { runArchivalSweep } = require('./jobs/archival');

function envTrim(name) {
  const v = process.env[name];
  if (v == null) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

const app = express();

// Render (and most PaaS hosts) sit the app behind exactly one reverse
// proxy — trusting just that first hop (not `true`, which would trust any
// X-Forwarded-For an attacker sends directly) is what makes req.ip reflect
// the real client, which both the IP-based rate limiters below and any
// future logging depend on.
app.set('trust proxy', 1);

// Security headers (security review item 3). CSP is left off: this app's
// screens are built with inline onclick="" handlers throughout
// public/app.js, which a real Content-Security-Policy would block wholesale
// without a broader refactor to addEventListener() — tracked as a deferred
// follow-up rather than silently breaking every button. Every other
// protection helmet sets by default (nosniff, frameguard, hidePoweredBy,
// HSTS, referrer-policy, etc.) stays on.
app.use(helmet({ contentSecurityPolicy: false }));

// CORS: restricted to the app's own origin(s) (security review item 3) —
// previously wide open to any site (Access-Control-Allow-Origin: *).
// This app serves its own frontend (public/ below) from the same origin as
// the API, so the one origin that must always work with zero configuration
// is the app's own — computed per-request from req.hostname/req.protocol
// (both trust-proxy-aware, honoring X-Forwarded-Host/-Proto from the one
// trusted hop set above) rather than hardcoded, so this isn't something a
// deploy can forget to set.
//
// BUG FIXED HERE: the first version of this check used the raw `Host`
// header instead of req.hostname. Render's routing layer can forward a
// request to this container under a Host that differs from the public
// domain the browser actually sees (that's exactly what X-Forwarded-Host
// is for) — so the raw-Host comparison never matched the browser's real
// Origin in production, and CORS silently blocked the browser from reading
// every authenticated response (GET /api/auth/me included) even though the
// request reached the server and succeeded there; the browser just refused
// to hand the response to the page's JS. req.hostname is Express's
// proxy-aware accessor (uses X-Forwarded-Host under trust proxy, falls
// back to Host otherwise) and doesn't include a port, which is also
// correct here since a production Origin never carries one either; local
// dev (http://localhost:4000, port included) is covered by the explicit
// localhost fallback below instead.
//
// ALLOWED_ORIGINS (comma-separated, see server/.env.example) is only for
// genuinely separate origins — a different frontend domain, a mobile app
// webview, etc. A request with no Origin header at all (curl,
// server-to-server) is never affected by CORS in the first place; this
// only governs cross-origin browser requests.
const configuredOrigins = (envTrim('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean);
const isProduction = envTrim('NODE_ENV') === 'production';
app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    const selfOrigin = `${req.protocol}://${req.hostname}`;
    const allowed =
      !origin ||
      origin === selfOrigin ||
      configuredOrigins.includes(origin) ||
      (!isProduction && /^https?:\/\/localhost(:\d+)?$/.test(origin));
    callback(null, { origin: allowed });
  })
);

app.use(express.json());

// uploadsDir is set whenever local disk is involved at all — the real
// "local" driver, or the "disabled" safety state, which still serves (and
// can delete) whatever a previous deploy already saved there even though it
// refuses to write anything new. Only unset when Cloudinary is genuinely
// active, since media is then served directly from Cloudinary's own URLs.
if (uploadsDir) app.use('/uploads', express.static(uploadsDir));

// Served explicitly (ahead of the static middleware below, and with an
// explicit no-cache header) so browsers always revalidate it instead of
// possibly reusing a stale cached copy — the one file that genuinely must
// never go stale, since it's what detects and installs every app update.
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'sw.js'));
});

app.use(express.static(path.join(__dirname, '..', '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/support', supportRoutes);

// storage below reports the media-upload driver actually running — never
// secrets, just enough to confirm from a browser/curl whether Cloudinary is
// really active without digging through Render's logs. See utils/storage.js.
app.get('/api/health', (_req, res) => res.json({ ok: true, storage: storageStatus }));

// Every error is logged with full detail server-side; only a small,
// deliberately generic set of messages ever reaches the client (security
// review item 3 — raw driver/parser errors, e.g. Postgres's own error text,
// used to be forwarded verbatim via err.message).
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);

  if (err instanceof Error && err.message && err.message.includes('File too large')) {
    return res.status(413).json({ error: 'حجم الملف كبير جداً' });
  }
  // express.json() throws a SyntaxError (via body-parser) for a malformed
  // request body — a client mistake, not a server fault, so 400 rather than 500.
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'البيانات المرسلة غير صالحة' });
  }

  res.status(500).json({ error: 'حدث خطأ في الخادم، حاول مرة أخرى' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`alscrap server listening on :${port}`));

// Auto-archival policy sweep (spec Section 15) — runs once shortly after
// boot, then hourly. An in-process interval timer is sufficient at this
// scale (single server instance, no separate cron infra yet); POST
// /api/admin/run-archival lets an admin force it on demand in the meantime.
const ARCHIVAL_INTERVAL_MS = 60 * 60 * 1000;
setTimeout(() => runArchivalSweep().catch((err) => console.error('archival sweep failed:', err)), 10_000);
setInterval(() => runArchivalSweep().catch((err) => console.error('archival sweep failed:', err)), ARCHIVAL_INTERVAL_MS);
