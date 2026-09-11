/*
 * WHY THIS SCRIPT EXISTS.
 *
 * Guy, 2026-09-10: *"i cant trust them and i will go over them in the future but for now i want to turn
 * them off … if we have implementation on all of the thing wg has then the app is palyble and because we
 * implemented the smae as them the implementation is trustworthy."* docs/trust-gate.md is the plan; this
 * is section 7 step 1's generator. It writes ONE file — the OFF list, src/data/trust-ledger.json — that
 * the runtime gate (step 2) reads to decide which field paths on which records stop touching the sheet.
 *
 * IT IS A DENYLIST, NOT AN ALLOWLIST (plan section 2). The only paths it may ever name are the 137 in
 * scripts/data/trust-fields.json. A record this script never reaches keeps everything, which is the
 * failure direction the app can survive: an allowlist over an undefined field universe would strip
 * weapon damage and armour AC off 18,701 records the first time the generator had a bug.
 *
 * WHAT IT DECIDES, per record of the 8 WG-paired buckets and per PATH (plan section 2):
 *   · a path stays ON when ANY kind it answers is a kind Wanderer's Guide encodes on that record
 *     ("the trusted unit is the KIND on a record, not the record" — ruling Q1, read per
 *     docs/trust-gate-decisions.md decision 1). ANY, not EVERY: `innateSpells` answers
 *     spellcasting+spell, and a WG row that encodes only `spell` HAS encoded the innate spell — the
 *     aeon stones are the case. Same shape for focusSpells, focusPoolBonus and derivedGrant;
 *   · classes / ancestries / backgrounds are the character CHASSIS and are all-on;
 *   · deities are all-on by construction — they are not one of the 8 buckets and are never walked (Q2);
 *   · scripts/data/trust-approvals.json (the desk rulings, hand-maintained by the owner's answers) can
 *     bring any path back;
 *   · nothing outside the 8 buckets is touched at all.
 *
 * IT DOES NOT NEED work/wg/wg-data.sql. It reads the ALREADY-COMPUTED comparer output
 * (work/.wg-diff-all.json), because that file carries exactly what the decision needs — theirKinds per
 * record — and nothing of Wanderer's Guide's own text, ids, values or field names. That is also why the
 * generated ledger can be tracked and shipped from a clean clone, which is how releases are cut.
 * The dump stays required only for REGENERATING the comparer output, which this script refuses to do
 * silently: it compares mtimes and tells you the one command to run.
 *
 * Usage:
 *   node scripts/trust-ledger.mjs --census-dir work/.trust-census   -> src/data/trust-ledger.json + the four owner review files
 *   node scripts/trust-ledger.mjs --batched-only --out work/.trust-ledger-batched-only.json
 *                                                              -> trust ONLY records a closed batch read
 * ⚠ ALWAYS pass --out with --batched-only. Without it the stricter ledger lands on the TRACKED path and
 * the app silently ships the answer the owner has not given (decision 8: the mode is still his call).
 * Both census lines are printed on every run, in both modes, so the owner can choose between them.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(k);
const refuse = (m) => { console.error(`trust-ledger REFUSED: ${m}`); process.exit(2); };
const R = (p) => join(ROOT, p);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const OUT = arg('--out', 'src/data/trust-ledger.json');
const CENSUS_DIR = arg('--census-dir', null);
const BATCHED_ONLY = flag('--batched-only');
const DIFF_PATH = arg('--wg-diff', 'work/.wg-diff-all.json');

/* The 8 buckets WG is actually paired against — scripts/lib/wg-parse.mjs:124. Every other bucket
 * (spells, runes, deities, familiarAbilities, the ~30 glossary buckets …) is ON by construction. */
const BUCKETS = ['feats', 'classFeatures', 'heritages', 'backgrounds', 'items', 'ancestries', 'classes', 'actions'];
/* The character chassis. Plan section 2 step 3: every field on one of these records is on — they were
 * batched in B19-B23 and B28 and WG's per-row ops do not map to chassis fields. */
