/*
 * GUARD: a condition Foundry attached to an effect is not lost on our record ("only when…" kept).
 *
 * WHY. The data import read Foundry's rule elements and DROPPED their predicates — the "only while raging",
 * "only while wearing your innovation", "only on visual Perception checks", "only if you are a dwarf" that
 * decide when an effect applies — and our own overlay rows repeated the pattern by hand. Package M found it
 * on critical specialization (scripts/critspec-narrowing-check.mjs guards that kind); the 2026-10-17
 * measurement over every other rule key found 97 rules on 58 records applied MORE broadly than the
 * condition allows: Clarity Goggles adding +3 to every Perception check, an Axe of the Dwarven Lords giving
 * a human greater darkvision, Rope Runner a climb Speed off the ropes, Werecreature Dedication its jaws in
 * humanoid shape. 48 of the 60 record+key pairs came from our own overlay rows, 12 from the importer.
 *
 * HOW IT DECIDES. For every PREDICATED Foundry rule on a shipped record (CriticalSpecialization excluded —
 * critspec-narrowing-check owns it), the predicate is walked (or/not/nand, comparisons) into FAMILIES:
 *   self:level · item · proficiency-rank · feature/class/feat · own toggle · own choice ·
 *   self effect/condition · stance · target · roll context · effect trait · armor/shield ·
 *   heritage/ancestry/trait · deity · parent · template · other roll option
 * ("own toggle"/"own choice" = a roll option the same Foundry document's RollOption/ChoiceSet defines; an
 * atom naming the record itself — feat:<id>, feature:<id>, class:* on a class feature — is no condition).
 * One adapter per rule key finds the record's UNCONDITIONAL counterpart: Strike → grantedStrikes by name;
 * FlatModifier → passiveEffects.* / maxHpBonus / landSpeedBonus / speeds / saveBonuses / strikeDamage /
 * attackItemBonus / unarmoredAc by selector; Resistance/Weakness/Immunity → the IWR entries of that type;
 * Sense → senses; BaseSpeed → speeds; CreatureSize → sizeOverride/sizeSet; ActorTraits →
 * grantsCreatureTraits; GrantItem → grantsFeats/grantsItems/grantsClassFeatures/grantsActions/
 * grantedFeatId/featureIds; MultipleAttackPenalty → mapReduction;
 * DexterityModifierCap → passiveEffects.dexCap; DamageDice → strikeDamage dice; AdjustStrike → the
 * unarmed/weapon trait riders; AdjustDegreeOfSuccess → degreeShifts; ActiveEffectLike (skill rank,
 * negativeHealing) → the subclass option's grants.skills / trainedSkill / negativeHealing.
 * A family is CARRIED when the counterpart (or the record) carries that condition:
 *   self:level           the record's own level, or the entry's minLevel, meets the bound
 *   armor/shield         defensesRequire, an IWR entry's whenArmorCategory, unarmoredAc (only unarmored)
 *   own choice           a granted Strike's choiceValue, a grantsItems whenChoice, grantedFeatByChoice
 *   other roll option    (Strike) every same-named row's choiceValue or whenHeritageChoice — Fey
 *                        Ascension's Leaves under its Dryad answer, Morphic Strike's elemental current
 *                        under Born of Elements' cantrip answer
 *   self effect          grantedStrikesState naming that state (rage, panache, hunt-prey, unleash-psyche)
 *   feature/class/feat   "not feat:X" where X replaces or re-grants the Strike; an or-group of owners;
 *                        the class route (class:<cls>, not feat:/parent:) for a class feature's grant
 *   heritage/trait/…     an IWR entry's whenCreatureTrait/unlessCreatureTrait/whenVoidHealing; a Sense
 *                        entry's whenCreatureTrait (deriveDefenses skips it without the trait); a granted
 *                        Strike's whenHeritage on EVERY same-named row (collectGrantedNaturals tests it
 *                        before its name dedup). A whenHeritage naming no heritage record, or a
 *                        whenHeritageChoice no answer of those heritages offers, carries nothing and
 *                        FAILS as a dead gate (the attack would reach nobody, silently).
 *   target, roll context, effect trait — ONLY an IWR entry's `against`, a degreeShift's when/actions, or a
 *                        star. A NUMBER can never carry these (ruling B: the bonus leaves passiveEffects for a
 *                        star) — so neither can an IWR entry's `condition`, which annotates a counted number.
 * Where the record has NO unconditional counterpart, the condition is KEPT when a conditional carrier holds
 * the effect (a star, a mode, a stance, whileActive, speedsIf, an effectChoices/choice grant, …) and the
 * effect is ABSENT otherwise — an under-grant, which is not this check's business.
 * Built-in KEPT: an unpredicated sibling rule with the same effect; a formula on an existing Speed; a
 * predicate that is only a NEGATED own toggle (the record shows the default state); a standing speed plus a
 * whileActive state value; the class route; an "unless you already have it" grant; a grantsItems
 * minLevel/maxLevel/whenChoice; a state variant (Foundry's base rule + the same rule under an effect) — the
 * unconditional entry is the base rule's counterpart, so the variant's state family is not an over-grant.
 * SELECTOR: a melee-/ranged-/unarmed-only Foundry selector whose counterpart is a strikeDamage entry that
 * applies to all Strikes is an over-grant too (family "melee-only selector" …), predicated or not.
 *
 * VERDICT. A counterpart with a family nothing carries FAILS — lit or DARK alike (the owner's choice: an
 * approval can switch a dark row on, and it must not switch an over-grant on) — unless
 * scripts/data/lost-condition-allow.json `entries` lists it:
 *   { record, key, selector | type, families, verdict, aonId, quote, why, ownerQuestion? }
 *   · `selector` (every key but Resistance/Weakness/Immunity, which take `type`) narrows the entry to one
 *     counterpart: FlatModifier/DamageDice the Foundry selector(s) joined with ",", Strike the attack's name
 *     lowercased without spaces, Sense/BaseSpeed the sense/movement type, GrantItem the granted record id,
 *     ActorTraits the traits joined with ",", ActiveEffectLike the path. Absent = every counterpart of that
 *     record and key.
 *   · `families` — the families the entry excuses; any other family on the counterpart still fails, and a
 *     listed family that no longer over-grants fails as STALE (so does an entry whose record is gone).
 *   · `verdict` — 'print-unconditional' (print gives it always), 'route' (a documented route carries it),
 *     'default-state' (print's default state of a toggle the player can switch), 'needs-reading' (print
 *     must be read by the owner: needs `ownerQuestion`, an OPEN or DEFERRED number in
 *     work/owner-questions.json, and prints as a warning instead of failing), 'kept-over-grant' (a REAL
 *     over-grant, kept on purpose ONLY while it waits on the OWNER's approval; `quote` is print's
 *     restriction). The owner's rule (2026-10-17): a KNOWN over-grant FAILS, lit or dark — the one thing
 *     that may hold one back is an approval only he can give. So it needs:
 *       `blockedBy.gate` — the carriers that would replace the number and are DARK under the trust gate
 *         ('star:<record id>' a FEAT_SITUATIONAL/CHOICE_SITUATIONAL entry on lanes.situational,
 *         'record-star' the record's own `situational` with that field on its OFF list, 'mode:<id>' one
 *         of the record's modes on lanes.modes; each must exist and still be dark, and one that is LIT
 *         fails as STALE — the number must go then, or the player sees it twice). `blockedBy.files` (the
 *         files the fix needs, each must exist) may only sit BESIDE a gate: an over-grant blocked by a
 *         file alone is a fix nobody made, not a wait, and fails.
 *       `awaitsApproval` — the desk number (work/owner-questions.json) whose approval in
 *         scripts/data/trust-approvals.json would light that gate (ruling #126 for the Ruling-B stars).
 *         It must still be pending there: in `unruled`, or answered without an `approvals` row for this
 *         record. An `approvals` row for this record and number means the approval LANDED (re-stamp the
 *         ledger: the gate goes LIT and the entry STALE); a `noMechanic`/`engine` disposition means no
 *         approval can come through that number, so nothing is waited on and the entry fails.
 *       `followUp` (the fix, once approved) and `trust` ('dark' | 'partly' | 'lit'), the trust state of
 *         its over-granting field(s) when it was written; the live state must equal it — LIGHTER fails
 *         ("a kept DARK over-grant is LIT now": an approval must not switch an over-grant on), DARKER
 *         fails as STALE (rewrite it, or it could turn lit again unseen).
 *     It prints on every run as "WARN waiting for the owner's approval of the Ruling-B star", never as
 *     "allowed" (the 2026-10-17 reconcile: a kept over-grant must stay visible, and say what it waits on).
 *   · `quote` must occur in the record's own Archives page (`aonId`: the record's aonId, its aonParentId,
 *     or for a subclass option the class page), with a `why`.
 *   · one entry per condition: a second entry on the same counterpart and family fails ("duplicates allow
 *     entry N"), so a pasted twin or a selector-less entry over a narrower one cannot hide a stale copy.
 *
 * THE SNAPSHOT. `snapshot.rows` in the allow file holds the measured predicated set — our record keys, the
 * rule key, a counterpart signature and the atom families (no Foundry text) — so the check works where the
 * Foundry packs (.import-src/pf2e/packs/pf2e, gitignored) are absent. Where they are present the set is
 * measured again and must equal the snapshot for every shipped record; a drift fails until
 *   jiti scripts/lost-condition-check.mjs --write-snapshot
 * rewrites it (packs required). Rows for records no longer shipped are reported, not failed.
 *
 * Also printed, never failing: how many conditions survive only as a DARK star (carried by a situational
 * entry the trust gate keeps off).
 *
 * Reads public/core.json, the allow file, the Archives mirror, the Foundry packs (through the shared index,
 * scripts/lib/foundry-rules.mjs), src/data/trust-ledger.json, work/owner-questions.json,
 * scripts/data/trust-approvals.json and src/rules/situationalBonuses.ts (so it runs under jiti). CORE_JSON,
 * LOST_COND_ALLOW, AON_MIRROR, FOUNDRY_PACKS, TRUST_LEDGER, OWNER_QUESTIONS and TRUST_APPROVALS override
 * them, FOUNDRY_INDEX_CACHE the pack-index cache
 * folder (used to prove the guard red on planted bad cases in scratch copies, never in the tree:
 * test/lost-condition-check.test.ts).
 *
 *   jiti scripts/lost-condition-check.mjs
 *   jiti scripts/lost-condition-check.mjs --write-snapshot     (packs required; rewrites snapshot.rows only)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPackIndex, importerDocs, atomsOf, hasPredicate, slugify } from './lib/foundry-rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = process.env.CORE_JSON || join(ROOT, 'public/core.json');
const ALLOW = process.env.LOST_COND_ALLOW || join(ROOT, 'scripts/data/lost-condition-allow.json');
const MIRROR = process.env.AON_MIRROR || 'C:/wonderers guide/aon-2e-archive/data/by-category';
const PACKS = process.env.FOUNDRY_PACKS || join(ROOT, '.import-src/pf2e/packs/pf2e');
const LEDGER = process.env.TRUST_LEDGER || join(ROOT, 'src/data/trust-ledger.json');
const QUESTIONS = process.env.OWNER_QUESTIONS || join(ROOT, 'work/owner-questions.json');
const APPROVALS = process.env.TRUST_APPROVALS || join(ROOT, 'scripts/data/trust-approvals.json');
const WRITE_SNAPSHOT = process.argv.includes('--write-snapshot');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const core = readJson(CORE);
const allow = readJson(ALLOW);
const ledger = existsSync(LEDGER) ? readJson(LEDGER) : { records: {}, lanes: {} };
const sit = await import(pathToFileURL(join(ROOT, 'src/rules/situationalBonuses.ts')).href);
const FEAT_SITUATIONAL = sit.FEAT_SITUATIONAL ?? {};
const CHOICE_SITUATIONAL = sit.CHOICE_SITUATIONAL ?? {};

const failures = [];
const fail = (msg) => failures.push(msg);
const getPath = (o, p) => String(p).split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const recOf = (key) => {
  const slash = key.indexOf('/');
  return core[key.slice(0, slash)]?.[key.slice(slash + 1)];
};

/* ====================================================================================================
 * 1. THE DIGEST — one row per predicated Foundry rule (Foundry side only; the same shape as the snapshot)
 * ==================================================================================================== */
