const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { CURRENCIES, COMMISSION_RATE } = require('../utils/constants');

const router = express.Router();

// POST /api/transactions — spec Section 11. One screen, one button: the user
// enters the deal amount/currency and taps "تم التحويل، تأكيد التسديد", which
// both creates the Transaction record AND marks it confirmed in the same
// step (there is no separate proof-of-transfer upload or review step by
// design — pure self-attestation, see Section 9's pledge).
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { listing_id, deal_amount, currency } = req.body || {};

    if (!listing_id || !deal_amount || !currency) {
      return res.status(400).json({ error: 'الإعلان ومبلغ الصفقة والعملة مطلوبة' });
    }
    if (!CURRENCIES.includes(currency)) {
      return res.status(400).json({ error: 'عملة غير صالحة' });
    }
    const amount = Number(deal_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'مبلغ صفقة غير صالح' });
    }

    const listingRes = await pool.query('SELECT id, seller_id FROM listings WHERE id = $1', [listing_id]);
    const listing = listingRes.rows[0];
    if (!listing) return res.status(404).json({ error: 'الإعلان غير موجود' });
    if (listing.seller_id === req.userId) {
      return res.status(400).json({ error: 'لا يمكنك تأكيد صفقة على إعلانك الخاص' });
    }

    const commissionAmount = Math.round(amount * COMMISSION_RATE * 100) / 100;

    const result = await pool.query(
      `INSERT INTO transactions
        (listing_id, buyer_id, seller_id, deal_amount, currency, commission_amount, commission_status, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'user_confirmed_paid', now())
       RETURNING id, deal_amount, currency, commission_amount, commission_status, confirmed_at`,
      [listing_id, req.userId, listing.seller_id, amount, currency, commissionAmount]
    );

    res.status(201).json({ transaction: result.rows[0] });
  })
);

module.exports = router;
