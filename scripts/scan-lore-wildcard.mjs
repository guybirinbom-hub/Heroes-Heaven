/*
 * THE LORE WILDCARD SCAN — "a rule about ONE Lore, authored as EVERY Lore".
 *
 * `targetMatches` (src/rules/situationalBonuses.ts, the `case 'skill'` arm) reads a target of bare
 * `lore` — or `lore:*` — as EVERY `lore:*` row the character owns. That is correct for "a Lore skill
 * you're trained in" and WRONG for "an Alghollthu Lore check", which reaches exactly one row. Authored
 * the wildcard way, the second shape paints a star on Warfare Lore, Sea Shanties Lore and anything
 * else the player has typed, promising a rule that can never fire there.
 *
 * The shape recurs because both readings are spelled the same way in the registry. The batch-001 audit
 * named ONE record (`ancestral-insight`); this scan found THREE, the other two in records nobody had
 * audited (`golden-league-xun-dedication`, `wandering-chef-dedication`).
 *
 * A row is a DEFECT when its target is the wildcard AND its own `when` text names a specific Lore —
 * "<Capitalised Subject> Lore". A wildcard whose `when` says "a Lore you're trained in", or names no
 * subject at all, is correct and is reported separately as OK.
 *
 * Sources scanned:
 *   • `degreeShifts.skills` on every record in public/core.json (the structured lane)
 *   • FEAT_SITUATIONAL / CHOICE_SITUATIONAL targets in src/rules/situationalBonuses.ts (the registry)
 *
 * Run: node scripts/scan-lore-wildcard.mjs [--json]     (npm run scan:lore-wildcard)
 * Guarded by test/authoring-guards.test.ts, which fails at one.
 */
import { readFileSync } from 'node:fs';

/** A wildcard Lore target: the whole bucket rather than one subject. */
const isWildcard = (s) => s === 'lore' || s === 'lore:*';

/**
 * Does this trigger text name a SPECIFIC Lore?
 *
 * "<Capitalised Subject> Lore" — "Alghollthu Lore", "Underworld Lore", "Sea Shanties Lore". The
 * capital is what separates it from the generic uses, which are always lower-case before the word:
 * "a Lore you're trained in", "a Lore subcategory", "using Lore to Earn Income".
 *
 * ⚠ Articles and sentence-openers are excluded, or "The Lore" and "When Lore" would read as subjects.
 */
const STOP = new Set(['A', 'An', 'The', 'Your', 'Any', 'Some', 'One', 'Each', 'Every', 'This', 'That',
  'Lore', 'And', 'Or', 'If', 'When', 'While', 'On', 'In', 'To', 'With', 'Using', 'Use', 'Two', 'Both']);
export function namedLore(text) {
  const out = [];
  const re = /\b([A-Z][A-Za-z']+)(?:\s+([A-Z][A-Za-z']+))?\s+Lore\b/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) {
    const head = m[2] ?? m[1];
    if (STOP.has(head)) continue;
    out.push(m[0]);
  }
  return out;
}

/*
 * EXEMPT — a wildcard whose text names a Lore only as an EXAMPLE, so the target really does vary.
 *
 * Keyed `<source>/<id>`, with the reason, because a silent regex carve-out is how the next one hides.
 * Measured against the sibling record carrying the same clause WITHOUT the parenthetical
 * (`wardrobe-stone-greater`), which the scan already classes correct: the two must agree.
 */
export const EXEMPT = {
  'FEAT_SITUATIONAL/wardrobe-stone-moderate':
    "the Lore genuinely varies with the outfit the stone is currently showing; \"Cooking Lore in a chef's outfit\" is the parenthetical EXAMPLE, and wardrobe-stone-greater carries the same clause without it",
};

export function scan() {
  const findings = [];
  const okWildcards = [];
  const exempted = [];
  const file = (row) => {
    const why = EXEMPT[`${row.source}/${row.id}`];
    if (why) exempted.push({ ...row, why });
    else if (row.named.length) findings.push(row);
    else okWildcards.push(row);
  };

  /* ---- 1. the structured lane: degreeShifts on core.json records ------------------------------- */
  const core = JSON.parse(readFileSync('public/core.json', 'utf8'));
  for (const [bucket, records] of Object.entries(core)) {
    if (!records || typeof records !== 'object') continue;
    for (const [id, rec] of Object.entries(records)) {
      const shifts = rec?.degreeShifts;
      if (!Array.isArray(shifts)) continue;
      for (const sh of shifts) {
        const wild = (sh.skills ?? []).filter(isWildcard);
        if (!wild.length) continue;
        file({ source: 'degreeShifts', bucket, id, when: sh.when, target: wild.join(','), named: namedLore(sh.when) });
      }
    }
  }

  /* ---- 2. the registry: FEAT_SITUATIONAL / CHOICE_SITUATIONAL ---------------------------------- */
  const lines = readFileSync('src/rules/situationalBonuses.ts', 'utf8').split(/\r?\n/);
  let map = null;
  for (let i = 0; i < lines.length; i++) {
    const dec = lines[i].match(/^export const (FEAT_SITUATIONAL|CHOICE_SITUATIONAL|RECORD_MARKERS)\b/);
    if (dec) { map = dec[1]; continue; }
    if (lines[i] === '};') { map = null; continue; }
    if (map !== 'FEAT_SITUATIONAL' && map !== 'CHOICE_SITUATIONAL') continue;
    const key = lines[i].match(/^\s*['"]?([A-Za-z0-9:_-]+)['"]?\s*:\s*\[/);
    if (!key) continue;
    // Split the line's entry objects so a record with several bonuses is read one bonus at a time —
    // otherwise a wildcard in bonus #1 gets paired with the `when` of bonus #2.
    for (const ent of lines[i].split(/\}, \{ targets/).map((s, n) => (n ? '{ targets' + s : s))) {
      const targets = [...ent.matchAll(/kind: 'skill', detail: '([^']+)'/g)].map((m) => m[1]);
      const wild = targets.filter(isWildcard);
      if (!wild.length) continue;
      const when = (ent.match(/when: "((?:[^"\\]|\\.)*)"/) ?? [])[1] ?? '';
      file({ source: map, bucket: 'registry', id: key[1], when, target: wild.join(','), named: namedLore(when) });
    }
  }

  return { findings, okWildcards, exempted };
}

const { findings, okWildcards, exempted } = scan();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ findings, okWildcards, exempted }, null, 1));
} else {
  console.log(`lore wildcards scanned: ${findings.length + okWildcards.length + exempted.length}`);
  console.log(`\nDEFECTS — a wildcard whose own text names ONE Lore (${findings.length}):`);
  for (const f of findings) console.log(`  ${f.source} ${f.bucket}/${f.id}  target="${f.target}"  names ${f.named.join(' + ')}\n      when: ${f.when}`);
  console.log(`\nEXEMPT — names a Lore only as an example (${exempted.length}):`);
  for (const f of exempted) console.log(`  ${f.source} ${f.bucket}/${f.id} — ${f.why}`);
  console.log(`\nCORRECT wildcards — no specific Lore in the trigger (${okWildcards.length}):`);
  for (const f of okWildcards) console.log(`  ${f.source} ${f.bucket}/${f.id}  target="${f.target}"  when: ${f.when}`);
}
