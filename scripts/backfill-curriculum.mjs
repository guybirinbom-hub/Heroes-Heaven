/*
 * Wizard curricula, parsed out of the AST buckets.
 *
 * The `**Curriculum**` block in each arcane school's DESCRIPTION is damaged: 21 of its 211 spell
 * entries are an empty slot before a comma, an AoN export defect. The AST tree for the same record is
 * not — its link nodes carry both the display text and a resolved `spells:<id>` target, so parsing
 * that instead yields every entry with nothing dropped.
 *
 * Writes `curriculum: { <rank>: [spellId, …] }` onto each arcane-school classFeature, so the wizard's
 * extra curriculum slot (and Sin Reservoir) can offer exactly the legal list rather than a sentence.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const db = JSON.parse(readFileSync(ROOT + 'public/core.json', 'utf8'));
const AST = ROOT + 'public/ast/arcaneSchool.json';
if (!existsSync(AST)) {
  console.error('REFUSED: public/ast/arcaneSchool.json is missing — run the importer first');
  process.exit(1);
}
const ast = JSON.parse(readFileSync(AST, 'utf8'));

/** Flatten a node subtree into an ordered stream of {text} and {ref} atoms. */
function atoms(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.t === 'text') out.push({ text: String(node.v ?? '') });
  if (node.t === 'link' && typeof node.ref === 'string' && node.ref.startsWith('spells:')) {
    out.push({ ref: node.ref.slice('spells:'.length), text: '' });
    return out; // do not descend: the link's own label would double-count as text
  }
  for (const c of node.c ?? []) atoms(c, out);
  return out;
}

/**
 * Rank labels are EMBEDDED in surrounding text rather than being atoms of their own — the stream reads
 * `{"text":"Cantrips"} {"text":": "} … {"text":" - 1st: "}`. An anchored match therefore finds only the
 * first label and files every spell in the document under it, so this scans within each text run and
 * keeps the LAST label seen (a single run can carry the end of one list and the start of the next).
 */
const RANK = /(cantrips?|(\d+)(?:st|nd|rd|th))\s*:/gi;

function curriculumOf(doc, school) {
  const flat = atoms(doc);
  // The block starts at "Curriculum" and ends at "School Spells" — the initial/advanced FOCUS pair,
  // which are not curriculum entries. That heading straddles two text runs in some schools, so it is
  // matched against a rolling buffer; and because a missed boundary silently files two focus spells
  // under the highest rank, the school's own focusSpells are excluded outright as well. Belt and
  // braces on purpose: this failed exactly that way first time, putting Force Bolt in 9th rank.
  // Both boundaries are HEADINGS and must be matched exactly. A loose `/curriculum/i` caught School
  // of Rooted Wisdom's prose ("Your curriculum is self-directed…") eleven atoms early, and the loose
  // end match then hit the phrase "…and school spells" in that same prose and cut the whole list off,
  // silently dropping the school. Exact first; the rolling buffer only as a fallback for a heading
  // genuinely split across two runs.
  const isHeading = (a, word) => (a.text ?? '').trim().toLowerCase() === word;
  let start = flat.findIndex((a) => isHeading(a, 'curriculum'));
  if (start < 0) start = flat.findIndex((a) => /curriculum/i.test(a.text ?? ''));
  if (start < 0) return null;
  let end = flat.findIndex((a, i) => i > start && isHeading(a, 'school spells'));
  if (end < 0) {
    end = flat.length;
    let buf = '';
    for (let i = start + 1; i < flat.length; i++) {
      buf = (buf + (flat[i].text ?? '')).slice(-40);
      if (/school\s+spells/i.test(buf)) {
        end = i;
        break;
      }
    }
  }
  const focus = new Set([...(school.focusSpells ?? []), ...(school.advancedFocusSpell ? [school.advancedFocusSpell] : [])]);
  const out = {};
  let rank = null;
  let buf = '';
  for (const a of flat.slice(start + 1, end)) {
    if (a.ref) {
      if (rank != null && !focus.has(a.ref)) (out[rank] ??= []).push(a.ref);
      continue;
    }
    // Labels can straddle two runs ("Cantrips" then ": "), so match against a rolling buffer.
    buf += a.text ?? '';
    let m, last = null;
    RANK.lastIndex = 0; // the /g flag makes exec stateful — reset or every other scan starts mid-string
    while ((m = RANK.exec(buf))) last = m;
    if (last) {
      rank = last[2] ? Number(last[2]) : 0;
      buf = '';
    }
    // Keep the buffer short: only a partial label at the tail can still matter.
    if (buf.length > 40) buf = buf.slice(-40);
  }
  return Object.keys(out).length ? out : null;
}

const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));
const put = (category, id, field, value) => {
  const i = rows.findIndex((r) => r.category === category && r.id === id && r.field === field && !r.path);
  const row = { category, id, field, value };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
};

const schools = db.classes?.wizard?.subclass?.options ?? [];
let done = 0;
let entries = 0;
let unresolved = 0;
const skipped = [];
for (const school of schools) {
  const doc = ast[school.id];
  if (!doc) {
    skipped.push(`${school.id} (no ast)`);
    continue;
  }
  const cur = curriculumOf(doc, school);
  if (!cur) {
    skipped.push(`${school.id} (no Curriculum block)`);
    continue;
  }
  for (const [, ids] of Object.entries(cur))
    for (const id of ids) {
      entries++;
      if (!db.spells[id]) unresolved++;
    }
  put('classFeatures', school.id, 'curriculum', cur);
  done++;
}

// A curriculum that names a spell the app does not ship would filter it out of its own slot.
if (unresolved) {
  console.error(`REFUSED: ${unresolved} of ${entries} curriculum spells do not resolve in core.json`);
  process.exit(1);
}
if (entries < 200) {
  console.error(`REFUSED: only ${entries} entries parsed — the block format has probably changed`);
  process.exit(1);
}

writeFileSync(BF, formatBackfill(rows));
console.log(`curricula written for ${done} of ${schools.length} schools — ${entries} spells, ${unresolved} unresolved`);
if (skipped.length) console.log(`no curriculum (expected for School of Unified Magical Theory, which prints none):\n  ${skipped.join('\n  ')}`);
