// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { ItemDetail } from '../src/sheet/ItemDetail';
import { InventoryTab } from '../src/sheet/InventoryTab';
import { SpellDetail } from '../src/sheet/SpellsTab';
import { SettingsPage } from '../src/sheet/SettingsPage';
import { ContentContext } from '../src/sheet/ContentContext';
import { CustomizationContext, DEFAULT_CUSTOMIZATION, effectiveCustomization } from '../src/data/customization';
import { getPrefs, setPref } from '../src/data/prefs';
import { aonUrlOf } from '../src/sheet/AonLink';
import { runeEntries } from '../src/rules/runeRecords';
import { normalizeCharacter } from '../src/rules/normalize';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * Guy, 2026-10-21: "I want to have a link to Archives of Nethys on every pop up a user opens. Right now
 * it's missing on items … and I want to have it as a toggleable setting", and "clicking the runes on a
 * thing they are attached to should open the description of that rune".
 *
 *  1. The item popup (ItemDetail draws its own head; the page below it is the inset card, which draws no
 *     head) shows the Archives button for a printed item — the address stamped on its page tree — and
 *     hides it when Settings → Popups → "Show Archives of Nethys link on popups" is off.
 *  2. A rune chip on an item (the item popup, and the Essentials inventory row) is a button that opens
 *     that rune's own description: the rune's item record, with its page and its Archives button. A
 *     press on the row's chip opens the rune, never the row's item popup as well.
 *  3. runeEntries maps a row's fundamental runes to the records that ship them (ids read off the data).
 *
 * The page trees are synthetic (the shipped items bucket takes seconds to parse); the records are the
 * shipped ones. MUTATIONS: ItemDetail's `<AonLink url={ownPage?.url} />` dropped → test 1 red; RuneChips'
 * button branch → a plain span → test 2 red; InventoryTab's `onOpenRune={setRuneDesc}` dropped → the
 * row leg red; `stopPropagation` in RuneChips dropped → the row leg red (the item popup opened too);
 * SpellDetail's `<AonLink url={tree?.url} />` dropped → the spell popup leg red.
 */

const c = content();
const LONGSWORD_URL = '/Equipment.aspx?ID=90001';
const POTENCY_URL = '/Equipment.aspx?ID=90002';
const page = (name: string, url: string, text: string) => ({
  t: 'doc',
  url,
  c: [
    { t: 'title', level: '1', c: [{ t: 'text', v: name }] },
    { t: 'p', c: [{ t: 'text', v: text }] },
  ],
});
const ITEMS = {
  longsword: page('Longsword', LONGSWORD_URL, 'Synthetic longsword page.'),
  'weapon-potency-1': page('Weapon Potency (+1)', POTENCY_URL, 'Synthetic potency page.'),
};
const FIREBALL_URL = '/Spells.aspx?ID=90003';
const SPELLS = { fireball: page('Fireball', FIREBALL_URL, 'Synthetic fireball page.') };

beforeAll(() => {
  // The page trees, through the loader's raw-JSON fallback (astStore.ts); nothing else is served.
  vi.stubGlobal('fetch', async (url: string) => {
    if (/\/ast\/items\.json$/.test(String(url))) return { ok: true, status: 200, json: async () => ITEMS };
    if (/\/ast\/spells\.json$/.test(String(url))) return { ok: true, status: 200, json: async () => SPELLS };
    if (String(url).endsWith('/ast-index.json')) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  });
});
beforeEach(() => setPref('showAonLink', true));
afterEach(() => {
  setPref('showAonLink', true);
  for (const n of [...document.body.children]) n.remove();
});

/** Let the bucket fetch and the hooks' effects settle. */
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const SWORD: InventoryItem = { instanceId: 'i-sword', itemId: 'longsword', quantity: 1, equipped: true, runes: { potency: 1 } } as InventoryItem;

function itemPopup(inv: InventoryItem = SWORD) {
  return renderDom(
    <ContentContext.Provider value={c}>
      <ItemDetail inv={inv} item={c.items[inv.itemId]} content={c} onClose={() => undefined} />
    </ContentContext.Provider>,
  );
}

describe('the Archives of Nethys link on the item popup', () => {
  it('a printed item shows the button with its page address; the setting hides it', async () => {
    expect(getPrefs().showAonLink, 'on by default').toBe(true);
    const { host, stop } = itemPopup();
    await settle();
    const head = host.querySelector('.spell-detail > .picker-head');
    const link = head?.querySelector<HTMLAnchorElement>('a.ast-aon');
    expect(link, 'the item popup head carries the Archives button').toBeTruthy();
    expect(link!.getAttribute('href')).toBe(`https://2e.aonprd.com${LONGSWORD_URL}`);
    act(() => setPref('showAonLink', false));
    expect(host.querySelector('a.ast-aon'), 'setting off: no Archives button anywhere in the popup').toBeNull();
    act(() => setPref('showAonLink', true));
    expect(host.querySelector('.spell-detail > .picker-head a.ast-aon')).toBeTruthy();
    stop();
  });

  it('a record with no page gets no button (never a guessed address)', async () => {
    expect(aonUrlOf(undefined)).toBe('');
    expect(aonUrlOf('equipment-2829')).toBe('');
    expect(aonUrlOf('https://example.com/Equipment.aspx?ID=1')).toBe('');
    expect(aonUrlOf('/Equipment.aspx?ID=2829')).toBe('https://2e.aonprd.com/Equipment.aspx?ID=2829');
    // Rope's page is not in the synthetic bucket: the popup has no address, so no button.
    const { host, stop } = itemPopup({ instanceId: 'i-rope', itemId: 'rope', quantity: 1 } as InventoryItem);
    await settle();
    expect(host.querySelector('a.ast-aon')).toBeNull();
    stop();
  });

  it('the Spells tab popup (SpellDetail, its own head) shows the button; the setting hides it', async () => {
    const { host, stop } = renderDom(
      <ContentContext.Provider value={c}>
        <SpellDetail spell={c.spells.fireball} onClose={() => undefined} />
      </ContentContext.Provider>,
    );
    await settle();
    const link = host.querySelector<HTMLAnchorElement>('.spell-detail > .picker-head a.ast-aon');
    expect(link, 'the spell popup head carries the Archives button').toBeTruthy();
    expect(link!.getAttribute('href')).toBe(`https://2e.aonprd.com${FIREBALL_URL}`);
    act(() => setPref('showAonLink', false));
    expect(host.querySelector('a.ast-aon'), 'setting off: no button').toBeNull();
    stop();
  });

  it('Settings → Popups: the switch reads "on" by default and turns the setting off and on', async () => {
    const { host, click, stop } = renderDom(<SettingsPage onClose={() => undefined} />);
    await settle();
    const sw = () => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Show Archives of Nethys link on popups'));
    expect(sw(), 'the switch is on the Settings page').toBeTruthy();
    expect(sw()!.textContent).toContain('— on');
    click(sw()!);
    expect(getPrefs().showAonLink).toBe(false);
    expect(sw()!.textContent).toContain('— off');
    click(sw()!);
    expect(getPrefs().showAonLink).toBe(true);
    stop();
  });
});

