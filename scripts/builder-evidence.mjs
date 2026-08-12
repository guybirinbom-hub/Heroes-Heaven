/*
 * BUILDER-SIDE EVIDENCE PACKS — what the app ACTUALLY ASKS the player, observed.
 *
 * `feat-evidence.mjs` measures the second half of the owner's mandate ("influencing the character
 * sheet in the correct way") by building with and without a feat and diffing derived values. It never
 * resolves a picker, so it says nothing at all about the first half — "choosing the things that are
 * supposed to be chosen". This is that half.
 *
 * SAME DISCIPLINE, AND FOR THE SAME REASON. Reading `feat.choice` off a record and concluding that a
 * picker exists is exactly the kind of representation-reading that has made four measuring scripts in
 * this project lie. A choice reaches the player through NINE different gates — the record's `choice`,
 * its `effectChoices`, its `languageChoices`, and six id-keyed registries (FEAT_GRANTS.skillChoices /
 * .loreChoices / .bonusSkillFeat, FEAT_PICK_GRANTS, FEAT_FEAT_GRANTS, FEAT_CANTRIP_GRANTS) — and two
 * of those gates SUPPRESS the record's own picker rather than adding one. So this drives the real
 * resolvers (`domainPoolForChoice`, `trainedSkillOptions`, `openChoiceOptions`, `pickableFeats`,
 * `spellsMatching`, `choiceOptionsFor`) against a concrete host character and reports the list that
 * actually comes out.
 *
 * ⚠ The picker gates themselves live in Builder.tsx, which jiti cannot parse. They are mirrored below
 * in `pickersFor`, line-referenced to the source, exactly as feat-evidence.mjs inlines `isActionCost`
 * from widgets.tsx. That mirror is the one thing here that can drift from the app, so it is one
 * function, it is annotated, and `test/builder-evidence.test.ts` pins it against feats whose pickers
 * are already known.
 *
 * ⚠ AN ANSWER IS "READ" ONLY IF IT MOVES SOMETHING. Storing the answer on the character is not
 * reading it: buildCharacter echoes every pick back onto the feat row as `feats[].choice`, so a diff
 * that counts that echo reports 100% coverage for a choice nothing consumes — the
 * write-only-with-no-reader failure this project has already shipped once. The echo paths are
 * excluded explicitly (ECHO_PATH) and the comparison is between TWO DIFFERENT ANSWERS, never between
 * answered and unanswered: build.ts defaults an unanswered choice to option[0], so that comparison
 * would call every working choice dead.
 *
 * ⚠ WHAT THIS DOES NOT OBSERVE, so `not-read` here means "not read ON THE CHARACTER SHEET":
 *   - the COMPANIONS tab. `deriveEidolon` and the companion derivations take a companion the
 *     reference host does not have, so a choice whose only effect lands on an eidolon reports as
 *     unread. Three feats in the frozen 500 are in that state and are false positives of this
 *     harness, not defects: pushing-attack, eidolons-wrath, dual-studies.
 *   - PLAY state — daily choices, uses, modes the player activates. A `daily: true` choice is given
 *     its own verdict rather than being called dead.
 * Anything reported must be read with those two exclusions in hand.
 *
 *   npx jiti scripts/builder-evidence.mjs                  # all 500 -> scripts/audit/builder-500-evidence.json
 *   npx jiti scripts/builder-evidence.mjs --limit 25       # smoke test
 *   npx jiti scripts/builder-evidence.mjs --only assurance,domain-initiate,terrain-scout
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedContent } from '../src/rules/seed';
import { findDuplicateIds } from '../src/data';
import {
  buildCharacter, emptyBuild, levelGrants, checkPrerequisites,
  choiceKeys, choiceOptionsFor, trainedSkillOptions, featChoicePrompt, featChoiceLabel,
  bonusLanguageSlots,
} from '../src/rules/build';
import {
  deriveSave, derivePerception, deriveSkill, deriveClassDc, deriveMaxHp,
  deriveAc, deriveDefenses, deriveStrikes, deriveSpeeds, deriveShield,
  ownedFeatureIds, domainPoolForChoice,
} from '../src/rules/derive';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { openChoiceOptions } from '../src/rules/openChoice';
import { spellsMatching } from '../src/rules/spellChoice';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { FEAT_PICK_GRANTS, pickableFeats } from '../src/rules/featPickGrants';
import { FEAT_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import { FEAT_CANTRIP_GRANTS } from '../src/rules/featCantripGrants';
import { featSituationalFor } from '../src/rules/situationalBonuses';
import { statMarkClass, recordMarkersFor } from '../src/rules/explain';
import { SKILLS } from '../src/rules/types';

/* Inlined from src/sheet/widgets.tsx:63 — the gate MainTab uses to decide whether a record reaches
 * the encounter action list. Same inline, same reason, as feat-evidence.mjs:32. */
const isActionCost = (c) => !!c && (c.type === 'actions' || c.type === 'reaction' || c.type === 'free' || c.type === 'variable');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };

/* ── Content, exactly as the app assembles it ──────────────────────────────────────────────────
 * Descriptions merged back in (they live in a second file), and `duplicateIds` computed with the
 * app's own function — eligibleFeatsForSlot reads it, and without it every `aon-` scrape duplicate
 * counts as a separate eligible feat. */
let _db = null;
export function loadDb() {
  if (_db) return _db;
  const core = JSON.parse(read('public/core.json'));
  const desc = JSON.parse(read('public/core-descriptions.json'));
  for (const [bucket, records] of Object.entries(desc)) {
    if (!core[bucket]) continue;
    for (const [id, v] of Object.entries(records)) {
      const rec = core[bucket][id];
      if (rec && v.d !== undefined) rec.description = v.d;
    }
  }
  const db = {};
  for (const k of new Set([...Object.keys(seedContent), ...Object.keys(core)])) {
    db[k] = { ...(seedContent[k] ?? {}), ...(core[k] ?? {}) };
  }
  db.duplicateIds = findDuplicateIds(db);
  _db = db;
  return db;
}

