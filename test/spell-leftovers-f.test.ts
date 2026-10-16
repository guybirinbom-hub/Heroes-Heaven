import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { archetypeCantripCounts, buildCharacter, emptyBuild, levelChoices, type BuildState } from '../src/rules/build';
import { activeCasterArchetype } from '../src/rules/casterArchetypes';
import { overGiftNote } from '../src/rules/spellcasting';
import { rekeyFeatSlots, swapSlotKeys } from '../src/rules/featSlots';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * PACKAGE F, "Spell leftovers" (2026-10-16) — the engine half. test/spell-leftovers-f-ui.test.tsx holds what
 * the player sees. Every leg below was measured red on the code before the fix (a HEAD worktree run, see the
 * commit message) and green after.
 *
 *  1. Cantrip Expansion taken through an ARCHETYPE (Basic Arcana, feat-5108: *"You gain a 1st- or 2nd-level
 *     wizard feat of your choice"*). Print, feat-4580: *"Prepared Caster (Cleric, Wizard, etc.): You can
 *     prepare two additional cantrips each day."* Taken as the wizard feat of a wizard ARCHETYPE, the two
 *     cantrips are that archetype's. Measured before: they went NOWHERE — a druid or cleric with Wizard
 *     Dedication kept 5 class cantrips and 2 archetype ones, a fighter kept 2 — because both pools read only
 *     `featPicks`, never the pick-a-feat answer. The class pool must still not get them.
 *  2. An Adapted Cantrip answer from NO magical tradition (a stored allegro) counts as a choice left, so the
 *     level button shows its "!" and Create/Save names it (Q27). 4cca755 said so only under the control.
 *  4. A lesson taken away in Overrides ("Remove a granted feat") teaches nothing: no hex, no familiar spell.
 *  5. Two Major Lessons through two Advanced Witchcraft feats each have their own answer.
 *  7. A notice that is not missing data (Oatia Skysage's named cantrips) is marked `kind: 'check'`, so the Feats
 *     tab does not file it under "Missing data"; a real missing-data warning carries no kind.
 * 10. Owner ruling #162: Spellshot + Beast Gunner keeps one pool, the spellshot's two cantrips are cast at
 *     will as innate cantrips, and the sheet SAYS so (the beast gunner entry's note); the builder asks them.
 *  +  The sorcerer's "one too many" note (a K leftover filed with F): it said "your bloodline's cantrip is one
 *     of your 4" beside more than four cards; it now speaks of the class's places.
 *
 * Synthetic characters only ("TEST …").
 */
const db = content();
const gated = content({ trustGate: true });

const pc = (over: Partial<BuildState>): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST spell leftovers',
    level: 6,
    keyAbility: 'wis',
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    subclassId: null,
    ...over,
  }) as BuildState;
const sub = (cls: string, d: ContentDatabase = db) => d.classes[cls]?.subclass?.options[0]?.id ?? null;
const entry = (c: Character, id: string) => c.spellcasting.find((e) => e.id === id);
const focusOf = (c: Character) => c.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat());

// ── 1 ────────────────────────────────────────────────────────────────────────────────────────────────
const WIZ_DED = { '2:class:0': 'wizard-dedication', '4:class:1': 'basic-arcana' };
const arcanaCE = (classId: string, over: Partial<BuildState> = {}, d: ContentDatabase = db) =>
  pc({
    classId,
    subclassId: sub(classId, d),
    featPicks: WIZ_DED,
    pickFeatChoices: { '4:class:1': 'cantrip-expansion' },
    cantrips: ['daze', 'shield', 'light', 'guidance', 'detect-magic', 'know-the-way', 'stabilize', 'vitality-lash'],
    archetypeSpells: { cantrips: ['daze', 'shield', 'light', 'detect-magic'], spells: {} } as never,
    ...over,
  });

