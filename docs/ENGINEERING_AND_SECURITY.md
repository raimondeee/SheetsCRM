# SheetsCRM — Engineering & security reference

This document is for **software engineers** and **security engineers** evaluating or operating SheetsCRM. It describes runtime architecture, trust boundaries, data flows, known risks, and practical mitigations.

For end-user setup, see [README.md](../README.md).

---

## Table of contents

1. [System overview](#system-overview)
2. [Runtime architecture](#runtime-architecture)
3. [Authentication & authorization](#authentication--authorization)
4. [API surface](#api-surface)
5. [Data stores & persistence](#data-stores--persistence)
6. [External integrations](#external-integrations)
7. [Threat model](#threat-model)
8. [Security findings & mitigations](#security-findings--mitigations)
9. [Deployment posture](#deployment-posture)
10. [Operational recommendations](#operational-recommendations)
11. [Extension points](#extension-points)

---

## System overview

SheetsCRM is a **local-first Next.js 15 application** that:

1. **Reads** form intake rows from a Google Sheet (Sheets API).
2. **Writes** selected columns back to that sheet (status, user ID, reso/listing, contact reason, user-emailed flag, admin notes).
3. **Overlays** CRM state in a local **SQLite** database (`better-sqlite3`, WAL mode).
4. **Sends and syncs email** via the Gmail API using the signed-in Google user’s credentials.

There is **no multi-tenant server**, **no central backend**, and **no application-level user accounts**. Each installation is a single Node process on an operator’s machine, defaulting to `http://localhost:3000`.

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React client)                                         │
│  CrmShell, TicketDetail, DashboardView, SetupModal            │
└───────────────────────────┬─────────────────────────────────────┘
                            │ fetch() same-origin
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js App Router (Node.js)                                 │
│  Route handlers: /api/tickets, /api/auth/*, /api/preferences  │
└─────┬──────────────┬──────────────┬──────────────┬──────────────┘
      │              │              │              │
      ▼              ▼              ▼              ▼
 overlay.db    .env (secrets)   Google APIs    market-managers.json
 (SQLite)                      Sheets/Gmail   (JSON file)
                                OAuth tokens
                                (httpOnly cookie)
```

---

## Runtime architecture

### Stack

| Layer | Technology |
|-------|------------|
| UI | React 19, client components, Tailwind |
| Server | Next.js 15 App Router, Route Handlers (`src/app/api/**`) |
| Local DB | SQLite via `better-sqlite3` (`data/overlay.db`) |
| Google | `googleapis` — OAuth2 user creds or service-account JWT |
| Config | `.env` + optional Setup → Environment UI (`/api/env`) |

### Key modules

| Path | Responsibility |
|------|----------------|
| `src/lib/sheets.ts` | Sheet read/write, column mapping, ticket fetch |
| `src/lib/overlay-db.ts` | SQLite schema, overlay merge, thread messages, Gmail thread claims |
| `src/lib/google-auth.ts` | OAuth URL, token exchange, cookie-backed refresh token |
| `src/lib/gmail.ts` | Send reply, import thread messages, signatures |
| `src/lib/crm-preferences-store.ts` | User prefs & compose prefs in SQLite |
| `src/lib/dashboard-stats.ts` | Pure client/server analytics from ticket array |
| `src/lib/env-settings.ts` | Whitelisted `.env` read/write (localhost gate) |

### Request lifecycle (tickets)

1. `GET /api/tickets` loads sheet config from SQLite → fetches rows via Sheets API → merges overlay (`mergeOverlayOntoTicket`) → enriches with thread timestamps (`enrichTicketsWithLastResponse`) → runs one-time legacy SLA migration → returns JSON.
2. UI polls every `NEXT_PUBLIC_AUTO_REFRESH_SECONDS` (default 60s) when not in mock mode.
3. Ticket mutations (`PATCH /api/tickets/[rowId]`) update SQLite and optionally write specific sheet cells.
4. Email send (`POST /api/tickets/[rowId]/thread`) calls Gmail API, stores outbound copy in `thread_messages`, updates status overlay + Column N/L.

### Process model

- **Development:** `npm run dev` → Next.js dev server (typically localhost-only).
- **Production:** `npm run build && npm start` — not the primary intended mode today; see [Deployment posture](#deployment-posture).

There is **no `middleware.ts`** and **no global auth guard** on API routes.

---

## Authentication & authorization

### Google OAuth (primary)

**Flow:**

1. `GET /api/auth/google` → redirect to Google consent URL.
2. `GET /api/auth/callback?code=...` → exchange code for tokens → set cookies → redirect to `/`.

**Scopes requested** (`src/lib/google-auth.ts`):

```
spreadsheets          — read/write intake sheet
gmail.send            — send replies as user
gmail.readonly        — import thread messages
gmail.settings.basic  — fetch send-as signature
openid, email, profile
```

**Token storage:**

| Cookie | Name | Flags | Content |
|--------|------|-------|---------|
| Refresh token | `google_refresh_token` | `httpOnly`, `sameSite=lax`, 1yr | Google OAuth refresh token |
| Email display | `google_user_email` | **not** `httpOnly`, `sameSite=lax`, 1yr | User email string |

On each Google API call, `getGoogleAuthClient()` reads the refresh cookie and constructs an OAuth2 client. Access tokens are obtained implicitly by the client library.

**Logout:** `POST /api/auth/logout` clears both cookies locally. It does **not** revoke the token at Google.

### Service account (fallback)

If no refresh cookie exists, `getGoogleAuthClient()` falls back to a JWT from:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
```

Scope is **Sheets only** (no Gmail). Used when OAuth is absent.

### Application authorization

**There is none.** Any HTTP client that can reach the Next.js server can:

- List all tickets (`GET /api/tickets`)
- Patch any ticket (`PATCH /api/tickets/[rowId]`)
- Send email (`POST .../thread`) if Google credentials are available on the server
- Rewrite `.env` via `PATCH /api/env` when the `Host` header is `localhost`

The **implicit security model** is:

> Only the operator on the same machine should be able to reach the app, and the app acts with that operator’s Google privileges.

This is appropriate for **single-user localhost** use. It is **not** appropriate for shared hosting or LAN exposure without additional controls.

### Preferences identity

`user_preferences` and `ticket_compose_prefs` rows are keyed by signed-in Google email when available, else `"local"`. This is for **per-profile separation on a shared machine**, not access control.

---

## API surface

All routes live under `src/app/api/`. None enforce session checks before handling requests.

| Route | Methods | Side effects |
|-------|---------|--------------|
| `/api/auth/google` | GET | OAuth redirect |
| `/api/auth/callback` | GET | Sets auth cookies |
| `/api/auth/logout` | POST | Clears cookies |
| `/api/auth/status` | GET | Returns signed-in email |
| `/api/tickets` | GET | Reads sheet + SQLite |
| `/api/tickets/[rowId]` | PATCH | SQLite + sheet cells |
| `/api/tickets/[rowId]/thread` | GET, POST | Gmail read/send, SQLite |
| `/api/tickets/[rowId]/thread/link` | POST | Bind Gmail thread to ticket |
| `/api/config` | GET, POST | Sheet column mapping in SQLite |
| `/api/sheet/analyze` | POST | Reads sheet headers via Google API |
| `/api/preferences` | GET, PATCH | SQLite prefs; optional legacy migrate |
| `/api/compose-prefs/[rowId]` | GET, PATCH | Per-ticket CC preference |
| `/api/env` | GET, PATCH | Read/write `.env` (localhost Host only) |
| `/api/market-managers` | GET, POST | Read/write `market-managers.json` |
| `/api/mixmax/templates` | GET | Proxies Mixmax API with server token |

**Mock mode:** When `USE_MOCK_DATA=true` or Google auth is missing, ticket routes return synthetic data and skip sheet/Gmail writes.

---

## Data stores & persistence

### SQLite — `data/overlay.db`

**Path:** `OVERLAY_DB_PATH` env or `./data/overlay.db`  
**Mode:** WAL (`PRAGMA journal_mode = WAL`)

**Tables (conceptual):**

| Table | Contents | Sensitivity |
|-------|----------|-------------|
| `sheet_config` | Spreadsheet ID, tab name, column role mapping | Medium |
| `ticket_overlay` | CRM status, subjects, SLA, Gmail thread ID, Airbnb ID, flags | Medium–High |
| `thread_messages` | Full email bodies, addresses, subjects, Gmail IDs | **High (PII)** |
| `user_preferences` | UI defaults, dashboard period | Low |
| `ticket_compose_prefs` | CC Market Manager checkbox per ticket | Low |
| `overlay_migrations` | One-time migration markers | Low |

**Encryption:** None at rest. File permissions = OS user ACL.

**Backup:** Copy file while process stopped or rely on WAL-safe copy tools.

### `.env`

Contains OAuth client secret, optional service account private key, Mixmax token. Loaded at process start; `/api/env` can mutate file and `process.env` at runtime for whitelisted keys.

**Gitignored** — but often stored alongside the project on disk.

### `data/market-managers.json`

Name → email directory for CC lookup. May contain employee emails; **may be committed to git** in team repos.

### Google Sheet

System of record for intake. CRM writes are limited to mapped columns (see README column reference). Dashboard analytics are **computed from sheet data** on each request — no separate analytics warehouse.

### Browser storage (non-authoritative)

| Key | Content | Survives cache clear? |
|-----|---------|------------------------|
| `sheetscrm_reply_drafts` | Unsent reply HTML/subject | No |
| `sheetscrm_mixmax_starred` | Starred template IDs | No |

Preferences were moved to SQLite; legacy keys are migrated once via `/api/preferences`.

---

## External integrations

### Google Sheets API

- **Read:** Full configured tab (all columns in mapping).
- **Write:** Cell-level updates by column role (status, airbnb user ID, reso, listing, contact reason, user emailed, case summary append).
- **Auth:** User OAuth (broader) or service account (Sheets only).

### Gmail API

- **Send:** Outbound replies from ticket UI; uses signed-in user as From.
- **Read:** Thread import for linked `gmail_thread_id`; inbound messages can auto-reopen Pending tickets.
- **Constraint:** One Gmail thread ID per ticket (unique index on `ticket_overlay.gmail_thread_id`).

### Mixmax API

- Server-side token (`MIXMAX_API_TOKEN`).
- Templates fetched via `/api/mixmax/templates` — token never sent to browser.

### Salesforce

- Client-side link construction only (`SALESFORCE_SEARCH_BASE_URL` + Column D). No Salesforce API calls.

---

## Threat model

### Assets

1. Google OAuth refresh token (cookie + effective account takeover for scoped APIs).
2. Service account private key (`.env`).
3. Intake sheet data (customer PII, case details).
4. Local SQLite (email thread copies, CRM notes).
5. Mixmax API token.
6. Market manager directory (employee emails).

### Actors

| Actor | Relevance |
|-------|-----------|
| **Local operator** | Intended user; full Google privileges delegated to app |
| **Malware on same machine** | Can read `overlay.db`, `.env`, cookies from browser profile |
| **Other users on same OS account** | Same as operator — no OS-level isolation |
| **Network attacker** | Low risk if bound to localhost; **high** if server exposed on LAN/WAN |
| **Malicious browser tab (XSS)** | Could call APIs same-origin; refresh token is httpOnly but actions are not |
| **Supply chain** | npm dependencies (`googleapis`, `better-sqlite3`, etc.) |

### Trust boundaries

```
[Operator browser] ←same-origin→ [Next.js on localhost] ←TLS→ [Google APIs]
                                      ↓
                               [Local filesystem]
```

The app **does not** introduce a separate trust domain between operators if the server is reachable by multiple clients.

---

## Security findings & mitigations

Findings are ordered by severity for **non-localhost** or **shared-machine** scenarios. For dedicated single-user localhost, many are accepted risks.

### Critical / high

#### 1. No API authentication

**Finding:** All `/api/*` routes are unauthenticated. Anyone who can HTTP to the process can mutate tickets, send mail (with stored Google creds), and change config.

**Mitigations:**

- **Required today:** Run only on `localhost`; do not bind to `0.0.0.0` or deploy without a redesign.
- **If deploying:** Add session middleware, bind OAuth to app sessions, reject unauthenticated mutations, consider mTLS or VPN.

#### 2. Google refresh token in cookie

**Finding:** Long-lived refresh token (`google_refresh_token`, 1 year) grants offline access to Sheets + Gmail scopes.

**Mitigations:**

- `httpOnly` reduces XSS exfiltration vs `localStorage`.
- Email cookie is **not** `httpOnly` — lower risk than refresh token but still session metadata leak via XSS.
- **Improvements:** Set `secure: true` always in production HTTPS; shorten `maxAge`; implement [token revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke) on logout; store refresh token encrypted server-side with session ID instead of raw cookie.

#### 3. Plaintext secrets on disk

**Finding:** `.env` holds client secret, SA key, Mixmax token. `overlay.db` holds email bodies unencrypted.

**Mitigations:**

- FileVault / OS full-disk encryption (operator responsibility).
- Restrict directory permissions (`chmod 700 data/`).
- **Improvements:** macOS Keychain or OS secret store for tokens; SQLCipher for overlay DB.

#### 4. Host-header gate on `/api/env` only

**Finding:** `isLocalEnvEditorRequest()` checks `Host: localhost|127.0.0.1`. Other routes have no such check. Host header can be spoofed by non-browser clients even on localhost.

**Mitigations:**

- Acceptable for local dev convenience.
- **Improvements:** Disable `/api/env` in production builds; require file-based config; add `NODE_ENV` guard.

### Medium

#### 5. Sheet write integrity

**Finding:** Wrong column mapping could write status or PII to incorrect cells. `airbnbUserId` is pinned to column AD by index fallback, but other roles depend on mapping.

**Mitigations:**

- Setup wizard + `manuallyMapped` flag; review mapping after analyze.
- Sheet version history in Google.
- **Improvements:** Dry-run preview before first write; write-audit log in SQLite.

#### 6. Gmail send as signed-in user

**Finding:** Compromised app session can send arbitrary email through operator’s Gmail within API quotas.

**Mitigations:**

- Localhost-only posture; Google account security (2FA).
- **Improvements:** Confirm dialog server-side; rate limit sends; restrict recipient domains.

#### 7. PII in repository

**Finding:** `data/market-managers.json` may contain real employee emails and is tracked in git.

**Mitigations:**

- Move to gitignored local file only (`MARKET_MANAGERS_PATH`).
- Use example data in repo; document team import via Setup UI.

#### 8. CSRF on state-changing APIs

**Finding:** `PATCH`/`POST` endpoints use cookie auth for Google but not CSRF tokens. `SameSite=Lax` provides partial protection.

**Mitigations:**

- Localhost-only reduces cross-site risk.
- **Improvements:** `SameSite=Strict` for auth cookies; CSRF tokens for mutations if ever deployed with cookies.

### Low / informational

#### 9. No audit trail

CRM status changes, sends, and sheet writes are not append-only logged.

**Improvement:** `audit_events` table (actor, action, row_id, timestamp, diff).

#### 10. Mixmax token scope

Token is server-only (good). Compromise of Next.js process exposes it.

**Mitigation:** Rotate token; least-privilege Mixmax account.

#### 11. Dependency supply chain

Standard npm risk.

**Mitigation:** Lockfile, `npm audit`, periodic updates, optional SBOM.

#### 12. Mock mode data leakage

Mock tickets are synthetic; ensure `USE_MOCK_DATA` is false in any environment with real operators to avoid confusion (not a confidentiality issue).

---

## Deployment posture

### Intended: local development server

```bash
npm run dev   # default http://localhost:3000
```

Next.js dev server is the expected production surface for this team tool today.

### Not recommended without hardening: network deployment

If the app is ever served beyond localhost:

| Concern | Required change |
|---------|-----------------|
| Open APIs | Auth middleware on all `/api/*` |
| OAuth cookies | `secure: true`, HTTPS, strict SameSite |
| Refresh token storage | Server-side session store, not long-lived cookie |
| Env editor | Disable `/api/env` |
| Rate limiting | Per-IP / per-session on send and sheet write |
| Network | VPN or SSO front door (e.g. IAP, OAuth proxy) |

There is no built-in multi-user RBAC, row-level security, or field-level redaction.

---

## Operational recommendations

### For security reviewers sign-off (local use)

1. Confirm app runs **localhost-only** on managed laptops with disk encryption.
2. Confirm Google Cloud OAuth app is **Internal** (Workspace) or test-user restricted.
3. Confirm intake sheet sharing follows least privilege (operator accounts, not public).
4. Confirm `.env` and `data/overlay.db` are **not** synced to shared drives unencrypted.
5. Confirm `USE_MOCK_DATA=false` for real operations.
6. Review `market-managers.json` — avoid committing live directory if policy requires.

### For engineers onboarding

1. Read `src/lib/overlay-db.ts` merge logic (`mergeOverlayOntoTicket`) — sheet vs CRM status precedence.
2. Read `src/lib/status-mapper.ts` — Column N string mapping.
3. Thread linking: `claimGmailThreadForTicket` enforces 1:1 thread↔ticket.
4. Preferences: `src/lib/crm-preferences-store.ts` — survives browser reset.
5. Dashboard: pure function `buildDashboardStats(tickets, period)` — no persisted metrics.

### Backup & recovery

| Artifact | Recovery impact |
|----------|-----------------|
| `overlay.db` | Lose threads, CRM status overrides, prefs, mapping |
| `.env` | Re-auth / reconfigure APIs |
| Google Sheet | Intake data (Google version history) |
| OAuth cookies only | Re-sign-in; no data loss |

---

## Extension points

Common hardening or feature work items:

| Area | Suggested approach |
|------|-------------------|
| API auth | Next.js `middleware.ts` + session after OAuth; attach `user_key` to all mutations |
| Secret storage | Keychain / 1Password CLI / cloud secret manager instead of flat `.env` |
| Encrypted SQLite | SQLCipher via `better-sqlite3` build or migrate to libsql |
| Audit log | New table + hooks in `updateTicketStatus`, `sendReplyEmail`, sheet writes |
| CSRF | Token in meta tag + `X-CSRF-Token` header validation |
| Env UI | Build-time strip `/api/env` route for `NODE_ENV=production` |
| RBAC | Out of scope today; would need identity provider and ticket assignment model |
| Network deploy | Reverse proxy (Caddy/nginx) + OAuth2 Proxy or Google IAP |

---

## Related files

| Document / path | Audience |
|-----------------|----------|
| [README.md](../README.md) | Operators — local setup |
| [HOSTED_MULTI_COORDINATOR_ROADMAP.md](./HOSTED_MULTI_COORDINATOR_ROADMAP.md) | Product / eng — hosted multi-MC rollout |
| `.env.example` | Config reference |
| `src/lib/google-auth.ts` | OAuth scopes & cookie handling |
| `src/lib/env-settings.ts` | Env whitelist & localhost gate |
| `src/lib/overlay-db.ts` | SQLite schema & merge semantics |
| `src/lib/sheets.ts` | Sheet read/write surface |

---

*Last aligned with codebase: SheetsCRM local overlay CRM (Next.js 15, SQLite preferences, dashboard period filters, Column N sync).*