const SKIP_BUCKETS = new Set(['spells', 'conditions', 'deities', 'classes', 'familiarAbilities']); // not standing grants
const DIGEST_KEYS = new Set([
  'Strike', 'FlatModifier', 'BaseSpeed', 'Sense', 'Resistance', 'Weakness', 'Immunity', 'ActorTraits', 'CreatureSize',
  'MultipleAttackPenalty', 'DexterityModifierCap', 'DamageDice', 'AdjustStrike', 'AdjustDegreeOfSuccess', 'GrantItem', 'ActiveEffectLike',
]);
const SKILLS = ['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery'];
const BARE_TRAITS = new Set(['fear', 'poison', 'mental', 'emotion', 'visual', 'auditory', 'disease', 'illusion', 'magical', 'arcane', 'divine', 'occult', 'primal', 'necromancy', 'sleep', 'inhaled', 'trap', 'alchemical', 'void', 'curse', 'death', 'fire', 'cold', 'electricity', 'acid', 'sonic', 'water', 'air', 'earth', 'metal', 'wood', 'linguistic', 'incapacitation', 'polymorph', 'possession', 'misfortune', 'fortune', 'olfactory', 'cantrip', 'virulent', 'contact', 'ingested', 'injury', 'morph', 'light', 'darkness', 'spirit', 'vitality', 'holy', 'unholy', 'mythic']);
const STATES = ['rage', 'panache', 'hunt-prey', 'unleash-psyche']; // grantedStrikesState values (types.ts)
const STATE_FAMS = new Set(['self effect/condition', 'own toggle', 'stance']);
const FAMILIES = new Set(['self:level', 'item', 'proficiency-rank', 'feature/class/feat', 'own toggle', 'own choice', 'self effect/condition', 'stance', 'target', 'roll context', 'effect trait', 'armor/shield', 'heritage/ancestry/trait', 'deity', 'parent', 'template', 'other roll option', 'melee-only selector', 'ranged-only selector', 'unarmed-only selector']);

/** The roll options the same Foundry document defines for itself: its ChoiceSet answers and RollOption toggles. */
function ctxOf(rules) {
  const choice = new Set();
  const toggles = new Set();
  for (const r of rules) {
    if (!r) continue;
    if (r.key === 'ChoiceSet') {
      if (r.rollOption) choice.add(String(r.rollOption));
      if (r.flag) {
        choice.add(String(r.flag));
        choice.add(String(r.flag).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
      }
    }
    if (r.key === 'RollOption' && r.option) toggles.add(String(r.option).replace(/\{[^}]*\}/g, '').replace(/:$/, ''));
  }
  return { choice, toggles };
}
function familyOf(s, ctx) {
  if (s === 'self:level') return 'self:level';
  if (/proficiency:rank/.test(s) || /^(defense|skill):[a-z-]+:rank/.test(s)) return 'proficiency-rank';
  if (/^item:/.test(s)) return 'item';
  if ([...ctx.choice].some((c) => s === c || s.startsWith(c + ':'))) return 'own choice';
  if ([...ctx.toggles].some((t) => t && (s === t || s.startsWith(t + ':')))) return 'own toggle';
  if (/^(self:)?(feature|class|feat):/.test(s)) return 'feature/class/feat';
  if (/^(self:)?(heritage|ancestry):/.test(s) || /^self:trait:/.test(s) || /^self:ancestry/.test(s) || /^ancestry:/.test(s)) return 'heritage/ancestry/trait';
  if (/^target:/.test(s)) return 'target';
  if (/^(self:)?(effect|condition):/.test(s)) return 'self effect/condition';
  if (/stance/.test(s)) return 'stance';
  if (/^self:armor|^armor:|armored|unarmored|^self:shield|^shield:/.test(s)) return 'armor/shield';
  if (/^(deity|self:deity)/.test(s)) return 'deity';
  if (/^parent:/.test(s)) return 'parent';
  if (/^(action|check|attack|damage|skill-check|saving-throw|spell|item-check|initiative|perception|inflicts|origin|defense|encounter|terrain|environment|aura|area-effect|healing|spellcasting|domain|weapon|unarmed|strike|cast|reaction|environmental-hazard)(:|$)/.test(s)) return 'roll context';
  if (BARE_TRAITS.has(s)) return 'effect trait';
  if (s.includes('{')) return 'template';
  return 'other roll option';
}
/** One atom → a token: { f, n?, o?, c?, v?, x?, p?, own?, st?, ag? } (our ids and flags; no Foundry text). */
function tokenOf(a, ctx, bucket, id) {
  const t = { f: familyOf(a.atom, ctx) };
  if (a.neg) t.n = 1;
  if (a.inOr) t.o = 1;
  if (a.op !== 'has') {
    t.c = a.op;
    if (typeof a.rhs === 'number') t.v = a.rhs;
  }
  const m = a.atom.match(/^(?:self:)?(feature|class|feat):(.+)$/);
  if (m) t.x = `${m[1]}:${m[2]}`;
  if (/^parent:/.test(a.atom)) t.p = 'parent';
  if (!a.neg && (a.atom === `feature:${id}` || a.atom === `feat:${id}` || (bucket === 'classFeatures' && /^class:/.test(a.atom)))) t.own = 1;
  if (t.f === 'self effect/condition') {
    const slug = a.atom.replace(/^(?:self:)?(?:effect|condition):/, '');
    if (/rage/.test(a.atom)) t.st = 'rage';
    else if (STATES.includes(slug)) t.st = slug;
  }
  if (a.atom === 'agile' || a.atom === 'item:trait:agile') t.ag = 1;
  return t;
}
const TOKEN_KEYS = ['f', 'n', 'o', 'c', 'v', 'x', 'p', 'own', 'st', 'ag'];
const ROW_KEYS = ['r', 'k', 's', 'a', 'sib', 'sk', 'ab', 'bs', 'sc', 'idem'];
const ordered = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const canon = (row) => JSON.stringify(ordered({ ...row, a: row.a.map((t) => ordered(t, TOKEN_KEYS)) }, ROW_KEYS));

