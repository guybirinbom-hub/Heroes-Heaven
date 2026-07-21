import type { DiceResult } from '../types/pf2e'

let _id = 0

export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1
}

export function parseDice(expr: string): { count: number; sides: number; flat: number } {
  const clean = expr.replace(/\s/g, '').toLowerCase()
  const m = clean.match(/^(\d+)d(\d+)([+-]\d+)?$/)
  if (m) return { count: parseInt(m[1]), sides: parseInt(m[2]), flat: m[3] ? parseInt(m[3]) : 0 }
  const flat = parseInt(clean)
  return { count: 0, sides: 0, flat: isNaN(flat) ? 0 : flat }
}

export function rollDamage(expr: string): { rolls: number[]; total: number } {
  const { count, sides, flat } = parseDice(expr)
  const rolls: number[] = []
  for (let i = 0; i < count; i++) rolls.push(rollDie(sides))
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) + flat }
}

export function rollAttack(label: string, bonus: number, mapPenaltyVal: number): DiceResult {
  const die = rollDie(20)
  const total = die + bonus + mapPenaltyVal
  return {
    id: String(++_id),
    label,
    rolls: [die],
    total,
    modifier: bonus + mapPenaltyVal,
    isCrit: die === 20,
    isFumble: die === 1,
    isAttack: true,
    timestamp: Date.now(),
  }
}

export function rollDamageExpr(expr: string, label = 'Damage'): DiceResult {
  const clean = cleanDamageExpr(expr)
  const parts = clean.split(/\s*plus\s*/i)
  let allRolls: number[] = []
  let total = 0
  for (const part of parts) {
    const dMatch = part.match(/(\d+d\d+(?:[+-]\d+)?)/i)
    if (dMatch) {
      const { rolls, total: t } = rollDamage(dMatch[1])
      allRolls = allRolls.concat(rolls)
      total += t
    }
  }
  return {
    id: String(++_id),
    label,
    rolls: allRolls,
    total,
    modifier: 0,
    isCrit: false,
    isFumble: false,
    isAttack: false,
    timestamp: Date.now(),
  }
}

export function cleanDamageExpr(raw: string): string {
  return raw
    .replace(/\{@damage\s+([^}]+)\}/gi, '$1')
    .replace(/\{@[a-z]+\s+([^}|]+)(?:\|[^}]*)?\}/gi, '$1')
    .trim()
}

export function mapPenalty(attackNumber: number, isAgile: boolean): number {
  if (attackNumber <= 1) return 0
  if (attackNumber === 2) return isAgile ? -4 : -5
  return isAgile ? -8 : -10
}

export function fmtBonus(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`
}
