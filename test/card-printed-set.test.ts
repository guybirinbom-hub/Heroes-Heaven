// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { AstNode } from '../src/sheet/astStore';
import { AstRenderer } from '../src/sheet/AstRenderer';
import { cardDropsMetaP, cardRowParts, leadOf } from '../src/sheet/astVisibility';
import { printedSet } from '../src/sheet/cardScope';

/**
 * Card step 5 (docs/card-design.md section 2 rule 4.2 and rule 5(d), S-printed): a 'mine' card leaves a
 * page header line out only when the surface's own stat rows printed its label. Two predicates carry it,
 * src/sheet/astVisibility.ts cardDropsMetaP (a META line drops only when EVERY label it leads with is in
 * the printed set AND it sits before the page's first rule) and cardRowParts (an inline-only stat row is
 * filtered per bold-label segment, header only), with src/sheet/cardScope.ts printedSet building the set.
 *
 * StatDetailModal, the one surface live in step 5, passes an EMPTY printed set, so no shipped popup
 * exercises a drop yet; this file pins the logic on synthesized trees (no shipped record, no owner data):
 * once through the predicates, once through the real AstRenderer with the `card` prop, which is where the
 * "before the first rule" header test (cardHeadUntil + Blocks' `cw.head`) lives.
 *
 * Measured: 0 of the 17,125 inline-only rows in the shipped trees (every public/ast bucket) holds a bold
 * run, so cardRowParts drops nothing on shipped pages today either; the synthetic row stands in for the
 * shape the rule is written for.
 *
 * MUTATION LINES (each measured red on 2026-10-02, then restored byte-exact from a scratch copy):
 *  - astVisibility.ts cardDropsMetaP: `if (!walk.head || !isMetaP(p)) return false;` →
 *    `if (!walk.head || !isMetaP(p) || walk) return false;` (never drops) → red.
 *  - astVisibility.ts cardRowParts: `if (!walk.head) return parts;` → `if (!walk.head || walk) return
 *    parts;` (never drops) → red.
 */

const txt = (v: string): AstNode => ({ t: 'text', v });
const bold = (v: string): AstNode => ({ t: 'b', c: [txt(v)] });
/** One labelled segment of an inline-only stat row ("Price 3 gp"). */
const seg = (label: string, value: string): AstNode => ({ t: 'view', c: [bold(label), txt(` ${value}`)] });
/** A labelled page line ("Frequency once per hour") — a META paragraph. */
const metaP = (label: string, value: string): AstNode => ({ t: 'p', c: [bold(label), txt(` ${value}`)] });
const prose = (v: string): AstNode => ({ t: 'p', c: [txt(v)] });
const row = (...parts: AstNode[]): AstNode => ({ t: 'row', c: parts });

// The renderer joins a row's parts with "; " itself, so the synthetic rows carry no separator nodes.
const ROW_LANTERN = () => row(seg('Price', '3 gp'), seg('Bulk', 'L'), seg('Usage', 'held in 1 hand'));

/** `<header> <hr> <prose>`: a stat row, a META line, an all-printed row, the rule, a META line, prose. */
function page(withRule = true): AstNode {
  return {
    t: 'document',
    c: [
      { t: 'title', level: 1, c: [txt('Synthetic Lantern')] },
      ROW_LANTERN(),
      metaP('Frequency', 'once per hour'),
      row(seg('Hands', '1'), seg('Price', '5 gp')),
      ...(withRule ? [{ t: 'hr' } as AstNode] : []),
      metaP('Frequency', 'once per day after the rule'),
      prose('Synthetic prose of the lantern.'),
    ],
  };
}

