/*
 * AoN MARKDOWN -> PLAIN TEXT. One transform, shared.
 *
 * This produced the prose for every record a targeted merge added, and its output is a LIVE PLAYER
 * SURFACE: MainTab's action popup renders the plain `description` through RichText with no ast key, so
 * for records without a display tree this text is what someone reads at the table.
 *
 * It lives here rather than inside import-siege-and-gaps.mjs because a repair script has to apply the
 * EXACT same transform to know whether an artefact in stored prose came from this code or from AoN. A
 * second copy would answer that question with a different function and quietly get it wrong.
 *
 * Two artefacts this transform used to introduce, both found by test/authoring-guards.test.ts's damage
 * ratchet (888 -> 928) and both fixed below:
 *
 *   " ()"   `<actions string="" />` — the glyph tag with an EMPTY string, which AoN emits on any entry
 *           with no action cost. Substituting it unconditionally rendered "Resonance ()", "Porter ()"
 *           on 37 familiar abilities. An empty string now emits nothing, which is what it means.
 *
 *   "x\n, y" a link label containing a newline. AoN wraps long labels, and a few wrap INSIDE the
 *           brackets: Polong reads `[Skilled (Society)\r\n](/Familiars.aspx?ID=33), [Speech](…)`.
 *           Keeping the label verbatim left a newline before the comma, reading as a dropped word.
 *
 * ⚠ Do NOT "simplify" the empty-glyph branch to always substitute. And note the contrast with
 * `titleGlyph` in aon-facets.mjs, which deliberately returns '' rather than undefined for the same tag:
 * there the empty string is meaningful (it distinguishes "no glyph on the page" from "no glyph tag at
 * all", and actionCostOf branches on it). Here it means "print nothing".
 */

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—' };
export const decode = (s) => String(s ?? '').replace(/&(amp|lt|gt|quot|#39|nbsp|ndash|mdash);/g, (m) => ENTITIES[m] ?? m);

/**
 * `[label](url)` -> `label`. Run BEFORE any line-based processing.
 *
 * The label is matched across newlines because AoN wraps long ones; its internal whitespace collapses
 * to single spaces and its edges trim, because a link label is a run of inline text and the line break
 * was AoN's layout, never part of the name.
 */
export const unlink = (md) => String(md ?? '').replace(/\r/g, '')
  .replace(/\[([\s\S]*?)\]\((?:[^()]|\([^()]*\))*\)/g, (_, label) => label.replace(/\s+/g, ' ').trim());

/** AoN's NEWER cross-reference template, which arrived with its 2026-09 index rebuild:
 *  `{{conditions 62 "concealed"}}`, `{{treasure 3021 "everlight crystal"}}`. Same job as the
 *  `<%…%>` form below, and like it, it reaches `markdown` unsubstituted — so the label is kept and the
 *  braces go. The AoG build turns these into real links when it parses a document into its display
 *  tree (build/normalize.py `_repair_handlebars`); this is the OTHER path, the plain prose a targeted
 *  merge writes for a record that has no tree, and without it five records shipped the raw braces
 *  (familiarAbilities/ink-spray and /gibe, siegeWeapons/burning-glass, /flame-bellows, /jistkan-horn). */
export const stripHandlebars = (s) => (String(s ?? '').indexOf('{{') === -1 ? String(s ?? '')
  : String(s).replace(/\{\{[A-Za-z][A-Za-z0-9_]*\s+[^\s}]+\s+"([^"]*)"\s*\}\}/g, '$1'));

/**
 * The handlebars index name -> the AoN page a `[label](/Page.aspx?ID=n)` link would name.
 *
 * MEASURED over the whole 2026-09 export, so the map is the corpus's and not a guess: 2,591
 * cross-references in 1,165 documents use this form —
 *
 *   spells 570 · traits 423 · creatureAbilities 408 · conditions 407 · rules 161 · skills 142 ·
 *   creatureFamilies 115 · actions 76 · weapons 71 · treasure 57 · feats 51 · languages 42 ·
 *   siegeWeapons 24 · deities 19 · creatures 11 · planes 7 · ancestries 3 · domains 2 · hazards 1 ·
 *   rituals 1
 *
 * `weapons`, `siegeWeapons` and `languages` were missing from this table and their 137 references
 * kept only their label. The five with no shipped bucket at all — creatureAbilities,
 * creatureFamilies, creatures, planes, hazards, 542 references — are deliberately still absent: a
 * link to a page the app does not ship is a dead control, so those stay braces and stripHandlebars
 * flattens them to the label the Archives print, which is what they read as today.
 */
const HB_PAGE = {
  conditions: 'Conditions', actions: 'Actions', spells: 'Spells', treasure: 'Equipment',
  feats: 'Feats', traits: 'Traits', skills: 'Skills', rules: 'Rules', deities: 'Deities',
  domains: 'Domains', ancestries: 'Ancestries', classes: 'Classes', heritages: 'Heritages',
  archetypes: 'Archetypes', weapons: 'Weapons', siegeWeapons: 'SiegeWeapons', languages: 'Languages',
  rituals: 'Spells',
};
/**
 * The handlebars cross-reference rewritten as the MARKDOWN LINK the older documents use, so one link
 * scanner reads both forms.
 *
 * The 2026-09 index rebuild turned 2,591 links across 1,165 documents from `[concealed](/Conditions.aspx?ID=62)`
 * into `{{conditions 62 "concealed"}}`. Every descRefs builder matches the link form only, so a
 * document that was re-templated lost its cross-references outright — `familiarAbilities/ink-spray`
 * lost all four (invisible/concealed/blinded/Interact) and `/gibe` its one (off-guard), and the
 * popups stopped being clickable. Run this BEFORE scanning for links; `plain()` keeps using
 * stripHandlebars, which reaches the same text through `unlink`.
 */
export const handlebarsLinks = (md) => (String(md ?? '').indexOf('{{') === -1 ? String(md ?? '')
  : String(md).replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\s+(\d+)\s+"([^"]*)"\s*\}\}/g,
    (whole, index, id, label) => (HB_PAGE[index] ? `[${label}](/${HB_PAGE[index]}.aspx?ID=${id})` : whole)));

