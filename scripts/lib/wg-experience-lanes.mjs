/*
 * THE PLAYER-EXPERIENCE COMPARISON — pure functions, no I/O.
 *
 * WHY THIS EXISTS. The four parity comparers check that our DATA matches Wanderer's Guide's data: the
 * kind gate maps their `select` op to our `choice` kind and is satisfied the moment one of twelve fields
 * EXISTS on the record — rendered or not. That is exactly how Domain Initiate shipped with matching data
 * and no picker (owner, 2026-09-02: "why dosent it let me chose the spell? in wg it does!"). This module
 * is the other half: given what THEY ask the player (their selects) and what OUR builder actually
 * rendered (observed by test/wg-experience.harness.test.tsx on the real Builder), decide whether the
 * player gets the same controls — and whether their value-bearing effects reach our derived sheet.
 *
 * Lanes are coarse on purpose. Their titles are generic ("Select a Feat" ×927), ours are specific
 * ("Bonus skill feat"), so the match is by WHAT KIND OF THING is picked, never by prompt text.
 */

/* ---- their ops --------------------------------------------------------------------------------- */

/** Summarise a conditional's conditions: which variables it reads and any LEVEL bounds. */
export function summarizeConditions(conds = []) {
  const vars = [];
  let levelMin = null;
  let levelMax = null;
  for (const c of conds) {
    const name = c?.name ?? c?.data?.name ?? '';
    vars.push(name);
    if (name !== 'LEVEL') continue;
    const v = Number(c.value);
    if (!Number.isFinite(v)) continue;
    const op = String(c.operator ?? '');
    if (op === 'GREATER_THAN_OR_EQUALS') levelMin = Math.max(levelMin ?? -Infinity, v);
    else if (op === 'GREATER_THAN') levelMin = Math.max(levelMin ?? -Infinity, v + 1);
    else if (op === 'EQUALS') { levelMin = v; levelMax = v; }
    else if (op === 'LESS_THAN') levelMax = Math.min(levelMax ?? Infinity, v - 1);
    else if (op === 'LESS_THAN_OR_EQUALS') levelMax = Math.min(levelMax ?? Infinity, v);
  }
  return { vars, levelMin, levelMax, featureGated: vars.some((v) => v && v !== 'LEVEL') };
}

/**
 * Flatten their nested ops, keeping the CONTEXT each one sits in.
 *
 * ⚠ Unlike wg-parse's flattenOps, this ALSO descends a predefined option's singular `operation` key —
 * 2,352 options store their effect there (every background's attribute-boost option among them) and are
 * invisible to the kind mapping. Here they count, marked `inOption`.
 */
export function flattenAll(op, ctx = { inOption: false, gates: [] }, out = []) {
  if (!op) return out;
  out.push({ op, ctx });
  const d = op.data ?? {};
  const cond = op.type === 'conditional' ? summarizeConditions(d.conditions) : null;
  for (const c of d.operations ?? []) flattenAll(c, ctx, out);
  for (const c of d.trueOperations ?? []) flattenAll(c, { ...ctx, gates: [...ctx.gates, { when: true, ...cond }] }, out);
  for (const c of d.falseOperations ?? []) flattenAll(c, { ...ctx, gates: [...ctx.gates, { when: false, ...cond }] }, out);
  for (const o of d.optionsPredefined ?? []) {
    const octx = { ...ctx, inOption: true, optionTitle: o?.title ?? null, selectTitle: d.title ?? null };
    for (const c of o?.operations ?? []) flattenAll(c, octx, out);
    if (o?.operation) flattenAll(o.operation, octx, out);
  }
  return out;
}

/**
 * Is an op reachable on our reference host? 'open' = nothing gates it; 'level' = a LEVEL bound the
 * host does not satisfy; 'feature' = gated on a feat/feature/mode/heritage name the host may not own —
 * we cannot tell, so it is reported, never failed on.
 */
export function gateStatus(gates = [], hostLevel = 20) {
  for (const g of gates) {
    if (g.when === false) return 'feature'; // an else-branch: reachable only when the condition FAILS — unknowable here
    if (g.featureGated) return 'feature';
    if (g.levelMin != null && hostLevel < g.levelMin) return 'level';
    if (g.levelMax != null && hostLevel > g.levelMax) return 'level';
  }
  return 'open';
}

