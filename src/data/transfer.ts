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
import type {
  AbilityId,
  ActiveCondition,
  ArmorCategory,
  Character,
  CharacterOptions,
  Coins,
  CompanionConfig,
  ContentDatabase,
  Item,
  ModeDef,
  ModeModifier,
  NaturalAttack,
  NotePage,
  PinnedDesc,
  ProficiencyRank,
  Rarity,
  Tradition,
  VariantRules,
  WeaponCategory,
} from '../rules/types';
import { ABILITIES, SKILLS } from '../rules/types';
import { newRosterId, type SavedChar } from './storage';
import { buildCharacter, classChoosesDeity, CUSTOM_BACKGROUND_ID, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../rules/build';
import { CORE_BOOKS, sourceCatalog } from '../rules/sources';
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
  source: 'Heroes Heaven' | 'Wanderer’s Guide';
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

/** Loose name match that tolerates WG's category suffix/prefix. WG names subclasses as
 *  "Maestro Muse" / "Mastermind Racket" / "Outwit Edge" while Codex stores the bare option
 *  ("Maestro"), and sometimes the reverse ("Animal Instinct" both sides). Matches when the two
 *  norms are equal or one is the other plus a trailing word. */
function looseMatch(a: string, b: string): boolean {
  return !!a && !!b && (a === b || a.startsWith(b + '-') || b.startsWith(a + '-'));
}

/** Strip a trailing parenthetical so WG "Predictive Purchase (Investigator)" matches Codex
 *  "Predictive Purchase" (and vice-versa). */
function stripParen(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Distinctive tokens of a name (drops generic category words so an extraChoice option matches
 *  however WG phrases it: "Wood Gate" / "Kinetic Element (Wood)" both reduce to {wood}). */
const EXTRA_STOP = new Set(['gate', 'element', 'kinetic', 'the', 'of', 'a', 'an', 'and', 'muse', 'racket', 'style', 'instinct', 'edge', 'mind']);
function distinctTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !EXTRA_STOP.has(t));
}

/** An extraChoice option matches a WG feature name when every distinctive token of the option name
 *  is present in the feature name (handles WG's wrapping/suffixing of the value). */
function extraChoiceMatch(featureName: string, optName: string): boolean {
  const opt = distinctTokens(optName);
  if (!opt.length) return false;
  const feat = new Set(distinctTokens(featureName));
  return opt.every((t) => feat.has(t));
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function wgCoins(c?: Coins): { cp: number; sp: number; gp: number; pp: number } {
  return { cp: c?.cp ?? 0, sp: c?.sp ?? 0, gp: c?.gp ?? 0, pp: c?.pp ?? 0 };
}

// WG <-> Codex variant-rule + option names (the subset both apps share). WG has no Automatic Bonus
// Progression flag (abp stays Codex-only); Codex has no proficiency_half_level / stamina.
function wgVariants(v?: VariantRules): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (v?.ancestryParagon) out.ancestry_paragon = true;
  if (v?.freeArchetype) out.free_archetype = true;
  if (v?.gradualBoosts) out.gradual_attribute_boosts = true;
  if (v?.proficiencyWithoutLevel) out.proficiency_without_level = true;
  if (v?.dualClass) out.dual_class = true;
  if (v?.abp) out.automatic_bonus_progression = true;
  return out;
}
function variantsFromWg(v: any): VariantRules {
  const out: VariantRules = {};
  if (v?.ancestry_paragon) out.ancestryParagon = true;
  if (v?.free_archetype) out.freeArchetype = true;
  if (v?.gradual_attribute_boosts) out.gradualBoosts = true;
  if (v?.proficiency_without_level) out.proficiencyWithoutLevel = true;
  if (v?.dual_class) out.dualClass = true;
  if (v?.automatic_bonus_progression) out.abp = true;
  return out;
}
function wgOptions(o?: CharacterOptions): Record<string, boolean> {
  return {
    auto_detect_prerequisites: true,
    ...(o?.ignoreBulk ? { ignore_bulk_limit: true } : {}),
    ...(o?.alternateAncestryBoosts ? { alternate_ancestry_boosts: true } : {}),
    ...(o?.voluntaryFlaw ? { voluntary_flaws: true } : {}),
  };
}
function optionsFromWg(o: any): CharacterOptions {
  const out: CharacterOptions = {};
  if (o?.ignore_bulk_limit) out.ignoreBulk = true;
  if (o?.alternate_ancestry_boosts) out.alternateAncestryBoosts = true;
  if (o?.voluntary_flaws) out.voluntaryFlaw = true;
  return out;
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
  // WG v4 encodes each property rune as an OBJECT { name, id, rune? } (older/synthetic shapes use a
  // plain string); pull the name either way and match it to a Codex rune id.
  const property = (Array.isArray(wg.property) ? wg.property : [])
    .map((p: unknown) => {
      const nm = typeof p === 'string' ? p : p && typeof p === 'object' ? (p as any).name ?? (p as any).rune?.name : undefined;
      return typeof nm === 'string' ? runesIdx.get(norm(nm)) : undefined;
    })
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
      shared: p.private ? false : true,
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
      'Exported from Heroes Heaven. This block is a human-readable snapshot of the resolved character; ' +
      'Wanderer’s Guide does not read it on import. Heroes Heaven uses its own slug-based content, so a re-import into ' +
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
      ...(ch.monsterParts ? { monster_parts: { value: ch.monsterParts } } : {}),
    },
    notes: wgNotes(ch.notes),
    roll_history: null,
    // Spell LISTS reference WG integer spell IDs we don't have → can't map (see `content.spells`),
    // but the focus-point counter is a plain number WG reads back verbatim.
    spells: ch.focus ? { slots: [], list: [], focus_point_current: ch.focus.current, innate_casts: [] } : null,
    operation_data: { selections: {}, notes: {} },
    meta_data: {},
    details: {
      image_url: ch.appearance?.portrait ?? '',
      // Active conditions in WG's shape (name + optional value); WG re-imports these verbatim.
      conditions: ch.conditions.map((c) => ({
        name: content.conditions[c.id]?.name ?? c.id,
        description: '',
        ...(c.value != null ? { value: c.value } : {}),
        for_object: false,
        for_creature: true,
      })),
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
    options: wgOptions(ch.options),
    variants: wgVariants(ch.variantRules),
    content_sources: { enabled: [1] },
    companions: null,
    campaign_id: null,
  };

  return JSON.stringify({ version: WG_VERSION, character, content: contentSnapshot(ch, content) }, null, 2);
}

// ===========================================================================
// IMPORT
// ===========================================================================

/** Everything an import produces: the roster entry, the transparency report, plus any content the
 *  app must register on accept (homebrew items for unrecognized gear, user modes for WG custom modes). */
export interface ImportResult {
  saved: SavedChar;
  report: ImportReport;
  customItems: Item[];
  /** Wanderer's Guide character-scoped custom modes, converted to app ModeDefs. The caller scopes
   *  them to the final roster id (charId) and persists them. */
  customModes: ModeDef[];
}

/** Parse any supported file into a roster entry + a report of what happened. Throws a
 *  human-readable Error if the file isn't recognized. */
export function importCharacter(text: string, content: ContentDatabase): ImportResult {
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
  throw new Error('Unrecognized file. Expected a Heroes Heaven character export (.codex) or a Wanderer’s Guide version-4 JSON.');
}

