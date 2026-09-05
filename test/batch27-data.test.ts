import { describe, it, expect } from 'vitest';
import { content } from './_content';

const db = content();

/**
 * Wanderer's-Guide parity batch 27 — the DATA half (heritage/feat/action records and three
 * description repairs). Every assertion pins an authored field against the printed sentence that
 * required it, quoted in the test name, so a regeneration that drops the overlay row fails here
 * rather than silently returning the record to its pre-batch shape.
 *
 * These read the SHIPPED content through `content()` (public/core.json merged with
 * public/core-descriptions.json, exactly as the app loads it). The rows are authored in
 * scripts/data/effect-backfill.json and only exist once `npm run data` has applied them, so this file
 * is red until the orchestrator applies work/.b027-rows.json — deliberately: an assertion written
 * against a locally patched copy would pass on a machine where the row never landed.
 *
 * Several findings additionally need an ENGINE half that is NOT in this file (a new reader another
 * agent is building). Where that is so, the test pins the DATA and names the missing reader in a
 * comment, so the pair cannot drift apart.
 */

/** Untyped view of a record, for fields whose lane interface does not declare them yet. */
const raw = (rec: unknown) => rec as unknown as Record<string, unknown>;

const her = (id: string) => db.heritages[id];

describe('batch 27 — ancestry Hit Points', () => {
  /* Three heritages print "you gain N Hit Points from your ancestry instead of M" and carried
   * nothing, so each built on its ancestry chassis and was short at every level. resolvedAncestryHp
   * (src/rules/build.ts:696) reads `heritage.ancestryHp` first. */
  it('hold-scarred-orc: "You gain 12 Hit Points from your ancestry instead of 10"', () => {
    expect(db.ancestries['orc'].hp, 'the chassis the clause replaces').toBe(10);
    expect(her('hold-scarred-orc').ancestryHp).toBe(12);
  });

  it('sturdy-skeleton: "You have 10 Hit Points instead of 6"', () => {
    expect(db.ancestries['skeleton'].hp).toBe(6);
    expect(her('sturdy-skeleton').ancestryHp).toBe(10);
  });

  it('thickskin-tripkee: "You gain 8 Hit Points from your ancestry instead of 6"', () => {
    expect(db.ancestries['tripkee'].hp).toBe(6);
    expect(her('thickskin-tripkee').ancestryHp).toBe(8);
  });

  it('new-moon-sarangay: "You gain 10 Hit Points from your ancestry instead of 8"', () => {
    expect(db.ancestries['sarangay'].hp).toBe(8);
    expect(her('new-moon-sarangay').ancestryHp).toBe(10);
  });
});

describe('batch 27 — size', () => {
  /* `sizeSet` is the only operator that may LOWER a size (build.ts:7866-7869), which is what every
   * one of these clauses does — "INSTEAD OF X, your size is Y". Size is not a label: it sets the
   * space, the reach and the Bulk limit. */
  it('pixie: "Instead of Tiny, your size is Small"', () => {
    expect(db.ancestries['sprite'].size, 'the chassis the clause raises').toBe('tiny');
    expect(her('pixie').sizeSet).toBe('small');
  });

  it('compact-skeleton: "Your size is Small instead of Medium"', () => {
    expect(db.ancestries['skeleton'].size).toBe('medium');
    expect(her('compact-skeleton').sizeSet).toBe('small');
  });

  it('littlehorn-minotaur: "Instead of Large, your size is Medium"', () => {
    expect(db.ancestries['minotaur'].size).toBe('large');
    expect(her('littlehorn-minotaur').sizeSet).toBe('medium');
  });

  it('new-moon-sarangay: "Your size is Small instead of Medium"', () => {
    expect(db.ancestries['sarangay'].size).toBe('medium');
    expect(her('new-moon-sarangay').sizeSet).toBe('small');
  });

  it('toy-poppet: "Instead of Small, your size is Tiny"', () => {
    expect(db.ancestries['poppet'].size).toBe('small');
    expect(her('toy-poppet').sizeSet).toBe('tiny');
  });
});

