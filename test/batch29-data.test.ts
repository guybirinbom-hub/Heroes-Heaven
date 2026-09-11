import { describe, it, expect } from 'vitest';
import { content } from './_content';

const db = content();

/**
 * Wanderer's-Guide parity batch 29 — the DATA half (item records, one created weapon record, one
 * created mode, the graft trait family sweep, three description repairs and the magus's studious
 * spell slots). Every assertion pins an authored field against the printed sentence that required
 * it, quoted in the test name, so a regeneration that drops the overlay row fails here rather than
 * silently returning the record to its pre-batch shape.
 *
 * These read the SHIPPED content through `content()` (public/core.json merged with
 * public/core-descriptions.json, exactly as the app loads it). The rows are authored in
 * scripts/data/effect-backfill.json and only exist once the orchestrator has applied
 * work/.b029-rows.json, so this file is red until then — deliberately: an assertion written against a
 * locally patched copy would pass on a machine where the row never landed.
 *
 * Three findings additionally need an ENGINE half that is NOT data, and each is named at its test:
 *   • items/spined-shield's `grantedStrikes` is inert until the item arm of the strike collector
 *     (build.ts:2608, `for (const itemId of investedItemIds)`) also walks HELD/equipped items — a
 *     spined shield is never invested.
 *   • `spellSlotBonus.tradition` needs the tradition gate in `slotEntryFor` (build.ts ~6810).
 *   • `resonant.resistances` needs the wayfinder-slotted fold in derive.ts's item-defence pass.
 * The magus SLOT TABLE is untouched by this batch (owner question #104): the rows below author only
 * the two RESTRICTED studious slots print states, and never a count of ordinary magus slots.
 */

/** Untyped view of a record, for fields whose lane interface does not declare them yet. */
const raw = (rec: unknown) => rec as unknown as Record<string, unknown>;
const item = (id: string) => db.items[id]!;
const desc = (id: string) => item(id).description ?? '';

describe('batch 29 — spined shield', () => {
  /* equipment-2827: "The spines are +1 striking shield spikes." The shield granted no weapon at all,
   * so its only printed offensive capability was invisible on the sheet. */
  it('grants its spikes and its Fire Spine as real inventory weapons', () => {
    expect(raw(item('spined-shield')).grantsItems).toEqual([{ itemId: 'spined-shield-spikes' }, { itemId: 'spined-shield-fire-spine' }]);
  });

  it('the granted spikes are a martial 1d6 piercing shield-group weapon carrying +1 striking', () => {
    const spikes = db.items['spined-shield-spikes'];
    expect(spikes, 'created record').toBeTruthy();
    expect(spikes!.itemType).toBe('weapon');
    expect(spikes!.category).toBe('martial');
    expect(spikes!.group).toBe('shield');
    expect(spikes!.damage).toEqual({ dice: 1, die: 'd6', type: 'piercing' });
    // The printed fundamentals, in the shape 263 items already ship (items/eclipse is the twin).
    expect(spikes!.builtInRunes).toEqual({ potency: 1, striking: 'striking' });
    // Granted with the shield, never bought: `formOf` is what keeps a non-purchasable usage record
    // out of every picker (findCombinationFormIds, src/data/index.ts:424) while leaving it resolvable.
    expect(raw(spikes).formOf).toBe('spined-shield');
  });

  /* "You shoot one of the shield's spines at a target. A fired spine uses the spikes' statistics, but
   * it's a martial ranged weapon with a range increment of 120 feet." Carried as a second GRANTED WEAPON
   * record, not a grantedStrikes entry: a granted strike has no proficiency category and no rune carrier,
   * so it would roll at UNARMED proficiency, miss the +1 striking, and be buffed by Handwraps of Mighty
   * Blows (measured by the engine verifier). A weapon record rolls at martial with its runes. */
  it('Fire Spine is a martial ranged weapon record with the spikes\' statistics and a 120-foot range', () => {
    const fire = db.items['spined-shield-fire-spine'];
    expect(fire, 'created record').toBeTruthy();
    expect(fire!.itemType).toBe('weapon');
    expect(fire!.category).toBe('martial');
    expect(fire!.range).toBe(120);
    expect(fire!.damage).toEqual({ dice: 1, die: 'd6', type: 'piercing' });
    expect(fire!.builtInRunes).toEqual({ potency: 1, striking: 'striking' });
    expect(raw(fire).formOf).toBe('spined-shield');
    expect(item('spined-shield').grantedStrikes).toBeUndefined();
  });

  /* "one spine snaps off per 6 damage… When all the spines are gone, you lose the ability to attack
   * with them until the spines regenerate the next day." Five spines, spent one at a time, back the
   * next day — the counters lane (itemUses.ts counterDefs → ItemDetail pips), not prose. */
  it('tracks its five spines as a per-day counter', () => {
    expect(raw(item('spined-shield')).counters).toEqual([
      { id: 'spines', label: 'spines', max: 5, per: 'day', resetsOnRest: true },
    ]);
  });

  /* The counters array SHADOWS item.frequency in counterDefs(), so authoring one on a record that
   * also carries a frequency would hide the printed period — the exact helmsman's-recourse defect
   * below. Spined Shield carries no frequency, and this pins that it stays that way. */
  it('has no frequency for the counters array to shadow', () => {
    expect(item('spined-shield').frequency).toBeUndefined();
  });
});

