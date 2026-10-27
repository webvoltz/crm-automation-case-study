// Excerpt: one worker pass, every 30 s. Each failure kind gets its own path, so a client that
// isn't connected yet, a bad request and a GHL outage are never treated the same way.

import { claimDueForRelease, markFailed, markRetry, markSent, markSoftSkip, reapStaleReleasing } from './jobStore';
import { dispatchReviewRequest } from './dispatch';
import { failCampaignsForRequest } from '../campaigns/campaigns';
import { NotConfiguredError } from '../crm/types';
import { PermanentProviderError } from '../crm/ghlRequest';

export const CLAIM_LEASE_MS = Number(process.env.CLAIM_LEASE_MS ?? 10 * 60 * 1000);
const PASS_INTERVAL_MS = Number(process.env.RELEASE_PASS_INTERVAL_MS ?? 30_000);
const BATCH_SIZE = 20;

export interface BackoffConfig {
  baseMs: number;
  factor: number;
  maxAttempts: number;
  jitterRatio: number;
}

const backoffConfig: BackoffConfig = { baseMs: 30_000, factor: 2, maxAttempts: 5, jitterRatio: 0.2 };

// 30 s, 1 m, 2 m, 4 m, each ±20 %, so a GHL blip doesn't bring every job back at the same instant.
export function computeBackoff(attemptNumber: number, cfg: BackoffConfig): number {
  const raw = cfg.baseMs * cfg.factor ** (attemptNumber - 1);
  const jitter = raw * cfg.jitterRatio * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(raw + jitter));
}

export async function runReviewRequestPass(workerId: string): Promise<number> {
  const now = new Date();

  // a worker that died mid-release: back to pending with backoff, or failed on the last attempt
  const reaped = await reapStaleReleasing(new Date(now.getTime() - CLAIM_LEASE_MS));
  for (const { id, error } of reaped) await failCampaignsForRequest(id, error);

  const jobs = await claimDueForRelease(BATCH_SIZE, workerId);
  for (const job of jobs) {
    try {
      const result = await dispatchReviewRequest(job);
      if ('deferUntil' in result) {
        // grace not over, or outside the send window: park it until then
        await markSoftSkip(job.id, result.deferUntil, job.claimedAt);
      } else if ('ghlContactId' in result) {
        await markSent(job.id, result.ghlContactId, job.claimedAt);
      }
      // blockedReason: the dispatcher already ended the campaign and cancelled the request
    } catch (err) {
      if (err instanceof NotConfiguredError) {
        // client not connected to GHL yet: try again next pass, no attempt used up
        await markSoftSkip(job.id, new Date(Date.now() + PASS_INTERVAL_MS), job.claimedAt);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof PermanentProviderError) {
        await markFailed(job.id, message, job.claimedAt);
        // close the campaign so the phone isn't locked by a dead request
        await failCampaignsForRequest(job.id, message);
        continue;
      }
      const nextAttemptNumber = job.attempts + 1;
      if (nextAttemptNumber >= backoffConfig.maxAttempts) {
        await markFailed(job.id, message, job.claimedAt);
        await failCampaignsForRequest(job.id, message);
      } else {
        const retryAt = new Date(Date.now() + computeBackoff(nextAttemptNumber, backoffConfig));
        await markRetry(job.id, message, retryAt, job.claimedAt);
      }
    }
  }
  return jobs.length;
}
