import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { spellNotesFor } from '../src/rules/explain';
import type { Character, InnateSpellGrant } from '../src/rules/types';

/**
 * THE VERIFIED SPELL-GRANT DEFECTS — one test per SHAPE, not per record.
 *
 * Twelve findings in scripts/audit/authored-verification.json name an innate grant, a spell note or
 * an item frequency. Each was confirmed the hard way: the authored value read against the record's
 * own printed text, the claim then attacked and left standing. The text is right; our value was not.
 *
 * Six shapes came out of them, and each one is a way for the sheet to state a rule the book does not:
 *
 *   1. a grant arriving on a LEVEL LADDER, handed over all at once      (`minLevel`, new lane)
 *   2. a heighten ladder the text SPELLS OUT, flattened to half-level   (`heightenAt` vs half-level)
 *   3. a non-daily CADENCE dropped, so "once per hour" reads "1/day"    (`usesPer`)
 *   4. a grant that DEPENDS ON THE CHARACTER                            (`voidHealingSpellSwap`, new lane)
 *   5. a two-sided clause carrying only one side
 *   6. a spell filed on the WRONG SURFACE (an innate that is a repertoire spell and a slot)
 *
 * The fixes are authored by scripts/apply-innate-spell-verification.mjs, which explains each record.
 */
const c = () => content();

/** The character's pooled innate entry, and the spells actually in it. */
const innate = (ch: Character) => ch.spellcasting.find((e) => e.id === 'innate-casting');
const innateIds = (ch: Character) => {
  const e = innate(ch);
  return [...(e?.cantrips ?? []), ...Object.values(e?.repertoire ?? {}).flat()];
};
/** The rank the innate entry casts a spell at (its bucket in the repertoire). */
const innateRank = (ch: Character, spellId: string) =>
  Number(Object.entries(innate(ch)?.repertoire ?? {}).find(([, ids]) => ids.includes(spellId))?.[0] ?? 0);

/** A character of `level` holding one feat. The slot key is not policed by buildCharacter, so this
 *  reaches feats a fighter could never legally take — which is what a lane test wants. */
const withFeat = (featId: string, level: number, over = {}) =>
  build('fighter', level, { featPicks: { [`${level}:general:0`]: featId }, ...over });

/** Every innate grant authored anywhere, with the record it belongs to. */
const allGrants = (): { where: string; g: InnateSpellGrant }[] => {
  const db = c() as unknown as Record<string, Record<string, { innateSpells?: InnateSpellGrant[] }>>;
  const out: { where: string; g: InnateSpellGrant }[] = [];
  for (const col of ['feats', 'classFeatures', 'items', 'heritages', 'backgrounds', 'ancestries']) {
    for (const [id, rec] of Object.entries(db[col] ?? {})) for (const g of rec.innateSpells ?? []) out.push({ where: `${col}/${id}`, g });
  }
  return out;
};

