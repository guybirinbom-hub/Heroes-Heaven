import type { RawCreature, RawHazard, Creature, Attack, Ability, Defenses, SpellBlock, SpellSlotEntry } from '../types/pf2e'
import { entriesToText, entriesToTagText, activitySymbol, ordinal } from './tags'
import { cleanDamageExpr } from './dice'
import { parseHazardDescription } from './parseHazardText'

let _id = 0
const uid = (p: string) => `${p}-${++_id}`

/**
 * Strip AoN template markers from language/ability strings.
 * Examples:
 *   <%UMR%79%%>telepathy<%END> 100 feet  →  telepathy 100 feet
 *   <%SPELLS%293%%><i>speak with animals</i><%END>  →  speak with animals
 *   <%TRAITS%358%%>munavris<%END>  →  munavris
 */
function cleanAonTemplate(s: string): string {
  return s
    // Replace <%TAG%ID%%>content<%END> with content (may span spaces)
    .replace(/<%[A-Z]+%\d+%%>([\s\S]*?)<%END>/g, '$1')
    // Strip leftover HTML tags like <i>, </i>
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .trim()
}

/** Defensive cleanup for ability/description strings that may have slipped
 *  through the scraper. Converts `<br />` → newline, lists → bullets, drops
 *  inline formatting (<i>, <sup>, <b>, …), and strips paired markdown italic
 *  underscores (e.g. `_gentle repose_` → `gentle repose`). */
