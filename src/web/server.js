// src/web/server.js — PHANTOM Web Server
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

import {
  getMessages, getContacts, getContact, updateContact,
  searchMessages, getStats, getAllScheduled, deleteScheduled,
  getRecentEvents, addScheduled, getAIStatus, setAIStatus,
  getAiLogs, saveAiLog,
} from '../db/index.js';
import { sendMessage, getConnectionStatus, getQRPath } from '../core/whatsapp.js';
import { scheduleBulk, refreshCronJobs, stopCronJob } from '../scheduler/index.js';
import { handleAI, clearAIMemory, getAIMemory } from '../ai/index.js';
import { events } from '../core/whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app    = express();
const server = createServer(app);

// ── Socket.IO (auto-works, no manual config needed) ───────────────────────
export const io = new SocketIO(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

const MEDIA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'media')
  : path.join(__dirname, '../../data/media');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../../public')));

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Auth middleware ─────────────────────────────────────────────────────────
app.use('/api', (req, res, next) => {
  const secret = process.env.WEB_SECRET;
  if (!secret) return next();
  const auth = req.headers['x-phantom-secret'] || req.query.secret;
  if (auth !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

// ── QR page ─────────────────────────────────────────────────────────────────
app.get('/qr', async (_req, res) => {
  const qrPath = getQRPath();
  const connected = getConnectionStatus().connected;
  if (connected) {
    return res.send(`<html><head><meta http-equiv="refresh" content="2;url=/"></head><body style="background:#06060f;color:#10b981;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px"><div style="font-size:48px">✓</div><div>Connected</div></body></html>`);
  }
  let qrDataURL = null;
  try {
    if (fs.existsSync(qrPath)) {
      qrDataURL = await QRCode.toDataURL(fs.readFileSync(qrPath, 'utf8').trim(), {
        width: 400, margin: 2, color: { dark: '#000000', light: '#ffffff' }, errorCorrectionLevel: 'L',
      });
    }
  } catch {}
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PHANTOM QR</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#06060f;color:#e8e4ff;font-family:'Courier New',monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#0a0a1a;border:1px solid rgba(120,100,255,.3);border-radius:20px;padding:40px;text-align:center;max-width:480px;width:100%}.title{font-size:13px;letter-spacing:4px;color:#7c3aed;margin-bottom:8px}.h{font-size:22px;font-weight:700;margin-bottom:32px}.qr-box{background:#fff;border-radius:16px;padding:20px;display:inline-block;margin-bottom:28px}.qr-box img{display:block;width:320px;height:320px}.waiting{background:#111122;border:1px solid rgba(120,100,255,.2);border-radius:12px;padding:28px;color:#6b7280;margin-bottom:28px}.spin{font-size:32px;animation:spin 2s linear infinite;display:block;margin-bottom:12px}@keyframes spin{to{transform:rotate(360deg)}}.steps{text-align:left;font-size:13px;color:#a78bfa;line-height:2;margin-bottom:24px}.steps span{color:#6b7280}.btn{background:#7c3aed;border:none;border-radius:10px;color:#fff;font-family:monospace;font-size:14px;padding:12px 28px;cursor:pointer;letter-spacing:1px}.btn:hover{background:#a78bfa}</style></head><body>
<div class="card"><div class="title">◎ PHANTOM</div><div class="h">Link Your WhatsApp</div>
${qrDataURL ? `<div class="qr-box"><img src="${qrDataURL}"></div>` : `<div class="waiting"><span class="spin">◎</span>Generating QR…<br><small style="font-size:11px;margin-top:8px;display:block">Refresh in a moment</small></div>`}
<div class="steps">1. Open <span>WhatsApp</span><br>2. Tap <span>⋮ → Linked Devices</span><br>3. Tap <span>Link a Device</span><br>4. Scan this QR</div>
<button class="btn" onclick="location.reload()">↺ Refresh QR</button></div>
<script>${qrDataURL ? 'setTimeout(()=>location.reload(),25000)' : 'setTimeout(()=>location.reload(),4000)'}</script>
</body></html>`);
});

// ── API: QR ─────────────────────────────────────────────────────────────────
app.get('/api/qr', async (_req, res) => {
  const qrPath = getQRPath();
  try {
    if (!fs.existsSync(qrPath)) return res.json({ qr: null });
    const dataURL = await QRCode.toDataURL(fs.readFileSync(qrPath, 'utf8').trim(), {
      width: 280, margin: 2, color: { dark: '#000000', light: '#ffffff' }, errorCorrectionLevel: 'L',
    });
    res.json({ qr: dataURL });
  } catch { res.json({ qr: null }); }
});

// ── API: Status ──────────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  res.json({
    ...getConnectionStatus(),
    stats:    getStats(),
    aiMode:   process.env.AI_MODE || 'none',
    stealth:  process.env.STEALTH_MODE !== 'false',
    hasQR:    fs.existsSync(getQRPath()),
    aiStatus: getAIStatus(),
  });
});

// ── API: Contacts ────────────────────────────────────────────────────────────
app.get('/api/contacts', (req, res) => res.json(getContacts({ search: req.query.q || '' })));
app.get('/api/contacts/:jid', (req, res) => {
  const c = getContact(decodeURIComponent(req.params.jid));
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});
app.patch('/api/contacts/:jid', (req, res) => {
  updateContact(decodeURIComponent(req.params.jid), req.body);
  res.json({ ok: true });
});

// ── API: Messages ────────────────────────────────────────────────────────────
app.get('/api/messages/:jid', (req, res) => {
  res.json(getMessages(decodeURIComponent(req.params.jid), {
    limit:          parseInt(req.query.limit)  || 80,
    offset:         parseInt(req.query.offset) || 0,
    includeDeleted: req.query.deleted !== 'false',
  }));
});
app.get('/api/search', (req, res) => {
  if (!req.query.q) return res.json([]);
  res.json(searchMessages(req.query.q));
});

// ── API: Export chat as JSON / TXT ────────────────────────────────────────
app.get('/api/export/:jid', (req, res) => {
  const jid    = decodeURIComponent(req.params.jid);
  const format = req.query.format || 'json'; // json | txt
  const msgs   = getMessages(jid, { limit: 99999, includeDeleted: true });
  const contact = getContact(jid);
  const name    = contact?.display_name || contact?.name || contact?.phone || jid.split('@')[0];

  if (format === 'txt') {
    const lines = msgs.map(m => {
      const ts   = new Date(m.timestamp * 1000).toLocaleString();
      const who  = m.from_me ? 'YOU' : name;
      const body = m.deleted ? '[DELETED MESSAGE]' : (m.body || `[${m.type}]`);
      return `[${ts}] ${who}: ${body}`;
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="chat_${name}_${Date.now()}.txt"`);
    return res.send(lines.join('\n'));
  }

  // JSON export
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="chat_${name}_${Date.now()}.json"`);
  res.json({
    exported_at: new Date().toISOString(),
    contact: { jid, name },
    message_count: msgs.length,
    messages: msgs.map(m => ({
      id:        m.id,
      timestamp: m.timestamp,
      date:      new Date(m.timestamp * 1000).toISOString(),
      from_me:   !!m.from_me,
      type:      m.type,
      body:      m.body,
      caption:   m.caption,
      deleted:   !!m.deleted,
    })),
  });
});

// ── API: Send ─────────────────────────────────────────────────────────────────
app.post('/api/send', async (req, res) => {
  const { jid, body } = req.body;
  if (!jid || !body) return res.status(400).json({ error: 'jid and body required' });
  try {
    await sendMessage(jid, { text: body });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Scheduler ────────────────────────────────────────────────────────────
app.get('/api/scheduled', (_req, res) => res.json(getAllScheduled()));

app.post('/api/scheduled', async (req, res) => {
  const { numbers, jid, body, send_at, cron_expr, repeat } = req.body;
  if (!body) return res.status(400).json({ error: 'body required' });
  let sendAtTs = send_at ? Math.floor(new Date(send_at).getTime() / 1000) : null;
  if (numbers?.length) {
    const ids = await scheduleBulk({ numbers, body, send_at: sendAtTs, cron_expr, repeat: repeat ? 1 : 0 });
    return res.json({ ok: true, ids });
  }
  if (!jid) return res.status(400).json({ error: 'jid or numbers required' });
  const result = addScheduled({
    jid: jid.includes('@') ? jid : `${jid}@s.whatsapp.net`,
    body, media_path: null, cron_expr: cron_expr || null, send_at: sendAtTs, repeat: repeat ? 1 : 0,
  });
  if (cron_expr) refreshCronJobs();
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.delete('/api/scheduled/:id', (req, res) => {
  const id = parseInt(req.params.id);
  stopCronJob(id);
  deleteScheduled(id);
  res.json({ ok: true });
});

// ── API: AI ─────────────────────────────────────────────────────────────────
app.post('/api/ai/chat', async (req, res) => {
  const { jid, message } = req.body;
  if (!jid || !message) return res.status(400).json({ error: 'jid and message required' });
  try {
    const reply = await handleAI(jid, message, { force: true });
    res.json({ reply });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ai/memory/:jid', (req, res) => res.json(getAIMemory(decodeURIComponent(req.params.jid))));
app.delete('/api/ai/memory/:jid', (req, res) => { clearAIMemory(decodeURIComponent(req.params.jid)); res.json({ ok: true }); });
app.delete('/api/ai/memory/all', (req, res) => { clearAIMemory(); res.json({ ok: true }); });
app.get('/api/ai/logs', (req, res) => res.json(getAiLogs({ jid: req.query.jid, limit: parseInt(req.query.limit) || 50 })));
app.get('/api/ai/status', (_req, res) => res.json(getAIStatus()));
app.post('/api/ai/status', (req, res) => {
  const { is_away, away_msg, status_note } = req.body;
  const u = {};
  if (is_away !== undefined)    u.is_away    = is_away ? 1 : 0;
  if (away_msg !== undefined)   u.away_msg   = away_msg;
  if (status_note !== undefined) u.status_note = status_note;
  setAIStatus(u);
  res.json({ ok: true, status: getAIStatus() });
});

// ── API: Media ───────────────────────────────────────────────────────────────
app.get('/api/media/:filename', (req, res) => {
  const filepath = path.join(MEDIA_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filepath)) return res.status(404).send('Not found');
  res.sendFile(filepath);
});
app.get('/api/media/:filename/download', (req, res) => {
  const filepath = path.join(MEDIA_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filepath)) return res.status(404).send('Not found');
  res.download(filepath);
});

// ── API: Events ──────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => res.json(getRecentEvents(parseInt(req.query.limit) || 50)));

// ── Catch-all — inject WEB_SECRET into page so frontend never needs ?secret= ─
app.get('*', (_req, res) => {
  const htmlPath = path.join(__dirname, '../../public/index.html');
  try {
    let html = fs.readFileSync(htmlPath, 'utf8');
    // Inject secret as a JS variable before </head>
    const secret = process.env.WEB_SECRET || '';
    const inject = `<script>window.PHANTOM_SECRET=${JSON.stringify(secret)};</script>`;
    html = html.replace('</head>', inject + '</head>');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch {
    res.sendFile(htmlPath);
  }
});

// ── Socket.IO — bridge WhatsApp events to browser ───────────────────────────
io.use((socket, next) => {
  const secret = process.env.WEB_SECRET;
  if (!secret) return next();
  const provided = socket.handshake.auth?.secret || socket.handshake.query?.secret;
  if (provided !== secret) return next(new Error('Unauthorized'));
  next();
});

io.on('connection', (socket) => {
  // Send current status immediately on connect
  socket.emit('status', getConnectionStatus());
  socket.emit('stats', getStats());

  socket.on('send_msg', async ({ jid, body }) => {
    try {
      await sendMessage(jid, { text: body });
      socket.emit('msg_sent', { ok: true });
    } catch (e) {
      socket.emit('msg_sent', { ok: false, error: e.message });
    }
  });
});

// Bridge WhatsApp events → all connected browsers
events.on('message',         d => { io.emit('message', d);         });
events.on('message_deleted', d => { io.emit('message_deleted', d); });
events.on('status',          d => { io.emit('status', d);          });
events.on('ai_reply',        d => { io.emit('ai_reply', d);        });
events.on('qr',              d => { io.emit('qr', { hasQR: true });});
events.on('presence',        d => { io.emit('presence', d);        });

// Push stats update every 30s
setInterval(() => { io.emit('stats', getStats()); }, 30000);

// ── Start ─────────────────────────────────────────────────────────────────────
export function startServer() {
  const port = parseInt(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => {});
  return app;
}
