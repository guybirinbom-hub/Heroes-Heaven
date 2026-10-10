import { createContext, useContext, type CSSProperties } from 'react'

/*
 * HH → tracker bridge for the tracker's OWN LOOK on what it draws on <body> (null default, like the
 * other host contexts).
 *
 * Inside Heroes Heaven the GM can give the tracker a look of its own ("Customize tracker appearance").
 * The host paints it as inline `--app-*` variables on the tracker's root element — and a surface the
 * tracker portals to <body> (the initiative row's right-click menu, every hover preview) sits OUTSIDE
 * that element, so it resolved the variables from <html>: the app's look, on a tracker popup. The
 * owner, 2026-10-01: "if i open a pop up in the initiative tracker it needs to have the same colors as
 * the initiative tracker".
 *
 * The host provides the same variables here, and BodyPortal (../components/BodyPortal.tsx) — the ONE
 * way the tracker draws on <body> — puts them on its root beside `.tracker-root`, whose `:where()`
 * rules then re-derive the tracker's colours, text colour and font from them. With no provider
 * (standalone, or HH's Settings page) this is null and nothing changes: the popup inherits the
 * document's own variables, as it always has. `null` from the host means the same thing — the GM has
 * not customised the tracker, so the tracker IS the app's look.
 *
 * The host must hand over a STABLE object (memoised on the appearance state): every Tooltip and menu
 * reads this, and a fresh object per host render would re-render all of them each time.
 */
const HostThemeContext = createContext<CSSProperties | null>(null)
export const HostThemeProvider = HostThemeContext.Provider
export function useHostThemeVars(): CSSProperties | null {
  return useContext(HostThemeContext)
}
