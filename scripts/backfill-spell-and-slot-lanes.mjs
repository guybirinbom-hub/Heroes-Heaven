/*
 * Seven records the re-verification found FIXABLE, plus one over-grant bug.
 *
 * The blocker recorded against several of these — "no field expands what a caster may prepare or
 * learn" — was stale: `spellListAdditions` is declared on DefenseGrants, resolved by build.ts and
 * read by the sheet's spell picker. Nothing but data was missing.
 *
 * ⚠ THE BUG: Advanced Domain carries BOTH a `choice{kind:'domains'}` AND its 35-option
 * effectChoices. A cleric who answers both gets the INITIAL domain spell as well as the advanced
 * one — verified by building one: air gave pushing-gust AND disperse-into-air. Only the advanced
 * spell is the feat's. Domain Fluency is about to be given the same effectChoices, so it gets the
 * same treatment up front rather than inheriting the bug.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const rows = [];
const fail = (m) => {
  console.error(`REFUSING TO WRITE — ${m}`);
  process.exit(1);
};
const text = (cat, id) => {
  const r = core[cat]?.[id];
  if (!r) fail(`${cat}/${id} does not ship`);
  return String(r.description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
const put = (cat, id, field, value, must) => {
  const t = text(cat, id);
  for (const re of must ?? []) if (!re.test(t)) fail(`${cat}/${id} no longer matches ${re}\n  ${t.slice(0, 160)}`);
  core[cat][id][field] = value;
  rows.push({ category: cat, id, field, value });
  console.log(`  ${(cat + '/' + id).padEnd(38)} ${field}`);
};

/* ---- 1+2. Spell-list widening. Every named spell is verified to ship. ------------------------- */
const listAdd = (id, names, must) => {
  // Apostrophes are DROPPED, not turned into separators: "Loose Time's Arrow" is loose-times-arrow.
  const ids = names.map((n) =>
    n.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  );
  const missing = ids.filter((s) => !core.spells[s]);
  if (missing.length) fail(`${id} names spells that do not ship: ${missing.join(', ')}`);
  // A grant pointing at a missing spell is worse than none — the sheet shows a row that opens nothing.
  put('feats', id, 'spellListAdditions', { spells: ids }, must);
};
listAdd(
  'future-spell-learning',
  ['Behold the Weave', "Cast into Time", 'Haste', "Loose Time's Arrow", 'Quicken Time', 'Slow', 'Stagnate Time'],
  [/Add .* to your spell list/i],
);
listAdd(
  'sacred-spells',
  ['Void Warp', 'Death Ward', 'Vitality Lash', 'Infuse Vitality', 'Holy Cascade', 'Magic Stone', 'Sunburst'],
  [/Add .* to your spell list/i],
);
// sacred-spells' own sub-benefit picker ships in core.json with NO overlay row, so it dies at the
// next rebuild. Re-author it here so the pick survives.
{
  const ch = core.feats['sacred-spells'].choice;
  if (!ch) fail('sacred-spells lost its benefit picker');
  rows.push({ category: 'feats', id: 'sacred-spells', field: 'choice', value: ch });
  console.log(`  ${'feats/sacred-spells'.padEnd(38)} choice (re-authored so it survives npm run data)`);
}

/* ---- 3. THE BUG: Advanced Domain grants the initial spell as well as the advanced one --------- */
{
  const ad = core.feats['advanced-domain'];
  if (!ad?.effectChoices?.length) fail('advanced-domain no longer carries its advanced-spell picker');
  if (!ad.choice) {
    console.log('  advanced-domain: choice already removed — nothing to do');
  } else {
    if (ad.choice.kind !== 'domains') fail(`advanced-domain's choice is kind ${ad.choice.kind}, not the domains picker this removes`);
    put('feats', 'advanced-domain', 'choice', null, [/advanced domain spell/i]);
  }
}

/* ---- 4. Domain Fluency: the same advanced-spell picker, and no initial-spell picker ----------- */
{
  const src = core.feats['advanced-domain'].effectChoices;
  if (!src?.[0]?.options?.length) fail('cannot copy the advanced-domain picker — it has no options');
  const block = [
    {
      ...src[0],
      id: 'domain-fluency',
      prompt: 'Choose a domain of your mystery — you gain its ADVANCED domain spell',
    },
  ];
  put('feats', 'domain-fluency', 'effectChoices', block, [/advanced domain spell/i]);
  // Its own kind:'domains' picker would grant the INITIAL spell too — the same double-grant.
  put('feats', 'domain-fluency', 'choice', null, [/advanced domain spell/i]);
}

/* ---- 5. Captivating Intensity ---------------------------------------------------------------- */
put(
  'feats',
  'captivating-intensity',
  'spellSlotBonus',
  { perRank: 1, exceptHighest: 2, entryId: 'captivator-dedication-casting' },
  [/captivator/i],
);

/* ---- 6. Conscious Spell Specialization ------------------------------------------------------- */
{
  const t = text('feats', 'conscious-spell-specialization');
  const m = t.match(/additional spell slot of ([^.]*?) ranks/i);
  if (!m) fail('conscious-spell-specialization no longer lists its ranks');
  const ranks = [...m[1].matchAll(/(\d+)(?:st|nd|rd|th)/g)].map((x) => Number(x[1]));
  if (!ranks.length) fail(`could not read ranks from "${m[1]}"`);
  // "At 18th level, you also gain an additional 5th-rank spell slot" — note BOTH "an" and
  // "additional" sit between the verb and the rank.
  const later = t.match(/At (\d+)(?:st|nd|rd|th) level,? you (?:also )?gain (?:an?\s+)?(?:additional\s+)?(\d+)(?:st|nd|rd|th)[- ]rank/i);
  if (/At \d+(?:st|nd|rd|th) level/i.test(t) && !later) fail('conscious-spell-specialization has a level clause the parser did not read — do not silently drop it');
  const value = { byRank: Object.fromEntries(ranks.map((r) => [r, 1])) };
  // "At 18th level, you also gain a 5th-rank slot" — a rank that arrives four levels after the feat.
  if (later) value.byRankAt = [{ level: Number(later[1]), byRank: { [Number(later[2])]: 1 } }];
  put('feats', 'conscious-spell-specialization', 'spellSlotBonus', value);
  // The slots are usable ONLY for conscious-mind spells. There is no field for a slot restriction,
  // and inventing one that nothing reads is how a fix becomes a lie — so the player is TOLD instead.
  put('feats', 'conscious-spell-specialization', 'dataWarning', 'These extra slots may only cast spells granted by your conscious mind — the app does not restrict them.');
}

/* ---- 7. Draconic Paragon --------------------------------------------------------------------- */
put('feats', 'draconic-paragon', 'unarmedTraits', { match: ['jaw', 'claw', 'tail'], add: ['deadly-d6'] }, [/deadly/i]);

/* ---- write ----------------------------------------------------------------------------------- */
writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(rows.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...rows];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`\nwired ${rows.length} rows (backfill ${backfill.length} → ${next.length})`);
