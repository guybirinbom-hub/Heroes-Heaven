import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, deriveStrikes, ownedFeatureIds } from '../src/rules/derive';
import { lookupRef } from '../src/sheet/descref';
import type { BuildState } from '../src/rules/build';

/**
 * Batch 035, data-rows-1: the WG-comparison findings whose whole fix is authored data.
 *
 * Every assertion here reads the SHIPPED artefacts through `content()` (public/core.json plus the
 * split-out public/core-descriptions.json), so each one fails until the driver applies
 * work/.b035-rows-data-rows-1.json — which is the point: the test pins the row, not a patched copy.
 */
const db = content();

/** A subclass option's own copy of the prose — the second carrier, the one the Builder's picker shows. */
const option = (classId: string, optionId: string) =>
  db.classes[classId]!.subclass!.options.find((o) => o.id === optionId)!;

describe('cultivation-order prints the cultivation anathema, not the leaf order’s', () => {
  /* AoN druidic-order-12: "Committing wanton cruelty to plants or fungi or neglecting to nurture
   * plants in need of tending is anathema to your order. This doesn't prevent you from killing plants
   * or fungi…" Our summary block carried the LEAF order's line instead, so one description told the
   * player both that killing plants is fine and that killing them unnecessarily is anathema. */
  const LEAF = 'kill them unnecessarily';
  /* The GERUND, not the imperative the sibling orders' summary blocks use. The row was first written
   * "Commit … or neglect to nurture …", and both apply-parity-fixes.mjs and the driver's own pre-check
   * refused it: "neglect" is a token in NEITHER our shipped text nor any mirror document (a corpus grep
   * for the clause finds it in none — AoN's druidic-order-12 scrape carries no Anathema block at all,
   * which is why the record's own prose paragraph is the only authority for the wording). Reworded to
   * the sentence our prose already prints, so the summary block quotes rather than paraphrases. */
  const CULT = 'neglecting to nurture plants in need of tending';

  // batch 035: cultivation-order#anathema-sidebar
  it('the cultivation-order classFeature summary block quotes the cultivation clause', () => {
    const d = db.classFeatures['cultivation-order']!.description!;
    const anathema = d.slice(d.indexOf('**Anathema**'));
    expect(anathema).toContain(CULT);
    expect(anathema).not.toContain(LEAF);
  });

  // batch 035: cultivation-order#anathema-sidebar
  it('the druid subclass picker’s copy of cultivation-order agrees, and leaf-order keeps its own line', () => {
    expect(option('druid', 'cultivation-order').description).toContain(CULT);
    expect(option('druid', 'cultivation-order').description).not.toContain(LEAF);
    // The leaf line is correct where it belongs — this fix must not chase it out of leaf-order.
    expect(option('druid', 'leaf-order').description).toContain(LEAF);
  });
});

describe('swarm-eidolon names the abilities print names', () => {
  /* AoN eidolon-13: Sudden Shift ends "In addition, your eidolon gains the Redistribute reaction",
   * and the 17th-level transcendence is titled Sickening Swarm in both the ability list and the
   * section heading. The option copy shipped with the reaction name deleted, and BOTH copies headed
   * the transcendence "Sickening Form". */

  // batch 035: swarm-eidolon#redistribute
  it('the swarm-eidolon picker copy names the Redistribute reaction Sudden Shift grants', () => {
    expect(option('summoner', 'swarm-eidolon').description).toContain('gains the Redistribute reaction.');
  });

  // batch 035: swarm-eidolon#sickening-swarm-name
  it('swarm-eidolon heads the 17th-level transcendence Sickening Swarm in both copies', () => {
    expect(db.classFeatures['swarm-eidolon']!.description).toContain('## Sickening Swarm 17th');
    expect(db.classFeatures['swarm-eidolon']!.description).not.toContain('Sickening Form');
    expect(option('summoner', 'swarm-eidolon').description).toContain('## Sickening Swarm 17th');
    expect(option('summoner', 'swarm-eidolon').description).not.toContain('Sickening Form');
  });
});

