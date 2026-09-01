/*
 * A situational bonus must be authorable on ANY record, not just an item.
 *
 * `situational` lived on ItemBase, so a conditional bonus on a feat could only be expressed by editing
 * the `FEAT_SITUATIONAL` table in src/rules/situationalBonuses.ts — code, not data. That made every
 * situational disagreement the Wanderer's Guide comparison raised on a feat, class feature, background
 * or heritage impossible to act on from a decision file, which blocked the comparison METHOD rather
 * than any one record. Their `conditional` verb appears on 876 records, so this was not a corner case.
 *
 * These tests hold the two halves that make the lane real:
 *   1. the field is READ on a non-item record — a field with no reader is this project's most-shipped
 *      failure mode, and the reason work/wg-lane-backlog.md exists at all;
 *   2. `situationalReplaces` REPLACES the shipped entries instead of appending, because "delete the way
 *      we did it and do it their way" cannot be expressed by concatenation, and a player shown both
 *      readings of one rule is worse off than one shown only the old one.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { build, content } from './_content';
import { statHasSituational } from '../src/rules/explain';
import { featSituationalFor, setSituationalReplacements, FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import type { ContentDatabase } from '../src/rules/types';

const db = content();
const STEALTH = { kind: 'skill', skill: 'stealth' } as const;

/** The replacement set is module-level, so clear it or one test leaks into the next. */
afterEach(() => setSituationalReplacements([]));

describe('situational on a non-item record', () => {
  it('a feat carrying `situational` stars the stat it names', () => {
    const ch = build('fighter', 3);
    const featId = ch.feats?.[0]?.featId;
    expect(featId, 'the test build must have taken at least one feat').toBeTruthy();

    const patched = {
      ...db,
      feats: {
        ...db.feats,
        [featId!]: {
          ...db.feats[featId!],
          situational: [{ targets: [{ kind: 'skill', detail: 'stealth' }], when: 'while the test is running', bonus: '+1 circumstance' }],
        },
      },
    } as ContentDatabase;

    // The same character and the same stat; only the record's authored field differs.
    expect(statHasSituational(ch, STEALTH, db), 'unpatched db must not star stealth').toBe(false);
    expect(statHasSituational(ch, STEALTH, patched), 'the authored entry must reach the star').toBe(true);
  });

  it('replacement wins over the shipped table instead of stacking with it', () => {
    // Author a shipped id so the two readings are distinguishable; featSituationalFor is the exact
    // path the sheet uses, so this exercises the merge rather than a stand-in for it.
    const id = Object.keys(FEAT_SITUATIONAL).find((k) =>
      FEAT_SITUATIONAL[k].some((b) => b.targets.some((t) => t.kind === 'skill' && t.detail === 'stealth')),
    );
    expect(id, 'a shipped stealth entry is needed for replacement to be observable').toBeTruthy();

    const authored = { [id!]: [{ targets: [{ kind: 'skill', detail: 'stealth' }], when: 'the replacement reading', bonus: '+2 circumstance' }] };

    const appended = featSituationalFor([id!], STEALTH, authored);
    expect(appended.length, 'without the flag both readings show').toBeGreaterThan(1);

    setSituationalReplacements([id!]);
    const replaced = featSituationalFor([id!], STEALTH, authored);
    expect(replaced.length, 'with the flag exactly one reading survives').toBe(1);
    expect(replaced[0].when).toBe('the replacement reading');
  });
});
