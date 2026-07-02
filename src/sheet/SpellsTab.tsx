import { useMemo, useState, type ReactNode } from 'react';
import type { ActionCost, Character, ContentDatabase, Spell, SpellcastingEntry } from '../rules/types';
import { deriveSpellcasting, deriveClassDc, formatMod } from '../rules/derive';
import {
  poolKey,
  preparedKey,
  removeInventoryItem,
  resetPreparedEntry,
  resetRepertoire,
  setFocusUsed,
  setItemCounter,
  setItemQuantity,
  setPreparedSpell,
  setRepertoireRank,
  setSignatureSpells,
  setSlotsUsed,
  toggleExpended,
  toggleInnateCast,
  type PlayUpdater,
} from '../rules/play';
import { itemCounters, chargesFor, chargeCounterId, chargeCostToCast, canCastFromItem } from '../rules/itemUses';
import { getMpProperty, imbuementGrantedSpells } from '../rules/monsterParts';
import { ActionGlyph } from './widgets';
import { ItemDetail } from './ItemDetail';
import { useEscapeClose } from './useEscapeClose';
import { useIsMobile } from './useIsMobile';
import { FilterableSelect, PickerRow, descNodeOf } from './FilterableSelect';
import { SPELL_SPEC_BUILDER } from './filterSpecs';
import { DescBody } from './DescBody';
import { InfoTerm } from './InfoTerm';
import { PinStar } from './PinStar';
import { useContent } from './ContentContext';
import { usePrefs } from '../data/prefs';
import { traitDesc } from '../rules/glossary';
import type { StatRef } from '../rules/explain';
import { spellCostMatches } from '../rules/spellFilter';
import { heighteningApplies, splitHeightening, scaleDamage, scaleArea } from '../rules/heightening';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Splice a highlighted "(→ heightened)" right after the FIRST standalone occurrence of the base damage
 * formula in the spell prose (the ⟦…⟧ markers become a .up-heighten span in RichText). Tries the full
 * formula then the dice-only part; leaves the text unchanged when the formula isn't found (best-effort).
 */
function injectDamageArrow(text: string, baseFormula: string, heightened: string): string {
  const dice = baseFormula.replace(/\s*[+-]\s*\d+$/, '');
  for (const pat of dice === baseFormula ? [baseFormula] : [baseFormula, dice]) {
    const body = escapeRe(pat).replace(/\\\+/g, '\\s*\\+\\s*');
    const re = new RegExp(`(?<![\\dd])(${body})(?![\\dd])`);
    if (re.test(text)) return text.replace(re, `$1 ⟦(→ ${heightened})⟧`);
  }
  return text;
}

/**
 * Ids of a spontaneous entry's signature spells that should ECHO (display-only, starred) at `rank`:
 * a signature spell can be cast — heightened — from any slot of its base rank OR HIGHER, so it
 * appears at every higher rank that has a slot pool. Returns [] for rank 0 (cantrips never echo),
 * for ranks with no slot pool, and skips a spell already repertoired at that rank. The spell stays
 * repertoired only at its base rank; echoes never touch the data model or the known-spell count.
 */
