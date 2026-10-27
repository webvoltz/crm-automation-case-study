// Excerpt: the automated trigger. Everything that could stop a text is checked first, then checked
// again under a row lock, and only then is the tag added that starts the GHL workflow.
//
// Order: grace period -> send window -> contact upsert (with the campaign ID) -> live DND from GHL
// -> one transaction re-checking campaign, DND, tags, frequency and window -> `review_candidate` tag.

import { eq } from 'drizzle-orm';
import { db, reviewCampaigns } from '../db';
import { isInSendWindow, nextSendTime } from './sendWindow';
import { audit, BLOCK, frequencyBlock, type Campaign } from '../campaigns/campaigns';
import { releaseReviewRequest } from './release';
import type { GhlProvider } from '../crm/types';
import type { ReviewRequestJob } from './jobStore';

export const REVIEW_CANDIDATE_TAG = 'review_candidate';
const REVIEWED_TAGS = ['reviewed', 'review_submitted'];
const hasTag = (tags: string[], ...wanted: string[]) => tags.some((t) => wanted.includes(t.toLowerCase()));

export type DispatchResult = { ghlContactId: string } | { deferUntil: Date } | { blockedReason: string };

export async function dispatchReviewRequest(
  job: ReviewRequestJob,
  provider: GhlProvider = defaultProvider,
  now = new Date(),
): Promise<DispatchResult> {
  // opened when staff approved the request (campaigns.ts, openCampaign); a manual resend opens a fresh one
  const current = await currentCampaign(job);
  if ('blockedReason' in current) return current;

  const startedAt = Date.now();
  // `now` advanced by the real time the GHL calls took, so the final window check is current
  const elapsedNow = () => new Date(now.getTime() + Date.now() - startedAt);

  if (now < current.graceEndsAt) return { deferUntil: current.graceEndsAt };
  if (!isInSendWindow(now)) return markWaiting(current, nextSendTime(now));

  const { ghlContactId } = await releaseReviewRequest(job, provider, current);
  // fails closed: a GHL error here throws and the job retries, it never defaults to "not DND"
  const { smsDnd, tags } = await provider.getSmsDndStatus(job.clientId, ghlContactId);

  const outcome = await db.transaction(async (tx): Promise<DispatchResult> => {
    const [locked] = await tx.select().from(reviewCampaigns).where(eq(reviewCampaigns.id, current.id)).for('update');
    // staff may have cancelled it while we were talking to GHL
    if (!isDispatchable(locked)) return block(tx, job, null, 'cancelled', `CAMPAIGN_${locked.status.toUpperCase()}`);

    if (smsDnd) return block(tx, job, locked, 'ended_dnd', BLOCK.dnd);
    // a contact already tagged `reviewed` has left a review: nothing to start, no tag touched
    if (hasTag(tags, ...REVIEWED_TAGS)) return block(tx, job, locked, 'cancelled', BLOCK.alreadyReviewed);
    const frequency = await frequencyBlock(tx, locked, now);
    if (frequency) return block(tx, job, locked, 'frequency_blocked', frequency);
    const checkedAt = elapsedNow();
    if (!isInSendWindow(checkedAt)) return { deferUntil: nextSendTime(checkedAt) };

    await tx
      .update(reviewCampaigns)
      .set({ status: 'active', ghlContactId, ghlCampaignId: locked.id, updatedAt: checkedAt })
      .where(eq(reviewCampaigns.id, locked.id));
    await audit(tx, locked.id, 'active', { ghlContactId });
    return { ghlContactId };
  });

  if ('deferUntil' in outcome) return markWaiting(current, outcome.deferUntil);
  if ('ghlContactId' in outcome) {
    // GHL only fires "tag added" for a tag that wasn't there, so a leftover candidate tag from an
    // earlier run must come off first or Workflow 1 would not start again for this phone.
    if (hasTag(tags, REVIEW_CANDIDATE_TAG)) await provider.removeTags(job.clientId, ghlContactId, [REVIEW_CANDIDATE_TAG]);
    await provider.addTags(job.clientId, ghlContactId, [REVIEW_CANDIDATE_TAG]);
  }
  return outcome;
}

// pending_grace / waiting_for_send_window are the normal inputs; 'active' without a Text 1 attempt
// is a dispatch that committed but failed before the tag landed, so a retry may resume it.
function isDispatchable(c: Campaign): boolean {
  return (
    c.status === 'pending_grace' ||
    c.status === 'waiting_for_send_window' ||
    (c.status === 'active' && !c.text1AttemptedAt)
  );
}

// block(): ends the campaign AND cancels the claimed request in one transaction, so a crash can't
// split them. markWaiting(): moves the campaign to waiting_for_send_window and defers the job.
declare function block(...args: unknown[]): Promise<DispatchResult>;
declare function markWaiting(c: Campaign, until: Date): Promise<DispatchResult>;
declare function currentCampaign(job: ReviewRequestJob): Promise<Campaign | { blockedReason: string }>;
declare const defaultProvider: GhlProvider;
