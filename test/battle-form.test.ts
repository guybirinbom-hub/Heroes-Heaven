import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { deriveAc, deriveSpeeds, deriveStrikes, deriveDefenses, deriveSize, strikesBlockedBy } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { emptyPlay, toggleMode, setTempHp, applyDamage } from '../src/rules/play';
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

  it('AC accepts the FORMULA every printed form actually states', () => {
    // No battle form in the game prints a flat AC — they all say "AC = N + your level". Typed as a
    // number the field could not hold one, so a pest-form druid would have sat at AC 15 forever.
    const { c, content: con } = mk({ ac: '15+@actor.level' });
    expect(deriveAc(c, con).value).toBe(25); // level 10
    expect(deriveAc(c, con).fromBattleForm).toBe(true);
  });
});

/**
 * The AUTHORING pass (scripts/apply-battle-forms.mjs). The lane above was built and carried zero
 * records, so none of it ran on any real character.
 */
describe('battleForm — the shipped modes', () => {
  const forms = () => Object.values(db().modes ?? {}).filter((m) => (m as ModeDef).battleForm) as ModeDef[];

  it('the content ships battle-form modes (it shipped with none)', () => {
    expect(forms().length).toBeGreaterThanOrEqual(16);
  });

  it('every battle-form mode is mutually exclusive and gated to the record that grants it', () => {
    const con = db();
    for (const m of forms()) {
      // Two forms at once would merge into a creature that exists in no book — activeBattleForm takes
      // the first and the rest silently vanish, so the data must not allow it.
      expect(`${m.id}: ${m.exclusiveGroup}`).toBe(`${m.id}: battle-form`);
      // Ungated modes are "general" and show for every character (modeRelevant), which would put
      // sixteen polymorph forms in front of a fighter who can use none of them.
      expect(`${m.id}: ${(m.feats ?? []).length > 0}`).toBe(`${m.id}: true`);
      for (const f of m.feats ?? []) expect(`${m.id}: ${f}`).toBe(`${m.id}: ${con.feats[f] ? f : 'NO SUCH FEAT'}`);
    }
  });

  it('every mode carries the full printed text, including the parts the app cannot compute', () => {
    // Ruling Q3's second half — "must make plain a mode is active and what changed" — plus principle
    // B: the note still has to carry the parts no field can hold (the +10 skill floors, the weakness
    // to physical damage). `size` and `tempHp` are no longer among them — they have readers now.
    for (const m of forms()) expect(`${m.id}: ${(m.note ?? '').length > 60}`).toBe(`${m.id}: true`);
  });

  it("a form's AC formula resolves against the character's own level", () => {
    const con = db();
    const critter = con.modes?.['critter-shape'] as ModeDef | undefined;
    expect(critter?.battleForm?.ac).toBe('15+@actor.level');
    const base = buildCharacter({ ...emptyBuild(), level: 8, ancestryId: 'dwarf', backgroundId: Object.keys(con.backgrounds)[0], classId: 'champion', subclassId: con.classes.champion?.subclass?.options?.[0]?.id ?? null, keyAbility: 'str' }, con);
    expect(deriveAc({ ...base, activeModes: [critter!] } as Character, con).value).toBe(23);
  });

  it('a form that says "you use your own AC and attack modifier" writes neither', () => {
    // Dragon Transformation. An absent field means "keep the character's own value", and that is the
    // ONLY way to say it — writing a guess would silently replace a real statistic.
    const dt = db().modes?.['dragon-transformation'] as ModeDef | undefined;
    expect(dt?.battleForm).toBeDefined();
    expect(dt?.battleForm?.ac).toBeUndefined();
    expect(dt?.battleForm?.attackMod).toBeUndefined();
    // …and no strikes either, because deriveStrikes would roll them at attackMod ?? 0.
    expect(dt?.battleForm?.strikes).toBeUndefined();
    expect(dt?.battleForm?.speeds?.fly).toBe(100);
  });

  it('no authored form prints Strikes without an attack modifier to roll them at', () => {
    for (const m of forms()) {
      const bf = m.battleForm!;
      const bad = (bf.strikes?.length ?? 0) > 0 && bf.attackMod == null;
      expect(`${m.id}: ${bad ? 'STRIKES AT +0' : 'ok'}`).toBe(`${m.id}: ok`);
    }
  });

  it('a form that grants a fly Speed and keeps its land Speed says both', () => {
    // `speeds` REPLACES the block outright, so 4th-rank pest form has to restate the 20-foot land
    // Speed or the bat would lose it — the trap that made a dwarf in pest form walk at 45.
    const bat = db().modes?.['bat-form'] as ModeDef | undefined;
    expect(bat?.battleForm?.speeds).toEqual({ land: 20, fly: 20 });
  });
});

