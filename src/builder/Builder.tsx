import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  canTakeNewDedication,
  checkPrerequisites,
  emptyBuild,
  featChoiceLabel,
  featChoicePrompt,
  buildChoiceOptions,
  levelGrants,
  levelChoices,
  subclassAnchorAt,
  backgroundGrantedFeats,
  choiceKeys,
  choiceOptionsFor,
} from '../rules/build';
import { openChoiceOptions } from '../rules/openChoice';
import { confirmDialog } from '../sheet/confirm';
import { sourceCatalog, enabledBookSet } from '../rules/sources';
import { eligibleFeatsForSlot, findHiddenFeatMatches } from '../rules/featSlots';
import { classFeatureDescription } from '../rules/featureText';
import {
  resolveBackground,
  skillIncreaseCap,
} from '../rules/build';
import { casterSlots, wizardSpellbookBudget, cantripsKnown } from '../rules/spellcasting';
import { askedAtDailyPrep, classFeatureIdsOwned, domainPoolForChoice, effectiveChoiceOptions } from '../rules/derive';
import { signaturesAt } from '../rules/build';
import { activeCasterArchetype, archetypeSlots, archetypeTraditionOptions } from '../rules/casterArchetypes';
import { FEAT_GRANTS, featUpgradesAtLevel } from '../rules/featGrants';
import { FEAT_PICK_GRANTS, pickableFeats } from '../rules/featPickGrants';
import { FEAT_FEAT_GRANTS } from '../rules/featFeatGrants';
import { spellsMatching } from '../rules/spellChoice';
import { FEAT_CANTRIP_GRANTS } from '../rules/featCantripGrants';
import type { ContentDatabase, Feat, FeatCategory, FeatChoiceDef, ProficiencyKey, ProficiencyRank, SaveId } from '../rules/types';
import { ABILITIES, PROFICIENCY_RANKS, SKILLS } from '../rules/types';
import { AbilitySelect, CampaignAttachCard, CampaignOptionsCard, ChoiceDetails, FormulaBookCard, FullStats, LanguageEditor, OptionsCard, OriginPickers, OverridesCard, PopupSelect, SearchSelect, SetupCard, SetupUnlockedChoices, SnareFormulasCard, SourcesCard, EffectChoicesPicker, SkillEditor, AttributeEditor, SubCard, VariantRulesCard, cap, loreKey, loreLabel, useBuilderActions } from './shared';
import { hasSnareCrafting } from '../rules/snareFormulas';
import { formulaSlots } from '../rules/formulaBook';
import { FilterableSelect, PickerRow, descNodeOf } from '../sheet/FilterableSelect';
import { DescriptionModal } from '../sheet/DescriptionModal';
import type { DescNode } from '../sheet/descref';
import { ActionGlyph, isActionCost } from '../sheet/widgets';
import { SPELL_SPEC_BUILDER, FEAT_SPEC } from '../sheet/filterSpecs';
import { useIsMobile } from '../sheet/useIsMobile';
import { PinContext, type PinDescApi } from '../sheet/PinContext';
import { WindowControls } from '../sheet/WindowControls';
import { useUndoableState } from '../useUndoableState';
import { claimUndo } from '../undoClaim';
import { descId } from '../rules/play';

