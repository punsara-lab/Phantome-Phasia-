// src/ai/index.js — PHANTOM AI Engine
// Supports: claude | openai | openrouter | gemini | ollama | none
import fetch from 'node-fetch';
import { getContact, saveAiLog, getAIStatus } from '../db/index.js';
import { printEvent } from '../core/cli.js';

// Conversation memory per JID (in-memory, last 20 turns)
const memory = new Map();
const MAX_HISTORY = 20;

function getHistory(jid) {
  if (!memory.has(jid)) memory.set(jid, []);
  return memory.get(jid);
}

function pushHistory(jid, role, content) {
  const hist = getHistory(jid);
  hist.push({ role, content });
  if (hist.length > MAX_HISTORY * 2) hist.splice(0, 2);
}

function getSystemPrompt(jid) {
  const contact = getContact(jid);
  const aiStatus = getAIStatus();
  const customPersona = contact?.ai_persona || null;
  const defaultPersona = process.env.AI_DEFAULT_PERSONA || '';

  // Status context
  let statusCtx = '';
  if (aiStatus?.status_note) {
    statusCtx = `\n\nCurrent status context: ${aiStatus.status_note}`;
  }

  const base = `You are a WhatsApp assistant replying on behalf of the phone owner. Be concise, conversational, and natural — like a real person texting. Keep replies short unless detail is needed.${statusCtx}`;

  if (customPersona) return `${customPersona}\n\n${base}`;
  if (defaultPersona) return `${defaultPersona}\n\n${base}`;
  return base;
}

// ── Main Handler ───────────────────────────────────────────────────────────
export async function handleAI(jid, userMsg, opts = {}) {
  const mode = process.env.AI_MODE || 'none';
  if (mode === 'none') return null;

  // Check away mode
  const aiStatus = getAIStatus();
  if (aiStatus?.is_away && !opts.force) {
    const awayMsg = aiStatus.away_msg || 'I am currently unavailable.';
    saveAiLog({ jid, user_msg: userMsg, ai_reply: `[AWAY] ${awayMsg}`, model: 'away', tokens: 0, direction: 'inbound' });
    return awayMsg;
  }

  pushHistory(jid, 'user', userMsg);
  const history = getHistory(jid);

  let reply = null;
  let model = mode;
  let tokens = 0;

  try {
    if (mode === 'claude') {
      ({ reply, tokens } = await claudeReply(jid, history));
      model = 'claude-haiku';
    } else if (mode === 'openai') {
      ({ reply, tokens } = await openAiReply(jid, history));
      model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    } else if (mode === 'openrouter') {
      ({ reply, tokens } = await openRouterReply(jid, history));
      model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    } else if (mode === 'gemini') {
      ({ reply, tokens } = await geminiReply(jid, history));
      model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    } else if (mode === 'ollama') {
      ({ reply } = await ollamaReply(jid, history));
      model = process.env.OLLAMA_MODEL || 'mistral';
    }

    if (reply) {
      pushHistory(jid, 'assistant', reply);
      saveAiLog({ jid, user_msg: userMsg, ai_reply: reply, model, tokens, direction: opts.direction || 'inbound' });
      printEvent('ai', `${jid.split('@')[0]} → ${reply.slice(0, 50)}…`);
    }
  } catch (err) {
    console.error('[AI Error]', err.message);
  }

  return reply;
}

// ── Claude API ─────────────────────────────────────────────────────────────
async function claudeReply(jid, history) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: getSystemPrompt(jid),
      messages: history,
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  return {
    reply: data.content?.[0]?.text || null,
    tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
  };
}

// ── OpenAI ────────────────────────────────────────────────────────────────
async function openAiReply(jid, history) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      max_tokens: 400,
      messages: [{ role: 'system', content: getSystemPrompt(jid) }, ...history],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
  const data = await res.json();
  return {
    reply: data.choices?.[0]?.message?.content || null,
    tokens: data.usage?.total_tokens || 0,
  };
}

// ── OpenRouter ─────────────────────────────────────────────────────────────
async function openRouterReply(jid, history) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://phantom-wa.app',
      'X-Title': 'PHANTOM',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      max_tokens: 400,
      messages: [{ role: 'system', content: getSystemPrompt(jid) }, ...history],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter API ${res.status}`);
  const data = await res.json();
  return {
    reply: data.choices?.[0]?.message?.content || null,
    tokens: data.usage?.total_tokens || 0,
  };
}

// ── Gemini ─────────────────────────────────────────────────────────────────
async function geminiReply(jid, history) {
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const apiKey = process.env.GEMINI_API_KEY;

  // Convert to Gemini format
  const systemPrompt = getSystemPrompt(jid);
  const contents = history.map(h => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 400 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API ${res.status}`);
  const data = await res.json();
  return {
    reply: data.candidates?.[0]?.content?.parts?.[0]?.text || null,
    tokens: data.usageMetadata?.totalTokenCount || 0,
  };
}

// ── Ollama (local) ─────────────────────────────────────────────────────────
async function ollamaReply(jid, history) {
  const url = `${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/chat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || 'mistral',
      stream: false,
      messages: [{ role: 'system', content: getSystemPrompt(jid) }, ...history],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = await res.json();
  return { reply: data.message?.content || null, tokens: 0 };
}

// ── Utils ──────────────────────────────────────────────────────────────────
export function clearAIMemory(jid) {
  if (jid) memory.delete(jid);
  else memory.clear();
}

export function getAIMemory(jid) {
  return getHistory(jid);
}