/* ── Hosts ─────────────────────────────────────────────────────────────────────────────────────
 * A class feat needs its class or its choices resolve against the wrong build; a domain choice needs
 * a deity or the pool is empty for reasons that have nothing to do with the feat. Matched off the
 * feat's traits, exactly as feat-evidence.mjs:71 does.
 *
 * ⚠ THE HOST HAS TO BE A REAL CHARACTER, not a blank one. Three lanes resolve their options FROM the
 * build — `kind: 'skills'` offers the skills you are trained in, `minRank: 'expert'` the ones you are
 * expert in, and every prerequisite check reads your ranks and attributes. A blank level-20 host is
 * trained in two skills and has 10s across the board, so Assurance appeared to offer TWO options and
 * every feat with a "trained in Society" prerequisite appeared to be takeable by nobody. Both would
 * have read as findings. So the host spends its class skill slots, takes every skill increase, and
 * assigns every attribute boost.
 *
 * ⚠ `ClassDef.keyAbility` is an ARRAY, not `{ options }` — `cls.keyAbility.options[0]` is undefined
 * and silently falls back to Strength. feat-evidence.mjs:87 has that bug; every class it built was a
 * Strength build. Kept correct here.
 */
const byName = (db, coll) => {
  const m = new Map();
  for (const [id, r] of Object.entries(db[coll] ?? {})) if (r?.name) m.set(r.name.toLowerCase(), id);
  return m;
};

const ALL_ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
/** Four distinct attributes per boost event, rotated so no attribute is left at 10. */
const boostSet = (n) => [0, 1, 2, 3].map((i) => ALL_ABILITIES[(n * 4 + i) % 6]);

export function baseBuild(db, classId, ancestryId, level = 20, minimal = false) {
  const cls = db.classes?.[classId];
  const keyAbility = cls?.keyAbility?.[0] ?? 'str';
  const heritageId = Object.values(db.heritages ?? {}).find((h) => h?.ancestryId === ancestryId)?.id ?? null;
  const common = {
    ...emptyBuild(),
    level,
    ancestryId,
    heritageId,
    backgroundId: Object.keys(db.backgrounds ?? {})[0],
    classId,
    subclassId: cls?.subclass?.options?.[0]?.id ?? null,
    keyAbility,
    deityId: Object.keys(db.deities ?? {})[0] ?? null,
  };
  /* ⚠ THE RICH HOST MASKS GRANTS, WHICH IS THE MIRROR OF THE BLANK ONE OFFERING NOTHING. A level-20
   * character trained in twelve skills answers "choose a skill to become trained in" with a skill it
   * already has, whichever option is picked, and the choice looks dead. `goloma-lore`'s replacement
   * picker read exactly that way. So option lists are resolved against the RICH host (which is what
   * the player sees) and a dead-looking answer is re-tested against the MINIMAL one (which is where
   * a grant has room to land). Neither host alone is trustworthy. */
  if (minimal) return common;

  // Class skills: exactly the number the rules give (fixed are already granted), so the character is
  // trained in a realistic set rather than in nothing or in everything.
  const fixed = new Set(cls?.trainedSkills?.fixed ?? []);
  const slots = (cls?.trainedSkills?.additional ?? 0) + 2; // +2 stands in for a typical Int modifier
  const classSkills = SKILLS.filter((s) => !fixed.has(s)).slice(0, slots);

  const skillIncreases = {};
  for (const lvl of cls?.skillIncreaseLevels ?? []) {
    if (lvl <= level) skillIncreases[lvl] = SKILLS[(lvl * 3) % SKILLS.length];
  }

  const attributeBoosts = {};
  [5, 10, 15, 20].forEach((lvl, i) => { if (lvl <= level) attributeBoosts[lvl] = boostSet(i + 1); });

  return {
    ...common,
    classSkills,
    skillIncreases,
    levelBoosts: boostSet(0),
    attributeBoosts,
    ancestryBoosts: ['int', 'cha'],
    backgroundBoosts: ['cha', 'wis'],
  };
}

export function hostIdsFor(feat, db) {
  const cls = byName(db, 'classes');
  const anc = byName(db, 'ancestries');
  let classId = db.classes?.fighter ? 'fighter' : Object.keys(db.classes ?? {})[0];
  let ancestryId = db.ancestries?.human ? 'human' : Object.keys(db.ancestries ?? {})[0];
  for (const t of (feat.traits ?? []).map((x) => String(x).toLowerCase())) {
    if (cls.has(t)) classId = cls.get(t);
    if (anc.has(t)) ancestryId = anc.get(t);
  }
  return { classId, ancestryId };
}

/**
 * Everything about one host that is expensive and reusable: the built character, the feat slots the
 * builder RENDERS for it, and — per slot category — the set of feats that category accepts.
 *
 * The eligible set is computed once per category at that category's HIGHEST rendered level, because
 * eligibleFeatsForSlot's only level test is `f.level > p.level`; a feat admitted at the top level is
 * admitted at every rendered level at or above its own. `bonus` and `mythic` are excluded from that
 * shortcut — both apply level rules that are not monotone — and are resolved per level.
 */
const hostCache = new Map();
export function hostContext(db, classId, ancestryId, level = 20, minimal = false) {
  const ck = `${classId}|${ancestryId}|${level}|${minimal ? 'min' : 'rich'}`;
  if (hostCache.has(ck)) return hostCache.get(ck);
  const build = baseBuild(db, classId, ancestryId, level, minimal);
  const char = buildCharacter(build, db);
  const slots = [];
  for (let lvl = 1; lvl <= level; lvl++) {
    const g = levelGrants(lvl, classId, db, build.subclassId);
    g.featSlots.forEach((category, idx) => slots.push({ level: lvl, category, idx }));
  }
  const PER_LEVEL = new Set(['bonus', 'mythic']);
  const maxByCat = new Map();
  for (const s of slots) if (!PER_LEVEL.has(s.category)) maxByCat.set(s.category, Math.max(maxByCat.get(s.category) ?? 0, s.level));
  const eligibleByCat = new Map();
  for (const [category, lvl] of maxByCat) {
    eligibleByCat.set(category, new Set(eligibleFeatsForSlot(build, db, { level: lvl, category, idx: 0 }).map((f) => f.id)));
  }
  const ctx = { build, char, slots, eligibleByCat, perLevelCats: PER_LEVEL };
  hostCache.set(ck, ctx);
  return ctx;
}

/** The earliest slot the builder renders that would actually offer this feat, or null. */
export function slotFor(ctx, db, feat) {
  for (const s of ctx.slots) {
    if (s.level < (feat.level ?? 1)) continue;
    if (ctx.perLevelCats.has(s.category)) {
      if (eligibleFeatsForSlot(ctx.build, db, s).some((f) => f.id === feat.id)) return s;
      continue;
    }
    if (ctx.eligibleByCat.get(s.category)?.has(feat.id)) return s;
  }
  return null;
}

