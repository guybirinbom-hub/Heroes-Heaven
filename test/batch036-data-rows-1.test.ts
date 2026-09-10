import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { Character } from '../src/rules/types';

/**
 * Batch 036, data-rows-1: the WG-comparison findings whose whole fix is authored data.
 *
 * Every assertion reads the SHIPPED artefacts through `content()` (public/core.json plus the
 * split-out public/core-descriptions.json), so each one fails until the driver applies
 * work/.b036-rows-data-rows-1.json — the test pins the row, not a patched copy.
 */
const db = content();

const feature = (id: string) => db.classFeatures[id]!;

/**
 * Every witch lesson prints ONE sentence with TWO halves: *"You gain the <Hex> hex, and your familiar
 * learns <Spell>."* Only the hex half had a carrier (`focusSpells`); the taught spell reached nothing,
 * so it never joined the witch's spellbook. `grantedSpells` is the half the reader was already built
 * for — the choice-owned-feature walk at src/rules/build.ts:4046-4055 collects it into
 * featureGrantedSpells and merges it into the caster pool's grantedByRank at build.ts:4295, which is
 * the lane the shipped lesson-of-vengeance row (batch 035) proved.
 */
describe('witch lessons — the second half of the sentence, the spell the familiar learns', () => {
  // batch 036: lesson-of-protection#familiar-spell
  it('lesson-of-protection teaches Mystic Armor', () => {
    // AoN lesson-19: *"You gain the Blood Ward hex, and your familiar learns Mystic Armor."*
    expect(feature('lesson-of-protection').grantedSpells).toEqual(['mystic-armor']);
    // The hex half is untouched — this is the OTHER half of the same sentence, not a replacement.
    expect(feature('lesson-of-protection').focusSpells).toEqual(['blood-ward']);
  });

  // batch 036: lesson-of-dreams#familiar-spell
  it('lesson-of-dreams teaches Sleep', () => {
    // AoN lesson-16: *"You gain the Veil of Dreams hex, and your familiar learns Sleep."*
    expect(feature('lesson-of-dreams').grantedSpells).toEqual(['sleep']);
    expect(feature('lesson-of-dreams').focusSpells).toEqual(['veil-of-dreams']);
  });

  // batch 036: lesson-of-life#familiar-spell
  it('lesson-of-life teaches Spirit Link', () => {
    // AoN lesson-18: *"You gain the Life Boost hex, and your familiar learns Spirit Link."*
    expect(feature('lesson-of-life').grantedSpells).toEqual(['spirit-link']);
    expect(feature('lesson-of-life').focusSpells).toEqual(['life-boost']);
  });

  // batch 036: lesson-of-shadow#familiar-spell
  it('lesson-of-shadow teaches Chilling Darkness', () => {
    // AoN lesson-22: *"You gain the Malicious Shadow hex, and your familiar learns Chilling Darkness."*
    expect(feature('lesson-of-shadow').grantedSpells).toEqual(['chilling-darkness']);
    expect(feature('lesson-of-shadow').focusSpells).toEqual(['malicious-shadow']);
  });

  // batch 036: lesson-of-decay
  it('lesson-of-decay teaches Insect Form', () => {
    // AoN lesson-26: *"You gain the Mycological Malady hex, and your familiar learns Insect Form."*
    expect(feature('lesson-of-decay').grantedSpells).toEqual(['insect-form']);
    expect(feature('lesson-of-decay').focusSpells).toEqual(['mycological-malady']);
  });

  // batch 036: lesson-of-mischief
  it('lesson-of-mischief teaches Mad Monkeys', () => {
    // AoN lesson-21: *"You gain the Deceiver's Cloak hex, and your familiar learns Mad Monkeys."*
    expect(feature('lesson-of-mischief').grantedSpells).toEqual(['mad-monkeys']);
    expect(feature('lesson-of-mischief').focusSpells).toEqual(['deceivers-cloak']);
  });

  // batch 036: lesson-of-snow
  it('lesson-of-snow teaches Wall of Wind', () => {
    // AoN lesson-23: *"You gain the Personal Blizzard hex, and your familiar learns Wall of Wind."*
    expect(feature('lesson-of-snow').grantedSpells).toEqual(['wall-of-wind']);
    expect(feature('lesson-of-snow').focusSpells).toEqual(['personal-blizzard']);
  });

  // batch 036: lesson-of-the-shark
  it('lesson-of-the-shark teaches Feet to Fins', () => {
    // AoN lesson-28: *"You gain the Blood in the Water hex, and your familiar learns Feet to Fins."*
    expect(feature('lesson-of-the-shark').grantedSpells).toEqual(['feet-to-fins']);
    expect(feature('lesson-of-the-shark').focusSpells).toEqual(['blood-in-the-water']);
  });

  /**
   * A field with a reader is not the same as a spell in the book, so one of each lesson TYPE is built
   * end to end: a basic lesson (rank 1) and a greater one (rank 3), because the merge at build.ts:4295
   * files the id by `content.spells[id].rank` and the two land in different buckets. The hex assertion
   * in each is the control — it passes today, so a red spellbook line means the row is missing, not
   * that the lesson was never picked.
   */
  const witch = (level: number, featId: string, lessonId: string): Character =>
    build('witch', level, {
      keyAbility: 'int',
      featPicks: { [`${level}:class`]: featId },
      featChoices: { [`${level}:class`]: `aon-${lessonId}` },
    });
  const book = (ch: Character, rank: number) => ch.spellcasting.find((s) => s.type === 'prepared')?.spellbook?.[rank] ?? [];
  const hexes = (ch: Character, rank: number) => ch.spellcasting.find((s) => s.type === 'focus')?.repertoire?.[rank] ?? [];

  // batch 036: lesson-of-protection#familiar-spell
  it('a 2nd-level witch who picks lesson-of-protection has Mystic Armor in the spellbook', () => {
    const ch = witch(2, 'basic-lesson', 'lesson-of-protection');
    expect(hexes(ch, 1)).toContain('blood-ward'); // control: the pick took effect
    expect(book(ch, 1)).toContain('mystic-armor');
  });

  // batch 036: lesson-of-decay
  it('a 6th-level witch who picks lesson-of-decay has Insect Form at rank 3 in the spellbook', () => {
    const ch = witch(6, 'greater-lesson', 'lesson-of-decay');
    // Control: the pick took effect. Rank 3, not 1 — Mycological Malady is a rank-3 hex, and the focus
    // repertoire is bucketed by the spell's own rank exactly as the spellbook is.
    expect(hexes(ch, 3)).toContain('mycological-malady');
    expect(book(ch, 3)).toContain('insect-form');
  });
});

