import { describe, it, expect } from 'vitest';
import { content } from './_content';

const db = content();

/**
 * Wanderer's-Guide parity batch 28 — the DATA half (class records, subclass/extra-choice options and
 * class-feature records). Every assertion pins an authored field against the printed sentence that
 * required it, quoted in the test name, so a regeneration that drops the overlay row fails here
 * rather than silently returning the record to its pre-batch shape.
 *
 * These read the SHIPPED content through `content()` (public/core.json merged with
 * public/core-descriptions.json, exactly as the app loads it). The rows are authored in
 * scripts/data/effect-backfill.json and only exist once `npm run data` has applied them, so this file
 * is red until the orchestrator applies work/.b028-rows.json — deliberately: an assertion written
 * against a locally patched copy would pass on a machine where the row never landed.
 *
 * Several findings additionally need an ENGINE half that is NOT data. VERIFIER re-check against the
 * current src/: restrictedSkillIncreaseLevels (build.ts:1101/3268 + Builder.tsx:2596), extraRepertoire
 * (repertoireCounts, build.ts:3847), spellcasting.spellbook (Builder.tsx:403) and the widening of
 * EffectGrant.grantsFeats past heritage options (build.ts:4879-4894) have ALL LANDED and were measured
 * on real builds. `repertoireBonus` never landed and never will — the summoner rides extraRepertoire.
 * TWO readers are still missing, and both are named at their test: `grants.removesSkills` (the ranger
 * vindicator, which ships a WRONG character until it lands) and the merge of a subclass option's
 * `grantedSpells` into the learned-prepared spellbook (every witch patron, which ships an inert field).
 */

/** Untyped view of a record, for fields whose lane interface does not declare them yet. */
const raw = (rec: unknown) => rec as unknown as Record<string, unknown>;
const cls = (id: string) => db.classes[id]!;
const subOpts = (id: string) => cls(id).subclass!.options;
const subOpt = (id: string, optId: string) => subOpts(id).find((o) => o.id === optId)!;
const extraOpts = (id: string, groupId: string) => cls(id).extraChoices!.find((g) => g.id === groupId)!.options;
const feature = (id: string) => db.classFeatures[id]!;

describe('batch 28 — investigator methodology', () => {
  /* AoN methodology-9 prints ONE Esoterica package; we shipped it twice — once as the inert
   * `aon-esoterica-methodology` option (id/name/description only) and once as palatine-detective,
   * which carries the mechanics on classFeatures['palatine-detective']. */
  it('esoterica: the inert aon- twin is gone from the Methodology picker', () => {
    expect(subOpts('investigator').map((o) => o.id)).not.toContain('aon-esoterica-methodology');
    expect(db.classFeatures['aon-esoterica-methodology'], 'never had a class-feature record either').toBeUndefined();
  });

  it('esoterica: palatine-detective is the single carrier — "trained in Occultism or Religion" + Quick Identification + two innate cantrips', () => {
    expect(subOpt('investigator', 'palatine-detective').skillChoice).toEqual(['occultism', 'religion']);
    const rec = feature('palatine-detective');
    expect(rec.grantsFeats).toEqual(['quick-identification']);
    expect(rec.effectChoices?.map((e) => e.id)).toEqual(['esoterica-divine-cantrip', 'esoterica-occult-cantrip']);
  });

  /* The same "Occultism or Religion?" was asked twice: the option's skillChoice (which trains it) and
   * the class feature's `choice` flag `esotericaSkill` (whose options carry no grant, so it trained
   * nothing). Print gives one choice. */
  it('palatine-detective: the duplicate esotericaSkill choice is deleted', () => {
    expect(feature('palatine-detective').choice).toBeUndefined();
  });
});

