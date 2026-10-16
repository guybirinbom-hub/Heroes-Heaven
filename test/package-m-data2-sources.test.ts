import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { applySources, buildCharacter, collectChosenIds, emptyBuild, type BuildState } from '../src/rules/build';
import { CORE_BOOKS, enabledBookSet, entrySourceOn } from '../src/rules/sources';
import { ownedFeatureIds } from '../src/rules/derive';
import { featEntries } from '../src/sheet/FeatsTab';
import type { ContentDatabase } from '../src/rules/types';

/**
 * PACKAGE M, ROUND 2 (a) — a class's own features never vanish behind the Sources card.
 *
 * The shared Perception Expertise record is listed by twelve class tables, the cleric's at 5th (class-33,
 * Player Core), but its own page is another class's printing in a non-Core book (today Dark Archive
 * (Remastered), the Thaumaturge's class-feature-1183; the round-2 move to the Exemplar's class-feature-1075
 * would make it War of Immortals). A player whose Sources are Core only must still own it: class features
 * are auto-granted by the class, not chosen from a map, so src/rules/sources.ts keeps `classFeatures` out of
 * CHOOSABLE_SOURCE_MAPS. This pins that with a Core-only cleric 9, and plants the filter that would break it.
 */
const full = content();
const cleric9: BuildState = {
  ...emptyBuild(),
  name: 't',
  level: 9,
  classId: 'cleric',
  subclassId: 'cloistered-cleric',
  keyAbility: 'wis',
  deityId: 'sarenrae',
  ancestryId: Object.keys(full.ancestries)[0],
  backgroundId: Object.keys(full.backgrounds)[0],
};
/** Exactly what the Builder hands its pickers for a character with no stored Sources: Core only. */
const coreOnly = (db: ContentDatabase) => applySources(db, enabledBookSet(undefined), collectChosenIds(cleric9, db));

describe('the premise', () => {
  it('Perception Expertise is listed by the cleric at 5th and its record names a non-Core book', () => {
    expect(full.classes.cleric.features).toContainEqual({ level: 5, featureId: 'perception-expertise' });
    const book = full.classFeatures['perception-expertise'].source?.book;
    expect(book).toBeTruthy();
    expect(CORE_BOOKS).not.toContain(book);
    expect(entrySourceOn(enabledBookSet(undefined), full.classFeatures['perception-expertise']), 'the book itself is off for Core only').toBe(false);
  });
});

describe('a Core-only cleric 9 keeps the class\'s own Perception Expertise', () => {
  // batch package-m premise: class-33 (Cleric, Player Core) "Perception Expertise … Your proficiency rank for Perception increases to expert"
  it('the Core-only content still carries the record', () => {
    expect(coreOnly(full).classFeatures['perception-expertise']).toBeTruthy();
  });

  it('built from the Core-only content: owns the feature, is expert in Perception, and its feature row is there', () => {
    const db = coreOnly(full);
    const ch = buildCharacter(cleric9, db);
    expect(ownedFeatureIds(ch, db).has('perception-expertise')).toBe(true);
    expect(ch.proficiencies.perception).toBe('expert');
    expect(featEntries(ch, db).some((e) => e.name === 'Perception Expertise')).toBe(true);
  });

  it('planted: a filter that also ran on classFeatures would take the record — and the row — away', () => {
    const db = coreOnly(full);
    const on = enabledBookSet(undefined);
    const filteredFeatures = Object.fromEntries(Object.entries(db.classFeatures).filter(([, r]) => entrySourceOn(on, r)));
    const bad = { ...db, classFeatures: filteredFeatures } as ContentDatabase;
    expect(bad.classFeatures['perception-expertise']).toBeUndefined();
    expect(featEntries(buildCharacter(cleric9, bad), bad).some((e) => e.name === 'Perception Expertise')).toBe(false);
  });
});
