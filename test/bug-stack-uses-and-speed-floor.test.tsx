// @vitest-environment jsdom
import { useState } from 'react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { InventoryTab } from '../src/sheet/InventoryTab';
import { normalizeCharacter } from '../src/rules/normalize';
import { bumpItemCounter, type PlayState } from '../src/rules/play';
import { deriveSpeeds, landSpeedResolved, penaltyFloored } from '../src/rules/derive';
import type { Character, InventoryItem } from '../src/rules/types';

const db = content();

/**
 * Guy, 2026-10-29: "if something has uses like rations then it will display the 7 dots and when you
 * finish them then the next ration dots will appear." A stack of rations ×2 used to show one set of 7
 * uses for the whole stack, so the second week of food could never be eaten.
 */
describe('a stack of multi-use consumables: finishing one copy brings up the next', () => {
  const RATIONS = 'rations';
  const u = { id: 'uses', current: 7, max: 7, resetsOnRest: false };
  const play = (quantity: number, current?: number): PlayState =>
    ({ inventory: [{ instanceId: 'r', itemId: RATIONS, quantity, ...(current != null ? { counters: { uses: { current, max: 7, resetsOnRest: false } } } : {}) }] }) as PlayState;
  const row = (p: PlayState) => p.inventory!.find((i) => i.instanceId === 'r')!;
  const spend = (p: PlayState, n: number) => {
    for (let i = 0; i < n; i++) p = bumpItemCounter(p, 'r', u, -1);
    return p;
  };

  it('the record really is 7 uses a copy (else this test means nothing)', () => {
    expect(db.items[RATIONS]?.counters?.find((c) => c.id === 'uses')).toMatchObject({ max: 7, resetsOnRest: false });
  });

  it('spending the 7th use of ×2 leaves ×1 with 7 uses', () => {
    const p = spend(play(2), 7);
    expect(row(p).quantity).toBe(1);
    expect(row(p).counters?.uses?.current).toBe(7);
  });

  it('a use spent on the next copy comes off that copy', () => {
    const p = spend(play(3), 8);
    expect(row(p).quantity).toBe(2);
    expect(row(p).counters?.uses?.current).toBe(6);
  });

  it('the last copy runs down to empty and stays for the player to remove', () => {
    const p = spend(play(1), 9);
    expect(row(p).quantity).toBe(1);
    expect(row(p).counters?.uses?.current).toBe(0);
  });

  it('restoring a use never takes a copy away', () => {
    const p = bumpItemCounter(play(2, 3), 'r', u, 1);
    expect(row(p).quantity).toBe(2);
    expect(row(p).counters?.uses?.current).toBe(4);
  });

  it('a counter that refills on rest (a wand, a staff) never touches the stack', () => {
    const daily = { id: 'freq', current: 1, max: 1, resetsOnRest: true };
    const p = bumpItemCounter({ inventory: [{ instanceId: 'r', itemId: 'x', quantity: 2 }] } as PlayState, 'r', daily, -1);
    expect(row(p).quantity).toBe(2);
    expect(row(p).counters?.freq?.current).toBe(0);
  });

  it('on the inventory card: two spends in one batch at the last dot roll over once', () => {
    const start: InventoryItem[] = [{ instanceId: 'r', itemId: RATIONS, quantity: 2, counters: { uses: { current: 2, max: 7, resetsOnRest: false } } }];
    function Harness() {
      const [p, setP] = useState<PlayState>({ inventory: start } as PlayState);
      const ch = normalizeCharacter({ id: 'q', name: 'Q', level: 1, classId: 'fighter', keyAbility: 'str', abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, feats: [], inventory: p.inventory } as unknown as Character);
      return <InventoryTab character={ch} content={db} onPlay={(fn) => setP((x) => fn(x))} />;
    }
    const { host, stop } = renderDom(<Harness />);
    const card = () => [...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes('Rations'))!;
    const uses = () => card().querySelector('.inv-uses-n')?.textContent?.replace(/\s+/g, '');
    const qty = () => card().querySelector('.inv-qtystep span')?.textContent;
    expect(uses(), 'fixture: the card shows the copy in hand').toBe('2/7');
    const spendBtn = () => card().querySelector<HTMLButtonElement>('button[aria-label^="Spend a use"]')!;
    act(() => {
      spendBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      spendBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(uses(), 'the next ration did not come up').toBe('7/7');
    if (qty() != null) expect(qty()).toBe('1');
    stop();
  });
});

/**
 * Player Core, Movement Types (rules-2346): "Penalties can't reduce your Speeds below 5 feet unless
 * stated otherwise." Encumbered (condition-70) says it again. The app stopped penalties at 0.
 */
describe('a Speed penalty stops at 5 feet', () => {
  it('the floor itself', () => {
    expect(penaltyFloored(25, -10)).toBe(15);
    expect(penaltyFloored(10, -10)).toBe(5);
    expect(penaltyFloored(5, -10)).toBe(5);
    expect(penaltyFloored(0, -10), 'the floor never raises a Speed').toBe(0);
    expect(penaltyFloored(10, 5)).toBe(15);
  });

  it('an encumbered character with a 10-foot Speed moves 5 feet, not 0', () => {
    const plain = build('fighter', 4, {});
    const anc = db.ancestries[plain.ancestryId!]!;
    const slow = { ...db, ancestries: { ...db.ancestries, [anc.id]: { ...anc, speeds: { ...anc.speeds, land: 10, swim: 10 } } } };
    const enc = { ...plain, conditions: [{ id: 'encumbered' }] } as typeof plain;
    expect(deriveSpeeds(plain, slow).land, 'fixture: the slow ancestry is 10 feet').toBe(10);
    const s = deriveSpeeds(enc, slow);
    expect(s.land).toBe(5);
    expect(s.swim, 'every Speed takes the same floor').toBe(5);
  });

  it('the Speed popup names the floor, and its lines add up', () => {
    const plain = build('fighter', 4, {});
    const anc = db.ancestries[plain.ancestryId!]!;
    const slow = { ...db, ancestries: { ...db.ancestries, [anc.id]: { ...anc, speeds: { ...anc.speeds, land: 10 } } } };
    const enc = { ...plain, conditions: [{ id: 'encumbered' }] } as typeof plain;
    const b = landSpeedResolved(enc, slow);
    expect(b.parts.some((p) => p.label === 'Minimum 5 feet')).toBe(true);
    expect(b.parts.some((p) => p.label === 'Minimum 0')).toBe(false);
    expect(b.parts.reduce((n, p) => n + p.value, 0)).toBe(5);
  });
});
