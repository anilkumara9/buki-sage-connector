# Buki × Sage Connector

> Syncs customer balances and ledger entries from Sage Accounting directly into Buki for finance teams, so they get real-time, clean data without manual exports.

**Status:** Day 3 plan ready for founder review (due Tuesday 3 Nov 2026, 11:59 pm). The work described below is the three-day record in Section 6 — Day 1 bootstrap and auth, Day 2 mappings, Day 3 sync, tests and plan. Code & Notes continue in the Build Phase (around 10 days in total) — daily notes are logged as the build progresses, and the completed project is submitted at the end of that phase, when it is tested and working.

**Repository:** https://github.com/anilkumara9/buki-sage-connector
**Proof Notebook:** See [`PROOF.md`](./PROOF.md) for the Day 3 plan submission (the first 4 boxes).

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [What This Connector Does](#2-what-this-connector-does)
3. [Assumptions](#3-assumptions)
4. [Architecture](#4-architecture)
5. [Tech Stack](#5-tech-stack)
6. [What Was Done in Three Days](#6-what-was-done-in-three-days)
   - [Day 1 — Bootstrap, Schema and Sandbox Auth](#day-1--sunday-1-nov-2026-bootstrap-schema-and-sandbox-auth)
   - [Day 2 — Entity Mappings and Type Validation](#day-2--monday-2-nov-2026-entity-mappings-and-type-validation)
   - [Day 3 — Polling Engine, Sample Sync, Tests and Plan Submission](#day-3--tuesday-3-nov-2026-polling-engine-sample-sync-tests-and-plan-submission)
7. [Authentication — OAuth2 with PKCE](#7-authentication--oauth2-with-pkce)
8. [Entity Mappings — Sage to Buki](#8-entity-mappings--sage-to-buki)
9. [Sync Engine — How a Sync Runs](#9-sync-engine--how-a-sync-runs)
10. [Error Handling and Resilience](#10-error-handling-and-resilience)
11. [Test List and Test Results](#11-test-list-and-test-results)
12. [Project Structure](#12-project-structure)
13. [How to Run It](#13-how-to-run-it)
14. [API Endpoints](#14-api-endpoints)
15. [Configuration](#15-configuration)
16. [Deployment — Staging](#16-deployment--staging)
17. [Current Status, Limitations and Next Steps](#17-current-status-limitations-and-next-steps)
18. [Open Question for the Founder](#18-open-question-for-the-founder)

---

## 1. The Problem

Finance teams that use Sage for accounting and Buki for their finance workflow have to move data between the two systems by hand — exporting customer lists and ledger entries from Sage, cleaning the files, and importing them into Buki. That process is:

- **Slow** — the data in Buki is only as fresh as the last manual export.
- **Error-prone** — balances, tax amounts and currencies can be mistyped, dropped or duplicated during manual handling.
- **Hard to trust** — if a record is malformed, there is no clear log of what failed and why.

## 2. What This Connector Does

This connector removes the manual step. It connects to the Sage Accounting API, reads customer balances and ledger entries (sales invoices and payments), validates and converts them into Buki's shape, and stores them in Buki — incrementally, so after the first sync it only pulls records that have changed.

For the finance team using Buki, that means:

- Customer balances in Buki mirror what is in Sage.
- Invoices and payments arrive as clean ledger entries, with amounts in a format that does not drift due to floating-point rounding.
- A bad record (for example, an invoice with a missing tax amount) is logged with a clear reason and skipped — it does not crash the sync or silently corrupt the ledger.

The connector is **read-only by design** at this stage: it ingests data from Sage into Buki and never writes back to Sage. Whether that should change is the open question for the founder (see Section 18).

## 3. Assumptions

The brief does not specify everything, so the following assumptions were made and recorded in the Proof Notebook before any code was written:

| # | Assumption | Why it matters |
|---|------------|----------------|
| 1 | Read-only permissions are sufficient for the initial sync. | The connector requests access to read Sage data only; it does not need write scopes to prove the ingestion flow. |
| 2 | Sage API returns standard schema structures without custom field overrides. | Validation schemas are built against Sage's documented, standard payload shapes. Custom fields would need to be added to the schemas later. |
| 3 | Pagination uses standard cursor tokens rather than manual offset limits. | The sync engine follows Sage's `$next` cursor from page to page instead of guessing page numbers and offsets. |
| 4 | Historical data ingestion is scoped to active accounts from the past 12 months. | The first sync stays bounded and relevant instead of importing an entire accounting history, including inactive accounts. |

## 4. Architecture

```
                         OAuth2 + PKCE (S256)
                    ┌────────────────────────────────┐
                    │  Auth:  src/auth/              │
                    │  - PKCE verifier / challenge   │
                    │  - Token exchange + refresh    │
                    │  - Secure token storage        │
                    └───────────────┬────────────────┘
                                    │ Bearer token
                                    ▼
┌─────────────────────────┐   ┌──────────────────┐   ┌─────────────────────────┐
│  Sage Accounting v3.1   │   │  Sage API Client │   │       Sync Engine       │
│                         │──▶│  src/sage/       │──▶│  src/sync/              │
│  GET /contacts          │   │  - Auth headers  │   │  - Pagination (cursor)  │
│  GET /sales_invoices    │   │  - 401 → refresh │   │  - High-water mark      │
│  GET /contact_payments  │   │  - 429 → backoff │   │  - Per-record errors    │
└─────────────────────────┘   └──────────────────┘   └────────────┬────────────┘
                                                                  │
                                        Zod validation + mapping  │  src/sage/schemas.ts
                                        Sage shape → Buki shape   │  src/buki/mappers.ts
                                                                  ▼
                                                     ┌─────────────────────────┐
                                                     │  Buki Store             │
                                                     │  - Accounts             │
                                                     │  - Ledger entries       │
                                                     │  - Ingestion error log  │
                                                     └─────────────────────────┘
                                                                  │
                                                     HTTP server (src/index.ts)
                                                     GET /health · POST /sync
                                                     GET /ledger · /auth/sage
```

**Key design choices**

- **Amounts are stored in minor units** (for example, £120.00 is stored as `12000`). This avoids floating-point drift in a financial ledger.
- **One bad record never kills a sync.** Validation and mapping errors are caught per record, logged with context, and counted as skipped.
- **Incremental after the first run.** The engine tracks a high-water mark — the latest `updated_at` timestamp it has seen — and asks Sage only for records updated or created since then.
- **The Buki store is behind a small interface.** The current in-memory store is used for staging and tests; a production version can replace it with Buki's real ledger API or database without changing the sync engine.

## 5. Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Language / runtime | TypeScript on Node.js 20+ | Typed payloads end to end; Node's built-in `fetch` is enough, so there is no HTTP-client dependency to maintain. |
| Validation | Zod | Sage payloads and Buki records are both described as Zod schemas, so invalid data fails at the boundary with a readable error. |
| HTTP server | Express | Small, familiar surface for the auth callback, health check and sync trigger. |
| Tests | Vitest, with a mock Sage fetch | The four proof tests run with no network and no real Sage credentials. |
| Packaging | Docker | The same image runs locally and on a staging host such as Render or Railway. |

Sage endpoints used (Accounting API v3.1, base URL `https://api.accounting.sage.com/v3.1`): `contacts`, `sales_invoices` and `contact_payments`.

---

## 6. What Was Done in Three Days

This section is the complete record of the first three days — what was planned, what was built, what was checked, and what was decided on each day.

### Day 1 — Sunday 1 Nov 2026: Bootstrap, Schema and Sandbox Auth

**Goal for the day:** Stand up the base connector and authenticate against the Sage sandbox.

**Work done**

1. **Project bootstrap**
   - Created the TypeScript / Node project with a strict TypeScript configuration, an Express server entry point (`src/index.ts`) and a configuration loader (`src/config.ts`) that validates every environment variable with Zod and fails early on a bad value.
   - Set up the project layout used for the rest of the build: `src/auth/`, `src/sage/`, `src/buki/` and `src/sync/`, plus a `tests/` folder.
   - Added `.env.example` listing every Sage setting the connector needs (client ID, client secret, subscription key, redirect URI, auth URL, token URL, API base, scope) with no real values in the file, and a `.gitignore` that keeps `.env`, token data, `node_modules` and build output out of git.

2. **OAuth2 PKCE implementation**
   - Wrote the PKCE helpers in `src/auth/pkce.ts`: a random code verifier, its SHA-256 (S256) code challenge, and a random `state` value to protect the flow.
   - Built the OAuth flow in `src/auth/oauth.ts`:
     - `buildAuthorizeUrl()` — builds the Sage authorisation URL (`https://www.sageone.com/oauth2/auth/central?filter=apiv3.1`) with `client_id`, `response_type=code`, `redirect_uri`, `scope`, `state` and the code challenge.
     - `exchangeCode()` — exchanges the authorisation code from the Sage callback for an access token and refresh token, sending the original code verifier so Sage can check it.
     - `refresh()` — exchanges a refresh token for a new token set when the access token expires.
     - `getValidAccessToken()` — returns the stored token if it is still valid, and refreshes it first if it has expired.
     - `forceRefresh()` — used when Sage rejects a token that looked valid locally (an HTTP 401), so the client can recover without a human reconnecting the account.
   - Added the server routes for the flow: `GET /auth/sage` redirects the user to Sage, and `GET /auth/sage/callback` completes the exchange.

3. **Secure credential storage**
   - Implemented a token store (`src/auth/tokenStore.ts`) with two implementations behind the same shape:
     - A **file store** for local and staging use, which writes tokens to `.data/tokens.json` with owner-only file permissions (`0600`) in a git-ignored folder.
     - An **in-memory store** for tests, so no test ever touches a real credential.
   - Noted the production requirement in the code: the file store should be swapped for an encrypted, KMS-backed secret store. No Sage secret, token or password is committed to this repository.

4. **Sandbox verification approach**
   - The token handshake is verified against Sage's developer sandbox using a sandbox app's client ID, secret and subscription key supplied through the environment — never through code.
   - Honest status: the flow, URLs, parameters and headers in this repository follow Sage's documented OAuth2 + PKCE flow and are exercised end to end against a mock Sage server in the test suite (including a simulated 401 and refresh). A live handshake against a real Sage sandbox tenant still requires sandbox credentials to be provided, so that live check is listed as a next step in Section 17 rather than claimed as done.

**Result at the end of Day 1:** A connector skeleton that can start the Sage connect flow, exchange and store tokens, refresh them automatically, and serve a health check — with no credentials in the codebase.

---

### Day 2 — Monday 2 Nov 2026: Entity Mappings and Type Validation

**Goal for the day:** Map the core ledger entities — customers, invoices and payments — to Buki schemas.

**Work done**

1. **Sage payload schemas (`src/sage/schemas.ts`)**
   - Described the Sage payloads the connector actually reads, using Zod:
     - **Contact** — ID, display name, contact type, customer/supplier flags, status, email, address, credit limit and days, balance, currency, and `created_at` / `updated_at` timestamps.
     - **Sales invoice** — ID, contact ID, dates, reference, status, currency, net / tax / total amounts, amount paid and outstanding, and its invoice lines.
     - **Payment** — ID, contact ID, date, reference, total amount, currency and payment method.
     - **List response** — Sage's paginated envelope (`$items`, `$total`, `$page`, `$next`, `$back`), shared by all three list endpoints.
   - Handled real-world payload variation at the schema layer: money values are coerced to numbers (Sage returns them as strings on some endpoints), and a missing balance defaults to `0` instead of failing the record.

2. **Buki record schemas (`src/buki/schemas.ts`)**
   - Defined the two Buki-side record types the sync produces:
     - **Buki account** — external (Sage) ID, source, name, email, active/inactive status, currency, balance in minor units, credit limit in minor units, and last-updated timestamp.
     - **Buki ledger entry** — external ID, account ID, kind (`invoice` or `payment`), dates, reference, status, currency, and net / tax / total / outstanding amounts, all in minor units.
   - Added the single conversion helper used everywhere, `toMinor()`, which rounds a Sage amount to the nearest minor unit instead of truncating it.

3. **Mappers (`src/buki/mappers.ts`)**
   - `mapContactToBuki()` — converts a Sage contact into a Buki account, including translating Sage's `INACTIVE` status into Buki's `inactive` status and converting balance and credit limit into minor units.
   - `mapInvoiceToBuki()` — converts a Sage sales invoice into a Buki ledger entry.
   - `mapPaymentToBuki()` — converts a Sage payment into a Buki ledger entry marked as paid, with no outstanding amount.
   - **The missing-tax decision:** an invoice whose `tax_amount` is missing cannot be reconciled in Buki (net + tax should equal total), so the mapper throws a specific `IngestionError` carrying the invoice ID, contact ID, net and total. The sync engine catches that error, logs it, and skips only that one record. It is never silently accepted, and it never crashes the pipeline. This behaviour is one of the four proof tests (Section 11).

**Result at the end of Day 2:** Every Sage record the connector reads has a validated shape, a Buki shape, and a tested conversion between the two — including a deliberate, logged failure path for invoices with missing tax data.

---

### Day 3 — Tuesday 3 Nov 2026: Polling Engine, Sample Sync, Tests and Plan Submission

**Goal for the day:** Run an end-to-end sync on a sample batch to verify data consistency, and submit the Day 3 plan.

**Work done**

1. **Resilient Sage API client (`src/sage/client.ts`)**
   - Adds the headers every Sage request needs: the Bearer access token, `Content-Type: application/json`, and the developer subscription key (`ocp-apim-subscription-key`) when one is configured.
   - **On HTTP 401:** forces one token refresh and retries the request once with the fresh token.
   - **On HTTP 429, HTTP 5xx, or a network error:** retries with exponential backoff plus a small random jitter, and honours Sage's `Retry-After` header when Sage sends one.
   - Gives up after a bounded number of attempts and raises a `SageApiError` with the status and URL, instead of looping forever.

2. **Sync engine (`src/sync/engine.ts` and `src/sync/store.ts`)**
   - Implemented as an async generator in the client (`paginate()`) that follows Sage's `$next` cursor page by page, requesting 100 items per page, so memory stays flat no matter how large the account is.
   - A full sync runs in a fixed order: **contacts first, then sales invoices, then payments**, so ledger entries can always be matched to an account that already exists in Buki.
   - **Historical scope applied:** on the first sync, inactive contacts are skipped and only the past 12 months are requested, per the assumptions in Section 3.
   - **High-water mark:** the engine remembers the latest `updated_at` it has processed and passes it to Sage as `updated_or_created_since` on the next run, so repeat syncs are incremental.
   - **Per-record safety:** every record is parsed with its Zod schema before it is mapped. A record that fails validation or mapping is counted as skipped and written to the Buki store's error log with its context; the rest of the batch continues.
   - **Payments are isolated:** the payments endpoint name and availability vary between Sage tenants, so a `404` there is logged as “not available in this tenant — skipped” and does not fail the contacts and invoices sync.
   - The Buki store (`BukiStore`) holds accounts and ledger entries keyed by their Sage IDs (so re-running a sync updates records instead of duplicating them) and keeps the full ingestion error log.

3. **End-to-end sample sync check**
   - Wired the engine to the HTTP server: `POST /sync` runs a full sync and returns the counts and error total; `GET /ledger` returns everything that landed in Buki (accounts, ledger entries and errors) so the result can be inspected directly; `GET /health` returns the service status and the current high-water mark.
   - Ran the end-to-end flow against the mock Sage server in the test suite with a sample batch of 100 customers: the count in Buki matched the count in Sage exactly, and a sample customer's balance converted correctly into minor units (see Section 11).

4. **Synthetic tests**
   - Wrote the integration tests listed in Section 11, using a mock Sage fetch (`tests/mockSage.ts`) that can simulate an expired token, a burst of rate-limit responses and a malformed (missing-tax) payload — no network and no real credentials.
   - All four proof tests pass, and the TypeScript build and type check are clean.

5. **Packaging and plan submission**
   - Added a `Dockerfile` so the connector can be run as a single container locally or deployed to a staging host such as Render or Railway.
   - Wrote the Proof Notebook plan (the first 4 boxes) and this README, and formulated the founder question, ready to submit by the Day 3 deadline — Tuesday 3 Nov 2026, 11:59 pm — so the founder can review the direction and give feedback while course correction is still cheap.

**Result at the end of Day 3:** A working, tested connector scaffold — auth, mappings, a resilient incremental sync, an inspectable result, and a container to deploy it — plus a plan ready to submit, with one clear question for the founder.

---

## 7. Authentication — OAuth2 with PKCE

Sage uses a three-legged OAuth 2.0 flow. This connector uses the PKCE extension (S256), so no shared secret needs to be embedded in a client.

1. The user visits `GET /auth/sage` in this service.
2. The service generates a random **code verifier**, hashes it into a **code challenge**, generates a random **state**, remembers the verifier against that state, and redirects the user to Sage's authorisation URL with the challenge.
3. The user signs in to Sage and approves access for their business.
4. Sage redirects back to `GET /auth/sage/callback` with a one-time **code** and the **state**.
5. The service looks up the verifier for that state and exchanges the code, the verifier, the client ID and secret, and the redirect URI at Sage's token URL.
6. Sage returns an **access token**, a **refresh token** and an expiry. The service stores them in the token store.
7. API calls send the access token as a Bearer token. If it has expired, the service refreshes it automatically before the call. If Sage still returns `401`, the service forces one refresh and retries the call once.

Scopes: the connector requests `full_access` in configuration by default but only performs reads. Narrowing this to Sage's read-only scope for the initial sync is part of the read-only assumption in Section 3 and will be confirmed with the founder's answer to the question in Section 18.

## 8. Entity Mappings — Sage to Buki

### Contact → Buki account

| Sage (`contacts`) | Buki account | Notes |
|-------------------|--------------|-------|
| `id` | `externalId` | Also the deduplication key in Buki. |
| — | `source` | Always set to `sage`. |
| `displayed_as` | `name` | Sage's display name for the contact. |
| `email` | `email` | Nullable in both systems. |
| `status_id` | `status` | `INACTIVE` → `inactive`; anything else → `active`. |
| `currency_id` | `currency` | Defaults to `GBP` if Sage omits it. |
| `balance` | `balanceMinor` | Converted with `toMinor()`; a missing balance is treated as `0`. |
| `credit_limit` | `creditLimitMinor` | Converted with `toMinor()`; stays `null` if Sage has no limit set. |
| `updated_at` | `updatedAt` | Also feeds the sync high-water mark. |

### Sales invoice → Buki ledger entry

| Sage (`sales_invoices`) | Buki ledger entry | Notes |
|-------------------------|-------------------|-------|
| `id` | `externalId` | Kind is set to `invoice`. |
| `contact_id` | `accountExternalId` | Links the entry to the Buki account. |
| `date` / `due_date` | `date` / `dueDate` | Due date is nullable. |
| `reference` | `reference` | Nullable. |
| `status_id` | `status` | Stored lower-cased, for example `paid`, `draft`. |
| `currency_id` | `currency` | |
| `net_amount` | `netMinor` | Converted with `toMinor()`. |
| `tax_amount` | `taxMinor` | **Required.** If it is missing, the record is logged and skipped (see Section 10). |
| `total_amount` | `totalMinor` | Converted with `toMinor()`. |
| `amount_outstanding` | `outstandingMinor` | Converted with `toMinor()`. |
| `updated_at` | `updatedAt` | Also feeds the high-water mark. |

### Payment → Buki ledger entry

| Sage (`contact_payments`) | Buki ledger entry | Notes |
|---------------------------|-------------------|-------|
| `id` | `externalId` | Kind is set to `payment`. |
| `contact_id` | `accountExternalId` | |
| `date` | `date` | No due date for a payment. |
| `reference` | `reference` | Nullable. |
| — | `status` | Set to `paid`. |
| `currency_id` | `currency` | |
| `total_amount` | `netMinor` and `totalMinor` | A payment carries no separate tax split in this mapping, so `taxMinor` is `0` and the outstanding amount is `0`. |
| `updated_at` | `updatedAt` | Also feeds the high-water mark. |

## 9. Sync Engine — How a Sync Runs

1. `POST /sync` is called (in production this would be called by a scheduler or a background worker on an interval).
2. The engine works out where to start from: its high-water mark if it has one, otherwise 12 months ago.
3. It pages through Sage **contacts**, validates each one, maps it and upserts it into the Buki store, and advances the high-water mark.
4. It then does the same for **sales invoices**, and then for **payments**.
5. Any record that fails validation or mapping is logged with its context and counted as `skipped`. The sync continues.
6. The call returns a summary: how many contacts, invoices and payments were synced, how many were skipped, and the new high-water mark.

Because records are upserted by their Sage ID, running a sync twice does not create duplicates.

## 10. Error Handling and Resilience

| Situation | Behaviour |
|-----------|-----------|
| Access token expired before a call | Refreshed automatically from the stored refresh token, then the call proceeds. |
| Sage returns `401` anyway | One forced refresh, then the call is retried once with the new token. |
| Sage returns `429` (rate limited) | Exponential backoff with jitter; Sage's `Retry-After` header is honoured when present. The request completes on a later retry. |
| Sage returns `5xx`, or the network fails | Same backoff and retry path as `429`, up to a bounded number of attempts. |
| Retries are exhausted | A `SageApiError` is raised with the status and URL, and the sync fails visibly instead of looping or silently returning partial data as if it were complete. |
| A record fails Zod validation | Logged with the validation issues, counted as skipped, sync continues. |
| An invoice has no `tax_amount` | A descriptive `IngestionError` is logged — invoice ID, contact ID, net and total — the record is skipped, and the sync continues. |
| Payments endpoint returns `404` in a tenant | Logged as not available in that tenant and skipped; contacts and invoices are unaffected. |

## 11. Test List and Test Results

The test list below was written **before any code**, as part of the Proof Notebook. Each test is now implemented in `tests/sync.test.ts`, using the mock Sage server in `tests/mockSage.ts`.

| # | Test (as originally listed) | Result |
|---|-----------------------------|--------|
| 1 | Simulate an invalid Sage OAuth token → receive `401` and trigger the refresh handshake. | **Pass.** The first API call returns `401`, exactly one token refresh call is made, and the retried call succeeds. |
| 2 | Query 100 Sage customers → validate the Buki ledger mirrors the customer counts exactly. | **Pass.** 100 mock customers sync into exactly 100 Buki accounts, and a spot-checked balance converts correctly (£142.00 → `14200`). |
| 3 | Send an invoice payload with a missing tax field → the ingestion pipeline logs a descriptive error without crashing. | **Pass.** The sync completes, the invoice is skipped, one error matching “missing tax_amount” is logged with the invoice ID, and the other records in the batch still sync. |
| 4 | Simulate a Sage `429` rate limit → exponential backoff delays the request and it completes on retry. | **Pass.** Two `429` responses produce two recorded backoff delays on a growing exponential schedule, and the third attempt succeeds. |

Run them with:

```bash
npm test
```

Current result: **4 tests passed, 0 failed.** `npm run typecheck` and `npm run build` are also clean.

## 12. Project Structure

```
buki-sage-connector/
├── PROOF.md                  Day 3 plan submission (the first 4 boxes)
├── README.md                 This file
├── Dockerfile                Single-container build for local / staging
├── .env.example              Every setting, with no real values
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              Express server: /health, /auth/sage, /sync, /ledger
│   ├── config.ts             Environment loading and validation (Zod)
│   ├── auth/
│   │   ├── pkce.ts           Code verifier, S256 challenge, state
│   │   ├── oauth.ts          Authorise URL, code exchange, refresh, 401 recovery
│   │   └── tokenStore.ts     File store (0600) and in-memory store for tests
│   ├── sage/
│   │   ├── schemas.ts        Zod schemas for Sage contacts, invoices, payments, lists
│   │   └── client.ts         Sage API client: headers, 401 refresh, 429 backoff, pagination
│   ├── buki/
│   │   ├── schemas.ts        Buki account and ledger schemas, minor-unit helper
│   │   └── mappers.ts        Sage → Buki conversions, including the missing-tax error
│   └── sync/
│       ├── engine.ts         Full sync: contacts → invoices → payments, high-water mark
│       └── store.ts          Buki store: accounts, ledger, ingestion error log
└── tests/
    ├── mockSage.ts           Mock Sage payloads and responses — no network, no credentials
    └── sync.test.ts          The four proof tests
```

## 13. How to Run It

Prerequisites: Node.js 20 or later, and a Sage developer app (sandbox is fine) with a client ID, client secret and subscription key.

```bash
cp .env.example .env    # fill in your Sage sandbox values
npm install
npm test                # run the four proof tests
npm run dev             # start the connector on http://localhost:3000
```

Then:

1. Open `http://localhost:3000/auth/sage` — you are redirected to Sage to connect an account.
2. After Sage redirects back, call `POST http://localhost:3000/sync` to run the first sync.
3. Open `http://localhost:3000/ledger` to inspect the accounts, ledger entries and ingestion errors that landed in Buki.
4. Call `POST /sync` again — only records changed since the high-water mark are pulled.

## 14. API Endpoints

| Method and path | What it does |
|-----------------|--------------|
| `GET /health` | Returns `{ ok: true, service, highWaterMark }`. Use it to confirm the service is up and to see how far the sync has reached. |
| `GET /auth/sage` | Starts the Sage OAuth2 PKCE flow by redirecting to Sage. |
| `GET /auth/sage/callback` | Sage's redirect target. Exchanges the code for tokens and stores them. |
| `POST /sync` | Runs a full (or incremental, if a high-water mark exists) sync and returns the counts, skipped total and new high-water mark. |
| `GET /ledger` | Returns all synced Buki accounts, ledger entries and ingestion errors. Intended for staging and inspection, not as a production Buki API. |

## 15. Configuration

All configuration comes from environment variables (see `.env.example`). Nothing is hard-coded, and no real value should ever be committed.

| Variable | Meaning |
|----------|---------|
| `SAGE_CLIENT_ID` | Client ID of the Sage developer app. |
| `SAGE_CLIENT_SECRET` | Client secret of the Sage developer app. |
| `SAGE_SUBSCRIPTION_KEY` | Sage developer subscription key, sent as the `ocp-apim-subscription-key` header. |
| `SAGE_REDIRECT_URI` | Must exactly match the redirect URI registered in the Sage app. Default: `http://localhost:3000/auth/sage/callback`. |
| `SAGE_AUTH_URL` | Sage authorisation URL. Default: `https://www.sageone.com/oauth2/auth/central?filter=apiv3.1`. |
| `SAGE_TOKEN_URL` | Sage token endpoint. Default: `https://oauth.accounting.sage.com/token`. |
| `SAGE_API_BASE` | Sage Accounting API base. Default: `https://api.accounting.sage.com/v3.1`. |
| `SAGE_SCOPE` | OAuth scope requested. Default: `full_access` (see the note in Section 7). |
| `PORT` | Port the connector listens on. Default: `3000`. |
| `SYNC_MONTHS_BACK` | Historical window for the first sync, in months. Default: `12`. |
| `TOKEN_STORE_PATH` | Where the file token store writes. Default: `.data/tokens.json`. |

## 16. Deployment — Staging

```bash
docker build -t buki-sage-connector .
docker run -p 3000:3000 --env-file .env buki-sage-connector
```

The same Dockerfile can be deployed to Render or Railway as a single web service, with the variables from Section 15 set in that platform's dashboard instead of a `.env` file.

## 17. Current Status, Limitations and Next Steps

**Done by the end of Day 3**

- Connector bootstrap, configuration and project layout.
- OAuth2 PKCE flow with automatic refresh and 401 recovery.
- Zod schemas for Sage contacts, sales invoices, payments and list responses.
- Buki account and ledger schemas, with minor-unit money handling.
- Sage → Buki mappers for all three entities, including the missing-tax failure path.
- Resilient Sage client: auth headers, backoff on `429` / `5xx` / network errors, `Retry-After` support.
- Incremental, cursor-paginated sync engine with a high-water mark and per-record error logging.
- HTTP surface to connect an account, run a sync and inspect the result.
- Four proof tests, all passing; type check and build clean.
- Dockerfile for staging, Proof Notebook plan and this README.

**Limitations — stated plainly**

- **No live Sage tenant has been synced yet.** The flow is built to Sage's documented API and is fully exercised against a mock Sage server, but a live sandbox handshake needs sandbox credentials that have not been provided yet.
- **The Buki store is in memory.** It proves the mapping and sync behaviour and is what the tests assert against; connecting it to Buki's real ledger storage is Build Phase work.
- **Token storage is a local file.** Suitable for local and staging use only. Production needs an encrypted secret store.
- **Payments coverage depends on the Sage tenant.** The payments endpoint differs between tenants, so that part of the sync is isolated and allowed to skip cleanly on a `404`.
- **Custom Sage fields are out of scope** under the standard-schema assumption in Section 3.

**Next steps in the Build Phase (around 10 days in total, with daily notes)**

- Connect a real Sage sandbox tenant and verify the live OAuth handshake and a live sync.
- Replace the in-memory Buki store with Buki's real ledger destination.
- Move token storage to an encrypted secret store.
- Add scheduled / background syncing instead of a manual `POST /sync` trigger.
- Act on the founder's answer to the question below — in particular, whether any status needs to be written back to Sage.

## 18. Open Question for the Founder

> **Does Buki require bidirectional status sync back to Sage, or read-only ingestion?**

The connector is built read-only until this is answered. If Buki only needs clean, current data from Sage, the current design is sufficient and the scope stays small. If invoice or payment status in Buki must flow back into Sage, that adds write scopes, conflict handling (which system wins when both sides change a record), and a second test list — which is exactly why the question is asked at the plan stage, while course correction is still cheap.
