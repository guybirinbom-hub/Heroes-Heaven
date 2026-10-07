/**
 * The spell popup's card model — card step 16, spells phase A (docs/card-design.md section 9 row 16;
 * section 5 rows "Spell stat rows from fields; our Defense wording", "Area suffix", "Cast-at"; section 13:
 * cards first, mechanics untouched).
 *
 * SpellDetail's stat rows come from the record's Archives PAGE instead of the stored fields: the page
 * header's labelled lines, in printed order, under the card vocabulary (Saving Throw reads as Defense,
 * Target / Target(s) as Targets). The stored fields stay exactly as they are — the engine reads them;
 * the card only stops PRINTING them where the page prints its own line (an EXTRA field row, like Buzzing
 * Servants' Area, is not shown while a page exists). The field rows are the fallback only when the spell
 * has no tree, or its tree is not a spell / ritual page.
 *
 * The BODY stays the description string in phase A (the damage arrow and the heightening split read it;
 * phase B, step 17, moves it to the tree). `stripPrintedPreamble` removes from that string only what the
 * rows now print: a leading bold "**Area** …" line, or the scraped plain "Name / Source … pg. N / Cast … /
 * Area …" header — each label line only when the rows printed that label; the scrape's name, spoiler,
 * Source and where-to-get lines (S-furniture) go with it. Nothing inside a sentence is touched.
 *
 * A plain .ts file with no JSX and no stylesheet: the guard (scripts/lib/card-scope.mjs, through jiti)
 * models the spell popup with `spellCardModel` — the SAME functions SpellDetail renders with.
 */
import type { AstNode } from './astStore';
import type { Spell } from '../rules/types';
import { cardHeadUntil, clean, textOf } from './astVisibility';
import { canonLabel } from './cardScope';
import { splitHeightening } from '../rules/heightening';

/** The labels a spell popup prints as stat rows, in the card vocabulary (cardScope LABEL_ALIASES). */
export const SPELL_ROW_LABELS = [
  'Cast',
  'Trigger',
  'Requirements',
  'Cost',
  'Secondary Casters',
  'Primary Check',
  'Secondary Checks',
  'Range',
  'Area',
  'Targets',
  'Duration',
  'Defense',
] as const;
export type SpellRowLabel = (typeof SPELL_ROW_LABELS)[number];
const ROW_SET: ReadonlySet<string> = new Set(SPELL_ROW_LABELS);

/** One labelled line of the page header: its canonical label, the label as printed, and its value. */
export interface PageStatLine {
  label: SpellRowLabel;
  printedAs: string;
  value: string;
}

/** The page's title badge ("Spell 3", "Focus 5", "Cantrip 1", "Ritual 4"). */
export function pageBadge(tree: AstNode | undefined): string {
  const title = (tree?.c ?? []).find((n) => n.t === 'title');
  return String(title?.right ?? '').trim();
}

/** Is this tree a spell or ritual page? 8 spell records' trees are a feat, rules or hazard page instead
 *  (measured on the shipped public/ast/spells.json.gz: Spell 1,225, Focus 508, Ritual 164, Cantrip 119,
 *  Feat 6, Rules 1, Hazard 1) — those keep the field rows. */
