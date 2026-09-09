import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { deriveEidolon, familiarAbilityBudget } from '../src/rules/companions';
import { COMPANION_MODS, FEAT_COMPANION_GRANTS } from '../src/rules/companionGrants';
import { INVENTOR_TIER_LEVEL, inventorModificationOptions } from '../src/rules/build';
import type { ClassFeature, CompanionConfig, ContentDatabase } from '../src/rules/types';

/*
 * BATCH 034 — the GAP lane of family "engine".
 *
 * The lines the engine family could not close inside its own file list: three one-key companion
 * fixes in src/rules/companionGrants.ts (+ the budget ladder in companions.ts), and the eighteen
 * construct-modification records whose spec is work/.b034-rows-gap-engine.json.
 *
 * The COMPANION assertions run on BUILT characters against the SHIPPED code, because the fix is code
 * and it has landed. The construct-modification assertions run on a content copy with the records
 * PATCHED IN MEMORY, because the spec has not been applied yet — never as a patched-vs-shipped delta,
 * which would flip the moment the driver applies it.
 */

const eidolonBlock = (typeId: string) => {
  const c = content();
  const ch = build('summoner', 5, { subclassId: typeId });
  const cfg: CompanionConfig = { id: `c-${typeId}`, kind: 'eidolon', name: 'Test Eidolon', typeId, eidolon: {} };
  return deriveEidolon(cfg, ch, c);
};

describe('batch 034 gap — improved-familiar-attunement grows its familiar budget on the printed ladder', () => {
  // batch 034: improved-familiar-attunement#ability-budget
  // AoN arcane-thesis-7: "You gain the Familiar wizard feat. Your familiar gains an extra ability, and
  // it gains an additional extra ability when you reach 6th, 12th, and 18th levels." Base Familiar is
  // abilityBudget 2, so "an extra ability" is 3 — and the flat 4 this grant shipped handed a 1st-level
  // wizard one ability too many and an 18th-level wizard two too few.
  it('improved-familiar-attunement is 3 at 1st and 4 / 5 / 6 at 6th, 12th and 18th', () => {
    const cfg: CompanionConfig = { id: 'f', kind: 'familiar', name: '', grantSlug: 'improved-familiar-attunement' };
    const at = (level: number) =>
      familiarAbilityBudget(cfg, build('wizard', level, { keyAbility: 'int', extraChoices: { thesis: ['improved-familiar-attunement'] } }))!;
    expect(at(1)).toBe(3);
    expect(at(5)).toBe(3);
    expect(at(6)).toBe(4);
    expect(at(12)).toBe(5);
    expect(at(18)).toBe(6);
    expect(at(20)).toBe(6);
  });

  // batch 034: improved-familiar-attunement#ability-budget
  // The ladder moved off a hard-coded `grantSlug === 'familiar-witch'` test onto the grant's own
  // `growthLevels`, so the blast radius is exactly "grants that declare one". The witch declares the
  // same [6,12,18] and must be unchanged; base Familiar declares none and must stay flat.
  it('improved-familiar-attunement borrows the witch ladder without moving it, and no other grant grows', () => {
    expect(FEAT_COMPANION_GRANTS['improved-familiar-attunement'].growthLevels).toEqual([6, 12, 18]);
    expect(FEAT_COMPANION_GRANTS['familiar-witch'].growthLevels).toEqual([6, 12, 18]);
    const witch: CompanionConfig = { id: 'w', kind: 'familiar', name: '', grantSlug: 'familiar-witch' };
    expect(familiarAbilityBudget(witch, build('witch', 1))).toBe(3);
    expect(familiarAbilityBudget(witch, build('witch', 20))).toBe(6);
    // Every other grant with a budget carries no ladder, so its number is level-independent.
    const flat = Object.entries(FEAT_COMPANION_GRANTS).filter(([, g]) => g.abilityBudget != null && !g.growthLevels);
    expect(flat.length).toBeGreaterThan(20);
    for (const [slug, g] of flat) {
      const cfg: CompanionConfig = { id: 'x', kind: 'familiar', name: '', grantSlug: slug };
      expect(familiarAbilityBudget(cfg, build('wizard', 20, { keyAbility: 'int' })), slug).toBe(g.abilityBudget);
    }
  });
});

describe('batch 034 gap — beast-eidolon speaks the language its page prints', () => {
  // batch 034: beast-eidolon#language-sylvan
  // AoN eidolon-3, the page this record cites: "**Language** Sylvan". The row carried kinds+senses and
  // no `languages`, so deriveEidolon's fixed-language loop added nothing and the block showed no
  // Languages line at all — while the sibling fey-eidolon, whose page prints the same word, did.
  it('beast-eidolon shows Sylvan on a built summoner, and asks nothing', () => {
    expect(COMPANION_MODS['beast-eidolon'].languages).toEqual(['Sylvan']);
    expect(COMPANION_MODS['beast-eidolon'].languageChoices).toBeUndefined();
    expect(eidolonBlock('beast-eidolon').languages).toEqual(['Sylvan']);
  });
});

