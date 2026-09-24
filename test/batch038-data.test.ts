import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { bonusLanguageSlots, buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { ContentDatabase } from '../src/rules/types';

/**
 * Batch 038, data-rows: the WG-comparison findings whose whole fix is authored data
 * (work/.b038-rows-data-rows.json).
 *
 * The "shipped" assertions read public/core.json through `content()`, so they fail until the driver
 * applies the rows — that is the point, they pin the row. The "mechanism" assertions build on an
 * in-memory copy with the field STRIPPED (or patched to the row's value), so they hold both before and
 * after the row lands and prove the reader turns the field into what the player sees.
 */
const db = content();

/** `db` with one top-level field of one record replaced (`undefined` strips it). */
const withField = (bucket: 'heritages' | 'backgrounds' | 'classFeatures', id: string, field: string, value: unknown): ContentDatabase => {
  const rec = { ...(db[bucket] as Record<string, Record<string, unknown>>)[id] };
  if (value === undefined) delete rec[field];
  else rec[field] = value;
  return { ...db, [bucket]: { ...(db[bucket] as object), [id]: rec } } as ContentDatabase;
};

const automaton = (heritageId: string): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level: 1,
  classId: 'fighter',
  ancestryId: 'automaton',
  heritageId,
  backgroundId: Object.keys(db.backgrounds)[0],
  keyAbility: 'str',
});

describe('defensive-automaton gives 10 ancestry HP instead of 8', () => {
  // batch 038: defensive-automaton#hp
  it('defensive-automaton: the shipped heritage carries ancestryHp 10 and the built automaton gets it', () => {
    // AoN heritage-438: "You gain 10 hit points from your ancestry instead of 8."
    expect(db.ancestries['automaton']!.hp).toBe(8);
    expect(db.heritages['defensive-automaton']!.ancestryHp).toBe(10);
    expect(buildCharacter(automaton('defensive-automaton'), db).ancestryHp).toBe(10);
  });

  // batch 038: defensive-automaton#hp
  it('defensive-automaton: the field is what moves max HP by 2 (stripped copy stays on the chassis 8)', () => {
    const stripped = buildCharacter(automaton('defensive-automaton'), withField('heritages', 'defensive-automaton', 'ancestryHp', undefined));
    const patched = buildCharacter(automaton('defensive-automaton'), withField('heritages', 'defensive-automaton', 'ancestryHp', 10));
    expect(stripped.ancestryHp).toBeUndefined();
    expect(patched.ancestryHp).toBe(10);
    expect(patched.hitPoints.current - stripped.hitPoints.current).toBe(2);
  });
});

describe('newly-minted-automaton knows one additional language', () => {
  // batch 038: newly-minted-automaton#language
  it('newly-minted-automaton: the shipped heritage carries one language slot', () => {
    // AoN heritage-439: "You know one additional language from the languages that you have access to."
    expect(db.heritages['newly-minted-automaton']!.languageChoices).toBe(1);
    const b = automaton('newly-minted-automaton');
    const without = withField('heritages', 'newly-minted-automaton', 'languageChoices', undefined);
    expect(bonusLanguageSlots(b, db) - bonusLanguageSlots(b, without)).toBe(1);
  });

  // batch 038: newly-minted-automaton#language
  it('newly-minted-automaton: languageChoices 1 on the heritage adds exactly one Builder language slot', () => {
    const b = automaton('newly-minted-automaton');
    const without = withField('heritages', 'newly-minted-automaton', 'languageChoices', undefined);
    const withRow = withField('heritages', 'newly-minted-automaton', 'languageChoices', 1);
    expect(bonusLanguageSlots(b, withRow) - bonusLanguageSlots(b, without)).toBe(1);
  });
});

describe('azlanti-researcher trains Azlant Lore', () => {
  // batch 038: azlanti-researcher#lore
  it('azlanti-researcher: the shipped background names Azlant Lore and the built character is trained in it', () => {
    // AoN background-654: "You're trained in the Religion skill, and the Azlant Lore skill ."
    expect(db.backgrounds['azlanti-researcher']!.trainedLore).toBe('azlant');
    const ch = build('fighter', 1, { backgroundId: 'azlanti-researcher' });
    expect(ch.proficiencies.skills['lore:azlant']).toBe('trained');
    expect(ch.proficiencies.skills['religion']).toBe('trained');
  });

  // batch 038: azlanti-researcher#lore
  it('azlanti-researcher: trainedLore "azlant" is what trains lore:azlant (stripped copy does not)', () => {
    const b: BuildState = { ...automaton('newly-minted-automaton'), ancestryId: Object.keys(db.ancestries)[0], heritageId: null, backgroundId: 'azlanti-researcher' };
    const stripped = buildCharacter(b, withField('backgrounds', 'azlanti-researcher', 'trainedLore', undefined));
    const patched = buildCharacter(b, withField('backgrounds', 'azlanti-researcher', 'trainedLore', 'azlant'));
    expect(stripped.proficiencies.skills['lore:azlant']).toBeUndefined();
    expect(patched.proficiencies.skills['lore:azlant']).toBe('trained');
  });
});

describe('lamentation-of-sinister-deals writes its avatar form onto the Avatar spell', () => {
  /** A level-19 animist attuned to exactly one apparition, which is therefore also the primary. */
  const attuned = (id: string, on: ContentDatabase) =>
    buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 19,
        classId: 'animist',
        ancestryId: Object.keys(db.ancestries)[0],
        backgroundId: Object.keys(db.backgrounds)[0],
        keyAbility: 'wis',
        subclassId: db.classes['animist']?.subclass?.options[0]?.id ?? null,
        extraChoices: { apparition: [id] },
        primaryApparition: id,
      } as BuildState,
      on,
    );
  const ID = 'lamentation-of-sinister-deals';

  // batch 038: lamentation-of-sinister-deals#avatar
  it('lamentation-of-sinister-deals: the shipped apparition puts the Cosmic Notary form on Avatar', () => {
    // AoN apparition-16: "Avatar Cosmic Notary Speed 30 feet, fly 50 feet; Melee Single Action burning pen"
    const notes = attuned(ID, db).spellNotes?.['avatar'] ?? [];
    const mine = notes.filter((n) => n.from === 'Lamentation of Sinister Deals');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.note).toContain('Cosmic Notary');
    expect(mine[0]!.note).toContain('6d6+6 piercing');
    expect(mine[0]!.note).toContain('6d6+6 mental');
    // Supreme Incarnation (class-feature-1056) is what makes it true, so the note says so itself.
    expect(mine[0]!.note).toContain('primary attuned apparition');
  });

  // batch 038: lamentation-of-sinister-deals#avatar
  it('lamentation-of-sinister-deals: spellNotes on the apparition record is the carrier (stripped copy writes nothing)', () => {
    const note = { spellId: 'avatar', note: 'X' };
    const stripped = attuned(ID, withField('classFeatures', ID, 'spellNotes', undefined));
    const patched = attuned(ID, withField('classFeatures', ID, 'spellNotes', [note]));
    expect((stripped.spellNotes?.['avatar'] ?? []).some((n) => n.from === 'Lamentation of Sinister Deals')).toBe(false);
    expect(patched.spellNotes?.['avatar']).toContainEqual({ from: 'Lamentation of Sinister Deals', note: 'X' });
  });
});