describe('batch 28 — champion causes carry their sanctification trait', () => {
  /* class-58: "Some causes are limited to certain sanctifications" — carried on the cause pages as a
   * trait. Read by subclassOptionAllowed (src/rules/build.ts:1129), which gates on the
   * `sanctification` choice flag. */
  it.each([['desecration', 'unholy'], ['iniquity', 'unholy'], ['grandeur', 'holy'], ['redemption', 'holy']])(
    '%s carries the %s trait',
    (cause, trait) => {
      expect(subOpt('champion', cause).traits).toEqual([trait]);
    },
  );

  it('justice, liberation and obedience carry no sanctification trait', () => {
    for (const id of ['justice', 'liberation', 'obedience']) {
      const t = subOpt('champion', id).traits ?? [];
      expect(t.filter((x) => x === 'holy' || x === 'unholy')).toEqual([]);
    }
  });

  it('every cause keeps its reaction featureIds (the re-emitted array did not drop them)', () => {
    for (const o of subOpts('champion')) expect(o.featureIds?.length, o.id).toBe(1);
  });
});

describe('batch 28 — sorcerer', () => {
  /* class-62 Spells per Day: 3 the level a rank opens, 4 after ("you can cast up to three 1st-rank
   * spells"). 'full-plus' is the existing progression the oracle already uses
   * (src/rules/spellcasting.ts fullPlusCasterSlots). */
  it('slots: "Each day, you can cast up to three 1st-rank spells"', () => {
    expect(cls('sorcerer').spellcasting?.progression).toBe('full-plus');
  });

  /* class-62's level-1 table row lists four features; "Bloodline Spells" is an AoN sub-section of the
   * bloodline page (no aonId, no edition, no mechanics) and the focus spell it names already arrives
   * from the bloodline option's focusSpells. */
  it('bloodline-spells is not a fifth level-1 class feature', () => {
    const l1 = cls('sorcerer').features.filter((f) => f.level === 1).map((f) => f.featureId);
    expect(l1).not.toContain('bloodline-spells');
    expect(l1.sort()).toEqual(['bloodline', 'sorcerer-spellcasting', 'sorcerous-potency', 'spell-repertoire']);
  });

  it('the bloodline-spells RECORD is kept (display hygiene: hide, never delete)', () => {
    expect(db.classFeatures['bloodline-spells']).toBeDefined();
  });
});

describe('batch 28 — commander', () => {
  /* Master Tactician (15th): "In addition, you gain legendary proficiency in Warfare Lore." Same
   * field and reader (build.ts:5464) its two siblings already use. */
  it('master-tactician: "you gain legendary proficiency in Warfare Lore"', () => {
    expect(feature('master-tactician').skillProgression).toEqual([
      { skill: 'lore:warfare', at: [{ level: 15, rank: 'legendary' }] },
    ]);
  });

  it('the warfare-lore ladder is expert@3 / master@7 / legendary@15', () => {
    expect(feature('warfare-expertise').skillProgression?.[0].at[0].level).toBe(3);
    expect(feature('expert-tactician').skillProgression?.[0].at[0].level).toBe(7);
  });

  /* class-feature-1089 only forward-references Expert Tactician; the class table grants it at 7, and
   * derive.ts's grantsClassFeatures loop has no level gate. */
  it('tactics no longer grants expert-tactician outright', () => {
    expect(feature('tactics').grantsClassFeatures).toBeUndefined();
    expect(cls('commander').features).toContainEqual({ level: 7, featureId: 'expert-tactician' });
  });
});

