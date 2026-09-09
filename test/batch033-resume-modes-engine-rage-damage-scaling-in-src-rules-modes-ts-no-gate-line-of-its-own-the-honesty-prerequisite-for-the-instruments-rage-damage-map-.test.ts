import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { deriveSpeeds, deriveStrikes } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { CATALOG_MODE_MAP, modeModifiersFor } from '../src/rules/modes';
import type { Character, ModeDef } from '../src/rules/types';

const db = content();
const anc = Object.keys(db.ancestries)[0];
const bg = Object.keys(db.backgrounds)[0];

/** A raging barbarian of the given instinct, wielding a NON-AGILE weapon so the rage rider carries its
 *  unhalved value ("This additional damage is halved if your weapon or unarmed attack is agile"). */
function ragingBarb(level: number, subclassId: string, modes: ModeDef[] = []): Character {
  const ch = buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId: 'barbarian',
      ancestryId: anc,
      backgroundId: bg,
      keyAbility: 'str',
      subclassId,
      inventory: [{ instanceId: 'w1', itemId: 'greatclub', quantity: 1, equipped: true }],
    },
    db,
  );
  return { ...ch, classResources: { ...ch.classResources, rage: 1 }, activeModes: modes };
}

const greatclub = (ch: Character) => deriveStrikes(ch, db).find((s) => /greatclub/i.test(s.name))!;

/** Every situational line on the greatclub's DAMAGE breakdown — the one list the mode's modifier and
 *  the Rage rider both land in (explain.ts pushes `modeAdjust` lines and `conditionalDamage` into it). */
function damageSituational(ch: Character): string[] {
  const s = greatclub(ch);
  return (explainStat(ch, db, { kind: 'strikeDamage', instanceId: s.instanceId }).situational ?? []).map((l) => l.text);
}

const rageLines = (ch: Character) => damageSituational(ch).filter((t) => /raging/i.test(t));

describe('decay-instinct — Rotting Rage damage has ONE carrier, and it scales', () => {
  /* *"When you rage, you can choose to increase the additional damage from Rage from 2 to 6 and change
   * its damage type to poison"* / *"When you use rotting rage, increase the additional damage from Rage
   * from 6 to 10… If you have greater weapon specialization, instead increase the damage from Rage when
   * using rotting rage from 10 to 18"* (AoN instinct-15). RAGE_DAMAGE['decay-instinct'] is that ladder;
   * `cat-rotting-rage` used to carry a second, FROZEN +6 beside it. */
  // batch 033: decay-instinct#rotting-rage-damage-scaling
  it('a raging decay-instinct barbarian reads 6 / 10 / 18 poison at levels 1 / 7 / 15', () => {
    const rider = (level: number) => greatclub(ragingBarb(level, 'decay-instinct')).conditionalDamage?.find((r) => r.note.includes('raging'));
    expect(rider(1)!.text).toBe('6 poison');
    expect(rider(7)!.text).toBe('10 poison');
    expect(rider(15)!.text).toBe('18 poison');
  });

  // batch 033: decay-instinct#rotting-rage-damage-scaling
  it('switching the decay-instinct Rotting Rage mode on adds no second damage line', () => {
    const mode = CATALOG_MODE_MAP['cat-rotting-rage'];
    // The mode carries no damage modifier at all any more — the ladder lives only on the rider.
    expect(modeModifiersFor([mode], { kind: 'damage' })).toEqual([]);
    const on = ragingBarb(15, 'decay-instinct', [mode]);
    // ONE rage line on the breakdown, and it is the tiered one; the frozen "+6 untyped from Rotting
    // Rage — melee or unarmed Strikes while raging" that used to sit beside it is gone.
    expect(rageLines(on)).toHaveLength(1);
    expect(rageLines(on)[0]).toContain('18 poison');
    expect(damageSituational(on).some((t) => /from Rotting Rage/.test(t))).toBe(false);
    // …and the prose the player reads beside it still states the ladder, so nothing contradicts.
    expect(mode.note).toMatch(/the damage is 10/);
    expect(mode.note).toMatch(/it is 18/);
  });
});