// ── shape 1 ───────────────────────────────────────────────────────────────────────────────────────
describe('a grant that arrives at a LATER level is not handed over early', () => {
  /*
   * Accursed Magic is a level-8 feat: "You can cast Claim Curse. At 10th level, you can also cast
   * Seal Fate, and at 12th level, you can also cast Inevitable Disaster." All three were flat grants,
   * so an 8th-level taker — Curse Maelstrom Dedication is level 2, so that is an ordinary build — was
   * shown a 4th- and a 5th-rank spell as his, 1/day, with nothing saying otherwise.
   */
  const accursed = (level: number) => innateIds(withFeat('accursed-magic', level));

  it('the 8th-level taker gets only the spell the feat gives at 8th', () => {
    expect(accursed(8)).toContain('claim-curse');
    expect(accursed(8)).not.toContain('seal-fate');
    expect(accursed(8)).not.toContain('inevitable-disaster');
  });

  it('each later spell appears exactly at its printed level', () => {
    expect(accursed(9)).not.toContain('seal-fate');
    expect(accursed(10)).toContain('seal-fate');
    expect(accursed(11)).not.toContain('inevitable-disaster');
    expect(accursed(12)).toContain('inevitable-disaster');
    expect(accursed(12)).toEqual(expect.arrayContaining(['claim-curse', 'seal-fate', 'inevitable-disaster']));
  });

  it("the record's own clause about a gated spell waits with it", () => {
    // "You can cast Seal Fate from this feat only while within your curse maelstrom state" printed on
    // Seal Fate at 8th level would annotate a spell the feat does not yet grant.
    expect(spellNotesFor(withFeat('accursed-magic', 8), 'seal-fate')).toEqual([]);
    expect(spellNotesFor(withFeat('accursed-magic', 10), 'seal-fate')[0]?.from).toBe('Accursed Magic');
    // …and the ungated one is there from the start.
    expect(spellNotesFor(withFeat('accursed-magic', 8), 'claim-curse')).toHaveLength(1);
  });

  it("Lion's Magic keeps its 12th-level spell instead of dropping it", () => {
    // The other half of the same missing lane: "At 12th level, you can also cast a 5th-rank
    // Subconscious Suggestion once per day" was resolved by not authoring the spell at all.
    expect(innateIds(withFeat('lions-magic', 11))).toEqual(['suggestion']);
    expect(innateIds(withFeat('lions-magic', 12))).toEqual(expect.arrayContaining(['suggestion', 'subconscious-suggestion']));
  });

  it('every authored gate names a level the record itself prints', () => {
    const bad: string[] = [];
    for (const { where, g } of allGrants()) {
      if (g.minLevel == null) continue;
      if (!Number.isInteger(g.minLevel) || g.minLevel < 2 || g.minLevel > 20) bad.push(`${where}: minLevel ${g.minLevel}`);
      const [col, id] = where.split('/');
      const desc = String((c() as unknown as Record<string, Record<string, { description?: string }>>)[col][id].description ?? '');
      // "At 10th level" / "at 12th level" — a gate the text does not state is one we invented.
      if (!new RegExp(`\\b${g.minLevel}(st|nd|rd|th) level\\b`, 'i').test(desc)) bad.push(`${where}: text never says ${g.minLevel}th level`);
    }
    expect(bad).toEqual([]);
  });
});

// ── shape 2 ───────────────────────────────────────────────────────────────────────────────────────
describe('a heighten ladder the text spells out beats the half-level default', () => {
  /*
   * `heightenHalfLevel` means one thing — ceil(level/2) — and three records used it for a ladder that
   * says something else. It is not a rounding difference: it overrides the authored `rank`, so Devil
   * Allies cast one rank BELOW its printed 6th for ten levels, and Manipulative Charm reached a 10th
   * rank its own sentence caps at 9th.
   */
  it("Manipulative Charm follows its own ladder and never passes the printed cap", () => {
    const at = (level: number) => innateRank(withFeat('manipulative-charm', level), 'charm');
    expect(at(4)).toBe(1); // "1st-rank charm" until 5th
    expect(at(5)).toBe(2); // "At 5th level and every 2 levels thereafter…"
    expect(at(6)).toBe(2);
    expect(at(7)).toBe(3);
    expect(at(19)).toBe(9); // "…to a maximum of a 9th-rank charm when you are 19th level"
    expect(at(20)).toBe(9); // half-level reached 10 here, a rank the spell cannot be cast at
  });

  it('Devil Allies keeps its printed base rank below the ladder, and steps only on even levels', () => {
    const at = (level: number) => innateRank(withFeat('devil-allies', level), 'summon-fiend');
    expect(at(11)).toBe(6); // "as a 6th-rank innate spell" — half-level had overridden this to 5
    expect(at(13)).toBe(6); // the ladder starts at 14th, so 13th is still 6th
    expect(at(14)).toBe(7);
    expect(at(15)).toBe(7);
    expect(at(20)).toBe(10);
  });

  it('Entities from Afar heightens from 16th, having heightened at no level at all', () => {
    const at = (level: number) => innateRank(withFeat('entities-from-afar', level), 'summon-entity');
    expect(at(14)).toBe(5);
    expect(at(16)).toBe(6);
    expect(at(20)).toBe(8);
  });

  it("Glass Skin's single step moves the rank, not only the prose", () => {
    // Mountain Resilience prints "Heightened (6th) The resistance increases to 10", so the step is
    // worth 5 resistance — the note said 6th and the sheet cast 4th.
    expect(innateRank(withFeat('glass-skin', 17), 'mountain-resilience')).toBe(4);
    expect(innateRank(withFeat('glass-skin', 18), 'mountain-resilience')).toBe(6);
  });

  it('Greater Magical Edification heightens Secret Page to the cantrip rank it names', () => {
    // "automatically heightened to the same spell rank as your cantrips from Magical Edification",
    // and cantrips render at ceil(level/2). Authored with no heighten at all, it sat at rank 3.
    expect(innateRank(withFeat('greater-magical-edification', 10), 'secret-page')).toBe(5);
    expect(innateRank(withFeat('greater-magical-edification', 20), 'secret-page')).toBe(10);
  });

  it('no grant states two heighten rules at once, or a rank no spell reaches', () => {
    const bad: string[] = [];
    for (const { where, g } of allGrants()) {
      if (g.heightenHalfLevel && g.heightenAt) bad.push(`${where}: both heightenHalfLevel and heightenAt`);
      for (const h of g.heightenAt ?? []) if (h.rank < 1 || h.rank > 10 || h.level < 1 || h.level > 20) bad.push(`${where}: step ${h.level}→${h.rank}`);
      // A ladder must climb: a later level granting a lower rank can never be reached, because the
      // resolver takes the highest rank among the steps you have passed.
      const steps = [...(g.heightenAt ?? [])].sort((a, b) => a.level - b.level);
      for (let i = 1; i < steps.length; i++) if (steps[i].rank <= steps[i - 1].rank) bad.push(`${where}: step ${steps[i].level} does not climb`);
    }
    expect(bad).toEqual([]);
  });
});

