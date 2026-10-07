import type { RawCreature, RawHazard, RawAttack, Creature, Attack, Ability, Defenses, SpellBlock, SpellSlotEntry } from '../types/pf2e'
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
  // Every split part keeps the page section of the entry it came out of.
  const slot = ab.slot ? { slot: ab.slot } : {}
  let current: Ability = { name: ab.name, activity: ab.activity, traits: ab.traits, trigger, entries: '', ...slot }
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
      current = { name, activity: undefined, traits, trigger: undefined, entries: '', ...slot }
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

interface RawSpellEntry { name: string; amount?: string | number; atWill?: boolean; note?: string }
function toSpellList(raw?: RawSpellEntry[]): Array<{ name: string; amount?: string; uses?: number; atWill?: boolean; note?: string }> {
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
      note: s.note || undefined,
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

/** A raw strike → Attack; the one reader for creature and hazard strikes. */
function toAttack(a: RawAttack): Attack {
  return {
    range: a.range, name: a.name, attack: a.attack ?? 0,
    activity: activitySymbol(a.activity),
    traits: a.traits ?? [], damage: cleanDamageExpr(a.damage ?? ''),
    types: a.types ?? [], effects: a.effects ?? [],
    isAgile: (a.traits ?? []).some(t => t.toLowerCase().includes('agile')),
  }
}

/** Every HP pool in page order ("90 (body, hydra regeneration)", "15 (head, head
 *  regrowth)"); a name only when the page gives one. Undefined when there is none.
 *  A name the corpus stored inside its own brackets ("(body)", Trighoul; "(per mannequin)")
 *  loses them, so the renderer's own pair never doubles them ("100 ((body))"). */
function toHpPools(hp: unknown): Array<{ hp: number; name?: string }> | undefined {
  if (!Array.isArray(hp) || !hp.length) return undefined
  return (hp as Array<{ hp?: number; name?: string }>).map(p => {
    const name = typeof p?.name === 'string' ? p.name.trim().replace(/^\(([^()]*)\)$/, '$1').trim() : ''
    return { hp: p?.hp ?? 0, ...(name ? { name } : {}) }
  })
}

/**
 * A hazard's Routine. The structured raw.routine wins (corpus HANDOFF: the structured fields
 * win): the description[0] parse carries the page's broken markup ("Lightning Arc one-action]",
 * "they are [clumsy 1", Rune Sentries) and on some pages reads the wrong paragraph entirely
 * (Tylegmut's Last Meal). What the prose parse holds AFTER the structured text — the hazard's
 * "Speed 10 feet", a strike line, a free action printed under the Routine (Guthallath Rockslide's
 * Early Collapse) — the structured field leaves out, so it is kept: found by the structured
 * text's last 40 characters in the prose, and appended. Not found → the structured text alone.
 */
/** Whitespace-folded, lower-cased text, for comparing a structured field with the prose parse. */
const flatText = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** A comparable name: links unwrapped, tags and cost glyphs dropped, case and punctuation folded. */
const normLabel = (s: string) => s
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, ' ')
  .toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Where each hazard strike sits among the hazard's abilities on its page: the number of
 * `abilities` printed before it. A hazard page prints its Melee / Ranged line as the effect of the
 * ability above it and its riders below it — Poisoned Lock: "Spring", "Melee spine", "Cladis
 * Poison"; Vorpal Executioner: "Total Decapitation", "Melee saw blade", "Decapitation". Read from
 * the page's bold labels. Every ability must be found, in record order, as a bold label; when one
 * is not (a prose-parsed ability, a page printing it unbolded) no strike gets an anchor and the
 * renderer keeps the default (all strikes after the abilities, before the Routine).
 */
function hazardStrikeAnchors(markdown: string | undefined, abilities: Ability[], attacks: Attack[]): Array<number | undefined> {
  const out: Array<number | undefined> = attacks.map(() => undefined)
  if (!markdown || !attacks.length || !abilities.length) return out
  const titleAt = markdown.search(/<title level="\d"[^>]*\bright="Hazard/)
  const md = titleAt >= 0 ? markdown.slice(titleAt) : markdown
  const labels = [...md.matchAll(/\[\*\*(.+?)\*\*\]\([^)]*\)|\*\*\[([^\]]+)\]\([^)]*\)\s*\*\*|\*\*([^*\n]+?)\*\*/g)]
    .map(m => ({ label: normLabel(m[1] ?? m[2] ?? m[3]), at: m.index!, end: m.index! + m[0].length }))
  const abilityAt: number[] = []
  let from = -1
  for (const ab of abilities) {
    const want = normLabel(ab.name)
    const hit = labels.find(l => l.at > from && l.label === want)
    if (!want || !hit) return out
    abilityAt.push(hit.at)
    from = hit.at
  }
  const used = new Set<number>()
  for (const l of labels) {
    if (l.label !== 'melee' && l.label !== 'ranged') continue
    // "**Melee** <actions …/> jaws +17": the strike's own name opens the text after the label.
    const after = normLabel(md.slice(l.end, l.end + 200))
    const k = attacks.findIndex((a, i) => !used.has(i) && normLabel(a.name) !== '' && after.startsWith(normLabel(a.name)))
    if (k < 0) continue
    used.add(k)
    out[k] = abilityAt.filter(p => p < l.at).length
  }
  return out
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordsRe = (words: string[]) => words.map(escRe).join('\\s+')

