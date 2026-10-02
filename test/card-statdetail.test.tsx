// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { StatDetailModal } from '../src/sheet/StatDetailModal';
import { RecordCard } from '../src/sheet/RecordCard';
import { CARD_ON } from '../src/sheet/cardSurfaces';
import type { DescNode } from '../src/sheet/descref';
import type { Character, ContentDatabase } from '../src/rules/types';
import { omissionLog } from '../scripts/lib/card-scope.mjs';

/** Records a case marks as created with none of their rules encoded, so the TrustMarker speaks for
 *  them whatever the gate's switch says; every other record keeps the real ledger's answer. */
const stub = vi.hoisted(() => ({ bare: new Set<string>() }));
vi.mock('../src/data/trustGate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/data/trustGate')>();
  return { ...real, trustUnencoded: (bucket: string, id: string) => stub.bare.has(`${bucket}/${id}`) || real.trustUnencoded(bucket, id) };
});

/**
 * Card step 5 (docs/card-design.md section 9 row 5; section 2 rules 4–5; owner rulings section 13): the
 * FIRST visible change. StatDetailModal's "Full text" of a situational line renders the record's card in
 * mode 'mine' (CARD_ON.statDetail). The popup prints no stat rows, so its printed set is empty and every
 * labelled line of the record's Archives page shows exactly once, in the page's words, at full weight, in
 * the page's order. S-furniture leaves (spoiler banners, the "<X> leads to…" section, Class labels);
 * Source / Archetype / Access / Craft Requirements / PFS Note stay, dimmed (.card-dim). The header keeps
 * PinStar, close and the TrustMarker; there is no "Full page" button. A record with no page shows its old
 * text and says so, marked ours; a record whose page could not load on this device says THAT instead.
 *
 * Every case renders the REAL StatDetailModal with a synthesized character (build('fighter', 1), name
 * 't'), opens the line's "Full text", and reads the card off the DOM.
 *
 * MUTATION LINES (each measured red on 2026-10-02, then restored byte-exact from a scratch copy):
 *  - RecordCard.tsx mine page lane: `card={{ printed: printedSet(printed) }}` → `hideMeta` (the legacy
 *    drop) → halfling-luck / shield-block / Source / Archetype cases red.
 *  - astVisibility.ts isCardFurnitureTitle → `return false` → the "leads to" case red.
 *  - astVisibility.ts isCardDimP → `return false` → the dimmed Source / Archetype case red.
 *  - RecordCard.tsx: the PinStar button removed from the controls → the PinStar case red.
 *  - RecordCard.tsx mine fallback: the no-page line removed → the no-page case red.
 *  - StatDetailModal.tsx: the display:contents wrapper's stopPropagation removed → the close case red
 *    (a click outside the card closed the stat popup too).
 *  - RecordCard.tsx mine page lane: `{marker}` removed from headerControls → the TrustMarker case red;
 *    mine fallback lane: `{marker}` removed from the body → the same case red.
 *  - scripts/lib/card-scope.mjs omissionLog: the "leads to" chain widened back to `prev.leadsTo ||
 *    prev.section` → the guard case red (a second dropped line after the link list was excused).
 *  - astVisibility.ts isCardDimP: `dimLeadOf` → `leadOf` (the wrapped PFS Note unseen) → the dim case
 *    red; CARD_DIM_LEAD without `access`, then without `craft requirements` → the same case red, each.
 *  - astVisibility.ts isCardFurnitureP: both furniture-line rules deleted → the furniture case red (Click
 *    here); `can be found here` alone dropped from the first → red; the Related rule alone deleted → red.
 *  - RecordCard.tsx mine no-page lane: `{pin && (` → `{false && pin && (` → the PinStar case red.
 *  - RecordCard.tsx usePageLoadFailed: the verdict forced `false` → the could-not-load case red; forced
 *    `true` → the no-page case red.
 *  - RecordCard.tsx mine page lane footer back to `{oursBox}{remastered}{footer}{ownSource}` → the page
 *    lane footer-order case red; mine no-page lane back to `{oursBox}{remastered}{footer}{sourceLine}`
 *    with the empty note inside DescBody → the no-page footer-order case red.
 *  - RecordCard.tsx sourceLine: `data-ours=""` removed from its wrapper → the page-lane order case and
 *    the both-lanes Source case red.
 *
 * KNOWN AND LEFT AS IS (refuter round 1, 2026-10-02):
 *  - On the no-page lane the TrustMarker sits at the top of the body, not in the header — as the browse
 *    fallback lane draws it (RecordCard.tsx's last branch).
 *  - The page lane's fallback Source line (our field-derived Source where the page prints none) is
 *    unreachable on this surface today: 0 of the 2,774 statDetail page rows lack a Source line. It is
 *    kept for the surfaces still to come and pinned on a synthesized page by the footer-order case.
 *  - test/card-parity.test.tsx agrees by SET, so a renderer that SHOWS a line the ledger models as
 *    dropped is not caught there; the refuter measured this file catching that mutation. Noted for
 *    step W.
 *
 * The switch turns back in one line (section 9): the card cases run while CARD_ON.statDetail is on, the
 * legacy popup's cases while it is off. Both blocks were run on 2026-10-02 (the off block with the
 * switch flipped on a scratch edit, then restored).
 */
