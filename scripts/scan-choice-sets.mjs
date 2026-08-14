/*
 * BUILDER CHOICE SETS — the five shapes a picker goes wrong in, over the whole corpus.
 *
 *   npm run scan:choices            # the counts
 *   npm run scan:choices -- --list  # every id, every shape
 *
 * The audit read thirteen records. Each of its findings has a SHAPE, and a shape is a scan:
 *
 *   A  onlyAtLevel      "**Special** You can select this feat only at 1st level." The slot's level has
 *                       to EQUAL 1; `level` is only a floor, so every one of these was offerable in a
 *                       5th/9th/13th/17th-level ancestry slot. Audit named 1; the corpus prints 28.
 *   B  distinctAcrossTakes
 *                       "Each time, choose a DIFFERENT skill / type of terrain / type of mercy."
 *                       `distinct` separates the picks of ONE choice def; a repeatable feat's takes
 *                       sit in separate SLOTS and nothing crossed between them. Audit named 1; 3 print
 *                       the clause over an enumerable picker.
 *   C  twice-asked      A record carrying BOTH a `choice` and an `effectChoices` that ask the SAME
 *                       question. Two pickers for one printed decision, and the Feats tab printed the
 *                       answer twice — "Elemental Wrath (Fire) (Fire)". Audit named 2; there are 30.
 *   D  computable       A Yes/No picker asking something the app already knows ("do you already have
 *                       a base swim Speed"). Audit named 1; there are 3.
 *   E  sense spelling   Two spellings of one sense — `low-light vision` and `low-light-vision`.
 *                       `addSense` keys its Map by NAME, so a character holding both grants prints two
 *                       rows for one sense. Nobody had looked; there were two collisions.
 *
 * ⚠ ANCHORED ON THE OUTCOME, NOT THE CONDITION. A first draft of shape B matched the CONDITION
 * ("you can select this feat multiple times") and found 214 records, almost none of which have a
 * picker at all. The clause that matters is the one naming the ANSWER as the thing that must differ.
 *
 * Every count in this file is reproducible: `node scripts/scan-choice-sets.mjs`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));

/** Records with a `choice` / `effectChoices` live in these six collections; nothing else has one. */
export const CATS = ['feats', 'heritages', 'ancestries', 'classFeatures', 'backgrounds', 'items'];

