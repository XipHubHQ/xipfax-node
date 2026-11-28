import { describe, expect, it } from 'vitest';
import {
  type NpmAnswer,
  type ReadBackWindow,
  readBack,
  readWindow,
  windowOf,
} from '../scripts/read-back.mjs';

/**
 * The read-back of a publish (scripts/read-back.mjs), against a stand-in for npm: it reads the
 * version's integrity until npm's registry gives one, for as long as its window says, and says
 * once, when the registry first gives none, that npm holds the version.
 */

const SPEC = '@xiphub/xipfax-sdk@0.1.1';
const PINNED = 'sha512-the-pinned-integrity';
/** Five reads: at 0, 30, 60, 90 and 120 seconds. */
const WINDOW: ReadBackWindow = { forMinutes: 2, everySeconds: 30 };

/**
 * The read-back, against a stand-in for npm that gives each read the integrity `answers` holds in
 * turn, and none where it holds '' or has run out, as npm view does for a version it can't find.
 */
async function run(answers: string[]) {
  const reads: string[][] = [];
  const waits: number[] = [];
  const said: string[] = [];
  const npm = (args: string[]): NpmAnswer => {
    reads.push(args);
    const integrity = answers[reads.length - 1] ?? '';
    return integrity === '' ? { status: 1, stdout: '' } : { status: 0, stdout: `${integrity}\n` };
  };
  const result = await readBack({
    spec: SPEC,
    pinned: PINNED,
    window: WINDOW,
    npm,
    wait: async (ms) => {
      waits.push(ms);
    },
    say: (line) => {
      said.push(line);
    },
  });
  return { result, reads, waits, said };
}

describe('the read-back of a publish', () => {
  it('reads the integrity by npm view, online, and answers at once where it is the pin’s', async () => {
    const { result, reads, waits, said } = await run([PINNED]);

    expect(result).toEqual({ found: 'pinned' });
    expect(reads).toEqual([['view', SPEC, 'dist.integrity', '--prefer-online']]);
    expect(waits).toEqual([]);
    expect(said).toEqual([]);
  });

  it('says once that npm holds the version, and reads it every everySeconds until the pin’s comes', async () => {
    const { result, reads, waits, said } = await run(['', '', PINNED]);

    expect(result).toEqual({ found: 'pinned' });
    expect(reads).toHaveLength(3);
    expect(waits).toEqual([30_000, 30_000]);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(SPEC);
    expect(said[0]).toContain('30 seconds');
    expect(said[0]).toContain('2 minutes');
  });

  it('answers another integrity at once, and reads no more', async () => {
    const { result, reads, waits } = await run(['', 'sha512-another-integrity']);

    expect(result).toEqual({ found: 'other', integrity: 'sha512-another-integrity' });
    expect(reads).toHaveLength(2);
    expect(waits).toEqual([30_000]);
  });

  it('reads through its whole window, then answers that the registry gave none', async () => {
    const { result, reads, waits, said } = await run([]);

    expect(result).toEqual({ found: 'none' });
    expect(reads).toHaveLength(5);
    expect(waits).toEqual([30_000, 30_000, 30_000, 30_000]);
    expect(said).toHaveLength(1);
  });
});

describe('the read-back’s window', () => {
  it('in release.json outlasts the 15 minutes npm gives its scan of a new version at peak times', () => {
    // npm puts its scan at "typically around five minutes", and "up to 15 minutes or more, at peak
    // times": https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/
    const window = readWindow(new URL('../scripts/release.json', import.meta.url));

    expect(window.forMinutes).toBeGreaterThanOrEqual(15);
    expect(window.everySeconds).toBeLessThan(window.forMinutes * 60);
  });

  it('refuses a value that is missing, zero, negative or not a number, naming it', () => {
    expect(() => windowOf({})).toThrow('readBack.forMinutes is missing');
    expect(() => windowOf({ readBack: { forMinutes: 30 } })).toThrow(
      'readBack.everySeconds is missing',
    );
    expect(() => windowOf({ readBack: { forMinutes: 0, everySeconds: 15 } })).toThrow(
      'readBack.forMinutes is 0',
    );
    expect(() => windowOf({ readBack: { forMinutes: 30, everySeconds: -15 } })).toThrow(
      'readBack.everySeconds is -15',
    );
    expect(() => windowOf({ readBack: { forMinutes: '30', everySeconds: 15 } })).toThrow(
      'readBack.forMinutes is "30"',
    );
  });
});
