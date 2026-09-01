/*
 * IDENTITY COMPARISON — the third bucket, and the last one nobody was looking at.
 *
 * `wg-diff.mjs` compares KINDS ("do they model a granted record at all"). `wg-values.mjs` compares
 * NUMBERS and SETS. Neither compares WHICH THING. If their record grants Courtly Graces and ours grants
 * Assurance, both sides report `grantsRecord`, both agree on every number, and the two are not the same
 * feat. That is precisely the failure the owner's rule is about, and it has been invisible.
 *
 * Compared here:
 *   giveAbilityBlock -> their ability_block NAME   vs   our grantsFeats / FEAT_FEAT_GRANTS / grantsFeat
 *   giveSpell        -> their spell NAME           vs   our innateSpells / focusSpells / spellListAdditions
 *   giveItem         -> their item NAME            vs   our grantsItems / grantedStrikes
 *   select(options)  -> their predefined labels    vs   our choice.options / effectChoices options
 *
 * ⚠ A SCREEN, NOT A VERDICT, like its two siblings. Names are matched loosely (case, punctuation and
 * a leading article are ignored) because the two sides spell things differently, and a miss is printed
 * for reading rather than acted on. It exists to make "which thing" finite.
 *
 *   node scripts/wg-identity.mjs --batch work/wg-batch-003.json
 *   node scripts/wg-identity.mjs --ids gildedsoul,beast-trainer --verbose
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCopyBlock, parseOps, flattenOps, wgRecord, wgRowsByBucket, wgOwnsComparison } from './lib/wg-parse.mjs';

/* `--raw` bypasses the settle registries so `wg-settle-stale.mjs` can see which of them still
 * answer a real difference. A settle that matches nothing is a trap: it will silence the NEXT
 * difference of that kind on that record, unread. */
const RAW_SETTLES = process.argv.includes('--raw');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const VERBOSE = process.argv.includes('--verbose');

const DUMP = join(ROOT, 'work/wg/wg-data.sql');
if (!existsSync(DUMP)) {
  console.error('No dump at work/wg/wg-data.sql — gitignored on purpose (GPL-3.0; differ only).');
  process.exit(2);
}
const sql = readFileSync(DUMP, 'utf8');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

/** Loose name key: case, punctuation, spacing and a leading article all ignored. */
/** The ORIGINAL spelling behind each squashed key, so the word-set comparison has words to work with. */
const tokenSource = new Map();

const key = (s) => {
  const raw = String(s ?? '').toLowerCase().replace(/^(the|a|an)\s+/, '');
  const k = raw.replace(/[^a-z0-9]+/g, '');
  if (k && !tokenSource.has(k)) tokenSource.set(k, raw);
  return k;
};

const abRows = parseCopyBlock(sql, 'ability_block').rows;
const abById = new Map(abRows.map((r) => [String(r.id), r]));
const itemById = new Map(parseCopyBlock(sql, 'item').rows.map((r) => [String(r.id), r]));
const spellById = new Map(parseCopyBlock(sql, 'spell').rows.map((r) => [String(r.id), r]));

/* Our id -> name, across every bucket, so a granted id can be named for comparison. */
const nameOfId = new Map();
for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object') continue;
  for (const [id, rec] of Object.entries(recs)) if (rec?.name) nameOfId.set(`${bucket}/${id}`, rec.name);
}
const anyName = (id) => {
  for (const b of ['feats', 'classFeatures', 'heritages', 'spells', 'items', 'actions']) {
    if (core[b]?.[id]?.name) return core[b][id].name;
  }
  return id;   // fall back to the id itself — a kebab id keys the same as its name in most cases
};

/* ---------------------------------------------------------------- their side */
function theirIdentities(row) {
  const out = { grants: new Set(), spells: new Set(), items: new Set(), options: new Set() };
  for (const op of parseOps(row.operations).flatMap((o) => flattenOps(o))) {
    const d = op?.data ?? {};
    if (op?.type === 'giveAbilityBlock') {
      const t = abById.get(String(d.abilityBlockId));
      /* SENSE and MODE blocks are not granted RECORDS on our side — they are a `senses` field and the
       * modes registry — so comparing them by name would report a miss on every darkvision feat. */
      if (t && !['sense', 'mode'].includes(t.type)) out.grants.add(key(t.name));
    } else if (op?.type === 'giveSpell') {
      const s = spellById.get(String(d.spellId ?? d.spell_id ?? d.spellID));
      if (s?.name) out.spells.add(key(s.name));
    } else if (op?.type === 'giveItem') {
      const it = itemById.get(String(d.itemId));
      if (it?.name) out.items.add(key(it.name));
    } else if (op?.type === 'select') {
      for (const o of d.optionsPredefined ?? []) {
        const label = o.title ?? o.name ?? o.operation?.data?.variable;
        if (label) out.options.add(key(label));
      }
    }
  }
  return out;
}

/** The seventeen a `kind: 'skills'` picker offers, including the Lore catch-all their list names. */
const SKILL_NAMES = ['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
  'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth',
  'survival', 'thievery', 'lore'];

/* ---------------------------------------------------------------- our side */
/** Which class lists each feature — the key to crediting a class-chassis mechanic to its carrier. */
const classOfFeature = new Map();
for (const [cid, cls] of Object.entries(core.classes ?? {})) {
  for (const f of cls.features ?? []) if (!classOfFeature.has(f.featureId)) classOfFeature.set(f.featureId, cid);
}

const featFeatText = readFileSync(join(ROOT, 'src/rules/featFeatGrants.ts'), 'utf8');
const cantripText = readFileSync(join(ROOT, 'src/rules/featCantripGrants.ts'), 'utf8');
const pickText = readFileSync(join(ROOT, 'src/rules/featPickGrants.ts'), 'utf8');

const modesText = readFileSync(join(ROOT, 'src/rules/modes.ts'), 'utf8');

/**
 * Every MODE that belongs to one record, from BOTH carriers.
 *
 * A mode reaches the app two ways and only one of them is in core.json:
 *   · `scripts/data/consumable-modes.json` — keyed `fromItemId`; merged into core.modes by the importer.
 *   · `src/rules/modes.ts` RAW_MODES        — gated on `feats: [...]`; merged at RUNTIME by
 *                                             src/data/index.ts, so it is NOT in core.json at all.
 *
 * Reading only the baked modes reported "they grant two attacks, we grant none" on Howling Aspect the
 * moment it was correctly authored, which is this project's most repeated instrument bug in its purest
 * form: a predicate that knows one storage location reads every other one as absent. The catalog is
 * scanned as source text, the same way this file already scans the grant registries.
 */
function modeDefsFor(id) {
  const out = [];
  for (const m of Object.values(core.modes ?? {})) {
    if (!m || typeof m !== 'object') continue;
    if (m.fromItemId === id || (m.feats ?? []).includes(id)) out.push(m);
  }
  /* The code catalog. Find each entry naming this feat in its gate, then take the strike names from
   * that entry's own `grantedStrikes` — bounded to the entry so a later mode's strikes cannot leak in. */
  const gate = new RegExp(`feats:\\s*\\[[^\\]]*['"]${id}['"]`, 'g');
  for (const m of modesText.matchAll(gate)) {
    const start = modesText.lastIndexOf('\n  {', m.index);
    /*
     * ⚠ Bounded by whichever comes FIRST: this entry's closing brace, or the START of the next entry.
     * A ONE-LINE mode (`{ id: 'cat-sentinel-form', feats: [...], modifiers: [], note: '…' },`) has no
     * `\n  }` of its own, so looking only for that walked into the NEXT multi-line mode and harvested
     * its `grantedStrikes`. Starlit Sentinel was credited with the ursine avenger's jaws and claws —
     * a comparer inventing a grant is worse than one missing it, because it hides a real gap.
     */
    const brace = modesText.indexOf('\n  }', m.index);
    const nextEntry = modesText.indexOf('\n  {', m.index);
    const ends = [brace, nextEntry].filter((n) => n >= 0);
    if (start < 0 || !ends.length) continue;
    const body = modesText.slice(start, Math.min(...ends));
    const gs = /grantedStrikes:\s*\[([\s\S]*?)\n    \]/.exec(body);
    if (!gs) continue;
    out.push({ grantedStrikes: [...gs[1].matchAll(/name:\s*['"]([^'"]+)['"]/g)].map((x) => ({ name: x[1] })) });
  }
  return out;
}

/**
 * Every id named on EVERY entry for `id` across a registry file.
 *
 * ⚠ ALL occurrences, not the first. One file holds several tables keyed by the same record: Quah Bond
 * is in `FEAT_GRANT_BOUND_CHOICE` (how to ANSWER its granted Assurance) and again in `FEAT_FEAT_GRANTS`
 * (that it grants Assurance at all). Stopping at the first match read the binding and reported the
 * grant as missing — on a record that grants exactly what they grant.
 */
