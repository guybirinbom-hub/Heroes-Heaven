/*
 * BATCH 035 — INSTRUMENTS, CHUNK 2.
 *
 * Seven records the EXPERIENCE harness reports as `UNSUPPORTED — "no class or subclass grants this
 * feature at level 20"`. Not one of them is a coverage gap: the harness's host search
 * (`classFeatureHost`, test/wg-experience.harness.test.tsx:494-506) can only reach an owner through
 * `ownedAt20`, which calls `classFeatureIdsOwned({classId, subclassId, level})` and passes NO
 * `classChoices`. That closes two routes the real app uses every build:
 *
 *   route A — an animist APPARITION is owned by `classes.animist.extraChoices['apparition']`, and
 *             `classFeatureIdsOwned` reaches an extra-choice pick only through the `classChoices`
 *             argument that build.ts:5290-5296 does pass and the harness does not.
 *   route B — a witch LESSON is owned by `feats['basic-lesson'].choice.ownsFeature`, resolved by
 *             `choiceOwnedFeatureIds` (derive.ts:3551) — a route `classFeatureIdsOwned` has at all.
 *
 * Each test below is the HAND VERIFICATION the harness cannot do: the printed mechanics are asserted
 * on a really built level-20 character, and then asserted GONE on an in-memory copy with the carrier
 * stripped. The park in work/experience-instrument-limits.json is only as honest as this pair — if
 * the stunt changed nothing, the assertions would be reading something other than the carrier.
 *
 * The host assertion is repeated on BOTH the healthy and the stunted content on purpose: the
 * UNSUPPORTED verdict is indifferent to the carrier, which is exactly why it describes the
 * instrument and not the record.
 *
 * ⚠ ROUTE B IS NO LONGER A BLINDNESS, since later in this same batch. `harnessSees` below is a FROZEN
 * LOCAL COPY of the pre-batch-035 host search (class features and subclass options only), kept so the
 * hand verifications above keep proving what they proved when they were written; it is NOT the real
 * `classFeatureHost`, which gained a feat-choice route (`featChoiceHost`) and now hosts
 * lesson-of-vengeance and lesson-of-elements — both were lifted out of
 * work/experience-instrument-limits.json and report OK. Route A (the animist apparitions) is still a
 * live blindness. See work/.b035-report-red-experience-hosts.txt.
 */
import { describe, expect, it } from 'vitest';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { choiceOwnedFeatureIds, classFeatureIdsOwned } from '../src/rules/derive';
import { apparitionSlots } from '../src/rules/spellcasting';
import { content, firstSubclass } from './_content';
import type { Character, ContentDatabase, ProficiencyKey } from '../src/rules/types';

const db = content();
const ANC = Object.keys(db.ancestries)[0];
const BG = Object.keys(db.backgrounds)[0];

type Loose = Record<string, any>;

const stateFor = (classId: string, over: Partial<BuildState>): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level: 20,
  classId,
  ancestryId: ANC,
  backgroundId: BG,
  keyAbility: (db.classes[classId].keyAbility.length === 1
    ? db.classes[classId].keyAbility[0]
    : null) as BuildState['keyAbility'],
  subclassId: firstSubclass(classId),
  ...over,
});

/** A level-20 animist attuned to exactly one apparition, which is therefore also the primary. */
const attuned = (id: string, on: ContentDatabase = db): Character =>
  buildCharacter(stateFor('animist', { extraChoices: { apparition: [id] }, primaryApparition: id }), on);

/** A level-20 witch holding Basic Lesson answered with `value`. */
const lessoned = (value: string, on: ContentDatabase = db): Character =>
  buildCharacter(
    stateFor('witch', { featPicks: { '2:class': 'basic-lesson' }, featChoices: { '2:class': value } } as Partial<BuildState>),
    on,
  );

/** A shallow content copy whose animist class alone is deep-copied, so a stunt cannot leak. */
function stuntApparition(id: string, mutate: (option: Loose) => void): ContentDatabase {
  const animist = JSON.parse(JSON.stringify(db.classes.animist)) as Loose;
  const group = animist.extraChoices.find((g: Loose) => g.id === 'apparition');
  const option = group.options.find((o: Loose) => o.id === id);
  mutate(option);
  expect(JSON.stringify(option), 'the stunt bit nothing').not.toBe(
    JSON.stringify((db.classes.animist as Loose).extraChoices.find((g: Loose) => g.id === 'apparition').options.find((o: Loose) => o.id === id)),
  );
  return { ...db, classes: { ...db.classes, animist } } as ContentDatabase;
}

