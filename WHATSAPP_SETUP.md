# SnapBot — WhatsApp Implementation Guide
## Step-by-Step: From Zero to Live

---

## What You Need Before Starting

- A **Facebook / Meta account** (personal is fine to start)
- A **phone number** that is NOT already registered on WhatsApp Business
  (Meta gives you a free test number, so you don't need to use yours initially)
- Your **SnapBot server running on a public HTTPS URL**
  (Railway, Render, or a VPS — covered in Step 5)
- A code editor (VS Code recommended)

Estimated time: **60–90 minutes** for first-time setup.

---

## Overview of Steps

```
Step 1 → Create Meta Developer Account
Step 2 → Create a Meta App
Step 3 → Add WhatsApp to the App
Step 4 → Get your credentials
Step 5 → Deploy SnapBot (get a public URL)
Step 6 → Configure .env
Step 7 → Register the webhook with Meta
Step 8 → Test with your phone
Step 9 → Go live (Business Verification)
Step 10 → Set up a permanent access token
```

---

## STEP 1 — Create a Meta Developer Account

1. Go to **https://developers.facebook.com**
2. Click **Get Started** in the top-right corner
3. Log in with your Facebook account
4. Accept the Meta Platform Policies
5. Complete the phone number verification if prompted

> ✅ You now have a Meta Developer account.

---

## STEP 2 — Create a Meta App

1. From the developer dashboard, click **My Apps** (top-right)
2. Click **Create App**
3. On the "What do you want your app to do?" screen, select **Other**
4. Click **Next**
5. Select app type: **Business**
6. Click **Next**
7. Fill in:
   - **App name:** `SnapBot` (or any name)
   - **App contact email:** your email
   - **Business Account:** leave blank for now (optional at this stage)
8. Click **Create App**
9. You may be asked to re-enter your Facebook password

> ✅ You now have a Meta App. You'll land on the App Dashboard.

---

## STEP 3 — Add WhatsApp to the App

1. On the App Dashboard, scroll down to find **WhatsApp** in the product list
2. Click **Set up** under WhatsApp
3. You'll be taken to the **WhatsApp Getting Started** page
4. Click **Continue** to accept the WhatsApp Business Platform terms

> ✅ WhatsApp is now added to your app.
> You'll see a left sidebar with **WhatsApp → Getting Started**, **API Setup**, etc.

---

## STEP 4 — Get Your Credentials

Go to **WhatsApp → API Setup** in the left sidebar.

You'll see a panel like this:

```
Step 1: Select phone numbers
  From: Test number  +1 555 XXX XXXX
  To: [your verified number]

Step 2: Send and receive messages
  Temporary access token: EAAxxxxxxxx...  [Copy]
  Phone number ID: 12345678901234         [Copy]
```

### 4a — Copy the Phone Number ID
- Find **Phone number ID** (looks like `123456789012345`)
- Click the copy icon
- **Save this as `WA_PHONE_NUMBER_ID`**

### 4b — Copy the Temporary Access Token
- Find **Temporary access token** (starts with `EAAG...` or `EAAx...`)
- Click copy
- **Save this as `WA_ACCESS_TOKEN`**

> ⚠️ This token expires in 24 hours. You'll replace it with a permanent one in Step 10.

### 4c — Create your Verify Token
- This is a secret string **you invent** — Meta will send it back to you when verifying your webhook
- Use something like: `snapbot-verify-2024` or any random string
- **Save this as `WA_VERIFY_TOKEN`**

### 4d — Add a test recipient
- Still on API Setup, under "To:", click the **Select a recipient number** dropdown
- Click **Manage phone number list**
- Add your personal WhatsApp number (with country code, e.g. `+919876543210`)
- Meta will send a verification code to that number via WhatsApp
- Enter the code to verify it

> ✅ You now have `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, and `WA_VERIFY_TOKEN` saved.

---

## STEP 5 — Deploy SnapBot (Get a Public HTTPS URL)

Your server must be reachable from the internet with HTTPS.
Choose one option:

---

### Option A — Railway (Recommended for beginners, free)

1. Create an account at **https://railway.app** (sign in with GitHub)
2. Click **New Project → Deploy from GitHub repo**
3. Connect your GitHub account and select your SnapBot repo
   - If you haven't pushed to GitHub yet:
     ```bash
     cd snapbot
     git init
     git add .
     git commit -m "Initial SnapBot commit"
     # Create a repo on github.com, then:
     git remote add origin https://github.com/YOUR_USER/snapbot.git
     git push -u origin main
     ```
4. Railway detects Node.js automatically
5. Click **Deploy**
6. After deploy, go to **Settings → Networking → Generate Domain**
7. Your URL will be: `https://snapbot-production.up.railway.app`
   (or similar — copy this)

---

### Option B — Render (free tier)

1. Go to **https://render.com** → New → **Web Service**
2. Connect GitHub and select your SnapBot repo
3. Set:
   - **Build command:** `npm install`
   - **Start command:** `node src/index.js`
   - **Environment:** Node
4. Click **Create Web Service**
5. Your URL will be: `https://snapbot.onrender.com`

> ⚠️ Render free tier sleeps after 15 min of inactivity. Use the paid plan ($7/mo) or Railway for a bot that needs instant responses.

---

### Option C — ngrok (Local dev / testing only)

If you just want to test before deploying:
```bash
# Terminal 1: run SnapBot locally
npm run dev

# Terminal 2: expose it publicly
npx ngrok http 3000
```
ngrok gives you a URL like `https://a1b2c3.ngrok.io` — use this as your `APP_URL`.

> ⚠️ ngrok URLs change every time you restart it. Fine for testing, not for production.

---

## STEP 6 — Configure Your .env File

In your project root, copy the example:
```bash
cp .env.example .env
```

Open `.env` and fill in these values (minimum required for WhatsApp):

```env
# App
NODE_ENV=production
PORT=3000
APP_URL=https://your-railway-url.up.railway.app   ← your URL from Step 5
LOG_LEVEL=info

# WhatsApp
WA_PHONE_NUMBER_ID=123456789012345    ← from Step 4a
WA_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxx    ← from Step 4b
WA_VERIFY_TOKEN=snapbot-verify-2024  ← from Step 4c
WA_WEBHOOK_PATH=/webhook/whatsapp

# Google Sheets (see README for setup)
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=snapbot@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

If using Railway or Render, paste these as **environment variables** in their dashboard instead of a .env file:

**Railway:** Project → Settings → Variables → Add all variables

**Render:** Service → Environment → Add environment variables

After saving variables, **redeploy** so the new values take effect.

---

## STEP 7 — Register the Webhook with Meta

This is the step where you connect Meta's servers to your SnapBot server.

1. In the Meta App Dashboard, go to **WhatsApp → Configuration** (left sidebar)
2. Under **Webhook**, click **Edit**
3. Fill in:
   - **Callback URL:** `https://your-domain.com/webhook/whatsapp`
     *(replace with your actual URL from Step 5)*
   - **Verify token:** `snapbot-verify-2024`
     *(exactly as you set in `WA_VERIFY_TOKEN`)*
4. Click **Verify and Save**

Meta will immediately send a GET request to your webhook URL with your verify token. SnapBot checks it and responds — if it matches, Meta shows **"Verified ✓"**.

> ❌ If verification fails:
> - Check your server is running (`https://your-domain.com/health` should return JSON)
> - Check `WA_VERIFY_TOKEN` in .env matches exactly what you typed in Meta dashboard
> - Check there are no trailing spaces

5. After verification, under **Webhook fields**, click **Manage**
6. Find **messages** and click **Subscribe**
7. Click **Done**

> ✅ Meta will now forward all incoming WhatsApp messages to your SnapBot server.

---

## STEP 8 — Test with Your Phone

1. Open WhatsApp on your phone
2. Find the **test sender number** (the one shown on Meta API Setup page — looks like `+1 555 XXX XXXX`)
3. Save it as a contact and open a chat with it
4. Send: **hi**

You should receive:

```
👋 Welcome to SnapBot — your civic issue reporting assistant!

I'll help you report a problem to the right department quickly.

What type of issue are you reporting?
[💡 Streetlight] [🌳 Park / Garden] [🚧 Road / Pothole]
[🧹 Cleanliness] [🌊 Drainage / Sewage] [🚦 Traffic Signal]
[❓ Other]
```

### Full test flow

| You send | SnapBot replies |
|----------|----------------|
| `hi` | Welcome + issue type buttons |
| Tap **🚧 Road / Pothole** | Asks for description |
| `There's a big pothole on MG Road near the bus stop` | Asks for location |
| `MG Road, near Ameerpet Bus Stop` | Asks for photo |
| `skip` | Shows confirmation summary |
| Tap **✅ Yes, Submit** | Returns Case ID, department assigned |

After submission, check your Google Sheet — a new row should appear with all case details.

---

## STEP 9 — Go Live (Remove Sandbox Restrictions)

In test/sandbox mode, you can only message numbers you've manually added in Step 4d.
To message anyone, you need to complete **Business Verification**.

### 9a — Create a Business Portfolio
1. Go to **https://business.facebook.com**
2. Click **Create account**
3. Enter your business name, your name, and business email
4. Follow the prompts to set up the Business Portfolio

### 9b — Add your WhatsApp number
1. In Meta App Dashboard, go to **WhatsApp → API Setup**
2. Under "From:", click **Add phone number**
3. Enter a real phone number that:
   - Is NOT currently registered on WhatsApp or WhatsApp Business
   - You have access to (to receive a verification call/SMS)
4. Verify it with the code Meta sends
5. This number will be your production SnapBot sender number

### 9c — Submit for Business Verification
1. Go to **Meta Business Settings → Security Centre**
2. Click **Start Verification**
3. You'll need to provide:
   - Business name and address
   - Business website
   - Business email (matching the domain)
   - One of: utility bill, bank statement, or business registration document
4. Submit and wait — typically **1–5 business days**

> ✅ Once verified, SnapBot can message any WhatsApp user who messages it first.

### 9d — Message Templates (for outbound proactive messages)
If you want to send update messages to users (e.g., "Your case SB-XYZ has been resolved"), you need **approved Message Templates**.

1. Go to **WhatsApp → Message Templates**
2. Click **Create Template**
3. Category: **Utility**
4. Example template:
   ```
   Your civic report {{1}} has been updated.
   Status: {{2}}
   Thank you for helping improve our city! 🏙️
   ```
5. Submit for review — typically approved within a few hours

---

## STEP 10 — Create a Permanent Access Token

The token from Step 4b expires in 24 hours. For production, create a permanent one.

### 10a — Create a System User
1. Go to **https://business.facebook.com** → Settings (gear icon)
2. Under **Users**, click **System Users**
3. Click **Add** → name it `SnapBot System User` → role: **Admin**
4. Click **Create System User**

### 10b — Assign the App
1. Click on the system user you just created
2. Click **Add Assets**
3. Select **Apps** → find your SnapBot app → assign role **Full Control**
4. Click **Save Changes**

### 10c — Generate Token
1. Still on the system user page, click **Generate New Token**
2. Select your SnapBot app
3. Set expiry to **Never**
4. Under permissions, select:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Click **Generate Token**
6. **Copy the token immediately** — it's only shown once

### 10d — Update your .env / Railway variables
```env
WA_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxx   ← replace with the new permanent token
```

Redeploy after updating.

> ✅ Your WhatsApp integration is now fully production-ready.

---

## Common Errors & Fixes

### "Webhook verification failed"
```
Cause:  WA_VERIFY_TOKEN doesn't match what's in Meta dashboard
Fix:    Copy the token from .env and paste it exactly into Meta's "Verify token" field
```

### "Message not delivered" / no response
```
Cause:  Webhook not subscribed to "messages" field
Fix:    WhatsApp → Configuration → Webhook fields → Subscribe to "messages"
```

### "Error 131030 — recipient phone number not in allowed list"
```
Cause:  Still in sandbox mode, can only message verified numbers
Fix:    Add the number in Meta API Setup → Manage phone number list
        OR complete Business Verification (Step 9)
```

### "Error 190 — access token expired"
```
Cause:  Using the 24-hour temporary token from Step 4b
Fix:    Create a permanent token (Step 10)
```

### Buttons not showing up (plain text instead)
```
Cause:  Interactive messages require an approved WhatsApp Business Account
Fix:    Complete Step 9 (Business Verification)
        Until then, buttons fall back to text on some platforms
```

### Google Sheet not updating
```
Cause:  Service account not shared with the sheet, or wrong Sheet ID
Fix:    Open your Google Sheet → Share → add the GOOGLE_SERVICE_ACCOUNT_EMAIL as Editor
```

---

## Checklist — Confirm Everything is Working

```
☐  /health endpoint returns { "status": "ok", "platforms": { "whatsapp": true } }
☐  Meta dashboard shows webhook as "Verified ✓"
☐  Webhook is subscribed to the "messages" field
☐  Sending "hi" gets a welcome reply with buttons
☐  Tapping a button moves to the next step
☐  Submitting a report adds a row to Google Sheets
☐  WA_ACCESS_TOKEN is a permanent token (not the 24h one)
☐  Business Verification submitted (for production messaging)
```

---

## Useful Links

| Resource | URL |
|---|---|
| Meta Developer Dashboard | https://developers.facebook.com |
| WhatsApp Cloud API Docs | https://developers.facebook.com/docs/whatsapp/cloud-api |
| Meta Business Suite | https://business.facebook.com |
| WhatsApp Message Templates | https://developers.facebook.com/docs/whatsapp/message-templates |
| Test your webhook manually | `curl -X GET "https://your-domain.com/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test123"` |
| SnapBot health check | `curl https://your-domain.com/health` |
