import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { deriveArmorCheckPenalty, deriveMaxHp, deriveStrikes, ownedFeatureIds } from '../src/rules/derive';
import { deriveAnimalCompanion } from '../src/rules/companions';
import type { InventoryItem } from '../src/rules/types';

/** The deferred bespoke tail — each of these needed its own logic rather than a shared lane. */
const c = () => content();

describe('Belt of Good Health', () => {
  it('adds its +4 to maximum HP while worn', () => {
    const belt: InventoryItem = { instanceId: 'b', itemId: 'belt-of-good-health', quantity: 1, worn: true, invested: true };
    const without = build('fighter', 5);
    const withIt = build('fighter', 5, { inventory: [belt] });
    // maxHpBonus walked FEATS only, so an item carrying one did nothing.
    expect(deriveMaxHp(withIt, c()) - deriveMaxHp(without, c())).toBe(4);
  });
});

describe('Monk Dedication', () => {
  it('grants the Powerful Fist class feature it says it grants', () => {
    const ch = build('fighter', 4, { featPicks: { '2:class:0': 'monk-dedication' } });
    expect([...ownedFeatureIds(ch, c())]).toContain('powerful-fist');
  });
});

describe('Armored Stealth', () => {
  const inArmor = (has: boolean, stealth: 'trained' | 'master' | 'legendary') => {
    const ch = build('fighter', 15, {
      featPicks: has ? { '1:skill:0': 'armored-stealth' } : {},
      inventory: [{ instanceId: 'a', itemId: 'half-plate', quantity: 1, worn: true }],
    });
    ch.proficiencies.skills.stealth = stealth;
    ch.abilities = { ...ch.abilities, str: 8 }; // below the armour's Strength requirement
    return deriveArmorCheckPenalty(ch, c(), 'stealth').value;
  };
  it('reduces the Stealth check penalty, and more at higher ranks', () => {
    const base = inArmor(false, 'trained');
    expect(base).toBeLessThan(0);
    expect(inArmor(true, 'trained')).toBe(base + 1);
    expect(inArmor(true, 'master')).toBe(base + 2);
    expect(inArmor(true, 'legendary')).toBe(base + 3);
  });
  it('leaves other skills alone — the feat is Stealth-only', () => {
    const ch = build('fighter', 15, {
      featPicks: { '1:skill:0': 'armored-stealth' },
      inventory: [{ instanceId: 'a', itemId: 'half-plate', quantity: 1, worn: true }],
    });
    ch.abilities = { ...ch.abilities, str: 8 };
    const plain = build('fighter', 15, { inventory: [{ instanceId: 'a', itemId: 'half-plate', quantity: 1, worn: true }] });
    plain.abilities = { ...plain.abilities, str: 8 };
    expect(deriveArmorCheckPenalty(ch, c(), 'athletics').value).toBe(deriveArmorCheckPenalty(plain, c(), 'athletics').value);
  });
});

