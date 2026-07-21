import { useState, useEffect, useRef } from 'react'
import { usePartyStore } from '../store/partyStore'
import type { PartyPlayer } from '../store/partyStore'
import { TrashIcon, XIcon, PlusIcon, CheckIcon, PencilIcon } from './Icons'

// ── Single player card ──────────────────────────────────────────────────────
function PlayerCard({
  player, partyId,
}: {
  player: PartyPlayer
  partyId: string
}) {
  const { updatePlayer, removePlayer } = usePartyStore()
  const [name, setName] = useState(player.name)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => { setName(player.name) }, [player.name])

  const commitName = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== player.name) updatePlayer(partyId, player.id, { name: trimmed })
    else setName(player.name)
  }

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: 'var(--app-bw) solid var(--border)',
      borderRadius: 8,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 7,
    }}>
      {/* Name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => e.key === 'Enter' && (e.currentTarget.blur())}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            borderBottom: 'var(--app-bw) solid var(--border-strong)',
            color: 'var(--text)',
            fontSize: 13,
            fontWeight: 700,
            padding: '2px 0',
            outline: 'none',
          }}
        />
        {confirmRemove ? (
          <div style={{ display: 'flex', gap: 3 }}>
            <button
              onClick={() => removePlayer(partyId, player.id)}
              style={{
                background: 'var(--danger)', border: 'var(--app-bw) solid var(--danger)',
                borderRadius: 4, color: 'var(--text-on-danger)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', padding: '2px 6px',
              }}
            ><CheckIcon size={11} /></button>
            <button
              onClick={() => setConfirmRemove(false)}
              style={{
                background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border-strong)',
                borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', padding: '2px 6px',
              }}
            ><XIcon size={11} /></button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmRemove(true)}
            title="Remove player"
            style={{
              background: 'none', border: 'none',
              color: 'var(--text-faded)', cursor: 'pointer',
              lineHeight: 1, padding: '0 2px',
              transition: 'color 0.15s',
              display: 'flex', alignItems: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faded)')}
          ><TrashIcon size={13} /></button>
        )}
      </div>

      {/* Notes */}
      <textarea
        value={player.notes}
        onChange={e => updatePlayer(partyId, player.id, { notes: e.target.value })}
        placeholder="Player notes…"
        className="themed-placeholder"
        style={{
          background: 'var(--bg-base)',
          border: 'var(--app-bw) solid var(--border)',
          borderRadius: 5,
          color: 'var(--text)',
          fontSize: 12,
          padding: '6px 8px',
          resize: 'vertical',
          minHeight: 64,
          outline: 'none',
          fontFamily: 'inherit',
          lineHeight: 1.5,
        }}
      />
    </div>
  )
}

// ── Main party manager modal ────────────────────────────────────────────────
interface Props {
  partyId: string
  onClose: () => void
}

