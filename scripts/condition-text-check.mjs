/*
 * EVERY CONDITION SHIPS ITS FULL PRINTED TEXT — in BOTH apps.
 *
 * Owner, 2026-09-15: "the descriptions are shortened versions I don't like; I want the full Archives
 * description so I know exactly what it does."
 *
 * Heroes Heaven's condition prose came from the FOUNDRY reference, not from the Archives: conditions
 * are an OVERLAID bucket in import-core-v2.mjs, and `overlayContent` adopts facets and the name but
 * never the description, so every one of the 57 records kept its Foundry text through every regen.
 * Foundry's text is an abridgement — it drops the Archives sidebars whole (`Persistent Damage` shipped
 * 596 characters of a 3,430-character entry, losing the entire "Persistent Damage Rules" aside) and it
 * lost its inline `@Check[flat|dc:15]` to the same cleaner class as the 1,206 records in
 * project_hh_dropped_inline_values, leaving "roll a to see if you recover". `sickened` shipped EMPTY.
 *
 * The tracker's public/data/conditions.json was already the full text; this guard keeps it that way,
 * because nothing else does — no script in this repo writes that file.
 *
 * TWO TESTS PER RECORD, not one:
 *   • the DISTINCTIVE SENTENCE (the entry's last sentence) is present — every shortening measured in
 *     this data cut from the end, and a length ratio alone passes a record that lost its final clause
 *     and gained a longer preamble.
 *   • length is at least 90% of the printed body — catches a middle paragraph going missing, which
 *     the sentence test cannot see.
 *
 * Both transforms come from scripts/lib/condition-prose.mjs, the same module the writer uses. See its
 * header for why that is not optional.
 *
 *   node scripts/condition-text-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conditionProse, compareForm, distinctiveSentence, openMirror } from './lib/condition-prose.mjs';

const ROOT = process.env.HH_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = process.env.HH_CORE || join(ROOT, 'public/core.json');
const DESCS = process.env.HH_DESCS || join(ROOT, 'public/core-descriptions.json');
const TRACKER = process.env.HH_TRACKER_CONDITIONS || join(ROOT, 'public/data/conditions.json');

const MIN_RATIO = 0.9;
const mirror = openMirror();

/** One record against its printed entry. Returns a failure reason, or null when it is complete. */
function judge(stored, markdown) {
  const body = conditionProse(markdown);
  const want = compareForm(body);
  const got = compareForm(stored);
  if (!got) return { why: 'EMPTY', got: 0, want: want.length };
  if (!got.includes(distinctiveSentence(body))) return { why: 'missing the last printed sentence', got: got.length, want: want.length };
  if (got.length < want.length * MIN_RATIO) return { why: 'shorter than the printed entry', got: got.length, want: want.length };
  return null;
}

const bad = [];
const unresolved = [];

// ── Heroes Heaven: the `conditions` bucket of core.json + its prose in core-descriptions.json ──
const core = JSON.parse(readFileSync(CORE, 'utf8')).conditions ?? {};
const descs = JSON.parse(readFileSync(DESCS, 'utf8')).conditions ?? {};
for (const [id, rec] of Object.entries(core)) {
  const md = mirror.markdownForRecord(rec);
  if (!md) { unresolved.push(`HH       ${id} (aonId ${rec.aonId ?? 'none'})`); continue; }
  const entry = descs[id];
  const fail = judge(typeof entry === 'string' ? entry : entry?.d, md);
  if (fail) bad.push({ app: 'HH', id, ...fail });
}

// ── The tracker: public/data/conditions.json, the file dataStore.loadConditions reads ──
const tracker = JSON.parse(readFileSync(TRACKER, 'utf8')).condition ?? [];
for (const rec of tracker) {
  const hit = mirror.byName.get(String(rec.name ?? '').trim().toLowerCase());
  if (!hit) { unresolved.push(`tracker  ${rec.name}`); continue; }
  // Same preference dataStore.loadConditions applies: the link-preserving `text`, else the entries.
  const stored = rec.text ?? (rec.entries ?? []).filter((e) => typeof e === 'string').join('\n');
  const fail = judge(stored, hit.markdown);
  if (fail) bad.push({ app: 'tracker', id: `${rec.name} [${rec.source ?? '?'}]`, ...fail });
}

console.log(`condition text: ${Object.keys(core).length} Heroes Heaven + ${tracker.length} tracker records checked against the Archives mirror`);
for (const u of unresolved) console.log(`  no mirror document — skipped: ${u}`);

if (!bad.length) { console.log('OK — every condition carries its full printed description.'); process.exit(0); }

console.error(`\n${bad.length} condition(s) ship a SHORTENED description:\n`);
for (const b of bad) console.error(`  ${b.app.padEnd(8)} ${String(b.id).padEnd(34)} ${String(b.got).padStart(5)} of ${String(b.want).padEnd(6)} chars — ${b.why}`);
console.error('\nRepair: node scripts/backfill-condition-prose.mjs --write   (then re-run this check)');
process.exit(1);
