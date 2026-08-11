/*
 * Render the reviewable document FROM the signed key.
 *
 * ⚠ Separate from gold-final-doc.mjs on purpose. That script BUILDS the key from the raw adjudication
 * output and would discard the owner's applied corrections; this one only renders what the key already
 * says. After corrections are applied, this is the renderer to run.
 *
 *   node scripts/gold-render.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const key = JSON.parse(readFileSync(join(root, 'scripts/audit/gold-set.json'), 'utf8'));
const rows = key.rows;

const total = rows.reduce((n, r) => n + r.requirements.length, 0);
const noLane = rows.flatMap((r) => r.requirements).filter((q) => !q.lane).length;
const corrected = rows.filter((r) => r.requirements.some((q) => q.ownerCorrection));

const md = [];
md.push('# The gold set — signed');
md.push('');
md.push('43 feats, every one settled and every challenge ruled on. **This is the answer key.** Model runs');
md.push('are scored against it, so a wrong entry propagates into all 6,206 feats.');
md.push('');
md.push(`- **10 feats carry the owner's answers directly** — quoted, not re-derived.`);
md.push('- **33 settled** against the fourteen decisions those answers produced.');
md.push('- **5 challenged**, and the owner ruled on each: four fixes accepted, **one challenge rejected**.');
md.push('');
md.push(`**${total} requirements.** ${noLane} carry no lane — and note that in this key an empty lane usually`);
md.push('means *nothing is required*, which is a decision, not a gap. The genuinely missing capabilities are');
md.push('listed separately in `scripts/audit/lane-gaps.json`.');
md.push('');
md.push('## Owner corrections applied');
md.push('');
md.push('| ref | ruling |');
md.push('|---|---|');
for (const r of rows) {
  r.requirements.forEach((q, i) => {
    if (q.ownerCorrection) md.push(`| **${r.num}.${i + 1}** ${r.name} | ${q.ownerCorrection} |`);
  });
}
md.push('');
md.push('## Index');
md.push('');
md.push('| # | feat | source | reqs |');
md.push('|---|---|---|---|');
for (const r of rows) {
  const src = r.source === 'owner' ? '**owner**' : r.requirements.some((q) => q.ownerCorrection) ? 'corrected' : 'derived';
  md.push(`| ${r.num} | ${r.name} | ${src} | ${r.requirements.length} |`);
}

for (const r of rows) {
  md.push(`\n---\n`);
  md.push(`### ${r.num}. ${r.name}  \`${r.id}\`  · level ${r.level ?? '—'}`);
  md.push(`*Basis: ${r.basis || '—'}*`);
  if (r.challengeRejected) md.push(`\n> ✋ **Challenge rejected.** ${r.challengeRejected}`);
  md.push('');
  md.push(`*${String(r.text).slice(0, 420)}${String(r.text).length > 420 ? '…' : ''}*`);
  md.push('');
  if (!r.requirements.length) md.push('_Nothing required._');
  else {
    md.push('| # | lane | what the sheet must be able to express |');
    md.push('|---|---|---|');
    r.requirements.forEach((q, i) => {
      const mark = q.ownerCorrection ? ' ✅' : '';
      md.push(`| ${r.num}.${i + 1}${mark} | ${q.lane ? `\`${q.lane}\`` : '**none**'} | ${String(q.what).replace(/\|/g, '\\|').replace(/\s+/g, ' ')} |`);
    });
  }
}

writeFileSync(join(root, 'docs/gold-set-final.md'), md.join('\n'));
console.log(`feats ${rows.length} · requirements ${total} · owner-corrected refs ${rows.flatMap((r) => r.requirements).filter((q) => q.ownerCorrection).length}`);
console.log('wrote docs/gold-set-final.md');
