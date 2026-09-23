// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { content } from './_content';
import { renderDom } from './_render';
import { InventoryTab } from '../src/sheet/InventoryTab';
import { ItemDetail } from '../src/sheet/ItemDetail';
import { CustomizationEditor } from '../src/sheet/CustomizationEditor';
import { CustomizationContext, DEFAULT_CUSTOMIZATION, effectiveCustomization } from '../src/data/customization';
import { normalizeCharacter } from '../src/rules/normalize';
import type { Character, Customization, InventoryItem } from '../src/rules/types';

/**
 * "Item card detail": one setting, three looks for the same inventory row — Standard (the card as it
 * always was), Compact (one line an item) and Essentials (name + qty/bulk/price, and under it only what
 * changes during play). The owner's ruling is that an ABSENT key means Essentials, so every character
 * that already exists switches to it without anybody editing anything.
 *
 * MUTATION LINE: flip DEFAULT_CUSTOMIZATION.itemCardDetail (src/data/customization.ts) to 'standard'
 * and the two "nobody chose" tests below go red — they are the only guard on that ruling.
 *
 * The smaller cards are not read-only pictures: whatever they still show is still live (equip, invest,
 * charges, the quantity stepper), and whatever they leave out is in the item's own popup. That last
 * clause is the one that can quietly stop being true, so it has its own tests: wielding, wearing,
 * investing and the Doubling Rings picker exist in exactly ONE other place in the app, and a display
 * setting may not be the thing that takes them away.
 */
const c = content();

const INV: InventoryItem[] = [
  { instanceId: 'i-sword', itemId: 'longsword', quantity: 1, equipped: true, runes: { potency: 1 } },
  { instanceId: 'i-potion', itemId: 'healing-potion-minor', quantity: 3 },
  // Plain gear: nothing to equip, nothing to spend, no runes — so Essentials has nothing for line 2.
  { instanceId: 'i-rope', itemId: 'rope', quantity: 1 },
  // Negligible Bulk — 3,030 items in the data have bulk 0. The book prints '—' for it, which is the
  // value under the Standard card's "bulk" heading and a missing-data mark anywhere else.
  { instanceId: 'i-haggis', itemId: 'haggis', quantity: 1 },
  // An inventory row whose item is gone from the data: its own hand-rolled card, which has to follow
  // the same setting or it keeps the Standard shape in the middle of a list that dropped it.
  { instanceId: 'i-ghost', itemId: 'not-a-real-item', quantity: 1 },
];

const character = (over?: Partial<Character>): Character =>
  normalizeCharacter({
    id: 'ic',
    name: 'IC',
    level: 3,
    classId: 'fighter',
    keyAbility: 'str',
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
    feats: [],
    inventory: INV,
    // Vehicles are the other hand-rolled .inv-card, and bulk-EXEMPT — its '—' is a real value, not a
    // placeholder, so the smaller cards drop the whole column rather than printing it.
    companions: [{ id: 'cmp-cart', kind: 'vehicle', typeId: 'cart', name: 'Cart' }],
    ...over,
  } as unknown as Character);

/** Doubling Rings invested + two weapons wielded: the only state in which the rune-copy picker exists. */
const ringsCharacter = (): Character =>
  character({
    inventory: [
      { instanceId: 'i-sword', itemId: 'longsword', quantity: 1, equipped: true },
      { instanceId: 'i-axe', itemId: 'battle-axe', quantity: 1, equipped: true },
      { instanceId: 'i-rings', itemId: 'doubling-rings', quantity: 1, worn: true, invested: true },
    ] as InventoryItem[],
  });

/** A wielded, Battleforged longsword — its own fixture (not the shared INV row) because Battleforged
 *  is ADDITIVE to Wielded/Worn/Invested, not a replacement for one, so it has to sit beside 'Wielded'
 *  rather than fight it for the same `.inv-cdot`. */
const battleforgedCharacter = (): Character =>
  character({
    inventory: [{ instanceId: 'i-sword', itemId: 'longsword', quantity: 1, equipped: true, battleforged: true }] as InventoryItem[],
  });

/** The row the refuter measured the Compact line on: a long name, a live charge count and a second
 *  chip, on a card with room for about one of the two. */
const wandCharacter = (): Character =>
  character({
    inventory: [
      { instanceId: 'i-wand', itemId: 'wand-of-contagious-frailty', quantity: 1, worn: true, battleforged: true },
    ] as InventoryItem[],
  });

/** The tab as the sheet renders it. `custom` absent = no provider at all, i.e. the context default. */
function tab(custom?: Customization, ch: Character = character()): ReactElement {
  const el = <InventoryTab character={ch} content={c} onPlay={() => undefined} />;
  return custom ? <CustomizationContext.Provider value={custom}>{el}</CustomizationContext.Provider> : el;
}

const compact = (ch?: Character) => tab({ ...DEFAULT_CUSTOMIZATION, itemCardDetail: 'compact' }, ch ?? character());
const cards = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.inv-card')];
const card = (host: HTMLElement, name: string) =>
  cards(host).find((e) => (e.querySelector('.inv-name')?.textContent ?? '').includes(name))!;
