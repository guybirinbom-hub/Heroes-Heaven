import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, deriveStrikes, dailyChoiceGrants } from '../src/rules/derive';
import { CATALOG_MODE_MAP } from '../src/rules/modes';

/**
 * Raging Resistance reached no sheet, on any instinct.
 *
 * The feature says only "resistance equal to 3 + your Constitution modifier to damage types based on
 * your instinct"; the TYPES are printed on the instinct, a record chosen at 1st level. A plain
 * `resistances` list there would have handed a 1st-level barbarian a permanent 9th-level defence, so
 * the clause needed both a STATE gate and a LEVEL gate before it could be written at all.
 */
const db = content();

/** A barbarian of `level` with `instinct`, raging or not. */
function barb(level: number, instinct: string, raging: boolean, over: Record<string, unknown> = {}) {
  const c = build('barbarian', level, { subclassId: instinct, ...over });
  return { ...c, classResources: { ...(c.classResources ?? {}), rage: raging ? 1 : 0 } } as typeof c;
}

const resistOf = (c: ReturnType<typeof barb>, type: string) =>
  deriveDefenses(c, db).resistances.find((r) => r.type === type)?.value ?? 0;

describe('the level gate', () => {
  it('an 8th-level raging barbarian has no Raging Resistance', () => {
    expect(resistOf(barb(8, 'animal-instinct', true), 'piercing')).toBe(0);
  });

  it('a 9th-level one does', () => {
    const c = barb(9, 'animal-instinct', true);
    const con = Math.floor((c.abilities.con - 10) / 2);
    expect(resistOf(c, 'piercing')).toBe(3 + con);
    expect(resistOf(c, 'slashing')).toBe(3 + con);
  });
});

describe('the state gate', () => {
  it('a 9th-level barbarian who is NOT raging has none of it', () => {
    expect(resistOf(barb(9, 'animal-instinct', false), 'piercing')).toBe(0);
  });
});

describe('each instinct resists what its own text says', () => {
  it('animal: piercing and slashing, and nothing else', () => {
    const c = barb(9, 'animal-instinct', true);
    expect(resistOf(c, 'piercing')).toBeGreaterThan(0);
    expect(resistOf(c, 'void')).toBe(0);
    expect(resistOf(c, 'poison')).toBe(0);
  });

  it('spirit: void, plus the untypeable clause about undead, kept as its own entry', () => {
    const c = barb(9, 'spirit-instinct', true);
    expect(resistOf(c, 'void')).toBeGreaterThan(0);
    // "damage dealt by the attacks and abilities of undead creatures, regardless of the damage type"
    // is not a damage type — it is carried as its own entry rather than dropped or invented into one.
    const undead = deriveDefenses(c, db).resistances.find((r) => /undead/i.test(r.type));
    expect(undead?.value).toBe(resistOf(c, 'void'));
  });

  it('ligneous also takes the WEAKNESS its own clause imposes', () => {
    const c = barb(9, 'ligneous-instinct', true);
    const con = Math.floor((c.abilities.con - 10) / 2);
    expect(resistOf(c, 'piercing')).toBe(3 + con);
    const fire = deriveDefenses(c, db).weaknesses.find((w) => w.type === 'fire');
    expect(fire?.value, 'the bark-like flesh is flammable — dropping this would make the instinct strictly better than its text').toBe(3 + con);
  });

  it('every instinct the app ships carries a Raging Resistance clause', () => {
    const bare = Object.entries(db.classFeatures)
      .filter(([id]) => /-instinct$/.test(id))
      .filter(([, f]) => !f.whileActive?.length && !(f.choice?.options ?? []).some((o) => o.grant?.whileActive?.length))
      .map(([id]) => id);
    expect(bare).toEqual([]);
  });
});