/** A shallow content copy whose ONE class-feature record is replaced, focus spells stripped. */
function stuntLesson(id: string): ContentDatabase {
  const rec = { ...(db.classFeatures[id] as Loose) };
  delete rec.focusSpells;
  return { ...db, classFeatures: { ...db.classFeatures, [id]: rec } } as ContentDatabase;
}

const appEntry = (ch: Character) => ch.spellcasting.find((e) => e.id === 'animist-apparition-casting');
const focusKnown = (ch: Character) =>
  new Set(ch.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat()));
const loreRank = (ch: Character, subject: string) => ch.proficiencies.skills[`lore:${subject}` as ProficiencyKey];

/** The harness's own host search, reproduced exactly: no `classChoices` argument. */
const harnessSees = (classId: string, id: string) => {
  const cls = db.classes[classId];
  if (classFeatureIdsOwned({ classId, subclassId: null, level: 20 }, db).has(id)) return true;
  return (cls.subclass?.options ?? []).some((o) =>
    classFeatureIdsOwned({ classId, subclassId: o.id as string, level: 20 }, db).has(id),
  );
};

/**
 * The five apparitions, with the ten printed spells IN PRINTED RANK ORDER (index 0 = the cantrip) and
 * the two printed Apparition Skills. Transcribed from the AoN mirror documents named beside each, not
 * from our own record — a table read out of the carrier would agree with the carrier by construction.
 */
const APPARITIONS: Record<string, { aon: string; lores: [string, string]; vessel: string; spells: string[] }> = {
  'shepherd-of-errant-winds': {
    aon: 'apparition-14',
    lores: ['sailing', 'scouting'],
    vessel: 'gift-of-the-anemos',
    spells: ['slashing-gust', 'tailwind', 'propulsive-breeze', 'wall-of-wind', 'vapor-form', 'scouting-eye', 'mislead', 'vacuum', 'punishing-winds', 'wrathful-storm'],
  },
  'stalker-in-darkened-boughs': {
    aon: 'apparition-10',
    lores: ['forest', 'hunting'],
    vessel: 'darkened-forest-form',
    spells: ['gouging-claw', 'runic-body', 'vomit-swarm', 'wall-of-thorns', 'bestial-curse', 'moon-frenzy', 'tangling-creepers', 'unfettered-pack', 'monstrosity-form', 'wrathful-storm'],
  },
  'crafter-in-the-vault': {
    aon: 'apparition-3',
    lores: ['architecture', 'engineering'],
    vessel: 'traveling-workshop',
    spells: ['sigil', 'mending', 'knock', 'ghostly-weapon', 'creation', 'impaling-spike', 'wall-of-metal', 'beheading-buzz-saw', 'ferrous-form', 'resplendent-mansion'],
  },
  'reveler-in-lost-glee': {
    aon: 'apparition-9',
    lores: ['circus', 'fortune-telling'],
    vessel: 'tricksters-mirrors',
    spells: ['prestidigitation', 'dizzying-colors', 'laughing-fit', 'hypnotize', 'confusion', 'illusory-scene', 'vibrant-pattern', 'warp-mind', 'quandary', 'wails-of-the-damned'],
  },
  'custodian-of-groves-and-gardens': {
    aon: 'apparition-4',
    lores: ['farming', 'herbalism'],
    vessel: 'garden-of-healing',
    spells: ['tangle-vine', 'protector-tree', 'gentle-breeze', 'safe-passage', 'peaceful-bubble', 'truespeech', 'field-of-life', 'lifewood-cage', 'moment-of-renewal', 'natures-enmity'],
  },
};

describe('batch 035 instruments-2 — the harness host search, not the record', () => {
  // batch 035: crafter-in-the-vault#instrument
  it('crafter-in-the-vault and its four siblings are invisible to the harness for want of one argument', () => {
    /*
     * The diagnosis, isolated from any one record: the SAME function that answers "no owner" for the
     * harness answers "owned" the moment it is given the extra-choice pick the app passes it. Nothing
     * about the record changes between the two calls.
     */
    for (const id of Object.keys(APPARITIONS)) {
      expect(harnessSees('animist', id), `${id} — the harness suddenly has a host`).toBe(false);
      expect(
        classFeatureIdsOwned(
          { classId: 'animist', subclassId: firstSubclass('animist'), level: 20, classChoices: [{ id, level: 1 }] },
          db,
        ).has(id),
        `${id} — the classChoices route the app uses stopped reaching it`,
      ).toBe(true);
    }
  });

  // batch 035: lesson-of-vengeance#experience-flag
  it('lesson-of-vengeance and lesson-of-elements are owned by a feat choice, a route the host search has not got', () => {
    for (const id of ['lesson-of-vengeance', 'lesson-of-elements']) {
      for (const classId of Object.keys(db.classes)) {
        expect(harnessSees(classId, id), `${classId} unexpectedly owns ${id}`).toBe(false);
      }
      expect(
        choiceOwnedFeatureIds([{ featId: 'basic-lesson', choice: { value: `aon-${id}` } }], db),
        `${id} is no longer owned by the Basic Lesson choice`,
      ).toContain(id);
    }
  });
});

