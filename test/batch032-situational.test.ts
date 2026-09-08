import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { characterSituationalIds, explainStat, recordMarkersFor } from '../src/rules/explain';
import { featSituationalFor } from '../src/rules/situationalBonuses';
import { skillActionsFor } from '../src/rules/skillActions';
import { deriveStrikes } from '../src/rules/derive';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 032, SITUATIONAL lane.
 *
 * Same discipline as batches 29-31: every assertion goes through the reader the SHEET uses —
 * `featSituationalFor(characterSituationalIds(...))` (the star list), `explainStat` (the stat
 * popup), `recordMarkersFor` (the mark on an action row) — never the registry literal. An entry
 * keyed to an id the character never contributes is invisible in play, and two of these six
 * findings are exactly that shape.
 */
const db = content();

/** A character holding feats by id, the route `characterSituationalIds` reads first. */
const withFeats = (featIds: string[], classId = 'fighter', level = 8): Character => {
  const base = build(classId, level);
  return {
    ...base,
    feats: [...base.feats, ...featIds.map((featId, i) => ({ featId, level, slot: `b32:${i}` }))],
  } as unknown as Character;
};

/** The `when :: bonus` strings one record puts on a stat row, as the sheet reads them. */
const stars = (c: Character, ref: { kind: string; skill?: string; save?: string }, sourceId: string) =>
  featSituationalFor(characterSituationalIds(c, db), ref)
    .filter((s) => s.id === sourceId)
    .map((s) => `${s.when} :: ${s.bonus}`);

describe('knowledge-is-power grants the player no bonus at all', () => {
  /* AoN feat-5039 (Player Core pg. 203, the edition our record claims): "you can invoke your
   * knowledge to make the creature take a -1 circumstance penalty to either AC and saves against the
   * next attack you make against it…". The four +1 circumstance stars the registry carried were the
   * LEGACY feat-2861 text. The remaster penalty lands on the ENEMY's roll — OTHERS_ROLL, ruling F —
   * so no row of this character's sheet moves. */

  // batch 032: knowledge-is-power
  it('a level-8 wizard holding knowledge-is-power reads no star on any of the four old rows', () => {
    const c = withFeats(['knowledge-is-power'], 'wizard', 8);
    for (const ref of [
      { kind: 'strikeAttack' },
      { kind: 'spell', which: 'attack' },
      { kind: 'ac' },
      { kind: 'save', save: 'will' },
    ]) {
      expect(stars(c, ref, 'knowledge-is-power'), `no legacy star on ${ref.kind}`).toEqual([]);
    }
  });

  // batch 032: knowledge-is-power
  it('the correctly-worded twin knowledge-is-power-wizard carries no star either', () => {
    // Both records hold aonId feat-5039 and a wizard is offered both; neither may promise a bonus.
    const c = withFeats(['knowledge-is-power-wizard'], 'wizard', 8);
    expect(stars(c, { kind: 'ac' }, 'knowledge-is-power-wizard')).toEqual([]);
    expect(stars(c, { kind: 'strikeAttack' }, 'knowledge-is-power-wizard')).toEqual([]);
  });
});

describe("hazard-finder's find-without-Searching clause reaches the Search row", () => {
  /* AoN feat-4884, second sentence: "You can find hazards that would normally require you to Search
   * even if you aren't Searching." It moves no number, so FEAT_SITUATIONAL could not hold it and
   * only the +1 half shipped. RECORD_MARKERS on the Search action is the carrier. */

  // batch 032: hazard-finder
  it('the mark reaches the search action through recordMarkersFor, the reader StatDetailModal calls', () => {
    const c = withFeats(['hazard-finder'], 'ranger', 8);
    const marks = recordMarkersFor(c, db, 'action', 'search').filter((m) => m.sourceId === 'hazard-finder');
    expect(marks.length, 'one mark for the one printed permission').toBe(1);
    expect(marks[0].note).toContain('hazards');
    expect(marks[0].note).toContain("aren't Searching");
    // A ranger without the feat reads the plain Search action.
    expect(recordMarkersFor(build('ranger', 8), db, 'action', 'search').some((m) => m.sourceId === 'hazard-finder')).toBe(false);
  });

  // batch 032: hazard-finder
  it('Search really is a row the Perception popup draws, so the mark has a surface', () => {
    // The mark is keyed by action slug; StatDetailModal only draws it beside an action the skill
    // actually lists. Search sits under `perception`, untrained.
    expect(skillActionsFor('perception', 'untrained', () => false).map((a) => a.name)).toContain('Search');
  });

  // batch 032: hazard-finder
  it('the numeric half the record already carried is untouched', () => {
    const c = withFeats(['hazard-finder'], 'ranger', 8);
    expect(stars(c, { kind: 'perception' }, 'hazard-finder')[0]).toContain('+1 circumstance');
  });
});

