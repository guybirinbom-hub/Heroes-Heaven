/*
 * EVIDENCE PACKS for the feat audit — what the app ACTUALLY does with each feat, observed.
 *
 * For every sampled feat: build a host character without it, build the same character with it, and
 * diff every derived value. That diff is a statement of what the feat does, observed rather than
 * inferred from which fields it carries — which is the whole point. A lane can be satisfied in six
 * different places (a field, a passiveEffects sub-key, one of five id-keyed registries, a special
 * case inside buildCharacter, or the modes lane that lives in the data), so any checker that reads
 * the representation has to know all six and lies when it doesn't. Watching the outcome needs to know
 * none of them.
 *
 * An EMPTY diff is itself the strongest signal available: the feat changes nothing.
 *
 *   npx jiti scripts/feat-evidence.mjs                    # all 500, -> scripts/audit/feat-500-evidence.json
 *   npx jiti scripts/feat-evidence.mjs --limit 20         # smoke test
 *   npx jiti scripts/feat-evidence.mjs --in scripts/audit/batch-001.json --out scripts/audit/batch-001-evidence.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { packHash, packDelta } from './lib/audit-cache.mjs';
import { seedContent } from '../src/rules/seed';
import { buildCharacter, emptyBuild } from '../src/rules/build';
/* The derived-sheet snapshot and the generic diff moved to scripts/lib/sheet-snapshot.mjs (shared with
 * the WG experience harness, test/wg-experience.harness.test.tsx) so the two instruments cannot drift. */
import { snapshot as snapshotWith, diff } from './lib/sheet-snapshot.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };

/* Content exactly as the app assembles it, descriptions merged back in. */
const core = JSON.parse(read('public/core.json'));
const desc = JSON.parse(read('public/core-descriptions.json'));
for (const [bucket, records] of Object.entries(desc)) {
  if (!core[bucket]) continue;
  for (const [id, v] of Object.entries(records)) {
    const rec = core[bucket][id];
    if (rec && v.d !== undefined) rec.description = v.d;
  }
}
const db = {};
for (const k of new Set([...Object.keys(seedContent), ...Object.keys(core)])) {
  db[k] = { ...(seedContent[k] ?? {}), ...(core[k] ?? {}) };
}

/* The work list is a parameter, not a constant. It was the frozen 500-feat sample; from 2026-08-13 the
 * audit runs in LEVEL ORDER (scripts/feat-audit-order.mjs cuts scripts/audit/batch-NNN.json), and the
 * 500 stays only as the fixed instrument for "did the defect rate move". Both are {featIds:[...]}.
 * Defaults are the old paths so every existing invocation keeps working unchanged. */
/* `--only a,b,c` skips the work list entirely and reads exactly those feats. This is the tight loop:
 * fixing one feat and asking "what does the sheet do now?" should take seconds, not a batch run.
 * `builder-evidence.mjs` has had this flag all along; the two now match. */
