// Media storage abstraction (spec Section 7).
// Phase-1 decision (confirmed with product owner): store on local disk under
// UPLOADS_DIR, not S3 — no cloud credentials available yet. Every image still
// gets compressed + a dedicated thumbnail generated server-side, exactly as
// the spec requires, so switching STORAGE_DRIVER to "s3" in Phase 2 is a
// drop-in swap of saveBuffer() below — no caller changes needed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const driver = process.env.STORAGE_DRIVER || 'local';
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || './uploads');
const publicBase = process.env.PUBLIC_UPLOADS_BASE_URL || '/uploads';

const imagesDir = path.join(uploadsDir, 'images');
const thumbsDir = path.join(uploadsDir, 'thumbs');
fs.mkdirSync(imagesDir, { recursive: true });
fs.mkdirSync(thumbsDir, { recursive: true });

if (driver !== 'local') {
  throw new Error(`Storage driver "${driver}" is not implemented yet (Phase 1 only supports "local").`);
}

async function saveImage(buffer) {
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
  };
}

function deleteImage({ originalUrl, thumbnailUrl }) {
  for (const url of [originalUrl, thumbnailUrl]) {
    if (!url) continue;
    const filePath = path.join(uploadsDir, url.replace(publicBase, ''));
    fs.rm(filePath, { force: true }, () => {});
  }
}

module.exports = { saveImage, deleteImage, uploadsDir };
