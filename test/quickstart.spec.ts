import { describe, expect, it } from 'vitest';
import { type DraftDocument, type Fax, type Office, type Quote, XipFax } from '@xiphub/xipfax-sdk';
import { type QuickstartInput, quickstart, REAL_AND_CHARGED } from '../examples/quickstart.ts';
import { readAnswer, readRequest } from './contract.js';

/**
 * The quickstart, walked against a stand-in of the API that answers as the document says: its
 * free steps first, its charged step said before it and taken only on `send`, and each request it
 * sends read against the document, as each answer the stand-in gives is.
 */

const KEY = 'xipfax_key_live_example';
const TO = '+1 202 555 0143';
const PDF = 'https://example.com/letter.pdf';

const quote: Quote = {
  pages: 1,
  price: { amount_minor: 100, currency: 'USD' },
  price_shown: '$1.00',
  terms: 'The stand-in’s terms.',
  price_list: 'stand-in',
};

const office: Office = {
  id: 'stand-in-office',
  name: 'A stand-in office',
  fax_number: '+12025550143',
  fax_number_from_abroad: null,
  applies_to: ['Ohio'],
  takes: ['Form 2848'],
  signed_in_ink: false,
  confidential_cover: false,
  sources: [{ title: 'A stand-in page', url: 'https://example.com/office' }],
  checked_on: '2026-11-01',
};

const letter: DraftDocument = {
  id: 'doc_1',
  name: 'letter.pdf',
  size_bytes: 20_480,
  page_count: 2,
  status: 'ready',
  url: 'https://example.com/doc_1.pdf',
};

function faxAt(status: Fax['status'], step: Fax['step']): Fax {
  return {
    id: 'fax_1',
    direction: 'sent',
    status,
    step,
    office_id: null,
    to_number: '+12025550143',
    from_number: null,
    pages: 2,
    price: null,
    sent_at: '2026-11-07T02:00:00Z',
    finished_at: status === 'delivered' ? '2026-11-07T02:03:00Z' : null,
    retry_at: null,
    failure: null,
    time_zone: 'America/New_York',
    sender_name: null,
    cover_confidential: false,
  };
}

/** What a walk saw: each request, line and question in its order, and what the document refused. */
interface Walk {
  events: string[];
  requests: Request[];
  answersRefused: string[];
}

/** The API as the quickstart finds it, its draft holding `draft` to begin with. */
function standIn(draft: DraftDocument[] = []): { fetch: typeof fetch; walk: Walk } {
  const walk: Walk = { events: [], requests: [], answersRefused: [] };
  let documents = [...draft];
  let reads = 0;

  function answer(route: string): [number, unknown] {
    switch (route) {
      case 'GET /quote':
        return [200, quote];
      case 'GET /offices':
        return [200, { data: [office], has_more: false, next_cursor: null }];
      case 'GET /draft':
        return [200, { id: 'fax_1', documents }];
      case 'POST /draft/documents':
        documents = [...documents, letter];
        return [201, { document: letter, upload: null }];
      case 'DELETE /draft/documents/doc_1':
        documents = documents.filter((document) => document.id !== 'doc_1');
        return [204, undefined];
      case 'POST /draft/send':
        return [200, { fax: faxAt('sending', 'queued'), paid_by: 'plan', confirm_url: null }];
      case 'GET /faxes/fax_1':
        reads += 1;
        return [200, reads < 2 ? faxAt('sending', 'sending') : faxAt('delivered', null)];
      case 'GET /faxes/fax_1/confirmation':
        return [200, { url: 'https://example.com/confirmation.pdf' }];
      default:
        return [404, undefined];
    }
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const route = `${request.method} ${new URL(request.url).pathname}`;
    walk.requests.push(request);
    walk.events.push(route);
    const [status, body] = answer(route);
    walk.answersRefused.push(...readAnswer(request, status, body));
    return body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
  };
  return { fetch, walk };
}

function inputFor(walk: Walk, typed: string, to?: string, pdfUrl?: string): QuickstartInput {
  return {
    to,
    pdfUrl,
    say: (line) => walk.events.push(`say: ${line}`),
    ask: async (question) => {
      walk.events.push(`ask: ${question}`);
      return typed;
    },
    pause: async () => undefined,
  };
}

const requestsOf = (walk: Walk) =>
  walk.events.filter((event) => !event.startsWith('say: ') && !event.startsWith('ask: '));

async function expectTheContract(walk: Walk): Promise<void> {
  for (const request of walk.requests) {
    const { refused } = await readRequest(request);
    expect(refused, `${request.method} ${request.url}`).toEqual([]);
  }
  expect(walk.answersRefused).toEqual([]);
}

describe('the quickstart', () => {
  it('takes the free steps alone, a quote and the offices, where it has no number or PDF', async () => {
    const { fetch, walk } = standIn();

    await quickstart(new XipFax({ apiKey: KEY, fetch }), inputFor(walk, 'send'));

    expect(requestsOf(walk)).toEqual(['GET /quote', 'GET /offices']);
    expect(walk.events.some((event) => event.startsWith('ask: '))).toBe(false);
    await expectTheContract(walk);
  });

  it('says the fax is real and charged, sends it only once send is typed, and follows it', async () => {
    const { fetch, walk } = standIn();

    await quickstart(new XipFax({ apiKey: KEY, fetch }), inputFor(walk, 'send', TO, PDF));

    expect(requestsOf(walk)).toEqual([
      'GET /quote',
      'GET /offices',
      'GET /draft',
      'POST /draft/documents',
      'GET /draft',
      'POST /draft/send',
      'GET /faxes/fax_1',
      'GET /faxes/fax_1',
      'GET /faxes/fax_1/confirmation',
    ]);
    const warned = walk.events.indexOf(`say: ${REAL_AND_CHARGED}`);
    const asked = walk.events.findIndex((event) => event.startsWith('ask: '));
    expect(warned).toBeGreaterThan(walk.events.indexOf('POST /draft/documents'));
    expect(asked).toBeGreaterThan(warned);
    expect(walk.events.indexOf('POST /draft/send')).toBeGreaterThan(asked);

    const send = walk.requests.find((request) => request.url.endsWith('/draft/send'))!;
    expect(await send.clone().json()).toEqual({ fax_number: TO, document_ids: ['doc_1'] });
    const keys = walk.requests
      .filter((request) => request.method === 'POST')
      .map((request) => request.headers.get('Idempotency-Key'));
    expect(new Set(keys).size).toBe(keys.length);
    await expectTheContract(walk);
  });

  it('sends nothing on any other answer, and takes its document back out of the draft', async () => {
    const { fetch, walk } = standIn();

    await quickstart(new XipFax({ apiKey: KEY, fetch }), inputFor(walk, 'no', TO, PDF));

    expect(requestsOf(walk)).toEqual([
      'GET /quote',
      'GET /offices',
      'GET /draft',
      'POST /draft/documents',
      'GET /draft',
      'DELETE /draft/documents/doc_1',
    ]);
    await expectTheContract(walk);
  });

  it('adds nothing to a draft that already holds documents', async () => {
    const { fetch, walk } = standIn([{ ...letter, id: 'doc_0' }]);

    await quickstart(new XipFax({ apiKey: KEY, fetch }), inputFor(walk, 'send', TO, PDF));

    expect(requestsOf(walk)).toEqual(['GET /quote', 'GET /offices', 'GET /draft']);
    await expectTheContract(walk);
  });
});
