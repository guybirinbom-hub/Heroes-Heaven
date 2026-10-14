// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi, type PinNode } from '../src/sheet/PinContext';
import { ForceMobileContext } from '../src/sheet/useIsMobile';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { DetailsTab } from '../src/sheet/DetailsTab';
import { ItemDetail } from '../src/sheet/ItemDetail';
import { FeatsTab, featEntries, rowOursTag } from '../src/sheet/FeatsTab';
import { RecordCard } from '../src/sheet/RecordCard';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * A record's own `note` — "this record works; here is the part you apply yourself" (types.ts
 * ContentBase.note) — reaches a pixel on every kind that carries one, in the Feats tab's "Note: …"
 * words, inside the card's ours box (data-ours-kind="note"), with the card's PinStar beside it.
 *
 * Before 2026-10-14 only feats and class features had a reader (FeatsTab withPicks). 5 backgrounds,
 * 35 items and 2 heritages carried a note nobody could see, and because a background's note had no
 * reader, the parity batches filed eight background table notes as `dataWarning` instead — the red
 * "Missing data" box on the Feats tab ("Applied at the table: the app does not model flat checks").
 * Moving those warnings to `note` (test/data-warning-is-missing-data.test.tsx) is only honest if the
 * note is then drawn, which is what this file proves:
 *  - backgrounds: the Details tab's Background term opens the background's 'mine' card (like the Class
 *    term), its ours box holding the note — on the desktop origin list AND the phone origin boxes; the
 *    card's star pins it as 'mine' with the note riding on the pin (play.ts pinOf keeps kind note);
 *  - items: ItemDetail's inset card carries the shown record's note;
 *  - heritages: the Feats tab's heritage row tags the note, and its popup's ours box holds it.
 * And one stale warning's reason: Vampire Dedication's page links the Vampire Vulnerabilities sidebar,
 * which opens with Revulsion and Sunlight — the content its removed warning called missing.
 *
 * Fixtures are shipped records that carry a note (Eager Scofflaw, Haggis, Hooded Nagaji); the
 * characters are synthesized through build() (name 't'). None is the owner's.
 *
 * MUTATION LINES (each measured red on 2026-10-14, then restored with Edit):
 *  - DetailsTab.tsx bgTerm `ours: background.note ? […] : undefined` → `ours: undefined` → the two
 *    background note cases and the pin case red.
 *  - DetailsTab.tsx desktop row `term: bgTerm` removed → the desktop, pin and no-note background cases red
 *    (the phone case stays green: it is the other layout's own line).
 *  - InfoTerm.tsx MineTermCard `ours={…}` removed → the desktop and phone background cases red (the pin
 *    case stays green: the pin's note is mineTermPin's, a separate line).
 *  - ItemDetail.tsx inset card `ours={noteOurs}` → `ours={undefined}` → the item card case red (the item
 *    pin case stays green); the PinStar's `...(noteOurs ? { ours: noteOurs } : {})` removed → the item pin
 *    case red.
 *  - FeatsTab.tsx heritage row `...(heritage.note ? […] : [])` removed → the heritage case red.
 */
const db: ContentDatabase = content();
const trees: Record<string, Record<string, AstNode>> = {};
const treeOf = (b: string): Record<string, AstNode> | undefined => {
  if (trees[b]) return trees[b];
  try { trees[b] = JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8')); } catch { return undefined; }
  return trees[b];
};
const INDEX = JSON.parse(readFileSync('public/ast-index.json', 'utf8')) as Record<string, string>;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (/ast-index\.json$/.test(url)) return new Response(JSON.stringify(INDEX), { status: 200 });
    const m = /ast\/([A-Za-z0-9_-]+)\.json$/.exec(url);
    const t = m ? treeOf(m[1]) : undefined;
    return t ? new Response(JSON.stringify(t), { status: 200 }) : new Response('', { status: 404 });
  }) as typeof fetch;
  await loadAstIndex();
  for (const b of ['backgrounds', 'items', 'heritages', 'trait', 'feats', 'sidebar']) await loadBucketAst(b);
}, 120_000);

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
let stops: (() => void)[] = [];
afterEach(() => { for (const s of stops) s(); stops = []; });
const pins: PinNode[] = [];
const pin: PinDescApi = { has: () => false, toggle: (n) => { pins.push(n); } };
async function mount(el: ReactElement, opts: { mobile?: boolean } = {}): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const inner = opts.mobile === undefined ? el : <ForceMobileContext.Provider value={opts.mobile}>{el}</ForceMobileContext.Provider>;
  await act(async () => {
    root.render(<ContentContext.Provider value={db}><PinContext.Provider value={pin}>{inner}</PinContext.Provider></ContentContext.Provider>);
  });
  await settle();
  stops.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}