const textOf = (cat, id) =>
  String(core[cat]?.[id]?.description ?? desc[cat]?.[id]?.d ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');

/* ─────────────────────────────────────────────────────────── A — "only at 1st level" */
const ORDINAL = { '1st': 1, first: 1, '2nd': 2, '3rd': 3 };
export const ONLY_AT_RE = /you can (?:select|take|choose) this feat only at (1st|first|2nd|3rd|[0-9]+th) level/i;

/*
 * ONE EXEMPTION, and it is a different defect rather than a false positive.
 *
 * `nocturnal-grippli` ships as category `general` while carrying the `grippli` ancestry trait (its own
 * `aon-` twin is category `ancestry`). General slots start at 3rd level, so `onlyAtLevel: 1` would make
 * it takeable in NO slot at all — strictly worse than the bug being fixed. Authoring it is blocked
 * until the category is corrected.
 */
export const ONLY_AT_EXEMPT = {
  'nocturnal-grippli': 'category is `general`, and general slots start at 3rd — an equality on 1 would make it unreachable. The real defect is the category.',
};

export function scanOnlyAtLevel() {
  const prints = [];
  for (const [id, f] of Object.entries(core.feats ?? {})) {
    const m = textOf('feats', id).match(ONLY_AT_RE);
    if (!m) continue;
    prints.push({ id, want: ORDINAL[m[1].toLowerCase()] ?? Number(String(m[1]).replace(/\D/g, '')), has: f.onlyAtLevel, category: f.category });
  }
  const exempt = prints.filter((r) => ONLY_AT_EXEMPT[r.id]);
  const live = prints.filter((r) => !ONLY_AT_EXEMPT[r.id]);
  return { prints, exempt, todo: live.filter((r) => r.has !== r.want), done: live.filter((r) => r.has === r.want) };
}

/* ────────────────────────────────────────── B — "a different <thing> each time"
 *
 * ⚠ BOTH WORD ORDERS. The first version required "each time" BEFORE "a different X" and matched 8
 * records on a rule that 47 print, because the text usually runs the other way round: "choosing a
 * different skill each time", "a different type of terrain each time", "selecting a different domain
 * each time", "gaining a different unarmed attack each time". `npm run scan:choices` printed "TO DO 0"
 * on a lane about 4% built, and a test asserted that zero — a false green, which is worse than no
 * measurement because it reads as coverage.
 *
 * This is the THIRD detector in this project to fail the same way: two others found 34 of 145 and 6 of
 * 40 by matching the CONDITION's phrasing rather than the outcome. Before trusting a count from any of
 * them, run it over records already known to print the rule and confirm it catches them. This union was
 * checked against automatic-knowledge, terrain-expertise, domain-initiate, major-lesson,
 * witchs-armaments and order-explorer, and loses none of the 8 the original caught. */
const DIFFERENT_AFTER = /a different ([a-z' -]{3,40}?)(?:\s+(?:each|every)\s+time|[^.]{0,40}?\s(?:each|every)\s+time)/i;
const DIFFERENT_BEFORE = /each time,? (?:you )?(?:choose|select|pick)(?:ing)? a different ([a-z' -]{3,40})/i;
const DIFFERENT_MUST = /(?:must|can'?t)[^.]{0,30}?(?:choose|select|pick)[^.]{0,20}?a different ([a-z' -]{3,40})/i;
export const DIFFERENT_RE = {
  test: (t) => DIFFERENT_AFTER.test(t) || DIFFERENT_BEFORE.test(t) || DIFFERENT_MUST.test(t),
  exec: (t) => DIFFERENT_AFTER.exec(t) ?? DIFFERENT_BEFORE.exec(t) ?? DIFFERENT_MUST.exec(t),
};

export function scanDistinctAcrossTakes() {
  const out = { todo: [], done: [], noPicker: [] };
  for (const [id, f] of Object.entries(core.feats ?? {})) {
    if (!DIFFERENT_RE.test(textOf('feats', id))) continue;
    const def = f.choice;
    // A greyed option needs an option LIST. `text` is the player typing (Kingdom skills), and a record
    // with no picker at all is a missing-picker defect, not this one.
    if (!def || !(def.kind === 'array' || def.kind === 'skills')) {
      out.noPicker.push({ id, kind: def?.kind ?? null });
      continue;
    }
    (def.distinctAcrossTakes ? out.done : out.todo).push({ id, kind: def.kind });
  }
  return out;
}

/* ─────────────────────── C — a `choice` and an `effectChoices` asking the same question */
const headWord = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0];

export function scanTwiceAsked() {
  const hits = [];
  for (const cat of CATS) {
    for (const [id, r] of Object.entries(core[cat] ?? {})) {
      const ch = r.choice;
      if (!ch?.options?.length || !(r.effectChoices ?? []).length) continue;
      const a = new Set(ch.options.map((o) => headWord(o.label ?? o.value)));
      for (const ec of r.effectChoices) {
        const b = new Set((ec.options ?? []).map((o) => headWord(o.label ?? o.value)));
        if (!b.size) continue;
        const shared = [...a].filter((h) => b.has(h)).length;
        // Both menus name the same THINGS. Compared on the first word of each option so a label that
        // spells the mechanics out ("Scent (imprecise) 30 feet") still matches the bare one ("Scent").
        const overlap = shared / Math.max(1, Math.min(a.size, b.size));
        if (overlap >= 0.5) hits.push({ cat, id, choiceId: ec.id, overlap });
      }
    }
  }
  return hits;
}

/* ───────────────────────────────── D — a Yes/No picker the app could answer for itself */
export function scanComputable() {
  const hits = [];
  for (const cat of CATS) {
    for (const [id, r] of Object.entries(core[cat] ?? {})) {
      const labels = (r.choice?.options ?? []).map((o) => String(o.label ?? '').trim().toLowerCase());
      if (labels.length === 2 && labels.includes('yes') && labels.includes('no')) hits.push({ cat, id });
    }
  }
  return hits;
}

/* ────────────────────────────────────────── E — two spellings of one sense name */
export const senseKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function scanSenseSpelling() {
  /** key -> Map(spelling -> [where]) */
  const byKey = new Map();
  const walk = (v, where) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return void v.forEach((x) => walk(x, where));
    if (Array.isArray(v.senses)) {
      for (const s of v.senses) {
        if (!s?.name) continue;
        const k = senseKey(s.name);
        const m = byKey.get(k) ?? new Map();
        m.set(s.name, [...(m.get(s.name) ?? []), where]);
        byKey.set(k, m);
      }
    }
    for (const x of Object.values(v)) walk(x, where);
  };
  for (const cat of Object.keys(core)) {
    const coll = core[cat];
    if (!coll || typeof coll !== 'object' || Array.isArray(coll)) continue;
    for (const [id, r] of Object.entries(coll)) walk(r, `${cat}/${id}`);
  }
  return [...byKey.entries()]
    .filter(([, m]) => m.size > 1)
    .map(([k, m]) => ({ key: k, spellings: [...m.entries()].map(([name, where]) => ({ name, where })) }));
}

/* ───────────────────────────────────────────────────────────────────────── report */
const LIST = process.argv.includes('--list');
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');
if (isDirectRun) {
  const a = scanOnlyAtLevel();
  console.log(`A  "only at 1st level"          printed ${a.prints.length}   authored ${a.done.length}   TO DO ${a.todo.length}   exempt ${a.exempt.length}`);
  for (const r of a.exempt) console.log(`     EXEMPT ${r.id} — ${ONLY_AT_EXEMPT[r.id]}`);
  if (LIST || a.todo.length) for (const r of a.todo) console.log(`     todo ${r.id} (wants ${r.want}, has ${r.has ?? 'nothing'})`);

  const b = scanDistinctAcrossTakes();
  console.log(`B  "each time, a different X"   printed ${b.todo.length + b.done.length + b.noPicker.length}   authored ${b.done.length}   TO DO ${b.todo.length}   no enumerable picker ${b.noPicker.length}`);
  if (LIST || b.todo.length) for (const r of b.todo) console.log(`     todo ${r.id} (${r.kind})`);
  if (LIST) for (const r of b.noPicker) console.log(`     no picker ${r.id} (${r.kind ?? 'none'})`);

  const c = scanTwiceAsked();
  console.log(`C  asked twice                  ${c.length} record/choice pairs still carry both menus`);
  if (LIST) for (const r of c) console.log(`     ${r.cat}/${r.id} :: ${r.choiceId} (${Math.round(r.overlap * 100)}%)`);

  const d = scanComputable();
  console.log(`D  Yes/No pickers               ${d.length}`);
  if (LIST || d.length) for (const r of d) console.log(`     ${r.cat}/${r.id}`);

  const e = scanSenseSpelling();
  console.log(`E  sense spelt two ways         ${e.length}`);
  for (const r of e) console.log(`     ${r.key}: ${r.spellings.map((s) => `"${s.name}" (${s.where.length})`).join('  vs  ')}`);

  if (!LIST) console.log('\n--list for every id. Apply with scripts/apply-builder-choice-sets.mjs.');
}
