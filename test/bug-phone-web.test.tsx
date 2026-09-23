// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OverlayDismissGuard } from '../src/sheet/OverlayDismissGuard';
import { renderDom } from './_render';

/**
 * The phone WEBSITE (owner, 2026-09-22): popups that would not dismiss, a Notes page "completely
 * messed up" there but fine in the installed app, and a bottom tab row that disappears under the
 * browser's own bar. Two mechanisms, and this file guards both.
 *
 * 1. A mobile browser sizes the initial containing block — what `position: fixed; inset: 0` and
 *    `100vh` resolve against — to the LARGE viewport, the height the page would have with the URL bar
 *    and toolbar hidden. Every full-screen surface therefore runs past the bottom of what can be seen
 *    while that chrome is up. `dvh` is the currently visible height and is the same number inside the
 *    installed app, so the phone rules carry a dvh companion.
 * 2. A popup dismisses on a click on its backdrop, and a click is only reported when the press ENDS.
 *    On a phone the backdrop beside a 94vw popup is an ~11px strip, so a finger that drags the popup's
 *    text and lifts just outside it dismissed the popup. OverlayDismissGuard now ignores a click whose
 *    press began on the popup — asserted here with the event sequence a touch screen really sends.
 *
 * jsdom has no layout, so (1) is asserted on the CSS text. NOT by looking for the rule: the first cut of
 * this fix was written and shipped while doing nothing at all, because a `height` can be reverted by a
 * `min-height` set elsewhere and an `!important` can be beaten by a LATER `!important` at the same
 * specificity. So these tests RESOLVE THE CASCADE — every rule in the file that matches the element,
 * ranked by important > specificity > document order — and assert the value that actually wins.
 */

/** Both sheets, in the order the app loads them: Builder.tsx imports builder.css, and main.tsx only
 *  reaches sheet.css afterwards — so at equal specificity a sheet.css declaration wins the tie (measured
 *  in the browser). builder.css is here because it is the OTHER file that sizes `.builder`, and a
 *  resolver that cannot see it would call a cross-file clamp green. */
const CSS = ['src/builder/builder.css', 'src/sheet.css']
  .map((f) => readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8'))
  .join('\n');

type Rule = { sels: string[]; body: string; at: string[]; order: number };

/** Every rule in the file, with its at-rule context and its position in the document. */
function parse(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const stack: { prelude: string; open: number }[] = [];
  let mark = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') {
      stack.push({ prelude: src.slice(mark, i).trim(), open: i });
      mark = i + 1;
    } else if (src[i] === '}') {
      const top = stack.pop();
      if (!top) throw new Error('unbalanced } in sheet.css');
      if (!top.prelude.startsWith('@') && !stack.some((s) => s.prelude.startsWith('@keyframes')))
        out.push({
          sels: top.prelude.split(',').map((s) => s.trim()).filter(Boolean),
          body: src.slice(top.open + 1, i),
          at: stack.map((s) => s.prelude),
          order: top.open,
        });
      mark = i + 1;
    }
  }
  if (stack.length) throw new Error('unclosed { in sheet.css');
  return out.sort((a, b) => a.order - b.order);
}

const RULES = parse(CSS);

/** Does this rule apply on a phone? Everything except the desktop-width blocks and `@supports not`. */
function onPhone(r: Rule): boolean {
  return r.at.every((a) => !/min-width/.test(a) && !/^@supports\s+not/.test(a) && !/\bprint\b/.test(a));
}

/** Approximate specificity: ids × 100 + classes/attributes/pseudo-classes (`:not()` counts its argument,
 *  which is what a browser does too). Element names are ignored — nothing in these rules turns on one. */
function spec(sel: string): number {
  const ids = (sel.match(/#[\w-]+/g) ?? []).length;
  const cls = (sel.match(/\.[\w-]+|\[[^\]]*\]|:(?!not\b|is\b|where\b|:)[\w-]+/g) ?? []).length;
  return ids * 100 + cls;
}

type Decl = { prop: string; value: string; important: boolean };

function decls(body: string): Decl[] {
  const out: Decl[] = [];
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    let value = part.slice(i + 1).trim();
    const important = /!important$/i.test(value);
    if (important) value = value.replace(/!important$/i, '').trim();
    out.push({ prop: part.slice(0, i).trim().toLowerCase(), value, important });
  }
  return out;
}

