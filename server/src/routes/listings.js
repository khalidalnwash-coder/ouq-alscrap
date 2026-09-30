const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { saveImage, deleteImage, saveVideo, deleteVideo } = require('../utils/storage');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  COUNTRIES,
  COUNTRY_LABELS,
  COUNTRY_FLAGS,
  COUNTRY_PHONE_CODE,
  COUNTRY_CURRENCY,
  COUNTRY_CITIES,
  PART_CATEGORIES,
  VEHICLE_LABELS,
  VEHICLE_CATEGORIES,
  VEHICLE_MAKES,
  VEHICLE_MODELS_BY_MAKE,
  REPORT_REASONS_LISTING,
  REPORT_REASONS_ACCOUNT,
  COMMISSION_RATE,
  BANK_ACCOUNT,
  ARCHIVE_WARNING_DAYS,
  ARCHIVE_DAYS,
  MAX_ACTIVE_LISTINGS_PER_ACCOUNT,
} = require('../utils/constants');

const router = express.Router();

const MAX_IMAGES = 10;
// The client compresses images before upload (see public/app.js), so this is
// a server-side safety net rather than the normal case — kept a bit above
// the client's own target size for uncompressed fallback uploads.
const MAX_IMAGE_MB = 8;
const MAX_VIDEOS = 1;
const MAX_VIDEO_MB = 50;
const MAX_VIDEO_DURATION_SECONDS = 60;
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'];
const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const DAMAGE_LEVELS = ['light', 'medium', 'severe'];
const CATEGORIES = ['spare_part', ...VEHICLE_CATEGORIES];
const LISTING_TYPES = ['part', 'whole'];
const BUMP_COOLDOWN_HOURS = 24;

const upload = multer({
  storage: multer.memoryStorage(),
  // One global size cap across both fields (multer has no per-field limit) —
  // set to the larger of the two since images are already client-compressed
  // well under it.
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files: MAX_IMAGES + MAX_VIDEOS },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'video') {
      if (!VIDEO_MIME_TYPES.includes(file.mimetype)) {
        return cb(new Error('صيغة الفيديو غير مدعومة (MP4 أو MOV أو WebM فقط)'));
      }
    } else if (!IMAGE_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('الصور يجب أن تكون JPG أو PNG فقط'));
    }
    cb(null, true);
  },
});
const uploadMedia = upload.fields([
  { name: 'images', maxCount: MAX_IMAGES },
  { name: 'video', maxCount: MAX_VIDEOS },
]);

function deleteMediaRow(m) {
  if (m.type === 'video') {
    deleteVideo({ originalUrl: m.original_url, storageKey: m.storage_key });
  } else {
    deleteImage({ originalUrl: m.original_url, thumbnailUrl: m.thumbnail_url, storageKey: m.storage_key });
  }
}

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
    archive_warning_sent_at: l.archive_warning_sent_at,
    archived_at: l.archived_at,
  };
}

router.get('/meta', (_req, res) => {
  res.json({
    countries: COUNTRIES.map((code) => ({
      code,
      label: COUNTRY_LABELS[code],
      flag: COUNTRY_FLAGS[code],
      currency: COUNTRY_CURRENCY[code],
      phone_code: COUNTRY_PHONE_CODE[code],
    })),
    cities_by_country: COUNTRY_CITIES,
    part_categories: PART_CATEGORIES,
    vehicle_categories: Object.fromEntries(
      VEHICLE_CATEGORIES.map((cat) => [
        cat,
        { label: VEHICLE_LABELS[cat], makes: VEHICLE_MAKES[cat], models_by_make: VEHICLE_MODELS_BY_MAKE[cat] },
      ])
    ),
    report_reasons: { listing: REPORT_REASONS_LISTING, account: REPORT_REASONS_ACCOUNT },
    commission_rate: COMMISSION_RATE,
    bank_account: BANK_ACCOUNT,
    bump_cooldown_hours: BUMP_COOLDOWN_HOURS,
    archive_warning_days: ARCHIVE_WARNING_DAYS,
    archive_days: ARCHIVE_DAYS,
  });
});

