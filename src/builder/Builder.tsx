import { useEffect, useMemo, useState } from 'react';
import './builder.css';
import {
  attributeBoostCount,
  GRADUAL_BOOST_SETS,
  type BuildState,
  buildCharacter,
  canTakeNewDedication,
  checkPrerequisites,
  kineticistElements,
  levelGrants,
} from '../rules/build';
import { classFeatureDescription } from '../rules/featureText';
import {
  resolveBackground,
  skillIncreaseCap,
} from '../rules/build';
import { casterSlots, wizardSpellbookSize, cantripsKnown } from '../rules/spellcasting';
import { activeCasterArchetype, archetypeSlots } from '../rules/casterArchetypes';
import type { ContentDatabase, FeatCategory, ProficiencyKey, ProficiencyRank, SaveId } from '../rules/types';
import { ABILITIES, PROFICIENCY_RANKS, SKILLS } from '../rules/types';
import { AbilitySelect, ChoiceDetails, FullStats, LanguageEditor, OptionsCard, OriginPickers, PopupSelect, START, SkillEditor, AttributeEditor, SubCard, VariantRulesCard, cap, loreKey, loreLabel, useBuilderActions } from './shared';
import { FilterableSelect, PickerRow, descNodeOf } from '../sheet/FilterableSelect';
import { SPELL_SPEC_BUILDER, FEAT_SPEC } from '../sheet/filterSpecs';