/* ── The picker mirror ─────────────────────────────────────────────────────────────────────────
 * Every gate below is the one Builder.tsx applies, with its line. Nothing here reads a field and
 * assumes a picker: each entry is produced by the same resolver the builder calls, so an option list
 * this reports is the option list the player sees. */

const optOf = (o) => ({ value: o.value, label: o.label });

/**
 * Records elsewhere in content that WIDEN this record's choice ("add the astral and brilliant
 * property runes to the list of effects you can choose from").
 *
 * `derive.ts:1003 effectiveChoiceOptions` exists to honour them, but its only caller is
 * `dailyChoices.ts` — the builder's `renderChoice` reads `def.options` raw. So a build-time choice
 * with a widening source offers a list that is short by design, and no count on its own would show
 * it. Reported rather than judged: it is a fact about the app, not a verdict about the feat.
 */
let _widening = null;
function wideningSourcesFor(recordId, def, db) {
  if (!_widening) {
    _widening = new Map();
    for (const [id, f] of Object.entries(db.feats ?? {})) {
      for (const a of f?.choiceOptionAdditions ?? []) {
        const list = _widening.get(a.target) ?? [];
        list.push({ from: id, flag: a.flag });
        _widening.set(a.target, list);
      }
    }
  }
  return (_widening.get(recordId) ?? []).filter((w) => !w.flag || w.flag === def.flag).map((w) => w.from);
}

/** renderChoice (Builder.tsx:338) — one entry per pick index, options resolved per `kind`. */
function renderChoicePickers(def, key, build, db, char, featId, laneMeta) {
  const widening = wideningSourcesFor(featId, def, db);
  const shared = {
    prompt: featChoicePrompt(def.prompt, def.flag),
    flag: def.flag,
    kind: def.kind,
    ...(def.daily ? { daily: true } : {}),
    ...(def.inert ? { inert: def.inert } : {}),
    ...(def.note ? { note: def.note } : {}),
    ...(widening.length ? { wideningSources: widening } : {}),
    ...laneMeta,
  };
  // 'text' has no option list at all — the player types (Ruling I: free text is a legitimate choice).
  if (def.kind === 'text') {
    return [{ ...shared, lane: shared.lane ?? 'choice', control: 'text', key, storage: 'featChoices', optionCount: null, options: [] }];
  }
  const keys = choiceKeys(key, def);
  if (def.kind === 'open') {
    const all = openChoiceOptions(def.from, db, { hideLegacy: build.hideLegacy, character: char });
    // 'own-*' descriptors resolve from what the character HAS (openChoice.ts:111-178). A reference
    // host with an empty pack legitimately gets an empty list; that is the host, not the app.
    const hostDependent = /^own-/.test(String(def.from?.type ?? ''));
    return keys.map((k, i) => ({
      ...shared, lane: shared.lane ?? 'choice', control: 'search', key: k, storage: 'featChoices',
      pick: i + 1, of: keys.length, ...(hostDependent ? { hostDependent: true } : {}),
      optionCount: all.length, options: all.map((o) => ({ value: o.id, label: o.name })),
    }));
  }
  const opts =
    def.kind === 'domains'
      ? domainPoolForChoice(build, db, build.featPicks?.[key], def.domainPool).map((d) => ({ value: d, label: d }))
      : def.kind === 'skills'
        ? trainedSkillOptions(char, def.minRank ?? 'trained')
        : (def.options ?? []);
  const answers = keys.map((k) => build.featChoices?.[k]);
  return keys.map((k, i) => {
    const shown = choiceOptionsFor(opts, def, answers, i);
    return {
      ...shared, lane: shared.lane ?? 'choice', control: 'select', key: k, storage: 'featChoices',
      pick: i + 1, of: keys.length,
      optionCount: shown.length, options: shown.map((o) => ({ value: o.value, label: featChoiceLabel(o.label) })),
    };
  });
}

/**
 * Every picker the builder renders under a feat placed in `slotKey`.
 *
 * `build` must already contain the feat at that slot; `char` is the character built from it, because
 * three of the lanes resolve their options FROM the built character (trained skills, redundant-skill
 * fallbacks, the language budget) and cannot be answered from the record alone.
 */
