import { useSettingsStore } from '../store/settingsStore'
import { useHostSearch } from '../data/hostSearchContext'

/*
 * The Archives of Nethys button on a tracker popup (the owner, 2026-10-21: "a link to Archives of Nethys
 * on every pop up a user opens … as a toggleable setting"). Heroes Heaven's popups have their own
 * (src/sheet/AonLink.tsx); this is the tracker's, for the records that carry their page's address in
 * the tracker's own data — an item (equipment-index.json `url`), a ritual (rituals.json `url`), a
 * bestiary creature or hazard (parseCreature's `aonUrl`). A spell, condition, trait, action, skill or
 * rule takes the one page of exactly its name from Heroes Heaven's page trees (data/aonPages.ts); one
 * with no such page gets no button rather than a guessed one.
 *
 * Settings → Display → "Show Archives of Nethys link on popups" (on by default). Inside Heroes Heaven
 * the host's own setting decides (HostSearch.showAonLink) and the host opens the page (openExternal).
 */

const AON_HOST = 'https://2e.aonprd.com'

/** The Archives address a record carries, as a full link — '' for anything that is not an Archives page
 *  (no address, another site, a bare id). A relative "/Equipment.aspx?ID=1" is completed. */
export function aonHref(url: unknown): string {
  const u = typeof url === 'string' ? url.trim() : ''
  if (/^\/\w+\.aspx/.test(u)) return AON_HOST + u
  return /^https:\/\/2e\.aonprd\.com\/\w+\.aspx/.test(u) ? u : ''
}

/** Whether the tracker's popups draw the button: the host's setting inside Heroes Heaven, else the
 *  tracker's own. */
export function useShowAonLink(): boolean {
  const host = useHostSearch()
  const own = useSettingsStore(s => s.showAonLink)
  return host?.showAonLink ?? own !== false
}

export function AonLinkButton({ url }: { url?: string }) {
  const show = useShowAonLink()
  const host = useHostSearch()
  const href = aonHref(url)
  if (!show || !href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-aon-link=""
      className="ico-btn"
      title="Open this page on Archives of Nethys"
      aria-label="Open on Archives of Nethys"
      // A press here must not start the header's window drag, nor open what contains it.
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); host?.openExternal?.(e, href) }}
      style={{ width: 24, height: 24, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', flexShrink: 0 }}
    >↗</a>
  )
}