/**
 * `size` was AUTHORED ON FOURTEEN FORMS AND READ BY NOTHING — the write-only-with-no-reader failure
 * this project has hit repeatedly. A stored value no code consumes is indistinguishable from a typo.
 *
 * Size is the one battle-form statistic the player needs at the table and cannot work out: it decides
 * the space you occupy and whether you fit through the gap, and a Huge worm was still labelled Medium.
 */
describe('a battle form changes what size you are', () => {
  it('the form’s size replaces the body’s, and names the form it came from', () => {
    const { c, content: con } = mk({ size: 'Tiny' });
    const s = deriveSize(c, con);
    expect(s.size).toBe('Tiny');
    expect(s.from).toBe('Pest Form');
  });

  it('a form that says nothing about size leaves the character’s own', () => {
    const { c, content: con } = mk({ ac: 15 });
    // The mk() character is a dwarf: medium, and no form size to override it.
    expect(deriveSize(c, con).size.toLowerCase()).toBe('medium');
    expect(deriveSize(c, con).from).toBeUndefined();
  });

  it('every authored form that names a size is a size the sheet can show', () => {
    const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
    const forms = Object.values(db().modes ?? {}).filter((m) => (m as ModeDef).battleForm) as ModeDef[];
    const withSize = forms.filter((m) => m.battleForm!.size);
    // The premise: the authoring pass really did write sizes. Without this the test below is vacuous.
    expect(withSize.length).toBeGreaterThanOrEqual(14);
    for (const m of withSize) expect(`${m.id}: ${m.battleForm!.size!.toLowerCase()}`).toBe(`${m.id}: ${SIZES.find((x) => x === m.battleForm!.size!.toLowerCase()) ?? 'UNKNOWN SIZE'}`);
  });
});

/**
 * `tempHp` was likewise authored on seven forms and read by nothing. "20 temporary Hit Points" is a
 * number the player has to have; leaving it in prose meant typing it in by hand from a note.
 *
 * Applied when the form is SWITCHED ON, which is when the rules grant it, and taken away again when
 * the form ends — but only if the pool is still the form's own.
 */
describe('a battle form’s temporary Hit Points', () => {
  const con = () => db();
  const form = (tempHp: number): Record<string, ModeDef> => ({
    'worm-test': { id: 'worm-test', name: 'Worm Form', modifiers: [], exclusiveGroup: 'battle-form', battleForm: { tempHp } },
  });

  it('switching the form on grants them', () => {
    const p = toggleMode(emptyPlay(), 'worm-test', form(40));
    expect(p.tempHp).toBe(40);
  });

  it('switching it off takes them away again', () => {
    const on = toggleMode(emptyPlay(), 'worm-test', form(40));
    const off = toggleMode(on, 'worm-test', form(40));
    expect(off.tempHp).toBe(0);
  });

  it('temporary Hit Points never stack — a bigger pool you already have is kept', () => {
    // PF2e: "If you gain temporary Hit Points when you already have some, choose whether to keep the
    // ones you have or the new ones." Raising is the only safe automatic answer.
    const rich = setTempHp(emptyPlay(), 50);
    const p = toggleMode(rich, 'worm-test', form(40));
    expect(p.tempHp).toBe(50);
    // …and leaving the form must not delete a pool the form never granted.
    expect(toggleMode(p, 'worm-test', form(40)).tempHp).toBe(50);
  });

  it('a pool the player set themselves survives leaving the form', () => {
    const on = toggleMode(emptyPlay(), 'worm-test', form(40));
    const mine = setTempHp(on, 12);
    expect(toggleMode(mine, 'worm-test', form(40)).tempHp).toBe(12);
  });

  it('once the pool is spent, leaving the form cannot take it negative or resurrect it', () => {
    const on = toggleMode(emptyPlay(), 'worm-test', form(40));
    const hurt = applyDamage(on, 40, 100);
    expect(hurt.tempHp).toBe(0);
    expect(toggleMode(hurt, 'worm-test', form(40)).tempHp).toBe(0);
  });

  it('a mode with no battle form leaves temporary Hit Points alone', () => {
    const plain: Record<string, ModeDef> = { x: { id: 'x', name: 'X', modifiers: [] } };
    const p = toggleMode(setTempHp(emptyPlay(), 7), 'x', plain);
    expect(p.tempHp).toBe(7);
    expect(toggleMode(p, 'x', plain).tempHp).toBe(7);
  });

  it('the shipped forms carry the temporary Hit Points their text prints', () => {
    expect((con().modes?.['worm-form-purple-worm'] as ModeDef).battleForm?.tempHp).toBe(40);
    expect((con().modes?.['storm-form'] as ModeDef).battleForm?.tempHp).toBe(20);
    expect((con().modes?.['dragon-transformation'] as ModeDef).battleForm?.tempHp).toBe(10);
  });
});

