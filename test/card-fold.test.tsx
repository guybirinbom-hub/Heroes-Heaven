// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { StatDetailModal } from '../src/sheet/StatDetailModal';
import { CARD_ON } from '../src/sheet/cardSurfaces';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Card step 13a (docs/card-design.md section 3, section 9 row 13a; owner ruling Q1 = A, section 13):
 * LEVEL FOLDS on the screen. Every case renders the REAL StatDetailModal with a synthesized character
 * (built here with test/_content's build, name 't' — never an owner's character), opens a situational
 * line's "Full text" (the 'mine' card, CARD_ON.statDetail), and reads the card off the DOM:
 *  - the parts the character does not have yet sit under ONE closed, dimmed line "At higher levels (k)"
 *    (a <details>; the folded text stays in the DOM, the line is ours);
 *  - an option the build does not have folds under "Other options (k)";
 *  - an unknown pick is shown; a pointer row shows its subclass section; an applying impulse "Level"
 *    entry is highlighted and nothing is hidden;
 *  - FUTURE_TREATMENT, the one switch: 'hide' leaves only a marker, 'grey' keeps the text in place, dimmed.
 *
 * MUTATION LINES (each measured red on 2026-10-03, then restored byte-exact from a scratch copy):
 *  - StatDetailModal.tsx: `scope={scopeOfCharacter(character)}` removed → the Justice / thaumaturge /
 *    impulse / pointer cases red (no scope, nothing folds).
 *  - AstRenderer.tsx CardFoldEl: `<details className="card-fold" …>` without the summary's `data-ours`
 *    → the "line is ours" assertion red.
 *  - AstRenderer.tsx renderBlock 'p': the `applies` branch removed → the impulse case red.
 *  - AstRenderer.tsx CardFoldEl: the 'hide' branch removed (falls through to the fold) → the hide case
 *    red; the 'grey' branch removed → the grey case red.
 *  - RecordCard.tsx: `withPointer(…)` unwrapped to the scoped tree alone → the pointer case red.
 */
const noop = () => undefined;
const db: ContentDatabase = content();
const BUCKETS = ['feats', 'classFeatures', 'items'] as const;
const trees: Record<string, Record<string, AstNode>> = {};
let astIndex: Record<string, string> = {};

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const b of BUCKETS) trees[b] = JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8'));
  astIndex = JSON.parse(readFileSync('public/ast-index.json', 'utf8'));
  vi.stubGlobal('fetch', async (url: string) => {
    if (/ast-index\.json$/.test(String(url))) return { ok: true, json: async () => astIndex };
    const m = /ast\/(\w+)\.json$/.exec(String(url));
    return m && trees[m[1]] ? { ok: true, json: async () => trees[m[1]] } : { ok: false };
  });
  for (const b of BUCKETS) await loadBucketAst(b);
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

const mounted: (() => void)[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!(); });
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
type Ctx = { Provider: typeof ContentContext.Provider };
async function mount(el: ReactElement, ctx: Ctx = ContentContext): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<ctx.Provider value={db}>{el}</ctx.Provider>); });
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

/** The real StatDetailModal for `ch` with one situational line from `bucket:id`, its Full text opened. */
async function openCard(ch: Character, bucket: string, id: string, Modal: typeof StatDetailModal = StatDetailModal, ctx: Ctx = ContentContext) {
  const breakdown = { title: 'Stat', totalText: '+0', parts: [], timeline: [], situational: [{ text: 'a situational line', sourceId: id, sourceCollection: bucket as never }] };
  const host = await mount(<Modal breakdown={breakdown} character={ch} content={db} onClose={noop} />, ctx);
  await click(host.querySelector('.sd-sit-more'));
  const modal = host.querySelector('.ast-modal.card-mine') as HTMLElement | null;
  expect(modal, `${bucket}:${id} opens the mine card, page lane`).toBeTruthy();
  return modal!;
}
/** What a reader sees without opening anything: the card's text with every CLOSED fold's body removed. */
function openText(modal: HTMLElement): string {
  const copy = modal.cloneNode(true) as HTMLElement;
  for (const d of copy.querySelectorAll('details:not([open])')) for (const k of [...d.children]) if (k.tagName !== 'SUMMARY') k.remove();
  return squash(copy.textContent);
}
const folds = (modal: HTMLElement) => [...modal.querySelectorAll('details.card-fold')] as HTMLDetailsElement[];

