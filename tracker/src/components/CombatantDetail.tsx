import { useState, useRef, useEffect } from 'react'
import type { Combatant } from '../types/pf2e'
import { useCombatStore } from '../store/combatStore'
import { usePartyStore } from '../store/partyStore'
import { saveCustomCreature } from '../data/dataStore'
import { StatBlock } from './StatBlock'
import { CreatureDescription } from './CreatureDescription'
import { useGameData } from '../data/gameDataContext'
import { Chip } from './Chip'
import { HPTracker } from './HPTracker'
import { TextConverter } from './TextConverter'
import { ImageIcon, PencilIcon, XIcon } from './Icons'
import { NumberInput } from './NumberInput'
import { useSettingsStore, monsterPartsFor } from '../store/settingsStore'
import { useCampaignMonsterParts } from '../data/monsterPartsContext'
import { readThemeTokens } from '../utils/themeTokens'
import { PcStatsDisplay } from './PcStatsDisplay'
import { MonsterPartsPopup } from './MonsterPartsPopup'

// ── Hamburger options menu ─────────────────────────────────────────────────
function HamburgerMenu({ combatant, onEditClick }: {
  combatant: Combatant
  onEditClick: () => void
}) {
  const { setEliteWeak, setScaledLevel, setCombatantImage } = useCombatStore()
  const [open, setOpen] = useState(false)
  const [levelInput, setLevelInput] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const baseLevel = combatant.creature?.level ?? 0
  const currentLabel =
    combatant.scaledToLevel !== undefined ? `Lv ${combatant.scaledToLevel}`
    : combatant.isElite ? 'Elite'
    : combatant.isWeak ? 'Weak'
    : `Normal (Lv ${baseLevel})`

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !combatant.creature) return
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      setCombatantImage(combatant.id, dataUrl)
      saveCustomCreature({ ...combatant.creature!, image: dataUrl })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const menuRow = (icon: React.ReactNode, label: string, action: () => void) => (
    <button
      onClick={() => { action(); setOpen(false) }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', background: 'none', border: 'none',
        color: 'var(--text)',
        fontFamily: 'var(--font-ui)',
        fontSize: 12.5, padding: '8px 14px',
        cursor: 'pointer', textAlign: 'left',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >{icon}{label}</button>
  )

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />

      {/* 3-line hamburger */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '5px 4px', display: 'flex', flexDirection: 'column',
          gap: 4, alignItems: 'center',
        }}
        title="Options"
      >
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            display: 'block', width: 16, height: 1.5,
            background: open ? 'var(--text)' : 'var(--accent)', borderRadius: 1,
            transition: 'background 0.1s',
          }} />
        ))}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, zIndex: 400,
          marginTop: 4, width: 240,
          background: 'var(--bg-panel)',
          border: 'var(--app-bw) solid var(--border-strong)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-md)',
          overflow: 'hidden',
        }}>
          {/* Image */}
          {menuRow(<ImageIcon size={13} />, 'Upload Image', () => fileRef.current?.click())}

          <div style={{ borderTop: 'var(--app-bw) solid var(--border)' }} />

          {/* Scale */}
          <div style={{ padding: '10px 14px 8px' }}>
            <div className="pf-label muted" style={{
              fontSize: 10, marginBottom: 8,
            }}>
              Scale — <span style={{ color: 'var(--accent)' }}>{currentLabel}</span>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {[
                { label: 'Normal', bg: 'transparent', bdr: 'var(--border-strong)', clr: 'var(--text-muted)', action: () => setEliteWeak(combatant.id, 'normal') },
                // Saturated solid Elite-green / Weak-blue with white text so
                // the buttons read on every theme (no longer pastel-on-dark).
                { label: 'Elite',  bg: '#4a7a30', bdr: '#3a6024', clr: '#fff', action: () => setEliteWeak(combatant.id, 'elite') },
                { label: 'Weak',   bg: '#3a6a9a', bdr: '#2a5278', clr: '#fff', action: () => setEliteWeak(combatant.id, 'weak') },
              ].map(({ label, bg, bdr, clr, action }) => (
                <button key={label}
                  onClick={() => { action(); setOpen(false) }}
                  style={{
                    flex: 1, fontFamily: 'var(--font-ui)', fontSize: 10.5, fontWeight: 600,
                    padding: '4px 0', background: bg, border: `var(--app-bw) solid ${bdr}`,
                    borderRadius: 'var(--radius-sm)', color: clr, cursor: 'pointer',
                  }}
                >{label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              <NumberInput
                min={-1} max={25}
                className="input-dark"
                style={{ flex: 1, fontSize: 11.5 }}
                placeholder={`Custom level…`}
                value={levelInput}
                onChange={e => setLevelInput(e.target.value)}
                onStep={n => setLevelInput(String(Math.max(-1, Math.min(25, n))))}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const lvl = parseInt(levelInput)
                    if (!isNaN(lvl)) { setScaledLevel(combatant.id, lvl); setLevelInput(''); setOpen(false) }
                  }
                }}
              />
              <button
                className="btn btn-primary btn-sm"
                style={{ whiteSpace: 'nowrap', padding: '4px 10px' }}
                onClick={() => {
                  const lvl = parseInt(levelInput)
                  if (!isNaN(lvl)) { setScaledLevel(combatant.id, lvl); setLevelInput(''); setOpen(false) }
                }}
              >Scale to</button>
            </div>
          </div>

          <div style={{ borderTop: 'var(--app-bw) solid var(--border)' }} />

          {/* Edit */}
          {menuRow(<PencilIcon size={13} />, 'Edit Stat Block', onEditClick)}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
interface Props {
  combatant: Combatant
  /** When shown in a closable pane, renders an × next to the hamburger. */
  onClose?: () => void
  /** Optional ⠿ drag handle (in a pane) so the stat block can be re-tiled. */
  dockHandle?: React.ReactNode
  /** Drag the page header to combine this stat block as tabs (replaces the
   *  tabs button); a click without movement copies the name. */
  onHeaderDrag?: (e: React.MouseEvent) => void
}

export function CombatantDetail({ combatant, onClose, dockHandle, onHeaderDrag }: Props) {
  const { setNotes } = useCombatStore()
  const { findPlayerByName, updatePlayer } = usePartyStore()
  /*
   * Monster Parts: the campaign decides, if there is one. A campaign already knows whether it runs
   * the Battlezoo variant (and which of the three), so asking the GM to also flip a switch here was
   * a second place to be wrong. Standalone there's no campaign to ask, so the local setting still
   * governs — which is why it still exists in the standalone tracker's Settings.
   */
  const localShowMonsterParts = useSettingsStore(s => s.showMonsterParts)
  const campaignMp = useCampaignMonsterParts()
  const showMonsterParts = campaignMp ? campaignMp.enabled : localShowMonsterParts
  const mpMode = campaignMp?.mode ?? 'light'
  const globalDetail = useSettingsStore(s => s.pcDetail)
  const [showNotes, setShowNotes] = useState(false)
  const [showDescription, setShowDescription] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showMpPopup, setShowMpPopup] = useState(false)
  const [nameCopied, setNameCopied] = useState(false)
  const families = useGameData().families
  // The creature's flavor blurb + family description (if AoN had them).
  const familyText = combatant.creature?.family ? families.get(combatant.creature.family.toLowerCase()) : undefined
  const hasDescription = !!(combatant.creature?.flavor || familyText)

  useEffect(() => { setShowNotes(false); setShowDescription(false) }, [combatant.id])
  useEffect(() => { setNameCopied(false) }, [combatant.id])

  const copyName = () => {
    navigator.clipboard?.writeText(combatant.name).then(
      () => { setNameCopied(true); setTimeout(() => setNameCopied(false), 1300) },
      () => { /* clipboard blocked — ignore */ },
    )
  }

  const partyMatch = combatant.isPC ? findPlayerByName(combatant.name) : null

  const effectiveLevel = combatant.scaledToLevel !== undefined
    ? combatant.scaledToLevel
    : combatant.isElite ? (combatant.creature?.level ?? 0) + 1
    : combatant.isWeak ? (combatant.creature?.level ?? 0) - 1
    : combatant.creature?.level

  const openImageWindow = () => {
    const img = combatant.creature?.image
    if (!img) return
    // Both data URIs and http(s)/file URLs are now routed through the
    // in-app image viewer (the Electron main process handles each kind).
    // Fall back to window.open only when the API isn't available (e.g. dev
    // browser preview without the Electron preload). We also ship a snapshot
    // of the current theme tokens so the viewer paints in the same palette
    // as the main app instead of staying on hardcoded Tavern colours.
    if (window.electronAPI?.openImageWindow) {
      window.electronAPI.openImageWindow(img, combatant.creature!.name, readThemeTokens())
    } else {
      window.open(img, '_blank')
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-panel)' }}>
      {/* ── Page head — compact: display title + inline level + source.
           Dragging the header combines this stat block as tabs with another
           pane (replaces the old tabs button); clicking the name copies it. ── */}
      <div
        onMouseDown={onHeaderDrag}
        style={{
          padding: '10px 24px 9px',
          flexShrink: 0,
          position: 'relative',
          borderBottom: 'var(--app-bw) solid var(--border)',
          cursor: onHeaderDrag ? 'grab' : 'default',
        }}>
        <div style={{
          // Reserve space on the right for the floating buttons so the level /
          // source line never slides under them. Widen for the ⠿ handle.
          paddingRight: onClose
            ? (dockHandle ? 98 : 66)
            : (combatant.creature ? 36 : 0),
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 14, flexWrap: 'wrap',
        }}>
          {/* Name + (creature alias) */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <h1 className="page-title-display"
              onClick={copyName}
              title="Click to copy the name"
              style={{
                fontSize: 20, fontWeight: 600, lineHeight: 1.1,
                margin: 0,
                fontVariationSettings: '"opsz" 48',
                cursor: 'pointer',
              }}>
              {combatant.name}
            </h1>
            {nameCopied && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                padding: '1px 6px', borderRadius: 3,
                background: 'var(--accent-soft)', color: 'var(--accent)',
                border: 'var(--app-bw) solid var(--accent-line)',
                fontFamily: 'var(--font-ui)',
              }}>Copied ✓</span>
            )}
            {combatant.creature && combatant.creature.name !== combatant.name && (
              <span style={{
                color: 'var(--text-faded)',
                fontFamily: 'var(--font-ui)',
                fontStyle: 'italic',
                fontSize: 11,
              }}>({combatant.creature.name})</span>
            )}
            {combatant.isPC && <Chip tone="accent">PC</Chip>}
            {combatant.isDefeated && <Chip tone="danger">DEFEATED</Chip>}
          </div>

          {/* Right meta — single line: level + source */}
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 12,
            color: 'var(--text-muted)', fontSize: 11, flexWrap: 'wrap',
          }}>
            {combatant.creature && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12, color: 'var(--accent)', fontWeight: 500,
                display: 'inline-flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap',
              }}>
                <span>Level {effectiveLevel}</span>
                {(combatant.isElite || combatant.isWeak || combatant.scaledToLevel !== undefined) && (
                  <span style={{ color: 'var(--text-faded)', fontWeight: 400 }}>
                    ({combatant.isElite ? 'Elite' : combatant.isWeak ? 'Weak' : `from ${combatant.creature?.level}`})
                  </span>
                )}
                {showMonsterParts && combatant.creature && (() => {
                  const mp = monsterPartsFor(
                    typeof effectiveLevel === 'number' ? effectiveLevel : (combatant.creature?.level ?? 0),
                    combatant.creature?.traits ?? [],
                    mpMode,
                  )
                  if (!mp) return null
                  return (
                    <>
                      <button
                        onClick={() => setShowMpPopup(true)}
                        title="Monster Parts — click for value, bulk & matching imbuements"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '1px 7px', borderRadius: 3, cursor: 'pointer',
                          background: 'var(--accent-soft)',
                          border: 'var(--app-bw) solid var(--accent-line)',
                          color: 'var(--accent)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11, fontWeight: 600,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-on-accent)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-soft)'; e.currentTarget.style.color = 'var(--accent)' }}
                      >
                        <span>◆</span>
                        <span>Monster Parts</span>
                      </button>
                      {showMpPopup && combatant.creature && (
                        <MonsterPartsPopup creature={combatant.creature} value={mp.value} bulk={mp.bulk} onClose={() => setShowMpPopup(false)} />
                      )}
                    </>
                  )
                })()}
              </span>
            )}
            {combatant.creature?.source && (
              <span style={{ fontSize: 11, color: 'var(--text-faded)', fontStyle: 'italic' }}>
                {combatant.creature.source}
              </span>
            )}
          </div>
        </div>

        {/* ⠿ move + hamburger + (in a pane) close — absolute top-right.
           Stop mousedown so these buttons don't start the header (tab) drag. */}
        {(combatant.creature || onClose || dockHandle) && (
          <div onMouseDown={e => e.stopPropagation()}
            style={{ position: 'absolute', top: 8, right: 14, display: 'flex', alignItems: 'center', gap: 4 }}>
            {dockHandle}
            {onClose && (
              <button
                onClick={onClose} title="Close this pane"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 26, height: 26, border: 'none', borderRadius: 5, padding: 0, cursor: 'pointer',
                  background: 'transparent', color: 'var(--text-muted)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--danger)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
              ><XIcon size={15} /></button>
            )}
            {combatant.creature && <HamburgerMenu combatant={combatant} onEditClick={() => setShowEdit(true)} />}
          </div>
        )}
      </div>

      {/* ── HP Zone ── */}
      <div style={{
        padding: '12px 28px 14px',
        borderBottom: 'var(--app-bw) solid var(--border)',
        flexShrink: 0, position: 'relative',
      }}>
        {/* Token — right corner */}
        {combatant.creature?.image && (
          <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', zIndex: 1 }}>
            <img
              src={combatant.creature.image}
              alt=""
              onClick={openImageWindow}
              title="Click to open full image"
              style={{ width: 54, height: 54, borderRadius: '50%', border: '2px solid var(--accent-line)', objectFit: 'cover', cursor: 'pointer', display: 'block', boxShadow: 'var(--shadow-sm)' }}
            />
          </div>
        )}
        {/* HPTracker — padded right so it doesn't overlap token */}
        <div style={{ paddingRight: combatant.creature?.image ? 68 : 0 }}>
          <HPTracker
            combatant={combatant}
            showNotes={showNotes}
            onToggleNotes={!combatant.isPC && combatant.creature ? () => { setShowNotes(v => !v); setShowDescription(false) } : undefined}
            showDescription={showDescription}
            onToggleDescription={!combatant.isPC && combatant.creature && hasDescription ? () => { setShowDescription(v => !v); setShowNotes(false) } : undefined}
          />
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        {combatant.isPC ? (
          <div className="p-4 flex flex-col gap-3">
            {partyMatch ? (
              <>
                <div className="flex items-center gap-2 text-xs">
                  <span className="pf-label" style={{ marginBottom: 0 }}>Party</span>
                  <span style={{ color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>{partyMatch.party.name}</span>
                  <span style={{ color: 'var(--text-faded)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>· LV {partyMatch.party.level}</span>
                </div>
                {/* PC stat sheet — same data as the party card, spacious layout. */}
                <PcStatsDisplay
                  stats={partyMatch.player.pcStats ?? {}}
                  detail={partyMatch.party.pcDetail ?? globalDetail}
                />
                <textarea
                  className="input-dark w-full text-sm"
                  style={{ minHeight: 120, resize: 'vertical', marginTop: 4 }}
                  placeholder="Player notes…"
                  value={partyMatch.player.notes}
                  onChange={e => updatePlayer(partyMatch.party.id, partyMatch.player.id, { notes: e.target.value })}
                />
              </>
            ) : (
              <>
                <div style={{ color: 'var(--text-faded)', fontSize: 12, fontStyle: 'italic' }}>
                  No party player named <strong style={{ color: 'var(--text)' }}>"{combatant.name}"</strong> found.
                </div>
                <textarea
                  className="input-dark w-full text-sm"
                  style={{ minHeight: 140, resize: 'vertical' }}
                  placeholder="Local notes for this combatant…"
                  value={combatant.notes}
                  onChange={e => setNotes(combatant.id, e.target.value)}
                />
              </>
            )}
          </div>
        ) : showNotes ? (
          <div className="p-3 h-full flex flex-col">
            <textarea
              className="input-dark w-full text-sm"
              style={{ flex: 1, minHeight: 160, resize: 'none' }}
              placeholder="Notes about this combatant..."
              value={combatant.notes}
              onChange={e => setNotes(combatant.id, e.target.value)}
            />
          </div>
        ) : showDescription && combatant.creature ? (
          <CreatureDescription creature={combatant.creature} familyText={familyText} />
        ) : (
          <StatBlock combatant={combatant} hideHP={!combatant.creature?.isHazard} hideTraits={!combatant.creature?.isHazard} />
        )}
      </div>

      {showEdit && combatant.creature && (
        <TextConverter existing={combatant.creature} onClose={() => setShowEdit(false)} />
      )}
    </div>
  )
}
