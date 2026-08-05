import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, deriveStrikes, strikeDamageRiders } from '../src/rules/derive';
import { modeRelevant } from '../src/rules/modes';
import type { Character, ModeDef } from '../src/rules/types';

/**
 * The last four toggles from the batch-2 coverage sweep.
 *
 * 108 were deferred in 2026-07 as "undeliverable as data" — item toggles needed a `fromItemId` mode
 * and feat toggles needed `feats: [id]` gating, and neither lane existed. Both exist now, so 104 of
 * the 108 were already covered by the time this ran. These are the remaining four.
 */
const db = content();
const modeOf = (id: string): ModeDef => {
  const m = db.modes?.[id];
  if (!m) throw new Error(`modes/${id} does not ship`);
  return m;
};
const withModes = (c: Character, ids: string[]): Character => ({ ...c, activeModes: ids.map(modeOf) });

describe('iron wine — the one that needed engine work', () => {
  it('rides extra damage on the unarmed attacks you already have', () => {
    // grantedStrikes would have granted a NEW attack, which is not what the item says.
    const m = modeOf('item-iron-wine');
    expect(m.strikeDamage).toEqual([
      { type: 'fire', appliesTo: 'unarmed', dice: { n: 1, die: 'd4' }, note: 'Iron wine' },
    ]);
    expect(m.fromItemId).toBe('iron-wine');
  });

  it('the rider reaches an UNARMED strike and nothing else', () => {
    const c = withModes(build('monk', 5), ['item-iron-wine']);
    const unarmed = strikeDamageRiders(c, db, { rank: 'expert', ranged: false, unarmed: true });
    const armed = strikeDamageRiders(c, db, { rank: 'expert', ranged: false, unarmed: false });
    expect(unarmed.join(' ')).toMatch(/1d4 fire/);
    expect(armed.join(' ')).not.toMatch(/1d4 fire/);
  });

  it('it shows on a real Strike row, not just in the helper', () => {
    const plain = build('monk', 5);
    const lit = withModes(plain, ['item-iron-wine']);
    const dmgOf = (c: Character) =>
      deriveStrikes(c, db)
        .filter((s) => s.traits.includes('unarmed'))
        .map((s) => s.damage)
        .join(' | ');
    expect(dmgOf(plain)).not.toMatch(/fire/);
    expect(dmgOf(lit), 'a monk drinking iron wine should see the fire on their fists').toMatch(/1d4 fire/);
  });

  it('the second cup is a WEAKNESS, and survives the rest that is meant to end it', () => {
    const m = modeOf('item-iron-wine-second-cup');
    expect(m.weaknesses).toEqual([{ type: 'fire', value: 5 }]);
    // "until your next daily preparations" outlasts a night's rest.
    expect(m.survivesRest).toBe(true);
    const d = deriveDefenses(withModes(build('monk', 5), ['item-iron-wine-second-cup']), db);
    expect(d.weaknesses.find((w) => w.type === 'fire')?.value).toBe(5);
  });
});

describe('stone brawler — a stance the stance list could never find', () => {
  it('the dedication grants a separate ACTION, which is why it was invisible', () => {
    // The stance list keys on the FEAT; the stance is its own action record.
    expect(db.feats['stone-brawler-dedication'].description).toMatch(/Stonestrike Stance/i);
    expect(db.actions['stonestrike-stance']).toBeTruthy();
    expect(db.stances?.['stone-brawler-dedication']).toBeUndefined();
  });

  it('the mode grants the stonestrike attack with its printed statistics', () => {
    const s = modeOf('stonestrike-stance').grantedStrikes?.[0];
    expect(s).toMatchObject({ name: 'Stonestrike', dice: 1, die: 'd8', damageType: 'bludgeoning', group: 'brawling' });
    expect(s!.traits).toEqual(expect.arrayContaining(['forceful', 'magical', 'unarmed']));
  });

  it('it is offered ONLY to a character who took the dedication', () => {
    const base = build('fighter', 10);
    const m = modeOf('stonestrike-stance');
    const featSet = (c: Character) => new Set(c.feats.map((f) => f.featId));
    const without = modeRelevant(m, base.classId, base.ancestryId, featSet(base));
    const withDed = { ...base, feats: [...base.feats, { featId: 'stone-brawler-dedication', level: 2 }] };
    const withFeat = modeRelevant(m, withDed.classId, withDed.ancestryId, featSet(withDed));
    expect(without, 'a fighter without the dedication must not see it').toBe(false);
    expect(withFeat).toBe(true);
  });
});

describe('the two that stay notes, and say so', () => {
  it('Inexorable Iron names the temp HP the player applies', () => {
    const m = modeOf('inexorable-iron');
    expect(m.note).toMatch(/temporary HP equal to half your level/i);
    expect(m.modifiers).toEqual([]); // it moves no number on its own
  });

  it('Engulfing Flames records the SUPPRESSION, which no field can carry', () => {
    const m = modeOf('curse-of-engulfing-flames');
    expect(m.note).toMatch(/suppressed/i);
    // Writing a fire resistance here would be exactly backwards — the curse turns yours OFF.
    expect(m.resistances ?? []).toEqual([]);
  });
});

describe('the batch-2 deferred pile is closed', () => {
  it('every deferred toggle now has a mode', async () => {
    const fs = await import('node:fs');
    const p = 'work/sweep/b2/toggles-deferred.json';
    if (!fs.existsSync(p)) return; // the working file is not required to ship
    const arr = JSON.parse(fs.readFileSync(p, 'utf8')) as { id: string; collection: string }[];
    const modes = Object.values(db.modes ?? {});
    const covered = (id: string) =>
      modes.some((m) => m.id === id || m.id === `item-${id}` || (m.feats ?? []).includes(id) || m.fromItemId === id || m.id.includes(id));
    const open = arr.filter((e) => !covered(e.id));
    expect(open.map((o) => o.id), 'deferred toggles still with no way to switch them on').toEqual([]);
  });
});
