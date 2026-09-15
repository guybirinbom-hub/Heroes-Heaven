import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * bug 2026-09-15: phantom scrollbar. The owner, with a screenshot of the Bedroll item popup:
 *
 *   *"there are many times where there is a scroll bar but there isn't any scrolling because the full
 *   popup is showing; there are times where it works correctly: there isn't a scroll bar, and when I
 *   make the popup a size where I don't see everything a scroll bar appears. fix."*
 *
 * MEASURED IN THE RUNNING APP (dev server, Chromium at devicePixelRatio 1.75 — where CSS lengths land
 * on sevenths of a pixel), not reasoned about. Two causes, both real, both produce the same picture:
 * every word visible, a wide empty band under the last line, and a scrollbar whose thumb fills almost
 * the whole track.
 *
 * (a) TRAILING WHITESPACE IS SCROLLABLE CONTENT. A scroll box's scrollHeight counts the box's own
 *     bottom padding, its last child's bottom margin and (here) the embedded description's own bottom
 *     padding. `.sd-body` carried 13px + 9px + 15px of that, so dragging a popup anywhere inside a
 *     23-44px band below its natural height painted a scrollbar while every letter still showed.
 *     Trailing empty space inside .sd-body, measured below the last text block:
 *       Bedroll 23px  ·  Full Plate 37px  ·  Staff of Fire 44px      (before)
 *       Bedroll  1px  ·  Full Plate  0px  ·  Staff of Fire  7px      (after)
 *
 * (b) THE PINNED HEIGHT WAS ROUNDED. PopupSizeLock freezes a settled popup at its own height, and it
 *     read that height from `offsetHeight` — an integer. A popup is 261.286px tall, not 261px, so the
 *     pin handed the flex body ~0.3px LESS than its content: a scrollbar. And once the 11px bar takes
 *     its width the text rewraps one line narrower, which turns the hair into a REAL ~22px overflow of
 *     pure whitespace. Popups whose height rounded UP were unaffected — the owner's "there are times
 *     where it works correctly". Measured, sd-body scroll vs client:
 *       Bedroll       natural 261.286px → pinned 261 → 202 scroll vs 201 client, 11px bar
 *       Full Plate    natural 708.402px → pinned 708 → 649 scroll vs 648 client, 11px bar
 *       Staff of Fire natural 748.571px → pinned 749 → 689 scroll vs 689 client, no bar (rounded up)
 *     After, with the height pinned from the computed (unrounded) value:
 *       Bedroll       natural 224.286px → pinned 224.286px → 165/165, no bar
 *       Full Plate    natural 671.402px → pinned 671.402px → 612/612, no bar
 *       Staff of Fire natural 711.571px → pinned 711.571px → 652/652, no bar
 *
 * Adversarially confirmed afterwards in the browser: dragging the Bedroll popup down to 220px cuts
 * real text and the scrollbar comes back (client 160 vs scroll 165, 11px bar, 74px of actual scroll),
 * and it goes away again from 224px up. Resizing still works — none of this touches `resize: both`.
 *
 * jsdom does no layout and applies no stylesheet, so none of the above can be re-measured in a test.
 * What a test CAN hold is the shape of the two fixes, which is what the legs below pin.
 */
const CSS = readFileSync('src/sheet.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const rulesFor = (sel: string) => RULES.filter((r) => r.sel.split(',').some((s) => s.trim() === sel));

/** The bottom edge a rule declares, shorthand included — `padding: a b c d` is top right bottom left. */
function edge(body: string, prop: 'padding' | 'margin'): string | undefined {
  let bottom: string | undefined;
  for (const decl of body.split(';')) {
    const [rawName, ...rest] = decl.split(':');
    const name = rawName.trim();
    const value = rest.join(':').trim();
    if (!value) continue;
    if (name === `${prop}-bottom`) bottom = value;
    else if (name === prop) {
      const parts = value.split(/\s+/);
      bottom = parts.length >= 3 ? parts[2] : parts[0];
    }
  }
  return bottom;
}
const isZero = (v: string | undefined) => v !== undefined && /^0(px|%|em|rem)?$/.test(v);

describe('bug 2026-09-15: phantom scrollbar — the popup body scrolls its own empty space', () => {
  it('.sd-body leaves no bottom padding inside the scroll box', () => {
    const bodies = rulesFor('.sd-body');
    expect(bodies.length).toBeGreaterThan(0);
    // The LAST one is the one that runs: two plain `.sd-body` rules ship (an earlier `padding: 2px 0`
    // that has always been dead — same specificity, later wins) and any phone override comes later
    // still, so reading the last rule catches a reinstated padding wherever it is declared.
    expect(isZero(edge(bodies[bodies.length - 1].body, 'padding'))).toBe(true);
  });

  it('the last child gives up its bottom margin, which escapes into the scrollable overflow', () => {
    const rules = rulesFor('.sd-body > :last-child');
    expect(rules.length).toBe(1);
    expect(isZero(edge(rules[0].body, 'margin'))).toBe(true);
  });

  it('an embedded description keeps no bottom padding of its own', () => {
    // `.ast-embed { padding: 0 }` (ast.css) says exactly this, but it is declared before
    // `.ast-body { padding: 12px 15px 15px }` and loses on source order, so the popup re-states it.
    const rules = rulesFor('.sd-desc > .ast-embed');
    expect(rules.length).toBe(1);
    expect(isZero(edge(rules[0].body, 'padding'))).toBe(true);
  });

  it('PopupSizeLock pins the unrounded height', () => {
    const src = readFileSync('src/sheet/PopupSizeLock.tsx', 'utf8').replace(/\/\/[^\n]*/g, '');
    const pin = src.slice(src.indexOf('const pin ='), src.indexOf('const restart ='));
    expect(pin).toContain('getComputedStyle(el).height');
    // offsetHeight is an integer; on a scaled display that rounds the popup ~0.3px SHORT of its
    // content, which is a scrollbar over nothing.
    expect(pin).not.toContain('offsetHeight');
  });
});