describe('blessed-swiftness — the mounted redirect and the print join', () => {
  // batch 036: blessed-swiftness#mounted
  it('the blessed-swiftness mode note states the mounted redirect instead of denying it', () => {
    /* AoN class-feature-877 (Blessing of the Devoted): *"Blessed Swiftness: You gain a +5-foot status
     * bonus to Speed. If you're mounted, your mount gains the bonus instead."* The shipped note ended
     * "(The +5-foot Speed is yours wherever you stand and is already on your sheet.)" — the record's
     * own description printed the condition and its disclosure denied it. */
    const note = feature('blessed-swiftness').modeAdjust?.[0]?.note ?? '';
    expect(note).toContain('your mount gains the bonus instead');
    expect(note).not.toContain('wherever you stand');
    // The +2-defenses half of the same note is what the mode adjust exists for, and stays.
    expect(note).toContain('+2 status bonus to all defenses');
    // No mount-Speed carrier exists on either side, so the flat bonus is unchanged — the note discloses
    // the redirect rather than the engine mis-modelling it.
    expect(feature('blessed-swiftness').landSpeedBonus).toBe(5);
  });

  // batch 036: blessed-swiftness#aon-parent
  it('blessed-swiftness joins its print to Blessing of the Devoted, not to Bracers of Devotion', () => {
    /* The shipped parent was equipment-2320 — Bracers of Devotion, an Item 11 whose same-named section
     * reads only "Blessed Swiftness The bonus to Speed is +10 feet." A name collision, a different
     * mechanic, a different book. The section key moves with the parent because class-feature-877
     * spells its headings with a colon. */
    expect(feature('blessed-swiftness').aonParentId).toBe('class-feature-877');
    expect(feature('blessed-swiftness').aonSection).toBe('Blessed Swiftness:');
    // The sibling already joined correctly, and is the shape this row copies — it must not move.
    expect(feature('blessed-shield').aonParentId).toBe('class-feature-877');
    expect(feature('blessed-shield').aonSection).toBe('Blessed Shield:');
  });
});
