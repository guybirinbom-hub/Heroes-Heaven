/*
 * Seven backgrounds trained you in a Lore skill that does not exist.
 *
 * "You're trained in Legal Lore or Underworld Lore" was imported as a single subject, so the sheet
 * read "Legal-lore-or-underworld Lore" and the player was never asked which one they had. Six of the
 * seven already carry a `choice` naming the two real subjects; nothing rendered it.
 *
 * `trainedLoreOptions` puts the two subjects where the builder already renders a Lore control, so the
 * pick is asked and the trained skill is real either way.
 *
 * Free Spirit is the odd one out — its text offers "Settlement Lore or a terrain Lore", where the
 * second half is a whole open category rather than a named subject. It becomes a free-text Lore
 * (`trainedLoreChoice`), which is the control that fits an open answer.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** id -> the two named subjects its text offers, in printed order. */
const OPTIONS = {
  'ex-con-token-guard': ['legal', 'underworld'],
  'grizzled-muckrucker': ['labor', 'underworld'],
  'harbor-guard-moonlighter': ['sailing', 'hunting'],
  'sally-guard-neophyte': ['hunting', 'stabling'],
  'sleepless-suns-star': ['gladiatorial', 'genealogy'],
  squire: ['heraldry', 'warfare'],
};

const db = JSON.parse(readFileSync('public/core.json', 'utf8'));
const patches = [];

for (const [id, options] of Object.entries(OPTIONS)) {
  const bg = db.backgrounds?.[id];
  if (!bg) throw new Error(`background ${id} not found`);
  const text = String(bg.description ?? '').replace(/<[^>]+>/g, ' ').toLowerCase();
  // Both subjects must be named in the record's own text, or this is guessing.
  for (const s of options) if (!text.includes(s)) throw new Error(`${id}: '${s}' is not named in its description`);
  delete bg.trainedLore;
  bg.trainedLoreOptions = options;
  patches.push({ category: 'backgrounds', id, field: 'trainedLore', value: null });
  patches.push({ category: 'backgrounds', id, field: 'trainedLoreOptions', value: options });
}

// "Settlement Lore or a terrain Lore" — the second half is an open category, so free text fits.
const fs = db.backgrounds['free-spirit'];
if (!fs) throw new Error('free-spirit not found');
delete fs.trainedLore;
fs.trainedLoreChoice = true;
patches.push({ category: 'backgrounds', id: 'free-spirit', field: 'trainedLore', value: null });
patches.push({ category: 'backgrounds', id: 'free-spirit', field: 'trainedLoreChoice', value: true });

writeFileSync('public/core.json', JSON.stringify(db)); // minified on purpose

const FILE = 'scripts/data/effect-backfill.json';
const existing = JSON.parse(readFileSync(FILE, 'utf8'));
const key = (p) => `${p.category}|${p.id}|${p.field}`;
const mine = new Set(patches.map(key));
writeFileSync(FILE, JSON.stringify([...existing.filter((p) => !mine.has(key(p))), ...patches], null, 2));

console.log(`${Object.keys(OPTIONS).length} backgrounds now offer their two Lore subjects; Free Spirit takes free text.`);
