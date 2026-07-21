import path from 'node:path';
import { realpathSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// See vite.config.ts for why this is realpath.native'd.
const TRACKER_DIR = realpathSync.native(__dirname);
const HH_DIR = path.resolve(TRACKER_DIR, '..');

export default defineConfig({
  root: TRACKER_DIR,
  resolve: { alias: { '@hh': path.join(HH_DIR, 'src') } },
  test: {
    // The ported suite lives beside the code it tests (src/**), which is where the original app
    // kept it — including the two files that lock down the rules-sensitive maths (encounter XP
    // budget, condition typed-stacking). `test/` is kept for tracker-specific additions.
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
});
