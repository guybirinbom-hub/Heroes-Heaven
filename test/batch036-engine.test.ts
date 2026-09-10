import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveSpeeds, deriveStrikes, deriveDefenses } from '../src/rules/derive';
import { contentGatedModes, modeRelevant } from '../src/rules/modes';
import type { Character, ContentDatabase, ProficiencyRank } from '../src/rules/types';

/*
 * Batch 036, WG-comparison lane — the ENGINE family.
 *
 * Every assertion is read off a BUILT character (or a derived Strike / Speed / defence block), never
 * off a data field. Where the mechanic still needs a backfill row the driver has not written yet, the
 * field is PATCHED INTO A CONTENT COPY IN MEMORY, so the test proves the reader and cannot flip when
 * the row lands.
 */
const db = () => content();

function buildWith(dbase: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = dbase.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: Object.keys(dbase.ancestries)[0],
      backgroundId: Object.keys(dbase.backgrounds)[0],
      keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
      ...over,
    },
    dbase,
  );
}

/** A content copy with one field patched onto one classFeature. */
function withFeatureField(id: string, field: string, value: unknown): ContentDatabase {
  const base = db();
  return { ...base, classFeatures: { ...base.classFeatures, [id]: { ...base.classFeatures[id], [field]: value } } } as ContentDatabase;
}

/* ============================================================================================
 * skill-mastery-rogue — two `options: 'any'` slots that both defaulted to Acrobatics
 * ========================================================================================== */

describe('skill-mastery-rogue: the two skill increases land on two DIFFERENT skills', () => {
  /** The skills whose rank the feat CHANGED, as `<skill>:<rank>` pairs. */
  const raisedBy = (featId: string, classId: string, level: number) => {
    const without = buildWith(db(), classId, level);
    const withIt = buildWith(db(), classId, level, { featPicks: { [`${level}:class`]: featId } });
    return Object.entries(withIt.proficiencies.skills)
      .filter(([k, v]) => v !== (without.proficiencies.skills as Record<string, ProficiencyRank>)[k])
      .map(([k, v]) => `${k}:${v}`)
      .sort();
  };

  /*
   * *"Increase your proficiency rank in one of your skills from expert to master AND IN ANOTHER of
   * your skills from trained to expert."* Both slots are `options: 'any'`, `featSkillChoiceValue`
   * defaults an unanswered slot to `options[0]` = acrobatics, and `proficiencies.skills[skill] =
   * maxRank(cur, at(grant))` then collapsed master+expert onto that one key — so one of the two
   * printed increases simply vanished.
   */
  // batch 036: skill-mastery-rogue#duplicate-skill
  it('an unanswered skill-mastery-rogue raises TWO skills, not one', () => {
    const raised = raisedBy('skill-mastery-rogue', 'rogue', 8);
    expect(raised).toContain('acrobatics:master');
    expect(raised).toContain('arcana:expert');
  });

  /* The sibling record the same fix covers — Skill Mastery (investigator archetype) prints the same
   * sentence through the same two identical slots.
   */
  // batch 036: skill-mastery-rogue#duplicate-skill
  it('skill-mastery (the investigator sibling) raises two skills as well', () => {
    const raised = raisedBy('skill-mastery', 'investigator', 8);
    expect(raised).toContain('acrobatics:master');
    expect(raised).toContain('arcana:expert');
  });

  /* Rogue Dedication's pair is `{stealth, thievery}` then `'any'` — NOT identical, so the widening
   * must leave it exactly where it was: the free slot still defaults to acrobatics.
   */
  // batch 036: skill-mastery-rogue#duplicate-skill
  it('rogue-dedication\'s non-identical pair is untouched — its free slot still defaults to acrobatics', () => {
    const raised = raisedBy('rogue-dedication', 'wizard', 2);
    expect(raised).toContain('acrobatics:trained');
    expect(raised).toContain('stealth:trained');
  });
});

/* ============================================================================================
 * hyper-boosters — the printed prerequisite, and the +5 DELTA it makes true
 * ========================================================================================== */

