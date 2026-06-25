import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useEscapeClose } from './useEscapeClose';

export interface ConfirmOptions {
  /** Short question shown in the header, e.g. "Delete Kyra?". */
  title: string;
  /** Optional supporting line(s) below the title, e.g. "This can't be undone." */
  message?: ReactNode;
  /** Label for the affirmative button. Default "Confirm". */
  confirmLabel?: string;
  /** Label for the dismissive button. Default "Cancel". */
  cancelLabel?: string;
  /** Style the affirmative button as destructive (red). Use for deletes/wipes. */
  danger?: boolean;
}

function ConfirmDialog({ opts, onResolve }: { opts: ConfirmOptions; onResolve: (v: boolean) => void }) {
  // Escape / click-outside / the X all cancel.
  useEscapeClose(() => onResolve(false));
  const { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger } = opts;
  return (
    <div className="picker-overlay" onClick={() => onResolve(false)}>
      <div
        className="picker confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-head">
          <span className="info-title">{title}</span>
          <button className="picker-close" onClick={() => onResolve(false)} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        {message != null && <div className="confirm-body">{message}</div>}
        <div className="confirm-actions">
          <button className="btn-ghost" onClick={() => onResolve(false)}>
            {cancelLabel}
          </button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            ref={(b) => b?.focus()}
            onClick={() => onResolve(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * App-styled replacement for the browser's native `confirm()`. Mounts a themed modal in a detached
 * React root on <body> (so it works from anywhere, including outside the app tree / the error
 * boundary) and resolves to `true` (confirmed) or `false` (cancelled / dismissed). Usage:
 *   if (await confirmDialog({ title: 'Delete page?', confirmLabel: 'Delete', danger: true })) { ... }
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
      // Defer teardown so React isn't unmounting from inside its own event handler.
      setTimeout(() => {
        root.unmount();
        container.remove();
      }, 0);
    };
    root.render(<ConfirmDialog opts={opts} onResolve={finish} />);
  });
}
