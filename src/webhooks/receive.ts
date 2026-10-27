// Excerpt: the endpoint GHL workflows call back (POST /integrations/ghl/campaign-events).
// Rate limited (300 requests / 15 min), authenticated before anything about the body is revealed,
// and every call is written to ghl_webhook_log, applied, ignored or rejected.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../errors';
import { ghlCampaignEventSchema } from './normalise';
import { applyCampaignEvent } from './applyEvent';

const uuid = z.string().uuid();
const digest = (v: string) => createHash('sha256').update(v).digest();

/** Hashing both sides first gives equal-length buffers, which timingSafeEqual requires. */
export function verifyWebhookSecret(presented: string): void {
  const expected = process.env.GHL_WEBHOOK_SECRET_KEY;
  if (!expected) throw new Error('GHL_WEBHOOK_SECRET_KEY is not set');
  if (!timingSafeEqual(digest(expected), digest(presented.trim()))) {
    throw new AppError('INVALID_SIGNATURE', 401);
  }
}

export async function handle(req: Request, res: Response, ctx: WebhookContext) {
  const secret = req.header('x-webhook-secret');
  const parsed = ghlCampaignEventSchema.safeParse(req.body);
  // An unknown location, a bad secret and an unparseable body from an unauthenticated caller
  // all look the same from outside (401).
  const idHeader = uuid.safeParse(req.header('x-client-id'));
  const locationId = (parsed.success && parsed.data.locationId) || req.header('x-location-id');
  if (!secret) throw new AppError('INVALID_SIGNATURE', 401);
  const clientId = await resolveWebhookClient(idHeader.success ? idHeader.data : undefined, locationId || undefined);
  verifyWebhookSecret(secret);
  ctx.clientId = clientId;

  if (!parsed.success) throw new AppError('INVALID_REQUEST', 400);
  ctx.event = parsed.data.event;
  ctx.campaignId = parsed.data.campaignId;
  const result = await applyCampaignEvent(clientId, parsed.data);
  await record(req, ctx, result.applied ? 'applied' : 'ignored', 200);
  res.json({ ok: true, data: result });
}

interface WebhookContext {
  clientId?: string;
  campaignId?: string;
  event?: string;
}
// resolveWebhookClient(): the sub-account (GHL location) the call came from names the client.
// record(): inserts into ghl_webhook_log; bookkeeping must never fail the webhook itself, and the
// secret header is never stored.
declare function resolveWebhookClient(clientId?: string, locationId?: string): Promise<string>;
declare function record(req: Request, ctx: WebhookContext, outcome: 'applied' | 'ignored' | 'rejected', status: number): Promise<void>;
