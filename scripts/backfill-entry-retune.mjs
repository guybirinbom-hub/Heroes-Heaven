/*
 * Two shapes, both missing entirely.
 *
 * (a) RETUNE an entry that already exists. A spellcasting entry's tradition and key attribute come
 *     from whatever granted it, and nothing could change them afterwards — so Ancestral Mind ("the
 *     spell's tradition becomes occult … and you can use your psychic spellcasting attribute modifier
 *     instead of Charisma") and the Razmiran priest's occult cleric spells both left the entry
 *     exactly as it was.
 *
 * (b) HAND the character an item. Nothing put an item in the inventory, so "You gain a Razmiri mask"
 *     delivered nothing and the player had to know to add it themselves.
 *
 * Wording quoted below, from the AoN mirror.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const FIXES = [
  {
    id: 'ancestral-mind',
    // "You can cast any innate spells you know from an ancestry feat or heritage using your psychic
    //  spellcasting … the spell's tradition becomes occult, if it wasn't already, and you can use
    //  your psychic spellcasting attribute modifier instead of Charisma…"
    // The attribute is READ OFF the psychic's own entry rather than named: a psychic's key attribute
    // is a choice, so writing one here would be right for some psychics and wrong for others.
    fields: { entryRetune: [{ scope: 'innate', tradition: 'occult', keyAbilityFromClass: 'psychic' }] },
  },
  {
    id: 'razmiran-priest-dedication',
    fields: {
      // "You gain a Razmiri mask…"
      grantsItems: [{ itemId: 'razmiri-mask' }],
      // "All spells granted by the cleric archetype when gained in this way are occult spells instead
      //  of divine spells… Your key spellcasting attribute for these spells is Charisma, rather than
      //  Wisdom."
      entryRetune: [{ scope: 'cleric-dedication-casting', tradition: 'occult', keyAbility: 'cha' }],
    },
  },
];

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];
for (const f of FIXES) {
  if (!core.feats[f.id]) {
    console.error(`${f.id} is not a feat in core.json — refusing to write.`);
    process.exit(1);
  }
  for (const [field, value] of Object.entries(f.fields)) {
    // Every item a record hands over must exist, or the grant silently delivers nothing.
    if (field === 'grantsItems') {
      const missing = value.filter((g) => !core.items[g.itemId]).map((g) => g.itemId);
      if (missing.length) {
        console.error(`${f.id}: item(s) ${missing.join(', ')} do not ship — refusing to write.`);
        process.exit(1);
      }
    }
    core.feats[f.id][field] = value;
    entries.push({ category: 'feats', id: f.id, field, value });
  }
  console.log(`${f.id}: ${Object.keys(f.fields).join(', ')}`);
}

/*
 * Extradimensional Stash: "You create a small extradimensional space somewhere within your clothing
 * that can hold up to 5 Bulk worth of objects. The space functions as a bag of holding, but can hold
 * only up to 5 Bulk, has no Bulk of its own…"
 *
 * The app models containers, so this is a container — but no container with those numbers ships, and
 * granting an ordinary bag of holding would give the wrong capacity and the wrong Bulk. The item is
 * created from the feat's own sentence: 5 Bulk capacity, 5 Bulk ignored (contents add nothing), 0
 * Bulk of its own. It is created, not authored: every number above is quoted.
 */
const STASH_FEAT = 'extradimensional-stash';
const STASH_ITEM = 'extradimensional-stash-space';
if (core.feats[STASH_FEAT] && !core.items[STASH_ITEM]) {
  const feat = core.feats[STASH_FEAT];
  const text = String(feat.description ?? '');
  if (!/up to 5 Bulk/.test(text) || !/no Bulk of its own/.test(text)) {
    console.error(`${STASH_FEAT}'s description no longer states "up to 5 Bulk" / "no Bulk of its own" — the item was NOT created.`);
  } else {
    core.items[STASH_ITEM] = {
      id: STASH_ITEM,
      name: 'Extradimensional Stash',
      level: feat.level ?? 1,
      bulk: 0,
      traits: ['extradimensional', 'magical'],
      rarity: 'common',
      itemType: 'container',
      capacity: { bulk: 5 },
      ignoredBulk: 5,
      price: {},
      description:
        'A small extradimensional space within your clothing, from the Extradimensional Stash feat. It holds up to 5 Bulk, has no Bulk of its own, and can be Interacted with using only one hand. When you Palm an Object you can place it directly inside, so long as there is room.',
      source: feat.source,
    };
    entries.push({ category: 'items', id: STASH_ITEM, create: true, value: core.items[STASH_ITEM] });
    feat.grantsItems = [{ itemId: STASH_ITEM }];
    entries.push({ category: 'feats', id: STASH_FEAT, field: 'grantsItems', value: feat.grantsItems });
    console.log(`${STASH_FEAT}: created the container item and granted it`);
  }
}

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`wrote ${entries.length} entries (backfill ${backfill.length} → ${next.length})`);
