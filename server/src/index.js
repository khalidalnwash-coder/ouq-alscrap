require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const listingsRoutes = require('./routes/listings');
const usersRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const { uploadsDir } = require('./utils/storage');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof Error && err.message && err.message.includes('File too large')) {
    return res.status(413).json({ error: 'حجم الملف كبير جداً' });
  }
  res.status(500).json({ error: err.message || 'خطأ في الخادم' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`alscrap server listening on :${port}`));