export function pickersFor(build, slotKey, featId, db, char) {
  const feat = db.feats[featId];
  if (!feat) return [];
  const out = [];
  const grant = FEAT_GRANTS[featId];

  // Builder.tsx:1631 — the record's own choice. SUPPRESSED when it is a pick-a-feat choice, which
  // the FEAT_PICK_GRANTS picker below renders instead; that suppression is why reading `feat.choice`
  // and asserting "a picker exists" is neither sufficient nor necessary.
  if (feat.choice && !(feat.choice.flag === 'feat' && FEAT_PICK_GRANTS[featId])) {
    out.push(...renderChoicePickers(feat.choice, slotKey, build, db, char, featId, { declaredBy: 'record.choice' }));
  }

  // Builder.tsx:1644 — dedication skill training ("trained in Acrobatics or Athletics").
  for (const [si, slot] of (grant?.skillChoices ?? []).entries()) {
    const opts = slot.options === 'any' ? SKILLS : slot.options;
    out.push({
      lane: 'skillChoice', declaredBy: `registry.FEAT_GRANTS.skillChoices[${si}]`, control: 'select',
      prompt: 'Trained skill', kind: 'array', key: `${featId}:${si}`, storage: 'featSkillChoices',
      optionCount: opts.length, options: opts.map((s) => ({ value: s, label: s })),
    });
  }

  // Builder.tsx:1668 — the redundant-grant fallback. Reported by the CHARACTER, not the record: the
  // slot only exists once the grant actually collided with training the character already had.
  for (const fb of (char?.skillFallbacks ?? []).filter((f) => f.featId === featId)) {
    out.push({
      lane: 'skillFallback', declaredBy: 'derived.skillFallbacks', control: 'select',
      prompt: `Already trained in ${fb.skill} — replacement skill`,
      kind: 'array', key: `${featId}:fallback:${fb.skill}`, storage: 'featSkillChoices',
      optionCount: SKILLS.length, options: SKILLS.map((s) => ({ value: s, label: s })),
    });
  }

  // Builder.tsx:1691 — free-text Lore subjects.
  for (let li = 0; li < (grant?.loreChoices ?? 0); li++) {
    out.push({
      lane: 'loreChoice', declaredBy: 'registry.FEAT_GRANTS.loreChoices', control: 'text',
      prompt: 'Trained Lore', kind: 'text', key: `${featId}:${li}`, storage: 'featLoreChoices',
      optionCount: null, options: [],
    });
  }

  // Builder.tsx:1704 — a dedication's bonus skill feat.
  if (grant?.bonusSkillFeat) {
    const opts = Object.values(db.feats).filter((f) => f.category === 'skill' && !db.duplicateIds?.has(f.id));
    out.push({
      lane: 'bonusSkillFeat', declaredBy: 'registry.FEAT_GRANTS.bonusSkillFeat', control: 'select',
      prompt: 'Bonus skill feat', kind: 'feat', key: featId, storage: 'dedicationSkillFeats',
      optionCount: opts.length, options: opts.map((f) => ({ value: f.id, label: f.name })),
    });
  }

  // Builder.tsx:1722 — pick-a-feat grants (General Training, Natural Ambition, …).
  if (FEAT_PICK_GRANTS[featId]) {
    const spec = FEAT_PICK_GRANTS[featId];
    const opts = pickableFeats(spec, build, db);
    out.push({
      lane: 'pickFeat',
      declaredBy: feat.choice?.flag === 'feat' ? 'record.choice' : 'registry.FEAT_PICK_GRANTS',
      control: 'select', prompt: spec.prompt, kind: 'feat', key: slotKey, storage: 'pickFeatChoices',
      optionCount: opts.length, options: opts.map((f) => ({ value: f.id, label: f.name })),
    });
  }

  // Builder.tsx:1745 — grantedChoicePicker (Builder.tsx:448) for each feat this feat GRANTS.
  // Returns null when the granted feat's choice resolves to an empty list, so a granted choice can
  // legitimately declare itself and render nothing — which is one of the two checks below.
  for (const gid of FEAT_FEAT_GRANTS[featId] ?? []) {
    const def = db.feats[gid]?.choice;
    if (!def) continue;
    const opts =
      def.kind === 'domains'
        ? domainPoolForChoice(build, db, gid, def.domainPool).map((d) => ({ value: d, label: d }))
        : def.kind === 'skills'
          ? SKILLS.map((s) => ({ value: s, label: s }))
          : (def.options ?? []);
    if (!opts.length) continue; // grantedChoicePicker returns null — no picker renders
    out.push({
      lane: 'grantedFeatChoice', declaredBy: `granted.${gid}.choice`, control: 'select',
      prompt: `${db.feats[gid].name}: ${featChoicePrompt(def.prompt, def.flag)}`, kind: def.kind,
      key: gid, storage: 'grantedFeatChoices',
      optionCount: opts.length, options: opts.map(optOf),
    });
  }

  // Builder.tsx:1748 — effectChoices. A spell-filtered one is HIDDEN below its unlock level.
  for (const ch of feat.effectChoices ?? []) {
    const declaredBy = `record.effectChoices[${ch.id}]`;
    if (ch.spellFilter) {
      if (build.level < (ch.spellFilter.minLevel ?? 1)) continue; // renders nothing at this level
      const opts = spellsMatching(ch.spellFilter, db, build.hideLegacy);
      out.push({
        lane: 'effectChoice', declaredBy, control: 'search', prompt: ch.prompt, kind: 'spell',
        key: `${featId}:${ch.id}`, storage: 'effectChoices',
        optionCount: opts.length, options: opts.map((s) => ({ value: s.id, label: s.name })),
      });
      continue;
    }
    const opts = ch.options ?? [];
    out.push({
      lane: 'effectChoice', declaredBy, control: 'select', prompt: ch.prompt, kind: 'array',
      key: `${featId}:${ch.id}`, storage: 'effectChoices',
      optionCount: opts.length, options: opts.map(optOf),
    });
  }

  // Builder.tsx:1789 — pick-a-cantrip grants.
  if (FEAT_CANTRIP_GRANTS[featId]) {
    const spec = FEAT_CANTRIP_GRANTS[featId];
    const opts = spec.options.map((id) => db.spells[id]).filter(Boolean);
    out.push({
      lane: 'pickCantrip', declaredBy: 'registry.FEAT_CANTRIP_GRANTS', control: 'select',
      prompt: spec.prompt, kind: 'spell', key: featId, storage: 'pickCantripChoices',
      optionCount: opts.length, options: opts.map((s) => ({ value: s.id, label: s.name })),
    });
  }

  // shared.tsx LanguageEditor — a feat that grants language slots is answered there, not on the feat
  // card. Observed as a BUDGET (bonusLanguageSlots) rather than as a field, because three separate
  // fields feed it and one of them scales with a skill rank.
  if (feat.languageChoices || feat.languageChoicesAtRank?.length) {
    const withFeat = bonusLanguageSlots(build, db);
    const without = bonusLanguageSlots({ ...build, featPicks: Object.fromEntries(Object.entries(build.featPicks ?? {}).filter(([, v]) => v !== featId)) }, db);
    const langs = Object.values(db.languages ?? {});
    out.push({
      lane: 'language', declaredBy: 'record.languageChoices', control: 'select',
      prompt: 'Bonus languages', kind: 'language', key: 'languages', storage: 'languages',
      slotsGranted: withFeat - without,
      optionCount: langs.length, options: langs.map((l) => ({ value: l.id, label: l.name })),
    });
  }

  return out;
}

/** What the RECORD (or a registry) says a choice exists — the left-hand side of check 1. */
export function declaredChoices(featId, db) {
  const feat = db.feats[featId];
  const out = [];
  if (!feat) return out;
  if (feat.choice) out.push('record.choice');
  for (const ch of feat.effectChoices ?? []) out.push(`record.effectChoices[${ch.id}]`);
  if (feat.languageChoices || feat.languageChoicesAtRank?.length) out.push('record.languageChoices');
  const g = FEAT_GRANTS[featId];
  (g?.skillChoices ?? []).forEach((_, i) => out.push(`registry.FEAT_GRANTS.skillChoices[${i}]`));
  if (g?.loreChoices) out.push('registry.FEAT_GRANTS.loreChoices');
  if (g?.bonusSkillFeat) out.push('registry.FEAT_GRANTS.bonusSkillFeat');
  if (FEAT_PICK_GRANTS[featId]) out.push(feat.choice?.flag === 'feat' ? 'record.choice' : 'registry.FEAT_PICK_GRANTS');
  if (FEAT_CANTRIP_GRANTS[featId]) out.push('registry.FEAT_CANTRIP_GRANTS');
  for (const gid of FEAT_FEAT_GRANTS[featId] ?? []) if (db.feats[gid]?.choice) out.push(`granted.${gid}.choice`);
  return [...new Set(out)];
}

