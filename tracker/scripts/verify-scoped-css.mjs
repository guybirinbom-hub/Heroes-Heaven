/*
 * Proof that dist-css/tracker.scoped.css cannot touch Heroes Heaven.
 *
 * Walks the PARSED stylesheet (grep is useless here — Tailwind emits multi-line selector lists) and
 * asserts every single selector is confined to the .tracker-root subtree. If this passes, importing
 * the file into HH is safe by construction: no Preflight rule, and none of the 5 colliding class
 * names (btn/btn-primary/btn-danger/btn-ghost/chip), can reach anything outside the wrapper.
 *
 * Run: npm run verify:css   (also run by build:css)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postcss from 'postcss';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '../dist-css/tracker.scoped.css');
const SCOPE = '.tracker-root';

const root = postcss.parse(readFileSync(FILE, 'utf8'));
const escaped = [];
let checked = 0;

root.walkRules((rule) => {
  // Keyframe steps (from/to/50%) are scoped by their @keyframes name, not by selector.
  const parent = rule.parent;
  if (parent && parent.type === 'atrule' && /keyframes/.test(parent.name)) return;

  for (const sel of rule.selectors) {
    checked++;
    const s = sel.trim();
    // Two valid forms:
    //  `.tracker-root …`          — component rules (added specificity is wanted)
    //  `:where(.tracker-root) …`  — the reset (scoped, but contributes ZERO specificity, so it
    //                               can't out-rank the component styles of anything rendered
    //                               inside the wrapper — including Heroes Heaven's own).
    const ZERO = `:where(${SCOPE})`;
    if (s === SCOPE || s === ZERO) continue;
    const ok = (p) => s.startsWith(p + ' ') || s.startsWith(p + ':') || s.startsWith(p + '.') || s.startsWith(p + '[') || s.startsWith(p + ',');
    if (ok(SCOPE) || ok(ZERO)) continue;
    escaped.push(s);
  }
});

// @font-face / @keyframes are global by nature and carry no selectors — they're fine (a font-family
// name and an animation name, both namespaced by the tracker's own values).
const globalAtRules = [];
root.walkAtRules((r) => {
  if (['font-face', 'keyframes', '-webkit-keyframes'].includes(r.name)) globalAtRules.push('@' + r.name + ' ' + (r.params || ''));
});

console.log(`selectors checked : ${checked}`);
console.log(`global at-rules   : ${globalAtRules.length} (${[...new Set(globalAtRules)].join(', ') || 'none'})`);

if (escaped.length) {
  console.error(`\n✗ ${escaped.length} SELECTOR(S) ESCAPED ${SCOPE}:`);
  for (const s of [...new Set(escaped)].slice(0, 25)) console.error('   ' + s);
  process.exit(1);
}
console.log(`\n✓ every selector is confined to ${SCOPE} — safe to import into Heroes Heaven`);
