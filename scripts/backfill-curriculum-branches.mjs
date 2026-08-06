/*
 * The two curricula that depend on a SECOND choice inside the school.
 *
 * School of Rooted Wisdom adds one of five secondary branches; School of Thassilonian Rune Magic
 * studies one of the seven sins. Both live in `public/ast/sidebar.json` rather than on the school's
 * own record — `branch-curriculums` and `sin-curriculums` — and the Thassilonian school's own trunk
 * is in `arcaneSchool.json` under a key the class data does not name.
 *
 * Each section is `[title] <name> … prose … "Additional Curriculum"|"Sin Spells" … cantrips: … 1st: …`.
 * The prose contains spell links too (Envy's flavour mentions Cutting Eye and Harm), so the list is
 * only read AFTER the sub-heading — otherwise flavour becomes curriculum.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const db = JSON.parse(readFileSync(ROOT + 'public/core.json', 'utf8'));
const sidebar = JSON.parse(readFileSync(ROOT + 'public/ast/sidebar.json', 'utf8'));
const arcane = JSON.parse(readFileSync(ROOT + 'public/ast/arcaneSchool.json', 'utf8'));
const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

/** Flatten to an ordered stream of {title} | {text} | {ref}. */
/** All text inside a node, joined — used to read a heading whole. */
function textOf(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.t === 'text') return String(node.v ?? '');
  return (node.c ?? []).map(textOf).join('');
}

function atoms(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  // Capture the heading's OWN text. Guessing the name from the runs that follow it cannot work: a
  // branch name arrives split ("Tempest" / "-" / "Sun" / " Mages") while a sin's prose starts with a
  // run just as short (" The "), so any length rule either truncates one or swallows the other.
  if (node.t === 'title') out.push({ title: true, name: textOf(node).trim() });
  if (node.t === 'text') out.push({ text: String(node.v ?? '') });
  if (node.t === 'link' && typeof node.ref === 'string' && node.ref.startsWith('spells:')) {
    out.push({ ref: node.ref.slice('spells:'.length) });
    return out;
  }
  for (const c of node.c ?? []) atoms(c, out);
  return out;
}

const RANK = /(cantrips?|(\d+)(?:st|nd|rd|th))\s*:/gi;

/** Read a rank-labelled spell list out of a stretch of atoms. */
function ranksFrom(stream) {
  const out = {};
  let rank = null;
  let buf = '';
  for (const a of stream) {
    if (a.ref) {
      if (rank != null) (out[rank] ??= []).push(a.ref);
      continue;
    }
    buf += a.text ?? '';
    let m;
    let last = null;
    RANK.lastIndex = 0;
    while ((m = RANK.exec(buf))) last = m;
    if (last) {
      rank = last[2] ? Number(last[2]) : 0;
      buf = '';
    }
    if (buf.length > 40) buf = buf.slice(-40);
  }
  return Object.keys(out).length ? out : null;
}

/** Split a sidebar doc into { sectionName: ranks } — the list starts only after `heading`. */
function sections(doc, heading) {
  const flat = atoms(doc);
  const out = {};
  // Section boundaries are title nodes; the name is the text run immediately after one.
  const bounds = [];
  for (let i = 0; i < flat.length; i++) if (flat[i].title) bounds.push(i);
  for (let b = 0; b < bounds.length; b++) {
    const start = bounds[b];
    const end = b + 1 < bounds.length ? bounds[b + 1] : flat.length;
    const name = flat[start].name ?? '';
    if (!name) continue;
    // Find the sub-heading, and read only what follows it.
    let listAt = -1;
    let buf = '';
    for (let i = start; i < end; i++) {
      buf = (buf + (flat[i].text ?? '')).slice(-40);
      if (new RegExp(heading, 'i').test(buf)) {
        listAt = i;
        break;
      }
    }
    if (listAt < 0) continue;
    const ranks = ranksFrom(flat.slice(listAt + 1, end));
    if (ranks) out[name] = ranks;
  }
  return out;
}