/* ── The observed sheet ────────────────────────────────────────────────────────────────────────
 * ⚠ buildCharacter's return value is the STORED character. Senses, AC, resistances, speeds, strikes
 * and every situational note are computed by derive.ts and appear nowhere on it — diffing the stored
 * object alone reported "changes nothing" for 18 of the first 20 feats in the sheet harness. Same
 * snapshot here, plus the language budget, because that is the one derived number a builder-only
 * lane moves. */
export function snapshot(c, db) {
  const s = { stored: c };
  const t = (fn, key, ...args) => { try { s[key] = fn(c, ...args); } catch (e) { s[key] = `ERR:${e.message}`; } };
  t(deriveMaxHp, 'maxHp', db);
  t(deriveAc, 'ac', db);
  t(deriveDefenses, 'defenses', db);
  t(deriveSpeeds, 'speeds', db);
  t(deriveStrikes, 'strikes', db);
  t(deriveShield, 'shield', db);
  t(derivePerception, 'perception', db);
  t(deriveClassDc, 'classDc');
  s.saves = {};
  for (const sv of ['fortitude', 'reflex', 'will']) { try { s.saves[sv] = deriveSave(c, sv, db); } catch (e) { s.saves[sv] = String(e.message); } }
  s.skills = {};
  for (const k of SKILLS) { try { s.skills[k] = deriveSkill(c, k, db); } catch (e) { s.skills[k] = String(e.message); } }
  const featureIds = (() => { try { return [...ownedFeatureIds(c, db)]; } catch { return []; } })();
  s.ownedFeatures = featureIds;
  const records = [
    ...(c.feats ?? []).map((f) => db.feats[f.featId]),
    ...featureIds.map((id) => db.classFeatures[id]),
    c.heritageId ? db.heritages[c.heritageId] : undefined,
    c.backgroundId ? db.backgrounds[c.backgroundId] : undefined,
  ].filter(Boolean);
  s.actions = [
    ...records.filter((r) => isActionCost(r.actionCost)).map((r) => r.name),
    ...records.flatMap((r) => (r.grantsActions ?? []).map((id) => db.actions?.[id]?.name).filter(Boolean)),
  ].sort();
  s.limitedUses = records.filter((r) => r.limitedUses).map((r) => `${r.name}: ${JSON.stringify(r.limitedUses)}`).sort();
  s.grantedSpells = records.flatMap((r) => [
    ...(r.innateSpells ?? []).map((x) => `innate:${x.spellId ?? x}`),
    ...(r.focusSpells ?? []).map((x) => `focus:${x.spellId ?? x}`),
    ...(r.grantsRituals ?? []).map((x) => `ritual:${x.spellId ?? x}`),
  ]).sort();
  /* ⚠ THE STAR IS A SHEET SURFACE AND IT MOVES ON MORE THAN FEAT IDS. feat-evidence.mjs reads
   * `featSituationalFor(featIds, ref)`, which sees the shipped registry for taken FEATS only. The
   * sheet calls `statMarkClass`, which reads `characterSituationalIds` — feats PLUS heritage,
   * background, ancestry, owned class features, worn items, etched runes and armour traits — and
   * merges the authored lane (degree shifts, conditional skill substitutions). A choice that grants
   * a class feature carrying a `*` moves the second and not the first, so both are recorded: the
   * mark the player actually sees, and the registry lines behind it. */
  const ids = (c.feats ?? []).map((f) => f.featId);
  s.situational = {};
  s.statMarks = {};
  for (const ref of [{ kind: 'ac' }, { kind: 'perception' }, ...['fortitude', 'reflex', 'will'].map((save) => ({ kind: 'save', save })),
    ...SKILLS.map((skill) => ({ kind: 'skill', skill }))]) {
    const at = ref.skill ?? ref.save ?? ref.kind;
    try {
      const lines = featSituationalFor(ids, ref);
      if (lines.length) s.situational[at] = lines;
    } catch { /* a ref shape this build doesn't support is not evidence of anything */ }
    try {
      const mark = statMarkClass(c, ref, db);
      if (mark) s.statMarks[at] = mark;
    } catch { /* ditto */ }
  }
  /* Ruling D's other surface: the mark that lives on the ACTION a record modifies rather than on any
   * stat. It is the whole requirement for a class of feats, and no number anywhere moves with it. */
  s.actionMarks = {};
  for (const name of s.actions) {
    try {
      const m = recordMarkersFor(c, db, 'action', slugOf(name));
      if (m.length) s.actionMarks[name] = m;
    } catch { /* ditto */ }
  }
  return s;
}

/** RecordMarker ids are matched against the SLUGIFIED action name (see explain.ts:367). */
const slugOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const NOISE = new Set(['build', 'content', 'db', 'description', 'descRefs']);
const flat = (v, path = '', out = {}) => {
  if (v === null || v === undefined) return out;
  if (Array.isArray(v)) {
    const keyed = v.every((x) => x && typeof x === 'object' && (x.featId || x.id || x.spellId));
    v.forEach((x, i) => flat(x, `${path}[${keyed ? (x.featId ?? x.id ?? x.spellId) : i}]`, out));
    return out;
  }
  if (typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) if (!NOISE.has(k)) flat(val, path ? `${path}.${k}` : k, out);
    return out;
  }
  out[path] = v;
  return out;
};

export function diff(a, b) {
  const A = flat(a), B = flat(b);
  const changes = [];
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (A[k] === B[k]) continue;
    changes.push({ path: k, before: A[k] ?? null, after: B[k] ?? null });
  }
  return changes;
}

/**
 * ⚠ THE ECHO. buildCharacter writes the answer straight back onto the record it belongs to — onto the
 * feat row as `feats[id].choice.{value,label}` so the sheet can read "Terrain Scout (Forest, Swamp)",
 * and onto `effectPicks` for an effect choice whose option carries no grant ("so the sheet still shows
 * which one was taken", build.ts:3220). That is the app repeating the player's own words, not a
 * derived value moving, and counting it turns this check into a tautology that passes for every
 * choice including the ones nothing reads.
 *
 * Both forms are listed here, not just the feat row: leaving `effectPicks` out made one feat's answer
 * read as consumed when all that had happened was its own label changing.
 */