describe('Circle of Spirits', () => {
  /*
   * This used to build `animist` 6 with no apparitions and assert `withIt >= plain` and `<= 3`. An
   * animist who has attuned nothing has NO focus entry at all, so both sides were `undefined`, the
   * assertions reduced to `0 >= 0` and `0 <= 3`, and the test could not fail for any implementation —
   * including the feature being deleted outright. Apparitions have to be attuned before an animist
   * has a pool to raise.
   */
  const APPS = (content().classes.animist.extraChoices?.find((g) => g.id === 'apparition')?.options ?? []).map(
    (o) => (o as { value?: string; id?: string }).value ?? (o as { id: string }).id,
  );
  const animist = (practice: string, feat: string, apparitions = 4) =>
    build('animist', 12, {
      subclassId: practice,
      extraChoices: { apparition: APPS.slice(0, apparitions) },
      featPicks: { '4:class:0': feat } as never,
    });

  it('the pool is the HIGHER of the apparition ladder and the focus-spell count, capped at 3', () => {
    // A liturgist is granted Circle of Spirits by their practice (classFeatures.liturgist.grantsFeats),
    // so it never enters `featPicks`. The gate reads the transitive owned-feature closure for exactly
    // this reason; while it read `featPicks` the liturgist — the one character who always has this
    // feature — was the one character it never applied to. A medium taking the same feat is the
    // control: same level, same apparitions, same feat, and no Circle of Spirits.
    expect((content().classFeatures['liturgist'] as { grantsFeats?: string[] }).grantsFeats).toContain('circle-of-spirits');
    expect(animist('liturgist', 'rites-of-liberation').focus?.max, 'liturgist reaches the focus-spell count').toBe(3);

    /*
     * ⚠ THE MEDIUM WAS THE WRONG CONTROL, and asserting 2 here froze a real defect in place.
     *
     * This case picked the Medium as "an animist without Circle of Spirits", but the Medium reaches the
     * SAME clause by its own route: *"Dual Invocation (9TH): … you can select TWO of your attuned
     * apparitions to be your primary apparitions… The number of Focus Points in your focus pool is
     * equal to the number of focus spells you have or the number of PRIMARY apparitions you are
     * attuned to, whichever is higher (maximum 3)."* At 12th with this many apparitions that is 3, and
     * ours said 2 because nothing read the practice at all — found by the Wanderer's Guide parity audit.
     *
     * The control that actually isolates Circle of Spirits is a Medium BELOW 9th, where Dual Invocation
     * has not arrived yet.
     */
    expect(animist('medium', 'rites-of-liberation').focus?.max, 'a 12th-level Medium has Dual Invocation').toBe(3);
  });

  it('the Medium reaches its own clause only from 9th level', () => {
    /* Below 9th a Medium has one primary apparition like everyone else, so the ladder still governs. */
    const below = build('animist', 8, {
      subclassId: 'medium',
      extraChoices: { apparition: APPS.slice(0, 4) },
      featPicks: { '4:class:0': 'rites-of-liberation' } as never,
    });
    expect(below.focus?.max, 'Dual Invocation has not arrived').toBeLessThan(3);
  });

  it('a focusPoolBonus feat raises the animist pool too', () => {
    /*
     * `poolMax += featPoolBonus` in the animist branch — before this the animist was the one class
     * whose pool ignored such feats entirely.
     *
     * ⚠ The example used to be Universal Versatility, which is no longer a pool-ONLY feat: it prints
     * *"during your daily preparations, choose one of the school spells"* and now carries that choice,
     * so the chosen SPELL brings the point and the flat bonus was removed to stop it paying twice.
     * Psi Development is a pool feat that demonstrably reaches this branch — verified by sweeping every
     * focusPoolBonus feat rather than picking one that merely looks equivalent.
     */
    expect(content().feats['psi-development']?.focusPoolBonus).toBe(1);
    expect(animist('medium', 'psi-development').focus?.max).toBe(3);
    expect(animist('liturgist', 'psi-development').focus?.max).toBe(3);
  });
});

describe('Strength of Eight Legions', () => {
  it('adds its +2 damage to Strikes', () => {
    const inv: InventoryItem = { instanceId: 'w', itemId: 'longsword', quantity: 1, equipped: true };
    const plain = build('fighter', 12, { inventory: [inv] });
    const withIt = build('fighter', 12, { featPicks: { '12:class:0': 'strength-of-eight-legions' }, inventory: [inv] });
    const dmg = (x: ReturnType<typeof build>) => deriveStrikes(x, c()).find((s) => s.name === c().items.longsword.name)?.damage ?? '';
    expect(dmg(withIt)).not.toBe(dmg(plain));
  });
});

describe('Terrain Scout and Ancient Memories', () => {
  it('Terrain Scout asks for BOTH terrains', () => {
    const f = c().feats['terrain-scout'];
    expect(f?.choice?.picks).toBe(2);
    expect(f?.choice?.distinct).toBe(true);
    expect((f?.choice?.options ?? []).length).toBeGreaterThan(1);
  });
  it('Ancient Memories is a daily choice like its six siblings', () => {
    expect(c().feats['ancient-memories']?.choice?.daily).toBe(true);
    // It WAS `kind: 'skills'`, which `askedAtDailyPrep` cannot render at the Rest sheet — so the
    // question fell back to the builder, where 'skills' resolves through `trainedSkillOptions` and
    // offered only skills the character was ALREADY trained in, i.e. every option a wasted grant.
    // Now the same array shape as its siblings Haunting Memories and Endless Memories.
    expect(c().feats['ancient-memories']?.choice?.kind).toBe('array');
    expect((c().feats['ancient-memories']?.choice?.options ?? []).every((o) => o.grant?.skills)).toBe(true);
  });
});

