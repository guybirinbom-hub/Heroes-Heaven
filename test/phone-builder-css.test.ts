// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild } from '../src/rules/build';

/**
 * THE PHONE BUILDER'S LAYOUT AND TOUCH SIZES (owner, 2026-10-14: "the phone version of the builder …
 * the user can see some things, can't scroll and so many other small problems that a phone user
 * encounters"). The audit's CSS findings, each pinned by the value that WINS on a phone:
 *
 *  - A3/B4/D12: the level strip squashed on long pages (chips cut in half, the bar a vertical scroller).
 *    The phone pin let every child of the shell shrink; the desktop pin had `flex: none` for them.
 *  - A9: app banners painted over the builder header (name, level stepper, Cancel).
 *  - C6/E9: a 170-250px empty band between the Character card and the level card (grid rows stretched).
 *  - A6/C7: the Character stats toggle was a 32px chevron; a tap on the word did nothing.
 *  - A7/A8: a three-row header at 360px; 31px name field with 13px text; 32px chips 4px apart.
 *  - D4: Overrides → Change attributes ran off the right edge (Con/Cha unreachable).
 *  - B6/C9/C10/D9/D13/D15/E7: touch targets under the owner's bar (decision 7: 40px for main controls,
 *    36px for secondary ones, 6px between neighbours).
 *  - B9/D16: a picked name ellipsized at 360px. C14/E8: the picker title squeezed into three lines.
 *  - C15: a tapped row stayed highlighted after Back (sticky :hover on touch).
 *  - C16: 12.5-13px text in the builder's text fields.
 *  - C1/D8/E6 (CSS half): the Filters panel's Done button shows on a phone and nowhere else.
 *
 * jsdom has no layout, so like test/bug-phone-web.test.tsx this RESOLVES THE CASCADE over the two
 * stylesheets the builder loads (builder.css, then sheet.css): every rule that matches the element in
 * the given context, ranked important > specificity > document order. A rule merely PRESENT proves
 * nothing — a later rule at equal specificity, or the desktop-only block, decides what the phone sees.
 * The shell's elements are the REAL Builder's, rendered in phone mode, so a renamed class fails here too.
 *
 * Each block below was run once against the pre-fix stylesheets and failed (2026-10-14).
 */
// PHONE_CSS_ROOT: point the resolver at another copy of the two stylesheets (e.g. `git show HEAD:…`
// written to a scratch folder) to watch these tests fail on the old CSS. Unset = the working tree.
const CSS_ROOT = process.env.PHONE_CSS_ROOT ?? path.join(__dirname, '..');
const CSS = ['src/builder/builder.css', 'src/sheet.css']
  .map((f) => readFileSync(path.join(CSS_ROOT, ...f.split('/')), 'utf8'))
  .join('\n');

type Rule = { sels: string[]; body: string; at: string[]; order: number };

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
      if (!top) throw new Error('unbalanced }');
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
  if (stack.length) throw new Error('unclosed {');
  return out.sort((a, b) => a.order - b.order);
}
const RULES = parse(CSS);

/** Where the page is being looked at: a 360px touch phone (no hover), or a 1280px desktop with a mouse. */
type Ctx = { width: number; touch: boolean };
const PHONE: Ctx = { width: 360, touch: true };
const DESKTOP: Ctx = { width: 1280, touch: false };

/** One media condition, e.g. `(max-width: 720px)`, `(hover: hover)`. Unknown ones count as true. */
function cond(c: string, ctx: Ctx): boolean {
  const max = /max-width:\s*(\d+)px/.exec(c);
  if (max) return ctx.width <= Number(max[1]);
  const min = /min-width:\s*(\d+)px/.exec(c);
  if (min) return ctx.width >= Number(min[1]);
  if (/hover:\s*hover/.test(c)) return !ctx.touch;
  if (/hover:\s*none/.test(c)) return ctx.touch;
  if (/pointer:\s*coarse/.test(c)) return ctx.touch;
  if (/pointer:\s*fine/.test(c)) return !ctx.touch;
  if (/prefers-reduced-motion|\bprint\b/.test(c)) return false;
  return true;
}

