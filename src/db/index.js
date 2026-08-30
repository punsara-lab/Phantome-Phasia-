// src/db/index.js — PHANTOM Database Layer
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use Railway persistent volume if mounted, otherwise fallback to local data/
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? process.env.RAILWAY_VOLUME_MOUNT_PATH
  : path.join(__dirname, '../../data');

const DB_PATH = path.join(DB_DIR, 'phantom.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');  // Safer than FULL, faster than default
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -8000');    // 8MB cache, keeps memory low

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    jid         TEXT NOT NULL,
    from_me     INTEGER NOT NULL DEFAULT 0,
    type        TEXT NOT NULL DEFAULT 'text',
    body        TEXT,
    media_path  TEXT,
    mime_type   TEXT,
    caption     TEXT,
    quoted_id   TEXT,
    timestamp   INTEGER NOT NULL,
    status      TEXT DEFAULT 'received',
    deleted     INTEGER DEFAULT 0,
    deleted_at  INTEGER,
    raw_json    TEXT,
    created_at  INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages(jid);
  CREATE INDEX IF NOT EXISTS idx_messages_ts  ON messages(timestamp DESC);

  CREATE TABLE IF NOT EXISTS contacts (
    jid         TEXT PRIMARY KEY,
    name        TEXT,
    notify      TEXT,
    phone       TEXT,
    avatar_url  TEXT,
    last_seen   INTEGER,
    is_group    INTEGER DEFAULT 0,
    pinned      INTEGER DEFAULT 0,
    tags        TEXT DEFAULT '[]',
    notes       TEXT,
    ai_persona  TEXT,
    ai_enabled  INTEGER DEFAULT 0,
    updated_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    jid          TEXT NOT NULL,
    body         TEXT NOT NULL,
    media_path   TEXT,
    cron_expr    TEXT,
    send_at      INTEGER,
    repeat       INTEGER DEFAULT 0,
    status       TEXT DEFAULT 'pending',
    sent_at      INTEGER,
    created_at   INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS ai_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    jid         TEXT NOT NULL,
    user_msg    TEXT,
    ai_reply    TEXT,
    model       TEXT,
    tokens      INTEGER,
    direction   TEXT DEFAULT 'inbound',
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS ai_status (
    id          INTEGER PRIMARY KEY DEFAULT 1,
    is_away     INTEGER DEFAULT 0,
    away_msg    TEXT DEFAULT 'I am currently unavailable.',
    status_note TEXT,
    updated_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,
    jid         TEXT,
    data        TEXT,
    created_at  INTEGER DEFAULT (unixepoch())
  );
`);

// Ensure ai_status has a row
db.prepare(`INSERT OR IGNORE INTO ai_status (id) VALUES (1)`).run();

// ── Auto-cleanup: keep events table from growing forever ──────────────────
db.prepare(`DELETE FROM events WHERE created_at < unixepoch() - 86400 * 7`).run();

// ── Messages ───────────────────────────────────────────────────────────────
export function saveMessage(msg) {
  return db.prepare(`
    INSERT OR REPLACE INTO messages
      (id, jid, from_me, type, body, media_path, mime_type, caption,
       quoted_id, timestamp, status, raw_json)
    VALUES
      (@id, @jid, @from_me, @type, @body, @media_path, @mime_type, @caption,
       @quoted_id, @timestamp, @status, @raw_json)
  `).run(msg);
}

export function markDeleted(msgId) {
  return db.prepare(`
    UPDATE messages SET deleted=1, deleted_at=unixepoch() WHERE id=?
  `).run(msgId);
}

export function getMessages(jid, { limit = 60, offset = 0, includeDeleted = true } = {}) {
  const filter = includeDeleted ? '' : 'AND deleted=0';
  return db.prepare(`
    SELECT * FROM messages
    WHERE jid=? ${filter}
    ORDER BY timestamp ASC
    LIMIT ? OFFSET ?
  `).all(jid, limit, offset);
}

export function searchMessages(query) {
  return db.prepare(`
    SELECT m.*, c.name as contact_name FROM messages m
    LEFT JOIN contacts c ON m.jid = c.jid
    WHERE m.body LIKE ? OR m.caption LIKE ?
    ORDER BY m.timestamp DESC
    LIMIT 100
  `).all(`%${query}%`, `%${query}%`);
}

export function getStats() {
  return {
    totalMessages:    db.prepare('SELECT COUNT(*) as n FROM messages').get().n,
    deletedMessages:  db.prepare('SELECT COUNT(*) as n FROM messages WHERE deleted=1').get().n,
    totalContacts:    db.prepare('SELECT COUNT(*) as n FROM contacts').get().n,
    mediaMessages:    db.prepare("SELECT COUNT(*) as n FROM messages WHERE type != 'text' AND deleted=0").get().n,
    todayMessages:    db.prepare('SELECT COUNT(*) as n FROM messages WHERE timestamp > ?').get(Math.floor(Date.now()/1000)-86400).n,
    scheduledPending: db.prepare("SELECT COUNT(*) as n FROM scheduled_messages WHERE status='pending'").get().n,
  };
}

// ── Contacts ───────────────────────────────────────────────────────────────
export function upsertContact(contact) {
  return db.prepare(`
    INSERT INTO contacts (jid, name, notify, phone, is_group, updated_at)
    VALUES (@jid, @name, @notify, @phone, @is_group, unixepoch())
    ON CONFLICT(jid) DO UPDATE SET
      name    = CASE WHEN @name IS NOT NULL AND @name != '' THEN @name ELSE contacts.name END,
      notify  = CASE WHEN @notify IS NOT NULL AND @notify != '' THEN @notify ELSE contacts.notify END,
      phone   = @phone,
      updated_at = unixepoch()
  `).run(contact);
}

export function updateContact(jid, data) {
  const allowed = ['name','notes','ai_persona','ai_enabled','pinned','tags','avatar_url','last_seen'];
  const sets = Object.keys(data).filter(k => allowed.includes(k)).map(k => `${k}=@${k}`).join(', ');
  if (!sets) return;
  return db.prepare(`UPDATE contacts SET ${sets}, updated_at=unixepoch() WHERE jid=@jid`).run({ ...data, jid });
}

export function getContacts({ search = '', limit = 100 } = {}) {
  return db.prepare(`
    SELECT c.*,
      COALESCE(c.name, c.notify, c.phone) as display_name,
      COUNT(m.id) as msg_count,
      MAX(m.timestamp) as last_msg_ts,
      SUM(CASE WHEN m.deleted=1 THEN 1 ELSE 0 END) as deleted_count
    FROM contacts c
    LEFT JOIN messages m ON c.jid = m.jid
    WHERE (c.name LIKE ? OR c.notify LIKE ? OR c.phone LIKE ? OR c.jid LIKE ?)
    GROUP BY c.jid
    ORDER BY last_msg_ts DESC NULLS LAST
    LIMIT ?
  `).all(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, limit);
}

export function getContact(jid) {
  return db.prepare(`
    SELECT *, COALESCE(name, notify, phone) as display_name FROM contacts WHERE jid=?
  `).get(jid);
}

// ── Scheduler ──────────────────────────────────────────────────────────────
export function addScheduled(msg) {
  return db.prepare(`
    INSERT INTO scheduled_messages (jid, body, media_path, cron_expr, send_at, repeat)
    VALUES (@jid, @body, @media_path, @cron_expr, @send_at, @repeat)
  `).run(msg);
}

export function getPendingScheduled() {
  return db.prepare(`
    SELECT * FROM scheduled_messages
    WHERE status='pending' AND (send_at IS NULL OR send_at <= unixepoch())
    ORDER BY send_at ASC
  `).all();
}

export function getAllScheduled() {
  return db.prepare(`
    SELECT s.*, COALESCE(c.name, c.notify, c.phone, s.jid) as contact_name
    FROM scheduled_messages s
    LEFT JOIN contacts c ON s.jid = c.jid
    ORDER BY s.created_at DESC
  `).all();
}

export function updateScheduledStatus(id, status) {
  return db.prepare(`
    UPDATE scheduled_messages SET status=?, sent_at=unixepoch() WHERE id=?
  `).run(status, id);
}

export function deleteScheduled(id) {
  return db.prepare('DELETE FROM scheduled_messages WHERE id=?').run(id);
}

// ── AI Status / Away Mode ──────────────────────────────────────────────────
export function getAIStatus() {
  return db.prepare('SELECT * FROM ai_status WHERE id=1').get();
}

export function setAIStatus(data) {
  const allowed = ['is_away','away_msg','status_note'];
  const sets = Object.keys(data).filter(k => allowed.includes(k)).map(k => `${k}=@${k}`).join(', ');
  if (!sets) return;
  return db.prepare(`UPDATE ai_status SET ${sets}, updated_at=unixepoch() WHERE id=1`).run(data);
}

// ── AI Logs ────────────────────────────────────────────────────────────────
export function saveAiLog(log) {
  return db.prepare(`
    INSERT INTO ai_logs (jid, user_msg, ai_reply, model, tokens, direction)
    VALUES (@jid, @user_msg, @ai_reply, @model, @tokens, @direction)
  `).run({ direction: 'inbound', ...log });
}

export function getAiLogs({ jid, limit = 50 } = {}) {
  if (jid) return db.prepare('SELECT * FROM ai_logs WHERE jid=? ORDER BY created_at DESC LIMIT ?').all(jid, limit);
  return db.prepare('SELECT * FROM ai_logs ORDER BY created_at DESC LIMIT ?').all(limit);
}

// ── Events ─────────────────────────────────────────────────────────────────
export function logEvent(type, jid, data) {
  return db.prepare('INSERT INTO events (type, jid, data) VALUES (?, ?, ?)').run(type, jid, JSON.stringify(data));
}

export function getRecentEvents(limit = 50) {
  return db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT ?').all(limit);
}

export default db;
