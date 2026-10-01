import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { PartyView } from './PartyView'
import { usePartyStore, type Party } from '../store/partyStore'
import { useSettingsStore } from '../store/settingsStore'

/*
 * NO ⏱ ON A PLAYER CARD WHILE THE TURN TIMER IS OFF — the tracker's own member card.
 *
 * Heroes Heaven's campaign cards carry their own chip (src/integration/MemberTurnButton, guarded by
 * test/turn-timer-card-chip.test.tsx). This is the other door: PartyView's built-in MemberCard,
 * which the standalone tracker and HH's signed-out local table both draw. It used to show its
 * "⏱ m:ss" whenever saved averages existed, whatever the "Enable turn timer" setting said.
 *
 * Hiding is display-only: the saved average stays in the store and the chip returns when the timer
 * is turned back on. The setting is module state (it outlives localStorage.clear()), so every test
 * sets it explicitly. Names are synthetic.
 */

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function seed(): void {
  const parties: Party[] = [
    {
      id: 'party-s',
      name: 'Synth Table',
      level: 3,
      isFavorite: false,
      players: [
        { id: 'pl-a', name: 'Synth Alpha', notes: '', memberType: 'pc', turnCount: 3, turnAvgSeconds: 42 },
        { id: 'pl-b', name: 'Synth Beta', notes: '', memberType: 'pc' },
      ],
    },
  ]
  usePartyStore.setState({ parties, activePartyId: 'party-s' })
}

const chips = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].filter(b => (b.textContent ?? '').includes('⏱'))

beforeEach(() => {
  localStorage.clear()
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver
  }
  seed()
})

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ turnTimerEnabled: false })
  usePartyStore.setState({ parties: [], activePartyId: null })
})

describe('PartyView member card — the ⏱ chip follows "Enable turn timer"', () => {
  it('shows no ⏱ while the timer is off, even with saved averages', () => {
    // Without the fix (no `timerOn &&` on the chip): the "⏱ 0:42" button below is found.
    useSettingsStore.setState({ turnTimerEnabled: false })
    const { container } = render(<PartyView partyId="party-s" />)
    // The card itself is there…
    expect([...container.querySelectorAll('input')].some(i => i.value === 'Synth Alpha')).toBe(true)
    // …without its timer icon.
    expect(chips(container)).toHaveLength(0)
    expect(container.textContent ?? '').not.toContain('⏱')
    // Display-only: the saved average was not touched.
    const alpha = usePartyStore.getState().parties[0].players.find(p => p.id === 'pl-a')
    expect(alpha).toMatchObject({ turnCount: 3, turnAvgSeconds: 42 })
  })

  it('shows the saved average while the timer is on, and follows a flip', () => {
    useSettingsStore.setState({ turnTimerEnabled: true })
    const { container } = render(<PartyView partyId="party-s" />)
    // Only Alpha has saved turns; Beta's card has no chip either way (unchanged behaviour).
    expect(chips(container).map(b => b.textContent)).toEqual(['⏱ 0:42'])

    act(() => { useSettingsStore.setState({ turnTimerEnabled: false }) })
    expect(chips(container)).toHaveLength(0)

    act(() => { useSettingsStore.setState({ turnTimerEnabled: true }) })
    expect(chips(container).map(b => b.textContent)).toEqual(['⏱ 0:42'])
  })
})
