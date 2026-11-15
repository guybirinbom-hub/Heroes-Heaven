/*
 * THE TWEAK MARK (Tweaks phase 2, feature 42 "warn, never block"; plan work/tweaks-phase2-notes/plan.md C28 and
 * section 2's last row). One small "Tweak" chip on every pick a tweak names — a feat slot card, an extra-place
 * card, a Setup card, a skill-increase or boost card, a spell chip, an answer row, a kept row — driven ONLY by
 * tweaks: a character with no tweak never shows one (the zero-marks sweep, test/tweaks-p2-mark.test.tsx).
 *
 *   - live: the chip "Tweak"; tap (or hover where there is hover) opens a small popover with the book rule the
 *     pick breaks, the tweak's reason and "Show in Tweaks";
 *   - paused (the tweak's own switch): the chip "Tweak paused" plus the book's own warning beside it;
 *   - Tweaks switched off: no mark at all — the book's own warnings only (C42: a place keeps its off card).
 *
 * It never reuses the book's invalid look (`.lvl-invalid`, `data-invalid`): a pick a tweak allows is not an
 * error. The popover is plain text and one button, so it needs no PinStar (it is no description popup).
 * WP2 builds it and the taste sample shows it; WP4-WP17 put it on each surface.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { entryOn } from '../../rules/blocks/active';
import { tweaksSwitchOn } from '../../rules/blocks/stored';
import type { BlockInstance } from '../../rules/blocks/registry';
import type { BuildOverrides, CharacterOptions } from '../../rules/types';

export type TweakMarkState = 'live' | 'paused' | 'off';

/** The mark's state for one stored tweak: Tweaks switched off → 'off' (no mark), its own switch off →
 *  'paused', else 'live'. An import-stamped tweak ignores the master switch (`entryOn`), as everywhere. */
export function tweakMarkState(host: { overrides?: BuildOverrides; options?: CharacterOptions }, inst: Pick<BlockInstance, 'on' | 'broken' | 'imported'>): TweakMarkState {
  const master = tweaksSwitchOn(host);
  if (!master && !inst.imported) return 'off';
  return entryOn(inst as BlockInstance, master) ? 'live' : 'paused';
}

const canHover = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches;

export function TweakMark({
  kind,
  state,
  rule,
  reason,
  bookWarning,
  onShow,
}: {
  /** The tweak's kind (`data-tweak-mark`): what the sweep and the tests count. */
  kind: string;
  state: TweakMarkState;
  /** The book rule the pick breaks, in the picker's own words ("Requires the Elf ancestry"). */
  rule: string;
  reason?: string;
  /** Paused: the book's own warning for the pick ("Not valid for this slot"). */
  bookWarning?: string;
  /** "Show in Tweaks": opens the Tweaks page on this tweak's row. */
  onShow?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        pinned.current = false;
        setOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pinned.current = false;
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (state === 'off') return null;
  const paused = state === 'paused';
  return (
    <span
      ref={root}
      className={'tw-mark' + (paused ? ' paused' : '') + (open ? ' open' : '')}
      data-tweak-mark={kind}
      data-tweak-state={state}
      onMouseEnter={() => canHover() && setOpen(true)}
      onMouseLeave={() => canHover() && !pinned.current && setOpen(false)}
    >
      <button
        type="button"
        className="tw-mark-chip"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          // The chip sits BESIDE a card button (never inside one: invalid HTML, broken keys), but a card row may
          // still listen for clicks: the tap stops here.
          e.stopPropagation();
          pinned.current = !open || !pinned.current;
          setOpen(pinned.current);
        }}
      >
        <i className={'ti ' + (paused ? 'ti-player-pause' : 'ti-adjustments-horizontal')} aria-hidden="true" />
        {paused ? 'Tweak paused' : 'Tweak'}
      </button>
      {paused && bookWarning && <span className="tw-mark-book">{bookWarning}</span>}
      {open && (
        <span className="tw-mark-pop" id={id} role="dialog" aria-label={paused ? 'Tweak paused' : 'Tweak'} onClick={(e) => e.stopPropagation()}>
          <span className="tw-mark-pop-h">{paused ? 'Paused — the book rule applies again' : kind === 'choice.addPlace' ? 'A place the book doesn’t give' : 'Taken past a book rule'}</span>
          <span className="tw-mark-rule">{rule}</span>
          {reason && <span className="tw-mark-reason">“{reason}”</span>}
          {onShow && (
            <button
              type="button"
              className="tw-mark-show"
              onClick={() => {
                pinned.current = false;
                setOpen(false);
                onShow();
              }}
            >
              <i className="ti ti-adjustments" aria-hidden="true" /> Show in Tweaks
            </button>
          )}
        </span>
      )}
    </span>
  );
}
