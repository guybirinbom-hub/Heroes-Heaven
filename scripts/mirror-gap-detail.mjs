/**
 * IS THE "REAL GAP" REALLY A GAP? — per category, one level deeper.
 *
 * `mirror-gap-triage.mjs` removes the two big innocent explanations (a reprint whose remaster we
 * hold, a document with no text). What is left still is not automatically work, because AoN's
 * categories are not all catalogues of records:
 *
 *   `action` is the worst offender. 3,289 of its documents survive triage, and a glance at them shows
 *   what they are: "Interact", "command", "envision", "Cast a Spell", "(1 minute) command, envision,
 *   Interact". Those are not actions. They are AoN's index entries for the *Activate* line of an
 *   item — one fragment per item, named after its activation components. Importing them would put
 *   three thousand rows called "Interact" on the Actions tab.
 *
 * So this splits what survives into FRAGMENT and RECORD, and reports how much of each category's
 * apparent gap is really a gap. Written after the action list was eyeballed, because eyeballing is
 * how you learn the shape and counting is how you learn the size.
 *
 *   node scripts/mirror-gap-detail.mjs
 *   node scripts/mirror-gap-detail.mjs --category equipment --list
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

/** The vocabulary of an item's Activate line. A "name" made only of these is a fragment. */
const ACTIVATION_WORDS = new Set([
  'interact', 'command', 'envision', 'concentrate', 'cast a spell', 'strike', 'raise a shield',
  'manipulate', 'metamagic', 'spellshape', 'focus', 'exploration', 'downtime', 'free action',
  'reaction', 'single action', 'two actions', 'three actions',
]);
/**
 * "(1 minute) command, envision, Interact" / "10 minutes (command, Interact)" / "Interact (visual)"
 *
 * ⚠ The FIRST version of this missed every name carrying a parenthesised trait list — "Interact
 * (visual)", "envision (metamagic)", "command (magical, morph, transmutation)" — and so reported 489
 * genuinely-missing actions that were all noise. The parenthesis holds the item's TRAITS, which are
 * not part of a name; strip it before judging. Trailing junk after the components ("or 1 or more
 * days; see below", "varies") is the same fragment with prose glued on.
 *
 * Kept literal rather than clever: a name is a fragment when every word left after stripping is a
 * word off the Activate line. A regex over the raw string called "Ineteract" — AoN's own typo — a
 * real record.
 */
const isFragment = (name) => {
  let n = String(name).trim().toLowerCase();
  if (!n || n === '(unnamed)') return true;
  if (/^\(?\d+\s*(second|minute|hour|day|round|turn)s?\)?/.test(n)) return true;
  if (/^varies\b/.test(n)) return true;
  n = n.replace(/\([^)]*\)/g, ' '); // traits live in the parenthesis, not in the name
  n = n.replace(/;.*$/, '').replace(/\bor\s+\d+.*$/, '').replace(/\bsee below\b/, '');
  const words = n.split(/[,;]| and | or /).map((w) => w.trim()).filter(Boolean);
  if (!words.length) return true;
  const near = (w) => ACTIVATION_WORDS.has(w) || [...ACTIVATION_WORDS].some((a) => Math.abs(a.length - w.length) <= 2 && lev(a, w) <= 2);
  return words.every(near);
};
/** AoN has typos in this field ("Ineteract"). One edit-distance pass is enough and stays honest. */
function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return m[a.length][b.length];
}

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const held = new Set();
/**
 * ⚠ NAMES ARE HELD PER BUCKET, NOT GLOBALLY.
 *
 * This was one flat set of every name in core.json, so a mirror document counted as "we already
 * have it" whenever ANY record anywhere shared its name. That is how the Necromancer and Runesmith
 * CLASSES read as present: we hold a `trait` and an `archetype` called Necromancer, and the check
 * could not tell a class from a trait. Two playable classes were reported as held by a scan that had
 * matched them against a keyword.
 *
 * A name only counts inside the bucket the category actually feeds.
 */
