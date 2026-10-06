/*
 * THE SHARED-PAGE CENSUS — "is the page a popup draws the record's OWN page?" (docs/display-truth-plan.md
 * section 3, S2; docs/card-design.md section 8, NOT-OWN).
 *
 * Promoted from the refuters' scratch shared-page-census.mjs (its port of variantSection was checked
 * identical on 18,666 slugs) into scripts/lib/card-scope.mjs at card step 4, and moved here at card step 12
 * so the three readers share one copy: the card guard (scripts/lib/card-scope.mjs, S2-NOT-OWN), the
 * no-own-page list generator (scripts/not-own-page.mjs) and the slice-map generator (scripts/page-slices.mjs).
 * Here variantSection is the REAL one (src/sheet/astVisibility.ts, through jiti) unless a caller passes
 * another cut — the step-12 refuter runs the census once with the pre-F5 cut and once with the real one to
 * measure "−290, 0 right→wrong".
 *
 * The rule: among records whose tree shares its page (`url`) with another record of the bucket, the shown
 * tree (after the cut) is NOT the record's own when it is byte-identical to a differently named record's
 * (unless it has no section and no line that is another record's, and holds the record's text: RIGHT_SAME_TEXT),
 * or lacks the record's own text, or is a family / other record's page — unless every line of it is the
 * record's (its words, or its own printed Special line) and it has no section but the "leads to…" furniture:
 * the record's own page (RIGHT_OWN_PAGE).
 */
import {
  anchorOf, astSlug, bulletItems, cardFurnitureSectionEnd, isCardDimP, isCardFurnitureP, isCardFurnitureTitle, isMetaP,
  isMetaishBlock, isTitleNode, pageUnits, runAnchor, sectionEnd, sliceOf, variantSection, widerSectionRule,
} from '../../src/sheet/astVisibility.ts';

export const flatText = (n) => (n.t === 'text' ? n.v ?? '' : (n.c ?? []).map(flatText).join(''));
const isSection = (n) => n.t === 'title' && Number(n.level ?? 1) === 2;
export const flatTitle = (node) => {
  const t = (node.c ?? []).find((n) => n.t === 'title' && Number(n.level ?? 1) <= 1);
  return t ? flatText(t).replace(/\s+/g, ' ').trim() : '';
};
export const words = (s) => String(s ?? '').toLowerCase().replace(/\{@[a-z]+ ([^}|]+)(\|[^}]*)?\}/gi, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();
const lev = (a, b) => {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
};
const dedupeKey = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
/** A feat's printed "Special" line (foreignLines' flattened text): on the record's own page it is the
 *  record's, whatever its words. */
const OWN_SPECIAL = /^special\b/i;

/** The record's own description sentences (>= 6 words, glyphs and the "---" meta split dropped), as
 *  normalised word strings — the census's and the coverage gate's one sentence rule. */
export function ownSentences(description) {
  const dRaw = String(description ?? '').replace(/⟨[^⟩]*⟩/g, ' ').replace(/\n\s*---\s*\n/g, '\n');
  return dRaw.split(/(?<=[.!?])\s+|\n+/).map(words).filter((w) => w.split(' ').length >= 6);
}

/** Share of `sentences` found (word-normalised) in `text`; null when there are none to judge. */
export function sentenceCoverage(sentences, text) {
  if (!sentences.length) return null;
  const pageW = ' ' + words(text) + ' ';
  return sentences.filter((w) => pageW.includes(' ' + w + ' ') || pageW.includes(w)).length / sentences.length;
}

/**
 * slug → verdict for the WRONG (and UNDECIDED) records of one bucket. With `all: true`, every record of a
 * shared page gets a row `{verdict, cls, shownTitle, coverage}` (RIGHT ones included). `cut` defaults to
 * the real variantSection.
 */
