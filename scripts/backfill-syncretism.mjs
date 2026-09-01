/*
 * SYNCRETISM APPLIED NOTHING, AND SAID SO (feats/syncretism).
 *
 * *"Choose a second deity… IF YOU ARE A CLOISTERED CLERIC, select one of that deity's domains, gaining
 * the benefits of the Expanded Domain Initiate feat with that domain. IF YOU ARE A WARPRIEST, you gain
 * the favored weapon of that deity as a second favored weapon."* (Gods & Magic, feat-1186.)
 *
 * The record carried only a free-text "Second deity" marked `inert`: "Recorded only — the second
 * deity's domain (cloistered cleric) or second favored weapon (warpriest) isn't applied." Nothing in
 * src/ read it. Both printed branches produce a stat the sheet shows, and the app produced neither.
 *
 * WHY IT COULD NOT BE AUTHORED BEFORE: both branches are gated on the character's DOCTRINE, and the
 * only feature gate in the grant vocabulary was `FeatGrant.skillsIfFeature`, which gates SKILLS. An
 * ungated authoring would hand a warpriest a free domain focus spell (and a Focus Point) or hand a
 * cloistered cleric a weapon proficiency — a wrong answer wearing the costume of a modelled one, which
 * is worse than the honest inert. `EffectChoice.requiresFeature` is that gate, and
 * `EffectChoice.openFrom` is what lets the weapon branch offer weapons without printing 400 of them
 * into the record.
 *
 * PARITY: their feat 29663 is four conditionals on FEAT_NAMES. Cloistered → a "Select a Domain Spell"
 * pick over rank-1 focus spells with the Domain trait. Warpriest → a "Select Deity's Favored Weapon"
 * pick over the WEAPON group at trained, expert at 7th, master at 19th. Both branches here ask the
 * same two questions of the same two doctrines. The second weapon rides the shared favored-weapon
 * ladder in build.ts rather than a flat rank, which is what *"as a SECOND FAVORED WEAPON"* means and
 * reproduces their 7th/19th steps without restating them.
 *
 * ⚠ Neither side narrows the menu to the chosen deity's own domains or weapon — theirs offers every
 * rank-1 domain spell and every weapon, and the second deity is free text on our side, so it could not
 * narrow even if we wanted it to. Filtering a selection menu is the owner's delegated call, and this
 * matches them.
 *
 *   node scripts/backfill-syncretism.mjs [--write]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const rec = core.feats?.syncretism;
if (!rec) { console.error('feats/syncretism is missing'); process.exit(2); }

for (const f of ['cloistered-cleric', 'warpriest']) {
  if (!core.classFeatures?.[f]) { console.error(`classFeatures/${f} is missing — the gate would never fire`); process.exit(2); }
}

/* The cloistered branch is *"the benefits of the Expanded Domain Initiate feat with that domain"*, so
 * it offers exactly that feat's own menu — read from the record rather than retyped, which keeps the
 * two in step as the domain list grows and makes a drift impossible to introduce silently. */
const donor = core.feats?.['expanded-domain-initiate']?.effectChoices?.[0];
if (!donor?.options?.length) { console.error('expanded-domain-initiate has no domain picker to borrow'); process.exit(2); }
const withSpell = donor.options.filter((o) => (o.grant?.focusSpells ?? []).some((s) => core.spells?.[s]));
if (withSpell.length !== donor.options.length) {
  console.log(`note: ${donor.options.length - withSpell.length} donor option(s) name a spell that is not in the data — dropped.`);
}

const domainChoice = {
  id: 'domain',
  prompt: "Second deity's domain — you gain that domain's initial domain spell and its Focus Point (cloistered cleric)",
  requiresFeature: 'cloistered-cleric',
  options: withSpell.map((o) => ({ value: o.value, label: o.label, grant: { focusSpells: [...o.grant.focusSpells] } })),
};

const weaponChoice = {
  id: 'favored-weapon',
  /* ⚠ The id is load-bearing: build.ts reads `effectChoices['syncretism:favored-weapon']` when it
   * builds the favored-weapon overrides. Renaming it here silently unhooks the whole branch. */
  prompt: "Second deity's favored weapon — you gain it as a second favored weapon (warpriest)",
  requiresFeature: 'warpriest',
  openFrom: { type: 'weapon' },
};

const rows = [
  { category: 'feats', id: 'syncretism', field: 'effectChoices', value: [domainChoice, weaponChoice] },
  /* The `inert` marker was the truth and is now false. The rest of the choice stays: the deity itself
   * is a real printed decision ("you are subject to their edicts and anathema") that no stat carries,
   * and their side does not ask it at all. */
  {
    category: 'feats',
    id: 'syncretism',
    field: 'choice',
    value: {
      flag: 'secondDeity',
      prompt: 'Second deity',
      kind: 'text',
      note: "You're subject to this deity's edicts and anathema. Your doctrine's benefit — a domain spell or a second favored weapon — is chosen below.",
    },
  },
];

console.log(`domain options: ${domainChoice.options.length} (gated to cloistered-cleric)`);
console.log(`weapon pick: open weapon list (gated to warpriest)`);
console.log(`clearing the inert marker: ${rec.choice?.inert ?? '(none)'}`);
if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }

const all = readBackfill(ROOT);
for (const r of rows) {
  const at = all.findIndex((x) => x.category === r.category && x.id === r.id && x.field === r.field);
  if (at >= 0) all[at] = r; else all.push(r);
}
writeBackfill(ROOT, all);
console.log(`wrote (${all.length} rows).`);
