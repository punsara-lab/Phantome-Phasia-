// src/index.js — PHANTOM Entry Point (Railway-hardened)
import 'dotenv/config';
import { printBanner, printStatus, printSectionHeader, printInfo, printError } from './core/cli.js';
import { connect, events } from './core/whatsapp.js';
import { startServer } from './web/server.js';
import { startScheduler } from './scheduler/index.js';
import { getStats } from './db/index.js';

// ── Banner ─────────────────────────────────────────────────────────────────
printBanner();
printInfo('Initializing PHANTOM system...');
printInfo('Stealth mode: server will appear as your secondary phone');
printInfo('All messages, including deleted ones, will be saved\n');

// ── Web Dashboard (start first so Railway health check passes immediately) ─
startServer();
printInfo(`Web dashboard → http://0.0.0.0:${process.env.PORT || 3000}`);

// ── Scheduler ──────────────────────────────────────────────────────────────
startScheduler();

// ── WhatsApp Connection ────────────────────────────────────────────────────
printSectionHeader('CONNECTING TO WHATSAPP');

events.on('status', ({ connected, id }) => {
  if (connected) {
    let stats = { totalMessages: 0, totalContacts: 0 };
    try { stats = getStats(); } catch {}
    printStatus({
      connected: true,
      aiMode:    process.env.AI_MODE || 'none',
      msgCount:  stats.totalMessages,
      contactCount: stats.totalContacts,
    });
    printSectionHeader('LIVE FEED  ◈  Messages appear below');
  }
});

// ── Graceful Shutdown ──────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  printInfo('\nSIGTERM received — shutting down PHANTOM...');
  process.exit(0);
});

process.on('SIGINT', () => {
  printInfo('\nShutting down PHANTOM...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  printError(`Uncaught: ${err.message}`);
  // Don't exit — let Railway keep it running
});

process.on('unhandledRejection', (err) => {
  printError(`Unhandled rejection: ${err?.message || err}`);
  // Don't exit — let Railway keep it running
});

// ── Start WA connection ────────────────────────────────────────────────────
connect().catch(err => {
  printError(`Fatal connection error: ${err.message}`);
  // Retry after 10s instead of exiting
  setTimeout(() => {
    printInfo('Retrying connection...');
    connect().catch(() => {});
  }, 10000);
});
