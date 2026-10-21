import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { AonLinkButton, aonHref } from './AonLink'
import { useSettingsStore } from '../store/settingsStore'
import { HostSearchProvider, type HostSearch } from '../data/hostSearchContext'

/*
 * The tracker's Archives of Nethys button (the owner, 2026-10-21: "a link to Archives of Nethys on every
 * pop up … as a toggleable setting"). Synthetic addresses only.
 *  (a) a record that carries an Archives address shows the button, on by default;
 *  (b) Settings → Display → "Show Archives of Nethys link on popups" off hides it;
 *  (c) inside Heroes Heaven the host's setting decides, whatever the tracker's own says;
 *  (d) no address, or an address that is not an Archives page, shows nothing (never a guessed link).
 * MUTATIONS: `if (!show || !href)` → `if (!href)` → (b) and (c) red; useShowAonLink's `host?.showAonLink ??`
 * dropped → (c) red; aonHref's host check dropped → (d) red.
 */

const URL_ = 'https://2e.aonprd.com/Equipment.aspx?ID=90001'
const host = (showAonLink?: boolean): HostSearch => ({ records: [], open: () => undefined, showAonLink })

afterEach(() => {
  cleanup()
  useSettingsStore.getState().setSetting('showAonLink', true)
})

describe('AonLinkButton', () => {
  it('(a) shows the page link by default', () => {
    expect(useSettingsStore.getState().showAonLink).toBe(true)
    const { container } = render(<AonLinkButton url={URL_} />)
    expect(container.querySelector('a[data-aon-link]')?.getAttribute('href')).toBe(URL_)
  })

  it('(b) the tracker setting hides it', () => {
    useSettingsStore.getState().setSetting('showAonLink', false)
    const { container } = render(<AonLinkButton url={URL_} />)
    expect(container.querySelector('a[data-aon-link]')).toBeNull()
  })

  it("(c) inside a host, the host's setting decides", () => {
    useSettingsStore.getState().setSetting('showAonLink', true)
    const off = render(<HostSearchProvider value={host(false)}><AonLinkButton url={URL_} /></HostSearchProvider>)
    expect(off.container.querySelector('a[data-aon-link]')).toBeNull()
    cleanup()
    useSettingsStore.getState().setSetting('showAonLink', false)
    const on = render(<HostSearchProvider value={host(true)}><AonLinkButton url={URL_} /></HostSearchProvider>)
    expect(on.container.querySelector('a[data-aon-link]')).toBeTruthy()
  })

  it('(d) no Archives address, no button', () => {
    expect(aonHref(undefined)).toBe('')
    expect(aonHref('https://example.com/Equipment.aspx?ID=1')).toBe('')
    expect(aonHref('/Rituals.aspx?ID=3')).toBe('https://2e.aonprd.com/Rituals.aspx?ID=3')
    const { container } = render(<AonLinkButton url="https://example.com/x" />)
    expect(container.querySelector('a[data-aon-link]')).toBeNull()
  })
})
