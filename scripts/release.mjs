#!/usr/bin/env node
/**
 * The SDK's release to npm's own registry, in two runs, so that the one a person types does nothing
 * slow.
 *
 *   scripts/release.mjs --check <commit>   builds the package as the commit holds it, in a clone of
 *                                          its own: installed from the lockfile, gated, its specs run
 *                                          and packed, with what it holds checked. It keeps the
 *                                          tarball, with the commit and the tarball's integrity
 *                                          pinned beside it.
 *   scripts/release.mjs [<code>]           publishes the kept tarball, run from a checkout of the
 *                                          pinned commit, with the six-digit code of npm's second
 *                                          factor from an authenticator.
 *
 * An authenticator's code lasts about 30 seconds, so a publish only checks: that this checkout is the
 * pinned commit, unchanged, so that the script running is the one the commit holds; that the kept
 * tarball has the pinned integrity; that npm is signed in as the account that publishes; and that
 * this version isn't on npm yet. It then publishes that tarball at once, reads its integrity back
 * from the registry, and signs npm out. Without a code, npm asks for its second factor itself, as a
 * security key needs: run it in a terminal then.
 *
 * Every npm call names npm's own registry, whatever registry the machine names. The tarball and its
 * pin are kept in the clone's git directory, in xipfax-npm/, which no commit holds and every worktree
 * of the clone shares. A check's steps write to a log, which a failure names.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

/** npm's own registry, which every npm call names. */
const REGISTRY = 'https://registry.npmjs.org/';
/** The npm account that publishes the package, of the organization xiphub. */
const ACCOUNT = 'xiphubhq';
/** What npm packs beside dist/: package.json, the README and the license, and the notices "files" names. */
const BESIDE_DIST = ['LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.md', 'package.json'];
/** How long a publish waits for the registry to give the version back: 12 reads, 5 seconds apart. */
const READS = 12;
const READ_EVERY_MS = 5_000;

/** Stops with why, on stderr, and exit 1. */
function refuse(why) {
  process.stderr.write(`release: ${why}\n`);
  process.exit(1);
}

/** git's answer in the folder given, trimmed, or a refusal naming the command. */
function git(folder, ...args) {
  const answer = spawnSync('git', ['-C', folder, ...args], { encoding: 'utf8' });
  if (answer.status !== 0) refuse(`git ${args.join(' ')} failed: ${answer.stderr.trim()}`);
  return answer.stdout.trim();
}

const repo = git(dirname(fileURLToPath(import.meta.url)), 'rev-parse', '--show-toplevel');
const keep = join(
  git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
  'xipfax-npm',
);
const pinFile = join(keep, 'pin.json');

/** The sha-512 integrity of a file, as npm gives a tarball's. */
function integrityOf(file) {
  return `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`;
}

/** npm's answer on its own registry, from this checkout, so that no other folder's .npmrc reaches it. */
function npm(args, options = {}) {
  return spawnSync('npm', [...args, '--registry', REGISTRY], {
    cwd: repo,
    encoding: 'utf8',
    ...options,
  });
}

/** Whether the registry holds the version, by npm's own answer: E404 where it doesn't. */
function isOnNpm(spec) {
  const answer = npm(['view', spec, 'version', '--json', '--prefer-online']);
  if (answer.status === 0) return true;
  let code;
  try {
    code = JSON.parse(answer.stdout).error?.code;
  } catch {
    code = undefined;
  }
  if (code === 'E404') return false;
  return refuse(`npm couldn't say whether ${spec} is on npm: ${answer.stderr.trim()}`);
}

/** Builds, checks and packs the commit, and keeps the tarball with its pin. */
function check(ref) {
  const verify = ['-C', repo, 'rev-parse', '-q', '--verify', `${ref}^{commit}`];
  const resolved = spawnSync('git', verify, { encoding: 'utf8' });
  if (resolved.status !== 0) refuse(`${ref} names no commit; nothing was kept`);
  const commit = resolved.stdout.trim();
  const manifest = JSON.parse(git(repo, 'show', `${commit}:package.json`));
  const spec = `${manifest.name}@${manifest.version}`;
  if (isOnNpm(spec)) refuse(`${spec} is on npm already: its version moves first; nothing was kept`);

  const work = mkdtempSync(join(tmpdir(), 'xipfax-npm-'));
  process.on('exit', () => rmSync(work, { recursive: true, force: true, maxRetries: 3 }));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));
  const log = join(tmpdir(), 'xipfax-npm-check.log');
  const out = openSync(log, 'w');
  const tree = join(work, 'tree');
  // Runs one step with its output in the log, and names the step and the log where it fails.
  const step = (name, command, args, cwd = tree) => {
    writeSync(out, `== ${name}\n`);
    const ran = spawnSync(command, args, { cwd, stdio: ['ignore', out, out] });
    if (ran.status !== 0) refuse(`${name} failed; its output is in ${log}`);
  };

  // A clone of its own at the commit, since the gate reads git's status of what it generates.
  step('the clone', 'git', ['clone', '-q', '--no-checkout', repo, tree], work);
  step('the checkout', 'git', ['-C', tree, 'checkout', '-q', '--detach', commit], work);
  step('the install', 'pnpm', ['install', '--frozen-lockfile', '--prefer-offline']);
  step('the gate', join(tree, 'scripts', 'gates.sh'), []);
  step('the specs', 'pnpm', ['test', '--maxWorkers=2']);
  // The gate built dist/, so the pack runs no script, and npm answers with its JSON alone.
  writeSync(out, '== the pack\n');
  const pack = ['pack', '--json', '--ignore-scripts', '--pack-destination', work];
  const packed = spawnSync('npm', [...pack, '--registry', REGISTRY], {
    cwd: tree,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', out],
  });
  if (packed.status !== 0) refuse(`the pack failed; its output is in ${log}`);
  const [answer] = JSON.parse(packed.stdout);
  if (`${answer.name}@${answer.version}` !== spec) {
    refuse(
      `npm packed ${answer.name}@${answer.version}, and package.json is ${spec}; nothing was kept`,
    );
  }
  const paths = answer.files.map((file) => file.path);
  const stray = paths.filter((path) => !path.startsWith('dist/') && !BESIDE_DIST.includes(path));
  const lacking = [...BESIDE_DIST, 'dist/index.js', 'dist/index.d.ts'].filter(
    (path) => !paths.includes(path),
  );
  if (stray.length > 0 || lacking.length > 0) {
    refuse(
      `the package holds ${stray.join(', ') || 'nothing more'} and lacks ${lacking.join(', ') || 'nothing'} of what it should; nothing was kept`,
    );
  }
  const packedFile = join(work, answer.filename);
  const integrity = integrityOf(packedFile);
  if (integrity !== answer.integrity) {
    refuse(
      `npm gives the tarball ${answer.integrity}, and it reads ${integrity}; nothing was kept`,
    );
  }

  mkdirSync(keep, { recursive: true });
  copyFileSync(packedFile, join(keep, answer.filename));
  const pin = {
    commit,
    name: answer.name,
    version: answer.version,
    file: answer.filename,
    integrity,
  };
  writeFileSync(`${pinFile}.new`, `${JSON.stringify(pin, null, 2)}\n`);
  renameSync(`${pinFile}.new`, pinFile);

  console.log(`Kept ${spec}, packed from ${commit}, at ${join(keep, answer.filename)}:`);
  console.log(`  integrity ${integrity}`);
  console.log(
    `  ${answer.entryCount} files, ${answer.size} bytes packed, ${answer.unpackedSize} unpacked:`,
  );
  for (const file of answer.files) console.log(`    ${file.path}  ${file.size}`);
  console.log(`Publish it from a checkout of ${commit}: scripts/release.mjs <code>`);
}

