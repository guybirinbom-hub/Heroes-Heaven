/**
 * WANDERER'S GUIDE, USED AS A DIFFER.
 *
 * Wanderer's Guide (GPL-3.0) encodes the same game we do, with a different vocabulary: 16 generic
 * operation verbs carrying a variable NAME in a string, against our ~190 named typed fields. Where
 * the two disagree about a feat, one of us is wrong, and that disagreement is a work list nobody had
 * to read 6,000 feats to produce.
 *
 * ⚠ THIS READS THEIR DATA. IT NEVER COPIES IT. Their encodings are their copyrighted work under
 * GPL-3.0 and this app ships proprietary; `work/wg/` is gitignored for that reason. The output here
 * is a list of RECORDS TO LOOK AT — the fix for each is then authored from the printed rules text,
 * which is Paizo's under the ORC licence and already our source.
 *
 * FOUR BUCKETS, and only the first two are work:
 *
 *   THEY-ONLY   they encode a mechanic on this feat and we encode nothing of that kind.
 *               The high-value bucket: a rule we silently do not apply.
 *   DISAGREE    we both encode the same kind of mechanic and the VALUES differ.
 *               Cheap to adjudicate — one line of printed text settles it.
 *   WE-ONLY     we encode something they do not. Expected to be large and mostly NOT a defect:
 *               759 of their 3,936 encoded feats (19.3%) fall back to prose, and their vocabulary
 *               has no degree-of-success operation at all, so 140 of our feats have no counterpart
 *               they could express. Reported, never actioned blindly.
 *   AGREE       both encode the same kind, values compatible. The denominator.
 *
 * ⚠ KIND, NOT VALUE, DECIDES THE BUCKET. A first draft compared raw JSON and called every feat a
 * disagreement, because `{"trainedSkill":"stealth"}` and `adjValue(SKILL_STEALTH,"T")` share no
 * bytes. The comparison has to happen in a shared vocabulary or it measures the vocabularies, not
 * the content. That vocabulary is KIND_OF below.
 *
 *   node scripts/wg-diff.mjs                 # the counts
 *   node scripts/wg-diff.mjs --bucket they-only --list
 *   node scripts/wg-diff.mjs --out work/wg-diff.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const DUMP = join(ROOT, 'work/wg/wg-data.sql');
if (!existsSync(DUMP)) {
  console.error(`No Wanderer's Guide dump at work/wg/wg-data.sql.\nIt is gitignored on purpose — see the header of this file.`);
  process.exit(2);
}

/* ---------------------------------------------------------------- their side */
/* The dump escapes TWICE: pg_dump writes a TSV (backslash -> \\), and inside that sits a Postgres
 * json[] literal {"<json>","<json>"} whose elements are double-quoted with \" inside. Undo the TSV
 * escape first; the array is then literally a JSON array once { } become [ ]. Two earlier parsers
 * that undid only one layer silently returned zero operations for every row. */
