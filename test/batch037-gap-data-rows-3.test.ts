import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';

/*
 * BATCH 037 — WG-comparison lane, GAP agent for family data-rows-3.
 *
 * Three lanes the chunk's builder listed as CROSS-FILE GAPS and could not reach from a data row:
 *   · armor-in-earth / hardwood-armor — the granted armour borrows the wearer's best armour
 *     proficiency (src/rules/featGrants.ts, the shipped armorFamiliarity.mirrorBest lane);
 *   · intuitive-crafting — the free skill belongs to the THIRD printed branch only
 *     (src/rules/featGrants.ts `redundantFallbackIfFeat` + its reader in src/rules/build.ts);
 *   · armigers-protection — the suit the player PICKED is the one that lands in inventory
 *     (src/rules/types.ts `grantsItems[].whenChoice` + its reader in src/rules/build.ts).
 *
 * The first two are code-only and read the SHIPPED content. The third needs the grantsItems row in
 * work/.b037-rows-gap-data-rows-3.json and the choice row in work/.b037-rows-data-rows-3.json, so it
 * patches both fields IN MEMORY to exactly the values those rows carry — never a patched-vs-shipped
 * delta, and the same assertion holds once the driver applies them.
 */
const db = content();

/* ================================================================== *
 * armor-in-earth / hardwood-armor — "uses your highest armor proficiency"
 * ================================================================== */

/** A kineticist whose bonus impulse (Expand the Portal) is the named armour feat. */
const impulseKin = (impulse: string, level = 5): Character =>
  build('kineticist', level, {
    keyAbility: 'con',
    extraChoices: { element: ['earth-gate', 'wood-gate'] },
    gateExpands: { '5': impulse },
  } as never) as Character;

describe('armor-in-earth: the stone armour uses the kineticist\'s highest armour proficiency', () => {
  // batch 037: armor-in-earth#armour-proficiency
  it('armor-in-earth borrows the best armour rank onto both granted suits and trains no new category', () => {
    /* feat-4221: *"Stone encases you like armor. The stone armor is medium armor but uses your
     * HIGHEST armor proficiency."* At 3rd level it becomes heavy armour, and no sentence anywhere
     * trains the kineticist in medium or heavy armour — so the borrow is per ITEM, never per track. */
    const ch = impulseKin('armor-in-earth');
    expect(ch.feats.some((f) => f.featId === 'armor-in-earth'), 'the impulse has to be held').toBe(true);
    const best = ch.proficiencies.defenses.light;
    expect(best, 'a kineticist is trained in light armour, which is the rank to borrow').not.toBe('untrained');
    expect(ch.proficiencies.armorOverrides?.['armor-in-earth-medium']).toBe(best);
    expect(ch.proficiencies.armorOverrides?.['armor-in-earth-heavy']).toBe(best);
    // …and NOT WG's shortcut, which trains the wearer in the category and so lets them wear real plate.
    expect(ch.proficiencies.defenses.medium, 'no medium training').toBe('untrained');
    expect(ch.proficiencies.defenses.heavy, 'no heavy training').toBe('untrained');
  });

  // batch 037: armor-in-earth#armour-proficiency
  it('armor-in-earth grants nothing to a kineticist who never took the impulse', () => {
    const without = build('kineticist', 5, {
      keyAbility: 'con',
      extraChoices: { element: ['earth-gate', 'wood-gate'] },
    } as never) as Character;
    expect(without.proficiencies.armorOverrides?.['armor-in-earth-medium']).toBeUndefined();
  });
});

describe('hardwood-armor: the same borrow, on the one armour feat-4283 prints', () => {
  // batch 037: hardwood-armor-armor#armour-proficiency
  it('hardwood-armor borrows onto hardwood-armor-armor and leaves the shield alone', () => {
    /* feat-4283: *"Wood and bark grow over your body like armor. This hardwood armor is medium armor
     * but uses your HIGHEST armor proficiency."* The feat's other granted item is a SHIELD — it has
     * no armour proficiency to borrow — and there is no heavy version of this armour. */
    const ch = impulseKin('hardwood-armor');
    expect(ch.feats.some((f) => f.featId === 'hardwood-armor'), 'the impulse has to be held').toBe(true);
    expect(ch.proficiencies.armorOverrides?.['hardwood-armor-armor']).toBe(ch.proficiencies.defenses.light);
    expect(ch.proficiencies.armorOverrides?.['hardwood-armor-shield']).toBeUndefined();
    expect(ch.proficiencies.defenses.medium).toBe('untrained');
  });
});

/* ================================================================== *
 * intuitive-crafting — three printed branches, not two
 * ================================================================== */

/** Did the record's redundant static Crafting grant turn into a free replacement skill pick? */
const craftingFallback = (ch: Character): boolean =>
  (ch.skillFallbacks ?? []).some((f) => f.featId === 'intuitive-crafting' && f.skill === 'crafting');

