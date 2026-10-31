# Proof Notebook — Buki × Sage Connector

**Submission type: Your Plan — the first 4 boxes only**
**Due: Day 3 / Tuesday 3 Nov 2026 at 11:59 pm**
Code & Notes are NOT submitted now. They are the Build Phase (around 10 days) — daily notes are logged as I build, and the completed project is submitted then, when it is tested and working.

---

## 1. What does it do, and for whom?
It syncs customer balances and ledger entries from Sage directly into Buki for finance teams so they get real-time, clean data without manual exports.

## 2. What are you assuming that the brief doesn't say?
- Read-only permissions are sufficient for initial sync.
- Sage API returns standard schema structures without custom field overrides.
- Pagination uses standard cursor tokens rather than manual offset limits.
- Historical data ingestion is scoped to active accounts from the past 12 months.

## 3. Your test list, before any code
- Simulate invalid Sage OAuth token → Receive 401 and trigger refresh handshake.
- Query 100 Sage customers → Validate Buki ledger mirrors customer counts exactly.
- Send invoice payload with missing tax field → Ingestion pipeline logs descriptive error without crashing.
- Simulate Sage 429 rate limit → Exponential backoff delays request and completes on retry.

## 4. Your plan, by the end of day 3

**Day 1 — Sunday 1 Nov: Bootstrap and sandbox auth**
Stand up the base TypeScript/Node connector and authenticate against the Sage sandbox. Implement the OAuth2 PKCE flow with automated token refresh and secure credential storage, and verify the token handshake in the sandbox.

**Day 2 — Monday 2 Nov: Entity mappings and type validation**
Map the core ledger entities — customers, invoices, payments — to Buki schemas. Create Zod validation schemas for Sage customer, ledger, and sales invoice payloads, handling currency fields, precision, and null values gracefully.

**Day 3 — Tuesday 3 Nov: Sample sync, check, and submit this plan**
Run an end-to-end sync on a sample batch to verify data consistency between Sage and Buki. Formulate the founder question below. Submit this plan by 11:59 pm for founder review and early feedback, while course correction is still cheap.

Founder question: Does Buki require bidirectional status sync back to Sage, or read-only ingestion?

---

## Code & Notes — Build Phase (not this submission)
The entire challenge spans around 10 days. I will log daily notes as I build, and submit the completed project when it is tested and working.
Working repo (scaffold only at plan stage, not the final code submission): https://github.com/anilkumara9/buki-sage-connector
