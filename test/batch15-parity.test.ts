import { describe, it, expect } from 'vitest';
import { build, prof, content } from './_content';
import { deriveStrikes, deriveSpeeds, deriveDefenses } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/*
 * BATCH 15 — the level-5/9 proficiency features their side encodes as a bare `adjValue`.
 *
 * These three carry no field of their own: the advance lives in `src/rules/advancement.ts`, which is a
 * different CARRIER, not a different answer. The parity comparer reads fields on the record, so a
 * mechanic held in a registry reads as missing — the failure mode the project keeps hitting. Before
 * settling any of them as equivalent, the rank has to be measured on a built character, because
 * "authored in a registry" and "reaching the sheet" are not the same claim.
 */
describe('batch 15 — proficiency features held in the advancement table', () => {
  it('Magical Fortitude: Fortitude expert at the level each class gains it', () => {
    /* Witch and sorcerer at 5th, wizard and oracle at 9th. */
    expect(prof(build('witch', 4), 'fortitude')).toBe('trained');
    expect(prof(build('witch', 5), 'fortitude')).toBe('expert');
    expect(prof(build('sorcerer', 5), 'fortitude')).toBe('expert');
    expect(prof(build('wizard', 8), 'fortitude')).toBe('trained');
    expect(prof(build('wizard', 9), 'fortitude')).toBe('expert');
    expect(prof(build('oracle', 9), 'fortitude')).toBe('expert');
  });

  it('Precognitive Reflexes: the psychic reaches Reflex expert at 5th', () => {
    expect(prof(build('psychic', 4), 'reflex')).toBe('trained');
    expect(prof(build('psychic', 5), 'reflex')).toBe('expert');
  });

  it('Unbreakable Expertise: the guardian reaches medium AND heavy armour expert at 5th', () => {
    /* *"Your proficiency rank with medium armor and heavy armor increases to expert."* Two tracks in
     * one sentence — half of it landing would look identical on the sheet's AC line for a guardian in
     * medium armour, and be wrong the moment they put on heavy. */
    expect(prof(build('guardian', 4), 'medium')).toBe('trained');
    expect(prof(build('guardian', 5), 'medium')).toBe('expert');
    expect(prof(build('guardian', 5), 'heavy')).toBe('expert');
  });
});

describe('batch 15 — Fighter Weapon Mastery elevates the group BY CATEGORY', () => {
  /*
   * *"Choose one weapon group. Your proficiency rank increases to MASTER with the simple weapons,
   * martial weapons, and unarmed attacks in that group, and to EXPERT with the ADVANCED weapons in
   * that group."*
   *
   * The advanced clause was skipped: a flat per-group rank covers the whole group, so an advanced
   * weapon of the chosen group rolled at master from 5th level — one rank above the book, for the
   * rest of the character's career, and invisible unless someone wielded one.
   */
  const db = content();
  const rankOf = (level: number, itemId: string, group: string) => {
    const f = build('fighter', level, { fighterWeaponGroup: group });
    const ch: Character = { ...f, inventory: [...f.inventory, { instanceId: 'w', itemId, quantity: 1, equipped: true }] };
    return deriveStrikes(ch, db).find((s) => s.instanceId === 'w')?.rank;
  };

  it('a martial weapon of the chosen group reaches master at 5th, legendary at 13th', () => {
    expect(rankOf(5, 'longsword', 'sword')).toBe('master');
    expect(rankOf(13, 'longsword', 'sword')).toBe('legendary');
  });

  it('an ADVANCED weapon of the chosen group lags exactly one rank', () => {
    expect(rankOf(5, 'flashblade', 'sword'), 'expert at 5th, not master').toBe('expert');
    expect(rankOf(13, 'flashblade', 'sword'), 'master at 13th, not legendary').toBe('master');
  });

  it('a weapon OUTSIDE the chosen group stays on the class chassis', () => {
    expect(rankOf(5, 'shortbow', 'sword')).toBe('expert');
  });
});

