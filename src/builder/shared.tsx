import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { AbilityId, Character, CharacterOptions, ChoiceGroup, ClassDef, CompanionConfig, ContentDatabase, CustomBackground, DescRef, ProficiencyKey, ProficiencyRank, SaveId, SkillId, Tradition } from '../rules/types';
import { ABILITIES, SKILLS } from '../rules/types';
import {
  type BuildState,
  CUSTOM_BACKGROUND_ID,
  additionalClassSkills,
  bonusLanguageSlots,
  type BoostSlot,
  boostSlots,
  buildCharacter,
  buildNeedsDeity,
  championDevotionOptions,
  championDevotionSpell,
  classChoosesDeity,
  commanderFolioMax,
  commanderTacticOptions,
  computeAbilities,
  GATE_THRESHOLD_LEVELS,
  innovationType,
  inventorModificationOptions,
  INVENTOR_TIER_LEVEL,
  emptyBuild,
  emptyCustomBackground,
  fixedBoosts,
  resolveBackground,
  subclassKeyAbility,
} from '../rules/build';
import { cantripsKnown } from '../rules/spellcasting';
import { abpSkillBudget } from '../rules/abp';
import { activeCasterArchetype } from '../rules/casterArchetypes';
import {
  abilityMod,
  deriveAc,
  deriveClassDc,
  deriveMaxHp,
  derivePerception,
  deriveSave,
  deriveSkill,
  deriveSpeeds,
  deriveSpellcasting,
  formatMod,
} from '../rules/derive';
import { explainStat, type StatRef } from '../rules/explain';
import { RankPill } from '../sheet/widgets';
import { StatDetailModal } from '../sheet/StatDetailModal';
import { DescBody } from '../sheet/DescBody';
import { DescriptionModal } from '../sheet/DescriptionModal';
import { PickerRow, descNodeOf } from '../sheet/FilterableSelect';
import type { DescNode } from '../sheet/descref';

/** Renders a chosen option's "what you gain" grants summary, with its flavor description tucked
 *  behind a "Details" toggle that expands it inline. Shared by every origin/class card, the picked
 *  feats/subclass/extra-choices, and the per-level feature gains. */
export function ChoiceDetails({
  flavor,
  descRefs,
  grants,
}: {
  /** Accepted for call-site convenience (the option's name); not rendered here. */
  name?: string;
  flavor?: string;
  descRefs?: DescRef[];
  grants?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasFlavor = !!flavor && flavor.trim().length > 0;
  if (!hasFlavor && !grants) return null;
  return (
    <>
      {grants}
      {hasFlavor && (
        <button type="button" className="cc-det" onClick={() => setOpen((o) => !o)}>
          <i className={'ti ' + (open ? 'ti-chevron-up' : 'ti-chevron-down')} aria-hidden="true" /> Details
        </button>
      )}
      {open && hasFlavor && (
        <div className="cc-flavor">
          <DescBody description={flavor} descRefs={descRefs} />
        </div>
      )}
    </>
  );
}

export const ABILITY_LABEL: Record<AbilityId, string> = {
  str: 'Str',
  dex: 'Dex',
  con: 'Con',
  int: 'Int',
  wis: 'Wis',
  cha: 'Cha',
};

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Starts populated so each variant shows a real in-progress hero.
export const START: BuildState = {
  ...emptyBuild(),
  name: 'New hero',
  ancestryId: 'human',
  heritageId: 'skilled-human',
  backgroundId: 'acolyte',
  classId: 'cleric',
  subclassId: 'cloistered-cleric',
  deityId: 'sarenrae',
  divineFont: 'heal',
  keyAbility: 'wis',
  ancestryBoosts: ['str', 'con'],
  backgroundBoosts: ['wis', 'int'],
  levelBoosts: ['wis', 'con', 'dex', 'cha'],
  classSkills: ['medicine', 'diplomacy', 'nature'],
  heritageSkill: 'society',
  cantrips: ['guidance', 'light', 'divine-lance', 'stabilize'],
  spells: { 1: ['heal', 'bless'] },
  inventory: [
    { itemId: 'explorers-clothing', quantity: 1, worn: true },
    { itemId: 'scimitar', quantity: 1, equipped: true },
  ],
};

export interface BuilderActions {
  patch: (p: Partial<BuildState>) => void;
  setLevel: (n: number) => void;
  bumpLevel: (delta: number) => void;
  changeAncestry: (id: string) => void;
  changeBackground: (id: string) => void;
  setCustomBackground: (patch: Partial<CustomBackground>) => void;
  changeClass: (id: string) => void;
  changeSubclass: (id: string) => void;
  /** Pick/unpick an option in an extra choice group (subconscious mind, apparitions, …). */
  toggleExtraChoice: (groupId: string, optionId: string, maxPick: number) => void;
  changeDeity: (id: string) => void;
  changeDivineFont: (font: 'heal' | 'harm') => void;
  setArchetypeTradition: (t: Tradition) => void;
  /** Two-casters: the archetype pool's own tradition / key / cantrips (kept apart from the class pool). */
  setArchetypePoolTradition: (t: Tradition) => void;
  setArchetypePoolKey: (a: AbilityId) => void;
  /** Dual Class variant: choose the second class (defaults its subclass to the first option). */
  setSecondClass: (id: string | null) => void;
  /** ABP skill potency: set a skill's item-bonus rank (0 removes it). */
  setAbpSkill: (skill: string, rank: number) => void;
  /** ABP attribute apex (L17): the attribute that gets the apex boost. */
  setAbpApex: (ability: AbilityId | null) => void;
  toggleArchetypeCantrip: (id: string, cap: number) => void;
  changeHeritage: (id: string) => void;
  /** Set the trained skill granted by a "choose a skill" heritage (e.g. Skilled human). */
  setHeritageSkill: (skill: SkillId | null) => void;
  setBoost: (group: 'ancestryBoosts' | 'backgroundBoosts' | 'levelBoosts', i: number, v: AbilityId | null) => void;
  toggleSkill: (s: ProficiencyKey) => void;
  /** Pick/unpick a bonus language. */
  toggleLanguage: (id: string) => void;
  setFeat: (slotKey: string, featId: string | null) => void;
  /** Set a feat's embedded sub-choice value (Domain Initiate domain, …). */
  setFeatChoice: (slotKey: string, value: string) => void;
  setSkillIncrease: (level: number, key: ProficiencyKey | null) => void;
  /** Monk Path to Perfection: set the chosen save for a tier (0=L7 master, 1=L11 master, 2=L15 legendary). */
  setPathToPerfection: (tier: number, save: SaveId | null) => void;
  setAttributeBoost: (level: number, idx: number, v: AbilityId | null) => void;
  toggleCantrip: (id: string) => void;
  toggleSpell: (rank: number, id: string) => void;
  /** Append a spell to a rank (prepared casters can prepare the same spell repeatedly). */
  addSpell: (rank: number, id: string) => void;
  /** Remove the spell at a specific slot index in a rank. */
  removeSpellAt: (rank: number, index: number) => void;
  /** Toggle a repertoire spell as the rank's signature spell (spontaneous, one per rank). */
  toggleSignature: (rank: number, id: string) => void;
  addItem: (itemId: string) => void;
  removeItem: (index: number) => void;
  setItemQty: (index: number, qty: number) => void;
  toggleWorn: (index: number) => void;
  toggleEquipped: (index: number) => void;
  removeCompanion: (id: string) => void;
  setCompanion: (id: string, patch: Partial<CompanionConfig>) => void;
}

/** Cumulative number of options the player may pick in a choice group at this level. */
export function extraPickCount(g: ChoiceGroup, level: number): number {
  let n = 0;
  for (const [lvl, count] of Object.entries(g.pickByLevel)) if (Number(lvl) <= level && count > n) n = count;
  return n;
}

/** Default selections for a class's extra choices (single-pick groups default to the first option). */
function defaultExtraChoices(c: ClassDef | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of c?.extraChoices ?? []) {
    out[g.id] = extraPickCount(g, 1) === 1 && g.options[0] ? [g.options[0].id] : [];
  }
  return out;
}