/**
 * A hazard prose field with the text of its own ability entries cut out. The description[0]
 * parse runs an ability printed in the flavor paragraph into the Description (Swatted Like
 * Flies' "Escaping") and one printed under the Routine into the Routine (Spectral Archers'
 * "Continuous Barrage"); the ability is also an entry, so it was drawn twice. The cut runs from
 * the ability's name (followed, within a cost or trait list, by its first words) through its last
 * words; an ability whose words are not found whole leaves the prose as it is.
 */
function withoutAbilityText(prose: string, abilities: Ability[]): string {
  let out = prose
  for (const ab of abilities) {
    const name = ab.name.replace(/[◆◇↺]/g, ' ').replace(/\s+/g, ' ').trim()
    const body = `${ab.trigger ? `Trigger ${ab.trigger} ` : ''}${ab.entries ?? ''}`.replace(/\s+/g, ' ').trim()
    const words = body.split(' ').filter(Boolean)
    // Four words at least: a strike printed as an ability ("Spinning Blade ◆ blade +18, Damage
    // 2d8+9 slashing", Clockwork Dancers) is short and was drawn again in the Routine.
    if (!name || words.length < 4) continue
    // Between the name and the first words: a printed cost and a trait list of any length
    // ("Captivate Single Action (charm, enchantment, incapacitation, mental, occult) The faintly…",
    // Endless Elven Aging's Routine), then at most 60 characters of clause labels, never across a
    // line or a sentence end: there the name is only MENTIONED ("…with Live a Thousand Lives.\nLive a
    // Thousand Lives Single Action …"), and a cut from the mention ate the sentence's last words.
    const head = new RegExp(`(^|[\\s.;:])${wordsRe(name.split(' '))}(?![\\w'’])`
      + `(?:\\s*(?:Single Action|One Action|Two Actions|Three Actions|Free Action|Reaction|Action))?`
      + `(?:\\s*\\([^()]{0,200}\\))?[^\\n.]{0,60}?${wordsRe(words.slice(0, 4))}`)
    const m = head.exec(out)
    if (!m) continue
    const start = m.index + m[1].length
    const tail = new RegExp(`${wordsRe(words.slice(-4))}[.;]?`).exec(out.slice(start))
    if (!tail) continue
    const end = start + tail.index + tail[0].length
    const before = out.slice(0, start).replace(/[ \t]+$/, '')
    const after = out.slice(end).replace(/^[ \t]+/, '')
    out = (before && after && !/\s$/.test(before) && !/^\s/.test(after) ? `${before} ${after}` : before + after).trim()
  }
  return out
}

function hazardRoutine(structured: string, parsed: string): string {
  if (!structured.trim()) return parsed
  if (!parsed.trim()) return structured
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
  const fs = flat(structured), fp = flat(parsed)
  const probe = fs.slice(-40)
  const at = fp.lastIndexOf(probe)
  const tail = at >= 0 ? fp.slice(at + probe.length).trim() : ''
  return tail ? `${structured}\n${tail}` : structured
}

/**
 * The Recall Knowledge sidebar an Archives page prints above the stat block —
 *   **[Recall Knowledge - Fiend](…)**\n([Religion](…)): DC 23
 *   **[Unspecific Lore](…)**: DC 21   **[Specific Lore](…)**: DC 18
 * — formatted the way StatBlock's computed row reads ("DC 23 • Fiend (Religion)",
 * several types "DC 22 • Animal (Nature), Humanoid (Society)"), with the lore
 * DCs after " • " ("Unspecific Lore DC 21 • Specific Lore DC 18").
 * Undefined when the page prints none (47 corpus creatures: trolls, Unseen
 * Servant, Brainchild, whose prose only MENTIONS Recall Knowledge).
 */
