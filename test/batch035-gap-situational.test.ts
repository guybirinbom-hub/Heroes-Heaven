import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import { recordMarkersFor } from '../src/rules/explain';
import { deriveDefenses } from '../src/rules/derive';
import { resourcesForCharacter } from '../src/rules/classResources';
import type { Character, ClassFeature, ContentDatabase } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 035, SITUATIONAL family — the GAP pass.
 *
 * The situational builder held two things back as "no reader exists", and this closes both readers:
 * the inventor's Overdrive STATE (types.ts's `whileActive.state` union plus a CLASS_RESOURCES toggle,
 * so "when under the effects of Overdrive" can finally be a number), and an answer scope for a
 * RecordMarker (so Animal Instinct's Spider footnote stops showing to the other 21 animals).
 *
 * Discipline unchanged: every assertion goes through the reader the SHEET uses — `deriveDefenses`
 * (the IWR rows and their breakdown) and `recordMarkersFor` (MainTab's action rows) — on a BUILT
 * character, never the registry or the table literal.
 */
const db = content();

/** The marks ONE record puts on an action row. */
const marks = (c: Character, on: 'action' | 'condition' | 'feature', id: string, sourceId: string) =>
  recordMarkersFor(c, db, on, id).filter((m) => m.sourceId === sourceId);

const resist = (c: Character, content: ContentDatabase, type: string) =>
  deriveDefenses(c, content).resistances.find((r) => r.type === type)?.value;

/** The character with Overdrive switched on, exactly as the play overlay writes it. */
const overdriven = (c: Character): Character => ({ ...c, classResources: { ...(c.classResources ?? {}), overdrive: 1 } });

describe('metallic-reactance raises the resistance while Overdrive is on', () => {
  /* AoN innovation-5, Metallic Reactance: "You gain resistance equal to 3 + half your level to acid
   * and electricity damage. When under the effects of Overdrive, the resistance increases by 2."
   * The record shipped only the first sentence, and the second could not become a number at all: the
   * `whileActive.state` union had no 'overdrive' member and CLASS_RESOURCES had no inventor bucket,
   * so nothing could ever be "under the effects of Overdrive". Both are now in place, and the
   * whileActive row this batch's gap spec authors is what the state grant reads.
   *
   * ⚠ The ROW has not landed yet (the driver applies work/.b035-rows-gap-situational.json), so the
   * value under test is PATCHED INTO A CONTENT COPY here rather than read from the shipped record —
   * and `shipped` below is the same build against the untouched database, which proves the row is
   * what does the work rather than the toggle alone. */
  const WHILE_ACTIVE = [
    {
      state: 'overdrive' as const,
      resistances: [
        { type: 'acid', value: '5+floor(@actor.level/2)' },
        { type: 'electricity', value: '5+floor(@actor.level/2)' },
      ],
    },
  ];
  const patched: ContentDatabase = {
    ...db,
    classFeatures: {
      ...db.classFeatures,
      'metallic-reactance': { ...db.classFeatures['metallic-reactance'], whileActive: WHILE_ACTIVE } as ClassFeature,
    },
  };

  const metallic = build('inventor', 5, {
    subclassId: 'armor-innovation',
    inventorModifications: { initial: 'metallic-reactance' },
  } as Partial<BuildState>);

  // batch 035: metallic-reactance#overdrive
  it('an inventor holding metallic-reactance has an Overdrive toggle to be under the effects of', () => {
    expect(resourcesForCharacter('inventor', new Set()).map((r) => r.id)).toContain('overdrive');
    // A toggle starts off, so the un-Overdriven sheet is what a fresh character reads.
    expect(metallic.classResources?.overdrive).toBe(0);
  });

  // batch 035: metallic-reactance#overdrive
  it('the flat 3 + half your level is what the sheet shows while Overdrive is off', () => {
    expect(resist(metallic, patched, 'acid'), '3 + half of 5').toBe(5);
    expect(resist(metallic, patched, 'electricity')).toBe(5);
  });

  // batch 035: metallic-reactance#overdrive
  it('…and it rises by 2 while Overdrive is on, because same-type resistances take the highest', () => {
    expect(resist(overdriven(metallic), patched, 'acid'), '5 + half of 5').toBe(7);
    expect(resist(overdriven(metallic), patched, 'electricity')).toBe(7);
  });

  // batch 035: metallic-reactance#overdrive
  it('the row is what raises it: with the shipped record the toggle changes nothing', () => {
    /* WAS `db` — "the shipped record", written while the row was still a spec. The driver has since
     * applied it, so the shipped record now HAS the whileActive block and reading it here asserted
     * the fix away. The stunt is built explicitly instead, which is what it always meant: strip the
     * block and the Overdrive toggle moves nothing. */
    // batch 035: metallic-reactance#overdrive
    const stunted: ContentDatabase = {
      ...db,
      classFeatures: {
        ...db.classFeatures,
        'metallic-reactance': { ...db.classFeatures['metallic-reactance'], whileActive: undefined } as ClassFeature,
      },
    };
    expect(resist(overdriven(metallic), stunted, 'acid')).toBe(5);
  });

  // batch 035: metallic-reactance#overdrive
  it('an inventor with a different modification gains no acid resistance either way', () => {
    const dense = build('inventor', 5, {
      subclassId: 'armor-innovation',
      inventorModifications: { initial: 'dense-plating' },
    } as Partial<BuildState>);
    expect(resist(overdriven(dense), patched, 'acid')).toBeUndefined();
  });
});

describe('animal-instinct shows the Spider Web note to the spider only', () => {
  /* AoN instinct-8 gives 22 animals 22 different attacks, and only the Spider's carries the Web
   * footnote ("The spider's web attack deals no damage, but the target takes a -10-foot circumstance
   * penalty to its Speeds for 1 round on a hit"). A RecordMarker is keyed by RECORD id, so the mark
   * the builder authored reached every animal-instinct barbarian; `RecordMarker.choiceValue` now
   * scopes it to the answered animal, read from the same `feature:<id>` map derive.ts already uses. */

  const spider = build('barbarian', 5, {
    subclassId: 'animal-instinct',
    featChoices: { 'feature:animal-instinct': 'spider' },
  } as Partial<BuildState>);
  const bear = build('barbarian', 5, {
    subclassId: 'animal-instinct',
    featChoices: { 'feature:animal-instinct': 'bear' },
  } as Partial<BuildState>);

  // batch 035: animal-instinct#spider-web
  it('a barbarian who answered "spider" still reads the Web note on Rage', () => {
    // The answer has to reach the character at all, or the gate would hide the mark from everyone.
    expect(spider.featureChoices?.['feature:animal-instinct']).toBe('spider');
    const m = marks(spider, 'action', 'rage', 'animal-instinct');
    expect(m.length).toBe(1);
    expect(m[0].note).toContain('15 feet');
    expect(m[0].note).toContain('no damage');
  });

  // batch 035: animal-instinct#spider-web
  it('a bear barbarian of the same instinct reads nothing about spiders', () => {
    expect(bear.featureChoices?.['feature:animal-instinct']).toBe('bear');
    // Same record, same Rage row, same registry entry — only the answer differs.
    expect(marks(bear, 'action', 'rage', 'animal-instinct')).toEqual([]);
  });
});
