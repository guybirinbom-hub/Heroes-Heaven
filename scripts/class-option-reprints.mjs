// Prints the class sub-picks' newer printings derived from the AoN mirror (scripts/lib/class-option-reprints.mjs)
// and checks them against CLASS_OPTION_REPRINTS in src/rules/sources.ts. Read-only.
//   npx jiti scripts/class-option-reprints.mjs          → the derived table, then OK / the difference
// Exit 1 when the table and the mirror disagree, or a reprint's book resolves to no Sources card key.
import { readFileSync, existsSync } from 'node:fs';
import { deriveClassOptionReprints, MIRROR_CATEGORIES } from './lib/class-option-reprints.mjs';
import { CLASS_OPTION_REPRINTS, sourceCatalog } from '../src/rules/sources.ts';

if (!existsSync(MIRROR_CATEGORIES)) {
  console.error(`class-option-reprints: the AoN mirror is not at ${MIRROR_CATEGORIES}`);
  process.exit(1);
}
const core = JSON.parse(readFileSync(new URL('../public/core.json', import.meta.url), 'utf8'));
const { table, unresolved, noOwnPage } = deriveClassOptionReprints(core, sourceCatalog(core).allBooks);
for (const [id, list] of Object.entries(table)) console.log(`${id}: ${list.map((p) => `${p.aonId} (${p.book})`).join('; ')}`);
console.log(`derived ${Object.keys(table).length} options with a later printing; ${noOwnPage.length} options with no own page in their category`);
let bad = false;
if (unresolved.length) {
  bad = true;
  console.error(`unresolved books:\n  ${unresolved.join('\n  ')}`);
}
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
if (JSON.stringify(sortObj(table)) !== JSON.stringify(sortObj(CLASS_OPTION_REPRINTS))) {
  bad = true;
  console.error('CLASS_OPTION_REPRINTS (src/rules/sources.ts) differs from the mirror:');
  console.error('  mirror:', JSON.stringify(sortObj(table)));
  console.error('  table: ', JSON.stringify(sortObj(CLASS_OPTION_REPRINTS)));
}
console.log(bad ? 'class-option-reprints: FAIL' : 'class-option-reprints: ok');
process.exit(bad ? 1 : 0);
