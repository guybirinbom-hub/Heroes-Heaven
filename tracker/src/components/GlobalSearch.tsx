import { useState, useMemo, useEffect, useRef } from 'react'
import { useGameData } from '../data/gameDataContext'
import { useWindowStore, type WinType } from '../store/windowStore'
import { SearchIcon, XIcon } from './Icons'
import { GM_WIDGETS, newWidgetRef } from './GmWidgets'
import { cleanSource } from '../utils/sources'
import { useSourcesStore } from '../store/sourcesStore'
import { useSettingsStore } from '../store/settingsStore'
import { MONSTER_PARTS_SOURCE } from '../data/monsterPartsRules'

// ── Global reference search ("command palette") ─────────────────────────────
// One box that searches everything the app knows how to show in a popup —
// conditions, spells, items, traits, actions/abilities, and skills — and opens
// the matching reference window on select. Creatures have their own richer
// search under "Add Combatants".

interface Hit {
  type: WinType
  ref: string        // lowercase lookup key
  title: string      // display name
  tl: string         // title, lowercased (for matching)
  category: WinType
}

const CATEGORY: Record<string, { label: string; fg: string; bg: string; bd: string }> = {
  spell:     { label: 'Spell',     fg: 'var(--accent)', bg: 'var(--accent-soft)', bd: 'var(--accent-line)' },
  ritual:    { label: 'Ritual',    fg: 'var(--accent)', bg: 'var(--accent-soft)', bd: 'var(--accent-line)' },
  condition: { label: 'Condition', fg: 'var(--danger)', bg: 'var(--danger-soft)', bd: 'var(--danger)' },
  equipment: { label: 'Item',      fg: 'var(--linked)', bg: 'var(--linked-soft)', bd: 'var(--linked)' },
  action:    { label: 'Action',    fg: 'var(--accent)', bg: 'var(--accent-soft)', bd: 'var(--accent-line)' },
  skill:     { label: 'Skill',     fg: 'var(--linked)', bg: 'var(--linked-soft)', bd: 'var(--linked)' },
  trait:     { label: 'Trait',     fg: 'var(--text-muted)', bg: 'var(--bg-elevated)', bd: 'var(--border)' },
  glossary:  { label: 'Glossary',  fg: 'var(--text-muted)', bg: 'var(--bg-elevated)', bd: 'var(--border)' },
  rule:      { label: 'Rule',      fg: 'var(--linked)', bg: 'var(--linked-soft)', bd: 'var(--linked)' },
  creature:  { label: 'Creature',  fg: 'var(--accent)', bg: 'var(--accent-soft)', bd: 'var(--accent-line)' },
  widget:    { label: 'GM tool',   fg: 'var(--accent)', bg: 'var(--accent-soft)', bd: 'var(--accent-line)' },
}

