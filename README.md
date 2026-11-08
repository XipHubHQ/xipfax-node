# XipFax for TypeScript and JavaScript

Send faxes from your code with [XipFax](https://xipfax.com): quote a fax, add your PDFs, send them to a
number or a government office, and follow each fax until it's delivered. The SDK is generated from
the API's own document, so its methods and types are the API's. It runs on Node.js 18 or later, and
anywhere else with `fetch`.

> **Not on npm yet.** XipFax publishes it as `@xiphub/xipfax-sdk` with its first release. Until then
> you can build it from this repository, as [the quickstart](#the-quickstart) does.

## Make an API key

Sign in to the [developer console](https://developer.xipfax.com/console/), open API keys and make a
key. You see it whole just once, so copy it then. Every key is live: what it sends is real.

Keep the key on your server. A key in a web page or an app is anyone's.

## Use it

```ts
import { XipFax } from '@xiphub/xipfax-sdk';

const xipfax = new XipFax({ apiKey: process.env.XIPFAX_API_KEY! });

const { data, error } = await xipfax.getQuote({ query: { pages: 3 } });
if (error) throw new Error(`${error.error.code}: ${error.error.message}`);
console.log(`${data.price_shown}: ${data.terms}`);
```

Each method takes what its request carries, as the [API reference](https://developer.xipfax.com/docs/api/)
names it: `path`, `query`, `headers` and `body`. It answers `{ data, error, response }`: `data` where
the API did what you asked, `error` where it refused, the API's error object, whose `code` is the one
to branch on. A request that never reached XipFax answers the `Error` `fetch` threw.

Name `throwOnError` where you'd rather have the refusal thrown:

```ts
const { data: plan } = await xipfax.getPlan({ throwOnError: true });
```

## The quickstart

[`examples/quickstart.ts`](examples/quickstart.ts) takes the steps of
[XipFax's quickstart](https://developer.xipfax.com/docs/guides/quickstart/) through the SDK. Run it
on Node.js 22.18 or later, which runs TypeScript as it is:

```sh
pnpm install
pnpm build
XIPFAX_API_KEY=xipfax_key_live_… node examples/run-quickstart.ts
```

That takes the free steps alone: what a fax costs, and the offices that take Form 2848 from Ohio,
with their fax numbers.

To send a fax too, name a fax number of yours and a public https link to a PDF:

```sh
XIPFAX_TO='+1 202 555 0143' XIPFAX_PDF_URL=https://example.com/letter.pdf \
  XIPFAX_API_KEY=xipfax_key_live_… node examples/run-quickstart.ts
```

**That step sends a real fax, and it's charged.** Its pages count on your plan, or where you have no
plan its price is held on the card you saved, and taken once it's delivered. A fax that fails costs
nothing. The quickstart says so before it sends, and sends only once you type `send`. Then it
follows the fax until it's delivered, and gives the link to its confirmation.

## Methods

| Method             | Request                                        | What it does                                                               |
| ------------------ | ---------------------------------------------- | -------------------------------------------------------------------------- |
| `getQuote`         | `GET /quote`                                   | The price of a fax of so many pages, sent without a plan.                  |
| `getDraft`         | `GET /draft`                                   | Your draft, the fax you prepare, its documents in the order it sends them. |
| `addDocument`      | `POST /draft/documents`                        | Adds a PDF to the draft, by a link XipFax fetches or by an upload.         |
| `completeDocument` | `POST /draft/documents/{document_id}/complete` | Reads an uploaded PDF back, its pages counted.                             |
| `removeDocument`   | `DELETE /draft/documents/{document_id}`        | Takes a document out of the draft.                                         |
| `sendDraft`        | `POST /draft/send`                             | Sends the draft to a number or an office.                                  |
| `listFaxes`        | `GET /faxes`                                   | The faxes you sent and received, newest first, a page at a time.           |
| `getFax`           | `GET /faxes/{fax_id}`                          | A fax, where it stands now.                                                |
| `getConfirmation`  | `GET /faxes/{fax_id}/confirmation`             | A delivered fax's confirmation, by a link that reads it for a few minutes. |
| `getPlan`          | `GET /plan`                                    | Your plan, or none.                                                        |
| `listOffices`      | `GET /offices`                                 | The government offices XipFax gives the fax numbers of.                    |

### Upload a PDF from your disk

Give its size, send its bytes to the link the answer gives, then complete it:

```ts
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const bytes = await readFile('letter.pdf');
const { data: added } = await xipfax.addDocument({
  headers: { 'Idempotency-Key': randomUUID() },
  body: { name: 'letter.pdf', size_bytes: bytes.length },
  throwOnError: true,
});
const upload = await fetch(added.upload!.url, {
  method: 'PUT',
  headers: added.upload!.headers,
  body: bytes,
});
if (!upload.ok) throw new Error(`The upload failed: ${upload.status}`);
await xipfax.completeDocument({
  headers: { 'Idempotency-Key': randomUUID() },
  path: { document_id: added.document.id },
  throwOnError: true,
});
```

## Retries and `Idempotency-Key`

`addDocument`, `completeDocument` and `sendDraft` take an `Idempotency-Key` of your own, such as a
UUID, which you keep with the request. Sent again with the same key within 24 hours, the request is
answered as it was the first time rather than done twice, so a retry after a timeout can't send a fax
twice. The SDK makes up no key itself: one it made would be new on each try, and protect nothing.

The answer to a request sent again keeps none of its signed links: `upload`, and a document's `url`,
come back null. So an upload that `addDocument` gave, asked for again with its key, has no link to
send the bytes to. Take that document out with `removeDocument`, and add it again with a new key.

## Versions

Each request names the version of the API the SDK was generated from, `API_VERSION`, in its
`Xip-Version` header, so each answer keeps the shape the SDK's types describe.

## Where the SDK comes from

`openapi.json` is the API's document, as [api.xipfax.com](https://api.xipfax.com/openapi.json) gives
it, and `pnpm generate` makes the SDK from it with
[`@hey-api/openapi-ts`](https://heyapi.dev): its types, its client and one class whose methods are
the document's operations. Nothing in `src/client` is edited by hand. To update the SDK, copy the new
document over `openapi.json`, run `pnpm generate`, and commit what changes.

The document also describes the events XipFax will send to an endpoint of yours. No endpoint can be
registered yet, so the SDK leaves them out until one can.

## Help

Write to [support@xipfax.com](mailto:support@xipfax.com).

## License

[MIT](LICENSE). The client that `pnpm generate` copies in from `@hey-api/openapi-ts` keeps its own
MIT notice, in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