describe('safeguard-soul says the bonus reaches allies in the spiral', () => {
  /* AoN feat-3472 ends: "While your spiral is glowing, your allies in the light of the spiral gain
   * this benefit as well." An extension of the SAME bonus to the party, not an ally-only bonus, so
   * it is worded onto our own star the way the fan rows and pennant-of-victory already do. */

  // batch 032: safeguard-soul#allies
  it('the save popup line names the allies and the glowing spiral', () => {
    const c = withFeats(['safeguard-soul'], 'cleric', 8);
    const l = stars(c, { kind: 'save', save: 'will' }, 'safeguard-soul');
    expect(l.length, 'one line for the one printed bonus').toBe(1);
    expect(l[0]).toContain('allies');
    expect(l[0]).toContain('spiral');
    // …without losing the half that was already there.
    expect(l[0]).toContain('death');
    expect(l[0]).toContain('+2 status');
    expect(stars(build('cleric', 8), { kind: 'save', save: 'will' }, 'safeguard-soul')).toEqual([]);
  });

  // batch 032: safeguard-soul#allies
  it('the line renders through explainStat, on all three saves', () => {
    const c = withFeats(['safeguard-soul'], 'cleric', 8);
    for (const save of ['fortitude', 'reflex', 'will'] as const) {
      const sit = (explainStat(c, db, { kind: 'save', save }).situational ?? []).filter((s) => s.sourceId === 'safeguard-soul');
      expect(sit.length, `the ${save} popup carries it`).toBe(1);
      expect(sit[0].text).toContain('allies');
    }
  });
});

describe('mighty-bulwark reads as a replacement for Dexterity, once', () => {
  /* AoN feat-6413: "Your bonus from the bulwark armor trait increases from +3 to +4, and it applies
   * on all Reflex saves, not just damaging Reflex saves." The bulwark number REPLACES your Dex
   * modifier (trait-549), and the feat only raises it — so "+4 (bulwark)" overstated a high-Dex
   * character's save, and the trait's own +3 line sat beside it as a second bonus. */

  /** A guardian in Hellknight Plate (traits: [bulwark]) — the character who contributes both ids. */
  const inBulwarkArmor = (featIds: string[]): Character => {
    const c = withFeats(featIds, 'fighter', 8);
    return {
      ...c,
      inventory: [{ instanceId: 'plate', itemId: 'hellknight-plate', quantity: 1, worn: true } as InventoryItem],
    } as Character;
  };

  // batch 032: mighty-bulwark#replacement-wording
  it('the star says the +4 is used INSTEAD OF your Dexterity modifier', () => {
    const c = inBulwarkArmor(['mighty-bulwark']);
    const l = stars(c, { kind: 'save', save: 'reflex' }, 'mighty-bulwark');
    expect(l.length).toBe(1);
    expect(l[0]).toContain('instead of your Dexterity modifier');
    expect(l[0]).toContain('+4');
    // The old wording promised a flat bonus; nothing may read as one.
    expect(l[0]).not.toContain('+4 (bulwark)');
  });

  // batch 032: mighty-bulwark#replacement-wording
  it('the star still names the armour, because the feat grants nothing without it', () => {
    // feat-6413 gives the feat no bonus of its own: "Your bonus from the bulwark armor trait
    // increases from +3 to +4". The entry fires on the feat id alone, so a Sentinel in non-bulwark
    // armour reads this line too — it has to say what the +4 depends on.
    const l = stars(inBulwarkArmor(['mighty-bulwark']), { kind: 'save', save: 'reflex' }, 'mighty-bulwark');
    expect(l[0]).toContain('bulwark armor');
  });

  // batch 032: mighty-bulwark#supersedes-trait-bulwark
  it("the trait's own +3 line is dropped, so the Reflex row shows one rule not two", () => {
    const c = inBulwarkArmor(['mighty-bulwark']);
    const ids = characterSituationalIds(c, db);
    expect(ids, 'the armour still contributes the feat id').toContain('mighty-bulwark');
    expect(ids, 'the superseded trait id is filtered out').not.toContain('trait:bulwark');
    const reflex = featSituationalFor(ids, { kind: 'save', save: 'reflex' }).filter(
      (s) => s.id === 'mighty-bulwark' || s.id === 'trait:bulwark',
    );
    expect(reflex.length, 'exactly one line for the one printed number').toBe(1);
    expect(reflex[0].id).toBe('mighty-bulwark');
  });

  // batch 032: mighty-bulwark#supersedes-trait-bulwark
  it('a guardian WITHOUT the feat still reads the bulwark trait at +3', () => {
    // The supersede is conditional on owning both — dropping the trait line outright would hide the
    // rule from every other character in bulwark armour.
    const c = inBulwarkArmor([]);
    const l = stars(c, { kind: 'save', save: 'reflex' }, 'trait:bulwark');
    expect(l.length).toBe(1);
    expect(l[0]).toContain('+3 instead of your Dexterity modifier');
  });
});

