import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { AbilityId, BuildOverrides, Character, CharacterOptions, ChoiceGroup, ClassDef, CompanionConfig, ContentDatabase, CustomBackground, DescRef, MonsterPartsMode, ProficiencyKey, ProficiencyRank, SaveId, SkillId, Tradition } from '../rules/types';
import { ABILITIES, SKILLS, PROFICIENCY_RANKS } from '../rules/types';
import { enabledBookSet, sourceCatalog, NICHE_CATEGORIES, type SourceGroup } from '../rules/sources';
import { usePrefs } from '../data/prefs';
import { loadHomebrewSources, loadCampaigns, saveCampaigns } from '../data/storage';
import { useAuth } from '../data/useAuth';
import { fetchCampaignByCode, type CampaignMembership } from '../data/campaigns';
import { confirmDialog } from '../sheet/confirm';
import {
  type BuildState,
  CUSTOM_BACKGROUND_ID,
  additionalClassSkills,
  backgroundTrainedSkill,
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
          heritageFeatId: null,
          languages: [],
          featPicks,
          featChoices,
        };
      });
    },
    changeHeritage(id) {
      // A new heritage may not grant a trained skill / a bonus feat, so drop any stale picks.
      patch({ heritageId: id, heritageSkill: null, heritageFeatId: null });
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
      // A different background's skill choice no longer applies — clear the stale pick.
      patch({ backgroundId: id, backgroundBoosts: slots.map(() => null), backgroundSkillChoice: null });
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
        const bgSkill = backgroundTrainedSkill(b, bg);
        if (bgSkill) locked.add(bgSkill);
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
      clearLabel="Clear"
      options={options.map((o) => ({ value: o, label: ABILITY_LABEL[o], disabled: o !== value && !!exclude?.includes(o) }))}
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
  clearLabel,
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
  /** Offer a "clear the current selection" ACTION (calls onChange('')). Renders as a pinned row
   *  below the option list — separator above, dimmed with an ✕ icon — so it reads as an action,
   *  not another option. Only shown while something is selected. Replaces the old pattern of a
   *  `{ value: '', label: '— none —' }` entry styled like a real option. */
  clearLabel?: string;
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
                {clearLabel && current && (
                  <button
                    type="button"
                    className="picker-clear"
                    onClick={() => {
                      onChange('');
                      close();
                    }}
                  >
                    <i className="ti ti-x" aria-hidden="true" /> {clearLabel}
                    <span className="picker-clear-cur">{current.label}</span>
                  </button>
                )}
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
              clearLabel="Clear"
              options={ABILITIES.map((ab) => ({ value: ab, label: ab.toUpperCase(), disabled: cb.boosts[1 - i] === ab }))}
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
            clearLabel="Clear"
            options={SKILLS.map((s) => ({ value: s, label: capSkill(s) }))}
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

/** Per-character SELECTIONS that a Setup toggle unlocks, made here on the Level 0 (character-creation)
 *  page rather than in Setup: the Dual Class second class/subclass, ABP skill potency + attribute apex,
 *  and the Mythic Calling. The on/off toggles stay in Setup (Variant Rules / Campaign cards); this
 *  renders only when at least one such toggle is on. Reads/writes the same build state as before, so a
 *  character configured under the old (Setup-side) UI shows its choice unchanged. */
export function SetupUnlockedChoices({ build, actions, content }: EditorProps) {
  const dualClass = !!build.variantRules?.dualClass;
  const abp = !!build.variantRules?.abp;
  const mythic = !!build.mythicEnabled;
  if (!dualClass && !abp && !mythic) return null;
  const cls2 = build.classId2 ? content.classes[build.classId2] : undefined;
  const calling = build.mythicCalling ? content.classFeatures[build.mythicCalling] : undefined;
  return (
    <>
      {dualClass && (
        <SetupCard icon="ti-versions" label="Dual Class — second class">
          <PopupSelect
            title="Second class"
            value={build.classId2 ?? ''}
            onChange={(v) => actions.setSecondClass(v || null)}
            clearLabel="Clear — no second class"
            options={Object.values(content.classes)
              .filter((cl) => cl.id !== build.classId)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((cl) => ({ value: cl.id, label: cl.name, description: cl.description, descRefs: cl.descRefs }))}
          />
          {cls2?.description && <ChoiceDetails name={cls2.name} flavor={cls2.description} descRefs={cls2.descRefs} />}
          {cls2?.subclass && (
            <PopupSelect
              title={cls2.subclass.name}
              value={build.subclassId2 ?? ''}
              onChange={(v) => actions.patch({ subclassId2: v || null })}
              clearLabel="Clear"
              options={cls2.subclass.options.map((o) => ({ value: o.id, label: o.name, description: o.description, descRefs: o.descRefs }))}
            />
          )}
        </SetupCard>
      )}
      {abp && (
        <SetupCard icon="ti-star" label="Automatic Bonus Progression">
          <AbpPotencyEditor build={build} actions={actions} />
          {build.level >= 17 && (
            <SubCard icon="ti-rosette" label="Attribute apex (level 17)">
              <AbilitySelect value={build.abpApex ?? null} options={ABILITIES} onChange={(v) => actions.setAbpApex(v)} />
            </SubCard>
          )}
        </SetupCard>
      )}
      {mythic && (
        <SetupCard icon="ti-flame" label="Mythic Calling">
          <PopupSelect
            title="Mythic Calling"
            value={build.mythicCalling ?? ''}
            onChange={(v) => actions.patch({ mythicCalling: v || null })}
            clearLabel="Clear"
            options={Object.values(content.classFeatures)
              .filter((f) => (f.traits ?? []).includes('calling'))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((f) => ({ value: f.id, label: f.name, description: f.description, descRefs: f.descRefs }))}
          />
          {calling?.description && <ChoiceDetails name={calling.name} flavor={calling.description} descRefs={calling.descRefs} />}
          <p className="setup-hint">You gain a mythic feat slot at every even level (2–20), fillable with mythic feats.</p>
        </SetupCard>
      )}
    </>
  );
}

/** A small "i" info affordance that opens a pinnable description popup for a Setup rule/toggle.
 *  Sits next to a toggle chip; reuses the app's DescriptionModal (so the popup gets the pin star). */
export function RuleInfo({ title, description }: { title: string; description: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="rule-info"
        aria-label={`About ${title}`}
        title={`About ${title}`}
        onClick={() => setOpen(true)}
      >
        <i className="ti ti-info-circle" aria-hidden="true" />
      </button>
      {open && <DescriptionModal root={{ title, description, key: 'setupRules' }} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A toggle chip paired with its "i" info button, wrapped so the pair wraps together. */
function ToggleWithInfo({
  label,
  description,
  on,
  onToggle,
  className,
  children,
}: {
  label: string;
  description: string;
  on: boolean;
  onToggle: () => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span className="rule-toggle">
      <button type="button" className={'inv-toggle' + (className ? ' ' + className : '') + (on ? ' on' : '')} onClick={onToggle}>
        {children ?? label}
      </button>
      <RuleInfo title={label} description={description} />
    </span>
  );
}

/** The optional-variant-rules toggles (Ancestry Paragon, ABP, Dual Class, …). Lives on the builder's
 *  Setup page. Their dependent per-character SELECTIONS (the second class/subclass, ABP skill potency
 *  / apex) are made on the Level 0 page — see SetupUnlockedChoices — so only the on/off toggle is here. */
export function VariantRulesCard({ build, actions }: EditorProps) {
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
            ['monsterParts', 'Monster Parts', 'Harvest parts from defeated monsters to refine (fundamental-rune-equivalent bonuses) and imbue (special properties) your weapons, armor, shields, and Perception/skill items in place of runes and precious materials. An item uses either Monster Parts or normal runes — never both.'],
          ] as const
        ).map(([flag, label, desc]) => (
          <ToggleWithInfo
            key={flag}
            label={label}
            description={desc}
            on={!!build.variantRules?.[flag]}
            onToggle={() => actions.patch({ variantRules: { ...build.variantRules, [flag]: !build.variantRules?.[flag] } })}
          />
        ))}
      </div>
      {build.variantRules?.monsterParts && <MonsterPartsModeSelect build={build} actions={actions} />}
    </SetupCard>
  );
}