describe('batch 27 — strikes the heritage changes', () => {
  it('littlehorn-minotaur: "deals 1d6 piercing damage instead of 1d8, but it has the agile trait"', () => {
    /* The Strike belongs to ancestries/minotaur, so the carrier is a RIDER — a second grantedStrikes
     * row would add a horn beside the one the character already has. `setDie` is absolute and may
     * lower; `match` is substring-tested against the strike name, and "Horns" contains "horn".
     * Reader: applyUnarmedRiders, derive.ts:4530/4537 (heritageRecords are in its source list). */
    const chassis = (db.ancestries['minotaur'].grantedStrikes ?? []).find((g) => g.name === 'Horns');
    expect(chassis?.die, 'the die the clause lowers').toBe('d8');
    expect(chassis?.traits ?? [], 'the chassis Strike is NOT agile').not.toContain('agile');
    const riders = raw(her('littlehorn-minotaur')).unarmedTraits as { match?: string[]; setDie?: string; add?: string[] }[] | undefined;
    expect(riders?.length).toBe(1);
    expect(riders![0].match).toEqual(['horn']);
    expect(riders![0].setDie).toBe('d6');
    expect(riders![0].add).toEqual(['agile']);
  });

  it('dogtooth-tengu: "Your beak unarmed attack gains the deadly d8 trait"', () => {
    /* The heritage's ONLY printed effect, and the record carried no mechanical field at all. Same
     * rider lane — adopting WG's giveItem literally would add a SECOND beak. */
    const chassis = (db.ancestries['tengu'].grantedStrikes ?? []).find((g) => g.name === 'Beak');
    expect(chassis?.traits ?? [], 'the chassis Beak carries no deadly trait').not.toContain('deadly-d8');
    const riders = raw(her('dogtooth-tengu')).unarmedTraits as { match?: string[]; add?: string[] }[] | undefined;
    expect(riders?.length).toBe(1);
    expect(riders![0].match).toEqual(['beak']);
    expect(riders![0].add).toEqual(['deadly-d8']);
  });

  it('sacred-nagaji: "Instead of a fangs unarmed attack, you have a tail attack"', () => {
    /* collectGrantedNaturals pushes the heritage then the ancestry and dedupes only on lowercased
     * NAME, so Tail and the nagaji chassis Fangs both survived. ⚠ ENGINE HALF (agent 1): Heritage
     * .replacesStrikes and the seed of `seen` in build.ts collectGrantedNaturals. */
    expect((db.ancestries['nagaji'].grantedStrikes ?? []).map((g) => g.name)).toContain('Fangs');
    expect((her('sacred-nagaji').grantedStrikes ?? []).map((g) => g.name)).toEqual(['Tail']);
    expect(raw(her('sacred-nagaji')).replacesStrikes).toEqual(['Fangs']);
  });

  it('monstrous-skeleton: "You gain a claw, horn, tail, or wing unarmed attack"', () => {
    /* The four grantedStrikes rows were already tagged `choiceValue` and the record asked NO
     * question, so build.ts:2492 resolved the pick to undefined and the 2447 guard dropped all four —
     * the heritage attack was unreachable. The option values must EQUAL the choiceValue tags. */
    const tags = (her('monstrous-skeleton').grantedStrikes ?? []).map((g) => g.choiceValue);
    expect(tags).toEqual(['claw', 'horn', 'tail', 'wing']);
    const ch = (her('monstrous-skeleton').effectChoices ?? [])[0];
    expect(ch, 'the question that resolves the pick').toBeTruthy();
    expect((ch.options ?? []).map((o) => o.value)).toEqual(tags);
    // No option grant: the strike rows already carry the die, damage type, traits and group.
    expect((ch.options ?? []).every((o) => !o.grant)).toBe(true);
  });
});

