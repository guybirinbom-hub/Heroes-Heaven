import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { listValues } from '../data';
import './builder.css';
import {
  attributeBoostCount,
  GRADUAL_BOOST_SETS,
  type BuildState,
  buildCharacter,
  applyOverrides,
  applySources,
  applyContentToggles,
  applyEditionFilter,
  collectChosenIds,
  dedicationBlock,
  checkPrerequisites,
  forbiddenFeatReason,
  emptyBuild,
  featChoiceLabel,
  featChoicePrompt,
  buildChoiceOptions,
  classSubPickOrder,
  classCantripBonus,
  classArchetypeSpellMods,
  legacyArchetypeCantrips,
  levelGrants,
  levelChoices,
  loreKey,
  subclassAnchorAt,
  backgroundGrantedFeats,
  boundGrantChoice,
  boundBackgroundGrantChoice,
  choiceKeys,
  choiceOptionsFor,
  withCustomAnswer,
} from '../rules/build';
import { OPEN_SOURCE_LABEL, openChoiceOptions } from '../rules/openChoice';
import { DOMAIN_SPELLS } from '../rules/domains';
import { confirmDialog } from '../sheet/confirm';
import { sourceCatalog, enabledBookSet, mythicCallingRecords, sourceIdToken, sourceRowLabelsFor, storedSources } from '../rules/sources';
import { eligibleFeatsForSlot, findHiddenFeatMatches, fitsSlot, moveTargetFor, swapSlotKeys } from '../rules/featSlots';
import { classFeatureDescription } from '../rules/featureText';
import {
  resolveBackground,
  restrictedSkillIncreaseAllowed,
  backgroundSkillIncreaseAllowed,
  skillIncreaseCap,
} from '../rules/build';
import { casterSlots, repertoireCounts, spellbookBudget, wizardSpellbookBudget, cantripsKnown, bookCantripCapacity, bookCantripLabel, bookNoun, bookTitle, variantGiftNote } from '../rules/spellcasting';
import {
  askedAtDailyPrep,
  characterSenseKeys,
  classFeatureIdsOwned,
  effectiveChoiceLimits,
  effectiveChoiceOptions,
  narrowChoiceOptions,
  senseGateReason,
  type NarrowedOption,
} from '../rules/derive';
import { archetypeCantripCounts, archetypeTradition, foldArchSpellSlotBonuses, grantedChoiceKey, narrowSpellFilter, optionDragon, skillSlotOptions } from '../rules/build';
import { bookGrantChips, giftChipIds, ownPlacesBeside, spellOpenedBy, variantGiftCount } from '../rules/spellOptions';
import { signaturesAt, signatureSpellsAt } from '../rules/build';
// batch 037: flexible-spellcaster#collection-shape — the sheet's own sizer, never a copy of it.
import { flexibleCollectionSize } from '../rules/build';
// Dual Class: the second subclass's effectChoices card is drawn only when one is offered.
import { effectChoiceOffered } from '../rules/build';
import { activeCasterArchetype, archetypeBook, archetypeBookRankNote, archetypeBookRanks, archetypeBookSentence, archetypeCantripAllowed, archetypeEntryIds, archetypeSlots, archetypeTraditionOptions, type ArchetypeBookRank } from '../rules/casterArchetypes';
import { bonusSkillFeatCount, bonusSkillFeatKey, choiceGrantFor, exhaustedGrantReason, FEAT_GRANTS, featUpgradesAtLevel, LOCKED_SKILL_KEYS, maxTakes } from '../rules/featGrants';
import { FEAT_PICK_GRANTS, pickKeysFor, pickPrompt, pickableFeats } from '../rules/featPickGrants';
import { FEAT_FEAT_GRANTS, isBoundGrant } from '../rules/featFeatGrants';
import { isBoundBackgroundGrant } from '../rules/backgroundGrants';
import { spellsMatching } from '../rules/spellChoice';
import { FEAT_CANTRIP_GRANTS } from '../rules/featCantripGrants';
import type { ContentDatabase, Feat, FeatCategory, FeatChoiceDef, ProficiencyKey, ProficiencyRank, SaveId, SpellAccessGrant, Tradition } from '../rules/types';
import { ABILITIES, PROFICIENCY_RANKS, SKILLS } from '../rules/types';
import { AbilitySelect, CampaignAttachCard, ChoiceDetails, FormulaBookCard, FullStats, LanguageEditor, OptionsCard, OriginPickers, OverridesCard, PopupSelect, RuleCards, SearchSelect, SetupCard, SetupUnlockedChoices, SnareFormulasCard, EffectChoicesPicker, SkillEditor, AttributeEditor, SubCard, cap, choiceOptionRecord, loreLabel, openOptionsWithRecords, requestRemovePick, requestSubclassChange, useBuilderActions, type OptionRecord } from './shared';
import { hasSnareCrafting } from '../rules/snareFormulas';
import { formulaSlots } from '../rules/formulaBook';
import { FilterableSelect, PickerRow, descNodeOf } from '../sheet/FilterableSelect';
import { DescriptionModal } from '../sheet/DescriptionModal';
import { TrustMarker } from '../sheet/TrustMarker';
import type { DescNode } from '../sheet/descref';
import { ActionGlyph, isActionCost } from '../sheet/widgets';
import { SPELL_SPEC_BUILDER, FEAT_SPEC } from '../sheet/filterSpecs';
import { useIsMobile, useShowUndoButtons } from '../sheet/useIsMobile';
import { useBackHandler } from '../sheet/useEscapeClose';
import { PinContext, type PinDescApi } from '../sheet/PinContext';
import { WindowControls } from '../sheet/WindowControls';
import { useUndoableState } from '../useUndoableState';
import { claimUndo } from '../undoClaim';
import { pinOf, samePin } from '../rules/play';

/**
 * A narrowed option as `PopupSelect` wants it.
 *
 * `NarrowedOption.disabled` is the REASON string (an option greyed without one is the half-fix Q27
 * was written against); the picker wants a boolean plus the sentence, so the translation lives in one
 * place rather than being re-spelled at each of the two call sites.
 */
const pickerOption = (o: NarrowedOption, record: OptionRecord | null) => ({
  value: o.value,
  label: featChoiceLabel(o.label),
  description: o.description,
  // card step 7b: the record the answer names (choiceOptionRecord), so its popup opens that page.
  record,
  disabled: !!o.disabled,
  disabledReason: o.disabled,
});

const FEAT_LABEL: Record<FeatCategory, string> = {
  ancestry: 'Ancestry feat',
  heritage: 'Heritage',
  class: 'Class feat',
  skill: 'Skill feat',
  general: 'General feat',
  archetype: 'Archetype feat',
  bonus: 'Bonus feat',
  // Kinetic Gate's two 1st-level impulse feats — named for what the player is choosing, not for the slot.
  impulse: 'Impulse feat',
  mythic: 'Mythic feat',
};
const FEAT_ICON: Record<FeatCategory, string> = {
  ancestry: 'ti-user',
  heritage: 'ti-sparkles',
  class: 'ti-shield-half',
  skill: 'ti-star',
  general: 'ti-medal',
  archetype: 'ti-books',
  bonus: 'ti-plus',
  // An impulse channels an element — the same wave the kineticist's own surfaces use.
  impulse: 'ti-wave-sine',
  mythic: 'ti-flame',
};

const RANK_ABBR: Record<ProficiencyRank, string> = {
  untrained: 'U',
  trained: 'T',
  expert: 'E',
  master: 'M',
  legendary: 'L',
};


type Sel = 'setup' | number;
type Picker =
  | { kind: 'feat'; level: number; category: FeatCategory; idx: number }
  // `caster: 2` targets the Dual-Class SECOND caster (writes cantrips2/spells2/signatures2); absent = primary.
  | { kind: 'spell'; rank: number; cap?: number; caster?: 2 }
  | { kind: 'familiar-ability'; companionId: string };

const skillLabel = (key: ProficiencyKey) => (key.startsWith('lore:') ? loreLabel(key) : cap(key));

/** Every INITIATE domain spell, one option per SPELL (aliased domains — delirium, wyrmkin — dedupe),
 *  labelled "Spell (Domain)" and sorted by spell name. The pool WG's "Select an Initial Domain
 *  Spell" filter resolves to (rank-1 Domain focus spells), offered on every Domain Initiate take. */