/**
 * "You can't make Strikes in this form" — a clause an empty `strikes` array could not express, because
 * an absent/empty list means "the form grants none" and leaves your weapons in place. Pest form,
 * A Little Bird Told Me and Bone Swarm all print it, and all three previously left a dwarf holding a
 * warhammer while shaped like a rat.
 */
describe('a form that forbids Strikes', () => {
  it('removes every Strike, including the always-present Fist', () => {
    const { c, content: con } = mk({ ac: '15+@actor.level', noStrikes: true });
    expect(deriveStrikes(c, con)).toEqual([]);
  });

  it('says which form did it, so an empty list does not read as a broken app', () => {
    const { c, content: con } = mk({ ac: '15+@actor.level', noStrikes: true });
    const by = strikesBlockedBy(c);
    expect(by, 'nothing tells the player why they have no Strikes').toBeDefined();
    expect(by!.name).toBe('Pest Form');
    // A character not in such a form gets nothing to display.
    const { c: normal } = mk({ ac: 15 });
    expect(strikesBlockedBy(normal)).toBeUndefined();
  });

  it('a form that GRANTS Strikes is untouched by the flag', () => {
    const { c, content: con } = mk({ attackMod: 12, strikes: [{ name: 'Jaws', damage: '1d6 piercing' }] });
    expect(deriveStrikes(c, con)).toHaveLength(1);
    expect(strikesBlockedBy(c)).toBeUndefined();
  });

  it('every form whose text prints the clause carries the flag, and no other does', () => {
    const con = db();
    // Measured, not guessed: the six pest-form variants ("⚠ You cannot make Strikes in this form")
    // plus Bone Swarm, whose sentence is "You cannot speak, Cast Spells, use manipulate actions,
    // Activate items, or Strike." Listed by id so the set is reviewable — a regex over the notes
    // silently missed Bone Swarm, which is exactly the record most in need of the flag.
    const BLOCKED = ['a-little-bird-told-me', 'bat-form', 'bone-swarm', 'crawling-form', 'critter-shape', 'form-of-the-bat', 'rat-form'];
    const forms = Object.values(con.modes ?? {}).filter((m) => (m as ModeDef).battleForm) as ModeDef[];
    const flagged = forms.filter((m) => m.battleForm!.noStrikes).map((m) => m.id).sort();
    expect(flagged).toEqual(BLOCKED);
  });

  it('and no form both forbids Strikes and lists some', () => {
    const forms = Object.values(db().modes ?? {}).filter((m) => (m as ModeDef).battleForm) as ModeDef[];
    for (const m of forms) {
      const bad = m.battleForm!.noStrikes && (m.battleForm!.strikes?.length ?? 0) > 0;
      expect(`${m.id}: ${bad ? 'CONTRADICTS ITSELF' : 'ok'}`).toBe(`${m.id}: ok`);
    }
  });
});
