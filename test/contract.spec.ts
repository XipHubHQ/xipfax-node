import { describe, expect, it } from 'vitest';
import { API_VERSION, type Fax, type FaxEvent, XipFax } from '../src/index.js';
import { apiDocument, operations, readEvent, readRequest, versionRefused } from './contract.js';

/**
 * Each of the SDK's methods sends the request the API's document asks for: its method and path on
 * the document's server, the key as a bearer token, the version, and every parameter and body as
 * the document's schemas take them. The calls are typed by the SDK, so they compile only as the
 * generated types allow, and each request they send is read against the document itself. Each
 * event the document posts is typed by the SDK as `FaxEvent`, which the document takes as it posts
 * it.
 */

/** One call of each operation, by its operation id, with arguments the document takes. */
const calls: Record<string, (xipfax: XipFax) => Promise<unknown>> = {
  getQuote: (xipfax) => xipfax.getQuote({ query: { pages: 3 } }),
  getDraft: (xipfax) => xipfax.getDraft(),
  addDocument: (xipfax) =>
    xipfax.addDocument({
      headers: { 'Idempotency-Key': 'add-letter-1' },
      body: { name: 'letter.pdf', url: 'https://example.com/letter.pdf' },
    }),
  completeDocument: (xipfax) =>
    xipfax.completeDocument({
      headers: { 'Idempotency-Key': 'complete-letter-1' },
      path: { document_id: 'doc_1' },
    }),
  removeDocument: (xipfax) => xipfax.removeDocument({ path: { document_id: 'doc_1' } }),
  sendDraft: (xipfax) =>
    xipfax.sendDraft({
      headers: { 'Idempotency-Key': 'send-letter-1' },
      body: { fax_number: '+1 202 555 0143', document_ids: ['doc_1'] },
    }),
  listFaxes: (xipfax) =>
    xipfax.listFaxes({ query: { limit: 20, starting_after: 'fax_0', direction: 'sent' } }),
  getFax: (xipfax) => xipfax.getFax({ path: { fax_id: 'fax_1' } }),
  getConfirmation: (xipfax) => xipfax.getConfirmation({ path: { fax_id: 'fax_1' } }),
  getPlan: (xipfax) => xipfax.getPlan(),
  listOffices: (xipfax) =>
    xipfax.listOffices({
      query: { search: 'Form 2848', place: 'OH', limit: 5, starting_after: 'office_0' },
    }),
  registerWebhookEndpoint: (xipfax) =>
    xipfax.registerWebhookEndpoint({
      headers: { 'Idempotency-Key': 'register-endpoint-1' },
      body: { url: 'https://example.com/xipfax/events' },
    }),
  removeWebhookEndpoint: (xipfax) =>
    xipfax.removeWebhookEndpoint({ path: { endpoint_id: 'endpoint_1' } }),
};

/** A fax you sent, as its event finds it once it has ended. */
function sentFax(status: 'delivered' | 'failed', failure: Fax['failure']): Fax {
  return {
    id: 'fax_1',
    direction: 'sent',
    status,
    step: null,
    office_id: null,
    to_number: '+12025550143',
    from_number: '+12025550100',
    pages: 2,
    price: status === 'delivered' ? { amount_minor: 100, currency: 'USD' } : null,
    sent_at: '2026-11-07T02:00:00Z',
    finished_at: '2026-11-07T02:03:00Z',
    retry_at: null,
    failure,
    time_zone: 'America/New_York',
    sender_name: null,
    cover_confidential: false,
  };
}

/** The fax each event tells of, by the event's type: one for every type `FaxEvent` names. */
const eventFaxes: Record<FaxEvent['type'], Fax> = {
  'fax.delivered': sentFax('delivered', null),
  'fax.failed': sentFax('failed', 'busy'),
  'fax.received': {
    id: 'fax_2',
    direction: 'received',
    status: 'received',
    step: null,
    office_id: null,
    to_number: '+12025550100',
    from_number: '+12025550111',
    pages: 3,
    price: null,
    sent_at: '2026-11-07T02:10:00Z',
    finished_at: null,
    retry_at: null,
    failure: null,
    time_zone: null,
    sender_name: null,
    cover_confidential: false,
  },
};

/** A fetch that answers every request with `status`, keeping each request it was given. */
function standIn(status: number): { fetch: typeof fetch; requests: Request[] } {
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return status === 204
      ? new Response(null, { status })
      : new Response('{}', { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, requests };
}

describe("the SDK against the API's document", () => {
  it('has a call and a method for every operation the document names, and none it does not', () => {
    const ids = operations.map(({ operation }) => operation.operationId).sort();
    expect(Object.keys(calls).sort()).toEqual(ids);
    for (const id of ids) {
      expect(typeof (XipFax.prototype as unknown as Record<string, unknown>)[id]).toBe('function');
    }
  });

  it('names the version the document is, the one Xip-Version takes', () => {
    expect(API_VERSION).toBe(apiDocument.info.version);
    for (const { path, method } of operations) {
      expect(versionRefused(path, method, API_VERSION), `${method} ${path}`).toEqual([]);
    }
  });

  it.each(operations)(
    '$operation.operationId sends $method $path as the document asks',
    async ({ operation }) => {
      const success = Number(Object.keys(operation.responses).find((code) => /^2\d\d$/.test(code)));
      const { fetch, requests } = standIn(success);
      const xipfax = new XipFax({ apiKey: 'xipfax_key_live_example', fetch });

      const answer = (await calls[operation.operationId]!(xipfax)) as { error?: unknown };

      expect(answer.error).toBeUndefined();
      expect(requests).toHaveLength(1);
      expect(requests[0]!.headers.get('Authorization')).toBe('Bearer xipfax_key_live_example');
      expect(await readRequest(requests[0]!)).toEqual({
        operationId: operation.operationId,
        refused: [],
      });
    },
  );

  it('types each event the document posts as FaxEvent, which the document takes', () => {
    expect(Object.keys(apiDocument.webhooks ?? {}).sort()).toEqual(Object.keys(eventFaxes).sort());
    for (const [type, data] of Object.entries(eventFaxes) as Array<[FaxEvent['type'], Fax]>) {
      const event: FaxEvent = {
        id: 'event_1',
        type,
        api_version: API_VERSION,
        created_at: '2026-11-07T02:03:00Z',
        data,
      };
      expect(readEvent(type, event), type).toEqual([]);
    }
  });
});
