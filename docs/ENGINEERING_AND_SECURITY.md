# SheetsCRM — Engineering & security reference

This document is for **software engineers** and **security engineers** evaluating or operating SheetsCRM. It describes runtime architecture, trust boundaries, data flows, known risks, and practical mitigations.

For end-user setup, see [README.md](../README.md).

Word and rich-text copies of this document are available at:

- [`ENGINEERING_AND_SECURITY.docx`](./ENGINEERING_AND_SECURITY.docx)
- [`ENGINEERING_AND_SECURITY.rtf`](./ENGINEERING_AND_SECURITY.rtf)

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

1. **Reads** form intake rows from a Google Sheet (Sheets API), plus optional teammate **cover sheets**.
2. **Writes** selected columns back to that sheet (status, user ID, reso/listing, contact reason, user-emailed flag, admin notes).
3. **Overlays** CRM state in a local **SQLite** database (`better-sqlite3`, WAL mode).
4. **Sends and syncs email** via the Gmail API using the signed-in Google user’s credentials (including unread inbox, multi-thread link, backfill, and CRM-only redaction).
5. **Reads Calendar and People/Contacts** for reminders and recipient suggestions.
6. **Computes dashboards** (personal, service, team, quality/escalation) and can export or email reports.

There is **no multi-tenant server**, **no central backend**, and **no application-level user accounts**. Each installation is a single Node process on an operator’s machine, defaulting to `http://localhost:3000`.

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React client)                                         │
│  CrmShell, TicketDetail, DashboardView, SetupModal, prefs UI    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ fetch() same-origin
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js App Router (Node.js)                                   │
│  Route handlers under /api/** (tickets, auth, dashboard, …)     │
└─────┬──────────────┬──────────────┬──────────────┬──────────────┘
      │              │              │              │
      ▼              ▼              ▼              ▼
 overlay.db    .env (secrets)   Google APIs    market-managers.json
 (SQLite)                      Sheets/Gmail/   (JSON file)
                                Calendar/
                                People
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
| Reporting | Client/server dashboard builders; PDF via `jspdf` / `html-to-image` |
| Config | `.env` + optional Setup → Environment UI (`/api/env`) |

### Key modules

Architecture-oriented file headers live at the top of these hubs (and a few related API routes) so code review can start in-repo without rereading this whole document. For end-user setup see [README.md](../README.md).

| Path | Responsibility |
|------|----------------|
| `src/lib/sheets.ts` | Sheet read/write, column mapping, ticket fetch |
| `src/lib/cover-sheets.ts` | Team coverage sheet registry (SQLite) |
| `src/lib/overlay-db.ts` | SQLite schema, overlay merge, threads, claims, events |
| `src/lib/google-auth.ts` | OAuth URL, token exchange, cookie-backed refresh token |
| `src/lib/gmail.ts` | Send reply, import thread messages, signatures |
| `src/lib/gmail-thread-link.ts` / `ticket-gmail-threads.ts` | Bind / append / multi-thread links |
| `src/lib/gmail-thread-backfill.ts` | Import history for link-notice messages |
| `src/lib/google-calendar.ts` / `calendar-reminders.ts` | Upcoming events + reminder payload |
| `src/lib/google-people.ts` / `recipient-suggestions.ts` | Contact / directory suggest |
| `src/lib/business-hours.ts` / `business-holidays.ts` | Working-hours math + US holiday cache |
| `src/lib/service-metrics.ts` / `team-metrics.ts` | Dashboard KPI builders |
| `src/lib/dashboard-report-export.ts` / `dashboard-report-server.ts` | CSV/HTML/PDF + emailed reports |
| `src/lib/crm-preferences-store.ts` | User prefs & compose prefs in SQLite |
| `src/lib/env-settings.ts` | Whitelisted `.env` read/write (localhost gate) |
| `src/components/CrmShell.tsx` | Client app brain: views, refresh, auth chrome |
| `src/components/TicketDetail.tsx` | Ticket workspace UI (compose, thread, tools) |

### Request lifecycle (tickets)

1. `GET /api/tickets` loads primary (+ enabled cover) sheet config from SQLite → fetches rows via Sheets API → merges overlay → enriches with thread timestamps → runs legacy SLA migration when needed → returns JSON.
2. UI polls every `NEXT_PUBLIC_AUTO_REFRESH_SECONDS` (default 60s) when not in mock mode.
3. Ticket mutations (`PATCH /api/tickets/[rowId]`) update SQLite and optionally write specific sheet cells.
4. Email send (`POST /api/tickets/[rowId]/thread`) calls Gmail API, stores outbound copy in `thread_messages`, updates status overlay + Column N/L.
5. Background sync may import inbound mail, archive stale Gmail links, and drive status automation timers.

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
spreadsheets                 — read/write intake (+ cover) sheets
gmail.send                   — send replies as user
gmail.readonly               — import threads, list unread
gmail.modify                 — mark unread threads read (dismiss)
gmail.settings.basic         — fetch send-as signature
calendar.readonly            — upcoming events / reminders
contacts.readonly            — People API contact search
contacts.other.readonly      — “Other contacts” suggestions
directory.readonly           — Workspace directory search
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

Scope is **Sheets only** (no Gmail, Calendar, or People). Used when OAuth is absent.

### Application authorization

**There is none.** Any HTTP client that can reach the Next.js server can:

- List all tickets (`GET /api/tickets`)
- Patch any ticket (`PATCH /api/tickets/[rowId]`)
- Send email (`POST .../thread`) if Google credentials are available on the server
- Read calendar / contacts proxies when OAuth credentials are present
- Email dashboard reports (`POST /api/dashboard/send-report`)
- Rewrite `.env` via `PATCH /api/env` when the `Host` header is `localhost`

The **implicit security model** is:

> Only the operator on the same machine should be able to reach the app, and the app acts with that operator’s Google privileges.

This is appropriate for **single-user localhost** use. It is **not** appropriate for shared hosting or LAN exposure without additional controls.

### Preferences identity

`user_preferences` and `ticket_compose_prefs` rows are keyed by signed-in Google email when available, else `"local"`. This is for **per-profile separation on a shared machine**, not access control.

---

## API surface

All routes live under `src/app/api/`. None enforce session checks before handling requests. Many Google-backed routes fail closed when credentials are missing.

### Auth & config

| Route | Methods | Side effects |
|-------|---------|--------------|
| `/api/auth/google` | GET | OAuth redirect |
| `/api/auth/callback` | GET | Sets auth cookies |
| `/api/auth/logout` | POST | Clears cookies |
| `/api/auth/status` | GET | Returns signed-in email |
| `/api/config` | GET, POST | Primary sheet mapping + business hours in SQLite |
| `/api/sheet/analyze` | POST | Reads sheet headers via Google API |
| `/api/preferences` | GET, PATCH | SQLite prefs; optional legacy migrate |
| `/api/compose-prefs/[rowId]` | GET, PATCH | Per-ticket CC preference |
| `/api/env` | GET, PATCH | Read/write `.env` (localhost Host only) |
| `/api/market-managers` | GET, POST | Read/write `market-managers.json` |
| `/api/cover-sheets` | GET, POST | Load/save team coverage sheet entries |
| `/api/ops/metrics` | GET | Internal ops/health snapshot |

### Tickets & Gmail

| Route | Methods | Side effects |
|-------|---------|--------------|
| `/api/tickets` | GET | Reads primary + cover sheets + SQLite |
| `/api/tickets/[rowId]` | PATCH | SQLite + sheet cells |
| `/api/tickets/[rowId]/crm-log` | GET | CRM event timeline |
| `/api/tickets/[rowId]/ignore-cover` | POST | Dismiss cover-sheet ticket |
| `/api/tickets/[rowId]/resync-sheet` | POST | Re-fetch cover row into overlay |
| `/api/tickets/[rowId]/thread` | GET, POST | Gmail read/send, SQLite |
| `/api/tickets/[rowId]/thread/link` | POST, DELETE | Bind / append / unlink Gmail thread(s) |
| `/api/tickets/[rowId]/thread/backfill` | POST | Import Gmail history for link notice |
| `/api/tickets/[rowId]/thread/reset-gmail` | POST | Unlink Gmail; force new thread on next send |
| `/api/tickets/[rowId]/thread/messages/[messageId]/redact` | POST | CRM-only redact + block re-sync |
| `/api/tickets/[rowId]/thread/attachments/[attachmentId]` | GET | Download stored attachment |
| `/api/gmail/unread` | GET | List unread Gmail threads |
| `/api/gmail/unread/dismiss` | POST | Mark thread read (`gmail.modify`) |
| `/api/gmail/unread/ticket` | POST | Create/link ticket from unread thread |

### Calendar, contacts, Mixmax, dashboards

| Route | Methods | Side effects |
|-------|---------|--------------|
| `/api/calendar/upcoming` | GET | Primary calendar events / reminders |
| `/api/contacts/suggest` | GET | MM directory + Google People suggestions |
| `/api/mixmax/templates` | GET | Proxies Mixmax API with server token |
| `/api/mixmax/templates/[id]/attachments` | POST | Import Mixmax attachments into compose |
| `/api/dashboard/service-metrics` | GET | SLA / service KPIs |
| `/api/dashboard/team-metrics` | GET | Regional team intake records |
| `/api/dashboard/review-escalation-metrics` | GET | Review escalations sheet metrics |
| `/api/dashboard/quality-appeal-metrics` | GET | Quality appeals sheet metrics |
| `/api/dashboard/dispute-appeal-metrics` | GET | Combined dispute/appeal metrics |
| `/api/dashboard/send-report` | POST | Email dashboard report (+ optional CSV/PDF) |

**Mock mode:** When `USE_MOCK_DATA=true` or Google auth is missing, ticket routes return synthetic data and skip sheet/Gmail writes. Calendar/contacts/unread features require user OAuth.

---

## Data stores & persistence

### SQLite — `data/overlay.db`

**Path:** `OVERLAY_DB_PATH` env or `./data/overlay.db`  
**Mode:** WAL (`PRAGMA journal_mode = WAL`)

**Tables / artifacts (conceptual):**

| Table / artifact | Contents | Sensitivity |
|------------------|----------|-------------|
| `sheet_config` (`default`) | Spreadsheet ID, tab, column mapping, business hours | Medium |
| `sheet_config` (`cover_sheets`) | Serialized cover-sheet entries | Medium |
| `ticket_overlay` | CRM status, subjects, SLA, Gmail thread ID, Airbnb ID, flags | Medium–High |
| `ticket_gmail_threads` | Primary + appended Gmail thread links | Medium–High |
| `thread_messages` | Full email bodies, addresses, subjects, Gmail IDs | **High (PII)** |
| `message_attachments` | Attachment metadata / blobs referenced for compose/send | **High** |
| `blocked_gmail_messages` | Redacted message IDs blocked from re-sync | Medium |
| `crm_ticket_events` | CRM audit/event timeline | Medium |
| `user_preferences` | UI defaults, timers, calendar/unread prefs | Low–Medium |
| `ticket_compose_prefs` | CC Market Manager checkbox per ticket | Low |
| `holiday_calendar_cache` / `holiday_calendar_meta` | Cached US federal holiday dates | Low |
| `overlay_migrations` | One-time migration markers | Low |

**Encryption:** None at rest. File permissions = OS user ACL.

**Backup:** Copy file while process stopped or rely on WAL-safe copy tools.

### `.env`

Contains OAuth client secret, optional service account private key, Mixmax token. Loaded at process start; `/api/env` can mutate file and `process.env` at runtime for whitelisted keys.

**Gitignored** — but often stored alongside the project on disk.

### `data/market-managers.json`

Name → email directory for CC lookup and recipient suggestions. May contain employee emails; **may be committed to git** in team repos.

### Google Sheet(s)

System of record for intake. CRM writes are limited to mapped columns (see README column reference). Dashboard analytics are **computed from sheet data** on each request — no separate analytics warehouse. Quality / team dashboards may also read additional shared sheets configured in source modules.

### Browser storage (non-authoritative)

| Key | Content | Survives cache clear? |
|-----|---------|------------------------|
| `sheetscrm_reply_drafts` | Unsent reply HTML/subject | No |
| `sheetscrm_calendar_notified_v1` | Calendar reminder dedupe | No |
| `crm.calendarCollapsed` | Sidebar calendar UI state | No |

Mixmax starred template IDs (ordered) live in `user_preferences` inside `overlay.db`. Legacy `sheetscrm_mixmax_starred_templates` is migrated once into preferences.

---

## External integrations

### Google Sheets API

- **Read:** Full configured tab (all columns in mapping); optional cover sheets; additional quality/team source sheets for dashboards.
- **Write:** Cell-level updates by column role (status, airbnb user ID, reso, listing, contact reason, user emailed, case summary append).
- **Auth:** User OAuth (broader) or service account (Sheets only).

### Gmail API

- **Send:** Outbound replies from ticket UI; dashboard report email; uses signed-in user as From.
- **Read:** Thread import for linked thread IDs; unread inbox listing.
- **Modify:** Mark threads read when dismissing from unread inbox.
- **Constraint:** Tickets may have a primary Gmail thread plus appended threads (`ticket_gmail_threads`); claims are unique across tickets.

### Google Calendar API

- **Read-only:** Primary calendar upcoming events for sidebar + reminder popups/toasts.
- Requires user OAuth (`calendar.readonly`).

### Google People API / Contacts / Directory

- **Read-only:** Recipient autocomplete alongside Market Manager directory.
- Scopes: `contacts.readonly`, `contacts.other.readonly`, `directory.readonly`.

### Mixmax API

- Server-side token (`MIXMAX_API_TOKEN`).
- Templates fetched via `/api/mixmax/templates` — token never sent to browser.
- Template attachments imported via `/api/mixmax/templates/[id]/attachments`.

### Salesforce

- Client-side link construction only (`SALESFORCE_SEARCH_BASE_URL` + Column D). No Salesforce API calls.

### Public holiday ICS

- Business-hours logic may fetch/cache US federal holiday dates into SQLite for SLA/service metrics.

---

## Threat model

### Assets

1. Google OAuth refresh token (cookie + effective account takeover for scoped APIs: Sheets, Gmail, Calendar, Contacts/Directory).
2. Service account private key (`.env`).
3. Intake sheet data (customer PII, case details), including cover sheets.
4. Local SQLite (email thread copies, CRM notes, attachments metadata, event log).
5. Mixmax API token.
6. Market manager directory (employee emails).
7. Calendar event metadata and contact directory search results processed by the app.

### Actors

| Actor | Relevance |
|-------|-----------|
| **Local operator** | Intended user; full Google privileges delegated to app |
| **Malware on same machine** | Can read `overlay.db`, `.env`, cookies from browser profile |
| **Other users on same OS account** | Same as operator — no OS-level isolation |
| **Network attacker** | Low risk if bound to localhost; **high** if server exposed on LAN/WAN |
| **Malicious browser tab (XSS)** | Could call APIs same-origin; refresh token is httpOnly but actions are not |
| **Supply chain** | npm dependencies (`googleapis`, `better-sqlite3`, `jspdf`, etc.) |

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

**Finding:** All `/api/*` routes are unauthenticated. Anyone who can HTTP to the process can mutate tickets, send mail (with stored Google creds), read calendar/contacts proxies, email reports, and change config.

**Mitigations:**

- **Required today:** Run only on `localhost`; do not bind to `0.0.0.0` or deploy without a redesign.
- **If deploying:** Add session middleware, bind OAuth to app sessions, reject unauthenticated mutations, consider mTLS or VPN.

#### 2. Google refresh token in cookie

**Finding:** Long-lived refresh token (`google_refresh_token`, 1 year) grants offline access to Sheets, Gmail (including modify), Calendar, and Contacts/Directory scopes.

**Mitigations:**

- `httpOnly` reduces XSS exfiltration vs `localStorage`.
- Email cookie is **not** `httpOnly` — lower risk than refresh token but still session metadata leak via XSS.
- **Improvements:** Set `secure: true` always in production HTTPS; shorten `maxAge`; implement [token revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke) on logout; store refresh token encrypted server-side with session ID instead of raw cookie.

#### 3. Plaintext secrets on disk

**Finding:** `.env` holds client secret, SA key, Mixmax token. `overlay.db` holds email bodies and related PII unencrypted.

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

**Finding:** Wrong column mapping could write status or PII to incorrect cells. `airbnbUserId` is pinned to column AD by index fallback, but other roles depend on mapping. Cover sheets add additional write/read surfaces.

**Mitigations:**

- Setup wizard + `manuallyMapped` flag; review mapping after analyze.
- Sheet version history in Google.
- **Improvements:** Dry-run preview before first write; write-audit log in SQLite.

#### 6. Gmail send as signed-in user

**Finding:** Compromised app session can send arbitrary email through operator’s Gmail within API quotas (ticket replies and dashboard report mail).

**Mitigations:**

- Localhost-only posture; Google account security (2FA).
- **Improvements:** Confirm dialog server-side; rate limit sends; restrict recipient domains.

#### 7. Broader Google data access

**Finding:** Calendar and Contacts/Directory scopes expand the blast radius of a stolen refresh token beyond Sheets/Gmail.

**Mitigations:**

- Request only the scopes needed; re-consent after scope changes.
- Prefer Internal OAuth apps / test-user restriction.
- **Improvements:** Split optional scopes behind explicit feature toggles / incremental authorization.

#### 8. PII in repository

**Finding:** `data/market-managers.json` may contain real employee emails and is tracked in git.

**Mitigations:**

- Move to gitignored local file only (`MARKET_MANAGERS_PATH`).
- Use example data in repo; document team import via Setup UI.

#### 9. CSRF on state-changing APIs

**Finding:** `PATCH`/`POST` endpoints use cookie auth for Google but not CSRF tokens. `SameSite=Lax` provides partial protection.

**Mitigations:**

- Localhost-only reduces cross-site risk.
- **Improvements:** `SameSite=Strict` for auth cookies; CSRF tokens for mutations if ever deployed with cookies.

#### 10. CRM-only redaction is not Gmail deletion

**Finding:** Message redaction removes content from the local CRM view and blocks re-sync; it does **not** delete the message from Gmail.

**Mitigations:**

- Document operator expectation; use Gmail retention/legal tools when true deletion is required.

### Low / informational

#### 11. Partial audit trail

`crm_ticket_events` records many CRM actions, but not every sheet write or Google API call is append-only audited.

**Improvement:** Expand `audit_events` coverage (actor, action, row_id, timestamp, diff) for all mutations.

#### 12. Mixmax token scope

Token is server-only (good). Compromise of Next.js process exposes it.

**Mitigation:** Rotate token; least-privilege Mixmax account.

#### 13. Dependency supply chain

Standard npm risk.

**Mitigation:** Lockfile, `npm audit`, periodic updates, optional SBOM.

#### 14. Mock mode data leakage

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
| Rate limiting | Per-IP / per-session on send, report email, and sheet write |
| Network | VPN or SSO front door (e.g. IAP, OAuth proxy) |
| Scope minimization | Feature-gated Calendar/Contacts consent |

There is no built-in multi-user RBAC, row-level security, or field-level redaction.

For a longer-term hosted multi-coordinator design, see [HOSTED_MULTI_COORDINATOR_ROADMAP.md](./HOSTED_MULTI_COORDINATOR_ROADMAP.md).

---

## Operational recommendations

### For security reviewers sign-off (local use)

1. Confirm app runs **localhost-only** on managed laptops with disk encryption.
2. Confirm Google Cloud OAuth app is **Internal** (Workspace) or test-user restricted.
3. Confirm required APIs are enabled intentionally: Sheets, Gmail, Calendar, People.
4. Confirm intake / cover / quality sheet sharing follows least privilege (operator accounts, not public).
5. Confirm `.env` and `data/overlay.db` are **not** synced to shared drives unencrypted.
6. Confirm `USE_MOCK_DATA=false` for real operations.
7. Review `market-managers.json` — avoid committing live directory if policy requires.
8. Confirm operators understand CRM redaction ≠ Gmail deletion.

### For engineers onboarding

1. Read `src/lib/overlay-db.ts` merge logic (`mergeOverlayOntoTicket`) — sheet vs CRM status precedence.
2. Read `src/lib/status-mapper.ts` — Column N string mapping.
3. Thread linking: `ticket-gmail-threads.ts` / `claimGmailThreadForTicket` — primary + appended threads.
4. Cover sheets: `src/lib/cover-sheets.ts` + Setup → Team coverage.
5. Business hours / SLA: `business-hours.ts`, `business-holidays.ts`, `service-metrics.ts`.
6. Preferences: `src/lib/crm-preferences-store.ts` — survives browser reset.
7. Dashboards: `dashboard-stats.ts`, team/quality loaders, `dashboard-report-server.ts`.

### Backup & recovery

| Artifact | Recovery impact |
|----------|-----------------|
| `overlay.db` | Lose threads, CRM status overrides, prefs, mapping, cover sheets, CRM log |
| `.env` | Re-auth / reconfigure APIs |
| Google Sheet | Intake data (Google version history) |
| OAuth cookies only | Re-sign-in; no data loss (re-consent if scopes changed) |

---

## Extension points

Common hardening or feature work items:

| Area | Suggested approach |
|------|-------------------|
| API auth | Next.js `middleware.ts` + session after OAuth; attach `user_key` to all mutations |
| Secret storage | Keychain / 1Password CLI / cloud secret manager instead of flat `.env` |
| Encrypted SQLite | SQLCipher via `better-sqlite3` build or migrate to libsql |
| Audit log | Expand `crm_ticket_events` / new table hooks on send, sheet write, report email |
| CSRF | Token in meta tag + `X-CSRF-Token` header validation |
| Env UI | Build-time strip `/api/env` route for `NODE_ENV=production` |
| Incremental OAuth | Request Calendar/Contacts only when those features are enabled |
| RBAC | Out of scope today; would need identity provider and ticket assignment model |
| Network deploy | Reverse proxy (Caddy/nginx) + OAuth2 Proxy or Google IAP |

---

## Related files

| Document / path | Audience |
|-----------------|----------|
| [README.md](../README.md) | Operators — local setup |
| [SheetsCRM-Local-Setup-Guide.docx](./SheetsCRM-Local-Setup-Guide.docx) / [.rtf](./SheetsCRM-Local-Setup-Guide.rtf) | Operators — Word / RTF copy of setup guide |
| [ENGINEERING_AND_SECURITY.docx](./ENGINEERING_AND_SECURITY.docx) / [.rtf](./ENGINEERING_AND_SECURITY.rtf) | Eng / security — Word / RTF copy of this doc |
| [HOSTED_MULTI_COORDINATOR_ROADMAP.md](./HOSTED_MULTI_COORDINATOR_ROADMAP.md) | Product / eng — hosted multi-MC rollout |
| `.env.example` | Config reference |
| `src/lib/google-auth.ts` | OAuth scopes & cookie handling |
| `src/lib/env-settings.ts` | Env whitelist & localhost gate |
| `src/lib/overlay-db.ts` | SQLite schema & merge semantics |
| `src/lib/sheets.ts` | Sheet read/write surface |
| `src/lib/cover-sheets.ts` | Team coverage configuration |

---

*Last aligned with codebase: July 2026 — cover sheets, business hours, Calendar/People scopes, unread Gmail inbox, multi-thread Gmail tools, service/team/quality dashboards, and report export/email.*
