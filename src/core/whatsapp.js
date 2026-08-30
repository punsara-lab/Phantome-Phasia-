// src/core/whatsapp.js — PHANTOM WhatsApp Engine (Railway-hardened)
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pino from 'pino';
import { EventEmitter } from 'events';

import {
  saveMessage, markDeleted, upsertContact,
  updateContact, logEvent,
} from '../db/index.js';
import { printMessage, printEvent, printError, printInfo } from './cli.js';
import { handleAI } from '../ai/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use Railway persistent volume if mounted, otherwise fallback to local data/
const DATA_ROOT = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH)
  : path.join(__dirname, '../../data');

const AUTH_DIR  = path.join(DATA_ROOT, 'auth');
const MEDIA_DIR = path.join(DATA_ROOT, 'media');
const QR_PATH   = path.join(DATA_ROOT, 'qr.txt');

// Max media file size to download (5MB) — keep Railway disk safe
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

fs.mkdirSync(AUTH_DIR,  { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

let sock = null;
let isConnected = false;
let reconnectTimer = null;

// EventEmitter — synchronous, no top-level await needed
export const events = new EventEmitter();
events.setMaxListeners(50);

// ── Connect ────────────────────────────────────────────────────────────────
export async function connect() {
  // Clear any pending reconnect timer
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  let state, saveCreds;
  try {
    ({ state, saveCreds } = await useMultiFileAuthState(AUTH_DIR));
  } catch (err) {
    printError(`Auth state error: ${err.message} — clearing and retrying`);
    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    ({ state, saveCreds } = await useMultiFileAuthState(AUTH_DIR));
  }

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
    printInfo(`WA version: ${version.join('.')}`);
  } catch {
    version = [2, 3000, 1015901307];
    printInfo(`WA version: fallback ${version.join('.')}`);
  }

  const logger = pino({ level: 'silent' });

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    syncFullHistory: false,           // CRITICAL: never sync full history on Railway
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    browser: ['PHANTOM', 'Chrome', '120.0.0'],
    getMessage: async () => undefined,
    retryRequestDelayMs: 3000,
    maxMsgRetryCount: 2,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 30000,
  });

  // ── Connection Updates ────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try { fs.writeFileSync(QR_PATH, qr, 'utf8'); } catch {}
      events.emit('qr', qr);
      printInfo('QR ready — open your Railway URL → /qr to scan');
    }

    if (connection === 'close') {
      isConnected = false;
      try { fs.unlinkSync(QR_PATH); } catch {}

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason     = lastDisconnect?.error?.message || 'unknown';
      const loggedOut  = statusCode === DisconnectReason.loggedOut;

      printEvent('disconnected', `code ${statusCode} — ${reason}`);
      try { logEvent('disconnected', null, { statusCode, reason }); } catch {}
      events.emit('status', { connected: false });

      if (loggedOut) {
        printError('Logged out — delete data/auth/ folder and redeploy');
        // Don't reconnect if explicitly logged out
      } else if (statusCode === 405) {
        printInfo('WA version rejected (405) — retrying in 15s...');
        reconnectTimer = setTimeout(connect, 15000);
      } else if (statusCode === 428) {
        printInfo('Connection replaced by another device — retrying in 8s...');
        reconnectTimer = setTimeout(connect, 8000);
      } else {
        const delay = statusCode === 503 ? 20000 : 5000;
        printInfo(`Reconnecting in ${delay/1000}s... (code ${statusCode})`);
        reconnectTimer = setTimeout(connect, delay);
      }
    }

    if (connection === 'open') {
      isConnected = true;
      try { fs.unlinkSync(QR_PATH); } catch {}
      printEvent('connected', sock.user?.id);
      try { logEvent('connected', null, { id: sock.user?.id }); } catch {}
      events.emit('status', { connected: true, id: sock.user?.id });

      if (process.env.STEALTH_MODE !== 'false') {
        try { await sock.sendPresenceUpdate('unavailable'); } catch {}
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ── Contacts ──────────────────────────────────────────────────────────────
  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
      try {
        upsertContact({ jid: c.id, name: c.name||null, notify: c.notify||null,
          phone: c.id.split('@')[0], is_group: c.id.endsWith('@g.us') ? 1 : 0 });
      } catch {}
    }
  });

  sock.ev.on('contacts.update', (updates) => {
    for (const c of updates) {
      if (c.id) {
        try {
          upsertContact({ jid: c.id, name: c.name||null, notify: c.notify||null,
            phone: c.id.split('@')[0], is_group: c.id.endsWith('@g.us') ? 1 : 0 });
        } catch {}
      }
    }
  });

  // ── Messages ───────────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      try { await processMessage(msg, type); }
      catch (err) { printError(`Msg error: ${err.message}`); }
    }
  });

  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      try {
        const proto = update.update?.message?.protocolMessage;
        if (proto?.type === 0) {
          const deletedId = proto.key?.id;
          if (deletedId) {
            markDeleted(deletedId);
            printEvent('deleted', `ID: ${deletedId}`);
            try { logEvent('deleted', update.key?.remoteJid, { id: deletedId }); } catch {}
            events.emit('message_deleted', { id: deletedId, jid: update.key?.remoteJid });
          }
        }
      } catch {}
    }
  });

  sock.ev.on('presence.update', ({ id, presences }) => {
    try {
      for (const [, presence] of Object.entries(presences)) {
        if (presence.lastSeen) updateContact(id, { last_seen: presence.lastSeen });
        events.emit('presence', { jid: id, presence });
      }
    } catch {}
  });

  return sock;
}