describe('batch 27 — benefits the record never handed over', () => {
  it('titan-nagaji: "Your scales are medium armor… you can never wear other armor or remove your scales"', () => {
    /* The item shipped unowned and nothing routed it, so the +4 AC, the Dex cap, the check penalty
     * and the Speed penalty reached no sheet. Reader: build.ts:6885 (heritage arm of grantsItems). */
    const item = db.items['titan-nagaji-scales'];
    expect(item.acBonus, 'the printed +4 item bonus to AC').toBe(4);
    expect(her('titan-nagaji').grantsItems).toEqual([{ itemId: 'titan-nagaji-scales', quantity: 1, worn: true }]);
  });

  it('courageous-tanuki: "You also gain the Tactical Retreat ability"', () => {
    /* actions/tactical-retreat already shipped with its description; nothing owned it, because
     * `aonParentId` has no reader anywhere in src/. Reader: MainTab.tsx:299. */
    expect(db.actions['tactical-retreat'].actionCost?.type).toBe('reaction');
    expect(her('courageous-tanuki').grantsActions).toEqual(['tactical-retreat']);
  });

  it('draxie: "You gain touch telepathy… as long as you share a language"', () => {
    /* The heritage's only benefit, and the record was bare. `senses` is the shipped encoding of this
     * exact sentence (feats/arcane-communication) and glossary.ts already defines the gloss. */
    expect(db.feats['arcane-communication'].senses, 'the precedent this mirrors').toEqual([{ name: 'touch-telepathy', range: 0 }]);
    expect(her('draxie').senses).toEqual([{ name: 'touch-telepathy', range: 0 }]);
  });

  it('leungli: "you gain… the amphibious trait… you can breathe both water and air"', () => {
    /* The TRAIT is what print names, and creatureTraitsOf never reads a record's own `traits` array —
     * which is why aquatic-elf carries both. derive.ts:2780 then derives breathesWater with no new
     * reader. */
    expect(her('leungli').speeds?.swim, 'the other half, already shipped').toBe(10);
    expect(her('leungli').grantsCreatureTraits).toEqual(['amphibious']);
    expect(her('aquatic-elf').grantsCreatureTraits, 'the sibling carrier').toEqual(['amphibious']);
  });

  it('born-of-vegetation: "You gain your choice of the plant or fungus trait"', () => {
    /* Neither trait, and no control to pick one — and the record's own Yaoguai Form clause keys its
     * +1 off which trait you hold, so the pick is load-bearing beyond flavour. Option-grant shape
     * copied from heritages/swimming-animal; reader at build.ts:5464/5495. */
    const ch = (her('born-of-vegetation').effectChoices ?? [])[0];
    expect(ch, 'the question WG asks and we did not').toBeTruthy();
    expect((ch.options ?? []).map((o) => o.value)).toEqual(['plant', 'fungus']);
    expect(ch.options![0].grant?.grantsCreatureTraits).toEqual(['plant']);
    expect(ch.options![1].grant?.grantsCreatureTraits).toEqual(['fungus']);
  });

  it('deny-lady-nanbyos-charity: "carry 1 more Bulk… and up to a maximum of 2 more Bulk"', () => {
    /* The +1/+2 split is the one types.ts:3095-3102 documents: bulkLimitBonus raises BOTH thresholds,
     * bulkMaxBonus adds the second point to the maximum only. ⚠ ENGINE HALF (agent 1): the fields on
     * the Heritage interface and a heritage arm in deriveBulk (derive.ts:5025-5028).
     * ⚠ The encumbered-threshold reading itself is on the Rulings Desk and is NOT settled here. */
    const h = raw(her('deny-lady-nanbyos-charity'));
    expect(h.bulkLimitBonus).toBe(1);
    expect(h.bulkMaxBonus).toBe(1);
  });

  it('carcharodon-merfolk: "you can smell spilled blood at 120 feet in the air and 500 feet in the water"', () => {
    /* No shipped field could hold a stimulus-specific range, so the Senses row read "scent 30 ft
     * (imprecise)" and the sentence survived only as prose. WG binds it to the scent sense itself.
     * ⚠ ENGINE HALF (agent 1): SenseEntry.note and its render on the Senses row. */
    const s = (her('carcharodon-merfolk').senses ?? [])[0];
    expect(s.name).toBe('scent');
    expect(s.range).toBe(30);
    expect(s.acuity).toBe('imprecise');
    expect(raw(s).note).toBe('You can smell spilled blood at a range of 120 feet in the air and 500 feet in the water.');
  });

  it('respite-of-a-thousand-roofs: the stale "apply it manually" warning is gone', () => {
    /* The warning was written when grantSourcesForProficiency did not walk heritages; build.ts:
     * 4954-4956 now includes both heritage ids, so the rejection no longer holds.
     * ⚠ ENGINE HALF (agent 1): FEAT_GRANTS['respite-of-a-thousand-roofs'] with Crafting + Cooking
     * Lore. This deletion must land WITH that row, never before it. */
    expect(her('respite-of-a-thousand-roofs').dataWarning).toBeUndefined();
  });
});