const CUSTOM_TITLE_LANE = [
  [/domain/i, 'domain'],
  [/deity|deities|god/i, 'deity'],
  [/tradition/i, 'tradition'],
  [/sanctification/i, 'option'],
  [/skill/i, 'skill'],
  [/lore/i, 'lore'],
  [/attribute|ability score/i, 'attribute'],
  [/weapon/i, 'weapon'],
  [/language/i, 'language'],
  [/cantrip/i, 'cantrip'],
  [/spell/i, 'spell'],
  // "Select a Feature" is not a feat pick — word boundary, like the ABILITY_BLOCK branch.
  [/\bfeats?\b|dedication/i, 'feat'],
];

/** Classify one of THEIR `select` ops into a lane. */
export function laneOfSelect(op) {
  const d = op?.data ?? {};
  const f = d.optionsFilters ?? {};
  const title = String(d.title ?? '').trim();
  const optionType = d.optionType ?? null;
  const modeType = d.modeType ?? null;
  const preCount = Array.isArray(d.optionsPredefined) ? d.optionsPredefined.length : null;
  let lane = 'option';
  if (optionType === 'ADJ_VALUE') {
    // PREDEFINED options carry the variable inside each option's singular `operation`, and those WIN:
    // Acolyte's attribute pick ships `optionsFilters.group: 'SKILL'` beside two ATTRIBUTE_* options —
    // the filter is leftover, the options are what the player is offered.
    const vars = (d.optionsPredefined ?? []).map((o) => o?.operation?.data?.variable ?? '').filter(Boolean);
    const g = String(f.group ?? '').toUpperCase();
    if (vars.length && vars.every((v) => v.startsWith('ATTRIBUTE_'))) lane = 'attribute';
    // Any variable naming a Lore, whatever its prefix (SKILL_LORE_X, SKILL_X_LORE), is a lore pick.
    else if (vars.length && vars.every((v) => /LORE/.test(v))) lane = 'lore';
    else if (vars.length && vars.every((v) => v.startsWith('SKILL_'))) lane = 'skill';
    else if (g === 'ATTRIBUTE') lane = 'attribute';
    else if (g === 'SKILL') lane = 'skill';
    else if (g === 'ADD-LORE') lane = 'lore';
    else if (g === 'WEAPON' || g === 'WEAPON-GROUP') lane = 'weapon';
    else lane = /attribute/i.test(title) ? 'attribute' : /skill/i.test(title) ? 'skill' : /lore/i.test(title) ? 'lore' : /weapon/i.test(title) ? 'weapon' : 'value';
  } else if (optionType === 'ABILITY_BLOCK') {
    const t = String(f.abilityBlockType ?? '').toLowerCase();
    // WG models a SUBCLASS pick as a feat select filtered by a family trait — "Select a Doctrine" over
    // feats tagged 'Cleric Doctrine', "Select a Muse", "Select an Instinct". The player experience is a
    // named-thing pick, which is our subclass PopupSelect, not a feat slot. Only a select whose title
    // says feat/dedication is a feat-slot pick.
    if (t === 'heritage') lane = 'heritage';
    else if (t === 'sense') lane = 'sense';
    else lane = /\bfeats?\b|dedication/i.test(title) ? 'feat' : 'option';
  } else if (optionType === 'SPELL') {
    // A SPELL select with a PREDEFINED list is "one of these named spells" — a closed option pick (our
    // popup naming them), not a spell search.
    if (modeType === 'PREDEFINED' && preCount) lane = 'option';
    else lane = f.spellData?.rank === 0 || /cantrip/i.test(title) ? 'cantrip' : 'spell';
  } else if (optionType === 'LANGUAGE') lane = 'language';
  else if (optionType === 'TRAIT') lane = 'trait';
  else {
    // CUSTOM (or unknown): the title is the only hint. Default stays 'option' — a generic pick.
    for (const [re, l] of CUSTOM_TITLE_LANE) if (re.test(title)) { lane = l; break; }
  }
  return { lane, title, optionType, modeType, optionCount: preCount };
}

/* ---- our controls ------------------------------------------------------------------------------ */

