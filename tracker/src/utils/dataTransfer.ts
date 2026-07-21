import type { Creature } from '../types/pf2e'

// ── Full backup / restore + custom-creature import ─────────────────────────
// All app data lives in localStorage under `pf2e-*` keys (parties, encounters,
// custom creatures, conditions, settings, current combat, DM averages, search
// state). A full backup is just a snapshot of those keys; restoring writes them
// back verbatim and the app reloads to re-hydrate every store.

const APP_ID = 'pf2e-initiative-tracker'
const BACKUP_KIND = 'pf2e-full-backup'
const PREFIX = 'pf2e-'

let _uid = 0
const uid = () => `custom-${Date.now()}-${++_uid}`
const stamp = () => new Date().toISOString().slice(0, 10)

function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Export everything ───────────────────────────────────────────────────────
export function exportAllData(): void {
  const data: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(PREFIX)) {
      const v = localStorage.getItem(key)
      if (v != null) data[key] = v
    }
  }
  downloadJson(
    { app: APP_ID, kind: BACKUP_KIND, exportedAt: new Date().toISOString(), data },
    `pf2e-tracker-backup-${stamp()}.json`,
  )
}

// ── Read a backup file (parsed + validated, NOT yet applied) ─────────────────
export interface BackupRead {
  ok: boolean
  data?: Record<string, string>
  exportedAt?: string
  count?: number
  error?: string
}

function parseBackup(text: string): BackupRead {
  let parsed: any
  try { parsed = JSON.parse(text) } catch { return { ok: false, error: 'That file is not valid JSON.' } }
  if (!parsed || parsed.kind !== BACKUP_KIND || !parsed.data || typeof parsed.data !== 'object') {
    return { ok: false, error: 'That is not a PF2e Tracker backup file (use "Export all data" to make one).' }
  }
  const data: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k.startsWith(PREFIX) && typeof v === 'string') data[k] = v
  }
  return { ok: true, data, exportedAt: parsed.exportedAt, count: Object.keys(data).length }
}

/** Prompt for a backup file and return its parsed contents (caller confirms
 *  before applying). */
export function readBackupFromFilePicker(): Promise<BackupRead> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) { resolve({ ok: false, error: 'No file selected.' }); return }
      resolve(parseBackup(await file.text()))
    }
    input.click()
  })
}

export type ImportMode = 'replace' | 'merge'

// Collection keys whose JSON value is an array of objects with an `id` — in
// merge mode these are unioned by id (imported entries win on an id clash).
const MERGE_BY_ID = new Set(['pf2e-parties', 'pf2e-custom-creatures', 'pf2e-custom-conditions', 'pf2e-custom-themes'])
// JSON arrays of plain strings — merged as a set.
const MERGE_STRING_SET = new Set(['pf2e-hidden-entries', 'pf2e-disabled-sources'])
// JSON objects keyed by name — merged key-by-key (imported keys win).
const MERGE_OBJECT_MAP = new Set(['pf2e-encounters'])

/** Combine one key's current value with the imported value for merge mode. */
function mergeValue(key: string, current: string | null, incoming: string): string {
  if (current == null) return incoming  // nothing local yet → take the import
  try {
    if (MERGE_BY_ID.has(key)) {
      const cur = JSON.parse(current), inc = JSON.parse(incoming)
      if (Array.isArray(cur) && Array.isArray(inc)) {
        const byId = new Map<string, unknown>()
        for (const it of cur) if (it && (it as { id?: unknown }).id != null) byId.set(String((it as { id: unknown }).id), it)
        for (const it of inc) if (it && (it as { id?: unknown }).id != null) byId.set(String((it as { id: unknown }).id), it)
        return JSON.stringify([...byId.values()])
      }
    } else if (MERGE_STRING_SET.has(key)) {
      const cur = JSON.parse(current), inc = JSON.parse(incoming)
      if (Array.isArray(cur) && Array.isArray(inc)) return JSON.stringify([...new Set([...cur, ...inc])])
    } else if (MERGE_OBJECT_MAP.has(key)) {
      const cur = JSON.parse(current), inc = JSON.parse(incoming)
      if (cur && typeof cur === 'object' && inc && typeof inc === 'object') return JSON.stringify({ ...cur, ...inc })
    }
  } catch { /* malformed JSON — fall through and keep the current value */ }
  // Singletons (settings, current combat, GM layout, DM averages, search state,
  // …) are left as the user's current value in merge mode, so "Update" never
  // disturbs their config or running session — it only adds collection items.
  return current
}

