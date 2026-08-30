# PHANTOM — Railway Deployment Guide

## First Deploy

1. Push this repo to GitHub
2. In Railway → New Project → Deploy from GitHub repo
3. Set these environment variables in Railway Variables:
   ```
   WEB_SECRET=your_strong_password_here
   AI_MODE=none
   STEALTH_MODE=true
   ```
4. Deploy — Railway will build automatically

## ⚠️ CRITICAL: Add a Volume (prevents session loss on redeploy)

Without a volume, your WhatsApp QR expires and data resets every deploy.

1. In your Railway service → **Volumes** tab → **New Volume**
2. Mount path: `/data`
3. Add environment variable: `RAILWAY_VOLUME_MOUNT_PATH=/data`
4. Redeploy once

After this, your auth session and database persist forever.

## Scanning QR Code

1. Open: `https://your-railway-url.railway.app/qr`
2. Scan with WhatsApp → Linked Devices → Link a Device
3. Page auto-refreshes and redirects when connected

## If QR doesn't appear
- Wait 30 seconds and refresh `/qr`
- Check Railway logs for errors
- If "Logged out" appears: delete the `data/auth/` folder contents via Railway shell and redeploy

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `WEB_SECRET` | Yes | Password for dashboard API |
| `RAILWAY_VOLUME_MOUNT_PATH` | Strongly recommended | Path to mounted volume (`/data`) |
| `AI_MODE` | No | `claude`, `openai`, `gemini`, `none` |
| `AI_AUTO_REPLY` | No | `on` or `off` |
| `STEALTH_MODE` | No | `true` to hide online status |
| `ANTHROPIC_API_KEY` | If AI_MODE=claude | Your Claude API key |

## Accessing Dashboard

Open your Railway public URL. Login with your `WEB_SECRET`.

All API routes require header: `x-phantom-secret: your_secret`