/** Does every at-rule around this rule apply in this context? (`,` = or, `and` = and.) */
function applies(r: Rule, ctx: Ctx): boolean {
  return r.at.every((a) => {
    if (/^@supports\s+not/.test(a)) return false;
    if (!a.startsWith('@media')) return true;
    return a
      .replace(/^@media\s*/, '')
      .split(',')
      .some((alt) => alt.split(/\band\b/).every((c) => cond(c, ctx)));
  });
}

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

/** The winning declaration among `props` (a shorthand and its longhand compete in one cascade). */
function winner(el: Element, props: string[], ctx: Ctx): Decl | undefined {
  let best: (Decl & { spec: number }) | undefined;
  for (const r of RULES) {
    if (!applies(r, ctx)) continue;
    for (const sel of r.sels) {
      let hit = false;
      try {
        hit = el.matches(sel);
      } catch {
        continue;
      }
      if (!hit) continue;
      const s = spec(sel);
      for (const d of decls(r.body)) {
        if (!props.includes(d.prop)) continue;
        const beats = !best || (d.important !== best.important ? d.important : s >= best.spec);
        if (beats) best = { ...d, spec: s };
      }
    }
  }
  return best;
}
const val = (el: Element, prop: string, ctx: Ctx = PHONE) => winner(el, [prop], ctx)?.value;
const px = (v: string | undefined): number => {
  const m = /^(-?[\d.]+)px$/.exec((v ?? '').trim());
  return m ? Number(m[1]) : NaN;
};
/** The tap height a rule set guarantees: the larger of `height` and `min-height` that wins. */
const tapH = (el: Element, ctx: Ctx = PHONE) => Math.max(px(val(el, 'height', ctx)) || 0, px(val(el, 'min-height', ctx)) || 0);
const tapW = (el: Element, ctx: Ctx = PHONE) => Math.max(px(val(el, 'width', ctx)) || 0, px(val(el, 'min-width', ctx)) || 0);
/** flex-shrink as the cascade leaves it (the `flex` shorthand and the longhand compete). */
function shrink(el: Element, ctx: Ctx = PHONE): number {
  const d = winner(el, ['flex', 'flex-shrink'], ctx);
  if (!d) return 1;
  if (d.prop === 'flex-shrink') return Number(d.value);
  if (d.value === 'none') return 0;
  const parts = d.value.split(/\s+/);
  return parts.length >= 2 && /^[\d.]+$/.test(parts[1]) ? Number(parts[1]) : 1;
}

/** A detached fixture: `html` parsed into a div in the document, so descendant selectors match. */
function fixture(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}
const q = (root: ParentNode, sel: string) => {
  const e = root.querySelector(sel);
  if (!e) throw new Error(`fixture has no ${sel}`);
  return e;
};

/** jsdom has no media queries; answer them as a phone does (narrow, touch, no hover). */
function phoneMatchMedia(query: string): MediaQueryList {
  const max = /max-width:\s*(\d+)px/.exec(query);
  const matches = max ? Number(max[1]) >= 720 : /pointer:\s*coarse/.test(query) ? true : false;
  const noop = () => undefined;
  return { matches, media: query, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false } as unknown as MediaQueryList;
}

let shell: ReturnType<typeof renderDom>;
const realMatchMedia = window.matchMedia;
beforeAll(() => {
  window.matchMedia = phoneMatchMedia as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  shell = renderDom(createElement(Builder, { content: content(), initial: emptyBuild(), onCancel: () => undefined, onCreate: () => undefined }));
});
afterAll(() => {
  shell?.stop();
  window.matchMedia = realMatchMedia;
});
const S = (sel: string) => q(shell.host, sel);