/** Write a backup's data into the `pf2e-*` localStorage keys. `replace` first
 *  WIPES every existing pf2e-* key (true reset); `merge` adds the backup's
 *  collections to the current data without losing what's already there. The
 *  caller should reload the app immediately afterwards so every store
 *  re-hydrates. */
export function applyBackup(data: Record<string, string>, mode: ImportMode = 'replace'): number {
  if (mode === 'replace') {
    const existing: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(PREFIX)) existing.push(k)
    }
    for (const k of existing) localStorage.removeItem(k)
  }
  let n = 0
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(PREFIX) || typeof value !== 'string') continue
    localStorage.setItem(key, mode === 'merge' ? mergeValue(key, localStorage.getItem(key), value) : value)
    n++
  }
  return n
}

// ── Custom-creature import ──────────────────────────────────────────────────
// Parses (does NOT save) creatures from a file so the caller can preview/edit
// them in the custom-creature panel before committing. Accepts a single
// creature, an array of creatures, a `{ creatures: [...] }` wrapper, a full
// backup file (pulls its custom creatures out), or a third-party "monster
// maker" export. Each creature is normalised so a slightly-incomplete file
// can't crash the stat-block renderer.

export interface ParsedCreaturesResult {
  ok: boolean
  creatures: Creature[]
  error?: string
}

function normalizeCreature(o: any): Creature | null {
  if (!o || typeof o !== 'object') return null
  if (typeof o.name !== 'string' || !o.name.trim()) return null
  if (!o.defenses || typeof o.defenses !== 'object') return null
  const d = o.defenses
  return {
    id: typeof o.id === 'string' && o.id ? o.id : uid(),
    name: o.name,
    source: typeof o.source === 'string' && o.source ? o.source : 'Homebrew',
    level: typeof o.level === 'number' ? o.level : 0,
    image: typeof o.image === 'string' ? o.image : undefined,
    traits: Array.isArray(o.traits) ? o.traits : [],
    perception: typeof o.perception === 'number' ? o.perception : 0,
    senses: Array.isArray(o.senses) ? o.senses : [],
    languages: Array.isArray(o.languages) ? o.languages : [],
    skills: o.skills && typeof o.skills === 'object' ? o.skills : {},
    str: o.str ?? 0, dex: o.dex ?? 0, con: o.con ?? 0, int: o.int ?? 0, wis: o.wis ?? 0, cha: o.cha ?? 0,
    items: Array.isArray(o.items) ? o.items : [],
    speed: o.speed && typeof o.speed === 'object' ? o.speed : {},
    attacks: Array.isArray(o.attacks) ? o.attacks : [],
    spellcasting: Array.isArray(o.spellcasting) ? o.spellcasting : [],
    abilities: Array.isArray(o.abilities) ? o.abilities : [],
    defenses: {
      ac: d.ac ?? 0, fort: d.fort ?? 0, ref: d.ref ?? 0, will: d.will ?? 0, hp: d.hp ?? 0,
      hardness: typeof d.hardness === 'number' ? d.hardness : undefined,
      bt: typeof d.bt === 'number' ? d.bt : undefined,
      immunities: Array.isArray(d.immunities) ? d.immunities : [],
      resistances: Array.isArray(d.resistances) ? d.resistances : [],
      weaknesses: Array.isArray(d.weaknesses) ? d.weaknesses : [],
    },
    isHazard: !!o.isHazard,
    hazardData: o.hazardData,
    recallKnowledge: typeof o.recallKnowledge === 'string' ? o.recallKnowledge : undefined,
    aonUrl: typeof o.aonUrl === 'string' ? o.aonUrl : undefined,
    rawMarkdown: typeof o.rawMarkdown === 'string' ? o.rawMarkdown : undefined,
    raw: o.raw ?? ({} as Creature['raw']),
  }
}

