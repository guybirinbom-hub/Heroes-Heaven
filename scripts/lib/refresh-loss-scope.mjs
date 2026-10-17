/**
 * Which `before`-scoped rows of scripts/data/refresh-loss-allow.json are SPENT (package I, 2026-10-17).
 *
 * A scoped row explains one data lane's change from one before-snapshot of public/core.json (its `before` is that
 * snapshot's sha256 prefix). Once the lane is committed, HEAD moves and the row can never excuse anything again —
 * the header of scripts/refresh-loss-check.mjs always said "delete it then", and nothing made anyone do it: 76 such
 * rows from five committed lanes were still in the file on 2026-10-17 (the "32 old exception rows" of chat-todo, and
 * 44 more from package M), each one a row a later reader had to re-read and could mistake for a live excuse.
 *
 * So a row is spent unless its `before` names a snapshot a lane can still be explaining:
 *   · HEAD's core.json — the before of the lane in progress (or of the next one);
 *   · and, only while NO lane is in progress (the working core.json is HEAD's), the core.json version before HEAD's —
 *     the lane that was just committed keeps its rows until the next data lane starts, because it could not delete
 *     them in its own commit (its pre-commit verify needed them).
 * A data lane therefore deletes the previous lane's rows before its own commit: `--prune-spent` does it in one step.
 */

/** The spent rows of `rows`: scoped (`before` set) and naming none of `live` (sha256 hex strings). */
export function spentRows(rows, live) {
  const shas = live.filter(Boolean);
  return rows.filter((r) => r.before !== undefined && !shas.some((sha) => sha.startsWith(String(r.before))));
}

/** The snapshots a scoped row may still name: [HEAD's] plus, with no lane in progress, [the version before HEAD's]. */
export function liveSnapshots({ headSha, prevSha, workingSha }) {
  return workingSha === headSha ? [headSha, prevSha] : [headSha];
}