/** The Full / Light / Hybrid GM-variant selector for Monster Parts (shown when the toggle is on). The
 *  choice is mostly informational — the per-item refine/imbue math is identical across all three; it
 *  drives the treasure-by-level reference guidance only. */
function MonsterPartsModeSelect({ build, actions }: Pick<EditorProps, 'build' | 'actions'>) {
  const mode = build.variantRules?.monsterPartsMode ?? 'hybrid';
  const modes: { id: MonsterPartsMode; label: string; desc: string }[] = [
    { id: 'full', label: 'Full', desc: 'Replaces nearly all wealth with monster parts.' },
    { id: 'light', label: 'Light', desc: 'Replaces only currency; runes and other magic items still exist.' },
    { id: 'hybrid', label: 'Hybrid', desc: 'Replaces currency + about half of the permanent items; keeps the rest and all consumables.' },
  ];
  return (
    <div className="mp-mode-select" style={{ marginTop: 8 }}>
      <div className="spr-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span>Treasure variant</span>
        <RuleInfo
          title="Monster Parts variant"
          description="Full: replaces nearly all wealth with monster parts. Light: replaces only currency; runes and other magic items still exist (the party builds only a few part-items). Hybrid: replaces currency + about half of the permanent items; keeps the rest and all consumables. This choice only affects the treasure-by-level reference guidance — the refine/imbue math is identical across all three."
        />
      </div>
      <div className="seg" role="radiogroup" aria-label="Monster Parts variant">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            className={'seg-btn' + (mode === m.id ? ' on' : '')}
            title={m.desc}
            onClick={() => actions.patch({ variantRules: { ...build.variantRules, monsterPartsMode: m.id } })}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Campaigns, in a character's Setup. This is where PLAYERS join a campaign — enter the code your GM
 *  shared — and where any character is attached to campaigns it's in (so it shows in that party and
 *  publishes to teammates). Joining offers to start the character from the campaign's default rules.
 *  Hidden for local / not-signed-in users (no campaigns for them). */
export function CampaignAttachCard({ build, actions }: EditorProps) {
  const auth = useAuth();
  const [memberships, setMemberships] = useState<CampaignMembership[]>(() => loadCampaigns());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Local / not signed in and not already in any campaign → nothing to show.
  if (auth.status !== 'signed-in' && memberships.length === 0) return null;

  const attached = new Set(build.campaignIds ?? []);
  const toggle = (id: string) => {
    const next = new Set(attached);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    actions.patch({ campaignIds: [...next] });
  };

  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const res = await fetchCampaignByCode(code);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const c = res.value;
    if (!memberships.some((m) => m.id === c.id)) {
      const next: CampaignMembership[] = [
        ...memberships,
        { id: c.id, code: c.code, role: 'player', name: c.name, description: c.description },
      ];
      setMemberships(next);
      saveCampaigns(next);
    }
    actions.patch({ campaignIds: [...new Set([...(build.campaignIds ?? []), c.id])] });
    setCode('');
    const d = c.defaults;
    // Only prompt when the GM actually configured something. An empty variantRules object is truthy but
    // meaningless — treating it as "has defaults" would nag on every join and (if accepted) wipe the
    // player's own pre-join variant-rule toggles with an empty set.
    const hasDefaults =
      !!d &&
      ((!!d.variantRules && Object.keys(d.variantRules).length > 0) ||
        (!!d.enabledSources && d.enabledSources.length > 0) ||
        !!d.mythicEnabled ||
        !!d.kingmakerEnabled);
    if (hasDefaults) {
      const use = await confirmDialog({
        title: `Use ${c.name}’s default rules?`,
        message: 'Start this character from the campaign’s default variant rules and source books. You can still change anything afterwards.',
        confirmLabel: 'Use defaults',
      });
      if (use) {
        actions.patch({
          variantRules: { ...(d!.variantRules ?? {}) },
          enabledSources: d!.enabledSources,
          mythicEnabled: !!d!.mythicEnabled,
          kingmakerEnabled: !!d!.kingmakerEnabled,
        });
      }
    }
  };

  return (
    <SetupCard icon="ti-users" label="Campaigns">
      {memberships.length > 0 && (
        <>
          <div className="spr-sub" style={{ marginBottom: 6 }}>Attach this character to a campaign so it appears in that party.</div>
          <div className="spr-chips">
            {memberships.map((m) => (
              <ToggleWithInfo
                key={m.id}
                label={m.name}
                description={m.role === 'gm' ? 'You run this campaign — your character joins its party.' : 'You play in this campaign — your character joins its party.'}
                on={attached.has(m.id)}
                onToggle={() => toggle(m.id)}
              />
            ))}
          </div>
        </>
      )}
      <div className="cmp-join-row">
        <span className="spr-sub">Join a campaign — enter the code from your GM:</span>
        <div className="cmp-join-input">
          <input
            className="hb-input"
            value={code}
            placeholder="ABC234"
            maxLength={12}
            aria-label="Campaign code"
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
              if (error) setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void join();
            }}
          />
          <button className="btn" disabled={busy || !code.trim()} onClick={() => void join()}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
        {error && <p className="login-error" role="alert" style={{ marginTop: 6 }}>{error}</p>}
      </div>
    </SetupCard>
  );
}