const CHASSIS = new Set(['classes', 'ancestries', 'backgrounds']);
/* Plan section 2 step 5. One kind per lane, deliberately: a lane list is read by CODE keyed by bare id,
 * not by field path, so the question a lane asks is "is this kind trusted on the carrier record".
 * `featGrants` is the exception and is PER KIND — see FEATGRANT_KEY_KINDS below. */
const LANE_KIND = { situational: 'conditional', modes: 'conditional', stances: 'conditional' };
/*
 * The registries each lane gates — plan section 3. Only the top-level KEYS are read; the kinds come
 * from LANE_KIND. Same regex the differ uses to walk these files (scripts/wg-diff.mjs:849, :866).
 *
 * An entry is `file` (scrape the whole file) or `file#SYMBOL` (scrape only that object literal).
 * ⚠ THE SYMBOL FORM IS LOAD-BEARING FOR situationalBonuses.ts, which holds SEVEN top-level `Record`
 * objects. Only two of them carry stars: FEAT_SITUATIONAL, which `entriesFor` reads (:4027, the lever
 * plan section 3 gates), and CHOICE_SITUATIONAL, whose `choiceSituationalFor` (:4132) synthesises a
 * star from the player's answer. The other five are display: RECORD_MARKERS and SPELL_MARKERS are
 * printed MARKS with their own readers, and SITUATIONAL_SUPERSEDES is a relationship table. A
 * whole-file scrape put 123 of those ids on the star lane — measured — and section 1 says printed
 * prose is never stripped, so a lane list that names them is a lane list that can suppress print.
 */
const LANE_REGISTRY = {
  situational: ['src/rules/situationalBonuses.ts#FEAT_SITUATIONAL', 'src/rules/situationalBonuses.ts#CHOICE_SITUATIONAL'],
};

/*
 * THE featGrants LANE IS PER KIND — decision 2, and the fix for the under-coverage this file used to
 * carry as a known hole. `FEAT_GRANTS` is a SPREAD (src/rules/featGrants.ts:753-756) of three tables,
 * and only one of them lives in featGrants.ts, so a scrape of that one file reached 247 ids too few.
 * Widening the scrape under a single `grantsRecord` kind was NOT the fix: it would have darkened ~110
 * records on which Wanderer's Guide does encode `skill` — the one invariant the ledger may not break.
 * Per kind is what makes the widening safe: the auto tables deliver `skill`, `ironclad-fortitude`
 * delivers `save`, an armour cascade delivers `ac`+`choice`, and each is asked about SEPARATELY, so a
 * carrier keeps every kind WG encodes on it and loses only the rest.
 *
 * `lanes.featGrants` is therefore `{ "<id>": ["skill","save"] }` — the OFF kinds. An id absent from
 * the map is fully trusted; `grantsFor(id)` (lane C) removes the listed kinds from the entry and
 * returns undefined when nothing is left.
 *
 * FEATGRANT_KEY_KINDS is copied verbatim from scripts/wg-diff.mjs:838-846, on purpose: the differ uses
 * it to CREDIT a record with these kinds, and this file uses it to ask whether that credit exists. Two
 * different tables would let a kind be credited under one name and gated under another.
 */
const FEATGRANT_KEY_KINDS = {
  skills: ['skill'], skillChoices: ['skill', 'choice'], conditionalSkills: ['skill'],
  crossConditionalSkills: ['skill'], loreChoices: ['skill', 'choice'], bonusSkillFeat: ['grantsRecord'],
  save: ['save'], perception: ['perception'], armor: ['ac'], armorCascade: ['ac', 'choice'],
  weapon: ['weapon'], weaponFamiliarity: ['weapon'], choiceGrants: ['choice'],
  redundantFallback: ['choice'], rankUpgrade: [], minLevel: [],
};
/* The three tables FEAT_GRANTS spreads (src/rules/featGrants.ts:753-756). Read per ENTRY, because a
 * FeatGrant says what it grants and a per-file kind list cannot. */
