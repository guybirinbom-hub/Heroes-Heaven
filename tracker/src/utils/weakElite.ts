import type { Creature } from '../types/pf2e'

// ─────────────────────────────────────────────────────────────────────────────
// Official Weak/Elite adjustments (Bestiary 1)
// ─────────────────────────────────────────────────────────────────────────────
export function applyWeakElite(creature: Creature, mode: 'weak' | 'elite' | 'normal'): Creature {
  if (mode === 'normal') return creature
  const s = mode === 'elite' ? 1 : -1
  const c: Creature = JSON.parse(JSON.stringify(creature))
  c.level = creature.level + s
  c.defenses.ac    += s * 2
  c.defenses.fort  += s * 2
  c.defenses.ref   += s * 2
  c.defenses.will  += s * 2
  c.perception     += s * 2
  c.skills = Object.fromEntries(Object.entries(creature.skills).map(([k, v]) => [k, v + s * 2]))
  const lv = creature.level
  const hpMod = mode === 'elite'
    ? (lv <= 1 ? 10 : lv <= 4 ? 15 : lv <= 19 ? 20 : 30)
    : (lv <= 2 ? 10 : lv <= 5 ? 15 : lv <= 20 ? 20 : 30)
  c.defenses.hp = Math.max(1, creature.defenses.hp + s * hpMod)
  c.attacks = creature.attacks.map(a => ({ ...a, attack: a.attack + s * 2 }))
  c.spellcasting = creature.spellcasting.map(sc => ({
    ...sc,
    DC: sc.DC !== undefined ? sc.DC + s * 2 : undefined,
    attack: sc.attack !== undefined ? sc.attack + s * 2 : undefined,
  }))
  c.str += s * 2; c.dex += s * 2; c.con += s * 2
  c.int += s * 2; c.wis += s * 2; c.cha += s * 2
  return c
}

// ─────────────────────────────────────────────────────────────────────────────
// PF2eTools ScaleCreature lookup tables (ScaleCreature.js)
// Columns are in descending order: [extreme, high, moderate, low (, terrible)]
// ─────────────────────────────────────────────────────────────────────────────
type Table = Record<string, number[]>

const LvlAbilityMods: Table = {
  "-1": [3,3,2,0], "0": [3,3,2,0], "1": [5,4,3,1], "2": [5,4,3,1],
  "3": [5,4,3,1], "4": [6,5,3,2], "5": [6,5,4,2], "6": [7,5,3,2],
  "7": [7,6,4,2], "8": [7,6,4,3], "9": [7,6,4,3], "10": [8,7,5,3],
  "11": [8,7,5,3], "12": [8,7,5,4], "13": [9,8,5,4], "14": [9,8,5,4],
  "15": [9,8,6,4], "16": [10,9,6,5], "17": [10,9,6,5], "18": [10,9,6,5],
  "19": [11,10,6,5], "20": [11,10,7,6], "21": [11,10,7,6], "22": [11,10,8,6],
  "23": [11,10,8,6], "24": [13,12,9,7], "25": [13,12,9,7],
}

const LvlPerception: Table = {
  "-1": [9,8,5,2,0], "0": [10,9,6,3,1], "1": [11,10,7,4,2], "2": [12,11,8,5,3],
  "3": [14,12,9,6,4], "4": [15,14,11,8,6], "5": [17,15,12,9,7], "6": [18,17,14,11,8],
  "7": [20,18,15,12,10], "8": [21,19,16,13,11], "9": [23,21,18,15,12],
  "10": [24,22,19,16,14], "11": [26,24,21,18,15], "12": [27,25,22,19,16],
  "13": [29,26,23,20,18], "14": [30,28,25,22,19], "15": [32,29,26,23,20],
  "16": [33,30,28,25,22], "17": [35,32,29,26,23], "18": [36,33,30,27,24],
  "19": [38,35,32,29,26], "20": [39,36,33,30,27], "21": [41,38,35,32,28],
  "22": [43,39,36,33,30], "23": [44,40,37,34,31], "24": [46,42,38,36,32],
  "25": [46,42,38,36,32],
}

