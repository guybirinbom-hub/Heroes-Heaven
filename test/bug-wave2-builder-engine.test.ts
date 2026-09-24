import { describe, it, expect } from 'vitest';
import { content } from './_content';
import {
  buildCharacter,
  activeLanguageLores,
  bonusLanguageSlots,
  intLanguageSlots,
  emptyBuild,
  levelChoices,
  levelGrants,
  loreKey,
  CUSTOM_BACKGROUND_ID,
  type BuildState,
} from '../src/rules/build';
import { eligibleFeatsForSlot, fitsSlot, moveTargetFor, picksLosingSlot, rekeyFeatSlots, SLOT_ORDER } from '../src/rules/featSlots';
import { KINETIC_ELEMENTS } from '../src/rules/kineticElements';
import type { FeatCategory } from '../src/rules/types';

/**
 * WAVE 2 — the two Builder items that live in the rules engine.
 *
 *  (3) A HOMEBREW background may name a trained skill the character already has from another source.
 *      Measured before the fix, on a druid (class-trained in Nature) whose custom background also
 *      trains Nature: `skillFallbacks` was undefined, no replacement was offered anywhere, and the
 *      background's whole skill grant bought the player nothing. Printed records solve exactly this
 *      with their redundancy clause (`redundantFallback` → `skillFallbacks` → the builder's
 *      replacement picker); the homebrew lane now uses the same three pieces and the same answer key.
 *
 *  (5) "Lore instead of language" — a setup house rule. Each language slot INTELLIGENCE grants may be
 *      spent on training in a new Lore instead, one slot at a time, at creation and at every Int
 *      increase. Before it there was no such choice at all: a dwarf fighter with Int 16 got three
 *      language slots and nothing else. Ancestry- and record-granted language slots are NOT tradeable.
 */
const c = content();

// ───────────────────────────────────────────────── (3) homebrew background, already-trained skill

/** A druid — class-trained in Nature — with a custom background that also trains Nature. */
const druidHomebrew = (over: Partial<BuildState> = {}): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level: 1,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: CUSTOM_BACKGROUND_ID,
  customBackground: {
    name: 'Grove Warden',
    description: '',
    boosts: ['wis', 'con'],
    trainedSkill: 'nature',
    loreSubject: '',
    skillFeatId: null,
  },
  classId: 'druid',
  keyAbility: 'wis',
  ...over,
});

describe('(3) a homebrew background that trains an already-trained skill owes a replacement', () => {
  it('reports the redundancy on skillFallbacks instead of granting nothing', () => {
    const ch = buildCharacter(druidHomebrew(), c);
    expect(ch.skillFallbacks).toEqual([{ featId: CUSTOM_BACKGROUND_ID, skill: 'nature' }]);
    // The class training is still there; the background just didn't add a second copy of it.
    expect(ch.proficiencies.skills.nature).toBe('trained');
    expect(ch.grantedSkills?.nature).toBe('your class');
  });

  it('the replacement answer trains the skill the player chose instead', () => {
    const ch = buildCharacter(
      druidHomebrew({ featSkillChoices: { [`${CUSTOM_BACKGROUND_ID}:fallback:nature`]: 'acrobatics' } }),
      c,
    );
    expect(ch.proficiencies.skills.acrobatics).toBe('trained');
    expect(ch.grantedSkills?.acrobatics).toBe('your background');
    // Still reported, so the builder keeps showing the card the answer belongs to.
    expect(ch.skillFallbacks?.some((f) => f.featId === CUSTOM_BACKGROUND_ID)).toBe(true);
  });

  it('a homebrew background naming a FREE skill is untouched — no card, no replacement', () => {
    const ch = buildCharacter(
      druidHomebrew({
        customBackground: { ...druidHomebrew().customBackground!, trainedSkill: 'thievery' },
      }),
      c,
    );
    expect(ch.proficiencies.skills.thievery).toBe('trained');
    expect(ch.grantedSkills?.thievery).toBe('your background');
    expect(ch.skillFallbacks ?? []).toEqual([]);
  });

  it('a background from the HOMEBREW PAGE gets the same card, keyed by its own id', () => {
    // Synthetic: a Homebrew-page record is an ordinary background whose source says `homebrew`
    // (src/data/index.ts tags every homebrew entry so). Not in the shipped content, so injected here.
    const hb = {
      ...c.backgrounds.herbalist!,
      id: 'hb-grove-warden',
      name: 'Grove Warden',
      trainedSkill: 'nature' as const,
      source: { license: 'homebrew' as const, book: 'My Table' },
    };
    const withHb = { ...c, backgrounds: { ...c.backgrounds, [hb.id]: hb } };
    const b = druidHomebrew({ backgroundId: hb.id, customBackground: undefined });
    expect(buildCharacter(b, withHb).skillFallbacks).toEqual([{ featId: hb.id, skill: 'nature' }]);
    const answered = buildCharacter({ ...b, featSkillChoices: { [`${hb.id}:fallback:nature`]: 'medicine' } }, withHb);
    expect(answered.proficiencies.skills.medicine).toBe('trained');
    expect(answered.grantedSkills?.medicine).toBe('your background');
  });

  it('a PRINTED background is not touched by this lane (its own redundancy clauses still rule)', () => {
    // Herbalist trains Nature, and a druid is already trained in it. The printed record carries no
    // redundancy clause, so the engine must keep saying nothing — this lane is homebrew-only.
    const ch = buildCharacter(druidHomebrew({ backgroundId: 'herbalist', customBackground: undefined }), c);
    expect(c.backgrounds.herbalist?.trainedSkill).toBe('nature');
    expect(ch.skillFallbacks ?? []).toEqual([]);
  });
});

// ───────────────────────────────────────────────── (5) Lore instead of language

/** A dwarf fighter with Int 16 (+3): three Int-granted language slots and, because dwarves have no
 *  `languages.additional`, no other bonus slot to confuse the count with. */
const dwarf = (over: Partial<BuildState> = {}): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level: 1,
  ancestryId: 'dwarf',
  heritageId: 'ancient-blooded-dwarf',
  backgroundId: 'scholar',
  classId: 'fighter',
  keyAbility: 'str',
  ancestryBoosts: ['int'],
  backgroundBoosts: ['int'],
  levelBoosts: ['int', 'str', 'dex', 'con'],
  ...over,
});

/** Languages every one of these fixtures is GRANTED (dwarf), so the assertions read the picks only. */
const GRANTED_LANGS = ['common', 'dwarven'];
/** …and the Lore the Scholar background trains on its own, which is not this rule's business. */
const BACKGROUND_LORE = 'lore:academia';
const bonusLangs = (b: BuildState) =>
  buildCharacter(b, c).languages.filter((l) => !GRANTED_LANGS.includes(l));
const lores = (b: BuildState) =>
  Object.entries(buildCharacter(b, c).proficiencies.skills)
    .filter(([k, r]) => k.startsWith('lore:') && r !== 'untrained' && k !== BACKGROUND_LORE)
    .map(([k]) => k)
    .sort();

