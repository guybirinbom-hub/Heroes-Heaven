import { useMemo, useState, type ReactNode } from 'react';
import { listValues } from '../data';
import type { ActionCost, Character, ContentDatabase, DescRef, LimitedUses, PinnedDesc, ProficiencyKey } from '../rules/types';
import { ABILITIES, SKILLS } from '../rules/types';
import {
  abilityMod,
  deriveArmorCheckPenalty,
  deriveSkill,
  dailySkillRank,
  ownedFeatureIds,
  deriveStrikes,
  formatMod,
  critSpecSources,
  strikeShowsCritSpec,
  skillTakesArmorPenalty,
  strikesBlockedBy,
  type Strike,
} from '../rules/derive';
import { togglePin, togglePinnedDesc, toggleTactic, setActiveStance, toggleMode, descId, type PlayUpdater } from '../rules/play';
import { resourcesForCharacter } from '../rules/classResources';
import { featUse, spendFeatUse, refundFeatUse } from '../rules/featUses';
import { actionGate, gateLabel, type ResourceGate } from '../rules/actionGates';
import { AlchemyPanel } from './AlchemyPanel';
import { critSpec } from '../rules/critSpec';
import { ACTIVITIES, type ActivityDef } from '../rules/actions';
import { traitDesc } from '../rules/glossary';
import { markTooltip, recordMarkersFor, statHasSituational, statMarkClass, type StatRef } from '../rules/explain';
import { stanceRequirementIssue } from '../rules/derive';
import { ActionGlyph, RankPill, SituationalStar } from './widgets';
import { DescriptionModal } from './DescriptionModal';
import { DescBody } from './DescBody';
import { toPlainText } from './RichText';
import { StrikeDetailModal } from './StrikeDetailModal';
import { CritSpecText } from './CritSpecText';
import { InfoTerm } from './InfoTerm';
import { useEscapeClose } from './useEscapeClose';
import { useCustomization } from '../data/customization';
import type { DescNode } from './descref';

const capWord = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const ABILITY_LABEL: Record<string, string> = {
  str: 'Str',
  dex: 'Dex',
  con: 'Con',
  int: 'Int',
  wis: 'Wis',
  cha: 'Cha',
};

const MODES = [
  { id: 'enc', name: 'Encounter' },
  { id: 'exp', name: 'Exploration' },
  { id: 'dt', name: 'Downtime' },
];

const COST_FILTERS: { id: string; label: string; cost: ActionCost }[] = [
  { id: '1', label: 'one action', cost: { type: 'actions', value: 1 } },
  { id: '2', label: 'two actions', cost: { type: 'actions', value: 2 } },
  { id: '3', label: 'three actions', cost: { type: 'actions', value: 3 } },
  { id: 'f', label: 'free action', cost: { type: 'free' } },
  { id: 'r', label: 'reaction', cost: { type: 'reaction' } },
];

const STRIKE_COST: ActionCost = { type: 'actions', value: 1 };

/** What kind of record a favourited description came from, for the tag on its Pinned row. The keys are
 *  the content-map names PinStar / DescriptionModal stamp onto a pinned node. */
const PINNED_SOURCE_LABEL: Record<string, string> = {
  feats: 'feat',
  classFeatures: 'feature',
  items: 'item',
  spells: 'spell',
  conditions: 'condition',
  actions: 'action',
  trait: 'trait',
  rules: 'rule',
  ancestries: 'ancestry',
  heritages: 'heritage',
  backgrounds: 'background',
  classes: 'class',
  deities: 'deity',
  archetype: 'archetype',
};

/** Map an action cost to its filter-chip id, or null if it can't be filtered (variable/duration). */
function costId(c: ActionCost): string | null {
  if (c.type === 'actions') return String(c.value);
  if (c.type === 'free') return 'f';
  if (c.type === 'reaction') return 'r';
  return null;
}

