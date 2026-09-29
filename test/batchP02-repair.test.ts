import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error — plain .mjs repair script, no type declarations (same as test/batch29-repair.test.ts)
import { repairFlatChecks, repairTerminalHole } from '../scripts/repair-flat-check-dc.mjs';

/**
 * Parity batch P02 — the REPAIR LANE (finding steady-spellcasting-magus).
 *
 * AoN prints *"If a reaction would disrupt your spellcasting action, attempt a DC 15 flat check."*
 * (feat-2857) and our import shipped *"…attempt a check."* — the `@Check[flat|dc:15]` cleaner deleted
 * the DC and the word "flat" and left a sentence that still parses, so the player cannot tell what to
 * roll. The legacy sibling (feat-4602) lost the whole run to the stripped-link hole: *"attempt a ."*.
 * 53 descriptions carry one shape or the other; scripts/repair-flat-check-dc.mjs authors the rows and
 * the FLAT_DC_BASELINE ratchet in scripts/dropped-inline-check.mjs counts them.
 *
 * These tests pin the MATCHER, not the shipped descriptions: the rows land through the orchestrator,
 * and an assertion that flips from red to green when they do would measure nothing. The one test that
 * reads the shipped record asserts the RESULT of repair-or-already-correct, which holds on both sides
 * of the row landing. The last block pins the two ratchet constants the closer lowered once the rows
 * had landed.
 */

type Result = { next: string; sites: { run: string; at: string; shape: string }[]; refused: { why: string; run?: string }[] };
const repair = (raw: string, printed: string) => repairFlatChecks(raw, printed) as Result;

const PRINTED_MAGUS =
  "Confident in your technique, you don't easily lose your concentration when you Cast a Spell. If a reaction would disrupt your spellcasting action, attempt a DC 15 flat check. If you succeed, your action isn't disrupted.";

describe('batch P02 — steady-spellcasting-magus: the stripped flat-check DC is restored by insertion only', () => {
  // batch P02: steady-spellcasting-magus
  it('steady-spellcasting-magus: "attempt a check" regains "DC 15 flat", and nothing else changes', () => {
    const was =
      "Confident in your technique, you don't easily lose your concentration when you Cast a Spell.\n\nIf a reaction would disrupt your spellcasting action, attempt a check. If you succeed, your action isn't disrupted.";
    const r = repair(was, PRINTED_MAGUS);
    // batch P02: steady-spellcasting-magus
    expect(r.next).toContain('attempt a DC 15 flat check. If you succeed');
    /* insertion only: deleting the inserted run gives our text back, character for character. */
    // batch P02: steady-spellcasting-magus
    expect(r.next.replace('DC 15 flat ', '')).toBe(was);
    // batch P02: steady-spellcasting-magus
    expect(r.sites.map((s) => s.shape)).toEqual(['surviving sentence']);
  });

  // batch P02: steady-spellcasting-magus
  it('steady-spellcasting-magus sibling (feat-4602): the terminal hole "attempt a ." regains the whole run', () => {
    const was =
      "Confident in your technique, you don't lose spells easily. If a reaction would disrupt your spellcasting action, attempt a . If you succeed, your action isn't disrupted.";
    const printed =
      "Confident in your technique, you don't lose spells easily. If a reaction would disrupt your spellcasting action, attempt a DC 15 flat check. If you succeed, your action isn't disrupted.";
    const r = repair(was, printed);
    // batch P02: steady-spellcasting-magus
    expect(r.next).toBe(was.replace('attempt a .', 'attempt a DC 15 flat check.'));
    // batch P02: steady-spellcasting-magus
    expect(r.sites.map((s) => s.shape)).toEqual(['terminal hole']);
  });

  // batch P02: steady-spellcasting-magus
  it('steady-spellcasting-magus: an already-correct sentence is left exactly alone', () => {
    const ok = 'If a reaction would disrupt your spellcasting action, attempt a DC 15 flat check. If you succeed, your action isn\'t disrupted.';
    const r = repair(ok, PRINTED_MAGUS);
    // batch P02: steady-spellcasting-magus
    expect(r.next).toBe(ok);
    // batch P02: steady-spellcasting-magus
    expect(r.sites).toEqual([]);
    // batch P02: steady-spellcasting-magus
    expect(r.refused).toEqual([]);
  });

  // batch P02: steady-spellcasting-magus
  it('steady-spellcasting-magus: half the run survived ("a flat check") — only the DC is inserted, "flat" is not doubled', () => {
    const was = 'If a reaction would disrupt your spellcasting action, attempt a flat check. If you succeed, your action isn\'t disrupted.';
    const r = repair(was, PRINTED_MAGUS);
    // batch P02: steady-spellcasting-magus
    expect(r.next).toContain('attempt a DC 15 flat check.');
    // batch P02: steady-spellcasting-magus
    expect(r.next.match(/flat/g)).toHaveLength(1);
  });

  // batch P02: steady-spellcasting-magus
  it('steady-spellcasting-magus: a sentence that already prints its own DC elsewhere is refused, never doubled', () => {
    const was = 'If a reaction would disrupt your spellcasting action, attempt a check (DC 11). If you succeed, your action isn\'t disrupted.';
    const r = repair(was, PRINTED_MAGUS);
    // batch P02: steady-spellcasting-magus
    expect(r.next).toBe(was);
    // batch P02: steady-spellcasting-magus
    expect(r.refused.map((x) => x.why)).toEqual(['our sentence already prints a different DC']);
  });

  // batch P02: steady-spellcasting-magus
  it('steady-spellcasting-magus: a doc naming two DCs is refused whole (the rung trap), and an ambiguous hole anchor is refused', () => {
    const twoDcs = 'Attempt a DC 5 flat check. At 10th level, attempt a DC 11 flat check instead.';
    // batch P02: steady-spellcasting-magus
    expect(repair('Attempt a check. At 10th level, attempt a check instead.', twoDcs).refused[0].why).toMatch(/names 2 DCs/);
    // batch P02: steady-spellcasting-magus
    expect(repairTerminalHole('you attempt a . Then you attempt a .', 'you attempt a', 'DC 5 flat check')).toEqual({ refuse: 'terminal-hole anchor occurs 2×, not once' });
  });

  // batch P02: steady-spellcasting-magus
  it('steady-spellcasting-magus: the SHIPPED description, repaired or already repaired, prints the DC 15 flat check', () => {
    const descs = JSON.parse(readFileSync('public/core-descriptions.json', 'utf8'));
    const shipped: string = descs.feats['steady-spellcasting-magus'].d;
    const r = repair(shipped, PRINTED_MAGUS);
    /* Before the row lands: the matcher inserts it. After: the matcher leaves it alone. Either way the
     * text a player reads after this lane says what to roll. */
    // batch P02: steady-spellcasting-magus
    expect(r.next).toContain('attempt a DC 15 flat check');
    // batch P02: steady-spellcasting-magus
    expect(r.refused).toEqual([]);
  });
});