// GET /api/listings?category=&listing_type=&make=&model=&q=&part_category=&city=&country=&year=
// category defaults to 'spare_part' (the original car-parts browse/search screens
// never sent a category param, so this keeps them working unchanged). country is
// left unfiltered when omitted — cross-border search across the GCC is the point
// (spec Section 1) — the client normally passes the user's browsing country.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q, part_category, city, category, listing_type, make, model, country, year } = req.query;
    const effectiveCategory = category || 'spare_part';
    const clauses = ["status = 'active'", `category = $1`];
    const params = [effectiveCategory];

    if (country) {
      params.push(country);
      clauses.push(`country = $${params.length}`);
    }
    if (listing_type) {
      params.push(listing_type);
      clauses.push(`listing_type = $${params.length}`);
    }
    if (make) {
      params.push(make);
      clauses.push(`compatible_make = $${params.length}`);
    }
    if (model) {
      params.push(model);
      clauses.push(`compatible_model = $${params.length}`);
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
    // Year-of-manufacture search filter. Whole-vehicle listings store their
    // own year in compatible_year_from (exact match); spare-part listings
    // use compatible_year_from/to as an optional compatibility range where
    // an unset bound means "unbounded" — a part with no year specified is
    // treated as fitting any year, matching how it's presented at listing
    // time ("مطابقة سنة (اختياري)").
    const yearNum = Number(year);
    if (year && Number.isInteger(yearNum)) {
      params.push(yearNum);
      const yIdx = params.length;
      clauses.push(
        `((listing_type = 'whole' AND compatible_year_from = $${yIdx}) OR ` +
        `(listing_type = 'part' AND (compatible_year_from IS NULL OR compatible_year_from <= $${yIdx}) ` +
        `AND (compatible_year_to IS NULL OR compatible_year_to >= $${yIdx})))`
      );
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
      `SELECT id, full_name, account_type, is_verified_trader, rating_avg, completed_deals_count, created_at,
              phone_country_code, phone_number, phone_visible
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
        media: withMedia.media.map((m) => ({
          id: m.id,
          type: m.type,
          url: m.original_url,
          thumbnail_url: m.thumbnail_url,
          duration_seconds: m.duration_seconds,
        })),
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
            // Only revealed when the seller hasn't hidden it (profile setting)
            // — buyers still always have the "رسالة خاصة" chat option.
            phone: seller.phone_visible ? `${seller.phone_country_code}${seller.phone_number}` : null,
          }
        : null,
    });
  })
);

router.post(
  '/',
  requireAuth,
  uploadMedia,
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      price,
      country,
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
    if (!title || !price || !country || !city) {
      return res.status(400).json({ error: 'عنوان الإعلان والسعر والدولة والمدينة مطلوبة' });
    }
    if (!COUNTRIES.includes(country)) {
      return res.status(400).json({ error: 'دولة غير صالحة' });
    }
    if (!COUNTRY_CITIES[country].includes(city)) {
      return res.status(400).json({ error: 'اختر مدينة ضمن الدولة المحددة' });
    }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: 'سعر غير صالح' });
    }

    // Per-account cap on total active listings (spec Section 15 — storage-abuse guard).
    const activeCountRes = await pool.query(
      "SELECT count(*)::int AS n FROM listings WHERE seller_id = $1 AND status = 'active'",
      [req.userId]
    );
    if (activeCountRes.rows[0].n >= MAX_ACTIVE_LISTINGS_PER_ACCOUNT) {
      return res.status(400).json({
        error: `وصلت للحد الأقصى لعدد الإعلانات النشطة (${MAX_ACTIVE_LISTINGS_PER_ACCOUNT}) — احذف أو أرشف إعلاناً قديماً لإضافة جديد`,
      });
    }

    let effectiveListingType = 'part';
    let finalMake = compatible_make || null;
    let finalModel = compatible_model || null;
    let finalYearFrom = compatible_year_from ? Number(compatible_year_from) : null;
    let finalYearTo = compatible_year_to ? Number(compatible_year_to) : null;
    let finalPartCategory = part_category || null;
    let finalDamageSeverity = null;

    if (VEHICLE_CATEGORIES.includes(effectiveCategory)) {
      if (!LISTING_TYPES.includes(listing_type)) {
        return res.status(400).json({ error: 'نوع الإعلان (قطعة / مركبة كاملة) مطلوب' });
      }
      effectiveListingType = listing_type;

      // The manufacturer (and model) grids are a selection convenience on the
      // client; 'أخرى' there prompts the user for a custom name before ever
      // calling this endpoint, so by the time a listing is created
      // compatible_make/compatible_model are just normal free-text values —
      // same as they already are for car parts (spare_part).
      if (!compatible_make || !compatible_make.trim()) {
        return res.status(400).json({ error: 'الشركة المصنّعة مطلوبة' });
      }
      finalMake = compatible_make.trim();

      if (effectiveListingType === 'part') {
        if (!finalPartCategory || !PART_CATEGORIES.includes(finalPartCategory)) {
          return res.status(400).json({ error: 'فئة القطعة مطلوبة' });
        }
      } else {
        // whole vehicle for sale: compatible_model/compatible_year_from store
        // the vehicle's own model/year (not a "compatible with" reference).
        if (!compatible_model || !compatible_year_from) {
          return res.status(400).json({ error: 'الموديل وسنة الصنع مطلوبة' });
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
          country,
          city,
          priceNum,
          COUNTRY_CURRENCY[country],
          finalPartCategory,
          finalMake,
          finalModel,
          finalYearFrom,
          finalYearTo,
          finalDamageSeverity,
        ]
      );
      const listing = result.rows[0];

      const imageFiles = (req.files && req.files.images) || [];
      let orderIndex = 0;
      for (const file of imageFiles) {
        const { originalUrl, thumbnailUrl, storageKey } = await saveImage(file.buffer);
        await client.query(
          `INSERT INTO listing_media (listing_id, type, original_url, thumbnail_url, storage_key, order_index)
           VALUES ($1,'image',$2,$3,$4,$5)`,
          [listing.id, originalUrl, thumbnailUrl, storageKey || null, orderIndex++]
        );
      }

      const videoFile = req.files && req.files.video && req.files.video[0];
      if (videoFile) {
        const { originalUrl, thumbnailUrl, storageKey, durationSeconds } = await saveVideo(videoFile.buffer, videoFile.mimetype);
        // Client also checks duration before upload, but that's only a UX
        // convenience — Cloudinary's returned duration is the real check.
        // The local driver can't report a duration (durationSeconds stays
        // null there), so nothing to enforce in dev.
        if (durationSeconds != null && durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
          deleteVideo({ storageKey });
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'مدة الفيديو يجب ألا تتجاوز دقيقة واحدة' });
        }
        await client.query(
          `INSERT INTO listing_media (listing_id, type, original_url, thumbnail_url, storage_key, duration_seconds, order_index)
           VALUES ($1,'video',$2,$3,$4,$5,$6)`,
          [listing.id, originalUrl, thumbnailUrl, storageKey || null, durationSeconds, orderIndex++]
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

// PATCH /api/listings/:id/bump — spec Section 8, the free daily "حدّث الآن"
// mechanic (explicitly replaces any pay-to-promote feature at launch). The
// 24h cooldown is re-validated server-side, never trusted from the client
// button's disabled state.
router.patch(
  '/:id/bump',
  requireAuth,
  asyncHandler(async (req, res) => {
    const listingRes = await pool.query('SELECT seller_id, status, last_updated_at FROM listings WHERE id = $1', [
      req.params.id,
    ]);
    const listing = listingRes.rows[0];
    if (!listing) return res.status(404).json({ error: 'الإعلان غير موجود' });
    if (listing.seller_id !== req.userId) return res.status(403).json({ error: 'هذا الإعلان ليس لك' });
    if (listing.status !== 'active') return res.status(400).json({ error: 'لا يمكن تحديث إعلان غير نشط' });

    const hoursSinceUpdate = (Date.now() - new Date(listing.last_updated_at).getTime()) / 3600000;
    if (hoursSinceUpdate < BUMP_COOLDOWN_HOURS) {
      return res.status(400).json({ error: `التحديث متاح بعد ${Math.ceil(BUMP_COOLDOWN_HOURS - hoursSinceUpdate)} س` });
    }

    const result = await pool.query(
      `UPDATE listings SET last_updated_at = now(), archive_warning_sent_at = NULL
       WHERE id = $1 RETURNING last_updated_at`,
      [req.params.id]
    );
    res.json({ last_updated_at: result.rows[0].last_updated_at });
  })
);

// PATCH /api/listings/:id/restore — spec Section 13/15: an archived listing
// keeps a manual "استرجاع" (restore) action available until the hard-delete
// sweep removes it permanently.
router.patch(
  '/:id/restore',
  requireAuth,
  asyncHandler(async (req, res) => {
    const listingRes = await pool.query('SELECT seller_id, status FROM listings WHERE id = $1', [req.params.id]);
    const listing = listingRes.rows[0];
    if (!listing) return res.status(404).json({ error: 'الإعلان غير موجود' });
    if (listing.seller_id !== req.userId) return res.status(403).json({ error: 'هذا الإعلان ليس لك' });
    if (listing.status !== 'archived') return res.status(400).json({ error: 'الإعلان غير مؤرشف' });

    await pool.query(
      `UPDATE listings
       SET status = 'active', last_updated_at = now(), archived_at = NULL, archive_warning_sent_at = NULL
       WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  })
);