function cleanEntryString(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/br>/gi, '\n')
    .replace(/<ul[^>]*>/gi, '\n').replace(/<\/ul>/gi, '\n')
    .replace(/<ol[^>]*>/gi, '\n').replace(/<\/ol>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ').replace(/<\/li>/gi, '')
    .replace(/<\/?(?:i|b|em|strong|sup|sub|u|span|small|big|font)[^>]*>/gi, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/_([^_\n]+?)_/g, '$1')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&(?:#39|apos);/gi, "'").replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—').replace(/&ndash;/gi, '–').replace(/&hellip;/gi, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\n{3,}/g, '\n\n')
}

// ── Split merged abilities ──────────────────────────────────────────────────
// The scraped bestiary sometimes crams several abilities into one entry's
// `trigger` (or `entries`) field, newline-separated, e.g. the Lantern King's
// "Fortune's Friend" trigger also contains Lantern King's Glow, Mocking
// Laughter, Reactive and Attack of Opportunity. We detect the "Name (trait,
// trait) body" pattern that marks a new ability and split them back apart so
// each gets its own trait tags, inline rolls, and cooldown handling.
const AB_SUBHEADER_RE = /^(Critical Success|Critical Failure|Success|Failure|Effect|Trigger|Requirements?|Frequency|Special|Range|Duration|Area|Targets?|Saving Throw|Maximum Duration|Onset|Stage \d|Cost|Prerequisites?|Heightened)\b/i
// A new merged ability looks like "Title Case Name (lowercase, trait, list) …".
// The name must be Title-Case words (+ small joiners), NOT a normal sentence —
// so "The dragon breathes (fire, cold) …" is NOT mistaken for an ability.
const AB_NAME = "(?:[A-Z][A-Za-z'’-]*)(?:\\s(?:[A-Z][A-Za-z'’-]*|of|the|and|or|with|from|to))*"
const AB_PAREN_RE = new RegExp(`^${AB_NAME}\\s*\\([a-z][^)]*\\)`)
const NAME_STOP = new Set(['the', 'a', 'an', 'he', 'his', 'she', 'her', 'it', 'its', 'they', 'their', 'them', 'when', 'whenever', 'if', 'at', 'each', 'once', 'you', 'your', 'this', 'these', 'those', 'as', 'on', 'in', 'to', 'for', 'make', 'makes', 'roll', 'after', 'before', 'while', 'upon', 'any', 'all', 'creature', 'creatures'])
const NAME_JOINER = new Set(['of', 'and', 'or', 'with', 'from', 'the', 'to', "'s", '’s'])

const AB_PAREN_CAPTURE = new RegExp(`^(${AB_NAME})\\s*\\(([a-z][^)]*)\\)\\s*([\\s\\S]*)$`)

function parseNewAbilityLine(line: string): { name: string; traits: string[]; body: string } {
  const pm = line.match(AB_PAREN_CAPTURE)
  if (pm) {
    return { name: pm[1].trim(), traits: pm[2].split(',').map(t => t.trim()).filter(Boolean), body: pm[3].trim() }
  }
  // No parens: take the leading Title-Case run as the name, stopping at a
  // sentence-starter word (The, He, When …) or a lowercase non-joiner verb.
  const words = line.split(/\s+/)
  const nameWords: string[] = []
  for (let i = 0; i < words.length && i < 6; i++) {
    const w = words[i]
    const lc = w.toLowerCase().replace(/[^a-z'’-]+$/, '')
    if (i > 0) {
      if (/^[A-Z]/.test(w)) { if (NAME_STOP.has(lc)) break }
      else if (!NAME_JOINER.has(lc)) break
    }
    nameWords.push(w)
  }
  const namePart = nameWords.join(' ')
  const name = namePart.replace(/[.:,;]+$/, '').trim()
  const body = line.slice(namePart.length).replace(/^[\s.:,;]+/, '').trim()
  return { name: name || 'Ability', traits: [], body }
}

function splitMergedAbility(ab: Ability): Ability[] {
  const fromEntries = !!(ab.entries && ab.entries.trim())
  const blob = fromEntries ? ab.entries : (ab.trigger ?? '')
  if (!blob.includes('\n')) return [ab]
  const lines = blob.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return [ab]

  let trigger = fromEntries ? ab.trigger : undefined
  let entriesLines: string[] = []
  const first = lines[0]
  if (!fromEntries) {
    // First line may pack "Trigger text Effect effect text" — split on Effect.
    const m = first.match(/\bEffect\b/)
    if (m && m.index! > 0) {
      trigger = first.slice(0, m.index).trim()
      entriesLines.push(first.slice(m.index! + 'Effect'.length).trim())
    } else {
      trigger = first
    }
  } else {
    entriesLines.push(first)
  }

  const out: Ability[] = []
  let current: Ability = { name: ab.name, activity: ab.activity, traits: ab.traits, trigger, entries: '' }
  out.push(current)
  let merged = false

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (AB_SUBHEADER_RE.test(line)) { entriesLines.push(line); continue }
    // A paren-ability always starts a new ability. Once we're in merged mode,
    // a line also starts a new ability if it BEGINS like an ability name (a
    // Title-Case word that isn't a sentence-starter like "The"/"When") — this
    // catches no-paren abilities (Reactive, Attack of Opportunity) while
    // leaving continuation prose attached.
    const firstWord = line.split(/\s+/)[0] ?? ''
    const looksLikeName = /^[A-Z]/.test(firstWord) && !NAME_STOP.has(firstWord.toLowerCase().replace(/[^a-z'’-]+$/, ''))
    if (AB_PAREN_RE.test(line) || (merged && looksLikeName)) {
      current.entries = entriesLines.join('\n').trim()
      const { name, traits, body } = parseNewAbilityLine(line)
      current = { name, activity: undefined, traits, trigger: undefined, entries: '' }
      out.push(current)
      entriesLines = body ? [body] : []
      merged = true
    } else {
      entriesLines.push(line)
    }
  }
  current.entries = entriesLines.join('\n').trim()
  return out.length > 1 ? out : [ab]
}

interface RawSpellEntry { name: string; amount?: string | number; atWill?: boolean }
function toSpellList(raw?: RawSpellEntry[]): Array<{ name: string; amount?: string; uses?: number; atWill?: boolean }> {
  if (!raw?.length) return []
  return raw.map(s => {
    const usesNum = typeof s.amount === 'number'
      ? s.amount
      : (typeof s.amount === 'string' && /^\d+$/.test(s.amount) ? parseInt(s.amount) : undefined)
    return {
      name: s.name,
      amount: s.amount != null ? String(s.amount) : undefined,
      uses: usesNum,
      atWill: s.atWill || undefined,
    }
  })
}

function getSaveStd(sv?: { std?: number; [k: string]: number | undefined }): number {
  if (!sv) return 0
  return sv.std ?? (Object.values(sv).find(v => v !== undefined) ?? 0)
}
function getACStd(ac?: { std?: number; [k: string]: number | undefined }): number {
  if (!ac) return 0
  return ac.std ?? (Object.values(ac).find(v => v !== undefined) ?? 0)
}

export function parseCreature(raw: RawCreature, _sourceFile = ''): Creature {
  const def = raw.defenses ?? {}
  const attacks: Attack[] = (raw.attacks ?? []).map(a => ({
    range: a.range, name: a.name, attack: a.attack ?? 0,
    traits: a.traits ?? [], damage: cleanDamageExpr(a.damage ?? ''),
    types: a.types ?? [], effects: a.effects ?? [],
    isAgile: (a.traits ?? []).some(t => t.toLowerCase().includes('agile')),
  }))

  const allAbilities: Ability[] = []
  for (const slot of ['top','mid','bot'] as const) {
    for (const ab of raw.abilities?.[slot] ?? []) {
      const built: Ability = {
        name: ab.name, activity: activitySymbol(ab.activity),
        traits: ab.traits ?? [], trigger: ab.trigger ? cleanEntryString(ab.trigger) : ab.trigger,
        entries: cleanEntryString(entriesToTagText(ab.entries ?? [])),
      }
      allAbilities.push(...splitMergedAbility(built))
    }
  }

  const spellcasting: SpellBlock[] = (raw.spellcasting ?? []).map(sc => {
    const slots: SpellSlotEntry[] = []
    const entry = sc.entry as Record<string, unknown> | undefined

    if (entry) {
      // 1. Constant spells: nested { "level": { spells: [] } }
      const constantBlock = entry['constant'] as Record<string, { spells?: RawSpellEntry[] }> | undefined
      if (constantBlock) {
        for (const [lvlKey, lvlData] of Object.entries(constantBlock)) {
          const lvl = parseInt(lvlKey) || 0
          const spells = toSpellList(lvlData.spells)
          if (spells.length) slots.push({ label: `Constant (${ordinal(lvl)})`, level: lvl, spells, isConstant: true })
        }
      }

      // 2. Numeric slot keys
      for (const [key, val] of Object.entries(entry)) {
        if (key === 'constant') continue
        const slotNum = parseInt(key)
        if (isNaN(slotNum)) continue
        const data = val as { level?: number; spells?: RawSpellEntry[]; slots?: number }
        const spells = toSpellList(data.spells)
        if (!spells.length) continue

        if (slotNum === 0) {
          // Cantrips (heightened to data.level) — always at-will, never tracked.
          slots.push({ label: 'Cantrips', level: data.level ?? 0, spells, isCantrip: true })
        } else {
          const lvl = data.level ?? slotNum
          // `slots` (spontaneous rank pool) is carried through when present.
          slots.push({ label: `Level ${slotNum}`, level: lvl, spells, slots: data.slots })
        }
      }

      // Sort: cantrips first, constants last, rest by slot number ascending
      slots.sort((a, b) => {
        if (a.label === 'Cantrips') return -1
        if (b.label === 'Cantrips') return 1
        if (a.label.startsWith('Constant')) return 1
        if (b.label.startsWith('Constant')) return -1
        return a.level - b.level
      })
    }

    // Build fallback string
    const lines = slots.map(s => {
      const names = s.spells.map(sp => sp.name + (sp.amount ? ` (${sp.amount})` : '')).join(', ')
      return `${s.label}: ${names}`
    })

    return {
      name: sc.name ?? `${sc.type} ${sc.tradition ?? ''}`.trim(),
      type: sc.type, tradition: sc.tradition, DC: sc.DC, attack: sc.attack,
      focusPoints: (sc as { focusPoints?: number }).focusPoints,
      spells: lines.join('; '),
      spellsByLevel: slots,
    }
  })

  const skills: Record<string, number> = {}
  for (const [key, val] of Object.entries(raw.skills ?? {})) {
    const v = typeof val === 'object' ? (val as Record<string,unknown>).std as number : val as number
    skills[key] = v ?? 0
  }

  const defenses: Defenses = {
    ac: getACStd(def.ac), fort: getSaveStd(def.savingThrows?.fort),
    ref: getSaveStd(def.savingThrows?.ref), will: getSaveStd(def.savingThrows?.will),
    hp: def.hp?.[0]?.hp ?? 0,
    immunities: def.immunities ?? [],
    resistances: (def.resistances ?? []).map(r => ({ amount:r.amount, name:r.name, note:r.note })),
    weaknesses: (def.weaknesses ?? []).map(w => ({ amount:w.amount, name:w.name, note:w.note })),
  }

  // AoN-sourced creatures embed { _aon: { id, url, markdown } } on the raw object
  const aon = (raw as unknown as Record<string, unknown>)['_aon'] as
    { id?: string; url?: string; markdown?: string } | undefined

  const src = raw.source ?? ''
  const pg  = (raw as unknown as { page?: number | string }).page
  const sourceStr = src + (pg != null && pg !== '' ? ` p.${pg}` : '')

  return {
    id: uid(raw.name.toLowerCase().replace(/\s+/g,'-')),
    name: raw.name, source: sourceStr.trim(),
    level: raw.level ?? 0, traits: raw.traits ?? [],
    perception: raw.perception?.std ?? 0,
    senses: (raw.senses ?? []).map(s => s.name + (s.range ? ` ${s.range}ft`:'')),
    languages: (raw.languages?.languages ?? []).map(cleanAonTemplate), skills,
    str: raw.abilityMods?.str??0, dex: raw.abilityMods?.dex??0,
    con: raw.abilityMods?.con??0, int: raw.abilityMods?.int??0,
    wis: raw.abilityMods?.wis??0, cha: raw.abilityMods?.cha??0,
    items: raw.items ?? [], speed: raw.speed ?? {},
    attacks, spellcasting, rituals: raw.rituals, abilities: allAbilities, defenses,
    isHazard: false,
    flavor: raw.flavor || undefined,
    family: raw.family || undefined,
    aonUrl:      aon?.url ? (aon.url.startsWith('http') ? aon.url : `https://2e.aonprd.com${aon.url}`) : undefined,
    rawMarkdown: aon?.markdown || undefined,
    raw,
  }
}

export function parseHazard(raw: RawHazard): Creature {
  const def = raw.defenses ?? {}

  // AoN's hazard scrape consolidates the whole stat block into a single
  // `description[0]` string and leaves `disable` / `routine` / `reset`
  // empty. Re-parse that blob into proper sections so the renderer can show
  // a real hazard layout (flavor → stealth → disable → defenses → abilities
  // → routine → reset).
  const rawDescription = entriesToText(raw.description ?? [])
  const parsed = parseHazardDescription(rawDescription, raw.name ?? '')

  // Merge AoN's actions / abilities arrays (often empty) with the abilities
  // we just dug out of the prose.
  const aonActions: Ability[] = [
    ...(raw.actions ?? []).flatMap(a => splitMergedAbility({
      name: a.name + activitySymbol(a.activity),
      activity: activitySymbol(a.activity),
      traits: a.traits ?? [], trigger: a.trigger ? cleanEntryString(a.trigger) : a.trigger,
      entries: cleanEntryString(entriesToTagText(a.entries ?? [])),
    })),
    ...(raw.abilities?.mid ?? []).flatMap(a => splitMergedAbility({
      name: a.name, activity: activitySymbol(a.activity),
      traits: a.traits ?? [], trigger: a.trigger ? cleanEntryString(a.trigger) : a.trigger,
      entries: cleanEntryString(entriesToTagText(a.entries ?? [])),
    })),
  ]
  // De-dupe: keep AoN's structured entries when an ability of the same name
  // exists in both lists, since they're usually richer.
  const seenAbilities = new Set(aonActions.map(a => a.name.toLowerCase()))
  const mergedAbilities = [
    ...aonActions,
    ...parsed.abilities.filter(a => !seenAbilities.has(a.name.toLowerCase())),
  ]

  // raw.defenses.hp is stored as `[{ hp: N, abilities?: [...] }]` (multiple
  // parts per hazard). Use the first part's HP — single-part hazards always
  // have exactly one element, multi-part ones get the primary structure.
  const hpRaw = def.hp as unknown
  const hpVal = Array.isArray(hpRaw) ? (hpRaw[0]?.hp ?? 0)
              : (hpRaw as { std?: number })?.std ?? 0

  const defenses: Defenses = {
    ac: getACStd(def.ac), fort: getSaveStd(def.savingThrows?.fort),
    ref: getSaveStd(def.savingThrows?.ref), will: getSaveStd(def.savingThrows?.will),
    hp: hpVal,
    hardness: def.hardness?.std,
    // BT may live on raw.defenses.bt OR be embedded in the prose ("HP 12 (BT 6)").
    bt: def.bt?.std ?? parsed.bt,
    immunities: def.immunities ?? [],
    resistances: (def.resistances ?? []).map(r => ({ amount: r.amount, name: r.name, note: r.note })),
    weaknesses: (def.weaknesses ?? []).map(w => ({ amount: w.amount, name: w.name, note: w.note })),
  }

  // Stealth display: prefer the structured field if present, otherwise the
  // string we pulled from the prose ("DC 18 (trained)" / etc).
  const stealthFromRaw = raw.stealth && (raw.stealth.bonus !== undefined || raw.stealth.dc !== undefined)
    ? ((raw.stealth.dc !== undefined ? `DC ${raw.stealth.dc}` : `+${raw.stealth.bonus}`)
        + (raw.stealth.minProf ? ` (${raw.stealth.minProf})` : ''))
    : ''
  const stealthDisplay = parsed.stealth || stealthFromRaw || '—'

  const aonH = (raw as unknown as Record<string, unknown>)['_aon'] as
    { id?: string; url?: string; markdown?: string } | undefined

  const srcH  = raw.source ?? ''
  const pgH   = (raw as unknown as { page?: number | string }).page
  const srcStrH = srcH + (pgH != null && pgH !== '' ? ` p.${pgH}` : '')

  return {
    id: uid(raw.name.toLowerCase().replace(/\s+/g,'-')+'-haz'),
    name: raw.name, source: srcStrH.trim(),
    level: raw.level ?? 0, traits: raw.traits ?? [],
    perception: 0, senses: [], languages: [], skills: {},
    str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0,
    items: [], speed: {},
    attacks: parsed.attacks,
    spellcasting: [],
    abilities: mergedAbilities,
    defenses, isHazard: true,
    hazardData: {
      stealth:     stealthDisplay,
      description: parsed.flavor || rawDescription,
      disable:     parsed.disable || entriesToText(raw.disable?.entries ?? []),
      routine:     parsed.routine || entriesToText(raw.routine ?? []),
      reset:       parsed.reset || entriesToText(raw.reset ?? []),
      // The scraper rarely sets raw.complex — fall back to the flag parsed
      // out of the "Complexity Complex/Simple" prose header.
      complex:     raw.complex || parsed.complex || false,
    },
    aonUrl:      aonH?.url ? (aonH.url.startsWith('http') ? aonH.url : `https://2e.aonprd.com${aonH.url}`) : undefined,
    rawMarkdown: aonH?.markdown || undefined,
    raw,
  }
}
