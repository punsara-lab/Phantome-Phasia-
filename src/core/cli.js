// src/core/cli.js — PHANTOM Console  (Railway-safe, no \r overwriting)
// Pure ANSI — no optional deps needed. Everything logs as a new line.

const C = {
  violet: s => `\x1b[38;5;135m${s}\x1b[0m`,
  purple: s => `\x1b[38;5;93m${s}\x1b[0m`,
  cyan:   s => `\x1b[38;5;51m${s}\x1b[0m`,
  green:  s => `\x1b[38;5;82m${s}\x1b[0m`,
  red:    s => `\x1b[38;5;196m${s}\x1b[0m`,
  amber:  s => `\x1b[38;5;214m${s}\x1b[0m`,
  blue:   s => `\x1b[38;5;39m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  white:  s => `\x1b[97m${s}\x1b[0m`,
  grey:   s => `\x1b[38;5;240m${s}\x1b[0m`,
};

const SEP = C.grey('─'.repeat(68));

function ts() {
  const now = new Date();
  const d = now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' });
  const t = now.toTimeString().slice(0,8);
  return C.dim(`[${d} ${t}]`);
}

// ── Banner ─────────────────────────────────────────────────────────────────
export function printBanner() {
  console.log('');
  console.log(C.violet('  ██████╗ ██╗  ██╗ █████╗ ███╗   ██╗████████╗ ██████╗ ███╗   ███╗'));
  console.log(C.violet('  ██╔══██╗██║  ██║██╔══██╗████╗  ██║╚══██╔══╝██╔═══██╗████╗ ████║'));
  console.log(C.violet('  ██████╔╝███████║███████║██╔██╗ ██║   ██║   ██║   ██║██╔████╔██║'));
  console.log(C.violet('  ██╔═══╝ ██╔══██║██╔══██║██║╚██╗██║   ██║   ██║   ██║██║╚██╔╝██║'));
  console.log(C.violet('  ██║     ██║  ██║██║  ██║██║ ╚████║   ██║   ╚██████╔╝██║ ╚═╝ ██║'));
  console.log(C.violet('  ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝'));
  console.log('');
  console.log(C.cyan('  ◈  WhatsApp Intelligence System  ◈'));
  console.log(C.dim(`  Build: PHANTOM v3.0  |  Node ${process.version}  |  ${new Date().toUTCString()}`));
  console.log('');
}

// ── Status table ───────────────────────────────────────────────────────────
export function printStatus({ connected, aiMode, msgCount, contactCount }) {
  const mem    = process.memoryUsage();
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(0);
  const rssMB  = (mem.rss / 1024 / 1024).toFixed(0);

  console.log(SEP);
  console.log(C.violet('  PHANTOM STATUS'));
  console.log(SEP);
  console.log(`  ${C.dim('Connection')}  ${connected ? C.green('● CONNECTED') : C.red('○ DISCONNECTED')}`);
  console.log(`  ${C.dim('AI Mode   ')}  ${C.cyan((aiMode||'none').toUpperCase())}`);
  console.log(`  ${C.dim('Messages  ')}  ${C.white(String(msgCount||0))}`);
  console.log(`  ${C.dim('Contacts  ')}  ${C.white(String(contactCount||0))}`);
  console.log(`  ${C.dim('Heap      ')}  ${heapMB}MB  ${C.dim('RSS')} ${rssMB}MB`);
  console.log(SEP);
  console.log('');
}

// ── Section header ─────────────────────────────────────────────────────────
export function printSectionHeader(title) {
  console.log('');
  console.log(SEP);
  console.log(`  ${C.violet(title)}`);
  console.log(SEP);
}

// ── Info / Error ───────────────────────────────────────────────────────────
export function printInfo(msg) {
  console.log(`${ts()}  ${C.cyan('ℹ')}  ${msg}`);
}

export function printError(msg) {
  console.log(`${ts()}  ${C.red('✖')}  ${msg}`);
}

// ── Connection events ─────────────────────────────────────────────────────
export function printEvent(type, detail) {
  const map = {
    connected:    [C.green,  '●', 'CONNECTED   '],
    disconnected: [C.red,    '○', 'DISCONNECTED'],
    deleted:      [C.amber,  '✗', 'DELETED     '],
    scheduled:    [C.blue,   '⏰','SCHEDULED   '],
    ai:           [C.purple, '◈', 'AI          '],
  };
  const [col, icon, label] = map[type] || [C.dim, '◈', type.toUpperCase().padEnd(12)];
  console.log(`${ts()}  ${col(`${icon} ${label}`)}  ${detail || ''}`);
}

// ── Message log — the main live feed ─────────────────────────────────────
export function printMessage(msg) {
  const dir        = msg.from_me ? C.cyan('→ OUT') : C.green('← IN ');
  const contact    = msg.contactName || msg.jid?.split('@')[0] || 'unknown';
  const jidShort   = msg.jid ? C.dim(`(${msg.jid.split('@')[0]})`) : '';
  const type       = msg.type !== 'text' ? C.amber(` [${msg.type}]`) : '';
  const del        = msg.deleted ? C.red(' [DELETED]') : '';
  const body       = (msg.body || msg.caption || `[${msg.type}]`).slice(0, 90);
  const ellipsis   = (msg.body||msg.caption||'').length > 90 ? C.dim('…') : '';

  console.log(`${ts()}  ${dir}  ${C.bold(contact)} ${jidShort}${type}${del}`);
  console.log(`${C.dim(' '.repeat(14))}  ${body}${ellipsis}`);
}
