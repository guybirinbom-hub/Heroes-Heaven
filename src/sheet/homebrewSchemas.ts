/*
 * Homebrew authoring schemas.
 *
 * Each schema declares the form fields for one content type plus two pure converters:
 * `toForm` (entry → flat form for editing) and `toEntry` (form → a valid ContentDatabase object).
 * One generic editor (HomebrewPage) renders any schema. Items are NOT here — they reuse the full
 * ItemEditorModal. Field values are strings or string[] (`multi`/`list`); structured shapes
 * (ActionCost, ability boosts, traditions, languages…) are assembled in `toEntry`.
 */
import {
  ABILITIES,
  SAVES,
  SKILLS,
  TRADITIONS,
  type AbilityBoost,
  type AbilityId,
  type ActionCost,
  type Action,
  type Ancestry,
  type Background,
  type ContentDatabase,
  type Deity,
  type EffectChoice,
  type Feat,
  type Heritage,
  type SaveId,
  type Size,
  type Spell,
  type SpellRank,
  type Tradition,
  type Vision,
} from '../rules/types';
import type { HomebrewType } from '../data/storage';
import { DOMAIN_SPELLS } from '../rules/domains';

export type FieldKind = 'text' | 'number' | 'rich' | 'select' | 'multi' | 'list';

export interface HBField {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** Layout hint — render at half width (paired on a row). */
  half?: boolean;
}

export type HBForm = Record<string, string | string[]>;

export interface HBSchema {
  type: Exclude<HomebrewType, 'items'>;
  label: string;
  icon: string;
  fields: HBField[];
  /** `content` is the live database — only the schemas that store record IDS but ask the user for
   *  NAMES (deity favored weapons / cleric spells) need it; it is optional so a converter stays a
   *  pure function in tests that don't care. */
  toForm: (entry: Record<string, unknown>, content?: ContentDatabase) => HBForm;
  toEntry: (form: HBForm, ctx: { id: string; sourceId: string; content?: ContentDatabase }) => Record<string, unknown>;
}

// --- value helpers -------------------------------------------------------------------------------
const s = (f: HBForm, k: string): string => (typeof f[k] === 'string' ? (f[k] as string).trim() : '');
const arr = (f: HBForm, k: string): string[] => (Array.isArray(f[k]) ? (f[k] as string[]).filter(Boolean) : []);
const n = (f: HBForm, k: string, dflt = 0): number => {
  const v = parseInt(s(f, k), 10);
  return Number.isFinite(v) ? v : dflt;
};

const ACTION_OPTIONS = [
  { value: '', label: '— none —' },
  { value: '1', label: '1 action' },
  { value: '2', label: '2 actions' },
  { value: '3', label: '3 actions' },
  { value: 'reaction', label: 'reaction' },
  { value: 'free', label: 'free action' },
] as const;

const toActionCost = (v: string): ActionCost | undefined => {
  if (v === '1' || v === '2' || v === '3') return { type: 'actions', value: Number(v) as 1 | 2 | 3 };
  if (v === 'reaction') return { type: 'reaction' };
  if (v === 'free') return { type: 'free' };
  return undefined;
};
const fromActionCost = (c?: ActionCost): string => {
  if (!c) return '';
  if (c.type === 'actions') return String(c.value);
  if (c.type === 'reaction') return 'reaction';
  if (c.type === 'free') return 'free';
  return '';
};

const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));
const RARITY = [
  { value: 'common', label: 'common' },
  { value: 'uncommon', label: 'uncommon' },
  { value: 'rare', label: 'rare' },
  { value: 'unique', label: 'unique' },
] as const;

/** Shared fields every type carries; appended after the type-specific ones. */
const TAIL: HBField[] = [
  { key: 'rarity', label: 'Rarity', kind: 'select', options: RARITY, half: true },
  { key: 'traits', label: 'Traits', kind: 'list', placeholder: 'comma-separated, e.g. fire, magical', half: true },
  { key: 'description', label: 'Description', kind: 'rich' },
];

/** The base ContentBase fields shared by every assembled entry. */
function base(form: HBForm, ctx: { id: string; sourceId: string }) {
  return {
    id: ctx.id,
    name: s(form, 'name'),
    traits: arr(form, 'traits').map((t) => t.toLowerCase()),
    rarity: (s(form, 'rarity') || 'common') as 'common' | 'uncommon' | 'rare' | 'unique',
    description: s(form, 'description'),
    source: { license: 'homebrew' as const },
    homebrewSourceId: ctx.sourceId,
  };
}
const baseForm = (e: Record<string, unknown>): HBForm => ({
  name: (e.name as string) ?? '',
  rarity: (e.rarity as string) ?? 'common',
  traits: (e.traits as string[]) ?? [],
  description: (e.description as string) ?? '',
});

