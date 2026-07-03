import { useMemo, useState, type ReactNode } from 'react';
import type { ActionCost, DescRef } from '../rules/types';
import type { SliderStop } from '../rules/filterValues';
import { spellCostMatches } from '../rules/spellFilter';
import { RangeSlider } from './RangeSlider';
import { DescriptionModal } from './DescriptionModal';
import { useEscapeClose } from './useEscapeClose';
import { useIsMobile } from './useIsMobile';
import type { DescNode } from './descref';

/** Build a description node for a content entry, or null when it has nothing to show.
 *  Used by picker rows: clicking a row's body opens this in a DescriptionModal. `key` is the
 *  originating content-map name ('feats'/'spells'/…), threaded into the pin identity. */
export function descNodeOf(
  it: { name: string; description?: string; descRefs?: DescRef[] },
  key?: string,
): DescNode | null {
  const hasText = !!it.description && it.description.trim().length > 0;
  const hasRefs = !!it.descRefs && it.descRefs.length > 0;
  if (!hasText && !hasRefs) return null;
  return { title: it.name, description: it.description ?? '', descRefs: it.descRefs, key };
}

/**
 * A standard selection row: a clickable body (opens the thing's description) plus a dedicated
 * action button (adds/chooses it). Used everywhere the player picks something — feats, spells,
 * items, familiar abilities — so the two interactions are always separated and consistent.
 */
export function PickerRow({
  lead,
  name,
  meta,
  onOpenDesc,
  onSelect,
  selectLabel = 'Add',
  selectDisabled,
  disabledReason,
  chosen,
  dim,
}: {
  /** Optional leading badge (a feat's level, a spell's cast cost, a ×count). */
  lead?: ReactNode;
  name: ReactNode;
  meta?: ReactNode;
  /** When set, the row body is clickable and opens the description. */
  onOpenDesc?: () => void;
  /** The add/choose action. */
  onSelect?: () => void;
  selectLabel?: ReactNode;
  selectDisabled?: boolean;
  /** Why the action is disabled — surfaced as a tooltip + accessible label on the button. */
  disabledReason?: string;
  /** Already chosen — highlights the row and shows a check on the button. */
  chosen?: boolean;
  /** Dim the row (e.g. a feat whose prerequisites aren't met) — the body stays readable. */
  dim?: boolean;
}) {
  const body = (
    <>
      {lead}
      <div className="picker-text">
        <div className="picker-name">{name}</div>
        {meta}
      </div>
    </>
  );
  return (
    <div className={'pick-row' + (chosen ? ' chosen' : '') + (dim ? ' dim' : '')}>
      {onOpenDesc ? (
        <button type="button" className="pick-body" onClick={onOpenDesc} title="View description">
          {body}
        </button>
      ) : (
        <div className="pick-body pick-body-static">{body}</div>
      )}
      {onSelect && (
        <button
          type="button"
          className="pick-add"
          onClick={onSelect}
          disabled={selectDisabled}
          title={selectDisabled && disabledReason ? disabledReason : undefined}
          aria-label={
            selectDisabled && disabledReason && typeof selectLabel === 'string'
              ? `${selectLabel} — ${disabledReason}`
              : undefined
          }
        >
          {chosen && <i className="ti ti-check" aria-hidden="true" />}
          {selectLabel}
        </button>
      )}
    </div>
  );
}

/** One declarative filter control. */
export type FilterField<T> =
  | { id: string; label: string; kind: 'text'; accessor: (t: T) => string; placeholder?: string }
  | { id: string; label: string; kind: 'chips'; options: { id: string; label: string }[]; accessor: (t: T) => string | string[]; mode?: 'any' | 'all' }
  | { id: string; label: string; kind: 'traits'; accessor: (t: T) => string[] }
  | { id: string; label: string; kind: 'range'; stops: SliderStop[]; magnitude: (t: T) => number }
  | { id: string; label: string; kind: 'castTime'; accessor: (t: T) => ActionCost | undefined };

export interface FilterSpec<T> {
  fields: FilterField<T>[];
}