describe('batch 27 — skills the heritage trains', () => {
  it('lorekeeper-shisk: "trained in one Lore skill and one other Intelligence- or Wisdom-based skill"', () => {
    /* The Lore half existed only as parenthetical prose inside the picker's prompt. Readers already
     * live: shared.tsx:2709 renders the "Heritage Lore" SubCard, build.ts:3078 trains it. */
    expect(her('lorekeeper-shisk').loreChoices).toBe(1);
    const ch = (her('lorekeeper-shisk').effectChoices ?? []).find((e) => e.id === 'int-wis-skill');
    expect(ch?.options?.length, 'the eight Int/Wis skills, unchanged').toBe(8);
  });

  it('lorekeeper-shisk: "At 5th level, you become expert in the chosen skills"', () => {
    /* The option grants were flat "trained" with no level term. ancient-ash is the shipped shape.
     * This row covers the INT/WIS half, which build.ts:5528 steps off the effectChoices answer. */
    expect(raw(her('lorekeeper-shisk')).skillProgressionFromChoice).toEqual({
      choiceId: 'int-wis-skill',
      at: [{ level: 5, rank: 'expert' }],
    });
  });

  it('lorekeeper-shisk: …and the LORE steps too — print says "skillS", plural', () => {
    /* The second half of the same sentence, and it needs a SECOND field: a typed Lore carries no
     * effectChoices option, so `skillProgressionFromChoice` — which reads the rank off
     * `opt.grant.skills` — can never reach it. `Heritage.loreProgression` is the reader built for
     * exactly this clause (build.ts:3102-3111, the `loreStep` reduce), and it shipped with no row to
     * read: measured on a built 5th-level shisk, the Int/Wis skill was expert and the typed Lore was
     * still trained. ⚠ This is the ONLY record in the corpus carrying the field, so if this fails the
     * reader is reducing over an empty list again. */
    expect(raw(her('lorekeeper-shisk')).loreProgression).toEqual([{ level: 5, rank: 'expert' }]);
  });
});

describe('batch 27 — the poppet weakness', () => {
  it('tsukumogami-poppet: the value is the chassis formula, not a flat 5', () => {
    /* heritage-383 changes only the TYPE ("you're INSTEAD weak to electricity"); the number is the
     * poppet chassis' Flammable — "weakness to fire damage equal to one-third your level (minimum
     * 1)". A flat 5 was right only at levels 15-17, and gave a level-1 metal tsukumogami weakness 5
     * where print gives 1. IwrEntry.value accepts a formula string (resolved at derive.ts:2593). */
    const chassis = db.ancestries['poppet'].weaknesses?.[0];
    expect(chassis?.value, 'the value the heritage mirrors').toBe('max(1,floor(@actor.level/3))');
    const opts = (her('tsukumogami-poppet').effectChoices ?? [])[0].options ?? [];
    expect(opts.map((o) => o.value)).toEqual(['wood-cloth', 'metal', 'ceramic']);
    expect(opts.map((o) => o.grant?.weaknesses?.[0].type)).toEqual(['fire', 'electricity', 'cold']);
    for (const o of opts) expect(o.grant?.weaknesses?.[0].value, o.value).toBe(chassis!.value);
  });

  it('tsukumogami-poppet: metal and ceramic are "INSTEAD of" fire, not on top of it', () => {
    /* Nothing on our side could drop the chassis weakness — derive.ts:2752 walks FEATS only — so a
     * metal tsukumogami took electricity AND fire. feats/sealed-poppet is the same field one record
     * over. ⚠ ENGINE HALF (agent 2): widen the remover to heritage records and chosenEffects, and
     * carry removesWeaknesses through mergeEffect. */
    expect(db.feats['sealed-poppet'].removesWeaknesses, 'the precedent on the same ancestry').toEqual(['fire']);
    const opts = (her('tsukumogami-poppet').effectChoices ?? [])[0].options ?? [];
    const removes = opts.map((o) => raw(o.grant).removesWeaknesses);
    expect(removes[0], 'wood or cloth keeps the normal poppet weakness').toBeUndefined();
    expect(removes[1]).toEqual(['fire']);
    expect(removes[2]).toEqual(['fire']);
  });
});

