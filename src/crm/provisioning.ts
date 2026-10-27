// Excerpt: connecting a client's sub-account sets up everything its GHL workflows rely on.
// Create-if-missing, matched by name, so running it twice changes nothing.

export interface ProvisionReport {
  created: string[];
  alreadyExisted: string[];
  failed: { item: string; reason: string }[];
}

const CUSTOM_FIELDS = [
  { name: 'Last Review Request Date', dataType: 'DATE' },
  { name: 'Campaign ID', dataType: 'TEXT' }, // lets GHL echo the campaign back on its webhooks
] as const;

// Tags the workflows and the backend share. Adding `review_candidate` is what starts Workflow 1.
const TAGS = [
  'dnd_active',
  'no_text_requested',
  'campaign_cancelled',
  'campaign_ended_inactive_client',
  'campaign_ended_link_clicked',
  'campaign_ended_reply_received',
  'campaign_ended_sms_dnd',
  'campaign_reminder_sent',
  'review_campaign_active',
  'review_candidate',
  'text1_or_text2_failed',
  'review_submitted',
].map((name) => ({ name }));

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function ensureAll<T extends { name: string }>(
  report: ProvisionReport,
  label: string,
  wanted: T[],
  list: () => Promise<{ name: string }[]>,
  create: (item: T) => Promise<unknown>,
): Promise<Map<string, unknown>> {
  const found = new Map<string, unknown>();
  let existing: { name: string }[];
  try {
    existing = await list();
  } catch (err) {
    // The listing failing (bad scope, GHL down) means we can't tell what exists. Don't guess
    // and risk duplicates; report every item of this kind as failed instead.
    for (const item of wanted) report.failed.push({ item: `${label}: ${item.name}`, reason: reasonOf(err) });
    return found;
  }
  for (const item of wanted) {
    const match = existing.find((e) => sameName(e.name, item.name));
    if (match) {
      found.set(item.name, match);
      report.alreadyExisted.push(`${label}: ${item.name}`);
      continue;
    }
    try {
      found.set(item.name, await create(item));
      report.created.push(`${label}: ${item.name}`);
    } catch (err) {
      report.failed.push({ item: `${label}: ${item.name}`, reason: reasonOf(err) });
    }
  }
  return found;
}

// ensureLocationSetup() runs ensureAll for, in order: the review trigger link (its merge key goes
// into the SMS bodies), 2 custom fields, 5 custom values (+2 for the webhook URL and secret), and
// 12 tags. Existing values, e.g. SMS copy staff edited by hand in GHL, are never overwritten.
export { CUSTOM_FIELDS, TAGS };
