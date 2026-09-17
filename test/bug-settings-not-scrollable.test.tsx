// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderDom } from './_render';
import { SettingsPage } from '../src/sheet/SettingsPage';

/**
 * "The app settings page isn't scrollable so I can't access some of the settings." — owner, 2026-09-17.
 *
 * MEASURED in the running app at 1280x600, Settings → Appearance:
 *   .ws-app.subpage        client 600   scroll 600    (the shell, clamped to the window, overflow:hidden)
 *   .settings-subpage-body client 2673  flex 0 0 auto <- grew to its CONTENT height inside that 600px
 *   .settings-pane         client 2673  scroll 2673   <- nothing to scroll: the wheel moved nothing
 * Everything past the first screenful (When the app opens, Undo and redo, Sources, Popups) was
 * unreachable. After the fix, same window: pane client 508, scroll 2673, wheel scrolls it, and the
 * shell / nav / body are the only other boxes — none of them scrollable, so there is one scrollbar.
 *
 * ROOT CAUSE, and it is not in the Settings CSS at all. `.ws-app > :not(.body) { flex: none }` (top of
 * sheet.css, 2026-08-11) pins every bar in a pinned shell so a tall body can't shrink it. A SUBPAGE
 * (Settings, Customize) is also a `.ws-app`, and its body is `.subpage-body`, not `.body` — so the
 * guard matched it, and at two classes against one it beat `.subpage-body { flex: 1 }`. The fix
 * restates the body's flex for `.subpage-body` at equal specificity later in the file.
 *
 * jsdom has no layout and applies no stylesheet, so the numbers above cannot be re-measured here.
 * What a test CAN hold is the cascade that produced them: the rules the app really ships, resolved
 * against the page's real DOM. `winner()` below is a small cascade — id/class specificity, then
 * source order — which is exactly the pair this bug turned on.
 */

type Rule = { sel: string; body: string; at: string | null; order: number };

/** Every rule in the stylesheet, with the at-rule it sits in (this file nests exactly one level). */
function parseRules(css: string): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let at: string | null = null;
  let head = '';
  let i = 0;
  while (i < clean.length) {
    const ch = clean[i];
    if (ch === '{') {
      const sel = head.trim();
      head = '';
      // An at-rule (@media / @keyframes / @supports) opens a nested block; its own declarations
      // (@font-face) carry no braces and fall out at the closing '}'.
      if (sel.startsWith('@')) {
        at = sel;
        i++;
        continue;
      }
      const end = clean.indexOf('}', i);
      rules.push({ sel, body: clean.slice(i + 1, end), at, order: rules.length });
      i = end + 1;
      continue;
    }
    if (ch === '}') {
      at = null;
      head = '';
      i++;
      continue;
    }
    head += ch;
    i++;
  }
  return rules;
}

const RULES = parseRules(readFileSync('src/sheet.css', 'utf8'));

/** Rules that apply at a given width: the unconditional ones plus the matching width query. */
const atWidth = (px: number) =>
  RULES.filter((r) => {
    if (r.at === null) return true;
    if (!r.at.startsWith('@media')) return false; // keyframe stops are not selectors
    const min = /min-width:\s*(\d+)px/.exec(r.at);
    const max = /max-width:\s*(\d+)px/.exec(r.at);
    if (min && px < Number(min[1])) return false;
    if (max && px > Number(max[1])) return false;
    return Boolean(min || max);
  });

/** Selector weight, ids first — enough for this file, which has no `!important` and no ids in play.
 *  `:not(.body)` contributes its ARGUMENT's class, which is why the shell guard outweighed
 *  `.subpage-body`; the regex counts it exactly that way. */
function weight(sel: string): [number, number] {
  const s = sel.replace(/::[a-z-]+/g, '');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!not\b)[a-z-]+/g) ?? []).length;
  return [ids, classes];
}

/** `overflow: hidden` sets overflow-y too — an axis asked for by name must see the shorthand, which
 *  is how `.settings-subpage-body` actually clips over the earlier `.subpage-body { overflow-y: auto }`. */
function axis(prop: string, name: string, value: string): string | null {
  if (name === prop) return value;
  if (prop !== 'overflow-y' && prop !== 'overflow-x') return null;
  if (name !== 'overflow') return null;
  const parts = value.split(/\s+/);
  return parts.length > 1 ? (prop === 'overflow-x' ? parts[0] : parts[1]) : parts[0];
}