function initialDomainSpellOptions(content: ContentDatabase): { value: string; label: string }[] {
  const seen = new Map<string, string>(); // spellId -> first domain carrying it
  for (const [dom, sid] of Object.entries(DOMAIN_SPELLS)) if (!seen.has(sid)) seen.set(sid, dom);
  return [...seen.entries()]
    .filter(([sid]) => content.spells[sid])
    .map(([sid, dom]) => ({ value: sid, label: `${content.spells[sid]!.name} (${cap(dom)})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const atLeast = (have: ProficiencyRank, want: ProficiencyRank) =>
  PROFICIENCY_RANKS.indexOf(have) >= PROFICIENCY_RANKS.indexOf(want);

/**
 * What a feat's skill-training slot would actually GRANT for one option, given where the character
 * already stands — and `null` when the answer is "nothing at all".
 *
 * `buildCharacter` applies these with `maxRank`, so choosing a skill you already have at the granted
 * rank writes the same value back and the pick buys nothing. The picker offered those options
 * looking exactly like the live ones, which is the Q27 bug this reads for.
 *
 * ⚠ A `conditionalRank` slot ("trained in your choice of Deception or Stealth; expert if you are
 * already trained") is the deliberate opposite: being already trained is what UPGRADES it, so those
 * options must stay live. That is the same shape as Canny Acumen under Q21 — an option is only dead
 * when nothing, now or later in this grant, redeems it.
 */
function skillSlotGrant(
  slot: { rank: ProficiencyRank; conditionalRank?: { base: ProficiencyRank; upgraded: ProficiencyRank } },
  current: ProficiencyRank,
): ProficiencyRank | null {
  const grant = slot.conditionalRank
    ? atLeast(current, slot.conditionalRank.base)
      ? slot.conditionalRank.upgraded
      : slot.conditionalRank.base
    : slot.rank;
  return atLeast(current, grant) ? null : grant;
}

/** Whether the player has made any level-specific choice at this level — a feat pick, the
 *  skill increase, or any attribute boost. Used to decide whether lowering past it needs a
 *  confirmation (don't nag when nothing was chosen there). */
export function hasChoicesAtLevel(build: BuildState, level: number): boolean {
  const feat = Object.entries(build.featPicks).some(([k, v]) => !!v && Number(k.split(':')[0]) === level);
  const skillIncrease = !!build.skillIncreases[level];
  const attrBoosts = (build.attributeBoosts[level] ?? []).some((x) => x != null);
  return feat || skillIncrease || attrBoosts;
}

/**
 * A build as a comparable string: keys sorted at every depth and `undefined` fields dropped (a saved
 * build has been through JSON, which drops them too), so two builds holding the same choices compare
 * equal whatever order their keys were written in. Used only to ask "did anything change?" before
 * the builder is left.
 */
export function buildFingerprint(b: BuildState): string {
  return JSON.stringify(b, (_k, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

/**
 * "Has the player changed this build since the builder opened?" — the question leaving asks.
 *
 * The starting point is the build as it stands when the player FIRST touches the screen, not the one
 * handed in: anything the builder does to a build on its own while it opens (filling in a field an old
 * save predates, say) is not the player's change and must never make Cancel or Back ask. Until the first
 * press, tap, key or text input anywhere, every build change moves the start along with it; after it,
 * the start is fixed. Undoing back to the start, or typing a name and deleting it again, is unchanged.
 * test/phone-builder-leave.test.tsx.
 */
export function useBuildChanged(build: BuildState): () => boolean {
  const startRef = useRef(build);
  const frozenRef = useRef(false);
  const latestRef = useRef(build);
  latestRef.current = build;
  useEffect(() => {
    if (!frozenRef.current) startRef.current = build;
  }, [build]);
  useEffect(() => {
    const freeze = () => {
      frozenRef.current = true;
    };
    const events = ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click', 'input'];
    for (const ev of events) document.addEventListener(ev, freeze, true);
    return () => {
      for (const ev of events) document.removeEventListener(ev, freeze, true);
    };
  }, []);
  return () =>
    latestRef.current !== startRef.current && buildFingerprint(latestRef.current) !== buildFingerprint(startRef.current);
}

/** The one line that says what a spell chip's ★ does (it was a hover tooltip only). */
function SignatureHint() {
  return (
    <p className="lvl-note spr-sig-hint">
      <i className="ti ti-star" aria-hidden="true" />
      <span>
        Tap a spell&rsquo;s star to make it a signature spell — you can cast it at any rank you have a slot for.
      </span>
    </p>
  );
}

/** "a" or "an" before a noun, by its first letter: "an archetype feat", "a class feat". */
export function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

/**
 * How a player takes back a feat they took anyway, in the words of the device they hold. Desktop keeps
 * its Ctrl+Z sentence; a phone has no keyboard, and its Undo arrows are hidden unless the player turned
 * them on in Settings (the owner's setting — 'auto' is desktop-only), so it names what is really there.
 */
export function overrideUndoHint(isMobile: boolean, showUndoButtons: boolean): string {
  if (!isMobile) return 'You can undo with Ctrl+Z.';
  if (showUndoButtons) return 'You can undo it with the Undo arrow at the top.';
  return 'Changed your mind? Clear the feat with the ✕ on its slot.';
}

const ord =(r: number) => (r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`);

export function Builder({
  content: baseContent,
  initial,
  onCancel,
  onCreate,
  onLeaveCampaign,
}: {
  content: ContentDatabase;
  /** An existing build to edit; omitted when creating a new character. */
  initial?: BuildState;
  onCancel: () => void;
  onCreate: (build: BuildState) => void;
  /** Player leaves a campaign entirely (roster-wide) — threaded to the Campaigns setup card. */
  onLeaveCampaign?: (campaignId: string) => void;
}) {
  /*
   * The build has its own undo timeline.
   *
   * It used to be a plain useState, so Ctrl+Z in the builder fell through to App's global handler and
   * rewound the ROSTER behind the builder — reverting some earlier character edit while leaving the
   * half-built character exactly as it was. `useUndoableState`'s `set` has the same shape as a
   * setState dispatch, so useBuilderActions and all ~60 of its call sites are unchanged.
   */
  const {
    state: build,
    set: setBuild,
    undo: undoBuild,
    redo: redoBuild,
    canUndo: canUndoBuild,
    canRedo: canRedoBuild,
  } = useUndoableState<BuildState>(() => initial ?? emptyBuild());
  // Effective content = the shared DB with this build's Overrides content-edits overlaid (text/field
  // edits to feats/features). Returns the same ref when there are no edits, so pickers/memos are stable.
  // `ovContent` is the FULL (override-applied) DB used for the live character + grants; `content` is
  // that DB with disabled source books filtered out — what the pickers offer. Already-chosen ids are
  // always kept so disabling a book a character already used never breaks it.
  const ovContent = useMemo(() => applyOverrides(baseContent, build.overrides), [baseContent, build.overrides]);
  const sourceCat = useMemo(() => sourceCatalog(baseContent), [baseContent]);
  // desk #170: the Sources rows that print a Mythic Calling, named by the Level 0 picker's hint when every
  // calling's book is off (read off the unfiltered database; `content` below has them removed).
  const callingRows = useMemo(() => sourceRowLabelsFor(sourceCat.groups, mythicCallingRecords(ovContent).map((f) => f.source?.book)), [sourceCat, ovContent]);
  const content = useMemo(() => {
    const keep = collectChosenIds(build, ovContent);
    const enabled = enabledBookSet(build.enabledSources);
    const sourced = sourceCat.allBooks.every((b) => enabled.has(b)) ? ovContent : applySources(ovContent, enabled, keep);
    // Mythic/Kingmaker campaign toggles hide their content from the pickers (off by default).
    const toggled = applyContentToggles(sourced, { mythicEnabled: build.mythicEnabled, kingmakerEnabled: build.kingmakerEnabled, deviantEnabled: build.deviantEnabled }, keep);
    // "Hide legacy data": drop legacy/legacy-era content (superseded is already pruned at import).
    return applyEditionFilter(toggled, { hideLegacy: build.hideLegacy }, keep);
    // `build` is read for keepIds but intentionally not a dep: re-running only when sources change is
    // enough — a freshly-picked item is always from an enabled book, so it's present regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ovContent, build.enabledSources, build.mythicEnabled, build.kingmakerEnabled, build.hideLegacy, sourceCat]);
  const actions = useBuilderActions(setBuild, ovContent);
  // Editing an existing character opens on the Setup page (options/sources/overrides at a glance);
  // creating a new one starts on Level 0 (identity: ancestry/background/class).
  const [sel, setSel] = useState<Sel>(initial ? 'setup' : 0);
  const [picker, setPicker] = useState<Picker | null>(null);
  // Clicking a filled feat card opens its description as a popup (the Replace button swaps it).
  const [featDescPopup, setFeatDescPopup] = useState<DescNode | null>(null);
  // The full item catalog, sorted once, for the equipment picker's filter panel.
  // Class-feat picker: reveal archetype feats (multiclass/archetypes). Off by default.
  const [showArch, setShowArch] = useState(false);
  /* The level strip scrolls sideways once there are more chips than fit — at level 20 that is most of
   * them, and on a phone barely half. Keep the selected one in view so the page you are ON is never
   * the one you have to go looking for. `block: 'nearest'` so this never scrolls the page itself. */
  const stripRef = useRef<HTMLDivElement>(null);
  const selChipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selChipRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [sel]);
  /* A new page opens at its TOP. `.builder-body` is the one scroller every page shares, and nothing reset
   * it, so a page change kept the old page's offset: the next page opened mid-way or at its bottom, its
   * "Level N · choices left" heading and first slots above the screen (a caster's level 19 opened on its
   * spell ranks, looking as if it had no feats). Chip taps, the +/− stepper and "Advance to level N" all
   * change `sel`, so this one place covers them. Layout, so no frame paints the new page at the old
   * offset. test/phone-builder-shell.test.tsx. */
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [sel]);
  /*
   * Keep the page you are looking at and the character's level in step.
   *
   * `setSel` used to be called from exactly one place — the chip click — so the +/− stepper changed
   * the character without changing the page: "+" left you on the old level while a new chip appeared
   * silently at the far right, and "−" stranded you on a page that had just left the strip (which is
   * built from `build.level`), greyed out with nothing selected.
   *
   * An effect rather than a button handler because THREE things change the level: the stepper, the
   * "lower the level" confirmation, and the "Advance to level N" link. Layout, not passive, so the
   * clamp lands before paint and there is never a frame showing a level the character does not have.
   */
  const prevLevel = useRef(build.level);
  useLayoutEffect(() => {
    const prev = prevLevel.current;
    prevLevel.current = build.level;
    if (build.level > prev) setSel(build.level); // levelling up: the new choices are on the new page
    else if (build.level < prev) setSel((cur) => (typeof cur === 'number' && cur > build.level ? build.level : cur));
  }, [build.level]);
  const isMobile = useIsMobile();
  const showUndoButtons = useShowUndoButtons();
  // Mobile: the live "Character" stat preview collapses behind a chevron to reclaim builder space.
  const [statsOpen, setStatsOpen] = useState(false);
  useEffect(() => setShowArch(false), [picker]);

  /*
   * LEAVING THE BUILDER — one door for the Cancel button (every platform) and Android's Back (phones).
   *
   * Cancel used to drop the whole build at once, one tap beside Create; Back was never wired at all, so
   * its first press was swallowed by the dismiss stack's trap and the second left the APP, the unsaved
   * character with it. Now: nothing changed since the builder opened → leave at once (no question for
   * opening and closing it); something changed → ask, and only "Discard" leaves.
   *
   * Back reaches this only when no popup is open: it is the builder's FLOOR on the dismiss stack, below
   * every picker the page mounts with it (useBackHandler `floor`), so a popup still closes first. Phones
   * only — desktop Escape with nothing open keeps doing nothing. `backOnly`: so does Escape at PHONE
   * width (a narrow window, a hardware keyboard) — only Back leaves; it used to reach this door and leave
   * or ask "Discard changes?" (phone audit round 3). test/phone-builder-leave.test.tsx.
   */
  const buildChanged = useBuildChanged(build);
  const askingLeave = useRef(false);
  const requestLeave = async (): Promise<void> => {
    if (askingLeave.current) return;
    askingLeave.current = true;
    try {
      // An Overrides number box writes what was typed only when it is LEFT (DraftNumberInput), and
      // Android's Back reaches this door without taking focus from it — so "50 typed into Max HP, then
      // Back" read as no change and left without asking, the typed value gone (final check 2026-10-14).
      // Leave the focused field first and let React apply what it commits, then compare.
      const focused = typeof document !== 'undefined' ? document.activeElement : null;
      if (focused instanceof HTMLElement && focused !== document.body) {
        focused.blur();
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!buildChanged()) {
        onCancel();
        return;
      }
      const ok = await confirmDialog({
        title: 'Discard changes?',
        message: initial
          ? `Leaving now throws away what you’ve changed in the builder. ${initial.name || 'The character'} stays as it was last saved.`
          : 'This character hasn’t been created yet. Leaving now throws away everything you’ve chosen.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (ok) onCancel();
    } finally {
      askingLeave.current = false;
    }
  };
  useBackHandler(isMobile, () => void requestLeave(), { floor: true, backOnly: true });

  /*
   * Take Ctrl+Z while the builder is open, and answer it ourselves. Both halves matter: without the
   * claim App's global handler also fires and undoes a roster change at the same time; without the
   * handler the shortcut simply stops working here.
   *
   * A focused text field keeps the browser's native text undo — same rule App uses — so editing the
   * character's name character-by-character still behaves like a text box.
   */
  useEffect(() => claimUndo(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      if (k === 'y' || (k === 'z' && e.shiftKey)) redoBuild();
      else undoBuild();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoBuild, redoBuild]);

  // Lets description popups in the builder (e.g. the Setup rule "i" icons) offer the "favorite" star.
  // Pins live on the build's pinnedDescs and are carried onto the built Character, surfacing in the
  // sheet's Main-tab Pinned section.
  const pinApi: PinDescApi = useMemo(() => {
    const list = build.pinnedDescs ?? [];
    return {
      // Card step 19: the same identity and stored shape as the sheet's star (play.ts samePin / pinOf), so a
      // pin made here keeps its record id, mode and ours lines all the way to the Pinned list.
      has: (node) => list.some((d) => samePin(d, node)),
      toggle: (node) => {
        const next = list.some((d) => samePin(d, node))
          ? list.filter((d) => !samePin(d, node))
          : [...list, pinOf(node)];
        actions.patch({ pinnedDescs: next });
      },
    };
  }, [build.pinnedDescs, actions]);

  // Skill ranks the character has *before* the selected level's increase (for the "X → Y" display).
  // Memoized so the full buildCharacter pipeline doesn't re-run on every level-page render.
  const baseSkills = useMemo(() => {
    if (typeof sel !== 'number' || sel < 1) return null;
    // "Before this level's increase" must include ONLY increases at LOWER levels. Deleting just this
    // level's increase still re-applied higher-level increases (buildCharacter applies them in level
    // order), which inflated the rank shown as the starting point and could disable a legal increase.
    /* …and ALL THREE stores, not just the ordinary one. The extra increases (swashbuckler Stylish
     * Tricks, Reborn Soul's past-life Lores) land at the level being edited too, so leaving them in
     * showed this level's own pick as the starting rank — "expert → master" for a skill still at
     * trained, and the legal top rank greyed out. */
    const below = (m: Record<number, ProficiencyKey> | undefined) => {
      const rest: Record<number, ProficiencyKey> = {};
      for (const [lvl, key] of Object.entries(m ?? {})) if (Number(lvl) < sel) rest[Number(lvl)] = key;
      return rest;
    };
    return buildCharacter(
      {
        ...build,
        skillIncreases: below(build.skillIncreases),
        bonusSkillIncreases: below(build.bonusSkillIncreases),
        backgroundSkillIncreases: below(build.backgroundSkillIncreases),
      },
      content,
    ).proficiencies.skills;
  }, [build, content, sel]);

  // Only show levels up to the character's current level; the +/− stepper extends/trims it.
  const strip: Sel[] = ['setup', 0, ...Array.from({ length: build.level }, (_, i) => i + 1)];
  const slotKey = (lvl: number, cat: FeatCategory, idx: number) => `${lvl}:${cat}:${idx}`;

  // Feats eligible for a given slot (right category + level, not already taken, trait-gated to the
  // chosen ancestry/class) — see eligibleFeatsForSlot. `db` defaults to the source-FILTERED content
  // (what the picker offers); the picker also runs it against ovContent to explain hidden matches.
  const eligibleFor = (p: { level: number; category: FeatCategory; idx: number }, db: ContentDatabase = content) =>
    eligibleFeatsForSlot(build, db, p);

  // Caster info (for the Spells section + spell picker). A subclass can override
  // the tradition (e.g. a witch patron), so resolve the effective tradition.
  const casterCls = build.classId ? content.classes[build.classId] : undefined;
  const casting = casterCls?.spellcasting;
  const subOption = casterCls?.subclass?.options.find((o) => o.id === build.subclassId);
  // A subclass can override the slot progression (cleric Battle Creed = the reduced two-rank table).
  const castProgression = subOption?.slotProgression ?? casting?.progression;
  // Caster-archetype fallback: when the class isn't a slot caster, a caster Dedication
  // gives a prepared archetype pool (reusing build.cantrips / build.spells).
  const archCaster = !casting
    ? activeCasterArchetype(Object.values(build.featPicks).filter((v): v is string => !!v))
    : null;
  const showSpells = !!casting || !!archCaster;
  // A flexible spellcaster's class entry is a COLLECTION — a repertoire over the capped class
  // table — so the picker must count "known" and offer the signature stars, exactly as the sheet
  // builds the entry. Same function as buildCharacter, never a copy (the cantrip-cap lesson below).
  // THIS class's archetype prices (buildCharacter builds each class's entry with its own — a Wellspring
  // Mage cuts a Wizard/Sorcerer's sorcerer cantrips, never the wizard's).
  const archMods = classArchetypeSpellMods(build, content, build.classId);
  const castType = archMods.spellCollection && casting ? 'spontaneous' : (casting?.type ?? (archCaster?.config.repertoire ? 'spontaneous' : 'prepared'));
  // buildCharacter's own answer (`archetypeTradition`): a summoner archetype's eidolon type, a Hedge Mage's
  // SKILL or a Bloodrager's bloodline, a choice-tradition archetype's pick, else the dedication's own. This
  // used to be a copy that never read the skill answer, so a Nature hedge mage — a PRIMAL caster on the
  // sheet — was offered arcane spells here.
  const archTradition = archCaster ? archetypeTradition(archCaster, build, content) : undefined;
  /* A dedication that prepares out of a BOOK of its own (ArchetypeBook: Wizard, Witch, Magus, Necromancer,
   * Hedge Mage, Spellshot). Its cantrip row is the book's cantrips, and each new spell rank adds the
   * Basic feat's two (three) spells to the book instead of asking for one prepared spell per slot. */
  const archBook = archetypeBook(archCaster);
  // The Draconic bloodline casts in its DRAGON's tradition (buildCharacter's `optionDragon`): the
  // bloodline's own `tradition` is arcane, so a divine-dragon sorcerer was offered arcane spells here
  // and its divine entry on the sheet drew none of them.
  const tradition = optionDragon(subOption, build.dragonExemplar)?.tradition ?? subOption?.tradition ?? casting?.tradition ?? archTradition;
  const isPrepared = castType === 'prepared';
  // Spontaneous casters can designate signature spells once the class grants the
  // feature (e.g. bard at level 3).
  const sigAvailable =
    (casting?.type === 'spontaneous' &&
      signatureSpellsAt(casterCls, build.level)) ||
    // A spell collection heightens EVERY collected spell once 2nd-rank spells arrive — the stars
    // are fixed on (signatureFixed), so the builder shows them rather than offering a budget.
    (archMods.spellCollection && !!casting && build.level >= 3);
  /*
   * Wizards and witches are LEARNED prepared casters: they learn a SPELLBOOK (a single budget across
   * ranks — the wizard's book, the witch's familiar) and can prepare only from it.
   *
   * The MAGUS is one too and was not: *"You start with a spellbook worth 10 sp or less, which you
   * receive for free and must study each day to prepare your spells… The spellbook contains your choice
   * of eight arcane cantrips and five 1st-rank arcane spells. Each time you gain a level, you add two
   * arcane spells to your spellbook"* (class-feature-1258, Impossible Magic — the newest printing; the
   * Secrets of Magic one, class-17, had four) — and it prepared straight off the arcane list with no
   * book and no budget, because the only book lane in the app was this class-id test. So is the
   * NECROMANCER's dirge (class-75: *"eight occult cantrips, the 1st-rank spell harm, and four other
   * 1st-rank occult spells"*). WG marks the same distinction with its PREPARED-LIST casting token
   * against PREPARED-TRADITION.
   *
   * `ClassSpellcasting.spellbook` carries the numbers now (the necromancer's 4 + 2 is NOT the wizard's
   * 5 + 2, so reusing wizardSpellbookBudget for it would be wrong) and the book's CANTRIP count
   * (`bookCantripCapacity`). The class-id test stays as the fallback so a wizard or witch record
   * without the field keeps the book it has always had.
   */
  const bookSpec = casting?.spellbook;
  /* desk 155: flexible-book-casters — the CLASS's own casting type, not `isPrepared` (which is the
   * archetype-modified `castType`). A book is a property of the class — *"You learn spells as normal
   * for your class (a wizard uses a spellbook, a witch teaches spells to their familiar, and so on)"*
   * (archetype-99) — and Flexible Spellcaster flips `castType` to spontaneous, so reading it here took
   * the book away from every flexible wizard, witch and magus: their rail became the collection's, and
   * the level-4 page offered a 4-spell "collection" where the book holds eleven. */
  const isWizardBook = !!casting && casting.type === 'prepared' && (!!bookSpec || casterCls?.id === 'wizard' || casterCls?.id === 'witch');
  // Wizard School of Unified Magical Theory (Player Core): "you add one 1st-rank spell of your choice
  // to your spellbook" — a larger initial spellbook. Applies as a flat +1 to the across-rank budget.
  const isUmtBook = casterCls?.id === 'wizard' && subOption?.id === 'school-of-unified-magical-theory';
  const spellbookSize = bookSpec ? spellbookBudget(bookSpec, build.level) : wizardSpellbookBudget(build.level, isUmtBook);
  const learnedTotal = Object.values(build.spells).reduce((n, arr) => n + arr.length, 0);
  /* batch 037: flexible-spellcaster#collection-shape — a spell COLLECTION is one flat pool across the
   * ranks (*"equals the total number of spell slots you get each day"*, archetype-99), the same shape
   * the spellbook rail already draws, so it rides that rail instead of the per-rank caps. Without it
   * the picker offered one rank's slots at a time — the shape print does not print, and the shape the
   * sheet no longer keeps. `isWizardBook` cannot cover it: a collection casts SPONTANEOUS.
   *
   * desk 155: flexible-book-casters — …but a BOOK caster's rail is still the book. The collection is
   * a daily preparation *"from the same source as normal, such as from a spellbook for a wizard"*
   * (archetype-99), so what the builder chooses is the book and the sheet draws the collection out of
   * it — one rail, the one the player is actually spending. */
  const isFlexCollection = !!casting && archMods.spellCollection && !isWizardBook;
  /* Known-beyond-slots for an archetype pool (the halcyon "2 common 1st-rank spells" over one slot,
   * Shattered Sacrament's extra known). The BUILDER's per-rank counts are pick caps, not the slot
   * pool, so they must include these or the sheet keeps spells the player was never given a picker
   * for. Applied only to ranks the schedule has opened — the extra known arrives WITH the slot. */
  /* ⚠ …AND the SLOT-side bonuses, through buildCharacter's own function. Occult Breadth (feat-5063)
   * and the ten sibling *-breadth feats print *"Increase the number of spells in your repertoire AND
   * the number of spell slots you gain from bard archetype feats by 1 for each spell rank other than
   * your two highest"*; buildCharacter folds those into `slots` BEFORE it slices the repertoire, so
   * the sheet opened a second rank-1 known spell while this cap — which merged `extraKnown` only —
   * left the picker at one. Sharing the function is the point: a second copy is what drifted.
   *
   * Level-scoped, unlike the old body: a feat taken at 8 must not widen the pick cap the level-4
   * page draws. `override:` slots belong to the level being edited (build.ts:3886 reads them the
   * same way). */
  const archExtraKnownAt = (base: Record<number, number>, L: number = build.level): Record<number, number> => {
    if (!archCaster) return base;
    const extra: Record<number, number> = { ...(archCaster.config.extraKnown ?? {}) };
    const ids = Object.entries(build.featPicks)
      .filter(([slotKey]) => (slotKey.startsWith('override:') ? L : Number(slotKey.split(':')[0])) <= L)
      .map(([, id]) => id);
    const out: Record<number, number> = { ...base };
    foldArchSpellSlotBonuses(out, extra, ids, archetypeEntryIds(archCaster), content);
    for (const [rankStr, n] of Object.entries(extra)) {
      const r = Number(rankStr);
      if ((out[r] ?? 0) > 0) out[r] += n;
    }
    return out;
  };
  /* A class archetype's per-rank ceiling (Flexible Spellcaster's slotCap), applied to the CLASS
   * table only — an archetype caster pool is not the table the cap is about. Same body as
   * buildCharacter's capSlots; without it the picker offered the uncapped table and the sheet
   * silently dropped the excess picks. */
  const capArch = (counts: Record<number, number>): Record<number, number> =>
    archMods.slotCap == null ? counts : Object.fromEntries(Object.entries(counts).map(([r, n]) => [r, Math.min(n, archMods.slotCap!)]));
  /* How many spells the CLASS lets the player pick at each rank: the (archetype-capped) slot table,
   * plus any repertoire the class prints beyond its slots — the summoner's *"maximum size of five
   * spells"* over four slots, the oracle's Oracular Clarity *"Add two common 10th-rank divine spells to
   * your repertoire. You gain a single 10th-rank spell slot"*. buildCharacter sizes the repertoire the
   * same way through the same helper, so the picker and the sheet cannot disagree about the cap. */
  const classPickCounts = (L: number): Record<number, number> =>
    repertoireCounts(capArch(casterSlots(L, castProgression)), casting?.extraRepertoire);
  const slotCounts = casting
    ? classPickCounts(build.level)
    : archCaster
      ? archExtraKnownAt(archetypeSlots(build.level, archCaster))
      : {};
  // Cantrip Expansion and its kin raise this. Without the same bonus here the extra cantrips exist on
  // the sheet and the builder gives the player no slot in which to choose them.
  //
  // ⚠ `buildCharacter`'s own function, not a copy of it. The copy that used to live here had drifted:
  // it ignored the `cantripsAt` LADDER, and it charged Adapted Cantrip's `-1` before its picker was
  // answered, so the page read "5 / 4" over a set of picks the sheet was perfectly happy with.
  // Per class (`classCantripBonus`): that `-1` is charged only to the repertoire class the cantrip
  // lands in — a prepared class keeps every place (owner's bug 2026-10-15).
  const cantripBonus = classCantripBonus(build, content, build.classId);
  // When the ARCHETYPE is the caster (no class spellcasting), the feats that raise ITS cantrip count
  // (Psi Development's `spellSlotBonus {entryId, cantrips:1}`) are scoped to the archetype entry, which
  // `cantripBonusFor` — the class pool's function — never sees; buildCharacter and the setup page
  // (shared.tsx archCantripBonus) both add them, so the level page must too or the sheet has an opening
  // the builder gives the player no slot to fill (experience gate, 2026-09-02).
  //
  // ⚠ buildCharacter's own function now (`archetypeCantripCounts`): the copy here added Cantrip Expansion's
  // untargeted bonus while the build's slice did not, so the third and fourth picks were drawn nowhere.
  const archCounts = !casting && archCaster ? archetypeCantripCounts(archCaster, build, content, Object.values(build.featPicks)) : undefined;
  const cantripCap = casting
    ? Math.max(0, cantripsKnown(build.classId) + cantripBonus + archMods.cantripDelta)
    : archCounts?.prepared ?? 0;
  /*
   * A BOOK caster's cantrip row is the BOOK (owner's bug 2026-10-14: "magus (and other spellbook
   * casters) can prepare spells that aren't in their spellbook"). Print sizes it at 10 / 10 / 8 / 8
   * cantrips (`bookCantripCapacity`) against the five (six) prepared from it each morning, and the row
   * used to ask only for the five — so the sheet had no book to hold its openings to.
   *
   * `build.cantrips` IS the book; its first `cantripAllowance` entries are the standing preparation
   * (buildCharacter's own slice, School of Unified Magical Theory's missing curriculum cantrip
   * included), which the sheet re-prepares each morning. Never below the allowance (Cantrip
   * Expansion's eight). Every other caster's row is the cantrips it knows, as before.
   *
   * …and a DEDICATION's book the same way, at its own size (ArchetypeBook): *"a spellbook with four
   * common arcane cantrips … You can prepare two cantrips each day from your spellbook"* — the row asks
   * for the four (`archCounts.book`), the first two are the standing preparation.
   */
  const bookWord = isWizardBook ? bookNoun(casterCls) : archBook?.noun;
  const cantripAllowance = Math.max(0, cantripCap - (isUmtBook ? 1 : 0));
  /* A build saved before its archetype had a spell pool keeps its cantrips in the dedication's own
   * retired effectChoices, and buildCharacter hands them to the sheet from there. The row counted
   * `build.cantrips` alone, so it read "0 / 2" over two cantrips the character was already casting and
   * the only way to clear it was picking them again. It reads the SHEET'S function now — never a
   * second copy of the rule — filtered by the same allow-list buildCharacter applies to it.
   *
   * Display only: the answers become ordinary picks on the first edit (`writeCantrip`), never on open.
   * Nothing the player stored is rewritten by arriving at this page. */
  const legacyCantrips = archCaster && !build.cantrips.length
    ? legacyArchetypeCantrips(archCaster.dedicationId, build, content).filter((id) => archetypeCantripAllowed(archCaster, id))
    : [];
  const rowCantrips = legacyCantrips.length ? legacyCantrips : build.cantrips;
  /* Editing a row that is showing the fallback materialises it first: the two stored answers become
   * real picks, and the toggle then does what it always does. Without this the X on a chip runs
   * `toggleCantrip` against an empty list and ADDS the cantrip the player just asked to remove. */
  const writeCantrip = (id: string) => {
    if (legacyCantrips.length) actions.patch({ cantrips: legacyCantrips });
    // The cap the ROW shows — a book's ten, Cantrip Expansion's eight. The toggle used to cap at
    // `cantripsKnown` alone and silently refused the 7th cantrip the row was offering.
    actions.toggleCantrip(id, cantripRowCap);
  };
  // The built character, used to evaluate feat prerequisites in the picker and the stats rail.
  // Memoized so the full per-level build pipeline runs once per build change, not 2–3× per render.
  const featPrereqChar = useMemo(() => buildCharacter(build, ovContent), [build, ovContent]);
  // The senses the character actually HAS, for the per-option gates in the effect-choice pickers.
  // Memoized for the same reason featPrereqChar is: deriveDefenses walks feats, items, modes and
  // stances, and a picker re-renders on every keystroke.
  const builderSenses = useMemo(() => characterSenseKeys(featPrereqChar, content), [featPrereqChar, content]);
  /* buildCharacter's own entry for the first class — what its gift is (`ownPlacesBeside`). */
  const castEntry1 = casting && build.classId ? featPrereqChar.spellcasting.find((e) => e.id === `${build.classId}-casting`) : undefined;
  /* …and the dedication's own entry, when the ARCHETYPE is the caster these level pages draw — what a
   * record wrote into its book (`bookGrantChips`). */
  const archEntryBuilt = archCaster ? featPrereqChar.spellcasting.find((e) => archetypeEntryIds(archCaster).has(e.id)) : undefined;
  /** What a record put in a dedication's BOOK at `rank` beside the player's `picks` — a lesson's familiar
   *  spell, Expanded Necromancy's dirge spells, Peer Past the Hedge's detect magic — as LOCKED chips with
   *  the record named in words under them (a tap shows no title on a phone). Never one of the row's places:
   *  print adds these on top, so the row's count stays the player's own. */
  /** The level a book grant arrives at: the level of the feat that gives it — by its name (Expanded
   *  Necromancy) or by the answer that names it (Basic Lesson → "Lesson of Life"). A rank row is drawn on
   *  the page where the book first reaches that rank, which can be before the feat is taken, so the note
   *  says when (checker finding 2026-10-15). */
  const grantLevelOf = (from?: string): number | undefined =>
    from ? featPrereqChar.feats.find((f) => content.feats[f.featId]?.name === from || f.choice?.label === from)?.level : undefined;
  const bookGrantEls = (rank: number, picks: readonly string[], pageLevel?: number, andAbove = false) => {
    const grants = bookGrantChips(archEntryBuilt, rank, picks, andAbove);
    const noun = archEntryBuilt?.bookNoun ?? 'book';
    const name = (id: string) => content.spells[id]?.name ?? id;
    return {
      chips: grants.map(({ id, from }) => (
        <span className="spr-chip spr-chip-gift spr-chip-book-grant" key={'grant:' + id} title={`Added to your ${noun}${from ? ` by ${from}` : ''} — not one of the spells you choose here`}>
          {name(id)}
          <i className="ti ti-lock" aria-hidden="true" />
        </span>
      )),
      notes: grants.map(({ id, from, rank: r }) => {
        const at = grantLevelOf(from);
        return (
          <span className="spr-gift-note" key={'grant-note:' + id}>
            {name(id)}
            {r !== rank ? ` (${ord(r)} rank)` : ''} is added to your {noun}
            {from ? ` by ${from}` : ''}
            {at && pageLevel !== undefined && at > pageLevel ? ` at ${ord(at)} level` : ''} — it does not use one of these places.
          </span>
        );
      }),
    };
  };
  /** The bloodline's gift in a row, drawn as LOCKED chips so the smaller count says why — the gift is
   *  the bloodline's, one of the row's places, and has no ✕ (`giftChipIds`). `variants`: the record
   *  lists one gift per variant at this rank (`variantGiftCount`, lane C4) — together they are the one
   *  place, and each chip says only one of them is the character's. */
  const giftChips = (ids: string[], variants = 0) => [
    ...ids.map((id) => (
      <span
        className="spr-chip spr-chip-gift"
        key={'gift:' + id}
        title={variants ? `${variantGiftNote(variants)}; together they take one of these places` : 'Granted by your bloodline — one of these places, and always known'}
      >
        {content.spells[id]?.name ?? id}
        <i className="ti ti-lock" aria-hidden="true" />
      </span>
    )),
    // A title is hover-only, so a phone never showed why four to six locked gifts sit beside "3 / 3":
    // the same sentence as visible text, once per row (the sheet already prints it, .spell-offbook-note).
    ...(variants && ids.length
      ? [
          <span className="spr-gift-note" key="gift-note">
            {variantGiftNote(variants)}; together they take one of these places.
          </span>,
        ]
      : []),
  ];
  /* The cantrip row's cap — a book's ten, else the cantrips the class knows, LESS a sorcerer's gift
   * cantrip (lane C2, 2026-10-14). Print counts the bloodline's cantrip inside the five
   * (`grantsCountInside`) and the row offered all five beside it, so the sheet drew the gift and four
   * picks and the fifth nowhere. The sheet's gate and over-cap report subtract the same one place. */
  const cantripRowCap = isWizardBook
    ? Math.max(bookCantripCapacity(casterCls) ?? 0, cantripAllowance)
    : archCounts?.book ?? ownPlacesBeside(castEntry1, 0, cantripCap, rowCantrips);

  /**
   * Render one build-time choice picker.
   *
   * Extracted from the feat path so the SAME control can serve an owned class feature or a heritage.
   * Only `feats[id].choice` was ever rendered, so a choice on any other record was stored in the data,
   * shown in no picker, and answered by nobody — 25 class-feature choices shipped that way.
   *
   * `key` is the storage slot in build.featChoices: a feat uses its level slot, a feature uses
   * `feature:<id>`, a heritage `heritage:<id>`. Multi-pick fans out from it via choiceKeys().
   *
   * `recordId` is the record the choice BELONGS to, which the storage key does not always name (a
   * feat's key is `12:class:0`). Another record may widen this menu, and the widening is addressed
   * by record id — see buildChoiceOptions.
   */
  const renderChoice = (def: FeatChoiceDef, key: string, recordId: string) => {
                              // batch 037: versatile-mutation#energy-level — *"AT 8TH LEVEL, choose one
                              // of the following: acid, cold, electricity, fire, or sonic damage"*
                              // (feat-5454). A choice that starts at a printed level is not drawn before
                              // it. `FeatChoiceDef.minLevel` already meant this on the daily path
                              // (dailyChoices.ts) and was ignored here, so the picker appeared four
                              // levels early — and `levelChoices` counted it, which is the matching half
                              // of this fix in build.ts.
                              if (def.minLevel != null && build.level < def.minLevel) return null;
                              // Annotated because the branches inside buildChoiceOptions are structurally
                              // different and the generic in choiceOptionsFor would otherwise narrow away `label`.
                              // …in the class's own picker's order when the answers are class sub-picks
                              // (desk #170: Wizard Dedication's schools, alphabetical like Arcane School's).
                              const opts: NarrowedOption[] = classSubPickOrder(
                                buildChoiceOptions(recordId, def, build, content, featPrereqChar, key),
                                def,
                                content,
                              );
                              // See the granted-feat picker: a narrowed menu has to say who narrowed it.
                              const limitReasons = effectiveChoiceLimits(recordId, def, featPrereqChar, content).map((l) => l.reason);
                              /*
                               * A MENU THAT IS EMPTY BECAUSE ANOTHER ANSWER IS MISSING MUST SAY SO.
                               *
                               * Domain Initiate offers the four domains of your deity. With no deity
                               * chosen it offered nothing, silently: an open picker with an empty list
                               * and no hint that the answer lives elsewhere on the page. The engine was
                               * never at fault — every one of the 485 deities and all 1,911 deity×domain
                               * combinations grant the right focus spell — but the player could not get
                               * far enough to find that out, and reported the feat as broken.
                               *
                               * Only for menus whose pool is COMPUTED from another build answer. A menu
                               * that is empty for any other reason is a defect, not a prompt, and must
                               * not be papered over with a friendly sentence.
                               */
                              const unmetDependency =
                                !opts.length && def.kind === 'domains' && !build.deityId
                                  ? 'Choose a deity first — this offers your deity’s domains.'
                                  : null;
                              return (
                                <SubCard icon="ti-adjustments" label={featChoicePrompt(def.prompt, def.flag)}>
                                  {unmetDependency ? (
                                    <div className="choice-inert">
                                      <i className="ti ti-info-circle" aria-hidden="true" />
                                      <span>{unmetDependency}</span>
                                    </div>
                                  ) : def.kind === 'text' ? (
                                    // No option list exists for these (Kingdom skills, leadership roles):
                                    // the app has no Kingmaker data, and typing one from memory would be
                                    // inventing content. The player supplies the word; we record it.
                                    <input
                                      className="txt"
                                      type="text"
                                      data-ctl="text"
                                      data-ctl-title={featChoicePrompt(def.prompt, def.flag)}
                                      data-ctl-state={build.featChoices[key] ? 'picked' : 'empty'}
                                      placeholder={`${featChoicePrompt(def.prompt, def.flag)}…`}
                                      value={build.featChoices[key] ?? ''}
                                      onChange={(e) => actions.setFeatChoice(key, e.target.value)}
                                    />
                                  ) : def.kind === 'open' ? (
                                    // An OPEN set ("any 1st-level dwarf ancestry feat") is resolved
                                    // against content at render time and searched, because the legal
                                    // list is too long to enumerate on the record and would go stale.
                                    (() => {
                                      const keys = choiceKeys(key, def);
                                      // `keep`: a stored answer stays in its own picker (Adapted Cantrip's allegro
                                      // from before its no-tradition rule, 2026-10-15) instead of reading blank.
                                      const all = openChoiceOptions(def.from, content, {
                                        hideLegacy: build.hideLegacy,
                                        character: featPrereqChar,
                                        keep: keys.map((kk) => build.featChoices[kk]),
                                      });
                                      return keys.map((k, i) => {
                                        const answers = keys.map((kk) => build.featChoices[kk]);
                                        const taken = new Set(def.distinct ? answers.filter((a, j) => j !== i && a) : []);
                                        // A kept answer the rule does not allow says so UNDER the control, where
                                        // the player looks — not only inside the picker (Q27, checker 2026-10-15).
                                        const barred = all.find((o) => o.id === build.featChoices[k])?.notAllowed;
                                        return (
                                          <Fragment key={k}>
                                            <SearchSelect
                                              bare
                                              label={featChoicePrompt(def.prompt, def.flag)}
                                              // NOT the raw `from.type` — that printed the slug at the
                                              // player ("Search own-deity-spell…") on sixteen records.
                                              placeholder={`Search ${OPEN_SOURCE_LABEL[def.from?.type ?? ''] ?? 'options'}…`}
                                              value={build.featChoices[k] ?? null}
                                              onChange={(v) => actions.setFeatChoice(k, v)}
                                              options={openOptionsWithRecords(all.filter((o) => !taken.has(o.id)), def.from)}
                                            />
                                            {barred && (
                                              <div className="choice-inert" data-choice-barred>
                                                <i className="ti ti-alert-triangle" aria-hidden="true" />
                                                <span>{barred}</span>
                                              </div>
                                            )}
                                          </Fragment>
                                        );
                                      });
                                    })()
                                  ) : (
                                    // "Choose two DIFFERENT terrains" needs one picker per pick. A
                                    // single-pick choice still uses the bare slot key, so characters
                                    // saved before multi-pick existed are unaffected.
                                    (() => {
                                      const keys = choiceKeys(key, def);
                                      const answers = keys.map((k) => build.featChoices[k]);
                                      return keys.map((k, i) => (
                                        <PopupSelect
                                          key={k}
                                          title={featChoicePrompt(def.prompt, def.flag)}
                                          placeholder={
                                            keys.length > 1
                                              ? `${featChoicePrompt(def.prompt, def.flag)} ${i + 1} of ${keys.length}…`
                                              : `${featChoicePrompt(def.prompt, def.flag)}…`
                                          }
                                          value={build.featChoices[k] ?? ''}
                                          onChange={(v) => actions.setFeatChoice(k, v)}
                                          // A typed answer needs a row of its own or the filled control cannot
                                          // show it — applied per PICK, after `distinct` has removed the other
                                          // picks' answers, so pick 2 never re-offers what pick 1 typed.
                                          options={withCustomAnswer(
                                            choiceOptionsFor(opts, def, answers, i).map((o) => pickerOption(o, choiceOptionRecord(def, o.value, content))),
                                            def,
                                            answers[i],
                                          )}
                                          addCustom={
                                            // Suppressed while a narrowing is in force — see the
                                            // granted-feat picker for why.
                                            !limitReasons.length && def.allowCustom
                                              ? { ...def.allowCustom, onAdd: (text) => actions.setFeatChoice(k, text) }
                                              : undefined
                                          }
                                        />
                                      ));
                                    })()
                                  )}
                                  {/* A restriction the app cannot enforce — name the part that is on the
                                      player, instead of silently offering a wider list than the rules allow. */}
                                  {def.note && (
                                    <div className="choice-inert">
                                      <i className="ti ti-alert-circle" aria-hidden="true" />
                                      <span>{def.note}</span>
                                    </div>
                                  )}
                                  {/* A pick that records but grants nothing must say so — the owner's rule
                                      is "never silently show a pick that does nothing". */}
                                  {def.inert && (
                                    <div className="choice-inert">
                                      <i className="ti ti-info-circle" aria-hidden="true" />
                                      <span>{def.inert}</span>
                                    </div>
                                  )}
                                  {/* WG's SECOND select on Domain Initiate: the INITIAL DOMAIN SPELL, chosen
                                      from every initiate domain spell (their filter: rank-1 Domain focus
                                      spells) — owner's 2026-09-02 ruling. Unpicked = the chosen domain's own
                                      spell, which is the printed pairing and the placeholder says so. */}
                                  {/* Every single-pick domains choice, not Domain Initiate alone: Deity's Domain and
                                      Domain Acumen carry the same WG "Choose an Initial Domain Spell" select, and the
                                      engine (applyFeatFocus) already honours featSpellChoices for any domains choice —
                                      only this gate kept the picker from the sibling records (experience gate, 2026-09-02). */}
                                  {def.kind === 'domains' && (def.picks ?? 1) === 1 && (
                                    <PopupSelect
                                      title="Initial domain spell"
                                      placeholder={(() => {
                                        const dom = build.featChoices[key];
                                        const dft = dom ? content.spells[DOMAIN_SPELLS[dom] ?? '']?.name : undefined;
                                        return dft ? `Default: ${dft} (your domain’s spell)…` : 'Initial domain spell…';
                                      })()}
                                      value={build.featSpellChoices?.[key] ?? ''}
                                      onChange={(v) => actions.patch({ featSpellChoices: { ...(build.featSpellChoices ?? {}), [key]: v } })}
                                      options={initialDomainSpellOptions(content)}
                                    />
                                  )}
                                  {/* batch 035: lesson-of-elements#familiar-spell-choice — a pick that hands
                                      over a CLASS FEATURE whose own clause is an "or": *"Your familiar learns
                                      your choice of breathe fire, gust of wind, hydraulic push, or pummeling
                                      rubble."* WG shows a second select here and so must we — the flat
                                      `grantedSpells` list cannot say "or", and a silent default would decide
                                      the spell for the player. Same storage as the domain spell above. */}
                                  {def.ownsFeature && (() => {
                                    const ans = build.featChoices[key] ?? '';
                                    const rec = content.classFeatures[ans] ?? content.classFeatures[ans.replace(/^aon-/, '')];
                                    const gsc = rec?.grantedSpellChoice;
                                    if (!gsc) return null;
                                    const sk = `${key}:granted-spell`;
                                    return (
                                      <PopupSelect
                                        title={gsc.prompt}
                                        placeholder={`${gsc.prompt}…`}
                                        value={gsc.options.includes(build.featSpellChoices?.[sk] ?? '') ? build.featSpellChoices![sk] : ''}
                                        onChange={(v) => actions.patch({ featSpellChoices: { ...(build.featSpellChoices ?? {}), [sk]: v } })}
                                        options={gsc.options.map((id) => ({ value: id, label: content.spells[id]?.name ?? id, description: content.spells[id]?.description, record: { bucket: 'spells', id } }))}
                                      />
                                    );
                                  })()}
                                  {limitReasons.map((r) => (
                                    <div className="choice-inert" key={r}>
                                      <i className="ti ti-filter" aria-hidden="true" />
                                      <span>{r}</span>
                                    </div>
                                  ))}
                                </SubCard>
                              );
  };

  /**
   * The sub-choice belonging to a feat the character was GIVEN rather than picked.
   *
   * The control existed but only one path reached it: Builder walked `FEAT_FEAT_GRANTS[picked]`, so a
   * feat granted by another feat got its picker and a feat granted by a BACKGROUND or a CLASS FEATURE
   * did not — those never become `picked`. Abadar's Avenger grants "Assurance with Religion" and the
   * sheet could only show a bare "Assurance", unable to name the skill. 52 records were in that state.
   *
   * Storage is `build.grantedFeatChoices[featId]`, keyed by the GRANTED feat, which is what
   * build.ts already reads — so wiring the picker in is all that was missing.
   *
   * `grantVariant` is set when this row is a granter's SECOND taking of the same feat — Anvil Dwarf's
   * *"you can pick two different specialties instead of one"*. It moves the answer to
   * `grantedChoiceKey(featId, variant)` so the two takings are answered separately instead of sharing
   * one key and printing the same specialty twice; the bare key stays the first taking's.
   */
  const grantedChoicePicker = (grantedId: string, grantVariant?: string) => {
    const def = content.feats[grantedId]?.choice;
    if (!def) return null;
    /*
     * A grant whose answer the GRANTING feat already gave gets no question at all — Weight of
     * Experience's "the Assurance skill feat in that skill" is not a second choice, and offering all
     * 16 skills let the player train one and be assured in another. Shown as a stated fact rather
     * than dropped: ruling Q27's point is that the player must never be left wondering whether they
     * missed a pick, and a granter that names the skill IS the answer to the question.
     *
     * The granter comes off the BUILT character (`grantedBy`) so this works from all three call
     * sites, including the two that only know the granted feat's id.
     *
     * Rendered on the SPEC, not on the resolved value: Gnome Obsession's Lore has no default, so
     * until the player names it there is no answer to show — and offering the free list meanwhile
     * would hand them a control whose answer is discarded the moment they type the Lore in.
     */
    const granter = featPrereqChar.feats.find((f) => f.featId === grantedId)?.grantedBy;
    /*
     * The same rule on the BACKGROUND lane. A background never becomes `grantedBy` — build.ts pushes
     * its feats without one — so this needs its own lookup rather than falling out of the line above.
     * Abadar's Avenger names Religion; offering the 16-skill list there let the player answer a
     * question the background had already answered, and ruling Q20 makes that answer load-bearing
     * because it decides which skill carries Assurance's `*`.
     */
    const boundBg = resolveBackground(build, content);
    if (boundBg && isBoundBackgroundGrant(boundBg.id, grantedId)) {
      const bound = boundBackgroundGrantChoice(build, content, boundBg, grantedId);
      return (
        <SubCard
          key={`gfc-${grantedId}`}
          icon="ti-adjustments"
          label={`${content.feats[grantedId]!.name}: ${featChoicePrompt(def.prompt, def.flag)}`}
        >
          <div className="choice-inert">
            <i className="ti ti-info-circle" aria-hidden="true" />
            <span>
              {bound
                ? `${bound.label} — set by ${boundBg.name}, which names it. Not a separate choice.`
                : `Follows ${boundBg.name}'s own choice above — answer that and this fills in.`}
            </span>
          </div>
        </SubCard>
      );
    }
    if (granter && isBoundGrant(granter, grantedId)) {
      // The granter's SLOT, because a Lore answer is stored per taking now — without it Gnome
      // Obsession's bound Assurance reads blank and the card says "answer that and this fills in"
      // forever, even though the player already typed the Lore.
      const bound = boundGrantChoice(build, content, granter, grantedId, featPrereqChar.feats.find((f) => f.featId === granter)?.slotKey);
      // …or a HERITAGE's name: a granter id is not always a feat's (Woodstalker Lizardfolk names the
      // terrain on the Terrain Stalker it hands over), and the raw slug read as broken content.
      const granterName = content.feats[granter]?.name ?? content.heritages[granter]?.name ?? granter;
      return (
        <SubCard
          key={`gfc-${grantedId}`}
          icon="ti-adjustments"
          label={`${content.feats[grantedId]!.name}: ${featChoicePrompt(def.prompt, def.flag)}`}
        >
          <div className="choice-inert">
            <i className="ti ti-info-circle" aria-hidden="true" />
            <span>
              {bound
                ? `${bound.label} — set by ${granterName}, which names the skill. Not a separate choice.`
                : `Follows ${granterName}'s own choice above — answer that and this fills in.`}
            </span>
          </div>
        </SubCard>
      );
    }
    const opts: NarrowedOption[] =
      def.kind === 'domains'
        ? /* Through buildChoiceOptions (no slotKey — this IS the granted taking), not a bare pool:
           * the funnel is what greys a domain a slot take of the same repeatable feat already
           * claimed, per Domain Initiate's "a different domain each time". */
          buildChoiceOptions(grantedId, def, build, content, featPrereqChar)
        : def.kind === 'skills'
          ? SKILLS.map((s) => ({ value: s, label: cap(s) }))
          : def.kind === 'open'
            ? /*
               * An OPEN set carries no `options` on the record, so the narrowing path below resolved it
               * to an empty list and `if (!opts.length) return null` rendered NO PICKER AT ALL. As in
               * Life, So in Death grants Adopted Ancestry, whose list is every ancestry — the one place
               * a granted feat's menu is open rather than enumerated. The picked-feat path (renderChoice)
               * has handled `open` since it shipped; this one never did.
               */
              openChoiceOptions(def.from, content, {
                hideLegacy: build.hideLegacy,
                character: featPrereqChar,
                keep: [build.grantedFeatChoices?.[grantedChoiceKey(grantedId, grantVariant)]],
              }).map((o) => ({
                value: o.id,
                label: o.note ? `${o.name} (${o.note})` : o.name,
                ...(o.description ? { description: o.description } : {}),
              }))
            : // A granted feat's menu can be widened by another record just like a picked one's — the
            // widening is addressed by record id, and a granted feat has the same id either way.
            // …and NARROWED the same way (ruling Q9). This is where the three narrowing backgrounds
            // land: Toymaker, Isgeri Reclaimer and Reputation Seeker all restrict a feat they GRANT,
            // so a limit applied only on the picked-feat path would never have reached them.
            // …and a class sub-pick in the class's own picker's order, as on the slot path (desk #170).
            classSubPickOrder(
              narrowChoiceOptions(grantedId, def, effectiveChoiceOptions(grantedId, def, featPrereqChar, content), featPrereqChar, content),
              def,
              content,
            );
    if (!opts.length) return null;
    const answerKey = grantedChoiceKey(grantedId, grantVariant);
    // The second taking says so on the card, or the player sees the same question twice with no way
    // to tell which is which — Q27's "never leave them wondering whether they missed a pick".
    const label = `${content.feats[grantedId]!.name}${grantVariant ? ' (second)' : ''}: ${featChoicePrompt(def.prompt, def.flag)}`;
    const answer = build.grantedFeatChoices?.[answerKey] ?? '';
    const setAnswer = (v: string) =>
      actions.patch({ grantedFeatChoices: { ...(build.grantedFeatChoices ?? {}), [answerKey]: v } });
    // Why the list is short, in the narrowing record's own words. A menu silently cut from 12 entries
    // to 6 reads as missing content, which is the failure Q27 names from the other direction.
    const limitReasons = effectiveChoiceLimits(grantedId, def, featPrereqChar, content).map((l) => l.reason);
    return (
      <SubCard key={`gfc-${answerKey}`} icon="ti-adjustments" label={label}>
        <PopupSelect
          title={featChoicePrompt(def.prompt, def.flag)}
          placeholder={`${featChoicePrompt(def.prompt, def.flag)}…`}
          value={answer}
          onChange={setAnswer}
          // Trailblazer's "one terrain you've explored (such as forest or underground)" arrives on this
          // lane, not the slot one — a granted feat's question is as open as a picked one's.
          options={withCustomAnswer(opts.map((o) => pickerOption(o, choiceOptionRecord(def, o.value, content))), def, answer)}
          // A narrowed list with a "type your own" row is not narrowed. Terrain Stalker carries
          // `allowCustom` because the book lets a GM name a tenth terrain — but Isgeri Reclaimer says
          // "either rubble or underbrush", so while its limit is in force the typing row goes away.
          // `withCustomAnswer` above still shows an answer typed BEFORE the limit existed, rather than
          // deleting a player's pick behind their back.
          addCustom={!limitReasons.length && def.allowCustom ? { ...def.allowCustom, onAdd: setAnswer } : undefined}
        />
        {/* The picked-feat path has rendered these two since it shipped; this one never did, so a note
            or an inert admission authored on a record went invisible the moment the record was GRANTED
            rather than picked — Adopted Ancestry's "an uncommon or rare one needs your GM's access"
            caveat lands on exactly that path (As in Life, So in Death). */}
        {def.note && (
          <div className="choice-inert">
            <i className="ti ti-alert-circle" aria-hidden="true" />
            <span>{def.note}</span>
          </div>
        )}
        {def.inert && (
          <div className="choice-inert">
            <i className="ti ti-info-circle" aria-hidden="true" />
            <span>{def.inert}</span>
          </div>
        )}
        {/* WG's second select on Domain Initiate — the granted copy (a cloistered cleric's doctrine)
            asks it too, keyed apart from any slot take so each take picks its own spell. */}
        {def.kind === 'domains' && (def.picks ?? 1) === 1 && (
          <PopupSelect
            title="Initial domain spell"
            placeholder={(() => {
              const dft = answer ? content.spells[DOMAIN_SPELLS[answer] ?? '']?.name : undefined;
              return dft ? `Default: ${dft} (your domain’s spell)…` : 'Initial domain spell…';
            })()}
            value={build.featSpellChoices?.[`granted:${grantedId}`] ?? ''}
            onChange={(v) => actions.patch({ featSpellChoices: { ...(build.featSpellChoices ?? {}), [`granted:${grantedId}`]: v } })}
            options={initialDomainSpellOptions(content)}
          />
        )}
        {/* …and the lesson's own "or" on the GRANTED copy (Basic Witchcraft → Basic Lesson → Lesson of the
            Elements: *"Your familiar learns your choice of breathe fire, gust of wind, hydraulic push, or
            pummeling rubble"*). WG shows this second select wherever the lesson is taken; the slot path has
            asked it since batch 035 and this one never did, so the granted lesson taught no spell at all. */}
        {def.ownsFeature &&
          (() => {
            const rec = content.classFeatures[answer] ?? content.classFeatures[answer.replace(/^aon-/, '')];
            const gsc = rec?.grantedSpellChoice;
            if (!gsc) return null;
            const sk = `granted:${grantedId}:granted-spell`;
            return (
              <PopupSelect
                title={gsc.prompt}
                placeholder={`${gsc.prompt}…`}
                value={gsc.options.includes(build.featSpellChoices?.[sk] ?? '') ? build.featSpellChoices![sk] : ''}
                onChange={(v) => actions.patch({ featSpellChoices: { ...(build.featSpellChoices ?? {}), [sk]: v } })}
                options={gsc.options.map((id) => ({ value: id, label: content.spells[id]?.name ?? id, description: content.spells[id]?.description, record: { bucket: 'spells', id } }))}
              />
            );
          })()}
        {limitReasons.map((r) => (
          <div className="choice-inert" key={r}>
            <i className="ti ti-filter" aria-hidden="true" />
            <span>{r}</span>
          </div>
        ))}
      </SubCard>
    );
  };

  // Divine font (cleric): the deity's allowed heal/harm options + the resolved slot count.
  const hasFontFeature = !!casterCls?.features?.some((f) => f.featureId === 'divine-font');
  const fontOptions = ((build.deityId ? content.deities[build.deityId]?.divineFont : undefined) ?? []) as (
    | 'heal'
    | 'harm'
  )[];
  const fontSlots = featPrereqChar.spellcasting.find((e) => e.font)?.font?.slots ?? 0;
  // Index spells per tradition ONCE per content load: cantrips (rank 0) on their own, and a
  // CUMULATIVE list per leveled rank (1..N) so a slot of rank N offers every spell of rank ≤ N
  // (a lower-rank spell prepared/known in a higher slot is cast heightened). Stable references keep
  // FilterableSelect's internal memos from re-running on each open-picker re-render.
  type Sp = (typeof content.spells)[string];
  const spellIndex = useMemo(() => {
    const byRank: Record<string, Record<number, Sp[]>> = {};
    for (const s of listValues(content, content.spells)) {
      for (const t of s.traditions) {
        const m = (byRank[t] ??= {});
        (m[s.rank] ??= []).push(s);
      }
    }
    const cantrips: Record<string, Sp[]> = {};
    const upTo: Record<string, Record<number, Sp[]>> = {};
    for (const t of Object.keys(byRank)) {
      cantrips[t] = (byRank[t][0] ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
      upTo[t] = {};
      let acc: Sp[] = [];
      for (let r = 1; r <= 10; r++) {
        if (byRank[t][r]) acc = acc.concat(byRank[t][r]);
        upTo[t][r] = acc.slice().sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
      }
    }
    return { cantrips, upTo };
  }, [content]);
  const NO_SPELLS: Sp[] = useMemo(() => [], []);
  /**
   * Spells a feat ADDS to your list ("Add Behold the Weave, Cast into Time, Haste … to your spell
   * list"). The sheet's Manage-Spells picker already reads `character.spellListAdditions`; this one
   * filtered on tradition alone, so a caster building a repertoire here could never pick the spells
   * their own feat had just granted them.
   */
  /*
   * ONE body for both class pickers (lane C2): `listAdditions` widens the first class's list,
   * `listAdditions2` the second's under Dual Class. The second picker read no widening at all, so an
   * X/Cleric's deity spells and an X/Summoner(fey)'s illusions reached the sheet's picker and never the
   * builder's — where a prepared caster's book is actually filled.
   *
   * `entryId` is the pool this picker fills (`<class id>-casting`): a widening aimed at ANOTHER entry is
   * not this picker's. The first picker used to take a feat widening aimed at EITHER class's entry, so a
   * row naming the second class's pool widened the first one too. `classId`/`subclassId` name the class
   * whose own features widen it — a feature both classes hold widens both, as buildCharacter leaves it.
   */
  const collectListAdditions = (entryId: string, classId: string | null, subclassId: string | null | undefined): Set<string> => {
    const out = new Set<string>();
    // A widening may name whole TRADITIONS rather than spells — "one spell in your spell repertoire
    // not on the divine spell list" (Mysterious Repertoire). Expanded here, in a memo, rather than
    // onto the character, where it would be ~1,500 ids in every saved roster entry. Each rule keeps its
    // TRAIT narrowing: Fey Eidolon opens *"spells that have the illusion or mental traits that appear on
    // the arcane spell list"* (AoN eidolon-8), not the whole arcane list — the sheet's `spellOpenedBy`
    // test, so the two pickers offer the same spells.
    const opened: { traditions: Tradition[] | 'any'; traits?: string[] }[] = [];
    const widenings = (list: SpellAccessGrant | SpellAccessGrant[] | undefined): SpellAccessGrant[] =>
      list == null ? [] : Array.isArray(list) ? list : [list];
    const widen = (add: SpellAccessGrant) => {
      for (const s of add.spells ?? []) if (content.spells[s]) out.add(s);
      // "Add up to three of your deity's spells to your spell list" — resolved from the build's own
      // deity, so the picker offers the right three the moment the player picks a deity. (The same arm
      // the class-feature loop needs: Deity (Cleric) "adds your deity's spells to your spell list".)
      if (add.from === 'deity' && build.deityId)
        for (const s of content.deities[build.deityId]?.spells ?? []) if (content.spells[s]) out.add(s);
      if (add.traditions) opened.push({ traditions: add.traditions, ...(add.traits?.length ? { traits: add.traits } : {}) });
    };
    for (const featId of Object.values(build.featPicks ?? {})) {
      for (const add of widenings(featId ? content.feats[featId]?.spellListAdditions : undefined)) {
        // Only the plain list-widening lane belongs in this picker — 'repertoire' and 'font' grants
        // are applied by buildCharacter and are not the player's to choose here.
        if (add.as && add.as !== 'list') continue;
        // …and only widenings aimed at the CLASS pool this picker fills. An `entryId`-scoped row
        // (Psi Development's six psi cantrips → `psychic-dedication-casting`) belongs to the
        // archetype pool's own picker in shared.tsx; un-gated it offered them in the class list too.
        if (add.entryId && add.entryId !== entryId) continue;
        widen(add);
      }
    }
    /* …and a widening carried by a CLASS FEATURE rather than a feat. The necromancer's dirge grants
     * occult access to Harm — a divine spell — so without this the SHEET offered it and the builder,
     * which is where a prepared caster's book is actually filled, did not. */
    if (classId) {
      for (const fid of classFeatureIdsOwned({ classId, subclassId, level: build.level }, content)) {
        for (const add of widenings(content.classFeatures[fid]?.spellListAdditions)) {
          if (add.as && add.as !== 'list') continue;
          if (add.entryId && add.entryId !== entryId) continue;
          widen(add);
        }
      }
    }
    if (opened.length) {
      for (const s of Object.values(content.spells)) {
        if (s.ritual) continue;
        if (opened.some((w) => spellOpenedBy(w, s))) out.add(s.id);
      }
    }
    return out;
  };
  const listAdditions = useMemo(
    () => collectListAdditions(`${build.classId}-casting`, build.classId, build.subclassId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [build.featPicks, build.deityId, build.classId, build.subclassId, build.level, content],
  );
  /**
   * A class archetype that REPLACES the list ("Replace your spell list with the elemental spell
   * list"). The tradition index is still the right starting point for everyone else, so this
   * narrows it in place rather than being folded into spellIndex — and it has to be here as well as
   * in the sheet, because a wizard prepares from the SPELLBOOK and the spellbook is filled here.
   */
  const listReplacement = featPrereqChar.spellListReplacement;
  const onReplacedList = (s: Sp) => {
    const r = listReplacement!;
    // Only a spell that is on SOME list can be on a replaced one. Focus spells, rituals and the
    // class-granted cantrips (bard compositions, witch hexes, psychic amps) all carry no tradition,
    // which is exactly what kept them out of the ordinary picker for free — a rule written on
    // traits has to say so, or an elementalist wizard is offered Crushing Ground to learn.
    if (!s.traditions.length) return !!s.spellLists?.includes(r.list);
    if (s.spellLists?.includes(r.list)) return true;
    if (!r.anyTrait.length) return false;
    const t = s.traits ?? [];
    return t.some((x) => r.anyTrait.includes(x)) && !t.some((x) => r.excludeTraits.includes(x));
  };
  /** Under Dual Class, the second class's entry id (buildCharacter's `<class id>-casting`). */
  const secondEntryId = build.variantRules?.dualClass && build.classId2 ? `${build.classId2}-casting` : undefined;
  /** The list one class pool's picker offers: its tradition (or the class archetype's replacement list),
   *  plus that pool's own widenings. ONE body for the first class (`eligibleSpells`) and, under Dual
   *  Class, the second (`eligibleSpells2`) — lane C2. `replaced` says whether the replacement list is
   *  this pool's: buildCharacter aims it at the archetype's class entry (`spellListReplacement.entryId`). */
  const poolSpellsFor = (rank: number, trad: string | undefined, additions: Set<string>, replaced: boolean, narrowArchetypeCantrips: boolean) => {
    if (!trad) return NO_SPELLS;
    let base = rank === 0 ? spellIndex.cantrips[trad] ?? NO_SPELLS : spellIndex.upTo[trad]?.[rank] ?? NO_SPELLS;
    if (listReplacement && replaced) {
      // The replaced list is not a subset of the tradition — an inner sea elementalist wizard gets
      // primal water spells — so it is rebuilt from the whole spell set, not filtered out of `base`.
      const pool = Object.values(content.spells).filter(
        (s) => (rank === 0 ? s.rank === 0 : s.rank > 0 && s.rank <= rank) && onReplacedList(s as Sp),
      ) as Sp[];
      base = pool.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    }
    /* A caster ARCHETYPE that names its cantrips — Oatia Skysage: *"two of the following cantrips of
     * your choice: detect magic, guidance, know the way, or read aura"* (feat-8112). This surface is
     * the archetype's cantrip picker only when the CLASS is not itself a caster (a caster class picks
     * its archetype pool on the Setup card instead), so the class's own list is never narrowed here.
     * `listAdditions` below is deliberately still added on top: a feat that grants a cantrip grants it
     * by its own printed text, which the dedication's list does not override. */
    if (narrowArchetypeCantrips && rank === 0 && archCaster?.config.cantripOptions) {
      base = base.filter((s) => archetypeCantripAllowed(archCaster, s.id));
    }
    if (!additions.size) return base;
    const have = new Set(base.map((s) => s.id));
    const extra = [...additions]
      .map((id) => content.spells[id])
      .filter((s): s is Sp => !!s && !have.has(s.id) && (rank === 0 ? s.rank === 0 : s.rank > 0 && s.rank <= rank));
    return extra.length ? [...base, ...extra].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)) : base;
  };
  // The first pool keeps the replacement unless the archetype names the SECOND class's entry; a single
  // class keeps it exactly as before.
  const eligibleSpells = (rank: number) =>
    poolSpellsFor(rank, tradition, listAdditions, !!listReplacement && (!secondEntryId || listReplacement.entryId !== secondEntryId), !casting);
  // ── Dual Class: the SECOND caster's spell surface (writes cantrips2/spells2/signatures2). Only when
  //    the dual-class variant is on AND the second class is itself a slot caster. These mirror the
  //    primary caster derivations above, and feed the consolidated "Second class spells" card + the
  //    caster:2 branch of the spell picker. The primary path never reads these. ──
  const cls2 = build.variantRules?.dualClass && build.classId2 ? content.classes[build.classId2] : undefined;
  const casting2 = cls2?.spellcasting;
  const subOption2 = cls2?.subclass?.options.find((o) => o.id === build.subclassId2);
  const showSpells2 = !!casting2;
  const castProgression2 = subOption2?.slotProgression ?? casting2?.progression;
  /* THIS class's archetype prices, as `archMods` is the first's — the same `classCasting` builds both
   * entries (lane C2). A flexible second class casts its COLLECTION spontaneously, exactly as `castType`
   * says for the first; its rows stay per rank, which never asks for more than the pool's places. */
  const archMods2 = classArchetypeSpellMods(build, content, build.classId2);
  const castType2 = archMods2.spellCollection && casting2 ? 'spontaneous' : casting2?.type ?? 'prepared';
  /* The tradition buildCharacter gave the second entry — its patron's, eidolon's, bloodline's or
   * DRAGON's (lane C2: an X/Sorcerer with a divine dragon was offered arcane spells here). Read off the
   * built entry, so the two can never disagree; the option chain is only the fallback before a build. */
  const tradition2 =
    (cls2 ? featPrereqChar.spellcasting.find((e) => e.id === `${cls2.id}-casting`)?.tradition : undefined) ??
    optionDragon(subOption2, build.dragonExemplar)?.tradition ??
    subOption2?.tradition ??
    casting2?.tradition;
  const isPrepared2 = castType2 === 'prepared';
  const sigAvailable2 =
    casting2?.type === 'spontaneous' &&
    signatureSpellsAt(cls2, build.level);
  // Same spellbook lane as the primary class above (dual class), so a magus/wizard pair agrees with itself
  // — the CLASS's own casting type, as `isWizardBook` reads it (desk 155: a flexible wizard keeps its book).
  const bookSpec2 = casting2?.spellbook;
  const isWizardBook2 = !!casting2 && casting2.type === 'prepared' && (!!bookSpec2 || cls2?.id === 'wizard' || cls2?.id === 'witch');
  const isUmtBook2 = cls2?.id === 'wizard' && subOption2?.id === 'school-of-unified-magical-theory';
  const spellbookSize2 = bookSpec2 ? spellbookBudget(bookSpec2, build.level) : wizardSpellbookBudget(build.level, isUmtBook2);
  /* The second class's prices and allowances by the FIRST class's formulas (lane C2), because
   * buildCharacter builds both entries with one `classCasting`: the archetype that names this class
   * (`archMods2`), its slot ceiling, Cantrip Expansion's bonus — the card offered `cantripsKnown` alone
   * while the sheet kept the bonus cantrips, so the extra ones could never be chosen. */
  const capArch2 =(counts: Record<number, number>): Record<number, number> =>
    archMods2.slotCap == null ? counts : Object.fromEntries(Object.entries(counts).map(([r, n]) => [r, Math.min(n, archMods2.slotCap!)]));
  const slotCounts2 = casting2 ? repertoireCounts(capArch2(casterSlots(build.level, castProgression2)), casting2.extraRepertoire) : {};
  const cantripCap2 =
    casting2 && build.classId2 ? Math.max(0, cantripsKnown(build.classId2) + classCantripBonus(build, content, build.classId2) + archMods2.cantripDelta) : 0;
  /* …and a BOOK caster's row is its BOOK, exactly as the first class's is (lane C1's shape): ten (eight)
   * cantrips, the first `cantripAllowance2` of them prepared each morning — re-preparable on the sheet. */
  const bookWord2 = isWizardBook2 ? bookNoun(cls2) : undefined;
  const cantripAllowance2 = Math.max(0, cantripCap2 - (isUmtBook2 ? 1 : 0));
  /* buildCharacter's own entry for the second class, and its gift's place — the first class's rule
   * (`ownPlacesBeside`), so a Fighter/Sorcerer's card offers what a Sorcerer's level page does. */
  const castEntry2 = cls2 ? featPrereqChar.spellcasting.find((e) => e.id === `${cls2.id}-casting`) : undefined;
  const cantripRowCap2 = isWizardBook2
    ? Math.max(bookCantripCapacity(cls2) ?? 0, cantripAllowance2)
    : ownPlacesBeside(castEntry2, 0, cantripCap2, build.cantrips2 ?? []);
  const learnedTotal2 = Object.values(build.spells2 ?? {}).reduce((n, arr) => n + arr.length, 0);
  // The second pool's widenings — the same body as the first's, aimed at the second entry.
  const listAdditions2 = useMemo(
    () => (secondEntryId ? collectListAdditions(secondEntryId, build.classId2 ?? null, build.subclassId2) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [secondEntryId, build.featPicks, build.deityId, build.classId2, build.subclassId2, build.level, content],
  );
  const eligibleSpells2 = (rank: number) =>
    poolSpellsFor(rank, tradition2, listAdditions2, !!listReplacement && !!secondEntryId && listReplacement.entryId === secondEntryId, false);
  const familiarAbilityList = useMemo(
    () => Object.values(content.familiarAbilities).sort((a, b) => a.name.localeCompare(b.name)),
    [content],
  );
  // Level-1 wizard class feats — the option list for the School of Unified Magical Theory bonus feat.
  const umtFeatOpts = useMemo(
    () =>
      listValues(content, content.feats)
        .filter((f) => f.category === 'class' && f.level <= 1 && (f.traits ?? []).includes('wizard'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ value: f.id, label: f.name, description: f.description, record: { bucket: 'feats', id: f.id } })),
    [content.feats],
  );
  const isUmtSchool = build.classId === 'wizard' && build.subclassId === 'school-of-unified-magical-theory';
  // Skill feats — option list for a dedication's bonus skill feat (Rogue Dedication).
  const skillFeatOpts = useMemo(
    () =>
      listValues(content, content.feats)
        .filter((f) => f.category === 'skill')
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
        .map((f) => ({ value: f.id, label: f.name, description: f.description, record: { bucket: 'feats', id: f.id } })),
    [content.feats],
  );

  // --- per-level spell progression (spells are chosen on the level where they're gained) ---
  // Spell slots per rank at a given character level (0 = before play).
  const slotsAt = (L: number): Record<number, number> =>
    L < 1 ? {} : casting ? classPickCounts(L) : archCaster ? archExtraKnownAt(archetypeSlots(L, archCaster), L) : {};
  // Spellbook budget (a single across-rank total) at a given level — the class's own `spellbook` numbers
  // (magus 4 + 2) when it carries them, else the wizard ladder including the UMT +1.
  const bookAt = (L: number) => (L < 1 ? 0 : bookSpec ? spellbookBudget(bookSpec, L) : wizardSpellbookBudget(L, isUmtBook));
  /* batch 037: flexible-spellcaster#collection-shape — the OTHER across-rank budget on this rail: the
   * spell collection, sized by `flexibleCollectionSize` (buildCharacter's own function, so the picker
   * and the sheet cannot disagree about how many spells the pool holds). */
  const flatBudget = isWizardBook || isFlexCollection;
  const flatAt = (L: number) => (L < 1 ? 0 : isFlexCollection ? flexibleCollectionSize(slotsAt(L)) : bookAt(L));
  /* batch 037: flexible-spellcaster#capstone-outside-collection — the class's single 10th-rank slot is
   * OUTSIDE the collection (*"flexible spellcaster doesn't change the way that spell works"*,
   * archetype-99), so it is neither counted against the pool's places nor drawn inside the pool rail.
   * `capstoneAt` is the level it arrives (19th for a full caster) and how many such slots there are;
   * `poolSpent` is what the pool itself has spent, which `learnedTotal` — every rank — cannot say. */
  const capstoneAt = (L: number) => (isFlexCollection && !(slotsAt(L - 1)[10] ?? 0) ? slotsAt(L)[10] ?? 0 : 0);
  const poolSpent = isFlexCollection
    ? Object.entries(build.spells).reduce((n, [r, arr]) => (Number(r) <= 9 ? n + (arr?.length ?? 0) : n), 0)
    : learnedTotal;
  /* The level an ARCHETYPE caster starts casting: the page its dedication was taken on (a summoner's Basic
   * feat, which is what brings its casting). The loop below answered 1 for every archetype — its cantrip
   * count is positive at every level — so a Wizard Dedication taken at 2nd drew its spellbook cantrips on
   * the Level 1 page, a level before the character had them. A dedication with no slot of its own (a
   * granted one) keeps the old answer. */
  const archStartLevel = (() => {
    if (!archCaster) return 1;
    const starts = archCaster.config.castsFromBasic && archCaster.config.basicId ? archCaster.config.basicId : archCaster.dedicationId;
    let best = Infinity;
    for (const [slotKey, id] of Object.entries(build.featPicks)) {
      const L = Number(slotKey.split(':')[0]);
      if (id === starts && Number.isFinite(L) && L >= 1) best = Math.min(best, L);
    }
    return Number.isFinite(best) ? Math.min(best, build.level) : 1;
  })();
  // The first level this character can cast — cantrips, tradition, and divine font live here.
  const firstCasterLevel = (() => {
    if (!showSpells) return 0;
    for (let L = archStartLevel; L <= 20; L++) if (cantripCap > 0 || Object.keys(slotsAt(L)).length) return L;
    return archStartLevel;
  })();
  /** The ranks a dedication's BOOK has grown at by level L (ArchetypeBook) — what each new rank adds. */
  const archBookRanksAt = (L: number): ArchetypeBookRank[] => (archBook && L >= 1 ? archetypeBookRanks(L, archCaster) : []);
  /** What a new rank adds to the book, in the print's terms — the sentence the caster-class card shows too. */
  const archBookSentence = (r: ArchetypeBookRank | undefined): string => (archBook ? archetypeBookSentence(archBook, r) : '');
  // What spell capacity is GAINED at level L (vs the level before) — drives the per-level pickers.
  /* The player's OWN places at a rank: the slot count, less a sorcerer's gift spell once the rank has
   * slots at all (lane C2 — *"your first new spell is always the sorcerous gift spell for that rank"*,
   * so the gift arrives with the rank and is one of its places; the row offered the full count, and the
   * sheet drew the player's last pick nowhere). `cap - gained` stays the previous level's own places,
   * which is what `spellsDropAt` compares against. */
  const ownPlaces = (counts: Record<number, number>, r: number) =>
    (counts[r] ?? 0) > 0 ? ownPlacesBeside(castEntry1, r, counts[r] ?? 0, build.spells[r] ?? []) : 0;
  const spellGainsAt = (L: number) => {
    const cur = slotsAt(L);
    const prev = slotsAt(L - 1);
    /* A dedication's BOOK grows by RANK, not by slot: *"Each time you gain a spell slot of a new rank
     * from the wizard archetype, add two common spells of that rank to your spellbook"* (feat-5109). So
     * its rows are the ranks first reached at L, each asking for the Basic feat's two (three) spells —
     * and an Arcane Breadth slot at a rank the book already has adds a slot to prepare, not a row. */
    const ranks = archBook
      ? archBookRanksAt(L)
          .filter((r) => !archBookRanksAt(L - 1).some((p) => p.rank === r.rank))
          .map((r) => ({ rank: r.rank, gained: r.places, cap: r.places }))
      : [...new Set([...Object.keys(cur), ...Object.keys(prev)].map(Number))]
          .filter((r) => r >= 1 && (cur[r] ?? 0) > (prev[r] ?? 0))
          .sort((a, b) => a - b)
          .map((r) => ({ rank: r, gained: ownPlaces(cur, r) - ownPlaces(prev, r), cap: ownPlaces(cur, r) }));
    return {
      ranks,
      // batch 037: flexible-spellcaster#collection-shape — both across-rank pools grow through here.
      bookGained: flatBudget ? flatAt(L) - flatAt(L - 1) : 0,
      cantrips: L === firstCasterLevel ? cantripCap : 0,
    };
  };
  const hasSpellGains = (L: number) => {
    if (!showSpells) return false;
    const g = spellGainsAt(L);
    return L === firstCasterLevel || g.ranks.length > 0 || g.bookGained > 0 || g.cantrips > 0;
  };
  // Whether lowering past level L would strip spells the player actually chose — so the level-down
  // confirmation fires for spells too, not just feats / skill increases / attribute boosts.
  const spellsDropAt = (L: number) => {
    if (!showSpells) return false;
    const g = spellGainsAt(L);
    const anySpells = (build.cantrips ?? []).some(Boolean) || Object.values(build.spells ?? {}).some((a) => a?.length);
    // Dropping the first caster level (or a wizard's new spellbook capacity) can strip chosen spells.
    if ((g.cantrips > 0 || g.bookGained > 0) && anySpells) return true;
    // A rank whose slot count rose here: warn only if the player stocked more than the lower cap holds.
    return g.ranks.some((r) => (build.spells[r.rank] ?? []).length > r.cap - r.gained);
  };

  /** The Spells section for one level card: the cantrips/slots GAINED at that level. */
  const renderSpellsForLevel = (lvl: number) => {
    if (!hasSpellGains(lvl)) return null;
    const g = spellGainsAt(lvl);
    const atFirst = lvl === firstCasterLevel;
    return (
      <div className="card-sec">
        <div className="bsec-title">
          {atFirst ? `Spells — ${cap(tradition ?? '')} ${castType}${archCaster ? ' (archetype)' : ''}` : 'Spells gained this level'}
        </div>
        {atFirst && listReplacement && (
          <p className="setup-hint">
            {listReplacement.from} replaced your spell list with the {listReplacement.list} spell list — you still cast
            on the {cap(tradition ?? '')} tradition, but you choose your spells from that list instead.
            {listReplacement.note ? ` ${listReplacement.note}` : ''}
          </p>
        )}
        {atFirst && archCaster?.config.choiceTradition && (
          <div className="spell-pick-row">
            <div className="spr-head">
              <span>Tradition</span>
              <span className="spr-count">your choice</span>
            </div>
            <div className="spr-chips">
              {(archetypeTraditionOptions(archCaster) ?? (['arcane', 'divine', 'occult', 'primal'] as const)).map((t) => (
                <button key={t} type="button" className={'inv-toggle' + (tradition === t ? ' on' : '')} onClick={() => actions.setArchetypeTradition(t)}>
                  {cap(t)}
                </button>
              ))}
            </div>
          </div>
        )}
        {atFirst && archCaster?.config.choiceKeyAbility && (
          <div className="spell-pick-row">
            <div className="spr-head">
              <span>Key attribute</span>
              <span className="spr-count">your choice</span>
            </div>
            <div className="spr-chips">
              {archCaster.config.choiceKeyAbility.map((a) => {
                const cur = build.archetypeKeyAbility ?? archCaster.config.keyAbility;
                return (
                  <button
                    key={a}
                    type="button"
                    className={'inv-toggle' + (cur === a ? ' on' : '')}
                    onClick={() => actions.patch({ archetypeKeyAbility: a })}
                  >
                    {a.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {atFirst && hasFontFeature && fontOptions.length > 0 && (
          <div className="spell-pick-row">
            <div className="spr-head">
              <span>Divine Font</span>
              <span className="spr-count">
                {fontSlots} extra {build.divineFont} {fontSlots === 1 ? 'slot' : 'slots'} (highest rank)
              </span>
            </div>
            <div className="spr-chips">
              {fontOptions.map((f) => (
                <button key={f} type="button" className={'inv-toggle' + (build.divineFont === f ? ' on' : '')} onClick={() => actions.changeDivineFont(f)}>
                  {cap(f)}
                </button>
              ))}
            </div>
          </div>
        )}
        {g.cantrips > 0 && (
          <div className="spell-pick-row">
            <div className="spr-head">
              {/* "Spellbook cantrips", "Familiar’s cantrips", "Dirge cantrips" — a book caster chooses
                  its BOOK here (owner's bug 2026-10-14); everyone else, the cantrips they know. */}
              <span>{bookWord ? bookCantripLabel(bookWord) : 'Cantrips'}</span>
              <span className="spr-count">
                {rowCantrips.length} / {cantripRowCap}
              </span>
            </div>
            {bookWord && (
              <p className="setup-hint book-cantrip-hint">
                {cantripAllowance === 1 ? 'The first is' : `The first ${cantripAllowance} are`} prepared each morning by default — change them on the sheet (Spells tab).
              </p>
            )}
            <div className="spr-chips">
              {giftChips(giftChipIds(castEntry1, 0, rowCantrips), variantGiftCount(castEntry1, 0))}
              {/* With no leveled book rows yet (no Basic spellcasting feat), this is the book's last row, so it
                  also shows a leveled grant (Basic Witchcraft's lesson taken first). */}
              {bookGrantEls(0, rowCantrips, lvl, !!archBook && !archBookRanksAt(build.level).length).chips}
              {rowCantrips.map((id) => (
                <span className="spr-chip" key={id}>
                  {content.spells[id]?.name ?? id}
                  <button type="button" className="spr-chip-x" aria-label={`Remove ${content.spells[id]?.name ?? id}`} onClick={() => writeCantrip(id)}>
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </span>
              ))}
              {/* Disabled at the cap, like every other "+ add" on this rail. Without it the button
                  opened a picker in which nothing could be added — `toggleCantrip` bails at the cap. */}
              <button
                className="spr-add"
                type="button"
                disabled={rowCantrips.length >= cantripRowCap}
                title={
                  rowCantrips.length >= cantripRowCap
                    ? bookWord
                      ? `Your ${bookWord} holds all ${cantripRowCap} cantrips it can — remove one first.`
                      : `All ${cantripRowCap} cantrip slots are filled — remove one first.`
                    : undefined
                }
                data-ctl="spell"
                data-ctl-title="Cantrip"
                data-ctl-options={cantripRowCap}
                onClick={() => setPicker({ kind: 'spell', rank: 0, cap: cantripRowCap })}
              >
                + add
              </button>
              {bookGrantEls(0, rowCantrips, lvl, !!archBook && !archBookRanksAt(build.level).length).notes}
            </div>
          </div>
        )}
        {flatBudget && (g.bookGained > 0 || capstoneAt(lvl) > 0) && (
          <>
            {/* batch 037: flexible-spellcaster#collection-shape — one across-rank pool, named for the
                rule that gives it: a spellbook, or the archetype's spell collection. */}
            <div className="bsec-sub">
              {isFlexCollection ? 'Spell collection' : bookTitle(bookWord)} — {poolSpent} / {flatAt(lvl)}{' '}
              {isFlexCollection ? 'collected' : 'learned'}
              {g.bookGained > 0 ? ` (+${g.bookGained} this level)` : ''}
            </div>
            {isFlexCollection && (
              // "You must select at least one 1st-level spell for your collection each time you
              // prepare" (archetype-99) — the pool's only printed restriction, and the player is the
              // one who satisfies it, so it is said where they choose.
              <p className="setup-hint">Any ranks you like, up to the total — but at least one 1st-rank spell.</p>
            )}
            {/* Why every "+ add" below is grey, in words: it was only each button's hover tooltip, and a
                tap on a disabled button does nothing, so a phone player was never told. Said once for
                the whole pool. test/phone-builder-shell.test.tsx. */}
            {poolSpent >= flatAt(lvl) && (
              <p className="lvl-note spr-why">
                <i className="ti ti-info-circle" aria-hidden="true" />
                <span>
                  Your {isFlexCollection ? 'collection' : bookWord ?? 'spellbook'} holds all {flatAt(lvl)} spells it can at this
                  level — remove one to choose a different spell.
                </span>
              </p>
            )}
            {Object.keys(slotsAt(lvl))
              .map(Number)
              // batch 037: flexible-spellcaster#capstone-outside-collection — ranks 1-9 only for a
              // collection: the 10th-rank slot is not one of the pool's places, so it gets its own
              // control below rather than a row that spends them.
              .filter((r) => r >= 1 && !(isFlexCollection && r > 9))
              .sort((a, b) => a - b)
              .map((rank) => {
                const chosen = build.spells[rank] ?? [];
                /* batch 037: flexible-spellcaster#collection-shape — the pool's one printed
                 * restriction, enforced where it is spent: *"you must select at least one 1st-level
                 * spell for your collection each time you prepare"* (archetype-99). With no 1st-rank
                 * spell collected, the last place is HELD — a higher rank cannot take it — which is
                 * the same place buildCharacter holds, so the picker offers exactly what the sheet
                 * keeps. The hint above says the rule; this says it where the press lands. */
                const floorHeld = isFlexCollection && rank >= 2 && !(build.spells[1] ?? []).length ? 1 : 0;
                const capHere = flatAt(lvl) - floorHeld;
                const full = poolSpent >= capHere;
                return (
                  <div className="spell-pick-row" key={rank}>
                    <div className="spr-head">
                      <span>{ord(rank)} rank</span>
                      <span className="spr-count">{chosen.length} {isFlexCollection ? 'collected' : 'learned'}</span>
                    </div>
                    <div className="spr-chips">
                      {chosen.map((id, idx) => (
                        <span className="spr-chip" key={id + ':' + idx}>
                          {content.spells[id]?.name ?? id}
                          <button type="button" className="spr-chip-x" aria-label={`Remove ${content.spells[id]?.name ?? id}`} onClick={() => actions.removeSpellAt(rank, idx)}>
                            <i className="ti ti-x" aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                      <button className="spr-add" type="button" disabled={full} title={full ? (floorHeld ? `Your collection must include at least one 1st-rank spell — the last of its ${flatAt(lvl)} places is held for one.` : isFlexCollection ? `Your collection holds all ${flatAt(lvl)} spells it can at this level.` : `Your ${bookWord ?? 'spellbook'} holds all ${flatAt(lvl)} spells it can at this level.`) : undefined} data-ctl="spell" data-ctl-title={rank === 0 ? 'Cantrip' : `Rank ${rank} spell`} onClick={() => setPicker({ kind: 'spell', rank, cap: capHere })}>
                        + add
                      </button>
                    </div>
                    {/* The held place, said where the press lands (the whole-pool line above covers a full pool). */}
                    {full && floorHeld > 0 && poolSpent < flatAt(lvl) && (
                      <p className="lvl-note spr-why">
                        <i className="ti ti-info-circle" aria-hidden="true" />
                        <span>
                          Your collection must include at least one 1st-rank spell — the last of its {flatAt(lvl)}{' '}
                          places is held for one.
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
            {/* batch 037: flexible-spellcaster#capstone-outside-collection — the class's single
                10th-rank slot, its OWN control below the pool: *"Your class most likely has a class
                feature that gives you a single 10th level spell slot that works a bit differently from
                other slots. If so, flexible spellcaster doesn't change the way that spell works"*
                (archetype-99), and Table 5-1 prints Collection 18 at both 17th and 19th. Capped by that
                slot count, and spending it costs the collection nothing. */}
            {capstoneAt(lvl) > 0 &&
              (() => {
                const chosen = build.spells[10] ?? [];
                const capR = capstoneAt(lvl);
                const full = chosen.length >= capR;
                return (
                  <>
                    <div className="bsec-sub">10th rank — outside your spell collection</div>
                    <p className="setup-hint">
                      Your class&rsquo;s single 10th-rank spell slot works exactly as it always did — flexible
                      spellcaster doesn&rsquo;t change it, and the spell you pick for it is not one of the{' '}
                      {flatAt(lvl)} spells in your collection.
                    </p>
                    <div className="spell-pick-row">
                      <div className="spr-head">
                        <span>{ord(10)} rank</span>
                        <span className="spr-count">
                          {chosen.length} / {capR} chosen
                        </span>
                      </div>
                      <div className="spr-chips">
                        {chosen.map((id, idx) => (
                          <span className="spr-chip" key={id + ':' + idx}>
                            {content.spells[id]?.name ?? id}
                            <button type="button" className="spr-chip-x" aria-label={`Remove ${content.spells[id]?.name ?? id}`} onClick={() => actions.removeSpellAt(10, idx)}>
                              <i className="ti ti-x" aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                        <button className="spr-add" type="button" disabled={full} title={full ? `Your single 10th-rank slot already holds a spell — remove it first.` : undefined} data-ctl="spell" data-ctl-title="Rank 10 spell" onClick={() => setPicker({ kind: 'spell', rank: 10, cap: capR })}>
                          + add
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
          </>
        )}
        {/* What the ★ on a spell is, in words: it was only the star's hover tooltip, and a tap toggles it
            silently, so a phone player could not learn what it does. Shown while a star is on screen.
            test/phone-builder-shell.test.tsx. */}
        {!flatBudget && sigAvailable && g.ranks.some(({ rank }) => (build.spells[rank] ?? []).length > 0) && <SignatureHint />}
        {/* A dedication's book (ArchetypeBook): what each new rank adds, in the print's own terms — and
            that the slots are prepared OUT of it, on the sheet. */}
        {archBook && g.ranks.length > 0 && (
          <p className="setup-hint arch-book-hint">
            {archBookSentence(archBookRanksAt(lvl).find((r) => r.rank === g.ranks[0].rank))} Your spell slots are prepared from
            it — change them on the sheet (Spells tab).
          </p>
        )}
        {/* batch 037: flexible-spellcaster#collection-shape — per-rank caps only where the rule is
            per rank; a collection (like a spellbook) is drawn by the flat rail above. */}
        {!flatBudget &&
          g.ranks.map(({ rank, gained, cap: capR }) => {
            const chosen = build.spells[rank] ?? [];
            /* A book is a SET: a per-slot pick stored twice before the book (`[fear, fear]`) is one spell
             * in it, so the row counts — and gates the add on — distinct spells. */
            const held = archBook ? new Set(chosen).size : chosen.length;
            // "· 1st-rank spells" on a hedge mage's 2nd and 3rd ranks, "· 2nd rank or lower" on a magus's 2nd.
            const bookNote = archBook ? archetypeBookRankNote(archBookRanksAt(lvl).find((r) => r.rank === rank) ?? { rank, places: capR, minSpellRank: rank, maxSpellRank: rank }) : '';
            // The book's LAST row (at the character's level) also shows grants at ranks it has no row for.
            const lastBookRank = archBook ? Math.max(0, ...archBookRanksAt(build.level).map((r) => r.rank)) : 0;
            const grantEls = bookGrantEls(rank, chosen, lvl, archBook ? rank === lastBookRank : false);
            return (
              <div className="spell-pick-row" key={rank}>
                <div className="spr-head">
                  <span>
                    {ord(rank)} rank{bookNote ? ` · ${bookNote}` : ''}
                  </span>
                  <span className="spr-count">
                    {archBook
                      ? `${held} / ${capR} in your ${archBook.noun}`
                      : `${chosen.length} / ${capR} ${castType === 'prepared' ? 'prepared' : 'known'} (+${gained} this level)`}
                  </span>
                </div>
                <div className="spr-chips">
                  {giftChips(giftChipIds(castEntry1, rank, chosen), variantGiftCount(castEntry1, rank))}
                  {grantEls.chips}
                  {chosen.map((id, idx) => (
                    <span className="spr-chip" key={id + ':' + idx}>
                      {sigAvailable && (
                        <button
                          type="button"
                          className={'spr-chip-sig' + (signaturesAt(build.signatures, rank).includes(id) ? ' on' : '')}
                          aria-label={`Signature ${content.spells[id]?.name ?? id}`}
                          title="Signature spell (cast at any rank)"
                          onClick={() => actions.toggleSignature(rank, id)}
                        >
                          <i className="ti ti-star" aria-hidden="true" />
                        </button>
                      )}
                      {content.spells[id]?.name ?? id}
                      <button type="button" className="spr-chip-x" aria-label={`Remove ${content.spells[id]?.name ?? id}`} onClick={() => actions.removeSpellAt(rank, idx)}>
                        <i className="ti ti-x" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  <button className="spr-add" type="button" disabled={held >= capR} title={held >= capR ? (archBook ? `Your ${archBook.noun} holds the ${capR} spells this rank adds — remove one first.` : `All ${capR} spells at this rank are chosen — remove one first.`) : undefined} data-ctl="spell" data-ctl-title={rank === 0 ? 'Cantrip' : `Rank ${rank} spell`} data-ctl-options={capR} onClick={() => setPicker({ kind: 'spell', rank, cap: capR })}>
                    + add
                  </button>
                  {grantEls.notes}
                </div>
              </div>
            );
          })}
      </div>
    );
  };

  /**
   * Dual Class: the SECOND subclass's own follow-up — its `choice`, its `effectChoices` and a
   * FEAT_PICK_GRANTS bonus feat. Mounted on the Level 0 page right under the second-class card, where
   * the second subclass is picked (SetupUnlockedChoices); the first class's twin sits beside its own
   * subclass picker on the level page ("The CHOSEN subclass can ask a follow-up of its own").
   *
   * bug 2026-10-14 (lane A check): only `build.subclassId` was ever asked. buildCharacter reads all of
   * these answers for the second class too (`grantOptions` holds the second subclass, the `feature:<id>`
   * carrier walks both classes), so a Fighter/Barbarian's Rage read "energy" and an animal instinct had
   * no animal attack — with no control anywhere to fix it. 17 subclass options ask this way (barbarian
   * instincts, rogue rackets, wizard schools, palatine detective, vindicator, four eidolons). Same
   * storage keys as the first class's picker, so nothing new is written.
   */
  const renderSecondSubclassAsks = () => {
    const sid = cls2?.subclass ? build.subclassId2 : null;
    const rec = sid ? content.classFeatures[sid] : undefined;
    if (!sid || !rec) return null;
    const def = rec.choice && !askedAtDailyPrep(rec.choice) && !(rec.choice.minLevel != null && build.level < rec.choice.minLevel) ? rec.choice : undefined;
    const asksEffect = (rec.effectChoices ?? []).some((ch) => effectChoiceOffered(ch, build, content, sid));
    const spec = FEAT_PICK_GRANTS[sid];
    if (!def && !asksEffect && !spec) return null;
    const featOpts = spec ? pickableFeats(spec, build, content).map((o) => ({ value: o.id, label: o.name, description: o.description, record: { bucket: 'feats', id: o.id } })) : [];
    return (
      <SetupCard icon="ti-versions" label={`Dual Class — ${rec.name}`}>
        {def && renderChoice(def, `feature:${sid}`, sid)}
        <EffectChoicesPicker recordId={sid} choices={rec.effectChoices} build={build} actions={actions} content={content} />
        {spec &&
          pickKeysFor(sid, spec.picks).map((k, i) => (
            <PopupSelect
              key={k}
              title={pickPrompt(spec.prompt, i, spec.picks)}
              placeholder={`${pickPrompt(spec.prompt, i, spec.picks)}…`}
              value={build.pickFeatChoices?.[k] ?? ''}
              onChange={(v) => actions.patch({ pickFeatChoices: { ...(build.pickFeatChoices ?? {}), [k]: v } })}
              options={featOpts}
            />
          ))}
      </SetupCard>
    );
  };

  /** Dual Class: a consolidated card to pick the SECOND caster class's cantrips + spells (by rank, up to
   *  the current level's slot counts). Flat like the sheet's Manage flow — not per level. Renders only for
   *  a dual-class character whose second class is a slot caster. Writes cantrips2/spells2/signatures2. */
  const renderSecondClassSpells = () => {
    if (!showSpells2 || !cls2) return null;
    const cantrips2 = build.cantrips2 ?? [];
    const ranksWithSlots = Object.keys(slotCounts2)
      .map(Number)
      .filter((r) => r >= 1 && (slotCounts2[r] ?? 0) > 0)
      .sort((a, b) => a - b);
    return (
      <SetupCard icon="ti-sparkles" label={`${cls2.name} spells — ${cap(tradition2 ?? '')} ${castType2}`}>
        {cantripRowCap2 > 0 && (
          <div className="spell-pick-row">
            <div className="spr-head">
              {/* The first class's row, word for word (lane C1's shape): a book caster chooses its BOOK. */}
              <span>{bookWord2 ? bookCantripLabel(bookWord2) : 'Cantrips'}</span>
              <span className="spr-count">
                {cantrips2.length} / {cantripRowCap2}
              </span>
            </div>
            {bookWord2 && (
              <p className="setup-hint book-cantrip-hint">
                The first {cantripAllowance2} are prepared each morning by default — change them on the sheet (Spells tab).
              </p>
            )}
            <div className="spr-chips">
              {giftChips(giftChipIds(castEntry2, 0, cantrips2), variantGiftCount(castEntry2, 0))}
              {cantrips2.map((id) => (
                <span className="spr-chip" key={id}>
                  {content.spells[id]?.name ?? id}
                  <button type="button" className="spr-chip-x" aria-label={`Remove ${content.spells[id]?.name ?? id}`} onClick={() => actions.toggleCantrip2(id, cantripRowCap2)}>
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <button
                className="spr-add"
                type="button"
                disabled={cantrips2.length >= cantripRowCap2}
                title={
                  cantrips2.length >= cantripRowCap2
                    ? bookWord2
                      ? `Your ${bookWord2} holds all ${cantripRowCap2} cantrips it can — remove one first.`
                      : `All ${cantripRowCap2} cantrip slots are filled — remove one first.`
                    : undefined
                }
                data-ctl="spell"
                data-ctl-title="Cantrip (second class)"
                data-ctl-options={cantripRowCap2}
                onClick={() => setPicker({ kind: 'spell', rank: 0, cap: cantripRowCap2, caster: 2 })}
              >
                + add
              </button>
            </div>
          </div>
        )}
        {isWizardBook2 && (
          <div className="bsec-sub">
            {bookTitle(bookWord2)} — {learnedTotal2} / {spellbookSize2} learned
          </div>
        )}
        {sigAvailable2 && ranksWithSlots.some((r) => (build.spells2?.[r] ?? []).length > 0) && <SignatureHint />}
        {ranksWithSlots.map((rank) => {
          const chosen = build.spells2?.[rank] ?? [];
          // Less a sorcerer's gift spell (lane C2), exactly as the first class's row (`ownPlaces`).
          const gifts = giftChipIds(castEntry2, rank, chosen);
          const capR = isWizardBook2 ? spellbookSize2 : ownPlacesBeside(castEntry2, rank, slotCounts2[rank] ?? 0, chosen);
          const have = isWizardBook2 ? learnedTotal2 : chosen.length;
          return (
            <div className="spell-pick-row" key={rank}>
              <div className="spr-head">
                <span>{ord(rank)} rank</span>
                <span className="spr-count">
                  {isWizardBook2 ? `${chosen.length} learned` : `${chosen.length} / ${capR} ${isPrepared2 ? 'prepared' : 'known'}`}
                </span>
              </div>
              <div className="spr-chips">
                {giftChips(gifts, variantGiftCount(castEntry2, rank))}
                {chosen.map((id, idx) => (
                  <span className="spr-chip" key={id + ':' + idx}>
                    {sigAvailable2 && (
                      <button
                        type="button"
                        className={'spr-chip-sig' + (signaturesAt(build.signatures2, rank).includes(id) ? ' on' : '')}
                        aria-label={`Signature ${content.spells[id]?.name ?? id}`}
                        title="Signature spell (cast at any rank)"
                        onClick={() => actions.toggleSignature2(rank, id)}
                      >
                        <i className="ti ti-star" aria-hidden="true" />
                      </button>
                    )}
                    {content.spells[id]?.name ?? id}
                    <button type="button" className="spr-chip-x" aria-label={`Remove ${content.spells[id]?.name ?? id}`} onClick={() => actions.removeSpellAt2(rank, idx)}>
                      <i className="ti ti-x" aria-hidden="true" />
                    </button>
                  </span>
                ))}
                <button className="spr-add" type="button" disabled={have >= capR} title={have >= capR ? `All ${capR} spells at this rank are chosen — remove one first.` : undefined} data-ctl="spell" data-ctl-title={rank === 0 ? 'Cantrip (second class)' : `Rank ${rank} spell (second class)`} data-ctl-options={capR} onClick={() => setPicker({ kind: 'spell', rank, cap: capR, caster: 2 })}>
                  + add
                </button>
              </div>
            </div>
          );
        })}
        <p className="setup-hint">Your second spellcasting class uses its own tradition, pool, and DC. Cast these from the sheet's Spells tab.</p>
      </SetupCard>
    );
  };

  // The class feature at `lvl` that anchors the subclass choice (Doctrine / Bloodline / …),
  // if the subclass is granted at this level — shared by the pending count and the render.
  // Shared with levelChoices, so the level that RENDERS the subclass picker is always the level
  // counted as owing it.
  const subclassAnchorId = (lvl: number): string | null => subclassAnchorAt(build, content, lvl);

  /*
   * Everything still unchosen, anywhere in the build — the single list the chip markers, the page
   * header tag and the Create/Save confirmation all read from. They used to run off two different
   * partial functions that disagreed with each other.
   */
  const missing = useMemo(() => levelChoices(build, content), [build, content]);
  const pendingCount = (lvl: number) => missing.filter((m) => m.page === lvl).length;
  const requiredUnmet = (lvl: number) => pendingCount(lvl) > 0;
  const setupMissingList = useMemo(() => missing.filter((m) => m.page === 0).map((m) => m.label), [missing]);

  const submit = async () => {
    // Under-built characters are allowed (never hard-block), but confirm what's missing first — and
    // list EVERY page, not just the origin one. This dialog used to read `setupMissingList` alone, so
    // a level-12 character with nine empty feat slots saved without a word.
    if (missing.length > 0) {
      const shown = missing.slice(0, 12);
      const ok = await confirmDialog({
        title: initial ? 'Save with choices left?' : 'Create with choices left?',
        message: (
          <>
            <p>
              {missing.length === 1 ? 'One choice has' : `${missing.length} choices have`} not been made yet:
            </p>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              {shown.map((m) => (
                <li key={`${m.page}:${m.label}`}>{m.label}</li>
              ))}
            </ul>
            {missing.length > shown.length && (
              <p style={{ marginTop: 6 }}>…and {missing.length - shown.length} more.</p>
            )}
          </>
        ),
        confirmLabel: initial ? 'Save anyway' : 'Create anyway',
        cancelLabel: 'Keep editing',
      });
      if (!ok) return;
    }
    onCreate(build);
  };

  const nextRank = (cur: ProficiencyRank, lvl: number): ProficiencyRank => {
    const ni = Math.min(PROFICIENCY_RANKS.indexOf(cur) + 1, PROFICIENCY_RANKS.indexOf(skillIncreaseCap(lvl)));
    return PROFICIENCY_RANKS[Math.max(ni, PROFICIENCY_RANKS.indexOf(cur))];
  };
  // The rank one step above `cur` (expert→master→legendary), ignoring the level cap — used for the
  // skill-increase label so a not-yet-allowed bump still reads "E → M" (greyed) rather than "E — max".
  const naturalNextRank = (cur: ProficiencyRank): ProficiencyRank =>
    PROFICIENCY_RANKS[Math.min(PROFICIENCY_RANKS.indexOf(cur) + 1, PROFICIENCY_RANKS.length - 1)];

  return (
    <PinContext.Provider value={pinApi}>
    <div className="builder">
      {/* The builder is the one full screen with no `.chrome` bar, so on the desktop app — which draws
          its own title bar — it was the one screen you could neither drag, minimise, maximise nor close
          from. Its own header takes that job. */}
      <header className="builder-head" data-tauri-drag-region>
        <div className="builder-title">
          <i className="ti ti-layout-grid" aria-hidden="true" />
          {initial ? 'Edit character' : 'Create character'}
        </div>
        <input
          className="name-input"
          value={build.name}
          onChange={(e) => actions.patch({ name: e.target.value })}
          placeholder="Character name"
          aria-label="Character name"
        />
        <div className="lvl-ctl">
          <span className="lvl-ctl-label">Level</span>
          <button
            className="lvl-step"
            onClick={async () => {
              // Lowering drops the current top level. Confirm if any choice (feat, skill, boost, or
              // chosen spells of a rank/cantrip gained there) was made there.
              if (!(hasChoicesAtLevel(build, build.level) || spellsDropAt(build.level))) {
                actions.bumpLevel(-1);
                return;
              }
              /* The shared confirm, not a box of our own: the hand-built one never went on the dismiss
               * stack, so Back and Escape could not close it — and the swallowed Back made the NEXT one
               * leave the app with the build. test/phone-builder-shell.test.tsx. */
              const to = build.level - 1;
              const ok = await confirmDialog({
                title: 'Lower level?',
                message: (
                  <>
                    <p>
                      You&apos;ve made choices at <strong>level {to + 1}</strong> (a feat, skill increase,
                      attribute boost, or chosen spells). Lowering to <strong>level {to}</strong> stops applying them.
                    </p>
                    <p>They&apos;re kept and will reapply if you raise the level again.</p>
                  </>
                ),
                confirmLabel: `Lower to level ${to}`,
              });
              if (ok) actions.setLevel(to);
            }}
            disabled={build.level <= 1}
            aria-label="Lower level"
          >
            −
          </button>
          <span className="lvl-ctl-val">{build.level}</span>
          <button className="lvl-step" onClick={() => actions.bumpLevel(1)} disabled={build.level >= 20} aria-label="Raise level">
            +
          </button>
        </div>
        {/* In the bar rather than the floating app-wide pill: that one is fixed to a screen corner,
            and this header already has both corners spoken for (the window buttons on the desktop
            app, Save changes beside them). Before Cancel, so the two commit buttons stay together. */}
        {showUndoButtons && (
          <div className="b-undo" role="group" aria-label="Undo and redo">
            <button
              type="button"
              className="icon-btn"
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              disabled={!canUndoBuild}
              onClick={undoBuild}
            >
              <i className="ti ti-arrow-back-up" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
              disabled={!canRedoBuild}
              onClick={redoBuild}
            >
              <i className="ti ti-arrow-forward-up" aria-hidden="true" />
            </button>
          </div>
        )}
        <button className="b-cancel" onClick={() => void requestLeave()}>
          Cancel
        </button>
        <button className="b-create" onClick={() => void submit()}>
          {initial ? 'Save changes' : 'Create'}
        </button>
        <WindowControls />
      </header>

      <div className="lstrip" ref={stripRef}>
        {strip.map((s) => {
          const pending =
            (typeof s === 'number' && s >= 1 && s <= build.level && requiredUnmet(s)) ||
            (s === 0 && setupMissingList.length > 0);
          const on = s === sel;
          return (
            <button
              key={String(s)}
              ref={on ? selChipRef : undefined}
              className={'lchip' + (on ? ' on' : '') + (pending ? ' pending' : '')}
              aria-current={on ? 'page' : undefined}
              onClick={() => setSel(s)}
            >
              {s === 'setup' ? 'Setup' : s}
            </button>
          );
        })}
      </div>

      <div className="builder-body" ref={bodyRef}>
        <div className="bmain">
          {sel === 'setup' && (
            <div className="card-sec">
              <div className="bsec-title">Setup</div>
              <div className="setup-note">Campaign options — optional variant rules for this character.</div>
              <div className="lvl-cards">
                {/* SOURCES FIRST (owner, 2026-09-22) — the order lives in RuleCards, which the
                    campaign defaults editor renders too. */}
                <RuleCards build={build} actions={actions} content={content} sourcesContent={ovContent} catalog={sourceCat}>
                  <CampaignAttachCard build={build} actions={actions} content={content} onLeaveCampaign={onLeaveCampaign} />
                  <OptionsCard build={build} actions={actions} content={content} />
                </RuleCards>
                {build.options?.overridesEnabled && (
                  <OverridesCard build={build} actions={actions} content={ovContent} character={featPrereqChar} />
                )}
                {hasSnareCrafting(featPrereqChar.feats.map((f) => f.featId)) && (
                  <SnareFormulasCard build={build} actions={actions} content={ovContent} character={featPrereqChar} />
                )}
                {formulaSlots(featPrereqChar, ovContent).length > 0 && (
                  <FormulaBookCard build={build} actions={actions} content={ovContent} character={featPrereqChar} />
                )}
              </div>
            </div>
          )}

          {sel === 0 && (
            <>
              <div className="card-sec lvl-page">
                <div className="lvl-page-head">
                  <span className="bsec-title">Level 0</span>
                  <span className="lvl-sub-tag">character creation</span>
                  {/* Just the count — identical markup to the level pages', so the two headers are the
                      same height and the same shape. WHICH choices are missing is answered by the
                      Create/Save confirmation, which lists every one of them across every page. */}
                  {setupMissingList.length > 0 ? (
                    <span className="lvl-pending-tag">
                      <i className="ti ti-alert-circle" aria-hidden="true" /> {setupMissingList.length}{' '}
                      {setupMissingList.length === 1 ? 'choice' : 'choices'} left
                    </span>
                  ) : (
                    <span className="lvl-done-tag">
                      <i className="ti ti-check" aria-hidden="true" /> all set
                    </span>
                  )}
                </div>
                <div className="lvl-group">
                  <div className="lvl-group-h">
                    <i className="ti ti-id-badge-2" aria-hidden="true" /> Identity
                  </div>
                  <div className="lvl-cards">
                    <OriginPickers build={build} actions={actions} content={content} />
                  </div>
                </div>
                <div className="lvl-group">
                  <div className="lvl-group-h">
                    <i className="ti ti-hexagon" aria-hidden="true" /> Attributes
                  </div>
                  <div className="lvl-cards">
                    <AttributeEditor build={build} actions={actions} content={content} />
                  </div>
                </div>
                <div className="lvl-group">
                  <div className="lvl-group-h">
                    <i className="ti ti-bulb" aria-hidden="true" /> Skills &amp; languages
                  </div>
                  <div className="lvl-cards">
                    <SkillEditor build={build} actions={actions} content={content} character={featPrereqChar} />
                    <LanguageEditor build={build} actions={actions} content={content} character={featPrereqChar} />
                  </div>
                </div>
                {/* Per-character selections unlocked by a Setup toggle (Dual Class second class, ABP
                    skill potency / apex, Mythic Calling). The on/off toggles stay on the Setup page. */}
                {(build.variantRules?.dualClass || build.variantRules?.abp || build.mythicEnabled) && (
                  <div className="lvl-group">
                    <div className="lvl-group-h">
                      <i className="ti ti-adjustments-alt" aria-hidden="true" /> Variant &amp; campaign choices
                    </div>
                    <div className="lvl-cards">
                      <SetupUnlockedChoices build={build} actions={actions} content={content} callingRows={callingRows} />
                      {renderSecondSubclassAsks()}
                      {renderSecondClassSpells()}
                    </div>
                  </div>
                )}
              </div>

              {/* Equipment isn't chosen in the builder — starting gear and purchases are managed
                  in play on the sheet's Inventory tab. Any imported inventory is preserved. */}

              {/* No free-form companion add at level 0 — companions come from a feat or class.
                  Any companion already on the build (imported/granted) stays editable here. */}
              {build.companions.length > 0 && (
              <div className="card-sec">
                <div className="bsec-title">Companions</div>
                {build.companions.map((c) => (
                  <div className="cmp-row" key={c.id}>
                    <div className="cmp-row-head">
                      <i className={'ti ' + (c.kind === 'animal' ? 'ti-paw' : 'ti-feather')} aria-hidden="true" />
                      <input
                        className="cmp-name"
                        placeholder={c.kind === 'animal' ? 'Companion name' : 'Familiar name'}
                        value={c.name}
                        onChange={(e) => actions.setCompanion(c.id, { name: e.target.value })}
                      />
                      <span className="cmp-kind">{c.kind}</span>
                      <button
                        className="inv-remove"
                        type="button"
                        aria-label="Remove companion"
                        onClick={() => actions.removeCompanion(c.id)}
                      >
                        <i className="ti ti-x" aria-hidden="true" />
                      </button>
                    </div>
                    {c.kind === 'animal' ? (
                      <div className="cmp-controls">
                        <PopupSelect
                          title="Companion type"
                          placeholder={Object.values(content.animalCompanions).length === 0 ? 'No types loaded' : 'Choose…'}
                          value={c.typeId ?? ''}
                          onChange={(v) => actions.setCompanion(c.id, { typeId: v })}
                          options={Object.values(content.animalCompanions).map((t) => ({ value: t.id, label: t.name }))}
                        />
                        <PopupSelect
                          title="Maturity"
                          value={c.maturity ?? 'young'}
                          onChange={(v) => actions.setCompanion(c.id, { maturity: v })}
                          options={['young', 'mature', 'nimble', 'savage', 'specialized'].map((m) => ({ value: m, label: cap(m) }))}
                        />
                      </div>
                    ) : (
                      <div className="spr-chips">
                        {(c.abilities ?? []).map((aid) => (
                          <span className="spr-chip" key={aid}>
                            {content.familiarAbilities[aid]?.name ?? aid}
                            <button
                              type="button"
                              className="spr-chip-x"
                              aria-label="Remove ability"
                              onClick={() =>
                                actions.setCompanion(c.id, { abilities: (c.abilities ?? []).filter((x) => x !== aid) })
                              }
                            >
                              <i className="ti ti-x" aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                        <button
                          className="spr-add"
                          type="button"
                          onClick={() => setPicker({ kind: 'familiar-ability', companionId: c.id })}
                        >
                          + ability
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              )}
            </>
          )}

          {typeof sel === 'number' &&
            sel >= 1 &&
            (() => {
              const lvl = sel;
              if (baseSkills == null) return null; // unreachable (sel is a valid level here) — narrows the memo
              // No `future` state any more: the strip only lists levels 1..build.level, and the clamp
              // above keeps `sel` inside that range, so a page above the character's level cannot be
              // open. The greyed-out "future level" page and its "Advance to level N" link went with it.
              const pending = pendingCount(lvl);
              // `build` last: the level list is archetype-aware only when the resolver can see the
              // dedication that carries the class archetype (War Mage: no Arcane Bond row, a War Magic one).
              const g = levelGrants(lvl, build.classId, content, build.subclassId, build.variantRules, build.classId2, build.subclassId2, build.mythicEnabled, Object.values(build.featPicks ?? {}).filter(Boolean) as string[], build);
              /* Picks at this level under a key no slot above draws — a pick v0.1.40 stranded, a slot a
                 change took away, any key the slot list does not produce. The sheet still grants every
                 one, so each is listed here to be moved or removed by the player. Derived on every
                 render; nothing is written when a character opens. */
              const drawnKeys = new Set(g.featSlots.map((cat, i) => slotKey(lvl, cat, i)));
              const noSlot = Object.entries(build.featPicks).filter(([k, v]) => !!v && Number(k.split(':')[0]) === lvl && !drawnKeys.has(k));
              const bg = resolveBackground(build, content);
              const bgFeatAtThisLevel = lvl === 1 && bg?.grantedFeatId;
              const anyContent =
                g.features.length || g.featSlots.length || g.skillIncrease || g.attributeBoosts || bgFeatAtThisLevel || hasSpellGains(lvl);

              // Ranks before this level's increase (memoized above as baseSkills; non-null here since
              // this IIFE only renders when sel is a valid level).
              const chosenIncrease = build.skillIncreases[lvl];
              const loreKeys = Object.keys(baseSkills).filter((k) => k.startsWith('lore:')) as ProficiencyKey[];
              // A Lore trained by THIS level's increase isn't in baseSkills yet — keep it selectable.
              if (chosenIncrease?.startsWith('lore:') && !loreKeys.includes(chosenIncrease)) loreKeys.push(chosenIncrease);
              const skillOptions: ProficiencyKey[] = [...SKILLS, ...loreKeys];

              // The subclass (Doctrine / Bloodline / Arcane School / …) is granted as a class
              // feature at this level but is really the player's choice — render it as the
              // subclass picker (in the Feats group) rather than an "auto" gain.
              const cls = build.classId ? content.classes[build.classId] : undefined;
              const subAnchorId = subclassAnchorId(lvl);

              /*
               * Which granted features ask the player a question.
               *
               * A class feature can carry a `choice` ("choose a damage type"), `effectChoices`, or a
               * FEAT_PICK_GRANTS bonus feat; a granted background feat can carry its own sub-choice
               * (Abadar's Avenger: "Assurance with Religion"). All four used to render INSIDE the
               * "You gain automatically" zone — the one heading that means "nothing to do here" sat
               * directly on top of things the player had to answer, which is also exactly the
               * auto-versus-chosen split the "Details button only on automatic grants" rule leans on.
               *
               * Tested against the DATA, not against the rendered node: a picker component can
               * legitimately render nothing, and a feature that asks nothing must not get a heading.
               */
              const featureAsks = (fid: string): boolean => {
                const rec = content.classFeatures[fid];
                return !!(rec?.choice && !askedAtDailyPrep(rec.choice)) || !!rec?.effectChoices?.length || !!FEAT_PICK_GRANTS[fid];
              };
              const askingFeatures = g.features.filter((f) => f.id !== subAnchorId && featureAsks(f.id));
              const askingGrantedFeats = bgFeatAtThisLevel
                ? backgroundGrantedFeats(bg, build.backgroundSkillChoice).filter((gid) => !!content.feats[gid]?.choice)
                : [];
              /* The BACKGROUND-granted Additional Lore lane. Seven backgrounds print "You gain the
               * Additional Lore skill feat" with the subject left to the player, and the subject box
               * mounted only under a slot-PICKED or feat-GRANTED taking (Builder's `f.grantedBy`
               * filter) — a background grant has neither, so the feat sat on the sheet with nowhere
               * to type its Lore. Returned's is bound (Boneyard) and asks nothing. Writes the bare
               * `<featId>:<idx>` key, which build.ts's loreChoices lane already reads. */
              const loreAskingGrantedFeats = bgFeatAtThisLevel
                ? backgroundGrantedFeats(bg, build.backgroundSkillChoice).filter(
                    (gid) => (FEAT_GRANTS[gid]?.loreChoices ?? 0) > 0 && !isBoundBackgroundGrant(bg?.id, gid),
                  )
                : [];

              return (
                <>
                <div className="card-sec lvl-page">
                  <div className="lvl-page-head">
                    <span className="bsec-title">Level {lvl}</span>
                    {pending > 0 ? (
                      <span className="lvl-pending-tag">
                        <i className="ti ti-alert-circle" aria-hidden="true" /> {pending} {pending === 1 ? 'choice' : 'choices'} left
                      </span>
                    ) : anyContent ? (
                      <span className="lvl-done-tag">
                        <i className="ti ti-check" aria-hidden="true" /> all set
                      </span>
                    ) : null}
                  </div>

                  {(g.features.some((f) => f.id !== subAnchorId) || bgFeatAtThisLevel) && (
                    <div className="lvl-zone">
                      <div className="lvl-zone-h">
                        <i className="ti ti-gift" aria-hidden="true" /> You gain automatically
                      </div>
                      <div className="lvl-gains">
                        {g.features
                          .filter((f) => f.id !== subAnchorId)
                          .map((f) => (
                            <div className="lvl-gain-block" key={f.id}>
                              <div className="lvl-gain">
                                <i className="ti ti-award lvl-gain-ic" aria-hidden="true" />
                                <span className="lvl-gain-name">{f.name}</span>
                                <span className="lvl-gain-tag">auto</span>
                              </div>
                              <ChoiceDetails
                                name={f.name}
                                flavor={classFeatureDescription(content.classFeatures[f.id]?.description, build.classId, content)}
                                descRefs={content.classFeatures[f.id]?.descRefs}
                                bucket="classFeatures"
                                id={f.id}
                                // Card step 15: the 'mine' card, scoped to the build at its current level.
                                character={featPrereqChar}
                              />
                              {/* The question it asks lives in the choice zone below — see
                                  `askingFeatures`. This says where it went. */}
                              {featureAsks(f.id) && <div className="lvl-gain-asks">Asks you to choose — see below</div>}
                            </div>
                          ))}
                        {/* Level-gated proficiency upgrades from feats taken EARLIER (Brilliant Crafter:
                            master Crafting at 7th) — surfaced on the level where the step lands so the
                            player sees they gained it rather than a number silently changing. */}
                        {featUpgradesAtLevel(featPrereqChar.feats.map((f) => f.featId), lvl).map((u) => (
                          <div className="lvl-gain-block" key={`up-${u.featId}-${lvl}`}>
                            <div className="lvl-gain">
                              <i className="ti ti-trending-up lvl-gain-ic" aria-hidden="true" />
                              <span className="lvl-gain-name">
                                {content.feats[u.featId]?.name ?? u.featId} — becomes {cap(u.rank)}
                              </span>
                              <span className="lvl-gain-tag">upgrade</span>
                            </div>
                          </div>
                        ))}
                        {bgFeatAtThisLevel &&
                          // Eagle Hunter and Returned grant TWO feats — render every one, not the first.
                          backgroundGrantedFeats(bg, build.backgroundSkillChoice).map((gid) => {
                            const ft = content.feats[gid];
                            const nm = ft?.name ?? gid;
                            return (
                              <div className="lvl-gain-block" key={gid}>
                                <div className="lvl-gain">
                                  <i className="ti ti-star lvl-gain-ic" aria-hidden="true" />
                                  <span className="lvl-gain-name">{nm}</span>
                                  <span className="lvl-gain-tag">skill feat · granted</span>
                                </div>
                                <ChoiceDetails name={nm} flavor={ft?.description} descRefs={ft?.descRefs} bucket="feats" id={gid} character={featPrereqChar} />
                                {/* Its own sub-choice is asked in the choice zone below, not here —
                                    UNLESS the background already answered it. Abadar's Avenger grants
                                    "Assurance with Religion", so promising a choice it does not offer
                                    would send the player looking for a control that is not there. */}
                                {!!ft?.choice && (
                                  <div className="lvl-gain-asks">
                                    {isBoundBackgroundGrant(bg?.id, gid)
                                      ? `${bg!.name} names it — nothing to choose`
                                      : 'Asks you to choose — see below'}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  <fieldset className="lvl-choice-zone">
                    {/* The questions asked by what you were GRANTED. They sit here, in the zone the
                        player scans for things to answer, rather than under "You gain automatically" —
                        each one labelled with the feature that asked it, so it is still obvious where
                        it came from. */}
                    {(askingFeatures.length > 0 || askingGrantedFeats.length > 0 || loreAskingGrantedFeats.length > 0) && (
                      <div className="lvl-group">
                        <div className="lvl-group-h">
                          <i className="ti ti-help-circle" aria-hidden="true" /> Choices from what you gained
                        </div>
                        <div className="lvl-cards">
                          {askingFeatures.map((f) => (
                            <SubCard icon="ti-award" label={f.name} key={`ask-${f.id}`}>
                              {(() => {
                                const def = content.classFeatures[f.id]?.choice;
                                return def && !askedAtDailyPrep(def) ? renderChoice(def, `feature:${f.id}`, f.id) : null;
                              })()}
                              <EffectChoicesPicker
                                recordId={f.id}
                                choices={content.classFeatures[f.id]?.effectChoices}
                                build={build}
                                actions={actions}
                                content={content}
                              />
                              {/* Fury instinct's "bonus 1st-level barbarian feat", the summoner's
                                  evolution feat — a granted feature that hands you a feat to pick. */}
                              {FEAT_PICK_GRANTS[f.id] && (() => {
                                const spec = FEAT_PICK_GRANTS[f.id];
                                const opts = pickableFeats(spec, build, content).map((o) => ({ value: o.id, label: o.name, description: o.description, record: { bucket: 'feats', id: o.id } }));
                                /* A spec may grant SEVERAL feats (*"choose up to two…"*). Answers past
                                 * the first are keyed `<id>#<i>`, so index 0 keeps the bare key and no
                                 * saved character loses its pick. See FeatPickSpec.picks. */
                                return pickKeysFor(f.id, spec.picks).map((key, i) => (
                                  <PopupSelect
                                    key={key}
                                    title={pickPrompt(spec.prompt, i, spec.picks)}
                                    placeholder={`${pickPrompt(spec.prompt, i, spec.picks)}…`}
                                    value={build.pickFeatChoices?.[key] ?? ''}
                                    onChange={(v) => actions.patch({ pickFeatChoices: { ...(build.pickFeatChoices ?? {}), [key]: v } })}
                                    options={opts}
                                  />
                                ));
                              })()}
                            </SubCard>
                          ))}
                          {askingGrantedFeats.map((gid) => (
                            <SubCard icon="ti-star" label={content.feats[gid]?.name ?? gid} key={`askf-${gid}`}>
                              {grantedChoicePicker(gid)}
                            </SubCard>
                          ))}
                          {loreAskingGrantedFeats.flatMap((gid) =>
                            Array.from({ length: FEAT_GRANTS[gid]!.loreChoices! }).map((_, li) => {
                              const key = `${gid}:${li}`;
                              return (
                                <SubCard icon="ti-bulb" label={`Trained Lore (from ${content.feats[gid]?.name ?? gid})`} key={`bglore-${key}`}>
                                  <input
                                    className="lvl-lore-input"
                                    placeholder="Lore subject (e.g. Warfare)…"
                                    value={build.featLoreChoices?.[key] ?? ''}
                                    onChange={(e) => actions.patch({ featLoreChoices: { ...(build.featLoreChoices ?? {}), [key]: e.target.value } })}
                                  />
                                </SubCard>
                              );
                            }),
                          )}
                        </div>
                      </div>
                    )}
                    {(!!(cls?.subclass && subAnchorId) || g.featSlots.length > 0 || noSlot.length > 0) && (
                      <div className="lvl-group">
                        <div className="lvl-group-h">
                          <i className="ti ti-award" aria-hidden="true" /> Feats
                        </div>
                        <div className="lvl-cards">
                          {cls?.subclass && subAnchorId && (
                            <div className={'lvl-card lvl-choice' + (build.subclassId ? '' : ' empty')}>
                              <span className="lvl-card-icon">
                                <i className="ti ti-versions" aria-hidden="true" />
                              </span>
                              <div className="lvl-card-text">
                                <div className="lvl-card-label">{cls.subclass.name}</div>
                                <PopupSelect
                                  className="lvl-subsel"
                                  title={cls.subclass.name}
                                  placeholder="Choose…"
                                  value={build.subclassId ?? ''}
                                  /* bug 2026-09-13: change-subclass-deity-confirm — the SECOND
                                     subclass picker (the level page's card). Same helper as the
                                     Setup one in shared.tsx, so both ask before dropping spells. */
                                  onChange={(v) => requestSubclassChange(v, build, content, actions)}
                                  options={cls.subclass.options.map((o) => ({ value: o.id, label: o.name, description: o.description, descRefs: o.descRefs, record: { bucket: 'classFeatures', id: o.id } }))}
                                />
                              </div>
                              {!build.subclassId && <span className="lvl-pending">!</span>}
                            </div>
                          )}
                          {/* (No Details button for the picked subclass — pressing the value in the
                              picker above opens its description; see PopupSelect's filled state.) */}
                          {/* The CHOSEN subclass can ask a follow-up of its own — the barbarian's
                              Dragon Instinct asks which dragon, Giant Instinct which energy. Those
                              records ship as a classFeature under the same slug and their choice
                              rendered nowhere, so the answer Raging Resistance depends on could not
                              be given at all. Stored under the same `feature:<id>` key as any other
                              class-feature choice. */}
                          {cls?.subclass &&
                            subAnchorId &&
                            build.subclassId &&
                            (() => {
                              const def = content.classFeatures[build.subclassId!]?.choice;
                              return def && !askedAtDailyPrep(def) ? renderChoice(def, `feature:${build.subclassId}`, build.subclassId!) : null;
                            })()}
                          {/* …and its effectChoices, for the same reason. build.ts resolves these
                              (resolvePick over grantOptions) and the picker was mounted only for
                              features in `cls.features`, so the mastermind's, the runelord's and the
                              palatine detective's picks were resolved from an answer nobody gave. */}
                          {cls?.subclass && subAnchorId && build.subclassId && (
                            <EffectChoicesPicker
                              recordId={build.subclassId}
                              choices={content.classFeatures[build.subclassId]?.effectChoices}
                              build={build}
                              actions={actions}
                              content={content}
                            />
                          )}
                          {/* A SUBCLASS can carry a feat pick too — Fury instinct's "bonus 1st-level
                              barbarian feat". Mounted here beside its own effectChoices picker, since
                              the subclass is not in `cls.features` and the feature loop never sees it. */}
                          {cls?.subclass && subAnchorId && build.subclassId && FEAT_PICK_GRANTS[build.subclassId] && (() => {
                            const sid = build.subclassId!;
                            const spec = FEAT_PICK_GRANTS[sid];
                            const opts = pickableFeats(spec, build, content).map((o) => ({ value: o.id, label: o.name, description: o.description, record: { bucket: 'feats', id: o.id } }));
                            return (
                              <SubCard icon="ti-medal" label={spec.prompt}>
                                {pickKeysFor(sid, spec.picks).map((k, i) => (
                                  <PopupSelect
                                    key={k}
                                    title={pickPrompt(spec.prompt, i, spec.picks)}
                                    placeholder={`${pickPrompt(spec.prompt, i, spec.picks)}…`}
                                    value={build.pickFeatChoices?.[k] ?? ''}
                                    onChange={(v) => actions.patch({ pickFeatChoices: { ...(build.pickFeatChoices ?? {}), [k]: v } })}
                                    options={opts}
                                  />
                                ))}
                              </SubCard>
                            );
                          })()}
                          {/* EVERY granted feat's own sub-choice, wherever the grant came from.
                              build.ts grants feats from six lanes (a feat's pick, a heritage, a
                              subclass/extra-choice option, a class feature, an item, a background)
                              and every one reads `grantedFeatChoices` — but the picker was mounted
                              from only two of them, so the rest resolved an answer nobody could give.
                              Driven off the BUILT character rather than per-lane, so a seventh lane
                              cannot silently miss it. Rendered at level 0 so it has one home. */}
                          {/* Anchored to the subclass level — or to level 1 for the eight classes with no
                              subclass, which otherwise never rendered these (Devil Allies via Order Training on a
                              fighter asked its Tradition nowhere; experience gate, 2026-09-02). */}
                          {(subAnchorId || (!cls?.subclass && lvl === 1)) &&
                            (() => {
                              // The two lanes that already mount their own picker under the granting
                              // row: a slot-picked feat's grants, and the background's. Everything
                              // else — heritage, subclass/extra-choice option, class feature, item,
                              // and any transitive grant — had none.
                              const slotPicked = new Set(Object.values(build.featPicks).filter(Boolean));
                              const handled = new Set<string>([
                                ...[...slotPicked].flatMap((id) => FEAT_FEAT_GRANTS[id as string] ?? []),
                                ...backgroundGrantedFeats(bg, build.backgroundSkillChoice),
                              ]);
                              /* Deduped by (feat, VARIANT), not by feat id: a granter that owes two
                                 takings of one feat — Anvil Dwarf's two Specialty Crafting
                                 specialties — got one picker and so one specialty. Same reason the
                                 Lore lane below iterates rows. */
                              const seenKeys = new Set<string>();
                              return featPrereqChar.feats
                                .filter((f) => f.grantedBy && !handled.has(f.featId) && content.feats[f.featId]?.choice)
                                .filter((f) => {
                                  const k = grantedChoiceKey(f.featId, f.grantVariant);
                                  if (seenKeys.has(k)) return false;
                                  seenKeys.add(k);
                                  return true;
                                })
                                .map((f) => grantedChoicePicker(f.featId, f.grantVariant));
                            })()}
                          {/* …and the same lane's "trained in a Lore of your choice".
                              A GRANTED feat has no slot, and the Lore input was mounted only under a
                              slot-PICKED feat — so every unbound granted Additional Lore (a sage
                              jotunborn's, a Settlement Scholastics take, Surface Culture's) arrived on
                              the sheet with a subject the player had nowhere to type. Iterated over the
                              feat ROWS, not the ids: one granter can owe two takings and each needs its
                              own answer. A grant whose Lore the granter NAMED asks nothing. */}
                          {subAnchorId &&
                            featPrereqChar.feats
                              .filter((f) => f.grantedBy && !f.slotKey && (FEAT_GRANTS[f.featId]?.loreChoices ?? 0) > 0)
                              .filter((f) => f.grantVariant || !isBoundGrant(f.grantedBy!, f.featId))
                              .flatMap((f) =>
                                Array.from({ length: FEAT_GRANTS[f.featId]!.loreChoices! }).map((_, li) => {
                                  const gKey = `${f.grantedBy}${f.grantVariant ? `#${f.grantVariant}` : ''}:${f.featId}:${li}`;
                                  // The bare key is still READ by build.ts, so a character saved before
                                  // this keeps its subject; the first edit moves it to the granter key.
                                  const legacy = `${f.featId}:${li}`;
                                  const from = content.feats[f.grantedBy!]?.name ?? content.heritages[f.grantedBy!]?.name ?? f.grantedBy;
                                  return (
                                    <SubCard key={`glore-${gKey}`} icon="ti-bulb" label={`Trained Lore (from ${from})`}>
                                      <input
                                        className="lvl-lore-input"
                                        placeholder="Lore subject (e.g. Warfare)…"
                                        value={build.featLoreChoices?.[gKey] ?? build.featLoreChoices?.[legacy] ?? ''}
                                        onChange={(e) => actions.patch({ featLoreChoices: { ...(build.featLoreChoices ?? {}), [gKey]: e.target.value } })}
                                      />
                                    </SubCard>
                                  );
                                }),
                              )}
                          {/* …and the SAME lane's `effectChoices`. This block filtered on `choice`
                              alone, so a granted feat asking its second question through
                              `effectChoices` had no control at all — Advanced Weaponry, which a
                              summoner takes through the Evolution Feat grant rather than a feat slot,
                              rendered its trait picker and not "which unarmed attack". Measured in the
                              browser: the card appeared with one question, and the answer the eidolon
                              needs could not be given. Same shape as the comment above — a lane that
                              mounts one picker and not the other. */}
                          {/* Anchored to the subclass level — or to level 1 for the eight classes with no
                              subclass, which otherwise never rendered these (Devil Allies via Order Training on a
                              fighter asked its Tradition nowhere; experience gate, 2026-09-02). */}
                          {(subAnchorId || (!cls?.subclass && lvl === 1)) &&
                            (() => {
                              const slotPicked = new Set(Object.values(build.featPicks).filter(Boolean));
                              return [...new Set(featPrereqChar.feats.filter((f) => f.grantedBy).map((f) => f.featId))]
                                .filter((gid) => !slotPicked.has(gid) && content.feats[gid]?.effectChoices?.length)
                                .map((gid) => (
                                  <EffectChoicesPicker
                                    key={`gec-${gid}`}
                                    recordId={gid}
                                    choices={content.feats[gid]!.effectChoices}
                                    build={build}
                                    actions={actions}
                                    content={content}
                                  />
                                ));
                            })()}
                          {/* Extra-choice picks (kineticist gates, thaumaturge implements, animist
                              apparitions…) carry them too — the four elemental gates ask which
                              damage type, and nothing asked. */}
                          {subAnchorId &&
                            Object.values(build.extraChoices ?? {})
                              .flat()
                              .filter((oid) => content.classFeatures[oid]?.effectChoices?.length)
                              .map((oid) => (
                                <EffectChoicesPicker
                                  key={`ec-${oid}`}
                                  recordId={oid}
                                  choices={content.classFeatures[oid]!.effectChoices}
                                  build={build}
                                  actions={actions}
                                  content={content}
                                />
                              ))}
                          {/* batch 036: advanced-weaponry-construct — the inventor's INNOVATION
                              MODIFICATIONS carry them too, and were in neither loop above: they are
                              stored on `build.inventorModifications`, not in `extraChoices`. Advanced
                              Weaponry prints *"Choose one of your construct's unarmed attacks to gain
                              your choice of one initial weapon modification"*, and the answer had
                              nowhere on screen to be given. */}
                          {subAnchorId &&
                            Object.values(build.inventorModifications ?? {})
                              .filter((mid): mid is string => !!mid && !!content.classFeatures[mid]?.effectChoices?.length)
                              .map((mid) => (
                                <EffectChoicesPicker
                                  key={`imec-${mid}`}
                                  recordId={mid}
                                  choices={content.classFeatures[mid]!.effectChoices}
                                  build={build}
                                  actions={actions}
                                  content={content}
                                />
                              ))}
                          {/* …and an extra-choice pick can hand over a FEAT to choose, not just an
                              effect. Wizard Experimental Spellshaping: *"You gain one 1st-level
                              spellshape wizard feat of your choice."* The FEAT_PICK_GRANTS picker was
                              mounted for granted class FEATURES and for the subclass, and a thesis is
                              neither — so the spec had nowhere on screen to be answered. */}
                          {subAnchorId &&
                            Object.values(build.extraChoices ?? {})
                              .flat()
                              .filter((oid) => FEAT_PICK_GRANTS[oid])
                              .flatMap((oid) => {
                                const spec = FEAT_PICK_GRANTS[oid];
                                const opts = pickableFeats(spec, build, content).map((o) => ({ value: o.id, label: o.name, description: o.description, record: { bucket: 'feats', id: o.id } }));
                                return pickKeysFor(oid, spec.picks).map((key, i) => (
                                  <PopupSelect
                                    key={`ecp-${key}`}
                                    title={pickPrompt(spec.prompt, i, spec.picks)}
                                    placeholder={`${pickPrompt(spec.prompt, i, spec.picks)}…`}
                                    value={build.pickFeatChoices?.[key] ?? ''}
                                    onChange={(v) => actions.patch({ pickFeatChoices: { ...(build.pickFeatChoices ?? {}), [key]: v } })}
                                    options={opts}
                                  />
                                ));
                              })}
                          {/* School of Unified Magical Theory (Player Core): grants a BONUS 1st-level
                              wizard class feat (an extra class-feat slot) — pick it here. */}
                          {isUmtSchool && subAnchorId && lvl === 1 && (
                            <div className={'lvl-card lvl-choice' + (build.umtFeatId ? '' : ' empty')}>
                              <span className="lvl-card-icon">
                                <i className="ti ti-wand" aria-hidden="true" />
                              </span>
                              <div className="lvl-card-text">
                                <div className="lvl-card-label">Bonus wizard feat (Unified Magical Theory)</div>
                                <PopupSelect
                                  className="lvl-subsel"
                                  title="Bonus wizard class feat"
                                  placeholder="Choose a feat…"
                                  value={build.umtFeatId ?? ''}
                                  onChange={(v) => actions.patch({ umtFeatId: v || null })}
                                  options={umtFeatOpts}
                                />
                              </div>
                              {!build.umtFeatId && <span className="lvl-pending">!</span>}
                            </div>
                          )}
                          {g.featSlots.map((catg, i) => {
                      const key = slotKey(lvl, catg, i);
                      const picked = build.featPicks[key];
                      // Re-validate an already-picked feat: later edits (boosts, removed feats, a
                      // different subclass) can break prerequisites that were met when picking.
                      // Warn only — never auto-remove — and respect a deliberate override.
                      const pickedFeat = picked ? content.feats[picked] : undefined;
                      const overridden = !!picked && (build.overrides?.allowedFeats?.includes(picked) ?? false);
                      const revalidation =
                        pickedFeat && !overridden ? checkPrerequisites(pickedFeat, featPrereqChar, content) : null;
                      const nowInvalid = !!revalidation && !revalidation.met;
                      // A pick this slot's own picker would refuse — a second class changed under a rogue feat
                      // in the fighter's slot, a save or import that put it there. Flagged here from the live
                      // build, never moved or removed: the player replaces or clears it.
                      const unfit = !!picked && !!ovContent.feats[picked] && !fitsSlot(build, ovContent, key, key);
                      return (
                        <div className="lvl-slot-wrap" key={key}>
                          <div className="lvl-slot">
                            <button
                              // A FILLED slot: clicking shows the feat's description (toggle); use the
                              // Replace button to swap it. An EMPTY slot: clicking opens the picker.
                              className={'lvl-card' + (picked ? '' : ' empty')}
                              type="button"
                              data-ctl="slot"
                              data-ctl-title={FEAT_LABEL[catg]}
                              data-ctl-state={picked ? 'picked' : 'empty'}
                              title={picked ? 'Show description' : undefined}
                              onClick={() => {
                                if (!picked) return setPicker({ kind: 'feat', level: lvl, category: catg, idx: i });
                                const f = content.feats[picked];
                                // `slug`: the pick's OWN page — its name can be another feat's key (descNodeOf).
                                if (f?.description) setFeatDescPopup({ title: f.name, description: f.description, descRefs: f.descRefs, key: 'feats', slug: picked });
                              }}
                            >
                              <span className="lvl-card-icon">
                                <i className={'ti ' + FEAT_ICON[catg]} aria-hidden="true" />
                              </span>
                              <div className="lvl-card-text">
                                <div className="lvl-card-label">{FEAT_LABEL[catg]}</div>
                                <div className="lvl-card-val">{picked ? content.feats[picked]?.name ?? picked : 'Choose…'}</div>
                              </div>
                              {picked && nowInvalid && (
                                <span
                                  className="lvl-invalid"
                                  title={`Prerequisites no longer met: ${revalidation!.unmet.join('; ')}`}
                                >
                                  <i className="ti ti-alert-triangle" aria-hidden="true" />
                                </span>
                              )}
                              {!picked && <span className="lvl-pending">!</span>}
                            </button>
                            {picked && (
                              <>
                                <button
                                  className="lvl-replace-btn"
                                  type="button"
                                  onClick={() => setPicker({ kind: 'feat', level: lvl, category: catg, idx: i })}
                                >
                                  <i className="ti ti-repeat" aria-hidden="true" /> Replace
                                </button>
                                <button
                                  className="lvl-clear-btn"
                                  type="button"
                                  aria-label="Clear feat"
                                  onClick={() => actions.setFeat(key, null)}
                                >
                                  <i className="ti ti-x" aria-hidden="true" />
                                </button>
                              </>
                            )}
                          </div>
                          {/* The picked feat's TrustMarker line under the filled card, as the heritage
                              card shows it: a created feat with no rules encoded applies nothing, and the
                              slot is where the player spent the pick (see TrustMarker). */}
                          {picked && <TrustMarker bucket="feats" id={picked} />}
                          {/* WHY the triangle on the card is there, in words. It was only the icon's
                              hover tooltip, which a phone never shows, and a tap on the icon opens the
                              feat's description — so a phone player could not find out what was wrong.
                              test/phone-builder-shell.test.tsx. */}
                          {picked && nowInvalid && (
                            <div className="lvl-note lvl-unfit lvl-invalid-note" data-invalid={key}>
                              <i className="ti ti-alert-triangle" aria-hidden="true" /> Prerequisites no longer met
                              {revalidation!.unmet.length ? `: ${revalidation!.unmet.join('; ')}` : ''}. Still on your
                              character — replace it, or meet the prerequisite again.
                            </div>
                          )}
                          {unfit && (
                            <div className="lvl-note lvl-unfit" data-unfit={key}>
                              <i className="ti ti-alert-triangle" aria-hidden="true" /> Not valid for this slot — still on your character. Replace or clear it.
                            </div>
                          )}
                          {/* The record-level NOTE — "this bonus lands on your hierophant, not you",
                              "recorded only", "your GM decides which ally wears the relic". It renders on
                              the Feats tab and was read NOWHERE in the builder, which is precisely where
                              the player is deciding whether to spend the slot. 14 feats carry one. */}
                          {picked && content.feats[picked]?.note && (
                            <div className="lvl-note">
                              <i className="ti ti-info-circle" aria-hidden="true" /> {content.feats[picked]!.note}
                            </div>
                          )}
                          {/* The feat's full description opens in a popup when the card is clicked
                              (setFeatDescPopup) — no inline expand. */}
                          {/* Armor Proficiency (and any derived-cascade feat) has no dropdown — show
                              which armor THIS take trained, resolved from the built character so three
                              identical rows read Light / Medium / Heavy. */}
                          {picked &&
                            FEAT_GRANTS[picked]?.armorCascade &&
                            (() => {
                              const grant = featPrereqChar.feats.find(
                                (f) => f.featId === picked && f.level === lvl && f.category === catg,
                              )?.choice?.label;
                              return grant ? (
                                <SubCard icon="ti-shield" label="Trains you in">
                                  <span className="lvl-card-val">{grant}</span>
                                </SubCard>
                              ) : null;
                            })()}
                          {picked &&
                            content.feats[picked]?.choice &&
                            // A choice that GRANTS a feat (flag 'feat', e.g. Pitborn) is handled by the
                            // pick-a-feat picker below — don't also render the inert proficiency-choice dropdown.
                            !(content.feats[picked]!.choice!.flag === 'feat' && FEAT_PICK_GRANTS[picked]) &&
                            /* A DAILY choice belongs to daily preparations, not the build. The two class-feature
                               sites above already guarded; this one did not, so Harbinger's Armament asked for
                               today's rune here AND again every morning — two stores for one answer, and the
                               builder's copy moved nothing (build.ts skips daily answers) while the morning's did.
                               Guarded on `askedAtDailyPrep`, not on `daily`, so a kind the Rest sheet cannot
                               render keeps its picker here rather than becoming askable nowhere. */
                            !askedAtDailyPrep(content.feats[picked]!.choice) &&
                            (() => {
                              return renderChoice(content.feats[picked]!.choice!, key, picked);
                            })()}
                          {/* Dedication skill-training CHOICES ("trained in Acrobatics or Athletics") and
                              the bonus skill feat (Rogue Dedication) — surfaced from FEAT_GRANTS below
                              the picked feat, so the player resolves each grant in context. */}
                          {picked &&
                            [
                              ...(FEAT_GRANTS[picked]?.skillChoices ?? []).map((slot, si) => ({
                                slot,
                                skKey: `${picked}:${si}`,
                                ctx: { featId: picked, index: si, choiceValue: null as string | null },
                              })),
                              /* …and the slots belonging to the grant the player's OWN answer selected.
                                 Clan Lore's twelve listed clans hand over a named pair of skills; an
                                 unlisted clan's are "determined by your GM", so that one answer — and no
                                 other — asks a further question. Keyed by the answer exactly as
                                 featSkillChoiceValue keys it, so the builder and the engine read one key. */
                              ...(choiceGrantFor(FEAT_GRANTS[picked], build.featChoices?.[key])?.skillChoices ?? []).map(
                                (slot, si) => ({
                                  slot,
                                  skKey: `${picked}:${build.featChoices?.[key]}:${si}`,
                                  ctx: { featId: picked, index: si, choiceValue: build.featChoices?.[key] ?? null },
                                }),
                              ),
                            ].map(({ slot, skKey, ctx }) => {
                              /* Shared with the engine — a slot whose skill the printed text DERIVES
                                 from an answer already given (Surki Lore's magiphage tradition) offers
                                 that one skill, not four. Computing the list here a second way is how
                                 the builder and the sheet come to disagree about one slot. */
                              /* `ctx` is what lets a later slot drop the skill an IDENTICAL sibling
                                 already took — Magical Knowledge's *"…and IN ANOTHER from trained to
                                 expert"* over two slots listing the same four skills. The engine
                                 resolves the same way through the same helper. */
                              const opts = skillSlotOptions(slot, build, content, ctx);
                              // The option this slot is CURRENTLY granting — the player's answer, or the
                              // engine's default when unanswered. Its rank on the built character already
                              // includes this grant, so it can never be judged redundant against itself.
                              const effective = build.featSkillChoices?.[skKey] ?? opts[0];
                              return (
                                <SubCard key={skKey} icon="ti-bulb" label="Trained skill">
                                  <PopupSelect
                                    title="Trained skill"
                                    placeholder="Choose a skill…"
                                    // Empty until picked — falling back to opts[0] displayed a skill the
                                    // player never chose as though they had.
                                    value={build.featSkillChoices?.[skKey] ?? ''}
                                    onChange={(v) =>
                                      actions.patch({
                                        featSkillChoices: { ...(build.featSkillChoices ?? {}), [skKey]: v as (typeof SKILLS)[number] },
                                      })
                                    }
                                    // skillLabel, not cap: a Lore option would otherwise read
                                    // "Lore:spirit" instead of "Spirit Lore".
                                    options={opts.map((s) => {
                                      const cur = featPrereqChar.proficiencies.skills[s] ?? 'untrained';
                                      const dead = s !== effective && skillSlotGrant(slot, cur) === null;
                                      return {
                                        value: s,
                                        label: skillLabel(s),
                                        disabled: dead,
                                        disabledReason: dead ? `Already ${cur} — this grant would change nothing.` : undefined,
                                      };
                                    })}
                                  />
                                </SubCard>
                              );
                            })}
                          {/* Redundant-grant fallback ("already trained in X → a skill of your choice"):
                              the derived character reports each triggered slot; offer the replacement. */}
                          {picked &&
                            (featPrereqChar.skillFallbacks ?? [])
                              .filter((fb) => fb.featId === picked)
                              .map((fb) => {
                                const fbKey = `${picked}:fallback:${fb.skill}`;
                                /* The heading used to say "Already trained in X" whatever the rank was.
                                   Golden League Xun's clause fires on a character who is already an
                                   EXPERT, and telling them they are trained misstates why the picker
                                   appeared — so read the rank they actually hold. */
                                const held = featPrereqChar.proficiencies.skills[fb.skill] ?? 'trained';
                                const heading = fb.note ? cap(fb.note) : `Already ${held} in ${cap(fb.skill)}`;
                                /* Ghost Hunter's replacement is *"a new LORE skill of your choice"*, so the
                                   player types a subject; the sixteen-skill select cannot express one. */
                                if (fb.lore)
                                  return (
                                    <SubCard key={fbKey} icon="ti-bulb" label={`${heading} — replacement Lore`}>
                                      <input
                                        className="lvl-lore-input"
                                        placeholder="Lore subject (e.g. Warfare)…"
                                        value={build.featLoreChoices?.[fbKey] ?? ''}
                                        onChange={(e) => actions.patch({ featLoreChoices: { ...(build.featLoreChoices ?? {}), [fbKey]: e.target.value } })}
                                      />
                                    </SubCard>
                                  );
                                return (
                                  <SubCard key={fbKey} icon="ti-bulb" label={`${heading} — replacement skill`}>
                                    <PopupSelect
                                      title="Replacement skill"
                                      placeholder="Choose a skill…"
                                      value={build.featSkillChoices?.[fbKey] ?? ''}
                                      onChange={(v) =>
                                        actions.patch({
                                          featSkillChoices: { ...(build.featSkillChoices ?? {}), [fbKey]: v as (typeof SKILLS)[number] },
                                        })
                                      }
                                      // The replacement grants `fb.rank ?? 'trained'`, through maxRank —
                                      // so every skill the character already has AT THAT RANK is a
                                      // second dead end, and this picker (offered precisely BECAUSE one
                                      // grant was redundant) used to list all sixteen of them as live.
                                      // Above trained the printed clause also NAMES its pool — *"two
                                      // other skills of your choice in which you're trained"* — so an
                                      // untrained skill is dead for the opposite reason.
                                      options={SKILLS.map((s) => {
                                        const want = fb.rank ?? 'trained';
                                        const cur = featPrereqChar.proficiencies.skills[s] ?? 'untrained';
                                        const has = PROFICIENCY_RANKS.indexOf(cur) >= PROFICIENCY_RANKS.indexOf(want);
                                        const untrained = want !== 'trained' && cur === 'untrained';
                                        const dead = s !== build.featSkillChoices?.[fbKey] && (has || untrained);
                                        return {
                                          value: s,
                                          label: cap(s),
                                          disabled: dead,
                                          disabledReason: !dead
                                            ? undefined
                                            : untrained
                                              ? `Untrained — this replacement asks for a skill you are already trained in.`
                                              : `Already ${cur} — pick a skill this would raise to ${want}.`,
                                        };
                                      })}
                                    />
                                  </SubCard>
                                );
                              })}
                          {/* "For each of these feats you already have, you can INSTEAD gain a different
                              feat from the following list" — the engine reports which grants landed on a
                              feat the character already had; offer the replacement it owes them. */}
                          {picked &&
                            (featPrereqChar.featSubstitutions ?? [])
                              .filter((sb) => sb.featId === picked)
                              .map((sb) => (
                                <SubCard
                                  key={sb.key}
                                  icon="ti-bulb"
                                  label={`Already have ${content.feats[sb.ifHave]?.name ?? sb.ifHave} — replacement feat`}
                                >
                                  <PopupSelect
                                    title="Replacement feat"
                                    placeholder="Choose a feat…"
                                    value={build.pickFeatChoices?.[sb.key] ?? ''}
                                    onChange={(v) => actions.patch({ pickFeatChoices: { ...(build.pickFeatChoices ?? {}), [sb.key]: v } })}
                                    // A feat already held is a dead end — print says "a DIFFERENT feat",
                                    // and the engine refuses it, so the picker must not offer it live.
                                    options={sb.options
                                      .filter((id) => content.feats[id])
                                      .map((id) => {
                                        const held = id !== build.pickFeatChoices?.[sb.key] && featPrereqChar.feats.some((f) => f.featId === id);
                                        return {
                                          value: id,
                                          label: content.feats[id]!.name,
                                          description: content.feats[id]!.description,
                                          record: { bucket: 'feats', id },
                                          disabled: held,
                                          disabledReason: held ? 'Already have this feat — pick a different one.' : undefined,
                                        };
                                      })}
                                  />
                                </SubCard>
                              ))}
                          {picked &&
                            Array.from({ length: FEAT_GRANTS[picked]?.loreChoices ?? 0 }).map((_, li) => {
                              // Keyed by SLOT, not by feat id. Additional Lore is `maxTakable: null` and
                              // its Special clause demands a NEW subcategory each time, so a bare-id key
                              // made take 2 an alias of take 1 and two takes trained ONE Lore. Same fix
                              // and same shape as the pick-a-feat lane's slot key in build.ts.
                              const loreKey2 = `${key}:${li}`;
                              // The old key is still READ, so a character saved before this keeps its
                              // subject; the first edit migrates it to the slot key.
                              const loreLegacy = `${picked}:${li}`;
                              return (
                                <SubCard key={`lore-${loreKey2}`} icon="ti-bulb" label="Trained Lore">
                                  <input
                                    className="lvl-lore-input"
                                    placeholder="Lore subject (e.g. Warfare)…"
                                    value={build.featLoreChoices?.[loreKey2] ?? build.featLoreChoices?.[loreLegacy] ?? ''}
                                    onChange={(e) => actions.patch({ featLoreChoices: { ...(build.featLoreChoices ?? {}), [loreKey2]: e.target.value } })}
                                  />
                                </SubCard>
                              );
                            })}
                          {/* One picker PER granted skill feat. Magical Knowledge prints "You gain a
                              skill feat associated with each of the skills you chose" over a two-skill
                              choice, so a single control could only ever deliver one of the two. Index
                              0 keeps the bare feat-id key, so an existing answer never moves. */}
                          {picked &&
                            Array.from({ length: bonusSkillFeatCount(FEAT_GRANTS[picked]) }).map((_, bi) => {
                              const bKey = bonusSkillFeatKey(picked, bi);
                              const mine = build.dedicationSkillFeats?.[bKey] ?? '';
                              // A feat a SIBLING picker already took is dropped by buildCharacter as a
                              // duplicate, so offering it here would spend a printed grant on nothing.
                              const siblings = new Set(
                                Array.from({ length: bonusSkillFeatCount(FEAT_GRANTS[picked]) }, (_, j) => build.dedicationSkillFeats?.[bonusSkillFeatKey(picked, j)])
                                  .filter((v, j) => !!v && j !== bi) as string[],
                              );
                              return (
                                <SubCard key={`bonus-skill-${bKey}`} icon="ti-medal" label="Bonus skill feat">
                                  <PopupSelect
                                    title="Bonus skill feat"
                                    placeholder="Choose a skill feat…"
                                    value={mine}
                                    onChange={(v) =>
                                      actions.patch({
                                        dedicationSkillFeats: { ...(build.dedicationSkillFeats ?? {}), [bKey]: v },
                                      })
                                    }
                                    options={skillFeatOpts.filter((o) => !siblings.has(o.value))}
                                  />
                                </SubCard>
                              );
                            })}
                          {/* Pick-a-feat grants (General Training, Basic Maneuver, Natural Ambition, …):
                              the player chooses a bonus feat from the grant's filtered pool. */}
                          {picked &&
                            FEAT_PICK_GRANTS[picked] &&
                            (() => {
                              const spec = FEAT_PICK_GRANTS[picked];
                              const opts = pickableFeats(spec, build, content).map((f) => ({ value: f.id, label: f.name, description: f.description, record: { bucket: 'feats', id: f.id } }));
                              // Stored per SLOT, so a repeatable grant taken twice shows two pickers
                              // rather than two views of one answer. The bare feat-id key is still
                              // READ, so a character saved before this keeps the pick it had.
                              // A `picks` spec asks more than once; index 0 keeps the bare key so an
                              // existing answer never moves — the same convention build.ts reads.
                              const idKeys = pickKeysFor(picked, spec.picks);
                              return (
                                <SubCard icon="ti-medal" label={spec.prompt}>
                                  {pickKeysFor(key, spec.picks).map((k, i) => (
                                    <PopupSelect
                                      key={k}
                                      title={pickPrompt(spec.prompt, i, spec.picks)}
                                      placeholder={`${pickPrompt(spec.prompt, i, spec.picks)}…`}
                                      value={build.pickFeatChoices?.[k] ?? build.pickFeatChoices?.[idKeys[i]] ?? ''}
                                      onChange={(v) => actions.patch({ pickFeatChoices: { ...(build.pickFeatChoices ?? {}), [k]: v } })}
                                      options={opts}
                                    />
                                  ))}
                                </SubCard>
                              );
                            })()}
                          {/* A GRANTED feat's own sub-choice (Seeker of Truths grants Domain Initiate →
                              pick its domain here; the granted feat has no slot of its own). Routed
                              through grantedChoicePicker so this path and the background path cannot
                              drift — the inline copy that used to live here handled `domains` but not
                              `skills`, which is why an Assurance grant had no options even when reached. */}
                          {picked && (FEAT_FEAT_GRANTS[picked] ?? []).map((gid) => grantedChoicePicker(gid))}
                          {/* Effect choices ("choose one of N" — a dragon tattoo's resistance type, an
                              energy heart's element): each picked option confers a concrete effect. */}
                          {picked &&
                            (content.feats[picked]?.effectChoices ?? [])
                              // A choice the record's own ENHANCEMENT tier asks is only asked once an
                              // augmentation names this feat. Rendering it before that is a live
                              // control whose answer nothing applies — the shape Q27 rules out.
                              .filter(
                                (ch) =>
                                  !(content.feats[picked]?.enhancement?.choiceIds ?? []).includes(ch.id) ||
                                  (featPrereqChar.enhancements ?? []).some((e) => e.featId === picked),
                              )
                              .map((ch) => {
                              /*
                               * A REPEATABLE feat's OPEN pick is answered per TAKING — Qi Spells is
                               * *"choose a different spell each time"* — so its answer is keyed by
                               * SLOT rather than by record, or every take writes over the last one.
                               * The 21 enumerated repeatable picks moved to `choice` instead;
                               * `spellFilter` is the one shape `choice` cannot hold, so these four
                               * change the KEY rather than the lane. The record key is still READ, so
                               * a monk who answered before this keeps the spell they chose.
                               */
                              const perTaking = !!ch.spellFilter && maxTakes(content.feats[picked]) > 1;
                              const ecKey = perTaking ? `${key}:${ch.id}` : `${picked}:${ch.id}`;
                              const ecValue = build.effectChoices?.[ecKey] ?? (perTaking ? build.effectChoices?.[`${picked}:${ch.id}`] : undefined);
                              const set = (v: string) => actions.patch({ effectChoices: { ...(build.effectChoices ?? {}), [ecKey]: v } });
                              // An OPEN pick ("any 1st-rank arcane spell") gets a searchable spell list;
                              // a fixed set gets the plain dropdown. Hidden until its unlock level.
                              if (ch.spellFilter) {
                                if (build.level < (ch.spellFilter.minLevel ?? 1)) return null;
                                // "Choose a different spell each time" (the qi-spells family): the
                                // spells OTHER takes of this same feat already claimed are greyed
                                // with the reason — never removed, and never this slot's own stored
                                // answer (Q27; same rule as `choice.distinctAcrossTakes`).
                                const claimed = new Set<string>();
                                if (perTaking && ch.spellFilter.distinctAcrossTakes) {
                                  for (const [k, id] of Object.entries(build.featPicks)) {
                                    if (id !== picked || k === key) continue;
                                    const v = build.effectChoices?.[`${k}:${ch.id}`];
                                    if (v) claimed.add(v);
                                  }
                                  // The legacy record-keyed answer belongs to whichever take reads it
                                  // through the fallback — do not grey it against ITSELF.
                                  const legacy = build.effectChoices?.[`${picked}:${ch.id}`];
                                  if (legacy && legacy !== ecValue) claimed.add(legacy);
                                }
                                const opts = spellsMatching(narrowSpellFilter(ch.spellFilter, build, content), content, build.hideLegacy).map((s) => ({
                                  id: s.id,
                                  name: s.name,
                                  note: (s.rank ?? 0) === 0 ? 'Cantrip' : `${s.rank} rank`,
                                  ...(claimed.has(s.id) && s.id !== ecValue
                                    ? { disabled: `Already chosen by another ${content.feats[picked]?.name ?? 'take'} — choose a different spell each time.` }
                                    : {}),
                                }));
                                return (
                                  <SubCard key={`ec-${ecKey}`} icon="ti-sparkles" label={ch.prompt}>
                                    <SearchSelect bare label="Spell" placeholder="Search spells…" value={ecValue ?? null} onChange={set} options={opts} />
                                  </SubCard>
                                );
                              }
                              return (
                                <SubCard key={`ec-${ecKey}`} icon="ti-adjustments" label={ch.prompt}>
                                  <PopupSelect
                                    title={ch.prompt}
                                    placeholder={`${ch.prompt}…`}
                                    value={ecValue ?? ''}
                                    onChange={set}
                                    // An option may carry a note instead of a grant (a kineticist gate
                                    // junction: only Elemental Resistance moves a stat). Show the note as
                                    // the description so the player can read each option before picking.
                                    // …and an option that names a RECORD the character must OWN to
                                    // pick it ("one of YOUR 1st- or 5th-level automaton ancestry
                                    // feats") is greyed with the reason rather than offered and then
                                    // silently dropped by the engine (Q9 filtering + Q27 display).
                                    // …and an option gated on a SENSE the character must already have
                                    // ("You must have low-light vision before you can gain darkvision
                                    // with this feat") is greyed with its reason too. The answer ALREADY
                                    // STORED is never greyed, so a pick cannot vanish out from under the
                                    // player and a gate cannot invalidate itself once its own grant lands.
                                    options={(ch.options ?? []).map((o) => {
                                      const mustOwn = (content.feats[picked]?.enhancementPicker?.choiceIds ?? []).includes(ch.id);
                                      const missing = mustOwn && !featPrereqChar.feats.some((f) => f.featId === o.value);
                                      const gateWhy = senseGateReason(
                                        o.requiresAnySense,
                                        builderSenses,
                                        build.effectChoices?.[ecKey] === o.value,
                                      );
                                      return {
                                        value: o.value,
                                        label: o.label,
                                        description: o.note,
                                        // The note is the option's own text, not a record's (card step 7b).
                                        record: null,
                                        disabled: missing || !!gateWhy,
                                        ...(missing ? { disabledReason: 'You do not have this feat.' } : {}),
                                        ...(!missing && gateWhy ? { disabledReason: gateWhy } : {}),
                                      };
                                    })}
                                  />
                                </SubCard>
                              );
                            })}
                          {/* Pick-a-cantrip grants (Dragon Spit, Hag Magic, …): choose an innate spell. */}
                          {picked &&
                            FEAT_CANTRIP_GRANTS[picked] &&
                            (() => {
                              const spec = FEAT_CANTRIP_GRANTS[picked];
                              const opts = spec.options
                                .map((id) => content.spells[id])
                                .filter(Boolean)
                                .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
                                .map((s) => ({ value: s.id, label: s.name, description: s.description, record: { bucket: 'spells', id: s.id } }));
                              return (
                                <SubCard icon="ti-sparkles" label={spec.prompt}>
                                  <PopupSelect
                                    title={spec.prompt}
                                    placeholder={`${spec.prompt}…`}
                                    value={build.pickCantripChoices?.[picked] ?? ''}
                                    onChange={(v) => actions.patch({ pickCantripChoices: { ...(build.pickCantripChoices ?? {}), [picked]: v } })}
                                    options={opts}
                                  />
                                </SubCard>
                              );
                            })()}
                        </div>
                      );
                    })}
                          {noSlot.map(([k, id]) => {
                            const name = content.feats[id]?.name ?? id;
                            // The first EMPTY slot of its kind here that TAKES it — never one its own picker would refuse.
                            const to = moveTargetFor(build, ovContent, k);
                            return (
                              <div className="lvl-slot lvl-noslot-row" key={`noslot-${k}`} data-noslot={k}>
                                <div className="lvl-card lvl-noslot">
                                  <span className="lvl-card-icon">
                                    <i className="ti ti-alert-triangle" aria-hidden="true" />
                                  </span>
                                  <div className="lvl-card-text">
                                    <div className="lvl-card-label">Feat with no slot: {name}</div>
                                    <div className="lvl-card-val">Still on your character.</div>
                                  </div>
                                </div>
                                {to && (
                                  <button
                                    className="lvl-replace-btn"
                                    type="button"
                                    // Re-checked on the live build: only while the feat is still here and that slot still the one that takes it.
                                    onClick={() => actions.patch((b) => (b.featPicks[k] === id && moveTargetFor(b, ovContent, k) === to ? swapSlotKeys(b, k, to) : {}))}
                                  >
                                    <i className="ti ti-arrow-back-up" aria-hidden="true" /> Move to slot
                                  </button>
                                )}
                                <button className="lvl-replace-btn" type="button" onClick={() => requestRemovePick(k, id, content, actions)}>
                                  <i className="ti ti-trash" aria-hidden="true" /> Remove
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {g.skillIncrease && (
                      <div className="lvl-group">
                        <div className="lvl-group-h">
                          <i className="ti ti-bulb" aria-hidden="true" /> Skills
                        </div>
                        <div className="lvl-cards">
                          <div className={'lvl-card' + (chosenIncrease ? '' : ' empty')}>
                            <span className="lvl-card-icon">
                              <i className="ti ti-arrow-up" aria-hidden="true" />
                            </span>
                            <div className="lvl-card-text">
                              <div className="lvl-card-label">Skill increase</div>
                              <div className="lvl-card-row">
                                <PopupSelect
                                  title="Skill increase"
                                  placeholder="Choose a skill…"
                                  value={chosenIncrease ?? ''}
                                  onChange={(v) => actions.setSkillIncrease(lvl, (v || null) as ProficiencyKey | null)}
                                  clearLabel="Clear"
                                  options={[
                                    ...skillOptions.map((k) => {
                                      const cur = baseSkills[k] ?? 'untrained';
                                      const next = naturalNextRank(cur);
                                      const atAbsoluteMax = next === cur; // already legendary
                                      // The level's proficiency cap may forbid this bump yet — show the real
                                      // next step ("E → M") but grey it out until the character is high enough.
                                      const allowedByLevel = PROFICIENCY_RANKS.indexOf(next) <= PROFICIENCY_RANKS.indexOf(skillIncreaseCap(lvl));
                                      return {
                                        value: k,
                                        label: `${skillLabel(k)} (${atAbsoluteMax ? `${RANK_ABBR[cur]} — max` : `${RANK_ABBR[cur]} → ${RANK_ABBR[next]}`})`,
                                        // …and a skill a record LOCKS: Bardic Lore "can't be increased by
                                        // any other means". It was offered live and un-greyed, and three
                                        // increases spent on it took a level-20 bard to master.
                                        disabled: atAbsoluteMax || !allowedByLevel || !!LOCKED_SKILL_KEYS[k],
                                        // The greying was already right; only the reason was missing.
                                        disabledReason: atAbsoluteMax
                                          ? 'Already legendary — nothing left to increase.'
                                          : !allowedByLevel
                                            ? `This level's increases cap at ${skillIncreaseCap(lvl)}.`
                                            : LOCKED_SKILL_KEYS[k],
                                      };
                                    }),
                                  ]}
                                  addCustom={{
                                    label: 'Learn a new lore',
                                    placeholder: 'Lore subject (e.g. Warfare)…',
                                    onAdd: (text) => {
                                      const k = loreKey(text);
                                      if (k) actions.setSkillIncrease(lvl, k);
                                    },
                                  }}
                                />
                                {chosenIncrease && (
                                  <span className="lvl-result">
                                    → {nextRank(baseSkills[chosenIncrease] ?? 'untrained', lvl)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* The EXTRA skill increases — the class's (swashbuckler's Stylish Tricks at 3/7/15;
                        the engine read `bonusSkillIncreases[lvl]` and the pending counter demanded it, but
                        no control ever wrote it — a permanent "1 choice left" nothing on the page could
                        clear, experience gate 2026-09-02) and the background's (Reborn Soul, batch 037).
                        One lane each, because they STACK: a swashbuckler Reborn Soul is owed both at 3rd,
                        7th and 15th on terms that do not overlap. Same control, same helper shape; only
                        the option list narrows. */}
                    {[
                      {
                        key: 'bonus' as const,
                        on: !!g.bonusSkillIncrease,
                        label: 'Bonus skill increase',
                        store: build.bonusSkillIncreases,
                        restrict: restrictedSkillIncreaseAllowed(build, content),
                        write: (next: Record<number, ProficiencyKey>) => actions.patch({ bonusSkillIncreases: next }),
                      },
                      {
                        key: 'background' as const,
                        on: !!g.backgroundSkillIncrease,
                        /* Reborn Soul (background-590): *"At 3rd level, 7th level, and 15th level, you
                         * receive skill increases, which you can apply only to these Lore skills."* */
                        label: 'Background skill increase',
                        store: build.backgroundSkillIncreases,
                        restrict: backgroundSkillIncreaseAllowed(build, content),
                        write: (next: Record<number, ProficiencyKey>) => actions.patch({ backgroundSkillIncreases: next }),
                      },
                    ]
                      .filter((lane) => lane.on)
                      .map((lane) => {
                        const chosenBonus = lane.store?.[lvl] ?? null;
                        /* The record that grants this increase may NARROW it. Swashbuckler Stylish
                         * Tricks: *"you gain an additional skill increase you can apply only to
                         * Acrobatics or the skill from your swashbuckler's style"*; thaumaturge
                         * Thaumaturgic Expertise/Mastery: *"which you can apply only to Arcana, Nature,
                         * Occultism, or Religion"*. The list was unfiltered, so a level-3 Braggart could
                         * raise Medicine — buildCharacter now drops such a pick, and greying it here is
                         * what stops the player making it. Same helper both sides. */
                        const narrowed = lane.restrict?.levels.includes(lvl) ? lane.restrict : null;
                        return (
                          <div className="lvl-group" key={lane.key}>
                            <div className="lvl-group-h">
                              <i className="ti ti-bulb" aria-hidden="true" /> Skills (bonus increase)
                            </div>
                            <div className="lvl-cards">
                              <div className={'lvl-card' + (chosenBonus ? '' : ' empty')}>
                                <span className="lvl-card-icon">
                                  <i className="ti ti-arrow-up" aria-hidden="true" />
                                </span>
                                <div className="lvl-card-text">
                                  <div className="lvl-card-label">{lane.label}</div>
                                  {/* The narrowing, said out loud rather than left to be discovered by
                                      tapping a greyed option — and the only thing on screen when the
                                      allowed set is still empty (Reborn Soul before its two past-life
                                      Lores are typed on the origins page). */}
                                  {narrowed && <div className="lvl-auto">{narrowed.reason}</div>}
                                  <div className="lvl-card-row">
                                    <PopupSelect
                                      title={lane.label}
                                      placeholder="Choose a skill…"
                                      value={chosenBonus ?? ''}
                                      onChange={(v) => {
                                        const next = { ...(lane.store ?? {}) };
                                        if (v) next[lvl] = v as ProficiencyKey;
                                        else delete next[lvl];
                                        lane.write(next);
                                      }}
                                      clearLabel="Clear"
                                      options={skillOptions.map((k) => {
                                        const cur = baseSkills[k] ?? 'untrained';
                                        const next = naturalNextRank(cur);
                                        const atAbsoluteMax = next === cur;
                                        const allowedByLevel = PROFICIENCY_RANKS.indexOf(next) <= PROFICIENCY_RANKS.indexOf(skillIncreaseCap(lvl));
                                        return {
                                          value: k,
                                          label: `${skillLabel(k)} (${atAbsoluteMax ? `${RANK_ABBR[cur]} — max` : `${RANK_ABBR[cur]} → ${RANK_ABBR[next]}`})`,
                                          disabled: atAbsoluteMax || !allowedByLevel || !!LOCKED_SKILL_KEYS[k] || (!!narrowed && !narrowed.skills.has(k)),
                                          disabledReason: atAbsoluteMax
                                            ? 'Already legendary — nothing left to increase.'
                                            : !allowedByLevel
                                              ? `This level's increases cap at ${skillIncreaseCap(lvl)}.`
                                              : LOCKED_SKILL_KEYS[k] ?? (narrowed && !narrowed.skills.has(k) ? narrowed.reason : undefined),
                                        };
                                      })}
                                    />
                                    {chosenBonus && (
                                      <span className="lvl-result">
                                        → {nextRank(baseSkills[chosenBonus] ?? 'untrained', lvl)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                    {(() => {
                      // Monk Path to Perfection: a save-proficiency choice at L7/L11/L15.
                      const tier = [
                        { id: 'path-to-perfection', n: 0, legendary: false },
                        { id: 'second-path-to-perfection', n: 1, legendary: false },
                        { id: 'third-path-to-perfection', n: 2, legendary: true },
                      ].find((p) => g.features.some((f) => f.id === p.id));
                      if (!tier) return null;
                      const picks = build.pathToPerfection ?? [];
                      const saves: [SaveId, string][] = [['fortitude', 'Fortitude'], ['reflex', 'Reflex'], ['will', 'Will']];
                      const allowed = (s: SaveId) =>
                        tier.n === 1 ? s !== picks[0] : tier.n === 2 ? s === picks[0] || s === picks[1] : true;
                      return (
                        <div className="lvl-group">
                          <div className="lvl-group-h">
                            <i className="ti ti-shield-check" aria-hidden="true" /> Saving throws
                          </div>
                          <div className="lvl-cards">
                            <div className={'lvl-card' + (picks[tier.n] ? '' : ' empty')}>
                              <span className="lvl-card-icon">
                                <i className="ti ti-arrow-up" aria-hidden="true" />
                              </span>
                              <div className="lvl-card-text">
                                <div className="lvl-card-label">{tier.legendary ? 'Raise a save to legendary' : 'Raise a save to master'}</div>
                                <div className="lvl-card-row">
                                  <PopupSelect
                                    title="Path to Perfection"
                                    placeholder="Choose a save…"
                                    value={picks[tier.n] ?? ''}
                                    onChange={(v) => actions.setPathToPerfection(tier.n, (v || null) as SaveId | null)}
                                    clearLabel="Clear"
                                    options={saves.map(([v, label]) => ({ value: v, label, disabled: !allowed(v) }))}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {g.attributeBoosts && (
                      <div className="lvl-group">
                        <div className="lvl-group-h">
                          <i className="ti ti-hexagon" aria-hidden="true" /> Attributes
                        </div>
                        <div className="lvl-cards">
                          {(() => {
                            const boostCount = attributeBoostCount(build.variantRules);
                            // Gradual Attribute Boosts: no attribute may be boosted twice within its 4-level
                            // set — exclude attributes already picked at the other levels of this set.
                            const setExclude = build.variantRules?.gradualBoosts
                              ? (GRADUAL_BOOST_SETS.find((set) => set.includes(lvl)) ?? [])
                                  .filter((l) => l !== lvl)
                                  .flatMap((l) => build.attributeBoosts[l] ?? [])
                                  .filter((x): x is NonNullable<typeof x> => !!x)
                              : [];
                            return (
                          <div
                            className={
                              'lvl-card' +
                              ((build.attributeBoosts[lvl] ?? []).filter(Boolean).length < boostCount ? ' empty' : '')
                            }
                          >
                            <span className="lvl-card-icon">
                              <i className="ti ti-rosette" aria-hidden="true" />
                            </span>
                            <div className="lvl-card-text">
                              <div className="lvl-card-label">
                                {boostCount === 1 ? 'Attribute boost' : `Attribute boosts — choose ${boostCount} different`}
                              </div>
                              <div className="lvl-card-row">
                                {Array.from({ length: boostCount }, (_, i) => (
                                  <AbilitySelect
                                    key={i}
                                    value={build.attributeBoosts[lvl]?.[i] ?? null}
                                    options={ABILITIES}
                                    exclude={[...(build.attributeBoosts[lvl] ?? []), ...setExclude]}
                                    onChange={(v) => actions.setAttributeBoost(lvl, i, v)}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {!anyContent && <div className="setup-note">No choices at this level.</div>}
                  </fieldset>
                </div>
                {renderSpellsForLevel(lvl)}
                </>
              );
            })()}
        </div>

        <aside className="brail">
          <div className="brail-title">
            {/* Phone: the WHOLE title row is the toggle, the word included. Only the chevron used to be
                (32x34 at the far left); a tap on "Character" or beside it did nothing, which read as
                broken, and closing the panel again meant finding that chevron. Desktop keeps the plain
                heading (the panel is always open there). test/phone-builder-shell.test.tsx. */}
            {isMobile ? (
              <button
                type="button"
                className="brail-toggle"
                aria-label={statsOpen ? 'Hide character stats' : 'Show character stats'}
                aria-expanded={statsOpen}
                onClick={() => setStatsOpen((o) => !o)}
              >
                <i className={'ti ' + (statsOpen ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
                <span className="brail-toggle-label">Character</span>
              </button>
            ) : (
              'Character'
            )}
          </div>
          {(!isMobile || statsOpen) && <FullStats build={build} content={content} character={featPrereqChar} />}
        </aside>
      </div>

      {featDescPopup && <DescriptionModal root={featDescPopup} onClose={() => setFeatDescPopup(null)} />}

      {picker && picker.kind === 'feat' && (() => {
        const isClassSlot = picker.category === 'class';
        // The archetype dedication rule — taken feats excluding this slot. Evaluated PER CANDIDATE
        // (ruling Q25): the requirement, its count and its exceptions all come off whichever
        // dedication the character already has, so there is no slot-wide yes/no to compute here.
        const pickerKey = slotKey(picker.level, picker.category, picker.idx);
        /* Carry the SLOT with each feat, not just its id. A feat listed by an archetype counts toward
         * that archetype's gate only when it was taken in an archetype slot — see `countsForArchetype`.
         * Dropping the key here is what let a cleric's own Domain Initiate count as a Soul Warden feat. */
        const takenForRule = Object.entries(build.featPicks)
          .filter(([k, v]) => v && k !== pickerKey)
          .map(([k, v]) => ({ id: v as string, category: k.split(':')[1] }));
        const dedBlockedWhy = (f: Feat) => dedicationBlock(takenForRule, f, content);
        const archHidden = isClassSlot && !showArch;
        const feats = eligibleFor(picker)
          // Class slots: hide archetype feats unless the Archetypes toggle is on.
          .filter((f) => !archHidden || !f.traits.includes('archetype'))
          // When showing archetypes, surface the dedications (entry points) first.
          .sort((a, b) => {
            const ad = a.traits.includes('dedication') ? 0 : 1;
            const bd = b.traits.includes('dedication') ? 0 : 1;
            return ad - bd || a.level - b.level || a.name.localeCompare(b.name);
          });
        /*
         * A feat whose GRANT IS EXHAUSTED — legal to take, and guaranteed to do nothing.
         *
         * Armor Proficiency cascades "you become trained in the NEXT type of armor", and a fighter is
         * already trained in light, medium and heavy, so build.ts finds no category to train and the take
         * grants nothing. No later level rescues it either: the 13th-level clause upgrades only the
         * category THIS feat granted.
         *
         * Ruling Q21 — "the grant would be WASTED ACROSS YOUR WHOLE CAREER" — is the FILTERED row, so
         * this rides `featIneligible` and is hidden by default, exactly like a blocked dedication.
         * Ruling Q27 governs how it looks once "Show ineligible" reveals it: dimmed, with this sentence.
         * Both halves are needed. Greying alone would leave it live-and-inert in the default view (the
         * bug Q27 was written about); filtering alone would hide it with no explanation anywhere.
         *
         * Never applied to the feat already sitting in THIS slot: featPrereqChar includes that take, so
         * a re-open of the slot would grey the player's own pick.
         */
        // Never applied to the feat already sitting in THIS slot: featPrereqChar includes that take,
        // so a re-open of the slot would grey the player's own pick.
        const noOpWhy = (f: Feat): string | undefined =>
          build.featPicks?.[pickerKey] === f.id ? undefined : exhaustedGrantReason(f, featPrereqChar);
        // "Hide ineligible" filter predicate — mirrors the row's unmet/allowed logic below.
        const featIneligible = (f: Feat) => {
          if (build.overrides?.allowedFeats?.includes(f.id)) return false;
          if (dedBlockedWhy(f)) return true;
          if (noOpWhy(f)) return true;
          return !checkPrerequisites(f, featPrereqChar, content).met;
        };
        // "Why is my feat missing?" — everything needed to diff a search against the FULL content
        // (ovContent, the same pool the Overrides add-feat picker browses).
        const shownIds = new Set(feats.map((f) => f.id));
        const slotEligibleIds = new Set(eligibleFor(picker, ovContent).map((f) => f.id));
        const enabledBooks = enabledBookSet(build.enabledSources);
        // Picking a feat from a disabled book: confirm, then enable that book for this character —
        // the feat then appears as a normal result (with the usual prerequisite gating). Never
        // silently changes sources.
        const enableBookFor = async (f: Feat) => {
          const book = f.source?.book?.trim();
          if (!book) return;
          const ok = await confirmDialog({
            title: 'Enable source book?',
            message: (
              <>
                <p>
                  <strong>{f.name}</strong> comes from <strong>{book}</strong>, which is disabled for this character.
                </p>
                <p>Enable the book? Its content becomes available in this character&apos;s pickers (you can change this any time in Setup → Sources).</p>
              </>
            ),
            confirmLabel: 'Enable book',
          });
          // A homebrew feat's source goes on by its id (sources.ts sourceIdToken): a rename keeps it on.
          const key = f.homebrewSourceId ? sourceIdToken(f.homebrewSourceId) : book;
          if (ok) actions.patch({ enabledSources: storedSources([...enabledBooks, key]) });
        };
        return (
          <FilterableSelect
            title={`Choose ${withArticle(FEAT_LABEL[picker.category].toLowerCase())}`}
            icon="ti-medal"
            items={feats}
            spec={FEAT_SPEC}
            rowKey={(f) => f.id}
            onClose={() => setPicker(null)}
            ineligible={featIneligible}
            resultsFooter={(query, openDesc) => {
              const hidden = findHiddenFeatMatches({
                query,
                allFeats: listValues(ovContent, ovContent.feats),
                shownIds,
                slotEligibleIds,
                enabledBooks,
                mythicEnabled: build.mythicEnabled,
                kingmakerEnabled: build.kingmakerEnabled,
                deviantEnabled: build.deviantEnabled,
                pervasiveMagic: build.variantRules?.pervasiveMagic,
                archetypesHidden: archHidden,
              });
              if (!hidden) return null;
              const parts: string[] = [];
              if (hidden.sources.length) parts.push(`${hidden.sources.length} from disabled source books — shown below`);
              if (hidden.archetype) parts.push(`${hidden.archetype} archetype feat${hidden.archetype === 1 ? '' : 's'} — turn on “Archetypes” above`);
              if (hidden.campaign) parts.push(`${hidden.campaign} behind a Setup toggle (Mythic / Kingmaker / Deviant abilities / Pervasive Magic)`);
              // The parenthetical ENUMERATES the reasons, so it has to keep up with them. "Only at 1st
              // level" became a reason when `Feat.onlyAtLevel` shipped, and a list of three causes none
              // of which applies is the wrong-reason failure Q27 calls worse than a vague one: a
              // nephilim searching for Bestial Manifestation in a 5th-level slot was told "wrong type,
              // level too high, or already taken", and it is none of those.
              if (hidden.invalid)
                parts.push(
                  `${hidden.invalid} not valid for this slot (wrong type, wrong level — some feats can only be taken at 1st — or already taken)`,
                );
              const CAP = 20;
              return (
                <>
                  <div className="fsel-hidden-note">
                    <i className="ti ti-eye-off" aria-hidden="true" />
                    <span>
                      {hidden.total} matching feat{hidden.total === 1 ? ' is' : 's are'} hidden from this picker: {parts.join('; ')}.
                    </span>
                  </div>
                  {hidden.sources.slice(0, CAP).map((f) => {
                    const node = descNodeOf(f, 'feats');
                    return (
                      <div key={'hidden-' + f.id} className="fsel-rowwrap">
                        <PickerRow
                          lead={<span className="picker-lvl">{f.level}</span>}
                          name={f.name}
                          meta={
                            <>
                              {f.traits.length > 0 && <div className="picker-traits">{f.traits.join(' · ')}</div>}
                              <div className="picker-srcbook">
                                <i className="ti ti-book-2" aria-hidden="true" /> {f.source?.book?.trim()} — disabled source
                              </div>
                            </>
                          }
                          onOpenDesc={node ? () => openDesc(node) : undefined}
                          dim
                          selectLabel="Enable book…"
                          onSelect={() => void enableBookFor(f)}
                        />
                      </div>
                    );
                  })}
                  {hidden.sources.length > CAP && (
                    <div className="picker-more">
                      {hidden.sources.length - CAP} more from disabled sources — refine your search, or enable books in Setup → Sources.
                    </div>
                  )}
                </>
              );
            }}
            headerExtra={
              isClassSlot ? (
                <button
                  type="button"
                  className={'fsel-arch' + (showArch ? ' on' : '')}
                  title="Show multiclass & archetype feats"
                  onClick={() => setShowArch((v) => !v)}
                >
                  <i className="ti ti-arrows-shuffle" aria-hidden="true" /> Archetypes
                </button>
              ) : undefined
            }
            renderRow={(f, openDesc) => {
              const pre = checkPrerequisites(f, featPrereqChar, content);
              // A new dedication is blocked until the archetype already started is satisfied. The
              // SENTENCE is the value, not a boolean: each clause names its own count, its own
              // archetypes and its own exceptions (ruling Q25), so one fixed "two feats" line was
              // wrong for Juggler (which asks for one) and for every clause counting a sibling too.
              /* …and a feat a HERITAGE forbids outright — Jinxed Halfling's *"You can never take the
               * Halfling Luck feat"*. `checkPrerequisites` already greys the row for it, but Halfling
               * Luck prints NO prerequisites, so the "Requires (unmet)" line has nothing to render and
               * the reason fell back to a bare "Prerequisites not met." — which is the wrong sentence
               * (ruling Q27: a wrong reason is worse than a vague one). Routed through this lane, which
               * already prints its sentence both beside the row and as the disabled reason. */
              const dedBlockedWhyRow = dedBlockedWhy(f) ?? forbiddenFeatReason(f.id, featPrereqChar, content);
              const dedBlocked = !!dedBlockedWhyRow;
              // …and a feat whose grant is already used up (see noOpWhy). Same treatment as a blocked
              // dedication: dimmed, with the sentence, and still takeable through Overrides — a player
              // deliberately spending a slot on nothing is their call, not a bug to hard-block.
              const noOpWhyRow = noOpWhy(f);
              const unmet = !pre.met || dedBlocked || !!noOpWhyRow;
              // Overrides (creative editing): a feat you don't qualify for isn't dead-greyed — you can
              // "Take anyway", which records this one feat as a deliberate override (no global switch).
              // Offered ONLY when the Overrides feature is enabled; otherwise unmet feats stay blocked
              // (no hidden override state).
              const canOverride = !!build.options?.overridesEnabled;
              const allowed = build.overrides?.allowedFeats?.includes(f.id) ?? false;
              const node = descNodeOf(f, 'feats');
              // Replace: the feat in this slot NOW is marked (highlight + ✓), so the player can find it
              // and compare the others with it. test/phone-builder-shell.test.tsx.
              const isCurrent = build.featPicks?.[pickerKey] === f.id;
              return (
                <PickerRow
                  chosen={isCurrent}
                  lead={<span className="picker-lvl">{f.level}</span>}
                  // The cost belongs to the feat, so it reads beside the feat's NAME. Sitting in the
                  // lead it landed left of the level badge, where it looked like part of the level.
                  name={
                    <>
                      {f.name}
                      {isActionCost(f.actionCost) && (
                        <span className="picker-name-cost">
                          <ActionGlyph cost={f.actionCost} />
                        </span>
                      )}
                    </>
                  }
                  meta={
                    <>
                      {f.traits.length > 0 && <div className="picker-traits">{f.traits.join(' · ')}</div>}
                      {/* Only when the row is still takeable (Overrides on). Once the action is
                          disabled, PickerRow prints this same sentence as the shared reason line, and
                          two copies of it read as a rendering bug rather than emphasis. */}
                      {dedBlocked && !(unmet && !allowed && !canOverride) && (
                        <div className="picker-prereq">{dedBlockedWhyRow}</div>
                      )}
                      {f.prerequisites && f.prerequisites.length > 0 && (
                        <div className="picker-prereq">
                          {pre.met ? (
                            <>Requires: {f.prerequisites.join(', ')}</>
                          ) : (
                            // Mark WHICH clause blocks. The line printed every prerequisite in one
                            // warn colour, so failing one of several read as failing all of them —
                            // a Magaambyan attendant blocked on their branch was told they lacked
                            // the dedication they were holding. Q27: an unpickable option must say
                            // why, and a wrong reason is worse than a vague one.
                            <>
                              Requires (unmet):{' '}
                              {f.prerequisites.map((p, i) => (
                                <Fragment key={`${i}:${p}`}>
                                  {i > 0 ? ', ' : ''}
                                  <span className={pre.unmet.includes(p) ? 'prereq-unmet' : 'prereq-met'}>{p}</span>
                                </Fragment>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                      {unmet && (allowed || canOverride) && (
                        <div className="picker-override-note">
                          {allowed ? 'Allowed via override.' : 'Override: you can take this anyway, ignoring the rule.'}
                        </div>
                      )}
                    </>
                  }
                  onOpenDesc={node ? () => openDesc(node) : undefined}
                  selectLabel={
                    unmet && !allowed && canOverride ? (
                      <span className="ovr-take">
                        <i className="ti ti-alert-triangle" aria-hidden="true" /> Take anyway
                      </span>
                    ) : isCurrent ? (
                      'Chosen'
                    ) : (
                      'Choose'
                    )
                  }
                  dim={unmet && !allowed}
                  selectDisabled={unmet && !allowed && !canOverride}
                  disabledReason={
                    unmet && !allowed && !canOverride
                      ? (dedBlockedWhyRow ?? noOpWhyRow)
                        ? (dedBlockedWhyRow ?? noOpWhyRow)
                        : // The "Requires (unmet): …" line above already names them; repeat the
                          // generic sentence only when there is no such line to explain the greying.
                          f.prerequisites?.length
                          ? undefined
                          : 'Prerequisites not met.'
                      : undefined
                  }
                  onSelect={async () => {
                    if (unmet && !allowed) {
                      if (!canOverride) return;
                      // Taking a feat you don't qualify for is a deliberate rule-break — confirm it,
                      // and say exactly which prerequisite is being ignored.
                      const why = (dedBlockedWhyRow ?? noOpWhyRow)
                        ? (dedBlockedWhyRow ?? noOpWhyRow)
                        : pre.unmet.length
                          ? `Unmet: ${pre.unmet.join('; ')}`
                          : "You don't meet this feat's prerequisites.";
                      const ok = await confirmDialog({
                        title: `Take ${f.name} anyway?`,
                        message: `${why}\n\nThis records a deliberate override for this feat only. ${overrideUndoHint(isMobile, showUndoButtons)}`,
                        confirmLabel: 'Take anyway',
                        danger: true,
                      });
                      if (!ok) return;
                      actions.patch({
                        overrides: { ...build.overrides, allowedFeats: [...(build.overrides?.allowedFeats ?? []), f.id] },
                      });
                    }
                    actions.setFeat(pickerKey, f.id);
                    setPicker(null);
                  }}
                />
              );
            }}
          />
        );
      })()}

      {picker && picker.kind === 'spell' && (() => {
        // `caster: 2` targets the Dual-Class second class; every primary-coupled value below is
        // swapped for its cls2 mirror so the same picker serves both (primary path unchanged).
        const c2 = picker.caster === 2;
        // A book caster's row is its book (`cantripRowCap`) — the same cap the row and the toggle use.
        const capCantrip = c2 ? cantripRowCap2 : cantripRowCap;
        // batch 037: flexible-spellcaster#collection-shape — the collection is the second across-rank
        // pool this picker serves; `flatBudget` covers both, so neither is capped by one rank's slots.
        const capBook = c2 ? spellbookSize2 : isFlexCollection ? flexibleCollectionSize(slotCounts) : spellbookSize;
        // …and the pool's one printed restriction reaches the picker too: with no 1st-rank spell
        // collected, the last place is held for one (archetype-99), so the rows must say why.
        const floorHeldPicker = !c2 && isFlexCollection && picker.rank >= 2 && picker.rank <= 9 && !(build.spells[1] ?? []).length;
        /* batch 037: flexible-spellcaster#capstone-outside-collection — the 10th-rank slot is not one of
         * the pool's places (archetype-99), so this picker counts and caps against that ONE slot, not
         * against the collection. Only the arithmetic changes: `preparedMode` still reads `wizBook`, so
         * the pick toggles like every other collected spell. */
        const capstone = !c2 && isFlexCollection && picker.rank > 9;
        const capSlots = c2 ? slotCounts2 : slotCounts;
        const wizBook = c2 ? isWizardBook2 : flatBudget;
        const prepared = c2 ? isPrepared2 : isPrepared;
        const cantripList = c2 ? build.cantrips2 ?? [] : rowCantrips;
        const spellList = c2 ? build.spells2?.[picker.rank] ?? [] : build.spells[picker.rank] ?? [];
        const learned = c2 ? learnedTotal2 : poolSpent;
        /* A dedication's book rank offers only the ranks its Basic feat names — *"two common spells of
         * that rank"* (wizard, witch, spellshot), *"of that rank or lower"* (magus, necromancer), a hedge
         * mage's *"three common 1st-rank spells"* (2nd with Expert, 3rd with Master). */
        const bookRank = !c2 && archBook && picker.rank > 0 ? archBookRanksAt(build.level).find((r) => r.rank === picker.rank) : undefined;
        // …and never a spell another rank's page already holds: a magus's "or lower" lets 1st-rank fear be
        // added at 2nd too, which would spend a second place on a spell the book already has.
        // …nor one a RECORD already wrote into the book (a lesson's familiar spell, Expanded Necromancy's
        // grisly growths, Peer Past the Hedge's detect magic): it is there for free, and picking it again
        // would spend one of the player's places on it (checker finding 2026-10-15). The Level 0 card
        // (shared.tsx) leaves them out the same way. A grant never holds the player's own pick.
        const bookGranted = !c2 && archBook ? new Set(Object.values(archEntryBuilt?.grantedRepertoire ?? {}).flat()) : undefined;
        const elsewhere = bookRank
          ? new Set([...Object.entries(build.spells).flatMap(([r, ids]) => (Number(r) !== picker.rank ? ids ?? [] : [])), ...(bookGranted ?? [])])
          : undefined;
        const items = c2
          ? eligibleSpells2(picker.rank)
          : bookRank
            ? eligibleSpells(picker.rank).filter((s) => s.rank >= bookRank.minSpellRank && s.rank <= bookRank.maxSpellRank && !elsewhere!.has(s.id))
            : picker.rank === 0 && bookGranted
              ? eligibleSpells(0).filter((s) => !bookGranted.has(s.id))
              : eligibleSpells(picker.rank);
        // Wizards cap by the total spellbook budget; others by the rank's slot count.
        const cap_ = picker.cap ?? (picker.rank === 0 ? capCantrip : wizBook && !capstone ? capBook : capSlots[picker.rank] ?? 0);
        const have = picker.rank === 0 ? cantripList.length : wizBook && !capstone ? learned : bookRank ? new Set(spellList).size : spellList.length;
        const atCap = have >= cap_;
        const isCantrip = picker.rank === 0;
        // A book is a set — a spell is in it or not — so a dedication's book rank toggles, as a class book does.
        const preparedMode = !isCantrip && prepared && !wizBook && !(archBook && !c2);
        return (
          <FilterableSelect
            key={'spell-' + (c2 ? '2-' : '') + picker.rank}
            title={picker.rank === 0 ? 'Add cantrip' : `Add ${ord(picker.rank)}-rank spell`}
            items={items}
            spec={SPELL_SPEC_BUILDER}
            rowKey={(sp) => sp.id}
            onClose={() => setPicker(null)}
            headerExtra={
              <span className="fsel-cap" style={{ color: atCap ? 'var(--app-warn)' : undefined }}>
                {have} / {cap_}
              </span>
            }
            renderRow={(sp, openDesc) => {
              const list = isCantrip ? cantripList : spellList;
              const count = list.filter((x) => x === sp.id).length;
              const chosen = count > 0;
              const disabled = preparedMode ? atCap : !chosen && atCap;
              const node = descNodeOf(sp, 'spells');
              return (
                <PickerRow
                  lead={
                    <>
                      <span className="spell-cost">
                        <ActionGlyph cost={sp.cast} />
                      </span>
                      {preparedMode && count > 0 && <span className="picker-count">×{count}</span>}
                    </>
                  }
                  name={sp.name}
                  meta={
                    <div className="picker-traits">
                      {[sp.rank === 0 ? 'Cantrip' : `${ord(sp.rank)} rank`, ...sp.traits.slice(0, 4)].join(' · ')}
                    </div>
                  }
                  onOpenDesc={node ? () => openDesc(node) : undefined}
                  chosen={!preparedMode && chosen}
                  selectLabel={preparedMode ? 'Add' : chosen ? 'Added' : 'Add'}
                  selectDisabled={disabled}
                  // The counter in the header said "4 / 4"; the rows still read as live options and
                  // the toggle action bailed without a word. Now each says so where the press lands.
                  disabledReason={
                    disabled
                      ? isCantrip
                        ? bookWord && !c2
                          ? `Your ${bookWord} holds all ${cap_} cantrips it can — remove one first.`
                          : `All ${cap_} cantrip slots are filled — remove one first.`
                        : bookRank && archBook
                          ? `Your ${archBook.noun} holds the ${cap_} spells this rank adds — remove one first.`
                          : floorHeldPicker
                          ? 'Your collection must include at least one 1st-rank spell — the last place is held for one.'
                          : capstone ? `Your single 10th-rank slot already holds a spell — remove it first.` : `All ${cap_} spells at this rank are chosen — remove one first.`
                      : undefined
                  }
                  onSelect={() =>
                    c2
                      ? isCantrip
                        ? actions.toggleCantrip2(sp.id, capCantrip)
                        : preparedMode
                          ? actions.addSpell2(picker.rank, sp.id)
                          : actions.toggleSpell2(picker.rank, sp.id)
                      : isCantrip
                        ? writeCantrip(sp.id)
                        : preparedMode
                          ? actions.addSpell(picker.rank, sp.id)
                          : actions.toggleSpell(picker.rank, sp.id)
                  }
                />
              );
            }}
          />
        );
      })()}

      {picker && picker.kind === 'familiar-ability' && (() => {
        const comp = build.companions.find((c) => c.id === picker.companionId);
        const have = new Set(comp?.abilities ?? []);
        const list = familiarAbilityList;
        return (
          <FilterableSelect
            title="Familiar abilities"
            icon="ti-feather"
            items={list}
            spec={{ fields: [{ id: 'desc', label: 'Description', kind: 'text', accessor: (a) => a.name }] }}
            rowKey={(a) => a.id}
            onClose={() => setPicker(null)}
            headerExtra={<span className="fsel-cap">{have.size} chosen</span>}
            renderRow={(a, openDesc) => {
              const on = have.has(a.id);
              const node = descNodeOf(a, 'familiarAbilities');
              return (
                <PickerRow
                  name={a.name}
                  meta={<div className="picker-traits">{a.kind} ability</div>}
                  onOpenDesc={node ? () => openDesc(node) : undefined}
                  chosen={on}
                  selectLabel={on ? 'Added' : 'Add'}
                  onSelect={() =>
                    actions.setCompanion(picker.companionId, {
                      abilities: on
                        ? (comp?.abilities ?? []).filter((x) => x !== a.id)
                        : [...(comp?.abilities ?? []), a.id],
                    })
                  }
                />
              );
            }}
          />
        );
      })()}

    </div>
    </PinContext.Provider>
  );
}
