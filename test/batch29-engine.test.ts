import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveDefenses, skillSubstitutions } from '../src/rules/derive';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 29 — the ENGINE half (types + build + derive).
 *
 * Every assertion is made on a BUILT character. The batch's data rows have NOT landed yet, so each
 * reader is exercised against a content copy with the field PATCHED IN MEMORY and its mirror image
 * with the field ABSENT — never a patched-vs-shipped delta, which would flip meaning the moment the
 * overlay row is applied.
 */
const db = content();

/** A shipped record with one field patched in memory (`undefined` removes it). */
const patched = <T extends object>(rec: T, patch: Record<string, unknown>): T => {
  const out = { ...rec } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
};

const withItem = (id: string, patch: Record<string, unknown>, base = db): ContentDatabase =>
  ({ ...base, items: { ...base.items, [id]: patched(base.items[id], patch) } }) as ContentDatabase;

const withFeat = (id: string, patch: Record<string, unknown>, base = db): ContentDatabase =>
  ({ ...base, feats: { ...base.feats, [id]: patched(base.feats[id], patch) } }) as ContentDatabase;

const withFeature = (id: string, patch: Record<string, unknown>, base = db): ContentDatabase =>
  ({ ...base, classFeatures: { ...base.classFeatures, [id]: patched(base.classFeatures[id], patch) } }) as ContentDatabase;

/** …and one SUBCLASS OPTION. A class's `subclass` is ONE field, so the whole options array is
 *  re-emitted — which is also exactly how the overlay row has to be written. */
const withSubOption = (classId: string, optionId: string, patch: Record<string, unknown>, base = db): ContentDatabase => {
  const cls = base.classes[classId];
  const sub = cls.subclass!;
  return {
    ...base,
    classes: {
      ...base.classes,
      [classId]: { ...cls, subclass: { ...sub, options: sub.options.map((o) => (o.id === optionId ? patched(o, patch) : o)) } },
    },
  } as ContentDatabase;
};

/*
 * ⚠ The inventory goes INTO the build, never spread onto an already-built character: granted Strikes,
 * slot bonuses and innate spells are all collected during buildCharacter, so attaching gear afterwards
 * never re-runs a collector and the assertion silently reads an empty list.
 */
const hero = (over: Partial<BuildState>, content_ = db): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level: 1,
      ancestryId: 'human',
      backgroundId: 'acrobat',
      ...over,
    } as BuildState,
    content_,
  );

const main = (c: Character) => c.spellcasting.find((e) => e.type === 'prepared' || e.type === 'spontaneous');
const inv = (itemId: string, state: Partial<InventoryItem>): InventoryItem =>
  ({ instanceId: itemId, itemId, quantity: 1, ...state }) as InventoryItem;

/*
 * ring-of-wizardry-type-i#arcane-gate
 * "It does nothing unless you have a spellcasting class feature with the arcane tradition. While
 * wearing the ring of wizardry, you gain a +1 item bonus to Arcana checks and have two additional
 * 1st-rank ARCANE spell slots each day." (equipment-462-568)
 *
 * The applier picked "the first spontaneous or prepared entry" with the tradition ignored, so a cleric
 * or druid who invested the ring walked off with two extra DIVINE or PRIMAL slots.
 */
