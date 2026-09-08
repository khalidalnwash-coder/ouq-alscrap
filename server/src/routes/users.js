const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/:id/public',
  asyncHandler(async (req, res) => {
    const userRes = await pool.query(
      `SELECT id, full_name, account_type, is_verified_trader, rating_avg, completed_deals_count, created_at
       FROM users WHERE id = $1`,
      [req.params.id]
    );
    const seller = userRes.rows[0];
    if (!seller) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const listingsRes = await pool.query(
      `SELECT l.id, l.title, l.price, l.currency, l.city,
              (SELECT thumbnail_url FROM listing_media m WHERE m.listing_id = l.id ORDER BY order_index ASC LIMIT 1) AS thumbnail_url
       FROM listings l WHERE l.seller_id = $1 AND l.status = 'active' ORDER BY l.last_updated_at DESC`,
      [seller.id]
    );

    res.json({
      seller: {
        id: seller.id,
        full_name: seller.full_name,
        account_type: seller.account_type,
        is_verified_trader: seller.is_verified_trader,
        rating_avg: Number(seller.rating_avg),
        completed_deals_count: seller.completed_deals_count,
        member_since: seller.created_at,
      },
      listings: listingsRes.rows.map((l) => ({ ...l, price: Number(l.price) })),
    });
  })
);

// Contact reveal: Phase 1 has no in-app chat (not part of the MVP scope), so
// "تواصل مع البائع" reveals the seller's phone/WhatsApp instead — the buyer
// then contacts them directly, which fits the platform's "listing intermediary
// only" model from the spec.
router.get(
  '/:id/contact',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userRes = await pool.query(
      'SELECT id, full_name, phone_country_code, phone_number, otp_verified_channel FROM users WHERE id = $1',
      [req.params.id]
    );
    const seller = userRes.rows[0];
    if (!seller) return res.status(404).json({ error: 'المستخدم غير موجود' });

    res.json({
      full_name: seller.full_name,
      phone: `${seller.phone_country_code}${seller.phone_number}`,
      whatsapp_verified: seller.otp_verified_channel === 'whatsapp',
    });
  })
);

module.exports = router;