export const ECHO_PATH = /(^|\.)stored\.(feats\[[^\]]+\]\.choice\.(value|label)|effectPicks\[\d+\]\.(label|note|recordId|choiceId))$/;
export const isEcho = (path) => ECHO_PATH.test(path);

/* ── Applying an answer ─────────────────────────────────────────────────────────────────────── */
export function withAnswer(build, picker, value) {
  const b = { ...build };
  switch (picker.storage) {
    case 'featChoices': b.featChoices = { ...(b.featChoices ?? {}), [picker.key]: value }; break;
    case 'featSkillChoices': b.featSkillChoices = { ...(b.featSkillChoices ?? {}), [picker.key]: value }; break;
    case 'featLoreChoices': b.featLoreChoices = { ...(b.featLoreChoices ?? {}), [picker.key]: value }; break;
    case 'dedicationSkillFeats': b.dedicationSkillFeats = { ...(b.dedicationSkillFeats ?? {}), [picker.key]: value }; break;
    case 'pickFeatChoices': b.pickFeatChoices = { ...(b.pickFeatChoices ?? {}), [picker.key]: value }; break;
    case 'grantedFeatChoices': b.grantedFeatChoices = { ...(b.grantedFeatChoices ?? {}), [picker.key]: value }; break;
    case 'effectChoices': b.effectChoices = { ...(b.effectChoices ?? {}), [picker.key]: value }; break;
    case 'pickCantripChoices': b.pickCantripChoices = { ...(b.pickCantripChoices ?? {}), [picker.key]: value }; break;
    case 'languages': b.languages = [value]; break;
    default: break;
  }
  return b;
}

/* ── The evidence pack ─────────────────────────────────────────────────────────────────────── */
const REF_HOSTS = [
  ['fighter', 'human'], ['cleric', 'dwarf'], ['wizard', 'elf'],
  ['rogue', 'halfling'], ['druid', 'gnome'], ['bard', 'goblin'],
];

export function referenceHosts(db) {
  return REF_HOSTS
    .filter(([c, a]) => db.classes?.[c] && db.ancestries?.[a])
    .map(([classId, ancestryId]) => ({ name: `${classId}/${ancestryId}`, classId, ancestryId }));
}

/** Which reference characters may LEGALLY take this feat: the slot offers it AND prereqs are met. */
export function eligibleHosts(feat, db, hosts) {
  const out = [];
  for (const h of hosts) {
    const ctx = hostContext(db, h.classId, h.ancestryId);
    if (!slotFor(ctx, db, feat)) continue;
    if (!checkPrerequisites(feat, ctx.char, db).met) continue;
    out.push(h.name);
  }
  return out;
}

const OPTION_CAP = 60;

/**
 * One host, at one level, with the feat placed: the build, the slot key, the character, the pickers.
 *
 * Returns null when nothing accepts the feat at all. `slotRendered` distinguishes "the builder really
 * offers this feat in that slot" from "we forced it in so it could be measured" — the second is still
 * evidence about the feat, but it is not evidence about the builder.
 */
export function probeAt(featId, db, classId, ancestryId, level, minimal = false) {
  const feat = db.feats[featId];
  const ctx = hostContext(db, classId, ancestryId, level, minimal);
  const slot = slotFor(ctx, db, feat);
  let slotKey = slot ? `${slot.level}:${slot.category}:${slot.idx}` : null;
  let build = slotKey ? { ...ctx.build, featPicks: { [slotKey]: featId } } : null;
  if (!build) {
    // Forced placement, same shape as feat-evidence.mjs:227 — a feat no slot offers this host must
    // still be measurable, or the pack for it would be silence rather than a finding.
    outer: for (const cat of [feat.category, 'class', 'ancestry', 'general', 'skill', 'archetype', 'mythic', 'bonus'].filter(Boolean)) {
      for (const lvl of [Math.min(feat.level ?? 1, level), 1, 2, level]) {
        for (const idx of [0, 1]) {
          const key = `${lvl}:${cat}:${idx}`;
          const cand = { ...ctx.build, featPicks: { [key]: featId } };
          if (buildCharacter(cand, db).feats?.some((f) => f.featId === featId)) { slotKey = key; build = cand; break outer; }
        }
      }
    }
  }
  if (!build) return null;
  const char = buildCharacter(build, db);
  return { build, slotKey, char, slotRendered: !!slot, pickers: pickersFor(build, slotKey, featId, db, char) };
}

/**
 * Do DIFFERENT answers to this picker produce different characters?
 *
 * ⚠ TWO SAMPLES ARE NOT ENOUGH, and assuming they were made this harness lie once already. A rich
 * host trained in twelve skills answers "become trained in a skill" with a no-op for most of the
 * sixteen options, so first-vs-last can both land on skills the character already had and the
 * choice reads dead. `sample` spreads across the option list; the caller escalates only when the
 * cheap two-sample pass finds nothing, so the common case still costs two builds.
 */
function compareAnswers(probe, picker, db, sample = 2) {
  const opts = picker.options;
  const n = Math.min(sample, opts.length);
  const idx = [...new Set(Array.from({ length: n }, (_, i) => Math.round((i * (opts.length - 1)) / (n - 1))))];
  const values = idx.map((i) => opts[i].value);
  const snaps = values.map((v) => snapshot(buildCharacter(withAnswer(probe.build, picker, v), db), db));
  let changes = [], echoed = false;
  for (let i = 1; i < snaps.length; i++) {
    const d = diff(snaps[0], snaps[i]);
    if (d.some((c) => isEcho(c.path))) echoed = true;
    if (!changes.length) changes = d.filter((c) => !isEcho(c.path));
  }
  return { values, A: snaps[0], changes, echoed };
}

