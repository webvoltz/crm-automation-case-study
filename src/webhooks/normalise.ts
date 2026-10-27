// Excerpt: GHL workflow webhooks send whatever keys the workflow author typed. Accept the likely
// spellings of the identifying fields and normalise them to one validated shape.

import { z } from 'zod';

export const GHL_CAMPAIGN_EVENTS = [
  'text_1_attempted',
  'text_2_attempted',
  'reply_received',
  'review_link_clicked',
  'sms_failed',
] as const;

const ALIASES: Record<string, string[]> = {
  campaignId: ['Campaign ID', 'campaign_id'],
  contactId: ['contact_id'],
  locationId: ['location_id'],
};

// GHL's webhook action posts the contact's own data at the top level (contact_id, phone,
// location.id, the "Campaign ID" custom field, ...) and the key/values the workflow author added
// under `customData`. Flatten both, letting customData win.
const normaliseKeys = (raw: unknown) => {
  if (typeof raw !== 'object' || raw === null) return raw;
  const top = raw as Record<string, unknown>;
  const custom =
    typeof top.customData === 'object' && top.customData !== null ? (top.customData as Record<string, unknown>) : {};
  const body: Record<string, unknown> = { ...top, ...custom };
  // GHL's own contact_id is authoritative over a hand-typed customData.contactId, which is
  // easy to map to the wrong merge tag (e.g. the location id).
  if (top.contact_id !== undefined) body.contactId = top.contact_id;
  const location = top.location;
  if (body.locationId === undefined && typeof location === 'object' && location !== null) {
    body.locationId = (location as { id?: unknown }).id;
  }
  for (const [key, aliases] of Object.entries(ALIASES)) {
    if (body[key] === undefined) body[key] = aliases.map((a) => body[a]).find((x) => x !== undefined);
  }
  return body;
};

const eventShape = z.object({
  event: z.enum(GHL_CAMPAIGN_EVENTS),
  campaignId: z.string().min(1).max(100), // the "Campaign ID" custom field GHL echoes back
  contactId: z.string().min(1).max(100).optional(), // cross-check only
  phone: z.string().max(50).optional(), // cross-check only
  locationId: z.string().min(1).max(100).optional(),
  eventId: z.string().min(1).max(200).optional(), // makes redelivery of the same event a no-op
  occurredAt: z.string().datetime({ offset: true }).optional(),
  text: z.union([z.literal(1), z.literal(2)]).optional(),
  sent: z.boolean().optional(),
  dnd: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

export const ghlCampaignEventSchema = z.preprocess(normaliseKeys, eventShape);
export type GhlCampaignEventInput = z.infer<typeof eventShape>;