describe('batch 29 — ring of wizardry is gated on the arcane tradition', () => {
  /* equipment-462: "It does nothing unless you have a spellcasting class feature with the arcane
   * tradition… two additional 1st-rank ARCANE spell slots each day." Ungated, the applier picked the
   * first slot caster, so a cleric took the slots as DIVINE ones. */
  it.each([
    ['ring-of-wizardry-type-i', { '1': 2 }],
    ['ring-of-wizardry-type-ii', { '1': 1, '2': 2 }],
    ['ring-of-wizardry-type-iii', { '2': 1, '3': 2 }],
    ['ring-of-wizardry-type-iv', { '3': 1, '4': 2 }],
  ])('%s keeps its byRank and names the arcane tradition', (id, byRank) => {
    const bonus = item(id).spellSlotBonus!;
    expect(bonus.byRank, 'the superseded row carried its full value').toEqual(byRank);
    expect(bonus.tradition).toBe('arcane');
  });

  it('no other item carries spellSlotBonus, so the four rings are the whole lane', () => {
    const carriers = Object.values(db.items).filter((i) => i.spellSlotBonus).map((i) => i.id).sort();
    expect(carriers).toEqual([
      'ring-of-wizardry-type-i',
      'ring-of-wizardry-type-ii',
      'ring-of-wizardry-type-iii',
      'ring-of-wizardry-type-iv',
    ]);
  });
});

describe('batch 29 — resolute mind wrap', () => {
  /* equipment-4107: "If you succeed at this saving throw, the resistance to mental damage granted by
   * the resolute mind wrap increases to 10 for 1 minute." Only the passive 5 shipped, so the minute
   * at 10 reached nothing. Same shape as modes/item-potion-of-acid-resistance-greater. */
  it('ships a Shield Thoughts mode granting mental resistance 10 for a minute', () => {
    const mode = raw(db.modes)['item-resolute-mind-wrap'] as Record<string, unknown> | undefined;
    expect(mode, 'created modes record').toBeTruthy();
    expect(mode!.fromItemId).toBe('resolute-mind-wrap');
    expect(mode!.name).toBe('Shield Thoughts');
    expect(mode!.duration).toBe('1 minute');
    expect(mode!.resistances).toEqual([{ type: 'mental', value: 10 }]);
    // The two conditions the sheet cannot police are stated rather than dropped.
    expect(String(mode!.note)).toMatch(/once per day/i);
    expect(String(mode!.note)).toMatch(/succeed/i);
  });

  it('the passive mental 5 is untouched — resistances do not stack, the mode replaces it', () => {
    expect(item('resolute-mind-wrap').passiveEffects?.resistances).toEqual([{ type: 'mental', value: 5 }]);
  });
});