/** The value a browser would use for `prop` on a phone, for an element carrying `classes`.
 *  `skipSupports` answers the other question: what a webview WITHOUT `dvh` support falls back to. */
function winner(classes: string, prop: string, skipSupports = false, rules = RULES): Decl | undefined {
  const el = document.createElement('div');
  el.className = classes;
  let best: (Decl & { spec: number }) | undefined;
  for (const r of rules) {
    if (!onPhone(r)) continue;
    if (skipSupports && r.at.some((a) => a.startsWith('@supports'))) continue;
    for (const sel of r.sels) {
      let hit = false;
      try {
        hit = el.matches(sel);
      } catch {
        continue; // a selector this jsdom cannot parse — never one of ours
      }
      if (!hit) continue;
      const s = spec(sel);
      for (const d of decls(r.body)) {
        if (d.prop !== prop) continue;
        // important beats not-important; then higher specificity; then — the trap this whole file
        // exists for — the LATER declaration, which is why `>=` and why the rules are in document order.
        const beats = !best || (d.important !== best.important ? d.important : s >= best.spec);
        if (beats) best = { ...d, spec: s };
      }
    }
  }
  return best;
}

const value = (classes: string, prop: string, skipSupports = false) => winner(classes, prop, skipSupports)?.value;

/** Everything on a phone that fills the screen, with the property that carries its size. Each one sized
 *  to the large viewport is one more thing running under the browser's chrome on the website — the tab
 *  row, a popup's dismiss strip, Settings, the last row of a builder level page.
 *  The pinned ones (`position: fixed; inset: 0`) are sized by `height`; the two that scroll the DOCUMENT
 *  instead are sized by `min-height`, and a fixed height there would clamp a list that grows. */
const SURFACES: [classes: string, prop: string][] = [
  ['ws-app', 'height'], // the sheet shell: it carries the bottom tab row (.mtabs)
  ['builder', 'height'], // the builder shell: .builder-body is the only scroller inside it
  ['picker-overlay', 'height'], // the dim backdrop behind every popup
  ['drawer-overlay', 'height'],
  ['cust-drawer-wrap', 'height'], // the Customize drawer, full-width on a phone
  ['portrait-lightbox', 'height'],
  ['portrait-lightbox-img', 'max-height'], // capped against the box it is centred in, or it overflows it
  ['settings-page-m', 'height'],
  ['picker fsel', 'height'], // the full-screen feat/spell browser
  ['picker ref-search', 'height'],
  ['picker item-edit', 'height'],
  ['picker cond-modal', 'height'],
  ['dice-drawer', 'height'],
  ['hb-page', 'height'],
  ['roster-screen', 'min-height'], // the character list — the first screen on the phone website
  ['login-screen', 'min-height'],
];

/** Full-screen rules this list does NOT cover, and why. Anything else the file grows gets caught by the
 *  completeness test below — a hand-written list is what let the builder slip through the first one. */
const EXCUSED: Record<string, string> = {
  '.menu-backdrop': 'a transparent tap-catcher; running past the visible edge still dismisses the menu',
  '.app-loading': 'the boot splash — centred text, nothing to scroll, gone in under a second',
  '.subpage': 'only ever rendered as `ws-app subpage` (SettingsPage.tsx), so .ws-app already sizes it',
  '.notes-wrap': 'the phone block resets it to min-height: 0; the sheet body is the scroller there',
  // The vh-widened check (any number, not just 100vh) below surfaces several scroll boxes that live
  // INSIDE an already dvh-capped `.picker`/`.cond-modal` — that ancestor's `overflow: hidden` (see
  // `.picker` in sheet.css) clips them regardless of their own cap, and testing the bare class alone
  // (this resolver's one blind spot: it can't simulate two classes worn by the same real element)
  // can't see the ancestor at all. Real co-occurring classes checked by hand against sheet.css/the TSX.
  '.import-report': 'only rendered as `confirm-body import-report` inside `.picker confirm-modal` (RosterScreen.tsx)',
  '.src-losing': 'only rendered inside a confirmDialog message inside `.picker confirm-modal` (builder/shared.tsx)',
  '.alchemy-pick-list': 'only rendered inside `.picker alchemy-picker` (AlchemyPanel.tsx)',
  '.ref-search-list': 'only rendered inside `.picker ref-search`, itself in the @supports pinned list above',
  '.modes-panel': '`.cond-modal .modes-panel` (sheet.css) resets it to max-height: none; ConditionsModal.tsx is its only mount, inside `.picker cond-modal`, itself pinned above',
  '.mode-editor': 'ModesPanel’s only mount is ConditionsModal.tsx, inside `.picker cond-modal`, itself pinned above',
  '.error-boundary': 'not position: fixed — an ordinary in-flow crash card; min-height only centres it, the page scrolls',
  '.item-edit': 'only rendered as `picker item-edit` (ItemEditorModal.tsx) — that combo is `.picker.item-edit` above, `max-height: none !important`',
  '.hb-editor': 'only rendered as `picker hb-editor` (HomebrewPage.tsx); the phone-only `.picker:not(.hp-numpad):not(.settings-page-m)` bottom-sheet rule (sheet.css) already caps it to max-height: 90dvh',
  '.stat-detail': 'only rendered as `picker stat-detail` (StatDetailModal.tsx); same `.picker:not(.hp-numpad):not(.settings-page-m)` bottom-sheet rule already caps it to max-height: 90dvh',
  '.picker.settings-modal': 'on a phone the component also adds `.settings-page-m` (KingmakerRules/MonsterPartsRules/MythicRules), itself pinned above with `!important`',
};