async function click(el: Element | null | undefined) {
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The note line(s) of the open card's ours box. */
const noteLines = (host: HTMLElement) => [...host.querySelectorAll('[data-ours] [data-ours-kind="note"]')].map(txt);

const BG = 'eager-scofflaw';
const bgNote = () => db.backgrounds[BG].note!;
const bgTerm = (host: HTMLElement) => [...host.querySelectorAll('.oval.info-term')].find((e) => txt(e) === db.backgrounds[BG].name);
const withBg = (backgroundId: string): Character => build('fighter', 3, { backgroundId });

describe('a background note is drawn on the Background card (Details tab)', () => {
  it('premise: the fixture background carries a note', () => {
    expect(typeof db.backgrounds[BG]?.note, `${BG}.note`).toBe('string');
  });

  it('desktop origin list: the Background term opens the background card, its ours box holds the note', async () => {
    const host = await mount(<DetailsTab character={withBg(BG)} content={db} />, { mobile: false });
    expect(host.querySelector('.origin-list'), 'the desktop layout rendered').toBeTruthy();
    await click(bgTerm(host));
    expect(host.querySelector('.card-mine'), 'the background opens as its mine card').toBeTruthy();
    expect(noteLines(host)).toEqual([`Note: ${bgNote()}`]);
    // Every description popup keeps its PinStar.
    expect(host.querySelector('.card-mine .info-star'), 'the card keeps its star').toBeTruthy();
  });

  it('phone origin boxes: the same card, the same note', async () => {
    const host = await mount(<DetailsTab character={withBg(BG)} content={db} />, { mobile: true });
    expect(host.querySelector('.origin-boxes'), 'the phone layout rendered').toBeTruthy();
    await click(bgTerm(host));
    expect(host.querySelector('.card-mine'), 'the background opens as its mine card').toBeTruthy();
    expect(noteLines(host)).toEqual([`Note: ${bgNote()}`]);
    expect(host.querySelector('.card-mine .info-star'), 'the card keeps its star').toBeTruthy();
  });

  it('the star pins the background as mine, with its note on the pin', async () => {
    pins.length = 0;
    const host = await mount(<DetailsTab character={withBg(BG)} content={db} />, { mobile: false });
    await click(bgTerm(host));
    await click(host.querySelector('.card-mine .info-star'));
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ key: 'backgrounds', slug: BG, mode: 'mine' });
    expect(pins[0].ours).toEqual([{ kind: 'note', text: `Note: ${bgNote()}` }]);
  });

  it('a background with no note draws no note line', async () => {
    const plain = Object.values(db.backgrounds).find((b) => !b.note && !b.dataWarning && b.id === 'acolyte');
    expect(plain, 'acolyte carries no note').toBeTruthy();
    const host = await mount(<DetailsTab character={withBg('acolyte')} content={db} />, { mobile: false });
    await click([...host.querySelectorAll('.oval.info-term')].find((e) => txt(e) === plain!.name));
    expect(host.querySelector('.card-mine'), 'the card opened').toBeTruthy();
    expect(noteLines(host)).toEqual([]);
  });
});

