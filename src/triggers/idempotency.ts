// Excerpt: one ledger table, many scopes (ghl_release, ghl_campaign_event, cancel, review_reply).
// Keys are hashed, so any number of parts fits one indexed column.

import { createHash } from 'node:crypto';

export function deriveScopedKey(scope: string, ...parts: string[]): string {
  return createHash('sha256').update([scope, ...parts].join(':')).digest('hex');
}

// Postgres unique_violation: the database, not a read-then-write, decides who was first.
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505';
}
