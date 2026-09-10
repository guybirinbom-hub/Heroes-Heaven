import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveAnimalCompanion } from '../src/rules/companions';
import { companionModKeys } from '../src/rules/companionGrants';
import type { CompanionConfig, ContentDatabase, WeaponRider } from '../src/rules/types';

/*
 * Batch 036, WG-comparison lane — GATE-RED triage group "parked-lanes-and-desk".
 *
 * This group builds nothing: every item is a PARK or a desk confirmation. What it owes is a MEASURE,
 * and this file is where the measure lives so that it cannot rot into prose. Both assertions read the
 * SHIPPED content (the engine family's `effectChoices` row is already applied), and the second one
 * reads a BUILT construct inventor and the companion block the Companions tab derives from it.
 *
 * When either `it` here fails, the parked lane has MOVED — a new payload-bearing modification landed,
 * or somebody built the companion-strike rider lane. Both are re-triage events, not test bugs: fix
 * the number (or delete this file) together with the residual entry it measures.
 */
const db: ContentDatabase = content();

/** The eleven initial weapon modifications `advanced-weaponry-construct` offers the player. */
const OFFERED = (db.classFeatures['advanced-weaponry-construct'].effectChoices ?? [])
  .find((c) => c.id === 'modification')!
  .options!.map((o) => String(o.value));

const ridersOf = (id: string): WeaponRider[] => {
  const wt = db.classFeatures[id]?.weaponTraits;
  return wt == null ? [] : Array.isArray(wt) ? wt : [wt];
};

describe('advanced-weaponry-construct: the companion-strike rider lane, measured while it stays parked', () => {
  /*
   * *"Choose one of your construct's unarmed attacks to gain your choice of one initial weapon
   * modification."* The answer is recorded and shown (engine family, batch 036) and grants nothing,
   * because a modification's `weaponTraits` rider is scoped `match.designated: 'innovation'` and
   * `applyWeaponRiders` walks INVENTORY WeaponItems — a construct's unarmed attacks are companion
   * rows and reach neither. The park is honest only if the lane's WIDTH is known, which is what this
   * measures: of the eleven options, four carry a machine payload and the other seven grant nothing
   * to anybody, construct or not. So the residual is n=4, not n=1.
   */
  // batch 036: advanced-weaponry-construct
  it('exactly four of advanced-weaponry-construct\'s eleven options carry a payload, and every one of them is innovation-designated', () => {
    expect(OFFERED).toHaveLength(11);
    const withPayload = OFFERED.filter((id) => ridersOf(id).length > 0);
    expect(withPayload.sort()).toEqual(['hampering-spikes', 'hefty-composition', 'modular-head', 'razor-prongs']);
    // Every payload is scoped to the designated INNOVATION — which is why none of them can reach a
    // companion's unarmed attack, and why widening the lane is one engine change, not four.
    for (const id of withPayload) for (const r of ridersOf(id)) expect(r.match?.designated).toBe('innovation');
    // The other seven carry no rider at all: they are prose for every inventor, not a construct-only loss.
    for (const id of OFFERED.filter((x) => !withPayload.includes(x))) expect(ridersOf(id)).toHaveLength(0);
  });

  /*
   * The park itself, on a BUILT character: the player answers Razor Prongs, the answer is stored, and
   * the construct's attacks still carry none of *"tearing, trip, versatile-s"*. This is the tripwire —
   * it goes red the day a companion-strike rider lane lands, which is exactly when the residual entry
   * for this gap should be retired.
   */
  // batch 036: advanced-weaponry-construct
  it('a construct inventor who chose razor-prongs on advanced-weaponry-construct records the pick and the construct gains none of its traits', () => {
    const over: Partial<BuildState> = {
      name: 't',
      level: 7,
      classId: 'inventor',
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      subclassId: 'construct-innovation',
      inventorModifications: { breakthrough: 'advanced-weaponry-construct' },
      effectChoices: { 'advanced-weaponry-construct:modification': 'razor-prongs' },
    };
    const ch = buildCharacter({ ...emptyBuild(), ...over } as BuildState, db);
    expect(ch.effectPicks?.find((p) => p.recordId === 'advanced-weaponry-construct')?.label).toBe('Razor Prongs');

    // Derived exactly the way src/sheet/CompanionsTab.tsx:1731 derives it.
    const cfg: CompanionConfig = { id: 'c', kind: 'animal', name: '', typeId: 'construct-companion', maturity: 'mature' };
    const block = deriveAnimalCompanion(cfg, db.animalCompanions['construct-companion'], ch.level, db, [], false, [], companionModKeys(ch.feats));
    expect(block.attacks.length).toBeGreaterThan(0);
    for (const t of ridersOf('razor-prongs')[0].add ?? []) expect(block.attacks.flatMap((a) => a.traits)).not.toContain(t);
  });
});
