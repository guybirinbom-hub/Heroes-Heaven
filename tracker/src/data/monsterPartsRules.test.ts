import { describe, it, expect } from 'vitest'
import { MONSTER_PARTS_RULES, MONSTER_PARTS_SOURCE } from './monsterPartsRules'
import { normalizeProseHtml, hasTables, splitOnTables } from '../components/MarkdownTable'

const byName = (name: string) => MONSTER_PARTS_RULES.find(r => r.name === name)

const IMBUED_PROPERTIES = [
  'Acid', 'Bane', 'Chaotic', 'Charisma', 'Cold', 'Constitution', 'Dexterity',
  'Electricity', 'Energy Resistant', 'Fire', 'Force', 'Fortification', 'Holy',
  'Intelligence', 'Lawful', 'Mental', 'Poison', 'Sensory', 'Sonic', 'Spell',
  'Strength', 'Sturdy', 'Unholy', 'Vitality', 'Void', 'Wild', 'Winged', 'Wisdom',
]

describe('MONSTER_PARTS_RULES — segmentation', () => {
  it('produced a rich set of segments, all tagged with the book source', () => {
    expect(MONSTER_PARTS_RULES.length).toBeGreaterThanOrEqual(48)
    for (const r of MONSTER_PARTS_RULES) {
      expect(r.source).toBe(MONSTER_PARTS_SOURCE)
      expect(r.name).toBeTruthy()
      expect(r.text.trim()).toBeTruthy()
    }
  })

  it('includes the overview and every one of the 28 imbued properties', () => {
    expect(byName(MONSTER_PARTS_SOURCE)).toBeTruthy() // h1 overview keeps the book name
    for (const p of IMBUED_PROPERTIES) {
      expect(byName(`Monster Parts: ${p}`), `missing "${p}"`).toBeTruthy()
    }
  })

  it('includes the reference tables and the how-to sections', () => {
    expect(byName('Monster Parts: Table 3 — Refinement / Imbuing cost by item level')).toBeTruthy()
    expect(byName('Monster Parts: Refining details by item type')).toBeTruthy()
    expect(byName('Monster Parts: Imbuing details')).toBeTruthy()
    expect(byName('Monster Parts: Variant rules')).toBeTruthy()
  })

  it('segment names are unique (so search rows never collide)', () => {
    const names = MONSTER_PARTS_RULES.map(r => r.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('MONSTER_PARTS_RULES — render-ready text', () => {
  it('never leaves raw prose HTML tags behind (tables are the only markup)', () => {
    for (const r of MONSTER_PARTS_RULES) {
      const proseOnly = r.text.replace(/<table[\s\S]*?<\/table>/gi, '')
      expect(proseOnly, r.name).not.toMatch(/<\/?(?:p|li|ul|ol|strong|em|blockquote|h[1-6]|div|span)\b/i)
    }
  })

  it('renders an imbued property as bulleted paths through the popup pipeline', () => {
    const acid = byName('Monster Parts: Acid')!
    const norm = normalizeProseHtml(acid.text)
    expect(norm).toContain('Path Magic')
    expect(norm).toContain('• ') // list entries became bullets
    expect(norm).toContain('→')   // decoded arrow survived
    expect(hasTables(norm)).toBe(false)
  })

  it('renders a reference table as a real table block', () => {
    const t3 = byName('Monster Parts: Table 3 — Refinement / Imbuing cost by item level')!
    const norm = normalizeProseHtml(t3.text)
    expect(hasTables(norm)).toBe(true)
    const blocks = splitOnTables(norm)
    const table = blocks.find(b => b.type === 'table')
    expect(table).toBeTruthy()
    if (table && table.type === 'table') {
      expect(table.header).toEqual(expect.arrayContaining(['Item Lvl', 'Weapons & Armor']))
      expect(table.rows.length).toBe(20) // one row per item level 1–20
    }
  })
})