// ── Third-party "monster maker" format ─────────────────────────────────────
// Web monster builders (e.g. the nothic.io / PF2e Monster Maker tool) export a
// flat shape: ability scores / AC / HP / saves / skills as { value, benchmark,
// note } objects, attacks under `strikes`, special abilities under `specials`,
// speed/languages as strings. We translate that into our Creature shape.

const MM_SKILLS = [
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
  'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion',
  'society', 'stealth', 'survival', 'thievery',
]
const MM_ACTION_GLYPH: Record<string, string> = {
  one: '◆', two: '◆◆', three: '◆◆◆', free: '◇', reaction: '↺',
}

const _num = (v: any): number => {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return isNaN(n) ? 0 : n
}
const _list = (s: any): string[] =>
  typeof s === 'string' ? s.split(',').map(x => x.trim()).filter(Boolean) : []
const _cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function isMonsterMaker(o: any): boolean {
  return !!o && typeof o === 'object'
    && o.ac && typeof o.ac === 'object' && 'value' in o.ac
    && o.hp && typeof o.hp === 'object' && 'value' in o.hp
}

function mmSpeed(s: any): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof s !== 'string') return out
  for (const part of s.split(',').map(p => p.trim()).filter(Boolean)) {
    const m = part.match(/(walk|fly|swim|burrow|climb)?\s*(\d+)/i)
    if (m) out[(m[1] || 'walk').toLowerCase()] = parseInt(m[2], 10)
  }
  return out
}
function mmRW(cell: any): Array<{ amount: number; name: string }> {
  const v = cell?.value
  if (typeof v !== 'string' || !v.trim()) return []
  return v.split(',').map((p: string) => p.trim()).filter(Boolean).map((p: string) => {
    const m = p.match(/^(.*?)\s+(\d+)$/)
    return m ? { name: m[1].trim(), amount: parseInt(m[2], 10) } : { name: p, amount: 0 }
  })
}