const COST_CHIPS: { id: string; label: string; cost: ActionCost }[] = [
  { id: 'a1', label: '1 action', cost: { type: 'actions', value: 1 } },
  { id: 'a2', label: '2 actions', cost: { type: 'actions', value: 2 } },
  { id: 'a3', label: '3 actions', cost: { type: 'actions', value: 3 } },
  { id: 'free', label: 'Free', cost: { type: 'free' } },
  { id: 'reaction', label: 'Reaction', cost: { type: 'reaction' } },
];

type FState = Record<string, unknown>;
type EffStops = Record<string, SliderStop[]>;

/** Trim a slider's stop scale to only the stops bracketing the values actually present in
 *  the list, so the full track maps to reachable results (the slider keeps its size, but its
 *  ends stretch to the data's min/max). Falls back to the full scale when it can't narrow. */
export function trimStops(stops: SliderStop[], mags: number[]): SliderStop[] {
  if (mags.length === 0) return stops;
  let min = Infinity;
  let max = -Infinity;
  for (const m of mags) {
    if (m < min) min = m;
    if (m > max) max = m;
  }
  let lo = 0;
  for (let i = 0; i < stops.length; i++) if (stops[i].value <= min) lo = i; // last stop ≤ min
  let hi = stops.length - 1;
  for (let i = stops.length - 1; i >= 0; i--) if (stops[i].value >= max) hi = i; // first stop ≥ max
  if (hi <= lo) return stops; // degenerate → keep the full scale
  return stops.slice(lo, hi + 1);
}

/** The effective (data-trimmed) stops for a range field. */
function stopsOf<T>(f: FilterField<T>, eff: EffStops): SliderStop[] {
  return f.kind === 'range' ? eff[f.id] ?? f.stops : [];
}

function defaultState<T>(spec: FilterSpec<T>, eff: EffStops): FState {
  const s: FState = {};
  for (const f of spec.fields) {
    if (f.kind === 'text') s[f.id] = '';
    else if (f.kind === 'chips' || f.kind === 'traits' || f.kind === 'castTime') s[f.id] = [];
    else if (f.kind === 'range') s[f.id] = [0, stopsOf(f, eff).length - 1];
  }
  return s;
}

/** Which options of each field actually occur in the candidate list, and whether the field
 *  is worth showing. Chip filters (rarity, type, cast time, …) count as soon as they have one
 *  option present — rarity is still a filter even if the list is all one rarity. Range sliders
 *  need ≥2 distinct buckets to be able to narrow anything. */
function computePresence<T>(spec: FilterSpec<T>, items: T[]): Record<string, { show: boolean; opts: Set<string> }> {
  const out: Record<string, { show: boolean; opts: Set<string> }> = {};
  for (const f of spec.fields) {
    if (f.kind === 'text') {
      out[f.id] = { show: true, opts: new Set() };
    } else if (f.kind === 'chips') {
      const opts = new Set<string>();
      for (const it of items) {
        const raw = f.accessor(it);
        const vals = Array.isArray(raw) ? raw : [raw];
        for (const o of f.options) if (vals.includes(o.id)) opts.add(o.id);
      }
      out[f.id] = { show: opts.size >= 1, opts };
    } else if (f.kind === 'castTime') {
      const opts = new Set<string>();
      for (const it of items) {
        const cost = f.accessor(it);
        for (const c of COST_CHIPS) if (spellCostMatches(cost, c.cost)) opts.add(c.id);
      }
      out[f.id] = { show: opts.size >= 1, opts };
    } else if (f.kind === 'range') {
      const mags = new Set<number>();
      for (const it of items) mags.add(f.magnitude(it));
      out[f.id] = { show: mags.size >= 2, opts: new Set() };
    } else {
      // traits — worth showing if there's any trait vocabulary at all
      const vocab = new Set<string>();
      for (const it of items) for (const t of f.accessor(it)) vocab.add(t);
      out[f.id] = { show: vocab.size >= 1, opts: new Set() };
    }
  }
  return out;
}