describe('(5) "Lore instead of language"', () => {
  it('Int +3 at level 1 is three Int-granted slots, and they are all the rule may trade', () => {
    const b = dwarf();
    expect(buildCharacter(b, c).abilities.int).toBe(16);
    expect(intLanguageSlots(b, c)).toBe(3);
    expect(bonusLanguageSlots(b, c)).toBe(3); // dwarf adds no extra language slot of its own
  });

  it('OFF: three languages and no Lore, even with subjects sitting in the build', () => {
    const b = dwarf({ languages: ['elven', 'gnomish', 'jotun'], languageLores: ['Warfare', 'Sailing'] });
    expect(bonusLangs(b)).toEqual(['elven', 'gnomish', 'jotun']);
    expect(lores(b)).toEqual([]);
    expect(bonusLanguageSlots(b, c)).toBe(3);
  });

  it('ON: two slots answered with Lores and one with a language → 2 trained Lores + 1 language', () => {
    const b = dwarf({
      variantRules: { loreInsteadOfLanguage: true },
      languages: ['elven'],
      languageLores: ['Warfare', 'Sailing'],
    });
    expect(lores(b)).toEqual(['lore:sailing', 'lore:warfare']);
    expect(bonusLangs(b)).toEqual(['elven']);
    expect(bonusLanguageSlots(b, c)).toBe(1);
  });

  it('ON with no Lores answered is exactly the OFF build — the rule never spends a slot by itself', () => {
    const picks = { languages: ['elven', 'gnomish', 'jotun'] };
    const on = dwarf({ ...picks, variantRules: { loreInsteadOfLanguage: true } });
    expect(bonusLangs(on)).toEqual(['elven', 'gnomish', 'jotun']);
    expect(lores(on)).toEqual([]);
  });

  it('turning the rule ON never overwrites languages the player already picked', () => {
    const off = dwarf({ languages: ['elven', 'gnomish', 'jotun'] });
    const on = { ...off, variantRules: { loreInsteadOfLanguage: true } };
    // The stored answers are untouched…
    expect(on.languages).toEqual(['elven', 'gnomish', 'jotun']);
    // …and so is what the character actually knows, until a slot is spent on a Lore.
    expect(bonusLangs(on)).toEqual(bonusLangs(off));
  });

  it('only INT slots are tradeable — a human keeps its ancestry language slot as a language', () => {
    // Human: Int +3 plus one ancestry language slot = 4. Two Lores leave 1 Int slot + the ancestry's.
    const h = dwarf({
      ancestryId: 'human',
      heritageId: 'versatile-human',
      variantRules: { loreInsteadOfLanguage: true },
      languages: ['elven', 'gnomish'],
      languageLores: ['Warfare', 'Sailing'],
    });
    expect(intLanguageSlots(h, c)).toBe(3);
    expect(bonusLanguageSlots(h, c)).toBe(2);
    expect(buildCharacter(h, c).languages).toContain('elven');
    expect(buildCharacter(h, c).languages).toContain('gnomish');
  });

  it('more Lore subjects than Int slots cannot mint extra trainings or eat other slots', () => {
    const b = dwarf({
      variantRules: { loreInsteadOfLanguage: true },
      languageLores: ['Warfare', 'Sailing', 'Mining', 'Heraldry', 'Academia'],
    });
    expect(lores(b)).toEqual(['lore:mining', 'lore:sailing', 'lore:warfare']);
    expect(bonusLanguageSlots(b, c)).toBe(0);
  });

  it('a slot that only appears at an Int INCREASE is offered the same trade', () => {
    // Same build at 5th level with the level-5 boosts spent on Int: mod +4, so a fourth slot exists
    // and a fourth Lore now trains where it could not at 1st.
    const at5 = dwarf({
      level: 5,
      attributeBoosts: { 5: ['int', 'str', 'dex', 'con'] },
      variantRules: { loreInsteadOfLanguage: true },
      languageLores: ['Warfare', 'Sailing', 'Mining', 'Heraldry'],
    });
    expect(intLanguageSlots(at5, c)).toBe(4);
    expect(lores(at5)).toEqual(['lore:heraldry', 'lore:mining', 'lore:sailing', 'lore:warfare']);
  });
});

describe('(5) a Lore never takes a language away, never repeats a Lore, and is keyed once', () => {
  const ON = { loreInsteadOfLanguage: true } as const;
  const THREE_LORES = ['lore:warfare', 'lore:sailing', 'lore:mining'];
  const THREE_LANGS = ['elven', 'gnomish', 'jotun'];

  it('rule on → all three slots Lores; off → three languages picked; on again → the languages stay', () => {
    // Step 1, rule on: the three Int slots are all Lores.
    const step1 = dwarf({ variantRules: ON, languageLores: THREE_LORES });
    expect(lores(step1)).toEqual(['lore:mining', 'lore:sailing', 'lore:warfare']);
    expect(bonusLanguageSlots(step1, c)).toBe(0);
    // Step 2, rule off: the Lores are kept but idle, the slots are languages again, and the player fills them.
    const step2 = { ...step1, variantRules: {}, languages: THREE_LANGS };
    expect(bonusLanguageSlots({ ...step2, languages: [] }, c)).toBe(3);
    expect(bonusLangs(step2)).toEqual(THREE_LANGS);
    // Step 3, rule back on: before the fix the Lores came back and all three languages silently left
    // the character (languages → ['common','dwarven']). The languages the player picked win.
    const step3 = { ...step2, variantRules: ON };
    expect(bonusLangs(step3)).toEqual(THREE_LANGS);
    expect(lores(step3)).toEqual([]);
    expect(activeLanguageLores(buildCharacter(step3, c))).toEqual([]);
    expect(bonusLanguageSlots(step3, c)).toBe(3);
    // Nothing the player stored was written away: the Lores come back as soon as a slot frees up.
    expect(step3.languageLores).toEqual(THREE_LORES);
    const freed = { ...step3, languages: ['elven'] };
    expect(bonusLangs(freed)).toEqual(['elven']);
    expect(lores(freed)).toEqual(['lore:sailing', 'lore:warfare']);
    expect(activeLanguageLores(buildCharacter(freed, c))).toEqual(['lore:warfare', 'lore:sailing']);
  });

  it('only as many Lores give way as the languages need — the first stored ones stay', () => {
    const b = dwarf({ variantRules: ON, languageLores: THREE_LORES, languages: ['elven', 'gnomish'] });
    expect(bonusLangs(b)).toEqual(['elven', 'gnomish']);
    expect(activeLanguageLores(buildCharacter(b, c))).toEqual(['lore:warfare']);
    expect(bonusLanguageSlots(b, c)).toBe(2);
  });

  it('a lowered Int makes a Lore give way too, never a picked language', () => {
    // Int 14 (+2): two Int slots for one Lore and one language, then the same answers at Int +3 minus a boost.
    const b = dwarf({ variantRules: ON, languageLores: ['lore:warfare', 'lore:sailing'], languages: ['elven'], backgroundBoosts: ['str'] });
    expect(intLanguageSlots(b, c)).toBe(2);
    expect(bonusLangs(b)).toEqual(['elven']);
    expect(activeLanguageLores(buildCharacter(b, c))).toEqual(['lore:warfare']);
  });

  it('a Lore the character already has spends no slot (Scholar trains Academia Lore)', () => {
    // Before the fix: slots 3 → 2 and still only lore:academia — a slot spent on nothing.
    const b = dwarf({ variantRules: ON, languageLores: ['lore:academia'] });
    const ch = buildCharacter(b, c);
    expect(ch.proficiencies.skills['lore:academia']).toBe('trained');
    expect(activeLanguageLores(ch)).toEqual([]);
    expect(bonusLanguageSlots(b, c)).toBe(3);
  });

  it('the same Lore stored twice counts once', () => {
    const b = dwarf({ variantRules: ON, languageLores: ['lore:warfare', 'Warfare Lore'] });
    expect(activeLanguageLores(buildCharacter(b, c))).toEqual(['lore:warfare']);
    expect(bonusLanguageSlots(b, c)).toBe(2);
  });

  it('one keyer: what the card shows for a typed subject is the Lore the engine trains', () => {
    // Before the fix the card stripped "lore" anywhere and the engine only a trailing " lore", so
    // "Lore of the Sea" showed as Of The Sea Lore while lore:lore-of-the-sea was trained.
    for (const [typed, key] of [
      ['Lore of the Sea', 'lore:sea'],
      ['Lore: Sailing', 'lore:sailing'],
      ['Warfare Lore', 'lore:warfare'],
    ] as const) {
      expect(loreKey(typed)).toBe(key);
      expect(loreKey(key)).toBe(key); // a stored key keys to itself
      const ch = buildCharacter(dwarf({ variantRules: ON, languageLores: [key] }), c);
      expect(activeLanguageLores(ch)).toEqual([key]);
      expect(buildCharacter(dwarf({ variantRules: ON, languageLores: [typed] }), c).proficiencies.skills[key]).toBe('trained');
    }
    expect(loreKey('Lore')).toBeNull();
  });
});

// ───────────────────────────────────────────── ONE Lore keyer, every surface (refuter + owner Q2)