describe('hyper-boosters: the speed-boosters prerequisite', () => {
  /** An armour inventor at 7th with the three modification slots filled as given. */
  const inventor = (dbase: ContentDatabase, mods: Record<string, string>) =>
    buildWith(dbase, 'inventor', 7, {
      subclassId: 'armor-innovation',
      inventorArmorStats: 'power-suit',
      inventorModifications: mods,
    });

  /* The row the data family owes: `classFeatures/hyper-boosters.requiresModification =
   * ['speed-boosters']`. Patched in memory so this pins the READER, not the row. */
  const patched = () => withFeatureField('hyper-boosters', 'requiresModification', ['speed-boosters']);

  /*
   * *"You must have the speed boosters modification to select this modification."* Nothing gated the
   * pick, and Hyper Boosters' `landSpeedBonus` is deliberately the +5 DELTA over Speed Boosters' own
   * +5 — so metallic-reactance + hyper-boosters was a legal build here that walked at +5 feet against
   * a printed *"+10-foot status bonus to your Speed"*.
   */
  // batch 036: hyper-boosters#prerequisite
  it('hyper-boosters without speed-boosters is not a modification this character has', () => {
    const ch = inventor(patched(), { initial: 'metallic-reactance', breakthrough: 'hyper-boosters' });
    expect(ch.inventor?.modifications.breakthrough).toBeUndefined();
  });

  /* …and WITH the prerequisite the pick stands, and the two halves of the delta sum to the printed
   * +10 over the same character's unmodified Speed.
   */
  // batch 036: hyper-boosters#prerequisite
  it('speed-boosters + hyper-boosters keeps the pick and pays the full printed +10 feet', () => {
    const p = patched();
    const base = deriveSpeeds(inventor(p, {}), p).land;
    const ch = inventor(p, { initial: 'speed-boosters', breakthrough: 'hyper-boosters' });
    expect(ch.inventor?.modifications.breakthrough).toBe('hyper-boosters');
    expect(deriveSpeeds(ch, p).land).toBe(base + 10);
  });

  /* A modification that names NO prerequisite is offered exactly as before — the gate must not turn
   * into "every modification needs a parent".
   */
  // batch 036: hyper-boosters#prerequisite
  it('a modification with no requiresModification is unaffected by the gate', () => {
    expect(inventor(patched(), { initial: 'metallic-reactance' }).inventor?.modifications.initial).toBe('metallic-reactance');
  });
});

describe('hyper-boosters: the Overdrive step of the Speed bonus', () => {
  /*
   * *"You gain a +10-foot status bonus to your Speed, which increases to a +20-foot status bonus when
   * you're in Overdrive."* The Overdrive step was prose only. The row the data family owes is
   * `classFeatures/hyper-boosters.whileActive = [{ state: 'overdrive', speeds: { land: 10 } }]`;
   * patched in memory here, so this pins the `activeStateGrants` reader rather than the row.
   */
  // batch 036: hyper-boosters#overdrive
  it('an inventor in Overdrive walks 10 feet faster than the same inventor out of it', () => {
    /* ⚠ speed-boosters' own `whileActive` is STRIPPED alongside the patch, not left at whatever
     * ships. The RED round's inventor-modification group emits
     * `classFeatures/speed-boosters.whileActive = [{state:'overdrive',speeds:{land:5}}]` (its
     * Overdrive rung had no carrier at all), and hyper-boosters requires speed-boosters — so with the
     * row shipped and only hyper-boosters patched here this became a patched-vs-shipped delta and read
     * 15, failing an assertion that is about hyper-boosters' clause alone. Stripped, it pins the
     * `activeStateGrants` reader whatever the two records ship, which is what the note above intends.
     * (Measured: 10 before the row, 15 after.) The pair's real post-row arithmetic — +10 base / +20 in
     * Overdrive, both printed numbers — is pinned in test/batch036-gap-inventor.test.ts. */
    const bare = db();
    const p = {
      ...bare,
      classFeatures: {
        ...bare.classFeatures,
        'speed-boosters': { ...bare.classFeatures['speed-boosters'], whileActive: undefined },
        'hyper-boosters': { ...bare.classFeatures['hyper-boosters'], whileActive: [{ state: 'overdrive', speeds: { land: 10 } }] },
      },
    } as ContentDatabase;
    const ch = buildWith(p, 'inventor', 7, {
      subclassId: 'armor-innovation',
      inventorArmorStats: 'power-suit',
      inventorModifications: { initial: 'speed-boosters', breakthrough: 'hyper-boosters' },
    });
    const off = deriveSpeeds(ch, p).land;
    const on = deriveSpeeds({ ...ch, classResources: { ...ch.classResources, overdrive: 1 } }, p).land;
    expect(on).toBe(off + 10);
  });
});

