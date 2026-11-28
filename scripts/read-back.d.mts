/**
 * The types of read-back.mjs, for the specs that TypeScript checks; the script itself runs under
 * Node as JavaScript.
 */

/** The read-back's window, as release.json gives it. */
export interface ReadBackWindow {
  /** How long the read-back reads, in minutes. */
  forMinutes: number;
  /** How long it waits between two reads, in seconds. */
  everySeconds: number;
}

/** What npm answered a command: its exit status, and what it printed. */
export interface NpmAnswer {
  status: number | null;
  stdout: string;
}

/** What the read-back found: the pinned integrity, another, or none within the window. */
export type ReadBackResult =
  { found: 'pinned' } | { found: 'other'; integrity: string } | { found: 'none' };

/** The window in a parsed release.json; throws, naming the value, where one isn't positive. */
export function windowOf(config: unknown): ReadBackWindow;

/** The window in the release.json at `file`; throws where it can't be read, or a value isn't one. */
export function readWindow(file: string | URL): ReadBackWindow;

/** Reads the integrity npm's registry gives `spec`, within `window`, until it gives one. */
export function readBack(options: {
  spec: string;
  pinned: string;
  window: ReadBackWindow;
  npm: (args: string[]) => NpmAnswer;
  wait: (ms: number) => Promise<unknown>;
  say: (line: string) => void;
}): Promise<ReadBackResult>;
