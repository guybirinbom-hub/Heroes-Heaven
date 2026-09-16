// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { getTheme, themeAliases, themeList, themes } from '../src/theme/themes';
import { getAppearance, initTheme, resolveAppearanceVars, setFont, setTheme } from '../src/theme/theme-manager';
import { PaletteTile } from '../src/theme/PaletteTile';
import { renderDom } from './_render';

/**
 * Palette guard.
 *
 * A palette is pure data, so nothing in the app fails loudly when one ships a token that can't be read
 * against the surface it sits on — it just looks wrong on somebody's screen. This measures every
 * palette (including the six ported from the owner's original initiative tracker) against the floors
 * the palettes already in the app hold, so a new one can't land below the field.
 *
 * Floors are the MEASURED minimum across the 14 palettes that shipped before the port (Abyss included,
 * measured before it was retired), rounded down — not WCAG's numbers. They are a ratchet: "no new
 * palette is worse than what we already ship". Most tokens clear AA comfortably; the floors that sit
 * below AA are called out where they're asserted, and the one palette allowed under a floor is listed
 * in BELOW_FLOOR with the reason and its real numbers — nothing is relaxed silently.
 */

const REQUIRED_TOKENS = [
  '--app-bg',
  '--app-surface',
  '--app-surface-2',
  '--app-surface-3',
  '--app-border',
  '--app-text',
  '--app-text-dim',
  '--app-text-faint',
  '--app-accent',
  '--app-good',
  '--app-warn',
  '--app-bad',
];