export function isSpellPage(tree: AstNode | undefined): boolean {
  return /^(?:spell|focus|cantrip|ritual)\b/i.test(pageBadge(tree));
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A block's segments: every bold run that opens it (at its start, or after a ";") starts a segment;
 *  everything after it, up to the next such run, is that segment's value. The same opening rule as
 *  astVisibility nodeLeads. */
function segmentsOf(p: AstNode): { lead: string; value: string }[] {
  const out: { lead: string; value: string }[] = [];
  let before = '';
  let cur: { lead: string; value: string } | null = null;
  const add = (s: string) => {
    before += s;
    if (cur) cur.value += s;
  };
  const visit = (k: AstNode) => {
    if (k.t === 'b') {
      const t = textOf(k);
      if (t.trim() && (!before.trim() || /;\s*$/.test(before))) {
        if (cur) cur.value = cur.value.replace(/;\s*$/, '');
        cur = { lead: squash(t).replace(/[:：]$/, '').trim(), value: '' };
        out.push(cur);
        before = '';
        return;
      }
      add(t);
      return;
    }
    if (k.t === 'text') return add(clean(k.v ?? ''));
    if (k.t === 'br') return add(' ');
    for (const c of k.c || []) visit(c);
  };
  for (const c of p.c || []) visit(c);
  return out.map((s) => ({ lead: s.lead, value: squash(s.value).replace(/;$/, '').trim() }));
}

/**
 * The page header's labelled lines, in printed order: every line before the page's first rule whose
 * label is in the spell row vocabulary. The where-to-get lines (Traditions, Deities, Domain, Bloodline,
 * Mystery, Lesson, Patron, Spell Lists), Source, PFS Note and anything else are not rows. A page with no
 * rule has no header (cardHeadUntil: never cut what we cannot place) and so no rows.
 */
export function pageStatLines(tree: AstNode | undefined): PageStatLine[] {
  const top = tree?.c ?? [];
  const until = cardHeadUntil(top);
  if (until < 0) return [];
  const out: PageStatLine[] = [];
  const walk = (n: AstNode) => {
    if (n.t === 'title' || n.t === 'traits') return;
    if (n.t === 'p') {
      for (const s of segmentsOf(n)) {
        const c = canonLabel(s.lead);
        if (c && ROW_SET.has(c)) out.push({ label: c as SpellRowLabel, printedAs: s.lead, value: s.value });
      }
      return;
    }
    for (const c of n.c || []) walk(c);
  };
  for (const n of top.slice(0, until)) walk(n);
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* stripPrintedPreamble                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const BOLD_LEAD = /^\*\*([^*]+)\*\*/;
/** Header labels in a scraped plain header (case-sensitive: header labels are capitalised). */
const PLAIN_LABEL = /(?:^|[\s;])(Secondary Casters|Primary Check|Secondary Checks|Saving Throw|Target\(s\)|Targets|Target|Requirements|Requirement|Cast|Cost|Range|Area|Duration|Defense|Trigger)(?=\s)/g;
const PLAIN_OPEN = /^(Secondary Casters|Primary Check|Secondary Checks|Saving Throw|Target\(s\)|Targets|Target|Requirements|Requirement|Cast|Cost|Range|Area|Duration|Defense|Trigger)\s/;
/** S-furniture inside a scraped header: the where-to-get lines (section 2 rule 5c). */
const WHERE_TO_GET = /^(?:Traditions?|Deities|Deity|Domains?|Bloodlines?|Mysteries|Mystery|Lessons?|Patron Themes?|Patrons?|Spell Lists?)\s/;
const SPOILER = /^May contain spoilers\b/i;
const SOURCE_LINE = /^Source\s.*\bpg\.?\s*\d+/;
/** The scrape's mark (card-scope.mjs plainHeaderLabels uses the same test). */
const SCRAPED = /\bSource\s.{1,120}?\bpg\.?\s*\d+/;
const slugOf = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');

/**
 * The description string with the preamble the stat rows now print taken off its front.
 *  - Leading bold label lines ("**Area** 1 cubic foot", "**Trigger** …"): a line goes when every
 *    vocabulary label it opens with is in `printed`; a line naming a label the rows did not print stays.
 *    When every one went, the "---" rule that closed the preamble goes too.
 *  - A scraped plain header (a "Source … pg. N" line in the first 160 characters): its name line,
 *    spoiler banner, Source line and where-to-get lines go (S-furniture); each label line goes only when
 *    the rows printed all its labels. The header ends at the first line that is none of these.
 * Returns the string byte-identical when nothing is removed.
 */
export function stripPrintedPreamble(md: string, printed: ReadonlySet<string>, name?: string): string {
  if (!md) return md;
  const lines = md.split('\n');
  let changed = false;

  // 1. Leading bold label lines.
  {
    let i = 0;
    let dropped = 0;
    let kept = 0;
    const keep: string[] = [];
    for (; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) { keep.push(lines[i]); continue; }
      const m = BOLD_LEAD.exec(l);
      const c = m ? canonLabel(m[1]) : null;
      if (!c || !ROW_SET.has(c)) break;
      const labels = [...l.matchAll(/\*\*([^*]+)\*\*/g)].map((x) => canonLabel(x[1])).filter((x): x is string => !!x && ROW_SET.has(x));
      if (labels.every((x) => printed.has(x))) dropped++;
      else { kept++; keep.push(lines[i]); }
    }
    if (dropped) {
      let rest = lines.slice(i);
      if (!kept) {
        // The rule that closed the preamble, with the blank lines around it.
        let j = 0;
        while (j < rest.length && !rest[j].trim()) j++;
        if (j < rest.length && /^-{3,}$/.test(rest[j].trim())) {
          j++;
          while (j < rest.length && !rest[j].trim()) j++;
          rest = rest.slice(j);
        }
      }
      lines.splice(0, lines.length, ...(kept ? keep : []), ...rest);
      changed = true;
    }
  }

  // 2. A scraped plain header.
  if (SCRAPED.test(lines.join('\n').slice(0, 160))) {
    const nextFilled = (from: number) => {
      for (let k = from; k < lines.length; k++) if (lines[k].trim()) return lines[k].trim();
      return '';
    };
    const out: string[] = [];
    let i = 0;
    let dropped = 0;
    for (; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) { out.push(lines[i]); continue; }
      if (i === 0 && !PLAIN_OPEN.test(l)) {
        const nx = nextFilled(1);
        if ((name && slugOf(l) === slugOf(name)) || SPOILER.test(nx) || SOURCE_LINE.test(nx)) { dropped++; continue; }
      }
      if (SPOILER.test(l) || SOURCE_LINE.test(l) || WHERE_TO_GET.test(l)) { dropped++; continue; }
      if (PLAIN_OPEN.test(l)) {
        const labels = [...l.matchAll(PLAIN_LABEL)].map((x) => canonLabel(x[1])).filter((x): x is string => !!x);
        if (labels.length && labels.every((x) => printed.has(x))) { dropped++; continue; }
        out.push(lines[i]);
        continue;
      }
      break;
    }
    if (dropped) {
      const rest = [...out, ...lines.slice(i)];
      let j = 0;
      while (j < rest.length && !rest[j].trim()) j++;
      lines.splice(0, lines.length, ...rest.slice(j));
      changed = true;
    }
  }

  if (!changed) return md;
  let k = 0;
  while (k < lines.length && !lines[k].trim()) k++;
  return lines.slice(k).join('\n');
}