export function recallKnowledgeFromPage(markdown?: string): string | undefined {
  if (!markdown) return undefined
  // The sidebar sits before the stat block's own title (right="Creature N"; a
  // family page has other level-2 titles before it, Norn); an ability that names
  // a DC for Recall Knowledge further down is not the sidebar.
  const titleAt = markdown.search(/<title level="2"[^>]*\bright="Creature/)
  const head = (titleAt > 0 ? markdown.slice(0, titleAt) : markdown)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '')
  const rows = [...head.matchAll(/Recall Knowledge\s*(?:[-–—]\s*([^\n(:]*?))?\s*\(\s*([^)]*?)\s*\)\s*:\s*DC\s*(\d+)/g)]
    .map(m => ({
      type: m[1]?.trim() || undefined,
      skills: m[2].split(/\s*,\s*|\s+or\s+/).map(s => s.trim()).filter(Boolean),
      dc: parseInt(m[3], 10),
    }))
    .filter(r => r.skills.length)
  if (!rows.length) return undefined
  const sameDc = rows.every(r => r.dc === rows[0].dc)
  const typed = (r: typeof rows[number]) => `${r.type ? `${r.type} ` : ''}(${r.skills.join(' or ')})`
  const main = rows.length === 1
    ? `DC ${rows[0].dc} ${rows[0].type ? '• ' : ''}${typed(rows[0])}`
    : sameDc
      ? `DC ${rows[0].dc} • ${rows.map(typed).join(', ')}`
      : rows.map(r => `DC ${r.dc} • ${typed(r)}`).join(', ')
  const u = head.match(/Unspecific Lore\s*:\s*DC\s*(\d+)/)
  const s = head.match(/\bSpecific Lore\s*:\s*DC\s*(\d+)/)
  return [
    main,
    u ? `Unspecific Lore DC ${u[1]}` : null,
    s ? `Specific Lore DC ${s[1]}` : null,
  ].filter(Boolean).join(' • ')
}

