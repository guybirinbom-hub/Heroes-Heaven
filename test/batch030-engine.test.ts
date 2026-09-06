import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { critSpecSources, deriveAc, deriveStrikes, resilientSaveBonus, strikeShowsCritSpec } from '../src/rules/derive';
import { recordMarkersFor } from '../src/rules/explain';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 030, ENGINE lane.
 *
 * Every assertion is made on a BUILT character through the reader the sheet or the builder actually
 * calls — `buildCharacter`'s own output, `deriveAc`, `critSpecSources`/`strikeShowsCritSpec`,
 * `recordMarkersFor`. Reading a field back off a record would prove only that a row was typed.
 *
 * Findings whose fix is a DATA ROW the driver has yet to apply are tested against a content copy with
 * that row PATCHED IN MEMORY, never as a patched-vs-shipped delta: each assertion states the outcome
 * the row produces, so it reads the same before and after the row lands.
 */
const db = content();

/** A content copy with one record's fields overlaid — the in-memory stand-in for a backfill row. */
function patched(bucket: 'feats' | 'items', id: string, fields: Record<string, unknown>): ContentDatabase {
  const b = db[bucket] as Record<string, Record<string, unknown>>;
  return { ...db, [bucket]: { ...b, [id]: { ...b[id], ...fields } } } as ContentDatabase;
}

/** `_content.build`, but against an arbitrary (usually patched) content database. */
function buildOn(cdb: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = cdb.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: Object.keys(cdb.ancestries)[0],
      backgroundId: Object.keys(cdb.backgrounds)[0],
      keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: (cls?.subclass?.options[0]?.id as string) ?? null,
      ...over,
    },
    cdb,
  );
}

/** Attach feats to an already-built character, the route `critSpecSources`/`recordMarkersFor` read. */
const plusFeats = (c: Character, featIds: string[], level = 8): Character =>
  ({ ...c, feats: [...c.feats, ...featIds.map((featId, i) => ({ featId, level, slot: `b30e:${i}` }))] }) as Character;

/* ------------------------------------------------------------------ additional-ikon */

describe('additional-ikon gives the exemplar a fourth ikon', () => {
  /* AoN feat-7167: "Your story has grown rich enough that three ikons can't contain its full
   * complexity. You gain a fourth ikon, which can be of any type." The exemplar's `ikon` choice group
   * is pickByLevel {"1":3}, and `extraPickCount` — the ONE cap the builder's picker and both
   * resolvers share — read that map alone, so the already-authored `ikon-picks` counter mod was dead. */
  const IKONS = db.classes.exemplar.extraChoices!.find((g) => g.id === 'ikon')!.options.map((o) => o.id);
  const four = IKONS.slice(0, 4);
  const ikonRows = (c: Character) => c.classChoices.filter((r) => four.includes(r.id ?? ''));

  // batch 030: additional-ikon
  it('a level-9 exemplar WITHOUT the feat still keeps exactly three of four stored ikons', () => {
    const c = buildOn(db, 'exemplar', 9, { extraChoices: { ikon: four } });
    expect(ikonRows(c).map((r) => r.id)).toEqual(four.slice(0, 3));
  });

  // batch 030: additional-ikon
  it('additional-ikon raises the cap to four, and the fourth ikon becomes an owned class choice', () => {
    const c = buildOn(db, 'exemplar', 9, { extraChoices: { ikon: four }, featPicks: { '8:class:0': 'additional-ikon' } });
    expect(ikonRows(c).map((r) => r.id)).toEqual(four);
  });

  // batch 030: additional-ikon
  it('second-ikon, the archetype twin sharing the ikon-picks counter, does the same', () => {
    const c = buildOn(db, 'exemplar', 12, { extraChoices: { ikon: four }, featPicks: { '12:class:0': 'second-ikon' } });
    expect(ikonRows(c).map((r) => r.id)).toEqual(four);
  });

  // batch 030: additional-ikon
  it('an unrelated feat does not move the cap', () => {
    const c = buildOn(db, 'exemplar', 9, { extraChoices: { ikon: four }, featPicks: { '8:class:0': 'sudden-charge' } });
    expect(ikonRows(c)).toHaveLength(3);
  });
});

/* ------------------------------------------------- viking-vindicator#critspec / #shallow-water */

