// @vitest-environment jsdom
// bug 2026-09-12 #5: rune-source
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { InventoryTab, RUNE_SOURCE_FEAT } from '../src/sheet/InventoryTab';
import { normalizeCharacter } from '../src/rules/normalize';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * "why does every item has a place to put if it is my rune source, isnt that only for a specific
 * archetype?" — owner, 2026-09-12. It is.
 *
 * WHAT THE RULES SAY. Exactly one record in the whole database creates a rune source, and it is an
 * archetype feat: Cutting Heaven, Crushing Earth (Spirit Warrior, 6th, prerequisite Spirit Warrior
 * Dedication) — *"As long as you have invested and are wearing a set of handwraps of mighty blows,
 * you also apply their runes to a single weapon you're wielding that can be used with your
 * Overwhelming Combination ability."* Its authored note sends the player to this control: "Set the
 * weapon's rune source to your handwraps on the Inventory tab … Offered on a wielded one-handed,
 * agile or finesse melee weapon". Nothing else in core.json mentions a rune source, and
 * `"designated":"rune-source"` appears zero times — it is a player's bookkeeping mark, and it was
 * offered to every character on every object they owned.
 *
 * MEASURED before the fix, on the rendered Inventory tab of a plain 6th-level fighter: the "Rune
 * source" button appeared on all four of longsword / handwraps / leather armor / backpack. After: on
 * none of them, and the empty "This is my" heading goes with it.
 */
const c = content();
const noop = (() => undefined) as never;

const INV: InventoryItem[] = [
  { instanceId: 'w1', itemId: 'longsword', quantity: 1, equipped: true },
  { instanceId: 'h1', itemId: 'handwraps-of-mighty-blows', quantity: 1, worn: true, invested: true },
  { instanceId: 'a1', itemId: 'leather-armor', quantity: 1, worn: true },
  { instanceId: 'b1', itemId: 'backpack', quantity: 1 },
];

/**
 * A 6th-level fighter. `spiritWarrior` gives them the one feat that creates a rune source; `marked`
 * puts the designation on the LEATHER ARMOR — an item both halves of the new gate would otherwise
 * hide, which is what an older save can legitimately hold: the control used to be on every object.
 */
const char = (opts: { spiritWarrior?: boolean; marked?: boolean } = {}): Character =>
  normalizeCharacter({
    id: 'r',
    name: 'R',
    level: 6,
    classId: 'fighter',
    keyAbility: 'str',
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
    feats: opts.spiritWarrior ? [{ featId: RUNE_SOURCE_FEAT, level: 6, category: 'class' }] : [],
    inventory: INV.map((i) => (opts.marked && i.instanceId === 'a1' ? { ...i, designations: ['rune-source' as const] } : i)),
  } as unknown as Character);

/** Open one item's detail card on a rendered Inventory tab and hand back its "This is my" row. */
function openItem(character: Character, name: string) {
  const r = renderDom(<InventoryTab character={character} content={c} onPlay={noop} />);
  const card = [...r.host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes(name));
  expect(card, `no inventory card for ${name}`).toBeTruthy();
  r.click(card!);
  const group = [...r.host.querySelectorAll<HTMLElement>('.sd-uses')].find((g) =>
    /this is my/i.test(g.querySelector('.sd-uses-title')?.textContent ?? ''),
  );
  const btn = group ? [...group.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === 'Rune source') : undefined;
  return { r, group, btn };
}

describe('the "Rune source" mark belongs to the archetype that has one', () => {
  it.each(['Longsword', 'Handwraps of Mighty Blows', 'Leather Armor', 'Backpack'])(
    'is not offered on %s to a character without the feat',
    (name) => {
      const { r, group, btn } = openItem(char(), name);
      expect(btn, 'the mark must not be offered to a character who has no rune source').toBeUndefined();
      // …and the heading must not be left standing over nothing: every other mark here is class-gated
      // too, so on a plain fighter the whole "This is my" row has no reason to render.
      if (group) expect(group.querySelectorAll('button').length, 'an empty "This is my" row').toBeGreaterThan(0);
      r.stop();
    },
  );

  it('IS offered to a Spirit Warrior with Cutting Heaven, Crushing Earth — on the weapon and on the handwraps', () => {
    for (const name of ['Longsword', 'Handwraps of Mighty Blows']) {
      const { r, btn } = openItem(char({ spiritWarrior: true }), name);
      expect(btn, `the feat's own note points the player at this control (${name})`).toBeTruthy();
      expect(btn!.className, 'unmarked, so it offers to set the mark').not.toContain('on');
      r.stop();
    }
  });

  it('is still not offered on armour or a backpack, even to that Spirit Warrior', () => {
    for (const name of ['Leather Armor', 'Backpack']) {
      const { r, btn } = openItem(char({ spiritWarrior: true }), name);
      expect(btn, `${name} can never be a rune source`).toBeUndefined();
      r.stop();
    }
  });

  it('keeps a mark an older save already set, so it can be taken off or moved', () => {
    // The gate must never trap a designation: a character who marked an item before this gate existed
    // (or who has since retrained out of the feat) still sees the control, switched ON, on that item.
    // The armour passes NEITHER half of the gate — no feat, and not a weapon — so it is only on screen
    // because it holds the mark. Both halves are load-bearing here: drop the character-level "or
    // something is already marked" and the kind never reaches the card; drop ItemDetail's
    // already-set clause and the armour filters out.
    const { r, btn } = openItem(char({ marked: true }), 'Leather Armor');
    expect(btn, 'a mark you cannot see is a mark you cannot remove').toBeTruthy();
    expect(btn!.className, 'and it must show as set').toContain('on');
    r.stop();
    // Such a character is demonstrably using the mark, so it stays offered on their WEAPONS — the
    // designation is exclusive, and moving it is the same gesture as clearing it.
    const hw = openItem(char({ marked: true }), 'Handwraps of Mighty Blows');
    expect(hw.btn, 'the mark must be movable, not stuck on the item that happens to hold it').toBeTruthy();
    hw.r.stop();
    // …but the item gate still holds everywhere else: a backpack is not a rune source for anyone.
    const bag = openItem(char({ marked: true }), 'Backpack');
    expect(bag.btn, 'a container can never be a rune source').toBeUndefined();
    bag.r.stop();
  });
});
