const express = require('express');
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Public seller profile: name, rating, every review left on them, and their
// active listings — reachable by anyone, logged in or not. optionalAuth (not
// requireAuth) is what keeps it open to anonymous visitors while still
// letting a logged-in viewer's can_review be computed in the same request.
router.get(
  '/:id/public',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const userRes = await pool.query(
      `SELECT id, full_name, account_type, is_verified_trader, rating_avg, reviews_count, completed_deals_count, created_at
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

    const reviewsRes = await pool.query(
      `SELECT rv.id, rv.rating, rv.comment, rv.created_at, u.full_name AS reviewer_name
       FROM reviews rv JOIN users u ON u.id = rv.reviewer_id
       WHERE rv.seller_id = $1 ORDER BY rv.created_at DESC LIMIT 200`,
      [seller.id]
    );

    // Eligible to leave a review: logged in, not reviewing yourself, have
    // messaged or confirmed a deal with this seller, and haven't already
    // reviewed them (one review per buyer per seller).
    let canReview = false;
    if (req.userId && req.userId !== seller.id) {
      const eligibleRes = await pool.query(
        `SELECT (
           (EXISTS(SELECT 1 FROM conversations WHERE buyer_id = $1 AND seller_id = $2)
             OR EXISTS(SELECT 1 FROM transactions WHERE buyer_id = $1 AND seller_id = $2))
           AND NOT EXISTS(SELECT 1 FROM reviews WHERE seller_id = $2 AND reviewer_id = $1)
         ) AS can_review`,
        [req.userId, seller.id]
      );
      canReview = eligibleRes.rows[0].can_review;
    }

    res.json({
      seller: {
        id: seller.id,
        full_name: seller.full_name,
        account_type: seller.account_type,
        is_verified_trader: seller.is_verified_trader,
        rating_avg: Number(seller.rating_avg),
        reviews_count: seller.reviews_count,
        completed_deals_count: seller.completed_deals_count,
        member_since: seller.created_at,
        can_review: canReview,
      },
      listings: listingsRes.rows.map((l) => ({ ...l, price: Number(l.price) })),
      reviews: reviewsRes.rows,
    });
  })
);

// POST /api/users/:id/reviews — leave a 1-5 star rating (+ optional comment)
// on a seller. Eligibility (messaged or confirmed a deal with them) and the
// one-review-per-buyer-per-seller rule are both re-checked server-side, not
// just trusted from the client's can_review flag. No PATCH/DELETE route
// exists for this table at all — a seller can never edit or remove a
// review left on their own account, by construction.
router.post(
  '/:id/reviews',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sellerId = req.params.id;
    if (sellerId === req.userId) {
      return res.status(400).json({ error: 'لا يمكنك تقييم نفسك' });
    }
    const sellerRes = await pool.query('SELECT id FROM users WHERE id = $1', [sellerId]);
    if (!sellerRes.rows[0]) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const { rating, comment } = req.body || {};
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'التقييم يجب أن يكون من 1 إلى 5 نجوم' });
    }

    const eligibleRes = await pool.query(
      `SELECT (EXISTS(SELECT 1 FROM conversations WHERE buyer_id = $1 AND seller_id = $2)
             OR EXISTS(SELECT 1 FROM transactions WHERE buyer_id = $1 AND seller_id = $2)) AS eligible`,
      [req.userId, sellerId]
    );
    if (!eligibleRes.rows[0].eligible) {
      return res.status(403).json({ error: 'يمكنك تقييم بائع تواصلت معه أو أكّدت صفقة معه فقط' });
    }

    const existing = await pool.query('SELECT id FROM reviews WHERE seller_id = $1 AND reviewer_id = $2', [
      sellerId,
      req.userId,
    ]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'قيّمت هذا البائع من قبل' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO reviews (seller_id, reviewer_id, rating, comment) VALUES ($1,$2,$3,$4)
         RETURNING id, rating, comment, created_at`,
        [sellerId, req.userId, ratingNum, (comment || '').trim() || null]
      );
      const agg = await client.query(
        `SELECT AVG(rating)::numeric(2,1) AS avg, COUNT(*)::int AS cnt FROM reviews WHERE seller_id = $1`,
        [sellerId]
      );
      await client.query('UPDATE users SET rating_avg = $1, reviews_count = $2 WHERE id = $3', [
        agg.rows[0].avg,
        agg.rows[0].cnt,
        sellerId,
      ]);
      await client.query('COMMIT');

      const reviewerRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [req.userId]);
      res.status(201).json({
        review: { ...inserted.rows[0], reviewer_name: reviewerRes.rows[0].full_name },
        rating_avg: Number(agg.rows[0].avg),
        reviews_count: agg.rows[0].cnt,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

// Superseded by the listing-detail "اتصال" (call) / "رسالة خاصة" (chat)
// options (see routes/listings.js GET /:id), which respect phone_visible —
// kept for API compatibility but now honors the same setting instead of
// always revealing the phone number regardless of the seller's choice.
router.get(
  '/:id/contact',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userRes = await pool.query(
      'SELECT id, full_name, phone_country_code, phone_number, phone_visible, otp_verified_channel FROM users WHERE id = $1',
      [req.params.id]
    );
    const seller = userRes.rows[0];
    if (!seller) return res.status(404).json({ error: 'المستخدم غير موجود' });

    res.json({
      full_name: seller.full_name,
      phone: seller.phone_visible ? `${seller.phone_country_code}${seller.phone_number}` : null,
      whatsapp_verified: seller.otp_verified_channel === 'whatsapp',
    });
  })
);

module.exports = router;
