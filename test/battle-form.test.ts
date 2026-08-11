import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { deriveAc, deriveSpeeds, deriveStrikes, deriveDefenses } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import type { BattleForm, Character, ModeDef } from '../src/rules/types';

/**
 * Battle forms are the one lane in this engine that REPLACES rather than adds (owner ruling Q3), and
 * every test here exists because the additive lane would have produced a specific wrong number.
 */
const db = () => content();

const mk = (form: BattleForm): { c: Character; content: ReturnType<typeof content> } => {
  const con = db();
  const base = buildCharacter(
    {
      ...emptyBuild(), level: 10, ancestryId: 'dwarf', backgroundId: Object.keys(con.backgrounds)[0],
      classId: 'champion', subclassId: con.classes.champion?.subclass?.options?.[0]?.id ?? null, keyAbility: 'str',
    },
    con,
  );
  const mode: ModeDef = { id: 'test-form', name: 'Pest Form', modifiers: [], exclusiveGroup: 'battle-form', battleForm: form };
  return { c: { ...base, activeModes: [mode] }, content: con };
};

describe('battle forms replace rather than add', () => {
  it('AC is SET, not increased — the additive lane would have added it to a champion’s armour', () => {
    const { c, content: con } = mk({ ac: 15 });
    const plain = deriveAc(buildCharacter({ ...emptyBuild(), level: 10, ancestryId: 'dwarf', backgroundId: Object.keys(con.backgrounds)[0], classId: 'champion', subclassId: con.classes.champion?.subclass?.options?.[0]?.id ?? null, keyAbility: 'str' }, con), con).value;
    expect(plain).toBeGreaterThan(15); // a level-10 champion out-armours a pest
    const ac = deriveAc(c, con);
    expect(ac.value).toBe(15);
    expect(ac.fromBattleForm).toBe(true);
  });

  it('the AC breakdown does not print parts that fail to sum to the number', () => {
    const { c, content: con } = mk({ ac: 15 });
    const b = explainStat(c, con, { kind: 'ac' });
    expect(b.totalText).toBe('15');
    expect(b.parts).toHaveLength(1);
    expect(b.parts[0].value).toBe(15);
    expect(b.parts.reduce((n, p) => n + (p.value ?? 0), 0)).toBe(15);
    expect(b.description).toContain('states its AC outright');
  });

  it('Speed is REPLACED — a dwarf in pest form walks 20, not 20 plus 20', () => {
    const { c, content: con } = mk({ speeds: { land: 20 } });
    expect(deriveSpeeds(c, con).land).toBe(20);
  });

  it('a form that grants only a fly Speed takes the land Speed away', () => {
    const { c, content: con } = mk({ speeds: { fly: 30 } });
    const sp = deriveSpeeds(c, con);
    expect(sp.fly).toBe(30);
    expect(sp.land ?? 0).toBe(0);
  });

  it('the form’s Strikes replace every other Strike, including the always-present Fist', () => {
    const { c, content: con } = mk({
      attackMod: 12,
      strikes: [{ name: 'Jaws', damage: '1d6 piercing', traits: ['unarmed', 'finesse'] }],
    });
    const strikes = deriveStrikes(c, con);
    expect(strikes).toHaveLength(1);
    expect(strikes[0].name).toBe('Jaws');
    expect(strikes.some((s) => s.name === 'Fist')).toBe(false);
  });

  it('a form Strike’s numbers are printed and complete — no ability, no runes', () => {
    const { c, content: con } = mk({ attackMod: 12, strikes: [{ name: 'Jaws', damage: '1d6 piercing' }] });
    const s = deriveStrikes(c, con)[0];
    expect(s.attack).toEqual([12, 7, 2]);
    expect(s.damage).toBe('1d6 piercing');
    expect(s.dmgAbility).toBeNull();
    expect(s.dmgAbMod).toBe(0);
    expect(s.potencyBonus).toBe(0);
    expect(s.fromBattleForm).toBe(true);
  });

  it('an agile form Strike steps the MAP by 4, not 5', () => {
    const { c, content: con } = mk({ attackMod: 12, strikes: [{ name: 'Claw', damage: '1d4 slashing', traits: ['agile'] }] });
    expect(deriveStrikes(c, con)[0].attack).toEqual([12, 8, 4]);
  });

  it('senses are REPLACED — a form can take darkvision away, which the best-of merge never could', () => {
    const { c, content: con } = mk({ senses: [{ name: 'echolocation', range: 30, acuity: 'precise' }] });
    const senses = deriveDefenses(c, con).senses.map((s) => s.name);
    expect(senses).toContain('echolocation');
    // A dwarf has darkvision by ancestry; the form must remove it.
    expect(senses).not.toContain('darkvision');
  });

  it('a form that says nothing about a stat leaves it alone', () => {
    const { c, content: con } = mk({ ac: 15 });
    // No `speeds` on the form, so the dwarf keeps their own.
    expect(deriveSpeeds(c, con).land).toBeGreaterThan(0);
    // No `senses` either.
    expect(deriveDefenses(c, con).senses.length).toBeGreaterThan(0);
  });

  it('no battle form active changes nothing', () => {
    const con = db();
    const plain = buildCharacter({ ...emptyBuild(), level: 10, ancestryId: 'dwarf', backgroundId: Object.keys(con.backgrounds)[0], classId: 'champion', subclassId: con.classes.champion?.subclass?.options?.[0]?.id ?? null, keyAbility: 'str' }, con);
    expect(deriveAc(plain, con).fromBattleForm).toBeUndefined();
    expect(deriveStrikes(plain, con).some((s) => s.fromBattleForm)).toBe(false);
  });
});
