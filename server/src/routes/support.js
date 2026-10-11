const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { saveImage } = require('../utils/storage');
const { asyncHandler } = require('../utils/asyncHandler');
const { SUPPORT_ISSUE_TYPES } = require('../utils/constants');

const router = express.Router();

const ISSUE_TYPE_VALUES = SUPPORT_ISSUE_TYPES.map((t) => t.value);
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'];
const MAX_IMAGE_MB = 8;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('الصورة يجب أن تكون JPG أو PNG فقط'));
    }
    cb(null, true);
  },
});

// POST /api/support — submit a support ticket (reaches the admin dashboard's
// "رسائل الدعم" tab). Image is optional, same compression pipeline as
// listing photos.
router.post(
  '/',
  requireAuth,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const { issue_type, description } = req.body || {};
    if (!ISSUE_TYPE_VALUES.includes(issue_type)) {
      return res.status(400).json({ error: 'اختر نوع المشكلة' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'اكتب وصف المشكلة' });
    }

    let imageUrl = null;
    let imageStorageKey = null;
    if (req.file) {
      const { originalUrl, storageKey } = await saveImage(req.file.buffer);
      imageUrl = originalUrl;
      imageStorageKey = storageKey || null;
    }

    const result = await pool.query(
      `INSERT INTO support_messages (user_id, issue_type, description, image_url, image_storage_key)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.userId, issue_type, description.trim(), imageUrl, imageStorageKey]
    );
    res.status(201).json({ message: result.rows[0] });
  })
);

// GET /api/support/mine — the current user's own tickets, including any
// admin reply, newest first. This is how a reply "reaches the user inside
// the app" — same loads-fresh-on-open pattern as messaging/comments, no
// push notifications exist yet.
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      'SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.userId]
    );
    res.json({ messages: result.rows });
  })
);

module.exports = router;
