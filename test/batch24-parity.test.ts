import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { applyPlayState, initialPlay, setPreparedCantrip } from '../src/rules/play';
import { pickableFeats, FEAT_PICK_GRANTS } from '../src/rules/featPickGrants';
import { buildChoiceOptions, buildCharacter, emptyBuild, classArchetypeSpellMods, cantripBonusFor, type BuildState } from '../src/rules/build';
import { cantripsKnown } from '../src/rules/spellcasting';

const db = content();

/**
 * Batch 24 — a CHARACTER-scoped parity read (a gnome/dromaar cloistered
 * cleric of Jaidi, free-archetype Flexible Spellcaster). 20 records read against print + WG;
 * headliners: the flexible spell COLLECTION, the repeatable Domain Initiate double-take, versatile
 * heritages' extra-ancestry feat access, sanctification's creature trait, and the deity spell-list
 * widening the Deity feature prints.
 *
 * THE FIXTURE IS SYNTHETIC — not anyone's character. Legs are numbered in file order, 1-18. Every
 * field below is here because a leg reads it; a field no leg reads was chosen freely:
 *   classId 'cleric'            — legs 3-13 and 18: every build-side assertion is a cleric's.
 *   subclassId 'cloistered'     — legs 3-6: this doctrine's grantedFeats are ['domain-initiate']
 *                                 (warpriest's are shield-block + deadly-simplicity), so only here is
 *                                 there a granted copy beside the slot take for those legs to read.
 *                                 Legs 10 and 18 do NOT pin it: three rank-1 slots at level 3 is the
 *                                 plain cleric table under either doctrine, and warpriest also reaches
 *                                 Fortitude expert (at 1 rather than 3 — src/rules/advancement.ts).
 *   level 3                     — leg 7 (two rank-2 slots), leg 8 (2nd-rank spells have arrived),
 *                                 leg 9 ("level 3 casts FOUR cantrips"), leg 18 (the 3rd doctrine step).
 *   heritageId 'dromaar'        — leg 2 needs SOME versatile heritage, and this one opens the orc feat
 *                                 list; aiuvarin is the same-shape sibling (leg 1), so it is swappable
 *                                 for the price of the two feat ids leg 2 names.
 *   ancestryId 'gnome'          — FREE. Leg 2 needs only SOME base ancestry under the versatile
 *                                 heritage; which base it is decides nothing, so it is interchangeable.
 *   deityId 'jaidi'             — leg 11 (its sanctification), leg 12 (its remaster spell trio joining
 *                                 the cleric list), legs 3-6 (family and might — two of its four printed
 *                                 domains, family/might/nature/sun — are the two those legs pick between).
 *   divineFont 'heal'           — leg 7 pins font {heal, 4, 2}; heal is also Jaidi's only printed font.
 *   variantRules.freeArchetype  — legs 7-9 and 13: without it there is no '2:archetype:2' slot at all.
 *   featPicks '2:class:0'       — legs 3-6 (the SLOT taking of Domain Initiate, against the doctrine's
 *                                 granted one) and leg 10 (the slot that is left when the dedication goes).
 *   featPicks '2:archetype:2'   — legs 7, 8, 9 and 13: the Flexible Spellcaster collection itself.
 *   featChoices '2:class:0'     — legs 4 and 5: the family domain's Soothing Words is the default focus
 *                                 spell those legs read (and leg 16 is that same record's own fix), and
 *                                 leg 6 (the domain a second take finds greyed out).
 *   effectChoices sanctification— leg 11: the holy creature trait a cleric takes and a worshipper doesn't.
 *   keyAbility 'wis'            — not a choice: cleric's only key ability.
 * Free, and so deliberately generic: the name, the base ancestry, WHICH versatile heritage,
 * background (none), attributes, skills.
 */