export function sharedPageCensus(trees, recs, { cut = variantSection, all = false } = {}) {
  const out = {};
  const byUrl = new Map();
  for (const [slug, node] of Object.entries(trees)) {
    if (!node?.url) continue;
    if (!byUrl.has(node.url)) byUrl.set(node.url, []);
    byUrl.get(node.url).push(slug);
  }
  const shownOf = new Map();
  const byContent = new Map();
  for (const [slug, node] of Object.entries(trees)) {
    const shown = cut(node, slug);
    const key = JSON.stringify(shown);
    shownOf.set(slug, { shown, key, cut: shown !== node });
    if (!byContent.has(key)) byContent.set(key, new Set());
    byContent.get(key).add(dedupeKey(recs[slug]?.name ?? slug));
  }
  for (const slugs of byUrl.values()) {
    if (slugs.length < 2) continue;
    for (const slug of slugs) {
      const node = trees[slug];
      const rec = recs[slug];
      if (!rec?.name) continue;
      const { shown, key, cut: wasCut } = shownOf.get(slug);
      const shownTitle = flatTitle(shown);
      const nameSlug = astSlug(rec.name);
      const tSlug = astSlug(shownTitle);
      const bare = astSlug(rec.name.replace(/\s*\([^)]*\)\s*$/, ''));
      const qual = (rec.name.match(/\(([^)]*)\)\s*$/) ?? [])[1];
      const myKey = dedupeKey(rec.name);
      const digits = (x) => x.replace(/\D/g, '');
      const identicalOtherName = [...byContent.get(key)].some((k) => k !== myKey && (lev(k, myKey) > 2 || digits(k) !== digits(myKey)));
      const sectionByName = (node.c ?? []).some((n) => isSection(n) && astSlug(flatText(n)) === nameSlug);
      const dRaw = String(rec.description ?? '').replace(/⟨[^⟩]*⟩/g, ' ').replace(/\n\s*---\s*\n/g, '\n');
      const coverage = sentenceCoverage(ownSentences(rec.description), flatText(shown));
      const ownOn = coverage === null ? null : coverage >= 0.6;
      let cls;
      if (wasCut) cls = 'RIGHT_CUT';
      else if (tSlug === nameSlug) cls = 'RIGHT_TITLE';
      else if (sectionByName && (node.c ?? []).filter(isSection).length >= 2) cls = 'WRONG_MISSED';
      else if (lev(tSlug, nameSlug) <= 3 && ownOn !== false) cls = 'RIGHT_SPELLING';
      else if (identicalOtherName) cls = 'WRONG_SHARED';
      else if (tSlug === bare && ownOn !== false) cls = 'RIGHT_QUALIFIER';
      else if (tSlug === bare) cls = 'QUALIFIER_PARTIAL';
      else if (ownOn === false) cls = 'WRONG_OTHER';
      else cls = 'CHECK';
      const own = ownOn === null ? 'none' : ownOn ? 'present' : 'absent';
      const ownW = words(dRaw).split(' ').filter(Boolean).length;
      const bodyW = (shown.c ?? []).filter((n) => !(n.t === 'title' && Number(n.level ?? 1) <= 1) && n.t !== 'traits')
        .map((n) => words(flatText(n))).join(' ').replace(/^.*?\bsource\b.*?\bpg \d+/, '').split(' ').filter(Boolean).length;
      const ratio = ownW ? Math.round((bodyW / ownW) * 10) / 10 : null;
      const family = tSlug === bare || (!!qual && astSlug(qual) === tSlug) || (tSlug.length >= 4 && nameSlug.startsWith(tSlug + '-'));
      // A page byte-identical to a differently named record's (WRONG_SHARED) none of whose lines is another
      // record's (foreignLines empty) and that finds >= COVERAGE_GATE of the record's own sentences IS the
      // record's text too: Oil and Oil (1 pint) on equipment-2739, Ganjay Book and its two bulk variants on
      // equipment-859. It is right for both, and the whole page is kept (card step 12 fixer: these went to old
      // text with the no-page line). Only on a page with no level-2 section: a wand page's rank sections are
      // short stat lines that foreignLines never judges, and a wand rank must keep reading its own "(Nth-Rank
      // Spell)" section (route R0) — or, when the page prints no section of its rank (Wand of Refracting Rays
      // (7th-Rank) on a page of the 4th and 6th), its own text — never the whole page of the other ranks.
      const sameText = cls === 'WRONG_SHARED' && coverage !== null && coverage >= COVERAGE_GATE
        && !(shown.c ?? []).some(isSection) && !foreignLines(shown, rec.description).length;
      // The record's OWN page (card step 12 fixer, round 5): every line of the shown page is the record's —
      // its words (foreignLines judges each line against its text), or its own printed "Special" line, which
      // on its own page is the record's whatever its words (ownRun's rule; our older text often lacks it) —
      // it finds >= COVERAGE_GATE of the record's sentences, and it has no level-2 section but the card's
      // "leads to…" furniture. Knight Vigilant Dedication on feat-1092: the census called it
      // WRONG_FAMILY_OVERSHOW only because the url is shared with Knight Vigilant, and its slice dropped the
      // page's Prerequisites / Access / traits. The page is drawn whole: no slice, no not-own entry. A wand
      // page's rank sections still bar it (a wand rank never reads the other ranks' sections).
      const ownPage = !sameText && coverage !== null && coverage >= COVERAGE_GATE
        && !(shown.c ?? []).some((n) => isSection(n) && !isCardFurnitureTitle(n))
        && foreignLines(shown, rec.description).every((l) => OWN_SPECIAL.test(l));
      const verdict =
        cls.startsWith('RIGHT') ? 'RIGHT'
        : sameText ? 'RIGHT_SAME_TEXT'
        : ownPage ? 'RIGHT_OWN_PAGE'
        : cls === 'WRONG_MISSED' ? 'WRONG_FAMILY_PAGE_AON'
        : family && coverage !== null && coverage < 1 && ratio != null && ratio <= 1.6 ? 'WRONG_FAMILY_VARIANT_TEXT_ABSENT'
        : own === 'present' && ratio != null && ratio <= 1.6 ? 'RIGHT_SAME_TEXT'
        : own === 'present' ? (family ? 'WRONG_FAMILY_OVERSHOW' : 'WRONG_OTHER_OVERSHOW')
        : own === 'absent' ? (family ? 'WRONG_FAMILY_VARIANT_TEXT_ABSENT' : 'WRONG_OTHER_PAGE')
        : 'UNDECIDED';
      if (all) out[slug] = { verdict, cls, shownTitle, coverage };
      else if (!verdict.startsWith('RIGHT')) out[slug] = verdict;
    }
  }
  return out;
}

/**
 * F5 rule (c)'s family check, on the record's NAME (the hook only sees the slug): a record the looser key
 * cut by rule (c) must be named "<words> (<page title>)" or "<page title> (…)" (one or more trailing
 * qualifiers). Returns the slugs of a bucket whose cut came from rule (c) and whose name is neither —
 * 0 is the accepted state, and test/card-sections.test.tsx asserts it on every shipped bucket.
 */
export function ruleCWithoutQualifier(trees, recs) {
  const out = [];
  for (const [slug, node] of Object.entries(trees)) {
    const rec = recs?.[slug];
    if (!rec?.name || !node?.c) continue;
    if (node.c.some((n) => isSection(n) && astSlug(flatText(n)) === slug)) continue; // the exact key decided
    if (widerSectionRule(node, slug).rule !== 'c') continue;
    const page = astSlug(flatTitle(node));
    const qual = (rec.name.match(/\(([^)]*)\)\s*$/) ?? [])[1];
    const head = rec.name.replace(/(\s*\([^)]*\))+\s*$/, '');
    if (!((qual && astSlug(qual) === page) || astSlug(head) === page)) out.push(slug);
  }
  return out;
}

