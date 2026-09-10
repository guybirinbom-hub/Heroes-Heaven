import { describe, expect, it } from 'vitest';
import { content } from './_content';
import type { ClassFeature, IwrEntry, ModeDef } from '../src/rules/types';

/**
 * Batch-035, WG-comparison lane — the DATA-ROWS family, chunk 2.
 *
 * Every assertion reads the shipped `public/core.json` (plus `public/core-descriptions.json`) through
 * `content()` and pins the field the driver's backfill row authors. Nothing here diffs a patched copy
 * against the shipped one: each assertion fails today for exactly one reason — the field is absent, or
 * still carries the value print contradicts — and passes once work/.b035-rows-data-rows-2.json is
 * applied. Assertions marked "harness half" pass BOTH before and after; they are here so a row that
 * lands on the wrong record is caught rather than read as a pass.
 */
const db = () => content();
const cf = (id: string) => db().classFeatures[id] as (ClassFeature & Record<string, unknown>) | undefined;
const mode = (id: string): ModeDef | undefined => db().modes[id];
const animalLabel = (value: string) =>
  (cf('animal-instinct')?.choice as { options: { value: string; label: string }[] } | undefined)?.options.find(
    (o) => o.value === value,
  )?.label;
const wizardSchool = (optionId: string) =>
  db().classes.wizard?.subclass?.options.find((o) => o.id === optionId) as
    | { description?: string; descRefs?: { label: string; key: string }[] }
    | undefined;

describe('animal-instinct labels the crab attacks the way instinct-8 prints them', () => {
  // batch 035: animal-instinct#strike-names
  it('offers Crab with a Big Claw, not two attacks both called Claw', () => {
    // instinct-8 (Animal, Player Core 2 pg. 74) prints "Crab Big Claw 1d10 B Razing, unarmed" and then
    // "Claw 1d4 S Parry, unarmed". Our picker label read "Crab (Claw 1d10 B, razing; Claw 1d4 S,
    // parry)", naming both attacks Claw, so nothing in the choice told the player which was the 1d10.
    // The other half of this finding — renaming the grantedStrikes rows themselves ('BigClaw' → 'Big
    // Claw', and the wasp's mis-named 'Pincer' → 'Stinger') — lands on
    // classFeatures/animal-instinct.grantedStrikes, which chunk data-rows-1 re-emits for
    // animal-instinct#cat, so it is a CROSS-FILE GAPS line in this chunk's report, not a row here.
    expect(animalLabel('crab')).toBe('Crab (Big Claw 1d10 B, razing; Claw 1d4 S, parry)');
    // harness half: the wasp label already carried the printed Stinger, and is carried over untouched.
    expect(animalLabel('wasp')).toBe('Wasp (Stinger 1d4 P, backstabber/deadly d8/venomous)');
  });
});

describe('animal-instinct cites instinct-8, the printing whose table it carries', () => {
  // batch 035: animal-instinct#edition
  it('is joined to the Player Core 2 page and is not tagged legacy', () => {
    // instinct-8 is Source ["Player Core 2"] pg. 74 — 22 animals, the 1d6 frog Tongue, the Howl of the
    // Wild table, all of which this record reproduces. instinct-1 is the Core Rulebook printing (nine
    // animals, frog Tongue 1d4 B).
    //
    // ⚠ NOT "the instinct picker loses it": batch 035's own sibling finding
    // superstition-instinct#edition-and-aonid was REFUTED for exactly that claim — the instinct picker
    // is built from `cls.subclass.options` (Builder.tsx:1894), an array applyEditionFilter never walks
    // (build.ts:3147 filters TOP-LEVEL map entries by `edition`). What "legacy" really costs is the
    // record itself: applyEditionFilter drops content.classFeatures['animal-instinct'] under "Hide
    // legacy data", and the FOLLOW-UP "which animal" question is read off that record
    // (`content.classFeatures[build.subclassId]?.choice`, Builder.tsx:1912) — with `content` memoised
    // on stale keepIds — so a barbarian picking Animal in that session is offered no animal at all.
    expect(cf('animal-instinct')?.aonId).toBe('instinct-8');
    expect(cf('animal-instinct')?.edition).toBe('remaster');
    // harness half: the record's own source has always said Player Core 2 — that is the contradiction.
    expect((cf('animal-instinct')?.source as { book?: string } | undefined)?.book).toBe('Pathfinder Player Core 2');
  });
});