const sql = readFileSync(DUMP, 'utf8');
const head = /^COPY public\.ability_block \(([^)]*)\) FROM stdin;$/m.exec(sql);
const cols = head[1].split(',').map((s) => s.trim().replace(/"/g, ''));
const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
const bodyStart = head.index + head[0].length + 1;
const rows = sql.slice(bodyStart, sql.indexOf('\n\\.\n', bodyStart)).split('\n').filter(Boolean).map((l) => l.split('\t'));

const untsv = (s) => s.replace(/\\\\/g, '').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(//g, '\\');
function parseOps(raw) {
  if (!raw || raw === '\\N' || raw.length < 5) return [];
  const s = untsv(raw).trim();
  if (!s.startsWith('{')) return [];
  let arr;
  try { arr = JSON.parse('[' + s.slice(1, -1) + ']'); } catch { return []; }
  return arr.map((e) => { try { return typeof e === 'string' ? JSON.parse(e) : e; } catch { return null; } }).filter(Boolean);
}
/** Their operations nest — conditional carries true/false branches, select carries per-option ops. */
const flatten = (op, out = []) => {
  out.push(op);
  const d = op.data ?? {};
  for (const k of ['operations', 'trueOperations', 'falseOperations']) for (const c of d[k] ?? []) flatten(c, out);
  for (const o of d.optionsPredefined ?? []) for (const c of o.operations ?? []) flatten(c, out);
  return out;
};

/* ---------------------------------------------------------------- the shared vocabulary */
/**
 * KIND is the currency both sides are converted into. Deliberately COARSE: the question this script
 * answers is "does the other side model this KIND of thing at all", and a finer vocabulary would
 * report every difference of style as a difference of substance.
 */
const kindOfTheirOp = (op) => {
  const v = String(op.data?.variable ?? '');
  switch (op.type) {
    case 'adjValue':
    case 'setValue':
    case 'addBonusToValue': {
      if (/^SKILL_|^LORE_/.test(v)) return 'skill';
      if (/^SAVE_/.test(v)) return 'save';
      if (/^PERCEPTION/.test(v)) return 'perception';
      if (/^AC|ARMOR/.test(v)) return 'ac';
      if (/^SPEED/.test(v)) return 'speed';
      if (/^RESIST|^IMMUNITIES|^WEAKNESS/.test(v)) return 'defense';
      if (/^MAX_HEALTH|^HEALTH/.test(v)) return 'hp';
      if (/^SPELL_ATTACK|^SPELL_DC|^CASTING/.test(v)) return 'spellcasting';
      if (/^ATTRIBUTE_|^ATTR_/.test(v)) return 'attribute';
      if (/WEAPON|^ATTACK/.test(v)) return 'weapon';
      if (/^SENSE|VISION|DARKVISION/.test(v)) return 'sense';
      if (/^SIZE/.test(v)) return 'size';
      if (/^PRIMARY_SHEET_TABS|^PAGE_/.test(v)) return null; // pure UI plumbing, not a game rule
      return 'value';
    }
    case 'conditional': return 'conditional';
    case 'giveSpell': return 'spell';
    case 'giveSpellSlot': return 'spellSlot';
    case 'defineCastingSource': return 'spellcasting';
    case 'select': return 'choice';
    case 'giveAbilityBlock': return 'grantsRecord';
    case 'giveItem': return 'grantsItem';
    case 'giveTrait': return 'trait';
    case 'giveLanguage': return 'language';
    case 'createValue': return 'specialStat';
    case 'bindValue': return 'modifiesGrant';
    case 'injectText': return 'note';
    case 'injectSelectOption': return 'choice';
    default: return 'value';
  }
};

/** Our fields, in the same currency. A field may answer more than one kind (passiveEffects). */
const OUR_KINDS = {
  skill: ['trainedSkill', 'trainedSkillChoice', 'trainedLore', 'trainedLoreChoice', 'skillSubstitutions', 'passiveEffects.skills', 'passiveEffects.loreBonus'],
  save: ['passiveEffects.saves'],
  perception: ['passiveEffects.perception', 'perception'],
  ac: ['acBonus', 'passiveEffects.ac', 'armorAdjust', 'armorRestat'],
  speed: ['speeds', 'landSpeedBonus', 'landSpeedMin', 'speedPenalty', 'passiveEffects.speedBonus', 'passiveEffects.speedPenalty', 'speedsIf'],
  defense: ['resistances', 'immunities', 'passiveEffects.resistances', 'passiveEffects.immunities', 'passiveEffects.weaknesses', 'removesWeaknesses', 'choiceResistance', 'resistanceLevelUpgrade'],
  hp: ['maxHpBonus', 'hp', 'hpPerLevel'],
  spellcasting: ['spellcasting', 'proficiencies', 'focusPoolBonus'],
  attribute: ['abilityBoosts', 'abilityFlaws', 'apexAttribute'],
  weapon: ['grantedStrikes', 'critSpec', 'critSpecWeapons', 'weaponFamiliarity', 'strikeRiders', 'strikeReach', 'mapReduction', 'precisionDice'],
  sense: ['senses', 'vision', 'conditionalSenses', 'darkvisionIfAncestryLowLight', 'passiveEffects.senses'],
  size: ['size', 'sizeOverride'],
  spell: ['innateSpells', 'focusSpells', 'grantedRepertoire', 'heldSpells', 'grantsRituals', 'eidolonCantrips'],
  spellSlot: ['spellSlot'],
  choice: ['choice', 'effectChoices'],
  grantsRecord: ['grantsFeats', 'grantsClassFeatures', 'grantsActions', 'grantedFeatId', 'grantedFeatByChoice', 'grantsFeat'],
  grantsItem: ['grantsItems'],
  trait: ['grantsCreatureTraits', 'grantsCreatureTraitFromChoice'],
  language: ['languages', 'languageChoices', 'passiveEffects.grantsLanguages', 'languageChoicesAtRank', 'languageChoicesBonus'],
  specialStat: ['specialStatistic', 'passiveEffects.specialStatBonus'],
  modifiesGrant: ['modifiesGrant'],
  conditional: ['situational', 'modes', 'battleForm', 'enhancement', 'degreeShifts', 'conditionalSenses', 'speedsIf'],
  note: ['note', 'spellNotes'],
  /* Ours with no operation on their side at all — never counted as "they lack it", because a
   * vocabulary that cannot express something has not omitted it, it simply cannot say it. */
  _noCounterpart: ['degreeShifts', 'limitedUses', 'uses', 'companions', 'dailyChoice', 'temporaryProficiency', 'redundantFallback', 'actionCost'],
};
const fieldToKinds = new Map();
for (const [kind, fields] of Object.entries(OUR_KINDS)) {
  if (kind.startsWith('_')) continue;
  for (const f of fields) fieldToKinds.set(f, [...(fieldToKinds.get(f) ?? []), kind]);
}

/* ---------------------------------------------------------------- our side */
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * ⚠ A DATA FIELD IS NOT THE ONLY PLACE A MECHANIC LIVES.
 *
 * The first version of this script read top-level fields and `passiveEffects`, and nothing else. It
 * produced 1,329 "they model this and we do not" rows, and a 26-record sample put its precision at
 * 19.2% — 19 of 26 were mechanics we DO have, sitting in an id-keyed registry under src/rules/ where
 * no field on the record shows them.
 *
 * Officer's Education was the worked example: five things Wanderer's Guide encodes, four of them
 * already ours — three skill choices in FEAT_SKILL_GRANTS and a general-feat pick in
 * FEAT_PICK_GRANTS. Only the fifth, a language, was genuinely missing. A differ that reports all
 * five wastes four fifths of whoever works the list.
 *
 * So the registries are read as first-class carriers. They are TypeScript, not data, so they are
 * scanned as text for `'<feat-id>':` — deliberately crude, because the alternative is importing
 * src/rules into a plain .mjs script and the only question being asked is "is this id present".
 */
const REGISTRY_KINDS = [
  ['src/rules/featGrantsAuto.ts', ['skill', 'choice']],
  ['src/rules/featGrants.ts', ['skill', 'choice', 'grantsRecord']],
  ['src/rules/featPickGrants.ts', ['choice', 'grantsRecord']],
  ['src/rules/featFeatGrants.ts', ['grantsRecord', 'choice']],
  ['src/rules/situationalBonuses.ts', ['conditional']],
  ['src/rules/backgroundGrants.ts', ['choice', 'grantsRecord']],
  ['src/rules/modes.ts', ['conditional']],
  ['src/rules/domains.ts', ['spell']],
  ['src/rules/featUses.ts', ['value']],
];
const registryKindsById = new Map();
for (const [path, kinds] of REGISTRY_KINDS) {
  let text;
  try { text = readFileSync(join(ROOT, path), 'utf8'); } catch { continue; }
  /* Registry keys are quoted ids at the start of an entry: `'officers-education': {`. */
  for (const m of text.matchAll(/['"]([a-z0-9][a-z0-9-]{2,})['"]\s*:/g)) {
    const id = m[1];
    const prev = registryKindsById.get(id) ?? new Set();
    for (const k of kinds) prev.add(k);
    registryKindsById.set(id, prev);
  }
}

const ourKindsOf = (rec, id) => {
  const kinds = new Set();
  for (const k of Object.keys(rec)) {
    for (const kind of fieldToKinds.get(k) ?? []) kinds.add(kind);
    if (k === 'passiveEffects' && rec.passiveEffects && typeof rec.passiveEffects === 'object') {
      for (const sub of Object.keys(rec.passiveEffects)) {
        for (const kind of fieldToKinds.get(`passiveEffects.${sub}`) ?? []) kinds.add(kind);
      }
    }
  }
  for (const kind of registryKindsById.get(id) ?? []) kinds.add(kind);
  return kinds;
};

/* ---------------------------------------------------------------- match + bucket */
const theirs = new Map(); // normalised name -> {name, kinds:Set, ops:[], raw}
for (const r of rows) {
  if (r[ix.type] !== 'feat') continue;
  const name = r[ix.name];
  const ops = parseOps(r[ix.operations]).flatMap((o) => flatten(o));
  const kinds = new Set(ops.map(kindOfTheirOp).filter(Boolean));
  const key = norm(name);
  /* Their table holds several rows per name (versions, homebrew). Keep the richest. */
  const prev = theirs.get(key);
  if (!prev || ops.length > prev.ops.length) theirs.set(key, { name, kinds, ops, opCount: ops.length });
}

const out = { theyOnly: [], disagree: [], weOnly: [], agree: [], noMatch: [], theirsUnencoded: [] };
for (const [id, rec] of Object.entries(core.feats ?? {})) {
  if (!rec?.name) continue;
  const t = theirs.get(norm(rec.name));
  if (!t) { out.noMatch.push({ id, name: rec.name }); continue; }
  if (!t.opCount) { out.theirsUnencoded.push({ id, name: rec.name }); continue; }
  const ours = ourKindsOf(rec, id);
  const missing = [...t.kinds].filter((k) => !ours.has(k) && k !== 'note');
  const shared = [...t.kinds].filter((k) => ours.has(k));
  const extra = [...ours].filter((k) => !t.kinds.has(k));
  const row = { id, name: rec.name, level: rec.level, theirKinds: [...t.kinds], ourKinds: [...ours], missing, extra, theirOps: t.opCount };
  if (missing.length) out.theyOnly.push(row);
  else if (extra.length) out.weOnly.push(row);
  else out.agree.push(row);
}

/* Where BOTH sides model the same kind, the values still have to be compared — but that needs the
 * printed text to adjudicate, so it is a separate, judged pass. Flag the candidates here. */
out.disagree = out.agree.concat(out.weOnly).filter((r) => r.theirKinds.some((k) => ['skill', 'save', 'ac', 'hp', 'speed', 'defense', 'attribute'].includes(k)));

/* ---------------------------------------------------------------- report */
const dest = arg('--out', null);
if (dest) { writeFileSync(join(ROOT, dest), JSON.stringify(out, null, 1)); console.log(`-> ${dest}`); }

const matched = out.theyOnly.length + out.weOnly.length + out.agree.length;
console.log(`our feats: ${Object.keys(core.feats ?? {}).length}    theirs (encoded): ${[...theirs.values()].filter((t) => t.opCount).length}\n`);
console.log(`  matched by name, both encode something : ${matched}`);
console.log(`     ${String(out.theyOnly.length).padStart(5)}  THEY-ONLY   they model a kind we do not   <- the work list`);
console.log(`     ${String(out.weOnly.length).padStart(5)}  WE-ONLY     we model a kind they do not`);
console.log(`     ${String(out.agree.length).padStart(5)}  AGREE       same kinds on both sides`);
console.log(`  ${String(out.theirsUnencoded.length).padStart(5)}  they have the feat, encode NOTHING`);
console.log(`  ${String(out.noMatch.length).padStart(5)}  we have the feat, they do not\n`);
console.log(`  ${String(out.disagree.length).padStart(5)}  numeric kinds present on BOTH sides — values need adjudicating against the book`);

const byKind = {};
for (const r of out.theyOnly) for (const k of r.missing) byKind[k] = (byKind[k] ?? 0) + 1;
console.log(`\nTHEY-ONLY, by the kind we are missing:`);
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);

if (has('--list')) {
  const b = arg('--bucket', 'they-only');
  const list = { 'they-only': out.theyOnly, 'we-only': out.weOnly, agree: out.agree, disagree: out.disagree, nomatch: out.noMatch }[b] ?? [];
  console.log(`\n--- ${b} (${list.length}) ---`);
  for (const r of list.slice(0, 400)) console.log(`  ${r.id.padEnd(42)} lvl ${String(r.level ?? '?').padStart(2)}  missing=[${(r.missing ?? []).join(',')}]  ours=[${(r.ourKinds ?? []).join(',')}]`);
}
