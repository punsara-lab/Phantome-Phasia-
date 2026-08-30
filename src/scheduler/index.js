// src/scheduler/index.js — PHANTOM Scheduler
import cron from 'node-cron';
import { getPendingScheduled, updateScheduledStatus, getAllScheduled } from '../db/index.js';
import { sendMessage } from '../core/whatsapp.js';
import { printEvent, printError } from '../core/cli.js';

const cronJobs = new Map();

// ── Start Scheduler ────────────────────────────────────────────────────────
export function startScheduler() {
  // Check one-time messages every minute
  cron.schedule('* * * * *', checkOneTime);

  // Re-register cron jobs from DB on start
  refreshCronJobs();

  printEvent('connected', 'Scheduler active');
}

// ── One-Time Messages ──────────────────────────────────────────────────────
async function checkOneTime() {
  const pending = getPendingScheduled().filter(s => s.send_at && !s.cron_expr);

  for (const sched of pending) {
    const now = Math.floor(Date.now() / 1000);
    if (sched.send_at <= now) {
      await dispatchScheduled(sched);
    }
  }
}

// ── Cron Jobs ──────────────────────────────────────────────────────────────
export function refreshCronJobs() {
  // Stop existing jobs
  for (const [id, job] of cronJobs) {
    job.stop();
    cronJobs.delete(id);
  }

  const all = getAllScheduled().filter(s => s.cron_expr && s.status === 'pending');

  for (const sched of all) {
    registerCronJob(sched);
  }
}

function registerCronJob(sched) {
  if (!cron.validate(sched.cron_expr)) {
    printError(`Invalid cron: ${sched.cron_expr} (ID ${sched.id})`);
    return;
  }

  const job = cron.schedule(sched.cron_expr, async () => {
    await dispatchScheduled(sched, true);
  });

  cronJobs.set(sched.id, job);
}

export function stopCronJob(id) {
  if (cronJobs.has(id)) {
    cronJobs.get(id).stop();
    cronJobs.delete(id);
  }
}

// ── Dispatch ───────────────────────────────────────────────────────────────
async function dispatchScheduled(sched, isRecurring = false) {
  try {
    const content = { text: sched.body };
    await sendMessage(sched.jid, content);

    if (!isRecurring) {
      updateScheduledStatus(sched.id, 'sent');
    }

    printEvent('scheduled', `→ ${sched.jid.split('@')[0]}: ${sched.body.slice(0, 40)}`);
  } catch (err) {
    printError(`Schedule send failed (ID ${sched.id}): ${err.message}`);
    if (!isRecurring) {
      updateScheduledStatus(sched.id, 'failed');
    }
  }
}

// ── Bulk Schedule (multiple numbers) ──────────────────────────────────────
export async function scheduleBulk({ numbers, body, send_at, cron_expr, repeat = 0 }) {
  const { addScheduled } = await import('../db/index.js');
  const ids = [];

  for (const num of numbers) {
    const jid = num.includes('@') ? num : `${num}@s.whatsapp.net`;
    const result = addScheduled({ jid, body, media_path: null, cron_expr, send_at, repeat });
    ids.push(result.lastInsertRowid);

    if (cron_expr) {
      const sched = { id: result.lastInsertRowid, jid, body, cron_expr, status: 'pending' };
      registerCronJob(sched);
    }
  }

  return ids;
}