const NAME = (s) => String(s || '').replace(/^PF2E\./, '').split('.').pop().replace(/[^a-z0-9]/gi, '').toLowerCase();
const selectorsOf = (r) => (Array.isArray(r.selector) ? r.selector : [r.selector]).filter((x) => x != null).map(String);
const iwrTypes = (t) => (Array.isArray(t) ? t : [t]).filter((x) => typeof x === 'string');
function statOf(sel) {
  const s = String(sel).replace(/\{[^}]*\}/g, '{T}');
  if (s === 'hp' || s === 'hp-per-level') return { k: 'hp' };
  const sp = s.match(/^(land|fly|swim|climb|burrow)-speed$/);
  if (sp) return { k: 'speed', t: sp[1] };
  if (s === 'speed' || s === 'all-speeds') return { k: 'speed', t: s === 'speed' ? 'land' : 'all' };
  if (s === 'saving-throw') return { k: 'save', t: 'all' };
  if (['fortitude', 'reflex', 'will'].includes(s)) return { k: 'save', t: s };
  if (/^(fortitude|reflex|will)-dc$/.test(s)) return { k: 'savedc', t: s.replace(/-dc$/, '') };
  if (s === 'perception') return { k: 'perception' };
  if (s === 'perception-dc') return { k: 'perceptiondc' };
  if (SKILLS.includes(s)) return { k: 'skill', t: s };
  if (s === 'skill-check' || /-skill-check$/.test(s)) return { k: 'skill', t: s === 'lore-skill-check' ? 'lore' : 'all' };
  if (/-dc$/.test(s) && SKILLS.includes(s.replace(/-dc$/, ''))) return { k: 'skilldc', t: s.replace(/-dc$/, '') };
  if (s === 'ac') return { k: 'ac' };
  if (s === 'initiative') return { k: 'initiative' };
  if (/damage/.test(s)) return { k: 'damage' };
  if (/attack/.test(s)) return { k: 'attack' };
  if (/heal/.test(s)) return { k: 'healing' };
  return { k: 'other', t: s };
}
const sameStat = (a, b) => a.k === b.k && a.t === b.t;
/** "melee-strike-damage" and kin: the selector itself narrows to one kind of Strike. */
function selectorScope(sels) {
  if (!sels.length || !sels.every((s) => /^(melee|ranged|unarmed)-/.test(s) || /-(melee|ranged)-/.test(s))) return null;
  return sels.some((s) => s.startsWith('melee')) ? 'melee' : sels.some((s) => s.startsWith('ranged')) ? 'ranged' : 'unarmed';
}
/** A GrantItem's target as OUR record id, or null for a templated / id-only uuid or a Foundry effect item. */
function grantTarget(rule) {
  const m = String(rule.uuid || '').match(/Compendium\.pf2e\.([a-z-]+)\.Item\.(.+)$/);
  if (!m) return null;
  if (['feat-effects', 'equipment-effects', 'spell-effects', 'other-effects', 'bestiary-effects'].includes(m[1])) return null;
  if (/^[A-Za-z0-9]{16}$/.test(m[2])) return null;
  return slugify(m[2]);
}
const AEL_PATH = (p) => p === 'system.attributes.hp.negativeHealing' || /^system\.skills\.[a-z-]+\.rank$/.test(p);

function digestDoc(d, bucket, id) {
  const ctx = ctxOf(d.rules);
  const rows = [];
  const unpred = d.rules.filter((s) => s && !hasPredicate(s));
  const sibSkills = unpred.filter((s) => s.key === 'FlatModifier').flatMap(selectorsOf).filter((x) => SKILLS.includes(x));
  const predTraits = d.rules.filter((s) => s?.key === 'ActorTraits' && hasPredicate(s));
  for (const r of d.rules) {
    if (!r || !DIGEST_KEYS.has(r.key)) continue;
    const pred = hasPredicate(r);
    const sc = r.key === 'FlatModifier' || r.key === 'DamageDice' ? selectorScope(selectorsOf(r)) : null;
    if (!pred && !sc) continue;
    const row = { r: `${bucket}/${id}`, k: r.key };
    switch (r.key) {
      case 'Strike':
        row.s = NAME(r.label || r.slug || '');
        break;
      case 'FlatModifier': {
        row.s = selectorsOf(r);
        const sib = row.s.map((sel) => (unpred.some((u) => u.key === 'FlatModifier' && selectorsOf(u).some((x) => sameStat(statOf(x), statOf(sel)))) ? 1 : 0));
        if (sib.some(Boolean)) row.sib = sib;
        if (row.s.some((sel) => statOf(sel).k === 'skill' && statOf(sel).t === 'all') && sibSkills.length) row.sk = [...new Set(sibSkills)].sort();
        break;
      }
      case 'DamageDice':
      case 'AdjustDegreeOfSuccess':
        row.s = selectorsOf(r);
        break;
      case 'BaseSpeed': {
        row.s = String(r.selector || '').replace(/-speed$/, '');
        if (unpred.some((u) => u.key === 'BaseSpeed' && String(u.selector).replace(/-speed$/, '') === row.s)) row.sib = 1;
        break;
      }
      case 'Sense': {
        row.s = String(r.selector || '');
        if (unpred.some((u) => u.key === 'Sense' && u.selector === row.s)) row.sib = 1;
        break;
      }
      case 'Resistance':
      case 'Weakness':
      case 'Immunity': {
        row.s = iwrTypes(r.type);
        if (unpred.some((u) => u.key === r.key && iwrTypes(u.type).some((t) => row.s.includes(t)))) row.sib = 1;
        break;
      }
      case 'ActorTraits': {
        row.s = (r.add || []).map(String);
        const ab = row.s.filter((t) => predTraits.length > 1 && predTraits.every((s) => (s.add || []).includes(t)));
        if (ab.length) row.ab = ab;
        break;
      }
      case 'GrantItem': {
        const target = grantTarget(r);
        if (!target) continue; // Foundry-only effect item, or a uuid that names no record of ours
        row.s = target;
        if (unpred.some((u) => u.key === 'GrantItem' && u.uuid === r.uuid)) row.sib = 1;
        break;
      }
      case 'ActiveEffectLike':
        if (!AEL_PATH(String(r.path || ''))) continue; // no record field mirrors this path
        row.s = String(r.path);
        break;
      case 'AdjustStrike':
        row.s = String(r.value || '').replace(/\{[^}]*\}/g, '');
        break;
      default:
        row.s = '';
    }
    row.a = pred ? atomsOf(r.predicate).map((a) => tokenOf(a, ctx, bucket, id)) : [];
    if (sc) row.sc = sc;
    if (r.key === 'GrantItem' && row.a.length && atomsOf(r.predicate).every((a) => a.neg && a.atom.split(':').pop() === row.s)) row.idem = 1;
    rows.push(row);
  }
  // A STATE VARIANT: the same key and counterpart again under the BASE rule's own predicate plus an
  // effect/toggle/stance (the inventor's overdrive resistance: [armor] beside [armor, overdrive]). The
  // unconditional entry is the base rule's counterpart. A sibling under a different predicate is no base
  // (the Spurned Lute's -4 "playing another instrument" is not the +1 "playing" without its toggle).
  const famSet = (r, keep) => [...new Set(r.a.filter((t) => !t.own && keep(t.f)).map((t) => t.f))].sort().join('|');
  for (const row of rows) {
    if (!row.a.some((t) => !t.own && STATE_FAMS.has(t.f))) continue;
    const sig = JSON.stringify(row.s);
    const rest = famSet(row, (f) => !STATE_FAMS.has(f));
    const isBase = (o) => o !== row && o.k === row.k && JSON.stringify(o.s) === sig && o.a.length && !o.a.some((t) => !t.own && STATE_FAMS.has(t.f)) && famSet(o, () => true) === rest;
    if (rest && rows.some(isBase)) row.bs = 1;
  }
  return rows;
}

/** Every digest row the packs give for a shipped record, or null when the packs are absent. */
function measureFromPacks() {
  const index = loadPackIndex(PACKS);
  if (!index) return null;
  const rows = [];
  for (const d of importerDocs(index)) {
    if (!d.rules.length) continue;
    let bucket = d.bucket;
    let rec = core[bucket]?.[d.id];
    if (!rec && d.alsoBucket) {
      bucket = d.alsoBucket;
      rec = core[bucket]?.[d.id];
    }
    if (!rec || SKIP_BUCKETS.has(bucket)) continue;
    rows.push(...digestDoc(d, bucket, d.id));
  }
  return { rows, cached: index.cached };
}

/* ====================================================================================================
 * 2. THE SNAPSHOT
 * ==================================================================================================== */
const SNAPSHOT_NOTE =
  'The measured predicated set (scripts/lost-condition-check.mjs): one row per predicated Foundry rule on a shipped record — r = our record key, k = the Foundry rule key, s = the counterpart signature, a = the predicate atoms as families (f) with flags (n negated, o in an or-group, c/v a comparison, x an owned-record atom, own = names the record itself, st a class-resource state, ag agile), sib = an unpredicated sibling with the same effect, sk = skills a sibling explains, ab = traits every branch adds, bs = a state variant beside a base rule, sc = a selector that narrows to one kind of Strike, idem = "unless you already have it". No Foundry text. Rewritten only by `jiti scripts/lost-condition-check.mjs --write-snapshot` with the packs present.';
function serializeAllow(obj, rows) {
  const { snapshot, ...rest } = obj;
  const head = JSON.stringify(rest, null, 2);
  return `${head.slice(0, head.lastIndexOf('}')).replace(/\s*$/, '')},\n  "snapshot": {\n    "_": ${JSON.stringify(SNAPSHOT_NOTE)},\n    "rows": [\n${rows.map((r) => `      ${r}`).join(',\n')}\n    ]\n  }\n}\n`;
}

const measured = measureFromPacks();
if (WRITE_SNAPSHOT) {
  if (!measured) {
    console.error(`lost-condition: --write-snapshot needs the Foundry packs (${PACKS} not found)`);
    process.exit(1);
  }
  const rows = measured.rows.map(canon).sort();
  writeFileSync(ALLOW, serializeAllow(allow, rows));
  console.log(`lost-condition: wrote ${rows.length} snapshot row(s) to ${ALLOW.replace(ROOT, '.')}`);
  process.exit(0);
}

const snapRows = Array.isArray(allow.snapshot?.rows) ? allow.snapshot.rows : [];
let rows;
let goneRows = 0;
if (measured) {
  const have = measured.rows.map(canon).sort();
  const snapLive = [];
  for (const r of snapRows) {
    if (recOf(r.r)) snapLive.push(canon(r));
    else goneRows++;
  }
  snapLive.sort();
  // multiset difference both ways
  const count = (list) => list.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const a = count(have);
  const b = count(snapLive);
  const added = [];
  const dropped = [];
  for (const [x, n] of a) for (let i = (b.get(x) ?? 0); i < n; i++) added.push(x);
  for (const [x, n] of b) for (let i = (a.get(x) ?? 0); i < n; i++) dropped.push(x);
  if (added.length || dropped.length) {
    fail(
      `SNAPSHOT drift against the Foundry packs: ${added.length} row(s) measured and not in the snapshot, ${dropped.length} in the snapshot and not measured — ` +
        `run \`jiti scripts/lost-condition-check.mjs --write-snapshot\`.` +
        (added.length ? ` First new: ${added.slice(0, 3).join(' ')}` : '') +
        (dropped.length ? ` First gone: ${dropped.slice(0, 3).join(' ')}` : ''),
    );
  }
  rows = measured.rows;
} else {
  if (!snapRows.length) fail(`no Foundry packs at ${PACKS} and no snapshot rows in ${ALLOW.replace(ROOT, '.')} — nothing to check against`);
  rows = snapRows.filter((r) => {
    if (recOf(r.r)) return true;
    goneRows++;
    return false;
  });
}