// ── Process Message ────────────────────────────────────────────────────────
async function processMessage(msg, type) {
  if (!msg.message) return;
  if (type === 'append') return;

  const jid       = msg.key.remoteJid;
  const id        = msg.key.id;
  const fromMe    = msg.key.fromMe;
  const timestamp = msg.messageTimestamp;
  const contentType = getContentType(msg.message);

  let body = null, mediaPath = null, mimeType = null, caption = null;
  let msgType = 'text';

  if (contentType === 'conversation') {
    body = msg.message.conversation;
  } else if (contentType === 'extendedTextMessage') {
    body = msg.message.extendedTextMessage?.text;
  } else if (['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'].includes(contentType)) {
    msgType  = contentType.replace('Message', '');
    caption  = msg.message[contentType]?.caption || null;
    mimeType = msg.message[contentType]?.mimetype || null;
    // Only download if under size limit — protect Railway disk
    const fileSize = msg.message[contentType]?.fileLength;
    if (!fileSize || Number(fileSize) <= MAX_MEDIA_BYTES) {
      try { mediaPath = await downloadMedia(msg, contentType, id); } catch {}
    } else {
      printInfo(`Media skipped (${Math.round(Number(fileSize)/1024)}KB > limit)`);
    }
  } else if (contentType === 'locationMessage') {
    msgType = 'location';
    const loc = msg.message.locationMessage;
    body = `${loc.degreesLatitude},${loc.degreesLongitude}`;
  } else if (contentType === 'contactMessage') {
    msgType = 'contact';
    body = msg.message.contactMessage?.displayName;
  }

  const quotedId = msg.message[contentType]?.contextInfo?.stanzaId || null;
  const pushName = msg.pushName || null;

  if (jid) {
    try {
      upsertContact({ jid, name: pushName||null, notify: pushName||null,
        phone: jid.split('@')[0], is_group: jid.endsWith('@g.us') ? 1 : 0 });
    } catch {}
  }

  const record = {
    id, jid, from_me: fromMe ? 1 : 0, type: msgType,
    body, media_path: mediaPath, mime_type: mimeType,
    caption, quoted_id: quotedId, timestamp: Number(timestamp),
    status: 'received', raw_json: JSON.stringify(msg.message),
  };

  try { saveMessage(record); } catch {}
  events.emit('message', { ...record, contactName: pushName });
  printMessage({ ...record, contactName: pushName });

  if (process.env.AI_AUTO_REPLY === 'on' && !fromMe &&
      jid !== 'status@broadcast' && msgType === 'text' && body) {
    try {
      const reply = await handleAI(jid, body);
      if (reply) {
        await sendMessage(jid, { text: reply });
        events.emit('ai_reply', { jid, reply });
      }
    } catch (err) { printError(`AI error: ${err.message}`); }
  }
}

async function downloadMedia(msg, contentType, id) {
  const ext = { imageMessage:'jpg', videoMessage:'mp4', audioMessage:'ogg',
    documentMessage:'bin', stickerMessage:'webp' }[contentType] || 'bin';
  const filepath = path.join(MEDIA_DIR, `${id}.${ext}`);
  if (fs.existsSync(filepath)) return filepath;
  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  fs.writeFileSync(filepath, buffer);
  return filepath;
}

export async function sendMessage(jid, content) {
  if (!sock || !isConnected) throw new Error('Not connected');
  const normalJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
  const sent = await sock.sendMessage(normalJid, content);
  if (sent?.key?.id) {
    try {
      saveMessage({ id: sent.key.id, jid: normalJid, from_me: 1,
        type: 'text', body: content.text || content.caption || null,
        media_path: null, mime_type: null, caption: null, quoted_id: null,
        timestamp: Math.floor(Date.now() / 1000), status: 'sent',
        raw_json: JSON.stringify(content) });
    } catch {}
  }
  return sent;
}

export function getConnectionStatus() { return { connected: isConnected, id: sock?.user?.id }; }
export function getSock() { return sock; }
export function getQRPath() { return QR_PATH; }
