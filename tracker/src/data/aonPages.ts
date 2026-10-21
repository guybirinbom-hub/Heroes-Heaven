import { useEffect, useState } from 'react'
import { loadAbilitiesGlossary } from './dataStore'
import { MONSTER_PARTS_RULES } from './monsterPartsRules'

/*
 * The Archives of Nethys page of a tracker spell, condition, trait, action, skill or rule popup (the
 * owner, 2026-10-21: "a link to Archives of Nethys on every pop up a user opens"). The tracker's own
 * files for these (public/data/spells-index.json, conditions.json, traits.json, actions.json,
 * skills.json, rules.json) carry no address, so it is read off the page trees Heroes Heaven ships
 * (public/ast/<bucket>.json.gz), whose roots carry the page's own address (scripts/stamp-ast-urls.mjs) —
 * the same address the app's popups link to. Nothing is guessed from a name pattern or an id:
 *
 *  - a popup kind reads ONE bucket (a spell only ever links to a spell page), and only pages whose
 *    address is that kind's Archives page (Spells.aspx for a spell — the spells bucket also holds a few
 *    rule and feat pages under spell names, which a spell popup must never link to);
 *  - the record's name must equal the page's title exactly (letter case, curly apostrophes and runs of
 *    spaces aside), and that title must lead to ONE address in the bucket. Two pages behind one title
 *    (a Kingmaker "Influence" beside the GM Core one, two Disengage pages) give no button. Two copies of
 *    one page (an `aon-` twin) are still one address;
 *  - the bucket holds the NEWEST printing of each record (R12), so a legacy Fireball links to the
 *    Player Core page that replaced it, and a renamed legacy record (Barkskin, Magic Missile,
 *    Flat-Footed) finds no page of its name and gets no button — never a near match;
 *  - a popup whose text is not the Archives' own record gets none: an action name the creature
 *    abilities glossary (abilities.json) overrides — that text is the Monster Abilities entry, a page no
 *    shipped bucket holds — and a Monster Parts rule (this app's own conversion text).
 *
 * Measured against the shipped data on 2026-10-21 (names per kind; no button = no page or several):
 * spells 1,641 of 1,789; conditions 56 of 57; traits 554 of 562; actions 494 of 1,001 (many of the
 * rest are not action names but activation strings the scrape kept as names); skills 33 of 33; rules
 * 1,844 of 2,136 (the 50 Monster Parts rules among the rest).
 *
 * A bucket is fetched once, on the first popup of its kind while the setting is on; only the small
 * name → address map is kept. Offline or on a failed fetch the map is empty and no button shows.
 */

export type AonPageKind = 'spell' | 'condition' | 'trait' | 'action' | 'skill' | 'rule'

/** Each popup kind's page-tree bucket (public/ast/<bucket>.json.gz) and Archives page. */
export const AON_PAGE_SOURCES: Record<AonPageKind, { bucket: string; page: string }> = {
  spell: { bucket: 'spells', page: 'Spells' },
  condition: { bucket: 'conditions', page: 'Conditions' },
  trait: { bucket: 'trait', page: 'Traits' },
  action: { bucket: 'actions', page: 'Actions' },
  skill: { bucket: 'skill', page: 'Skills' },
  rule: { bucket: 'rules', page: 'Rules' },
}

export const isAonPageKind = (t: string): t is AonPageKind => Object.prototype.hasOwnProperty.call(AON_PAGE_SOURCES, t)

/** The part of a page tree this reads: its nodes' text and the root's stamped address. */
export interface AstPage { t?: string; v?: string; c?: AstPage[]; url?: string }

const textOf = (n: AstPage | undefined): string =>
  !n ? '' : n.t === 'text' ? (n.v ?? '') : (n.c ?? []).map(textOf).join('')

/** A page's title as the Archives prints it (its `title` node, less the action-cost glyph). */
export function astPageTitle(root: AstPage | undefined): string {
  const t = root?.c?.find(n => n.t === 'title')
  if (!t) return ''
  return (t.c ?? []).filter(n => n.t !== 'actions').map(textOf).join('').replace(/\s+/g, ' ').trim()
}

/** A name as the popups key it: lower case, straight apostrophes, single spaces. Nothing else. */
export const aonNameKey = (s: string): string =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()