const LvlSkills: Table = {
  "-1": [8,5,4,2,1], "0": [9,6,5,3,2], "1": [10,7,6,4,3], "2": [11,8,7,5,4],
  "3": [13,10,9,7,5], "4": [15,12,10,8,7], "5": [16,13,12,10,8], "6": [18,15,13,11,9],
  "7": [20,17,15,13,11], "8": [21,18,16,14,12], "9": [23,20,18,16,13],
  "10": [25,22,19,17,15], "11": [26,23,21,19,16], "12": [28,25,22,20,17],
  "13": [30,27,24,22,19], "14": [31,28,25,23,20], "15": [33,30,27,25,21],
  "16": [35,32,28,26,23], "17": [36,33,30,28,24], "18": [38,35,31,29,25],
  "19": [40,37,33,31,27], "20": [41,38,34,32,28], "21": [43,40,36,34,29],
  "22": [45,42,37,35,31], "23": [46,43,38,36,32], "24": [48,45,40,38,33],
  "25": [48,45,40,38,33],
}

const LvlAC: Table = {
  "-1": [18,15,14,12], "0": [19,16,15,13], "1": [19,16,15,13], "2": [21,18,17,15],
  "3": [22,19,18,16], "4": [24,21,20,18], "5": [25,22,21,19], "6": [27,24,23,21],
  "7": [28,25,24,22], "8": [30,27,26,24], "9": [31,28,27,25], "10": [33,30,29,27],
  "11": [34,31,30,28], "12": [36,33,32,30], "13": [37,34,33,31], "14": [39,36,35,33],
  "15": [40,37,36,34], "16": [42,39,38,36], "17": [43,40,39,37], "18": [45,42,41,39],
  "19": [46,43,42,40], "20": [48,45,44,42], "21": [49,46,45,43], "22": [51,48,47,45],
  "23": [52,49,48,46], "24": [54,51,50,48], "25": [54,51,50,48],
}

const LvlSavingThrows: Table = {
  "-1": [9,8,5,2,0], "0": [10,9,6,3,1], "1": [11,10,7,4,2], "2": [12,11,8,5,3],
  "3": [14,12,9,6,4], "4": [15,14,11,8,6], "5": [17,15,12,9,7], "6": [18,17,14,11,8],
  "7": [20,18,15,12,10], "8": [21,19,16,13,11], "9": [23,21,18,15,12],
  "10": [24,22,19,16,14], "11": [26,24,21,18,15], "12": [27,25,22,19,16],
  "13": [29,26,23,20,18], "14": [30,28,25,22,19], "15": [32,29,26,23,20],
  "16": [33,30,28,25,22], "17": [35,32,29,26,23], "18": [36,33,30,27,24],
  "19": [38,35,32,29,26], "20": [39,36,33,30,27], "21": [41,38,35,32,28],
  "22": [43,39,36,33,30], "23": [44,40,37,34,31], "24": [46,42,38,36,32],
  "25": [46,42,38,36,32],
}

// 6 values per level: [extremeHigh, extremeLow, highHigh, highLow, modHigh, modLow]
const LvlHP: Table = {
  "-1": [9,9,8,7,6,5], "0": [20,17,16,14,13,11], "1": [26,24,21,19,16,14],
  "2": [40,36,32,28,25,21], "3": [59,53,48,42,37,31], "4": [78,72,63,57,48,42],
  "5": [97,91,78,72,59,53], "6": [123,115,99,91,75,67], "7": [148,140,119,111,90,82],
  "8": [173,165,139,131,105,97], "9": [198,190,159,151,120,112],
  "10": [223,215,179,171,135,127], "11": [248,240,199,191,150,142],
  "12": [273,265,219,211,165,157], "13": [298,290,239,231,180,172],
  "14": [323,315,259,251,195,187], "15": [348,340,279,271,210,202],
  "16": [373,365,299,291,225,217], "17": [398,390,319,311,240,232],
  "18": [423,415,339,331,255,247], "19": [448,440,359,351,270,262],
  "20": [473,465,379,371,285,277], "21": [505,495,405,395,305,295],
  "22": [544,532,436,424,329,317], "23": [581,569,466,454,351,339],
  "24": [633,617,508,492,383,367], "25": [633,617,508,492,383,367],
}