describe('batch 29 — description repairs', () => {
  /* equipment-4105: "creating a flurry of color in a 10-foot burst centered on you." The linked
   * `10-foot [burst](…)` token was eaten by the link-stripper, leaving an area with no area. */
  it('hairpin of blooming flowers states the 10-foot burst on the first mention', () => {
    expect(desc('hairpin-of-blooming-flowers')).toContain('a flurry of color in a 10-foot burst centered on you');
    expect(desc('hairpin-of-blooming-flowers')).not.toContain('color in a centered on you');
  });

  /* equipment-513 / -599 / -600: "Each creature must attempt a DC 25 Will save", "the Will save DC is
   * 28", "the Will save DC is 38". The shipped prose read "must attempt a save." — no DC and no save
   * type anywhere in our data, and the item records carry no DC field to hold it. */
  it.each([
    ['unmemorable-mantle', 25],
    ['unmemorable-mantle-greater', 28],
    ['unmemorable-mantle-major', 38],
  ])('%s prints its DC %i Will save', (id, dc) => {
    expect(desc(id)).toContain(`must attempt a DC ${dc} Will save`);
    expect(desc(id)).not.toContain('must attempt a save');
  });

  /* equipment-1858 (+ -1614, -1615), the remastered printing our three records cite: "**Frequency**
   * once per hour". The prose carried the pre-remaster "once per day" while the record's own
   * frequency field already read per hour. */
  it.each(['helmsmans-recourse', 'helmsmans-recourse-greater', 'helmsmans-recourse-major'])(
    '%s states the printed once-per-hour frequency in prose',
    (id) => {
      expect(desc(id)).toContain('**Frequency** once per hour');
      expect(desc(id)).not.toContain('once per day');
    },
  );

  /* itemUses.ts counterDefs() returns item.counters whenever non-empty and only synthesizes from
   * item.frequency in the else branch, so the hand-written per-day array made the correct per-hour
   * frequency dead. Deleting it lets the frequency synthesize the identical pip with the right period. */
  it.each(['helmsmans-recourse', 'helmsmans-recourse-greater', 'helmsmans-recourse-major'])(
    '%s drops the per-day counter that shadowed its per-hour frequency',
    (id) => {
      expect(raw(item(id)).counters).toBeUndefined();
      expect(item(id).frequency).toEqual({ max: 1, per: 'hour' });
    },
  );

  /* equipment-1858's Major block: "when you Activate the shield, you can breathe underwater for 10
   * minutes." The rung sentence was bolted onto the base rung's "it casts water walk on you" with the
   * full stop left in, so the shipped prose read "…on you. and you can breathe underwater…". */
  it('the major helmsman\'s recourse joins its rung clause with a comma, not a stray full stop', () => {
    expect(desc('helmsmans-recourse-major')).toContain('casts Water Walk on you, and you can breathe underwater for 10 minutes');
    expect(desc('helmsmans-recourse-major')).not.toContain('on you. and you');
  });
});

describe('batch 29 — whip tails', () => {
  /* equipment-3195-3088: "You can also use your tail for the Grab an Edge action, even if your hands
   * are otherwise occupied" and "You can use your tail unarmed attack to Grapple even if you don't
   * have a free hand." Both exemptions had no carrier; the +2 item bonus to Grapple already ships in
   * situationalBonuses.ts and is deliberately not restated here. */
  it('constricting whip tail marks both Grab an Edge and Grapple', () => {
    const marks = raw(item('constricting-whip-tail')).recordMarks as { on: string; id: string; note: string }[];
    expect(marks?.map((m) => m.id)).toEqual(['grab-an-edge', 'grapple']);
    expect(marks.every((m) => m.on === 'action')).toBe(true);
    expect(marks[0]!.note).toMatch(/hands are otherwise occupied/);
    expect(marks[1]!.note).toMatch(/free hand/);
  });

  /* The level-3 rung prints the Grab an Edge clause and no Grapple bonus. */
  it('whip tail marks Grab an Edge only', () => {
    const marks = raw(item('whip-tail')).recordMarks as { id: string }[];
    expect(marks?.map((m) => m.id)).toEqual(['grab-an-edge']);
  });

  it('both marked actions are real records the reader can find', () => {
    expect(db.actions['grab-an-edge']?.name).toBe('Grab an Edge');
    expect(db.actions['grapple']?.name).toBe('Grapple');
  });
});

