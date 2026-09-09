import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { applyDescriptions, type DescriptionsFile } from '../src/data';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { COMPANION_MODS } from '../src/rules/companionGrants';
import { deriveDefenses, deriveSpeeds } from '../src/rules/derive';
import { FEAT_SKILL_GRANTS } from '../src/rules/featGrantsAuto';
import { featUse } from '../src/rules/featUses';
import { spellOpenedBy } from '../src/sheet/SpellsTab';
import type { Character, ContentDatabase, IwrEntry, ModeDef, Spell } from '../src/rules/types';

/**
 * Batch-033, WG-comparison lane — the GAP-DATA-ROWS family.
 *
 * Everything the data-rows builder could not finish inside its own files: seven cross-file reader gaps
 * and the rows that were waiting on one of them. A reader added here has no shipped writer yet by
 * design — the row that will use it belongs to another family's spec and cannot be authored twice — so
 * those assertions run the real derive over a content copy with the field PATCHED IN MEMORY, never a
 * patched-vs-shipped delta that would flip direction the moment the row lands.
 */
const db = () => content();

/** A shallow content copy with one classFeatures record replaced — deep enough that nothing leaks. */
function withFeature(id: string, rec: Record<string, unknown>): ContentDatabase {
  const base = db();
  return { ...base, classFeatures: { ...base.classFeatures, [id]: rec } } as ContentDatabase;
}

describe('the-tangible-dream reaches the picker the player actually reads', () => {
  // batch 033: the-tangible-dream#granted-spell-2nd
  it('syncs a repaired class-feature description onto the subclass OPTION copy of the same record', () => {
    // The repaired text already ships: core-descriptions.json classFeatures/the-tangible-dream reads
    // "- 2nd: Invisibility". The copy the Builder renders is
    // classes.psychic.subclass.options[the-tangible-dream].description, and loadDescriptions() wrote
    // `.d` onto db[bucket][id] alone — so no backfill row could ever reach it and the option kept the
    // pre-repair string. Read straight off disk, because test/_content.ts merges the two files with
    // the same record-only loop this fix is about.
    const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
    const descs = JSON.parse(readFileSync('public/core-descriptions.json', 'utf8')) as DescriptionsFile;
    const optionOf = (cls: string, id: string) =>
      ((core.classes[cls] as unknown as { subclass?: { options?: { id: string; description?: string }[] } })
        .subclass?.options ?? []).find((o) => o.id === id);

    expect(optionOf('psychic', 'the-tangible-dream')).toBeTruthy();            // the harness half
    expect(descs.classFeatures['the-tangible-dream']?.d).toContain('2nd: Invisibility');

    applyDescriptions(core, descs);
    const opt = optionOf('psychic', 'the-tangible-dream');
    expect(opt?.description).toBe(descs.classFeatures['the-tangible-dream']?.d);
    expect(opt?.description).toContain('2nd: Invisibility');

    // …and it is systemic, not one record: 45 options across 11 classes were stale, angel-eidolon and
    // red-mantis-magic-school among them. After the sync, no option disagrees with its record's entry.
    const stale: string[] = [];
    for (const cls of Object.values(core.classes) as unknown as {
      subclass?: { options?: { id: string; description?: string }[] };
      extraChoices?: { options?: { id: string; description?: string }[] }[];
    }[]) {
      for (const options of [cls.subclass?.options, ...(cls.extraChoices ?? []).map((e) => e.options)]) {
        for (const o of options ?? []) {
          const d = descs.classFeatures?.[o.id]?.d;
          if (d !== undefined && o.description !== undefined && o.description !== d) stale.push(o.id);
        }
      }
    }
    expect(stale).toEqual([]);
  });
});

