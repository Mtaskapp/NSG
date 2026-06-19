# SnapBot — Multiple WhatsApp Clients Setup Guide
## One Server · Many Numbers · Separate Google Sheets

---

## How It Works

```
                    ┌─────────────────────────────────────┐
                    │           SnapBot Server             │
                    │                                      │
 Client A users ──▶ │  /webhook/whatsapp                  │
 (Number +91-XXX)   │      │                              │
                    │      ├─ phoneNumberId = 111... ──▶  │ Sheet A
                    │      │                              │
 Client B users ──▶ │      ├─ phoneNumberId = 222... ──▶  │ Sheet B
 (Number +91-YYY)   │      │                              │
                    │      └─ phoneNumberId = 333... ──▶  │ Sheet C
 Client C users ──▶ │                                      │
 (Number +91-ZZZ)   └─────────────────────────────────────┘
```

- **One webhook URL** handles all clients
- Meta tells you which number received the message via `phone_number_id` in the payload
- SnapBot looks up that ID in `clients.json` and uses that client's token + sheet
- Sessions are namespaced per client so users on different numbers never cross

---

## What You Need Per Client

For each municipality / organization / client:

| Item | Where to get it |
|---|---|
| WhatsApp phone number | A SIM not registered on WhatsApp |
| Meta App (can be shared) | developers.facebook.com |
| Phone Number ID | Meta App → WhatsApp → API Setup |
| Access Token | Meta App → System User (permanent) |
| Verify Token | You invent this string |
| Google Sheet ID | From the sheet's URL |

> **One Meta App can hold multiple phone numbers.** You don't need a separate Meta App per client — just add numbers to the same app.

---

## STEP 1 — Add All Phone Numbers to Your Meta App

You already have one number from the initial setup. For each additional client:

1. Go to **Meta App Dashboard → WhatsApp → API Setup**
2. Under the "From:" dropdown, click **Add phone number**
3. Enter the client's phone number (must not be on WhatsApp already)
4. Verify it with the OTP Meta sends
5. **Copy the Phone Number ID** shown next to each number

You'll now have multiple Phone Number IDs, one per client:

```
Client A → Phone Number ID: 111111111111111
Client B → Phone Number ID: 222222222222222
Client C → Phone Number ID: 333333333333333
```

---

## STEP 2 — Create Access Tokens Per Client

Each client should use their **own permanent access token** so you can revoke one without affecting others.

### Option A — One System User per client (most isolated)

1. Go to **Meta Business Settings → System Users**
2. Click **Add** → name it `SnapBot - Client A` → Role: Admin
3. Click **Add Assets** → Apps → select your SnapBot app → Full Control
4. Click **Generate New Token** → select app → Never expiring
5. Permissions needed: `whatsapp_business_messaging`, `whatsapp_business_management`
6. **Copy the token** — only shown once!
7. Repeat for each client

### Option B — One System User, different tokens

