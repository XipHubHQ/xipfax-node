import { randomUUID } from 'node:crypto';
import type { XipFax } from '@xiphub/xipfax-sdk';

/**
 * XipFax's quickstart through the SDK, the steps of
 * https://developer.xipfax.com/docs/guides/quickstart/ in their order. The free steps come first: a
 * quote, and the offices that take a form. Then, only where you name a fax number of yours and a
 * PDF, a real fax, charged, which it says before it sends, and sends only once you type `send`.
 * `run-quickstart.ts` runs it in your terminal.
 */

/** What the quickstart is given, and how it talks to you. */
export interface QuickstartInput {
  /** A fax number of yours, where the fax goes. Without it, only the free steps run. */
  to?: string | undefined;
  /** A public https link to a PDF, the fax's pages. Without it, only the free steps run. */
  pdfUrl?: string | undefined;
  /** Tells you a line. */
  say: (line: string) => void;
  /** Asks you a question, answering what you typed. */
  ask: (question: string) => Promise<string>;
  /** Waits between reads of the fax. */
  pause: (milliseconds: number) => Promise<void>;
}

/** How long the quickstart waits between reads of the fax, and how many it makes. */
const READ_EVERY_MS = 10_000;
const READS = 30;

/** The words the step that sends says first, as the docs' quickstart says them. */
export const REAL_AND_CHARGED =
  'This step sends a real fax, and it’s charged. It goes to the number you name, so name one of your own. Its pages count on your plan, or where you have no plan its price is held on the card you saved, and taken once it’s delivered. A fax that fails costs nothing.';

/**
 * The quickstart's steps. Each call names `throwOnError`, so the API's refusal stops it, thrown as
 * the API's own error, which `run-quickstart.ts` prints.
 */
export async function quickstart(xipfax: XipFax, input: QuickstartInput): Promise<void> {
  const { say } = input;

  // 1. What a fax costs. This costs nothing, and it shows your key works.
  const { data: quote } = await xipfax.getQuote({ query: { pages: 1 }, throwOnError: true });
  say(`A one-page fax costs ${quote.price_shown} without a plan: ${quote.terms}`);

  // 2. Where a form goes: the offices that take Form 2848 from Ohio, and their numbers. Also free.
  const { data: offices } = await xipfax.listOffices({
    query: { search: 'Form 2848', place: 'OH', limit: 3 },
    throwOnError: true,
  });
  for (const office of offices.data) {
    say(`${office.name} takes Form 2848 at ${office.fax_number}.`);
  }

  const { to, pdfUrl } = input;
  if (!to || !pdfUrl) return;

  // 3. Your draft, the fax you prepare. This sends only its own document, so it starts empty.
  const { data: before } = await xipfax.getDraft({ throwOnError: true });
  if (before.documents.length > 0) {
    say(
      'Your draft already holds documents. Send or remove them on xipfax.com first, so that this sends only its own.',
    );
    return;
  }

  // 4. Add the PDF by its link. Each POST names a key of its own, so a retry can't add it twice.
  const { data: added } = await xipfax.addDocument({
    headers: { 'Idempotency-Key': randomUUID() },
    body: { name: nameOf(pdfUrl), url: pdfUrl },
    throwOnError: true,
  });
  say(`Added ${added.document.name}${pagesOf(added.document.page_count)}.`);

  // 5. Send it, a real fax, charged: said first, and sent only once you type send.
  say(REAL_AND_CHARGED);
  const answer = await input.ask(`Type send to fax it to ${to}, or anything else to stop: `);
  if (answer.trim().toLowerCase() !== 'send') {
    await xipfax.removeDocument({ path: { document_id: added.document.id }, throwOnError: true });
    say('Nothing was sent, and the document is out of your draft again.');
    return;
  }
  // The send names the documents to send: the one this added, alone. A draft whose documents
  // aren't these is refused, so that nothing you didn't name is sent.
  const { data: sent } = await xipfax.sendDraft({
    headers: { 'Idempotency-Key': randomUUID() },
    body: { fax_number: to, document_ids: [added.document.id] },
    throwOnError: true,
  });
  if (sent.confirm_url) {
    say(`Nothing was sent or held: the fax waits for you on xipfax.com, ${sent.confirm_url}`);
    return;
  }
  say(`Sent, paid by ${sent.paid_by}: fax ${sent.fax.id}.`);

  // 6. Follow the fax until it's delivered or fails, then read its confirmation.
  let fax = sent.fax;
  let shown = '';
  for (
    let read = 0;
    read < READS && fax.status !== 'delivered' && fax.status !== 'failed';
    read++
  ) {
    await input.pause(READ_EVERY_MS);
    ({ data: fax } = await xipfax.getFax({ path: { fax_id: fax.id }, throwOnError: true }));
    const now = fax.step ? `${fax.status}: ${fax.step}` : fax.status;
    if (now !== shown) say(now);
    shown = now;
  }
  if (fax.status === 'delivered') {
    const { data: confirmation } = await xipfax.getConfirmation({
      path: { fax_id: fax.id },
      throwOnError: true,
    });
    say(`Its confirmation, readable for a few minutes: ${confirmation.url}`);
  } else if (fax.status === 'failed') {
    say(`It failed, ${fax.failure}, so it costs nothing.`);
  } else {
    say(
      `It's still ${fax.status}. Read it later: xipfax.getFax({ path: { fax_id: '${fax.id}' } }).`,
    );
  }
}

/** The PDF's name, as its link ends: `letter.pdf`. */
function nameOf(link: string): string {
  const last = new URL(link).pathname.split('/').filter(Boolean).pop() ?? 'document.pdf';
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // A link whose name isn't percent-encoded text keeps it as it is.
  }
  return name.slice(0, 255);
}

/** A document's pages, once XipFax has counted them. */
function pagesOf(count: number | null): string {
  if (count === null) return '';
  return count === 1 ? ', 1 page' : `, ${count} pages`;
}
