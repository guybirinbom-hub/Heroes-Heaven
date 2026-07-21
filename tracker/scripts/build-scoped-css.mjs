/*
 * Build the tracker's stylesheet as a SCOPED bundle that is safe to import into Heroes Heaven.
 *
 * WHY THIS EXISTS
 * ---------------
 * The tracker's CSS starts with `@tailwind base`, which emits Tailwind's Preflight — a GLOBAL reset
 * (`*`, `html`, `body`, `h1..h6`, `ul/ol`, `button`, …). Dropped into HH unscoped it would wreck the
 * builder: HH has 37 heading elements but only 5 heading rules, so Preflight's
 * `h1..h6 { font-size: inherit; font-weight: inherit }` alone would collapse ~32 headings to body
 * text, strip bullets from lists that don't set list-style, and impose a global box-sizing HH never
 * had. The two stylesheets also both define 5 class names (btn, btn-primary, btn-danger, btn-ghost,
 * chip), which would fight over whichever loaded last.
 *
 * Prefixing every selector with `.tracker-root` fixes BOTH at once: Preflight becomes
 * `.tracker-root *`, and `.btn` becomes `.tracker-root .btn`.
 *
 * WHY A PRE-BUILT FILE (and not PostCSS inside HH)
 * -----------------------------------------------
 * Vite's PostCSS config is per-project, so adding Tailwind to HH would run it over HH's OWN css too
 * — and prefixing HH's selectors would be catastrophic. Emitting one plain .css file here means
 * **HH's build stays completely untouched**: no Tailwind, no PostCSS, no config edits. HH just
 * imports a stylesheet. That is what makes the connection trivially reversible — deleting the
 * integration is deleting an import, not unwinding a build.
 *
 * COST: the tracker's CSS inside HH doesn't hot-reload; re-run `npm run build:css` after editing it.
 * Standalone (port 1421) is unaffected and still hot-reloads normally.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import prefixer from 'postcss-prefix-selector';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCOPE = '.tracker-root';

// Selectors that describe the DOCUMENT rather than an element inside it. Prefixing them would
// produce nonsense (`.tracker-root html`), so they collapse to the scope root itself — the wrapper
// element becomes "the document" as far as the tracker's CSS is concerned.
const DOC_SELECTORS = new Set(['html', 'body', ':root', ':host', 'html, body', ':host, html']);

/*
 * SPECIFICITY IS THE WHOLE GAME HERE.
 *
 * Prefixing doesn't just move a rule — it PROMOTES it. Preflight's `button { padding: 0 }` is
 * specificity (0,0,1); Heroes Heaven's `.tab { padding: … }` is (0,1,0) and normally wins easily.
 * Naively prefixed to `.tracker-root button` it becomes (0,1,1) and starts BEATING `.tab` — so any
 * Heroes Heaven component rendered inside the tracker (the GM's sheet, the party cards) silently
 * lost its padding and borders and rendered as raw text.
 *
 * So the reset is scoped with `:where(.tracker-root)`, which contributes ZERO specificity: the rule
 * stays (0,0,1) exactly as Tailwind intended, still can't escape the wrapper, and any class-based
 * rule — HH's or the tracker's — outranks it just like it would unscoped.
 *
 * Component rules (anything with a class/id) keep the plain `.tracker-root ` prefix: there the added
 * specificity is WANTED, because it's what makes `.tracker-root .btn` win over HH's own `.btn`
 * inside the tracker (they collide on 5 class names).
 */
const isElementOnlySelector = (s) => !/[.#]/.test(s);

const plugin = prefixer({
  prefix: SCOPE,
  transform(prefix, selector, prefixedSelector) {
    const s = selector.trim();
    const zeroSpec = `:where(${prefix})`;
    if (DOC_SELECTORS.has(s)) return zeroSpec;
    // Preflight targets `*`, `::before`, `::after` and `::backdrop` at the top level.
    if (s === '*' || s === '::before' || s === '::after' || s === '::backdrop') return `${zeroSpec} ${s}`;
    // Never scope keyframe steps (`from`, `to`, `0%`) — postcss-prefix-selector skips @keyframes
    // itself, but guard anyway.
    if (/^\d+%$/.test(s) || s === 'from' || s === 'to') return s;
    // The reset (element selectors: button, h1, ul, [type='text'] …) must not gain specificity.
    if (isElementOnlySelector(s)) return `${zeroSpec} ${s}`;
    return prefixedSelector;
  },
});

/*
 * The bundle is index.css + hh-compat.css, in that order:
 *  - index.css     — the component styles (and the @tailwind directives, which must come first).
 *  - hh-compat.css — the variable DICTIONARY (--accent → var(--app-accent), …). Without it the
 *                    tracker's components inside HH would resolve every colour to nothing. Its
 *                    `:root` selector becomes `.tracker-root`, which is exactly right: the wrapper
 *                    defines the vocabulary and it cascades to everything inside.
 *
 * NOT included, because Heroes Heaven already provides them globally:
 *  - @hh/theme/tokens.css (the --app-* values these map onto)
 *  - the Tabler icon webfont
 *  - hh-chrome.css (vendored copies of HH's OWN chrome rules — HH has the originals)
 */
const src = [
  readFileSync(join(ROOT, 'src/index.css'), 'utf8'),
  readFileSync(join(ROOT, 'src/hh-compat.css'), 'utf8'),
].join('\n');

const result = await postcss([
  tailwindcss({ config: join(ROOT, 'tailwind.config.js') }),
  autoprefixer,
  plugin,
]).process(src, { from: join(ROOT, 'src/index.css'), to: join(ROOT, 'dist-css/tracker.scoped.css') });

mkdirSync(join(ROOT, 'dist-css'), { recursive: true });
const header = `/* GENERATED by scripts/build-scoped-css.mjs — do not edit.
 * Every selector is scoped under ${SCOPE} so this file cannot touch Heroes Heaven's own styles.
 * Regenerate with: npm run build:css
 */\n`;
writeFileSync(join(ROOT, 'dist-css/tracker.scoped.css'), header + result.css);

console.log('wrote dist-css/tracker.scoped.css —', (header + result.css).length, 'bytes');
