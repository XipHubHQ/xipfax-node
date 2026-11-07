import { defineConfig } from '@hey-api/openapi-ts';

/**
 * The SDK, generated from the API's document as this repository holds it, `openapi.json`: its
 * types, its fetch client, and one class whose methods are the document's operations, each named
 * by its operation id. `pnpm generate` runs it; nothing in `src/client` is edited by hand.
 */
export default defineConfig({
  input: './openapi.json',
  output: 'src/client',
  parser: {
    // The document also describes the events XipFax will send to an endpoint of yours. No
    // endpoint can be registered yet, so the SDK leaves them out until one can, and with them the
    // components only they use, which `orphans: false` drops: the generator drops none unless a
    // filter is named.
    patch: (spec) => {
      if ('webhooks' in spec) delete spec.webhooks;
    },
    filters: { orphans: false },
  },
  plugins: [
    '@hey-api/client-fetch',
    {
      name: '@hey-api/typescript',
      // The document's `Error` schema becomes `ApiError`, so that importing it never hides the
      // global `Error`.
      definitions: (name) => (name === 'Error' ? 'ApiError' : name),
    },
    {
      name: '@hey-api/sdk',
      operations: {
        strategy: 'single',
        containerName: 'XipFaxApi',
        methods: 'instance',
        // Names each method by the document's own operation id, `sendDraft`; `'id'` would name it
        // by its method and path, `postDraftSend`. No id holds a dot or a slash, so none nests.
        nesting: 'operationId',
      },
    },
  ],
});
