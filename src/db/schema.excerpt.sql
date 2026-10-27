-- Excerpt: the tables behind the integration (PostgreSQL 16, generated from the Drizzle schema, trimmed).

-- The queue: a review request is a job. No broker, no second store to keep in sync.
CREATE INDEX review_requests_worker_claim_idx
  ON review_requests (status, confirmation_status, next_attempt_at) WHERE is_deleted = false;
CREATE INDEX review_requests_releasing_claimed_at_idx
  ON review_requests (status, claimed_at);

-- One row per (client, phone) campaign: Text 1, then an optional Text 2 reminder.
CREATE TABLE review_campaigns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  review_request_id   uuid NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
  normalized_phone    text NOT NULL,          -- E.164
  ghl_contact_id      text,
  ghl_campaign_id     text,                   -- echoed back by GHL on every webhook
  status              varchar(30) NOT NULL DEFAULT 'pending_grace',
  approved_at         timestamptz NOT NULL,
  grace_ends_at       timestamptz NOT NULL,
  text_1_attempted_at timestamptz,
  text_1_sent_at      timestamptz,            -- the only column the frequency caps count
  text_2_due_at       timestamptz,
  text_2_attempted_at timestamptz,
  cancelled_at        timestamptz,
  ended_reason        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- The concurrency guard: the database, not app code, guarantees one open campaign per phone.
CREATE UNIQUE INDEX review_campaigns_open_phone_unique
  ON review_campaigns (client_id, normalized_phone)
  WHERE status IN ('pending_grace', 'waiting_for_send_window', 'active', 'awaiting_reminder');
CREATE INDEX review_campaigns_frequency_idx
  ON review_campaigns (client_id, normalized_phone, text_1_sent_at);

-- Append-only transition log.
CREATE TABLE review_campaign_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES review_campaigns(id) ON DELETE CASCADE,
  event       text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One ledger, many scopes: ghl_release, ghl_campaign_event, cancel, review_reply.
CREATE TABLE idempotency_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       varchar(30) NOT NULL,
  key         text NOT NULL,                  -- sha256 of scope + parts
  result_ref  uuid,
  result_data jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_scope_key_unique UNIQUE (scope, key)
);

-- Every webhook call, accepted or not. The secret header is never stored.
CREATE TABLE ghl_webhook_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid REFERENCES clients(id) ON DELETE SET NULL,
  campaign_id text,
  event       text,
  outcome     varchar(20) NOT NULL,           -- applied | ignored | rejected
  status_code integer NOT NULL,
  error       text,
  payload     jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- What was sent to the sales pipeline: one row per Google place per pipeline, so a business
-- found again in a later search is never imported twice into the same pipeline.
CREATE TABLE ghl_transfers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id           text NOT NULL,
  pipeline_id        text NOT NULL,
  pipeline_name      text,
  status             varchar(20) NOT NULL,    -- sending | succeeded | failed | needs_review
  ghl_contact_id     text,
  ghl_opportunity_id text,
  attempts           integer NOT NULL DEFAULT 0,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ghl_transfers_place_pipeline_unique UNIQUE (place_id, pipeline_id)
);

-- The migration that moved the key from one pipeline per place to one row per (place, pipeline):
-- keep one row per pair, succeeded rows first, before adding the new constraint.
DELETE FROM ghl_transfers t USING (
  SELECT id, row_number() OVER (
    PARTITION BY place_id, pipeline_id
    ORDER BY (status = 'succeeded') DESC, updated_at DESC
  ) AS rn FROM ghl_transfers
) ranked
WHERE t.id = ranked.id AND ranked.rn > 1;
