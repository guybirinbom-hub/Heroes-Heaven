/*
 * THE CARD GUARD'S PURE HALF — docs/card-design.md section 8, step 4 of section 9.
 *
 * What a popup shows of a record's Archives page, computed from the shipped trees with the SAME
 * predicates the renderer draws with (src/sheet/astVisibility.ts: isMetaP, isMetaishBlock, textOf,
 * variantSection, withoutItemLists) and the SAME stat-row functions the popups render their stat panel
 * from (featStatRows / itemStatRows / spellStatRows — injected by the caller, because they live in .tsx
 * files: scripts/card-truth-check.mjs bundles them, test/card-parity.test.tsx imports them).
 *
 * Two consumers, one copy:
 *   - scripts/card-truth-check.mjs: the full corpus, every (surface, record) with a page; baseline.
 *   - test/card-parity.test.tsx: a seeded sample of REAL popups rendered in jsdom; the verdict read off
 *     the DOM must equal this ledger's verdict, with zero disagreements.
 *
 * The block walk below (walkBlocks / renderBlock) is a port of AstRenderer.tsx's Blocks / renderBlock:
 * the predicates are imported, but the loop shape (the Activate fold, the inline-fragment fold, the
 * row/column/spoiler branches) is copied, because AstRenderer.tsx is .tsx and imports a stylesheet. A
 * drift between this port and the renderer is exactly what the rendered test exists to catch: the DOM
 * verdict is read from the real component, so a renderer that stops agreeing with this walk turns
 * test/card-parity.test.tsx red.
 *
 * Card step 5: a surface switched onto the 'mine' card (src/sheet/cardSurfaces.ts CARD_ON; today
 * statDetail) is modelled with the card's own rules — the printed set in place of hideMeta, S-furniture,
 * no whole-block drop — by calling the SAME predicates the renderer calls (astVisibility.ts
 * cardDropsMetaP / isCardFurnitureP / isCardFurnitureTitle / cardRowParts / cardHeadUntil, and
 * cardScope.ts canonLabel / printedSet). The walk tags what the card leaves out with its path
 * (card-furniture, card-printed, spoiler) only; classifyOmission still names each line from its own
 * words, so a predicate that starts leaving out more page text is counted (S1-UNNAMED / S1-MISSING).
 */
import {
  clean, isMetaP, isMetaishBlock, textOf, variantSection, withoutItemLists, astSlug,
  cardDropsMetaP, cardFurnitureSectionEnd, cardHeadUntil, cardRowParts, isCardFurnitureP, isCardFurnitureTitle,
} from '../../src/sheet/astVisibility.ts';
import { OMISSION_RULES, LABEL_ALIASES, canonLabel, printedSet } from '../../src/sheet/cardScope.ts';
import { CARD_ON } from '../../src/sheet/cardSurfaces.ts';

/* ------------------------------------------------------------------------------------------------ */
/* 1. The label vocabulary: the printed "use lines" and stat lines (section 2 rule 4.2).             */
/* ------------------------------------------------------------------------------------------------ */

/* Card step 5: the label table and canonLabel moved to src/sheet/cardScope.ts (LABEL_ALIASES), because
 * the 'mine' card reads the same table to decide what its surface's stat rows printed. */
export const LABELS = Object.keys(LABEL_ALIASES);
export { canonLabel };

/**
 * Labels whose VALUE is compared with the page (DIFFERS). The rest are judged on presence only: an
 * item's Damage / Group / AC rows are the record's fields, printed by the popup on purpose, and their
 * agreement with print is the S4 field-vs-print question this step does not take (section 13:
 * mechanics are out of scope).
 */
export const DIFF_LABELS = new Set(['Prerequisites', 'Range', 'Area', 'Targets', 'Duration', 'Defense']);

