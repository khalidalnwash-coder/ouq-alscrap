// Auto-archival policy sweep (spec Section 15), driven off listings.last_updated_at.
// Called on an interval from index.js, and also exposed as a manual admin
// trigger (POST /api/admin/run-archival) for testing/ops. Idempotent —
// safe to run as often as needed, each step only touches rows in the
// relevant state so re-running mid-sweep never double-applies an action.

const { pool } = require('../db');
const { deleteImage } = require('../utils/storage');
const { ARCHIVE_WARNING_DAYS, ARCHIVE_DAYS, HARD_DELETE_DAYS_AFTER_ARCHIVE } = require('../utils/constants');

async function runArchivalSweep() {
  // Day 45: raise the "update within 15 days or it will be archived" reminder
  // once per listing (archive_warning_sent_at guards against re-firing).
  // Phase 1 has no real push-notification backend wired up (see Section 3's
  // implementation note — even the signup "enable notifications" prompt is
  // permission-only), so this is surfaced in-app instead: the flag drives a
  // days-remaining countdown banner on the trader's own "إعلاناتي" screen.
  const warned = await pool.query(
    `UPDATE listings SET archive_warning_sent_at = now()
     WHERE status = 'active' AND archive_warning_sent_at IS NULL
       AND last_updated_at < now() - ($1 || ' days')::interval
     RETURNING id`,
    [ARCHIVE_WARNING_DAYS]
  );

  // Day 60: hide from search (status != 'active' already excludes it from
  // every listings query) and flip to 'archived'.
  const archived = await pool.query(
    `UPDATE listings SET status = 'archived', archived_at = now()
     WHERE status = 'active' AND last_updated_at < now() - ($1 || ' days')::interval
     RETURNING id`,
    [ARCHIVE_DAYS]
  );

  // Day 60 + 90 more days with no restore action: hard-delete the listing
  // and all associated media permanently.
  const toDelete = await pool.query(
    `SELECT id FROM listings WHERE status = 'archived'
       AND archived_at < now() - ($1 || ' days')::interval`,
    [HARD_DELETE_DAYS_AFTER_ARCHIVE]
  );
  for (const row of toDelete.rows) {
    const mediaRes = await pool.query(
      'SELECT original_url, thumbnail_url FROM listing_media WHERE listing_id = $1',
      [row.id]
    );
    for (const m of mediaRes.rows) {
      deleteImage({ originalUrl: m.original_url, thumbnailUrl: m.thumbnail_url });
    }
    await pool.query('DELETE FROM listings WHERE id = $1', [row.id]); // cascades listing_media
  }

  return { warned: warned.rowCount, archived: archived.rowCount, hard_deleted: toDelete.rows.length };
}

module.exports = { runArchivalSweep };
