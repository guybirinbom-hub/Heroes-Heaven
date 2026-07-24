/**
 * Step-0 correctness gate: do the slugs the hand-authored engine tables key off still resolve
 * in the new data (after edition-priority dedup)? Orphaned table keys = silently-broken mechanics.
 * Run: node scripts/migrate-keycheck.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA = 'C:/trying ai 2/hh-data-export/without-images/data';
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const CAT_BUCKET = { spell: 'spells', ritual: 'spells', equipment: 'items', weapon: 'items', armor: 'items', shield: 'items', relic: 'items', 'set-relic': 'items', 'class-kit': 'items', class: 'classes', 'class-feature': 'classFeatures', feat: 'feats', ancestry: 'ancestries', heritage: 'heritages', background: 'backgrounds', deity: 'deities', language: 'languages', action: 'actions', condition: 'conditions' };
// subclass content lives in dedicated categories in the new data:
const SUBCLASS_CATS = new Set(['instinct', 'doctrine', 'bloodline', 'mystery', 'racket', 'domain', 'muse', 'patron', 'way', 'cause', 'style', 'methodology', 'innovation', 'element', 'hybrid-study', 'conscious-mind', 'subconscious-mind', 'research-field', 'practice', 'arcane-thesis', 'arcane-school', 'druidic-order', 'hunters-edge', 'apparition', 'ikon', 'implement', 'lesson', 'draconic-exemplar', 'epithet', 'deviant-ability-classification', 'mythic-calling']);

const EDITION_RANK = { remaster: 0, 'remaster-era': 1, neutral: 2, 'legacy-era': 3, legacy: 4 };
// bucket -> slug -> best edition rank seen (for dedup)
const bucketSlugs = {}; // bucket -> Set(slug) after keeping best edition
const bucketBest = {};  // bucket -> slug -> rank
const subclassSlugs = new Set();

for (const f of readdirSync(DATA).filter((f) => f.endsWith('.json'))) {
  let raw; try { raw = JSON.parse(readFileSync(join(DATA, f), 'utf8')); } catch { continue; }
  const cat = raw.category;
  const bucket = CAT_BUCKET[cat];
  const isSub = SUBCLASS_CATS.has(cat);
  if (!bucket && !isSub) continue;
  for (const id in (raw.docs || {})) {
    const r = raw.docs[id]; if (r.superseded_by) continue;
    const s = slug(r.name);
    if (isSub) { subclassSlugs.add(s); continue; }
    const rk = EDITION_RANK[r.edition] ?? 5;
    bucketBest[bucket] ||= {}; bucketSlugs[bucket] ||= new Set();
    if (!(s in bucketBest[bucket]) || rk < bucketBest[bucket][s]) bucketBest[bucket][s] = rk;
    bucketSlugs[bucket].add(s);
  }
}
// feats+classFeatures also searched for subclass-feature keys; build a combined "mechanics" set
const featLike = new Set([...(bucketSlugs.feats || []), ...(bucketSlugs.classFeatures || []), ...subclassSlugs]);

// --- extract hand-table keys ---
function topKeys(file, marker) {
  const txt = readFileSync(file, 'utf8');
  const start = txt.indexOf(marker); if (start < 0) return [];
  const body = txt.slice(start);
  // single-quoted keys at 2-space indent (table entries), stop at first line that closes the table at col 0
  const keys = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^ {2}['"]([a-z0-9-]+)['"]:/);
    if (m) keys.push(m[1]);
    if (/^};/.test(line) && keys.length) break;
  }
  return [...new Set(keys)];
}
const featGrantKeys = topKeys('src/rules/featGrants.ts', 'export const FEAT_GRANTS');
const situKeys = topKeys('src/rules/situationalBonuses.ts', 'export const FEAT_SITUATIONAL');

// SPELLCASTING / SUBCLASS map keys from the importer (class slugs)
function importerMapKeys(marker) {
  const txt = readFileSync('scripts/import-core.mjs', 'utf8');
  const start = txt.indexOf(marker); if (start < 0) return [];
  const body = txt.slice(start).split('\n');
  const keys = [];
  for (let i = 1; i < body.length; i++) { const m = body[i].match(/^ {2}'?([a-z0-9-]+)'?:/); if (m) keys.push(m[1]); if (/^};/.test(body[i])) break; }
  return [...new Set(keys)];
}
const spellcastingKeys = importerMapKeys('const SPELLCASTING = {');
const subclassMapKeys = importerMapKeys('const SUBCLASS = {');

function check(label, keys, set, setName) {
  const missing = keys.filter((k) => !set.has(k));
  console.log(`\n${label}: ${keys.length} keys | resolved ${keys.length - missing.length} | MISSING ${missing.length} in ${setName}`);
  if (missing.length) console.log('  missing: ' + missing.join(', '));
}
console.log('════ HAND-TABLE KEY RESOLUTION vs new data (edition-deduped) ════');
console.log('feats:', bucketSlugs.feats?.size, '| classFeatures:', bucketSlugs.classFeatures?.size, '| subclass-cat slugs:', subclassSlugs.size, '| classes:', bucketSlugs.classes?.size);
check('FEAT_GRANTS (feat/feature slugs)', featGrantKeys, featLike, 'feats+classFeatures+subclass');
check('FEAT_SITUATIONAL (feat/feature slugs)', situKeys, featLike, 'feats+classFeatures+subclass');
check('SPELLCASTING (class slugs)', spellcastingKeys, bucketSlugs.classes || new Set(), 'classes');
check('SUBCLASS map (class slugs)', subclassMapKeys, bucketSlugs.classes || new Set(), 'classes');
