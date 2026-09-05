import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error — plain .mjs repair script, no type declarations (same as test/audit-cache.test.ts)
import { repairSite } from '../scripts/repair-stripped-save-dc.mjs';

/**
 * Wanderer's-Guide parity batch 29 — the REPAIR LANE (finding unmemorable-mantle#save-dc).
 *
 * AoN prints *"Each creature must attempt a DC 25 Will save"* (equipment-513) and our import shipped
 * *"Each creature must attempt a save."* — the `@Check[will|dc:25]` cleaner deleted the DC and the
 * save type and left a sentence that still parses, so the player has nothing to roll against. 141
 * descriptions carry that strip.
 *
 * These tests pin the MATCHER in scripts/repair-stripped-save-dc.mjs, not the shipped descriptions:
 * the rows it emits into work/.b029-rows-dc.json are applied by the orchestrator, and an assertion
 * about a description would flip from red to green the moment they land. The matcher's contract does
 * not flip — it must insert exactly the tokens the Archives print, never touch a sentence that
 * already carries them, and refuse anything else.
 */

const site = (raw: string, ctx: string, middle: string, word: string) =>
  repairSite(raw, ctx, middle, word) as { next?: string; inserted?: string; skip?: string; refuse?: string };

describe('batch 29 — the stripped save DC is restored by insertion only', () => {
  /* Fixture 1 — the finding itself. Both tokens gone: "a save" ← "a DC 25 Will save".
   * The trailing `---` block is what defeats the existing dropped-inline aligner (its sentence
   * splitter does not break before a rule), so it is part of the fixture on purpose. */
  it('unmemorable mantle: "must attempt a save" regains "DC 25 Will", and nothing else changes', () => {
    const was =
      "…recollections of the last 5 minutes of their interaction with you. Each creature must attempt a save.\n\n---\n\n**Critical Success** The creature recalls the interaction clearly.";
    const r = site(was, 'must attempt a', 'DC 25 Will', 'save');
    expect(r.next).toContain('Each creature must attempt a DC 25 Will save.');
    /* insertion only: deleting the inserted tokens gives our text back, character for character. */
    expect(r.next!.replace('DC 25 Will ', '')).toBe(was);
  });

  /* Fixture 2 — half the phrase survived: only the DC was eaten, the save type was not. The repair
   * must insert "DC 19" and must NOT duplicate the "Will" we already have. */
  it('floppy rag doll: "a Will saving throw" regains only the DC, not a second "Will"', () => {
    const was = 'they must attempt a Will saving throw.\n\n---\n\n**Critical Success** The target is unaffected.';
    /* the context is the three words before the DC in the Archives' own sentence — "…must attempt a
     * DC 19 Will saving throw" — so the surviving "Will" is inside the span being rewritten. */
    const r = site(was, 'must attempt a', 'DC 19 Will', 'saving');
    expect(r.next).toContain('must attempt a DC 19 Will saving throw.');
    expect(r.next!.match(/Will/g)).toHaveLength(1);
    expect(r.next!.replace('DC 19 ', '')).toBe(was);
  });

  /* Fixture 3 — the same strip on a skill CHECK rather than a save (lover's ink, familiar abilities). */
  it("lover's ink: \"with a successful check\" regains \"DC 25 Perception\"", () => {
    const was = "…can detect the presence of the ink with a successful check. On a critical success, they can make out the ink.";
    const r = site(was, 'ink with a successful', 'DC 25 Perception', 'check');
    expect(r.next).toContain('with a successful DC 25 Perception check.');
    expect(r.next!.replace('DC 25 Perception ', '')).toBe(was);
  });

  /* The other half of the contract: a sentence that already prints the DC is LEFT ALONE. 801 of the
   * 942 records the Archives give a DC for are in this state, and rewriting them would churn every
   * authored correction those descriptions have already had. */
  it('an already-correct sentence is skipped, not rewritten', () => {
    const was = 'Each creature must attempt a DC 25 Will save.';
    const r = site(was, 'must attempt a', 'DC 25 Will', 'save');
    expect(r.skip).toBeTruthy();
    expect(r.next).toBeUndefined();
  });

  /* A confident WRONG DC is worse than a visible missing one: where our text and the Archives
   * disagree on the number (an authored correction, or a variant rung), the site is refused. */
  it('a DC that disagrees with the Archives is refused, never overwritten', () => {
    const r = site('Each creature must attempt a DC 30 Will save.', 'must attempt a', 'DC 25 Will', 'save');
    expect(r.refuse).toMatch(/subsequence/);
    expect(r.next).toBeUndefined();
  });

  /* And where the anchor is not unique the site is refused rather than guessed at. */
  it('an anchor that occurs twice is refused', () => {
    const r = site('You must attempt a save. Each ally must attempt a save.', 'must attempt a', 'DC 25 Will', 'save');
    expect(r.refuse).toMatch(/2×/);
  });
});

describe('batch 29 — the spec the orchestrator applies, and the ratchet that keeps it at zero', () => {
  const spec = JSON.parse(readFileSync('work/.b029-rows-dc.json', 'utf8')) as {
    findings: { id: string; backfillRows: { category: string; id: string; field: string; value: string; why: string }[] }[];
  };
  const rows = spec.findings[0]!.backfillRows;

  it('every row is a description assignment carrying a printed DC and a reason', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.field).toBe('description');
      expect(r.value).toMatch(/DC \d+\s+(?:basic\s+)?(?:Fortitude|Reflex|Will|Perception)/);
      expect(r.why).toMatch(/AoN prints/);
    }
  });

  it('one row per record — the applier refuses collisions', () => {
    const keys = rows.map((r) => `${r.category}/${r.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /* The three Unmemorable Mantle rungs are hand-authored by the data agent: only the base rung's
   * DC 25 is in the body text, and the greater/major rungs print 28 / 38 in their rung lines, which
   * this script's refusal 3 (a doc naming more than one DC) also catches on its own. */
  it('the three Unmemorable Mantle rungs are not in the spec', () => {
    for (const id of ['unmemorable-mantle', 'unmemorable-mantle-greater', 'unmemorable-mantle-major']) {
      expect(rows.find((r) => r.id === id)).toBeUndefined();
    }
  });

  /* The guard half of "turn every finding into a guard": the count is ratcheted in npm run verify, so
   * a regeneration that reintroduces the strip fails the build instead of shipping silently. */
  /* ⚠ THIS ASSERTION MUST NOT COMPARE THE BASELINE TO THE SPEC'S ROW COUNT. It used to say
   * `baseline >= rows.length`, which was true only while the rows were UNAPPLIED: the whole point of
   * the ratchet is that applying them drives it to zero, so the orchestrator lowering it to 0 turned a
   * green test red with nothing wrong. What is durable is that the class is ratcheted at all. */
  it('scripts/dropped-inline-check.mjs ratchets the class', () => {
    const guard = readFileSync('scripts/dropped-inline-check.mjs', 'utf8');
    expect(guard).toContain('findStrippedSaveDc');
    expect(guard).toMatch(/const SAVE_DC_BASELINE = \d+;/);
    expect(guard).toContain('never raise SAVE_DC_BASELINE');
  });
});
