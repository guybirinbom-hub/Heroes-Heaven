/*
 * REDESIGN REFERENCE PICTURES, UNDER THE HEAVY-JOB LOCK.
 *
 *   node scripts/redesign-capture.mjs        # extra args go straight to Playwright
 *
 * Photographs today's sheet with the full test character (e2e/visual/redesign-sheet.capture.ts) into
 * C:\trying ai 2\hh-redesign-references\today-sheet-champion\. A browser on the dev server is the load
 * that makes vitest start zero tests (scripts/lib/heavy-lock.mjs), so it waits for the same lock as
 * scripts/ui-test.mjs and scripts/vt.mjs. Not a check: it compares nothing.
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHeavyLock } from './lib/heavy-lock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const rest = process.argv.slice(2);
const args = [CLI, 'test', '--config', 'e2e/visual/redesign-capture.config.ts', ...rest];

const code = await withHeavyLock(`redesign-capture ${rest.join(' ')}`.trim().slice(0, 120), () => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  return r.status ?? 1;
});
process.exit(code);