describe("batch 15 — Gate's Threshold really has both branches", () => {
  /*
   * *"At 5th level and every 4 levels thereafter, you choose to either expand the portal or fork the
   * path."* Their side encodes the branch as a `select` on the record; ours lives in BuildState as
   * `gateForks` / `gateExpands`, with the builder rendering both. A comparer that reads record fields
   * sees only our gate-junction picker and reports the branch missing.
   *
   * That is a carrier difference and it is being settled — so it has to be MEASURED, not asserted. A
   * branch stored in a field nobody reads would look exactly the same to the comparer.
   */
  it('Fork the Path adds a third element — mechanically AND on the sheet', () => {
    const plain = build('kineticist', 5, { extraChoices: { element: ['fire-gate', 'water-gate'] } } as never);
    const forked = build('kineticist', 5, {
      extraChoices: { element: ['fire-gate', 'water-gate'] },
      gateForks: { '5': 'air-gate' },
    } as never);

    /* Mechanically: Air Gate trains Stealth, and a fire/water kineticist has no other route to it (both of those train Intimidation and Athletics). */
    expect(plain.proficiencies.skills.stealth ?? 'untrained').toBe('untrained');
    expect(forked.proficiencies.skills.stealth, "the forked element's grants must apply").toBe('trained');

    /*
     * …and ON THE SHEET. The fork was folded into `grantOptions`, which is what carries the skill above,
     * but not into `classChoices`, which is the list the character actually displays — so a kineticist
     * who forked into Air had the element's grants and no air element anywhere on their sheet. The
     * two halves are separate readers, and only one of them had been taught about forks.
     */
    const elementsOf = (c: ReturnType<typeof build>) => new Set(c.classChoices?.map((o) => o.id) ?? []);
    expect(elementsOf(plain).has('air-gate')).toBe(false);
    expect(elementsOf(forked).has('air-gate'), 'the forked element must be visible, not just active').toBe(true);
  });

  it('Expand the Portal grants the chosen impulse feat — and forking instead does not', () => {
    const expanded = build('kineticist', 5, {
      extraChoices: { element: ['fire-gate', 'water-gate'] },
      gateExpands: { '5': 'flying-flame' },
    } as never);
    expect(expanded.feats.some((f) => f.featId === 'flying-flame'), 'the impulse feat is granted').toBe(true);

    /* The two branches are exclusive: a character who forked gets the element, not the bonus impulse. */
    const forked = build('kineticist', 5, {
      extraChoices: { element: ['fire-gate', 'water-gate'] },
      gateForks: { '5': 'air-gate' },
      gateExpands: { '5': 'flying-flame' },
    } as never);
    expect(forked.feats.some((f) => f.featId === 'flying-flame'), 'forking spends the same choice').toBe(false);
  });

  it('the gate JUNCTION belongs to Expand alone — forking withdraws the question and its grant', () => {
    const db = content();
    /*
     * *"Expand the Portal: … You also gain a gate junction."* Fork the Path grants none — and their
     * nesting says the same. The junction group used to be ungated, so a forked kineticist kept a
     * picker (and its answer's grant) the printed branch never gives them. `requiresNoGateFork`
     * carries the threshold LEVEL because all four Gate's Threshold records share the choice id
     * 'gate-junction', and the shared `effectChoiceOffered` predicate never sees the recordId.
     */
    const base = {
      extraChoices: { element: ['fire-gate', 'water-gate'] },
      effectChoices: { 'gates-threshold:gate-junction': 'air-elemental-resistance' },
    };
    const expanded = build('kineticist', 5, base as never);
    const forked = build('kineticist', 5, { ...base, gateForks: { '5': 'air-gate' } } as never);
    const resOf = (c: ReturnType<typeof build>) => deriveDefenses(c, db).resistances.some((r) => r.type === 'air');
    /* MEASURED on the built character, both grant shapes, both directions. */
    expect(resOf(expanded), 'Expand keeps the junction resistance').toBe(true);
    expect(resOf(forked), 'Fork must drop the stale junction answer').toBe(false);

    const skillBase = {
      extraChoices: { element: ['fire-gate', 'water-gate'] },
      effectChoices: { 'gates-threshold:gate-junction': 'air-skill-junction' },
    };
    const expandedSkill = build('kineticist', 5, skillBase as never);
    expect(expandedSkill.proficiencies.skills.stealth, 'the skill junction trains Stealth on Expand').toBe('trained');
    /* ⚠ Air Gate itself trains Stealth — a forked control into AIR would gain it from the ELEMENT, so
     * the control forks into EARTH instead. */
    const forkedEarth = build('kineticist', 5, { ...skillBase, gateForks: { '5': 'earth-gate' } } as never);
    expect(forkedEarth.proficiencies.skills.stealth ?? 'untrained', 'Fork withdraws the junction skill').toBe('untrained');
  });
});

