import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { DESTINY_LEVEL, destinyDedications } from '../rules/mythic';
import type { AbilityId, BuildOverrides, EffectChoice, Character, CharacterOptions, ClassDef, CompanionConfig, ContentDatabase, CustomBackground, DescRef, MonsterPartsMode, ProficiencyKey, ProficiencyRank, SaveId, SkillId, Tradition } from '../rules/types';
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
  buildUsesDeity,
  championDevotionOptions,
  extraPickCount,
  commanderFolioCapacity,
  commanderTierFor,
  commanderTacticOptions,
  qiSpellsPossible,
  runeRepertoireMax,
  runeRepertoireMaxViaDedication,
  runesmithRuneOptions,
  GATE_THRESHOLD_LEVELS,
  innovationType,
  inventorModificationOptions,
  INVENTOR_TIER_LEVEL,
  backgroundEffectiveBoosts,
  emptyCustomBackground,
  featChoiceLabel,
  fixedBoosts,
  heritageAdjustedAncestryAttributes,
  resolveBackground,
  subclassKeyAbility,
  backgroundGrantedFeats,
  backgroundChoiceKey,
  backgroundChoiceKind,
  backgroundChoiceValue,
  secondHeritageIdOf,
  toggleSignature,
  featChoicePrompt,
  trainedSkillOptions,
  chosenFromBooks,
  removeChosenIds,
  withCustomAnswer,
} from '../rules/build';
import { effectChoiceOffered, narrowSpellFilter } from '../rules/build';
import { BACKGROUND_CANTRIP_GRANTS } from '../rules/backgroundGrants';
import { openChoiceOptions } from '../rules/openChoice';
import { cantripsKnown } from '../rules/spellcasting';
import { spellsMatching } from '../rules/spellChoice';
import { abpSkillBudget } from '../rules/abp';
import { activeCasterArchetype, archetypeEntryIds, archetypeSlots } from '../rules/casterArchetypes';
import { snareAllowance, snareFormulaOptions, isBaseSnareSlot, SNARE_FORMULA_KEY } from '../rules/snareFormulas';
import { formulaOptions, formulaSlots, type FormulaSlot } from '../rules/formulaBook';
import { snareAllowanceFor } from '../rules/counterMods';
import {
  askedAtDailyPrep,
  bodyRuneExcluded,
  abilityMod,
  deriveAc,
  deriveClassDc,
  deriveMaxHp,
  derivePerception,
  deriveSave,
  deriveSkill,
  deriveSpeeds,
  blastTypesFor,
  deriveSpellcasting,
  domainPoolForChoice,
  formatMod,
  narrowChoiceOptions,
  effectiveChoiceLimits,
} from '../rules/derive';
import { explainStat, statHasSituational, type StatRef } from '../rules/explain';
import { useContent } from '../sheet/ContentContext';
import { RankPill, SituationalStar } from '../sheet/widgets';
import { StatDetailModal } from '../sheet/StatDetailModal';
import { DefensesPills } from '../sheet/DefensesPills';
import { DescriptionModal } from '../sheet/DescriptionModal';
import { MythicRules } from '../sheet/MythicRules';
import { PickerRow, descNodeOf } from '../sheet/FilterableSelect';
import { useEscapeClose } from '../sheet/useEscapeClose';
import { isMobileNow } from '../sheet/useIsMobile';
import type { DescNode } from '../sheet/descref';
import { FEAT_PICK_GRANTS, pickableFeats } from '../rules/featPickGrants';

/** The "what you gain" summary chips under a CHOICE (HP/size/speed for an ancestry, trained skills for
 *  a class …). No Details button: for anything the player picked, the picker itself is how you read it —
 *  pressing the chosen value opens its full description, and a Replace button re-opens the list (see
 *  SearchSelect / PopupSelect). A second, differently-shaped route to the same popup was just noise. */
export function ChoiceGrants({ grants }: { grants?: ReactNode }) {
  return grants ? <>{grants}</> : null;
}

/** Grants summary + a "Details" button that opens the record's description.
 *
 *  For things the character is GRANTED, not things they chose — the class features under "You gain
 *  automatically" and the feats a background hands out. Those have no picker to press, so this button
 *  is their only way in. Choices use ChoiceGrants above. */