/* ---------------------------------------------------------------------------------------------- */
/* The model the popup renders and the guard judges                                               */
/* ---------------------------------------------------------------------------------------------- */

/** The field rows the popup printed before step 16 (SpellsTab.tsx spellStatRows — injected, because
 *  it lives in a .tsx file jiti cannot parse). */
export type FieldRows = [string, string | undefined][];

/** A duration cast ("1 hour") prints as words; every other cost is the action glyph. */
export function castWords(spell: Pick<Spell, 'cast'>): string {
  const c = spell.cast;
  return c && c.type === 'duration' ? c.text : '';
}

export interface SpellCardModel {
  /** 'page' = rows from the spell's own page; 'field' = no tree, or a tree that is not a spell page. */
  lane: 'page' | 'field';
  /** The rows as [label, value], in printed order. Cast is always first-or-in-place; its value is the
   *  page's Cast words (or the field's duration words) — the popup draws the glyph beside it. */
  rows: [string, string][];
  /** The labels the rows printed (what stripPrintedPreamble may take off the body). */
  printed: ReadonlySet<string>;
  /** The body string (the heightening split's base, preamble stripped) and the Heightened entries. */
  base: string;
  heightening: string[];
}

/** The page lane's rows: the page's labelled lines, with a Cast row first when the page prints none
 *  (a remastered page carries its cost as the title glyph). A label the page prints with nothing after
 *  it (fungal-exhalation's bare "Target", 1 of 2016 pages) draws no row — an empty labelled row says
 *  nothing; Cast stays, because its glyph is its value. */
export function pageRows(lines: PageStatLine[], spell: Pick<Spell, 'cast'>): [string, string][] {
  const rows: [string, string][] = lines.filter((l) => l.label === 'Cast' || l.value.trim()).map((l) => [l.label, l.value]);
  if (!lines.some((l) => l.label === 'Cast')) rows.unshift(['Cast', castWords(spell)]);
  return rows;
}

/** The field lane's rows: exactly the rows spellStatRows printed (Cast always, the rest when set). */
export function fieldRows(rows: FieldRows, spell: Pick<Spell, 'cast'>): [string, string][] {
  return rows.filter(([k, v]) => k === 'Cast' || v).map(([k, v]) => [k, k === 'Cast' ? castWords(spell) : (v ?? '')]);
}

/**
 * The spell popup as the card renders it, for the guard (card-scope.mjs's spellDetail surface): which
 * lane the rows come from, the rows, and the body string the popup draws (the damage arrow is a
 * heightened-rank insertion inside [data-ours]-style spans and is not modelled here).
 */
export function spellCardModel(spell: Spell, tree: AstNode | undefined, statRows: FieldRows): SpellCardModel {
  const lane: 'page' | 'field' = tree && isSpellPage(tree) ? 'page' : 'field';
  const rows = lane === 'page' ? pageRows(pageStatLines(tree), spell) : fieldRows(statRows, spell);
  const printed = new Set(rows.map(([k]) => k));
  const { base, heightening } = splitHeightening(spell.description || '');
  return { lane, rows, printed, base: stripPrintedPreamble(base, printed, spell.name), heightening };
}
