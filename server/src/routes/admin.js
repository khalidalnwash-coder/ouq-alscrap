const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { serializeUser } = require('../utils/serialize');
const { asyncHandler } = require('../utils/asyncHandler');
const { deleteImage, deleteVideo } = require('../utils/storage');
const { runArchivalSweep } = require('../jobs/archival');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const PAYMENT_STATUS_LABELS_AR = {
  awaiting_review: 'بانتظار التحقق',
  received: 'تم الاستلام',
  not_received: 'لم يصل',
};

async function logAdminAction(adminId, action, details) {
  await pool.query('INSERT INTO admin_actions (admin_id, action, details) VALUES ($1,$2,$3)', [
    adminId,
    action,
    details,
  ]);
}

function deleteMediaRow(m) {
  if (m.type === 'video') {
    deleteVideo({ originalUrl: m.original_url, storageKey: m.storage_key });
  } else {
    deleteImage({ originalUrl: m.original_url, thumbnailUrl: m.thumbnail_url, storageKey: m.storage_key });
  }
}

// GET /api/admin/stats — the 5 headline numbers for the dashboard overview.
// confirmed_deals_count counts distinct deals, not transaction rows: a
// listing-tied deal can have up to two rows (buyer's share + seller's
// share), collapsed by listing_id; a standalone confirmation (no listing)
// has no shared key to collapse against, so each one counts as its own
// deal. commission_due/received are grouped by currency rather than
// summed into one number — this is a GCC-wide marketplace with 6
// currencies, and adding SAR to AED would be meaningless.
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [users, activeListings, deals, due, received] = await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM users'),
      pool.query("SELECT count(*)::int AS n FROM listings WHERE status = 'active'"),
      pool.query('SELECT count(DISTINCT COALESCE(listing_id, id))::int AS n FROM transactions'),
      pool.query('SELECT currency, SUM(commission_amount)::numeric(14,2) AS total FROM transactions GROUP BY currency ORDER BY currency'),
      pool.query(
        "SELECT currency, SUM(commission_amount)::numeric(14,2) AS total FROM transactions WHERE admin_payment_status = 'received' GROUP BY currency ORDER BY currency"
      ),
    ]);
    res.json({
      users_count: users.rows[0].n,
      active_listings_count: activeListings.rows[0].n,
      confirmed_deals_count: deals.rows[0].n,
      commission_due: due.rows.map((r) => ({ currency: r.currency, total: Number(r.total) })),
      commission_received: received.rows.map((r) => ({ currency: r.currency, total: Number(r.total) })),
    });
  })
);

// GET /api/admin/users?search= — name/email search, newest first.
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const result =
      search && search.trim()
        ? await pool.query(
            'SELECT * FROM users WHERE full_name ILIKE $1 OR email ILIKE $1 ORDER BY created_at DESC LIMIT 200',
            ['%' + search.trim() + '%']
          )
        : await pool.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 200');
    res.json({ users: result.rows.map(serializeUser) });
  })
);

// GET /api/admin/users/:id/listings — every listing a user owns, any
// status (not just active — the admin needs to see the full picture).
router.get(
  '/users/:id/listings',
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT l.id, l.title, l.price, l.currency, l.status, l.created_at,
              (SELECT thumbnail_url FROM listing_media m WHERE m.listing_id = l.id ORDER BY order_index ASC LIMIT 1) AS thumbnail_url
       FROM listings l WHERE l.seller_id = $1 ORDER BY l.created_at DESC LIMIT 200`,
      [req.params.id]
    );
    res.json({ listings: result.rows.map((l) => ({ ...l, price: Number(l.price) })) });
  })
);

// GET /api/admin/users/:id/reviews — every review left ON this user as a
// seller, hidden ones included (with their hidden flag), so the admin can
// browse and toggle. This is the entry point for "hide a fake review" —
// there is no separate report flow for reviews.
router.get(
  '/users/:id/reviews',
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT rv.id, rv.rating, rv.comment, rv.hidden, rv.created_at, u.full_name AS reviewer_name
       FROM reviews rv JOIN users u ON u.id = rv.reviewer_id
       WHERE rv.seller_id = $1 ORDER BY rv.created_at DESC LIMIT 200`,
      [req.params.id]
    );
    res.json({ reviews: result.rows });
  })
);