describe('dragon-instinct resists piercing once, not twice', () => {
  /* AoN instinct-9, Raging Resistance: "You resist piercing damage and the damage type of your
   * instinct's dragon breath." Crystal and Forest BREATHE piercing, so the sentence's two clauses
   * collapse to one type — we shipped the entry twice, and derive.ts note()s once per entry with no
   * dedupe, so the IWR breakdown printed the same Dragon Instinct line twice. */
  const dragon = (which: string) =>
    build('barbarian', 9, {
      subclassId: 'dragon-instinct',
      featChoices: { 'feature:dragon-instinct': which, 'feature:dragon-instinct:0': which },
    } as Partial<BuildState>);
  const raging = (which: string) => {
    const c = dragon(which);
    return { ...c, classResources: { ...(c.classResources ?? {}), rage: 1 } } as typeof c;
  };
  /* The instinct's pick rides on `chosenEffects`, which carries no `name`, so every line here is
   * attributed to the bare "Active state" — its own (pre-existing, unassigned) gap, reported under
   * CROSS-FILE GAPS. What this finding is about is how MANY lines the row grows. */
  const lines = (which: string, key: string) => deriveDefenses(raging(which), db).sources[key] ?? [];

  // batch 035: dragon-instinct#duplicate-piercing
  it('a crystal dragon-instinct barbarian reads ONE line on the piercing row, not two', () => {
    expect(lines('crystal', 'resistance:piercing').length).toBe(1);
    expect(lines('forest', 'resistance:piercing').length).toBe(1);
  });

  // batch 035: dragon-instinct#duplicate-piercing
  it('a dragon-instinct whose breath is a SECOND type keeps both of its rows', () => {
    // The dedupe is per-entry data, not a blanket "one line per record": Sky breathes electricity.
    expect(lines('sky', 'resistance:piercing').length).toBe(1);
    expect(lines('sky', 'resistance:electricity').length).toBe(1);
    expect(deriveDefenses(raging('sky'), db).resistances.map((r) => r.type).sort()).toEqual(['electricity', 'piercing']);
  });
});

describe('impostor-in-hidden-places grants the printed Discomfiting Whisper', () => {
  /* AoN apparition-6 prints "**Vessel Spell** Discomfiting Whisper" and spell-2139 prints "**Duration**
   * sustained up to 1 minute". The reachable record was a pluralised twin that had lost "sustained",
   * so the player saw a name print does not use and lost the Sustain requirement. */
  const vessel = () => {
    const opt = db.classes.animist!.extraChoices!.find((e) => e.id === 'apparition')!
      .options.find((o) => o.id === 'impostor-in-hidden-places')!;
    return { opt, spell: db.spells[opt.focusSpells![0]]! };
  };

  // batch 035: impostor-in-hidden-places#vessel-spell
  it('the vessel spell impostor-in-hidden-places points at is named and durated as printed', () => {
    const { spell } = vessel();
    expect(spell.name).toBe('Discomfiting Whisper');
    expect(spell.duration).toBe('sustained up to 1 minute');
    expect(spell.aonId).toBe('spell-2139');
    // and it is still the STATTED half — the fix must not repoint at the empty twin.
    expect(spell.area).toBe('5-foot emanation');
  });

  // batch 035: impostor-in-hidden-places#vessel-spell
  it('only one Discomfiting Whisper is reachable', () => {
    expect(db.spells['discomfiting-whisper']).toBeUndefined();
    const visible = Object.entries(db.spells)
      .filter(([id, s]) => s?.name === 'Discomfiting Whisper' && !db.duplicateIds?.has(id))
      .map(([id]) => id);
    expect(visible).toEqual(['discomfiting-whispers']);
  });

  // batch 035: impostor-in-hidden-places#vessel-spell
  it('both copies of the impostor-in-hidden-places prose print the singular name', () => {
    const { opt } = vessel();
    expect(db.classFeatures['impostor-in-hidden-places']!.description).toContain('**Vessel Spell** Discomfiting Whisper\n');
    expect(opt.description).toContain('**Vessel Spell** Discomfiting Whisper\n');
    // the cross-reference label follows the name, so the popup link resolves by exact match
    for (const refs of [db.classFeatures['impostor-in-hidden-places']!.descRefs, opt.descRefs])
      expect((refs ?? []).map((r) => r.label)).toContain('Discomfiting Whisper');
  });

  /* Verifier addition. Renaming the reachable record to the printed name moves its label OFF its own
   * slug (`Discomfiting Whisper` slugifies to `discomfiting-whisper`, the retired twin), so the popup
   * falls through to descref.ts's name index — which was "last writer wins" and handed back the
   * SUPPRESSED `aon-discomfiting-whisper` scrape, the copy findDuplicateIds hides from every list.
   * Measured before the fix: lookupRef → 'aon-discomfiting-whisper'. */
  // batch 035: impostor-in-hidden-places#vessel-spell
  it('the impostor-in-hidden-places link opens the reachable Discomfiting Whisper, not the hidden scrape', () => {
    const node = lookupRef(db, { label: 'Discomfiting Whisper', key: 'spells' });
    expect(node?.slug).toBe('discomfiting-whispers');
    expect(db.duplicateIds?.has(node!.slug!)).toBe(false);
  });
});