describe('the builder shell on a phone (the real Builder, phone mode)', () => {
  it('A3/B4/D12: nothing but the body shrinks — the level strip and the header keep their height', () => {
    const kids = [...S('.builder').children].filter((c) => !c.classList.contains('builder-body'));
    expect(kids.map((k) => k.className).sort()).toEqual(expect.arrayContaining(['builder-head', 'lstrip']));
    for (const k of kids) expect(shrink(k), `${k.className} flex-shrink on a phone`).toBe(0);
    // The body is the one flexible child, and the strip can never scroll up and down by itself.
    expect(shrink(S('.builder-body'))).toBe(1);
    expect(val(S('.lstrip'), 'overflow-y')).toBe('hidden');
    expect(val(S('.lstrip'), 'overflow-y', DESKTOP)).toBe('hidden');
  });

  it('A9: the pinned builder starts below the app banners, and is exactly inset:0 with none', () => {
    const b = S('.builder');
    expect(val(b, 'position')).toBe('fixed');
    expect(val(b, 'top')).toBe('var(--app-banner-h, 0px)');
    const h = val(b, 'height') ?? '';
    expect(h, 'the dvh height must subtract the banners it starts below').toContain('dvh');
    expect(h).toContain('- var(--app-banner-h, 0px)');
    // The header's status-bar padding is not paid twice under a banner (the banner pads it already);
    // with no banner (--app-banner-h = 0px) the max() is the old env() term exactly.
    const pad = val(S('.builder-head'), 'padding') ?? '';
    expect(pad).toMatch(/max\(0px,\s*env\(safe-area-inset-top, 0px\) \/ var\(--zoom, 1\) - var\(--app-banner-h, 0px\)\)/);
    // Desktop: untouched — no `top`, the desktop height rule stands.
    expect(val(b, 'top', DESKTOP)).toBeUndefined();
  });

  it('A9 (round 2): the SHEET shell starts below the app banners too — its Edit button was still covered', () => {
    // The real class names: CharacterSheet.tsx renders `ws-app`, its top bar is `.identity`; Settings is
    // `ws-app subpage` with a `.subpage-bar`.
    const sheet = fixture('<div class="ws-app"><div class="identity"></div></div><div class="ws-app subpage"><div class="subpage-bar"></div></div>');
    const app = q(sheet, '.ws-app');
    expect(val(app, 'position')).toBe('fixed');
    expect(val(app, 'top'), 'the phone sheet shell must start below the banners').toBe('var(--app-banner-h, 0px)');
    const h = val(app, 'height') ?? '';
    expect(h).toContain('dvh');
    expect(h, 'and be that much shorter, or the bottom tabs run off the screen').toContain('- var(--app-banner-h, 0px)');
    expect(val(q(sheet, '.ws-app.subpage'), 'top'), 'Settings (a ws-app subpage) moves with it').toBe('var(--app-banner-h, 0px)');
    for (const sel of ['.identity', '.subpage-bar']) {
      const pad = winner(q(sheet, sel), ['padding', 'padding-top'], PHONE)?.value ?? '';
      expect(pad, `${sel}: the status bar is not paid twice under a banner`).toMatch(
        /max\(0px,\s*env\(safe-area-inset-top, 0px\) \/ var\(--zoom, 1\) - var\(--app-banner-h, 0px\)\)/,
      );
    }
    expect(val(app, 'top', DESKTOP)).toBeUndefined(); // desktop: unchanged
    sheet.remove();
  });

  it('C6/E9: the one-column body packs its rows at the top (no stretched empty band)', () => {
    expect(val(S('.builder-body'), 'align-content')).toBe('start');
  });

  it('A7/A8: two header rows at 360px — no LEVEL caption, 40px stepper, 16px/40px name field', () => {
    expect(val(S('.lvl-ctl-label'), 'display')).toBe('none');
    expect(val(S('.lvl-ctl-label'), 'display', DESKTOP)).toBeUndefined(); // desktop keeps the caption
    const name = S('.builder-head .name-input');
    expect(px(val(name, 'font-size'))).toBeGreaterThanOrEqual(16);
    expect(tapH(name)).toBeGreaterThanOrEqual(40);
    expect(px(val(name, 'font-size', DESKTOP))).toBe(13); // desktop unchanged
    const step = S('.lvl-step');
    expect(tapW(step)).toBeGreaterThanOrEqual(40);
    expect(tapH(step)).toBeGreaterThanOrEqual(40);
    // With the owner's Undo setting on, the pair rides on the title row: everything after it is order 1.
    for (const sel of ['.lvl-ctl', '.b-cancel', '.b-create']) expect(val(S(sel), 'order'), sel).toBe('1');
    const undo = fixture('<header class="builder-head"><div class="b-undo"></div></header>');
    expect(val(q(undo, '.b-undo'), 'order') ?? '0').toBe('0');
    undo.remove();
  });

  it('A8 / decision 7: level chips 40px with 6px between them; desktop chips unchanged', () => {
    const chip = S('.lstrip .lchip');
    expect(tapH(chip)).toBeGreaterThanOrEqual(40);
    expect(tapW(chip)).toBeGreaterThanOrEqual(40);
    expect(px(val(S('.lstrip'), 'gap'))).toBeGreaterThanOrEqual(6);
    expect(tapH(chip, DESKTOP)).toBe(26);
  });

  it('A6/C7: the Character toggle fills its title row at a 40px touch height', () => {
    const t = S('.brail-toggle');
    expect(val(t, 'width')).toBe('100%');
    expect(tapH(t)).toBeGreaterThanOrEqual(40);
  });
});

