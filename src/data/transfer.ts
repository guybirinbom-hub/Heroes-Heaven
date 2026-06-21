/*
 * Character import / export.
 *
 * Two file shapes are supported:
 *
 *  1. Wanderer's Codex native — a lossless dump of the SavedChar (character + build +
 *     play). Re-imports perfectly; the only format that round-trips Codex↔Codex.
 *
 *  2. Wanderer's Guide (WG) JSON, version 4 — the cross-app format documented in
 *     WG-IMPORT-EXPORT-FORMAT.md. WG binds all content to its OWN integer content IDs
 *     and per-operation UUIDs, which Codex (slug-keyed, Foundry-sourced content) does
 *     not have. Consequences, by direction:
 *       • Export → WG: we emit a spec-shaped { version:4, character, content } file.
 *         The `content` block (the human-readable, engine-resolved snapshot) is filled
 *         faithfully from our derived stats. The `character` block carries name, level,
 *         vitals, bio, and coins — but NOT a rebuildable WG build (we can't author WG's
 *         operation_data.selections or full WG ancestry/class/item rows). So WG imports
 *         it as a near-blank build with the right name/level/vitals.
 *       • Import ← WG: we rebuild a Codex character best-effort by NAME-MATCHING the WG
 *         file's resolved content (ancestry/heritage/background/class/deity/feats/spells/
 *         items/skills) to our slugs. Anything whose name we don't carry is dropped and
 *         listed in the returned ImportReport.
 */
