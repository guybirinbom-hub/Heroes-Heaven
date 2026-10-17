/*
 * GUARD: a link in a description page opens the record that carries the page it names.
 *
 * Every in-text link in public/ast/<bucket>.json.gz is `{ t: 'link', to: <Archives document id>, ref:
 * 'bucket:slug' }`: `to` is the page the Archives link to, `ref` is the record the app opens. The swashbuckler's
 * "Confident Evasion" carried `{ to: 'class-feature-25', ref: 'classes:alchemist' }` — class-feature-25 is
 * classFeatures/evasion's own page, and tapping "Evasion" opened the Alchemist class (package M, 2026-10-16;
 * the cause and its fix are in scripts/lib/ast-link-ref.mjs).
 *
 * RULE 1: a live link FAILS when its `ref` record does not carry the `to` document as its `aonId` while another
 * record in public/core.json does — unless it is one of the deliberate cases below, or a pair frozen in the
 * baseline.
 *
 * Deliberate, never failed (counted and printed):
 *   E1  NEWEST PRINTING. The record that carries `to` says `remasteredAs` the `ref` record: the link follows
 *       the reprint, as gold-set R12 ("the newest printing wins, whole") and desk #158 have every link do.
 *   E1b The `ref` record carries the reprint index's newest printing of `to` (Gnoll -> ancestries/kholo; the
 *       legacy Amulet, Mirror and Tome -> the thaumaturge's implement-17/21/23).
 *   E2  SAME NAME. The `ref` record has the same name as a record that carries `to` — a rule page printed in
 *       several books ("Price" in Player Core and GM Core), a Hellknight order shipped as a class option and as a
 *       page. import-core-v2 keeps such links on the slug's record on purpose (the archive-created block: "A
 *       same-named record keeps its links … moving them repointed 53,797 links", measured 2026-09-25).
 *   E3  FAMILY PAGE. The `ref` record's aonId is `${to}-…`: a link to an item family page opens its base grade
 *       (Moritype, Hero's Plate … 32 pairs on 2026-10-17).
 *   E4  SHARED CLASS FEATURE. The `ref` record is a classFeatures record in two or more class tables (Medium
 *       Armor Expertise), or in none and with the same bare name as a carrier (the generic Spell Repertoire):
 *       package M's class card shows the class's own text.
 * E1b, E3 and E4 are scripts/lib/ast-link-ref.mjs keepReason(), the rule the relink pass keeps links by.
 *
 * RULE 2, no baseline: a link to a CLASS FEATURE (`to` = class-feature-N) never opens a CLASS page. That is
 * the bug's own shape whether or not a record carries the feature: before the fix "ability boost" in 119
 * links (class-feature-1209, the inventor's legacy Ability Boost, which no record carries) opened the
 * Inventor class, and "hex" in 29 links, kingdom actions included, the Witch. Such a link opens the feature
 * or nothing.
 *
 * RULE 3, no baseline (package I lane L8, 2026-10-17): every link is where scripts/relink-carried-pages.mjs
 * leaves it — scripts/lib/ast-link-ref.mjs planLink() plans no change for any link. That fails, by kind:
 *   revive / revive-full-name  a DEAD link (`ref: null`, or a ref naming no shipped record) whose page's own
 *        record ships: AoN wrote the link (or our auto-linker named the page's whole name), and it opens nothing;
 *   repoint  a live link opening another printing's record (Miracle -> the Wish ritual);
 *   inert-class-word  an auto-link sending a common word to ONE class's feature from a page not of that class
 *        ("cause" in a kingdom action -> the Champion's Cause);
 *   inert-auto-reach  a plain auto-link opening an `aon-` record (the 1,714 Kingmaker army-condition words —
 *        "lost", "destroyed" — that an importer change would light up).
 * The check and the pass call the same function, so they cannot drift. The fix is always the pass, never a
 * baseline line: `node scripts/relink-carried-pages.mjs --write`.
 *
 * DEAD links are counted and printed: a ref naming no record in public/core.json opens nothing. (This file
 * used to call those "seed-only conditions and actions, merged at runtime"; src/rules/seed.ts holds no
 * conditions and no actions, and AstRenderer draws such a link as .ast-lk-dead — plain text.)
 *
 * THE BASELINE (scripts/data/ast-link-carrier-baseline.json) holds the RULE 1 `to|ref` pairs that stay, each
 * with its reason (PAIR_REASONS below). It may only SHRINK:
 *   • a pair not in it fails;
 *   • a baseline holding more pairs than its `max` fails (an entry added by hand is caught);
 *   • a listed pair that no longer occurs is reported; `--shrink` drops those lines, lowers `max` and writes
 *     each remaining pair's reason from PAIR_REASONS.
 * `--init` writes the baseline from the current trees once, and refuses when one exists.
 *
 * Reads the TRACKED public/ast/<bucket>.json.gz, public/core.json and the Archives export (the page names,
 * levels and books the rule reads, and the reprint index). AST_DIR, CORE_JSON, LINK_BASELINE, AON_EXPORT and
 * CREATED_JSON override the paths (used to prove the guard red on a planted bad link in a scratch copy).
 *
 *   node scripts/ast-link-carrier-check.mjs            # the check (npm run verify)
 *   node scripts/ast-link-carrier-check.mjs --list     # also print every baselined pair still present
 *   node scripts/ast-link-carrier-check.mjs --shrink   # drop baselined pairs that no longer occur
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReprintIndex, EXPORT_DIR } from './lib/reprint.mjs';
import { linkContext, keepReason, planTree, labelOf } from './lib/ast-link-ref.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AST_DIR = process.env.AST_DIR || join(ROOT, 'public/ast');
const CORE = process.env.CORE_JSON || join(ROOT, 'public/core.json');
const BASELINE = process.env.LINK_BASELINE || join(ROOT, 'scripts/data/ast-link-carrier-baseline.json');
const CREATED = process.env.CREATED_JSON || join(ROOT, 'scripts/migration/out/archive-created.json');
const args = new Set(process.argv.slice(2));

const slugify = (s) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const bare = (s) => slugify(String(s ?? '').replace(/\s*\([^)]*\)\s*$/, ''));

if (!existsSync(EXPORT_DIR)) {
  console.error(`ast-link-carrier: FAIL — no Archives export at ${EXPORT_DIR} (set AON_EXPORT); the rule reads its page names and reprint links`);
  process.exit(1);
}
const core = JSON.parse(readFileSync(CORE, 'utf8'));
const created = existsSync(CREATED) ? JSON.parse(readFileSync(CREATED, 'utf8')) : {};
const createdRefs = new Set(Object.entries(created).flatMap(([b, m]) => Object.keys(m ?? {}).map((k) => `${b}:${k}`)));
const ctx = linkContext({ core, reprints: loadReprintIndex(EXPORT_DIR), createdRefs });
const { carriers, recordOf } = ctx;

/** The verdict on one live link: 'ok' | 'E1' | 'E1b' | 'E2' | 'E3' | 'E4' | the failing pair's reason class. */
function classify(to, ref) {
  const rec = recordOf(ref);
  if (String(rec.aonId ?? '') === String(to)) return 'ok';
  const cs = carriers.get(String(to)) ?? [];
  if (!cs.length || cs.includes(ref)) return 'ok';
  const recs = cs.map(recordOf);
  if (recs.some((c) => c?.remasteredAs && `${c.remasteredAs.bucket}:${c.remasteredAs.id}` === ref)) return 'E1';
  const kept = keepReason(ref, to, cs, ctx);
  if (kept) return kept;
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

/*
 * Why each pair that stays in the baseline stays, measured pair by pair against the export and the mirror on
 * 2026-10-17 (package I lane L8; work/package-i/links.json I10b). --shrink writes these into the baseline.
 * BLOCKED pairs leave by themselves once their twin's stamp is fixed (scripts/reprint-check.mjs CHECK 6 lists
 * all seven twins in scripts/data/book-doc-baseline.json; the fix needs `npm run data`).
 */
const BLOCKED = (twin, what) => `BLOCKED: ${twin} carries this page although it is another printing (${what}) — a name mis-stamp (scripts/migration/out/map.json how 'slug-noparen'), so the relink pass refuses it as the page's record (carrierRefusal) and the link keeps the bare record. Leaves once the twin is re-stamped.`;
const OTHER_PRINTING = (rec, legacy) => `the link names the remaster-era page, carried only by ${rec}; the ref sits on ${legacy} with no reprint link the Archives state (gold-set R12 refinement: never pair by name). Same thing, older printing: harmless.`;
const ROUNDS = (gun) => `intended: the Rounds ammunition record carries ${gun}'s page by design; the link opens the gun's own record (same name, newer printing).`;
const PAIR_REASONS = {
  'feat-2352|feats:daywalker': BLOCKED('feats/daywalker-vampire (level 6, Vampire)', 'feat-2352 is the Dhampir ancestry feat, Ancestry Guide, level 13'),
  'feat-2679|feats:riptide': BLOCKED('feats/riptide-undersea-privateer (level 8)', 'feat-2679 is the Azarketi Riptide, level 9'),
  'feat-4948|feats:watch-your-back': BLOCKED('feats/watch-your-back-golden-legionnaire (level 14)', "feat-4948 is the Rogue's Watch Your Back, Player Core, level 6"),
  'feat-6145|feats:even-the-odds': BLOCKED('feats/even-the-odds-eagle-knight (level 14)', "feat-6145 is the Swashbuckler's Even the Odds, Player Core 2, level 4"),
  'feat-884|feats:necromantic-resistance': BLOCKED('feats/necromantic-resistance-undead-slayer', "feat-884 is the Lastwall Sentry's, World Guide"),
  'equipment-3482|items:dragon-pearl': BLOCKED('items/dragon-pearl-draconic-codex (level 16)', 'equipment-3482 is the Tian Xia Character Guide Dragon Pearl, level 10'),
  'equipment-3126|items:martyrs-shield': BLOCKED('items/martyrs-shield-hellbreakers', "equipment-3126 is GM Core's; the bare record carries the Hellbreakers page equipment-4193 — the names are swapped"),
  'innovation-1|innovation:armor': OTHER_PRINTING('classFeatures/armor-innovation', 'innovation/armor (legacy-era innovation-5)'),
  'innovation-2|innovation:construct': OTHER_PRINTING('classFeatures/construct-innovation', 'innovation/construct (legacy-era innovation-6)'),
  'innovation-3|innovation:weapon': OTHER_PRINTING('classFeatures/weapon-innovation', 'innovation/weapon (legacy-era innovation-7)'),
  'weapon-191|items:flintlock-musket': ROUNDS('the Flintlock Musket'),
  'weapon-195|items:arquebus': ROUNDS('the Arquebus'),
  'weapon-201|items:dueling-pistol': ROUNDS('the Dueling Pistol'),
  'feat-4188|feats:voice-of-the-elements': 'the page "Voice of the Elements" (Rage of Elements, kineticist) is carried by feats/voice-of-elements, whose name lacks "the"; one self-link on its own page.',
  'feat-1945|feats:breath-of-the-dragon': 'two records carry feat-1945 (feats/breath-of-the-dragon-dragonblood is a mis-stamped twin of the Player Core 2 Dragonblood feat), so no single record is the page\'s own; fix the stamp first.',
  'feat-6432|feats:many-guises': 'two records carry feat-6432 (feats/many-guises-kitsune is a mis-stamped twin of the Tian Xia kitsune feat feat-6883), so no single record is the page\'s own; fix the stamp first.',
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

const counts = { links: 0, ok: 0, dead: 0, E1: 0, E1b: 0, E2: 0, E3: 0, E4: 0, baselined: 0, failed: 0 };
const seen = new Map(); // 'to|ref' -> { reason, carriers, where: [] , n }
const featureToClass = []; // rule 2
const planned = new Map(); // rule 3: why -> { n, ex: [] }
const FEATURE = /^class-feature-\d/;
for (const f of files) {
  const bucket = f.slice(0, -'.json.gz'.length);
  const trees = JSON.parse(gunzipSync(readFileSync(join(AST_DIR, f))).toString('utf8'));
  for (const [key, tree] of Object.entries(trees)) {
    for (const c of planTree(bucket, key, tree, ctx)) {
      const e = planned.get(c.why) ?? planned.set(c.why, { n: 0, ex: [] }).get(c.why);
      e.n++;
      if (e.ex.length < 12) e.ex.push(`    ${bucket}/${key}: "${labelOf(c.node)}" (${c.node.to}${c.node.auto ? ', auto' : ''}) ${c.from} -> ${c.ref}`);
    }
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.t === 'link' && n.to != null) {
        counts.links++;
        if (FEATURE.test(String(n.to)) && String(n.ref ?? '').startsWith('classes:') && featureToClass.length < 200) {
          featureToClass.push(`  ${n.to} opens ${n.ref} in ${bucket}/${key}`);
        }
        if (!recordOf(n.ref)) counts.dead++;
        else {
          const v = classify(n.to, n.ref);
          if (v in counts) counts[v]++;
          else {
            const pair = `${n.to}|${n.ref}`;
            const e = seen.get(pair) ?? seen.set(pair, { reason: v, carriers: carriers.get(String(n.to)) ?? [], where: [], n: 0 }).get(pair);
            e.n++;
            if (e.where.length < 3) e.where.push(`${bucket}/${key}`);
          }
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
    pairs[pair] = { reason: e.reason, carriers: e.carriers, opens: recordOf(pair.split('|')[1])?.name ?? '', ...(PAIR_REASONS[pair] ? { why: PAIR_REASONS[pair] } : {}) };
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
  const why = Object.keys(listed).filter((p) => !stale.includes(p) && PAIR_REASONS[p] && listed[p].why !== PAIR_REASONS[p]);
  if (!stale.length && !why.length) { console.log('ast-link-carrier: --shrink — nothing to drop'); process.exit(0); }
  for (const p of stale) delete listed[p];
  for (const p of why) listed[p].why = PAIR_REASONS[p];
  base.pairs = listed;
  base.max = Object.keys(listed).length;
  if (stale.length) base._ = `${String(base._ ?? '').replace(/\s*Shrunk .*$/, '')} Shrunk by --shrink after the package-I relink pass (scripts/relink-carried-pages.mjs, 2026-10-17); each remaining pair's "why" comes from PAIR_REASONS in the check.`;
  writeFileSync(BASELINE, JSON.stringify(base, null, 1) + '\n');
  console.log(`ast-link-carrier: --shrink — dropped ${stale.length} pair(s), wrote ${why.length} reason(s); max is now ${base.max}:\n   ${stale.join('\n   ')}`);
  process.exit(0);
}

const plannedN = [...planned.values()].reduce((a, e) => a + e.n, 0);
const summary = `${counts.links} links${featureToClass.length ? '' : ' (none from a class feature to a class page)'}: ${counts.ok} open the page's own record, ${counts.E1}+${counts.E1b} follow its reprint (E1/E1b), ${counts.E2} a same-named record (E2), ${counts.E3} a family's base grade (E3), ${counts.E4} a shared class feature (E4), ${counts.baselined} baselined (${seen.size - fails.length} pair(s)), ${counts.dead} DEAD (no ref, or a ref naming no shipped record: plain text)${plannedN ? '' : '; the relink pass plans nothing'}`;
if (args.has('--list')) for (const [pair, e] of seen) if (listed[pair]) console.log(`  KNOWN ${describe(pair, e)}  [${e.reason}]`);
if (stale.length) console.log(`ast-link-carrier: ${stale.length} baselined pair(s) no longer occur — run node scripts/ast-link-carrier-check.mjs --shrink:\n   ${stale.join('\n   ')}`);
const unexplained = Object.keys(listed).filter((p) => !stale.includes(p) && !PAIR_REASONS[p]);
if (fails.length || over || featureToClass.length || plannedN) {
  const head = fails.length ? `${fails.length} link pair(s) open a record other than the one that carries their page:\n${fails.join('\n')}\n` : '';
  const grew = over ? `  the baseline lists ${Object.keys(listed).length} pairs but its max is ${base.max}: it may only shrink — a new pair is a bug to fix, not a line to add\n` : '';
  const rule2 = featureToClass.length ? `${featureToClass.length} link(s) to a class feature open a class page (rule 2):\n${featureToClass.join('\n')}\n` : '';
  const rule3 = plannedN ? `${plannedN} link(s) are not where the relink rule puts them (rule 3) — run node scripts/relink-carried-pages.mjs --write:\n${[...planned].map(([w, e]) => `  ${w} ${e.n}:\n${e.ex.join('\n')}`).join('\n')}\n` : '';
  console.error(`ast-link-carrier: FAIL — ${head}${grew}${rule2}${rule3}   (${summary})\n   A link's ref comes from resolveTo in scripts/import-core-v2.mjs, then scripts/relink-carried-pages.mjs (rule: scripts/lib/ast-link-ref.mjs).`);
  process.exit(1);
}
if (unexplained.length) console.log(`ast-link-carrier: ${unexplained.length} baselined pair(s) carry no PAIR_REASONS line yet (frozen 2026-10-16): ${unexplained.join(', ')}`);
console.log(`ast-link-carrier: ok — ${summary}.`);