describe('viking-vindicator extends the viking weapon lists (feats/viking-vindicator)', () => {
  /* AoN feat-3619: "If you have Viking Weapon Familiarity or Viking Weapon Specialist, add the bastard
   * sword and rapier to the list of weapons in those feats." Neither viking feat's crit-spec list held
   * either weapon, and `critSpecSources` only ever reads each owned record's OWN block — so the
   * extension has to live on the extending record, gated on owning one of the two it extends. */
  const vindicator = {
    critSpec: true,
    critSpecWeapons: { bases: ['bastard-sword', 'rapier'] },
    critSpecRequiresFeat: ['viking-weapon-specialist', 'viking-weapon-familiarity'],
  };
  const cdb = patched('feats', 'viking-vindicator', vindicator);
  const viking = (featIds: string[]) =>
    plusFeats(
      /* A WIZARD, deliberately: a level-8 fighter has Fighter Weapon Mastery, an unrestricted
       * crit-spec grant that would make `strikeShowsCritSpec` true whatever this feat does. */
      buildOn(cdb, 'wizard', 8, {
        inventory: [{ instanceId: 'w', itemId: 'bastard-sword', quantity: 1, equipped: true }],
      } as Partial<BuildState>),
      featIds,
    );
  const bases = (c: Character) => critSpecSources(c, cdb).flatMap((s) => s.weapons?.bases ?? []);

  // batch 030: viking-vindicator#critspec
  it('a viking with Viking Weapon Specialist gets crit specialization on the bastard sword', () => {
    const c = viking(['viking-weapon-specialist', 'viking-vindicator']);
    expect(bases(c)).toContain('bastard-sword');
    expect(bases(c)).toContain('rapier');
    const strike = deriveStrikes(c, cdb).find((s) => s.base === 'bastard-sword');
    expect(strike, 'the equipped bastard sword is a strike').toBeTruthy();
    expect(strikeShowsCritSpec(strike!, critSpecSources(c, cdb), c)).toBe(true);
  });

  // batch 030: viking-vindicator#critspec
  it('Viking Weapon Familiarity alone also satisfies the gate — its own text grants crit spec at 5th', () => {
    expect(bases(viking(['viking-weapon-familiarity', 'viking-vindicator']))).toContain('bastard-sword');
  });

  // batch 030: viking-vindicator#critspec
  it('the extension is worth nothing without a list to extend: neither viking feat, no grant', () => {
    // Same patched database, so this stays true once the row ships — the gate is the mechanic.
    const c = viking(['viking-vindicator']);
    expect(bases(c)).not.toContain('bastard-sword');
    const strike = deriveStrikes(c, cdb).find((s) => s.base === 'bastard-sword');
    expect(strikeShowsCritSpec(strike!, critSpecSources(c, cdb), c)).toBe(false);
  });

  // batch 030: viking-vindicator#critspec
  it('the two viking feats keep their own printed lists — the gate adds, it never replaces', () => {
    expect(bases(viking(['viking-weapon-specialist', 'viking-vindicator']))).toContain('battle-axe');
  });

  /* The other half of the same printed sentence reaches the player as a MARK on the Sudden Charge
   * entry Viking Vindicator grants: "When you use Sudden Charge to Strike a target in shallow water,
   * the target is off-guard against your Strike…" */
  const marked = patched('feats', 'viking-vindicator', {
    recordMarks: [
      {
        on: 'feature',
        id: 'sudden-charge',
        note: 'when you use Sudden Charge to Strike a target in shallow water, the target is off-guard against your Strike.',
      },
    ],
  });

  // batch 030: viking-vindicator#shallow-water
  it('the shallow-water rider lands on the granted sudden-charge entry, attributed to viking-vindicator', () => {
    const c = plusFeats(buildOn(marked, 'fighter', 8), ['viking-vindicator']);
    const marks = recordMarkersFor(c, marked, 'feature', 'sudden-charge').filter((m) => m.sourceId === 'viking-vindicator');
    expect(marks).toHaveLength(1);
    expect(marks[0].note).toContain('shallow water');
    expect(marks[0].note).toContain('off-guard');
  });

  // batch 030: viking-vindicator#shallow-water
  it('an ordinary fighter taking Sudden Charge sees no viking rider on it', () => {
    const c = plusFeats(buildOn(marked, 'fighter', 8), ['sudden-charge']);
    expect(recordMarkersFor(c, marked, 'feature', 'sudden-charge').some((m) => m.sourceId === 'viking-vindicator')).toBe(false);
  });
});

/* ------------------------------------------------------------ frozen-breadth / bloodline-breadth */

/** The archetype entry's slot maxima by rank, low to high. */
function archSlots(c: Character, entryId: string): { rank: number; max: number }[] {
  const e = c.spellcasting.find((x) => x.id === entryId);
  return Object.entries(e?.slots ?? {})
    .map(([r, s]) => ({ rank: Number(r), max: (s as { max: number }).max }))
    .filter((s) => s.rank > 0)
    .sort((a, b) => a.rank - b.rank);
}

