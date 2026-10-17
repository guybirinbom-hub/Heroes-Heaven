import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveStrikes } from '../src/rules/derive';
import { importCharacter } from '../src/data/transfer';
import type { Character, ContentDatabase, GrantedStrike, ModeDef } from '../src/rules/types';

/**
 * LOST-CONDITION LANE (2026-10-17) — Werecreature Dedication, AoN feat-5486.
 *
 * Print, Change Shape: *"You transform into your hybrid or animal shape. … You gain a movement speed,
 * unarmed attacks, and potentially other abilities based on your werecreature type. These unarmed
 * attacks are in the brawling group."* The attacks come WITH the shape. The dedication's own
 * `grantedStrikes` put the type's jaws and claws on the Strikes tab in humanoid shape too — and, because
 * the build dedupes granted Strikes by name, it also hid a same-named ancestry attack (a ratfolk
 * werewolf's own Jaws) behind the werewolf's.
 *
 * The same attacks now ride the eighteen shape modes (`modes/were-<type>-animal|hybrid`) as
 * `ModeDef.grantedStrikes`, which deriveStrikes applies only while the mode is on. The modes are lit
 * under the trust gate (Wanderer's Guide encodes `conditional` on the dedication, the modes' carrier).
 * Mutation-proved in memory by planting the old feat-level row back. Synthetic characters only.
 */
const gated = content({ trustGate: true });
const FEAT = 'werecreature-dedication';

/** The page's Werecreature Types table: type -> attack names. */
const TABLE: Record<string, string[]> = {
  werebat: ['Fangs'],
  werebear: ['Jaws', 'Claw'],
  wereboar: ['Tusk'],
  werecrocodile: ['Jaws'],
  weremoose: ['Antler'],
  wererat: ['Jaws', 'Claw'],
  wereshark: ['Jaws'],
  weretiger: ['Jaws', 'Claw'],
  werewolf: ['Jaws'],
};

const were = (d: ContentDatabase, type: string, ancestryId = 'human'): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 'TEST lost-condition werecreature',
      level: 4,
      classId: 'fighter',
      keyAbility: 'str',
      ancestryId,
      backgroundId: Object.keys(d.backgrounds)[0],
      featPicks: { '2:class:0': FEAT },
      featChoices: { '2:class:0': type },
    } as BuildState,
    d,
  );
const inMode = (c: Character, d: ContentDatabase, id: string): Character => ({ ...c, activeModes: [d.modes[id] as ModeDef] });
const strikeNames = (c: Character, d: ContentDatabase) => deriveStrikes(c, d).map((s) => s.name);

/** What a werecreature in HUMANOID shape can strike with that print gives only to its shapes. */
function humanoidOverGrants(d: ContentDatabase): string[] {
  const out: string[] = [];
  for (const [type, names] of Object.entries(TABLE)) {
    const c = were(d, type);
    for (const n of names) if (strikeNames(c, d).includes(n)) out.push(`${type} has ${n} in humanoid shape`);
  }
  return out;
}