const pc = (over?: Partial<BuildState>): BuildState => ({
  ...emptyBuild(),
  name: 'Fennick Alder',
  classId: 'cleric',
  subclassId: 'cloistered-cleric',
  level: 3,
  ancestryId: 'gnome',
  heritageId: 'dromaar',
  deityId: 'jaidi',
  divineFont: 'heal',
  keyAbility: 'wis',
  variantRules: { freeArchetype: true },
  featPicks: { '2:class:0': 'domain-initiate', '2:archetype:2': 'flexible-spellcaster-dedication' },
  featChoices: { '2:class:0': 'family' },
  effectChoices: { 'jaidi:sanctification': 'holy' },
  ...(over ?? {}),
} as BuildState);

describe('dromaar (versatile heritage) opens the orc feat list', () => {
  it('the heritage record carries the printed extra list, and the slot gate reads it', () => {
    expect(db.heritages['dromaar'].extraAncestryFeatTraits).toEqual(['orc']);
    expect(db.heritages['aiuvarin'].extraAncestryFeatTraits, 'the same-shape sibling').toEqual(['elf']);
  });

  it("Ancestral Paragon's menu offers the base ancestry, the versatile heritage AND its extra list", () => {
    const opts = pickableFeats(FEAT_PICK_GRANTS['ancestral-paragon']!, pc(), db).map((f) => f.id);
    expect(opts, 'the base ancestry’s own feats').toContain('animal-accomplice');
    expect(opts, 'the heritage’s own feats').toContain('monstrous-peacemaker');
    expect(opts, 'the opened orc list').toContain('orc-ferocity');
  });
});

describe('the repeatable Domain Initiate', () => {
  it('a slot take with a DIFFERENT domain than the doctrine grant is two takings: two spells, pool 2', () => {
    const ch = buildCharacter(pc({ featChoices: { '2:class:0': 'might' }, grantedFeatChoices: { 'domain-initiate': 'family' } } as Partial<BuildState>), db);
    expect(ch.feats.filter((f) => f.featId === 'domain-initiate').length).toBe(2);
    const rep = ch.spellcasting.find((e) => e.type === 'focus')?.repertoire?.[1] ?? [];
    expect(new Set(rep)).toEqual(new Set(['athletic-rush', 'soothing-words']));
    expect(ch.focus).toEqual({ current: 2, max: 2 });
  });

  it('the SAME domain twice shows BOTH rows (WG-style) but still costs one spell and one pool point', () => {
    // Owner 2026-09-02: collapsing the granted copy into a matching slot take made the doctrine
    // look like it granted nothing ("I didn't get it, in WG I did"). Both instances render, each
    // with its own pickers; distinctFeatFocus dedupes by SPELL id, so the same domain twice is
    // still one focus spell and a 1-point pool — the printed economics under WG's display.
    const ch = buildCharacter(pc({ grantedFeatChoices: { 'domain-initiate': 'family' } } as Partial<BuildState>), db);
    expect(ch.feats.filter((f) => f.featId === 'domain-initiate').length).toBe(2);
    const rep = ch.spellcasting.find((e) => e.type === 'focus')?.repertoire?.[1] ?? [];
    expect(rep).toEqual(['soothing-words']);
    expect(ch.focus).toEqual({ current: 1, max: 1 });
  });

  it("the INITIAL DOMAIN SPELL is the player's pick (WG's second select), defaulting to the domain's own", () => {
    // Slot take: domain family, spell overridden to Fire Ray — the override wins for that take.
    const slotPick = buildCharacter(pc({ featSpellChoices: { '2:class:0': 'fire-ray' } } as Partial<BuildState>), db);
    const rep1 = slotPick.spellcasting.find((e) => e.type === 'focus')?.repertoire?.[1] ?? [];
    expect(rep1).toContain('fire-ray');
    expect(rep1).not.toContain('soothing-words');
    // The granted copy keys apart (`granted:<featId>`), so each take picks its own spell.
    const both = buildCharacter(
      pc({ grantedFeatChoices: { 'domain-initiate': 'family' }, featSpellChoices: { '2:class:0': 'fire-ray', 'granted:domain-initiate': 'moonbeam' } } as Partial<BuildState>),
      db,
    );
    const rep2 = both.spellcasting.find((e) => e.type === 'focus')?.repertoire?.[1] ?? [];
    expect(new Set(rep2)).toEqual(new Set(['fire-ray', 'moonbeam']));
    expect(both.focus).toEqual({ current: 2, max: 2 });
    // An override from OUTSIDE the initiate pool is refused — the printed default returns.
    const bogus = buildCharacter(pc({ featSpellChoices: { '2:class:0': 'heal' } } as Partial<BuildState>), db);
    expect(bogus.spellcasting.find((e) => e.type === 'focus')?.repertoire?.[1]).toContain('soothing-words');
  });

  it('the domain picker greys a domain another take already claimed (Q27: shown, explained, never removed)', () => {
    const b = pc({ grantedFeatChoices: { 'domain-initiate': 'family' } } as Partial<BuildState>);
    const ch = buildCharacter(b, db);
    const opts = buildChoiceOptions('domain-initiate', db.feats['domain-initiate'].choice!, b, db, ch, '2:class:0');
    const family = opts.find((o) => o.value === 'family');
    expect(family?.disabled, 'the doctrine already holds family').toBeTruthy();
    expect(opts.find((o) => o.value === 'might')?.disabled).toBeUndefined();
  });
});

