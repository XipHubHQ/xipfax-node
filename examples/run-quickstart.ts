/**
 * Runs the quickstart in your terminal, on Node 22.18 or later, once `pnpm build` has built the SDK:
 *
 *   XIPFAX_API_KEY=xipfax_key_live_… node examples/run-quickstart.ts
 *
 * That takes the free steps alone. To send a fax too, real and charged, name a fax number of yours
 * and a public link to a PDF:
 *
 *   XIPFAX_TO='+1 202 555 0143' XIPFAX_PDF_URL=https://example.com/letter.pdf XIPFAX_API_KEY=… node examples/run-quickstart.ts
 */
import { createInterface } from 'node:readline/promises';
import { type ApiError, XipFax } from 'xipfax';
import { quickstart } from './quickstart.ts';

const apiKey = process.env.XIPFAX_API_KEY;
const to = process.env.XIPFAX_TO;
const pdfUrl = process.env.XIPFAX_PDF_URL;

if (!apiKey) {
  console.error(
    'Set XIPFAX_API_KEY to a key you made in the developer console: https://developer.xipfax.com/console/',
  );
  process.exit(1);
}

try {
  await quickstart(new XipFax({ apiKey }), {
    to,
    pdfUrl,
    say: (line) => console.log(line),
    ask: async (question) => {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await terminal.question(question);
      } finally {
        terminal.close();
      }
    },
    pause: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });
  if (!to || !pdfUrl) {
    console.log(
      'Those steps cost nothing. To send a fax too, run it again with XIPFAX_TO, a fax number of yours, and XIPFAX_PDF_URL, a public link to a PDF.',
    );
  }
} catch (error) {
  const refusal = (error as Partial<ApiError> | undefined)?.error;
  if (!refusal?.code) throw error;
  console.error(`XipFax refused it, ${refusal.code}: ${refusal.message}`);
  process.exitCode = 1;
}
