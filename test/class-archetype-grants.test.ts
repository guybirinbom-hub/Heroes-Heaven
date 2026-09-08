import { describe, expect, it } from 'vitest';
import { build, content, prof } from './_content';
import { advancementRows } from '../src/rules/advancement';
import type { Character } from '../src/rules/types';

/*
 * A CLASS ARCHETYPE restructures the class: it takes class features away and substitutes its own.
 * Two lanes read that restructuring far too late to matter, and both are covered here:
 *   - the FEAT-GRANT loop, which honoured subclass suppression only, so a Warrior of Legend fighter
 *     — *"You don't gain Shield Block as a class feature"* (AoN archetype-286) — still held the feat
 *     the removed feature grants, and a War Mage wizard — *"You gain the war magic class feature at
 *     1st level"* (AoN archetype-331), whose record grants Shield Block — got nothing from it;
 *   - the class ADVANCEMENT rows, which are keyed by source feature (see advancement.test.ts).
 */

const hasFeat = (ch: Character, id: string) => ch.feats.some((f) => f.featId === id);
const db = () => content();

/** Every class archetype we ship, with the class it restructures. */
function archetypes() {
  const out: { carrier: string; classId: string; name: string; suppress: string[]; add: { level: number; featureId: string }[] }[] = [];
  for (const [id, rec] of Object.entries(db().feats)) {
    const ca = rec.classArchetype;
    if (!ca) continue;
    const classes = Array.isArray(ca.classId) ? ca.classId : [ca.classId];
    out.push({ carrier: id, classId: classes[0], name: rec.name, suppress: ca.suppressFeatures ?? [], add: ca.addFeatures ?? [] });
  }
  return out;
}

const withArchetype = (classId: string, level: number, carrier: string, over = {}) =>
  build(classId, level, { featPicks: { '2:class': carrier }, ...over });

describe('class archetype feat grants', () => {
  it('a Warrior of Legend fighter loses the Shield Block feat its removed feature granted', () => {
    const ch = withArchetype('fighter', 5, 'warrior-of-legend-dedication');
    expect(ch.classArchetype?.suppressedFeatures).toContain('shield-block');
    expect(hasFeat(ch, 'shield-block')).toBe(false);
    // …and the armour cap still holds: *"You aren't trained in heavy armor."*
    expect(prof(ch, 'heavy')).toBe('untrained');
    // The archetype's own added feature still grants what it grants: *"You gain Diehard as a bonus feat."*
    expect(hasFeat(ch, 'diehard')).toBe(true);
  });

  it('a plain fighter keeps Shield Block', () => {
    const ch = build('fighter', 5);
    expect(hasFeat(ch, 'shield-block')).toBe(true);
  });

  it('a War Mage wizard gains war magic and the Shield Block feat it grants', () => {
    const ch = withArchetype('wizard', 5, 'war-mage-dedication', { subclassId: 'school-of-battle-magic' });
    expect(ch.classArchetype?.addedFeatures.map((a) => a.featureId)).toContain('war-magic');
    expect(hasFeat(ch, 'shield-block')).toBe(true);
    // *"You become trained in light and medium armor."*
    expect(prof(ch, 'light')).toBe('trained');
    expect(prof(ch, 'medium')).toBe('trained');
  });

  it('a plain wizard gets neither', () => {
    const ch = build('wizard', 5);
    expect(hasFeat(ch, 'shield-block')).toBe(false);
    expect(prof(ch, 'medium')).toBe('untrained');
  });

  /*
   * BLAST RADIUS. Both halves of the fix are data-driven, so every shipped archetype is walked rather
   * than the two that were measured: the six that suppress a feature must not hand out a feat from
   * one, and every archetype that adds features must deliver what those features grant.
   */
  it('no archetype hands out a feat from a feature it suppresses', () => {
    const offenders: string[] = [];
    for (const a of archetypes()) {
      if (!a.suppress.length) continue;
      const ch = withArchetype(a.classId, 20, a.carrier);
      for (const f of ch.feats) if (f.grantedBy && a.suppress.includes(f.grantedBy)) offenders.push(`${a.name}: ${f.featId} from ${f.grantedBy}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every archetype delivers the feats its added features grant', () => {
    const missing: string[] = [];
    for (const a of archetypes()) {
      if (!a.add.length) continue;
      const ch = withArchetype(a.classId, 20, a.carrier);
      for (const af of a.add) {
        for (const gid of db().classFeatures[af.featureId]?.grantsFeats ?? []) {
          if (!hasFeat(ch, gid)) missing.push(`${a.name}: ${af.featureId} → ${gid}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('class archetype advancement rows', () => {
  /* *"You don't gain the Resolute Faith class feature"* (AoN archetype-304) — and the cleric table's
   * master Will at 9th is sourced from `resolute-faith`. The doctrine here is Warpriest, whose own
   * table restates that row; Battle Creed's table never carried it. */
  it('a Battle Harbinger cleric does not reach master Will at 9', () => {
    const ch = withArchetype('cleric', 9, 'battle-harbinger-dedication', { subclassId: 'warpriest' });
    expect(ch.classArchetype?.suppressedFeatures).toContain('resolute-faith');
    expect(prof(ch, 'will')).toBe('expert');
  });

  it('a plain cleric still reaches master Will at 9', () => {
    expect(prof(build('cleric', 9, { subclassId: 'warpriest' }), 'will')).toBe('master');
    expect(prof(build('cleric', 9, { subclassId: 'cloistered-cleric' }), 'will')).toBe('master');
  });

  /* *"You do not gain the defensive robes feature at 13th level."* The wizard table's unarmoured
   * expert at 13 is sourced from `defensive-robes`, so the ROW is gone — asserted on the table
   * itself, because the RANK is no longer evidence of it: the archetype's own 11th-level step
   * (below) already made it expert. */
  it('the defensive-robes row leaves the wizard table when the feature is suppressed', () => {
    expect(advancementRows('wizard').some((e) => e.source === 'defensive-robes')).toBe(true);
    expect(advancementRows('wizard', null, ['defensive-robes']).some((e) => e.source === 'defensive-robes')).toBe(false);
  });

  /* *"At 11th level, you gain expert proficiency with light and medium armor, as well as unarmored
   * defense"* (archetype-331), carried by `classArchetype.armorAt`. The suppressed defensive-robes
   * row is the ONLY unarmoured step the wizard table has, so without this a level-11+ War Mage was
   * left trained in all three — worse than before the suppression landed. */
  it('a War Mage wizard takes the archetype 11th-level armour step, not before', () => {
    const at10 = withArchetype('wizard', 10, 'war-mage-dedication', { subclassId: 'school-of-battle-magic' });
    expect([prof(at10, 'unarmored'), prof(at10, 'light'), prof(at10, 'medium')]).toEqual(['trained', 'trained', 'trained']);
    const at11 = withArchetype('wizard', 11, 'war-mage-dedication', { subclassId: 'school-of-battle-magic' });
    expect([prof(at11, 'unarmored'), prof(at11, 'light'), prof(at11, 'medium')]).toEqual(['expert', 'expert', 'expert']);
    // …and a plain wizard of the same school gains none of it (the school is selectable without the
    // archetype, which is why the step cannot live in a class-advancement table).
    const plain = build('wizard', 11, { subclassId: 'school-of-battle-magic' });
    expect([prof(plain, 'unarmored'), prof(plain, 'light'), prof(plain, 'medium')]).toEqual(['trained', 'untrained', 'untrained']);
  });
});
