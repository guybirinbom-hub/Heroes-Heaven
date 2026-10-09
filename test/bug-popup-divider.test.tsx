// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderDom } from './_render';
import { AstRenderer } from '../src/sheet/AstRenderer';
import { DescBody } from '../src/sheet/DescBody';
import { ContentContext } from '../src/sheet/ContentContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import type { ContentDatabase } from '../src/rules/types';
import { FeatDetail, type FeatEntry } from '../src/sheet/FeatDetail';

/**
 * bug 2026-09-12 #8: popup-divider.
 *
 * Owner, on the "Activate an Item" popup: *"i dont like this line above the text, it is useful when
 * there is another text above it but when there isnt there isnt a point for the line and such a big
 * gap between the text and the top of the pop up."*
 *
 * An archive page is shaped <stat header> <hr> <prose>. A popup that leaves the whole header out made the
 * page's separator the FIRST thing in the popup body: a rule under the title bar with .7em of its own
 * margin above and below and nothing to separate. Measured on the shipped artefact: 18,667 of 24,964
 * pages opened that way in the pre-card detail popups (`hideMeta`), and 0 in the modal path (where the
 * Source/stat lines do render above it).
 *
 * Card step 22 removed `hideMeta` and DescBody's page branch with every legacy popup that drew them:
 * each detail popup is its record's 'mine' card, which prints the page's header lines (Source dimmed,
 * the use lines at full weight) unless the surface's own stat rows printed that label. The rule still
 * holds there — a divider only where something precedes it — and is pinned below on a header whose every
 * line the surface printed (a synthesized page: no shipped header lacks its Source line, which a card
 * always keeps), with the empty-container residual: a `column` whose every line drops out renders
 * nothing, not an empty fragment that counts as "something above" (32 pages once opened on a rule
 * through it — items/conundrum-spectacles among them).
 *
 * MUTATION LINES (card step 22, each measured red, then restored byte-exact):
 *  - AstRenderer.tsx Blocks: `if (n.t === 'hr' && lead && !out.length) continue;` removed → the
 *    printed-header card case red (the body opens on HR).
 *  - AstRenderer.tsx Blocks end: `return out.length ? <>{out}</> : null;` → `return <>{out}</>;` → the
 *    same case red (the empty column counts as something above).
 *
 * Reads the TRACKED public/ast/*.json.gz (the gitignored raw .json beside them is local regen output),
 * so it measures what actually ships — the same source ast-provenance-render.test.tsx reads.
 */
const readBucket = (b: string) =>
  JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8')) as Record<string, AstNode>;

const actions = readBucket('actions');
const ACTIVATE = actions['activate-an-item'];
const items = readBucket('items');
const NECKLACE = items['necklace-of-fireballs-iii'];

const bodyOf = (host: HTMLElement) => {
  const b = host.querySelector('.ast-body');
  if (!b) throw new Error('no .ast-body rendered');
  return b as HTMLElement;
};
const rules = (el: Element) => [...el.querySelectorAll('hr.ast-hr')];

/** A synthesized page shaped like an action's: its header `column` holds only use lines (no Source line),
 *  then the rule, then the prose, then a second section under its own rule. No shipped record. */
const SYNTH = {
  t: 'doc',
  c: [
    { t: 'title', level: 1, c: [{ t: 'text', v: 'Synthesized Lever' }] },
    { t: 'column', c: [
      { t: 'p', c: [{ t: 'b', c: [{ t: 'text', v: 'Requirements' }] }, { t: 'text', v: ' You hold the synthesized lever.' }] },
      { t: 'p', c: [{ t: 'b', c: [{ t: 'text', v: 'Frequency' }] }, { t: 'text', v: ' once per round' }] },
    ] },
    { t: 'hr' },
    { t: 'p', c: [{ t: 'text', v: 'You pull the synthesized lever and it clicks.' }] },
    { t: 'title', level: 2, c: [{ t: 'text', v: 'Second Lever' }] },
    { t: 'hr' },
    { t: 'p', c: [{ t: 'text', v: 'The second lever clicks too.' }] },
  ],
} as unknown as AstNode;

