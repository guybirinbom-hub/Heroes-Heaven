import { useState, useRef } from 'react'
import type { Combatant } from '../types/pf2e'
import { useCombatStore } from '../store/combatStore'
import { ConditionPanel, ConditionBadgeList } from './ConditionPanel'
import { NumberInput } from './NumberInput'
import { TraitTags } from './TraitTags'

interface Props {
  combatant: Combatant
  showNotes?: boolean
  onToggleNotes?: () => void
  showDescription?: boolean
  onToggleDescription?: () => void
}

export function HPTracker({ combatant, showNotes, onToggleNotes, showDescription, onToggleDescription }: Props) {
  const { applyDamage, applyHealing, setTempHP, setMaxHP } = useCombatStore()
  const [input, setInput] = useState('')
  const [editingMax, setEditingMax] = useState(false)
  const [newMax, setNewMax] = useState(combatant.maxHP)
  const [showConditions, setShowConditions] = useState(false)
  const condBtnRef = useRef<HTMLButtonElement>(null)

  // Hazards don't track HP/AC like combatants — they're triggered, do their
  // thing, and are dealt with via Disable / damage outside the bar metaphor.
  // Per request: hide the HP bar + manual condition controls for hazards.
  // We still render the ConditionBadgeList so ability cooldowns (the only
  // conditions that auto-apply to hazards) remain visible.
  const isHazard = !!combatant.creature?.isHazard
  if (isHazard) {
    return (
      <div>
        <div style={{
          padding: '8px 14px',
          background: 'var(--bg-elevated)',
          border: 'var(--app-bw) solid var(--border)',
          borderRadius: 'var(--radius)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontFamily: 'var(--font-ui)', fontSize: 12,
          color: 'var(--text-muted)',
        }}>
          <span style={{
            color: 'var(--accent)', fontWeight: 700, fontSize: 10,
            letterSpacing: '.10em', textTransform: 'uppercase',
          }}>⚠ Hazard</span>
          <span style={{ color: 'var(--text-faded)', fontSize: 11.5 }}>
            See stat block for Stealth, Disable, and Routine.
          </span>
          {(onToggleNotes || onToggleDescription) && (
            <>
              <div style={{ flex: 1 }} />
              {onToggleDescription && (
                <button onClick={onToggleDescription} className="btn btn-ghost btn-sm">
                  {showDescription ? 'Stat Block' : 'Description'}
                </button>
              )}
              {onToggleNotes && (
                <button onClick={onToggleNotes} className="btn btn-ghost btn-sm">
                  {showNotes ? 'Stat Block' : 'Notes'}
                </button>
              )}
            </>
          )}
        </div>
        <ConditionBadgeList combatant={combatant} />
      </div>
    )
  }

  // Drained X reduces max HP by X × the creature's level. We don't mutate the
  // stored maxHP (that tangles with Elite/Weak/scale); instead we show the loss
  // in the bar: the bar spans the OLD max, the drained-away portion on the right
  // is greyed, and the text reads "current / newMax (oldMax)".
  const oldMax = combatant.maxHP
  const drainedVal = combatant.conditions.find(c => c.name.toLowerCase() === 'drained')?.value ?? 0
  const drainLvl = combatant.scaledToLevel ?? combatant.creature?.level ?? 0
  const drainedLoss = drainedVal > 0 ? Math.max(0, Math.min(oldMax - 1, drainedVal * drainLvl)) : 0
  const isDrained = drainedLoss > 0
  const effMax = oldMax - drainedLoss                       // new, reduced max
  const drainStartPct = oldMax > 0 ? (effMax / oldMax) * 100 : 100  // where grey begins

  const pct = oldMax > 0 ? combatant.currentHP / oldMax : 0          // fill width vs OLD max
  const colorPct = effMax > 0 ? combatant.currentHP / effMax : 0     // health vs effective max
  const hpColor = colorPct > 0.5 ? 'var(--hp-full)' : colorPct > 0.25 ? 'var(--hp-mid)' : 'var(--hp-low)'
  const tempPct = oldMax > 0
    ? Math.min(combatant.tempHP, oldMax - combatant.currentHP) / oldMax
    : 0

  const handleApply = () => {
    const raw = input.trim()
    if (!raw) return
    if (raw.toLowerCase().startsWith('t')) {
      const val = parseInt(raw.slice(1))
      if (!isNaN(val) && val >= 0) setTempHP(combatant.id, val)
    } else {
      const val = parseInt(raw)
      if (isNaN(val)) return
      if (val < 0) applyHealing(combatant.id, Math.abs(val))
      else if (val > 0) applyDamage(combatant.id, val)
    }
    setInput('')
  }

  const condCount = combatant.conditions.length

  return (
    <div>
      {/* HP track row — damage/condition controls on the LEFT, then the HP bar
          (which shortens to flex-fill whatever space the controls leave). */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <button
          ref={condBtnRef}
          onClick={() => setShowConditions(v => !v)}
          className="btn btn-sm"
          style={{
            flexShrink: 0,
            ...(showConditions ? {
              background: 'var(--accent-soft)',
              borderColor: 'var(--accent-line)',
              color: 'var(--accent)',
            } : {}),
          }}
        >
          {condCount > 0 ? `Conditions (${condCount})` : '+ Condition'}
        </button>
        <input
          type="text" value={input}
          placeholder="50 · -30 · t15"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleApply()}
          className="input-dark input-mono"
          style={{ width: 96, padding: '5px 10px', fontSize: 12, flexShrink: 0 }}
        />
        <button onClick={handleApply} className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}>
          Apply
        </button>

        {/* HP bar box — flex-fills the remaining width (so it's shorter now that
            the controls share the row). Wraps to its own line if too cramped. */}
        <div style={{
          flex: '1 1 220px', minWidth: 0,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 12px',
          background: 'var(--bg-elevated)',
          border: 'var(--app-bw) solid var(--border)',
          borderRadius: 'var(--radius)',
        }}>
          <span style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 11, fontWeight: 700, letterSpacing: '.12em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
            flexShrink: 0,
          }}>HP</span>
          <div style={{
            flex: 1, minWidth: 32, height: 8, position: 'relative',
            background: 'var(--bg-base)', borderRadius: 4, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.max(0, Math.min(100, pct * 100))}%`,
              background: hpColor,
              borderRadius: 4,
              transition: 'width 0.3s',
              boxShadow: pct > 0.5 ? `0 0 8px color-mix(in srgb, ${hpColor} 28%, transparent)` : 'none',
            }} />
            {tempPct > 0 && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${Math.max(0, Math.min(100, pct * 100))}%`,
                width: `${Math.max(0, Math.min(100 - pct * 100, tempPct * 100))}%`,
                background: 'var(--linked)', opacity: 0.85,
              }} />
            )}
            {/* Max HP lost to Drained — greyed, painted last so it always shows
                even if the creature's current HP hasn't been reduced yet. */}
            {isDrained && (
              <div title={`Max HP reduced by ${drainedLoss} (Drained ${drainedVal})`}
                style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `${drainStartPct}%`, right: 0,
                  background: 'var(--text-faded)', opacity: 0.5,
                  backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(0,0,0,0.25) 3px 6px)',
                }} />
            )}
          </div>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13, color: 'var(--text)', fontWeight: 500,
            flexShrink: 0,
          }}>
            {combatant.currentHP}
            {combatant.tempHP > 0 && <span style={{ color: 'var(--linked)' }}> +{combatant.tempHP}</span>}
            {editingMax ? (
              <>
                {' / '}
                <NumberInput
                  className="input-dark input-mono"
                  min={0}
                  value={newMax}
                  onChange={e => setNewMax(parseInt(e.target.value) || 0)}
                  onStep={n => setNewMax(Math.max(0, n))}
                  onBlur={() => { setMaxHP(combatant.id, newMax); setEditingMax(false) }}
                  onKeyDown={e => e.key === 'Enter' && (setMaxHP(combatant.id, newMax), setEditingMax(false))}
                  style={{ width: 76, fontSize: 12 }}
                  autoFocus
                />
              </>
            ) : isDrained ? (
              <>
                {' / '}<span>{effMax}</span>
                <span style={{ color: 'var(--text-faded)', cursor: 'pointer' }}
                  title={`Original max HP — Drained ${drainedVal} reduces it by ${drainedLoss}. Click to edit.`}
                  onClick={() => { setNewMax(combatant.maxHP); setEditingMax(true) }}>
                  {' '}({oldMax})
                </span>
              </>
            ) : (
              <span style={{ color: 'var(--text-faded)', cursor: 'pointer' }}
                onClick={() => { setNewMax(combatant.maxHP); setEditingMax(true) }}>
                {' / '}{combatant.maxHP}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Traits + view toggles row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginTop: 10, flexWrap: 'wrap',
      }}>
        {/* Trait tags (+ Elite/Weak pills) fill the gap and push the view
            toggles to the right edge. */}
        <div style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
        }}>
          {/* Applied conditions sit to the LEFT of the trait tags. */}
          <ConditionBadgeList combatant={combatant} inline />
          {(combatant.creature || combatant.isElite || combatant.isWeak) && (
            <TraitTags
              traits={combatant.creature?.traits ?? []}
              compact
              elite={combatant.isElite}
              weak={combatant.isWeak}
            />
          )}
        </div>
        {onToggleDescription && (
          <button onClick={onToggleDescription} className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
            {showDescription ? 'Stat Block' : 'Description'}
          </button>
        )}
        {onToggleNotes && (
          <button onClick={onToggleNotes} className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
            {showNotes ? 'Stat Block' : 'Notes'}
          </button>
        )}
      </div>

      {showConditions && (
        <ConditionPanel
          combatant={combatant}
          anchorEl={condBtnRef.current}
          onClose={() => setShowConditions(false)}
        />
      )}
    </div>
  )
}