const FEAT_LABEL: Record<FeatCategory, string> = {
  ancestry: 'Ancestry feat',
  heritage: 'Heritage',
  class: 'Class feat',
  skill: 'Skill feat',
  general: 'General feat',
  archetype: 'Archetype feat',
  bonus: 'Bonus feat',
};
const FEAT_ICON: Record<FeatCategory, string> = {
  ancestry: 'ti-user',
  heritage: 'ti-sparkles',
  class: 'ti-shield-half',
  skill: 'ti-star',
  general: 'ti-medal',
  archetype: 'ti-books',
  bonus: 'ti-plus',
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
  | { kind: 'spell'; rank: number; cap?: number }
  | { kind: 'familiar-ability'; companionId: string };

const skillLabel = (key: ProficiencyKey) => (key.startsWith('lore:') ? loreLabel(key) : cap(key));

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
  content,
  initial,
  onCancel,
  onCreate,
}: {
  content: ContentDatabase;
  /** An existing build to edit; omitted when creating a new character. */
  initial?: BuildState;
  onCancel: () => void;
  onCreate: (build: BuildState) => void;
}) {
  const [build, setBuild] = useState<BuildState>(initial ?? START);
  const actions = useBuilderActions(setBuild, content);
  const [sel, setSel] = useState<Sel>(0);
  const [picker, setPicker] = useState<Picker | null>(null);
  // The full item catalog, sorted once, for the equipment picker's filter panel.
  // Class-feat picker: reveal archetype feats (multiclass/archetypes). Off by default.
  const [showArch, setShowArch] = useState(false);
  // When lowering the level would drop choices already made at that level, confirm first.
  // Holds the level we'd lower TO (= current level − 1), or null when no prompt is open.
  const [confirmLowerTo, setConfirmLowerTo] = useState<number | null>(null);
  useEffect(() => setShowArch(false), [picker]);

  // Skill ranks the character has *before* the selected level's increase (for the "X → Y" display).
  // Memoized so the full buildCharacter pipeline doesn't re-run on every level-page render.
  const baseSkills = useMemo(() => {
    if (typeof sel !== 'number' || sel < 1) return null;
    const rest = { ...build.skillIncreases };
    delete rest[sel];
    return buildCharacter({ ...build, skillIncreases: rest }, content).proficiencies.skills;
  }, [build, content, sel]);

  // Only show levels up to the character's current level; the +/− stepper extends/trims it.
  const strip: Sel[] = ['setup', 0, ...Array.from({ length: build.level }, (_, i) => i + 1)];
  const slotKey = (lvl: number, cat: FeatCategory, idx: number) => `${lvl}:${cat}:${idx}`;

  // Feats eligible for a given slot: right category + level, not already taken in
  // another slot (a feat can only be taken once), and — for ancestry/class feats
  // — gated to the chosen ancestry/class by trait.
  const eligibleFor = (p: { level: number; category: FeatCategory; idx: number }) => {
    const currentKey = slotKey(p.level, p.category, p.idx);
    const taken = new Set<string>();
    for (const [k, v] of Object.entries(build.featPicks)) if (v && k !== currentKey) taken.add(v);
    const granted = resolveBackground(build, content)?.grantedFeatId;
    if (granted) taken.add(granted);
    return Object.values(content.feats).filter((f) => {
      if (f.level > p.level) return false;
      if (taken.has(f.id)) return false;
      // Free Archetype slot: any archetype feat (these are stored as class-category feats carrying the
      // 'archetype' trait, so match on the trait rather than the category).
      if (p.category === 'archetype') return f.traits.includes('archetype');
      if (f.category !== p.category) return false;
      if (p.category === 'ancestry' && build.ancestryId && !f.traits.includes(build.ancestryId)) return false;
      // Class slots take your class's feats OR any archetype feat (multiclass/archetypes). Dual Class
      // also accepts the second class's feats.
      if (
        p.category === 'class' &&
        build.classId &&
        !f.traits.includes(build.classId) &&
        !(build.variantRules?.dualClass && build.classId2 && f.traits.includes(build.classId2)) &&
        !f.traits.includes('archetype')
      )
        return false;
      // Kineticist impulses are gated to the elements of your kinetic gate (incl. elements gained via
      // Fork the Path): an impulse feat is only available if it carries one of your elements.
      if ((build.classId === 'kineticist' || (build.variantRules?.dualClass && build.classId2 === 'kineticist')) && f.traits.includes('impulse')) {
        const elements = kineticistElements(build, build.level).map((id) => id.replace(/-gate$/, ''));
        if (elements.length && !f.traits.some((t) => elements.includes(t))) return false;
      }
      // Fighter Combat/Improved Flexibility bonus slots take a fighter feat of level ≤8 (L9 slot) / ≤14 (L15).
      if (p.category === 'bonus' && build.classId === 'fighter' && (!f.traits.includes('fighter') || f.level > p.level - 1))
        return false;
      return true;
    });
  };

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
  // Wizards learn a SPELLBOOK (a single budget across ranks) and prepare from it.
  const isWizardBook = !!casting && isPrepared && casterCls?.id === 'wizard';
  const spellbookSize = wizardSpellbookSize(build.level);
  const learnedTotal = Object.values(build.spells).reduce((n, arr) => n + arr.length, 0);
  const slotCounts = casting
    ? casterSlots(build.level, castProgression)
    : archCaster
      ? archetypeSlots(build.level, archCaster.tier)
      : {};
  const cantripCap = casting ? cantripsKnown(build.classId) : archCaster?.config.cantrips ?? 0;
  // The built character, used to evaluate feat prerequisites in the picker and the stats rail.
  // Memoized so the full per-level build pipeline runs once per build change, not 2–3× per render.
  const featPrereqChar = useMemo(() => buildCharacter(build, content), [build, content]);
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
    for (const s of Object.values(content.spells)) {
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
  const eligibleSpells = (rank: number) => {
    if (!tradition) return NO_SPELLS;
    return rank === 0 ? spellIndex.cantrips[tradition] ?? NO_SPELLS : spellIndex.upTo[tradition]?.[rank] ?? NO_SPELLS;
  };
  const familiarAbilityList = useMemo(
    () => Object.values(content.familiarAbilities).sort((a, b) => a.name.localeCompare(b.name)),
    [content],
  );

  // --- per-level spell progression (spells are chosen on the level where they're gained) ---
  // Spell slots per rank at a given character level (0 = before play).
  const slotsAt = (L: number): Record<number, number> =>
    L < 1 ? {} : casting ? casterSlots(L, castProgression) : archCaster ? archetypeSlots(L, archCaster.tier) : {};
  // Wizard spellbook budget (a single across-rank total) at a given level.
  const bookAt = (L: number) => (L < 1 ? 0 : wizardSpellbookSize(L));
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
        {atFirst && archCaster?.config.choiceTradition && (
          <div className="spell-pick-row">
            <div className="spr-head">
              <span>Tradition</span>
              <span className="spr-count">your choice</span>
            </div>
            <div className="spr-chips">
              {(archCaster.config.traditionOptions ?? (['arcane', 'divine', 'occult', 'primal'] as const)).map((t) => (
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
              <button className="spr-add" type="button" onClick={() => setPicker({ kind: 'spell', rank: 0, cap: cantripCap })}>
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
                      <button className="spr-add" type="button" disabled={learnedTotal >= bookAt(lvl)} onClick={() => setPicker({ kind: 'spell', rank, cap: bookAt(lvl) })}>
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
                          className={'spr-chip-sig' + (build.signatures[rank] === id ? ' on' : '')}
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
                  <button className="spr-add" type="button" disabled={chosen.length >= capR} onClick={() => setPicker({ kind: 'spell', rank, cap: capR })}>
                    + add
                  </button>
                </div>
              </div>
            );
          })}
      </div>
    );
  };

  // The class feature at `lvl` that anchors the subclass choice (Doctrine / Bloodline / …),
  // if the subclass is granted at this level — shared by the pending count and the render.
  const subclassAnchorId = (lvl: number): string | null => {
    const cls = build.classId ? content.classes[build.classId] : undefined;
    if (!cls?.subclass) return null;
    const g = levelGrants(lvl, build.classId, content, build.subclassId, build.variantRules, build.classId2, build.subclassId2);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const sn = norm(cls.subclass.name);
    const exact = g.features.find((f) => norm(f.name) === sn);
    if (exact) return exact.id;
    const part = g.features.find((f) => {
      const fn = norm(f.name);
      return fn.includes(sn) || sn.includes(fn);
    });
    return part?.id ?? null;
  };

  // How many required choices at this level are still unfilled (feat slots, subclass,
  // skill increase, attribute boosts). 0 = the level is fully set.
  const pendingCount = (lvl: number) => {
    const g = levelGrants(lvl, build.classId, content, build.subclassId, build.variantRules, build.classId2, build.subclassId2);
    let n = g.featSlots.filter((c, i) => !build.featPicks[slotKey(lvl, c, i)]).length;
    if (g.skillIncrease && !build.skillIncreases[lvl]) n++;
    if (g.attributeBoosts && new Set((build.attributeBoosts[lvl] ?? []).filter(Boolean)).size < attributeBoostCount(build.variantRules)) n++;
    if (subclassAnchorId(lvl) && !build.subclassId) n++;
    return n;
  };

  // Has a required choice at this level been left unfilled? (Only matters at or
  // below the target level — higher levels aren't part of the character yet.)
  const requiredUnmet = (lvl: number) => pendingCount(lvl) > 0;

  const nextRank = (cur: ProficiencyRank, lvl: number): ProficiencyRank => {
    const ni = Math.min(PROFICIENCY_RANKS.indexOf(cur) + 1, PROFICIENCY_RANKS.indexOf(skillIncreaseCap(lvl)));
    return PROFICIENCY_RANKS[Math.max(ni, PROFICIENCY_RANKS.indexOf(cur))];
  };
  // The rank one step above `cur` (expert→master→legendary), ignoring the level cap — used for the
  // skill-increase label so a not-yet-allowed bump still reads "E → M" (greyed) rather than "E — max".
  const naturalNextRank = (cur: ProficiencyRank): ProficiencyRank =>
    PROFICIENCY_RANKS[Math.min(PROFICIENCY_RANKS.indexOf(cur) + 1, PROFICIENCY_RANKS.length - 1)];

  return (
    <div className="builder">
      <header className="builder-head">
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
              // Lowering drops the current top level. Confirm only if choices were made there.
              if (hasChoicesAtLevel(build, build.level)) setConfirmLowerTo(build.level - 1);
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
        <button className="b-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="b-create" onClick={() => onCreate(build)}>
          {initial ? 'Save changes' : 'Create'}
        </button>
      </header>

      <div className="lstrip">
        {strip.map((s) => {
          const future = typeof s === 'number' && s > build.level;
          const pending = typeof s === 'number' && s >= 1 && s <= build.level && requiredUnmet(s);
          return (
            <button
              key={String(s)}
              className={'lchip' + (s === sel ? ' on' : '') + (future ? ' future' : '') + (pending ? ' pending' : '')}
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
                <OptionsCard build={build} actions={actions} content={content} />
                <VariantRulesCard build={build} actions={actions} content={content} />
              </div>
            </div>
          )}

          {sel === 0 && (
            <>
              <div className="card-sec lvl-page">
                <div className="lvl-page-head">
                  <span className="bsec-title">Level 0</span>
                  <span className="lvl-sub-tag">character creation</span>
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
                    <SkillEditor build={build} actions={actions} content={content} />
                    <LanguageEditor build={build} actions={actions} content={content} />
                  </div>
                </div>
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
              const future = lvl > build.level;
              const pending = pendingCount(lvl);
              const g = levelGrants(lvl, build.classId, content, build.subclassId, build.variantRules, build.classId2, build.subclassId2);
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

              return (
                <>
                <div className="card-sec lvl-page">
                  <div className="lvl-page-head">
                    <span className="bsec-title">Level {lvl}</span>
                    {future ? (
                      <span className="lvl-future-tag">future level</span>
                    ) : pending > 0 ? (
                      <span className="lvl-pending-tag">
                        <i className="ti ti-alert-circle" aria-hidden="true" /> {pending} {pending === 1 ? 'choice' : 'choices'} left
                      </span>
                    ) : anyContent ? (
                      <span className="lvl-done-tag">
                        <i className="ti ti-check" aria-hidden="true" /> all set
                      </span>
                    ) : null}
                  </div>

                  {future && (
                    <div className="setup-note" style={{ marginBottom: 10 }}>
                      Your character is level {build.level}. These choices unlock at level {lvl}.{' '}
                      <button className="link-btn" onClick={() => actions.setLevel(lvl)}>
                        Advance to level {lvl}
                      </button>
                    </div>
                  )}

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
                            </div>
                          ))}
                        {bgFeatAtThisLevel &&
                          (() => {
                            const ft = content.feats[bg!.grantedFeatId!];
                            const nm = ft?.name ?? bg!.grantedFeatId!;
                            return (
                              <div className="lvl-gain-block">
                                <div className="lvl-gain">
                                  <i className="ti ti-star lvl-gain-ic" aria-hidden="true" />
                                  <span className="lvl-gain-name">{nm}</span>
                                  <span className="lvl-gain-tag">skill feat · granted</span>
                                </div>
                                <ChoiceDetails name={nm} flavor={ft?.description} descRefs={ft?.descRefs} />
                              </div>
                            );
                          })()}
                      </div>
                    </div>
                  )}

                  <fieldset className="lvl-choice-zone" disabled={future} style={future ? { opacity: 0.55 } : undefined}>
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
                          {cls?.subclass &&
                            subAnchorId &&
                            build.subclassId &&
                            (() => {
                              const opt = cls.subclass!.options.find((o) => o.id === build.subclassId);
                              return opt ? <ChoiceDetails name={opt.name} flavor={opt.description} descRefs={opt.descRefs} /> : null;
                            })()}
                          {g.featSlots.map((catg, i) => {
                      const key = slotKey(lvl, catg, i);
                      const picked = build.featPicks[key];
                      return (
                        <div className="lvl-slot-wrap" key={key}>
                          <div className="lvl-slot">
                            <button
                              className={'lvl-card' + (picked ? '' : ' empty')}
                              type="button"
                              onClick={() => setPicker({ kind: 'feat', level: lvl, category: catg, idx: i })}
                            >
                              <span className="lvl-card-icon">
                                <i className={'ti ' + FEAT_ICON[catg]} aria-hidden="true" />
                              </span>
                              <div className="lvl-card-text">
                                <div className="lvl-card-label">{FEAT_LABEL[catg]}</div>
                                <div className="lvl-card-val">{picked ? content.feats[picked]?.name ?? picked : 'Choose…'}</div>
                              </div>
                              {!picked && <span className="lvl-pending">!</span>}
                            </button>
                            {picked && (
                              <button
                                className="lvl-clear-btn"
                                type="button"
                                aria-label="Clear feat"
                                onClick={() => actions.setFeat(key, null)}
                              >
                                <i className="ti ti-x" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                          {picked && content.feats[picked] && (
                            <ChoiceDetails
                              name={content.feats[picked]!.name}
                              flavor={content.feats[picked]!.description}
                              descRefs={content.feats[picked]!.descRefs}
                            />
                          )}
                          {picked &&
                            content.feats[picked]?.choice &&
                            (() => {
                              const def = content.feats[picked]!.choice!;
                              const opts =
                                def.kind === 'domains'
                                  ? ((build.deityId ? content.deities[build.deityId]?.domains : undefined) ?? []).map((d) => ({
                                      value: d,
                                      label: cap(d),
                                    }))
                                  : def.options ?? [];
                              return (
                                <SubCard icon="ti-adjustments" label={def.prompt}>
                                  <PopupSelect
                                    title={def.prompt}
                                    placeholder={`${def.prompt}…`}
                                    value={build.featChoices[key] ?? ''}
                                    onChange={(v) => actions.setFeatChoice(key, v)}
                                    options={opts.map((o) => ({ value: o.value, label: o.label }))}
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
                                  options={[
                                    { value: '', label: '— none —' },
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
                                    options={[
                                      { value: '', label: '— none —' },
                                      ...saves.map(([v, label]) => ({ value: v, label, disabled: !allowed(v) })),
                                    ]}
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
                {!future && renderSpellsForLevel(lvl)}
                </>
              );
            })()}
        </div>

        <aside className="brail">
          <div className="brail-title">Character</div>
          <FullStats build={build} content={content} character={featPrereqChar} />
        </aside>
      </div>

      {picker && picker.kind === 'feat' && (() => {
        const isClassSlot = picker.category === 'class';
        // The "two feats before a new dedication" rule — taken feats excluding this slot.
        const pickerKey = slotKey(picker.level, picker.category, picker.idx);
        const takenForRule = Object.entries(build.featPicks)
          .filter(([k, v]) => v && k !== pickerKey)
          .map(([, v]) => v);
        const dedicationOK = canTakeNewDedication(takenForRule, content);
        const feats = eligibleFor(picker)
          // Class slots: hide archetype feats unless the Archetypes toggle is on.
          .filter((f) => !isClassSlot || showArch || !f.traits.includes('archetype'))
          // When showing archetypes, surface the dedications (entry points) first.
          .sort((a, b) => {
            const ad = a.traits.includes('dedication') ? 0 : 1;
            const bd = b.traits.includes('dedication') ? 0 : 1;
            return ad - bd || a.level - b.level || a.name.localeCompare(b.name);
          });
        return (
          <FilterableSelect
            title={`Choose a ${FEAT_LABEL[picker.category].toLowerCase()}`}
            icon="ti-medal"
            items={feats}
            spec={FEAT_SPEC}
            rowKey={(f) => f.id}
            onClose={() => setPicker(null)}
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
              const disabled = !pre.met || dedBlocked;
              const reason = dedBlocked
                ? 'Take two feats from your current archetype first.'
                : !pre.met && f.prerequisites && f.prerequisites.length > 0
                  ? `Requires: ${f.prerequisites.join(', ')}`
                  : undefined;
              const node = descNodeOf(f, 'feats');
              return (
                <PickerRow
                  lead={<span className="picker-lvl">{f.level}</span>}
                  name={f.name}
                  meta={
                    <>
                      {f.traits.length > 0 && <div className="picker-traits">{f.traits.join(' · ')}</div>}
                      {dedBlocked && <div className="picker-prereq">Take two feats from your current archetype first.</div>}
                      {f.prerequisites && f.prerequisites.length > 0 && (
                        <div className="picker-prereq">
                          {pre.met ? 'Requires: ' : 'Requires (unmet): '}
                          {f.prerequisites.join(', ')}
                        </div>
                      )}
                    </>
                  }
                  onOpenDesc={node ? () => openDesc(node) : undefined}
                  selectLabel="Choose"
                  selectDisabled={disabled}
                  disabledReason={reason}
                  dim={disabled}
                  onSelect={() => {
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
        // Wizards cap by the total spellbook budget; others by the rank's slot count.
        const cap_ =
          picker.cap ?? (picker.rank === 0 ? cantripCap : isWizardBook ? spellbookSize : slotCounts[picker.rank] ?? 0);
        const have =
          picker.rank === 0 ? build.cantrips.length : isWizardBook ? learnedTotal : (build.spells[picker.rank] ?? []).length;
        const atCap = have >= cap_;
        const isCantrip = picker.rank === 0;
        const preparedMode = !isCantrip && isPrepared && !isWizardBook;
        return (
          <FilterableSelect
            key={'spell-' + picker.rank}
            title={picker.rank === 0 ? 'Add cantrip' : `Add ${ord(picker.rank)}-rank spell`}
            items={eligibleSpells(picker.rank)}
            spec={SPELL_SPEC_BUILDER}
            rowKey={(sp) => sp.id}
            onClose={() => setPicker(null)}
            headerExtra={
              <span className="fsel-cap" style={{ color: atCap ? 'var(--app-warn)' : undefined }}>
                {have} / {cap_}
              </span>
            }
            renderRow={(sp, openDesc) => {
              const list = isCantrip ? build.cantrips : build.spells[picker.rank] ?? [];
              const count = list.filter((x) => x === sp.id).length;
              const chosen = count > 0;
              const disabled = preparedMode ? atCap : !chosen && atCap;
              const node = descNodeOf(sp, 'spells');
              return (
                <PickerRow
                  lead={preparedMode && count > 0 ? <span className="picker-count">×{count}</span> : undefined}
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
                  onSelect={() =>
                    isCantrip
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
                You&apos;ve made choices at <strong>level {confirmLowerTo + 1}</strong> (a feat, skill increase, or
                attribute boost). Lowering to <strong>level {confirmLowerTo}</strong> stops applying them.
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
  );
}