describe('intuitive-crafting: the free skill belongs to the both-already-held branch alone', () => {
  /*
   * feat-7200: *"You are trained in Crafting. If you were already trained in Crafting, you INSTEAD
   * gain the Specialty Crafting skill feat in a specialty of your choice; IF YOU HAVE BOTH, you
   * instead become trained in a skill of your choice."*
   */
  // batch 037: intuitive-crafting#middle-case
  it('intuitive-crafting: already trained in Crafting, no Specialty Crafting — the feat ONLY', () => {
    const ch = build('alchemist', 3, { featPicks: { '1:ancestry': 'intuitive-crafting' } } as never) as Character;
    expect(ch.proficiencies.skills.crafting, 'the alchemist came in trained').not.toBe('untrained');
    expect(ch.feats.some((f) => f.featId === 'specialty-crafting'), 'the middle branch hands over the feat').toBe(true);
    expect(craftingFallback(ch), 'and NOT a free skill on top of it').toBe(false);
  });

  // batch 037: intuitive-crafting#middle-case
  it('intuitive-crafting: already holding Specialty Crafting too — now the free skill is owed', () => {
    const ch = build('alchemist', 3, {
      featPicks: { '1:skill': 'specialty-crafting', '1:ancestry': 'intuitive-crafting' },
    } as never) as Character;
    expect(craftingFallback(ch), 'the third printed branch').toBe(true);
  });

  // batch 037: intuitive-crafting#middle-case
  it('intuitive-crafting: untrained in Crafting — the first branch still just trains Crafting', () => {
    const ch = build('fighter', 3, { featPicks: { '1:ancestry': 'intuitive-crafting' } } as never) as Character;
    expect(ch.proficiencies.skills.crafting).not.toBe('untrained');
    expect(craftingFallback(ch), 'nothing redundant, nothing to replace').toBe(false);
  });
});

/* ================================================================== *
 * armigers-protection — ONE suit, the one the player picked
 * ================================================================== */

/** The two rows this lane needs, verbatim from the specs, patched onto a content copy. */
const ARMIGER_GRANTS_ITEMS = [
  { itemId: 'hellknight-breastplate', whenChoice: 'hellknight-breastplate' },
  { itemId: 'hellknight-half-plate', whenChoice: 'hellknight-half-plate' },
  { itemId: 'hellknight-plate', whenChoice: 'hellknight-plate' },
];
const ARMIGER_CHOICE = {
  flag: 'hellknightDedication',
  prompt: 'Your free non-magical suit of Hellknight armor',
  kind: 'array',
  options: [
    { value: 'hellknight-breastplate', label: 'Hellknight Breastplate' },
    { value: 'hellknight-half-plate', label: 'Hellknight Half Plate' },
    { value: 'hellknight-plate', label: 'Hellknight Plate' },
  ],
};

/** `db` with the two rows applied, so the mechanic is exercised on the value the driver will write. */
const armigerDb = (): ContentDatabase => ({
  ...db,
  feats: {
    ...db.feats,
    'armigers-protection': { ...db.feats['armigers-protection'], grantsItems: ARMIGER_GRANTS_ITEMS, choice: ARMIGER_CHOICE },
  },
} as ContentDatabase);

const armiger = (answer: string | undefined, cdb: ContentDatabase): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level: 4,
      classId: 'fighter',
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: 'str',
      featPicks: { '2:class': 'hellknight-dedication', '4:class': 'armigers-protection' },
      ...(answer ? { featChoices: { '4:class': answer } } : {}),
    } as unknown as BuildState,
    cdb,
  );

const suits = (c: Character) =>
  (c.inventory ?? [])
    .map((i) => (i as { itemId: string }).itemId)
    .filter((id) => id.startsWith('hellknight-'));

describe('armigers-protection: the free suit is the one the player picked', () => {
  /*
   * feat-8814: *"In addition, when you choose this feat, you receive a non-magical suit of Hellknight
   * armor OF A TYPE YOU BECOME TRAINED IN (Hellknight breastplate, Hellknight half plate, or
   * Hellknight plate)."* One suit out of three. The shipped `grantsItems` was unconditional, so every
   * taker got the breastplate whichever of the three the picker recorded.
   */
  // batch 037: armigers-protection#armor-pick
  it('armigers-protection hands over the half plate when the half plate is the answer', () => {
    const ch = armiger('hellknight-half-plate', armigerDb());
    expect(ch.feats.some((f) => f.featId === 'armigers-protection'), 'the feat has to be held').toBe(true);
    expect(suits(ch)).toEqual(['hellknight-half-plate']);
  });

  // batch 037: armigers-protection#armor-pick
  it('armigers-protection hands over the breastplate when the breastplate is the answer', () => {
    expect(suits(armiger('hellknight-breastplate', armigerDb()))).toEqual(['hellknight-breastplate']);
  });

  // batch 037: armigers-protection#armor-pick
  it('armigers-protection hands over nothing until the player answers — a real either/or', () => {
    /* Not a printed default with an escape hatch: putting a suit nobody chose in the inventory is the
     * failure this gate exists to end, and the picker is visible on the Builder's feat card. */
    expect(suits(armiger(undefined, armigerDb()))).toEqual([]);
  });

  // batch 037: armigers-protection#armor-pick
  it('armigers-protection: an UNGATED grantsItems is what the old behaviour was — the gate is alive', () => {
    /* The control that keeps the two rows honest: strip `whenChoice` from the patched copy and the
     * breastplate comes back on a character who asked for the plate, which is the shipped defect. */
    const ungated = {
      ...db,
      feats: {
        ...db.feats,
        'armigers-protection': {
          ...db.feats['armigers-protection'],
          choice: ARMIGER_CHOICE,
          grantsItems: ARMIGER_GRANTS_ITEMS.map(({ itemId }) => ({ itemId })),
        },
      },
    } as ContentDatabase;
    expect(suits(armiger('hellknight-plate', ungated))).toContain('hellknight-breastplate');
  });
});