const CONTROL_TITLE_LANE = [
  // A title that says "feat" is a feat pick even when it also says "skill" ("Bonus skill feat").
  [/\bfeats?\b|dedication/i, 'feat'],
  [/attribute|ability boost|boost/i, 'attribute'],
  [/lore/i, 'lore'],
  [/skill/i, 'skill'],
  [/cantrip/i, 'cantrip'],
  [/spell/i, 'spell'],
  [/language/i, 'language'],
  [/weapon/i, 'weapon'],
  [/domain/i, 'domain'],
  [/deity|deities/i, 'deity'],
  [/tradition/i, 'tradition'],
  [/heritage/i, 'heritage'],
  [/sense|vision/i, 'sense'],
  [/trait/i, 'trait'],
];

/**
 * EVERY lane one of OUR rendered controls can answer for, most specific first. A prompt often names
 * two things — "Choose your domain … you gain its domain spell" is a DOMAIN pick that also mentions the
 * spell, "Initial domain spell" is a SPELL pick that also mentions the domain — so a control carries
 * all the lanes its title names and the matcher accepts any of them. 'option' is always last: any
 * popup can answer a CUSTOM select.
 */
export function lanesOfControl(ctl) {
  const kind = ctl?.ctl ?? '';
  const title = String(ctl?.title ?? '');
  if (kind === 'slot') return ['feat'];
  if (kind === 'spell') return /cantrip/i.test(title) ? ['cantrip', 'spell'] : ['spell'];
  const out = [];
  if (kind === 'text') out.push(/lore/i.test(title) ? 'lore' : 'text');
  for (const [re, l] of CONTROL_TITLE_LANE) if (re.test(title) && !out.includes(l)) out.push(l);
  if (!out.includes('option')) out.push('option');
  return out;
}

/** The PRIMARY lane of a control (first of lanesOfControl) — for reports and grouping. */
export function laneOfControl(ctl) {
  return lanesOfControl(ctl)[0];
}

/** Which of OUR control lanes may answer one of THEIR select lanes. Exact lane first, then relatives. */
export const LANE_ACCEPTS = {
  attribute: ['attribute'],
  // A Lore IS a skill: "Select a Skill" over Astronomy Lore / Occultism is our Lore-titled popup.
  skill: ['skill', 'lore'],
  lore: ['lore', 'text'],
  // "Select a Feat" on a FEAT record is "choose one of these feats" — our popup naming the two
  // options ("Choose Combat Climber or Underwater Marauder") is that control; a feat SLOT is too.
  feat: ['feat', 'option'],
  heritage: ['heritage'],
  sense: ['sense', 'option'],
  spell: ['spell', 'cantrip'],
  cantrip: ['cantrip', 'spell'],
  language: ['language'],
  trait: ['trait', 'option'],
  weapon: ['weapon', 'option'],
  domain: ['domain', 'option'],
  deity: ['deity', 'option'],
  tradition: ['tradition', 'option'],
  value: ['attribute', 'skill', 'lore', 'weapon', 'value', 'option'],
  // A CUSTOM select is "pick one of these named things" — any non-slot, non-spell control can be it.
  option: ['option', 'domain', 'deity', 'tradition', 'weapon', 'trait', 'value', 'attribute', 'skill', 'lore', 'sense', 'text', 'heritage', 'language'],
};

/**
 * How many of THEIR selects one of OUR controls can answer. A spell "+ add" advertising N openings, a
 * multi-pick card with a capacity, or a `choice` with several picks answers up to N same-lane selects
 * (WG asks "Select a Cantrip" five times where we show one rail with five openings). Everything else
 * answers one.
 */
export function controlCapacity(c) {
  if (c?.capacity != null) return Math.max(1, Number(c.capacity));
  if (c?.ctl === 'spell' || c?.ctl === 'multi') return Math.max(1, Number(c.options ?? 1));
  return 1;
}

/**
 * Greedy matching of their selects to our controls (each control up to its capacity). Specific lanes
 * claim first, generic 'option' selects last, so a domain picker is not eaten by "Select Sanctification".
 */
