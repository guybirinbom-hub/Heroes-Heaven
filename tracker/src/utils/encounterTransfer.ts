// Portable export/import format for saved encounters.
//
// The on-disk save (in localStorage) embeds the *full* Creature object for
// each combatant. That's convenient locally but bloats the file when sharing
// and prevents the importer from picking up updates to the bestiary.
//
// The portable format only stores **references** (creature name + source),
// so the importer can resolve them against the user's own custom creatures
// and bestiary index. If a creature isn't found, the imported combatant
// keeps just its display name and goes into the tracker without a stat block.

import type { SavedEncounter } from '../types/pf2e'
import { loadCustomCreatures, loadIndex, loadCreature, type IndexEntry } from '../data/dataStore'
import { readEncounterStore, writeEncounterStore } from '../store/combatStore'

const FILE_VERSION = 1

export interface PortableCombatant {
  name: string
  /** Reference to look up by name in custom + bestiary. null for PCs / unlinked. */
  creatureName: string | null
  /** Optional source — used as a tiebreaker if multiple creatures share a name. */
  creatureSource?: string | null
  isPC: boolean
  isAlly?: boolean
  maxHP: number
  isElite: boolean
  isWeak: boolean
  scaledToLevel?: number | null
  notes: string
}

export interface PortableEncounter {
  name: string
  savedAt: string
  combatants: PortableCombatant[]
}

export interface PortableEncounterFile {
  version: number
  exportedAt: string
  encounters: PortableEncounter[]
}

// Route reads/writes through combatStore's cached helpers so import/export
// shares the same in-memory snapshot as the combat tracker itself — no double
// JSON.parse of the encounter blob.
function readSavedStore(): Record<string, SavedEncounter> {
  return readEncounterStore()
}
function writeSavedStore(store: Record<string, SavedEncounter>): void {
  writeEncounterStore(store)
}

// ── Export ────────────────────────────────────────────────────────────────

/** Strip the heavy Creature object out — keep only the name reference. */
function toPortable(saved: SavedEncounter): PortableEncounter {
  return {
    name: saved.name,
    savedAt: saved.savedAt,
    combatants: saved.combatants.map(sc => ({
      name: sc.name,
      creatureName: sc.creature?.name ?? null,
      creatureSource: sc.creature?.source ?? null,
      isPC: sc.isPC,
      isAlly: sc.isAlly ?? false,
      maxHP: sc.maxHP,
      isElite: sc.isElite,
      isWeak: sc.isWeak,
      scaledToLevel: sc.scaledToLevel ?? null,
      notes: sc.notes,
    })),
  }
}

/** Build the export payload for a chosen subset of saved encounters. */
export function buildExportPayload(names: string[]): PortableEncounterFile {
  const store = readSavedStore()
  const encounters: PortableEncounter[] = []
  for (const n of names) {
    const saved = store[n]
    if (saved) encounters.push(toPortable(saved))
  }
  return {
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    encounters,
  }
}

/** Trigger a browser download of the chosen encounters as a JSON file. */
export function downloadEncounters(names: string[]): void {
  const payload = buildExportPayload(names)
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const stamp = new Date().toISOString().slice(0, 10)
  a.download = names.length === 1
    ? `pf2e-encounter-${names[0].replace(/[^\w-]+/g, '_')}-${stamp}.json`
    : `pf2e-encounters-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Import ────────────────────────────────────────────────────────────────

export interface ImportResult {
  /** Encounter names that were added or overwritten. */
  added: string[]
  /** Combatants whose creature reference could not be resolved (kept as name-only rows). */
  missing: Array<{ encounter: string; combatant: string; creature: string }>
  /** Whether the file was parsed at all. */
  ok: boolean
  /** Top-level error if the file was unreadable. */
  error?: string
}

/** Resolve a combatant's creature by name against the user's local data. */
async function resolveCreature(
  ref: PortableCombatant,
  customByName: Map<string, ReturnType<typeof loadCustomCreatures>[number]>,
  indexByName: Map<string, IndexEntry>,
) {
  if (!ref.creatureName) return null
  const key = ref.creatureName.toLowerCase()
  const cust = customByName.get(key)
  if (cust) return cust
  const idx = indexByName.get(key)
  if (idx) {
    try { return await loadCreature(idx) } catch { return null }
  }
  return null
}

/**
 * Import a portable encounter file. For each combatant, looks up the creature
 * by name in custom + bestiary. If not found, the combatant is added with
 * `creature: null` — it appears as a name-only row in the initiative tracker.
 *
 * If an encounter with the same name already exists locally, it is overwritten.
 */
export async function importEncountersFromText(text: string): Promise<ImportResult> {
  let data: PortableEncounterFile
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { ok: false, added: [], missing: [], error: 'File is not valid JSON.' }
  }
  if (!data || !Array.isArray(data.encounters)) {
    return { ok: false, added: [], missing: [], error: 'File does not look like a PF2e Tracker encounter export.' }
  }

  const customs = loadCustomCreatures()
  const customByName = new Map(customs.map(c => [c.name.toLowerCase(), c]))
  let indexByName: Map<string, IndexEntry> = new Map()
  try {
    const idx = await loadIndex()
    indexByName = new Map(idx.map(e => [e.name.toLowerCase(), e]))
  } catch { /* fine — we'll just miss bestiary lookups */ }

  const existing = readSavedStore()
  const added: string[] = []
  const missing: ImportResult['missing'] = []

  for (const enc of data.encounters) {
    if (!enc?.name || !Array.isArray(enc.combatants)) continue

    const combatants = await Promise.all(enc.combatants.map(async sc => {
      const creature = await resolveCreature(sc, customByName, indexByName)
      if (sc.creatureName && !creature) {
        missing.push({ encounter: enc.name, combatant: sc.name, creature: sc.creatureName })
      }
      return {
        name: sc.name,
        creature,
        creatureId: creature?.id ?? null,
        isPC: !!sc.isPC,
        isAlly: !!sc.isAlly,
        maxHP: typeof sc.maxHP === 'number' ? sc.maxHP : (creature?.defenses.hp ?? 0),
        isElite: !!sc.isElite,
        isWeak: !!sc.isWeak,
        scaledToLevel: sc.scaledToLevel ?? undefined,
        notes: sc.notes ?? '',
      }
    }))

    existing[enc.name] = {
      name: enc.name,
      savedAt: enc.savedAt || new Date().toISOString(),
      combatants,
    }
    added.push(enc.name)
  }

  writeSavedStore(existing)
  return { ok: true, added, missing }
}

/** Prompt the user to pick a file and import it. Returns the import result. */
export function importEncountersFromFilePicker(): Promise<ImportResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) { resolve({ ok: false, added: [], missing: [], error: 'No file selected.' }); return }
      const text = await file.text()
      resolve(await importEncountersFromText(text))
    }
    input.click()
  })
}