// DELETE /api/listings/:id — the owner removes their own listing entirely,
// same cleanup the 90-day auto hard-delete sweep already does (see
// jobs/archival.js), just triggered on demand instead of by the timer:
// every image/video is removed from storage, then the row itself (which
// cascades to listing_media/conversations/messages/transactions tied to it,
// per the existing FK definitions — unchanged, pre-existing behavior).
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const listingRes = await pool.query('SELECT seller_id FROM listings WHERE id = $1', [req.params.id]);
    const listing = listingRes.rows[0];
    if (!listing) return res.status(404).json({ error: 'الإعلان غير موجود' });
    if (listing.seller_id !== req.userId) return res.status(403).json({ error: 'هذا الإعلان ليس لك' });

    const mediaRes = await pool.query(
      'SELECT type, original_url, thumbnail_url, storage_key FROM listing_media WHERE listing_id = $1',
      [req.params.id]
    );
    for (const m of mediaRes.rows) deleteMediaRow(m);

    await pool.query('DELETE FROM listings WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

// PATCH /api/listings/:id — edit the owner's own listing. Deliberately
// narrow scope: title/description/price and images/video only — never
// category, compat fields, or country/city (those drive which screens and
// filters a listing shows under, and changing them mid-life is out of
// scope here). A new video always replaces any existing one (one video
// slot per listing); images are removed via remove_media_ids and/or added
// via the same "images"/"video" fields the create flow uses.
router.patch(
  '/:id',
  requireAuth,
  uploadMedia,
  asyncHandler(async (req, res) => {
    const listingRes = await pool.query('SELECT seller_id FROM listings WHERE id = $1', [req.params.id]);
    const listing = listingRes.rows[0];
    if (!listing) return res.status(404).json({ error: 'الإعلان غير موجود' });
    if (listing.seller_id !== req.userId) return res.status(403).json({ error: 'هذا الإعلان ليس لك' });

    const { title, description, price, remove_media_ids } = req.body || {};

    const updates = [];
    const params = [];
    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ error: 'عنوان الإعلان مطلوب' });
      params.push(title.trim());
      updates.push(`title = $${params.length}`);
    }
    if (description !== undefined) {
      params.push(description.trim() || null);
      updates.push(`description = $${params.length}`);
    }
    if (price !== undefined) {
      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        return res.status(400).json({ error: 'سعر غير صالح' });
      }
      params.push(priceNum);
      updates.push(`price = $${params.length}`);
    }

    let removeIds = [];
    if (remove_media_ids) {
      try {
        removeIds = JSON.parse(remove_media_ids);
        if (!Array.isArray(removeIds)) throw new Error('not an array');
      } catch {
        return res.status(400).json({ error: 'صيغة الصور المطلوب حذفها غير صالحة' });
      }
    }

    const imageFiles = (req.files && req.files.images) || [];
    const videoFile = req.files && req.files.video && req.files.video[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (updates.length) {
        params.push(req.params.id);
        await client.query(`UPDATE listings SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
      }

      const mediaRes = await client.query(
        'SELECT id, type, original_url, thumbnail_url, storage_key, order_index FROM listing_media WHERE listing_id = $1 ORDER BY order_index ASC',
        [req.params.id]
      );
      const existingMedia = mediaRes.rows;

      const existingIds = new Set(existingMedia.map((m) => m.id));
      for (const id of removeIds) {
        if (!existingIds.has(id)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'صورة/فيديو غير موجود ضمن هذا الإعلان' });
        }
      }

      const removeIdSet = new Set(removeIds);
      // A newly uploaded video always replaces any existing one, regardless
      // of whether the client also listed the old one in remove_media_ids.
      const existingVideo = existingMedia.find((m) => m.type === 'video');
      if (videoFile && existingVideo) removeIdSet.add(existingVideo.id);

      const toRemove = existingMedia.filter((m) => removeIdSet.has(m.id));
      const remainingImagesCount = existingMedia.filter((m) => m.type === 'image' && !removeIdSet.has(m.id)).length;
      if (remainingImagesCount + imageFiles.length > MAX_IMAGES) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `الحد الأقصى ${MAX_IMAGES} صور` });
      }

      if (toRemove.length) {
        await client.query('DELETE FROM listing_media WHERE id = ANY($1)', [toRemove.map((m) => m.id)]);
      }

      let orderIndex = existingMedia.reduce((max, m) => Math.max(max, m.order_index), -1) + 1;
      for (const file of imageFiles) {
        const { originalUrl, thumbnailUrl, storageKey } = await saveImage(file.buffer);
        await client.query(
          `INSERT INTO listing_media (listing_id, type, original_url, thumbnail_url, storage_key, order_index)
           VALUES ($1,'image',$2,$3,$4,$5)`,
          [req.params.id, originalUrl, thumbnailUrl, storageKey || null, orderIndex++]
        );
      }

      if (videoFile) {
        const { originalUrl, thumbnailUrl, storageKey, durationSeconds } = await saveVideo(videoFile.buffer, videoFile.mimetype);
        if (durationSeconds != null && durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
          deleteVideo({ storageKey });
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'مدة الفيديو يجب ألا تتجاوز دقيقة واحدة' });
        }
        await client.query(
          `INSERT INTO listing_media (listing_id, type, original_url, thumbnail_url, storage_key, duration_seconds, order_index)
           VALUES ($1,'video',$2,$3,$4,$5,$6)`,
          [req.params.id, originalUrl, thumbnailUrl, storageKey || null, durationSeconds, orderIndex++]
        );
      }

      await client.query('COMMIT');

      // Best-effort cleanup of removed media's storage files, done after
      // commit so a storage hiccup never rolls back an otherwise-successful edit.
      for (const m of toRemove) deleteMediaRow(m);

      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
