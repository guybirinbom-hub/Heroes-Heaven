/*
 * GUARD: a link in a description page opens the record that carries the page it names.
 *
 * Every in-text link in public/ast/<bucket>.json.gz is `{ t: 'link', to: <Archives document id>, ref:
 * 'bucket:slug' }`: `to` is the page the Archives link to, `ref` is the record the app opens. The swashbuckler's
 * "Confident Evasion" carried `{ to: 'class-feature-25', ref: 'classes:alchemist' }` — class-feature-25 is
 * classFeatures/evasion's own page, and tapping "Evasion" opened the Alchemist class (package M, 2026-10-16;
 * the cause and its fix are in scripts/lib/ast-link-ref.mjs).
 *
 * THE RULE: a link FAILS when its `ref` record does not carry the `to` document as its `aonId` while another
 * record in public/core.json does — unless it is one of the two deliberate cases below, or a pair frozen in
 * the baseline.
 *
 * Deliberate, never failed (counted and printed):
 *   E1 NEWEST PRINTING. The record that carries `to` says `remasteredAs` the `ref` record: the link follows
 *      the reprint, as gold-set R12 ("the newest printing wins, whole") and desk #158 have every link do.
 *   E2 SAME NAME. The `ref` record has the same name as the record that carries `to` — a rule page printed in
 *      several books ("Price" in Player Core and GM Core), a Hellknight order shipped as a class option and as a
 *      page. import-core-v2 keeps such links on the slug's record on purpose (the archive-created block: "A
 *      same-named record keeps its links … moving them repointed 53,797 links", measured 2026-09-25). 56,274 of
 *      the 57,763 mismatches measured on 2026-10-16 are this case.
 *
 * Not checked (counted): a link whose `ref` names no record in public/core.json (seed-only conditions and
 * actions, merged at runtime), and a link no record carries the page of (nothing to compare with).
 *
 * RULE 2, no baseline: a link to a CLASS FEATURE (`to` = class-feature-N) never opens a CLASS page. That is
 * the bug's own shape whether or not a record carries the feature: before the fix "ability boost" in 119
 * links (class-feature-1209, the inventor's legacy Ability Boost, which no record carries) opened the
 * Inventor class, and "hex" in 29 links, kingdom actions included, the Witch. Such a link opens the feature
 * or nothing.
 *
 * THE BASELINE (scripts/data/ast-link-carrier-baseline.json) holds the `to|ref` pairs that were already
 * there when this guard went in, after the package-M repair, each with its reason. It may only SHRINK:
 *   • a pair not in it fails;
 *   • a baseline holding more pairs than its `max` fails (an entry added by hand is caught);
 *   • a listed pair that no longer occurs is reported; `--shrink` drops those lines and lowers `max`.
 * `--init` writes the baseline from the current trees once, and refuses when one exists.
 *
 * Reads the TRACKED public/ast/<bucket>.json.gz and public/core.json. AST_DIR, CORE_JSON and LINK_BASELINE
 * override the three paths (used to prove the guard red on a planted bad link in a scratch copy).
 *
 *   node scripts/ast-link-carrier-check.mjs            # the check (npm run verify)
 *   node scripts/ast-link-carrier-check.mjs --list     # also print every baselined pair still present
 *   node scripts/ast-link-carrier-check.mjs --shrink   # drop baselined pairs that no longer occur
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AST_DIR = process.env.AST_DIR || join(ROOT, 'public/ast');
const CORE = process.env.CORE_JSON || join(ROOT, 'public/core.json');
const BASELINE = process.env.LINK_BASELINE || join(ROOT, 'scripts/data/ast-link-carrier-baseline.json');
const args = new Set(process.argv.slice(2));

const slugify = (s) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const bare = (s) => slugify(String(s ?? '').replace(/\s*\([^)]*\)\s*$/, ''));

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const carriers = new Map(); // aonId -> ['bucket:key', …]
for (const [bucket, rows] of Object.entries(core)) {
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) continue;
  for (const [key, r] of Object.entries(rows)) {
    if (r && typeof r === 'object' && r.aonId) {
      const a = String(r.aonId);
      (carriers.get(a) ?? carriers.set(a, []).get(a)).push(`${bucket}:${key}`);
    }
  }
}
const recordOf = (ref) => {
  const i = String(ref).indexOf(':');
  return i > 0 ? core[ref.slice(0, i)]?.[ref.slice(i + 1)] : undefined;
};

/** The verdict on one link: 'ok' | 'none' | 'E1' | 'E2' | the failing pair's reason class. */
function classify(to, ref) {
  const rec = recordOf(ref);
  if (!rec || typeof rec !== 'object') return 'none';
  if (String(rec.aonId ?? '') === String(to)) return 'ok';
  const cs = carriers.get(String(to)) ?? [];
  if (!cs.length || cs.includes(ref)) return 'ok';
  const recs = cs.map(recordOf);
  if (recs.some((c) => c?.remasteredAs && `${c.remasteredAs.bucket}:${c.remasteredAs.id}` === ref)) return 'E1';
  if (recs.some((c) => slugify(c?.name) !== '' && slugify(c?.name) === slugify(rec.name))) return 'E2';
  if (cs.length > 1) return 'several-carriers';
  if (bare(recs[0]?.name) === bare(rec.name)) return 'same-name-variant';
  return 'other-record';
}