export function evidenceFor(featId, db, hosts) {
  const feat = db.feats[featId];
  if (!feat) return { featId, name: null, placed: false, missing: true };
  const { classId, ancestryId } = hostIdsFor(feat, db);
  const declared = declaredChoices(featId, db);
  const probe = probeAt(featId, db, classId, ancestryId, 20);

  if (!probe) {
    return {
      featId, name: feat.name, level: feat.level ?? null, category: feat.category ?? null,
      placed: false, slotRendered: false, declared, presentsChoices: [], choiceCount: 0,
      eligibleHosts: eligibleHosts(feat, db, hosts), nativeHostEligible: false,
      checks: { declaredWithoutPicker: declared, pickerWithZeroOptions: [], answerNotRead: [] },
    };
  }

  const { build, slotKey, char, pickers } = probe;
  const unanswered = snapshot(char, db);

  /* ⚠ A RICH LEVEL-20 HOST HIDES GRANTS. A fighter is already master in Fortitude and Reflex, so
   * "become an expert in the save you chose" moves nothing and reads as a dead answer; a character
   * trained in twelve skills swallows "become trained in a skill" whichever skill is named. When the
   * level-20 comparison shows no movement, the same picker is re-measured on a MINIMAL character at
   * the feat's own level, where a grant has somewhere to land. Only built when needed. */
  const lowLevel = Math.max(1, Math.min(20, feat.level ?? 1));
  const cache = new Map();
  const fallbackProbes = [
    // A skill FALLBACK picker only exists on a host already trained in the granted skill, so the
    // minimal host cannot show it at all — and a proficiency grant only shows on a host that lacks
    // the proficiency. Neither host covers both shapes; both are tried before calling an answer dead.
    ['minimal L' + lowLevel, () => probeAt(featId, db, classId, ancestryId, lowLevel, true)],
    ...(lowLevel < 20 ? [['rich L' + lowLevel, () => probeAt(featId, db, classId, ancestryId, lowLevel, false)]] : []),
  ];
  const probeNamed = (name, make) => {
    if (!cache.has(name)) cache.set(name, make());
    return cache.get(name);
  };
  const twinOf = (p, other) =>
    other?.pickers.find((q) => q.lane === p.lane && q.declaredBy === p.declaredBy && (q.pick ?? 1) === (p.pick ?? 1));

  const answers = [];
  for (const p of pickers) {
    const rec = {
      key: p.key, lane: p.lane, storage: p.storage, prompt: p.prompt, kind: p.kind,
      optionCount: p.optionCount,
    };
    // The language lane is answered in the LanguageEditor, not on the feat card, and its answer is a
    // language — writing one into build.languages moves character.languages by construction, which
    // would be a tautology. What it actually claims is a BUDGET, so that is what is measured.
    if (p.lane === 'language') {
      rec.slotsGranted = p.slotsGranted;
      rec.verdict = p.slotsGranted > 0 ? 'slot-budget' : 'not-read';
      answers.push(rec);
      continue;
    }
    if (p.control === 'text') { rec.verdict = 'free-text'; answers.push(rec); continue; }
    if ((p.optionCount ?? 0) < 2) { rec.verdict = p.optionCount ? 'single-option' : 'no-options'; answers.push(rec); continue; }

    // Cheap pass first (two answers), then widen the sample, then change host — each step runs only
    // because the previous one found nothing, so a working choice costs two builds and a suspect one
    // earns the extra scrutiny before it is written down as a defect.
    const at20 = compareAnswers(probe, p, db, 2);
    rec.answers = at20.values;
    let changes = at20.changes;
    let echoed = at20.echoed;
    if (!changes.length) {
      const wide = compareAnswers(probe, p, db, 6);
      echoed = echoed || wide.echoed;
      if (wide.changes.length) { changes = wide.changes; rec.movedOn = 'wider sample'; }
    }
    for (const [name, make] of fallbackProbes) {
      if (changes.length) break;
      const lp = probeNamed(name, make);
      const twin = lp && twinOf(p, lp);
      if (!twin || (twin.optionCount ?? 0) < 2) continue;
      const atLow = compareAnswers(lp, twin, db, 6);
      echoed = echoed || atLow.echoed;
      if (atLow.changes.length) { changes = atLow.changes; rec.movedOn = name; }
    }
    rec.moved = changes.length > 0;
    rec.movedPaths = changes.slice(0, 6).map((c) => c.path);
    rec.echoed = echoed;
    // Unanswered vs the first answer: identical means the app silently chose for the player.
    rec.silentDefault = diff(unanswered, at20.A).filter((c) => !isEcho(c.path)).length === 0;
    /* ⚠ `echo-only` IS NOT THE SAME FAILURE AS `not-read`, and collapsing them would misreport both.
     * buildCharacter writes the answer back onto the feat row, which is how the sheet reads
     * "Assurance (Religion)" instead of a bare "Assurance" — for a feat whose whole job is to record
     * WHICH skill, that label is the correct and complete surface (Ruling K: what the player re-chooses
     * in the builder needs no further sheet surface). `not-read` is stronger: the answer changes
     * nothing anywhere, not even the label. Both satisfy the spec's check 2 wording ("stored but moves
     * no derived value"), so both are counted — but they are listed apart, because only one of them is
     * automatically wrong. */
    rec.verdict = rec.moved
      ? 'read'
      : p.inert ? 'inert-declared'
        : p.daily ? 'daily'
          : echoed ? 'echo-only'
            : 'not-read';
    if (p.inert) rec.inert = p.inert;
    // A `note` is the app telling the player which part of the restriction is theirs to honour —
    // often "applied at the table". It does not make an unread answer correct, but a reader
    // adjudicating this list has to see it, so it travels with the verdict.
    if (p.note) rec.note = p.note;
    if (p.daily) rec.daily = true;
    if (p.wideningSources?.length) rec.wideningSources = p.wideningSources;
    answers.push(rec);
  }

  const rendered = new Set(pickers.map((p) => p.declaredBy));
  const declaredWithoutPicker = declared.filter((d) => !rendered.has(d));
  /* ⚠ AN EMPTY LIST IS NOT ALWAYS THE APP'S FAULT. `from.type: 'own-item' | 'own-spell' | 'own-feat' |
   * 'own-companion'` resolves the options from what the CHARACTER has — "which weapon carries your
   * celestial blessing?" offers the weapons you own. The reference host carries no inventory, so that
   * list is legitimately empty and counting it as "a choice nobody can answer" would be the harness
   * reporting its own host as an app defect. Split out and excluded from the check. */
  const emptyPickers = pickers.filter((p) => p.control !== 'text' && !(p.optionCount ?? 0));
  const pickerWithZeroOptions = emptyPickers.filter((p) => !p.hostDependent).map((p) => p.declaredBy);
  const zeroOptionsHostDependent = emptyPickers.filter((p) => p.hostDependent).map((p) => p.declaredBy);
  const answerNotRead = answers.filter((a) => a.verdict === 'not-read').map((a) => a.key);
  const answerEchoOnly = answers.filter((a) => a.verdict === 'echo-only').map((a) => a.key);

  return {
    featId,
    name: feat.name,
    level: feat.level ?? null,
    category: feat.category ?? null,
    traits: feat.traits ?? [],
    text: String(feat.description ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 900),
    placed: true,
    slotRendered: probe.slotRendered,
    host: { classId, ancestryId, level: 20, slot: slotKey },
    declared,
    choiceCount: pickers.length,
    presentsChoices: pickers.map((p) => ({
      lane: p.lane, declaredBy: p.declaredBy, control: p.control, prompt: p.prompt, kind: p.kind,
      key: p.key, storage: p.storage,
      ...(p.of > 1 ? { pick: p.pick, of: p.of } : {}),
      ...(p.slotsGranted !== undefined ? { slotsGranted: p.slotsGranted } : {}),
      ...(p.daily ? { daily: true } : {}),
      ...(p.inert ? { inert: p.inert } : {}),
      ...(p.note ? { note: p.note } : {}),
      ...(p.wideningSources?.length ? { wideningSources: p.wideningSources } : {}),
      optionCount: p.optionCount,
      options: p.options.slice(0, OPTION_CAP).map((o) => o.label ?? o.value),
      optionsTruncated: p.options.length > OPTION_CAP ? p.options.length : 0,
    })),
    answerIsRead: answers,
    unansweredState: {
      pickersLeftBlank: pickers.length,
      silentDefaults: answers.filter((a) => a.silentDefault).map((a) => a.key),
    },
    eligibleHosts: eligibleHosts(feat, db, hosts),
    // "Withheld from a character who DOES qualify" needs a host that plausibly qualifies: most class
    // feats belong to a class no fixed spread of six contains, so the trait-matched host is reported
    // alongside the spread rather than instead of it.
    nativeHostEligible: !!(probe.slotRendered && checkPrerequisites(feat, char, db).met),
    checks: { declaredWithoutPicker, pickerWithZeroOptions, zeroOptionsHostDependent, answerNotRead, answerEchoOnly },
  };
}