describe('the flexible spell collection', () => {
  it('the class entry becomes a repertoire over the capped table, and the font is untouched', () => {
    const ch = buildCharacter(pc(), db);
    const main = ch.spellcasting.find((e) => e.id === 'cleric-casting')!;
    expect(main.type).toBe('spontaneous');
    expect(main.prepared).toBeUndefined();
    expect(main.slots?.[1]).toEqual({ max: 2, used: 0 });
    expect(main.slots?.[2]).toEqual({ max: 2, used: 0 });
    expect(main.font, 'divine font slots don’t change due to this archetype').toEqual({ type: 'heal', slots: 4, rank: 2 });
  });

  it('every collected spell is signature once 2nd-rank spells arrive, pinned by the archetype', () => {
    const ch = buildCharacter(pc({ spells: { 1: ['heal', 'bless'], 2: ['spiritual-armament', 'restoration'] } } as Partial<BuildState>), db);
    const main = ch.spellcasting.find((e) => e.id === 'cleric-casting')!;
    expect(new Set(main.signature)).toEqual(new Set(['heal', 'bless', 'spiritual-armament', 'restoration']));
    expect(main.signatureFixed).toEqual(main.signature);
  });

  it('cantrips COMPOSE to Table 5-1: the feature cuts 2, the dedication gives back 1 then 2', () => {
    // Two carriers, deliberately: classArchetype.cantripDelta holds the FEATURE's flat -2, and the
    // dedication record's spellSlotBonus.cantripsAt ladder holds its own give-back ("four cantrips
    // per day instead of three; at 4th level, five instead of four"). Cleric: 5-2+1=4 at 2nd-3rd,
    // 5-2+2=5 from 4th — the owner caught a report (and a briefly-shipped double-carrier) getting
    // this wrong; the SHEET's composition had it right, and this pins the whole sum.
    expect(classArchetypeSpellMods(pc(), db)).toEqual({ slotCap: 2, cantripDelta: -2, spellCollection: true });
    const cap = (b: BuildState) => cantripsKnown(b.classId) + cantripBonusFor(b, db) + classArchetypeSpellMods(b, db).cantripDelta;
    expect(cap(pc()), 'level 3 casts FOUR cantrips').toBe(4);
    expect(cap(pc({ level: 4 } as Partial<BuildState>)), 'level 4 is back to the full five').toBe(5);
  });

  it('without the dedication nothing changes: prepared cleric, no collection', () => {
    const plain = pc();
    plain.featPicks = { '2:class:0': 'domain-initiate' };
    const main = buildCharacter(plain, db).spellcasting.find((e) => e.id === 'cleric-casting')!;
    expect(main.type).toBe('prepared');
    expect(main.prepared?.[1]?.length).toBe(3);
  });
});