/** The declaration that wins on `el` for `prop`: highest weight, then last in the file. */
function winner(el: Element, prop: string, px: number): { value: string; sel: string } | null {
  let best: { value: string; sel: string; w: [number, number]; order: number } | null = null;
  for (const rule of atWidth(px)) {
    for (const one of rule.sel.split(',')) {
      const sel = one.trim();
      if (!sel) continue;
      let hit = false;
      try {
        hit = el.matches(sel);
      } catch {
        continue; // a selector jsdom can't parse cannot be the one that styles this element
      }
      if (!hit) continue;
      for (const decl of rule.body.split(';')) {
        const [rawName, ...rest] = decl.split(':');
        const value = axis(prop, rawName.trim(), rest.join(':').trim());
        if (!value) continue;
        const w = weight(sel);
        if (best && (best.w[0] > w[0] || (best.w[0] === w[0] && best.w[1] > w[1]))) continue;
        best = { value, sel, w, order: rule.order };
      }
    }
  }
  return best ? { value: best.value, sel: best.sel } : null;
}

/** flex-grow out of the `flex` shorthand (or of `flex-grow` itself). `flex: none` is 0 0 auto. */
function flexGrow(el: Element, px: number): number {
  const short = winner(el, 'flex', px);
  const grow = winner(el, 'flex-grow', px);
  const fromShort = short ? (short.value === 'none' ? 0 : Number(short.value.split(/\s+/)[0])) : null;
  return grow ? Number(grow.value) : (fromShort ?? 0);
}

function settingsPage() {
  const r = renderDom(createElement(SettingsPage, { onClose: () => undefined }));
  const page = r.host.querySelector('.ws-app.subpage') as HTMLElement;
  return { ...r, page };
}

describe('bug 2026-09-17: the Settings page would not scroll', () => {
  it('the pane is the scroll container and nothing above it competes for the scrollbar', () => {
    const { page, stop } = settingsPage();
    try {
      const pane = page.querySelector('.settings-pane')!;
      expect(winner(pane, 'overflow-y', 1280)?.value).toBe('auto');
      // One scrollbar: every box between the shell and the pane hands its height down instead of
      // scrolling on its own.
      for (const sel of ['.settings-subpage-body', '.settings-body']) {
        const el = page.querySelector(sel)!;
        expect([undefined, 'hidden', 'visible']).toContain(winner(el, 'overflow-y', 1280)?.value);
      }
    } finally {
      stop();
    }
  });

  it('every ancestor of the pane flexes, so the pane is sized by the window and not by its content', () => {
    const { page, stop } = settingsPage();
    try {
      // The shell is the deliberate clamp: fixed to the viewport, overflow hidden. Everything from
      // its body down must GROW into it — a `flex: none` anywhere in this chain is the bug, because
      // the box then takes its content height and the pane below it never overflows.
      expect(winner(page, 'overflow', 1280)?.value).toBe('hidden');
      for (const sel of ['.settings-subpage-body', '.settings-body', '.settings-pane']) {
        const el = page.querySelector(sel)!;
        expect({ sel, grow: flexGrow(el, 1280) }).toEqual({ sel, grow: 1 });
        // …and none of them may pin a height of its own: a fixed height inside a clamped shell is
        // the same clip by another route.
        expect({ sel, height: winner(el, 'height', 1280)?.value }).toEqual({ sel, height: undefined });
      }
      // min-height: auto is a flex item's default and would stop it shrinking to the shell.
      for (const sel of ['.settings-subpage-body', '.settings-body']) {
        expect(winner(page.querySelector(sel)!, 'min-height', 1280)?.value).toBe('0');
      }
    } finally {
      stop();
    }
  });

  it('the phone keeps the home-bar gap under the last control', () => {
    const { page, stop } = settingsPage();
    try {
      const pane = page.querySelector('.settings-pane')!;
      const pad = winner(pane, 'padding-bottom', 375)?.value ?? '';
      expect(pad).toContain('env(safe-area-inset-bottom');
    } finally {
      stop();
    }
  });

  it('the last section is in the page, and so is the last thing in the open one', () => {
    const { page, stop } = settingsPage();
    try {
      const nav = [...page.querySelectorAll('.settings-navitem')].map((b) => (b.textContent ?? '').trim());
      expect(nav.length).toBeGreaterThan(3);
      expect(nav[nav.length - 1]).toBe('About');
      // The bottom of the Appearance pane — the part the owner's window cut off.
      expect(page.textContent).toContain('Apply popup size to all');
    } finally {
      stop();
    }
  });
});
