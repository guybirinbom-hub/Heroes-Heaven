/*
 * Six gunslinger ways, three deeds each, none of them reaching a sheet.
 *
 * A way hands over its deeds at 1st, 9th and 15th level. `SubclassOption.featureIds` — built during
 * this audit so an oracle mystery could hand over its curse — applied with no level check, so it
 * could only ever mean "from the level the subclass is taken". Writing the deeds with it would have
 * given a 1st-level gunslinger their 15th-level Greater Deed, which is why the field had to gain a
 * level before the data could be written at all.
 *
 * Every deed name comes from the AoN mirror: each way's markdown references its deeds by document id
 * (`<document id="action-907">`), and the mirror stores that record under exactly that filename. The
 * REMASTERED printing wins where a way has two. Nothing is written for a deed whose record the app
 * does not ship — an id that resolves to nothing would look wired and grant nothing.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';

if (!existsSync(join(MIRROR, 'way'))) {
  console.error(`No AoN mirror at ${MIRROR}/way — refusing to write deed lists from memory.`);
  process.exit(1);
}

/** "action-907" → its record name, from the mirror's own file naming. */
function nameOf(ref) {
  for (const d of readdirSync(MIRROR)) {
    const p = join(MIRROR, d, ref + '.json');
    if (!existsSync(p)) continue;
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return (Array.isArray(j) ? j[0] : j)?.name ?? null;
  }
  return null;
}

/** Compare by NAME, not by slug: the app spells Drifter's Wake `drifters-wake` (apostrophe dropped,
 *  not turned into a dash) and prints the legacy "Pistolero's Retort" where the remaster says
 *  "Pistoler's". Slug arithmetic misses both; the record's own name does not. */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** way name → [{ tier, level, name }], remastered printing preferred. */
const ways = new Map();
for (const f of readdirSync(join(MIRROR, 'way'))) {
  let j;
  try {
    j = JSON.parse(readFileSync(join(MIRROR, 'way', f), 'utf8'));
  } catch {
    continue;
  }
  for (const r of Array.isArray(j) ? j : [j]) {
    const md = String(r.markdown ?? '');
    if (md.length < 300 || !r.name) continue;
    const rows = [...md.matchAll(/<title[^>]*?>(Initial Deed|Advanced Deed|Greater Deed)<\/title>\s*<document[^>]*id="([a-z]+-\d+)"/g)];
    if (!rows.length) continue;
    const lvls = [...md.matchAll(/right="Level (\d+)"[^>]*>(Advanced Deed|Greater Deed)</g)];
    const levelOf = (tier) => (tier === 'Initial Deed' ? 1 : Number(lvls.find(([, , t]) => t === tier)?.[1] ?? 0));
    const remaster = /Remastered/.test(String(r.primary_source ?? ''));
    if (ways.get(r.name)?.remaster && !remaster) continue;
    ways.set(r.name, { remaster, rows: rows.map(([, tier, ref]) => ({ tier, level: levelOf(tier), name: nameOf(ref) })) });
  }
}

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const options = core.classes.gunslinger?.subclass?.options ?? [];
if (!options.length) {
  console.error('The gunslinger has no subclass options — nothing to patch.');
  process.exit(1);
}

const entries = [];
const skipped = [];
const promoted = [];
for (const opt of options) {
  const v = ways.get(opt.name);
  if (!v) {
    skipped.push(`${opt.id}: "${opt.name}" is not in the mirror`);
    continue;
  }
  const featureIds = [];
  for (const row of v.rows) {
    if (!row.name) {
      skipped.push(`${opt.id}/${row.tier}: the mirror's document reference did not resolve`);
      continue;
    }
    if (!row.level) {
      skipped.push(`${opt.id}/${row.tier}: no level printed`);
      continue;
    }
    const want = norm(row.name);
    let hit = Object.entries(core.classFeatures).find(
      ([, f]) => norm(f.name) === want || norm(f.name).replace(/^pistolero/, 'pistoler') === want,
    );
    // Way of the Spellshot's three deeds ship only as ACTION records — same text, same traits, filed
    // in the wrong collection. Fifteen of the eighteen deeds already exist in both places, so this
    // promotes the odd three rather than leaving one entire way with nothing. It is a copy of the
    // shipped record, never authored content.
    if (!hit) {
      const act = Object.entries(core.actions ?? {}).find(([, a]) => norm(a.name) === want);
      if (act) {
        const [aid, a] = act;
        core.classFeatures[aid] = { ...a, level: row.level };
        promoted.push(aid);
        hit = [aid, core.classFeatures[aid]];
      }
    }
    if (!hit) {
      skipped.push(`${opt.id}/${row.tier}: "${row.name}" is neither a class feature nor an action`);
      continue;
    }
    featureIds.push({ id: hit[0], level: row.level });
  }
  if (!featureIds.length) continue;
  const value = [...(opt.featureIds ?? []), ...featureIds];
  entries.push({
    category: 'classes',
    id: 'gunslinger',
    path: ['subclass', 'options', `id=${opt.id}`],
    field: 'featureIds',
    value,
  });
  opt.featureIds = value;
}

if (skipped.length) console.warn(`SKIPPED (${skipped.length}):\n  ` + skipped.join('\n  '));
// A promoted record must be CREATED on re-import, not merely patched: the overlay's normal mode
// assigns a field to an existing record, and after a regeneration these three exist only as actions
// again, which would leave the way's deed links pointing at nothing.
for (const id of promoted) entries.push({ category: 'classFeatures', id, create: true, value: core.classFeatures[id] });
if (promoted.length) console.log(`PROMOTED from actions (${promoted.length}): ${promoted.join(', ')}`);
if (!entries.length) {
  console.error('nothing resolved — writing nothing');
  process.exit(1);
}

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
const wayEntries = entries.filter((e) => e.path);
console.log(`wrote deeds for ${wayEntries.length} of ${options.length} ways (backfill ${backfill.length} → ${next.length})`);
for (const e of wayEntries) console.log(`  ${e.path[2]}: ${e.value.map((v) => (typeof v === 'string' ? v : `${v.id}@${v.level}`)).join(', ')}`);