/* ====================================================================================================
 * 3. THE DECISION — record side
 * ==================================================================================================== */
const ledgerOff = ledger.records || {};
const sitOff = new Set(ledger.lanes?.situational || []); // ids whose star-carrying kind the trust gate keeps off
/** 'dark' | 'partly' | 'lit' for one record field path (the trust gate strips ledger paths at runtime). */
function trustOf(key, path) {
  if (!path || path.startsWith('(')) return 'lit';
  const offs = ledgerOff[key] || [];
  if (offs.some((p) => p === path || path.startsWith(p + '.') || path.startsWith(p + '['))) return 'dark';
  if (offs.some((p) => p.startsWith(path + '.') || p.startsWith(path + '['))) return 'partly';
  return 'lit';
}

const modesBy = new Map();
for (const m of Object.values(core.modes || {})) {
  const ids = new Set([m.id, m.fromItemId, ...(m.feats || []), ...(m.feats || []).map((f) => String(f).split(':')[0]), ...(m.classes || []), ...(m.backgrounds || []), ...(m.ancestries || [])].filter(Boolean));
  for (const id of ids) (modesBy.get(id) ?? modesBy.set(id, []).get(id)).push(m);
}
const stanceOf = (id) => core.stances?.[id];
const starsOf = (id) => [...[].concat(FEAT_SITUATIONAL[id] || []), ...[].concat(CHOICE_SITUATIONAL[id] || []).flatMap((x) => (Array.isArray(x?.bonuses) ? x.bonuses : [x]))];
function choiceGrants(rec) {
  const out = [];
  for (const ec of rec.effectChoices || []) for (const o of ec.options || []) if (o.grant) out.push(o.grant);
  for (const o of rec.choice?.options || []) if (o.grant) out.push(o.grant);
  return out;
}
/** classFeatures id → the class subclass/extra-choice OPTION the importer built from it. */
const SUBCLASS_OPTION = new Map();
for (const [cls, c] of Object.entries(core.classes || {})) {
  for (const o of c.subclass?.options || []) SUBCLASS_OPTION.set(o.id, { cls, o });
  for (const g of c.extraChoices || []) for (const o of g.options || []) if (!SUBCLASS_OPTION.has(o.id)) SUBCLASS_OPTION.set(o.id, { cls, o });
}

const STAR_KIND = { hp: ['hp'], speed: ['speed'], save: ['save'], savedc: ['save'], perception: ['perception', 'initiative'], perceptiondc: ['perception'], skill: ['skill'], skilldc: ['skill'], ac: ['ac'], initiative: ['initiative', 'perception'], attack: ['attack', 'strikeAttack', 'spell'], damage: ['strikeDamage', 'spellDamage'], healing: ['hp', 'spell'] };
const MODE_KIND = { hp: ['max-hp'], speed: ['speed'], save: ['save', 'all-checks'], savedc: ['save'], perception: ['perception', 'all-checks'], perceptiondc: ['perception'], skill: ['skill', 'all-checks'], skilldc: ['skill'], ac: ['ac'], initiative: ['initiative', 'perception'], attack: ['attack', 'spell-attack', 'all-checks'], damage: ['damage'], healing: [] };
const STAR_HOW = new Set(['situational star', 'choice star', 'record star', 'situational star (any)']);

function unconditionalAnalog(rec, st, sibSkills) {
  const pe = rec.passiveEffects || {};
  switch (st.k) {
    case 'hp':
      return rec.maxHpBonus ? 'maxHpBonus' : null;
    case 'speed':
      if (st.t === 'land' || st.t === 'all') {
        if (rec.landSpeedBonus != null) return 'landSpeedBonus';
        if (rec.speeds?.land != null) return 'speeds.land';
        if (pe.speedBonus != null) return 'passiveEffects.speedBonus';
        if (pe.speeds?.land != null) return 'passiveEffects.speeds.land';
        return null;
      }
      if (rec.speeds?.[st.t] != null) return `speeds.${st.t}`;
      if (pe.speeds?.[st.t] != null) return `passiveEffects.speeds.${st.t}`;
      return null;
    case 'save':
      if ((rec.saveBonuses || []).some((b) => st.t === 'all' || b.save === st.t)) return 'saveBonuses';
      if (pe.saves != null) return 'passiveEffects.saves';
      return null;
    case 'perception':
      return pe.perception != null ? 'passiveEffects.perception' : null;
    case 'skill':
      if (st.t === 'all') {
        const explained = new Set(sibSkills || []);
        const left = Object.keys(pe.skills || {}).filter((s) => !explained.has(s));
        return left.length ? `passiveEffects.skills.${left.join('+')}` : rec.dynamicSkillBonus ? 'dynamicSkillBonus' : null;
      }
      if (st.t === 'lore') return pe.loreBonus != null ? 'passiveEffects.loreBonus' : null;
      if (pe.skills?.[st.t] != null) return `passiveEffects.skills.${st.t}`;
      return null;
    case 'ac':
      if (pe.ac != null) return 'passiveEffects.ac';
      if (rec.unarmoredAc) return 'unarmoredAc';
      return null;
    case 'attack':
      if (rec.attackItemBonus != null) return 'attackItemBonus';
      if (pe.attack != null) return 'passiveEffects.attack';
      return null;
    case 'damage':
      if ((rec.strikeDamage || []).some((d) => !d.strikeName && !d.fromChoiceFlag && !d.byStrikeProficiency && !d.byWeaponSpecialization)) return 'strikeDamage';
      return null;
    default:
      return null;
  }
}
/** Where else on our side the conditional version of a stat lives (stars, modes, stances, state values). */
function conditionalCarrier(id, rec, st) {
  const how = [];
  const kinds = STAR_KIND[st.k] || [];
  if (starsOf(id).some((b) => (b.targets || []).some((t) => kinds.includes(t.kind)))) how.push('situational star');
  else if (CHOICE_SITUATIONAL[id] && kinds.length) how.push('choice star');
  if ((rec.situational || []).some((b) => (b.targets || []).some((t) => kinds.includes(t.kind)))) how.push('record star');
  for (const m of modesBy.get(id) || []) {
    if ((m.modifiers || []).some((x) => (MODE_KIND[st.k] || []).includes(x.target)) || (st.k === 'speed' && (m.speeds || m.battleForm?.speeds)) || (st.k === 'damage' && m.strikeDamage)) {
      how.push('mode');
      break;
    }
  }
  const s = stanceOf(id);
  if (s && ((st.k === 'ac' && s.acBonus) || (st.k === 'speed' && s.speeds) || (st.k === 'save' && s.saves) || (st.k === 'damage' && s.strikeDamage))) how.push('stance');
  if (st.k === 'speed' && (rec.speedsIf || (rec.whileActive || []).some((w) => w.speeds || w.landSpeedBonus) || rec.speedAdjust?.whileModes)) how.push('speedsIf/whileActive');
  if (st.k === 'save' && (rec.whileActive || []).some((w) => w.saves)) how.push('whileActive');
  if (st.k === 'hp' && rec.ancestryHp) how.push('ancestryHp');
  const fieldFor = { hp: 'maxHpBonus', speed: 'speeds', save: 'saveBonuses', ac: 'unarmoredAc', damage: 'strikeDamage', skill: 'passiveEffects', perception: 'passiveEffects', attack: 'attackItemBonus' }[st.k];
  if (fieldFor && choiceGrants(rec).some((g) => g[fieldFor] != null || (st.k === 'speed' && g.landSpeedBonus != null))) how.push('choice-gated grant');
  return how;
}

/** The lowest record level at which every self:level atom of the predicate holds, or null if one is no plain lower bound. */
function levelNeed(toks) {
  let need = 0;
  for (const t of toks) {
    if (t.n || typeof t.v !== 'number' || (t.c !== 'gte' && t.c !== 'gt')) return null;
    need = Math.max(need, t.c === 'gt' ? t.v + 1 : t.v);
  }
  return need;
}
/** Buckets whose record level is a CHARACTER level (you cannot hold the record below it). An item's level
 *  says nothing about its holder's, so it never carries a self:level bound. */
const CHARACTER_LEVEL_BUCKETS = new Set(['feats', 'classFeatures', 'heritages', 'ancestries', 'backgrounds', 'actions']);
/**
 * The families of a row's predicate that nothing carries. `carries(family, tokens)` is the adapter's own
 * table; self:level is carried by the record's own level (feats, features…) or the entry's minLevel; atoms
 * naming the record itself are no condition; a state variant's state families belong to the base rule's
 * counterpart.
 */
function uncovered(row, rec, carries = () => false, minLevel = null) {
  const toks = row.a.filter((t) => !t.own);
  const out = [];
  const levelIsCharacter = CHARACTER_LEVEL_BUCKETS.has(row.r.slice(0, row.r.indexOf('/')));
  for (const f of [...new Set(toks.map((t) => t.f))]) {
    const ft = toks.filter((t) => t.f === f);
    if (f === 'self:level') {
      const need = levelNeed(ft);
      if (need != null && ((levelIsCharacter && (rec.level ?? 1) >= need) || (minLevel != null && minLevel >= need))) continue;
    }
    if (row.bs && STATE_FAMS.has(f)) continue;
    if (carries(f, ft)) continue;
    out.push(f);
  }
  return out;
}
const familiesOf = (row) => [...new Set(row.a.filter((t) => !t.own).map((t) => t.f))];
const OVER = (field, fams, how = []) => ({ status: 'OVER', field, fams, how });
const KEPT = (how, field = null) => ({ status: 'CARRIED', field, how: [].concat(how) });
const ABSENT = { status: 'ABSENT', how: [] };
const overOrKept = (field, fams, how = []) => (fams.length ? OVER(field, fams, how) : KEPT('record carries every family', field));

