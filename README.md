# SheetsCRM

A Zendesk-style CRM overlay for Google Forms intake sheets. Customers continue submitting via Google Forms; responses land in a Google Sheet that SheetsCRM reads **read-only**. Status, SLAs, and email threads are stored locally in SQLite — nothing is written back to the sheet.

## Example sheet

Default configuration targets this intake sheet:

- **URL:** https://docs.google.com/spreadsheets/d/1Kj8p-USf20vZREe-Cxg2c28vq4ppTwmgr05lYGxJebg/edit?gid=223304028
- **Spreadsheet ID:** `1Kj8p-USf20vZREe-Cxg2c28vq4ppTwmgr05lYGxJebg`
- **GID:** `223304028`

### Column layout (example sheet)

| Column | Role | Purpose |
|--------|------|---------|
| **K** (11) | Internal tool K | Access string / URL for internal tool 1 |
| **M** (13) | Internal tool M | Access string / URL for internal tool 2 |
| **R** (18) | Internal tool R | Access string / URL for internal tool 3 |
| **N** (14) | Status | Sheet-side status (read-only reference in CRM) |

> **Note:** The example sheet is private. CSV export requires authentication. After you share the sheet with your service account (see below), run **Setup → Analyze columns** to resolve exact header names and sample values for K, M, R, and N.

## Features

- **3-pane Zendesk-like UI** — views by status, ticket list, detail with conversation thread
- **Read-only Sheets sync** — no edits to form response data
- **Setup wizard** (gear icon) — paste a colleague's sheet URL; auto-map columns by header + K/M/R/N positions
- **CRM overlay** — status, SLA hours/due dates, outbound email copies in SQLite
- **Column N sync** — sheet status seeds and updates CRM status until you override it in the UI
- **Gmail replies** — optional send via Gmail API; copies stored in thread UI
- **Mock mode** — works without credentials using demo tickets

## Quick start

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Google API setup

### Option A — Sign in with Google (recommended)

Uses **your** Google account — the same one you use in Chrome. The app cannot read Chrome's stored passwords directly (browser security), but clicking **Sign in with Google** authorizes SheetsCRM to access any sheet your account can already open.

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Google Sheets API** and **Gmail API**
3. Create **OAuth 2.0 Client ID** (Web application)
4. Add authorized redirect URI: `http://localhost:3000/api/auth/callback`

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
USE_MOCK_DATA=false
```

5. Run `npm run dev`, open the app, click **Sign in with Google**

No need to share the sheet with a robot account — if you can view it in Chrome, the app can read it after sign-in.

### Option B — Service account (fallback)

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Share the intake sheet with the service account email as **Viewer**.

### Analyze your sheet

1. Click the **gear icon** (top right)
2. Paste sheet URL → **Analyze columns**
3. Confirm K/M/R/N mappings → **Save**

Colleagues with different column orders can re-run analysis on their sheet URL and adjust role dropdowns.

## Architecture

```
Google Form → Google Sheet (read-only)
                    ↓
              Sheets API
                    ↓
              SheetsCRM UI ←→ SQLite overlay (status, SLA, threads)
                    ↓
              Gmail API (optional outbound)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run db:migrate` | Ensure overlay DB directory exists |

## What needs your input

1. **OAuth client ID/secret** in `.env`, then **Sign in with Google** in the app
2. **Setup → Analyze columns** to confirm K/M/R/N header mappings for your intake sheet