describe('1 · Cantrip Expansion through Basic Arcana feeds the WIZARD ARCHETYPE, not the class', () => {
  it('Druid with Wizard Dedication: druid 5 (unchanged), wizard archetype 2 → 4', () => {
    const c = buildCharacter(arcanaCE('druid'), db);
    expect(entry(c, 'druid-casting')?.cantripCap, 'the druid cannot take Cantrip Expansion; its pool is untouched').toBe(5);
    expect(entry(c, 'wizard-dedication-casting')?.cantripCap, 'the two cantrips went nowhere').toBe(4);
    expect(entry(c, 'wizard-dedication-casting')?.cantrips).toHaveLength(4);
  });
  it('Cleric with Wizard Dedication: through Basic Arcana → archetype 4; in its own cleric slot → cleric 7', () => {
    const viaArcana = buildCharacter(arcanaCE('cleric'), db);
    expect(entry(viaArcana, 'cleric-casting')?.cantripCap).toBe(5);
    expect(entry(viaArcana, 'wizard-dedication-casting')?.cantripCap).toBe(4);
    const own = buildCharacter(arcanaCE('cleric', { featPicks: { ...WIZ_DED, '4:class:1': 'cantrip-expansion' }, pickFeatChoices: {} }), db);
    expect(entry(own, 'cleric-casting')?.cantripCap, 'a cleric feat the cleric took is the cleric’s').toBe(7);
    expect(entry(own, 'wizard-dedication-casting')?.cantripCap).toBe(2);
  });
  it('Fighter whose only caster is the archetype: 2 → 4, and the builder’s count (archetypeCantripCounts) agrees', () => {
    const b = arcanaCE('fighter', { keyAbility: 'str' });
    const c = buildCharacter(b, db);
    expect(entry(c, 'wizard-dedication-casting')?.cantripCap).toBe(4);
    const arch = activeCasterArchetype(Object.values(b.featPicks))!;
    expect(archetypeCantripCounts(arch, b, db, Object.values(b.featPicks)).prepared, 'the builder’s level page reads this').toBe(4);
  });
  it('a stale answer counts for nothing: Basic Arcana swapped out of its slot, the answer left behind', () => {
    const b = arcanaCE('fighter', { keyAbility: 'str', featPicks: { ...WIZ_DED, '4:class:1': 'basic-wizard-spellcasting' } });
    expect(entry(buildCharacter(b, db), 'wizard-dedication-casting')?.cantripCap).toBe(2);
  });
  it('with the trust gate on (the app): the same numbers', () => {
    const c = buildCharacter(arcanaCE('druid', {}, gated), gated);
    expect(entry(c, 'druid-casting')?.cantripCap).toBe(5);
    expect(entry(c, 'wizard-dedication-casting')?.cantripCap).toBe(4);
  });
});

// ── 2 ────────────────────────────────────────────────────────────────────────────────────────────────
describe('2 · an Adapted Cantrip answer from no magical tradition is a choice left', () => {
  const human = (answer: string) =>
    pc({ classId: 'wizard', keyAbility: 'int', subclassId: sub('wizard'), level: 1, featPicks: { '1:ancestry:0': 'adapted-cantrip' }, featChoices: { '1:ancestry:0': answer } });
  it('allegro (no tradition) → "Adapted Cantrip — choose again" on the Level 1 page', () => {
    expect(db.spells.allegro?.traditions ?? []).toEqual([]);
    const left = levelChoices(human('allegro'), db).filter((m) => /Adapted Cantrip/.test(m.label));
    expect(left).toEqual([{ page: 1, label: 'Adapted Cantrip — choose again', required: true }]);
  });
  it('a legal answer (a divine cantrip for a wizard) leaves nothing to choose', () => {
    expect(levelChoices(human('vitality-lash'), db).filter((m) => /Adapted Cantrip/.test(m.label))).toEqual([]);
  });
});