export function PartyManager({ partyId, onClose }: Props) {
  const { parties, updateParty, removeParty, addPlayer } = usePartyStore()
  const party = parties.find(p => p.id === partyId)

  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(party?.name ?? '')
  const [levelVal, setLevelVal] = useState(String(party?.level ?? 1))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (party) { setNameVal(party.name); setLevelVal(String(party.level)) }
  }, [party?.name, party?.level])

  useEffect(() => {
    if (editingName) nameRef.current?.select()
  }, [editingName])

  if (!party) return null

  const commitName = () => {
    const trimmed = nameVal.trim()
    const lvl = parseInt(levelVal)
    updateParty(partyId, {
      name: trimmed || party.name,
      level: isNaN(lvl) ? party.level : lvl,
    })
    setEditingName(false)
  }

  const handleDelete = () => {
    removeParty(partyId)
    onClose()
  }

  return (
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 60,
      }}
    >
      <div style={{
        background: 'var(--bg-panel)',
        border: 'var(--app-bw) solid var(--border-strong)',
        borderRadius: 12,
        boxShadow: 'var(--shadow-md)',
        width: '100%',
        maxWidth: 640,
        maxHeight: 'calc(100vh - 100px)',
        display: 'flex',
        flexDirection: 'column',
        margin: '0 16px',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px',
          borderBottom: 'var(--app-bw) solid var(--border)',
          flexShrink: 0,
          background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
        }}>
          {editingName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <input
                ref={nameRef}
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                onBlur={commitName}
                onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setNameVal(party.name); setEditingName(false) } }}
                style={{
                  background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border-strong)',
                  borderRadius: 5, color: 'var(--text)',
                  fontSize: 16, fontWeight: 700,
                  padding: '3px 8px', outline: 'none', flex: 1,
                }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>Lv</span>
              <input
                value={levelVal}
                onChange={e => setLevelVal(e.target.value)}
                onBlur={commitName}
                onKeyDown={e => e.key === 'Enter' && commitName()}
                type="number" min={1} max={20}
                style={{
                  background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border-strong)',
                  borderRadius: 5, color: 'var(--text)',
                  fontSize: 14, fontWeight: 700,
                  padding: '3px 6px', outline: 'none', width: 54,
                }}
              />
            </div>
          ) : (
            <div
              onClick={() => setEditingName(true)}
              style={{
                flex: 1, cursor: 'text',
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <span style={{ color: 'var(--text)', fontSize: 16, fontWeight: 700 }}>{party.name}</span>
              <span style={{
                background: 'var(--accent-soft)', borderRadius: 4,
                color: 'var(--accent)', fontSize: 11, fontWeight: 700,
                padding: '1px 7px', border: 'var(--app-bw) solid var(--accent-line)',
              }}>Level {party.level}</span>
              <PencilIcon size={11} style={{ color: 'var(--text-faded)', opacity: 0.7 }} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            {confirmDelete ? (
              <>
                <button onClick={handleDelete} style={{
                  background: 'var(--danger)', border: 'var(--app-bw) solid var(--danger)',
                  borderRadius: 5, color: 'var(--text-on-danger)', fontSize: 11,
                  padding: '4px 12px', cursor: 'pointer', fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}><TrashIcon size={11} /> Delete party?</button>
                <button onClick={() => setConfirmDelete(false)} style={{
                  background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border-strong)',
                  borderRadius: 5, color: 'var(--text-muted)', fontSize: 11,
                  padding: '4px 10px', cursor: 'pointer',
                }}>Cancel</button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} style={{
                background: 'none', border: 'var(--app-bw) solid var(--border)',
                borderRadius: 5, color: 'var(--text-muted)', fontSize: 11,
                padding: '4px 10px', cursor: 'pointer',
                transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 4,
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--danger)'; e.currentTarget.style.color = 'var(--danger)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
              ><TrashIcon size={11} /> Delete</button>
            )}
            <button onClick={onClose} style={{
              background: 'none', border: 'var(--app-bw) solid var(--border)',
              borderRadius: 5, color: 'var(--text-muted)', fontSize: 16,
              width: 30, height: 30, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
            ><XIcon size={14} /></button>
          </div>
        </div>

        {/* Player cards */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '14px 18px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 10,
          alignContent: 'start',
        }}>
          {party.players.length === 0 && (
            <div style={{
              gridColumn: '1 / -1',
              color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic',
              textAlign: 'center', padding: '24px 0',
            }}>
              No players yet — add your first player below.
            </div>
          )}
          {party.players.map(pl => (
            <PlayerCard key={pl.id} player={pl} partyId={partyId} />
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px',
          borderTop: 'var(--app-bw) solid var(--border)',
          flexShrink: 0,
        }}>
          <button
            onClick={() => addPlayer(partyId)}
            style={{
              background: 'var(--accent-soft)', border: 'var(--app-bw) solid var(--accent-line)',
              borderRadius: 6, color: 'var(--accent)', fontSize: 13,
              padding: '6px 18px', cursor: 'pointer', fontWeight: 700,
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 5,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 22%, transparent)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-soft)' }}
          ><PlusIcon size={13} /> Add Player</button>
        </div>
      </div>
    </div>
  )
}