/* ============================================================================================
 * advanced-weaponry-construct — the modification's own second question
 * ========================================================================================== */

describe('advanced-weaponry-construct: the chosen weapon modification is recorded', () => {
  /*
   * *"Choose one of your construct's unarmed attacks to gain your choice of one initial weapon
   * modification."* The record asks a second question and there was no route for the answer: an
   * inventor modification is a classFeatures record that reaches neither `resolvePick` loop, so the
   * pick could not be stored, applied or shown. The `effectChoices` block is the data family's row;
   * patched in memory so this pins the reader.
   */
  const patched = () =>
    withFeatureField('advanced-weaponry-construct', 'effectChoices', [
      {
        id: 'modification',
        prompt: "Choose an initial weapon modification for your construct's unarmed attack",
        options: [
          { value: 'razor-prongs', label: 'Razor Prongs' },
          { value: 'modular-head', label: 'Modular Head' },
        ],
      },
    ]);

  const constructInventor = (dbase: ContentDatabase, over: Partial<BuildState> = {}) =>
    buildWith(dbase, 'inventor', 7, {
      subclassId: 'construct-innovation',
      inventorModifications: { breakthrough: 'advanced-weaponry-construct' },
      ...over,
    });

  // batch 036: advanced-weaponry-construct
  it("the player's answer on advanced-weaponry-construct reaches the built character's effectPicks", () => {
    const p = patched();
    const ch = constructInventor(p, { effectChoices: { 'advanced-weaponry-construct:modification': 'modular-head' } });
    const pick = ch.effectPicks?.find((x) => x.recordId === 'advanced-weaponry-construct' && x.choiceId === 'modification');
    expect(pick?.label).toBe('Modular Head');
  });

  /* An UNANSWERED multi-option pick claims nothing — the modification is chosen, the sub-question is
   * still open, and the sheet says so by carrying no pick rather than inventing the first option.
   */
  // batch 036: advanced-weaponry-construct
  it('an unanswered advanced-weaponry-construct records no modification', () => {
    const p = patched();
    expect(constructInventor(p).effectPicks?.some((x) => x.recordId === 'advanced-weaponry-construct')).toBeFalsy();
  });
});

/* ============================================================================================
 * animalistic-brutality — a trait that lasts only as long as the Rage
 * ========================================================================================== */

describe('animalistic-brutality: the chosen trait reaches the bestial-rage Strike', () => {
  /*
   * *"Your unarmed attack from bestial rage gains one of the following traits until you stop raging:
   * backswing, forceful, parry, razing, or sweep."* A rider with an off switch is a mode (Q11), and
   * `ModeDef` could not carry an unarmed rider at all — so the chosen trait reached no Strike row.
   * The five mode records are the data family's; one is patched in here, so this pins the reader.
   */
  const mode = {
    id: 'animalistic-brutality-forceful',
    name: 'Animalistic Brutality (Forceful)',
    predefined: true,
    exclusiveGroup: 'animalistic-brutality',
    modifiers: [],
    unarmedTraits: { fromRecord: 'animal-instinct', add: ['forceful'] },
  };

  /** A RAGING animal-instinct barbarian: the bestial-rage Jaws carry `requiresState: 'rage'`, so the
   *  Strike the feat talks about only exists while the Rage toggle is on. */
  const rager = (modeOn: boolean) => {
    const base = db();
    const p = { ...base, modes: { ...base.modes, [mode.id]: mode } } as ContentDatabase;
    const ch = buildWith(p, 'barbarian', 8, {
      subclassId: 'animal-instinct',
      featChoices: { 'feature:animal-instinct': 'wolf' },
      featPicks: { '8:class': 'animalistic-brutality' },
    });
    return deriveStrikes(
      { ...ch, classResources: { ...ch.classResources, rage: 1 }, activeModes: modeOn ? [p.modes[mode.id]] : [] },
      p,
    );
  };

  // batch 036: animalistic-brutality
  it("the animal-instinct barbarian's bestial-rage Jaws gain forceful while the animalistic-brutality mode is on", () => {
    expect(rager(true).find((s) => /jaws/i.test(s.name))?.traits).toContain('forceful');
  });

  /* …and lose it the moment the mode is off, which is the whole reason it is a mode: an
   * `unarmedTraits` rider on the FEAT would have handed the barbarian the trait permanently.
   */
  // batch 036: animalistic-brutality
  it('the same animal-instinct Jaws have no forceful with the mode off', () => {
    expect(rager(false).find((s) => /jaws/i.test(s.name))?.traits).not.toContain('forceful');
  });
});

