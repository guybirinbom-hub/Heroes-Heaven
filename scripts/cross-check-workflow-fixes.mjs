/*
 * CROSS-CHECK the workflow's 190 surviving fixes against the two things that make a fix wrong here.
 *
 * The workflow reported only ONE finding as already-built out of 200. That is far below this project's
 * historical rate — roughly half of every "gap" ever reported turned out to be modelled somewhere the
 * reader did not look — so the number is treated as a claim to test, not a result to trust. (It may be
 * legitimately low: these 200 had already survived one adversarial refuter pass before reaching the
 * file. Legitimately low still has to be shown, not assumed.)
 *
 * Two mechanical tests, both cheap and neither relying on a model's judgement:
 *
 *   FIELD ALREADY SET   the record in public/core.json already holds the field the fix proposes to
 *                       write. Authoring would overwrite something that exists.
 *   ID IN A REGISTRY    the record's id appears in one of the rules registries or hard-coded in
 *                       derive.ts / build.ts, which is exactly where an "already built" mechanic hides.
 *
 * Neither is proof of a false positive — a record may legitimately hold a DIFFERENT field, or appear in
 * a registry for an unrelated clause. Both are a list of things to look at before writing.
 *
 *   node scripts/cross-check-workflow-fixes.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const out = read('work/residual-workflow-out.json');

/* Every rules source, concatenated once — the registries AND the hard-coded implementations. */
const SRC = readdirSync(join(ROOT, 'src/rules'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `\n/*FILE:${f}*/\n` + readFileSync(join(ROOT, 'src/rules', f), 'utf8'))
  .join('');

const fieldSet = [];
const inRegistry = [];
const clean = [];

for (const fix of out.survived ?? []) {
  /* The agents sometimes wrote prose into `field` ("note — scripts/data/…"); take the first token. */
  const field = String(fix.field ?? '').trim().split(/[\s—,]/)[0];
  const rec = core[fix.bucket]?.[fix.id];
  const has = field && rec && rec[field] != null && !(Array.isArray(rec[field]) && !rec[field].length);

  const quoted = new RegExp(`['"\`]${fix.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
  const hit = quoted.test(SRC);
  const files = hit ? [...SRC.matchAll(/\/\*FILE:([^*]+)\*\//g)].filter((m, i, arr) => {
    const next = arr[i + 1]?.index ?? SRC.length;
    return quoted.test(SRC.slice(m.index, next));
  }).map((m) => m[1]) : [];

  if (has) fieldSet.push({ ...fix, field, files });
  else if (hit) inRegistry.push({ ...fix, field, files });
  else clean.push({ ...fix, field });
}

console.log(`${(out.survived ?? []).length} surviving fixes cross-checked:\n`);
console.log(`  ${String(clean.length).padStart(3)}  no field set, id not in src/rules — nothing contradicts the fix`);
console.log(`  ${String(inRegistry.length).padStart(3)}  id APPEARS in src/rules — check the hit is an unrelated clause`);
console.log(`  ${String(fieldSet.length).padStart(3)}  the proposed FIELD IS ALREADY SET on the record — look before writing`);

if (fieldSet.length) {
  console.log('\n--- field already set:');
  for (const f of fieldSet) console.log(`   ${f.bucket}/${f.id}  .${f.field}${f.files.length ? `   [${f.files.join(', ')}]` : ''}`);
}
if (inRegistry.length) {
  console.log('\n--- id present in src/rules:');
  for (const f of inRegistry) console.log(`   ${f.bucket}/${f.id}  .${f.field}   [${f.files.join(', ')}]`);
}
