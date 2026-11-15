/*
 * THE ONE CONFIRM OF A PICKER-ROW TWEAK BUTTON (Tweaks phase 2, plan C21). "Take anyway", "Allow here" and "Take
 * again" sit in a picker row beside the normal picks, where a mis-tap is easy, so each asks first — through the
 * app's own dialog (`confirmDialog`; never a native confirm). The wording is the feat picker's existing "Take X
 * anyway?" plus the undo hint the Builder already words per device (Builder.tsx `tweakUndoHint`, handed in).
 *
 * A pick that breaks two rules is two tweaks written in ONE write after ONE confirm (C22): `rules` lists each
 * rule's words. Actions chosen from an explicit tweak menu (Add a place, Remove this place, Something not on the
 * list…, Edit this list) do not confirm. `confirmDialog` has no input field, so the reason is typed on the
 * Tweaks page row afterwards.
 */
import { confirmDialog } from '../../sheet/confirm';

export type TweakAction = 'take' | 'allow' | 'again';

const ACTION: Record<TweakAction, { title: (name: string) => string; label: string }> = {
  take: { title: (n) => `Take ${n} anyway?`, label: 'Take anyway' },
  allow: { title: (n) => `Allow ${n} here?`, label: 'Allow here' },
  again: { title: (n) => `Take ${n} again?`, label: 'Take again' },
};

export interface ConfirmTweakOpts {
  name: string;
  rules: string | readonly string[];
  action?: TweakAction;
  undoHint?: string;
  /** The note's first sentence when the write is not one tweak per rule (e.g. "This records 1 tweak"). */
  records?: string;
}

/** The dialog's words (exported for the tests and the sample). */
export function confirmTweakWords({ name, rules, action = 'take', undoHint, records }: ConfirmTweakOpts) {
  const list = (Array.isArray(rules) ? rules : [rules]).filter(Boolean) as string[];
  // `records`: what this write records when it is not one tweak per rule (WP8 round 4, B1: "Take again" records ONE
  // tweak, or raises the count of the one there is), said as one tweak.
  const n = records ? 1 : Math.max(1, list.length);
  const record = records ?? (n === 1 ? 'This records a tweak for this pick only' : `This records ${n} tweaks for this pick, one per rule`);
  return {
    title: ACTION[action].title(name),
    rules: list,
    note: `${record}; ${n === 1 ? 'it is' : 'they are'} listed on the Tweaks page.${undoHint ? ` ${undoHint}` : ''}`,
    confirmLabel: ACTION[action].label,
  };
}

/** Ask before a picker-row tweak button writes; resolves true to go ahead. Each rule is its own line (the dialog
 *  body does not keep line breaks), and the button is red like the feat picker's own "Take X anyway?". */
export function confirmTweak(opts: ConfirmTweakOpts): Promise<boolean> {
  const w = confirmTweakWords(opts);
  return confirmDialog({
    title: w.title,
    message: (
      <div className="tw-confirm">
        <ul className="tw-confirm-rules" style={{ margin: '0 0 8px', paddingLeft: 20 }}>
          {w.rules.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        <p style={{ margin: 0 }}>{w.note}</p>
      </div>
    ),
    confirmLabel: w.confirmLabel,
    cancelLabel: 'Cancel',
    danger: true,
  });
}
