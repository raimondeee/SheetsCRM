# SheetsCRM — Local setup guide

SheetsCRM is a Zendesk-style CRM that sits on top of your Google Forms intake sheet. Form submissions still land in Google Sheets; the CRM adds ticket workflow, email threads, SLAs, team coverage, dashboards, and reporting without replacing the sheet as the intake source of truth.

This guide walks through installing and configuring SheetsCRM on your Mac for local use. For engineers reviewing architecture, trust boundaries, and module map, see [`docs/ENGINEERING_AND_SECURITY.md`](docs/ENGINEERING_AND_SECURITY.md) (key source files also have short orientation headers at the top of the file).

Word and rich-text copies of this guide are available at:

- [`docs/SheetsCRM-Local-Setup-Guide.docx`](docs/SheetsCRM-Local-Setup-Guide.docx)
- [`docs/SheetsCRM-Local-Setup-Guide.rtf`](docs/SheetsCRM-Local-Setup-Guide.rtf)

---

## Table of contents

1. [What you need](#what-you-need)
2. [Quick start (macOS)](#quick-start-macos)
3. [One-click Mac setup](#one-click-mac-setup)
4. [Manual install](#manual-install)
5. [Environment configuration](#environment-configuration)
6. [Google sign-in setup](#google-sign-in-setup)
7. [Connect your intake sheet](#connect-your-intake-sheet)
8. [Setup tabs](#setup-tabs)
9. [Preferences](#preferences)
10. [Day-to-day features](#day-to-day-features)
11. [First run checklist](#first-run-checklist)
12. [Where data is stored](#where-data-is-stored)
13. [Optional integrations](#optional-integrations)
14. [Updating SheetsCRM](#updating-sheetscrm)
15. [Troubleshooting](#troubleshooting)
16. [Column reference](#column-reference)

---

## What you need

| Requirement | Notes |
|-------------|--------|
| **macOS** (recommended) | Double-click launcher works out of the box. Windows/Linux: use [Manual install](#manual-install). |
| **Homebrew** (macOS) | Package manager used to install Node.js. See [Install Homebrew and Node.js](#install-homebrew-and-nodejs) below. |
| **Node.js 20–22 (LTS)** | Install with Homebrew (`brew install node@22`), or the **20.x / 22.x LTS** installer from [https://nodejs.org](https://nodejs.org). Do not use Node 23+ yet (native SQLite build fails). Includes `npm`. |
| **Google account** | Same account you use to view the intake sheet in Chrome. |
| **Sheet access** | Viewer or Editor on the team intake Google Sheet. |
| **Google Cloud project** | One-time OAuth setup (≈10–15 min). See [Google sign-in setup](#google-sign-in-setup). |

You do **not** need to deploy to a server. Everything runs at `http://localhost:3000` on your machine.

### Install Homebrew and Node.js

On a Mac that does not already have Node.js, install Homebrew first, then Node:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow any on-screen steps Homebrew prints (on Apple Silicon it often asks you to add Homebrew to your `PATH`).

Then install Node.js 22 LTS:

```bash
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zprofile
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

On Intel Macs, use `/usr/local/opt/node@22/bin` instead of `/opt/homebrew/opt/node@22/bin`.

Confirm:

```bash
brew -v
node -v
npm -v
```

`node -v` should report **v20**, **v21**, or **v22** (not v23+).

Keep the project folder path **free of spaces** (e.g. `~/Documents/SheetsCRM`, not `Robert CRM`).

---

## Quick start (macOS)

1. Clone or copy the `SheetsCRM` project folder to your Mac (e.g. `~/Desktop/projects/SheetsCRM`).
2. Double-click **`Install SheetsCRM.command`** in the project root if this Mac has not been set up yet.
3. Double-click **`Open SheetsCRM.command`** in the project root.
   - First launch runs `npm install` automatically (may take a minute).
   - One Terminal window starts the server, opens your browser when ready, then minimizes itself to the Dock.
   - Leave that Terminal window running while you use the CRM. Press **Ctrl+C** to stop the server.

If macOS blocks the launcher (“unidentified developer”), right-click → **Open** → confirm once.

---

## One-click Mac setup

Double-click **`Install SheetsCRM.command`** once on each Mac before opening the CRM. It:

1. Opens **System Settings → Privacy & Security** so the user can resolve a Gatekeeper warning if macOS blocked the downloaded script.
2. Checks for Homebrew and, with the user's confirmation, runs Homebrew's official installer if it is missing.
3. Installs Node.js 22 LTS (not the latest Homebrew `node`, which can be too new for the SQLite package), installing Xcode Command Line Tools when macOS needs them.
4. Creates `.env` from `.env.example` when needed, installs the locked npm packages, and prepares the local data folder.
5. Creates **`~/Documents/SheetsCRM-Attachments`** (default download root; changeable later in Preferences) and registers a small **`crmfolder://`** helper so the CRM’s **Folder** button opens that path in Finder (for Drive/Slack uploads). **Open SheetsCRM.command** re-runs this step if needed.

The installer cannot bypass macOS security controls, approve Gatekeeper prompts, or enter an administrator password. If the installer itself is blocked before it starts, right-click **`Install SheetsCRM.command`** → **Open** → **Open**, or go to **System Settings → Privacy & Security** and select **Open Anyway**. Review and accept the Homebrew installer only if you trust the copy of SheetsCRM you received.

After setup, double-click **`Open SheetsCRM.command`**. The initial `.env` uses demo data; configure Google OAuth in **Setup → Environment** for live sheets.

---

## Manual install

Use this on any OS, or if you prefer the terminal.

**macOS:** install Homebrew and Node.js first (see [Install Homebrew and Node.js](#install-homebrew-and-nodejs)).

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

See `.env.example` for all available keys (Mixmax, Salesforce, paths, refresh interval, quality-sheet notes, etc.).

### Mock mode (no Google credentials)

If `USE_MOCK_DATA=true` or Google credentials are missing, the CRM loads **demo tickets** so you can explore the UI without a sheet connection.

---

## Google sign-in setup

SheetsCRM uses **Sign in with Google** so it can read your intake sheet, send email as you, show calendar reminders, and suggest contacts — the same Google account you already use in Chrome. The app cannot read Chrome’s saved passwords; you authorize it once via OAuth.

### 1. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `SheetsCRM Local`).

### 2. Enable APIs

In **APIs & Services → Library**, enable:

- **Google Sheets API** — intake sheet read/write
- **Gmail API** — send replies, import threads, unread inbox
- **Google Calendar API** — upcoming events and reminders
- **Google People API** — recipient suggestions from Contacts / directory

### 3. Configure OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **Internal** (if your org uses Google Workspace) or **External** for a personal Gmail.
3. Add scopes if prompted. At sign-in the app requests:
   - Sheets (read/write)
   - Gmail send, readonly, modify, and settings.basic
   - Calendar readonly
   - Contacts / Other contacts / Directory readonly
   - OpenID, email, profile
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

**After pulling updates that add new Google scopes**, sign out and sign in again so Google re-prompts for the new permissions (for example Calendar, Contacts, or Gmail modify for the unread inbox).

### Alternative — Service account (optional)

For unattended/server use, you can use a service account instead of OAuth:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Share the intake sheet with that email as **Viewer** (read) or **Editor** (if sheet writes are required). Service accounts support **Sheets only** — Gmail, Calendar, and Contacts require user OAuth.

---

## Connect your intake sheet

### Default team sheet

The project ships with a default example sheet URL in `.env.example`. Your team’s live sheet may differ — always configure the correct URL in Setup.

### Setup wizard

1. Click the **gear icon** → **Sheet mapping** tab.
2. Paste your **Google Sheet URL** (the tab with form responses).
3. Click **Analyze columns** (first-time setup) or **Detect columns** (after someone deletes/reorders sheet columns).
4. Review the mapping table — important columns include timestamp, email, reso/listing, Market Manager, contact reason, status, case summary, Airbnb User ID.
5. Adjust any **Role** dropdowns if headers were mis-detected.
6. Optionally configure ticket header field slots and custom display labels.
7. Click **Save**.

The mapping is stored in **`data/overlay.db`**, not in the browser. Ticket loads also rematch roles from live header names automatically (with warnings if columns drifted); Detect + Save updates the stored letters.

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

CRM-only data (email thread copies, draft subjects, SLA timers, Gmail thread links, cover-sheet overlays, CRM event log) stays in **`data/overlay.db`**.

### Column N status values

When you update status in the CRM, Column N receives one of:

`Open` · `Pending` · `Resolved` · `Do Not Action` · `Longterm Hold/Bugs`

**New** is CRM-only (default for unassigned tickets) and is **not** written to the sheet.

---

## Setup tabs

Click the **gear icon** to open Setup. Tabs:

| Tab | What it configures |
|-----|--------------------|
| **Sheet mapping** | Primary intake sheet URL, column roles, header field slots |
| **Team coverage** | Up to 10 teammate intake sheets merged into your inbox (enable, label, per-sheet mapping) |
| **Market managers** | Name → email directory used for CC and recipient suggestions |
| **Environment** | Whitelisted `.env` keys (localhost only) |
| **Business hours** | Working days, start/end hour, timezone — used for SLA clocks and service metrics |

### Team coverage (cover sheets)

Use **Team coverage** when you temporarily cover another coordinator’s intake sheet:

1. Enable a cover slot and give it a short label (e.g. teammate name).
2. Paste their sheet URL, analyze/map columns, and save.
3. Covered tickets appear in the unified inbox with a source banner.
4. Use **Ignore** on a cover ticket when it should leave your active queue; use resync if the sheet row changed.

Cover configuration is stored in SQLite (`overlay.db`), not as a separate JSON file.

### Team Dashboard regional source sheets

Use **Team Dashboard reporting sources** to choose the teammate sheets included in the
**Team Dashboard**. This is separate from cover sheets: reporting sources contribute
read-only metrics and do **not** add tickets to your inbox.

1. Open the **gear icon** → **Team coverage**.
2. Under **Team dashboard reporting sources**, click **Configure reporting sources**.
3. Review the prefilled sources, then enable only the teams that should contribute to reporting.
4. Click **Save sources**, then refresh the Team Dashboard to load the updated sources.

The first time this panel opens, it displays the CRM's existing regional dashboard sources.
They remain the fallback unless you save a change, so opening the panel alone does not replace
your current local configuration.

For each source, complete these fields:

| Field | What to enter |
|-------|---------------|
| **Include in Team Dashboard** | Check this only when the sheet/tab should contribute to Team Dashboard metrics. Disabled sources are not read. |
| **Team / region name** | The reporting label shown for that source, such as `West Coast and Beach` or `Marin — Adventure and Rocky Mountain`. Use the same label on related language sources when they should roll up together. |
| **Direct Google Sheet link** | Paste the full URL of the teammate's Google Sheet, for example `https://docs.google.com/spreadsheets/d/.../edit`. The CRM extracts the spreadsheet ID (and tab gid when present) and only reads its values. The signed-in Google account must already have access. |
| **Sheet tab name** | The exact visible tab name within that Google Sheet, such as `Form Responses 1`. This is required because the dashboard reads one tab at a time. |
| **Tab gid** | Optional numeric tab ID from the URL (`...gid=123`). It is filled automatically when supplied in the direct link and helps identify a renamed tab. |
| **Source id** | A stable, unique internal name such as `west-coast` or `mx-es`. Keep an existing id when editing a source; use a new unique id for a new source. |
| **Timestamp col** | The spreadsheet column letter containing the ticket/intake timestamp used for the reporting period, for example `A`. |
| **Status col** | The column letter containing the ticket status or outcome, for example `N`. |
| **Owner col** | The column letter containing the teammate, coordinator, or owner name, for example `G`. |
| **Category col** | The column letter containing the contact reason or reporting category, for example `K`. |
| **Default spreadsheet ID** | Legacy fallback used only by a source without its own direct Google Sheet link. Leave it unchanged for existing sources; use direct links for new teammate sheets. |

#### Teams with multiple language imports

The dashboard reads the values in the configured **tab**, not an `IMPORTRANGE` formula itself.
If two language imports are combined into one output tab (for example the existing
`Sheet36 BOTH` source), configure that combined tab once. If each language lands in a different
tab or a different teammate sheet, add two sources with unique source ids (for example `mx-en`
and `mx-es`) and the same **Team / region name** to roll them up together.

Regional source configuration is saved locally in
`data/team-dashboard-sources.json` (or `TEAM_DASHBOARD_SOURCES_PATH` when configured). This
file is intentionally gitignored because it can contain private Google Sheet links.

### Market Manager directory

1. **Gear icon** → **Market managers** tab.
2. Paste or edit the name → email list (one per line: `Name, email@…`).
3. **Save** — stored locally in `data/market-managers.json` (gitignored; seed from `market-managers.example.json`).

The team directory is also committed in git as a starting point; each machine can update it via Setup.

### Business hours

Configure weekdays, start/end times, and timezone under **Setup → Business hours**. These drive:

- Initial-response / SLA badge timing (nights, weekends, and US federal holidays excluded where applicable)
- Service metrics on the dashboard

Pending auto-reopen and other status timers are configured separately under **Preferences**.

---

## Preferences

Click the **sliders icon** in the header. Settings are saved in **`data/overlay.db`** and survive clearing Chrome cache or cookies.

| Section | What it controls |
|---------|------------------|
| **Status timers** | Pending → Open (business hours), Longterm Hold → Open (calendar days), initial response hours, default SLA hours, Resolved Gmail-link archive days |
| **Default folder / view** | Initial ticket folder on load |
| **Default dashboard period** | Rolling/calendar window for charts |
| **Default sort** | Submitted vs recently updated |
| **External tools** | Shortcut links in the Internal tools sidebar |
| **Calendar reminders** | Full-screen popup vs corner toast before calendar events |
| **Gmail unread inbox** | Quick actions for bind / append to the selected ticket |
| **CRM debug log** | Optional verbose debug panel |

---

## Day-to-day features

| Feature | How to use it |
|---------|----------------|
| **Unread Gmail inbox** | Header control lists unread threads; bind or append to the selected ticket, or dismiss (marks read in Gmail) |
| **Calendar reminders** | Sidebar shows upcoming events; toast or full-screen reminder shortly before start |
| **Recipient suggestions** | Typing in To/CC combines Market Manager directory + Google Contacts / directory |
| **Greeting shortcut** | Click the host name on a ticket to insert `Hello {FirstName},` into the reply draft |
| **Mixmax templates** | Insert snippets (and optional template attachments) when a Mixmax API token is configured |
| **Gmail thread tools** | Link / append threads, import history (backfill), redact a message in CRM only, or unlink & start a new thread on next send |
| **Conversation export** | Copy the thread for clipboard / Glean-style prompts |
| **Dashboards** | Personal intake charts, service metrics, team dashboard, review escalations, and quality appeals |
| **Report export / email** | From the dashboard menu: CSV, copy HTML/plain, dashboard image ZIP, native Print / Save PDF, or email a report via Gmail |
| **CRM ticket log** | Per-ticket timeline of CRM events |

Review escalations and quality appeals tabs read shared Google Sheets (defaults are built into the app; see `.env.example` comments for related URL notes).

---

## First run checklist

Use this after install:

- [ ] Homebrew installed (`brew -v` in Terminal)
- [ ] Node.js 20–22 installed (`brew install node@22`, then `node -v`)
- [ ] `.env` configured (UI or file) with Google Client ID + Secret
- [ ] Google Cloud APIs enabled: Sheets, Gmail, Calendar, People
- [ ] `USE_MOCK_DATA=false` for live data
- [ ] CRM running (`Open SheetsCRM.command` or `npm run dev`)
- [ ] **Sign in with Google** in the app header (approve all requested scopes)
- [ ] **Setup → Sheet mapping** — analyzed and saved your sheet URL
- [ ] **Setup → Market managers** — directory loaded (optional but recommended)
- [ ] **Setup → Business hours** — set to your team’s hours (recommended for accurate SLAs)
- [ ] Open a ticket — confirm intake data loads
- [ ] **Sliders icon** — set default view/sort/dashboard period and timer preferences

---

## Where data is stored

Everything important for a smooth experience lives **on disk in the project folder**, not in the browser.

```
SheetsCRM/
├── .env                          # API keys & config (per machine, gitignored)
├── data/
│   ├── overlay.db                # CRM overlay: status, threads, prefs, sheet mapping,
│   │                             # cover sheets, business hours, CRM log, holiday cache
│   ├── market-managers.example.json  # Example MM directory (safe to commit)
│   └── market-managers.json           # Local MM name → email (gitignored)
└── (Google Sheet)                # Intake rows + selected column writes
```

| Data | Location | Survives browser cache clear? |
|------|----------|-------------------------------|
| Tickets (intake) | Google Sheet | Yes |
| Dashboard numbers | Computed from sheet(s) on each load | Yes (sheet unchanged) |
| CRM status, threads, Gmail links | `data/overlay.db` | Yes |
| Cover sheets + business hours | `data/overlay.db` | Yes |
| View/sort/dashboard/timer preferences | `data/overlay.db` | Yes |
| CC Market Manager per ticket | `data/overlay.db` | Yes |
| Google sign-in session | Browser cookie | **No** — sign in again after clearing cookies |
| Mixmax starred templates | `data/overlay.db` (user preferences) | Yes |
| Unsent reply drafts | Browser `localStorage` | **No** — convenience only |
| Calendar “already notified” markers | Browser `localStorage` | **No** — convenience only |

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

Or set via **Setup → Environment**. Templates (and their attachments, when available) appear when composing a reply.

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

### Gmail link archive days

After a ticket is Resolved, Gmail thread claims can be released after N days (default 90). Prefer **Preferences → Status timers**; optional env fallback:

```env
# GMAIL_LINK_ARCHIVE_DAYS=90
```

---

## Updating SheetsCRM

### Zip / share installs (most teammates)

You send a new share zip. They keep their existing folder (with `.env` and `data/`).

1. Unzip the new package somewhere else (do **not** overwrite their working folder).
2. Update their install:
   - **If their folder already has `Update SheetsCRM.command`:** double-click it and choose the new unzipped folder.
   - **First update / older install:** in Terminal, from the **new** unzipped folder, run:
     ```bash
     bash scripts/update-local-install.sh --apply-to "/path/to/their/existing/SheetsCRM"
     ```
3. When it finishes, double-click **Open SheetsCRM.command** in their existing folder.

The updater replaces app code and reinstalls packages. It **keeps** `.env`, `overlay.db`, Market Managers, custom sounds, and team-dashboard sources.

### Git installs

```bash
cd /path/to/SheetsCRM
git pull
npm install
npm run dev
```

Keep your existing **`data/`** and **`.env`** — do not wipe them. If dependencies or env keys changed, check `.env.example` for new variables and add them via Setup → Environment.

If Google adds new OAuth scopes in an update, **sign out and sign in again** so consent includes Calendar, Contacts, Gmail modify, and any other new permissions.

---

## Troubleshooting

### `brew` or `node` not found

On macOS, install Homebrew, then Node.js:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zprofile
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

After Homebrew installs on Apple Silicon, run the “Next steps” commands it prints (they add Homebrew to your `PATH`), then open a **new** Terminal window and retry `brew -v` / `node -v`.

### “Sign in with Google” does nothing or errors

- Confirm redirect URI is exactly `http://localhost:3000/api/auth/callback`
- Check `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`
- Restart the dev server after changing `.env`
- If the OAuth app is in Testing mode, add your Google account as a test user
- Confirm Sheets, Gmail, Calendar, and People APIs are enabled in Google Cloud

### Calendar reminders or contact suggestions missing

- Sign out and sign in again to refresh OAuth scopes
- Confirm **Google Calendar API** and **Google People API** are enabled
- Calendar reminders only work with user OAuth (not service account)

### Unread inbox cannot dismiss / mark read

- Sign out and sign in again so the `gmail.modify` scope is granted

### Tickets show mock/demo data

- Set `USE_MOCK_DATA=false` in `.env`
- Sign in with Google
- Confirm your account can open the intake sheet in a browser tab

### Sheet not loading / sync failed

- Sign out and sign in again (cookie may have expired)
- Re-run **Setup → Analyze columns** on the correct sheet URL
- If columns were deleted or reordered: **Setup → Detect columns**, then **Save mapping**
- Check the sheet wasn’t moved or renamed
- Amber **Column mapping warnings** on the ticket list mean headers drifted — Detect + Save fixes saved letters

### Cover-sheet tickets missing or stale

- Confirm the cover slot is enabled under **Setup → Team coverage**
- Use ticket **resync** to re-fetch the row from the cover sheet
- Confirm your Google account can open the teammate’s sheet

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

### `npm install` fails with `climits` / `better-sqlite3` / Node 26

SheetsCRM needs **Node 20–22**. Homebrew’s plain `brew install node` may install Node 26, which cannot build `better-sqlite3`. Prefer:

```bash
brew install node@22
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v   # should be v22.x
rm -rf node_modules
npm ci
```

Also keep the project path **free of spaces** (rename `Robert CRM` → `SheetsCRM`). Spaces break the native build.

If headers are missing (`climits` file not found), confirm with:

```bash
xcrun --sdk macosx --show-sdk-path
ls "$(xcrun --sdk macosx --show-sdk-path)/usr/include/c++/v1/climits"
```

If that file is missing, remove and reinstall the tools (requires your Mac password):

```bash
sudo rm -rf /Library/Developer/CommandLineTools
sudo xcode-select --install
```

Finish Apple’s installer, then run **`Install SheetsCRM.command`** again (or `npm ci` in the project folder).

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

Headers are resolved at runtime via **Setup → Analyze columns** / **Detect columns**, and again on each ticket load from live header names. Fixed positions above are used as fallbacks when headers are ambiguous.

---

## Architecture (high level)

```
Google Form  →  Google Sheet (intake + selected column writes)
                      ↓
                Google Sheets API
                      ↓
              SheetsCRM (localhost:3000)
                      ↓
         data/overlay.db (status, threads, prefs, mapping,
                          cover sheets, business hours, CRM log)
                      ↓
     Gmail / Calendar / People APIs (replies, unread inbox,
                                     reminders, recipient suggest)
```

---

## Sharing with a coworker (zip / copy)

Do **not** zip your working folder as-is — it may include your full `.env`, `data/overlay.db`, and real Market Manager emails.

Create a handoff copy:

```bash
npm run share:export
# or: bash scripts/create-shareable-copy.sh ../SheetsCRM-share
```

Then zip the output folder:

```bash
cd ..
zip -r SheetsCRM-share.zip SheetsCRM-share
```

The script excludes `node_modules`, `.next`, `.git`, local databases, Mixmax tokens, and service-account keys. If your local `.env` has a real **Google OAuth Client ID + Secret**, those two values are copied into the share `.env` and `USE_MOCK_DATA` is set to `false` so the recipient can Sign in with Google without creating their own Cloud client. Treat the zip as **private** (same trust as handing them the client secret).

If OAuth values are missing locally, the share `.env` keeps placeholders and `SHARE_PACKAGING.txt` tells the coworker what to paste.

See `SHARE_PACKAGING.txt` inside the export for a handoff checklist.

### Team Coverage packages (one zip folder per teammate)

When Setup → Team coverage is mapped, export a private package for each person (plus your own primary sheet). Each package preloads:

- **Setup → Sheet mapping** = that person's intake sheet (column mappings included)
- **Setup → Team coverage** = everyone else (enabled, with mappings)
- Shared Google OAuth from your local `.env` (same trust model as `share:export`)
- A fresh `overlay.db` (mappings only — no tickets/threads)

```bash
npm run share:coverage
# or:
# bash scripts/create-coverage-shares.sh ../SheetsCRM-coverage-shares --self-label "Robert"
# bash scripts/create-coverage-shares.sh ../SheetsCRM-coverage-shares --only "Artie"
```

Output defaults to `../SheetsCRM-coverage-shares/<slug>/` with `MANIFEST.json` listing every package. Recipients need Google access to the mapped sheets. Re-export after mapping changes.

### Team Dashboard-only package (management)

For managers who only need regional metrics (no ticket inbox):

```bash
npm run share:team-dashboard
# or: bash scripts/create-team-dashboard-share.sh ../TeamDashboard-share
```

This packages OAuth from your local `.env`, embeds the current regional team sheet sources (`data/team-dashboard-sources.json` if present, otherwise the CRM’s default regional tabs), and sets `USE_MOCK_DATA=false`. Recipients unzip, run **Install TeamDashboard.command** once on a new Mac (same Node/Homebrew bootstrap as the full CRM), then **Open TeamDashboard.command**, sign in with Google (account must open the team spreadsheet), and the dashboard should load. Treat the zip as private. Re-export after dependency updates so the zip includes the current `package-lock.json` (audit findings come from that lockfile, not from skipping bootstrap).

---

## Getting help

- **Setup → Environment** — local config without editing files by hand
- **Setup → Sheet mapping** — column roles and sheet URL
- **Setup → Team coverage** — teammate intake sheets
- **Setup → Market managers** — CC directory
- **Setup → Business hours** — SLA / service-metrics hours
- **Sliders icon** — view, sort, timers, calendar, unread-inbox preferences

For code issues, check the project repository or your team’s internal support channel.

---

## For engineers & security reviewers

See **[docs/ENGINEERING_AND_SECURITY.md](docs/ENGINEERING_AND_SECURITY.md)** (also [`ENGINEERING_AND_SECURITY.docx`](docs/ENGINEERING_AND_SECURITY.docx) / [`.rtf`](docs/ENGINEERING_AND_SECURITY.rtf)) for:

- Runtime architecture and API inventory
- OAuth scopes / cookie / SQLite behavior
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
