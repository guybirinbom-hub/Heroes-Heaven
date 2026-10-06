/*
 * HAZARD STRIKE CENSUS — how many Melee/Ranged lines a hazard PAGE prints, against how many strikes
 * the tracker adapter (parseHazard) returns for the same record.
 *
 *   npx jiti scripts/hazard-strike-census.mjs [--corpus <dir>] [--json]
 *
 * Run through jiti, never plain node: it imports tracker/src/utils/parseCreature.ts.
 *
 * The page is the instrument, not the record: strike lines are counted in `_aon.markdown` (split on
 * newlines AND `<br />`, because the Archives print a strike after a line break inside an ability), in
 * every bold form the corpus grammar reads (docs/DESIGN.md §3): **Melee**, **[Melee](u)**,
 * [**Melee**](u), **[**Melee**](u)**, **[Melee](u) (suffix)**, **[Melee](u) <actions/> (no closing **).
 * A page strike is FOUND when a parsed strike of the same range has the same lower-cased name.
 * The corpus is read-only; nothing is written.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const CORPUS = arg('--corpus') ?? join(ROOT, '..', 'hh-bestiary-corpus');
/* --adapter <parseCreature.ts> measures another copy of the adapter (the "before" figure is taken
 * from the base commit's copy); the default is the lane's own. */
const ADAPTER = resolve(arg('--adapter') ?? join(ROOT, 'tracker', 'src', 'utils', 'parseCreature.ts'));
const asJson = argv.includes('--json');
const { parseHazard } = await import(pathToFileURL(ADAPTER).href);

const STRIKE_START = /^(?:\*\*\[\*\*|\*\*\[|\[\*\*|\*\*)(Melee|Ranged)\b/;

/** Every strike line a hazard page prints: [{ range, name, line }]. */
export function pageStrikes(markdown) {
  const out = [];
  for (const seg of String(markdown ?? '').split(/\n|<br\s*\/?>/i)) {
    const line = seg.trim();
    const m = line.match(STRIKE_START);
    if (!m) continue;
    const toPlain = (s) => s
      .replace(/<actions[^>]*\/>/gi, ' ')
      .replace(/<\/?[a-z][^>]*>/gi, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    const plain = toPlain(line);
    // The name follows an optional action-cost token ("[one-action]"), an optional doubled
    // label ("**Melee** <actions/>**Melee** ghostly arms", Arms of the Drowned) and an optional
    // leading trait list ("Ranged (agile, thrown 10 feet) dagger +40").
    const nm = plain.match(/^(Melee|Ranged)\s+(?:\[[a-z-]+\]\s+)?(?:(?:Melee|Ranged)\s+)?(?:\([^)]*\)\s+)?(.+?)\s+[+-]\d+/);
    // A page can run the next ability on in the same line with no break ("… bludgeoning
    // **Early Collapse** <actions …/>", Guthallath Rockslide): a bold Title Case label after the
    // Damage/Effect label is where the strike's own text ends.
    const lab = line.search(/\b(?:Damage|Effect)\b/);
    const next = lab < 0 ? -1 : line.slice(lab).search(/\*\*(?!(?:Damage|Effect)\*\*)[A-Z][a-z][^*]*\*\*/);
    const body = toPlain(next < 0 ? line : line.slice(0, lab + next)).match(/\b(Damage|Effect)\s+(.*)$/);
    out.push({
      range: m[1], name: nm ? nm[2].trim() : null, line: plain.slice(0, 120),
      label: body ? body[1] : null, text: body ? body[2] : '',
    });
  }
  return out;
}

/* Damage/Effect text compared loosely: case, spacing before punctuation, a trailing full stop. */
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+([,.;)\]])/g, '$1').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();

const hazards = JSON.parse(readFileSync(join(CORPUS, 'data', 'hazards.json'), 'utf8')).hazard;

let withStrikes = 0, onPage = 0, parsedTotal = 0, found = 0;
const missing = [];
const textDiffers = [];
for (const raw of hazards) {
  const page = pageStrikes(raw._aon?.markdown);
  if (!page.length) continue;
  withStrikes++;
  onPage += page.length;
  const parsed = parseHazard(raw).attacks ?? [];
  parsedTotal += parsed.length;
  const have = new Set(parsed.map(a => `${a.range}|${String(a.name).toLowerCase()}`));
  const lost = page.filter(p => !(p.name && have.has(`${p.range}|${p.name.toLowerCase()}`)));
  found += page.length - lost.length;
  for (const p of page) {
    if (lost.includes(p)) continue;
    const a = parsed.find(x => x.range === p.range && String(x.name).toLowerCase() === p.name.toLowerCase());
    const got = p.label === 'Effect' ? (a.effects ?? [])[0] : a.damage;
    if (norm(got) !== norm(p.text)) textDiffers.push({ id: raw._aon?.id, name: raw.name, strike: p.name, page: p.text, parsed: got ?? '' });
  }
  if (lost.length) {
    missing.push({
      id: raw._aon?.id, name: raw.name,
      lost: lost.map(l => l.line),
      parsed: parsed.map(a => `${a.range} ${a.name} ${a.attack}`),
    });
  }
}

const result = {
  hazards: hazards.length,
  hazardsWithStrikes: withStrikes,
  strikesOnPage: onPage,
  strikesParsed: parsedTotal,
  pageStrikesFound: found,
  hazardsMissingAny: missing.length,
  /* Found strikes whose Damage (or Effect) text is not the page's text for that line. */
  foundWithTextDiffering: textDiffers.length,
  residue: missing,
  textDiffers,
};
if (asJson) console.log(JSON.stringify(result, null, 1));
else {
  const { residue, textDiffers: td, ...counts } = result;
  console.log(JSON.stringify(counts));
  for (const r of residue) console.log(`- ${r.id} ${r.name}: lost ${JSON.stringify(r.lost)} parsed ${JSON.stringify(r.parsed)}`);
  for (const r of td) console.log(`~ ${r.id} ${r.name} [${r.strike}]\n    page:   ${r.page}\n    parsed: ${r.parsed}`);
}