describe('batch 27 — spell traditions and the notes that carry them', () => {
  it('spellkeeper-shisk: "Choose occult or primal… a cantrip from THAT tradition\'s spell list"', () => {
    /* The shipped 56-option list hard-coded one tradition per option, so the 16 cantrips on BOTH
     * lists were pinned to occult for a primal-choosing shisk. The tradition is now asked first and
     * the cantrip drawn from whichever list answered — the feats/sequestered-spell shape one ancestry
     * over, and heritages/wellspring-gnome's shape on this very lane. */
    const choice = her('spellkeeper-shisk').choice;
    expect(choice?.flag).toBe('spellkeeperTradition');
    expect((choice?.options ?? []).map((o) => o.value)).toEqual(['occult', 'primal']);
    const ec = (her('spellkeeper-shisk').effectChoices ?? [])[0];
    /* The id must NOT change with the shape. An effectChoices answer is stored under
     * `<heritageId>:<choiceId>`, so renaming it orphans the cantrip every existing spellkeeper shisk
     * already picked — and both the old options and the new filter answer with a spellId, so keeping
     * the id migrates every saved character for free. */
    expect(ec.id, 'the saved-answer key, deliberately unchanged').toBe('occultPrimalCantrip');
    expect(ec.options, 'the flat list is gone').toBeUndefined();
    expect(ec.spellFilter?.traditionFromChoiceFlag).toBe('spellkeeperTradition');
    expect(ec.spellFilter?.traditions).toEqual(['occult', 'primal']);
    expect(ec.spellFilter?.cantripsOnly).toBe(true);
    expect(ec.spellFilter?.grantAs).toBe('innate');
    // "A cantrip is heightened to a spell level equal to half your level rounded up."
    expect(ec.spellFilter?.innate?.atWill).toBe(true);
    expect(ec.spellFilter?.innate?.heightenHalfLevel).toBe(true);
  });

  it('born-of-celestial: "the tradition of any spells… you gain from a yaoguai heritage or ancestry feat is divine"', () => {
    /* The blanket rider was on neither side, and it bites on feats/brilliant-vision, which we grant
     * as occult. `fromAncestrySpells` is the open-set lane that resolves "gained from a heritage or
     * an ancestry feat" against the character (build.ts:6027-6038 / 6058) — the same carrier
     * makari-lizardfolk uses for the identical sentence one ancestry over. */
    expect(db.feats['brilliant-vision'].innateSpells?.[0].spellId, 'the spell the rider retunes').toBe('see-the-unseen');
    const notes = raw(her('born-of-celestial')).spellNotes as { fromAncestrySpells?: boolean; note: string }[] | undefined;
    expect(notes?.length).toBe(1);
    expect(notes![0].fromAncestrySpells).toBe(true);
    expect(notes![0].note).toMatch(/divine instead of its normal tradition/i);
  });

  it('born-of-elements: the same blanket clause, primal', () => {
    const notes = raw(her('born-of-elements')).spellNotes as { fromAncestrySpells?: boolean; note: string }[] | undefined;
    expect(notes?.length).toBe(1);
    expect(notes![0].fromAncestrySpells).toBe(true);
    expect(notes![0].note).toMatch(/primal instead of its normal tradition/i);
  });

  it('gandharva: "the tradition of any spells… you gain from a sprite heritage or ancestry feat is divine"', () => {
    const notes = raw(her('gandharva')).spellNotes as { fromAncestrySpells?: boolean; note: string }[] | undefined;
    expect(notes?.length).toBe(1);
    expect(notes![0].fromAncestrySpells).toBe(true);
    expect(notes![0].note).toMatch(/divine instead of its normal tradition/i);
  });

  it('mountainkeeper-tengu: "you can decide whether it\'s a divine or primal spell"', () => {
    /* No InnateSpellGrant field can express a per-CAST tradition choice and neither side models one,
     * so the caveat travels as a note. TWO entries because the fromAncestrySpells pass skips cantrips
     * (build.ts:6055) and the heritage's own vitality-lash is rank 0. */
    expect(db.spells['vitality-lash'].rank, 'why the spellId entry is needed separately').toBe(0);
    const notes = raw(her('mountainkeeper-tengu')).spellNotes as { spellId?: string; fromAncestrySpells?: boolean; note: string }[] | undefined;
    expect(notes?.length).toBe(2);
    expect(notes![0].spellId).toBe('vitality-lash');
    expect(notes![0].note).toMatch(/divine or a primal spell/i);
    expect(notes![1].fromAncestrySpells).toBe(true);
  });

  it('gandharva: Summon Instrument is granted ONCE, at record level', () => {
    /* Print grants it unconditionally, so the record level is its right and only carrier; the copy
     * repeated inside all 16 option grants was dead data (the seenInnate dedupe at build.ts:7159
     * drops every later one) and the prompt advertised it twice. */
    expect(her('gandharva').innateSpells).toEqual([{ spellId: 'summon-instrument', tradition: 'divine' }]);
    const ch = (her('gandharva').effectChoices ?? [])[0];
    expect(ch.options?.length).toBe(16);
    expect(ch.options!.every((o) => !o.grant?.innateSpells), 'no option may re-grant the cantrip').toBe(true);
    expect(ch.options!.every((o) => Object.keys(o.grant?.skills ?? {}).length === 1), 'each option still trains its skill').toBe(true);
    expect(ch.prompt).not.toMatch(/Summon Instrument/i);
  });
});