export function ChoiceDetails({
  name,
  flavor,
  descRefs,
  grants,
}: {
  /** The option's name — the popup title. */
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
        <button type="button" className="cc-det" onClick={() => setOpen(true)}>
          <i className="ti ti-info-circle" aria-hidden="true" /> Details
        </button>
      )}
      {open && hasFlavor && (
        <DescriptionModal root={{ title: name ?? 'Details', description: flavor!, descRefs }} onClose={() => setOpen(false)} />
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
  /** The ONE leveled spell an innate-ranked archetype (Captivator) learns at a rank; null clears it. */
  setArchetypePoolSpell: (rank: number, spellId: string | null) => void;
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
  /** Dual Class — the same spell writers for the SECOND caster class (cantrips2/spells2/signatures2). */
  toggleCantrip2: (id: string) => void;
  toggleSpell2: (rank: number, id: string) => void;
  addSpell2: (rank: number, id: string) => void;
  removeSpellAt2: (rank: number, index: number) => void;
  toggleSignature2: (rank: number, id: string) => void;
  addItem: (itemId: string) => void;
  removeItem: (index: number) => void;
  setItemQty: (index: number, qty: number) => void;
  toggleWorn: (index: number) => void;
  toggleEquipped: (index: number) => void;
  removeCompanion: (id: string) => void;
  setCompanion: (id: string, patch: Partial<CompanionConfig>) => void;
}

/** Cumulative number of options the player may pick in a choice group at this level.
 *  Lives in rules/build so the picker and the "what is still unchosen" count share one rule;
 *  re-exported here because the builder's other modules import it from this file. */
export { extraPickCount };

/**
 * Empty selections for a class's extra choices (element, apparition, epithet, …).
 *
 * These used to default a single-pick group to its FIRST option, which meant a fresh kineticist was
 * silently an air kineticist and a fresh animist was attuned to whichever apparition happened to sort
 * first. A pre-answered question doesn't look like a question: the card showed a filled picker, no
 * pending marker appeared, and the player could finish the build never knowing they'd been assigned
 * something. Every one of these is the player's to make, so they all start empty.
 */
function emptyExtraChoices(c: ClassDef | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of c?.extraChoices ?? []) out[g.id] = [];
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
      setBuild((b) => {
        // Drop ancestry-category feat picks (slotKey = "level:category:idx") — the old
        // ancestry's feats are illegal for the new one. Keep class/skill/general picks.
        const isAncestry = (k: string) => k.split(':')[1] === 'ancestry';
        const featPicks = Object.fromEntries(Object.entries(b.featPicks).filter(([k]) => !isAncestry(k)));
        const featChoices = Object.fromEntries(Object.entries(b.featChoices).filter(([k]) => !isAncestry(k)));
        return {
          ...b,
          ancestryId: id,
          // Heritage is the player's pick, so it starts EMPTY. Handing them the ancestry's first
          // heritage (alphabetically, whatever that happened to be) both made the choice for them and
          // hid it — setupMissing lists "Heritage" only while it is unset.
          heritageId: null,
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
      // Feat-slot levels are class-specific, so picks from the old class no longer
      // map cleanly — clear them. Skill increases / boosts are level-driven, keep them.
      //
      // Nothing here is pre-answered on the player's behalf any more. A class used to arrive with its
      // FIRST subclass selected, its extra-choice groups filled in, and — for a cleric or champion —
      // whichever deity came first out of the database, plus that deity's first divine font. All four
      // are the player's to make, and being pre-filled meant the builder never marked them pending, so
      // a character could be finished carrying choices nobody made.
      setBuild((b) => ({
        ...b,
        classId: id,
        subclassId: null,
        extraChoices: emptyExtraChoices(c),
        // Not a choice when the class names exactly one key attribute — that IS the class's answer.
        keyAbility: c && c.keyAbility.length === 1 ? c.keyAbility[0] : null,
        classSkills: [],
        featPicks: {},
        // tradition changes with the class, so previously chosen spells no longer apply
        cantrips: [],
        spells: {},
        signatures: {},
        // Keep a deity the player already chose; never invent one. setupMissing reports "Deity" for a
        // class that needs one until they pick.
        deityId: b.deityId,
        // The font belongs to the deity, so it can only be settled once there IS one (see changeDeity).
        divineFont: b.deityId ? b.divineFont : null,
      }));
    },
    changeSubclass(id) {
      setBuild((b) => {
        const cls = b.classId ? content.classes[b.classId] : undefined;
        const oldOpt = cls?.subclass?.options.find((o) => o.id === b.subclassId);
        const newOpt = cls?.subclass?.options.find((o) => o.id === id);
        // A racket that requires a deity (rogue Avenger) used to have one picked for it — the first
        // entry in the database — so the player never saw the question. It stays unset; setupMissing
        // reports "Deity" (buildNeedsDeity covers subclass-driven requirements) until they answer it.
        const deityId = b.deityId;
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
        // Keep the current font if the new deity allows it. Otherwise: a deity offering exactly one
        // font isn't asking a question, so settle it; a deity offering both leaves it EMPTY for the
        // player rather than silently picking whichever is listed first.
        const fonts = (content.deities[id]?.divineFont ?? []) as ('heal' | 'harm')[];
        const font = b.divineFont && (!fonts.length || fonts.includes(b.divineFont))
          ? b.divineFont
          : fonts.length === 1
            ? fonts[0]
            : null;
        // A Domain-feat sub-choice (Domain Initiate, …) that points at a domain the new deity doesn't
        // have has to go — otherwise it silently grants an off-deity focus spell. CLEAR it rather than
        // swapping in the new deity's first domain, which was answering the question on the player's
        // behalf while looking like their own pick.
        const featChoices = { ...b.featChoices };
        for (const [slotKey, val] of Object.entries(featChoices)) {
          const featId = b.featPicks[slotKey];
          const def = featId ? content.feats[featId]?.choice : undefined;
          // A domain choice may draw from a WIDER pool than the deity's own list (Splinter Faith
          // adds the alternate domains), so validate against the pool that choice actually offers.
          if (def?.kind === 'domains') {
            const pool = domainPoolForChoice({ ...b, deityId: id || null }, content, featId, def.domainPool);
            if (!pool.includes(val)) delete featChoices[slotKey];
          }
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
    /*
     * The ONE leveled spell an innate-ranked archetype learns at a rank (Captivator).
     *
     * `archetypeSpells` had writers for cantrips, tradition and key attribute but NONE for `spells`,
     * so a CASTER class taking Captivator Dedication + Basic Captivator Spellcasting unlocked all
     * three ranks and had nothing to put in them — measured as `{1:[],2:[],3:[]}` on a bard, against a
     * fighter's filled repertoire. A non-caster fills the same pool through the per-level pickers,
     * which are gated on `!casting`; a caster had no surface at all.
     */
    setArchetypePoolSpell(rank, spellId) {
      setBuild((b) => {
        const as = b.archetypeSpells ?? { cantrips: [], spells: {} };
        const spells = { ...(as.spells ?? {}) };
        if (spellId) spells[rank] = [spellId];
        else delete spells[rank];
        return { ...b, archetypeSpells: { ...as, spells } };
      });
    },
    setSecondClass(id) {
      // The second class's subclass and extra-choice groups (kineticist element, animist apparition, …)
      // start empty, like the first class's — see changeClass.
      const c2 = id ? content.classes[id] : undefined;
      setBuild((b) => ({ ...b, classId2: id, subclassId2: null, extraChoices: { ...b.extraChoices, ...emptyExtraChoices(c2) } }));
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
          // The feat's embedded choice ("choose a domain", "choose an energy type") is left UNSET.
          // It used to be pre-filled with the first option so the feat was usable immediately, but a
          // filled picker doesn't read as a question — Domain Initiate arrived with a domain the player
          // never chose, and the focus spell that came with it was a surprise.
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
        // Through the shared toggle: a rank can hold SEVERAL signatures now (Signature Spell
        // Expansion grants two more, Ultimate Polymath makes the whole repertoire signature), and
        // the old assignment silently replaced whatever was there.
        return { ...b, signatures: toggleSignature(b.signatures, rank, id) };
      });
    },
    // ── Dual Class second-caster spell writers (cantrips2/spells2/signatures2) ──
    toggleCantrip2(id) {
      setBuild((b) => {
        const cur = b.cantrips2 ?? [];
        if (cur.includes(id)) return { ...b, cantrips2: cur.filter((x) => x !== id) };
        const cap = b.classId2 ? cantripsKnown(b.classId2) : 0;
        if (cur.length >= cap) return b;
        return { ...b, cantrips2: [...cur, id] };
      });
    },
    toggleSpell2(rank, id) {
      setBuild((b) => {
        const cur = b.spells2?.[rank] ?? [];
        const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
        return { ...b, spells2: { ...(b.spells2 ?? {}), [rank]: next } };
      });
    },
    addSpell2(rank, id) {
      setBuild((b) => ({ ...b, spells2: { ...(b.spells2 ?? {}), [rank]: [...(b.spells2?.[rank] ?? []), id] } }));
    },
    removeSpellAt2(rank, index) {
      setBuild((b) => {
        const cur = b.spells2?.[rank] ?? [];
        return { ...b, spells2: { ...(b.spells2 ?? {}), [rank]: cur.filter((_, i) => i !== index) } };
      });
    },
    toggleSignature2(rank, id) {
      setBuild((b) => {
        return { ...b, signatures2: toggleSignature(b.signatures2, rank, id) };
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
      options={options.map((o) => {
        const taken = o !== value && !!exclude?.includes(o);
        return {
          value: o,
          label: ABILITY_LABEL[o],
          disabled: taken,
          // The greying was here already; the sentence was not, and "why is Strength grey?" is a
          // real question when four boost pills sit side by side.
          disabledReason: taken ? 'Already boosted by another pick in this group.' : undefined,
        };
      })}
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
  descBucket,
}: {
  label: string;
  value: string | null | undefined;
  /** `disabled` carries the REASON the option cannot be committed (Q27: unpickable must say why);
   *  the stored answer is never disabled by the caller, so a pick cannot vanish under the player. */
  options: { id: string; name: string; note?: string; description?: string; descRefs?: DescRef[]; disabled?: string }[];
  onChange: (id: string) => void;
  placeholder?: string;
  /** Render just the control (no .ocard/label wrapper) — for use inside a SetupCard. */
  bare?: boolean;
  /** The content bucket these options live in (e.g. 'ancestries', 'classes'). When set, the description
   *  popup loads that record's FULL ast page (all sections — roleplay, etc.), matching the reference app,
   *  instead of only the short flavor `description`. */
  descBucket?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // Escape / Android Back closes the picker instead of leaving the builder. See PopupSelect.
  useEscapeClose(open ? () => setOpen(false) : undefined);
  // When options carry descriptions (or a descBucket), the picker rows and the filled control become
  // read-first: pressing a row (or the filled value) opens its description card; a dedicated Select /
  // Replace button does the committing — so "press an option" never silently chooses it.
  const [descNode, setDescNode] = useState<DescNode | null>(null);
  // Build a description node — the full ast page when descBucket is set (key=bucket, slug=id), else the
  // plain-text description card.
  const mkNode = (o: { id: string; name: string; description?: string; descRefs?: DescRef[] }): DescNode | null =>
    descBucket
      ? { title: o.name, description: o.description ?? '', descRefs: o.descRefs, key: descBucket, slug: o.id }
      : descNodeOf({ name: o.name, description: o.description, descRefs: o.descRefs }, 'origin');
  const current = options.find((o) => o.id === value);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options;
  const readFirst = !!descBucket || filtered.some((o) => o.description || o.descRefs?.length);
  const currentNode = current ? mkNode(current) : null;
  // Harness markers — see PopupSelect's ctlAttrs.
  const ctlAttrs = {
    'data-ctl': 'search',
    'data-ctl-title': label,
    'data-ctl-options': options.length,
    'data-ctl-live': options.filter((o) => !o.disabled).length,
    'data-ctl-state': current ? 'picked' : 'empty',
  };
  const control = (
    <>
      {current && currentNode ? (
        // Filled + describable: the value opens its description; a separate Replace button re-opens the picker.
        <div {...ctlAttrs} className="popsel is-picked ss-filled">
          <button type="button" className="ss-filled-body" title="View description" onClick={() => setDescNode(currentNode)}>
            <span className="popsel-val">{current.name}</span>
          </button>
          <button type="button" className="ss-replace" title={`Replace ${label.toLowerCase()}`} onClick={() => { setQ(''); setOpen(true); }}>
            <i className="ti ti-pencil" aria-hidden="true" /> Replace
          </button>
        </div>
      ) : (
        <button
          type="button"
          {...ctlAttrs}
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
      )}
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
                // Not on a phone: focusing the field opens the soft keyboard over the very list the
                // player came to read. Matches ConditionsModal and CompanionsTab.
                autoFocus={!isMobileNow()}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="picker-list">
              {readFirst
                ? // Read-first rows: press the row to read its description; the Select button chooses it.
                  filtered.slice(0, 100).map((o) => {
                    const node = mkNode(o);
                    const off = !!o.disabled && o.id !== value;
                    return (
                      <PickerRow
                        key={o.id}
                        name={o.name}
                        meta={o.note ? <div className="picker-traits">{o.note}</div> : undefined}
                        chosen={o.id === value}
                        onOpenDesc={node ? () => setDescNode(node) : undefined}
                        selectLabel="Select"
                        selectDisabled={off}
                        disabledReason={off ? o.disabled : undefined}
                        onSelect={() => {
                          onChange(o.id);
                          setOpen(false);
                        }}
                      />
                    );
                  })
                : filtered.slice(0, 100).map((o) => {
                    const off = !!o.disabled && o.id !== value;
                    return (
                      <button
                        type="button"
                        className={'picker-item' + (o.id === value ? ' chosen' : '')}
                        key={o.id}
                        disabled={off}
                        onClick={() => {
                          if (off) return;
                          onChange(o.id);
                          setOpen(false);
                        }}
                      >
                        <div className="picker-text">
                          <div className="picker-name">{o.name}</div>
                          {o.note && <div className="picker-traits">{o.note}</div>}
                          {off && <div className="picker-why">{o.disabled}</div>}
                        </div>
                      </button>
                    );
                  })}
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
      {descNode && <DescriptionModal root={descNode} onClose={() => setDescNode(null)} />}
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
  /** `disabled` greys the option out; `disabledReason` is the short sentence saying WHY, printed in
   *  the row and repeated as its tooltip. Q27: an option that cannot be picked must look unpickable
   *  and, where the reason is knowable, say so — never render identically and be silently inert. */
  options: { value: string; label: string; note?: string; disabled?: boolean; disabledReason?: string; description?: string; descRefs?: DescRef[] }[];
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
  // Escape, and on Android the hardware Back button. Without this, Back over an open builder picker
  // fell through to the app's exit — with an unsaved character in the builder behind it. Passing
  // `undefined` while shut is the hook's own idiom for an inert slot (see topHandler), so the dozens of
  // closed PopupSelects on a level-0 page cost one skipped array read each and swallow nothing.
  useEscapeClose(open ? () => close() : undefined);
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
  // A describable current pick (slot variant) gets the read-first filled control: the value opens its
  // description, a Replace button re-opens the picker — so pressing the value reads it, never re-chooses.
  const currentNode = current && (current.description || current.descRefs?.length)
    ? descNodeOf({ name: current.label, description: current.description, descRefs: current.descRefs }, 'origin')
    : null;
  const useSearch = search ?? options.length > 6;
  const needle = q.trim().toLowerCase();
  const filtered = useSearch && needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const openPicker = () => {
    setQ('');
    setCustomMode(false);
    setCustomText('');
    setOpen(true);
  };
  // Machine-readable markers for the WG experience harness (test/wg-experience.harness.test.tsx): what
  // this control asks, how many options it offers, whether it is answered. Invisible to the player;
  // pinned by test/builder-control-attrs.test.tsx because a lost marker makes the harness read "asks nothing".
  const ctlAttrs = {
    'data-ctl': 'popup',
    'data-ctl-title': title,
    'data-ctl-options': options.length,
    'data-ctl-live': options.filter((o) => !o.disabled && o.value !== '').length,
    'data-ctl-state': current ? 'picked' : 'empty',
  };
  return (
    <>
      {variant === 'card' ? (
        <button
          type="button"
          {...ctlAttrs}
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
      ) : variant === 'slot' && current && currentNode ? (
        // Read-first filled slot: press the value to read its description; Replace re-opens the picker.
        <div {...ctlAttrs} className={'popsel is-picked ss-filled' + (className ? ' ' + className : '')}>
          <button type="button" className="ss-filled-body" title="View description" onClick={() => setDescNode(currentNode)}>
            {icon && <span className="popsel-tile"><i className={'ti ' + icon} aria-hidden="true" /></span>}
            <span className="popsel-val">{current.label}</span>
          </button>
          <button type="button" className="ss-replace" title="Replace" onClick={openPicker}>
            <i className="ti ti-pencil" aria-hidden="true" /> Replace
          </button>
        </div>
      ) : (
        <button
          type="button"
          {...ctlAttrs}
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
                  // Kept on every platform: this field IS the task (type your own Lore), so the
                  // keyboard appearing is what you want, unlike the search field above.
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
                            disabledReason={o.disabledReason}
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
                          title={o.disabled ? o.disabledReason : undefined}
                          aria-label={o.disabled && o.disabledReason ? `${o.label} — ${o.disabledReason}` : undefined}
                          onClick={() => {
                            onChange(o.value);
                            close();
                          }}
                        >
                          <span className="picker-check">{o.value === value && <i className="ti ti-check" aria-hidden="true" />}</span>
                          <div className="picker-text">
                            <div className="picker-name">{o.label}</div>
                            {o.note && <div className="picker-traits">{o.note}</div>}
                            {/* The shared "why you can't take this" line — same class, same wording
                                shape, in every picker. See .picker-why in sheet.css. */}
                            {o.disabled && o.disabledReason && <div className="picker-why">{o.disabledReason}</div>}
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
        </div>
      )}
      {/* At the fragment level (not inside {open}) so the FILLED slot's body can open a description
          without the picker being open. */}
      {descNode && <DescriptionModal root={descNode} onClose={() => setDescNode(null)} />}
    </>
  );
}

/** Read-first rows for a MULTI-pick choice (kineticist elements, animist apparitions, commander tactics…):
 *  each option's body opens its description card; a dedicated Add/Remove button toggles it — so pressing an
 *  option READS it instead of silently toggling. Replaces the old bare commit-on-click chips. Owns its
 *  description popup. */
export function MultiPickRows({
  options,
  selected,
  max,
  onToggle,
  keyName = 'origin',
}: {
  options: { id: string; name: string; note?: string; description?: string; descRefs?: DescRef[] }[];
  selected: string[];
  max: number;
  onToggle: (id: string) => void;
  keyName?: string;
}) {
  const [descNode, setDescNode] = useState<DescNode | null>(null);
  return (
    <>
      {/* Harness marker for the WG experience gate — one control per multi-pick group, with its capacity.
          `display: contents` keeps the rows direct children of their card row for layout purposes. */}
      <div
        style={{ display: 'contents' }}
        data-ctl="multi"
        data-ctl-title={keyName}
        data-ctl-options={options.length}
        data-ctl-live={options.filter((o) => selected.includes(o.id) || selected.length < max).length}
        data-ctl-capacity={max}
        data-ctl-state={selected.length ? 'picked' : 'empty'}
      >
      {options.map((o) => {
        const on = selected.includes(o.id);
        const node = descNodeOf({ name: o.name, description: o.description, descRefs: o.descRefs }, keyName);
        return (
          <PickerRow
            key={o.id}
            name={o.name}
            meta={o.note ? <div className="picker-traits">{o.note}</div> : undefined}
            chosen={on}
            onOpenDesc={node ? () => setDescNode(node) : undefined}
            selectLabel={on ? 'Remove' : 'Add'}
            selectDisabled={!on && selected.length >= max}
            disabledReason={!on && selected.length >= max ? `Choose up to ${max}` : undefined}
            onSelect={() => onToggle(o.id)}
          />
        );
      })}
      </div>
      {descNode && <DescriptionModal root={descNode} onClose={() => setDescNode(null)} />}
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
        options={skillFeats.map((f) => ({ id: f.id, name: f.name, description: f.description, descRefs: f.descRefs }))}
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
                  title={
                    rankAllowed(key, r)
                      ? undefined
                      : r === 3 && budget.rank3 === 0
                        ? '+3 skill potency begins at level 17.'
                        : `You have already spent every +${r} skill potency your level allows.`
                  }
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
  const [mythicRulesOpen, setMythicRulesOpen] = useState(false);
  const dualClass = !!build.variantRules?.dualClass;
  const abp = !!build.variantRules?.abp;
  const mythic = !!build.mythicEnabled;
  if (!dualClass && !abp && !mythic) return null;
  const cls2 = build.classId2 ? content.classes[build.classId2] : undefined;
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
          <p className="setup-hint">
            You gain a mythic feat slot at every even level (2&ndash;20). At 12th level that slot must buy a mythic{' '}
            <strong>destiny</strong>, and you can only ever have one. Mythic points power rerolls (Rewrite Fate) and
            mythic abilities; you start each session with 3.
          </p>
          <button type="button" className="mp-rules-link setup-rules-link" onClick={() => setMythicRulesOpen(true)}>
            <i className="ti ti-book-2" aria-hidden="true" /> Read the Mythic rules
          </button>
        </SetupCard>
      )}
      {mythic && build.level >= DESTINY_LEVEL && (
        <SetupCard icon="ti-star" label="Mythic Destiny">
          <PopupSelect
            title="Mythic Destiny"
            value={build.mythicDestiny ?? ''}
            onChange={(v) => actions.patch({ mythicDestiny: v || null })}
            clearLabel="Clear"
            options={destinyDedications(content).map((f) => ({
              value: f.archetype as string,
              label: f.name.replace(/ Dedication$/i, ''),
              description: f.description,
              descRefs: f.descRefs,
            }))}
          />
          <p className="setup-hint">
            Chosen once, at 12th level, and you can only ever have one. Your 12th-level mythic slot offers destiny
            dedications and nothing else; every mythic slot after it offers general mythic feats plus the feats of{' '}
            <em>this</em> destiny.
          </p>
        </SetupCard>
      )}
      {mythicRulesOpen && <MythicRules content={content} onClose={() => setMythicRulesOpen(false)} />}
    </>
  );
}

/**
 * A small "i" info affordance that opens a pinnable description popup for a Setup rule/toggle.
 *
 * `rule` is a `"<astBucket>:<slug>"` pointer at the PUBLISHED Pathfinder rules page for the option —
 * the real thing, with its tables and sub-headings, rather than the one-line gloss we wrote. The gloss
 * stays as `description` and is what shows for the options that have no printed rule to point at (the
 * dice roller, ration tracking, Overrides — app conveniences, not variant rules), and as the fallback
 * if a bucket ever fails to load.
 */
export function RuleInfo({ title, description, rule }: { title: string; description: string; rule?: string }) {
  const [open, setOpen] = useState(false);
  const [bucket, slug] = rule ? rule.split(':') : [];
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
      {open && (
        <DescriptionModal
          // 'setupRules' is a bucket that deliberately doesn't exist: it resolves to no ast, so a
          // rule-less option renders our own summary instead of guessing at a page by title.
          root={{ title, description, key: bucket ?? 'setupRules', slug }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** A toggle chip paired with its "i" info button, wrapped so the pair wraps together. */
function ToggleWithInfo({
  label,
  description,
  rule,
  on,
  onToggle,
  className,
  children,
}: {
  label: string;
  description: string;
  /** `"<astBucket>:<slug>"` of the option's published rules page — see RuleInfo. */
  rule?: string;
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
      <RuleInfo title={label} description={description} rule={rule} />
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
        {/* [flag, label, our one-line summary, the published rules page to open instead (see RuleInfo)] */}
        {(
          [
            ['ancestryParagon', 'Ancestry Paragon', 'Extra ancestry feats: two at level 1, then one more at every odd level (3, 5, 7 … 19) — 11 total.', 'rules:ancestry-paragon'],
            ['freeArchetype', 'Free Archetype', 'A bonus class feat at every even level (2–20) that may only be spent on archetype feats.', 'rules:free-archetype'],
            ['gradualBoosts', 'Gradual Attribute Boosts', 'The attribute boosts at 5/10/15/20 instead arrive one at a time at levels 2-5, 7-10, 12-15, 17-20.', 'rules:gradual-ability-boosts'],
            ['proficiencyWithoutLevel', 'Proficiency w/o Level', 'Remove your level from proficiency: untrained −2, trained +2, expert +4, master +6, legendary +8.', 'rules:proficiency-without-level'],
            ['abp', 'Automatic Bonus Progression', 'Gain item-equivalent attack/AC/save/Perception/skill bonuses automatically by level (replaces fundamental runes).', 'rules:automatic-bonus-progression'],
            ['dualClass', 'Dual Class', 'Gain the proficiencies, Hit Points, class features and class feats of a second class.', 'rules:dual-class-pcs'],
            ['pervasiveMagic', 'Pervasive Magic', 'Secrets of Magic variant: magic is common enough that any character can pick up minor spellcasting. Adds the Cantrip Casting / Basic / Expert / Master Spellcasting feat ladder to class feat slots.', 'rules:pervasive-magic'],
            // Monster Parts is a Treasure Vault subsystem with no rules page in the shipped set — our
            // summary is the only description available for it.
            ['monsterParts', 'Monster Parts', 'Harvest parts from defeated monsters to refine (fundamental-rune-equivalent bonuses) and imbue (special properties) your weapons, armor, shields, and Perception/skill items in place of runes and precious materials. An item uses either Monster Parts or normal runes — never both.', undefined],
          ] as const
        ).map(([flag, label, desc, rule]) => (
          <ToggleWithInfo
            key={flag}
            label={label}
            description={desc}
            rule={rule}
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
export function CampaignAttachCard({ build, actions, onLeaveCampaign }: EditorProps & { onLeaveCampaign?: (campaignId: string) => void }) {
  const auth = useAuth();
  const [memberships, setMemberships] = useState<CampaignMembership[]>(() => loadCampaigns());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const leave = async (m: CampaignMembership) => {
    const ok = await confirmDialog({
      title: `Leave “${m.name}”?`,
      message: 'You’ll leave this campaign and all of your characters will be removed from its party. You can rejoin later with the code.',
      confirmLabel: 'Leave campaign',
      danger: true,
    });
    if (!ok) return;
    onLeaveCampaign?.(m.id); // App: drop the membership (synced) + detach it from every character
    setMemberships((ms) => ms.filter((x) => x.id !== m.id)); // reflect in this card immediately
    actions.patch({ campaignIds: (build.campaignIds ?? []).filter((id) => id !== m.id) }); // and the draft build
  };

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
          {/* Players can leave a campaign entirely (drops the membership + detaches all their characters).
              A GM ends theirs by deleting it in the Campaigns page, so no leave button for GM rows. */}
          {onLeaveCampaign && memberships.some((m) => m.role === 'player') && (
            <div className="cmp-leave-list">
              {memberships
                .filter((m) => m.role === 'player')
                .map((m) => (
                  <button key={m.id} type="button" className="cmp-leave-btn" onClick={() => void leave(m)}>
                    <i className="ti ti-logout" aria-hidden="true" /> Leave “{m.name}”
                  </button>
                ))}
            </div>
          )}
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
            ['mythicEnabled', 'Mythic', 'War of Immortals mythic rules: gain a mythic calling + destiny, mythic feats, and mythic points. Off hides all mythic-trait content.', 'rules:mythic-rules'],
            // Kingmaker is a source book's worth of content rather than a rule, so there is no single
            // page to open — the summary stays.
            ['kingmakerEnabled', 'Kingmaker', 'Kingmaker Adventure Path player content: its backgrounds, feats, spells, items, and the camping activities (plus kingdom/army rules content).', undefined],
            ['deviantEnabled', 'Deviant abilities', 'Dark Archive deviant abilities — unstable powers a GM grants. On, a class feat can buy one of the 30 deviant feats; off, they are hidden. The rules put them entirely at the GM’s discretion, which is why they are a table opt-in rather than an ordinary feat.', 'rules:deviant-abilities'],
          ] as const
        ).map(([flag, label, desc, rule]) => (
          <ToggleWithInfo
            key={flag}
            label={label}
            description={desc}
            rule={rule}
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
/** Content-map name → what a player calls it, for the "this will be removed" list. */
const SOURCE_KIND_LABEL: Record<string, string> = {
  ancestries: 'Ancestry',
  heritages: 'Heritage',
  backgrounds: 'Background',
  classes: 'Class',
  feats: 'Feats',
  spells: 'Spells',
  items: 'Items',
  deities: 'Deity',
  actions: 'Actions',
  animalCompanions: 'Animal companions',
  companionSpecializations: 'Companion specializations',
  specificFamiliars: 'Familiars',
  familiarAbilities: 'Familiar abilities',
  companionAdvanced: 'Companion options',
};

export function SourcesCard({
  build,
  actions,
  catalog,
  content,
}: {
  build: BuildState;
  actions: BuilderActions;
  catalog: ReturnType<typeof sourceCatalog>;
  /** The UNFILTERED content (ovContent). It must see books that are currently off, or a chosen entry
   *  from a disabled book could not be named in the warning. */
  content: ContentDatabase;
}) {
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
  /**
   * Switching a book OFF when the character already took something from it.
   *
   * Turning a source off hides it from every picker. If the character has already chosen from it,
   * doing nothing makes the source list a lie (the book is "off" but its content is still on the
   * sheet), and dropping it silently deletes the player's choices without asking. So: name exactly
   * what would go, and only remove it if they say yes.
   */
  const setBooks = async (books: string[], on: boolean) => {
    const n = new Set(enabled);
    for (const b of books) on ? n.add(b) : n.delete(b);
    if (on) return write(n);

    const losing = chosenFromBooks(build, content, new Set(books));
    if (!losing.length) return write(n);

    const byKind = new Map<string, string[]>();
    for (const c of losing) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c.name]);
    const ok = await confirmDialog({
      title: losing.length === 1 ? `Remove ${losing[0].name}?` : `Remove ${losing.length} things from this character?`,
      message: (
        <>
          <p>
            This character already uses content from {books.length === 1 ? 'this book' : 'these books'}. Turning{' '}
            {books.length === 1 ? 'it' : 'them'} off will remove:
          </p>
          <ul className="src-losing">
            {[...byKind.entries()].map(([kind, names]) => (
              <li key={kind}>
                <strong>{SOURCE_KIND_LABEL[kind] ?? kind}:</strong> {names.slice(0, 8).join(', ')}
                {names.length > 8 ? ` and ${names.length - 8} more` : ''}
              </li>
            ))}
          </ul>
          <p>Anything else you chose is untouched, and you can turn the book back on and pick again.</p>
        </>
      ),
      confirmLabel: `Remove and turn off`,
      danger: true,
    });
    if (!ok) return;
    // patch takes a Partial<BuildState>; a whole rebuilt build is a valid one, and it must be applied
    // in ONE write so the source list and the removals can never land out of step.
    actions.patch(removeChosenIds({ ...build, enabledSources: [...n].sort() }, new Set(losing.map((c) => c.id))));
  };
  const setCategory = (g: SourceGroup, on: boolean) => setBooks(g.entries.flatMap((e) => e.books), on);
  return (
    <SetupCard icon="ti-books" label="Sources" count={`${enabledReal}/${allBooks.length}`}>
      <div className="src-wrap">
        <p className="ovr-intro">
          Choose which books this character can draw from. Disabled books are hidden from every picker. If you turn one
          off that this character already uses, you'll be told exactly what would be removed first. New characters start
          with the Core books only.
        </p>
        <ToggleWithInfo
          label="Hide legacy data"
          description="Show only remaster and edition-neutral content. Legacy and legacy-era (pre-remaster) entries are hidden from every picker. Superseded pre-remaster versions are always hidden regardless of this setting. Anything you've already selected stays available."
          on={!!build.hideLegacy}
          onToggle={() => actions.patch({ hideLegacy: !build.hideLegacy })}
        />
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

/** Snare Crafting formula book (Snarecrafter Dedication / Snare Crafting): the player picks the snare
 *  formulas they know — four common 1st-level snares, plus three more each time Crafting reaches
 *  expert / master / legendary. Rangers may drive this off Survival instead of Crafting. Render only
 *  when the character actually has Snare Crafting (gated at the call site). */
export function SnareFormulasCard({ build, actions, content, character }: EditorProps & { character: Character }) {
  const RANK_ORDER: ProficiencyRank[] = ['untrained', 'trained', 'expert', 'master', 'legendary'];
  const higher = (a: ProficiencyRank, b: ProficiencyRank) => RANK_ORDER[Math.max(RANK_ORDER.indexOf(a), RANK_ORDER.indexOf(b))];
  const isRanger = build.classId === 'ranger' || build.classId2 === 'ranger';
  const craftingRank = character.proficiencies.skills.crafting ?? 'untrained';
  const survivalRank = character.proficiencies.skills.survival ?? 'untrained';
  // Rangers "use Survival instead of Crafting for all functions of feats from this archetype" — so their
  // formula book scales off whichever of the two is higher.
  const drivingRank = isRanger ? higher(craftingRank, survivalRank) : craftingRank;
  // Plentiful Snares doubles what you can prepare; the formula alone could not be influenced.
  const { known, prepared } = snareAllowanceFor(drivingRank, character.feats.map((f) => f.featId), snareAllowance);
  const chosen = build.extraChoices?.[SNARE_FORMULA_KEY] ?? [];
  const setAt = (idx: number, id: string) => {
    const next = [...chosen];
    next[idx] = id;
    actions.patch({ extraChoices: { ...build.extraChoices, [SNARE_FORMULA_KEY]: next.slice(0, known) } });
  };
  return (
    <SetupCard icon="ti-tools" label="Snare formulas">
      <p className="setup-hint">
        Your formula book holds {known} snare formula{known === 1 ? '' : 's'}; you can prepare {prepared} of them for free
        each day. Scales with your {isRanger ? 'Survival or Crafting' : 'Crafting'} proficiency (currently {cap(drivingRank)}).
        Snares prepared this way cost no resources to Craft.
      </p>
      {Array.from({ length: known }).map((_, i) => {
        const base = isBaseSnareSlot(i);
        const opts = snareFormulaOptions(content, base ? 1 : character.level, base).map((it) => ({
          id: it.id,
          name: it.name,
          note: `Lvl ${it.level}`,
          description: it.description,
          descRefs: it.descRefs,
        }));
        return (
          <SubCard key={i} icon="ti-bulb" label={base ? `Formula ${i + 1} — common, 1st level` : `Formula ${i + 1} — up to level ${character.level}`}>
            <SearchSelect
              bare
              label="Snare formula"
              placeholder="Choose a snare…"
              value={chosen[i] ?? null}
              onChange={(id) => setAt(i, id)}
              options={opts}
            />
          </SubCard>
        );
      })}
    </SetupCard>
  );
}

/**
 * Formula-book grants: the formulas a feat or class feature lets the player write into their book.
 *
 * Each picker offers ONLY what its own record allows (ruling Q9), and answering one is FINAL — the
 * formula is copied into the book and belongs to it from then on, so the control disappears rather
 * than staying editable. Render only when the character has a grant (gated at the call site).
 */
export function FormulaBookCard({ build, actions, content, character }: EditorProps & { character: Character }) {
  const picks = build.formulaPicks ?? {};
  const slots = formulaSlots(character, content);
  // Pools are shared by every slot in a run, so they are resolved once per run rather than per slot —
  // an alchemist's book has forty slots and the alchemical-item pool is a thousand items long.
  const pools = new Map<string, { id: string; name: string; note?: string; description?: string; descRefs?: DescRef[] }[]>();
  const optionsFor = (slot: FormulaSlot) => {
    const key = `${slot.sourceId}#${slot.partIndex}`;
    let pool = pools.get(key);
    if (!pool) {
      pool = formulaOptions(slot, character, content).map((it) => ({
        id: it.id,
        name: it.name,
        note: `Lvl ${it.level ?? 0}`,
        description: it.description,
        descRefs: it.descRefs,
      }));
      pools.set(key, pool);
    }
    return pool;
  };
  // Grouped by RUN rather than by record: an alchemist has forty slots and they all say the same
  // thing, so one heading per run keeps the card readable instead of forty repeated labels.
  const runs = [...new Set(slots.map((s) => `${s.sourceId}#${s.partIndex}`))];
  return (
    <SetupCard icon="ti-book" label="Formula book" count={`${slots.filter((s) => picks[s.key]).length}/${slots.length}`}>
      <p className="setup-hint">
        Formulas you write into your formula book. Once written a formula belongs to the book — losing the book loses
        the formula, and the feat won't give it back. You can also fill these in from the book itself, on the sheet's
        Inventory tab.
      </p>
      {runs.map((run) => {
        const mine = slots.filter((s) => `${s.sourceId}#${s.partIndex}` === run);
        return (
          <SubCard
            key={run}
            icon="ti-bulb"
            label={`${mine[0].sourceName} · ${mine[0].label}`}
            count={`${mine.filter((s) => picks[s.key]).length}/${mine.length}`}
          >
            {mine[0].note && <p className="setup-hint">{mine[0].note}</p>}
            {mine.map((slot) => (
              <SearchSelect
                key={slot.key}
                bare
                label={slot.label}
                placeholder="Choose a formula…"
                value={picks[slot.key] ?? null}
                onChange={(id) => actions.patch({ formulaPicks: { ...picks, [slot.key]: id } })}
                options={optionsFor(slot)}
              />
            ))}
          </SubCard>
        );
      })}
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
    ...Object.values(content.feats).filter((f) => f.level <= build.level && !ov.addedFeats?.some((a) => a.featId === f.id)).map((f) => ({ id: `feat:${f.id}`, name: f.name, note: `Feat · ${cap(f.category)} · lvl ${f.level}`, description: f.description, descRefs: f.descRefs })),
    ...Object.values(content.classFeatures).filter((f) => !ov.addedFeatures?.some((a) => a.featureId === f.id)).map((f) => ({ id: `feature:${f.id}`, name: f.name, note: `Feature · lvl ${f.level}`, description: f.description, descRefs: f.descRefs })),
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
    .map((s) => ({ id: s.id, name: s.name, note: (s.ritual ? 'Ritual' : cap(s.traditions[0] ?? 'spell')) + ` · rank ${s.rank}`, description: s.description, descRefs: s.descRefs }));

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

      {/* Maximum HP. The engine has honoured hitPoints.maxOverride and had a dedicated breakdown
          line for it all along; nothing anywhere ever wrote it, so a finished feature had no control
          and the breakdown branch could never be seen. */}
      <SubCard icon="ti-heart" label="Set maximum HP" count={ov.maxHp != null ? 1 : undefined}>
        <div className="ovr-attrs">
          <label className={'ovr-attr' + (ov.maxHp != null ? ' on' : '')}>
            <span className="ovr-attr-k">Max HP</span>
            <input
              type="number"
              className="ovr-attr-in"
              value={ov.maxHp ?? character.hitPoints.current}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                writeOv({ maxHp: Number.isNaN(n) ? undefined : Math.max(1, n) });
              }}
            />
            {ov.maxHp != null && (
              <button type="button" className="ovr-attr-x" title="Revert to computed" onClick={() => writeOv({ maxHp: undefined })} aria-label="Revert maximum HP">
                <i className="ti ti-arrow-back-up" aria-hidden="true" />
              </button>
            )}
          </label>
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
          rule="sidebar:alternate-ancestry-boosts"
          on={!!opts.alternateAncestryBoosts}
          onToggle={() => set({ alternateAncestryBoosts: !opts.alternateAncestryBoosts })}
        />
        <ToggleWithInfo
          label="Ignore Bulk Limit"
          description="Disable the negative effects of carrying too much Bulk — no encumbered or over-limit warnings. A convenience option for tables that don't track encumbrance."
          // The option is ours; the rule it switches off is the published one, which is what someone
          // clicking "About" actually wants to read.
          rule="rules:bulk-limits"
          on={!!opts.ignoreBulk}
          onToggle={() => set({ ignoreBulk: !opts.ignoreBulk })}
        />
        <ToggleWithInfo
          label="Voluntary Flaw"
          description="Take an additional attribute flaw beyond your ancestry's (regardless of your ancestry) to gain no mechanical benefit but reflect your character's weakness. You pick which attribute takes the extra flaw at level 0."
          rule="sidebar:optional-voluntary-flaws"
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
    <div className="lvl-card lvl-card-setup" data-setupcard={label}>
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
    <div className="lvl-subcard" data-subcard={label}>
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
  // The heritage can SWAP one of the ancestry's fixed boosts/flaws (Full Moon Sarangay) — the same
  // adjusted view buildCharacter computes, so the picker and the math cannot disagree.
  const ancAttrs = ancestry
    ? heritageAdjustedAncestryAttributes(
        ancestry,
        build.heritageId ? content.heritages[build.heritageId] : undefined,
        build.heritageId ? build.featChoices?.[`heritage:${build.heritageId}`] : undefined,
      )
    : undefined;
  const ancSlots = !ancAttrs ? [] : altBoosts ? ([{ kind: 'free' }, { kind: 'free' }] as BoostSlot[]) : boostSlots(ancAttrs.abilityBoosts);
  const ancFixed = ancAttrs && !altBoosts ? fixedBoosts(ancAttrs.abilityBoosts) : [];
  // Through the effective view so an optional attribute trade (Song of the Deep's Special) opens its
  // second free slot the moment the answer flips.
  const bgSlots = background ? boostSlots(backgroundEffectiveBoosts(build, background)) : [];
  const bgFixed = background ? fixedBoosts(backgroundEffectiveBoosts(build, background)) : [];
  const subKey = subclassKeyAbility(build, content);
  // A racket-style subclass offers a key-attribute CHOICE (Dex or the racket's attribute) — show
  // the picker restricted to those; otherwise a multi-key class shows its own list.
  const subKeyOptions = cls?.subclass?.options.find((o) => o.id === build.subclassId)?.keyAbilityOptions;
  const keyOptions = subKeyOptions?.length ? subKeyOptions : !subKey && cls ? cls.keyAbility : [];
  const keyChoice = keyOptions.length > 1;
  const keyAbility = subKey ?? build.keyAbility ?? cls?.keyAbility[0] ?? null;
  const heritage = build.heritageId ? content.heritages[build.heritageId] : undefined;
  /*
   * A heritage choice can be NARROWED by a feat the character has taken — the seven dragonblood feats
   * filter which draconic exemplar is legal ("you must choose a dragon with a climb Speed"). The
   * narrowing funnel needs a built character, so one is memoised here; every other picker already
   * routes through the same funnel, and this card mapping raw options was the one that could not see
   * a choiceOptionLimits row at all.
   */
  const limitChar = useMemo(() => { try { return buildCharacter(build, content); } catch { return undefined; } }, [build, content]);
  // Level-1 general feats (skill feats are a subset of general feats) for a feat-granting heritage
  // (Versatile Human). Content-static, so memoize away per-keystroke re-filters.
  const heritageFeatOpts = useMemo(
    () =>
      Object.values(content.feats)
        .filter((f) => f.level <= 1 && (f.category === 'general' || f.category === 'skill'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ id: f.id, name: f.name, note: f.category === 'skill' ? 'skill feat' : undefined, description: f.description, descRefs: f.descRefs })),
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
          descBucket="ancestries"
          options={Object.values(content.ancestries).map((a) => ({ id: a.id, name: a.name, note: note(a.rarity), description: a.description, descRefs: a.descRefs }))}
        />
        {ancestry && (
          <ChoiceGrants
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
              exclude={altBoosts ? build.ancestryBoosts : [...build.ancestryBoosts, ...ancFixed, ...(ancAttrs?.abilityFlaws ?? [])]}
              onChange={(v) => actions.setBoost('ancestryBoosts', i, v)}
            />
          ))}
          {!altBoosts && (ancAttrs?.abilityFlaws.length ?? 0) > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--app-bad)' }}>
              flaw: {(ancAttrs?.abilityFlaws ?? []).map((a) => ABILITY_LABEL[a]).join(', ')}
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
          descBucket="heritages"
          options={heritageOpts.map((h) => ({ id: h.id, name: h.name, note: note(h.rarity), description: h.description, descRefs: h.descRefs }))}
        />
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
        </SubCard>
      )}
      {/* A "choose N Lores" heritage (Half Moon Sarangay: 2; Born of Item: 1) — free-text Lore subjects. */}
      {heritage?.loreChoices ? (
        <SubCard icon="ti-book" label={`Heritage Lore${heritage.loreChoices > 1 ? ` (choose ${heritage.loreChoices})` : ''}`}>
          {Array.from({ length: heritage.loreChoices }).map((_, i) => (
            <input
              key={i}
              className="lvl-lore-input"
              placeholder={`Lore subject ${heritage.loreChoices! > 1 ? i + 1 : ''}`.trim()}
              value={build.heritageLore?.[i] ?? ''}
              onChange={(e) => {
                const next = [...(build.heritageLore ?? [])];
                next[i] = e.target.value;
                actions.patch({ heritageLore: next });
              }}
            />
          ))}
          <p className="setup-hint">Type the subject (e.g. "Cooking" or "Sailing"); each becomes a trained Lore skill.</p>
        </SubCard>
      ) : null}
      {/* A choice-resistance heritage (Deep Fetchling: cold/void; Elementheart Kobold: an element's damage
          type): pick the damage type — resistance = half your level. Applied by deriveDefenses. */}
      {heritage?.choiceResistance && (
        <SubCard icon="ti-shield-half" label="Heritage resistance">
          <PopupSelect
            title="Resistance type"
            placeholder="Choose a resistance"
            value={build.heritageResistanceChoice ?? ''}
            onChange={(v) => actions.patch({ heritageResistanceChoice: v || null })}
            clearLabel="Clear"
            options={heritage.choiceResistance.options.map((o) => ({
              value: o.value,
              label: o.label.toLowerCase() === o.value ? cap(o.value) : `${o.label} (${o.value})`,
            }))}
          />
          <p className="setup-hint">Resistance to the chosen damage type equal to half your level (minimum 1).</p>
        </SubCard>
      )}
      {/* An ANCESTRY that asks a pick of its own. The surki's Magiphage — *"Choose what tradition of
          magic you most consumed as a larva"* — is the case: four records key off the answer and
          nothing asked the question, because only feats, class features and heritages were rendered.
          Stored beside the rest under `ancestry:<id>`. */}
      {ancestry?.choice &&
        (() => {
          const def = ancestry.choice!;
          const key = `ancestry:${ancestry.id}`;
          return (
            <SubCard icon="ti-adjustments" label={def.prompt}>
              {def.kind === 'text' ? (
                <input
                  className="txt"
                  type="text"
                  placeholder={`${def.prompt}…`}
                  value={build.featChoices[key] ?? ''}
                  onChange={(e) => actions.setFeatChoice(key, e.target.value)}
                />
              ) : (
                <PopupSelect
                  title={def.prompt}
                  placeholder={`${def.prompt}…`}
                  value={build.featChoices[key] ?? ''}
                  onChange={(v) => actions.setFeatChoice(key, v)}
                  options={(def.options ?? []).map((o) => ({ value: o.value, label: o.label, description: o.description }))}
                />
              )}
              {def.note && <p className="setup-hint">{def.note}</p>}
              {def.inert && <p className="setup-hint">{def.inert}</p>}
            </SubCard>
          );
        })()}
      {/* A heritage that asks for a pick of its own ("choose a type of animal" — Beastkin; "choose a
          patron" — Forge-Blessed Dwarf). Six heritages shipped one and none was ever rendered, because
          Heritage never declared the field. Stored beside the feat answers under `heritage:<id>`. */}
      {heritage?.choice &&
        (() => {
          const def = heritage.choice!;
          const key = `heritage:${heritage.id}`;
          /*
           * Routed through the SAME funnel as every feat picker, so a `choiceOptionLimits` row from a
           * taken feat narrows this list too. The dragonblood exemplar is the case: seven dragonblood
           * feats print *"you must choose a dragon with a climb Speed"* / *"…an arcane dragon"*, and
           * mapping raw options here was the one picker those limits could never reach. The active
           * limits' reasons print under the control, so a narrowed list explains itself.
           */
          const narrowed = limitChar ? narrowChoiceOptions(heritage.id, def, def.options ?? [], limitChar, content) : (def.options ?? []);
          const reasons = limitChar && def.options?.length ? effectiveChoiceLimits(heritage.id, def, limitChar, content).map((l) => l.reason).filter(Boolean) : [];
          return (
            <SubCard icon="ti-adjustments" label={def.prompt}>
              {def.kind === 'text' ? (
                <input
                  className="txt"
                  type="text"
                  placeholder={`${def.prompt}…`}
                  value={build.featChoices[key] ?? ''}
                  onChange={(e) => actions.setFeatChoice(key, e.target.value)}
                />
              ) : (
                <PopupSelect
                  title={def.prompt}
                  placeholder={`${def.prompt}…`}
                  value={build.featChoices[key] ?? ''}
                  onChange={(v) => actions.setFeatChoice(key, v)}
                  options={narrowed.map((o) => ({ value: o.value, label: o.label, description: o.description, disabled: !!(o as { disabled?: string }).disabled, disabledReason: (o as { disabled?: string }).disabled }))}
                />
              )}
              {reasons.map((r, i) => (
                <p key={`lim-${i}`} className="setup-hint">
                  {r}
                </p>
              ))}
              {def.note && <p className="setup-hint">{def.note}</p>}
              {def.inert && <p className="setup-hint">{def.inert}</p>}
            </SubCard>
          );
        })()}
      {/* A heritage that grants a PICKED feat (Ancient Elf → a multiclass dedication of another class,
          waiving its level prerequisite). Same lane as the feat pick-grants, keyed by heritage id. */}
      {build.heritageId &&
        FEAT_PICK_GRANTS[build.heritageId] &&
        (() => {
          const spec = FEAT_PICK_GRANTS[build.heritageId!];
          const opts = pickableFeats(spec, build, content).map((f) => ({ value: f.id, label: f.name, description: f.description }));
          return (
            <SubCard icon="ti-medal" label={spec.prompt}>
              <PopupSelect
                title={spec.prompt}
                placeholder={`${spec.prompt}…`}
                value={build.pickFeatChoices?.[build.heritageId!] ?? ''}
                onChange={(v) => actions.patch({ pickFeatChoices: { ...(build.pickFeatChoices ?? {}), [build.heritageId!]: v } })}
                options={opts}
              />
            </SubCard>
          );
        })()}
      {/* Heritage "choose one of N" effects (a chosen energy/sense/skill/cantrip).
          This used its own inline copy of the picker, written before EffectChoicesPicker existed and
          never updated: it mapped `ch.options` only, so the two heritages whose choice is an OPEN
          spell pick (Wellspring Gnome, Budding Speaker Centaur — "choose one cantrip from that
          tradition's spell list") rendered an EMPTY, unanswerable dropdown. The shared component
          resolves `spellFilter` into a searchable list, which is the whole reason it exists. */}
      {heritage && build.heritageId && (
        <EffectChoicesPicker
          recordId={build.heritageId}
          choices={heritage.effectChoices}
          build={build}
          actions={actions}
          content={content}
        />
      )}
      {/* The SECOND heritage's, for the same reason — buildCharacter resolves both. */}
      {(() => {
        const second = secondHeritageIdOf(build, content);
        return second && content.heritages[second]?.effectChoices?.length ? (
          <EffectChoicesPicker
            recordId={second}
            choices={content.heritages[second].effectChoices}
            build={build}
            actions={actions}
            content={content}
          />
        ) : null;
      })()}
      <SetupCard icon="ti-briefcase" label="Background">
        <SearchSelect
          bare
          label="Background"
          value={build.backgroundId}
          onChange={actions.changeBackground}
          options={[
            ...(showCustomBg ? [{ id: CUSTOM_BACKGROUND_ID, name: '✎ Custom background…' }] : []),
            ...Object.values(content.backgrounds).map((b) => ({
              id: b.id,
              name: b.name,
              note: note(b.rarity),
              description: b.description,
              descRefs: b.descRefs,
              // A printed ancestry gate (Sewer Dragon: kobold only) greys the option with its reason.
              disabled:
                b.ancestryPrerequisite?.length && build.ancestryId && !b.ancestryPrerequisite.includes(build.ancestryId)
                  ? `Requires the ${b.ancestryPrerequisite.map(cap).join(' or ')} ancestry.`
                  : undefined,
            })),
          ]}
        />
        {background && build.backgroundId !== CUSTOM_BACKGROUND_ID && (
          <ChoiceGrants
            grants={
              <div className="cc-grants">
                {(background.trainedSkill || background.trainedSkillChoice?.length || background.trainedLore) && (
                  <span className="cc-g">
                    <i className="ti ti-bulb" aria-hidden="true" /> Trained:{' '}
                    {background.trainedSkill
                      ? cap(background.trainedSkill)
                      : (background.trainedSkillChoice ?? []).map(cap).join(' or ')}
                    {/* One subject, or several — Undercover Lotus Guard grants Art Lore AND Underworld Lore. */}
                    {background.trainedLore
                      ? `${background.trainedSkill || background.trainedSkillChoice?.length ? ', ' : ''}${[background.trainedLore].flat().map(loreLabel).join(', ')}`
                      : ''}
                  </span>
                )}
                {backgroundGrantedFeats(background, build.backgroundSkillChoice)
                  .filter((id) => content.feats[id])
                  .map((id) => (
                    <span className="cc-g" key={id}>
                      <i className="ti ti-medal" aria-hidden="true" /> {content.feats[id].name}
                    </span>
                  ))}
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
      {/* "Legal Lore OR Underworld Lore" — two NAMED subjects, so a picker rather than a text box.
          These shipped with both subjects concatenated into one fake Lore ("Legal-lore-or-underworld
          Lore") and no question asked. Concordance Researcher takes FOUR of six
          (trainedLoreOptionsCount), so the card renders one picker per pick; each picker hides the
          other slots' answers, since training the same Lore twice is not a second training. */}
      {background && build.backgroundId !== CUSTOM_BACKGROUND_ID && (background.trainedLoreOptions ?? []).length > 0 && (
        <SubCard icon="ti-bulb" label="Background Lore">
          {(() => {
            const count = Math.min(background.trainedLoreOptionsCount ?? 1, background.trainedLoreOptions!.length);
            const slots = ['backgroundLore', 'backgroundLore2', 'backgroundLore3', 'backgroundLore4'] as const;
            const values = slots.map((k) => build[k] ?? '');
            // "plane-of-air" → "Plane of Air Lore"; bare cap() would render the hyphens.
            const loreLabel = (s: string) =>
              s.split('-').map((w, i) => (i > 0 && ['of', 'the', 'a', 'an', 'and'].includes(w) ? w : cap(w))).join(' ') + ' Lore';
            return slots.slice(0, count).map((k, i) => (
              <PopupSelect
                key={k}
                title="Background Lore"
                placeholder={count > 1 ? `Choose Lore ${i + 1}…` : 'Choose a Lore…'}
                value={values[i]}
                onChange={(v) => actions.patch({ [k]: v })}
                options={background
                  .trainedLoreOptions!.filter((s) => s === values[i] || !values.includes(s))
                  .map((s) => ({ value: s, label: loreLabel(s) }))}
              />
            ));
          })()}
        </SubCard>
      )}
      {/* A "choose a Lore" background: Lore is free-text, so let the player type any subject.
          A record naming a printed default (Night Watch's Legal) shows it as the placeholder; one
          asking for TWO subjects (Reborn Soul) renders a second box. */}
      {background && build.backgroundId !== CUSTOM_BACKGROUND_ID && background.trainedLoreChoice && !(background.trainedLoreOptions ?? []).length && (
        <SubCard icon="ti-bulb" label="Background Lore">
          <input
            className="lvl-lore-input"
            placeholder={background.trainedLoreChoiceDefault ? `${cap(background.trainedLoreChoiceDefault)} (default)…` : 'Lore subject (e.g. Warfare)…'}
            value={build.backgroundLore ?? ''}
            onChange={(e) => actions.patch({ backgroundLore: e.target.value })}
          />
          {(background.trainedLoreChoiceCount ?? 1) > 1 && (
            <input
              className="lvl-lore-input"
              placeholder="Second Lore subject…"
              value={build.backgroundLore2 ?? ''}
              onChange={(e) => actions.patch({ backgroundLore2: e.target.value })}
            />
          )}
          {(background.trainedLoreChoiceCount ?? 1) > 2 && (
            <input
              className="lvl-lore-input"
              placeholder="Third Lore subject…"
              value={build.backgroundLore3 ?? ''}
              onChange={(e) => actions.patch({ backgroundLore3: e.target.value })}
            />
          )}
        </SubCard>
      )}
      {/* The background's OWN embedded sub-choice — "an Ancestry Lore of your choice", "Guild Lore
          or Heraldry Lore", "a skill of your choice". 71 backgrounds carry one and `choice` was not
          declared on the Background type at all, so every one of them asked a question no player was
          ever shown. What the answer does is decided by backgroundChoiceKind, in the rules layer. */}
      {/* A DAILY background choice (Professional Letter Writer's extra language) is asked at Daily
          preparations, not here — the same Q23 guard the feat and class-feature sites carry. */}
      {background && build.backgroundId !== CUSTOM_BACKGROUND_ID && background.choice && !askedAtDailyPrep(background.choice) && (
        <SubCard icon="ti-adjustments" label={featChoicePrompt(background.choice.prompt, background.choice.flag)}>
          <PopupSelect
            title={featChoicePrompt(background.choice.prompt, background.choice.flag)}
            placeholder="Choose…"
            value={backgroundChoiceValue(build, background) ?? ''}
            onChange={(v) =>
              actions.patch({ featChoices: { ...build.featChoices, [backgroundChoiceKey(background.id)]: v } })
            }
            // Trailblazer names its terrain "(such as forest or underground)" — an illustrative list,
            // so `allowCustom` lets the player write the one they actually explored. Only choices that
            // opt in get the row; the field is what confines it, not the kind.
            options={withCustomAnswer(
              background.choice.kind === 'skills'
                ? trainedSkillOptions(buildCharacter(build, content), background.choice.minRank ?? 'trained')
                : (background.choice.options ?? []).map((o) => ({ value: o.value, label: o.label, description: o.description })),
              background.choice,
              backgroundChoiceValue(build, background),
            )}
            addCustom={
              background.choice.allowCustom && {
                ...background.choice.allowCustom,
                onAdd: (text) =>
                  actions.patch({ featChoices: { ...build.featChoices, [backgroundChoiceKey(background.id)]: text } }),
              }
            }
          />
          {/* An answer with no sheet number (a terrain, a constellation, a deviant classification)
              is RECORDED rather than silently dropped — being asked is the whole of what the record
              wants. Say so, so the player is not left wondering what it changed. */}
          {backgroundChoiceKind(background.choice, content) === 'other' && (
            <p className="confirm-note">Recorded on your sheet; this choice has no number of its own.</p>
          )}
        </SubCard>
      )}
      {/* A background pick-a-cantrip (Harrow-Chosen) — the background twin of the feat lane, same
          answer store keyed by the background id. */}
      {background && build.backgroundId !== CUSTOM_BACKGROUND_ID && BACKGROUND_CANTRIP_GRANTS[background.id] && (
        <SubCard icon="ti-sparkles" label={BACKGROUND_CANTRIP_GRANTS[background.id].prompt}>
          <PopupSelect
            title={BACKGROUND_CANTRIP_GRANTS[background.id].prompt}
            placeholder="Choose…"
            value={build.pickCantripChoices?.[background.id] ?? ''}
            onChange={(v) => actions.patch({ pickCantripChoices: { ...(build.pickCantripChoices ?? {}), [background.id]: v } })}
            options={BACKGROUND_CANTRIP_GRANTS[background.id].options
              .filter((s) => content.spells[s])
              .map((s) => ({ value: s, label: content.spells[s].name }))}
          />
        </SubCard>
      )}
      {/* The background's `effectChoices`. types.ts documented these as "rendered by the shared
          EffectChoicesPicker" and no such call existed, so Magical Experiment's sense and Local
          Savior's innate cantrip were resolved by buildCharacter from an answer nobody could give. */}
      {background && build.backgroundId !== CUSTOM_BACKGROUND_ID && background.effectChoices?.length && (
        <EffectChoicesPicker
          recordId={background.id}
          choices={background.effectChoices}
          build={build}
          actions={actions}
          content={content}
        />
      )}
      {/* A background can also offer a FEAT pick — "one Athletics skill feat of your choice",
          "Specialty Crafting or Multilingual". buildCharacter resolves these now, so they need a
          picker: without one the answer can never be given and the feat is never granted. */}
      {background && build.backgroundId !== CUSTOM_BACKGROUND_ID && FEAT_PICK_GRANTS[background.id] && (() => {
        const spec = FEAT_PICK_GRANTS[background.id];
        const opts = pickableFeats(spec, build, content).map((f) => ({ value: f.id, label: f.name, description: f.description }));
        return (
          <SubCard icon="ti-medal" label={spec.prompt}>
            <PopupSelect
              title={spec.prompt}
              placeholder={`${spec.prompt}…`}
              value={build.pickFeatChoices?.[background.id] ?? ''}
              onChange={(v) => actions.patch({ pickFeatChoices: { ...(build.pickFeatChoices ?? {}), [background.id]: v } })}
              options={opts}
            />
          </SubCard>
        );
      })()}
      {showCustomBg && build.backgroundId === CUSTOM_BACKGROUND_ID && (
        <CustomBackgroundForm build={build} actions={actions} content={content} />
      )}
      <SetupCard icon="ti-sword" label="Class">
        <SearchSelect
          bare
          label="Class"
          value={build.classId}
          onChange={requestClassChange}
          descBucket="classes"
          options={Object.values(content.classes).map((c) => ({ id: c.id, name: c.name, note: note(c.rarity), description: c.description, descRefs: c.descRefs }))}
        />
        {cls && (
          <ChoiceGrants
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
        </SetupCard>
      )}
      {(() => {
        // A restricted "trained in one of these" choice — from the subclass (Pistolero/Empiricism) OR
        // the class itself (thaumaturge's esoteric skill). Both store the pick in build.subclassSkill.
        const subOpt = cls?.subclass?.options.find((o) => o.id === build.subclassId);
        const choice = subOpt?.skillChoice?.length ? subOpt.skillChoice : cls?.trainedSkills.choice;
        if (!choice?.length) return null;
        // Empty until picked. buildCharacter still falls back to the first option so a half-built
        // character is legal, but the builder must not SHOW a skill the player never chose — that is
        // how a choice gets skipped. setupMissing lists it instead.
        const current = choice.includes(build.subclassSkill as SkillId) ? (build.subclassSkill as SkillId) : '';
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
        // Empty until picked — the dragon sets your spell tradition, so silently showing the first one
        // decides the most important thing about the character on the player's behalf.
        const cur = subOpt.dragonChoice.find((d) => d.slug === build.dragonExemplar)?.slug ?? '';
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
        const max = extraPickCount(g, build.level, build);
        if (max === 0) return null; // not yet unlocked at this level (e.g. higher-level epithets)
        // Clamped to `max` for the same reason the engine clamps: a Single Gate kineticist who
        // previously picked two elements still HAS both stored (so switching back to dual is
        // lossless), and an unclamped read here would print "2/1" and offer a second live row.
        const selected = (build.extraChoices[g.id] ?? []).slice(0, max);
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
              <MultiPickRows
                options={g.options.map((o) => ({ id: o.id, name: o.name, description: o.description, descRefs: o.descRefs }))}
                selected={selected}
                max={max}
                onToggle={(id) => actions.toggleExtraChoice(g.id, id, max)}
                keyName={g.name}
              />
            )}
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
                  // Empty until picked: showing allowed[0] made an unanswered choice look answered.
                  const cur = allowed.includes(build.grantedChoiceFeatTraits?.[key] ?? '')
                    ? build.grantedChoiceFeatTraits![key]
                    : '';
                  const lbl = (t: string) => {
                    const raw = feat?.choice?.options?.find((x) => x.value === t)?.label;
                    return raw ? featChoiceLabel(raw) : t.charAt(0).toUpperCase() + t.slice(1);
                  };
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
      {/* Thaumaturge Implement Adept (7) and Implement Paragon (17) pick from YOUR implements, so
          they can't be ChoiceGroups — a group's options are static content. Second Adept (11) needs
          no picker: it is whichever of your first two didn't get adept at 7. */}
      {ownsClass('thaumaturge') &&
        (() => {
          const imps = build.extraChoices?.['implement'] ?? [];
          const firstTwo = imps.slice(0, 2);
          if (build.level < 7 || firstTwo.length < 2) return null;
          const label = (id: string) => content.classFeatures[id]?.name ?? id;
          const adept7 = firstTwo.includes(build.implementAdept ?? '') ? build.implementAdept! : '';
          // Paragon may only name an implement you already have adept in. Below 11th that is the single
          // Adept pick, so until THAT is made there is genuinely nothing to choose from — an empty set,
          // not a defaulted one.
          const adeptSet = build.level >= 11 ? firstTwo : adept7 ? [adept7] : [];
          const paragon = adeptSet.includes(build.implementParagon ?? '') ? build.implementParagon! : '';
          return (
            <>
              <SubCard icon="ti-star" label="Implement Adept">
                <PopupSelect
                  title="Implement Adept"
                  value={adept7}
                  onChange={(v) => actions.patch({ implementAdept: v })}
                  options={firstTwo.map((id) => ({
                    value: id,
                    label: label(id),
                    description: content.classFeatures[`adept-benefit-${id}`]?.description,
                  }))}
                />
                {/* Gated on the pick as well as the level: with no Adept chosen, "the other one" is
                    whichever happened to be first in the list, which is not a fact yet. */}
                {build.level >= 11 && adept7 && (
                  <div className="setup-note">
                    Second Adept (11th) gives you the adept benefit of {label(firstTwo.find((x) => x !== adept7) ?? '')} as well.
                  </div>
                )}
              </SubCard>
              {build.level >= 17 && (
                <SubCard icon="ti-crown" label="Implement Paragon">
                  {adeptSet.length === 0 ? (
                    <span className="fixed-val">Choose your Implement Adept first — Paragon must name an implement you already have the adept benefit for.</span>
                  ) : (
                    <PopupSelect
                      title="Implement Paragon"
                      value={paragon}
                      onChange={(v) => actions.patch({ implementParagon: v })}
                      options={adeptSet.map((id) => ({
                        value: id,
                        label: label(id),
                        description: content.classFeatures[`paragon-benefit-${id}`]?.description,
                      }))}
                    />
                  )}
                  {/* The rules restrict paragon to an implement that ALREADY has the adept benefit,
                      which is why a third implement (gained at 15) never appears here. */}
                </SubCard>
              )}
            </>
          );
        })()}
      {/* …and the ARCHETYPE commander — *"You gain the tactics class feature like a commander and gain
          your own folio"*. Gating on the CLASS alone left a dedicated character with the feature, the
          banner and no way to put a single tactic in the folio. The capacity and the tier come from the
          same two helpers the engine uses, so the picker cannot offer a tactic the sheet then drops. */}
      {(ownsClass('commander') || Object.values(build.featPicks ?? {}).includes('commander-dedication')) &&
        (() => {
          const viaDedication = !ownsClass('commander');
          const featIds = Object.values(build.featPicks ?? {}).filter(Boolean) as string[];
          const options = commanderTacticOptions(build.level, content, commanderTierFor(build.level, featIds, viaDedication));
          const max = commanderFolioCapacity(build.level, featIds, viaDedication, content);
          const selected = build.commanderTactics ?? [];
          const toggle = (id: string) => {
            const on = selected.includes(id);
            const next = on ? selected.filter((x) => x !== id) : selected.length < max ? [...selected, id] : selected;
            actions.patch({ commanderTactics: next });
          };
          return (
            <SubCard icon="ti-chess" label="Tactics folio" count={`${selected.length}/${max}`}>
              <MultiPickRows
                options={options.map((o) => ({
                  id: o.id,
                  name: o.name,
                  note: o.tacticTier && o.tacticTier !== 'basic' ? o.tacticTier : undefined,
                  description: o.description,
                  descRefs: o.descRefs,
                }))}
                selected={selected}
                max={max}
                onToggle={toggle}
              />
            </SubCard>
          );
        })()}
      {/* The runesmith's runic repertoire — *"At 1st level, you learn four 1st-level runes of your
          choice … You can add any rune to your repertoire as long as it is common (or you have access
          to it) and its level is equal to or less than your own."* Each rune's own level is shown as
          the note, so a rune the character cannot take yet is visibly absent rather than mysteriously
          missing. Before this the runesmith's defining feature offered nothing at all. */}
      {/* …and for the ARCHETYPE runesmith, whose dedication grants its own smaller repertoire ("a
          runic repertoire with two 1st-level runes of your choice"). Gating this picker on the CLASS
          alone left a dedicated character holding a repertoire with no way to put anything in it. */}
      {(ownsClass('runesmith') || Object.values(build.featPicks ?? {}).includes('runesmith-dedication')) &&
        (() => {
          const viaDedication = !ownsClass('runesmith');
          const options = runesmithRuneOptions(build.level, content);
          const max = viaDedication
            ? runeRepertoireMaxViaDedication(build.level, content)
            : runeRepertoireMax(build.level, content);
          const selected = build.runesmithRunes ?? [];
          const toggle = (id: string) => {
            const on = selected.includes(id);
            const next = on ? selected.filter((x) => x !== id) : selected.length < max ? [...selected, id] : selected;
            actions.patch({ runesmithRunes: next });
          };
          return (
            <SubCard icon="ti-writing-sign" label="Runic repertoire" count={`${selected.length}/${max}`}>
              <MultiPickRows
                options={options.map((o) => ({
                  id: o.id,
                  name: o.name,
                  note: o.diacritic ? `diacritic · level ${o.level}` : `level ${o.level}`,
                  description: o.description,
                  descRefs: o.descRefs,
                }))}
                selected={selected}
                max={max}
                onToggle={toggle}
                keyName="Runic repertoire"
              />
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
          // Undefined until picked. That also does the right thing downstream: with no suit chosen,
          // inventorModificationOptions filters out BOTH suits' exclusive modifications and offers only
          // the ones any armour innovation can take.
          const armorStats = type === 'armor' ? build.inventorArmorStats ?? undefined : undefined;
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
                    value={armorStats ?? ''}
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
                  </SubCard>
                );
              })}
            </>
          );
        })()}
      {/* Elemental Blast: "choose one of your kinetic elements AND A DAMAGE TYPE LISTED FOR THAT
          ELEMENT". Only the first printed type was ever used, so half of a choice the rules give on
          every blast was invisible — and Versatile Blasts, whose whole content is adding to those
          lists, had nothing to add to. One row per element the character actually has. */}
      {ownsClass('kineticist') &&
        (() => {
          const c = buildCharacter(build, content);
          const rows = (c.kineticist?.elements ?? [])
            .map((el) => ({ el, types: blastTypesFor(c, content, el) }))
            .filter((r) => r.types.length > 1);
          if (!rows.length) return null;
          return (
            <SubCard icon="ti-bolt" label="Elemental Blast damage type">
              {rows.map(({ el, types }) => (
                <PopupSelect
                  key={el}
                  title={`${cap(el)} blast`}
                  // Empty until picked. These rows only exist when the element offers MORE than one
                  // damage type, so showing the first would be answering the very question the row asks.
                  value={build.blastTypes?.[el] ?? ''}
                  onChange={(v) => actions.patch({ blastTypes: { ...(build.blastTypes ?? {}), [el]: v } })}
                  options={types.map((t) => ({ value: t, label: `${cap(el)} — ${cap(t)}` }))}
                />
              ))}
            </SubCard>
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
                {cur === '' &&
                  (() => {
                    // Expand the Portal grants a bonus impulse feat of your level for one of your elements.
                    const elements = [
                      ...base,
                      ...Object.entries(build.gateForks ?? {})
                        .filter(([k]) => Number(k) <= L)
                        .map(([, v]) => v),
                    ].map((id) => id.replace(/-gate$/, ''));
                    const KINETIC_ELEMENTS = ['air', 'earth', 'fire', 'metal', 'water', 'wood'];
                    const impulses = Object.values(content.feats)
                      .filter((f) => {
                        if (!f.traits.includes('impulse') || f.level > L) return false;
                        // Element-traited impulses need a matching element; elementless ones always qualify.
                        const featElements = f.traits.filter((t) => KINETIC_ELEMENTS.includes(t));
                        return !featElements.length || featElements.some((t) => elements.includes(t));
                      })
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
                {cur !== '' &&
                  (() => {
                    /*
                     * FORK THE PATH grants an impulse feat too — this picker did not exist, and the
                     * grant loop skipped a forked threshold outright, so a kineticist who forked got the
                     * new element and NO feat (up to four short by 17th).
                     *
                     * Its filter is narrower than Expand's, exactly as printed: *"Gain an impulse feat
                     * of your level or lower WITH THE TRAIT OF THAT ELEMENT. You can't select a
                     * COMPOSITE impulse feat with this feat selection."* So: the newly-forked element
                     * only, and no composites — where Expand allows any owned element and does permit
                     * a composite.
                     */
                    const forked = cur.replace(/-gate$/, '');
                    const impulses = Object.values(content.feats)
                      .filter(
                        (f) =>
                          f.traits.includes('impulse') &&
                          f.level <= L &&
                          f.traits.includes(forked) &&
                          !f.traits.includes('composite'),
                      )
                      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
                    return (
                      <div className="ec-subpick">
                        <span className="ec-subpick-label">Bonus impulse</span>
                        <PopupSelect
                          title="Fork the Path — bonus impulse feat (that element, non-composite)"
                          value={build.gateForkImpulses?.[key] ?? ''}
                          onChange={(v) => actions.patch({ gateForkImpulses: { ...(build.gateForkImpulses ?? {}), [key]: v } })}
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
          // Empty until picked. Showing the first attuned apparition made an unmade choice look made;
          // buildCharacter falls back to that same first one, so the character still works meanwhile.
          const current = attuned.includes(build.primaryApparition ?? '') ? build.primaryApparition! : '';
          return (
            <SubCard icon="ti-star" label="Primary apparition">
              <PopupSelect
                title="Primary apparition"
                value={current}
                onChange={(v) => actions.patch({ primaryApparition: v })}
                options={opts}
              />
            </SubCard>
          );
        })()}
      {/* buildUsesDeity, not buildNeedsDeity: a sorcerer who took Blessed Blood needs the picker
          even though their class never asks for a deity. The narrower predicate also drives the
          favored-weapon proficiency, which is a cleric benefit, so it stays where it is. */}
      {buildUsesDeity(build, content) && (
        <SetupCard icon="ti-flare" label="Deity">
          <SearchSelect
            bare
            label="Deity"
            value={build.deityId}
            onChange={actions.changeDeity}
            descBucket="deities"
            options={Object.values(content.deities).map((d) => ({
              id: d.id,
              name: d.name,
              note: [note(d.rarity), d.domains?.slice(0, 3).join(', ')].filter(Boolean).join(' · ') || undefined,
              description: d.description,
              descRefs: d.descRefs,
            }))}
          />
          {/* A deity can ask a question of its own — Lurlup's "Sanctification: can be Unholy". Deities
              were the one chosen record with no pick surface at all, so the answer had nowhere to go. */}
          <EffectChoicesPicker
            recordId={build.deityId ?? ''}
            choices={build.deityId ? content.deities[build.deityId]?.effectChoices : undefined}
            build={build}
            actions={actions}
            content={content}
          />
        </SetupCard>
      )}
      {/* Living Rune: "Your body can hold a single property rune." A rune with no item to sit on —
          nothing etches it and every reader of etched runes walks the inventory — so it needs its own
          choice here. The offered list applies the feat's own two exclusions. */}
      {Object.values(build.featPicks).includes('living-rune') &&
        (() => {
          const opts = Object.values(content.runes ?? {})
            .filter((r) => r.slot === 'armor' && r.kind === 'property' && !bodyRuneExcluded(r, content))
            .sort((a, b) => (content.items[a.id]?.name ?? a.id).localeCompare(content.items[b.id]?.name ?? b.id));
          const cur = build.bodyRune ?? '';
          return (
            <SetupCard icon="ti-body-scan" label="Living rune">
              <PopupSelect
                title="Property rune on your body"
                value={opts.some((o) => o.id === cur) ? cur : ''}
                onChange={(v) => actions.patch({ bodyRune: v || null })}
                options={[
                  { value: '', label: 'None yet' },
                  ...opts.map((r) => ({
                    value: r.id,
                    label: content.items[r.id]?.name ?? r.id,
                    description: content.items[r.id]?.description,
                    descRefs: content.items[r.id]?.descRefs,
                  })),
                ]}
              />
              <div className="cmp-note">
                Runes with a requirement on the type or category of armor, and runes whose effect is on the armor rather
                than its wearer, can't go on your body — those are left out of this list. If you wear armor, this rune's
                effects apply in addition to the armor's own.
              </div>
            </SetupCard>
          );
        })()}
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
          /* A feat can widen THIS pool — Psi Development's extra known cantrip (`spellSlotBonus` with
           * `cantrips`) and its six psi cantrips (`spellListAdditions`), both scoped by `entryId` to
           * `${dedicationId}-casting`, the same gate buildCharacter's archCantripBonus uses — so the
           * cap the picker enforces and the cap the sheet keeps cannot disagree. The list union
           * matters because the six unique psi cantrips ship `traditions: []` and the tradition
           * filter alone would never offer them. */
          const takenIds = Object.values(build.featPicks).filter((v): v is string => !!v);
          const archEntryIds = archetypeEntryIds(arch);
          const archCantripBonus = takenIds.reduce((n, id) => {
            const b = content.feats[id]?.spellSlotBonus;
            return b?.entryId && archEntryIds.has(b.entryId) ? n + (b.cantrips ?? 0) : n;
          }, 0);
          const cantripCap = arch.config.cantrips + archCantripBonus;
          const widened = new Set<string>();
          for (const id of takenIds) {
            const list = content.feats[id]?.spellListAdditions;
            for (const add of list == null ? [] : Array.isArray(list) ? list : [list]) {
              if (add.as && add.as !== 'list') continue;
              if (add.entryId && !archEntryIds.has(add.entryId)) continue;
              for (const sid of add.spells ?? []) if (content.spells[sid]?.rank === 0) widened.add(sid);
            }
          }
          const cantripList = Object.values(content.spells)
            .filter((s) => (s.rank === 0 && s.traditions.includes(trad)) || widened.has(s.id))
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
              <SubCard icon="ti-sparkles" label={`Cantrips (${as.cantrips.length}/${cantripCap})`}>
                <PopupSelect
                  title="Add a cantrip"
                  value=""
                  onChange={(v) => v && actions.toggleArchetypeCantrip(v, cantripCap)}
                  options={cantripList.map((s) => ({ value: s.id, label: s.name, description: s.description, descRefs: s.descRefs }))}
                />
                {as.cantrips.length > 0 && (
                  <div className="spr-chips" style={{ marginTop: 6 }}>
                    {as.cantrips.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="ec-chip on"
                        onClick={() => actions.toggleArchetypeCantrip(id, cantripCap)}
                      >
                        {content.spells[id]?.name ?? id} ✕
                      </button>
                    ))}
                  </div>
                )}
                {/* An innate-ranked archetype has no slots to prepare into — its leveled spells are
                    LEARNED here, one per rank. Saying "prepare them on the Spells tab" to a captivator
                    was a false promise: that tab has nothing for them to prepare. */}
                {!arch.config.innateRanked && (
                  <div className="bsec-note">Prepare leveled archetype spells on the Spells tab.</div>
                )}
              </SubCard>
              {arch.config.innateRanked && (
                <SubCard icon="ti-book" label="Learned spells">
                  {/* Captivator: *"you learn a 1st-level spell… at 6th level a 2nd-level spell, and at
                      8th a 3rd"*, each cast as an innate spell 1/day. One pick per unlocked rank. */}
                  {Object.keys(archetypeSlots(build.level, arch))
                    .map(Number)
                    .filter((r) => r > 0)
                    .sort((a, b) => a - b)
                    .map((rank) => (
                      <PopupSelect
                        key={rank}
                        title={`Rank ${rank} spell`}
                        value={(as.spells?.[rank] ?? [])[0] ?? ''}
                        onChange={(v) => actions.setArchetypePoolSpell(rank, v || null)}
                        options={Object.values(content.spells)
                          .filter((s) => s.rank === rank && s.traditions.includes(trad))
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((s) => ({ value: s.id, label: s.name, description: s.description, descRefs: s.descRefs }))}
                      />
                    ))}
                </SubCard>
              )}
            </SetupCard>
          );
        })()}
      {(cls?.features ?? []).some((f) => f.featureId === 'devotion-spells') && (
        <SetupCard icon="ti-sparkles" label="Devotion spell">
          {/* Empty until picked. championDevotionSpell's fallback is a font-based DEFAULT, not a
              derived fact, so showing it made the choice look as though it had already been answered. */}
          <PopupSelect
            title="Devotion spell"
            value={build.devotionSpell ?? ''}
            onChange={(v) => actions.patch({ devotionSpell: v || null })}
            options={championDevotionOptions(build, content).map((id) => ({
              value: id,
              label: content.spells[id]?.name ?? id,
              description: content.spells[id]?.description,
              descRefs: content.spells[id]?.descRefs,
            }))}
          />
        </SetupCard>
      )}
      {(cls?.features ?? []).some((f) => f.featureId === 'voice-of-nature') && (
        <SetupCard icon="ti-leaf" label="Voice of Nature">
          {/* Empty until picked — Animal and Plant Empathy are a real choice, not a default with an
              alternative. */}
          <PopupSelect
            title="Voice of Nature"
            value={build.voiceOfNature ?? ''}
            onChange={(v) => actions.patch({ voiceOfNature: v || null })}
            options={[
              { value: 'animal-empathy', label: content.feats['animal-empathy']?.name ?? 'Animal Empathy', description: content.feats['animal-empathy']?.description, descRefs: content.feats['animal-empathy']?.descRefs },
              { value: 'plant-empathy', label: content.feats['plant-empathy']?.name ?? 'Plant Empathy', description: content.feats['plant-empathy']?.description, descRefs: content.feats['plant-empathy']?.descRefs },
            ]}
          />
        </SetupCard>
      )}
      {/* *"When you gain your first qi spell, you decide whether your qi spells are divine or occult
          spells."* ONE decision for the character, however many qi spells they end up with and whichever
          record brought the first — so a Setup card, not a per-feat pick. Before this the app silently
          chose occult for everyone. */}
      {qiSpellsPossible(build, content) && (
        <SetupCard icon="ti-yin-yang" label="Qi spell tradition">
          <div className="bsec-note">
            When you gain your first qi spell you decide whether your qi spells are divine or occult. Your
            key spellcasting attribute is Wisdom either way.
          </div>
          <PopupSelect
            title="Qi spell tradition"
            value={build.qiTradition ?? ''}
            onChange={(v) => actions.patch({ qiTradition: (v || null) as 'divine' | 'occult' | null })}
            options={[
              { value: 'occult', label: 'Occult' },
              { value: 'divine', label: 'Divine' },
            ]}
          />
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
  // If the character has ATTRIBUTE OVERRIDES (Overrides section — force raw scores), those PIN the
  // ability scores: boosts and even a class change won't move them. That silently looks like "my
  // stats don't update", so surface it right here where boosts are edited, with a one-click clear.
  const pinned = Object.keys(build.overrides?.attributes ?? {}) as AbilityId[];
  const clearAttrOverrides = () => {
    const ov = { ...(build.overrides ?? {}) };
    delete ov.attributes;
    actions.patch({ overrides: Object.keys(ov).length ? ov : undefined });
  };
  return (
    <SetupCard icon="ti-arrow-up" label="Free boosts" count="4">
      {pinned.length > 0 && (
        <div className="attr-override-warn">
          <i className="ti ti-lock" aria-hidden="true" />
          <span>
            {pinned.length === 6 ? 'All ability scores are' : `${pinned.map((a) => ABILITY_LABEL[a]).join(', ')} ${pinned.length === 1 ? 'is' : 'are'}`} set by
            an Override — boosts and class changes won't change {pinned.length === 1 ? 'it' : 'them'}.
          </span>
          <button type="button" className="attr-override-clear" onClick={clearAttrOverrides}>
            Clear override{pinned.length === 1 ? '' : 's'}
          </button>
        </div>
      )}
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

/**
 * The class's free "trained skills" picks.
 *
 * ⚠ The granted-skill set comes from the ENGINE (`Character.grantedSkills`), not from a copy made
 * here. The copy this used to keep knew four sources — class-fixed, background, subclass grants,
 * heritage — while `buildCharacter` locks nine, so a thaumaturge's esoteric skill, a second class's
 * skills, a background's own sub-choice, a draconic sorcerer's dragon skill and a cleric's deity
 * skill were all offered in this picker, accepted by `toggleSkill`, counted against the budget, and
 * then silently dropped by the build. That is exactly the Q27 bug, in its worst form: the pick
 * looked spent and bought nothing.
 *
 * They are now SHOWN and GREYED with the source named, rather than hidden — the owner's wording is
 * "instead I want them greyed out", and a player who can see "Nature — already trained (your
 * background)" learns something a missing row cannot tell them.
 */
export function SkillEditor({ build, actions, content, character }: EditorProps & { character?: Character }) {
  const preview = useMemo(() => character ?? buildCharacter(build, content), [character, build, content]);
  const addlCount = additionalClassSkills(build, content);
  const grantedFrom = preview.grantedSkills ?? {};
  const locked = new Set<string>(Object.keys(grantedFrom));

  // Count only picks NOT already granted (a class skill that a later subclass/background
  // also grants shouldn't consume a pick or double-count toward the cap).
  const chosen = build.classSkills.filter((s) => !locked.has(s));
  const chosenSkills = chosen.filter((k) => !k.startsWith('lore:'));
  const chosenLores = chosen.filter((k) => k.startsWith('lore:'));
  // Every skill that isn't already filling one of the slots above. The granted ones stay in the list
  // and are greyed below — they are the whole point of Q27.
  const available = SKILLS.filter((s) => !chosen.includes(s));

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
              options={available.map((s) => ({
                value: s,
                label: cap(s),
                disabled: locked.has(s),
                disabledReason: locked.has(s) ? `Already trained — from ${grantedFrom[s]}.` : undefined,
              }))}
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
  /* The printed "Choose from …" list on the ancestry's Languages line. Surfaced FIRST rather than
   * enforced, because print keeps the escape clause "and any other languages to which you have
   * access (such as the languages prevalent in your region)" — a hard filter would delete a printed
   * permission. Every batch-19 ancestry ships the list; older records without one change nothing. */
  const listed = new Set(ancestry?.languages.options ?? []);
  const available = Object.values(content.languages)
    .filter((l) => !granted.includes(l.id) && !chosen.includes(l.id))
    .sort((a, b) => (listed.has(b.id) ? 1 : 0) - (listed.has(a.id) ? 1 : 0) || a.name.localeCompare(b.name))
    .map((l) => (listed.has(l.id) ? { ...l, name: `${l.name} · ${ancestry?.name ?? 'ancestry'} list` } : l));
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
  character,
}: {
  label: string;
  value: ReactNode;
  rank?: ProficiencyRank;
  refTarget?: StatRef;
  onOpenStat?: (ref: StatRef) => void;
  /** When supplied, a `*` flags the row if a feat/mode grants a situational bonus to this stat. */
  character?: Character;
}) {
  const clickable = !!(refTarget && onOpenStat);
  // The content DB is optional here purely so this row keeps working outside a ContentContext; with
  // it, class-feature situational bonuses are included alongside feats, items, heritage and background.
  const db = useContent();
  const sit = !!(refTarget && character && statHasSituational(character, refTarget, db ?? undefined));
  return (
    <div
      className={'brow' + (clickable ? ' brow-open' : '') + (sit ? ' has-mode' : '')}
      onClick={clickable ? () => onOpenStat!(refTarget!) : undefined}
      title={clickable ? `${label} — how is this calculated?` : undefined}
    >
      <span className="bk">
        {rank && <RankPill rank={rank} />}
        <span className="bk-text">
          {label}
          {sit && <SituationalStar />}
        </span>
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
  const perception = derivePerception(preview, content);
  const classDc = deriveClassDc(preview);
  const entry = preview.spellcasting[0];
  const spell = entry ? deriveSpellcasting(preview, entry) : null;
  return (
    <>
      <div className="brow">
        <span className="bk">{preview.name || 'New character'}</span>
        <span className="bv">Lv {preview.level}</span>
      </div>
      {/* `character` is what lets a row show the situational `*`; leaving it off silently hides every
          conditional bonus on that stat, which is how HP / Class DC / the spell rows went unmarked. */}
      <StatLine label="Hit points" value={deriveMaxHp(preview, content)} refTarget={{ kind: 'hp' }} onOpenStat={onOpenStat} character={preview} />
      <StatLine label="Armor class" value={ac.value} rank={ac.rank} refTarget={{ kind: 'ac' }} onOpenStat={onOpenStat} character={preview} />
      <StatLine
        label="Perception"
        value={formatMod(perception.modifier)}
        rank={perception.rank}
        refTarget={{ kind: 'perception' }}
        onOpenStat={onOpenStat}
        character={preview}
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
            character={preview}
          />
        );
      })}
      <StatLine label="Class DC" value={classDc.dc} rank={classDc.rank} refTarget={{ kind: 'classDc' }} onOpenStat={onOpenStat} character={preview} />
      {spell && entry && (
        <>
          <StatLine
            label="Spell DC"
            value={spell.dc}
            rank={entry.proficiency}
            refTarget={{ kind: 'spell', entryId: entry.id, which: 'dc' }}
            onOpenStat={onOpenStat}
            character={preview}
          />
          <StatLine
            label="Spell attack"
            value={formatMod(spell.attack)}
            rank={entry.proficiency}
            refTarget={{ kind: 'spell', entryId: entry.id, which: 'attack' }}
            onOpenStat={onOpenStat}
            character={preview}
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
        {ABILITIES.map((ab) => {
          const pinned = build.overrides?.attributes?.[ab] !== undefined;
          return (
            <div
              className={'fs-ab fs-ab-open' + (pinned ? ' fs-ab-pinned' : '')}
              key={ab}
              onClick={() => setStatRef({ kind: 'ability', ability: ab })}
              title={pinned ? `${ABILITY_LABEL[ab]} is set by an Override — boosts don't change it` : `${ABILITY_LABEL[ab]} — how is this calculated?`}
            >
              <div className="fs-an">
                {ABILITY_LABEL[ab]}
                {pinned && <i className="ti ti-lock fs-ab-lock" aria-hidden="true" />}
              </div>
              <div className="fs-av">{abilities[ab]}</div>
              <div className="fs-am">{formatMod(abilityMod(abilities[ab]))}</div>
            </div>
          );
        })}
      </div>
      <LiveStats build={build} content={content} onOpenStat={setStatRef} character={preview} />
      <StatLine label="Speed" value={`${speed} ft`} refTarget={{ kind: 'speed' }} onOpenStat={setStatRef} />

      {/* Resistances/weaknesses/immunities the build has produced so far. Renders nothing until the
          character actually has one, so it never pads the panel for the majority who have none — but
          when an ancestry or item grants one, you see it while choosing rather than after saving. */}
      <DefensesPills character={preview} content={content} />

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
              character={preview}
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

/**
 * The "choose one of N" picker for a record's `effectChoices`, wherever that record lives.
 *
 * THE BUG THIS FIXES. effectChoices were rendered for feats (Builder.tsx) and heritages only, but
 * build.ts RESOLVES them for class features, class-feature options and inventory items too. So 50
 * records — 15 class features, 33 items, 2 backgrounds — carried a choice the engine was waiting on
 * and no screen ever asked. The pick was authored, resolved and unanswerable.
 *
 * One component for every surface, so a new one can never drift from the others again. The pick is
 * stored under `${recordId}:${choiceId}`, which is exactly the key resolvePick() reads.
 */
export function EffectChoicesPicker({
  recordId,
  choices,
  build,
  actions,
  content,
}: {
  recordId: string;
  choices: EffectChoice[] | undefined;
  build: BuildState;
  actions: BuilderActions;
  content: ContentDatabase;
}) {
  if (!choices?.length) return null;
  return (
    <>
      {/* A branch belonging to ONE class feature is asked only of a character who owns it —
          Syncretism prints one branch for a cloistered cleric and another for a warpriest. Shared with
          the appliers through `effectChoiceOffered`, so a question the player never sees can never
          apply, and one they answered cannot vanish while its grant stays. */}
      {choices.filter((ch) => effectChoiceOffered(ch, build, content, recordId)).map((ch) => {
        const ecKey = `${recordId}:${ch.id}`;
        const set = (v: string) => actions.patch({ effectChoices: { ...(build.effectChoices ?? {}), [ecKey]: v } });
        /* An OPEN pick from content that is NOT a spell — Syncretism's second favored weapon. Resolved
         * by the same `openChoiceOptions` the `choice.kind: 'open'` lane uses, so the two cannot
         * disagree about what a `weapon` pick admits. */
        if (ch.openFrom) {
          const opts = openChoiceOptions(ch.openFrom, content, { hideLegacy: build.hideLegacy });
          return (
            <SubCard key={`ec-${ecKey}`} icon="ti-adjustments" label={ch.prompt}>
              <SearchSelect bare label={ch.prompt} placeholder="Search…" value={build.effectChoices?.[ecKey] ?? null} onChange={set} options={opts} />
            </SubCard>
          );
        }
        // An OPEN pick ("any 1st-rank arcane spell") gets a searchable list; a fixed set gets the
        // dropdown. Hidden until its unlock level, same as the feat path.
        if (ch.spellFilter) {
          if (build.level < (ch.spellFilter.minLevel ?? 1)) return null;
          const opts = spellsMatching(narrowSpellFilter(ch.spellFilter, build, content), content, build.hideLegacy).map((s) => ({
            id: s.id,
            name: s.name,
            note: (s.rank ?? 0) === 0 ? 'Cantrip' : `${s.rank} rank`,
          }));
          return (
            <SubCard key={`ec-${ecKey}`} icon="ti-sparkles" label={ch.prompt}>
              <SearchSelect bare label="Spell" placeholder="Search spells…" value={build.effectChoices?.[ecKey] ?? null} onChange={set} options={opts} />
            </SubCard>
          );
        }
        return (
          <SubCard key={`ec-${ecKey}`} icon="ti-adjustments" label={ch.prompt}>
            <PopupSelect
              title={ch.prompt}
              placeholder={`${ch.prompt}…`}
              value={build.effectChoices?.[ecKey] ?? ''}
              onChange={set}
              // An option may carry a note instead of a grant (a kineticist gate junction: only
              // Elemental Resistance moves a stat), so the note is shown as the description.
              options={(ch.options ?? []).map((o) => ({ value: o.value, label: o.label, description: o.note }))}
            />
          </SubCard>
        );
      })}
    </>
  );
}

/**
 * What this character rolls for initiative.
 *
 * Its own component, and NOT part of SetupUnlockedChoices: that one is gated on a variant rule being
 * on — at the call site as well as inside it — so an Initiative card placed there rendered for nobody
 * playing without Dual Class, ABP or Mythic, which is almost everybody.
 */
/*
 * There is deliberately no Initiative picker in the builder.
 *
 * It used to render one, and it was wrong about the rules: "when you roll for initiative, you
 * typically roll a Perception check … sometimes the GM might call for a different type of check."
 * That is a decision made per encounter, by the GM, out of what the character was doing at the time —
 * not a property of the character you settle once while building them. Presenting it as a build slot
 * made it look like every character has to pick one, and left an empty "Choose…" sitting on the origin
 * page for a question with a correct default.
 *
 * The DATA is untouched: `initiativeSkill` still exists, deriveInitiative still reads it, the ~45
 * initiative bonuses still resolve, and a character that already had one keeps it. Only the build-time
 * question is gone. If it should be settable at all, its home is the sheet, per encounter.
 */
