/*
 * COLLECT THE RESIDUAL READ'S CONFIRMED FINDINGS out of a workflow journal.
 *
 * The batches 1–12 residual pass ran 326 agents — 48 readers over 1,201 records, then one adversarial
 * refuter per candidate finding. Its return value is over a megabyte, which is not a thing to read; the
 * journal has one `{"type":"result"}` line per agent with the same data, so it is collected from there.
 *
 * Readers return `{ examined, findings: [...] }`; refuters return `{ refuted, evidence, whereToModel }`
 * merged onto the finding they judged. Only findings that SURVIVED refutation are written out.
 *
 *   node scripts/wg-residual-collect.mjs --journal <path> --out work/residual-1-12.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const journal = arg('--journal', null);
const resultFile = arg('--result', null);
const out = arg('--out', 'work/residual-1-12.json');

/*
 * PREFER THE WORKFLOW'S OWN RESULT. It paired each verdict to the finding it judged while both were in
 * hand; the JOURNAL stores the two as separate agent results, and re-pairing them afterwards by the
 * record id quoted in the verdict's prose is lossy — it matched 223 of 278 and would have quietly
 * dropped 55 judged findings, understating the count by a fifth. The journal path stays as a fallback
 * for a run whose result was lost, and it SAYS how many it could not pair rather than rounding down.
 */
if (resultFile) {
  const raw = JSON.parse(readFileSync(resultFile, 'utf8'));
  const res = raw.result ?? raw;
  const confirmed = res.confirmed ?? [];
  console.log(`workflow result: ${confirmed.length} confirmed, ${res.refutedCount ?? '?'} refuted.`);
  writeFileSync(join(ROOT, out), `${JSON.stringify({ examined: 1201, confirmed, refutedCount: res.refutedCount ?? 0 }, null, 2)}\n`, 'utf8');
  console.log(`wrote ${out}`);
  process.exit(0);
}

if (!journal) { console.error('usage: --result <task.output> | --journal <journal.jsonl> [--out …]'); process.exit(2); }

const lines = readFileSync(journal, 'utf8').trim().split(/\r?\n/).filter(Boolean);

const candidates = [];
const verdicts = [];
let examined = 0;
for (const l of lines) {
  let j;
  try { j = JSON.parse(l); } catch { continue; }
  const v = j.result;
  if (!v || typeof v !== 'object') continue;
  if (Array.isArray(v.findings)) { examined += Number(v.examined) || 0; candidates.push(...v.findings); }
  else if (typeof v.refuted === 'boolean') verdicts.push(v);
}

/*
 * The workflow merged each verdict onto its finding before returning, but the JOURNAL stores the two
 * separately — a refuter's own result is just the verdict. They are re-paired by the record id quoted
 * in the verdict's evidence, which every refuter prompt names. A verdict that matches no candidate, or
 * a candidate with no verdict, is reported rather than silently dropped: an unjudged finding is not a
 * confirmed one, and calling it either way without saying so is how a count stops meaning anything.
 */
const byId = new Map();
for (const f of candidates) {
  if (!byId.has(f.id)) byId.set(f.id, []);
  byId.get(f.id).push(f);
}
let paired = 0;
for (const v of verdicts) {
  const hit = [...byId.keys()].filter((id) => String(v.evidence ?? '').includes(id) || String(v.whereToModel ?? '').includes(id));
  /* Prefer the longest id match — `swift` is a substring of a dozen ids. */
  hit.sort((a, b) => b.length - a.length);
  const id = hit[0];
  if (!id) continue;
  for (const f of byId.get(id)) if (!f.verdict) { f.verdict = v; paired++; break; }
}

const confirmed = candidates.filter((f) => f.verdict && !f.verdict.refuted);
const refuted = candidates.filter((f) => f.verdict && f.verdict.refuted);
const unjudged = candidates.filter((f) => !f.verdict);

console.log(`${examined} record(s) read; ${candidates.length} candidate finding(s); ${verdicts.length} verdict(s), ${paired} paired.`);
console.log(`  confirmed : ${confirmed.length}`);
console.log(`  refuted   : ${refuted.length}`);
console.log(`  UNJUDGED  : ${unjudged.length}  ${unjudged.length ? '(treated as NOT confirmed — they still need a read)' : ''}`);

writeFileSync(
  join(ROOT, out),
  `${JSON.stringify({ examined, confirmed: confirmed.map((f) => ({ ...f, evidence: f.verdict.evidence, whereToModel: f.verdict.whereToModel })), refutedCount: refuted.length, unjudged }, null, 2)}\n`,
  'utf8',
);
console.log(`\nwrote ${out}`);