describe.each(Object.entries(APPARITIONS))(
  'batch 035 instruments-2 — %s delivers its printed block off the animist extraChoices option',
  (id, print) => {
    // batch 035: shepherd-of-errant-winds
    // batch 035: stalker-in-darkened-boughs
    // batch 035: crafter-in-the-vault#instrument
    // batch 035: reveler-in-lost-glee
    // batch 035: custodian-of-groves-and-gardens
    it(`${id}: two Apparition Skills at master, ten spells by rank, and the vessel spell in the pool`, () => {
      /*
       * Print (AoN mirror `apparition/${print.aon}.json`): **Apparition Skills** <two Lores>;
       * **Apparition Spells** cantrip + 1st…9th; **Vessel Spell** <one>. The apparition ladder in the
       * same book raises those Lores to expert at 8th and master at 16th, so a 20th-level animist
       * attuned to this apparition reads master.
       *
       * mutation-proof — the second half runs the identical assertions against an in-memory content
       * copy with `grants.lores`, `grantedSpells` and `focusSpells` deleted from THIS option, and each
       * one must fail over to nothing. The harness's own verdict does not move either way, which is
       * the whole point of the park: it is blind to the carrier, not reading it wrongly.
       */
      const ch = attuned(id);
      for (const l of print.lores) expect(loreRank(ch, l), `${id}: Lore ${l}`).toBe('master');

      const entry = appEntry(ch);
      expect(entry, `${id}: no apparition spellcasting entry`).toBeDefined();
      expect(entry!.cantrips, `${id}: the printed cantrip`).toContain(print.spells[0]);
      for (const [i, sid] of print.spells.entries()) {
        if (i === 0) continue;
        expect(apparitionSlots(20)[i], `${id}: no rank-${i} apparition slot at 20th`).toBeGreaterThan(0);
        expect(entry!.repertoire?.[i] ?? [], `${id}: rank ${i} is missing ${sid}`).toContain(sid);
      }
      expect(focusKnown(ch).has(print.vessel), `${id}: the vessel spell never reached the focus pool`).toBe(true);

      // mutation-proof
      const stunted = stuntApparition(id, (o) => {
        delete o.grants?.lores;
        delete o.grantedSpells;
        delete o.focusSpells;
      });
      const bare = attuned(id, stunted);
      for (const l of print.lores) expect(loreRank(bare, l), `${id}: Lore ${l} survived the stunt`).toBeUndefined();
      const bareEntry = appEntry(bare);
      const bareKnown = new Set([...(bareEntry?.cantrips ?? []), ...Object.values(bareEntry?.repertoire ?? {}).flat()]);
      for (const sid of print.spells) expect(bareKnown.has(sid), `${id}: ${sid} survived the stunt`).toBe(false);
      expect(focusKnown(bare).has(print.vessel), `${id}: the vessel spell survived the stunt`).toBe(false);

      // …and the instrument is unmoved by all of that.
      expect(harnessSees('animist', id), `${id}: the host search reacted to the carrier`).toBe(false);
    });
  },
);

describe('batch 035 instruments-2 — lesson-of-vengeance and lesson-of-elements reach the focus pool', () => {
  // batch 035: lesson-of-vengeance#experience-flag
  // batch 035: lesson-of-elements#experience-flag
  it.each([
    ['lesson-of-vengeance', 'needle-of-vengeance'],
    ['lesson-of-elements', 'elemental-betrayal'],
  ])('%s puts %s in the witch focus pool', (id, hex) => {
    /*
     * Print: "You gain the Needle of Vengeance hex" / "You gain the Elemental Betrayal hex". The hex
     * lives on `classFeatures/<lesson>.focusSpells`, and build.ts:4005-4013 gathers it through
     * `choiceOwnedFeatureIds` because no class feature list holds a lesson.
     *
     * mutation-proof — the same witch built against a content copy with the lesson's `focusSpells`
     * stripped must lose the hex, while the harness still finds no host either way.
     */
    expect(focusKnown(lessoned(`aon-${id}`)).has(hex), `${id}: ${hex} never reached the pool`).toBe(true);
    // mutation-proof
    expect(focusKnown(lessoned(`aon-${id}`, stuntLesson(id))).has(hex), `${id}: ${hex} survived the stunt`).toBe(false);
    expect(harnessSees('witch', id), `${id}: the host search reacted to the carrier`).toBe(false);
  });
});
