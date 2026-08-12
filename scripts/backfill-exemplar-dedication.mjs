/*
 * Exemplar Dedication — remove the phantom question, and build the feat's real content.
 *
 * Gold set, round 5, the owner's own words: *"Its two-option 'ability score' picker is the
 * PREREQUISITE ('Strength +2 or Dexterity +2') rendered as a choice. **Delete the picker.** The
 * mangled prompt `Class DCAbility Score` is import damage; the feat's real unbuilt content is
 * *trained in martial weapons* and *one ikon with its immanence and transcendence actions*."*
 *
 * ⚠ The str/dex answer was not merely unread — it is UNREADABLE. `classDcGrant` derives a borrowed
 * class DC's key attribute from the class itself, taking the higher modifier when the class allows
 * either (build.ts, `secondaryClassDcs`). Exemplar's key attribute is exactly ["dex","str"], so the
 * picker asked a question the engine already answers, and answering it differently would have made
 * the character's own class DC worse. That is asserted below rather than assumed.
 *
 * The `choice` field is REPLACED rather than deleted, which is the same one row: the phantom question
 * is gone and the slot now carries the question the feat actually asks — which of the 21 ikons you
 * gain. `ownsFeature` is what makes the answer real: every ikon option id is also a classFeature id,
 * so owning it brings the ikon's immanence text, its situational bonuses, and the transcendence action
 * it grants (gleaming-blade → flowing-spirit-strike) with no further plumbing.
 *
 * Not written here, because they are already built and were measured before this ran:
 *   - "You become trained in martial weapons" — featGrantsAuto.ts already carries
 *     `'exemplar-dedication': { weapon: { martial: 'trained' } }`; a wizard taking it comes back
 *     martial-trained.
 *   - "and the Shift Immanence action" — the record's own `grantsClassFeatures: ["shift-immanence"]`
 *     already puts it in `ownedFeatureIds`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const CORE = ROOT + 'public/core.json';
const DESC = ROOT + 'public/core-descriptions.json';
const BF = ROOT + 'scripts/data/effect-backfill.json';

const db = JSON.parse(readFileSync(CORE, 'utf8'));
const desc = JSON.parse(readFileSync(DESC, 'utf8'));
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

const FEAT = 'exemplar-dedication';
const rec = db.feats[FEAT];
if (!rec) fail(`${FEAT} is not in core.json`);
if (rec.archetype !== 'exemplar') fail(`${FEAT} no longer carries the exemplar archetype`);

/* -- the phantom picker is the one the ruling describes, not some later replacement ------------- */
// Guarded so a re-run after the fix does not silently re-derive from whatever is there now: the row
// is only authored while the record still holds the import's two-option attribute question, or
// already holds the ikon question this script writes.
const cur = rec.choice;
const isPhantom =
  cur?.prompt === 'Class DCAbility Score' &&
  cur.kind === 'array' &&
  (cur.options ?? []).map((o) => o.value).sort().join(',') === 'dex,str';
const isAlreadyOurs = cur?.flag === 'ikon' && cur.ownsFeature === true;
if (cur && !isPhantom && !isAlreadyOurs) fail(`${FEAT}.choice is neither the phantom attribute picker nor this script's ikon picker — read it before overwriting`);

/* -- the class DC question the engine already answers ------------------------------------------- */
const cls = db.classes.exemplar;
if (!cls) fail('classes.exemplar is missing — classDcGrant would resolve to nothing');
const kas = Array.isArray(cls.keyAbility) ? cls.keyAbility : [cls.keyAbility];
if ([...kas].sort().join(',') !== 'dex,str') {
  fail(`exemplar keyAbility is ${JSON.stringify(kas)}; the ruling rests on it being the same Str/Dex pair the picker asked about`);
}

/* -- the sentences these rows implement, quoted from the record itself -------------------------- */
const text = desc.feats?.[FEAT]?.d ?? '';
for (const quote of [
  'You become trained in martial weapons.',
  'You gain one ikon, the ability to use the ikon\u2019s immanence and transcendence actions',
  'You become trained in exemplar class DC.',
]) {
  const norm = (s) => s.replace(/[\u2019']/g, "'").toLowerCase();
  if (!norm(text).includes(norm(quote))) fail(`${FEAT}'s description no longer contains "${quote}"`);
}

/* -- the ikon list, taken from the exemplar's own pick group ------------------------------------ */
// Read from the class rather than transcribed, so the dedication offers exactly what an exemplar of
// the same level may pick and cannot drift from it. The `ikon` bucket holds the same 21 ids but no
// names, and a hand-copied list is one import away from being wrong.
const group = (cls.extraChoices ?? []).find((g) => g.id === 'ikon');
if (!group?.options?.length) fail('the exemplar class has no `ikon` extraChoices group to read the list from');
for (const o of group.options) {
  // `ownsFeature` resolves the ANSWER to a classFeature. An option whose value is not one would be
  // recorded and then own nothing — the exact failure this whole change is fixing.
  if (!db.classFeatures[o.id]) fail(`ikon "${o.id}" is not a classFeature — ownsFeature could not resolve it`);
  if (!db.classFeatures[o.id].traits?.includes('ikon')) fail(`classFeature "${o.id}" does not carry the ikon trait`);
}

const choice = {
  flag: 'ikon',
  prompt: 'Ikon',
  kind: 'array',
  ownsFeature: true,
  options: group.options.map((o) => ({ value: o.id, label: o.name })),
};

/* -------------------------------------------------------------------------------- writes ------ */
const write = (field, value) => {
  const i = rows.findIndex((r) => r.category === 'feats' && r.id === FEAT && r.field === field && !r.path);
  const row = { category: 'feats', id: FEAT, field, value };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
  db.feats[FEAT][field] = value;
};

write('choice', choice);
write('classDcGrant', { classId: 'exemplar' });

writeFileSync(BF, formatBackfill(rows));
writeFileSync(CORE, JSON.stringify(db));
console.log(
  `${FEAT}: phantom "${cur?.prompt ?? '(none)'}" picker replaced with an ${choice.options.length}-ikon choice; ` +
    'trained exemplar class DC granted\n' +
    `written: ${BF}, ${CORE}`,
);
