import { describe, expect, it } from 'vitest';
import { API_VERSION, XipFax } from '../src/index.js';
import { apiDocument, operations, readRequest, versionRefused } from './contract.js';

/**
 * Each of the SDK's methods sends the request the API's document asks for: its method and path on
 * the document's server, the key as a bearer token, the version, and every parameter and body as
 * the document's schemas take them. The calls are typed by the SDK, so they compile only as the
 * generated types allow, and each request they send is read against the document itself.
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
});
