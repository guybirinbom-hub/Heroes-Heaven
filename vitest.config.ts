import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Engine/rules tests only — pure TS, no DOM. The React UI isn't unit-tested here;
// it's verified via the live preview. Tests live in test/ (outside src/) so the
// app build (tsc -b on src/) never compiles them.
export default defineConfig({
  // Mirror the app build's version injection (vite.config.ts) so src/version.ts works under tests.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