/**
 * What is wrong with a granted Strike's heritage gate (GrantedStrike.whenHeritage / whenHeritageChoice),
 * or null. collectGrantedNaturals grants a gated row only to a character whose heritage is listed (and,
 * with whenHeritageChoice, whose heritage answer is that value) — so a gate naming no heritage, or an
 * answer none of its heritages offers, hands the attack to NOBODY without a sound. Such a gate carries no
 * condition here and fails on its own below (DEAD GATE).
 */
function heritageGateProblem(g) {
  if (g.whenHeritage != null && !Array.isArray(g.whenHeritage)) return 'whenHeritage is not a list of heritage ids';
  const hs = g.whenHeritage ?? [];
  const missing = hs.filter((h) => !core.heritages?.[h]);
  if (missing.length) return `whenHeritage names ${missing.join(', ')}, which is not a heritage in core.json`;
  if (g.whenHeritageChoice != null) {
    const pool = hs.length ? hs : Object.keys(core.heritages || {});
    const offered = pool.some((h) => (core.heritages[h]?.effectChoices || []).some((ec) => (ec.options || []).some((o) => o.value === g.whenHeritageChoice)));
    if (!offered) return `whenHeritageChoice "${g.whenHeritageChoice}" is no answer ${hs.length ? hs.join(', ') : 'any heritage'} offers`;
  }
  return null;
}
const liveHeritageGate = (g) => Array.isArray(g.whenHeritage) && g.whenHeritage.length > 0 && !heritageGateProblem(g);