// ── shape 3 ───────────────────────────────────────────────────────────────────────────────────────
describe('a non-daily cadence reaches the sheet', () => {
  /*
   * "Once per hour" has a lane (`usesPer`) that Invisible Trickster has used for the identical
   * sentence all along. Cloud Walk instead said `atWill`, which is both unlimited AND suppresses the
   * cadence text — the record actively claimed something stronger than the book.
   */
  const cadence = (featId: string, spellId: string, level = 20) => innate(withFeat(featId, level))?.innateCadence?.[spellId];

  it('Cloud Walk is once per hour, not at will', () => {
    const ch = withFeat('cloud-walk', 10);
    expect(cadence('cloud-walk', 'air-walk', 10)).toBe('1/hour');
    expect(innate(ch)?.innateUses?.['air-walk']).toBeUndefined(); // 0 would mean unlimited
  });

  it('the two Pactbinder pacts carry the hourly cadence their text prints', () => {
    expect(cadence('pact-of-fey-glamour', 'illusory-disguise')).toBe('1/hour');
    expect(cadence('pact-of-eldritch-eyes', 'scouting-eye')).toBe('1/hour');
  });

  it('no grant is at-will AND rationed', () => {
    // `atWill` wins in the engine and silences both other fields, so a record carrying both says one
    // thing to a reader and another to the sheet.
    const bad = allGrants().filter(({ g }) => g.atWill && (g.usesPer || g.usesPerDay)).map((x) => x.where);
    expect(bad).toEqual([]);
  });
});

// ── shape 4 ───────────────────────────────────────────────────────────────────────────────────────
describe('a grant that depends on the character follows the character', () => {
  /*
   * "**Special** If you have void healing, you instead cast Harm." A dhampir Mortal Herald was granted
   * Heal — which void healing means they cannot be healed by — and the feat's four riders (self-only,
   * the 1-action cast getting the 2-action benefit, the auto-heighten, the free action at 0 HP) were
   * filed on that Heal, so they described a spell the character had no use for and Harm carried none.
   */
  const herald = (heritageId?: string) => withFeat('mortal-herald-dedication', 12, heritageId ? { heritageId } : {});

  it('most characters still get Heal', () => {
    const ch = herald();
    expect(innateIds(ch)).toContain('heal');
    expect(innateIds(ch)).not.toContain('harm');
    expect(spellNotesFor(ch, 'heal')[0]?.note).toContain('You can cast Heal from this feat only on yourself');
  });

  it('a dhampir gets Harm instead — and the clause follows it, naming Harm', () => {
    const ch = herald('dhampir');
    expect(innateIds(ch)).toContain('harm');
    expect(innateIds(ch)).not.toContain('heal');
    const notes = spellNotesFor(ch, 'harm');
    expect(notes).toHaveLength(1);
    expect(notes[0].from).toBe('Mortal Herald Dedication');
    expect(notes[0].note).toContain('You can cast Harm from this feat only on yourself');
    // The rest of the clause is untouched: only the spell's name changed.
    expect(notes[0].note).toContain('reduced to 0 Hit Points');
    expect(notes[0].note).not.toContain('Heal');
    expect(spellNotesFor(ch, 'heal')).toEqual([]);
  });

  it('the swap is that one grant, not a heal→harm remap of the character', () => {
    // A dhampir cleric still has Heal from their font; the swap belongs to the record that prints it.
    const ch = build('cleric', 12, { heritageId: 'dhampir' });
    expect(ch.spellcasting.flatMap((e) => Object.values(e.repertoire ?? {}).flat())).not.toContain('harm');
    expect(innateIds(herald('dhampir'))).toContain('harm');
  });

  it('only records the always-on paths read carry a swap', () => {
    // The lane is honoured for feats/heritages/backgrounds/features/invested items. A swap authored
    // inside `effectChoices` would be resolved into a plain grant and dropped in silence.
    const db = c() as unknown as Record<string, Record<string, { voidHealingSpellSwap?: { from: string; to: string }; effectChoices?: unknown }>>;
    const carrying: string[] = [];
    for (const col of ['feats', 'classFeatures', 'items', 'heritages', 'backgrounds', 'ancestries']) {
      for (const [id, rec] of Object.entries(db[col] ?? {})) {
        if (!rec.voidHealingSpellSwap) continue;
        carrying.push(`${col}/${id}`);
        expect(c().spells[rec.voidHealingSpellSwap.from], `${col}/${id} swaps from a missing spell`).toBeDefined();
        expect(c().spells[rec.voidHealingSpellSwap.to], `${col}/${id} swaps to a missing spell`).toBeDefined();
      }
    }
    expect(carrying).toEqual(['feats/mortal-herald-dedication']);
    expect(JSON.stringify(db.feats['mortal-herald-dedication'].effectChoices ?? null)).not.toContain('voidHealingSpellSwap');
  });
});