const noop = () => undefined;
const db: ContentDatabase = content();
type Rec = { name: string; description?: string };
const recs = (b: string) => (db as unknown as Record<string, Record<string, Rec>>)[b] ?? {};
const BUCKETS = ['feats', 'classFeatures', 'items'] as const;
const trees: Record<string, Record<string, AstNode>> = {};
let astIndex: Record<string, string> = {};
let ch: Character;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const b of BUCKETS) trees[b] = JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8'));
  astIndex = JSON.parse(readFileSync('public/ast-index.json', 'utf8'));
  // Only the three BUCKETS load; any other bucket's fetch fails, as on a device that cannot fetch or
  // decode it (the "could not load" case). The page index loads, as it does in the app.
  vi.stubGlobal('fetch', async (url: string) => {
    if (/ast-index\.json$/.test(String(url))) return { ok: true, json: async () => astIndex };
    const m = /ast\/(\w+)\.json$/.exec(String(url));
    return m && trees[m[1]] ? { ok: true, json: async () => trees[m[1]] } : { ok: false };
  });
  for (const b of BUCKETS) await loadBucketAst(b);
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  ch = build('fighter', 1);
});

const mounted: (() => void)[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!(); });
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement, pin: PinDescApi | null): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={db}><PinContext.Provider value={pin}>{el}</PinContext.Provider></ContentContext.Provider>);
  });
  await settle();
  mounted.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}