// "low-light vision" → "Low-Light Vision"; capitalises after start/space/-/(/.
function titleCase(s: string): string {
  return s.replace(/(^|[\s/(-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
}

export function GlobalSearch({ onClose, onPick, title }: {
  onClose: () => void
  /** When provided, selecting a result calls this (e.g. to pin it) instead of
   *  opening the reference window. */
  onPick?: (hit: { type: WinType; ref: string; title: string }) => void
  /** Optional heading shown in pick mode (e.g. "Pin a reference"). */
  title?: string
}) {
  const data = useGameData()
  const openWin = useWindowStore(s => s.open)
  const disabledSources = useSourcesStore(s => s.disabled)
  const disabledSourceSet = useMemo(() => new Set(disabledSources), [disabledSources])
  const showMonsterParts = useSettingsStore(s => s.showMonsterParts)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Flatten every reference collection into one searchable list (built once
  // the game data has loaded; titles are precomputed so keystrokes are cheap).
  const index = useMemo<Hit[]>(() => {
    const out: Hit[] = []
    const addStr = (m: Map<string, string>, type: WinType) => {
      for (const k of m.keys()) { const title = titleCase(k); out.push({ type, ref: k, title, tl: title.toLowerCase(), category: type }) }
    }
    addStr(data.conditions, 'condition')
    addStr(data.traits, 'trait')
    addStr(data.actions, 'action')
    addStr(data.skills, 'skill')
    // Source-bearing content is hidden when its book is switched off in
    // Settings → Sources. Entries with no source (a few rules, some glossary
    // items) have no book to hide behind, so they stay searchable.
    const off = (src?: string) => !!src && disabledSourceSet.has(cleanSource(src))
    for (const [k, v] of data.spells) { if (off(v.source)) continue; out.push({ type: 'spell', ref: k, title: v.name, tl: v.name.toLowerCase(), category: 'spell' }) }
    for (const [k, v] of data.rituals) { if (off(v.source)) continue; out.push({ type: 'ritual', ref: k, title: v.name, tl: v.name.toLowerCase(), category: 'ritual' }) }
    for (const [k, v] of data.equipment) { if (off(v.source)) continue; out.push({ type: 'equipment', ref: k, title: v.name, tl: v.name.toLowerCase(), category: 'equipment' }) }
    // Monster Parts book segments are only searchable when the variant rule is
    // switched on (Settings → Show Monster Parts); other rules are always shown.
    for (const [k, v] of data.rules) { if (off(v.source)) continue; if (v.source === MONSTER_PARTS_SOURCE && !showMonsterParts) continue; out.push({ type: 'rule', ref: k, title: v.name, tl: v.name.toLowerCase(), category: 'rule' }) }
    for (const [k, v] of data.creatures) { if (off(v.source)) continue; out.push({ type: 'creature', ref: k, title: v.name, tl: v.name.toLowerCase(), category: 'creature' }) }
    // GM-screen tool widgets — searchable by label + synonyms; ref is the kind
    // (freshened to a unique instance id in `choose`).
    for (const w of GM_WIDGETS) out.push({ type: 'widget', ref: w.kind, title: w.label, tl: `${w.label} ${w.keywords}`.toLowerCase(), category: 'widget' })
    return out
  }, [data, disabledSourceSet, showMonsterParts])

  const results = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const scored: { hit: Hit; score: number }[] = []
    for (const it of index) {
      const i = it.tl.indexOf(q)
      if (i < 0) continue
      // exact < prefix < word-start < anywhere
      const score = it.tl === q ? 0 : i === 0 ? 1 : it.tl[i - 1] === ' ' ? 2 : 3
      scored.push({ hit: it, score })
    }
    scored.sort((a, b) =>
      a.score - b.score ||
      a.hit.title.length - b.hit.title.length ||
      a.hit.title.localeCompare(b.hit.title))
    return scored.slice(0, 80).map(s => s.hit)
  }, [query, index])

  useEffect(() => { setActive(0) }, [query])
  useEffect(() => { inputRef.current?.focus() }, [])

  // Keep the highlighted row visible while arrow-navigating.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (h: Hit | undefined) => {
    if (!h) return
    // Widgets need a fresh instance id each time they're added (so two timers
    // don't share state / dedupe to one); references keep their stable key.
    const ref = h.category === 'widget' ? newWidgetRef(h.ref) : h.ref
    if (onPick) onPick({ type: h.type, ref, title: h.title })
    else openWin(h.type, ref, h.title)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]) }
  }

  const ready = index.length > 0
  const q = query.trim()

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onKeyDown={onKeyDown}
        style={{
          width: '100%', maxWidth: 560, margin: '0 16px',
          background: 'var(--bg-panel)',
          border: 'var(--app-bw) solid var(--border-strong)',
          borderRadius: 12, boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column',
          maxHeight: '70vh', overflow: 'hidden',
        }}
      >
        {title && (
          <div style={{
            padding: '9px 16px 0', flexShrink: 0,
            fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 700,
            letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent)',
          }}>{title}</div>
        )}
        {/* Search field */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: 'var(--app-bw) solid var(--border)', flexShrink: 0,
        }}>
          <SearchIcon size={16} style={{ color: 'var(--text-faded)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={ready ? 'Search rules, conditions, spells, items, traits, actions, skills, creatures…' : 'Loading game data…'}
            disabled={!ready}
            className="themed-placeholder"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: 15, fontFamily: 'var(--font-ui)',
            }}
          />
          <button
            onClick={onClose} title="Close (Esc)"
            className="ico-btn"
            style={{ width: 26, height: 26, flexShrink: 0 }}
          ><XIcon size={13} /></button>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {q && results.length === 0 && ready && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-faded)', fontSize: 13 }}>
              No matches for “{q}”.
            </div>
          )}
          {!q && (
            <div style={{ padding: '20px 16px', color: 'var(--text-faded)', fontSize: 12.5, lineHeight: 1.7 }}>
              Type to search every rule, condition, spell, item, trait, action, skill, and creature.
              <br />Use ↑ ↓ to move, Enter to open, Esc to close.
            </div>
          )}
          {results.map((h, i) => {
            const meta = CATEGORY[h.category] ?? CATEGORY.glossary
            const on = i === active
            return (
              <div
                key={`${h.type}:${h.ref}`}
                data-row={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(h)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 16px', cursor: 'pointer',
                  background: on ? 'var(--bg-hover)' : 'transparent',
                  borderLeft: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                }}
              >
                <span style={{
                  flex: 1, minWidth: 0, color: 'var(--text)', fontSize: 13.5,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{h.title}</span>
                <span style={{
                  flexShrink: 0, fontFamily: 'var(--font-ui)', fontSize: 9.5, fontWeight: 700,
                  letterSpacing: '.06em', textTransform: 'uppercase',
                  padding: '2px 7px', borderRadius: 3,
                  color: meta.fg, background: meta.bg, border: `var(--app-bw) solid ${meta.bd}`,
                }}>{meta.label}</span>
              </div>
            )
          })}
        </div>

        {/* Footer count */}
        {q && results.length > 0 && (
          <div style={{
            padding: '6px 16px', borderTop: 'var(--app-bw) solid var(--border)', flexShrink: 0,
            color: 'var(--text-faded)', fontSize: 11, fontFamily: 'var(--font-mono)',
          }}>
            {results.length}{results.length === 80 ? '+' : ''} result{results.length === 1 ? '' : 's'}
          </div>
        )}
      </div>
    </div>
  )
}
