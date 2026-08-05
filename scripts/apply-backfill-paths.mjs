/*
 * Push every `path`-carrying backfill entry into the LIVE public/core.json.
 *
 * The overlay is what survives `npm run data`; core.json is what the app reads today. A lane that
 * writes only the overlay is invisible until the next full rebuild — which is exactly the failure
 * mode where a change looks applied and isn't. This closes that gap for nested patches, using the
 * same id-addressed resolution the importer uses so the two can never disagree.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

function target(root, path) {
  let node = root;
  for (const step of path) {
    if (node == null) return null;
    if (Array.isArray(node)) {
      const [k, v] = String(step).split('=');
      node = k === 'id' ? node.find((x) => x?.id === v) : null;
    } else node = node[step];
  }
  return node && typeof node === 'object' ? node : null;
}

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const fixes = JSON.parse(readFileSync(BACKFILL, 'utf8')).filter((f) => f.path?.length && f.field);

let applied = 0;
const unresolved = [];
for (const f of fixes) {
  const entry = core[f.category]?.[f.id];
  const node = entry ? target(entry, f.path) : null;
  if (!node) {
    unresolved.push(`${f.category}/${f.id}/${f.path.join('/')}`);
    continue;
  }
  node[f.field] = f.value;
  applied++;
}

if (unresolved.length) {
  console.error(`${unresolved.length} paths did not resolve — refusing to write:\n  ` + unresolved.join('\n  '));
  process.exit(1);
}

writeFileSync(CORE, JSON.stringify(core));
console.log(`applied ${applied} nested backfill patches to ${CORE}`);
