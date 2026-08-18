/*
 * "You learn three new languages of your choice."
 *
 * Nothing in the schema could say that. `grantsLanguages` names WHICH languages a record hands over,
 * so a record that hands over a CHOICE had no field at all — which is why Multilingual, the most-taken
 * language feat in the game, did nothing.
 *
 * Wording quoted below is from the AoN mirror.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const FIXES = [
  {
    id: 'multilingual',
    fields: {
      // "You learn two new languages … You learn an additional language if you are or become a
      //  master in Society and again if you are or become legendary."
      // `atRank` rather than a fixed number, because "or BECOME" means the count rises later.
      languageChoices: 2,
      languageChoicesAtRank: [
        { skill: 'society', rank: 'master', extra: 1 },
        { skill: 'society', rank: 'legendary', extra: 1 },
      ],
    },
  },
  {
    id: 'gnome-polyglot',
    fields: {
      // "You learn three new languages … When you select the Multilingual feat, you learn three new
      //  languages instead of two." The second clause changes ANOTHER record's count, per take.
      languageChoices: 3,
      languageChoicesBonus: [{ featId: 'multilingual', extra: 1 }],
    },
  },
  {
    id: 'pact-of-the-rune-dragon',
    // "You immediately learn 10 languages chosen from common languages, uncommon languages, and any
    //  others the dragon has access to."
    fields: { languageChoices: 10 },
  },
  {
    id: 'officers-education',
    /*
     * "You become trained in two skills you are not already trained in, become an expert in one skill
     *  you are currently trained in, LEARN ONE COMMON LANGUAGE YOU DO NOT ALREADY KNOW, and gain any
     *  one general feat that you meet the prerequisites for."
     *
     * Four benefits; three were already carried — the skills by FEAT_SKILL_GRANTS and the general
     * feat by FEAT_PICK_GRANTS — so a commander taking this got every picker except a language one,
     * and the Languages card's budget never moved. Found by diffing against Wanderer's Guide, which
     * encodes all four.
     *
     * ONE, not two, even though `maxTakable` is 2: `recordLanguageSlots` counts feat INSTANCES, so a
     * second take supplies the second slot by itself. Writing 2 here would grant four languages to a
     * commander who took it twice.
     */
    fields: { languageChoices: 1 },
  },
];

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const missing = FIXES.filter((f) => !core.feats[f.id]);
if (missing.length) {
  console.error(`not in core.json: ${missing.map((m) => m.id).join(', ')} — refusing to write`);
  process.exit(1);
}

const entries = [];
for (const f of FIXES) {
  for (const [field, value] of Object.entries(f.fields)) {
    core.feats[f.id][field] = value;
    entries.push({ category: 'feats', id: f.id, field, value });
  }
}
writeFileSync(CORE, JSON.stringify(core));

const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));

console.log(`wrote ${entries.length} fields on ${FIXES.length} feats (backfill ${backfill.length} → ${next.length})`);
console.log(
  'NOT written: linguistic-nexus ("an additional language for every 2 levels of the relic") — the count\n' +
    'is a function of the RELIC\'s level, and relic levels are not modelled. Writing @actor.level there\n' +
    'would produce a confidently wrong number.',
);
