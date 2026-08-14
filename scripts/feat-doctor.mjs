/*
 * FEAT DOCTOR — everything you need to know about one record, in one command.
 *
 *   npm run feat -- oath-of-the-veiled-one
 *   npm run feat -- feats/adopted-ancestry --json
 *   npm run feat -- heritages/swimming-animal
 *
 * WHY THIS EXISTS. Six thousand feats are being audited a hundred at a time, and every fix used to
 * begin with the same four questions, each answered by hand:
 *
 *   1. What does the record actually SAY?            → the description lives in a second file now
 *   2. What does the app DO with it?                 → a batch harness, minutes, or a guess
 *   3. WHICH OF 92 AUTHORING SCRIPTS owns it?        → grep, and hope
 *   4. Does anything READ the fields it carries?     → nothing checked, and we shipped write-only
 *                                                      fields more than once
 *
 * Getting (3) wrong is the expensive one. Several scripts rebuild their records WHOLE on every run —
 * `apply-battle-forms.mjs` does it to all 16 battle-form modes, and `src/rules/situationalBonuses.ts`
 * is GENERATED outright by `apply-situational-lane.mjs` — so a value written in the wrong place is
 * deleted, silently, the next time somebody runs the owner. That has already cost this project a
 * shipped defect and very nearly cost it two more.
 *
 * So: this prints the printed text, the authored fields, the OWNER of each one, whether each has a
 * reader in src/, what the sheet does with the feat, and what the builder asks. Read-only. Seconds.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const JSON_OUT = process.argv.includes('--json');
const NO_EVIDENCE = process.argv.includes('--no-evidence');

if (!argv.length) {
  console.log('usage: npm run feat -- <id>            e.g. adopted-ancestry');
  console.log('       npm run feat -- <category>/<id> e.g. heritages/swimming-animal');
  console.log('       --json          machine-readable');
  console.log('       --no-evidence   skip the two harnesses (much faster, data only)');
  process.exit(1);
}

const core = JSON.parse(read('public/core.json'));
const descDb = JSON.parse(read('public/core-descriptions.json'));

/* ── locate the record ──────────────────────────────────────────────────────────────────────────
 * A bare id is looked up across every collection, because "adopted-ancestry" is how a person refers
 * to it and remembering that it lives in `feats` is not part of the question being asked. */
const SEARCH_ORDER = ['feats', 'classFeatures', 'heritages', 'items', 'ancestries', 'backgrounds', 'classes', 'spells', 'actions', 'modes', 'stances', 'deities'];
const [rawCat, rawId] = argv[0].includes('/') ? argv[0].split('/') : [null, argv[0]];
const id = rawId;
let category = rawCat;
if (!category) {
  category = SEARCH_ORDER.find((c) => core[c]?.[id]);
  if (!category) {
    const near = SEARCH_ORDER.flatMap((c) => Object.keys(core[c] ?? {}).filter((k) => k.includes(id)).slice(0, 4).map((k) => `${c}/${k}`));
    console.log(`no record "${id}" in any collection.`);
    if (near.length) console.log('did you mean:\n  ' + near.slice(0, 10).join('\n  '));
    process.exit(1);
  }
}
const rec = core[category]?.[id];
if (!rec) { console.log(`no ${category}/${id}`); process.exit(1); }

const printed = String(rec.description ?? descDb[category]?.[id]?.d ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/* ── who owns each field ────────────────────────────────────────────────────────────────────────
 * Scanned rather than declared: an authoring script names the ids it writes, so the ids are the index.
 * WHOLE_REWRITERS is the list that matters — those scripts rebuild the record object outright, so a
 * field added anywhere else is gone at their next run. It is short and it is checked, not assumed. */
const SCRIPT_DIR = join(root, 'scripts');
const scripts = readdirSync(SCRIPT_DIR).filter((f) => f.endsWith('.mjs') && f !== 'feat-doctor.mjs');
const WHOLE_REWRITERS = {
  'apply-battle-forms.mjs': 'rebuilds every battle-form mode object whole (`core.modes[id] = {…, ...def}`)',
  'apply-situational-lane.mjs': 'GENERATES src/rules/situationalBonuses.ts outright — hand edits are overwritten',
};
const owners = [];
for (const f of scripts) {
  let body;
  try { body = readFileSync(join(SCRIPT_DIR, f), 'utf8'); } catch { continue; }
  if (!body.includes(`'${id}'`) && !body.includes(`"${id}"`) && !body.includes(`${category}/${id}`)) continue;
  owners.push({ script: `scripts/${f}`, rewritesWhole: WHOLE_REWRITERS[f] ?? null });
}

const overlay = JSON.parse(read('scripts/data/effect-backfill.json')).filter((r) => r.id === id && r.category === category);

/* ── does anything READ each authored field? ────────────────────────────────────────────────────
 * The cheapest possible check and it would have caught real defects: a field name that appears
 * nowhere under src/ cannot reach a pixel, whatever the data says. */
const srcText = (() => {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(join(root, 'src'));
  return out.join('\n');
})();
const SKIP_FIELDS = new Set(['id', 'name', 'description', 'descRefs', 'traits', 'level', 'category', 'source', 'aonId', 'aonOrigin', 'rarity', 'edition', 'prerequisites', 'access']);
const fields = Object.keys(rec).filter((k) => !SKIP_FIELDS.has(k));
const fieldReaders = fields.map((f) => ({ field: f, read: srcText.includes(f) }));

/* ── what the app actually does ─────────────────────────────────────────────────────────────────
 * Observed, never inferred from which fields the record carries. A lane can be satisfied in six
 * different places, so any check that reads the representation has to know all six and lies when it
 * doesn't; watching the outcome needs to know none of them. */
const runHarness = (script, out) => {
  if (NO_EVIDENCE || category !== 'feats') return null;
  try {
    // npx is a .cmd on Windows; naming it directly avoids `shell: true` and its escaping warning.
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    execFileSync(npx, ['jiti', `scripts/${script}`, '--only', id, '--out', out], { cwd: root, stdio: 'pipe' });
    return JSON.parse(read(out));
  } catch (e) {
    return { error: String(e.stderr ?? e.message ?? e).split('\n').slice(0, 3).join(' ') };
  }
};
const sheet = runHarness('feat-evidence.mjs', 'scripts/audit/feat-only-evidence.json');
const builder = runHarness('builder-evidence.mjs', 'scripts/audit/builder-only-evidence.json');
const sheetPack = Array.isArray(sheet) ? sheet[0] : null;
const builderPack = builder?.packs?.[0] ?? null;

if (JSON_OUT) {
  console.log(JSON.stringify({ category, id, printed, fields: fieldReaders, owners, overlay, sheet: sheetPack, builder: builderPack }, null, 1));
  process.exit(0);
}

/* ── report ─────────────────────────────────────────────────────────────────────────────────── */
const H = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const warn = (s) => console.log(`  \x1b[33m⚠ ${s}\x1b[0m`);
const ok = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const bad = (s) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);