describe('batch 29 — a spell-slot bonus that names a tradition', () => {
  const RING = 'ring-of-wizardry-type-i';
  const gated = withItem(RING, { spellSlotBonus: { ...db.items[RING].spellSlotBonus, tradition: 'arcane' } });
  const first = (c: Character) => main(c)?.prepared?.[1]?.length ?? 0;
  const wearing = (classId: string, keyAbility: BuildState['keyAbility'], content_: ContentDatabase) =>
    hero(
      {
        classId,
        level: 7,
        keyAbility,
        subclassId: content_.classes[classId].subclass?.options[0].id ?? null,
        inventory: [inv(RING, { worn: true, invested: true })],
      },
      content_,
    );
  const bare = (classId: string, keyAbility: BuildState['keyAbility'], content_: ContentDatabase) =>
    hero({ classId, level: 7, keyAbility, subclassId: content_.classes[classId].subclass?.options[0].id ?? null }, content_);

  it('lands the two 1st-rank slots on an ARCANE caster', () => {
    expect(first(wearing('wizard', 'int', gated)) - first(bare('wizard', 'int', gated)), 'two additional 1st-rank arcane spell slots').toBe(2);
  });

  it('and grants a PRIMAL caster nothing at all — print gates the whole item', () => {
    expect(first(wearing('druid', 'wis', gated)) - first(bare('druid', 'wis', gated))).toBe(0);
  });

  it("…which is the field's doing: with no tradition on the record the druid takes the slots", () => {
    // The mirror image, so the assertion names its carrier rather than the applier's luck: strip the
    // gate and the very same druid gains the two slots as PRIMAL ones, which is today's defect.
    const ungated = withItem(RING, { spellSlotBonus: { byRank: { '1': 2 } } });
    expect(first(wearing('druid', 'wis', ungated)) - first(bare('druid', 'wis', ungated))).toBe(2);
  });
});

/*
 * aeon-stone-vital-amplification#resonant-void-resistance
 * "The resonant power grants you resistance 5 to void damage." (equipment-3055-3589), and the family
 * page gates every resonant power on the stone being "slotted into a special magical item called a
 * wayfinder".
 *
 * Ours carried the sentence in `resonant.note` and nothing else, so the number reached no total.
 */
describe('batch 29 — a resonant DEFENCE', () => {
  const STONE = 'aeon-stone-vital-amplification';
  const withResistance = withItem(STONE, {
    resonant: { ...db.items[STONE].resonant!, resistances: [{ type: 'void', value: 5 }] },
  });
  const voidRes = (c: Character, content_: ContentDatabase) =>
    deriveDefenses(c, content_).resistances.find((r) => r.type === 'void')?.value ?? 0;
  const stoned = (slotted: boolean, content_: ContentDatabase) =>
    hero(
      {
        classId: 'fighter',
        level: 7,
        keyAbility: 'str',
        inventory: [inv(STONE, { worn: true, invested: true, ...(slotted ? { designations: ['wayfinder-slotted' as const] } : {}) })],
      },
      content_,
    );

  it('reaches the sheet while the stone is slotted in a wayfinder', () => {
    expect(voidRes(stoned(true, withResistance), withResistance)).toBe(5);
  });

  it('and not while it merely sits invested — the resonant power is what grants it', () => {
    expect(voidRes(stoned(false, withResistance), withResistance)).toBe(0);
  });

  it('…and the shipped record carries the row now, so it grants the 5 too', () => {
    // Written as "grants nothing" before the batch-29 resonant.resistances row landed; flipped on landing.
    expect(voidRes(stoned(true, db), db)).toBe(5);
  });
});

/*
 * spined-shield#granted-spikes (engine half)
 * "Five jagged spines project from the surface of this steel shield… The spines are +1 striking shield
 * spikes." (equipment-2827)
 *
 * A Spined Shield is HELD in one hand and carries no `invested` trait, so it can never be in the state
 * the strike collector's invested-only gate asked for: a `grantedStrikes` row on it was unreachable by
 * construction. All 13 shipped `grantedStrikes` items DO carry the trait, so none of them moves.
 */