/** What a generic (CUSTOM / predefined) select picks, read off its optionType, as extra accepted lanes. */
export const OPTION_TYPE_LANES = {
  SPELL: ['spell', 'cantrip'],
  ABILITY_BLOCK: ['feat'],
  LANGUAGE: ['language'],
  TRAIT: ['trait'],
};

export function matchSelects(selects, controls) {
  const rank = (s) => (s.lane === 'option' ? 2 : s.lane === 'value' ? 1 : 0);
  const order = selects.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i);
  const used = new Map(); // control index -> times used
  const free = (j) => (used.get(j) ?? 0) < controlCapacity(controls[j]);
  const matched = [];
  const unmatched = [];
  for (const { s } of order) {
    // A generic ('option') select still says what KIND of thing it picks through its optionType — a
    // predefined SPELL select ("Select a cantrip" over four named cantrips) is our cantrip popup, an
    // ABILITY_BLOCK one is a pick-a-feat question, and so on.
    const accepts = [...(LANE_ACCEPTS[s.lane] ?? [s.lane]), ...(s.lane === 'option' ? OPTION_TYPE_LANES[s.optionType] ?? [] : [])];
    let pick = -1;
    for (const want of accepts) {
      // A control's PRIMARY lane wins first; then any lane its title also names (see lanesOfControl).
      pick = controls.findIndex((c, j) => free(j) && (c.lane ?? laneOfControl(c)) === want);
      if (pick < 0 && want !== 'option') pick = controls.findIndex((c, j) => free(j) && lanesOfControl(c).includes(want));
      if (pick >= 0) break;
    }
    if (pick >= 0) { used.set(pick, (used.get(pick) ?? 0) + 1); matched.push({ select: s, control: controls[pick] }); }
    else unmatched.push(s);
  }
  // One question asked, one control added, lanes disagree only on wording ("Select a Grim Fascination"
  // vs our prompt that says what the pick GRANTS): they are the same control. Only ever one-to-one —
  // with two of either there is no way to know which is which.
  if (unmatched.length === 1 && selects.length === 1) {
    const freeIdx = controls.map((_, j) => j).filter((j) => free(j));
    if (freeIdx.length === 1 && controls.length === 1) {
      const j = freeIdx[0];
      used.set(j, 1);
      matched.push({ select: unmatched.pop(), control: controls[j], byCount: true });
    }
  }
  const extra = controls.filter((_, j) => !used.has(j));
  return { matched, unmatched, extra };
}

/* ---- their effects ----------------------------------------------------------------------------- */

const EFFECT_TYPES = new Set([
  'adjValue', 'setValue', 'addBonusToValue', 'giveSpell', 'giveAbilityBlock', 'giveItem',
  'giveTrait', 'giveLanguage', 'giveSpellSlot', 'defineCastingSource', 'createValue',
]);

/**
 * Is this op a VALUE-BEARING effect — something that must move a derived value, grant a record, a
 * spell, a slot, a language or a trait on our sheet? Text-only situational bonuses, UI plumbing
 * (PRIMARY_SHEET_TABS), display injections, gates and pickers are not.
 */
export function effectOf(op) {
  const type = op?.type ?? '';
  if (!EFFECT_TYPES.has(type)) return null;
  const d = op.data ?? {};
  const variable = d.variable ?? null;
  let valueBearing = true;
  // PRIMARY_SHEET_TABS adds a sheet tab; BLACKLIST_ABILITY_BLOCKS hides other feats from their pickers —
  // both are WG UI plumbing, not a game rule that must move a value on ours.
  const PLUMBING = new Set(['PRIMARY_SHEET_TABS', 'BLACKLIST_ABILITY_BLOCKS']);
  if (type === 'adjValue' || type === 'setValue') valueBearing = !PLUMBING.has(variable) && d.value !== undefined && d.value !== null;
  else if (type === 'addBonusToValue') valueBearing = d.value !== undefined && d.value !== null;
  else if (type === 'createValue') valueBearing = d.type === 'prof'; // a minted Lore skill is a visible row; a bookkeeping variable is not
  return { type, variable, valueBearing, data: d };
}

/* ---- delivery on the built character (the chassis fallback) -------------------------------------- */

