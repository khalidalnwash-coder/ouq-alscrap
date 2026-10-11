const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { generateOtp, otpExpiry, sendOtpMock } = require('../utils/otp');
const { serializeUser } = require('../utils/serialize');
const { COUNTRIES, COUNTRY_PHONE_CODE } = require('../utils/constants');
const { asyncHandler } = require('../utils/asyncHandler');
const { deleteImage, deleteVideo } = require('../utils/storage');

const router = express.Router();

const PLEDGE_TEXT =
  'أتعهد بالله، واستحضاراً لقول الله تعالى "وَقُل اعمَلوا فَسَيَرَى اللَّهُ عَمَلَكُم"، أن أكون أميناً في سعيي وأدفع عمولة التطبيق (2.5%) عند إتمام أي صفقة عن طريق المنصة، وإن لم أفعل فأتصدق بمثل هذا المبلغ';

router.get('/pledge-text', (_req, res) => res.json({ text: PLEDGE_TEXT }));

router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const {
      full_name,
      account_type,
      phone_country_code,
      phone_number,
      email,
      age,
      country,
      password,
      pledge_accepted,
      otp_channel,
    } = req.body || {};

    if (!full_name || !account_type || !phone_country_code || !phone_number || !email || !password) {
      return res.status(400).json({ error: 'الرجاء تعبئة كل الحقول المطلوبة' });
    }
    if (!['trader', 'individual'].includes(account_type)) {
      return res.status(400).json({ error: 'نوع حساب غير صالح' });
    }
    if (!COUNTRIES.includes(country)) {
      return res.status(400).json({ error: 'اختر الدولة' });
    }
    if (!Object.values(COUNTRY_PHONE_CODE).includes(phone_country_code)) {
      return res.status(400).json({ error: 'مفتاح جوال غير صالح' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
    }
    if (pledge_accepted !== true) {
      return res.status(400).json({ error: 'يجب الموافقة على التعهد للمتابعة' });
    }
    if (!['whatsapp', 'email'].includes(otp_channel)) {
      return res.status(400).json({ error: 'اختر طريقة استلام كود التحقق' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1', [normalizedEmail]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجّل مسبقاً' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const code = generateOtp();

    const result = await pool.query(
      `INSERT INTO users
        (full_name, account_type, phone_country_code, phone_number, email, password_hash, age, country,
         pledge_accepted_at, otp_channel, otp_code, otp_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9,$10,$11)
       RETURNING *`,
      [
        full_name,
        account_type,
        phone_country_code,
        phone_number,
        normalizedEmail,
        passwordHash,
        age || null,
        country,
        otp_channel,
        code,
        otpExpiry(),
      ]
    );
    const user = result.rows[0];

    const destination = otp_channel === 'whatsapp' ? `${phone_country_code}${phone_number}` : normalizedEmail;
    sendOtpMock({ channel: otp_channel, destination, code });

    res.status(201).json({
      user_id: user.id,
      otp_channel,
      otp_destination: destination,
      // Phase-1 decision: OTP delivery is fully mocked, no real provider wired up yet.
      // The code is returned here (and logged server-side) instead of being sent for real.
      dev_otp_code: code,
    });
  })
);

async function findByUserId(userId) {
  const r = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return r.rows[0];
}

// Email lookups must ignore case/whitespace everywhere (signup existence
// check, login, forgot-password) so the same address always resolves to the
// same account regardless of how it's typed. LOWER(TRIM(email)) on the
// column side handles rows already stored with mixed case or stray spaces
// from before this normalization existed — no backfill/migration needed,
// and no existing account is touched. Phone-number matching stays exact
// (trimmed only): phone numbers have no case, and identifier here may be
// either an email or a phone number.
async function findUserByIdentifier(identifier) {
  const trimmed = (identifier || '').trim();
  const r = await pool.query(
    'SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER($1) OR phone_number = $1',
    [trimmed]
  );
  return r.rows[0];
}

router.post(
  '/otp/resend',
  asyncHandler(async (req, res) => {
    const { user_id } = req.body || {};
    const user = await findByUserId(user_id);
    if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });

    const code = generateOtp();
    await pool.query('UPDATE users SET otp_code=$1, otp_expires_at=$2 WHERE id=$3', [
      code,
      otpExpiry(),
      user.id,
    ]);
    const destination = user.otp_channel === 'whatsapp' ? `${user.phone_country_code}${user.phone_number}` : user.email;
    sendOtpMock({ channel: user.otp_channel, destination, code });

    res.json({ ok: true, dev_otp_code: code });
  })
);

