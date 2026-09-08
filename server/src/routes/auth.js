const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { generateOtp, otpExpiry, sendOtpMock } = require('../utils/otp');
const { serializeUser } = require('../utils/serialize');
const { PHASE1_COUNTRY } = require('../utils/constants');
const { asyncHandler } = require('../utils/asyncHandler');

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
    if (password.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
    }
    if (pledge_accepted !== true) {
      return res.status(400).json({ error: 'يجب الموافقة على التعهد للمتابعة' });
    }
    if (!['whatsapp', 'email'].includes(otp_channel)) {
      return res.status(400).json({ error: 'اختر طريقة استلام كود التحقق' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
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
        email,
        passwordHash,
        age || null,
        PHASE1_COUNTRY,
        otp_channel,
        code,
        otpExpiry(),
      ]
    );
    const user = result.rows[0];

    const destination = otp_channel === 'whatsapp' ? `${phone_country_code}${phone_number}` : email;
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

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: 'أدخل البريد/الجوال وكلمة المرور' });
    }
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR phone_number = $1',
      [identifier]
    );
    const user = result.rows[0];
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
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR phone_number = $1',
      [identifier]
    );
    const user = result.rows[0];
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

module.exports = router;
