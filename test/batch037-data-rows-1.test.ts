import { describe, it, expect } from 'vitest';
import { build, content, mainCasting } from './_content';
import type { RestrictedSlotGrant } from '../src/rules/types';

/**
 * Batch 037, data-rows-1: the 2026 Impossible Magic re-print of the magus and the summoner, plus
 * the Firework Technician's pyrotechnic vial.
 *
 * Every assertion reads the SHIPPED artefacts through `content()` (public/core.json plus the
 * split-out public/core-descriptions.json) or a character BUILT from them, so each one fails until
 * the driver applies work/.b037-rows-data-rows-1.json and
 * work/.b037-created-desc-data-rows-1.json — the test pins the row, not a patched copy.
 */
const db = content();
const feat = (id: string) => db.feats[id]!;

/*
 * The 2026 Spells per Day table (class-74 for the magus, class-77 for the summoner) opens a rank
 * every two levels and KEEPS it: 1 slot the level a rank arrives, 2 from then on, and no 10th-rank
 * slot ever. The 2021 "two-rank" table held only the top two ranks. The printed row for level 13 is
 * `13 | 5 | 2 2 2 2 2 2 1` — six full ranks plus the brand-new 7th.
 */
const PRINTED_13 = { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 1 };

describe('classes/magus — the 2026 Impossible Magic printing', () => {
  // batch 037: magus#2026-printing
  it('magus cites Impossible Magic (class-74) rather than the 2021 Secrets of Magic page', () => {
    // AoN class-74, released 2026-07-30, lists class-17 as its legacy_id.
    const cls = db.classes.magus!;
    expect(cls.aonId).toBe('class-74');
    expect(cls.source?.book).toBe('Pathfinder Impossible Magic');
    // A record citing a 2026 book must not be hidden by the "Hide legacy data" switch
    // (applyEditionFilter, src/rules/build.ts).
    expect(cls.edition).toBe('remaster-era');
  });

  // batch 037: magus#2026-printing
  it('magus spellcasting runs the retained-rank ladder and the five-spell spellbook', () => {
    /* class-74: "The spellbook contains your choice of eight arcane cantrips and five 1st-rank
     * arcane spells… Each time you gain a level, you add two arcane spells to your spellbook."
     * The 2021 book printed four. `progression: 'psychic'` is the existing implementation of the
     * printed ladder (a rank every two levels, 1 then 2 slots, no 10th) — the same numbers the
     * 2026 magus table prints, reused rather than re-implemented. */
    const sp = db.classes.magus!.spellcasting!;
    expect(sp.progression).toBe('psychic');
    expect(sp.spellbook).toEqual({ spells: 5, perLevel: 2 });
  });

  // batch 037: magus#2026-printing
  it('a 13th-level magus prepares two slots at every rank it has opened, not only the top two', () => {
    // class-74 Magus Spells per Day, row 13: 2 2 2 2 2 2 1.
    const e = mainCasting(build('magus', 13))!;
    const counts = Object.fromEntries(
      Object.entries(e.prepared ?? {}).map(([r, slots]) => [Number(r), (slots as unknown[]).length]),
    );
    expect(counts).toEqual(PRINTED_13);
  });

  // batch 037: magus#2026-printing
  it('a 20th-level magus never gains a 10th-rank slot', () => {
    // class-74 rows 18-20 stop at 9th rank; only full casters get the 10th-rank capstone slot.
    const e = mainCasting(build('magus', 20))!;
    expect(Object.keys(e.prepared ?? {}).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('classes/summoner — the 2026 Impossible Magic printing', () => {
  // batch 037: summoner#2026-printing
  it('summoner cites Impossible Magic (class-77) rather than the 2021 Secrets of Magic page', () => {
    // AoN class-77, released 2026-07-30, lists class-18 as its legacy_id.
    const cls = db.classes.summoner!;
    expect(cls.aonId).toBe('class-77');
    expect(cls.source?.book).toBe('Pathfinder Impossible Magic');
    expect(cls.edition).toBe('remaster-era');
  });

  // batch 037: summoner#2026-printing
  it('summoner repertoire is exactly its slots — the spare 1st-rank pick is gone', () => {
    /* class-77: "Each time you get a spell slot (see the Summoner Spells per Day table), you add a
     * spell to your spell repertoire of the same rank." `extraRepertoire: {1:1}` encoded the 2021
     * rule, where the repertoire reached five against four slots because the two-rank table
     * discarded the lower ranks. */
    const sp = db.classes.summoner!.spellcasting!;
    expect(sp.progression).toBe('psychic');
    expect(sp.extraRepertoire).toBeUndefined();
  });

  // batch 037: summoner#2026-printing
  it('a 13th-level summoner keeps two slots at every rank it has opened', () => {
    // class-77 Summoner Spells per Day, row 13: 2 2 2 2 2 2 1.
    const e = mainCasting(build('summoner', 13))!;
    const counts = Object.fromEntries(Object.entries(e.slots ?? {}).map(([r, s]) => [Number(r), (s as { max: number }).max]));
    expect(counts).toEqual(PRINTED_13);
    /* …and the repertoire opens at exactly the ranks the slots do. `extraRepertoire: {1:1}` gave the
     * 13th-level summoner a 1st-rank repertoire row it had no 1st-rank slot for — the 2021 rule,
     * where the two-rank table discarded the lower ranks and print still promised five known spells. */
    expect(Object.keys(e.repertoire ?? {})).toEqual(Object.keys(e.slots ?? {}));
  });
});

describe('feats/basic-magus-spellcasting — the 2026 Feat 4 printing', () => {
  // batch 037: basic-magus-spellcasting#2026-printing
  it('basic-magus-spellcasting is a Feat 4 granting the ordinary basic spellcasting benefits', () => {
    /* feat-9285 (Impossible Magic pg. 88), a Feat 4: "You gain the basic spellcasting benefits. Each
     * time you gain a spell slot of a new rank from the magus archetype, add two common spells of
     * that rank or lower to your spellbook." feat-2950 (Feat 6, bounded) is its legacy_id. The
     * archetype slot ladder (RANK_UNLOCKS in src/rules/casterArchetypes.ts) already opens rank 1 at
     * character level 4 — only the record's own level gated the pick two levels late. */
    const f = feat('basic-magus-spellcasting');
    expect(f.level).toBe(4);
    expect(f.aonId).toBe('feat-9285');
    expect(f.source?.book).toBe('Pathfinder Impossible Magic');
    expect(f.edition).toBe('remaster-era');
    expect(f.description).not.toMatch(/bounded/i);
    expect(f.description).toContain('add two common spells of that rank or lower to your spellbook');
  });
});

describe('feats/expert-magus-spellcasting — the 2026 printing', () => {
  // batch 037: expert-magus-spellcasting#2026-printing
  it('expert-magus-spellcasting grants the expert spellcasting benefits, not the bounded ones', () => {
    // feat-9290 (Impossible Magic pg. 88): "You gain the expert spellcasting benefits."
    const f = feat('expert-magus-spellcasting');
    expect(f.aonId).toBe('feat-9290');
    expect(f.source?.book).toBe('Pathfinder Impossible Magic');
    expect(f.edition).toBe('remaster-era');
    expect(f.description).toBe('You gain the expert spellcasting benefits.');
    // Prerequisites already matched print and are deliberately untouched.
    expect(f.prerequisites).toEqual(['Basic Magus Spellcasting', 'master in Arcana']);
  });
});

describe('feats/master-magus-spellcasting — the 2026 printing', () => {
  // batch 037: master-magus-spellcasting#2026-printing
  it('master-magus-spellcasting grants the master spellcasting benefits, not the bounded ones', () => {
    // feat-9291 (Impossible Magic pg. 88): "You gain the master spellcasting benefits."
    const f = feat('master-magus-spellcasting');
    expect(f.aonId).toBe('feat-9291');
    expect(f.source?.book).toBe('Pathfinder Impossible Magic');
    expect(f.edition).toBe('remaster-era');
    expect(f.description).toBe('You gain the master spellcasting benefits.');
    expect(f.prerequisites).toEqual(['Expert Magus Spellcasting', 'legendary in Arcana']);
  });
});

describe('feats/basic-summoner-spellcasting — the 2026 Feat 4 printing', () => {
  // batch 037: basic-summoner-spellcasting#2026-printing
  it('basic-summoner-spellcasting is a Feat 4 and no longer takes repertoire spells away', () => {
    /* feat-9308 (Impossible Magic pg. 91), a Feat 4. The 2021 text (feat-2957) ended with "Each time
     * you lose spell slots of a particular rank, remove those spells from your repertoire" — a
     * sentence the 2026 printing drops, because the ordinary ladder never takes a slot away. */
    const f = feat('basic-summoner-spellcasting');
    expect(f.level).toBe(4);
    expect(f.aonId).toBe('feat-9308');
    expect(f.source?.book).toBe('Pathfinder Impossible Magic');
    expect(f.edition).toBe('remaster-era');
    expect(f.description).not.toMatch(/bounded/i);
    expect(f.description).not.toMatch(/remove those spells from your repertoire/i);
    expect(f.description).toContain('add a spell of the appropriate spell rank to your repertoire');
  });
});

describe('feats/expert-summoner-spellcasting — the 2026 printing', () => {
  // batch 037: expert-summoner-spellcasting#2026-printing
  it('expert-summoner-spellcasting grants the expert spellcasting benefits, not the bounded ones', () => {
    // feat-9313 (Impossible Magic pg. 91): "You gain the expert spellcasting benefits."
    const f = feat('expert-summoner-spellcasting');
    expect(f.aonId).toBe('feat-9313');
    expect(f.source?.book).toBe('Pathfinder Impossible Magic');
    expect(f.edition).toBe('remaster-era');
    expect(f.description).toBe('You gain the expert spellcasting benefits.');
  });
});

describe('feats/master-summoner-spellcasting — the 2026 printing', () => {
  // batch 037: master-summoner-spellcasting#2026-printing
  it('master-summoner-spellcasting states its rule and its two prerequisites', () => {
    /* feat-9314 (Impossible Magic pg. 91): "You gain the master spellcasting benefits", with
     * "Expert Summoner Spellcasting; legendary in the skill associated with your eidolon's
     * tradition". The shipped record carried the scraped page header as its description and NO
     * prerequisites field at all, so the archetype's capstone read as having none. */
    const f = feat('master-summoner-spellcasting');
    expect(f.aonId).toBe('feat-9314');
    expect(f.source?.book).toBe('Pathfinder Impossible Magic');
    expect(f.edition).toBe('remaster-era');
    expect(f.description).toBe('You gain the master spellcasting benefits.');
    expect(f.prerequisites).toEqual([
      'Expert Summoner Spellcasting',
      "legendary in the skill associated with your eidolon's tradition",
    ]);
  });
});

describe('feats/firework-technician-dedication — the pyrotechnic vial and the current printing', () => {
  // batch 037: firework-technician-dedication#source
  it('firework-technician-dedication cites the Guns & Gears (Remastered) page whose text it prints', () => {
    // feat-8528 (Guns & Gears (Remastered) pg. 134); AoN lists feat-3245 as its legacy_id.
    const f = feat('firework-technician-dedication');
    expect(f.aonId).toBe('feat-8528');
    expect(f.source).toEqual({ book: 'Pathfinder Guns & Gears (Remastered)', license: 'ORC' });
  });

  // batch 037: firework-technician-dedication#pyrotechnic-vial
  it('firework-technician-dedication has a real pyrotechnic vial to throw', () => {
    /* feat-8528: "creating up to 4 pyrotechnic versatile vials during your daily preparations.
     * These vials have the fire trait and deal fire damage instead of acid." The vials were a bare
     * counter (src/rules/classResources.ts) with no item behind them, so the archetype's whole
     * point had nothing to throw. Shaped on the shipped items/versatile-vial, acid swapped for
     * fire, so both bombs behave identically on the Strikes page. */
    const vial = db.items['pyrotechnic-versatile-vial'];
    expect(vial).toBeTruthy();
    expect(vial!.damage).toEqual({ dice: 1, die: 'd6', type: 'fire' });
    expect(vial!.traits).toContain('fire');
    expect(vial!.traits).not.toContain('acid');
    const plain = db.items['versatile-vial']!;
    for (const k of ['level', 'bulk', 'rarity', 'usage', 'itemType', 'hands', 'category', 'group', 'range'] as const) {
      expect([k, (vial as Record<string, unknown>)[k]]).toEqual([k, (plain as unknown as Record<string, unknown>)[k]]);
    }
    expect(vial!.description).toContain('deal fire damage instead of acid');
  });

  // batch 037: firework-technician-dedication#pyrotechnic-vial
  it('firework-technician-dedication actually HANDS the four vials over', () => {
    /* feat-8528: "creating up to 4 pyrotechnic versatile vials during your daily preparations…
     * You can use pyrotechnic versatile vials only to throw as bombs". The counter in
     * src/rules/classResources.ts tracks the daily four; `grantsItems` is what puts the item in the
     * pack (buildCharacter's granted-items walk reads feats as well as class features), which is what
     * makes them throwable — an item in the catalogue that never reaches an inventory is still
     * nothing to throw. scripts/data/trust-approvals.json #13 approves this exact field here. */
    expect(feat('firework-technician-dedication').grantsItems)
      .toEqual([{ itemId: 'pyrotechnic-versatile-vial', quantity: 4 }]);
    const ch = build('fighter', 2, {
      keyAbility: 'str',
      featPicks: { '2:class:0': 'firework-technician-dedication' } as never,
    });
    const carried = (ch.inventory ?? []).filter((i) => i.itemId === 'pyrotechnic-versatile-vial');
    expect(carried).toHaveLength(1);
    expect(carried[0].quantity).toBe(4);
    expect(carried[0].grantedBy).toBe('Firework Technician Dedication');
  });
});

describe('classFeatures/studious-spells — rebuilt as the 2026 Studious Spell', () => {
  // batch 037: studious-spells#2026-rebuild
  it('studious-spells cites class-feature-1270 and is named for the 2026 feature', () => {
    // class-feature-1270 "Studious Spell", Impossible Magic pg. 9, level 7.
    const f = db.classFeatures['studious-spells']!;
    expect(f.name).toBe('Studious Spell');
    expect(f.aonId).toBe('class-feature-1270');
    expect(f.source?.book).toBe('Pathfinder Impossible Magic');
    expect(f.edition).toBe('remaster-era');
    expect(f.level).toBe(7);
  });

  // batch 037: studious-spells#2026-rebuild
  it('studious-spells grants no spell slots, only the three spellbook additions', () => {
    /* class-feature-1270 grants NO slots: "Add any studious spell you gain to your spellbook if you
     * don't know it already. Your studious spells are gecko grip… At 11th level, add haste… At 13th
     * level, add fly…". The grant OBJECT stays because two readers are keyed on its presence —
     * build.ts stands the hard-coded legacy `magusStudiousSpells` fallback down only while it
     * exists, and `bookGrantedSpellIds` reads the spellbook additions out of it — so the slots go by
     * emptying every ladder step's byRank, the shape all eight magus hybrid studies already use. */
    const grant = db.classFeatures['studious-spells']!.spellSlotBonus?.restricted as RestrictedSlotGrant;
    expect(grant).toBeTruthy();
    expect(grant.ladder).toEqual([
      { level: 7, byRank: {}, addSpells: ['gecko-grip'] },
      { level: 11, byRank: {}, addSpells: ['haste'] },
      { level: 13, byRank: {}, addSpells: ['fly'] },
    ]);
    // sure strike and water breathing were the 2021 list; the 2026 feature does not print them.
    expect(JSON.stringify(grant.ladder)).not.toMatch(/sure-strike|water-breathing/);
  });

  // batch 037: studious-spells#2026-rebuild
  it('studious-spells puts the free Arcane Cascade on the action the player actually clicks', () => {
    /* class-feature-1270: "When you cast a studious spell, you can use Arcane Cascade as a free
     * action as your next action this turn." A rider that changes an ACTION rather than a stat is
     * what `recordMarks` exists for; recordMarksFor() in src/rules/explain.ts walks owned class
     * features, so the note reaches the character's Arcane Cascade row. */
    const marks = db.classFeatures['studious-spells']!.recordMarks ?? [];
    expect(marks).toHaveLength(1);
    expect(marks[0].on).toBe('action');
    expect(marks[0].id).toBe('arcane-cascade');
    expect(marks[0].note).toMatch(/Arcane Cascade as a free action as your next action this turn/);
    expect(db.actions['arcane-cascade']).toBeTruthy();
  });

  // batch 037: studious-spells#2026-rebuild
  it('a 13th-level magus with studious-spells has the three spells in the book and no extra slots', () => {
    /* The spellbook half survives the slot removal — bookGrantedSpellIds reads the same ladder — and
     * the hybrid study's own spell (aloof-firmament: water walk / wall of wind / variable gravity)
     * still rides its subclass option's identically-shaped grant. */
    const ch = build('magus', 13, { subclassId: 'aloof-firmament' });
    const e = mainCasting(ch)!;
    const book = Object.values(e.spellbook ?? {}).flat();
    for (const id of ['gecko-grip', 'haste', 'fly', 'water-walk', 'wall-of-wind', 'variable-gravity']) {
      expect([id, book.includes(id)]).toEqual([id, true]);
    }
    // No studious restricted slot, and no leftover auto-prepared Sure Strike from the 2021 fallback.
    expect((e.restrictedSlots ?? []).filter((s) => /studious/i.test(s.label ?? ''))).toEqual([]);
    expect(book).not.toContain('sure-strike');
  });
});
