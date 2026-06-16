# SheetsCRM — Local setup guide

SheetsCRM is a Zendesk-style CRM that sits on top of your Google Forms intake sheet. Form submissions still land in Google Sheets; the CRM adds ticket workflow, email threads, SLAs, and a dashboard without replacing the sheet as the intake source of truth.

This guide walks through installing and configuring SheetsCRM on your Mac for local use.

---

## Table of contents

1. [What you need](#what-you-need)
2. [Quick start (macOS)](#quick-start-macos)
3. [Manual install](#manual-install)
4. [Environment configuration](#environment-configuration)
5. [Google sign-in setup](#google-sign-in-setup)
6. [Connect your intake sheet](#connect-your-intake-sheet)
7. [Market Manager directory](#market-manager-directory)
8. [First run checklist](#first-run-checklist)
9. [Where data is stored](#where-data-is-stored)
10. [Optional integrations](#optional-integrations)
11. [Updating SheetsCRM](#updating-sheetscrm)
12. [Troubleshooting](#troubleshooting)
13. [Column reference](#column-reference)

---

## What you need

| Requirement | Notes |
|-------------|--------|
| **macOS** (recommended) | Double-click launcher works out of the box. Windows/Linux: use [Manual install](#manual-install). |
| **Node.js 20+ (LTS)** | [https://nodejs.org](https://nodejs.org) — includes `npm`. |
| **Google account** | Same account you use to view the intake sheet in Chrome. |
| **Sheet access** | Viewer or Editor on the team intake Google Sheet. |
| **Google Cloud project** | One-time OAuth setup (≈10 min). See [Google sign-in setup](#google-sign-in-setup). |

You do **not** need to deploy to a server. Everything runs at `http://localhost:3000` on your machine.

---

## Quick start (macOS)

1. Clone or copy the `SheetsCRM` project folder to your Mac (e.g. `~/Desktop/projects/SheetsCRM`).
2. Double-click **`Open SheetsCRM.command`** in the project root.
   - First launch runs `npm install` automatically (may take a minute).
   - One Terminal window starts the server, opens your browser when ready, then minimizes itself to the Dock.
   - Leave that Terminal window running while you use the CRM. Press **Ctrl+C** to stop the server.

If macOS blocks the launcher (“unidentified developer”), right-click → **Open** → confirm once.

---

## Manual install

Use this on any OS, or if you prefer the terminal.

```bash
cd /path/to/SheetsCRM

cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Open **http://localhost:3000** in your browser.

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start local dev server (port 3000) |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run db:migrate` | Ensure `data/` folder exists for the local database |

---

## Environment configuration

Settings live in a **`.env`** file in the project root. This file is **not** committed to git — each teammate has their own copy.

### Option A — Setup UI (recommended)

1. Start the CRM.
2. Click the **gear icon** (top right) → **Environment** tab.
3. Enter values and click **Save** for each field.
4. Secrets are written to `.env` on your machine and shown only as masked previews after save.
5. The Environment editor only works on **localhost** (by design).

Some changes (especially `NEXT_PUBLIC_*` URLs) may require restarting the dev server.

### Option B — Edit `.env` directly

```bash
cp .env.example .env
```

Then open `.env` in a text editor. Minimum for live sheet access:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
USE_MOCK_DATA=false
```

See `.env.example` for all available keys (Mixmax, Salesforce, paths, refresh interval, etc.).

### Mock mode (no Google credentials)

If `USE_MOCK_DATA=true` or Google credentials are missing, the CRM loads **demo tickets** so you can explore the UI without a sheet connection.

---

## Google sign-in setup

SheetsCRM uses **Sign in with Google** so it can read your intake sheet and send email as you — the same account you already use in Chrome. The app cannot read Chrome’s saved passwords; you authorize it once via OAuth.

### 1. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `SheetsCRM Local`).

### 2. Enable APIs

In **APIs & Services → Library**, enable:

- **Google Sheets API**
- **Gmail API**

### 3. Configure OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **Internal** (if your org uses Google Workspace) or **External** for a personal Gmail.
3. Add scopes if prompted (Sheets + Gmail are requested at sign-in).
4. Add yourself as a test user if the app is in “Testing” mode.

### 4. Create OAuth credentials

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type: **Web application**
3. **Authorized redirect URI** (required):

   ```
   http://localhost:3000/api/auth/callback
   ```

4. Copy the **Client ID** and **Client secret** into `.env` or the Setup → Environment UI:

   ```env
   GOOGLE_CLIENT_ID=....apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=....
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   USE_MOCK_DATA=false
   ```

### 5. Sign in inside the app

1. Restart the dev server if you just changed `.env`.
2. Open http://localhost:3000
3. Click **Sign in with Google** in the header.
4. Approve access.

You do **not** need to share the sheet with a service account if you use OAuth — any sheet your Google account can open is accessible after sign-in.

### Alternative — Service account (optional)

For unattended/server use, you can use a service account instead of OAuth:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Share the intake sheet with that email as **Viewer** (read) or **Editor** (if sheet writes are required).

---

## Connect your intake sheet

### Default team sheet

The project ships with a default example sheet URL in `.env.example`. Your team’s live sheet may differ — always configure the correct URL in Setup.

### Setup wizard

1. Click the **gear icon** → **Sheet mapping** tab.
2. Paste your **Google Sheet URL** (the tab with form responses).
3. Click **Analyze columns**.
4. Review the mapping table — important columns include timestamp (A), email, reso/listing, Market Manager (H), contact reason (I), status (N), case summary (U), Airbnb User ID (AD).
5. Adjust any **Role** dropdowns if headers were mis-detected.
6. Click **Save**.

The mapping is stored in **`data/overlay.db`**, not in the browser.

### What syncs with the Google Sheet

| Direction | Column / field | When |
|-----------|----------------|------|
| **Sheet → CRM** | All intake columns | On refresh (~60s) |
| **CRM → Sheet** | **N** — Status | When you change CRM status (except “New”) |
| **CRM → Sheet** | **AD** — Airbnb User ID | When you save user ID in ticket detail |
| **CRM → Sheet** | **E / F** — Reso / Listing | When edited in CRM |
| **CRM → Sheet** | **I** — Contact reason | When changed in CRM |
| **CRM → Sheet** | **L** — User emailed | Set to “Yes” after you send from CRM |
| **CRM → Sheet** | **U** — Case summary | When you append admin notes |

CRM-only data (email thread copies, draft subjects, SLA timers, Gmail thread links) stays in **`data/overlay.db`**.

### Column N status values

When you update status in the CRM, Column N receives one of:

`Open` · `Pending` · `Resolved` · `Do Not Action` · `Longterm Hold/Bugs`

**New** is CRM-only (default for unassigned tickets) and is **not** written to the sheet.

---

## Market Manager directory

The CRM can auto-fill **CC Market Manager** on replies by looking up MM names from the sheet (Column H) in a local email directory.

1. **Gear icon** → **Market managers** tab.
2. Paste or edit the name → email list (one per line: `Name, email@…`).
3. **Save** — stored in `data/market-managers.json`.

The team directory is also committed in git as a starting point; each machine can update it via Setup.

---

## First run checklist

Use this after install:

- [ ] Node.js installed (`node -v` in Terminal)
- [ ] `.env` configured (UI or file) with Google Client ID + Secret
- [ ] `USE_MOCK_DATA=false` for live data
- [ ] CRM running (`Open SheetsCRM.command` or `npm run dev`)
- [ ] **Sign in with Google** in the app header
- [ ] **Setup → Sheet mapping** — analyzed and saved your sheet URL
- [ ] **Setup → Market managers** — directory loaded (optional but recommended)
- [ ] Open a ticket — confirm intake data loads
- [ ] **Sliders icon** — set default view/sort/dashboard period (saved to local DB)

### View preferences

Click the **sliders icon** in the header to set:

- Default ticket folder (All, New, Open, etc.)
- Default sort (form submission date vs recently updated)
- Default **dashboard time period** (all time, 6 months, 3 months, 1 month, 2 weeks)

These are saved in **`data/overlay.db`** and survive clearing Chrome cache or cookies.

---

## Where data is stored

Everything important for a smooth experience lives **on disk in the project folder**, not in the browser.

```
SheetsCRM/
├── .env                          # API keys & config (per machine, gitignored)
├── data/
│   ├── overlay.db                # CRM overlay: status, threads, prefs, sheet mapping
│   └── market-managers.json      # MM name → email directory
└── (Google Sheet)                # Intake rows + selected column writes
```

| Data | Location | Survives browser cache clear? |
|------|----------|-------------------------------|
| Tickets (intake) | Google Sheet | Yes |
| Dashboard numbers | Computed from sheet on each load | Yes (sheet unchanged) |
| CRM status, threads, Gmail links | `data/overlay.db` | Yes |
| View/sort/dashboard preferences | `data/overlay.db` | Yes |
| CC Market Manager per ticket | `data/overlay.db` | Yes |
| Google sign-in session | Browser cookie | **No** — sign in again after clearing cookies |
| Unsent reply drafts | Browser `localStorage` | **No** — convenience only |
| Mixmax starred templates | Browser `localStorage` | **No** — convenience only |

### Backup before updates or OS changes

Copy these to a safe place (or rely on Time Machine):

```
.env
data/overlay.db
data/market-managers.json
```

Do **not** delete the `data/` folder when pulling code updates.

---

## Optional integrations

### Mixmax templates

Requires a Mixmax API token (Growth+ plan).

```env
MIXMAX_API_TOKEN=your-token
```

Or set via **Setup → Environment**. Templates appear in the reply sidebar when composing.

### Salesforce search links

Column D values open in Salesforce unified search. Default base URL is in `.env.example`; override if needed:

```env
SALESFORCE_SEARCH_BASE_URL=https://airbnbnimbus.my.salesforce.com/_ui/search/ui/UnifiedSearchResults
```

### Auto-refresh interval

How often the CRM polls the sheet and threads (seconds):

```env
NEXT_PUBLIC_AUTO_REFRESH_SECONDS=60
```

---

## Updating SheetsCRM

```bash
cd /path/to/SheetsCRM
git pull
npm install
npm run dev
```

Keep your existing **`data/`** and **`.env`** — do not wipe them. If dependencies or env keys changed, check `.env.example` for new variables and add them via Setup → Environment.

---

## Troubleshooting

### “Sign in with Google” does nothing or errors

- Confirm redirect URI is exactly `http://localhost:3000/api/auth/callback`
- Check `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`
- Restart the dev server after changing `.env`
- If the OAuth app is in Testing mode, add your Google account as a test user

### Tickets show mock/demo data

- Set `USE_MOCK_DATA=false` in `.env`
- Sign in with Google
- Confirm your account can open the intake sheet in a browser tab

### Sheet not loading / sync failed

- Sign out and sign in again (cookie may have expired)
- Re-run **Setup → Analyze columns** on the correct sheet URL
- Check the sheet wasn’t moved or renamed

### User ID not saving to Column AD

- You must be signed in with Google (not mock mode)
- Save the field (blur the input or press Enter)
- Column AD is always the target column regardless of header mapping

### Environment changes not applying

- Restart the dev server (`Ctrl+C`, then launch again)
- `NEXT_PUBLIC_*` values are baked in at server start

### Port 3000 already in use

```bash
PORT=3001 npm run dev
```

Update `NEXT_PUBLIC_APP_URL` and the Google OAuth redirect URI to match if you change ports.

### macOS launcher won’t open

- Right-click **Open SheetsCRM.command** → Open
- Or run manually: `open "Open SheetsCRM.command"`

### Broken page / 404 errors for layout.css or main-app.js

Usually a **stale server** is still running on port 3000 from an earlier launch. Quit any old Terminal windows running SheetsCRM, then launch again with **Open SheetsCRM.command** (it now stops the previous server automatically).

If it still looks unstyled, hard-refresh the browser (**Cmd+Shift+R**) or run:

```bash
rm -rf .next && npm run dev
```

### Two Terminal windows appear

Terminal may open a blank default window on cold start. The launcher closes empty extra windows and keeps the one running SheetsCRM. If you still see two windows, set **Terminal → Settings → General → “On startup, open”** to **“Do not open any windows”** (or “New tab with default profile” if you already use tabs).

---

## Column reference

Default layout for the team intake sheet (0-based index → letter):

| Column | Role | Purpose |
|--------|------|---------|
| **A** | Timestamp | Form submission time (sorting, SLA, dashboard) |
| **D** | Email / Salesforce | Requester email; Salesforce search |
| **E** | Reservation code | Reso ID |
| **F** | Listing ID | Listing / space ID |
| **H** | Market Manager | MM name (read-only in CRM; used for CC lookup) |
| **I** | Contact reason | Reason dropdown |
| **K** | Internal tool K | Access URL/string |
| **L** | User emailed? | Set to “Yes” when CRM sends outbound email |
| **M** | Internal tool M | Access URL/string |
| **N** | Status | Sheet status (synced from CRM) |
| **R** | Internal tool R | Access URL/string |
| **U** | Case summary | Admin notes (append from CRM) |
| **AD** | Airbnb User ID | User ID for Nova / Become User links |

Headers are resolved at runtime via **Setup → Analyze columns**. Fixed positions above are used as fallbacks when headers are ambiguous.

---

## Architecture (high level)

```
Google Form  →  Google Sheet (intake + selected column writes)
                      ↓
                Google Sheets API
                      ↓
              SheetsCRM (localhost:3000)
                      ↓
         data/overlay.db (status, threads, prefs, mapping)
                      ↓
              Gmail API (replies, thread sync)
```

---

## Sharing with a coworker (zip / copy)

Do **not** zip your working folder as-is — it may include `.env`, `data/overlay.db`, and real Market Manager emails.

Create a sanitized copy:

```bash
npm run share:export
# or: bash scripts/create-shareable-copy.sh ../SheetsCRM-share
```

Then zip the output folder:

```bash
cd ..
zip -r SheetsCRM-share.zip SheetsCRM-share
```

The script excludes `node_modules`, `.next`, `.git`, local databases, and your real `.env`. It adds a placeholder `.env`, example market managers, and scrubs example sheet IDs in the copy only (your project is unchanged).

See `SHARE_PACKAGING.txt` inside the export for a handoff checklist.

---

## Getting help

- **Setup → Environment** — local config without editing files by hand
- **Setup → Sheet mapping** — column roles and sheet URL
- **Setup → Market managers** — CC directory
- **Sliders icon** — default view, sort, and dashboard period

For code issues, check the project repository or your team’s internal support channel.

---

## For engineers & security reviewers

See **[docs/ENGINEERING_AND_SECURITY.md](docs/ENGINEERING_AND_SECURITY.md)** for:

- Runtime architecture and API inventory
- OAuth / cookie / SQLite behavior
- Threat model and trust boundaries
- Known security findings and mitigations
- Guidance if deploying beyond localhost

## Hosted rollout & multi-coordinator planning

See **[docs/HOSTED_MULTI_COORDINATOR_ROADMAP.md](docs/HOSTED_MULTI_COORDINATOR_ROADMAP.md)** for:

- Vision for a web-hosted app for all Market Coordinators
- Unified intake form and single intake sheet
- Routing Market Manager selection → coordinator assignment
- Platform, auth, email, and data model changes required
- Phased delivery plan and effort sizing
