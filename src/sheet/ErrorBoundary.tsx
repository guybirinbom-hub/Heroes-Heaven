import React from 'react';

interface Props {
  children: React.ReactNode;
  /** Heading shown in the fallback. */
  title?: string;
  /** When any value here changes, the boundary clears its error and retries rendering. */
  resetKeys?: unknown[];
  /** Extra recovery controls; receives a `reset` that clears the caught error. */
  renderActions?: (reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

function changed(a?: unknown[], b?: unknown[]): boolean {
  if (!a || !b || a.length !== b.length) return true;
  return a.some((v, i) => !Object.is(v, b[i]));
}

/**
 * Catches render errors in its subtree so one bad character / corrupt field can't white-screen the
 * whole app. Auto-recovers when `resetKeys` change (e.g. switching character or screen), and offers
 * explicit recovery controls via `renderActions`.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Surface to the console for debugging; the UI shows a friendly fallback.
    console.error('[ErrorBoundary] render error:', error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && changed(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary" role="alert">
          <div className="error-boundary-card">
            <i className="ti ti-alert-triangle error-boundary-icon" aria-hidden="true" />
            <h2>{this.props.title ?? 'Something went wrong'}</h2>
            <p className="error-boundary-msg">{this.state.error.message || String(this.state.error)}</p>
            <div className="error-boundary-actions">
              {this.props.renderActions?.(this.reset)}
              <button className="btn" onClick={() => window.location.reload()}>
                Reload app
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
