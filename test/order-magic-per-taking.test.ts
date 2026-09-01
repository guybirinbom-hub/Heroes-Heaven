import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildChoiceOptions, emptyBuild } from '../src/rules/build';
import type { BuildState } from '../src/rules/build';

/*
 * ORDER MAGIC — the repeatable-pick shape, proved on the first record migrated to it.
 *
 * *"You gain the initial order spell from that order. **Special** You can take this feat multiple
 * times. Each time you do, you must choose a different order you have selected with Order Explorer."*
 *
 * The record held the question twice: an `effectChoices` picker with the grants, and its own `choice`
 * with the same options and none. `effectChoices` answers are stored per RECORD, so three takes wrote
 * to one key and a druid got ONE order spell for three feats. 34 more repeatable picks are in the same
 * state (`scripts/repeatable-pick-check.mjs`); this is the shape they move to, so it is worth pinning
 * the BEHAVIOUR here rather than the field layout — a migration that keeps the fields and loses the
 * second spell would still be the same bug.
 */
const db = content();

/** A druid who explored two orders and took Order Magic twice. */
const stateFor = (answers: Record<string, string>): Partial<BuildState> => ({
  featPicks: {
    '2:class': 'order-explorer',
    '4:class': 'order-explorer',
    '6:class': 'order-magic',
    '8:class': 'order-magic',
  },
  featChoices: answers,
});
const druid = (answers: Record<string, string>) => build('druid', 12, stateFor(answers) as Partial<BuildState>);

describe('Order Magic is answered once per taking', () => {
  it('two takes grant two different order spells', () => {
    const ch = druid({
      '2:class': 'storm-order',
      '4:class': 'wave-order',
      '6:class': 'storm-order',
      '8:class': 'wave-order',
    });
    /* A focus entry stores its spells under `repertoire`, keyed by rank — same shape as any other. */
    const focus = new Set(
      ch.spellcasting?.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat()) ?? [],
    );
    expect(focus.has('tempest-surge'), 'the first take chose Storm Order').toBe(true);
    expect(focus.has('rising-surf'), 'the second take must not overwrite the first').toBe(true);
  });

  it('the picker offers only the orders Order Explorer actually chose', () => {
    /* *"…a different order you have SELECTED with Order Explorer."* The record listed all nine, so a
     * druid who explored one order could take the initial spell of any of them. */
    const answers = { '2:class': 'storm-order', '4:class': 'wave-order' };
    const ch = druid(answers);
    const state = { ...emptyBuild(), ...stateFor(answers) } as BuildState;
    const rec = db.feats['order-magic'];
    const opts = buildChoiceOptions('order-magic', rec.choice!, state, db, ch, '6:class');
    const values = opts.map((o) => o.value);
    expect(values).toContain('storm-order');
    expect(values).toContain('wave-order');
    expect(values, 'an unexplored order is not on the menu').not.toContain('flame-order');
  });

  it('"a different order each time" greys the one the other take claimed', () => {
    const answers = { '2:class': 'storm-order', '4:class': 'wave-order', '6:class': 'storm-order' };
    const ch = druid(answers);
    const state = { ...emptyBuild(), ...stateFor(answers) } as BuildState;
    const rec = db.feats['order-magic'];
    const opts = buildChoiceOptions('order-magic', rec.choice!, state, db, ch, '8:class');
    /* Greyed and explained, never removed — ruling Q27. */
    expect(opts.find((o) => o.value === 'storm-order')?.disabled).toBeTruthy();
    expect(opts.find((o) => o.value === 'wave-order')?.disabled).toBeFalsy();
  });
});