describe('way-of-the-spellshot does not claim to grant spellcasting', () => {
  /* AoN way-5: "…that allows you to manifest unique effects, though your knowledge doesn't extend as
   * far as actual spellcasting." Our clause was reversed into "combining deadly skill with a firearm
   * alongside an array of moderate spellcasting" — the opposite of print, in both carriers. */
  const CLAUSE = 'extend as far as actual spellcasting';
  const WRONG = 'array of moderate spellcasting';

  // batch 035: way-of-the-spellshot#description-spellcasting
  it('both copies of the way-of-the-spellshot prose carry the printed clause', () => {
    expect(db.classFeatures['way-of-the-spellshot']!.description).toContain(CLAUSE);
    expect(db.classFeatures['way-of-the-spellshot']!.description).not.toContain(WRONG);
    expect(option('gunslinger', 'way-of-the-spellshot').description).toContain(CLAUSE);
    expect(option('gunslinger', 'way-of-the-spellshot').description).not.toContain(WRONG);
  });

  // batch 035: way-of-the-spellshot#description-spellcasting
  it('the way-of-the-spellshot mechanics the whole-object row carried over are untouched', () => {
    const opt = option('gunslinger', 'way-of-the-spellshot');
    expect(opt.classDcKeyAbility).toBe('int');
    expect((opt.featureIds ?? []).map((f) => (typeof f === 'string' ? f : f.id)))
      .toEqual(['energy-shot', 'recall-ammunition', 'dispelling-bullet']);
  });
});

describe('curse-of-inevitable-rot carries its printed traits', () => {
  /* AoN mystery-21's trait block for Curse Of Inevitable Rot is Acid, Curse, Divine, Oracle, Poison.
   * Ours dropped Acid, though every sibling curse carries its own energy trait. */

  // batch 035: curse-of-inevitable-rot#acid-trait
  it('curse-of-inevitable-rot is an acid curse', () => {
    expect(db.classFeatures['curse-of-inevitable-rot']!.traits).toEqual(['acid', 'curse', 'divine', 'oracle', 'poison']);
  });
});

describe('the-oscillating-wave hands over Conservation of Energy', () => {
  /* AoN conscious-mind-9 carries Conservation of Energy as its own section (and WG grants it as its
   * own class-feature block): the fire/cold alternation that rewrites the damage type of every
   * granted spell and standard psi cantrip. We had no record for it in any bucket, so it reached the
   * player only buried in the subclass option's description blob. */
  const psychic = build('psychic', 1, { subclassId: 'the-oscillating-wave' });

  // batch 035: the-oscillating-wave#conservation-of-energy
  it('a the-oscillating-wave psychic owns Conservation of Energy as a feature', () => {
    expect([...ownedFeatureIds(psychic, db)]).toContain('conservation-of-energy');
    // and no other conscious mind picks it up
    expect([...ownedFeatureIds(build('psychic', 1, { subclassId: 'the-distant-grasp' }), db)])
      .not.toContain('conservation-of-energy');
  });

  // batch 035: the-oscillating-wave#conservation-of-energy
  it('the-oscillating-wave’s Conservation of Energy record carries the printed alternation', () => {
    const rec = db.classFeatures['conservation-of-energy']!;
    expect(rec.name).toBe('Conservation of Energy');
    expect(rec.aonId).toBe('conscious-mind-9');
    for (const clause of ['**Adding Energy:**', '**Removing Energy:**', '**Mindshift:**', 'alternate between fire and cold'])
      expect(rec.description).toContain(clause);
  });
});

describe('animal-instinct arms the Cat it offers', () => {
  /* AoN instinct-8 (and instinct-1) list "Cat | Jaws | 1d10 P | Unarmed" and "Claw | 1d6 S | Agile,
   * unarmed". choice.options offered Cat but grantedStrikes had no row tagged 'cat', so a barbarian
   * who picked Cat got no animal attack at all. */
  const animal = (which: string) =>
    build('barbarian', 1, {
      subclassId: 'animal-instinct',
      featChoices: { 'feature:animal-instinct': which, 'feature:animal-instinct:0': which },
    } as Partial<BuildState>);
  /* RAGING. *"While raging, you gain your chosen animal's unarmed attack (or attacks)"* — the batch's
   * rage-gate row shipped `grantedStrikesState: 'rage'` on the record after this test was written, and
   * deriveStrikes drops a gated attack outright while the toggle is off (derive.ts:5010), so an
   * unraging Cat barbarian correctly has no Jaws at all. The Cat rows are what this test pins, so it
   * asks the question in the state print grants them in. */
  // batch 035: animal-instinct#rage-gate
  const raging = (which: string) => ({ ...animal(which), classResources: { rage: 1 } });
  const strikeNames = (which: string) => deriveStrikes(raging(which), db).map((s) => s.name);

  // batch 035: animal-instinct#cat
  it('a Cat animal-instinct barbarian gets Jaws and Claw', () => {
    const names = strikeNames('cat');
    expect(names).toContain('Jaws');
    expect(names).toContain('Claw');
    // batch 035: animal-instinct#rage-gate
    const claw = deriveStrikes(raging('cat'), db).find((s) => s.name === 'Claw')!;
    expect(claw.traits).toContain('agile');
  });

  // batch 035: animal-instinct#cat
  it('animal-instinct still gives every other animal exactly its own attacks', () => {
    // Wolf is the control: one Jaws, no Claw — proof the Cat rows are tagged, not global.
    expect(strikeNames('wolf')).toContain('Jaws');
    expect(strikeNames('wolf')).not.toContain('Claw');
  });
});