describe('batch 29 — the Graft trait family', () => {
  /* equipment-3195-3088 lists <trait label="Graft" url="/Traits.aspx?ID=790">. The import truncated
   * the id to "gra", which resolves to no trait record — glossary.ts renders a meaningless "Gra" chip
   * with the generic fallback tooltip. 28 items carried it. */
  it('no item carries the truncated trait id "gra"', () => {
    const bad = Object.values(db.items).filter((i) => (i.traits ?? []).includes('gra')).map((i) => i.id);
    expect(bad).toEqual([]);
  });

  it('the whole Howl of the Wild graft family resolves to the real trait record', () => {
    expect(raw(db.trait!)['graft']).toMatchObject({ id: 'graft', name: 'Graft', aonId: 'trait-790' });
    const grafts = Object.values(db.items).filter((i) => (i.traits ?? []).includes('graft'));
    // 28 repaired + the 4 that already carried the correct id.
    expect(grafts.length).toBeGreaterThanOrEqual(32);
    for (const id of ['constricting-whip-tail', 'whip-tail', 'gills', 'venom-glands', 'compound-eyes', 'toxic-blood'])
      expect(item(id).traits, id).toContain('graft');
  });

  it('re-emitting traits kept every other member of each array', () => {
    expect(item('compound-eyes').traits).toEqual(['fortune', 'graft', 'invested', 'magical']);
    expect(item('toxic-blood').traits).toEqual(['graft', 'invested', 'magical', 'poison']);
    expect(item('bioluminescent-stripes').traits).toEqual(['graft', 'invested', 'light', 'magical']);
  });
});

describe('batch 29 — energy robes', () => {
  /* equipment-1317: "**Activate** [two actions] command, Interact; **Frequency** once per day". With
   * no activationCost, MainTab.tsx:426 (`!!item?.activationCost`) dropped the robe from the item
   * actions list entirely, so the activation our own registry describes had no row to press. */
  it.each(['energy-robe-fire', 'energy-robe-cold', 'energy-robe-acid', 'energy-robe-electricity'])(
    '%s carries its two-action Activate',
    (id) => {
      expect(item(id).activationCost).toEqual({ type: 'actions', value: 2 });
      expect(item(id).frequency, 'the once-per-day line is untouched').toEqual({ max: 1, per: 'day' });
    },
  );
});

describe('batch 29 — aeon stone of vital amplification', () => {
  /* equipment-3055-3589: "The resonant power grants you resistance 5 to void damage." It shipped as
   * resonant.note prose only, so nothing reached the sheet's resistance total. NOT passiveEffects:
   * that fold is unconditional for an invested item and would grant the resistance to an UNSLOTTED
   * stone, which print does not. The wayfinder-slotted fold that reads this is the engine half. */
  it('carries the resonant void resistance as a real IWR entry, note intact', () => {
    const res = item('aeon-stone-vital-amplification').resonant!;
    expect(res.note).toBe('The resonant power grants you resistance 5 to void damage.');
    expect(raw(res).resistances).toEqual([{ type: 'void', value: 5 }]);
  });

  it('does not leak the resistance into the unconditional passive fold', () => {
    expect(item('aeon-stone-vital-amplification').passiveEffects?.resistances).toBeUndefined();
  });
});

describe('batch 29 — graceful leaper', () => {
  /* feat-6243: "You can roll an Acrobatics check instead of an Athletics check when making a High
   * Jump or Long Jump." The feat shipped with actionCost only — its entire printed mechanic reached
   * no carrier. Same lane and key names as feats/sly-disarm. */
  it('substitutes Acrobatics for Athletics on the two jumps', () => {
    expect(raw(db.feats['graceful-leaper']!).skillSubstitutions).toEqual([
      { use: 'acrobatics', forSkill: 'athletics', when: 'when making a High Jump or Long Jump' },
    ]);
  });

  /* …and the same feat's PROSE, which shipped as the raw importer annotation "when making a
   * high-jump skill=acrobatics or long-jump skill=acrobatics". Nothing in src/ parses `skill=`, so it
   * was inert AND player-visible garbled text; feat-6243 prints the sentence asserted here. */
  it('prints the printed sentence rather than the raw skill= annotation', () => {
    const d = db.feats['graceful-leaper']!.description ?? '';
    expect(d).toContain('instead of an Athletics check when making a High Jump or Long Jump.');
    expect(d).not.toContain('skill=');
  });
});

