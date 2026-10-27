// Excerpt: upserting the customer into the client's GHL sub-account. It never adds the trigger
// tag itself; that is the dispatcher's job, after every check has passed.

import { and, eq } from 'drizzle-orm';
import { db, idempotencyKeys } from '../db';
import { deriveScopedKey, isUniqueViolation } from './idempotency';
import type { GhlProvider } from '../crm/types';
import type { ReviewRequestJob } from './jobStore';

const CAMPAIGN_ID_FIELD_NAME = 'Campaign ID';

export async function releaseReviewRequest(
  job: ReviewRequestJob,
  provider: GhlProvider,
  campaign?: { id: string; normalizedPhone: string },
): Promise<{ ghlContactId: string }> {
  if (!campaign && job.ghlContactId) return { ghlContactId: job.ghlContactId };

  // The ledger remembers the contact a previous attempt created, so a retry after a crash
  // doesn't depend on GHL's own de-duplication.
  const key = deriveScopedKey('ghl_release', job.id);
  const [ledgerRow] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, 'ghl_release'), eq(idempotencyKeys.key, key)));
  const cachedContactId = ledgerRow?.resultData?.ghlContactId;
  if (!campaign && typeof cachedContactId === 'string') return { ghlContactId: cachedContactId };

  // ...captured fields are matched to GHL custom fields by name, creating any that are missing
  // (trimmed here; see ARCHITECTURE.md, "Field mapping")...
  const { customFields, campaignFieldSet } = await mapCustomFields(job, provider, campaign);

  // Webhooks can't be mapped back without the campaign ID, so a missing field is a failure, not a skip.
  if (campaign && !campaignFieldSet) {
    await provider.getCustomFields(job.clientId); // surfaces the real cause, e.g. a missing scope
    throw new Error(`GHL custom field "${CAMPAIGN_ID_FIELD_NAME}" is unavailable`);
  }

  const { name, email, phone } = job.customerData;
  const { ghlContactId } = await provider.upsertContact(job.clientId, {
    name,
    email,
    phone: campaign?.normalizedPhone ?? phone, // E.164
    ...(customFields.length > 0 && { customFields }),
  });

  try {
    await db.insert(idempotencyKeys).values({ scope: 'ghl_release', key, resultRef: job.id, resultData: { ghlContactId } });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err; // another attempt recorded it first: same contact
  }
  return { ghlContactId };
}

declare function mapCustomFields(
  job: ReviewRequestJob,
  provider: GhlProvider,
  campaign?: { id: string },
): Promise<{ customFields: { id: string; value: string }[]; campaignFieldSet: boolean }>;
