import { useEffect } from 'react'
import { useCombatStore } from '../store/combatStore'
import type { DiceResult } from '../types/pf2e'
import { fmtBonus } from '../utils/dice'

function ResultCard({ r, onDismiss }: { r: DiceResult; onDismiss: () => void }) {
  // Reminders linger a little longer so the GM has time to act on them.
  useEffect(() => {
    const t = setTimeout(onDismiss, r.kind === 'reminder' ? 11000 : 6000)
    return () => clearTimeout(t)
  }, [onDismiss, r.kind])

  // Persistent-damage (and future) reminders render as a warning card, not a
  // big number.
  if (r.kind === 'reminder') {
    return (
      <div className="dice-result cursor-pointer" onClick={onDismiss} style={{ borderColor: 'var(--danger)' }}>
        <div className="text-sm font-bold" style={{ color: 'var(--danger)' }}>{r.label}</div>
        {r.note && <div className="text-xs mt-1" style={{ color: 'var(--text)', opacity: 0.85, lineHeight: 1.45 }}>{r.note}</div>}
        <div className="text-xs text-pf-border mt-1">click to dismiss</div>
      </div>
    )
  }

  const critColor = r.isCrit ? 'text-yellow-300' : r.isFumble ? 'text-red-400' : 'text-pf-cream'
  const label = r.isCrit ? ' ★ CRITICAL!' : r.isFumble ? ' ✕ FUMBLE' : ''

  return (
    <div className="dice-result text-pf-cream cursor-pointer" onClick={onDismiss}>
      <div className="text-xs text-pf-gold mb-1">{r.label}</div>
      <div className={`text-3xl font-bold ${critColor}`}>{r.total}{label && <span className="text-base ml-1">{label}</span>}</div>
      {r.isAttack && (
        <div className="text-xs text-pf-cream opacity-70 mt-1">
          d20: {r.rolls[0]} {fmtBonus(r.modifier)}
        </div>
      )}
      {!r.isAttack && r.rolls.length > 0 && (
        <div className="text-xs text-pf-cream opacity-70 mt-1">
          Rolls: [{r.rolls.join(', ')}]
        </div>
      )}
      <div className="text-xs text-pf-border mt-1">click to dismiss</div>
    </div>
  )
}

export function DiceOverlay() {
  const { diceResults, clearDiceResults } = useCombatStore()
  const latest = diceResults[0]
  if (!latest) return null

  return <ResultCard r={latest} onDismiss={clearDiceResults} />
}
