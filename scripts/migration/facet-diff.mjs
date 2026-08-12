/*
 * Stage 2d, step 1 — MEASURE how far the Foundry values in core.json are from the Archives.
 *
 * Today's core.json is Archives text sitting on Foundry numbers: import-core-v2.mjs:122's
 * overlayContent() adopts only the NAME from the Archives, so every overlaid record kept its Foundry
 * level / rarity / traits / price / bulk. This script says, per facet, how often the two actually
 * differ — which decides how much of the job is automatic and how much needs the user.
 *
 * Joined by `aonId` from out/map.json. NEVER by name: name matching is forbidden in this project and
 * has already produced two wrong conclusions.
 *
 * Reports THREE populations per facet, not two — a comparison that silently drops the records where
 * one side has no value would flatter the agreement rate:
 *   both      present on both sides -> agree / differ
 *   hh-only   Heroes Heaven has it, the archive does not
 *   aon-only  the archive has it, Heroes Heaven does not (a gap we could FILL)
 *
 * Read-only. Writes out/facet-diff.json and out/facet-diff.md.
 *
 *   node scripts/migration/facet-diff.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { remasterTraits, rawTraitsOf } from '../lib/aon-facets.mjs';

const ARCHIVE = 'C:/trying ai 2/hh-data-export/without-images/data';
const OUT = 'scripts/migration/out';

const { map } = JSON.parse(readFileSync(pjoin(OUT, 'map.json'), 'utf8'));
const core = JSON.parse(readFileSync('public/core.json', 'utf8'));

const docs = new Map();
for (const f of readdirSync(ARCHIVE).filter((x) => x.endsWith('.json'))) {
  let raw; try { raw = JSON.parse(readFileSync(pjoin(ARCHIVE, f), 'utf8')); } catch { continue; }
  for (const [id, d] of Object.entries(raw.docs ?? {})) docs.set(id, d);
}

const RARITY = new Set(['common', 'uncommon', 'rare', 'unique']);

/*
 * Traits are compared through the SAME transforms the importer applies, or the measurement reports its
 * own deliberate behaviour as disagreement. Both showed up as large fake gaps before this:
 *   - the remaster renames the user chose (positive->vitality, good->holy, …)
 *   - the base-item union, which gives a magic weapon its base weapon's traits
 * Without them, traits looked 8.9% divergent when the real figure is far lower.
 */
const baseIndex = new Map();
const BASE_CATS = ['weapon', 'armor', 'shield'];
for (const d of docs.values()) {
  if (!d?.name) continue;
  const k = String(d.name).toLowerCase();
  const prev = baseIndex.get(k);
  if (!prev || (BASE_CATS.includes(d.category) && !BASE_CATS.includes(prev.category))) baseIndex.set(k, d);
}
const aonTraitsOf = (d) => {
  const own = remasterTraits(rawTraitsOf(d)) ?? [];
  const bn = d?.data?.base_item?.[0];
  const base = bn ? baseIndex.get(String(bn).toLowerCase()) : null;
  return [...new Set([...own, ...(base ? remasterTraits(rawTraitsOf(base)) ?? [] : [])])].sort();
};
const normTraits = (list) => [...new Set((list ?? [])
  .map((t) => String(t).toLowerCase().trim())
  .filter((t) => t && !RARITY.has(t)))].sort();

/** Heroes Heaven stores {gp,sp,cp}; the archive stores an integer of copper. Compare in copper. */
const priceCp = (p) => {
  if (p == null) return null;
  if (typeof p === 'number') return p;
  if (typeof p !== 'object') return null;
  const gp = Number(p.gp ?? 0), sp = Number(p.sp ?? 0), cp = Number(p.cp ?? 0), pp = Number(p.pp ?? 0);
  if (![gp, sp, cp, pp].every(Number.isFinite)) return null;
  return pp * 1000 + gp * 100 + sp * 10 + cp;
};