const boostsToAbilities = (bs?: AbilityBoost[]): string[] =>
  (bs ?? []).filter((b): b is { kind: 'fixed'; ability: AbilityId } => b.kind === 'fixed').map((b) => b.ability);
const abilitiesToBoosts = (ids: string[], free: number): AbilityBoost[] => [
  ...ids.map((a) => ({ kind: 'fixed' as const, ability: a as AbilityId })),
  ...Array.from({ length: Math.max(0, free) }, () => ({ kind: 'free' as const })),
];

const NAME_FIELD: HBField = { key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Entry name' };

/* ---- deity helpers ------------------------------------------------------------------------------
 * A real deity record stores IDS for its favored weapons and its three cleric spells, but nobody
 * knows an id — so the editor asks for NAMES and resolves them here. A name that matches nothing is
 * kept verbatim: every engine reader dereferences these through `content.items[id]` /
 * `content.spells[id]` (build.ts favored-weapon overrides, the deity spell-list addition), so an
 * unresolved string is simply skipped rather than breaking the build. It also round-trips back into
 * the editor unchanged, so a typo stays visible and fixable. */
function toIds(map: Record<string, { id: string; name: string }> | undefined, names: string[]): string[] {
  const byName = new Map(Object.values(map ?? {}).map((r) => [r.name.toLowerCase(), r.id]));
  return names.map((x) => byName.get(x.trim().toLowerCase()) ?? x.trim()).filter(Boolean);
}
const toNames = (map: Record<string, { name: string }> | undefined, ids: string[]): string[] =>
  ids.map((id) => map?.[id]?.name ?? id);

/** Every cleric domain the engine knows — the same table Domain Initiate offers from, so a homebrew
 *  deity can only name a domain that actually has a focus spell behind it. */
const DOMAIN_OPTIONS = Object.keys(DOMAIN_SPELLS)
  .sort()
  .map((d) => ({ value: d, label: d }));

const SANCTIFICATION_OPTIONS = [
  { value: '', label: 'None (no sanctification)' },
  { value: 'holy', label: 'Must choose holy' },
  { value: 'unholy', label: 'Must choose unholy' },
  { value: 'either', label: 'Holy or unholy' },
] as const;
const SANCT_OPT = {
  holy: { value: 'holy', label: 'Holy' },
  unholy: { value: 'unholy', label: 'Unholy' },
  none: { value: 'none', label: 'None', note: 'You take no sanctification.' },
} as const;
/** The exact `effectChoices` shape printed deities carry (measured: only two variants exist in
 *  core.json — holy|none and unholy|none), so buildCharacter's `${deityId}:sanctification` answer and
 *  the builder's EffectChoicesPicker treat a homebrew deity identically. */
function sanctificationChoices(mode: string): EffectChoice[] | undefined {
  const opts =
    mode === 'holy' ? [SANCT_OPT.holy] : mode === 'unholy' ? [SANCT_OPT.unholy] : mode === 'either' ? [SANCT_OPT.holy, SANCT_OPT.unholy] : null;
  if (!opts) return undefined;
  return [{ id: 'sanctification', prompt: 'Sanctification', options: [...opts, SANCT_OPT.none] }] as EffectChoice[];
}
function sanctificationMode(ecs: EffectChoice[] | undefined): string {
  const values = (ecs ?? []).find((e) => e.id === 'sanctification')?.options?.map((o) => o.value) ?? [];
  const holy = values.includes('holy');
  const unholy = values.includes('unholy');
  return holy && unholy ? 'either' : holy ? 'holy' : unholy ? 'unholy' : '';
}

export const HOMEBREW_SCHEMAS: HBSchema[] = [
  {
    type: 'feats',
    label: 'Feat',
    icon: 'ti-award',
    fields: [
      NAME_FIELD,
      { key: 'level', label: 'Level', kind: 'number', half: true, placeholder: '1' },
      {
        key: 'category',
        label: 'Category',
        kind: 'select',
        half: true,
        options: opts(['class', 'skill', 'general', 'ancestry', 'archetype']),
      },
      { key: 'actionCost', label: 'Actions', kind: 'select', options: ACTION_OPTIONS, half: true },
      { key: 'frequency', label: 'Frequency', kind: 'text', half: true, placeholder: 'e.g. once per day' },
      { key: 'prerequisites', label: 'Prerequisites', kind: 'list', placeholder: 'comma-separated' },
      { key: 'trigger', label: 'Trigger', kind: 'text' },
      { key: 'requirements', label: 'Requirements', kind: 'text' },
      ...TAIL,
    ],
    toForm: (e) => ({
      ...baseForm(e),
      level: String((e.level as number) ?? 1),
      category: (e.category as string) ?? 'general',
      actionCost: fromActionCost(e.actionCost as ActionCost | undefined),
      frequency: (e.frequency as string) ?? '',
      prerequisites: (e.prerequisites as string[]) ?? [],
      trigger: (e.trigger as string) ?? '',
      requirements: (e.requirements as string) ?? '',
    }),
    toEntry: (f, ctx) => {
      const feat: Partial<Feat> = {
        ...base(f, ctx),
        level: n(f, 'level', 1),
        category: (s(f, 'category') || 'general') as Feat['category'],
      };
      const ac = toActionCost(s(f, 'actionCost'));
      if (ac) feat.actionCost = ac;
      if (arr(f, 'prerequisites').length) feat.prerequisites = arr(f, 'prerequisites');
      if (s(f, 'frequency')) feat.frequency = s(f, 'frequency');
      if (s(f, 'trigger')) feat.trigger = s(f, 'trigger');
      if (s(f, 'requirements')) feat.requirements = s(f, 'requirements');
      return feat as Record<string, unknown>;
    },
  },
  {
    type: 'spells',
    label: 'Spell',
    icon: 'ti-sparkles',
    fields: [
      NAME_FIELD,
      { key: 'rank', label: 'Rank (0 = cantrip)', kind: 'number', half: true, placeholder: '1' },
      { key: 'cast', label: 'Cast', kind: 'select', options: ACTION_OPTIONS, half: true },
      { key: 'traditions', label: 'Traditions', kind: 'multi', options: opts([...TRADITIONS]) },
      { key: 'range', label: 'Range', kind: 'text', half: true, placeholder: 'e.g. 30 feet' },
      { key: 'area', label: 'Area', kind: 'text', half: true, placeholder: 'e.g. 20-foot burst' },
      { key: 'targets', label: 'Targets', kind: 'text', half: true },
      { key: 'duration', label: 'Duration', kind: 'text', half: true },
      {
        key: 'defense',
        label: 'Defense',
        kind: 'select',
        half: true,
        options: [{ value: '', label: '— none —' }, { value: 'ac', label: 'AC (spell attack)' }, ...opts([...SAVES])],
      },
      ...TAIL,
    ],
    toForm: (e) => ({
      ...baseForm(e),
      rank: String((e.rank as number) ?? 1),
      cast: fromActionCost(e.cast as ActionCost | undefined),
      traditions: (e.traditions as string[]) ?? [],
      range: (e.range as string) ?? '',
      area: (e.area as string) ?? '',
      targets: (e.targets as string) ?? '',
      duration: (e.duration as string) ?? '',
      defense: (e.defense as string) ?? '',
    }),
    toEntry: (f, ctx) => {
      const spell: Partial<Spell> = {
        ...base(f, ctx),
        rank: Math.max(0, Math.min(10, n(f, 'rank', 1))) as SpellRank,
        traditions: arr(f, 'traditions') as Tradition[],
        cast: toActionCost(s(f, 'cast')) ?? { type: 'actions', value: 2 },
      };
      if (s(f, 'range')) spell.range = s(f, 'range');
      if (s(f, 'area')) spell.area = s(f, 'area');
      if (s(f, 'targets')) spell.targets = s(f, 'targets');
      if (s(f, 'duration')) spell.duration = s(f, 'duration');
      const def = s(f, 'defense');
      if (def) spell.defense = def as SaveId | 'ac';
      return spell as Record<string, unknown>;
    },
  },
  {
    type: 'ancestries',
    label: 'Ancestry',
    icon: 'ti-users',
    fields: [
      NAME_FIELD,
      { key: 'hp', label: 'Hit Points', kind: 'number', half: true, placeholder: '8' },
      {
        key: 'size',
        label: 'Size',
        kind: 'select',
        half: true,
        options: opts(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']),
      },
      { key: 'speed', label: 'Speed (ft)', kind: 'number', half: true, placeholder: '25' },
      {
        key: 'vision',
        label: 'Vision',
        kind: 'select',
        half: true,
        options: opts(['normal', 'low-light', 'darkvision']),
      },
      { key: 'boosts', label: 'Ability boosts (fixed)', kind: 'multi', options: opts([...ABILITIES]) },
      { key: 'freeBoosts', label: 'Free boosts', kind: 'number', half: true, placeholder: '1' },
      { key: 'flaws', label: 'Ability flaws', kind: 'multi', options: opts([...ABILITIES]) },
      { key: 'languages', label: 'Granted languages', kind: 'list', placeholder: 'e.g. common, draconic' },
      { key: 'additional', label: 'Bonus languages (+ Int)', kind: 'number', half: true, placeholder: '0' },
      ...TAIL,
    ],
    toForm: (e) => {
      const langs = e.languages as { granted?: string[]; additional?: number } | undefined;
      return {
        ...baseForm(e),
        hp: String((e.hp as number) ?? 8),
        size: (e.size as string) ?? 'medium',
        speed: String((e.speeds as { land?: number } | undefined)?.land ?? 25),
        vision: (e.vision as string) ?? 'normal',
        boosts: boostsToAbilities(e.abilityBoosts as AbilityBoost[] | undefined),
        freeBoosts: String((e.abilityBoosts as AbilityBoost[] | undefined)?.filter((b) => b.kind === 'free').length ?? 1),
        flaws: (e.abilityFlaws as string[]) ?? [],
        languages: langs?.granted ?? [],
        additional: String(langs?.additional ?? 0),
      };
    },
    toEntry: (f, ctx): Record<string, unknown> => {
      const anc: Ancestry = {
        ...(base(f, ctx) as unknown as Ancestry),
        hp: n(f, 'hp', 8),
        size: (s(f, 'size') || 'medium') as Size,
        speeds: { land: n(f, 'speed', 25) },
        abilityBoosts: abilitiesToBoosts(arr(f, 'boosts'), n(f, 'freeBoosts', 0)),
        abilityFlaws: arr(f, 'flaws') as AbilityId[],
        vision: (s(f, 'vision') || 'normal') as Vision,
        languages: { granted: arr(f, 'languages').map((l) => l.toLowerCase()), additional: n(f, 'additional', 0) },
        heritages: [],
      };
      return anc as unknown as Record<string, unknown>;
    },
  },
  {
    type: 'heritages',
    label: 'Heritage',
    icon: 'ti-git-branch',
    fields: [
      NAME_FIELD,
      // ancestryId options are injected at runtime (existing ancestries + "versatile").
      { key: 'ancestryId', label: 'Ancestry', kind: 'select', half: true, options: [], help: 'Which ancestry this heritage belongs to.' },
      ...TAIL,
    ],
    toForm: (e) => ({
      ...baseForm(e),
      ancestryId: (e.versatile as boolean) ? '__versatile__' : ((e.ancestryId as string) ?? ''),
    }),
    toEntry: (f, ctx): Record<string, unknown> => {
      const versatile = s(f, 'ancestryId') === '__versatile__';
      const her: Heritage = {
        ...(base(f, ctx) as unknown as Heritage),
        ancestryId: versatile ? null : s(f, 'ancestryId') || null,
        versatile,
      };
      return her as unknown as Record<string, unknown>;
    },
  },
  {
    type: 'backgrounds',
    label: 'Background',
    icon: 'ti-book',
    fields: [
      NAME_FIELD,
      { key: 'boosts', label: 'Ability boosts (fixed)', kind: 'multi', options: opts([...ABILITIES]) },
      { key: 'freeBoosts', label: 'Free boosts', kind: 'number', half: true, placeholder: '1' },
      { key: 'trainedSkill', label: 'Trained skill', kind: 'select', half: true, options: [{ value: '', label: '— none —' }, ...opts([...SKILLS])] },
      { key: 'trainedLore', label: 'Lore subject', kind: 'text', half: true, placeholder: 'e.g. Sailing' },
      ...TAIL,
    ],
    toForm: (e) => ({
      ...baseForm(e),
      boosts: boostsToAbilities(e.abilityBoosts as AbilityBoost[] | undefined),
      freeBoosts: String((e.abilityBoosts as AbilityBoost[] | undefined)?.filter((b) => b.kind === 'free').length ?? 1),
      trainedSkill: (e.trainedSkill as string) ?? '',
      trainedLore: (e.trainedLore as string) ?? '',
    }),
    toEntry: (f, ctx): Record<string, unknown> => {
      const bg: Background = {
        ...(base(f, ctx) as unknown as Background),
        abilityBoosts: abilitiesToBoosts(arr(f, 'boosts'), n(f, 'freeBoosts', 1)),
      };
      if (s(f, 'trainedSkill')) bg.trainedSkill = s(f, 'trainedSkill') as Background['trainedSkill'];
      if (s(f, 'trainedLore')) bg.trainedLore = s(f, 'trainedLore');
      return bg as unknown as Record<string, unknown>;
    },
  },
  {
    type: 'actions',
    label: 'Action',
    icon: 'ti-bolt',
    fields: [
      NAME_FIELD,
      { key: 'actionCost', label: 'Actions', kind: 'select', options: ACTION_OPTIONS, half: true },
      ...TAIL,
    ],
    toForm: (e) => ({ ...baseForm(e), actionCost: fromActionCost(e.actionCost as ActionCost | undefined) }),
    toEntry: (f, ctx): Record<string, unknown> => {
      const act: Partial<Action> = { ...base(f, ctx) };
      const ac = toActionCost(s(f, 'actionCost'));
      if (ac) act.actionCost = ac;
      return act as Record<string, unknown>;
    },
  },
  {
    type: 'deities',
    label: 'Deity',
    // The same icon the builder's Deity setup card uses, so the two surfaces read as one thing.
    icon: 'ti-flare',
    fields: [
      NAME_FIELD,
      { key: 'edicts', label: 'Edicts', kind: 'list', placeholder: 'comma-separated' },
      { key: 'anathema', label: 'Anathema', kind: 'list', placeholder: 'comma-separated' },
      { key: 'divineFont', label: 'Divine font', kind: 'multi', options: opts(['heal', 'harm']) },
      {
        key: 'skill',
        label: 'Divine skill',
        kind: 'select',
        half: true,
        options: [{ value: '', label: '— none —' }, ...opts([...SKILLS])],
        help: 'A cleric of this deity is trained in it.',
      },
      { key: 'sanctification', label: 'Sanctification', kind: 'select', half: true, options: SANCTIFICATION_OPTIONS },
      {
        key: 'favoredWeapons',
        label: 'Favored weapons',
        kind: 'list',
        placeholder: 'e.g. Scimitar',
        help: 'Weapon NAMES, matched against the item list (case-insensitive). A name that matches nothing is kept as typed and simply grants no proficiency.',
      },
      { key: 'domains', label: 'Domains', kind: 'multi', options: DOMAIN_OPTIONS },
      { key: 'alternateDomains', label: 'Alternate domains', kind: 'multi', options: DOMAIN_OPTIONS },
      {
        key: 'spells',
        label: 'Cleric spells',
        kind: 'list',
        placeholder: 'e.g. Fireball',
        help: 'Spell NAMES, matched against the spell list (case-insensitive). Added to a cleric worshipper’s spell list. An unmatched name is ignored.',
      },
      ...TAIL,
    ],
    toForm: (e, content) => ({
      ...baseForm(e),
      edicts: (e.edicts as string[]) ?? [],
      anathema: (e.anathema as string[]) ?? [],
      divineFont: (e.divineFont as string[]) ?? [],
      skill: (e.skill as string) ?? '',
      sanctification: sanctificationMode(e.effectChoices as EffectChoice[] | undefined),
      favoredWeapons: toNames(content?.items, (e.favoredWeapons as string[]) ?? []),
      domains: (e.domains as string[]) ?? [],
      alternateDomains: (e.alternateDomains as string[]) ?? [],
      spells: toNames(content?.spells, (e.spells as string[]) ?? []),
    }),
    toEntry: (f, ctx): Record<string, unknown> => {
      const deity: Deity = { ...(base(f, ctx) as unknown as Deity) };
      if (arr(f, 'edicts').length) deity.edicts = arr(f, 'edicts');
      if (arr(f, 'anathema').length) deity.anathema = arr(f, 'anathema');
      if (arr(f, 'divineFont').length) deity.divineFont = arr(f, 'divineFont') as ('heal' | 'harm')[];
      if (s(f, 'skill')) deity.skill = s(f, 'skill');
      if (arr(f, 'domains').length) deity.domains = arr(f, 'domains');
      if (arr(f, 'alternateDomains').length) deity.alternateDomains = arr(f, 'alternateDomains');
      const weapons = toIds(ctx.content?.items, arr(f, 'favoredWeapons'));
      if (weapons.length) deity.favoredWeapons = weapons;
      const spells = toIds(ctx.content?.spells, arr(f, 'spells'));
      if (spells.length) deity.spells = spells;
      const ecs = sanctificationChoices(s(f, 'sanctification'));
      if (ecs) deity.effectChoices = ecs;
      return deity as unknown as Record<string, unknown>;
    },
  },
];

export const SCHEMA_BY_TYPE: Record<string, HBSchema> = Object.fromEntries(
  HOMEBREW_SCHEMAS.map((sc) => [sc.type, sc]),
);

/** A url-safe id for a new homebrew entry. */
export function homebrewId(type: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entry';
  return `hb-${type}-${slug}-${Math.abs(hashString(name + type)).toString(36).slice(0, 4)}`;
}
function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}
