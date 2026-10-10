import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useHostThemeVars } from '../data/hostThemeContext'

/*
 * THE ONE WAY the tracker draws on <body>. Every surface that has to escape its container (a defeated
 * row's opacity and grayscale filter, a floating window's stacking layer) comes through here, and gets
 * the two things such a surface has needed and kept losing:
 *
 *  - `.tracker-root`, LOAD-BEARING: the tracker's colours (`--bg-panel`, `--border-strong`, …) are CSS
 *    variables the Heroes Heaven embed defines only under `.tracker-root`, and its scoped stylesheet only
 *    reaches inside it. Without the class a portalled menu or preview resolves them to nothing and draws
 *    transparent (the "half-translucent" menu). The host's Escape handling also finds an open tracker
 *    popup as `body > .tracker-root:not(.campaign-tracker)` — so the root stays a direct child of
 *    <body>, and never carries `campaign-tracker`.
 *  - the host's tracker look (../data/hostThemeContext.tsx), as inline variables on that same root: the
 *    tracker's `:where(.tracker-root)` rules derive its palette, text colour and font from them on the
 *    element itself, so a popup wears the tracker's look rather than the app's. None standalone.
 *
 * test: BodyPortal.test.tsx refuses a createPortal call anywhere else under tracker/src (and a second
 * one here), so a new body surface cannot quietly skip either.
 */
type Props = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style'> & {
  style?: CSSProperties
  children?: ReactNode
}

export const BodyPortal = forwardRef<HTMLDivElement, Props>(function BodyPortal({ style, children, ...rest }, ref) {
  const vars = useHostThemeVars()
  return createPortal(
    // The host's variables first, the surface's own placement and paint after: the surface's style only
    // ever READS them (var(--bg-panel) …), so nothing it sets can be shadowed by the theme.
    <div ref={ref} {...rest} className="tracker-root" style={vars ? { ...vars, ...style } : style}>
      {children}
    </div>,
    document.body,
  )
})