const FEAT_LABEL: Record<FeatCategory, string> = {
  ancestry: 'Ancestry feat',
  heritage: 'Heritage',
  class: 'Class feat',
  skill: 'Skill feat',
  general: 'General feat',
  archetype: 'Archetype feat',
  bonus: 'Bonus feat',
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

const ord = (r: number) => (r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`);

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
  // Mobile: the live "Character" stat preview collapses behind a chevron to reclaim builder space.
  const [statsOpen, setStatsOpen] = useState(false);
  // When lowering the level would drop choices already made at that level, confirm first.
  // Holds the level we'd lower TO (= current level − 1), or null when no prompt is open.
  const [confirmLowerTo, setConfirmLowerTo] = useState<number | null>(null);
  useEffect(() => setShowArch(false), [picker]);

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
      has: (node) => list.some((d) => descId(d) === descId(node)),
      toggle: (node) => {
        const id = descId(node);
        const next = list.some((d) => descId(d) === id)
          ? list.filter((d) => descId(d) !== id)
          : [...list, { title: node.title, description: node.description, descRefs: node.descRefs, key: node.key }];
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
    const rest: typeof build.skillIncreases = {};
    for (const [lvl, key] of Object.entries(build.skillIncreases)) if (Number(lvl) < sel) rest[Number(lvl)] = key;
    return buildCharacter({ ...build, skillIncreases: rest }, content).proficiencies.skills;
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
  const castType = casting?.type ?? (archCaster?.config.repertoire ? 'spontaneous' : 'prepared');
  // For a choice-tradition archetype (sorcerer/witch), the player's pick; for a summoner archetype, the
  // chosen eidolon type's tradition; else the dedication's fixed tradition.
  const archTradition = archCaster
    ? archCaster.config.eidolonTradition
      ? content.classes.summoner?.subclass?.options.find((o) => o.id === build.archetypeEidolonType)?.tradition ??
        archCaster.config.tradition
      : archCaster.config.choiceTradition
        ? build.archetypeTradition ?? archCaster.config.tradition
        : archCaster.config.tradition
    : undefined;
  const tradition = subOption?.tradition ?? casting?.tradition ?? archTradition;
  const isPrepared = castType === 'prepared';
  // Spontaneous casters can designate signature spells once the class grants the
  // feature (e.g. bard at level 3).
  const sigAvailable =
    casting?.type === 'spontaneous' &&
    !!casterCls?.features?.some((f) => f.featureId === 'signature-spells' && f.level <= build.level);
  // Wizards and witches are LEARNED prepared casters: they learn a SPELLBOOK (a single budget across
  // ranks — the wizard's book, the witch's familiar) and can prepare only from it.
  const isWizardBook = !!casting && isPrepared && (casterCls?.id === 'wizard' || casterCls?.id === 'witch');
  // Wizard School of Unified Magical Theory (Player Core): "you add one 1st-rank spell of your choice
  // to your spellbook" — a larger initial spellbook. Applies as a flat +1 to the across-rank budget.
  const isUmtBook = casterCls?.id === 'wizard' && subOption?.id === 'school-of-unified-magical-theory';
  const spellbookSize = wizardSpellbookBudget(build.level, isUmtBook);
  const learnedTotal = Object.values(build.spells).reduce((n, arr) => n + arr.length, 0);
  const slotCounts = casting
    ? casterSlots(build.level, castProgression)
    : archCaster
      ? archetypeSlots(build.level, archCaster)
      : {};
  // Cantrip Expansion and its kin raise this. Without the same bonus here the extra cantrips exist on
  // the sheet and the builder gives the player no slot in which to choose them.
  const cantripBonus = [
    ...Object.values(build.featPicks ?? {}).filter(Boolean).map((id) => content.feats[id as string]),
    ...[...classFeatureIdsOwned({ classId: build.classId, subclassId: build.subclassId, level: build.level }, content)].map(
      (id) => content.classFeatures[id],
    ),
  ].reduce((n, r) => n + (r?.spellSlotBonus?.cantrips ?? 0), 0);
  const cantripCap = (casting ? cantripsKnown(build.classId) : archCaster?.config.cantrips ?? 0) + cantripBonus;
  // The built character, used to evaluate feat prerequisites in the picker and the stats rail.
  // Memoized so the full per-level build pipeline runs once per build change, not 2–3× per render.
  const featPrereqChar = useMemo(() => buildCharacter(build, ovContent), [build, ovContent]);

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
                              // Annotated because the branches inside buildChoiceOptions are structurally
                              // different and the generic in choiceOptionsFor would otherwise narrow away `label`.
                              const opts: { value: string; label: string; description?: string }[] =
                                buildChoiceOptions(recordId, def, build, content, featPrereqChar, key);
                              return (
                                <SubCard icon="ti-adjustments" label={featChoicePrompt(def.prompt, def.flag)}>
                                  {def.kind === 'text' ? (
                                    // No option list exists for these (Kingdom skills, leadership roles):
                                    // the app has no Kingmaker data, and typing one from memory would be
                                    // inventing content. The player supplies the word; we record it.
                                    <input
                                      className="txt"
                                      type="text"
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
                                      const all = openChoiceOptions(def.from, content, { hideLegacy: build.hideLegacy, character: featPrereqChar });
                                      return keys.map((k, i) => {
                                        const answers = keys.map((kk) => build.featChoices[kk]);
                                        const taken = new Set(def.distinct ? answers.filter((a, j) => j !== i && a) : []);
                                        return (
                                          <SearchSelect
                                            key={k}
                                            bare
                                            label={featChoicePrompt(def.prompt, def.flag)}
                                            placeholder={`Search ${def.from?.type ?? 'options'}…`}
                                            value={build.featChoices[k] ?? null}
                                            onChange={(v) => actions.setFeatChoice(k, v)}
                                            options={all.filter((o) => !taken.has(o.id))}
                                          />
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
                                          options={choiceOptionsFor(opts, def, answers, i).map((o) => ({
                                            value: o.value,
                                            label: featChoiceLabel(o.label),
                                            description: (o as { description?: string }).description,
                                          }))}
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
   */
  const grantedChoicePicker = (grantedId: string) => {
    const def = content.feats[grantedId]?.choice;
    if (!def) return null;
    const opts =
      def.kind === 'domains'
        ? domainPoolForChoice(build, content, grantedId, def.domainPool).map((d) => ({ value: d, label: cap(d) }))
        : def.kind === 'skills'
          ? SKILLS.map((s) => ({ value: s, label: cap(s) }))
          : // A granted feat's menu can be widened by another record just like a picked one's — the
            // widening is addressed by record id, and a granted feat has the same id either way.
            effectiveChoiceOptions(grantedId, def, featPrereqChar, content);
    if (!opts.length) return null;
    const label = `${content.feats[grantedId]!.name}: ${featChoicePrompt(def.prompt)}`;
    return (
      <SubCard key={`gfc-${grantedId}`} icon="ti-adjustments" label={label}>
        <PopupSelect
          title={featChoicePrompt(def.prompt)}
          placeholder={`${featChoicePrompt(def.prompt)}…`}
          value={build.grantedFeatChoices?.[grantedId] ?? ''}
          onChange={(v) => actions.patch({ grantedFeatChoices: { ...(build.grantedFeatChoices ?? {}), [grantedId]: v } })}
          options={opts.map((o) => ({ value: o.value, label: featChoiceLabel(o.label) }))}
        />
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
  const listAdditions = useMemo(() => {
    const out = new Set<string>();
    // A widening may name whole TRADITIONS rather than spells — "one spell in your spell repertoire
    // not on the divine spell list" (Mysterious Repertoire). Expanded here, in a memo, rather than
    // onto the character, where it would be ~1,500 ids in every saved roster entry.
    const openTraditions = new Set<string>();
    let anyTradition = false;
    for (const featId of Object.values(build.featPicks ?? {})) {
      const list = featId ? content.feats[featId]?.spellListAdditions : undefined;
      for (const add of list == null ? [] : Array.isArray(list) ? list : [list]) {
        // Only the plain list-widening lane belongs in this picker — 'repertoire' and 'font' grants
        // are applied by buildCharacter and are not the player's to choose here.
        if (add.as && add.as !== 'list') continue;
        for (const s of add.spells ?? []) if (content.spells[s]) out.add(s);
        // "Add up to three of your deity's spells to your spell list" — resolved from the build's own
        // deity, so the picker offers the right three the moment the player picks a deity.
        if (add.from === 'deity' && build.deityId)
          for (const s of content.deities[build.deityId]?.spells ?? []) if (content.spells[s]) out.add(s);
        if (add.traditions === 'any') anyTradition = true;
        else for (const t of add.traditions ?? []) openTraditions.add(t);
      }
    }
    if (anyTradition || openTraditions.size) {
      for (const s of Object.values(content.spells)) {
        if (s.ritual) continue;
        if (anyTradition || (s.traditions ?? []).some((t) => openTraditions.has(t))) out.add(s.id);
      }
    }
    return out;
  }, [build.featPicks, build.deityId, content]);
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
  const eligibleSpells = (rank: number) => {
    if (!tradition) return NO_SPELLS;
    let base = rank === 0 ? spellIndex.cantrips[tradition] ?? NO_SPELLS : spellIndex.upTo[tradition]?.[rank] ?? NO_SPELLS;
    if (listReplacement) {
      // The replaced list is not a subset of the tradition — an inner sea elementalist wizard gets
      // primal water spells — so it is rebuilt from the whole spell set, not filtered out of `base`.
      const pool = Object.values(content.spells).filter(
        (s) => (rank === 0 ? s.rank === 0 : s.rank > 0 && s.rank <= rank) && onReplacedList(s as Sp),
      ) as Sp[];
      base = pool.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    }
    if (!listAdditions.size) return base;
    const have = new Set(base.map((s) => s.id));
    const extra = [...listAdditions]
      .map((id) => content.spells[id])
      .filter((s): s is Sp => !!s && !have.has(s.id) && (rank === 0 ? s.rank === 0 : s.rank > 0 && s.rank <= rank));
    return extra.length ? [...base, ...extra].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)) : base;
  };
  // ── Dual Class: the SECOND caster's spell surface (writes cantrips2/spells2/signatures2). Only when
  //    the dual-class variant is on AND the second class is itself a slot caster. These mirror the
  //    primary caster derivations above, and feed the consolidated "Second class spells" card + the
  //    caster:2 branch of the spell picker. The primary path never reads these. ──
  const cls2 = build.variantRules?.dualClass && build.classId2 ? content.classes[build.classId2] : undefined;
  const casting2 = cls2?.spellcasting;
  const subOption2 = cls2?.subclass?.options.find((o) => o.id === build.subclassId2);
  const showSpells2 = !!casting2;
  const castProgression2 = subOption2?.slotProgression ?? casting2?.progression;
  const castType2 = casting2?.type ?? 'prepared';
  const tradition2 = subOption2?.tradition ?? casting2?.tradition;
  const isPrepared2 = castType2 === 'prepared';
  const sigAvailable2 =
    casting2?.type === 'spontaneous' &&
    !!cls2?.features?.some((f) => f.featureId === 'signature-spells' && f.level <= build.level);
  const isWizardBook2 = !!casting2 && isPrepared2 && (cls2?.id === 'wizard' || cls2?.id === 'witch');
  const isUmtBook2 = cls2?.id === 'wizard' && subOption2?.id === 'school-of-unified-magical-theory';
  const spellbookSize2 = wizardSpellbookBudget(build.level, isUmtBook2);
  const slotCounts2 = casting2 ? casterSlots(build.level, castProgression2) : {};
  const cantripCap2 = casting2 && build.classId2 ? cantripsKnown(build.classId2) : 0;
  const learnedTotal2 = Object.values(build.spells2 ?? {}).reduce((n, arr) => n + arr.length, 0);
  const eligibleSpells2 = (rank: number) => {
    if (!tradition2) return NO_SPELLS;
    return rank === 0 ? spellIndex.cantrips[tradition2] ?? NO_SPELLS : spellIndex.upTo[tradition2]?.[rank] ?? NO_SPELLS;
  };
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
        .map((f) => ({ value: f.id, label: f.name, description: f.description })),
    [content.feats],
  );
  const isUmtSchool = build.classId === 'wizard' && build.subclassId === 'school-of-unified-magical-theory';
  // Skill feats — option list for a dedication's bonus skill feat (Rogue Dedication).
  const skillFeatOpts = useMemo(
    () =>
      listValues(content, content.feats)
        .filter((f) => f.category === 'skill')
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
        .map((f) => ({ value: f.id, label: f.name, description: f.description })),
    [content.feats],
  );

  // --- per-level spell progression (spells are chosen on the level where they're gained) ---
  // Spell slots per rank at a given character level (0 = before play).
  const slotsAt = (L: number): Record<number, number> =>
    L < 1 ? {} : casting ? casterSlots(L, castProgression) : archCaster ? archetypeSlots(L, archCaster) : {};
  // Wizard spellbook budget (a single across-rank total) at a given level — includes the UMT +1.
  const bookAt = (L: number) => (L < 1 ? 0 : wizardSpellbookBudget(L, isUmtBook));
  // The first level this character can cast — cantrips, tradition, and divine font live here.
  const firstCasterLevel = (() => {
    if (!showSpells) return 0;
    for (let L = 1; L <= 20; L++) if (cantripCap > 0 || Object.keys(slotsAt(L)).length) return L;
    return 1;
  })();
  // What spell capacity is GAINED at level L (vs the level before) — drives the per-level pickers.
  const spellGainsAt = (L: number) => {
    const cur = slotsAt(L);
    const prev = slotsAt(L - 1);
    const ranks = [...new Set([...Object.keys(cur), ...Object.keys(prev)].map(Number))]
      .filter((r) => r >= 1 && (cur[r] ?? 0) > (prev[r] ?? 0))
      .sort((a, b) => a - b)
      .map((r) => ({ rank: r, gained: (cur[r] ?? 0) - (prev[r] ?? 0), cap: cur[r] ?? 0 }));
    return {
      ranks,
      bookGained: isWizardBook ? bookAt(L) - bookAt(L - 1) : 0,
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
              <span>Cantrips</span>
              <span className="spr-count">
                {build.cantrips.length} / {cantripCap}
              </span>
            </div>
            <div className="spr-chips">
              {build.cantrips.map((id) => (
                <span className="spr-chip" key={id}>
                  {content.spells[id]?.name ?? id}
                  <button type="button" className="spr-chip-x" aria-label={`Remove ${content.spells[id]?.name ?? id}`} onClick={() => actions.toggleCantrip(id)}>
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </span>
              ))}
              {/* Disabled at the cap, like every other "+ add" on this rail. Without it the button
                  opened a picker in which nothing could be added — `toggleCantrip` bails at the cap. */}
              <button
                className="spr-add"
                type="button"
                disabled={build.cantrips.length >= cantripCap}
                title={build.cantrips.length >= cantripCap ? `All ${cantripCap} cantrip slots are filled — remove one first.` : undefined}
                onClick={() => setPicker({ kind: 'spell', rank: 0, cap: cantripCap })}
              >
                + add
              </button>
            </div>
          </div>
        )}
        {isWizardBook && g.bookGained > 0 && (
          <>
            <div className="bsec-sub">
              Spellbook — {learnedTotal} / {bookAt(lvl)} learned (+{g.bookGained} this level)
            </div>
            {Object.keys(slotsAt(lvl))
              .map(Number)
              .filter((r) => r >= 1)
              .sort((a, b) => a - b)
              .map((rank) => {
                const chosen = build.spells[rank] ?? [];
                return (
                  <div className="spell-pick-row" key={rank}>
                    <div className="spr-head">
                      <span>{ord(rank)} rank</span>
                      <span className="spr-count">{chosen.length} learned</span>
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
                      <button className="spr-add" type="button" disabled={learnedTotal >= bookAt(lvl)} title={learnedTotal >= bookAt(lvl) ? `Your spellbook holds all ${bookAt(lvl)} spells it can at this level.` : undefined} onClick={() => setPicker({ kind: 'spell', rank, cap: bookAt(lvl) })}>
                        + add
                      </button>
                    </div>
                  </div>
                );
              })}
          </>
        )}
        {!isWizardBook &&
          g.ranks.map(({ rank, gained, cap: capR }) => {
            const chosen = build.spells[rank] ?? [];
            return (
              <div className="spell-pick-row" key={rank}>
                <div className="spr-head">
                  <span>{ord(rank)} rank</span>
                  <span className="spr-count">
                    {chosen.length} / {capR} {castType === 'prepared' ? 'prepared' : 'known'} (+{gained} this level)
                  </span>
                </div>
                <div className="spr-chips">
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
                  <button className="spr-add" type="button" disabled={chosen.length >= capR} title={chosen.length >= capR ? `All ${capR} spells at this rank are chosen — remove one first.` : undefined} onClick={() => setPicker({ kind: 'spell', rank, cap: capR })}>
                    + add
                  </button>
                </div>
              </div>
            );
          })}
      </div>
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
        {cantripCap2 > 0 && (
          <div className="spell-pick-row">
            <div className="spr-head">
              <span>Cantrips</span>
              <span className="spr-count">
                {cantrips2.length} / {cantripCap2}
              </span>
            </div>
            <div className="spr-chips">
              {cantrips2.map((id) => (
                <span className="spr-chip" key={id}>
                  {content.spells[id]?.name ?? id}
                  <button type="button" className="spr-chip-x" aria-label={`Remove ${content.spells[id]?.name ?? id}`} onClick={() => actions.toggleCantrip2(id)}>
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <button className="spr-add" type="button" onClick={() => setPicker({ kind: 'spell', rank: 0, cap: cantripCap2, caster: 2 })}>
                + add
              </button>
            </div>
          </div>
        )}
        {isWizardBook2 && <div className="bsec-sub">Spellbook — {learnedTotal2} / {spellbookSize2} learned</div>}
        {ranksWithSlots.map((rank) => {
          const chosen = build.spells2?.[rank] ?? [];
          const capR = isWizardBook2 ? spellbookSize2 : slotCounts2[rank] ?? 0;
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
                <button className="spr-add" type="button" disabled={have >= capR} title={have >= capR ? `All ${capR} spells at this rank are chosen — remove one first.` : undefined} onClick={() => setPicker({ kind: 'spell', rank, cap: capR, caster: 2 })}>
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
            onClick={() => {
              // Lowering drops the current top level. Confirm if any choice (feat, skill, boost, or
              // chosen spells of a rank/cantrip gained there) was made there.
              if (hasChoicesAtLevel(build, build.level) || spellsDropAt(build.level)) setConfirmLowerTo(build.level - 1);
              else actions.bumpLevel(-1);
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
        <button className="b-cancel" onClick={onCancel}>
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

      <div className="builder-body">
        <div className="bmain">
          {sel === 'setup' && (
            <div className="card-sec">
              <div className="bsec-title">Setup</div>
              <div className="setup-note">Campaign options — optional variant rules for this character.</div>
              <div className="lvl-cards">
                <CampaignAttachCard build={build} actions={actions} content={content} onLeaveCampaign={onLeaveCampaign} />
                <OptionsCard build={build} actions={actions} content={content} />
                <VariantRulesCard build={build} actions={actions} content={content} />
                <CampaignOptionsCard build={build} actions={actions} content={content} />
                <SourcesCard build={build} actions={actions} catalog={sourceCat} content={ovContent} />
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
                    <LanguageEditor build={build} actions={actions} content={content} />
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
                      <SetupUnlockedChoices build={build} actions={actions} content={content} />
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
              const g = levelGrants(lvl, build.classId, content, build.subclassId, build.variantRules, build.classId2, build.subclassId2, build.mythicEnabled, Object.values(build.featPicks ?? {}).filter(Boolean) as string[]);
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
                                <ChoiceDetails name={nm} flavor={ft?.description} descRefs={ft?.descRefs} />
                                {/* Its own sub-choice (Abadar's Avenger grants "Assurance with Religion")
                                    is asked in the choice zone below, not here. */}
                                {!!ft?.choice && <div className="lvl-gain-asks">Asks you to choose — see below</div>}
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
                    {(askingFeatures.length > 0 || askingGrantedFeats.length > 0) && (
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
                                const opts = pickableFeats(spec, build, content).map((o) => ({ value: o.id, label: o.name, description: o.description }));
                                return (
                                  <PopupSelect
                                    title={spec.prompt}
                                    placeholder={`${spec.prompt}…`}
                                    value={build.pickFeatChoices?.[f.id] ?? ''}
                                    onChange={(v) => actions.patch({ pickFeatChoices: { ...(build.pickFeatChoices ?? {}), [f.id]: v } })}
                                    options={opts}
                                  />
                                );
                              })()}
                            </SubCard>
                          ))}
                          {askingGrantedFeats.map((gid) => (
                            <SubCard icon="ti-star" label={content.feats[gid]?.name ?? gid} key={`askf-${gid}`}>
                              {grantedChoicePicker(gid)}
                            </SubCard>
                          ))}
                        </div>
                      </div>
                    )}
                    {(!!(cls?.subclass && subAnchorId) || g.featSlots.length > 0) && (
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
                                  onChange={(v) => actions.changeSubclass(v)}
                                  options={cls.subclass.options.map((o) => ({ value: o.id, label: o.name, description: o.description, descRefs: o.descRefs }))}
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
                            const opts = pickableFeats(spec, build, content).map((o) => ({ value: o.id, label: o.name, description: o.description }));
                            return (
                              <SubCard icon="ti-medal" label={spec.prompt}>
                                <PopupSelect
                                  title={spec.prompt}
                                  placeholder={`${spec.prompt}…`}
                                  value={build.pickFeatChoices?.[sid] ?? ''}
                                  onChange={(v) => actions.patch({ pickFeatChoices: { ...(build.pickFeatChoices ?? {}), [sid]: v } })}
                                  options={opts}
                                />
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
                          {subAnchorId &&
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
                              return [...new Set(featPrereqChar.feats.filter((f) => f.grantedBy).map((f) => f.featId))]
                                .filter((gid) => !handled.has(gid) && content.feats[gid]?.choice)
                                .map((gid) => grantedChoicePicker(gid));
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
                      return (
                        <div className="lvl-slot-wrap" key={key}>
                          <div className="lvl-slot">
                            <button
                              // A FILLED slot: clicking shows the feat's description (toggle); use the
                              // Replace button to swap it. An EMPTY slot: clicking opens the picker.
                              className={'lvl-card' + (picked ? '' : ' empty')}
                              type="button"
                              title={picked ? 'Show description' : undefined}
                              onClick={() => {
                                if (!picked) return setPicker({ kind: 'feat', level: lvl, category: catg, idx: i });
                                const f = content.feats[picked];
                                if (f?.description) setFeatDescPopup({ title: f.name, description: f.description, descRefs: f.descRefs, key: 'feats' });
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
                            (FEAT_GRANTS[picked]?.skillChoices ?? []).map((slot, si) => {
                              const opts = slot.options === 'any' ? SKILLS : slot.options;
                              const skKey = `${picked}:${si}`;
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
                                return (
                                  <SubCard key={fbKey} icon="ti-bulb" label={`Already trained in ${cap(fb.skill)} — replacement skill`}>
                                    <PopupSelect
                                      title="Replacement skill"
                                      placeholder="Choose a skill…"
                                      value={build.featSkillChoices?.[fbKey] ?? ''}
                                      onChange={(v) =>
                                        actions.patch({
                                          featSkillChoices: { ...(build.featSkillChoices ?? {}), [fbKey]: v as (typeof SKILLS)[number] },
                                        })
                                      }
                                      // The replacement grants "trained", through maxRank — so every
                                      // skill the character already has is a second dead end, and this
                                      // picker (offered precisely BECAUSE one grant was redundant) used
                                      // to list all sixteen of them as live.
                                      options={SKILLS.map((s) => {
                                        const cur = featPrereqChar.proficiencies.skills[s] ?? 'untrained';
                                        const dead = s !== build.featSkillChoices?.[fbKey] && cur !== 'untrained';
                                        return {
                                          value: s,
                                          label: cap(s),
                                          disabled: dead,
                                          disabledReason: dead ? `Already ${cur} — pick a skill you are untrained in.` : undefined,
                                        };
                                      })}
                                    />
                                  </SubCard>
                                );
                              })}
                          {picked &&
                            Array.from({ length: FEAT_GRANTS[picked]?.loreChoices ?? 0 }).map((_, li) => {
                              const loreKey2 = `${picked}:${li}`;
                              return (
                                <SubCard key={`lore-${loreKey2}`} icon="ti-bulb" label="Trained Lore">
                                  <input
                                    className="lvl-lore-input"
                                    placeholder="Lore subject (e.g. Warfare)…"
                                    value={build.featLoreChoices?.[loreKey2] ?? ''}
                                    onChange={(e) => actions.patch({ featLoreChoices: { ...(build.featLoreChoices ?? {}), [loreKey2]: e.target.value } })}
                                  />
                                </SubCard>
                              );
                            })}
                          {picked && FEAT_GRANTS[picked]?.bonusSkillFeat && (
                            <SubCard icon="ti-medal" label="Bonus skill feat">
                              <PopupSelect
                                title="Bonus skill feat"
                                placeholder="Choose a skill feat…"
                                value={build.dedicationSkillFeats?.[picked] ?? ''}
                                onChange={(v) =>
                                  actions.patch({
                                    dedicationSkillFeats: { ...(build.dedicationSkillFeats ?? {}), [picked]: v },
                                  })
                                }
                                options={skillFeatOpts}
                              />
                            </SubCard>
                          )}
                          {/* Pick-a-feat grants (General Training, Basic Maneuver, Natural Ambition, …):
                              the player chooses a bonus feat from the grant's filtered pool. */}
                          {picked &&
                            FEAT_PICK_GRANTS[picked] &&
                            (() => {
                              const spec = FEAT_PICK_GRANTS[picked];
                              const opts = pickableFeats(spec, build, content).map((f) => ({ value: f.id, label: f.name, description: f.description }));
                              // Stored per SLOT, so a repeatable grant taken twice shows two pickers
                              // rather than two views of one answer. The bare feat-id key is still
                              // READ, so a character saved before this keeps the pick it had.
                              const cur = build.pickFeatChoices?.[key] ?? build.pickFeatChoices?.[picked] ?? '';
                              return (
                                <SubCard icon="ti-medal" label={spec.prompt}>
                                  <PopupSelect
                                    title={spec.prompt}
                                    placeholder={`${spec.prompt}…`}
                                    value={cur}
                                    onChange={(v) => actions.patch({ pickFeatChoices: { ...(build.pickFeatChoices ?? {}), [key]: v } })}
                                    options={opts}
                                  />
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
                            (content.feats[picked]?.effectChoices ?? []).map((ch) => {
                              const ecKey = `${picked}:${ch.id}`;
                              const set = (v: string) => actions.patch({ effectChoices: { ...(build.effectChoices ?? {}), [ecKey]: v } });
                              // An OPEN pick ("any 1st-rank arcane spell") gets a searchable spell list;
                              // a fixed set gets the plain dropdown. Hidden until its unlock level.
                              if (ch.spellFilter) {
                                if (build.level < (ch.spellFilter.minLevel ?? 1)) return null;
                                const opts = spellsMatching(ch.spellFilter, content, build.hideLegacy).map((s) => ({
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
                                    // An option may carry a note instead of a grant (a kineticist gate
                                    // junction: only Elemental Resistance moves a stat). Show the note as
                                    // the description so the player can read each option before picking.
                                    options={(ch.options ?? []).map((o) => ({ value: o.value, label: o.label, description: o.note }))}
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
                                .map((s) => ({ value: s.id, label: s.name, description: s.description }));
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
                                        disabled: atAbsoluteMax || !allowedByLevel,
                                        // The greying was already right; only the reason was missing.
                                        disabledReason: atAbsoluteMax
                                          ? 'Already legendary — nothing left to increase.'
                                          : !allowedByLevel
                                            ? `This level's increases cap at ${skillIncreaseCap(lvl)}.`
                                            : undefined,
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
            {isMobile && (
              <button
                type="button"
                className="brail-toggle"
                aria-label={statsOpen ? 'Hide character stats' : 'Show character stats'}
                aria-expanded={statsOpen}
                onClick={() => setStatsOpen((o) => !o)}
              >
                <i className={'ti ' + (statsOpen ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
              </button>
            )}
            Character
          </div>
          {(!isMobile || statsOpen) && <FullStats build={build} content={content} character={featPrereqChar} />}
        </aside>
      </div>

      {featDescPopup && <DescriptionModal root={featDescPopup} onClose={() => setFeatDescPopup(null)} />}

      {picker && picker.kind === 'feat' && (() => {
        const isClassSlot = picker.category === 'class';
        // The "two feats before a new dedication" rule — taken feats excluding this slot.
        const pickerKey = slotKey(picker.level, picker.category, picker.idx);
        const takenForRule = Object.entries(build.featPicks)
          .filter(([k, v]) => v && k !== pickerKey)
          .map(([, v]) => v);
        const dedicationOK = canTakeNewDedication(takenForRule, content);
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
        // "Hide ineligible" filter predicate — mirrors the row's unmet/allowed logic below.
        const featIneligible = (f: Feat) => {
          if (build.overrides?.allowedFeats?.includes(f.id)) return false;
          if (f.traits.includes('dedication') && !dedicationOK) return true;
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
          if (ok) actions.patch({ enabledSources: [...new Set([...enabledBooks, book])].sort() });
        };
        return (
          <FilterableSelect
            title={`Choose a ${FEAT_LABEL[picker.category].toLowerCase()}`}
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
              if (hidden.invalid) parts.push(`${hidden.invalid} not valid for this slot (wrong type, level too high, or already taken)`);
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
              // A new dedication is blocked until current archetypes have 2 feats each.
              const dedBlocked = f.traits.includes('dedication') && !dedicationOK;
              const unmet = !pre.met || dedBlocked;
              // Overrides (creative editing): a feat you don't qualify for isn't dead-greyed — you can
              // "Take anyway", which records this one feat as a deliberate override (no global switch).
              // Offered ONLY when the Overrides feature is enabled; otherwise unmet feats stay blocked
              // (no hidden override state).
              const canOverride = !!build.options?.overridesEnabled;
              const allowed = build.overrides?.allowedFeats?.includes(f.id) ?? false;
              const node = descNodeOf(f, 'feats');
              return (
                <PickerRow
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
                        <div className="picker-prereq">Take two feats from your current archetype first.</div>
                      )}
                      {f.prerequisites && f.prerequisites.length > 0 && (
                        <div className="picker-prereq">
                          {pre.met ? 'Requires: ' : 'Requires (unmet): '}
                          {f.prerequisites.join(', ')}
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
                    ) : (
                      'Choose'
                    )
                  }
                  dim={unmet && !allowed}
                  selectDisabled={unmet && !allowed && !canOverride}
                  disabledReason={
                    unmet && !allowed && !canOverride
                      ? dedBlocked
                        ? 'Take two feats from your current archetype first.'
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
                      const why = dedBlocked
                        ? 'You need two feats from your current archetype before taking another dedication.'
                        : pre.unmet.length
                          ? `Unmet: ${pre.unmet.join('; ')}`
                          : "You don't meet this feat's prerequisites.";
                      const ok = await confirmDialog({
                        title: `Take ${f.name} anyway?`,
                        message: `${why}\n\nThis records a deliberate override for this feat only. You can undo with Ctrl+Z.`,
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
        const capCantrip = c2 ? cantripCap2 : cantripCap;
        const capBook = c2 ? spellbookSize2 : spellbookSize;
        const capSlots = c2 ? slotCounts2 : slotCounts;
        const wizBook = c2 ? isWizardBook2 : isWizardBook;
        const prepared = c2 ? isPrepared2 : isPrepared;
        const cantripList = c2 ? build.cantrips2 ?? [] : build.cantrips;
        const spellList = c2 ? build.spells2?.[picker.rank] ?? [] : build.spells[picker.rank] ?? [];
        const learned = c2 ? learnedTotal2 : learnedTotal;
        const items = c2 ? eligibleSpells2(picker.rank) : eligibleSpells(picker.rank);
        // Wizards cap by the total spellbook budget; others by the rank's slot count.
        const cap_ = picker.cap ?? (picker.rank === 0 ? capCantrip : wizBook ? capBook : capSlots[picker.rank] ?? 0);
        const have = picker.rank === 0 ? cantripList.length : wizBook ? learned : spellList.length;
        const atCap = have >= cap_;
        const isCantrip = picker.rank === 0;
        const preparedMode = !isCantrip && prepared && !wizBook;
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
                        ? `All ${cap_} cantrip slots are filled — remove one first.`
                        : `All ${cap_} spells at this rank are chosen — remove one first.`
                      : undefined
                  }
                  onSelect={() =>
                    c2
                      ? isCantrip
                        ? actions.toggleCantrip2(sp.id)
                        : preparedMode
                          ? actions.addSpell2(picker.rank, sp.id)
                          : actions.toggleSpell2(picker.rank, sp.id)
                      : isCantrip
                        ? actions.toggleCantrip(sp.id)
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

      {confirmLowerTo != null && (
        <div className="picker-overlay" onClick={() => setConfirmLowerTo(null)}>
          <div className="picker confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span>
                <i className="ti ti-alert-triangle" aria-hidden="true" /> Lower level?
              </span>
              <button className="picker-close" onClick={() => setConfirmLowerTo(null)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <div className="confirm-body">
              <p>
                You&apos;ve made choices at <strong>level {confirmLowerTo + 1}</strong> (a feat, skill increase,
                attribute boost, or chosen spells). Lowering to <strong>level {confirmLowerTo}</strong> stops applying them.
              </p>
              <p>They&apos;re kept and will reapply if you raise the level again.</p>
            </div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmLowerTo(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  actions.setLevel(confirmLowerTo);
                  setConfirmLowerTo(null);
                }}
              >
                Lower to level {confirmLowerTo}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </PinContext.Provider>
  );
}