// ── 4 ────────────────────────────────────────────────────────────────────────────────────────────────
describe('4 · a lesson removed in Overrides takes its hex and its familiar spell with it', () => {
  const witch = (over: Partial<BuildState>) =>
    pc({ classId: 'witch', keyAbility: 'int', subclassId: sub('witch'), level: 2, featPicks: { '2:class:0': 'basic-lesson' }, featChoices: { '2:class:0': 'aon-lesson-of-life' }, ...over });
  it('kept: Life Boost hex + Spirit Link in the familiar; removed: neither — the same as never taking it', () => {
    const kept = buildCharacter(witch({}), db);
    expect(focusOf(kept)).toContain('life-boost');
    expect(Object.values(entry(kept, 'witch-casting')?.grantedRepertoire ?? {}).flat()).toContain('spirit-link');
    const removed = buildCharacter(witch({ overrides: { removedFeatIds: ['basic-lesson'] } }), db);
    const never = buildCharacter(witch({ featPicks: {} }), db);
    expect(focusOf(removed), 'the removed lesson still taught its hex').not.toContain('life-boost');
    expect(focusOf(removed)).toEqual(focusOf(never));
    expect(Object.values(entry(removed, 'witch-casting')?.grantedRepertoire ?? {}).flat()).not.toContain('spirit-link');
    expect(removed.focusPool ?? null).toEqual(never.focusPool ?? null);
  });
});