const LvlResistanceWeakness: Table = {
  "-1": [1,1], "0": [3,1], "1": [3,2], "2": [5,2], "3": [6,3], "4": [7,4],
  "5": [8,4], "6": [9,5], "7": [10,5], "8": [11,6], "9": [12,6], "10": [13,7],
  "11": [14,7], "12": [15,8], "13": [16,8], "14": [17,9], "15": [18,9],
  "16": [19,9], "17": [19,10], "18": [20,10], "19": [21,11], "20": [22,11],
  "21": [23,12], "22": [24,12], "23": [25,13], "24": [26,13], "25": [26,13],
}

const LvlAttackBonus: Table = {
  "-1": [10,8,6,4], "0": [10,8,6,4], "1": [11,9,7,5], "2": [13,11,9,7],
  "3": [14,12,10,8], "4": [16,14,12,9], "5": [17,15,13,11], "6": [19,17,15,12],
  "7": [20,18,16,13], "8": [22,20,18,15], "9": [23,21,19,16], "10": [25,23,21,17],
  "11": [27,24,22,19], "12": [28,26,24,20], "13": [29,27,25,21], "14": [31,29,27,23],
  "15": [32,30,28,24], "16": [34,32,30,25], "17": [35,33,31,27], "18": [37,35,33,28],
  "19": [38,36,34,29], "20": [40,38,36,31], "21": [41,39,37,32], "22": [43,41,39,33],
  "23": [44,42,40,35], "24": [46,44,42,36], "25": [46,44,42,36],
}

const LvlExpectedDamage: Table = {
  "-1": [4,3,3,2], "0": [6,5,4,3], "1": [8,6,5,4], "2": [11,9,8,6],
  "3": [15,12,10,8], "4": [18,14,12,9], "5": [20,16,13,11], "6": [23,18,15,12],
  "7": [25,20,17,13], "8": [28,22,18,15], "9": [30,24,20,16], "10": [33,26,22,17],
  "11": [35,28,23,19], "12": [38,30,25,20], "13": [40,32,27,21], "14": [43,34,28,23],
  "15": [45,36,30,24], "16": [48,37,31,25], "17": [50,38,32,26], "18": [53,40,33,27],
  "19": [55,42,35,28], "20": [58,44,37,29], "21": [60,46,38,31], "22": [63,48,40,32],
  "23": [65,50,42,33], "24": [68,52,44,35], "25": [68,52,44,35],
}

const LvlSpellAtkBonus: Table = {
  "-1": [11,8,5], "0": [11,8,5], "1": [12,9,6], "2": [14,10,7], "3": [15,12,9],
  "4": [17,13,10], "5": [18,14,11], "6": [19,16,13], "7": [21,17,14], "8": [22,18,15],
  "9": [24,20,17], "10": [25,21,18], "11": [26,22,19], "12": [28,24,21],
  "13": [29,25,22], "14": [31,26,23], "15": [32,28,25], "16": [33,29,26],
  "17": [35,30,27], "18": [36,32,29], "19": [38,33,30], "20": [39,34,31],
  "21": [40,36,33], "22": [42,37,34], "23": [43,38,35], "24": [44,40,37],
  "25": [44,40,37],
}

