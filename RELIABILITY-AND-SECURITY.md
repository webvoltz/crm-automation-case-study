<p align="center">
  <img src="assets/diagrams/retry.png" alt="Worker outcomes and retry paths" width="100%">
</p>

# Reliability and security

- [Reliability](#reliability)
- [How we tested](#how-we-tested)
- [Threat model](#threat-model)
- [Input validation](#input-validation)
- [Data handled](#data-handled)
- [Observability](#observability)
- [Known limits](#known-limits)

---

## Reliability

The integration's promise is simple: **a customer who should get a text gets exactly one, at a sensible time, and one who shouldn't never does.** Each part of that is held by a specific mechanism:

| Promise | Held by |
| --- | --- |
| Exactly one open campaign per phone | Partial unique index on `review_campaigns` |
| No text after an opt-out | Live DND read from GHL, fail-closed, re-checked under a row lock |
| No text outside 9 AM – 7 PM | Window checked before and inside the final transaction, clock advanced by elapsed time |
| No text too often | 180-day cooldown and 2 per 365 days, counted from texts really sent |
| No job lost on a crash | Claim lease, reaper, guarded writes |
| No job run twice | `SKIP LOCKED` claims and the claim in every write's `WHERE` |
| No webhook applied twice | Idempotency key inserted in the same transaction as the change |
| No duplicate prospect contacts | Ledger per place and pipeline, phone-keyed lanes, human review for unclear matches |

Retries are bounded: 5 attempts with exponential backoff and jitter, and a 15-second timeout per GHL call. A client that isn't connected yet is skipped without using attempts, so connecting it later lets queued requests go out normally.

---

## How we tested

The integration has **141 test cases across 14 files**, run with Vitest against a real Postgres. GHL is replaced with in-memory fakes that implement the same provider interface, so tests cover the real SQL: the `SKIP LOCKED` claim, the partial unique index, the guarded writes.

| Area | What is tested |
| --- | --- |
| Campaign rules (43) | Open, duplicate, grace, every gate, each webhook transition, out-of-order and repeated events |
| Worker (17) | Each outcome path, backoff, attempt limits, lease reaping, stale writes |
| Idempotency (14) | Scoped keys, unique-violation races |
| Transfer (10) | Ledger claims, resume after failure, matching rules, needs review, lanes |
| Provisioning (9) | Create-if-missing, existing values untouched, listing failures |
| Release (9) | Field mapping, ledger reuse, missing Campaign ID |
| Config routes and validation (12) | Live token test, invalid credentials never saved, a location already linked to another client |
| Sales account and client (11) | Connect and disconnect, custom fields and tags created, live pipelines, timeouts, missing opportunity scope |
| Send window, phone, backoff, GHL client (16) | 9:00 and 19:00 edges, DST, month rollover, E.164 normalising, jitter bounds, retry classification |

---

## Threat model

| Threat | Mitigation |
| --- | --- |
| Forged webhook | Shared secret in a header, compared in constant time; client resolved from the GHL location; contact and phone must match the campaign |
| Probing the webhook | The same 401 for unknown location, bad secret and bad body; rate limit 300 / 15 min, stored in Postgres so it holds across processes |
| Replay of a real webhook | Idempotency key per campaign, event and GHL event id; replays are logged as ignored |
| Leaked CRM token | Stored server-side only; the API returns the last 4 characters; tokens are scoped per sub-account |
| One client's events touching another's | Every lookup is scoped by client id; the location → client mapping is unique among active clients |
| Mis-mapped workflow fields | GHL's own `contact_id` wins over hand-typed values; mismatches are a 409, not a remap |
| Staff mistakes | Cancel and revert only touch campaigns not yet dispatched; every campaign transition is logged |

---

## Input validation

- Every request body and webhook payload is parsed with Zod before use. Webhook payloads are normalised first, then validated against a closed set of 5 event types with length limits on every string.
- Phones are normalised to E.164 before they're stored, matched or sent to GHL.
- Pipeline and stage ids from the dashboard are checked against GHL's live pipelines before a send.
- A transfer accepts at most 50 businesses (configurable), checked server-side.

---

## Data handled

- Customer name, phone and email, captured by the front desk with the customer's consent to receive SMS.
- GHL contact, campaign and opportunity ids.
- Webhook payloads, kept in `ghl_webhook_log` for debugging. The secret header is never stored.
- Google Places data for prospects, with the Google-sourced fields purged on a schedule.

---

## Observability

- `ghl_webhook_log`: every webhook call with outcome (applied, ignored, rejected) and status code.
- `review_campaign_events`: the full transition history of every campaign.
- `last_error` and `attempts` on each request, shown in the dashboard.
- `audit_logs`: GHL connections, provisioning results and transfers with per-status counts.
- Worker heartbeat every 30 s, shown on a worker-health page.

---

## Known limits

- **Webhook auth is a shared secret, not a signature.** GHL workflow webhook actions can send custom headers but don't sign payloads. The secret is one value for all clients; per-client secrets are the next step if a client's workflow is ever exported elsewhere.
- **Transfers run inside the HTTP request.** Fine for up to 50 businesses per send. Hundreds at once should move to the worker queue.
- **No outbound GHL rate limiter.** Load is bounded by batch sizes and the transfer cap, and 429s are retried with backoff. A shared token bucket would be needed at much higher volume.
- **Custom field creation can race.** Two workers creating the same missing field at once may create a duplicate field in GHL. It's rare, harmless to texting, and documented in the code rather than solved with a distributed lock.
- **One send window for all clients.** 9 AM – 7 PM in one time zone, switchable per environment. Per-client time zones are a small change if clients span regions.
- **The worker runs in the API process.** It can also run on its own (`npm run worker`); `SKIP LOCKED` makes several workers safe, but there is no autoscaling.
