import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';

const db = content();

/**
 * A STANCE THAT GRANTS A WEAPON MUST NOT ROLL IT AS AN UNARMED ATTACK.
 *
 * Haft Striker Stance prints *"You treat the haft of your wielded weapon as a SIMPLE WEAPON dealing
 * 1d4 damage. The haft is in the club group and has the agile and finesse traits."* Every other stance
 * Strike in the corpus is unarmed, so deriveStrikes forced the `unarmed` trait onto all of them,
 * rolled them at unarmed proficiency and buffed them with Handwraps of Mighty Blows. The haft is the
 * one that is not unarmed and it inherited all three.
 *
 * Wanderer's Guide agrees with the book — the item their feat hands out is category `simple`, group
 * `club`, agile + finesse — so ours was diverging from the printed text and from theirs at the same
 * time. This is the guard on the fix.
 *
 * The proficiency assertion uses a FIGHTER: their simple and unarmed ranks diverge (expert in simple
 * weapons at 1st, trained unarmed), so an attack rolled at the wrong one produces a different number.
 * A class where both ranks match would pass whichever branch ran, and prove nothing.
 */
describe('Haft Striker Stance grants a weapon, not an unarmed attack', () => {
  const haft = () => ({ ...build('fighter', 1), activeStance: 'haft-striker-stance' });
  const haftStrike = (c: ReturnType<typeof haft>) =>
    deriveStrikes(c, db).find((s) => s.name.toLowerCase() === 'haft');

  it('appears while the stance is entered', () => {
    expect(haftStrike(haft())).toBeDefined();
  });

  it('does not carry the unarmed trait the text never gives it', () => {
    const s = haftStrike(haft())!;
    expect(s.traits.map((t) => t.toLowerCase())).not.toContain('unarmed');
    /* The traits the text DOES print stay. */
    expect(s.traits.map((t) => t.toLowerCase())).toEqual(expect.arrayContaining(['agile', 'finesse']));
  });

  it('keeps the club group the text states outright', () => {
    expect(haftStrike(haft())!.group).toBe('club');
  });

  /*
   * WHICH PROFICIENCY THE STRIKE READS, asserted in both directions rather than by comparing the two
   * ranks — a 1st-level fighter is expert in simple weapons AND unarmed, so equal starting values
   * prove nothing either way. Demoting one track at a time does: only the track actually being read
   * can move the number.
   */
  const demote = (c: ReturnType<typeof haft>, track: 'simple' | 'unarmed') => ({
    ...c,
    proficiencies: { ...c.proficiencies, attacks: { ...c.proficiencies.attacks, [track]: 'untrained' as const } },
  });

  it('rolls at SIMPLE weapon proficiency — demoting that track lowers the attack', () => {
    const c = haft();
    expect(haftStrike(demote(c, 'simple'))!.attack[0]).toBeLessThan(haftStrike(c)!.attack[0]);
  });

  it('…and not at unarmed — demoting THAT track leaves it untouched', () => {
    const c = haft();
    expect(haftStrike(demote(c, 'unarmed'))!.attack[0]).toBe(haftStrike(c)!.attack[0]);
  });

  it('is not buffed by Handwraps of Mighty Blows, which do not affect weapons', () => {
    const c = haft();
    const bare = haftStrike(c)!;
    const wrapped = {
      ...c,
      inventory: [
        ...(c.inventory ?? []),
        {
          instanceId: 'hw',
          itemId: 'handwraps-of-mighty-blows',
          quantity: 1,
          invested: true,
          equipped: true,
          runes: { potency: 2, striking: 'greater' },
        },
      ],
    } as typeof c;
    const after = haftStrike(wrapped)!;
    expect(after.attack[0]).toBe(bare.attack[0]);
    expect(after.damage).toBe(bare.damage);
  });

  it('the correction survives `npm run data` — it is in effect-backfill.json', () => {
    const rows = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as {
      category: string; id: string; field: string; value: unknown;
    }[];
    const row = rows.find((r) => r.category === 'stances' && r.id === 'haft-striker-stance' && r.field === 'strikes');
    expect(row, 'effect-backfill.json is the only overlay a rebuild keeps').toBeDefined();
    const strikes = row!.value as { traits: string[]; weaponCategory?: string }[];
    expect(strikes[0].weaponCategory).toBe('simple');
    expect(strikes[0].traits).not.toContain('unarmed');
  });
});
