// Excerpt: the campaign rules the backend owns, so they hold no matter how a GHL workflow is edited.

import { and, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { reviewCampaigns, reviewCampaignEvents, CAMPAIGN_OPEN_STATUSES } from '../db';
import { normalizePhone } from './phone';

const DAY = 24 * 60 * 60 * 1000;
export const TEXT_2_DELAY_MS = Number(process.env.CAMPAIGN_TEXT_2_DELAY_DAYS ?? 2) * DAY;
export const COOLDOWN_MS = 180 * DAY;
export const ROLLING_WINDOW_MS = 365 * DAY;
export const ROLLING_CAP = 2;

export const BLOCK = {
  noValidPhone: 'NO_VALID_PHONE',
  duplicate: 'DUPLICATE_CAMPAIGN',
  cooldown: 'FREQUENCY_COOLDOWN_180D',
  cap: 'FREQUENCY_CAP_365D',
  dnd: 'SMS_DND',
  alreadyReviewed: 'ALREADY_REVIEWED',
} as const;

/** Persists a campaign transition; always called inside the transaction that makes the change. */
export async function audit(tx: Tx, campaignId: string, event: string, detail: Record<string, unknown> = {}) {
  await tx.insert(reviewCampaignEvents).values({ campaignId, event, detail });
}

/**
 * Staff approval -> pending_grace campaign. The partial unique index decides duplicates: a second
 * open campaign for the same client + phone (a retry, a shared family phone) is a no-op that
 * reports the existing one, never a second campaign.
 */
export async function openCampaign(tx: Tx, request: { id: string; clientId: string }, rawPhone: unknown, graceEndsAt: Date, now = new Date()) {
  const normalizedPhone = normalizePhone(rawPhone); // E.164
  if (!normalizedPhone) return { kind: 'invalid_phone' } as const;

  const [created] = await tx
    .insert(reviewCampaigns)
    .values({ clientId: request.clientId, reviewRequestId: request.id, normalizedPhone, approvedAt: now, graceEndsAt })
    .onConflictDoNothing({
      target: [reviewCampaigns.clientId, reviewCampaigns.normalizedPhone],
      where: sql`${reviewCampaigns.status} in ('pending_grace', 'waiting_for_send_window', 'active', 'awaiting_reminder')`,
    })
    .returning();
  if (created) {
    await audit(tx, created.id, 'created', { normalizedPhone });
    return { kind: 'created', campaign: created } as const;
  }

  const [existing] = await tx
    .select()
    .from(reviewCampaigns)
    .where(
      and(
        eq(reviewCampaigns.clientId, request.clientId),
        eq(reviewCampaigns.normalizedPhone, normalizedPhone),
        inArray(reviewCampaigns.status, [...CAMPAIGN_OPEN_STATUSES]),
      ),
    );
  // a retried approval of the very same request is idempotent, not a duplicate
  if (existing.reviewRequestId === request.id) return { kind: 'created', campaign: existing } as const;
  return { kind: 'duplicate', existing } as const;
}

/** Counts only Text 1s that were really sent: one per 180 days, at most 2 per 365 days. */
export async function frequencyBlock(tx: Tx, campaign: { id: string; clientId: string; normalizedPhone: string }, now: Date) {
  const sent = await tx
    .select({ at: reviewCampaigns.text1SentAt })
    .from(reviewCampaigns)
    .where(
      and(
        eq(reviewCampaigns.clientId, campaign.clientId),
        eq(reviewCampaigns.normalizedPhone, campaign.normalizedPhone),
        ne(reviewCampaigns.id, campaign.id),
        isNotNull(reviewCampaigns.text1SentAt),
        gte(reviewCampaigns.text1SentAt, new Date(now.getTime() - ROLLING_WINDOW_MS)),
      ),
    );
  if (sent.some((r) => r.at!.getTime() > now.getTime() - COOLDOWN_MS)) return BLOCK.cooldown;
  if (sent.length >= ROLLING_CAP) return BLOCK.cap;
  return null;
}

/** Moves an open campaign to a terminal status. Returns false if it was already closed. */
export async function endCampaign(tx: Tx, campaign: { id: string }, status: string, reason: string, now = new Date(), extra = {}) {
  const [row] = await tx
    .update(reviewCampaigns)
    .set({ status, endedReason: reason, updatedAt: now, ...(status === 'cancelled' && { cancelledAt: now }), ...extra })
    .where(and(eq(reviewCampaigns.id, campaign.id), inArray(reviewCampaigns.status, [...CAMPAIGN_OPEN_STATUSES])))
    .returning({ id: reviewCampaigns.id });
  if (row) await audit(tx, campaign.id, status, { reason });
  return !!row;
}

type Tx = any; // drizzle transaction handle (trimmed)
