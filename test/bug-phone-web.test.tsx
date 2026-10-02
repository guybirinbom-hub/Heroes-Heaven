// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OverlayDismissGuard } from '../src/sheet/OverlayDismissGuard';
import { CustomizeModal } from '../src/sheet/CustomizeModal';
import { NotesTab } from '../src/sheet/NotesTab';
import type { Character } from '../src/rules/types';
import { ForceMobileContext, useIsMobile } from '../src/sheet/useIsMobile';
import { CharacterSheet } from '../src/sheet/CharacterSheet';
import { renderDom } from './_render';
import { build, content } from './_content';

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
 *    press began inside the backdrop — asserted here with the event sequence a touch screen really
 *    sends, on the REAL markup of each surface. WHICH elements that covers is a measurement (a
 *    positioned layer with four zero insets), not a list of class names: the list version was refuted
 *    three times running — the tracker's Customize drawer, then both portrait lightboxes, then the
 *    tracker's twelve `.modal-overlay` mounts and a GlobalSearch backdrop with no className at all —
 *    and every check in this file was blind to them in the same way, because it asked about names too.
 * 3. `useIsMobile` and the `max-width: 720px` block in sheet.css answer the same question and MUST
 *    agree; when they don't, the phone gets the desktop markup laid out by the phone rules — the sheet
 *    rail and both notes cards on a 375px screen, no bottom tab row. That state was seen once on
 *    2026-09-23, in an emulated browser tab and only after a scripted resize — never on a fresh load at
 *    375x812, and rewriting the hook did not stop it happening in that tab. So the instrument is the
 *    suspect, not the hook, and the hook is unchanged. Pinned below is only what holds either way: the
 *    subscription is live, and a ForceMobileContext still wins. And one surface no longer has two
 *    mechanisms that could disagree: the header XP field (`.identity .level-stack`) is shown or not by
 *    CharacterSheet's useIsMobile answer alone, the same answer that puts XP in the rail on a phone, so
 *    the 720px block does not hide it any more — in that disagreeing state the CSS hide could only take
 *    the last XP off the screen ("the header XP field is the JS gate's alone", below).
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
function winner(classes: string | Element, prop: string, skipSupports = false, rules = RULES): Decl | undefined {
  // A string is one bare element wearing those classes; an Element is a node already in a rendered
  // tree, so a descendant selector (`.body-notes .notes-wrap`) matches it the way it does in the app.
  const el = typeof classes === 'string' ? Object.assign(document.createElement('div'), { className: classes }) : classes;
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

const value = (classes: string | Element, prop: string, skipSupports = false) => winner(classes, prop, skipSupports)?.value;

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

/** The only thing OverlayDismissGuard looks at: a layer over its whole containing block. `fixed` for
 *  the ones that dim the screen, `absolute` for `.tc-overlay`, which dims the tracker PANE it lives in
 *  — the reason the guard measures "covers its containing block" rather than "position: fixed". */
const coversBlock = (d: { position: string; inset: string } | null): boolean =>
  !!d && (d.position === 'fixed' || d.position === 'absolute') && d.inset === '0';

/**
 * `position` + `inset` as ONE stylesheet declares them for one selector.
 *
 * The cascade resolver above reads builder.css + sheet.css, and it stays that way — adding files to it
 * would change what the dvh completeness test scans. The two stylesheets below render into the SAME
 * document as the guard but are not in it: `src/integration/campaign-tracker.css` (the palette drawer)
 * and `tracker/src/index.css` (twelve `.modal-overlay` mounts across eleven tracker files). Tailwind's
 * `@apply fixed inset-0` is that same declaration spelled as utilities, so it is translated here
 * rather than excused — a test that could not read it is how those twelve were called "clean".
 */
function declaredLayer(file: string, selector: string): { position: string; inset: string } | null {
  const css = readFileSync(path.join(__dirname, '..', ...file.split('/')), 'utf8');
  for (const r of parse(css)) {
    if (!r.sels.includes(selector)) continue;
    const d = decls(r.body);
    const apply = /@apply([^;]*)/.exec(r.body)?.[1] ?? '';
    const position = d.find((x) => x.prop === 'position')?.value ?? (/\bfixed\b/.test(apply) ? 'fixed' : '');
    const inset = d.find((x) => x.prop === 'inset')?.value ?? (/\binset-0\b/.test(apply) ? '0' : '');
    if (position && inset) return { position, inset };
  }
  return null;
}

/** The same two properties for a class the cascade resolver above DOES read. */
function sheetLayer(cls: string): { position: string; inset: string } | null {
  const position = value(cls, 'position', true);
  const inset = value(cls, 'inset', true);
  return position && inset ? { position, inset } : null;
}

/** Put the app's OWN declaration for these selectors into the test document, and hand back the undo.
 *  jsdom has no bundler and no Tailwind, so the guard would otherwise measure `position: static` on
 *  every element here and arm on nothing. The values are LOOKED UP, never typed: a `.portrait-lightbox`
 *  that stopped being `position: fixed; inset: 0` would stop arming the guard in the app, and these
 *  tests go red for exactly that reason instead of passing against a fixture that says what we wish. */
function withCss(rules: Record<string, { position: string; inset: string } | null>): () => void {
  const style = document.createElement('style');
  style.textContent = Object.entries(rules)
    .map(([sel, d]) => {
      if (!d) throw new Error(`no stylesheet declares ${sel} a layer over its containing block`);
      return `${sel}{position:${d.position};inset:${d.inset}}`;
    })
    .join('\n');
  document.head.appendChild(style);
  return () => style.remove();
}

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

  it('declares every backdrop a full-screen layer — which is what arms the guard', () => {
    // THIS IS NOT A STYLE PREFERENCE ANY MORE. OverlayDismissGuard used to carry two lists of class
    // names, and every review found another surface in neither of them: the tracker's Customize
    // drawer, then both `.portrait-lightbox` mounts, then the tracker's own `.modal-overlay` (twelve
    // sites, eleven files, all rendered into THIS document), then a GlobalSearch backdrop with no
    // className at all — unreachable by any name-keyed check, including the one that used to sit here
    // and reported 0. So the guard now measures `position: fixed` + four zero insets off the live
    // element, and THIS is the check that the app keeps saying it: a backdrop that stopped declaring
    // it would go on dimming the screen and quietly stop being guarded.
    //
    // WHAT IT DOES AND DOES NOT SAY. It resolves the cascade and asserts the DECLARATION. That is not
    // the same as "covers the screen": `position: fixed` resolves against the nearest TRANSFORMED
    // ancestor, not the viewport, so a nested backdrop inside an outer popup still running its open
    // animation (`transform: matrix(.985,0,0,.985,0,8)`) measured 14.5,223.8 346.5x799.8 in the live
    // app on 2026-09-23 — a real backdrop, nowhere near the viewport box. The declaration is what both
    // the dimming and the guard rest on, and it is what is pinned.
    for (const cls of ['picker-overlay', 'drawer-overlay', 'portrait-lightbox']) {
      expect(value(cls, 'position', true), cls).toBe('fixed');
      expect(value(cls, 'inset', true), cls).toBe('0');
    }
    // Two stylesheets the resolver above does not read, both rendering into this same document.
    // `.tc-overlay` is `absolute` — it dims the tracker pane, not the screen — and a guard that only
    // knew `fixed` would quietly stop covering the drawer a previous pass had just fixed by name.
    const tc = declaredLayer('src/integration/campaign-tracker.css', '.tc-overlay');
    expect(coversBlock(tc), `.tc-overlay is ${JSON.stringify(tc)}`).toBe(true);
    const modal = declaredLayer('tracker/src/index.css', '.modal-overlay');
    expect(coversBlock(modal), `.modal-overlay is ${JSON.stringify(modal)}`).toBe(true);
    // The one with no name to check. `tracker/src/components/GlobalSearch.tsx` inline-styles its
    // backdrop and dismisses on `e.target === e.currentTarget`; it is rendered four lines from the
    // Customize drawer (src/integration/CampaignTracker.tsx), in this document, and every instrument
    // this file has ever had was blind to it. The guard reads the same property off the computed
    // style, inline or not — this asserts the property is there to read.
    const globalSearch = readFileSync(
      path.join(__dirname, '..', 'tracker', 'src', 'components', 'GlobalSearch.tsx'), 'utf8');
    expect(globalSearch, 'GlobalSearch’s backdrop is the unnamed one').toContain("position: 'fixed', inset: 0");
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

  // The guard measures the element it is about to swallow a click on, so the app's real declarations
  // have to be IN this document. Four stylesheets' worth of one property, and not one of them typed
  // out here: what the app says is what the guard gets.
  let removeCss = () => {};
  beforeAll(() => {
    removeCss = withCss({
      '.picker-overlay': sheetLayer('picker-overlay'),
      '.portrait-lightbox': sheetLayer('portrait-lightbox'),
      '.cust-drawer-wrap': sheetLayer('cust-drawer-wrap'),
      '.cust-drawer-backdrop': sheetLayer('cust-drawer-backdrop'),
      '.tc-overlay': declaredLayer('src/integration/campaign-tracker.css', '.tc-overlay'),
      '.modal-overlay': declaredLayer('tracker/src/index.css', '.modal-overlay'),
    });
  });
  afterAll(() => removeCss());

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

  /** A `.ref-link` inside a description opens its own popup INSIDE the outer one's body — measured in
   *  the live app: `outer.contains(inner) === true`. Both onClose handlers are live at once.
   *
   *  THE `stopPropagation` ON EACH `.picker` IS NOT DECORATION — it is what every real popup does
   *  (DescriptionModal.tsx, FilterableSelect.tsx), and it is what makes a click inside the inner popup
   *  stop before the outer backdrop's onClose. Without it both handlers fire for any click anywhere
   *  inside, and the strip test below could only assert that the inner popup closed — never the half a
   *  reader assumes it pins, that the outer one SURVIVES. */
  function nested(onOuter: () => void, onInner: () => void) {
    return renderDom(
      <>
        <OverlayDismissGuard />
        <div className="picker-overlay" onClick={onOuter}>
          <div className="picker spell-detail" onClick={(e) => e.stopPropagation()}>
            <div className="sd-body">
              <p className="info-body">outer text</p>
              <div className="picker-overlay inner" onClick={onInner}>
                <div className="picker" onClick={(e) => e.stopPropagation()}>
                  <p className="info-body inner-text">trait text</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </>,
    );
  }

  it('ignores a press that starts on a NESTED popup and lifts on its own backdrop', () => {
    // The old test was `closest(BACKDROP) && !closest(POPUP)`, and from the inner backdrop
    // `closest('.picker')` finds the OUTER popup — so the guard was a no-op for every nested popup and
    // this gesture closed BOTH (measured live, ov 2 -> 0). Which layer an event is on is the NEAREST
    // match, not "backdrop and not popup".
    const outer = vi.fn();
    const inner = vi.fn();
    const { host, stop } = nested(outer, inner);
    expect(host.querySelector('.picker-overlay')!.contains(host.querySelector('.picker-overlay.inner')),
      'fixture: the nested overlay really is inside the outer popup').toBe(true);
    tap(host.querySelector('.inner-text')!, host.querySelector('.picker-overlay.inner')!);
    expect(inner).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    stop();
  });

  it('still dismisses the nested popup ONLY, on a tap on its own 11px strip', () => {
    // The other half: reading the nearest layer must not turn the inner backdrop into "popup" and
    // leave the nested popup with no way out but its X — and dismissing it must not take the outer
    // popup with it, which is the same "closed two things" complaint from the other direction.
    const outer = vi.fn();
    const inner = vi.fn();
    const { host, stop } = nested(outer, inner);
    const strip = host.querySelector('.picker-overlay.inner')!;
    tap(strip, strip);
    expect(inner, 'the nested popup must still have a way out').toHaveBeenCalledTimes(1);
    expect(outer, 'closing the trait popup must leave the spell behind it open').not.toHaveBeenCalled();
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

  it('forgets a press that ended without a click, so the next bare click still dismisses', () => {
    // A press does not always produce a click. The finger drags out of the window; the browser takes
    // the touch over as a scroll or a gesture and sends `pointercancel`; the popup unmounts under the
    // finger; the tab goes to the background. The pressed element used to stay recorded through all of
    // that, and the next PRESS-LESS click — keyboard activation, anything synthetic — was matched
    // against the stale one and swallowed whenever it landed on a layer containing it. Refuted on the
    // nested popup on 2026-09-23: pointerdown on the trait text, no click, then a bare click on the
    // trait popup's own strip, and the strip was dead.
    //
    // A FRESH PRESS IS NOT IN THIS LIST because it needs nothing — `onDown` overwrites the record — so
    // what is pinned here is only the endings that produce no click of their own to clear it. Each one
    // is a separate listener in the guard, and each was dropped on its own against this file: one red
    // per mutant, and the message names the ending that stopped working.
    for (const ending of ['pointercancel', 'blur', 'visibilitychange'] as const) {
      const outer = vi.fn();
      const inner = vi.fn();
      const { host, stop } = nested(outer, inner);
      const text = host.querySelector('.inner-text')!;
      const strip = host.querySelector('.picker-overlay.inner')!;
      act(() => {
        text.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        if (ending === 'pointercancel') text.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
        else if (ending === 'blur') window.dispatchEvent(new Event('blur'));
        else document.dispatchEvent(new Event('visibilitychange'));
        strip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(inner, `a press ended by ${ending} left the strip dead`).toHaveBeenCalledTimes(1);
      expect(outer, 'and it must not take the popup behind it').not.toHaveBeenCalled();
      stop();
    }
  });

  it('the sheet’s Customize drawer survives the same gesture — by its own shape, not by the guard', () => {
    // THE ONE ARRANGEMENT THE GUARD'S CEILING NAMES, rendered from the real component rather than
    // described: `.cust-drawer-wrap` (fixed, inset 0) holds the dismissing `.cust-drawer-backdrop` as a
    // SIBLING of the `.cust-drawer` panel, not as its parent. The browser reports a cross-edge click on
    // the common ancestor, which here is the WRAP — and the wrap carries no handler — so this drawer
    // cannot be dismissed by that gesture whether the guard arms or not. That is the half the ceiling
    // paragraph got wrong twice: first by claiming nothing renders the shape, then by reading the shape
    // as a hole. Both halves are asserted, because only the pair says anything: an immunity that also
    // ate the plain tap would just be a drawer with no way out but its X.
    const onClose = vi.fn();
    const character = { name: 'Fixture', customization: undefined } as unknown as Character;
    const { host, stop } = renderDom(
      <>
        <OverlayDismissGuard />
        <CustomizeModal character={character} globalDefault={{}} onCustomize={() => {}} onClose={onClose} />
      </>,
    );
    const wrap = host.querySelector('.cust-drawer-wrap')!;
    const backdrop = host.querySelector('.cust-drawer-backdrop')!;
    const panel = host.querySelector('.cust-drawer')!;
    expect(
      wrap.contains(backdrop) && wrap.contains(panel) && !backdrop.contains(panel),
      'fixture: the dismissing backdrop must be the panel’s SIBLING — that IS what this pins',
    ).toBe(true);
    tap(host.querySelector('.cust-drawer-title')!, wrap);
    expect(onClose, 'dragging the drawer’s title onto the strip closed it').not.toHaveBeenCalled();
    tap(backdrop, backdrop);
    expect(onClose, 'a tap on the strip must still close the drawer').toHaveBeenCalledTimes(1);
    stop();
  });

  it('leaves an ordinary control alone — press the label, lift on the padding, it still clicks', () => {
    // THE DISCRIMINATOR, and the reason the guard measures anything at all. "A click reported on an
    // ancestor of the press" also describes every finger that presses a button's TEXT and lifts on the
    // button's own padding. Swallowing that would break every control in both apps, so the
    // full-screen-layer measurement is not decoration — it is the entire difference between the two
    // gestures. Drop it (swallow on `contains` alone) and this goes red first.
    const onClick = vi.fn();
    const { host, stop } = renderDom(
      <>
        <OverlayDismissGuard />
        <button className="btn" onClick={onClick}>
          <span className="btn-label">Go</span>
        </button>
      </>,
    );
    tap(host.querySelector('.btn-label')!, host.querySelector('.btn')!);
    expect(onClick, 'a button is not a backdrop — its click must survive the same gesture').toHaveBeenCalledTimes(1);
    stop();
  });

  /** Both portrait lightboxes, exactly as they are written (src/sheet/CharacterImages.tsx and
   *  src/sheet/CharacterSheet.tsx): the dismissing div WRAPS the picture, `position: fixed; inset: 0`,
   *  and on a phone the picture is capped to 92dvh — so there is dim area all round it. Dragging a
   *  picture is the most natural gesture there is, and this was the one surface where doing it closed
   *  the thing you were looking at. Neither class was in the guard's old lists; nothing in this file
   *  could see that, because it asked about names. */
  function lightbox(onClose: () => void) {
    return renderDom(
      <>
        <OverlayDismissGuard />
        <div className="portrait-lightbox" onClick={onClose} role="dialog" aria-label="Portrait">
          <img src="" alt="" className="portrait-lightbox-img" />
          <button className="portrait-lightbox-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>
      </>,
    );
  }

  it('keeps the portrait lightbox open when the picture is dragged off its edge', () => {
    const onClose = vi.fn();
    const { host, stop } = lightbox(onClose);
    tap(host.querySelector('.portrait-lightbox-img')!, host.querySelector('.portrait-lightbox')!);
    expect(onClose, 'dragging the picture closed the lightbox').not.toHaveBeenCalled();
    stop();
  });

  it('still closes the portrait lightbox on a tap beside the picture', () => {
    const onClose = vi.fn();
    const { host, stop } = lightbox(onClose);
    const box = host.querySelector('.portrait-lightbox')!;
    tap(box, box);
    expect(onClose).toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps a tracker modal open when its box is dragged off the edge', () => {
    // Twelve `.modal-overlay` mounts across eleven files under tracker/src/components, every one of
    // them rendered INTO THIS DOCUMENT from src/integration/CampaignTracker.tsx. Their own dismiss
    // test is `e.target === e.currentTarget`, which is NOT a defence against this gesture: the browser
    // reports the cross-edge click on the common ancestor, and the common ancestor IS the overlay — so
    // the test passes and the modal closes. Written here the way they all write it.
    const onClose = vi.fn();
    const { host, stop } = renderDom(
      <>
        <OverlayDismissGuard />
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="modal-box">
            <p className="modal-text">creature stats</p>
          </div>
        </div>
      </>,
    );
    const overlay = host.querySelector('.modal-overlay')!;
    tap(host.querySelector('.modal-text')!, overlay);
    expect(onClose, 'e.target === e.currentTarget is true on the cross-edge click too').not.toHaveBeenCalled();
    tap(overlay, overlay);
    expect(onClose, 'and a tap on the dim area must still close it').toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps the tracker’s Customize drawer open when its panel is dragged onto the dim strip', () => {
    // src/integration/TrackerCustomize.tsx, and the one backdrop in either app that is `absolute`
    // rather than `fixed` (it dims the tracker pane it sits in). A guard keyed on `position: fixed`
    // passes every other test in this file and leaves exactly this drawer broken.
    const onClose = vi.fn();
    const { host, stop } = renderDom(
      <>
        <OverlayDismissGuard />
        <div className="tc-overlay" onClick={onClose}>
          <div className="tc-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Customize">
            <p className="tc-note">accent colour</p>
          </div>
        </div>
      </>,
    );
    const overlay = host.querySelector('.tc-overlay')!;
    tap(host.querySelector('.tc-note')!, overlay);
    expect(onClose, 'dragging the panel’s text onto the dim strip closed the drawer').not.toHaveBeenCalled();
    tap(overlay, overlay);
    expect(onClose, 'and a tap on the strip must still close it').toHaveBeenCalledTimes(1);
    stop();
  });

  it('guards a backdrop with no className at all', () => {
    // tracker/src/components/GlobalSearch.tsx: an inline-styled `position: fixed; inset: 0` wrapper
    // with a dismiss handler and no class token anywhere. No name-keyed instrument could ever have
    // found it — the guard reads the property off the computed style, which an inline style sets just
    // as well as a stylesheet does.
    const onClose = vi.fn();
    const { host, stop } = renderDom(
      <>
        <OverlayDismissGuard />
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 9500, display: 'flex', paddingTop: '12vh' }}
        >
          <div className="gs-box">
            <p className="gs-row">Fireball</p>
          </div>
        </div>
      </>,
    );
    const backdrop = host.firstElementChild!;
    expect(backdrop.className, 'fixture: the shape under test really has no class').toBe('');
    tap(host.querySelector('.gs-row')!, backdrop);
    expect(onClose).not.toHaveBeenCalled();
    tap(backdrop, backdrop);
    expect(onClose, 'and it must still dismiss on a tap outside the box').toHaveBeenCalledTimes(1);
    stop();
  });
});

/** A media query that answers honestly and NEVER dispatches `change` — so a test using it says nothing
 *  about event delivery, only about what holds without any event at all. */
function silentMatchMedia(state: { phone: boolean }) {
  const real = window.matchMedia;
  window.matchMedia = ((media: string) => ({
    get matches() {
      return state.phone;
    },
    media,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = real;
  };
}

describe('useIsMobile', () => {
  /** Prints what the hook says, and nothing else. */
  function Probe() {
    const isMobile = useIsMobile();
    return <span>{isMobile ? 'phone' : 'desktop'}</span>;
  }

  it('follows a change event when one arrives', () => {
    const state = { phone: false };
    const listeners = new Set<() => void>();
    const real = window.matchMedia;
    window.matchMedia = ((media: string) => ({
      get matches() {
        return state.phone;
      },
      media,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const { host, stop } = renderDom(<Probe />);
    expect(host.textContent).toBe('desktop');
    act(() => {
      state.phone = true;
      listeners.forEach((fn) => fn());
    });
    expect(host.textContent, 'the subscription is live — a crossed breakpoint reaches the layout').toBe('phone');
    stop();
    window.matchMedia = real;
  });

  it('a ForceMobileContext above still wins', () => {
    // The tracker renders the sheet in a narrow PC pane and forces the phone shape there; the viewport
    // read must not take that decision back.
    const state = { phone: false };
    const restore = silentMatchMedia(state);
    const { host, stop } = renderDom(
      <ForceMobileContext.Provider value={true}>
        <Probe />
      </ForceMobileContext.Provider>,
    );
    expect(host.textContent).toBe('phone');
    stop();
    restore();
  });
});

/**
 * The header XP field is the JS gate's alone (owner's list, item 9, second settle).
 *
 * CharacterSheet renders `.identity .level-stack` — XP, top right — only when its useIsMobile answer is
 * "computer", and hands that same answer to the vitals rail, which carries the phone layout's XP. One
 * value decides both, so the sheet never shows XP twice (test/bug-xp-in-rail.test.tsx). The 720px block
 * used to hide `.identity .level-stack` as well. With the JS gate in place that rule could only ever act
 * in the state (3) above records — useIsMobile saying "computer", so the rail carries no XP, while the
 * phone rules apply — and there it hid the one XP left. So it is gone, and this pins that on the REAL
 * header markup: render the sheet the way JS lays out a computer, resolve the PHONE cascade over it, and
 * nothing from the shell down to the XP number may resolve `display: none`. The tab strip beside it is
 * still the CSS's to hide: on a phone the bottom bar replaces it.
 *
 * MUTATION PROOF (applied once, seen red, restored): putting `.identity .level-stack` back into
 * sheet.css's `@media (max-width: 720px)` rule beside `.identity .tabs` fails the first leg below.
 */
describe("phone website: the header XP field is the JS gate's alone (item 9)", () => {
  /** The real sheet, laid out by JS as a computer (ForceMobileContext false). A synthetic level-5 fighter. */
  function computerSheet(readOnly: boolean) {
    const character = { ...build('fighter', 5), xp: 340 } as Character;
    return renderDom(
      <ForceMobileContext.Provider value={false}>
        <CharacterSheet
          character={character}
          content={content()}
          charKey="phone-web-xp"
          readOnly={readOnly}
          onPlay={readOnly ? undefined : () => undefined}
        />
      </ForceMobileContext.Provider>,
    );
  }

  it('no phone rule hides the header XP field, or anything between the shell and its number', () => {
    for (const readOnly of [false, true]) {
      const { host, stop } = computerSheet(readOnly);
      const stack = host.querySelector('.identity .level-stack');
      expect(stack, `fixture (${readOnly ? 'read-only' : 'play'}): JS renders the header XP field`).toBeTruthy();
      const xp = stack!.querySelector(readOnly ? 'span.xp' : 'input.xp-input');
      expect(xp, 'fixture: and the XP number in it').toBeTruthy();
      const chain: Element[] = [];
      for (let el: Element | null = xp; el && el !== host; el = el.parentElement) chain.push(el);
      expect(chain, 'fixture: the chain runs through the header field').toContain(stack);
      const hidden = chain.filter((el) => value(el, 'display') === 'none').map((el) => el.className || el.tagName);
      expect(hidden, `${readOnly ? 'read-only' : 'play'}: hidden on a phone, so a JS/CSS disagreement shows no XP`).toEqual([]);
      stop();
    }
  });

  it('…while the tab strip beside it is still hidden on a phone', () => {
    const { host, stop } = computerSheet(false);
    const tabs = host.querySelector('.identity .tabs');
    expect(tabs, 'fixture: JS renders the computer tab strip').toBeTruthy();
    expect(value(tabs!, 'display'), 'the bottom bar replaces it on a phone').toBe('none');
    stop();
  });

  it('the instrument sees the rule this replaced', () => {
    // A guard that cannot see a descendant selector inside the 720px block would pass with the old rule
    // back in place; this is the old rule, verbatim, on a synthetic header.
    const old = parse(
      '.level-stack { display: flex; } @media (max-width: 720px) { .identity .tabs,\n  .identity .level-stack { display: none; } }',
    );
    const identity = document.createElement('div');
    identity.className = 'identity';
    const stack = document.createElement('div');
    stack.className = 'level-stack';
    identity.appendChild(stack);
    expect(winner(stack, 'display', false, old)?.value).toBe('none');
  });
});

/**
 * The Notes LIST on the phone website (owner's screenshot, 2026-09-24): with real notes, a few hundred
 * characters each, the list card ran off the right edge — the search field, every row's one-line
 * preview (no ellipsis in sight, because the ellipsis was off-screen too) and the card's own border.
 * The preview already WAS one line with an ellipsis. What grew was the box around it.
 *
 * `.notes-wrap` is a flex item of `.content`, which is a flex ROW on a phone. A flex item's
 * `min-width: auto` is its min-content width, and the min-content width of a `nowrap` line is the
 * whole line: `overflow: hidden` on the preview clips what it paints, not what it asks for. So the
 * wrap could not shrink below the longest note, and the card, stretched to the wrap, went with it.
 * Short fixture notes never reach the screen width, which is why a 375px check found nothing.
 *
 * jsdom has no layout, so this resolves the cascade on the REAL markup: every element from the shell's
 * `.content` down to a row's preview, plus the search field. Any of them that sits in a flex ROW (or a
 * grid) has to resolve `min-width: 0` or a clipping overflow, the two things that stop its automatic
 * minimum being its content. An item of a flex COLUMN is stretched to its container and needs neither.
 */
describe('phone website: the Notes list fits the screen', () => {
  const words = 'the lantern swung above the gate while the rain kept falling on the old stone road ';
  const prose = (n: number) => words.repeat(Math.ceil(n / words.length)).slice(0, n);
  const character = {
    id: 'notes-width-fixture',
    notes: [
      { id: 'note-0', title: 'Journal', icon: 'ti-note', content: `<p>${prose(600)}</p>` },
      { id: 'note-1', title: 'Token', icon: 'ti-note', content: `<p>${'x'.repeat(200)}</p>` },
    ],
  } as unknown as Character;

  /** The Notes tab inside the sheet shell's own markup (CharacterSheet.tsx), phone-shaped. */
  function phoneNotes() {
    return renderDom(
      <ForceMobileContext.Provider value={true}>
        <div className="ws-app">
          <div className="body body-notes">
            <main className="content">
              <NotesTab character={character} />
            </main>
          </div>
        </div>
      </ForceMobileContext.Provider>,
    );
  }

  /** Is `el` an item whose automatic minimum width is its content: a flex ROW's item, or a grid's? */
  const sizedByContent = (el: Element): boolean => {
    const parent = el.parentElement!;
    const display = value(parent, 'display') ?? '';
    return /grid/.test(display) || (/flex/.test(display) && !/column/.test(value(parent, 'flex-direction') ?? ''));
  };
  const canShrink = (el: Element): boolean =>
    value(el, 'min-width') === '0' || /hidden|clip|auto|scroll/.test(value(el, 'overflow-x') ?? value(el, 'overflow') ?? '');

  it('every box from the shell down to a preview can shrink below the longest note', () => {
    const { host, stop } = phoneNotes();
    const preview = host.querySelector('.ni-preview')!;
    expect(preview.textContent!.length, 'fixture: a real-length note').toBeGreaterThanOrEqual(600);
    const chain: Element[] = [];
    for (let el: Element | null = preview; el && !el.classList.contains('body-notes'); el = el.parentElement) chain.push(el);
    chain.push(host.querySelector('.notes-search-row .search')!);
    expect(chain.map((el) => el.classList[0]), 'fixture: the whole chain is the real markup').toEqual(
      ['ni-preview', 'ni-text', 'note-item', 'notes-list', 'card', 'notes-wrap', 'content', 'search'],
    );
    const stuck = chain.filter((el) => sizedByContent(el) && !canShrink(el)).map((el) => el.className);
    expect(stuck, 'sized by their content, so the longest note sets their width').toEqual([]);
    stop();
  });

  it('keeps the preview to one clipped line with an ellipsis, and no row carries a width of its own', () => {
    const { host, stop } = phoneNotes();
    const rows = [...host.querySelectorAll<HTMLElement>('.note-item')];
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const preview = row.querySelector('.ni-preview')!;
      expect(preview, 'every row with text shows a preview').toBeTruthy();
      expect(value(preview, 'white-space')).toBe('nowrap');
      expect(value(preview, 'overflow')).toBe('hidden');
      expect(value(preview, 'text-overflow')).toBe('ellipsis');
      expect(row.style.width + row.style.minWidth, 'an inline width would pin the row whatever the CSS says').toBe('');
    }
    // The search field's input fills the field rather than asking for its own intrinsic width.
    expect(value(host.querySelector('.notes-search-row .search input')!, 'width')).toBe('100%');
    stop();
  });

  it('gives the desktop editor column a zero minimum, so one long word cannot widen it', () => {
    // The same content-sized minimum one level over: on the desktop the wrap is a grid, and a bare `1fr`
    // track means minmax(auto, 1fr). A 200-character unbroken word in the open page measured the editor
    // column at 1572px in a 1252px body (1280px window) before this; 1093px after.
    expect(value('notes-wrap', 'grid-template-columns')).toMatch(/\bminmax\(0, 1fr\)$/);
  });
});
