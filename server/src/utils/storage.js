// Media storage abstraction (spec Section 7).
//
// Two real drivers:
// - "local": disk storage under UPLOADS_DIR. Simple, but Render's free tier
//   wipes the filesystem on every deploy/restart, so this is dev-only.
// - "cloudinary": permanent external storage. Images and videos are each
//   uploaded once and a thumbnail/poster frame is derived via an on-the-fly
//   URL transformation (no second upload call).
//
// Plus a safety state, "disabled", entered automatically whenever the
// requested driver can't actually be trusted to persist uploads:
//   - STORAGE_DRIVER=cloudinary but CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET
//     are missing or blank, or
//   - NODE_ENV=production and STORAGE_DRIVER isn't "cloudinary" at all
//     (i.e. it would silently fall back to the ephemeral local disk).
// In "disabled" state, saveImage()/saveVideo() always reject with a clear
// Arabic error instead of writing to local disk — a listing with no photos
// still publishes fine, but attaching a photo/video fails loudly rather
// than disappearing on the next deploy. See storageStatus (exported below,
// no secrets in it) for what GET /api/health reports.
//
// All three states implement the same saveImage()/deleteImage()/saveVideo()/
// deleteVideo() shape, so callers (routes/listings.js, jobs/archival.js)
// never need to know which one is active.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

// Render's (and most dashboards') "paste a value into this box" UI makes it
// easy to pick up a trailing space or newline without noticing — which
// would otherwise break a strict comparison like STORAGE_DRIVER === 'local'
// silently, or send Cloudinary a credential it then rejects as wrong. Every
// env var this module reads goes through this first, so a var that's blank
// after trimming is treated the same as unset (falls back to `fallback`,
// or undefined) rather than as a present-but-empty value.
function envTrim(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  return trimmed === '' ? fallback : trimmed;
}

const requestedDriver = envTrim('STORAGE_DRIVER', 'local');
const isProduction = envTrim('NODE_ENV') === 'production';

function missingCloudinaryVars() {
  return ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter((name) => !envTrim(name));
}

// Mutated in place (never reassigned) so every module that destructured it
// at require-time — including index.js's /api/health handler — keeps
// seeing live updates, e.g. once the async Cloudinary connectivity check
// below resolves. Never holds secret values, only booleans/strings safe to
// return from a public endpoint or print to logs.
const storageStatus = { driver: requestedDriver, active: false, reason: null, cloudinaryVerified: null };

let saveImage;
let deleteImage;
let saveVideo;
let deleteVideo;
let uploadsDir;

// Shared by the real local driver and the "disabled" one — a disabled
// driver still resolves uploadsDir and can serve/delete files a previous
// deploy already saved locally (before this guard existed, or during
// local dev), it just never writes new ones.
function localDeleteFns(dir, publicBase) {
  return {
    deleteImage: function deleteImage({ originalUrl, thumbnailUrl }) {
      for (const url of [originalUrl, thumbnailUrl]) {
        if (!url) continue;
        fs.rm(path.join(dir, url.replace(publicBase, '')), { force: true }, () => {});
      }
    },
    deleteVideo: function deleteVideo({ originalUrl }) {
      if (!originalUrl) return;
      fs.rm(path.join(dir, originalUrl.replace(publicBase, '')), { force: true }, () => {});
    },
  };
}