function decide(row, rec, bucket, id) {
  const fams = familiesOf(row);
  const negToggleOnly = row.a.length > 0 && row.a.every((t) => t.n && t.f === 'own toggle');
  switch (row.k) {
    case 'Strike': {
      const nm = row.s;
      const gs = (rec.grantedStrikes || []).filter((g) => NAME(g.name) === nm);
      if (!gs.length) {
        if (stanceOf(id)?.strikes?.some((s) => NAME(s.name) === nm)) return KEPT('stance');
        if ((modesBy.get(id) || []).some((m) => (m.grantedStrikes || []).some((g) => NAME(g.name) === nm) || m.battleForm)) return KEPT('mode');
        if (choiceGrants(rec).some((g) => (g.grantedStrikes || []).some((x) => NAME(x.name) === nm))) return KEPT('choice-gated grant');
        return ABSENT;
      }
      const replacedBy = (x) => {
        const other = String(x || '').split(':').pop();
        const o = core.feats?.[other] || core.classFeatures?.[other];
        return (o?.replacesStrikes || []).some((n) => NAME(n) === nm) || (o?.grantedStrikes || []).some((g) => NAME(g.name) === nm);
      };
      return overOrKept(
        'grantedStrikes',
        uncovered(row, rec, (f, ft) => {
          if (f === 'own choice') return gs.some((g) => g.choiceValue);
          // collectGrantedNaturals tests whenHeritage / whenHeritageChoice BEFORE its name dedup, so a row
          // carries the condition only when every same-named row is gated and the gate is alive.
          if (f === 'heritage/ancestry/trait') return gs.every((g) => liveHeritageGate(g));
          if (f === 'other roll option') return gs.every((g) => !!g.choiceValue || (!!g.whenHeritageChoice && !heritageGateProblem(g)));
          if (f === 'self effect/condition') return !!rec.grantedStrikesState && ft.every((t) => t.st === rec.grantedStrikesState);
          if (f === 'feature/class/feat') return ft.every((t) => (t.n ? replacedBy(t.x) : !!t.o));
          return false;
        }),
      );
    }
    case 'FlatModifier': {
      const results = [];
      row.s.forEach((sel, i) => {
        const st = statOf(sel);
        const field = unconditionalAnalog(rec, st, row.sk);
        const sib = !!row.sib?.[i];
        const how = conditionalCarrier(id, rec, st);
        const fv = field ? getPath(rec, field.split('+')[0]) : undefined;
        if (field && typeof fv === 'string' && /@actor\.speed/.test(fv)) results.push(KEPT('formula on the existing Speed', field));
        else if (field === 'unarmoredAc' && fams.length && fams.every((f) => f === 'armor/shield')) results.push(KEPT('unarmoredAc applies only unarmored', field));
        else if (field && negToggleOnly) results.push(KEPT('default state (unless the own toggle is on)', field));
        else if (field && st.k === 'speed' && (rec.whileActive || []).some((w) => w.landSpeedBonus != null || w.speeds) && fams.length && fams.every((f) => f === 'self effect/condition')) results.push(KEPT('standing value + whileActive state value', field));
        else if (field && sib) results.push(KEPT('unpredicated sibling', field));
        else if (field) results.push(overOrKept(field, uncovered(row, rec), how));
        else if (how.length) results.push(KEPT(how));
        else results.push(ABSENT);
      });
      return results.find((r) => r.status === 'OVER') || results.find((r) => r.status === 'CARRIED') || results[0] || ABSENT;
    }
    case 'BaseSpeed': {
      const st = { k: 'speed', t: row.s };
      const field = unconditionalAnalog(rec, st);
      const how = conditionalCarrier(id, rec, st);
      if (choiceGrants(rec).some((g) => g.speeds?.[row.s] != null)) how.push('choice-gated grant');
      if ((rec.whileActive || []).some((w) => w.speeds?.[row.s] != null)) how.push('whileActive');
      if ((rec.speedsIf || []).some((w) => w.speeds?.[row.s] != null)) how.push('speedsIf');
      const fv = field ? getPath(rec, field) : undefined;
      if (field && typeof fv === 'string' && /@actor\.speed/.test(fv)) return KEPT('formula on the existing Speed', field);
      if (field && row.sib) return KEPT('unpredicated sibling', field);
      if (field) return overOrKept(field, uncovered(row, rec), how);
      return how.length ? KEPT(how) : ABSENT;
    }
    case 'Sense': {
      const nm = row.s;
      const has = (list) => (list || []).some((s) => s.name === nm || s.name?.replace(/-/g, '') === nm.replace(/-/g, ''));
      const how = [];
      if ((rec.conditionalSenses || []).some((c) => c.ifPresent || c.base?.name === nm || c.upgraded?.name === nm)) how.push('conditionalSenses');
      if (rec.darkvisionIfAncestryLowLight && nm === 'darkvision') how.push('darkvisionIfAncestryLowLight');
      if ((rec.whileActive || []).some((w) => has(w.senses) || w.conditionalSenses)) how.push('whileActive');
      if ((modesBy.get(id) || []).some((m) => has(m.senses) || has(m.battleForm?.senses))) how.push('mode');
      const s = stanceOf(id);
      if (s && (has(s.senses) || s.senseIfFeat)) how.push('stance');
      if (choiceGrants(rec).some((g) => has(g.senses) || g.conditionalSenses)) how.push('choice-gated grant');
      const field = has(rec.senses) ? 'senses' : has(rec.passiveEffects?.senses) ? 'passiveEffects.senses' : null;
      if (field && row.sib) return KEPT('unpredicated sibling', field);
      // A sense entry's whenCreatureTrait is the sense twin of the IWR gate: deriveDefenses skips the
      // entry for a character without that trait (hasCreatureTrait), so it carries "only if you are a
      // dwarf" (Axe of the Dwarven Lords, equipment-609) — every same-named entry must carry it.
      const entries = [...(rec.senses || []), ...(rec.passiveEffects?.senses || [])].filter((s) => s && typeof s === 'object' && has([s]));
      if (field) return overOrKept(field, uncovered(row, rec, (f) => f === 'heritage/ancestry/trait' && entries.length > 0 && entries.every((s) => !!s.whenCreatureTrait)), how);
      return how.length ? KEPT(how) : ABSENT;
    }
    case 'Resistance':
    case 'Weakness':
    case 'Immunity': {
      const fieldName = row.k === 'Resistance' ? 'resistances' : row.k === 'Weakness' ? 'weaknesses' : 'immunities';
      const types = row.s;
      const typeOf = (e) => (typeof e === 'string' ? e : e?.type);
      const has = (list) => (list || []).some((e) => types.includes(typeOf(e)));
      const how = [];
      if ((rec.whileActive || []).some((w) => has(w[fieldName]))) how.push('whileActive');
      if ((modesBy.get(id) || []).some((m) => has(m[fieldName]) || has(m.battleForm?.[fieldName]))) how.push('mode');
      if (has(stanceOf(id)?.[fieldName])) how.push('stance');
      if (choiceGrants(rec).some((g) => has(g[fieldName]))) how.push('choice-gated grant');
      if (rec.choiceResistance && row.k === 'Resistance') how.push('choiceResistance');
      if (starsOf(id).length) how.push('situational star (any)');
      if ((rec.situational || []).length) how.push('record star');
      const field = has(rec[fieldName]) ? fieldName : has(rec.passiveEffects?.[fieldName]) ? `passiveEffects.${fieldName}` : null;
      if (row.k === 'Weakness') {
        for (const t of row.a.filter((x) => x.n && /^(feat|feature):/.test(x.x || ''))) {
          const o = core.feats?.[t.x.split(':').pop()] || core.classFeatures?.[t.x.split(':').pop()];
          if ((o?.removesWeaknesses || []).some((w) => types.includes(w))) return KEPT(`removesWeaknesses on ${t.x}`, field);
        }
      }
      if (!field) return how.length ? KEPT(how) : ABSENT;
      if (row.sib) return KEPT('unpredicated sibling', field);
      if (negToggleOnly) return KEPT('default state (unless the own toggle is on)', field);
      const entries = [...(rec[fieldName] || []), ...(rec.passiveEffects?.[fieldName] || [])].filter((e) => e && typeof e === 'object' && types.includes(e.type));
      const minLevel = entries.length && entries.every((e) => e.minLevel != null) ? Math.min(...entries.map((e) => e.minLevel)) : null;
      return overOrKept(
        field,
        uncovered(
          row,
          rec,
          (f) => {
            if (f === 'armor/shield') return !!rec.defensesRequire || (entries.length > 0 && entries.every((e) => !!e.whenArmorCategory));
            // An entry's `condition` only ANNOTATES a number that is still counted, so it carries nothing
            // (ruling B); `against` withholds the entry from the total, the star-like carrier.
            if (f === 'other roll option' || f === 'own choice' || f === 'heritage/ancestry/trait') return entries.length > 0 && entries.every((e) => e.whenVoidHealing != null || !!e.whenCreatureTrait || !!e.unlessCreatureTrait);
            if (f === 'roll context' || f === 'target' || f === 'effect trait') return entries.length > 0 && entries.every((e) => !!e.against);
            return false;
          },
          minLevel,
        ),
        how,
      );
    }
    case 'ActorTraits': {
      const add = row.s;
      const ab = new Set(row.ab || []);
      const top = (rec.grantsCreatureTraits || []).filter((t) => add.includes(t) && !ab.has(t));
      const how = [];
      if ((rec.grantsCreatureTraits || []).some((t) => add.includes(t) && ab.has(t))) how.push('trait appears under every branch');
      if ((modesBy.get(id) || []).some((m) => (m.creatureTraits || []).some((t) => add.includes(t)))) how.push('mode');
      if (choiceGrants(rec).some((g) => (g.grantsCreatureTraits || []).some((t) => add.includes(t)))) how.push('choice-gated grant');
      if (rec.grantsCreatureTraitFromChoice) how.push('grantsCreatureTraitFromChoice');
      if (top.length) return overOrKept('grantsCreatureTraits', uncovered(row, rec), how);
      return how.length ? KEPT(how) : ABSENT;
    }
    case 'CreatureSize': {
      const field = rec.sizeOverride ? 'sizeOverride' : rec.sizeSet ? 'sizeSet' : null;
      if (field) return overOrKept(field, uncovered(row, rec));
      return (modesBy.get(id) || []).some((m) => m.battleForm?.size) ? KEPT('mode') : ABSENT;
    }
    case 'MultipleAttackPenalty': {
      if (!rec.mapReduction) return ABSENT;
      if (rec.mapReduction.whileState || rec.mapReduction.appliesWhen) return KEPT('mapReduction whileState/appliesWhen', 'mapReduction');
      if (row.a.length && row.a.every((t) => t.ag) && rec.mapReduction.agileStep != null && rec.mapReduction.step == null) return KEPT('mapReduction agileStep', 'mapReduction');
      return overOrKept('mapReduction', uncovered(row, rec));
    }
    case 'DexterityModifierCap': {
      if (rec.unarmoredAc?.dexCap != null) return KEPT('unarmoredAc applies only unarmored', 'unarmoredAc.dexCap');
      if (rec.passiveEffects?.dexCap != null) return rec.unarmoredAc ? KEPT('unarmoredAc applies only unarmored', 'passiveEffects.dexCap') : overOrKept('passiveEffects.dexCap', uncovered(row, rec));
      return stanceOf(id)?.dexCap ? KEPT('stance') : ABSENT;
    }
    case 'DamageDice': {
      const sd = (rec.strikeDamage || []).filter((x) => x.dice);
      const how = [];
      if ((modesBy.get(id) || []).some((m) => m.strikeDamage)) how.push('mode');
      if (stanceOf(id)?.strikeDamage) how.push('stance');
      if (starsOf(id).some((b) => (b.targets || []).some((t) => t.kind === 'strikeDamage'))) how.push('situational star');
      if (rec.precisionDice) how.push('precisionDice');
      if (!sd.length) return how.length ? KEPT(how) : ABSENT;
      return overOrKept(
        'strikeDamage',
        uncovered(row, rec, (f) => {
          if (f === 'item') return sd.some((x) => x.strikeName || x.fromChoiceFlag || (x.appliesTo && x.appliesTo !== 'all') || x.byStrikeProficiency);
          if (f === 'proficiency-rank') return sd.some((x) => x.byStrikeProficiency);
          return false;
        }),
        how,
      );
    }
    case 'AdjustStrike': {
      const riders = [...[].concat(rec.unarmedTraits || []), ...[].concat(rec.weaponTraits || [])];
      const hit = riders.filter((r) => !row.s || JSON.stringify(r).includes(row.s));
      if (!hit.length) return (modesBy.get(id) || []).some((m) => m.unarmedTraits || m.weaponTraits) ? KEPT('mode') : ABSENT;
      // the rider's match carries WHICH Strike (item, own choice); the predicate's other families are WHEN
      return overOrKept(rec.unarmedTraits ? 'unarmedTraits' : 'weaponTraits', uncovered(row, rec, (f) => f === 'item' || f === 'own choice'));
    }
    case 'AdjustDegreeOfSuccess': {
      const ds = rec.degreeShifts || [];
      if (!ds.length) return starsOf(id).length ? KEPT('situational star') : ABSENT;
      if (!ds.some((x) => !x.when && !(x.actions || []).length)) return KEPT('degreeShift when/actions', 'degreeShifts');
      return overOrKept('degreeShifts', uncovered(row, rec, (f) => f === 'proficiency-rank'));
    }
    case 'GrantItem': {
      const target = row.s;
      const lists = {
        grantsFeats: rec.grantsFeats,
        grantsClassFeatures: rec.grantsClassFeatures,
        grantsItems: (rec.grantsItems || []).map((g) => g.itemId),
        grantedFeatId: rec.grantedFeatId ? [rec.grantedFeatId] : [],
        grantsActions: (rec.grantsActions || []).map((g) => (typeof g === 'string' ? g : g?.id || g?.actionId)),
        featureIds: rec.featureIds,
      };
      const field = Object.entries(lists).find(([, v]) => (v || []).includes(target))?.[0];
      if (!field) {
        if (choiceGrants(rec).some((g) => JSON.stringify(g).includes(`"${target}"`))) return KEPT('choice-gated grant');
        if (JSON.stringify(rec).includes(`"${target}"`)) return KEPT('named elsewhere on the record (a gated field)');
        return ABSENT;
      }
      if (row.sib) return KEPT('unpredicated sibling', field);
      const gi = field === 'grantsItems' ? (rec.grantsItems || []).find((g) => g.itemId === target) : null;
      if (gi && (gi.whenChoice || gi.minLevel || gi.maxLevel)) return KEPT('grantsItems whenChoice/minLevel/maxLevel', field);
      if (field === 'grantedFeatId' && rec.grantedFeatByChoice) return KEPT('grantedFeatByChoice', field);
      if (row.idem) return KEPT('"unless you already have it"', field);
      const t = row.a;
      const classRoute =
        bucket === 'classFeatures' &&
        t.length > 0 &&
        t.every((a) => (/^class:/.test(a.x || '') && !a.n) || (a.n && (/^feat:/.test(a.x || '') || a.p === 'parent')) || (a.o && /^feat:/.test(a.x || '') && t.some((b) => b.o && /^class:/.test(b.x || ''))));
      if (classRoute) return KEPT('class route only (a dedication pick does not own the feature)', field);
      return overOrKept(field, uncovered(row, rec));
    }
    case 'ActiveEffectLike': {
      const p = row.s;
      if (p === 'system.attributes.hp.negativeHealing') return rec.negativeHealing ? overOrKept('negativeHealing', uncovered(row, rec)) : ABSENT;
      const s = p.match(/^system\.skills\.([a-z-]+)\.rank$/)[1];
      const opt = SUBCLASS_OPTION.get(id);
      if (opt && (opt.o.grants?.skills || []).includes(s)) {
        const field = `(classes/${opt.cls}).subclass.options[${id}].grants.skills`;
        // build.ts grantOptions: an option's grants.skills apply ONLY on the class's own pick
        const routeOnly = row.a.every((a) => (a.x === `class:${opt.cls}` && !a.n) || (a.n && (/^feat:/.test(a.x || '') || a.p === 'parent')));
        return routeOnly ? KEPT('class route only (build.ts grantOptions)', field) : overOrKept(field, uncovered(row, rec));
      }
      if (opt && (opt.o.skillChoice || []).includes(s)) return KEPT('subclass skillChoice');
      if (rec.trainedSkill === s) return overOrKept('trainedSkill', uncovered(row, rec));
      if ((rec.grants?.skills || []).includes(s)) return overOrKept('grants.skills', uncovered(row, rec));
      if (choiceGrants(rec).some((g) => JSON.stringify(g.skills || g.trainedSkills || []).includes(s))) return KEPT('choice-gated grant');
      return ABSENT;
    }
    default:
      return ABSENT;
  }
}
/** A melee-/ranged-/unarmed-only selector against a strikeDamage entry that applies to every Strike. */
function selectorOver(row, rec) {
  if (!row.sc) return null;
  const bad = (rec.strikeDamage || []).filter((x) => (x.appliesTo ?? 'all') === 'all' && !x.strikeName && !x.fromChoiceFlag);
  return bad.length ? `${row.sc}-only selector` : null;
}

/* ====================================================================================================
 * 4. RUN — units (record + key + counterpart signature), the allow file, the report
 * ==================================================================================================== */
