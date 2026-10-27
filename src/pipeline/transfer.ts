// Excerpt: "Send to GHL". Prospects picked in the Business Search tool become a contact and an
// opportunity in the pipeline and stage chosen at send time, in the agency's own sub-account.

import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db, ghlTransfers } from '../db';

// ponytail: one request sends the whole selection (about 4 GHL calls per business), a few
// businesses at a time. The cap keeps a send well inside an HTTP timeout and GHL's rate limit
// (100 calls per 10 s); move it to the worker if hundreds must go at once.
const MAX_PER_SEND = Number(process.env.GHL_TRANSFER_MAX_PER_SEND ?? 50);
const LANES = 4;
// A `sending` row this old belongs to a request that died midway, so it may be claimed again.
const STALE_SENDING_MINUTES = 10;

// Google gives "+1 512-713-1099"; GHL matches and stores E.164.
const toE164 = (phone: string | null) => (phone ? phone.replace(/[^\d+]/g, '') || null : null);
const sameName = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// Takes the ledger row for this place and pipeline, unless it already succeeded or another send holds it.
async function claim(row: ResultRow, target: Target, actorId: string) {
  const [claimed] = await db
    .insert(ghlTransfers)
    .values({
      placeId: row.placeId,
      pipelineId: target.pipelineId,
      pipelineName: target.pipelineName,
      jobId: row.jobId,
      resultId: row.id,
      status: 'sending',
      attempts: 1,
      transferredBy: actorId,
    })
    .onConflictDoUpdate({
      target: [ghlTransfers.placeId, ghlTransfers.pipelineId],
      set: { status: 'sending', attempts: sql`${ghlTransfers.attempts} + 1`, transferredBy: actorId, updatedAt: new Date() },
      setWhere: or(
        inArray(ghlTransfers.status, ['failed', 'needs_review']),
        and(
          eq(ghlTransfers.status, 'sending'),
          sql`${ghlTransfers.updatedAt} < now() - make_interval(mins => ${STALE_SENDING_MINUTES})`,
        ),
      ),
    })
    .returning();
  return claimed ?? null; // null: skipped, "Already in <pipeline>" or "Being sent right now"
}

async function transferOne(row: ResultRow, target: Target, client: GhlSalesProvider, actorId: string, contactId?: string) {
  const ledger = await claim(row, target, actorId);
  if (!ledger) return { status: 'skipped' as const };

  // Progress so far: a retry continues from the step that failed instead of repeating earlier ones.
  const ids = { ghlContactId: ledger.ghlContactId, ghlOpportunityId: ledger.ghlOpportunityId };
  try {
    if (!ids.ghlContactId) {
      const phone = toE164(row.internationalPhoneNumber ?? row.nationalPhoneNumber);
      // a person already chose (contactId): skip the matching that flagged it for review
      const matches = contactId ? [] : await client.findContactsByPhone(phone ?? row.name);
      const sameBusiness = matches.filter((m) => sameName(m.companyName, row.name));

      if (contactId === 'new' || (!contactId && (matches.length === 0 || (!phone && sameBusiness.length === 0)))) {
        ids.ghlContactId = (await client.createContact(contactFor(row))).id;
      } else if (contactId || (phone && matches.length === 1 && sameBusiness.length === 1)) {
        // Already in GHL: only add to it. Existing fields, notes, tags and stage stay as they are.
        ids.ghlContactId = contactId ?? matches[0].id;
        await client.addTags(ids.ghlContactId, tagsFor(row));
      } else {
        // Same phone under another name, several hits, or a same-name contact with no phone to
        // confirm it (could be another branch): a person decides.
        await finish(row, target, 'needs_review', ids);
        return { status: 'needs_review' as const, matches };
      }
      await finish(row, target, 'sending', ids);
    }

    if (!ids.ghlOpportunityId) {
      const open = await client.findOpenOpportunity(ids.ghlContactId, target.pipelineId);
      // An open opportunity is left in whatever stage it reached; never moved back to the first stage.
      ids.ghlOpportunityId =
        open?.id ??
        (await client.createOpportunity({ contactId: ids.ghlContactId, pipelineId: target.pipelineId, stageId: target.stageId, name: row.name })).id;
      await finish(row, target, 'sending', ids);
    }

    await finish(row, target, 'succeeded', ids);
    return { status: 'succeeded' as const, ...ids };
  } catch (err) {
    await finish(row, target, 'failed', ids, err);
    return { status: 'failed' as const, ...ids };
  }
}

export async function sendAll(rows: ResultRow[], target: Target, client: GhlSalesProvider, actorId: string) {
  if (rows.length > MAX_PER_SEND) throw new Error('TOO_MANY_TO_SEND');
  // Businesses sharing a phone (or, with none, a name) go in one lane, one after another, so the
  // second finds the contact the first created instead of both creating it.
  const laneOf = new Map<string, number>();
  const lanes: number[][] = Array.from({ length: LANES }, () => []);
  rows.forEach((row, i) => {
    const key = toE164(row.internationalPhoneNumber ?? row.nationalPhoneNumber) ?? row.name?.trim().toLowerCase() ?? row.id;
    if (!laneOf.has(key)) laneOf.set(key, laneOf.size % LANES);
    lanes[laneOf.get(key)!].push(i);
  });
  const items = new Array(rows.length);
  await Promise.all(
    lanes.map(async (lane) => {
      for (const i of lane) items[i] = await transferOne(rows[i], target, client, actorId);
    }),
  );
  return items;
}

// Trimmed: types, contactFor() (name, company, E.164 phone, website, address, 6 custom fields),
// tagsFor() (one tag per prospect reason), finish() (writes status and ids to the ledger row).
type ResultRow = any;
type Target = { pipelineId: string; pipelineName: string; stageId: string };
type GhlSalesProvider = any;
declare function contactFor(row: ResultRow): Record<string, unknown>;
declare function tagsFor(row: ResultRow): string[];
declare function finish(row: ResultRow, target: Target, status: string, ids: object, err?: unknown): Promise<void>;