export function signatureEchoIds(entry: SpellcastingEntry, rank: number, baseRank: (id: string) => number): string[] {
  if (rank <= 0 || !entry.slots?.[rank]?.max) return [];
  const here = entry.repertoire?.[rank] ?? [];
  return (entry.signature ?? []).filter((id) => baseRank(id) < rank && !here.includes(id));
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function ord(r: number): string {
  return r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`;
}

/** Detail overlay for a single spell, including its heightening entries. */
function castText(c?: ActionCost): string {
  if (!c) return '';
  if (c.type === 'duration') return c.text;
  return ''; // actions / reaction / free / variable are all shown by the action glyph
}

function SpellDetail({ spell, maxRank, signature, onClose }: { spell: Spell; maxRank?: number; signature?: boolean; onClose: () => void }) {
  const content = useContent();
  useEscapeClose(onClose);
  const { base, heightening } = splitHeightening(spell.description || '');
  const baseRank = spell.rank;
  const isCantrip = baseRank === 0;
  const top = Math.min(10, Math.max(baseRank, maxRank ?? baseRank));
  // Only spontaneous SIGNATURE spells can be freely re-ranked, so they're the only ones with a "cast
  // at" picker. Cantrips auto-heighten to your max (viewed there, no picker); everything else is viewed
  // at its set rank (highlighted, no picker).
  const showPicker = !!signature && top > baseRank;
  const autoRank = isCantrip ? top : baseRank;
  const [castRank, setCastRank] = useState<number>(showPicker ? baseRank : autoRank);
  const r = showPicker ? castRank : autoRank;
  // Upcast scaling at the viewed rank — inline damage in the prose, area on the stat.
  const upDamage = scaleDamage(spell, r);
  const upArea = scaleArea(spell, r);
  const shownBase = upDamage && spell.baseDamage ? injectDamageArrow(base, spell.baseDamage, upDamage) : base;
  const rankLabel = spell.rank === 0 ? 'Cantrip' : `${ord(spell.rank)} rank`;
  const stats: [string, string | undefined][] = [
    ['Cast', undefined],
    ['Range', spell.range],
    ['Area', spell.area],
    ['Targets', spell.targets],
    ['Duration', spell.duration],
    ['Defense', spell.save ? `${spell.save.basic ? 'basic ' : ''}${cap(spell.save.type)}` : undefined],
  ];
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker spell-detail" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          {spell.name}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <PinStar node={{ title: spell.name, description: spell.description, descRefs: spell.descRefs, key: 'spells' }} />
            <button className="picker-close" onClick={onClose} aria-label="Close">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </span>
        </div>
        <div className="sd-body">
          <div className="sd-sub">
            {rankLabel}
            {spell.traditions?.length ? ` · ${spell.traditions.map(cap).join(', ')}` : ''}
          </div>
          {spell.traits?.length > 0 && (
            <div className="sd-traits">
              {spell.traits.map((t) => (
                <InfoTerm className="ff-trait" key={t} title={cap(t)} description={traitDesc(t, content)}>
                  {t}
                </InfoTerm>
              ))}
            </div>
          )}
          <div className="sd-stats">
            {stats.map(([label, val]) =>
              label === 'Cast' ? (
                <div className="sd-stat" key="Cast">
                  <span className="sd-stat-k">Cast</span>
                  <span className="sd-stat-v">{castText(spell.cast) || <ActionGlyph cost={spell.cast} />}</span>
                </div>
              ) : val ? (
                <div className="sd-stat" key={label}>
                  <span className="sd-stat-k">{label}</span>
                  <span className="sd-stat-v">
                    {val}
                    {label === 'Area' && upArea != null && spell.baseArea && (
                      <span className="up-heighten"> (→ {upArea}-foot {spell.baseArea.kind})</span>
                    )}
                  </span>
                </div>
              ) : null,
            )}
          </div>
          {showPicker ? (
            // Signature spells: pick the cast rank.
            <div className="sd-rank-sel">
              <span className="sd-rank-lbl">Cast at</span>
              {Array.from({ length: top - Math.max(1, baseRank) + 1 }, (_, k) => Math.max(1, baseRank) + k).map((rr) => (
                <button key={rr} className={'sd-rank-chip' + (rr === r ? ' on' : '')} onClick={() => setCastRank(rr)}>
                  {ord(rr)}
                </button>
              ))}
            </div>
          ) : r > baseRank ? (
            // No choice (e.g. a cantrip auto-heightened to your max) — just highlight the viewed rank.
            <div className="sd-rank-sel">
              <span className="sd-rank-lbl">Cast at</span>
              <span className="sd-rank-chip on sd-rank-static">{ord(r)}</span>
            </div>
          ) : null}
          {shownBase && <DescBody description={shownBase} descRefs={spell.descRefs} onExit={onClose} />}
          {heightening.length > 0 && (
            <div className="sd-heighten">
              <div className="sd-heighten-h">Heightening</div>
              {heightening.map((h, i) => (
                <DescBody
                  key={i}
                  description={h}
                  descRefs={spell.descRefs}
                  className={'sd-desc' + (r > baseRank && heighteningApplies(h, baseRank, r) ? ' applies' : '')}
                  onExit={onClose}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** In-play spell management. PREPARED casters: change what's prepared in each slot
 *  (from the wizard's spellbook or the whole tradition list). SPONTANEOUS casters:
 *  add/remove repertoire spells per rank and set a signature spell (one per rank). */
function ManageSpellsModal({
  entry,
  character,
  content,
  onPlay,
  onClose,
}: {
  entry: SpellcastingEntry;
  character: Character;
  content: ContentDatabase;
  onPlay: PlayUpdater;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const spontaneous = !!entry.repertoire;
  const [picking, setPicking] = useState<{ rank: number; slot: number | null } | null>(null);
  const ranks = Object.keys((spontaneous ? entry.repertoire : entry.prepared) ?? {})
    .map(Number)
    .sort((a, b) => a - b);

  const cls = character.classId ? content.classes[character.classId] : undefined;
  const sigAvailable =
    spontaneous && (cls?.features ?? []).some((f) => f.featureId === 'signature-spells' && f.level <= character.level);

  // Index this tradition's spells ONCE (not a full-map scan per modal re-render). `byRank` is the
  // exact-rank list (cantrips, exact-rank fallbacks); `upTo[N]` is the CUMULATIVE rank-1..N list, so
  // a slot of rank N can hold any spell of rank ≤ N (cast/prepared heightened to the slot's rank).
  const traditionSpellsByRank = useMemo(() => {
    const byRank: Record<number, Spell[]> = {};
    for (const s of Object.values(content.spells)) {
      if (s.traditions.includes(entry.tradition)) (byRank[s.rank] ??= []).push(s);
    }
    const upTo: Record<number, Spell[]> = {};
    let acc: Spell[] = [];
    for (let r = 1; r <= 10; r++) {
      if (byRank[r]) acc = acc.concat(byRank[r]);
      upTo[r] = acc.slice().sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    }
    return { byRank, upTo };
  }, [content, entry.tradition]);

  // Spells you may add (spontaneous) / prepare (prepared) at a rank — rank ≤ the slot's rank.
  const optionsFor = (rank: number): Spell[] => {
    if (spontaneous) {
      const known = new Set(entry.repertoire?.[rank] ?? []);
      const pool = rank === 0 ? traditionSpellsByRank.byRank[0] ?? [] : traditionSpellsByRank.upTo[rank] ?? [];
      return pool.filter((s) => !known.has(s.id));
    }
    if (entry.spellbook) {
      if (rank === 0) return (entry.spellbook[0] ?? []).map((id) => content.spells[id]).filter(Boolean) as Spell[];
      const out: Spell[] = [];
      for (let r = 1; r <= rank; r++) for (const id of entry.spellbook[r] ?? []) { const sp = content.spells[id]; if (sp) out.push(sp); }
      return out;
    }
    return rank === 0 ? traditionSpellsByRank.byRank[0] ?? [] : traditionSpellsByRank.upTo[rank] ?? [];
  };

  // A spontaneous caster knows at most as many spells per rank as they have slots of that
  // rank (the PF2e repertoire cap). Infinity if the rank has no slot pool (shouldn't happen).
  const repCap = (rank: number) => entry.slots?.[rank]?.max ?? Infinity;

  const pick = (spellId: string | null) => {
    if (picking) {
      if (spontaneous) {
        if (spellId) {
          const cur = entry.repertoire?.[picking.rank] ?? [];
          // The cap counts only player-CHOSEN spells — granted (bloodline/mystery/conscious-mind) spells
          // live in the repertoire too but don't count, matching the "Add" button's display gate. Counting
          // the full array here silently dropped a legal add whenever chosen + granted filled the slots.
          const granted = entry.grantedRepertoire?.[picking.rank] ?? [];
          const chosenCount = cur.filter((id) => !granted.includes(id)).length;
          if (!cur.includes(spellId) && chosenCount < repCap(picking.rank))
            onPlay((p) => setRepertoireRank(p, entry.id, picking.rank, [...cur, spellId]));
        }
      } else {
        onPlay((p) => setPreparedSpell(p, entry.id, picking.rank, picking.slot!, spellId));
      }
    }
    setPicking(null);
  };

  const removeKnown = (rank: number, id: string) => {
    const cur = entry.repertoire?.[rank] ?? [];
    onPlay((p) => setRepertoireRank(p, entry.id, rank, cur.filter((x) => x !== id)));
  };

  // One signature spell per rank: toggling a new one drops any existing same-rank signature.
  const toggleSig = (rank: number, id: string) => {
    const cur = entry.signature ?? [];
    if (cur.includes(id)) {
      onPlay((p) => setSignatureSpells(p, entry.id, cur.filter((x) => x !== id)));
    } else {
      const sameRank = new Set(entry.repertoire?.[rank] ?? []);
      onPlay((p) => setSignatureSpells(p, entry.id, [...cur.filter((x) => !sameRank.has(x)), id]));
    }
  };

  const reset = () => onPlay((p) => (spontaneous ? resetRepertoire(p, entry.id) : resetPreparedEntry(p, entry.id)));

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker manage-spells" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span>{`${spontaneous ? 'Repertoire' : 'Prepare'} — ${cap(entry.tradition)} spells`}</span>
          <button className="picker-close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {picking ? (
          <FilterableSelect
            key={'pick-' + picking.rank}
            title={`${spontaneous ? 'Add' : 'Prepare'} a ${ord(picking.rank)}-rank spell`}
            items={optionsFor(picking.rank)}
            spec={SPELL_SPEC_BUILDER}
            rowKey={(s) => s.id}
            onClose={() => setPicking(null)}
            headerExtra={
              !spontaneous ? (
                <button className="fsel-arch" onClick={() => pick(null)}>
                  Leave slot empty
                </button>
              ) : undefined
            }
            renderRow={(s, openDesc) => {
              const node = descNodeOf(s, 'spells');
              return (
                <PickerRow
                  lead={
                    <span className="spell-cost">
                      <ActionGlyph cost={s.cast} />
                    </span>
                  }
                  name={s.name}
                  meta={<div className="picker-traits">{s.rank === 0 ? 'Cantrip' : `${ord(s.rank)} rank`}</div>}
                  onOpenDesc={node ? () => openDesc(node) : undefined}
                  selectLabel={spontaneous ? 'Add' : 'Prepare'}
                  onSelect={() => pick(s.id)}
                />
              );
            }}
          />
        ) : (
          <div className="ms-body">
            <div className="ms-hint">
              {spontaneous
                ? 'Add or remove known spells; tap ★ to set a rank’s signature spell. Changes apply to this play session.'
                : 'Tap a slot to change what’s prepared. Changes apply to this play session.'}
            </div>
            {ranks.map((rank) =>
              spontaneous ? (
                (() => {
                  // Bloodline/mystery/muse spells are added FOR FREE — they don't count toward the
                  // known-spells cap and can't be removed in play.
                  const granted = entry.grantedRepertoire?.[rank] ?? [];
                  const knownCount = (entry.repertoire?.[rank] ?? []).filter((id) => !granted.includes(id)).length;
                  return (
                <div key={rank} className="ms-rank">
                  <div className="ms-rank-hdr">{ord(rank)} rank</div>
                  {(entry.repertoire?.[rank] ?? []).map((id) => {
                    const sp = content.spells[id];
                    const isSig = entry.signature?.includes(id);
                    const isGranted = granted.includes(id);
                    return (
                      <div key={id} className={'ms-slot' + (isSig ? ' sig' : '')}>
                        {sigAvailable && (
                          <button
                            className={'ms-sig' + (isSig ? ' on' : '')}
                            title={isSig ? 'Signature spell — click to unset' : 'Set as signature spell'}
                            aria-label="Toggle signature spell"
                            onClick={() => toggleSig(rank, id)}
                          >
                            <i className="ti ti-star" aria-hidden="true" />
                          </button>
                        )}
                        <span className="ms-slot-name">{sp?.name ?? id}</span>
                        {isGranted ? (
                          <span className="ms-granted" title="Granted by your bloodline/mystery — always known">
                            <i className="ti ti-lock" aria-hidden="true" />
                          </span>
                        ) : (
                          <button
                            className="ms-remove"
                            aria-label="Remove from repertoire"
                            title="Remove from repertoire"
                            onClick={() => removeKnown(rank, id)}
                          >
                            <i className="ti ti-x" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {knownCount < repCap(rank) ? (
                    <button className="ms-add" onClick={() => setPicking({ rank, slot: null })}>
                      <i className="ti ti-plus" aria-hidden="true" /> Add {ord(rank)}-rank spell
                    </button>
                  ) : (
                    <div className="ms-cap-note">Repertoire full ({repCap(rank)} known)</div>
                  )}
                </div>
                  );
                })()
              ) : (
                <div key={rank} className="ms-rank">
                  <div className="ms-rank-hdr">{ord(rank)} rank</div>
                  {(entry.prepared?.[rank] ?? []).map((slot, i) => {
                    const sp = slot.spellId ? content.spells[slot.spellId] : null;
                    return (
                      <button
                        key={i}
                        className={'ms-slot' + (slot.spellId ? '' : ' empty')}
                        onClick={() => setPicking({ rank, slot: i })}
                      >
                        <span className="ms-slot-name">{sp?.name ?? (slot.spellId || 'Empty slot')}</span>
                        <i className="ti ti-pencil" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              ),
            )}
            <button className="ms-reset" onClick={reset}>
              <i className="ti ti-rotate" aria-hidden="true" /> Reset to default {spontaneous ? 'repertoire' : 'preparation'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const COST_FILTERS: { id: string; label: string; cost: ActionCost }[] = [
  { id: '1', label: 'one action', cost: { type: 'actions', value: 1 } },
  { id: '2', label: 'two actions', cost: { type: 'actions', value: 2 } },
  { id: '3', label: 'three actions', cost: { type: 'actions', value: 3 } },
  { id: 'f', label: 'free action', cost: { type: 'free' } },
  { id: 'r', label: 'reaction', cost: { type: 'reaction' } },
];

function SpellCard({
  name,
  cost,
  meta,
  sig,
  fp,
  pip,
  onPip,
  empty,
  onClick,
  onCast,
  castDisabled,
  castTitle,
}: {
  name: string;
  cost?: ActionCost;
  meta: string;
  sig?: boolean;
  fp?: boolean;
  pip?: 'filled' | 'empty';
  /** When set, the slot pip becomes a button that expends/restores this slot. */
  onPip?: () => void;
  empty?: boolean;
  onClick?: () => void;
  /** When set, a "Cast" button on the card spends the item's charges to cast this spell. */
  onCast?: () => void;
  castDisabled?: boolean;
  castTitle?: string;
}) {
  return (
    <div
      className={'spell-card' + (empty ? ' empty' : '') + (onClick ? ' clickable' : '')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
    >
      <div className="spell-top">
        <span className="spell-cost">
          <ActionGlyph cost={cost} />
        </span>
        <span className="spell-name">{name}</span>
        {sig && <i className="ti ti-star spell-star" aria-hidden="true" />}
      </div>
      <div className="spell-meta">
        <span className="spell-meta-text">{meta}</span>
        {fp && <span className="fp-tag">1 FP</span>}
        {pip &&
          (onPip ? (
            <button
              type="button"
              className={'slot-pip btn' + (pip === 'filled' ? ' on' : '')}
              title={pip === 'filled' ? 'Cast — click to restore' : 'Click to cast (expend slot)'}
              aria-label={pip === 'filled' ? 'Restore slot' : 'Expend slot'}
              onClick={(e) => {
                e.stopPropagation();
                onPip();
              }}
            />
          ) : (
            <span className={'slot-pip' + (pip === 'filled' ? ' on' : '')} />
          ))}
        {onCast && (
          <button
            type="button"
            className="spell-cast-btn"
            disabled={castDisabled}
            title={castTitle ?? 'Cast'}
            aria-label={castTitle ?? 'Cast'}
            onClick={(e) => {
              e.stopPropagation();
              onCast();
            }}
          >
            <i className="ti ti-bolt" aria-hidden="true" /> Cast
          </button>
        )}
      </div>
    </div>
  );
}

export function SpellsTab({
  character,
  content,
  onPlay,
  onOpenStat,
}: {
  character: Character;
  content: ContentDatabase;
  onPlay?: PlayUpdater;
  onOpenStat?: (ref: StatRef) => void;
}) {
  const isMobile = useIsMobile();
  const prefs = usePrefs();
  const [filters, setFilters] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile: filter row toggles open over the results
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Spell | null>(null);
  // Mobile: the spellcasting-detail popup (which entry's details are shown), opened by tapping the header.
  const [scInfo, setScInfo] = useState<string | null>(null);
  // Mobile: which spell section tab is active (cantrips / a rank / focus / items / …); '' = first.
  const [spellTab, setSpellTab] = useState<string>('');
  const [manageId, setManageId] = useState<string | null>(null);
  // An item-spell source opened from its Spells-page header → the item's full detail popup.
  const [itemView, setItemView] = useState<string | null>(null);
  // Collapsible spellcasting sections (in-component, like the Actions sub-tab).
  const [collapsedSecs, setCollapsedSecs] = useState<Set<string>>(new Set());
  const secOpen = (id: string) => !collapsedSecs.has(id);
  const toggleSec = (id: string) =>
    setCollapsedSecs((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const SecChevron = ({ id }: { id: string }) => (
    <button type="button" className="sc-collapse" aria-expanded={secOpen(id)} title={secOpen(id) ? 'Collapse' : 'Expand'} onClick={() => toggleSec(id)}>
      <i className={'ti ' + (secOpen(id) ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
    </button>
  );
  const mains = character.spellcasting.filter((e) => e.type === 'prepared' || e.type === 'spontaneous');
  const manageEntry = manageId ? mains.find((m) => m.id === manageId) : null;
  const focus = character.spellcasting.find((e) => e.type === 'focus');
  const itemEntries = character.spellcasting.filter((e) => e.type === 'items' || e.type === 'innate');
  // The character's OWN rituals — added via Overrides → Add spell. Only these show; with none, the
  // Rituals section (and its catalog bar) is hidden entirely.
  const myRituals = useMemo(
    () =>
      (character.overrides?.addedSpells ?? [])
        .map((a) => content.spells[a.spellId])
        .filter((s): s is Spell => !!s && !!s.ritual)
        .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)),
    [character.overrides, content],
  );
  // Highest rank the character can cast — bounds the heightening rank selector. Includes the focus
  // auto-heighten target (ceil(level/2)) so a focus-only caster (champion/monk) can still see the
  // heightened text of e.g. Lay on Hands.
  const maxRank = Math.max(
    0,
    focus ? Math.ceil(character.level / 2) : 0,
    ...mains.flatMap((e) =>
      [...Object.keys(e.prepared ?? {}), ...Object.keys(e.repertoire ?? {}), ...Object.keys(e.slots ?? {})].map(Number),
    ),
  );
  const deityDomains = (character.details?.deityId ? content.deities[character.details.deityId]?.domains : undefined) ?? [];
  // Signature spells (spontaneous casters) — the only spells you can freely re-rank when casting, so
  // they're the only ones that keep the "cast at" rank picker in the detail view.
  const signatureIds = useMemo(
    () => new Set(character.spellcasting.flatMap((e) => (e.repertoire ? e.signature ?? [] : []))),
    [character.spellcasting],
  );
  const multi = mains.length > 1;

  function toggleFilter(id: string) {
    setFilters((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // ── Filtering: search by name + action-cost chips. When neither is active the
  // lists render verbatim (unchanged behaviour). ──────────────────────────────
  const query = search.trim().toLowerCase();
  const filtering = query !== '' || filters.size > 0;
  function matchesCostFilters(cost: ActionCost | undefined): boolean {
    if (filters.size === 0) return true;
    if (!cost) return false;
    for (const id of filters) {
      const def = COST_FILTERS.find((c) => c.id === id);
      if (def && spellCostMatches(cost, def.cost)) return true;
    }
    return false;
  }
  /** Whether a spell passes the active search + action-cost filters. */
  function visible(sp: Spell | undefined): boolean {
    if (!filtering) return true;
    if (!sp) return false;
    if (query && !sp.name.toLowerCase().includes(query)) return false;
    return matchesCostFilters(sp.cast);
  }

  // Only bail when the character has NO castable magic at all — a focus-only caster (champion, monk/
  // ranger with focus feats) or a staff/wand holder has no prepared/spontaneous pool but still needs
  // the focus / item / innate sections below.
  if (!mains.length && !focus && !itemEntries.length) {
    return (
      <div className="placeholder">
        <i className="ti ti-sparkles" aria-hidden="true" />
        <span>No spellcasting</span>
      </div>
    );
  }

  // The per-rank cards for ONE casting pool. A class may have two pools — e.g. the
  // animist's prepared "animist" pool and its spontaneous "apparition" pool.
  function buildRanks(main: SpellcastingEntry): { key: string; label: string; node: ReactNode; badge?: string }[] {
    const ranks: { key: string; label: string; node: ReactNode; badge?: string }[] = [];
    // Cantrips auto-heighten to the highest spell rank this pool can cast.
    const leveledRanks = [
      ...Object.keys(main.prepared ?? {}),
      ...Object.keys(main.repertoire ?? {}),
      ...Object.keys(main.slots ?? {}),
    ]
      .map(Number)
      .filter((r) => r > 0);
    const maxRank = leveledRanks.length ? Math.max(...leveledRanks) : 0;
    if (main.cantrips.length) {
      const cards = main.cantrips
        .map((id, i) => {
          const sp = content.spells[id];
          return sp && visible(sp) ? (
            <SpellCard key={id + i} name={sp.name} cost={sp.cast} meta="at will" onClick={() => setDetail(sp)} />
          ) : null;
        })
        .filter(Boolean);
      if (cards.length) {
        ranks.push({
          key: 'cantrips',
          label: 'Cantrips',
          node: (
            <div key="cantrips">
              <div className="spell-rankhdr">
                Cantrips
                <span className="spell-rankhdr-right">
                  {maxRank > 0 ? `at will · heightened to ${ord(maxRank)}` : 'at will'}
                </span>
              </div>
              <div className="spell-grid">{cards}</div>
            </div>
          ),
        });
      }
    }

  if (main.type === 'prepared' && main.prepared) {
    for (const rank of Object.keys(main.prepared).map(Number).sort((a, b) => a - b)) {
      const slots = main.prepared[rank];
      const used = slots.filter((s) => s.expended).length;
      const cards = slots
        .map((slot, i) => {
          if (!slot.spellId)
            return filtering ? null : <SpellCard key={i} name="Empty slot" meta={'rank ' + rank} pip="empty" empty />;
          const sp = content.spells[slot.spellId];
          if (!visible(sp)) return null;
          return (
            <SpellCard
              key={i}
              name={sp?.name ?? slot.spellId}
              cost={sp?.cast}
              meta={'rank ' + rank}
              pip={slot.expended ? 'filled' : 'empty'}
              onPip={onPlay ? () => onPlay((p) => toggleExpended(p, preparedKey(main.id, rank, i))) : undefined}
              onClick={sp ? () => setDetail(sp) : undefined}
            />
          );
        })
        .filter(Boolean);
      if (!cards.length) continue;
      ranks.push({
        key: 'r' + rank,
        label: ord(rank),
        badge: `${slots.length - used}/${slots.length}`,
        node: (
          <div key={'r' + rank}>
            <div className="spell-rankhdr">
              {ord(rank)} rank
              <span className="spell-rankhdr-right">
                {used} / {slots.length} slot{slots.length === 1 ? '' : 's'} used
              </span>
            </div>
            <div className="spell-grid">{cards}</div>
          </div>
        ),
      });
    }
  } else if (main.type === 'spontaneous' && main.repertoire) {
    // A signature spell can be cast (heightened) from ANY slot of its base rank or higher, so it
    // echoes — starred — at every higher rank that has a slot pool. Echoes are display-only: the
    // spell stays repertoired only at its base rank (no data-model change, no known-count impact).
    const allRanks = [...new Set([...Object.keys(main.repertoire), ...Object.keys(main.slots ?? {})].map(Number))].sort(
      (a, b) => a - b,
    );
    for (const rank of allRanks) {
      const ids = main.repertoire[rank] ?? [];
      const pool = main.slots?.[rank];
      const baseCards = ids
        .map((id, i) => {
          const sp = content.spells[id];
          if (!visible(sp)) return null;
          return (
            <SpellCard
              key={id + i}
              name={sp?.name ?? id}
              cost={sp?.cast}
              meta={'rank ' + rank}
              sig={main.signature?.includes(id)}
              onClick={sp ? () => setDetail(sp) : undefined}
            />
          );
        })
        .filter(Boolean);
      const echoCards = signatureEchoIds(main, rank, (id) => content.spells[id]?.rank ?? 0)
        .filter((id) => visible(content.spells[id]))
        .map((id) => {
          const sp = content.spells[id];
          return (
            <SpellCard
              key={'sig:' + id + ':' + rank}
              name={sp?.name ?? id}
              cost={sp?.cast}
              meta={'rank ' + rank + ' · signature'}
              sig={true}
              onClick={sp ? () => setDetail(sp) : undefined}
            />
          );
        });
      const cards = [...baseCards, ...echoCards];
      if (!cards.length) continue;
      ranks.push({
        key: 'r' + rank,
        label: ord(rank),
        badge: pool ? `${pool.max - pool.used}/${pool.max}` : undefined,
        node: (
        <div key={'r' + rank}>
          <div className="spell-rankhdr">
            {ord(rank)} rank
            <span className="spell-rankhdr-right">
              {pool && (
                <span className="pool-pips">
                  {Array.from({ length: pool.max }, (_, i) => {
                    const avail = pool.max - pool.used;
                    const on = i < avail;
                    // Click sets available to i+1 (fill up) or i (spend the top one) — like hero pips.
                    return onPlay ? (
                      <button
                        type="button"
                        key={i}
                        className={'slot-pip btn' + (on ? ' on' : '')}
                        aria-label="Toggle spell slot"
                        title={on ? 'Click to cast (expend slot)' : 'Click to restore slot'}
                        onClick={() =>
                          onPlay((p) => setSlotsUsed(p, poolKey(main.id, rank), pool.max - (i + 1 === avail ? i : i + 1), pool.max))
                        }
                      />
                    ) : (
                      <span key={i} className={'slot-pip' + (on ? ' on' : '')} />
                    );
                  })}
                </span>
              )}
              {pool ? `${pool.max - pool.used} / ${pool.max}` : ''}
            </span>
          </div>
          <div className="spell-grid">{cards}</div>
        </div>
        ),
      });
    }
  }

  // Divine Font — a second heal/harm-only prepared list (cleric). Battle Creed instead gets a BATTLE
  // FONT: Bane-or-Bless slots cast with the class DC.
  const isBattle = main.font?.type === 'battle';
  if (main.font && main.font.slots > 0 && (!filtering || isBattle || visible(content.spells[main.font.type]))) {
    const fontSpell = isBattle ? undefined : content.spells[main.font.type];
    const fr = main.font.rank ?? 1;
    const used = (main.font.expended ?? []).filter(Boolean).length;
    const allowedNames = isBattle ? (main.font.allowed ?? []).map((id) => content.spells[id]?.name ?? id).join(' / ') : '';
    ranks.push({
      key: 'font',
      label: isBattle ? 'Battle font' : 'Divine font',
      badge: `${main.font.slots - used}/${main.font.slots}`,
      node: (
      <div key="font">
        <div className="spell-rankhdr">
          {isBattle ? `Battle Font · ${allowedNames}` : `Divine Font · ${cap(main.font.type)}`}
          <span className="spell-rankhdr-right">
            {isBattle && main.font.useClassDc ? `Class DC ${deriveClassDc(character).dc} · ` : ''}
            {used} / {main.font.slots} used
          </span>
        </div>
        <div className="spell-grid">
          {Array.from({ length: main.font.slots }, (_, i) => (
            <SpellCard
              key={'font' + i}
              name={isBattle ? allowedNames || 'Bane / Bless' : fontSpell?.name ?? cap(main.font!.type)}
              cost={fontSpell?.cast}
              meta={ord(fr) + ' rank'}
              pip={(main.font!.expended ?? [])[i] ? 'filled' : 'empty'}
              onPip={onPlay ? () => onPlay((p) => toggleExpended(p, `${main.id}:font:${i}`)) : undefined}
              onClick={fontSpell ? () => setDetail(fontSpell) : undefined}
            />
          ))}
        </div>
      </div>
      ),
    });
  }
  return ranks;
  }

  const spellbookMain = mains.find((m) => m.spellbook);
  const spellbookCards: ReactNode[] = [];
  if (spellbookMain?.spellbook) {
    for (const rank of Object.keys(spellbookMain.spellbook).map(Number).sort((a, b) => a - b)) {
      for (const id of spellbookMain.spellbook[rank]) {
        const sp = content.spells[id];
        if (!visible(sp)) continue;
        spellbookCards.push(
          <SpellCard
            key={'sb' + rank + id}
            name={sp?.name ?? id}
            cost={sp?.cast}
            meta={ord(rank) + ' rank'}
            onClick={sp ? () => setDetail(sp) : undefined}
          />,
        );
      }
    }
  }

  const focusCards: ReactNode[] = [];
  if (focus?.repertoire) {
    // Focus spells auto-heighten to half your level rounded up — show that rank, not the base.
    const focusHeighten = Math.min(10, Math.ceil(character.level / 2));
    for (const rank of Object.keys(focus.repertoire).map(Number).sort((a, b) => a - b)) {
      for (const id of focus.repertoire[rank]) {
        const sp = content.spells[id];
        if (!visible(sp)) continue;
        const shown = Math.max(rank, focusHeighten);
        focusCards.push(
          <SpellCard
            key={id}
            name={sp?.name ?? id}
            cost={sp?.cast}
            meta={'rank ' + shown}
            fp
            onClick={sp ? () => setDetail(sp) : undefined}
          />,
        );
      }
    }
  }

  // ── Section nodes lifted out of the return so both the desktop stack AND the mobile
  // page-level tab row can render the SAME JSX. Each builder references in-scope locals
  // (secOpen, focusCards, onPlay, character, content, …) — unchanged from the inline version. ──

  const spellbookNode: ReactNode =
    spellbookCards.length > 0 ? (
      <section className="card">
        <div className="ct" style={{ margin: secOpen('spellbook') ? '0 0 10px' : 0 }}>
          <SecChevron id="spellbook" />
          <i className="ti ti-book" aria-hidden="true" />
          Spellbook
          <span className="ct-note">{spellbookCards.length} spell{spellbookCards.length === 1 ? '' : 's'}</span>
        </div>
        {secOpen('spellbook') && <div className="spell-grid">{spellbookCards}</div>}
      </section>
    ) : null;

  const focusNode: ReactNode = focus ? (
    <section className="card">
      <div className="focus-head">
        <div className="ct" style={{ margin: 0 }}>
          <SecChevron id="focus" />
          <i className="ti ti-flame" aria-hidden="true" />
          Focus spells
        </div>
        <div className="focus-pool">
          {Array.from({ length: character.focus?.max ?? 0 }, (_, i) => {
            const cur = character.focus?.current ?? 0;
            const fmax = character.focus?.max ?? 0;
            const on = i < cur;
            return onPlay ? (
              <button
                type="button"
                key={i}
                className={'focus-circ btn' + (on ? ' on' : '')}
                aria-label="Toggle focus point"
                title={on ? 'Spend focus point' : 'Restore focus point'}
                onClick={() => onPlay((p) => setFocusUsed(p, fmax - (i + 1 === cur ? i : i + 1), fmax))}
              />
            ) : (
              <span key={i} className={'focus-circ' + (on ? ' on' : '')} />
            );
          })}
          <span style={{ fontSize: 11.5, color: 'var(--app-text-dim)' }}>
            {character.focus?.current ?? 0} / {character.focus?.max ?? 0}
          </span>
          {onPlay && (character.focus?.current ?? 0) < (character.focus?.max ?? 0) && (
            <button
              className="refocus-btn"
              title="Refocus (restore 1 focus point)"
              onClick={() => {
                const fmax = character.focus?.max ?? 0;
                const used = fmax - (character.focus?.current ?? 0);
                onPlay((p) => setFocusUsed(p, used - 1, fmax));
              }}
            >
              <i className="ti ti-refresh" style={{ fontSize: 12 }} aria-hidden="true" /> Refocus
            </button>
          )}
        </div>
      </div>
      {secOpen('focus') &&
        (focusCards.length ? (
          <div className="spell-grid">{focusCards}</div>
        ) : (
          <div className="spell-empty">{filtering ? 'No focus spells match.' : 'No focus spells.'}</div>
        ))}
    </section>
  ) : null;

  // Extra spell sources: staff/wand held spells and innate spells — read-only cards, cast with your spell DC.
  const itemNodes: { id: string; name: string; node: ReactNode }[] = itemEntries.map((entry) => {
    const isInnate = entry.type === 'innate';
    const innateUsedSet = new Set(entry.innateUsed ?? []); // leveled innate spells cast today (1/day)
    // Item entries: resolve the inventory instance + def + its live charge counter (the SAME
    // inv.counters the Inventory edits → charges stay in sync both ways for free). The instance
    // id is on `itemInstanceId`, or recoverable from the entry id (`item:<instanceId>`) for
    // characters built before that field existed.
    const itemInstId = entry.itemInstanceId ?? (entry.type === 'items' && entry.id.startsWith('item:') ? entry.id.slice(5) : undefined);
    const itemInv = !isInnate && itemInstId ? character.inventory.find((iv) => iv.instanceId === itemInstId) : undefined;
    const itemDef = itemInv ? content.items[itemInv.itemId] : undefined;
    const counterId = itemDef ? chargeCounterId(itemDef) : null;
    const counter = itemDef && itemInv && counterId ? itemCounters(itemDef, itemInv).find((c) => c.id === counterId) : undefined;

    // Casting a rank-N held spell spends the item's charges (staff = N, wand = 1) or consumes a
    // single-use item. Per-spell cast props are attached to the leveled SpellCards below.
    const castProps = (rank: number) => {
      if (isInnate || !itemDef || !itemInv || !onPlay) return {};
      const cid = chargeCounterId(itemDef);
      const cost = chargeCostToCast(itemDef, rank);
      return {
        castDisabled: !canCastFromItem(itemDef, itemInv, rank),
        castTitle:
          cid === 'pool' ? `Cast — spend ${cost} charge${cost === 1 ? '' : 's'}` : cid === 'freq' ? 'Cast — uses the daily charge' : 'Cast — uses the item',
        onCast: () =>
          onPlay((p) => {
            if (cid === null) return itemInv.quantity > 1 ? setItemQuantity(p, itemInv.instanceId, itemInv.quantity - 1) : removeInventoryItem(p, itemInv.instanceId);
            const u = itemCounters(itemDef, itemInv).find((c) => c.id === cid);
            if (!u || cost <= 0) return p;
            return setItemCounter(p, itemInv.instanceId, cid, chargesFor(u, u.current - cost));
          }),
      };
    };

    const cards: ReactNode[] = [];
    for (const id of entry.cantrips) {
      const sp = content.spells[id];
      if (!visible(sp)) continue;
      cards.push(
        <SpellCard key={`${entry.id}:c:${id}`} name={sp?.name ?? id} cost={sp?.cast} meta={isInnate ? 'at will' : 'cantrip · at will'} onClick={sp ? () => setDetail(sp) : undefined} />,
      );
    }
    for (const rank of Object.keys(entry.repertoire ?? {}).map(Number).sort((a, b) => a - b)) {
      for (const id of entry.repertoire![rank]) {
        const sp = content.spells[id];
        if (!visible(sp)) continue;
        const cost = !isInnate && itemDef ? chargeCostToCast(itemDef, rank) : 0;
        const meta = isInnate
          ? `rank ${rank} · 1/day`
          : counterId === 'pool'
            ? `rank ${rank} · ${cost} charge${cost === 1 ? '' : 's'}`
            : counterId === 'freq'
              ? `rank ${rank} · 1/day`
              : `rank ${rank}`;
        cards.push(
          <SpellCard
            key={`${entry.id}:${rank}:${id}`}
            name={sp?.name ?? id}
            cost={sp?.cast}
            meta={meta}
            onClick={sp ? () => setDetail(sp) : undefined}
            pip={isInnate ? (innateUsedSet.has(id) ? 'empty' : 'filled') : undefined}
            onPip={isInnate && onPlay ? () => onPlay((p) => toggleInnateCast(p, entry.id, id)) : undefined}
            {...castProps(rank)}
          />,
        );
      }
    }
    return {
      id: entry.id,
      name: entry.name,
      node: (
        <section className="card" key={entry.id}>
          <div className="ct" style={{ margin: secOpen(entry.id) ? '0 0 10px' : 0 }}>
            <SecChevron id={entry.id} />
            <i className={'ti ' + (isInnate ? 'ti-sparkles' : 'ti-wand')} aria-hidden="true" />{' '}
            {!isInnate && itemDef && itemInv ? (
              <button type="button" className="sc-item-name" title="Open item details" onClick={() => setItemView(itemInv.instanceId)}>
                {entry.name}
              </button>
            ) : (
              entry.name
            )}
            <span style={{ fontSize: 11.5, color: 'var(--app-text-dim)', marginLeft: 6 }}>
              · {isInnate ? 'innate' : 'item'} spells ({entry.tradition.charAt(0).toUpperCase() + entry.tradition.slice(1)})
            </span>
            {counter && itemInv && (
              <span className="item-charges">
                {Array.from({ length: counter.max }, (_, i) => {
                  const on = i < counter.current;
                  return onPlay ? (
                    <button
                      key={i}
                      type="button"
                      className={'slot-pip btn' + (on ? ' on' : '')}
                      title={on ? 'Spend a charge' : 'Restore a charge'}
                      aria-label={on ? 'Spend a charge' : 'Restore a charge'}
                      onClick={() => onPlay((p) => setItemCounter(p, itemInv.instanceId, counter.id, chargesFor(counter, i + 1 === counter.current ? i : i + 1)))}
                    />
                  ) : (
                    <span key={i} className={'slot-pip' + (on ? ' on' : '')} />
                  );
                })}
                <span className="item-charges-n">
                  {counter.current}/{counter.max} {counter.label.toLowerCase()}
                </span>
              </span>
            )}
          </div>
          {secOpen(entry.id) &&
            (cards.length ? (
              <div className="spell-grid">{cards}</div>
            ) : (
              <div className="spell-empty">{filtering ? 'No spells match.' : 'No spells.'}</div>
            ))}
        </section>
      ),
    };
  });

  // Rituals the character has (added via Overrides). Hidden entirely when there are none.
  const ritualsNode: ReactNode = (() => {
    const shown = query ? myRituals.filter((s) => s.name.toLowerCase().includes(query)) : myRituals;
    if (!shown.length) return null;
    return (
      <section className="card">
        <div className="ct" style={{ margin: secOpen('rituals') ? '0 0 10px' : 0 }}>
          <SecChevron id="rituals" />
          <i className="ti ti-books" aria-hidden="true" /> Rituals
        </div>
        {secOpen('rituals') && (
          <div className="spell-grid">
            {shown.map((sp) => (
              <SpellCard
                key={`ritual:${sp.id}`}
                name={sp.name}
                cost={sp.cast}
                meta={`rank ${sp.rank}${sp.ritualPrimary ? ` · ${sp.ritualPrimary}` : ''}`}
                onClick={() => setDetail(sp)}
              />
            ))}
          </div>
        )}
      </section>
    );
  })();

  // Monster Parts: spells granted by imbued items (read-only; cast using your spell DC). Names are
  // matched to the spell database from the imbued-property text, so only confirmed spells appear.
  const monsterPartsNode: ReactNode = (() => {
    const imbued = character.inventory.filter((iv) => (iv.monsterPart?.imbuements?.length ?? 0) > 0);
    if (!imbued.length) return null;
    const mpNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const byName = new Map<string, string>();
    for (const sp of Object.values(content.spells)) byName.set(mpNorm(sp.name), sp.id);
    const freqLabel: Record<string, string> = { cantrip: 'at will', day: '1/day', hour: '1/hour', minute: '1/minute' };
    const rows: { spellId: string; freq: string; source: string }[] = [];
    const seen = new Set<string>();
    for (const iv of imbued) {
      const item = content.items[iv.itemId];
      if (!item) continue;
      for (const im of iv.monsterPart!.imbuements!) {
        const prop = getMpProperty(im.propertyId);
        if (!prop) continue;
        const path = prop.paths.find((p) => p.id === im.path) ?? prop.paths[0];
        if (!path) continue;
        for (const g of imbuementGrantedSpells(path, im.level)) {
          const id = byName.get(mpNorm(g.name));
          if (!id) continue;
          const key = `${id}:${iv.instanceId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({ spellId: id, freq: freqLabel[g.freq] ?? '1/day', source: `${item.name} · ${prop.name}` });
        }
      }
    }
    const shown = query ? rows.filter((r) => (content.spells[r.spellId]?.name ?? '').toLowerCase().includes(query)) : rows;
    if (!shown.length) return null;
    return (
      <section className="card">
        <div className="ct" style={{ margin: secOpen('monster-parts') ? '0 0 10px' : 0 }}>
          <SecChevron id="monster-parts" />
          <i className="ti ti-bone" aria-hidden="true" /> Monster Parts spells
          <span style={{ fontSize: 11.5, color: 'var(--app-text-dim)', marginLeft: 6 }}>· granted by imbued items</span>
        </div>
        {secOpen('monster-parts') && (
          <div className="spell-grid">
            {shown.map((r) => {
              const sp = content.spells[r.spellId];
              return <SpellCard key={`mp:${r.spellId}:${r.source}`} name={sp?.name ?? r.spellId} cost={sp?.cast} meta={`${r.freq} · ${r.source}`} onClick={sp ? () => setDetail(sp) : undefined} />;
            })}
          </div>
        )}
      </section>
    );
  })();

  // Unified mobile tab list: every pool's rank sections, then focus, items, spellbook, rituals, parts.
  // Order matches the desktop stacked layout. Only consumed on mobile, but computing always is fine.
  const spellTabs: { key: string; label: string; node: ReactNode; badge?: string }[] = [];
  for (const main of mains) {
    for (const s of buildRanks(main)) {
      spellTabs.push({ key: main.id + '/' + s.key, label: s.label, node: s.node, badge: s.badge });
    }
  }
  if (focus && focusNode)
    spellTabs.push({
      key: 'focus',
      label: 'Focus',
      node: focusNode,
      badge: character.focus && character.focus.max ? `${character.focus.current}/${character.focus.max}` : undefined,
    });
  for (const it of itemNodes) spellTabs.push({ key: it.id, label: it.name, node: it.node });
  if (spellbookNode) spellTabs.push({ key: 'spellbook', label: 'Book', node: spellbookNode });
  if (ritualsNode) spellTabs.push({ key: 'rituals', label: 'Rituals', node: ritualsNode });
  if (monsterPartsNode) spellTabs.push({ key: 'mp', label: 'Parts', node: monsterPartsNode });
  const spellTabActiveKey = spellTabs.some((t) => t.key === spellTab) ? spellTab : spellTabs[0]?.key;

  return (
    <div className="maincol">
      <div className="acts-controls" style={{ marginBottom: 0 }}>
        <div className="search">
          <i className="ti ti-search" aria-hidden="true" />
          <input placeholder="Search spells" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button className="search-clear" aria-label="Clear search" title="Clear" onClick={() => setSearch('')}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          )}
        </div>
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
      </div>

      {mains.map((main) => {
        const sc = deriveSpellcasting(character, main);
        const rankNodes = buildRanks(main);
        return (
          <div key={main.id}>
            <div className="card sc-head">
              <SecChevron id={main.id} />
              <div className="sc-info">
                <div className="sc-name-row">
                  {isMobile ? (
                    <button type="button" className="sc-name sc-name-btn" title="Spellcasting details" onClick={() => setScInfo(main.id)}>
                      {multi ? main.name : `${cap(main.tradition)} spellcasting`}
                      <i className="ti ti-info-circle" aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="sc-name">{multi ? main.name : `${cap(main.tradition)} spellcasting`}</span>
                  )}
                  {onPlay && (main.type === 'prepared' || main.type === 'spontaneous') && (
                    <button className="ms-btn" onClick={() => setManageId(main.id)} title="Manage spells for this session">
                      <i className="ti ti-pencil-plus" aria-hidden="true" /> {main.type === 'spontaneous' ? 'Repertoire' : 'Prepare'}
                    </button>
                  )}
                </div>
                <div className="sc-detail">
                  <div className="sc-sub">
                    {cap(main.type)} · key attribute {cap(main.keyAbility)}
                  </div>
                  {main.font && main.font.type === 'battle' && (
                    <div className="sc-sub">
                      Battle font: {main.font.slots} Bane/Bless slots (class DC, highest rank)
                    </div>
                  )}
                  {main.font && main.font.type !== 'battle' && (
                    <div className="sc-sub">
                      Divine font: {main.font.slots} extra {cap(main.font.type)} {main.font.slots === 1 ? 'spell' : 'spells'}{' '}
                      (highest rank)
                    </div>
                  )}
                  {!multi && deityDomains.length > 0 && <div className="sc-sub">Domains: {deityDomains.join(', ')}</div>}
                </div>
              </div>
              <div
                className={'tile' + (onOpenStat ? ' openable' : '')}
                title={onOpenStat ? 'How is this calculated?' : undefined}
                onClick={onOpenStat ? () => onOpenStat({ kind: 'spell', entryId: main.id, which: 'attack' }) : undefined}
              >
                <div className="tlab">Spell attack</div>
                <div className="tval">{formatMod(sc.attack)}</div>
              </div>
              <div
                className={'tile' + (onOpenStat ? ' openable' : '')}
                title={onOpenStat ? 'How is this calculated?' : undefined}
                onClick={onOpenStat ? () => onOpenStat({ kind: 'spell', entryId: main.id, which: 'dc' }) : undefined}
              >
                <div className="tlab">Spell DC</div>
                <div className="tval">{sc.dc}</div>
              </div>
            </div>
            {/* On mobile, only the header renders here; ALL sections live under the single
                page-level tab row below. On desktop, the per-main collapsible rank section. */}
            {!isMobile &&
              secOpen(main.id) && (
                <section className="card">
                  {rankNodes.length ? (
                    rankNodes.map((s) => s.node)
                  ) : (
                    <div className="spell-empty">
                      {filtering ? 'No spells match your search or filters.' : 'No spells prepared yet.'}
                    </div>
                  )}
                </section>
              )}
          </div>
        );
      })}

      {/* MOBILE: one page-level tab row covering every section (pools, focus, items, book, …). */}
      {isMobile &&
        (spellTabs.length ? (
          <>
            <div className="subtabs spell-subtabs">
              {spellTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={t.key === spellTabActiveKey}
                  className={'stab' + (t.key === spellTabActiveKey ? ' on' : '')}
                  onClick={() => setSpellTab(t.key)}
                >
                  {t.label}
                  {t.badge && prefs.showSlotBadges && <span className="stab-badge">{t.badge}</span>}
                </button>
              ))}
            </div>
            <section className="card">{(spellTabs.find((t) => t.key === spellTabActiveKey) ?? spellTabs[0])?.node}</section>
          </>
        ) : (
          <section className="card">
            <div className="spell-empty">
              {filtering ? 'No spells match your search or filters.' : 'No spells prepared yet.'}
            </div>
          </section>
        ))}

      {/* DESKTOP: the spellbook / focus / item & innate / rituals / monster-parts sections
          stacked exactly as before. On mobile these all live inside the page-level tab row above. */}
      {!isMobile && (
        <>
          {spellbookNode}
          {focusNode}
          {itemNodes.map((it) => it.node)}
          {ritualsNode}
          {monsterPartsNode}
        </>
      )}

      {scInfo &&
        (() => {
          const m = mains.find((x) => x.id === scInfo);
          if (!m) return null;
          return (
            <div className="picker-overlay" onClick={() => setScInfo(null)}>
              <div className="picker info-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                <div className="picker-head">
                  <span className="info-title">{multi ? m.name : `${cap(m.tradition)} spellcasting`}</span>
                  <button className="picker-close" aria-label="Close" onClick={() => setScInfo(null)}>
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </div>
                <div className="sc-detail-pop">
                  <div className="sc-sub">{cap(m.type)} · key attribute {cap(m.keyAbility)}</div>
                  {m.font && m.font.type === 'battle' && (
                    <div className="sc-sub">Battle font: {m.font.slots} Bane/Bless slots (class DC, highest rank)</div>
                  )}
                  {m.font && m.font.type !== 'battle' && (
                    <div className="sc-sub">
                      Divine font: {m.font.slots} extra {cap(m.font.type)} {m.font.slots === 1 ? 'spell' : 'spells'} (highest rank)
                    </div>
                  )}
                  {!multi && deityDomains.length > 0 && <div className="sc-sub">Domains: {deityDomains.join(', ')}</div>}
                </div>
              </div>
            </div>
          );
        })()}
      {detail && (
        <SpellDetail key={detail.id} spell={detail} maxRank={maxRank} signature={signatureIds.has(detail.id)} onClose={() => setDetail(null)} />
      )}
      {itemView &&
        (() => {
          const inv = character.inventory.find((iv) => iv.instanceId === itemView);
          const item = inv ? content.items[inv.itemId] : undefined;
          return inv && item ? (
            <ItemDetail inv={inv} item={item} content={content} inventory={character.inventory} onPlay={onPlay} onClose={() => setItemView(null)} />
          ) : null;
        })()}
      {manageEntry && onPlay && (
        <ManageSpellsModal
          entry={manageEntry}
          character={character}
          content={content}
          onPlay={onPlay}
          onClose={() => setManageId(null)}
        />
      )}
    </div>
  );
}