describe('one Lore keyer: the same subject typed four ways is one Lore everywhere', () => {
  const SEA = ['Lore of the Sea', 'sea lore', 'Sea Lore ', 'lore: sea'];
  /** Inlander asks the player to TYPE its Lore — the engine-side field the builder cards never keyed. */
  const inlander = (over: Partial<BuildState> = {}) => dwarf({ backgroundId: 'inlander', ...over });

  it('the function: all four are lore:sea', () => {
    for (const s of SEA) expect(loreKey(s), s).toBe('lore:sea');
  });

  it('a background typed any of the four ways trains lore:sea, and nothing else', () => {
    for (const s of SEA) {
      const skills = buildCharacter(inlander({ backgroundLore: s }), c).proficiencies.skills;
      expect(skills['lore:sea'], s).toBe('trained');
      expect(Object.keys(skills).filter((k) => k.startsWith('lore:') && k !== BACKGROUND_LORE), s).toEqual(['lore:sea']);
    }
  });

  it('typed on the background AND on a language slot AND as a class skill, it is still ONE Lore', () => {
    // Before: the background trained lore:lore-of-the-sea while the Languages card stored lore:sea —
    // two Lores, and the language slot was spent on the second. Now the slot and the class pick see the
    // background's Lore and spend nothing.
    const b = inlander({
      backgroundLore: 'Lore of the Sea',
      variantRules: { loreInsteadOfLanguage: true },
      languageLores: [loreKey('Sea Lore ')!],
      classSkills: [loreKey('lore: sea')!, 'athletics'],
    });
    const ch = buildCharacter(b, c);
    expect(Object.keys(ch.proficiencies.skills).filter((k) => k.startsWith('lore:') && k !== BACKGROUND_LORE)).toEqual(['lore:sea']);
    expect(activeLanguageLores(ch)).toEqual([]);
    expect(bonusLanguageSlots(b, c)).toBe(3);
    expect(ch.grantedSkills?.['lore:sea']).toBe('your background');
  });

  it('a skill increase saved on the OLD engine key follows the Lore to its one key', () => {
    // A 3rd-level increase stored while "Lore of the Sea" trained lore:lore-of-the-sea: without the
    // follow it would land on a Lore nothing trains any more and the player's expert rank would split.
    const b = inlander({ level: 3, backgroundLore: 'Lore of the Sea', skillIncreases: { 3: 'lore:lore-of-the-sea' } });
    const skills = buildCharacter(b, c).proficiencies.skills;
    expect(skills['lore:sea']).toBe('expert');
    expect(skills['lore:lore-of-the-sea']).toBeUndefined();
    // …and an increase on a Lore that IS its own (untrained, nothing to follow) is left exactly where it was.
    expect(buildCharacter(inlander({ level: 3, skillIncreases: { 3: 'lore:mining' } }), c).proficiencies.skills['lore:mining']).toBe('trained');
  });

  it('a printed background Lore names its source (Acolyte → Scribing: "your background")', () => {
    const ch = buildCharacter(dwarf({ backgroundId: 'acolyte' }), c);
    expect(ch.proficiencies.skills['lore:scribing']).toBe('trained');
    expect(ch.grantedSkills?.['lore:scribing']).toBe('your background');
  });
});

// ─────────────────────────── (4) turning a rule on/off keeps every OTHER pick in its own slot

/**
 * The refuter's exact case. Slot keys are `<level>:<category>:<index in that level's slot list>` and
 * Free Archetype pushes 'archetype' before 'mythic', so a level-2 fighter's slots go
 * [class, skill, archetype, mythic] → [class, skill, mythic] and the mythic pick's slot moves
 * 2:mythic:3 → 2:mythic:2. Before the fix the pick stayed at 2:mythic:3: on the sheet, gone from the
 * Builder, its slot drawn empty and "2 choices left" — a silent loss.
 */
const fighter2 = (over: Partial<BuildState> = {}): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level: 2,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'fighter',
  keyAbility: 'str',
  mythicEnabled: true,
  ...over,
});
/** Every answer that hangs off a slot key, on BOTH moving slots, so a map the re-key missed shows. */
const MYTHIC_FA: BuildState = fighter2({
  variantRules: { freeArchetype: true },
  featPicks: {
    '1:class:1': 'sudden-charge',
    '2:class:0': 'intimidating-strike',
    '2:skill:1': 'cat-fall',
    '2:archetype:2': 'rogue-dedication',
    '2:mythic:3': 'arms-that-cut-the-waves',
  },
  featChoices: { '2:mythic:3': 'answer', '2:mythic:3#1': 'second', '2:class:0': 'kept' },
  featSpellChoices: { '2:mythic:3:granted-spell': 'heal' },
  featLoreChoices: { '2:mythic:3:0': 'Sailing', 'additional-lore:0': 'Warfare' },
  effectChoices: { '2:mythic:3:form': 'wave', 'sudden-charge:x': 'y' },
  pickFeatChoices: { '2:mythic:3': 'toughness', '2:archetype:2': 'cat-fall' },
});
/** What the Free Archetype confirm hands the reducer on "Turn it off": the rule off and every
 *  `2:archetype:*` answer gone — nothing else touched. */
const faOff = (b: BuildState): BuildState => {
  const drop = (m?: Record<string, string>) => m && Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('2:archetype:')));
  return {
    ...b,
    variantRules: {},
    featPicks: drop(b.featPicks)!,
    featChoices: drop(b.featChoices)!,
    pickFeatChoices: drop(b.pickFeatChoices),
  };
};
const slotsAt = (b: BuildState, lvl: number) =>
  levelGrants(lvl, b.classId, c, b.subclassId, b.variantRules, b.classId2, b.subclassId2, b.mythicEnabled, Object.values(b.featPicks)).featSlots;
/** The empty feat SLOTS the engine reports at 2nd level ("Level 2 — mythic feat"). */
const missing = (b: BuildState) => levelChoices(b, c).filter((m) => /^Level 2 — [a-z]+ feat$/.test(m.label)).map((m) => m.label);

describe('(4) a slot list that changes under the picks moves each pick with its slot', () => {
  it('the fixture sits in the real slots (and archetype always comes before mythic)', () => {
    expect(slotsAt(MYTHIC_FA, 2)).toEqual(['class', 'skill', 'archetype', 'mythic']);
    expect(slotsAt(faOff(MYTHIC_FA), 2)).toEqual(['class', 'skill', 'mythic']);
    // No order puts mythic before archetype: levelGrants pushes them in that order at every level.
    for (let l = 2; l <= 20; l += 2) {
      const s = levelGrants(l, 'fighter', c, null, { freeArchetype: true }, null, null, true).featSlots;
      expect(s.indexOf('archetype'), `level ${l}`).toBeLessThan(s.indexOf('mythic'));
    }
    expect(missing(MYTHIC_FA)).toEqual([]);
  });

  it('Free Archetype OFF: the mythic pick and every answer under it move to 2:mythic:2; nothing else changes', () => {
    const next = faOff(MYTHIC_FA);
    const out = rekeyFeatSlots(MYTHIC_FA, next, c);
    expect(out.featPicks['2:mythic:2']).toBe('arms-that-cut-the-waves');
    expect(out.featPicks['2:mythic:3']).toBeUndefined();
    expect(Object.keys(out.featPicks).some((k) => k.includes(':archetype:'))).toBe(false);
    expect(out.featChoices).toEqual({ '2:mythic:2': 'answer', '2:mythic:2#1': 'second', '2:class:0': 'kept' });
    expect(out.featSpellChoices).toEqual({ '2:mythic:2:granted-spell': 'heal' });
    expect(out.featLoreChoices).toEqual({ '2:mythic:2:0': 'Sailing', 'additional-lore:0': 'Warfare' });
    expect(out.effectChoices).toEqual({ '2:mythic:2:form': 'wave', 'sudden-charge:x': 'y' });
    expect(out.pickFeatChoices).toEqual({ '2:mythic:2': 'toughness' });
    // Deep-equal everything else: only the mythic keys differ from what the confirm handed over.
    const unMythic = (m?: Record<string, string>) => m && Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('2:mythic:')));
    const rest = (b: BuildState) => ({
      ...b,
      featPicks: unMythic(b.featPicks), featChoices: unMythic(b.featChoices), featSpellChoices: unMythic(b.featSpellChoices),
      featLoreChoices: unMythic(b.featLoreChoices), effectChoices: unMythic(b.effectChoices), pickFeatChoices: unMythic(b.pickFeatChoices),
    });
    expect(rest(out)).toEqual(rest(next));
    // …and the engine agrees: no empty mythic slot, the feat in its slot, the archetype pick gone.
    expect(missing(out)).toEqual([]);
    const ch = buildCharacter(out, c);
    expect(ch.feats.find((f) => f.featId === 'arms-that-cut-the-waves')?.slotKey).toBe('2:mythic:2');
    expect(ch.feats.some((f) => f.featId === 'rogue-dedication')).toBe(false);
    // Without the move the engine reports the hole the refuter saw.
    expect(missing(next)).toEqual(['Level 2 — mythic feat']);
  });

  it('Free Archetype back ON moves it back (2:mythic:2 → 2:mythic:3) — the reverse shift, no dialog', () => {
    // Started from the rule-off keys themselves, so this leg stands on its own.
    const off = fighter2({ featPicks: { '2:mythic:2': 'arms-that-cut-the-waves' }, featChoices: { '2:mythic:2#1': 'second' } });
    expect(missing(off)).toEqual(['Level 2 — class feat', 'Level 2 — skill feat']);
    const on = rekeyFeatSlots(off, { ...off, variantRules: { freeArchetype: true } }, c);
    expect(on.featPicks['2:mythic:3']).toBe('arms-that-cut-the-waves');
    expect(on.featPicks['2:mythic:2']).toBeUndefined();
    expect(on.featChoices['2:mythic:3#1']).toBe('second');
    // The free slot is new and empty; the mythic slot is not.
    expect(missing(on)).toEqual(['Level 2 — class feat', 'Level 2 — skill feat', 'Level 2 — archetype feat']);
  });

  it('Ancestry Paragon moves the 1st-level class pick and the 3rd-level general pick, and back', () => {
    const b = fighter2({ level: 3, mythicEnabled: false, featPicks: { '1:ancestry:0': 'natural-ambition', '1:class:1': 'sudden-charge', '3:general:0': 'toughness' } });
    const on = rekeyFeatSlots(b, { ...b, variantRules: { ancestryParagon: true } }, c);
    expect(on.featPicks).toEqual({ '1:ancestry:0': 'natural-ambition', '1:class:2': 'sudden-charge', '3:general:1': 'toughness' });
    const off = rekeyFeatSlots(on, { ...on, variantRules: {} }, c);
    expect(off.featPicks).toEqual(b.featPicks);
  });

  it('a Mythic feat already in the slot a moved pick needs is never overwritten — it steps aside', () => {
    // A pick orphaned by the OLD bug (2:mythic:3 after Free Archetype went off) plus a new pick the
    // player then made at 2:mythic:2. Free Archetype on moves the new one to 2:mythic:3: the orphan
    // must not be written over.
    const b = fighter2({ featPicks: { '2:mythic:2': 'arms-that-cut-the-waves', '2:mythic:3': 'orphan-feat' } });
    const on = rekeyFeatSlots(b, { ...b, variantRules: { freeArchetype: true } }, c);
    expect(Object.values(on.featPicks).sort()).toEqual(['arms-that-cut-the-waves', 'orphan-feat']);
    expect(on.featPicks['2:mythic:3']).toBe('arms-that-cut-the-waves');
  });

  it('picking Ultimate Flexibility adds a bonus slot before the free one at 20th — the free pick moves with it', () => {
    const b = fighter2({ level: 20, mythicEnabled: false, variantRules: { freeArchetype: true }, featPicks: { '20:archetype:2': 'rogue-dedication' } });
    expect(slotsAt(b, 20)).toEqual(['class', 'skill', 'archetype']);
    const picked = { ...b, featPicks: { ...b.featPicks, '20:class:0': 'ultimate-flexibility' } };
    const out = rekeyFeatSlots(b, picked, c);
    expect(slotsAt(out, 20)).toEqual(['class', 'skill', 'bonus', 'archetype']);
    expect(out.featPicks).toEqual({ '20:class:0': 'ultimate-flexibility', '20:archetype:3': 'rogue-dedication' });
  });

  it('a change that moves no slot hands the build back untouched', () => {
    const next = { ...MYTHIC_FA, name: 'renamed' };
    expect(rekeyFeatSlots(MYTHIC_FA, next, c)).toBe(next);
  });
});

