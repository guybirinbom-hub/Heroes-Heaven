/*
 * THE PC UI CHECKS, UNDER THE HEAVY-JOB LOCK (docs/ui-tests.md).
 *
 *   node scripts/ui-test.mjs visual      # screenshot comparisons     (npm run test:visual)
 *   node scripts/ui-test.mjs contrast    # axe color-contrast ratchet (npm run test:contrast)
 *   node scripts/ui-test.mjs all         # both                       (npm run test:ui)
 *   node scripts/ui-test.mjs visual --update-snapshots   # extra args go straight to Playwright
 *
 * They drive a real browser against the Vite dev server, which is exactly the kind of load that makes
 * this machine's vitest start zero tests and exit 0 (scripts/lib/heavy-lock.mjs). So they take the same
 * lock as scripts/vt.mjs and never run beside vitest or a batch stage. The exit code is Playwright's own.
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHeavyLock } from './lib/heavy-lock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = { visual: ['screens.spec.ts'], contrast: ['contrast.spec.ts'], all: [] };
const [which = 'all', ...rest] = process.argv.slice(2);
if (!(which in SPECS)) {
  console.error(`ui-test: unknown suite "${which}" — use visual, contrast or all`);
  process.exit(2);
}
// Playwright's own CLI run by this node, with NO shell: through a shell, `-g "sheet — midnight"` split on
// its spaces (and ran the whole suite) and a `|` in a grep became a pipe.
const CLI = join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const args = [CLI, 'test', '--config', 'e2e/visual/playwright.config.ts', ...SPECS[which], ...rest];

const code = await withHeavyLock(`ui-test ${which} ${rest.join(' ')}`.trim().slice(0, 120), () => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  return r.status ?? 1;
});
process.exit(code);