// ── 5 ────────────────────────────────────────────────────────────────────────────────────────────────
describe('5 · two Major Lessons through two Advanced Witchcraft feats are answered separately', () => {
  const b = pc({
    classId: 'fighter',
    keyAbility: 'str',
    level: 20,
    featPicks: {
      '2:class:0': 'witch-dedication',
      '4:class:1': 'basic-witch-spellcasting',
      '6:class:2': 'basic-witchcraft',
      '8:class:3': 'advanced-witchcraft',
      '10:class:4': 'advanced-witchcraft',
      '12:class:5': 'expert-witch-spellcasting',
      '18:class:6': 'master-witch-spellcasting',
    },
    pickFeatChoices: { '8:class:3': 'major-lesson', '10:class:4': 'major-lesson' },
    grantedFeatChoices: { 'major-lesson': 'aon-lesson-of-bargains', 'major-lesson#10:class:4': 'aon-lesson-of-death' },
    cantrips: ['daze', 'shield'],
  });
  const lessons = (c: Character) => c.feats.filter((f) => f.featId === 'major-lesson').map((f) => [f.level, f.grantVariant ?? '', f.choice?.label ?? null]);
  it('the later taking reads its granting slot "major-lesson#10:class:4": Lesson of Death, its hex and Raise Dead', () => {
    const c = buildCharacter(b, db);
    expect(lessons(c)).toEqual([
      [8, '', 'Lesson of Bargains'],
      [10, '10:class:4', 'Lesson of Death'],
    ]);
    expect(focusOf(c)).toEqual(expect.arrayContaining(['over-the-coals', 'curse-of-death']));
    expect(Object.values(entry(c, 'witch-dedication-casting')?.grantedRepertoire ?? {}).flat()).toContain('raise-dead');
  });
  it('a character saved before keeps its one answer on the first taking (the bare key never moves)', () => {
    const old = buildCharacter({ ...b, grantedFeatChoices: { 'major-lesson': 'aon-lesson-of-bargains' } }, db);
    expect(lessons(old).map((r) => r[2])).toEqual(['Lesson of Bargains', null]);
  });
  // Checker, 2026-10-16: a COUNT ("#2") followed the list's order. Keyed by the slot, these hold.
  it('the later slot stored first in the save: still level 8 bare, level 10 its own', () => {
    const reordered = { ...b, featPicks: Object.fromEntries(Object.entries(b.featPicks).reverse()) };
    expect(lessons(buildCharacter(reordered, db))).toEqual([
      [8, '', 'Lesson of Bargains'],
      [10, '10:class:4', 'Lesson of Death'],
    ]);
  });
  it('the earlier Advanced Witchcraft swapped away: the level-10 taking keeps ITS lesson (Death), never the bare Bargains', () => {
    const swapped = { ...b, featPicks: { ...b.featPicks, '8:class:3': 'expert-witch-spellcasting' } };
    const c = buildCharacter(swapped, db);
    expect(lessons(c)).toEqual([[10, '10:class:4', 'Lesson of Death']]);
    expect(focusOf(c)).toContain('curse-of-death');
    expect(focusOf(c)).not.toContain('over-the-coals');
  });
  it('the later taking’s answer moves with its slot: "Move to slot", and Dual Class switched on under Free Archetype', () => {
    // "Move to slot" for a feat left under a key no slot draws (the Builder's swapSlotKeys).
    const stranded = { ...b, featPicks: { ...b.featPicks, '10:class:4': undefined as unknown as string, '10:class:9': 'advanced-witchcraft' }, pickFeatChoices: { '8:class:3': 'major-lesson', '10:class:9': 'major-lesson' }, grantedFeatChoices: { 'major-lesson': 'aon-lesson-of-bargains', 'major-lesson#10:class:9': 'aon-lesson-of-death' }, featSpellChoices: { 'granted:major-lesson#10:class:9:granted-spell': 'x' } };
    delete (stranded.featPicks as Record<string, string>)['10:class:4'];
    const moved = { ...stranded, ...swapSlotKeys(stranded, '10:class:9', '10:class:4') } as BuildState;
    expect(moved.grantedFeatChoices).toEqual({ 'major-lesson': 'aon-lesson-of-bargains', 'major-lesson#10:class:4': 'aon-lesson-of-death' });
    expect(moved.featSpellChoices).toEqual({ 'granted:major-lesson#10:class:4:granted-spell': 'x' });
    expect(lessons(buildCharacter(moved, db))).toEqual([
      [8, '', 'Lesson of Bargains'],
      [10, '10:class:4', 'Lesson of Death'],
    ]);
    // Free Archetype slots, then Dual Class on: the archetype slot index moves (rekeyFeatSlots).
    const fa = pc({
      classId: 'fighter',
      keyAbility: 'str',
      level: 20,
      variantRules: { freeArchetype: true } as BuildState['variantRules'],
      featPicks: { '2:archetype:2': 'witch-dedication', '4:archetype:2': 'basic-witch-spellcasting', '6:archetype:2': 'basic-witchcraft', '8:archetype:2': 'advanced-witchcraft', '10:archetype:2': 'advanced-witchcraft' },
      pickFeatChoices: { '8:archetype:2': 'major-lesson', '10:archetype:2': 'major-lesson' },
      grantedFeatChoices: { 'major-lesson': 'aon-lesson-of-bargains', 'major-lesson#10:archetype:2': 'aon-lesson-of-death' },
      cantrips: ['daze', 'shield'],
    });
    const dual = rekeyFeatSlots(fa, { ...fa, classId2: 'rogue', variantRules: { ...fa.variantRules, dualClass: true } as BuildState['variantRules'] }, db);
    const at10 = Object.keys(dual.pickFeatChoices ?? {}).find((k) => k.startsWith('10:archetype:'))!;
    expect(at10, 'fixture: Dual Class moved the archetype slot').not.toBe('10:archetype:2');
    expect(dual.grantedFeatChoices?.[`major-lesson#${at10}`]).toBe('aon-lesson-of-death');
    const c = buildCharacter(dual, db);
    expect(lessons(c).map((r) => r[2])).toEqual(['Lesson of Bargains', 'Lesson of Death']);
    expect(focusOf(c)).toEqual(expect.arrayContaining(['over-the-coals', 'curse-of-death']));
  });
  it('past Major Lesson’s cap of 3, the hexes taught are the lessons shown, whatever order the answers were saved in', () => {
    const four = {
      ...b,
      featPicks: { ...b.featPicks, '12:class:5': 'advanced-witchcraft', '14:class:7': 'advanced-witchcraft' },
      pickFeatChoices: { '14:class:7': 'major-lesson', '12:class:5': 'major-lesson', '10:class:4': 'major-lesson', '8:class:3': 'major-lesson' },
      grantedFeatChoices: {
        'major-lesson': 'aon-lesson-of-bargains',
        'major-lesson#10:class:4': 'aon-lesson-of-death',
        'major-lesson#12:class:5': 'aon-lesson-of-protection',
        'major-lesson#14:class:7': 'aon-lesson-of-snow',
      },
    };
    const c = buildCharacter(four, db);
    expect(lessons(c).map((r) => r[2])).toEqual(['Lesson of Bargains', 'Lesson of Death', 'Lesson of Protection']);
    expect(focusOf(c)).toContain('over-the-coals');
    expect(focusOf(c), 'the dropped 4th taking (Snow) teaches no hex').not.toContain('personal-blizzard');
  });
  it('an old save with the answer under the granter’s bare id: the second taking, once answered, teaches its hex too', () => {
    const old = { ...b, pickFeatChoices: { 'advanced-witchcraft': 'major-lesson' }, grantedFeatChoices: { 'major-lesson': 'aon-lesson-of-bargains', 'major-lesson#10:class:4': 'aon-lesson-of-death' } };
    const c = buildCharacter(old, db);
    expect(lessons(c)).toEqual([
      [8, '', 'Lesson of Bargains'],
      [10, '10:class:4', 'Lesson of Death'],
    ]);
    expect(focusOf(c)).toEqual(expect.arrayContaining(['over-the-coals', 'curse-of-death']));
  });
  it('two DIFFERENT granters each handing over Additional Lore keep their own Lore subjects (old keys)', () => {
    const lore = pc({
      classId: 'fighter',
      keyAbility: 'str',
      level: 6,
      featPicks: { '1:ancestry:0': 'general-training', '2:class:0': 'rogue-dedication', '6:class:1': 'skill-mastery' },
      pickFeatChoices: { '1:ancestry:0': 'additional-lore', '6:class:1': 'additional-lore' },
      featLoreChoices: { 'general-training:additional-lore:0': 'Sailing', 'skill-mastery:additional-lore:0': 'Warfare' },
    });
    const c = buildCharacter(lore, db);
    expect(c.feats.filter((f) => f.featId === 'additional-lore').map((f) => f.grantVariant ?? '')).toEqual(['', '']);
    const lores = Object.keys(c.proficiencies.skills).filter((k) => k.startsWith('lore:'));
    expect(lores).toEqual(expect.arrayContaining(['lore:sailing', 'lore:warfare']));
  });
  it('removing the GRANTER in Overrides takes its picked lesson and hex away too', () => {
    const w = pc({ classId: 'fighter', keyAbility: 'str', level: 6, featPicks: { '2:class:0': 'witch-dedication', '6:class:2': 'basic-witchcraft' }, pickFeatChoices: { '6:class:2': 'basic-lesson' }, grantedFeatChoices: { 'basic-lesson': 'aon-lesson-of-life' } });
    expect(focusOf(buildCharacter(w, db))).toContain('life-boost');
    const removed = buildCharacter({ ...w, overrides: { removedFeatIds: ['basic-witchcraft'] } }, db);
    expect(removed.feats.map((f) => f.featId)).not.toContain('basic-lesson');
    expect(focusOf(removed)).not.toContain('life-boost');
  });
});

