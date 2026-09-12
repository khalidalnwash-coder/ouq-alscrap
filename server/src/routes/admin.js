const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { serializeUser } = require('../utils/serialize');
const { asyncHandler } = require('../utils/asyncHandler');
const { runArchivalSweep } = require('../jobs/archival');

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

// Report queue (spec Sections 10 & 14) — all Report records regardless of
// target_type, newest first, with a review/resolve action.
router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const { status, target_type } = req.query;
    const clauses = [];
    const params = [];
    if (status) {
      params.push(status);
      clauses.push(`r.status = $${params.length}`);
    }
    if (target_type) {
      params.push(target_type);
      clauses.push(`r.target_type = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT r.*, u.full_name AS reporter_name,
              CASE WHEN r.target_type = 'listing' THEN l.title ELSE tu.full_name END AS target_label
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
       LEFT JOIN listings l ON r.target_type = 'listing' AND l.id = r.target_id
       LEFT JOIN users tu ON r.target_type = 'account' AND tu.id = r.target_id
       ${where}
       ORDER BY r.created_at DESC LIMIT 200`,
      params
    );
    res.json({ reports: result.rows });
  })
);

router.patch(
  '/reports/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (!['pending', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'حالة غير صالحة' });
    }
    const result = await pool.query('UPDATE reports SET status = $1 WHERE id = $2 RETURNING *', [
      status,
      req.params.id,
    ]);
    if (!result.rows[0]) return res.status(404).json({ error: 'بلاغ غير موجود' });
    res.json({ report: result.rows[0] });
  })
);

// Manual trigger for the auto-archival sweep (spec Section 15) — the same
// sweep also runs on an interval from index.js; this exists for ops/testing
// so an admin can force it without waiting for the next tick.
router.post(
  '/run-archival',
  asyncHandler(async (_req, res) => {
    const result = await runArchivalSweep();
    res.json(result);
  })
);

module.exports = router;