describe('bug #8 — a divider only where something precedes the body', () => {
  it('the page tree really does open with a rule (otherwise this guard measures nothing)', () => {
    // The ast still carries the page's own separator, directly after its stat header. Pin that, or a
    // data change could make every assertion below pass for the wrong reason.
    expect(ACTIVATE.c?.map((n) => n.t).slice(0, 5)).toEqual(['title', 'traits', 'column', 'hr', 'p']);
    // batch card: #card-LEGACY-GONE — step 22 removed the hideMeta "Activate an Item" case that followed this block
    expect(NECKLACE.c?.filter((n) => n.t === 'hr')).toHaveLength(8);
  });

  it('the same record in the MODAL popup keeps its rule — Source and Requirements print above it', () => {
    const { host, stop } = renderDom(<AstRenderer node={ACTIVATE} onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      const hr = rules(body);
      expect(hr, 'the separator still separates here').toHaveLength(1);
      const above = hr[0].previousElementSibling;
      expect(above, 'something precedes it').not.toBeNull();
      expect(above!.className).toContain('ast-meta');
      expect(above!.textContent).toContain('Requirements');
      // batch card: #card-LEGACY-GONE — step 22 removed the hideMeta necklace case that followed this block
      expect(body.firstElementChild!.textContent).toContain('Source');
    } finally { stop(); }
  });

  it('the same item in the MODAL popup keeps all eight — its stat line prints above the first', () => {
    const { host, stop } = renderDom(<AstRenderer node={NECKLACE} onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      expect(rules(body)).toHaveLength(8);
      // batch card: #card-LEGACY-GONE — step 22 removed DescBody's page branch, and with it the "through DescBody" block that followed this one
      expect(rules(body)[0].previousElementSibling!.textContent).toContain('Usage');
    } finally { stop(); }
  });

  // batch card: #card-INHERITED — a divider only where something precedes the body: SYNTH is a page shaped header column / rule / prose, with every header line printed.
  it('a mine card whose surface printed every header line opens on the prose — the empty column is not "something above"', () => {
    const { host, stop } = renderDom(<AstRenderer node={SYNTH} bodyOnly card={{ printed: new Set(['Requirements', 'Frequency']) }} onOpenRef={() => undefined} />);
    try {
      const body = bodyOf(host);
      expect(body.firstElementChild?.tagName, 'no rule, and no empty node standing in for one').toBe('P');
      expect(body.firstElementChild?.textContent).toBe('You pull the synthesized lever and it clicks.');
      // The rule under the second heading divides something, so it stays — this drops a separator, never content.
      const hr = rules(body);
      // batch card: #card-INHERITED — the renderer's tree rules hold on the card
      expect(hr).toHaveLength(1);
      expect(hr[0].previousElementSibling!.className).toContain('ast-h2');
      expect(body.textContent).toContain('The second lever clicks too.');
      expect(body.textContent, 'the printed lines leave (S-printed)').not.toContain('once per round');
    } finally { stop(); }
  });

  // batch card: #card-INHERITED — the same shape with nothing printed: the use lines stay above the rule.
  it('the same card with an empty printed set keeps the rule — the use lines print above it', () => {
    const { host, stop } = renderDom(<AstRenderer node={SYNTH} bodyOnly card={{ printed: new Set() }} onOpenRef={() => undefined} />);
    try {
      const hr = rules(bodyOf(host));
      expect(hr).toHaveLength(2);
      expect(hr[0].previousElementSibling!.textContent).toContain('Frequency once per round');
    } finally { stop(); }
  });

  it('desk #152\'s "no rules text" note is unaffected — that branch never had a page tree to divide', () => {
    const { host, stop } = renderDom(<DescBody description="" emptyNote="The book prints no rules text for this item." />);
    try {
      expect(host.querySelector('.sd-unprinted')?.textContent).toBe('The book prints no rules text for this item.');
      expect(rules(host)).toHaveLength(0);
    } finally { stop(); }
  });
});

/* ---- card step 11: the Feats-tab popup is the 'mine' card ---- */

/*
 * The pre-card Feats-tab popup (FeatDetail through DescBody, hideMeta) dropped a feat page's whole header
 * column and with it the rule under it. That also dropped the feat's Frequency and Trigger: gold-set
 * principle E wants a reaction's trigger and requirements in its popup. Since card step 11 FeatDetail is
 * the record's 'mine' card: the printed set is empty, so the page's use lines print above the rule, and
 * the rule separates them from the prose — something precedes it, which is this guard's own rule.
 * Halfling Luck (Archives feat-4458) is shaped column / hr / p.
 */
const feats = readBucket('feats');
const LUCK = feats['halfling-luck'];
const db = { items: {}, actions: {} } as unknown as ContentDatabase;

// batch card premise: feat-4458 "Frequency once per day"
describe('bug #8 — on the Feats-tab card, the use lines are what the rule separates', () => {
  beforeAll(async () => {
    /* jsdom cannot fetch public/ast, so serve the TRACKED .gz off disk: astStore asks for
     * `<bucket>.json.gz` first and falls back to `<bucket>.json`, so 404 the first and answer the
     * second. Only the record under test is served — the bytes still come from the shipped file. */
    globalThis.fetch = (async (input: unknown) => {
      if (/ast\/feats\.json$/.test(String(input))) return new Response(JSON.stringify({ 'halfling-luck': LUCK }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('', { status: 404 });
    }) as typeof fetch;
    await loadBucketAst('feats');
  });

  const luckPopup = () => {
    const cdb = { ...db, feats: { 'halfling-luck': { id: 'halfling-luck', name: 'Halfling Luck', source: { book: 'Player Core', page: 60 } } } } as unknown as ContentDatabase;
    const entry: FeatEntry = { key: 'halfling-luck', name: 'Halfling Luck', level: 1, traits: [], description: '', isFeature: false, bucket: 'ancestry', featId: 'halfling-luck', ours: [] };
    return renderDom(<ContentContext.Provider value={cdb}><FeatDetail entry={entry} onClose={() => undefined} /></ContentContext.Provider>);
  };

  // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
  it('halfling-luck: Source, Frequency and Trigger print above the page\'s rule, which divides them from the prose', () => {
    expect(LUCK.c?.map((n) => n.t).slice(0, 5)).toEqual(['title', 'traits', 'column', 'hr', 'p']);
    const { host, stop } = luckPopup();
    try {
      const body = host.querySelector('.ast-modal.card-mine .ast-pop > .ast-body');
      // batch card premise: feat-4458 "Frequency once per day"
      expect(body, 'the Feats-tab popup is the mine card, page lane').toBeTruthy();
      const hr = rules(body!);
      expect(hr, 'the page\'s rule stays: something precedes it').toHaveLength(1);
      expect(hr[0].previousElementSibling, 'the header lines precede it').not.toBeNull();
      expect(hr[0].previousElementSibling!.textContent).toContain('Trigger');
      const above: string[] = [];
      for (let el = hr[0].previousElementSibling; el; el = el.previousElementSibling) above.unshift(el.textContent ?? '');
      // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
      expect(above.join(' | ')).toMatch(/Source.*\|.*Frequency once per day.*\|.*Trigger You fail a/);
      expect(hr[0].nextElementSibling?.textContent).toContain('Your happy-go-lucky nature');
    } finally { stop(); }
  });
});