describe('an item note is drawn in the item popup', () => {
  const ITEM = 'haggis';
  it('ItemDetail\'s inset card holds the item\'s note, beside the popup\'s star', async () => {
    const note = db.items[ITEM]?.note;
    expect(typeof note, `${ITEM}.note`).toBe('string');
    const inv = { instanceId: `i-${ITEM}`, itemId: ITEM, quantity: 1 } as InventoryItem;
    const host = await mount(<ItemDetail inv={inv} item={db.items[ITEM]} content={db} inventory={[inv]} character={build('fighter', 1)} onClose={() => undefined} />);
    expect(host.querySelector('.card-inset'), 'the inset card rendered').toBeTruthy();
    expect([...host.querySelectorAll('.card-inset [data-ours] [data-ours-kind="note"]')].map(txt)).toEqual([`Note: ${note}`]);
    expect(host.querySelector('.info-star'), 'the item popup keeps its star').toBeTruthy();
  });

  it('the item popup\'s star pins the note with the item', async () => {
    pins.length = 0;
    const inv = { instanceId: `i-${ITEM}`, itemId: ITEM, quantity: 1 } as InventoryItem;
    const host = await mount(<ItemDetail inv={inv} item={db.items[ITEM]} content={db} inventory={[inv]} character={build('fighter', 1)} onClose={() => undefined} />);
    await click(host.querySelector('.sd-head-actions .info-star'));
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ key: 'items', slug: ITEM, mode: 'mine' });
    expect(pins[0].ours).toEqual([{ kind: 'note', text: `Note: ${db.items[ITEM].note}` }]);
  });
});

describe('a stale warning removed: what it said was missing is on screen', () => {
  // feat-3545 "You gain revulsion and sunlight vulnerabilities detailed in the Vampire Vulnerabilities
  // sidebar". The dedication warned "the vampire sidebar's text is not in the mirror"; it ships now
  // (sidebar-1790), so lane B removed the warning. This pins the reason: the link is live and opens it.
  it('Vampire Dedication\'s page links the Vampire Vulnerabilities sidebar, which opens with Revulsion and Sunlight', async () => {
    expect(db.feats['vampire-dedication'].dataWarning, 'the stale warning is gone').toBeUndefined();
    const host = await mount(<RecordCard record={{ bucket: 'feats', id: 'vampire-dedication' }} mode="browse" chrome="popup" onExit={() => undefined} />);
    expect(host.querySelector('.ast-modal'), 'the dedication draws its page').toBeTruthy();
    const link = [...host.querySelectorAll('a.ast-lk')].find((a) => txt(a) === 'Vampire Vulnerabilities');
    expect(link, 'a live link to the sidebar (not ast-lk-dead)').toBeTruthy();
    expect(txt(host.querySelector('.ast-modal')), 'the dedication page itself does not print the vulnerabilities').not.toContain('Revulsion');
    await click(link);
    const body = txt(host.querySelector('.ast-modal'));
    expect(body).toContain('Revulsion');
    expect(body).toContain('Sunlight');
  });
});

describe('a heritage note is drawn on the Feats tab', () => {
  const HER = 'hooded-nagaji';
  const ch = () => build('fighter', 1, { ancestryId: db.heritages[HER].ancestryId!, heritageId: HER });
  it('the heritage row carries the note as an ours line, and tags it', () => {
    const note = db.heritages[HER]?.note;
    expect(typeof note, `${HER}.note`).toBe('string');
    const row = featEntries(ch(), db).find((e) => e.heritageId === HER);
    expect(row, 'the heritage row').toBeTruthy();
    expect(row!.ours.filter((l) => l.kind === 'note')).toEqual([{ kind: 'note', text: `Note: ${note}` }]);
    expect(rowOursTag(row!)).toContain(`Note: ${note!.slice(0, 40)}`);
  });

  it('opening the heritage row shows the note in the popup\'s ours box', async () => {
    const note = db.heritages[HER].note!;
    const host = await mount(<FeatsTab character={ch()} content={db} />);
    const row = [...host.querySelectorAll('.ff-row')].find((r) => txt(r.querySelector('.ff-name')) === db.heritages[HER].name);
    expect(row, 'the heritage row').toBeTruthy();
    expect(txt(row!.querySelector('.ff-ours-tag'))).toContain('Note:');
    await click(row);
    expect(noteLines(host)).toEqual([`Note: ${note}`]);
    expect(host.querySelector('.card-mine .info-star'), 'the popup keeps its star').toBeTruthy();
  });
});