Same system user, but generate separate tokens for tracking (they'll have the same permissions).

---

## STEP 3 — Create a Google Sheet Per Client

For each client:

1. Go to **https://sheets.google.com** → create a new sheet
2. Rename the first tab to exactly: **`Cases`**
3. **Share** the sheet with your service account email as Editor:
   - Click Share → enter `GOOGLE_SERVICE_ACCOUNT_EMAIL` from your `.env`
   - Role: Editor → Send
4. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit
   ```

You'll now have a Sheet ID per client:

```
Client A sheet → 1ABC...xyz
Client B sheet → 2DEF...uvw
Client C sheet → 3GHI...rst
```

---

## STEP 4 — Create clients.json

In your project root, copy the example:
```bash
cp clients.json.example clients.json
```

Edit `clients.json` with real values:

```json
[
  {
    "id": "client-hyderabad",
    "name": "Hyderabad Municipal Corporation",
    "whatsapp": {
      "phoneNumberId": "111111111111111",
      "accessToken":   "EAAxxxx...token for client A...xxxx",
      "verifyToken":   "snapbot-verify-hyd-2024"
    },
    "sheets": {
      "sheetId": "1ABC_HYDERABAD_GOOGLE_SHEET_ID"
    }
  },
  {
    "id": "client-secunderabad",
    "name": "Secunderabad Cantonment Board",
    "whatsapp": {
      "phoneNumberId": "222222222222222",
      "accessToken":   "EAAyyyy...token for client B...yyyy",
      "verifyToken":   "snapbot-verify-sec-2024"
    },
    "sheets": {
      "sheetId": "2DEF_SECUNDERABAD_GOOGLE_SHEET_ID"
    }
  },
  {
    "id": "client-warangal",
    "name": "Warangal Urban Development Authority",
    "whatsapp": {
      "phoneNumberId": "333333333333333",
      "accessToken":   "EAAzzzz...token for client C...zzzz",
      "verifyToken":   "snapbot-verify-wgl-2024"
    },
    "sheets": {
      "sheetId": "3GHI_WARANGAL_GOOGLE_SHEET_ID"
    }
  }
]
```

### Rules for clients.json:
- `id` — unique slug, no spaces (used in logs and session keys)
- `verifyToken` — must be unique per client (Meta uses this to verify your webhook)
- `phoneNumberId` — from Meta dashboard, not the actual phone number
- `sheetId` — the long ID from the Google Sheet URL

### ⚠️ Security: Never commit clients.json to Git
It contains access tokens. The `.gitignore` already excludes it.
For deployment, use one of the options in Step 5.

---

## STEP 5 — Deploy clients.json to Your Server

Since `clients.json` is excluded from Git, you need to get it onto your server securely.

### Option A — Railway / Render (environment variable)

Convert `clients.json` to a single environment variable:

```bash
# On your local machine, minify and base64-encode it:
cat clients.json | jq -c . | base64
```

Copy the output. In Railway/Render dashboard, add:
```
CLIENTS_JSON_B64=<the base64 string you copied>
```

Then update `src/config/clients.js` to decode it:

```js
// Add at top of load() function in clients.js:
if (process.env.CLIENTS_JSON_B64) {
  const raw = Buffer.from(process.env.CLIENTS_JSON_B64, 'base64').toString('utf8');
  _clients  = JSON.parse(raw);
  logger.info(`[Clients] Loaded ${_clients.length} client(s) from env`);
  return;
}
```

### Option B — VPS / Docker

Copy the file directly to the server:
```bash
scp clients.json user@your-server:/opt/snapbot/clients.json
```

Set file permissions so only the app user can read it:
```bash
chmod 600 /opt/snapbot/clients.json
```

### Option C — Docker Secret (most secure)

In `docker-compose.yml`:
```yaml
services:
  snapbot:
    secrets:
      - clients_config
    environment:
      CLIENTS_CONFIG_PATH: /run/secrets/clients_config

secrets:
  clients_config:
    file: ./clients.json
```

In `clients.js`, read from `process.env.CLIENTS_CONFIG_PATH || 'clients.json'`.

---

## STEP 6 — Register the Webhook (One URL, All Clients)

**All clients share the same webhook URL** — Meta identifies them by `phone_number_id` in the POST body, not the URL.

1. In Meta App → **WhatsApp → Configuration → Webhook → Edit**
2. Set:
   - **Callback URL:** `https://your-domain.com/webhook/whatsapp`
   - **Verify token:** use any ONE client's `verifyToken` for the initial verification
     (e.g., `snapbot-verify-hyd-2024`)
3. Click **Verify and Save** ✓
4. Subscribe to the **messages** webhook field

> You only need to register the webhook **once** regardless of how many clients you have. The same endpoint receives messages for all phone numbers in your Meta App.

---

## STEP 7 — Verify Everything Works

### Check the health endpoint:
```bash
curl https://your-domain.com/health
```

You should see:
```json
{
  "status": "ok",
  "platforms": { "whatsapp": true },
  "clients": [
    { "id": "client-hyderabad",    "name": "Hyderabad Municipal Corporation", "phone": "111111111111111" },
    { "id": "client-secunderabad", "name": "Secunderabad Cantonment Board",   "phone": "222222222222222" },
    { "id": "client-warangal",     "name": "Warangal Urban Development...",   "phone": "333333333333333" }
  ]
}
```

### Test each number independently:

1. **Client A's number** — send "hi" → confirm reply comes from Client A's sender
   → submit a test report → check **Client A's Google Sheet** has the new row

2. **Client B's number** — repeat → check **Client B's Google Sheet**

3. Verify rows do NOT appear in the wrong sheet

### Check server logs:
```
[WhatsApp] Webhook verified for client: client-hyderabad
[WhatsApp:client-hyderabad] Send failed:   ← includes client ID in all log lines
[Sheets] Case SB-XXX → sheet 1ABC...       ← shows which sheet was written to
```

---

## STEP 8 — Adding a New Client Later

When you onboard a new client, you only need to:

1. Add their phone number to Meta App (Step 1)
2. Generate their access token (Step 2)
3. Create and share their Google Sheet (Step 3)
4. Add a new entry to `clients.json` (Step 4)
5. Redeploy (no webhook re-registration needed)

No code changes required.

---

## Data Isolation Summary

| Data | Isolated? | How |
|---|---|---|
| WhatsApp conversations | ✅ Yes | Different phone numbers |
| User sessions | ✅ Yes | Session key includes `clientId` (`whatsapp:client-hyderabad:+919...`) |
| Case submissions | ✅ Yes | Each client's cases go to their own Google Sheet |
| Logs | ✅ Yes | Client ID included in every log line |
| Access tokens | ✅ Yes | Each client has their own token |

---

## Common Issues

### "Unknown phoneNumberId" in logs
```
Cause:  The phone number in the message doesn't match any client in clients.json
Fix:    Check the phoneNumberId in Meta dashboard matches exactly in clients.json
        (they look like 15-digit numbers, not the actual phone number)
```

### New client's messages not routing
```
Cause:  clients.json not redeployed / not picked up
Fix:    Restart the server after editing clients.json
        Confirm /health shows the new client in the "clients" array
```

### Wrong sheet getting the data
```
Cause:  phoneNumberId values swapped in clients.json
Fix:    Double-check each phoneNumberId in Meta → WhatsApp → API Setup
        (click "Manage" next to each number to see its ID)
```

### Webhook verification fails for a new client
```
Cause:  You only need to verify once — the verifyToken in clients.json is only
        used for the initial GET verification, not for ongoing messages
Fix:    Re-verify using any one client's verifyToken; others work automatically
```
