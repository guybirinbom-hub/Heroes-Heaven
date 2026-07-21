import { useState, useEffect, useRef, Children, type ReactNode } from 'react'
import { usePartyStore } from '../store/partyStore'
import { parseWanderersGuide } from '../utils/wanderersGuide'
import { parsePathbuilder } from '../utils/pathbuilder'
import { useCombatStore } from '../store/combatStore'
import type { PartyPlayer } from '../store/partyStore'
import type { Creature } from '../types/pf2e'
import { MonsterSearch } from './MonsterSearch'
import { formatTurnTime } from '../utils/turnTimer'
import { TurnTimeline } from './TurnTimeline'
import { PcStatsEditor } from './PcStatsEditor'
import { PcDetailControls } from './PcDetailControls'
import { useSettingsStore } from '../store/settingsStore'
import { type PcDetailConfig } from '../utils/pcDetail'
import { derivePartyLevel } from '../utils/partyLevel'
import { useCampaignPartyLevel } from '../data/partyLevelContext'
import { TrashIcon, XIcon, PlusIcon, CheckIcon, PencilIcon, LinkIcon, SwordIcon, EyeIcon, ChevronRightIcon } from './Icons'

// ── Masonry grid ─────────────────────────────────────────────────────────────
// Round-robin masonry: cards flow into a fixed number of equal-width columns
// (available width ÷ min column width). Each column is its own vertical stack,
// so collapsing a card lifts only the cards below it IN THAT COLUMN — no
// cross-column reshuffle (unlike CSS columns, which rebalance). Item i goes to
// column i % cols, so the left→right, top→bottom reading order is preserved.
function MasonryGrid({ children, minColWidth = 240, gap = 14 }: { children: ReactNode; minColWidth?: number; gap?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const compute = () => setCols(Math.max(1, Math.floor((el.clientWidth + gap) / (minColWidth + gap))))
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [gap, minColWidth])
  const items = Children.toArray(children)
  const columns: ReactNode[][] = Array.from({ length: cols }, () => [])
  items.forEach((child, i) => columns[i % cols].push(child))
  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'flex-start', gap }}>
      {columns.map((col, ci) => (
        <div key={ci} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap }}>{col}</div>
      ))}
    </div>
  )
}

// ── Member card (PC or NPC) ─────────────────────────────────────────────────
interface MemberCardProps {
  player: PartyPlayer
  partyId: string
  onLinkStatBlock: (playerId: string) => void
  detail: PcDetailConfig
}