describe('Werecreature Dedication — the attacks belong to the shapes (gate ON)', () => {
  it('the build really holds the dedication and its answer (or every assertion below is vacuous)', () => {
    const c = were(gated, 'werebear');
    expect(c.feats.some((f) => f.featId === FEAT && f.choice?.value === 'werebear')).toBe(true);
    expect(gated.feats[FEAT]?.grantedStrikes).toBeUndefined();
  });

  it('no type has its attacks in humanoid shape', () => {
    expect(humanoidOverGrants(gated)).toEqual([]);
  });

  it('every type has its printed attacks in BOTH its shapes, and only its own', () => {
    for (const [type, names] of Object.entries(TABLE)) {
      for (const shape of ['animal', 'hybrid']) {
        const id = `were-${type}-${shape}`;
        expect(gated.modes[id], id).toBeTruthy();
        expect((gated.modes[id]?.grantedStrikes ?? []).map((s) => s.name), id).toEqual(names);
        const got = strikeNames(inMode(were(gated, type), gated, id), gated);
        for (const n of names) expect(got, `${id} -> ${n}`).toContain(n);
      }
    }
  });

  it('the shape attacks keep the printed dice and traits (werebear claw agile 1d6, werewolf jaws trip)', () => {
    const bear = deriveStrikes(inMode(were(gated, 'werebear'), gated, 'were-werebear-hybrid'), gated);
    const claw = bear.find((s) => s.name === 'Claw');
    expect(claw?.damage).toMatch(/^1d6\b/);
    expect(claw?.traits).toContain('agile');
    const wolf = deriveStrikes(inMode(were(gated, 'werewolf'), gated, 'were-werewolf-animal'), gated);
    expect(wolf.find((s) => s.name === 'Jaws')?.traits).toContain('trip');
  });

  it("a ratfolk werewolf's own ancestry Jaws is back in humanoid shape (the name dedup no longer hides it)", () => {
    const rat = were(gated, 'werewolf', 'ratfolk');
    const jaws = deriveStrikes(rat, gated).filter((s) => s.name === 'Jaws');
    expect(jaws).toHaveLength(1);
    expect(jaws[0].damage).toMatch(/^1d4\b/); // the ratfolk's 1d4, not the werewolf's 1d8
  });

  it('mutation-proof: the old feat-level row, planted back on the gated record, is caught', () => {
    const saved = gated.feats[FEAT];
    const OLD: GrantedStrike[] = Object.entries(TABLE).flatMap(([type, names]) =>
      names.map((name) => ({ name, die: 'd8', damageType: 'piercing', traits: ['unarmed'], group: 'brawling', choiceValue: type })),
    );
    (gated.feats as Record<string, unknown>)[FEAT] = { ...saved, grantedStrikes: OLD };
    try {
      const planted = humanoidOverGrants(gated);
      expect(planted).toContain('werebear has Jaws in humanoid shape');
      expect(planted).toContain('werewolf has Jaws in humanoid shape');
    } finally {
      gated.feats[FEAT] = saved;
    }
    expect(humanoidOverGrants(gated)).toEqual([]);
  });
});

/**
 * THE IMPORT PATH. Wanderer's Guide hands a werecreature its shape attacks as always-on
 * `unarmed_attack` items, and `transfer.ts` stores each unmatched one in `build.naturalAttacks`. While
 * the dedication carried the attacks itself, buildCharacter's "a stored attack yields to a grant" filter
 * dropped that stored copy; with the attacks moved onto the shape modes nothing matched it, so an
 * imported werewolf kept Jaws in humanoid shape and showed it TWICE in hybrid shape (round-2 check,
 * 2026-10-17). The stored copy now yields to the shape mode the character's own dedication answer
 * unlocks, as it yielded to the feat before.
 */