/** The value as both sides compare it. */
export function normValue(label, v) {
  let s = String(v ?? '').toLowerCase().replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
  s = s.replace(/[;.,]+$/, '').trim();
  if (label === 'Defense') {
    const toks = [];
    if (/\bac\b/.test(s)) toks.push('ac');
    for (const w of ['basic', 'fortitude', 'reflex', 'will']) if (new RegExp(`\\b${w}\\b`).test(s)) toks.push(w);
    return toks.sort().join(' ');
  }
  s = s.replace(/\bfeet\b|\bfoot\b/g, 'ft').replace(/\bft\./g, 'ft');
  if (label === 'Usage') s = s.replace(/^worn\s*/, '');
  return s.replace(/[^a-z0-9+/-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export const sameValue = (label, a, b) => normValue(label, a) === normValue(label, b);

/* ------------------------------------------------------------------------------------------------ */
/* 2. Runs and label segments — the one splitter both the ledger and the DOM reader use.             */
/* ------------------------------------------------------------------------------------------------ */

/** Text the action-glyph component draws for a cost string (AstRenderer.tsx Glyph). */
const DIGIT = {
  'single action': '1', 'one action': '1', 'two actions': '2', 'three actions': '3',
  'free action': '4', reaction: '5', '1 action': '1', '2 actions': '2', '3 actions': '3',
};
export function glyphText(str) {
  const s = String(str || '').trim().toLowerCase();
  if (!s) return '';
  if (DIGIT[s]) return DIGIT[s];
  const p = s.split(/\s+(?:to|or)\s+/);
  if (p.length === 2 && DIGIT[p[0]] && DIGIT[p[1]]) return `${DIGIT[p[0]]}to${DIGIT[p[1]]}`;
  return String(str);
}

/** Flatten a tree node's inline content to runs: {t:'x'} text, {b:'x'} a bold run (not descended). */
export function inlineRuns(nodes, out = []) {
  for (const n of nodes ?? []) {
    if (!n) continue;
    if (n.t === 'text') out.push({ t: clean(n.v ?? '') });
    else if (n.t === 'b') out.push({ b: textOf(n) });
    else if (n.t === 'br') out.push({ t: ' ' });
    else if (n.t === 'actions') out.push({ t: glyphText(n.string) });
    else inlineRuns(n.c, out);
  }
  return out;
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const runsText = (runs) => norm(runs.map((r) => r.t ?? r.b ?? '').join(''));
/** Text with every space removed: how two renders of one paragraph are compared (spacing between
 *  inline pieces differs between a tree walk and a DOM's textContent; the words do not). */
export const squash = (s) => String(s ?? '').replace(/\s+/g, '');

/**
 * The label lines inside one block: a bold run naming a label, at the block's start or after a ";",
 * opens a line; its value runs to the next such run. "Price 3 gp; Bulk L" is two lines.
 */
export function labelSegments(runs) {
  const segs = [];
  let before = '';
  let cur = null;
  for (const r of runs) {
    if (r.b != null) {
      const lab = canonLabel(r.b);
      if (lab && (!before.trim() || /;\s*$/.test(before))) {
        if (cur) segs.push(cur);
        cur = { label: lab, value: '' };
        before = '';
        continue;
      }
    }
    const s = r.t ?? r.b ?? '';
    before += s;
    if (cur) cur.value += s;
  }
  if (cur) segs.push(cur);
  for (const s of segs) s.value = norm(s.value).replace(/^[;:\s]+|[;\s]+$/g, '').trim();
  return segs;
}

/**
 * Every bold run that OPENS a segment of a block (at its start, or after a ";"), whatever it says —
 * "Source", "Special", "PFS Note", "Frequency". labelSegments keeps only the vocabulary; the omission
 * log needs all of them, so a dropped line led by a word outside the vocabulary is still seen.
 */
export function leadsOf(runs) {
  const out = [];
  let before = '';
  for (const r of runs) {
    if (r.b != null && r.b.trim() && (!before.trim() || /;\s*$/.test(before))) {
      out.push(r.b.replace(/\s+/g, ' ').trim().replace(/[:：]$/, '').trim());
      before = '';
      continue;
    }
    before += r.t ?? r.b ?? '';
  }
  return out;
}

/*
 * The scraped plain-text spell header (S3). About 214 spell descriptions open with the Archives header
 * as UNBOLDED text — "Borrow Time / Source Impossible Magic pg. 190 / Cast 1 hour / Cost … / Area
 * 30-foot burst centered on you / Target(s) … / Duration varies" — which RichText joins into one or two
 * paragraphs. Those are stat labels drawn in the prose exactly like a bold preamble, so the spell
 * surface counts them as body labels (S3 placement), and a page label they carry is not MISSING.
 *
 * A header paragraph is one of the first four body blocks that opens with a header label, or carries a
 * "Source … pg. N" scrape in its first 160 characters. Only its head is read: the text before the first
 * sentence end (". X", never the "pg." of a page number), so a capitalised word in the prose that follows
 * a joined "Duration varies This spell …" is not taken for a label. Case-sensitive: header labels are
 * capitalised, prose words are not.
 */
const PLAIN_HEADER_LABEL = /(?:^|[\s;])(Secondary Casters|Primary Check|Secondary Checks|Saving Throw|Target\(s\)|Targets|Target|Requirements|Requirement|Cast|Cost|Range|Area|Duration|Defense|Trigger)(?=\s)/g;
const PLAIN_HEADER_OPEN = /^(Secondary Casters|Primary Check|Secondary Checks|Saving Throw|Target\(s\)|Targets|Target|Requirements|Requirement|Cast|Cost|Range|Area|Duration|Defense|Trigger)\s/;
export function plainHeaderLabels(blocks) {
  const out = new Set();
  for (const b of blocks.slice(0, 4)) {
    const t = norm(b.text);
    const scraped = /\bSource\s.{1,120}?\bpg\.?\s*\d+/.test(t.slice(0, 160));
    if (!scraped && !PLAIN_HEADER_OPEN.test(t)) continue;
    const end = t.search(/(?<!\bpg)\.\s+[A-Z]/);
    const head = end < 0 ? t : t.slice(0, end);
    for (const m of head.matchAll(PLAIN_HEADER_LABEL)) {
      const lab = canonLabel(m[1]);
      if (lab) out.add(lab);
    }
  }
  return out;
}

/** The labels a surface's body draws: label lines, plus — on the spell popup — the scraped plain header. */
export function bodyLabels(blocks, surface) {
  const s = new Set(labelsOf(blocks).keys());
  if (surface === 'spellDetail') for (const l of plainHeaderLabels(blocks)) s.add(l);
  return s;
}

/* ------------------------------------------------------------------------------------------------ */
/* 2b. The omission log (section 8 check 1; section 2 rule 5).                                       */
/* ------------------------------------------------------------------------------------------------ */

/**
 * The ONLY reasons a 'mine' card may leave a line of the record's page out: the names in
 * src/sheet/cardScope.ts OMISSION_RULES (S-own, S-items, S-furniture, S-printed, S-future, S-pick).
 * Anything else a surface leaves out is a defect the guard counts:
 *   MISSING   — a line led by a vocabulary label the surface does not print (counted in S1-MISSING by
 *               the label verdict);
 *   UNNAMED   — any other line (counted in S1-UNNAMED, keyed by its leading bold word, or by the start of
 *               its text when it has none). "Source", "PFS Note", "Special", a prose paragraph …
 * The legacy drop paths (meta-line, metaish-block, inline-row, spoiler) are NOT names: they say how a
 * line was dropped, never why it may be.
 */
export const RULE_NAMES = Object.keys(OMISSION_RULES);
export const OMISSION_DEFECTS = ['MISSING', 'UNNAMED'];

/** Section 2 rule 5(c), S-furniture: navigation, not the record's rules. Leads, lower case. */
const FURNITURE_LEADS = new Set([
  'class', 'parent',
  'traditions', 'tradition', 'deities', 'deity', 'domain', 'domains', 'bloodline', 'bloodlines',
  'mystery', 'mysteries', 'lesson', 'lessons', 'patron', 'patrons', 'patron theme', 'patron themes', 'spell list', 'spell lists',
  'related feats',
]);
const FURNITURE_TEXT = [/\bleads to\b/i, /\bclick here\b/i, /\bcan be found here\b/i, /^Related (?:Feats|Bloodlines?)\b/i];
/** The heading of a "<X> leads to…" navigation section, read from its own words. */
const LEADS_TO_HEADING = /\bleads to\b\.{0,3}\s*$/i;

/**
 * Why one dropped page line may be dropped. `b.rule` is the legacy path that dropped it (or 'S-items'),
 * `printed` the surface's stat-row labels. Returns {rule, unnamed}: rule is a RULE_NAMES entry, or
 * 'MISSING' / null (UNNAMED, with the leads that carry no name).
 */
export function classifyOmission(b, printed) {
  if (b.rule === 'S-items') return { rule: 'S-items', unnamed: [] };
  if (b.rule === 'spoiler') return { rule: 'S-furniture', unnamed: [] };
  // Card step 5: the card walk's own paths (card-furniture, card-printed) are NOT trusted as names, like
  // the legacy paths: a line the card leaves out is classified by its own words here, so a predicate in
  // astVisibility.ts that starts leaving out more is counted, not excused.
  if (FURNITURE_TEXT.some((re) => re.test(b.text))) return { rule: 'S-furniture', unnamed: [] };
  const leads = leadsOf(b.runs);
  if (!leads.length) return { rule: null, unnamed: [`¶${squash(b.text).slice(0, 32)}`] };
  const unnamed = [];
  let missing = false;
  let printedAll = true;
  for (const l of leads) {
    const c = canonLabel(l);
    if (c && printed.has(c)) continue;
    printedAll = false;
    if (c) missing = true;
    else if (!FURNITURE_LEADS.has(l.toLowerCase())) unnamed.push(l);
  }
  if (unnamed.length) return { rule: null, unnamed };
  if (missing) return { rule: 'MISSING', unnamed: [] };
  return { rule: printedAll ? 'S-printed' : 'S-furniture', unnamed: [] };
}

/**
 * The omission log of one 'mine' tree surface: every line of the record's page (pageBlocks, as browse
 * draws it) that the surface's body does not draw, each with its rule. `hidden` lists the blocks the
 * surface's own walk dropped, with the path that dropped them — it only lends the legacy path
 * (S-items, spoiler) to the classification; a line no path dropped is classified all the same.
 */
export function omissionLog(pageBlocks, shownBlocks, hidden, printed) {
  const shown = shownBlocks.map((b) => squash(b.text)).join('|');
  const hid = hidden.map((h) => ({ sq: squash(h.text), rule: h.rule }));
  const out = [];
  let prev = null;
  for (const b of pageBlocks) {
    const t = squash(b.text);
    // A glyph-sized piece ("1") always "occurs" in the shown text; it neither counts nor breaks a line.
    if (shown.includes(t)) { if (t.length > 3) prev = null; continue; }
    const h = hid.find((o) => o.sq.includes(t));
    const c = classifyOmission({ runs: b.runs, text: b.text, rule: h?.rule }, printed);
    let rec = { text: b.text, legacy: h?.rule ?? null, rule: c.rule ?? 'UNNAMED', unnamed: c.unnamed, lead: !!leadsOf(b.runs).length };
    // The rest of a header line the tree splits into pieces — "Activate—Name" | "1" | "(manipulate)" |
    // "Interact" — has no lead of its own: a short lead-less piece straight after a dropped lead line
    // belongs to that line and takes its rule (its leads are already counted once).
    if (prev && (prev.lead || prev.cont) && rec.unnamed.length && !rec.lead && t.length <= 80 && c.rule === null) {
      rec = { ...rec, rule: prev.rule, unnamed: [], cont: true };
    }
    // Card step 5: the link list under a dropped "<X> leads to…" heading belongs to that navigation
    // section (S-furniture) — read from the page's structure (the ONE lead-less line straight after the
    // dropped heading), not from the card's own drop path. Only that single line: a second dropped line
    // after it (a sidebar heading, its prose) is named by its own words, so a section end that swallows
    // past the link list is counted, never excused (measured 2026-10-02: narrowing the chain to this one
    // line moved no entry of the ledger; test/card-statdetail.test.tsx pins the rule).
    else if (prev && prev.leadsTo && rec.unnamed.length && !rec.lead && c.rule === null) {
      rec = { ...rec, rule: 'S-furniture', unnamed: [], section: true };
    }
    if (rec.rule === 'S-furniture' && LEADS_TO_HEADING.test(String(b.text).trim())) rec = { ...rec, leadsTo: true };
    out.push(rec);
    prev = rec;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* 3. The block walk — a port of AstRenderer.tsx Blocks/renderBlock, with the predicates imported.   */
/* ------------------------------------------------------------------------------------------------ */

const TIERS = { 'critical success': 1, success: 1, failure: 1, 'critical failure': 1 };
function firstNonBlank(p) {
  return (p.c || []).find((x) => !(x.t === 'text' && !textOf(x).trim()));
}
function successTier(p) {
  const first = firstNonBlank(p);
  if (!first || first.t !== 'b') return false;
  return !!TIERS[textOf(first).trim().toLowerCase().replace(/:$/, '')];
}
function isInlineFrag(n, next) {
  if (!n) return false;
  if (n.t === 'sup' || n.t === 'sub') return true;
  if (n.t === 'actions') return isInlineFrag(next);
  if (n.t !== 'p') return false;
  const t = textOf(n).trim();
  return t.length > 0 && t.length < 400 && /^[,.;:)\]]|^[a-z]/.test(t);
}
const BLOCK_TYPES = new Set(['p', 'title', 'heading', 'h2', 'h3', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'aside', 'row', 'column', 'document', 'doc', 'hr', 'center', 'spoilers']);
const markerOnly = (raw) => /^#{1,6}$/.test(raw) || /^[-*_]{3,}$/.test(raw);
const titleInline = (n) => (n.c || []).flatMap((c) => (c.t === 'p' ? c.c || [] : [c]));

/**
 * Walk a run of block nodes as the renderer would. Every rendered block becomes
 * {runs, text, shown, rule?}: `shown:false` blocks are what the hideMeta path drops, each with the
 * rule that dropped it (meta-line, metaish-block, inline-row, spoiler). `seq` numbers siblings so the
 * cut-in-sentence check can see what follows a dropped block.
 */
export function walkBlocks(nodes, hideMeta, out = [], hiddenBy = null, card = undefined, headUntil = undefined) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    // Card step 5 ('mine' card): AstRenderer's Blocks — header-ness per top-level block, nested runs
    // inherit; the "<X> leads to…" section leaves whole (S-furniture).
    const cw = card && headUntil !== undefined ? { printed: card.printed, head: headUntil >= 0 && i < headUntil } : card;
    if (cw && isCardFurnitureTitle(n)) {
      const end = cardFurnitureSectionEnd(nodes, i);
      for (let k = i; k < end; k++) walkHidden(nodes[k], out, hiddenBy ?? 'card-furniture');
      i = end - 1;
      continue;
    }
    if (n.t === 'p') {
      const bold0 = firstNonBlank(n);
      if (bold0 && bold0.t === 'b' && /^activate/i.test(textOf(bold0).trim()) && nodes[i + 1]?.t === 'actions') {
        // AstRenderer: `<Kids/> <Glyph/>` — a space between the paragraph and the glyph.
        emit(out, [...inlineRuns(n.c), { t: ' ' }, { t: glyphText(nodes[i + 1].string) }], hiddenBy, null, 'act');
        i++;
        continue;
      }
      const raw = textOf(n).trim();
      const meta = isMetaP(n);
      if (raw && !successTier(n) && !markerOnly(raw)) {
        let j = i + 1;
        const frags = [];
        while (j < nodes.length && isInlineFrag(nodes[j], nodes[j + 1])) { frags.push(nodes[j]); j++; }
        if (frags.length && (!meta || frags.some((f) => f.t === 'actions'))) {
          i = j - 1;
          const combined = [n, ...frags].flatMap((pp) => (pp.t === 'sup' || pp.t === 'sub' || pp.t === 'actions' ? [pp] : pp.c || []));
          if (cw) {
            const drop = isCardFurnitureP(n, cw.head) ? 'card-furniture' : meta && cardDropsMetaP(n, cw) ? 'card-printed' : null;
            emit(out, inlineRuns(combined), hiddenBy, drop, meta ? 'meta' : 'p');
            continue;
          }
          emit(out, inlineRuns(combined), hiddenBy, meta && hideMeta ? 'meta-line' : null, meta ? 'meta' : 'p');
          continue;
        }
      }
    }
    renderBlock(n, hideMeta, out, hiddenBy, cw);
  }
  return out;
}

function emit(out, runs, hiddenBy, rule, kind) {
  const why = hiddenBy ?? rule;
  out.push({ runs, text: runsText(runs), shown: !why, rule: why ?? undefined, kind });
}

function renderBlock(n, hideMeta, out, hiddenBy, card = undefined) {
  switch (n.t) {
    case 'traits':
      return;
    case 'title': {
      if (Number(n.level ?? 1) <= 1) return;
      const inner = titleInline(n);
      if (!inner.length) return;
      const runs = inlineRuns(inner);
      if (n.right) runs.push({ t: String(n.right) });
      emit(out, runs, hiddenBy, null, 'heading');
      return;
    }
    case 'heading':
      emit(out, inlineRuns(n.c), hiddenBy, null, 'heading');
      return;
    case 'hr':
      return;
    case 'p': {
      const raw = textOf(n).trim();
      if (!raw || markerOnly(raw)) return;
      if (card) {
        // Card step 5: AstRenderer's card branch — furniture leaves; a META line shows (full weight or
        // dim) unless the surface printed every label it leads with, in the header.
        if (isCardFurnitureP(n, card.head)) { emit(out, inlineRuns(n.c), hiddenBy, 'card-furniture', 'p'); return; }
        if (isMetaP(n)) { emit(out, inlineRuns(n.c), hiddenBy, cardDropsMetaP(n, card) ? 'card-printed' : null, 'meta'); return; }
      }
      if (isMetaP(n)) { emit(out, inlineRuns(n.c), hiddenBy, hideMeta ? 'meta-line' : null, 'meta'); return; }
      if (successTier(n)) {
        // The degree-of-success row: its label and the rest, joined by a space (ast-ds).
        const kids = n.c || [];
        const idx = kids.findIndex((x) => !(x.t === 'text' && !textOf(x).trim()));
        emit(out, [{ t: textOf(kids[idx]).trim() }, { t: ' ' }, ...inlineRuns(kids.slice(idx + 1))], hiddenBy, null, 'ds');
        return;
      }
      emit(out, inlineRuns(n.c), hiddenBy, null, 'p');
      return;
    }
    case 'actions':
      if (String(n.string || '').trim()) emit(out, [{ t: glyphText(n.string) }], hiddenBy, null, 'glyph');
      return;
    case 'spoilers': {
      const inner = n.c && n.c[0] ? n.c[0] : n;
      emit(out, inlineRuns(inner.c ?? []), hiddenBy, card || hideMeta ? 'spoiler' : null, 'spoiler');
      return;
    }
    case 'ul':
    case 'ol':
      for (const li of (n.c || []).filter((c) => c.t === 'li')) walkBlocks(li.c || [], hideMeta, out, hiddenBy, card);
      return;
    case 'table': {
      const rows = [];
      (function collect(x) {
        for (const c of x.c || []) {
          if (c.t === 'tr') rows.push(c);
          else if (c.t === 'thead' || c.t === 'tbody' || c.t === 'tfoot') collect(c);
        }
      })(n);
      for (const tr of rows) for (const cell of (tr.c || []).filter((c) => c.t === 'td' || c.t === 'th')) emit(out, inlineRuns(cell.c), hiddenBy, null, 'cell');
      return;
    }
    case 'aside':
      walkBlocks(n.c || [], hideMeta, out, hiddenBy, card);
      return;
    case 'row': {
      // Card step 5: a 'mine' card never drops a block whole — it recurses.
      if (!card && hideMeta && isMetaishBlock(n)) { walkHidden(n, out, hiddenBy ?? 'metaish-block'); return; }
      const kids = n.c || [];
      if (kids.some((c) => BLOCK_TYPES.has(c.t))) { walkBlocks(kids, hideMeta, out, hiddenBy, card); return; }
      const parts = kids.filter((f) => textOf(f).trim());
      if (card) {
        // Filtered per bold-label segment: the kept parts as one line, each printed part left out (S-printed).
        const keep = cardRowParts(parts, card);
        for (const f of parts) if (!keep.includes(f)) emit(out, inlineRuns(f.c ?? []), hiddenBy, 'card-printed', 'row');
        if (keep.length) emit(out, keep.flatMap((f, m) => [...(m > 0 ? [{ t: '; ' }] : []), ...inlineRuns(f.c ?? [])]), hiddenBy, null, 'row');
        return;
      }
      if (!parts.length) return;
      const runs = parts.flatMap((f, m) => [...(m > 0 ? [{ t: '; ' }] : []), ...inlineRuns(f.c ?? [])]);
      emit(out, runs, hiddenBy, hideMeta ? 'inline-row' : null, 'row');
      return;
    }
    case 'column':
      if (!card && hideMeta && isMetaishBlock(n)) { walkHidden(n, out, hiddenBy ?? 'metaish-block'); return; }
      walkBlocks(n.c || [], hideMeta, out, hiddenBy, card);
      return;
    case 'document':
    case 'doc':
      walkBlocks(n.c || [], hideMeta, out, hiddenBy, card);
      return;
    case 'view':
      emit(out, inlineRuns(n.c), hiddenBy, null, 'p');
      return;
    default:
      if ((n.c || []).some((c) => BLOCK_TYPES.has(c.t))) walkBlocks(n.c || [], hideMeta, out, hiddenBy, card);
      else emit(out, inlineRuns(n.c ?? (n.t === 'text' ? [n] : [])), hiddenBy, null, 'loose');
  }
}

/** A block dropped whole: its insides as the browse popup would draw them, every one hidden by `rule`. */
function walkHidden(n, out, rule) {
  walkBlocks([n], false, out, rule);
}

/**
 * The body of a tree as a popup draws it (no header title, no trait chips). `card` ({printed: Set of
 * canonical labels}) draws it as a 'mine' card does (card step 5): the printed set replaces hideMeta.
 */
export function treeBlocks(tree, { hideMeta = false, itemLists = true, card = undefined } = {}) {
  const t = itemLists ? tree : withoutItemLists(tree);
  const top = t.c || [];
  if (card) return walkBlocks(top, false, [], null, { printed: card.printed, head: false }, cardHeadUntil(top)).filter((b) => /[A-Za-z0-9]/.test(b.text));
  return walkBlocks(top, hideMeta).filter((b) => /[A-Za-z0-9]/.test(b.text));
}

/** The action glyph hoisted into the level-1 title (the popup header's cost). */
export function titleGlyph(tree) {
  const top = tree?.c || [];
  const title = top.find((n) => n.t === 'title' && Number(n.level || 1) <= 1) || top.find((n) => n.t === 'title');
  let found = false;
  (function find(x) { if (!x || found) return; if (x.t === 'actions' && String(x.string || '').trim()) found = true; (x.c || []).forEach(find); })(title);
  return found;
}

/** Title text of a tree, as the popup header reads it. */
export function titleOf(tree) {
  const top = tree?.c || [];
  const title = top.find((n) => n.t === 'title' && Number(n.level || 1) <= 1) || top.find((n) => n.t === 'title');
  return title ? textOf(title.c?.find((x) => x.t === 'link' || x.t === 'text') || title).trim() : '';
}

/* ------------------------------------------------------------------------------------------------ */
/* 4. Markdown bodies (the description-string lane: spells, feat actions, fallbacks).                */
/* ------------------------------------------------------------------------------------------------ */

/**
 * "**Area** 1 cubic foot" → runs, with RichText's own inline grammar (RichText.tsx `inline`): its
 * cleanRun first, then **bold** / *italic* / ⟦highlight⟧ / ⟨glyph⟩ by the same alternation.
 */
export function markdownRuns(text, cleanRun = (s) => s) {
  const s = cleanRun(String(text ?? ''));
  const runs = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|⟦([^⟧]+)⟧|⟨([^⟩]+)⟩/g;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) runs.push({ t: s.slice(last, m.index) });
    if (m[1] != null) runs.push({ b: m[1] });
    else runs.push({ t: m[2] ?? m[3] ?? m[4] });
    last = re.lastIndex;
  }
  if (last < s.length) runs.push({ t: s.slice(last) });
  return runs;
}