const FEATGRANT_TABLES = [
  'src/rules/featGrantsAuto.ts#FEAT_SKILL_GRANTS',
  'src/rules/featGrantsLane.ts#FEAT_LANE_GRANTS',
  'src/rules/featGrants.ts#HAND_AUTHORED_GRANTS',
];
/* The seven tables of featFeatGrants.ts (plan section 3) deliver exactly one thing — a bonus FEAT —
 * so they need no per-entry reading: every key on that file is a `grantsRecord` carrier. */
const FEATFEAT_FILE = 'src/rules/featFeatGrants.ts';

/* ------------------------------------------------------------------ inputs */
if (!existsSync(R('public/core.json'))) refuse('no public/core.json');
const coreRaw = readFileSync(R('public/core.json'));
const core = JSON.parse(coreRaw);
const coreSha = sha(coreRaw);

if (!existsSync(R(DIFF_PATH))) {
  refuse(`no ${DIFF_PATH} — run: node scripts/wg-diff.mjs --out ${DIFF_PATH}  (that step, and only that step, needs work/wg/wg-data.sql)`);
}
const diffRaw = readFileSync(R(DIFF_PATH));
const diff = JSON.parse(diffRaw);
const wgSha = sha(diffRaw);
/* A ledger built on a comparer run older than the data it gates is a ledger about records that may no
 * longer exist. Cheap check, loud refusal — the alternative is a silently wrong OFF list. */
if (statSync(R(DIFF_PATH)).mtimeMs < statSync(R('public/core.json')).mtimeMs) {
  refuse(`${DIFF_PATH} is older than public/core.json — re-run: node scripts/wg-diff.mjs --out ${DIFF_PATH}`);
}

const fieldsFile = JSON.parse(readFileSync(R('scripts/data/trust-fields.json'), 'utf8'));
const FIELDS = fieldsFile.paths;
/* leaf -> kinds, so an approvals entry may name a bare field ("innateSpells") and still match the
 * nested paths that carry it. */
const kindsByPath = new Map(FIELDS.map((f) => [f.path, f.kinds]));
const kindsByLeaf = new Map();
for (const f of FIELDS) {
  const leaf = f.path.split('.').pop().replace(/\[\]$/, '');
  kindsByLeaf.set(leaf, [...new Set([...(kindsByLeaf.get(leaf) ?? []), ...f.kinds])]);
}

/* The desk rulings. Created EMPTY if lane B has not written it yet; never overwritten. */
const APPROVALS_PATH = R('scripts/data/trust-approvals.json');
if (!existsSync(APPROVALS_PATH)) {
  writeFileSync(APPROVALS_PATH, `${JSON.stringify({
    _: "WHY: docs/trust-gate.md section 2b. Every desk number in work/desk-answers-2026-09-10.json must appear in exactly one of the four lists below. `approvals` entries are the ONLY way a ruling that ADDS a mechanic Wanderer's Guide lacks survives the trust gate — without one it ships dark. Hand-maintained; scripts/trust-ledger.mjs creates this file empty and never overwrites it.",
    _shapes: {
      approvals: '{ "n": 28, "record": "items/unifying-emblem-shundar-quah", "fields": ["innateSpells"], "why": "…" }  — record is bucket/id; fields are trust-fields paths or their bare leaf',
      noMechanic: '{ "n": 15, "why": "the ruling changes nothing a field carries" }',
      engine: '{ "n": 127, "why": "the ruling is code, not a record field" }',
      unruled: '{ "n": 1, "why": "the desk file skips this number" }',
    },
    approvals: [], noMechanic: [], engine: [], unruled: [],
  }, null, 1)}\n`);
  console.log('trust-ledger: wrote an EMPTY scripts/data/trust-approvals.json (lane B fills it in)');
}
const approvalsFile = JSON.parse(readFileSync(APPROVALS_PATH, 'utf8'));
/** bucket/id -> Set(approved field or path) */
const approvedBy = new Map();
for (const a of approvalsFile.approvals ?? []) {
  if (!a?.record) continue;
  const set = approvedBy.get(a.record) ?? new Set();
  for (const f of a.fields ?? []) set.add(f);
  approvedBy.set(a.record, set);
}