const heldNamesByBucket = new Map();
for (const [bucket, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object') continue;
  const names = new Set();
  for (const rec of Object.values(records)) {
    if (rec?.aonId != null) held.add(String(rec.aonId));
    if (rec?.name) names.add(String(rec.name).toLowerCase().replace(/[^a-z0-9]+/g, ''));
  }
  heldNamesByBucket.set(bucket, names);
}
/**
 * AoN category -> the core.json bucket it feeds, READ FROM THE IMPORTER.
 *
 * ⚠ This was a hand-written map and it was wrong in a way that manufactured work. `siege-weapon`
 * fell through to a camel-cased guess of `siegeWeapon`; the real bucket is `siegeWeapons`, so the
 * check looked in a bucket that does not exist, found nothing, and reported all 23 siege weapons as
 * missing. Every one of them is in the app. The same guess misfiled several other categories.
 *
 * `scripts/import-core-v2.mjs` already declares the authoritative mapping in its `CAT_BUCKET`, and
 * that is the map that actually decides where a document lands. Parsing it means the scan cannot
 * disagree with the importer about where to look — the disagreement WAS the bug.
 */
const CAT_TO_BUCKET = (() => {
  const src = readFileSync(join(ROOT, 'scripts/import-core-v2.mjs'), 'utf8');
  const block = /const CAT_BUCKET = \{([\s\S]*?)\n\};/.exec(src);
  if (!block) throw new Error('could not read CAT_BUCKET from import-core-v2.mjs — fix the scan, do not guess');
  const map = {};
  for (const m of block[1].matchAll(/'?([a-zA-Z-]+)'?\s*:\s*'([a-zA-Z]+)'/g)) map[m[1]] = [m[2]];
  /* The importer folds several document categories into `items`; it expresses that elsewhere, so
   * these are added explicitly rather than guessed. */
  for (const c of ['equipment', 'weapon', 'armor', 'shield', 'relic']) map[c] = ['items'];
  map.ritual = ['spells'];
  return map;
})();
const nameHeldIn = (cat, name) => {
  const n = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const buckets = CAT_TO_BUCKET[cat] ?? [cat.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
  return buckets.some((b) => heldNamesByBucket.get(b)?.has(n));
};

/**
 * ⚠ DERIVED FROM THE MIRROR, NEVER HAND-WRITTEN.
 *
 * This was a literal list, and `class` was not on it. So the scan reported "0 genuinely missing"
 * while Necromancer and Runesmith — two complete, playable Pathfinder classes from Impossible
 * Magic — were absent from the app entirely, and I told the owner the data was complete on the
 * strength of it. The scan never failed; it was never asked.
 *
 * A hand-written scope makes "we looked at everything" unfalsifiable. Reading the categories off
 * the mirror means a category that appears later is scanned the first time it exists, and the only
 * way to omit one is to add it to the explicit skip list below, in the open, with a reason.
 */
const NOT_PLAYER_FACING = new Set([
  'creature', 'creature-family', 'hazard', 'sidebar', 'category-page', 'article', 'rules',
  'source', 'creature-ability', 'weather-hazard', 'warfare-army', 'warfare-tactic', 'plane',
  'campaign-setting', 'npc', 'vehicle-piloting-check', 'skill-general-action', 'class-sample',
]);
const CATS = readdirSync(MIRROR)
  .filter((c) => !NOT_PLAYER_FACING.has(c))
  .sort();
const rows = [];
for (const cat of CATS) {
  const dir = join(MIRROR, cat);
  if (!existsSync(dir)) continue;
  const fragment = [], record = [], nameHeld = [];
  for (const fn of readdirSync(dir)) {
    if (!fn.endsWith('.json') || fn === '_index.json') continue;
    let doc;
    try { doc = JSON.parse(readFileSync(join(dir, fn), 'utf8')); } catch { continue; }
    const src = doc._source ?? doc;
    const id = String(src.id ?? doc.id ?? '');
    if (!id || held.has(id)) continue;
    const remasterIds = [].concat(src.remaster_id ?? []).map(String);
    if (remasterIds.some((r) => held.has(r))) continue;
    const text = String(src.text ?? src.markdown ?? '').trim();
    if (!text) continue;
    const entry = { aonId: id, name: src.name ?? '(unnamed)', level: src.level ?? null, source: [].concat(src.source ?? [])[0] ?? null, chars: text.length };
    if (isFragment(entry.name)) { fragment.push(entry); continue; }
    /* We may hold the same record under a DIFFERENT aonId — a reprint AoN did not cross-link, or an
     * id the importer rewrote. A name we already carry is not a missing record. */
    if (nameHeldIn(cat, entry.name)) { nameHeld.push(entry); continue; }
    record.push(entry);
  }
  rows.push({ category: cat, fragment: fragment.length, nameHeld: nameHeld.length, record, records: record.length });
}

rows.sort((a, b) => b.records - a.records);
console.log(`${'category'.padEnd(18)} ${'fragments'.padStart(10)} ${'name already held'.padStart(18)} ${'GENUINELY MISSING'.padStart(18)}`);
for (const r of rows) console.log(`${r.category.padEnd(18)} ${String(r.fragment).padStart(10)} ${String(r.nameHeld).padStart(18)} ${String(r.records).padStart(18)}`);
console.log(`\n${'TOTAL'.padEnd(18)} ${String(rows.reduce((n, r) => n + r.fragment, 0)).padStart(10)} ${String(rows.reduce((n, r) => n + r.nameHeld, 0)).padStart(18)} ${String(rows.reduce((n, r) => n + r.records, 0)).padStart(18)}`);

const bySource = {};
for (const r of rows) for (const m of r.record) bySource[m.source ?? '(none)'] = (bySource[m.source ?? '(none)'] ?? 0) + 1;
console.log(`\nGENUINELY MISSING by source book:`);
for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(n).padStart(5)}  ${s}`);

const only = arg('--category', null);
if (has('--list') && only) {
  const r = rows.find((x) => x.category === only);
  console.log(`\n--- ${only}: genuinely missing (${r?.records ?? 0}) ---`);
  for (const m of (r?.record ?? []).slice(0, 50)) console.log(`  ${m.aonId.padEnd(14)} lvl ${String(m.level ?? '?').padStart(2)}  ${String(m.name).slice(0, 46).padEnd(46)} ${m.source ?? ''}`);
}
const dest = arg('--out', null);
if (dest) { writeFileSync(join(ROOT, dest), JSON.stringify(rows, null, 1)); console.log(`\n-> ${dest}`); }