describe('phone controls (fixtures carrying the real class names)', () => {
  const host = fixture(`
    <div class="picker"><div class="picker-list"><button class="picker-item"></button></div>
      <div class="pick-row"><button class="pick-body"></button><button class="pick-add"></button></div>
      <input class="name-input"></div>
    <div class="picker fsel"><div class="fsel-head"><i class="ti"></i><span class="fsel-title"></span>
      <span class="fsel-cap"></span><button class="fsel-arch"></button><span class="fsel-count"></span>
      <button class="fsel-head-filters"></button><button class="picker-close"></button></div>
      <div class="fsel-panel"><div class="fsel-bar"><div class="fsel-metasearch"><input></div>
        <button class="fsel-clear"></button><button class="fsel-done"></button></div>
        <div class="fsel-tabs"><button class="fsel-tab"></button></div>
        <div class="fsel-chips"><button class="fsel-chip"></button></div><input class="fsel-text"></div>
      <div class="fsel-results"><div class="fsel-results-bar"><div class="fsel-results-search"><input></div>
        <button class="fsel-inel"></button></div>
        <div class="fsel-list"><div class="fsel-rowwrap"></div><div class="fsel-rowwrap" id="row2"></div></div></div></div>
    <div class="spr-chips"><span class="spr-chip"><button class="spr-chip-sig"></button><button class="spr-chip-x"></button></span>
      <button class="spr-add"></button></div>
    <button class="cc-det"></button>
    <div class="lvl-slot"><div class="lvl-card"></div><button class="lvl-clear-btn"></button></div>
    <span class="rule-toggle"><button class="inv-toggle"></button><button class="rule-info"></button></span>
    <div class="src-wrap"><button class="src-act"></button><button class="src-check"></button>
      <div class="src-search"><input><button class="src-search-x"></button></div>
      <div class="src-books"><button class="src-book"></button></div></div>
    <span class="ovr-chip"><button class="ovr-chip-x"></button></span>
    <div class="ovr-attrs"><label class="ovr-attr"><span class="ovr-attr-k"></span><input class="ovr-attr-in"><button class="ovr-attr-x"></button></label></div>
    <input class="ovr-edit-name"><textarea class="ovr-edit-desc"></textarea>
    <button class="mp-rules-link setup-rules-link"></button>
    <div class="custom-bg"><label class="cbg-field"><input><select></select></label></div>
    <button class="popsel ss-filled"><span class="ss-filled-body"><span class="popsel-val"></span></span><span class="ss-replace"></span></button>
  `);

  it('decision 7: the MAIN controls are 40px — picker rows, Select/Add, book rows', () => {
    for (const sel of ['.picker-item', '.pick-body', '.pick-add', '.src-book', '.picker .name-input', '.fsel-results-search', '.fsel-metasearch', '.cbg-field input'])
      expect(tapH(q(host, sel)), sel).toBeGreaterThanOrEqual(40);
  });

  it('decision 7: the SECONDARY controls are 36px', () => {
    for (const sel of [
      '.fsel-arch', '.fsel-head-filters', '.fsel-clear', '.fsel-tab', '.fsel-chip', '.fsel-inel',
      '.spr-chip', '.spr-add', '.cc-det', '.inv-toggle', '.rule-info', '.src-act', '.src-check',
      '.src-search-x', '.ovr-chip-x', '.ovr-attr-x', '.ovr-attr-in', '.ovr-edit-name', '.setup-rules-link',
    ])
      expect(tapH(q(host, sel)), sel).toBeGreaterThanOrEqual(36);
    // The spell chip's ✕ and ★ (13px glyphs) and the feat slot's clear ✕.
    for (const sel of ['.spr-chip-x', '.spr-chip-sig']) {
      expect(tapH(q(host, sel)), sel).toBeGreaterThanOrEqual(32);
      expect(tapW(q(host, sel)), sel).toBeGreaterThanOrEqual(32);
    }
    expect(tapW(q(host, '.lvl-clear-btn'))).toBeGreaterThanOrEqual(40);
  });

  it('decision 7: at least 6px between neighbours', () => {
    for (const sel of ['.picker-list', '.rule-toggle', '.src-books', '.lvl-slot'])
      expect(px(val(q(host, sel), 'gap')), sel).toBeGreaterThanOrEqual(6);
    expect(px(val(q(host, '#row2'), 'margin-top')), 'feat/spell picker rows').toBeGreaterThanOrEqual(6);
  });

  it('D4: the Overrides attribute grid fits the width instead of three min-content columns', () => {
    const cols = val(q(host, '.ovr-attrs'), 'grid-template-columns') ?? '';
    expect(cols).not.toBe('repeat(3, 1fr)');
    expect(cols).toMatch(/auto-fill|auto-fit/);
    expect(val(q(host, '.ovr-attr'), 'min-width')).toBe('0');
    expect(val(q(host, '.ovr-attrs'), 'grid-template-columns', DESKTOP)).toBe('repeat(3, 1fr)'); // desktop unchanged
  });

  it('D4 (round 2): the attribute grid takes the card row’s full width — not one 98px column', () => {
    // It is an item of the SubCard's wrapping flex row (.lvl-card-row), which sizes it to max-content;
    // an auto-fill grid with no width of its own has room for exactly one column there.
    // The real nesting (shared.tsx SetupCard → SubCard): the Overrides card's row holds the SubCard, whose
    // own row holds the grid. Both rows size their items to content, so BOTH levels must take the width:
    // measured on the phone, the grid alone at 100% stayed 98px inside a 196px subcard.
    const row = fixture(
      '<div class="lvl-card lvl-card-setup"><div class="lvl-card-text"><div class="lvl-card-row" id="outer">' +
        '<div class="lvl-subcard"><div class="lvl-card lvl-card-setup lvl-card-child"><div class="lvl-card-text">' +
        '<div class="lvl-card-row"><div class="ovr-attrs"><label class="ovr-attr"><span class="ovr-attr-k">Max HP</span>' +
        '<input class="ovr-attr-in"></label></div></div></div></div></div></div></div></div>',
    );
    const grid = q(row, '.ovr-attrs');
    const w = winner(grid, ['width', 'flex', 'flex-basis'], PHONE);
    expect(w && /\b100%/.test(w.value), `grid: phone width resolves to ${w?.prop}: ${w?.value}`).toBe(true);
    const sub = q(row, '#outer > .lvl-subcard');
    const f = winner(sub, ['flex', 'flex-basis', 'width'], PHONE);
    expect(f && /\b100%/.test(f.value), `subcard: phone width resolves to ${f?.prop}: ${f?.value}`).toBe(true);
    expect(val(q(row, '.ovr-attr-k'), 'white-space'), '"Max HP" on one line').toBe('nowrap');
    // Desktop: three columns and content-sized subcards, as before.
    expect(val(grid, 'width', DESKTOP)).toBeUndefined();
    expect(winner(sub, ['flex', 'flex-basis', 'width'], DESKTOP)).toBeUndefined();
    row.remove();
  });

  it('D4 (round 3): a follow-up card gives its controls the full card width — two attribute columns at 360px', () => {
    // Measured before (b-origin.cjs, Setup → Overrides): at 360/390 the content column was 162/192px (the
    // grid started at x=155 of 360) and "Change attributes" stood as six stacked boxes; two columns only
    // from ~412px. Now: inside a Setup card the follow-up card drops its 16px indent, and its row reaches
    // back under its own icon column (icon width + the card's gap) below an icon-tall label. Measured after:
    // 216/246/268px, two columns at 360, 390 and 412.
    const row = fixture(
      '<div class="lvl-card lvl-card-setup"><span class="lvl-card-icon"></span><div class="lvl-card-text"><div class="lvl-card-row" id="outer">' +
        '<div class="lvl-subcard"><i class="lvl-subcard-conn"></i><div class="lvl-card lvl-card-setup lvl-card-child"><span class="lvl-card-icon"></span>' +
        '<div class="lvl-card-text"><div class="lvl-card-label">Change attributes</div><div class="lvl-card-row" id="inner"></div></div></div></div>' +
        '</div></div></div>' +
        // A follow-up card on a level page (under a slot, not inside a Setup card's row) keeps its indent.
        '<div class="lvl-slot-wrap"><div class="lvl-subcard" id="slotsub"></div></div>',
    );
    const sub = q(row, '#outer > .lvl-subcard');
    const child = q(row, '.lvl-card-child');
    const icon = q(child, ':scope > .lvl-card-icon');
    const inner = q(row, '#inner');
    const label = q(child, '.lvl-card-label');
    const pad = (el: Element, ctx: Ctx = PHONE) => {
      const v = winner(el, ['padding-left', 'padding'], ctx)?.value?.split(/\s+/).pop();
      return v === '0' ? 0 : px(v);
    };
    expect(pad(sub), 'a Setup card follow-up keeps no extra indent on a phone').toBe(0);
    expect(pad(q(row, '#slotsub')), 'a level-page follow-up keeps its 16px indent').toBe(16);
    expect(pad(sub, DESKTOP), 'desktop indent unchanged').toBe(16);
    // The row reaches back exactly the icon column: the icon's width plus the card's gap, as the cascade has them.
    const iconCol = px(val(icon, 'width')) + px(val(child, 'gap'));
    expect(iconCol).toBeGreaterThan(0);
    expect(px(val(inner, 'margin-left')), 'the row starts under the icon').toBe(-iconCol);
    // …and below it: the label above the row is at least as tall as the icon (plus its 1px top margin).
    const iconH = px(val(icon, 'height')) + (px(val(icon, 'margin-top')) || 0);
    expect(tapH(label), 'the label is as tall as the icon, so the row never runs into it').toBeGreaterThanOrEqual(iconH);
    expect(val(label, 'box-sizing')).toBe('border-box');
    // The model the phone measured: 360px wide → the content column fits two 96px attribute columns.
    const before = 162; // measured content column at 360 before round 3
    expect(before + 16 + iconCol, 'content column at 360px').toBeGreaterThanOrEqual(2 * 96 + 6);
    // Desktop: untouched.
    expect(val(inner, 'margin-left', DESKTOP)).toBeUndefined();
    expect(val(label, 'min-height', DESKTOP)).toBeUndefined();
    row.remove();
  });

  it('round 3: the Max HP box takes the whole row, and no attribute label shrinks under its number field', () => {
    // Measured: with the revert ↶ shown, "Max HP" in a 105px half-width box was cut to "Max H" behind "120".
    const g = fixture(
      '<div class="ovr-attrs" id="one"><label class="ovr-attr"><span class="ovr-attr-k">Max HP</span><input class="ovr-attr-in"></label></div>' +
        '<div class="ovr-attrs" id="six"><label class="ovr-attr"></label><label class="ovr-attr"></label></div>',
    );
    expect(val(q(g, '#one > .ovr-attr'), 'grid-column')).toBe('1 / -1');
    expect(val(q(g, '#six > .ovr-attr'), 'grid-column'), 'six boxes keep their columns').toBeUndefined();
    expect(shrink(q(g, '.ovr-attr-k')), 'the label never shrinks').toBe(0);
    expect(val(q(g, '#one > .ovr-attr'), 'grid-column', DESKTOP)).toBeUndefined();
    g.remove();
  });

  it('B8: a picked Voluntary flaw draws in the flaw red, everywhere; a picked boost keeps the accent', () => {
    // AbilitySelect kind="flaw" → PopupSelect pill with class is-flaw and a ti-arrow-down `.popsel-lead`.
    const pills = fixture(
      '<button class="popsel pill is-picked is-flaw" id="flaw"><i class="ti ti-arrow-down popsel-lead"></i><span class="popsel-val"></span></button>' +
        '<button class="popsel pill is-picked" id="boost"><i class="ti ti-check popsel-lead"></i><span class="popsel-val"></span></button>',
    );
    for (const ctx of [PHONE, DESKTOP]) {
      const where = ctx === PHONE ? 'phone' : 'desktop';
      expect(winner(q(pills, '#flaw'), ['border-color', 'border'], ctx)?.value, `${where} flaw border`).toBe('var(--app-bad)');
      expect(val(q(pills, '#flaw .popsel-lead'), 'color', ctx), `${where} flaw icon`).toBe('var(--app-bad)');
      expect(val(q(pills, '#flaw'), 'background', ctx) ?? '', `${where} flaw fill`).toContain('var(--app-bad)');
      expect(winner(q(pills, '#boost'), ['border-color', 'border'], ctx)?.value, `${where} boost border`).toBe('var(--app-accent)');
      expect(val(q(pills, '#boost .popsel-lead'), 'color', ctx), `${where} boost icon`).toBe('var(--app-accent)');
    }
    pills.remove();
  });

  it('B9/D16: a picked value wraps on a phone instead of ellipsizing, and keeps its full width', () => {
    expect(val(q(host, '.ss-filled .popsel-val'), 'white-space')).toBe('normal');
    expect(val(q(host, '.ss-filled .popsel-val'), 'white-space', DESKTOP)).toBe('nowrap');
    // The phone `.popsel` padding (later in the file) overrode `.ss-filled { padding: 0 }` and took 24px
    // from the name: "Ancient-Blooded Dwarf" needs 149px and had 132 at 360px wide.
    expect(val(q(host, '.popsel.ss-filled'), 'padding')).toBe('0');
  });

  it('C14/E8/D16: the picker header wraps — title beside the X, the rest on a row under it', () => {
    expect(val(q(host, '.fsel-head'), 'flex-wrap')).toBe('wrap');
    expect(val(q(host, '.fsel-head'), 'flex-wrap', DESKTOP)).toBeUndefined();
    expect(val(q(host, '.fsel-cap'), 'white-space')).toBe('nowrap');
    expect(val(q(host, '.fsel-head > .picker-close'), 'order')).toBe('1');
    for (const sel of ['.fsel-cap', '.fsel-arch', '.fsel-count', '.fsel-head-filters']) expect(val(q(host, sel), 'order'), sel).toBe('2');
    expect(val(q(host, '.fsel-title'), 'order') ?? '0').toBe('0');
  });

  it('round 3 (N2): the two-row picker header is no taller than the old one, and the X keeps its hit area', () => {
    // Measured: the two-row header was 108px (row 1 as tall as the X's 40px hit area around a 23px title),
    // 7px more than the old squeezed header (101px). After: 102px at 360 and 412, the X 40x40, 6px above
    // Filters. The X lays out shorter by its negative block margins; the hit area stays 40px.
    const x = q(host, '.fsel-head > .picker-close');
    expect(tapH(x), 'the X keeps a 40px hit area').toBeGreaterThanOrEqual(40);
    const mb = (val(x, 'margin-block') ?? '0px').split(/\s+/).map((v) => px(v) || 0);
    const [mTop, mBottom] = [mb[0], mb[1] ?? mb[0]];
    const row1 = tapH(x) + mTop + mBottom;
    const gap = px(val(q(host, '.fsel-head'), 'row-gap'));
    const row2 = tapH(q(host, '.fsel-head-filters'));
    expect(row1, 'row 1 laid out no taller than 32px').toBeLessThanOrEqual(32);
    expect(gap + mBottom, 'decision 7: 6px between the X hit area and Filters under it').toBeGreaterThanOrEqual(6);
    expect(row1 + gap + row2, 'the two rows together (was 84px)').toBeLessThanOrEqual(78);
    expect(val(x, 'margin-block', DESKTOP)).toBeUndefined(); // desktop: one row, unchanged
  });

  it('C16: builder and picker text fields are 16px on a phone', () => {
    for (const sel of ['.fsel-results-search input', '.fsel-metasearch input', '.fsel-text', '.picker .name-input', '.cbg-field input', '.ovr-edit-name', '.ovr-attr-in'])
      expect(px(val(q(host, sel), 'font-size')), sel).toBeGreaterThanOrEqual(16);
  });

  it('C1/D8/E6: the Filters panel Done button shows on a phone only', () => {
    expect(val(q(host, '.fsel-done'), 'display')).toBe('inline-flex');
    expect(val(q(host, '.fsel-done'), 'display', DESKTOP)).toBe('none');
    expect(tapH(q(host, '.fsel-done'))).toBeGreaterThanOrEqual(40);
  });

  it('C9/D15: the range slider handle has a 40px hit area and readable labels', () => {
    const before = RULES.filter((r) => applies(r, PHONE) && r.sels.includes('.rsl-handle::before'));
    expect(before.length, 'a phone .rsl-handle::before hit ring').toBeGreaterThan(0);
    const inset = before.flatMap((r) => decls(r.body)).filter((d) => d.prop === 'inset').pop()?.value;
    const handle = fixture('<div class="rsl"><div class="rsl-track"><button class="rsl-handle"></button></div><div class="rsl-scale"><span class="rsl-stop"></span></div></div>');
    const w = px(val(q(handle, '.rsl-handle'), 'width'));
    expect(w - 2 * px(inset), 'visible dot plus the ring on both sides').toBeGreaterThanOrEqual(40);
    expect(px(val(q(handle, '.rsl-stop'), 'font-size'))).toBeGreaterThanOrEqual(11);
    handle.remove();
  });
});