describe('a rune on an item opens its own description', () => {
  it('the item popup: the "+1 potency" chip opens Weapon Potency (+1), with its Archives button', async () => {
    const { host, click, stop } = itemPopup();
    await settle();
    const chip = [...host.querySelectorAll<HTMLElement>('.ff-trait.rune')].find((el) => el.textContent === '+1 potency');
    expect(chip?.tagName, 'the rune chip is a button').toBe('BUTTON');
    expect(host.querySelector('.ast-modal, .info-modal'), 'no rune popup before the click').toBeNull();
    click(chip!);
    await settle();
    const pop = host.querySelector('.ast-modal, .info-modal');
    expect(pop, 'the rune popup opened').toBeTruthy();
    expect(pop!.textContent).toContain('Weapon Potency (+1)');
    expect(pop!.querySelector<HTMLAnchorElement>('a.ast-aon')?.getAttribute('href')).toBe(`https://2e.aonprd.com${POTENCY_URL}`);
    expect(host.querySelector('.spell-detail'), 'the item popup stays under it').toBeTruthy();
    stop();
  });

  it('the Essentials inventory row: the chip opens the rune, not the item popup', async () => {
    const character = normalizeCharacter({
      id: 'rc', name: 'RC', level: 3, classId: 'fighter', keyAbility: 'str',
      abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 }, feats: [], inventory: [SWORD],
    } as unknown as Character);
    const custom = effectiveCustomization({ ...DEFAULT_CUSTOMIZATION, itemCardDetail: 'essentials' }, undefined);
    const { host, click, stop } = renderDom(
      <ContentContext.Provider value={c}>
        <CustomizationContext.Provider value={custom}>
          <InventoryTab character={character} content={c} onPlay={() => undefined} />
        </CustomizationContext.Provider>
      </ContentContext.Provider>,
    );
    await settle();
    const chip = [...host.querySelectorAll<HTMLElement>('.inv-card .ff-trait.rune')].find((el) => el.textContent === '+1 potency');
    expect(chip?.tagName, 'the row chip is a button').toBe('BUTTON');
    click(chip!);
    await settle();
    expect(host.querySelector('.spell-detail'), 'the row did not also open its item popup').toBeNull();
    const pop = host.querySelector('.ast-modal, .info-modal');
    expect(pop?.textContent).toContain('Weapon Potency (+1)');
    stop();
  });
});

describe('runeEntries — a row\'s runes to the records that ship them', () => {
  const inv = (runes: Record<string, unknown>) => ({ instanceId: 'x', itemId: 'x', quantity: 1, runes }) as unknown as InventoryItem;
  const ids = (runes: Record<string, unknown>, type: string) => runeEntries(inv(runes), type, c).map((e) => [e.label, e.id]);
  it('weapon fundamentals and property runes', () => {
    expect(ids({ potency: 2, striking: 'greater', property: ['flaming'] }, 'weapon')).toEqual([
      ['+2 potency', 'weapon-potency-2'], ['Greater striking', 'striking-greater'], ['Flaming', 'flaming'],
    ]);
    expect(ids({ potency: 4, striking: 'mythic' }, 'weapon')).toEqual([['+4 potency', 'mythic-weapon-potency'], ['Mythic striking', 'mythic-striking']]);
    // The base tier reads "Striking", never "Striking striking".
    expect(ids({ striking: 'striking' }, 'weapon')).toEqual([['Striking', 'striking']]);
  });
  it('armor and shield fundamentals', () => {
    expect(ids({ potency: 1, resilient: 'major' }, 'armor')).toEqual([['+1 potency', 'armor-potency-1'], ['Major resilient', 'resilient-major']]);
    expect(ids({ resilient: 'resilient' }, 'armor')).toEqual([['Resilient', 'resilient']]);
    expect(ids({ reinforcing: 3 }, 'shield')).toEqual([['Moderate reinforcing', 'reinforcing-rune-moderate']]);
  });
  it('no id where the record is unknown: a potency rune on neither weapon nor armor, an unknown property, no content', () => {
    expect(ids({ potency: 1 }, 'shield')).toEqual([['+1 potency', undefined]]);
    expect(ids({ property: ['not-a-rune'] }, 'weapon')).toEqual([['Not a rune', undefined]]);
    expect(runeEntries(inv({ potency: 1 }), 'weapon').map((e) => e.id)).toEqual([undefined]);
  });
});