const slug = (s) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const put = (id, field, value) => {
  const i = rows.findIndex((r) => r.category === 'classFeatures' && r.id === id && r.field === field && !r.path);
  const row = { category: 'classFeatures', id, field, value };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
};

let unresolved = 0;
const check = (label, map) => {
  for (const [, ranks] of Object.entries(map))
    for (const ids of Object.values(ranks))
      for (const id of ids)
        if (!db.spells[id]) {
          console.error(`  ${label}: spell "${id}" does not exist`);
          unresolved++;
        }
};

/* ---- Rooted Wisdom's five secondary branches ---------------------------------------------------- */
const branches = sections(sidebar['branch-curriculums'], 'additional\\s+curriculum');
if (Object.keys(branches).length !== 5) fail(`expected 5 Rooted Wisdom branches, parsed ${Object.keys(branches).length}`);
check('branch', branches);

/* ---- the seven sins ----------------------------------------------------------------------------- */
const sins = sections(sidebar['sin-curriculums'], 'sin\\s+spells');
if (Object.keys(sins).length !== 7) fail(`expected 7 sins, parsed ${Object.keys(sins).length}: ${Object.keys(sins).join(', ')}`);
check('sin', sins);

/* ---- the Thassilonian trunk, which ships under a key the class data does not name ---------------- */
const thassilonianDoc = arcane['school-of-thassilonian-rune-magic'];
if (!thassilonianDoc) fail('no arcaneSchool ast for school-of-thassilonian-rune-magic');
const tFlat = atoms(thassilonianDoc);
let tStart = -1;
{
  let buf = '';
  for (let i = 0; i < tFlat.length; i++) {
    buf = (buf + (tFlat[i].text ?? '')).slice(-40);
    if (/curriculum/i.test(buf) && tFlat.slice(i, i + 30).some((a) => a.ref)) {
      tStart = i;
      break;
    }
  }
}
const trunk = tStart >= 0 ? ranksFrom(tFlat.slice(tStart + 1)) : null;
if (!trunk) fail('could not parse the Thassilonian trunk curriculum');
check('thassilonian', { trunk });

if (unresolved) fail(`${unresolved} curriculum spells do not resolve in core.json`);

/* ---- write --------------------------------------------------------------------------------------- */
const bySlug = (m) => Object.fromEntries(Object.entries(m).map(([name, ranks]) => [slug(name), ranks]));

put('school-of-rooted-wisdom', 'curriculumBranches', bySlug(branches));
put('school-of-rooted-wisdom', 'choice', {
  flag: 'rootedBranch',
  prompt: 'Your secondary branch — it adds its own curriculum spells',
  kind: 'array',
  options: Object.keys(branches).map((n) => ({ value: slug(n), label: n })),
});

// The subclass option a player actually picks is `runelord`; school-of-thassilonian-rune-magic is
// the page the rules text lives on and is not in the wizard's option list at all, so data written
// there is never read.
put('runelord', 'curriculum', trunk);
put('runelord', 'curriculumBranches', bySlug(sins));
put('runelord', 'choice', {
  flag: 'thassilonianSin',
  prompt: 'Your sin — it adds its own curriculum spells',
  kind: 'array',
  options: Object.keys(sins).map((n) => ({ value: slug(n), label: n })),
});

writeFileSync(BF, JSON.stringify(rows, null, 2) + '\n');
const count = (m) => Object.values(m).reduce((n, r) => n + Object.values(r).reduce((k, a) => k + a.length, 0), 0);
console.log(`Rooted Wisdom: ${Object.keys(branches).length} branches, ${count(branches)} spells — ${Object.keys(branches).join(', ')}`);
console.log(`Thassilonian:  ${Object.keys(sins).length} sins, ${count(sins)} spells — ${Object.keys(sins).join(', ')}`);
console.log(`Thassilonian trunk: ${Object.values(trunk).reduce((n, a) => n + a.length, 0)} spells across ranks ${Object.keys(trunk).join(',')}`);