/* ============================================================================================
 * energy-resistant — an etched armour property rune that granted nothing
 * ========================================================================================== */

describe('energy-resistant: the etched rune delivers its resistance', () => {
  /** `over` patches the LIVE row, the way play state does: buildCharacter re-emits inventory rows and
   *  keeps no per-row `effectChoices`, so the crafter's answer reaches derive through the play
   *  inventory (play.ts:599 `inventory: play.inventory ?? ch.inventory`) — which is where the sheet's
   *  own item-choice store writes it. */
  const armored = (over: Record<string, unknown> = {}) => {
    const p = db();
    const ch = buildWith(p, 'fighter', 8, {
      inventory: [{ instanceId: 'a1', itemId: 'chain-shirt', quantity: 1, worn: true, invested: true, runes: { property: ['energy-resistant'] } }],
    } as Partial<BuildState>);
    return deriveDefenses({ ...ch, inventory: ch.inventory.map((i) => ({ ...i, ...over })) }, p).resistances;
  };

  /*
   * *"You gain resistance 5 to acid, cold, electricity, or fire. The crafter chooses the damage type
   * when creating the rune."* The whole payload sits in the rune ITEM's `effectChoices`, which only
   * resolved for a LOOSE inventory row — and etching consumes that row — so an etched
   * Energy-Resistant rune granted 0. Unanswered takes the first option (acid), which is what WG's own
   * row grants.
   */
  // batch 036: energy-resistant
  it('an etched energy-resistant rune with no recorded pick grants acid resistance 5', () => {
    expect(armored().find((r) => r.type === 'acid')?.value).toBe(5);
  });

  /* …and the crafter's recorded pick, carried on the HOST row, wins over that fallback.
   */
  // batch 036: energy-resistant
  it("the crafter's recorded energy type is the one delivered", () => {
    const res = armored({ effectChoices: { 'energy-resistant:energy': 'fire' } });
    expect(res.find((r) => r.type === 'fire')?.value).toBe(5);
    expect(res.some((r) => r.type === 'acid')).toBe(false);
  });

  /* Armour in the pack protects nobody: the walk this rides in is gated on `itemInUse`.
   */
  // batch 036: energy-resistant
  it('the rune grants nothing while the armour is not worn', () => {
    expect(armored({ worn: false, invested: false }).some((r) => r.type === 'acid')).toBe(false);
  });
});

/* ============================================================================================
 * lorefinder / armored-resistance — readers that exist, rows that do not
 * ========================================================================================== */

