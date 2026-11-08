import { defineConfig } from '@hey-api/openapi-ts';

/**
 * The SDK, generated from the API's document as this repository holds it, `openapi.json`: its
 * types, each event XipFax posts to an endpoint of yours among them, its fetch client, and one
 * class whose methods are the document's operations, each named by its operation id.
 * `pnpm generate` runs it; nothing in `src/client` is edited by hand.
 */
export default defineConfig({
  input: './openapi.json',
  output: 'src/client',
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
