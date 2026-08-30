<p align="center">
  <img src="https://img.shields.io/badge/version-4.1-blue?style=for-the-badge" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" />
  <img src="https://img.shields.io/badge/platform-Node.js-339933?style=for-the-badge&logo=node.js" />
</p>

<h1 align="center">Phantome (Phasia)</h1>
<p align="center"><i>WhatsApp automation, archiving, and AI replies that actually work.</i></p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Install</a> •
  <a href="#configuration">Config</a> •
  <a href="#v6-aurora">🔥 v6 Aurora</a>
</p>

---

## What It Does

Phantome connects to WhatsApp Web, logs everything to a local SQLite database, and lets you automate responses with AI personas that actually sound like *you*. Built for people who need their WhatsApp to work smarter, not harder.

**v4.1** is the open-source foundation. Fully functional. Production-ready.  
**[v6 Aurora](#v6-aurora)** is where it gets dangerous.

---

> Date started-2026.06.12

## Features

| Feature | Description |
|---------|-------------|
| **📁 Message Archive** | Every message saved to SQLite, organized by contact. Searchable, permanent, yours. |
| **🗑️ Deleted Message Recovery** | Captures messages *before* they're deleted. Nothing disappears without you seeing it. |
| **🖼️ Media Storage** | Images, videos, audio, documents auto-downloaded and viewable in the dashboard. |
| **⏰ Scheduler** | One-time or recurring (cron) messages to multiple numbers. Birthday wishes that actually send on time. |
| **🤖 AI Auto-Reply** | Claude, OpenAI, OpenRouter, Gemini, or Ollama. Your choice of brain. |
| **✈️ Away Mode** | Set a fixed reply when you're unavailable. Actually works. |
| **📝 Status Context** | Tell the AI what you're doing so replies sound natural, not robotic. |
| **🎭 Per-Contact Personas** | Different personalities for different people. Professional for boss, unhinged for friends. |
| **📊 Live Dashboard** | Real-time message feed via SSE. Watch conversations happen without touching your phone. |
| **👻 Stealth Mode** | Your online status only shows from your phone. Stay invisible while the bot works. |

---

## Installation

```bash
git clone https://github.com/yourusername/phantome.git
cd phantome
npm install

# Copy and edit config
cp .env.example .env
nano .env

# Start
npm start
```

## Configuration

```json
{
  "ai": {
    "provider": "openrouter",
    "apiKey": "your-key-here",
    "model": "anthropic/claude-3.5-sonnet"
  },
  "stealthMode": true,
  "autoReply": {
    "enabled": true,
    "excludeGroups": true
  }
}
```

Environment variables are also supported via `.env`, and the app includes a starter example in `.env.example`.

---

## Screenshots
*(Dashboard preview, message logs, media viewer)*

---

## v6 Aurora

> **v4 works. v6 *slaps*.**
> While v4.1 is the solid open-source foundation, **v6 Aurora** is what happens when this project goes pro. Built for people who actually *use* their automation daily and need it to never break, never drop messages, and look good on a phone screen.

### What's in Aurora

- **Media Handling** — downloads media reliably with retry and recovery logic
- **Smart retry with exponential backoff** — expired links auto-recover instead of failing
- **AI Backend** — multi-provider config and OpenRouter-native fallback models
- **Dashboard** — responsive, touch-friendly, usable on phone or desktop
- **Message Reliability** — stronger handling for Baileys edge cases and new contact capture
- **Media Vault** — integrated vault with retry logic and better viewing flows
- **View-Once** — handled cleanly without clutter
- **Away Mode** — toggles plus status-aware AI replies

### The Technical Stuff That Matters

```js
// v4: Media fails, you lose it
// v6: reuploadRequest + backoff = you get the file

// v4: New contact with @lid sends message → *crickets*
// v6: Captured, logged, replied to

// v4: Dashboard on phone → horizontal scroll hell
// v6: Responsive grid, touch-friendly, actually usable
```

### Why v6 Isn't Free

v4.1 is here because open source is important. But v6 Aurora represents hundreds of hours of bug fixes, edge-case handling, and UI polish that make it *production-grade*.

**Aurora is for:**

- People running business accounts who can't afford dropped messages
- Anyone tired of expired media links that never recover
- Users who want to check their dashboard on their phone without rage-quitting
- Folks who value "it just works" over "it mostly works"

---

## Get v6 Aurora

v4.1 is MIT licensed — fork it, break it, fix it, learn from it.

**v6 Aurora is available for purchase.**
📧 Email: `hello.punsara@gmail.com
💬 phone:+94774153113

*Pricing and licensing details available on request. Bulk/org licenses available.*

---

## Contributing

PRs welcome for v4.1. Bug fixes, docs, small features.

**Note:** v6 Aurora development happens in a private repo. Contributors to v4 may get Aurora access — reach out if you're interested.

---

<p align="center"><sub>Built with Baileys, Express, and too much caffeine.</sub><br><sub>v4.1 • MIT License</sub></p>