describe('phone website: the visible height', () => {
  it('the instrument reports the two ways this fix goes inert', () => {
    // A self-check on the resolver above, because the FIRST version of this fix shipped green and did
    // nothing: a guard that only greps for the rule cannot see either of these. Both stylesheets below
    // contain a correct-looking dvh rule and both do nothing in a browser.
    const clamped = parse('.ws-app { min-height: 100vh } .ws-app { height: 100dvh !important }');
    expect(winner('ws-app', 'min-height', false, clamped)?.value).toBe('100vh'); // min-height wins

    const outranked = parse('.p.fsel { height: 100dvh !important } .p.fsel { height: auto !important }');
    expect(winner('p fsel', 'height', false, outranked)?.value).toBe('auto'); // the LATER !important wins
  });

  it.each(SURFACES)('%s resolves its %s to a dvh value, not the large viewport', (classes, prop) => {
    const h = value(classes, prop);
    expect(h, `${classes} has no winning ${prop}`).toBeTruthy();
    expect(h, `${classes} ${prop} resolves to ${h}`).toContain('dvh');
  });

  it('every full-screen rule in the file is sized in dvh or excused by name', () => {
    // Derived from the stylesheet, not hand-written: the list above was hand-written and the builder —
    // `position: fixed; inset: 0`, same as .ws-app — sat outside it while this file passed.
    // Per-selector, not just a set: a rule that is only `max-height: 92vh` needs its dvh companion
    // checked on `max-height` too — checking only height/min-height is exactly how `.portrait-lightbox-img`
    // (already fixed, see the @supports block) slipped through and had to be caught by hand.
    const candidates = new Map<string, Set<string>>();
    for (const r of RULES) {
      if (!onPhone(r)) continue;
      const d = decls(r.body);
      const pinned =
        d.some((x) => x.prop === 'position' && x.value === 'fixed') &&
        d.some((x) => x.prop === 'inset' && x.value === '0');
      // Any of height / min-height / max-height carrying a <number>vh (not just the literal 100vh, and
      // not `dvh`/`svh` — the digit has to sit directly against `vh`) resolves against the large viewport.
      const vhProps = d
        .filter((x) => /^(min-|max-)?height$/.test(x.prop) && /\d(\.\d+)?vh\b/.test(x.value))
        .map((x) => x.prop);
      if (!pinned && vhProps.length === 0) continue;
      for (const sel of r.sels) {
        const props = candidates.get(sel) ?? new Set<string>();
        if (pinned) {
          props.add('height');
          props.add('min-height');
        }
        for (const p of vhProps) props.add(p);
        candidates.set(sel, props);
      }
    }
    const missed = [...candidates.keys()].filter((sel) => {
      if (EXCUSED[sel]) return false;
      // Descendant rules are scoped inside a parent that is itself on this list; one div wearing every
      // class in the selector would not be the element they describe.
      if (/[ >+~]/.test(sel.replace(/:not\([^)]*\)/g, ''))) return false;
      const classes = (sel.match(/\.[\w-]+/g) ?? []).map((c) => c.slice(1)).join(' ');
      if (!classes) return false;
      return ![...candidates.get(sel)!].some((p) => value(classes, p)?.includes('dvh'));
    });
    expect(missed, 'full-screen on a phone, still sized to the large viewport').toEqual([]);
  });

  it.each(['ws-app', 'builder', 'hb-page', 'notes-wrap', 'notes-empty', 'roster-screen', 'login-screen'])(
    '%s is not clamped back by a min-height in vh',
    (classes) => {
      // min-height beats height, !important or not. This is what made the first version of the fix inert.
      const mh = value(classes, 'min-height');
      expect(mh ?? '0', `${classes} min-height resolves to ${mh}`).not.toContain('100vh');
    },
  );

  it('leaves the embedded rules pages in the flow', () => {
    // Homebrew renders the Monster Parts / Mythic / Kingmaker rules INSIDE the page, reusing
    // .picker-overlay as a static section. Sizing that to the viewport turns a page section into a
    // nested scroll box that stops where the screen does.
    expect(value('picker-overlay mpr-embedded', 'position')).toBe('static');
    const h = value('picker-overlay mpr-embedded', 'height');
    expect(h ?? 'auto', `embedded rules page height resolves to ${h}`).not.toContain('dvh');
  });

  it('keeps the fixed-inset base so a webview without dvh is unchanged', () => {
    // The dvh height is an enhancement layered ON the existing rule, never a replacement.
    expect(value('ws-app', 'position', true)).toBe('fixed');
    expect(value('ws-app', 'inset', true)).toBe('0');
  });
});