/** A markdown body's blocks through the app's own block parser (RichText.parseBlocks, injected). */
export function markdownBlocks(text, parseBlocks, cleanRun) {
  if (!text) return [];
  const out = [];
  const add = (s) => { const runs = markdownRuns(s, cleanRun); const t = runsText(runs); if (/[A-Za-z0-9]/.test(t)) out.push({ runs, text: t, shown: true, kind: 'md' }); };
  for (const b of parseBlocks(String(text))) {
    if (b.kind === 'p' || b.kind === 'h') add(b.text);
    else if (b.kind === 'ds') add(b.text);
    else if (b.kind === 'ul' || b.kind === 'ol') b.items.forEach(add);
    else if (b.kind === 'table') { b.headers.forEach(add); b.rows.forEach((r) => r.forEach(add)); }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* 5. Verdicts.                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

/** Label → {value} of the first line naming it, over a list of blocks. */
export function labelsOf(blocks) {
  const m = new Map();
  for (const b of blocks) for (const s of labelSegments(b.runs)) if (!m.has(s.label)) m.set(s.label, s.value);
  return m;
}

/**
 * Per-label verdict for one (surface, record):
 *   page    — label → value on the record's own page (the browse view);
 *   body    — labels the surface's body text shows as label lines;
 *   printed — label → value the surface's stat rows print;
 *   glyph   — the page's title carries an action glyph (it prints the cost, so Activate / Cast rows
 *             are not EXTRA).
 * Returns only the labels that are not OK.
 */
export function labelVerdicts({ page, body, printed, glyph, base }) {
  const out = {};
  const all = new Set([...page.keys(), ...body, ...printed.keys()]);
  for (const L of all) {
    const P = page.has(L);
    const S = printed.has(L);
    const B = body.has(L);
    let v = 'OK';
    if (P) {
      if (S && B) v = 'DUPLICATED';
      else if (S) v = DIFF_LABELS.has(L) && !sameValue(L, printed.get(L), page.get(L)) ? 'DIFFERS' : 'OK';
      else if (!B) v = 'MISSING';
    } else if (S) {
      if ((L === 'Activate' || L === 'Cast') && glyph) v = B ? 'DUPLICATED' : 'OK';
      // "—" states nothing (formatBulk / formatItemPrice's empty marker), so it claims no line.
      else if (/^[—–-]?$/.test(String(printed.get(L)).trim())) v = 'OK';
      // A specific item's page prints "Base Weapon Trident": its chassis rows are printed by reference.
      else if (base && BASE_CHASSIS.has(L)) v = 'OK';
      else v = 'EXTRA';
    } else if (B) {
      v = 'EXTRA';
    }
    if (v !== 'OK') out[L] = v;
  }
  return out;
}

/** The rows a "Base Weapon / Base Armor / Base Shield <name>" line prints by reference. */
const BASE_CHASSIS = new Set(['Category', 'Group', 'Damage', 'Range', 'Reload', 'Hands', 'Usage', 'Bulk', 'AC Bonus', 'Dex Cap', 'Check Penalty', 'Speed Penalty', 'Strength', 'Hardness', 'HP', 'BT']);
/** Does the page print a "Base Weapon|Armor|Shield" line (a block opening with that bold label)? */
export function refsBase(blocks) {
  return blocks.some((b) => {
    const first = b.runs.find((r) => (r.t ?? r.b ?? '').trim());
    return !!first && first.b != null && /^base (weapon|armou?r|shield)s?\b/i.test(first.b.trim());
  });
}

/** Printed stat rows → label → value (labels outside the vocabulary are ours and not judged). */
export function printedMap(rows) {
  const m = new Map();
  for (const [k, v] of rows) {
    const lab = canonLabel(k);
    if (lab && !m.has(lab)) m.set(lab, v == null ? '' : String(v));
  }
  return m;
}

/* ------------------------------------------------------------------------------------------------ */
/* 6. S2 — the record's own page? (promoted from the refuters' shared-page census).                   */
/* ------------------------------------------------------------------------------------------------ */

const flatText = (n) => (n.t === 'text' ? n.v ?? '' : (n.c ?? []).map(flatText).join(''));
const isSection = (n) => n.t === 'title' && Number(n.level ?? 1) === 2;
const flatTitle = (node) => {
  const t = (node.c ?? []).find((n) => n.t === 'title' && Number(n.level ?? 1) <= 1);
  return t ? flatText(t).replace(/\s+/g, ' ').trim() : '';
};
const words = (s) => String(s ?? '').toLowerCase().replace(/\{@[a-z]+ ([^}|]+)(\|[^}]*)?\}/gi, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();
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

/**
 * The census rule (docs/display-truth-plan.md S2): among records whose tree shares its page (`url`)
 * with another record of the bucket, the shown tree (after variantSection) is NOT the record's own when
 * it is byte-identical to a differently named record's, or lacks the record's own text, or is a family /
 * other record's page. Returns slug → verdict for the WRONG (and UNDECIDED) ones only. A port of the
 * refuters' scratch shared-page-census.mjs, whose port of variantSection was checked identical on
 * 18,666 slugs; here variantSection is the real one.
 */
export function sharedPageCensus(trees, recs) {
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
    const shown = variantSection(node, slug);
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
      const { shown, key, cut } = shownOf.get(slug);
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
      const sents = dRaw.split(/(?<=[.!?])\s+|\n+/).map(words).filter((w) => w.split(' ').length >= 6);
      const pageW = ' ' + words(flatText(shown)) + ' ';
      const coverage = sents.length ? sents.filter((w) => pageW.includes(' ' + w + ' ') || pageW.includes(w)).length / sents.length : null;
      const ownOn = coverage === null ? null : coverage >= 0.6;
      let cls;
      if (cut) cls = 'RIGHT_CUT';
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
      const verdict =
        cls.startsWith('RIGHT') ? 'RIGHT'
        : cls === 'WRONG_MISSED' ? 'WRONG_FAMILY_PAGE_AON'
        : family && coverage !== null && coverage < 1 && ratio != null && ratio <= 1.6 ? 'WRONG_FAMILY_VARIANT_TEXT_ABSENT'
        : own === 'present' && ratio != null && ratio <= 1.6 ? 'RIGHT_SAME_TEXT'
        : own === 'present' ? (family ? 'WRONG_FAMILY_OVERSHOW' : 'WRONG_OTHER_OVERSHOW')
        : own === 'absent' ? (family ? 'WRONG_FAMILY_VARIANT_TEXT_ABSENT' : 'WRONG_OTHER_PAGE')
        : 'UNDECIDED';
      if (!verdict.startsWith('RIGHT')) out[slug] = verdict;
    }
  }
  return out;
}