describe('school-of-unified-magical-theory retunes Drain Bonded Item', () => {
  // batch 033: school-of-unified-magical-theory#drain-bonded-item-uses
  it('prefers the subclass variant\'s limit over the generic class feature\'s, on one shared counter', () => {
    // arcane-school-21: "instead of using Drain Bonded Item only once per day, you can use it once per
    // day for each rank of spell you can cast." classFeatures/arcane-bond ships {max:1, per:'day'}, and
    // nothing in effectiveUses() preferred a `<featureId>-<subclassId>` variant — so the created record
    // could only have drawn a SECOND pip row beside the 1/day one. Patched in memory: the create row
    // that supplies this record lives in work/.b033-rows-gap-data-rows.json and lands with the batch.
    const ch = build('wizard', 9, { subclassId: 'school-of-unified-magical-theory' });
    expect(ch.subclassId).toBe('school-of-unified-magical-theory');            // the harness half
    expect(db().classFeatures['arcane-bond']?.limitedUses).toEqual({ max: 1, per: 'day' });

    const patched = withFeature('arcane-bond-school-of-unified-magical-theory', {
      id: 'arcane-bond-school-of-unified-magical-theory',
      name: 'Arcane Bond (Unified Magical Theory)',
      limitedUses: { max: 1, per: 'day', maxByLevel: { 3: 2, 5: 3, 7: 4, 9: 5, 11: 6, 13: 7, 15: 8, 17: 9, 19: 10 } },
    });

    // A 9th-level wizard casts 5th-rank spells: five uses, not one.
    const use = featUse(ch, patched.classFeatures['arcane-bond'], patched);
    expect(use?.max).toBe(5);
    // …spent against the GENERIC id, so the Feats tab (which shows the variant) and the Main tab
    // (which shows the action the generic grants) cannot keep two independent counts.
    expect(use?.featId).toBe('arcane-bond');
    expect(featUse(ch, patched.classFeatures['arcane-bond-school-of-unified-magical-theory'], patched)?.featId).toBe('arcane-bond');

    /* With the variant record ABSENT, and for any other school, the generic limit stands. Asserted
     * against a STRIPPED copy, not against `db()`: the create row this test was written beside has
     * since landed, so `db()` now carries the variant and a shipped-vs-patched delta reads 5 here
     * (it did — that is the failure this line was rewritten from). */
    const noVariant = { ...db(), classFeatures: { ...db().classFeatures } } as ContentDatabase;
    delete (noVariant.classFeatures as Record<string, unknown>)['arcane-bond-school-of-unified-magical-theory'];
    // batch 033: school-of-unified-magical-theory#drain-bonded-item-uses
    expect(featUse(ch, noVariant.classFeatures['arcane-bond'], noVariant)?.max).toBe(1);
    const evoker = build('wizard', 9, { subclassId: 'school-of-battle-magic' });
    expect(featUse(evoker, patched.classFeatures['arcane-bond'], patched)?.max).toBe(1);
  });
});

describe('steward-of-stone-and-fire grants its Lores once', () => {
  // batch 033: steward-of-stone-and-fire#duplicate-lore-grant
  it('leaves the apparition option as the only granter, with its printed 8th/16th ladder', () => {
    // The eight animist apparitions are class options, not feats, and build.ts:5637-5654 feeds every
    // owned class-feature id through FEAT_GRANTS — so each granted its two Lores a second time, flat at
    // 'trained', beside the option's own grants.lores + loreProgression (build.ts:3620).
    const apparitions = [
      'crafter-in-the-vault', 'echo-of-lost-moments', 'impostor-in-hidden-places', 'lurker-in-devouring-dark',
      'monarch-of-the-fey-courts', 'stalker-in-darkened-boughs', 'steward-of-stone-and-fire', 'vanguard-of-roaring-waters',
    ];
    const options = (db().classes.animist?.extraChoices ?? []).flatMap((e) => e.options ?? []);
    for (const id of apparitions) {
      expect(options.find((o) => o.id === id)?.grants?.lores?.length).toBe(2);  // the harness half
      expect(FEAT_SKILL_GRANTS[id]).toBeUndefined();
    }

    // …and nothing was lost: the option still trains both Lores, and the ladder the duplicate would
    // have floored at 'trained' still reaches expert at 8th.
    const ch = build('animist', 8, { extraChoices: { apparition: ['steward-of-stone-and-fire'] } });
    expect(ch.proficiencies.skills['lore:mountain']).toBe('expert');
    expect(ch.proficiencies.skills['lore:volcano']).toBe('expert');
  });
});

