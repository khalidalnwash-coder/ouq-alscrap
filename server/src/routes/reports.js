const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { REPORT_REASONS_LISTING, REPORT_REASONS_ACCOUNT } = require('../utils/constants');

const router = express.Router();

const REASON_VALUES = {
  listing: REPORT_REASONS_LISTING.map((r) => r.value),
  account: REPORT_REASONS_ACCOUNT.map((r) => r.value),
};

// POST /api/reports — spec Section 10. target_type has its own reason list
// (enforced here, not just client-side) — "commission evasion" is never a
// valid value on either list, by construction (it's simply not in either
// REASON_VALUES array).
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { target_type, target_id, reason, details } = req.body || {};

    if (!['listing', 'account'].includes(target_type)) {
      return res.status(400).json({ error: 'نوع الجهة المبلّغ عنها غير صالح' });
    }
    if (!target_id) {
      return res.status(400).json({ error: 'الجهة المبلّغ عنها مطلوبة' });
    }
    if (!REASON_VALUES[target_type].includes(reason)) {
      return res.status(400).json({ error: 'سبب البلاغ غير صالح' });
    }
    if (reason === 'other' && (!details || !details.trim())) {
      return res.status(400).json({ error: 'اكتب تفاصيل السبب' });
    }

    const table = target_type === 'listing' ? 'listings' : 'users';
    const exists = await pool.query(`SELECT id FROM ${table} WHERE id = $1`, [target_id]);
    if (!exists.rows[0]) {
      return res.status(404).json({ error: 'الجهة المبلّغ عنها غير موجودة' });
    }

    await pool.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, details)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.userId, target_type, target_id, reason, (details || '').trim() || null]
    );

    res.status(201).json({ ok: true });
  })
);

module.exports = router;
