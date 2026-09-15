/*
 * Lane B of the trust gate (docs/trust-gate.md §3): the SHIPPED situational stars go dark for the ids
 * the ledger turns off, and come back the moment the set is cleared.
 *
 * WHY this file exists at all. The lever is a module-level Set written ONCE at content load, so
 * nothing per-character can prove it works. The first draft of the gate reached for
 * `setSituationalSuppressions` instead — which clears itself on every explain pass, so a gated star
 * reappeared as soon as a sheet opened. These tests are the check that the SECOND set is the one
 * `entriesFor` reads, that it composes with the per-character one rather than replacing it, and that
 * the two readers which bypass `entriesFor` (`sheetLoreKeys`, the companion block) ask the gate too.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { content, build } from './_content';
import { explainStat, sheetLoreKeys, statHasSituational } from '../src/rules/explain';
import {
  FEAT_SITUATIONAL,
  choiceSituationalFor,
  featSituationalFor,
  hasFeatSituational,
  setSituationalSuppressions,
  setSituationalTrustOff,
  shippedSituational,
} from '../src/rules/situationalBonuses';
import type { Character } from '../src/rules/types';

const c = content();
const INTIM = { kind: 'skill', skill: 'intimidation' } as const;
const WILL = { kind: 'save', save: 'will' } as const;

// Both sets are module-level. Leaving either one dirty would silently gate the rest of the suite.
afterEach(() => {
  setSituationalTrustOff([]);
  setSituationalSuppressions([]);
});

describe('trust gate — situational stars', () => {
  it('the carriers these tests lean on still carry stars (or the assertions below are vacuous)', () => {
    expect(FEAT_SITUATIONAL['intimidating-prowess']?.length).toBeGreaterThan(0);
    expect(FEAT_SITUATIONAL['kaiju-stalker']?.length).toBeGreaterThan(0);
    expect(FEAT_SITUATIONAL['adhyabhau']?.length).toBeGreaterThan(0);
  });

  it('an off carrier yields no entries; clearing the set brings the star back', () => {
    const before = featSituationalFor(['intimidating-prowess'], INTIM).length;
    expect(before).toBeGreaterThan(0);

    setSituationalTrustOff(['intimidating-prowess']);
    expect(shippedSituational('intimidating-prowess')).toBe(false);
    expect(featSituationalFor(['intimidating-prowess'], INTIM)).toHaveLength(0);
    expect(hasFeatSituational(['intimidating-prowess'], INTIM)).toBe(false);

    setSituationalTrustOff([]);
    expect(shippedSituational('intimidating-prowess')).toBe(true);
    expect(featSituationalFor(['intimidating-prowess'], INTIM)).toHaveLength(before);
  });

  it('a character carrying an off record gets no star and no line on the sheet', () => {
    const ch = build('rogue', 4, { featPicks: { '2:skill:0': 'intimidating-prowess' } as never });
    expect(ch.feats.some((f) => f.featId === 'intimidating-prowess')).toBe(true);
    expect(statHasSituational(ch, INTIM, c)).toBe(true);

    setSituationalTrustOff(['intimidating-prowess']);
    expect(statHasSituational(ch, INTIM, c)).toBe(false);
    const lines = (explainStat(ch, c, INTIM).situational ?? []).map((s) => s.text);
    expect(lines.some((t) => /Intimidating Prowess/.test(t))).toBe(false);
  });

  it('an off carrier conjures no untrained Lore row (sheetLoreKeys bypasses entriesFor)', () => {
    const base = build('fighter', 3);
    const ch = { ...base, feats: [...base.feats, { featId: 'kaiju-stalker', source: 'test', level: 1 }] } as Character;
    expect(sheetLoreKeys(ch, c)).toContain('lore:kaiju');

    setSituationalTrustOff(['kaiju-stalker']);
    expect(sheetLoreKeys(ch, c)).not.toContain('lore:kaiju');
  });

  it('both entriesFor bypasses ask the gate by name', () => {
    // A source check, because the companion block is a component and the Lore reader is a loop: what
    // actually breaks is someone adding a THIRD raw `FEAT_SITUATIONAL[` read to either file.
    // The guard names the ID EXPRESSION, not just the function: a bare `shippedSituational(` test
    // passes on any dead call left in the file, so deleting the real gate stayed green (verified).
    // bug 2026-09-15: homebrew copies inherit markers — the companion reader now asks both halves
    // about `sourceId` (`officialIdOf(inv.itemId, …)`, so a homebrew COPY finds the official entry),
    // and the guard moved with it. Still the same property, stated more strictly than before: the
    // gate and the table are asked about ONE expression, spelled the same way in both.
    for (const [f, guard] of [
      ['src/rules/explain.ts', 'if (!shippedSituational(id)) continue;'],
      ['src/sheet/CompanionsTab.tsx', 'shippedSituational(sourceId) ? (FEAT_SITUATIONAL[sourceId]'],
    ] as const) {
      const src = readFileSync(f, 'utf8');
      expect(src.includes(guard), `${f} reads FEAT_SITUATIONAL without asking the trust gate about the id it read`).toBe(true);
    }
    // The companion reader's own gate call, exercised directly with a companion-carried item.
    expect(shippedSituational('marked-playing-cards')).toBe(true);
    setSituationalTrustOff(['marked-playing-cards']);
    expect(shippedSituational('marked-playing-cards')).toBe(false);
  });

  it('a player-answer star (CHOICE_SITUATIONAL) goes dark too — it arrives as `extra`, which entriesFor keeps', () => {
    // All six ids in that table are on the ledger's `situational` lane, and the star is their whole
    // mechanic (none moves a number), so this was the one path where a gated record kept its effect.
    expect(choiceSituationalFor('assurance', 'athletics').length).toBeGreaterThan(0);
    setSituationalTrustOff(['assurance']);
    expect(choiceSituationalFor('assurance', 'athletics')).toHaveLength(0);

    // …and end to end on a character, through `authoredSituational` → `entriesFor`'s `extra`.
    const base = build('fighter', 3);
    const ch = {
      ...base,
      feats: [...base.feats, { featId: 'assurance', source: 'test', level: 1, choice: { value: 'athletics' } }],
    } as unknown as Character;
    const ATH = { kind: 'skill', skill: 'athletics' } as const;
    setSituationalTrustOff([]);
    expect(statHasSituational(ch, ATH, c)).toBe(true);
    setSituationalTrustOff(['assurance']);
    expect(statHasSituational(ch, ATH, c)).toBe(false);
  });

  it('the per-character suppression still works on top of the gate', () => {
    setSituationalSuppressions(['intimidating-prowess']);
    expect(featSituationalFor(['intimidating-prowess'], INTIM)).toHaveLength(0);
    setSituationalSuppressions([]);
    expect(featSituationalFor(['intimidating-prowess'], INTIM).length).toBeGreaterThan(0);

    // Both sets consulted at once, each silencing its own id — neither clears the other.
    setSituationalTrustOff(['adhyabhau']);
    setSituationalSuppressions(['intimidating-prowess']);
    expect(hasFeatSituational(['intimidating-prowess'], INTIM)).toBe(false);
    expect(hasFeatSituational(['adhyabhau'], WILL)).toBe(false);
  });
});