export function useBuilderActions(
  setBuild: Dispatch<SetStateAction<BuildState>>,
  content: ContentDatabase,
): BuilderActions {
  const patch = (p: Partial<BuildState>) => setBuild((b) => ({ ...b, ...p }));
  return {
    patch,
    setLevel(n) {
      patch({ level: Math.max(1, Math.min(20, Math.round(n) || 1)) });
    },
    bumpLevel(delta) {
      // functional update so rapid +/- clicks don't all read one stale level
      setBuild((b) => ({ ...b, level: Math.max(1, Math.min(20, b.level + delta)) }));
    },
    changeAncestry(id) {
      const a = content.ancestries[id];
      const slots = a ? boostSlots(a.abilityBoosts) : [];
      const her = Object.values(content.heritages).find((h) => h.ancestryId === id || h.ancestryId === null);
      setBuild((b) => {
        // Drop ancestry-category feat picks (slotKey = "level:category:idx") — the old
        // ancestry's feats are illegal for the new one. Keep class/skill/general picks.
        const isAncestry = (k: string) => k.split(':')[1] === 'ancestry';
        const featPicks = Object.fromEntries(Object.entries(b.featPicks).filter(([k]) => !isAncestry(k)));
        const featChoices = Object.fromEntries(Object.entries(b.featChoices).filter(([k]) => !isAncestry(k)));
        return {
          ...b,
          ancestryId: id,
          heritageId: her?.id ?? null,
          ancestryBoosts: slots.map(() => null),
          heritageSkill: null,
          languages: [],
          featPicks,
          featChoices,
        };
      });
    },
    changeHeritage(id) {
      // A new heritage may not grant a trained skill, so drop any stale one.
      patch({ heritageId: id, heritageSkill: null });
    },
    setHeritageSkill(skill) {
      patch({ heritageSkill: skill });
    },
    changeBackground(id) {
      if (id === CUSTOM_BACKGROUND_ID) {
        setBuild((b) => ({
          ...b,
          backgroundId: id,
          backgroundBoosts: [],
          customBackground: b.customBackground ?? emptyCustomBackground(),
        }));
        return;
      }
      const b = content.backgrounds[id];
      const slots = b ? boostSlots(b.abilityBoosts) : [];
      patch({ backgroundId: id, backgroundBoosts: slots.map(() => null) });
    },
    setCustomBackground(p) {
      setBuild((b) => ({ ...b, customBackground: { ...(b.customBackground ?? emptyCustomBackground()), ...p } }));
    },
    changeClass(id) {
      const c = content.classes[id];
      const needsDeity = classChoosesDeity(c?.features);
      const needsFont = (c?.features ?? []).some((f) => f.featureId === 'divine-font');
      // Feat-slot levels are class-specific, so picks from the old class no longer
      // map cleanly — clear them. Skill increases / boosts are level-driven, keep them.
      setBuild((b) => ({
        ...b,
        classId: id,
        subclassId: c?.subclass?.options[0]?.id ?? null,
        extraChoices: defaultExtraChoices(c),
        keyAbility: c && c.keyAbility.length === 1 ? c.keyAbility[0] : null,
        classSkills: [],
        featPicks: {},
        // tradition changes with the class, so previously chosen spells no longer apply
        cantrips: [],
        spells: {},
        signatures: {},
        // give deity-using classes a default deity; keep any prior choice
        deityId: needsDeity ? b.deityId ?? Object.keys(content.deities)[0] ?? null : b.deityId,
        // default a divine font from the (defaulted) deity's allowed options
        divineFont: needsFont
          ? content.deities[(needsDeity ? b.deityId ?? Object.keys(content.deities)[0] : b.deityId) ?? '']?.divineFont?.[0] ??
            'heal'
          : b.divineFont,
      }));
    },
    changeSubclass(id) {
      setBuild((b) => {
        const cls = b.classId ? content.classes[b.classId] : undefined;
        const oldOpt = cls?.subclass?.options.find((o) => o.id === b.subclassId);
        const newOpt = cls?.subclass?.options.find((o) => o.id === id);
        // A racket that requires a deity (rogue Avenger) defaults one so its mechanics apply.
        const deityId = newOpt?.requiresDeity && !b.deityId ? Object.keys(content.deities)[0] ?? null : b.deityId;
        // Cleric Battle Creed REQUIRES Battle Harbinger Dedication as the L2 class feat — pre-fill it
        // (and clear it when leaving battle creed if it was the auto-filled value).
        let featPicks = b.featPicks;
        const L2 = '2:class:0';
        if (id === 'battle-creed' && b.featPicks[L2] !== 'battle-harbinger-dedication') {
          featPicks = { ...b.featPicks, [L2]: 'battle-harbinger-dedication' };
        } else if (oldOpt?.id === 'battle-creed' && id !== 'battle-creed' && b.featPicks[L2] === 'battle-harbinger-dedication') {
          featPicks = { ...b.featPicks };
          delete featPicks[L2];
        }
        // a patron change that switches tradition invalidates previously chosen spells
        if (oldOpt?.tradition !== newOpt?.tradition)
          return { ...b, subclassId: id, deityId, featPicks, cantrips: [], spells: {}, signatures: {} };
        return { ...b, subclassId: id, deityId, featPicks };
      });
    },
    toggleExtraChoice(groupId, optionId, maxPick) {
      setBuild((b) => {
        const cur = b.extraChoices[groupId] ?? [];
        let next: string[];
        if (maxPick <= 1) {
          next = [optionId]; // single-pick: replace
        } else if (cur.includes(optionId)) {
          next = cur.filter((x) => x !== optionId); // toggle off
        } else {
          next = [...cur, optionId].slice(-maxPick); // add, dropping oldest past the cap
        }
        return { ...b, extraChoices: { ...b.extraChoices, [groupId]: next } };
      });
    },
    changeDeity(id) {
      setBuild((b) => {
        // keep the current font if the new deity allows it, else switch to its first option
        const fonts = (content.deities[id]?.divineFont ?? []) as ('heal' | 'harm')[];
        const font = b.divineFont && (!fonts.length || fonts.includes(b.divineFont)) ? b.divineFont : fonts[0] ?? b.divineFont;
        // Re-default any Domain-feat sub-choice (Domain Initiate, …) that points at a domain
        // the new deity doesn't have — otherwise it silently grants an off-deity focus spell.
        const domains = (content.deities[id]?.domains ?? []) as string[];
        const featChoices = { ...b.featChoices };
        for (const [slotKey, val] of Object.entries(featChoices)) {
          const featId = b.featPicks[slotKey];
          const def = featId ? content.feats[featId]?.choice : undefined;
          if (def?.kind === 'domains' && !domains.includes(val)) featChoices[slotKey] = domains[0] ?? val;
        }
        return { ...b, deityId: id || null, divineFont: font, featChoices };
      });
    },
    changeDivineFont(font) {
      patch({ divineFont: font });
    },
    setArchetypeTradition(t) {
      // Changing tradition invalidates any off-tradition spells already picked.
      setBuild((b) =>
        b.archetypeTradition === t ? b : { ...b, archetypeTradition: t, cantrips: [], spells: {}, signatures: {} },
      );
    },
    setArchetypePoolTradition(t) {
      // Two-casters: changing the archetype tradition clears only the ARCHETYPE pool (not the class pool).
      setBuild((b) => {
        const as = b.archetypeSpells ?? { cantrips: [], spells: {} };
        return as.tradition === t ? b : { ...b, archetypeSpells: { ...as, tradition: t, cantrips: [], spells: {} } };
      });
    },
    setArchetypePoolKey(a) {
      setBuild((b) => ({ ...b, archetypeSpells: { ...(b.archetypeSpells ?? { cantrips: [], spells: {} }), keyAbility: a } }));
    },
    setSecondClass(id) {
      // Default the second class's subclass to its first option + seed its extra-choice defaults
      // (kineticist element, animist apparition, …) so the dual-class build stays legal/configurable.
      const c2 = id ? content.classes[id] : undefined;
      const sub = c2?.subclass?.options[0]?.id ?? null;
      setBuild((b) => ({ ...b, classId2: id, subclassId2: sub, extraChoices: { ...b.extraChoices, ...defaultExtraChoices(c2) } }));
    },
    setAbpSkill(skill, rank) {
      setBuild((b) => {
        const next = { ...(b.abpSkills ?? {}) };
        if (rank > 0) next[skill] = rank;
        else delete next[skill];
        return { ...b, abpSkills: next };
      });
    },
    setAbpApex(ability) {
      setBuild((b) => ({ ...b, abpApex: ability }));
    },
    toggleArchetypeCantrip(id, cap) {
      setBuild((b) => {
        const as = b.archetypeSpells ?? { cantrips: [], spells: {} };
        if (as.cantrips.includes(id)) return { ...b, archetypeSpells: { ...as, cantrips: as.cantrips.filter((x) => x !== id) } };
        if (as.cantrips.length >= cap) return b;
        return { ...b, archetypeSpells: { ...as, cantrips: [...as.cantrips, id] } };
      });
    },
    setBoost(group, i, v) {
      setBuild((b) => {
        const arr = [...b[group]];
        arr[i] = v;
        return { ...b, [group]: arr };
      });
    },
    setFeat(slotKey, featId) {
      setBuild((b) => {
        const featPicks = { ...b.featPicks };
        const featChoices = { ...b.featChoices };
        delete featChoices[slotKey]; // a new feat invalidates the old slot's sub-choice
        if (featId) {
          featPicks[slotKey] = featId;
          // Default the embedded choice so the feat is usable immediately.
          const def = content.feats[featId]?.choice;
          if (def?.kind === 'domains') {
            const dom = (b.deityId ? content.deities[b.deityId]?.domains : undefined)?.[0];
            if (dom) featChoices[slotKey] = dom;
          } else if (def?.kind === 'array' && def.options?.[0]) {
            featChoices[slotKey] = def.options[0].value;
          }
        } else {
          delete featPicks[slotKey];
        }
        return { ...b, featPicks, featChoices };
      });
    },
    setFeatChoice(slotKey, value) {
      setBuild((b) => ({ ...b, featChoices: { ...b.featChoices, [slotKey]: value } }));
    },
    setSkillIncrease(level, key) {
      setBuild((b) => {
        const skillIncreases = { ...b.skillIncreases };
        if (key) skillIncreases[level] = key;
        else delete skillIncreases[level];
        return { ...b, skillIncreases };
      });
    },
    setPathToPerfection(tier, save) {
      setBuild((b) => {
        const picks = [...(b.pathToPerfection ?? [])];
        picks[tier] = save;
        // A later tier that no longer satisfies its constraint is cleared: tier 1 must differ from
        // tier 0; tier 2 (legendary) must be one of the two mastered saves.
        if (tier === 0 && picks[1] === save) picks[1] = null;
        if (picks[2] && picks[2] !== picks[0] && picks[2] !== picks[1]) picks[2] = null;
        return { ...b, pathToPerfection: picks };
      });
    },
    setAttributeBoost(level, idx, v) {
      setBuild((b) => {
        const cur = b.attributeBoosts[level] ?? [null, null, null, null];
        const arr = [...cur];
        arr[idx] = v;
        return { ...b, attributeBoosts: { ...b.attributeBoosts, [level]: arr } };
      });
    },
    toggleCantrip(id) {
      setBuild((b) => {
        if (b.cantrips.includes(id)) return { ...b, cantrips: b.cantrips.filter((x) => x !== id) };
        if (b.cantrips.length >= cantripsKnown(b.classId)) return b;
        return { ...b, cantrips: [...b.cantrips, id] };
      });
    },
    toggleSpell(rank, id) {
      setBuild((b) => {
        const cur = b.spells[rank] ?? [];
        const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
        return { ...b, spells: { ...b.spells, [rank]: next } };
      });
    },
    addSpell(rank, id) {
      setBuild((b) => ({ ...b, spells: { ...b.spells, [rank]: [...(b.spells[rank] ?? []), id] } }));
    },
    removeSpellAt(rank, index) {
      setBuild((b) => {
        const cur = b.spells[rank] ?? [];
        return { ...b, spells: { ...b.spells, [rank]: cur.filter((_, i) => i !== index) } };
      });
    },
    toggleSignature(rank, id) {
      setBuild((b) => {
        const signatures = { ...b.signatures };
        if (signatures[rank] === id) delete signatures[rank];
        else signatures[rank] = id;
        return { ...b, signatures };
      });
    },
    addItem(itemId) {
      const item = content.items[itemId];
      // default armor to worn and weapons/shields to held, so gear is active on add
      const worn = item?.itemType === 'armor';
      const equipped = item?.itemType === 'weapon' || item?.itemType === 'shield';
      setBuild((b) => ({ ...b, inventory: [...b.inventory, { itemId, quantity: 1, worn, equipped }] }));
    },
    removeItem(index) {
      setBuild((b) => ({ ...b, inventory: b.inventory.filter((_, i) => i !== index) }));
    },
    setItemQty(index, qty) {
      setBuild((b) => ({
        ...b,
        inventory: b.inventory.map((it, i) => (i === index ? { ...it, quantity: Math.max(1, qty) } : it)),
      }));
    },
    toggleWorn(index) {
      setBuild((b) => ({
        ...b,
        inventory: b.inventory.map((it, i) => (i === index ? { ...it, worn: !it.worn } : it)),
      }));
    },
    toggleEquipped(index) {
      setBuild((b) => ({
        ...b,
        inventory: b.inventory.map((it, i) => (i === index ? { ...it, equipped: !it.equipped } : it)),
      }));
    },
    removeCompanion(id) {
      setBuild((b) => ({ ...b, companions: b.companions.filter((c) => c.id !== id) }));
    },
    setCompanion(id, patch) {
      setBuild((b) => ({ ...b, companions: b.companions.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    },
    toggleSkill(s) {
      setBuild((b) => {
        const cls = b.classId ? content.classes[b.classId] : undefined;
        const locked = new Set<string>();
        if (cls) cls.trainedSkills.fixed.forEach((x) => locked.add(x));
        const bg = resolveBackground(b, content);
        if (bg?.trainedSkill) locked.add(bg.trainedSkill);
        if (b.heritageSkill) locked.add(b.heritageSkill);
        const sub = cls?.subclass?.options.find((o) => o.id === b.subclassId);
        sub?.grants?.skills?.forEach((x) => locked.add(x));
        if (locked.has(s)) return b;
        const max = additionalClassSkills(b, content);
        if (b.classSkills.includes(s)) return { ...b, classSkills: b.classSkills.filter((x) => x !== s) };
        // Count only non-granted picks toward the cap (a granted skill in classSkills
        // shouldn't block a legitimate pick).
        if (b.classSkills.filter((x) => !locked.has(x)).length < max) return { ...b, classSkills: [...b.classSkills, s] };
        return b;
      });
    },
    toggleLanguage(id) {
      setBuild((b) => ({
        ...b,
        languages: b.languages.includes(id) ? b.languages.filter((x) => x !== id) : [...b.languages, id],
      }));
    },
  };
}

export interface EditorProps {
  build: BuildState;
  actions: BuilderActions;
  content: ContentDatabase;
}

export function AbilitySelect({
  value,
  options,
  onChange,
  exclude,
}: {
  value: AbilityId | null;
  options: readonly AbilityId[];
  onChange: (v: AbilityId | null) => void;
  /** Abilities already chosen elsewhere in this boost group — disabled here. */
  exclude?: readonly (AbilityId | null)[];
}) {
  return (
    <PopupSelect
      variant="pill"
      title="Attribute boost"
      placeholder=""
      value={value ?? ''}
      onChange={(v) => onChange((v || null) as AbilityId | null)}
      options={[
        { value: '', label: 'Clear' },
        ...options.map((o) => ({ value: o, label: ABILITY_LABEL[o], disabled: o !== value && !!exclude?.includes(o) })),
      ]}
    />
  );
}

/** A select replacement for large option lists: a button that opens a searchable overlay. */
export function SearchSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  bare = false,
}: {
  label: string;
  value: string | null | undefined;
  options: { id: string; name: string; note?: string }[];
  onChange: (id: string) => void;
  placeholder?: string;
  /** Render just the control (no .ocard/label wrapper) — for use inside a SetupCard. */
  bare?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.id === value);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  const control = (
    <>
      <button
        type="button"
        className={'popsel' + (current ? ' is-picked' : ' is-empty')}
        onClick={() => {
          setQ('');
          setOpen(true);
        }}
      >
        {current ? (
          <>
            <span className="popsel-val">{current.name}</span>
            <i className="ti ti-pencil popsel-change" aria-hidden="true" />
          </>
        ) : (
          <>
            <i className="ti ti-plus popsel-lead" aria-hidden="true" />
            <span className="popsel-ph">{placeholder}</span>
          </>
        )}
      </button>
      {open && (
        <div className="picker-overlay" onClick={() => setOpen(false)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              {label}
              <span className="ss-count">{options.length}</span>
              <button className="picker-close" onClick={() => setOpen(false)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <div style={{ padding: '8px 10px' }}>
              <input
                className="name-input"
                style={{ width: '100%', margin: 0 }}
                placeholder={`Search ${label.toLowerCase()}…`}
                value={q}
                autoFocus
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="picker-list">
              {filtered.slice(0, 100).map((o) => (
                <button
                  type="button"
                  className={'picker-item' + (o.id === value ? ' chosen' : '')}
                  key={o.id}
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                >
                  <div className="picker-text">
                    <div className="picker-name">{o.name}</div>
                    {o.note && <div className="picker-traits">{o.note}</div>}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="setup-note" style={{ padding: 12 }}>
                  No matches.
                </div>
              )}
              {filtered.length > 100 && (
                <div className="setup-note" style={{ padding: 12 }}>
                  Showing 100 of {filtered.length} — refine your search.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
  if (bare) return control;
  return (
    <div className="ocard">
      <div className="ol">{label}</div>
      {control}
    </div>
  );
}

/** A value picker that opens a popup list instead of a native dropdown (used for every
 *  in-builder choice: subclass, extra choices, ability boosts, skills, companion type, …).
 *  Auto-enables a search box for long lists. */
export function PopupSelect({
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  title = 'Choose',
  className,
  search,
  variant = 'slot',
  icon,
  cardLabel,
  addCustom,
}: {
  value: string | null | undefined;
  options: { value: string; label: string; note?: string; disabled?: boolean; description?: string; descRefs?: DescRef[] }[];
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
  className?: string;
  search?: boolean;
  /** 'slot' = full-width soft slot (default); 'pill' = compact pill (ability boosts);
   *  'card' = a feat-style level slot-card (icon tile + small label + value), so level-0 picks
   *  (skills, languages) read like the feat slots on the level pages. */
  variant?: 'slot' | 'pill' | 'card';
  /** Tabler icon shown in the filled state's accent tile (slot variant only). */
  icon?: string;
  /** The small top label on the 'card' variant (e.g. "Skill", "Language", "Lore"). */
  cardLabel?: string;
  /** Adds a "type your own" entry to the popup (e.g. a custom Lore): picking it swaps the list
   *  for a text field, all inside the same popup. onAdd receives the typed text. */
  addCustom?: { label: string; placeholder: string; onAdd: (text: string) => void };
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  // When any option carries a description, the popup shows read-first rows (press to read, a Select
  // button to choose) instead of click-to-select — matching the feat/spell picker.
  const [descNode, setDescNode] = useState<DescNode | null>(null);
  const close = () => {
    setOpen(false);
    setCustomMode(false);
    setCustomText('');
  };
  const commitCustom = () => {
    const t = customText.trim();
    if (!t || !addCustom) return;
    addCustom.onAdd(t);
    close();
  };
  const current = options.find((o) => o.value === value && o.value !== '');
  const useSearch = search ?? options.length > 6;
  const needle = q.trim().toLowerCase();
  const filtered = useSearch && needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const openPicker = () => {
    setQ('');
    setCustomMode(false);
    setCustomText('');
    setOpen(true);
  };
  return (
    <>
      {variant === 'card' ? (
        <button
          type="button"
          className={'lvl-card' + (current ? '' : ' empty') + (className ? ' ' + className : '')}
          onClick={openPicker}
        >
          <span className="lvl-card-icon">
            <i className={'ti ' + (icon ?? 'ti-plus')} aria-hidden="true" />
          </span>
          <div className="lvl-card-text">
            {cardLabel && <div className="lvl-card-label">{cardLabel}</div>}
            <div className="lvl-card-val">{current ? current.label : placeholder}</div>
          </div>
          {!current && <span className="lvl-pending">!</span>}
        </button>
      ) : (
        <button
          type="button"
          className={'popsel' + (variant === 'pill' ? ' pill' : '') + (current ? ' is-picked' : ' is-empty') + (className ? ' ' + className : '')}
          onClick={openPicker}
        >
          {current ? (
            <>
              {variant === 'pill' ? (
                <i className="ti ti-check popsel-lead" aria-hidden="true" />
              ) : icon ? (
                <span className="popsel-tile"><i className={'ti ' + icon} aria-hidden="true" /></span>
              ) : null}
              <span className="popsel-val">{current.label}</span>
              {variant !== 'pill' && <i className="ti ti-pencil popsel-change" aria-hidden="true" />}
            </>
          ) : (
            <>
              <i className="ti ti-plus popsel-lead" aria-hidden="true" />
              {placeholder && <span className="popsel-ph">{placeholder}</span>}
            </>
          )}
        </button>
      )}
      {open && (
        <div className="picker-overlay" onClick={close}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              {customMode && addCustom ? addCustom.label.replace(/^[^\p{L}]+/u, '') : title}
              <button className="picker-close" style={{ marginLeft: 'auto' }} onClick={close} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            {customMode && addCustom ? (
              <div className="popsel-custom">
                <input
                  className="name-input"
                  style={{ width: '100%', margin: 0 }}
                  placeholder={addCustom.placeholder}
                  value={customText}
                  autoFocus
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitCustom();
                    }
                    if (e.key === 'Escape') setCustomMode(false);
                  }}
                />
                <div className="popsel-custom-actions">
                  <button type="button" className="btn-ghost" onClick={() => setCustomMode(false)}>
                    Back
                  </button>
                  <button type="button" className="btn-primary" disabled={!customText.trim()} onClick={commitCustom}>
                    Add
                  </button>
                </div>
              </div>
            ) : (
              <>
                {useSearch && (
                  <div style={{ padding: '8px 10px' }}>
                    <input
                      className="name-input"
                      style={{ width: '100%', margin: 0 }}
                      placeholder="Search…"
                      value={q}
                      autoFocus
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>
                )}
                <div className="picker-list">
                  {filtered.some((o) => o.description)
                    ? // Read-first rows: press the option to read its description; the Select button chooses it.
                      filtered.map((o) => {
                        const node = o.description ? descNodeOf({ name: o.label, description: o.description, descRefs: o.descRefs }, 'origin') : null;
                        return (
                          <PickerRow
                            key={o.value || '__none'}
                            name={o.label}
                            meta={o.note ? <div className="picker-traits">{o.note}</div> : undefined}
                            chosen={o.value === value}
                            dim={o.disabled}
                            onOpenDesc={node ? () => setDescNode(node) : undefined}
                            selectLabel="Select"
                            selectDisabled={o.disabled}
                            onSelect={() => {
                              onChange(o.value);
                              close();
                            }}
                          />
                        );
                      })
                    : filtered.map((o) => (
                        <button
                          type="button"
                          key={o.value || '__none'}
                          className={'picker-item' + (o.value === value ? ' chosen' : '') + (o.disabled ? ' prereq-unmet' : '')}
                          disabled={o.disabled}
                          onClick={() => {
                            onChange(o.value);
                            close();
                          }}
                        >
                          <span className="picker-check">{o.value === value && <i className="ti ti-check" aria-hidden="true" />}</span>
                          <div className="picker-text">
                            <div className="picker-name">{o.label}</div>
                            {o.note && <div className="picker-traits">{o.note}</div>}
                          </div>
                        </button>
                      ))}
                  {addCustom && (
                    <button type="button" className="picker-item" onClick={() => setCustomMode(true)}>
                      <span className="picker-check"><i className="ti ti-pencil" aria-hidden="true" /></span>
                      <div className="picker-text">
                        <div className="picker-name">{addCustom.label}</div>
                      </div>
                    </button>
                  )}
                  {filtered.length === 0 && !addCustom && (
                    <div className="setup-note" style={{ padding: 12 }}>
                      No matches.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {descNode && <DescriptionModal root={descNode} onClose={() => setDescNode(null)} />}
        </div>
      )}
    </>
  );
}

/** The "deep background" editor: name + description and the mechanical grants
 *  (two distinct attribute boosts, a trained skill, a Lore, and a skill feat). */
function CustomBackgroundForm({ build, actions, content }: EditorProps) {
  const cb = build.customBackground ?? emptyCustomBackground();
  const set = actions.setCustomBackground;
  // Scanning all ~6k feats is content-static — memoize so name/description keystrokes don't re-filter.
  const skillFeats = useMemo(() => Object.values(content.feats).filter((f) => f.category === 'skill'), [content.feats]);
  const capSkill = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const setBoost = (i: number, v: string) => {
    const boosts = [...cb.boosts] as [AbilityId | null, AbilityId | null];
    boosts[i] = (v || null) as AbilityId | null;
    set({ boosts });
  };
  return (
    <div className="custom-bg">
      <div className="cbg-title">Custom background</div>
      <label className="cbg-field">
        <span className="cbg-lbl">Name</span>
        <input value={cb.name} placeholder="e.g. Shipwreck Survivor" onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="cbg-field">
        <span className="cbg-lbl">Description</span>
        <textarea
          rows={2}
          value={cb.description}
          placeholder="A short background description…"
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <div className="cbg-row">
        {([0, 1] as const).map((i) => (
          <label className="cbg-field" key={i}>
            <span className="cbg-lbl">Boost {i + 1}</span>
            <PopupSelect
              title={`Boost ${i + 1}`}
              placeholder="Choose"
              value={cb.boosts[i] ?? ''}
              onChange={(v) => setBoost(i, v)}
              options={[
                { value: '', label: '—' },
                ...ABILITIES.map((ab) => ({ value: ab, label: ab.toUpperCase(), disabled: cb.boosts[1 - i] === ab })),
              ]}
            />
          </label>
        ))}
      </div>
      <div className="cbg-row">
        <label className="cbg-field">
          <span className="cbg-lbl">Trained skill</span>
          <PopupSelect
            title="Trained skill"
            placeholder="Choose a skill"
            value={cb.trainedSkill ?? ''}
            onChange={(v) => set({ trainedSkill: (v || null) as SkillId | null })}
            options={[{ value: '', label: '—' }, ...SKILLS.map((s) => ({ value: s, label: capSkill(s) }))]}
          />
        </label>
        <label className="cbg-field">
          <span className="cbg-lbl">Lore</span>
          <input value={cb.loreSubject} placeholder="e.g. Sailing" onChange={(e) => set({ loreSubject: e.target.value })} />
        </label>
      </div>
      <SearchSelect
        label="Skill feat"
        value={cb.skillFeatId}
        onChange={(id) => set({ skillFeatId: id })}
        options={skillFeats.map((f) => ({ id: f.id, name: f.name }))}
      />
    </div>
  );
}

/** A Level-0 setup choice rendered like the level-up cards (icon + label + picker), so the whole
 *  builder reads as one consistent picking flow. The picker control(s) go in `children`. */
/** ABP skill-potency editor: assign item-bonus ranks (+1/+2/+3) to skills within the level budget. */
function AbpPotencyEditor({ build, actions }: { build: BuildState; actions: BuilderActions }) {
  const assigned = Object.entries(build.abpSkills ?? {}).filter(([, r]) => r > 0);
  const budget = abpSkillBudget(build.level);
  const count2 = assigned.filter(([, r]) => r >= 2).length;
  const count3 = assigned.filter(([, r]) => r >= 3).length;
  const used = new Set(assigned.map(([k]) => k));
  const rankAllowed = (key: string, rank: number) => {
    const cur = build.abpSkills?.[key] ?? 0;
    if (rank === 2) return cur >= 2 || count2 < budget.rank2;
    if (rank === 3) return cur >= 3 || (budget.rank3 > 0 && count3 < budget.rank3);
    return true;
  };
  return (
    <SubCard icon="ti-star" label={`Skill potency (${assigned.length}/${budget.total})`}>
      {budget.total === 0 ? (
        <div className="spr-count">Skill potency begins at level 3.</div>
      ) : (
        <>
          {assigned.map(([key, rank]) => (
            <div className="spr-chips" key={key} style={{ alignItems: 'center', gap: 6 }}>
              <span style={{ minWidth: 96 }}>{cap(key)}</span>
              {[1, 2, 3].map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={!rankAllowed(key, r)}
                  className={'inv-toggle' + (rank === r ? ' on' : '')}
                  onClick={() => actions.setAbpSkill(key, r)}
                >
                  +{r}
                </button>
              ))}
              <button type="button" className="ms-remove" aria-label="Remove skill" onClick={() => actions.setAbpSkill(key, 0)}>
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
          ))}
          {assigned.length < budget.total && (
            <PopupSelect
              title="Add a skill"
              value=""
              onChange={(v) => v && actions.setAbpSkill(v, 1)}
              options={[{ value: '', label: '+ add skill' }, ...SKILLS.filter((s) => !used.has(s)).map((s) => ({ value: s, label: cap(s) }))]}
            />
          )}
        </>
      )}
    </SubCard>
  );
}

/** The optional-variant-rules toggles (Ancestry Paragon, ABP, Dual Class, …) + their sub-pickers
 *  (second class, ABP skill potency / apex). Lives on the builder's Setup page. */
export function VariantRulesCard({ build, actions, content }: EditorProps) {
  return (
    <SetupCard icon="ti-adjustments-alt" label="Variant rules">
      <div className="spr-chips">
        {(
          [
            ['ancestryParagon', 'Ancestry Paragon', 'Extra ancestry feats: two at level 1, then one more at every odd level (3, 5, 7 … 19) — 11 total.'],
            ['freeArchetype', 'Free Archetype', 'A bonus class feat at every even level (2–20) that may only be spent on archetype feats.'],
            ['gradualBoosts', 'Gradual Attribute Boosts', 'The attribute boosts at 5/10/15/20 instead arrive one at a time at levels 2-5, 7-10, 12-15, 17-20.'],
            ['proficiencyWithoutLevel', 'Proficiency w/o Level', 'Remove your level from proficiency: untrained −2, trained +2, expert +4, master +6, legendary +8.'],
            ['abp', 'Automatic Bonus Progression', 'Gain item-equivalent attack/AC/save/Perception/skill bonuses automatically by level (replaces fundamental runes).'],
            ['dualClass', 'Dual Class', 'Gain the proficiencies, Hit Points, class features and class feats of a second class.'],
          ] as const
        ).map(([flag, label, desc]) => (
          <button
            key={flag}
            type="button"
            title={desc}
            className={'inv-toggle' + (build.variantRules?.[flag] ? ' on' : '')}
            onClick={() => actions.patch({ variantRules: { ...build.variantRules, [flag]: !build.variantRules?.[flag] } })}
          >
            {label}
          </button>
        ))}
      </div>
      {build.variantRules?.dualClass && (
        <SubCard icon="ti-versions" label="Second class">
          <PopupSelect
            title="Second class"
            value={build.classId2 ?? ''}
            onChange={(v) => actions.setSecondClass(v || null)}
            options={[
              { value: '', label: '— none —' },
              ...Object.values(content.classes)
                .filter((cl) => cl.id !== build.classId)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((cl) => ({ value: cl.id, label: cl.name, description: cl.description, descRefs: cl.descRefs })),
            ]}
          />
          {(() => {
            const cl = build.classId2 ? content.classes[build.classId2] : undefined;
            return cl?.description ? <ChoiceDetails name={cl.name} flavor={cl.description} descRefs={cl.descRefs} /> : null;
          })()}
          {build.classId2 && content.classes[build.classId2]?.subclass && (
            <PopupSelect
              title={content.classes[build.classId2]!.subclass!.name}
              value={build.subclassId2 ?? ''}
              onChange={(v) => actions.patch({ subclassId2: v || null })}
              options={[
                { value: '', label: '— none —' },
                ...content.classes[build.classId2]!.subclass!.options.map((o) => ({ value: o.id, label: o.name, description: o.description, descRefs: o.descRefs })),
              ]}
            />
          )}
        </SubCard>
      )}
      {build.variantRules?.abp && <AbpPotencyEditor build={build} actions={actions} />}
      {build.variantRules?.abp && build.level >= 17 && (
        <SubCard icon="ti-rosette" label="Attribute apex (level 17)">
          <AbilitySelect value={build.abpApex ?? null} options={ABILITIES} onChange={(v) => actions.setAbpApex(v)} />
        </SubCard>
      )}
    </SetupCard>
  );
}

/** Per-character convenience/house options on the Setup page (alternate ancestry boosts, voluntary
 *  flaw, ignore bulk, dice roller on/off). Distinct from the GMG variant rules. */
export function OptionsCard({ build, actions }: EditorProps) {
  const opts = build.options ?? {};
  const set = (patch: Partial<CharacterOptions>) => actions.patch({ options: { ...opts, ...patch } });
  return (
    <SetupCard icon="ti-settings" label="Options">
      <div className="spr-chips">
        <button
          type="button"
          title="Replace your ancestry's listed attribute boosts AND flaws with two free attribute boosts."
          className={'inv-toggle' + (opts.alternateAncestryBoosts ? ' on' : '')}
          onClick={() => set({ alternateAncestryBoosts: !opts.alternateAncestryBoosts })}
        >
          Alternate Ancestry Boosts
        </button>
        <button
          type="button"
          title="Disable the negative effects of carrying too much Bulk — no encumbered/over-limit warnings."
          className={'inv-toggle' + (opts.ignoreBulk ? ' on' : '')}
          onClick={() => set({ ignoreBulk: !opts.ignoreBulk })}
        >
          Ignore Bulk Limit
        </button>
        <button
          type="button"
          title="Take an additional attribute flaw (regardless of your ancestry). Pick which attribute at level 0."
          className={'inv-toggle' + (opts.voluntaryFlaw ? ' on' : '')}
          onClick={() => set({ voluntaryFlaw: !opts.voluntaryFlaw })}
        >
          Voluntary Flaw
        </button>
        <button
          type="button"
          title="Turn the dice roller on or off. When off, its button (and per-stat roll triggers) is hidden everywhere on the sheet."
          className={'inv-toggle' + (!opts.diceRollerOff ? ' on' : '')}
          onClick={() => set({ diceRollerOff: !opts.diceRollerOff })}
        >
          Dice roller {opts.diceRollerOff ? 'off' : 'on'}
        </button>
      </div>
    </SetupCard>
  );
}

export function SetupCard({
  icon,
  label,
  count,
  children,
}: {
  icon: string;
  label: string;
  count?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="lvl-card lvl-card-setup">
      <span className="lvl-card-icon">
        <i className={'ti ' + icon} aria-hidden="true" />
      </span>
      <div className="lvl-card-text">
        <div className="lvl-card-label">
          {label}
          {count != null && <span className="ol-count"> {count}</span>}
        </div>
        <div className="lvl-card-row">{children}</div>
      </div>
    </div>
  );
}

/** A dependent follow-up choice (an attribute boost a background grants, the domain a feat asks
 *  for, …) rendered as a small card indented + connected under the card that triggered it. */
export function SubCard({ icon, label, count, children }: { icon: string; label: string; count?: ReactNode; children: ReactNode }) {
  return (
    <div className="lvl-subcard">
      <i className="ti ti-corner-down-right lvl-subcard-conn" aria-hidden="true" />
      <div className="lvl-card lvl-card-setup lvl-card-child">
        <span className="lvl-card-icon">
          <i className={'ti ' + icon} aria-hidden="true" />
        </span>
        <div className="lvl-card-text">
          <div className="lvl-card-label">
            {label}
            {count != null && <span className="ol-count"> {count}</span>}
          </div>
          <div className="lvl-card-row">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function OriginPickers({ build, actions, content }: EditorProps) {
  const heritageOpts = Object.values(content.heritages).filter(
    (h) => h.ancestryId === build.ancestryId || h.ancestryId === null,
  );
  const ancestry = build.ancestryId ? content.ancestries[build.ancestryId] : undefined;
  const background = build.backgroundId ? content.backgrounds[build.backgroundId] : undefined;
  const cls = build.classId ? content.classes[build.classId] : undefined;
  // Dual Class: a subsystem owned by class `id` may live on the second class — its setup UI should
  // appear (and read the right subclass) regardless of which slot the class is in.
  const cls2 = build.variantRules?.dualClass && build.classId2 ? content.classes[build.classId2] : undefined;
  const ownsClass = (id: string): boolean => cls?.id === id || cls2?.id === id;
  const classDefOf = (id: string): ClassDef | undefined => (cls?.id === id ? cls : cls2?.id === id ? cls2 : undefined);
  const subclassOf = (id: string): string | null => (cls?.id === id ? build.subclassId : cls2?.id === id ? build.subclassId2 ?? null : null);
  // Origin-granted ability boosts + the class key attribute live as child cards under the card
  // that grants them (a background's boost belongs to the background, not a separate section).
  // Alternate Ancestry Boosts: ignore the ancestry's listed boosts/flaws; offer two free boosts.
  const altBoosts = !!build.options?.alternateAncestryBoosts;
  const ancSlots = !ancestry ? [] : altBoosts ? ([{ kind: 'free' }, { kind: 'free' }] as BoostSlot[]) : boostSlots(ancestry.abilityBoosts);
  const ancFixed = ancestry && !altBoosts ? fixedBoosts(ancestry.abilityBoosts) : [];
  const bgSlots = background ? boostSlots(background.abilityBoosts) : [];
  const subKey = subclassKeyAbility(build, content);
  const keyChoice = !subKey && cls && cls.keyAbility.length > 1;
  const keyAbility = subKey ?? build.keyAbility ?? cls?.keyAbility[0] ?? null;
  // Surface non-common rarity (uncommon/rare from adventure-path content) as a note.
  const note = (r?: string) => (r && r !== 'common' ? r : undefined);
  // Changing class clears class-specific picks (feats, class skills, spells/cantrips, subclass
  // choices). Confirm first when there's actually something to lose, mirroring the level-down guard.
  const [pendingClass, setPendingClass] = useState<string | null>(null);
  const classChangeLoses =
    !!build.classId &&
    (Object.keys(build.featPicks).length > 0 ||
      build.classSkills.length > 0 ||
      build.cantrips.length > 0 ||
      Object.keys(build.spells).length > 0);
  const requestClassChange = (id: string) => {
    if (id !== build.classId && classChangeLoses) setPendingClass(id);
    else actions.changeClass(id);
  };
  return (
    <>
      <SetupCard icon="ti-user" label="Ancestry">
        <SearchSelect
          bare
          label="Ancestry"
          value={build.ancestryId}
          onChange={actions.changeAncestry}
          options={Object.values(content.ancestries).map((a) => ({ id: a.id, name: a.name, note: note(a.rarity) }))}
        />
        {ancestry && (
          <ChoiceDetails
            name={ancestry.name}
            flavor={ancestry.description}
            descRefs={ancestry.descRefs}
            grants={
              <div className="cc-grants">
                <span className="cc-g"><i className="ti ti-heart" aria-hidden="true" /> HP {ancestry.hp}</span>
                <span className="cc-g"><i className="ti ti-ruler-2" aria-hidden="true" /> {cap(ancestry.size)}</span>
                <span className="cc-g"><i className="ti ti-run" aria-hidden="true" /> {ancestry.speeds?.land ?? 25} ft</span>
                {ancestry.vision && ancestry.vision !== 'normal' && (
                  <span className="cc-g"><i className="ti ti-eye" aria-hidden="true" /> {cap(ancestry.vision)}</span>
                )}
              </div>
            }
          />
        )}
      </SetupCard>
      {ancestry && ancSlots.length > 0 && (
        <SubCard
          icon="ti-arrow-up"
          label={
            altBoosts
              ? 'Ancestry boosts · two free (alternate)'
              : `Ancestry boost${ancSlots.length > 1 ? 's' : ''}${ancFixed.length ? ` · +${ancFixed.map((a) => ABILITY_LABEL[a]).join(', ')}` : ''}`
          }
        >
          {ancSlots.map((slot, i) => (
            <AbilitySelect
              key={i}
              value={build.ancestryBoosts[i] ?? null}
              options={slot.kind === 'choice' && slot.options ? slot.options : ABILITIES}
              exclude={build.ancestryBoosts}
              onChange={(v) => actions.setBoost('ancestryBoosts', i, v)}
            />
          ))}
          {!altBoosts && ancestry.abilityFlaws.length > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--app-bad)' }}>
              flaw: {ancestry.abilityFlaws.map((a) => ABILITY_LABEL[a]).join(', ')}
            </span>
          )}
        </SubCard>
      )}
      {/* Voluntary Flaw (toggled in Setup): pick which attribute takes the extra flaw, here at level 0. */}
      {ancestry && build.options?.voluntaryFlaw && (
        <SubCard icon="ti-arrow-down" label="Voluntary flaw">
          <AbilitySelect
            value={build.options?.voluntaryFlawAbility ?? null}
            options={ABILITIES}
            onChange={(v) => actions.patch({ options: { ...build.options, voluntaryFlawAbility: v } })}
          />
        </SubCard>
      )}
      <SetupCard icon="ti-dna" label="Heritage">
        <SearchSelect
          bare
          label="Heritage"
          value={build.heritageId}
          onChange={actions.changeHeritage}
          options={heritageOpts.map((h) => ({ id: h.id, name: h.name, note: note(h.rarity) }))}
        />
        {build.heritageId && content.heritages[build.heritageId] && (
          <ChoiceDetails
            name={content.heritages[build.heritageId].name}
            flavor={content.heritages[build.heritageId].description}
            descRefs={content.heritages[build.heritageId].descRefs}
          />
        )}
      </SetupCard>
      {/* Heritages that grant a "skill of your choice" (Skilled human) need a picker, or
          the granted trained skill is silently lost. Expert@5 is applied by buildCharacter. */}
      {build.heritageId === 'skilled-human' && (
        <SubCard icon="ti-star" label="Heritage skill">
          <PopupSelect
            title="Heritage skill"
            placeholder="Choose a skill"
            value={build.heritageSkill ?? ''}
            onChange={(v) => actions.setHeritageSkill((v || null) as SkillId | null)}
            options={[{ value: '', label: '—' }, ...SKILLS.map((s) => ({ value: s, label: cap(s) }))]}
          />
        </SubCard>
      )}
      <SetupCard icon="ti-briefcase" label="Background">
        <SearchSelect
          bare
          label="Background"
          value={build.backgroundId}
          onChange={actions.changeBackground}
          options={[
            { id: CUSTOM_BACKGROUND_ID, name: '✎ Custom background…' },
            ...Object.values(content.backgrounds).map((b) => ({ id: b.id, name: b.name, note: note(b.rarity) })),
          ]}
        />
        {background && build.backgroundId !== CUSTOM_BACKGROUND_ID && (
          <ChoiceDetails
            name={background.name}
            flavor={background.description}
            descRefs={background.descRefs}
            grants={
              <div className="cc-grants">
                {background.trainedSkill && (
                  <span className="cc-g">
                    <i className="ti ti-bulb" aria-hidden="true" /> Trained: {cap(background.trainedSkill)}
                    {background.trainedLore ? `, ${cap(background.trainedLore)} Lore` : ''}
                  </span>
                )}
                {background.grantedFeatId && content.feats[background.grantedFeatId] && (
                  <span className="cc-g"><i className="ti ti-medal" aria-hidden="true" /> {content.feats[background.grantedFeatId].name}</span>
                )}
              </div>
            }
          />
        )}
      </SetupCard>
      {background && bgSlots.length > 0 && (
        <SubCard icon="ti-arrow-up" label={`Background boost${bgSlots.length > 1 ? 's' : ''}`}>
          {bgSlots.map((slot, i) => (
            <AbilitySelect
              key={i}
              value={build.backgroundBoosts[i] ?? null}
              options={slot.kind === 'choice' && slot.options ? slot.options : ABILITIES}
              exclude={build.backgroundBoosts}
              onChange={(v) => actions.setBoost('backgroundBoosts', i, v)}
            />
          ))}
        </SubCard>
      )}
      {build.backgroundId === CUSTOM_BACKGROUND_ID && (
        <CustomBackgroundForm build={build} actions={actions} content={content} />
      )}
      <SetupCard icon="ti-sword" label="Class">
        <SearchSelect
          bare
          label="Class"
          value={build.classId}
          onChange={requestClassChange}
          options={Object.values(content.classes).map((c) => ({ id: c.id, name: c.name, note: note(c.rarity) }))}
        />
        {cls && (
          <ChoiceDetails
            name={cls.name}
            flavor={cls.description}
            descRefs={cls.descRefs}
            grants={
              <div className="cc-grants">
                <span className="cc-g"><i className="ti ti-rosette" aria-hidden="true" /> Key: {cls.keyAbility.map((a) => ABILITY_LABEL[a]).join('/')}</span>
                <span className="cc-g"><i className="ti ti-heart" aria-hidden="true" /> HP {cls.hpPerLevel}/level</span>
                {cls.trainedSkills?.fixed?.length > 0 && (
                  <span className="cc-g"><i className="ti ti-bulb" aria-hidden="true" /> {cls.trainedSkills.fixed.map(cap).join(', ')}</span>
                )}
                <span className="cc-g"><i className="ti ti-star" aria-hidden="true" /> {cls.trainedSkills.additional}+Int skills</span>
              </div>
            }
          />
        )}
      </SetupCard>
      {cls && (
        <SubCard icon="ti-rosette" label="Key attribute">
          {keyChoice ? (
            <AbilitySelect value={build.keyAbility} options={cls.keyAbility} onChange={(v) => actions.patch({ keyAbility: v })} />
          ) : (
            <span className="fixed-val">{keyAbility ? ABILITY_LABEL[keyAbility] : '—'}</span>
          )}
        </SubCard>
      )}
      {cls?.subclass && (
        <SetupCard icon="ti-versions" label={cls.subclass.name}>
          <PopupSelect
            title={cls.subclass.name}
            value={build.subclassId ?? ''}
            onChange={(v) => actions.changeSubclass(v)}
            options={cls.subclass.options.map((o) => ({ value: o.id, label: o.name, description: o.description, descRefs: o.descRefs }))}
          />
          {(() => {
            const sub = cls.subclass.options.find((o) => o.id === build.subclassId);
            return sub?.description ? <ChoiceDetails name={sub.name} flavor={sub.description} descRefs={sub.descRefs} /> : null;
          })()}
        </SetupCard>
      )}
      {(() => {
        // A restricted "trained in one of these" choice — from the subclass (Pistolero/Empiricism) OR
        // the class itself (thaumaturge's esoteric skill). Both store the pick in build.subclassSkill.
        const subOpt = cls?.subclass?.options.find((o) => o.id === build.subclassId);
        const choice = subOpt?.skillChoice?.length ? subOpt.skillChoice : cls?.trainedSkills.choice;
        if (!choice?.length) return null;
        const current = choice.includes(build.subclassSkill as SkillId) ? (build.subclassSkill as SkillId) : choice[0];
        return (
          <SubCard icon="ti-school" label="Trained skill">
            <PopupSelect
              title="Trained skill"
              value={current}
              onChange={(v) => actions.patch({ subclassSkill: v as SkillId })}
              options={choice.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
            />
          </SubCard>
        );
      })()}
      {(() => {
        // Sorcerer Draconic: pick the dragon exemplar (sets spell tradition + second bloodline skill).
        const subOpt = cls?.subclass?.options.find((o) => o.id === build.subclassId);
        if (!subOpt?.dragonChoice?.length) return null;
        const cur = subOpt.dragonChoice.find((d) => d.slug === build.dragonExemplar)?.slug ?? subOpt.dragonChoice[0].slug;
        return (
          <SubCard icon="ti-flame" label="Dragon">
            <PopupSelect
              title="Dragon exemplar"
              value={cur}
              onChange={(v) => actions.patch({ dragonExemplar: v })}
              options={subOpt.dragonChoice.map((d) => ({ value: d.slug, label: `${d.label} (${d.tradition})` }))}
            />
          </SubCard>
        );
      })()}
      {[...(cls?.extraChoices ?? []), ...(cls2?.extraChoices ?? [])].map((g) => {
        const max = extraPickCount(g, build.level);
        if (max === 0) return null; // not yet unlocked at this level (e.g. higher-level epithets)
        const selected = build.extraChoices[g.id] ?? [];
        return (
          <SubCard icon="ti-adjustments" label={g.name} count={max > 1 ? `${selected.length}/${max}` : undefined} key={g.id}>
            {max <= 1 ? (
              <PopupSelect
                title={g.name}
                value={selected[0] ?? ''}
                onChange={(v) => actions.toggleExtraChoice(g.id, v, 1)}
                options={g.options.map((o) => ({ value: o.id, label: o.name, description: o.description, descRefs: o.descRefs }))}
              />
            ) : (
              g.options.map((o) => {
                const on = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    className={'ec-chip' + (on ? ' on' : '')}
                    disabled={!on && selected.length >= max}
                    onClick={() => actions.toggleExtraChoice(g.id, o.id, max)}
                  >
                    {o.name}
                  </button>
                );
              })
            )}
            {selected.map((selId) => {
              const opt = g.options.find((o) => o.id === selId);
              return opt?.description ? (
                <ChoiceDetails key={'desc:' + selId} name={opt.name} flavor={opt.description} descRefs={opt.descRefs} />
              ) : null;
            })}
            {/* A selected option may grant a feat with a restricted sub-choice (Dominion Epithet →
                Energized Spark for one of two energy types): render that trait picker here. */}
            {selected.flatMap((selId) => {
              const opt = g.options.find((o) => o.id === selId);
              return (opt?.grantedChoiceFeats ?? [])
                .filter((gcf) => (gcf.restrictTo?.length ?? 0) > 1)
                .map((gcf) => {
                  const feat = content.feats[gcf.featId];
                  const key = `grant:${selId}:${gcf.featId}`;
                  const allowed = gcf.restrictTo!;
                  const cur = allowed.includes(build.grantedChoiceFeatTraits?.[key] ?? '')
                    ? build.grantedChoiceFeatTraits![key]
                    : allowed[0];
                  const lbl = (t: string) =>
                    feat?.choice?.options?.find((x) => x.value === t)?.label ?? t.charAt(0).toUpperCase() + t.slice(1);
                  return (
                    <div key={key} className="ec-subpick">
                      <span className="ec-subpick-label">{feat?.name ?? gcf.featId}</span>
                      <PopupSelect
                        title={feat?.name ?? 'Choice'}
                        value={cur}
                        onChange={(v) =>
                          actions.patch({
                            grantedChoiceFeatTraits: { ...(build.grantedChoiceFeatTraits ?? {}), [key]: v },
                          })
                        }
                        options={allowed.map((t) => ({ value: t, label: lbl(t) }))}
                      />
                    </div>
                  );
                });
            })}
          </SubCard>
        );
      })}
      {ownsClass('commander') &&
        (() => {
          const options = commanderTacticOptions(build.level, content);
          const max = commanderFolioMax(build.level);
          const selected = build.commanderTactics ?? [];
          const toggle = (id: string) => {
            const on = selected.includes(id);
            const next = on ? selected.filter((x) => x !== id) : selected.length < max ? [...selected, id] : selected;
            actions.patch({ commanderTactics: next });
          };
          return (
            <SubCard icon="ti-chess" label="Tactics folio" count={`${selected.length}/${max}`}>
              {options.map((o) => {
                const on = selected.includes(o.id);
                const tier = o.tacticTier && o.tacticTier !== 'basic' ? ` (${o.tacticTier})` : '';
                return (
                  <button
                    key={o.id}
                    type="button"
                    className={'ec-chip' + (on ? ' on' : '')}
                    disabled={!on && selected.length >= max}
                    onClick={() => toggle(o.id)}
                  >
                    {o.name}
                    {tier}
                  </button>
                );
              })}
              {selected.map((id) => {
                const o = options.find((x) => x.id === id);
                return o?.description ? <ChoiceDetails key={'d:' + id} name={o.name} flavor={o.description} descRefs={o.descRefs} /> : null;
              })}
            </SubCard>
          );
        })()}
      {ownsClass('inventor') &&
        innovationType(subclassOf('inventor')) &&
        (() => {
          const type = innovationType(subclassOf('inventor'))!;
          if (type === 'construct')
            return (
              <SubCard icon="ti-robot" label="Modifications">
                <span className="fixed-val">Construct modifications are described in the innovation text.</span>
              </SubCard>
            );
          const armorStats = type === 'armor' ? build.inventorArmorStats ?? 'power-suit' : undefined;
          const tiers = [
            { key: 'initial', label: 'Initial modification' },
            { key: 'breakthrough', label: 'Breakthrough modification' },
            { key: 'revolutionary', label: 'Revolutionary modification' },
          ] as const;
          return (
            <>
              {type === 'armor' && (
                <SubCard icon="ti-shirt" label="Armor base">
                  <PopupSelect
                    title="Armor base statistics"
                    value={armorStats!}
                    onChange={(v) => actions.patch({ inventorArmorStats: v as 'power-suit' | 'subterfuge-suit' })}
                    options={[
                      { value: 'power-suit', label: 'Power Suit' },
                      { value: 'subterfuge-suit', label: 'Subterfuge Suit' },
                    ]}
                  />
                </SubCard>
              )}
              {tiers.map((t) => {
                if (build.level < INVENTOR_TIER_LEVEL[t.key]) return null;
                const opts = inventorModificationOptions(content, type, armorStats, INVENTOR_TIER_LEVEL[t.key]);
                const cur = build.inventorModifications?.[t.key] ?? '';
                return (
                  <SubCard icon="ti-tool" label={t.label} key={t.key}>
                    <PopupSelect
                      title={t.label}
                      value={opts.some((o) => o.id === cur) ? cur : ''}
                      onChange={(v) =>
                        actions.patch({
                          inventorModifications: { ...(build.inventorModifications ?? {}), [t.key]: v || null },
                        })
                      }
                      options={opts.map((o) => ({ value: o.id, label: o.name, description: o.description, descRefs: o.descRefs }))}
                    />
                    {(() => {
                      const o = opts.find((x) => x.id === cur);
                      return o?.description ? <ChoiceDetails name={o.name} flavor={o.description} descRefs={o.descRefs} /> : null;
                    })()}
                  </SubCard>
                );
              })}
            </>
          );
        })()}
      {ownsClass('kineticist') &&
        (() => {
          const elGroup = classDefOf('kineticist')?.extraChoices?.find((g) => g.id === 'element');
          const thresholds = GATE_THRESHOLD_LEVELS.filter((L) => build.level >= L);
          if (!elGroup || !thresholds.length) return null;
          const base = build.extraChoices['element'] ?? [];
          return thresholds.map((L) => {
            const key = String(L);
            const cur = build.gateForks?.[key] ?? '';
            // Offer elements you don't already have (from the base gate or another threshold's fork).
            const owned = new Set([
              ...base,
              ...Object.entries(build.gateForks ?? {})
                .filter(([k]) => k !== key)
                .map(([, v]) => v),
            ]);
            const opts = elGroup.options.filter((o) => !owned.has(o.id) || o.id === cur);
            return (
              <SubCard icon="ti-flame" label={`Gate's Threshold (L${L})`} key={key}>
                <PopupSelect
                  title="Fork the Path — gain an element"
                  value={cur}
                  onChange={(v) => actions.patch({ gateForks: { ...(build.gateForks ?? {}), [key]: v } })}
                  options={[
                    { value: '', label: '— Expand the Portal (bonus impulse)' },
                    ...opts.map((o) => ({ value: o.id, label: o.name, description: o.description, descRefs: o.descRefs })),
                  ]}
                />
                {(() => {
                  const o = opts.find((x) => x.id === cur);
                  return o?.description ? <ChoiceDetails name={o.name} flavor={o.description} descRefs={o.descRefs} /> : null;
                })()}
                {cur === '' &&
                  (() => {
                    // Expand the Portal grants a bonus impulse feat of your level for one of your elements.
                    const elements = [
                      ...base,
                      ...Object.entries(build.gateForks ?? {})
                        .filter(([k]) => Number(k) <= L)
                        .map(([, v]) => v),
                    ].map((id) => id.replace(/-gate$/, ''));
                    const impulses = Object.values(content.feats)
                      .filter((f) => f.traits.includes('impulse') && f.level <= L && f.traits.some((t) => elements.includes(t)))
                      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
                    return (
                      <div className="ec-subpick">
                        <span className="ec-subpick-label">Bonus impulse</span>
                        <PopupSelect
                          title="Expand the Portal — bonus impulse feat"
                          value={build.gateExpands?.[key] ?? ''}
                          onChange={(v) => actions.patch({ gateExpands: { ...(build.gateExpands ?? {}), [key]: v } })}
                          options={impulses.map((f) => ({ value: f.id, label: `${f.name} (L${f.level})`, description: f.description, descRefs: f.descRefs }))}
                        />
                      </div>
                    );
                  })()}
              </SubCard>
            );
          });
        })()}
      {ownsClass('animist') &&
        (() => {
          const group = classDefOf('animist')?.extraChoices?.find((g) => g.id === 'apparition');
          const attuned = build.extraChoices['apparition'] ?? [];
          if (!group || attuned.length < 2) return null; // a single apparition is automatically primary
          const opts = attuned
            .map((id) => group.options.find((o) => o.id === id))
            .filter(Boolean)
            .map((o) => ({ value: o!.id, label: o!.name, description: o!.description, descRefs: o!.descRefs }));
          const current = attuned.includes(build.primaryApparition ?? '') ? build.primaryApparition! : attuned[0];
          const curOpt = group.options.find((o) => o.id === current);
          return (
            <SubCard icon="ti-star" label="Primary apparition">
              <PopupSelect
                title="Primary apparition"
                value={current}
                onChange={(v) => actions.patch({ primaryApparition: v })}
                options={opts}
              />
              {curOpt?.description ? <ChoiceDetails name={curOpt.name} flavor={curOpt.description} descRefs={curOpt.descRefs} /> : null}
            </SubCard>
          );
        })()}
      {buildNeedsDeity(build, content) && (
        <SetupCard icon="ti-flare" label="Deity">
          <SearchSelect
            bare
            label="Deity"
            value={build.deityId}
            onChange={actions.changeDeity}
            options={Object.values(content.deities).map((d) => ({
              id: d.id,
              name: d.name,
              note: [note(d.rarity), d.domains?.slice(0, 3).join(', ')].filter(Boolean).join(' · ') || undefined,
            }))}
          />
          {(() => {
            const d = build.deityId ? content.deities[build.deityId] : undefined;
            return d?.description ? <ChoiceDetails name={d.name} flavor={d.description} descRefs={d.descRefs} /> : null;
          })()}
        </SetupCard>
      )}
      {/* Summoner Dedication (any class): pick the eidolon type — it grants the eidolon AND sets the
          archetype spell tradition. */}
      {Object.values(build.featPicks).includes('summoner-dedication') &&
        (() => {
          const opts = content.classes.summoner?.subclass?.options ?? [];
          if (!opts.length) return null;
          const cur = opts.find((o) => o.id === build.archetypeEidolonType)?.id ?? '';
          return (
            <SetupCard icon="ti-ghost-2" label="Eidolon (archetype)">
              <PopupSelect
                title="Eidolon type"
                value={cur}
                onChange={(v) => actions.patch({ archetypeEidolonType: v })}
                options={opts.map((o) => ({ value: o.id, label: o.name, description: o.description, descRefs: o.descRefs }))}
              />
              {(() => {
                const o = opts.find((x) => x.id === cur);
                return o?.description ? <ChoiceDetails name={o.name} flavor={o.description} descRefs={o.descRefs} /> : null;
              })()}
            </SetupCard>
          );
        })()}
      {/* Two casters: a caster CLASS that also took a caster Dedication picks the archetype pool's
          tradition / key / cantrips here; its leveled spells are prepared on the Spells tab. */}
      {cls?.spellcasting &&
        (() => {
          const arch = activeCasterArchetype(Object.values(build.featPicks).filter((v): v is string => !!v));
          if (!arch) return null;
          const as = build.archetypeSpells ?? { cantrips: [], spells: {}, tradition: null, keyAbility: null };
          const trad = (arch.config.choiceTradition ? as.tradition : arch.config.tradition) ?? arch.config.tradition;
          const cantripList = Object.values(content.spells)
            .filter((s) => s.rank === 0 && s.traditions.includes(trad))
            .sort((a, b) => a.name.localeCompare(b.name));
          return (
            <SetupCard icon="ti-wand" label="Archetype spellcasting">
              {arch.config.choiceTradition && (
                <SubCard icon="ti-versions" label="Tradition">
                  <div className="spr-chips">
                    {(arch.config.traditionOptions ?? (['arcane', 'divine', 'occult', 'primal'] as const)).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={'inv-toggle' + (trad === t ? ' on' : '')}
                        onClick={() => actions.setArchetypePoolTradition(t)}
                      >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </SubCard>
              )}
              {arch.config.choiceKeyAbility && (
                <SubCard icon="ti-rosette" label="Key attribute">
                  <div className="spr-chips">
                    {arch.config.choiceKeyAbility.map((a) => (
                      <button
                        key={a}
                        type="button"
                        className={'inv-toggle' + ((as.keyAbility ?? arch.config.keyAbility) === a ? ' on' : '')}
                        onClick={() => actions.setArchetypePoolKey(a)}
                      >
                        {a.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </SubCard>
              )}
              <SubCard icon="ti-sparkles" label={`Cantrips (${as.cantrips.length}/${arch.config.cantrips})`}>
                <PopupSelect
                  title="Add a cantrip"
                  value=""
                  onChange={(v) => v && actions.toggleArchetypeCantrip(v, arch.config.cantrips)}
                  options={cantripList.map((s) => ({ value: s.id, label: s.name, description: s.description, descRefs: s.descRefs }))}
                />
                {as.cantrips.length > 0 && (
                  <div className="spr-chips" style={{ marginTop: 6 }}>
                    {as.cantrips.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="ec-chip on"
                        onClick={() => actions.toggleArchetypeCantrip(id, arch.config.cantrips)}
                      >
                        {content.spells[id]?.name ?? id} ✕
                      </button>
                    ))}
                  </div>
                )}
                <div className="bsec-note">Prepare leveled archetype spells on the Spells tab.</div>
              </SubCard>
            </SetupCard>
          );
        })()}
      {(cls?.features ?? []).some((f) => f.featureId === 'devotion-spells') && (
        <SetupCard icon="ti-sparkles" label="Devotion spell">
          <PopupSelect
            title="Devotion spell"
            value={build.devotionSpell ?? championDevotionSpell(cls, build, content) ?? ''}
            onChange={(v) => actions.patch({ devotionSpell: v || null })}
            options={championDevotionOptions(build, content).map((id) => ({
              value: id,
              label: content.spells[id]?.name ?? id,
              description: content.spells[id]?.description,
              descRefs: content.spells[id]?.descRefs,
            }))}
          />
          {(() => {
            const id = build.devotionSpell ?? championDevotionSpell(cls, build, content);
            const sp = id ? content.spells[id] : undefined;
            return sp?.description ? <ChoiceDetails name={sp.name} flavor={sp.description} descRefs={sp.descRefs} /> : null;
          })()}
        </SetupCard>
      )}
      {(cls?.features ?? []).some((f) => f.featureId === 'voice-of-nature') && (
        <SetupCard icon="ti-leaf" label="Voice of Nature">
          <PopupSelect
            title="Voice of Nature"
            value={build.voiceOfNature ?? 'animal-empathy'}
            onChange={(v) => actions.patch({ voiceOfNature: v || null })}
            options={[
              { value: 'animal-empathy', label: content.feats['animal-empathy']?.name ?? 'Animal Empathy', description: content.feats['animal-empathy']?.description, descRefs: content.feats['animal-empathy']?.descRefs },
              { value: 'plant-empathy', label: content.feats['plant-empathy']?.name ?? 'Plant Empathy', description: content.feats['plant-empathy']?.description, descRefs: content.feats['plant-empathy']?.descRefs },
            ]}
          />
          {(() => {
            const f = content.feats[build.voiceOfNature ?? 'animal-empathy'];
            return f?.description ? <ChoiceDetails name={f.name} flavor={f.description} descRefs={f.descRefs} /> : null;
          })()}
        </SetupCard>
      )}
      {pendingClass != null && (
        <div className="picker-overlay" onClick={() => setPendingClass(null)}>
          <div className="picker confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span>
                <i className="ti ti-alert-triangle" aria-hidden="true" /> Change class?
              </span>
              <button className="picker-close" onClick={() => setPendingClass(null)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <div className="confirm-body">
              <p>
                Switching to <strong>{content.classes[pendingClass]?.name ?? 'this class'}</strong> clears your class
                feats, class skills, and any chosen spells &amp; cantrips — these are tied to {build.classId ? content.classes[build.classId]?.name ?? 'your current class' : 'your current class'}.
              </p>
              <p>Attribute boosts and other origin choices are kept.</p>
            </div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setPendingClass(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  actions.changeClass(pendingClass);
                  setPendingClass(null);
                }}
              >
                Change class
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function AttributeEditor({ build, actions }: EditorProps) {
  // Origin/class boosts now nest under their own cards (see OriginPickers). What remains here is
  // the level-1 free boosts, which aren't tied to any one origin.
  return (
    <SetupCard icon="ti-arrow-up" label="Free boosts" count="4">
      {build.levelBoosts.map((v, i) => (
        <AbilitySelect
          key={i}
          value={v}
          options={ABILITIES}
          exclude={build.levelBoosts}
          onChange={(val) => actions.setBoost('levelBoosts', i, val)}
        />
      ))}
    </SetupCard>
  );
}

/** `lore:warfare` -> "Warfare Lore"; a bare subject slug -> "Subject Lore". */
export function loreLabel(key: string): string {
  const subject = (key.startsWith('lore:') ? key.slice(5) : key)
    .split('-')
    .filter(Boolean)
    .map(cap)
    .join(' ');
  return subject ? `${subject} Lore` : 'Lore';
}

/** "Warfare", "Sailing Lore", "underworld" -> a canonical `lore:<slug>` key (or null if empty). */
export function loreKey(raw: string): ProficiencyKey | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/\blore\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? (`lore:${slug}` as ProficiencyKey) : null;
}

/** A filled level-0 pick shown as a feat-style slot-card (icon tile + label + value), with an
 *  optional clear button — the static counterpart to PopupSelect's `variant="card"`. */
function SlotCard({ icon, label, value, onClear }: { icon: string; label: string; value: string; onClear?: () => void }) {
  return (
    <div className="lvl-slot-wrap">
      <div className="lvl-slot">
        <div className="lvl-card lvl-card-static">
          <span className="lvl-card-icon">
            <i className={'ti ' + icon} aria-hidden="true" />
          </span>
          <div className="lvl-card-text">
            <div className="lvl-card-label">{label}</div>
            <div className="lvl-card-val">{value}</div>
          </div>
        </div>
        {onClear && (
          <button className="lvl-clear-btn" type="button" aria-label={`Remove ${value}`} onClick={onClear}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export function SkillEditor({ build, actions, content }: EditorProps) {
  const cls = build.classId ? content.classes[build.classId] : undefined;
  const background = build.backgroundId ? content.backgrounds[build.backgroundId] : undefined;
  const subOption = cls?.subclass?.options.find((o) => o.id === build.subclassId);
  const addlCount = additionalClassSkills(build, content);
  const locked = new Set<string>();
  if (cls) cls.trainedSkills.fixed.forEach((s) => locked.add(s));
  if (background?.trainedSkill) locked.add(background.trainedSkill);
  subOption?.grants?.skills?.forEach((s) => locked.add(s));
  // A heritage-granted skill (Skilled human) is locked too — chosen via its own picker,
  // not consumable as a class pick (matches toggleSkill's locked set).
  if (build.heritageSkill) locked.add(build.heritageSkill);

  // Count only picks NOT already granted (a class skill that a later subclass/background
  // also grants shouldn't consume a pick or double-count toward the cap).
  const chosen = build.classSkills.filter((s) => !locked.has(s));
  const chosenSkills = chosen.filter((k) => !k.startsWith('lore:'));
  const chosenLores = chosen.filter((k) => k.startsWith('lore:'));
  const available = SKILLS.filter((s) => !locked.has(s) && !build.classSkills.includes(s));

  const addLore = (text: string) => {
    const key = loreKey(text);
    if (key && !build.classSkills.includes(key)) actions.toggleSkill(key);
  };

  const emptyCount = Math.max(0, addlCount - chosen.length);
  return (
    <SetupCard icon="ti-list-check" label="Trained skills" count={`${chosen.length} / ${addlCount}`}>
      {chosenSkills.map((s) => (
        <SlotCard key={s} icon="ti-list-check" label="Skill" value={cap(s)} onClear={() => actions.toggleSkill(s)} />
      ))}
      {chosenLores.map((k) => (
        <SlotCard key={k} icon="ti-book-2" label="Lore" value={loreLabel(k)} onClear={() => actions.toggleSkill(k)} />
      ))}
      {Array.from({ length: emptyCount }).map((_, i) => (
        <div className="lvl-slot-wrap" key={'add' + i}>
          <div className="lvl-slot">
            <PopupSelect
              variant="card"
              cardLabel="Skill"
              icon="ti-list-check"
              title="Add a trained skill"
              placeholder="Choose…"
              value=""
              onChange={(v) => {
                if (v) actions.toggleSkill(v as ProficiencyKey);
              }}
              options={available.map((s) => ({ value: s, label: cap(s) }))}
              addCustom={{ label: 'Learn a new lore', placeholder: 'Lore subject (e.g. Warfare)…', onAdd: addLore }}
            />
          </div>
        </div>
      ))}
    </SetupCard>
  );
}

export function LanguageEditor({ build, actions, content }: EditorProps) {
  const ancestry = build.ancestryId ? content.ancestries[build.ancestryId] : undefined;
  const granted = ancestry?.languages.granted ?? [];
  const slots = bonusLanguageSlots(build, content);
  const chosen = build.languages.filter((l) => !granted.includes(l));
  // Level 0 only shows the bonus languages you pick here; languages you already know (granted by
  // ancestry/Int) live in the side rail. No bonus slots → nothing to pick → hide the card.
  if (slots === 0) return null;
  const available = Object.values(content.languages)
    .filter((l) => !granted.includes(l.id) && !chosen.includes(l.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <SetupCard icon="ti-language" label="Languages" count={`${chosen.length}/${slots} bonus`}>
      {chosen.map((id) => (
        <SlotCard
          key={id}
          icon="ti-language"
          label="Language"
          value={content.languages[id]?.name ?? cap(id)}
          onClear={() => actions.toggleLanguage(id)}
        />
      ))}
      {Array.from({ length: Math.max(0, slots - chosen.length) }).map((_, i) => (
        <div className="lvl-slot-wrap" key={'add' + i}>
          <div className="lvl-slot">
            <PopupSelect
              variant="card"
              cardLabel="Language"
              icon="ti-language"
              title="Add a language"
              placeholder="Choose…"
              value=""
              onChange={(v) => {
                if (v) actions.toggleLanguage(v);
              }}
              options={available.map((l) => ({ value: l.id, label: l.name }))}
            />
          </div>
        </div>
      ))}
    </SetupCard>
  );
}

/** One derived-stat row in the summary rail: an optional proficiency-rank pill, a label, and
 *  the value. When `onOpenStat` + `refTarget` are supplied the row is clickable and opens the
 *  same calculation breakdown the character sheet uses. */
function StatLine({
  label,
  value,
  rank,
  refTarget,
  onOpenStat,
}: {
  label: string;
  value: ReactNode;
  rank?: ProficiencyRank;
  refTarget?: StatRef;
  onOpenStat?: (ref: StatRef) => void;
}) {
  const clickable = !!(refTarget && onOpenStat);
  return (
    <div
      className={'brow' + (clickable ? ' brow-open' : '')}
      onClick={clickable ? () => onOpenStat!(refTarget!) : undefined}
      title={clickable ? `${label} — how is this calculated?` : undefined}
    >
      <span className="bk">
        {rank && <RankPill rank={rank} />}
        <span className="bk-text">{label}</span>
      </span>
      <span className="bv">{value}</span>
    </div>
  );
}

export function LiveStats({
  build,
  content,
  onOpenStat,
  character,
}: {
  build: BuildState;
  content: ContentDatabase;
  onOpenStat?: (ref: StatRef) => void;
  /** Precomputed built character — pass it to avoid re-running the buildCharacter pipeline. */
  character?: Character;
}) {
  const preview = useMemo(() => character ?? buildCharacter(build, content), [character, build, content]);
  const ac = deriveAc(preview, content);
  const perception = derivePerception(preview);
  const classDc = deriveClassDc(preview);
  const entry = preview.spellcasting[0];
  const spell = entry ? deriveSpellcasting(preview, entry) : null;
  return (
    <>
      <div className="brow">
        <span className="bk">{preview.name || 'New character'}</span>
        <span className="bv">Lv {preview.level}</span>
      </div>
      <StatLine label="Hit points" value={deriveMaxHp(preview, content)} refTarget={{ kind: 'hp' }} onOpenStat={onOpenStat} />
      <StatLine label="Armor class" value={ac.value} rank={ac.rank} refTarget={{ kind: 'ac' }} onOpenStat={onOpenStat} />
      <StatLine
        label="Perception"
        value={formatMod(perception.modifier)}
        rank={perception.rank}
        refTarget={{ kind: 'perception' }}
        onOpenStat={onOpenStat}
      />
      {(['fortitude', 'reflex', 'will'] as const).map((s) => {
        const d = deriveSave(preview, s, content);
        return (
          <StatLine
            key={s}
            label={cap(s)}
            value={formatMod(d.modifier)}
            rank={d.rank}
            refTarget={{ kind: 'save', save: s }}
            onOpenStat={onOpenStat}
          />
        );
      })}
      <StatLine label="Class DC" value={classDc.dc} rank={classDc.rank} refTarget={{ kind: 'classDc' }} onOpenStat={onOpenStat} />
      {spell && entry && (
        <>
          <StatLine
            label="Spell DC"
            value={spell.dc}
            rank={entry.proficiency}
            refTarget={{ kind: 'spell', entryId: entry.id, which: 'dc' }}
            onOpenStat={onOpenStat}
          />
          <StatLine
            label="Spell attack"
            value={formatMod(spell.attack)}
            rank={entry.proficiency}
            refTarget={{ kind: 'spell', entryId: entry.id, which: 'attack' }}
            onOpenStat={onOpenStat}
          />
        </>
      )}
    </>
  );
}

/** Comprehensive stats sidebar: ability scores + all the basic derived stats. */
const skillName = (k: ProficiencyKey) => (k.startsWith('lore:') ? loreLabel(k) : cap(k));

export function FullStats({ build, content, character }: { build: BuildState; content: ContentDatabase; character?: Character }) {
  const [statRef, setStatRef] = useState<StatRef | null>(null);
  const abilities = computeAbilities(build, content);
  const preview = useMemo(() => character ?? buildCharacter(build, content), [character, build, content]);
  const speed = deriveSpeeds(preview, content).land ?? 0;
  const trainedSkills = (Object.keys(preview.proficiencies.skills) as ProficiencyKey[])
    .filter((k) => preview.proficiencies.skills[k] !== 'untrained')
    .sort((a, b) => skillName(a).localeCompare(skillName(b)));
  return (
    <>
      <div className="fs-abil">
        {ABILITIES.map((ab) => (
          <div
            className="fs-ab fs-ab-open"
            key={ab}
            onClick={() => setStatRef({ kind: 'ability', ability: ab })}
            title={`${ABILITY_LABEL[ab]} — how is this calculated?`}
          >
            <div className="fs-an">{ABILITY_LABEL[ab]}</div>
            <div className="fs-av">{abilities[ab]}</div>
            <div className="fs-am">{formatMod(abilityMod(abilities[ab]))}</div>
          </div>
        ))}
      </div>
      <LiveStats build={build} content={content} onOpenStat={setStatRef} character={preview} />
      <StatLine label="Speed" value={`${speed} ft`} refTarget={{ kind: 'speed' }} onOpenStat={setStatRef} />

      <div className="fs-sec">Trained skills</div>
      {trainedSkills.length ? (
        trainedSkills.map((k) => {
          const d = deriveSkill(preview, k, content);
          return (
            <StatLine
              key={k}
              label={skillName(k)}
              value={formatMod(d.modifier)}
              rank={d.rank}
              refTarget={{ kind: 'skill', skill: k }}
              onOpenStat={setStatRef}
            />
          );
        })
      ) : (
        <div className="fs-none">None yet</div>
      )}

      <div className="fs-sec">Weapon proficiency</div>
      <div className="fs-profrow">
        {(['simple', 'martial', 'advanced', 'unarmed'] as const).map((c) => (
          <span className="fs-prof" key={c}>
            {cap(c)} <RankPill rank={preview.proficiencies.attacks[c]} />
          </span>
        ))}
      </div>

      <div className="fs-sec">Armor proficiency</div>
      <div className="fs-profrow">
        {(['unarmored', 'light', 'medium', 'heavy'] as const).map((c) => (
          <span className="fs-prof" key={c}>
            {cap(c)} <RankPill rank={preview.proficiencies.defenses[c]} />
          </span>
        ))}
      </div>

      <div className="fs-sec">Languages</div>
      <div className="fs-profrow">
        {preview.languages.length ? (
          preview.languages.map((id) => (
            <span className="fs-prof" key={id}>
              {content.languages[id]?.name ?? cap(id)}
            </span>
          ))
        ) : (
          <div className="fs-none">None</div>
        )}
      </div>

      {statRef && (
        <StatDetailModal
          breakdown={explainStat(preview, content, statRef, build)}
          character={preview}
          content={content}
          onClose={() => setStatRef(null)}
        />
      )}
    </>
  );
}
