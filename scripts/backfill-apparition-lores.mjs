/*
 * Every animist apparition prints an "Apparition Skills" line — two named Lores — and not one of them
 * reached a character sheet. `SubclassOption.grants` accepted `skills: SkillId[]`, and a Lore is not
 * a SkillId, so the line was inexpressible rather than merely unwritten.
 *
 * The pairs below are READ from the AoN mirror (by-category/apparition), not typed from the app's own
 * descriptions — the app text is what we are checking, so using it as the source would only prove it
 * matches itself. Anything the mirror does not confirm is not written.
 *
 * Rule (Apparition Attunement, War of Immortals pg. 10): "Your attuned apparitions each grant you
 * knowledge in the form of Lore skills" — EACH attuned one, not just the primary.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/apparition';
const BACKFILL = 'scripts/data/effect-backfill.json';
const CORE = 'public/core.json';

if (!existsSync(MIRROR)) {
  console.error(`No AoN mirror at ${MIRROR} — refusing to write Lore lists from memory.`);
  process.exit(1);
}

/** name → ['farming', 'herbalism'], straight out of the mirror. */
const fromMirror = new Map();
for (const f of readdirSync(MIRROR)) {
  let j;
  try {
    j = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
  } catch {
    continue;
  }
  for (const r of Array.isArray(j) ? j : [j]) {
    const text = String(r.text ?? r.markdown ?? '').replace(/\s+/g, ' ');
    const m = text.match(/Apparition Skills\s*(.+?)\s*Apparition Spells/i);
    if (!m || !r.name) continue;
    const lores = m[1]
      .split(',')
      .map((s) => s.trim().replace(/\s*Lore$/i, ''))
      .filter(Boolean)
      .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    if (lores.length) fromMirror.set(r.name, lores);
  }
}
console.log(`[apparitions] ${fromMirror.size} apparitions read from the mirror`);

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const group = (core.classes.animist?.extraChoices ?? []).find((g) => g.id === 'apparition');
if (!group) {
  console.error('The animist has no `apparition` choice group — nothing to patch.');
  process.exit(1);
}

const fixes = [];
const missing = [];
for (const opt of group.options ?? []) {
  const lores = fromMirror.get(opt.name);
  if (!lores) {
    missing.push(opt.name);
    continue;
  }
  fixes.push({
    category: 'classes',
    id: 'animist',
    path: ['extraChoices', 'id=apparition', 'options', `id=${opt.id}`],
    field: 'grants',
    value: { ...(opt.grants ?? {}), lores },
  });
}

if (missing.length) console.warn(`[apparitions] no mirror entry for: ${missing.join(', ')} — left alone`);

const unused = [...fromMirror.keys()].filter((n) => !(group.options ?? []).some((o) => o.name === n));
if (unused.length) console.log(`[apparitions] the mirror has ${unused.length} the app does not ship: ${unused.join(', ')}`);

const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (f) => `${f.category}/${f.id}/${(f.path ?? []).join('/')}/${f.field}`;
const seen = new Set(fixes.map(key));
const kept = backfill.filter((f) => !seen.has(key(f)));
const next = [...kept, ...fixes];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`[apparitions] ${fixes.length} grants written (backfill ${backfill.length} → ${next.length})`);
