import { describe, expect, it } from 'vitest';
import { type ApiError, XipFax } from '../src/index.js';

/** A fetch that answers every request with `body` and `status`, keeping each request. */
function standIn(status = 200, body: unknown = { plan: null }) {
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch, requests };
}

const refusal: ApiError = {
  error: {
    code: 'authentication_failed',
    message: 'That key isn’t one of XipFax’s.',
    details: [],
    request_id: 'req_1',
    doc_url: null,
  },
};

describe('new XipFax()', () => {
  it('refuses to start without a key', () => {
    for (const apiKey of ['', '   ', undefined]) {
      expect(() => new XipFax({ apiKey } as { apiKey: string })).toThrow(TypeError);
    }
    expect(() => new XipFax(undefined as unknown as { apiKey: string })).toThrow(/API key/);
  });

  it('sends to the API’s own address unless given another', async () => {
    const own = standIn();
    await new XipFax({ apiKey: 'key-a', fetch: own.fetch }).getPlan();
    expect(own.requests[0]!.url).toBe('https://api.xipfax.com/plan');

    const other = standIn();
    await new XipFax({
      apiKey: 'key-a',
      baseUrl: 'https://api.example.com/',
      fetch: other.fetch,
    }).getPlan();
    expect(other.requests[0]!.url).toBe('https://api.example.com/plan');
  });

  it('keeps each client’s key to itself', async () => {
    const a = standIn();
    const b = standIn();
    const first = new XipFax({ apiKey: 'key-a', fetch: a.fetch });
    const second = new XipFax({ apiKey: 'key-b', fetch: b.fetch });

    await first.getPlan();
    await second.getPlan();

    expect(a.requests.map((request) => request.headers.get('Authorization'))).toEqual([
      'Bearer key-a',
    ]);
    expect(b.requests.map((request) => request.headers.get('Authorization'))).toEqual([
      'Bearer key-b',
    ]);
  });

  it('answers a refusal as `error`, or throws it where the call asks', async () => {
    const { fetch } = standIn(401, refusal);
    const xipfax = new XipFax({ apiKey: 'key-a', fetch });

    const { data, error, response } = await xipfax.getPlan();
    expect(data).toBeUndefined();
    expect(error).toEqual(refusal);
    expect(response?.status).toBe(401);

    await expect(xipfax.getPlan({ throwOnError: true })).rejects.toEqual(refusal);
  });
});