describe('curse-of-torrential-knowledge puts its cursebound penalty on a stat', () => {
  // batch 035: curse-of-torrential-knowledge
  it('carries a four-rung ladder, each rung -N status to Perception and Will', () => {
    // mystery-18: "You take a status penalty to Perception checks and Will saving throws equal to your
    // cursebound value". The only carrier was a RECORD_MARKERS note (situationalBonuses.ts:4557) that
    // never reaches a stat row, and the generic cat-cursebound-1..4 carry modifiers: [] — so no oracle
    // of the Lore mystery ever saw the number. WG encodes the same ladder at -1..-4.
    for (const n of [1, 2, 3, 4]) {
      const m = mode(`curse-of-torrential-knowledge-${n}`);
      expect(m, `rung ${n} exists`).toBeDefined();
      expect(m?.feats).toEqual(['curse-of-torrential-knowledge']);
      expect(m?.exclusiveGroup).toBe('oracle-cursebound');
      expect(m?.modifiers).toEqual([
        { value: -n, type: 'status', target: 'perception' },
        { value: -n, type: 'status', target: 'save', detail: 'will' },
      ]);
    }
    // At cursebound 4 print adds the silence clause, which has no numeric carrier: it stays in the note.
    expect(mode('curse-of-torrential-knowledge-4')?.note).toContain('linguistic effects');
  });
});

describe('phlogistonic-regulator resists half your level, and 2 more in Overdrive', () => {
  // batch 035: phlogistonic-regulator#resistance-minimum
  it('has no minimum on the resistance print does not floor', () => {
    // innovation-5: "You gain resistance equal to half your level to cold and fire damage" — no
    // minimum, and WG's row 24832 has none either, so a 1st-level inventor read resistance 1 where
    // both authorities read 0. The sibling modification with identical wording (dense-plating) is
    // already stored as plain floor(@actor.level/2).
    expect(cf('phlogistonic-regulator')?.resistances).toEqual([
      { type: 'cold', value: 'floor(@actor.level/2)' },
      { type: 'fire', value: 'floor(@actor.level/2)' },
    ]);
    // harness half: the sibling this shape is matched against.
    expect((cf('dense-plating')?.resistances as IwrEntry[] | undefined)?.[0]?.value).toBe('floor(@actor.level/2)');
  });

  // batch 035: phlogistonic-regulator#overdrive
  it('gains an Overdrive mode worth the printed +2', () => {
    // innovation-5 ends "When under the effects of Overdrive, the resistance increases by 2." Nothing
    // carried it. cat-harmonic-oscillator-overdrive is the only other Overdrive mode in the bucket and
    // stores the boosted number as a REPLACEMENT total, so 2+floor(level/2) over a floor(level/2) base
    // is exactly "increases by 2".
    const m = mode('cat-phlogistonic-regulator-overdrive');
    expect(m, 'the Overdrive mode exists').toBeDefined();
    expect(m?.feats).toEqual(['phlogistonic-regulator']);
    expect(m?.resistances).toEqual([
      { type: 'cold', value: '2+floor(@actor.level/2)' },
      { type: 'fire', value: '2+floor(@actor.level/2)' },
    ]);
  });
});