const LvlSpellDC: Table = {
  "-1": [19,16,13], "0": [19,16,13], "1": [20,17,14], "2": [22,18,15], "3": [23,20,17],
  "4": [25,21,18], "5": [26,22,19], "6": [27,24,21], "7": [29,25,22], "8": [30,26,23],
  "9": [32,28,25], "10": [33,29,26], "11": [34,30,27], "12": [36,32,29],
  "13": [37,33,30], "14": [39,34,31], "15": [40,36,33], "16": [41,37,34],
  "17": [43,38,35], "18": [44,40,37], "19": [46,41,38], "20": [47,42,39],
  "21": [48,44,41], "22": [50,45,42], "23": [51,46,43], "24": [52,48,45],
  "25": [52,48,45],
}

// ─────────────────────────────────────────────────────────────────────────────
// Core scaling algorithm (mirrors PF2eTools _scaleValue)
// Finds which adjacent bracket pair the value falls between at lvlIn,
// then maps it proportionally to the same bracket pair at toLvl.
// ─────────────────────────────────────────────────────────────────────────────
function scaleValue(lvlIn: number, toLvl: number, value: number, map: Table, precision = 1): number {
  const clamp = (n: number) => String(Math.max(-1, Math.min(25, Math.round(n))))
  const rangesIn = map[clamp(lvlIn)]
  const toRanges = map[clamp(toLvl)]
  if (!rangesIn || !toRanges) return value

  const lowerIdx = rangesIn.findIndex(it => it < value)
  const revIdx   = [...rangesIn].reverse().findIndex(it => it > value)
  const upperIdx = rangesIn.length - 1 - revIdx   // = rangesIn.length when all values <= value

  const a = lowerIdx !== -1
    ? rangesIn[lowerIdx]
    : value - ((rangesIn[upperIdx] ?? rangesIn[rangesIn.length - 1]) - value)

  const b = upperIdx < rangesIn.length
    ? rangesIn[upperIdx]
    : value + (value - (rangesIn[lowerIdx] ?? rangesIn[0]))

  let c: number, d: number
  if (lowerIdx === -1)
    c = (toRanges[upperIdx] ?? toRanges[toRanges.length - 1]) - (b - a)
  else
    c = toRanges[lowerIdx] ?? toRanges[toRanges.length - 1]

  if (upperIdx >= rangesIn.length)
    d = c + (b - a)
  else
    d = toRanges[upperIdx] ?? toRanges[0]

  if (a === b) return Math.round(precision * c) / precision
  return Math.round(precision * ((value - a) * ((d - c) / (b - a)) + c)) / precision
}

// ─────────────────────────────────────────────────────────────────────────────
// Dice helpers
// ─────────────────────────────────────────────────────────────────────────────
function getDiceEV(expr: string): number {
  // Replace XdY with X*(Y+1)/2, then evaluate simple arithmetic
  const s = expr.replace(/\s+/g, '').replace(/(\d+)d(\d+)/gi, (_, n, d) =>
    String(Number(n) * (Number(d) + 1) / 2))
  // Parse: split on + then handle - within each segment
  let total = 0
  for (const seg of s.split('+')) {
    const parts = seg.split('-')
    total += Number(parts[0]) || 0
    for (let i = 1; i < parts.length; i++) total -= Number(parts[i]) || 0
  }
  return total
}

function scaleDice(formula: string, expectation: number, noMod = false): string {
  if (Math.abs(getDiceEV(formula) - expectation) < 0.01) return formula
  const m = formula.match(/d(\d+)/)
  if (!m) return formula
  const dice = Number(m[1])
  const targetDice = noMod ? expectation : expectation / 2
  const numDice = Math.max(1, Math.round(targetDice * 2 / (dice + 1)))
  const mod = noMod ? 0 : Math.max(0, Math.round(expectation - numDice * (dice + 1) / 2))
  return `${numDice}d${dice}${mod ? `+${mod}` : ''}`
}

