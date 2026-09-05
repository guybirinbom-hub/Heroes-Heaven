import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error — plain .mjs repair script, no type declarations (same as test/batch29-repair.test.ts)
import { repairArtefacts, printedLink, restoreFootRun } from '../scripts/repair-stripped-skill-links.mjs';
// @ts-expect-error — plain .mjs library, no type declarations
import { sentences } from '../scripts/lib/dropped-inline.mjs';

/**
 * Wanderer's-Guide parity batch 29 — the REPAIR LANE FOLLOW-UP (findings graceful-leaper and
 * hairpin-of-blooming-flowers#burst-text).
 *
 * Two more classes of value the import destroyed:
 *
 *   the collapsed link  ours  "…when making a high-jump skill=acrobatics or long-jump skill=acrobatics."
 *                       AoN   "…when making a High Jump or Long Jump."          (feat-6243)
 *   the stripped area   ours  "…bursts with life in a centered on you."
 *                       AoN   "…bursts with life in a 20-foot burst centered on you."
 *
 * These tests pin the MATCHERS, not the shipped descriptions: the rows go to
 * work/.b029-rows-skill.json for the orchestrator to apply, so an assertion about a description would
 * flip from red to green the moment they land. The matchers' contract does not flip — they must write
 * only what the aligned Archives sentence prints IN THAT POSITION, and refuse everything else.
 */

type Repair = { next: string; sites: { was: string; now: string }[]; refused: string[] };
type Foot = { next?: string; inserted?: string; skip?: string; refuse?: string };

describe('batch 29 — the collapsed link is restored from the aligned mirror sentence', () => {
  /* Fixture 1 — the finding itself. Two links in one sentence, each collapsed to slug + query string. */
  it('graceful leaper: "high-jump skill=acrobatics" becomes the printed "High Jump"', () => {
    const ours =
      'You can roll an Acrobatics check instead of an Athletics check when making a high-jump skill=acrobatics or long-jump skill=acrobatics.';
    const mirror =
      'You can roll an Acrobatics check instead of an Athletics check when making a High Jump or Long Jump.';
    const r = repairArtefacts(ours, mirror) as Repair;
    expect(r.next).toBe(mirror);
    expect(r.sites.map((s) => s.now)).toEqual(['High Jump', 'Long Jump']);
  });

  /* Fixture 2 — the `dc=` sibling: the parameter carries a value the printed text keeps, so the
   * replacement is "Escape DC 28" and not just "Escape" (Binding Snare, equipment-1122). */
  it('binding snare: "(escape show-dc=all dc=28)" becomes "(Escape DC 28)"', () => {
    const ours = "The creature is knocked prone and immobilized for 1 round (escape show-dc=all dc=28).";
    const mirror = 'The creature is knocked prone and immobilized for 1 round (Escape DC 28).';
    const r = repairArtefacts(ours, mirror) as Repair;
    expect(r.next).toBe(mirror);
  });

  /*
   * Fixture 3 — THE ONE THAT MUST NOT BE REPAIRED. Hellbreaker Dedication's slug is "recall-knowledge"
   * but the printed link is the SKILL name; the sentence does contain "Recall Knowledge", in its tail,
   * where it means something else. A presence test authors the wrong action three times over — only
   * the words either side of the artefact tell the two apart.
   */
  it('hellbreaker dedication: a name found elsewhere in the sentence is not evidence', () => {
    const ours =
      'When you roll initiative, you can attempt a recall-knowledge skill=devil-lore check to Recall Knowledge about one enemy you can see.';
    const mirror =
      'When you roll initiative, you can attempt a Devil Lore, Hellknight Lore, or Society check to Recall Knowledge about one enemy you can see.';
    const r = repairArtefacts(ours, mirror) as Repair;
    expect(r.next).toBe(ours);
    expect(r.sites).toHaveLength(0);
    expect(r.refused.join(' ')).toMatch(/does not print it in this position/);
    /* and the matcher itself says so, given the anchors "a" ▸ "check" */
    expect(printedLink('recall-knowledge', null, mirror, 'a', 'check')).toBeNull();
    /* …while the same call at the position AoN really prints it does resolve. */
    expect(printedLink('recall-knowledge', null, mirror, 'to', 'about')).toBe('Recall Knowledge');
  });

  /* A tail of nothing but collapsed links, after a sentence that already prints those names, is the
   * import appending what it could not inline (Expert Disassembly, feat-6408). Replacing it would
   * print "Pick a Lock" twice; the repair is to delete it. */
  it('expert disassembly: a dangling artefact tail is deleted, not printed twice', () => {
    const ours =
      'You can use Crafting instead of Thievery to Disable a Device or Pick a Lock.\n\npick-a-lock skill=crafting\n\ndisable-device skill=crafting';
    const r = repairArtefacts(ours, 'You can use Crafting instead of Thievery to Disable a Device or Pick a Lock.') as Repair;
    expect(r.next).toBe('You can use Crafting instead of Thievery to Disable a Device or Pick a Lock.');
    expect(r.sites[0]!.now).toMatch(/deleted/);
  });
});