describe('school-of-protean-form shows the 9th-rank curriculum spell it prints', () => {
  // batch 035: school-of-protean-form#curriculum-9th
  it('ends the picker copy of the curriculum with Metamorphosis, and links it', () => {
    // arcane-school-20 (Player Core pg. 200) ends the Curriculum "- 9th: Metamorphosis". The copy the
    // school SetupCard renders (classes.wizard.subclass.options[...].description/descRefs, passed at
    // src/builder/shared.tsx:3335) ended on a bare "- **9th:**" with descRefs that skipped the spell,
    // so the player choosing this school read a curriculum one spell short of print.
    const option = wizardSchool('school-of-protean-form');
    expect(option?.description).toContain('- **9th:** Metamorphosis');
    expect(option?.descRefs?.map((r) => r.label)).toContain('Metamorphosis');
    // harness half: the ENGINE copy was always right — this finding is display-only.
    expect((cf('school-of-protean-form')?.curriculum as Record<string, string[]> | undefined)?.['9']).toEqual([
      'metamorphosis',
    ]);
  });
});

describe('curse-of-the-skys-call puts its forced-movement penalty on the saves', () => {
  // batch 035: curse-of-the-skys-call
  it('carries a four-rung ladder, each rung -N status on all three saves', () => {
    // mystery-15: "you take a status penalty to saves and DCs against all forms of forced movement
    // equal to your cursebound value". The only carrier was a RECORD_MARKERS note
    // (situationalBonuses.ts:4556), which markersFor matches on on/id alone and never puts on a save
    // row — while five sibling curses already ship per-rung modes. WG encodes 4 x 3 ops at -1..-4.
    for (const n of [1, 2, 3, 4]) {
      const m = mode(`curse-of-the-skys-call-${n}`);
      expect(m, `rung ${n} exists`).toBeDefined();
      expect(m?.feats).toEqual(['curse-of-the-skys-call']);
      expect(m?.exclusiveGroup).toBe('oracle-cursebound');
      expect(m?.modifiers).toEqual(
        ['fortitude', 'reflex', 'will'].map((detail) => ({
          value: -n,
          type: 'status',
          target: 'save',
          detail,
          appliesWhen: 'against all forms of forced movement',
        })),
      );
      // The enfeebled clause has no carrier — ModeDef has no `conditions` field — so it stays prose.
      expect(m?.note).toContain(`enfeebled ${n}`);
    }
  });
});

describe('lesson-of-elements cites the Player Core printing it is sourced to', () => {
  // batch 035: lesson-of-elements#edition
  it('is joined to lesson-17 and names gust of wind, not the legacy air bubble', () => {
    // lesson-17 (Player Core pg. 185): "You gain the Elemental Betrayal hex. Your familiar learns your
    // choice of breathe fire, gust of wind, hydraulic push, or pummeling rubble." lesson-2 is the
    // Advanced Player's Guide printing (burning hands, air bubble, ...), whose remaster_id IS
    // lesson-17. We shipped a hybrid list matching NEITHER printing — that is the player-visible half,
    // since the record's name and description are what the sheet and the description popup print.
    //
    // ⚠ NOT "dropped from every picker": the lesson PICKER is feats['basic-lesson'].choice.options
    // (value 'aon-lesson-of-elements', which choiceOwnedFeatureIds resolves by stripping 'aon-'), so
    // the option survives the filter; and the live character is built from the UNFILTERED ovContent
    // (Builder.tsx:227), so the hex is never lost. "legacy" only drops
    // content.classFeatures['lesson-of-elements'] out of the picker DB, which costs the choice's
    // details popup. Same overstatement batch 035 REFUTED on superstition-instinct#edition-and-aonid.
    const rec = cf('lesson-of-elements');
    expect(rec?.aonId).toBe('lesson-17');
    expect(rec?.edition).toBe('remaster');
    expect(rec?.name).toBe('Lesson of the Elements');
    expect(rec?.description).toBe(
      'You gain the Elemental Betrayal hex. Your familiar learns your choice of Breathe Fire, Gust of Wind, Hydraulic Push, or Pummeling Rubble.',
    );
    const labels = (rec?.descRefs as { label: string }[] | undefined)?.map((r) => r.label);
    expect(labels).toContain('Gust of Wind');
    expect(labels).not.toContain('Air Bubble');
    // harness half: the spell the corrected text links to is really in the database.
    expect(db().spells['gust-of-wind']).toBeDefined();
  });
});
