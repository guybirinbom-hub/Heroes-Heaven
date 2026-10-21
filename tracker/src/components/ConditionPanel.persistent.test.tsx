import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConditionPanel } from './ConditionPanel'
import { useCombatStore } from '../store/combatStore'

/*
 * Owner's ruling 2026-10-21, the condition picker (the tracker's "+ Condition", the GM tracker in a
 * campaign draws the same one): "the default for persistent damage needs to be at the end of the turn
 * of the creature that has the condition, not the one who placed it ... and make the default until
 * removed instead of one round."
 *
 * The picker used to start every condition at 1 round, counted on the turn of whoever was acting.
 * Persistent damage now starts "until removed", and if the GM gives it rounds anyway, its Source starts
 * on the bearer's own turn. Both stay the GM's to change before Apply. Every combatant is synthetic.
 */

const st = () => useCombatStore.getState()
const idOf = (name: string) => st().combatants.find(c => c.name === name)!.id
const rowOf = (name: string) => st().combatants.find(c => c.name === name)!

beforeEach(() => {
  localStorage.clear()
  useCombatStore.setState({
    combatants: [], activeIndex: 0, round: 1, inCombat: false, selectedId: null,
    turns: [], canUndo: false, canRedo: false, savedSignature: null,
  } as never)
  st().addCombatant(null, { name: 'Archer', initiative: 20, maxHP: 30 })
  st().addCombatant(null, { name: 'Brute', initiative: 10, maxHP: 30 })
  st().startCombat()                       // the Archer is acting
})
afterEach(() => {
  cleanup()
  for (const n of [...document.body.children]) n.remove()
  localStorage.clear()
})

/** The picker opened on the Brute's row while it is the Archer's turn. */
function openOnBrute() {
  const anchor = document.createElement('div')
  document.body.appendChild(anchor)
  render(<ConditionPanel combatant={rowOf('Brute')} anchorEl={anchor} onClose={() => {}} />)
}
const untilRemoved = () => screen.getByLabelText('until removed') as HTMLInputElement
const sourceBox = () => screen.queryByTitle(/Whose turn the duration counts down/) as HTMLSelectElement | null
function typeDamage(amount: string, type: string) {
  fireEvent.change(screen.getByPlaceholderText('2d6'), { target: { value: amount } })
  fireEvent.change(screen.getByPlaceholderText('type — fire, bleed, acid…'), { target: { value: type } })
}
const apply = () => fireEvent.click(screen.getByText('Apply Condition'))
const pdOnBrute = () => rowOf('Brute').conditions.find(c => c.name === 'persistent damage')

describe('the condition picker: persistent damage defaults', () => {
  it('starts "until removed" with no source, and applies that way', () => {
    // MUTATION (conditionEffects: drop `pickDefaults:{ untilRemoved:true, ownTurn:true }` from
    //   'persistent damage'): FAILS — "the box starts ticked: expected false to be true".
    openOnBrute()
    fireEvent.click(screen.getByText('Persistent Damage'))
    expect(untilRemoved().checked, 'the box starts ticked').toBe(true)
    expect(sourceBox(), 'nothing to count down, so no Source').toBeNull()
    typeDamage('1d6', 'fire')
    apply()
    expect(pdOnBrute()).toMatchObject({ pdAmount: '1d6', pdType: 'fire', isPermanent: true, duration: undefined, source: undefined })
  })

  it('unticked, its rounds start on the bearer’s own turn — and a Source the GM picks is kept', () => {
    // MUTATION (ConditionPanel.handleSelect: drop `setSource(d.source)`): FAILS — "the Source starts
    //   on the Brute’s own turn: expected 'cmb-…' to be ''" (the Archer, who was acting).
    openOnBrute()
    fireEvent.click(screen.getByText('Persistent Damage'))
    fireEvent.click(untilRemoved())
    expect(untilRemoved().checked).toBe(false)
    expect(sourceBox()!.value, 'the Source starts on the Brute’s own turn').toBe('')
    typeDamage('2d4', 'bleed')
    apply()
    expect(pdOnBrute()).toMatchObject({ isPermanent: false, duration: 1, source: undefined })
  })

  it('the GM can still put it on the placer’s clock', () => {
    openOnBrute()
    fireEvent.click(screen.getByText('Persistent Damage'))
    fireEvent.click(untilRemoved())
    fireEvent.change(sourceBox()!, { target: { value: idOf('Archer') } })
    typeDamage('1d6', 'acid')
    apply()
    expect(pdOnBrute()).toMatchObject({ isPermanent: false, duration: 1, source: idOf('Archer') })
  })

  it('every other condition keeps the old start — and leaving persistent damage does not carry "until removed" over', () => {
    // MUTATION (ConditionPanel.handleSelect: drop `setIsPermanent(d.isPermanent)`): FAILS — the PD leg
    //   above ("the box starts ticked") and here "Slowed is not left ticked: expected true to be false".
    openOnBrute()
    fireEvent.click(screen.getByText('Persistent Damage'))
    expect(untilRemoved().checked).toBe(true)
    fireEvent.click(screen.getByText('Slowed'))
    expect(untilRemoved().checked, 'Slowed is not left ticked').toBe(false)
    expect(sourceBox()!.value, 'Slowed still ticks on the acting creature').toBe(idOf('Archer'))
    apply()
    expect(rowOf('Brute').conditions.find(c => c.name === 'slowed')).toMatchObject({ isPermanent: false, duration: 1, source: idOf('Archer') })
  })
})