function importNative(obj: any): ImportResult {
  const character = obj.character as Character | undefined;
  if (!character || typeof character !== 'object' || typeof character.name !== 'string') {
    throw new Error('This character file is missing its character data.');
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
      source: 'Heroes Heaven',
      lossless: true,
      resolved: [`${character.name} — level ${character.level}`, 'Imported losslessly (full build + play state).'],
      warnings: [],
    },
    customItems: [],
    customModes: [],
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

/** WG's proficiency bonus (content.proficiencies[*].parts.profValue: 0/2/4/6/8) → our rank. */
const WG_PROF_RANK: Record<number, ProficiencyRank> = { 0: 'untrained', 2: 'trained', 4: 'expert', 6: 'master', 8: 'legendary' };
const RANK_ORDER: ProficiencyRank[] = ['untrained', 'trained', 'expert', 'master', 'legendary'];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convert a Wanderer's Guide note page's TipTap/ProseMirror JSON doc into the HTML our NotePage stores. */
function tiptapToHtml(node: any): string {
  if (node == null) return '';
  if (Array.isArray(node)) return node.map(tiptapToHtml).join('');
  if (typeof node === 'string') return escapeHtml(node);
  const kids = Array.isArray(node.content) ? node.content.map(tiptapToHtml).join('') : '';
  switch (node.type) {
    case 'doc': return kids;
    case 'paragraph': return `<p>${kids || '<br>'}</p>`;
    case 'heading': return `<h${node.attrs?.level ?? 2}>${kids}</h${node.attrs?.level ?? 2}>`;
    case 'bulletList': return `<ul>${kids}</ul>`;
    case 'orderedList': return `<ol>${kids}</ol>`;
    case 'listItem': return `<li>${kids}</li>`;
    case 'blockquote': return `<blockquote>${kids}</blockquote>`;
    case 'codeBlock': return `<pre>${kids}</pre>`;
    case 'horizontalRule': return '<hr>';
    case 'hardBreak': return '<br>';
    case 'text': {
      let t = escapeHtml(node.text ?? '');
      for (const m of node.marks ?? []) {
        if (m.type === 'bold') t = `<strong>${t}</strong>`;
        else if (m.type === 'italic') t = `<em>${t}</em>`;
        else if (m.type === 'underline') t = `<u>${t}</u>`;
        else if (m.type === 'strike') t = `<s>${t}</s>`;
        else if (m.type === 'code') t = `<code>${t}</code>`;
        else if (m.type === 'link' && m.attrs?.href) t = `<a href="${escapeHtml(String(m.attrs.href))}">${t}</a>`;
      }
      return t;
    }
    default: return kids;
  }
}

const ITEM_RARITIES = new Set<Rarity>(['common', 'uncommon', 'rare', 'unique']);
const slugifyItem = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
/** WG bulk is a string: "L" (light) → 0.1, "—"/"-"/""/"0" → 0, a number-string → that number. */
function parseImportBulk(b: unknown): number {
  if (typeof b === 'number') return Number.isFinite(b) ? b : 0;
  const s = String(b ?? '').trim();
  if (!s || s === '—' || s === '-' || s === '0') return 0;
  if (/^l$/i.test(s)) return 0.1;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function mapImportPrice(p: any): Coins | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const out: Coins = {};
  for (const k of ['pp', 'gp', 'sp', 'cp'] as const) {
    const n = Number(p[k]);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}
/** Build a generic custom (homebrew) Item from a WG inventory row whose name we don't carry, so the
 *  item still imports — with its name/level/bulk/price/description — instead of being silently dropped. */
function synthImportedItem(wgItem: any): Item {
  const name = String(wgItem?.name ?? '').trim() || 'Unknown item';
  const price = mapImportPrice(wgItem?.price);
  const level = Number(wgItem?.level) || 0;
  const item: Item = {
    // Deterministic id (name + level) so re-importing the SAME character doesn't mint a fresh homebrew
    // copy each time — it dedupes against the existing one instead of piling up "Unknown item" clones.
    id: `custom-${slugifyItem(name)}${level ? `-l${level}` : ''}`,
    name,
    itemType: 'equipment',
    traits: [],
    rarity: ITEM_RARITIES.has(wgItem?.rarity) ? (wgItem.rarity as Rarity) : 'common',
    level,
    bulk: parseImportBulk(wgItem?.bulk),
    description: typeof wgItem?.description === 'string' ? wgItem.description : '',
    source: { license: 'homebrew' },
    ...(price ? { price } : {}),
  };
  return item;
}

// ---- WG variable names → app proficiency tracks (weapon/armor categories + lore skills) ----
const WG_WEAPON_CATS: Record<string, WeaponCategory> = {
  SIMPLE_WEAPONS: 'simple',
  MARTIAL_WEAPONS: 'martial',
  ADVANCED_WEAPONS: 'advanced',
  UNARMED_ATTACKS: 'unarmed',
};
const WG_ARMOR_CATS: Record<string, ArmorCategory> = {
  UNARMORED_DEFENSE: 'unarmored',
  LIGHT_ARMOR: 'light',
  MEDIUM_ARMOR: 'medium',
  HEAVY_ARMOR: 'heavy',
};

/** WG lore variable ("SKILL_LORE___DEEP_EARTH") → the app's lore key ("lore:deep earth"). */
function loreKeyFromWgVar(key: string): string | null {
  const m = /^SKILL_LORE___(.+)$/.exec(key);
  if (!m || m[1] === 'NONE') return null;
  const subject = m[1].toLowerCase().replace(/_/g, ' ').trim();
  return subject ? `lore:${subject}` : null;
}

/** WG attribute strings ('STR') / skill strings ('ATHLETICS') → app ids, or null. */
function abilityFromWg(v: unknown): AbilityId | null {
  const s = String(v ?? '').toLowerCase();
  return (ABILITIES as readonly string[]).includes(s) ? (s as AbilityId) : null;
}
function skillFromWg(v: unknown): (typeof SKILLS)[number] | null {
  const s = String(v ?? '').toLowerCase();
  return (SKILLS as readonly string[]).includes(s) ? (s as (typeof SKILLS)[number]) : null;
}

/** Collect every WG spell-id → name pair the compiled `content` dump exposes (spell rows appear —
 *  with their WG integer id — in spells.all/cantrips/normal/rituals, focus_spells, innate_spells
 *  (nested under .spell), spell_slots (nested under .spell), and all_spells). Lets us resolve the
 *  id-keyed `character.spells` block (signature flags, slot preparations) by name. */
function wgSpellIdNames(snap: any): Map<number, string> {
  const m = new Map<number, string>();
  const add = (rows: unknown) => {
    if (!Array.isArray(rows)) return;
    for (const r of rows as any[]) {
      const row = r?.spell ?? r;
      if (row && typeof row.id === 'number' && typeof row.name === 'string') m.set(row.id, row.name);
    }
  };
  add(snap?.all_spells);
  add(snap?.spells?.all);
  add(snap?.spells?.cantrips);
  add(snap?.spells?.normal);
  add(snap?.spells?.rituals);
  add(snap?.focus_spells);
  add(snap?.innate_spells);
  add(snap?.spell_slots);
  return m;
}

/** Convert a WG character-scoped custom mode ({name, description, effects:[{variable,value,type,text}]})
 *  to an app ModeDef. Effects on variables the app has no mode target for land in the mode's note
 *  instead of being dropped. Returns null for an empty/unusable row. */
function modeFromWg(m: any): ModeDef | null {
  if (!m || typeof m.name !== 'string' || !m.name.trim()) return null;
  const modifiers: ModeModifier[] = [];
  const unmapped: string[] = [];
  for (const e of Array.isArray(m.effects) ? m.effects : []) {
    const value = Number(e?.value);
    const variable = String(e?.variable ?? '');
    if (!variable || !Number.isFinite(value) || value === 0) {
      if (e?.text) unmapped.push(String(e.text));
      continue;
    }
    const type: ModeModifier['type'] = e?.type === 'status' || e?.type === 'circumstance' || e?.type === 'item' ? e.type : 'untyped';
    const base = { value, type, ...(typeof e?.text === 'string' && e.text ? { appliesWhen: e.text } : {}) };
    const lore = loreKeyFromWgVar(variable);
    const skill = variable.startsWith('SKILL_') ? skillFromWg(variable.slice('SKILL_'.length)) : null;
    if (variable === 'AC') modifiers.push({ ...base, target: 'ac' });
    else if (variable === 'PERCEPTION') modifiers.push({ ...base, target: 'perception' });
    else if (variable === 'CLASS_DC') modifiers.push({ ...base, target: 'class-dc' });
    else if (variable === 'SPELL_ATTACK') modifiers.push({ ...base, target: 'spell-attack' });
    else if (variable === 'SPELL_DC') modifiers.push({ ...base, target: 'spell-dc' });
    else if (variable === 'SAVE_FORT') modifiers.push({ ...base, target: 'save', detail: 'fortitude' });
    else if (variable === 'SAVE_REFLEX') modifiers.push({ ...base, target: 'save', detail: 'reflex' });
    else if (variable === 'SAVE_WILL') modifiers.push({ ...base, target: 'save', detail: 'will' });
    else if (lore) modifiers.push({ ...base, target: 'skill', detail: lore });
    else if (skill) modifiers.push({ ...base, target: 'skill', detail: skill });
    else if (/ATTACK/.test(variable)) modifiers.push({ ...base, target: 'attack' });
    else if (/DMG|DAMAGE/.test(variable)) modifiers.push({ ...base, target: 'damage' });
    else unmapped.push(`${variable} ${value > 0 ? '+' : ''}${value}`);
  }
  const note = [
    typeof m.description === 'string' && m.description ? stripHtml(m.description) : '',
    unmapped.length ? `Unmapped effects: ${unmapped.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' — ');
  if (!modifiers.length && !note) return null;
  return {
    id: `wg-mode-${slugifyItem(m.name)}-${newRosterId()}`,
    name: m.name.trim(),
    category: 'Imported',
    modifiers,
    ...(note ? { note } : {}),
  };
}

function importFromWg(obj: any, content: ContentDatabase): ImportResult {
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

  // Parenthetical-tolerant feat lookup: WG and Codex disagree on the "(Investigator)" suffix
  // ("Predictive Purchase" ↔ "Predictive Purchase (Investigator)", "Skill Mastery (Investigator)" ↔
  // "Skill Mastery"), so index feats by their de-parenthesized name and try the query both ways.
  const featsNoParen = new Map<string, string>();
  for (const [id, f] of Object.entries(content.feats)) {
    const np = norm(stripParen(f.name));
    if (np && !featsNoParen.has(np)) featsNoParen.set(np, id);
  }
  const matchFeat = (nm: string): string | undefined =>
    featsIdx.get(norm(nm)) ?? featsIdx.get(norm(stripParen(nm))) ?? featsNoParen.get(norm(nm)) ?? featsNoParen.get(norm(stripParen(nm)));

  const ancName: string | undefined = c.details?.ancestry?.name ?? snap.ancestry;
  const bgName: string | undefined = c.details?.background?.name ?? snap.background;
  const clsName: string | undefined = c.details?.class?.name ?? snap.class;

  const ancestryId = ancName ? ancestries.get(norm(ancName)) ?? null : null;
  const backgroundId = bgName ? backgrounds.get(norm(bgName)) ?? null : null;
  const classId = clsName ? classes.get(norm(clsName)) ?? null : null;

  if (ancName) (ancestryId ? resolved : warnings).push(`Ancestry: ${ancName}${ancestryId ? '' : ' (not found — left unset)'}`);
  if (bgName) (backgroundId ? resolved : warnings).push(`Background: ${bgName}${backgroundId ? '' : ' (not found — left unset)'}`);
  if (clsName) (classId ? resolved : warnings).push(`Class: ${clsName}${classId ? '' : ' (not found — left unset)'}`);

  // Variant rules + shared options round-trip both ways. Dual Class also carries a second class.
  const importedVariants = variantsFromWg(c.variants);
  const importedOptions = optionsFromWg(c.options);
  const cls2Name: string | undefined = c.details?.class_2?.name;
  const classId2 = importedVariants.dualClass && cls2Name ? classes.get(norm(cls2Name)) ?? null : null;
  if (Object.keys(importedVariants).length) resolved.push(`Variant rules: ${Object.keys(importedVariants).join(', ')}.`);
  if (importedVariants.dualClass && cls2Name) (classId2 ? resolved : warnings).push(`Second class: ${cls2Name}${classId2 ? '' : ' (not found — pick it in the builder)'}`);

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
  // Names we've accounted for (subclass, extraChoice options, tactics, class features) so the
  // "dropped feats" warning doesn't cry wolf over things that ARE imported or auto-granted.
  const accountedFor = new Set<string>();
  const cls2 = classId2 ? content.classes[classId2] : undefined;
  // Auto-granted class features (Flurry of Blows, Hunt Prey, Confident Finisher, …) aren't player
  // feats — the class build provides them; don't warn that they were "dropped".
  for (const f of [...(cls?.features ?? []), ...(cls2?.features ?? [])]) {
    const fn = content.classFeatures[f.featureId]?.name;
    if (fn) accountedFor.add(norm(fn));
  }

  // Subclass: match a feature name to one of this class's subclass options (loose: WG suffixes them).
  let subclassId: string | null = null;
  if (cls?.subclass) {
    let subHit: string | undefined;
    const opt = cls.subclass.options.find((o) => {
      const fn = featureNorms.find((x) => looseMatch(x, norm(o.name)));
      if (fn) { subHit = fn; return true; }
      return false;
    });
    if (opt) {
      subclassId = opt.id;
      accountedFor.add(norm(opt.name));
      if (subHit) accountedFor.add(subHit);
      resolved.push(`${cls.subclass.name}: ${opt.name}`);
    }
  }

  // Heritage: match a feature/trait name to a heritage of the chosen ancestry.
  let heritageId: string | null = null;
  if (ancestryId) {
    const heritageOpts = Object.values(content.heritages).filter((h) => h.ancestryId === ancestryId || h.ancestryId === null);
    const h = heritageOpts.find((opt) => featureNorms.some((fn) => looseMatch(fn, norm(opt.name))));
    if (h) {
      heritageId = h.id;
      accountedFor.add(norm(h.name));
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
      if (deityId) {
        accountedFor.add(norm(cand));
        resolved.push(`Deity: ${content.deities[deityId].name}`);
      }
    } else if (classChoosesDeity(cls?.features)) {
      warnings.push('Deity could not be detected — pick one in the builder.');
    }
  }

  // extraChoices (Kineticist elements, Animist apparitions, Exemplar ikons, Psychic minds, …): WG
  // lists these among feats_features but Codex models them as per-class multi-picks, so match each
  // group's options to the WG feature names (containment-loose: "Kinetic Element (Wood)" → "Wood").
  const matchedExtra: Record<string, string[]> = {};
  for (const g of [...(cls?.extraChoices ?? []), ...(cls2?.extraChoices ?? [])]) {
    const ids: string[] = [];
    for (const o of g.options) {
      const feat = features.find((f) => extraChoiceMatch(f.name, o.name));
      if (feat) {
        if (!ids.includes(o.id)) ids.push(o.id);
        accountedFor.add(norm(feat.name));
      }
    }
    if (ids.length) matchedExtra[g.id] = ids;
  }
  for (const [, ids] of Object.entries(matchedExtra)) {
    const grp = [...(cls?.extraChoices ?? []), ...(cls2?.extraChoices ?? [])].find((g) => g.options.some((o) => ids.includes(o.id)));
    if (grp) resolved.push(`${grp.name}: ${ids.map((id) => grp.options.find((o) => o.id === id)?.name).filter(Boolean).join(', ')}`);
  }

  // Commander tactics live in content.actions ([tactic] trait); match WG feature names. Always
  // account for them (so they aren't mis-reported as "missing feats"), but only feed the folio for
  // an actual Commander — that's the only class whose build consumes build.commanderTactics.
  const tacIdx = new Map<string, string>();
  for (const a of Object.values(content.actions)) if (a.traits?.includes('tactic')) tacIdx.set(norm(a.name), a.id);
  const tacticIds = [...new Set(features.map((f) => tacIdx.get(norm(f.name))).filter((x): x is string => !!x))];
  for (const f of features) if (tacIdx.has(norm(f.name))) accountedFor.add(norm(f.name));
  const matchedTactics: string[] = cls?.id === 'commander' || cls2?.id === 'commander' ? tacticIds : [];
  if (matchedTactics.length) resolved.push(`${matchedTactics.length} commander tactic${matchedTactics.length === 1 ? '' : 's'} matched.`);

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

  // Deep Background variant: WG stores the player-authored background under details.info; the app
  // models the same thing as a custom background (backgroundId = CUSTOM_BACKGROUND_ID).
  const wgDeep = c.details?.info?.deep_background;
  const wantsDeepBg = !!(c.variants?.deep_background && wgDeep && typeof wgDeep === 'object');
  const customBackground = wantsDeepBg
    ? {
        name: String(wgDeep.name || 'Custom background'),
        description: typeof wgDeep.description === 'string' ? wgDeep.description : '',
        boosts: [abilityFromWg(wgDeep.boost1), abilityFromWg(wgDeep.boost2)] as [AbilityId | null, AbilityId | null],
        trainedSkill: skillFromWg(wgDeep.prereq_skill),
        loreSubject: String(wgDeep.lore_name ?? ''),
        skillFeatId: null, // WG stores its own integer feat id — unmappable; re-pick in the builder
      }
    : undefined;
  if (wantsDeepBg) {
    resolved.push(`Custom (deep) background: ${customBackground!.name}`);
    warnings.push('Deep-background skill feat could not be carried over — re-pick it in the builder.');
  }

  // Baseline character from identity alone, then layer the WG specifics onto it.
  const baseBuild: BuildState = {
    ...emptyBuild(),
    name: c.name ?? 'Imported character',
    level: clampLevel(c.level),
    ancestryId,
    heritageId,
    backgroundId: wantsDeepBg ? CUSTOM_BACKGROUND_ID : backgroundId,
    ...(customBackground ? { customBackground } : {}),
    classId,
    classId2,
    subclassId,
    deityId,
    keyAbility,
    ...(Object.keys(importedVariants).length ? { variantRules: importedVariants } : {}),
    ...(Object.keys(importedOptions).length ? { options: importedOptions } : {}),
  };
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
    const id = matchFeat(f.name);
    if (!id) continue; // not necessarily a feat (could be a class feature label) — skip silently
    const ft = content.feats[id];
    if (matchedFeats.some((m) => m.featId === id)) continue; // de-dupe (parenthetical variants)
    matchedFeats.push({ featId: id, level: ft.level || f.level || 1, category: ft.category });
  }
  if (matchedFeats.length) {
    ch = { ...ch, feats: matchedFeats };
    resolved.push(`${matchedFeats.length} feat${matchedFeats.length === 1 ? '' : 's'} matched.`);
  }
  // Warn about the player's CHOSEN feats that our content lacks, so they know exactly what to re-add.
  // WG groups feats by source; only the four selectable groups are player choices (the rest are
  // auto-granted class/ancestry features, which our class build already provides).
  const ffSrc = snap.feats_features;
  if (ffSrc && !Array.isArray(ffSrc) && typeof ffSrc === 'object') {
    const chosenNames: string[] = ['generalAndSkillFeats', 'classFeats', 'ancestryFeats', 'otherFeats']
      .flatMap((k) => (Array.isArray(ffSrc[k]) ? ffSrc[k].map((f: any) => f?.name) : []))
      .filter((n: any): n is string => typeof n === 'string');
    // A chosen name is genuinely dropped only if we didn't match it as a feat AND it wasn't accounted
    // for as a subclass / extraChoice option / tactic / auto-granted class feature.
    const dropped = [...new Set(chosenNames.filter((nm) => !matchFeat(nm) && !accountedFor.has(norm(nm))))];
    if (dropped.length) warnings.push(`Feats not in Heroes Heaven content — re-add in the builder: ${dropped.join(', ')}`);
  } else {
    for (const f of features) if (!matchFeat(f.name) && !accountedFor.has(norm(f.name)) && /feat|dedication|prowess/i.test(f.name)) unmatchedFeats.push(f.name);
    if (unmatchedFeats.length) warnings.push(`Feats not in Heroes Heaven content (dropped): ${unmatchedFeats.slice(0, 12).join(', ')}${unmatchedFeats.length > 12 ? '…' : ''}`);
  }

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

  // Layer in the matched per-class multi-picks the reverse-derive can't see: extraChoices
  // (Kineticist elements, Animist apparitions, …), the Commander folio, and the deep background.
  if (Object.keys(matchedExtra).length) build.extraChoices = { ...build.extraChoices, ...matchedExtra };
  if (matchedTactics.length) build.commanderTactics = matchedTactics;
  if (wantsDeepBg) {
    build.backgroundId = CUSTOM_BACKGROUND_ID;
    build.customBackground = customBackground;
  }

  // Enabled source books: WG stores enabled integer source ids; its `content.all_sources` block
  // carries the id → name rows. Match those names to our book catalog so non-Core books the
  // character uses stay visible in the builder pickers.
  {
    const wgEnabled: number[] = Array.isArray(c.content_sources?.enabled) ? c.content_sources.enabled : [];
    const wgSourceRows: any[] = Array.isArray(snap.all_sources) ? snap.all_sources : [];
    if (wgEnabled.length && wgSourceRows.length) {
      const { allBooks, homebrew } = sourceCatalog(content);
      const bookIdx = new Map<string, string>();
      for (const b of [...allBooks, ...homebrew.map((h) => h.name)]) {
        bookIdx.set(norm(b), b);
        bookIdx.set(norm(b.replace(/^Pathfinder /, '')), b);
      }
      const matched = new Set<string>();
      for (const row of wgSourceRows) {
        if (typeof row?.id !== 'number' || !wgEnabled.includes(row.id)) continue;
        const nm = typeof row?.name === 'string' ? row.name : '';
        if (!nm) continue;
        const hit = bookIdx.get(norm(nm)) ?? bookIdx.get(norm(`Pathfinder ${nm}`));
        if (hit) matched.add(hit);
      }
      const extra = [...matched].filter((b) => !CORE_BOOKS.includes(b));
      if (extra.length) {
        build.enabledSources = [...CORE_BOOKS, ...extra];
        resolved.push(`${extra.length} non-Core source book${extra.length === 1 ? '' : 's'} enabled to match the Wanderer’s Guide character.`);
      }
    }
  }

  // Spells & cantrips by name → onto the build, then rebuild.
  const spellWarn: string[] = [];
  const cantrips = collectSpells(snap, 'cantrips', spellsIdx, spellWarn);
  if (cantrips.length) build.cantrips = cantrips;
  const byRank = collectLeveledSpells(snap, spellsIdx, spellWarn);
  if (Object.keys(byRank).length) build.spells = byRank;
  const spellCount = cantrips.length + Object.values(byRank).reduce((n, a) => n + a.length, 0);
  if (spellCount) resolved.push(`${spellCount} spell${spellCount === 1 ? '' : 's'} matched.`);

  // Signature spells: flagged per-row in WG's id-keyed character.spells.list; resolve the id via
  // the compiled dump's spell rows, then by name to our content. One per rank (the app's model).
  const idNames = wgSpellIdNames(snap);
  {
    const list: any[] = Array.isArray(c.spells?.list) ? c.spells.list : [];
    const signatures: Record<number, string> = {};
    for (const row of list) {
      if (!row?.signature) continue;
      const nm = idNames.get(Number(row.spell_id));
      const id = nm ? spellsIdx.get(norm(nm)) : undefined;
      if (!id) continue;
      const rank = Number(row.rank) || content.spells[id]?.rank || 1;
      if (!signatures[rank]) signatures[rank] = id;
    }
    if (Object.keys(signatures).length) {
      build.signatures = { ...build.signatures, ...signatures };
      resolved.push(`${Object.keys(signatures).length} signature spell${Object.keys(signatures).length === 1 ? '' : 's'} marked.`);
    }
  }

  // Rituals: the app stores a character's rituals as override-added spells (they render in the
  // Spells page's Rituals section).
  {
    const rows: any[] = Array.isArray(snap.spells?.rituals) ? snap.spells.rituals : [];
    const adds: { spellId: string; rank: number }[] = [];
    for (const s of rows) {
      const nm = typeof s?.name === 'string' ? s.name : undefined;
      if (!nm) continue;
      const id = spellsIdx.get(norm(nm));
      if (id) adds.push({ spellId: id, rank: Number(s?.rank) || content.spells[id]?.rank || 1 });
      else spellWarn.push(nm);
    }
    if (adds.length) {
      build.overrides = { ...build.overrides, addedSpells: [...(build.overrides?.addedSpells ?? []), ...adds] };
      resolved.push(`${adds.length} ritual${adds.length === 1 ? '' : 's'} imported.`);
    }
  }
  if (spellWarn.length) warnings.push(`Spells not in Heroes Heaven content (dropped): ${spellWarn.slice(0, 12).join(', ')}${spellWarn.length > 12 ? '…' : ''}`);

  // Inventory by name (WG embeds the item name on each row).
  const customItems: Item[] = [];
  // WG nests stowed items under each container's `container_contents`; flatten the tree so items inside
  // a backpack/bag aren't dropped (the container itself is also a row and imports normally — the only
  // thing lost is the nesting, which Codex re-derives from carry flags anyway).
  const flattenWgItems = (rows: any[]): any[] => {
    const out: any[] = [];
    for (const row of rows ?? []) {
      if (!row) continue;
      out.push(row);
      if (Array.isArray(row.container_contents) && row.container_contents.length) out.push(...flattenWgItems(row.container_contents));
    }
    return out;
  };
  const wgItems: any[] = flattenWgItems(Array.isArray(c.inventory?.items) ? c.inventory.items : []);
  const builtInv: BuildState['inventory'] = [];
  const naturals: NaturalAttack[] = [];
  let formulaCount = 0;
  let battlezooItems = 0;
  // Per-instance state WG stores on the item row: limited-use charges and the spell a generic
  // scroll/wand holds.
  const wgItemExtras = (row: any): { charges?: { current: number; max: number }; heldSpell?: string } => {
    const out: { charges?: { current: number; max: number }; heldSpell?: string } = {};
    const chg = row?.item?.meta_data?.charges;
    const max = Number(chg?.max);
    if (Number.isFinite(max) && max > 0) {
      const cur = Number(chg?.current);
      out.charges = { current: clamp(Number.isFinite(cur) ? cur : max, 0, max), max };
    }
    const sw = row?.item?.meta_data?.scroll_wand;
    if (sw && typeof sw.spell_name === 'string') {
      const id = spellsIdx.get(norm(sw.spell_name));
      if (id) out.heldSpell = id;
    }
    return out;
  };
  for (const row of wgItems) {
    const nm: string | undefined = row?.item?.name;
    if (!nm) continue;
    // Crafting formulas are a known-recipes list, not carried gear — the app has no formula book.
    if (row?.is_formula) {
      formulaCount++;
      continue;
    }
    if (row?.item?.meta_data?.battlezoo?.enabled) battlezooItems++;
    // Match by name; if a descriptor variant like "Rope (50 ft.)" / "Rations (1 week)" misses, retry
    // without the trailing parenthetical — but NOT for tier parentheticals (a missing "Healing Potion
    // (Greater)" must not silently become a base "Healing Potion").
    const stripVariant = (s: string) =>
      /\((greater|major|moderate|lesser|minor|true|grandmaster|(?:high|standard|low)-grade)\)/i.test(s)
        ? s
        : s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    const id = itemsIdx.get(norm(nm)) ?? itemsIdx.get(norm(stripVariant(nm)));
    // WG models natural unarmed attacks (Iruxi Fangs, claws, …) as inventory "weapons" with
    // category 'unarmed_attack'. Our baseline Fist is built-in; a MATCHED row (Handwraps of Mighty
    // Blows) imports as a normal item below; an UNMATCHED unarmed attack becomes a naturalAttacks
    // Strike so it shows in Strikes (and is buffed by handwraps runes).
    if (row?.item?.meta_data?.category === 'unarmed_attack' && !id) {
      const dmg = row?.item?.meta_data?.damage;
      if (norm(nm) !== 'fist' && dmg?.die) {
        naturals.push({ name: nm, die: String(dmg.die), damageType: String(dmg.damageType || 'bludgeoning'), traits: ['unarmed'], group: 'brawling' });
      }
      continue;
    }
    if (!id) {
      // Not in our content — synthesize a custom (homebrew) item from the import so it isn't dropped.
      const custom = synthImportedItem(row.item);
      customItems.push(custom);
      const cqty = Number(row?.item?.meta_data?.quantity) || 1;
      builtInv.push({ itemId: custom.id, quantity: cqty, equipped: !!row.is_equipped, invested: !!row.is_invested, ...wgItemExtras(row) });
      continue;
    }
    const qty = Number(row?.item?.meta_data?.quantity) || 1;
    const appItem = content.items[id];
    const runes = mapWgRunes(row?.item?.meta_data?.runes, appItem?.itemType ?? '', runesIdx);
    // WG has a single is_equipped flag; the app distinguishes WORN (armor + worn magic items — what
    // AC/resilient-rune math reads) from EQUIPPED (held/wielded). Without this split an imported
    // breastplate would sit "held" in the pack and grant no AC.
    // Foundry usage strings are "worn", "worncloak", "wornshoes", … — prefix match, not word match.
    const wearable = appItem?.itemType === 'armor' || /^worn/i.test(String(appItem?.usage ?? '').trim());
    const carried = !!(row.is_equipped || row.is_invested);
    builtInv.push({
      itemId: id,
      quantity: qty,
      ...(wearable ? { worn: carried } : { equipped: !!row.is_equipped }),
      invested: !!row.is_invested,
      ...(runes ? { runes } : {}),
      ...wgItemExtras(row),
    });
  }
  if (formulaCount) warnings.push(`${formulaCount} crafting formula${formulaCount === 1 ? '' : 's'} skipped (the app has no formula book).`);
  if (battlezooItems)
    warnings.push(
      `${battlezooItems} item${battlezooItems === 1 ? ' uses' : 's use'} Wanderer’s Guide Monster Parts refinement — refine ${battlezooItems === 1 ? 'it' : 'them'} again from the Inventory tab (the two apps track refinement differently).`,
    );
  if (builtInv.length) {
    build.inventory = builtInv;
    resolved.push(`${builtInv.length} item${builtInv.length === 1 ? '' : 's'} matched.`);
  }
  if (naturals.length) {
    build.naturalAttacks = naturals;
    resolved.push(`${naturals.length} natural attack${naturals.length === 1 ? '' : 's'} (${naturals.map((n) => n.name).join(', ')}).`);
  }
  if (customItems.length)
    resolved.push(
      `${customItems.length} item${customItems.length === 1 ? '' : 's'} not in the app's data — imported as custom item${customItems.length === 1 ? '' : 's'}: ${customItems.slice(0, 12).map((i) => i.name).join(', ')}${customItems.length > 12 ? '…' : ''}.`,
    );

  // Final rebuild from the assembled build.
  let character: Character;
  try {
    // Resolve the build against content augmented with the synthesized custom items, so imported
    // unrecognized items resolve in the character's inventory (App persists them as homebrew after).
    const contentForBuild = customItems.length
      ? { ...content, items: { ...content.items, ...Object.fromEntries(customItems.map((i) => [i.id, i])) } }
      : content;
    character = buildCharacter(build, contentForBuild);
  } catch {
    character = ch;
    warnings.push('Final rebuild failed; kept the partially-assembled character.');
  }

  // --- Focus & innate spells WG resolved. The build only grants focus/innate spells whose granting
  //     feat or subclass we matched; WG lists the FINAL resolved set, so add any it has that aren't
  //     already on the sheet — otherwise a Cleric's domain spell, a Monk's ki spell, a Sorcerer's
  //     innate bloodline spell, etc. silently vanish. ---
  const spellIdsOnSheet = new Set<string>(
    character.spellcasting.flatMap((e) => [
      ...(e.cantrips ?? []),
      ...Object.values(e.repertoire ?? {}).flat(),
      ...Object.values(e.grantedRepertoire ?? {}).flat(),
      ...Object.values(e.prepared ?? {}).flatMap((slots) => slots.map((s) => s.spellId).filter((x): x is string => !!x)),
      ...Object.values(e.spellbook ?? {}).flat(),
    ]),
  );
  const firstCaster = character.spellcasting.find((e) => e.type === 'spontaneous' || e.type === 'prepared');

  const wgFocus: string[] = (Array.isArray(snap.focus_spells) ? snap.focus_spells : [])
    .map((s: any): string | undefined => (typeof s?.name === 'string' ? spellsIdx.get(norm(s.name)) : undefined))
    .filter((id: string | undefined): id is string => !!id && !spellIdsOnSheet.has(id));
  if (wgFocus.length) {
    let entry = character.spellcasting.find((e) => e.type === 'focus');
    if (!entry) {
      entry = {
        id: 'wg-focus',
        name: 'Focus spells',
        type: 'focus',
        tradition: firstCaster?.tradition ?? (content.spells[wgFocus[0]]?.traditions?.[0] as Tradition) ?? 'occult',
        keyAbility: firstCaster?.keyAbility ?? cls?.keyAbility?.[0] ?? 'cha',
        proficiency: firstCaster?.proficiency ?? 'trained',
        cantrips: [],
        repertoire: {},
      };
      character.spellcasting.push(entry);
    }
    const rep = (entry.repertoire ??= {});
    for (const id of wgFocus) {
      const r = content.spells[id]?.rank || 1;
      (rep[r] ??= []).push(id);
      spellIdsOnSheet.add(id);
    }
    const poolMax = Math.min(3, Math.max(character.focus?.max ?? 0, 1));
    character.focus = { max: poolMax, current: character.focus?.current ?? poolMax };
    resolved.push(`${wgFocus.length} focus spell${wgFocus.length === 1 ? '' : 's'} imported.`);
  }

  const wgInnate = (Array.isArray(snap.innate_spells) ? snap.innate_spells : [])
    .map((s: any) => {
      const nm = s?.spell?.name ?? s?.name;
      const id = typeof nm === 'string' ? spellsIdx.get(norm(nm)) : undefined;
      return id ? { id, tradition: typeof s?.tradition === 'string' ? s.tradition.toLowerCase() : undefined } : undefined;
    })
    .filter((x: any): x is { id: string; tradition?: string } => !!x && !spellIdsOnSheet.has(x.id));
  if (wgInnate.length) {
    let entry = character.spellcasting.find((e) => e.type === 'innate');
    if (!entry) {
      entry = {
        id: 'wg-innate',
        name: 'Innate spells',
        type: 'innate',
        tradition: (wgInnate[0].tradition as Tradition) ?? (content.spells[wgInnate[0].id]?.traditions?.[0] as Tradition) ?? firstCaster?.tradition ?? 'arcane',
        keyAbility: firstCaster?.keyAbility ?? 'cha',
        proficiency: firstCaster?.proficiency ?? 'trained',
        cantrips: [],
        repertoire: {},
      };
      character.spellcasting.push(entry);
    }
    const rep = (entry.repertoire ??= {});
    for (const { id } of wgInnate) {
      const r = content.spells[id]?.rank ?? 0;
      if (r <= 0) entry.cantrips.push(id);
      else (rep[r] ??= []).push(id);
      spellIdsOnSheet.add(id);
    }
    resolved.push(`${wgInnate.length} innate spell${wgInnate.length === 1 ? '' : 's'} imported.`);
  }

  // --- Today's casting state: which prepared slots hold which spell (and which are cast), how many
  //     spontaneous slots are spent, focus points, and innate casts already used. WG's `spell_slots`
  //     dump carries the resolved spell row per slot, so this maps by name like everything else. ---
  {
    const slotRows: any[] = Array.isArray(snap.spell_slots) ? snap.spell_slots : [];
    const prepEntry = character.spellcasting.find((e) => e.type === 'prepared');
    const spontEntry = character.spellcasting.find((e) => e.type === 'spontaneous');
    if (slotRows.length && prepEntry?.prepared) {
      const byRankRows = new Map<number, any[]>();
      for (const r of slotRows) {
        const rk = Number(r?.rank);
        if (!Number.isFinite(rk)) continue;
        if (!byRankRows.has(rk)) byRankRows.set(rk, []);
        byRankRows.get(rk)!.push(r);
      }
      let prepCount = 0;
      for (const [rk, rows] of byRankRows) {
        const slots = prepEntry.prepared[rk];
        if (!slots) continue;
        rows.forEach((row, i) => {
          if (i >= slots.length) return;
          const nm: unknown = row?.spell?.name ?? (row?.spell_id != null ? idNames.get(Number(row.spell_id)) : undefined);
          const id = typeof nm === 'string' ? spellsIdx.get(norm(nm)) : undefined;
          if (id) {
            slots[i] = { spellId: id, expended: !!row?.exhausted };
            prepCount++;
          } else if (row?.exhausted && slots[i]) {
            slots[i] = { ...slots[i], expended: true };
          }
        });
      }
      if (prepCount) resolved.push(`${prepCount} prepared spell slot${prepCount === 1 ? '' : 's'} filled.`);
    }
    if (slotRows.length && spontEntry?.slots) {
      for (const [rkStr, pool] of Object.entries(spontEntry.slots)) {
        const used = slotRows.filter((r) => Number(r?.rank) === Number(rkStr) && r?.exhausted).length;
        if (used) pool.used = Math.min(pool.max, used);
      }
    }
    const fpc = c.spells?.focus_point_current;
    if (typeof fpc === 'number' && character.focus) {
      character.focus = { ...character.focus, current: clamp(fpc, 0, character.focus.max) };
    }
    // Innate casts already spent today (casts_current > 0 in WG = used casts).
    for (const row of Array.isArray(snap.innate_spells) ? snap.innate_spells : []) {
      if (!(Number(row?.casts_current) > 0)) continue;
      const nm = row?.spell?.name ?? row?.name;
      const id = typeof nm === 'string' ? spellsIdx.get(norm(nm)) : undefined;
      if (!id) continue;
      for (const e of character.spellcasting) {
        if (e.type !== 'innate') continue;
        const has = (e.cantrips ?? []).includes(id) || Object.values(e.repertoire ?? {}).some((a) => a.includes(id));
        if (has) e.innateUsed = [...new Set([...(e.innateUsed ?? []), id])];
      }
    }
  }

  // Active conditions (Frightened 2, Prone, …) live on WG's details.conditions.
  {
    const rows: any[] = Array.isArray(c.details?.conditions) ? c.details.conditions : [];
    if (rows.length) {
      const condIdx = nameIndex(content.conditions);
      const active: ActiveCondition[] = [];
      const missing: string[] = [];
      for (const cond of rows) {
        const nm = typeof cond?.name === 'string' ? cond.name : '';
        if (!nm) continue;
        const id = condIdx.get(norm(nm));
        if (!id) {
          missing.push(nm);
          continue;
        }
        const v = Number(cond?.value);
        if (!active.some((a) => a.id === id)) active.push({ id, ...(Number.isFinite(v) && v > 0 ? { value: v } : {}) });
      }
      if (active.length) {
        character.conditions = active;
        resolved.push(`${active.length} active condition${active.length === 1 ? '' : 's'} imported.`);
      }
      if (missing.length) warnings.push(`Conditions not recognized (dropped): ${missing.join(', ')}`);
    }
  }

  // Patch in coins, vitals, bio, and portrait the build doesn't carry.
  const coins = c.inventory?.coins;
  if (coins) character.currency = { pp: coins.pp ?? 0, gp: coins.gp ?? 0, sp: coins.sp ?? 0, cp: coins.cp ?? 0 };
  character.xp = c.experience ?? 0;
  character.heroPoints = clamp(c.hero_points ?? 1, 0, 3);
  if (build.enabledSources) character.enabledSources = build.enabledSources;
  const bankedParts = Number(c.inventory?.monster_parts?.value);
  if (Number.isFinite(bankedParts) && bankedParts > 0) {
    character.monsterParts = bankedParts;
    resolved.push(`${bankedParts} gp of banked monster parts imported.`);
  }
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

  // --- Patch the authoritative resolved data WG already computed straight onto the sheet. The
  //     reverse-derived build only reflects class/background grants, so the player's chosen skill
  //     trainings, skill increases (expert/master), save ranks, languages, and notes would otherwise
  //     be lost. (The build stays approximate — editing in the builder re-derives proficiencies.) ---
  if (snap.proficiencies && typeof snap.proficiencies === 'object') {
    const wgRank = (key: string): ProficiencyRank | undefined => {
      const e = snap.proficiencies[key];
      const pv = e && typeof e === 'object' && e.parts ? e.parts.profValue : undefined;
      return typeof pv === 'number' ? WG_PROF_RANK[pv] : undefined;
    };
    const bump = (cur: ProficiencyRank, key: string): ProficiencyRank => {
      const r = wgRank(key);
      return r && RANK_ORDER.indexOf(r) > RANK_ORDER.indexOf(cur) ? r : cur;
    };
    const skills = character.proficiencies.skills as Record<string, ProficiencyRank>;
    let bumped = 0;
    for (const sk of SKILLS) {
      const before = skills[sk] ?? 'untrained';
      const after = bump(before, `SKILL_${sk.toUpperCase()}`);
      if (after !== before) {
        skills[sk] = after;
        bumped++;
      }
    }
    // Lore skills: WG names them SKILL_LORE___<SUBJECT>; the app keys them `lore:<subject>`.
    let lores = 0;
    for (const key of Object.keys(snap.proficiencies)) {
      const lk = loreKeyFromWgVar(key);
      if (!lk) continue;
      const r = wgRank(key);
      if (!r || r === 'untrained') continue;
      const before = skills[lk] ?? 'untrained';
      if (RANK_ORDER.indexOf(r) > RANK_ORDER.indexOf(before)) {
        skills[lk] = r;
        lores++;
      }
    }
    if (lores) resolved.push(`${lores} Lore skill${lores === 1 ? '' : 's'} imported.`);
    character.proficiencies.saves.fortitude = bump(character.proficiencies.saves.fortitude, 'SAVE_FORT');
    character.proficiencies.saves.reflex = bump(character.proficiencies.saves.reflex, 'SAVE_REFLEX');
    character.proficiencies.saves.will = bump(character.proficiencies.saves.will, 'SAVE_WILL');
    character.proficiencies.perception = bump(character.proficiencies.perception, 'PERCEPTION');
    character.proficiencies.classDc = bump(character.proficiencies.classDc, 'CLASS_DC');
    // Weapon + armor category proficiencies (an archetype's martial training, etc.).
    for (const [wgKey, cat] of Object.entries(WG_WEAPON_CATS)) {
      character.proficiencies.attacks[cat] = bump(character.proficiencies.attacks[cat], wgKey);
    }
    for (const [wgKey, cat] of Object.entries(WG_ARMOR_CATS)) {
      character.proficiencies.defenses[cat] = bump(character.proficiencies.defenses[cat], wgKey);
    }
    // Spellcasting proficiency: WG tracks one SPELL_ATTACK/SPELL_DC pair; raise any lower entry.
    const spellRank = wgRank('SPELL_ATTACK') ?? wgRank('SPELL_DC');
    if (spellRank && spellRank !== 'untrained') {
      for (const e of character.spellcasting) {
        if (RANK_ORDER.indexOf(spellRank) > RANK_ORDER.indexOf(e.proficiency)) e.proficiency = spellRank;
      }
    }
    if (bumped) resolved.push(`Skill & save proficiencies set from Wanderer’s Guide.`);
  }

  // Languages: WG's content.languages is an array of language code/name strings (e.g. "IRUXI").
  const langIdx = nameIndex(content.languages);
  const langIds: string[] = [];
  for (const l of Array.isArray(snap.languages) ? snap.languages : []) {
    const id = langIdx.get(norm(String(l)));
    if (id && !langIds.includes(id)) langIds.push(id);
  }
  if (langIds.length) {
    character.languages = langIds;
    resolved.push(`${langIds.length} language${langIds.length === 1 ? '' : 's'} imported.`);
  }

  // Notes: WG stores free-form pages under character.notes.pages; each page's `contents` is a TipTap doc.
  const wgPages: any[] = Array.isArray(c.notes?.pages) ? c.notes.pages : [];
  if (wgPages.length) {
    character.notes = wgPages.map((p: any, i: number): NotePage => ({
      id: `wg-note-${newRosterId()}`,
      title: typeof p?.name === 'string' && p.name ? p.name : `Page ${i + 1}`,
      icon: typeof p?.icon === 'string' && p.icon ? (p.icon.startsWith('ti-') ? p.icon : `ti-${p.icon}`) : undefined,
      color: typeof p?.color === 'string' ? p.color : undefined,
      content: typeof p?.contents === 'string' ? p.contents : tiptapToHtml(p?.contents),
    }));
    resolved.push(`${wgPages.length} note page${wgPages.length === 1 ? '' : 's'} imported.`);
  }

  // Bio fields the app has no Details slot for (beliefs, faction, reputation, organized play) —
  // preserved on a note page instead of being dropped.
  {
    const bits: string[] = [];
    const addBit = (label: string, v: unknown) => {
      if (v == null || v === '') return;
      bits.push(`<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(v))}</p>`);
    };
    addBit('Beliefs', info.beliefs);
    addBit('Faction', info.faction);
    addBit('Reputation', info.reputation);
    addBit('Organized Play ID', info.organized_play_id);
    if (bits.length) {
      character.notes = [
        ...character.notes,
        {
          id: `wg-note-${newRosterId()}`,
          title: 'Imported from Wanderer’s Guide',
          icon: 'ti-file-import',
          content: bits.join(''),
        },
      ];
      resolved.push('Extra bio fields (beliefs/faction/…) saved to a note page.');
    }
  }

  // Companions: WG stores full creature stat blocks; match them by name to the app's companion
  // catalogs (animal companions, pets, followers). Unmatched ones are reported, not silently lost.
  {
    const rows: any[] = Array.isArray(c.companions?.list) ? c.companions.list : [];
    if (rows.length) {
      const animalIdx = nameIndex(content.animalCompanions);
      const petIdx = nameIndex(content.pets ?? {});
      const followerIdx = nameIndex(content.followers ?? {});
      const comps: CompanionConfig[] = [];
      const missing: string[] = [];
      rows.forEach((row, i) => {
        const nm = typeof row?.name === 'string' ? row.name.trim() : '';
        if (!nm) return;
        const key = norm(nm);
        const animal = animalIdx.get(key);
        const pet = petIdx.get(key);
        const follower = followerIdx.get(key);
        if (animal) comps.push({ id: `wg-comp-${i}-${newRosterId()}`, kind: 'animal', name: nm, typeId: animal, maturity: 'young' });
        else if (pet) comps.push({ id: `wg-comp-${i}-${newRosterId()}`, kind: 'pet', name: nm, typeId: pet });
        else if (follower) comps.push({ id: `wg-comp-${i}-${newRosterId()}`, kind: 'follower', name: nm, typeId: follower });
        else missing.push(nm);
      });
      if (comps.length) {
        character.companions = [...(character.companions ?? []), ...comps];
        build.companions = [...(build.companions ?? []), ...comps];
        resolved.push(`${comps.length} companion${comps.length === 1 ? '' : 's'} matched (${comps.map((x) => x.name).join(', ')}).`);
      }
      if (missing.length)
        warnings.push(`Companions not in the app's companion catalog (dropped): ${missing.join(', ')}. Re-add them from the Companions tab.`);
    }
  }

  // Favorites (starred descriptions) → the app's pinned descriptions, resolved by name.
  {
    const rows: any[] = Array.isArray(c.meta_data?.favorites) ? c.meta_data.favorites : [];
    if (rows.length) {
      const favSources: { key: string; idx: Map<string, string>; map: Record<string, { name: string; description?: string; descRefs?: any }> }[] = [
        { key: 'feats', idx: featsIdx, map: content.feats },
        { key: 'spells', idx: spellsIdx, map: content.spells },
        { key: 'items', idx: itemsIdx, map: content.items },
        { key: 'actions', idx: nameIndex(content.actions), map: content.actions },
        { key: 'classFeatures', idx: nameIndex(content.classFeatures), map: content.classFeatures },
        { key: 'conditions', idx: nameIndex(content.conditions), map: content.conditions },
      ];
      const typeToKey: Record<string, string> = {
        feat: 'feats',
        spell: 'spells',
        item: 'items',
        'inv-item': 'items',
        action: 'actions',
        'class-feature': 'classFeatures',
        condition: 'conditions',
      };
      const pins: PinnedDesc[] = [];
      for (const f of rows) {
        const nm = typeof f?.name === 'string' ? f.name : '';
        if (!nm) continue;
        const prefer = typeToKey[String(f?.type ?? '')];
        const ordered = prefer ? [...favSources].sort((a, b) => (a.key === prefer ? -1 : b.key === prefer ? 1 : 0)) : favSources;
        for (const src of ordered) {
          const id = src.idx.get(norm(nm));
          const entry = id ? src.map[id] : undefined;
          if (!entry) continue;
          if (!pins.some((p) => p.title === entry.name && p.key === src.key)) {
            pins.push({ title: entry.name, description: entry.description ?? '', ...(entry.descRefs ? { descRefs: entry.descRefs } : {}), key: src.key });
          }
          break;
        }
      }
      if (pins.length) {
        character.pinnedDescs = [...(character.pinnedDescs ?? []), ...pins];
        resolved.push(`${pins.length} favorite${pins.length === 1 ? '' : 's'} pinned.`);
      }
    }
  }

  // Character-scoped custom modes → app user modes (the caller persists them, scoped to this character).
  const customModes: ModeDef[] = (Array.isArray(c.meta_data?.custom_modes) ? c.meta_data.custom_modes : [])
    .map(modeFromWg)
    .filter((m: ModeDef | null): m is ModeDef => !!m);
  if (customModes.length)
    resolved.push(`${customModes.length} custom mode${customModes.length === 1 ? '' : 's'} imported — toggle ${customModes.length === 1 ? 'it' : 'them'} from the Modes menu.`);

  // Things WG models that the app deliberately has no slot for — surfaced, never silently eaten.
  if (c.variants?.stamina || Number(c.stamina_current) > 0) warnings.push('The Stamina variant isn’t supported — stamina/resolve were skipped.');
  if (c.variants?.proficiency_half_level) warnings.push('The proficiency-half-level variant isn’t supported — ignored.');
  const clsArchName = c.details?.class_archetype?.name ?? c.details?.class_archetype_2?.name;
  if (typeof clsArchName === 'string' && clsArchName) warnings.push(`Class archetype “${clsArchName}” isn’t supported — its changes were not applied.`);
  const custOps = Array.isArray(c.custom_operations) ? c.custom_operations.length : 0;
  if (custOps) warnings.push(`${custOps} custom operation${custOps === 1 ? '' : 's'} (Wanderer’s Guide homebrew adjustments) can’t be executed — skipped.`);

  warnings.push(
    'Wanderer’s Guide build choices are matched to Heroes Heaven content by name; anything unmatched above was dropped. Review the character in the builder.',
  );

  return {
    saved: { id: newRosterId(), character, build, archived: false },
    report: { source: 'Wanderer’s Guide', lossless: false, resolved, warnings },
    customItems,
    customModes,
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