router.post(
  '/otp/verify',
  asyncHandler(async (req, res) => {
    const { user_id, code } = req.body || {};
    const user = await findByUserId(user_id);
    if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });
    if (user.verified_at) return res.status(400).json({ error: 'الحساب مفعّل مسبقاً' });
    if (!user.otp_code || user.otp_code !== code) {
      return res.status(400).json({ error: 'كود التحقق غير صحيح' });
    }
    if (new Date(user.otp_expires_at) < new Date()) {
      return res.status(400).json({ error: 'انتهت صلاحية الكود، اطلب كوداً جديداً' });
    }

    const result = await pool.query(
      `UPDATE users SET verified_at = now(), otp_verified_channel = otp_channel,
         otp_code = NULL, otp_expires_at = NULL
       WHERE id = $1 RETURNING *`,
      [user.id]
    );
    const updated = result.rows[0];
    const token = signToken(updated);
    res.json({ token, user: serializeUser(updated) });
  })
);

router.patch(
  '/notifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const enabled = !!(req.body && req.body.enabled);
    const result = await pool.query(
      'UPDATE users SET notifications_enabled = $1 WHERE id = $2 RETURNING *',
      [enabled, req.userId]
    );
    res.json({ user: serializeUser(result.rows[0]) });
  })
);

router.patch(
  '/phone-visibility',
  requireAuth,
  asyncHandler(async (req, res) => {
    const visible = !!(req.body && req.body.visible);
    const result = await pool.query(
      'UPDATE users SET phone_visible = $1 WHERE id = $2 RETURNING *',
      [visible, req.userId]
    );
    res.json({ user: serializeUser(result.rows[0]) });
  })
);

router.patch(
  '/accept-terms',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      'UPDATE users SET terms_accepted_at = now() WHERE id = $1 RETURNING *',
      [req.userId]
    );
    res.json({ user: serializeUser(result.rows[0]) });
  })
);