/** The ranks a `{perRank:1, exceptHighest:2}` bonus is printed to touch: all but the top two. */
function assertAllButTopTwo(withFeat: { rank: number; max: number }[], without: { rank: number; max: number }[]) {
  expect(withFeat.map((s) => s.rank)).toEqual(without.map((s) => s.rank));
  expect(withFeat.length, 'the archetype must actually have slots to widen').toBeGreaterThan(2);
  withFeat.forEach((s, i) => {
    const bumped = i < withFeat.length - 2 ? 1 : 0;
    expect(s.max, `rank ${s.rank}`).toBe(without[i].max + bumped);
  });
}

describe('frozen-breadth widens the gelid shard pool (feats/frozen-breadth)', () => {
  /* AoN feat-4099: "Increase the number of spells in your repertoire and number of spell slots you
   * gain from gelid shard archetype feats by 1 for each spell rank other than your two highest gelid
   * shard spell slots." The record carried only actionCost, so a gelid shard gained none of them. */
  const cdb = patched('feats', 'frozen-breadth', {
    spellSlotBonus: { perRank: 1, exceptHighest: 2, entryId: 'first-frost-casting' },
  });
  const picks = { '2:class:0': 'first-frost', '4:class:1': 'snowcaster', '12:class:2': 'expert-snowcasting', '18:class:3': 'master-snowcasting' };

  // batch 030: frozen-breadth
  it('every gelid shard rank but the top two gains a slot', () => {
    const base = buildOn(cdb, 'fighter', 20, { keyAbility: 'str', featPicks: picks });
    const brd = buildOn(cdb, 'fighter', 20, { keyAbility: 'str', featPicks: { ...picks, '8:class:4': 'frozen-breadth' } });
    assertAllButTopTwo(archSlots(brd, 'first-frost-casting'), archSlots(base, 'first-frost-casting'));
  });
});

describe('bloodline-breadth aims its slots at the SORCERER archetype pool (feats/bloodline-breadth)', () => {
  /* AoN feat-6230: "Increase the number of spells in your repertoire and number of spell slots you
   * gain from SORCERER ARCHETYPE FEATS by 1 for each spell rank other than your two highest sorcerer
   * spell slots." The shipped bonus named no entryId, so `slotEntryFor` resolved it to the character's
   * FIRST class entry — a wizard dipping sorcerer got the slots on their wizard pool, and a fighter
   * got none at all. */
  const cdb = patched('feats', 'bloodline-breadth', {
    spellSlotBonus: { perRank: 1, exceptHighest: 2, entryId: 'sorcerer-dedication-casting' },
  });
  const picks = { '2:class:0': 'sorcerer-dedication', '4:class:1': 'basic-sorcerer-spellcasting', '12:class:2': 'expert-sorcerer-spellcasting', '18:class:3': 'master-sorcerer-spellcasting' };

  // batch 030: bloodline-breadth
  it('a fighter with Sorcerer Dedication gains the slots — on the archetype pool, the only one they have', () => {
    const base = buildOn(cdb, 'fighter', 20, { keyAbility: 'str', featPicks: picks, archetypeTradition: 'arcane' });
    const brd = buildOn(cdb, 'fighter', 20, { keyAbility: 'str', featPicks: { ...picks, '8:class:4': 'bloodline-breadth' }, archetypeTradition: 'arcane' });
    assertAllButTopTwo(archSlots(brd, 'sorcerer-dedication-casting'), archSlots(base, 'sorcerer-dedication-casting'));
  });

  // batch 030: bloodline-breadth
  it("a wizard's OWN class pool is untouched by it — the feat names sorcerer archetype feats", () => {
    const over = { featPicks: picks, archetypeTradition: 'arcane' };
    const base = buildOn(cdb, 'wizard', 20, over);
    const brd = buildOn(cdb, 'wizard', 20, { ...over, featPicks: { ...picks, '8:class:4': 'bloodline-breadth' } });
    const classSlots = (c: Character) => archSlots(c, c.spellcasting.find((e) => e.id !== 'sorcerer-dedication-casting')!.id);
    expect(classSlots(brd)).toEqual(classSlots(base));
    assertAllButTopTwo(archSlots(brd, 'sorcerer-dedication-casting'), archSlots(base, 'sorcerer-dedication-casting'));
  });
});

/* ---------------------------------------------------------------------- bands-of-force#dexcap */