function registryIds(text, id) {
  const re = new RegExp(`^\\s{2}(?:['"]${id}['"]|${id})\\s*:\\s*`, 'gm');
  const out = [];
  for (const m of text.matchAll(re)) {
    const rest = text.slice(m.index + m[0].length);
    const end = /\n\s{2}(?:['"][a-z0-9-]+['"]|[a-z][a-zA-Z0-9]*)\s*:/.exec(rest);
    const body = rest.slice(0, end ? end.index : rest.length);
    for (const x of body.matchAll(/['"]([a-z][a-z0-9-]{2,})['"]/g)) out.push(x[1]);
  }
  return out;
}

function ourIdentities(id, rec) {
  const out = { grants: new Set(), spells: new Set(), items: new Set(), options: new Set() };
  const addGrant = (x) => x && out.grants.add(key(anyName(x)));
  const addSpell = (x) => x && out.spells.add(key(anyName(x)));

  for (const g of rec.grantsFeats ?? []) addGrant(g);
  for (const g of rec.grantsClassFeatures ?? []) addGrant(g);
  /* A `derivedGrant` hands over exactly the records its relation can reach — the thaumaturge
   * implement benefit (prefix/suffix), the gunslinger way's initial deed (map). Their side spells the
   * same thing as conditionals wrapping giveAbilityBlock, one per answer, so every reachable target
   * counts as granted here or a record delivering all six deeds read as granting nothing. */
  if (rec.derivedGrant?.map) for (const g of Object.values(rec.derivedGrant.map)) addGrant(g);
  /* An ACTION is a granted record too. Brinesoul's whole content is *"You gain the Salt Wound
   * reaction"*, shipped as `grantsActions: ['salt-wound']`, and reading only the feat/feature fields
   * reported it as granting nothing against their `giveAbilityBlock → Salt Wound`. */
  for (const g of rec.grantsActions ?? []) addGrant(g);
  /* `advancedAlchemy` IS our implementation of their "Advanced Alchemy Benefits" container — the
   * printed *"you gain the advanced alchemy benefits"* (Munitions Crafter). Ours is a FIELD rather
   * than a named grant, so a record carrying the whole ability read as granting nothing of it. The
   * alternative — authoring `grantsClassFeatures: ['advanced-alchemy']` — would hand an archetype
   * character the alchemist's class feature itself, which is not what the feat says. */
  if (rec.advancedAlchemy) addGrant('Advanced Alchemy Benefits');
  addGrant(rec.grantedFeatId);
  addGrant(rec.grantsFeat);
  for (const v of Object.values(rec.grantedFeatByChoice ?? {})) addGrant(v);
  for (const s of rec.innateSpells ?? []) addSpell(s.spellId ?? s);
  /* …and an aeon stone's RESONANT power, one level down. wg-diff already descends into `resonant`;
   * this reader stopped at the top level, so 14 stones whose spell lives at resonant.innateSpells
   * read as granting nothing. Shipped reader: build.ts (gated on the 'wayfinder-slotted' designation). */
  for (const s of rec.resonant?.innateSpells ?? []) addSpell(s.spellId ?? s);
  /* The resonant TOGGLE itself — their rows ask "Is this granting the resonant power?" as a Yes/No
   * select on 30 aeon-stone rows; ours asks the same question once per inventory row as the
   * `wayfinder-slotted` designation (offered only on records carrying `resonant`, read in build.ts).
   * Crediting yes/no here mirrors wg-diff, which already credits the same toggle as a 'choice' kind
   * on our side — same question, different control. Chosen over suppressing their select because a
   * their-side skip is invisible to settle-divergence-audit, which reads only the SETTLED registries. */
  if (rec.resonant) { out.options.add(key('yes')); out.options.add(key('no')); }
  for (const s of rec.focusSpells ?? []) addSpell(s);
  for (const s of rec.spellListAdditions?.spells ?? []) addSpell(s);
  /* `grantsRituals` holds OBJECTS (`{ spellId }`), not bare ids — passing the object straight to
   * addSpell stringified it to "[object Object]", so every record granting a ritual reported its
   * ritual as missing. The Harrower's *"you learn the harrowing ritual"* is the case. */
  for (const s of rec.grantsRituals ?? []) addSpell(s.spellId ?? s);
  /* An ENHANCEMENT tier holds its always-on effects under `grant` — Undead Hunter's once-per-day
   * Infuse Vitality lives there, and reading only top-level fields called the spell missing. */
  for (const s of rec.enhancement?.grant?.innateSpells ?? []) addSpell(s.spellId ?? s);
  for (const s of rec.enhancement?.grant?.focusSpells ?? []) addSpell(s);
  for (const g of rec.enhancement?.grant?.grantsFeats ?? []) addGrant(g);
  /*
   * …and the spells an ITEM HOLDS. `heldSpells` is a rank→ids map — a wayfinder's once-a-day Heal, a
   * strand of prayer beads' four divine spells — and it was in no collector at all, so every item that
   * casts something read as casting nothing. Two records in batch 1, and the only batch with many items.
   */
  for (const ids of Object.values(rec.heldSpells ?? {})) for (const s of ids ?? []) addSpell(s);
  for (const it of rec.grantsItems ?? []) out.items.add(key(anyName(it.itemId ?? it)));
  for (const st of rec.grantedStrikes ?? []) out.items.add(key(st.name));
  /*
   * A COMBINATION weapon's second usage. Their side makes the MELEE form the buyable record and hands
   * the "(Ranged)" one over with a `giveItem`; the printed table does it the other way round ("lists
   * the ranged weapon statistics first and the melee weapon statistics indented beneath"), which is
   * the way ours is built. So the counterpart of their `<name> (Ranged)` is our `<name> (Melee)` —
   * the SAME second usage, named for the other half. Matching on the name alone reported all 18 as
   * missing a grant we make in the opposite direction. Both spellings are added because which usage
   * counts as "the other" depends on which side you start from.
   */
  if (rec.combinationMeleeForm) {
    const base = String(rec.name ?? '').replace(/\s*\((?:Melee|Ranged)\)\s*$/i, '');
    out.items.add(key(`${base} (Melee)`));
    out.items.add(key(`${base} (Ranged)`));
  }
  /*
   * BOTH the label and the value.
   *
   * `label ?? value` assumes our label IS the option's name, and usually it is — but a picker whose
   * label spells out what the option grants ("Clan Aringeld — Diplomacy, Society, Mercantile Lore")
   * normalises to a string their bare "Clan Aringeld" cannot match, and all thirteen clans then read
   * as absent from a record that offers exactly those thirteen. The value is the stable name, the
   * label is for the player. Reading both costs nothing and cannot manufacture a false MATCH: an
   * option we do not offer contributes neither string.
   */
  const addOption = (o) => {
    if (o?.label) out.options.add(key(o.label));
    if (o?.value) out.options.add(key(o.value));
    /* The remaster energy rename: our records store vitality/void where their legacy rows say
     * positive/negative — pre-rename spellings of the SAME two types, so both contribute (Energy
     * Scarred's eight energies, batch 23). */
    const legacyEnergy = { vitality: 'positive', void: 'negative' };
    if (legacyEnergy[o?.value]) out.options.add(key(legacyEnergy[o.value]));
  };
  for (const o of rec.choice?.options ?? []) {
    addOption(o);
    /* A feat-valued option IS a grant of the picked feat — buildCharacter's backgroundChoiceKind
     * 'feat' lane grants it — and their side writes the same clause as giveAbilityBlock ops inside
     * the select's branches, which this comparer files under GRANTS. Before this, retiring a
     * redundant flat `grantedFeatId` beside the choice (Corpse Stitcher, batch 23) made the record
     * read as granting nothing at all. */
    if (o?.value && core.feats?.[o.value]) out.grants.add(key(o.value));
    /* …and the SPELLS a choice option grants. A container must not decide whether a grant counts —
     * the same lesson wg-diff records. A REPEATABLE focus grant has to live on `choice`, because that
     * is the only picker whose answer is per-taking (Blessing of the Sun Gods: a different domain, and
     * its spell, each time), and reading spells from `effectChoices` alone reported all eleven of its
     * domain spells as missing the moment the record moved onto the correct lane. */
    for (const s of o.grant?.focusSpells ?? []) addSpell(s);
    for (const s of o.grant?.innateSpells ?? []) addSpell(s.spellId ?? s);
  }
  for (const ch of rec.effectChoices ?? []) {
    for (const o of ch.options ?? []) {
      addOption(o);
      for (const s of o.grant?.focusSpells ?? []) addSpell(s);
      for (const s of o.grant?.innateSpells ?? []) addSpell(s.spellId ?? s);
    }
  }
  /*
   * …and an ABILITY-BOOST choice, which is an option list with no `choice` field to hold it.
   *
   * A background or ancestry states its boosts as `abilityBoosts: [{ kind: 'choice', options: ['cha',
   * 'dex'] }, { kind: 'free' }]`, and their side enumerates the same pick as `attributeCha` /
   * `attributeDex` options. Reading only `choice` and `effectChoices` reported nine backgrounds as
   * offering none of the options they offer — the same blind spot the kinds map had, one level down.
   * A FREE boost is every attribute, which is what "free" means.
   */
  /* …and a background's "trained in your choice of X or Y" skill list, which their side enumerates as
   * `skillArcana` / `skillNature` / … Eidolon Contact offers exactly the four they name. */
  for (const s of rec.trainedSkillChoice ?? []) {
    out.options.add(key(`skill ${s}`));
    out.options.add(key(s));
  }
  /* …and the named-subject Lore list (`trainedLoreOptions: ['art', …]` — the dedicated background
   * lane batch 19 made the SINGLE carrier by retiring its duplicate `choice` blocks). Their side
   * enumerates the same list as `Art Lore` / `SKILL_LORE_SAILING` options, so all three spellings
   * contribute; an option we do not offer contributes none of them. */
  for (const s of rec.trainedLoreOptions ?? []) {
    out.options.add(key(s));
    out.options.add(key(`${s} lore`));
    out.options.add(key(`skill ${s} lore`));
  }

  const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
  for (const b of rec.abilityBoosts ?? []) {
    const list = b?.kind === 'free' ? Object.keys(ABILITY_NAMES) : (b?.options ?? []);
    for (const a of list) {
      /* Both spellings: theirs normalises to `attributecha`, ours may be read as either. */
      out.options.add(key(`attribute ${a}`));
      out.options.add(key(`attribute ${ABILITY_NAMES[a] ?? a}`));
      out.options.add(key(a));
    }
  }

  /* A `kind: 'skills'` picker offers every skill by construction, so their enumerated options are
   * all covered. Same for `kind: 'domains'`, whose options are the deity's domains. */
  if (rec.choice?.kind === 'skills') for (const s of SKILL_NAMES) out.options.add(key(s));
  /*
   * …and the MODES, which is where a TEMPORARY attack lives.
   *
   * A printed attack that lasts "for the next minute" or "while transformed" cannot be a
   * `grantedStrikes` on the record — that would hand it over permanently — so it is authored as a
   * toggle: a catalog mode gated on the feat, or a `consumable-modes.json` row keyed to the item.
   * Reading only the record reported "they grant two attacks, we grant none" on Howling Aspect the
   * moment it was correctly authored, which is this project's most repeated instrument bug: a
   * predicate that knows one storage location reads every other one as absent.
   */
  for (const m of modeDefsFor(id)) for (const st of m.grantedStrikes ?? []) out.items.add(key(st.name));
  /* The registries, which is where most feat→feat grants actually live. */
  for (const gid of registryIds(featFeatText, id)) addGrant(gid);
  for (const sid of registryIds(cantripText, id)) addSpell(sid);
  for (const fid of registryIds(pickText, id)) addGrant(fid);
  /*
   * …and a `skillChoices` slot IS an options list. Gildedsoul's Diplomacy-or-Society and Nagaji Lore's
   * Nagaji-or-Naga-Lore both live in a grant table rather than on the record, so reading only the record
   * reported "they offer two options, we offer none" on two records that offer exactly those two.
   */
  for (const f of ['src/rules/featGrantsAuto.ts', 'src/rules/featGrants.ts', 'src/rules/featGrantsLane.ts']) {
    let text = '';
    try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
    const m = new RegExp(`^\\s{2}(?:['"]${id}['"]|${id})\\s*:\\s*\\{`, 'm').exec(text);
    if (!m) continue;
    const rest = text.slice(m.index);
    const end = /\n\s{2}(?:['"][a-z0-9-]+['"]|[a-z][a-zA-Z0-9]*)\s*:/.exec(rest.slice(1));
    const body = rest.slice(0, end ? end.index + 1 : rest.length);
    for (const om of body.matchAll(/options\s*:\s*\[([^\]]*)\]/g)) {
      for (const o of om[1].matchAll(/['"]([a-z][a-z0-9:_-]*)['"]/g)) out.options.add(key(o[1]));
    }
  }
  /*
   * THE CLASS CHASSIS — the same crediting wg-diff.mjs does for KINDS, done here for NAMES.
   *
   * A class's subclass selector, its extra choices and its focus spells are stored on `classes.<id>`,
   * never on the class FEATURE whose printed text introduces them. So the bard's Composition Spells
   * ("You learn the counter performance composition spell … the courageous anthem composition
   * cantrip") held no spell of its own, the animist's Animistic Practice offered none of its four
   * practices, and the necromancer's Fatal Method offered neither of its two — all of which are built,
   * offered in the builder and covered by tests. This is the project's most repeated instrument bug:
   * a predicate that knows one storage location reads every other one as absent.
   *
   * Credited ONLY where the class DECLARES the carrier (`subclass.featureId`, `extraChoices[].featureId`),
   * never to every feature the class happens to have — an undeclared carrier must keep reading as a gap.
   */
  /*
   * A `kind: 'ikons'` choice has NO baked option list — it resolves against the character's own
   * exemplar picks, narrowed by the type the feat's printed Usage line names. Their side enumerates
   * the ikons instead, so reading only `choice.options` reported "they offer nine, we offer none" on
   * the three imbue feats the moment they were correctly built. Resolve the same pool the builder
   * would, which also makes the two sides' membership genuinely comparable.
   */
  if (rec.choice?.kind === 'ikons') {
    for (const [ikonId, ik] of Object.entries(core.ikon ?? {})) {
      if (rec.choice.ikonType && ![].concat(rec.choice.ikonType).includes(ik?.ikonType)) continue;
      out.options.add(key(ik?.name ?? ikonId));
      out.options.add(key(ikonId));
    }
  }
  const owner = classOfFeature.get(id);
  if (owner) {
    const cls = core.classes[owner];
    const creditOptions = (options) => {
      for (const o of options ?? []) {
        out.options.add(key(o.name ?? o.id));
        out.options.add(key(o.id));
        for (const s of o.focusSpells ?? []) addSpell(s);
        for (const g of o.grants?.feats ?? []) addGrant(g);
        const optRec = core.classFeatures[o.id];
        for (const g of optRec?.grantsFeats ?? []) addGrant(g);
        for (const g of optRec?.grantsActions ?? []) addGrant(g);
        for (const s of optRec?.focusSpells ?? []) addSpell(s);
        /* An option's feat grants live in the registries as often as on the record — the animist's
         * `medium` grants Relinquish Control and `seer` grants Apparition Sense from featFeatGrants,
         * not from a field. Reading only the record's fields reported both as missing. */
        for (const gid of registryIds(featFeatText, o.id)) addGrant(gid);
        for (const sid of registryIds(cantripText, o.id)) addSpell(sid);
      }
    };
    if (cls?.subclass?.featureId === id) creditOptions(cls.subclass.options);
    for (const ec of cls?.extraChoices ?? []) if (ec.featureId === id) creditOptions(ec.options);
    /* The class's own focus spells, for the feature that introduces them — the same `-spells` gate
     * wg-diff uses, so an unrelated feature of a focus-casting class is not credited. */
    if (/-spells$/.test(id)) for (const s of cls?.focusSpells ?? []) addSpell(s);
  }
  return out;
}

/**
 * Does OUR set contain their name?
 *
 * Exact keys are too strict in both directions, because the two sides label the same thing at different
 * lengths. Ours carries the disambiguation the sheet needs — "Fey Dragonet (arcane, poison)", "Acid
 * resistance (half your level)", "Scent (imprecise, 30 feet)" — and theirs is the bare noun. Their item
 * names carry the source instead: "Dragonblood Claw" for our "Claw", "Iruxi Fangs" for our "Fangs".
 * So a match either way round counts, and only a name with NO overlap at all is reported.
 */
const contains = (set, name) => {
  if (set.has(name)) return true;
  for (const mine of set) {
    if (mine.includes(name) || name.includes(mine)) return true;
  }
  /*
   * …and WORD ORDER differs as often as length. Their "Nagaji Lore" is our `lore:nagaji`; their
   * "imprecise scent" is our "Scent (imprecise, 30 feet)". Squashing to one string makes those
   * un-matchable, so compare the WORDS as sets and accept when one side's words are contained in the
   * other's. Both examples were records offering exactly the option they offer.
   */
  const words = (s) => new Set(String(s).split(/[^a-z0-9]+/).filter(Boolean));
  const theirs = words(tokenSource.get(name) ?? name);
  if (!theirs.size) return false;
  for (const mine of set) {
    const ours = words(tokenSource.get(mine) ?? mine);
    if (!ours.size) continue;
    if ([...theirs].every((w) => ours.has(w)) || [...ours].every((w) => theirs.has(w))) return true;
  }
  return false;
};


/**
 * NAMED THINGS READ AND SETTLED, keyed `id` -> `bucket`.
 *
 * A handful survive the loose matcher and are still not defects: their side names a plumbing record, or
 * splits into several items what we consolidate into one, or labels the same thing after the ancestry
 * rather than the effect. Named here with the reading that settled each, so they stop costing a re-read
 * every batch; anything unlisted still reports.
 *
 * ⚠ Only for a difference verified against the printed text. Never a place to quiet a real gap.
 */
const SETTLED_IDENTITIES = {
  /*
   * SPELLSHIFTER DEDICATION — their `shiftspell` names a record our corpus does not contain.
   *
   * Printed: *"You gain the SHIFT SPELL ACTION and the Share the Burden spellshift."* No Shift Spell
   * ACTION exists in any of our buckets; the only record of that name is `feats/shift-spell`, a
   * LEVEL-14 WIZARD feat that merely shares it. Ours used to grant exactly that, handing an archetype
   * character a wizard feat eleven levels early while still leaving them without the action.
   *
   * Granting nothing and stating the clause on the record is the honest position until the Spellshifter
   * action records are imported — the whole archetype is prose-only in this dataset, which is why its
   * three feats also needed their archetype and prerequisite gates authored by hand. Paired with the
   * KINDS settle in wg-diff's VERIFIED_EQUIVALENT.
   */
  'spellshifter-dedication': ['grants'],

  /*
   * PISTOL WAND — their one op is {"type":"giveItem","data":{"itemId":13707}}: the BARE Reinforced
   * Stock weapon (their 13707 = our items/reinforced-stock: 1d4 B, club group, finesse, two-hand-d8,
   * martial, attached-to-crossbow-or-firearm) dropped into inventory as a second item. Ours delivers
   * the same weapon as the combination form: items/pistol-wand-stock ("Pistol Wand (Melee)", the same
   * 1d4 B / club / finesse / two-hand-d8 profile) wired via pistol-wand.combinationMeleeForm — the
   * identity comparer just cannot see that "reinforcedstock" and "pistolwandmelee" are the same
   * attached weapon. Same named thing, present on both sides.
   *
   * ⚠ The DELTA is queued, not settled: print says "the pistol's weapon potency rune (and any other
   * runes) applies to Strikes with the stock as well"; our stock carries builtInRunes {potency:1},
   * their bare giveItem stock carries no rune at all — a WG-vs-print divergence recorded in
   * work/owner-questions.json ('pistol-wand'). This settle covers ONLY the item identity.
   */
  'pistol-wand': ['items'],

  /* ---- BATCH 1 ---------------------------------------------------------------------------------
   *
   * Both are the standing "THEIR UNARMED ATTACKS ARE ITEMS" translation, from opposite directions.
   *
   * WARRIOR AUTOMATON — their `warriorautomatonfist` is an item; the automaton ancestry already has a
   * fist, and this heritage CHANGES it (*"the damage die for your fist increases to 1d6 instead of
   * 1d4"*), which is an unarmed rider rather than a new attack. Granting a second fist would give the
   * character two.
   *
   * HAFT STRIKER STANCE — their `haft` is an item; ours is the `stances/haft-striker-stance` record
   * carrying its own `strikes`, which is where every stance keeps the attack it grants.
   */
  'warrior-automaton': ['items'],
  'haft-striker-stance': ['items'],

  /* ---- BATCH 15 --------------------------------------------------------------------------------
   *
   * SEALED POPPET — their `nonflammable` ability block against our `removesWeaknesses: ['fire']`.
   * *"You no longer have the weakness to fire from the flammable ability."* Removing a weakness is the
   * whole content of the record, so a record-shaped wrapper would add a name and nothing else. Matching
   * entry in wg-diff's VERIFIED_EQUIVALENT.
   */
  'sealed-poppet': ['grants'],

  /*
   * MYRIAD FORMS — their list is SHORTER than the printed one, and this is the one call that is ours.
   *
   * Verbatim (feat-2625): *"You gain the alternate form of a KITSUNE HERITAGE other than your own,
   * adding it to the options for your Change Shape."* The choice is keyed to heritages, and we offer
   * all six. Theirs offers two — Tailless Form and Fox Form — each carrying a heritage's alternate-form
   * text as prose. Adopting their list would delete four legal answers from the player's menu.
   *
   * The owner's parity rule reserves exactly this: *"the only place where we have the last word is
   * filtering the options when giving a user selection menu."* The record itself now carries the
   * question, which it did not before — that half WAS a real gap and was built.
   */
  'myriad-forms': ['options'],

  /*
   * ASCENDED DRAGONET HERITAGE — an OPEN choice has no enumerated options to compare.
   *
   * Ours is `kind: 'open'` with `from: { type: 'heritage', ancestry: 'dragonet' }`, so the list is the
   * ancestry's heritages at read time rather than five values copied onto the record — which is why the
   * comparer sees an empty option list. Theirs enumerates the same five and copies each heritage's
   * effects into an ability block; ours names the HERITAGE, which is what the sentence points at and
   * what the feats keying off owning it need. Same settle as `awakened-yaoguai-heritage` in batch 14.
   */
  /* RESTORED — the removal was collateral (see the comment block above, which states the reading).
   * Their five giveAbilityBlock grants and five option titles are the same five names arriving
   * twice; ours is the open heritage choice (openChoice case heritage narrows to exactly the five
   * dragonet heritages) + secondHeritageIdOf feeding every second-heritage site in build.ts. Same
   * shape as the untouched sibling awakened-yaoguai-heritage. */
  'ascended-dragonet-heritage': ['grants', 'options'],

  /*
   * GATE'S THRESHOLD — their two branch options (Expand the Portal / Fork the Path) against our gate
   * junction list, which is a different question: the junction is the other half of Expand the Portal.
   * The branch itself lives in BuildState as `gateForks` / `gateExpands`, keyed by threshold level.
   * Full reasoning, and the display defect that reading it exposed, in wg-diff's VERIFIED_EQUIVALENT.
   */
  /* RESTORED — collateral of the same whole-key removal. Their two branch titles (expandtheportal,
   * forkthepath) against our junction option list is a comparison of two different questions: the
   * BRANCH is BuildState (gateForks/gateExpands, measured by test/batch15-parity.test.ts), and the
   * junction picker is the Expand branch's own sub-question, now gated on it (requiresNoGateFork). */
  'gates-threshold': ['options'],

  /* Their `giveAbilityBlock` points at `feat/Domains`, a container holding their domain list. Ours is
   * `choice: {kind: 'domains'}` plus domains.ts resolving the chosen domain's initial spell. */
  'deitys-domain': ['grants'],
  /* The same container one feat along: Expanded Domain Initiate's `giveAbilityBlock` points at their
   * `feat/Domains` list, while ours is an `effectChoices` picker over the deity's ALTERNATE domains
   * plus `focusPoolBonus: 1`, resolving to the chosen domain's initial spell. Matching entry in
   * wg-diff's VERIFIED_EQUIVALENT. */
  'expanded-domain-initiate': ['grants'],
  /* BATCH 14. Their grant is a SELF-REFERENCE — feat 22302 "grants" their physical-feature of the same
   * name, which carries zero operations. See the matching entry in wg-diff's VERIFIED_EQUIVALENT. */
  'scales-of-the-dragon': ['grants'],
  /* HARDENED CHASSIS — their extra options (`no` / `yesalltypes` / `yesincreaseresistance`) are a
   * SECOND select asking whether a later feat has upgraded this one. That is their engine threading an
   * upgrade through a question on the upgraded record; on our side an upgrade is the upgrading
   * record's business, so this feat offers only the three damage types it prints. The three that
   * matter are matched. */
  'hardened-chassis': ['options'],
  /* *"…the yaoguai heritage you selected at first level"* — the text points at the ancestry's heritage
   * list rather than printing one, so ours resolves it from the character's own heritage instead of
   * hand-copying five names that would drift as the list grows. */
  'awakened-yaoguai-heritage': ['grants', 'options'],
  /* SPEAKER IN TRAINING — their two option titles name the TRADITION ("Divine"/"Primal"); ours name
   * the SPELL each tradition grants (Bless / Fleet Step) — one pick, two labels for it, and the
   * traditions themselves are carried by featCantripGrants' traditionByOption (load-bearing: Fleet
   * Step's traditions list arcane FIRST, so without the per-option tradition the primal answer would
   * vote arcane). This bucket reads EMPTY on ours ("(nothing)") only because this comparer credits
   * featCantripGrants ids to out.spells — which is also why the spells bucket already matches. */
  'speaker-in-training': ['options'],
  /* *"…one of the following features that grants an innate primal spell that can be used once per
   * day"* — their eight options are the sprite heritages that qualify, which ours derives from the
   * character's own heritage rather than enumerating. */
  'fey-influence': ['options'],
  /* *"The unarmed attack you gained from Draconic Aspect gains the deadly d8 trait."* A change to an
   * attack the character ALREADY has, which is what `unarmedTraits` exists for; their three items are
   * the same sentence expressed as three pre-modified copies of the attack. The standing "their
   * unarmed attacks are items" translation. */
  'deadly-aspect': ['items'],
  /* FAST MOVEMENT — their five options (normal/swim/fly/climb/burrow) are the five Speeds the familiar
   * ability may raise, and ours are the same five, in `FAMILIAR_ABILITY_CHOICES` (companionGrants.ts)
   * with the answer stored on the companion and applied by `deriveFamiliar`. They are options on a
   * COMPANION, not grants on the record, so the identity comparer — which reads what a record hands
   * the character — cannot see them. Full reasoning in the wg-values entry of the same name. */
  'fast-movement': ['options'],
  /* Their carrier is a skin ITEM; ours is the resistance itself — `effectChoices` whose three options
   * each grant `max(1,floor(@actor.level/2))` of the chosen type, which is the printed clause. The
   * standing "their items are our fields" translation; matching entry in VERIFIED_EQUIVALENT. */
  'wormskin': ['items'],
  /*
   * SACRED SPELLS — their two options are a QUESTION ABOUT THE CHARACTER, not a choice the feat offers.
   * They branch on `preparedspellcaster` / `spontaneousspellcaster` because their engine needs to know
   * which kind of caster is reading the feat. Ours does not have to ask: the record's own choice is
   * keyed on the BENEFIT (`flag: 'sacredSpellsBenefit'`) and the caster's type is already known from
   * their class. Offering "are you a prepared caster?" would ask the player to restate what the sheet
   * already knows — and option filtering is ours by the owner's rule.
   */
  'sacred-spells': ['options'],
  /* Their "Iron Fist" is a pre-modified fist ITEM; ours is `unarmedTraits` removing nonlethal and adding
   * shove on the fist you already have, which is what the feat prints. */
  'iron-fists': ['items'],
  /* Their item is named after the ancestry ("Kashrishi Skin"), ours after the feat ("Tough Skin"). One
   * granted armour, two labels. */
  'tough-skin': ['items'],
  /* Recorded disagreement — their row grants the Additional Lore FEAT (and its 3rd/7th/15th increases);
   * this record prints only "you also become trained in Shoony Lore". See work/wg-lane-backlog.md. */
  'shoony-lore': ['grants'],
  /* Their Claws branch hands over a new "Iruxi Claws" ITEM. Ours UPGRADES the claw the iruxi ancestry
   * already granted — `unarmedTraits: [{match: ['claw'], setDie: 'd6', add: ['versatile-p'],
   * choiceValue: 'claw'}]` — which is what the feat prints: *"Your claw attack deals 1d6 slashing damage
   * INSTEAD OF 1d4 and gains the versatile P trait."* Replacing it would double the claw. */
  'iruxi-armaments': ['items'],
  /*
   * Their carrier is a "Scaly Hide" ITEM (ac_bonus 1, dex_cap 3, plus a LEVEL>=5 conditional raising
   * AC_BONUS to 2); ours is the `unarmoredAc` field, the natural-armour lane derive.ts reads as an
   * item bonus, with the same numbers and the same bonus type. Only the CARRIER differs, which is what
   * this settles.
   *
   * (This comment used to end "the stacking exception is unbuilt". It is built: `unarmoredAc.cumulative`
   * pools the bonus apart from the competing item slot so it ADDS to a potency rune, exactly as the feat
   * prints — and `scales-of-steel` and `scales-of-the-dragon`, which print the same sentence, now carry
   * the flag too.)
   */
  'scaly-hide': ['items'],
  /*
   * "You gain a thorns unarmed attack that deals 1d6 piercing damage. Your thorns are in the knife
   * weapon group and have the finesse and unarmed traits." Their carrier is item 13068 "Hidden
   * Thorn"; ours is `grantedStrikes` with those exact dice, group and traits. Note that 13068 DOES
   * carry the Unarmed trait (2398), so the giveItem→weapon rule already maps it and the record lands
   * in AGREE — this entry currently suppresses nothing (unlike made-for-combat, whose three items
   * lack the trait).
   */
  'hidden-thorn': ['items'],
  /*
   * Highhelm pg. 108 prints twelve clans; both sides ship those twelve plus a 'clan not listed here'
   * fallback, so thirteen options each. Ours match theirs one for one except two of their titles —
   * "Clam Grimmark" (their typo is in Clan) and "Clan Venderholl" — where AoN prints Clan Grimmark
   * and Clan Vanderholl, the spellings we use.
   */
  'clan-lore': ['options'],
  /*
   * They ship four warmask items, one per power source; we ship one `orc-warmask` item plus a
   * four-way `effectChoices` that trains the associated skill (Religion/Nature/Arcana/Occultism) and
   * names the tradition in the option label only — nothing on our side stores the tradition. The
   * feat prints a single item — "You paint your face to create a warmask" — whose tradition trait
   * varies by source.
   */
  'orc-warmask': ['items'],

  /* ---- batch 004, read 2026-08-18 ------------------------------------------------------------ */
  /* Their "Awakened Animal Attacks" is a CONTAINER block listing the attacks to choose from; ours is
   * the choice itself plus the grantedStrikes behind it. Same menu, one record instead of two. */
  'tooth-and-claw': ['grants'],
  /*
   * Their "Mountain Stance" item packages the stance as gear (ARMOR/unarmored_defense, ac_bonus 4,
   * dex_cap 0), alongside a separate falling stone weapon item; ours is `grantedStrikes: Falling
   * Stone` on the feat plus `stances.mountain-stance` carrying acBonus +4 item, dexCap 0 and
   * speedPenalty 5. ⚠ Their item also writes the printed +2 circumstance bonus onto
   * SAVE_FORT/SAVE_REFLEX/SAVE_WILL; ours states it only in the stance's prose `note`, so that half
   * is displayed, not computed.
   */
  'mountain-stance': ['items'],
  /* "domains" is their container record, exactly as on deitys-domain; ours is a 4-pick domain choice. */
  'splinter-faith': ['grants'],
  /* Their yes/no select asks whether the automaton enhancement is active; ours is the enhancement
   * system itself, which gates the tier for every automaton feat rather than per record. */
  'undead-hunter': ['options'],
  /*
   * Printed: *"Choose one item of light Bulk to be your pusaka. It becomes a magic item that has the
   * occult trait."* Theirs hands over a new "Pusaka" item (item 16240, itself carrying no
   * operations); ours grants no item, because the text converts one the character already owns and
   * inventing one would put a phantom item in the bag. ⚠ Ours does not record WHICH item either —
   * the only trace is the inert note on the `pusakaLore` text choice telling the player to decide.
   */
  'inherit-the-dreaming-heirloom': ['items'],
  /* Their scales are an ITEM; ours is `unarmoredAc`, the natural-armour field built in this batch. */
  'scales-of-steel': ['items'],
  /* munitions-crafter was settled on a comment that ended "this is a gap, not a settle" — the printed
   * *"4 + half your level (rounded up)"* daily consumables it called unbuilt are now
   * `advancedAlchemy: { items: 4, addHalfLevel: true }`, pinned by test/archetype-alchemy.test.ts. The
   * entry is gone. */
  /* Their item is named for the ancestry ("Shisk Quill"), ours for the attack ("Quills") — the same
   * 1d6 knife-group unarmed strike the feat prints. */
  'spine-stabber': ['items'],
  /* ---- batch 005, read 2026-08-18 ------------------------------------------------------------ */
  /* "Caustic Blast" is the REMASTER name of Acid Splash, which is the id we ship. One spell, two
   * printings — and the feat's own text still says Acid Splash in our source. */
  /* elemental-wrath — settle REMOVED: divergence fixed (repointed from the superseded acid-splash to caustic-blast, on BOTH carriers). Re-report if it returns. */

  /* ---- batch 006, read 2026-08-18 ------------------------------------------------------------ */
  /* They label the four options by the SKILL each trains; we label them by the EMBLEM the feat prints
   * ("Burning Sun", "Death's Head"). Same four, and our skillChoices grants the same four skills. */
  'hold-mark': ['options'],
  /*
   * Their "Ratfolk Jaws" is a pre-modified ITEM; ours is an `unarmedTraits` rider stepping the jaws
   * die and adding backstabber, which is what the feat prints ("1d6 INSTEAD OF 1d4"). The rider is
   * the right shape but currently matches nothing: our `ratfolk` ancestry record grants no jaws
   * strike, so the ancestry is what needs fixing, not this record.
   */
  'vicious-incisors': ['items'],
  /* Their Enhancement is a yes/no select; ours is the automaton enhancement system. */
  'powerful-tail': ['options'],
  /* "domains" is their container record, as on deitys-domain and splinter-faith. */
  'domain-initiate': ['grants'],
  /*
   * Their select is a FILTERED any-Lore picker (filter group ADD-LORE) whose one predefined entry is
   * a bare LORE variable, so the comparer reads it as an option we lack. Ours is a `loreChoices: 1`
   * slot in featGrantsAuto.ts, which offers the same any-Lore pick.
   */
  'progenitor-lore': ['options'],
  /* Their two options are the fresh/salt choice we now ask through `effectChoices`. */
  'native-waters': ['options'],
  /* Their two options are the arcane/primal tradition we now ask through `effectChoices`. */
  'springsoul': ['options'],

  /*
   * Their one `giveItem` is the "Pyrotechnic Versatile Vials" item; ours is `advancedAlchemy: {
   * items: 4 }` — the printed 4 are made during daily preparations, not handed over — plus the
   * Launch Fireworks action and the Fireworks Lore conditional in featGrantsAuto.ts. Their separate
   * "Quick Alchemy Benefits" block is a giveAbilityBlock container, not the item op settled here.
   */
  /* firework-technician-dedication — settle REMOVED: divergence fixed (pyrotechnic vials + Quick Alchemy replace the Advanced Alchemy budget). Re-report if it returns. */
  /*
   * Their row gates both grants in conditionals — Underwater Marauder on Athletics >= trained, Water
   * Sprint on Athletics >= master — and FEAT_RANK_FEAT_GRANTS['student-of-water'] carries exactly
   * that pair with the same two gates. The identity scan does read it: registryIds() scans all of
   * featFeatGrants.ts, so both feats are credited and this record now matches with no residue; the
   * entry can be dropped.
   */
  'student-of-water': ['grants'],
  /* alchemist-dedication was settled here on a comment that admitted it was "an open gap rather than
   * a settled one" — the record now grants `quick-alchemy` and carries the printed text, so it
   * matches on its own merits and the entry is gone. */
  /* Create Undead now ships as `grantsRituals`, which the identity scan reads only under `grantsRituals`
   * — it is present. */
  'undead-creator': ['spells'],
  /*
   * Their two options are the variables SKILL_SOCIETY and SKILL_THIEVERY, held in the
   * falseOperations of a conditional (the already-trained-in-both branch offers any skill instead).
   * Ours is not on the record: featGrantsAuto.ts gives edgewatch-detective-dedication a
   * `skillChoices` pick of one of society/thievery at trained, matching the printed "trained in
   * Society or Thievery", and Experienced Tracker ships via FEAT_FEAT_GRANTS; both buckets now match
   * with no residue.
   */
  'edgewatch-detective-dedication': ['grants', 'options'],
  /* The two feats are immanence-gated and ship as a situational. */
  /* Their four options enumerate body ikons; ours is the immanence situational, which applies to
   * whichever ikon carries it rather than naming them. */
  /* Its casting ships through casterArchetypes.ts, which the identity scan does not read. */
  /* Their two tradition options are a SUBSET of ours — we offer the five Magaambyan branches and the
   * Arcana/Nature pair the feat prints. */
  /*
   * SPIRIT WARRIOR DEDICATION — their pre-modified fist ITEM against our `unarmedTraits` rider.
   *
   * ⚠ RE-SETTLED AFTER A REAL DIVERGENCE, which is why this reads longer than it did. The old entry
   * silenced this difference while ours delivered only PART of the clause: the rider stripped
   * `nonlethal` and left the fist at 1d4 with no parry, so their fist and ours were genuinely not the
   * same weapon. Ours now sets d6 and adds parry — test/parity-fixes.test.ts asserts both — and the
   * only remaining difference is the vehicle: an item on their side, a rider on the character's
   * existing fist on ours. Handing over a second fist item would give the character two.
   */
  'spirit-warrior-dedication': ['items'],
  /*
   * FIREWORK TECHNICIAN DEDICATION — their pyrotechnic vial ITEM against our vial COUNTER.
   *
   * ⚠ ALSO RE-SETTLED AFTER A REAL DIVERGENCE. Ours used to grant an Advanced Alchemy prepared-item
   * budget — a different subsystem the feat never mentions — and no vials at all, so Launch Fireworks
   * had nothing to spend. Ours is now the `versatile-vials` counter in src/rules/classResources.ts
   * (maxBase 4, gated on this feat) beside the three other flat-four archetypes. A daily consumable
   * RESOURCE is a counter here and an item there; the four vials a player gets are the same four.
   */
  'firework-technician-dedication': ['items'],
  /* The spellbook now ships as `grantsItems: [spellbook-blank]`. */
  'wizard-dedication': ['items'],
  /* The Basic Undead Benefits container; Drink Blood now ships as `grantsActions`. */
  /* Their "Vampire Incisors" ITEM against our Fangs strike — the same 1d6 piercing brawling attack the
   * feat prints ("your incisors elongate; you gain a fangs unarmed attack"). */

  /*
   * Their grants are not flat and not unconditional: a PREDEFINED select offers Single Gate / Dual
   * Gate, and the six impulse junctions appear only inside the Single Gate branch's element options
   * — Dual Gate grants elements alone, matching the printed paragraphs. Ours states the same rule
   * from `classes.kineticist.extraChoices[element]` (six *-gate options carrying the printed
   * junction) with `impulseJunctionIds()` in explain.ts gating on `gates.length === 1`, so only the
   * shape of the encoding differs and there is nothing to adopt.
   */
  'kinetic-gate': ['grants', 'options'],
  /*
   * *"Select three ikons."* — that is the whole selection clause, and the current printed text states no
   * one-of-each-type constraint, so their three TYPED selects (Worn Ikon / Body Ikon / Weapon Ikon)
   * assert a rule the book no longer carries; the AoN `ikon` docs carry no worn/body/weapon traits
   * either. "Spark Transcendence" is described as the act, not a grantable record — *"you can also Spark
   * Transcendence in a mighty deed"* — and the archive holds no document of that name; the exemplar's
   * one action record is Shift Immanence, which we grant. Ours: `classes.exemplar.extraChoices[ikon]`,
   * 21 options, with the immanence riders in situationalBonuses.ts.
   */
  'divine-spark-and-ikons': ['grants'],
  /*
   * *"Healing Font: You gain 4 additional spell slots each day at your highest rank of cleric spell
   * slots … 5 at 5th level … 6 at 15th."* Their Healing Font / Harmful Font are grantable RECORDS; ours
   * is `entry.font = { type, slots, rank }` computed in build.ts with `fontSlots = level>=15 ? 6 :
   * level>=5 ? 5 : 4`, restricted to heal/harm and gated on the deity's own font entry. A computation,
   * so there is no record for a name to match against.
   */
  'divine-font': ['grants', 'options'],
  /*
   * Their "Powerful Fist" is a synthetic, unselectable `unarmed_attack` item (d6 bludgeoning) standing
   * in for the die swap. Ours is `fistDieUpgraded` in derive.ts, which swaps the Fist profile's die to
   * d6 AND drops `nonlethal` — both halves of *"The damage die for your fist increases to 1d6 instead
   * of 1d4. You don't take the normal –2 circumstance penalty when making a lethal attack…"*.
   */
  'powerful-fist': ['items'],
  /*
   * Their four tiered Versatile Vial items implement *"a vial you create is always the highest type you
   * could Craft"* by shipping one item per tier and a level branch. The printed text names no tiered
   * items and the AoN mirror holds no Versatile Vial record at all. Ours is the daily RESOURCE the
   * clause actually describes — classResources.ts `alchemist` → `{ id: 'versatile-vials', kind:
   * 'counter', refresh: 'rest', maxBase: 2, maxAbility: 'int' }` — plus the one `versatile-vial` item.
   */
  alchemy: ['items'],

  /*
   * Their four options are the TRADITION pick ("Arcane/Divine/Occult/Primal Cathartic Mage"); ours
   * are the ten catharsis EMOTIONS the record's own `choice` asks for — two different questions on
   * one record. The printed feat reads "…you learn to cast spontaneous spells and gain the Cast a
   * Spell activity. You gain a spell repertoire with one cantrip of your choice, from a spell list
   * of your choice", and that half ships as `choiceTradition: true` in casterArchetypes.ts plus an
   * effectChoices spellFilter over all four lists, which has no option labels to match.
   */
  'cathartic-mage-dedication': ['options'],
  /* The four SKILL options match exactly; the residue is their `intelligence` / `wisdom` pair, which is
   * *"your key spellcasting attribute … is your choice of Intelligence or Wisdom"* — ours is
   * `choiceKeyAbility: ['int','wis']` on the archetype config, asked by the caster-archetype card
   * rather than by this record's own menu. */
  'hedge-mage-dedication': ['options'],
  /* *"…can receive that deity's divine sanctification."* Same three options, one different label:
   * their "Not Sanctified" / "Neither" is our "None — take no sanctification". Both grant nothing, and
   * a menu label is the one thing the parity rule leaves to us. */
  'cleric-dedication': ['options'],
  /*
   * *"You are bound by your deity's anathema and gain the champion's aura and sanctification as
   * described in the champion class."* Their sanctification select offers the same three choices as
   * ours; only the third label differs — their "Neither" is our "None — take no sanctification" —
   * and both grant nothing. A menu label is the one thing the parity rule leaves to us.
   */
  'champion-dedication': ['options'],
  /* *"Choose one of the domains associated with your mystery … You gain an initial domain spell from
   * that domain."* Their `giveAbilityBlock` points at a scaffolding feat literally named "Domains";
   * ours is `choice: { kind: 'domains' }`, resolved by `applyFeatFocus` against DOMAIN_SPELLS (all 64
   * mapped). The same picker under another name — see the matching note in wg-diff.mjs. */
  'domain-acumen': ['grants'],
  /* *"You gain the advanced alchemy benefits. You can use advanced alchemy to create four alchemical
   * poison consumables each day."* Their "Advanced Alchemy Benefits" is a container RECORD; ours is the
   * `advancedAlchemy: { items: 4 }` field, which is the benefit itself rather than a pointer to it. */
  'poisoner-dedication': ['grants'],
  /* *"You gain one ikon…, the ability to use the ikon's immanence and transcendence actions and
   * effects, and the Shift Immanence action."* Only Shift Immanence is named as granted and we grant
   * it. "Spark Transcendence" is the ACT the same sentence describes, not a record — the archive holds
   * no document of that name. */
  'exemplar-dedication': ['grants'],

  /* ---- the undead dedications, re-read 2026-08-19 after the package flip ------------------------
   *
   * Their side grants ONE pointer record, "Basic Undead Benefits". Ours INLINES the pointed-at package
   * — and as of the adversarial-audit flip it now matches rules-1694 clause for clause: immunity to
   * death effects ONLY, +1 circumstance vs disease and poison, Necril, the low-light→darkvision
   * upgrade, negative healing, and the Negative Survival note. There is no grantsRules field to point
   * with, so the pointer itself can have no counterpart; the CONTENT is what matters and it is held.
   * The `<name> fist/incisors` items are their pseudo-item vehicles for the same unarmed attacks our
   * `grantedStrikes` / `unarmedTraits` riders carry with the printed dice.
   */
  'ghost-dedication': ['grants'],
  'zombie-dedication': ['grants', 'items'],
  'ghoul-dedication': ['grants'],
  'vampire-dedication': ['grants', 'items'],
  'mummy-dedication': ['grants', 'items'],
  'lich-dedication': ['grants'],
  /* Their two select options are the TRADITIONS (arcane/occult); our cantrip picker carries the same
   * pair as its spellFilter (`traditions: ['arcane','occult']`), and the per-tradition attribute now
   * ships as the two-entry spellcastingGrant. A filter has no option labels to match. */
  'nantambu-chime-ringer-dedication': ['options'],
  /* Their "Draconic Exemplar" block is scaffolding for the benefactor pick; ours is the record's own
   * `choice` (flag `draconicBenefactor`, the four traditions), plus the granted actions and the
   * draconic-gift item, all now on the record. */
  'draconic-acolyte-dedication': ['grants'],
  /*
   * Their "Select a Tradition" select offers Arcane and Primal, each carrying a defineCastingSource
   * plus a nested cantrip select filtered to that tradition. Ours is `traditionOptions:
   * ['arcane','primal']` with `innateCantrip` on
   * CASTER_ARCHETYPES['magaambyan-attendant-dedication'] in src/rules/casterArchetypes.ts — read by
   * build.ts and the Builder's tradition picker — not a field on the record; the record itself
   * carries only the branch-school `choice` (flag `magaambyanBranch`), which already matches their
   * Branch Affiliation options.
   */
  'magaambyan-attendant-dedication': ['options'],

  /* ---------------------------------------------------------------- batch 010 */

  /* Their "Powerful Fist" is a pre-modified fist ITEM; ours is the `unarmedTraits` rider that upgrades
   * the fist the character already has — the iron-fists shape, already settled for `powerful-fist`
   * itself. Replacing the fist instead of modifying it would give a martial artist two of them. Both
   * printed riders are now authored (the d6 step AND the nonlethal removal), which is what makes this
   * a carrier difference rather than a gap. */
  'martial-artist-dedication': ['items'],
  /* Their two select options are the TRADITIONS (arcane/occult). Ours carries that pair on the cantrip
   * picker's `spellFilter.traditions` plus a two-entry `spellcastingGrant` (arcane/Int, occult/Int) —
   * a filter has no option LABELS for `ourIdentities` to match. The options this record does enumerate,
   * Arcana and Occultism, are its skill picker and already agree. Same reading as
   * 'nantambu-chime-ringer-dedication' above. */
  'eldritch-researcher-dedication': ['options'],
  /* Their "Select Psychic Key Ability" is the printed *"key spellcasting attribute … is the attribute
   * you used to qualify"*; ours is `choiceKeyAbility: ['int','cha']` on CASTER_ARCHETYPES, a registry
   * rather than a field on the record. The record's OWN `choice` holds the conscious mind, and that
   * half already matches. */
  'psychic-dedication': ['options'],
  /* `grants` = the six implement actions handed over by an implement's Initiate Benefit; `options` =
   * the Wand's cold/electricity/fire attunement. Both live on our implement records, which is where
   * the printed text puts them — the dedication grants the implement, not its benefit. */
  'thaumaturge-dedication': ['grants', 'options'],
  /* aeon-stone-western-star — settle REMOVED the same day it was added: ourIdentities now credits
   * yes/no on every `resonant` record (the wayfinder-slotted designation IS their Yes/No select), so
   * this per-record entry answered nothing and would have silenced the NEXT, unrelated options
   * difference on that stone unread — the wg-settle-stale trap. Re-report if it returns. */
  /*
   * BATCH 17's REMAINING IDENTITY SETTLES — the mechanic is delivered by a carrier this comparer
   * cannot read. Full reasoning beside each record's wg-diff VERIFIED_EQUIVALENT entry.
   *
   * master-summoner: their nine rank options = our restricted-slot rank select (rankChoice →
   * rankOptions → the ms-rank-select SpellsTab now renders for spontaneous casters too).
   * grave-strength / ghostly-grasp-ghost / numb: their named "Advanced Undead Benefits" container =
   * its content authored directly (darkvision + half-level poison resistance, rules-1695).
   * psi-development: their 12 per-mind "…psi" spell ids are their DUPLICATE copies of the standard
   * cantrips (dazepsi, shieldpsi, …) cast from the PSYCHIC source; ours offers the standard cantrips
   * through the archetype entry itself, and the six unique surface cantrips via spellListAdditions —
   * same castable set, no duplicate spell records. Their two options (unique/standard) are the one
   * widened picker on our side.
   * beast-gunner-dedication: their four tradition×attribute options = `traditionOptions` +
   * `choiceKeyAbility` in casterArchetypes.ts, rendered as the two chip rows in shared.tsx.
   * parallel-breakthrough: their six conscious-mind options are the BRANCHES of their conditional;
   * ours is the flat 18-cantrip FEAT_CANTRIP_GRANTS picker, and narrowing it to minds other than
   * your own is the menu-filtering that is ours.
   * conjurer-of-corpses: their giveSpell summon-undead = the necromancer's occult prepare picker
   * already lists it (useTraditionSpells); the restricted slot is authored separately.
   */
  'master-summoner': ['options'],
  'grave-strength': ['grants'],
  'ghostly-grasp-ghost': ['grants'],
  'numb': ['grants'],
  'psi-development': ['spells', 'options'],
  'beast-gunner-dedication': ['options'],
  'parallel-breakthrough': ['options'],
  'conjurer-of-corpses': ['spells'],

  /*
   * BATCH 18's REMAINING IDENTITY SETTLES — same rule: the mechanic is delivered by a carrier this
   * comparer cannot read; full reasoning beside each record's wg-diff VERIFIED_EQUIVALENT entry, and
   * each adversarially confirmed (archived in the b018 adversarial record set).
   *
   * daywalker / grave-mummification: their named "Advanced Undead Benefits" container (their
   * physical-feature 28471) = its content authored directly on the record — senses/resistances
   * overlay rows + the FEAT_SITUATIONAL save stars (the grave-strength shape above).
   * devout-blessing: their "Blessing of the Devoted" container select = the record's ownsFeature
   * choice over the same three blessed-* classFeatures (batch-18 fix), whose answer enters
   * ownedFeatureIds and is read by the speed/shield/mode lanes.
   * domain-spirit: their "Domains" container is a 37-option select whose options encode NOTHING
   * (empty operations arrays — pure reference text); ours grants the actual initial domain spell per
   * pick (effectChoices options' grant.focusSpells) + focusPoolBonus 1 — the deitys-domain shape.
   * dominion-epithet: their 6 epithet options' feat grants = exemplar extraChoices grantedChoiceFeats
   * (their stale pre-errata 28637 row named Hefty Hauler / Underwater Marauder; the current 38691
   * row and print match ours).
   * greater-lesson: their TWO tier options ("Basic Lesson"/"Greater Lesson", each a nested filtered
   * select over that tier's lessons) = our flat enumerated options — 9 greater + 6 basic after the
   * batch-18 fix, the same reachable set with the tier hop flattened. major-lesson mirrors it with
   * all three tiers.
   * eldritch-archer-dedication: their four-tradition select (each defining the CASTING SOURCE
   * "ELDRITCH_ARCHER:::SPONTANEOUS-REPERTOIRE:::<TRAD>:::ATTRIBUTE_CHA") = casterArchetypes.ts
   * choiceTradition on the eldritch-archer entry (mk 5th arg true) + SPONTANEOUS_DEDICATIONS
   * membership — the beast-gunner-dedication shape above.
   */
  'daywalker': ['grants'],
  'grave-mummification': ['grants'],
  'devout-blessing': ['grants'],
  'domain-spirit': ['grants'],
  'dominion-epithet': ['grants', 'options'],
  'greater-lesson': ['options'],
  'eldritch-archer-dedication': ['options'],

  /*
   * ---- BATCH 19 (ancestries + backgrounds) -------------------------------------------------------
   *
   * Their ancestry rows hand each printed ability out as a NAMED ability block ("Constructed",
   * "Blunt Snout", "Hydration"), so the identity comparer asks for a granted record of that name.
   * Ours models the CONTENT of each block instead — a field, a star, a strike, an action — and the
   * whole batch was read against the printed pages with every finding adversarially checked
   * (work/.b019-findings.json), so each entry below names the lane that delivers its block(s).
   * Blocks that carry NO operations on their side either are printed prose, rendered in full by the
   * AST carrier (public/ast/ancestries.json — DescBody's preferred source).
   *
   * android: Constructed → FEAT_SITUATIONAL['android'] all-saves star.
   * anadi/nagaji: Fangs → grantedStrikes (1d6 P, brawling, finesse) authored this batch.
   * automaton: Automaton Core + Constructed Body → op-less prose blocks; AST carries both sections.
   * awakened-animal: their versatile-heritage framing — see wg-diff's kinds settle; Awakened Form is
   *   the bodySize/hpBySize lane, Awakened Mind the RECORD_MARKERS diplomacy note.
   * azarketi: Hydration → op-less prose block; AST carries the paragraph.
   * catfolk: Land on Your Feet → op-less prose block; AST carries it.
   * centaur: Mount (op-less prose) + Robust (bulkLimitBonus, deriveBulk) — pairs the kinds settle.
   * conrasu: Sunlight Healing → op-less prose block; AST carries it.
   * dragonet: Big Sharp Teeth → grantedStrikes (1d4 P); Wings → immunities['falling damage'] + AST.
   * dwarf: Clan Dagger → grantsItems [{clan-dagger}] with the Clan Pistol `replaces` interaction.
   * fleshwarp: Unusual Anatomy → `situational` all-saves star on the record.
   * ghoran: Photosynthesis → op-less prose block; AST carries it.
   * goloma: Eyes in Back → op-less prose block; AST carries it.
   * jotunborn: Iivlar Weaving → the sustained light mode (toggle-modes, ancestry-gated).
   * kashrishi: Empathic Sense → `senses` (imprecise 15 ft) + the Sense Motive star; Glowing Horn →
   *   op-less prose block, AST carries it.
   * kholo: Bite → grantedStrikes Jaws (1d6 P) — pairs the kinds settle.
   * leshy: Plant Nourishment → their block is prose too (no operations); AST carries it.
   * lizardfolk: Claws → grantedStrikes (1d4 S); Aquatic Adaptation → grantsFeats ['breath-control'].
   * merfolk: Aquatic Grace → their block prints "(no operations)"; Hydration → the Fortitude star.
   * minotaur/sarangay: Horns → grantedStrikes matching the printed dice (d8 / d6+shove).
   * poppet: Constructed → `situational` star; Flammable → the weaknesses formula max(1,level/3).
   * ratfolk: Sharp Teeth → grantedStrikes Jaws (1d4 P, agile finesse).
   * samsaran: Cryptomnesia → FEAT_SITUATIONAL['samsaran']; Wanderer's Soul → prose, AST carries it.
   * shoony: Blunt Snout → `degreeShifts` one-better on the printed saves.
   * skeleton: Undeath → negativeHealing + immunities['death'] + the disease/poison star + the dying
   *   marker + low-light vision, the adjudicated rules-1694 package.
   * sprite: Magical Strikes → prose block on both sides; AST carries the printed sentence.
   * strix: Wings → prose block; AST carries the full section including the no-fall-damage clause.
   * surki: Magiphage → the ancestry `choice` (magiphageTradition) four records read.
   * tengu: Sharp Beak → grantedStrikes Beak (1d6 P, finesse).
   * tripkee: Natural Climber → `situational` Athletics-to-Climb star.
   * vanara: Prehensile Tail → op-less prose block; AST carries it.
   * vishkanya: Innate Venom → grantsActions ['envenom'] + the venom save-line repair.
   */
  'android': ['grants'],
  'anadi': ['grants'],
  'automaton': ['grants'],
  'awakened-animal': ['grants'],
  'azarketi': ['grants'],
  'catfolk': ['grants'],
  'centaur': ['grants'],
  'conrasu': ['grants'],
  'dragonet': ['grants'],
  'dwarf': ['grants'],
  'fleshwarp': ['grants'],
  'ghoran': ['grants'],
  'goloma': ['grants'],
  'jotunborn': ['grants'],
  'kashrishi': ['grants'],
  'kholo': ['grants'],
  'leshy': ['grants'],
  'lizardfolk': ['grants'],
  'merfolk': ['grants'],
  'minotaur': ['grants'],
  'nagaji': ['grants'],
  'poppet': ['grants'],
  'ratfolk': ['grants'],
  'samsaran': ['grants'],
  'sarangay': ['grants'],
  'shoony': ['grants'],
  'skeleton': ['grants'],
  'sprite': ['grants'],
  'strix': ['grants'],
  'surki': ['grants'],
  'tengu': ['grants'],
  'tripkee': ['grants'],
  'vishkanya': ['grants'],
  'vanara': ['grants'],
  /*
   * BORDERLANDS PIONEER — their Lore select names hill/mountain/river in the SINGULAR; the printed
   * list is plural ("choose from forest, hills, mountains, plains, rivers, or swamp",
   * background-283) and our `wildernessLore` choice matches print word for word. Their spelling is
   * their own; adopting it would move us OFF the printed list.
   */
  'borderlands-pioneer': ['options'],
  /*
   * KOBOLD — their two options ("Normal Attribute Boosts" / "Mightyfall Kobold Attribute Boosts")
   * are the Mightyfall Kobold HERITAGE's optional package, which lives on our heritage record: the
   * `mightyfallAttributes` choice + `alternateAttributes` lane (Str+Cha, flaw Int, 10 ancestry HP),
   * built this batch and guarded in test/batch19-parity.test.ts. The ancestry row is not where ours
   * asks the question, and the heritage is where the book prints it.
   */
  'kobold': ['options'],

  /*
   * ---- BATCH 20 (backgrounds) --------------------------------------------------------------------
   *
   * NIGHT WATCH — their select enumerates the two printed branches ("Legal Lore" / "Lore for your
   * home settlement"). Ours is the free-text Lore box with `trainedLoreChoiceDefault: 'legal'`
   * (batch 20): an unanswered pick trains Legal Lore, a typed settlement trains that Lore — the
   * second printed branch is BY NATURE free text, which an enumerated option cannot hold. Guarded on
   * built characters in test/batch20-parity.test.ts.
   */
  'night-watch': ['options'],
  /*
   * BREVIC NOBLE — their select names the six LINEAGES (Garess…Surtova); ours asks the same
   * question through `trainedSkillChoice` keyed by each lineage's trained SKILL — the mapping is 1:1
   * (Garess=crafting, Lebeda=society, Lodovka=athletics, Medvyed=survival, Orlovsky=diplomacy,
   * Surtova=deception), and the skill answer drives the Lore (`trainedLoreByChoice`) and the feat
   * (`grantedFeatByChoice`) so the three cannot disagree. Guarded in test/batch20-parity.test.ts.
   */
  'brevic-noble': ['options'],
  /*
   * HARROW-CHOSEN — their select records WHICH harrow card the player carries (suits and alignment
   * cards: hammers, keys, shields… lawful good, neutral…). That answer is their engine's bookkeeping
   * for the empower matching; the MECHANICAL outcomes are the empowered-draw states, which ours
   * ships as the two background-gated modes (partial match / unmatched) plus the innate-cantrip
   * pick. The card itself has no sheet number on either side.
   */
  'harrow-chosen': ['options'],

  /*
   * ---- BATCH 21 ----------------------------------------------------------------------------------
   *
   * CHILD OF NOTORIETY — their select names the two BRANCHES ("kindness" / "notoriety"); ours asks
   * the same question through `trainedSkillChoice` (diplomacy = kindness, intimidation = notoriety),
   * with the Lore and the feat riding the same answer via trainedLoreByChoice/grantedFeatByChoice —
   * the Brevic Noble shape, guarded on built characters in test/batch21-parity.test.ts.
   */
  'child-of-notoriety': ['options'],
  /*
   * PROFESSIONAL LETTER WRITER — their select enumerates the two feats; ours asks through the
   * FEAT_PICK_GRANTS registry (featPickGrants.ts:222, "Choose Specialty Crafting or Multilingual"),
   * which this comparer does not read. Batch 20 made that registry the SINGLE carrier by retiring
   * the record's duplicate grantedFeatId + choice pair.
   */
  'professional-letter-writer': ['options'],
  /*
   * REVENANT — their named "Void Healing" block is ours as the `negativeHealing` field, aggregated
   * by deriveDefenses and build's hasVoidHealing (background arm built this batch; guarded on a
   * built character in test/batch21-parity.test.ts).
   */
  'revenant': ['grants'],
  /*
   * LIBRARY DWELLER — their select enumerates "Library Lore" / "Lore associated with your school";
   * ours is the free-text Lore box with `trainedLoreChoiceDefault: 'library'` (the Night Watch
   * shape): the second printed branch is by nature free text.
   */
  'library-dweller': ['options'],
};

/* ---------------------------------------------------------------- compare */
const batchRows = arg('--ids')
  ? String(arg('--ids')).split(',').map((s) => ({ id: s.trim() })).filter((r) => r.id)
  : Object.values(JSON.parse(readFileSync(join(ROOT, arg('--batch', 'work/wg-batch-003.json')), 'utf8')));
const ids = batchRows.map((r) => r.id);
/* The bucket each id was CUT from — 'warrior' is a background AND a class feature, and resolving the
 * bare id examined the wrong one while the batch's record reached no comparer (batch 23). */
const bucketHintOf = new Map(batchRows.map((r) => [r.id, r.bucket]));

/* THEIR ROWS, PER BUCKET — see `WG_PAIRING`. `if (r.type !== 'feat') continue` meant a class feature,
 * item, heritage, background, ancestry or class was compared against nothing and the silence read as
 * agreement. Type-gated, because 266 normalised names exist in two of our buckets. */
const theirByBucket = wgRowsByBucket(sql);
const theirRowFor = (bucket, name) => {
  const row = theirByBucket[bucket]?.get(key(name));
  return row ? { row, n: parseOps(row.operations).flatMap((o) => flattenOps(o)).length } : undefined;
};

let checked = 0, clean = 0;
const misses = [];
for (const id of ids) {
  /* ANY bucket, not just feats — resolving with `core.feats?.[id]` skipped every class feature, item,
   * heritage and background in silence. See wgRecord's note. */
  const { rec, bucket } = wgRecord(core, id, bucketHintOf.get(id));
  if (!rec?.name) continue;
  /* See wgOwnsComparison: an action defers to a same-named class feature or feat. */
  if (!wgOwnsComparison(core, bucket, id)) continue;
  const t = theirRowFor(bucket, rec.name);
  if (!t) continue;
  const theirs = theirIdentities(t.row);
  const total = theirs.grants.size + theirs.spells.size + theirs.items.size + theirs.options.size;
  if (!total) continue;
  checked++;
  const ours = ourIdentities(id, rec);
  const rows = [];
  for (const bucket of ['grants', 'spells', 'items', 'options']) {
    if (!RAW_SETTLES && (SETTLED_IDENTITIES[id] ?? []).includes(bucket)) continue;   // read and settled — see above
    const missing = [...theirs[bucket]].filter((n) => !contains(ours[bucket], n));
    if (missing.length) rows.push({ bucket, missing, have: [...ours[bucket]] });
  }
  if (!rows.length) { clean++; if (VERBOSE) console.log(`ok    ${id}  (${total} identities agree)`); continue; }
  misses.push({ id, name: rec.name, rows });
}

console.log(`checked ${checked} records that grant a NAMED thing; ${clean} match on every one\n`);
for (const m of misses) {
  console.log(`--- ${m.id}  (${m.name})`);
  for (const r of m.rows) {
    console.log(`      ${r.bucket.padEnd(8)} theirs-not-ours=[${r.missing.join(', ')}]`);
    console.log(`      ${''.padEnd(8)} ours=[${r.have.join(', ') || '(nothing)'}]`);
  }
}
console.log(`\n${misses.length} records where a named thing on their side has no counterpart on ours.`);
