/*
 * THE ANSWER KEY — builds the review document the owner corrects, and the machine-readable key that
 * every later model run is scored against.
 *
 * Input: three independent lens extractions (text only, no app knowledge), Foundry's rule elements as
 * an INDEPENDENT second opinion, and what our own records carry. Output: one entry per feat with a
 * proposed answer and a confidence, in a form that is quick to skim and correct.
 *
 * ⚠ The proposal here is NOT the answer. It is a merge, and merges are wrong in exactly the places
 * that matter — the owner's pass is what makes this a gold set. Confidence is stated per requirement
 * so review time lands where the evidence is thin.
 *
 *   node scripts/gold-answer-key.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const cand = JSON.parse(read('scripts/audit/gold-candidates.json'));
const extraction = JSON.parse(read('scripts/audit/gold-extraction.json'));

/* Foundry rule elements — a SECOND OPINION on mechanics only. Never its prose, and never a value. */
const FOUNDRY = join(root, '.import-src/pf2e/packs/pf2e');
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : (e.name.endsWith('.json') && e.name !== '_folders.json' ? [join(d, e.name)] : []));
const fRules = new Map();
try {
  for (const f of [...walk(join(FOUNDRY, 'feats')), ...walk(join(FOUNDRY, 'class-features'))]) {
    try { const j = JSON.parse(readFileSync(f, 'utf8')); fRules.set(norm(j.name), (j.system?.rules ?? []).map((r) => r.key)); } catch { /* skip */ }
  }
} catch { console.log('(Foundry pack absent — corroboration column will be empty)'); }

const PLUMBING = new Set(['ItemAlteration', 'ActiveEffectLike', 'RollOption']);
const byId = Object.fromEntries(extraction.merged.map((m) => [m.id, m]));

/* Requirements the three lenses word differently but mean identically must count as ONE. Keyed on the
 * lane plus the opening of the clause, which is the cheapest thing that survives rewording. */
const keyOf = (q) => `${q.lane || 'free'}::${String(q.clause).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 6).join(' ')}`;

const rows = [];
for (const c of cand.candidates) {
  const m = byId[c.id];
  const grouped = new Map();
  for (const q of m?.requirements ?? []) {
    const k = keyOf(q);
    if (!grouped.has(k)) grouped.set(k, { ...q, lenses: new Set() });
    grouped.get(k).lenses.add(q.lens);
  }
  const reqs = [...grouped.values()].map((q) => ({
    clause: q.clause, lane: q.lane || null, freeText: q.freeText || null, conditional: !!q.conditional,
    agreedBy: q.lenses.size,
    // 3 lenses independently naming the same requirement is the strongest signal available here.
    confidence: q.lenses.size >= 3 ? 'high' : q.lenses.size === 2 ? 'medium' : 'low',
  })).sort((a, b) => b.agreedBy - a.agreedBy);

  const foundry = (fRules.get(norm(c.name)) ?? []).filter((k) => !PLUMBING.has(k));
  rows.push({
    id: c.id, name: c.name, level: c.level, stratum: c.stratum, role: c.role,
    text: c.text,
    proposed: reqs,
    unanimousNothing: !!m?.unanimousNothing,
    splitOnNothing: !!m?.splitOnNothing,
    foundryCorroboration: foundry,
    ourFields: c.ourFields ?? [],
    // A control that produced requirements means the reader over-flagged — what controls exist to catch.
    controlViolated: c.stratum === 'inert' && reqs.length > 0,
  });
}

writeFileSync(join(root, 'scripts/audit/gold-answer-key.json'), JSON.stringify({
  built: '2026-08-11',
  note: "PROPOSED answers, pending the owner's review. Confidence = how many of three independent lenses named the same requirement. Foundry columns are corroboration only, never a source of values.",
  rows,
}, null, 1));

/* ── The review document ───────────────────────────────────────────────────────────────────────── */
const md = [];
md.push('# Gold set — for review');
md.push('');
md.push('43 feats. For each: its printed text, and what three independent readers said a character sheet');
md.push('must be able to express. **Your corrections make this the answer key** that every later model run');
md.push('is scored against — so a wrong entry here propagates into all 6,206 feats.');
md.push('');
md.push('**Referencing.** Feats are numbered 1–43; each requirement carries a number like `14.2`. Say');
md.push('"14.2 is wrong, it should be a status bonus" or "delete 27.3" and I can apply it exactly.');
md.push('');
md.push('**How to read a row.** `3/3` means all three readers independently named that requirement —');
md.push('strong. `1/3` means only one did, and those are where your eye is most worth spending. The Foundry');
md.push('column is a second opinion from an unrelated implementation; it is corroboration, never a source.');
md.push('');
md.push('**The six `inert` feats are controls.** Every clause in them lands on an ally or an enemy, so per');
md.push('your Ruling F the correct answer is *no requirements at all*. If a reader produced any, that is');
md.push('over-flagging, and it is called out below.');
md.push('');
const violated = rows.filter((r) => r.controlViolated).length;
const nothing = rows.filter((r) => r.unanimousNothing).length;
md.push(`**Summary:** ${rows.length} feats · ${rows.reduce((n, r) => n + r.proposed.length, 0)} proposed requirements · ` +
  `${nothing} feats where all readers agreed nothing is required · ${violated} control(s) violated.`);
