import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Rules tests are pure TS and run in node. A handful of DISPLAY tests render real components in
// jsdom (`// @vitest-environment jsdom` at the top of the file, and a .test.tsx extension) — the
// app's dominant defect class is "the value is computed correctly and no surface shows it", and a
// suite that never renders anything is blind to every one of them. Tests live in test/ (outside
// src/) so the app build (tsc -b on src/) never compiles them.
export default defineConfig({
  // Mirror the app build's version injection (vite.config.ts) so src/version.ts works under tests.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
  },
});