function setupLocalDriver() {
  uploadsDir = path.resolve(envTrim('UPLOADS_DIR', './uploads'));
  const publicBase = envTrim('PUBLIC_UPLOADS_BASE_URL', '/uploads');
  const imagesDir = path.join(uploadsDir, 'images');
  const thumbsDir = path.join(uploadsDir, 'thumbs');
  const videosDir = path.join(uploadsDir, 'videos');
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(thumbsDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });

  saveImage = async function saveImage(buffer) {
    const id = crypto.randomUUID();
    const fullName = `${id}.jpg`;
    const thumbName = `${id}_thumb.jpg`;

    // Full compressed version — only loaded on the listing detail screen.
    const fullBuffer = await sharp(buffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();

    // Lightweight thumbnail — used everywhere in list/grid/search views.
    const thumbBuffer = await sharp(buffer)
      .rotate()
      .resize({ width: 150, height: 150, fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer();

    fs.writeFileSync(path.join(imagesDir, fullName), fullBuffer);
    fs.writeFileSync(path.join(thumbsDir, thumbName), thumbBuffer);

    return {
      originalUrl: `${publicBase}/images/${fullName}`,
      thumbnailUrl: `${publicBase}/thumbs/${thumbName}`,
      storageKey: null,
    };
  };

  const VIDEO_EXTENSIONS = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
  saveVideo = async function saveVideo(buffer, mimeType) {
    // No local equivalent of Cloudinary's duration detection or thumbnail
    // generation (would need ffmpeg) — this driver is dev-only, so the raw
    // file is stored as-is and duration/thumbnail are left for the caller
    // to treat as unknown.
    const id = crypto.randomUUID();
    const fileName = `${id}.${VIDEO_EXTENSIONS[mimeType] || 'mp4'}`;
    fs.writeFileSync(path.join(videosDir, fileName), buffer);
    return {
      originalUrl: `${publicBase}/videos/${fileName}`,
      thumbnailUrl: null,
      storageKey: null,
      durationSeconds: null,
    };
  };

  ({ deleteImage, deleteVideo } = localDeleteFns(uploadsDir, publicBase));
}

function setupCloudinaryDriver() {
  const cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: envTrim('CLOUDINARY_CLOUD_NAME'),
    api_key: envTrim('CLOUDINARY_API_KEY'),
    api_secret: envTrim('CLOUDINARY_API_SECRET'),
    secure: true,
  });

  saveImage = async function saveImage(buffer) {
    // The browser already resizes/compresses before upload; this transform
    // is just a server-side safety net for clients that skip it.
    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'alscrap/listings',
          resource_type: 'image',
          transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 78 }],
        },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(buffer);
    });

    // Thumbnail is a URL-transform of the same upload — no second upload call.
    const thumbnailUrl = cloudinary.url(uploaded.public_id, {
      resource_type: 'image',
      secure: true,
      version: uploaded.version,
      transformation: [{ width: 150, height: 150, crop: 'fill', quality: 70, fetch_format: 'jpg' }],
    });

    return {
      originalUrl: uploaded.secure_url,
      thumbnailUrl,
      storageKey: uploaded.public_id,
    };
  };

  deleteImage = function deleteImage({ storageKey }) {
    if (!storageKey) return; // nothing to do for media stored before this driver existed
    cloudinary.uploader.destroy(storageKey, { resource_type: 'image' }, () => {});
  };

  saveVideo = async function saveVideo(buffer) {
    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'alscrap/listings', resource_type: 'video' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(buffer);
    });

    // Poster frame via URL transform, same "no second upload" approach as images.
    const thumbnailUrl = cloudinary.url(uploaded.public_id, {
      resource_type: 'video',
      secure: true,
      version: uploaded.version,
      transformation: [{ width: 300, height: 300, crop: 'fill', quality: 70 }],
      format: 'jpg',
    });

    return {
      originalUrl: uploaded.secure_url,
      thumbnailUrl,
      storageKey: uploaded.public_id,
      // Cloudinary reports the real duration after upload — the authoritative
      // check for the 1-minute limit (the client also checks before upload,
      // but that's only a UX convenience, not something to trust).
      durationSeconds: uploaded.duration != null ? Math.round(uploaded.duration) : null,
    };
  };

  deleteVideo = function deleteVideo({ storageKey }) {
    if (!storageKey) return;
    cloudinary.uploader.destroy(storageKey, { resource_type: 'video' }, () => {});
  };

  // Fire-and-forget real connectivity check — presence of the three env
  // vars only proves they're *set*, not that they're *correct* (a typo'd
  // key/secret still "looks" configured). This is the only way to actually
  // catch that case, so its result is logged and reflected in
  // storageStatus.cloudinaryVerified for GET /api/health to report, without
  // blocking server startup on a network call.
  cloudinary.api.ping((err) => {
    if (err) {
      storageStatus.cloudinaryVerified = false;
      console.error(
        `[storage] تحذير: بيانات Cloudinary موجودة لكن تعذّر التحقق منها فعلياً (قد تكون القيم غير صحيحة): ${err.message || err}`
      );
    } else {
      storageStatus.cloudinaryVerified = true;
      console.log('[storage] تم التحقق من الاتصال بـ Cloudinary فعلياً بنجاح.');
    }
  });
}