const REASONS = {
  'same-name-variant': 'the link opens the bare-named record; the page belongs to a same-named variant record (a grade, an archetype\'s or class\'s own copy, a second printing). Whether it should open the variant is per pair: for a class page linking a shared feature the bare record is the one the player has.',
  'several-carriers': 'more than one record carries the page and the link opens none of them; which one it should open is not decidable from the page id alone.',
  'other-record': 'the link opens a record of another name: either the record carrying the page is a stamping oddity (a Rounds record carrying its weapon\'s page, a class option carrying its innovation page) or a reprint pairing the Archives state two ways (Miracle -> Wish ritual / Manifestation).',
};

if (!existsSync(AST_DIR)) {
  console.error(`ast-link-carrier: FAIL — no ${AST_DIR}`);
  process.exit(1);
}
const files = readdirSync(AST_DIR).filter((f) => f.endsWith('.json.gz')).sort();
if (!files.length) {
  console.error(`ast-link-carrier: FAIL — no <bucket>.json.gz in ${AST_DIR}`);
  process.exit(1);
}

const counts = { links: 0, ok: 0, none: 0, E1: 0, E2: 0, baselined: 0, failed: 0 };
const seen = new Map(); // 'to|ref' -> { reason, carriers, where: [] , n }
const featureToClass = []; // rule 2
const FEATURE = /^class-feature-\d/;
for (const f of files) {
  const bucket = f.slice(0, -'.json.gz'.length);
  const trees = JSON.parse(gunzipSync(readFileSync(join(AST_DIR, f))).toString('utf8'));
  for (const [key, tree] of Object.entries(trees)) {
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.to != null && n.ref != null) {
        counts.links++;
        if (FEATURE.test(String(n.to)) && String(n.ref).startsWith('classes:') && featureToClass.length < 200) {
          featureToClass.push(`  ${n.to} opens ${n.ref} in ${bucket}/${key}`);
        }
        const v = classify(n.to, n.ref);
        if (v === 'ok' || v === 'none' || v === 'E1' || v === 'E2') counts[v]++;
        else {
          const pair = `${n.to}|${n.ref}`;
          const e = seen.get(pair) ?? seen.set(pair, { reason: v, carriers: carriers.get(String(n.to)) ?? [], where: [], n: 0 }).get(pair);
          e.n++;
          if (e.where.length < 3) e.where.push(`${bucket}/${key}`);
        }
      }
      if (n.c) walk(n.c);
    };
    walk(tree);
  }
}

const describe = (pair, e) => {
  const [to, ref] = pair.split('|');
  return `${to} opens ${ref} ("${recordOf(ref)?.name ?? '?'}") — carried by ${e.carriers.map((c) => `${c} ("${recordOf(c)?.name ?? '?'}")`).join(', ')}; ${e.n} link(s), e.g. ${e.where.join(', ')}`;
};