/** Campaign content toggles (Mythic, Kingmaker) — top-level build flags that show/hide their content.
 *  The dependent Mythic Calling SELECTION is made on the Level 0 page (see SetupUnlockedChoices); only
 *  the on/off toggle lives here. */
export function CampaignOptionsCard({ build, actions }: EditorProps) {
  return (
    <SetupCard icon="ti-flag" label="Campaign">
      <div className="spr-chips">
        {(
          [
            ['mythicEnabled', 'Mythic', 'War of Immortals mythic rules: gain a mythic calling + destiny, mythic feats, and mythic points. Off hides all mythic-trait content.'],
            ['kingmakerEnabled', 'Kingmaker', 'Show the Kingmaker Adventure Path content — its kingdom actions and conditions.'],
          ] as const
        ).map(([flag, label, desc]) => (
          <ToggleWithInfo
            key={flag}
            label={label}
            description={desc}
            on={!!build[flag]}
            onToggle={() => actions.patch({ [flag]: !build[flag] })}
          />
        ))}
      </div>
    </SetupCard>
  );
}

/**
 * "Overrides" — the creative/freeform editing section. Lets the user deliberately break the rules in
 * SPECIFIC, explicit cases (no global "ignore everything" switch): take a feat you don't qualify for
 * (recorded inline from the feat picker's "Take anyway"), grant a bonus feat with no slot, or remove
 * a feat the rules auto-granted. Each bent rule shows as a removable chip so it stays visible.
 * Authoring brand-new content (homebrew feats/options) is intentionally a separate future section.
 */
// Proficiency tracks the user can override, in display order (skills appended below).
const PROF_TRACKS: { key: string; name: string }[] = [
  { key: 'perception', name: 'Perception' },
  { key: 'classDc', name: 'Class DC' },
  { key: 'fortitude', name: 'Fortitude save' },
  { key: 'reflex', name: 'Reflex save' },
  { key: 'will', name: 'Will save' },
  { key: 'unarmed', name: 'Unarmed attacks' },
  { key: 'simple', name: 'Simple weapons' },
  { key: 'martial', name: 'Martial weapons' },
  { key: 'advanced', name: 'Advanced weapons' },
  { key: 'unarmored', name: 'Unarmored defense' },
  { key: 'light', name: 'Light armor' },
  { key: 'medium', name: 'Medium armor' },
  { key: 'heavy', name: 'Heavy armor' },
];
const profTrackName = (key: string) =>
  PROF_TRACKS.find((t) => t.key === key)?.name ?? (key.startsWith('lore:') ? `${cap(key.slice(5))} Lore` : cap(key));

/** Per-character source books: enable/disable books (default = the four Core books) so the builder
 *  pickers only offer content from the books you allow. Already-chosen content is always kept. */
