/*
 * Drops the shouted "YOUR COMPANION" prefix from companion-gear notes.
 *
 * The extraction wrote it to make clear whose sheet the bonus belonged to, at a time when there was
 * nowhere for a companion bonus to go. Ruling ★ answered that ("A companion item's bonus marks the
 * COMPANION's stat block"), and the surface now exists — the note renders inside a block headed
 * "Situational · from its own gear", on the companion. Shouting whose it is there is redundant, and
 * capitals in the middle of a sentence read as an error.
 *
 * Usage: node scripts/tidy-companion-notes.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const REGISTRY = path.join(path.resolve(import.meta.dirname, '..'), 'src/rules/situationalBonuses.ts');
let src = readFileSync(REGISTRY, 'utf8');

const changed = [];
src = src.replace(/when: "((?:[^"\\]|\\.)*)"/g, (whole, body) => {
  // "YOUR ANIMAL COMPANION wearing the barding, against …" → "while wearing the barding, against …"
  // "YOUR COMPANION's Speeds, until …"                     → "its Speeds, until …"
  let next = body
    .replace(/^YOUR (?:ANIMAL )?COMPANION'?s?\s+/, (m) => (m.includes("'") ? 'its ' : ''))
    .replace(/^YOUR (?:ANIMAL )?COMPANION,?\s*/, '');
  if (next === body) return whole;
  next = next.charAt(0).toLowerCase() + next.slice(1);
  // "wearing the barding" on its own is a state, not a trigger — say so.
  if (/^wearing\b/.test(next)) next = `while ${next}`;
  changed.push([body, next]);
  return `when: "${next.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
});

console.log(`${changed.length} companion notes tidied:`);
for (const [a, b] of changed) console.log(`   was: ${a}\n   now: ${b}`);
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(REGISTRY, src);
console.log('\nwritten: src/rules/situationalBonuses.ts');
