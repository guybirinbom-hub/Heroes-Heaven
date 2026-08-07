/*
 * ANCESTRY, BACKGROUND and DEITY, app vs the AoN mirror.
 *
 * Everything here lands on every character that picks it and is never recomputed: an ancestry's HP,
 * size, speed and attribute boosts set the starting sheet; a background's boosts, trained skill and
 * granted feat set the rest of level 1; a deity's domains, divine font, favoured weapon and skill are
 * what a cleric or champion is built out of.
 *
 * Guards are the same three as scripts/field-diff.mjs — see its header. Where a value cannot be
 * settled the row is HELD and reported, never guessed.
 *
 *   node scripts/identity-check.mjs          # summary + unexplained
 *   node scripts/identity-check.mjs --all    # also list what a guard is holding back
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const db = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const showAll = process.argv.includes('--all');

const norm = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const set = (a) => [...new Set((Array.isArray(a) ? a : a == null ? [] : [a]).map(norm).filter(Boolean))].sort();

const load = (dir) => {
  const byName = new Map();
  let files;
  try { files = readdirSync(join(MIRROR, dir)); } catch { return byName; }
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(MIRROR, dir, f), 'utf8'));
    if (!j.name) continue;
    const k = norm(j.name);
    const list = byName.get(k);
    if (list) list.push(j);
    else byName.set(k, [j]);
  }
  return byName;
};
/**
 * One mirror record, or null when the candidates disagree on the field being read.
 *
 * ⚠ The remaster half is preferred FIRST, not only as a tiebreak. Orc's HP, size and speed are the
 * same in both printings, so a resolver keyed on those picks whichever came first — and the legacy
 * Advanced Player's Guide Orc has Strength + free where the remaster has two free boosts.
 */
const resolve = (rec, list, field) => {
  const val = (m) => JSON.stringify(field(m));
  const remaster = list.filter((m) => !m.remaster_id);
  const pool = remaster.length ? remaster : list;
  if (new Set(pool.map(val)).size === 1) return pool[0];
  return null;
};

/**
 * Backgrounds where the MIRROR's structured field is wrong and the app matches the printed text.
 * An entry here is a claim against the mirror, so it carries its evidence.
 */
const ACCEPTED_BACKGROUND = {
  'almas-clerk': 'prints "You gain the Glean Contents skill feat"; the `feat` field says Crafter\'s Appraisal',
  'verduran-city-folk': 'prints "either Multilingual or Streetwise" — a free pick, not one keyed to a skill, so it is not a grantedFeatByChoice',
  'anti-thrune-saboteur':
    'prints both halves ("If you chose Deception … Lengthy Diversion. If you chose Thievery … Dirty Trick") and the app already keys both; the `feat` field lists only the first',
};

let compared = 0;
const held = [];
const bad = [];
const note = (coll, id, field, have, want) => bad.push({ coll, id, field, have, want });

