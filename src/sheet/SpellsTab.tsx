import { useMemo, useState, type ReactNode } from 'react';
import { cleanRun } from './RichText';
import { listValues } from '../data';
import type { ActionCost, Character, ContentDatabase, Spell, SpellcastingEntry } from '../rules/types';
import { deriveSpellcasting, deriveClassDc, formatMod, ownedFeatureIds } from '../rules/derive';
import { toggleKnownRitual,
  poolKey,
  removeInventoryItem,
  resetPreparedEntry,
  resetRepertoire,
  setFocusUsed,
  setItemCounter,
  setItemQuantity,
  setPreparedSpell,
  setRestrictedSpell,
  setRestrictedRank,
  setTradedCantrip,
  setRepertoireRank,
  setSignatureSpells,
  setSlotsUsed,
  toggleExpended,
  toggleInnateCast,
  addSpellTrade,
  removeSpellTrade,
  spellTradeError,
  entryTrades,
  untradedIndices,
  slotKeyOf,
  tradeCost,
  CANTRIP_TRADE,
  CANTRIPS_PER_TRADE,
  type PlayUpdater,
} from '../rules/play';
import { itemCounters, chargesFor, chargeCounterId, chargeCostToCast, canCastFromItem } from '../rules/itemUses';
import { ActionGlyph, SituationalStar } from './widgets';
import { ItemDetail } from './ItemDetail';
import { useEscapeClose } from './useEscapeClose';
import { useIsMobile } from './useIsMobile';
import { confirmDialog } from './confirm';
import { FilterableSelect, PickerRow, descNodeOf } from './FilterableSelect';
import { SPELL_SPEC_BUILDER } from './filterSpecs';
import { DescBody } from './DescBody';
import { InfoTerm } from './InfoTerm';
import { PinStar } from './PinStar';
import { useContent } from './ContentContext';
import { useCustomization } from '../data/customization';
import { traitDesc, traitLabel } from '../rules/glossary';
import { spellSituationalFor, statHasSituational, statMarkClass, type StatRef } from '../rules/explain';
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
  // "Focus spells are automatically heightened to half your level rounded up" — the same treatment
  // cantrips get, and 480 spells carry the trait.
  const isFocus = (spell.traits ?? []).includes('focus');
  const top = Math.min(10, Math.max(baseRank, maxRank ?? baseRank));
  // Only spontaneous SIGNATURE spells can be freely re-ranked, so they're the only ones with a "cast
  // at" picker. Cantrips auto-heighten to your max (viewed there, no picker); everything else is viewed
  // at its set rank (highlighted, no picker).
  const showPicker = !!signature && top > baseRank;
  // Focus spells heighten automatically to your maximum, exactly as cantrips do — "focus spells are
  // automatically heightened to half your level rounded up". Only cantrips were covered, so a focus
  // spell's detail view showed its 1st-rank damage forever.
  const autoRank = isCantrip || isFocus ? top : baseRank;
  const [castRank, setCastRank] = useState<number>(showPicker ? baseRank : autoRank);
  const r = showPicker ? castRank : autoRank;
  // Upcast scaling at the viewed rank — inline damage in the prose, area on the stat.
  const upDamage = scaleDamage(spell, r);
  const upArea = scaleArea(spell, r);
  const shownBase = upDamage && spell.baseDamage ? injectDamageArrow(base, spell.baseDamage, upDamage) : base;
  const rankLabel = spell.rank === 0 ? 'Cantrip' : `${ord(spell.rank)} rank`;
  // These are printed as raw strings (not through the description renderer), so run them through the
  // same cleaner — a few records ship an unsubstituted AoN marker, e.g. Discomfiting Whisper's area
  // is "5-foot <%RULES%2387%%>emanation<%END>".
  const stats: [string, string | undefined][] = [
    ['Cast', undefined],
    ['Range', spell.range && cleanRun(spell.range)],
    ['Area', spell.area && cleanRun(spell.area)],
    ['Targets', spell.targets && cleanRun(spell.targets)],
    ['Duration', spell.duration && cleanRun(spell.duration)],
    [
      'Defense',
      // A spell attack (defense: 'ac') needs a spell attack roll vs AC; it may ALSO have a save.
      [
        spell.defense === 'ac' ? 'spell attack vs AC' : undefined,
        spell.save ? `${spell.save.basic ? 'basic ' : ''}${cap(spell.save.type)} save` : undefined,
      ]
        .filter(Boolean)
        .join(' + ') || undefined,
    ],
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
                <InfoTerm className="ff-trait" key={t} title={traitLabel(t)} description={traitDesc(t, content)}>
                  {traitLabel(t)}
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

/** Group in ENCOUNTER order — insertion order of the first member — so two restricted groups always
 *  render in the order the records granted them, not alphabetically. */
function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const cur = out.get(k);
    if (cur) cur.push(it);
    else out.set(k, [it]);
  }
  return [...out];
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
  const [picking, setPicking] = useState<{ rank: number; slot: number | null; cantripTrade?: boolean; restricted?: string } | null>(null);
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
    const hideLegacy = character.hideLegacy;
    // "Add Illusory Disguise, Illusory Object, and Illusory Scene to your spell list" (Fey Caller;
    // Dragon Arcana adds ten). Those spells are not in the entry's tradition, so a strict tradition
    // filter offered nothing and the feat was inert. They still cost a repertoire slot to learn.
    const added = new Set([
      ...(character.spellListAdditions?.['*'] ?? []),
      ...(character.spellListAdditions?.[entry.id] ?? []),
    ]);
    // …and whole traditions opened by a rule rather than a list — "one spell in your spell repertoire
    // not on the divine spell list" (Mysterious Repertoire). Expanding that into ids on the character
    // would be ~1,500 entries in every saved roster to say one sentence.
    const openTraditions = (character.spellListTraditions ?? []).filter((w) => !w.entryId || w.entryId === entry.id);
    const anyTradition = openTraditions.some((w) => w.traditions === 'any');
    const openSet = new Set(openTraditions.flatMap((w) => (w.traditions === 'any' ? [] : w.traditions)));
    // A class archetype may REPLACE the list rather than widen it — "Replace your spell list with the
    // elemental spell list … your actual magical tradition is unchanged". So this stands in for the
    // tradition test; everything else (feat additions, opened traditions) still applies on top.
    const rep = character.spellListReplacement;
    const repActive = !!rep && (!rep.entryId || rep.entryId === entry.id);
    const onList = (s: Spell): boolean => {
      if (!rep || !repActive) return s.traditions.includes(entry.tradition);
      // Only a spell that is on SOME list can be on a replaced one. Focus spells, rituals and the
      // class-granted cantrips (bard compositions, witch hexes, psychic amps) all carry no
      // tradition, which is exactly what kept them out of the ordinary picker for free — a rule
      // written on traits has to say so, or an elementalist wizard is offered Crushing Ground and
      // Entropic Wheel to write in a spellbook.
      if (!s.traditions.length) return !!s.spellLists?.includes(rep.list);
      if (s.spellLists?.includes(rep.list)) return true;
      // "Any spell that shares one or more traits with those in your elemental philosophy, and
      // doesn't have any traits that aren't in your elemental philosophy."
      if (!rep.anyTrait.length) return false;
      const t = s.traits ?? [];
      return t.some((x) => rep.anyTrait.includes(x)) && !t.some((x) => rep.excludeTraits.includes(x));
    };
    for (const s of listValues(content, content.spells)) {
      const e = (s as { edition?: string }).edition;
      if (e === 'superseded') continue; // renamed/outdated half of a remaster change — always hidden
      if (hideLegacy && (e === 'legacy' || e === 'legacy-era')) continue; // per-character Hide legacy data
      const opened = anyTradition || s.traditions.some((t) => openSet.has(t));
      if (onList(s) || added.has(s.id) || opened) (byRank[s.rank] ??= []).push(s);
    }
    const upTo: Record<number, Spell[]> = {};
    let acc: Spell[] = [];
    for (let r = 1; r <= 10; r++) {
      if (byRank[r]) acc = acc.concat(byRank[r]);
      upTo[r] = acc.slice().sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    }
    return { byRank, upTo };
  }, [content, entry.tradition, entry.id, character.hideLegacy, character.spellListAdditions, character.spellListTraditions, character.spellListReplacement]);

  const listReplacement = (() => {
    const r = character.spellListReplacement;
    return r && (!r.entryId || r.entryId === entry.id) ? r : undefined;
  })();

  // Spells you may add (spontaneous) / prepare (prepared) at a rank — rank ≤ the slot's rank.
  const optionsFor = (rank: number, restrictedId?: string): Spell[] => {
    // A restricted slot offers ONLY its allowed list — that is the entire point of the lane. When the
    // restriction is prose the engine can't check (a wizard's curriculum), `allowed` is absent and the
    // slot falls through to the normal options with the sentence shown beside it.
    // The `#2` suffix names the SECOND spell of a Spell Combination slot; the slot itself is the id
    // without it.
    const rs = restrictedId ? entry.restrictedSlots?.find((s) => s.id === restrictedId.replace(/#2$/, '')) : undefined;
    // A combination slot caps what it may hold BELOW its own rank ("each spell in the combination must
    // be 2 or more spell ranks below the slot's rank"), so the ceiling is the slot's, not the rank
    // being prepared.
    const ceiling = Math.min(rank, rs?.maxRank ?? rank);
    if (rs?.allowed?.length) {
      return rs.allowed
        .map((id) => content.spells[id])
        .filter((s): s is Spell => !!s && s.rank <= ceiling)
        .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    }
    if (spontaneous) {
      const known = new Set(entry.repertoire?.[rank] ?? []);
      const pool = ceiling === 0 ? traditionSpellsByRank.byRank[0] ?? [] : traditionSpellsByRank.upTo[ceiling] ?? [];
      return pool.filter((s) => !known.has(s.id));
    }
    if (entry.spellbook) {
      if (ceiling === 0) return (entry.spellbook[0] ?? []).map((id) => content.spells[id]).filter(Boolean) as Spell[];
      const out: Spell[] = [];
      for (let r = 1; r <= ceiling; r++) for (const id of entry.spellbook[r] ?? []) { const sp = content.spells[id]; if (sp) out.push(sp); }
      return out;
    }
    return ceiling === 0 ? traditionSpellsByRank.byRank[0] ?? [] : traditionSpellsByRank.upTo[ceiling] ?? [];
  };

  // A spontaneous caster knows at most as many spells per rank as they have slots of that
  // rank (the PF2e repertoire cap). Infinity if the rank has no slot pool (shouldn't happen).
  const repCap = (rank: number) => entry.slots?.[rank]?.max ?? Infinity;

  const pick = (spellId: string | null) => {
    if (picking) {
      if (picking.restricted) {
        onPlay((p) => setRestrictedSpell(p, picking.restricted!, spellId));
      } else if (spontaneous) {
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
        if (picking.cantripTrade) onPlay((p) => setTradedCantrip(p, entry.id, picking.slot!, spellId));
        else onPlay((p) => setPreparedSpell(p, entry.id, picking.rank, picking.slot!, spellId, entry.prepared?.[picking.rank]?.[picking.slot!]));
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
          <span>
            {/* A replaced list still casts on its own tradition, so name BOTH — an elementalist wizard
                is an arcane caster picking from the elemental list, and the header used to say only
                "Arcane spells" while offering something else entirely. */}
            {`${spontaneous ? 'Repertoire' : 'Prepare'} — ${listReplacement ? `${cap(listReplacement.list)} list (${cap(entry.tradition)})` : `${cap(entry.tradition)} spells`}`}
          </span>
          <button className="picker-close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        {listReplacement && (
          <div className="hint" style={{ margin: '0 0 8px' }}>
            {listReplacement.from} replaced your spell list with the {listReplacement.list} spell list; your tradition is
            unchanged.{listReplacement.note ? ` ${listReplacement.note}` : ''}
          </div>
        )}

        {picking ? (
          <FilterableSelect
            key={'pick-' + picking.rank}
            title={`${spontaneous && !picking.restricted ? 'Add' : 'Prepare'} a ${ord(picking.rank)}-rank spell`}
            items={optionsFor(picking.rank, picking.restricted)}
            spec={SPELL_SPEC_BUILDER}
            rowKey={(s) => s.id}
            onClose={() => setPicking(null)}
            headerExtra={
              !spontaneous || picking.restricted ? (
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
                  selectLabel={spontaneous && !picking.restricted ? 'Add' : 'Prepare'}
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
                            onClick={async () => {
                              if (
                                await confirmDialog({
                                  title: `Remove ${sp?.name ?? id}?`,
                                  message: 'The spell is removed from your repertoire.',
                                  confirmLabel: 'Remove',
                                  danger: true,
                                })
                              )
                                removeKnown(rank, id);
                            }}
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
                    // A slot traded away is not preparable — it is shown so the trade is visible, not
                    // so it can be filled.
                    if (slot.traded)
                      return (
                        <div key={i} className="ms-slot empty" aria-disabled="true">
                          <span className="ms-slot-name">Traded away (spell blending)</span>
                        </div>
                      );
                    return (
                      <button
                        key={i}
                        className={'ms-slot' + (slot.spellId ? '' : ' empty')}
                        onClick={() => setPicking({ rank, slot: i })}
                      >
                        <span className="ms-slot-name">
                          {sp?.name ?? (slot.spellId || 'Empty slot')}
                          {slot.bonusFrom != null && <em className="ms-slot-tag"> · bonus from {ord(slot.bonusFrom)}</em>}
                        </span>
                        <i className="ti ti-pencil" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              ),
            )}
            {/* Restricted slots — their own group, because they are not slots of the ranks above:
                what may go in them is narrower, and Sin Reservoir's rank moves at each preparation. */}
            {groupBy(entry.restrictedSlots ?? [], (s) => s.label).map(([label, group]) => (
              <div key={'rs-' + label} className="ms-rank">
                <div className="ms-rank-hdr">{label}</div>
                {group[0].note && <div className="ms-cap-note">{group[0].note}</div>}
                {group.map((slot) => {
                  const sp = slot.spellId ? content.spells[slot.spellId] : null;
                  // A spontaneous caster prepares nothing — its restricted slot is one extra CAST, so
                  // there is nothing here to pick and the sheet shows it as a pip.
                  if (slot.spontaneous)
                    return (
                      <div key={slot.id} className="ms-slot empty" aria-disabled="true">
                        <span className="ms-slot-name">
                          {ord(slot.rank)} rank — one extra cast<em className="ms-slot-tag"> · spend it on the sheet</em>
                        </span>
                      </div>
                    );
                  // Spell Combination: the slot holds TWO spells, so it shows two buttons. The second
                  // is keyed `<id>#2`, which rides the same prepared-spells map as the first.
                  const sp2 = slot.pairs && slot.spellId2 ? content.spells[slot.spellId2] : null;
                  return (
                    <div key={slot.id} style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                      <button className={'ms-slot' + (slot.spellId ? '' : ' empty')} style={{ flex: 1 }} onClick={() => setPicking({ rank: slot.rank, slot: null, restricted: slot.id })}>
                        <span className="ms-slot-name">
                          {sp?.name ?? (slot.spellId || 'Empty slot')}
                          <em className="ms-slot-tag"> · {ord(slot.rank)} rank{slot.maxRank ? ` · up to ${ord(slot.maxRank)}` : ''}</em>
                        </span>
                        <i className="ti ti-pencil" aria-hidden="true" />
                      </button>
                      {slot.pairs && (
                        <button
                          className={'ms-slot' + (slot.spellId2 ? '' : ' empty')}
                          style={{ flex: 1 }}
                          onClick={() => setPicking({ rank: slot.rank, slot: null, restricted: `${slot.id}#2` })}
                        >
                          <span className="ms-slot-name">
                            {sp2?.name ?? (slot.spellId2 || 'Empty — second spell')}
                            <em className="ms-slot-tag"> · combined</em>
                          </span>
                          <i className="ti ti-pencil" aria-hidden="true" />
                        </button>
                      )}
                      {!!slot.rankOptions?.length && (
                        <select
                          className="ms-rank-select"
                          aria-label="Slot rank"
                          value={slot.rank}
                          onChange={(ev) => onPlay((p) => setRestrictedRank(p, slot.id, Number(ev.target.value)))}
                        >
                          {slot.rankOptions.map((r) => (
                            <option key={r} value={r}>
                              {ord(r)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {!!entry.tradedCantrips?.length && (
              <div className="ms-rank">
                <div className="ms-rank-hdr">Traded cantrips</div>
                {entry.tradedCantrips.map((id, i) => {
                  const sp = id ? content.spells[id] : null;
                  return (
                    <button key={i} className={'ms-slot' + (id ? '' : ' empty')} onClick={() => setPicking({ rank: 0, slot: i, cantripTrade: true })}>
                      <span className="ms-slot-name">{sp?.name ?? 'Empty cantrip'}</span>
                      <i className="ti ti-pencil" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
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

/**
 * Spell Blending — the wizard thesis's daily slot trade.
 *
 * "During your daily preparations, you can trade two spell slots of the same spell rank for a bonus
 * spell slot of up to 2 spell ranks higher… Bonus spell slots must be of a spell rank you can normally
 * cast, and each bonus spell slot must be of a different spell rank. You can also trade any spell slot
 * for two additional cantrips, though you can't trade more than one spell slot at a time for
 * additional cantrips in this way."
 *
 * Every one of those limits is enforced by `spellTradeError`, whose sentence becomes the disabled
 * reason here — a silently ignored click would read as a broken button.
 */
function SpellBlendingModal({
  entry,
  onPlay,
  onClose,
}: {
  entry: SpellcastingEntry;
  onPlay: PlayUpdater;
  onClose: () => void;
}) {
  const ranks = Object.keys(entry.prepared ?? {})
    .map(Number)
    .filter((r) => r > 0)
    .sort((a, b) => a - b);
  const trades = entryTrades(entry);

  const targets = (from: number) => [from + 1, from + 2, CANTRIP_TRADE];
  const label = (to: number) => (to === CANTRIP_TRADE ? `${CANTRIPS_PER_TRADE} cantrips` : `${ord(to)} slot`);

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker manage-spells" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span>Spell Blending — trade slots</span>
          <button className="picker-close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="ms-body">
          <div className="ms-hint">
            Trade two slots of the same rank for one bonus slot up to two ranks higher, or one slot for{' '}
            {CANTRIPS_PER_TRADE} extra cantrips. Part of your daily preparations.
          </div>

          {trades.length > 0 && (
            <div className="ms-rank">
              <div className="ms-rank-hdr">Traded today</div>
              {trades.map((t, i) => (
                <div key={i} className="ms-slot">
                  <span className="ms-slot-name">
                    {t.to === CANTRIP_TRADE
                      ? `1 slot → ${CANTRIPS_PER_TRADE} cantrips`
                      : `2 × ${ord(t.from)} → one ${ord(t.to)} slot`}
                  </span>
                  <button className="ms-btn" onClick={() => onPlay((p) => removeSpellTrade(p, entry.id, t.to))}>
                    <i className="ti ti-rotate" aria-hidden="true" /> Undo
                  </button>
                </div>
              ))}
            </div>
          )}

          {ranks.map((from) => {
            const free = untradedIndices(entry, from).length;
            return (
              <div key={from} className="ms-rank">
                <div className="ms-rank-hdr">
                  {ord(from)} rank <span className="spell-rankhdr-right">{free} untraded</span>
                </div>
                {targets(from).map((to) => {
                  const err = spellTradeError(entry, from, to);
                  return (
                    <button
                      key={to}
                      className={'ms-slot' + (err ? ' empty' : '')}
                      disabled={!!err}
                      title={err ?? undefined}
                      onClick={() => onPlay((p) => addSpellTrade(p, entry, from, to))}
                    >
                      <span className="ms-slot-name">
                        {tradeCost(to)} × {ord(from)} → {label(to)}
                        {err && <em className="ms-slot-tag"> · {err}</em>}
                      </span>
                      {!err && <i className="ti ti-arrow-right" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
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
  marks,
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
  /** Ruling G: conditional bonuses that belong on THIS spell, because the spell is what you are
   *  looking at when you cast it. Display-only, like every other star. */
  marks?: { source: string; when: string; bonus: string }[];
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
        {!!marks?.length && (
          <span className="spell-mark" title={marks.map((m) => `${m.bonus} from ${m.source} — ${m.when}`).join('\n')}>
            <SituationalStar />
          </span>
        )}
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
  const custom = useCustomization();
  // Ruling G: a bonus that belongs to a SPELL marks the spell's own card, "since that's what you're
  // looking at when you cast it". Gated on the character actually having the record that grants it.
  const marksFor = (spellId?: string) => (spellId ? spellSituationalFor(character, content, spellId) : []);
  const [filters, setFilters] = useState<Set<string>>(new Set());
  /** The "Learn a ritual" picker. Rituals are tradition-less by rule, so 148 of the 151 are on no
   *  spell list and had no route onto the sheet except Setup → Overrides, the rule-breaking panel. */
  const [learningRitual, setLearningRitual] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile: filter row toggles open over the results
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Spell | null>(null);
  // Mobile: the spellcasting-detail popup (which entry's details are shown), opened by tapping the header.
  const [scInfo, setScInfo] = useState<string | null>(null);
  // Mobile: which spell section tab is active (cantrips / a rank / focus / items / …); '' = first.
  const [spellTab, setSpellTab] = useState<string>('');
  const [manageId, setManageId] = useState<string | null>(null);
  const [blendId, setBlendId] = useState<string | null>(null);
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
  const blendEntry = blendId ? mains.find((m) => m.id === blendId) : null;
  // The wizard's arcane thesis. It arrives as a classChoices row, which ownedFeatureIds folds in.
  const hasSpellBlending = useMemo(() => ownedFeatureIds(character, content).has('spell-blending'), [character, content]);
  const focusEntries = character.spellcasting.filter((e) => e.type === 'focus');
  const focus = focusEntries[0]; // first entry — for existence checks + maxCastRank; rendering uses focusEntries
  const itemEntries = character.spellcasting.filter((e) => e.type === 'items' || e.type === 'innate');
  // The character's OWN rituals: what Overrides → Add spell put here, PLUS what a record TAUGHT them
  // — "You learn the Commune ritual if you didn't know it already". Eleven feats/features/items say
  // exactly that, and none of them reached this list, so the section stayed empty for all of them.
  // With none from either source the section (and its catalog bar) is hidden entirely.
  const myRituals = useMemo(() => {
    const granted = new Map((character.grantedRituals ?? []).map((g) => [g.spellId, g]));
    const ids = [
      ...new Set([
        ...(character.overrides?.addedSpells ?? []).map((a) => a.spellId),
        ...granted.keys(),
        // …and the ones the player LEARNED, through the picker in the section below. 148 of the 151
        // rituals are on no spell list (rituals are tradition-less by rule), so before this the only
        // route to one was Setup → Overrides — the rule-BREAKING panel — for an ordinary thing a
        // character does.
        ...(character.knownRituals ?? []),
      ]),
    ];
    return ids
      .map((id) => content.spells[id])
      .filter((s): s is Spell => !!s && !!s.ritual)
      .map((s) => ({ spell: s, grant: granted.get(s.id) }))
      .sort((a, b) => a.spell.rank - b.spell.rank || a.spell.name.localeCompare(b.spell.name));
  }, [character.overrides, character.grantedRituals, character.knownRituals, content]);
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
  //
  // RITUALS are not spellcasting: "anyone can cast a ritual" given the skill proficiency, so a
  // fighter who has learned Commune belongs on this page. Bailing before the rituals section left a
  // non-caster unable to see one, learn one, or read one.
  if (!mains.length && !focus && !itemEntries.length && !myRituals.length && !onPlay) {
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
    // Cantrips auto-heighten to HALF YOUR LEVEL rounded up (ceil(level/2)) — by character level, NOT the
    // pool's highest slot rank. For a full caster the two coincide, but a spellcasting-archetype / multiclass
    // caster's slot ranks lag their level, so their cantrips must still heighten to ceil(level/2).
    const maxRank = Math.min(10, Math.ceil(character.level / 2));
    // Cantrips bought with Spell Blending sit beside the known ones, labelled, so a player can see
    // what today's trade actually bought them. An unfilled opening still shows, or the trade would
    // look like it did nothing.
    const tradedCantrips = main.tradedCantrips ?? [];
    if (main.cantrips.length || tradedCantrips.length) {
      const cards = main.cantrips
        .map((id, i) => {
          const sp = content.spells[id];
          return sp && visible(sp) ? (
            <SpellCard key={id + i} name={sp.name} cost={sp.cast} meta="at will" marks={marksFor(id)} onClick={() => setDetail(sp)} />
          ) : null;
        })
        .concat(
          tradedCantrips.map((id, i) => {
            const sp = id ? content.spells[id] : null;
            if (!sp) return filtering ? null : <SpellCard key={'tc' + i} name="Empty cantrip" meta="traded" empty />;
            return visible(sp) ? (
              <SpellCard key={'tc' + i} name={sp.name} cost={sp.cast} meta="traded · at will" marks={marksFor(sp.id)} onClick={() => setDetail(sp)} />
            ) : null;
          }),
        )
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
      // A slot traded away by Spell Blending is not a slot you have today, so it counts for nothing
      // here. `slots.length` is the ARRAY size — using it would over-count every traded rank.
      const live = slots.filter((s) => !s.traded);
      const used = live.filter((s) => s.expended).length;
      const cards = slots
        .map((slot, i) => {
          if (slot.traded)
            return filtering ? null : (
              <SpellCard key={i} name="Traded away" meta="spell blending" pip="empty" empty />
            );
          if (!slot.spellId)
            return filtering ? null : (
              <SpellCard key={i} name="Empty slot" meta={slot.bonusFrom != null ? `bonus · from ${ord(slot.bonusFrom)}` : 'rank ' + rank} pip="empty" empty />
            );
          const sp = content.spells[slot.spellId];
          if (!visible(sp)) return null;
          return (
            <SpellCard
              key={i}
              name={sp?.name ?? slot.spellId}
              marks={marksFor(slot.spellId)}
              cost={sp?.cast}
              meta={slot.bonusFrom != null ? `bonus · from ${ord(slot.bonusFrom)}` : 'rank ' + rank}
              pip={slot.expended ? 'filled' : 'empty'}
              // A bonus slot carries its own key, derived from the rank it was traded FROM, so undoing
              // a different trade can't renumber it and move this spell.
              onPip={onPlay ? () => onPlay((p) => toggleExpended(p, slotKeyOf(main.id, rank, i, slot))) : undefined}
              onClick={sp ? () => setDetail(sp) : undefined}
            />
          );
        })
        .filter(Boolean);
      if (!cards.length) continue;
      ranks.push({
        key: 'r' + rank,
        label: ord(rank),
        badge: `${live.length - used}/${live.length}`,
        node: (
          <div key={'r' + rank}>
            <div className="spell-rankhdr">
              {ord(rank)} rank
              <span className="spell-rankhdr-right">
                {used} / {live.length} slot{live.length === 1 ? '' : 's'} used
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
              name={sp?.name ?? id} marks={marksFor(id)}
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
              name={sp?.name ?? id} marks={marksFor(id)}
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

  // Restricted slots — one section per group, kept out of the rank sections above because what they
  // may hold is narrower than their rank and, for Sin Reservoir, the rank itself moves each morning.
  for (const [label, group] of groupBy(main.restrictedSlots ?? [], (s) => s.label)) {
    const cards = group
      .map((slot) => {
        const sp = slot.spellId ? content.spells[slot.spellId] : null;
        const allowedNames = (slot.allowed ?? []).map((id) => content.spells[id]?.name ?? id);
        if (sp && !visible(sp)) return null;
        // Nothing is prepared into a spontaneous caster's restricted slot — it is one extra cast, so
        // the card names what it may be spent on rather than a spell.
        if (!sp && filtering) return null;
        // A Spell Combination slot is ONE cast of two spells at once, so it reads as one card naming
        // both — showing them as two cards would imply two casts.
        const sp2 = slot.pairs && slot.spellId2 ? content.spells[slot.spellId2] : null;
        return (
          <SpellCard
            key={slot.id}
            name={
              sp && sp2
                ? `${sp.name} + ${sp2.name}`
                : sp?.name ?? (slot.spontaneous ? allowedNames.slice(0, 3).join(' / ') || 'Extra cast' : 'Empty slot')
            }
            marks={sp ? marksFor(slot.spellId!) : undefined}
            cost={sp?.cast}
            meta={`${ord(slot.rank)} rank · ${label.toLowerCase()}`}
            pip={slot.expended ? 'filled' : 'empty'}
            onPip={onPlay ? () => onPlay((p) => toggleExpended(p, slot.id)) : undefined}
            onClick={sp ? () => setDetail(sp) : undefined}
            empty={!sp && !slot.spontaneous}
          />
        );
      })
      .filter(Boolean);
    if (!cards.length) continue;
    const used = group.filter((s) => s.expended).length;
    ranks.push({
      key: 'rs-' + label,
      label,
      badge: `${group.length - used}/${group.length}`,
      node: (
        <div key={'rs-' + label}>
          <div className="spell-rankhdr">
            {label}
            <span className="spell-rankhdr-right">
              {used} / {group.length} used
            </span>
          </div>
          {group[0].note && <div className="spell-rank-note">{group[0].note}</div>}
          <div className="spell-grid">{cards}</div>
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
            name={sp?.name ?? id} marks={marksFor(id)}
            cost={sp?.cast}
            meta={ord(rank) + ' rank'}
            onClick={sp ? () => setDetail(sp) : undefined}
          />,
        );
      }
    }
  }

  // Focus spells auto-heighten to half your level rounded up — show that rank, not the base. Built per
  // focus entry so each source (dual-class / archetype) can render its own section with its own DC.
  const buildFocusCards = (entry: (typeof focusEntries)[number]): ReactNode[] => {
    const out: ReactNode[] = [];
    if (!entry.repertoire) return out;
    const focusHeighten = Math.min(10, Math.ceil(character.level / 2));
    for (const rank of Object.keys(entry.repertoire).map(Number).sort((a, b) => a - b)) {
      for (const id of entry.repertoire[rank]) {
        const sp = content.spells[id];
        if (!visible(sp)) continue;
        const shown = Math.max(rank, focusHeighten);
        // Focus spells pool from many feats/subclasses — name the source so it's clear where each came from.
        const from = entry.spellSources?.[id];
        out.push(
          <SpellCard
            key={entry.id + '/' + id}
            name={sp?.name ?? id} marks={marksFor(id)}
            cost={sp?.cast}
            meta={`rank ${shown}${from ? ` · from ${from}` : ''}`}
            fp
            onClick={sp ? () => setDetail(sp) : undefined}
          />,
        );
      }
    }
    return out;
  };

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

  // One shared focus-point pool (character.focus), but a section per focus SOURCE. With a single source
  // the DC sits in the header; with two (dual-class / archetype) each source shows its own DC.
  const singleFocusSc = focusEntries.length === 1 ? deriveSpellcasting(character, focusEntries[0]) : null;
  const focusNode: ReactNode = focusEntries.length ? (
    <section className="card">
      <div className="focus-head">
        <div className="ct" style={{ margin: 0 }}>
          <SecChevron id="focus" />
          <i className="ti ti-flame" aria-hidden="true" />
          Focus spells
        </div>
        {singleFocusSc && (
          <div className="focus-dc">
            <span className="tile focus-dc-tile">
              <span className="tlab">Attack</span>
              <span className="tval">{formatMod(singleFocusSc.attack)}</span>
            </span>
            <span className="tile focus-dc-tile">
              <span className="tlab">Focus DC</span>
              <span className="tval">{singleFocusSc.dc}</span>
            </span>
          </div>
        )}
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
              title={
                character.focus?.refocusRestore
                  ? `Refocus (${character.focus.refocusRestore === 'all' ? 'refill your pool' : `restore ${character.focus.refocusRestore} Focus Points`}${character.focus.refocusSource ? ` — ${character.focus.refocusSource}` : ''})`
                  : 'Refocus (restore 1 focus point)'
              }
              onClick={() => {
                const fmax = character.focus?.max ?? 0;
                const used = fmax - (character.focus?.current ?? 0);
                // Domain/Bloodline/Conflux/Amp Focus refill the whole pool; the Wellspring feats give
                // N. Every printed N carries the same threshold ("recover 3 … if you have spent at
                // least 3"), so falling back to 1 below N is the rule, not a clamp — a character who
                // spent 2 with Bloodline Wellspring gets 1, exactly as written.
                const back = character.focus?.refocusRestore;
                const n = typeof back === 'number' ? back : 1;
                const restored = back === 'all' ? used : used >= n ? n : 1;
                onPlay((p) => setFocusUsed(p, used - restored, fmax));
              }}
            >
              <i className="ti ti-refresh" style={{ fontSize: 12 }} aria-hidden="true" /> Refocus
            </button>
          )}
        </div>
      </div>
      {secOpen('focus') &&
        (focusEntries.some((e) => buildFocusCards(e).length) ? (
          focusEntries.map((entry) => {
            const cards = buildFocusCards(entry);
            if (!cards.length) return null;
            const sc = deriveSpellcasting(character, entry);
            return (
              <div key={entry.id} className="focus-source">
                {focusEntries.length > 1 && (
                  <div className="focus-source-head">
                    <span className="focus-source-name">{entry.name}</span>
                    <span className="focus-source-dc">
                      Attack {formatMod(sc.attack)} · Focus DC {sc.dc}
                    </span>
                  </div>
                )}
                <div className="spell-grid">{cards}</div>
              </div>
            );
          })
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
        <SpellCard key={`${entry.id}:c:${id}`} name={sp?.name ?? id} cost={sp?.cast} meta={isInnate ? 'at will' : 'cantrip · at will'} marks={marksFor(id)} onClick={sp ? () => setDetail(sp) : undefined} />,
      );
    }
    for (const rank of Object.keys(entry.repertoire ?? {}).map(Number).sort((a, b) => a - b)) {
      for (const id of entry.repertoire![rank]) {
        const sp = content.spells[id];
        if (!visible(sp)) continue;
        const cost = !isInnate && itemDef ? chargeCostToCast(itemDef, rank) : 0;
        // Innate cadence: per-spell override (0 = at-will, N = N/day), default 1/day.
        const uses = entry.innateUses?.[id];
        const cadence = entry.innateCadence?.[id];
        // Pooled entries (innate / focus) draw from many feats — name the granting source so it's
        // obvious where each spell came from.
        const from = entry.spellSources?.[id];
        const meta = isInnate
          ? `rank ${rank} · ${uses === 0 ? 'at will' : cadence ?? `${uses ?? 1}/day`}${from ? ` · from ${from}` : ''}`
          : counterId === 'pool'
            ? `rank ${rank} · ${cost} charge${cost === 1 ? '' : 's'}`
            : counterId === 'freq'
              ? `rank ${rank} · 1/day`
              : `rank ${rank}`;
        cards.push(
          <SpellCard
            key={`${entry.id}:${rank}:${id}`}
            name={sp?.name ?? id} marks={marksFor(id)}
            cost={sp?.cast}
            meta={meta}
            onClick={sp ? () => setDetail(sp) : undefined}
            pip={isInnate && uses !== 0 ? (innateUsedSet.has(id) ? 'empty' : 'filled') : undefined}
            onPip={isInnate && uses !== 0 && onPlay ? () => onPlay((p) => toggleInnateCast(p, entry.id, id)) : undefined}
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

  // Rituals the character has — granted by a record, or added via Overrides. Hidden when there are none.
  const ritualsNode: ReactNode = (() => {
    const shown = query ? myRituals.filter((r) => r.spell.name.toLowerCase().includes(query)) : myRituals;
    // Shown whenever the character CAN learn one, not only once they have one — otherwise the picker
    // that learns your first ritual lives inside a section that only appears after you have a ritual.
    if (!shown.length && !onPlay) return null;
    return (
      <section className="card">
        <div className="ct" style={{ margin: secOpen('rituals') ? '0 0 10px' : 0 }}>
          <SecChevron id="rituals" />
          <i className="ti ti-books" aria-hidden="true" /> Rituals
        </div>
        {secOpen('rituals') && (
          <div className="spell-grid">
            {shown.map(({ spell: sp, grant }) => (
              <SpellCard
                key={`ritual:${sp.id}`}
                name={sp.name} marks={marksFor(sp.id)}
                cost={sp.cast}
                // The granting record and the clause it attaches — Read the Land's Commune is cast in
                // 1 hour without a secondary caster, which is the whole reason to take the feat.
                meta={`rank ${sp.rank}${sp.ritualPrimary ? ` · ${sp.ritualPrimary}` : ''}${grant ? ` · ${grant.from}` : ''}${grant?.note ? ` · ${grant.note}` : ''}`}
                onClick={() => setDetail(sp)}
              />
            ))}
            {onPlay && (
              <button className="ms-add" onClick={() => setLearningRitual(true)}>
                <i className="ti ti-plus" aria-hidden="true" /> Learn a ritual
              </button>
            )}
          </div>
        )}
      </section>
    );
  })();

  // Unified mobile tab list: every pool's rank sections, then focus, items, spellbook, rituals.
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
                  {/* Gated on the spellbook as well as the thesis: a dual-class wizard/cleric has a
                      second prepared entry that Spell Blending does not touch. */}
                  {onPlay && hasSpellBlending && main.type === 'prepared' && !!main.spellbook && (
                    <button className="ms-btn" onClick={() => setBlendId(main.id)} title="Spell Blending — trade slots">
                      <i className="ti ti-arrows-exchange" aria-hidden="true" /> Trade slots
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
                  {main.note && <div className="sc-sub">{main.note}</div>}
                </div>
              </div>
              {/* These tiles never carried the situational `*`, so conditional spellcasting bonuses were
                  invisible here even though the same stats show them in the vitals rail. */}
              {([
                { label: 'Spell attack', value: formatMod(sc.attack), ref: { kind: 'spell', entryId: main.id, which: 'attack' } },
                { label: 'Spell DC', value: sc.dc, ref: { kind: 'spell', entryId: main.id, which: 'dc' } },
                // Spell damage has no total of its own — each spell rolls its own dice — so this tile
                // appears only when something actually modifies it (Dangerous Sorcery, Channeler's Stance).
                ...(statHasSituational(character, { kind: 'spellDamage', entryId: main.id }, content)
                  ? [{ label: 'Spell damage', value: 'varies', ref: { kind: 'spellDamage', entryId: main.id } }]
                  : []),
              ] as { label: string; value: string | number; ref: StatRef }[]).map((t) => (
                <div
                  key={t.label}
                  className={'tile' + (onOpenStat ? ' openable' : '') + statMarkClass(character, t.ref, content)}
                  title={onOpenStat ? 'How is this calculated?' : undefined}
                  onClick={onOpenStat ? () => onOpenStat(t.ref) : undefined}
                >
                  <div className="tlab">
                    {t.label}
                    {statHasSituational(character, t.ref, content) && <SituationalStar />}
                  </div>
                  <div className="tval">{t.value}</div>
                </div>
              ))}
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
                  {t.badge && custom.showSlotBadges && <span className="stab-badge">{t.badge}</span>}
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

      {/* DESKTOP: the spellbook / focus / item & innate / rituals sections
          stacked exactly as before. On mobile these all live inside the page-level tab row above. */}
      {!isMobile && (
        <>
          {spellbookNode}
          {focusNode}
          {itemNodes.map((it) => it.node)}
          {ritualsNode}
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
                  {m.note && <div className="sc-sub">{m.note}</div>}
                </div>
              </div>
            </div>
          );
        })()}
      {detail && (
        <SpellDetail key={detail.id} spell={detail} maxRank={maxRank} signature={signatureIds.has(detail.id)} onClose={() => setDetail(null)} />
      )}
      {/* Learn (or forget) a ritual. Rituals are tradition-less by rule, so no spell list carries
          them and the only previous route was Setup → Overrides — the panel for deliberately breaking
          rules — to do something the rules simply let a character do. */}
      {learningRitual && onPlay && (
        <div className="picker-backdrop" onClick={() => setLearningRitual(false)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <FilterableSelect
              title="Learn a ritual"
              items={listValues(content, content.spells).filter((s) => s.ritual)}
              spec={SPELL_SPEC_BUILDER}
              rowKey={(s) => s.id}
              onClose={() => setLearningRitual(false)}
              renderRow={(s, openDesc) => {
                const node = descNodeOf(s, 'spells');
                const known = (character.knownRituals ?? []).includes(s.id);
                return (
                  <PickerRow
                    name={s.name}
                    meta={
                      <div className="picker-traits">
                        {`${ord(s.rank)} rank`}
                        {s.ritualPrimary ? ` · ${s.ritualPrimary}` : ''}
                      </div>
                    }
                    onOpenDesc={node ? () => openDesc(node) : undefined}
                    selectLabel={known ? 'Forget' : 'Learn'}
                    onSelect={() => onPlay((p) => toggleKnownRitual(p, s.id))}
                  />
                );
              }}
            />
          </div>
        </div>
      )}
      {itemView &&
        (() => {
          const inv = character.inventory.find((iv) => iv.instanceId === itemView);
          const item = inv ? content.items[inv.itemId] : undefined;
          return inv && item ? (
            <ItemDetail inv={inv} item={item} content={content} inventory={character.inventory} feats={character.feats} onPlay={onPlay} activeModes={character.activeModes} onClose={() => setItemView(null)} />
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
      {blendEntry && onPlay && (
        <SpellBlendingModal entry={blendEntry} onPlay={onPlay} onClose={() => setBlendId(null)} />
      )}
    </div>
  );
}
