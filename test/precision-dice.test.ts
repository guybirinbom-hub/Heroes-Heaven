import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import type { BuildState, } from '../src/rules/build';
import type { Character } from '../src/rules/types';

/**
 * Sneak Attack granted by a FEAT rather than by the rogue class.
 *
 * `grantsClassFeatures: ['sneak-attack']` is what made these three feats work at all. It also handed
 * them the ROGUE's progression — so every one of them over-granted past 5th level, on a feat whose
 * own sentence is "You don't increase the number of dice as you gain levels".
 */
const db = content();

const withFeat = (featId: string, level: number, classId = 'fighter'): Character =>
  build(classId, level, { featPicks: { '4:class': featId } } as Partial<BuildState>);

/** The precision rider shown on a qualifying strike, or ''. */
const precisionOf = (c: Character): string => {
  for (const s of deriveStrikes(c, db)) {
    const hit = (s.conditionalDamage ?? []).find((d) => /precision/.test(d.text));
    if (hit) return hit.text;
  }
  return '';
};

describe('a feat that caps its own dice', () => {
  it("Butterfly's Sting says the dice never increase", () => {
    const f = db.feats['butterflys-sting'];
    expect(f.description).toMatch(/don.t increase the number of dice/i);
    expect(f.grantsClassFeatures).toContain('sneak-attack');
    expect(f.precisionDice).toEqual({ dice: 1, die: 'd6' });
  });

  it('THE OVER-GRANT: it stays 1d6 at every level', () => {
    for (const lvl of [6, 11, 17, 20]) {
      const c = withFeat('butterflys-sting', lvl);
      expect(c.feats.some((f) => f.featId === 'butterflys-sting'), `lvl ${lvl}`).toBe(true);
      expect(precisionOf(c), `at level ${lvl} it must not follow the rogue's progression`).toBe('1d6 precision');
    }
  });

  it('Sneak Attacker ramps once, at the level its own text names', () => {
    expect(db.feats['sneak-attacker'].precisionDice).toEqual({ dice: 1, die: 'd4', upgradeAt: { level: 6, die: 'd6' } });
    expect(precisionOf(withFeat('sneak-attacker', 4))).toBe('1d4 precision');
    expect(precisionOf(withFeat('sneak-attacker', 6))).toBe('1d6 precision');
    expect(precisionOf(withFeat('sneak-attacker', 20)), 'and never again').toBe('1d6 precision');
  });

  it('Shadow Sneak Attack is flat "regardless of your level"', () => {
    expect(db.feats['shadow-sneak-attack'].description).toMatch(/regardless of your level/i);
    expect(precisionOf(withFeat('shadow-sneak-attack', 20))).toBe('1d6 precision');
  });
});

describe('a real rogue is untouched', () => {
  it('still scales 1d6 → 4d6 on the printed levels', () => {
    const at = (lvl: number) => precisionOf(build('rogue', lvl));
    expect(at(1)).toBe('1d6 precision');
    expect(at(5)).toBe('2d6 precision');
    expect(at(11)).toBe('3d6 precision');
    expect(at(17)).toBe('4d6 precision');
  });

  it('a rogue who ALSO takes one of these keeps the better, not the sum', () => {
    // "Sneak attack from multiple sources isn't cumulative."
    const c = build('rogue', 17, { featPicks: { '4:class': 'sneak-attacker' } } as Partial<BuildState>);
    expect(precisionOf(c)).toBe('4d6 precision');
  });
});

describe('nobody else gets it', () => {
  it('a plain fighter has no precision rider at all', () => {
    expect(precisionOf(build('fighter', 17))).toBe('');
  });

  it('the data survives a rebuild', async () => {
    const fs = await import('node:fs');
    const backfill = JSON.parse(fs.readFileSync('scripts/data/effect-backfill.json', 'utf8')) as {
      category: string;
      id: string;
      field: string;
      value: unknown;
    }[];
    for (const id of ['butterflys-sting', 'shadow-sneak-attack', 'sneak-attacker']) {
      const rows = backfill.filter((e) => e.category === 'feats' && e.id === id && e.field === 'precisionDice');
      expect(rows, `${id} has no backfill row`).toHaveLength(1);
      expect(rows[0].value).toEqual(db.feats[id].precisionDice);
    }
  });
});