const ONLY = arg('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const SAMPLE_IN = arg('in', 'scripts/audit/feat-500.json');
const sample = ONLY.length ? { featIds: ONLY } : JSON.parse(read(SAMPLE_IN));
const LIMIT = Number(arg('limit', 0)) || sample.featIds.length;

/* ── Host selection ────────────────────────────────────────────────────────────────────────────
 * A class feat needs the matching class or its own effects never fire; an ancestry feat needs the
 * ancestry. Matched off the feat's traits against class/ancestry names. */
const byName = (coll) => {
  const m = new Map();
  for (const [id, r] of Object.entries(db[coll] ?? {})) if (r?.name) m.set(r.name.toLowerCase(), id);
  return m;
};
const classByName = byName('classes');
const ancestryByName = byName('ancestries');

const DEFAULT_CLASS = db.classes?.fighter ? 'fighter' : Object.keys(db.classes ?? {})[0];
const DEFAULT_ANCESTRY = db.ancestries?.human ? 'human' : Object.keys(db.ancestries ?? {})[0];
const DEFAULT_BG = Object.keys(db.backgrounds ?? {})[0];

const hostFor = (feat) => {
  const traits = (feat.traits ?? []).map((t) => String(t).toLowerCase());
  let classId = DEFAULT_CLASS;
  let ancestryId = DEFAULT_ANCESTRY;
  for (const t of traits) {
    if (classByName.has(t)) classId = classByName.get(t);
    if (ancestryByName.has(t)) ancestryId = ancestryByName.get(t);
  }
  const cls = db.classes?.[classId];
  return {
    ...emptyBuild(),
    level: 20,
    ancestryId,
    backgroundId: DEFAULT_BG,
    classId,
    subclassId: cls?.subclass?.options?.[0]?.id ?? null,
    // ⚠ `keyAbility` is an ARRAY (wizard: ["int"]), not { options: [...] }. Reading `.options[0]` gave
    // undefined, so EVERY host silently built as a Strength character — a wizard with Str as its key
    // attribute. Found by the builder harness, which hit the identical bug in its own first draft.
    keyAbility: (Array.isArray(cls?.keyAbility) ? cls.keyAbility[0] : cls?.keyAbility?.options?.[0]) ?? 'str',
    deityId: Object.keys(db.deities ?? {})[0] ?? null,
  };
};

/* ── The diff ──────────────────────────────────────────────────────────────────────────────────
 * A generic deep diff over the derived character. Deliberately NOT a curated list of interesting
 * fields: a curated list can only surface effects someone already thought of, which is the failure
 * this whole exercise exists to escape. */
/**
 * ⚠ The sheet is NOT `buildCharacter`'s return value — snapshot the DERIVED values. The snapshot,
 * flattener and diff are `scripts/lib/sheet-snapshot.mjs`; this is the same call bound to this db.
 */
const snapshot = (c) => snapshotWith(c, db);

/* ── Registry hits: the id-keyed maps in src/rules that can carry a feat's mechanics. ─────────── */
const REGISTRIES = [
  'situationalBonuses', 'featGrantsAuto', 'featFeatGrants', 'featPickGrants',
  'featCantripGrants', 'companionGrants', 'featUses', 'modes',
];
const registryText = {};
for (const r of REGISTRIES) {
  try { registryText[r] = read(`src/rules/${r}.ts`); } catch { registryText[r] = ''; }
}
const registriesFor = (id) => REGISTRIES.filter((r) => registryText[r].includes(`'${id}'`) || registryText[r].includes(`"${id}"`));

/* ── Numbers stated in the text, for the value check the diff cannot do. ───────────────────────── */
const numbersIn = (text) => {
  const t = text.replace(/<[^>]+>/g, ' ');
  const hits = [];
  const pats = [
    [/\bresistance\s+(\d+)/gi, 'resistance'],
    [/\bweakness\s+(\d+)/gi, 'weakness'],
    [/([+-]\d+)\s+(circumstance|status|item|untyped)\b/gi, 'typedBonus'],
    [/\b(\d+)\s+(?:times?|uses?)\s+per\s+(day|hour|minute|round)\b/gi, 'perPeriod'],
    [/\b(\d+)\s*(?:-|\s)foot\b/gi, 'feet'],
    [/\b(\d+)(?:st|nd|rd|th)[- ]rank\b/gi, 'rank'],
    [/\b(\d+)d(\d+)\b/gi, 'dice'],
    [/\b(?:gain|gains)\s+(\d+)\s+(?:temporary\s+)?Hit Points/gi, 'hp'],
  ];
  for (const [re, kind] of pats) {
    let m;
    while ((m = re.exec(t))) hits.push({ kind, value: m[0].trim() });
  }
  return hits.slice(0, 24);
};

/* ── Run ───────────────────────────────────────────────────────────────────────────────────────*/
const CATEGORIES = ['class', 'ancestry', 'general', 'skill', 'archetype', 'mythic', 'bonus'];
const packs = [];
let landed = 0, empty = 0, unplaceable = 0;

for (const featId of sample.featIds.slice(0, LIMIT)) {
  const feat = db.feats[featId];
  if (!feat) continue;
  const base = hostFor(feat);
  const before = snapshot(buildCharacter(base, db));

  // Find a slot the feat actually lands in. The slot key is `level:category:idx` and the slot has to
  // genuinely render at that level, so try the feat's own category first, then the rest.
  let after = null, slotUsed = null;
  const cats = [feat.category, ...CATEGORIES].filter(Boolean);
  outer: for (const cat of cats) {
    for (const lvl of [feat.level ?? 1, 1, 2, 20]) {
      for (const idx of [0, 1]) {
        const key = `${lvl}:${cat}:${idx}`;
        const cand = buildCharacter({ ...base, featPicks: { [key]: featId } }, db);
        if (cand.feats?.some((f) => f.featId === featId)) { after = snapshot(cand); slotUsed = key; break outer; }
      }
    }
  }

  if (!after) { unplaceable++; packs.push({ featId, name: feat.name, placed: false }); continue; }
  landed++;

  const changes = diff(before, after).filter((c) => !c.path.startsWith(`stored.feats[${featId}]`));
  if (!changes.length) empty++;

  packs.push({
    featId,
    name: feat.name,
    level: feat.level ?? null,
    category: feat.category ?? null,
    traits: feat.traits ?? [],
    actionCost: feat.actionCost ?? null,
    text: String(feat.description ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim(),
    placed: true,
    host: { classId: base.classId, ancestryId: base.ancestryId, level: 20, slot: slotUsed },
    storedFields: Object.fromEntries(
      Object.entries(feat).filter(([k]) => !['name', 'id', 'description', 'descRefs', 'source', 'traits'].includes(k)),
    ),
    registries: registriesFor(featId),
    textNumbers: numbersIn(String(feat.description ?? '')),
    sheetDiff: changes.slice(0, 60),
    sheetDiffTruncated: changes.length > 60 ? changes.length : 0,
  });
}

/* ── What moved since the last run ──────────────────────────────────────────────────────────────
 * Each pack carries a hash of itself, and the run says how many changed. Re-running this script is
 * cheap; what is expensive is the 500-feat audit that reads its output, and the only question that
 * decides whether to launch it is "how many feats did my change actually move?". Answering it here —
 * before the merge, before a single token — is why the hash is worth carrying.
 * The field is internal: `merge-evidence.mjs` copies named fields, so it never reaches the reader. */
const OUT = arg('out', ONLY.length ? 'scripts/audit/feat-only-evidence.json' : 'scripts/audit/feat-500-evidence.json');
// A --only run is not comparable with a full one, so it must never overwrite the run's delta baseline.
const previous = !ONLY.length && existsSync(join(root, OUT)) ? JSON.parse(read(OUT)) : null;
for (const p of packs) p.hash = packHash(p);
const delta = packDelta(previous, packs);

mkdirSync(join(root, 'scripts/audit'), { recursive: true });
writeFileSync(join(root, OUT), JSON.stringify(packs, null, 1));
console.log(`feats processed      ${packs.length}`);
console.log(`  placed in a slot   ${landed}`);
console.log(`  UNPLACEABLE        ${unplaceable}  (no slot accepted them — evidence is text+fields only)`);
console.log(`  EMPTY sheet diff   ${empty}  <- change nothing when taken`);
console.log(
  delta.comparable
    ? `  CHANGED since last ${delta.changed.length}  (unchanged ${delta.unchanged}, new ${delta.added.length}, gone ${delta.removed.length})  <- only these need re-judging`
    : '  CHANGED since last  n/a — no comparable previous run, so every feat would be judged fresh',
);
console.log(`wrote ${OUT}`);
