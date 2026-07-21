import { useEffect, useMemo } from 'react'
import type { Creature } from '../types/pf2e'
import { matchingImbuements, IMBUE_GROUP_ORDER, type ImbueGroup } from '../utils/imbuements'
import { XIcon } from './Icons'

// Popup shown when the Monster Parts chip on a stat block is clicked: the parts'
// gp value + bulk, and every imbued property whose requirements this creature
// meets. Gated (by the caller) behind the Show Monster Parts setting.
export function MonsterPartsPopup({ creature, value, bulk, onClose }: {
  creature: Creature
  value: string
  bulk: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const matches = useMemo(() => matchingImbuements(creature), [creature])
  const byGroup = useMemo(() => {
    const m = new Map<ImbueGroup, typeof matches>()
    for (const im of matches) { (m.get(im.group) ?? m.set(im.group, []).get(im.group)!).push(im) }
    return m
  }, [matches])

  return (
    <div className="modal-overlay" style={{ zIndex: 9000 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 560, padding: 0, overflow: 'hidden', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 18px', borderBottom: 'var(--app-bw) solid var(--border)',
          background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
        }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--text)' }}>
            Monster Parts
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 500, fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>{creature.name}</span>
          </h2>
          <button className="ico-btn" style={{ width: 28, height: 28 }} onClick={onClose}><XIcon size={14} /></button>
        </div>

        <div style={{ padding: '14px 18px', overflowY: 'auto' }}>
          {/* Value + bulk */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, textAlign: 'center', padding: '8px 6px', background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 600, color: 'var(--accent)' }}>{value}</div>
              <div style={{ fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faded)', marginTop: 2 }}>Value</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center', padding: '8px 6px', background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 600, color: 'var(--text)' }}>{bulk}</div>
              <div style={{ fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faded)', marginTop: 2 }}>Bulk</div>
            </div>
          </div>

          <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faded)', marginBottom: 8 }}>
            Imbuements that fit ({matches.length})
          </div>
          {matches.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              No imbued properties match this creature’s parts.
            </div>
          ) : (
            IMBUE_GROUP_ORDER.filter(g => byGroup.has(g)).map(g => (
              <div key={g} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 5 }}>{g}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {byGroup.get(g)!.map(im => (
                    <div key={im.name} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 8px', background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', flexShrink: 0 }}>{im.name}</span>
                      <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: 'var(--accent)', background: 'var(--accent-soft)', border: 'var(--app-bw) solid var(--accent-line)', borderRadius: 3, padding: '0 5px', flexShrink: 0, whiteSpace: 'nowrap' }}>{im.why}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{im.effect}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          <div style={{ fontSize: 10.5, color: 'var(--text-faded)', marginTop: 8, lineHeight: 1.5, fontStyle: 'italic' }}>
            Refine parts into an item (Table 3/4) or imbue one of the above properties (Table 5). Search “Monster Parts” for the full rules.
          </div>
        </div>
      </div>
    </div>
  )
}
