import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { maxTakes } from '../src/rules/featGrants';

/**
 * Batch 036, chunk data-rows-2. Every assertion here pins a row this chunk emitted in
 * work/.b036-rows-data-rows-2.json; the driver applies the rows to scripts/data/effect-backfill.json,
 * so each test reads the SHIPPED record through content() and asserts the authored field. Written
 * before the rows land, so they fail on the missing field until the driver applies the spec.
 */
describe('batch 036 data rows (chunk data-rows-2)', () => {
  // batch 036: lesson-of-the-flock
  // AoN lesson-27: "You gain the Sheltering Wings hex, and your familiar learns Levitate." We carried
  // only the hex, so the familiar half of the lesson reached nothing.
  it('classFeatures/lesson-of-the-flock grants Levitate to the familiar', () => {
    const rec = content().classFeatures['lesson-of-the-flock'];
    expect(rec?.focusSpells).toContain('sheltering-wings');
    expect(rec?.grantedSpells).toEqual(['levitate']);
    // The lesson reader (build.ts:4048) drops any id the spell catalog does not hold.
    expect(content().spells['levitate']?.rank).toBe(3);
  });

  // batch 036: wind-seeker
  // AoN feat-7138: "You add aerial form to your apparition spell repertoire, allowing you to cast it
  // with your apparition spellcasting." Same carrier its own prerequisite walk-the-wilds uses.
  it('feats/wind-seeker adds aerial form to the apparition repertoire', () => {
    const add = content().feats['wind-seeker']?.spellListAdditions;
    const one = Array.isArray(add) ? add[0] : add;
    expect(one).toEqual({ spells: ['aerial-form'], as: 'repertoire', entryId: 'animist-apparition-casting' });
    // Byte-identical in shape to the live sibling, which is what makes it reach build.ts:6618.
    const sib = content().feats['walk-the-wilds']?.spellListAdditions;
    const sibOne = Array.isArray(sib) ? sib[0] : sib;
    expect(Object.keys(one ?? {}).sort()).toEqual(Object.keys(sibOne ?? {}).sort());
    expect(content().spells['aerial-form']).toBeTruthy();
  });

  // batch 036: wind-seeker#darkened-forest-form
  // AoN feat-7138 Special: "If you are attuned to an apparition of darkened boughs, add the bat and
  // bird forms in aerial form to your darkened forest form lists." Changes no number — a spell note.
  it('feats/wind-seeker carries its Special clause as a note on darkened forest form', () => {
    const notes = content().feats['wind-seeker']?.spellNotes ?? [];
    const n = notes.find((x) => x.spellId === 'darkened-forest-form');
    expect(n).toBeTruthy();
    expect(n?.note).toMatch(/bat and bird forms/i);
    expect(content().spells['darkened-forest-form']).toBeTruthy();
  });

  // batch 036: deadly-mutation
  // AoN feat-5459: "The damage dice of your Spit Ambient Magic increase to d8s, and when a target
  // critically fails its save against the ability, it also takes 1d6 persistent bleed damage."
  it('feats/deadly-mutation rides on the granted Spit Ambient Magic action', () => {
    const mods = content().feats['deadly-mutation']?.modifiesGrant ?? [];
    const m = mods.find((x) => x.actionRider?.actionId === 'spit-ambient-magic');
    expect(m).toBeTruthy();
    expect(m?.actionRider?.note).toMatch(/d8s.*1d6 persistent bleed/is);
    /*
     * The ownership gate at build.ts:6551 tests `ownedIds.has(mod.from)` against FEAT and
     * CLASS-FEATURE ids only, so `from` must be the feat that grants the action, never the action:
     * spit-ambient-magic exists in the actions bucket alone and would have failed the gate silently.
     */
    expect(m?.from).toBe('ostilli-host-dedication');
    expect(content().feats['ostilli-host-dedication']?.grantsActions).toContain('spit-ambient-magic');
    expect(content().feats['spit-ambient-magic']).toBeUndefined();
    expect(content().actions['spit-ambient-magic']).toBeTruthy();
  });

  // batch 036: skill-mastery-rogue#maxtakable
  // AoN feat-5096: "**Special** You can select this feat up to five times." Absent maxTakable means
  // once — maxTakes() returns `feat.maxTakable ?? 1` — so four of the five takes were unreachable.
  it('feats/skill-mastery-rogue can be taken five times', () => {
    expect(content().feats['skill-mastery-rogue']?.maxTakable).toBe(5);
    expect(maxTakes(content().feats['skill-mastery-rogue'])).toBe(5);
    // The Investigator/Ranger printing of the same Special clause, already correct.
    expect(maxTakes(content().feats['skill-mastery'])).toBe(5);
  });

  // batch 036: golem-grafter-dedication
  // AoN feat-1227: "resistance to physical damage (except adamantine) equal to your number of class
  // feats from the golem grafter archetype." The exception was missing, so the sheet resisted it.
  it('feats/golem-grafter-dedication resists physical except adamantine', () => {
    const r = content().feats['golem-grafter-dedication']?.resistances ?? [];
    expect(r).toEqual([
      { type: 'physical', value: '@actor.archetypeFeats.golem-grafter', condition: 'except adamantine' },
    ]);
    /*
     * `condition`, not `against`: the number is real and always on (derive.ts counts it and renders
     * the clause beside it) — only its scope is unknowable from the sheet. Pinned against the sibling
     * that already gets this treatment so the two cannot drift apart.
     */
    const sib = (content().feats['stoney-skin']?.resistances ?? [])[0];
    expect(sib?.condition).toBe('except adamantine');
    expect(r[0]).not.toHaveProperty('against');
    // maxHpBonus rides on the same record and must survive the superseding row.
    expect(content().feats['golem-grafter-dedication']?.maxHpBonus).toEqual({ perLevel: 1 });
  });

  // batch 036: unravel-mysteries
  // AoN feat-1132: "you need only half as long as usual … and if you fail, you don't take the usual
  // -2 circumstance penalty to further checks to decipher that text." Neither clause reached anyone.
  it('feats/unravel-mysteries marks the Decipher Writing action', () => {
    const marks = content().feats['unravel-mysteries']?.recordMarks ?? [];
    const m = marks.find((x) => x.on === 'action' && x.id === 'decipher-writing');
    expect(m).toBeTruthy();
    expect(m?.note).toMatch(/half as long/i);
    expect(m?.note).toMatch(/-2 circumstance penalty/i);
    expect(content().actions['decipher-writing']).toBeTruthy();
  });

  // batch 036: spirit-walk#resistance
  // AoN feat-7137: "During your first turn in an encounter, you and allies in the aura have
  // resistance equal to half your level against damage dealt by haunts or spirits."
  it('feats/spirit-walk carries the first-turn haunt/spirit resistance', () => {
    const r = (content().feats['spirit-walk']?.resistances ?? [])[0];
    expect(r?.type).toBe('all');
    expect(r?.value).toBe('floor(@actor.level/2)');
    expect(r?.against).toMatch(/haunts or spirits/i);
    /*
     * `against`, never `condition`: derive.ts skips res.set for an `against` entry, which is what
     * keeps the headline IWR number honest — a first-turn-only resistance is not one the character
     * usually has. Same shape as modes/dampening-harmonics.
     */
    expect(r).not.toHaveProperty('condition');
    const sib = (content().modes?.['dampening-harmonics']?.resistances ?? [])[0];
    expect(sib?.against).toBeTruthy();
  });

  // batch 036: eye-of-the-unseen#innate-spell
  // AoN equipment-1367-1240: "**Frequency** once per day … The eye casts See the Unseen on you." The
  // item had the counter and the activation cost but no grant, so the spell never reached the sheet.
  it('items/eye-of-the-unseen casts See the Unseen once per day', () => {
    const item = content().items['eye-of-the-unseen'];
    expect(item?.innateSpells).toEqual([
      { spellId: 'see-the-unseen', tradition: 'arcane', rank: 2, usesPerDay: 1 },
    ]);
    // The invested-item walk (build.ts:8013) drops a grant naming a spell the catalog lacks.
    expect(content().spells['see-the-unseen']?.rank).toBe(2);
    // The printed Frequency the counter already models must stay in agreement with usesPerDay.
    expect(item?.frequency).toEqual({ max: 1, per: 'day' });
  });
});