// ── 7 ────────────────────────────────────────────────────────────────────────────────────────────────
describe('7 · a notice that is not missing data is marked "check"', () => {
  it('Oatia Skysage: a stored cantrip the dedication does not name → kind "check"; Bright Fetchling’s missing spell → no kind', () => {
    const sky = buildCharacter(pc({ classId: 'fighter', keyAbility: 'str', level: 2, featPicks: { '2:class:0': 'oatia-skysage-dedication' }, cantrips: ['daze', 'guidance'] }), db);
    const w = (sky.effectWarnings ?? []).find((x) => /Daze/.test(x.message));
    expect(w?.kind).toBe('check');
    const fetch = buildCharacter(pc({ classId: 'fighter', keyAbility: 'str', level: 1, ancestryId: 'fetchling', heritageId: 'bright-fetchling' }), db);
    const miss = (fetch.effectWarnings ?? []).find((x) => /dancing lights/i.test(x.message));
    expect(miss, 'Bright Fetchling still warns').toBeTruthy();
    expect(miss?.kind).toBeUndefined();
  });
});

// ── the sorcerer's over note (chat-todo K leftover, "with F") ─────────────────────────────────────────
describe('the sorcerer’s "one too many" note talks about places, not about cards', () => {
  it('"this class gives you 5 cantrip places, and your bloodline’s cantrip takes one of them" — never "is one of your 5"', () => {
    expect(overGiftNote(5, true)).toBe('One too many — this class gives you 5 cantrip places, and your bloodline’s cantrip takes one of them; remove one in the builder');
    expect(overGiftNote(4, false, true, 2)).toBe('2 spells too many — this class gives you 4 spell places, and your bloodline’s spell takes one of them; remove 2 with the Repertoire button');
    expect(overGiftNote(5, true)).not.toMatch(/is one of your/);
  });
});

