const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();
router.use(requireAuth);

const MAX_MESSAGE_LENGTH = 2000;

function conversationRow(row, userId) {
  const isBuyer = row.buyer_id === userId;
  return {
    id: row.id,
    listing_id: row.listing_id,
    listing_title: row.listing_title,
    peer_id: isBuyer ? row.seller_id : row.buyer_id,
    peer_name: isBuyer ? row.seller_name : row.buyer_name,
    last_message_body: row.last_message_body,
    last_message_at: row.last_message_body ? row.last_message_created_at : row.created_at,
    last_message_is_mine: row.last_message_sender_id === userId,
  };
}

// GET /api/conversations — every conversation the current user is a party to
// (as buyer or seller), newest activity first. Powers the "الرسائل" screen.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT c.id, c.listing_id, c.buyer_id, c.seller_id, c.created_at,
              l.title AS listing_title,
              buyer.full_name AS buyer_name, seller.full_name AS seller_name,
              lm.body AS last_message_body, lm.created_at AS last_message_created_at, lm.sender_id AS last_message_sender_id
       FROM conversations c
       JOIN listings l ON l.id = c.listing_id
       JOIN users buyer ON buyer.id = c.buyer_id
       JOIN users seller ON seller.id = c.seller_id
       LEFT JOIN LATERAL (
         SELECT body, created_at, sender_id FROM messages m
         WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1
       ) lm ON true
       WHERE c.buyer_id = $1 OR c.seller_id = $1
       ORDER BY c.last_message_at DESC`,
      [req.userId]
    );
    res.json({ conversations: result.rows.map((r) => conversationRow(r, req.userId)) });
  })
);

// POST /api/conversations — find-or-create the conversation for a listing,
// started by the current user (as buyer) with the listing's seller. This is
// what "تواصل مع البائع" calls on the listing detail screen.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { listing_id } = req.body || {};
    if (!listing_id) return res.status(400).json({ error: 'الإعلان مطلوب' });

    const listingRes = await pool.query('SELECT id, seller_id, title FROM listings WHERE id = $1', [listing_id]);
    const listing = listingRes.rows[0];
    if (!listing) return res.status(404).json({ error: 'الإعلان غير موجود' });
    if (listing.seller_id === req.userId) {
      return res.status(400).json({ error: 'لا يمكنك بدء محادثة مع نفسك على إعلانك' });
    }

    const existing = await pool.query(
      'SELECT id FROM conversations WHERE listing_id = $1 AND buyer_id = $2',
      [listing_id, req.userId]
    );
    if (existing.rows[0]) {
      return res.status(200).json({ conversation_id: existing.rows[0].id });
    }

    const created = await pool.query(
      `INSERT INTO conversations (listing_id, buyer_id, seller_id) VALUES ($1,$2,$3) RETURNING id`,
      [listing_id, req.userId, listing.seller_id]
    );
    res.status(201).json({ conversation_id: created.rows[0].id });
  })
);

async function loadConversationForParticipant(conversationId, userId) {
  const result = await pool.query(
    `SELECT c.id, c.listing_id, c.buyer_id, c.seller_id,
            l.title AS listing_title,
            buyer.full_name AS buyer_name, seller.full_name AS seller_name
     FROM conversations c
     JOIN listings l ON l.id = c.listing_id
     JOIN users buyer ON buyer.id = c.buyer_id
     JOIN users seller ON seller.id = c.seller_id
     WHERE c.id = $1`,
    [conversationId]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.buyer_id !== userId && row.seller_id !== userId) return 'forbidden';
  return row;
}

// GET /api/conversations/:id/messages — conversation header info + all
// messages in chronological order. No pagination (Phase 2 scope is simple
// text-only threads, not expected to grow unbounded).
router.get(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const convo = await loadConversationForParticipant(req.params.id, req.userId);
    if (!convo) return res.status(404).json({ error: 'المحادثة غير موجودة' });
    if (convo === 'forbidden') return res.status(403).json({ error: 'هذه المحادثة ليست لك' });

    const messagesRes = await pool.query(
      'SELECT id, sender_id, body, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );

    const isBuyer = convo.buyer_id === req.userId;
    res.json({
      conversation: {
        id: convo.id,
        listing_id: convo.listing_id,
        listing_title: convo.listing_title,
        peer_id: isBuyer ? convo.seller_id : convo.buyer_id,
        peer_name: isBuyer ? convo.seller_name : convo.buyer_name,
      },
      messages: messagesRes.rows,
    });
  })
);

// POST /api/conversations/:id/messages — send a plain-text message.
router.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const convo = await loadConversationForParticipant(req.params.id, req.userId);
    if (!convo) return res.status(404).json({ error: 'المحادثة غير موجودة' });
    if (convo === 'forbidden') return res.status(403).json({ error: 'هذه المحادثة ليست لك' });

    const body = (req.body && req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'اكتب رسالة' });
    if (body.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `الرسالة أطول من الحد المسموح (${MAX_MESSAGE_LENGTH} حرف)` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$2,$3)
         RETURNING id, sender_id, body, created_at`,
        [req.params.id, req.userId, body]
      );
      await client.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [req.params.id]);
      await client.query('COMMIT');
      res.status(201).json({ message: inserted.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
