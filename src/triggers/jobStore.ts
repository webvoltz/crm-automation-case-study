// Excerpt: Postgres is the job queue. A due review request is claimed with SKIP LOCKED, and every
// later write is guarded by the claim it was made under.

import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { db, reviewRequests, capturedEvents } from '../db';

export async function claimDueForRelease(limit: number, workerId: string) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: reviewRequests.id,
        clientId: reviewRequests.clientId,
        attempts: reviewRequests.attempts,
        ghlContactId: reviewRequests.ghlContactId,
        customerData: capturedEvents.customerData,
      })
      .from(reviewRequests)
      .innerJoin(capturedEvents, eq(capturedEvents.id, reviewRequests.capturedEventId))
      .where(
        and(
          eq(reviewRequests.status, 'pending'),
          eq(reviewRequests.confirmationStatus, 'ready'),
          eq(reviewRequests.isDeleted, false),
          lte(reviewRequests.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(reviewRequests.nextAttemptAt))
      .limit(limit)
      // a second worker skips these rows instead of waiting on them or taking them twice
      .for('update', { of: reviewRequests, skipLocked: true });

    if (rows.length === 0) return [];

    await tx
      .update(reviewRequests)
      .set({ status: 'releasing', claimedAt: now, claimedBy: workerId })
      .where(inArray(reviewRequests.id, rows.map((r) => r.id)));
    return rows.map((r) => ({ ...r, claimedAt: now }));
  });
}

// Every outcome write (sent, retry, failed, soft skip) has this shape. A worker that stalled past
// its 10-minute lease and was reaped can't overwrite the newer claim: its UPDATE matches nothing.
export async function markSent(jobId: string, ghlContactId: string, claimedAt: Date) {
  await db
    .update(reviewRequests)
    .set({ status: 'sent', sentAt: new Date(), ghlContactId })
    .where(
      and(
        eq(reviewRequests.id, jobId),
        eq(reviewRequests.status, 'releasing'),
        eq(reviewRequests.claimedAt, claimedAt),
      ),
    );
}

// Trimmed: markRetry, markFailed and markSoftSkip use the same guarded WHERE as markSent.
// reapStaleReleasing claims rows stuck in 'releasing' past the lease (also with SKIP LOCKED) and
// sends them back to 'pending' with backoff, or to 'failed' on the last attempt.
export type ReviewRequestJob = Awaited<ReturnType<typeof claimDueForRelease>>[number];
export declare function markRetry(jobId: string, error: string, nextAttemptAt: Date, claimedAt: Date): Promise<void>;
export declare function markFailed(jobId: string, error: string, claimedAt: Date): Promise<void>;
export declare function markSoftSkip(jobId: string, nextAttemptAt: Date, claimedAt: Date): Promise<void>;
export declare function reapStaleReleasing(staleBefore: Date): Promise<{ id: string; error: string }[]>;
