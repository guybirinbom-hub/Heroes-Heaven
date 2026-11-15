/*
 * Writes the SYNTHESIZED test character the UI checks seed into the roster (e2e/visual/fixtures/roster.json).
 *
 *   npx jiti e2e/visual/make-fixture.ts
 *
 * Built with the app's own buildCharacter() over the real game data (test/_content.ts content()), and the
 * builder state is stored beside it, so the sheet renders a structurally valid, editable character. It is
 * made up: never replace it with a real player's save. Re-run it only on purpose (a data change that breaks
 * the stored shape) — a new fixture moves every baseline picture, so the screenshot baselines must be
 * re-taken and looked at afterwards (docs/ui-tests.md).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { content } from '../../test/_content';
import { buildCharacter, emptyBuild, type BuildState } from '../../src/rules/build';

const db = content();
const state: BuildState = {
  ...emptyBuild(),
  name: 'Test Fighter',
  level: 3,
  classId: 'fighter',
  ancestryId: 'human',
  backgroundId: 'farmhand',
};
const character = buildCharacter(state, db);
const roster = [{ id: 'c-uitest-fighter', character, build: state }];
// Resolved from this file's own folder, so it lands in e2e/visual/fixtures whatever the current folder is.
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'fixtures');
const OUT = join(OUT_DIR, 'roster.json');
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(roster) + '\n');
console.log(`wrote ${relative(process.cwd(), OUT)} — ${character.name}, level ${character.level}, ${JSON.stringify(roster).length} bytes`);
