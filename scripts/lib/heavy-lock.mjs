/*
 * THE HEAVY-JOB LOCK — one expensive job on this machine at a time.
 *
 * WHY THIS EXISTS. docs/wg-batch-pipeline.md §B: "`scripts/vt.mjs <vitest args>` — takes the exclusive
 * heavy-job lock, then spawns vitest … the driver's suite and experience stages take the same lock",
 * and §A: every driver stage "takes the heavy-job lock (`work/.heavy.lock`, waited on, never failed
 * on)".
 *
 * The failure it guards is already in the record: the experience harness renders the real Builder in
 * jsdom, and under load vitest fails to start its forks worker ("[vitest-pool]: Failed to start forks
 * worker"), reports zero tests, exits 0 and leaves the PREVIOUS raw file in place — batch 27's re-sweep
 * returned the baseline verdicts verbatim that way, with every data row already applied. Two heavy jobs
 * at once IS the load, so they are serialised here rather than diagnosed again later.
 *
 * WAITED ON, NEVER FAILED ON. A live holder is waited for (poll every 2 s, forever — a batch stage is
 * allowed to take as long as the job in front of it). A lock whose pid is dead is TAKEN OVER with a
 * printed note: a crashed run must not wedge the machine until someone deletes a file by hand.
 *
 * RE-ENTRANT THROUGH THE PROCESS TREE. The holder exports HEAVY_LOCK into its environment, and a child
 * that sees it runs straight through. Without that, `wg-batch-run.mjs suite` (lock) → `vt.mjs` (lock)
 * would deadlock against itself: same tree, different pid.
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
/* Read per call, not once at import: HEAVY_LOCK_PATH exists so test/wg-batch-run.test.ts can exercise
 * the waiting and takeover rules on a lock of its own — a test that grabbed work/.heavy.lock would
 * stall (or steal) a real batch run — and a test cannot set it before this module is evaluated. */
export const lockPath = () => process.env.HEAVY_LOCK_PATH || join(ROOT, 'work/.heavy.lock');
const POLL_MS = 2000;

/** EPERM means the pid exists and belongs to someone else — alive for our purposes. */
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
};

const holder = () => {
  try { return JSON.parse(readFileSync(lockPath(), 'utf8')); } catch { return null; }
};

/**
 * Run `fn` while holding the heavy-job lock. Returns whatever `fn` returns; the lock is released even
 * when `fn` throws. Nested calls inside one process tree are pass-through (see HEAVY_LOCK above).
 */
export async function withHeavyLock(label, fn) {
  if (process.env.HEAVY_LOCK) return await fn(); // an ancestor in this tree already holds it

  const path = lockPath();
  mkdirSync(dirname(path), { recursive: true });
  let waitedFor = null;
  for (;;) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, label, since: new Date().toISOString() }), { flag: 'wx' });
      break; // created it — ours
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      const h = holder();
      if (!h || !alive(h.pid)) {
        /* Stale: the holder is gone. Take it over and SAY SO — a silent takeover of a lock held by a
         * process that is actually alive but unreadable would be the one dangerous case, and `alive`
         * treats EPERM as alive precisely so that cannot happen. */
        console.log(`heavy-lock: taking over a stale lock (pid ${h?.pid ?? '?'} "${h?.label ?? '?'}" since ${h?.since ?? '?'}) — that process is gone`);
        try { unlinkSync(path); } catch { /* someone else won the takeover; loop and wait */ }
        continue;
      }
      if (waitedFor !== h.pid) {
        console.log(`heavy-lock: waiting for pid ${h.pid} — "${h.label}" (since ${h.since})`);
        waitedFor = h.pid;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  process.env.HEAVY_LOCK = String(process.pid);
  try {
    return await fn();
  } finally {
    delete process.env.HEAVY_LOCK;
    const h = holder();
    if (h?.pid === process.pid) { try { unlinkSync(path); } catch { /* already gone */ } }
  }
}