describe('phone website: popup controls', () => {
  it('gives the popup X a 40px touch target', () => {
    expect(value('picker-close', 'min-width')).toBe('40px');
    expect(value('picker-close', 'min-height')).toBe('40px');
  });

  it('marks the backdrop clickable for touch browsers', () => {
    // iOS Safari only synthesises a click for an element it treats as interactive, and React's
    // handlers live on the root container rather than on the backdrop div.
    const coarse = RULES.filter((r) => r.at.some((a) => a.includes('pointer: coarse')));
    const cursor = coarse.flatMap((r) => (r.sels.includes('.picker-overlay') ? decls(r.body) : []));
    expect(cursor.find((d) => d.prop === 'cursor')?.value).toBe('pointer');
  });
});

/** Press on `down`, lift on `up` — the order a touch screen sends: pointer first, then the
 *  compatibility mouse events, all hit-tested where the finger LIFTED. */
function tap(down: Element, up: Element): void {
  act(() => {
    down.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    up.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    up.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    up.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('OverlayDismissGuard', () => {
  // The guard chooses its listener at mount; jsdom doesn't always expose the pointer handlers, so say
  // what every browser we ship to says.
  if (!('onpointerdown' in window)) (window as unknown as Record<string, unknown>).onpointerdown = null;

  function harness(onClose: () => void) {
    return renderDom(
      <>
        <OverlayDismissGuard />
        <div className="picker-overlay" onClick={onClose}>
          <div className="picker">
            <button className="picker-close" onClick={onClose}>
              close
            </button>
            <p className="info-body">description text</p>
          </div>
        </div>
      </>,
    );
  }

  it('dismisses on a press that starts and ends on the backdrop', () => {
    const onClose = vi.fn();
    const { host, stop } = harness(onClose);
    const overlay = host.querySelector('.picker-overlay')!;
    tap(overlay, overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ignores a press that starts on the popup and lifts on the backdrop', () => {
    const onClose = vi.fn();
    const { host, stop } = harness(onClose);
    const overlay = host.querySelector('.picker-overlay')!;
    tap(host.querySelector('.info-body')!, overlay);
    expect(onClose).not.toHaveBeenCalled();
    stop();
  });

  it('still closes on the X', () => {
    const onClose = vi.fn();
    const { host, stop } = harness(onClose);
    const x = host.querySelector('.picker-close')!;
    tap(x, x);
    expect(onClose).toHaveBeenCalled();
    stop();
  });

  it('does not swallow the NEXT press once the finger is back on the backdrop', () => {
    // The flag is per-press: one drag out of the popup must not leave the backdrop dead afterwards
    // (that would read as "tapping outside does nothing", which is where this started).
    const onClose = vi.fn();
    const { host, stop } = harness(onClose);
    const overlay = host.querySelector('.picker-overlay')!;
    tap(host.querySelector('.info-body')!, overlay);
    tap(overlay, overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
    stop();
  });
});