describe('C15: no sticky hover highlight on a touch screen', () => {
  // The picker rows and the builder's choice controls: every rule that paints them on :hover sits in
  // `@media (hover: hover)`. Two RESETS (background back to transparent) are harmless and stay outside.
  const TARGETS = ['.pick-body', '.pick-add', '.picker-item', '.popsel', '.ss-filled-body', '.ss-replace'];
  const RESETS = new Set(['.pick-body-static:hover', '.picker-item:disabled:hover']);
  it('every :hover rule for a picker row or choice control is gated by (hover: hover)', () => {
    const ungated = RULES.flatMap((r) =>
      r.sels
        .filter((s) => s.includes(':hover') && TARGETS.some((t) => new RegExp(`\\${t}(?![\\w-])[^ ]*:hover`).test(s)) && !RESETS.has(s))
        .filter(() => !r.at.some((a) => /hover:\s*hover/.test(a)))
        .map((s) => s),
    );
    expect(ungated).toEqual([]);
  });
  it('the instrument sees a hover rule at all (not vacuous)', () => {
    const gated = RULES.filter((r) => r.at.some((a) => /hover:\s*hover/.test(a)) && r.sels.some((s) => s.startsWith('.pick-body:hover')));
    expect(gated.length).toBeGreaterThan(0);
  });
});