export function SourcesCard({ build, actions, catalog }: { build: BuildState; actions: BuilderActions; catalog: ReturnType<typeof sourceCatalog> }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Live filter for the (long) book list — a draft filter, not a committed value, so filter-as-you-type.
  const [search, setSearch] = useState('');
  const toggleCat = (c: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  const prefs = usePrefs();
  const enabled = enabledBookSet(build.enabledSources);
  const allBooks = catalog.allBooks;
  // User homebrew Sources (toggled by their name, which is the entries' source.book). List every source
  // the player has created — even empty ones — with how many entries each holds.
  const hbList = useMemo(() => {
    const byName = new Map(catalog.homebrew.map((h) => [h.name, h.count]));
    return Object.values(loadHomebrewSources())
      .map((src) => ({ name: src.name, count: byName.get(src.name) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog.homebrew]);
  const enabledReal = allBooks.filter((b) => enabled.has(b)).length;
  const hbOnCount = hbList.filter((h) => enabled.has(h.name)).length;
  const hbAllOn = hbList.length > 0 && hbOnCount === hbList.length;
  // While searching, force every group open so matches are visible without manual expansion.
  // The niche "Other" shelf (Society scenarios, blogs, specials) stays hidden unless the pref is on.
  // The reveal toggle itself lives in Settings → Customization → Sources (not here in Setup).
  const rawGroups = prefs.showNicheSources ? catalog.groups : catalog.groups.filter((g) => !NICHE_CATEGORIES.has(g.category));
  // Live name filter: match a category or any of its entry labels; keep only matching entries within.
  const sq = search.trim().toLowerCase();
  const groups = sq
    ? rawGroups
        .map((g) => {
          if (g.category.toLowerCase().includes(sq)) return g; // whole category matches → show all entries
          const entries = g.entries.filter((e) => e.label.toLowerCase().includes(sq));
          return entries.length ? { ...g, entries } : null;
        })
        .filter((g): g is SourceGroup => g != null)
    : rawGroups;
  const hbShown = sq ? hbList.filter((h) => h.name.toLowerCase().includes(sq)) : hbList;
  const noMatches = sq !== '' && groups.length === 0 && hbShown.length === 0;
  // Searching forces sections open so matches show without manual expansion.
  const hbOpen = sq !== '' || expanded.has('__homebrew__');
  const write = (next: Set<string>) => actions.patch({ enabledSources: [...next].sort() });
  const setBooks = (books: string[], on: boolean) => {
    const n = new Set(enabled);
    for (const b of books) on ? n.add(b) : n.delete(b);
    write(n);
  };
  const setCategory = (g: SourceGroup, on: boolean) => setBooks(g.entries.flatMap((e) => e.books), on);
  return (
    <SetupCard icon="ti-books" label="Sources" count={`${enabledReal}/${allBooks.length}`}>
      <div className="src-wrap">
        <p className="ovr-intro">
          Choose which books this character can draw from. Disabled books are hidden from every picker — anything you've
          already selected stays available even if its book is off. New characters start with the Core books only.
        </p>
        <div className="src-actions">
        <button type="button" className="src-act" onClick={() => write(new Set([...allBooks, ...hbList.map((h) => h.name)]))}>
          Enable everything
        </button>
        <button type="button" className="src-act" onClick={() => actions.patch({ enabledSources: undefined })}>
          Core only
        </button>
        <button type="button" className="src-act" onClick={() => write(new Set())}>
          Disable all
        </button>
      </div>
      <div className="src-search">
        <i className="ti ti-search" aria-hidden="true" />
        <input
          type="text"
          placeholder="Search books"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button type="button" className="src-search-x" aria-label="Clear search" onClick={() => setSearch('')}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        )}
      </div>
      {noMatches && <div className="src-no-match">No books match “{search.trim()}”.</div>}
      {hbShown.length > 0 && (
        <div className="src-cat">
          <div className="src-cat-head">
            <button type="button" className="src-cat-name" aria-expanded={hbOpen} onClick={() => toggleCat('__homebrew__')}>
              <i className={'ti ' + (hbOpen ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
              <i className="ti ti-flask" aria-hidden="true" /> Homebrew
              <span className="src-count">
                {hbOnCount}/{hbList.length}
              </span>
            </button>
            <button
              type="button"
              className={'src-check' + (hbAllOn ? ' on' : hbOnCount > 0 ? ' partial' : '')}
              title={hbAllOn ? 'Turn all homebrew off' : 'Turn all homebrew on'}
              aria-label={hbAllOn ? 'Disable all homebrew' : 'Enable all homebrew'}
              onClick={() => setBooks(hbList.map((h) => h.name), !hbAllOn)}
            >
              <i className={'ti ' + (hbAllOn ? 'ti-checkbox' : hbOnCount > 0 ? 'ti-square-minus' : 'ti-square')} aria-hidden="true" />
            </button>
          </div>
          {hbOpen && (
            <div className="src-books">
              {hbShown.map((h) => {
                const on = enabled.has(h.name);
                return (
                  <button type="button" key={h.name} className={'src-book' + (on ? ' on' : '')} onClick={() => setBooks([h.name], !on)}>
                    <i className={'ti ' + (on ? 'ti-checkbox' : 'ti-square')} aria-hidden="true" />
                    <span className="src-book-name">{h.name}</span>
                    <span className="src-book-n">{h.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {groups.map((g) => {
        const onCount = g.entries.filter((e) => e.books.every((b) => enabled.has(b))).length;
        const allOn = onCount === g.entries.length;
        const open = sq !== '' || expanded.has(g.category);
        return (
          <div className="src-cat" key={g.category}>
            <div className="src-cat-head">
              <button type="button" className="src-cat-name" aria-expanded={open} onClick={() => toggleCat(g.category)}>
                <i className={'ti ' + (open ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
                {g.category}
                <span className="src-count">
                  {onCount}/{g.entries.length}
                </span>
              </button>
              <button
                type="button"
                className={'src-check' + (allOn ? ' on' : onCount > 0 ? ' partial' : '')}
                title={allOn ? 'Turn this category off' : 'Turn this category on'}
                aria-label={allOn ? `Disable all ${g.category}` : `Enable all ${g.category}`}
                onClick={() => setCategory(g, !allOn)}
              >
                <i className={'ti ' + (allOn ? 'ti-checkbox' : onCount > 0 ? 'ti-square-minus' : 'ti-square')} aria-hidden="true" />
              </button>
            </div>
            {open && (
              <div className="src-books">
                {g.entries.map((e) => {
                  const onN = e.books.filter((b) => enabled.has(b)).length;
                  const on = onN === e.books.length;
                  const partial = onN > 0 && !on;
                  return (
                    <button type="button" key={e.label} className={'src-book' + (on ? ' on' : '')} onClick={() => setBooks(e.books, !on)}>
                      <i className={'ti ' + (on ? 'ti-checkbox' : partial ? 'ti-square-minus' : 'ti-square')} aria-hidden="true" />
                      <span className="src-book-name">
                        {e.label}
                        {e.books.length > 1 && <span className="src-bundle-n"> · {e.books.length} books</span>}
                      </span>
                      <span className="src-book-n">{e.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </SetupCard>
  );
}

export function OverridesCard({ build, actions, content, character }: EditorProps & { character: Character }) {
  const ov = build.overrides ?? {};
  const featName = (id: string) => content.feats[id]?.name ?? id;
  const featureName = (id: string) => content.classFeatures[id]?.name ?? id;
  const langName = (id: string) => content.languages[id]?.name ?? cap(id);
  // Write a pruned overrides object — drop empty fields so an emptied override clears to `undefined`.
  const writeOv = (next: Partial<BuildOverrides>) => {
    const m = { ...ov, ...next };
    const clean: BuildOverrides = {};
    if (m.allowedFeats?.length) clean.allowedFeats = m.allowedFeats;
    if (m.addedFeats?.length) clean.addedFeats = m.addedFeats;
    if (m.addedFeatures?.length) clean.addedFeatures = m.addedFeatures;
    if (m.removedFeatIds?.length) clean.removedFeatIds = m.removedFeatIds;
    if (m.attributes && Object.keys(m.attributes).length) clean.attributes = m.attributes;
    if (m.proficiencies && Object.keys(m.proficiencies).length) clean.proficiencies = m.proficiencies;
    if (m.addedLanguages?.length) clean.addedLanguages = m.addedLanguages;
    if (m.addedSpells?.length) clean.addedSpells = m.addedSpells;
    if (m.contentEdits && (Object.keys(m.contentEdits.feats ?? {}).length || Object.keys(m.contentEdits.classFeatures ?? {}).length)) clean.contentEdits = m.contentEdits;
    actions.patch({ overrides: Object.keys(clean).length ? clean : undefined });
  };

  // --- Feats: allow-past-prereqs ledger + grant (feat OR feature) + remove ---
  const unallow = (id: string) => {
    const slot = Object.entries(build.featPicks).find(([, v]) => v === id)?.[0];
    if (slot) actions.setFeat(slot, null);
    writeOv({ allowedFeats: (ov.allowedFeats ?? []).filter((x) => x !== id) });
  };
  const grant = (prefixed: string) => {
    const i = prefixed.indexOf(':');
    const kind = prefixed.slice(0, i);
    const id = prefixed.slice(i + 1);
    if (kind === 'feat') {
      const f = content.feats[id];
      if (f && !ov.addedFeats?.some((a) => a.featId === id)) writeOv({ addedFeats: [...(ov.addedFeats ?? []), { featId: id, level: Math.min(f.level, build.level), category: f.category }] });
    } else {
      const f = content.classFeatures[id];
      if (f && !ov.addedFeatures?.some((a) => a.featureId === id)) writeOv({ addedFeatures: [...(ov.addedFeatures ?? []), { featureId: id, level: Math.min(f.level, build.level) }] });
    }
  };
  const ungrantFeat = (id: string) => writeOv({ addedFeats: (ov.addedFeats ?? []).filter((a) => a.featId !== id) });
  const ungrantFeature = (id: string) => writeOv({ addedFeatures: (ov.addedFeatures ?? []).filter((a) => a.featureId !== id) });
  const removeFeat = (id: string) => { if (!ov.removedFeatIds?.includes(id)) writeOv({ removedFeatIds: [...(ov.removedFeatIds ?? []), id] }); };
  const unremove = (id: string) => writeOv({ removedFeatIds: (ov.removedFeatIds ?? []).filter((x) => x !== id) });

  const grantOptions = [
    ...Object.values(content.feats).filter((f) => f.level <= build.level && !ov.addedFeats?.some((a) => a.featId === f.id)).map((f) => ({ id: `feat:${f.id}`, name: f.name, note: `Feat · ${cap(f.category)} · lvl ${f.level}` })),
    ...Object.values(content.classFeatures).filter((f) => !ov.addedFeatures?.some((a) => a.featureId === f.id)).map((f) => ({ id: `feature:${f.id}`, name: f.name, note: `Feature · lvl ${f.level}` })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const removeOptions = character.feats
    .filter((f, i, arr) => arr.findIndex((x) => x.featId === f.featId) === i && !ov.removedFeatIds?.includes(f.featId))
    .map((f) => ({ id: f.featId, name: featName(f.featId), note: `level ${f.level}` }));

  // --- Attributes: force a raw score, no limits ---
  const setAttr = (ab: AbilityId, raw: string) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return revertAttr(ab);
    writeOv({ attributes: { ...ov.attributes, [ab]: n } });
  };
  const revertAttr = (ab: AbilityId) => {
    const a = { ...(ov.attributes ?? {}) };
    delete a[ab];
    writeOv({ attributes: a });
  };

  // --- Proficiencies: set any track to any rank ---
  const setProf = (key: string, rank: ProficiencyRank) => writeOv({ proficiencies: { ...ov.proficiencies, [key]: rank } });
  const clearProf = (key: string) => {
    const p = { ...(ov.proficiencies ?? {}) };
    delete p[key];
    writeOv({ proficiencies: p });
  };
  const profTrackOptions = [
    ...PROF_TRACKS.filter((t) => !(t.key in (ov.proficiencies ?? {}))).map((t) => ({ id: t.key, name: t.name })),
    ...SKILLS.filter((s) => !(s in (ov.proficiencies ?? {}))).map((s) => ({ id: s, name: cap(s) })),
  ];

  // --- Languages ---
  const addLang = (id: string) => { if (!ov.addedLanguages?.includes(id)) writeOv({ addedLanguages: [...(ov.addedLanguages ?? []), id] }); };
  const removeLang = (id: string) => writeOv({ addedLanguages: (ov.addedLanguages ?? []).filter((x) => x !== id) });
  const langOptions = Object.values(content.languages)
    .filter((l) => !ov.addedLanguages?.includes(l.id) && !character.languages.includes(l.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((l) => ({ id: l.id, name: l.name }));

  // --- Spells: grant any spell at any rank (rituals included; no tradition/access check) ---
  const spellName = (id: string) => content.spells[id]?.name ?? id;
  const addSpell = (id: string) => {
    const sp = content.spells[id];
    if (sp && !ov.addedSpells?.some((a) => a.spellId === id)) writeOv({ addedSpells: [...(ov.addedSpells ?? []), { spellId: id, rank: sp.rank }] });
  };
  const setSpellRank = (id: string, rank: number) => writeOv({ addedSpells: (ov.addedSpells ?? []).map((a) => (a.spellId === id ? { ...a, rank } : a)) });
  const removeSpell = (id: string) => writeOv({ addedSpells: (ov.addedSpells ?? []).filter((a) => a.spellId !== id) });
  const spellOptions = Object.values(content.spells)
    .filter((s) => !ov.addedSpells?.some((a) => a.spellId === s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ id: s.id, name: s.name, note: (s.ritual ? 'Ritual' : cap(s.traditions[0] ?? 'spell')) + ` · rank ${s.rank}` }));

  // --- Change an existing feat/feature (edit its name + description text) ---
  type EditMap = 'feats' | 'classFeatures';
  const startEdit = (prefixed: string) => {
    const i = prefixed.indexOf(':');
    const map: EditMap = prefixed.slice(0, i) === 'feat' ? 'feats' : 'classFeatures';
    const id = prefixed.slice(i + 1);
    const ce = ov.contentEdits ?? {};
    if (ce[map]?.[id]) return;
    writeOv({ contentEdits: { ...ce, [map]: { ...(ce[map] ?? {}), [id]: {} } } });
  };
  const setEdit = (map: EditMap, id: string, patch: Record<string, unknown>) => {
    const ce = ov.contentEdits ?? {};
    writeOv({ contentEdits: { ...ce, [map]: { ...(ce[map] ?? {}), [id]: { ...(ce[map]?.[id] ?? {}), ...patch } } } });
  };
  const revertEdit = (map: EditMap, id: string) => {
    const ce = ov.contentEdits ?? {};
    const m = { ...(ce[map] ?? {}) };
    delete m[id];
    writeOv({ contentEdits: { ...ce, [map]: m } });
  };
  const editOptions = [
    ...Object.values(content.feats).filter((f) => !ov.contentEdits?.feats?.[f.id]).map((f) => ({ id: `feat:${f.id}`, name: f.name, note: `Feat · lvl ${f.level}` })),
    ...Object.values(content.classFeatures).filter((f) => !ov.contentEdits?.classFeatures?.[f.id]).map((f) => ({ id: `feature:${f.id}`, name: f.name, note: `Feature · lvl ${f.level}` })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const editEntries: { map: EditMap; id: string }[] = [
    ...Object.keys(ov.contentEdits?.feats ?? {}).map((id) => ({ map: 'feats' as EditMap, id })),
    ...Object.keys(ov.contentEdits?.classFeatures ?? {}).map((id) => ({ map: 'classFeatures' as EditMap, id })),
  ];

  const chip = (id: string, label: string, onX: () => void) => (
    <span className="ovr-chip" key={id}>
      {label}
      <button type="button" className="ovr-chip-x" title="Remove this override" onClick={onX} aria-label={`Remove override: ${label}`}>
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </span>
  );

  return (
    <SetupCard icon="ti-wand" label="Overrides">
      <p className="ovr-intro">
        Creative editing — deliberately bend the rules for specific cases. In a feat picker, a feat you don't qualify for shows
        a <span className="ovr-take-inline">Take anyway</span> option; it lands here.
      </p>

      {!!ov.allowedFeats?.length && (
        <SubCard icon="ti-lock-open" label="Taken despite prerequisites" count={ov.allowedFeats.length}>
          <div className="ovr-chips">{ov.allowedFeats.map((id) => chip(id, featName(id), () => unallow(id)))}</div>
        </SubCard>
      )}

      <SubCard icon="ti-plus" label="Grant a feat or feature" count={(ov.addedFeats?.length ?? 0) + (ov.addedFeatures?.length ?? 0) || undefined}>
        <SearchSelect label="Grant a feat or feature" value={null} placeholder="Add a feat or feature…" options={grantOptions} onChange={grant} bare />
        {(!!ov.addedFeats?.length || !!ov.addedFeatures?.length) && (
          <div className="ovr-chips">
            {ov.addedFeats?.map((a) => chip(`feat:${a.featId}`, featName(a.featId), () => ungrantFeat(a.featId)))}
            {ov.addedFeatures?.map((a) => chip(`feature:${a.featureId}`, featureName(a.featureId), () => ungrantFeature(a.featureId)))}
          </div>
        )}
      </SubCard>

      <SubCard icon="ti-minus" label="Remove a granted feat" count={ov.removedFeatIds?.length || undefined}>
        <SearchSelect label="Remove a feat" value={null} placeholder="Remove a feat…" options={removeOptions} onChange={removeFeat} bare />
        {!!ov.removedFeatIds?.length && <div className="ovr-chips">{ov.removedFeatIds.map((id) => chip(id, featName(id), () => unremove(id)))}</div>}
      </SubCard>

      <SubCard icon="ti-stairs-up" label="Change attributes" count={ov.attributes && Object.keys(ov.attributes).length ? Object.keys(ov.attributes).length : undefined}>
        <div className="ovr-attrs">
          {ABILITIES.map((ab) => {
            const overridden = ov.attributes?.[ab] !== undefined;
            return (
              <label key={ab} className={'ovr-attr' + (overridden ? ' on' : '')}>
                <span className="ovr-attr-k">{ABILITY_LABEL[ab]}</span>
                <input type="number" className="ovr-attr-in" value={character.abilities[ab]} onChange={(e) => setAttr(ab, e.target.value)} />
                {overridden && (
                  <button type="button" className="ovr-attr-x" title="Revert to computed" onClick={() => revertAttr(ab)} aria-label={`Revert ${ab}`}>
                    <i className="ti ti-arrow-back-up" aria-hidden="true" />
                  </button>
                )}
              </label>
            );
          })}
        </div>
      </SubCard>

      <SubCard icon="ti-award" label="Change proficiency" count={ov.proficiencies && Object.keys(ov.proficiencies).length ? Object.keys(ov.proficiencies).length : undefined}>
        <SearchSelect label="Add a proficiency" value={null} placeholder="Choose a track…" options={profTrackOptions} onChange={(k) => setProf(k, 'trained')} bare />
        {!!ov.proficiencies && Object.keys(ov.proficiencies).length > 0 && (
          <div className="ovr-rows">
            {Object.entries(ov.proficiencies).map(([key, rank]) => (
              <div className="ovr-row" key={key}>
                <span className="ovr-row-k">{profTrackName(key)}</span>
                <PopupSelect variant="pill" title="Rank" value={rank} onChange={(v) => setProf(key, v as ProficiencyRank)} options={PROFICIENCY_RANKS.map((r) => ({ value: r, label: cap(r) }))} />
                <button type="button" className="ovr-chip-x" title="Remove" onClick={() => clearProf(key)} aria-label={`Remove ${key} override`}>
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SubCard>

      <SubCard icon="ti-language" label="Add a language" count={ov.addedLanguages?.length || undefined}>
        <SearchSelect label="Add a language" value={null} placeholder="Add a language…" options={langOptions} onChange={addLang} bare />
        {!!ov.addedLanguages?.length && <div className="ovr-chips">{ov.addedLanguages.map((id) => chip(id, langName(id), () => removeLang(id)))}</div>}
      </SubCard>

      <SubCard icon="ti-sparkles" label="Add spell" count={ov.addedSpells?.length || undefined}>
        <SearchSelect label="Add a spell" value={null} placeholder="Add any spell or ritual…" options={spellOptions} onChange={addSpell} bare />
        {!!ov.addedSpells?.length && (
          <div className="ovr-rows">
            {ov.addedSpells.map((a) => {
              const isRitual = content.spells[a.spellId]?.ritual;
              return (
                <div className="ovr-row" key={a.spellId}>
                  <span className="ovr-row-k">
                    {spellName(a.spellId)}
                    {isRitual ? ' (ritual)' : ''}
                  </span>
                  {!isRitual && (
                    <PopupSelect
                      variant="pill"
                      title="Rank"
                      value={String(a.rank)}
                      onChange={(v) => setSpellRank(a.spellId, Number(v))}
                      options={Array.from({ length: 11 }, (_, r) => ({ value: String(r), label: r === 0 ? 'Cantrip' : `Rank ${r}` }))}
                    />
                  )}
                  <button type="button" className="ovr-chip-x" title="Remove" onClick={() => removeSpell(a.spellId)} aria-label={`Remove ${spellName(a.spellId)}`}>
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SubCard>

      <SubCard icon="ti-edit" label="Change a feat or feature" count={editEntries.length || undefined}>
        <SearchSelect label="Edit a feat or feature" value={null} placeholder="Edit a feat or feature…" options={editOptions} onChange={startEdit} bare />
        {editEntries.map(({ map, id }) => {
          const entry = (map === 'feats' ? content.feats : content.classFeatures)[id];
          if (!entry) return null;
          return (
            <div className="ovr-edit" key={`${map}:${id}`}>
              <div className="ovr-edit-head">
                <input className="ovr-edit-name" value={entry.name} onChange={(e) => setEdit(map, id, { name: e.target.value })} />
                <button type="button" className="ovr-chip-x" title="Revert all edits to this entry" onClick={() => revertEdit(map, id)} aria-label={`Revert edits to ${entry.name}`}>
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              </div>
              <textarea className="ovr-edit-desc" rows={4} value={entry.description} onChange={(e) => setEdit(map, id, { description: e.target.value })} />
            </div>
          );
        })}
      </SubCard>
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
        <ToggleWithInfo
          label="Alternate Ancestry Boosts"
          description="Replace your ancestry's listed attribute boosts AND flaws with two free attribute boosts (of your choice). A GM Core option for players who want their ancestry to impose no attribute penalty and full flexibility."
          on={!!opts.alternateAncestryBoosts}
          onToggle={() => set({ alternateAncestryBoosts: !opts.alternateAncestryBoosts })}
        />
        <ToggleWithInfo
          label="Ignore Bulk Limit"
          description="Disable the negative effects of carrying too much Bulk — no encumbered or over-limit warnings. A convenience option for tables that don't track encumbrance."
          on={!!opts.ignoreBulk}
          onToggle={() => set({ ignoreBulk: !opts.ignoreBulk })}
        />
        <ToggleWithInfo
          label="Voluntary Flaw"
          description="Take an additional attribute flaw beyond your ancestry's (regardless of your ancestry) to gain no mechanical benefit but reflect your character's weakness. You pick which attribute takes the extra flaw at level 0."
          on={!!opts.voluntaryFlaw}
          onToggle={() => set({ voluntaryFlaw: !opts.voluntaryFlaw })}
        />
        <ToggleWithInfo
          label="Dice roller"
          description="Turn the built-in dice roller on or off. When off, its button (and per-stat roll triggers) is hidden everywhere on the sheet — useful if you roll physical dice or use another roller."
          on={opts.diceRollerOff === false}
          onToggle={() => set({ diceRollerOff: opts.diceRollerOff === false })}
        >
          Dice roller {opts.diceRollerOff === false ? 'on' : 'off'}
        </ToggleWithInfo>
        <ToggleWithInfo
          label="Individual day tracking of rations"
          description="Track rations day-by-day yourself (via item quantity) instead of the built-in 7-day counter. When on, the Rations item shows no days counter."
          on={!!opts.rationsDayTracking}
          onToggle={() => set({ rationsDayTracking: !opts.rationsDayTracking })}
        />
        <ToggleWithInfo
          label="Deep background"
          description="Build a fully custom background of your own — pick its trained skills, lore, skill feat, and attribute boosts — instead of choosing a published one."
          on={!!opts.deepBackground}
          onToggle={() => set({ deepBackground: !opts.deepBackground })}
        />
        <ToggleWithInfo
          label="Overrides"
          description="Reveal the Overrides section — creative, deliberate rule-breaking for specific cases: take feats you don't qualify for, grant or remove feats and features, edit attributes and proficiencies, and more."
          on={!!opts.overridesEnabled}
          onToggle={() => set({ overridesEnabled: !opts.overridesEnabled })}
          className="ovr-opt"
        >
          <i className="ti ti-wand" aria-hidden="true" /> Overrides
        </ToggleWithInfo>
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

/** Weapon groups a fighter can pick for Weapon Mastery — the distinct groups of the simple/martial/
 *  unarmed/advanced weapons in content, with a capitalized label. Excludes non-weapon "shield" group. */
function fighterWeaponGroupOptions(content: ContentDatabase): { id: string; label: string }[] {
  const groups = new Set<string>();
  for (const it of Object.values(content.items)) {
    if (it.itemType === 'weapon' && it.group && it.group !== 'shield') groups.add(it.group);
  }
  return [...groups]
    .sort()
    .map((g) => ({ id: g, label: g.charAt(0).toUpperCase() + g.slice(1) }));
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
  // "Deep background" (an Options toggle) unlocks building a custom background. Keep it visible if one
  // is already selected, so an existing custom-bg character never gets stuck with a hidden picker.
  const showCustomBg = !!build.options?.deepBackground || build.backgroundId === CUSTOM_BACKGROUND_ID;
  const ancSlots = !ancestry ? [] : altBoosts ? ([{ kind: 'free' }, { kind: 'free' }] as BoostSlot[]) : boostSlots(ancestry.abilityBoosts);
  const ancFixed = ancestry && !altBoosts ? fixedBoosts(ancestry.abilityBoosts) : [];
  const bgSlots = background ? boostSlots(background.abilityBoosts) : [];
  const bgFixed = background ? fixedBoosts(background.abilityBoosts) : [];
  const subKey = subclassKeyAbility(build, content);
  // A racket-style subclass offers a key-attribute CHOICE (Dex or the racket's attribute) — show
  // the picker restricted to those; otherwise a multi-key class shows its own list.
  const subKeyOptions = cls?.subclass?.options.find((o) => o.id === build.subclassId)?.keyAbilityOptions;
  const keyOptions = subKeyOptions?.length ? subKeyOptions : !subKey && cls ? cls.keyAbility : [];
  const keyChoice = keyOptions.length > 1;
  const keyAbility = subKey ?? build.keyAbility ?? cls?.keyAbility[0] ?? null;
  const heritage = build.heritageId ? content.heritages[build.heritageId] : undefined;
  // Level-1 general feats (skill feats are a subset of general feats) for a feat-granting heritage
  // (Versatile Human). Content-static, so memoize away per-keystroke re-filters.
  const heritageFeatOpts = useMemo(
    () =>
      Object.values(content.feats)
        .filter((f) => f.level <= 1 && (f.category === 'general' || f.category === 'skill'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ id: f.id, name: f.name, note: f.category === 'skill' ? 'skill feat' : undefined })),
    [content.feats],
  );
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
              exclude={altBoosts ? build.ancestryBoosts : [...build.ancestryBoosts, ...ancFixed, ...ancestry.abilityFlaws]}
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
            clearLabel="Clear"
            options={SKILLS.map((s) => ({ value: s, label: cap(s) }))}
          />
        </SubCard>
      )}
      {/* A feat-granting heritage (Versatile Human): pick the level-1 general feat it grants, or
          it's silently lost. Injected into the character by buildCharacter. */}
      {heritage?.grantsGeneralFeat && (
        <SubCard icon="ti-medal" label="Heritage general feat">
          <SearchSelect
            bare
            label="General feat"
            placeholder="Choose a general feat…"
            value={build.heritageFeatId}
            onChange={(id) => actions.patch({ heritageFeatId: id })}
            options={heritageFeatOpts}
          />
          {(() => {
            const f = build.heritageFeatId ? content.feats[build.heritageFeatId] : undefined;
            return f?.description ? <ChoiceDetails name={f.name} flavor={f.description} descRefs={f.descRefs} /> : null;
          })()}
        </SubCard>
      )}
      <SetupCard icon="ti-briefcase" label="Background">
        <SearchSelect
          bare
          label="Background"
          value={build.backgroundId}
          onChange={actions.changeBackground}
          options={[
            ...(showCustomBg ? [{ id: CUSTOM_BACKGROUND_ID, name: '✎ Custom background…' }] : []),
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
                {(background.trainedSkill || background.trainedSkillChoice?.length || background.trainedLore) && (
                  <span className="cc-g">
                    <i className="ti ti-bulb" aria-hidden="true" /> Trained:{' '}
                    {background.trainedSkill
                      ? cap(background.trainedSkill)
                      : (background.trainedSkillChoice ?? []).map(cap).join(' or ')}
                    {background.trainedLore
                      ? `${background.trainedSkill || background.trainedSkillChoice?.length ? ', ' : ''}${loreLabel(background.trainedLore)}`
                      : ''}
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
        <SubCard
          icon="ti-arrow-up"
          label={`Background boost${bgSlots.length > 1 ? 's' : ''}${bgFixed.length ? ` · +${bgFixed.map((a) => ABILITY_LABEL[a]).join(', ')}` : ''}`}
        >
          {bgSlots.map((slot, i) => (
            <AbilitySelect
              key={i}
              value={build.backgroundBoosts[i] ?? null}
              options={slot.kind === 'choice' && slot.options ? slot.options : ABILITIES}
              exclude={[...build.backgroundBoosts, ...bgFixed]}
              onChange={(v) => actions.setBoost('backgroundBoosts', i, v)}
            />
          ))}
        </SubCard>
      )}
      {/* A "trained in your choice of X or Y" background: pick which skill it trains (unpicked
          defaults to the first option, so the character is legal either way). */}
      {background && build.backgroundId !== CUSTOM_BACKGROUND_ID && !!background.trainedSkillChoice?.length && (
        <SubCard icon="ti-bulb" label="Background skill">
          <PopupSelect
            title="Background trained skill"
            placeholder="Choose a skill"
            value={
              build.backgroundSkillChoice && background.trainedSkillChoice.includes(build.backgroundSkillChoice)
                ? build.backgroundSkillChoice
                : ''
            }
            onChange={(v) => actions.patch({ backgroundSkillChoice: (v || null) as SkillId | null })}
            options={background.trainedSkillChoice.map((s) => ({ value: s, label: cap(s) }))}
          />
        </SubCard>
      )}
      {showCustomBg && build.backgroundId === CUSTOM_BACKGROUND_ID && (
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
            <AbilitySelect
              value={build.keyAbility && keyOptions.includes(build.keyAbility) ? build.keyAbility : null}
              options={keyOptions}
              onChange={(v) => actions.patch({ keyAbility: v })}
            />
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
      {(build.classId === 'fighter' || (build.variantRules?.dualClass && build.classId2 === 'fighter')) && build.level >= 5 && (
        <SetupCard icon="ti-sword" label="Weapon group mastery">
          <div className="bsec-note">
            Fighter Weapon Mastery (5th) — and Weapon Legend (13th) — raise your proficiency with the
            simple, martial, and unarmed weapons of one weapon group. Choose that group.
          </div>
          <PopupSelect
            title="Weapon group"
            value={build.fighterWeaponGroup ?? ''}
            onChange={(v) => actions.patch({ fighterWeaponGroup: v || null })}
            options={fighterWeaponGroupOptions(content).map((g) => ({ value: g.id, label: g.label }))}
          />
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
  const bgSkill = backgroundTrainedSkill(build, background);
  if (bgSkill) locked.add(bgSkill);
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
    <SetupCard icon="ti-list-check" label="Trained skills" count={`${chosen.length}/${addlCount}`}>
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
  const preview = useMemo(() => character ?? buildCharacter(build, content), [character, build, content]);
  // Use the BUILT character's scores (they include any Overrides attribute edits), not a fresh
  // computeAbilities(build) — which doesn't see overrides (they're applied inside buildCharacter).
  const abilities = preview.abilities;
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
