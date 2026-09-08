import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain-ESM script, no type declarations (scripts/ is JS, test/ is TS).
import { pendingQuestions } from '../scripts/wg-batch-run.mjs';

/**
 * Batch 031's closer guards, in a file of their own because they are about the DRIVER's resume
 * behaviour rather than about a record.
 *
 * `--stage gaps` files work/.bNNN-queue.json through add-owner-question.mjs, which refuses an id that
 * is already on the owner's desk and then writes NOTHING for the whole run. Batch 031 had to re-run
 * gaps (the close stage demanded a desk number for the three read-stage askOwner findings, which the
 * closer queued), and the second run would have refused on the three entries the FIRST run had just
 * filed. stageGaps therefore hands over only the entries no desk array holds yet.
 */
describe('stageGaps queue resume (batch 031)', () => {
  const desk = { open: [{ id: 'speed-status-lane-031', n: 127 }], ruled: [{ id: 'old-one', n: 3 }], deferred: [], authorisedExceptions: [] };
  const queue = [{ id: 'speed-status-lane-031' }, { id: 'old-one' }, { id: 'glyph-expert' }];

  it('hands add-owner-question.mjs only the entries no desk array already holds', () => {
    expect(pendingQuestions(queue, desk).map((q: { id: string }) => q.id)).toEqual(['glyph-expert']);
  });

  it('files everything against an empty desk, and nothing when every entry is filed', () => {
    expect(pendingQuestions(queue, {})).toHaveLength(3);
    expect(pendingQuestions(queue, { open: queue })).toEqual([]);
    expect(pendingQuestions(undefined, desk)).toEqual([]);
  });
});
