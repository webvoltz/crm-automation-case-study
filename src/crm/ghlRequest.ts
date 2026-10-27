// Excerpt from the shipped backend: the one HTTP wrapper every GoHighLevel call goes through.
// Two clients share it: one per client sub-account (review campaigns) and one for the agency's
// own sales sub-account (Business Search → pipeline).

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
// A hung call would leave a send (or a worker job) waiting with no end; this fails it fast.
const GHL_TIMEOUT_MS = 15_000;

export type RetryClassification = 'retryable' | 'permanent';

// Anything not listed (5xx, network errors) is retryable. A 4xx means the request itself is
// wrong, so repeating it would only burn rate limit.
const GHL_RETRY_POLICY: Record<number, RetryClassification> = {
  400: 'permanent',
  401: 'permanent',
  403: 'permanent',
  404: 'permanent',
  409: 'permanent',
  422: 'permanent',
  429: 'retryable',
};

export class RetryableProviderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RetryableProviderError';
  }
}

export class PermanentProviderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'PermanentProviderError';
  }
}

export interface LocationAuth {
  locationId: string;
  token: string; // a Private Integration Token, scoped to one sub-account
}

export function createGhlRequest(fetchImpl: typeof fetch) {
  return async function ghlRequest(auth: LocationAuth, path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${GHL_BASE_URL}${path}`, {
        signal: AbortSignal.timeout(GHL_TIMEOUT_MS),
        ...init,
        headers: {
          Authorization: `Bearer ${auth.token}`,
          Version: GHL_API_VERSION,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });
    } catch (err) {
      // timeouts and network failures never reached GHL: always safe to try again
      const reason = err instanceof Error ? err.message : String(err);
      throw new RetryableProviderError(0, `GHL ${init.method ?? 'GET'} ${path} failed: ${reason}`);
    }
    if (res.ok) return res;

    const classification = GHL_RETRY_POLICY[res.status] ?? 'retryable';
    const body = await res.text().catch(() => '');
    const message = `GHL ${init.method ?? 'GET'} ${path} -> ${res.status}: ${body}`;
    if (classification === 'retryable') throw new RetryableProviderError(res.status, message);
    throw new PermanentProviderError(res.status, message);
  };
}

// One of the 15 provider methods built on it. Per-channel DND wins; a bare `dnd: true`
// (all channels) with no SMS entry blocks too.
export async function getSmsDndStatus(ghlRequest: ReturnType<typeof createGhlRequest>, auth: LocationAuth, contactId: string) {
  const res = await ghlRequest(auth, `/contacts/${contactId}`);
  const { contact } = (await res.json()) as {
    contact?: { dnd?: boolean; dndSettings?: { SMS?: { status?: string } }; tags?: string[] };
  };
  if (!contact) throw new PermanentProviderError(200, 'GHL contact response had no contact');
  const sms = contact.dndSettings?.SMS?.status;
  return { smsDnd: sms ? sms !== 'inactive' : contact.dnd === true, tags: contact.tags ?? [] };
}
