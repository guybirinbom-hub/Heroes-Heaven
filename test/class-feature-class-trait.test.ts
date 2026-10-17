import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * PACKAGE I ITEM I14 — A CLASS FEATURE CARRIES ITS CLASS'S TRAIT.
 *
 * Every class feature that exactly ONE class's feature table lists carries that class's id in `traits`
 * ("wizard" on Arcane School, "fighter" on Bravery). 26 did not: the 14 necromancer and 10 runesmith
 * features (authored in work/new-classes/*.json, which never stated traits, so the record had no
 * `traits` key at all) and two AoN-imported ones whose list was `[]` (bard/performers-heart,
 * swashbuckler/stylish-combatant). AoN's class-feature pages print no trait line — the only class marker
 * is the document's `class` field — so the class trait is the app's own tag. It feeds the Feats-tab chip
 * (FeatsTab.tsx `e.traits.slice(0, 3)`) and the search box, so a necromancer's Grave Spells showed no
 * chip and searching "necromancer" missed it.
 *
 * The fix is 26 overlay rows (work/package-i/small-fixes.json, finding I14), which survive `npm run data`
 * because import-new-classes.mjs re-applies the overlay over the records it merges and import-core-v2.mjs
 * applies it to the two AoN-imported ones. THIS TEST is the guard: it reads the shipped public/core.json
 * (raw, before the app's ensureTraits normalisation would paper over a missing key) and fails, naming
 * `class/feature`, for any single-class feature without its class's trait — so a third authored class that
 * states no traits cannot ship the same way.
 *
 * Scope, on purpose: SINGLE-class features only. A feature several classes list (weapon-specialization,
 * perception-expertise) cannot carry "its" class; 9 such class gaps exist today (weapon-specialization
 * lacks barbarian/monk/oracle/guardian/thaumaturge, greater-weapon-specialization lacks guardian,
 * perception-expertise and reflex-expertise lack inventor, perception-legend lacks investigator). Those
 * are not print-vs-WG differences (print shows no traits) and are left for chat-todo, not asserted here.
 */

interface CoreShape {
  classes: Record<string, { features?: { featureId: string }[] }>;
  classFeatures: Record<string, { traits?: string[] } | undefined>;
}

/** `class/feature` for every feature exactly one class lists that does not carry that class's id. */
export function featuresMissingOwnClassTrait(core: CoreShape): string[] {
  const owners = new Map<string, Set<string>>();
  for (const [classId, cls] of Object.entries(core.classes)) {
    for (const f of cls.features ?? []) {
      if (!owners.has(f.featureId)) owners.set(f.featureId, new Set());
      owners.get(f.featureId)!.add(classId);
    }
  }
  const missing: string[] = [];
  for (const [featureId, classes] of owners) {
    if (classes.size !== 1) continue;
    const [classId] = [...classes];
    if (!(core.classFeatures[featureId]?.traits ?? []).includes(classId)) missing.push(`${classId}/${featureId}`);
  }
  return missing.sort();
}

const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as CoreShape;

describe('package I item I14: a single-class feature carries its class trait', () => {
  it('every feature one class lists has that class id in its traits (necromancer and runesmith were bare)', () => {
    expect(featuresMissingOwnClassTrait(core), 'class/feature pairs with no class trait').toEqual([]);
  });

  it('the four classes the measurement named are covered by name, not just by the loop', () => {
    const cf = core.classFeatures;
    expect(cf['grave-spells']?.traits).toContain('necromancer');
    expect(cf['runic-repertoire']?.traits).toContain('runesmith');
    expect(cf['performers-heart']?.traits).toContain('bard');
    expect(cf['stylish-combatant']?.traits).toContain('swashbuckler');
  });

  // mutation-proof: delete a trait from a real single-class feature and the guard must name it.
  it('names a feature whose class trait is removed (mutation: wizard loses a trait)', () => {
    const wizardOnly = (core.classes.wizard?.features ?? [])
      .map((f) => f.featureId)
      .find((id) => core.classFeatures[id]?.traits?.includes('wizard') && Object.values(core.classes).filter((c) => c.features?.some((x) => x.featureId === id)).length === 1);
    expect(wizardOnly, 'a feature only wizard lists, to plant the mutation on').toBeTruthy();
    const mutated: CoreShape = {
      classes: core.classes,
      classFeatures: { ...core.classFeatures, [wizardOnly!]: { ...core.classFeatures[wizardOnly!], traits: [] } },
    };
    expect(featuresMissingOwnClassTrait(mutated)).toEqual([`wizard/${wizardOnly}`]);
  });

  // mutation-proof: the necromancer shape — a record with no `traits` key at all.
  it('names a feature with no traits key at all, and a class authored without traits', () => {
    const bare: CoreShape = {
      classes: { newclass: { features: [{ featureId: 'new-thing' }, { featureId: 'shared-thing' }] }, other: { features: [{ featureId: 'shared-thing' }] } },
      classFeatures: { 'new-thing': {}, 'shared-thing': {} },
    };
    // 'shared-thing' is listed by two classes, so it is out of scope; 'new-thing' is the necromancer shape.
    expect(featuresMissingOwnClassTrait(bare)).toEqual(['newclass/new-thing']);
    bare.classFeatures['new-thing'] = { traits: ['newclass'] };
    expect(featuresMissingOwnClassTrait(bare)).toEqual([]);
  });
});