describe('batch 29 — an item Strike on a held item', () => {
  const SPINES = [{ name: 'Fire Spine', die: '1d6', damageType: 'piercing', traits: ['magical'], group: 'shield', range: 120 }];
  const shielded = withItem('spined-shield', { grantedStrikes: SPINES });
  const names = (c: Character) => (c.naturalAttacks ?? []).map((n) => n.name);
  const holding = (state: Partial<InventoryItem>, content_: ContentDatabase) =>
    hero({ classId: 'fighter', level: 7, keyAbility: 'str', inventory: [inv('spined-shield', state)] }, content_);

  it('fires while the shield is HELD, though the shield is never invested', () => {
    expect(names(holding({ equipped: true }, shielded))).toContain('Fire Spine');
  });

  it('and not while it lies in the pack', () => {
    expect(names(holding({}, shielded))).not.toContain('Fire Spine');
  });

  it('…while an item that PRINTS the invested trait still demands investment', () => {
    /* The blast radius, pinned. Every one of the 13 shipped `grantedStrikes` items carries `invested`
     * (the fleshgem, the phantom shroud, the ten grafts, Taljjae's mask), so widening the gate to
     * held-or-worn must not hand a worn-but-uninvested Phantom Shroud its Ghostly Touch. */
    expect(db.items['phantom-shroud'].traits).toContain('invested');
    const worn = hero({ classId: 'fighter', level: 7, keyAbility: 'str', inventory: [inv('phantom-shroud', { worn: true })] });
    const investedShroud = hero({
      classId: 'fighter',
      level: 7,
      keyAbility: 'str',
      inventory: [inv('phantom-shroud', { worn: true, invested: true })],
    });
    expect(names(worn)).not.toContain('Ghostly Touch');
    expect(names(investedShroud)).toContain('Ghostly Touch');
  });
});

/*
 * studious-spells#gecko-grip / #hybrid-study-spell / #spellbook
 * "You gain two special 2nd-rank studious spell slots, which can be used to prepare Gecko Grip, Sure
 * Strike, Water Breathing, and an additional spell depending on your hybrid study… At 11th level, the
 * extra slots increase to 3rd-rank… At 13th level… 4th-rank… You add any spells from this class
 * feature to your spellbook." (class-feature-431)
 *
 * Ours hardcoded a fixed PAIR (never Gecko Grip), offered no choice, knew nothing of the hybrid study's
 * spell, and stripped all of it back out of the spellbook on every rebuild.
 *
 * ⚠ The magus SLOT TABLE is owner question #104 and is not touched here: the ordinary prepared counts
 * are asserted identical to the shipped build at every tier.
 */