describe('batch 034 gap — psychopomp-eidolon speaks the language its page prints', () => {
  // batch 034: psychopomp-eidolon#language
  // AoN eidolon-10: "**Language** Requian". Stored as the content id, not the printed name, because
  // content.languages['requian'] exists — the dragon-eidolon shape, which is the only leg that covers
  // deriveEidolon's id-resolving branch. The other clauses of this row (darkvision, Spirit Touch,
  // ghost touch) already matched and must survive the one-key addition.
  it('psychopomp-eidolon resolves Requian through the id, keeping its other clauses', () => {
    expect(COMPANION_MODS['psychopomp-eidolon'].languages).toEqual(['requian']);
    expect(content().languages?.['requian']?.name).toBe('Requian');
    const b = eidolonBlock('psychopomp-eidolon');
    expect(b.languages).toEqual(['Requian']);
    expect(COMPANION_MODS['psychopomp-eidolon'].strikeRider).toBe('ghost touch');
  });
});

describe('batch 034 gap — construct-innovation tells the player about its share of Overdrive', () => {
  // batch 034: construct-innovation#overdrive
  // AoN innovation-2: "If you use the Overdrive action, your construct gains the same Overdrive
  // benefits you do, and it also takes the same amount of fire damage on a critical failure." Nothing
  // carried it — no rider, no resource, not even prose — so the clause reached the player nowhere.
  it('construct-innovation carries the Overdrive rider on the card note', () => {
    const note = FEAT_COMPANION_GRANTS['construct-innovation'].note ?? '';
    expect(note).toMatch(/Overdrive/);
    expect(note).toMatch(/fire damage/);
    expect(note).toMatch(/critical failure/);
    // The sibling construct-granting feats print no such clause and must not grow one.
    expect(FEAT_COMPANION_GRANTS['prototype-companion'].note).not.toMatch(/Overdrive/);
    expect(FEAT_COMPANION_GRANTS['clockwork-reanimator-dedication'].note).not.toMatch(/Overdrive/);
  });
});

/*
 * The eighteen modification records. `patchedContent` is the shipped content with the records the spec
 * creates ADDED IN MEMORY, so every assertion below is about the shape the spec emits and none of them
 * is a shipped-vs-patched delta. The shipped leg is asserted once, on its own, as the defect.
 */
const MODS: [string, number][] = [
  ['accelerated-mobility', 1], ['amphibious-construction', 1], ['increased-size', 1], ['manual-dexterity', 1],
  ['projectile-launcher', 1], ['sensory-array', 1], ['wonder-gears', 1],
  ['advanced-weaponry-construct', 7], ['antimagic-construction', 7], ['climbing-limbs', 7],
  ['durable-construction', 7], ['marvelous-gears', 7], ['turret-configuration', 7],
  ['flight-chassis', 15], ['miracle-gears', 15], ['resistant-coating', 15],
  ['runic-keystone', 15], ['wall-configuration', 15],
];

const patchedContent = (): ContentDatabase => {
  const c = content();
  const classFeatures = { ...c.classFeatures } as Record<string, ClassFeature>;
  for (const [id, level] of MODS) {
    classFeatures[id] = {
      id,
      name: id,
      traits: ['inventor'],
      rarity: 'common',
      source: { book: 'Pathfinder Guns & Gears', license: 'ORC' },
      level,
      actionCost: { type: 'passive' },
      otherTags: ['construct-innovation-modification'],
    } as unknown as ClassFeature;
  }
  // The `choice: null` row of the same spec, applied in memory: the label-only picker is retired.
  classFeatures['construct-innovation'] = { ...classFeatures['construct-innovation'], choice: undefined } as ClassFeature;
  return { ...c, classFeatures } as ContentDatabase;
};