// ── shape 5 ───────────────────────────────────────────────────────────────────────────────────────
describe('a two-sided clause carries both sides', () => {
  it("Enter Divine Realm's return keeps the permission the text goes out of its way to give", () => {
    // Abridged, the note read as though the 8 creatures must be the ones you brought — the exact
    // inference the printed sentence forbids.
    const note = spellNotesFor(withFeat('enter-divine-realm', 20), 'interplanar-teleport')[0]?.note ?? '';
    expect(note).toContain('up to 8 willing creatures');
    expect(note).toContain('need not be the same targets of the previous casting');
    // …and the half that was already right is still there.
    expect(note).toContain('you act as the planar key');
  });

  it("Entities from Afar's note states the ladder its grant now follows", () => {
    const note = spellNotesFor(withFeat('entities-from-afar', 20), 'summon-entity')[0]?.note ?? '';
    expect(note).toContain('cryptic clue');
    expect(note).toMatch(/16th level and every 2 levels/);
    expect(note).toContain('maximum of 8th rank');
  });
});

// ── shape 6 ───────────────────────────────────────────────────────────────────────────────────────
describe('a halcyon spell is a repertoire spell and a slot, not an innate', () => {
  /*
   * "You can cast Field of Life as a 6th-rank halcyon spell, and you gain a 6th-rank halcyon spell
   * slot." Authored as a primal innate 1/day it landed on the wrong entry, dropped the slot (the
   * feat's whole point: the archetype does not reach rank 6 until 18th), locked the tradition the
   * spell's own rider is CONDITIONED on, and made the Special clause — treat it as a signature spell
   * — incoherent, since an innate can never be one.
   */
  const halcyon = (level: number, extra: Record<string, string> = {}) =>
    build('fighter', level, {
      featPicks: { '6:class:0': 'halcyon-speaker-dedication', ...extra },
      archetypeTradition: 'primal',
    });
  const entry = (ch: Character) => ch.spellcasting.find((e) => e.id === 'halcyon-speaker-dedication-casting');

  it('the spell is known in the halcyon entry at 6th rank', () => {
    const ch = halcyon(16, { '16:class:0': 'vellumis-excision' });
    expect(entry(ch)?.grantedRepertoire?.[6]).toContain('field-of-life');
    expect(innateIds(ch)).not.toContain('field-of-life');
  });

  it('…and the 6th-rank slot arrives with it, two levels before the archetype would give one', () => {
    expect(entry(halcyon(16))?.slots?.[6]?.max ?? 0).toBe(0);
    expect(entry(halcyon(16, { '16:class:0': 'vellumis-excision' }))?.slots?.[6]?.max).toBe(1);
  });

  it("the record's own rider still reaches the spell", () => {
    // It is conditioned on casting the spell AS A PRIMAL spell, which only means anything now that
    // the halcyon entry can also cast it as arcane.
    const notes = spellNotesFor(halcyon(16, { '16:class:0': 'vellumis-excision' }), 'field-of-life');
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toContain('+2 status bonus');
  });
});