/** title → address for every title in the bucket that leads to exactly ONE address of `page`. */
export function buildAonPageIndex(tree: Record<string, AstPage>, page: string): Map<string, string> {
  const pageRe = new RegExp(`^/${page}\\.aspx\\?`)
  const byTitle = new Map<string, Set<string>>()
  for (const root of Object.values(tree ?? {})) {
    const url = typeof root?.url === 'string' ? root.url : ''
    if (!pageRe.test(url)) continue
    const key = aonNameKey(astPageTitle(root))
    if (!key) continue
    const set = byTitle.get(key) ?? new Set<string>()
    set.add(url)
    byTitle.set(key, set)
  }
  const out = new Map<string, string>()
  for (const [key, urls] of byTitle) if (urls.size === 1) out.set(key, [...urls][0])
  return out
}

/** Fetch a bucket the way Heroes Heaven's astStore does: the shipped `.json.gz`, decompressed here
 *  unless the host already did; the raw `.json` (local dev) as the fallback; {} on any failure. */
async function fetchBucket(bucket: string): Promise<Record<string, AstPage>> {
  try {
    const r = await fetch(`/ast/${bucket}.json.gz`)
    if (r.ok) {
      const buf = new Uint8Array(await r.arrayBuffer())
      const gz = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b
      let text: string
      if (gz && typeof DecompressionStream !== 'undefined') {
        const stream = new Response(buf).body!.pipeThrough(new DecompressionStream('gzip'))
        text = await new Response(stream).text()
      } else {
        text = new TextDecoder().decode(buf)
      }
      return JSON.parse(text) as Record<string, AstPage>
    }
  } catch { /* fall through to the raw file */ }
  try {
    const r = await fetch(`/ast/${bucket}.json`)
    return r.ok ? ((await r.json()) as Record<string, AstPage>) : {}
  } catch {
    return {}
  }
}

/** Names whose popup text is not the Archives' record of that kind (see the header). */
async function notArchivesText(kind: AonPageKind): Promise<Set<string>> {
  if (kind === 'action') return new Set([...(await loadAbilitiesGlossary()).keys()].map(aonNameKey))
  if (kind === 'rule') return new Set(MONSTER_PARTS_RULES.map(r => aonNameKey(r.name)))
  return new Set()
}

const cache = new Map<AonPageKind, Map<string, string>>()
const inflight = new Map<AonPageKind, Promise<Map<string, string>>>()

/** The kind's name → address map, fetched once. */
export function loadAonPages(kind: AonPageKind): Promise<Map<string, string>> {
  const hit = cache.get(kind)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(kind)
  if (pending) return pending
  const { bucket, page } = AON_PAGE_SOURCES[kind]
  const p = Promise.all([fetchBucket(bucket), notArchivesText(kind)])
    .then(([tree, skip]) => {
      const map = buildAonPageIndex(tree, page)
      for (const k of skip) map.delete(k)
      return map
    })
    .catch(() => new Map<string, string>())
    .then(map => {
      // An empty map is a failed or offline fetch, never a real bucket: keep it out of the cache so
      // the next popup of this kind tries again instead of showing no button for the whole session.
      if (map.size) cache.set(kind, map)
      inflight.delete(kind)
      return map
    })
  inflight.set(kind, p)
  return p
}

/** The Archives address of a popup of `type` showing the record `name`, once its kind's map has
 *  loaded; undefined for any other popup type, while loading, with no single page, or when `enabled`
 *  is false (the setting off — then nothing is fetched at all). */
export function useAonPageUrl(type: string, name: string, enabled: boolean): string | undefined {
  const kind = isAonPageKind(type) ? type : null
  const key = aonNameKey(name)
  const [, bump] = useState(0)
  const loaded = kind ? cache.has(kind) : true
  useEffect(() => {
    if (!kind || !enabled || loaded) return
    let live = true
    void loadAonPages(kind).then(map => { if (live && map.has(key)) bump(n => n + 1) })
    return () => { live = false }
  }, [kind, key, enabled, loaded])
  return kind && enabled ? cache.get(kind)?.get(key) : undefined
}

/** Tests only: forget every loaded map. */
export function resetAonPagesForTests(): void {
  cache.clear()
  inflight.clear()
}