/*
 * THE CLOSER'S RATCHET EDIT, PINNED (same finding). Once --stage apply had landed the 53 repair rows
 * (work/.bP02-rows-repair.json), the closer lowered both ratchets in scripts/dropped-inline-check.mjs to
 * the counts it then measured: HOLE_BASELINE 162 -> 116 (46 of the repaired sites were "attempt a ."
 * holes that ratchet counts) and FLAT_DC_BASELINE 53 -> 0. A ratchet only guards while it sits AT the
 * measured count. Put either one back up and `npm run verify` still passes, because every live count is
 * under the looser ceiling, so nothing else in the suite notices. These two tests do.
 *
 * WHY THE SOURCE IS PARSED, NOT IMPORTED: dropped-inline-check.mjs exports nothing and runs every check
 * at top level (a failing one calls process.exit(1)), so importing it would run the whole check inside
 * the test process. The regex takes each `const|let|var <NAME> = <integer>;` declaration that opens a
 * line (the shape scripts/test-flip-audit.mjs's ratchetValue() reads) and the tests demand EXACTLY one,
 * so a second declaration further down cannot hide a reverted value. A later batch that lowers either
 * ratchet again changes the pinned number here, citing its own finding.
 */
const DROPPED_INLINE = readFileSync('scripts/dropped-inline-check.mjs', 'utf8');
const ratchetDecls = (name: string): number[] =>
  [...DROPPED_INLINE.matchAll(new RegExp(`^[ \\t]*(?:const|let|var)[ \\t]+${name}[ \\t]*=[ \\t]*(-?\\d+)[ \\t]*;`, 'gm'))].map((m) => Number(m[1]));

describe('batch P02 — steady-spellcasting-magus: the dropped-inline ratchets sit at the counts measured after the repair rows landed', () => {
  // batch P02: steady-spellcasting-magus
  it('steady-spellcasting-magus: HOLE_BASELINE is 116, not the 162 it was before the repair rows', () => {
    // mutation-proof: put HOLE_BASELINE back to 162 in scripts/dropped-inline-check.mjs and this must fail naming it.
    // batch P02: steady-spellcasting-magus
    expect(ratchetDecls('HOLE_BASELINE'), 'HOLE_BASELINE in scripts/dropped-inline-check.mjs').toEqual([116]);
  });

  // batch P02: steady-spellcasting-magus
  it('steady-spellcasting-magus: FLAT_DC_BASELINE is 0, not the 53 it was before the repair rows', () => {
    // mutation-proof: put FLAT_DC_BASELINE back to 53 in scripts/dropped-inline-check.mjs and this must fail naming it.
    // batch P02: steady-spellcasting-magus
    expect(ratchetDecls('FLAT_DC_BASELINE'), 'FLAT_DC_BASELINE in scripts/dropped-inline-check.mjs').toEqual([0]);
  });
});