/* ---- ancestries: HP, size, speed, boosts, flaw ------------------------------------------- */
{
  const byName = load('ancestry');
  const ABBR = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha', free: 'free' };
  for (const [id, rec] of Object.entries(db.ancestries ?? {})) {
    if (!rec?.name) continue;
    const list = byName.get(norm(rec.name)) ?? [];
    if (!list.length) continue;
    compared++;
    const m = resolve(rec, list, (x) => [x.hp, x.size, x.speed]);
    if (!m) {
      held.push(`ancestries/${id}: the mirror records under this name disagree`);
      continue;
    }
    if (typeof m.hp === 'number' && typeof rec.hp === 'number' && m.hp !== rec.hp) note('ancestries', id, 'hp', rec.hp, m.hp);
    // The mirror's `size` is a LIST of the sizes an ancestry may choose from — Fleshwarp reads
    // "Medium Small", Awakened Animal "Tiny Small Medium Large". Only a single value is a claim.
    const wantSize = norm(m.size);
    if (wantSize && !wantSize.includes(' ') && rec.size && wantSize !== norm(rec.size)) {
      note('ancestries', id, 'size', rec.size, wantSize);
    }
    // The mirror's `speed` is an object keyed by movement type; land speed is what an ancestry sets.
    const land = typeof m.speed === 'object' ? (m.speed.Land ?? m.speed.land) : m.speed;
    if (typeof land === 'number' && typeof rec.speed === 'number' && land !== rec.speed) note('ancestries', id, 'speed', rec.speed, land);
    // Boosts and flaw, as sets — the order they are printed in is not meaningful.
    // A boost entry that is not an attribute name is prose the mirror could not structure — Human
    // reads "two free ability boosts". Only a list of real attributes is comparable.
    // Compared as a sorted LIST, not a set: an ancestry with two free boosts (Human, Orc) has "free"
    // twice, and deduplicating it reported both as having one.
    const rawBoosts = (m.attribute ?? []).map((a) => ABBR[norm(a)] ?? norm(a));
    const wantBoosts = rawBoosts.every((b) => /^(str|dex|con|int|wis|cha|free)$/.test(b)) ? [...rawBoosts].sort() : [];
    const haveBoosts = (rec.abilityBoosts ?? []).map((b) => (b.kind === 'free' ? 'free' : b.ability)).sort();
    if (wantBoosts.length && haveBoosts.length && JSON.stringify(wantBoosts) !== JSON.stringify(haveBoosts)) {
      note('ancestries', id, 'boosts', haveBoosts, wantBoosts);
    }
    const wantFlaw = set((m.attribute_flaw ?? []).map((a) => ABBR[norm(a)] ?? norm(a)));
    const haveFlaw = set((rec.abilityFlaws ?? []).map((b) => b.ability ?? b));
    if ((wantFlaw.length || haveFlaw.length) && JSON.stringify(wantFlaw) !== JSON.stringify(haveFlaw)) {
      note('ancestries', id, 'flaw', haveFlaw, wantFlaw);
    }
  }
}

/* ---- backgrounds: trained skill and granted feat ------------------------------------------ */
{
  const byName = load('background');
  for (const [id, rec] of Object.entries(db.backgrounds ?? {})) {
    if (!rec?.name) continue;
    const list = byName.get(norm(rec.name)) ?? [];
    if (!list.length) continue;
    compared++;
    const m = resolve(rec, list, (x) => [x.skill, x.feat]);
    if (!m) {
      held.push(`backgrounds/${id}: the mirror records under this name disagree`);
      continue;
    }
    /*
     * Read from the PRINTED text, not the structured fields. Two backgrounds prove the fields are
     * not reliable here: Alma's Clerk grants Glean Contents and its `feat` field says "Society"
     * (which is the skill), and Gold Falls Regular trains Performance while its `skill` field says
     * Acrobatics. In both the app already matches what the book prints.
     */
    const t = String(m.text ?? '').replace(/\s+/g, ' ');
    const skillM = /trained in the ([A-Za-z]+) skill/i.exec(t);
    const haveSkill = rec.trainedSkill ? norm(rec.trainedSkill) : null;
    if (skillM && haveSkill && norm(skillM[1]) !== haveSkill) {
      note('backgrounds', id, 'trainedSkill', haveSkill, norm(skillM[1]));
    }
    /*
     * The granted feat comes from the FIELD, compared as a set.
     *
     * A regex over the printed text cannot do this job: several backgrounds grant TWO feats ("the Pet
     * general feat and the Train Animal skill feat"), the category word sits between the name and
     * "feat" so a lazy match turns Assurance into "Assurance general", and some descriptions mention
     * other feats further down. All ten differences it produced were the regex, not the data.
     */
    if (ACCEPTED_BACKGROUND[id]) continue;
    const wantFeats = set(m.feat);
    // A background whose grant depends on the trained skill lists BOTH feats — the app holds them in
    // `grantedFeatByChoice`, keyed by skill, so both have to be counted or every one looks half done.
    const haveFeats = set(
      [rec.grantedFeatId, ...Object.values(rec.grantedFeatByChoice ?? {})]
        .flat()
        .filter(Boolean)
        .map((f) => String(f).replace(/-/g, ' ')),
    );
    if (wantFeats.length && haveFeats.length && JSON.stringify(wantFeats) !== JSON.stringify(haveFeats)) {
      note('backgrounds', id, 'grantedFeat', haveFeats, wantFeats);
    }
  }
}

