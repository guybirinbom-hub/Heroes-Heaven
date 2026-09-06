/*
 * VITEST, UNDER THE HEAVY-JOB LOCK.
 *
 * docs/wg-batch-pipeline.md §B: "`scripts/vt.mjs <vitest args>` — takes the exclusive heavy-job lock,
 * then spawns vitest. Every RULES block says `node scripts/vt.mjs …`, never `npx vitest`; the driver's
 * suite and experience stages take the same lock."
 *
 * The reason is one measured failure: under load this machine's vitest cannot start its forks worker,
 * reports zero tests and exits 0 — a green run that ran nothing. Agents working a batch in parallel
 * are exactly that load. Serialising every vitest invocation through one lock costs wall-clock and
 * removes the whole class.
 *
 *   node scripts/vt.mjs                              # the full suite
 *   node scripts/vt.mjs test/batch29-data.test.ts    # one file
 *   node scripts/vt.mjs run test/x.test.ts --reporter=dot
 *
 * The exit code is vitest's own.
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHeavyLock } from './lib/heavy-lock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
/* `run` is implied: this is a batch tool, never a watcher. A caller who passes it keeps it. */
const args = argv[0] === 'run' ? argv : ['run', ...argv];

const code = await withHeavyLock(`vitest ${args.join(' ')}`.slice(0, 120), () => {
  const r = spawnSync('npx', ['vitest', ...args], { cwd: ROOT, stdio: 'inherit', shell: true });
  return r.status ?? 1;
});
process.exit(code);