describe('batch 29 — magus studious spells', () => {
  const LADDER = {
    label: 'Studious spells',
    note: 'Two studious spell slots, which can be used to prepare gecko grip, sure strike, water breathing, and an additional spell depending on your hybrid study.',
    ladder: [
      { level: 7, byRank: { '2': 2 }, addSpells: ['gecko-grip', 'sure-strike', 'water-breathing'] },
      { level: 11, byRank: { '3': 2 }, addSpells: ['haste'] },
      { level: 13, byRank: { '4': 2 }, addSpells: ['fly'] },
    ],
  };
  /* Inexorable Iron: Enlarge at 7th, Earthbind at 11th, Planar Tether at 13th. Its steps state
   * `byRank: {}` — the study adds a SPELL to the feature's two slots and no slot of its own. */
  const STUDY = {
    label: 'Studious spells',
    ladder: [
      { level: 7, byRank: {}, addSpells: ['enlarge'] },
      { level: 11, byRank: {}, addSpells: ['earthbind'] },
      { level: 13, byRank: {}, addSpells: ['planar-tether'] },
    ],
  };
  const authored = withSubOption(
    'magus',
    'inexorable-iron',
    { spellSlotBonus: { restricted: STUDY } },
    withFeature('studious-spells', { spellSlotBonus: { restricted: LADDER } }),
  );
  const magus = (level: number, content_: ContentDatabase) =>
    hero({ classId: 'magus', level, keyAbility: 'int', subclassId: 'inexorable-iron' }, content_);
  const studious = (c: Character) => (main(c)?.restrictedSlots ?? []).filter((s) => s.label === 'Studious spells');
  const bookIds = (c: Character) => Object.values(main(c)?.spellbook ?? {}).flat();

  it('gives TWO slots at the tier rank — 2nd at 7th, 3rd at 11th, 4th at 13th', () => {
    for (const [level, rank] of [[7, 2], [11, 3], [13, 4]] as const) {
      const slots = studious(magus(level, authored));
      expect(slots.map((s) => s.rank), `level ${level}`).toEqual([rank, rank]);
    }
  });

  it('offers the printed list — Gecko Grip included, which the hardcoded pair never was', () => {
    const allowed = studious(magus(7, authored))[0].allowed ?? [];
    expect(allowed).toEqual(expect.arrayContaining(['gecko-grip', 'sure-strike', 'water-breathing']));
  });

  it("plus the hybrid study's own spell, in the SAME two slots", () => {
    // The study's grant carries no slots of its own, so a second group here would mean its spell reached
    // no slot at all — the whole reason same-label grants are folded together.
    expect(studious(magus(7, authored))[0].allowed).toContain('enlarge');
    expect(studious(magus(11, authored))[0].allowed).toContain('earthbind');
    expect(studious(magus(13, authored))[0].allowed).toContain('planar-tether');
    expect(studious(magus(13, authored)), 'one group of two, never two groups').toHaveLength(2);
  });

  it('the ladder REPLACES the rank rather than accumulating, while the allowed list grows', () => {
    const at13 = studious(magus(13, authored))[0];
    expect(at13.rank, 'never six slots across three tiers').toBe(4);
    expect(at13.allowed).toEqual(expect.arrayContaining(['gecko-grip', 'haste', 'fly', 'enlarge', 'earthbind', 'planar-tether']));
  });

  it('…and puts every one of them in the SPELLBOOK ("You add any spells from this class feature to your spellbook")', () => {
    const book = bookIds(magus(13, authored));
    for (const id of ['gecko-grip', 'sure-strike', 'water-breathing', 'haste', 'fly', 'enlarge', 'earthbind', 'planar-tether'])
      expect(book, id).toContain(id);
    // …so an ordinary magus slot can hold them too, which is what the walled-off slots forbade.
    expect(bookIds(magus(7, authored)), 'a 13th-level spell is not in a 7th-level book').not.toContain('fly');
  });

  it('the free book entries do NOT eat the magus spellbook budget on a rebuild', () => {
    // 4 + 2/level is the printed book; writing the granted ids back as player picks would spend it.
    const rebuilt = deriveBuildFromCharacter(magus(13, authored), authored).spells;
    for (const id of ['gecko-grip', 'enlarge']) expect(Object.values(rebuilt).flat(), id).not.toContain(id);
  });

  it("under DUAL CLASS the two slots stay on the MAGUS entry, not the other class's", () => {
    /* `ownedFeatureIds` is a flat set over BOTH classes and the default entry pick is "the first
     * prepared entry" — the primary class's. Before the entryId stamp a dual-class wizard/magus took
     * its studious slots on `wizard-casting`, where the hard-coded fallback this batch stood down had
     * correctly placed them on `magus-casting`. */
    const c = hero(
      {
        classId: 'wizard',
        classId2: 'magus',
        level: 7,
        keyAbility: 'int',
        subclassId: db.classes.wizard.subclass?.options[0].id ?? null,
        subclassId2: 'inexorable-iron',
        variantRules: { dualClass: true },
      } as Partial<BuildState>,
      authored,
    );
    const rows = (id: string) => (c.spellcasting.find((e) => e.id === id)?.restrictedSlots ?? []).filter((s) => s.label === 'Studious spells');
    expect(rows('magus-casting').length, 'the magus half owns them').toBe(2);
    expect(rows('wizard-casting').length, 'and the wizard half owns none').toBe(0);
    // …and the second class's hybrid study rides the same entry, so it folds into those two slots.
    expect(rows('magus-casting')[0]?.allowed).toEqual(expect.arrayContaining(['gecko-grip', 'enlarge']));
  });

  it('and the ORDINARY slot counts are untouched — the magus slot table is owner question #104', () => {
    const counts = (p: Record<number, unknown[]>) => Object.fromEntries(Object.entries(p).map(([r, s]) => [r, s.length]));
    /* The shipped data now carries the ladder (batch 29 landed), so the pre-ladder build is recreated
     * by STRIPPING the two authored fields from a content copy — the engine then falls back to the old
     * auto-prepared pair, exactly the state this comparison was written against. */
    const stripped = withSubOption('magus', 'inexorable-iron', { spellSlotBonus: undefined }, withFeature('studious-spells', { spellSlotBonus: undefined }));
    for (const level of [7, 11, 13]) {
      const before = counts(main(magus(level, stripped))!.prepared!);
      const after = counts(main(magus(level, authored))!.prepared!);
      /* A magus is a TWO-RANK caster, so the studious tier (2nd at 7th, 3rd at 11th, 4th at 13th) is
       * never a rank its own table gives — the shipped build's only entries there are the two
       * auto-prepared studious ones, and they move wholesale into the restricted group. Every rank the
       * magus's own table does give must come out byte-identical. */
      const tier = String(level >= 13 ? 4 : level >= 11 ? 3 : 2);
      expect(before[tier], `level ${level}: the tier rank is studious-only`).toBe(2);
      const { [tier]: _studious, ...ordinary } = before;
      expect(after, `level ${level}`).toEqual(ordinary);
    }
  });
});

