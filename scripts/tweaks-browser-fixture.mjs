/*
 * TWEAKS PART B — the browser test's old character (plan WP0 step 6, section 9).
 *
 * WHY. The browser test opens an OLD character (one saved before Tweaks existed, every change in the
 * old Overrides keys) in the real app, and must show that opening it moves no number except the ones
 * part B allows (cases A, B, C and the Lore-row move). That needs the character as a file the app can
 * import, and its numbers as THIS engine shows them, taken before any part B code exists.
 *
 * WHAT IT WRITES (both synthetic; never a real player's character):
 *   work/tweaks-part-b-notes/browser/old-overrides.codex.json — a native export (src/data/transfer.ts
 *     exportNative, the format the roster's "Import" reads) of a fighter L7 built with the OLD keys only:
 *     Thievery 'trained' plus a level-5 skill increase on Thievery (case A), Fortitude and Perception
 *     'trained' (below the class rank), a `lore:Sailing Lore` entry (the Lore-row move), Strength 18,
 *     max HP 120 (case C), Toughness given at level 3, Draconic, a ritual (Consecrate), one "take anyway"
 *     feat (Fleet) and a content edit on Toughness's description.
 *   work/tweaks-part-b-notes/browser/expected-before.json — its sheet numbers at this engine, gate on
 *     (the app's default), read through scripts/blocks-parity-snapshot.mjs's pipeline (the same
 *     functions the sheet, the tracker row and the party card use), plus every breakdown's total.
 *
 * Run (jiti, NOT node: the engine is .ts):  npx jiti scripts/tweaks-browser-fixture.mjs [--out-dir <dir>]
 * Takes the heavy-job lock (scripts/lib/heavy-lock.mjs), like every run that builds characters.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHeavyLock } from './lib/heavy-lock.mjs';
import { loadEngine, snapOne } from './blocks-parity-snapshot.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const outDir = (() => {
  const i = argv.indexOf('--out-dir');
  return i >= 0 ? argv[i + 1] : 'work/tweaks-part-b-notes/browser';
})();

const code = await withHeavyLock('tweaks-browser-fixture', async () => {
  /* This file is the jiti entry, so ITS import() goes through jiti (an imported .mjs is loaded natively
   * and its own import() could not load .ts): the engine modules are loaded from here. */
  const importer = (p) => import(join(ROOT, p));
  const E = await loadEngine(importer);
  const { exportNative } = await importer('src/data/transfer.ts');

  const db = E.DB.on;
  const base = E.fill(E.mk('fighter', 7));
  const build = {
    ...base,
    name: 'Tweaks Fixture Fighter',
    skillIncreases: { 3: 'athletics', 5: 'thievery', 7: 'stealth' },
    overrides: {
      proficiencies: { thievery: 'trained', fortitude: 'trained', perception: 'trained', 'lore:Sailing Lore': 'trained' },
      attributes: { str: 18 },
      maxHp: 120,
      addedFeats: [{ featId: 'toughness', level: 3, category: 'general' }],
      addedLanguages: ['draconic'],
      addedSpells: [{ spellId: 'consecrate', rank: 2 }],
      allowedFeats: ['fleet'],
      contentEdits: { feats: { toughness: { description: '<p>TEST: Toughness text edited through the old Overrides card.</p>' } } },
    },
  };
  for (const id of ['toughness', 'fleet']) if (!db.feats[id]) throw new Error(`fixture feat ${id} is not in the gate-on database`);
  if (!db.spells.consecrate?.ritual) throw new Error('fixture ritual consecrate is missing or no longer a ritual');

  E.setGate('on');
  let character;
  let play;
  try {
    character = E.buildCharacter(build, db);
    play = E.initialPlay(character, db);
  } finally {
    E.clearTrustGate();
  }
  const saved = { id: 'tweaks-fixture-fighter', character, build, play };
  const row = await snapOne({ id: 'tweaks-fixture-fighter', build }, 'on');
  if (row.buildError || row.playError) throw new Error(`the fixture character does not build: ${row.buildError ?? row.playError}`);

  const engineCommit = (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  })();
  const dir = join(ROOT, outDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'old-overrides.codex.json'), exportNative(saved) + '\n');
  writeFileSync(
    join(dir, 'expected-before.json'),
    JSON.stringify(
      {
        what: 'Sheet numbers of old-overrides.codex.json at the part-A engine, trust gate on (the app default), read through scripts/blocks-parity-snapshot.mjs. Part B may move only cases A, B, C and the Lore-row move (plan section 3.6).',
        engineCommit,
        takenAt: new Date().toISOString(),
        gate: 'on',
        numbers: row.numbers,
        breakdownTotals: Object.fromEntries(Object.entries(row.breakdowns).map(([k, b]) => [k, b.t])),
      },
      null,
      1,
    ) + '\n',
  );
  console.log(`wrote ${outDir}/old-overrides.codex.json and expected-before.json (${Object.keys(row.numbers).length} numbers) at ${engineCommit}`);
  for (const k of ['skill.thievery.rank', 'save.fortitude.rank', 'perception.rank', 'skill.lore:Sailing Lore.rank', 'ability.str.score', 'hp.max', 'ac']) console.log(`  ${k} = ${row.numbers[k]}`);
  return 0;
});
process.exit(code);