const FACETS = {
  level:  { hh: (r) => (typeof r.level === 'number' ? r.level : null),
            aon: (d) => (typeof d.level === 'number' ? d.level : null),
            same: (a, b) => a === b },
  rarity: { hh: (r) => (r.rarity ? String(r.rarity).toLowerCase() : null),
            aon: (d) => (d.rarity ? String(d.rarity).toLowerCase() : null),
            same: (a, b) => a === b },
  traits: { hh: (r) => (Array.isArray(r.traits) ? normTraits(r.traits) : null),
            aon: (d) => { const t = aonTraitsOf(d); return t.length ? t : null; },
            same: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]) },
  price:  { hh: (r) => priceCp(r.price),
            aon: (d) => (typeof d.price_cp === 'number' ? d.price_cp : null),
            same: (a, b) => a === b },
  bulk:   { hh: (r) => (typeof r.bulk === 'number' ? r.bulk : null),
            aon: (d) => (typeof d.bulk_num === 'number' ? d.bulk_num : null),
            same: (a, b) => a === b },
};

const stats = {};
for (const f of Object.keys(FACETS)) stats[f] = { both: 0, agree: 0, differ: 0, hhOnly: 0, aonOnly: 0, neither: 0, examples: [] };

let compared = 0, noDoc = 0;

for (const [bucket, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  for (const [key, rec] of Object.entries(records)) {
    if (!rec || typeof rec !== 'object') continue;
    const m = map[bucket]?.[key];
    // Only records with their OWN archive document are comparable. A section of a bigger page has no
    // facets of its own to compare against.
    if (!m || (m.status !== 'doc' && m.status !== 'scraped') || !m.docId) continue;
    const doc = docs.get(m.docId);
    if (!doc) { noDoc++; continue; }
    compared++;

    for (const [name, F] of Object.entries(FACETS)) {
      const a = F.hh(rec), b = F.aon(doc);
      const s = stats[name];
      const has = (v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
      if (!has(a) && !has(b)) { s.neither++; continue; }
      if (!has(a)) { s.aonOnly++; continue; }
      if (!has(b)) { s.hhOnly++; continue; }
      s.both++;
      if (F.same(a, b)) { s.agree++; continue; }
      s.differ++;
      if (s.examples.length < 400) {
        s.examples.push({ bucket, key, name: rec.name, docId: m.docId, book: rec.source?.book ?? '', hh: a, aon: b });
      }
    }
  }
}

writeFileSync(pjoin(OUT, 'facet-diff.json'), JSON.stringify({ compared, noDoc, stats }, null, 1));

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(2) + '%' : '—');
let md = `# Foundry vs Archives — facet disagreement\n\nJoined by \`aonId\`, never by name. ${compared} records have their own archive document and were compared.\n\n`;
md += '| facet | comparable | agree | **differ** | rate | HH only | AoN only (a gap we could fill) |\n|---|---:|---:|---:|---:|---:|---:|\n';
for (const [f, s] of Object.entries(stats)) {
  md += `| ${f} | ${s.both} | ${s.agree} | **${s.differ}** | ${pct(s.differ, s.both)} | ${s.hhOnly} | ${s.aonOnly} |\n`;
}
for (const [f, s] of Object.entries(stats)) {
  if (!s.differ) continue;
  md += `\n## ${f} — ${s.differ} disagreements\n\n| record | bucket | book | Heroes Heaven (Foundry) | Archives |\n|---|---|---|---|---|\n`;
  for (const e of s.examples.slice(0, 60)) {
    const h = Array.isArray(e.hh) ? e.hh.join(', ') : String(e.hh);
    const a = Array.isArray(e.aon) ? e.aon.join(', ') : String(e.aon);
    md += `| ${e.name} | ${e.bucket} | ${String(e.book).slice(0, 34)} | ${h.slice(0, 70)} | ${a.slice(0, 70)} |\n`;
  }
  if (s.examples.length > 60) md += `\n…and ${s.differ - 60} more in facet-diff.json\n`;
}
writeFileSync(pjoin(OUT, 'facet-diff.md'), md);

console.log(`compared ${compared} records with their own archive doc (${noDoc} had a docId not in the export)\n`);
console.log('facet    comparable    agree   differ     rate    HH-only   AoN-only');
for (const [f, s] of Object.entries(stats)) {
  console.log(
    `${f.padEnd(8)} ${String(s.both).padStart(10)} ${String(s.agree).padStart(8)} ${String(s.differ).padStart(8)}` +
    ` ${pct(s.differ, s.both).padStart(8)} ${String(s.hhOnly).padStart(10)} ${String(s.aonOnly).padStart(10)}`
  );
}
console.log(`\nwrote ${OUT}/facet-diff.md and facet-diff.json`);