/** Publishes the kept tarball, reads its integrity back, and signs npm out. */
async function publish(code) {
  if (!existsSync(pinFile)) {
    refuse('no check run has kept a tarball: run scripts/release.mjs --check <commit> first');
  }
  const pin = JSON.parse(readFileSync(pinFile, 'utf8'));
  const spec = `${pin.name}@${pin.version}`;
  const head = git(repo, 'rev-parse', 'HEAD');
  if (head !== pin.commit) {
    refuse(
      `this checkout is at ${head}, and the kept tarball is ${pin.commit}'s: run this from a checkout of ${pin.commit}. Nothing was published.`,
    );
  }
  if (git(repo, 'status', '--porcelain', '--untracked-files=no') !== '') {
    refuse(
      `this checkout has changes, so the script running is not ${pin.commit}'s. Nothing was published.`,
    );
  }
  const tarball = join(keep, pin.file);
  if (!existsSync(tarball) || integrityOf(tarball) !== pin.integrity) {
    refuse(
      `the kept tarball is not the one its check run pinned, ${pin.integrity}. Nothing was published.`,
    );
  }
  const signedIn = npm(['whoami']);
  if (signedIn.status !== 0) {
    refuse(
      `npm is signed out of ${REGISTRY}: sign in with npm login --registry ${REGISTRY}, then run this again. Nothing was published.`,
    );
  }
  const account = signedIn.stdout.trim();
  if (account !== ACCOUNT) {
    refuse(`npm is signed in as ${account}, not ${ACCOUNT}. Nothing was published.`);
  }
  if (isOnNpm(spec)) refuse(`${spec} is on npm already. Nothing was published.`);

  const env = code === undefined ? process.env : { ...process.env, npm_config_otp: code };
  const published = npm(['publish', tarball, '--access', 'public', '--ignore-scripts'], {
    env,
    stdio: 'inherit',
  });
  if (published.status !== 0) {
    refuse(
      'npm publish failed, as npm says above; npm stays signed in, for another try with a new code.',
    );
  }

  for (let read = 1; read <= READS; read += 1) {
    const answer = npm(['view', spec, 'dist.integrity', '--prefer-online']);
    const integrity = answer.status === 0 ? answer.stdout.trim() : '';
    if (integrity === pin.integrity) {
      const signedOut = npm(['logout'], { stdio: 'inherit' });
      if (signedOut.status !== 0) {
        refuse(
          `${spec} is on npm as pinned, but npm logout failed: sign out with npm logout --registry ${REGISTRY}.`,
        );
      }
      console.log(`Published ${spec} from ${pin.commit}. npm reads its integrity back as pinned:`);
      console.log(`  ${pin.integrity}`);
      console.log(`npm is signed out of ${REGISTRY}.`);
      return;
    }
    if (integrity !== '') {
      refuse(
        `${spec} is on npm, and npm reads its integrity as ${integrity}, not the pinned ${pin.integrity}. npm stays signed in: sign out with npm logout --registry ${REGISTRY}.`,
      );
    }
    await sleep(READ_EVERY_MS);
  }
  refuse(
    `npm published ${spec}, but its registry gave no integrity for it within a minute. npm stays signed in: read it with npm view ${spec} dist.integrity --registry ${REGISTRY}, then sign out with npm logout --registry ${REGISTRY}.`,
  );
}

const [first, second, ...rest] = process.argv.slice(2);
if (first === '--check' && second !== undefined && rest.length === 0) check(second);
else if (first === undefined) await publish(undefined);
else if (/^\d{6}$/.test(first) && second === undefined) await publish(first);
else
  refuse('usage: scripts/release.mjs --check <commit>, or scripts/release.mjs [<six-digit code>]');
