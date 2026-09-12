const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { saveImage } = require('../utils/storage');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  PHASE1_COUNTRY,
  PHASE1_CURRENCY,
  PART_CATEGORIES,
  CITIES_SA,
  MOTORCYCLE_MAKES,
} = require('../utils/constants');

const router = express.Router();

const MAX_IMAGES = 10;
const MAX_IMAGE_MB = 5;
const DAMAGE_LEVELS = ['light', 'medium', 'severe'];
const CATEGORIES = ['spare_part', 'motorcycle'];
const LISTING_TYPES = ['part', 'whole'];

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
    category: l.category,
    listing_type: l.listing_type,
    part_category: l.part_category,
    compatible_make: l.compatible_make,
    compatible_model: l.compatible_model,
    damage_severity: l.damage_severity,
    status: l.status,
    thumbnail_url: thumb,
    last_updated_at: l.last_updated_at,
  };
}

router.get('/meta', (_req, res) => {
  res.json({
    part_categories: PART_CATEGORIES,
    cities: CITIES_SA,
    country: PHASE1_COUNTRY,
    currency: PHASE1_CURRENCY,
    motorcycle_makes: MOTORCYCLE_MAKES,
  });
});

// GET /api/listings?category=&listing_type=&make=&q=&part_category=&city=
// category defaults to 'spare_part' (the original car-parts browse/search screens
// never sent a category param, so this keeps them working unchanged).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q, part_category, city, category, listing_type, make } = req.query;
    const effectiveCategory = category || 'spare_part';
    const clauses = ["status = 'active'", `category = $1`];
    const params = [effectiveCategory];

    if (listing_type) {
      params.push(listing_type);
      clauses.push(`listing_type = $${params.length}`);
    }
    if (make) {
      params.push(make);
      clauses.push(`compatible_make = $${params.length}`);
    }
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
        category: withMedia.category,
        listing_type: withMedia.listing_type,
        part_category: withMedia.part_category,
        compatible_make: withMedia.compatible_make,
        compatible_model: withMedia.compatible_model,
        compatible_year_from: withMedia.compatible_year_from,
        compatible_year_to: withMedia.compatible_year_to,
        damage_severity: withMedia.damage_severity,
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
    const {
      title,
      description,
      price,
      city,
      category,
      listing_type,
      part_category,
      compatible_make,
      compatible_model,
      compatible_year_from,
      compatible_year_to,
      damage_severity,
    } = req.body || {};

    const effectiveCategory = category || 'spare_part';
    if (!CATEGORIES.includes(effectiveCategory)) {
      return res.status(400).json({ error: 'فئة إعلان غير صالحة' });
    }
    if (!title || !price || !city) {
      return res.status(400).json({ error: 'عنوان الإعلان والسعر والمدينة مطلوبة' });
    }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: 'سعر غير صالح' });
    }

    let effectiveListingType = 'part';
    let finalMake = compatible_make || null;
    let finalModel = compatible_model || null;
    let finalYearFrom = compatible_year_from ? Number(compatible_year_from) : null;
    let finalYearTo = compatible_year_to ? Number(compatible_year_to) : null;
    let finalPartCategory = part_category || null;
    let finalDamageSeverity = null;

    if (effectiveCategory === 'motorcycle') {
      if (!LISTING_TYPES.includes(listing_type)) {
        return res.status(400).json({ error: 'نوع الإعلان (قطعة / دراجة كاملة) مطلوب' });
      }
      effectiveListingType = listing_type;

      // The manufacturer grid (MOTORCYCLE_MAKES) is a selection convenience on
      // the client; 'أخرى' there prompts the user for a custom name before
      // ever calling this endpoint, so by the time a listing is created
      // compatible_make is just a normal free-text manufacturer name — same
      // as it already is for car parts.
      if (!compatible_make || !compatible_make.trim()) {
        return res.status(400).json({ error: 'الشركة المصنّعة مطلوبة' });
      }
      finalMake = compatible_make.trim();

      if (effectiveListingType === 'part') {
        if (!finalPartCategory || !PART_CATEGORIES.includes(finalPartCategory)) {
          return res.status(400).json({ error: 'فئة القطعة مطلوبة' });
        }
      } else {
        // whole motorcycle for sale: compatible_model/compatible_year_from
        // store the bike's own model/year (not a "compatible with" reference).
        if (!compatible_model || !compatible_year_from) {
          return res.status(400).json({ error: 'موديل الدراجة وسنة الصنع مطلوبة' });
        }
        if (!damage_severity || !DAMAGE_LEVELS.includes(damage_severity)) {
          return res.status(400).json({ error: 'درجة التلف مطلوبة' });
        }
        finalDamageSeverity = damage_severity;
        finalPartCategory = null;
        finalYearTo = null;
      }
    } else {
      // spare_part (car parts) — original Phase 1 flow, unchanged.
      if (!finalPartCategory || !PART_CATEGORIES.includes(finalPartCategory)) {
        return res.status(400).json({ error: 'فئة قطعة غير صالحة' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO listings
          (seller_id, category, listing_type, title, description, country, city, price, currency,
           part_category, compatible_make, compatible_model, compatible_year_from, compatible_year_to, damage_severity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          req.userId,
          effectiveCategory,
          effectiveListingType,
          title,
          description || null,
          PHASE1_COUNTRY,
          city,
          priceNum,
          PHASE1_CURRENCY,
          finalPartCategory,
          finalMake,
          finalModel,
          finalYearFrom,
          finalYearTo,
          finalDamageSeverity,
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