describe('batch 29 — the stripped "<N>-foot" area is restored by insertion only', () => {
  /* Fixture 1 — the dominant shape: BOTH the size and its noun were deleted (spells/bountiful-oasis). */
  it('bountiful oasis: "ground in a surrounding" regains "20-foot burst"', () => {
    const raw = 'The ground in a surrounding the spring bursts with life.';
    const r = restoreFootRun(raw, ['ground', 'in', 'a'], ['20-foot', 'burst', 'surrounding', 'the']) as Foot;
    expect(r.next).toBe('The ground in a 20-foot burst surrounding the spring bursts with life.');
    /* insertion only: deleting the inserted run gives our text back, character for character. */
    expect(r.next!.replace(` ${r.inserted}`, '')).toBe(raw);
  });

  /* Fixture 2 — the hole sits against punctuation, so the mirror's own comma must not be doubled
   * (spells/elemental-annihilation-wave: "the area is a , and for 1 round"). */
  it('elemental annihilation wave: the run lands before our comma, not beside a second one', () => {
    const raw = 'The area is a , and for 1 round the elements linger.';
    const r = restoreFootRun(raw, ['area', 'is', 'a'], ['60-foot', 'cone,', 'and', 'for']) as Foot;
    expect(r.next).toBe('The area is a 60-foot cone, and for 1 round the elements linger.');
    expect(r.next!.match(/,/g)).toHaveLength(1);
  });

  it('a description that already prints the size is skipped, not rewritten', () => {
    const r = restoreFootRun('The ground in a 20-foot burst surrounding the spring.', ['ground', 'in', 'a'], ['20-foot', 'burst', 'surrounding']) as Foot;
    expect(r.skip).toBeTruthy();
    expect(r.next).toBeUndefined();
  });

  it('an authored size that disagrees with the Archives is refused, never overwritten', () => {
    const r = restoreFootRun('The ground in a 30-foot burst surrounding the spring.', ['ground', 'in', 'a'], ['20-foot', 'burst', 'surrounding']) as Foot;
    expect(r.refuse).toMatch(/stopping point/);
    expect(r.next).toBeUndefined();
  });

  it('a context that occurs twice is refused rather than guessed at', () => {
    const r = restoreFootRun('It fills in a surrounding the spring, then in a surrounding the well.', ['in', 'a', 'surrounding'], ['20-foot', 'burst', 'the']) as Foot;
    expect(r.refuse).toMatch(/2×/);
  });
});

describe('batch 29 — the root cause in the shared sentence splitter', () => {
  /*
   * The `---` rule that separates an item's activation from its degrees-of-success block, and AoN's
   * own header from its body, opened no sentence: everything after it merged into the hole sentence,
   * which then aligned against the wrong counterpart and the repair scored below trust. AoN's header
   * has no `.!?` before the rule at all, so a character added to the `(?<=[.!?])` lookahead could
   * never have fixed it.
   */
  it('breaks before a "---" rule, with and without a sentence end in front of it', () => {
    expect(sentences('Each creature must attempt a save. --- **Critical Success** It is unaffected.')).toEqual([
      'Each creature must attempt a save.',
      '--- **Critical Success** It is unaffected.',
    ]);
    expect(sentences('Prerequisites Master in Acrobatics --- Mass and muscle are meaningless.')).toEqual([
      'Prerequisites Master in Acrobatics',
      '--- Mass and muscle are meaningless.',
    ]);
  });
});

describe('batch 29 — the spec the orchestrator applies, and the ratchets that hold the classes shut', () => {
  const spec = JSON.parse(readFileSync('work/.b029-rows-skill.json', 'utf8')) as {
    findings: { id: string; backfillRows: { category: string; id: string; field: string; value: string; why: string }[]; note: string }[];
  };
  const finding = (id: string) => spec.findings.find((f) => f.id === id)!;

  it('carries both findings, every row a description assignment with a reason', () => {
    expect(spec.findings.map((f) => f.id)).toEqual(['stripped-skill-links', 'stripped-foot-areas']);
    for (const f of spec.findings) {
      expect(f.backfillRows.length).toBeGreaterThan(0);
      for (const r of f.backfillRows) {
        expect(r.field).toBe('description');
        expect(r.why).toMatch(/Archives|AoN/);
      }
    }
  });

  it('no repaired description still prints a query string', () => {
    for (const r of finding('stripped-skill-links').backfillRows) expect(r.value).not.toMatch(/\bskill=|\bdc=|\btraits=/);
  });

  it('every restored area row prints a "<N>-foot" size', () => {
    for (const r of finding('stripped-foot-areas').backfillRows) expect(r.value).toMatch(/\d+-foot/);
  });

  /* One row per record across BOTH findings — two rows for one description would race, and the
   * applier refuses collisions. Ids another agent's rows already claim are skipped by the sweep. */
  it('one row per record, across both findings', () => {
    const keys = spec.findings.flatMap((f) => f.backfillRows.map((r) => `${r.category}/${r.id}`));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('graceful-leaper and the hand-repaired hairpin are left to the rows that already claim them', () => {
    const keys = spec.findings.flatMap((f) => f.backfillRows.map((r) => r.id));
    expect(keys).not.toContain('graceful-leaper');
    expect(keys).not.toContain('hairpin-of-blooming-flowers');
  });

  /*
   * The guard half of "turn every finding into a guard": both classes are ratcheted in npm run verify,
   * so a regeneration that reintroduces either fails the build instead of shipping silently.
   *
   * ⚠ NOT `baseline >= rows.length`. That comparison holds only while the rows are UNAPPLIED — the
   * point of a ratchet is that applying them LOWERS it — so it turns red the moment the orchestrator
   * does its job. (It did exactly that to the save-DC test in this batch.) What is durable is that
   * each class has a ratchet and that the ratchet is one-way.
   */
  it('scripts/dropped-inline-check.mjs ratchets both classes, one-way', () => {
    const guard = readFileSync('scripts/dropped-inline-check.mjs', 'utf8');
    expect(guard).toMatch(/const ARTEFACT_BASELINE = \d+;/);
    expect(guard).toMatch(/const FOOT_BASELINE = \d+;/);
    expect(guard).toContain('never raise ARTEFACT_BASELINE');
    expect(guard).toContain('never raise FOOT_BASELINE');
  });
});
