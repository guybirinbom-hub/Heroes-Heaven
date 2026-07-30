/*
 * Repairs "Roll an check" — the importer stripped the LABEL out of Archives-of-Nethys skill links.
 *
 * AoN prints "Roll an [Athletics](/Skills.aspx?ID=3) check against your target's Fortitude DC". The
 * import removed the whole `[…](…)` construct instead of keeping its text, so 229 records tell the
 * player to roll a check and never say which one. Found while encoding ruling D: Explosive Death Drop
 * had no readable skill, which is why it could not be classified from our own data.
 *
 * The pristine AoN mirror is the oracle. For each broken record it supplies the label that belongs in
 * the gap; nothing is guessed, and a record whose mirror copy is missing or does not match is left
 * untouched and reported.
 *
 * Usage: node scripts/fix-stripped-skill-names.mjs [--dry]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));

// The gap the strip leaves: "Roll an check", "attempt a  check", "Roll a check to …".
const GAP = /\b((?:Roll|roll|attempt|Attempt|make|Make)\s+an?)\s+(checks?\b)/g;

/** Every mirror file, indexed by the record NAME — our ids do not match AoN's numeric filenames. */
function buildMirrorIndex(categories) {
  const byName = new Map();
  for (const cat of categories) {
    const dir = path.join(MIRROR, cat);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
        const s = j._source ?? j;
        if (s?.name) byName.set(`${cat}|${String(s.name).toLowerCase()}`, s);
      } catch { /* a malformed mirror file is not a reason to stop */ }
    }
  }
  return byName;
}

const BUCKET_CAT = { feats: 'feat', items: 'equipment', spells: 'spell', actions: 'action', classFeatures: 'class-feature' };
const mirror = buildMirrorIndex([...new Set(Object.values(BUCKET_CAT))]);
console.log(`mirror indexed: ${mirror.size} records`);

let fixed = 0;
let unmatched = [];
const changed = [];