/** AoN ships ~829 documents with UNSUBSTITUTED cross-reference templates (`<%EQUIPMENT%3021%%>label<%END>`).
 *  Drop the markers and keep the label (see audit note project_aon_text_formatting_issues). */
export const stripTemplates = (s) => {
  const t = stripHandlebars(s);
  return t.indexOf('<%') === -1 ? t : t.replace(/<%[^>]*?>/g, '').replace(/ {2,}/g, ' ');
};

export const ACTION_WORD = {
  'Single Action': '1 action', 'Two Actions': '2 actions', 'Three Actions': '3 actions',
  'Free Action': 'free action', Reaction: 'reaction',
};

/** AoN markdown -> plain text: unwrap links, drop tags, keep list/paragraph breaks. */
export function plain(md) {
  let s = stripTemplates(unlink(md));
  s = s.replace(/<br\s*\/?>/g, '\n');
  // An EMPTY action string means the entry has no glyph — print nothing rather than " () ". See header.
  s = s.replace(/<actions\s+string="([^"]*)"\s*\/>/g, (_, a) => (a ? ` (${ACTION_WORD[a] ?? a}) ` : ''));
  s = s.replace(/<\/li>\s*<li>/g, '\n• ');
  s = s.replace(/<ul>\s*<li>/g, '\n• ').replace(/<\/li>\s*<\/ul>/g, '\n');
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/\*\*/g, '');
  s = s.replace(/(^|[\s(“"'[])_(?=\S)/g, '$1').replace(/(?<=\S)_(?=$|[\s).,;:!?”"'\]])/g, '');
  s = decode(s);
  // AoN's own typography defects: a hard-wrapped "10- foot burst", the degree sign variants.
  s = s.replace(/(\d)-\s+(foot|ft)\b/g, '$1-$2');
  return s.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
}