// PATCH /api/auth/profile — the two non-sensitive edit-account fields
// (name, city): applied immediately, no OTP. Phone and email go through
// /profile/verify-request + /profile/verify-confirm below instead.
router.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { full_name, city } = req.body || {};
    const updates = [];
    const params = [];
    if (full_name !== undefined) {
      if (!full_name.trim()) return res.status(400).json({ error: 'الاسم مطلوب' });
      params.push(full_name.trim());
      updates.push(`full_name = $${params.length}`);
    }
    if (city !== undefined) {
      params.push(city ? city.trim() : null);
      updates.push(`city = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'لا يوجد تعديل لحفظه' });
    params.push(req.userId);
    const result = await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    res.json({ user: serializeUser(result.rows[0]) });
  })
);

// POST /api/auth/profile/verify-request — stage a phone and/or email change
// and send an OTP to confirm it, exactly like signup's OTP step. Accepts
// either or both at once (one shared code confirms whichever is pending).
router.post(
  '/profile/verify-request',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { phone_country_code, phone_number, email, otp_channel } = req.body || {};
    if (!phone_number && !email) {
      return res.status(400).json({ error: 'أدخل رقم جوال أو بريد إلكتروني جديد' });
    }
    if (phone_number && !phone_country_code) {
      return res.status(400).json({ error: 'مفتاح الجوال مطلوب' });
    }
    if (phone_country_code && !Object.values(COUNTRY_PHONE_CODE).includes(phone_country_code)) {
      return res.status(400).json({ error: 'مفتاح جوال غير صالح' });
    }
    if (!['whatsapp', 'email'].includes(otp_channel)) {
      return res.status(400).json({ error: 'اختر طريقة استلام كود التحقق' });
    }

    let normalizedEmail = null;
    if (email) {
      normalizedEmail = email.trim().toLowerCase();
      const existing = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 AND id != $2', [
        normalizedEmail,
        req.userId,
      ]);
      if (existing.rows[0]) return res.status(409).json({ error: 'هذا البريد الإلكتروني مستخدم بالفعل' });
    }

    const code = generateOtp();
    await pool.query(
      `UPDATE users SET otp_code=$1, otp_expires_at=$2, otp_channel=$3,
         pending_phone_country_code=$4, pending_phone_number=$5, pending_email=$6
       WHERE id=$7`,
      [code, otpExpiry(), otp_channel, phone_number ? phone_country_code : null, phone_number || null, normalizedEmail, req.userId]
    );

    const user = await findByUserId(req.userId);
    const destination =
      otp_channel === 'whatsapp'
        ? phone_number
          ? `${phone_country_code}${phone_number}`
          : `${user.phone_country_code}${user.phone_number}`
        : normalizedEmail || user.email;
    sendOtpMock({ channel: otp_channel, destination, code });

    res.json({ otp_destination: destination, dev_otp_code: code });
  })
);

// POST /api/auth/profile/verify-confirm — apply whatever phone/email is
// currently staged, once the code sent above is verified.
router.post(
  '/profile/verify-confirm',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code } = req.body || {};
    const user = await findByUserId(req.userId);
    if (!user.otp_code || user.otp_code !== code) {
      return res.status(400).json({ error: 'كود التحقق غير صحيح' });
    }
    if (new Date(user.otp_expires_at) < new Date()) {
      return res.status(400).json({ error: 'انتهت صلاحية الكود، اطلب كوداً جديداً' });
    }
    if (!user.pending_phone_number && !user.pending_email) {
      return res.status(400).json({ error: 'لا يوجد تغيير معلّق لتأكيده' });
    }

    const updates = [
      'otp_code = NULL',
      'otp_expires_at = NULL',
      'pending_phone_country_code = NULL',
      'pending_phone_number = NULL',
      'pending_email = NULL',
    ];
    const params = [];
    if (user.pending_phone_number) {
      params.push(user.pending_phone_country_code);
      updates.push(`phone_country_code = $${params.length}`);
      params.push(user.pending_phone_number);
      updates.push(`phone_number = $${params.length}`);
    }
    if (user.pending_email) {
      params.push(user.pending_email);
      updates.push(`email = $${params.length}`);
    }
    params.push(req.userId);
    const result = await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    res.json({ user: serializeUser(result.rows[0]) });
  })
);

// POST /api/auth/change-password — current password re-entry required,
// same reasoning as account deletion's password re-confirmation.
router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'الرجاء تعبئة كل الحقول' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' });
    }
    const user = await findByUserId(req.userId);
    const ok = await bcrypt.compare(current_password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    const passwordHash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.userId]);
    res.json({ ok: true });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: 'أدخل البريد/الجوال وكلمة المرور' });
    }
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'الحساب موقوف' });
    if (!user.verified_at) return res.status(403).json({ error: 'الحساب غير مفعّل بعد' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

    const token = signToken(user);
    res.json({ token, user: serializeUser(user) });
  })
);

router.post(
  '/forgot-password/request',
  asyncHandler(async (req, res) => {
    const { identifier, otp_channel } = req.body || {};
    if (!['whatsapp', 'email'].includes(otp_channel)) {
      return res.status(400).json({ error: 'اختر طريقة استلام كود التحقق' });
    }
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ error: 'لا يوجد حساب بهذا البريد/الجوال' });

    const code = generateOtp();
    await pool.query('UPDATE users SET otp_code=$1, otp_expires_at=$2, otp_channel=$3 WHERE id=$4', [
      code,
      otpExpiry(),
      otp_channel,
      user.id,
    ]);
    const destination = otp_channel === 'whatsapp' ? `${user.phone_country_code}${user.phone_number}` : user.email;
    sendOtpMock({ channel: otp_channel, destination, code });

    res.json({ user_id: user.id, dev_otp_code: code, otp_destination: destination });
  })
);

router.post(
  '/forgot-password/confirm',
  asyncHandler(async (req, res) => {
    const { user_id, code, new_password } = req.body || {};
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
    }
    const user = await findByUserId(user_id);
    if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });
    if (!user.otp_code || user.otp_code !== code) {
      return res.status(400).json({ error: 'كود التحقق غير صحيح' });
    }
    if (new Date(user.otp_expires_at) < new Date()) {
      return res.status(400).json({ error: 'انتهت صلاحية الكود، اطلب كوداً جديداً' });
    }
    const passwordHash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash=$1, otp_code=NULL, otp_expires_at=NULL WHERE id=$2', [
      passwordHash,
      user.id,
    ]);
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await findByUserId(req.userId);
    if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });
    res.json({ user: serializeUser(user) });
  })
);

// DELETE /api/auth/me — self-service account deletion (right to erasure).
// Requires the current password as re-authentication before an irreversible
// action, same spirit as the listing-delete confirm() but for something far
// more consequential. Every image/video across all of the user's listings is
// removed from storage first (same cleanup DELETE /api/listings/:id and the
// archival hard-delete sweep already do), then the user row itself — which
// cascades to listings/listing_media, reports, transactions, conversations/
// messages, listing_comments and reviews per the existing FK definitions,
// so nothing is left behind.
router.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { password } = req.body || {};
    const user = await findByUserId(req.userId);
    if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });
    if (!password) return res.status(400).json({ error: 'أدخل كلمة المرور لتأكيد حذف الحساب' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });

    const listingsRes = await pool.query('SELECT id FROM listings WHERE seller_id = $1', [req.userId]);
    if (listingsRes.rows.length) {
      const mediaRes = await pool.query(
        'SELECT type, original_url, thumbnail_url, storage_key FROM listing_media WHERE listing_id = ANY($1)',
        [listingsRes.rows.map((l) => l.id)]
      );
      for (const m of mediaRes.rows) {
        if (m.type === 'video') {
          deleteVideo({ originalUrl: m.original_url, storageKey: m.storage_key });
        } else {
          deleteImage({ originalUrl: m.original_url, thumbnailUrl: m.thumbnail_url, storageKey: m.storage_key });
        }
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);
    res.json({ ok: true });
  })
);

module.exports = router;
