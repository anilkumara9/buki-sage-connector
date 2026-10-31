# Proof Notebook — Buki × Sage Connector

## What does it do, and for whom?
It syncs customer balances and ledger entries from Sage directly into Buki for finance teams so they get real-time, clean data without manual exports.

## What are you assuming that the brief doesn't say?
- Read-only permissions are sufficient for initial sync.
- Sage API returns standard schema structures without custom field overrides.
- Pagination uses standard cursor tokens rather than manual offset limits.
- Historical data ingestion is scoped to active accounts from the past 12 months.

## Your test list, before any code
- Simulate invalid Sage OAuth token → Receive 401 and trigger refresh handshake.
- Query 100 Sage customers → Validate Buki ledger mirrors customer counts exactly.
- Send invoice payload with missing tax field → Ingestion pipeline logs descriptive error without crashing.
- Simulate Sage 429 rate limit → Exponential backoff delays request and completes on retry.

All four are implemented in `tests/sync.test.ts` and pass — see README for how to run them.

## Your plan, by the end of day 3
- Stand up base connector and authenticate against Sage sandbox.
- Map core ledger entities (customers, invoices, payments) to Buki schemas.
- Run end-to-end sync on sample batch to verify data consistency.
- Formulate question for founder: Does Buki require bidirectional status sync back to Sage, or read-only ingestion?

## Founder question
Does Buki require bidirectional status sync back to Sage, or read-only ingestion?

## Your code
GitHub: https://github.com/anilkumara9/buki-sage-connector
Local staging: `Dockerfile` included, deploys to Render / Railway as a single web service.
