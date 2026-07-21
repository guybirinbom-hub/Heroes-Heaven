import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Human label for the region this boundary guards, e.g. "this view".
   *  Used in the fallback copy: "Something went wrong in {label}." */
  label?: string
  /** When any value in this array changes, a boundary that is currently showing
   *  its fallback resets and tries to render its children again. Pass things
   *  like the active view / selected id so switching away from a broken pane
   *  auto-recovers without a manual "Try again". */
  resetKeys?: unknown[]
  /** Optional custom fallback. Receives the caught error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
  componentStack: string
}

/**
 * Catches render-time errors in its subtree so one bad component — a malformed
 * pasted stat block, an unexpected data shape — degrades to a recoverable panel
 * instead of white-screening the whole app. Error boundaries MUST be class
 * components; there is no hook equivalent.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console so the Electron main process (which logs renderer
    // output) and DevTools both capture it for diagnosis.
    console.error('ErrorBoundary caught:', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  componentDidUpdate(prev: Props) {
    if (!this.state.error) return
    const a = prev.resetKeys ?? []
    const b = this.props.resetKeys ?? []
    if (a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))) {
      this.reset()
    }
  }

  reset = () => this.setState({ error: null, componentStack: '' })

  copyError = () => {
    const { error, componentStack } = this.state
    const text = `${error?.name}: ${error?.message}\n\n${error?.stack ?? ''}\n\nComponent stack:${componentStack}`
    void navigator.clipboard?.writeText(text).catch(() => {/* clipboard blocked — ignore */})
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)

    const where = this.props.label ?? 'this part of the app'
    return (
      <div
        role="alert"
        style={{
          flex: 1, minHeight: 0, overflow: 'auto',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 14, padding: 28, textAlign: 'center',
          background: 'var(--bg-panel)', color: 'var(--text)',
          fontFamily: 'var(--font-ui)',
        }}
      >
        <div style={{ fontSize: 40, opacity: 0.2 }}>⚠</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19, color: 'var(--danger)' }}>
          Something went wrong in {where}.
        </div>
        <div style={{ maxWidth: 460, fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)' }}>
          The rest of the app is still running — your combat, parties and saved data are untouched.
          Try again, or copy the error if you want to report it.
        </div>
        <code style={{
          maxWidth: 520, maxHeight: 120, overflow: 'auto',
          fontFamily: 'var(--font-mono)', fontSize: 11.5,
          background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)', padding: '8px 10px',
          color: 'var(--text-muted)', whiteSpace: 'pre-wrap', textAlign: 'left',
        }}>
          {error.name}: {error.message}
        </code>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={this.reset}>Try again</button>
          <button className="btn btn-secondary" onClick={this.copyError}>Copy error</button>
          <button className="btn btn-secondary" onClick={() => window.location.reload()}>Reload app</button>
        </div>
        {componentStack && (
          <details style={{ maxWidth: 520, width: '100%', textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-faded)' }}>Component stack</summary>
            <pre style={{
              marginTop: 6, maxHeight: 160, overflow: 'auto',
              fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.5,
              color: 'var(--text-faded)', whiteSpace: 'pre-wrap',
            }}>{componentStack.trim()}</pre>
          </details>
        )}
      </div>
    )
  }
}