describe.runIf(CARD_ON.statDetail)('card step 13a: level folds on the mine card', () => {
  it('a Justice champion at 5: no Relentless Reaction open, ONE closed "At higher levels (2)" line, the text inside it', async () => {
    const modal = await openCard(build('champion', 5, { subclassId: 'justice' }), 'classFeatures', 'justice');
    const f = folds(modal);
    expect(f.length).toBe(1);
    expect(f[0].open).toBe(false);
    expect(f[0].dataset.fold).toBe('future');
    const line = f[0].querySelector(':scope > summary');
    expect(squash(line?.textContent)).toBe('At higher levels (2)');
    expect(line?.hasAttribute('data-ours'), 'the line is ours, not print').toBe(true);
    expect(openText(modal)).not.toMatch(/Relentless Reaction|Exalted Reaction|persistent spirit damage/);
    // Folded, never deleted: the words are in the DOM, inside the fold.
    expect(squash(f[0].textContent)).toMatch(/Relentless Reaction.*persistent spirit damage.*Exalted Reaction/);
    // The rest of the page stays open.
    expect(openText(modal)).toMatch(/Champion's Reaction/);
  });

  it('the fold opens on a tap (a native <summary>, so the keyboard opens it too) and closes again', async () => {
    const modal = await openCard(build('champion', 5, { subclassId: 'justice' }), 'classFeatures', 'justice');
    const f = folds(modal)[0];
    const line = f.querySelector(':scope > summary') as HTMLElement;
    expect(line.tagName).toBe('SUMMARY');
    await click(line);
    expect(f.open).toBe(true);
    expect(openText(modal)).toMatch(/Relentless Reaction/);
    await click(line);
    expect(f.open).toBe(false);
  });

  it('at 9 Relentless Reaction is open and Exalted Reaction is folded, its text inside the fold', async () => {
    const modal = await openCard(build('champion', 9, { subclassId: 'justice' }), 'classFeatures', 'justice');
    expect(openText(modal)).toMatch(/Relentless Reaction.*persistent spirit damage/);
    expect(openText(modal)).not.toMatch(/Exalted Reaction/);
    const f = folds(modal);
    expect(f.map((d) => squash(d.querySelector(':scope > summary')?.textContent))).toEqual(['At higher levels (1)']);
    expect(squash(f[0].textContent)).toMatch(/Exalted Reaction.*Each ally in your champion.s aura/);
  });

  it('a pointer row: relentless-reaction at 9 shows the Justice cause\'s section; at 5 that section is folded', async () => {
    const m9 = await openCard(build('champion', 9, { subclassId: 'justice' }), 'classFeatures', 'relentless-reaction');
    const ptr = m9.querySelector('.card-pointer[data-pointer="classFeatures:justice"]');
    expect(ptr, 'the subclass section is drawn').toBeTruthy();
    expect(squash(ptr!.textContent)).toMatch(/Relentless Reaction.*persistent spirit damage/);
    expect(ptr!.closest('details'), 'open at 9').toBeNull();
    const m5 = await openCard(build('champion', 5, { subclassId: 'justice' }), 'classFeatures', 'relentless-reaction');
    const ptr5 = m5.querySelector('.card-pointer');
    expect(ptr5?.closest('details.card-fold:not([open])'), 'folded at 5').toBeTruthy();
  });

  it('a thaumaturge 11 with one implement at adept: only the owned Adept open; another implement\'s benefits fold as other options', async () => {
    const ch = build('thaumaturge', 11, { extraChoices: { implement: ['amulet'] } });
    const amulet = await openCard(ch, 'classFeatures', 'amulet');
    expect(openText(amulet)).toMatch(/Adept Benefit.*Intensify Benefit/);
    expect(openText(amulet)).not.toMatch(/Paragon Benefit/);
    expect(folds(amulet).map((d) => [d.dataset.fold, squash(d.querySelector(':scope > summary')?.textContent)])).toEqual([['future', 'At higher levels (1)']]);
    const bell = await openCard(ch, 'classFeatures', 'bell');
    expect(openText(bell)).not.toMatch(/Adept Benefit|Paragon Benefit|Intensify Benefit/);
    const f = folds(bell);
    expect(f.map((d) => [d.dataset.fold, squash(d.querySelector(':scope > summary')?.textContent)])).toEqual([['pick', 'Other options (3)']]);
    expect(squash(f[0].textContent)).toMatch(/Adept Benefit.*Intensify Benefit.*Paragon Benefit/);
  });

  it('an unknown pick is shown: a thaumaturge 11 with no implement on record sees the adept benefit open', async () => {
    const bell = await openCard(build('thaumaturge', 11, { extraChoices: {} }), 'classFeatures', 'bell');
    expect(openText(bell)).toMatch(/Adept Benefit.*Intensify Benefit/);
    expect(folds(bell).map((d) => squash(d.querySelector(':scope > summary')?.textContent))).toEqual(['At higher levels (1)']);
  });

  it('a kineticist impulse: the applying "Level (+2)" entry is highlighted and nothing is hidden', async () => {
    const at3 = await openCard(build('kineticist', 3, { extraChoices: { element: ['air-gate'] } }), 'feats', 'aerial-boomerang');
    const hi = [...at3.querySelectorAll('.card-applies')];
    expect(hi.map((p) => squash(p.textContent))).toEqual(['Level (+2) The damage increases by 1d4.']);
    expect(hi[0].closest('[data-ours]'), 'the highlight is a class on the page\'s own paragraph').toBeNull();
    expect(at3.querySelector('[data-fold]'), 'an impulse folds nothing').toBeNull();
    const at2 = await openCard(build('kineticist', 2, { extraChoices: { element: ['air-gate'] } }), 'feats', 'aerial-boomerang');
    expect(at2.querySelector('.card-applies')).toBeNull();
    expect(openText(at2)).toMatch(/Level \(\+2\) The damage increases by 1d4\./);
  });
});

/** The same Justice-at-5 card with FUTURE_TREATMENT switched — a fresh module graph with the constant
 *  mocked, so the switch is proved to be the ONE constant every part reads. */
async function justiceAt5With(treatment: 'hide' | 'grey') {
  vi.resetModules();
  vi.doMock('../src/sheet/cardScope', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/sheet/cardScope')>()), FUTURE_TREATMENT: treatment }));
  try {
    const { StatDetailModal: Modal } = await import('../src/sheet/StatDetailModal');
    const { ContentContext: Fresh } = await import('../src/sheet/ContentContext');
    const store = await import('../src/sheet/astStore');
    for (const b of BUCKETS) await store.loadBucketAst(b);
    return await openCard(build('champion', 5, { subclassId: 'justice' }), 'classFeatures', 'justice', Modal, Fresh);
  } finally {
    vi.doUnmock('../src/sheet/cardScope');
  }
}

describe.runIf(CARD_ON.statDetail)('card step 13a: FUTURE_TREATMENT is the one switch', () => {
  it('"hide" removes the folded text from the DOM and leaves only a marker', async () => {
    const modal = await justiceAt5With('hide');
    expect(folds(modal)).toEqual([]);
    expect(squash(modal.textContent)).not.toMatch(/Relentless Reaction|Exalted Reaction|persistent spirit damage/);
    const marker = modal.querySelector('[data-fold="future"]') as HTMLElement | null;
    expect(marker, 'a marker stays where the run was').toBeTruthy();
    expect(marker!.hidden).toBe(true);
    expect(squash(marker!.textContent)).toBe('');
    expect(squash(modal.textContent)).toMatch(/Champion's Reaction/);
  });

  it('"grey" keeps the text in place, dimmed', async () => {
    const modal = await justiceAt5With('grey');
    expect(folds(modal)).toEqual([]);
    const grey = modal.querySelector('.card-fold-grey.card-dim[data-fold="future"]');
    expect(grey, 'the run is drawn dimmed').toBeTruthy();
    expect(squash(grey!.textContent)).toMatch(/Relentless Reaction.*persistent spirit damage.*Exalted Reaction/);
    expect(openText(modal)).toMatch(/Relentless Reaction/);
  });
});
