const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { isAdminEmail } = require('../utils/admin');

// The token carries only identity (sub) — no permission claims. Both
// suspension and admin status are re-checked against the DB/env on every
// request instead of being baked into a 30-day token, so revoking either
// (suspending an account, changing ADMIN_EMAIL) takes effect on the very
// next request rather than waiting for the token to expire.
function signToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'يلزم تسجيل الدخول' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'جلسة غير صالحة، سجّل الدخول مرة أخرى' });
  }
  try {
    const result = await pool.query('SELECT email, status FROM users WHERE id = $1', [payload.sub]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'جلسة غير صالحة، سجّل الدخول مرة أخرى' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'تم إيقاف هذا الحساب' });
    req.userId = payload.sub;
    req.userEmail = user.email;
    req.isAdmin = isAdminEmail(user.email);
    next();
  } catch (err) {
    next(err);
  }
}

async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const result = await pool.query('SELECT email, status FROM users WHERE id = $1', [payload.sub]);
      const user = result.rows[0];
      // A suspended account browsing with an old token is treated as
      // anonymous here rather than hard-blocked — optionalAuth routes are
      // public browsing, not an action a suspended user is doing "as"
      // themselves. requireAuth is what actually enforces the suspension.
      if (user && user.status !== 'suspended') {
        req.userId = payload.sub;
        req.userEmail = user.email;
        req.isAdmin = isAdminEmail(user.email);
      }
    } catch {
      // ignore invalid token on optional routes
    }
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!isAdminEmail(req.userEmail)) return res.status(403).json({ error: 'صلاحية مسؤول مطلوبة' });
  next();
}

module.exports = { signToken, requireAuth, optionalAuth, requireAdmin };