/*
 * REFUTED: a pick whose slot is switched OFF (Mythic off) kept its key and was never moved again, so
 * any other shift at that level while it was off left it stale for good. Mythic off → Free Archetype
 * off → Mythic on put the pick at 2:mythic:3 beside an empty drawn 2:mythic:2; Free Archetype off at
 * the start, Mythic off → Free Archetype on → Mythic on put it at 2:mythic:2 with the slot at 3.
 */
describe('(4) a pick whose slot is switched off keeps its place, and is back in its slot when the slot returns', () => {
  const ARMS = 'arms-that-cut-the-waves';
  const step = (b: BuildState, over: Partial<BuildState>) => rekeyFeatSlots(b, { ...b, ...over }, c);
  const onSheet = (b: BuildState, id: string) => buildCharacter(b, c).feats.some((f) => f.featId === id);

  it('every level list is in SLOT_ORDER — the order a switched-off slot is placed by', () => {
    const all = { freeArchetype: true, ancestryParagon: true, dualClass: true };
    for (const cls of Object.keys(c.classes)) for (const cls2 of ['fighter', 'kineticist']) for (let l = 1; l <= 20; l++) {
      const s = levelGrants(l, cls, c, null, all, cls2, null, true, ['ultimate-flexibility']).featSlots;
      const r = s.map((x: FeatCategory) => SLOT_ORDER.indexOf(x));
      expect(r.every((x, i) => x >= 0 && (i === 0 || x >= r[i - 1])), `${cls}+${cls2} level ${l}: ${s.join(',')}`).toBe(true);
    }
  });

  it("the refuter's (a): Mythic off, Free Archetype off, Mythic on — every mythic answer is in the drawn slot", () => {
    const off = step(MYTHIC_FA, { mythicEnabled: false });
    expect(onSheet(off, ARMS), 'a switched-off pick stays on the character').toBe(true);
    const faGone = rekeyFeatSlots(off, faOff(off), c);
    expect(onSheet(faGone, ARMS)).toBe(true);
    const b = step(faGone, { mythicEnabled: true });
    expect(slotsAt(b, 2)).toEqual(['class', 'skill', 'mythic']);
    expect(b.featPicks).toEqual({ '1:class:1': 'sudden-charge', '2:class:0': 'intimidating-strike', '2:skill:1': 'cat-fall', '2:mythic:2': ARMS });
    expect(b.featChoices).toEqual({ '2:mythic:2': 'answer', '2:mythic:2#1': 'second', '2:class:0': 'kept' });
    expect(b.featSpellChoices).toEqual({ '2:mythic:2:granted-spell': 'heal' });
    expect(b.featLoreChoices).toEqual({ '2:mythic:2:0': 'Sailing', 'additional-lore:0': 'Warfare' });
    expect(b.effectChoices).toEqual({ '2:mythic:2:form': 'wave', 'sudden-charge:x': 'y' });
    expect(b.pickFeatChoices).toEqual({ '2:mythic:2': 'toughness' });
    expect(missing(b)).toEqual([]);
  });

  it("the refuter's (b): Free Archetype off at the start — Mythic off, Free Archetype on, Mythic on", () => {
    const start = fighter2({ featPicks: { '2:class:0': 'intimidating-strike', '2:skill:1': 'cat-fall', '2:mythic:2': ARMS }, featChoices: { '2:mythic:2#1': 'second' } });
    const off = step(start, { mythicEnabled: false });
    const faOn = step(off, { variantRules: { freeArchetype: true } });
    expect(onSheet(faOn, ARMS)).toBe(true);
    const b = step(faOn, { mythicEnabled: true });
    expect(slotsAt(b, 2)).toEqual(['class', 'skill', 'archetype', 'mythic']);
    expect(b.featPicks).toEqual({ '2:class:0': 'intimidating-strike', '2:skill:1': 'cat-fall', '2:mythic:3': ARMS });
    expect(b.featChoices).toEqual({ '2:mythic:3#1': 'second' });
    expect(missing(b)).toEqual(['Level 2 — archetype feat']);
  });

  it('Dual Class, and picking Ultimate Flexibility, while Mythic is off: the same', () => {
    let d = step(fighter2({ featPicks: { '2:mythic:2': ARMS } }), { mythicEnabled: false });
    d = step(d, { variantRules: { dualClass: true }, classId2: 'wizard' });
    d = step(d, { mythicEnabled: true });
    expect(slotsAt(d, 2)).toEqual(['class', 'class', 'skill', 'mythic']);
    expect(d.featPicks).toEqual({ '2:mythic:3': ARMS });

    let u = step(fighter2({ level: 20, featPicks: { '20:mythic:2': ARMS } }), { mythicEnabled: false });
    u = step(u, { featPicks: { ...u.featPicks, '20:class:0': 'ultimate-flexibility' } });
    u = step(u, { mythicEnabled: true });
    expect(slotsAt(u, 20)).toEqual(['class', 'skill', 'bonus', 'mythic']);
    expect(u.featPicks).toEqual({ '20:class:0': 'ultimate-flexibility', '20:mythic:3': ARMS });
  });

  it('a second-class pick with Dual Class off rides Ancestry Paragon at 1st, and is back in its slot', () => {
    let b = fighter2({ level: 1, mythicEnabled: false, variantRules: { dualClass: true }, classId2: 'rogue', featPicks: { '1:class:1': 'sudden-charge', '1:class:2': 'nimble-dodge' } });
    expect(slotsAt(b, 1)).toEqual(['ancestry', 'class', 'class']);
    b = step(b, { variantRules: {} });
    b = step(b, { variantRules: { ancestryParagon: true } });
    b = step(b, { variantRules: { ancestryParagon: true, dualClass: true } });
    expect(slotsAt(b, 1)).toEqual(['ancestry', 'ancestry', 'class', 'class']);
    expect(b.featPicks).toEqual({ '1:class:2': 'sudden-charge', '1:class:3': 'nimble-dodge' });
  });
});