describe('batch 28 — class trained skills', () => {
  /* class-36: "Trained in Nature / Trained in Survival / …4 plus your Intelligence modifier". */
  it('ranger: "Trained in Nature" as well as Survival', () => {
    expect(cls('ranger').trainedSkills).toEqual({ fixed: ['nature', 'survival'], additional: 4 });
  });

  /* Vindicator: "trained in Religion instead of Nature". build.ts:3121 only ADDS option skills, so the
   * replacement needs its own carrier. NO READER YET — `grants.removesSkills` is inert until the
   * engine reads it beside the fixed-skill pass (build.ts:2965) and the option-skill add (3121).
   *
   * ⚠⚠ VERIFIER — this pair is a MATCHED SET and the two rows must not land alone. Measured on a real
   * build with the rows applied and no reader: a level-1 vindicator comes out trained in Nature AND
   * Religion, i.e. one skill more than print allows, where today it is trained in Religion only. Adding
   * Nature to `trainedSkills.fixed` without the suppression trades a missing skill for a wrong one.
   * Named in the batch report as a BLOCKING cross-file gap (src/rules/build.ts:2965/3121). */
  it('ranger vindicator: "trained in Religion instead of Nature"', () => {
    expect(raw(subOpt('ranger', 'vindicator').grants).skills).toEqual(['religion']);
    expect(raw(subOpt('ranger', 'vindicator').grants).removesSkills).toEqual(['nature']);
  });

  /* class-35: "Trained in your choice of Acrobatics or Athletics" — read by build.ts:2975 and
   * rendered by shared.tsx:3150; there was no carrier at all. */
  it('fighter: "Trained in your choice of Acrobatics or Athletics"', () => {
    expect(cls('fighter').trainedSkills).toEqual({ fixed: [], additional: 3, choice: ['acrobatics', 'athletics'] });
  });

  /* class-69: "Trained in Arcana, Nature, Occultism, and Religion" — all four, not one of four. */
  it('thaumaturge: all four esoteric skills are fixed, and the one-of-four choice is gone', () => {
    expect(cls('thaumaturge').trainedSkills).toEqual({
      fixed: ['arcana', 'nature', 'occultism', 'religion'], additional: 3, lore: 'esoteric',
    });
  });

  /* class-64: "Trained in Religion and either Nature or Occultism". */
  it('animist: "Trained in Religion and either Nature or Occultism"', () => {
    expect(cls('animist').trainedSkills).toEqual({ fixed: ['religion'], additional: 2, choice: ['nature', 'occultism'] });
  });
});

describe('batch 28 — restricted extra skill increases', () => {
  /* Thaumaturgic Expertise (9th) / Mastery (17th): "You also gain an additional skill increase, which
   * you can apply only to Arcana, Nature, Occultism, or Religion." bonusSkillIncreaseLevels is live
   * (build.ts:3169/8917); restrictedSkillIncreaseLevels is engine agent 1's new reader. */
  it('thaumaturge: "You also gain an additional skill increase" at 9th and 17th', () => {
    expect(cls('thaumaturge').bonusSkillIncreaseLevels).toEqual([9, 17]);
  });

  it('thaumaturge: "…which you can apply only to Arcana, Nature, Occultism, or Religion"', () => {
    const r = raw(cls('thaumaturge')).restrictedSkillIncreaseLevels as Record<string, unknown>;
    expect(r.levels).toEqual([9, 17]);
    expect(r.skills).toEqual(['arcana', 'nature', 'occultism', 'religion']);
  });

  /* Stylish Tricks: "an additional skill increase you can apply only to Acrobatics or the skill from
   * your swashbuckler's style" — the FEAT half was already restricted, the increase half was not. */
  it('swashbuckler: the Stylish Tricks increase is restricted like its feat half', () => {
    const inc = raw(cls('swashbuckler')).restrictedSkillIncreaseLevels as Record<string, unknown>;
    const feat = cls('swashbuckler').restrictedSkillFeatLevels!;
    expect(inc.levels).toEqual(feat.levels);
    expect(inc.skills).toEqual(feat.skills);
    expect(inc.includeSubclassGrantedSkills).toBe(true);
    expect(cls('swashbuckler').bonusSkillIncreaseLevels).toEqual([3, 7, 15]);
  });
});

describe('batch 28 — rogue Eldritch Trickster key attribute', () => {
  /* racket-4: "You can choose the spellcasting ability score for the multiclass archetype you chose as
   * your key ability score." Read by resolveOptionKeyAbility (build.ts:886) and the setup control
   * (build.ts:1106, shared.tsx:2571). */
  it('eldritch-trickster offers Dex plus the three spellcasting attributes', () => {
    expect(subOpt('rogue', 'eldritch-trickster').keyAbilityOptions).toEqual(['dex', 'int', 'wis', 'cha']);
  });

  it('the record no longer says the key-attribute clause is unapplied', () => {
    const inert = String(raw(feature('eldritch-trickster').choice).inert ?? '');
    expect(inert).not.toMatch(/key attribute/i);
    expect(inert, 'the dedication half of the note stays true').toMatch(/dedication/);
  });
});

