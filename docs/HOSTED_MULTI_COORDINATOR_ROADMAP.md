# SheetsCRM — Hosted multi-coordinator expansion

This document describes what it would take to move SheetsCRM from a **single-operator localhost tool** to a **web-hosted application** used by all Market Coordinators (MCs). It covers intake consolidation, ticket routing by Market Manager (MM), and the platform changes required to support many users safely.

**Audience:** product owners, engineering leads, and operations planning a rollout.

**Related docs:**

- [README.md](../README.md) — current local setup
- [ENGINEERING_AND_SECURITY.md](./ENGINEERING_AND_SECURITY.md) — today’s architecture and security posture

---

## Table of contents

1. [Vision](#vision)
2. [Today vs tomorrow](#today-vs-tomorrow)
3. [Target user experience](#target-user-experience)
4. [Intake: unified form and sheet](#intake-unified-form-and-sheet)
5. [Routing: MM → Market Coordinator](#routing-mm--market-coordinator)
6. [Platform architecture](#platform-architecture)
7. [Data model changes](#data-model-changes)
8. [Authentication and access control](#authentication-and-access-control)
9. [Email and Gmail strategy](#email-and-gmail-strategy)
10. [Dashboards and reporting](#dashboards-and-reporting)
11. [Migration from today](#migration-from-today)
12. [Phased delivery plan](#phased-delivery-plan)
13. [Decisions to make](#decisions-to-make)
14. [Rough effort sizing](#rough-effort-sizing)
15. [Risks and dependencies](#risks-and-dependencies)

---

## Vision

**Goal:** Every Market Coordinator signs into one URL, sees only the tickets they are responsible for, and works them with the same inbox workflow the CRM provides today (status, replies, SLAs, admin notes, Salesforce/Nova links).

**Intake:** Replace scattered Google Forms with **one hosted submission form** (or one canonical Google Form) that writes to **one unified intake sheet** (or database). The submitter selects a **Market Manager**; the system **routes** the ticket to the correct Market Coordinator queue.

**Non-goals (for initial phases):** full Zendesk parity, customer-facing portal, automated Salesforce case creation, or AI triage — unless explicitly added later.

---

## Today vs tomorrow

| Dimension | Today (localhost CRM) | Target (hosted, multi-MC) |
|-----------|----------------------|---------------------------|
| **Users** | One operator per machine | Many MCs concurrently |
| **Deployment** | `localhost:3000` on a laptop | HTTPS web app (internal or VPC) |
| **Intake** | External Google Form → team sheet | Hosted form **or** unified Google Form → single sheet |
| **Source of truth** | Google Sheet + local `overlay.db` | Shared database **+** optional sheet sync |
| **Ticket visibility** | Everyone sees all tickets in the sheet | MC sees **assigned queue**; leads see team/MM views |
| **MM field (Column H)** | Read-only; used for CC + dashboard filter | **Routing input** at submission time |
| **Assignment** | None (status filter only) | Explicit **assigned MC** per ticket |
| **Auth** | Personal Google OAuth cookie | Workspace SSO + app sessions + RBAC |
| **Preferences** | Per-machine SQLite | Per-user in shared DB |
| **Email** | Send as signed-in operator’s Gmail | Shared support mailbox **or** per-MC send with audit |

### What already helps

The current codebase already has building blocks that carry forward:

- Ticket model with MM (`marketManager`), contact reason, status overlay, thread storage
- MM name → email directory (`market-managers.json`, `resolveMarketManagerEmail`)
- Dashboard breakdown by MM and “top hosts by MM”
- Column mapping and sheet write paths for status, user ID, notes, etc.
- Compose flow with optional MM CC

### What is missing entirely

- **User accounts** and role-based access
- **Assignment** field and routing rules (MM → MC)
- **Central data store** (SQLite is per-installation)
- **Hosted intake form**
- **API authentication** on every mutation
- **Shared Gmail** strategy for outbound mail
- **Admin UI** for routing tables, user provisioning, and org settings

---

## Target user experience

### Market Coordinator

1. Sign in with company Google account at `https://crm.<company>.com`.
2. Land on **My queue** — tickets assigned to them, default sort by SLA / submission date.
3. Open ticket → same detail view as today (status, reply, user ID, notes, thread).
4. Send reply; status moves to Pending; MM CC optional.
5. Filter within queue by status, contact reason, MM (when covering for a peer).
6. Personal preferences (default status filter, sort) persist across devices.

### Team lead / MM (optional role)

- View all tickets for MCs on their team or for a given MM.
- Reassign ticket to another MC.
- Dashboard for team volume, SLA breaches, and MM breakdown.

### Admin / ops

- Manage MM → MC routing table.
- Manage hosted form fields and validation.
- Configure sheet sync (if retained).
- Audit log of status changes, sends, and reassignments.

### Submitter (host / internal)

- Single public or SSO-gated **intake form** with MM dropdown.
- Confirmation with reference ID (row ID or ticket number).

---

## Intake: unified form and sheet

Today intake is a **Google Form** linked to a **Google Sheet**. Coordinators use SheetsCRM as a CRM layer on top. For a hosted rollout there are three viable patterns.

### Option A — Hosted form → append to Google Sheet (lowest CRM change)

```
[Hosted intake form]  →  Sheets API append row  →  [Unified Google Sheet]
                                                          ↓
                                              [Hosted SheetsCRM reads sheet]
```

**Pros**

- Keeps sheet as operational source of truth (familiar to ops, existing reports).
- MM stays in Column H as today.
- Gradual migration: retire old forms, point everyone to new form URL.

**Cons**

- Still dependent on Google Sheets API quotas and schema discipline.
- Concurrent writes from many MCs + form need careful conflict handling.
- Sheet remains a PII surface with broad sharing risk.

**New work**

- Public `/intake` route (or separate lightweight app) with field parity to current Google Form.
- Server-side validation, MM dropdown from directory, rate limiting, spam protection.
- Service account or workspace bot with **append-only** access to unified tab.
- Optional webhook/Apps Script for duplicate detection.

### Option B — Hosted form → PostgreSQL (recommended for scale)

```
[Hosted intake form]  →  POST /api/intake  →  [PostgreSQL tickets table]
                                                      ↓
                                            [SheetsCRM UI reads DB]
                                                      ↓
                                            [Optional sheet export/sync]
```

**Pros**

- Proper multi-user concurrency, assignment, and audit in one place.
- Row-level security by `assigned_coordinator_id`.
- Sheet becomes export/reporting, not runtime dependency.

**Cons**

- Larger build: migrate overlay logic off SQLite.
- Ops must agree on DB-as-truth or dual-write period.

**New work**

- `tickets` table mirroring current `Ticket` + overlay fields.
- Background job to sync status/notes **to** sheet if downstream tools still read Column N/U.

### Option C — Keep Google Form, unify sheet only (fastest path to routing)

- Retire duplicate forms; one Google Form → one sheet tab.
- Build **hosted CRM only** first; intake unchanged.
- Add assignment column to sheet (e.g. Column **AE**: “Assigned MC email”).
- Routing via Apps Script on form submit: set MM (H) + assign MC (AE) from lookup table.

**Pros:** Minimal intake engineering; MCs get hosted CRM quickly.  
**Cons:** Form UX still in Google; routing logic split between Apps Script and app.

### Recommended path

| Phase | Intake | Data |
|-------|--------|------|
| **1** | Option C or A | Sheet + central DB for overlay/assignment |
| **2** | Option A hosted form | Sheet + DB |
| **3** | Option B | DB primary, sheet sync optional |

### Unified form fields (parity with current sheet)

Align with existing column roles (`src/lib/column-roles.ts`):

| Field | Sheet column (today) | Notes |
|-------|---------------------|--------|
| Timestamp | A | Server-set on submit |
| Requester email | D | Required |
| Reservation code | E | Optional |
| Listing ID | F | Optional |
| **Market Manager** | H | **Dropdown — drives routing** |
| Contact reason | I | Dropdown |
| Description / message | (varies) | Required |
| Subject | (if collected) | Or derived from reason |
| Status | N | Default `Open` or CRM `new` until first touch |
| Assigned MC | **new** | Email or internal user ID |

Internal tool columns (K, M, R) may remain sheet-only formulas or post-submit automation.

---

## Routing: MM → Market Coordinator

Today **Column H (Market Manager)** is informational: CC on reply, dashboard slices. There is **no assignee**.

### Routing concepts

| Term | Meaning |
|------|---------|
| **Market Manager (MM)** | Selected on intake; business owner of the market |
| **Market Coordinator (MC)** | Operator who works the ticket in the CRM |
| **Routing rule** | MM (and optionally contact reason, region) → MC |

### Routing rule types (pick one or combine)

1. **Static mapping** — each MM maps to one primary MC (simplest).
2. **MM → pool** — MM maps to a team; **round-robin** or **load-based** pick within pool.
3. **MM + contact reason** — e.g. “Trust & Safety” reasons go to specialized MC pool.
4. **Manual queue** — ticket lands in MM pool unassigned; lead assigns (fallback).

### Routing table (new config)

Example structure to store in DB (replaces flat `market-managers.json` for routing):

```json
{
  "marketManager": "Amy Smith",
  "marketManagerEmail": "amy.smith@airbnb.com",
  "primaryCoordinatorId": "user_abc",
  "backupCoordinatorIds": ["user_def"],
  "poolId": "pool_west",
  "routingStrategy": "primary_with_round_robin_fallback"
}
```

### Assignment lifecycle

```
Form submitted (MM selected)
       ↓
Routing engine resolves MC
       ↓
Ticket created with assigned_coordinator_id + status=new
       ↓
MC works ticket; status → open/pending/resolved
       ↓
Optional: reassignment by lead; audit entry
```

### UI changes in CRM

- **My queue** default view: `assigned_coordinator_id = current_user`.
- Ticket list badge: MM name (still show Column H).
- **Unassigned** bucket for leads (status `new`, no assignee).
- Setup → **Routing** tab: edit MM → MC map (admin only).
- Dashboard: existing MM charts + new **by coordinator** workload view.

### Sheet sync for assignment

If sheet remains source of truth, add a dedicated column:

| Column | Suggested header | Written by |
|--------|------------------|------------|
| AE (or next free) | Assigned coordinator | CRM on route/reassign |
| AF | Assigned at (timestamp) | CRM |

Keep MM in H as the **submitter’s selection**, not the assignee.

---

## Platform architecture

### High-level (target)

```
                    ┌─────────────────────┐
                    │  Intake (public/SSO) │
                    └──────────┬──────────┘
                               │
┌──────────────┐    ┌──────────▼──────────┐    ┌─────────────────┐
│ Google       │◄──►│  SheetsCRM API       │◄──►│  PostgreSQL     │
│ Sheet (opt.) │    │  (Next.js / Node)    │    │  (tickets,      │
└──────────────┘    └──────────┬──────────┘    │   threads,      │
                               │                │   routing,      │
                    ┌──────────▼──────────┐    │   audit)        │
                    │  Google OAuth /     │    └─────────────────┘
                    │  Workspace SSO      │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Gmail API          │
                    │  (shared or user)   │
                    └─────────────────────┘
```

### Infrastructure components

| Component | Purpose |
|-----------|---------|
| **Web app** | Next.js (existing UI, adapted for server-side sessions) |
| **PostgreSQL** | Tickets, overlay, threads, users, routing, prefs, audit |
| **Redis** (optional) | Session store, job queue, rate limits |
| **Object storage** (optional) | Attachment growth if intake adds files |
| **Worker** | Sheet sync, Gmail import webhooks, SLA notifications |
| **Secrets manager** | OAuth client, SA keys, Mixmax token |
| **Load balancer + TLS** | HTTPS, WAF, IP allowlist if required |

### Codebase changes (from current repo)

| Area | Change |
|------|--------|
| `overlay-db.ts` | Replace or dual-write to Postgres adapter |
| `google-auth.ts` | App sessions; per-request user context; no long-lived refresh in cookie alone |
| All `/api/*` routes | Auth middleware + authorization checks |
| `CrmShell.tsx` | Queue scoped to user; remove localhost-only assumptions |
| New `routing-service.ts` | MM → MC resolution on intake |
| New `intake` routes | `POST /api/intake`, public form page |
| `SetupModal` | Split: admin config vs per-user prefs |
| Env / MM JSON | Move to DB + admin API; secrets out of git |

See [ENGINEERING_AND_SECURITY.md](./ENGINEERING_AND_SECURITY.md) for security controls that become **mandatory** when hosted.

---

## Data model changes

### New tables (PostgreSQL)

**`users`**

- `id`, `email`, `name`, `role` (`coordinator` | `lead` | `admin`)
- `google_sub`, `created_at`, `disabled_at`

**`tickets`** (sheet row or standalone)

- All current `Ticket` fields
- `spreadsheet_id`, `sheet_row_number` (nullable if DB-only)
- `market_manager` (from intake)
- `assigned_coordinator_id` → `users`
- `assigned_at`, `assigned_by_id`
- `status`, `status_changed_at`, overlay fields currently in SQLite

**`routing_rules`**

- `market_manager_key`, `strategy`, `primary_coordinator_id`, `pool_id`, `priority`, `active`

**`thread_messages`** — same as today, keyed by `ticket_id`

**`user_preferences`**, **`ticket_compose_prefs`** — migrate from SQLite as-is

**`audit_events`**

- `ticket_id`, `actor_id`, `action`, `payload`, `created_at`

**`sheet_sync_state`**

- Last synced row, column checksums, error log (if dual-write)

### Ticket identity

Today `rowId` is derived from sheet position. For hosted:

- Stable **`ticket_id` (UUID)** as primary key.
- `external_row_key` for sheet correlation (`spreadsheetId:sheetName:rowNumber`).

---

## Authentication and access control

### Requirements

| Capability | Implementation |
|------------|----------------|
| Sign-in | Google Workspace OAuth (restricted to `@company.com`) |
| Session | HttpOnly secure cookie + server-side session store |
| API auth | Middleware validates session on every `/api/*` route |
| Authorization | RBAC + row-level filter on `assigned_coordinator_id` |

### Role matrix

| Action | MC | Lead | Admin |
|--------|----|------|-------|
| View own queue | ✓ | ✓ | ✓ |
| View all tickets | — | ✓ (team/MM scope) | ✓ |
| Update ticket / send email | Own only | Team | All |
| Reassign ticket | — | ✓ | ✓ |
| Edit routing table | — | — | ✓ |
| Edit sheet mapping / env | — | — | ✓ |
| View audit log | — | ✓ | ✓ |
| Submit intake form | public / SSO | — | — |

### Data isolation

- **Query filter:** `WHERE assigned_coordinator_id = $user OR $user.role IN ('lead','admin')` with optional MM scope for leads.
- **No client-side trust:** never accept `assigned_coordinator_id` from browser without server check.

---

## Email and Gmail strategy

Today each operator sends via **their personal Gmail** OAuth token. With many MCs this breaks down (wrong From address, no shared inbox, token on shared server).

### Options

| Strategy | Description | Fit |
|----------|-------------|-----|
| **Shared support mailbox** | One `market-coordinators@…` Gmail/Group; domain-wide delegation | Consistent From; central thread view |
| **Send-as aliases** | MCs send through shared mailbox with personal signature | Medium complexity |
| **Per-MC Gmail** | Each MC connects OAuth once to hosted app | Harder to administer; thread fragmentation |
| **Transactional provider** | SendGrid/SES for outbound only; Gmail import separate | Loses native Gmail thread UX |

**Recommendation:** shared mailbox + **domain-wide delegation** service account for `gmail.send` / `gmail.readonly`, with MC identity recorded in CRM audit (not necessarily in From).

### Thread linking

Keep 1:1 `gmail_thread_id` ↔ ticket. Import job polls or uses Gmail push notifications for inbound replies → auto Pending.

---

## Dashboards and reporting

Existing dashboard (`buildDashboardStats`) is **client-side over full ticket array**. For hosted:

- **Server-side aggregation** with same period filters (`dashboardPeriod`).
- Scope stats to user’s visible tickets (MC) or team (lead).
- Retain MM breakdown; add **coordinator workload** and **unassigned aging**.
- Optional: scheduled export to sheet or Looker from Postgres.

---

## Migration from today

### Data

1. **Export** `data/overlay.db` from each operator (if multiple exist) — merge conflicts by `row_id` / latest `updated_at`.
2. **Unified sheet:** merge historical tabs or keep read-only archive sheets.
3. **Import script:** sheet rows → `tickets` table; overlay → ticket fields; threads → `thread_messages`.
4. **MM directory:** import `market-managers.json` → `routing_rules` + MM email table.

### Process

1. Freeze local CRM writes during cutover window (or accept brief dual-run).
2. Point all MCs to hosted URL; disable local launchers.
3. Run parallel read-only shadow week (optional): compare counts and assignment.

### Backward compatibility

- Keep sheet Column N status sync if Nova/ops scripts depend on it.
- Document which columns remain **sheet-authoritative** vs **CRM-authoritative**.

---

## Phased delivery plan

### Phase 0 — Foundations (4–6 weeks)

- Postgres schema + migrate overlay/prefs off SQLite
- Deploy staging environment (HTTPS, secrets manager)
- Google Workspace SSO + session middleware
- API auth on all routes
- Single shared sheet connection via service account

**Exit:** One MC can use hosted CRM against real sheet with login; no routing yet.

### Phase 1 — Assignment & queues (3–4 weeks)

- `assigned_coordinator_id` on tickets
- Routing table admin UI (MM → primary MC)
- Intake hook: Apps Script **or** minimal `POST /api/intake` sets MM + assignment
- My queue / all tickets views
- Audit log for assignment and status

**Exit:** MCs only see their queue; new submissions auto-assign.

### Phase 2 — Hosted intake form (3–4 weeks)

- Public/intake form matching Google Form fields
- MM dropdown from routing directory
- Validation, spam protection, confirmation page
- Retire duplicate Google Forms

**Exit:** Single intake URL; unified sheet or DB rows.

### Phase 3 — Email hardening & ops (3–4 weeks)

- Shared mailbox + delegation
- Inbound sync job
- SLA alerts (email/Slack)
- Lead dashboards and reassignment workflows

**Exit:** Production-ready for full MC roster.

### Phase 4 — Optimize (ongoing)

- DB-primary with sheet as export only
- Load-based routing, PTO coverage rules
- Salesforce / internal API integrations

---

## Decisions to make

| # | Question | Options |
|---|----------|---------|
| 1 | **Sheet vs DB as source of truth?** | Sheet+DB dual-write / DB primary / sheet read-only |
| 2 | **Routing strategy?** | 1:1 MM→MC / pools / reason-based |
| 3 | **Can MCs see other queues?** | Strict isolation / read-only peek / lead-only |
| 4 | **Intake auth?** | Public link / Airbnb SSO / both |
| 5 | **Outbound email From address?** | Shared mailbox / per-MC |
| 6 | **Hosting** | Internal GCP/AWS / Vercel+RDS / existing platform |
| 7 | **Compliance** | Data residency, retention, PII redaction in audit |
| 8 | **Cutover** | Big bang vs pilot MM pool |

---

## Rough effort sizing

Estimates for **one full-stack engineer + part-time ops/security review**; adjust for team size and compliance.

| Phase | Calendar | Engineering focus |
|-------|----------|-------------------|
| Phase 0 Foundations | 4–6 weeks | DB, auth, deploy, API hardening |
| Phase 1 Routing & queues | 3–4 weeks | Assignment, routing UI, queue filters |
| Phase 2 Hosted intake | 3–4 weeks | Form, validation, intake API |
| Phase 3 Email & ops | 3–4 weeks | Shared Gmail, sync jobs, alerts |
| **Total to production** | **~3–4 months** | Excludes Option B full DB-primary rewrite |

Additional **+4–6 weeks** if migrating fully off Google Sheet as runtime source while preserving column sync for downstream consumers.

---

## Risks and dependencies

| Risk | Mitigation |
|------|------------|
| Sheet API rate limits at scale | Cache reads; DB primary; batch sync |
| Gmail delegation approval delay | Start Workspace admin ticket early |
| Routing errors (wrong MC) | Clear MM dropdown labels; audit + reassign UI |
| PII exposure on hosted app | RBAC, encryption, pen test, VPC |
| Multiple local SQLite DBs diverged | One-time merge script before cutover |
| MC adoption | Pilot with one MM pool; keep UX familiar |
| Google Form bookmarks | Redirect old forms; comms plan |

### Dependencies

- Google Workspace admin (OAuth app, domain delegation, shared mailbox)
- Unified intake sheet ownership and column schema sign-off
- MM → MC roster maintained by ops (routing table)
- Security review for production (see engineering security doc)
- Hosting budget and on-call ownership

---

## Summary

Moving SheetsCRM to a **hosted, multi-coordinator** product is feasible by reusing most of the current UI and ticket workflow, but it requires deliberate new work in four areas:

1. **Central platform** — Postgres, HTTPS, authenticated APIs, no per-laptop SQLite.
2. **Assignment & routing** — MM on intake → MC queue, with admin-configurable rules.
3. **Unified intake** — one form and one sheet (or DB) instead of fragmented forms.
4. **Shared email & governance** — outbound/inbound mail, audit, and RBAC suitable for customer PII.

The lowest-risk rollout is **Phase 0–1** on a unified Google Sheet with a new assignment column, then **Phase 2** hosted intake, then optional migration to database-primary as volume and compliance requirements grow.

---

*Aligned with SheetsCRM as of local overlay CRM (MM in Column H, dashboard by MM, no assignee field yet).*