describe('angel-eidolon prints the remaster Hallowed Strikes', () => {
  // batch 033: angel-eidolon#hallowed-strikes-text
  it('says holy trait, unholy targets and the nonlethal clause on the companion note too', () => {
    // eidolon-1: "Your eidolon's unarmed Strikes gain the holy trait and deal 1 extra spirit damage to
    // unholy creatures and creatures with weakness to holy. Additionally, your eidolon can make
    // nonlethal attacks with its unarmed attacks without taking the usual -2 circumstance penalty."
    // The third copy of the sentence lived here and was pre-remaster in three ways at once.
    const note = COMPANION_MODS['angel-eidolon']?.note ?? '';
    expect(COMPANION_MODS['angel-eidolon']?.kinds).toContain('eidolon');      // the harness half
    expect(note).toContain('gain the holy trait');
    expect(note).toContain('unholy creatures and creatures with weakness to holy');
    expect(note).toContain('nonlethal');
    expect(note).not.toContain('(good)');
  });
});

describe('curse-of-creeping-ashes takes every Speed, not only the walking one', () => {
  // batch 033: curse-of-creeping-ashes#speed-penalty
  it('applies a mode Speed modifier to the movement types its `detail` names', () => {
    // mystery-20, Cursebound 4: "you take a -10-foot status penalty to ALL YOUR SPEEDS." A mode
    // targeting 'speed' folded into speeds.land and nowhere else, so the other four movement types WG
    // encodes (SPEED_FLY / SPEED_CLIMB / SPEED_BURROW / SPEED_SWIM) had no carrier at all. `detail` is
    // the field ModeModifier already uses to name what a modifier picks out. Patched in memory: the
    // row that carries detail:'all' is in
    // work/.b033-rows-resume-otherworldly-and-curse-rows-two-overlay-rows-values-otherworldly-protection-the-row-half-of-the-creeping-ashes-speed-line-.json
    // — the resume-data-rows group's, not work/.b033-rows-data-rows.json's, whose narrower row for the
    // same key was withdrawn when the two collided in the manifest. It is applied now, so this patch is
    // no longer a forward reference; the modifier is still built in memory here so the derive half is
    // what fails if it breaks, not the row.
    const ch = build('fighter', 6);
    const flying = (mods: ModeDef['modifiers']): Character => ({
      ...ch,
      activeModes: [{ id: 'test-curse', name: 'Cursebound 4', speeds: { fly: 30 }, modifiers: mods }],
    });

    const base = deriveSpeeds(flying([]), db());
    expect(base.fly).toBe(30);                                                  // the harness half
    const land = base.land ?? 0;
    expect(land).toBeGreaterThan(10);

    const all = deriveSpeeds(flying([{ value: -10, type: 'status', target: 'speed', detail: 'all' }]), db());
    expect(all.land).toBe(land - 10);
    expect(all.fly).toBe(20);

    // …while a modifier that says nothing still means the walking Speed, as every mode in the editor
    // and every shipped toggle means it today.
    const walking = deriveSpeeds(flying([{ value: -10, type: 'status', target: 'speed' }]), db());
    expect(walking.land).toBe(land - 10);
    expect(walking.fly).toBe(30);

    // …and one named movement type takes it alone.
    const onlyFly = deriveSpeeds(flying([{ value: -10, type: 'status', target: 'speed', detail: 'fly' }]), db());
    expect(onlyFly.land).toBe(land);
    expect(onlyFly.fly).toBe(20);
  });
});