async function click(el: Element | null | undefined) {
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const squash = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

/** The real StatDetailModal with one situational line from `bucket:id`, its Full text opened. */
async function openFullText(bucket: string, id: string, pin: PinDescApi | null = null, onClose: () => void = noop) {
  expect(recs(bucket)[id]?.description, `${bucket}:${id} has a description (the Full text button needs one)`).toBeTruthy();
  const breakdown = { title: 'Stat', totalText: '+0', parts: [], timeline: [], situational: [{ text: 'a situational line', sourceId: id, sourceCollection: bucket as never }] };
  const host = await mount(<StatDetailModal breakdown={breakdown} character={ch} content={db} onClose={onClose} />, pin);
  await click(host.querySelector('.sd-sit-more'));
  return host;
}
/** The open card's body (page lane) and the texts of its blocks. */
function pageCard(host: HTMLElement) {
  const modal = host.querySelector('.ast-modal.card-mine');
  expect(modal, 'the Full text is the mine card, page lane').toBeTruthy();
  const body = modal!.querySelector('.ast-pop > .ast-body')!;
  const lines = [...body.querySelectorAll('p, .ast-meta, .ast-h2, .ast-h3, li, td, th')].map((e) => squash(e.textContent));
  return { modal: modal!, body, text: squash(body.textContent), lines };
}

describe.runIf(!CARD_ON.statDetail)('card step 5, switch OFF: StatDetailModal full text is the legacy popup', () => {
  it('the Full text opens the legacy text popup over the stat, never the card', async () => {
    const host = await openFullText('feats', 'halfling-luck');
    expect(host.querySelector('.card-mine'), 'no card while the switch is off').toBeNull();
    const modal = host.querySelector('.picker.confirm-modal');
    expect(modal, 'the legacy popup').toBeTruthy();
    expect(squash(modal!.querySelector('.picker-head span')?.textContent)).toBe(recs('feats')['halfling-luck'].name);
    expect(squash(modal!.querySelector('.confirm-body')?.textContent)).toMatch(/Your happy-go-lucky nature/);
  });

  it('closing the legacy popup returns to the stat popup', async () => {
    const onClose = vi.fn();
    const host = await openFullText('feats', 'halfling-luck', null, onClose);
    await click(host.querySelector('.confirm-modal .picker-close'));
    expect(host.querySelector('.confirm-modal'), 'the legacy popup closed').toBeNull();
    expect(host.querySelector('.picker.stat-detail'), 'the stat popup stays').toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe.runIf(CARD_ON.statDetail)('card step 5: StatDetailModal full text is the mine card', () => {
  it('halfling-luck shows "Frequency once per day" and its Trigger exactly once each, at full weight, before the prose; no "leads to"', async () => {
    const host = await openFullText('feats', 'halfling-luck');
    const { body, text, lines } = pageCard(host);
    expect(count(text, 'Frequency once per day'), text).toBe(1);
    expect(count(text, 'Trigger You fail a skill check or saving throw'), text).toBe(1);
    const freq = [...body.querySelectorAll('p')].find((p) => squash(p.textContent).startsWith('Frequency'));
    const trig = [...body.querySelectorAll('p')].find((p) => squash(p.textContent).startsWith('Trigger'));
    for (const p of [freq, trig]) {
      expect(p, 'the use line is a paragraph of the body').toBeTruthy();
      expect(p!.classList.contains('card-dim'), 'a use line is never dimmed').toBe(false);
      expect(p!.closest('[data-ours]'), 'a use line is the page\'s, not ours').toBeNull();
      expect(p!.querySelector('strong')?.textContent?.trim(), 'the label stays bold').toMatch(/^(Frequency|Trigger)$/);
    }
    // The page's order: Source, Frequency, Trigger, then the prose.
    const at = (s: string) => lines.findIndex((l) => l.startsWith(s));
    expect(at('Source')).toBeGreaterThanOrEqual(0);
    expect(at('Source')).toBeLessThan(at('Frequency'));
    expect(at('Frequency')).toBeLessThan(at('Trigger'));
    expect(at('Trigger')).toBeLessThan(at('Your happy-go-lucky nature'));
    // S-furniture: the "Halfling Luck leads to..." section and its link list leave.
    expect(text).not.toMatch(/leads to/i);
    expect(text).not.toMatch(/Guiding Luck/);
    expect(squash(host.querySelector('.card-mine')!.textContent)).not.toMatch(/Full page/i);
  });

  it('shield-block shows its Trigger once', async () => {
    const host = await openFullText('feats', 'shield-block');
    const { text } = pageCard(host);
    expect(count(text, 'Trigger While you have your shield raised'), text).toBe(1);
    expect(text).not.toMatch(/leads to/i);
  });

  it('Source is present and dimmed (and stays the page\'s line); an Archetype label is dimmed too', async () => {
    const host = await openFullText('feats', 'halfling-luck');
    const { body } = pageCard(host);
    const src = [...body.querySelectorAll('p')].filter((p) => squash(p.textContent).startsWith('Source'));
    expect(src.length, 'one Source line').toBe(1);
    expect(src[0].classList.contains('card-dim'), 'the Source line is dimmed').toBe(true);
    expect(squash(src[0].textContent)).toMatch(/^Source Player Core pg\. \d+/);
    const arch = await openFullText('feats', 'a-hush-falls-over-the-world');
    const a = [...pageCard(arch).body.querySelectorAll('p')].find((p) => squash(p.textContent).startsWith('Archetype'));
    expect(a, 'the Archetype label is on the card').toBeTruthy();
    expect(a!.classList.contains('card-dim'), 'the Archetype label is dimmed').toBe(true);
  });

  it('Access, Craft Requirements and the PFS Note show once each, dimmed (section 2 rule 5); the use lines beside them stay at full weight', async () => {
    const lineOf = (body: Element, label: string) => {
      const ps = [...body.querySelectorAll('p')].filter((p) => squash(p.textContent).startsWith(label));
      expect(ps.length, `one "${label}" line`).toBe(1);
      return ps[0];
    };
    // farabellus-flip: Source, PFS Note (p > i > view > b), Prerequisites, Access, all in the header column.
    const ff = pageCard(await openFullText('feats', 'farabellus-flip'));
    const pfs = lineOf(ff.body, 'PFS Note');
    expect(squash(pfs.textContent)).toMatch(/^PFS Note All characters have access to this feat\./);
    expect(pfs.classList.contains('card-dim'), 'the PFS Note is dimmed').toBe(true);
    const access = lineOf(ff.body, 'Access');
    expect(access.classList.contains('card-dim'), 'Access is dimmed').toBe(true);
    expect(access.querySelector('strong')?.textContent?.trim()).toBe('Access');
    expect(lineOf(ff.body, 'Prerequisites').classList.contains('card-dim'), 'Prerequisites is a use line, never dimmed').toBe(false);
    // An item's Craft Requirements.
    const craftId = Object.keys(trees.items).filter((s) => recs('items')[s]?.description && JSON.stringify(trees.items[s]).includes('"Craft Requirements"')).sort()[0];
    expect(craftId, 'an item with a Craft Requirements line and a description ships').toBeTruthy();
    const craft = lineOf(pageCard(await openFullText('items', craftId)).body, 'Craft Requirements');
    expect(craft.classList.contains('card-dim'), 'Craft Requirements is dimmed').toBe(true);
  });

  it('"Click here for the full rules…", "… can be found here" and a Related Feats list leave (S-furniture); the prose around them stays', async () => {
    const here = pageCard(await openFullText('items', 'adze'));
    expect(here.text).not.toMatch(/Click here/i);
    expect(here.text).toMatch(/^Source /);
    const found = pageCard(await openFullText('classFeatures', 'advanced-deed'));
    expect(found.text).not.toMatch(/can be found here/i);
    expect(found.text.length, 'the feature\'s own text stays').toBeGreaterThan(80);
    const related = pageCard(await openFullText('feats', 'all-of-the-animal'));
    expect(related.text).not.toMatch(/Related Feats/);
    expect(related.text).toMatch(/You know how to make the best and most efficient use/);
  });

  it('a spoiler banner and a class feature\'s "Class" header label leave (S-furniture); the rest of the header shows', async () => {
    const spoiler = await openFullText('feats', 'benevolent-spirit-deck');
    expect(squash(spoiler.textContent)).not.toMatch(/May contain spoilers/);
    expect(pageCard(spoiler).text).toMatch(/^Source /);
    const cls = await openFullText('classFeatures', 'sorcerous-potency');
    const { lines } = pageCard(cls);
    expect(lines.some((l) => /^Class Sorcerer$/.test(l)), lines.join(' | ')).toBe(false);
    expect(lines.some((l) => l.startsWith('Source')), 'its Source line stays').toBe(true);
  });

  it('PinStar sits in the card header and pins this record by bucket and id', async () => {
    let pinned: DescNode | null = null;
    const pin: PinDescApi = { has: () => false, toggle: (n) => { pinned = n; } };
    const host = await openFullText('feats', 'halfling-luck', pin);
    const star = host.querySelector('.card-mine .ast-head .info-star');
    expect(star, 'PinStar in the header').toBeTruthy();
    await click(star);
    expect(pinned).toMatchObject({ key: 'feats', slug: 'halfling-luck', title: recs('feats')['halfling-luck'].name });
    expect(host.querySelector('.card-mine .ast-head .picker-close'), 'close in the header').toBeTruthy();
    // The no-page lane draws its own header: it keeps the star too.
    const noPage = Object.keys(recs('feats')).filter((s) => !trees.feats[s] && (recs('feats')[s].description ?? '').length > 40).sort()[0];
    const fb = await openFullText('feats', noPage, pin);
    const fbStar = fb.querySelector('.picker.info-modal.card-mine .picker-head .info-star');
    expect(fbStar, 'PinStar on the no-page lane').toBeTruthy();
    await click(fbStar);
    expect(pinned).toMatchObject({ key: 'feats', slug: noPage });
  });

  it('the TrustMarker speaks on the card: in the page header, and on the no-page lane above the text', async () => {
    const noPage = Object.keys(recs('feats')).filter((s) => !trees.feats[s] && (recs('feats')[s].description ?? '').length > 40).sort()[0];
    stub.bare.add('feats/halfling-luck');
    stub.bare.add(`feats/${noPage}`);
    try {
      const host = await openFullText('feats', 'halfling-luck');
      const note = host.querySelector('.card-mine .ast-head [role="note"]');
      expect(note, 'the marker sits in the card header').toBeTruthy();
      expect(squash(note!.textContent)).toMatch(/^Not yet verified/);
      const fb = await openFullText('feats', noPage);
      const fbNote = fb.querySelector('.picker.info-modal.card-mine .info-body > [role="note"]');
      expect(fbNote, 'the marker sits on the no-page lane').toBeTruthy();
      expect(squash(fbNote!.textContent)).toMatch(/^Not yet verified/);
    } finally {
      stub.bare.clear();
    }
  });

  it('a record with no page shows its own text through the fallback lane and the no-page line, marked ours', async () => {
    const id = Object.keys(recs('feats')).filter((s) => !trees.feats[s] && (recs('feats')[s].description ?? '').length > 40).sort()[0];
    expect(id, 'a feat with text and no page ships').toBeTruthy();
    const host = await openFullText('feats', id);
    const modal = host.querySelector('.picker.info-modal.card-mine');
    expect(modal, 'the no-page lane of the mine card').toBeTruthy();
    expect(host.querySelector('.ast-modal'), 'no page drawn').toBeNull();
    expect(squash(modal!.querySelector('.info-title')?.textContent)).toBe(recs('feats')[id].name);
    const body = modal!.querySelector('.info-body')!;
    expect(squash(body.querySelector('.sd-desc')?.textContent).length, 'the old text is shown').toBeGreaterThan(20);
    const line = body.querySelector('.card-nopage');
    expect(line && squash(line.textContent)).toBe('No Archives page — text from our older import');
    expect(line!.matches('[data-ours].sd-ours'), 'marked ours').toBe(true);
  });

  it('a record whose page bucket could not load says so, never "No Archives page" (section 2 rule 3)', async () => {
    // A heritage's bucket is not served here, so it loads as {} — what loadBucketAst gives on any fetch
    // or decode error. The index names the slug, so the record HAS a page this device could not read.
    const id = Object.keys(recs('heritages')).filter((s) => astIndex[s] === 'heritages' && (recs('heritages')[s].description ?? '').length > 40).sort()[0];
    expect(id, 'a heritage with a page and text ships').toBeTruthy();
    const host = await openFullText('heritages', id);
    const modal = host.querySelector('.picker.info-modal.card-mine');
    expect(modal, 'the fallback lane of the mine card').toBeTruthy();
    expect(squash(modal!.querySelector('.sd-desc')?.textContent).length, 'the old text is shown').toBeGreaterThan(20);
    const line = modal!.querySelector('.card-nopage');
    expect(line && squash(line.textContent)).toBe('The Archives page could not load on this device — text from our older import');
    expect(line!.matches('[data-ours].sd-ours[data-ours-kind="pageFailed"]'), 'marked ours').toBe(true);
    expect(squash(modal!.textContent)).not.toMatch(/No Archives page/);
  });

  it('closing the card returns to the stat popup (the X, a click outside, Escape)', async () => {
    const onClose = vi.fn();
    const host = await openFullText('feats', 'halfling-luck', null, onClose);
    await click(host.querySelector('.card-mine .picker-close'));
    expect(host.querySelector('.card-mine'), 'the card closed').toBeNull();
    expect(host.querySelector('.picker.stat-detail'), 'the stat popup stays').toBeTruthy();
    await click(host.querySelector('.sd-sit-more'));
    const overlay = host.querySelector('.card-mine')!.parentElement!;
    expect(overlay.classList.contains('picker-overlay')).toBe(true);
    await click(overlay);
    expect(host.querySelector('.card-mine'), 'a click outside closes the card').toBeNull();
    expect(onClose, 'and not the stat popup').not.toHaveBeenCalled();
    await click(host.querySelector('.sd-sit-more'));
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await settle();
    expect(host.querySelector('.card-mine'), 'Escape closes the card first').toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/*
 * Section 2 rule 4.5–4.6 on BOTH mine lanes: after the body, the ours box, then the footer — our dimmed
 * Source line (only where the page prints none), the RemasteredLine, the desk #152 empty note, the
 * no-page line — and the caller's footer last. The real RecordCard draws a synthesized bucket (served
 * by this file's fetch stub, no shipped record), because no shipped record has every footer line at once
 * and StatDetailModal passes neither `ours`, `fallbackText` nor `footer`.
 */
describe('card step 5: the mine card footer order (section 2 rule 4.6), on both lanes', () => {
  const B = 'synthCard';
  const ra = { bucket: B, id: 'synthetic-reprint', name: 'Synthetic Reprint' };
  const synthDb = {
    ...db,
    [B]: {
      'synthetic-paged-feat': { id: 'synthetic-paged-feat', name: 'Synthetic Paged Feat', description: 'Synthetic old text of the paged feat.', source: { book: 'Synthetic Book', page: 7 }, remasteredAs: ra },
      'synthetic-pageless-feat': { id: 'synthetic-pageless-feat', name: 'Synthetic Pageless Feat', description: '', source: { book: 'Synthetic Book', page: 9 }, remasteredAs: ra },
      'synthetic-reprint': { id: 'synthetic-reprint', name: 'Synthetic Reprint', description: 'Synthetic reprint text.' },
    },
  } as unknown as ContentDatabase;
  const t = (v: string): AstNode => ({ t: 'text', v });
  beforeAll(() => {
    // A page that prints no Source line, so our own Source line stands in (the page lane's fallback).
    trees[B] = {
      'synthetic-paged-feat': { t: 'document', c: [{ t: 'title', level: 1, c: [t('Synthetic Paged Feat')] }, { t: 'p', c: [{ t: 'b', c: [t('Frequency')] }, t(' once per day')] }, { t: 'hr' }, { t: 'p', c: [t('Synthetic page prose of the paged feat.')] }] },
      'synthetic-reprint': { t: 'document', c: [{ t: 'title', level: 1, c: [t('Synthetic Reprint')] }, { t: 'p', c: [t('Synthetic reprint prose.')] }] },
    };
  });
  async function openCard(id: string) {
    const host = await mount(
      <ContentContext.Provider value={synthDb}>
        <RecordCard record={{ bucket: B, id }} mode="mine" chrome="popup" onExit={noop}
          ours={[{ kind: 'note', text: 'A synthetic note of ours.' }]} fallbackText="Synthetic empty note."
          footer={<p className="synthetic-caller-foot">Synthetic caller footer.</p>} />
      </ContentContext.Provider>, null);
    return host.querySelector('.card-mine')!;
  }
  /** Each selector's first element, as its index in document order inside `root` (-1 = absent). */
  const positions = (root: Element, sels: string[]) => {
    const all = [...root.querySelectorAll('*')];
    return sels.map((s) => all.indexOf(root.querySelector(s) as Element));
  };
  const increasing = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));

  it('page lane: body, ours box, our Source (the page prints none), RemasteredLine, caller footer — in that order', async () => {
    const card = await openCard('synthetic-paged-feat');
    expect(card.matches('.ast-modal.card-mine'), 'the page lane').toBe(true);
    const sels = ['.ast-body p', '.card-ours', '.card-foot-source', '.sd-remastered', '.synthetic-caller-foot'];
    const at = positions(card, sels);
    expect(increasing(at), sels.map((s, i) => `${s}@${at[i]}`).join(' ')).toBe(true);
    const src = card.querySelector('.card-foot-source')!;
    expect(src.matches('[data-ours]'), 'our Source line is marked ours').toBe(true);
    expect(squash(src.textContent)).toBe('Source Synthetic Book pg. 7');
    expect(src.querySelector('p.card-dim'), 'and dimmed').toBeTruthy();
  });

  it('no-page lane: ours box, our Source, RemasteredLine, the #152 empty note, the no-page line, caller footer — in that order', async () => {
    const card = await openCard('synthetic-pageless-feat');
    expect(card.matches('.picker.info-modal.card-mine'), 'the no-page lane').toBe(true);
    const sels = ['.card-ours', '.card-foot-source', '.sd-remastered', '.sd-unprinted', '.card-nopage', '.synthetic-caller-foot'];
    const at = positions(card, sels);
    expect(increasing(at), sels.map((s, i) => `${s}@${at[i]}`).join(' ')).toBe(true);
    expect(card.querySelectorAll('.sd-unprinted').length, 'the empty note is said once').toBe(1);
    expect(squash(card.querySelector('.sd-unprinted')!.textContent)).toBe('Synthetic empty note.');
    expect(squash(card.querySelector('.card-nopage')!.textContent)).toBe('No Archives page — text from our older import');
  });

  it('both lanes mark our field-derived Source line ours, with the same markup', async () => {
    const paged = (await openCard('synthetic-paged-feat')).querySelector('.card-foot-source')!;
    const pageless = (await openCard('synthetic-pageless-feat')).querySelector('.card-foot-source')!;
    for (const [lane, el] of [['page', paged], ['no-page', pageless]] as const) {
      expect(el, `${lane} lane has our Source line`).toBeTruthy();
      expect(el.matches('[data-ours]'), `${lane} lane: our Source line is marked ours`).toBe(true);
      expect(el.querySelector('p.card-dim.card-source > strong')?.textContent, `${lane} lane: dimmed, labelled`).toBe('Source');
    }
    expect(squash(pageless.textContent)).toBe('Source Synthetic Book pg. 9');
  });
});

/*
 * The guard's own reading of a "<X> leads to…" section (scripts/lib/card-scope.mjs omissionLog): only the
 * ONE lead-less line straight after the dropped heading takes the heading's S-furniture; a further
 * dropped line (a sidebar heading or prose after the link list) is named by its own words. Otherwise a
 * cardFurnitureSectionEnd that swallowed past the link list would be excused by position.
 */
describe('card step 5 guard: a leads-to section excuses its link list only', () => {
  const blk = (t: string) => ({ runs: [{ t }], text: t });
  it('the link list is S-furniture; a third dropped line after it is UNNAMED', () => {
    const page = [blk('Kept prose of the record.'), blk('Synthetic Feat leads to...'), blk('Synthetic Follow-Up, Other Follow-Up'), blk('Controlling things is a sidebar the card must not lose.')];
    const log = omissionLog(page, [page[0]], [], new Set<string>()) as { text: string; rule: string }[];
    expect(log.map((r) => r.rule)).toEqual(['S-furniture', 'S-furniture', 'UNNAMED']);
    expect(log[2].text).toMatch(/^Controlling things/);
  });
});
