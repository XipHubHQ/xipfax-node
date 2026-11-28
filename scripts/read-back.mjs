/**
 * The end of a publish to npm, which scripts/release.mjs runs once npm publish has succeeded: it
 * signs npm out, then reads the version's integrity back from the registry signed out, as anyone
 * can read a public package. npm's registry gives a version's integrity only once npm releases it.
 *
 * npm scans each new version before it releases it, which npm puts at "typically around five
 * minutes", and "up to 15 minutes or more, at peak times or depending on a package’s content and
 * size": https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/
 * So the read-back reads for as long as release.json's readBack window says, and says, the first
 * time the registry gives no integrity, that npm holds the version and what releases it. Signing
 * out first keeps no sign-in live for that long.
 */
import { readFileSync } from 'node:fs';

/**
 * The read-back's window in a parsed release.json: `forMinutes`, how long it reads, and
 * `everySeconds`, how long it waits between two reads, each a positive number. Throws, naming the
 * value, where one isn't.
 */
export function windowOf(config) {
  const given = config?.readBack;
  for (const name of ['forMinutes', 'everySeconds']) {
    const value = given?.[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `release.json's readBack.${name} is ${JSON.stringify(value) ?? 'missing'}, not a positive number.`,
      );
    }
  }
  return { forMinutes: given.forMinutes, everySeconds: given.everySeconds };
}

/** The read-back's window, from the release.json at `file`. Throws where it can't be read. */
export function readWindow(file) {
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`release.json can't be read as JSON: ${error.message}.`);
  }
  return windowOf(config);
}

/**
 * Reads the integrity npm's registry gives `spec`, by npm view, online, every `everySeconds` for
 * `forMinutes`, until it gives one. The first time it gives none, it says that npm holds the
 * version, what releases it, and how long the read-back reads. Answers `{ found: 'pinned' }` where
 * the integrity is `pinned`, `{ found: 'other', integrity }` where it is another, and
 * `{ found: 'none' }` where the registry gave none within the window.
 */
export async function readBack({ spec, pinned, window, npm, wait, say }) {
  const reads = Math.floor((window.forMinutes * 60) / window.everySeconds) + 1;
  for (let read = 1; read <= reads; read += 1) {
    const answer = npm(['view', spec, 'dist.integrity', '--prefer-online']);
    const integrity = answer.status === 0 ? answer.stdout.trim() : '';
    if (integrity === pinned) return { found: 'pinned' };
    if (integrity !== '') return { found: 'other', integrity };
    if (read === 1) {
      say(
        `npm holds ${spec} until its scan of the new version passes, then releases it itself: npm puts the scan at about five minutes, and at times 15 or more. Reading its integrity every ${window.everySeconds} seconds, for about ${window.forMinutes} minutes.`,
      );
    }
    if (read < reads) await wait(window.everySeconds * 1000);
  }
  return { found: 'none' };
}

/**
 * What a publish does once npm publish has succeeded: signs npm out, so that no sign-in stays live
 * while it reads, then reads the integrity back. Answers `{ ok: true, lines }`, the lines to print,
 * where npm gives the pinned integrity, and `{ ok: false, why }` where the publish refuses: where
 * npm logout fails, before any read; where npm gives another integrity; and where it gives none
 * within the window.
 */
export async function signOutThenReadBack({
  spec,
  pin,
  window,
  registry,
  account,
  npm,
  wait,
  say,
}) {
  const signedOut = npm(['logout'], { stdio: 'inherit' });
  if (signedOut.status !== 0) {
    return {
      ok: false,
      why: `npm published ${spec}, but npm logout failed, so nothing was read back: sign out with npm logout --registry ${registry}, then read it with npm view ${spec} dist.integrity --registry ${registry}.`,
    };
  }
  const read = await readBack({ spec, pinned: pin.integrity, window, npm, wait, say });
  if (read.found === 'other') {
    return {
      ok: false,
      why: `${spec} is on npm, and npm reads its integrity as ${read.integrity}, not the pinned ${pin.integrity}. npm is signed out: sign in with npm login --registry ${registry} for anything you then do on npm.`,
    };
  }
  if (read.found === 'none') {
    return {
      ok: false,
      why: `npm published ${spec} and holds it still: its registry gave no integrity for it in about ${window.forMinutes} minutes. npm may be holding it for review after its scan, or have blocked it, which it may tell ${account} of, with a way to appeal. npm is signed out: read it later with npm view ${spec} dist.integrity --registry ${registry}, which needs no sign-in.`,
    };
  }
  return {
    ok: true,
    lines: [
      `Published ${spec} from ${pin.commit}. npm reads its integrity back as pinned:`,
      `  ${pin.integrity}`,
      `npm is signed out of ${registry}.`,
    ],
  };
}