/* ---- deities: divine font, favoured weapon, skill, domains -------------------------------- */
{
  const byName = load('deity');
  for (const [id, rec] of Object.entries(db.deities ?? {})) {
    if (!rec?.name) continue;
    const list = byName.get(norm(rec.name)) ?? [];
    if (!list.length) continue;
    compared++;
    const m = resolve(rec, list, (x) => [x.divine_font, x.favored_weapon, x.domain]);
    if (!m) {
      held.push(`deities/${id}: the mirror records under this name disagree`);
      continue;
    }
    const wantFont = set(m.divine_font).filter((f) => f === 'heal' || f === 'harm');
    const haveFont = set(rec.divineFont);
    if (wantFont.length && haveFont.length && JSON.stringify(wantFont) !== JSON.stringify(haveFont)) {
      note('deities', id, 'divineFont', haveFont, wantFont);
    }
    const wantWeapon = set(m.favored_weapon);
    const haveWeapon = set(rec.favoredWeapon);
    if (wantWeapon.length && haveWeapon.length && JSON.stringify(wantWeapon) !== JSON.stringify(haveWeapon)) {
      note('deities', id, 'favoredWeapon', haveWeapon, wantWeapon);
    }
    const wantSkill = set(m.skill);
    const haveSkill = set(rec.divineSkill ?? rec.skill);
    if (wantSkill.length === 1 && haveSkill.length === 1 && wantSkill[0] !== haveSkill[0]) {
      note('deities', id, 'divineSkill', haveSkill[0], wantSkill[0]);
    }
    /*
     * The Remaster renamed three domains, and 48 deity records still carry the Gods & Magic
     * spellings. Both are mapped in DOMAIN_SPELLS so either works, and rewriting the records would
     * break a character who already picked one — so the comparison normalises instead.
     */
    const DOMAIN_ALIAS = { wyrmkin: 'dragon', void: 'nothingness', delirium: 'disorientation' };
    const dom = (a) => set(a).map((d) => DOMAIN_ALIAS[d] ?? d).sort();
    const wantDomains = dom(m.domain_primary ?? m.domain);
    const haveDomains = dom(rec.domains);
    if (wantDomains.length && haveDomains.length && JSON.stringify(wantDomains) !== JSON.stringify(haveDomains)) {
      note('deities', id, 'domains', haveDomains, wantDomains);
    }
  }
}

console.log(`ancestries + backgrounds + deities compared: ${compared}`);
console.log(`accepted disagreements (the mirror is wrong): ${Object.keys(ACCEPTED_BACKGROUND).length}`);
for (const [k, why] of Object.entries(ACCEPTED_BACKGROUND)) console.log(`   backgrounds/${k} — ${why}`);
console.log(`held back by a guard:                       ${held.length}`);
if (showAll) for (const h of held) console.log(`   ${h}`);
const byField = {};
for (const b of bad) byField[`${b.coll}.${b.field}`] = (byField[`${b.coll}.${b.field}`] ?? 0) + 1;
console.log(`\nUNEXPLAINED: ${bad.length}`);
for (const [k, n] of Object.entries(byField).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(28)} ${n}`);
for (const b of bad.slice(0, 40)) {
  console.log(`   ${b.field.padEnd(14)} ${b.coll}/${b.id.padEnd(28)} app ${JSON.stringify(b.have)} -> mirror ${JSON.stringify(b.want)}`);
}
if (bad.length > 40) console.log(`   …and ${bad.length - 40} more`);
if (bad.length) process.exitCode = 1;
