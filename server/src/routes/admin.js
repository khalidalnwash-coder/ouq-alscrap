const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { serializeUser } = require('../utils/serialize');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [activeUsers, listingsToday, totalListings] = await Promise.all([
      pool.query("SELECT count(*)::int AS n FROM users WHERE status = 'active'"),
      pool.query("SELECT count(*)::int AS n FROM listings WHERE created_at::date = now()::date"),
      pool.query("SELECT count(*)::int AS n FROM listings WHERE status = 'active'"),
    ]);
    res.json({
      active_users_count: activeUsers.rows[0].n,
      listings_posted_today: listingsToday.rows[0].n,
      active_listings_count: totalListings.rows[0].n,
    });
  })
);

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 200');
    res.json({ users: result.rows.map(serializeUser) });
  })
);

router.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'حالة غير صالحة' });
    }
    const result = await pool.query('UPDATE users SET status = $1 WHERE id = $2 RETURNING *', [
      status,
      req.params.id,
    ]);
    if (!result.rows[0]) return res.status(404).json({ error: 'مستخدم غير موجود' });
    res.json({ user: serializeUser(result.rows[0]) });
  })
);

module.exports = router;