describe('Werecreature Dedication — an imported copy of a shape attack yields to the shape (gate ON)', () => {
  type Stored = { name: string; die: string; damageType: string; traits: string[]; group: string };
  /** What transfer.ts stores for an unmatched WG `unarmed_attack` row (name, die, type, unarmed, brawling). */
  const wg = (name: string, die: string, damageType: string): Stored => ({ name, die, damageType, traits: ['unarmed'], group: 'brawling' });
  const imported = (d: ContentDatabase, type: string, stored: Stored[], ancestryId = 'human'): Character =>
    buildCharacter(
      {
        ...emptyBuild(),
        name: 'TEST lost-condition werecreature import',
        level: 4,
        classId: 'fighter',
        keyAbility: 'str',
        ancestryId,
        backgroundId: Object.keys(d.backgrounds)[0],
        featPicks: { '2:class:0': FEAT },
        featChoices: { '2:class:0': type },
        naturalAttacks: stored.map((s) => ({ ...s, traits: [...s.traits] })),
      } as BuildState,
      d,
    );
  const named = (c: Character, d: ContentDatabase, name: string) => deriveStrikes(c, d).filter((s) => s.name === name);

  it("the round-2 probe: a werewolf with a stored 'Jaws' d8 has none in humanoid shape and exactly one in each shape", () => {
    const c = imported(gated, 'werewolf', [wg('Jaws', 'd8', 'piercing')]);
    expect(named(c, gated, 'Jaws')).toHaveLength(0);
    expect(named(inMode(c, gated, 'were-werewolf-hybrid'), gated, 'Jaws')).toHaveLength(1);
    expect(named(inMode(c, gated, 'were-werewolf-animal'), gated, 'Jaws')).toHaveLength(1);
  });

  it("the real WG item names ('Werebear Jaws' d8, 'Werebear Claw' d6 — WG items 13901/13902) yield by shape", () => {
    const c = imported(gated, 'werebear', [wg('Werebear Jaws', 'd8', 'piercing'), wg('Werebear Claw', 'd6', 'slashing')]);
    expect(strikeNames(c, gated).filter((n) => /Jaws|Claw/.test(n))).toEqual([]);
    const hybrid = strikeNames(inMode(c, gated, 'were-werebear-hybrid'), gated);
    expect(hybrid.filter((n) => n === 'Jaws')).toHaveLength(1);
    expect(hybrid.filter((n) => n === 'Claw')).toHaveLength(1);
    expect(hybrid.filter((n) => /^Werebear /.test(n))).toEqual([]);
  });

  it('a save does not carry the import copy forward (the round-trip stays clean)', () => {
    const b = deriveBuildFromCharacter(imported(gated, 'werewolf', [wg('Werewolf Jaws', 'd8', 'piercing')]), gated);
    expect(b.naturalAttacks ?? []).toEqual([]);
  });

  it("a yielded copy does not hide the ancestry's own attack: a ratfolk werewolf keeps its 1d4 Jaws", () => {
    // The stored names seed the build's dedup set; a copy that yields to a shape must not stay in it,
    // or the ratfolk's own Jaws grant is skipped as 'already imported' and then the import copy goes too.
    const rat = imported(gated, 'werewolf', [wg('Jaws', 'd8', 'piercing')], 'ratfolk');
    const jaws = named(rat, gated, 'Jaws');
    expect(jaws).toHaveLength(1);
    expect(jaws[0].damage).toMatch(/^1d4\b/);
  });

  it('only the shapes YOUR answer unlocks claim the copy: a wereboar (Tusk d8 slashing) keeps an imported Jaws d8 piercing', () => {
    const boar = imported(gated, 'wereboar', [wg('Jaws', 'd8', 'piercing')]);
    expect(named(boar, gated, 'Jaws')).toHaveLength(1);
    expect(named(inMode(boar, gated, 'were-wereboar-hybrid'), gated, 'Jaws')).toHaveLength(1);
  });

  it("shape alone never claims a stored attack (it would vanish from the sheet AND the save): a werebat's own Jaws d8 piercing stays beside its Fangs", () => {
    // Werebat Fangs are d8 piercing brawling — the same SHAPE as this Jaws. A mode claims on every build,
    // shape on or off, so the name must say it is the shape's attack ("Jaws", or "Werebat Fangs").
    const bat = imported(gated, 'werebat', [wg('Jaws', 'd8', 'piercing'), wg('Werebat Fangs', 'd8', 'piercing')]);
    expect(strikeNames(bat, gated).filter((n) => /Jaws|Fangs/.test(n))).toEqual(['Jaws']);
    expect(deriveBuildFromCharacter(bat, gated).naturalAttacks?.map((n) => n.name)).toEqual(['Jaws']);
    expect(strikeNames(inMode(bat, gated, 'were-werebat-hybrid'), gated).filter((n) => /Jaws|Fangs/.test(n)).sort()).toEqual(['Fangs', 'Jaws']);
  });

  it("the same rule for the other feat-gated mode with a Strike: a stone brawler's stored Stonestrike yields to the stance, its own Tail d8 bludgeoning stays", () => {
    const brawler = (d: ContentDatabase, stored: Stored[]) =>
      buildCharacter(
        {
          ...emptyBuild(),
          name: 'TEST lost-condition stone brawler import',
          level: 4,
          classId: 'fighter',
          keyAbility: 'str',
          ancestryId: 'human',
          backgroundId: Object.keys(d.backgrounds)[0],
          featPicks: { '2:class:0': 'stone-brawler-dedication' },
          naturalAttacks: stored.map((s) => ({ ...s, traits: [...s.traits] })),
        } as BuildState,
        d,
      );
    const STORED = [wg('Stonestrike', 'd8', 'bludgeoning'), wg('Tail', 'd8', 'bludgeoning')];
    // The stance's Strike is DARK under the trust gate (modes/stonestrike-stance is on the ledger's OFF
    // list), and a dark carrier claims nothing: the player keeps the attack they stored.
    expect(gated.modes['stonestrike-stance']?.grantedStrikes ?? []).toEqual([]);
    expect(strikeNames(brawler(gated, STORED), gated)).toEqual(expect.arrayContaining(['Stonestrike', 'Tail']));
    // With the carrier switched on (ungated content) the stance claims its own Strike and nothing else.
    const open = content();
    expect(open.modes['stonestrike-stance']?.grantedStrikes?.map((s) => [s.name, s.die, s.damageType])).toEqual([['Stonestrike', 'd8', 'bludgeoning']]);
    const c = brawler(open, STORED);
    expect(c.feats.some((f) => f.featId === 'stone-brawler-dedication')).toBe(true);
    expect(strikeNames(c, open)).not.toContain('Stonestrike');
    expect(strikeNames(c, open)).toContain('Tail');
    expect(strikeNames(inMode(c, open, 'stonestrike-stance'), open).filter((n) => n === 'Stonestrike')).toHaveLength(1);
  });

  it('end to end through the real WG import: Werewolf Jaws stays until the type is answered, then belongs to the shapes', () => {
    const item = (name: string, die: string, damageType: string) => ({
      item: { name, level: 0, meta_data: { category: 'unarmed_attack', damage: { damageType, dice: 1, die }, group: 'brawling' } },
      is_equipped: false,
      is_invested: false,
    });
    const file = JSON.stringify({
      version: 4,
      character: {
        name: 'TEST lost-condition werecreature WG import',
        level: 4,
        details: { ancestry: { name: 'Human' }, class: { name: 'Fighter' } },
        inventory: { coins: {}, items: [item('Werewolf Jaws', 'd8', 'piercing')] },
      },
      content: {
        attributes: {},
        proficiencies: {},
        feats_features: { classFeats: [{ name: 'Werecreature Dedication', level: 2 }], ancestryFeats: [], generalAndSkillFeats: [], otherFeats: [], heritages: [], classFeatures: [] },
        languages: [],
        spells: { cantrips: [], normal: [] },
      },
    });
    /** Humanoid / hybrid Strike names once the player answers 'werewolf' in the builder. */
    const answered = (d: ContentDatabase) => {
      const b = importCharacter(file, d).saved.build as BuildState;
      expect(b.naturalAttacks?.map((n) => n.name)).toEqual(['Werewolf Jaws']); // transfer.ts stored it
      const slot = Object.entries(b.featPicks ?? {}).find(([, v]) => v === FEAT)?.[0] as string;
      expect(slot).toBeTruthy();
      // Before the answer the app cannot know the type, so the import's own attack stays visible.
      expect(strikeNames(buildCharacter(b, d), d)).toContain('Werewolf Jaws');
      const c = buildCharacter({ ...b, featChoices: { ...(b.featChoices ?? {}), [slot]: 'werewolf' } }, d);
      return { humanoid: strikeNames(c, d), hybrid: strikeNames(inMode(c, d, 'were-werewolf-hybrid'), d) };
    };
    const got = answered(gated);
    expect(got.humanoid.filter((n) => /Jaws/.test(n))).toEqual([]);
    expect(got.hybrid.filter((n) => /Jaws/.test(n))).toEqual(['Jaws']);

    // mutation-proof: a shape whose attack no longer re-states the import (planted d10) is SEEN —
    // the stored copy comes back in humanoid shape, which the assertions above would refuse.
    const saved = gated.modes['were-werewolf-hybrid'];
    const savedAnimal = gated.modes['were-werewolf-animal'];
    const d10 = (m: ModeDef): ModeDef => ({ ...m, grantedStrikes: (m.grantedStrikes ?? []).map((s) => ({ ...s, die: 'd10' })) });
    gated.modes['were-werewolf-hybrid'] = d10(saved);
    gated.modes['were-werewolf-animal'] = d10(savedAnimal);
    try {
      expect(answered(gated).humanoid).toContain('Werewolf Jaws');
    } finally {
      gated.modes['were-werewolf-hybrid'] = saved;
      gated.modes['were-werewolf-animal'] = savedAnimal;
    }
  });

  it('a stored attack no shape grants is untouched (a manual Horn d6 bludgeoning stays)', () => {
    const c = imported(gated, 'werewolf', [wg('Horn', 'd6', 'bludgeoning')]);
    expect(strikeNames(c, gated)).toContain('Horn');
    expect(deriveBuildFromCharacter(c, gated).naturalAttacks?.map((n) => n.name)).toEqual(['Horn']);
  });
});