describe('companion ranged weapons', () => {
  it('labels a wielded bow Ranged and drops Strength from its damage', () => {
    const ch = build('ranger', 6, {
      featPicks: { '1:class:0': 'animal-companion' },
      companions: [
        {
          id: 'c1',
          kind: 'animal',
          name: 'Fang',
          typeId: Object.keys(c().animalCompanions)[0],
          inventory: [{ instanceId: 'w', itemId: 'shortbow', quantity: 1, equipped: true }],
        },
      ],
    });
    const cfg = ch.companions![0];
    const block = deriveAnimalCompanion(cfg, c().animalCompanions[cfg.typeId!], ch.level, c());
    const bow = block.attacks.find((a) => a.name === c().items.shortbow.name);
    expect(bow, 'the wielded bow becomes a strike').toBeTruthy();
    // A shortbow is `range: 60` with traits [deadly-d10] — no ranged or thrown trait at all, which is
    // why a trait-only test called it Melee.
    expect(c().items.shortbow.traits).not.toContain('ranged');
    expect(bow!.range).toBe(60);
  });
});

describe('the last bare feats', () => {
  it('Master Alchemy raises the advanced alchemy LEVEL, not the item count', () => {
    const plain = build('fighter', 14, { featPicks: { '2:class:0': 'alchemist-dedication' } });
    const withIt = build('fighter', 14, { featPicks: { '2:class:0': 'alchemist-dedication', '12:class:0': 'master-alchemy' } });
    // "increases to 7. For every level you gain beyond 12th, it increases by 1." At 14th that is 9.
    expect(withIt.advancedAlchemy?.level).toBe(9);
    expect(plain.advancedAlchemy?.level ?? 0).toBeLessThan(9);
  });

  it('Armored Exercise raises armour ranks it finds at trained', () => {
    const ch = build('rogue', 14, { featPicks: { '14:class:0': 'armored-exercise' } });
    // The lane only ever RAISES, which is the feat's "for whichever of those you already had".
    expect(ch.proficiencies.defenses.light).toBe('expert');
  });

  it("Forge Day's Rest hands over the feat it says it does", () => {
    const ch = build('fighter', 3, { ancestryId: 'dwarf', featPicks: { '1:ancestry:0': 'forge-days-rest' } });
    expect(ch.feats.map((f) => f.featId)).toContain('fast-recovery');
  });

  it('the three crit-spec feats each narrow to their own weapons', () => {
    for (const [id, key] of [
      ['improvisational-warrior', 'groups'],
      ['viking-weapon-specialist', 'bases'],
      ['catfolk-weapon-rake', 'traits'],
    ] as const) {
      const rec = content().feats[id];
      expect(rec?.critSpec, id).toBe(true);
      // Unnarrowed would light crit spec up on every Strike the character makes.
      expect((rec?.critSpecWeapons as Record<string, unknown> | undefined)?.[key], id).toBeTruthy();
    }
  });
});

describe('extra reactions', () => {
  it('counts the restricted second reaction a feat grants, and says what it is for', () => {
    const ch = build('fighter', 10, { featPicks: { '8:class:0': 'quick-shield-block', '10:class:0': 'tactical-reflexes' } });
    // Everyone has one unrestricted reaction; these are additional and each names its own use.
    expect(ch.extraReactions?.map((r) => r.usableFor).sort()).toEqual(['Shield Block', 'a Reactive Strike']);
    expect(ch.extraReactions?.every((r) => r.count === 1 && r.from)).toBe(true);
  });
  it('grants none without a feat that says so', () => {
    expect(build('fighter', 10).extraReactions).toBeUndefined();
  });
  it('all 15 records carry the field', () => {
    const withField = Object.values(content().feats).filter((f) => f.extraReaction);
    expect(withField).toHaveLength(15);
    for (const f of withField) expect(f.extraReaction!.usableFor.length, f.id).toBeGreaterThan(3);
  });
});

describe("the Avenger racket's divine skill", () => {
  it('actually trains the skill the player picks', () => {
    const ch = build('rogue', 3, { subclassId: 'avenger', deityId: 'ragathiel', featChoices: { 'feature:avenger': 'occultism' } });
    // All 16 options carried `grant: null`, so the answer was recorded and trained nobody.
    expect(ch.proficiencies.skills.occultism).toBe('trained');
  });
});
