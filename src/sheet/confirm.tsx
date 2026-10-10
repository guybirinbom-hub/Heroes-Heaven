import type { CSSProperties, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useEscapeClose } from './useEscapeClose';

/**
 * Optional inline style for a dialog's overlay — for a caller whose surface wears a look of its own.
 *
 * The dialog is a detached root on <body>, so no context of the caller's reaches it, and by default it
 * wears the app's look at the overlay's own CSS z-index. The campaign tracker passes its tracker-only
 * appearance here (its `--app-*` variables plus the four text properties <body> sets, which an HH
 * element only re-resolves when they are re-declared — see `hhSurfaceTheme` in
 * src/integration/trackerAppearance.ts) and a z-index above its floating windows, which otherwise
 * paint over a confirm. Omitted → exactly as before.
 */
export type DialogStyle = CSSProperties;

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
  /** The overlay's inline style — see {@link DialogStyle}. */
  style?: DialogStyle;
}

function ConfirmDialog({ opts, onResolve }: { opts: ConfirmOptions; onResolve: (v: boolean) => void }) {
  // Escape / click-outside / the X all cancel.
  useEscapeClose(() => onResolve(false));
  const { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, style } = opts;
  return (
    // confirm-overlay: lifts the dialog above every other layer (dice drawer, ref-search) — a
    // confirm is always the topmost interaction.
    <div className="picker-overlay confirm-overlay" style={style} onClick={() => onResolve(false)}>
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

export interface ChooseButton {
  /** The value resolved when this button is clicked. */
  value: string;
  /** ReactNode, not string: a choice may carry the same icon its old inline control had. */
  label: ReactNode;
  /** Render as the primary (filled) button; first such by default. */
  primary?: boolean;
  /** Render as destructive (red). */
  danger?: boolean;
}
export interface ChooseOptions {
  title: string;
  message?: ReactNode;
  buttons: ChooseButton[];
  /** The overlay's inline style — see {@link DialogStyle}. */
  style?: DialogStyle;
}

function ChooseDialog({ opts, onResolve }: { opts: ChooseOptions; onResolve: (v: string | null) => void }) {
  // Escape / click-outside / the X all dismiss (resolve null).
  useEscapeClose(() => onResolve(null));
  const { title, message, buttons, style } = opts;
  return (
    <div className="picker-overlay confirm-overlay" style={style} onClick={() => onResolve(null)}>
      <div className="picker confirm-modal" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="info-title">{title}</span>
          <button className="picker-close" onClick={() => onResolve(null)} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        {message != null && <div className="confirm-body">{message}</div>}
        <div className="confirm-actions">
          {buttons.map((b) => (
            <button
              key={b.value}
              className={b.danger ? 'btn-danger' : b.primary ? 'btn-primary' : 'btn-ghost'}
              onClick={() => onResolve(b.value)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Like {@link confirmDialog} but for an N-way choice. Resolves the clicked button's `value`, or
 * `null` if dismissed (Escape / click-outside / X). Usage:
 *   const c = await chooseDialog({ title: '…', buttons: [{value:'a',label:'A'},{value:'b',label:'B'}] });
 */
export function chooseDialog(opts: ChooseOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let settled = false;
    const finish = (v: string | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
      setTimeout(() => {
        root.unmount();
        container.remove();
      }, 0);
    };
    root.render(<ChooseDialog opts={opts} onResolve={finish} />);
  });
}
