<p align="center">
  <img src="assets/diagrams/system.png" alt="Architecture of the GoHighLevel integration" width="100%">
</p>

# Architecture

How the integration decides when to text, hands the customer to GoHighLevel, learns what happened, and stays correct when any part of that fails. Code excerpts are linked inline; each is trimmed from the shipped backend.

- [System at a glance](#system-at-a-glance)
- [1. Talking to GoHighLevel](#1-talking-to-gohighlevel)
- [2. Postgres as the job queue](#2-postgres-as-the-job-queue)
- [3. The automated trigger](#3-the-automated-trigger)
- [4. Campaign rules the backend owns](#4-campaign-rules-the-backend-owns)
- [5. Closing the loop with webhooks](#5-closing-the-loop-with-webhooks)
- [6. Prospects into a sales pipeline](#6-prospects-into-a-sales-pipeline)
- [7. Field mapping](#7-field-mapping)
- [8. Failure modes](#8-failure-modes)
- [Decision log](#decision-log)

---

## System at a glance

| Part | Owns | Talks to |
| --- | --- | --- |
| Browser extension and dashboard | Capturing a new customer, the one-click approval, settings | API |
| API (Express, Zod) | Validation, campaign state, the webhook endpoint | Postgres, GHL |
| Postgres | Review requests (the queue), campaigns, idempotency ledger, webhook log, transfer ledger | |
| Worker | The trigger: claim, gates, contact upsert, tag | Postgres, GHL |
| GoHighLevel, per client | The contact, the texting workflow (Text 1, wait, Text 2) | Customer, our webhook |
| GoHighLevel, the agency's own | Sales pipelines, prospect contacts and opportunities | API |

The rule of thumb: **the backend owns every rule, GHL owns the texting.** Frequency caps, the send window and duplicate protection live in our code and database, so they hold however a client's workflow is edited in GHL.

---

## 1. Talking to GoHighLevel

Every call goes through one wrapper ([`ghlRequest.ts`](src/crm/ghlRequest.ts)):

- API v2 at `services.leadconnectorhq.com`, `Version: 2021-07-28`, bearer token.
- A **15-second timeout** on every call (`AbortSignal.timeout`), so a hung request can't hold a job's claim.
- Errors are **classified, not just thrown.** 400, 401, 403, 404, 409 and 422 are permanent: the request is wrong and repeating it only burns rate limit. 429, 5xx, timeouts and network errors are retryable.

```ts
const classification = GHL_RETRY_POLICY[res.status] ?? 'retryable';
const body = await res.text().catch(() => '');
const message = `GHL ${init.method ?? 'GET'} ${path} -> ${res.status}: ${body}`;
if (classification === 'retryable') throw new RetryableProviderError(res.status, message);
throw new PermanentProviderError(res.status, message);
```

**Auth.** Each client sub-account uses a Private Integration Token, stored per client and only ever shown back as its last 4 characters. Saving one tests it live with a real API call and rolls back if the test fails. The agency's own sales sub-account has its own token in a one-row settings table.

**Provisioning.** A connected sub-account needs a review trigger link, 2 custom fields, 5 custom values (the two SMS bodies, the reminder delay, the review link, the client status) plus the webhook URL and secret, and 12 tags. [`ensureAll`](src/crm/provisioning.ts) lists what exists, matches by name, and creates only what's missing. If the listing itself fails, it reports every item of that kind as failed rather than guessing and creating duplicates.

The provider interface has 15 methods, and an in-memory fake implements the same interface for tests.

---

## 2. Postgres as the job queue

A review request **is** the job. There is no broker:

| Column | Role |
| --- | --- |
| `status` | `pending` → `releasing` → `sent` / `failed` / `cancelled` |
| `next_attempt_at` | when it may run next (grace end, 9 AM, or backoff) |
| `claimed_at`, `claimed_by` | the lease |
| `attempts`, `last_error` | retry state, visible in the dashboard |

The worker claims up to 20 due rows in one transaction with `FOR UPDATE SKIP LOCKED`, so two workers never wait on or take the same row ([`jobStore.ts`](src/triggers/jobStore.ts)). A partial index on `(status, confirmation_status, next_attempt_at) WHERE is_deleted = false` keeps that query cheap.

Every outcome write repeats the claim in its `WHERE`:

```ts
.where(and(
  eq(reviewRequests.id, jobId),
  eq(reviewRequests.status, 'releasing'),
  eq(reviewRequests.claimedAt, claimedAt),
));
```

A worker that stalls past the **10-minute lease** is reaped: its job goes back to `pending` with backoff, or to `failed` on the last attempt. If the stalled worker wakes up later, its write matches nothing.

The worker loop ([`worker.ts`](src/triggers/worker.ts)) routes each failure by kind:

| Outcome | What happens |
| --- | --- |
| Sent | `sent`, with the GHL contact id |
| Deferred (grace, send window) | back to `pending` at the given time, no attempt used |
| Client not connected to GHL | soft skip for 30 s, no attempt used |
| Permanent GHL error | `failed`, and the campaign is closed so the phone isn't locked |
| Retryable GHL error | backoff 30 s → 1 m → 2 m → 4 m, ±20 % jitter; `failed` on the 5th attempt |

---

## 3. The automated trigger

[`dispatch.ts`](src/triggers/dispatch.ts) is the part that decides a text goes out. The order is deliberate:

<p align="center"><img src="assets/diagrams/triggers.png" alt="Eight gates before one tag" width="100%"></p>

1. **Grace period.** 2 hours after approval. Staff can still cancel.
2. **Send window.** 9 AM – 7 PM local. Outside it, the campaign moves to `waiting_for_send_window` and the job is parked until the next 9 AM ([`sendWindow.ts`](src/triggers/sendWindow.ts), DST-safe).
3. **Contact upsert.** The customer is upserted into the client's sub-account with an E.164 phone and the **Campaign ID** custom field, which GHL echoes back on every webhook ([`release.ts`](src/triggers/release.ts)).
4. **Live SMS DND.** Read from GHL right now. This **fails closed**: a GHL error throws and the job retries; it never assumes "not DND".
5. **Already reviewed.** A contact tagged `review_submitted` is not asked again.
6. **Frequency.** At most one Text 1 per 180 days, and two per 365 days, per client and phone.
7. **Row lock.** All of the above is re-checked inside one transaction that holds `SELECT … FOR UPDATE` on the campaign, because staff may cancel it while we were talking to GHL. The send window is re-checked with the clock advanced by the time the GHL calls took.
8. **The tag.** After commit, `review_candidate` is added. GHL's "tag added" trigger starts the client's workflow.

```ts
// GHL only fires "tag added" for a tag that wasn't there, so a leftover candidate tag from an
// earlier run must come off first or Workflow 1 would not start again for this phone.
if (hasTag(tags, REVIEW_CANDIDATE_TAG)) await provider.removeTags(job.clientId, ghlContactId, [REVIEW_CANDIDATE_TAG]);
await provider.addTags(job.clientId, ghlContactId, [REVIEW_CANDIDATE_TAG]);
```

Why a tag and not an API call that sends the text? The texting, the copy and the timing between texts belong to each client's GHL account, where their team can see and adjust them. Our backend decides **whether** and **when**; GHL decides **how**.

If a gate blocks, the campaign is ended **and** the job cancelled in the same transaction, so a crash can't leave one without the other.

---

## 4. Campaign rules the backend owns

<p align="center"><img src="assets/diagrams/states.png" alt="Campaign lifecycle: 4 open and 7 terminal states" width="100%"></p>

A campaign is one row per client and phone ([`campaigns.ts`](src/campaigns/campaigns.ts), [`schema.excerpt.sql`](src/db/schema.excerpt.sql)). It has 4 open states and 7 terminal ones, and every transition is appended to `review_campaign_events`.

**One open campaign per phone** is a database guarantee, not an app check:

```sql
CREATE UNIQUE INDEX review_campaigns_open_phone_unique
  ON review_campaigns (client_id, normalized_phone)
  WHERE status IN ('pending_grace', 'waiting_for_send_window', 'active', 'awaiting_reminder');
```

Opening a campaign is an `INSERT … ON CONFLICT DO NOTHING` against that index. If nothing was inserted, the existing open campaign is read: if it belongs to the same request, the approval was a retry and is treated as success; otherwise it's a duplicate (for example, a family sharing a phone) and the second request is cancelled with `DUPLICATE_CAMPAIGN`.

**Frequency caps** count only `text_1_sent_at`, so a Text 1 that GHL reports as failed never counts against the customer.

---

## 5. Closing the loop with webhooks

The client's GHL workflow calls `POST /integrations/ghl/campaign-events` at each step. Five events: `text_1_attempted`, `text_2_attempted`, `reply_received`, `review_link_clicked`, `sms_failed`.

**Authenticate first** ([`receive.ts`](src/webhooks/receive.ts)). The secret header is compared in constant time, after hashing both sides so the buffers are equal length. An unknown location, a bad secret and an unparseable body all return the same 401 to an unauthenticated caller. The endpoint is rate limited to 300 requests per 15 minutes.

**Normalise** ([`normalise.ts`](src/webhooks/normalise.ts)). A GHL webhook action posts the contact's own data at the top level and the workflow author's custom keys under `customData`, spelled however they were typed. The schema flattens both, accepts the likely spellings, and lets GHL's own `contact_id` win over a hand-typed one, which is easy to map to the wrong merge tag.

**Apply exactly once** ([`applyEvent.ts`](src/webhooks/applyEvent.ts)). In one transaction:

1. Find the campaign by the echoed Campaign ID, scoped to the client.
2. Check the contact id and the last 10 digits of the phone agree with it. A mismatch is a 409, never a silent re-mapping.
3. Insert an idempotency key for `(campaign, event, GHL event id)`. If it already exists, return "ignored" and change nothing.
4. Lock the campaign row and apply the transition, but only from the state the event expects. A late `text_1_attempted` on a campaign that already ended is ignored.

Replies containing STOP-style words, or flagged `dnd`, end the campaign as `ended_dnd`. Every call, whatever the outcome, is written to `ghl_webhook_log` with its status code. The secret is never stored or logged.

---

## 6. Prospects into a sales pipeline

<p align="center"><img src="assets/diagrams/transfer.png" alt="Send to GHL flow" width="100%"></p>

The second integration ([`transfer.ts`](src/pipeline/transfer.ts)) sends businesses chosen in the Business Search tool into the agency's own GHL account.

**Pipeline and stage per send.** They're fetched live from GHL for the picker, and checked again on send, so a deleted or renamed stage fails before anything is created.

**A ledger row per place per pipeline.** Claiming it is one upsert that only takes over a row that `failed`, `needs_review`, or has been `sending` for more than 10 minutes (a request that died). Anything else is skipped as "already in this pipeline" or "being sent right now".

**Resumable steps.** After the contact step and after the opportunity step, the ids are written to the ledger. A retry reads them and continues from the step that failed.

**Matching, conservatively:**

- Already sent to another pipeline: reuse that contact, so every pipeline shares one.
- Search by E.164 phone. No match: create the contact with 6 custom fields (place id, listing link, rating, review count, category, search context) and one tag per prospect reason.
- Exactly one match on the same phone with the same business name: add tags only. Its fields, notes and stage are left alone.
- Anything else: `needs_review`, with the candidate contacts shown so a person links one or creates a new one.

**Opportunities never move backwards.** If the contact already has an open opportunity in this pipeline, it's kept in whatever stage it has reached.

**Lanes.** A send runs 4 lanes in parallel. Businesses sharing a phone (or, with none, a name) are put in the same lane and run one after another, so the second finds the contact the first created. With about 4 GHL calls per business and a cap of 50 per send, a send stays inside an HTTP timeout and GHL's limit of 100 calls per 10 seconds.

---

## 7. Field mapping

Captured customer fields are matched to GHL custom fields **by name**, and a missing field is created on first use. Custom fields are an enhancement, so a lookup failure doesn't block the contact upsert, with one exception: the **Campaign ID** field. Without it a webhook can't be mapped back to its campaign, so a missing Campaign ID fails the job loudly instead of texting a customer we could never track.

The contact id GHL returns is stored in the idempotency ledger under `ghl_release`, so a retry after a crash reuses it instead of relying on GHL's own duplicate detection.

---

## 8. Failure modes

| Failure | Effect | Recovery |
| --- | --- | --- |
| GHL timeout or 5xx | Job not sent | Retry with backoff, up to 5 attempts |
| GHL 4xx | Request can't succeed | Job failed, campaign closed, error shown on the request |
| GHL 429 | Rate limited | Retry with backoff and jitter |
| Worker dies mid-job | Row stuck in `releasing` | Reaped after 10 minutes; stale writes match nothing |
| Crash after commit, before the tag | Campaign `active`, no workflow started | Dispatchable again: `active` without a Text 1 attempt is resumed |
| Webhook redelivered | Same event twice | Idempotency key: second delivery ignored and logged |
| Webhook out of order | Event for a state already left | Applies only from the expected state; ignored otherwise |
| Client token revoked | 401 from GHL | Permanent failure, shown on the request; re-saving the token tests it live |
| Location already in use | Two clients point at one sub-account | Refused at save time, naming the other client; an archived client's location can be reassigned |
| Transfer request dies | Ledger row left `sending` | Re-claimable after 10 minutes; resumes from the saved ids |

---

## Decision log

| Decision | Alternatives considered | Why we chose it |
| --- | --- | --- |
| Private Integration Tokens per sub-account | GHL OAuth with agency-level refresh tokens | An early OAuth design (agency token and sync-queue tables) was dropped before launch. Static per-location tokens removed a refresh path and a whole class of expiry failures for the scale needed. |
| Postgres as the queue | Redis queue, SQS | One store: a job and its state commit in the same transaction. `SKIP LOCKED` and partial indexes cover the throughput. |
| Start texting by tag | Send SMS through the API | Texting copy and timing stay visible and editable in each client's GHL. The backend owns whether and when. |
| Backend-owned caps and window | Rely on GHL workflow conditions | Rules hold however a workflow is edited, and are unit-tested. |
| Shared-secret header on webhooks | HMAC signature | GHL workflow webhook actions can send custom headers but don't sign payloads. A constant-time secret check plus location resolution and data cross-checks is what the platform supports. |
| Pipeline transfer inline, in lanes | A background job | An admin sees per-business results immediately and resolves "needs review" on the spot. The cap keeps it safe; moving it to the worker is the upgrade path for bigger sends. |
| Ledger keyed per place **and** pipeline | One row per place | The same business can be a lead in several pipelines while sharing one contact. The migration deduplicated old rows, keeping succeeded ones, before adding the new key. |
