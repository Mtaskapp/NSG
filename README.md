# 🏛️ SnapBot — Multi-Platform Civic Issue Reporter

SnapBot lets residents report civic problems (broken streetlights, potholes, drainage issues, etc.) through **WhatsApp, Telegram, LINE, or a Web Widget**. Reports are automatically routed to the right department and logged to Google Sheets.

```
Resident → SnapBot → Google Sheets
              ↑
   WhatsApp | Telegram | LINE | Web
```

---

## Table of Contents

1. [Architecture](#architecture)
2. [Quick Start (Local Dev)](#quick-start-local-dev)
3. [Platform Setup](#platform-setup)
   - [WhatsApp (Meta Cloud API)](#1-whatsapp-meta-cloud-api)
   - [Telegram](#2-telegram)
   - [LINE](#3-line)
   - [Web Widget](#4-web-widget)
4. [Google Sheets Integration](#google-sheets-integration)
5. [Production Deployment](#production-deployment)
   - [Railway (recommended, free tier)](#option-a-railway-recommended)
   - [Render](#option-b-render)
   - [Docker / VPS](#option-c-docker--vps)
   - [AWS / GCP / Azure](#option-d-aws--gcp--azure)
6. [Environment Variables Reference](#environment-variables-reference)
7. [Conversation Flow](#conversation-flow)
8. [Customization Guide](#customization-guide)
9. [Scaling to Production](#scaling-to-production)
10. [Troubleshooting](#troubleshooting)

---

## Architecture

```
src/
├── index.js                   # Express app, wires all adapters
├── adapters/
│   ├── whatsapp.js            # Meta WhatsApp Cloud API
│   ├── telegram.js            # Telegram Bot API
│   ├── line.js                # LINE Messaging API
│   └── web.js                 # REST API for web widget
├── conversation/
│   └── engine.js              # Platform-agnostic state machine
├── handlers/
│   └── sheetsHandler.js       # Google Sheets logging
│   ├── mediaHandler.js        # WhatsApp media download + Cloudflare R2
│   └── trackingHandler.js     # Ticket append and portal lookup
├── routes/
│   └── tracking.js            # GET /:ticketId progress portal
└── utils/
    ├── sessionStore.js        # In-memory sessions (swap Redis in prod)
    └── logger.js              # Winston structured logging
public/
└── widget.html                # Embeddable web chat widget
```

The Meta WhatsApp webhook uses a dedicated five-state flow (`START`,
`AWAITING_CATEGORY`, `AWAITING_DESC`, `AWAITING_LOC`, `AWAITING_IMAGE`). Images
are downloaded with the WhatsApp bearer token, uploaded to the S3-compatible
Cloudflare R2 endpoint, and logged with an exactly eight-column tracking row.
Set the `R2_*` variables in `.env`; `R2_PUBLIC_BASE_URL` must point at a public
custom domain or R2 public bucket URL.

**Key design decisions:**
- The `engine.js` state machine is 100% platform-agnostic — it knows nothing about WhatsApp or Telegram.
- Each adapter normalises its platform's events into a common message format.
- Sessions are in-memory with a 30-minute TTL; swap `sessionStore.js` for Redis when running multiple instances.

## Cloudflare R2 Image Storage

WhatsApp image messages are not stored on Railway. SnapBot downloads the
temporary WhatsApp media asset, uploads the binary image to Cloudflare R2, and
writes the resulting public CDN URL into the Google Sheets tracking row.

Configure these variables in Railway:

```env
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET=issue-images
R2_PUBLIC_BASE_URL=https://cdn.example.com
```

`R2_PUBLIC_BASE_URL` must point to a public R2 custom domain or public bucket
URL. Images are stored under the `issues/` prefix. The R2 access key should
have permission to write objects to this bucket.

---

## Quick Start (Local Dev)

### Prerequisites
- Node.js 18+
- A public HTTPS URL for webhooks (use [ngrok](https://ngrok.com) locally)

```bash
# 1. Clone / download
git clone <repo-url> snapbot && cd snapbot

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your credentials (see Environment Variables section)

# 4. Start in dev mode (hot-reload + Telegram long-polling)
npm run dev
```

For local webhook testing, open a second terminal:
```bash
npx ngrok http 3000
# → copy the https://xxxx.ngrok.io URL into APP_URL in .env
```

---

## Platform Setup

### 1. WhatsApp (Meta Cloud API)

**Requirements:** A Meta Developer account and a Facebook Business account.

#### Step 1 — Create a Meta App
1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App**
2. Select **Business** type → name it "SnapBot"
3. In the app dashboard, click **Add Product** → **WhatsApp**

#### Step 2 — Get credentials
Under **WhatsApp → API Setup:**
- Copy the **Phone Number ID** → `WA_PHONE_NUMBER_ID`
- Generate a **temporary or permanent access token** → `WA_ACCESS_TOKEN`
  - For production, create a **System User** in Business Manager and generate a permanent token

#### Step 3 — Register a phone number
- Test number: Meta provides a free sandbox number immediately
- Production: Add and verify your own business phone number (takes 1–3 days)

#### Step 4 — Configure the webhook
1. In **WhatsApp → Configuration**, set:
   - **Webhook URL:** `https://your-domain.com/webhook/whatsapp`
   - **Verify Token:** any secret string (put it in `WA_VERIFY_TOKEN`)
2. Click **Verify and Save**
3. Subscribe to the **messages** webhook field

#### Step 5 — Set .env values
```env
WA_PHONE_NUMBER_ID=123456789012345
WA_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxx
WA_VERIFY_TOKEN=my-secret-verify-token
```

#### WhatsApp-specific notes
- **Button limit:** WhatsApp supports max 3 quick-reply buttons. For 4+ options, SnapBot automatically switches to a list message.
- **24-hour window:** You can only reply to a user within 24 hours of their last message. For proactive updates, you need approved Message Templates.
- **Business verification:** Required before you can message anyone outside the test sandbox.

---

### 2. Telegram

#### Step 1 — Create a bot
1. Open Telegram → search for **@BotFather** → `/start`
2. Run `/newbot` → follow prompts → get your **Bot Token**
3. Optionally set `/setdescription` and `/setuserpic` on BotFather

#### Step 2 — Set .env values
```env
TELEGRAM_BOT_TOKEN=7123456789:AAGxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_USE_WEBHOOK=true          # false for local dev (uses polling)
TELEGRAM_WEBHOOK_PATH=/webhook/telegram
```

#### Step 3 — Register the webhook (production only)
SnapBot registers the webhook automatically on startup when `TELEGRAM_USE_WEBHOOK=true` and `APP_URL` is set.

Or register manually:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain.com/webhook/telegram"
```

**Dev mode:** Set `TELEGRAM_USE_WEBHOOK=false` — SnapBot uses long-polling, no public URL needed.

#### Telegram-specific notes
- Telegram supports **inline keyboards** (SnapBot uses these for buttons).
- No 24-hour messaging window — you can message users any time after they've started the bot.
- Bot commands: you can optionally add `/start` in BotFather for a menu entry.

---

### 3. LINE

#### Step 1 — Create a LINE channel
1. Go to [developers.line.biz](https://developers.line.biz) → **Console**
2. Create a **Provider** → Create a **Messaging API Channel**
3. Under **Basic settings**, get:
   - **Channel Secret** → `LINE_CHANNEL_SECRET`
4. Under **Messaging API**, issue a **Channel Access Token (long-lived)** → `LINE_CHANNEL_ACCESS_TOKEN`

#### Step 2 — Configure webhook
Under **Messaging API → Webhook settings:**
- **Webhook URL:** `https://your-domain.com/webhook/line`
- Enable **Use webhook**
- Disable **Auto-reply messages** and **Greeting messages** (SnapBot handles these)

#### Step 3 — Set .env values
```env
LINE_CHANNEL_SECRET=abcdef1234567890abcdef1234567890
LINE_CHANNEL_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

#### LINE-specific notes
- LINE's **Button Template** supports max 4 buttons. SnapBot uses 4 per message, cycling through all options.
- LINE verifies webhook signatures using the Channel Secret — SnapBot handles this via `line.middleware()`.
- Test by adding your bot as a friend on LINE using the QR code in the developer console.

---

### 4. Web Widget

The web widget is a self-contained HTML file at `public/widget.html`. No additional API setup is needed — it calls your own `/api/chat` endpoint.

#### Embed on any website

**Option A — iFrame (simplest):**
```html
<iframe
  src="https://your-domain.com/widget.html"
  width="420"
  height="680"
  style="border:none;border-radius:24px;box-shadow:0 4px 24px rgba(0,0,0,.15)">
</iframe>
```

**Option B — Floating chat button:**
```html
<button id="chat-btn" onclick="document.getElementById('chat-frame').style.display='block'"
  style="position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;
         background:#2563EB;border:none;cursor:pointer;font-size:24px;color:#fff;
         box-shadow:0 4px 12px rgba(37,99,235,.4)">💬</button>

<iframe id="chat-frame"
  src="https://your-domain.com/widget.html"
  style="display:none;position:fixed;bottom:90px;right:24px;
         width:420px;height:680px;border:none;border-radius:24px;
         box-shadow:0 8px 32px rgba(0,0,0,.2);z-index:9999">
</iframe>
```

**Option C — Point widget at a different API host:**
Add before the widget loads:
```html
<script>window.SNAPBOT_API = 'https://your-snapbot-server.com/api/chat';</script>
```

#### CORS configuration
Ensure `WEB_WIDGET_CORS_ORIGINS` lists all domains that will embed the widget:
```env
WEB_WIDGET_CORS_ORIGINS=https://city-website.gov,https://portal.municipality.org
```

---

## Google Sheets Integration

SnapBot logs every submitted report to a Google Sheet.

### Step 1 — Create a Google Cloud project
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g., "SnapBot")
3. Enable the **Google Sheets API**: APIs & Services → Library → search "Sheets"

### Step 2 — Create a Service Account
1. IAM & Admin → **Service Accounts** → Create
2. Name: `snapbot-sheets`; Role: **Editor** (or create a custom role with Sheets write access)
3. Click the service account → **Keys** → Add Key → JSON
4. Download the JSON key file

### Step 3 — Extract credentials from the JSON
From the downloaded JSON:
```json
{
  "client_email": "snapbot-sheets@your-project.iam.gserviceaccount.com",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
}
```

Set in `.env`:
```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=snapbot-sheets@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\n"
```

> **Note:** The private key must have literal `\n` characters (not actual newlines) in the `.env` file. The app replaces them automatically.

### Step 4 — Create and share the Sheet
1. Create a new Google Sheet: [sheets.google.com](https://sheets.google.com)
2. Rename the first tab to exactly: `Cases`
3. **Share** the sheet with your service account email (Editor access)
4. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**`1BxiM...`**`/edit`

```env
GOOGLE_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
```

SnapBot auto-creates the header row on first run.

---

## Production Deployment

Your server **must have a public HTTPS URL** — Meta, Telegram, and LINE all require it for webhooks.

---

### Option A — Railway (Recommended)

Railway gives you HTTPS, auto-deploys from GitHub, and has a free tier that covers SnapBot's load.

```bash
# 1. Push your code to GitHub

# 2. Go to railway.app → New Project → Deploy from GitHub repo

# 3. Add environment variables in Railway dashboard
#    (Settings → Variables → paste all values from .env)

# 4. Railway auto-detects Node.js and runs: node src/index.js
#    Copy the generated domain (e.g., snapbot-production.up.railway.app)
#    and set APP_URL in the Railway variables

# 5. Register webhooks using the Railway URL
```

**Estimated cost:** Free for hobby projects; ~$5/mo for always-on.

---

### Option B — Render

```bash
# 1. Push to GitHub

# 2. render.com → New → Web Service → connect repo

# 3. Build command:  npm install
#    Start command:  node src/index.js
#    Environment:    Node

# 4. Add all environment variables in Render dashboard

# 5. Use the Render HTTPS URL for APP_URL and webhook registration
```

**Free tier note:** Render free tier spins down after 15 min idle. Use the paid plan ($7/mo) or Railway for always-on.

---

### Option C — Docker / VPS

For a VPS (Ubuntu 22.04 recommended — DigitalOcean, Hetzner, Linode, etc.):

```bash
# ── On your local machine ──────────────────────────────────────────
# Build and push image to Docker Hub (or any registry)
docker build -t yourdockerhub/snapbot:latest .
docker push yourdockerhub/snapbot:latest

# ── On the VPS ────────────────────────────────────────────────────
# 1. Install Docker
curl -fsSL https://get.docker.com | sh

# 2. Clone the repo (for docker-compose.yml and nginx config)
git clone <repo-url> /opt/snapbot && cd /opt/snapbot

# 3. Copy and fill in .env
cp .env.example .env && nano .env

# 4. Get SSL certificate (Let's Encrypt)
sudo apt install certbot
sudo certbot certonly --standalone -d your-domain.com
# Certs land in /etc/letsencrypt/live/your-domain.com/
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem  nginx/certs/

# 5. Update nginx/default.conf with your domain

# 6. Start the full stack with Nginx
docker compose --profile prod up -d

# 7. Check health
curl https://your-domain.com/health
```

**Auto-renew SSL:**
```bash
sudo crontab -e
# Add: 0 3 * * * certbot renew --quiet && docker compose -f /opt/snapbot/docker-compose.yml restart nginx
```

---

### Option D — AWS / GCP / Azure

SnapBot is a standard Node.js app. Recommended services:

| Provider | Service | Notes |
|----------|---------|-------|
| AWS      | Elastic Beanstalk | Easiest; handles scaling, SSL via ACM |
| AWS      | ECS Fargate | Docker-native, pay-per-use |
| GCP      | Cloud Run | Serverless Docker; auto-scales to zero |
| Azure    | App Service | Node.js native, free SSL |

**GCP Cloud Run (quick deploy):**
```bash
# Authenticate
gcloud auth login

# Build and push to Google Container Registry
gcloud builds submit --tag gcr.io/YOUR_PROJECT/snapbot

# Deploy
gcloud run deploy snapbot \
  --image gcr.io/YOUR_PROJECT/snapbot \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,PORT=8080 \
  --set-secrets WA_ACCESS_TOKEN=WA_ACCESS_TOKEN:latest,...

# Get the service URL — use it as APP_URL
gcloud run services describe snapbot --format='value(status.url)'
```

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | `production` or `development` |
| `PORT` | No | HTTP port (default `3000`) |
| `APP_URL` | Yes (prod) | Public HTTPS base URL (no trailing slash) |
| `LOG_LEVEL` | No | `info`, `debug`, `warn`, `error` |
| **WhatsApp** | | |
| `WA_PHONE_NUMBER_ID` | WA only | Meta phone number ID |
| `WA_ACCESS_TOKEN` | WA only | Meta Graph API access token |
| `WA_VERIFY_TOKEN` | WA only | Webhook verify token (you choose this) |
| **Telegram** | | |
| `TELEGRAM_BOT_TOKEN` | TG only | BotFather token |
| `TELEGRAM_USE_WEBHOOK` | No | `true` for prod, `false` for dev polling |
| **LINE** | | |
| `LINE_CHANNEL_SECRET` | LINE only | From LINE developer console |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE only | Long-lived token from console |
| **Web widget** | | |
| `WEB_WIDGET_ENABLED` | No | `true` (default) / `false` to disable |
| `WEB_WIDGET_CORS_ORIGINS` | No | Comma-separated allowed origins, or `*` |
| **Google Sheets** | | |
| `GOOGLE_SHEET_ID` | Yes | Spreadsheet ID from URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Yes | Service account email |
| `GOOGLE_PRIVATE_KEY` | Yes | Private key (with `\n` escaped) |
| **Security** | | |
| `RATE_LIMIT_WINDOW_MS` | No | Rate limit window (default `60000`) |
| `RATE_LIMIT_MAX_REQUESTS` | No | Max requests per window (default `60`) |

---

## Conversation Flow

```
START / "hi"
    │
    ▼
ASK_ISSUE_TYPE  ─── buttons: Streetlight / Park / Road / Cleanliness / Drainage / Traffic / Other
    │
    ▼
ASK_DESCRIPTION  ─── free text
    │
    ▼
ASK_LOCATION  ─── text / GPS share / "skip"
    │
    ▼
ASK_PHOTO  ─── image / "skip"
    │
    ▼
CONFIRM  ─── "Yes, Submit" → SUBMIT
             "Start Over"  → WELCOME
    │
    ▼
SUBMIT  ─── logs to Google Sheets, returns Case ID
```

Department routing (from `engine.js`):

| Issue | Department |
|---|---|
| Streetlight | Parks & Lighting Dept |
| Park / Garden | Parks & Recreation Dept |
| Road / Pothole | Public Works Dept |
| Cleanliness | Sanitation Dept |
| Drainage / Sewage | Water & Drainage Dept |
| Traffic Signal | Traffic Mgmt Centre |
| Other | Municipal Office |

---

## Customization Guide

### Add a new issue category

In `src/conversation/engine.js`:
```js
// Add to ISSUE_TYPES array
{ id: 'noise', label: '🔊 Noise Complaint' },

// Add to DEPARTMENT_MAP
noise: { name: 'Community Relations Dept', contact: 'noise@city.gov' },
```

### Change the bot name / greeting

Edit the welcome message in `engine.js`:
```js
text: `👋 Welcome to *CityBot* — your civic reporting assistant!...`
```

And update `public/widget.html` header section.

### Add Redis session store (multi-instance)

Install: `npm install ioredis`

Replace `sessionStore.js`:
```js
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);
const TTL   = 30 * 60; // seconds

async function getSession(platform, userId) {
  const key  = `session:${platform}:${userId}`;
  const data = await redis.get(key);
  if (data) return JSON.parse(data);
  const session = { platform, userId, step: 'WELCOME', data: {} };
  await redis.setex(key, TTL, JSON.stringify(session));
  return session;
}
// ... updateSession, clearSession similarly
```

### Add email notifications

Install: `npm install nodemailer`

In `engine.js`, after `sheetsHandler.logCase(report)`:
```js
await mailer.send({
  to: dept.contact,
  subject: `New Case ${caseId}: ${report.issueLabel}`,
  text: `Description: ${report.description}\nLocation: ${report.location}`,
});
```

---

## Scaling to Production

| Concern | Recommendation |
|---|---|
| Sessions | Replace `sessionStore.js` with Redis (use [Upstash](https://upstash.com) for free managed Redis) |
| Multiple instances | Sessions in Redis + stateless app = horizontal scaling works |
| Photo storage | Save WhatsApp media to Cloudflare R2; store the public URL in Sheets |
| Rate limiting | Move from in-process rate limiter to Redis-backed (`rate-limit-redis`) |
| Monitoring | Add [Sentry](https://sentry.io) for error tracking; use `/health` for uptime checks |
| CI/CD | GitHub Actions → build Docker image → push to registry → deploy |
| Database | For case tracking / status updates, migrate Sheet logging to PostgreSQL |

---

## Troubleshooting

### WhatsApp webhook verification fails
- Ensure `WA_VERIFY_TOKEN` in `.env` exactly matches what you entered in Meta dashboard
- Confirm your server is reachable at the webhook URL (test with `curl https://your-domain.com/webhook/whatsapp`)

### Telegram bot not responding
- In dev: check `TELEGRAM_USE_WEBHOOK=false` and logs for polling errors
- In prod: verify `APP_URL` is set correctly and the webhook is registered (`/health` shows `telegram: true`)

### LINE signature verification error (403)
- Check `LINE_CHANNEL_SECRET` is correct — it's different from the access token
- Make sure you're not double-parsing the body (LINE middleware needs raw body)

### Google Sheets: "The caller does not have permission"
- Confirm the sheet is shared with the service account email (Editor)
- Confirm the Sheets API is enabled in your GCP project
- Check that `GOOGLE_PRIVATE_KEY` has `\n` (not actual newlines) in the .env file

### Messages work but buttons don't appear
- WhatsApp: Interactive messages require your phone number to be in a verified WhatsApp Business account (sandbox has limits)
- LINE: Ensure `Use webhook` is ON and auto-reply is OFF in the LINE console

### Session not persisting between messages
- In-memory sessions are lost on server restart — expected in dev
- If you're running multiple instances in production, sessions won't be shared — add Redis

---

## License

MIT — Free for commercial and municipal use.