/** A compact readout of a field's current value, shown beside its section label. */
function valueLabel<T>(f: FilterField<T>, v: unknown, eff: EffStops): string {
  if (f.kind === 'range') {
    const stops = stopsOf(f, eff);
    const [lo, hi] = (v as [number, number]) ?? [0, stops.length - 1];
    if (lo === 0 && hi === stops.length - 1) return '';
    const lab = (i: number) => stops[i].label || String(stops[i].value);
    return lo === hi ? lab(lo) : `${lab(lo)} – ${lab(hi)}`;
  }
  if (f.kind === 'chips' || f.kind === 'traits' || f.kind === 'castTime') {
    const n = ((v as string[]) ?? []).length;
    return n ? `${n}` : '';
  }
  return '';
}

function isActive<T>(f: FilterField<T>, v: unknown, eff: EffStops): boolean {
  if (f.kind === 'text') return ((v as string) ?? '').trim() !== '';
  if (f.kind === 'range') {
    const [lo, hi] = (v as [number, number]) ?? [0, 0];
    return lo !== 0 || hi !== stopsOf(f, eff).length - 1;
  }
  return Array.isArray(v) && v.length > 0;
}

function fieldPass<T>(f: FilterField<T>, v: unknown, item: T, eff: EffStops): boolean {
  switch (f.kind) {
    case 'text': {
      const needle = ((v as string) ?? '').trim().toLowerCase();
      return !needle || f.accessor(item).toLowerCase().includes(needle);
    }
    case 'chips': {
      const sel = (v as string[]) ?? [];
      if (sel.length === 0) return true;
      const raw = f.accessor(item);
      const vals = Array.isArray(raw) ? raw : [raw];
      return f.mode === 'all' ? sel.every((s) => vals.includes(s)) : sel.some((s) => vals.includes(s));
    }
    case 'traits': {
      const sel = (v as string[]) ?? [];
      if (sel.length === 0) return true;
      const traits = f.accessor(item);
      return sel.every((s) => traits.includes(s));
    }
    case 'range': {
      const stops = stopsOf(f, eff);
      const [lo, hi] = (v as [number, number]) ?? [0, stops.length - 1];
      if (lo === 0 && hi === stops.length - 1) return true;
      const m = f.magnitude(item);
      return m >= stops[lo].value && m <= stops[hi].value;
    }
    case 'castTime': {
      const sel = (v as string[]) ?? [];
      if (sel.length === 0) return true;
      const cost = f.accessor(item);
      return COST_CHIPS.filter((c) => sel.includes(c.id)).some((c) => spellCostMatches(cost, c.cost));
    }
  }
}