describe('Deity (Cleric) delivers its printed halves', () => {
  it('sanctification Holy confers the holy creature trait — on a cleric, not a mere worshipper', () => {
    const ch = buildCharacter(pc(), db);
    expect(ch.chosenCreatureTraits).toEqual([{ trait: 'holy', source: 'Jaidi' }]);
    const fighter = buildCharacter({ ...emptyBuild(), name: 'f', classId: 'fighter', level: 1, deityId: 'jaidi', effectChoices: { 'jaidi:sanctification': 'holy' } } as BuildState, db);
    expect(fighter.chosenCreatureTraits ?? []).toEqual([]);
  });

  it("the deity's spells join the cleric's list (Jaidi's REMASTER trio, not the legacy one)", () => {
    expect(db.deities['jaidi'].spells).toEqual(['protector-tree', 'wall-of-thorns', 'natures-pathway']);
    const ch = buildCharacter(pc(), db);
    expect(ch.spellListAdditions?.['cleric-casting']).toEqual(['protector-tree', 'wall-of-thorns', 'natures-pathway']);
  });
});

describe('cantrips are DAILY PREPARATION for a prepared class (owner, 2026-09-02)', () => {
  it('the class entry says so, and the play overlay re-prepares per opening', () => {
    const ch = buildCharacter(pc({ cantrips: ['guidance', 'shield', 'light', 'stabilize'] } as Partial<BuildState>), db);
    const main = ch.spellcasting.find((e) => e.id === 'cleric-casting')!;
    // The flexible collection keeps it: "this archetype doesn't change the way you prepare cantrips".
    expect(main.cantripsPrepared).toBe(true);
    // Re-prepare opening 1 (shield → divine lance), empty opening 3 for the day.
    let play = initialPlay(ch, db);
    play = setPreparedCantrip(play, 'cleric-casting', 1, 'divine-lance');
    play = setPreparedCantrip(play, 'cleric-casting', 3, null);
    const live = applyPlayState(ch, play, db).spellcasting.find((e) => e.id === 'cleric-casting')!;
    expect(live.cantripSlots).toEqual(['guidance', 'divine-lance', 'light', null]);
    expect(live.cantrips).toEqual(['guidance', 'divine-lance', 'light']);
    // A stale override naming a dead spell falls back to empty rather than casting nothing.
    const stale = applyPlayState(ch, setPreparedCantrip(initialPlay(ch, db), 'cleric-casting', 0, 'no-such-spell'), db)
      .spellcasting.find((e) => e.id === 'cleric-casting')!;
    expect(stale.cantripSlots?.[0]).toBeNull();
  });

  it("a spontaneous class's cantrips stay builder-known — no daily re-preparation", () => {
    const bard = buildCharacter({ ...emptyBuild(), name: 'b', classId: 'bard', level: 1, cantrips: [] } as BuildState, db);
    expect(bard.spellcasting.find((e) => e.id === 'bard-casting')?.cantripsPrepared).toBeUndefined();
  });
});

describe('record fixes', () => {
  it('Heal and Harm print their 3-action area again', () => {
    expect(db.spells['heal'].description).toContain('30-foot emanation');
    expect(db.spells['harm'].description).toContain('30-foot emanation');
  });

  it('Soothing Words (and its parser class) no longer carries an invented save', () => {
    for (const id of ['soothing-words', 'nymphs-token', 'elemental-gift', 'movanic-glimmer', 'musical-shift']) {
      expect(db.spells[id].save, id).toBeUndefined();
    }
  });

  it('halfling-luck still carries its printed 1/day free action (the Main-tab pips read it)', () => {
    expect(db.feats['halfling-luck'].actionCost).toEqual({ type: 'free' });
    expect(db.feats['halfling-luck'].limitedUses).toEqual({ max: 1, per: 'day' });
  });

  it('cloistered second doctrine: Fortitude expert at 3', () => {
    const ch = buildCharacter(pc(), db);
    expect(ch.proficiencies.saves.fortitude).toBe('expert');
  });
});