describe('ligneous-instinct — Wooden Rage keeps its Speed cost and drops the frozen damage copy', () => {
  /* *"While raging, you can increase the additional damage from Rage from 2 to 6. If you do this,
   * reduce your Speed by 10 feet"* / *"When you use wooden rage, increase the additional damage from
   * Rage from 6 to 10. If you have greater weapon specialization, instead… from 10 to 18"*
   * (AoN instinct-16). */
  // batch 033: ligneous-instinct#wooden-rage-mode
  it('a raging ligneous-instinct barbarian reads 6 / 10 / 18 at levels 1 / 7 / 15', () => {
    const rider = (level: number) => greatclub(ragingBarb(level, 'ligneous-instinct')).conditionalDamage?.find((r) => r.note.includes('raging'));
    expect(rider(1)!.text).toMatch(/^6 /);
    expect(rider(7)!.text).toMatch(/^10 /);
    expect(rider(15)!.text).toMatch(/^18 /);
  });

  // batch 033: ligneous-instinct#wooden-rage-mode
  it('the ligneous-instinct Wooden Rage mode still costs 10 feet of Speed, and prints no damage line', () => {
    const mode = CATALOG_MODE_MAP['cat-wooden-rage'];
    expect(modeModifiersFor([mode], { kind: 'damage' })).toEqual([]);
    const off = ragingBarb(15, 'ligneous-instinct');
    const on = ragingBarb(15, 'ligneous-instinct', [mode]);
    // The bark plates are the mode's OWN effect — nothing else carries them, so they stay here.
    expect(deriveSpeeds(on, db).land).toBe(deriveSpeeds(off, db).land - 10);
    expect(rageLines(on)).toHaveLength(1);
    expect(damageSituational(on).some((t) => /from Wooden Rage/.test(t))).toBe(false);
  });
});

describe('cat-cursebound stage toggles carry no modifiers ON PURPOSE (oracle)', () => {
  /* MEASURED REFUTATION of "cat-cursebound-1..4 modifiers:[] is an open modes.ts lane": the per-mystery
   * curse numbers ship in core.json's modes bucket as curse-of-<mystery>-1..4, each gated
   * feats:[<curse record id>] and sharing the SAME `oracle-cursebound` exclusive group — so a mystery's
   * own stage mode and the generic stage toggle can never both be on. Giving cat-cursebound-N numbers
   * would invent mystery-agnostic effects and double the ones that already ship. */
  it('the mystery-specific cursebound modes carry the numbers, in the same exclusive group', () => {
    const curses = Object.values(db.modes).filter((m) => /^curse-of-.*-[1-4]$/.test(m.id));
    expect(curses.length).toBeGreaterThanOrEqual(20);
    for (const m of curses) {
      expect(m.exclusiveGroup).toBe('oracle-cursebound');
      expect(m.feats?.length).toBeTruthy();
    }
    // At least one carries each shape the generic toggle is accused of missing.
    expect(curses.some((m) => (m.weaknesses ?? []).length > 0)).toBe(true);
    expect(curses.some((m) => m.modifiers.some((x) => x.target === 'attack' && x.value === -2))).toBe(true);
    expect(curses.some((m) => m.modifiers.some((x) => x.target === 'speed' && x.value === -10))).toBe(true);
    // The generic stage toggles stay bare, and in the same group, so they are alternatives.
    for (const id of ['cat-cursebound-1', 'cat-cursebound-2', 'cat-cursebound-3', 'cat-cursebound-4']) {
      expect(CATALOG_MODE_MAP[id].modifiers).toEqual([]);
      expect(CATALOG_MODE_MAP[id].exclusiveGroup).toBe('oracle-cursebound');
    }
  });
});