describe('batch 15 — a climb Speed gated on ANOTHER FEAT', () => {
  /*
   * *"You gain a climb Speed of 10 feet. If you also have the Cave Climber ancestry feat, your total
   * climb Speed increases to your land Speed."*
   *
   * `speedsIf` could gate on a skill rank or a heritage and not on a FEAT, so the second sentence of
   * four records reached nothing: the holder had 10 feet whether or not they had paid for the feat
   * that upgrades it.
   */
  const db = content();
  const climbOf = (feats: string[]) => {
    const c = build('fighter', 5, { featPicks: Object.fromEntries(feats.map((f, i) => [`${i + 1}:ancestry`, f])) } as never);
    return deriveSpeeds(c, db).climb;
  };

  it('the base grant alone is 10 feet', () => {
    expect(climbOf(['tree-climber-goblin'])).toBe(10);
  });

  it('…and with the named feat it rises to the land Speed', () => {
    const both = climbOf(['tree-climber-goblin', 'cave-climber']);
    expect(both, 'the upgrade must beat the base 10').toBeGreaterThan(10);
    expect(both).toBe(build('fighter', 5).speeds?.land ?? 25);
  });
});

describe('batch 15 — Martial Experience', () => {
  /*
   * *"When wielding a weapon you aren't proficient with, treat your level as your proficiency bonus.
   * At 11th level, you become trained in all weapons."*
   *
   * Neither sentence reached anything: the untrained-proficiency lane covered SKILLS only, so a
   * character with this feat swung an unfamiliar weapon at a flat +0 for ten levels.
   */
  const db = content();
  const withFeat = (level: number, take: boolean) => {
    const base = build('wizard', level, take ? ({ featPicks: { '5:general': 'martial-experience' } } as never) : {});
    return { ...base, inventory: [...base.inventory, { instanceId: 'w', itemId: 'greatsword', quantity: 1, equipped: true }] } as Character;
  };
  const attackOf = (ch: Character) => deriveStrikes(ch, db).find((s) => s.instanceId === 'w')?.attack?.[0];

  it('an untrained weapon gains the character LEVEL as its proficiency bonus', () => {
    const plain = withFeat(5, false);
    const armed = withFeat(5, true);
    expect(deriveStrikes(plain, db).find((s) => s.instanceId === 'w')?.rank, 'a wizard is untrained with a greatsword').toBe('untrained');
    expect(attackOf(armed)! - attackOf(plain)!, 'level 5 in place of the untrained 0').toBe(5);
  });

  it('…and at 11th the character really is TRAINED, not merely rolling as if', () => {
    /* The difference matters beyond the number: anything gated on being trained with the weapon —
     * critical specialization, a feat's prerequisite — turns on the RANK, not on the bonus. */
    expect(deriveStrikes(withFeat(10, true), db).find((s) => s.instanceId === 'w')?.rank).toBe('untrained');
    expect(deriveStrikes(withFeat(11, true), db).find((s) => s.instanceId === 'w')?.rank).toBe('trained');
  });
});
