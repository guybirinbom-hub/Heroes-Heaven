/*
 * THE GOLD SET, finished — the answer key every later model run is scored against.
 *
 * Merges: the owner's 10 worked answers, the 33 feats settled against their 14 decisions, and the
 * challenge pass's 5 concrete defect corrections. Emits the reviewable document and the machine key.
 *
 *   node scripts/gold-final-doc.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const key = JSON.parse(read('scripts/audit/gold-answer-key.json'));
const final = JSON.parse(read('scripts/audit/gold-final.json'));

/* The ten the owner answered directly. Their requirements are quoted from the answers doc rather than
 * re-derived — an owner answer is the ground truth this whole set exists to establish. */
const OWNER = {
  1: { basis: 'owner answer #1', reqs: [['note', 'A marker on the Lay on Hands spell showing this feat modifies it. Display shape deferred — "later we can decide how its displayed".']] },
  2: { basis: 'owner answer #2', reqs: [['note', 'A marker on the Lay on Hands spell showing this feat modifies it.']] },
  3: { basis: 'owner answer #3', reqs: [
    ['mode', 'Shield the Faithful is a MODE. It runs 1 minute and includes you, so the mode carries its real numbers for your half: +1 item bonus to AC and resistance 10 to spirit damage.'],
    ['modifiesGrant', "Healing Sanctuary modifies that mode's TEXT. It contributes no numbers — rounds are not tracked — but the mode must state the ally temporary-HP clause so the player reads the full effect."],
  ] },
  6: { basis: 'owner answer #6', reqs: [['situational', 'A star on EVERY skill that can Recall Knowledge, so the player sees the effect where they look up the number. The off-guard clause lands on the enemy and adds nothing.']] },
  7: { basis: 'owner answer #7', reqs: [['grantsAction', 'A reaction in the reactions list, with its trigger (you fail a Reflex save) and its requirement (you can see the night sky) shown in the popup. Nothing else — explicitly not a degree-of-success surface.']] },
  8: { basis: 'owner answer #8', reqs: [['speed', 'A fly Speed equal to your Speed, with a `*` carrying the feat details — the value is a formula off your own Speed, which a bare number cannot convey (Q7).']] },
  9: { basis: 'owner answer #9', reqs: [
    ['grantsClassFeature', 'Grant the Blessing of the Devoted class feature and surface its details.'],
    ['choice', 'Offer the choice of one blessing. ⚠ Owner flagged as open whether other sources widen the list.'],
  ] },
  13: { basis: 'owner answer #13', reqs: [['note', 'Recognize a Spell listed under BOTH costs — its native reaction and the free action this feat enables — with the explanation in the popup.']] },
  15: { basis: 'owner answer #15', reqs: [
    ['choice', 'A FREE-TEXT field for the favoured location.'],
    ['situational', 'A `*` on Sneak carrying the no-check clause.'],
    ['situational', 'A `*` on Avoid Notice carrying the 15-foot approach clause.'],
    ['skillChoice', '⚠ ADDED BY ME, not by the owner: the first sentence also grants trained in Deception or Thievery, or expert in one if already trained in both — a skill choice with a redundancy fallback.'],
    ['', 'Changing the favoured location is a builder action and needs no sheet surface.'],
  ] },
  16: { basis: 'owner answer #16', reqs: [['situational', 'A `*` on Deception carrying the once-per-day reroll (a fortune effect) and the ring-of-truth counteract clause.']] },
};

const byNum = Object.fromEntries(final.results.map((r) => [r.num, r]));
const defects = Object.fromEntries((final.defectsFound ?? []).map((d) => [d.num, d]));

const rows = key.rows.map((k) => {
  const owner = OWNER[k.num];
  if (owner) {
    return { ...k, source: 'owner', basis: owner.basis,
      requirements: owner.reqs.map(([lane, what]) => ({ lane, what, clause: '' })) };
  }
  const f = byNum[k.num];
  return { ...k, source: 'derived', basis: f?.basis ?? '', requirements: f?.requirements ?? [],
    defect: defects[k.num]?.defect ?? null, fix: defects[k.num]?.fix ?? null };
});

const md = [];
md.push('# The gold set — finished');
md.push('');
md.push('43 feats, every one settled. **This is the answer key.** Model runs are scored against it, so');
md.push('a wrong entry here propagates into all 6,206 feats.');
md.push('');
md.push('- **10 feats carry your answers directly** — quoted, not re-derived.');
md.push('- **33 were settled against your fourteen decisions.** Each names which one decides it.');
md.push('- **5 were corrected by an adversarial pass** that had to name a concrete defect. Those are');
md.push('  marked ⚠ and are the entries most worth a second look.');
md.push('');
const total = rows.reduce((n, r) => n + r.requirements.length, 0);
const noLane = rows.flatMap((r) => r.requirements).filter((q) => !q.lane).length;
md.push(`**${total} requirements.** ${noLane} (${Math.round((100 * noLane) / total)}%) still need a lane this app does not have —`);
md.push('down from 44% before your rulings were written into the vocabulary.');
md.push('');
md.push('| # | feat | source | reqs |');
md.push('|---|---|---|---|');
for (const r of rows) md.push(`| ${r.num} | ${r.name} | ${r.source === 'owner' ? '**you**' : r.defect ? '⚠ corrected' : 'derived'} | ${r.requirements.length} |`);

for (const r of rows) {
  md.push(`\n---\n`);
  md.push(`### ${r.num}. ${r.name}  \`${r.id}\`  · level ${r.level ?? '—'}`);
  md.push(`*Basis: ${r.basis || '—'}*`);
  if (r.defect) md.push(`\n> ⚠ **Corrected by the challenge pass.** ${String(r.defect).replace(/\s+/g, ' ').slice(0, 400)}`);
  md.push('');
  if (!r.requirements.length) md.push('_Nothing required._');
  else {
    md.push('| # | lane | what the sheet must be able to express |');
    md.push('|---|---|---|');
    r.requirements.forEach((q, i) => {
      md.push(`| ${r.num}.${i + 1} | ${q.lane ? `\`${q.lane}\`` : '**no lane**'} | ${String(q.what).replace(/\|/g, '\\|').replace(/\s+/g, ' ')} |`);
    });
  }
}
writeFileSync(join(root, 'docs/gold-set-final.md'), md.join('\n'));
writeFileSync(join(root, 'scripts/audit/gold-set.json'), JSON.stringify({
  built: '2026-08-11',
  status: 'COMPLETE — the answer key. 10 owner-answered, 33 derived from the owner\'s 14 decisions, 5 corrected by adversarial challenge.',
  requirements: total, noLaneCount: noLane,
  rows,
}, null, 1));

console.log(`feats                 ${rows.length}`);
console.log(`  owner-answered      ${rows.filter((r) => r.source === 'owner').length}`);
console.log(`  derived             ${rows.filter((r) => r.source === 'derived').length}`);
console.log(`  corrected by challenge ${rows.filter((r) => r.defect).length}`);
console.log(`requirements          ${total}  (${noLane} still need a lane we lack)`);
console.log('\nwrote docs/gold-set-final.md + scripts/audit/gold-set.json');