describe('batch 034 gap — construct-innovation offers real modification records at each tier', () => {
  /*
   * AoN innovation-2 prints three tiers of construct modifications (Initial, Breakthrough at 7th,
   * Revolutionary at 15th). No record in core.json carried the tag `construct-innovation-modification`,
   * so inventorModificationOptions returned [] for a construct at every tier and the picker the engine
   * family unhid had nothing to show.
   *
   * CLOSER, batch 034: this was written as the SHIPPED leg — `optsOf('construct','initial')` toEqual
   * []. The spec's 18 records are applied now, so that is a patched-vs-shipped delta that flipped the
   * moment the driver ran, which is exactly the shape the batch rules forbid. The defect is asserted
   * where it cannot flip again: on a copy with the tag STRIPPED, which reproduces [] whatever ships.
   */
  // batch 034: construct-innovation#higher-tier-picks
  it('construct-innovation offers modifications at every tier, and reverts to nothing without the tag', () => {
    const c = content();
    const optsOf = (type: 'construct' | 'armor' | 'weapon' | 'light-mortar', tier: keyof typeof INVENTOR_TIER_LEVEL, db = c) =>
      inventorModificationOptions(db, type, undefined, INVENTOR_TIER_LEVEL[tier]);
    expect(optsOf('construct', 'initial').length).toBeGreaterThan(0);
    expect(optsOf('construct', 'revolutionary').length).toBeGreaterThan(0);
    expect(optsOf('weapon', 'initial').length).toBeGreaterThan(0);
    expect(optsOf('armor', 'initial').length).toBeGreaterThan(0);
    expect(optsOf('light-mortar', 'initial').length).toBeGreaterThan(0);

    // The defect, reproduced rather than remembered: without the tag the reader finds nothing again.
    const stripped = JSON.parse(JSON.stringify(c)) as ContentDatabase;
    for (const f of Object.values(stripped.classFeatures) as ClassFeature[]) {
      if (f.otherTags?.includes('construct-innovation-modification')) {
        (f as unknown as { otherTags: string[] }).otherTags = f.otherTags.filter((t) => t !== 'construct-innovation-modification');
      }
    }
    expect(optsOf('construct', 'initial', stripped)).toEqual([]);
    expect(optsOf('construct', 'revolutionary', stripped)).toEqual([]);
    // Stripping one type's tag must not touch a sibling's list — the reader is shared.
    expect(optsOf('weapon', 'initial', stripped).length).toBe(optsOf('weapon', 'initial').length);
  });

  // batch 034: construct-innovation#higher-tier-picks
  // The spec's 18 records, tagged for the reader that already exists: the tier ladder is level-based
  // (a higher tier may re-pick a lower-tier modification, which is what innovation-2's "or from other
  // initial construct modifications to which you have access" allows), so the counts accumulate 7 / 13
  // / 18 rather than 7 / 6 / 5.
  it('construct-innovation offers 7 / 13 / 18 modifications once the records exist', () => {
    const c = patchedContent();
    const optsOf = (tier: keyof typeof INVENTOR_TIER_LEVEL) =>
      inventorModificationOptions(c, 'construct', undefined, INVENTOR_TIER_LEVEL[tier]);
    expect(optsOf('initial').map((o) => o.id).sort()).toEqual(MODS.filter(([, l]) => l === 1).map(([id]) => id).sort());
    expect(optsOf('breakthrough').length).toBe(13);
    expect(optsOf('revolutionary').length).toBe(18);
    // The lane is shared: adding the construct tag must not move any sibling innovation's list.
    for (const type of ['armor', 'weapon', 'light-mortar'] as const) {
      expect(
        inventorModificationOptions(c, type, undefined, 15).length,
        type,
      ).toBe(inventorModificationOptions(content(), type, undefined, 15).length);
    }
  });

  // batch 034: construct-innovation#duplicate-picker
  // innovation-2 asks ONE question ("Choose one initial construct modification"). The record's own
  // `choice` asked it a second time with seven label strings — a control with no reader anywhere
  // (`constructModification` appears in no source file) and no way to reach the 7th- and 15th-level
  // tiers. The three sibling innovations answer this by carrying no `choice` at all.
  /* CLOSER, batch 034: the first assertion read the RETIRED picker's seven option values off the
   * shipped record. The `choice: null` row is applied, so `shipped.choice` is gone and that leg
   * flipped. What the finding actually claims — that retiring the picker lost nothing, because the
   * initial tier asks the same seven — is asserted against the tier reader instead, which is where
   * the question lives now and cannot flip back. */
  it('construct-innovation drops its label-only choice, whose seven options the initial tier now carries', () => {
    const shipped = content().classFeatures['construct-innovation'];
    expect(shipped.choice).toBeUndefined();
    // Nothing was lost: the initial tier asks exactly the seven the retired picker listed.
    const initial = inventorModificationOptions(content(), 'construct', undefined, INVENTOR_TIER_LEVEL.initial)
      .map((o) => o.id)
      .sort();
    expect(initial).toEqual(MODS.filter(([, l]) => l === 1).map(([id]) => id).sort());
    // …and the three siblings answer the same way, by carrying no `choice` at all.
    for (const sibling of ['armor-innovation', 'weapon-innovation', 'light-mortar-innovation']) {
      expect(content().classFeatures[sibling]?.choice, sibling).toBeUndefined();
    }
    expect(patchedContent().classFeatures['construct-innovation'].choice).toBeUndefined();
  });
});