// Entered when the requested driver can't be trusted — refuses new saves
// with a clear Arabic error instead of silently writing to Render's
// ephemeral local disk, while still serving/cleaning up whatever a
// previous deploy may have already saved there.
function setupDisabledDriver(logReason) {
  uploadsDir = path.resolve(envTrim('UPLOADS_DIR', './uploads'));
  const publicBase = envTrim('PUBLIC_UPLOADS_BASE_URL', '/uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const disabledError = () => {
    throw new Error('تخزين الصور/الفيديو غير مُفعّل حالياً على الخادم — تواصل مع الدعم الفني');
  };
  saveImage = async () => disabledError();
  saveVideo = async () => disabledError();
  ({ deleteImage, deleteVideo } = localDeleteFns(uploadsDir, publicBase));

  console.error(`[storage] ${logReason}`);
}

if (requestedDriver === 'cloudinary') {
  const missing = missingCloudinaryVars();
  if (missing.length) {
    storageStatus.reason = `متغيرات Cloudinary ناقصة أو فارغة: ${missing.join(', ')}`;
    setupDisabledDriver(
      `STORAGE_DRIVER=cloudinary لكن المتغيرات التالية ناقصة أو فارغة في بيئة التشغيل: ${missing.join(', ')}. ` +
        'رفع أي صورة أو فيديو سيُرفض برسالة خطأ عربية بدل حفظه محلياً بصمت — أضف القيم الثلاث في Environment على Render ثم أعد النشر.'
    );
  } else {
    setupCloudinaryDriver();
    storageStatus.active = true;
    console.log('[storage] Cloudinary مفعّل (STORAGE_DRIVER=cloudinary) — الصور والفيديو تُحفظ بشكل دائم.');
  }
} else if (requestedDriver === 'local') {
  if (isProduction) {
    storageStatus.reason = 'STORAGE_DRIVER=cloudinary غير مضبوط في بيئة الإنتاج (NODE_ENV=production)';
    setupDisabledDriver(
      'تحذير: بيئة إنتاج (NODE_ENV=production) لكن STORAGE_DRIVER ليس "cloudinary" — أي حفظ محلي هنا يُمسح مع كل نشر جديد. ' +
        'رفع أي صورة أو فيديو سيُرفض برسالة خطأ عربية بدل حفظه محلياً بصمت. ' +
        'أضف STORAGE_DRIVER=cloudinary مع CLOUDINARY_CLOUD_NAME و CLOUDINARY_API_KEY و CLOUDINARY_API_SECRET في Environment على Render ثم أعد النشر — ' +
        'إضافة المتغيرات الثلاثة وحدها لا تكفي بدون STORAGE_DRIVER=cloudinary.'
    );
  } else {
    setupLocalDriver();
    storageStatus.active = true;
    console.log(`[storage] التخزين المحلي مفعّل (وضع التطوير، NODE_ENV=${envTrim('NODE_ENV') || 'غير محدد'}) — الملفات في ${uploadsDir}`);
  }
} else {
  throw new Error(`Storage driver "${requestedDriver}" is not implemented (supported: "local", "cloudinary").`);
}

module.exports = { saveImage, deleteImage, saveVideo, deleteVideo, uploadsDir, storageStatus };