// ── 10 ───────────────────────────────────────────────────────────────────────────────────────────────
describe('10 · Spellshot + Beast Gunner: one pool, the spellshot’s two cantrips at will, and the sheet says so', () => {
  const pair = (over: Partial<BuildState> = {}) =>
    pc({
      classId: 'gunslinger',
      keyAbility: 'dex',
      subclassId: sub('gunslinger'),
      featPicks: { '2:class:0': 'spellshot-dedication', '4:class:1': 'beast-gunner-dedication' },
      cantrips: ['ray-of-frost'],
      ...over,
    });
  const KEYS = ['spellshot-dedication:spellbook-cantrip-1', 'spellshot-dedication:spellbook-cantrip-2'];
  it('nothing chosen yet: the beast gunner entry says where they go and to choose them; the level owes the choice', () => {
    const c = buildCharacter(pair(), db);
    expect(entry(c, 'beast-gunner-dedication-casting')?.note).toContain(
      'Beast Gunner Dedication holds your archetype spells, so your 2 Spellshot Dedication cantrips are cast at will as innate arcane cantrips. Choose them in the builder (Level 2, Spellshot Dedication).',
    );
    expect(levelChoices(pair(), db)).toContainEqual({ page: 2, label: 'Spellshot Dedication — choose 2 cantrips', required: true });
  });
  it('chosen: cast at will under Innate spells, and the note names them', () => {
    const b = pair({ effectChoices: { [KEYS[0]]: 'daze', [KEYS[1]]: 'shield' } });
    const c = buildCharacter(b, db);
    const innate = c.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.cantrips).toEqual(expect.arrayContaining(['daze', 'shield']));
    expect(entry(c, 'beast-gunner-dedication-casting')?.note).toContain(
      'Beast Gunner Dedication holds your archetype spells, so your Spellshot Dedication cantrips (Daze, Shield) are cast at will as innate arcane cantrips — they are listed under Innate spells.',
    );
    expect(levelChoices(b, db).filter((m) => /Spellshot/.test(m.label))).toEqual([]);
  });
  it('a lone spellshot (it holds the pool) gets no such note and owes no such choice', () => {
    const b = pair({ featPicks: { '2:class:0': 'spellshot-dedication', '4:class:1': 'basic-wizard-spellcasting' } });
    expect(entry(buildCharacter(b, db), 'spellshot-dedication-casting')?.note ?? '').not.toMatch(/at will/);
    expect(levelChoices(b, db).filter((m) => /Spellshot/.test(m.label))).toEqual([]);
  });
});
