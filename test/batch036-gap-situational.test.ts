// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { explainStat } from '../src/rules/explain';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 036, SITUATIONAL family — GAP LANE.
 *
 * The batch's confirmed finding `composer-staff-greater` deleted the greater staff's flat
 * `passiveEffects={skills:{performance:1}}` because print grants the bonus for PLAYING the staff, not
 * for holding it, and a held staff is `equipped` (so the flat field passed passiveItemBonus's
 * itemInUse gate and raised every Performance check, with the conditional star restating the same
 * bonus beside it). The base and major staves print the SAME clause out of the SAME AoN document and
 * carried the SAME flat twin — they are not findings of their own, so the two rows that delete them
 * are authored here on a print premise, and pinned by these tests.
 *
 * Rows: work/.b036-rows-gap-situational.json (the driver applies them). So each test reads a content
 * copy with `passiveEffects` STRIPPED IN MEMORY — the shape the row produces — never a
 * patched-vs-shipped delta that would flip the moment the row lands.
 */
const db = content();

/** A content copy with one item's `passiveEffects` gone — exactly what the overlay row produces. */
const withoutPassives = (itemId: string): ContentDatabase => {
  const item = { ...(db.items[itemId] as Record<string, unknown>) };
  delete item.passiveEffects;
  return { ...db, items: { ...db.items, [itemId]: item } } as ContentDatabase;
};

const bardHolding = (itemId: string, level: number): Character =>
  ({
    ...build('bard', level),
    inventory: [{ instanceId: 'i1', itemId, quantity: 1, equipped: true } as InventoryItem],
  }) as Character;

describe('composer-staff bonuses only the Performance you play on it', () => {
  const stripped = withoutPassives('composer-staff');
  const bard = bardHolding('composer-staff', 4);

  // batch 036 premise: equipment-2249 "In this way, you can play it as though it were an instrument, and it grants a +1 item bonus to Performance checks made with it."
  it('composer-staff: merely holding the staff adds nothing to the Performance total', () => {
    const perf = explainStat(bard, stripped, { kind: 'skill', skill: 'performance' });
    expect(perf.parts.some((p) => p.label === 'Composer Staff')).toBe(false);
    expect(perf.parts.some((p) => p.note === 'item bonus')).toBe(false);
  });

  // batch 036 premise: equipment-2249 "In this way, you can play it as though it were an instrument, and it grants a +1 item bonus to Performance checks made with it."
  it('composer-staff: the played-as-an-instrument +1 is stated once, on Performance', () => {
    const notes = (explainStat(bard, stripped, { kind: 'skill', skill: 'performance' }).situational ?? []).filter(
      (n) => n.sourceId === 'composer-staff',
    );
    expect(notes.length, 'one line, not the flat bonus plus its own restatement').toBe(1);
    expect(notes[0].text).toContain('+1 item');
    expect(notes[0].text).toContain('playing the staff as an instrument');
  });
});

describe('composer-staff-major bonuses only the Performance you play on it', () => {
  const stripped = withoutPassives('composer-staff-major');
  const bard = bardHolding('composer-staff-major', 12);

  // batch 036 premise: equipment-2249 "The item bonus is +2."
  it('composer-staff-major: merely holding the staff adds nothing to the Performance total', () => {
    const perf = explainStat(bard, stripped, { kind: 'skill', skill: 'performance' });
    expect(perf.parts.some((p) => p.label === 'Composer Staff (Major)')).toBe(false);
    expect(perf.parts.some((p) => p.note === 'item bonus')).toBe(false);
  });

  // batch 036 premise: equipment-2249 "The item bonus is +2."
  it('composer-staff-major: the played-as-an-instrument +2 is stated once, on Performance', () => {
    const notes = (explainStat(bard, stripped, { kind: 'skill', skill: 'performance' }).situational ?? []).filter(
      (n) => n.sourceId === 'composer-staff-major',
    );
    expect(notes.length).toBe(1);
    expect(notes[0].text).toContain('+2 item');
    expect(notes[0].text).toContain('playing the staff as an instrument');
  });

  // batch 036 premise: equipment-2249 "In this way, you can play it as though it were an instrument, and it grants a +1 item bonus to Performance checks made with it."
  it('composer-staff-major: a bard carrying no staff reads no such note', () => {
    const plain = build('bard', 12);
    const notes = (explainStat(plain, stripped, { kind: 'skill', skill: 'performance' }).situational ?? []).filter(
      (n) => String(n.sourceId).startsWith('composer-staff'),
    );
    expect(notes).toEqual([]);
  });
});
