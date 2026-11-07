/**
 * Every spec runs with no credential, on every machine. Vitest runs this before any spec file
 * loads (`vitest.config.ts`): anything in the environment shaped like a credential, or named for
 * XipFax, goes. The day a real key sits in a developer's shell, a spec that could reach the API
 * still has nothing to reach it with, and `no-credentials.spec.ts` keeps saying so.
 */

/** Names that are a secret in themselves, in any case. */
const SECRET =
  /(TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|APIKEY|API_KEY|_KEY$|_KEYS$|COOKIE|PRIVATE)/i;

/** Names XipFax's own examples read, such as XIPFAX_API_KEY. */
const XIPFAX = /^XIPFAX_/i;

/** True where a spec process has no business carrying the variable. */
export function credentialShaped(name: string): boolean {
  return SECRET.test(name) || XIPFAX.test(name);
}

/** Removes every such variable from `env`, answering the names it removed. */
export function strip(env: Record<string, string | undefined>): string[] {
  const removed = Object.keys(env).filter(credentialShaped);
  for (const name of removed) delete env[name];
  return removed;
}

strip(process.env);