function scaleAttackDamage(damage: string, lvlIn: number, toLvl: number): string {
  const diceParts = damage.match(/\d+d\d+[+-]?\d*/g) || []
  const dpr = diceParts.map(getDiceEV).reduce((a, b) => a + b, 0)
  if (dpr === 0) return damage
  const scaledDpr = scaleValue(lvlIn, toLvl, dpr, LvlExpectedDamage, 2)
  return damage.replace(/(\d+d\d+)([+-]?\d*)/g, (formula, _dice, modStr) => {
    const partEV = getDiceEV(formula)
    const scaleTo = partEV * scaledDpr / dpr
    return scaleDice(formula, scaleTo, !modStr)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main level-scaling function (PF2eTools algorithm)
// ─────────────────────────────────────────────────────────────────────────────
export function scaleByLevel(creature: Creature, toLvl: number): Creature {
  const lvlIn = creature.level
  if (lvlIn === toLvl) return creature

  const c: Creature = JSON.parse(JSON.stringify(creature))
  c.level = toLvl

  // Ability mods
  for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
    const mod = creature[ab]
    const diff = toLvl - lvlIn
    if (mod < -3) {
      // extreme penalty — leave alone
    } else if (mod < 0) {
      c[ab] = mod + Math.floor(diff / 5)
    } else {
      c[ab] = Math.round(scaleValue(lvlIn, toLvl, mod, LvlAbilityMods))
    }
  }

  // Perception
  c.perception = Math.round(scaleValue(lvlIn, toLvl, creature.perception, LvlPerception))

  // Skills
  c.skills = Object.fromEntries(
    Object.entries(creature.skills).map(([k, v]) => [
      k, Math.round(scaleValue(lvlIn, toLvl, v, LvlSkills)),
    ])
  )

  // AC
  c.defenses.ac = Math.round(scaleValue(lvlIn, toLvl, creature.defenses.ac, LvlAC))

  // Saving throws
  c.defenses.fort = Math.round(scaleValue(lvlIn, toLvl, creature.defenses.fort, LvlSavingThrows))
  c.defenses.ref  = Math.round(scaleValue(lvlIn, toLvl, creature.defenses.ref,  LvlSavingThrows))
  c.defenses.will = Math.round(scaleValue(lvlIn, toLvl, creature.defenses.will, LvlSavingThrows))

  // HP — round to nearest 5 when > 100
  let hp = scaleValue(lvlIn, toLvl, creature.defenses.hp, LvlHP)
  if (hp > 100) { hp += 2; hp -= hp % 5 }
  c.defenses.hp = Math.max(1, Math.round(hp))

  // Resistances & weaknesses — clamp to a minimum of 1 (like HP above): scaling
  // a low amount far down can round to 0 or negative, which is nonsensical.
  c.defenses.resistances = creature.defenses.resistances.map(r => ({
    ...r, amount: Math.max(1, Math.round(scaleValue(lvlIn, toLvl, r.amount, LvlResistanceWeakness))),
  }))
  c.defenses.weaknesses = creature.defenses.weaknesses.map(w => ({
    ...w, amount: Math.max(1, Math.round(scaleValue(lvlIn, toLvl, w.amount, LvlResistanceWeakness))),
  }))

  // Attacks
  c.attacks = creature.attacks.map(a => ({
    ...a,
    attack: Math.round(scaleValue(lvlIn, toLvl, a.attack, LvlAttackBonus)),
    damage: a.damage ? scaleAttackDamage(a.damage, lvlIn, toLvl) : a.damage,
  }))

  // Spellcasting DC and attack
  c.spellcasting = creature.spellcasting.map(sc => ({
    ...sc,
    DC:     sc.DC     !== undefined ? Math.round(scaleValue(lvlIn, toLvl, sc.DC,     LvlSpellDC))       : undefined,
    attack: sc.attack !== undefined ? Math.round(scaleValue(lvlIn, toLvl, sc.attack, LvlSpellAtkBonus)) : undefined,
  }))

  return c
}
