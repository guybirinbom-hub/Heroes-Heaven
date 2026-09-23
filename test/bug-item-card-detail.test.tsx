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
 * "Compact rows" and "Inventory layout" — the owner's ruling of 2026-09-23, after a picture of three
 * narrow columns beside one wide row. Two more settings beside "Item card detail", per character and
 * global exactly like it, and ABSENT is what every character that already exists carries — so
 * `compactColumns` is a CHANGE to those characters, not a no-op: 'three' is what shipped, nobody has
 * the key, and every character on the Compact look moves to one wide row on upgrade. That is the
 * ruling; `inventoryLayout` is the half that changes nothing.
 *
 *   compactColumns   absent = 'one'   one full-width Compact row an item. Width is the whole point on a
 *                                     computer: a single column is three times the 300px cell, so every
 *                                     state chip fits beside any name. At 375 the 300px auto-fill draws
 *                                     that same single track, so 'one' buys nothing there in WIDTH — the
 *                                     2026-09-23 correction is what it buys instead: a chip that does not
 *                                     fit beside the name wraps onto a second line rather than waiting in
 *                                     the popup. 'three' is the grid as it shipped, clip and all — there a
 *                                     chip still either fits on the one line or waits.
 *   inventoryLayout  absent = 'grid'  the equal cells as they shipped. 'flow' sizes every card to its own
 *                                     contents and wraps them across the width like words in a paragraph
 *                                     — in all three looks — and for a Compact row never hides a chip
 *                                     either, the same correction as 'one'.
 *
 * MUTATION LINES: flip DEFAULT_CUSTOMIZATION.compactColumns to 'three', or .inventoryLayout to 'flow'
 * (src/data/customization.ts), and the first test below goes red — it is the only guard on the two
 * defaults. Delete either `.inv-flow` override rule in src/sheet.css and the stylesheet tests do; put
 * `max-height`/`overflow` back on the `.inv-grid-1col` or `.inv-flow` override of `.inv-cdots` and the
 * clip guard below does too.
 */