describe("mantle-of-the-tikbalang tells the player Illusory Thrash's Strike hits harder", () => {
  /* AoN equipment-3226, Activate—Illusory Thrash: "Make a melee Strike. This Strike deals an
   * additional 4d6 mental damage." The record carried the 1/day counter and the 2-action cost and
   * nothing else, so the whole point of the activation lived only in the description prose. */

  // batch 032: mantle-of-the-tikbalang#illusory-thrash
  it('the strike-damage star names the 4d6 mental and the once-per-day gate', () => {
    const base = build('fighter', 8);
    const c = {
      ...base,
      inventory: [{ instanceId: 'mantle', itemId: 'mantle-of-the-tikbalang', quantity: 1, worn: true, invested: true } as InventoryItem],
    } as Character;
    const l = stars(c, { kind: 'strikeDamage' }, 'mantle-of-the-tikbalang');
    expect(l.length, 'one line for the one activation rider').toBe(1);
    expect(l[0]).toContain('4d6 mental');
    expect(l[0]).toContain('Illusory Thrash');
    expect(l[0]).toContain('once per day');
  });

  // batch 032: mantle-of-the-tikbalang#illusory-thrash
  it('the line is on the damage breakdown of a really wielded weapon', () => {
    // A bare `{ kind: 'strikeDamage' }` ref is not what the sheet builds: MainTab and
    // StrikeDetailModal both pass an instanceId and explainStat resolves the strike from it.
    const base = build('fighter', 8);
    const c = {
      ...base,
      inventory: [
        { instanceId: 'mantle', itemId: 'mantle-of-the-tikbalang', quantity: 1, worn: true, invested: true } as InventoryItem,
        { instanceId: 'ls', itemId: 'longsword', quantity: 1, equipped: true } as InventoryItem,
      ],
    } as Character;
    expect(deriveStrikes(c, db).some((s) => s.instanceId === 'ls'), 'the longsword is a strike').toBe(true);
    const sit = explainStat(c, db, { kind: 'strikeDamage', instanceId: 'ls' }).situational ?? [];
    expect(sit.map((s) => s.sourceId)).toContain('mantle-of-the-tikbalang');
    expect(sit.find((s) => s.sourceId === 'mantle-of-the-tikbalang')!.text).toContain('4d6 mental');
  });

  // batch 032: mantle-of-the-tikbalang#illusory-thrash
  it('the save half the item already carried is untouched', () => {
    const base = build('fighter', 8);
    const c = {
      ...base,
      inventory: [{ instanceId: 'mantle', itemId: 'mantle-of-the-tikbalang', quantity: 1, worn: true, invested: true } as InventoryItem],
    } as Character;
    expect(stars(c, { kind: 'save', save: 'will' }, 'mantle-of-the-tikbalang')[0]).toContain('-2 item');
  });
});