/* Ids a CLOSED batch has read. A batch is closed when its close stage wrote the parity artefact
 * (scripts/wg-batch-run.mjs stage `close` -> work/wg-batch-NNN-parity.json). */
const batchedKeys = new Set();
const closedBatches = [];
for (const f of readdirSync(R('work'))) {
  const m = /^wg-batch-(\d{3})\.json$/.exec(f);
  if (!m || !existsSync(R(`work/wg-batch-${m[1]}-parity.json`))) continue;
  closedBatches.push(m[1]);
  const rows = JSON.parse(readFileSync(R(`work/${f}`), 'utf8'));
  for (const r of Array.isArray(rows) ? rows : Object.values(rows)) {
    if (r?.id && r?.bucket) batchedKeys.add(`${r.bucket}/${r.id}`);
  }
}

/* ------------------------------------------------------------- their kinds */
/** bucket/id -> Set(kind WG encodes). A record WG has no row for, or encodes nothing on, gets ∅. */
const theirKinds = new Map();
const wgEncoded = new Set();   // rows where WG encodes at least one op
for (const list of ['theyOnly', 'weOnly', 'agree']) {
  for (const r of diff[list] ?? []) {
    if (!r.bucket) refuse(`${DIFF_PATH} row ${r.id} carries no bucket — re-run wg-diff.mjs (it emits bucket since 2026-09-10)`);
    if (!BUCKETS.includes(r.bucket)) refuse(`${DIFF_PATH} row ${r.bucket}/${r.id} names a bucket outside the 8 paired ones`);
    if (!core[r.bucket]?.[r.id]) refuse(`${DIFF_PATH} row ${r.bucket}/${r.id} resolves to no record in public/core.json`);
    theirKinds.set(`${r.bucket}/${r.id}`, new Set(r.theirKinds ?? []));
    wgEncoded.add(`${r.bucket}/${r.id}`);
  }
}
for (const list of ['noMatch', 'theirsUnencoded']) {
  for (const r of diff[list] ?? []) {
    if (!r.bucket) refuse(`${DIFF_PATH} ${list} row ${r.id} carries no bucket — re-run wg-diff.mjs`);
    theirKinds.set(`${r.bucket}/${r.id}`, new Set());
  }
}

/*
 * THE 801 RECORDS THE COMPARER NEVER WALKS DEFER TO THEIR OWNER, THEY ARE NOT UNTRUSTED.
 *
 * wgOwnsComparison (scripts/lib/wg-parse.mjs:256) skips two shapes: an `aon-` twin shadowed by a
 * canonical record of the same name in the same bucket (591), and an `actions` row whose feat or class
 * feature of the same id owns the comparison (210). Treating either as "WG has no row" would darken a
 * record whose owner WG encodes perfectly well — the action a trusted feat grants, most of all. Each
 * inherits its owner's kinds instead; a record with no owner keeps ∅, which is the ruled behaviour.
 */
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const canonicalByName = new Map();   // bucket -> Map(normName -> id) over non-aon records
for (const b of BUCKETS) {
  const m = new Map();
  for (const [id, rec] of Object.entries(core[b] ?? {})) if (rec?.name && !id.startsWith('aon-')) m.set(norm(rec.name), id);
  canonicalByName.set(b, m);
}
const ownerOf = (bucket, id) => {
  if (id.startsWith('aon-')) {
    const twin = canonicalByName.get(bucket)?.get(norm(core[bucket][id].name));
    if (twin && twin !== id) return `${bucket}/${twin}`;
  }
  if (bucket === 'actions') {
    if (core.feats?.[id]) return `feats/${id}`;
    if (core.classFeatures?.[id]) return `classFeatures/${id}`;
  }
  return undefined;
};

