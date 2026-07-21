import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadConditions, loadTraits, loadSpells, loadRituals, loadActions, loadActionTraits, loadSkills, loadAbilitiesGlossary, loadEquipment, loadFamilies, loadCreatureNameIndex, loadCreatureLinks, loadRules, type SpellInfo, type RitualInfo, type EquipmentInfo, type IndexEntry, type RuleEntry } from './dataStore'

export interface GameData {
  conditions: Map<string, string>
  traits: Map<string, string>
  spells: Map<string, SpellInfo>
  rituals: Map<string, RitualInfo>
  actions: Map<string, string>   // actions + abilities glossary merged; abilities override actions
  actionTraits: Map<string, string[]>  // action name → its PF2e traits (for popups)
  skills: Map<string, string>
  equipment: Map<string, EquipmentInfo>
  families: Map<string, string>  // creature-family name (lowercased) → description
  creatures: Map<string, IndexEntry>  // creature name (lowercased) → bestiary index entry
  /** creature name (lowercased) → { term (lowercased) → popup type } — the exact
   *  links AoN puts on that creature's page, applied to its prose. */
  creatureLinks: Map<string, Record<string, string>>
  rules: Map<string, RuleEntry>  // AoN Rules page name (lowercased) → its popup content
}

const EMPTY: GameData = {
  conditions: new Map(), traits: new Map(), spells: new Map(), rituals: new Map(),
  actions: new Map(), actionTraits: new Map(), skills: new Map(), equipment: new Map(), families: new Map(),
  creatures: new Map(), creatureLinks: new Map(), rules: new Map(),
}
const GameDataCtx = createContext<GameData>(EMPTY)

export function GameDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<GameData>(EMPTY)
  useEffect(() => {
    Promise.all([loadConditions(), loadTraits(), loadSpells(), loadRituals(), loadActions(), loadActionTraits(), loadSkills(), loadAbilitiesGlossary(), loadEquipment(), loadFamilies(), loadCreatureNameIndex(), loadCreatureLinks(), loadRules()])
      .then(([conditions, traits, spells, rituals, actions, actionTraits, skills, abilitiesGlossary, equipment, families, creatures, creatureLinks, rules]) => {
        // Merge: start with actions, then override/add with abilities (more creature-relevant)
        const merged = new Map(actions)
        for (const [k, v] of abilitiesGlossary) merged.set(k, v)
        setData({ conditions, traits, spells, rituals, actions: merged, actionTraits, skills, equipment, families, creatures, creatureLinks, rules })
      })
  }, [])
  return <GameDataCtx.Provider value={data}>{children}</GameDataCtx.Provider>
}

export const useGameData = () => useContext(GameDataCtx)

// Per-creature AoN link map (term → popup type) for the prose currently being
// rendered. StatBlock / CreatureDescription set it so TagRenderer / RichText
// link exactly the words AoN links on that creature.
export const CreatureLinksCtx = createContext<Record<string, string> | undefined>(undefined)
export const useCreatureLinks = () => useContext(CreatureLinksCtx)