function skillLabel(key: ProficiencyKey): string {
  if (key.startsWith('lore:')) {
    const subject = key.slice(5);
    return subject.charAt(0).toUpperCase() + subject.slice(1) + ' lore';
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

interface Act {
  name: string;
  cost?: ActionCost;
  desc: string;
  skill?: string;
  /** Traits/tags shown (as explained chips) in the detail popup. */
  traits?: string[];
  /** Cross-references in `desc`, so the detail popup can linkify + drill into them. */
  descRefs?: DescRef[];
  /** Richer text for the detail popup when the inline `desc` is just a short summary (curated
   *  activities): the full rules description + its cross-references from content.actions. */
  fullDesc?: string;
  fullRefs?: DescRef[];
  /** The record whose `limitedUses` governs this action. Eight BACKGROUNDS grant a once-per-day
   *  action (Genie-Blessed → Wish for Luck); the pip lookup only ever took a feat or a class feature,
   *  and a background has neither id, so every one of them showed an untracked action. */
  usesFrom?: { id: string; name: string; limitedUses?: LimitedUses };
}

/** An action opened in the compact-mode detail popup. `prepare` carries a Commander tactic's
 *  prepared state + toggle so the popup keeps that control (it has no place on a chip). */
interface DetailAction {
  a: Act;
  pinnable: boolean;
  prepare?: { prepared: boolean; disabled: boolean; onToggle: () => void };
}

/** Group skill actions by their skill (alphabetically) so each skill renders on its own chip
 *  line(s) in compact mode. Action order within a skill is preserved. */
function groupBySkill(items: Act[]): [string, Act[]][] {
  const map = new Map<string, Act[]>();
  for (const a of items) {
    const key = a.skill ?? '';
    const arr = map.get(key);
    if (arr) arr.push(a);
    else map.set(key, [a]);
  }
  return [...map.entries()].sort((x, y) => x[0].localeCompare(y[0]));
}

export function MainTab({
  character,
  content,
  onPlay,
  onRoll,
  onOpenStat,
  section = 'all',
}: {
  character: Character;
  content: ContentDatabase;
  onPlay?: PlayUpdater;
  onRoll?: (label: string, modifier: number) => void;
  /** Open the breakdown panel for an ability score or skill. */
  onOpenStat?: (ref: StatRef) => void;
  /** Which slice to render. Used on mobile to split this tab into two pages:
   *  'main' = abilities + skills only, 'actions' = pinned + activities/strikes only.
   *  'all' (the default, desktop) renders everything as before. */
  section?: 'all' | 'main' | 'actions';
}) {
  const [mode, setMode] = useState('enc');
  const [sub, setSub] = useState<'strikes' | 'actions' | 'skill' | 'item'>('strikes');
  const [filters, setFilters] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile: filter row toggles open over the results
  const [query, setQuery] = useState('');
  // A pinned description re-opened from the Pinned section.
  const [openDesc, setOpenDesc] = useState<DescNode | null>(null);
  // The strike whose detail popup is open (clicked from a strike row).
  const [strikeDetail, setStrikeDetail] = useState<Strike | null>(null);
  const { compactActions } = useCustomization();
  // Collapsible action section headers (always on, in-component like InventoryTab's groups).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleSection = (id: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // The action shown in the compact-mode detail popup (chip click).
  const [detailAction, setDetailAction] = useState<DetailAction | null>(null);

  const loreKeys = Object.keys(character.proficiencies.skills).filter((k) =>
    k.startsWith('lore:'),
  ) as ProficiencyKey[];
  const skillKeys: ProficiencyKey[] = [...SKILLS, ...loreKeys];
  // These derivations are unchanged by the sheet's transient header state (XP draft, etc.); memoize
  // on [character, content] so a keystroke in the header doesn't re-run the whole strike/crit pipeline.
  // PER SKILL, not one value for all of them: `flexible` armour exempts Acrobatics and Athletics
  // while `noisy` armour keeps the penalty on Stealth even once you meet its Strength requirement.
  // A single shared value made this badge disagree with the number deriveSkill had already produced.
  const acpFor = useMemo(
    () => (key: ProficiencyKey) => deriveArmorCheckPenalty(character, content, key),
    [character, content],
  );
  const strikes = useMemo(() => deriveStrikes(character, content), [character, content]);
  // The battle form that forbids Strikes, when one is running — see the empty-list message below.
  const noStrikesForm = strikesBlockedBy(character);
  // Crit-spec sources the character has (class features, feats, subclass/doctrine), each with the
  // level it activates + any weapon restriction. A Strike shows its crit-spec effect only when a
  // source actually covers that weapon — computed per strike below.
  const critSources = useMemo(() => critSpecSources(character, content), [character, content]);
  // Curated activities carry only a short summary; the detail popup wants the FULL rules text +
  // its cross-references (conditions, etc.) + traits, which live in content.actions under the
  // kebab-cased name. Keep the summary inline; surface the full version (when found) in the popup.
  const actionId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const enrichActivity = (a: ActivityDef): Act => {
    const full = content.actions[actionId(a.name)];
    return {
      name: a.name,
      cost: a.cost,
      skill: a.skill,
      traits: full?.traits ?? a.traits,
      desc: a.desc,
      fullDesc: full?.description,
      fullRefs: full?.descRefs,
    };
  };
  const encActivities: Act[] = ACTIVITIES.filter((a) => a.mode === 'encounter').map(enrichActivity);
  const exploreActivities: Act[] = ACTIVITIES.filter((a) => a.mode === 'exploration').map(enrichActivity);
  const downtimeActivities: Act[] = ACTIVITIES.filter((a) => a.mode === 'downtime').map(enrichActivity);
  // Feats that ARE a curated activity (Bon Mot, Battle Medicine) already appear under Skill
  // actions — exclude them here so they aren't listed twice (and don't collide on pin key).
  const activityNames = new Set(ACTIVITIES.map((a) => a.name));
  // Only feats that grant an actual ACTION (1–3 actions / reaction / free / variable) belong
  // here — passive feats (Toughness, Natural Ambition, …) carry actionCost {type:'passive'}
  // and must NOT be listed as activities.
  const isActionCost = (c?: ActionCost) =>
    // 'duration' belongs here too: an activity with a printed time ("As an activity that takes 10
    // minutes…") is something the player DOES, and the Feat actions section is where they look for
    // it. Passive stays out. ⚠ This is NOT the same predicate as widgets' exported isActionCost,
    // which asks the narrower "does ActionGlyph draw a glyph" for an item's Activate row.
    !!c && (c.type === 'actions' || c.type === 'reaction' || c.type === 'free' || c.type === 'variable' || c.type === 'duration');
  // A CLASS FEATURE can be an action too — Flurry of Blows, Channel Smite, an oracle's curse, a
  // gunslinger's deed. This list was built from `character.feats` alone, so every one of those was
  // owned, correct, described on the Feats tab, and absent from the encounter action list where a
  // player looks for something to DO on their turn.
  const actionRecords = [
    ...character.feats.map((f) => content.feats[f.featId]),
    ...[...ownedFeatureIds(character, content)].map((id) => content.classFeatures[id]),
  ];
  // The actions a record HANDS you rather than IS. A passive feat whose text ends "you also gain the
  // Warding Shift action" put nothing in this list: the feat itself is passive, and the action it
  // grants sat in content.actions with nothing owning it. `grantsActions` names it — and that hid the
  // barbarian's Rage, the magus's Spellstrike, the ranger's Hunt Prey and Reactive Strike, all of
  // which are passive CLASS FEATURES here and 1-action records over in content.actions.
  //
  // Heritage and background are walked only for this: neither is ever an action itself (no record in
  // either collection carries a non-passive cost), but 43 of them GRANT one — a Venomtail Kobold's
  // Tail Toxin, a Jinxed Halfling's Jinx, a Doomcaller's Stellar Misfortune.
  const grantedActions = [
    ...actionRecords,
    character.heritageId ? content.heritages[character.heritageId] : undefined,
    character.backgroundId ? content.backgrounds[character.backgroundId] : undefined,
  ]
    .flatMap((f) => (f?.grantsActions ?? []).map((id) => ({ id, from: f! })))
    .map(({ id, from }) => {
      const act = content.actions[id];
      // Carry the granter when IT holds the per-day limit — the action record itself does not.
      return act && from.limitedUses ? { ...act, usesFrom: from } : act;
    })
    .filter((a): a is NonNullable<typeof a> => !!a);
  const seenActionNames = new Set<string>();
  const featActions: Act[] = [...actionRecords, ...grantedActions]
    .filter((f) => !!f && isActionCost(f.actionCost) && !activityNames.has(f.name))
    .filter((f) => !seenActionNames.has(f!.name) && seenActionNames.add(f!.name))
    .map((f) => ({
      name: f!.name,
      cost: f!.actionCost as ActionCost,
      desc: f!.description,
      descRefs: f!.descRefs,
      traits: f!.traits,
      ...((f as { usesFrom?: Act['usesFrom'] }).usesFrom ? { usesFrom: (f as { usesFrom?: Act['usesFrom'] }).usesFrom } : {}),
    }));
  // Commander folio tactics are Action items the character knows — listed in their own section.
  const tacticActions: (Act & { id: string })[] = (character.commanderTactics?.folio ?? [])
    .map((id) => content.actions[id])
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => ({ id: a.id, name: a.name, cost: a.actionCost, desc: a.description, descRefs: a.descRefs, traits: a.traits }));
  const preparedTactics = new Set(character.commanderTactics?.prepared ?? []);
  const tacticPreparedMax = character.commanderTactics?.preparedMax ?? 3;
  // Signature resource STATES the character has (rage / panache, from the base class or an archetype
  // dedication) and whether each is currently active. An action gated on a state the character has but
  // hasn't turned on is shown with a "needs <state>" badge — still readable, just not usable yet.
  const resourceIds = new Set(resourcesForCharacter(character.classId, new Set(character.feats.map((f) => f.featId))).map((r) => r.id));
  const gateActive = (g: ResourceGate) => (character.classResources?.[g] ?? 0) > 0;
  /** The unmet gate for an action, or null (no gate / character lacks the state / already active). */
  const unmetGate = (a: Act): ResourceGate | null => {
    const g = actionGate(a);
    return g && resourceIds.has(g) && !gateActive(g) ? g : null;
  };
  // Stance feats the character has → an EXCLUSIVE stance toggle (entering one exits the others). Each
  // stance's mechanical effects live in content.stances (keyed by the feat slug/id); the active one's
  // Strike + AC/dex-cap/speed changes are injected in derive.
  // A feat surfaces as a stance/form toggle when it has a stance/form data entry — either a real
  // `stance`-trait footwork stance, or an alternate FORM (Ursine Avenger, Bat Form) flagged `form:true`
  // in the data even though it carries the morph trait instead of stance.
  const stanceFeats = character.feats
    .map((f) => content.feats[f.featId])
    .filter((f): f is NonNullable<typeof f> => !!f && !!content.stances?.[f.id] && ((f.traits ?? []).includes('stance') || !!content.stances[f.id]!.form));

  /*
   * A battle form has TWO carriers, and only one of them works.
   *
   * `content.stances[id]` gave the chip below a toggle, but a stance record can only hold what a stance
   * is — senses, a Strike, an AC tweak. The real form lives in `content.modes[…].battleForm`: the AC
   * formula, the temporary Hit Points, the form's own Strikes, the size, the creature trait. So a
   * player who entered Worm Form from this bar got darkvision and nothing else, while the same form
   * entered from the Modes panel gave AC 20 + level, 40 temporary HP, three Strikes at +25 and the
   * animal trait. The rest was printed in the stance's note — prose to apply by hand.
   *
   * The chip stays (mid-combat, this bar is where you are looking) and now toggles the mode. Where a
   * feat has more than one form — Worm Form's purple worm and hybrid — it gets a chip per form rather
   * than a chooser: the modes' shared `exclusiveGroup` already makes them mutually exclusive, and the
   * printed rules make you pick one anyway. 7 of the 8 have exactly one.
   */
  const formModesFor = (featId: string) =>
    Object.values(content.modes ?? {}).filter((m) => (m.feats ?? []).includes(featId) && !!m.battleForm);
  const activeModeIds = new Set((character.activeModes ?? []).map((m) => m.id));
  // Item actions: activatable carried items (consumables, or invested/worn/equipped magic items).
  const itemActions: (Act & { key: string })[] = (character.inventory ?? [])
    .map((inv) => ({ inv, item: content.items[inv.itemId] }))
    .filter(({ inv, item }) => !!item?.activationCost && (item.itemType === 'consumable' || inv.invested || inv.equipped || inv.worn))
    .map(({ inv, item }) => ({ key: `itemact:${inv.instanceId}`, name: item!.name, cost: item!.activationCost, desc: item!.description, descRefs: item!.descRefs, traits: item!.traits }));

  const pinned = new Set(character.pinned ?? []);
  // Why the active stance is inert, or null. derive() already refuses to apply its effects.
  const stanceIssue = stanceRequirementIssue(character, content);

  const strikeKey = (instanceId: string) => `strike:${instanceId}`;
  const actionKey = (name: string) => `action:${name}`;

  const q = query.trim().toLowerCase();
  const matchText = (name: string, desc = '') => !q || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
  const matchCost = (c?: ActionCost) => {
    if (filters.size === 0) return true;
    if (!c) return false;
    const id = costId(c);
    return id != null && filters.has(id);
  };
  const matchAct = (a: Act) => matchText(a.name, a.desc) && matchCost(a.cost);

  const shownStrikes = strikes.filter((s) => matchText(s.name) && matchCost(STRIKE_COST));
  const shownFeats = featActions.filter(matchAct);
  const shownTactics = tacticActions.filter(matchAct);
  const shownItemActions = itemActions.filter(matchAct);
  const shownBasic = encActivities.filter((a) => !a.skill && matchAct(a));
  const shownSkill = encActivities.filter((a) => a.skill && matchAct(a));
  const shownExplore = exploreActivities.filter((a) => matchText(a.name, a.desc));
  const shownDowntime = downtimeActivities.filter((a) => matchText(a.name, a.desc));
  // Camping activities (Kingmaker): the camping-trait actions from content, surfaced as their own mode
  // when the campaign has Kingmaker on. They live only in content.actions (not the curated ACTIVITIES),
  // so build them here — a short inline summary (strip the "Source … ---" header) + full text in the popup.
  const campingSummary = (full: string): string => {
    const body = /-{3,}/.test(full) ? full.split(/-{3,}/).slice(1).join(' ') : full;
    const plain = toPlainText(body);
    return plain.length > 170 ? plain.slice(0, 168).replace(/\s+\S*$/, '') + '…' : plain;
  };
  const campingActs: Act[] = character.kingmakerEnabled
    ? listValues(content, content.actions)
        .filter((a) => (a.traits ?? []).includes('camping'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({ name: a.name, desc: campingSummary(a.description), traits: a.traits, fullDesc: a.description, fullRefs: a.descRefs }))
    : [];
  const shownCamping = campingActs.filter((a) => matchText(a.name, a.desc));
  // Camping is an extra activity mode, only offered while Kingmaker is on. If the mode is left on
  // 'camp' after Kingmaker is turned off, fall back to Downtime so the list never goes blank.
  const modes = character.kingmakerEnabled ? [...MODES, { id: 'camp', name: 'Camping' }] : MODES;
  const effMode = mode === 'camp' && !character.kingmakerEnabled ? 'dt' : mode;

  const pinnedStrikes = strikes.filter((s) => pinned.has(strikeKey(s.instanceId)));
  const pinnedActions = [...featActions, ...tacticActions, ...encActivities].filter((a) => pinned.has(actionKey(a.name)));
  const pinnedDescs = character.pinnedDescs ?? [];
  const hasPinned = pinnedStrikes.length + pinnedActions.length + pinnedDescs.length > 0;

  // The mobile Actions page (section === 'actions') splits the encounter actions across FOUR
  // sub-tabs — Strikes / Actions / Skills / Items. Desktop (section === 'all') keeps the two-tab
  // Strikes / Actions with everything together (skill + item collapse back into Actions there).
  const splitTabs = section === 'actions';
  const subEff = !splitTabs && (sub === 'skill' || sub === 'item') ? 'actions' : sub;
  const showGeneral = subEff === 'actions'; // tactics + feat + basic actions
  const showSkill = splitTabs ? subEff === 'skill' : subEff === 'actions';
  const showItem = splitTabs ? subEff === 'item' : subEff === 'actions';

  function toggleFilter(id: string) {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function Star({ k }: { k: string }) {
    if (!onPlay) return null;
    const on = pinned.has(k);
    return (
      <button
        className={'pin-star' + (on ? ' on' : '')}
        title={on ? 'Unpin' : 'Pin to top'}
        aria-label={on ? 'Unpin' : 'Pin to top'}
        onClick={(e) => {
          e.stopPropagation();
          onPlay((p) => togglePin(p, k));
        }}
      >
        <i className="ti ti-star" aria-hidden="true" />
      </button>
    );
  }

  /**
   * A Strike's reach, written as VALUES — "Reach 10 ft / 15 ft*" (owner principle L). Every reach the
   * Strike has is printed; the conditional ones carry a `*` that OPENS the record granting them,
   * because two sources can print the same number and the player's question is which of them applies.
   */
  function StrikeReachValue({ reaches }: { reaches: NonNullable<Strike['reaches']> }) {
    return (
      <span className="strike-reach">
        Reach{' '}
        {reaches.map((r, i) => {
          const rec =
            r.sourceId && r.sourceCollection
              ? (content[r.sourceCollection] as Record<string, { name?: string; description?: string; descRefs?: DescRef[] } | undefined>)?.[r.sourceId]
              : undefined;
          return (
            <span key={i} className="strike-reach-val" title={r.when}>
              {i > 0 && <span className="strike-reach-sep">/</span>}
              {r.feet} ft
              {r.when && (
                <InfoTerm
                  className="reach-star"
                  title={rec?.name ?? 'Reach'}
                  description={rec?.description ?? r.when}
                  descRefs={rec?.descRefs}
                  descKey={r.sourceCollection}
                >
                  <sup className="sit-star">*</sup>
                </InfoTerm>
              )}
            </span>
          );
        })}
      </span>
    );
  }

  function StrikeRow({ s }: { s: (typeof strikes)[number] }) {
    return (
      <div className="strike">
        <div className="strike-head">
          <span className="strike-cost">
            <ActionGlyph cost={STRIKE_COST} />
          </span>
          <i className={'ti ' + (s.ranged ? 'ti-arrow-narrow-up' : 'ti-sword')} aria-hidden="true" />
          <button type="button" className="strike-name" title="Show strike details" onClick={() => setStrikeDetail(s)}>
            {s.name}
          </button>
          <span className="strike-traits">
            {s.traits.map((t, i) => (
              <span key={t}>
                {i > 0 && ' · '}
                <InfoTerm className="strike-trait" title={capWord(t)} description={traitDesc(t, content)}>
                  {t}
                </InfoTerm>
              </span>
            ))}
          </span>
          <Star k={strikeKey(s.instanceId)} />
        </div>
        <div className="strike-line">
          {s.attack.map((mod, i) => (
            <span
              key={i}
              className={'atk' + (i === 1 ? ' dim' : i === 2 ? ' dim2' : '') + (onRoll ? ' rollable' : '')}
              onClick={onRoll ? () => onRoll(`${s.name} attack${i ? ` (MAP ${i})` : ''}`, mod) : undefined}
              title={onRoll ? `Roll ${s.name} attack` : undefined}
            >
              {formatMod(mod)}
            </span>
          ))}
          {/* A strike's attack roll and its damage take conditional bonuses from different sources
              (Bestiary Scholar sharpens the attack; Pivot Strike adds damage), so they star apart. */}
          {statHasSituational(character, { kind: 'strikeAttack', instanceId: s.instanceId }, content) && (
            <SituationalStar />
          )}
          <span className="strike-dmg">
            {s.damage}
            {statHasSituational(character, { kind: 'strikeDamage', instanceId: s.instanceId }, content) && (
              <SituationalStar />
            )}
          </span>
        </div>
        {(s.group || (s.ranged && s.range != null) || !!s.reaches?.length) && (
          <div className="strike-meta">
            {s.ranged && s.range != null && <span>Range {s.range} ft</span>}
            {!!s.reaches?.length && <StrikeReachValue reaches={s.reaches} />}
            {s.reload != null && s.reload > 0 && <span>Reload {s.reload}</span>}
            {s.specDamage ? <span title="Weapon specialization (included in the damage above)">Spec +{s.specDamage}</span> : null}
            {s.group && <span className="strike-group">{s.group.charAt(0).toUpperCase() + s.group.slice(1)}</span>}
          </div>
        )}
        {critSpec(s.group) && strikeShowsCritSpec(s, critSources) && (
          <div className="strike-crit">
            <span className="sc-label">Crit</span>
            <CritSpecText text={critSpec(s.group)!} content={content} />
          </div>
        )}
      </div>
    );
  }

  /**
   * Per-day pips for an action whose limit lives on the record that GRANTED it — eight backgrounds
   * grant a once-per-day action (Genie-Blessed's Wish for Luck, Doomcaller's Stellar Misfortune) and
   * carry the `limitedUses` themselves. The pip lookup only ever took a feat or a class feature, and
   * a background row has neither id, so all eight showed an action with no tracker at all.
   *
   * Spent uses key off the GRANTER's id, which is exactly what PlayState.featUses already stores.
   */
  function ActionUses({ a }: { a: Act }) {
    if (!a.usesFrom || !onPlay) return null;
    const use = featUse(character, a.usesFrom as Parameters<typeof featUse>[1], content);
    if (!use) return null;
    const stop = (ev: React.MouseEvent) => ev.stopPropagation();
    return (
      <span className="ff-uses" title={`${use.current}/${use.max} left — refills on daily preparations`}>
        <i className="ti ti-battery-2" aria-hidden="true" />
        <button
          aria-label={`Spend a use of ${use.name}`}
          disabled={use.current <= 0}
          onClick={(ev) => {
            stop(ev);
            onPlay((p) => ({ ...p, featUses: spendFeatUse(p.featUses, use.featId, use.max) }), `featuses:${use.featId}`);
          }}
        >
          <i className="ti ti-minus" aria-hidden="true" />
        </button>
        <span className="ff-uses-n">
          {use.current}/{use.max}
        </span>
        <button
          aria-label={`Restore a use of ${use.name}`}
          disabled={use.current >= use.max}
          onClick={(ev) => {
            stop(ev);
            onPlay((p) => ({ ...p, featUses: refundFeatUse(p.featUses, use.featId) }), `featuses:${use.featId}`);
          }}
        >
          <i className="ti ti-plus" aria-hidden="true" />
        </button>
      </span>
    );
  }

  function ActionRow({
    a,
    pinnable = true,
    prepared,
    onPrepare,
    prepareDisabled,
    full = false,
  }: {
    a: Act;
    pinnable?: boolean;
    /** Force the full-width row even when compact chips are on — the Pinned card uses it so a
     *  favourited action sits at the same width as a favourited strike or description beside it. */
    full?: boolean;
    /** When defined, renders a "prepared" toggle (Commander tactics); the value is its on/off state. */
    prepared?: boolean;
    onPrepare?: () => void;
    prepareDisabled?: boolean;
  }) {
    // Both modes open the SAME detail popup (full description + traits + pin star inside).
    const openDetail = () =>
      setDetailAction({
        a,
        pinnable,
        prepare: onPrepare ? { prepared: !!prepared, disabled: !!prepareDisabled, onToggle: onPrepare } : undefined,
      });
    // Compact mode: a chip (cost glyph + name) that opens the popup; no inline description or
    // star — those live in the popup. Tactics keep their prepared state visible via the trailing dot.
    // Gated on a class-resource state the character has but hasn't switched on (rage / panache).
    const gate = unmetGate(a);
    // Ruling D: something of yours changes what this action DOES — Magic Hands makes Treat Wounds heal
    // d10s instead of d8s. The changed value shows inline in parentheses with a `*` back to the
    // source. Neither has a stat row to sit on: Magic Hands gives no bonus to the Medicine check at
    // all, so starring the nearest roll would have claimed something the feat does not grant.
    const marks = recordMarkersFor(character, content, 'action', actionId(a.name));
    const markValue = marks.find((m) => m.value)?.value;
    const markTitle = markTooltip(content, marks);
    const MarkTag = () =>
      marks.length === 0 ? null : (
        <span className="action-mark" title={markTitle}>
          {markValue && <span className="action-mark-val">({markValue})</span>}
          <SituationalStar />
        </span>
      );
    if (compactActions && !full) {
      return (
        <button type="button" className={'action-chip' + (onPrepare && !prepared ? ' unprepared' : '') + (gate ? ' gated' : '')} title={gate ? `Needs ${gateLabel(gate)} — ${a.name}` : `Show ${a.name}`} onClick={openDetail}>
          <span className="action-cost">
            {a.cost ? <ActionGlyph cost={a.cost} /> : <i className="ti ti-hourglass-low action-activity-icon" aria-hidden="true" />}
          </span>
          <span className="action-chip-name">{a.name}</span>
          <ActionUses a={a} />
          <MarkTag />
          {gate && <span className="needs-badge" title={`Requires ${gateLabel(gate)}`}><i className="ti ti-lock" aria-hidden="true" />{gateLabel(gate)}</span>}
          {a.skill && <span className="action-skill">{a.skill}</span>}
          {onPrepare && <i className={'ti chip-prep ' + (prepared ? 'ti-circle-check-filled' : 'ti-circle')} aria-hidden="true" />}
        </button>
      );
    }
    // Full mode: the same row as before, now clickable to open the full description + traits popup.
    return (
      <div
        className={'action clickable' + (onPrepare && !prepared ? ' unprepared' : '') + (gate ? ' gated' : '')}
        onClick={openDetail}
        title={gate ? `Needs ${gateLabel(gate)} — ${a.name}` : `Show ${a.name}`}
      >
        <span className="action-cost">
          {a.cost ? (
            <ActionGlyph cost={a.cost} />
          ) : (
            <i className="ti ti-hourglass-low action-activity-icon" title="Activity" aria-hidden="true" />
          )}
        </span>
        <div className="action-body">
          <div className="action-name">
            {a.name}
            <MarkTag />
            {gate && <span className="needs-badge" title={`Requires ${gateLabel(gate)}`}><i className="ti ti-lock" aria-hidden="true" />Needs {gateLabel(gate)}</span>}
            {a.skill && <span className="action-skill">{a.skill}</span>}
            <ActionUses a={a} />
          </div>
          <div className="action-desc">{toPlainText(a.desc)}</div>
        </div>
        {onPrepare && (
          <button
            className={'prep-toggle' + (prepared ? ' on' : '')}
            title={prepared ? 'Prepared today — click to unprepare' : 'Prepare this tactic'}
            aria-label={prepared ? 'Unprepare tactic' : 'Prepare tactic'}
            disabled={!prepared && prepareDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onPrepare();
            }}
          >
            <i className={'ti ' + (prepared ? 'ti-circle-check-filled' : 'ti-circle')} aria-hidden="true" />
          </button>
        )}
        {/* Pinning surfaces in the encounter Pinned section; exploration/downtime rows
            (pinnable=false) omit the star so it's never a dead control. */}
        {pinnable && <Star k={actionKey(a.name)} />}
      </div>
    );
  }

  /** A collapsible action section: an always-clickable chevron header wrapping its rows. In compact
   *  mode the body becomes a wrapping chip row; collapsing hides the whole body either way. */
  function Section({ id, label, note, wrap = true, children }: { id: string; label: ReactNode; note?: ReactNode; wrap?: boolean; children: ReactNode }) {
    const open = !collapsed.has(id);
    return (
      <>
        <button type="button" className="acts-sec-label acts-sec-toggle" aria-expanded={open} onClick={() => toggleSection(id)}>
          <i className={'ti ' + (open ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
          {label}
          {note}
        </button>
        {/* `wrap` sections drop their chips into a single wrapping row; the Skill section passes
            wrap={false} and supplies its own per-skill rows so each skill gets its own line(s). */}
        {open && (compactActions && wrap ? <div className="action-chip-row">{children}</div> : children)}
      </>
    );
  }

  /** Action popup (compact chips + full rows both open it): cost glyph + name in the header, the
   *  favorite star + (for tactics) the prepare toggle inside, the trait tags, and the full
   *  linkified description in the body. */
  function ActionDetailModal({ detail, onClose }: { detail: DetailAction; onClose: () => void }) {
    useEscapeClose(onClose);
    const { a, pinnable, prepare } = detail;
    const traits = a.traits ?? [];
    return (
      <div className="picker-overlay" onClick={onClose}>
        <div className="picker info-modal" onClick={(e) => e.stopPropagation()}>
          <div className="picker-head">
            <span className="action-cost action-detail-cost">
              {a.cost ? <ActionGlyph cost={a.cost} /> : <i className="ti ti-hourglass-low action-activity-icon" aria-hidden="true" />}
            </span>
            <span className="info-title">
              {a.name}
              {a.skill && <span className="action-skill">{a.skill}</span>}
            </span>
            {prepare && onPlay && (
              <button
                className={'prep-toggle' + (prepare.prepared ? ' on' : '')}
                title={prepare.prepared ? 'Prepared today — click to unprepare' : 'Prepare this tactic'}
                aria-label={prepare.prepared ? 'Unprepare tactic' : 'Prepare tactic'}
                disabled={!prepare.prepared && prepare.disabled}
                onClick={() => {
                  prepare.onToggle();
                  onClose();
                }}
              >
                <i className={'ti ' + (prepare.prepared ? 'ti-circle-check-filled' : 'ti-circle')} aria-hidden="true" />
              </button>
            )}
            {pinnable && <Star k={actionKey(a.name)} />}
            <button className="picker-close" onClick={onClose} aria-label="Close">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
          <div className="info-body">
            {traits.length > 0 && (
              <div className="action-detail-traits">
                {traits.map((t) => (
                  <InfoTerm key={t} className="strike-trait" title={capWord(t)} description={traitDesc(t, content)}>
                    {t}
                  </InfoTerm>
                ))}
              </div>
            )}
            <DescBody description={a.fullDesc ?? a.desc} descRefs={a.fullRefs ?? a.descRefs} className="action-detail-desc" onExit={onClose} />
          </div>
        </div>
      </div>
    );
  }

  function PinnedDescRow({ node }: { node: PinnedDesc }) {
    return (
      <div className="pinned-desc">
        <button className="pinned-desc-open" onClick={() => setOpenDesc(node)} title={`Open ${node.title}`}>
          <i className="ti ti-book-2" aria-hidden="true" />
          <span className="pinned-desc-title">{node.title}</span>
          {/* Shield Block is both a class feature and a feat; two rows reading "Shield Block" with no
              way to tell them apart is worse than no favourite at all. */}
          {node.key && <span className="pinned-desc-from">{PINNED_SOURCE_LABEL[node.key] ?? node.key}</span>}
        </button>
        {onPlay && (
          <button
            className="pin-star on"
            title="Remove from Pinned"
            aria-label={`Remove ${node.title} from Pinned`}
            onClick={() => onPlay((p) => togglePinnedDesc(p, node))}
          >
            <i className="ti ti-star" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="maincol">
      {section !== 'actions' && (
        <>
      <section className="card">
        <div className="ct">
          <i className="ti ti-rosette" aria-hidden="true" />
          Ability scores
        </div>
        <div className="abilities">
          {/* No key-attribute marking: a player knows their own key attribute, and singling one box out
              with an outline and a legend spent the row's only accent on something nobody needs told. */}
          {ABILITIES.map((ab) => {
            const partial = character.partialBoosts?.includes(ab) ?? false;
            return (
              <div
                className={'ability' + (partial ? ' partial' : '') + (onOpenStat ? ' openable' : '')}
                key={ab}
                onClick={onOpenStat ? () => onOpenStat({ kind: 'ability', ability: ab }) : undefined}
                title={partial ? 'Includes a partial boost (+1, attribute was already 18+)' : onOpenStat ? 'How is this calculated?' : undefined}
              >
                <div className="ab-name">{ABILITY_LABEL[ab]}</div>
                <div className="ab-mod">{formatMod(abilityMod(character.abilities[ab]))}</div>
                <div className="ab-score">{character.abilities[ab]}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="ct">
          <i className="ti ti-list-check" aria-hidden="true" />
          Skills
        </div>
        <div className="skills">
          {skillKeys.map((key) => {
            const d = deriveSkill(character, key, content);
            const acp = acpFor(key);
            // A rank THIS MORNING's answer supplied — Ageless Spirit, Ancestral Longevity, Ancient
            // Memories, Endless Memories, Expert Longevity, Haunting Memories — lapses at the next
            // daily preparations. Without saying so the row is indistinguishable from permanent
            // training, which is the one thing all of those records’ text is at pains to deny.
            // `dailySkillRank` returns a rank only when the morning’s answer BEATS what the build
            // already gave, so it never labels a real rank.
            const dailyRank = dailySkillRank(character, content, key);
            const dailyNote = dailyRank
              ? `${dailyRank.charAt(0).toUpperCase() + dailyRank.slice(1)} until your next daily preparations — temporary, so it can't be a prerequisite or a base for a skill increase`
              : '';
            const penalized = acp.value < 0 && skillTakesArmorPenalty(key);
            // "You can use your proficiency rank in Crafting for anything that requires a proficiency
            // rank in Medicine." When that stand-in beats the skill's own number it IS the number the
            // player rolls, so the row shows it — and says which skill and which record, because a
            // Medicine +8 on a character untrained in Medicine is otherwise inexplicable.
            const subNote = d.substitutedFrom
              ? `Uses ${skillLabel(d.substitutedFrom.skill)} instead — from ${d.substitutedFrom.source}`
              : '';
            const note = [penalized ? `${formatMod(acp.value)} armor check penalty (${acp.source})` : '', subNote, dailyNote]
              .filter(Boolean)
              .join(' · ');
            return (
              <div
                className={'skill' + (onOpenStat ? ' rollable' : '') + statMarkClass(character, { kind: 'skill', skill: key }, content)}
                key={key}
                onClick={onOpenStat ? () => onOpenStat({ kind: 'skill', skill: key }) : undefined}
                title={[onOpenStat ? `${skillLabel(key)} — how is this calculated?` : '', note].filter(Boolean).join(' · ') || undefined}
              >
                <RankPill rank={d.rank} />
                <span className="skill-name">
                  {skillLabel(key)}
                  {statHasSituational(character, { kind: 'skill', skill: key }, content) && <SituationalStar />}
                  {dailyRank && (
                    <span className="skill-sub" title={dailyNote}>
                      today
                    </span>
                  )}
                  {d.substitutedFrom && (
                    <span className="skill-sub" title={subNote}>
                      via {skillLabel(d.substitutedFrom.skill)}
                    </span>
                  )}
                </span>
                {penalized && (
                  <span className="acp-badge" title={note}>
                    {formatMod(acp.value)}
                  </span>
                )}
                <span className="skill-mod">{formatMod(d.modifier)}</span>
              </div>
            );
          })}
        </div>
      </section>
        </>
      )}

      {section !== 'main' && (
        <>
      {hasPinned && (
        <section className="card pinned-card">
          <div className="ct">
            <i className="ti ti-star" aria-hidden="true" /> Pinned
          </div>
          {pinnedStrikes.map((s) => (
            <StrikeRow key={s.instanceId} s={s} />
          ))}
          {pinnedActions.map((a) => (
            <ActionRow key={a.name} a={a} full />
          ))}
          {pinnedDescs.map((n) => (
            <PinnedDescRow key={descId(n)} node={n} />
          ))}
        </section>
      )}

      <section className="card">
        <div className="acts-head">
          {section !== 'actions' && (
            <div className="ct" style={{ margin: 0 }}>
              <i className="ti ti-swords" aria-hidden="true" />
              Activities
            </div>
          )}
          <div className="seg">
            {modes.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={effMode === m.id} className={'seg-btn' + (effMode === m.id ? ' on' : '')} onClick={() => { setMode(m.id); if (m.id !== 'enc') setFiltersOpen(false); }}>
                {m.name}
              </button>
            ))}
          </div>
        </div>

        <div className="acts-controls">
          <div className="search">
            <i className="ti ti-search" aria-hidden="true" />
            <input placeholder="Search activities…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {mode === 'enc' && (
            <>
              <button
                type="button"
                className={'filter-toggle' + (filtersOpen || filters.size > 0 ? ' on' : '')}
                aria-label="Filters"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((o) => !o)}
              >
                <i className="ti ti-filter" aria-hidden="true" />
              </button>
              <div className={'af-row' + (filtersOpen ? ' open' : '')}>
              {COST_FILTERS.map((c) => (
                <button
                  key={c.id}
                  className={'af' + (filters.has(c.id) ? ' on' : '')}
                  title={c.label}
                  aria-label={'filter ' + c.label}
                  onClick={() => toggleFilter(c.id)}
                >
                  <ActionGlyph cost={c.cost} />
                </button>
              ))}
              </div>
            </>
          )}
        </div>

        {mode === 'enc' ? (
          <>
            <div className="subtabs">
              <button type="button" role="tab" aria-selected={subEff === 'strikes'} className={'stab' + (subEff === 'strikes' ? ' on' : '')} onClick={() => setSub('strikes')}>
                Strikes
              </button>
              <button type="button" role="tab" aria-selected={subEff === 'actions'} className={'stab' + (subEff === 'actions' ? ' on' : '')} onClick={() => setSub('actions')}>
                Actions
              </button>
              {splitTabs && (
                <>
                  <button type="button" role="tab" aria-selected={subEff === 'skill'} className={'stab' + (subEff === 'skill' ? ' on' : '')} onClick={() => setSub('skill')}>
                    Skills
                  </button>
                  <button type="button" role="tab" aria-selected={subEff === 'item'} className={'stab' + (subEff === 'item' ? ' on' : '')} onClick={() => setSub('item')}>
                    Items
                  </button>
                </>
              )}
            </div>

            {stanceFeats.length > 0 && (
              <div className="stance-bar">
                <span className="stance-bar-label">
                  {stanceFeats.every((f) => content.stances[f.id]?.form)
                    ? 'Form'
                    : stanceFeats.some((f) => content.stances[f.id]?.form)
                      ? 'Stance / Form'
                      : 'Stance'}
                </span>
                <div className="stance-chips">
                  {stanceFeats.flatMap((f) => {
                    // A feat with real battle-form modes gets a chip PER FORM, wired to the mode.
                    const forms = formModesFor(f.id);
                    if (forms.length) {
                      return forms.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={'stance-chip' + (activeModeIds.has(m.id) ? ' on' : '')}
                          disabled={!onPlay}
                          title={m.note || m.name}
                          onClick={onPlay ? () => onPlay((p) => toggleMode(p, m.id, content.modes)) : undefined}
                        >
                          {m.name}
                        </button>
                      ));
                    }
                    return [
                      <button
                        key={f.id}
                        type="button"
                        className={
                          'stance-chip' +
                          (character.activeStance === f.id ? ' on' : '') +
                          (character.activeStance === f.id && stanceIssue ? ' unmet' : '')
                        }
                        disabled={!onPlay}
                        title={
                          [content.stances[f.id]?.requires?.text && `Requires: ${content.stances[f.id]!.requires!.text}`,
                           content.stances[f.id]?.note || f.name]
                            .filter(Boolean)
                            .join(' — ')
                        }
                        onClick={onPlay ? () => onPlay((p) => setActiveStance(p, f.id)) : undefined}
                      >
                        {f.name}
                      </button>,
                    ];
                  })}
                </div>
                {/* A stance whose Requirements aren't met grants nothing (derive gates it), so say so
                    plainly — an inert stance that still looks active reads as a broken sheet. */}
                {stanceIssue && (
                  <div className="stance-warn">
                    <i className="ti ti-alert-triangle" aria-hidden="true" />
                    <span>
                      Not active — this stance requires: <strong>{stanceIssue}</strong>. Its effects
                      aren't being applied.
                    </span>
                  </div>
                )}
                {character.activeStance && content.stances[character.activeStance]?.note && (
                  <div className="stance-note">{content.stances[character.activeStance].note}</div>
                )}
                {/* A form entered from a chip is an active MODE, not an activeStance, so its note has
                    to come from the mode or the bar goes silent about the form you are in. */}
                {stanceFeats
                  .flatMap((f) => formModesFor(f.id))
                  .filter((m) => activeModeIds.has(m.id) && m.note)
                  .map((m) => (
                    <div className="stance-note" key={m.id}>{m.note}</div>
                  ))}
              </div>
            )}

            {/* Gated on the BUDGET, not on being an alchemist by class. buildCharacter already sets
                `advancedAlchemy` for an Alchemist Dedication and for a Dual Class second class, so
                gating on `classId === 'alchemist'` hid the panel from exactly the characters who had
                to go looking for it — they were entitled to daily infused items and could neither
                see nor prepare them. */}
            {character.advancedAlchemy && <AlchemyPanel character={character} content={content} onPlay={onPlay} />}

            {subEff === 'strikes' ? (
              <div className="strikes">
                {shownStrikes.map((s) => (
                  <StrikeRow key={s.instanceId} s={s} />
                ))}
                {/* A form that says "you can't make Strikes" empties this list, and an empty list on
                    its own reads as a broken app rather than as a rule (Q27: an inert control must
                    look inert, and say why). Named so the player knows which toggle to switch off. */}
                {shownStrikes.length === 0 &&
                  (noStrikesForm ? (
                    <div className="acts-empty">
                      You can’t make Strikes while <strong>{noStrikesForm.name}</strong> is active.
                    </div>
                  ) : (
                    <div className="acts-empty">No strikes match.</div>
                  ))}
              </div>
            ) : (
              <div className="actions">
                {showGeneral && shownTactics.length > 0 && (
                  <Section
                    id="tactics"
                    label="Tactics"
                    note={
                      character.commanderTactics && (
                        <span className="acts-sec-note">
                          {' '}
                          · folio {character.commanderTactics.folio.length}/{character.commanderTactics.folioMax} · prepared{' '}
                          {preparedTactics.size}/{tacticPreparedMax} · {character.commanderTactics.squadmates} squadmates
                          {/* The highest tactic TIER this commander has unlocked. It is computed on
                              the character and was read by nothing, so the one number that says which
                              tactics you may add was visible only inside the builder's picker. */}
                          {character.commanderTactics.maxTier ? ` · up to ${character.commanderTactics.maxTier} tactics` : ''}
                        </span>
                      )
                    }
                  >
                    {shownTactics.map((a) => (
                      <ActionRow
                        key={a.id}
                        a={a}
                        prepared={preparedTactics.has(a.id)}
                        prepareDisabled={preparedTactics.size >= tacticPreparedMax}
                        onPrepare={onPlay ? () => onPlay((p) => toggleTactic(p, a.id, tacticPreparedMax)) : undefined}
                      />
                    ))}
                  </Section>
                )}
                {showGeneral && shownFeats.length > 0 && (
                  <Section id="feats" label="Feat actions">
                    {shownFeats.map((a) => (
                      <ActionRow key={a.name} a={a} />
                    ))}
                  </Section>
                )}
                {showGeneral && shownBasic.length > 0 && (
                  <Section id="basic" label="Basic actions">
                    {shownBasic.map((a) => (
                      <ActionRow key={a.name} a={a} />
                    ))}
                  </Section>
                )}
                {showSkill && shownSkill.length > 0 && (
                  <Section id="skill" label="Skill actions" wrap={false}>
                    {compactActions
                      ? groupBySkill(shownSkill).map(([skill, group]) => (
                          <div className="action-chip-row" key={skill || 'misc'}>
                            {group.map((a) => (
                              <ActionRow key={a.name} a={a} />
                            ))}
                          </div>
                        ))
                      : shownSkill.map((a) => <ActionRow key={a.name} a={a} />)}
                  </Section>
                )}
                {showItem && shownItemActions.length > 0 && (
                  <Section id="items" label="Item actions">
                    {shownItemActions.map((a) => (
                      <ActionRow key={a.key} a={a} pinnable={false} />
                    ))}
                  </Section>
                )}
                {(showGeneral ? shownTactics.length + shownFeats.length + shownBasic.length : 0) +
                  (showSkill ? shownSkill.length : 0) +
                  (showItem ? shownItemActions.length : 0) ===
                  0 && <div className="acts-empty">No actions match.</div>}
              </div>
            )}
          </>
        ) : (
          <div className="actions">
            {(() => {
              const list = effMode === 'exp' ? shownExplore : effMode === 'camp' ? shownCamping : shownDowntime;
              const id = effMode === 'exp' ? 'explore' : effMode === 'camp' ? 'camping' : 'downtime';
              const label =
                effMode === 'exp' ? 'Exploration activities' : effMode === 'camp' ? 'Camping activities' : 'Downtime activities';
              return list.length > 0 ? (
                <Section id={id} label={label}>
                  {list.map((a) => (
                    <ActionRow key={a.name} a={a} pinnable={false} />
                  ))}
                </Section>
              ) : (
                <div className="acts-empty">No activities match.</div>
              );
            })()}
          </div>
        )}
      </section>

      {openDesc && <DescriptionModal root={openDesc} onClose={() => setOpenDesc(null)} />}
      {detailAction && <ActionDetailModal detail={detailAction} onClose={() => setDetailAction(null)} />}
      {strikeDetail && (
        <StrikeDetailModal
          strike={strikeDetail}
          character={character}
          content={content}
          onOpenStat={onOpenStat}
          onClose={() => setStrikeDetail(null)}
        />
      )}
        </>
      )}
    </div>
  );
}
