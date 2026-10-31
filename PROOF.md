# Proof Notebook — Buki × Sage Connector

**This submission is the plan only — the first 4 boxes.**
**Due: Day 3 / Tuesday 3 Nov 2026 at 11:59 pm**

I am not submitting final code at this stage. Code and notes are the build phase, which runs about 10 days in total. I will log notes each day as I build, and the finished project goes in at the end of that phase, when it is tested and working.

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

**Day 1 — Sunday 1 Nov: Set the connector up and sort the Sage login**
I will stand up the base connector in TypeScript and Node, and get it authenticating against the Sage sandbox. That means the OAuth2 PKCE flow, tokens that refresh themselves, and somewhere safe to keep them. I want the token handshake verified in the sandbox before I build anything on top of it.

**Day 2 — Monday 2 Nov: Work out how Sage data becomes Buki data**
I will map the three things at the heart of this — customers, invoices and payments — from Sage's shapes into Buki's. I will write Zod schemas for the Sage payloads so anything unexpected gets caught at the door, and I will take care with the money fields, currency and the values Sage sometimes just leaves out.

**Day 3 — Tuesday 3 Nov: Prove it on a sample batch, then send this plan**
I will run a sync end to end on a sample batch and check that what lands in Buki actually matches what was in Sage. Then I will send this plan in by 11:59 pm, so the founder can look at the direction and tell me if I am off course while changing course is still cheap.

And the question I need answered: does Buki require bidirectional status sync back to Sage, or is read-only ingestion enough? I have planned this as read only, and it changes the size of the job quite a lot if that is wrong.

---

## Code & Notes — the build phase (not this submission)
The challenge runs about 10 days in total. I am logging notes daily as I build, in the repo and in the README there, and I will submit the completed project when it is tested and working.

Work so far lives here, as a starting point rather than a final submission: https://github.com/anilkumara9/buki-sage-connector