describe('lorefinder: the innate Locate heightens at 14th', () => {
  const patched = () => {
    const base = db();
    const f = base.feats['lorefinder'];
    return {
      ...base,
      feats: { ...base.feats, lorefinder: { ...f, innateSpells: [{ ...f.innateSpells![0], heightenAt: [{ level: 14, rank: 5 }] }] } },
    } as ContentDatabase;
  };

  /** The RANK bucket the innate entry files Locate under — that bucket IS the cast rank. */
  const castRank = (level: number) => {
    const p = patched();
    const ch = buildWith(p, 'wizard', level, { featPicks: { '2:class': 'eldritch-researcher-dedication', '8:class': 'lorefinder' } });
    const rep = ch.spellcasting?.find((e) => e.type === 'innate')?.repertoire ?? {};
    return Number(Object.entries(rep).find(([, ids]) => ids.includes('locate'))?.[0]);
  };

  /*
   * *"You can cast Locate as an innate occult spell once per day. When you reach 14th level, this
   * spell is heightened to 5th level."* Our grant carried no `heightenAt`, so the cast rank fell to
   * the spell's own base rank 3 forever. `heightenAt` is the data family's row; patched in memory so
   * this pins the `castRank` reader in build.ts.
   */
  // batch 036: lorefinder
  it('a 14th-level lorefinder casts Locate at 5th rank', () => {
    expect(castRank(14)).toBe(5);
  });

  /* …and a 13th-level one still casts it at its base 3rd, so the step is a step and not a raise.
   */
  // batch 036: lorefinder
  it('a 13th-level lorefinder still casts Locate at 3rd rank', () => {
    expect(castRank(13)).toBe(3);
  });
});

describe('armored-resistance: the Intercept Attack resistance already reaches the guardian', () => {
  /*
   * *"While you are wearing medium or heavy armor, you gain resistance to physical damage equal to
   * half your character level when you use the Intercept Attack reaction to take damage instead of
   * your ally."*
   *
   * ⚠ NOTHING IS PATCHED HERE, AND NO ROW IS OWED. The finding read this as carried by neither side,
   * but its sweep never looked in the core.json MODES bucket: `modes/armored-resistance` ships today
   * with `feats: ['armored-resistance']` and `resistances: [{type:'physical',
   * value:'floor(@actor.level/2)'}]`, so the printed sentence is already delivered — as a TOGGLE,
   * which is the right shape for a resistance that exists only while a reaction is being used.
   *
   * The verifier withdrew the builder's `feats/armored-resistance.resistances` row: applied on top of
   * the mode it made `deriveDefenses().sources['resistance:physical']` return two lines, both named
   * "Armored Resistance", both applied — the same sentence answered twice. This test is what stops it
   * being re-authored: it asserts the mode is the ONE carrier.
   */
  const guardian = (p: ContentDatabase) =>
    buildWith(p, 'fighter', 10, {
      featPicks: { '2:class': 'guardian-dedication', '4:class': 'guardians-intercept', '10:class': 'armored-resistance' },
    });

  // batch 036: armored-resistance#resistance
  it('the shipped mode is offered to a guardian who took the feat and pays physical 5 at 10th', () => {
    const p = db();
    const md = contentGatedModes(Object.values(p.modes)).find((m) => m.id === 'armored-resistance');
    expect(!!md).toBe(true);
    const ch = guardian(p);
    expect(modeRelevant(md!, ch.classId, ch.ancestryId, new Set(ch.feats.map((f) => f.featId)))).toBe(true);
    expect(deriveDefenses({ ...ch, activeModes: [md!] }, p).resistances.find((r) => r.type === 'physical')?.value).toBe(5);
  });

  /* …and OFF when the reaction is not being used, which is the whole reason it is a toggle. */
  // batch 036: armored-resistance#resistance
  it('a guardian who is not Intercepting has no physical resistance', () => {
    const p = db();
    expect(deriveDefenses(guardian(p), p).resistances.some((r) => r.type === 'physical')).toBe(false);
  });

  /* THE GUARD. A second carrier on the feat record would state the same sentence twice on the sheet's
   * own IWR breakdown — one line from the feat, one from the mode, both reading "Armored Resistance".
   */
  // batch 036: armored-resistance#resistance
  it('armored-resistance has exactly ONE carrier — the feat record must not grow a resistances field', () => {
    const p = db();
    expect(p.feats['armored-resistance'].resistances).toBeUndefined();
    const ch = guardian(p);
    const lines = deriveDefenses({ ...ch, activeModes: [p.modes['armored-resistance']] }, p).sources?.['resistance:physical'] ?? [];
    expect(lines.filter((s) => s.from === 'Armored Resistance').length).toBe(1);
  });
});