/**
 * WHY A SECOND CHECK. The harness measures delivery as a DIFFERENTIAL — build with the record, build
 * without, diff the derived sheet. That is clean for feats, heritages and backgrounds. A class feature
 * is different: our engine implements Cleric Spellcasting, Perception Expertise or Reflex Expertise on
 * the CLASS CHASSIS (ClassDef tables), so removing the feature record from the class's list moves
 * nothing — the sheet was right all along and the differential says "0 values moved". So when the
 * differential is empty, ask the built character DIRECTLY whether each of their value-bearing ops is
 * visible on it. Only ops with a predicate here can be judged; the rest are reported as unchecked, and
 * a record with nothing checkable is UNVERIFIED-EFFECT, never OK.
 */
export const RANK_LETTER = { U: 0, T: 1, E: 2, M: 3, L: 4 };
export const RANK_WORD = { untrained: 0, trained: 1, expert: 2, master: 3, legendary: 4 };
export const VAR_TRACK = {
  PERCEPTION: ['perception'], CLASS_DC: ['classDc'],
  SAVE_FORT: ['saves', 'fortitude'], SAVE_REFLEX: ['saves', 'reflex'], SAVE_WILL: ['saves', 'will'],
  SIMPLE_WEAPONS: ['attacks', 'simple'], MARTIAL_WEAPONS: ['attacks', 'martial'], ADVANCED_WEAPONS: ['attacks', 'advanced'], UNARMED_ATTACKS: ['attacks', 'unarmed'],
  LIGHT_ARMOR: ['defenses', 'light'], MEDIUM_ARMOR: ['defenses', 'medium'], HEAVY_ARMOR: ['defenses', 'heavy'], UNARMORED_DEFENSE: ['defenses', 'unarmored'],
};
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** The 16 core skills; a WG SKILL_* outside this list (Starfinder's Computers, Piloting) has no row on our sheet. */
const CORE_SKILLS = new Set(['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery']);
const rankAt = (prof, path) => {
  let v = prof;
  for (const k of path) v = v?.[k];
  return typeof v === 'string' && v in RANK_WORD ? RANK_WORD[v] : null;
};

/**
 * 'delivered' | 'undelivered' | 'unchecked' for one value-bearing effect against the SURFACE summary the
 * harness wrote for the built character (proficiencies, spellcasting entries, feat/feature/spell names).
 * `names.block` / `names.spell` map WG ability_block / spell ids to names.
 */
export function effectDelivery(effect, surface, names = {}) {
  if (!surface) return 'unchecked';
  const { type, variable, data = {} } = effect;
  const sc = surface.spellcasting ?? [];
  const has = (list, name) => (list ?? []).some((x) => norm(x) === norm(name));
  if ((type === 'adjValue' || type === 'setValue') && /^SPEED(_[A-Z]+)?$/.test(variable ?? '')) {
    // A granted or raised Speed: is that movement type present (and non-zero) on the derived speeds?
    // Tolerates both an object keyed by type and a list of {type, value|speed}.
    const want = variable === 'SPEED' ? 'land' : variable.slice(6).toLowerCase();
    const sp = surface.speeds;
    if (!sp) return 'unchecked';
    let have = null;
    if (Array.isArray(sp)) { const e = sp.find((x) => norm(x?.type ?? x?.kind ?? x?.name) === norm(want)); have = e ? (e.value ?? e.speed ?? e.feet ?? null) : 0; }
    else if (typeof sp === 'object') { const k = Object.keys(sp).find((x) => norm(x) === norm(want)); have = k ? sp[k] : 0; if (have && typeof have === 'object') have = have.value ?? have.speed ?? have.feet ?? 1; }
    if (have == null) return 'unchecked';
    return Number(have) > 0 ? 'delivered' : 'undelivered';
  }
  if ((type === 'adjValue' || type === 'setValue') && variable === 'WEAPON_CRITICAL_SPECIALIZATIONS') {
    // Their critical-specialization grant ↔ our critSpec lane (critSpecSources on the built character).
    if (surface.critSpec == null) return 'unchecked';
    return surface.critSpec > 0 ? 'delivered' : 'undelivered';
  }
  if ((type === 'adjValue' || type === 'setValue') && variable === 'RESISTANCES') {
    const res = surface.defenses?.resistances;
    if (!Array.isArray(res)) return 'unchecked';
    return res.length > 0 ? 'delivered' : 'undelivered';
  }
  if (/^SKILL_LORE_/.test(variable ?? '') && (type === 'createValue' || type === 'adjValue' || type === 'setValue' || type === 'addBonusToValue')) {
    // A minted or trained Lore ↔ a `lore:<subject>` row on our proficiencies (name-matched loosely);
    // a bonus to one ↔ a star on that row.
    const subject = norm(variable.slice('SKILL_LORE_'.length));
    const find = (list) => list.find((k) => norm(k.slice(5)).includes(subject) || subject.includes(norm(k.slice(5))));
    const trained = find(Object.keys(surface.proficiencies?.skills ?? {}).filter((k) => k.startsWith('lore:')));
    // An UNTRAINED row exists wherever the sheet shows a star for it (sheetLoreKeys) — WG's
    // `createValue SKILL_LORE_GAMES = U` is exactly that row, and a bonus lands on it.
    const row = trained ?? find(Object.keys(surface.stars ?? {}).filter((k) => k.startsWith('lore:')));
    if (type === 'addBonusToValue') return row ? (surface.stars?.[row] ? 'delivered' : 'undelivered') : 'undelivered';
    const letter = typeof data.value === 'object' && data.value ? data.value.value : data.value;
    if (type === 'createValue' && letter === 'U') return row ? 'delivered' : 'undelivered';
    return trained ? 'delivered' : 'undelivered';
  }
  if (type === 'adjValue' || type === 'setValue') {
    const letter = typeof data.value === 'object' && data.value ? data.value.value : data.value;
    if (typeof letter !== 'string' || !(letter in RANK_LETTER)) return 'unchecked';
    const want = RANK_LETTER[letter];
    if (variable === 'SPELL_ATTACK' || variable === 'SPELL_DC') {
      const best = Math.max(-1, ...sc.map((e) => RANK_WORD[e.proficiency] ?? -1));
      return best < 0 ? 'unchecked' : best >= want ? 'delivered' : 'undelivered';
    }
    let path = VAR_TRACK[variable];
    if (!path && /^SKILL_[A-Z]+$/.test(variable ?? '') && !variable.startsWith('SKILL_LORE')) {
      const sk = variable.slice(6).toLowerCase();
      if (!CORE_SKILLS.has(sk)) return 'unchecked'; // Starfinder's Computers / Piloting: no row on our sheet
      path = ['skills', sk];
    }
    if (!path) return 'unchecked';
    const got = rankAt(surface.proficiencies, path);
    if (got == null) return 'unchecked';
    return got >= want ? 'delivered' : 'undelivered';
  }
  if (type === 'addBonusToValue') {
    // A conditional numeric bonus ("+1 circumstance to Stealth in dim light") reaches our player as a
    // `*` on the stat row. So the predicate is: is that row starred on the built character?
    const stars = surface.stars ?? {};
    let key = null;
    if (variable === 'PERCEPTION') key = 'perception';
    else if (variable === 'AC_BONUS') key = 'ac';
    else if (variable === 'CLASS_DC') key = 'classDc';
    else if (variable === 'SAVE_FORT') key = 'fortitude';
    else if (variable === 'SAVE_REFLEX') key = 'reflex';
    else if (variable === 'SAVE_WILL') key = 'will';
    else if (variable === 'ATTACK_DAMAGE_BONUS' || variable === 'ATTACK_ROLL_BONUS') key = variable === 'ATTACK_DAMAGE_BONUS' ? 'strikeDamage' : 'strikeAttack';
    else if (/^SPEED(_[A-Z]+)?$/.test(variable ?? '')) key = 'speed';
    else if (/^SKILL_[A-Z]+$/.test(variable ?? '') && !variable.startsWith('SKILL_LORE')) {
      key = variable.slice(6).toLowerCase();
      // A skill our sheet has no row for (Starfinder's Computers) cannot be judged here.
      if (!CORE_SKILLS.has(key)) return 'unchecked';
    }
    if (!key) return 'unchecked';
    return stars[key] ? 'delivered' : 'undelivered';
  }
  if (type === 'giveTrait') {
    const name = names.trait?.get(String(data.traitId));
    if (!name) return 'unchecked';
    // WG names creature traits "Plant (creature)" / "Unholy (creature)"; ours is the bare trait.
    return has(surface.traits, name) || has(surface.traits, name.replace(/\s*\(creature\)\s*$/i, '')) ? 'delivered' : 'undelivered';
  }
  if (type === 'defineCastingSource') {
    const token = String(data.value ?? '').split(':::')[1] ?? '';
    if (token === '-') return sc.length ? 'delivered' : 'undelivered';
    return sc.some((e) => e.type === 'prepared' || e.type === 'spontaneous') ? 'delivered' : 'undelivered';
  }
  if (type === 'giveSpellSlot') return sc.some((e) => (e.slotRanks ?? 0) > 0 || (e.cantripCap ?? 0) > 0) ? 'delivered' : 'undelivered';
  if (type === 'giveAbilityBlock') {
    const name = names.block?.get(String(data.abilityBlockId));
    if (!name) return 'unchecked';
    return has(surface.featNames, name) || has(surface.featureNames, name) ? 'delivered' : 'undelivered';
  }
  if (type === 'giveSpell') {
    const name = names.spell?.get(String(data.spellId));
    if (!name) return 'unchecked';
    return has(surface.spellNames, name) ? 'delivered' : 'undelivered';
  }
  return 'unchecked';
}

/** Judge every OPEN value-bearing effect; returns the three buckets with the effects themselves. */
export function judgeDelivery(effects, surface, names = {}) {
  const out = { delivered: [], undelivered: [], unchecked: [] };
  for (const e of effects) out[effectDelivery(e, surface, names)].push(e);
  return out;
}

/* ---- the verdict --------------------------------------------------------------------------------- */

export const VERDICTS = ['OK', 'MISSING-CONTROL', 'NO-SHEET-EFFECT', 'UNVERIFIED-EFFECT', 'UNSUPPORTED', 'HARNESS-ERROR'];

/**
 * One record's verdict from their ops (already flattened with context) and our observed evidence.
 *
 * @param {object} args
 * @param {boolean} args.supported     the harness could build a host that owns the record
 * @param {string|null} args.error     a harness error, if any
 * @param {Array<{lane:string,title:string,gate:string,inOption:boolean}>} args.selects   their selects
 * @param {Array<{ctl:string,title:string,lane?:string}>} args.controls   our controls the record ADDED
 * @param {Array<{valueBearing:boolean,gate:string,inOption:boolean,type:string,variable:string|null}>} args.effects
 * @param {number} args.sheetDiffCount   derived-sheet changes attributable to the record
 * @param {object} [args.delivery]       judgeDelivery() of the open effects on the built character —
 *                                       consulted only when the differential moved nothing
 */
export function verdictFor({ supported, error, selects, controls, effects, sheetDiffCount, delivery }) {
  if (!supported) return { verdict: 'UNSUPPORTED', unmatched: [], extra: [], openEffects: 0, deliveredBy: null };
  if (error) return { verdict: 'HARNESS-ERROR', unmatched: [], extra: [], openEffects: 0, deliveredBy: null };
  const open = selects.filter((s) => s.gate === 'open' && !s.inOption);
  const { unmatched, extra } = matchSelects(open, controls.map((c) => ({ ...c, lane: c.lane ?? laneOfControl(c) })));
  const openEffects = effects.filter((e) => e.valueBearing && e.gate === 'open' && !e.inOption).length;
  let verdict = 'OK';
  let deliveredBy = openEffects ? 'differential' : null;
  if (unmatched.length) verdict = 'MISSING-CONTROL';
  else if (openEffects > 0 && sheetDiffCount === 0) {
    if (delivery?.undelivered?.length) { verdict = 'NO-SHEET-EFFECT'; deliveredBy = null; }
    else if (delivery?.delivered?.length) deliveredBy = 'surface';
    else if (delivery?.unchecked?.length) { verdict = 'UNVERIFIED-EFFECT'; deliveredBy = null; }
    else { verdict = 'NO-SHEET-EFFECT'; deliveredBy = null; }
  }
  return { verdict, unmatched, extra, openEffects, deliveredBy };
}
