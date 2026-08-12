/*
 * Singletons: records whose whole content is one thing the app could not say.
 *
 * Each value below is transcribed from the record's own sentence, quoted above it. Anything whose
 * wording does not plainly support the field is reported and NOT written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];
const rows = [];
const skipped = [];

const put = (coll, id, field, value, why) => {
  const rec = core[coll]?.[id];
  if (!rec) { skipped.push(`${coll}/${id}: no such record`); return; }
  rec[field] = value;
  entries.push({ category: coll, id, field, value });
  rows.push(`${coll}/${id}.${field} = ${JSON.stringify(value)}  — ${why}`);
};

/* ---- gills, and the other PERMANENT breathe-underwater records --------------------------------
 * "You can breathe underwater." No number, no duration, no activation — which is why it fitted no
 * existing field and did nothing. 52 records mention breathing underwater, but most are conditional:
 * a wand that casts a spell, a suit while worn, an effect for an hour. Only an UNQUALIFIED permanent
 * statement gets the flag; everything else is reported so the difference stays visible.
 */
const CONDITIONAL = /\b(while|when|for \d|minutes?|hours?|until|activate|cast|spell|rank)\b/i;
/* The sentence must GRANT it to the reader. A first pass matched "For example, if one form can
 * breathe air and the other can breathe underwater" on all 18 wands of hybrid form — explanatory
 * prose about a spell, not a grant — so a bare mention is not enough: it has to say YOU (or name the
 * item as the thing enabling you), and an example is never a grant. */
const GRANTS = /\b(you can (?:always |now )?breathe underwater|enables? you to breathe underwater|allows? you to breathe underwater)\b/i;
let water = 0;
for (const coll of ['items', 'feats', 'heritages', 'classFeatures']) {
  for (const [id, rec] of Object.entries(core[coll] ?? {})) {
    const text = String(rec.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = text.match(/[^.]*\bbreathe underwater\b[^.]*\./i);
    if (!m) continue;
    if (/\bfor example\b/i.test(m[0])) { skipped.push(`${coll}/${id}: an EXAMPLE, not a grant`); continue; }
    if (!GRANTS.test(m[0])) { skipped.push(`${coll}/${id}: mentions it without granting it — "${m[0].trim().slice(0, 70)}"`); continue; }
    if (CONDITIONAL.test(m[0])) { skipped.push(`${coll}/${id}: conditional — "${m[0].trim().slice(0, 70)}"`); continue; }
    if (rec.breathesWater) continue;
    put(coll, id, 'breathesWater', true, m[0].trim().slice(0, 60));
    water++;
  }
}

/* ---- enlarged-chassis -------------------------------------------------------------------------
 * "You gain the effects of enlarge constantly." Enlarge makes you Large and extends reach by 5 feet.
 * `reach` here is an ABSOLUTE value (build.ts seeds 5 and takes the largest), so 10, not 5.
 * The clumsy 1 that enlarge normally imposes is explicitly removed by the feat's own Enhancement
 * clause, so nothing is written for it — writing it would be wrong for every character who has this.
 */
{
  const f = core.feats['enlarged-chassis'];
  const t = String(f?.description ?? '');
  if (!f) skipped.push('feats/enlarged-chassis: missing');
  else if (!/enlarge/i.test(t)) skipped.push('feats/enlarged-chassis: text no longer mentions enlarge');
  else {
    put('feats', 'enlarged-chassis', 'sizeOverride', 'large', 'gains the effects of enlarge constantly');
    put('feats', 'enlarged-chassis', 'reach', 10, 'enlarge extends reach by 5 ft; this field is absolute');
  }
}

if (skipped.length) console.warn(`SKIPPED / conditional (${skipped.length}):\n  ` + skipped.slice(0, 14).join('\n  ') + (skipped.length > 14 ? `\n  …and ${skipped.length - 14} more` : ''));
if (!entries.length) { console.error('nothing written'); process.exit(1); }

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`\nwrote ${entries.length} fields (${water} breathesWater) — backfill ${backfill.length} -> ${next.length}`);
for (const r of rows) console.log('  ' + r);