function MemberCard({ player, partyId, onLinkStatBlock, detail }: MemberCardProps) {
  const { updatePlayer, removePlayer } = usePartyStore()
  const [name, setName] = useState(player.name)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)

  useEffect(() => { setName(player.name) }, [player.name])

  const commitName = () => {
    const t = name.trim()
    if (t && t !== player.name) updatePlayer(partyId, player.id, { name: t })
    else setName(player.name)
  }

  const isNPC = player.memberType === 'npc'

  return (
    <div style={{
      // Card surface — sits one tier above the page bg so it's visible on
      // both dark and light themes. NPCs get a sage/linked border tint to
      // distinguish them from regular party members.
      background: 'var(--bg-elevated)',
      border: `var(--app-bw) solid ${confirmRemove ? 'var(--danger)' : (isNPC ? 'color-mix(in srgb, var(--linked) 35%, transparent)' : 'var(--border-strong)')}`,
      borderRadius: 8,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: collapsed ? 0 : 7,
      position: 'relative',
    }}>
      {/* Name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Collapse / expand — chevron points right when collapsed, down when open */}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand card' : 'Collapse card'}
          style={{
            background: 'none', border: 'none', color: 'var(--text-faded)',
            cursor: 'pointer', padding: 0, flexShrink: 0,
            display: 'flex', alignItems: 'center',
            transition: 'transform 0.15s, color 0.15s',
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faded)')}
        ><ChevronRightIcon size={13} /></button>
        {isNPC && (
          <span style={{
            background: 'var(--linked-soft)', border: 'var(--app-bw) solid var(--linked)',
            borderRadius: 3, color: 'var(--linked)', fontSize: 9,
            padding: '0 5px', fontWeight: 700, flexShrink: 0,
          }}>NPC</span>
        )}
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          placeholder={isNPC ? 'NPC name' : 'Player name'}
          style={{
            flex: 1, background: 'transparent',
            border: 'none',
            borderBottom: `var(--app-bw) solid ${isNPC ? 'var(--linked)' : 'var(--border-strong)'}`,
            color: 'var(--text)', fontSize: 13, fontWeight: 700,
            padding: '2px 0', outline: 'none', minWidth: 0,
          }}
        />
        {/* Turn-time average — shown once turns have been saved for this name.
            Click to open the timeline of session averages over time. */}
        {player.turnAvgSeconds != null && (player.turnCount ?? 0) > 0 && (
          <button
            onClick={() => setShowTimeline(true)}
            title={`Average turn time over ${player.turnCount} saved turn${player.turnCount === 1 ? '' : 's'} — click for the timeline`}
            style={{
              flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'var(--accent-soft)', border: 'var(--app-bw) solid var(--accent-line)',
              borderRadius: 'var(--radius-full)', padding: '1px 8px', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--accent)', fontWeight: 600,
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-on-accent)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-soft)'; e.currentTarget.style.color = 'var(--accent)' }}
          >⏱ {formatTurnTime(player.turnAvgSeconds)}</button>
        )}
        {!confirmRemove && (
          <button
            onClick={() => setConfirmRemove(true)}
            title="Remove"
            style={{
              background: 'none', border: 'none', color: 'var(--text-faded)',
              cursor: 'pointer', padding: '0 2px',
              transition: 'color 0.15s', flexShrink: 0,
              display: 'flex', alignItems: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faded)')}
          ><TrashIcon size={13} /></button>
        )}
      </div>

      {!collapsed && (<>
      {/* NPC stat block link row */}
      {isNPC && (
        player.creature ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--linked-soft)',
            border: 'var(--app-bw) solid color-mix(in srgb, var(--linked) 30%, transparent)',
            borderRadius: 5, padding: '5px 8px',
          }}>
            <SwordIcon size={11} style={{ color: 'var(--linked)', flexShrink: 0 }} />
            <span style={{ color: 'var(--linked)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {player.creature.name}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>Lv{player.creature.level}</span>
            <button
              onClick={() => onLinkStatBlock(player.id)}
              title="Change stat block"
              style={{
                background: 'none', border: 'none', color: 'var(--linked)',
                cursor: 'pointer', padding: '0 2px',
                transition: 'color 0.15s', flexShrink: 0, opacity: 0.7,
                display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
            ><PencilIcon size={11} /></button>
            <button
              onClick={() => updatePlayer(partyId, player.id, { creature: null })}
              title="Unlink stat block"
              style={{
                background: 'none', border: 'none', color: 'var(--text-faded)',
                cursor: 'pointer', padding: '0 2px',
                transition: 'color 0.15s', flexShrink: 0,
                display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faded)')}
            ><XIcon size={12} /></button>
          </div>
        ) : (
          <button
            onClick={() => onLinkStatBlock(player.id)}
            style={{
              background: 'var(--linked-soft)',
              border: '1px dashed color-mix(in srgb, var(--linked) 30%, transparent)',
              borderRadius: 5, color: 'var(--linked)', fontSize: 11,
              padding: '5px 8px', cursor: 'pointer', textAlign: 'left',
              transition: 'all 0.15s', width: '100%',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--linked)'; e.currentTarget.style.background = 'color-mix(in srgb, var(--linked) 22%, transparent)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--linked) 30%, transparent)'; e.currentTarget.style.background = 'var(--linked-soft)' }}
          >
            <LinkIcon size={11} /> Link Stat Block
          </button>
        )
      )}

      {/* PC stat sheet — only the sections enabled by the detail level */}
      {!isNPC && <PcStatsEditor partyId={partyId} player={player} detail={detail} />}

      {/* Notes */}
      <textarea
        value={player.notes}
        onChange={e => updatePlayer(partyId, player.id, { notes: e.target.value })}
        placeholder={isNPC ? 'NPC notes…' : 'Player notes…'}
        className="themed-placeholder"
        style={{
          background: 'var(--bg-base)',
          border: 'var(--app-bw) solid var(--border)',
          borderRadius: 5, color: 'var(--text)', fontSize: 12,
          padding: '6px 8px', resize: 'vertical', minHeight: 72,
          outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
        }}
      />
      </>)}

      {/* Delete confirm — the whole card turns red with the prompt centred on
          it, so it stays on-screen even when zoomed in or scrolled. */}
      {confirmRemove && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 6, borderRadius: 8,
          background: 'color-mix(in srgb, var(--danger) 20%, var(--bg-elevated))',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 10, padding: 14, textAlign: 'center',
        }}>
          <span style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 700 }}>
            Remove this {isNPC ? 'NPC' : 'player'}?
          </span>
          {player.name && (
            <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button
              onClick={() => removePlayer(partyId, player.id)}
              style={{
                background: 'var(--danger)', border: 'var(--app-bw) solid var(--danger)',
                borderRadius: 5, color: 'var(--text-on-danger)', fontSize: 12,
                padding: '5px 14px', cursor: 'pointer', fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}
            ><CheckIcon size={11} /> Remove</button>
            <button
              onClick={() => setConfirmRemove(false)}
              style={{
                background: 'var(--bg-elevated)', border: 'var(--app-bw) solid var(--border-strong)',
                borderRadius: 5, color: 'var(--text)', fontSize: 12,
                padding: '5px 14px', cursor: 'pointer', fontWeight: 600,
              }}
            >Cancel</button>
          </div>
        </div>
      )}

      {showTimeline && <TurnTimeline player={player} onClose={() => setShowTimeline(false)} />}
    </div>
  )
}