describe('S-printed predicates (astVisibility.ts cardDropsMetaP / cardRowParts)', () => {
  const parts = () => ROW_LANTERN().c || [];
  const labels = (ps: AstNode[]) => ps.map((p) => leadOf(p));

  // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
  it('an inline stat row is filtered per bold-label segment: printed {Price} keeps Bulk and Usage', () => {
    expect(labels(cardRowParts(parts(), { printed: printedSet(['Price']), head: true }))).toEqual(['Bulk', 'Usage']);
  });
  // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
  it('an inline row whose every label is printed keeps nothing', () => {
    expect(cardRowParts(parts(), { printed: printedSet(['Price', 'Bulk', 'Usage']), head: true })).toEqual([]);
  });
  // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
  it('after the first rule, and with an empty printed set, a row keeps every segment', () => {
    expect(labels(cardRowParts(parts(), { printed: printedSet(['Price']), head: false }))).toEqual(['Price', 'Bulk', 'Usage']);
    expect(labels(cardRowParts(parts(), { printed: printedSet([]), head: true }))).toEqual(['Price', 'Bulk', 'Usage']);
  });
  // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
  it('a META line drops only before the rule, and only when every label it leads with is printed', () => {
    const freq = metaP('Frequency', 'once per hour');
    expect(cardDropsMetaP(freq, { printed: printedSet(['Frequency']), head: true })).toBe(true);
    expect(cardDropsMetaP(freq, { printed: printedSet(['Frequency']), head: false }), 'after the rule it stays').toBe(false);
    expect(cardDropsMetaP(freq, { printed: printedSet([]), head: true }), 'an empty printed set drops nothing').toBe(false);
    const priceBulk: AstNode = { t: 'p', c: [bold('Price'), txt(' 3 gp; '), bold('Bulk'), txt(' L')] };
    // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
    expect(cardDropsMetaP(priceBulk, { printed: printedSet(['Price']), head: true }), 'Bulk was not printed').toBe(false);
    expect(cardDropsMetaP(priceBulk, { printed: printedSet(['Price', 'Bulk']), head: true })).toBe(true);
  });
  // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
  it('printedSet folds the spellings a stat row uses onto the page\'s canonical labels', () => {
    expect([...printedSet(['price', 'Requirement', 'Saving Throw', 'not a label'])].sort()).toEqual(['Defense', 'Price', 'Requirements']);
  });
});

describe('S-printed through the real AstRenderer (`card` prop, header = before the first rule)', () => {
  beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
  const mounted: (() => void)[] = [];
  afterEach(() => { while (mounted.length) mounted.pop()!(); });
  const squash = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();

  /** The body's block lines, in order, for `node` drawn as a 'mine' card with `printed`. */
  function linesOf(node: AstNode, printed: string[]): string[] {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(createElement(AstRenderer, { node, onOpenRef: () => undefined, bodyOnly: true, card: { printed: printedSet(printed) } }));
    });
    mounted.push(() => { act(() => root.unmount()); host.remove(); });
    return [...host.querySelectorAll('.ast-body p')].map((p) => squash(p.textContent));
  }

  // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
  it('printed {Price, Frequency, Hands}: Price leaves the stat row, the header Frequency line and the all-printed row leave, the Frequency line after the rule stays', () => {
    expect(linesOf(page(), ['Price', 'Frequency', 'Hands'])).toEqual([
      'Bulk L; Usage held in 1 hand',
      'Frequency once per day after the rule',
      'Synthetic prose of the lantern.',
    ]);
  });
  // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
  it('printed {} drops nothing: every labelled line shows, in the page\'s order', () => {
    expect(linesOf(page(), [])).toEqual([
      'Price 3 gp; Bulk L; Usage held in 1 hand',
      'Frequency once per hour',
      'Hands 1; Price 5 gp',
      'Frequency once per day after the rule',
      'Synthetic prose of the lantern.',
    ]);
  });
  // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
  it('a page with no rule has no header, so the printed set leaves nothing out', () => {
    expect(linesOf(page(false), ['Price', 'Frequency', 'Hands'])).toEqual([
      'Price 3 gp; Bulk L; Usage held in 1 hand',
      'Frequency once per hour',
      'Hands 1; Price 5 gp',
      'Frequency once per day after the rule',
      'Synthetic prose of the lantern.',
    ]);
  });
});