export function parseCreature(raw: RawCreature, _sourceFile = ''): Creature {
  const def = raw.defenses ?? {}
  const attacks: Attack[] = (raw.attacks ?? []).map(toAttack)

  const allAbilities: Ability[] = []
  for (const slot of ['top','mid','bot'] as const) {
    for (const ab of raw.abilities?.[slot] ?? []) {
      const built: Ability = {
        name: ab.name, activity: activitySymbol(ab.activity),
        traits: ab.traits ?? [], trigger: ab.trigger ? cleanEntryString(ab.trigger) : ab.trigger,
        entries: cleanEntryString(entriesToTagText(ab.entries ?? [])),
        slot,
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

  const hpPools = toHpPools(def.hp)
  const defenses: Defenses = {
    ac: getACStd(def.ac), fort: getSaveStd(def.savingThrows?.fort),
    ref: getSaveStd(def.savingThrows?.ref), will: getSaveStd(def.savingThrows?.will),
    hp: def.hp?.[0]?.hp ?? 0,
    hpNote: def.hp?.[0]?.name,
    ...(hpPools ? { hpPools } : {}),
    saveNote: def.savingThrows?.note,
    acNote: def.acNote,
    // Construct creatures print Hardness (Animated Axe, 54 records); read as parseHazard does.
    ...(def.hardness?.std != null ? { hardness: def.hardness.std } : {}),
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

  // telepathy 100 feet, truespeech … — printed after '; ' on the Languages line.
  const languageAbilities = (raw.languages?.abilities ?? []).map(cleanAonTemplate).filter(Boolean)
  // Only what the page prints: a page with no sidebar leaves it unset (Troll, Unseen Servant).
  const recallKnowledge = recallKnowledgeFromPage(aon?.markdown)

  return {
    id: uid(raw.name.toLowerCase().replace(/\s+/g,'-')),
    name: raw.name, source: sourceStr.trim(),
    level: raw.level ?? 0, traits: raw.traits ?? [],
    perception: raw.perception?.std ?? 0,
    senses: (raw.senses ?? []).map(s => s.name + (s.range ? ` ${s.range}ft`:'')),
    perceptionNote: raw.perceptionNote,
    languages: (raw.languages?.languages ?? []).map(cleanAonTemplate), skills,
    ...(languageAbilities.length ? { languageAbilities } : {}),
    ...(recallKnowledge ? { recallKnowledge } : {}),
    str: raw.abilityMods?.str??0, dex: raw.abilityMods?.dex??0,
    con: raw.abilityMods?.con??0, int: raw.abilityMods?.int??0,
    wis: raw.abilityMods?.wis??0, cha: raw.abilityMods?.cha??0,
    items: raw.items ?? [], speed: raw.speed ?? {}, speedNote: raw.speedNote,
    attacks, spellcasting, rituals: raw.rituals, abilities: allAbilities, defenses,
    isHazard: false,
    flavor: raw.flavor || undefined,
    family: raw.family || undefined,
    aonUrl:      aon?.url ? (aon.url.startsWith('http') ? aon.url : `https://2e.aonprd.com${aon.url}`) : undefined,
    rawMarkdown: aon?.markdown || undefined,
    // The page marker that outlives the persist slimming (rawMarkdown is stripped from saved
    // encounters and the live board): a reloaded page record still prints only the page's RK.
    ...(aon?.markdown ? { fromArchivesPage: true } : {}),
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

  // Strikes: structured raw.attacks (read exactly like a creature's) first, then
  // the ones parsed out of the prose that the structured list does not name.
  const structuredAttacks = (raw.attacks ?? []).map(toAttack)
  const seenAttacks = new Set(structuredAttacks.map(a => a.name.toLowerCase()))
  const aonH = (raw as unknown as Record<string, unknown>)['_aon'] as
    { id?: string; url?: string; markdown?: string } | undefined
  const unanchored = [
    ...structuredAttacks,
    ...parsed.attacks.filter(a => !seenAttacks.has(a.name.toLowerCase())),
  ]
  // Each strike remembers where the page prints it among the abilities (see hazardStrikeAnchors).
  const anchors = hazardStrikeAnchors(aonH?.markdown, mergedAbilities, unanchored)
  const mergedAttacks = unanchored.map((a, i) => anchors[i] !== undefined ? { ...a, afterAbility: anchors[i] } : a)

  // raw.defenses.hp is stored as `[{ hp: N, abilities?: [...] }]` (multiple
  // parts per hazard). Use the first part's HP — single-part hazards always
  // have exactly one element, multi-part ones get the primary structure.
  const hpRaw = def.hp as unknown
  const hpVal = Array.isArray(hpRaw) ? (hpRaw[0]?.hp ?? 0)
              : (hpRaw as { std?: number })?.std ?? 0

  const hpPoolsH = toHpPools(hpRaw)
  // Only the saves the page prints (a number on the record); the renderer draws
  // just these boxes, so an unprinted Will no longer shows as +0.
  const savesPrinted = (['fort', 'ref', 'will'] as const)
    .filter(k => typeof def.savingThrows?.[k]?.std === 'number')

  const defenses: Defenses = {
    ac: getACStd(def.ac), fort: getSaveStd(def.savingThrows?.fort),
    ref: getSaveStd(def.savingThrows?.ref), will: getSaveStd(def.savingThrows?.will),
    hp: hpVal,
    // The first component's label ("Hammer", "Trapdoor") is the combat pool's note, as a
    // creature's hpNote is its pools[0].name.
    ...(hpPoolsH?.[0]?.name ? { hpNote: hpPoolsH[0].name } : {}),
    ...(hpPoolsH ? { hpPools: hpPoolsH } : {}),
    savesPrinted,
    // Decided here, on the unadjusted record: the page prints an AC iff ac.std is a number.
    acPrinted: typeof def.ac?.std === 'number',
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
  // Structured first (D6); the prose string carries the page's qualifier ("or DC 26 (expert) to
  // notice the control panel") the structured bonus does not, so it wins only when it STARTS with
  // the structured value and adds to it.
  const stealthDisplay = (stealthFromRaw && parsed.stealth && !flatText(parsed.stealth).startsWith(flatText(stealthFromRaw)))
    ? stealthFromRaw
    : parsed.stealth || stealthFromRaw || '—'

  // An ability drawn as its own entry is never drawn again inside a prose section.
  const prose = (s: string | undefined) => s ? withoutAbilityText(s, mergedAbilities) : (s ?? '')

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
    attacks: mergedAttacks,
    spellcasting: [],
    abilities: mergedAbilities,
    defenses, isHazard: true,
    hazardData: {
      stealth:     stealthDisplay,
      description: prose(parsed.flavor || rawDescription),
      // The structured fields win (corpus HANDOFF: "the structured fields win in the adapter's
      // merge"); the description[0] parse cuts a section at its own section word, so a Disable
      // ending "(see Reset below)" lost "Reset below)." (Spinning Blade Pillar) and one saying
      // "(see Routine) is increased by 4" lost the rest (Swatted Like Flies). The prose parse is
      // only the fallback for a record whose structured field is empty.
      disable:     prose(entriesToText(raw.disable?.entries ?? []).trim() || parsed.disable),
      routine:     prose(hazardRoutine(entriesToText(raw.routine ?? []), parsed.routine ?? '')),
      reset:       prose(entriesToText(raw.reset ?? []).trim() || parsed.reset),
      // The scraper rarely sets raw.complex — fall back to the flag parsed
      // out of the "Complexity Complex/Simple" prose header.
      complex:     raw.complex || parsed.complex || false,
    },
    aonUrl:      aonH?.url ? (aonH.url.startsWith('http') ? aonH.url : `https://2e.aonprd.com${aonH.url}`) : undefined,
    rawMarkdown: aonH?.markdown || undefined,
    raw,
  }
}