/** Every record of a bucket whose cut the looser keys decided, with the key: slug → 'a' | 'b' | 'c' | 'd'. */
export function widerCuts(trees) {
  const out = {};
  for (const [slug, node] of Object.entries(trees)) {
    if (!node?.c || node.c.some((n) => isSection(n) && astSlug(flatText(n)) === slug)) continue;
    const { rule } = widerSectionRule(node, slug);
    if (rule && variantSection(node, slug) !== node) out[slug] = rule;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* Card step 12 — F6 (not-own-page.json) and F6b (page-slices.json).                                  */
/* ------------------------------------------------------------------------------------------------ */

export const NOT_OWN_PAGE_FILE = 'src/data/not-own-page.json';
export const PAGE_SLICES_FILE = 'src/data/page-slices.json';
/** The share of a record's own sentences its fallback text must find in its Archives (mirror) section to
 *  join not-own-page.json, and a slice must find of the record's text to be its slice. */
export const COVERAGE_GATE = 0.6;

/** The S2 residue: every record (all buckets with records and pages) the census still calls not-own after
 *  the F5 cut — "bucket:slug" → verdict. */
export function censusResidue(content, trees) {
  const out = {};
  for (const b of Object.keys(trees).sort()) {
    if (!content[b] || typeof content[b] !== 'object') continue;
    for (const [slug, v] of Object.entries(sharedPageCensus(trees[b] ?? {}, content[b]))) out[`${b}:${slug}`] = v;
  }
  return out;
}

/** Mirror markdown → plain words input: the AoN tags (<title …>, <column>, …) and markdown dropped. */
export function mirrorPlain(markdown) {
  return String(markdown ?? '').replace(/<[^>]+>/g, ' ').replace(/\*\*|__|`/g, '');
}

/**
 * F6's split of the residue, given each record's mirror text (by its aonId): a record joins `ids` (no tree:
 * every popup falls back to its own description) when its description finds >= COVERAGE_GATE of its own
 * sentences in its mirror section; otherwise it stays on its page (`keptOnPage`, with the measured
 * coverage or null) and in the S2 baseline. `mirrorOf(rec)` returns the mirror text or undefined.
 */
export function splitResidue(residue, content, mirrorOf) {
  const ids = [];
  const keptOnPage = {};
  const coverage = {};
  for (const k of Object.keys(residue).sort()) {
    const at = k.indexOf(':');
    const rec = content[k.slice(0, at)]?.[k.slice(at + 1)];
    const text = rec ? mirrorOf(rec) : undefined;
    const c = text === undefined ? null : sentenceCoverage(ownSentences(rec.description), mirrorPlain(text));
    coverage[k] = c === null ? null : Math.round(c * 100) / 100;
    if (c !== null && c >= COVERAGE_GATE) ids.push(k);
    else keptOnPage[k] = coverage[k];
  }
  return { ids, keptOnPage, coverage };
}

/** The residue a slice does not cover: a record with a slice (src/data/page-slices.json) reads its slice,
 *  so it belongs in neither half of not-own-page.json. `slices` is the computed (or listed) slice map. */
export function residueWithoutSlices(residue, slices) {
  return Object.fromEntries(Object.entries(residue).filter(([k]) => !(k in (slices ?? {}))));
}

/** Two-way: the file's ids + keptOnPage must equal the residue (after slices: residueWithoutSlices), and no
 *  id may be both. Entries in the ledger's S2-NOT-OWN shape ("bucket:slug|PROBLEM"). */
export function notOwnPageProblems(file, residue) {
  const out = [];
  const ids = new Set(file?.ids ?? []);
  const kept = new Set(Object.keys(file?.keptOnPage ?? {}));
  for (const k of Object.keys(residue)) if (!ids.has(k) && !kept.has(k)) out.push(`${k}|NOT-OWN-UNLISTED`);
  for (const k of ids) {
    if (!(k in residue)) out.push(`${k}|NOT-OWN-STALE`);
    if (kept.has(k)) out.push(`${k}|NOT-OWN-BOTH`);
  }
  for (const k of kept) if (!(k in residue)) out.push(`${k}|NOT-OWN-STALE`);
  return out;
}

/** Official records with no page tree of their own: not app-authored (aonOrigin 'authored' marks modes,
 *  runes, stances …), and carrying a printed licence or an Archives link. */
export function officialNoPage(content, trees) {
  const out = [];
  for (const [b, recs] of Object.entries(content)) {
    if (!recs || typeof recs !== 'object' || Array.isArray(recs)) continue;
    for (const [id, r] of Object.entries(recs)) {
      if (!r || typeof r !== 'object' || !('name' in r) || trees[b]?.[id]) continue;
      if (r.aonOrigin === 'authored' || id.startsWith('hb-') || r.source?.license === 'homebrew') continue;
      if (r.source?.license === 'ORC' || r.source?.license === 'OGL' || r.aonParentId || r.aonId) out.push(`${b}:${id}`);
    }
  }
  return out.sort();
}

const BADGE = /\s*\((?:\d+(?:st|nd|rd|th)|level \d+)\)\s*$/i;
const anchorKey = (text) => astSlug(String(text).replace(BADGE, ''));
const STOP = new Set(['of', 'the']);
const wordsOf = (s) => astSlug(s).split('-').filter((w) => w && !STOP.has(w));

/** Does an anchor carry the record's name? Its words are the name's (any order, a level badge dropped),
 *  or the name followed by a qualifier ("Advanced Rangefinder (Ranged Only)"), or a label then the name
 *  ("Transcendence—Fleeting Arc through Heaven and Earth", "Activate—Adopt Persona"). */
function namesRecord(anchor, name, bare) {
  const k = anchorKey(anchor);
  const bag = (s) => wordsOf(s).sort().join(' ');
  return [name, bare].filter(Boolean).some((n) => {
    const nk = astSlug(n);
    return k === nk || k.startsWith(nk + '-') || k.endsWith('-' + nk) || bag(k) === bag(nk);
  });
}

/** Share of the record's description four-word runs found in `text` (null under four words). */
export function gramCoverage(description, text) {
  const w = words(String(description ?? '').replace(/⟨[^⟩]*⟩/g, ' ')).split(' ').filter(Boolean);
  if (w.length < 4) return null;
  const page = ' ' + words(text) + ' ';
  let hit = 0;
  let n = 0;
  for (let i = 0; i + 4 <= w.length; i++) { n++; if (page.includes(' ' + w.slice(i, i + 4).join(' ') + ' ')) hit++; }
  return hit / n;
}

/** Every anchor of a page: its level-1 title (the whole page), each top-level title / heading / bold-led
 *  paragraph, and each bold-led item of a top-level list. */
function pageAnchors(tree) {
  const out = [];
  (tree.c ?? []).forEach((n, i) => {
    // A paragraph holding a run-together list offers each bullet, never the whole run.
    const items = bulletItems(n);
    if (items.length) { for (const it of items) out.push({ path: [i], kind: 'item', text: it.text, seg: it.seg }); return; }
    const a = anchorOf(n);
    if (a) out.push({ path: [i], ...a });
    if (n.t === 'ul' || n.t === 'ol') (n.c ?? []).forEach((li, j) => { const b = anchorOf(li); if (b && b.kind === 'block') out.push({ path: [i, j], ...b }); });
  });
  return out;
}

/* ---------- where a slice ends: decided from the record's own text (card step 12, round 2) ----------
 *
 * The refuters measured slices that ran past their own entry (a feat's "Special You can't select another
 * dedication feat…" under the action it grants; the next activation, "Activate—Adopt Persona", under
 * Twist Design; four paragraphs of Cleric Spellcasting under Anathema) and slices that were another
 * record's whole page (the Energy Robe page with all four energies for Energy Robe of Acid). Section 13:
 * the card cuts the record's paragraph or section out of the bigger page — so where the cut ends is
 * decided here, where the record's text is known, and stored in the map as `n`; the screen only cuts.
 */

/** A line that belongs to the entry above it whatever its words: an action's own labelled lines. Every
 *  other line (plain prose, a "Special" or "Activate" line, a table) continues an entry only when its
 *  words are the record's (EVIDENCE). */
const STRONG_LEAD = /^(?:frequency|trigger|requirements?|effect|cost|duration|range|area|targets?|defense|saving throw|critical success|success|failure|critical failure|heightened|maximum duration|onset|stage \d+|cast)\b/i;
/** The share of a line's four-word runs that must be in the record's text for the line to be the record's. */
export const EVIDENCE = 0.3;

const flatSp = (n) => (n.t === 'text' ? n.v ?? '' : (n.c ?? []).map(flatSp).join(' '));
const padWords = (description) => ' ' + words(String(description ?? '').replace(/⟨[^⟩]*⟩/g, ' ')) + ' ';

/** Share of the four-word runs of `nodes` found in the record's text (`dPad`, padWords); null under four
 *  words (a glyph, a bare "Activate", a short heading — nothing to judge). */
export function nodeEvidence(nodes, dPad) {
  const w = words(nodes.map(flatSp).join(' ')).split(' ').filter(Boolean);
  if (w.length < 4) return null;
  let hit = 0;
  let n = 0;
  for (let i = 0; i + 4 <= w.length; i++) { n++; if (dPad.includes(' ' + w.slice(i, i + 4).join(' ') + ' ')) hit++; }
  return hit / n;
}

/** 'yes' (the record's), 'no' (another entry's), or 'maybe' (nothing to judge: kept only between two yes). */
function lineVerdict(n, dPad) {
  if (n.t === 'actions' || n.t === 'br' || n.t === 'traits') return 'maybe';
  const a = n.t === 'p' || n.t === 'li' ? anchorOf(n) : null;
  if (a && STRONG_LEAD.test(a.text)) return 'yes';
  const e = nodeEvidence([n], dPad);
  return e === null ? 'maybe' : e >= EVIDENCE ? 'yes' : 'no';
}

/** A bold-led paragraph's extent (nodes from the anchor on): the lines after it while each is the
 *  record's, up to a title, a rule or the first line that is not; unjudgeable lines count only between two
 *  of the record's lines. */
export function blockExtent(sib, i, description) {
  const d = padWords(description);
  let n = 1;
  let pending = 0;
  for (let j = i + 1; j < sib.length; j++) {
    const x = sib[j];
    if (isTitleNode(x) || x.t === 'hr') break;
    const v = lineVerdict(x, d);
    if (v === 'no') break;
    if (v === 'maybe') pending++;
    else { n += pending + 1; pending = 0; }
  }
  return n;
}

/** A section's extent (nodes kept after its title): to its structural end (sectionEnd), but the first
 *  lower-level subsection none of whose words are the record's ends it there (Anathema's section runs on
 *  through the class page's level-3 "Cleric Spellcasting"). */
export function sectionExtent(sib, i, description) {
  const d = padWords(description);
  const end = sectionEnd(sib, i);
  for (let j = i + 1; j < end; j++) {
    if (!isTitleNode(sib[j])) continue;
    let k = j + 1;
    while (k < end && !isTitleNode(sib[k])) k++;
    const e = nodeEvidence(sib.slice(j, k), d);
    if (e !== null && e < EVIDENCE) return j - i - 1;
  }
  return end - i - 1;
}

/** The lines of a whole page that are another record's: every line of four words or more (a list's items
 *  one by one; headings are not lines) whose words are not the record's (EVIDENCE) — the page's stat header, its Source / PFS
 *  Note / Access lines and the card's furniture (a "leads to…" section, a short "Click here…" line) left
 *  out. A whole page is a record's slice only when this is empty: the page IS the record's text (an action
 *  whose feat is the action, an instinct page). Returns the foreign lines' text. */
export function foreignLines(tree, description) {
  const d = padWords(description);
  const top = tree.c ?? [];
  const out = [];
  for (let i = 0; i < top.length; i++) {
    const n = top[i];
    if (isCardFurnitureTitle(n)) { i = cardFurnitureSectionEnd(top, i) - 1; continue; }
    if (isTitleNode(n) || ['traits', 'hr', 'actions', 'br'].includes(n.t)) continue; // a heading is judged by its lines
    if (isMetaP(n) || isMetaishBlock(n) || isCardFurnitureP(n, true) || isCardDimP(n)) continue;
    for (const x of n.t === 'ul' || n.t === 'ol' ? n.c ?? [] : [n]) {
      const e = nodeEvidence([x], d);
      if (e !== null && e < EVIDENCE) out.push(flatSp(x).replace(/\s+/g, ' ').trim());
    }
  }
  return out;
}

const sameWord = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && lev(a, b) <= 1);

/** The one level-2 section of a family page that is the record's variant: two or more words, every one a
 *  word of the record's name (one letter of slack in a long word: AoN's "Hag Eye (Smokey)" for "Smoky Hag
 *  Eye") and at least one not in the page's title (never the family's unnamed base grade). -1 when none or
 *  several qualify. */
export function variantSectionOf(tree, name) {
  const pageW = new Set(wordsOf(flatTitle(tree)));
  const nameW = wordsOf(name);
  const hits = [];
  (tree.c ?? []).forEach((n, i) => {
    if (!isSection(n)) return;
    const w = wordsOf(flatText(n));
    if (w.length >= 2 && w.every((x) => nameW.some((y) => sameWord(x, y))) && w.some((x) => !pageW.has(x))) hits.push(i);
  });
  return hits.length === 1 ? hits[0] : -1;
}

/** The record's variant sections on its own family page when its name carries SEVERAL qualifiers, each the
 *  title of a section: "Puzzle Box (Simple) (Hollow)" on the Puzzle Box page is BOTH its grade section
 *  "Puzzle Box (Simple)" ("The DC to solve this puzzle box is 15.", its price) and the "Puzzle Box (Hollow)"
 *  section (its hollow compartment) — card step 12 fixer, round 5: round 4 kept only the hollow section, so
 *  the simple, complex and challenging hollow boxes drew the same card and lost their own DC. Of the
 *  sections variantSectionOf would take (every word a word of the name, one not in the page's title), the
 *  indexes in page order: ALL of them when each adds a qualifier word of the name no other adds and together
 *  they add every qualifier word of the name (the name's words not in the page's title) — one section per
 *  qualifier; else the one whose body is the record's words (EVIDENCE). Either way at least one must be the
 *  record's words. [] unless two or more qualify by name. */
export function evidencedVariantSections(tree, rec) {
  const pageW = new Set(wordsOf(flatTitle(tree)));
  const nameW = wordsOf(String(rec?.name ?? ''));
  const top = tree.c ?? [];
  const named = [];
  top.forEach((n, i) => {
    if (!isSection(n)) return;
    const w = wordsOf(flatText(n));
    if (w.length >= 2 && w.every((x) => nameW.some((y) => sameWord(x, y))) && w.some((x) => !pageW.has(x))) named.push(i);
  });
  if (named.length < 2) return [];
  const d = padWords(rec.description);
  const own = named.filter((i) => { const e = nodeEvidence(top.slice(i + 1, sectionEnd(top, i)), d); return e !== null && e >= EVIDENCE; });
  if (!own.length) return [];
  // The qualifier words each named section adds (its words not in the page's title, as the name's words).
  const adds = named.map((i) => new Set(wordsOf(flatText(top[i])).filter((x) => !pageW.has(x)).map((x) => nameW.find((y) => sameWord(x, y)))));
  const quals = new Set(nameW.filter((y) => !pageW.has(y)));
  const seen = new Set();
  const disjoint = adds.every((s) => [...s].every((x) => { if (seen.has(x)) return false; seen.add(x); return true; }));
  if (disjoint && seen.size === quals.size && [...quals].every((y) => seen.has(y))) return named;
  return own.length === 1 ? own : [];
}

/** The share of the record's own sentences a run of its OWN page must hold to be its slice when no anchor
 *  carries its name (the R0 run route): the run is the record's description, word for word. */
export const OWN_RUN_GATE = 0.9;

/** A name's words with a spell rank written one way: "rank" / "level" / "spell" dropped and a bare rank
 *  number made ordinal, so "Arboreal Wand (Rank 2)" meets AoN's "Arboreal Wand (2nd-rank spell)" and "Wand
 *  of Thundering Echoes (3rd-Rank Spell)" meets "Wand of Thundering Echoes (3rd-Level)". */
const ORD = (d) => (/1[123]$/.test(d) ? 'th' : d.endsWith('1') ? 'st' : d.endsWith('2') ? 'nd' : d.endsWith('3') ? 'rd' : 'th');
const rankWords = (s) => wordsOf(s).filter((w) => !/^(?:rank|level|spells?)$/.test(w)).map((w) => (/^\d+$/.test(w) ? w + ORD(w) : w));

/** The level-2 sections of the record's own page whose words hold every word of its name, a spell rank
 *  written either way (rankWords) — "Wand of Choking Mist (2nd-Rank Spell)" for "Wand of Choking Mist
 *  (2nd-Rank)", "Wheelchair (Land-Delver's Chair)" for "Land-delver's Chair" — the indexes. */
export function supersetSections(tree, name) {
  const nameW = rankWords(name);
  if (!nameW.length) return [];
  const out = [];
  (tree.c ?? []).forEach((n, i) => {
    if (!isSection(n)) return;
    const w = rankWords(flatText(n));
    if (nameW.every((x) => w.some((y) => stemWord(x, y)))) out.push(i);
  });
  return out;
}
/** One word of a name meets one of a section title: the same, one letter apart (five letters or more), or
 *  one the other's stem of six letters or more — AoN prints "Splinter Spear (Greater)" for our
 *  "Splintering Spear (Greater)". */
const stemWord = (a, b) => sameWord(a, b) || (Math.min(a.length, b.length) >= 6 && (a.startsWith(b) || b.startsWith(a)));

/** The lines of a page a variant group can be: each top-level paragraph ([i]) and each item of a top-level
 *  list ([i, j]). */
function pageLines(tree) {
  const out = [];
  (tree.c ?? []).forEach((n, i) => {
    if (n.t === 'ul' || n.t === 'ol') (n.c ?? []).forEach((li, j) => out.push({ node: li, path: [i, j] }));
    else if (n.t === 'p') out.push({ node: n, path: [i] });
  });
  return out;
}
/** The first child of a line that is not blank text (unwrapping a list item's one paragraph). */
const leadChild = (n) => {
  const kids = n.c?.length === 1 && n.c[0].t === 'p' ? n.c[0].c ?? [] : n.c ?? [];
  return kids.find((x) => !(x.t === 'text' && !String(x.v ?? '').trim()));
};

/**
 * The record's own line on its family page when the variants are LINES, not sections: the one line (a
 * top-level paragraph or a top-level list's item) whose words start with the record's bracketed qualifier —
 * "Animal: Your bestial instincts…" for Instinct Crown (Animal), "Acid Clinging acid…" for Drake Rifle
 * (Acid). Its group is the list it is an item of, or the run of paragraphs beside it led the same way (an
 * italic or bold label of four words or fewer); the group's other lines are the other variants'. Null
 * unless exactly one line is led by the qualifier, the group holds two lines or more, the line holds the
 * record's words (or none to judge) and no dropped line does. Returns {path, drop, all} where `all` counts
 * the lines led by the qualifier (the raised-bar test's looser check).
 */
export function qualifierLine(tree, rec) {
  const qual = (String(rec?.name ?? '').match(/\(([^)]*)\)\s*$/) ?? [])[1];
  const q = qual ? words(qual) : '';
  if (!q) return null;
  const lines = pageLines(tree);
  const hits = lines.filter((l) => { const w = words(flatText(l.node)); return w.startsWith(q + ' ') && w.length > q.length + 1; });
  if (hits.length !== 1) return { path: null, drop: [], all: hits.length };
  const hit = hits[0];
  let group;
  if (hit.path.length === 2) {
    group = lines.filter((l) => l.path.length === 2 && l.path[0] === hit.path[0]);
  } else {
    const lead = leadChild(hit.node);
    const labelled = (n) => {
      const c = leadChild(n);
      return !!c && c.t === lead?.t && (c.t === 'i' || c.t === 'b') && words(flatText(c)).split(' ').filter(Boolean).length <= 4;
    };
    if (!labelled(hit.node)) return { path: null, drop: [], all: 1 };
    const top = tree.c ?? [];
    let a = hit.path[0];
    let z = hit.path[0];
    while (a > 0 && top[a - 1].t === 'p' && labelled(top[a - 1])) a--;
    while (z + 1 < top.length && top[z + 1].t === 'p' && labelled(top[z + 1])) z++;
    group = lines.filter((l) => l.path.length === 1 && l.path[0] >= a && l.path[0] <= z);
  }
  if (group.length < 2) return { path: null, drop: [], all: 1 };
  const d = padWords(rec.description);
  const own = nodeEvidence([hit.node], d);
  if (own !== null && own < EVIDENCE) return { path: null, drop: [], all: 1 };
  const drop = group.filter((l) => l !== hit);
  // The record's line must be clearly the group's best: a sister line worded alike ("Earth … resistance to
  // physical damage … equal to half your level" beside Metal's) may share some runs, never as many.
  const ownE = own ?? 1;
  if (drop.some((l) => { const e = nodeEvidence([l.node], d); return e !== null && e >= EVIDENCE && e > ownE - 0.2; })) return { path: null, drop: [], all: 1 };
  return { path: hit.path, drop: drop.map((l) => l.path), all: 1, node: hit.node };
}

/** The record's run of a page with no anchor of its own: the maximal stretches of units whose judged
 *  lines are all the record's (headings, rules and glyphs inside count, a heading just before is taken as
 *  its title line), the one holding most of the record's sentences (the shorter on a tie). */
function bestRun(tree, rec, sents) {
  const d = padWords(rec.description);
  const us = pageUnits(tree);
  const v = us.map((u) => {
    const x = u.node;
    if (x.t === 'title' && Number(x.level ?? 1) <= 1) return 'no';
    if (isTitleNode(x) || x.t === 'hr' || x.t === 'actions' || x.t === 'br' || x.t === 'traits') return 'maybe';
    // A long paragraph holding one whole sentence of the record's is the record's paragraph (Swirl Crimson
    // Shroud is one sentence of the Crimson Shroud feat's paragraph): the card shows that paragraph.
    if ((sentenceCoverage(sents, flatText(x)) ?? 0) > 0) return 'yes';
    const e = nodeEvidence([x], d);
    return e === null ? 'maybe' : e >= EVIDENCE ? 'yes' : 'no';
  });
  let best = null;
  for (let s = 0; s < us.length; s++) {
    if (v[s] !== 'yes') continue;
    let last = s;
    for (let e = s + 1; e < us.length && v[e] !== 'no'; e++) if (v[e] === 'yes') last = e;
    const start = s > 0 && isTitleNode(us[s - 1].node) && Number(us[s - 1].node.level ?? 3) > 1 ? s - 1 : s;
    const spec = { kind: 'run', path: us[start].path, anchor: runAnchor(us[start].node), n: last + 1 - start, title: String(rec.name) };
    const slice = sliceOf(tree, spec);
    const c = slice ? sentenceCoverage(sents, flatText(slice)) ?? 0 : 0;
    if (!best || c > best.c || (c === best.c && spec.n < best.spec.n)) best = { spec, c };
    s = last;
  }
  return best ? best.spec : null;
}

/** bestRun on the record's OWN page, carried through the "Special" lines straight after it: on its own page
 *  a feat's printed Special line ("Special You cannot select another dedication feat until…") is the
 *  record's whatever its words (our older text often lacks it). On a bigger page the same line is the
 *  granting feat's, so only this route takes it. */
function ownRun(tree, rec, sents) {
  const run = bestRun(tree, rec, sents);
  if (!run) return null;
  const us = pageUnits(tree);
  const at = us.findIndex((u) => u.path.join('.') === run.path.join('.'));
  let n = run.n;
  while (at + n < us.length && us[at + n].path.length === 1 && /^special$/i.test(anchorOf(us[at + n].node)?.text ?? '')) n++;
  // An own-page run carries the page's header (`head`: its traits and leading stat column / Source line,
  // astVisibility.ts sliceOf) — card step 12 fixer, round 5: round 4's run started at the first prose line
  // and dropped Wand of Refracting Rays (7th-Rank)'s traits, Usage, Bulk and Source.
  return { ...run, n, head: true };
}

/**
 * F6b: the slice map. For every official record with no page of its own, and every record of the S2
 * residue (`residue`, from censusResidue), the one paragraph / section of a bigger shipped page that is
 * the record's, found by — in this order, the first route with exactly one page decides:
 *   R0 own page:  (a residue record) the one level-2 section of its own shared page whose words hold every
 *                 word of its name (supersetSections), cut as a family variant; else, where the family's
 *                 variants are lines, the one line led by its qualifier with the other variants' lines
 *                 left out (qualifierLine, kind 'line': Instinct Crown (Animal), Drake Rifle (Acid)); else,
 *                 where its name carries several qualifiers each a section's title, those sections in page
 *                 order, one per qualifier (evidencedVariantSections: Puzzle Box (Simple) (Hollow) = its
 *                 "Puzzle Box (Simple)" then its "Puzzle Box (Hollow)" section, `also`);
 *   R1 parent:    in the page the record's aonParentId names, the anchor titled its aonSection, its name or
 *                 its name without the bracketed qualifier (a level badge "(3rd)" / "(Level 5)" ignored);
 *   R2 qualifier: on a page titled the record's bracketed qualifier ("Field Discovery (Toxicologist)" →
 *                 the Toxicologist research field), the anchor titled the name without it;
 *   R3 title:     anywhere, the anchor titled the record's aonSection or name (one page only);
 *   R4 subset:    a page whose title is the record's name less some of its words ("Air Gate" → the Air
 *                 kineticist element page) — only when exactly one such page passes the coverage gate;
 *   R0 run:       (last, a residue record nothing above sliced) the run of its OWN page with no anchor of
 *                 its own that holds >= OWN_RUN_GATE of its sentences (ownRun, carried through a Special
 *                 line straight after it, the page's header in front: `head`): Arcane Bond (Unified Magical
 *                 Theory), Wand of Refracting Rays (7th-Rank).
 * A route that lands on a whole page takes the page's variant section named after the record
 * (variantSectionOf); else the whole page only when it IS the record's text (no foreignLines); else the
 * run of the page that is the record's (bestRun); else nothing. A section or paragraph ends where
 * the record's text ends (sectionExtent / blockExtent). Pages are grouped by url (the same Archives page
 * shipped in two buckets is one page). Every slice must find >= COVERAGE_GATE of the record's own
 * sentences; an anchor carrying the record's name on its own page (R0), its parent page (R1) or its
 * qualifier's page (R2) passes on half its four-word runs instead, or with no text to judge. Returns
 * "bucket:id" → {bucket, page, path, anchor, kind, n?, seg?, title?, drop?, also?, head?, route, coverage}.
 */
export function computePageSlices(content, trees, residue, { onReject } = {}) {
  const targets = [...new Set([...officialNoPage(content, trees), ...Object.keys(residue)])].sort();
  // Indexes: aon id → pages; level-1 title key → pages; anchor key → anchors; title word → pages.
  const byAon = new Map();
  const byTitle = new Map();
  const byAnchor = new Map();
  const byWord = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const anchorsCache = new Map();
  const anchorsOf = (b, s) => {
    const k = `${b}:${s}`;
    if (!anchorsCache.has(k)) anchorsCache.set(k, pageAnchors(trees[b][s]));
    return anchorsCache.get(k);
  };
  for (const b of Object.keys(trees).sort()) {
    for (const [s, t] of Object.entries(trees[b])) {
      if (!t) continue;
      const ref = { bucket: b, page: s, url: t.url ?? `${b}:${s}` };
      if (t.aon) push(byAon, String(t.aon), ref);
      for (const a of anchorsOf(b, s)) {
        const key = anchorKey(a.text);
        if (!key) continue;
        push(byAnchor, key, { ...ref, ...a });
        if (a.kind === 'page') {
          push(byTitle, key, ref);
          for (const w of new Set(wordsOf(a.text))) push(byWord, w, { ...ref, ...a });
        }
      }
    }
  }
  // One representative tree per url: the page's OWN record (its name is the page's title) — in the
  // record's bucket first — then any tree in the record's bucket, then a tree a record holds, then the first.
  const owner = (c) => astSlug(String(content[c.bucket]?.[c.page]?.name ?? '')) === astSlug(flatTitle(trees[c.bucket][c.page]));
  const pick = (cands, recBucket) => {
    const byUrl = new Map();
    for (const c of cands) push(byUrl, c.url, c);
    return [...byUrl.values()].map((g) => g.find((c) => c.bucket === recBucket && owner(c)) ?? g.find(owner) ?? g.find((c) => c.bucket === recBucket) ?? g.find((c) => content[c.bucket]?.[c.page]) ?? g[0]);
  };
  const out = {};
  for (const key of targets) {
    const at = key.indexOf(':');
    const b = key.slice(0, at);
    const id = key.slice(at + 1);
    const rec = content[b]?.[id];
    if (!rec?.name) continue;
    const ownTree = trees[b]?.[id];
    const ownUrl = ownTree?.url;
    const name = String(rec.name);
    const bare = name.replace(/(\s*\([^)]*\))+\s*$/, '').trim();
    const qual = (name.match(/\(([^)]*)\)\s*$/) ?? [])[1];
    const section = rec.aonSection ? String(rec.aonSection) : '';
    const sents = ownSentences(rec.description);
    /** The cut an anchor gives: a whole page refined (variant → whole if it IS the record's → run), a
     *  section / paragraph with its extent, a list item or bullet as is. */
    const cutOf = (tree, ref, a) => {
      const base = { bucket: ref.bucket, page: ref.page };
      if (a.spec) return { ...base, ...a.spec };
      if (a.kind === 'page') {
        const vi = variantSectionOf(tree, name);
        if (vi >= 0) return { ...base, path: [vi], anchor: anchorOf(tree.c[vi]).text, kind: 'variant', n: sectionExtent(tree.c, vi, rec.description) };
        if (!foreignLines(tree, rec.description).length) return { ...base, path: a.path, anchor: a.text, kind: 'page' };
        const run = bestRun(tree, rec, sents);
        return run ? { ...base, ...run } : null;
      }
      if (a.kind === 'section' || a.kind === 'variant') return { ...base, path: a.path, anchor: a.text, kind: a.kind, n: sectionExtent(tree.c, a.path[0], rec.description) };
      if (a.kind === 'block') return { ...base, path: a.path, anchor: a.text, kind: 'block', ...(a.path.length === 1 ? { n: blockExtent(tree.c, a.path[0], rec.description) } : {}) };
      return { ...base, path: a.path, anchor: a.text, kind: a.kind, ...(a.kind === 'item' ? { seg: a.seg } : {}) };
    };
    const accept = (route, ref, a) => {
      const tree = trees[ref.bucket][ref.page];
      const spec = cutOf(tree, ref, a);
      if (!spec) {
        onReject?.({ key, route, spec: { bucket: ref.bucket, page: ref.page, path: a.path, anchor: a.text, kind: a.kind }, coverage: null, grams: null, named: false, why: 'no cut of the page is the record\'s' });
        return null;
      }
      const slice = sliceOf(tree, spec);
      if (!slice) return null;
      const text = flatText(slice);
      const c = sentenceCoverage(sents, text);
      // The gate. Every slice passes when it holds >= COVERAGE_GATE of the record's own sentences. An anchor
      // that carries the record's NAME on its own page (R0), on the page its aonParentId names (R1) or on its
      // qualifier's page (R2) is the record's even where our older text words it differently (Advanced
      // Rangefinder's page says "10 feet", our import "20 feet"; Attack Refiner's page "lands true"): it
      // passes when half of the record's four-word runs are on it, or when the record has no text to judge.
      // An anchor matched by aonSection alone never skips the sentence gate (it linked the GM Core gem
      // "Tiger's-eye" to Tiger Shield's "Activate—Tiger's Eyes"), and neither does a run (no anchor at all).
      const named = spec.kind !== 'run' && (route === 'R0' || ((route === 'R1' || route === 'R2') && namesRecord(spec.anchor, name, bare)));
      const g = named ? gramCoverage(rec.description, text) : null;
      const pass = c !== null ? c >= COVERAGE_GATE || (named && g !== null && g >= 0.5) : named && (g === null || g >= 0.5);
      if (!pass) {
        onReject?.({ key, route, spec, coverage: c, grams: g, named });
        return null;
      }
      return { ...spec, route, coverage: c === null ? null : Math.round(c * 100) / 100, ...(c === null || c < COVERAGE_GATE ? { grams: g === null ? null : Math.round(g * 100) / 100 } : {}) };
    };
    // The record's own (shared) page may hold its slice — "Second Doctrine (3rd)" on the Cloistered Cleric
    // doctrine page it was filed under whole — but never as the whole page again.
    const notOwnWhole = (url, kind) => !(url === ownUrl && kind === 'page');
    const onPages = (pages, keys) => {
      const hits = [];
      for (const p of pages) {
        const as = anchorsOf(p.bucket, p.page).filter((a) => keys.has(anchorKey(a.text)) && notOwnWhole(p.url, a.kind));
        if (as.length) hits.push({ p, as });
      }
      return hits;
    };
    let found = null;
    let decided = false;
    // R0
    if (ownTree && key in residue) {
      const hits = supersetSections(ownTree, name);
      if (hits.length === 1) {
        found = accept('R0', { bucket: b, page: id, url: ownUrl }, { path: [hits[0]], kind: 'variant', text: anchorOf(ownTree.c[hits[0]]).text });
        if (found) decided = true;
      }
      // …or, where its name carries several qualifiers each a section's title, its sections in page order
      // (evidencedVariantSections: a hollow puzzle box's grade section, then "Puzzle Box (Hollow)") — the
      // first is the slice's variant, the rest follow it (`also`).
      if (!decided && !hits.length) {
        const vs = evidencedVariantSections(ownTree, rec);
        if (vs.length) {
          const sec = (vi) => ({ path: [vi], anchor: anchorOf(ownTree.c[vi]).text, n: sectionExtent(ownTree.c, vi, rec.description) });
          const [first, ...more] = vs.map(sec);
          const spec = { ...first, kind: 'variant', ...(more.length ? { also: more } : {}) };
          found = accept('R0', { bucket: b, page: id, url: ownUrl }, { path: first.path, kind: 'variant', text: first.anchor, spec });
          if (found) decided = true;
        }
      }
      // …or, where the family's variants are lines, its own line with the others left out (qualifierLine).
      if (!decided) {
        const ql = qualifierLine(ownTree, rec);
        if (ql?.path) {
          const spec = { path: ql.path, anchor: runAnchor(ql.node), kind: 'line', title: name, drop: ql.drop };
          found = accept('R0', { bucket: b, page: id, url: ownUrl }, { path: ql.path, kind: 'line', text: spec.anchor, spec });
          if (found) decided = true;
        }
      }
    }
    // R1
    if (!decided && rec.aonParentId) {
      const pid = String(rec.aonParentId);
      const pages = pick(byAon.get(pid) ?? byAon.get(pid.replace(/-\d+$/, '')) ?? [], b);
      const keys = new Set([section, name, bare].filter(Boolean).map(anchorKey));
      const hits = onPages(pages, keys);
      if (hits.length === 1 && hits[0].as.length === 1) { found = accept('R1', hits[0].p, hits[0].as[0]); decided = true; }
      else if (hits.length) decided = true;
    }
    // R2
    if (!decided && qual && bare) {
      const pages = pick(byTitle.get(anchorKey(qual)) ?? [], b);
      const hits = onPages(pages, new Set([anchorKey(bare)]));
      if (hits.length === 1 && hits[0].as.length === 1) { found = accept('R2', hits[0].p, hits[0].as[0]); decided = true; }
      else if (hits.length) decided = true;
    }
    // R3
    if (!decided) {
      const keys = [...new Set([section, name].filter(Boolean).map(anchorKey))];
      const cands = keys.flatMap((k) => byAnchor.get(k) ?? []).filter((c) => notOwnWhole(c.url, c.kind));
      const urls = new Set(cands.map((c) => c.url));
      if (urls.size === 1) {
        const rep = pick(cands, b)[0];
        const as = cands.filter((c) => c.bucket === rep.bucket && c.page === rep.page);
        if (as.length === 1) found = accept('R3', rep, as[0]);
        decided = true;
      } else if (urls.size > 1) decided = true;
    }
    // R4
    if (!decided) {
      const nameWords = new Set(wordsOf(name));
      if (nameWords.size >= 2) {
        const cands = [...new Set([...nameWords].flatMap((w) => byWord.get(w) ?? []))].filter((c) => {
          if (c.url === ownUrl) return false;
          const w = wordsOf(c.text);
          return w.length > 0 && w.length < nameWords.size && w.every((x) => nameWords.has(x));
        });
        const passing = pick(cands, b).map((c) => accept('R4', c, c)).filter((x) => x && x.coverage !== null);
        if (passing.length === 1) found = passing[0];
      }
    }
    // R0 run (last, so it never displaces a slice another route found): a residue record whose OWN page
    // holds a run with no anchor of its own that IS its description (>= OWN_RUN_GATE of its sentences) reads
    // that run — paragraph [6] of the School of Unified Magical Theory page is Arcane Bond (Unified Magical
    // Theory) word for word.
    if (!found && ownTree && key in residue) {
      const run = ownRun(ownTree, rec, sents);
      const got = run ? accept('R0', { bucket: b, page: id, url: ownUrl }, { path: run.path, kind: 'run', text: run.anchor, spec: run }) : null;
      if (got && got.coverage !== null && got.coverage >= OWN_RUN_GATE) found = got;
    }
    if (found) out[key] = found;
  }
  return out;
}

/** Two-way: the file must hold exactly the computed slices, each with the same page, path, anchor, kind and
 *  extent. */
export function pageSliceProblems(file, computed) {
  const out = [];
  const have = file?.slices ?? {};
  const same = (a, b) => a.bucket === b.bucket && a.page === b.page && a.anchor === b.anchor && a.kind === b.kind && (a.seg ?? null) === (b.seg ?? null)
    && (a.n ?? null) === (b.n ?? null) && (a.title ?? null) === (b.title ?? null) && JSON.stringify(a.path) === JSON.stringify(b.path)
    && JSON.stringify(a.drop ?? null) === JSON.stringify(b.drop ?? null) && JSON.stringify(a.also ?? null) === JSON.stringify(b.also ?? null)
    && (a.head ?? null) === (b.head ?? null);
  for (const [k, v] of Object.entries(computed)) {
    if (!have[k]) out.push(`${k}|SLICE-UNLISTED`);
    else if (!same(have[k], v)) out.push(`${k}|SLICE-DIFFERS`);
  }
  for (const k of Object.keys(have)) if (!computed[k]) out.push(`${k}|SLICE-STALE`);
  return out;
}