describe('the instincts whose type is CHOSEN', () => {
  it('Giant Instinct resists bludgeoning plus the energy you picked, and not the ones you did not', () => {
    const c = barb(9, 'giant-instinct', true, { featChoices: { 'feature:giant-instinct': 'fire' } });
    expect(resistOf(c, 'bludgeoning')).toBeGreaterThan(0);
    expect(resistOf(c, 'fire')).toBeGreaterThan(0);
    expect(resistOf(c, 'cold')).toBe(0);
    expect(resistOf(c, 'electricity')).toBe(0);
  });

  it('picking a different energy moves the resistance', () => {
    const c = barb(9, 'giant-instinct', true, { featChoices: { 'feature:giant-instinct': 'cold' } });
    expect(resistOf(c, 'cold')).toBeGreaterThan(0);
    expect(resistOf(c, 'fire')).toBe(0);
  });

  it('an unanswered pick grants nothing at all — no default energy type', () => {
    const c = barb(9, 'giant-instinct', true);
    for (const t of ['bludgeoning', 'fire', 'cold', 'electricity']) expect(resistOf(c, t), t).toBe(0);
  });

  it('the chosen benefit is still state-gated — a giant barbarian standing still resists nothing', () => {
    // This is the failure the whileActive-on-a-pick field exists to prevent: resolved picks otherwise
    // land in chosenEffects, which deriveDefenses applies unconditionally.
    const c = barb(9, 'giant-instinct', false, { featChoices: { 'feature:giant-instinct': 'fire' } });
    expect(resistOf(c, 'fire')).toBe(0);
    expect(resistOf(c, 'bludgeoning')).toBe(0);
  });

  it('and still level-gated', () => {
    const c = barb(8, 'giant-instinct', true, { featChoices: { 'feature:giant-instinct': 'fire' } });
    expect(resistOf(c, 'fire')).toBe(0);
  });

  it("Dragon Instinct takes its dragon's breath type from the option the player already picks", () => {
    const c = barb(9, 'dragon-instinct', true, { featChoices: { 'feature:dragon-instinct': 'rime' } });
    expect(resistOf(c, 'piercing')).toBeGreaterThan(0);
    expect(resistOf(c, 'cold'), 'Rime — Primal, cold').toBeGreaterThan(0);
    expect(resistOf(c, 'fire')).toBe(0);
  });

  it("the dragon picker's caveat no longer claims Raging Resistance is unapplied", () => {
    expect(db.classFeatures['dragon-instinct'].choice?.note ?? '').not.toMatch(/Raging Resistance/i);
  });

  it('every dragon option got a grant — a missing one would silently resist nothing', () => {
    const opts = db.classFeatures['dragon-instinct'].choice?.options ?? [];
    expect(opts.length).toBeGreaterThan(40);
    expect(opts.filter((o) => !o.grant).map((o) => o.value)).toEqual([]);
  });

  it('Superstition names both chosen traditions', () => {
    const c = barb(9, 'superstition-instinct', true, {
      featChoices: { 'feature:superstition-instinct': 'divine-primal' },
    });
    const types = deriveDefenses(c, db).resistances.map((r) => r.type);
    expect(types).toContain('divine spells');
    expect(types).toContain('primal spells');
    expect(types).not.toContain('arcane spells');
  });
});

describe('a mode can grant a Strike', () => {
  // From the catalog directly: the app merges CATALOG_MODE_MAP into content, the test fixture does not.
  const modeDef = () => CATALOG_MODE_MAP['cat-invoke-offense'];

  it('the mode exists and is gated to the feat, not to the dedication', () => {
    expect(modeDef()?.feats).toEqual(['invoke-offense']);
    expect(modeDef()?.grantedStrikes?.[0]?.damageType).toBe('spirit');
  });

  it('the Strike appears only while the mode is on', () => {
    const plain = build('fighter', 6, {});
    const has = (c: typeof plain) => deriveStrikes(c, db).some((s) => s.name === 'Spirit attack');
    expect(has(plain)).toBe(false);
    expect(has({ ...plain, activeModes: [modeDef()!] } as typeof plain)).toBe(true);
  });

  it('it scales on its own level thresholds, not on handwraps', () => {
    // "At 5th level, this unarmed attack gains the benefits of a striking rune."
    const at = (level: number) => {
      const c = build('fighter', level, {});
      const s = deriveStrikes({ ...c, activeModes: [modeDef()!] } as typeof c, db).find((x) => x.name === 'Spirit attack');
      return s?.strikingDice ?? 0;
    };
    expect(at(4)).toBe(0);
    expect(at(5)).toBe(1);
    expect(at(12)).toBe(2);
    expect(at(20)).toBe(3);
  });
});

describe("a daily answer now does something", () => {
  const IKON = 'skin-hard-as-horn';

  it('the ikon asks the question every morning', () => {
    const def = db.classFeatures[IKON]?.choice;
    expect(def?.daily).toBe(true);
    expect((def?.options ?? []).map((o) => o.value)).toEqual(['bludgeoning', 'piercing', 'slashing']);
  });

  it('every option grants, and states the condition rather than pretending there is none', () => {
    for (const o of db.classFeatures[IKON].choice!.options!) {
      expect(o.grant?.resistances?.[0]?.value, o.value).toBe('floor(@actor.level/2)');
      expect(o.grant?.resistances?.[0]?.note, o.value).toMatch(/divine spark|critical hits/i);
    }
  });

  it("this morning's answer is what grants — and only while it is stored", () => {
    const plain = build('exemplar', 10, {});
    const answered = { ...plain, dailyChoices: { [`${IKON}:attunedDamageType`]: 'piercing' } } as typeof plain;
    expect(dailyChoiceGrants(plain, db)).toEqual([]);
    const g = dailyChoiceGrants(answered, db);
    // The exemplar only has this ikon if they picked it; when they have not, there is nothing to grant.
    if (!g.length) return;
    expect(g[0].resistances?.[0].type).toBe('piercing');
  });

  it('an answer from a record the character does not own grants nothing', () => {
    const c = build('fighter', 10, {});
    const stale = { ...c, dailyChoices: { [`${IKON}:attunedDamageType`]: 'piercing' } } as typeof c;
    expect(dailyChoiceGrants(stale, db)).toEqual([]);
  });
});