console.log(`\n\x1b[1m${rec.name ?? id}\x1b[0m  —  ${category}/${id}${rec.level != null ? `, level ${rec.level}` : ''}`);
if (rec.traits?.length) console.log(`\x1b[2m${rec.traits.join(' · ')}\x1b[0m`);

H('PRINTED TEXT');
console.log(printed ? '  ' + printed.replace(/(.{1,110})(\s|$)/g, '$1\n  ').trim() : '  (none — check core-descriptions.json)');

H('AUTHORED FIELDS');
if (!fields.length) console.log('  (none — this record carries no mechanics at all)');
for (const { field, read: isRead } of fieldReaders) {
  const v = JSON.stringify(rec[field]);
  const shown = v && v.length > 90 ? v.slice(0, 90) + '…' : v;
  if (isRead) ok(`${field.padEnd(24)} ${shown}`);
  else bad(`${field.padEnd(24)} ${shown}   ← NOTHING IN src/ MENTIONS THIS FIELD`);
}

H('WHO OWNS IT');
if (!owners.length) {
  warn('no authoring script names this record.');
  console.log('     Its overlay rows are orphans: nothing regenerates them and nothing documents why');
  console.log('     they hold the value they do. Put new values in the script that owns the LANE.');
} else {
  for (const o of owners) {
    if (o.rewritesWhole) warn(`${o.script}\n     REWRITES THE RECORD WHOLE — ${o.rewritesWhole}.\n     Any field authored elsewhere is deleted at its next run.`);
    else ok(o.script);
  }
}
if (overlay.length) {
  console.log(`\n  overlay rows (survive \`npm run data\`): ${overlay.map((r) => r.field + (r.value === null ? ' = null (deletes)' : '')).join(', ')}`);
} else {
  console.log('\n  \x1b[2mno overlay rows — anything authored here dies at the next `npm run data`\x1b[0m');
}

if (sheetPack) {
  H('WHAT THE SHEET DOES  (built with the feat vs without)');
  const diff = sheetPack.sheetDiff ?? {};
  const keys = Object.keys(diff);
  if (!keys.length) bad('NOTHING CHANGES. Taking this feat moves no derived value on the sheet.');
  else for (const k of keys) ok(`${k}: ${JSON.stringify(diff[k]).slice(0, 100)}`);
  if (sheetPack.actions?.length) ok(`actions list: ${sheetPack.actions.map((a) => a.name ?? a).join(', ')}`);
  if (sheetPack.harnessLimits?.length) warn(`harness limits: ${sheetPack.harnessLimits.join(', ')} — an absence of evidence, not evidence of absence`);
} else if (!NO_EVIDENCE && category === 'feats') {
  warn('sheet harness produced nothing' + (sheet?.error ? `: ${sheet.error}` : ''));
}

if (builderPack) {
  H('WHAT THE BUILDER ASKS');
  const ch = builderPack.presentsChoices ?? [];
  if (!ch.length) console.log('  (no picker — correct if the feat asks the player nothing)');
  for (const c of ch) console.log(`  · ${c.lane}: ${c.prompt ?? c.flag ?? '(unnamed)'} — ${c.optionCount ?? c.options?.length ?? '?'} options`);
  const nameOf = (a) => a.flag ?? a.choiceId ?? a.id ?? a.prompt ?? a.lane ?? '(unnamed picker)';
  for (const a of builderPack.answerIsRead ?? []) {
    if (a.verdict === 'read') ok(`the answer to "${nameOf(a)}" moves something`);
    else bad(`"${nameOf(a)}" → ${a.verdict} — the app asks and then does nothing with it`);
  }
  for (const [k, v] of Object.entries(builderPack.checks ?? {})) if (v?.length) warn(`${k}: ${JSON.stringify(v).slice(0, 120)}`);
}

H('NEXT');
console.log('  full audit evidence for a batch:  npm run evidence');
console.log('  the lane vocabulary:              docs/mechanic-lanes.md');
console.log('  the owner’s rulings:              docs/gold-set-answers.md');
console.log('');