import type { AbilityId, Character, Coins, ContentDatabase, NotePage } from '../rules/types';
import { ABILITIES, SKILLS } from '../rules/types';
import { newRosterId, type SavedChar } from './storage';
import { buildCharacter, classChoosesDeity, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../rules/build';
import { applyPlayState } from '../rules/play';
import { normalizeCharacter, normalizePlay } from '../rules/normalize';
import {
  abilityMod,
  deriveAc,
  deriveClassDc,
  deriveDefenses,
  deriveMaxHp,
  derivePerception,
  deriveSave,
  deriveSkill,
  deriveSpeeds,
} from '../rules/derive';

export const WG_VERSION = 4;
const CODEX_APP = 'wanderers-codex';

/** What an import did — surfaced to the user so a lossy WG import is transparent. */
export interface ImportReport {
  /** Where the file came from. */
  source: 'Wanderer’s Codex' | 'Wanderer’s Guide';
  /** True only for a native Codex file (nothing lost). */
  lossless: boolean;
  /** Things successfully brought across (for the success summary). */
  resolved: string[];
  /** Dropped content + caveats the user should know about. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/** Normalize a name or slug for fuzzy matching ("Cloistered Cleric" ↔ "cloistered-cleric"). */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function wgCoins(c?: Coins): { cp: number; sp: number; gp: number; pp: number } {
  return { cp: c?.cp ?? 0, sp: c?.sp ?? 0, gp: c?.gp ?? 0, pp: c?.pp ?? 0 };
}

/** Build a name/slug → id index for a content record. */
function nameIndex(rec: Record<string, { name: string }>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [id, v] of Object.entries(rec)) {
    m.set(norm(id), id);
    if (v?.name) m.set(norm(v.name), id); // name wins over slug if they collide
  }
  return m;
}

// WG encodes striking/resilient as a tier NUMBER (0 none, 1, 2, 3); Codex uses named tiers.
const STRIKING_TIERS = ['', 'striking', 'greater', 'major'] as const;
const RESILIENT_TIERS = ['', 'resilient', 'greater', 'major'] as const;

/** Map a WG item's `meta_data.runes` to Codex's WeaponRunes/ArmorRunes for the matched item type.
 *  Without this the imported item loses its potency/striking/resilient/property runes — e.g.
 *  Handwraps of Mighty Blows would carry no potency and silently buff nothing. */
function mapWgRunes(wg: any, itemType: string, runesIdx: Map<string, string>): Record<string, unknown> | undefined {
  if (!wg || typeof wg !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  const potency = Number(wg.potency) || 0;
  if (potency) out.potency = potency;
  if (itemType === 'weapon' && Number(wg.striking)) out.striking = STRIKING_TIERS[Number(wg.striking)];
  if (itemType === 'armor' && Number(wg.resilient)) out.resilient = RESILIENT_TIERS[Number(wg.resilient)];
  if (itemType === 'shield' && Number(wg.reinforcing)) out.reinforcing = Number(wg.reinforcing);
  const property = (Array.isArray(wg.property) ? wg.property : [])
    .map((p: unknown) => (typeof p === 'string' ? runesIdx.get(norm(p)) : undefined))
    .filter((x: unknown): x is string => !!x);
  if (property.length) out.property = property;
  return Object.keys(out).length ? out : undefined;
}

// ===========================================================================
// EXPORT
// ===========================================================================

/** Lossless Codex-native export (round-trips perfectly back through importCharacter). */
export function exportNative(saved: SavedChar): string {
  return JSON.stringify(
    {
      app: CODEX_APP,
      formatVersion: 1,
      kind: 'character',
      character: saved.character,
      build: saved.build ?? null,
      play: saved.play ?? null,
    },
    null,
    2,
  );
}

/** A minimal TipTap doc wrapping plain text (WG notes are TipTap JSON). */
function tiptap(text: string): unknown {
  return { type: 'doc', content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [] };
}

function wgNotes(notes: NotePage[] | undefined): unknown {
  if (!notes || notes.length === 0) return null;
  return {
    pages: notes.map((p) => ({
      name: p.title,
      icon: p.icon ?? '',
      color: p.color ?? '',
      contents: tiptap(stripHtml(p.content || '')),
    })),
  };
}

/** The export-only `content` block: a faithful, engine-resolved snapshot (WG ignores it
 *  on import; it's for humans / other tools / WG's content view). */
function contentSnapshot(ch: Character, content: ContentDatabase): unknown {
  const attributes: Record<string, number> = {};
  for (const a of ABILITIES) attributes[a] = abilityMod(ch.abilities[a]);

  const proficiencies: Record<string, { total: number }> = {};
  for (const s of ['fortitude', 'reflex', 'will'] as const) proficiencies[`SAVE_${s.toUpperCase()}`] = { total: deriveSave(ch, s, content).modifier };
  proficiencies.PERCEPTION = { total: derivePerception(ch).modifier };
  proficiencies.CLASS_DC = { total: deriveClassDc(ch).dc };
  for (const sk of SKILLS) proficiencies[`SKILL_${sk.toUpperCase()}`] = { total: deriveSkill(ch, sk, content).modifier };

  const speeds = deriveSpeeds(ch, content);
  const def = deriveDefenses(ch, content);

  const spellNames = new Set<string>();
  for (const e of ch.spellcasting) {
    for (const id of e.cantrips ?? []) spellNames.add(content.spells[id]?.name ?? id);
    for (const ids of Object.values(e.repertoire ?? {})) for (const id of ids) spellNames.add(content.spells[id]?.name ?? id);
    for (const slots of Object.values(e.prepared ?? {})) for (const sl of slots) if (sl.spellId) spellNames.add(content.spells[sl.spellId]?.name ?? sl.spellId);
    for (const ids of Object.values(e.spellbook ?? {})) for (const id of ids) spellNames.add(content.spells[id]?.name ?? id);
  }

  return {
    _README:
      'Exported from Wanderer’s Codex. This block is a human-readable snapshot of the resolved character; ' +
      'Wanderer’s Guide does not read it on import. Codex uses its own slug-based content, so a re-import into ' +
      'WG will not reconstruct the mechanical build (class/feats/spells) — only name, level, vitals, and bio.',
    ancestry: ch.ancestryId ? content.ancestries[ch.ancestryId]?.name : null,
    background: ch.backgroundId ? content.backgrounds[ch.backgroundId]?.name : null,
    class: ch.classId ? content.classes[ch.classId]?.name : null,
    level: ch.level,
    attributes,
    proficiencies,
    max_hp: deriveMaxHp(ch, content),
    ac: deriveAc(ch, content).value,
    speeds: (['land', 'fly', 'swim', 'climb', 'burrow'] as const)
      .filter((k) => speeds[k] != null)
      .map((k) => ({ name: k, value: speeds[k] })),
    languages: ch.languages.map((id) => content.languages[id]?.name ?? id),
    senses: def.senses.map((s) => s.name),
    feats_features: ch.feats.map((f) => ({ name: content.feats[f.featId]?.name ?? f.featId, level: f.level, category: f.category })),
    inventory_flat: ch.inventory.map((i) => ({ name: content.items[i.itemId]?.name ?? i.itemId, quantity: i.quantity })),
    spells: [...spellNames],
  };
}

/** Wanderer's Guide v4 export. Spec-shaped; see the file header for what does and does
 *  not transfer into WG's build engine. */
export function exportWg(saved: SavedChar, content: ContentDatabase): string {
  const ch = applyPlayState(saved.character, saved.play, content);
  const d = ch.details ?? {};

  const character = {
    name: ch.name,
    level: ch.level,
    experience: ch.xp ?? 0,
    hp_current: ch.hitPoints.current,
    hp_temp: ch.hitPoints.temp,
    hero_points: ch.heroPoints,
    stamina_current: 0,
    resolve_current: 0,
    inventory: {
      coins: wgCoins(ch.currency),
      // WG inventory items must be full WG item rows (its own ids/operations), which we
      // can't author — so we leave items empty here; the readable list lives in `content`.
      items: [] as unknown[],
    },
    notes: wgNotes(ch.notes),
    roll_history: null,
    // Spells reference WG integer spell IDs we don't have → can't map; see `content.spells`.
    spells: null,
    operation_data: { selections: {}, notes: {} },
    meta_data: {},
    details: {
      image_url: ch.appearance?.portrait ?? '',
      info: {
        appearance: d.appearance ?? '',
        personality: d.personality ?? '',
        alignment: d.alignment ?? '',
        age: d.age ?? '',
        height: d.height ?? '',
        weight: d.weight ?? '',
        gender: d.gender ?? '',
        pronouns: d.pronouns ?? '',
        ethnicity: d.ethnicity ?? '',
        nationality: d.nationality ?? '',
        birthplace: d.birthplace ?? '',
      },
    },
    custom_operations: null,
    options: { auto_detect_prerequisites: true },
    variants: {},
    content_sources: { enabled: [1] },
    companions: null,
    campaign_id: null,
  };

  return JSON.stringify({ version: WG_VERSION, character, content: contentSnapshot(ch, content) }, null, 2);
}

// ===========================================================================
// IMPORT
// ===========================================================================

/** Parse any supported file into a roster entry + a report of what happened. Throws a
 *  human-readable Error if the file isn't recognized. */
export function importCharacter(text: string, content: ContentDatabase): { saved: SavedChar; report: ImportReport } {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  if (obj && obj.app === CODEX_APP) return importNative(obj);
  if (obj && obj.version === WG_VERSION && obj.character) return importFromWg(obj, content);
  if (obj && typeof obj.version === 'number' && obj.version !== WG_VERSION) {
    throw new Error(`This looks like a Wanderer’s Guide file of version ${obj.version}. Only version ${WG_VERSION} is supported.`);
  }
  throw new Error('Unrecognized file. Expected a Wanderer’s Codex export or a Wanderer’s Guide version-4 JSON.');
}

function importNative(obj: any): { saved: SavedChar; report: ImportReport } {
  const character = obj.character as Character | undefined;
  if (!character || typeof character !== 'object' || typeof character.name !== 'string') {
    throw new Error('This Codex file is missing its character data.');
  }
  const saved: SavedChar = {
    id: newRosterId(),
    character: normalizeCharacter(character),
    build: obj.build ?? undefined,
    play: obj.play ? normalizePlay(obj.play) : undefined,
    archived: false,
  };
  return {
    saved,
    report: {
      source: 'Wanderer’s Codex',
      lossless: true,
      resolved: [`${character.name} — level ${character.level}`, 'Imported losslessly (full build + play state).'],
      warnings: [],
    },
  };
}

/** Read an ability modifier out of WG's `content.attributes` (key spelling varies). */
function readMod(attrs: any, abil: AbilityId): number | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const up = abil.toUpperCase();
  for (const t of [attrs[`ATTRIBUTE_${up}`], attrs[up], attrs[abil], attrs[`attr_${abil}`]]) {
    if (typeof t === 'number') return t;
    if (t && typeof t === 'object' && typeof t.value === 'number') return t.value;
  }
  return null;
}

function importFromWg(obj: any, content: ContentDatabase): { saved: SavedChar; report: ImportReport } {
  const c = obj.character ?? {};
  const snap = obj.content ?? {};
  const resolved: string[] = [];
  const warnings: string[] = [];

  const ancestries = nameIndex(content.ancestries);
  const backgrounds = nameIndex(content.backgrounds);
  const classes = nameIndex(content.classes);
  const deities = nameIndex(content.deities);
  const featsIdx = nameIndex(content.feats);
  const spellsIdx = nameIndex(content.spells);
  const itemsIdx = nameIndex(content.items);
  const runesIdx = nameIndex(content.runes);

  const ancName: string | undefined = c.details?.ancestry?.name ?? snap.ancestry;
  const bgName: string | undefined = c.details?.background?.name ?? snap.background;
  const clsName: string | undefined = c.details?.class?.name ?? snap.class;

  const ancestryId = ancName ? ancestries.get(norm(ancName)) ?? null : null;
  const backgroundId = bgName ? backgrounds.get(norm(bgName)) ?? null : null;
  const classId = clsName ? classes.get(norm(clsName)) ?? null : null;

  if (ancName) (ancestryId ? resolved : warnings).push(`Ancestry: ${ancName}${ancestryId ? '' : ' (not found — left unset)'}`);
  if (bgName) (backgroundId ? resolved : warnings).push(`Background: ${bgName}${backgroundId ? '' : ' (not found — left unset)'}`);
  if (clsName) (classId ? resolved : warnings).push(`Class: ${clsName}${classId ? '' : ' (not found — left unset)'}`);

  const cls = classId ? content.classes[classId] : undefined;

  // feats_features carries the resolved subclass, heritage, deity, and chosen feats by name.
  // WG exports it either as a flat array or (v4) as an object keyed by category
  // (classFeats, ancestryFeats, classFeatures, heritages, generalAndSkillFeats, …); flatten both.
  const rawFeatures: unknown[] = Array.isArray(snap.feats_features)
    ? snap.feats_features
    : snap.feats_features && typeof snap.feats_features === 'object'
      ? Object.values(snap.feats_features as Record<string, unknown>).flat()
      : [];
  const features: { name: string; level?: number }[] = rawFeatures.filter(
    (f): f is { name: string; level?: number } => !!f && typeof (f as any).name === 'string',
  );
  const featureNorms = features.map((f) => norm(f.name));

  // Subclass: match a feature name to one of this class's subclass options.
  let subclassId: string | null = null;
  if (cls?.subclass) {
    const opt = cls.subclass.options.find((o) => featureNorms.includes(norm(o.name)));
    if (opt) {
      subclassId = opt.id;
      resolved.push(`${cls.subclass.name}: ${opt.name}`);
    }
  }

  // Heritage: match a feature/trait name to a heritage of the chosen ancestry.
  let heritageId: string | null = null;
  if (ancestryId) {
    const heritageOpts = Object.values(content.heritages).filter((h) => h.ancestryId === ancestryId || h.ancestryId === null);
    const h = heritageOpts.find((opt) => featureNorms.includes(norm(opt.name)));
    if (h) {
      heritageId = h.id;
      resolved.push(`Heritage: ${h.name}`);
    } else {
      warnings.push('Heritage could not be detected from the file — left unset.');
    }
  }

  // Deity: try a feature name, else the bio.
  let deityId: string | null = null;
  {
    const cand = features.map((f) => f.name).find((n) => deities.get(norm(n)));
    if (cand) {
      deityId = deities.get(norm(cand)) ?? null;
      if (deityId) resolved.push(`Deity: ${content.deities[deityId].name}`);
    } else if (classChoosesDeity(cls?.features)) {
      warnings.push('Deity could not be detected — pick one in the builder.');
    }
  }

  // Key attribute: WG gives final scores; pick the class's best-scoring key option.
  let keyAbility: AbilityId | null = cls?.keyAbility?.[0] ?? null;
  if (cls && cls.keyAbility.length > 1) {
    let best: AbilityId | null = null;
    let bestMod = -99;
    for (const k of cls.keyAbility) {
      const m = readMod(snap.attributes, k);
      if (m != null && m > bestMod) {
        bestMod = m;
        best = k;
      }
    }
    if (best) keyAbility = best;
  }

  // Baseline character from identity alone, then layer the WG specifics onto it.
  const baseBuild: BuildState = { ...emptyBuild(), name: c.name ?? 'Imported character', level: clampLevel(c.level), ancestryId, heritageId, backgroundId, classId, subclassId, deityId, keyAbility };
  let ch: Character;
  try {
    ch = buildCharacter(baseBuild, content);
  } catch {
    // Identity was too incomplete to build — fall back to a blank level-1.
    ch = buildCharacter({ ...emptyBuild(), name: c.name ?? 'Imported character' }, content);
    warnings.push('Could not build from the detected identity; imported a blank character instead.');
  }

  // Final ability scores from WG's resolved modifiers (score = 10 + 2·mod for the even
  // PF2e array). deriveBuildFromCharacter then solves boosts that reproduce them.
  const scores = { ...ch.abilities };
  let gotScores = false;
  for (const a of ABILITIES) {
    const m = readMod(snap.attributes, a);
    if (m != null) {
      scores[a] = Math.max(1, 10 + 2 * m);
      gotScores = true;
    }
  }
  if (gotScores) resolved.push('Ability scores matched.');
  else warnings.push('Ability scores not found in the file — used class defaults.');

  // Chosen feats → match by name; place on the character so deriveBuildFromCharacter slots them.
  const matchedFeats: { featId: string; level: number; category: Character['feats'][number]['category'] }[] = [];
  const unmatchedFeats: string[] = [];
  for (const f of features) {
    const id = featsIdx.get(norm(f.name));
    if (!id) continue; // not necessarily a feat (could be a class feature label) — skip silently
    const ft = content.feats[id];
    matchedFeats.push({ featId: id, level: ft.level || f.level || 1, category: ft.category });
  }
  // Anything that looked like a feat the engine knows but we couldn't find:
  for (const f of features) {
    if (!featsIdx.get(norm(f.name)) && /feat|dedication|prowess/i.test(f.name)) unmatchedFeats.push(f.name);
  }
  if (matchedFeats.length) {
    ch = { ...ch, feats: matchedFeats };
    resolved.push(`${matchedFeats.length} feat${matchedFeats.length === 1 ? '' : 's'} matched.`);
  }
  if (unmatchedFeats.length) warnings.push(`Feats not in Codex content (dropped): ${unmatchedFeats.slice(0, 12).join(', ')}${unmatchedFeats.length > 12 ? '…' : ''}`);

  // Trained skills from the proficiency snapshot (best-effort; ranks above trained are approximate).
  // WG v4 entries carry parts.profValue (the proficiency bonus: 0/2/4/6/8) and a STRING total
  // ("+10") with no rank field, so prefer profValue; older/synthetic shapes use a rank string or a
  // numeric total. profValue is authoritative when present (0 = untrained — don't fall through).
  const trained = new Set<string>();
  if (snap.proficiencies && typeof snap.proficiencies === 'object') {
    for (const sk of SKILLS) {
      const e = snap.proficiencies[`SKILL_${sk.toUpperCase()}`] ?? snap.proficiencies[sk.toUpperCase()];
      if (!e || typeof e !== 'object') continue;
      const profVal = e.parts && typeof e.parts.profValue === 'number' ? e.parts.profValue : undefined;
      const rankStr = typeof e.rank === 'string' ? e.rank : typeof e.proficiency === 'string' ? e.proficiency : undefined;
      const totalNum = typeof e.total === 'number' ? e.total : typeof e.total === 'string' ? parseInt(e.total, 10) : NaN;
      const isTrained =
        profVal != null
          ? profVal >= 2
          : rankStr != null
            ? rankStr !== 'untrained' && rankStr !== ''
            : Number.isFinite(totalNum) && totalNum >= clampLevel(c.level);
      if (isTrained) trained.add(sk);
    }
  }
  if (trained.size) {
    const sk = ch.proficiencies.skills as Record<string, string>;
    for (const s of trained) if (!sk[s] || sk[s] === 'untrained') sk[s] = 'trained';
    resolved.push(`${trained.size} trained skill${trained.size === 1 ? '' : 's'} (ranks above trained are approximate).`);
  }

  // Reverse-derive a clean, editable build from the assembled character.
  let build: BuildState;
  try {
    build = deriveBuildFromCharacter({ ...ch, abilities: scores }, content);
  } catch {
    build = baseBuild;
    warnings.push('Could not fully reverse-derive the build; some choices may need fixing in the builder.');
  }

  // Spells & cantrips by name → onto the build, then rebuild.
  const spellWarn: string[] = [];
  const cantrips = collectSpells(snap, 'cantrips', spellsIdx, spellWarn);
  if (cantrips.length) build.cantrips = cantrips;
  const byRank = collectLeveledSpells(snap, spellsIdx, spellWarn);
  if (Object.keys(byRank).length) build.spells = byRank;
  const spellCount = cantrips.length + Object.values(byRank).reduce((n, a) => n + a.length, 0);
  if (spellCount) resolved.push(`${spellCount} spell${spellCount === 1 ? '' : 's'} matched.`);
  if (spellWarn.length) warnings.push(`Spells not in Codex content (dropped): ${spellWarn.slice(0, 12).join(', ')}${spellWarn.length > 12 ? '…' : ''}`);

  // Inventory by name (WG embeds the item name on each row).
  const invWarn: string[] = [];
  const wgItems: any[] = Array.isArray(c.inventory?.items) ? c.inventory.items : [];
  const builtInv: BuildState['inventory'] = [];
  for (const row of wgItems) {
    const nm: string | undefined = row?.item?.name;
    if (!nm) continue;
    const id = itemsIdx.get(norm(nm));
    if (!id) {
      invWarn.push(nm);
      continue;
    }
    const qty = Number(row?.item?.meta_data?.quantity) || 1;
    const runes = mapWgRunes(row?.item?.meta_data?.runes, content.items[id]?.itemType ?? '', runesIdx);
    builtInv.push({ itemId: id, quantity: qty, equipped: !!row.is_equipped, invested: !!row.is_invested, ...(runes ? { runes } : {}) });
  }
  if (builtInv.length) {
    build.inventory = builtInv;
    resolved.push(`${builtInv.length} item${builtInv.length === 1 ? '' : 's'} matched.`);
  }
  if (invWarn.length) warnings.push(`Items not in Codex content (dropped): ${invWarn.slice(0, 12).join(', ')}${invWarn.length > 12 ? '…' : ''}`);

  // Final rebuild from the assembled build.
  let character: Character;
  try {
    character = buildCharacter(build, content);
  } catch {
    character = ch;
    warnings.push('Final rebuild failed; kept the partially-assembled character.');
  }

  // Patch in coins, vitals, bio, and portrait the build doesn't carry.
  const coins = c.inventory?.coins;
  if (coins) character.currency = { pp: coins.pp ?? 0, gp: coins.gp ?? 0, sp: coins.sp ?? 0, cp: coins.cp ?? 0 };
  character.xp = c.experience ?? 0;
  character.heroPoints = clamp(c.hero_points ?? 1, 0, 3);
  const maxHp = deriveMaxHp(character, content);
  character.hitPoints = {
    ...character.hitPoints,
    current: typeof c.hp_current === 'number' ? clamp(c.hp_current, 0, maxHp) : maxHp,
    temp: typeof c.hp_temp === 'number' ? Math.max(0, c.hp_temp) : 0,
  };
  const info = c.details?.info ?? {};
  character.details = {
    ...character.details,
    alignment: info.alignment || character.details.alignment,
    age: info.age || character.details.age,
    height: info.height || character.details.height,
    weight: info.weight || character.details.weight,
    gender: info.gender || character.details.gender,
    pronouns: info.pronouns || character.details.pronouns,
    ethnicity: info.ethnicity || character.details.ethnicity,
    nationality: info.nationality || character.details.nationality,
    birthplace: info.birthplace || character.details.birthplace,
    appearance: info.appearance || character.details.appearance,
    personality: info.personality || character.details.personality,
  };
  if (typeof c.details?.image_url === 'string' && c.details.image_url) {
    character.appearance = { ...(character.appearance ?? {}), portrait: c.details.image_url };
  }

  warnings.push(
    'Wanderer’s Guide build choices are matched to Codex content by name; anything unmatched above was dropped. Review the character in the builder.',
  );

  return {
    saved: { id: newRosterId(), character, build, archived: false },
    report: { source: 'Wanderer’s Guide', lossless: false, resolved, warnings },
  };
}

function collectSpells(snap: any, key: 'cantrips' | 'normal', idx: Map<string, string>, warn: string[]): string[] {
  const arr = snap?.spells?.[key];
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const s of arr) {
    const nm = s?.name ?? (typeof s === 'string' ? s : undefined);
    if (!nm) continue;
    const id = idx.get(norm(nm));
    if (id) out.push(id);
    else warn.push(nm);
  }
  return out;
}

function collectLeveledSpells(snap: any, idx: Map<string, string>, warn: string[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  const arr = snap?.spells?.normal;
  if (!Array.isArray(arr)) return out;
  for (const s of arr) {
    const nm = s?.name;
    const rank = Number(s?.rank);
    if (!nm || !rank) continue;
    const id = idx.get(norm(nm));
    if (!id) {
      warn.push(nm);
      continue;
    }
    (out[rank] ??= []).push(id);
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function clampLevel(n: unknown): number {
  return typeof n === 'number' && n >= 1 && n <= 20 ? Math.floor(n) : 1;
}