router.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'حالة غير صالحة' });
    }
    if (req.params.id === req.userId && status === 'suspended') {
      return res.status(400).json({ error: 'لا يمكنك إيقاف حسابك الخاص' });
    }
    const result = await pool.query('UPDATE users SET status = $1 WHERE id = $2 RETURNING *', [
      status,
      req.params.id,
    ]);
    if (!result.rows[0]) return res.status(404).json({ error: 'مستخدم غير موجود' });
    await logAdminAction(
      req.userId,
      status === 'suspended' ? 'suspend_user' : 'activate_user',
      `${status === 'suspended' ? 'أوقف' : 'فعّل'} حساب ${result.rows[0].full_name} (${result.rows[0].email})`
    );
    res.json({ user: serializeUser(result.rows[0]) });
  })
);

// Report queue (spec Sections 10 & 14) — all Report records regardless of
// target_type, newest first. offender_user_id/related_listing_id are
// derived here (not stored on reports) so the dashboard can link straight
// to the reported content and act on its owner without extra round trips.
// Both come back NULL when the underlying content was already deleted.
router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const { status, target_type } = req.query;
    const clauses = [];
    const params = [];
    if (status) {
      params.push(status);
      clauses.push(`r.status = $${params.length}`);
    }
    if (target_type) {
      params.push(target_type);
      clauses.push(`r.target_type = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT r.*, u.full_name AS reporter_name,
              CASE
                WHEN r.target_type = 'listing' THEN l.title
                WHEN r.target_type = 'account' THEN tu.full_name
                ELSE lc.body
              END AS target_label,
              CASE
                WHEN r.target_type = 'listing' THEN l.seller_id
                WHEN r.target_type = 'account' THEN tu.id
                ELSE lc.author_id
              END AS offender_user_id,
              CASE
                WHEN r.target_type = 'listing' THEN r.target_id
                WHEN r.target_type = 'comment' THEN lc.listing_id
                ELSE NULL
              END AS related_listing_id
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
       LEFT JOIN listings l ON r.target_type = 'listing' AND l.id = r.target_id
       LEFT JOIN users tu ON r.target_type = 'account' AND tu.id = r.target_id
       LEFT JOIN listing_comments lc ON r.target_type = 'comment' AND lc.id = r.target_id
       ${where}
       ORDER BY r.created_at DESC LIMIT 200`,
      params
    );
    res.json({ reports: result.rows });
  })
);

// "تجاهل" — close the report with no action taken on the content/account.
router.patch(
  '/reports/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (!['pending', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'حالة غير صالحة' });
    }
    const result = await pool.query('UPDATE reports SET status = $1 WHERE id = $2 RETURNING *', [
      status,
      req.params.id,
    ]);
    if (!result.rows[0]) return res.status(404).json({ error: 'بلاغ غير موجود' });
    if (status === 'resolved') {
      await logAdminAction(req.userId, 'dismiss_report', `تجاهل بلاغاً (رقم ${result.rows[0].id.slice(0, 8)})`);
    }
    res.json({ report: result.rows[0] });
  })
);

// "حذف المحتوى" — delete the reported listing/comment (same storage
// cleanup the owner-delete route uses) and close the report in one step.
router.post(
  '/reports/:id/delete-content',
  asyncHandler(async (req, res) => {
    const reportRes = await pool.query('SELECT * FROM reports WHERE id = $1', [req.params.id]);
    const report = reportRes.rows[0];
    if (!report) return res.status(404).json({ error: 'بلاغ غير موجود' });
    if (!['listing', 'comment'].includes(report.target_type)) {
      return res.status(400).json({ error: 'لا يمكن حذف محتوى لهذا النوع من البلاغات' });
    }

    let details;
    if (report.target_type === 'listing') {
      const listingRes = await pool.query('SELECT title FROM listings WHERE id = $1', [report.target_id]);
      if (listingRes.rows[0]) {
        const mediaRes = await pool.query(
          'SELECT type, original_url, thumbnail_url, storage_key FROM listing_media WHERE listing_id = $1',
          [report.target_id]
        );
        for (const m of mediaRes.rows) deleteMediaRow(m);
        await pool.query('DELETE FROM listings WHERE id = $1', [report.target_id]);
        details = `حذف الإعلان "${listingRes.rows[0].title}" بسبب بلاغ`;
      } else {
        details = 'الإعلان المبلّغ عنه كان محذوفاً مسبقاً';
      }
    } else {
      const commentRes = await pool.query('SELECT body FROM listing_comments WHERE id = $1', [report.target_id]);
      if (commentRes.rows[0]) {
        await pool.query('DELETE FROM listing_comments WHERE id = $1', [report.target_id]);
        details = `حذف تعليقاً بسبب بلاغ: "${commentRes.rows[0].body.slice(0, 80)}"`;
      } else {
        details = 'التعليق المبلّغ عنه كان محذوفاً مسبقاً';
      }
    }

    await pool.query('UPDATE reports SET status = $1 WHERE id = $2', ['resolved', req.params.id]);
    await logAdminAction(req.userId, 'delete_reported_content', details);
    res.json({ ok: true });
  })
);

