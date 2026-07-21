import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'

// A component that throws on demand — used to trip the boundary.
function Boom({ explode }: { explode: boolean }): React.ReactElement {
  if (explode) throw new Error('kaboom')
  return <div>safe child</div>
}

describe('ErrorBoundary', () => {
  // Error boundaries log the caught error via console.error; silence it so the
  // expected throw doesn't spam the test output.
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { cleanup() })

  it('renders children when nothing throws', () => {
    render(<ErrorBoundary><div>hello world</div></ErrorBoundary>)
    expect(screen.getByText('hello world')).toBeTruthy()
  })

  it('renders the fallback (with the label) when a child throws', () => {
    render(<ErrorBoundary label="this view"><Boom explode /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/Something went wrong in this view\./)).toBeTruthy()
    // The thrown message is surfaced for the user to copy/report.
    expect(screen.getByText(/kaboom/)).toBeTruthy()
  })

  it('uses a custom fallback render when provided', () => {
    render(
      <ErrorBoundary fallback={(err) => <div>custom: {err.message}</div>}>
        <Boom explode />
      </ErrorBoundary>,
    )
    expect(screen.getByText('custom: kaboom')).toBeTruthy()
  })

  it('recovers via "Try again" once the child stops throwing', () => {
    // A wrapper whose child throws until a button outside the boundary flips it.
    function Harness() {
      const [explode, setExplode] = useState(true)
      return (
        <div>
          <button onClick={() => setExplode(false)}>fix</button>
          <ErrorBoundary><Boom explode={explode} /></ErrorBoundary>
        </div>
      )
    }
    render(<Harness />)
    // Boundary is showing its fallback.
    expect(screen.getByRole('alert')).toBeTruthy()
    // Stop the child throwing, THEN hit "Try again" to clear the error state.
    fireEvent.click(screen.getByText('fix'))
    fireEvent.click(screen.getByText('Try again'))
    expect(screen.getByText('safe child')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('auto-resets when resetKeys change', () => {
    function Harness() {
      const [k, setK] = useState(0)
      return (
        <div>
          <button onClick={() => setK(1)}>switch</button>
          <ErrorBoundary resetKeys={[k]}><Boom explode={k === 0} /></ErrorBoundary>
        </div>
      )
    }
    render(<Harness />)
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByText('switch')) // k 0→1: child stops throwing AND key changes
    expect(screen.getByText('safe child')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
