import { API_VERSION } from './api-version.gen.js';
import { createClient, createConfig } from './client/client/index.js';
import { client as documentClient } from './client/client.gen.js';
import { XipFaxApi } from './client/sdk.gen.js';

export { API_VERSION };
export type * from './client/types.gen.js';

/** What `new XipFax()` takes. */
export interface XipFaxOptions {
  /** Your API key, `xipfax_key_live_…`, made in the developer console. Keep it on your server. */
  apiKey: string;
  /** Where the API answers: `https://api.xipfax.com` unless you name another. */
  baseUrl?: string;
  /** The fetch each request is sent with: the runtime's own unless you give one. */
  fetch?: typeof fetch;
}

/**
 * XipFax's API, one method for each operation its document names. Each request carries your key
 * and the version of the API this SDK was generated from, `API_VERSION`.
 *
 * ```ts
 * const xipfax = new XipFax({ apiKey: process.env.XIPFAX_API_KEY! });
 * const { data, error } = await xipfax.getQuote({ query: { pages: 3 } });
 * ```
 */
export class XipFax extends XipFaxApi {
  constructor(options: XipFaxOptions) {
    if (typeof options?.apiKey !== 'string' || !options.apiKey.trim()) {
      throw new TypeError(
        'XipFax needs your API key: new XipFax({ apiKey }). Make one in the developer console, https://developer.xipfax.com/console/.',
      );
    }
    super({
      client: createClient(
        createConfig({
          auth: options.apiKey,
          baseUrl: options.baseUrl ?? documentClient.getConfig().baseUrl,
          fetch: options.fetch,
          headers: { 'Xip-Version': API_VERSION },
        }),
      ),
    });
  }
}
