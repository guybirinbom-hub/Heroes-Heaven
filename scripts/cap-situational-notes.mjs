/*
 * Ruling H, applied to the WHOLE registry: "cap the note at about one line; anything longer gets
 * trimmed to its essential trigger, with the full text staying in the item's own description a click
 * away."
 *
 * The two apply scripts capped the rows they wrote. Everything authored before them did not, so ~30
 * entries still render a paragraph inside a list item. The click-to-open-the-full-text control is in
 * place now (StatDetailModal's "Full text"), which is what makes trimming safe rather than lossy.
 *
 * Usage: node scripts/cap-situational-notes.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const REGISTRY = path.join(path.resolve(import.meta.dirname, '..'), 'src/rules/situationalBonuses.ts');
let src = readFileSync(REGISTRY, 'utf8');

const CAP = 90;
/** Same rule the apply scripts use: parentheticals first, then a clause boundary, then a word break. */
function trim(full) {
  let s = full.replace(/\s*\([^()]*\)\s*/g, ' ').trim().replace(/\s+/g, ' ').replace(/[,;]$/, '');
  if (s.length > CAP) {
    const cut = s.slice(0, CAP);
    const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '), cut.lastIndexOf(' — '));
    s = (at > 40 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(' '))).trim();
  }
  return `${s}…`;
}

const changed = [];
// Every `when: "…"` in the file. The value never contains an unescaped quote (the writers escape
// them), so a non-greedy match to the next unescaped quote is exact.
src = src.replace(/when: "((?:[^"\\]|\\.)*)"/g, (whole, body) => {
  const full = body.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (full.length <= 120) return whole;
  const next = trim(full);
  changed.push([full, next]);
  return `when: "${next.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
});

console.log(`${changed.length} notes over one line, trimmed:`);
for (const [before, after] of changed.slice(0, 12)) {
  console.log(`  ${before.length} → ${after.length}`);
  console.log(`     was: ${before.slice(0, 130)}${before.length > 130 ? '…' : ''}`);
  console.log(`     now: ${after}`);
}
if (changed.length > 12) console.log(`  … ${changed.length - 12} more`);
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(REGISTRY, src);
console.log('\nwritten: src/rules/situationalBonuses.ts');
