# Buki × Sage Connector

Syncs customer balances and ledger entries from Sage Accounting directly into Buki for finance teams — real-time, clean data without manual exports.

## How it works

```
Sage Accounting (v3.1)
  GET /contacts          ──┐
  GET /sales_invoices     ├──> SyncEngine ──> BukiStore (accounts + ledger, minor units)
  GET /contact_payments  ──┘        │
                                    └── errors logged per-record, never crash the sync
Auth: OAuth2 + PKCE (S256), auto-refresh on expiry and on 401
Resilience: exponential backoff on 429 / 5xx, Retry-After honoured
Incremental: high-water mark on `updated_at`, only pulls changes after first sync
Historical scope: active accounts, past 12 months (assumption — see PROOF.md)
```

Base API: `https://api.accounting.sage.com/v3.1`
Auth URL: `https://www.sageone.com/oauth2/auth/central?filter=apiv3.1` (client_id, response_type=code, redirect_uri, scope, state, code_challenge / S256)

## Run it

```bash
cp .env.example .env   # fill in your Sage sandbox client id/secret + subscription key
npm install
npm test               # 4 proof tests
npm run dev            # http://localhost:3000
```

1. Visit `GET /auth/sage` — redirects through Sage PKCE flow
2. Callback stores tokens in `.data/tokens.json` (0600, gitignored)
3. `POST /sync` — runs contacts → invoices → payments sync
4. `GET /ledger` — inspect mirrored Buki accounts, ledger entries, and ingestion errors
5. `GET /health` — service + high-water mark

## Tests (written before the sync logic was finished)

| # | Scenario | What passes |
|---|----------|-------------|
| 1 | Invalid token → 401 | Refresh handshake fires once, retry succeeds |
| 2 | 100 Sage customers | Buki accounts = exactly 100, balances in minor units |
| 3 | Invoice missing `tax_amount` | Descriptive `IngestionError` logged, sync continues, record skipped |
| 4 | Sage 429 ×2 | Exponential backoff delays recorded, third attempt succeeds |

```bash
npm test
```

## Deploy (staging)

```bash
docker build -t buki-sage-connector .
docker run -p 3000:3000 --env-file .env buki-sage-connector
```
Or deploy the same Dockerfile to Render / Railway as a web service with the `.env` vars set in the dashboard.

## Layout

- `src/auth/` — PKCE helpers, OAuth flow, file/memory token stores
- `src/sage/` — Zod schemas for Sage payloads, resilient API client
- `src/buki/` — Buki account/ledger schemas + mappers (amounts → minor units)
- `src/sync/` — pagination engine with high-water mark, Buki store
- `tests/` — mock Sage fetch + the 4 proof tests

## Open question for Buki
Does Buki require bidirectional status sync back to Sage, or is read-only ingestion enough? The connector is read-only by design until this is answered.
