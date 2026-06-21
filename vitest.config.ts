import { defineConfig } from 'vitest/config';

// Engine/rules tests only — pure TS, no DOM. The React UI isn't unit-tested here;
// it's verified via the live preview. Tests live in test/ (outside src/) so the
// app build (tsc -b on src/) never compiles them.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