describe('batch 29 — magus studious spells', () => {
  const grant = () => raw(db.classFeatures['studious-spells']!).spellSlotBonus as {
    entryId?: string;
    restricted?: { label: string; note?: string; ladder?: { level: number; byRank: Record<string, number>; addSpells?: string[] }[] };
  };

  /* class-feature-431 printed "You gain two special 2nd-rank studious spell slots, which can be used
   * to prepare gecko grip, sure strike, water breathing… At 11th level, the extra slots increase to
   * 3rd level and you add haste. At 13th level… 4th level and you add fly." The spells were hardcoded
   * as a fixed pair in spellcasting.ts (no gecko grip, no choice) and the record carried nothing.
   * class-feature-1270 ("Studious Spell", Impossible Magic pg. 9) grants NO slots at all — the ladder
   * stays as the carrier of the three spellbook additions (build.ts bookGrantedSpellIds reads its
   * addSpells, and the hard-coded legacy fallback stands down only while the field exists) with every
   * rung's byRank emptied, which is the shape all eight hybrid studies below already use. */
  // batch 037: studious-spells#2026-rebuild
  it('is a slotless ladder — the 2026 feature grants no studious spell slots at all', () => {
    const l = grant().restricted!.ladder!;
    expect(l.map((s) => s.level)).toEqual([7, 11, 13]);
    expect(l.map((s) => s.byRank)).toEqual([{}, {}, {}]);
  });

  // batch 037: studious-spells#2026-rebuild — "Your studious spells are gecko grip… At 11th level, add
  // haste… At 13th level, add fly…" (class-feature-1270). Sure strike and water breathing were the
  // 2021 list and are not printed in the 2026 feature.
  it('the ladder names every printed spell, gecko grip first', () => {
    const l = grant().restricted!.ladder!;
    expect(l[0]!.addSpells).toEqual(['gecko-grip']);
    expect(l[1]!.addSpells).toEqual(['haste']);
    expect(l[2]!.addSpells).toEqual(['fly']);
    for (const id of l.flatMap((s) => s.addSpells ?? [])) expect(db.spells[id], id).toBeTruthy();
  });

  it('lands on the magus\'s own caster entry, not whichever entry sorts first', () => {
    expect(grant().entryId).toBe('magus-casting');
  });

  /* "…and an additional spell depending on your hybrid study." Modelled by neither side; the study's
   * spell goes into the SAME two slots, which is why every option's grant repeats the feature's label
   * and entryId — build.ts folds grants sharing both into one group (mergeRestrictedGrants). */
  const studies: [string, string[]][] = [
    ['aloof-firmament', ['water-walk', 'wall-of-wind', 'variable-gravity']],
    ['inexorable-iron', ['enlarge', 'earthbind', 'planar-tether']],
    ['laughing-shadow', ['blur', 'shift-blame', 'translocate']],
    ['resurgent-maelstrom', ['water-walk', 'aqueous-orb', 'unfettered-movement']],
    ['sparkling-targe', ['resist-energy', 'warding-aggression', 'mountain-resilience']],
    ['starlit-span', ['darkvision', 'wall-of-wind', 'unfettered-movement']],
    ['twisting-tree', ['embed-message', 'slow', 'flicker']],
    ['unfurling-brocade', ['web', 'whirling-scarves', 'planar-tether']],
  ];

  const optGrant = (optId: string) =>
    raw(db.classes['magus']!.subclass!.options.find((o) => o.id === optId)!).spellSlotBonus as {
      entryId?: string;
      restricted?: { label: string; ladder?: { level: number; byRank: Record<string, number>; addSpells?: string[] }[] };
    };

  it.each(studies)('%s adds its own studious spell at 7th, 11th and 13th', (optId, spells) => {
    const l = optGrant(optId).restricted!.ladder!;
    expect(l.map((s) => s.level)).toEqual([7, 11, 13]);
    expect(l.map((s) => (s.addSpells ?? [])[0])).toEqual(spells);
    for (const id of spells) expect(db.spells[id], id).toBeTruthy();
  });

  /* THE INVARIANT that keeps the study's spell in the feature's two slots instead of opening a
   * second, empty group: same label, same entry, and a SLOTLESS rung (`byRank: {}`, the shape
   * types.ts documents — "the empty step picks up the ranks the feature's own step of that level
   * states"). If an option ever carried real byRank counts, a magus would get four slots, not two. */
  it.each(studies.map(([id]) => id))('%s grants NO slots of its own', (optId) => {
    const g = optGrant(optId);
    expect(g.entryId).toBe(grant().entryId);
    expect(g.restricted!.label).toBe(grant().restricted!.label);
    for (const step of g.restricted!.ladder!) expect(step.byRank, `${optId} @${step.level}`).toEqual({});
  });

  it('every study still carries its focus spell — the option rows patched one field, not the record', () => {
    for (const [optId] of studies)
      expect(db.classes['magus']!.subclass!.options.find((o) => o.id === optId)!.focusSpells?.length, optId).toBeGreaterThan(0);
  });
});
