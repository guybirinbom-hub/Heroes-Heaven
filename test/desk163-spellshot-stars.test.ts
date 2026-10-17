import { afterAll, describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import { characterSituationalIds, explainStat } from '../src/rules/explain';
import { FEAT_SITUATIONAL, setSituationalTrustOff } from '../src/rules/situationalBonuses';
import { TRUST_LEDGER } from '../src/data/trustGate';
import type { BuildState } from '../src/rules/build';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * DESK #163 (2026-10-15, his pick 'A note on the Strike (Recommended)') — Energy Shot, Fulminating Shot and Dispelling
 * Bullet are starred notes on the Strike, read with the TRUST GATE ON, as every player sees the app (package I,
 * 2026-10-17).
 *
 * The three approvals (scripts/data/trust-approvals.json, field `situational`) had NO star behind them for two days:
 * no FEAT_SITUATIONAL key and no record field, so the approval lit an empty room. The keys are hand-added to the
 * hand-authored block of FEAT_SITUATIONAL (scripts/apply-situational-lane.mjs keeps hand additions), each worded from
 * its own print:
 *
 *   action-923  Energy Shot       "On your first three Strikes of this encounter with a firearm or crossbow, you deal
 *                                 an additional 1 acid, cold, fire, or electricity damage per weapon damage die."
 *   feat-3268   Fulminating Shot  "If you hit with your next attack roll using a firearm or crossbow before the end of
 *                                 your turn, you deal 1d6 additional damage of this type" (2d6 at 12th, 3d6 at 18th).
 *   action-925  Dispelling Bullet "your counteract check modifier is equal to your class DC – 10" (rank = half level).
 *
 * A star target carries no weapon narrowing, so each line sits on EVERY Strike row and names "firearm or crossbow"
 * itself (the point-blank-stance / telluric-power convention); the player applies it. No number moves.
 * Synthetic characters only.
 */
const gated = content({ trustGate: true });
afterAll(() => setSituationalTrustOff(TRUST_LEDGER.lanes.situational));

const IDS = ['energy-shot', 'fulminating-shot', 'dispelling-bullet'] as const;

/** A gunslinger of `subclassId` and `level` with a harmona gun and a longsword equipped; optionally Fulminating Shot. */
const slinger = (subclassId: string, level: number, fulminating: boolean): Character => {
  const base = build('gunslinger', level, { subclassId } as Partial<BuildState>);
  return {
    ...base,
    feats: fulminating ? [...base.feats, { featId: 'fulminating-shot', level, slot: 'desk163:0' }] : base.feats,
    inventory: [
      ...(base.inventory ?? []),
      { instanceId: 'gun1', itemId: 'harmona-gun', quantity: 1, equipped: true } as InventoryItem,
      { instanceId: 'ls1', itemId: 'longsword', quantity: 1, equipped: true } as InventoryItem,
    ],
  } as unknown as Character;
};

/** The starred lines one Strike row shows under its damage / attack popup, as the sheet reads them: [sourceId, text]. */
const lines = (c: Character, kind: 'strikeDamage' | 'strikeAttack', instanceId: string, d = gated): [string, string][] =>
  (explainStat(c, d, { kind, instanceId }).situational ?? []).map((l) => [l.sourceId, l.text] as [string, string]);
const fromThree = (rows: [string, string][]) => rows.filter(([id]) => (IDS as readonly string[]).includes(id));

describe('#163, trust gate ON: the three stars reach a spellshot gunslinger\'s Strike', () => {
  it('the Strike rows exist and the three ids are reached (way of the spellshot, level 15, Fulminating Shot taken)', () => {
    const c = slinger('way-of-the-spellshot', 15, true);
    expect(deriveStrikes(c, gated).map((s) => s.instanceId)).toEqual(expect.arrayContaining(['gun1', 'ls1']));
    expect(characterSituationalIds(c, gated)).toEqual(expect.arrayContaining([...IDS]));
  });

  it('damage popup: Energy Shot and Fulminating Shot, worded from print; attack popup: Dispelling Bullet', () => {
    const c = slinger('way-of-the-spellshot', 15, true);
    const dmg = fromThree(lines(c, 'strikeDamage', 'gun1'));
    expect(dmg.map(([id]) => id).sort()).toEqual(['energy-shot', 'fulminating-shot']);
    const energy = dmg.find(([id]) => id === 'energy-shot')![1];
    expect(energy).toContain('first three Strikes of this encounter');
    expect(energy).toContain('firearm or crossbow');
    expect(energy).toMatch(/\+1 acid, cold, fire, or electricity damage per weapon damage die/);
    const fulm = dmg.find(([id]) => id === 'fulminating-shot')![1];
    expect(fulm).toContain('firearm or crossbow');
    expect(fulm).toContain('+1d6');
    expect(fulm).toContain('2d6 at 12th level');
    expect(fulm).toContain('3d6 at 18th level');
    const atk = fromThree(lines(c, 'strikeAttack', 'gun1'));
    expect(atk.map(([id]) => id)).toEqual(['dispelling-bullet']);
    expect(atk[0][1]).toContain('counteract');
    expect(atk[0][1]).toContain('half your level (rounded up)');
    expect(atk[0][1]).toContain('class DC – 10');
  });

  it('every Strike row carries them (a star target has no weapon narrowing); the text names the firearm or crossbow itself', () => {
    const c = slinger('way-of-the-spellshot', 15, true);
    for (const row of ['gun1', 'ls1']) {
      expect(fromThree(lines(c, 'strikeDamage', row)).length, `${row} damage`).toBe(2);
      expect(fromThree(lines(c, 'strikeAttack', row)).length, `${row} attack`).toBe(1);
    }
  });

  it('Dispelling Bullet needs level 15, Fulminating Shot needs the feat, Energy Shot comes with the way', () => {
    const at14 = slinger('way-of-the-spellshot', 14, true);
    expect(fromThree(lines(at14, 'strikeAttack', 'gun1'))).toEqual([]);
    expect(fromThree(lines(at14, 'strikeDamage', 'gun1')).map(([id]) => id).sort()).toEqual(['energy-shot', 'fulminating-shot']);
    const noFeat = slinger('way-of-the-spellshot', 8, false);
    expect(fromThree(lines(noFeat, 'strikeDamage', 'gun1')).map(([id]) => id)).toEqual(['energy-shot']);
  });

  it('a way-of-the-sniper gunslinger of the same level gets none of the three', () => {
    const c = slinger('way-of-the-sniper', 15, false);
    expect(fromThree(lines(c, 'strikeDamage', 'gun1'))).toEqual([]);
    expect(fromThree(lines(c, 'strikeAttack', 'gun1'))).toEqual([]);
  });

  it('the stars are not suppressed by the shipped trust ledger, and no number moved (no overlay rows, only prose)', () => {
    const off = new Set(TRUST_LEDGER.lanes.situational);
    expect(IDS.filter((id) => off.has(id))).toEqual([]);
  });

  it('each registry entry is one line of notes: its `when` stays within the popup convention (test/rulings-dfgh.test.ts, 120)', () => {
    for (const id of IDS) {
      const rows = FEAT_SITUATIONAL[id];
      expect(rows?.length, id).toBe(1);
      expect(rows[0].when.length, id).toBeLessThanOrEqual(120);
    }
    expect(FEAT_SITUATIONAL['energy-shot'][0].targets).toEqual([{ kind: 'strikeDamage' }]);
    expect(FEAT_SITUATIONAL['fulminating-shot'][0].targets).toEqual([{ kind: 'strikeDamage' }]);
    expect(FEAT_SITUATIONAL['dispelling-bullet'][0].targets).toEqual([{ kind: 'strikeAttack' }]);
  });

  // mutation-proof
  it('planted: putting Fulminating Shot on the trust-off list hides its line (2 lines -> 1) — the approval is what lights it', () => {
    const c = slinger('way-of-the-spellshot', 15, true);
    expect(fromThree(lines(c, 'strikeDamage', 'gun1')).length).toBe(2);
    setSituationalTrustOff([...TRUST_LEDGER.lanes.situational, 'fulminating-shot']);
    try {
      expect(fromThree(lines(c, 'strikeDamage', 'gun1')).map(([id]) => id)).toEqual(['energy-shot']);
    } finally {
      setSituationalTrustOff(TRUST_LEDGER.lanes.situational);
    }
    expect(fromThree(lines(c, 'strikeDamage', 'gun1')).length).toBe(2);
  });
});
