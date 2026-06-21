import { useMemo, useState } from 'react';
import type { ActionCost, Character, ContentDatabase, PinnedDesc, ProficiencyKey } from '../rules/types';
import { ABILITIES, SKILLS } from '../rules/types';
import {
  abilityMod,
  deriveArmorCheckPenalty,
  deriveSkill,
  deriveStrikes,
  formatMod,
  critSpecSources,
  strikeShowsCritSpec,
  skillTakesArmorPenalty,
  type Strike,
} from '../rules/derive';
import { togglePin, togglePinnedDesc, toggleTactic, descId, type PlayState } from '../rules/play';
import { critSpec } from '../rules/critSpec';
import { ACTIVITIES } from '../rules/actions';
import { traitDesc } from '../rules/glossary';
import { statHasConditionalMode, type StatRef } from '../rules/explain';
import { ActionGlyph, RankPill } from './widgets';
import { DescriptionModal } from './DescriptionModal';
import { StrikeDetailModal } from './StrikeDetailModal';
import { InfoTerm } from './InfoTerm';
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
}

export function MainTab({
  character,
  content,
  onPlay,
  onRoll,
  onOpenStat,
}: {
  character: Character;
  content: ContentDatabase;
  onPlay?: (fn: (play: PlayState) => PlayState) => void;
  onRoll?: (label: string, modifier: number) => void;
  /** Open the breakdown panel for an ability score or skill. */
  onOpenStat?: (ref: StatRef) => void;
}) {
  const [mode, setMode] = useState('enc');
  const [sub, setSub] = useState<'strikes' | 'actions'>('strikes');
  const [filters, setFilters] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  // A pinned description re-opened from the Pinned section.
  const [openDesc, setOpenDesc] = useState<DescNode | null>(null);
  // The strike whose detail popup is open (clicked from a strike row).
  const [strikeDetail, setStrikeDetail] = useState<Strike | null>(null);

  const loreKeys = Object.keys(character.proficiencies.skills).filter((k) =>
    k.startsWith('lore:'),
  ) as ProficiencyKey[];
  const skillKeys: ProficiencyKey[] = [...SKILLS, ...loreKeys];
  // These derivations are unchanged by the sheet's transient header state (XP draft, etc.); memoize
  // on [character, content] so a keystroke in the header doesn't re-run the whole strike/crit pipeline.
  const acp = useMemo(() => deriveArmorCheckPenalty(character, content), [character, content]);
  const strikes = useMemo(() => deriveStrikes(character, content), [character, content]);
  // Crit-spec sources the character has (class features, feats, subclass/doctrine), each with the
  // level it activates + any weapon restriction. A Strike shows its crit-spec effect only when a
  // source actually covers that weapon — computed per strike below.
  const critSources = useMemo(() => critSpecSources(character, content), [character, content]);
  const encActivities: Act[] = ACTIVITIES.filter((a) => a.mode === 'encounter');
  const exploreActivities: Act[] = ACTIVITIES.filter((a) => a.mode === 'exploration');
  const downtimeActivities: Act[] = ACTIVITIES.filter((a) => a.mode === 'downtime');
  // Feats that ARE a curated activity (Bon Mot, Battle Medicine) already appear under Skill
  // actions — exclude them here so they aren't listed twice (and don't collide on pin key).
  const activityNames = new Set(ACTIVITIES.map((a) => a.name));
  // Only feats that grant an actual ACTION (1–3 actions / reaction / free / variable) belong
  // here — passive feats (Toughness, Natural Ambition, …) carry actionCost {type:'passive'}
  // and must NOT be listed as activities.
  const isActionCost = (c?: ActionCost) =>
    !!c && (c.type === 'actions' || c.type === 'reaction' || c.type === 'free' || c.type === 'variable');
  const featActions: Act[] = character.feats
    .map((f) => content.feats[f.featId])
    .filter((f) => !!f && isActionCost(f.actionCost) && !activityNames.has(f.name))
    .map((f) => ({ name: f!.name, cost: f!.actionCost as ActionCost, desc: f!.description }));
  // Commander folio tactics are Action items the character knows — listed in their own section.
  const tacticActions: (Act & { id: string })[] = (character.commanderTactics?.folio ?? [])
    .map((id) => content.actions[id])
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => ({ id: a.id, name: a.name, cost: a.actionCost, desc: a.description }));
  const preparedTactics = new Set(character.commanderTactics?.prepared ?? []);
  const tacticPreparedMax = character.commanderTactics?.preparedMax ?? 3;
  // Item actions: activatable carried items (consumables, or invested/worn/equipped magic items).
  const itemActions: (Act & { key: string })[] = (character.inventory ?? [])
    .map((inv) => ({ inv, item: content.items[inv.itemId] }))
    .filter(({ inv, item }) => !!item?.activationCost && (item.itemType === 'consumable' || inv.invested || inv.equipped || inv.worn))
    .map(({ inv, item }) => ({ key: `itemact:${inv.instanceId}`, name: item!.name, cost: item!.activationCost, desc: item!.description }));

  const pinned = new Set(character.pinned ?? []);
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

  const pinnedStrikes = strikes.filter((s) => pinned.has(strikeKey(s.instanceId)));
  const pinnedActions = [...featActions, ...tacticActions, ...encActivities].filter((a) => pinned.has(actionKey(a.name)));
  const pinnedDescs = character.pinnedDescs ?? [];
  const hasPinned = pinnedStrikes.length + pinnedActions.length + pinnedDescs.length > 0;

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
        onClick={() => onPlay((p) => togglePin(p, k))}
      >
        <i className="ti ti-star" aria-hidden="true" />
      </button>
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
          <span className="strike-dmg">{s.damage}</span>
        </div>
        {(s.group || (s.ranged && s.range != null)) && (
          <div className="strike-meta">
            {s.ranged && s.range != null && <span>Range {s.range} ft</span>}
            {s.reload != null && s.reload > 0 && <span>Reload {s.reload}</span>}
            {s.specDamage ? <span title="Weapon specialization (included in the damage above)">Spec +{s.specDamage}</span> : null}
            {s.group && <span className="strike-group">{s.group.charAt(0).toUpperCase() + s.group.slice(1)}</span>}
          </div>
        )}
        {critSpec(s.group) && strikeShowsCritSpec(s, critSources) && (
          <div className="strike-crit">
            <span className="sc-label">Crit</span>
            {critSpec(s.group)}
          </div>
        )}
      </div>
    );
  }

  function ActionRow({
    a,
    pinnable = true,
    prepared,
    onPrepare,
    prepareDisabled,
  }: {
    a: Act;
    pinnable?: boolean;
    /** When defined, renders a "prepared" toggle (Commander tactics); the value is its on/off state. */
    prepared?: boolean;
    onPrepare?: () => void;
    prepareDisabled?: boolean;
  }) {
    return (
      <div className={'action' + (onPrepare && !prepared ? ' unprepared' : '')}>
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
            {a.skill && <span className="action-skill">{a.skill}</span>}
          </div>
          <div className="action-desc">{a.desc}</div>
        </div>
        {onPrepare && (
          <button
            className={'prep-toggle' + (prepared ? ' on' : '')}
            title={prepared ? 'Prepared today — click to unprepare' : 'Prepare this tactic'}
            aria-label={prepared ? 'Unprepare tactic' : 'Prepare tactic'}
            disabled={!prepared && prepareDisabled}
            onClick={onPrepare}
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

  function PinnedDescRow({ node }: { node: PinnedDesc }) {
    return (
      <div className="pinned-desc">
        <button className="pinned-desc-open" onClick={() => setOpenDesc(node)} title={`Open ${node.title}`}>
          <i className="ti ti-book-2" aria-hidden="true" />
          <span className="pinned-desc-title">{node.title}</span>
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
      <section className="card">
        <div className="ct">
          <i className="ti ti-rosette" aria-hidden="true" />
          Ability scores
          <span className="ct-note">★ key ability</span>
        </div>
        <div className="abilities">
          {ABILITIES.map((ab) => {
            const partial = character.partialBoosts?.includes(ab) ?? false;
            return (
              <div
                className={'ability' + (character.keyAbility === ab ? ' key' : '') + (partial ? ' partial' : '') + (onOpenStat ? ' openable' : '')}
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
            const penalized = acp.value < 0 && skillTakesArmorPenalty(key);
            const note = penalized ? `${formatMod(acp.value)} armor check penalty (${acp.source})` : '';
            return (
              <div
                className={'skill' + (onOpenStat ? ' rollable' : '') + (statHasConditionalMode(character, { kind: 'skill', skill: key }) ? ' has-mode' : '')}
                key={key}
                onClick={onOpenStat ? () => onOpenStat({ kind: 'skill', skill: key }) : undefined}
                title={[onOpenStat ? `${skillLabel(key)} — how is this calculated?` : '', note].filter(Boolean).join(' · ') || undefined}
              >
                <RankPill rank={d.rank} />
                <span className="skill-name">{skillLabel(key)}</span>
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

      {hasPinned && (
        <section className="card pinned-card">
          <div className="ct">
            <i className="ti ti-star" aria-hidden="true" /> Pinned
          </div>
          {pinnedStrikes.map((s) => (
            <StrikeRow key={s.instanceId} s={s} />
          ))}
          {pinnedActions.map((a) => (
            <ActionRow key={a.name} a={a} />
          ))}
          {pinnedDescs.map((n) => (
            <PinnedDescRow key={descId(n)} node={n} />
          ))}
        </section>
      )}

      <section className="card">
        <div className="acts-head">
          <div className="ct" style={{ margin: 0 }}>
            <i className="ti ti-swords" aria-hidden="true" />
            Activities
          </div>
          <div className="seg">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={'seg-btn' + (mode === m.id ? ' on' : '')} onClick={() => setMode(m.id)}>
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
            <div className="af-row">
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
          )}
        </div>

        {mode === 'enc' ? (
          <>
            <div className="subtabs">
              <button type="button" role="tab" aria-selected={sub === 'strikes'} className={'stab' + (sub === 'strikes' ? ' on' : '')} onClick={() => setSub('strikes')}>
                Strikes
              </button>
              <button type="button" role="tab" aria-selected={sub === 'actions'} className={'stab' + (sub === 'actions' ? ' on' : '')} onClick={() => setSub('actions')}>
                Actions
              </button>
            </div>

            {sub === 'strikes' ? (
              <div className="strikes">
                {shownStrikes.map((s) => (
                  <StrikeRow key={s.instanceId} s={s} />
                ))}
                {shownStrikes.length === 0 && <div className="acts-empty">No strikes match.</div>}
              </div>
            ) : (
              <div className="actions">
                {shownTactics.length > 0 && (
                  <>
                    <div className="acts-sec-label">
                      Tactics
                      {character.commanderTactics && (
                        <span className="acts-sec-note">
                          {' '}
                          · folio {character.commanderTactics.folio.length}/{character.commanderTactics.folioMax} · prepared{' '}
                          {preparedTactics.size}/{tacticPreparedMax} · {character.commanderTactics.squadmates} squadmates
                        </span>
                      )}
                    </div>
                    {shownTactics.map((a) => (
                      <ActionRow
                        key={a.id}
                        a={a}
                        prepared={preparedTactics.has(a.id)}
                        prepareDisabled={preparedTactics.size >= tacticPreparedMax}
                        onPrepare={onPlay ? () => onPlay((p) => toggleTactic(p, a.id, tacticPreparedMax)) : undefined}
                      />
                    ))}
                  </>
                )}
                {shownFeats.length > 0 && (
                  <>
                    <div className="acts-sec-label">Feat actions</div>
                    {shownFeats.map((a) => (
                      <ActionRow key={a.name} a={a} />
                    ))}
                  </>
                )}
                {shownBasic.length > 0 && (
                  <>
                    <div className="acts-sec-label">Basic actions</div>
                    {shownBasic.map((a) => (
                      <ActionRow key={a.name} a={a} />
                    ))}
                  </>
                )}
                {shownSkill.length > 0 && (
                  <>
                    <div className="acts-sec-label">Skill actions</div>
                    {shownSkill.map((a) => (
                      <ActionRow key={a.name} a={a} />
                    ))}
                  </>
                )}
                {shownItemActions.length > 0 && (
                  <>
                    <div className="acts-sec-label">Item actions</div>
                    {shownItemActions.map((a) => (
                      <ActionRow key={a.key} a={a} pinnable={false} />
                    ))}
                  </>
                )}
                {shownTactics.length + shownFeats.length + shownBasic.length + shownSkill.length + shownItemActions.length ===
                  0 && <div className="acts-empty">No actions match.</div>}
              </div>
            )}
          </>
        ) : (
          <div className="actions">
            <div className="acts-sec-label">
              {mode === 'exp' ? 'Exploration activities' : 'Downtime activities'}
            </div>
            {(mode === 'exp' ? shownExplore : shownDowntime).map((a) => (
              <ActionRow key={a.name} a={a} pinnable={false} />
            ))}
            {(mode === 'exp' ? shownExplore : shownDowntime).length === 0 && (
              <div className="acts-empty">No activities match.</div>
            )}
          </div>
        )}
      </section>

      {openDesc && <DescriptionModal root={openDesc} onClose={() => setOpenDesc(null)} />}
      {strikeDetail && (
        <StrikeDetailModal
          strike={strikeDetail}
          character={character}
          content={content}
          onOpenStat={onOpenStat}
          onClose={() => setStrikeDetail(null)}
        />
      )}
    </div>
  );
}