/*
 * v0.1.40 had no re-keying. Turning Free Archetype, Paragon or Dual Class off left every pick after the
 * removed slot one index too far (on the sheet, not in the Builder, its slot drawn empty). The keys
 * below are what v0.1.40 left, as the refuter measured them. Owner's delegate, 2026-09-24: a change
 * never moves such a pick into another slot — it keeps meaning "the nth slot of its kind" — and the
 * Builder lists it at its level as a feat with no slot, with Remove and Move to slot (the rendered
 * tests are in bug-wave2-builder-ui.test.tsx). When a change draws THAT slot again, the pick is in it
 * (the next describe) — this one holds the cases where the slot it means is not drawn.
 */
describe('(4) a pick v0.1.40 stranded is never moved into ANOTHER slot by a change', () => {
  const ARMS = 'arms-that-cut-the-waves';
  const step = (b: BuildState, over: Partial<BuildState>) => rekeyFeatSlots(b, { ...b, ...over }, c);
  const onSheet = (b: BuildState, id: string) => buildCharacter(b, c).feats.some((f) => f.featId === id);
  const holes = (b: BuildState) => levelChoices(b, c).map((m) => m.label).filter((l) => /^Level \d+ — [a-z]+ feat$/.test(l));
  /** Free Archetype off under v0.1.40: [class, skill, archetype, mythic] → [class, skill, mythic]. */
  const FA_ORPHAN = fighter2({
    featPicks: { '2:class:0': 'intimidating-strike', '2:mythic:3': ARMS },
    featChoices: { '2:mythic:3': 'answer', '2:mythic:3#1': 'second' },
    featSpellChoices: { '2:mythic:3:granted-spell': 'heal' },
  });

  it('the stranded state: on the sheet, its drawn slot empty', () => {
    expect(slotsAt(FA_ORPHAN, 2)).toEqual(['class', 'skill', 'mythic']);
    expect(onSheet(FA_ORPHAN, ARMS)).toBe(true);
    expect(holes(FA_ORPHAN)).toContain('Level 2 — mythic feat');
  });

  it('(a) Free Archetype on and off again: it keeps its answers past the mythic slot, which stays empty', () => {
    const on = step(FA_ORPHAN, { variantRules: { freeArchetype: true } });
    expect(slotsAt(on, 2)).toEqual(['class', 'skill', 'archetype', 'mythic']);
    expect(on.featPicks).toEqual({ '2:class:0': 'intimidating-strike', '2:mythic:4': ARMS });
    expect(on.featChoices).toEqual({ '2:mythic:4': 'answer', '2:mythic:4#1': 'second' });
    expect(on.featSpellChoices).toEqual({ '2:mythic:4:granted-spell': 'heal' });
    expect(holes(on)).toContain('Level 2 — mythic feat');
    expect(onSheet(on, ARMS)).toBe(true);
    const off = step(on, { variantRules: {} });
    expect(off.featPicks).toEqual(FA_ORPHAN.featPicks);
    expect(off.featChoices).toEqual(FA_ORPHAN.featChoices);
    expect(off.featSpellChoices).toEqual(FA_ORPHAN.featSpellChoices);
  });

  it('(b) Paragon on, (c) Dual Class on: the stranded key moves with its block and stays past its slots', () => {
    const b = fighter2({ level: 3, mythicEnabled: false, featPicks: { '1:ancestry:0': 'natural-ambition', '1:class:2': 'sudden-charge', '3:general:1': 'toughness' } });
    expect(holes(b)).toEqual(expect.arrayContaining(['Level 1 — class feat', 'Level 3 — general feat']));
    const on = step(b, { variantRules: { ancestryParagon: true } });
    expect([slotsAt(on, 1), slotsAt(on, 3)]).toEqual([['ancestry', 'ancestry', 'class'], ['ancestry', 'general']]);
    expect(on.featPicks).toEqual({ '1:ancestry:0': 'natural-ambition', '1:class:3': 'sudden-charge', '3:general:2': 'toughness' });
    expect(holes(on)).toEqual(expect.arrayContaining(['Level 1 — class feat', 'Level 3 — general feat']));
    expect(step(on, { variantRules: {} }).featPicks).toEqual(b.featPicks);

    const d = fighter2({ mythicEnabled: false, featPicks: { '2:class:0': 'intimidating-strike', '2:skill:2': 'cat-fall' } });
    const dOn = step(d, { variantRules: { dualClass: true }, classId2: 'wizard' });
    expect(slotsAt(dOn, 2)).toEqual(['class', 'class', 'skill']);
    expect(dOn.featPicks).toEqual({ '2:class:0': 'intimidating-strike', '2:skill:3': 'cat-fall' });
  });

  it('a key v0.1.40 left BEFORE its block (Paragon turned on) keeps its key', () => {
    // Paragon on under v0.1.40: [ancestry, class] → [ancestry, ancestry, class], the class pick left at 1:class:1.
    const b = fighter2({ variantRules: { ancestryParagon: true }, featPicks: { '1:class:1': 'sudden-charge' } });
    expect(holes(b)).toContain('Level 1 — class feat');
    expect(step(b, { mythicEnabled: false }).featPicks).toEqual({ '1:class:1': 'sudden-charge' });
  });

  it("the refuter's case: the player filled the slot it left empty — the player's pick keeps it through every toggle", () => {
    const start = fighter2({
      featPicks: { '2:class:0': 'intimidating-strike', '2:archetype:2': 'rogue-dedication', '2:mythic:2': 'binds-that-tie', '2:mythic:3': ARMS },
    });
    const drawnAt = (b: BuildState, id: string) => {
      const k = Object.keys(b.featPicks).find((x) => b.featPicks[x] === id)!;
      const [lvl, cat, idx] = k.split(':');
      return slotsAt(b, Number(lvl))[Number(idx)] === cat;
    };
    let b = start;
    for (const over of [
      { variantRules: { freeArchetype: true } },
      { variantRules: {} },
      { variantRules: { dualClass: true }, classId2: 'wizard' },
      { variantRules: { dualClass: true, ancestryParagon: true } },
      { variantRules: { freeArchetype: true } },
      { variantRules: {} },
    ] as Partial<BuildState>[]) {
      b = step(b, over);
      const at = JSON.stringify(over);
      expect(Object.values(b.featPicks).sort(), at).toEqual(Object.values(start.featPicks).sort());
      expect(drawnAt(b, 'binds-that-tie'), at).toBe(true);
      expect(drawnAt(b, ARMS), at).toBe(false);
    }
    expect(b.featPicks).toEqual(start.featPicks);
  });

  it('a stranded key that meets a moved pick steps PAST the drawn slots, never into an empty one', () => {
    // Paragon + Dual Class (rogue) at 1st: [ancestry, ancestry, class, class]; v0.1.40 left a class pick at 1:class:1.
    const b = fighter2({
      level: 1,
      mythicEnabled: false,
      variantRules: { ancestryParagon: true, dualClass: true },
      classId2: 'rogue',
      featPicks: { '1:class:1': 'nimble-dodge', '1:class:2': 'sudden-charge' },
      featLoreChoices: { '1:class:1:0': 'Mine' },
    });
    expect(slotsAt(b, 1)).toEqual(['ancestry', 'ancestry', 'class', 'class']);
    const off = step(b, { variantRules: { dualClass: true } });
    expect(slotsAt(off, 1)).toEqual(['ancestry', 'class', 'class']);
    // Sudden Charge follows its slot to 1:class:1; the stranded pick it met goes past the empty
    // 1:class:2, not into it.
    expect(off.featPicks).toEqual({ '1:class:1': 'sudden-charge', '1:class:3': 'nimble-dodge' });
    expect(off.featLoreChoices).toEqual({ '1:class:3:0': 'Mine' });
    // A cleared second slot's left-over answer stays with that empty slot; the pick still goes past it.
    const left = step({ ...b, featLoreChoices: { ...b.featLoreChoices, '1:class:3:0': 'Left' } }, { variantRules: { dualClass: true } });
    expect(left.featPicks).toEqual(off.featPicks);
    expect(left.featLoreChoices).toEqual({ '1:class:3:0': 'Mine', '1:class:2:0': 'Left' });
  });
});