/* ------------------------------------------------------------ path reading */
/** Every value a path resolves to on a record; `[]` walks an array. Presence = at least one value. */
function pathValues(rec, path) {
  const out = [];
  const walk = (node, segs) => {
    if (node == null) return;
    if (!segs.length) { if (node !== undefined) out.push(node); return; }
    const [s, ...rest] = segs;
    if (s.endsWith('[]')) {
      const arr = node[s.slice(0, -2)];
      if (Array.isArray(arr)) for (const el of arr) walk(el, rest);
      return;
    }
    walk(node[s], rest);
  };
  walk(rec, path.split('.'));
  return out;
}

/* ------------------------------------------------------------ the decision */
function buildLedger(batchedOnly) {
  /** kinds WG is credited with on this record, under the chosen trust source. */
  const trustedOf = (key) => {
    const [bucket, id] = key.split('/');
    const owner = ownerOf(bucket, id);
    if (batchedOnly && !batchedKeys.has(key) && !(owner && batchedKeys.has(owner))) return new Set();
    return theirKinds.get(key) ?? (owner && theirKinds.get(owner)) ?? new Set();
  };
  /** does an approvals entry on this record bring `kind` back? */
  const approvedKinds = (key) => {
    const s = new Set();
    for (const f of approvedBy.get(key) ?? []) for (const k of kindsByPath.get(f) ?? kindsByLeaf.get(f) ?? []) s.add(k);
    return s;
  };
  const kindOn = (bucket, id, kind) => {
    if (!BUCKETS.includes(bucket)) return true;          // outside the 8 buckets: never gated
    if (CHASSIS.has(bucket)) return true;                // chassis is all-on
    const key = `${bucket}/${id}`;
    return trustedOf(key).has(kind) || approvedKinds(key).has(kind);
  };

  const records = {};
  const stats = { fullyOn: 0, partlyOn: 0, off: 0, byBucket: {}, fullyDark: [] };
  for (const bucket of BUCKETS) {
    stats.byBucket[bucket] = { records: 0, withOffPaths: 0, fullyDark: 0, offPaths: 0 };
    for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
      if (!rec?.name) continue;
      stats.byBucket[bucket].records++;
      if (CHASSIS.has(bucket)) { stats.fullyOn++; continue; }
      const key = `${bucket}/${id}`;
      const trusted = trustedOf(key);
      const approved = approvedBy.get(key) ?? new Set();
      let present = 0;
      const off = [];
      for (const { path, kinds } of FIELDS) {
        if (!pathValues(rec, path).length) continue;
        present++;
        /* ANY, not EVERY — decision 1. See the header. */
        if (kinds.some((k) => trusted.has(k))) continue;
        if (approved.has(path) || approved.has(path.split('.').pop().replace(/\[\]$/, ''))) continue;
        off.push(path);
      }
      if (!off.length) { stats.fullyOn++; continue; }
      records[key] = off.sort();
      stats.byBucket[bucket].withOffPaths++;
      stats.byBucket[bucket].offPaths += off.length;
      if (off.length === present) {
        stats.off++;
        stats.byBucket[bucket].fullyDark++;
        stats.fullyDark.push({ record: key, name: rec.name, level: rec.level ?? null, theirKinds: [...trusted].sort(), offPaths: off });
      } else stats.partlyOn++;
    }
  }

  /* ---- lanes. A lane list is keyed by BARE id, which is how the code registries key, so an id gets
   * on a lane only when EVERY bucket twin is off for that lane's kind — fail open, never darken a
   * trusted twin (plan section 2, "Bucket keying needs a one-line fix first"). */
  const twinsOf = (id) => BUCKETS.filter((b) => core[b]?.[id]?.name);
  const allTwinsOff = (id, kind) => {
    const tw = twinsOf(id);
    return tw.length > 0 && tw.every((b) => !kindOn(b, id, kind));
  };
  /** every `  key: [` / `  key: {` entry of a registry file (or of one `file#SYMBOL` table), with the
   *  text that belongs to it — the body is what tells a FeatGrant lane WHICH kinds an entry delivers. */
  const registryEntries = (spec) => {
    const [file, symbol] = spec.split('#');
    let text = '';
    try { text = readFileSync(R(file), 'utf8'); } catch { return []; }
    if (symbol) {
      /* A renamed or deleted table must be loud, not an empty lane: an empty lane reads as "everything
       * on this registry is trusted", which is the one wrong answer that looks like a right one. */
      const i = text.search(new RegExp(`^(?:export )?const ${symbol}\\b`, 'm'));
      if (i < 0) refuse(`${file} has no top-level \`${symbol}\` — the ${spec} lane scrape would silently return nothing`);
      const j = text.indexOf('\n};', i);
      text = j < 0 ? text.slice(i) : text.slice(i, j);
    }
    const ms = [...text.matchAll(/^\s{2}(?:['"]([a-z0-9][a-z0-9-]{2,})['"]|([a-z][a-zA-Z0-9]{2,}))\s*:\s*[[{]/gm)];
    return ms.map((m, i) => ({ id: m[1] ?? m[2], body: text.slice(m.index, ms[i + 1]?.index ?? text.length) }));
  };
  const registryKeys = (spec) => registryEntries(spec).map((e) => e.id);
  const lanes = { engine: [], featGrants: {}, modes: [], situational: [], stances: [] };
  {
    const ids = new Set(LANE_REGISTRY.situational.flatMap(registryKeys));
    lanes.situational = [...ids].filter((id) => allTwinsOff(id, LANE_KIND.situational)).sort();
  }
  /* ---- the per-kind featGrants lane (decision 2). */
  const grantKinds = new Map();   // id -> Set(kind the registry entry delivers)
  const addGrantKinds = (id, kinds) => {
    const s = grantKinds.get(id) ?? new Set();
    for (const k of kinds) s.add(k);
    grantKinds.set(id, s);
  };
  for (const spec of FEATGRANT_TABLES) {
    const entries = registryEntries(spec);
    if (!entries.length) refuse(`${spec} scraped 0 entries — a lane that names nothing reads as "all trusted"`);
    for (const { id, body } of entries) {
      for (const [key, kinds] of Object.entries(FEATGRANT_KEY_KINDS)) {
        if (kinds.length && new RegExp(`['"]?${key}['"]?\\s*:`).test(body)) addGrantKinds(id, kinds);
      }
    }
  }
  for (const id of registryKeys(FEATFEAT_FILE)) addGrantKinds(id, ['grantsRecord']);
  for (const [id, kinds] of grantKinds) {
    const off = [...kinds].filter((k) => allTwinsOff(id, k)).sort();
    if (off.length) lanes.featGrants[id] = off;
  }
  /* A mode/stance reaches a character through its CARRIER: the same slug, the records the mode names in
   * feats/classes/ancestries/backgrounds (a gate may be `id` or `id:answer`), or the item it came from.
   * `activeStanceEntry` (src/rules/derive.ts:1117) applies a stance with NO ownership test at all, which
   * is why the payload has to be gated by the carrier here rather than trusted to the engine. */
  const carrierOff = (carriers) => {
    const real = carriers.filter((c) => BUCKETS.some((b) => core[b]?.[c]?.name));
    return real.length > 0 && real.every((c) => allTwinsOff(c, 'conditional'));
  };
  lanes.modes = Object.entries(core.modes ?? {}).filter(([id, m]) => carrierOff([
    id, m?.fromItemId, ...(m?.feats ?? []).map((f) => String(f).split(':')[0]),
    ...(m?.classes ?? []), ...(m?.ancestries ?? []), ...(m?.backgrounds ?? []),
  ].filter(Boolean))).map(([id]) => id).sort();
  lanes.stances = Object.keys(core.stances ?? {}).filter((id) => carrierOff([id])).sort();
  /*
   * The hard-coded engine lanes (plan section 3), inventoried in scripts/data/trust-lanes.json.
   *
   * A lane is OFF when the KIND it delivers is untrusted on its record, through the same every-twin
   * rule as the other lanes, so a trusted twin is never darkened by its namesake.
   *
   * ⚠ THE OTHER HALF OF THE PLAN'S SENTENCE — "or its record is fully dark" — IS NOT A SECOND TEST,
   * and adding it as one measurably breaks the ledger's own invariant. `fullyDark` here counts a
   * record whose every PRESENT strippable path is off, which for a path-poor record says nothing
   * about trust: `feats/inventor-dedication` carries exactly one strippable path (`classDcGrant`,
   * which Wanderer's Guide does not encode) and so counts as fully dark while WG encodes
   * grantsRecord, choice and skill on it. Turning its innovation lane off on that basis would darken
   * a record WG implements — the one thing the ledger may not do (decisions 1 and 2). A record that
   * is untrusted WHOLE shares no kind with WG, and then every kind is off, which this test already
   * says. So the fully-dark half collapses into the kind test rather than widening it.
   *
   * `"gated": false` is a recorded DECISION that the gate must not touch that lane at all — a limit,
   * a prerequisite, prose, a recorded pick, a chassis identity test. Those entries exist so the guard
   * can tell a classified lane from a new one; they never reach the runtime.
   */
  const lanesFile = existsSync(R('scripts/data/trust-lanes.json'))
    ? JSON.parse(readFileSync(R('scripts/data/trust-lanes.json'), 'utf8')) : null;
  for (const e of lanesFile?.lanes ?? []) {
    if (e?.id && e.gated !== false && allTwinsOff(e.id, e.kind ?? 'conditional')) lanes.engine.push(e.id);
  }
  lanes.engine = [...new Set(lanes.engine)].sort();

  return { ledger: { coreSha, wgSha, generator: 'scripts/trust-ledger.mjs', lanes, records }, stats };
}

/* --------------------------------------------------------------- determinism */
const sortDeep = (v) => {
  if (Array.isArray(v)) return v.every((x) => typeof x === 'string') ? [...v].sort() : v.map(sortDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  return v;
};
const stable = (o) => `${JSON.stringify(sortDeep(o), null, 1)}\n`;

/* -------------------------------------------------------------------- run */
const modes = { default: buildLedger(false), batchedOnly: buildLedger(true) };
const chosen = BATCHED_ONLY ? modes.batchedOnly : modes.default;
const text = stable(chosen.ledger);
writeFileSync(R(OUT), text);

const census = (label, m, bytes) => {
  const lanes = m.ledger.lanes;
  const code = Object.keys(lanes.featGrants).length + lanes.modes.length + lanes.stances.length + lanes.engine.length;
  return `${label}trust gate: ${m.stats.fullyOn} fully on · ${m.stats.partlyOn} partly on · ${m.stats.off} off`
    + ` · ${lanes.situational.length} stars suppressed · ${code} code lanes gated · deities all on`
    + ` · ledger ${Math.round(bytes / 1024)} KB · coreSha ${m.ledger.coreSha === coreSha ? 'ok' : 'MISMATCH'}`;
};
console.log(`-> ${OUT}  (${BATCHED_ONLY ? '--batched-only' : 'default'} mode)`);
console.log(census('default        ', modes.default, Buffer.byteLength(stable(modes.default.ledger))));
console.log(census('--batched-only ', modes.batchedOnly, Buffer.byteLength(stable(modes.batchedOnly.ledger))));
/* The featGrants tables refuse when they scrape nothing, because an empty lane reads as "all trusted".
 * The ENGINE lane cannot refuse — plan section 3 has lane C write scripts/data/trust-lanes.json AFTER
 * this generator exists, so absent must mean empty. It must not mean SILENTLY empty: a ledger built
 * before that file lands ships every hard-coded engine id trusted, and nothing else would say so. */
if (!chosen.ledger.lanes.engine.length) {
  const why = existsSync(R('scripts/data/trust-lanes.json')) ? 'names no id yet' : 'is absent';
  console.log(`   ⚠ engine lane EMPTY: scripts/data/trust-lanes.json ${why} (lane C writes it) — regenerate this ledger once it lands, or every hard-coded engine id ships trusted`);
}

/* ----------------------------------------------------------------- census */
if (CENSUS_DIR) {
  mkdirSync(R(CENSUS_DIR), { recursive: true });
  const w = (f, o) => writeFileSync(R(join(CENSUS_DIR, f)), stable(o));

  w('off-by-bucket.json', {
    _: 'How much of each paired bucket the gate turns off, in both trust modes. classes/ancestries/backgrounds are the chassis and are all-on by construction.',
    mode: BATCHED_ONLY ? '--batched-only' : 'default',
    default: modes.default.stats.byBucket,
    batchedOnly: modes.batchedOnly.stats.byBucket,
  });

  w('fully-dark.json', {
    _: 'Every record that ends FULLY dark while carrying a mechanic: every strippable path it has goes off. This is the largest visible change to a player and it is printed here rather than left to be found. A record here that Guy has ruled on needs an entry in scripts/data/trust-approvals.json or the ruling ships dark.',
    count: chosen.stats.fullyDark.length,
    mode: BATCHED_ONLY ? '--batched-only' : 'default',
    records: chosen.stats.fullyDark.sort((a, b) => a.record.localeCompare(b.record)),
  });

  const unread = [...wgEncoded].filter((k) => !batchedKeys.has(k) && !CHASSIS.has(k.split('/')[0])).sort();
  w('wg-encoded-unread.json', {
    _: 'Records Wanderer\'s Guide encodes that NO closed batch has read. In default mode these are trusted anyway — the directive says trust follows "we implemented the same as WG". `--batched-only` reverses exactly this list. Chassis buckets are excluded because they are all-on either way.',
    closedBatches: closedBatches.length,
    count: unread.length,
    records: unread,
  });

  const desk = JSON.parse(readFileSync(R('work/desk-answers-2026-09-10.json'), 'utf8'));
  const deskNumbers = [...new Set((desk.answers ?? []).flatMap((a) => a.ns ?? []))].sort((a, b) => a - b);
  /* A desk number may carry SEVERAL `approvals` rows (one ruling, several records — #28 is five quah
   * emblems), so the completeness question is "how many DISTINCT lists", not "how many rows". */
  const disposed = new Map();
  for (const list of ['approvals', 'noMechanic', 'engine', 'unruled']) {
    for (const e of approvalsFile[list] ?? []) disposed.set(e.n, new Set([...(disposed.get(e.n) ?? []), list]));
  }
  const skipped = [];
  for (let i = 1; i <= Math.max(...deskNumbers); i++) if (!deskNumbers.includes(i)) skipped.push(i);
  w('desk-dispositions.json', {
    _: 'Plan section 2b: every desk number in work/desk-answers-2026-09-10.json must appear in exactly ONE list of scripts/data/trust-approvals.json. `unaccounted` and `twice` must both be empty before the gate ships — the section-5 guard goes red while they are not.',
    deskNumbers: deskNumbers.length,
    skippedByTheDeskFile: skipped,
    accounted: [...disposed.keys()].filter((n) => deskNumbers.includes(n)).sort((a, b) => a - b),
    unaccounted: deskNumbers.filter((n) => !disposed.has(n)),
    twice: [...disposed.entries()].filter(([, l]) => l.size > 1).map(([n, l]) => ({ n, lists: [...l] })),
  });
  console.log(`-> ${CENSUS_DIR}/  (off-by-bucket, fully-dark, wg-encoded-unread, desk-dispositions)`);
}
