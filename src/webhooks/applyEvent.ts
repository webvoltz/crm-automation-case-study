// Excerpt: a GHL event moves the campaign to its next state, exactly once.

import { and, eq, or } from 'drizzle-orm';
import { db, idempotencyKeys, reviewCampaigns } from '../db';
import { AppError } from '../errors';
import { deriveScopedKey } from '../triggers/idempotency';
import { audit, endCampaign, TEXT_2_DELAY_MS } from '../campaigns/campaigns';
import type { GhlCampaignEventInput } from './normalise';

const OPT_OUT = /\b(stop|stopall|unsubscribe|opt[- ]?out|dnd|do not (disturb|contact))\b/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function applyCampaignEvent(clientId: string, input: GhlCampaignEventInput) {
  const at = input.occurredAt ? new Date(input.occurredAt) : new Date();

  return db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(reviewCampaigns)
      .where(
        and(
          eq(reviewCampaigns.clientId, clientId),
          or(
            eq(reviewCampaigns.ghlCampaignId, input.campaignId),
            UUID.test(input.campaignId) ? eq(reviewCampaigns.id, input.campaignId) : undefined,
          ),
        ),
      );
    if (!found) throw new AppError('NOT_FOUND', 404);

    // The campaign ID decides the mapping; contact and phone must agree with it, never override it.
    const phone = input.phone ? input.phone.replaceAll(/\D/g, '') : '';
    if (
      (input.contactId && found.ghlContactId && input.contactId !== found.ghlContactId) ||
      (phone.length >= 10 && !found.normalizedPhone.replaceAll(/\D/g, '').endsWith(phone.slice(-10)))
    ) {
      throw new AppError('CONFLICT', 409);
    }

    // idempotent: a redelivered event hits the ledger row and changes nothing
    const key = deriveScopedKey('ghl_campaign_event', found.id, input.event, input.eventId ?? '');
    const [fresh] = await tx
      .insert(idempotencyKeys)
      .values({ scope: 'ghl_campaign_event', key, resultRef: found.id })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (!fresh) return { applied: false, status: found.status };

    const [c] = await tx.select().from(reviewCampaigns).where(eq(reviewCampaigns.id, found.id)).for('update');
    const optOut = input.dnd === true || OPT_OUT.test(input.reason ?? '');
    const ended = (status: string, reason: string, extra = {}) => endCampaign(tx, c, status, reason, at, extra);

    let applied = false;
    switch (input.event) {
      case 'text_1_attempted':
        // only meaningful once dispatch tagged the contact; anything stale or out of order is ignored
        if (c.status === 'active') {
          const sent = input.sent !== false;
          await tx
            .update(reviewCampaigns)
            .set({
              status: 'awaiting_reminder',
              text1AttemptedAt: at,
              text1SentAt: sent ? at : null,
              text2DueAt: new Date(at.getTime() + TEXT_2_DELAY_MS),
              updatedAt: at,
            })
            .where(eq(reviewCampaigns.id, c.id));
          await audit(tx, c.id, 'text_1_attempted', { sent });
          applied = true;
        }
        break;
      case 'text_2_attempted':
        if (c.status === 'awaiting_reminder') applied = await ended('completed', 'completed', { text2AttemptedAt: at });
        break;
      case 'reply_received':
        applied = optOut ? await ended('ended_dnd', 'sms_stop') : await ended('ended_reply', 'reply_received');
        break;
      case 'review_link_clicked':
        applied = await ended('ended_link_click', 'review_link_clicked');
        break;
      case 'sms_failed': {
        // a failed Text 1 never counts toward the frequency caps, so its sent timestamp is cleared
        const text1 = input.text === 1 || (input.text === undefined && c.status !== 'awaiting_reminder');
        const clear = text1 ? { text1SentAt: null } : {};
        applied = optOut
          ? await ended('ended_dnd', 'sms_stop', clear)
          : await ended('failed', input.reason ? `sms_failed: ${input.reason}` : 'sms_failed', clear);
        break;
      }
    }
    return { applied, status: c.status };
  });
}
