# Buki × Sage Connector

I built this connector to sync customer balances and ledger entries from Sage Accounting into Buki, so finance teams stop moving that data around by hand with exports.

Right now this repo holds my plan for the work and the first working version of the connector itself. The plan (the first 4 boxes in [`PROOF.md`](./PROOF.md)) is the Day 3 submission, due Tuesday 3 Nov 2026 at 11:59 pm. The build carries on after that — the whole challenge runs about 10 days, I am logging notes as I go, and the finished project goes in at the end of that phase, once it is tested and working properly.

Repo: https://github.com/anilkumara9/buki-sage-connector

---

## Contents

1. [Why this exists](#1-why-this-exists)
2. [What it does](#2-what-it-does)
3. [What I am assuming](#3-what-i-am-assuming)
4. [How it is put together](#4-how-it-is-put-together)
5. [Tech I used](#5-tech-i-used)
6. [What I did in the first three days](#6-what-i-did-in-the-first-three-days)
   - [Day 1 — Getting the connector up and sorting Sage auth](#day-1--sunday-1-nov-2026-getting-the-connector-up-and-sorting-sage-auth)
   - [Day 2 — Mapping Sage data into Buki's shape](#day-2--monday-2-nov-2026-mapping-sage-data-into-bukis-shape)
   - [Day 3 — The sync engine, a sample run, tests, and the plan](#day-3--tuesday-3-nov-2026-the-sync-engine-a-sample-run-tests-and-the-plan)
7. [How the Sage login works](#7-how-the-sage-login-works)
8. [How Sage fields map to Buki fields](#8-how-sage-fields-map-to-buki-fields)
9. [How a sync actually runs](#9-how-a-sync-actually-runs)
10. [What happens when things go wrong](#10-what-happens-when-things-go-wrong)
11. [Tests I wrote first, and how they went](#11-tests-i-wrote-first-and-how-they-went)
12. [What's in the repo](#12-whats-in-the-repo)
13. [Running it yourself](#13-running-it-yourself)
14. [The HTTP endpoints](#14-the-http-endpoints)
15. [Settings](#15-settings)
16. [Putting it on a staging server](#16-putting-it-on-a-staging-server)
17. [Where it stands, honestly](#17-where-it-stands-honestly)
18. [The one question I need the founder to answer](#18-the-one-question-i-need-the-founder-to-answer)

---

## 1. Why this exists

If a team keeps its accounts in Sage and does its finance work in Buki, somebody has to carry the data across. In practice that means exporting customers and ledger entries from Sage, tidying the file up, and importing it into Buki by hand.

I have seen how that kind of job goes. The copy in Buki is only as fresh as the last export, a balance gets typed wrong, a tax figure goes missing, and when something does not add up there is no record of what failed or why. It is slow, and worse, nobody fully trusts the numbers at the end of it.

This connector is my attempt to take that job away completely.

## 2. What it does

It connects to the Sage Accounting API, reads customers, sales invoices and payments, checks every record, converts it into the shape Buki expects, and stores it there. The first run brings over the recent history. Every run after that only pulls what has changed since the last one.

For the finance team, that means three things:

- The balances they see in Buki are the balances that are actually in Sage.
- Invoices and payments turn up as tidy ledger entries, with the money handled in a way that does not slowly drift because of rounding.
- If one record is broken — say an invoice turns up with no tax amount on it — that record gets logged with the reason and skipped. It does not crash the whole sync, and it does not quietly slip into the ledger either.

One thing it deliberately does not do: write anything back to Sage. It is read only for now. Whether it should stay that way is the question at the end of this README.

## 3. What I am assuming

The brief did not spell everything out, so I wrote my assumptions down in the Proof Notebook before I wrote any code. Here they are, with why each one matters:

| # | Assumption | Why it matters |
|---|------------|----------------|
| 1 | Read only access is enough for the first version. | Proving the import works does not need write access to anyone's accounts, so I am not asking for it. |
| 2 | Sage sends back its standard shapes, with no custom fields bolted on. | My validation is written against Sage's documented payloads. If a real tenant has custom fields, those need adding to the schemas later. |
| 3 | Pagination works on Sage's cursor tokens, not on page numbers I work out myself. | So the sync just follows Sage's `$next` link from page to page instead of guessing offsets. |
| 4 | The first import only needs active accounts from the last 12 months. | That keeps the first sync small and relevant instead of dragging in years of history and dead accounts. |

## 4. How it is put together

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

A few choices in there are worth explaining:

- **Money is stored in minor units.** £120.00 becomes `12000`. It looks like a small thing, but floats and money do not mix, and a ledger is the last place I want rounding drift.
- **One bad record should not kill a sync.** Every record gets checked on its own. If it fails, it is logged with enough detail to find it later, counted as skipped, and the rest of the batch carries on.
- **Repeat syncs are incremental.** The engine remembers the newest `updated_at` it has seen (I call it the high-water mark) and next time only asks Sage for records changed since then.
- **The Buki store is a small, replaceable piece.** Right now it is in memory, which is perfect for tests and staging. Swapping it for Buki's real storage later should not mean touching the sync engine at all.

## 5. Tech I used

| Part | What I picked | Why |
|------|---------------|-----|
| Language | TypeScript on Node.js 20+ | I wanted the Sage payloads and the Buki records typed end to end. Node's built in `fetch` does everything I need, so I did not add an HTTP library just for this. |
| Validation | Zod | Both sides, Sage in and Buki out, are described as schemas. When a payload is wrong, it fails at the door with an error I can actually read. |
| Server | Express | It is only doing four or five jobs — the Sage callback, a health check, running a sync, showing what synced — so I kept it small and familiar. |
| Tests | Vitest, with Sage faked | The four proof tests run with no network and no real Sage account. |
| Packaging | Docker | The same image runs on my machine and on a staging host like Render or Railway. |

The Sage side is the Accounting API v3.1, base URL `https://api.accounting.sage.com/v3.1`. The endpoints I read are `contacts`, `sales_invoices` and `contact_payments`.

---

## 6. What I did in the first three days

This is the part the founder is reviewing, so I have written it the way it actually happened: what I set out to do each day, what I built, and where I landed by the end of it.

### Day 1 — Sunday 1 Nov 2026: Getting the connector up and sorting Sage auth

My goal for day one was simple to say and fiddly to do: get a base connector standing, and get it talking to Sage's sandbox login.

**Setting the project up**

I started with a plain TypeScript and Node project, strict mode on, and split the code into the folders the rest of the work would live in: `src/auth/` for login, `src/sage/` for everything Sage sends and expects, `src/buki/` for Buki's side of the mapping, `src/sync/` for the engine, and `tests/` alongside.

Configuration lives in `src/config.ts`. Every setting comes from an environment variable and gets validated when the app starts, so a typo in a config value fails loudly at boot instead of turning into a strange error halfway through a sync. The `.env.example` file lists all of them with empty values. Real secrets never go in the repo, and `.gitignore` keeps `.env` files, token data, `node_modules` and build output out of git.

**The Sage login (OAuth2 with PKCE)**

Sage does not let you just log in with a password and keep a key. It uses OAuth2, and I used the PKCE variant, which is the safer version of that flow. The pieces for it are in `src/auth/`:

- `pkce.ts` makes the random code verifier, hashes it into the S256 code challenge, and makes the random `state` value that ties a login attempt together.
- `oauth.ts` does the actual work. It builds the Sage sign in URL (`https://www.sageone.com/oauth2/auth/central?filter=apiv3.1`) with the client ID, redirect URI, scope, state and challenge on it. When Sage sends the user back with a one time code, it swaps that code, plus the original verifier, for an access token and a refresh token. It can also swap a refresh token for fresh tokens when the access token runs out, and it has a `forceRefresh()` path for the awkward case where Sage rejects a token that still looked fine on my side.
- The server routes are `GET /auth/sage` to start the login and `GET /auth/sage/callback` to finish it.

**Where the tokens live**

Tokens are stored through a small interface in `src/auth/tokenStore.ts`, and I kept two versions of it. The file version writes to `.data/tokens.json` with owner only permissions (`0600`), in a folder git ignores. The memory version exists purely for tests, so no test ever goes near a real credential. The file version is fine for running this locally and on staging. If this goes to production it needs a proper encrypted secret store instead, and I have said so in the code rather than pretending a JSON file is good enough.

**One honest note on the sandbox**

The login flow in this repo follows Sage's documented flow exactly — same URLs, same parameters, same headers — and I test it end to end against a fake Sage server, including the part where a token gets rejected and has to be refreshed. What I have not done yet is a handshake against a real Sage sandbox tenant, because that needs sandbox app credentials (client ID, secret, subscription key) and I do not have a set to use. I would rather say that plainly here than claim a live check that has not happened. It is first on the list once credentials are available.

By the end of day one I had a connector that boots, checks its own settings, starts and finishes the Sage login flow, looks after its own tokens, and answers a health check.

### Day 2 — Monday 2 Nov 2026: Mapping Sage data into Buki's shape

Day two was about the data itself: what Sage sends, what Buki wants, and how to get safely from one to the other.

**Describing what Sage sends**

In `src/sage/schemas.ts` I wrote Zod schemas for the three things I read from Sage, plus the envelope its list endpoints wrap them in (`$items`, `$total`, `$page`, `$next`):

- A **contact**: ID, display name, whether it is a customer or supplier, status, email, address bits, credit limit and credit days, balance, currency, and the created and updated timestamps.
- A **sales invoice**: ID, which contact it belongs to, dates, reference, status, currency, net, tax and total amounts, what has been paid, what is still outstanding, and the lines on the invoice.
- A **payment**: ID, contact, date, reference, total amount, currency and payment method.

Two small things in there came from looking closely at real payload shapes. Money does not always come back as a number — on some endpoints it arrives as a string — so the schemas accept both and turn it into a number. And a contact with no balance should mean zero, not an error, so that defaults to `0`.

**Describing what Buki wants**

`src/buki/schemas.ts` has the two record types the sync produces. A **Buki account** is a customer with its balance and credit limit converted into minor units. A **Buki ledger entry** is an invoice or a payment, again with every amount in minor units. There is one helper, `toMinor()`, that does that conversion everywhere, and it rounds rather than chops, because chopping a half penny the wrong way across thousands of invoices is exactly the kind of quiet error this project exists to prevent.

**Joining the two together**

The conversions live in `src/buki/mappers.ts`, one function per entity: contacts to accounts, invoices to ledger entries, payments to ledger entries. Most of it is straightforward field copying with the money converted on the way past. Status gets a translation too — Sage's `INACTIVE` becomes Buki's `inactive`.

The one real decision of the day was what to do with an **invoice that has no tax amount**. In Buki, net plus tax should equal the total. If the tax figure is missing, I cannot check that, and guessing a number for a tax field felt genuinely wrong — that is the sort of quiet fix up that makes finance teams stop trusting a system. So I did the opposite: the mapper throws a specific error with the invoice ID, the contact, the net and the total attached. The sync engine catches it, writes it to the error log, skips that one invoice, and carries on with everything else. It is visible, it is findable, and it does not take the rest of the batch down with it. That behaviour became one of my four tests.

By the end of day two, every record the connector touches had a shape on both sides and a checked path between them — including a path for the record that is supposed to fail.

### Day 3 — Tuesday 3 Nov 2026: The sync engine, a sample run, tests, and the plan

Day three was pulling it together: actually moving data, proving it with the sample batch, and getting the plan submitted.

**Talking to Sage without falling over**

`src/sage/client.ts` is the one place that makes requests to Sage. It adds the headers Sage expects — the Bearer token, JSON content type, and the developer subscription key when one is configured — and it deals with the two failures I knew were coming:

- If Sage says `401`, the client forces a token refresh and tries the request once more with the new token. No human has to reconnect anything.
- If Sage says `429` (too many requests), or a `5xx`, or the network drops, it waits and retries, doubling the wait each time with a bit of randomness mixed in. If Sage sends a `Retry-After` header, that wins and the client waits as long as Sage asked.
- If it runs out of retries, it stops and raises a proper error with the status and the URL. I would rather a sync fail loudly than return half the data and pretend it finished.

**The sync itself**

The engine is in `src/sync/`. Sage's list endpoints are paged, so the client walks them with an async generator that follows the `$next` cursor, 100 records at a page, which keeps memory flat however big the account gets.

A sync runs contacts first, then invoices, then payments, on purpose: by the time a ledger entry lands, the account it belongs to is already there. The first sync honours the assumptions from my plan — active accounts only, last 12 months. After that, the high-water mark kicks in and only changed records come across. Every record is validated and mapped individually, the failures go to the error log with their counts reported at the end, and everything is stored by its Sage ID, so running a sync twice updates records instead of duplicating them.

Payments got one special bit of handling. The payments endpoint is the one that varies most between Sage setups, so if it answers `404` in a given tenant, the sync logs that payments are not available there and moves on. Contacts and invoices should not fail just because one tenant does payments differently.

**Proving it on a sample batch**

The server (`src/index.ts`) exposes the flow so I could actually watch it work: `POST /sync` runs a sync and reports what it did, and `GET /ledger` shows everything that landed in Buki — accounts, entries, and the error log — so I could eyeball it directly instead of trusting a success message.

In the tests I ran the whole flow against the fake Sage with a batch of 100 customers, and the number that landed in Buki was exactly 100, with balances converted properly. There is more on the tests just below.

**Tests**

The test list came first — I wrote it in the Proof Notebook before the code, and it is in Section 11 below. The tests live in `tests/sync.test.ts` and run against a fake Sage in `tests/mockSage.ts` that can pretend to have an expired token, can flood back rate limit responses, and can hand over a broken invoice. All four pass, and the type check and the build are clean. I rechecked them again while writing this README, and I also booted the built server and hit `/health` and `/ledger` to make sure the thing that ships is the thing that runs.

**Packaging it up and submitting the plan**

Last, I added a `Dockerfile` so the connector runs the same way anywhere, wrote this README and the Proof Notebook, and got the plan — just the first 4 boxes — ready for the Day 3 deadline of Tuesday 3 Nov at 11:59 pm. The point of sending a plan this early is that the founder can tell me I am heading the wrong way now, while changing direction is still cheap. Which brings me to the question in Section 18.

---

## 7. How the Sage login works

For anyone reviewing the auth code, the flow step by step:

1. You visit `GET /auth/sage` on this service.
2. The service makes a random code verifier, hashes it into a code challenge, picks a random `state`, and remembers which verifier goes with which state.
3. It redirects you to Sage with that challenge on the URL. You sign in to Sage and approve the connection for your business.
4. Sage redirects you back to `GET /auth/sage/callback` with a one time code and the state.
5. The service swaps the code, the verifier, the client ID and secret, and the redirect URI for tokens at Sage's token endpoint.
6. Sage hands back an access token, a refresh token and an expiry, and the service stores them.
7. From then on, calls go out with the access token attached. If it has expired, it is refreshed before the call. If Sage still says no with a `401`, one forced refresh and one retry happens automatically.

A small mismatch worth flagging: the config currently asks Sage for the `full_access` scope, even though this connector only ever reads. Tightening that to a read only scope is the sensible move for the first real version, and it ties into the founder's answer on Section 18.

## 8. How Sage fields map to Buki fields

### Contact → Buki account

| Sage (`contacts`) | Buki account | Notes |
|-------------------|--------------|-------|
| `id` | `externalId` | Also the key Buki records are stored under, so re-syncing updates instead of duplicating. |
| — | `source` | Always `sage`. |
| `displayed_as` | `name` | |
| `email` | `email` | Can be empty on both sides. |
| `status_id` | `status` | `INACTIVE` becomes `inactive`, everything else is `active`. |
| `currency_id` | `currency` | Falls back to `GBP` if Sage leaves it out. |
| `balance` | `balanceMinor` | Converted with `toMinor()`. No balance from Sage means `0`. |
| `credit_limit` | `creditLimitMinor` | Converted the same way, and stays `null` if Sage has no limit set. |
| `updated_at` | `updatedAt` | This is also what the high-water mark is built from. |

### Sales invoice → Buki ledger entry

| Sage (`sales_invoices`) | Buki ledger entry | Notes |
|-------------------------|-------------------|-------|
| `id` | `externalId` | The kind on the entry is set to `invoice`. |
| `contact_id` | `accountExternalId` | Which Buki account this entry belongs to. |
| `date` / `due_date` | `date` / `dueDate` | Due date can be empty. |
| `reference` | `reference` | Can be empty. |
| `status_id` | `status` | Stored in lower case, so `paid`, `draft` and so on. |
| `currency_id` | `currency` | |
| `net_amount` | `netMinor` | Converted with `toMinor()`. |
| `tax_amount` | `taxMinor` | This one is required. Missing tax means the record is logged and skipped — see Section 10. |
| `total_amount` | `totalMinor` | Converted with `toMinor()`. |
| `amount_outstanding` | `outstandingMinor` | Converted with `toMinor()`. |
| `updated_at` | `updatedAt` | Feeds the high-water mark. |

### Payment → Buki ledger entry

| Sage (`contact_payments`) | Buki ledger entry | Notes |
|---------------------------|-------------------|-------|
| `id` | `externalId` | The kind on the entry is set to `payment`. |
| `contact_id` | `accountExternalId` | |
| `date` | `date` | Payments do not have a due date. |
| `reference` | `reference` | Can be empty. |
| — | `status` | Set to `paid`. |
| `currency_id` | `currency` | |
| `total_amount` | `netMinor` and `totalMinor` | A payment has no tax split in this mapping, so `taxMinor` is `0` and nothing is outstanding. |
| `updated_at` | `updatedAt` | Feeds the high-water mark. |

## 9. How a sync actually runs

1. Something calls `POST /sync`. Right now that is me or a reviewer doing it by hand; in a real deployment a scheduler would call it.
2. The engine works out where to start: from its high-water mark if it has one, otherwise 12 months back.
3. It pages through Sage's contacts, checking, converting and storing each one, and moving the high-water mark forward as it goes.
4. Then it does exactly the same for sales invoices, and then for payments.
5. Anything that fails its checks on the way gets logged and counted as skipped. It does not stop the run.
6. The call comes back with the numbers: how many contacts, invoices and payments synced, how many were skipped, and where the high-water mark has got to.

## 10. What happens when things go wrong

| What happens | What the connector does |
|--------------|-------------------------|
| The access token has expired before a call | Refreshes it from the stored refresh token first, then makes the call. |
| Sage still answers `401` | One forced refresh, then the call is retried once with the new token. |
| Sage answers `429` | Backs off and retries, doubling the wait each time. If Sage sent a `Retry-After` header, it waits that long instead. |
| Sage answers `5xx`, or the network drops | Same backoff and retry as a `429`, up to a set number of attempts. |
| It runs out of retries | Stops and raises an error with the status and URL. The sync fails where everyone can see it. |
| A record does not match its schema | Logged with the reason, counted as skipped, sync carries on. |
| An invoice turns up with no `tax_amount` | Logged with a clear message saying the tax amount is missing, along with the invoice ID, contact, net and total. That invoice is skipped, everything else carries on. |
| The payments endpoint answers `404` in a tenant | Logged as payments not being available in that tenant, and skipped. Contacts and invoices are not affected. |

## 11. Tests I wrote first, and how they went

I wrote this test list in the Proof Notebook before there was any code, because these four cases were the whole point of the connector as far as I was concerned. Each one is now a real test in `tests/sync.test.ts`, running against the fake Sage in `tests/mockSage.ts`.

| # | The test, as I originally wrote it down | How it went |
|---|------------------------------------------|-------------|
| 1 | Pretend the Sage token is invalid — the call should get a `401` and kick off the refresh, then work. | Passes. The first call gets the `401`, exactly one refresh happens, and the retry comes back fine. |
| 2 | Pull 100 Sage customers and check Buki ends up with exactly the same count. | Passes. 100 in, 100 stored, and I spot checked one in the middle — customer 42's balance of £142.00 is sitting there as `14200`. |
| 3 | Send an invoice with its tax field missing — the pipeline should log a proper error and not fall over. | Passes. The sync finishes, the invoice is skipped, the error in the log actually explains itself, and the customer in the same batch still syncs. |
| 4 | Pretend Sage is rate limiting — the request should back off and still complete on a retry. | Passes. Two `429`s in a row produce two waits on the growing backoff schedule, and the third try gets through. |

```bash
npm test
```

Last run: 4 passed, 0 failed. `npm run typecheck` and `npm run build` are clean too.

## 12. What's in the repo

```
buki-sage-connector/
├── PROOF.md                  The Day 3 plan submission (the first 4 boxes)
├── README.md                 This file
├── Dockerfile                Builds the connector as one container
├── .env.example              Every setting, with the values left blank
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              The server: /health, /auth/sage, /sync, /ledger
│   ├── config.ts             Loads and checks the settings (Zod)
│   ├── auth/
│   │   ├── pkce.ts           Code verifier, S256 challenge, state
│   │   ├── oauth.ts          Building the login URL, swapping codes, refreshing tokens
│   │   └── tokenStore.ts     The file store (0600) and the in memory one tests use
│   ├── sage/
│   │   ├── schemas.ts        What Sage contacts, invoices, payments and lists look like
│   │   └── client.ts         Talking to Sage: headers, 401 refresh, 429 backoff, paging
│   ├── buki/
│   │   ├── schemas.ts        What a Buki account and a ledger entry look like
│   │   └── mappers.ts        Turning Sage records into Buki ones, tax check included
│   └── sync/
│       ├── engine.ts         A full sync: contacts, then invoices, then payments
│       └── store.ts          The Buki store and its error log
└── tests/
    ├── mockSage.ts           A fake Sage, so tests need no network and no account
    └── sync.test.ts          The four proof tests
```

## 13. Running it yourself

You will need Node.js 20 or later, and a Sage developer app — a sandbox one is fine — with a client ID, client secret and subscription key.

```bash
cp .env.example .env    # put your Sage sandbox values in here
npm install
npm test                # the four proof tests
npm run dev             # http://localhost:3000
```

Then:

1. Go to `http://localhost:3000/auth/sage` and you will be sent over to Sage to connect an account.
2. Once Sage sends you back, run `POST http://localhost:3000/sync`.
3. Have a look at `http://localhost:3000/ledger` — that is everything that arrived in Buki, plus anything that failed and why.
4. Run the sync again and notice it only goes looking for things that changed since last time.

For the production build instead of the dev server: `npm run build`, then `npm start`.

## 14. The HTTP endpoints

| Call | What it does |
|------|--------------|
| `GET /health` | Answers `{ ok: true, service, highWaterMark }`. The quickest way to check it is up, and how far syncing has got. |
| `GET /auth/sage` | Starts the Sage login by redirecting you to Sage. |
| `GET /auth/sage/callback` | Where Sage sends you back to. Swaps the code for tokens and stores them. |
| `POST /sync` | Runs a sync — a full one the first time, an incremental one after that — and returns the counts. |
| `GET /ledger` | Shows all the synced accounts, ledger entries and ingestion errors. This is for staging and for looking at what happened; it is not meant to be Buki's production API. |

## 15. Settings

Everything is set through environment variables, listed in `.env.example`. Nothing secret belongs in code, ever.

| Variable | What it is |
|----------|------------|
| `SAGE_CLIENT_ID` | The client ID of your Sage developer app. |
| `SAGE_CLIENT_SECRET` | Its client secret. |
| `SAGE_SUBSCRIPTION_KEY` | Sage's developer subscription key. It goes out on requests as the `ocp-apim-subscription-key` header. |
| `SAGE_REDIRECT_URI` | Where Sage sends people back to. It has to match what is registered in the Sage app, character for character. Defaults to `http://localhost:3000/auth/sage/callback`. |
| `SAGE_AUTH_URL` | Sage's login URL. Defaults to `https://www.sageone.com/oauth2/auth/central?filter=apiv3.1`. |
| `SAGE_TOKEN_URL` | Sage's token endpoint. Defaults to `https://oauth.accounting.sage.com/token`. |
| `SAGE_API_BASE` | The API base. Defaults to `https://api.accounting.sage.com/v3.1`. |
| `SAGE_SCOPE` | The scope asked for at login. Defaults to `full_access` — see the note in Section 7. |
| `PORT` | The port this service listens on. Defaults to `3000`. |
| `SYNC_MONTHS_BACK` | How far back the first sync reaches, in months. Defaults to `12`. |
| `TOKEN_STORE_PATH` | Where tokens get written by the file store. Defaults to `.data/tokens.json`. |

## 16. Putting it on a staging server

```bash
docker build -t buki-sage-connector .
docker run -p 3000:3000 --env-file .env buki-sage-connector
```

The same Dockerfile works on Render or Railway as a single web service — just set the settings from Section 15 in their dashboard instead of using a `.env` file. One thing I should be straight about: I checked the Dockerfile's paths against the real build output in this repo, but I have not run an actual `docker build` in the environment I built this in, because Docker is not available there.

## 17. Where it stands, honestly

What is actually done after three days:

- The project is set up, the settings are checked at startup, and no credentials live in the code.
- The Sage login flow works the way Sage documents it, refreshes itself, and recovers from a rejected token.
- Every Sage record I read has a checked shape, and so does every Buki record it turns into.
- The money handling is consistent — everything is minor units, rounded properly, converted in exactly one place.
- A sync pages through Sage properly, runs in the right order, only pulls changes after the first run, and keeps a readable log of anything it had to skip.
- The four tests I set myself at the start all pass, and the server that builds is the server that runs — I booted it and checked.
- There is a container for staging, a plan the founder can read in PROOF.md, and this README.

And what is not done, because I would rather list it than let anyone assume it:

- **It has not spoken to a real Sage account yet.** Everything above is verified against a fake Sage that behaves the way the docs say Sage behaves. The live handshake needs sandbox credentials I do not have yet.
- **Buki's side is an in memory store.** That is deliberate at this stage — it proves the mapping and the sync honestly — but wiring it into Buki's real ledger is build phase work.
- **Tokens sit in a local file.** Fine for my machine and staging, not fine for production. Production gets an encrypted secret store.
- **Payments are the shakiest part.** That endpoint varies between Sage setups, which is why the sync tolerates it being missing instead of failing.
- **Custom fields are not covered.** That follows from my standard shapes assumption. A tenant with custom fields means extending the schemas.

What comes next in the build phase, where I will keep logging daily notes:

- Get sandbox credentials, connect a real Sage tenant, and watch a live sync happen.
- Point the Buki store at the real destination.
- Move the tokens somewhere encrypted.
- Let a scheduler run the sync instead of me calling `POST /sync` by hand.
- Act on the founder's answer to the question below.

## 18. The one question I need the founder to answer

> Does Buki need status to sync back into Sage as well, or is read only ingestion enough?

I have built this read only on purpose, and I need to know if that is right before I go further. If Buki just needs clean, current numbers out of Sage, then the shape of this thing is basically set and the rest is hardening. If what happens in Buki — an invoice marked paid, say — has to find its way back into Sage, that is a different and bigger job: write access, working out which system wins when both sides change the same record, and a second set of tests. It is a much better conversation to have now, at plan stage, than three weeks in.