if (args.has('--init')) {
  if (existsSync(BASELINE)) {
    console.error(`ast-link-carrier: --init refused — ${BASELINE} exists (the baseline only shrinks: use --shrink)`);
    process.exit(1);
  }
  const pairs = {};
  for (const [pair, e] of [...seen].sort((a, b) => a[0].localeCompare(b[0]))) {
    pairs[pair] = { reason: e.reason, carriers: e.carriers, opens: recordOf(pair.split('|')[1])?.name ?? '' };
  }
  const out = {
    _: 'scripts/ast-link-carrier-check.mjs (npm run verify). In-text links whose ref record does not carry the page they name while another record does, as they stood on 2026-10-16 after the package-M repair (scripts/repair-subpage-link-refs.mjs). Key: "<to>|<ref>". A pair not listed fails; more pairs than max fails; a listed pair that no longer occurs is reported, and --shrink drops it. The list only shrinks.',
    reasons: REASONS,
    max: Object.keys(pairs).length,
    pairs,
  };
  writeFileSync(BASELINE, JSON.stringify(out, null, 1) + '\n');
  console.log(`ast-link-carrier: baseline written — ${out.max} pair(s) -> ${BASELINE}`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { max: 0, pairs: {} };
const listed = base.pairs ?? {};
const fails = [];
for (const [pair, e] of [...seen].sort((a, b) => b[1].n - a[1].n)) {
  if (listed[pair]) counts.baselined += e.n;
  else { counts.failed += e.n; fails.push(`  NEW  ${describe(pair, e)}  [${e.reason}]`); }
}
const stale = Object.keys(listed).filter((p) => !seen.has(p)).sort();
const over = Object.keys(listed).length > Number(base.max ?? 0);

if (args.has('--shrink')) {
  if (!stale.length) { console.log('ast-link-carrier: --shrink — nothing to drop'); process.exit(0); }
  for (const p of stale) delete listed[p];
  base.pairs = listed;
  base.max = Object.keys(listed).length;
  writeFileSync(BASELINE, JSON.stringify(base, null, 1) + '\n');
  console.log(`ast-link-carrier: --shrink — dropped ${stale.length} pair(s); max is now ${base.max}:\n   ${stale.join('\n   ')}`);
  process.exit(0);
}

const summary = `${counts.links} links${featureToClass.length ? '' : ' (none from a class feature to a class page)'}: ${counts.ok} open the page's own record, ${counts.E1} follow its reprint (E1), ${counts.E2} a same-named record (E2), ${counts.baselined} baselined (${seen.size - fails.length} pair(s)), ${counts.none} name no core.json record (not checked)`;
if (args.has('--list')) for (const [pair, e] of seen) if (listed[pair]) console.log(`  KNOWN ${describe(pair, e)}  [${e.reason}]`);
if (stale.length) console.log(`ast-link-carrier: ${stale.length} baselined pair(s) no longer occur — run node scripts/ast-link-carrier-check.mjs --shrink:\n   ${stale.join('\n   ')}`);
if (fails.length || over || featureToClass.length) {
  const head = fails.length ? `${fails.length} link pair(s) open a record other than the one that carries their page:\n${fails.join('\n')}\n` : '';
  const grew = over ? `  the baseline lists ${Object.keys(listed).length} pairs but its max is ${base.max}: it may only shrink — a new pair is a bug to fix, not a line to add\n` : '';
  const rule2 = featureToClass.length ? `${featureToClass.length} link(s) to a class feature open a class page (rule 2):\n${featureToClass.join('\n')}\n` : '';
  console.error(`ast-link-carrier: FAIL — ${head}${grew}${rule2}   (${summary})\n   A link's ref comes from resolveTo in scripts/import-core-v2.mjs (rule: scripts/lib/ast-link-ref.mjs).`);
  process.exit(1);
}
console.log(`ast-link-carrier: ok — ${summary}.`);