const buttonTexts = (host: HTMLElement) => [...host.querySelectorAll('button')].map((b) => b.textContent?.trim());

/** Every rule in the shipped stylesheet. A rule body cannot itself contain a brace, so an at-rule's
 *  head never matches and what comes back is the innermost rules — enough for the three selectors read
 *  below, which this file declares once each, outside any media query and with no `!important`
 *  anywhere to reorder them. (jsdom applies no stylesheet and lays nothing out; see the Compact
 *  vehicle-row test for the measurements this stands in for.) */
const RULES = [
  ...readFileSync('src/sheet.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map(([, sel, body]) => ({ sels: sel.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body }));

/** The values `prop` takes inside one rule body, in source order. */
const values = (body: string, prop: string) =>
  [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g'))].map((m) => m[1].trim());

/** Every value declared for `prop` under exactly `sel`, in source order. */
const declared = (sel: string, prop: string) => RULES.filter((r) => r.sels.includes(sel)).flatMap((r) => values(r.body, prop));

/** Every rule under `.inv-card.inv-compact` whose last compound names one of an element's classes —
 *  i.e. everything the shipped stylesheet says about that child of the Compact row. */
const compactRulesFor = (classes: string[]) =>
  RULES.filter((r) =>
    r.sels.some((s) => {
      if (!s.startsWith('.inv-card.inv-compact ')) return false;
      const last = s.split(' ').pop()!;
      // A pseudo-element is a box of its own, not the element: `.inv-cdots::before` is `flex: none`,
      // and folding that into what the stylesheet says about `.inv-cdots` would read as the box itself
      // refusing to give its width back.
      if (last.includes('::')) return false;
      return classes.some((cl) => last.split(':')[0].split(/(?=\.)/).includes('.' + cl));
    }),
  );

/** Every declaration in a rule body as [prop, value], in source order. */
const declarations = (body: string): [string, string][] =>
  [...body.matchAll(/(?:^|;)\s*([-a-z]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]);

/** The `flex` SHORTHAND as a triple. `none` is `0 0 auto`; a lone number is `<grow> 1 0`, and that 0
 *  is the whole point — an item with no basis has no width of its own when the row runs out of room. */
const expandFlex = (v: string) => {
  if (v === 'none') return { grow: '0', shrink: '0', basis: 'auto' };
  const p = v.split(/\s+/);
  const num = (s: string) => /^[\d.]+$/.test(s);
  if (p.length === 1) return num(p[0]) ? { grow: p[0], shrink: '1', basis: '0' } : { grow: '1', shrink: '1', basis: p[0] };
  if (p.length === 2) return num(p[1]) ? { grow: p[0], shrink: p[1], basis: '0' } : { grow: p[0], shrink: '1', basis: p[1] };
  return { grow: p[0], shrink: p[1], basis: p[2] };
};

/** The flex an element ends up with, from EVERY rule aimed at it, in source order — shorthand and
 *  longhands alike. Reading only the shorthand was this guard's own gap: a later `flex-shrink: 0` or
 *  `flex-basis: auto` on its own line breaks the row exactly as `flex: none` does, and the guard would
 *  not have seen it. Starts at the CSS initial value, which is what an element with no flex rule has. */
const flexOf = (rules: { body: string }[]) => {
  const out = { grow: '0', shrink: '1', basis: 'auto' };
  for (const r of rules)
    for (const [prop, v] of declarations(r.body)) {
      if (prop === 'flex') Object.assign(out, expandFlex(v));
      else if (prop === 'flex-grow') out.grow = v;
      else if (prop === 'flex-shrink') out.shrink = v;
      else if (prop === 'flex-basis') out.basis = v;
    }
  return out;
};

describe('item card detail: Standard / Compact / Essentials', () => {
  it('nobody chose → Essentials: bulk and price beside the name, no level line, no bulk column', () => {
    const { host, stop } = renderDom(tab());
    // 5 inventory rows + the vehicle row, every one of them following the setting.
    expect(cards(host).length).toBe(6);
    expect(cards(host).every((e) => e.classList.contains('inv-essentials'))).toBe(true);
    expect(host.querySelector('.inv-sub'), 'the level · price line belongs to Standard only').toBeNull();
    expect(host.querySelector('.inv-bulk'), 'Bulk moved up into the name line').toBeNull();
    expect(card(host, 'Longsword').querySelector('.inv-facts')?.textContent).toBe('1 bulk · 1 gp');
    // 'ea' for the same reason Compact says it: the price printed is the price of ONE potion, and
    // "×3 · L bulk · 4 gp" in one short string otherwise reads as the price of the three.
    expect(card(host, 'Healing Potion').querySelector('.inv-facts')?.textContent).toBe('×3 · L bulk · 4 gp ea');
    stop();
  });

  it('nobody chose, resolved the way the sheet resolves it → still Essentials', () => {
    // effectiveCustomization is what App feeds the provider: baseline + global default + this
    // character's override. Neither of the last two carries the key here.
    expect(effectiveCustomization({}, null).itemCardDetail).toBe('essentials');
    const { host, stop } = renderDom(tab(effectiveCustomization({}, null)));
    expect(cards(host).every((e) => e.classList.contains('inv-essentials'))).toBe(true);
    stop();
  });

  it('Essentials keeps the live controls and the runes, and omits line 2 when there is nothing on it', () => {
    const { host, stop } = renderDom(tab());
    const sword = card(host, 'Longsword');
    const line2 = sword.querySelector('.inv-actions')!;
    expect(line2, 'a wielded, runed weapon has a second line').toBeTruthy();
    expect([...line2.querySelectorAll('button')].map((b) => b.textContent?.trim())).toContain('Wielded');
    expect([...line2.querySelectorAll('.ff-trait.rune')].map((s) => s.textContent)).toEqual(['+1 potency']);
    // The stepper is the same control the Standard card has, still driving the same play update.
    expect(card(host, 'Healing Potion').querySelector('.inv-qtystep')?.textContent).toContain('3');
    const rope = card(host, 'Rope');
    expect(rope.querySelector('.inv-actions'), 'nothing to show → no row at all').toBeNull();
    expect(rope.textContent, 'no placeholder dash stands in for missing data').not.toContain('—');
    stop();
  });

  it('negligible Bulk never prints a dash outside the column it is the value of', () => {
    const facts = (el: ReactElement) => {
      const { host, stop } = renderDom(el);
      const out = card(host, 'Haggis');
      const text = { facts: out.querySelector('.inv-facts')?.textContent ?? '', all: out.textContent ?? '' };
      stop();
      return text;
    };
    // Essentials: the fact is simply absent — "— bulk · 1 gp" reads as a price whose Bulk failed to load.
    expect(facts(tab()).facts).toBe('1 gp');
    expect(facts(tab()).all).not.toContain('—');
    // Compact: the column keeps its width (so the rows stay aligned) and prints nothing.
    const { host, stop } = renderDom(compact());
    const haggis = card(host, 'Haggis');
    expect(haggis.querySelector('.inv-cbulk')?.textContent).toBe('');
    expect(haggis.textContent).not.toContain('—');
    stop();
    // Standard is unchanged: under a "bulk" heading the book's dash IS the printed value.
    const std = renderDom(tab({ ...DEFAULT_CUSTOMIZATION, itemCardDetail: 'standard' }));
    expect(card(std.host, 'Haggis').querySelector('.inv-bulk .inv-bval')?.textContent).toBe('—');
    std.stop();
  });

  it("'standard' is the card as it always was", () => {
    const { host, stop } = renderDom(tab({ ...DEFAULT_CUSTOMIZATION, itemCardDetail: 'standard' }));
    const sword = card(host, 'Longsword');
    expect(sword.classList.contains('inv-essentials')).toBe(false);
    expect(sword.classList.contains('inv-compact')).toBe(false);
    expect(sword.querySelector('.inv-sub')?.textContent).toBe('level 0 · 1 gp');
    expect(sword.querySelector('.inv-bulk .inv-bval')?.textContent).toBe('1');
    expect(sword.querySelector('.inv-facts'), 'the facts line is an Essentials invention').toBeNull();
    expect([...sword.querySelectorAll('.inv-actions button')].map((b) => b.textContent?.trim())).toContain('Wielded');
    stop();
  });

  it("'compact' is one line an item, and the line opens the item", () => {
    const { host, click, stop } = renderDom(compact());
    const sword = card(host, 'Longsword');
    expect(sword.classList.contains('inv-compact')).toBe(true);
    expect(sword.querySelector('.inv-mid'), 'no second line to put anything on').toBeNull();
    expect(sword.querySelector('.inv-cdot')?.textContent).toBe('Wielded');
    expect(sword.querySelector('.inv-cbulk')?.textContent).toBe('1');
    expect(sword.querySelector('.inv-cprice')?.textContent).toBe('1 gp');
    // Per-unit price on a stack, so "4 gp" never reads as the price of all three.
    expect(card(host, 'Healing Potion').querySelector('.inv-cprice')?.textContent).toBe('4 gp ea');
    // What the row doesn't show is a tap away: clicking it opens the item, exactly as a card does.
    expect(host.querySelector('.sd-head-name')).toBeNull();
    click(sword);
    expect(host.querySelector('.sd-head-name')?.textContent).toBe('Longsword');
    stop();
  });

  /*
   * The blocker this lane was sent back for: a Compact row has no action bar, and `toggleItemFlag` was
   * called from nowhere else in the app — so with Compact chosen a player could not wield a weapon,
   * wear armour, invest anything, or take off what was already on. The controls now live in the item's
   * popup, which every mode can open, and these are the tests that keep them there.
   */
  it('Compact: the popup is where you wield, and the row itself offers nothing to lose it from', () => {
    const { host, click, stop } = renderDom(compact());
    const sword = card(host, 'Longsword');
    expect(sword.querySelector('button'), 'a one-line row has no controls on it').toBeNull();
    expect(buttonTexts(host)).not.toContain('Wielded');
    click(sword);
    expect(buttonTexts(host), 'the only way left to stop wielding this').toContain('Wielded');
    stop();
  });

  it('Compact: armour is worn and an invested item is invested from the same popup', () => {
    const { host, click, stop } = renderDom(compact());
    click(card(host, 'Rope'));
    expect(buttonTexts(host), 'rope is neither worn nor wielded — no equip control invented for it').not.toContain('Wear');
    stop();

    const armour = renderDom(compact(character({ inventory: [{ instanceId: 'i-shirt', itemId: 'chain-shirt', quantity: 1 }] as InventoryItem[] })));
    armour.click(card(armour.host, 'Chain Shirt'));
    expect(buttonTexts(armour.host), 'armour is WORN, and a one-line row is the only other place it could be').toContain('Wear');
    armour.stop();

    const rings = renderDom(compact(ringsCharacter()));
    rings.click(card(rings.host, 'Doubling Rings'));
    expect(buttonTexts(rings.host)).toContain('Invested');
    rings.stop();
  });

  it('Compact: the Doubling Rings picker survives — it exists in no other place', () => {
    const { host, click, stop } = renderDom(compact(ringsCharacter()));
    expect(host.querySelector('.inv-runecopy'), 'no room for it on a one-line row').toBeNull();
    click(card(host, 'Longsword'));
    const sel = host.querySelector<HTMLSelectElement>('.inv-runecopy select');
    expect(sel, 'the only control in the app that chooses the source weapon').toBeTruthy();
    expect([...sel!.options].map((o) => o.textContent)).toEqual(['its own runes', 'Battle Axe']);
    stop();
  });

  /*
   * Leftover from this lane's own refuter: Battleforged (InventoryTab's name-line badge, ~line 321)
   * never reached the Compact row or the popup — a smaller card silently dropped a real, if
   * temporary, +1 to the item working. Same rule as the rest of the file: what a smaller card leaves
   * out has to survive in the item's own popup.
   *
   * MUTATION PROOF: drop the `inv.battleforged &&` chip from the Compact branch (InventoryTab.tsx)
   * and the first assertion below goes red; drop it from ItemDetail's Carrying block and the second
   * one does.
   */
  it('Compact: Battleforged survives as its own chip, additive to Wielded rather than replacing it', () => {
    const { host, stop } = renderDom(compact(battleforgedCharacter()));
    const dots = [...card(host, 'Longsword').querySelectorAll('.inv-cdot')].map((e) => e.textContent);
    expect(dots).toContain('Battleforged');
    expect(dots, 'additive, not a swap — the sword is also wielded').toContain('Wielded');
    stop();
  });

  it('Compact: the popup is where Battleforged reads too — its own chip has no room for the "why temporary" title', () => {
    const { host, click, stop } = renderDom(compact(battleforgedCharacter()));
    click(card(host, 'Longsword'));
    const badge = host.querySelector<HTMLElement>('.sd-uses .inv-badge.bf');
    expect(badge?.textContent).toContain('Battleforged');
    expect(badge?.title).toBe('Battleforged: +1 potency until your next daily preparations');
    stop();
  });

  it('the hand-rolled cards — a vehicle, an item whose data is gone — follow the setting too', () => {
    const { host, stop } = renderDom(compact());
    expect(cards(host).every((e) => e.classList.contains('inv-compact'))).toBe(true);
    expect(host.querySelector('.inv-bulk'), 'no card keeps the Standard bulk column').toBeNull();
    expect(host.querySelector('.inv-sub'), 'no card keeps the Standard subline').toBeNull();
    // Neither row has a popup behind it, so the one control each owns travels into every mode.
    expect(card(host, 'Cart').querySelector('button[aria-label="Remove Cart"]')).toBeTruthy();
    expect(card(host, 'Unknown item').querySelector('button[aria-label="Remove item"]')).toBeTruthy();
    // VehicleSiegeSection renders its OWN .inv-grid (it's not part of the item list's grid), so it has
    // to pick up the modifier separately — the leftover this lane was sent back for.
    expect(
      card(host, 'Cart').closest('.inv-grid')?.classList.contains('inv-grid-compact'),
      'the vehicle grid used to sit on a different grid than the item list in Compact',
    ).toBe(true);
    stop();
  });

  /**
   * ...and the row still has to READ. Measured in the dev preview, Compact, with a Cart companion:
   * card 347.1px, `.inv-facts` ("Vehicle · level 0 · AC 10 · Hardness 5 · HP 14/14") 236.7px at
   * `flex: none`, Remove 77.6px — 314.3px of unshrinkable content in the 311.1px the card has inside
   * its padding. `.inv-name` was the only flexible item left, and at `flex: 1` (basis 0) it had no
   * width of its own to keep: getBoundingClientRect().width = 0. The row read
   * "Vehicle · level 0 · AC 10 · Hardness 5 · HP 14/14 [Remove]", a stat line with no item on it, and
   * a Cart and a Chariot were the same row. The identical name+facts+Remove markup in
   * UnknownItemCard's Compact branch collapsed the same way for a long enough item id.
   *
   * After: name 24.75px against text measuring 24.75px (its whole word — a name box even a hundredth
   * of a pixel short of its text ellipsises, which is what a shrink factor on the name, rather than a
   * zero basis on the facts, still produced: "C…"), facts 207.7px and ellipsised, Remove inside the
   * card. With the name long enough to take the row instead, the facts go to 0 and the button stays
   * in the card — so the untruncated string rides on the row's `title`, since these two rows are the
   * ones with no popup to read it in.
   *
   * jsdom has no layout: every number above is unmeasurable here. What a test CAN hold is the rule
   * that produced them, so the two halves below are a DOM assertion for the title and a read of the
   * shipped stylesheet for the flex, and they are named as the proxy they are.
   */
  it('Compact: the vehicle row still says WHICH vehicle — the facts give way to the name, not the reverse', () => {
    const { host, stop } = renderDom(compact());
    const veh = card(host, 'Cart');
    expect(veh.querySelector('.inv-name')?.textContent).toBe('Cart');
    const facts = veh.querySelector('.inv-facts')?.textContent ?? '';
    expect(facts, 'the stat line the name had to share its row with').toContain('Vehicle · level 0');
    // Ellipsised at any width the name needs, and with no popup behind the row, the row itself is
    // where the rest of it has to stay readable.
    expect(veh.title, 'the full stat line, on the row').toBe(facts);
    expect(card(host, 'Unknown item').title, 'same for the other hand-rolled row').toBe(
      'missing data (not-a-real-item)',
    );
    stop();
  });

  /** Every rule aimed at exactly this selector, in source order. */
  const rulesFor = (sel: string) => RULES.filter((r) => r.sels.includes(sel));

  // The layout half, against the stylesheet the app really ships. Compact is ONE line, so there the
  // facts can only be what the row has left over.
  it("inv-compact: the facts are the line's filler and the name keeps its own width", () => {
    const facts = flexOf(rulesFor('.inv-card.inv-compact .inv-facts'));
    expect(
      facts.basis,
      'basis 0: the facts take what the row has LEFT instead of claiming their own width',
    ).toBe('0');
    expect(
      declared('.inv-card.inv-compact .inv-facts', 'min-width'),
      "a flex item's automatic minimum is its min-content width — the whole string, here",
    ).toContain('0');
    expect(flexOf(rulesFor('.inv-card.inv-compact .inv-name')).basis, 'the name has a width of its own to keep').toBe(
      'auto',
    );
    // ...and it only gets to keep it because it stops growing when facts share the line; a growing
    // name with a zero-basis filler beside it would split the free space with it.
    expect(
      RULES.some(
        (r) =>
          r.sels.some((s) => s.includes('.inv-name') && s.includes('.inv-facts')) && /flex-grow\s*:\s*0/.test(r.body),
      ),
      'no rule hands the growing over to the facts',
    ).toBe(true);
  });

  /**
   * Essentials is NOT one line, and talking the facts out of their own width there cost the card the
   * item's price. Its name line also carries `flex: none` badges (Cursed, Battleforged, Monster Part),
   * and with the facts as the only item on the line able to give, two badges took everything:
   * MEASURED at a 375px card on a 36-character name with a Cursed and a Battleforged badge —
   *   before  name 130.04px of 234, `.inv-facts` 0px wide against a string wanting 22px ("L bulk ·
   *           160 gp" was not on the card at all), the name line 88.54px tall because a 0px-wide facts
   *           box wraps its own text into a column. At a 251px desktop card the name was 25.62 of 234.
   *   after   the facts take a line of their own: 192.65px and whole, the name whole at 233.86px, the
   *           line 49px tall. Ordinary rows measured identical either way (Longsword, Rope, Chain
   *           Shirt, and the Cart stat line: facts still on line 1 at the right edge, 20.25px tall).
   *
   * MUTATION PROOF: drop `flex-wrap: wrap` from `.inv-card.inv-essentials .inv-name-line`, or the
   * `flex-basis: auto` from `.inv-card.inv-essentials .inv-facts` (src/sheet.css), and this goes red.
   */
  it('inv-essentials: the facts take a line of their own rather than the name\'s width — or nothing', () => {
    expect(
      declared('.inv-card.inv-essentials .inv-name-line', 'flex-wrap'),
      'the line has to be able to wrap, or the facts are still the only thing on it that can give',
    ).toContain('wrap');
    const facts = flexOf(rulesFor('.inv-card.inv-essentials .inv-facts'));
    expect(facts.basis, 'a width of their own is what makes them wrap instead of shrink to nothing').toBe('auto');
    expect(Number(facts.grow), 'still the item that grows, so on a roomy row they sit at the right edge').toBeGreaterThan(0);
    expect(
      declared('.inv-card.inv-essentials .inv-facts', 'min-width'),
      'a facts string longer than the whole line still has to ellipsise rather than push the card open',
    ).toContain('0');
    expect(flexOf(rulesFor('.inv-card.inv-essentials .inv-name')).basis, 'the name has a width of its own to keep').toBe(
      'auto',
    );
  });

  /**
   * The same rule for the STATE CHIPS, which is where it broke next: "Battleforged" is a 91.3px word
   * and it was `flex: none`, so the row's only flexible item was the name again. Making each chip its
   * own `flex: 1 1 0` filler fixed the name and broke the chips instead — the leftover was split
   * EQUALLY, which is nothing to do with what any of them needs, so a short chip was clipped
   * ("WIELD…") beside a longer one with slack, and on a tight row every chip shrank to its padding and
   * showed one letter: "B", "W", and "Invested 3/3" as "INV…", deleting the live charge count first.
   *
   * So the chips share ONE box that is the filler, keep their own widths inside it, and a chip that
   * does not fit wraps out of a one-pill-tall clip. That still left the LEADING chip a stub — a flex
   * line always keeps its first item however little of it fits, so the first chip could not wrap and
   * was squeezed instead: 6px of label beside a whole "1/1", a pill holding nothing but a clipped
   * number, a 1.22px sliver of border. `.inv-cdots::before` is a zero-width item ahead of them, so the
   * chips are never first and every one of them is on the row whole or not at all.
   *
   * MEASURED in the dev preview (Compact, probe rows built from this same markup so the shipped
   * stylesheet lays them out), 1280px window → 1028px grid → 340px cards:
   *   Greater Striking Longsword · Wand of Contagious Frailty · Greater Cloak of Elvenkind ·
   *     Breastplate of Command · Ring of Wizardry (Type I) · Greater Bracers of Armor · +1 Striking
   *     Frost Longsword, each with one "Wielded" chip — every name WHOLE, every chip 60.11px with its
   *     label whole (45 of 45) and NOT on the row: leftovers of 34.12–52.52px, all short of a pill.
   *     The same seven rows shipped-before read "Wi…"/"Wield…" — 19–37px of a 45px label.
   *   Longsword (65.22px) — leftover 60.11, "Wielded" whole and ON the row; add Battleforged and the
   *     second chip (91.29px against 133.63px of leftover) wraps away whole.
   *   Wand of Widening Lightning Bolt (31 characters) + "Worn 1/1" — name whole at 197.63, leftover
   *     1.22px, nothing on the row; shipped-before that 1.22px was a sliver of pill border.
   *   Staff of Fire + "Invested 3/3" + Battleforged + Affixed — "Invested 3/3" whole at 84.29 with its
   *     count whole at 16.45, the other two wrapped away.
   *   A 60-character name + those three chips — leftover 0, no chip on the row, name ellipsised at
   *     198.86 of 381; all three sentences on the row's `title`.
   *   The boundary, swept at 0.5px with the box width forced: 56→60px of leftover shows NOTHING, 60.5px
   *     shows the whole 60.11px pill. No width puts part of a chip on the row.
   *   At 375px (355.43px cards) every row above reads the same way, and rows with no chips are
   *     untouched (Rope 206.86 / 222.29; the price 10.57px inside the card everywhere, chips or none).
   *
   * The CEILING, with what it costs: where the leftover is narrower than one whole pill the row shows
   * NO chip — name and the two columns, exactly like an item with no state at all. The sentences are
   * then on the row's own `title` (asserted below) and in the popup the row opens, and an invested item
   * still reads through the card's accent border.
   *
   * jsdom lays nothing out, so every number above is unmeasurable here. What this holds is the
   * MECHANISM, read off the shipped stylesheet for the children the app really renders: nothing on a
   * Compact row except the name and the two fixed columns may hold a width of its own.
   *
   * MUTATION PROOF, each one measured in the preview before it was written down:
   *   `.inv-card.inv-compact .inv-cdots` at `flex: none` (or a bare `flex-shrink: 0` / `flex-basis:
   *     auto`) — the flex half of the first test goes red; drop its `overflow: hidden` AND its
   *     `min-width: 0` and the brake half does (either alone genuinely holds: forcing `min-width: auto`
   *     measured no change, forcing `overflow: visible` no change, both gone → the box claims its
   *     min-content, 91.29px, and the name is cut to 122.99 of 160.33).
   *   `content: none` on the ::before — the leading chip is back on line 1 and CUT: 53.96px of a
   *     65.24px pill with "1/1" down to 9.67 of 13.38, and on the 31-character wand 16.65px of pill
   *     with the count at 0. That is the shipped-before defect, exactly.
   *   `row-gap: 14px` (under the 18px clip) — the wrapped chip shows a 4px sliver.
   *   `.inv-cdot { flex: 1 1 0 }` — both chips back on line 1 at 23.97px each, labels wanting 33 and 76.
   *   `.inv-cdots { flex-wrap: nowrap }` — chip 2 clipped mid-pill on the line.
   * A chip's flex-SHRINK is not asserted, because with a zero-width item ahead of them a chip that
   * would have to shrink has already wrapped: putting `flex: 0 1 auto` back on `.inv-cdot` measured
   * every chip in the same place, shrunk only on the line that is out of sight. Grow and basis are the
   * two that still move the row, and those are what the test reads.
   */
  const ROW_EXEMPT: Record<string, string> = {
    'inv-name': 'the thing the rule protects',
    'inv-cbulk': 'a fixed column, 34px',
    'inv-cprice': 'a fixed column, 62px',
    // "×2" is 20px and ellipsising a two-character count says nothing, so it keeps the `flex: none` of
    // the shared .inv-qty rule the Standard/Essentials name line uses. It cannot collapse a name.
    'inv-qty': 'a two-character count, 20px, shared with the other two modes',
  };

  it('Compact: only the name and the two columns may hold width — the chips are one filler between them', () => {
    const { host, stop } = renderDom(compact(battleforgedCharacter()));
    const row = card(host, 'Longsword');
    const kids = [...row.children] as HTMLElement[];
    // Without this the assertions below are happy on a row that renders no chips at all.
    expect(row.querySelectorAll('.inv-cdot').length, 'the row this is about').toBe(2);
    expect(
      kids.filter((e) => e.classList.contains('inv-cdot')),
      'a chip is never a claim on the row itself — it lives in the box',
    ).toEqual([]);
    const box = kids.find((e) => e.classList.contains('inv-cdots'))!;
    expect(box, 'the chips share one box').toBeTruthy();
    expect([...box.children].every((e) => e.classList.contains('inv-cdot')), 'and nothing else is in it').toBe(true);
    for (const el of kids) {
      const classes = [...el.classList];
      if (classes.some((cl) => cl in ROW_EXEMPT)) continue;
      const rules = compactRulesFor(classes);
      expect(rules.length, `${el.className}: the stylesheet says nothing about it`).toBeGreaterThan(0);
      const flex = flexOf(rules);
      expect(flex.shrink, `${el.className} has to be able to give its width back`).not.toBe('0');
      expect(
        flex.basis,
        `${el.className} may not claim a width of its own — basis 0, the filler pattern .inv-facts uses`,
      ).toBe('0');
      // A flex item's automatic minimum is its min-content width — for this box, every chip laid end
      // to end. One of these two has to declare that away or the box takes that width off the name
      // (measured: the name cut to 107.56px of 160 with both gone, and unchanged with either alone).
      const props = rules.flatMap((r) => declarations(r.body));
      expect(
        props.some(([p, v]) => (p === 'min-width' && parseFloat(v) === 0) || (p === 'overflow' && v === 'hidden')),
        `${el.className}: nothing declares away its min-content minimum`,
      ).toBe(true);
    }
    stop();
  });

  it('Compact: a chip is on the row whole or not at all, and what the row cannot print it still says', () => {
    const { host, stop } = renderDom(compact(wandCharacter()));
    const row = card(host, 'Wand of Contagious Frailty');
    const chips = [...row.querySelectorAll<HTMLElement>('.inv-cdot')];
    // Order IS the priority: the box fills from the left and the rest wrap out of sight, so state and
    // charges — the things that change during play — go first.
    expect(chips.map((e) => e.textContent)).toEqual(['Worn1/1', 'Battleforged']);
    const state = chips[0];
    expect([...state.children].map((e) => e.className), 'two spans, so "Worn 1/1" is spaced by the pill').toEqual([
      'inv-clbl',
      'inv-cnum',
    ]);
    expect(state.querySelector('.inv-cnum')?.textContent).toBe('1/1');
    expect(state.title, 'the whole sentence, on the chip').toBe('Worn 1/1');
    // A pill the row has no width for is not on the row at all — so the row itself carries every
    // sentence, which is the only way to read one without opening the item.
    expect(row.title, 'every chip, whether or not the row could print it').toBe('Worn 1/1 · Battleforged');
    // ...and the stylesheet half of "whole or not at all".
    const box = Object.fromEntries(rulesFor('.inv-card.inv-compact .inv-cdots').flatMap((r) => declarations(r.body)));
    const before = Object.fromEntries(rulesFor('.inv-card.inv-compact .inv-cdots::before').flatMap((r) => declarations(r.body)));
    // A pseudo-element with no `content` generates no box at all, and the first chip is first again.
    expect(before['content'], 'something has to be ahead of the chips, or the first one cannot wrap').toBeDefined();
    expect(parseFloat(before['width']), 'and it may not cost the row a pixel').toBe(0);
    expect(
      parseFloat(before['margin-right']),
      'nor the gap it would otherwise put before chip 1 — what a chip is measured against is the box',
    ).toBe(-parseFloat(box['column-gap']));
    expect(box['flex-wrap'], 'a chip that does not fit has to leave the line').toBe('wrap');
    expect(box['overflow'], 'and the line it leaves for has to be out of sight').toBe('hidden');
    const chip = flexOf(compactRulesFor(['inv-cdot']));
    expect(chip.grow, 'a chip keeps its own width — no equal shares').toBe('0');
    expect(chip.basis, 'and a basis of 0 is that same equal split by another name').toBe('auto');
    // The clip has to fit one pill exactly: tall enough for the pill, and low enough that the wrapped
    // line starts under it — measured from 0, because the line the chips wrap off can be empty (the
    // ::before has no height) and then the next one starts at exactly `row-gap`.
    const pill = Object.fromEntries(rulesFor('.inv-card.inv-compact .inv-cdot').flatMap((r) => declarations(r.body)));
    const pillHeight = parseFloat(pill['line-height']) + 2 * parseFloat(pill['padding']) + 2 * parseFloat(pill['border']);
    expect(parseFloat(box['max-height']), 'a clip shorter than the pill would cut the chips that DO fit').toBeGreaterThanOrEqual(pillHeight);
    expect(
      parseFloat(box['row-gap']),
      'a gap under the clip shows a sliver of the chip that dropped out',
    ).toBeGreaterThanOrEqual(parseFloat(box['max-height']));
    stop();
  });

  it('the Customization editor offers the three options and writes the key', () => {
    const calls: [string, unknown][] = [];
    const { host, click, stop } = renderDom(
      <CustomizationEditor
        value={{}}
        base={DEFAULT_CUSTOMIZATION}
        scope="global"
        onChange={(k, v) => calls.push([k, v])}
      />,
    );
    // Scoped to its own row: "Compact" is also the name of an interface Style further up the page.
    const label = [...host.querySelectorAll<HTMLElement>('.menu-label')].find((e) => e.textContent === 'Item card detail');
    expect(label, 'the setting has to be findable').toBeTruthy();
    const chips = [...label!.nextElementSibling!.querySelectorAll<HTMLButtonElement>('button.chip')];
    expect(chips.map((b) => b.textContent?.trim())).toEqual(['Essentials', 'Compact', 'Standard']);
    expect(chips[0].className, 'the default reads as the one chosen').toContain('active');

    click(chips[1]);
    expect(calls.at(-1)).toEqual(['itemCardDetail', 'compact']);
    click(chips[2]);
    expect(calls.at(-1)).toEqual(['itemCardDetail', 'standard']);
    // Choosing the baseline again clears the field, so the character/device goes back to inheriting it.
    click(chips[0]);
    expect(calls.at(-1)).toEqual(['itemCardDetail', undefined]);
    stop();
  });
});

/**
 * The ten-item investment cap, in the popup that now carries the Invest control.
 *
 * `toggleItemFlag` enforces nothing — the cap has always been the CALLER's guard — and this popup is
 * opened from THREE places: the Inventory tab, the Spells tab's item-spell section (every staff, wand
 * and worn item that grants spells) and the vitals rail's shield. Only the first of them knows how many
 * items are invested, so the count is derived inside ItemDetail from the inventory it is already given.
 * These tests render it the way the other two do — no count, no limit, nothing but the inventory.
 *
 * MUTATION LINE: make countInvested() return 0 and the first test goes red; drop the investmentGroup
 * clause and the last one does.
 */
describe('the invest cap holds in the item popup, wherever it was opened from', () => {
  const invested = (itemId: string, n: number): InventoryItem[] =>
    Array.from({ length: n }, (_, i) => ({ instanceId: `${itemId}-${i}`, itemId, quantity: 1, invested: true }) as InventoryItem);
  const spare: InventoryItem = { instanceId: 'i-spare', itemId: 'doubling-rings', quantity: 1 };

  /** ItemDetail with exactly the props SpellsTab and VitalsRail pass it. */
  const popup = (inventory: InventoryItem[], ch?: Character) => (
    <ItemDetail
      inv={spare}
      item={c.items['doubling-rings']}
      content={c}
      inventory={inventory}
      character={ch}
      onPlay={() => undefined}
      onClose={() => undefined}
    />
  );
  const investChip = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLButtonElement>('.sd-uses .ec-chip')].find((b) => b.textContent?.trim() === 'Invest');

  it('the 11th item cannot be invested from a popup nobody told the count to', () => {
    const { host, stop } = renderDom(popup([...invested('doubling-rings', 10), spare]));
    expect(investChip(host)?.disabled, 'ten are already invested').toBe(true);
    expect(investChip(host)?.title).toBe('You can invest at most 10 items');
    stop();
  });

  it('…and can be at nine, or at eleven with Incredible Investiture', () => {
    const nine = renderDom(popup([...invested('doubling-rings', 9), spare]));
    expect(investChip(nine.host)?.disabled).toBe(false);
    nine.stop();
    // The feat raises the cap to 12 — read off the character, so a popup handed one is right about it.
    const feat = renderDom(popup([...invested('doubling-rings', 10), spare], { ...character(), investedLimit: 12 }));
    expect(investChip(feat.host)?.disabled).toBe(false);
    feat.stop();
  });

  it('a chest of medals still costs one slot between them', () => {
    // "No matter how many magical medals you have, they collectively count as one invested item."
    const { host, stop } = renderDom(popup([...invested('magical-medals', 10), spare]));
    expect(investChip(host)?.disabled, 'ten medals are one investment, so nine slots are free').toBe(false);
    stop();
  });
});