/** The six palettes carried over from the tracker (C:\pf2e-tracker), by the tracker's own names. */
const PORTED = ['tavern', 'graveyard', 'stellar', 'verdant', 'goatval', 'obsidian'];

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('palette registry', () => {
  it('every palette supplies the full token set and keys itself by its own id', () => {
    for (const t of themeList) {
      expect(themes[t.id], `${t.id} is registered under a different key`).toBe(t);
      expect(t.name.length, `${t.id} has no name for the picker`).toBeGreaterThan(0);
      for (const token of REQUIRED_TOKENS) {
        expect(t.tokens[token], `${t.id} is missing ${token}`).toMatch(/^#[0-9a-f]{3,8}$/i);
      }
      expect(t.consumableColor, `${t.id} consumable highlight`).toMatch(/^#[0-9a-f]{3,8}$/i);
      // The consumable highlight marks a different thing than invested/equipped does, so it must not be
      // the accent wearing a second hat.
      expect(t.consumableColor.toLowerCase(), `${t.id} consumable == accent`).not.toBe(
        t.tokens['--app-accent'].toLowerCase(),
      );
      // Caution has to LOOK like caution. Goatval shipped with its warn mapped to the one ported
      // palette that owns no warm colour (an ash slate), so every caution badge read grey — indistinct
      // from ordinary dim text. Warm = more red than blue; it says nothing about hue beyond that.
      const [wr, , wb] = rgb(t.tokens['--app-warn']);
      expect(wr, `${t.id}: warn is not a warm colour`).toBeGreaterThan(wb);
    }
  });

  it('carries the six ported palettes', () => {
    for (const id of PORTED) expect(themes[id], `${id} missing`).toBeDefined();
  });

  it('polarity matches the background it declares', () => {
    for (const t of themeList) {
      const l = luminance(t.tokens['--app-bg']);
      if (t.polarity === 'dark') expect(l, `${t.id} bg is not dark`).toBeLessThan(0.15);
      else expect(l, `${t.id} bg is not light`).toBeGreaterThan(0.6);
    }
  });
});

describe('palette contrast', () => {
  /** [label, foreground token, background token, floor] — the pre-port minimum, rounded down. The only
   *  palette held to less is the one BELOW_FLOOR names, on the checks it names. */
  const CHECKS: [string, string, string, number][] = [
    ['text on bg', '--app-text', '--app-bg', 10],
    ['text on surface', '--app-text', '--app-surface', 11],
    ['text on surface-2', '--app-text', '--app-surface-2', 9],
    ['dim text on surface', '--app-text-dim', '--app-surface', 4.5],
    // Faint text is deliberately quiet (timestamps, hints) and sits below AA in the palettes that
    // already ship — Daylight is the floor at 2.54.
    ['faint text on surface', '--app-text-faint', '--app-surface', 2.5],
    ['accent on surface', '--app-accent', '--app-surface', 3.5],
    // The accent also labels things sitting on surface-2 (the active Settings nav row), which is a
    // step closer to the accent than surface is — Midnight is the floor at 3.19.
    ['accent on surface-2', '--app-accent', '--app-surface-2', 3],
    ['good on surface', '--app-good', '--app-surface', 4],
    ['warn on surface', '--app-warn', '--app-surface', 4],
    ['bad on surface', '--app-bad', '--app-surface', 4],
    // Borders are non-text structure; 3:1 is the WCAG bar for a control boundary, but every palette
    // here draws a quieter line than that and always has.
    ['border on surface', '--app-border', '--app-surface', 1.3],
  ];

  /*
   * The one palette allowed under a floor, named check by check with the number it actually holds.
   *
   * Verdant Grove's text and parchment surfaces are the tracker theme's own values; repainting them to
   * clear Parchment's numbers (10.22 / 11.27 / 9.33) would stop it looking like the theme it was ported
   * from, which is the point of the port. It is still AAA (7:1) on all three. Anything NOT listed here
   * — including any palette a later lane adds — is held to the full pre-port floor.
   */
  const BELOW_FLOOR: Record<string, Record<string, number>> = {
    verdant: { 'text on bg': 9.6, 'text on surface': 10.4, 'text on surface-2': 7.7 },
  };

  for (const [label, fg, bg, floor] of CHECKS) {
    it(`${label} >= ${floor}:1 in every palette (BELOW_FLOOR excepted)`, () => {
      for (const t of themeList) {
        const min = BELOW_FLOOR[t.id]?.[label] ?? floor;
        expect(contrast(t.tokens[fg], t.tokens[bg]), `${t.id}: ${label}`).toBeGreaterThanOrEqual(min);
      }
    });
  }

  /*
   * Accent text — button and badge labels sitting on an accent fill.
   *
   * textOn() now measures both candidates and keeps the better, so there are three things to hold: it
   * really is the better of the two, it clears AA wherever the accent allows AA at all, and it is never
   * worse than the luminance-cutoff rule it replaced (the owner shipped those numbers; none of them may
   * go backwards while fixing the six that were bad).
   */
  const INK = '#101013';
  const WHITE = '#ffffff';
  /** Accents where NEITHER ink nor white reaches 4.5:1 — the fill itself is the ceiling, and repainting
   *  it would change a palette that shipped. Listed with the best ratio it can reach. */
  const AA_UNREACHABLE: Record<string, number> = { midnight: 4.46 };

  it('accent text is the better of ink and white, and clears AA where the accent allows it', () => {
    for (const t of themeList) {
      const { vars } = resolveAppearanceVars(t.id, 'modern', 'system', null, null);
      const acc = vars['--app-accent'];
      const got = contrast(vars['--app-accent-text'], acc);
      const best = Math.max(contrast(INK, acc), contrast(WHITE, acc));
      expect(got, `${t.id}: not the better ink`).toBeCloseTo(best, 5);
      if (AA_UNREACHABLE[t.id] === undefined) expect(got, `${t.id}: accent text below AA`).toBeGreaterThanOrEqual(4.5);
      else expect(got, `${t.id}: below its own ceiling`).toBeGreaterThanOrEqual(AA_UNREACHABLE[t.id]);
    }
  });

  it('never scores below the luminance-cutoff rule it replaced', () => {
    for (const t of themeList) {
      const { vars } = resolveAppearanceVars(t.id, 'modern', 'system', null, null);
      const acc = vars['--app-accent'];
      // The rule as it stood: dark ink only above 0.45 luminance, white otherwise.
      const wasIt = luminance(acc) > 0.45 ? INK : WHITE;
      expect(contrast(vars['--app-accent-text'], acc), `${t.id}: worse than before`).toBeGreaterThanOrEqual(
        contrast(wasIt, acc),
      );
    }
  });

  it('paints the accent ink (--app-accent-text / --text-on-accent) only where the accent is the fill', () => {
    /*
     * `--app-accent-text` is the ink picked FOR an accent fill — near-black whenever the accent is
     * bright. On any other background it is just dark-on-dark: the active Homebrew rules row set it
     * over `--app-surface-2` and measured 1.29:1 on Slate. Nothing types-checks a stylesheet, so this
     * reads the CSS: a rule using the token must fill itself with the accent, or share a selector with
     * a rule that does (`.inv-sec.drop-over` sets its fill one line above).
     *
     * The token crosses into the tracker under its own name — tracker/src/hh-compat.css maps
     * `--text-on-accent` to `--app-accent-text` so ported components can keep their vocabulary — so
     * this walks tracker/src/**\/*.css too. And because PaletteTile.tsx renders inline (no CSS class)
     * to stay usable inside the tracker's own components, tracker/src/**\/*.tsx is scanned the same
     * way: a `color:` (or `.style.color =`) using the ink must sit in the same brace-delimited block
     * as a `var(--accent)` fill — same object literal, same ternary, same event handler.
     */
    const walk = (dir: string, ext: string, out: string[]) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name), ext, out);
        else if (e.name.endsWith(ext)) out.push(path.join(dir, e.name));
      }
    };
    const cssFiles: string[] = [];
    walk(path.join(__dirname, '..', 'src'), '.css', cssFiles);
    walk(path.join(__dirname, '..', 'tracker', 'src'), '.css', cssFiles);
    expect(cssFiles.length, 'no stylesheets found to check').toBeGreaterThan(0);

    const tsxFiles: string[] = [];
    walk(path.join(__dirname, '..', 'tracker', 'src'), '.tsx', tsxFiles);
    expect(tsxFiles.length, 'no tracker components found to check').toBeGreaterThan(0);

    // HH names its tokens --app-accent / --app-accent-text; the tracker's own vocabulary (mapped onto
    // those by hh-compat.css) is --accent / --text-on-accent. Either fill counts for either ink.
    const ACCENT_FILL = /background[^;]*var\(--(?:app-)?accent(?!-text)/;
    const ACCENT_INK = /color:\s*var\(--(?:app-accent-text|text-on-accent)\b/;
    const offenders: string[] = [];

    for (const file of cssFiles) {
      // Strip comments first — a `/* checks */` sitting right before a selector otherwise gets
      // captured as part of it, so an honest share-a-selector match (`.foo` vs `.foo::after`) never
      // lines up. (Caught tracker/src/index.css's `.ind-box .spell-pip::after`.) Blank out the comment
      // body instead of deleting it so line numbers computed below still match the real file.
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
      const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
        selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
        body: m[2],
        line: css.slice(0, m.index).split('\n').length,
      }));
      const filled = rules.filter((r) => ACCENT_FILL.test(r.body)).flatMap((r) => r.selectors);
      for (const r of rules) {
        if (!ACCENT_INK.test(r.body)) continue;
        if (ACCENT_FILL.test(r.body)) continue;
        // A pseudo-element or descendant selector shares its parent's fill (`.foo::after` reads
        // `.foo`'s background), so the ink selector need only EXTEND a filled one, not equal it —
        // but "extend" means a real selector boundary (`::`, ` `, `.`, `#`, `[`, …) right after the
        // filled selector's text, not just a shared string prefix (`.foo` must not exempt `.foobar`).
        if (r.selectors.some((s) => filled.some((f) => s === f || /^[\s:>+~.#\[]/.test(s.slice(f.length))))) continue;
        offenders.push(`${path.basename(file)}:${r.line} ${r.selectors.join(', ').slice(0, 70)}`);
      }
    }

    // The innermost {...} enclosing a given position — a JSX style object, a ternary inside one, or
    // an event-handler body — found by scanning outward for the nearest brace that isn't closed
    // again before the position, then forward to its own match. No AST needed for this shape of check.
    const enclosingBlock = (text: string, idx: number): string | null => {
      let depth = 0;
      let start = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (text[i] === '}') depth++;
        else if (text[i] === '{') {
          if (depth === 0) { start = i; break; }
          depth--;
        }
      }
      if (start === -1) return null;
      let d = 0;
      for (let i = start; i < text.length; i++) {
        if (text[i] === '{') d++;
        else if (text[i] === '}') { d--; if (d === 0) return text.slice(start, i + 1); }
      }
      return null;
    };
    // Only `color:` / `.style.color =` reaching a `var(--text-on-accent)` before the next comma,
    // semicolon or brace counts — that stays inside one property (including a ternary's two arms)
    // without also catching the toggle-switch KNOBS that use the same token as a `background` fill.
    const TSX_INK = /(?:\.style\.color\s*=|color:)\s*[^,;}]*?var\(--text-on-accent\)/g;
    for (const file of tsxFiles) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(TSX_INK)) {
        const block = enclosingBlock(text, m.index);
        if (block?.includes('var(--accent)')) continue;
        const line = text.slice(0, m.index).split('\n').length;
        offenders.push(`${path.basename(file)}:${line} (no var(--accent) fill in the same block)`);
      }
    }

    expect(offenders, 'accent ink on a non-accent fill').toEqual([]);
  });

  it('gives the palette tile its own focus ring, not just the page-wide default', () => {
    /*
     * PaletteTile is inline-styled (border: none, background: none — see PaletteTile.tsx) so a
     * focused tile falls back to whatever :focus-visible rule reaches it. tokens.css already carries
     * a page-wide one, but that's a bare selector far from this component; a later `button { outline:
     * none }` reset could silence it for every button, tile included, without anything here noticing.
     * An explicit `.palette-tile:focus-visible` rule, tied to the tile by name, is what PaletteTile.tsx
     * puts on the button (`className="palette-tile"`); this just holds that the rule still exists.
     */
    const css = readFileSync(path.join(__dirname, '..', 'src', 'theme', 'tokens.css'), 'utf8');
    const rule = /\.palette-tile:focus-visible\s*\{([^{}]*)\}/.exec(css);
    expect(rule, '.palette-tile:focus-visible rule is missing from tokens.css').not.toBeNull();
    expect(rule![1]).toMatch(/outline:\s*2px solid var\(--app-accent\)/);
    expect(rule![1]).toMatch(/outline-offset:\s*2px/);
  });

  it('derives a hover shade that moves away from the surface, not into it', () => {
    for (const t of themeList) {
      const { vars } = resolveAppearanceVars(t.id, 'modern', 'system', null, null);
      const base = luminance(t.tokens['--app-accent']);
      const hover = luminance(vars['--app-accent-hover']);
      if (t.polarity === 'dark') expect(hover, `${t.id} hover`).toBeGreaterThan(base);
      else expect(hover, `${t.id} hover`).toBeLessThan(base);
    }
  });
});