describe('batch 27 — the surki evolutions are gated behind Grand Metamorphosis', () => {
  /*
   * Print (feat-5393, Feat 9): "One of your nodes has adapted into a new magic-emitting organ. You
   * gain ONE of the evolutions FROM YOUR SURKI HERITAGE." The word "Evolution" does not appear in the
   * surki ancestry at all, and each heritage's evolutions sit in **Evolution** bullets — so nothing
   * grants one at 1st level. All four heritages handed theirs over free, while the feat's pick was
   * inert (grep of src/ for 'surkiEvolution' returned zero readers).
   *
   * The pick keeps its `choice` (flag 'surkiEvolution') rather than becoming effectChoices, for one
   * measured reason: only a FeatChoiceDef option carries `requiresAnyFeature`, which resolves HERITAGE
   * ids since batch 26 (derive.ts narrowChoiceOptions) — the only way to honour "from YOUR surki
   * heritage". A feat choice's option grant runs through the same applyAlwaysOn sink an effectChoices
   * option uses (build.ts:5588-5598), so nothing is lost by keeping it.
   */
  const gm = () => db.feats['grand-metamorphosis'];
  const optionFor = (value: string) => (gm().choice?.options ?? []).find((o) => o.value === value);

  it('no surki heritage grants an evolution at 1st level any more', () => {
    for (const id of ['breaker-surki', 'lantern-surki', 'hardshell-surki', 'elytron-surki']) {
      expect(her(id).grantsActions, `${id} — its Evolution action moved to the level-9 pick`).toBeUndefined();
    }
    // Elytron shipped BOTH of its evolutions free; the fly is the other one.
    expect(her('elytron-surki').innateSpells, 'Fly 1/day is elytron-surki\'s FIRST Evolution').toBeUndefined();
    // …and the base benefits stay: they are what print actually gives at 1st level.
    expect(her('elytron-surki').immunities, '"You take no damage from falling"').toEqual(['falling damage']);
    expect(her('hardshell-surki').grantsItems?.[0].itemId, 'the carapace IS the base benefit').toBe('hardshell-surki-carapace');
  });

  it('each option is offered only to the heritage that prints it', () => {
    const byHeritage: Record<string, string[]> = {
      'breaker-surki': ['breaker-wedge', 'breaker-spikes'],
      'elytron-surki': ['elytron-wings', 'elytron-membranes'],
      'hardshell-surki': ['hardshell-network', 'hardshell-field'],
      'lantern-surki': ['lantern-lens', 'lantern-strobe'],
    };
    for (const [heritageId, values] of Object.entries(byHeritage)) {
      expect(her(heritageId), 'requiresAnyFeature must name a record that exists').toBeTruthy();
      for (const v of values) expect(optionFor(v)?.requiresAnyFeature, v).toEqual([heritageId]);
    }
    expect((gm().choice?.options ?? []).length).toBe(8);
    expect(gm().choice?.flag, 'the flag semantics are kept, not re-invented').toBe('surkiEvolution');
  });

  it('the action evolutions grant their action from the pick', () => {
    /* Reader: applyAlwaysOn, build.ts:5501 — `for (const a of g.grantsActions ?? [])`. */
    const expected: Record<string, string> = {
      'breaker-spikes': 'trench-digging',
      'elytron-membranes': 'stridulating-song',
      'hardshell-field': 'dampening-harmonics',
      'lantern-lens': 'lantern-beam',
      'lantern-strobe': 'lantern-strobe',
    };
    for (const [value, actionId] of Object.entries(expected)) {
      expect(db.actions[actionId], `${actionId} must exist`).toBeTruthy();
      expect(raw(optionFor(value)?.grant).grantsActions, value).toEqual([actionId]);
    }
  });

  it('elytron-wings: Fly 1/day, at the surki\'s own magiphage tradition', () => {
    /* The surki ancestry's Magiphage clause — "it changes the tradition of all surki spells and
     * magical actions to that tradition" — and the bare grant fell back to the SPELL's first
     * tradition (arcane) at build.ts:7255. */
    expect(db.ancestries['surki'].choice?.flag, 'the flag the grant reads').toBe('magiphageTradition');
    const g = optionFor('elytron-wings')?.grant?.innateSpells?.[0];
    expect(g?.spellId).toBe('fly');
    expect(g?.usesPerDay).toBe(1);
    expect(g?.tradition, 'never hard-coded — the surki chose it').toBeUndefined();
    expect(g?.traditionFromChoiceFlag).toBe('magiphageTradition');
  });

  it('breaker-wedge carries no record grant (it is a mode); hardshell-network grants the created Reinforcing Network reaction', () => {
    /* breaker-wedge is the digging wedge — an activatable form (claw to 1d6, +magical/razing/
     * versatile force, -agile) built as a mode in src/rules/modes.ts, which is code and needs no record
     * row; the option's value plus the flag IS its gate.
     * hardshell-network: print's first Evolution (*"you can use your reaction to attempt a DC 17 flat
     * check. If successful, the attack becomes a normal hit"*) had no action record on our side — WG
     * ships it as prose — so the orchestrator CREATED actions/reinforcing-network (batch 27) and hung
     * it on the option. */
    expect(optionFor('breaker-wedge')?.grant).toBeUndefined();
    expect(optionFor('hardshell-network')?.grant?.grantsActions).toEqual(['reinforcing-network']);
    const rn = db.actions['reinforcing-network'];
    expect(rn?.actionCost).toEqual({ type: 'reaction' });
    expect(rn?.traits).toEqual(['magical']);
    expect(rn?.description).toContain('DC 17 flat check');
  });
});