/*
 * REFUTED: the report told the owner a feat with no slot "no longer comes back into a slot on its own
 * when a toggle is turned on". It does, by design: its key means "the nth slot of its kind", so a
 * change that draws that slot again puts it there with no dialog — the refuter measured it in 2,634 of
 * 12,852 toggle steps, each into the slot of the same kind and position it held before. That is how
 * "toggle on, toggle off" clears a v0.1.40 leftover: on puts it back in its slot, off names it.
 * What was missing is the slot's own test: a slot drawn again at that position may refuse the feat
 * (a second class changed in between), and the feat went in anyway, looking like a legitimate pick.
 */
describe('(4) a pick with no slot is back in ITS slot when a change draws it again, only where that slot takes it', () => {
  const ARMS = 'arms-that-cut-the-waves';
  const step = (b: BuildState, over: Partial<BuildState>) => rekeyFeatSlots(b, { ...b, ...over }, c);
  const inDrawnSlot = (b: BuildState, key: string) => {
    const [lvl, cat, idx] = key.split(':');
    return slotsAt(b, Number(lvl))[Number(idx)] === cat;
  };

  it('a Free Archetype dedication v0.1.40 left behind: back in the free slot on Free Archetype on, then named by off', () => {
    const left = fighter2({ mythicEnabled: false, featPicks: { '2:class:0': 'intimidating-strike', '2:archetype:2': 'rogue-dedication' }, featChoices: { '2:archetype:2': 'mine' } });
    expect(inDrawnSlot(left, '2:archetype:2')).toBe(false);
    const on = step(left, { variantRules: { freeArchetype: true } });
    expect(on.featPicks).toEqual(left.featPicks);
    expect(on.featChoices).toEqual(left.featChoices);
    expect(inDrawnSlot(on, '2:archetype:2')).toBe(true);
    expect(picksLosingSlot(on, { ...on, variantRules: {} }, c)).toEqual([['2:archetype:2', 'rogue-dedication']]);
  });

  it('a mythic feat v0.1.40 left behind on Mythic off: back in its slot on Mythic on', () => {
    const left = fighter2({ mythicEnabled: false, variantRules: { freeArchetype: true }, featPicks: { '2:mythic:3': ARMS } });
    const on = step(left, { mythicEnabled: true });
    expect(on.featPicks).toEqual({ '2:mythic:3': ARMS });
    expect(inDrawnSlot(on, '2:mythic:3')).toBe(true);
  });

  it('a key v0.1.40 left in front of its block (Paragon on): in the slot when Paragon goes off', () => {
    const left = fighter2({ level: 1, mythicEnabled: false, variantRules: { ancestryParagon: true }, featPicks: { '1:class:1': 'sudden-charge' } });
    expect(inDrawnSlot(left, '1:class:1')).toBe(false);
    const off = step(left, { variantRules: {} });
    expect(off.featPicks).toEqual({ '1:class:1': 'sudden-charge' });
    expect(inDrawnSlot(off, '1:class:1')).toBe(true);
    // The same key holding a feat that slot refuses (a rogue feat, the second class now a wizard): it steps past.
    const rogueFeat = fighter2({ level: 1, mythicEnabled: false, variantRules: { ancestryParagon: true, dualClass: true }, classId2: 'wizard', featPicks: { '1:class:1': 'nimble-dodge' } });
    expect(slotsAt(rogueFeat, 1)).toEqual(['ancestry', 'ancestry', 'class']);
    const refused = step(rogueFeat, { variantRules: { dualClass: true } });
    expect(refused.featPicks).toEqual({ '1:class:2': 'nimble-dodge' });
    expect(inDrawnSlot(refused, '1:class:2')).toBe(false);
  });

  it('a slot drawn again that would REFUSE it: the pick steps past the drawn slots and stays a feat with no slot', () => {
    // Dual Class rogue, Nimble Dodge in the second-class slot. A wizard has no 1st-level class feat, so
    // it loses its slot; a ranger has one at that position, and a ranger's slot does not take a rogue feat.
    let b = fighter2({ level: 1, mythicEnabled: false, variantRules: { dualClass: true }, classId2: 'rogue', featPicks: { '1:class:2': 'nimble-dodge' }, featLoreChoices: { '1:class:2:0': 'Mine' } });
    b = step(b, { classId2: 'wizard' });
    expect(slotsAt(b, 1)).toEqual(['ancestry', 'class']);
    expect(inDrawnSlot(b, Object.keys(b.featPicks)[0])).toBe(false);
    b = step(b, { classId2: 'ranger' });
    expect(slotsAt(b, 1)).toEqual(['ancestry', 'class', 'class']);
    expect(fitsSlot({ ...b, featPicks: { '1:class:2': 'nimble-dodge' } }, c, '1:class:2', '1:class:2')).toBe(false);
    expect(b.featPicks).toEqual({ '1:class:3': 'nimble-dodge' });
    expect(b.featLoreChoices).toEqual({ '1:class:3:0': 'Mine' });
    expect(moveTargetFor(b, c, '1:class:3'), 'no slot here takes it').toBeNull();
    expect(buildCharacter(b, c).feats.some((f) => f.featId === 'nimble-dodge'), 'still on the character').toBe(true);
    // A rogue again: it does not mean that position any more, so it stays listed — and Move to slot offers a slot that takes it.
    b = step(b, { classId2: 'rogue' });
    expect(b.featPicks).toEqual({ '1:class:3': 'nimble-dodge' });
    expect(moveTargetFor(b, c, '1:class:3')).toBe('1:class:1');
  });

  it('the same round trip with a feat the slot takes: it lands, answers and all', () => {
    let b = fighter2({ mythicEnabled: false, variantRules: { dualClass: true }, classId2: 'wizard', featPicks: { '2:class:1': 'reach-spell' }, featLoreChoices: { '2:class:1:0': 'Mine' } });
    b = step(b, { classId2: null });
    expect(inDrawnSlot(b, '2:class:1')).toBe(false);
    b = step(b, { classId2: 'wizard' });
    expect(b.featPicks).toEqual({ '2:class:1': 'reach-spell' });
    expect(b.featLoreChoices).toEqual({ '2:class:1:0': 'Mine' });
    expect(inDrawnSlot(b, '2:class:1')).toBe(true);
  });
});

/*
 * REFUTED: Move to slot matched only the KIND of slot. A rogue feat left by a second class changed to
 * wizard went into the fighter's own class slot, which its picker lists as "not valid for this slot" —
 * and once moved it looked like a normal pick. Reach Spell after "Clear — no second class" went into
 * the fighter-only 2:class:0 the same way.
 */
describe('(B) Move to slot offers only a slot whose own picker takes the feat', () => {
  it("the refuter's two cases get no target; a slot that takes the feat does", () => {
    const rogue = fighter2({ level: 1, mythicEnabled: false, variantRules: { dualClass: true }, classId2: 'rogue', featPicks: { '1:class:2': 'nimble-dodge' } });
    const wiz = rekeyFeatSlots(rogue, { ...rogue, classId2: 'wizard' }, c);
    const [k] = Object.keys(wiz.featPicks);
    expect(wiz.featPicks['1:class:1'], 'the fighter slot is empty').toBeUndefined();
    expect(fitsSlot(wiz, c, k, '1:class:1')).toBe(false);
    expect(moveTargetFor(wiz, c, k)).toBeNull();

    const reach = fighter2({ mythicEnabled: false, variantRules: { dualClass: true }, classId2: 'wizard', featPicks: { '2:class:1': 'reach-spell' } });
    const cleared = rekeyFeatSlots(reach, { ...reach, classId2: null }, c);
    expect(slotsAt(cleared, 2)).toEqual(['class', 'skill']);
    expect(moveTargetFor(cleared, c, Object.keys(cleared.featPicks)[0])).toBeNull();

    // The same feat, the same empty slot, a second class whose feats that slot takes: offered.
    expect(moveTargetFor({ ...wiz, classId2: 'rogue' }, c, k)).toBe('1:class:1');
    // A slot another pick holds is never a target.
    expect(moveTargetFor({ ...wiz, classId2: 'rogue', featPicks: { ...wiz.featPicks, '1:class:1': 'sudden-charge' } }, c, k)).toBeNull();
  });
});

/*
 * REFUTED: the confirm said it named every feat that loses its slot, but read the new slot lists off
 * a build that still held the feats about to go. Ultimate Flexibility in the second-class slot carries
 * a bonus slot at 20th, so Dual Class off took that bonus slot too — and its feat went unnamed, kept
 * on the character with no slot.
 */
