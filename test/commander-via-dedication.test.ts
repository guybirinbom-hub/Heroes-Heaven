import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { commanderFolioCapacity, commanderTierFor, commanderTacticOptions } from '../src/rules/build';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * "YOU GAIN THE TACTICS CLASS FEATURE LIKE A COMMANDER AND GAIN YOUR OWN FOLIO; THIS FOLIO CONTAINS
 * TWO COMMON MOBILITY OR OFFENSIVE TACTICS OF YOUR CHOOSING. YOU CAN PREPARE ONE OF THESE TACTICS
 * WHENEVER A COMMANDER WOULD BE ABLE TO PREPARE TACTICS." (Commander Dedication, Battlecry! pg. 52.)
 *
 * The entire subsystem was gated on `ownsClass('commander')`, which a dedication never satisfies. An
 * archetype commander picked no tactics, stored none and saw none, and the record carried a note
 * apologising that archetype tactics aren't tracked. Their row opens with two "Select a Tactic"
 * pickers filtered to level 1 — the same feat, read the same way.
 */
describe('Commander Dedication grants a real folio', () => {
  const SLOT = '2:class:0';
  const withDedication = (level = 2, over: Partial<BuildState> = {}) =>
    build('fighter', level, { featPicks: { [SLOT]: 'commander-dedication' }, ...over } as Partial<BuildState>);

  const basics = () => Object.values(db.actions).filter((a) => a.traits?.includes('tactic') && (a.tacticTier ?? 'basic') === 'basic');

  it('the capacities live on the record that prints them', () => {
    expect(db.feats['commander-dedication']?.folioTactics).toEqual([{ level: 1, count: 2 }]);
    expect(db.feats['commander-dedication']?.preparedTactics).toEqual([{ level: 1, count: 1 }]);
  });

  it('an archetype commander HAS a folio at all', () => {
    const picks = basics().slice(0, 2).map((a) => a.id);
    const c = withDedication(2, { commanderTactics: picks });
    expect(c.commanderTactics, 'the subsystem should exist for them').toBeDefined();
    expect(c.commanderTactics!.folio).toEqual(picks);
  });

  it('…of TWO, not the commander class\'s five', () => {
    const picks = basics().slice(0, 4).map((a) => a.id);
    const c = withDedication(2, { commanderTactics: picks });
    expect(c.commanderTactics!.folioMax).toBe(2);
    expect(c.commanderTactics!.folio).toHaveLength(2);
    /* The class is the control — the same code path must still give a real commander five. */
    const real = build('commander', 2, { commanderTactics: picks } as Partial<BuildState>);
    expect(real.commanderTactics!.folioMax).toBe(5);
  });

  it('…and prepares ONE, not three', () => {
    expect(withDedication().commanderTactics!.preparedMax).toBe(1);
    expect(build('commander', 2, {} as Partial<BuildState>).commanderTactics!.preparedMax).toBe(3);
  });

  it('squadmates come with the feature, and follow Intelligence', () => {
    /* Printed on the Tactics feature the dedication grants by name: "you can instruct a total number
     * of allies equal to 2 + your Intelligence modifier. These allies are your squadmates." */
    const c = withDedication();
    expect(c.commanderTactics!.squadmates).toBe(2 + Math.floor((c.abilities.int - 10) / 2));
  });

  it('the tier is BASIC however high the character climbs', () => {
    /* A 15th-level fighter with the dedication has none of the Tactician class features, so no master
     * tactics — the class ladder must not leak across. */
    expect(commanderTierFor(15, ['commander-dedication'], true)).toBe('basic');
    expect(commanderTierFor(15, [], false)).toBe('master');
    const expertTactic = Object.values(db.actions).find((a) => a.traits?.includes('tactic') && a.tacticTier === 'expert');
    if (expertTactic) {
      const c = withDedication(15, { commanderTactics: [expertTactic.id] });
      expect(c.commanderTactics!.folio, 'an expert tactic is not theirs to take').not.toContain(expertTactic.id);
    }
  });

  it('…until a SECOND Tactical Excellence at 8th, which the feat prints', () => {
    /* "You can select this feat a second time at 8th level; when you do, you may choose your new
     * tactics … from any of the expert tactics you have access to." */
    expect(commanderTierFor(8, ['commander-dedication', 'tactical-excellence', 'tactical-excellence'], true)).toBe('expert');
    expect(commanderTierFor(7, ['commander-dedication', 'tactical-excellence', 'tactical-excellence'], true)).toBe('basic');
    expect(commanderTierFor(8, ['commander-dedication', 'tactical-excellence'], true)).toBe('basic');
  });

  it('Tactical Expansion and Tactical Excellence widen the archetype folio too', () => {
    /* Both already carried their `commander-folio` counter mods and fired for nobody, because the gate
     * they sat behind was closed. */
    expect(commanderFolioCapacity(4, ['commander-dedication'], true, db)).toBe(2);
    expect(commanderFolioCapacity(4, ['commander-dedication', 'tactical-expansion'], true, db)).toBe(4);
    expect(commanderFolioCapacity(4, ['commander-dedication', 'tactical-expansion', 'tactical-excellence'], true, db)).toBe(6);
  });

  it('the picker and the sheet agree about the capacity', () => {
    /* They used to disagree even for a real commander: the builder capped at the bare formula while
     * the engine applied the counter mods, so a commander with Tactical Expansion could hold seven and
     * was offered five. One helper now answers both. */
    expect(commanderFolioCapacity(7, ['tactical-expansion'], false, db)).toBe(commanderFolioCapacity(7, ['tactical-expansion'], false, db));
    const viaDed = commanderFolioCapacity(7, ['commander-dedication', 'tactical-expansion'], true, db);
    const c = build('fighter', 7, {
      featPicks: { [SLOT]: 'commander-dedication', '4:class:0': 'tactical-expansion' },
      commanderTactics: basics().map((a) => a.id),
    } as Partial<BuildState>);
    expect(c.commanderTactics!.folioMax).toBe(viaDed);
    expect(c.commanderTactics!.folio).toHaveLength(viaDed);
  });

  it('the options the picker offers are the ones the sheet will keep', () => {
    const offered = commanderTacticOptions(15, db, commanderTierFor(15, ['commander-dedication'], true)).map((a) => a.id);
    const c = withDedication(15, { commanderTactics: offered });
    /* Everything offered survives the engine's filter — the folio cap is the only thing that trims it. */
    expect(c.commanderTactics!.folio).toEqual(offered.slice(0, c.commanderTactics!.folioMax));
  });

  it('a character WITHOUT the dedication still has no folio', () => {
    expect(build('fighter', 7, {} as Partial<BuildState>).commanderTactics).toBeUndefined();
  });

  it('the record no longer apologises, but keeps what only it says', () => {
    const note = db.feats['commander-dedication']?.note ?? '';
    expect(note).not.toMatch(/aren't tracked/i);
    /* The banner clause has no other carrier — deleting a sentence nothing else says is not a fix. */
    expect(note).toMatch(/30-foot aura/i);
  });
});