/** The page's "Class <Name>" header label (an AoN Classes.aspx slice), or undefined. */
export function pageClassName(tree, classNames) {
  const t = flatText(tree).replace(/\s+/g, ' ');
  const m = t.match(/pg\. ?\d+\s*Class ((?:[A-Z][a-z]+)(?: [A-Z][a-z]+)?)/);
  return m ? classNames.find((c) => m[1].startsWith(c)) : undefined;
}

/* ------------------------------------------------------------------------------------------------ */
/* 7. STUBS, OURS-LEAK, CUT-IN-SENTENCE.                                                              */
/* ------------------------------------------------------------------------------------------------ */

/** Empty embedded document stubs ({t:'document', id:'feat-123'}) whose aon id names no record. */
export function unresolvedStubs(tree, aonIds) {
  const out = [];
  (function walk(n, d) {
    if ((n.t === 'document' || n.t === 'doc') && d > 0 && !(n.c && n.c.length) && !(n.id && aonIds.has(String(n.id)))) out.push(n.id ? String(n.id) : '(no id)');
    for (const c of n.c ?? []) walk(c, d + 1);
  })(tree, 0);
  return out;
}

/** App-authored wording that must never sit inside page text (section 4). */
export const OURS_MARKERS = [/⟦/, /\bYour choice:/, /Not yet verified/, /Remastered as\b/, /\(→ /];
export function oursInPage(tree) {
  const t = flatText(tree);
  return OURS_MARKERS.filter((re) => re.test(t)).map(String);
}

/** A dropped block whose next sibling block is shown and opens mid-sentence (lowercase / punctuation). */
export function cutInSentence(blocks) {
  const out = [];
  for (let i = 0; i + 1 < blocks.length; i++) {
    if (!blocks[i].shown && blocks[i + 1].shown && /^[a-z,.;:)\]]/.test(blocks[i + 1].text)) out.push(blocks[i + 1].text.slice(0, 60));
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* 8. Baselines — the two-way shrink-only rule of spell-print-lines-check.mjs / reprint-check CHECK 8. */
/* ------------------------------------------------------------------------------------------------ */

export const SECTIONS = ['S1-MISSING', 'S1-UNNAMED', 'DIFFERS', 'DUPLICATED', 'EXTRA', 'S2-NOT-OWN', 'S3-PLACEMENT', 'S5-IDENTITY', 'CUT-IN-SENTENCE', 'FOLDED-UNLISTED', 'OURS-LEAK', 'STUBS'];

/**
 * Surfaces whose card step has landed and whose switch can be turned back (docs/card-design.md section 9:
 * "Turning a surface back is therefore one line, and its tests still hold"). For each, the baseline keeps
 * under `legacy[surface]` that surface's row entries as measured with its switch OFF; while the switch
 * is off they stand in for the surface's entries in the main sections. Step 22 removes both.
 */
export const SWITCHED_SURFACES = ['statDetail'];

/**
 * The entries the baseline expects under the switches as they are now (`cardOn`, default CARD_ON): the
 * main sections, except that a switched surface that is OFF is expected at its `legacy` entries.
 */
export function expectedEntries(baseline, cardOn = CARD_ON) {
  const out = {};
  for (const s of SECTIONS) out[s] = [...(baseline?.[s] ?? [])];
  for (const surface of SWITCHED_SURFACES) {
    const legacy = baseline?.legacy?.[surface];
    if (cardOn[surface] || !legacy) continue;
    for (const s of SECTIONS) out[s] = out[s].filter((e) => !e.startsWith(`${surface}|`)).concat(legacy[s] ?? []);
  }
  return out;
}

/** A switched surface's row entries in a ledger (`found`), the shape `legacy[surface]` stores. */
export function surfaceEntries(found, surface) {
  const out = {};
  for (const s of ROW_SECTIONS) {
    const e = (found[s] ?? []).filter((x) => x.startsWith(`${surface}|`));
    if (e.length) out[s] = e;
  }
  return out;
}

export function baselineProblems(found, baseline, file, cardOn = CARD_ON) {
  const problems = [];
  const expected = expectedEntries(baseline, cardOn);
  for (const s of SECTIONS) {
    const listed = new Set(expected[s]);
    const now = new Set(found[s] ?? []);
    for (const id of now) if (!listed.has(id)) problems.push(`${s}: ${id} — a NEW offender; fix the record or the surface, never the baseline`);
    for (const id of listed) if (!now.has(id)) problems.push(`${s}: ${id} is in ${file} but is right now — remove the entry (the list only shrinks)`);
  }
  return problems;
}

/* ------------------------------------------------------------------------------------------------ */
/* 9. Surfaces and the ledger.                                                                        */
/* ------------------------------------------------------------------------------------------------ */

/** The surfaces section 6 names, each modelled from the component's own props. */
export const SURFACES = ['featDetail', 'itemDetail', 'spellDetail', 'actionDetail', 'statDetail', 'browse', 'choiceDetails', 'builderOrigin', 'pin'];

const isActionCost = (c) => !!c && (c.type === 'actions' || c.type === 'reaction' || c.type === 'free' || c.type === 'variable' || c.type === 'duration');
const actionId = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const SITUATIONAL_COLLECTIONS = ['feats', 'items', 'heritages', 'backgrounds', 'ancestries', 'classFeatures'];

/**
 * The surface rows the ledger judges. Each row says what the surface READS (tree key/slug or a
 * description string), what it PRINTS in its stat panel, and which record's page is the truth.
 *   row = { surface, bucket, id, key, own:{bucket,id}, read:{bucket,slug}|null, hideMeta, itemLists,
 *           body:'tree'|'md', md?, printed:[[label,value]], mode:'mine'|'browse' }
 */
export function surfaceRows(deps) {
  const { content: db, trees, astIndex, statRows, activities, situationalIds, classFeatureDescription, splitHeightening } = deps;
  const rows = [];
  const has = (b, id) => !!trees[b]?.[id];
  const featEntryLike = (rec) => ({ actionCost: rec.actionCost, prerequisites: rec.prerequisites, traits: rec.traits ?? [] });
  // withPicks (FeatsTab.tsx:108-135) with no picks and no marks: only the record's own note is appended.
  const withNote = (rec, d) => (rec?.note ? `${d}<p><strong>Note:</strong> ${rec.note}</p>` : d);

  // FeatDetail — feats, class features, heritage rows (FeatsTab featEntries → FeatDetail).
  for (const [id, rec] of Object.entries(db.feats ?? {})) {
    if (!has('feats', id)) continue;
    rows.push({ surface: 'featDetail', bucket: 'feats', id, own: { bucket: 'feats', id }, read: { bucket: 'feats', slug: id }, hideMeta: true, itemLists: false, md: withNote(rec, rec.description ?? ''), printed: statRows.featStatRows(featEntryLike(rec)).filter((r) => r.k !== 'Enhancement').map((r) => [r.k, r.v ?? '']), mode: 'mine' });
  }
  for (const [id, rec] of Object.entries(db.classFeatures ?? {})) {
    if (!has('classFeatures', id)) continue;
    rows.push({ surface: 'featDetail', bucket: 'classFeatures', id, own: { bucket: 'classFeatures', id }, read: { bucket: 'classFeatures', slug: id }, hideMeta: true, itemLists: false, md: withNote(rec, rec.description ?? ''), printed: statRows.featStatRows(featEntryLike(rec)).map((r) => [r.k, r.v ?? '']), mode: 'mine' });
  }
  for (const [id, rec] of Object.entries(db.heritages ?? {})) {
    if (!has('heritages', id)) continue;
    // A heritage row is `isFeature`, so FeatDetail reads classFeatures by the slug of its NAME (FeatDetail.tsx:97-99).
    rows.push({ surface: 'featDetail', bucket: 'heritages', id, own: { bucket: 'heritages', id }, read: { bucket: 'classFeatures', slug: astSlug(rec.name) }, hideMeta: true, itemLists: false, md: rec.description ?? '', printed: statRows.featStatRows(featEntryLike(rec)).map((r) => [r.k, r.v ?? '']), mode: 'mine' });
  }
  // A shared class feature shown to a class whose page it is not (the class-feature rows of every class).
  const classNames = Object.values(db.classes ?? {}).map((c) => c.name);
  const classMismatch = [];
  for (const cls of Object.values(db.classes ?? {})) {
    for (const f of cls.features ?? []) {
      const t = trees.classFeatures?.[f.featureId];
      if (!t || !db.classFeatures?.[f.featureId]) continue;
      const pc = pageClassName(t, classNames);
      if (pc && pc !== cls.name) classMismatch.push(`classFeatures:${f.featureId}@${cls.id}`);
    }
  }

  // ItemDetail — every item with a page, plus a hidden cursed item wearing its twin (playerFacingContent).
  for (const [id, item] of Object.entries(db.items ?? {})) {
    if (has('items', id)) rows.push({ surface: 'itemDetail', bucket: 'items', id, own: { bucket: 'items', id }, read: { bucket: 'items', slug: id }, hideMeta: true, itemLists: false, md: item.description ?? '', printed: statRows.itemStatRows(item, db).map((r) => [r.k, r.v]), mode: 'mine' });
    const twin = item.disguisedAs ? db.items[item.disguisedAs] : undefined;
    if (twin && has('items', twin.id)) {
      const shown = { ...twin, id };
      rows.push({ surface: 'itemDetail', bucket: 'items', id: `${id}~hidden`, own: { bucket: 'items', id: twin.id }, read: { bucket: 'items', slug: id }, hideMeta: true, itemLists: false, md: shown.description ?? '', printed: statRows.itemStatRows(shown, db).map((r) => [r.k, r.v]), mode: 'mine' });
    }
  }

  // SpellDetail — stat rows from fields, the body is the description string (no tree).
  for (const [id, sp] of Object.entries(db.spells ?? {})) {
    if (!has('spells', id)) continue;
    const { base, heightening } = splitHeightening(sp.description || '');
    rows.push({ surface: 'spellDetail', bucket: 'spells', id, own: { bucket: 'spells', id }, read: null, mdParts: [base, ...heightening], printed: statRows.spellStatRows(sp).filter(([k, v]) => k === 'Cast' || v).map(([k, v]) => [k, v ?? '']), mode: 'mine' });
  }

  // ActionDetailModal — curated activities (page through astKey) and feat / class-feature / granted actions (string).
  const activityNames = new Set(activities.map((a) => a.name));
  for (const a of activities) {
    const full = db.actions?.[actionId(a.name)];
    const rec = a.featId ? db.feats?.[a.featId] : undefined;
    const bucket = full ? 'actions' : rec ? 'feats' : null;
    const id = full ? full.id : a.featId;
    if (!bucket || !has(bucket, id)) continue;
    rows.push({ surface: 'actionDetail', bucket, id, own: { bucket, id }, read: { bucket, slug: id }, hideMeta: true, itemLists: false, md: full?.description ?? rec?.description ?? a.desc, printed: [], mode: 'mine', activity: a.name });
  }
  const granted = new Set();
  for (const b of ['feats', 'classFeatures', 'ancestries', 'heritages', 'backgrounds', 'items']) for (const r of Object.values(db[b] ?? {})) for (const g of r?.grantsActions ?? []) granted.add(g);
  for (const b of ['feats', 'classFeatures']) {
    for (const [id, rec] of Object.entries(db[b] ?? {})) {
      if (!has(b, id) || !isActionCost(rec.actionCost) || activityNames.has(rec.name)) continue;
      rows.push({ surface: 'actionDetail', bucket: b, id, own: { bucket: b, id }, read: null, md: rec.description ?? '', printed: [], mode: 'mine' });
    }
  }
  for (const id of granted) {
    const act = db.actions?.[id];
    if (!act || !has('actions', id) || !isActionCost(act.actionCost) || activityNames.has(act.name)) continue;
    if (rows.some((r) => r.surface === 'actionDetail' && r.bucket === 'actions' && r.id === id)) continue;
    rows.push({ surface: 'actionDetail', bucket: 'actions', id, own: { bucket: 'actions', id }, read: null, md: act.description ?? '', printed: [], mode: 'mine' });
  }

  // StatDetailModal full text — the record behind a situational line. With CARD_ON.statDetail (card step
  // 5) it is RecordCard mode 'mine': the printed set (empty — the popup prints no stat rows) replaces
  // hideMeta, and the item lists are cut as before. Switched off, it is the legacy DescBody (hideMeta).
  // `deps.cardOn` (default CARD_ON) lets --write-baseline also measure the switch's off position.
  const statCard = (deps.cardOn ?? CARD_ON).statDetail ? { printed: [] } : undefined;
  for (const sid of situationalIds) {
    const b = SITUATIONAL_COLLECTIONS.find((k) => db[k]?.[sid]);
    if (!b || !has(b, sid) || !db[b][sid].description) continue;
    rows.push({ surface: 'statDetail', bucket: b, id: sid, own: { bucket: b, id: sid }, read: { bucket: b, slug: sid }, hideMeta: !statCard, itemLists: false, card: statCard, md: db[b][sid].description, printed: [], mode: 'mine' });
  }

  // Builder ChoiceDetails — DescriptionModal root {title, description} with no key: the ast index by name.
  const seenChoice = new Set();
  const choiceRow = (bucket, id, name, flavor) => {
    const k = `${bucket}:${id}`;
    if (seenChoice.has(k) || !flavor || !flavor.trim() || !has(bucket, id)) return;
    seenChoice.add(k);
    const slug = astSlug(name);
    // No index entry: the popup resolves no tree and falls back — a read that lands nowhere, never the
    // string lane (`read: null`), so it still counts as IDENTITY while the record has a page.
    const rb = astIndex[slug] ?? '(no index entry)';
    rows.push({ surface: 'choiceDetails', bucket, id, own: { bucket, id }, read: { bucket: rb, slug }, hideMeta: false, itemLists: true, md: flavor, printed: [], mode: 'browse' });
  };
  for (const cls of Object.values(db.classes ?? {})) {
    for (const f of cls.features ?? []) {
      const rec = db.classFeatures?.[f.featureId];
      if (rec) choiceRow('classFeatures', f.featureId, rec.name, classFeatureDescription(rec.description, cls.id, db));
    }
  }
  // The feats a background hands out (build.ts backgroundGrantedFeats: grantedFeatId, or one per skill choice).
  const asList = (g) => (Array.isArray(g) ? g : g ? [g] : []);
  for (const bg of Object.values(db.backgrounds ?? {})) {
    const ids = [...asList(bg?.grantedFeatId), ...Object.values(bg?.grantedFeatByChoice ?? {}).flatMap(asList)];
    for (const gid of ids) {
      const ft = typeof gid === 'string' ? db.feats?.[gid] : undefined;
      if (ft) choiceRow('feats', ft.id, ft.name, ft.description);
    }
  }

  // The builder's background picker — descNodeOf(…, 'origin'): key 'origin', no id (shared.tsx:956).
  for (const [id, bg] of Object.entries(db.backgrounds ?? {})) {
    if (!has('backgrounds', id) || !(bg.description || bg.descRefs?.length)) continue;
    rows.push({ surface: 'builderOrigin', bucket: 'backgrounds', id, own: { bucket: 'backgrounds', id }, read: { bucket: 'origin', slug: astSlug(bg.name) }, hideMeta: false, itemLists: true, md: bg.description ?? '', printed: [], mode: 'browse' });
  }

  // The browse popup (DescriptionModal / RecordCard) by {bucket, id}: the whole page, never scoped.
  // Every bucket that has both records and pages — the search popup opens any of them.
  for (const b of Object.keys(trees).sort()) {
    for (const [id, rec] of Object.entries(db[b] ?? {})) {
      if (!rec || typeof rec !== 'object' || !has(b, id)) continue;
      rows.push({ surface: 'browse', bucket: b, id, own: { bucket: b, id }, read: { bucket: b, slug: id }, hideMeta: false, itemLists: true, md: rec.description ?? '', printed: [], mode: 'browse' });
    }
  }

  // A PinStar from FeatDetail / ItemDetail / SpellDetail: {title, key} and no slug → key + astSlug(title).
  const pinKey = { feats: 'feats', classFeatures: 'classFeatures', heritages: 'classFeatures', items: 'items', spells: 'spells' };
  for (const [b, key] of Object.entries(pinKey)) {
    for (const [id, rec] of Object.entries(db[b] ?? {})) {
      if (!has(b, id)) continue;
      rows.push({ surface: 'pin', bucket: b, id, own: { bucket: b, id }, read: { bucket: key, slug: astSlug(rec.name) }, hideMeta: false, itemLists: true, md: rec.description ?? '', printed: [], mode: 'browse' });
    }
  }

  return { rows, classMismatch };
}

/** The tree a read lands on, through useAstNode's variantSection cut. */
export function readTree(trees, read) {
  if (!read) return undefined;
  const t = trees[read.bucket]?.[read.slug];
  return t ? variantSection(t, read.slug) : undefined;
}

/**
 * Judge one row. `parseBlocks` is RichText's block parser (the markdown lane). Returns
 * {labels:{L:verdict}, identity:bool, placement:[labels], cut:[...], oursLeak:[...], tree:'read'|'md'|'none'}.
 */
export function judgeRow(row, trees, mdFns) {
  const { parseBlocks, cleanRun } = typeof mdFns === 'function' ? { parseBlocks: mdFns } : mdFns;
  const ownTree = readTree(trees, { bucket: row.own.bucket, slug: row.own.id });
  const pageBlocks = ownTree ? treeBlocks(ownTree) : [];
  const page = labelsOf(pageBlocks);
  const ownText = pageBlocks.map((b) => squash(b.text)).join('|');
  const printed = printedMap(row.printed);
  const glyph = titleGlyph(ownTree);
  const resolved = row.read ? readTree(trees, row.read) : undefined;
  let bodyBlocks;
  let identity = false;
  const res = { surface: row.surface, bucket: row.bucket, id: row.id };
  if (row.read === null) {
    // The description-string lane: spells, feat actions — never a tree.
    bodyBlocks = (row.mdParts ?? [row.md]).flatMap((t) => markdownBlocks(t, parseBlocks, cleanRun));
    res.lane = 'md';
  } else if (resolved) {
    // A 'mine' card row (card step 5) draws with the surface's printed set instead of hideMeta.
    const card = row.card ? { printed: printedSet(row.card.printed) } : undefined;
    const all = treeBlocks(resolved, { hideMeta: row.hideMeta, itemLists: row.itemLists, card });
    bodyBlocks = all.filter((b) => b.shown);
    res.lane = 'tree';
    // What the surface's own walk dropped, with the path that dropped it (meta-line, … or, on a card,
    // the section 2 rule 5 name: S-furniture, S-printed).
    res.hidden = all.filter((b) => !b.shown).map((b) => ({ text: b.text, rule: b.rule }));
    // S-items: what withoutItemLists cut (DescBody, the popup of a thing the character HAS).
    if (!row.itemLists) {
      const kept = new Set(treeBlocks(resolved, { hideMeta: row.hideMeta, card }).map((b) => b.text));
      for (const b of all) kept.delete(b.text);
      for (const t of kept) res.hidden.push({ text: t, rule: 'S-items' });
    }
    res.cut = cutInSentence(all);
    // Identity: every block the surface draws must be the own page's.
    identity = !!ownTree && bodyBlocks.some((b) => !ownText.includes(squash(b.text)));
    if (row.mode === 'browse') identity = !!ownTree && (identity || squash(all.map((b) => b.text).join(' ')) !== squash(pageBlocks.map((b) => b.text).join(' ')));
  } else {
    // A read that finds no tree falls back to the description string — wrong only while the record HAS a page.
    bodyBlocks = markdownBlocks(row.md, parseBlocks, cleanRun);
    res.lane = 'fallback';
    identity = !!ownTree;
  }
  res.identity = identity;
  // The omission log: every line of the record's own page a 'mine' tree surface leaves out, with the
  // rule that allows it — or MISSING / UNNAMED. On another record's tree (identity) the lines are a
  // different record's and IDENTITY already counts the row.
  res.omitted = row.mode === 'mine' && res.lane === 'tree' && !identity && ownTree ? omissionLog(pageBlocks, bodyBlocks, res.hidden, printed) : [];
  res.unnamed = [...new Set(res.omitted.flatMap((o) => o.unnamed))].sort();
  const body = bodyLabels(bodyBlocks, row.surface);
  // A browse-mode popup on another record's page is an identity failure; comparing its lines with the
  // own page would be comparing two records.
  res.labels = row.mode === 'browse' && identity ? {} : labelVerdicts({ page, body, printed, glyph, base: refsBase(pageBlocks) });
  res.placement = row.surface === 'spellDetail' ? [...body].sort() : [];
  // OURS-LEAK: ours wording in the page itself, or the string lane carrying appended ours HTML into a
  // body that is not an ours box (withPicks' "Note:" on a record with no tree to read).
  res.oursLeak = [...oursInPage(ownTree ?? {}), ...((res.lane === 'fallback' || res.lane === 'md') && /<p><strong>(Note|Your choice):<\/strong>/.test(row.md ?? '') ? ['appended-ours-html'] : [])];
  return res;
}

/** The row key every per-row entry starts with. */
export const rowKey = (row) => `${row.surface}|${row.bucket}:${row.id}`;

/**
 * One judged row's baseline entries, as [section, entry] pairs — the per-row sections only (S2 and
 * STUBS are keyed by record). test/card-parity.test.tsx checks its sample against the baseline with this.
 */
export function rowEntries(row, r, foldsOf) {
  const key = rowKey(row);
  const out = [];
  for (const [L, v] of Object.entries(r.labels)) out.push([v === 'MISSING' ? 'S1-MISSING' : v, `${key}|${L}`]);
  for (const u of r.unnamed ?? []) out.push(['S1-UNNAMED', `${key}|${u}`]);
  for (const L of r.placement) out.push(['S3-PLACEMENT', `${key}|${L}`]);
  if (r.identity) out.push(['S5-IDENTITY', key]);
  for (const c of r.cut ?? []) out.push(['CUT-IN-SENTENCE', `${key}|${c}`]);
  for (const o of r.oursLeak) out.push(['OURS-LEAK', `${key}|${o}`]);
  // FOLDED-UNLISTED: a fold cardScope makes that level-folds.json does not list. No surface folds yet
  // (step 13); foldsOf comes from src/sheet/cardScope.ts, so the day it folds, this section measures it.
  for (const f of foldsOf?.(row) ?? []) if (!f.listed) out.push(['FOLDED-UNLISTED', `${key}|${f.id}`]);
  return out;
}
/** Sections whose entries are keyed by row (and so can be compared on a sample of rows). */
export const ROW_SECTIONS = ['S1-MISSING', 'S1-UNNAMED', 'DIFFERS', 'DUPLICATED', 'EXTRA', 'S3-PLACEMENT', 'S5-IDENTITY', 'CUT-IN-SENTENCE', 'FOLDED-UNLISTED', 'OURS-LEAK'];

/** The whole ledger: sections → sorted entry ids. */
export function computeLedger(deps) {
  const { content: db, trees, parseBlocks, cleanRun, foldsOf } = deps;
  const { rows, classMismatch } = surfaceRows(deps);
  const found = Object.fromEntries(SECTIONS.map((s) => [s, []]));
  const counts = {};
  const judged = [];
  for (const row of rows) {
    const r = judgeRow(row, trees, { parseBlocks, cleanRun });
    judged.push(r);
    counts[row.surface] = (counts[row.surface] ?? 0) + 1;
    for (const [sec, e] of rowEntries(row, r, foldsOf)) found[sec].push(e);
  }
  // S2 and STUBS are properties of a record's page, the same on every surface that draws it: keyed by
  // record. Both run over EVERY shipped bucket, not only the ones a modelled surface draws: the search
  // popup opens any page (familiarAbilities, conditions, deities …), and section 2 rule 6 lists every
  // unresolved stub, archetype / rules / way pages included.
  const aonIds = new Set();
  for (const recs of Object.values(db)) if (recs && typeof recs === 'object') for (const r of Object.values(recs)) if (r && typeof r.aonId === 'string') aonIds.add(r.aonId);
  let stubOccurrences = 0;
  for (const b of Object.keys(trees).sort()) {
    if (db[b] && typeof db[b] === 'object') {
      const census = sharedPageCensus(trees[b] ?? {}, db[b]);
      for (const [slug, v] of Object.entries(census)) found['S2-NOT-OWN'].push(`${b}:${slug}|${v}`);
    }
    // The whole stored tree (a stub is unresolved wherever it sits), whether or not a record owns it.
    for (const [slug, t] of Object.entries(trees[b] ?? {})) {
      const stubs = unresolvedStubs(t, aonIds);
      stubOccurrences += stubs.length;
      for (const s of new Set(stubs)) found.STUBS.push(`${b}:${slug}|${s}`);
    }
  }
  for (const k of classMismatch) found['S2-NOT-OWN'].push(`${k}|CLASS_MISMATCH`);
  for (const s of SECTIONS) found[s] = [...new Set(found[s])].sort();
  return { found, counts, judged, rows, stubOccurrences };
}
