import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { characterSituationalIds, explainStat, recordMarkersFor } from '../src/rules/explain';
import { featSituationalFor } from '../src/rules/situationalBonuses';
import { featEntries } from '../src/sheet/FeatsTab';
import { featFeatGrantsFor } from '../src/rules/featFeatGrants';
import { deriveStrikes } from '../src/rules/derive';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 030, SITUATIONAL lane.
 *
 * Same discipline as batch 29: every assertion goes through the reader the SHEET uses —
 * `featSituationalFor(characterSituationalIds(...))`, `explainStat`, `recordMarkersFor`, or
 * `featEntries` (the function FeatsTab builds its rows from). Asserting the registry literal would
 * prove only that a line was typed; an entry keyed to an id the character never contributes is
 * invisible in play, which is the defect three of these four findings are.
 */
const db = content();

/** A character holding feats by id, the route `characterSituationalIds` reads first. */
const withFeats = (featIds: string[], classId = 'fighter', level = 8): Character => {
  const base = build(classId, level);
  return {
    ...base,
    feats: [...base.feats, ...featIds.map((featId, i) => ({ featId, level, slot: `b30:${i}` }))],
  } as unknown as Character;
};

/** The `when :: bonus` strings one record puts on a stat row, as the sheet reads them. */
const stars = (c: Character, ref: { kind: string; skill?: string; save?: string }, sourceId: string) =>
  featSituationalFor(characterSituationalIds(c, db), ref)
    .filter((s) => s.id === sourceId)
    .map((s) => `${s.when} :: ${s.bonus}`);

describe('improved-command-corpse marks the command-undead entry it rewrites', () => {
  /* AoN feat-3886: "When you use Command Undead on a mindless undead, if the undead succeeds at its
   * save but doesn't critically succeed, it becomes your minion for 1 round. If the undead fails its
   * save, it becomes your minion for 1 hour. If it critically fails, it becomes your minion for 24
   * hours." All three outcomes replace Command Undead's printed ones, and `command-corpse` grants
   * Command Undead as a feat entry — which still printed the superseded durations. */

  // batch 030: improved-command-corpse
  it('the mark reaches command-undead through recordMarkersFor, the reader FeatsTab calls', () => {
    const c = withFeats(['command-undead', 'improved-command-corpse'], 'cleric', 8);
    const marks = recordMarkersFor(c, db, 'feature', 'command-undead').filter((m) => m.sourceId === 'improved-command-corpse');
    expect(marks.length, 'exactly one mark for the one printed replacement').toBe(1);
    expect(marks[0].note).toContain('1 round');
    expect(marks[0].note).toContain('1 hour');
    expect(marks[0].note).toContain('24 hours');
    expect(marks[0].note).toContain('mindless undead');
    // A cleric who took Command Undead WITHOUT the feat sees the printed durations unqualified.
    const plain = withFeats(['command-undead'], 'cleric', 8);
    expect(recordMarkersFor(plain, db, 'feature', 'command-undead').some((m) => m.sourceId === 'improved-command-corpse')).toBe(false);
  });

  // batch 030: improved-command-corpse
  it("the note lands in the rendered command-undead row's description, attributed to the feat", () => {
    const c = withFeats(['command-undead', 'improved-command-corpse'], 'cleric', 8);
    const row = featEntries(c, db).find((e) => e.featId === 'command-undead');
    expect(row, 'Command Undead is a row on the Feats tab').toBeTruthy();
    expect(row!.description).toContain('Improved Command Corpse');
    expect(row!.description).toContain('24 hours');
    // …and the printed text it supersedes is still there, so the player can see WHAT changed.
    expect(row!.description).toContain('Failure');
    // The row exists in play because Command Corpse hands the feat over — the prerequisite chain the
    // finding names (featFeatGrants.ts:476). Without that lane there would be nothing to mark.
    expect(featFeatGrantsFor('command-corpse')).toContain('command-undead');
  });

  /*
   * VERIFIER ADDITION. The two its above hand the character `command-undead` directly, so neither
   * proves the route a PLAYER takes: they pick Command Corpse, and the grant lane hands them Command
   * Undead. `featFeatGrantsFor` above is a registry check, not a built character — a grant that
   * stopped resolving inside buildCharacter would leave both its green and the mark landing on a row
   * nobody has. This builds the cleric through `overrides.addedFeats` (the real build) and asserts
   * the grant arrives AND the mark reaches the granted row.
   */
  // batch 030: improved-command-corpse
  it('a really built cleric taking Command Corpse receives Command Undead, and the mark lands on that granted row', () => {
    const c = build('cleric', 8, {
      overrides: { addedFeats: [{ featId: 'command-corpse', level: 4 }, { featId: 'improved-command-corpse', level: 8 }] },
    });
    expect(c.feats.map((f) => f.featId), 'the grant lane put Command Undead on the sheet').toContain('command-undead');
    expect(recordMarkersFor(c, db, 'feature', 'command-undead').some((m) => m.sourceId === 'improved-command-corpse')).toBe(true);
    const row = featEntries(c, db).find((e) => e.featId === 'command-undead');
    expect(row!.description).toContain('Improved Command Corpse');
    expect(row!.description).toContain('24 hours');
  });
});