describe('retired palette ids', () => {
  it('each alias points at a live palette and is not itself one', () => {
    for (const [old, next] of Object.entries(themeAliases)) {
      expect(themes[old], `${old} is retired but still registered`).toBeUndefined();
      expect(themes[next], `${old} aliases the unknown palette ${next}`).toBeDefined();
    }
  });

  it('resolves a saved preference naming a retired id to its replacement', () => {
    // Abyss was replaced by Stellar (measured ΔE76 <= 10 on bg/surface/text/accent, same polarity).
    expect(getTheme('abyss')?.id).toBe('stellar');
    const { vars, theme, polarity } = resolveAppearanceVars('abyss', 'modern', 'system', null, null);
    expect(theme).toBe('stellar');
    expect(polarity).toBe('dark');
    expect(vars['--app-bg']).toBe(themes.stellar.tokens['--app-bg']);
  });

  it('leaves a retired id in storage instead of rewriting it to the replacement', () => {
    /*
     * Appearance is a SYNCED setting. If loading `abyss` rewrote it to `stellar`, a device still on the
     * previous build would pull an id its own registry doesn't have, fall back to Midnight, and push
     * THAT back — both devices end on a palette the user never chose. So: resolve for painting, store
     * what was saved.
     */
    const KEY = 'pf2e-codex.appearance';
    const saved = { themeId: 'abyss', styleId: 'modern', fontId: 'system', accent: null };
    localStorage.setItem(KEY, JSON.stringify(saved));
    initTheme();
    expect(getAppearance().themeId, 'retired id survives the load').toBe('abyss');
    expect(document.documentElement.dataset.theme, 'but paints its replacement').toBe('stellar');

    setFont('system'); // any appearance edit — it saves the whole state back
    expect(JSON.parse(localStorage.getItem(KEY)!).themeId, 'save must not rewrite it').toBe('abyss');
    setTheme('abyss'); // and choosing it explicitly stores the same id, not the replacement
    expect(JSON.parse(localStorage.getItem(KEY)!).themeId).toBe('abyss');

    localStorage.removeItem(KEY);
    initTheme();
  });

  it('lights the replacement palette in the picker when a retired id is what was saved', () => {
    // The screen painted Stellar while the picker showed nothing chosen, because the tiles compared the
    // saved id to their own. PaletteTile is the one component all three pickers use (Appearance, the
    // per-character Customize drawer, the tracker), so this is the comparison every one of them makes.
    const { host, stop } = renderDom(
      createElement(
        'div',
        null,
        themeList.map((t) => createElement(PaletteTile, { key: t.id, theme: t, selectedId: 'abyss', onPick: () => undefined })),
      ),
    );
    const lit = [...host.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent);
    expect(lit).toEqual([themes.stellar.name]);
    stop();
  });

  it('falls back to the default palette for an id that is neither live nor retired', () => {
    expect(getTheme('no-such-theme')).toBeUndefined();
    expect(resolveAppearanceVars('no-such-theme', 'modern', 'system', null, null).theme).toBe('midnight');
  });
});