describe('batch 27 — description repairs (numbers and names the importer deleted)', () => {
  /* Each of these lost a word-run where an auto-link was stripped. Two are fallback-lane repairs (the
   * AST is intact); the two ACTION cards have no AST at all — public/ast/actions.json has no key for
   * either — so `d` is exactly what the sheet renders. */
  it('nyktera: "in a 60-foot cone instead of a 30-foot cone"', () => {
    const d = her('nyktera').description ?? '';
    expect(d).toContain('in a 60-foot cone instead of a 30-foot cone');
    expect(d, 'the mangled fragment must be gone').not.toContain('in a instead of a');
  });

  it('hardshell-surki: "you can use your reaction to attempt a DC 17 flat check"', () => {
    const d = her('hardshell-surki').description ?? '';
    expect(d).toContain('attempt a DC 17 flat check');
    expect(d).not.toContain('attempt a .');
  });

  it('raise-slabs: "You deal 1d6 bludgeoning damage… (basic Reflex against your class DC…)"', () => {
    const d = db.actions['raise-slabs'].description ?? '';
    expect(d).toContain('You deal 1d6 bludgeoning damage to all adjacent creatures (basic Reflex against your class DC');
    expect(d, 'the empty parenthesis must be gone').not.toContain('( against your class DC');
  });

  it('stridulating-song: "must succeed at a Fortitude save"', () => {
    const d = db.actions['stridulating-song'].description ?? '';
    expect(d).toContain('must succeed at a Fortitude save against your class DC');
  });
});
