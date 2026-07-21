import { useState, useRef, useEffect, useLayoutEffect, type ReactNode, type CSSProperties, isValidElement } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: string | ReactNode
  children: ReactNode
  className?: string
  /** Inline style applied to the trigger wrapper <span> (so the wrapper can BE
   *  a styled pill/link rather than nesting one inside, which would misalign). */
  style?: CSSProperties
  /**
   * If true, don't draw the Tooltip's own bordered frame around the content —
   * the content already provides its own styling (e.g. a PopupPreview).
   */
  bare?: boolean
  /**
   * Called when the wrapper is clicked. Receives the screen coordinates of
   * the *visible popup's* top-left corner (so callers can open a permanent
   * floating window in the exact same spot). The tooltip hides itself on click.
   */
  onActivate?: (pos: { x: number; y: number }) => void
}

// Render the popup ABOVE every floating window. Tooltip popups are previews
// — they need to draw on top of whatever's underneath, including any pinned
// stat-block / spell / item windows (which start near z-index 500).
const POPUP_Z = 10000

export function Tooltip({ content, children, className = '', style, bare, onActivate }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  // Hidden while the popup hasn't measured yet — prevents a one-frame flash at
  // the wrong coordinates when the trigger is near a viewport edge.
  const [measured, setMeasured] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  // Optional max-height passed down to the popup content via CSS variable, so
  // tall popups stay on one side of the trigger and scroll internally instead
  // of covering the trigger text.
  const [maxH, setMaxH] = useState<number | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  // Position captured at mousedown — used to open the floating window at the
  // *same spot* the hover preview was occupying, even though we hide the
  // preview before the click fires.
  const capturedPos = useRef<{ x: number; y: number } | null>(null)

  const isBare = bare ?? (isValidElement(content) && typeof content !== 'string')

  // After the popup mounts, measure it and decide where to place it so the
  // whole panel is visible AND it never overlaps the trigger text. Logic:
  //   1. If the popup fits in the gap below the trigger → place below.
  //   2. Else if it fits in the gap above → place above.
  //   3. Else: pick the side with more space, place flush against the viewport
  //      edge there, and cap the popup's max-height to the available gap so
  //      it can never bleed past the trigger.
  useLayoutEffect(() => {
    if (!visible || !popupRef.current || !ref.current) {
      setMeasured(false)
      return
    }
    const popup = popupRef.current.getBoundingClientRect()
    const trig  = ref.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const PAD = 8
    const GAP = 6

    const spaceBelow = vh - trig.bottom - PAD
    const spaceAbove = trig.top - PAD

    // Pick the side with room, and ALWAYS cap the popup to that side's gap so a
    // tall popup can never bleed back over the trigger text. Place below when it
    // fits below or below simply has more room; otherwise place above.
    let top: number
    let cap: number
    if (popup.height + GAP <= spaceBelow || spaceBelow >= spaceAbove) {
      top = trig.bottom + GAP
      cap = Math.max(120, spaceBelow - GAP)
    } else {
      cap = Math.max(120, spaceAbove - GAP)
      top = trig.top - GAP - Math.min(popup.height, cap)
    }

    let left = trig.left
    if (left + popup.width > vw - PAD) left = vw - popup.width - PAD
    if (left < PAD) left = PAD

    setPos({ top, left })
    setMaxH(cap)
    setMeasured(true)
  }, [visible])

  // Hide on scroll/resize — otherwise the popup floats next to where the
  // trigger USED to be, which is jarring.
  useEffect(() => {
    if (!visible) return
    const hide = () => setVisible(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setVisible(false) }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('keydown', onKey)
    }
  }, [visible])

  if (!content && !onActivate) return <span className={className} style={style}>{children}</span>

  const show = () => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    // Initial best-effort position (useLayoutEffect will refine after mount).
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 430)) })
    setVisible(true)
  }
  const hide = () => setVisible(false)

  // Capture popup rect at mousedown — before the click handler hides the
  // popup. The click then opens a permanent window at the captured spot, so
  // the floating window starts exactly where the hover preview was.
  const handleMouseDown = () => {
    if (!onActivate) { hide(); return }
    if (popupRef.current) {
      const r = popupRef.current.getBoundingClientRect()
      capturedPos.current = { x: r.left, y: r.top }
    } else {
      capturedPos.current = { x: pos.left, y: pos.top }
    }
    hide()
  }
  const handleClick = (e: React.MouseEvent) => {
    if (!onActivate) return
    e.stopPropagation()
    const p = capturedPos.current ?? { x: pos.left, y: pos.top }
    capturedPos.current = null
    onActivate(p)
  }

  // Pass the maxH cap down to the popup contents via a CSS variable so
  // PopupPreview (and the framed string-content fallback below) can shrink
  // their own max-height accordingly. With this set the popup will always
  // stay on one side of the trigger and scroll internally if its content is
  // taller than the available gap.
  const popupWrapperStyle: React.CSSProperties = {
    position: 'fixed',
    top: pos.top,
    left: pos.left,
    zIndex: POPUP_Z,
    pointerEvents: 'none',
    // Stay invisible for the one frame between initial mount and the
    // useLayoutEffect re-measure, so the user never sees the wrong spot.
    opacity: measured ? 1 : 0,
    transition: measured ? 'opacity 60ms' : 'none',
  }
  if (maxH != null) {
    (popupWrapperStyle as Record<string, string | number>)['--tooltip-max-h'] = `${maxH}px`
  }

  const popupEl = visible && content ? (
    <div ref={popupRef} style={popupWrapperStyle}>
      {isBare ? (
        content
      ) : (
        <div
          style={{
            background: 'var(--bg-panel)',
            border: 'var(--app-bw) solid var(--border-strong)',
            color: 'var(--text)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-md)',
            fontSize: 12.5,
            padding: '10px 12px',
            lineHeight: 1.55,
            maxWidth: 360, minWidth: 180,
            maxHeight: 'var(--tooltip-max-h, 360px)',
            overflowY: 'auto',
            fontFamily: 'var(--font-ui)',
          }}
        >
          {typeof content === 'string'
            ? <p style={{ whiteSpace: 'pre-wrap' }}>{content}</p>
            : content
          }
        </div>
      )}
    </div>
  ) : null

  return (
    <>
      <span
        ref={ref}
        className={className}
        style={style}
        tabIndex={onActivate ? 0 : undefined}
        role={onActivate ? 'button' : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={onActivate ? show : undefined}
        onBlur={onActivate ? hide : undefined}
        onMouseDown={handleMouseDown}
        onClick={onActivate ? handleClick : undefined}
        onKeyDown={onActivate ? e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            const r = ref.current?.getBoundingClientRect()
            onActivate({ x: r?.left ?? pos.left, y: r?.bottom ?? pos.top })
          }
        } : undefined}
      >
        {children}
      </span>
      {/* Render in a portal so the popup escapes any ancestor stacking
          context — without this, popups whose trigger lives inside a
          floating window would be confined to that window's stacking layer
          and could block the window's own close button / drag handle. */}
      {popupEl && createPortal(popupEl, document.body)}
    </>
  )
}
