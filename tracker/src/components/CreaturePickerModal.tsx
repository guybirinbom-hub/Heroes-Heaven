import { useState, useEffect, useCallback, useMemo } from 'react'
import { searchCreatures, loadCreature, loadCustomCreatures } from '../data/dataStore'
import type { IndexEntry } from '../data/dataStore'
import type { Creature } from '../types/pf2e'
import { cleanSource } from '../utils/sources'
import { useSourcesStore } from '../store/sourcesStore'

interface Props {
  title?: string
  onSelect: (creature: Creature) => void
  onClose: () => void
}

export function CreaturePickerModal({ title = 'Link Stat Block', onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IndexEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [filterLevel, setFilterLevel] = useState('')
  const [error, setError] = useState('')
  const [customCreatures, setCustomCreatures] = useState<Creature[]>([])
  const disabledSources = useSourcesStore(s => s.disabled)
  const disabledSourceSet = useMemo(() => new Set(disabledSources), [disabledSources])

  useEffect(() => { setCustomCreatures(loadCustomCreatures()) }, [])

  const doSearch = useCallback(async (q: string) => {
    setLoading(true); setError('')
    try {
      let res = await searchCreatures(q)
      // Drop creatures from books switched off in Settings → Sources.
      res = res.filter(e => !disabledSourceSet.has(cleanSource(e.source)))
      if (filterLevel !== '') {
        const lvl = parseInt(filterLevel)
        if (!isNaN(lvl)) res = res.filter(e => e.level === lvl)
      }
      setResults(res)
    } catch {
      setError('Data not loaded. Run: npm run setup-data')
      setResults([])
    }
    setLoading(false)
  }, [filterLevel, disabledSourceSet])

  useEffect(() => { doSearch(query) }, [query, doSearch])

  const pick = async (entry: IndexEntry) => {
    setSelecting(entry.name)
    try {
      const creature = await loadCreature(entry)
      onSelect(creature)
      onClose()
    } catch { setError(`Failed to load ${entry.name}`) }
    setSelecting(null)
  }

  const pickCustom = (creature: Creature) => { onSelect(creature); onClose() }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-pf-gold font-bold text-base">{title}</h2>
          <button className="text-pf-border hover:text-pf-cream text-lg" onClick={onClose}>✕</button>
        </div>

        <div className="flex gap-2 mb-3">
          <input
            autoFocus
            className="input-dark flex-1 min-w-0"
            placeholder="Search by name…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <input
            className="input-dark w-20"
            placeholder="Level"
            value={filterLevel}
            onChange={e => setFilterLevel(e.target.value)}
            type="number"
          />
        </div>

        {error && <div className="text-red-400 text-xs mb-2 p-2 bg-red-950 rounded">{error}</div>}

        <div className="overflow-y-auto flex-1 border border-pf-border rounded">
          {loading && <div className="text-pf-border text-sm p-3">Searching…</div>}
          {!loading && results.length === 0 && customCreatures.filter(c => !query || c.name.toLowerCase().includes(query.toLowerCase())).length === 0 && !error && (
            <div className="text-pf-border text-sm p-3 text-center">No results</div>
          )}

          {/* Custom creatures */}
          {customCreatures
            .filter(c => !query || c.name.toLowerCase().includes(query.toLowerCase()))
            .map(c => (
              <div
                key={c.id}
                className="flex items-center justify-between px-3 py-1.5 border-b border-pf-border-dark hover:bg-pf-brown-light cursor-pointer"
                onClick={() => pickCustom(c)}
              >
                <div>
                  <span className="font-semibold text-sm">{c.name}</span>
                  <span className="ml-1 text-xs text-pf-border">Level {c.level}</span>
                  <span className="ml-1 text-xs text-pf-gold">★ Custom</span>
                </div>
              </div>
            ))}

          {/* Bestiary */}
          {results.map((entry, i) => (
            <div
              key={`${entry.file}::${entry.name}::${i}`}
              className="flex items-center justify-between px-3 py-1.5 border-b border-pf-border-dark hover:bg-pf-brown-light cursor-pointer"
              onClick={() => pick(entry)}
            >
              <div>
                {selecting === entry.name
                  ? <span className="text-pf-gold text-xs">Loading…</span>
                  : <span className="font-semibold text-sm">{entry.name}</span>}
                <span className="ml-1 text-xs text-pf-border">Level {entry.level}</span>
                {entry.isHazard && <span className="ml-1 text-xs text-yellow-500">⚠ Hazard</span>}
              </div>
              <div className="text-xs text-pf-border text-right">
                <div>{entry.traits.slice(0, 3).join(', ')}</div>
                <div className="opacity-60">{entry.source}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