/*
 * graceful-leaper
 * "You can roll an Acrobatics check instead of an Athletics check when making a High Jump or Long
 * Jump." (feat-6243)
 *
 * No engine change: `skillSubstitutions` already walks the character's feats. This pins that the lane
 * really does carry the row the data agent is authoring, on a built character.
 */
describe('batch 29 — Graceful Leaper rides the existing substitution lane', () => {
  const SUB = [{ use: 'acrobatics', forSkill: 'athletics', when: 'when making a High Jump or Long Jump' }];
  const leaper = (content_: ContentDatabase) =>
    hero({ classId: 'fighter', level: 7, keyAbility: 'str', featPicks: { '2:class': 'graceful-leaper' } as BuildState['featPicks'] }, content_);

  it('surfaces on the character once the row is on the record', () => {
    const patchedDb = withFeat('graceful-leaper', { skillSubstitutions: SUB });
    const got = skillSubstitutions(leaper(patchedDb), patchedDb).find((s) => s.sourceId === 'graceful-leaper');
    expect(got).toMatchObject({ use: 'acrobatics', forSkill: 'athletics', when: 'when making a High Jump or Long Jump' });
  });

  it('…and the shipped row carries it now', () => {
    // Written as "absent today" before the batch-29 skillSubstitutions row landed; flipped on landing.
    expect(skillSubstitutions(leaper(db), db).find((s) => s.sourceId === 'graceful-leaper')).toMatchObject({ use: 'acrobatics', forSkill: 'athletics' });
  });
});

/* The shipped magus now runs on the data-driven ladder (the batch-29 rows landed): the two studious slots
 * are RESTRICTED slots offering the printed list, and the old hard-coded pair no longer fills rank 2. */
describe('batch 29 — the shipped magus runs on the studious ladder', () => {
  it('offers gecko grip, sure strike and water breathing in two restricted rank-2 slots at 7th', () => {
    const e = main(build('magus', 7));
    const studious = (e?.restrictedSlots ?? []).filter((s) => s.rank === 2);
    expect(studious).toHaveLength(2);
    expect(studious[0]?.allowed).toEqual(expect.arrayContaining(['gecko-grip', 'sure-strike', 'water-breathing']));
    expect(e?.prepared?.[2]?.map((s) => s.spellId) ?? []).not.toContain('sure-strike');
  });
});