describe('(A) a feat that carries a slot takes it along, and the feat in that slot is named too', () => {
  const UF20 = (picks: Record<string, string>) =>
    fighter2({ level: 20, mythicEnabled: false, variantRules: { dualClass: true }, classId2: 'wizard', featPicks: { '2:class:0': 'intimidating-strike', ...picks } });

  it("the refuter's case: Ultimate Flexibility in the second-class slot, Sudden Charge in its bonus slot", () => {
    const b = UF20({ '20:class:1': 'ultimate-flexibility', '20:bonus:3': 'sudden-charge' });
    expect(slotsAt(b, 20)).toEqual(['class', 'class', 'skill', 'bonus']);
    const next = { ...b, variantRules: {} };
    const lost = picksLosingSlot(b, next, c);
    expect(lost).toEqual([['20:class:1', 'ultimate-flexibility'], ['20:bonus:3', 'sudden-charge']]);
    // What "Turn it off" hands the reducer: the named picks gone. Every pick left is in a drawn slot.
    const out = rekeyFeatSlots(b, { ...next, featPicks: { '2:class:0': 'intimidating-strike' } }, c);
    expect(out.featPicks).toEqual({ '2:class:0': 'intimidating-strike' });
    expect(slotsAt(out, 20)).toEqual(['class', 'skill']);
  });

  it("Ultimate Flexibility in the fighter's OWN slot keeps its bonus slot: only the second-class feat is named", () => {
    const b = UF20({ '20:class:0': 'ultimate-flexibility', '20:class:1': 'reach-spell', '20:bonus:3': 'sudden-charge' });
    expect(picksLosingSlot(b, { ...b, variantRules: {} }, c)).toEqual([['20:class:1', 'reach-spell']]);
  });
});

/*
 * REFUTED: the confirm named picks by their POSITION among the class slots. With Dual Class on, both
 * class slots at a level take both classes' feats, so a rogue feat can sit in the fighter's FIRST slot.
 * Dual Class off named the fighter feat in the second slot and left Mobility in 2:class:0 — a slot that
 * no longer takes it — looking like a normal pick. With two rogue feats only the second was named.
 */
describe('(A) Dual Class off names a second-class feat in the FIRST class slot too', () => {
  const dual = (picks: Record<string, string>, classId2 = 'rogue') =>
    fighter2({ mythicEnabled: false, variantRules: { dualClass: true }, classId2, featPicks: picks });
  /** What "Turn it off" leaves: the named picks gone, the rule off, re-keyed by the reducer. */
  const turnOff = (b: BuildState) => {
    const lost = picksLosingSlot(b, { ...b, variantRules: {} }, c);
    const featPicks = Object.fromEntries(Object.entries(b.featPicks).filter(([k]) => !lost.some(([x]) => x === k)));
    return { lost, out: rekeyFeatSlots(b, { ...b, variantRules: {}, featPicks }, c) };
  };
  /** Every pick is in a drawn slot whose own picker takes it. */
  const allFit = (b: BuildState) =>
    Object.keys(b.featPicks).every((k) => {
      const [lvl, cat, idx] = k.split(':');
      return slotsAt(b, Number(lvl))[Number(idx)] === cat && fitsSlot(b, c, k, k);
    });

  it("the refuter's case: Mobility (rogue) in 2:class:0 and Intimidating Strike (fighter) in 2:class:1 — both named", () => {
    const b = dual({ '2:class:0': 'mobility', '2:class:1': 'intimidating-strike' });
    expect(allFit(b)).toBe(true);
    expect(fitsSlot({ ...b, variantRules: {} }, c, '2:class:0', '2:class:0'), 'the fighter slot refuses Mobility once Dual Class is off').toBe(false);
    const { lost, out } = turnOff(b);
    // Mobility: its slot stays and refuses it. Intimidating Strike: its slot, the second one, goes.
    expect(lost).toEqual([['2:class:0', 'mobility'], ['2:class:1', 'intimidating-strike']]);
    expect(out.featPicks).toEqual({});
  });

  it('two rogue feats: both named, and nothing is left in a slot that refuses it', () => {
    const { lost, out } = turnOff(dual({ '2:class:0': 'mobility', '2:class:1': 'trap-finder' }));
    expect(lost).toEqual([['2:class:0', 'mobility'], ['2:class:1', 'trap-finder']]);
    expect(out.featPicks).toEqual({});
  });

  it('a fighter feat or an archetype feat in the first slot keeps it; only the rogue feat is named', () => {
    for (const first of ['intimidating-strike', 'rogue-dedication']) {
      const { lost, out } = turnOff(dual({ '2:class:0': first, '2:class:1': 'mobility' }));
      expect(lost, first).toEqual([['2:class:1', 'mobility']]);
      expect(out.featPicks, first).toEqual({ '2:class:0': first });
      expect(allFit(out), first).toBe(true);
    }
  });

  it("a feat its slot refused BEFORE the change is not this toggle's to name (it is flagged in its slot)", () => {
    // Mobility in the fighter's slot with the second class already a wizard: refused before and after.
    const b = dual({ '2:class:0': 'mobility', '2:class:1': 'intimidating-strike' }, 'wizard');
    expect(fitsSlot(b, c, '2:class:0', '2:class:0')).toBe(false);
    expect(picksLosingSlot(b, { ...b, variantRules: {} }, c)).toEqual([['2:class:1', 'intimidating-strike']]);
  });

  it('the ALL_ON-style level 1: both class slots hold rogue feats, both named; a fighter feat first keeps it', () => {
    const one = (picks: Record<string, string>) => fighter2({ level: 1, mythicEnabled: false, variantRules: { dualClass: true }, classId2: 'rogue', featPicks: picks });
    expect(turnOff(one({ '1:class:1': 'nimble-dodge', '1:class:2': 'trap-finder' })).lost).toEqual([['1:class:1', 'nimble-dodge'], ['1:class:2', 'trap-finder']]);
    expect(turnOff(one({ '1:class:1': 'sudden-charge', '1:class:2': 'trap-finder' })).lost).toEqual([['1:class:2', 'trap-finder']]);
  });
});

/*
 * REFUTED: a pick in a DRAWN slot was never checked again. Move to slot put Nimble Dodge in the
 * fighter's slot (it took it, Dual Class rogue); the second class then changed to wizard and it stayed
 * there as a normal pick. Nothing is written for it — the Builder flags it in its slot from the live
 * build (bug-wave2-builder-ui.test.tsx) — and this pins what that flag reads.
 */
describe('(B) a pick whose slot stops taking it stays in its slot, and fitsSlot says so', () => {
  it('rogue → wizard: Nimble Dodge in 1:class:1 and Mobility in 2:class:0 stay put; the slot refuses both', () => {
    const b = fighter2({ mythicEnabled: false, variantRules: { dualClass: true }, classId2: 'rogue', featPicks: { '1:class:1': 'nimble-dodge', '1:class:2': 'trap-finder', '2:class:0': 'mobility' } });
    for (const k of Object.keys(b.featPicks)) expect(fitsSlot(b, c, k, k), k).toBe(true);
    const wiz = rekeyFeatSlots(b, { ...b, classId2: 'wizard' }, c);
    expect(wiz.featPicks).toEqual(b.featPicks);
    expect(fitsSlot(wiz, c, '1:class:1', '1:class:1')).toBe(false);
    expect(fitsSlot(wiz, c, '2:class:0', '2:class:0')).toBe(false);
    // Trap Finder's slot went with the rogue: it has no slot (the level page lists it), whatever fitsSlot says.
    expect(slotsAt(wiz, 1)).toEqual(['ancestry', 'class']);
    // Rogue → ranger moves no slot at all, and the rogue feats are refused just the same.
    const ranger = rekeyFeatSlots(b, { ...b, classId2: 'ranger' }, c);
    expect(ranger.featPicks).toEqual(b.featPicks);
    expect(['1:class:1', '1:class:2', '2:class:0'].map((k) => fitsSlot(ranger, c, k, k))).toEqual([false, false, false]);
  });

  it('an aon- duplicate id already picked still counts as taken by its slot', () => {
    const dup = [...(c.duplicateIds ?? [])].map((id) => c.feats[id]).find((f) => f && f.category === 'general' && f.level <= 3 && !f.prerequisites?.length);
    expect(dup, 'no aon- duplicate of a general feat in the content').toBeTruthy();
    const b = fighter2({ level: 3, mythicEnabled: false, featPicks: { '3:general:0': dup!.id } });
    expect(fitsSlot(b, c, '3:general:0', '3:general:0'), dup!.id).toBe(true);
  });
});

/*
 * REFUTED: a dual gate's impulse slot took the element at its index in the WHOLE 1st-level list, modulo
 * two. Ancestry Paragon's second ancestry slot, or Dual Class's second class slot, in front of the pair
 * swapped the elements: with Paragon on, correctly placed impulses were flagged "Not valid for this
 * slot", and Paragon off named and removed both though both impulse slots stay.
 */