describe('fey-eidolon opens the arcane list on the terms print names', () => {
  // batch 033: fey-eidolon#fey-gift-spells
  it('narrows a tradition widening to the traits the clause lists', () => {
    // eidolon-8: "you can add spells that have the ILLUSION OR MENTAL traits that appear on the arcane
    // spell list to your spell repertoire." SpellAccessGrant had no trait filter, so the widening was
    // all-or-nothing: 793 arcane spells offered where print offers 158.
    const spells = Object.values(db().spells) as Spell[];
    const arcane = spells.filter((s) => s.traditions?.includes('arcane'));
    const illusion = arcane.find((s) => (s.traits ?? []).includes('illusion'));
    const plain = arcane.find((s) => !(s.traits ?? []).some((t) => t === 'illusion' || t === 'mental'));
    expect(illusion && plain).toBeTruthy();                                     // the harness half

    const feyGift = { traditions: ['arcane'] as const, traits: ['illusion', 'mental'] };
    expect(spellOpenedBy({ traditions: [...feyGift.traditions], traits: feyGift.traits }, illusion!)).toBe(true);
    expect(spellOpenedBy({ traditions: [...feyGift.traditions], traits: feyGift.traits }, plain!)).toBe(false);
    // A widening with no traits is unchanged: the whole list, which is every other one in the database.
    expect(spellOpenedBy({ traditions: ['arcane'] }, plain!)).toBe(true);

    // …and the traits survive the build, or the picker never sees them.
    const patched = withFeature('fey-eidolon', {
      ...(db().classFeatures['fey-eidolon'] as unknown as Record<string, unknown>),
      spellListAdditions: { traditions: ['arcane'], traits: ['illusion', 'mental'] },
    });
    const ch = buildCharacter(
      { ...emptyBuild(), name: 't', level: 5, classId: 'summoner', subclassId: 'fey-eidolon', keyAbility: 'cha' },
      patched,
    );
    expect(ch.spellListTraditions?.find((w) => w.traits?.includes('illusion'))?.traits).toEqual(['illusion', 'mental']);
  });
});

describe('otherworldly-protection swaps void for vitality on a void-healing character', () => {
  // batch 033: otherworldly-protection#void-healing-swap
  it('gates an IWR entry on void healing, the fact deriveDefenses already computes', () => {
    // innovation-5 (the record's own remaster text): "You gain resistance equal to 3 + half your level
    // to void damage, or to vitality damage if you have void healing (such as if you're a dhampir)."
    // IwrEntry had `whenCreatureTrait` for exactly this shape and nothing for void healing, so a
    // dhampir inventor kept a resistance that never applies and never got the one that does. Patched in
    // memory: the follow-up row belongs to work/.b033-rows-data-rows.json, which owns this field.
    const swapped: IwrEntry[] = [
      { type: 'void', value: '3+floor(@actor.level/2)', whenVoidHealing: false },
      { type: 'vitality', value: '3+floor(@actor.level/2)', whenVoidHealing: true },
      { type: 'spirit', value: '3+floor(@actor.level/2)' },
    ];
    const patched = withFeature('otherworldly-protection', {
      ...(db().classFeatures['otherworldly-protection'] as unknown as Record<string, unknown>),
      resistances: swapped,
    });
    const inventor = (over: Record<string, unknown> = {}): Character =>
      build('inventor', 8, { subclassId: 'armor-innovation', inventorModifications: { initial: 'otherworldly-protection' }, ...over });

    const living = deriveDefenses(inventor(), patched);
    expect(living.negativeHealing).toBe(false);                                 // the harness half
    expect(living.resistances.find((r) => r.type === 'void')?.value).toBe(7);
    expect(living.resistances.some((r) => r.type === 'vitality')).toBe(false);

    const dhampir = deriveDefenses(inventor({ heritageId: 'dhampir' }), patched);
    expect(dhampir.negativeHealing).toBe(true);                                 // the harness half
    expect(dhampir.resistances.find((r) => r.type === 'vitality')?.value).toBe(7);
    expect(dhampir.resistances.some((r) => r.type === 'void')).toBe(false);
    // The ungated entry is untouched by the gate, in both directions.
    expect(dhampir.resistances.find((r) => r.type === 'spirit')?.value).toBe(7);
  });
});
