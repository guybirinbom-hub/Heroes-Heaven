/*
 * Caustic Nectar grants "a nectar ranged unarmed attack" and the app had no such Strike, so Potent
 * Nectar — which does nothing except add damage to it — had nothing to attach to.
 *
 * Both halves are written here: the Strike itself, and Potent Nectar's permanent one-of-two choice.
 * Every number is read out of the records' own text and checked before anything is written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const db = JSON.parse(readFileSync(ROOT + 'public/core.json', 'utf8'));
const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const plain = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

const caustic = plain(db.feats['caustic-nectar']?.description);
if (!/nectar ranged unarmed attack with a range increment of 20 feet that deals 1d4 acid damage/i.test(caustic))
  fail('caustic-nectar: the Strike\'s range and damage are not what the text says');
if (!/On a critical hit, the target is additionally Sickened 1/i.test(caustic)) fail('caustic-nectar: the crit rider not found');
if (!/Your nectar doesn.t add critical specialization effects/i.test(caustic)) fail('caustic-nectar: the no-crit-spec clause not found');

const potent = plain(db.feats['potent-nectar']?.description);
if (!/deals an additional 1d4 persistent acid damage/i.test(potent)) fail('potent-nectar: the persistent branch not found');
if (!/additionally deals 1d4 acid splash damage/i.test(potent)) fail('potent-nectar: the splash branch not found');
if (!/This choice is permanent and can.t be changed/i.test(potent)) fail('potent-nectar: the permanence clause not found');

const GRANTS = [
  {
    /*
     * The PHANTOM question. Potent Nectar shipped TWO pickers for its one "select one of the
     * following benefits": this bare `choice` (prompt "Benefit", options Splash/Persistent) and the
     * `effectChoices` group below, which is the one that actually writes damage onto the Nectar
     * Strike. The bare one has no consumer — answering it moves nothing.
     *
     * Round 5, on Exemplar Dedication: a phantom question is DELETED, not answered. `value: null`
     * is how the applier spells removal.
     *
     * ⚠ It must be removed HERE rather than out of public/core.json. The field comes from
     * public/core.foundry-backup.json, the pristine reference import-core-v2.mjs transcribes
     * mechanics from on every run, so a direct edit to core.json is undone by the next
     * `npm run data`. The overlay is applied last and is the only durable removal.
     */
    id: 'potent-nectar',
    field: 'choice',
    value: null,
  },
  {
    id: 'caustic-nectar',
    field: 'grantedStrikes',
    value: [
      {
        name: 'Nectar',
        die: 'd4',
        damageType: 'acid',
        // `brawling` would hand it critical specialization, which the feat explicitly denies. No
        // group at all is the honest encoding — the strike's own text carries its crit effect.
        group: '',
        traits: ['unarmed'],
        range: 20,
      },
    ],
  },
  {
    id: 'caustic-nectar',
    field: 'note',
    value: 'On a critical hit with your nectar the target is also sickened 1. Your nectar adds no critical specialization effect, and you are immune to your own.',
  },
  {
    id: 'potent-nectar',
    field: 'effectChoices',
    value: [
      {
        id: 'potent-nectar',
        prompt: 'Potent Nectar — permanent, and cannot be changed later',
        options: [
          {
            value: 'sticky',
            label: 'Sticky — 1d4 persistent acid',
            grant: {
              strikeDamage: [
                { type: 'acid', strikeName: 'Nectar', dice: { n: 1, die: 'd4' }, persistent: true, note: 'Potent Nectar' },
              ],
            },
          },
          {
            value: 'splash',
            label: 'High velocity — 1d4 acid splash',
            grant: {
              strikeDamage: [{ type: 'acid', strikeName: 'Nectar', dice: { n: 1, die: 'd4' }, splash: true, note: 'Potent Nectar' }],
            },
          },
        ],
      },
    ],
  },
];

let added = 0;
let replaced = 0;
for (const g of GRANTS) {
  const i = rows.findIndex((r) => r.category === 'feats' && r.id === g.id && r.field === g.field && !r.path);
  const row = { category: 'feats', id: g.id, field: g.field, value: g.value };
  if (i >= 0) {
    rows[i] = row;
    replaced++;
  } else {
    rows.push(row);
    added++;
  }
}
// Both shipped warnings saying the app could not do this.
for (const id of ['caustic-nectar', 'potent-nectar']) {
  const i = rows.findIndex((r) => r.category === 'feats' && r.id === id && r.field === 'dataWarning');
  if (i >= 0) {
    rows.splice(i, 1);
    replaced++;
  }
}
writeFileSync(BF, formatBackfill(rows));
console.log(`effect-backfill: +${added} added, ${replaced} replaced/removed`);
