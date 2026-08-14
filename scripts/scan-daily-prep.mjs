/*
 * `npm run scan:daily` — the DAILY-PREPARATIONS lane, measured over the whole corpus.
 *
 * Two shapes, both anchored on the record's own printed OUTCOME rather than on the condition it
 * states. That distinction is the whole point: a detector matching "during your daily preparations"
 * alone reports 220 records, most of them spell preparation, alchemy or snare crafting — subsystems
 * with lanes of their own. Matching the GRANT the sentence makes reports 8, and all 8 are real.
 *
 *   SHAPE A — a temporary proficiency or language granted at daily preparations, with no choice the
 *             Rest sheet can render. Ruling Q23: the pick belongs to Daily preparations. A
 *             `kind: 'skills'` / `'domains'` menu resolves against the BUILD, so `askedAtDailyPrep`
 *             refuses it and the question falls back to the builder — where `'skills'` offers the
 *             skills you are ALREADY trained in (`trainedSkillOptions`, build.ts), i.e. every option
 *             is a wasted grant and the untrained skills the feat exists to help are unpickable.
 *
 *   SHAPE B — the same proficiency granted BOTH permanently in the build and again every morning.
 *             A contradiction, not a duplicate: every record in this shape prints "you can't use it
 *             as a prerequisite for a skill increase or a permanent character option", and the build
 *             store is exactly what `checkPrerequisites` reads. It is also SILENT — an unanswered
 *             `skillChoices` slot defaults to its first option (build.ts), so the character ends up
 *             trained in something nobody picked.
 *
 * SHAPE B must stay at ZERO. SHAPE A's TODO count may only go DOWN. Both are pinned by
 * test/daily-preparations-lane.test.ts, which also feeds the detectors a synthetic pre-fix fixture
 * to prove they still fire — a scanner nobody has seen report a defect is not evidence of anything.
 *
 * Run: node scripts/scan-daily-prep.mjs [--json]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** core.json with the descriptions merged back in — any check on a record's TEXT needs both files. */
export function loadCore(root = ROOT) {
  const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
  const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));
  for (const [bucket, records] of Object.entries(desc)) {
    const t = core[bucket];
    if (!t) continue;
    for (const [id, v] of Object.entries(records)) if (t[id] && v.d !== undefined) t[id].description = v.d;
  }
  return core;
}

/** The two grant registries, as text. Parsed rather than imported so this stays a one-command check. */
export function loadRegistry(root = ROOT) {
  return (
    readFileSync(join(root, 'src/rules/featGrantsAuto.ts'), 'utf8') +
    readFileSync(join(root, 'src/rules/featGrants.ts'), 'utf8')
  );
}

const BUCKETS = ['feats', 'classFeatures', 'items', 'ancestries', 'heritages', 'backgrounds'];
const plain = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const ASKABLE = new Set(['array', 'text', 'open']);

const DAILY = /(during|when you make|as part of) your daily preparations|until you (?:next )?prepare again/i;
const TEMP_GRANT =
  /(gain the (?:trained|expert|master) proficiency rank in one skill|become trained in one skill|become an? (?:expert|master) in one skill|become fluent in one .{0,40}language|gain the .{0,20}proficiency rank in one .{0,20}of your choice)/i;

/*
 * EXEMPT rows carry the reason they are not this lane's problem. A scanner with no exemption list
 * either grows false positives until nobody reads it, or gets quietly narrowed until it finds
 * nothing — both have happened in this repo.
 */
export const EXEMPT = {
  'feats/arcane-evolution':
    'matched on its FIRST sentence — "You become trained in one skill of your choice" — a PERMANENT build grant, not the daily half. Its daily clause is the signature-spell lane, which is built. (Its `kind:\'skills\'` list is inverted for a "become trained" grant, but that is a BUILD-time picker and belongs to the builder-choice-sets cluster.)',
};

/** SHAPE A over a merged core. */
export function scanShapeA(core) {
  const out = [];
  for (const b of BUCKETS)
    for (const [id, rec] of Object.entries(core[b] ?? {})) {
      const text = plain(rec?.description);
      if (!DAILY.test(text) || !TEMP_GRANT.test(text)) continue;
      const key = `${b}/${id}`;
      const def = rec.choice;
      out.push({
        key,
        name: rec.name,
        ok: !!def?.daily && ASKABLE.has(def.kind),
        exempt: EXEMPT[key] ?? null,
        kind: def?.kind ?? null,
        daily: !!def?.daily,
      });
    }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** SHAPE B over a merged core + the registry source text. */
export function scanShapeB(core, registry) {
  const granted = new Set([...registry.matchAll(/^ {2}'([a-z0-9-]+)':\s*\{/gm)].map((m) => m[1]));
  const out = [];
  for (const [id, rec] of Object.entries(core.feats ?? {})) {
    if (!granted.has(id)) continue;
    const def = rec?.choice;
    if (!def?.daily) continue;
    // Does the MORNING's answer move a skill rank? The build-time skills menu, an option that grants
    // one, or a prompt that says so.
    const dailySkill =
      def.kind === 'skills' || (def.options ?? []).some((o) => o.grant?.skills) || /skill/i.test(String(def.prompt ?? ''));
    if (!dailySkill) continue;
    // …and does the BUILD grant one too?
    const entry = new RegExp(`^ {2}'${id}':\\s*\\{(.*)$`, 'm').exec(registry)?.[1] ?? '';
    if (!/skills:|skillChoices:|loreChoices:/.test(entry)) continue;
    out.push({ id, name: rec.name, entry: entry.trim().slice(0, 100) });
  }
  return out;
}

export function scan(root = ROOT) {
  const core = loadCore(root);
  const shapeA = scanShapeA(core);
  return { shapeA, shapeB: scanShapeB(core, loadRegistry(root)), todo: shapeA.filter((r) => !r.ok && !r.exempt) };
}

const RUN_DIRECTLY =
  !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (RUN_DIRECTLY) {
  const { shapeA, shapeB, todo } = scan();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ shapeA, shapeB, todo: todo.length }, null, 1));
  } else {
    console.log('SHAPE A — a temporary proficiency/language at daily preparations');
    for (const r of shapeA) {
      console.log(`  ${r.ok ? 'OK    ' : r.exempt ? 'EXEMPT' : 'TODO  '} ${r.key.padEnd(42)} ${r.name}${r.ok ? ` (${r.kind}, daily)` : ''}`);
      if (r.exempt) console.log(`         ↳ ${r.exempt}`);
    }
    console.log(`  ${shapeA.length} matched · ${shapeA.filter((r) => r.ok).length} OK · ${shapeA.filter((r) => r.exempt).length} exempt · ${todo.length} TODO`);
    console.log('\nSHAPE B — granted BOTH permanently in the build and again every morning');
    for (const r of shapeB) console.log(`  DEFECT ${r.id.padEnd(30)} ${r.name}  ←  ${r.entry}`);
    console.log(`  ${shapeB.length} defect(s) — must be 0`);
  }
  process.exitCode = shapeB.length || todo.length ? 1 : 0;
}