/* A DEAD heritage gate on any shipped granted Strike (see heritageGateProblem). */
for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object' || Array.isArray(recs)) continue;
  for (const [id, rec] of Object.entries(recs)) {
    (Array.isArray(rec?.grantedStrikes) ? rec.grantedStrikes : []).forEach((g, i) => {
      if (g?.whenHeritage == null && g?.whenHeritageChoice == null) return;
      const bad = heritageGateProblem(g);
      if (bad) fail(`DEAD GATE ${bucket}/${id} grantedStrikes[${i}] (${g.name}): ${bad} — collectGrantedNaturals would grant the attack to nobody`);
    });
  }
}

const sigOf = (row) => (Array.isArray(row.s) ? row.s.join(',') : String(row.s ?? ''));
const IWR = new Set(['Resistance', 'Weakness', 'Immunity']);
const units = new Map(); // `${record}|${key}|${sig}` → { record, key, sig, fams:Set, fields:Set, n }
const stats = { rows: 0, kept: 0, absent: 0, over: 0, darkStar: 0 };
const rank = { lit: 0, partly: 1, dark: 2 };
for (const row of rows) {
  const slash = row.r.indexOf('/');
  const bucket = row.r.slice(0, slash);
  const id = row.r.slice(slash + 1);
  const rec = recOf(row.r);
  if (!rec) continue;
  stats.rows++;
  let res = row.a.length ? decide(row, rec, bucket, id) : { status: 'NONE', how: [] };
  const sel = selectorOver(row, rec);
  if (sel) res = { status: 'OVER', field: 'strikeDamage', fams: [...new Set([...(res.status === 'OVER' ? res.fams : []), sel])], how: res.how || [] };
  if (res.status === 'NONE') continue; // an unpredicated selector row that narrows fine
  if (res.status === 'CARRIED') {
    stats.kept++;
    if (!res.field && res.how.length && res.how.every((h) => STAR_HOW.has(h))) {
      const dark = res.how.every((h) => (h === 'record star' ? trustOf(row.r, 'situational') === 'dark' : sitOff.has(id)));
      if (dark) stats.darkStar++;
    }
    continue;
  }
  if (res.status === 'ABSENT') {
    stats.absent++;
    continue;
  }
  stats.over++;
  const k = `${row.r}|${row.k}|${sigOf(row)}`;
  const u = units.get(k) ?? units.set(k, { record: row.r, key: row.k, sig: sigOf(row), fams: new Set(), fields: new Set(), n: 0 }).get(k);
  res.fams.forEach((f) => u.fams.add(f));
  u.fields.add(res.field);
  u.n++;
}
/** The trust state of some [record, field] pairs: 'dark' only when EVERY field is dark, 'lit' when every one
 *  is lit, else 'partly' — a lit field must never hide behind a dark sibling's label (2026-10-17 round 2). */
const trustOfFields = (pairs) => {
  const ts = pairs.map(([r, f]) => trustOf(r, f));
  if (!ts.length || ts.every((t) => t === 'lit')) return 'lit';
  return ts.every((t) => t === 'dark') ? 'dark' : 'partly';
};
const trustOfUnit = (u) => trustOfFields([...u.fields].map((f) => [u.record, f]));
const trustLabel = (t) => (t === 'partly' ? 'partly dark' : t);

/* ---------- the allow file ---------- */
const mirrorOn = existsSync(MIRROR);
const norm = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:!?)])/g, '$1') // the mirror leaves a space where a link ended ("enlarge , and")
    .trim()
    .toLowerCase();
const docText = (aonId) => {
  const cat = String(aonId).replace(/-\d+(?:-\d+)*$/, '');
  const p = join(MIRROR, cat, `${aonId}.json`);
  if (!existsSync(p)) return null;
  return norm(JSON.parse(readFileSync(p, 'utf8')).text);
};
const ownPages = (key, rec) => {
  const pages = [rec?.aonId, rec?.aonParentId];
  const id = key.slice(key.indexOf('/') + 1);
  if (key.startsWith('classFeatures/') && SUBCLASS_OPTION.has(id)) pages.push(core.classes?.[SUBCLASS_OPTION.get(id).cls]?.aonId);
  return [...new Set(pages.filter(Boolean))];
};
let questions = null;
if (existsSync(QUESTIONS)) {
  const q = readJson(QUESTIONS);
  questions = new Map();
  for (const list of ['open', 'deferred', 'ruled', 'authorisedExceptions']) for (const e of q[list] || []) if (e?.n != null) questions.set(Number(e.n), list);
}
const VERDICTS = new Set(['print-unconditional', 'route', 'default-state', 'needs-reading', 'kept-over-grant']);
const TRUSTS = new Set(['dark', 'partly', 'lit']);
const modesOff = new Set(ledger.lanes?.modes || []);
/** A kept over-grant's `blockedBy.gate` carrier: null when it exists, belongs to the record and is DARK;
 *  'LIT' when it is lit now; otherwise what is wrong with it. */
function gateCarrier(spec, recordKey, rec) {
  const id = recordKey.slice(recordKey.indexOf('/') + 1);
  if (spec === 'record-star') {
    if (!(rec.situational || []).length) return 'record-star: the record has no `situational` star';
    return trustOf(recordKey, 'situational') === 'dark' ? null : 'LIT';
  }
  const m = String(spec).match(/^(star|mode):(.+)$/);
  if (m?.[1] === 'star') {
    if (m[2] !== id) return `${spec}: a star is keyed by the record's own id (star:${id})`;
    if (!FEAT_SITUATIONAL[id] && !CHOICE_SITUATIONAL[id]) return `${spec}: no FEAT_SITUATIONAL/CHOICE_SITUATIONAL entry "${id}"`;
    return sitOff.has(id) ? null : 'LIT';
  }
  if (m?.[1] === 'mode') {
    if (!core.modes?.[m[2]]) return `${spec}: no mode "${m[2]}" in core.json`;
    if (!(modesBy.get(id) || []).some((x) => x.id === m[2])) return `${spec}: that mode does not belong to ${recordKey}`;
    return modesOff.has(m[2]) ? null : 'LIT';
  }
  return `"${spec}" is not star:<id>, mode:<id> or record-star`;
}
/*
 * WHAT A KEPT OVER-GRANT WAITS ON. The only reason left to keep a known over-grant (the owner's rule,
 * 2026-10-17) is an approval only he can give: the desk number `awaitsApproval` whose approvals row in
 * scripts/data/trust-approvals.json would light the entry's dark gate. Tied to that file so the wait is
 * checked, not asserted — `{ pending }` says what it waits on; `{ problem }` fails the entry.
 */