// "إيقاف الحساب" — suspend whoever is responsible for the reported
// content (resolved server-side, never trusted from the client) and close
// the report in one step.
router.post(
  '/reports/:id/suspend-offender',
  asyncHandler(async (req, res) => {
    const reportRes = await pool.query(
      `SELECT r.id,
              CASE
                WHEN r.target_type = 'listing' THEN l.seller_id
                WHEN r.target_type = 'account' THEN tu.id
                ELSE lc.author_id
              END AS offender_user_id
       FROM reports r
       LEFT JOIN listings l ON r.target_type = 'listing' AND l.id = r.target_id
       LEFT JOIN users tu ON r.target_type = 'account' AND tu.id = r.target_id
       LEFT JOIN listing_comments lc ON r.target_type = 'comment' AND lc.id = r.target_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    const report = reportRes.rows[0];
    if (!report) return res.status(404).json({ error: 'بلاغ غير موجود' });
    if (!report.offender_user_id) {
      return res.status(400).json({ error: 'تعذّر تحديد صاحب المحتوى المبلّغ عنه (ربما محذوف)' });
    }
    if (report.offender_user_id === req.userId) {
      return res.status(400).json({ error: 'لا يمكنك إيقاف حسابك الخاص' });
    }

    const userRes = await pool.query('UPDATE users SET status = $1 WHERE id = $2 RETURNING full_name, email', [
      'suspended',
      report.offender_user_id,
    ]);
    await pool.query('UPDATE reports SET status = $1 WHERE id = $2', ['resolved', req.params.id]);
    await logAdminAction(
      req.userId,
      'suspend_user',
      `أوقف حساب ${userRes.rows[0].full_name} (${userRes.rows[0].email}) بسبب بلاغ`
    );
    res.json({ ok: true });
  })
);

// Content moderation (spec Section 6 request): delete any listing or
// comment outright, independent of whether it was reported.
router.delete(
  '/listings/:id',
  asyncHandler(async (req, res) => {
    const listingRes = await pool.query('SELECT title FROM listings WHERE id = $1', [req.params.id]);
    if (!listingRes.rows[0]) return res.status(404).json({ error: 'الإعلان غير موجود' });
    const mediaRes = await pool.query(
      'SELECT type, original_url, thumbnail_url, storage_key FROM listing_media WHERE listing_id = $1',
      [req.params.id]
    );
    for (const m of mediaRes.rows) deleteMediaRow(m);
    await pool.query('DELETE FROM listings WHERE id = $1', [req.params.id]);
    await logAdminAction(req.userId, 'delete_listing', `حذف الإعلان "${listingRes.rows[0].title}"`);
    res.json({ ok: true });
  })
);

router.delete(
  '/comments/:id',
  asyncHandler(async (req, res) => {
    const commentRes = await pool.query('SELECT body FROM listing_comments WHERE id = $1', [req.params.id]);
    if (!commentRes.rows[0]) return res.status(404).json({ error: 'التعليق غير موجود' });
    await pool.query('DELETE FROM listing_comments WHERE id = $1', [req.params.id]);
    await logAdminAction(req.userId, 'delete_comment', `حذف تعليقاً: "${commentRes.rows[0].body.slice(0, 80)}"`);
    res.json({ ok: true });
  })
);

// Hide/unhide a review — keeps the row (so the one-review-per-seller rule
// still blocks the same reviewer), just excludes it from the public list
// and recomputes the seller's stored rating_avg/reviews_count to match.
router.patch(
  '/reviews/:id/hidden',
  asyncHandler(async (req, res) => {
    const { hidden } = req.body || {};
    if (typeof hidden !== 'boolean') return res.status(400).json({ error: 'قيمة غير صالحة' });

    const client = await pool.connect();
    let sellerId;
    try {
      await client.query('BEGIN');
      const reviewRes = await client.query('UPDATE reviews SET hidden = $1 WHERE id = $2 RETURNING seller_id', [
        hidden,
        req.params.id,
      ]);
      if (!reviewRes.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'تقييم غير موجود' });
      }
      sellerId = reviewRes.rows[0].seller_id;
      const agg = await client.query(
        `SELECT COALESCE(AVG(rating), 0)::numeric(2,1) AS avg, COUNT(*)::int AS cnt FROM reviews WHERE seller_id = $1 AND hidden = false`,
        [sellerId]
      );
      await client.query('UPDATE users SET rating_avg = $1, reviews_count = $2 WHERE id = $3', [
        agg.rows[0].avg,
        agg.rows[0].cnt,
        sellerId,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    await logAdminAction(req.userId, hidden ? 'hide_review' : 'unhide_review', hidden ? 'أخفى تقييماً' : 'أظهر تقييماً كان مخفياً');
    res.json({ ok: true });
  })
);

// GET /api/admin/transactions?status=&search= — every commission
// confirmation (one row per party per deal, see routes/transactions.js),
// with the responsible user's name/role resolved for display/search.
router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const { status, search } = req.query;
    const result = await pool.query(
      `SELECT * FROM (
         SELECT t.id, t.created_at, t.confirmed_at, t.deal_amount, t.currency, t.commission_amount, t.admin_payment_status,
                l.id AS listing_id, l.title AS listing_title,
                COALESCE(bu.full_name, su.full_name) AS user_name,
                COALESCE(bu.email, su.email) AS user_email,
                CASE WHEN t.buyer_id IS NOT NULL THEN 'buyer' ELSE 'seller' END AS role
         FROM transactions t
         LEFT JOIN listings l ON l.id = t.listing_id
         LEFT JOIN users bu ON bu.id = t.buyer_id
         JOIN users su ON su.id = t.seller_id
       ) tx
       WHERE ($1::text IS NULL OR tx.admin_payment_status = $1)
         AND ($2::text IS NULL OR tx.user_name ILIKE '%' || $2 || '%')
       ORDER BY tx.created_at DESC LIMIT 300`,
      [status || null, search && search.trim() ? search.trim() : null]
    );
    res.json({
      transactions: result.rows.map((t) => ({
        ...t,
        deal_amount: Number(t.deal_amount),
        commission_amount: Number(t.commission_amount),
      })),
    });
  })
);

router.patch(
  '/transactions/:id/payment-status',
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (!['awaiting_review', 'received', 'not_received'].includes(status)) {
      return res.status(400).json({ error: 'حالة غير صالحة' });
    }
    const result = await pool.query(
      'UPDATE transactions SET admin_payment_status = $1 WHERE id = $2 RETURNING commission_amount, currency',
      [status, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'معاملة غير موجودة' });
    await logAdminAction(
      req.userId,
      'update_payment_status',
      `غيّر حالة دفعة عمولة (${result.rows[0].commission_amount} ${result.rows[0].currency}) إلى "${PAYMENT_STATUS_LABELS_AR[status]}"`
    );
    res.json({ ok: true });
  })
);

// GET /api/admin/actions — the audit trail itself (who/when/what).
router.get(
  '/actions',
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT aa.id, aa.action, aa.details, aa.created_at, u.full_name AS admin_name
       FROM admin_actions aa JOIN users u ON u.id = aa.admin_id
       ORDER BY aa.created_at DESC LIMIT 200`
    );
    res.json({ actions: result.rows });
  })
);

// Manual trigger for the auto-archival sweep (spec Section 15) — the same
// sweep also runs on an interval from index.js; this exists for ops/testing
// so an admin can force it without waiting for the next tick.
router.post(
  '/run-archival',
  asyncHandler(async (_req, res) => {
    const result = await runArchivalSweep();
    res.json(result);
  })
);

module.exports = router;