/** Searchable, filterable selection modal with a full filter panel (left) + results (right). */
export function FilterableSelect<T>({
  title,
  icon = 'ti-sparkles',
  items,
  spec,
  renderRow,
  rowKey,
  onClose,
  headerExtra,
  limit = 150,
  ineligible,
  resultsFooter,
}: {
  title: string;
  icon?: string;
  items: T[];
  spec: FilterSpec<T>;
  /** Render one row's content. `openDesc` shows a description popup over the picker (used by
   *  PickerRow's clickable body). */
  renderRow: (item: T, openDesc: (node: DescNode) => void) => ReactNode;
  rowKey: (item: T) => string;
  onClose: () => void;
  /** Extra node in the header (e.g. an "N / M chosen" counter). */
  headerExtra?: ReactNode;
  /** Max rows rendered (the rest collapse behind a "refine your filters" note). */
  limit?: number;
  /** Marks an item the character can't take (unmet prerequisites). When set, a "Hide ineligible"
   *  toggle appears in the results bar — but only while the current results actually contain
   *  ineligible entries (or the toggle is already on). */
  ineligible?: (item: T) => boolean;
  /** Rendered at the END of the results list, given the current name-search text. Used by the
   *  feat picker to surface matches that exist in the full content but are hidden from this
   *  picker (disabled source books / wrong slot). */
  resultsFooter?: (query: string, openDesc: (node: DescNode) => void) => ReactNode;
}) {
  useEscapeClose(onClose);
  // Each range slider's scale is trimmed to the values present in THIS list, so the whole
  // track maps to reachable results (the slider keeps its size; its ends stretch to the data).
  const effStops = useMemo(() => {
    const out: EffStops = {};
    for (const f of spec.fields) if (f.kind === 'range') out[f.id] = trimStops(f.stops, items.map(f.magnitude));
    return out;
  }, [spec, items]);

  const isMobile = useIsMobile();
  const [state, setState] = useState<FState>(() => defaultState(spec, effStops));
  const [metaQuery, setMetaQuery] = useState('');
  // Desktop opens with the filter panel beside the results; on a phone start on the results and let
  // the user tap "Filters" to overlay them (closing the overlay reveals the results again).
  const [showFilters, setShowFilters] = useState(!isMobile);
  const [descNode, setDescNode] = useState<DescNode | null>(null);

  const set = (id: string, v: unknown) => setState((s) => ({ ...s, [id]: v }));
  const reset = () => setState(defaultState(spec, effStops));

  const presence = useMemo(() => computePresence(spec, items), [spec, items]);
  // The searchable text of each field's individual options (chip labels, the trait vocabulary, the
  // cast-time chips), so the "find a filter" box also matches an option's name — e.g. "uncommon" or
  // "fire" — not just the section heading. Present options only, lowercased.
  const optionText = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of spec.fields) {
      const set = new Set<string>();
      if (f.kind === 'chips') {
        for (const o of f.options)
          if (presence[f.id].opts.has(o.id)) {
            set.add(o.label.toLowerCase());
            set.add(o.id.toLowerCase());
          }
      } else if (f.kind === 'castTime') {
        for (const c of COST_CHIPS)
          if (presence[f.id].opts.has(c.id)) {
            set.add(c.label.toLowerCase());
            set.add(c.id.toLowerCase());
          }
      } else if (f.kind === 'traits') {
        for (const it of items) for (const t of f.accessor(it)) set.add(String(t).toLowerCase());
      }
      out[f.id] = [...set];
    }
    return out;
  }, [spec, items, presence]);
  // Only fields that can actually narrow this list participate (in the panel AND in filtering).
  const liveFields = useMemo(() => spec.fields.filter((f) => presence[f.id].show), [spec, presence]);

  const activeCount = liveFields.filter((f) => isActive(f, state[f.id], effStops)).length;

  const filtered = useMemo(
    () => items.filter((it) => liveFields.every((f) => fieldPass(f, state[f.id], it, effStops))),
    [items, liveFields, state, effStops],
  );

  // "Hide ineligible" — an opt-in eligibility filter (feat pickers). The ineligible set is computed
  // once per items/predicate identity so keystrokes don't re-run prerequisite checks over the list.
  const [hideInel, setHideInel] = useState(false);
  const inelKeys = useMemo(() => {
    if (!ineligible) return null;
    const s = new Set<string>();
    for (const it of items) if (ineligible(it)) s.add(rowKey(it));
    return s;
    // rowKey is stable per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ineligible, items]);
  const inelCount = inelKeys ? filtered.reduce((n, it) => n + (inelKeys.has(rowKey(it)) ? 1 : 0), 0) : 0;
  const results = hideInel && inelKeys ? filtered.filter((it) => !inelKeys.has(rowKey(it))) : filtered;

  // The primary text field is surfaced as an always-visible search box in the results bar (every
  // picker gets a search); the remaining filters live in the collapsible panel.
  const searchField = liveFields.find((f) => f.kind === 'text');
  const panelFields = searchField ? liveFields.filter((f) => f.id !== searchField.id) : liveFields;
  const hasPanel = panelFields.length >= 1;
  const panelOpen = hasPanel && showFilters;
  const panelActiveCount = panelFields.filter((f) => isActive(f, state[f.id], effStops)).length;
  const mq = metaQuery.trim().toLowerCase();
  const shownFields = mq
    ? panelFields.filter((f) => f.label.toLowerCase().includes(mq) || (optionText[f.id] ?? []).some((o) => o.includes(mq)))
    : panelFields;

  return (
    <>
    <div className="picker-overlay" onClick={onClose}>
      <div className={'picker fsel' + (panelOpen ? '' : ' collapsed')} onClick={(e) => e.stopPropagation()}>
        <div className="fsel-head">
          <i className={'ti ' + icon} aria-hidden="true" />
          <span className="fsel-title">{title}</span>
          {headerExtra}
          <span className="fsel-count">{results.length}</span>
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <div className="fsel-body">
          {panelOpen && (
            <div className="fsel-panel">
              <div className="fsel-bar">
                <div className="fsel-metasearch">
                  <i className="ti ti-search" aria-hidden="true" />
                  <input
                    placeholder="Find a filter — e.g. “rank”, “tradition”…"
                    value={metaQuery}
                    onChange={(e) => setMetaQuery(e.target.value)}
                  />
                </div>
                {activeCount > 0 && (
                  <button className="fsel-clear" onClick={reset} title="Clear all filters">
                    Clear {activeCount}
                  </button>
                )}
                {isMobile && (
                  <button className="fsel-done" onClick={() => setShowFilters(false)} title="Show results">
                    <i className="ti ti-check" aria-hidden="true" /> Done
                  </button>
                )}
              </div>

              <div className="fsel-fields">
                {shownFields.map((f) => {
                  const vl = valueLabel(f, state[f.id], effStops);
                  return (
                    <div className="fsel-sec" key={f.id}>
                      <div className="fsel-sec-label">
                        <span>{f.label}</span>
                        {vl && <span className="fsel-sec-val">{vl}</span>}
                      </div>
                      <FieldControl
                        field={f}
                        value={state[f.id]}
                        onChange={(v) => set(f.id, v)}
                        items={items}
                        present={presence[f.id].opts}
                        stops={stopsOf(f, effStops)}
                        query={mq}
                      />
                    </div>
                  );
                })}
                {shownFields.length === 0 && <div className="fsel-empty">No filter matches “{metaQuery}”.</div>}
              </div>
            </div>
          )}

          <div className="fsel-results">
            <div className="fsel-results-bar">
              {searchField ? (
                <div className="fsel-results-search">
                  <i className="ti ti-search" aria-hidden="true" />
                  <input
                    autoFocus
                    placeholder={searchField.placeholder ?? 'Search by name…'}
                    value={(state[searchField.id] as string) ?? ''}
                    onChange={(e) => set(searchField.id, e.target.value)}
                  />
                </div>
              ) : (
                <span />
              )}
              {inelKeys && (inelCount > 0 || hideInel) && (
                <button
                  type="button"
                  className={'fsel-inel' + (hideInel ? ' on' : '')}
                  onClick={() => setHideInel((v) => !v)}
                  title={hideInel ? 'Show options whose prerequisites you don’t meet' : 'Hide options whose prerequisites you don’t meet'}
                >
                  <i className="ti ti-eye-off" aria-hidden="true" /> Hide ineligible{!hideInel && inelCount > 0 ? ` · ${inelCount}` : ''}
                </button>
              )}
              {hasPanel && (
                <button className="fsel-toggle" onClick={() => setShowFilters((v) => !v)} title="Toggle the filter panel">
                  <i className={'ti ' + (showFilters ? 'ti-layout-sidebar-left-collapse' : 'ti-adjustments')} aria-hidden="true" />
                  Filters{panelActiveCount > 0 ? ` · ${panelActiveCount}` : ''}
                </button>
              )}
              <span className="fsel-results-count">{results.length} result{results.length === 1 ? '' : 's'}</span>
            </div>
            <div className="fsel-list">
              {results.slice(0, limit).map((it) => (
                <div key={rowKey(it)} className="fsel-rowwrap">
                  {renderRow(it, setDescNode)}
                </div>
              ))}
              {results.length > limit && (
                <div className="picker-more">{results.length - limit} more — refine your filters to narrow the list.</div>
              )}
              {results.length === 0 && <div className="fsel-empty">Nothing matches these filters.</div>}
              {resultsFooter?.((searchField ? ((state[searchField.id] as string) ?? '') : ''), setDescNode)}
            </div>
          </div>
        </div>
      </div>
    </div>
    {descNode && <DescriptionModal root={descNode} onClose={() => setDescNode(null)} />}
    </>
  );
}

function FieldControl<T>({
  field,
  value,
  onChange,
  items,
  present,
  stops,
  query,
}: {
  field: FilterField<T>;
  value: unknown;
  onChange: (v: unknown) => void;
  items: T[];
  /** Option ids that actually occur in the list (chips/castTime render only these). */
  present?: Set<string>;
  /** Data-trimmed slider stops (range fields). */
  stops?: SliderStop[];
  /** The active "find a filter" query — options matching it are emphasized. */
  query?: string;
}) {
  const q = (query ?? '').trim().toLowerCase();
  const chipMatch = (label: string, id: string) => !!q && (label.toLowerCase().includes(q) || id.toLowerCase().includes(q));
  if (field.kind === 'text') {
    return (
      <input
        className="fsel-text"
        placeholder={field.placeholder ?? 'Any text'}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (field.kind === 'chips') {
    const sel = (value as string[]) ?? [];
    const toggle = (id: string) => onChange(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    const opts = present ? field.options.filter((o) => present.has(o.id)) : field.options;
    return (
      <div className="fsel-chips">
        {opts.map((o) => (
          <button key={o.id} className={'fsel-chip' + (sel.includes(o.id) ? ' on' : '') + (chipMatch(o.label, o.id) ? ' match' : '')} onClick={() => toggle(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  if (field.kind === 'castTime') {
    const sel = (value as string[]) ?? [];
    const toggle = (id: string) => onChange(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    const opts = present ? COST_CHIPS.filter((o) => present.has(o.id)) : COST_CHIPS;
    return (
      <div className="fsel-chips">
        {opts.map((o) => (
          <button key={o.id} className={'fsel-chip' + (sel.includes(o.id) ? ' on' : '') + (chipMatch(o.label, o.id) ? ' match' : '')} onClick={() => toggle(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  if (field.kind === 'range') {
    const sliderStops = stops ?? field.stops;
    const v = (value as [number, number]) ?? [0, sliderStops.length - 1];
    return <RangeSlider stops={sliderStops} value={v} onChange={(nv) => onChange(nv)} />;
  }

  // traits — searchable multi-select over the vocabulary present in the dataset.
  return <TraitPicker field={field} value={(value as string[]) ?? []} onChange={(v) => onChange(v)} items={items} query={query} />;
}

function TraitPicker<T>({
  field,
  value,
  onChange,
  items,
  query,
}: {
  field: Extract<FilterField<T>, { kind: 'traits' }>;
  value: string[];
  onChange: (v: string[]) => void;
  items: T[];
  /** The "find a filter" query — used to surface matching traits before the user types here. */
  query?: string;
}) {
  const [q, setQ] = useState('');
  const vocab = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) for (const t of field.accessor(it)) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [items, field]);
  // The trait picker's own search wins; until the user types here, fall back to the meta-query so a
  // trait searched in "find a filter" (e.g. "fire") is already listed.
  const needle = (q.trim() || (query ?? '').trim()).toLowerCase();
  const matches = needle ? vocab.filter((t) => t.includes(needle) && !value.includes(t)).slice(0, 12) : [];
  const add = (t: string) => {
    onChange([...value, t]);
    setQ('');
  };
  return (
    <div className="fsel-traits">
      <div className="fsel-trait-chosen">
        {value.map((t) => (
          <button key={t} className="fsel-trait-tag" onClick={() => onChange(value.filter((x) => x !== t))}>
            {t} <i className="ti ti-x" aria-hidden="true" />
          </button>
        ))}
      </div>
      <input className="fsel-text" placeholder="Add traits the option must have" value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && (
        <div className="fsel-trait-opts">
          {matches.map((t) => (
            <button key={t} className="fsel-trait-opt" onClick={() => add(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
