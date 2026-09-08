const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { saveImage } = require('../utils/storage');
const { asyncHandler } = require('../utils/asyncHandler');
const { PHASE1_COUNTRY, PHASE1_CURRENCY, PART_CATEGORIES, CITIES_SA } = require('../utils/constants');

const router = express.Router();

const MAX_IMAGES = 10;
const MAX_IMAGE_MB = 5;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_MB * 1024 * 1024, files: MAX_IMAGES },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      return cb(new Error('الصور يجب أن تكون JPG أو PNG فقط'));
    }
    cb(null, true);
  },
});

async function attachMedia(listings) {
  if (!listings.length) return listings;
  const ids = listings.map((l) => l.id);
  const mediaRes = await pool.query(
    'SELECT * FROM listing_media WHERE listing_id = ANY($1) ORDER BY order_index ASC',
    [ids]
  );
  const byListing = {};
  for (const m of mediaRes.rows) {
    (byListing[m.listing_id] = byListing[m.listing_id] || []).push(m);
  }
  return listings.map((l) => ({ ...l, media: byListing[l.id] || [] }));
}

function listingCard(l) {
  const thumb = l.media && l.media[0] ? l.media[0].thumbnail_url : null;
  return {
    id: l.id,
    title: l.title,
    price: Number(l.price),
    currency: l.currency,
    city: l.city,
    country: l.country,
    part_category: l.part_category,
    thumbnail_url: thumb,
    last_updated_at: l.last_updated_at,
  };
}

router.get('/meta', (_req, res) => {
  res.json({ part_categories: PART_CATEGORIES, cities: CITIES_SA, country: PHASE1_COUNTRY, currency: PHASE1_CURRENCY });
});

// GET /api/listings?q=&part_category=&city=
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q, part_category, city } = req.query;
    const clauses = ["status = 'active'"];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      clauses.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    if (part_category) {
      params.push(part_category);
      clauses.push(`part_category = $${params.length}`);
    }
    if (city) {
      params.push(city);
      clauses.push(`city = $${params.length}`);
    }

    const sql = `SELECT * FROM listings WHERE ${clauses.join(' AND ')} ORDER BY last_updated_at DESC LIMIT 60`;
    const result = await pool.query(sql, params);
    const withMedia = await attachMedia(result.rows);
    res.json({ listings: withMedia.map(listingCard) });
  })
);

router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM listings WHERE seller_id = $1 AND status != 'removed' ORDER BY created_at DESC",
      [req.userId]
    );
    const withMedia = await attachMedia(result.rows);
    res.json({ listings: withMedia.map(listingCard) });
  })
);

router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT * FROM listings WHERE id = $1', [req.params.id]);
    const listing = result.rows[0];
    if (!listing) return res.status(404).json({ error: 'الإعلان غير موجود' });

    const [withMedia] = await attachMedia([listing]);
    const sellerRes = await pool.query(
      `SELECT id, full_name, account_type, is_verified_trader, rating_avg, completed_deals_count, created_at
       FROM users WHERE id = $1`,
      [listing.seller_id]
    );
    const seller = sellerRes.rows[0];

    res.json({
      listing: {
        id: withMedia.id,
        title: withMedia.title,
        description: withMedia.description,
        price: Number(withMedia.price),
        currency: withMedia.currency,
        city: withMedia.city,
        country: withMedia.country,
        part_category: withMedia.part_category,
        compatible_make: withMedia.compatible_make,
        compatible_model: withMedia.compatible_model,
        compatible_year_from: withMedia.compatible_year_from,
        compatible_year_to: withMedia.compatible_year_to,
        status: withMedia.status,
        last_updated_at: withMedia.last_updated_at,
        created_at: withMedia.created_at,
        media: withMedia.media.map((m) => ({ type: m.type, url: m.original_url, thumbnail_url: m.thumbnail_url })),
      },
      seller: seller
        ? {
            id: seller.id,
            full_name: seller.full_name,
            account_type: seller.account_type,
            is_verified_trader: seller.is_verified_trader,
            rating_avg: Number(seller.rating_avg),
            completed_deals_count: seller.completed_deals_count,
            member_since: seller.created_at,
          }
        : null,
    });
  })
);

router.post(
  '/',
  requireAuth,
  upload.array('images', MAX_IMAGES),
  asyncHandler(async (req, res) => {
    const { title, description, price, city, part_category, compatible_make, compatible_model, compatible_year_from, compatible_year_to } =
      req.body || {};

    if (!title || !price || !city || !part_category) {
      return res.status(400).json({ error: 'عنوان الإعلان والسعر والمدينة وفئة القطعة مطلوبة' });
    }
    if (!PART_CATEGORIES.includes(part_category)) {
      return res.status(400).json({ error: 'فئة قطعة غير صالحة' });
    }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: 'سعر غير صالح' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO listings
          (seller_id, category, title, description, country, city, price, currency,
           part_category, compatible_make, compatible_model, compatible_year_from, compatible_year_to)
         VALUES ($1,'spare_part',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          req.userId,
          title,
          description || null,
          PHASE1_COUNTRY,
          city,
          priceNum,
          PHASE1_CURRENCY,
          part_category,
          compatible_make || null,
          compatible_model || null,
          compatible_year_from ? Number(compatible_year_from) : null,
          compatible_year_to ? Number(compatible_year_to) : null,
        ]
      );
      const listing = result.rows[0];

      const files = req.files || [];
      let orderIndex = 0;
      for (const file of files) {
        const { originalUrl, thumbnailUrl } = await saveImage(file.buffer);
        await client.query(
          `INSERT INTO listing_media (listing_id, type, original_url, thumbnail_url, order_index)
           VALUES ($1,'image',$2,$3,$4)`,
          [listing.id, originalUrl, thumbnailUrl, orderIndex++]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ listing_id: listing.id });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