// ── the item half ─────────────────────────────────────────────────────────────────────────────────
describe('an item states one activation limit, not two', () => {
  /*
   * The greater Cloak of Repute printed "**Frequency** twice per day" and carried frequency {max:1}
   * inherited from the base cloak, while its own counter and its own degree-shift both said twice.
   * `itemUses.ts` prefers the counter, so the pips were right — but ItemEditorModal seeds from
   * `frequency`, so editing or copying the item baked the wrong number in and made it the live one.
   */
  it('the greater and major Cloaks of Repute say what they print', () => {
    expect(c().items['cloak-of-repute'].frequency).toEqual({ max: 1, per: 'day' });
    expect(c().items['cloak-of-repute-greater'].frequency).toEqual({ max: 2, per: 'day' });
    expect(c().items['cloak-of-repute-major'].frequency).toEqual({ max: 3, per: 'day' });
  });

  it('no item carries a frequency count its own counter contradicts', () => {
    // ⚠ COUNT only. 41 items disagree on the PERIOD as well ({max:1,per:'day'} against a per-hour
    // counter); that is a separate shape, unverified against its texts, and deliberately not claimed
    // by this test.
    const bad: string[] = [];
    for (const [id, it] of Object.entries(c().items)) {
      const f = it.frequency;
      const counter = (it.counters ?? []).find((x) => x.id === 'freq') ?? (it.counters ?? [])[0];
      if (!f || !counter || typeof counter.max !== 'number') continue;
      if (counter.max !== f.max) bad.push(`${id}: frequency ${f.max}/${f.per} vs counter ${counter.max}`);
    }
    expect(bad).toEqual([]);
  });

  it('an item whose limit the field cannot state does not state a made-up one', () => {
    // Razmiri Wayfinder has TWO activations (3/day and 1/day) and one `frequency` can name only one;
    // Red Thread Knot prints no Frequency line at all — six knots that untie for good. Both had a
    // {max:1, per:'day'} nobody could have read off the page.
    expect(c().items['razmiri-wayfinder'].frequency).toBeUndefined();
    expect(c().items['razmiri-wayfinder'].counters?.map((x) => x.max)).toEqual([3, 1]);
    expect(c().items['red-thread-knot'].frequency).toBeUndefined();
    expect(c().items['red-thread-knot'].counters?.[0]).toMatchObject({ max: 6, resetsOnRest: false });
  });
});

// ── the overlay ───────────────────────────────────────────────────────────────────────────────────
describe('the fixes survive a regeneration', () => {
  it('every record fixed here is in effect-backfill.json, the only overlay npm run data keeps', () => {
    // A value written straight into public/core.json dies at the next regen, which is how several of
    // these defects outlived their first fix.
    const rows = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('node:fs').readFileSync('scripts/data/effect-backfill.json', 'utf8'),
    ) as { category: string; id: string; field: string }[];
    const has = (category: string, id: string, field: string) => rows.some((r) => r.category === category && r.id === id && r.field === field);
    const expected: [string, string, string][] = [
      ['feats', 'accursed-magic', 'innateSpells'],
      ['feats', 'lions-magic', 'innateSpells'],
      ['feats', 'greater-magical-edification', 'innateSpells'],
      ['feats', 'manipulative-charm', 'innateSpells'],
      ['feats', 'devil-allies', 'innateSpells'],
      ['feats', 'entities-from-afar', 'innateSpells'],
      ['feats', 'entities-from-afar', 'spellNotes'],
      ['feats', 'glass-skin', 'innateSpells'],
      ['feats', 'cloud-walk', 'innateSpells'],
      ['feats', 'pact-of-fey-glamour', 'innateSpells'],
      ['feats', 'pact-of-eldritch-eyes', 'innateSpells'],
      ['feats', 'mortal-herald-dedication', 'voidHealingSpellSwap'],
      ['feats', 'enter-divine-realm', 'spellNotes'],
      ['feats', 'vellumis-excision', 'spellListAdditions'],
      ['feats', 'vellumis-excision', 'spellSlotBonus'],
      ['items', 'cloak-of-repute-greater', 'frequency'],
    ];
    expect(expected.filter(([cat, id, f]) => !has(cat, id, f))).toEqual([]);
  });
});
