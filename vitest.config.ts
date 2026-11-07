import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The examples import the SDK by its name, as you would; their specs read it from the source.
    alias: [
      {
        find: /^@xiphub\/xipfax-sdk$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['test/**/*.spec.ts'],
    // Before any spec file loads: the environment loses every credential (test/no-credentials.ts).
    setupFiles: ['./test/no-credentials.ts'],
  },
});