describe('batch 28 — witch patrons teach the familiar a spell', () => {
  /* Every patron's lesson has two halves: "You gain the <hex> cantrip AND your familiar learns
   * <spell>". SubclassOption.grantedSpells is collected into `grantedByRank` at build.ts:3811.
   *
   * ⚠ VERIFIER: that collection reaches the SPONTANEOUS branch (build.ts:3949) and the cantrip line
   * only. The witch runs the LEARNED-prepared branch (build.ts:3892, `cls.id === 'wizard' || 'witch'`),
   * which fills `entry.spellbook[rank]` from `build.spells` alone and never merges `grantedByRank`.
   * Measured on a built witch (patched content, every patron): baba-yaga's Chilling Spray, silence-in-
   * snow's Gust of Wind and cobyslarni's De Ja Vu appear nowhere in the character's spellcasting.
   * The data below is right; the mechanic needs build.ts:3915 to merge `grantedByRank[rank]` into
   * `entry.spellbook[rank]` the way the spontaneous branch already does. Named in the batch report as
   * a cross-file gap — do NOT re-author the data to work around it. */
  const EXPECTED: Record<string, string> = {
    'baba-yaga': 'chilling-spray', 'choir-politic': 'share-lore', cobyslarni: 'de-ja-vu',
    'devourer-of-decay': 'enfeeble', 'faiths-flamekeeper': 'command', 'mosquito-witch': 'pest-form',
    'paradox-of-opposites': 'sleep', 'silence-in-snow': 'gust-of-wind', 'spinner-of-threads': 'sure-strike',
    'starless-shadow': 'fear', 'the-inscribed-one': 'runic-weapon', 'the-resentment': 'enfeeble',
    'the-unseen-broker': 'command', 'whisper-of-wings': 'gentle-landing',
  };

  it.each(Object.entries(EXPECTED))('%s: "your familiar learns %s"', (patron, spell) => {
    expect(subOpt('witch', patron).grantedSpells).toEqual([spell]);
    expect(db.spells[spell], 'the granted spell must exist').toBeDefined();
  });

  it('each granted spell is the one the patron\'s own description names', () => {
    for (const [patron, spell] of Object.entries(EXPECTED)) {
      const named = subOpt('witch', patron).description.match(/familiar learns ([^.\n]+)\./)?.[1] ?? '';
      expect(db.spells[spell].name, patron).toBe(named);
    }
  });

  /* The two patrons print an OR ("Dizzying Colors or Grease", "your choice of Summon Animal or Summon
   * Plant or Fungus"). grantedSpells is a flat list and cannot express a pick, so neither arm is
   * authored — authoring one would silently decide the player's choice. Pinned so the gap is visible. */
  it('ripple-in-the-deep and wilding-steward stay unauthored: print gives a CHOICE of two spells', () => {
    for (const id of ['ripple-in-the-deep', 'wilding-steward']) {
      expect(subOpt('witch', id).description).toMatch(/ or /);
      expect(subOpt('witch', id).grantedSpells, id + ' needs a pick control, not a flat grant').toBeUndefined();
    }
  });
});