for (const [bucket, cat] of Object.entries(BUCKET_CAT)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    const desc = String(rec.description ?? '');
    if (!GAP.test(desc)) { GAP.lastIndex = 0; continue; }
    GAP.lastIndex = 0;

    const src = mirror.get(`${cat}|${String(rec.name ?? '').toLowerCase()}`);
    // AoN ships both: `markdown` keeps the links, `text` is the same prose with the label already
    // flattened. `text` is what we want — the label without having to parse a link out of it.
    const aon = String(src?.text ?? '');
    if (!aon) { unmatched.push(`${bucket}/${id} (no mirror copy)`); continue; }

    // ANCHORED BY CONTEXT, not by counting.
    //
    // Substituting the Nth label into the Nth gap looked reasonable and was wrong: `grease` has two
    // "attempt a … check" phrases, and AoN names a skill only in the SECOND ("attempt an Acrobatics
    // check or Reflex save"). Counting put Acrobatics into the first — a sentence the rules
    // deliberately leave open — and produced "doesn't have to attempt a Acrobatics check or save".
    //
    // So each gap is matched to AoN by the words immediately before it. A gap whose surrounding
    // sentence AoN also leaves blank is left exactly as it is.
    const KEY_LEN = 34;
    const norm = (s) => s.replace(/[^a-z0-9]+/gi, '').toLowerCase();
    const beforeKey = (s) => norm(s).slice(-KEY_LEN);
    const afterKey = (s) => norm(s).slice(0, KEY_LEN);
    const aonNamed = [...aon.matchAll(/\b(?:Roll|roll|attempt|Attempt|make|Make)\s+an?\s+((?:DC\s+\d+\s+)?[A-Za-z][A-Za-z' -]{2,28}?)\s+(checks?)\b/g)]
      // The label has to name something the game actually rolls, not prose that merely reads like it.
      .filter((m) => /^(?:DC \d+ )?[A-Z][a-z]+(?: [A-Z][a-z]+)*(?: Lore)?$/.test(m[1].trim()))
      .map((m) => ({
        label: m[1].trim(),
        before: beforeKey(aon.slice(Math.max(0, m.index - 90), m.index)),
        after: afterKey(aon.slice(m.index + m[0].length, m.index + m[0].length + 90)),
      }));
    if (!aonNamed.length) { unmatched.push(`${bucket}/${id} (mirror names no skill either)`); continue; }

    const used = new Set();
    let hits = 0;
    const overlap = (a, b) => !!a && !!b && (a === b || a.endsWith(b) || b.endsWith(a) || a.startsWith(b) || b.startsWith(a));
    const next = desc.replace(GAP, (whole, verb, noun, offset) => {
      // Anchored on the words BEFORE the gap, and failing that the words AFTER it. The remaster
      // rewrote some sentences around the check, so the two texts agree on only one side —
      // `web` matches on "or Reflex save against your spell DC", `the-owl` on "to determine the result".
      const before = beforeKey(desc.slice(Math.max(0, offset - 90), offset));
      const after = afterKey(desc.slice(offset + whole.length, offset + whole.length + 90));
      let at = aonNamed.findIndex((x, k) => !used.has(k) && overlap(x.before, before));
      if (at < 0) at = aonNamed.findIndex((x, k) => !used.has(k) && overlap(x.after, after));
      if (at < 0) return whole; // AoN leaves this one open too — it is not a defect
      used.add(at);
      hits++;
      // "an Athletics" but "a Religion", and "a DC 15 …" because the article agrees with "DC".
      const label = aonNamed[at].label;
      const article = /^[AEIOU]/.test(label) ? 'an' : 'a';
      return `${verb.replace(/\ban?$/i, article)} ${label} ${noun}`;
    });
    if (!hits) { unmatched.push(`${bucket}/${id} (AoN leaves the same phrases open)`); continue; }
    rec.description = next;
    changed.push(`${bucket}/${id}: ${[...used].map((k) => aonNamed[k].label).join(', ')}`);
    fixed++;
  }
}

// ---- grammar pass: the article before a named check ----
// Separate from the repair above and applied to EVERY description, because this shape also occurs
// upstream: AoN's own Spelunker text reads "a success on an Survival check". One wrong word, visible
// to the player, and the rule that fixes it is not a judgement call.
const SKILL_WORDS = new Set([
  'Acrobatics', 'Arcana', 'Athletics', 'Crafting', 'Deception', 'Diplomacy', 'Intimidation',
  'Medicine', 'Nature', 'Occultism', 'Performance', 'Religion', 'Society', 'Stealth', 'Survival',
  'Thievery', 'Perception', 'Lore',
]);
let articles = 0;
for (const bucket of Object.keys(BUCKET_CAT)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    const before = String(rec.description ?? '');
    if (!before) continue;
    const after = before.replace(/\b(a|an)(\s+)([A-Z][A-Za-z']*)(\s+checks?\b)/g, (whole, art, sp, word, tail) => {
      if (!SKILL_WORDS.has(word)) return whole;
      const want = /^[AEIOU]/.test(word) ? 'an' : 'a';
      return art === want ? whole : `${want}${sp}${word}${tail}`;
    });
    if (after !== before) {
      rec.description = after;
      if (!changed.some((c) => c.startsWith(`${bucket}/${id}:`))) changed.push(`${bucket}/${id}: article`);
      articles++;
    }
  }
}
if (articles) console.log(`\narticles : ${articles} descriptions had "a"/"an" corrected before a skill name`);

console.log(`\nrepaired : ${fixed} records`);
for (const c of changed.slice(0, 20)) console.log('   ' + c);
if (changed.length > 20) console.log(`   … ${changed.length - 20} more`);
if (unmatched.length) {
  console.log(`\nleft alone: ${unmatched.length} (the mirror could not supply the label)`);
  for (const u of unmatched.slice(0, 15)) console.log('   ' + u);
  if (unmatched.length > 15) console.log(`   … ${unmatched.length - 15} more`);
}

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(path.join(ROOT, 'public/core.json'), JSON.stringify(core));

// The overlay is the only thing that survives `npm run data`, so each repaired description is
// recorded there too — otherwise the next import puts "Roll an check" straight back.
const OVERLAY = path.join(ROOT, 'scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let added = 0;
let updated = 0;
for (const line of changed) {
  const [bucket, id] = line.split(':')[0].split('/');
  const value = core[bucket][id].description;
  const matches = overlay.filter((x) => x.category === bucket && x.id === id && x.field === 'description');
  if (matches.length) { for (const m of matches) m.value = value; updated++; }
  else { overlay.push({ category: bucket, id, field: 'description', value }); added++; }
}
writeFileSync(OVERLAY, JSON.stringify(overlay, null, 2) + '\n');
console.log(`\noverlay  : ${added} added, ${updated} updated — the repairs survive a re-import`);
console.log('written  : public/core.json, scripts/data/effect-backfill.json');