describe('bands-of-force cap Dex-to-AC at +5 (items/bands-of-force)', () => {
  /* AoN equipment-3058: "The force grants you a +1 item bonus to AC and saving throws, and a maximum
   * Dexterity modifier of +5 as armor." The bands are `equipment`, so there was no armour block to
   * carry the cap and only the half that PAYS the wearer was applied. */
  const cdb = patched('items', 'bands-of-force', { passiveEffects: { ac: 1, saves: 1, dexCap: 5 } });
  /** Unarmored, Dex +6, with the bands invested (or not). */
  const wearer = (bands: boolean): Character => {
    const c = buildOn(cdb, 'rogue', 20, {});
    return {
      ...c,
      abilities: { ...c.abilities, dex: 22 },
      inventory: bands ? [{ instanceId: 'b', itemId: 'bands-of-force', quantity: 1, worn: true, invested: true }] : [],
    } as Character;
  };

  // batch 030: bands-of-force#dexcap
  it('a Dex +6 wearer gets the +1 item bonus and only +5 of their Dex — a net zero, not a net +1', () => {
    const bare = deriveAc(wearer(false), cdb).value;
    expect(deriveAc(wearer(true), cdb).value).toBe(bare + 1 - 1);
  });

  // batch 030: bands-of-force#dexcap
  it('a Dex +5 wearer is unaffected by the cap and keeps the full +1', () => {
    const c = wearer(true);
    const at5 = { ...c, abilities: { ...c.abilities, dex: 20 } } as Character;
    const bare5 = { ...wearer(false), abilities: { ...c.abilities, dex: 20 } } as Character;
    expect(deriveAc(at5, cdb).value).toBe(deriveAc(bare5, cdb).value + 1);
  });

  // batch 030: bands-of-force#dexcap
  it('the cap needs the item to be in use — uninvested bands in the pack cap nothing', () => {
    const c = wearer(true);
    const packed = { ...c, inventory: [{ instanceId: 'b', itemId: 'bands-of-force', quantity: 1 }] } as Character;
    expect(deriveAc(packed, cdb).value).toBe(deriveAc(wearer(false), cdb).value);
  });
});

/* -------------------------------------------------------------------- rusting-carapace#potency */

describe('rusting-carapace is +1 armour in its own name (items/rusting-carapace)', () => {
  /* AoN equipment-1853: "This +1 leather lamellar armor incorporates the plates of an ore louse's
   * hide…" The record copies the base Leather Lamellar block verbatim, and `builtInRunes` — the field
   * that already carries a named fundamental rune for 265 WEAPONS — was typed weapon-only, so the
   * wearer sat 1 AC below the book value. */
  const cdb = patched('items', 'rusting-carapace', { builtInRunes: { potency: 1 } });
  const wearing = (itemId: string, runes?: Record<string, unknown>): Character => {
    const c = buildOn(cdb, 'fighter', 10, {});
    return { ...c, inventory: [{ instanceId: 'a', itemId, quantity: 1, worn: true, invested: true, runes }] } as Character;
  };

  // batch 030: rusting-carapace#potency
  it('it delivers +1 AC over the plain leather lamellar it is built from, with nothing etched', () => {
    expect(deriveAc(wearing('rusting-carapace'), cdb).value).toBe(deriveAc(wearing('leather-lamellar'), cdb).value + 1);
  });

  // batch 030: rusting-carapace#potency
  it('a FLOOR, not an addition: etching +2 potency onto it gives +2, not +3', () => {
    const etched = deriveAc(wearing('rusting-carapace', { potency: 2 }), cdb).value;
    expect(etched).toBe(deriveAc(wearing('leather-lamellar', { potency: 2 }), cdb).value);
  });

  // batch 030: rusting-carapace#potency
  it('ordinary armour is untouched — the floor is 0 for every record without the field', () => {
    expect(deriveAc(wearing('leather-lamellar'), cdb).value).toBe(deriveAc(wearing('leather-lamellar'), db).value);
  });

  /* The SAVES half of the same reader. Rusting Carapace prints potency only, so the resilient floor
   * is pinned on an in-memory armour carrying `builtInRunes.resilient` — the shape the rest of the
   * 112-armour lane needs — rather than on a row this batch ships. Without it a named
   * "+2 resilient …" armour would have been one row of AC and none of its saves. */
  const resDb = patched('items', 'leather-lamellar', { builtInRunes: { resilient: 'greater' } });
  const wornOn = (cdb2: ContentDatabase, runes?: Record<string, unknown>): Character =>
    ({ ...buildOn(cdb2, 'fighter', 10, {}), inventory: [{ instanceId: 'a', itemId: 'leather-lamellar', quantity: 1, worn: true, invested: true, runes }] }) as Character;

  // batch 030: rusting-carapace#potency
  it("items/rusting-carapace's reader covers resilient too, as the same FLOOR", () => {
    expect(resilientSaveBonus(wornOn(db), db), 'shipped armour: nothing').toBe(0);
    expect(resilientSaveBonus(wornOn(resDb), resDb), 'built-in greater resilient').toBe(2);
    expect(resilientSaveBonus(wornOn(resDb, { resilient: 'major' }), resDb), 'etching higher still wins').toBe(3);
    expect(resilientSaveBonus(wornOn(resDb, { resilient: 'resilient' }), resDb), 'etching lower cannot lower it').toBe(2);
  });
});