// ── Party view (main panel) ─────────────────────────────────────────────────
interface Props {
  partyId: string
  /**
   * Replaces the PLAYERS list (and its "Add Player" button) with someone else's cards.
   * Heroes Heaven passes its own campaign party-member cards here, because inside a campaign the
   * players ARE the campaign's characters — they shouldn't be re-typed into the tracker.
   * Omitted (standalone tracker) → the built-in editable player cards, unchanged.
   */
  playersSlot?: ReactNode
}

export function PartyView({ partyId, playersSlot }: Props) {
  const { parties, updateParty, removeParty, addPlayer, addNPC, updatePlayer, setPartyDetail, importCharacter } = usePartyStore()
  // When a host supplies the cards (Heroes Heaven), it also OWNS the party's identity — the name,
  // level and existence are the campaign's, edited in the campaign's own settings. So this header
  // drops the name editor, the level badge and Delete; the standalone tracker (no playersSlot) keeps
  // all three, because there it's the only place to manage the party.
  const hostManaged = playersSlot != null
  const { combatants, addCombatant } = useCombatStore()
  const globalDetail = useSettingsStore(s => s.pcDetail)
  const party = parties.find(p => p.id === partyId)

  const [nameVal, setNameVal] = useState('')
  const [levelVal, setLevelVal] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pickerPlayerId, setPickerPlayerId] = useState<string | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const importTimer = useRef<number | null>(null)
  // Which builder's export the next file-pick is for (chosen from the dropdown).
  const pendingSource = useRef<'wg' | 'pb'>('wg')
  // (the Import Character menu's open-state went with the button — see the note in the toolbar)

  const flashImport = (kind: 'ok' | 'err', text: string) => {
    setImportMsg({ kind, text })
    if (importTimer.current) window.clearTimeout(importTimer.current)
    importTimer.current = window.setTimeout(() => setImportMsg(null), 6000)
  }

  // Import one or more character JSON exports from the chosen builder. New
  // names are added; names that already exist in this party update in place.
  const handleImportFiles = async (files: File[], source: 'wg' | 'pb') => {
    const parse = source === 'pb' ? parsePathbuilder : parseWanderersGuide
    const srcLabel = source === 'pb' ? 'Pathbuilder' : 'Wanderer’s Guide'
    let added = 0, updated = 0, failed = 0, lastName = ''
    for (const file of files) {
      try {
        const raw = JSON.parse(await file.text())
        const res = parse(raw)
        if (!res.ok) { failed++; continue }
        const { matched } = importCharacter(partyId, res.character)
        lastName = res.character.name
        if (matched) updated++; else added++
      } catch { failed++ }
    }
    const done = added + updated
    if (done === 0) {
      flashImport('err', `Couldn’t read ${files.length === 1 ? 'that file' : 'those files'}. Export the JSON from ${srcLabel} (and pick it from the matching menu item).`)
      return
    }
    if (files.length === 1 && done === 1) {
      flashImport('ok', `${updated ? 'Updated' : 'Imported'} ${lastName}.`)
    } else {
      const parts = [added && `${added} added`, updated && `${updated} updated`, failed && `${failed} failed`]
        .filter(Boolean).join(', ')
      flashImport(failed ? 'err' : 'ok', `Import: ${parts}.`)
    }
  }

  useEffect(() => {
    if (party) { setNameVal(party.name); setLevelVal(String(party.level)) }
  }, [party?.name, party?.level])

  if (!party) return (
    <div className="flex-1 flex items-center justify-center text-pf-muted text-sm italic">Party not found.</div>
  )

  const pickerPlayer = pickerPlayerId ? party.players.find(p => p.id === pickerPlayerId) : null

  const commitName = () => {
    const t = nameVal.trim()
    if (t) updateParty(partyId, { name: t })
    else setNameVal(party.name)
  }

  const commitLevel = () => {
    const lvl = parseInt(levelVal)
    if (!isNaN(lvl)) updateParty(partyId, { level: lvl })
    else setLevelVal(String(party.level))
  }

  const handleDelete = () => { removeParty(partyId) }

  const addAllToInitiative = () => {
    const existing = new Set(combatants.map(c => c.name.toLowerCase()))
    party.players.forEach(pl => {
      if (existing.has(pl.name.toLowerCase())) return
      if (pl.memberType === 'npc') {
        addCombatant(pl.creature ?? null, { name: pl.name, isPC: false, isAlly: true })
      } else {
        addCombatant(null, { name: pl.name, isPC: true, maxHP: pl.pcStats?.maxHP })
      }
    })
  }

  const handleCreatureSelect = (creature: Creature) => {
    if (pickerPlayerId) updatePlayer(partyId, pickerPlayerId, { creature })
    setPickerPlayerId(null)
  }

  const pcs = party.players.filter(p => p.memberType !== 'npc')
  const npcs = party.players.filter(p => p.memberType === 'npc')

  /*
   * Party level, derived rather than typed — see utils/partyLevel.ts for why the input had to go.
   * Priority: the host campaign's real characters, then this party's own PC stat blocks. Both are
   * read-only, because in either case the characters already know their levels and a second,
   * hand-typed number could only disagree with them.
   *
   * `derived == null` means nothing on screen knows a level (a standalone party of name-only PCs),
   * and ONLY THEN does the manual input survive — otherwise there'd be no way to rate encounters
   * for such a party at all. In a Heroes Heaven campaign that branch is unreachable.
   */
  const campaignLevel = useCampaignPartyLevel()
  const derived = campaignLevel ?? derivePartyLevel(
    pcs.map(p => p.creature?.level).filter((l): l is number => typeof l === 'number'),
  )
  const shownLevel = derived ?? party.level
  // Effective detail level: this party's override, else the global default.
  const detail = party.pcDetail ?? globalDetail
  const isOverridden = party.pcDetail !== undefined

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-panel)' }}>
      {/* ── Page head — large display title + level + actions ── */}
      <div style={{
        padding: '28px 36px 18px',
        borderBottom: 'var(--app-bw) solid var(--border)',
        flexShrink: 0,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: 24, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, minWidth: 0 }}>
          {hostManaged ? (
            // Host-managed: the name is the campaign's (also in the chrome title), edited only in
            // campaign settings — so it's a plain, non-editable heading here.
            <span
              style={{
                color: 'var(--text)', fontFamily: 'var(--font-display)',
                fontVariationSettings: '"opsz" 96',
                fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
              }}
            >
              {party.name}
            </span>
          ) : (
            <input
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: 'var(--app-bw) solid transparent',
                color: 'var(--text)',
                fontFamily: 'var(--font-display)',
                fontVariationSettings: '"opsz" 96',
                fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em',
                padding: '1px 0', outline: 'none', minWidth: 120,
                transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--accent-line)')}
              onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderBottomColor = 'transparent' }}
            />
          )}
          {/* Party level — DERIVED from the characters, not typed. Shown standalone (it's what
              encounter difficulty is rated against, and there's nowhere else to see it), but hidden
              when host-managed: the campaign owns the party's level and it's redundant here. */}
          {!hostManaged && (
            <span
              title={derived != null
                ? "Derived from your characters' levels — this is what encounter difficulty is rated against."
                : 'Party level — what encounter difficulty is rated against. Give your PCs stat blocks and this follows them automatically.'}
              style={{
                display: 'inline-flex', alignItems: 'baseline', gap: 6,
                color: 'var(--text-faded)', fontFamily: 'var(--font-mono)', fontSize: 14,
              }}
            >
              LV
              {derived != null ? (
                <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{shownLevel}</span>
              ) : (
                <input
                  type="number" min={1} max={30}
                  value={levelVal}
                  onChange={e => setLevelVal(e.target.value)}
                  onBlur={commitLevel}
                  onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                  style={{
                    background: 'transparent', border: 'none',
                    borderBottom: 'var(--app-bw) solid var(--border-strong)',
                    color: 'var(--accent)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 14, fontWeight: 500,
                    padding: '1px 0', outline: 'none', width: 36,
                  }}
                />
              )}
            </span>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={addAllToInitiative}
            className="btn btn-primary"
            title="Add all members to initiative (skips duplicates)"
          >
            <SwordIcon size={12} /> Add to Initiative
          </button>

          {/* Import a character JSON from the chosen builder (multiple allowed). */}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            multiple
            style={{ display: 'none' }}
            onChange={e => {
              const files = Array.from(e.target.files ?? [])
              if (files.length) handleImportFiles(files, pendingSource.current)
              e.target.value = ''   // allow re-importing the same file
            }}
          />
          {/* "Import Character" (Wanderer's Guide / Pathbuilder JSON) removed at the user's request:
              inside Heroes Heaven the party should come from HH's own characters, not a file import.
              The import MACHINERY below is kept intact (file input + handlers) so the capability can
              be restored — or re-pointed at HH characters — without rewriting it. */}
          {importMsg && (
            <span
              role="status"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 11.5, fontWeight: 600, maxWidth: 320,
                padding: '4px 10px', borderRadius: 'var(--radius-full)',
                background: importMsg.kind === 'ok' ? 'var(--accent-soft)' : 'var(--danger-soft)',
                color: importMsg.kind === 'ok' ? 'var(--accent)' : 'var(--danger)',
                border: `var(--app-bw) solid ${importMsg.kind === 'ok' ? 'var(--accent-line)' : 'var(--danger)'}`,
              }}
            >
              {importMsg.kind === 'ok' ? <CheckIcon size={11} /> : <XIcon size={11} />}
              {importMsg.text}
            </span>
          )}

          {/* Per-party stat-detail override */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowDetail(v => !v)}
              className="btn btn-secondary"
              title="Choose how many stats show on each member"
              style={isOverridden ? { borderColor: 'var(--accent-line)', color: 'var(--accent)' } : undefined}
            >
              <EyeIcon size={12} /> Stats shown ▾
            </button>
            {showDetail && (
              <>
                <div onClick={() => setShowDetail(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
                  width: 280, background: 'var(--bg-panel)',
                  border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 'var(--radius)',
                  boxShadow: 'var(--shadow-lg)', padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span className="pf-label">Stats shown — this party</span>
                  </div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-faded)', fontStyle: 'italic', marginBottom: 10 }}>
                    {isOverridden ? 'overriding the global default' : 'following the global default'}
                  </div>
                  <PcDetailControls config={detail} compact
                    onChange={cfg => setPartyDetail(partyId, cfg)} />
                  {isOverridden && (
                    <button
                      onClick={() => setPartyDetail(partyId, null)}
                      className="btn btn-secondary btn-sm"
                      style={{ width: '100%', justifyContent: 'center', marginTop: 10, fontSize: 11 }}
                    >↺ Reset to global default</button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Delete lives here only for a standalone party. Host-managed (a campaign), deleting is
              done in campaign settings — deleting the tracker party would be a confusing half-delete
              that leaves the campaign itself intact. */}
          {!hostManaged && (confirmDelete ? (
            <>
              <button onClick={handleDelete} className="btn"
                style={{
                  background: 'var(--danger-soft)', borderColor: 'var(--danger)',
                  color: 'var(--danger)', fontWeight: 700,
                }}><TrashIcon size={11} /> Delete?</button>
              <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost">
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="btn btn-ghost"
              style={{ color: 'var(--text-faded)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'var(--danger-soft)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-faded)'; e.currentTarget.style.background = 'transparent' }}
            ><TrashIcon size={11} /> Delete</button>
          ))}
        </div>
      </div>

      {/* ── Members grid ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 36px 36px', display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* PCs section */}
        <div>
          <div className="section-head" style={{ marginBottom: 14 }}>
            <span className="pf-label">Players</span>
            {/* No count when a host supplies the cards — it owns that list and its own presentation. */}
            {!playersSlot && <span className="count">{pcs.length}</span>}
            <div className="rule" />
          </div>
          {/* When a host supplies the player cards (Heroes Heaven does), render those instead —
              no "Add Player", because the players come from the campaign, not from typing them in. */}
          {playersSlot ?? (
            /* Masonry so each card is only as tall as it needs to be — collapsing
               a card lets the ones below it in its column rise to fill the gap,
               instead of a grid holding the whole row open. */
            <MasonryGrid>
              {pcs.map(pl => (
                <MemberCard
                  key={pl.id}
                  player={pl}
                  partyId={partyId}
                  onLinkStatBlock={setPickerPlayerId}
                  detail={detail}
                />
              ))}
              <button
                onClick={() => addPlayer(partyId)}
                style={{
                  background: 'transparent', border: '1px dashed var(--border-strong)',
                  borderRadius: 'var(--radius)', color: 'var(--text-faded)',
                  fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 500,
                  cursor: 'pointer', padding: '20px 0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.15s', minHeight: 92,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-line)'; e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-soft)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-faded)'; e.currentTarget.style.background = 'transparent' }}
              ><PlusIcon size={13} /> Add Player</button>
            </MasonryGrid>
          )}
        </div>

        {/* NPCs section */}
        <div>
          <div className="section-head" style={{ marginBottom: 14 }}>
            <span className="pf-label">NPCs</span>
            <span className="count">{npcs.length}</span>
            <div className="rule" />
          </div>
          {/* Masonry so each card is only as tall as it needs to be — collapsing
              a card lets the ones below it in its column rise to fill the gap,
              instead of a grid holding the whole row open. */}
          <MasonryGrid>
            {npcs.map(pl => (
              <MemberCard
                key={pl.id}
                player={pl}
                partyId={partyId}
                onLinkStatBlock={setPickerPlayerId}
                detail={detail}
              />
            ))}
            <button
              onClick={() => addNPC(partyId, null)}
              style={{
                background: 'transparent', border: '1px dashed var(--border-strong)',
                borderRadius: 'var(--radius)', color: 'var(--text-faded)',
                fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 500,
                cursor: 'pointer', padding: '20px 0',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 0.15s', minHeight: 92,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--linked)'; e.currentTarget.style.color = 'var(--linked)'; e.currentTarget.style.background = 'var(--linked-soft)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-faded)'; e.currentTarget.style.background = 'transparent' }}
            ><PlusIcon size={13} /> Add NPC</button>
          </MasonryGrid>
        </div>
      </div>

      {/* Creature picker modal — rendered outside the grid.
          Uses the full MonsterSearch in pick-mode so the user gets the same
          filters / sources / level slider here as in the "Add Combatants" flow. */}
      {pickerPlayerId && (
        <MonsterSearch
          title={pickerPlayer?.creature ? 'Change Stat Block' : 'Link Stat Block'}
          onPick={handleCreatureSelect}
          onClose={() => setPickerPlayerId(null)}
        />
      )}
    </div>
  )
}