describe('(A) a dual-gate kineticist: the nth impulse slot takes the nth element, whatever sits in front of it', () => {
  const AIR = 'aerial-boomerang';
  const FIRE = 'burning-jet';
  const kin = (over: Partial<BuildState> = {}): BuildState => ({
    ...emptyBuild(),
    name: 't',
    level: 1,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    classId: 'kineticist',
    keyAbility: 'con',
    extraChoices: { element: ['air-gate', 'fire-gate'] },
    featChoices: { 'feature:kinetic-gate': 'dual' },
    ...over,
  });
  const impulseSlots = (b: BuildState) => slotsAt(b, 1).flatMap((cat, i) => (cat === 'impulse' ? [i] : []));
  /** Per impulse slot at 1st, in order: the element(s) every feat its picker offers carries. */
  const slotElements = (b: BuildState) =>
    impulseSlots(b).map((idx) => {
      const offers = eligibleFeatsForSlot(b, c, { level: 1, category: 'impulse', idx });
      return KINETIC_ELEMENTS.filter((e) => offers.length > 0 && offers.every((f) => f.traits.includes(e))).join('+');
    });
  const ARRANGEMENTS: [string, Partial<BuildState>, number[]][] = [
    ['no toggle', {}, [2, 3]],
    ['Ancestry Paragon', { variantRules: { ancestryParagon: true } }, [3, 4]],
    ['Dual Class (fighter)', { variantRules: { dualClass: true }, classId2: 'fighter' }, [3, 4]],
    ['Paragon + Dual Class', { variantRules: { ancestryParagon: true, dualClass: true }, classId2: 'fighter' }, [4, 5]],
  ];

  it('the first impulse slot takes air and the second fire, at every position the pair can sit', () => {
    for (const [label, over, at] of ARRANGEMENTS) {
      expect(impulseSlots(kin(over)), label).toEqual(at);
      expect(slotElements(kin(over)), label).toEqual(['air', 'fire']);
      const [a, f] = at.map((i) => `1:impulse:${i}`);
      const placed = kin({ ...over, featPicks: { [a]: AIR, [f]: FIRE } });
      expect([fitsSlot(placed, c, a, a), fitsSlot(placed, c, f, f)], label).toEqual([true, true]);
      const swapped = kin({ ...over, featPicks: { [a]: FIRE, [f]: AIR } });
      expect([fitsSlot(swapped, c, a, a), fitsSlot(swapped, c, f, f)], label).toEqual([false, false]);
    }
  });

  it('Paragon on moves both impulses with their slots and both still fit; Paragon off names ONLY the paragon feat', () => {
    const b = kin({ featPicks: { '1:ancestry:0': 'cooperative-nature', '1:impulse:2': AIR, '1:impulse:3': FIRE } });
    const on = rekeyFeatSlots(b, { ...b, variantRules: { ancestryParagon: true } }, c);
    expect(on.featPicks).toEqual({ '1:ancestry:0': 'cooperative-nature', '1:impulse:3': AIR, '1:impulse:4': FIRE });
    for (const k of ['1:impulse:3', '1:impulse:4']) expect(fitsSlot(on, c, k, k), k).toBe(true);

    const full = { ...on, featPicks: { ...on.featPicks, '1:ancestry:1': 'haughty-obstinacy' } };
    const lost = picksLosingSlot(full, { ...full, variantRules: {} }, c);
    expect(lost).toEqual([['1:ancestry:1', 'haughty-obstinacy']]);
    // "Turn it off": the named one gone, the impulses back in their own slots, each taken there.
    const featPicks = Object.fromEntries(Object.entries(full.featPicks).filter(([k]) => !lost.some(([x]) => x === k)));
    const off = rekeyFeatSlots(full, { ...full, variantRules: {}, featPicks }, c);
    expect(off.featPicks).toEqual(b.featPicks);
    for (const k of ['1:impulse:2', '1:impulse:3']) expect(fitsSlot(off, c, k, k), k).toBe(true);
  });

  it('Dual Class on and off: the same — only the second class feat is named', () => {
    const b = kin({ classId2: 'fighter', featPicks: { '1:impulse:2': AIR, '1:impulse:3': FIRE } });
    const on = rekeyFeatSlots(b, { ...b, variantRules: { dualClass: true } }, c);
    expect(on.featPicks).toEqual({ '1:impulse:3': AIR, '1:impulse:4': FIRE });
    for (const k of ['1:impulse:3', '1:impulse:4']) expect(fitsSlot(on, c, k, k), k).toBe(true);

    const full = { ...on, featPicks: { ...on.featPicks, '1:class:2': 'sudden-charge' } };
    const lost = picksLosingSlot(full, { ...full, variantRules: {} }, c);
    expect(lost).toEqual([['1:class:2', 'sudden-charge']]);
    const featPicks = Object.fromEntries(Object.entries(full.featPicks).filter(([k]) => !lost.some(([x]) => x === k)));
    expect(rekeyFeatSlots(full, { ...full, variantRules: {}, featPicks }, c).featPicks).toEqual(b.featPicks);
  });

  it('an element forked in later never joins the gate’s binding; a single gate’s two slots both take its element', () => {
    const forked = kin({ level: 5, gateForks: { '5': 'water-gate' }, featPicks: { '1:impulse:2': AIR, '1:impulse:3': FIRE } });
    expect(slotElements(forked)).toEqual(['air', 'fire']);
    for (const k of ['1:impulse:2', '1:impulse:3']) expect(fitsSlot(forked, c, k, k), k).toBe(true);
    const single = kin({ extraChoices: { element: ['fire-gate'] }, featChoices: { 'feature:kinetic-gate': 'single' } });
    expect(slotElements(single)).toEqual(['fire', 'fire']);
    expect(slotElements({ ...single, level: 5, gateForks: { '5': 'water-gate' } })).toEqual(['fire', 'fire']);
    expect(slotElements({ ...single, variantRules: { ancestryParagon: true } })).toEqual(['fire', 'fire']);
  });
});

describe('(5) the Lore rule only ever yields — toggling it trains or untrains its own Lores and nothing else', () => {
  const ON = { loreInsteadOfLanguage: true } as const;
  const skillsOf = (b: BuildState) => buildCharacter(b, c).proficiencies.skills;

  it('a class skill pick of the same Lore keeps it, and the rule off changes no class skill', () => {
    // Six picks = the fighter's 3 + Int 3. Before the fix the language Lore locked Warfare first, the
    // class pick was hidden and freed, and turning the rule off brought it back past the cap.
    const on = dwarf({
      variantRules: ON,
      languageLores: ['lore:warfare'],
      classSkills: ['athletics', 'lore:warfare', 'crafting', 'diplomacy', 'intimidation', 'society'],
    });
    const ch = buildCharacter(on, c);
    expect(ch.grantedSkills?.['lore:warfare']).toBeUndefined(); // the class pick holds it, unlocked
    expect(activeLanguageLores(ch)).toEqual([]); // the language Lore spends nothing…
    expect(bonusLanguageSlots(on, c)).toBe(3); // …so its Int slot stays a language
    expect(skillsOf(on).society).toBe('trained');
    expect(skillsOf({ ...on, variantRules: {} })).toEqual(skillsOf(on));
  });

  it("the refuter's stored state: flipping the rule leaves every skill where it was", () => {
    const on = dwarf({
      variantRules: ON,
      languageLores: ['lore:warfare'],
      classSkills: ['athletics', 'lore:warfare', 'crafting', 'diplomacy', 'intimidation', 'medicine', 'society'],
    });
    expect(skillsOf({ ...on, variantRules: {} })).toEqual(skillsOf(on));
  });

  it('a Lore a class choice grants (an animist apparition) spends no slot', () => {
    // Before the fix the language Lore locked Architecture Lore ahead of the apparition, so the
    // apparition's own Lore took an Int slot away and bought nothing.
    const b = dwarf({
      classId: 'animist',
      subclassId: c.classes.animist.subclass?.options[0]?.id ?? null,
      keyAbility: 'wis',
      extraChoices: { apparition: ['crafter-in-the-vault', 'custodian-of-groves-and-gardens'] },
      variantRules: ON,
      languageLores: ['lore:architecture'],
    });
    const ch = buildCharacter(b, c);
    expect(ch.proficiencies.skills['lore:architecture']).toBe('trained');
    expect(ch.grantedSkills?.['lore:architecture']).toBe('a class choice');
    expect(activeLanguageLores(ch)).toEqual([]);
    expect(bonusLanguageSlots(b, c)).toBe(intLanguageSlots(b, c));
  });
});
