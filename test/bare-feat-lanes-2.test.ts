import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { applyPlayState, initialPlay, setRestrictedSpell } from '../src/rules/play';
import { bodyRuneExcluded, containerLoads } from '../src/rules/derive';
import { planAttach } from '../src/rules/attachments';
import { resourcesForCharacter, resourceInitial, resourceMax } from '../src/rules/classResources';
import type { InventoryItem } from '../src/rules/types';

const c = () => content();
const live = (ch: ReturnType<typeof build>) => applyPlayState(ch, initialPlay(ch, c()), c());
const ZERO = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } as const;

describe('Spell Combination', () => {
  const wiz = (has: boolean) =>
    build('wizard', 20, {
      subclassId: 'school-of-battle-magic',
      featPicks: has ? { '20:class:0': 'spell-combination' } : {},
    });

  it('makes one slot of each rank from 3rd up a combination slot', () => {
    const entry = live(wiz(true)).spellcasting.find((e) => e.type === 'prepared')!;
    const group = (entry.restrictedSlots ?? []).filter((s) => s.label === 'Combination slots');
    // 3rd through 10th at level 20 — and NOT 1st or 2nd, which the feat excludes by name.
    expect(group.map((s) => s.rank).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(group.every((s) => s.pairs)).toBe(true);
  });

  it('caps each spell at 2 ranks below the slot', () => {
    const entry = live(wiz(true)).spellcasting.find((e) => e.type === 'prepared')!;
    for (const s of (entry.restrictedSlots ?? []).filter((x) => x.label === 'Combination slots')) {
      expect(s.maxRank).toBe(s.rank - 2);
    }
  });

  it('CONVERTS an ordinary slot rather than adding one', () => {
    const plain = live(wiz(false)).spellcasting.find((e) => e.type === 'prepared')!;
    const withIt = live(wiz(true)).spellcasting.find((e) => e.type === 'prepared')!;
    // Rank 5 is a full 3-slot rank at level 20; one of them becomes the combination slot.
    expect(withIt.prepared?.[5]?.length).toBe((plain.prepared?.[5]?.length ?? 0) - 1);
  });

  it('holds a second spell, stored under the slot id + #2', () => {
    const ch = wiz(true);
    let play = initialPlay(ch, c());
    const slotId = (applyPlayState(ch, play, c()).spellcasting.find((e) => e.type === 'prepared')!.restrictedSlots ?? []).find(
      (s) => s.label === 'Combination slots',
    )!.id;
    play = setRestrictedSpell(play, slotId, 'fear');
    play = setRestrictedSpell(play, `${slotId}#2`, 'blur');
    const slot = (applyPlayState(ch, play, c()).spellcasting.find((e) => e.type === 'prepared')!.restrictedSlots ?? []).find(
      (s) => s.id === slotId,
    )!;
    expect([slot.spellId, slot.spellId2]).toEqual(['fear', 'blur']);
  });
});

describe('Living Rune', () => {
  const arch = (rune: string | null) =>
    build('fighter', 8, { featPicks: { '2:class:0': 'runescarred-dedication', '6:class:0': 'living-rune' }, bodyRune: rune });

  it('excludes runes that require an armour type or act on the armour', () => {
    const runes = c().runes ?? {};
    // The `usage` field states the armour requirement exactly.
    expect(bodyRuneExcluded(runes['ready']!, c())).toBe(true); // acts on donning THE ARMOR
    expect(bodyRuneExcluded(runes['portable']!, c())).toBe(true); // folds THE ARMOR away
    expect(bodyRuneExcluded(runes['slick']!, c())).toBe(false); // the wearer's Acrobatics
    expect(bodyRuneExcluded(runes['energy-resistant']!, c())).toBe(false); // the wearer's resistance
    const typeRestricted = Object.values(runes).filter(
      (r) => r.slot === 'armor' && r.kind === 'property' && (c().items[r.id]?.usage ?? '') !== 'etched-onto-armor',
    );
    expect(typeRestricted.length).toBeGreaterThan(5);
    for (const r of typeRestricted) expect(bodyRuneExcluded(r, c())).toBe(true);
  });

  it('records the rune on the character, and only a real armour property rune', () => {
    expect(arch('slick').bodyRune).toBe('slick');
    expect(arch('flaming').bodyRune).toBeUndefined(); // a WEAPON rune has no business on your body
    expect(arch(null).bodyRune).toBeUndefined();
  });
});

describe('Sanguimancer Dedication', () => {
  it('grants a pool that caps at twice your level and refreshes to your level', () => {
    const r = resourcesForCharacter(null, new Set(['sanguimancer-dedication'])).find((x) => x.id === 'sanguimancy-hp');
    expect(r).toBeTruthy();
    expect(resourceMax(r!, 7, ZERO)).toBe(14);
    // A rest restores your level's worth, NOT the cap — a pool that started full would double it.
    expect(resourceInitial(r!, 7, ZERO)).toBe(7);
  });

  it('is not handed to someone who lacks the dedication', () => {
    expect(resourcesForCharacter('fighter', new Set()).some((x) => x.id === 'sanguimancy-hp')).toBe(false);
  });
});

describe('Talismanic Sage', () => {
  const talismanId = Object.values(content().items).find(
    (i) => i.itemType === 'consumable' && i.consumableType === 'talisman' && (i.usage ?? '').includes('weapon'),
  )?.id;

  const inv = (itemId: string, instanceId: string, attachedTo?: string): InventoryItem => ({
    instanceId,
    itemId,
    quantity: 1,
    ...(attachedTo ? { attachedTo } : {}),
    equipped: !attachedTo,
  });

  it('lets ONE item hold two talismans, and only with the feat', () => {
    expect(talismanId).toBeTruthy();
    const inventory = [inv('longsword', 'w1'), inv(talismanId!, 't1', 'w1'), inv(talismanId!, 't2')];
    const attempt = (has: boolean) => {
      const ch = build('fighter', 14, { featPicks: has ? { '14:class:0': 'talismanic-sage' } : {}, inventory: [] });
      return planAttach(c().items[talismanId!]!, inventory[2], c().items.longsword!, inventory[0], inventory, c(), { ...ch, inventory });
    };
    expect(attempt(false).ok).toBe(false);
    expect(attempt(true).ok).toBe(true);
  });

  it('still refuses a THIRD talisman on the same item', () => {
    const inventory = [inv('longsword', 'w1'), inv(talismanId!, 't1', 'w1'), inv(talismanId!, 't2', 'w1'), inv(talismanId!, 't3')];
    const ch = build('fighter', 14, { featPicks: { '14:class:0': 'talismanic-sage' }, inventory: [] });
    const plan = planAttach(c().items[talismanId!]!, inventory[3], c().items.longsword!, inventory[0], inventory, c(), { ...ch, inventory });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/two talismans/);
  });
});

describe('Pack Rat still leaves nested load alone', () => {
  it('does not change what a container reports as USED', () => {
    const ch = build('fighter', 3, {
      ancestryId: 'ratfolk',
      featPicks: { '1:ancestry:0': 'pack-rat' },
      inventory: [
        { instanceId: 'b', itemId: 'backpack', quantity: 1 },
        { instanceId: 'r', itemId: 'rations', quantity: 1 },
      ],
    });
    const loads = containerLoads(ch, c());
    expect(Object.values(loads)[0]?.capacity).toBe(6);
  });
});