/* ── Run ───────────────────────────────────────────────────────────────────────────────────── */
export function main() {
  const db = loadDb();
  const hosts = referenceHosts(db);
  const sample = JSON.parse(read('scripts/audit/feat-500.json'));
  const only = arg('only', '');
  const ids = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : sample.featIds;
  const limit = Number(arg('limit', 0)) || ids.length;

  const packs = [];
  for (const featId of ids.slice(0, limit)) packs.push(evidenceFor(featId, db, hosts));

  const withChoices = packs.filter((p) => p.choiceCount > 0);
  const check1 = packs.filter((p) => (p.checks?.declaredWithoutPicker?.length || p.checks?.pickerWithZeroOptions?.length));
  const check2 = packs.filter((p) => p.checks?.answerNotRead?.length || p.checks?.answerEchoOnly?.length);
  const n = (f) => packs.reduce((t, p) => t + (f(p)?.length ?? 0), 0);

  const laneCount = {};
  for (const p of packs) for (const c of p.presentsChoices ?? []) laneCount[c.lane] = (laneCount[c.lane] ?? 0) + 1;
  const verdicts = {};
  for (const p of packs) for (const a of p.answerIsRead ?? []) verdicts[a.verdict] = (verdicts[a.verdict] ?? 0) + 1;

  const totals = {
    feats: packs.length,
    placed: packs.filter((p) => p.placed).length,
    slotRendered: packs.filter((p) => p.slotRendered).length,
    featsPresentingAChoice: withChoices.length,
    pickers: packs.reduce((t, p) => t + (p.choiceCount ?? 0), 0),
    byLane: laneCount,
    verdicts,
    check1_choiceNobodyCanAnswer: { feats: check1.length, declaredWithoutPicker: n((p) => p.checks?.declaredWithoutPicker), pickerWithZeroOptions: n((p) => p.checks?.pickerWithZeroOptions), excludedHostDependent: n((p) => p.checks?.zeroOptionsHostDependent) },
    check2_answerNobodyReads: { feats: check2.length, notRead: n((p) => p.checks?.answerNotRead), echoOnly: n((p) => p.checks?.answerEchoOnly) },
  };

  mkdirSync(join(root, 'scripts/audit'), { recursive: true });
  const outPath = 'scripts/audit/builder-500-evidence.json';
  writeFileSync(join(root, outPath), JSON.stringify({
    generated: new Date().toISOString(),
    sample: only ? `--only ${only}` : 'scripts/audit/feat-500.json',
    hosts: hosts.map((h) => h.name),
    totals,
    packs,
  }, null, 1));

  console.log(`feats processed          ${packs.length}`);
  console.log(`  placed in a slot       ${totals.placed}  (${totals.slotRendered} in a slot the builder really renders)`);
  console.log(`  present >=1 choice     ${withChoices.length}`);
  console.log(`  pickers rendered       ${totals.pickers}`);
  console.log(`  by lane                ${JSON.stringify(laneCount)}`);
  console.log(`  answer verdicts        ${JSON.stringify(verdicts)}`);
  console.log('');
  console.log(`CHECK 1  a choice nobody can answer     ${check1.length} feats`);
  console.log(`           declared, no picker          ${totals.check1_choiceNobodyCanAnswer.declaredWithoutPicker}`);
  console.log(`           picker with zero options     ${totals.check1_choiceNobodyCanAnswer.pickerWithZeroOptions}`);
  console.log(`           (excluded: empty because the HOST owns nothing — ${totals.check1_choiceNobodyCanAnswer.excludedHostDependent})`);
  console.log(`CHECK 2  an answer nobody reads         ${check2.length} feats  (${totals.check2_answerNobodyReads.notRead + totals.check2_answerNobodyReads.echoOnly} pickers)`);
  console.log(`           nothing moves at all         ${totals.check2_answerNobodyReads.notRead}`);
  console.log(`           only the feat-row label       ${totals.check2_answerNobodyReads.echoOnly}   <- Ruling K may make these correct`);
  console.log(`wrote ${outPath}`);
  return { packs, check1, check2, totals };
}

const isCli = /builder-evidence\.mjs$/.test(String(process.argv[1] ?? '').replace(/\\/g, '/'));
if (isCli) main();