describe('eclectic-skill stars the skills its permission clauses open up', () => {
  /* AoN feat-4605: "You can attempt any skill check that normally requires you to be trained, even
   * if you are untrained. If you have legendary proficiency in Occultism, you can attempt any skill
   * check that normally requires you to have expert proficiency, even if untrained or trained."
   * Only the numeric half (untrainedProficiency) had a carrier, and skillActions.ts's minRank filter
   * withholds every trained-only action from an untrained skill's panel. */

  // batch 030: eclectic-skill#untrained-gate
  it('a bard holding the feat gets the permission line on a skill row', () => {
    const c = withFeats(['eclectic-skill'], 'bard', 9);
    const s = stars(c, { kind: 'skill', skill: 'thievery' }, 'eclectic-skill');
    expect(s.length, 'one line for the one permission').toBe(1);
    expect(s[0]).toContain('requires trained proficiency while untrained');
    expect(s[0]).toContain('legendary in Occultism');
    expect(s[0]).toContain('you can attempt it');
    // A bard without the feat has no such line.
    expect(stars(build('bard', 9), { kind: 'skill', skill: 'thievery' }, 'eclectic-skill')).toEqual([]);
  });

  // batch 030: eclectic-skill#untrained-gate
  it("the numeric half the record already carried is untouched", () => {
    // The permission star is the SECOND carrier, not a replacement: the record's own
    // untrainedProficiency is what actually moves the number.
    expect(db.feats['eclectic-skill'].untrainedProficiency).toBeTruthy();
  });
});

describe("deadly-butterfly's knife critical specialization reaches the damage row", () => {
  /* AoN feat-2708, second sentence: "If you already had access to the critical specialization effect
   * or you gain the effect at a later time, you also gain the critical specialization effect for
   * knives when you critically hit with a butterfly sword. You can benefit from only one critical
   * specialization effect at a time." The record's critSpecWeapons covers the first sentence only. */

  // batch 030: deadly-butterfly
  it('the star names the knife effect and print\'s one-at-a-time limit', () => {
    const c = withFeats(['deadly-butterfly'], 'fighter', 8);
    const s = stars(c, { kind: 'strikeDamage' }, 'deadly-butterfly');
    expect(s.length).toBe(1);
    expect(s[0]).toContain('butterfly sword');
    expect(s[0]).toContain('persistent bleed');
    expect(s[0]).toContain('only one critical specialization effect at a time');
    expect(stars(build('fighter', 8), { kind: 'strikeDamage' }, 'deadly-butterfly')).toEqual([]);
  });

  // batch 030: deadly-butterfly
  it('the crit-spec plumbing genuinely cannot deliver it, which is why a star is the carrier', () => {
    // items/butterfly-sword is group `sword`, so every CRIT_SPEC lookup resolves the SWORD effect;
    // critSpecWeapons has no field that substitutes another group's effect.
    expect(db.items['butterfly-sword'].group).toBe('sword');
    expect(db.feats['deadly-butterfly'].critSpecWeapons?.bases).toContain('butterfly-sword');
  });

  /*
   * VERIFIER ADDITION. The star above is read with a bare `{ kind: 'strikeDamage' }` ref, which the
   * SHEET never builds: MainTab.tsx:593 and StrikeDetailModal.tsx:77 both pass an `instanceId`, and
   * `explainStat`'s strikeDamage arm resolves the strike from it — a character with no strike gets an
   * empty breakdown. This holds a real butterfly sword and reads the line off the strike's own
   * damage breakdown, which is the surface the player opens.
   */
  // batch 030: deadly-butterfly
  it('the line is on the damage breakdown of a really wielded butterfly sword', () => {
    const base = build('fighter', 8, { overrides: { addedFeats: [{ featId: 'deadly-butterfly', level: 8 }] } });
    const c = { ...base, inventory: [{ instanceId: 'bs', itemId: 'butterfly-sword', quantity: 1, equipped: true } as InventoryItem] };
    expect(deriveStrikes(c, db).some((s) => s.instanceId === 'bs'), 'the sword is a strike').toBe(true);
    const sit = explainStat(c, db, { kind: 'strikeDamage', instanceId: 'bs' }).situational ?? [];
    expect(sit.map((s) => s.sourceId)).toContain('deadly-butterfly');
    expect(sit.find((s) => s.sourceId === 'deadly-butterfly')!.text).toContain('persistent bleed');
  });
});

describe('peer-beyond carries the Lore-for-initiative permission as well as the save bonus', () => {
  /* AoN feat-2282: "You gain a +2 circumstance bonus to saving throws against mental effects caused
   * by incorporeal undead and haunts, and you can roll a Spirit Lore or Haunt Lore check for
   * initiative if you know that an incorporeal undead or a haunt is present." Only the save half had
   * a carrier; INITIATIVE_SKILLS lists no Lore and there is no initiative-skill picker. */

  // batch 030: peer-beyond#initiative
  it('the initiative row carries the permission, through explainStat', () => {
    const c = withFeats(['peer-beyond'], 'fighter', 8);
    const init = (explainStat(c, db, { kind: 'initiative' }).situational ?? []).filter((s) => s.sourceId === 'peer-beyond');
    expect(init.length, 'one line for the one permission').toBe(1);
    expect(init[0].text).toContain('Spirit Lore or Haunt Lore');
    expect(init[0].text).toContain('incorporeal undead or a haunt is present');
    expect((explainStat(build('fighter', 8), db, { kind: 'initiative' }).situational ?? []).some((s) => s.sourceId === 'peer-beyond')).toBe(false);
  });

  // batch 030: peer-beyond#initiative
  it('the +2 save half that already shipped is still exactly one line', () => {
    const c = withFeats(['peer-beyond'], 'fighter', 8);
    const will = stars(c, { kind: 'save', save: 'will' }, 'peer-beyond');
    expect(will.length).toBe(1);
    expect(will[0]).toContain('+2 circumstance');
    expect(will[0]).toContain('incorporeal undead or haunts');
    // The permission must not leak onto the save row: it is not a bonus to a save.
    expect(will[0]).not.toContain('initiative');
  });
});