describe('batch 28 — thaumaturge implements', () => {
  /* class-69's level-1 table row has no separate "exploit vulnerability" feature: the action is
   * granted inside First Implement and Esoterica, which we ALSO carried, delivering it twice. */
  it('exploit-vulnerability is not a second level-1 feature', () => {
    expect(cls('thaumaturge').features.map((f) => f.featureId)).not.toContain('exploit-vulnerability');
    expect(feature('first-implement-and-esoterica').grantsActions, 'the printed carrier keeps the grant')
      .toEqual(['exploit-vulnerability']);
    expect(db.actions['exploit-vulnerability'], 'the action itself still ships').toBeDefined();
  });

  /* Nine implements rendered "### **Initiate Benefit**" with no body and shield duplicated all three
   * tiers verbatim; the real text and its grants live on the 30 *-benefit-<implement> records that
   * build.ts pushes into classChoices. */
  it('no implement option prints an Initiate/Adept/Paragon heading any more', () => {
    for (const o of extraOpts('thaumaturge', 'implement')) {
      expect(o.description, o.id).not.toMatch(/### \*\*(Initiate|Adept|Paragon) Benefit\*\*/);
    }
  });

  it('every implement keeps its Intensify Vulnerability text (the one tier with no record)', () => {
    for (const o of extraOpts('thaumaturge', 'implement')) {
      expect(o.description, o.id).toMatch(/### \*\*Intensify Vulnerability\*\*\n\n\S/);
    }
  });

  it('the tier text still ships, on the *-benefit-<implement> records', () => {
    for (const tier of ['initiate', 'adept', 'paragon']) {
      for (const imp of ['amulet', 'bell', 'chalice', 'lantern', 'mirror', 'regalia', 'shield', 'tome', 'wand', 'weapon']) {
        expect(db.classFeatures[`${tier}-benefit-${imp}`], `${tier}-benefit-${imp}`).toBeDefined();
      }
    }
    expect(feature('initiate-benefit-shield').description).toMatch(/Shield Block/);
  });
});

describe('batch 28 — animist apparitions', () => {
  const opts = () => extraOpts('animist', 'apparition');
  const RANKS = ['Cantrip', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

  /* apparition-16 (Lamentation of Sinister Deals, common, AP #223) was the 14th of 14 printed
   * apparitions and existed only as a name-only stub in the orphan `apparition` bucket, which nothing
   * in src/ reads — so it reached no picker and granted nothing. */
  it('all 14 printed apparitions are selectable', () => {
    expect(opts()).toHaveLength(14);
    expect(opts().map((o) => o.id)).toContain('lamentation-of-sinister-deals');
  });

  it('lamentation-of-sinister-deals: Legal + Scribing Lore, vessel spell Wish Market, cantrip-to-9th ladder', () => {
    const o = opts().find((x) => x.id === 'lamentation-of-sinister-deals')!;
    expect(raw(o.grants).lores).toEqual(['legal', 'scribing']);
    expect(o.focusSpells).toEqual(['wish-market']);
    expect(o.grantedSpells).toEqual(['message', 'sure-strike', 'blistering-invective', 'hypercognition',
      'honeyed-words', 'breath-of-life', 'sacred-form', 'contingency', 'moment-of-renewal', 'resplendent-mansion']);
    for (const id of [...o.grantedSpells!, ...o.focusSpells!]) expect(db.spells[id], id).toBeDefined();
  });

  /* Seven rank lines printed a heading with no spell beside it, in five options; each option's own
   * grantedSpells already held the right id at that rank index, so the defect was display-only. */
  it('no apparition prints a bare rank line', () => {
    for (const o of opts()) {
      for (const r of RANKS) expect(o.description, `${o.id} ${r}`).not.toMatch(new RegExp(`- \\*\\*${r}\\*\\*(\\n|$)`));
    }
  });

  it.each([
    ['impostor-in-hidden-places', 2], ['impostor-in-hidden-places', 8], ['impostor-in-hidden-places', 9],
    ['echo-of-lost-moments', 7], ['monarch-of-the-fey-courts', 5], ['reveler-in-lost-glee', 0],
    ['speaker-in-sibilance', 3],
  ])('%s: the %s-rank line names the spell its grantedSpells already held', (id, rank) => {
    const o = opts().find((x) => x.id === id)!;
    const name = db.spells[o.grantedSpells![rank as number]].name;
    expect(o.description).toContain(`- **${RANKS[rank as number]}** ${name}`);
    expect(o.descRefs?.some((r) => r.label === name), 'and it links like the rest of the list').toBe(true);
  });
});

describe('batch 28 — magus', () => {
  /* hybrid-study-3: "You gain the Shield Block general feat"; hybrid-study-7: "You gain the Cat Fall
   * general feat". SubclassOption.grantedFeats is read at build.ts:4461 and 8491. */
  it.each([['sparkling-targe', 'shield-block'], ['aloof-firmament', 'cat-fall']])(
    '%s: "You gain the %s general feat"',
    (study, feat) => {
      expect(subOpt('magus', study).grantedFeats).toEqual([feat]);
      expect(db.feats[feat]).toBeDefined();
    },
  );

  /* The reader LANDED as `ClassSpellcasting.spellbook = { spells, perLevel }` (read at Builder.tsx:403
   * `bookSpec` → spellbookBudget), replacing the hardcoded wizard/witch class-id test — which is why
   * the numbers ride on the record at all. `cantrips: 8` is deliberately NOT carried: the book's
   * cantrip count is modelled for no class (the wizard's included), so that key would be data with no
   * reader, and no row authors it.
   * The COUNT moved with the book: class-17 printed "four 1st-level arcane spells"; class-74
   * (Impossible Magic pg. 9) prints "The spellbook contains your choice of eight arcane cantrips and
   * five 1st-rank arcane spells", and "you add two arcane spells" is unchanged. */
  // batch 037: magus#2026-printing
  it('spellbook: "five 1st-rank arcane spells" + two per level (the cantrip count has no reader)', () => {
    expect(raw(cls('magus').spellcasting).spellbook).toEqual({ spells: 5, perLevel: 2 });
    expect(cls('magus').spellcasting?.type, 'still a prepared caster').toBe('prepared');
  });
});

describe('batch 28 — gunslinger Way of the Spellshot', () => {
  /* class-20: "Key Attribute: Dexterity — At 1st level, your class gives you an ability boost to
   * Dexterity". The option's keyAbility was consumed by build.ts:2917 as the CHARACTER's key
   * attribute, so a spellshot took their 1st-level class boost in Int and came out with Dex 10.
   * (archetype-122 does print "You use Intelligence for your class DC" — that clause needs its own
   * carrier, it is NOT the key attribute; see the batch report.) */
  it('the way no longer overrides the class key attribute', () => {
    expect(subOpt('gunslinger', 'way-of-the-spellshot').keyAbility).toBeUndefined();
    expect(cls('gunslinger').keyAbility).toEqual(['dex']);
  });

  it('the re-emitted subclass kept every way\'s deeds and skills', () => {
    for (const o of subOpts('gunslinger')) expect(o.featureIds?.length, o.id).toBe(3);
    expect(raw(subOpt('gunslinger', 'way-of-the-spellshot').grants).skills).toEqual(['arcana']);
  });
});

describe('batch 28 — kineticist gate junctions', () => {
  const GATES = ['gates-threshold', 'second-gates-threshold', 'third-gates-threshold', 'fourth-gates-threshold'];
  const JUNCTION_FEAT: Record<string, string> = {
    'air-skill-junction': 'experienced-smuggler', 'earth-skill-junction': 'hefty-hauler',
    'fire-skill-junction': 'intimidating-glare', 'metal-skill-junction': 'quick-repair',
    'water-skill-junction': 'underwater-marauder', 'wood-skill-junction': 'terrain-expertise',
  };
  const junctions = (gate: string) => feature(gate).effectChoices!.find((e) => e.id === 'gate-junction')!.options!;

  /* class-23: "A skill junction makes you trained in the listed skill" — and element-5 dates that
   * whole block "Level 5". We handed the skill out at level 1 from the ELEMENT option instead, free
   * and duplicated. */
  it('no element option grants a skill at 1st level any more', () => {
    for (const o of extraOpts('kineticist', 'element')) {
      expect(raw(o.grants ?? {}).skills, o.id).toBeUndefined();
      expect(o.grantedChoiceFeats, o.id).toBeUndefined();
    }
  });

  /* element-5 (Metal) Gate Junction: "**Skill Junction** Crafting, Quick Repair" — the only element
   * whose skill junction had no option at all. */
  it.each(GATES)('%s offers the Metal skill junction (Crafting)', (gate) => {
    const metal = junctions(gate).find((o) => o.value === 'metal-skill-junction');
    expect(metal, 'element-5 prints a Metal skill junction').toBeDefined();
    expect(raw(metal!.grant).skills).toEqual({ crafting: 'trained' });
  });

  /* class-23: "…and grants you the listed skill feat". EffectGrant.grantsFeats was HERITAGE-OPTIONS-ONLY
   * when the row was written; VERIFIER: the widening LANDED at build.ts:4879-4894, and a level-5
   * kineticist built with the rows applied comes back carrying Quick Repair (metal junction) and
   * Experienced Smuggler (air junction) — so these six deliver the moment the rows land.
   * Still open, and not a data row: print says Terrain Expertise (FOREST) for wood, and grantsFeats is
   * a flat id list, so the terrain sub-pick needs FEAT_GRANT_PINNED_CHOICE (featFeatGrants.ts). */
  it.each(GATES)('%s: all six skill junctions carry their printed feat', (gate) => {
    for (const [value, feat] of Object.entries(JUNCTION_FEAT)) {
      const opt = junctions(gate).find((o) => o.value === value);
      expect(opt, value).toBeDefined();
      expect(raw(opt!.grant).grantsFeats, value).toEqual([feat]);
      expect(db.feats[feat], feat).toBeDefined();
    }
  });

  it.each(GATES)('%s keeps its six elemental resistances and three generic junctions', (gate) => {
    const values = junctions(gate).map((o) => o.value);
    expect(values.filter((v) => v.endsWith('-elemental-resistance'))).toHaveLength(6);
    expect(values).toEqual(expect.arrayContaining(['critical-blast', 'impulse-junction', 'aura-junction']));
    expect(values).toHaveLength(15);
  });
});

describe('batch 28 — inventor light mortar', () => {
  /* archetype-329 (Munitions Master Adjustments): "Inventive Expertise (7th) — You gain this class
   * feature at 7th level instead of 9th" and the same for Inventive Mastery at 15th instead of 17th.
   * featureIds accepts {id, level}; suppressedFeatures filters `cls.features` only (build.ts:4179,
   * 4819, 8992), never an option's own featureIds, so the pair moves the feature rather than dropping
   * it. The class-DC ladder is NOT data — advancement.ts:474/484 still steps at 9 and 17. */
  it('the innovation moves Inventive Expertise to 7th and Inventive Mastery to 15th', () => {
    const o = subOpt('inventor', 'light-mortar-innovation');
    expect(o.featureIds).toEqual([{ id: 'inventive-expertise', level: 7 }, { id: 'inventive-mastery', level: 15 }]);
    expect(o.suppressedFeatures).toEqual(['inventive-expertise', 'inventive-mastery']);
  });

  it('the class table still places them at 9th and 17th for every other innovation', () => {
    expect(cls('inventor').features).toContainEqual({ level: 9, featureId: 'inventive-expertise' });
    expect(cls('inventor').features).toContainEqual({ level: 17, featureId: 'inventive-mastery' });
    expect(subOpt('inventor', 'weapon-innovation').suppressedFeatures).toBeUndefined();
  });
});

describe('batch 28 — wizard arcane schools from Impossible Magic', () => {
  /* class-63: "At 1st level, you choose your arcane school". arcane-school-31..34 (Impossible Magic
   * pg. 108) were absent from options AND from classFeatures, while all eight of their focus spells
   * shipped, owned by nobody. Shaped exactly like school-of-magical-technologies. */
  const NEW: [string, string, string][] = [
    ['school-of-breathtaking-influence', 'appeal-to-authority', 'hot-air'],
    ['school-of-keen-inquiry', 'fact-check', 'unsettling-perspective'],
    ['school-of-nexian-spaces', 'extradimensional-cover', 'unbounded-sphere'],
    ['school-of-quantic-control', 'circle-of-weakness', 'quantic-dampening'],
  ];

  it('all four are selectable', () => {
    const ids = subOpts('wizard').map((o) => o.id);
    for (const [id] of NEW) expect(ids, id).toContain(id);
    expect(ids).toHaveLength(18);
  });

  it.each(NEW)('%s: initial school spell %s, advanced %s', (id, initial, advanced) => {
    const o = subOpt('wizard', id);
    expect(o.focusSpells).toEqual([initial]);
    expect(o.advancedFocusSpell).toBe(advanced);
    expect(db.spells[initial], initial).toBeDefined();
    expect(db.spells[advanced], advanced).toBeDefined();
  });

  it.each(NEW)('%s has a curriculum record of real spells, cantrips through 9th', (id) => {
    const rec = feature(id);
    expect(rec, id).toBeDefined();
    expect(rec.otherTags).toContain('wizard-arcane-school');
    const curric = rec.curriculum as Record<string, string[]>;
    expect(Object.keys(curric).sort((a, b) => Number(a) - Number(b))).toEqual(
      ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    );
    for (const list of Object.values(curric)) for (const s of list) expect(db.spells[s], id + ' ' + s).toBeDefined();
  });
});

describe('batch 28 — spell chassis gaps', () => {
  /* class-75 key terms: "You can use the Command a Thrall action as long as you have at least one
   * thrall" — a chassis benefit, but the only grantsActions naming it was the ARCHETYPE feat, so a
   * base necromancer never saw it. grave-spells is the 1st-level feature that hands over Create
   * Thrall, i.e. the first thing that gives a necromancer a thrall to command. */
  it('necromancer: Command a Thrall reaches a base necromancer', () => {
    expect(feature('grave-spells').grantsActions).toEqual(['command-a-thrall']);
    expect(db.actions['command-a-thrall']).toBeDefined();
    expect(db.feats['necromancer-dedication'].grantsActions, 'the archetype route is unchanged')
      .toEqual(['command-a-thrall']);
  });

  /* class-18: "you learn two 1st-level spells" and "your spell repertoire reaches its maximum size of
   * five spells", against "The maximum number of spell slots you get from the summoner class is four"
   * — repertoire = slots + 1 at every level.
   * VERIFIER FIX: the reader LANDED as `ClassSpellcasting.extraRepertoire` (repertoireCounts in
   * src/rules/spellcasting.ts, read at build.ts:3847 and Builder.tsx:445/980) — the same field the
   * oracle's 10th-rank pick uses — so the proposed `repertoireBonus` name has no reader and the row
   * authors `{ 1: 1 }` instead. Measured on a built summoner: L4 slots {1:2, 2:2} = 4, repertoire
   * {1:3, 2:2} = the printed maximum of five. */
  /* …and the 2026 printing takes the spare pick back. class-77 (Impossible Magic pg. 63) prints "Each
   * time you get a spell slot (see the Summoner Spells per Day table), you add a spell to your spell
   * repertoire of the same rank": repertoire == slots. The 2021 "maximum size of five" existed only
   * because the two-rank table discarded the lower ranks; the 2026 table keeps every rank it opens,
   * which is the 'psychic' ladder already implemented in src/rules/spellcasting.ts. */
  // batch 037: summoner#2026-printing
  it('summoner: the repertoire is exactly the slot table, on the 2026 retained-rank ladder', () => {
    expect(raw(cls('summoner').spellcasting).extraRepertoire).toBeUndefined();
    expect(cls('summoner').spellcasting?.progression, 'the 2026 Spells per Day table').toBe('psychic');
  });

  /* Oracular Clarity: "Add TWO common 10th-rank divine spells to your repertoire. You gain a SINGLE
   * 10th-rank spell slot". NO READER YET — same two places (build.ts:3720, Builder.tsx:3025). Keyed
   * off the entry so bard Magnum Opus and sorcerer Bloodline Paragon can reuse it. */
  it('oracle: two 10th-rank repertoire picks for one 10th-rank slot', () => {
    expect(raw(cls('oracle').spellcasting).extraRepertoire).toEqual({ 10: 1 });
    expect(cls('oracle').spellcasting?.progression, 'the 10th-rank SLOT already comes from full-plus')
      .toBe('full-plus');
  });
});
