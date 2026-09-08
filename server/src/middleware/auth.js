const jwt = require('jsonwebtoken');

function signToken(user) {
  return jwt.sign({ sub: user.id, is_admin: user.is_admin }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'يلزم تسجيل الدخول' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    req.isAdmin = !!payload.is_admin;
    next();
  } catch {
    return res.status(401).json({ error: 'جلسة غير صالحة، سجّل الدخول مرة أخرى' });
  }
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = payload.sub;
      req.isAdmin = !!payload.is_admin;
    } catch {
      // ignore invalid token on optional routes
    }
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: 'صلاحية مسؤول مطلوبة' });
  next();
}

module.exports = { signToken, requireAuth, optionalAuth, requireAdmin };
