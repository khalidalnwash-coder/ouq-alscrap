// Media storage abstraction (spec Section 7).
//
// Two drivers:
// - "local": disk storage under UPLOADS_DIR. Simple, but Render's free tier
//   wipes the filesystem on every deploy/restart, so this is dev-only.
// - "cloudinary": permanent external storage. Images are uploaded once and a
//   thumbnail is derived via an on-the-fly URL transformation (no second
//   upload call), and the same account/API also handles video uploads
//   unchanged when that's added later.
//
// Both drivers implement the same saveImage()/deleteImage() shape, so
// callers (routes/listings.js, jobs/archival.js) never need to know which
// one is active.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const driver = process.env.STORAGE_DRIVER || 'local';

let saveImage;
let deleteImage;
let uploadsDir;

if (driver === 'local') {
  uploadsDir = path.resolve(process.env.UPLOADS_DIR || './uploads');
  const publicBase = process.env.PUBLIC_UPLOADS_BASE_URL || '/uploads';

  const imagesDir = path.join(uploadsDir, 'images');
  const thumbsDir = path.join(uploadsDir, 'thumbs');
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(thumbsDir, { recursive: true });

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

  deleteImage = function deleteImage({ originalUrl, thumbnailUrl }) {
    for (const url of [originalUrl, thumbnailUrl]) {
      if (!url) continue;
      const filePath = path.join(uploadsDir, url.replace(publicBase, ''));
      fs.rm(filePath, { force: true }, () => {});
    }
  };
} else if (driver === 'cloudinary') {
  const cloudinary = require('cloudinary').v2;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error(
      'STORAGE_DRIVER=cloudinary requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to be set'
    );
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
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

    // Thumbnail is a URL-transform of the same upload — no second upload call,
    // and it keeps working unchanged when a video type is added later.
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
} else {
  throw new Error(`Storage driver "${driver}" is not implemented (supported: "local", "cloudinary").`);
}

module.exports = { saveImage, deleteImage, uploadsDir };
