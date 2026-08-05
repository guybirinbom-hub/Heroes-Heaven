/*
 * Seven records that hand the player a temporary item every morning, none of which delivered one.
 *
 * `Feat.advancedAlchemy` was the proof this shape works and the proof it was built too narrowly:
 * alchemist-only, feat-keyed, hardcoded to alchemical items. So a record granting a temporary SCROLL
 * — or a healing item, or a potion — had nowhere to live at all.
 *
 * Wording quoted above each entry, from the AoN mirror (remastered printing where two ship).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const FIXES = [
  {
    id: 'basic-scroll-cache',
    // "Each day during your daily preparations, you can create a single temporary scroll containing
    //  a 1st-rank spell."
    value: [
      {
        id: 'basic',
        label: 'Temporary scroll (1st rank)',
        count: 1,
        filter: {
          spellRank: 1,
          note: 'The spell must be a common spell, one you have access to, or one you can cast. The scroll becomes non-magical at your next daily preparations.',
        },
      },
    ],
  },
  {
    id: 'expert-scroll-cache',
    // "In addition to your daily scrolls from Basic Scroll Cache, add a scroll with a 3rd-rank spell.
    //  At 14th level, add a scroll with a 4th-rank spell. At 16th level, add a scroll with a 5th-rank
    //  spell." — one scroll whose RANK rises, not three scrolls.
    value: [
      {
        id: 'expert',
        label: 'Temporary scroll',
        count: 1,
        filter: { spellRankByLevel: [{ level: 1, rank: 3 }, { level: 14, rank: 4 }, { level: 16, rank: 5 }] },
      },
    ],
  },
  {
    id: 'master-scroll-cache',
    // "…add a single scroll with a 6th-rank spell. At 20th level, add a scroll with a 7th-rank spell."
    value: [
      {
        id: 'master',
        label: 'Temporary scroll',
        count: 1,
        filter: { spellRankByLevel: [{ level: 1, rank: 6 }, { level: 20, rank: 7 }] },
      },
    ],
  },
  {
    id: 'grand-scroll-esoterica',
    // Same wording as Master Scroll Cache, for the esoterica line.
    value: [
      {
        id: 'grand',
        label: 'Temporary scroll',
        count: 1,
        filter: { spellRankByLevel: [{ level: 1, rank: 6 }, { level: 20, rank: 7 }] },
      },
    ],
  },
  {
    id: 'scroll-adept',
    // "During your daily preparations, you can create two temporary scrolls containing arcane spells
    //  from your spellbook. Each scroll must be of a different spell rank, and both spell ranks must
    //  be 2 or more ranks lower than your highest-rank spell."
    // TWO scrolls, flat — the "different rank" and "2 ranks lower" restrictions are the player's to
    // honour, since the app does not model which of your spells is highest at pick time.
    value: [
      {
        id: 'adept',
        label: 'Temporary scroll from your spellbook',
        count: 2,
        filter: {
          fromSpellbook: true,
          spellRank: 1,
          note: 'Each scroll must be of a DIFFERENT spell rank, and both ranks must be at least 2 lower than your highest-rank spell.',
        },
      },
    ],
  },
  {
    id: 'herbal-forager',
    // "Each day as part of your daily preparations, you can harvest ingredients from your
    //  surroundings to craft one temporary alchemical item you know the formula for. This alchemical
    //  item must have the healing trait."
    value: [
      {
        id: 'forage',
        label: 'Temporary herbal item',
        count: 1,
        filter: {
          traits: ['alchemical', 'healing'],
          fromKnownFormulas: true,
          note: 'It must be an item whose formula you know. If not consumed by your next daily preparations, it is rendered inert.',
        },
      },
    ],
  },
];

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];
const skipped = [];

for (const f of FIXES) {
  const feat = core.feats[f.id];
  if (!feat) {
    skipped.push(`${f.id}: not a feat in core.json`);
    continue;
  }
  // A filter that matches nothing is worse than no filter: the feat looks wired and offers an empty
  // picker. Check each one against the shipped data before writing it.
  for (const def of f.value) {
    if (def.filter.traits?.length) {
      const hits = Object.values(core.items).filter((i) => def.filter.traits.every((t) => (i.traits ?? []).includes(t)));
      if (!hits.length) {
        skipped.push(`${f.id}: no item carries ${JSON.stringify(def.filter.traits)}`);
        continue;
      }
      console.log(`${f.id}: ${hits.length} items match ${JSON.stringify(def.filter.traits)}`);
    }
    const ranks = def.filter.spellRankByLevel?.map((e) => e.rank) ?? (def.filter.spellRank ? [def.filter.spellRank] : []);
    for (const r of ranks) {
      const n = Object.values(core.spells).filter((s) => s.rank === r && !s.ritual).length;
      if (!n) {
        skipped.push(`${f.id}: no rank-${r} spells ship`);
        continue;
      }
    }
    if (ranks.length) console.log(`${f.id}: spell ranks ${ranks.join('/')} all have spells`);
  }
  feat.dailyTemporaryItems = f.value;
  entries.push({ category: 'feats', id: f.id, field: 'dailyTemporaryItems', value: f.value });
}

if (skipped.length) console.warn(`SKIPPED (${skipped.length}):\n  ` + skipped.join('\n  '));

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`\nwrote ${entries.length} records (backfill ${backfill.length} → ${next.length})`);
console.log(
  '\nNOT written: horn-of-plenty. The plan listed it as a daily temporary-item source, but it is an\n' +
    'ITEM, not a feat, and this field lives on Feat beside advancedAlchemy. Writing it would have\n' +
    'meant a lane on Item with one user and no way to reach the Rest sheet.',
);