function convertMonsterMaker(o: any): any {
  const traits: string[] = []
  const align = typeof o.alignment === 'string' ? o.alignment.trim() : ''
  if (align && align.toLowerCase() !== 'n') traits.push(align.toUpperCase())
  if (typeof o.size === 'string' && o.size.trim()) traits.push(_cap(o.size.trim()))
  if (typeof o.type === 'string' && o.type.trim()) traits.push(_cap(o.type.trim()))
  for (const t of _list(o.traits)) if (!traits.includes(t)) traits.push(t)

  const skills: Record<string, number> = {}
  for (const sk of MM_SKILLS) {
    const cell = o[sk]
    if (cell && typeof cell === 'object' && typeof cell.value === 'number') skills[_cap(sk)] = cell.value
  }
  for (const lk of ['lore', 'lorealt']) {
    const cell = o[lk]
    if (cell && typeof cell === 'object' && typeof cell.value === 'number') {
      const nm = (typeof cell.name === 'string' && cell.name.trim()) ? _cap(cell.name.trim()) : 'Lore'
      skills[nm] = cell.value
    }
  }

  const attacks = (Array.isArray(o.strikes) ? o.strikes : []).map((s: any) => {
    const atraits = _list(s.traits)
    return {
      range: typeof s.type === 'string' && s.type.toLowerCase().startsWith('ranged') ? 'Ranged' : 'Melee',
      name: typeof s.name === 'string' ? s.name : 'Strike',
      attack: _num(s.attack),
      traits: atraits,
      damage: typeof s.damage === 'string' ? s.damage : '',
      types: [],
      effects: [],
      isAgile: atraits.some(t => t.toLowerCase() === 'agile'),
    }
  })

  const abilities = (Array.isArray(o.specials) ? o.specials : []).map((sp: any) => ({
    name: typeof sp.name === 'string' ? sp.name : 'Ability',
    activity: MM_ACTION_GLYPH[String(sp.actions || '').toLowerCase()],
    traits: _list(sp.traits),
    entries: typeof sp.description === 'string' ? sp.description : '',
  }))

  return {
    name: o.name,
    source: 'Homebrew',
    level: _num(o.level),
    image: typeof o.imgurl === 'string' && o.imgurl ? o.imgurl : undefined,
    traits,
    perception: _num(o.perception?.value),
    senses: _list(o.perception?.note),
    languages: _list(o.languages),
    skills,
    str: _num(o.strength?.value), dex: _num(o.dexterity?.value), con: _num(o.constitution?.value),
    int: _num(o.intelligence?.value), wis: _num(o.wisdom?.value), cha: _num(o.charisma?.value),
    items: _list(o.items),
    speed: mmSpeed(o.speed),
    attacks,
    spellcasting: [],
    abilities,
    defenses: {
      ac: _num(o.ac?.value), hp: _num(o.hp?.value),
      fort: _num(o.fortitude?.value), ref: _num(o.reflex?.value), will: _num(o.will?.value),
      immunities: typeof o.immunity?.value === 'string' ? _list(o.immunity.value) : [],
      resistances: mmRW(o.resistance),
      weaknesses: mmRW(o.weakness),
    },
    isHazard: false,
  }
}

/** Turn any supported shape into a Creature (our own format, or a monster-maker
 *  export). Returns null if it doesn't look like a creature at all. */
function coerceCreature(raw: any): Creature | null {
  const direct = normalizeCreature(raw)
  if (direct) return direct
  if (isMonsterMaker(raw)) return normalizeCreature(convertMonsterMaker(raw))
  return null
}

export function parseCreaturesFromText(text: string): ParsedCreaturesResult {
  let parsed: any
  try { parsed = JSON.parse(text) } catch { return { ok: false, creatures: [], error: 'That file is not valid JSON.' } }

  let candidates: any[] = []
  if (Array.isArray(parsed)) candidates = parsed
  else if (Array.isArray(parsed?.creatures)) candidates = parsed.creatures
  else if (parsed?.kind === BACKUP_KIND && typeof parsed?.data?.['pf2e-custom-creatures'] === 'string') {
    try { candidates = JSON.parse(parsed.data['pf2e-custom-creatures']) } catch { candidates = [] }
  } else if (parsed && typeof parsed === 'object') {
    candidates = [parsed]
  }

  const creatures: Creature[] = []
  for (const raw of candidates) {
    const c = coerceCreature(raw)
    if (!c) continue
    c.id = uid()  // fresh id — these are drafts; saving decides overwrite-by-name
    creatures.push(c)
  }

  if (!creatures.length) return { ok: false, creatures: [], error: 'No creatures found in that file.' }
  return { ok: true, creatures }
}

/** Prompt for one or more JSON files and return every creature parsed from them
 *  (NOT saved — the caller previews/edits them before committing). */
export function readCustomCreaturesFromFilePicker(): Promise<ParsedCreaturesResult> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.multiple = true
    input.onchange = async () => {
      const files = Array.from(input.files ?? [])
      if (!files.length) { resolve({ ok: false, creatures: [], error: 'No file selected.' }); return }
      const creatures: Creature[] = []
      let lastError: string | undefined
      for (const f of files) {
        const r = parseCreaturesFromText(await f.text())
        if (r.ok) creatures.push(...r.creatures)
        else lastError = r.error
      }
      if (creatures.length) resolve({ ok: true, creatures })
      else resolve({ ok: false, creatures: [], error: lastError ?? 'No creatures found.' })
    }
    input.click()
  })
}