md.push('');
/* Stable numbering so the owner can say "14.2 is wrong" and mean exactly one requirement. Assigned in
 * document order and written into the JSON key too, so a correction can be applied without ambiguity. */
const ORDER = ['inert', 'explicit-single', 'multi-clause', 'missing-system', 'two-source-clash', 'choice'];
const ordered = ORDER.flatMap((s) => rows.filter((r) => r.stratum === s));
ordered.forEach((r, i) => {
  r.num = i + 1;
  r.proposed.forEach((q, j) => { q.ref = `${i + 1}.${j + 1}`; });
});

md.push('\n## Index\n');
md.push('| # | feat | stratum | reqs |');
md.push('|---|---|---|---|');
for (const r of ordered) {
  md.push(`| ${r.num} | ${r.name} | ${r.stratum} | ${r.proposed.length || '—'}${r.controlViolated ? ' ⚠' : ''} |`);
}

for (const stratum of ORDER) {
  const group = ordered.filter((r) => r.stratum === stratum);
  if (!group.length) continue;
  md.push(`\n---\n\n## ${stratum} (${group.length}) — #${group[0].num}–${group[group.length - 1].num}\n`);
  for (const r of group) {
    md.push(`### ${r.num}. ${r.name}  \`${r.id}\`  · level ${r.level ?? '—'} · ${r.role}`);
    if (r.controlViolated) md.push('> ⚠ **CONTROL VIOLATED** — this should have produced no requirements.');
    if (r.unanimousNothing) md.push('> ✅ all three readers agreed: **nothing required**');
    if (r.splitOnNothing) md.push('> ⚠ readers SPLIT on whether anything is required');
    md.push('');
    md.push(`*${r.text.slice(0, 600)}${r.text.length > 600 ? '…' : ''}*`);
    md.push('');
    if (!r.proposed.length) md.push('_No requirements proposed._');
    else {
      md.push('| # | agreed | lane | what the sheet must express | from the clause |');
      md.push('|---|---|---|---|---|');
      for (const q of r.proposed) {
        const what = (q.freeText || '—').replace(/\|/g, '\\|').slice(0, 180);
        md.push(`| **${q.ref}** | ${q.agreedBy}/3 | ${q.lane ? `\`${q.lane}\`` : '**none fits**'} | ${what} | ${String(q.clause).replace(/\|/g, '\\|').slice(0, 90)}… |`);
      }
    }
    md.push('');
    md.push(`<sub>Foundry says: ${r.foundryCorroboration.length ? r.foundryCorroboration.join(', ') : '(nothing — carries no rule elements)'} · our record carries: ${r.ourFields.length ? r.ourFields.join(', ') : '(nothing)'}</sub>`);
    md.push('');
  }
}
writeFileSync(join(root, 'docs/gold-set-review.md'), md.join('\n'));
/* Re-written now that numbering exists, so a correction like "14.2" resolves in the JSON too. */
writeFileSync(join(root, 'scripts/audit/gold-answer-key.json'), JSON.stringify({
  built: '2026-08-11',
  note: "PROPOSED answers, pending the owner's review. `num` addresses a feat, `ref` (e.g. 14.2) addresses one requirement. Confidence = how many of three independent lenses named it. Foundry columns are corroboration only, never a source of values.",
  rows: ordered,
}, null, 1));

console.log(`feats                     ${rows.length}`);
console.log(`proposed requirements     ${rows.reduce((n, r) => n + r.proposed.length, 0)}`);
console.log(`  agreed by all three     ${rows.reduce((n, r) => n + r.proposed.filter((q) => q.agreedBy === 3).length, 0)}`);
console.log(`  by one lens only        ${rows.reduce((n, r) => n + r.proposed.filter((q) => q.agreedBy === 1).length, 0)}`);
console.log(`unanimous "nothing"       ${nothing}`);
console.log(`CONTROLS VIOLATED         ${violated} of ${rows.filter((r) => r.stratum === 'inert').length}`);
console.log('\nwrote docs/gold-set-review.md + scripts/audit/gold-answer-key.json');