const approvalsFile = existsSync(APPROVALS) ? readJson(APPROVALS) : null;
function approvalWait(n, record, followUp) {
  const desk = APPROVALS.replace(ROOT, '.').replace(/\\/g, '/');
  if (!Number.isInteger(n)) return { problem: "a kept-over-grant entry needs `awaitsApproval` — the desk number whose approval would light its gate (ruling #126 for a Ruling-B star); a known over-grant with no approval to wait on fails" };
  if (questions && !questions.has(n)) return { problem: `awaitsApproval #${n} is not a desk number in ${QUESTIONS.replace(ROOT, '.')}` };
  if (!approvalsFile) return { pending: `ruling #${n} (${desk} not found: not checked)` };
  const rowsFor = (list) => (Array.isArray(approvalsFile[list]) ? approvalsFile[list] : []).filter((x) => x?.n === n);
  const landed = rowsFor('approvals').filter((x) => x.record === record);
  if (landed.length)
    return {
      stale: true,
      problem: `awaitsApproval #${n} has LANDED — ${desk} approves ${record} (${landed.map((x) => (x.fields || []).join('+') || 'its fields').join('; ')}). Re-stamp the ledger (wg-diff, then trust-ledger.mjs) so the gate is lit, retire the number (${String(followUp ?? '').trim()}), then remove this entry`,
    };
  for (const list of ['noMechanic', 'engine'])
    if (rowsFor(list).length) return { problem: `awaitsApproval #${n} is disposed as ${list} in ${desk} — no approval can light the gate through it, so the over-grant waits on nothing: fix it, or name the number that will approve it` };
  if (rowsFor('unruled').length) return { pending: `ruling #${n} is unruled in ${desk}` };
  if (rowsFor('approvals').length) return { pending: `ruling #${n} is approved in ${desk} for other records, not this one yet` };
  return { problem: `awaitsApproval #${n} has no disposition in ${desk}` };
}
/** kept-over-grant entry → what it is waiting on (only entries whose wait checked out). */
const waiting = new Map();
let quotesUnchecked = 0;
const entries = Array.isArray(allow.entries) ? allow.entries : [];
const covered = new Map(); // unit key → Map(family → entry)
entries.forEach((e, i) => {
  const label = `allow entry ${i + 1} (${e.record} ${e.key}${e.selector != null ? ' ' + e.selector : ''}${e.type != null ? ' ' + e.type : ''})`;
  const rec = e.record ? recOf(e.record) : null;
  if (!rec) {
    fail(`STALE ${label}: no record ${e.record} in core.json — remove the entry`);
    return;
  }
  if (!e.key) fail(`${label}: no \`key\` (the Foundry rule key)`);
  if (e.selector != null && IWR.has(e.key)) fail(`${label}: Resistance/Weakness/Immunity entries name their counterpart by \`type\`, not \`selector\``);
  if (e.type != null && !IWR.has(e.key)) fail(`${label}: only Resistance/Weakness/Immunity entries take \`type\`; use \`selector\``);
  if (!Array.isArray(e.families) || !e.families.length) fail(`${label}: no \`families\` (which conditions the entry excuses)`);
  for (const f of e.families || []) if (!FAMILIES.has(f)) fail(`${label}: unknown family "${f}"`);
  if (!VERDICTS.has(e.verdict)) fail(`${label}: verdict ${JSON.stringify(e.verdict)} is not one of ${[...VERDICTS].join(', ')}`);
  if (e.verdict === 'needs-reading') {
    if (!Number.isInteger(e.ownerQuestion)) fail(`${label}: a needs-reading entry needs \`ownerQuestion\` (the desk number asking the owner)`);
    else if (questions) {
      const where = questions.get(e.ownerQuestion);
      if (!where) fail(`${label}: owner question #${e.ownerQuestion} is not in ${QUESTIONS.replace(ROOT, '.')}`);
      else if (where !== 'open' && where !== 'deferred') fail(`${label}: owner question #${e.ownerQuestion} is ${where} — apply the ruling and change the verdict`);
    }
  }
  if (e.verdict === 'kept-over-grant') {
    const gate = Array.isArray(e.blockedBy?.gate) ? e.blockedBy.gate : [];
    const files = Array.isArray(e.blockedBy?.files) ? e.blockedBy.files : [];
    if (!gate.length && !files.length) fail(`${label}: a kept-over-grant entry needs \`blockedBy\` — { gate: [the dark star/mode the owner's approval would light] }`);
    else if (!gate.length)
      fail(
        `${label}: a known over-grant FAILS (the owner's rule, 2026-10-17) — blockedBy names only files (${files.join(', ')}), a fix nobody made rather than a wait on the owner. ` +
          `Fix it and remove the entry; only a dark gate waiting on his approval (blockedBy.gate + awaitsApproval) may hold an over-grant back`,
      );
    if (!e.followUp || !String(e.followUp).trim()) fail(`${label}: a kept-over-grant entry needs \`followUp\` (the fix, once unblocked)`);
    const wait = approvalWait(e.awaitsApproval, e.record, e.followUp);
    if (wait.problem) fail(`${wait.stale ? 'STALE ' : ''}${label}: ${wait.problem}`);
    else waiting.set(e, wait.pending);
    for (const g of gate) {
      const bad = gateCarrier(g, e.record, rec);
      if (bad === 'LIT') fail(`STALE ${label}: ${g} is LIT now — it carries the condition, so remove the over-granting number (${String(e.followUp ?? '').trim()}) and then this entry`);
      else if (bad) fail(`${label}: blockedBy.gate ${bad}`);
    }
    for (const f of files) if (typeof f !== 'string' || !existsSync(join(ROOT, f))) fail(`${label}: blockedBy.files names ${JSON.stringify(f)}, which is not a file in the repo`);
    if (!TRUSTS.has(e.trust)) fail(`${label}: a kept-over-grant entry needs \`trust\` — the trust state ('dark', 'partly' or 'lit') of its over-granting field when the entry was written, so the check sees it turn lit`);
  } else if (e.blockedBy != null || e.followUp != null || e.trust != null || e.awaitsApproval != null) {
    fail(`${label}: \`blockedBy\`/\`followUp\`/\`trust\`/\`awaitsApproval\` belong to a kept-over-grant entry — a ${e.verdict} entry says the record is right, not blocked`);
  }
  if (!e.why || !String(e.why).trim()) fail(`${label}: no \`why\``);
  const pages = ownPages(e.record, rec);
  if (!e.aonId || !pages.includes(e.aonId)) fail(`${label}: aonId ${e.aonId ?? '(none)'} is not the record's page (${pages.join(', ') || 'none'})`);
  if (String(e.quote ?? '').trim().split(/\s+/).length < 4) fail(`${label}: the quote is too short to be a printed clause`);
  else if (!mirrorOn) quotesUnchecked++;
  else if (e.aonId) {
    const text = docText(e.aonId);
    if (text == null) fail(`${label}: ${e.aonId} is not in the Archives mirror`);
    else if (!text.includes(norm(e.quote))) fail(`${label}: the quote is not printed in ${e.aonId}`);
  }
  // which units it covers
  const want = e.selector ?? e.type;
  const hits = [...units.values()].filter((u) => u.record === e.record && u.key === e.key && (want == null || u.sig === String(want)));
  for (const f of e.families || []) {
    const on = hits.filter((u) => u.fams.has(f));
    if (!on.length) {
      fail(`STALE ${label}: "${f}" no longer over-grants on ${e.record} ${e.key}${want != null ? ' ' + want : ''} — remove it from the entry`);
      continue;
    }
    for (const u of on) {
      const k = `${u.record}|${u.key}|${u.sig}`;
      const byFam = covered.get(k) ?? covered.set(k, new Map()).get(k);
      // One condition, one entry: a second entry on the same counterpart and family (a pasted twin, or
      // a selector-less entry overlapping a narrower one) would let one of them go stale unseen.
      const prev = byFam.get(f);
      if (prev && prev !== e) fail(`${label}: duplicates allow entry ${entries.indexOf(prev) + 1} on ${u.record} ${u.key}${u.sig ? ' ' + u.sig : ''} "${f}" — keep one entry per condition`);
      else byFam.set(f, e);
    }
  }
  // A kept over-grant's trust state must stay what the entry says: an approval that lights the over-
  // granting FIELD (rather than the gate carrier) would otherwise switch the too-broad effect on with
  // verify green (the 2026-10-17 round-2 finding, made on the file-blocked sprites-spark entry, which is
  // fixed now; file-blocked entries fail outright since the owner's rule that known over-grants fail).
  if (e.verdict === 'kept-over-grant' && TRUSTS.has(e.trust)) {
    const on = hits.filter((u) => (e.families || []).some((f) => u.fams.has(f)));
    if (on.length) {
      const pairs = on.flatMap((u) => [...u.fields].map((f) => [u.record, f]));
      const live = trustOfFields(pairs);
      const where = [...new Set(pairs.map(([, f]) => f).filter(Boolean))].join(', ') || '(the record)';
      if (rank[live] < rank[e.trust])
        fail(
          `${label}: a kept ${e.trust.toUpperCase()} over-grant is ${live === 'partly' ? 'PARTLY LIT' : 'LIT'} now (${where}) — players see the too-broad effect. ` +
            `Fix it before the approval lands (${String(e.followUp ?? '').trim()}); writing trust '${live}' instead keeps a lit over-grant on players' sheets, which is the orchestrator's call`,
        );
      else if (rank[live] > rank[e.trust])
        fail(`STALE ${label}: trust says ${e.trust} but the over-granting field is ${live} now (${where}) — set trust to '${live}', or it could turn lit again unseen`);
    }
  }
});

/* ---------- report ---------- */
const lines = { fail: [], warn: [], kept: [], allowed: [] };
let keptLit = 0;
for (const [k, u] of [...units.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const t = trustLabel(trustOfUnit(u));
  const cov = covered.get(k) ?? new Map();
  const left = [...u.fams].filter((f) => !cov.has(f)).sort();
  const sig = u.sig ? ` ${IWR.has(u.key) ? 'type' : 'selector'} ${u.sig}` : '';
  const where = [...u.fields].filter(Boolean).join(', ');
  for (const [f, e] of cov) {
    if (e.verdict === 'kept-over-grant') {
      const by = [...(e.blockedBy?.gate || []).map((g) => `dark ${g}`), ...(e.blockedBy?.files || [])].join(', ');
      const on = waiting.get(e) ?? 'its wait did not check out (see the failures)';
      lines.kept.push(`[${t}] ${u.record} | ${u.key}${sig} | ${f} | on ${where || '(the record)'} | ${on} | blocked by ${by} (${e.aonId})`);
      if (t !== 'dark') keptLit++;
      continue;
    }
    const line = `[${t}] ${u.record} | ${u.key}${sig} | ${f} | ${e.verdict} (${e.aonId})${e.ownerQuestion ? ` owner question #${e.ownerQuestion}` : ''}`;
    (e.verdict === 'needs-reading' ? lines.warn : lines.allowed).push(line);
  }
  if (left.length) {
    lines.fail.push(`OVER-GRANT [${t}] ${u.record} | ${u.key}${sig} | families: ${left.join(', ')} | on ${where || '(the record)'}`);
  }
}
for (const l of lines.fail) fail(l);

console.log(
  `lost-condition: ${stats.rows} Foundry rule row(s) on shipped records ${measured ? `measured from the packs${measured.cached ? ' (index cache)' : ''}` : 'from the snapshot (no Foundry packs here)'}; ` +
    `${stats.kept} condition(s) kept, ${stats.absent} effect(s) absent, ${stats.over} over-grant row(s) in ${units.size} counterpart(s); ` +
    `${entries.length} allow entr(y/ies) (${lines.allowed.length} allowed, ${lines.warn.length} needs-reading, ${lines.kept.length} waiting for the owner's approval).`,
);
if (lines.kept.length)
  console.log(
    `  ${lines.kept.length} over-grant line(s) WAITING for the owner's approval of the Ruling-B star, ${keptLit} of them lit (a player sees the too-broad number until he approves): ` +
      `not a failure while the approval is pending — every other known over-grant fails.`,
  );
console.log(`  ${stats.darkStar} condition(s) survive only as a DARK star (the trust gate keeps that situational entry off) — not a failure.`);
if (goneRows) console.log(`  ${goneRows} snapshot row(s) name records no longer shipped (rewrite the snapshot to drop them).`);
if (!mirrorOn) console.log(`  (Archives mirror not found at ${MIRROR}: ${quotesUnchecked} quote(s) not checked against print)`);
if (!questions) console.log(`  (owner questions not found at ${QUESTIONS}: needs-reading numbers not checked)`);
for (const l of lines.allowed) console.log(`  allowed ${l}`);
for (const l of lines.warn) console.log(`  WARN needs-reading ${l}`);
for (const l of lines.kept) console.log(`  WARN waiting for the owner's approval of the Ruling-B star ${l}`);
if (failures.length) {
  console.error(`\nlost-condition: FAIL — ${failures.length} problem(s):`);
  for (const f of failures) console.error('   ' + f);
  if (lines.fail.length) {
    console.error(
      `\n   An OVER-GRANT is an effect our record applies more broadly than Foundry's predicate allows. Carry the condition ` +
        `(the accepted carriers are in this script's header) or, where print really says otherwise, list the family in ` +
        `${ALLOW.replace(ROOT, '.')} with the printed clause.`,
    );
  }
  process.exit(1);
}
console.log('lost-condition: ok');