describe('compact rows + inventory layout', () => {
  /** Every card container in the tab. There is more than one — Equipped, Carried and the hand-rolled
   *  vehicle/siege section each render their OWN `.inv-grid`, and they used to drift apart. */
  const grids = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.inv-grid')];
  const gridClasses = (over: Partial<Customization>) => {
    const { host, stop } = renderDom(tab({ ...DEFAULT_CUSTOMIZATION, ...over }));
    const out = grids(host).map((g) => [...g.classList]);
    stop();
    expect(out.length, 'the item sections and the vehicle section, all of them').toBeGreaterThanOrEqual(3);
    return out;
  };
  const everyGrid = (over: Partial<Customization>, cls: string) => gridClasses(over).every((c) => c.includes(cls));

  it('nobody chose → one full-width Compact row, and the ordinary grid', () => {
    // Resolved the way the sheet resolves it: baseline + global default + this character's override,
    // with neither of the last two carrying either key.
    expect(effectiveCustomization({}, null).compactColumns).toBe('one');
    expect(effectiveCustomization({}, null).inventoryLayout).toBe('grid');
    const cls = gridClasses({ itemCardDetail: 'compact' });
    expect(cls.every((c) => c.includes('inv-grid-1col')), 'one row an item, on every section').toBe(true);
    expect(cls.some((c) => c.includes('inv-flow')), 'and the cards still lie in a grid').toBe(false);
  });

  it('each value puts its own class on every section, and the column choice is Compact’s alone', () => {
    expect(everyGrid({ itemCardDetail: 'compact', compactColumns: 'one' }, 'inv-grid-1col')).toBe(true);
    expect(gridClasses({ itemCardDetail: 'compact', compactColumns: 'three' }).some((c) => c.includes('inv-grid-1col')))
      .toBe(false);
    expect(everyGrid({ itemCardDetail: 'compact', compactColumns: 'three' }, 'inv-grid-compact')).toBe(true);
    // The taller cards read fine three across, so 'one' means nothing to them — and must not silently
    // squeeze them into a single column.
    for (const look of ['essentials', 'standard'] as const) {
      const cls = gridClasses({ itemCardDetail: look, compactColumns: 'one' });
      expect(cls.some((c) => c.includes('inv-grid-1col')), `${look} is not a Compact row`).toBe(false);
      expect(cls.some((c) => c.includes('inv-grid-compact'))).toBe(false);
    }
    // Flow applies to all three looks.
    for (const look of ['essentials', 'standard', 'compact'] as const)
      expect(everyGrid({ itemCardDetail: look, inventoryLayout: 'flow' }, 'inv-flow'), look).toBe(true);
    expect(gridClasses({ inventoryLayout: 'grid' }).some((c) => c.includes('inv-flow'))).toBe(false);
  });

  /**
   * The Equipped / Carried / container sections, the container drag targets, the Bulk-load chip,
   * drag-to-attach and right-click→popup all have to keep working in every combination. They do,
   * because none of them is written against the grid's geometry: the handlers live on the CARD (one
   * `rootProps` object in InventoryTab, shared by all three looks) and the sections are `.inv-group`,
   * outside the grid entirely. This is that claim as a test — flow changes the BOX and nothing else.
   */
  it('flow changes the box and nothing else — the cards keep every attribute and handler they had', () => {
    const html = (inventoryLayout: 'grid' | 'flow') => {
      const { host, stop } = renderDom(tab({ ...DEFAULT_CUSTOMIZATION, itemCardDetail: 'compact', inventoryLayout }));
      const out = host.innerHTML;
      stop();
      return out;
    };
    expect(html('flow').replace(/ inv-flow/g, ''), 'the grid’s className is the whole diff').toBe(html('grid'));
    // …and the drag attributes really are on the cards, so the assertion above is not passing on a
    // tab that has no drag sources in either layout.
    const { host, click, stop } = renderDom(
      tab({ ...DEFAULT_CUSTOMIZATION, itemCardDetail: 'compact', inventoryLayout: 'flow' }),
    );
    expect(cards(host).filter((e) => e.getAttribute('draggable') === 'true').length).toBeGreaterThan(0);
    // The row still opens the item, which is where a Compact row's controls are.
    click(card(host, 'Longsword'));
    expect(host.querySelector('.sd-head-name')?.textContent).toBe('Longsword');
    stop();
  });

  /** Every rule aimed at exactly this selector, in source order. */
  const rulesFor = (sel: string) => RULES.filter((r) => r.sels.includes(sel));

  /**
   * …and the column's MINIMUM is 0, not `auto`. A bare `1fr` is `minmax(auto, 1fr)`, and that `auto`
   * makes the column at least the widest row's min-content — which a Compact row, with a nowrap facts
   * string on it, can take past the width of a phone. MEASURED at 375px on the Cart row (name + the
   * vehicle stat line + a Remove button): the column stood at 390px inside a 355px section and the row
   * ran off the right edge. The three-column grid never showed it because its own `minmax(300px, 1fr)`
   * already put a floor under the track.
   */
  it('compact rows "one": a single full-width column, over the three-column grid', () => {
    expect(declared('.inv-grid.inv-grid-compact.inv-grid-1col', 'grid-template-columns')).toEqual(['minmax(0, 1fr)']);
    // It is written as a strictly longer selector than the rule it overrides, so it wins on specificity
    // wherever either sits in the file.
    expect(declared('.inv-grid.inv-grid-compact', 'grid-template-columns')[0], 'the three-column grid it beats')
      .toContain('300px');
  });

  it('flow: the box wraps like a paragraph and the cards are sized to their own contents', () => {
    const box = Object.fromEntries(rulesFor('.inv-grid.inv-flow').flatMap((r) => declarations(r.body)));
    expect(box['display'], 'a grid of equal cells cannot size a cell to its contents').toBe('flex');
    expect(box['flex-wrap'], '…and the cards have to wrap across the width like words').toBe('wrap');
    const cardRules = rulesFor('.inv-grid.inv-flow > .inv-card');
    const flex = flexOf(cardRules);
    expect(flex.basis, 'basis auto IS "exactly as wide as its own name and tags"').toBe('auto');
    expect(flex.grow, 'a card that grows is back to equal cells by another name').toBe('0');
    const cardCss = Object.fromEntries(cardRules.flatMap((r) => declarations(r.body)));
    expect(cardCss['max-width'], 'one enormous name may not widen the page').toBe('100%');
    expect(parseFloat(cardCss['min-width']), 'a two-word item is still a card, not a stub').toBeGreaterThan(0);
    // Bulk and price are pinned out of flow in this mode too (position: absolute, at the row's own
    // fixed 34px/62px widths) — asserted in the "compact rows + inventory layout" pinning test below,
    // not here: a content-sized card has nothing left to decide about a child that isn't in its flow.
  });

  /**
   * The rule that makes flow work at all, and the one that would break it silently.
   *
   * The grid's cells are a fixed width, so somebody on the row has to give: `.inv-mid`, and Compact's
   * `.inv-facts` and `.inv-cdots`, are all `flex-basis: 0` — they ask for no width of their own and
   * take what is left after the name. A card sized to its OWN contents has nothing to decide, and
   * there a zero basis asks for no width and gets none: the facts, and every state chip, would simply
   * not be on the card. So flow hands all three their width back — which is also what widens the
   * window in which every Compact chip is on the row: a box laid out at its own contents has nothing
   * wrapping into the 18px clip (at 1280, no chip is hidden in Compact + flow, on any row).
   *
   * What happens once a row IS squeezed — `max-width: 100%` clamping the card back to the section — is
   * the next test's job, not this one's: this one is only the three fillers getting their width back.
   */
  it('flow: the three fillers take their own width back, or the row prints nothing but a name', () => {
    for (const tail of ['.inv-mid', '.inv-card.inv-compact .inv-facts', '.inv-card.inv-compact .inv-cdots']) {
      expect(flexOf(rulesFor(tail)).basis, `${tail} is the grid’s filler`).toBe('0');
      // Read on its OWN, not folded into the rule above in source order: the override adds two classes
      // to the same subject, so it is strictly more specific and wins wherever either sits in the file
      // (`.inv-mid`'s own rule is a thousand lines further down, and still loses).
      const override = rulesFor('.inv-grid.inv-flow ' + tail);
      expect(override.length, `nothing hands ${tail} its width back in flow`).toBeGreaterThan(0);
      expect(
        flexOf(override).basis,
        `${tail} has to hold its own width once the card is sized to its contents`,
      ).toBe('auto');
    }
  });

  /**
   * The 2026-09-23 correction itself: a squeezed row — `.inv-grid-1col` at any width, or `.inv-flow`
   * once `max-width: 100%` clamps the card back to the section — no longer throws a chip away. Its
   * override reads on its OWN selector, not folded into the base rule in source order: CSS wins on
   * SPECIFICITY, and none of the inventory-card rules carries `!important` to reorder that (the
   * stylesheet uses it elsewhere), so the override has to be the strictly longer selector for either
   * of these to mean anything.
   * 'three' gets neither override, so the base rule every Compact row starts from — the clip Compact
   * has always had — is exactly what is left for it: a chip that does not fit still waits in the popup,
   * unchanged.
   *
   * MUTATION: put `max-height: 18px` / `overflow: hidden` back on either override below (or delete the
   * override rule outright) and this goes red — it is the only guard on the fix.
   */
  it('compact rows "one" and flow lift the chip clip — "three" keeps it', () => {
    for (const sel of [
      '.inv-grid.inv-grid-compact.inv-grid-1col .inv-card.inv-compact .inv-cdots',
      '.inv-grid.inv-flow .inv-card.inv-compact .inv-cdots',
    ]) {
      expect(declared(sel, 'max-height'), sel).toEqual(['none']);
      expect(declared(sel, 'overflow'), sel).toEqual(['visible']);
    }
    expect(declared('.inv-card.inv-compact .inv-cdots', 'max-height'), 'the three-column rule').toEqual(['18px']);
    expect(declared('.inv-card.inv-compact .inv-cdots', 'overflow'), 'the three-column rule').toEqual(['hidden']);
  });

  /**
   * PART 2 of the 2026-09-23 correction (owner feedback: a row with any chip was ALWAYS two lines, even
   * at a desktop width with room for all of them on one). The clip guard above still holds — that half
   * never changed — but 'one' and flow no longer need name + qty + bulk + price grouped into a wrapper
   * box either: the same flat markup 'three' always rendered now works in every mode, because the FIX
   * moved entirely into the stylesheet — the DOM is identical, only the surrounding grid class differs
   * (InventoryTab's `gridClass()`).
   */
  it('the row markup is flat and identical in "one", "three" and flow alike — the fix is CSS-only', () => {
    const rowClasses = (over: Partial<Customization>) => {
      const { host, stop } = renderDom(
        tab({ ...DEFAULT_CUSTOMIZATION, itemCardDetail: 'compact', ...over }, wandCharacter()),
      );
      const out = [...card(host, 'Wand of Contagious Frailty').children].map((e) => e.className);
      stop();
      return out;
    };
    // Name, then the chip box, then the two fixed columns — a screen reader hits the name first no
    // matter which of the three combinations rendered the row.
    const flat = ['inv-name', 'inv-cdots', 'inv-bval inv-cbulk', 'inv-cprice'];
    expect(rowClasses({}), 'one (the default)').toEqual(flat);
    expect(rowClasses({ compactColumns: 'three' }), 'three').toEqual(flat);
    expect(rowClasses({ compactColumns: 'three', inventoryLayout: 'flow' }), 'flow').toEqual(flat);
  });

  /**
   * The stylesheet half of PART 2, on the ROW itself: `flex-wrap` (name and the chip box are ordinary
   * flex siblings again — the chip box wraps to its own line only when it doesn't fit beside the name,
   * instead of always sitting under it), `position: relative` (the containing block bulk/price pin
   * against), and the reservation that holds line 1 off the pinned columns.
   *
   * That reservation has to be `padding-right` on the ROW. Padding shortens the LINE BOX, so every item
   * line 1 places — the name, the ×N badge, and the chip box's own fit-or-wrap decision — is measured
   * against a line that already stops short of bulk and price. A `margin-right` on whichever of name/qty
   * is line 1's last item, which is what this fix shipped first, does NOT: a sibling's margin is a gap
   * BETWEEN the name and the chip box, not floor space at the END of the line, so the chip box simply
   * started further along and ran onto the pinned strip anyway. MEASURED at 375 on the ordinary
   * `Wand of Contagious Frailty` row — 26 characters carrying nothing but its own `1/1` charge chip —
   * chip box 302.9–331.4 inside a price box at 292.9–354.9, i.e. `1/1` printed across `160 gp`; at 1280
   * the same collision over a window of name lengths; in flow, structurally, at every width and every
   * name, a content-sized card's right edge being the chip box's own.
   *
   * So this test is ARITHMETIC over the shipped numbers rather than a reading of declarations: it lays
   * the row out on paper — line 1's flow area from the row's own padding, the two pinned columns from
   * their own `right`/`width` — and asserts that the two cannot meet at any card width. (jsdom applies
   * no stylesheet and lays nothing out; live, at 375 and 1280, in all four mode combinations, the chip
   * box's closest approach to the Bulk column over a 10→160-character name sweep was 8.7px, and it never
   * crossed.)
   *
   * MUTATION: put `flex-direction: column` back on either row selector in src/sheet.css (the
   * unconditional stack this lane replaces) and the first assertion goes red; drop the `padding-right`,
   * shrink it, or move it back onto a sibling's `margin-right`, and the geometry does.
   */
  it('compact rows "one" and flow: line 1 stops short of the pinned columns — a chip cannot land on the price', () => {
    const px = (v: string | undefined) => {
      expect(v, 'the row cannot be laid out without this number').toBeTruthy();
      return parseFloat(v!);
    };
    const gap = px(declared('.inv-card.inv-compact', 'gap')[0]);
    const padLeft = px(declared('.inv-card.inv-compact', 'padding')[0].split(/\s+/)[1]);
    const bulkW = px(declared('.inv-card.inv-compact .inv-cbulk', 'width')[0]);
    const priceW = px(declared('.inv-card.inv-compact .inv-cprice', 'width')[0]);
    const W = 1000; // any card width: every edge below is measured from one of its own two borders
    for (const grid of ['.inv-grid.inv-grid-compact.inv-grid-1col', '.inv-grid.inv-flow']) {
      const row = `${grid} .inv-card.inv-compact:has(> .inv-cbulk)`;
      expect(declared(row, 'flex-direction'), `${row}: no more unconditional stacking`).toEqual([]);
      expect(declared(row, 'flex-wrap'), row).toEqual(['wrap']);
      expect(declared(row, 'position'), row).toEqual(['relative']);
      // The two pinned columns, placed from the card's RIGHT border by their own `right` and width.
      const priceLeft = W - px(declared(`${grid} .inv-card.inv-compact .inv-cprice`, 'right')[0]) - priceW;
      const bulkLeft = W - px(declared(`${grid} .inv-card.inv-compact .inv-cbulk`, 'right')[0]) - bulkW;
      expect(priceLeft - (bulkLeft + bulkW), 'the two columns keep the row’s own gap between them').toBe(gap);
      // Line 1's flow area: where the name, the ×N badge and the chip box are laid out.
      const line1Right = W - px(declared(row, 'padding-right')[0]);
      expect(line1Right, 'whatever ends line 1 here is drawn ON the Bulk column').toBeLessThanOrEqual(bulkLeft);
      expect(bulkLeft - line1Right, 'one gap of air between line 1’s last item and Bulk').toBe(gap);
      // …and the reservation is the ROW's own, never a sibling's: a margin between the name and the
      // chip box leaves the chip box free to run into the strip, which is the regression above.
      for (const tail of ['.inv-name:not(:has(~ .inv-qty))', '.inv-qty'])
        expect(declared(`${row} ${tail}`, 'margin-right'), `${tail}: a sibling’s margin reserves nothing`).toEqual([]);
      // Line 2 — a chip box that lost that fit — shares line 1 with nothing, so it takes the strip back,
      // as far as the row's own right padding and no further.
      const maxW = declared(`${grid} .inv-card.inv-compact .inv-cdots`, 'max-width')[0];
      expect(maxW, 'a plain 100% would cost a wrapped chip box the same strip a second time').toMatch(
        /^calc\(100% \+ [\d.]+px\)$/,
      );
      const back = px(/\+ ([\d.]+px)\)$/.exec(maxW)?.[1]);
      expect(line1Right + back, 'a wrapped chip box reaches the row’s own right padding, and stops there').toBe(W - padLeft);
    }
  });

  /**
   * Bulk and price themselves: taken `position: absolute` out of the row those two rules above just
   * made wrapping, so they stay pinned top-right whether the row ends up one line or two. `top` and
   * `line-height` put them in the row's own 22px line-1 band (`min-height: 32px` minus its 5px
   * top/bottom padding); `right` places price flush with the row's old 10px padding and bulk 8px to
   * its left, across its 62px width — the three fixed numbers the row's `padding-right` holds open, and
   * the test above is the arithmetic that keeps the two sets in step.
   */
  it('compact rows "one" and flow: bulk and price pin to the row\'s top-right corner', () => {
    for (const sel of [
      '.inv-grid.inv-grid-compact.inv-grid-1col .inv-card.inv-compact .inv-cbulk',
      '.inv-grid.inv-grid-compact.inv-grid-1col .inv-card.inv-compact .inv-cprice',
      '.inv-grid.inv-flow .inv-card.inv-compact .inv-cbulk',
      '.inv-grid.inv-flow .inv-card.inv-compact .inv-cprice',
    ]) {
      expect(declared(sel, 'position'), sel).toEqual(['absolute']);
      expect(declared(sel, 'top'), sel).toEqual(['5px']);
    }
    for (const grid of ['.inv-grid.inv-grid-compact.inv-grid-1col', '.inv-grid.inv-flow']) {
      expect(declared(`${grid} .inv-card.inv-compact .inv-cprice`, 'right')).toEqual(['10px']);
      expect(declared(`${grid} .inv-card.inv-compact .inv-cbulk`, 'right')).toEqual(['80px']);
    }
  });

  /**
   * The other half of "who gets wrapped". `.inv-card.inv-compact` is NOT ItemCard's alone —
   * UnknownItemCard and the vehicle/siege section hand-roll their own Compact rows (InventoryTab) and
   * render neither `.inv-cbulk` nor `.inv-cprice`, so `:has(> .inv-cbulk)` never matches them: no
   * `flex-wrap`, no reserved padding, nothing pinned — they stay exactly as flat as they always were.
   *
   * MUTATION: drop `:has(> .inv-cbulk)` from either row selector in src/sheet.css (making it apply to
   * every Compact row, hand-rolled ones included) and the first assertion goes red — it is the only
   * guard on the scoping.
   */
  it('only a row that carries .inv-cbulk is wrapped — the hand-rolled Compact rows are untouched', () => {
    for (const sel of [
      '.inv-grid.inv-grid-compact.inv-grid-1col .inv-card.inv-compact',
      '.inv-grid.inv-flow .inv-card.inv-compact',
    ]) {
      expect(declared(sel, 'flex-wrap'), `${sel}: unscoped, it would wrap EVERY Compact row`).toEqual([]);
    }
    // …and rows without `.inv-cbulk` really are on the tab in that same mode, or the scoping guards
    // nothing.
    const { host, stop } = renderDom(tab({ ...DEFAULT_CUSTOMIZATION, itemCardDetail: 'compact' }));
    for (const name of ['Cart', 'Unknown item']) {
      const row = card(host, name);
      expect(row.querySelector('.inv-cbulk'), `${name} is hand-rolled — it never renders the fixed columns`).toBe(null);
      expect(
        [...row.children].some((e) => e.classList.contains('inv-facts')),
        `${name} keeps its facts as a child of the row`,
      ).toBe(true);
    }
    stop();
  });

  it('the editor offers both controls and writes the keys', () => {
    const calls: [string, unknown][] = [];
    const { host, click, stop } = renderDom(
      <CustomizationEditor
        value={{ itemCardDetail: 'compact' }}
        base={DEFAULT_CUSTOMIZATION}
        scope="global"
        onChange={(k, v) => calls.push([k, v])}
      />,
    );
    const chipsOf = (label: string) => {
      const row = [...host.querySelectorAll<HTMLElement>('.menu-label')].find((e) => e.textContent === label);
      expect(row, `the "${label}" setting has to be findable`).toBeTruthy();
      return [...row!.nextElementSibling!.querySelectorAll<HTMLButtonElement>('button.chip')];
    };
    expect(chipsOf('Compact rows').map((b) => b.textContent?.trim())).toEqual(['One wide row', 'Three columns']);
    expect(chipsOf('Compact rows')[0].className, 'the default reads as the one chosen').toContain('active');
    click(chipsOf('Compact rows')[1]);
    expect(calls.at(-1)).toEqual(['compactColumns', 'three']);
    // Choosing the baseline again clears the field, so the character/device goes back to inheriting it.
    click(chipsOf('Compact rows')[0]);
    expect(calls.at(-1)).toEqual(['compactColumns', undefined]);

    expect(chipsOf('Inventory layout').map((b) => b.textContent?.trim())).toEqual(['Grid', 'Flow']);
    expect(chipsOf('Inventory layout')[0].className).toContain('active');
    click(chipsOf('Inventory layout')[1]);
    expect(calls.at(-1)).toEqual(['inventoryLayout', 'flow']);
    click(chipsOf('Inventory layout')[0]);
    expect(calls.at(-1)).toEqual(['inventoryLayout', undefined]);
    stop();
  });

  it('the Compact-rows control is there only while Compact is the chosen look', () => {
    const labels = (value: Customization) => {
      const { host, stop } = renderDom(
        <CustomizationEditor value={value} base={DEFAULT_CUSTOMIZATION} scope="global" onChange={() => undefined} />,
      );
      const out = [...host.querySelectorAll('.menu-label')].map((e) => e.textContent);
      stop();
      return out;
    };
    expect(labels({}), 'Essentials is the default look — no columns to choose').not.toContain('Compact rows');
    expect(labels({ itemCardDetail: 'standard' })).not.toContain('Compact rows');
    expect(labels({ itemCardDetail: 'compact' })).toContain('Compact rows');
    // The layout applies to all three looks, so it is offered under all three.
    for (const v of [{}, { itemCardDetail: 'standard' as const }, { itemCardDetail: 'compact' as const }])
      expect(labels(v)).toContain('Inventory layout');
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
