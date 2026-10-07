const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { CURRENCIES, COMMISSION_RATE } = require('../utils/constants');

const router = express.Router();

// POST /api/transactions — spec Section 11, with the commission split: both
// the buyer AND the seller owe their own 2.5% share, and each confirms/pays
// theirs independently — this endpoint records ONE party's confirmation per
// call, so the same deal produces two separate transaction rows (one per
// party) rather than one row covering both. One screen, one button: the
// user enters the deal amount/currency and taps "تم التحويل، تأكيد
// التسديد", which both creates the Transaction record AND marks it
// confirmed in the same step (there is no separate proof-of-transfer
// upload or review step by design — pure self-attestation, see Section 9's
// pledge).
//
// listing_id is optional: this screen is also reachable directly from the
// home screen and account settings, with no listing/counterparty context
// at all — a deal made entirely outside the app can still be confirmed
// here. When listing_id IS given (the "تأكيد الصفقة" button on a listing,
// shown to both the listing's owner and any other visitor), the confirming
// user's role is derived from whether they own the listing: the owner is
// recorded as seller_id confirming their own share (buyer_id stays null —
// which specific buyer this was isn't tracked for the seller's own
// confirmation), and anyone else is recorded as buyer_id against the
// listing's seller_id. When listing_id is omitted, seller_id is just the
// confirming user and listing_id/buyer_id stay null.
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { listing_id, deal_amount, currency } = req.body || {};

    if (!deal_amount || !currency) {
      return res.status(400).json({ error: 'مبلغ الصفقة والعملة مطلوبة' });
    }
    if (!CURRENCIES.includes(currency)) {
      return res.status(400).json({ error: 'عملة غير صالحة' });
    }
    const amount = Number(deal_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'مبلغ صفقة غير صالح' });
    }

    let finalListingId = null;
    let finalBuyerId = null;
    let finalSellerId = req.userId;

    if (listing_id) {
      const listingRes = await pool.query('SELECT id, seller_id FROM listings WHERE id = $1', [listing_id]);
      const listing = listingRes.rows[0];
      if (!listing) return res.status(404).json({ error: 'الإعلان غير موجود' });
      finalListingId = listing.id;
      if (listing.seller_id === req.userId) {
        finalSellerId = req.userId;
        finalBuyerId = null;
      } else {
        finalBuyerId = req.userId;
        finalSellerId = listing.seller_id;
      }
    }

    const commissionAmount = Math.round(amount * COMMISSION_RATE * 100) / 100;

    const result = await pool.query(
      `INSERT INTO transactions
        (listing_id, buyer_id, seller_id, deal_amount, currency, commission_amount, commission_status, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'user_confirmed_paid', now())
       RETURNING id, deal_amount, currency, commission_amount, commission_status, confirmed_at`,
      [finalListingId, finalBuyerId, finalSellerId, amount, currency, commissionAmount]
    );

    res.status(201).json({ transaction: result.rows[0] });
  })
);

module.exports = router;
