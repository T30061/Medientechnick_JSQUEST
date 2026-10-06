require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const Database = require('better-sqlite3');
const express = require('express');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const helmet = require('helmet');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const XP_PER_LESSON = 25;
const LESSON_IDS = new Set([
  'syntax', 'variablen', 'datentypen', 'operatoren', 'bedingungen', 'schleifen',
  'funktionen', 'arrays', 'array-methoden', 'objekte', 'sets-maps', 'dom',
  'events', 'formulare', 'uebung', 'zeichenketten', 'zeit-math', 'speicher',
  'asynchron', 'module', 'debugging'
]);

if (IS_PRODUCTION && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('In Produktion muss SESSION_SECRET gesetzt sein (mindestens 32 Zeichen).');
}

const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(ROOT, 'data', 'js-studio.sqlite'));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS lesson_progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, lesson_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
`);

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.data));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, data, callback = () => {}) {
    try {
      const expiry = data.cookie?.expires ? new Date(data.cookie.expires).getTime() : Date.now() + SESSION_MAX_AGE;
      db.prepare(`INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`)
        .run(sid, JSON.stringify(data), expiry);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, data, callback = () => {}) {
    try {
      const expiry = data.cookie?.expires ? new Date(data.cookie.expires).getTime() : Date.now() + SESSION_MAX_AGE;
      db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(expiry, sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

const app = express();
if (IS_PRODUCTION) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com']
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '10kb', type: 'application/json' }));
app.use(session({
  name: 'jsstudio.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex'),
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Zu viele Versuche. Bitte warte 15 Minuten und versuche es erneut.' }
});
const csrfToken = () => crypto.randomBytes(32).toString('base64url');
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const getUser = (id) => db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(id);

function requireCsrf(req, res, next) {
  const supplied = req.get('X-CSRF-Token');
  const expected = req.session.csrfToken;
  if (!supplied || !expected || supplied !== expected) {
    return res.status(403).json({ error: 'Sitzung abgelaufen. Lade die Seite neu und versuche es erneut.' });
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Bitte melde dich an.' });
  const user = getUser(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Sitzung ungültig. Bitte melde dich erneut an.' });
  }
  req.user = user;
  next();
}

function regenerateSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.userId = userId;
      req.session.csrfToken = csrfToken();
      req.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
  });
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt, hash: derived.toString('base64url') };
}

async function verifyPassword(password, salt, expectedHash) {
  const actual = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(expectedHash, 'base64url');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

app.get('/api/auth/csrf', (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = csrfToken();
  res.set('Cache-Control', 'no-store');
  res.json({ csrfToken: req.session.csrfToken });
});

app.get('/api/auth/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = req.session.userId ? getUser(req.session.userId) : null;
  res.json({ user: user || null });
});

app.post('/api/auth/register', authLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Gib eine gültige E-Mail-Adresse ein.' });
  }
  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: 'Das Passwort muss mindestens 12 und höchstens 128 Zeichen lang sein.' });
  }

  const { salt, hash } = await hashPassword(password);
  const id = crypto.randomUUID();
  try {
    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, email, `scrypt$${salt}$${hash}`);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Für diese E-Mail-Adresse gibt es bereits ein Konto. Melde dich stattdessen an.' });
    }
    throw error;
  }
  await regenerateSession(req, id);
  res.status(201).json({ user: getUser(id), csrfToken: req.session.csrfToken });
}));

app.post('/api/auth/login', authLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const record = db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ? COLLATE NOCASE').get(email);
  let valid = false;
  if (record && password.length <= 128) {
    const [, salt, expectedHash] = record.password_hash.split('$');
    valid = await verifyPassword(password, salt, expectedHash);
  }
  if (!valid) return res.status(401).json({ error: 'E-Mail-Adresse oder Passwort stimmt nicht.' });

  await regenerateSession(req, record.id);
  res.json({ user: getUser(record.id), csrfToken: req.session.csrfToken });
}));

app.post('/api/auth/logout', requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('jsstudio.sid', { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'lax', path: '/' });
    res.status(204).end();
  });
});

app.get('/api/progress', requireUser, (req, res) => {
  const completed = db.prepare('SELECT lesson_id FROM lesson_progress WHERE user_id = ? ORDER BY completed_at, lesson_id').all(req.user.id).map((row) => row.lesson_id);
  res.set('Cache-Control', 'no-store');
  res.json({ completed, xp: completed.length * XP_PER_LESSON });
});

app.put('/api/progress/:lessonId', requireUser, requireCsrf, (req, res) => {
  const { lessonId } = req.params;
  if (!LESSON_IDS.has(lessonId)) return res.status(404).json({ error: 'Diese Lektion gibt es nicht.' });
  db.prepare('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)').run(req.user.id, lessonId);
  const completed = db.prepare('SELECT lesson_id FROM lesson_progress WHERE user_id = ? ORDER BY completed_at, lesson_id').all(req.user.id).map((row) => row.lesson_id);
  res.json({ completed, xp: completed.length * XP_PER_LESSON });
});

app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(ROOT, 'login.html')));
app.use('/html', express.static(path.join(ROOT, 'html'), { dotfiles: 'deny', index: false }));
app.use('/css', express.static(path.join(ROOT, 'css'), { dotfiles: 'deny', index: false }));
app.use('/js', express.static(path.join(ROOT, 'js'), { dotfiles: 'deny', index: false }));
app.use('/api', (req, res) => res.status(404).json({ error: 'API-Endpunkt nicht gefunden.' }));
app.use((req, res) => res.status(404).send('Nicht gefunden.'));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'Ein Serverfehler ist aufgetreten. Bitte versuche es später erneut.' });
});

setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}, 60 * 60 * 1000).unref();

app.listen(PORT, process.env.HOST || (IS_PRODUCTION ? '0.0.0.0' : '127.0.0.1'), () => {
  console.log(`JS Studio läuft auf http://localhost:${PORT}`);
  console.log(`Konten und Lernfortschritt werden in ${databasePath} gespeichert.`);
});
