import { useEffect, useRef, useState } from 'react'
import type { Creature, SpellBlock, SpellSlotEntry } from '../types/pf2e'

// ─────────────────────────────────────────────────────────────────────────────
// Form-based stat-block builder. Lives on the *input* side of the Text
// Converter as an alternative to pasting plain text: every edit rebuilds a
// Creature and emits it through onChange, so the right-pane JSON / Preview
// updates live (no Parse step needed).
//
// Numeric fields are kept as numbers; "list-ish" fields (traits, senses,
// skills, damage adjustments, spell lists) are kept as free text and parsed on
// build — this mirrors exactly what the paste parser produces, so a creature
// can round-trip between the two input modes without drift.
// ─────────────────────────────────────────────────────────────────────────────

let _bid = 0
const bid = () => `b${Date.now().toString(36)}-${++_bid}`

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
const rankLabel = (lvl: number) => (lvl === 0 ? 'Cantrips' : `Level ${lvl}`)
const ordToLevel = (s: string) => { const m = s.match(/\d+/); return m ? parseInt(m[0]) : 0 }

// Split a comma-separated list, but ignore commas inside (parentheses) so a
// note like "fire 5 (except magical)" or "bless (at will)" stays whole.
const splitTop = (s: string): string[] => {
  const out: string[] = []; let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map(x => x.trim()).filter(Boolean)
}

const parseList = (s: string) => splitTop(s)
const listToText = (a?: string[]) => (a ?? []).join(', ')

const parseSkills = (s: string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const part of splitTop(s)) {
    const m = part.match(/^(.+?)\s*([+-]?\d+)$/)
    if (m) out[m[1].trim()] = parseInt(m[2])
  }
  return out
}
const skillsToText = (sk?: Record<string, number>) =>
  Object.entries(sk ?? {}).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')

type DR = { amount: number; name: string; note?: string }
const parseDR = (s: string): DR[] => {
  const out: DR[] = []
  for (const part of splitTop(s)) {
    const m = part.match(/^(.+?)\s+(\d+)\s*(?:\(([^)]*)\))?$/)
    if (m) out.push({ name: m[1].trim(), amount: parseInt(m[2]), note: m[3]?.trim() || undefined })
    else out.push({ name: part, amount: 0 })
  }
  return out
}
const drToText = (a?: DR[]) =>
  (a ?? []).map(d => `${d.name}${d.amount ? ' ' + d.amount : ''}${d.note ? ` (${d.note})` : ''}`).join(', ')

type SpEntry = { name: string; atWill?: boolean; uses?: number }
const parseSpells = (s: string): SpEntry[] =>
  splitTop(s).map(tok => {
    let name = tok, atWill = false, uses: number | undefined
    const paren = name.match(/\(([^)]*)\)\s*$/)
    if (paren) {
      const note = paren[1].toLowerCase()
      if (/at\s*will/.test(note)) atWill = true
      else { const u = note.match(/(\d+)/); if (u) uses = parseInt(u[1]) }
      name = name.slice(0, paren.index).trim()
    }
    const x = name.match(/[×x]\s*(\d+)\s*$/)
    if (x) { uses = parseInt(x[1]); name = name.slice(0, x.index).trim() }
    const e: SpEntry = { name }
    if (atWill) e.atWill = true
    else if (uses) e.uses = uses
    return e
  }).filter(e => e.name)
const spellsToText = (a: SpEntry[]) =>
  a.map(s => s.name + (s.atWill ? ' (at will)' : s.uses ? ` (×${s.uses})` : '')).join(', ')

// ── Editable (string-backed) shapes ──────────────────────────────────────────
interface EAttack { id: string; range: 'Melee' | 'Ranged'; name: string; attack: string; damage: string; traits: string; types: string }
interface EAbility { id: string; name: string; activity: string; traits: string; trigger: string; entries: string }
interface ERank { level: number; text: string }
interface EBlock { id: string; tradition: string; type: string; DC: string; attack: string; focusPoints: string; ranks: ERank[] }
interface ECast { id: string; rank: string; names: string }

const seedBlocks = (sbs?: SpellBlock[]): EBlock[] =>
  (sbs ?? []).map(sb => ({
    id: bid(),
    tradition: sb.tradition ?? '',
    type: sb.type ?? '',
    DC: sb.DC != null ? String(sb.DC) : '',
    attack: sb.attack != null ? String(sb.attack) : '',
    focusPoints: sb.focusPoints != null ? String(sb.focusPoints) : '',
    ranks: (sb.spellsByLevel ?? []).map(sl => ({ level: sl.level, text: spellsToText(sl.spells as SpEntry[]) })),
  }))

// ── Shared styles + tiny presentational helpers (module scope = stable
//    identity, so inputs keep focus across the live re-renders) ───────────────
const inputStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: 'var(--app-bw) solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12,
  padding: '5px 8px', fontFamily: 'var(--font-ui)', width: '100%', outline: 'none',
  boxSizing: 'border-box',
}
const cardStyle: React.CSSProperties = {
  border: 'var(--app-bw) solid var(--border)', borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)', padding: 10, marginBottom: 8,
}
const xBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--danger)', fontSize: 14,
  cursor: 'pointer', padding: '2px 4px', flexShrink: 0, lineHeight: 1,
}
const code: React.CSSProperties = { fontFamily: 'var(--font-mono)', color: 'var(--accent)' }

const Label = ({ children }: { children: React.ReactNode }) => (
  <label style={{ display: 'block', fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 3, letterSpacing: '.02em' }}>{children}</label>
)
const Sec = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent)', margin: '16px 0 8px' }}>{children}</div>
)
const Field = ({ label, children, w }: { label: string; children: React.ReactNode; w?: number | string }) => (
  <div style={{ width: w ?? 'auto', minWidth: 0, marginBottom: 8 }}>
    <Label>{label}</Label>{children}
  </div>
)
const Empty = ({ children }: { children: React.ReactNode }) => (
  <div style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic', padding: '2px 0 8px' }}>{children}</div>
)
const AddBtn = ({ children, onClick, small }: { children: React.ReactNode; onClick: () => void; small?: boolean }) => (
  <button onClick={onClick} style={{
    background: 'transparent', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-sm)',
    color: 'var(--accent)', fontSize: small ? 11.5 : 12, fontFamily: 'var(--font-ui)', fontWeight: 500,
    padding: small ? '4px 10px' : '6px 12px', cursor: 'pointer', marginTop: small ? 2 : 4,
  }}>{children}</button>
)
const Num = ({ v, on, w }: { v: number; on: (n: number) => void; w?: number }) => (
  <input type="number" value={v} onChange={e => on(parseInt(e.target.value) || 0)} style={{ ...inputStyle, width: w ?? '100%' }} />
)
const Txt = ({ v, on, ph }: { v: string; on: (s: string) => void; ph?: string }) => (
  <input value={v} onChange={e => on(e.target.value)} placeholder={ph} style={inputStyle} />
)

type Tab = 'basics' | 'defense' | 'strikes' | 'spells' | 'abilities' | 'description' | 'hazard'
const CREATURE_TABS: [Tab, string][] = [['basics', 'Basics'], ['defense', 'Defense'], ['strikes', 'Strikes'], ['spells', 'Spells'], ['abilities', 'Abilities'], ['description', 'Description']]
const HAZARD_TABS: [Tab, string][] = [['basics', 'Basics'], ['defense', 'Defense'], ['hazard', 'Hazard'], ['strikes', 'Strikes'], ['abilities', 'Abilities']]

const tabStyle = (active: boolean): React.CSSProperties => ({
  background: 'transparent', border: 'none',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  color: active ? 'var(--text)' : 'var(--text-muted)', fontFamily: 'var(--font-ui)',
  fontSize: 12.5, fontWeight: active ? 600 : 500, padding: '7px 11px',
  cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1,
})

interface Props { initial: Creature | null; onChange: (c: Creature) => void }

export function StatBlockBuilder({ initial, onChange }: Props) {
  const base = initial
  const draftId = useRef(initial?.id ?? bid())
  const [tab, setTab] = useState<Tab>('basics')

  const [basic, setBasic] = useState(() => ({
    name: initial?.name ?? '', level: initial?.level ?? 1, perception: initial?.perception ?? 0,
    traits: listToText(initial?.traits), senses: listToText(initial?.senses),
    languages: listToText(initial?.languages), skills: skillsToText(initial?.skills),
    items: listToText(initial?.items),
    str: initial?.str ?? 0, dex: initial?.dex ?? 0, con: initial?.con ?? 0,
    int: initial?.int ?? 0, wis: initial?.wis ?? 0, cha: initial?.cha ?? 0,
    walk: initial?.speed?.walk ?? 25, fly: initial?.speed?.fly ?? 0, swim: initial?.speed?.swim ?? 0,
    burrow: initial?.speed?.burrow ?? 0, climb: initial?.speed?.climb ?? 0,
  }))
  const [def, setDef] = useState(() => ({
    ac: initial?.defenses?.ac ?? 10, fort: initial?.defenses?.fort ?? 0, ref: initial?.defenses?.ref ?? 0,
    will: initial?.defenses?.will ?? 0, hp: initial?.defenses?.hp ?? 10,
    hardness: initial?.defenses?.hardness ?? 0, bt: initial?.defenses?.bt ?? 0,
    immunities: listToText(initial?.defenses?.immunities),
    resistances: drToText(initial?.defenses?.resistances),
    weaknesses: drToText(initial?.defenses?.weaknesses),
  }))
  // Creature ⟷ hazard mode + their distinct extra fields. A creature has a
  // lore "Description" (flavor); a hazard has Stealth/Disable/Routine/Reset/etc.
  const [isHaz, setIsHaz] = useState(initial?.isHazard ?? false)
  const [flavor, setFlavor] = useState(initial?.flavor ?? '')
  const [haz, setHaz] = useState(() => ({
    stealth: initial?.hazardData?.stealth ?? '',
    disable: initial?.hazardData?.disable ?? '',
    description: initial?.hazardData?.description ?? '',
    routine: initial?.hazardData?.routine ?? '',
    reset: initial?.hazardData?.reset ?? '',
    complex: initial?.hazardData?.complex ?? false,
  }))
  const [eAttacks, setEAttacks] = useState<EAttack[]>(() =>
    (initial?.attacks ?? []).map(a => ({
      id: bid(), range: a.range, name: a.name, attack: String(a.attack),
      damage: a.damage, traits: listToText(a.traits), types: listToText(a.types),
    })))
  const [eAbilities, setEAbilities] = useState<EAbility[]>(() =>
    (initial?.abilities ?? []).map(a => ({
      id: bid(), name: a.name, activity: a.activity ?? '', traits: listToText(a.traits),
      trigger: a.trigger ?? '', entries: a.entries,
    })))
  const [blocks, setBlocks] = useState<EBlock[]>(() => seedBlocks(initial?.spellcasting))
  const [ritual, setRitual] = useState(() => ({
    dc: initial?.rituals?.dc != null ? String(initial.rituals.dc) : '',
    casts: (initial?.rituals?.casts ?? []).map(c => ({ id: bid(), rank: c.rank, names: listToText(c.names) }) as ECast),
  }))

  // ── setters ────────────────────────────────────────────────────────────────
  const setB = (patch: Partial<typeof basic>) => setBasic(p => ({ ...p, ...patch }))
  const setD = (patch: Partial<typeof def>) => setDef(p => ({ ...p, ...patch }))
  const setH = (patch: Partial<typeof haz>) => setHaz(p => ({ ...p, ...patch }))
  // Switching mode resets to the Basics tab so we never sit on a now-hidden tab.
  const toggleMode = (hazard: boolean) => { setIsHaz(hazard); setTab('basics') }
  const setAtk = (id: string, patch: Partial<EAttack>) => setEAttacks(p => p.map(a => a.id === id ? { ...a, ...patch } : a))
  const addAtk = () => setEAttacks(p => [...p, { id: bid(), range: 'Melee', name: '', attack: '', damage: '', traits: '', types: '' }])
  const delAtk = (id: string) => setEAttacks(p => p.filter(a => a.id !== id))
  const setAb = (id: string, patch: Partial<EAbility>) => setEAbilities(p => p.map(a => a.id === id ? { ...a, ...patch } : a))
  const addAb = () => setEAbilities(p => [...p, { id: bid(), name: '', activity: '', traits: '', trigger: '', entries: '' }])
  const delAb = (id: string) => setEAbilities(p => p.filter(a => a.id !== id))
  const setBlk = (id: string, patch: Partial<EBlock>) => setBlocks(p => p.map(b => b.id === id ? { ...b, ...patch } : b))
  const addBlk = () => setBlocks(p => [...p, { id: bid(), tradition: 'arcane', type: 'Innate', DC: '', attack: '', focusPoints: '', ranks: [{ level: 0, text: '' }] }])
  const delBlk = (id: string) => setBlocks(p => p.filter(b => b.id !== id))
  const setRank = (id: string, i: number, patch: Partial<ERank>) => setBlocks(p => p.map(b => b.id === id ? { ...b, ranks: b.ranks.map((r, j) => j === i ? { ...r, ...patch } : r) } : b))
  const addRank = (id: string) => setBlocks(p => p.map(b => b.id === id ? { ...b, ranks: [...b.ranks, { level: 1, text: '' }] } : b))
  const delRank = (id: string, i: number) => setBlocks(p => p.map(b => b.id === id ? { ...b, ranks: b.ranks.filter((_, j) => j !== i) } : b))
  const setRit = (patch: Partial<typeof ritual>) => setRitual(p => ({ ...p, ...patch }))
  const setCast = (id: string, patch: Partial<ECast>) => setRitual(p => ({ ...p, casts: p.casts.map(c => c.id === id ? { ...c, ...patch } : c) }))
  const addCast = () => setRitual(p => ({ ...p, casts: [...p.casts, { id: bid(), rank: '', names: '' }] }))
  const delCast = (id: string) => setRitual(p => ({ ...p, casts: p.casts.filter(c => c.id !== id) }))

  // ── build a Creature from the form + emit on every change ────────────────────
  const buildBlock = (b: EBlock): SpellBlock => {
    const tradition = b.tradition.trim(), type = b.type.trim()
    const name = [cap(tradition), cap(type), 'Spells'].filter(Boolean).join(' ')
    const spellsByLevel: SpellSlotEntry[] = b.ranks
      .filter(r => r.text.trim())
      .slice()
      .sort((x, y) => (x.level === 0 ? -1 : y.level === 0 ? 1 : x.level - y.level))
      .map(r => ({
        label: rankLabel(r.level), level: r.level,
        ...(r.level === 0 ? { isCantrip: true } : {}),
        spells: parseSpells(r.text),
      }))
    const isFocus = type.toLowerCase() === 'focus'
    return {
      name: name || 'Spells', type, tradition: tradition || undefined,
      DC: b.DC.trim() ? parseInt(b.DC) : undefined,
      attack: b.attack.trim() ? parseInt(b.attack) : undefined,
      ...(isFocus && b.focusPoints.trim() ? { focusPoints: parseInt(b.focusPoints) } : {}),
      spells: '', spellsByLevel,
    }
  }

  const build = (): Creature => {
    const num = (v: number | string, d = 0) => { const n = parseInt(String(v)); return isNaN(n) ? d : n }
    const speed: Creature['speed'] = {}
    if (basic.walk) speed.walk = basic.walk
    if (basic.fly) speed.fly = basic.fly
    if (basic.swim) speed.swim = basic.swim
    if (basic.burrow) speed.burrow = basic.burrow
    if (basic.climb) speed.climb = basic.climb
    const spellcasting = blocks.map(buildBlock).filter(b => b.spellsByLevel.length > 0)
    const ritualCasts = ritual.casts.filter(c => c.names.trim())
    return {
      ...(base ?? {}),
      id: base?.id ?? draftId.current,
      name: basic.name.trim() || (isHaz ? 'Unnamed Hazard' : 'Unnamed Creature'),
      source: base?.source ?? 'Custom',
      level: num(basic.level, 1),
      traits: parseList(basic.traits),
      // Creature lore blurb (Description tab). Hazards use hazardData.description
      // instead, so keep any passthrough flavor untouched in hazard mode.
      flavor: isHaz ? base?.flavor : (flavor.trim() || undefined),
      // Creature-only stats are zeroed for hazards (the stat block hides them).
      perception: isHaz ? 0 : num(basic.perception),
      senses: isHaz ? [] : parseList(basic.senses),
      languages: isHaz ? [] : parseList(basic.languages),
      skills: isHaz ? {} : parseSkills(basic.skills),
      str: isHaz ? 0 : num(basic.str), dex: isHaz ? 0 : num(basic.dex), con: isHaz ? 0 : num(basic.con),
      int: isHaz ? 0 : num(basic.int), wis: isHaz ? 0 : num(basic.wis), cha: isHaz ? 0 : num(basic.cha),
      items: isHaz ? [] : parseList(basic.items),
      speed: isHaz ? {} : speed,
      attacks: eAttacks.filter(a => a.name.trim()).map(a => ({
        range: a.range, name: a.name.trim(), attack: num(a.attack),
        traits: parseList(a.traits), damage: a.damage.trim(),
        types: parseList(a.types), effects: [], isAgile: /\bagile\b/i.test(a.traits),
      })),
      spellcasting: isHaz ? [] : spellcasting,
      rituals: !isHaz && ritualCasts.length ? {
        dc: ritual.dc.trim() ? num(ritual.dc) : undefined,
        casts: ritualCasts.map(c => ({ rank: c.rank.trim(), level: ordToLevel(c.rank), names: parseList(c.names) })),
      } : undefined,
      abilities: eAbilities.filter(a => a.name.trim()).map(a => ({
        name: a.name.trim(), activity: a.activity || undefined,
        traits: parseList(a.traits), trigger: a.trigger.trim() || undefined,
        entries: a.entries,
      })),
      defenses: {
        ac: num(def.ac, 10), fort: num(def.fort), ref: num(def.ref), will: num(def.will),
        hp: num(def.hp, 1),
        hardness: def.hardness ? num(def.hardness) : undefined,
        bt: isHaz && def.bt ? num(def.bt) : undefined,
        immunities: parseList(def.immunities),
        resistances: parseDR(def.resistances),
        weaknesses: parseDR(def.weaknesses),
      },
      isHazard: isHaz,
      hazardData: isHaz ? {
        stealth: haz.stealth.trim() || '—',
        description: haz.description.trim(),
        disable: haz.disable.trim(),
        routine: haz.routine.trim(),
        reset: haz.reset.trim(),
        complex: haz.complex,
      } : undefined,
      raw: base?.raw ?? ({} as Creature['raw']),
    }
  }

  useEffect(() => {
    onChange(build())
    // Rebuild whenever any form section changes. onChange is intentionally
    // excluded — it's a stable setter and including build() would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basic, def, eAttacks, eAbilities, blocks, ritual, isHaz, flavor, haz])

  // ── render ───────────────────────────────────────────────────────────────────
  const segStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '5px 0', fontSize: 11.5, fontWeight: 600,
    fontFamily: 'var(--font-ui)', cursor: 'pointer', border: 'none',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: 'var(--bg-base)' }}>
      {/* Creature ⟷ hazard mode toggle */}
      <div style={{ display: 'flex', margin: '8px 12px 2px', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', flexShrink: 0 }}>
        <button style={segStyle(!isHaz)} onClick={() => toggleMode(false)}>⚔ Creature</button>
        <button style={segStyle(isHaz)} onClick={() => toggleMode(true)}>⚠ Hazard</button>
      </div>
      <div style={{ display: 'flex', gap: 2, padding: '6px 10px 0', borderBottom: 'var(--app-bw) solid var(--border)', flexShrink: 0, overflowX: 'auto' }}>
        {(isHaz ? HAZARD_TABS : CREATURE_TABS).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={tabStyle(tab === k)}>{label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px 24px' }}>

        {tab === 'basics' && (
          <>
            <Field label="Name" w="100%"><Txt v={basic.name} on={v => setB({ name: v })} ph={isHaz ? 'Spiked Pit' : 'Ancient Red Dragon'} /></Field>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Field label="Level" w={80}><Num v={basic.level} on={n => setB({ level: n })} /></Field>
              {!isHaz && <Field label="Perception" w={110}><Num v={basic.perception} on={n => setB({ perception: n })} /></Field>}
            </div>
            <Field label="Traits" w="100%"><Txt v={basic.traits} on={v => setB({ traits: v })} ph={isHaz ? 'trap, mechanical, magical' : 'dragon, fire, gargantuan, CE'} /></Field>

            {!isHaz && (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Field label="Senses" w="47%"><Txt v={basic.senses} on={v => setB({ senses: v })} ph="darkvision, scent (imprecise) 60 ft" /></Field>
                  <Field label="Languages" w="47%"><Txt v={basic.languages} on={v => setB({ languages: v })} ph="Common, Draconic" /></Field>
                </div>
                <Field label="Skills" w="100%"><Txt v={basic.skills} on={v => setB({ skills: v })} ph="Acrobatics +32, Intimidation +35" /></Field>

                <Sec>Ability modifiers</Sec>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {([['Str', 'str'], ['Dex', 'dex'], ['Con', 'con'], ['Int', 'int'], ['Wis', 'wis'], ['Cha', 'cha']] as const).map(([lbl, key]) => (
                    <div key={key} style={{ width: 56 }}>
                      <Label>{lbl}</Label>
                      <Num v={basic[key]} on={n => setB({ [key]: n } as Partial<typeof basic>)} />
                    </div>
                  ))}
                </div>

                <Sec>Speed (ft)</Sec>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {([['Walk', 'walk'], ['Fly', 'fly'], ['Swim', 'swim'], ['Burrow', 'burrow'], ['Climb', 'climb']] as const).map(([lbl, key]) => (
                    <div key={key} style={{ width: 66 }}>
                      <Label>{lbl}</Label>
                      <Num v={basic[key]} on={n => setB({ [key]: n } as Partial<typeof basic>)} />
                    </div>
                  ))}
                </div>

                <Sec>Items</Sec>
                <Txt v={basic.items} on={v => setB({ items: v })} ph="+3 greatsword, breastplate" />
              </>
            )}
          </>
        )}

        {tab === 'defense' && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Field label="AC" w={80}><Num v={def.ac} on={n => setD({ ac: n })} /></Field>
              <Field label="HP" w={90}><Num v={def.hp} on={n => setD({ hp: n })} /></Field>
              <Field label="Hardness" w={90}><Num v={def.hardness} on={n => setD({ hardness: n })} /></Field>
              {isHaz && <Field label="Broken Threshold" w={120}><Num v={def.bt} on={n => setD({ bt: n })} /></Field>}
            </div>
            <Sec>Saving throws</Sec>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Field label="Fortitude" w={90}><Num v={def.fort} on={n => setD({ fort: n })} /></Field>
              <Field label="Reflex" w={90}><Num v={def.ref} on={n => setD({ ref: n })} /></Field>
              <Field label="Will" w={90}><Num v={def.will} on={n => setD({ will: n })} /></Field>
            </div>
            <Sec>Damage adjustments</Sec>
            <Field label="Immunities" w="100%"><Txt v={def.immunities} on={v => setD({ immunities: v })} ph="fire, paralyzed, sleep" /></Field>
            <Field label="Resistances" w="100%"><Txt v={def.resistances} on={v => setD({ resistances: v })} ph="physical 15 (except adamantine), cold 10" /></Field>
            <Field label="Weaknesses" w="100%"><Txt v={def.weaknesses} on={v => setD({ weaknesses: v })} ph="cold iron 15, good 10" /></Field>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 6 }}>
              Format <span style={code}>type amount</span>, comma-separated — e.g. <span style={code}>fire 10, physical 5 (except silver)</span>.
            </p>
          </>
        )}

        {tab === 'strikes' && (
          <>
            {eAttacks.length === 0 && <Empty>No strikes yet — add the creature's melee and ranged attacks.</Empty>}
            {eAttacks.map(a => (
              <div key={a.id} style={cardStyle}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <select style={{ ...inputStyle, width: 86 }} value={a.range} onChange={e => setAtk(a.id, { range: e.target.value as 'Melee' | 'Ranged' })}>
                    <option>Melee</option><option>Ranged</option>
                  </select>
                  <input style={{ ...inputStyle, flex: 1 }} value={a.name} placeholder="jaws" onChange={e => setAtk(a.id, { name: e.target.value })} />
                  <input style={{ ...inputStyle, width: 64 }} type="number" value={a.attack} placeholder="+0" onChange={e => setAtk(a.id, { attack: e.target.value })} />
                  <button onClick={() => delAtk(a.id)} style={xBtn} title="Remove strike">✕</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 110px' }}><Label>Damage</Label><input style={inputStyle} value={a.damage} placeholder="4d12+22" onChange={e => setAtk(a.id, { damage: e.target.value })} /></div>
                  <div style={{ flex: '1 1 90px' }}><Label>Damage types</Label><input style={inputStyle} value={a.types} placeholder="piercing, fire" onChange={e => setAtk(a.id, { types: e.target.value })} /></div>
                  <div style={{ flex: '1 1 90px' }}><Label>Traits</Label><input style={inputStyle} value={a.traits} placeholder="agile, reach 20 ft" onChange={e => setAtk(a.id, { traits: e.target.value })} /></div>
                </div>
              </div>
            ))}
            <AddBtn onClick={addAtk}>+ Add strike</AddBtn>
          </>
        )}

        {tab === 'spells' && (
          <>
            {blocks.length === 0 && <Empty>No spellcasting yet. Add a list for innate, prepared, spontaneous, or focus spells.</Empty>}
            {blocks.map(b => (
              <div key={b.id} style={cardStyle}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  <select style={{ ...inputStyle, width: 96 }} value={b.tradition} onChange={e => setBlk(b.id, { tradition: e.target.value })}>
                    {['arcane', 'divine', 'occult', 'primal'].map(t => <option key={t} value={t}>{cap(t)}</option>)}
                  </select>
                  <select style={{ ...inputStyle, width: 116 }} value={b.type} onChange={e => setBlk(b.id, { type: e.target.value })}>
                    {['Innate', 'Prepared', 'Spontaneous', 'Focus'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => delBlk(b.id)} style={xBtn} title="Remove spell list">✕</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={{ width: 70 }}><Label>DC</Label><input style={inputStyle} type="number" value={b.DC} onChange={e => setBlk(b.id, { DC: e.target.value })} /></div>
                  <div style={{ width: 80 }}><Label>Attack</Label><input style={inputStyle} type="number" value={b.attack} placeholder="+0" onChange={e => setBlk(b.id, { attack: e.target.value })} /></div>
                  {b.type.toLowerCase() === 'focus' && (
                    <div style={{ width: 90 }}><Label>Focus pts</Label><input style={inputStyle} type="number" value={b.focusPoints} onChange={e => setBlk(b.id, { focusPoints: e.target.value })} /></div>
                  )}
                </div>
                {b.ranks.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                    <select style={{ ...inputStyle, width: 100 }} value={r.level} onChange={e => setRank(b.id, i, { level: parseInt(e.target.value) })}>
                      <option value={0}>Cantrips</option>
                      {Array.from({ length: 10 }, (_, k) => k + 1).map(l => <option key={l} value={l}>{ordinal(l)} rank</option>)}
                    </select>
                    <input style={{ ...inputStyle, flex: 1 }} value={r.text} placeholder="fireball, heal (×3), light (at will)" onChange={e => setRank(b.id, i, { text: e.target.value })} />
                    <button onClick={() => delRank(b.id, i)} style={xBtn} title="Remove rank">✕</button>
                  </div>
                ))}
                <AddBtn small onClick={() => addRank(b.id)}>+ Add rank</AddBtn>
              </div>
            ))}
            <AddBtn onClick={addBlk}>+ Add spell list</AddBtn>

            <Sec>Rituals (optional)</Sec>
            <div style={{ width: 80, marginBottom: 8 }}><Label>DC</Label><input style={inputStyle} type="number" value={ritual.dc} onChange={e => setRit({ dc: e.target.value })} /></div>
            {ritual.casts.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                <input style={{ ...inputStyle, width: 70 }} value={c.rank} placeholder="2nd" onChange={e => setCast(c.id, { rank: e.target.value })} />
                <input style={{ ...inputStyle, flex: 1 }} value={c.names} placeholder="inveigle, blink charge" onChange={e => setCast(c.id, { names: e.target.value })} />
                <button onClick={() => delCast(c.id)} style={xBtn} title="Remove ritual">✕</button>
              </div>
            ))}
            <AddBtn small onClick={addCast}>+ Add ritual</AddBtn>

            <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 10 }}>
              Mark innate at-will spells with <span style={code}>(at will)</span> after the name; repeated prepared/innate uses as <span style={code}>(×3)</span>.
            </p>
          </>
        )}

        {tab === 'abilities' && (
          <>
            {eAbilities.length === 0 && <Empty>No abilities yet — add auras, reactions, and special actions.</Empty>}
            {eAbilities.map(a => (
              <div key={a.id} style={cardStyle}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <input style={{ ...inputStyle, flex: 1 }} value={a.name} placeholder="Frightful Presence" onChange={e => setAb(a.id, { name: e.target.value })} />
                  <select style={{ ...inputStyle, width: 132 }} value={a.activity} onChange={e => setAb(a.id, { activity: e.target.value })}>
                    <option value="">— passive —</option>
                    <option value="◆">◆ One action</option>
                    <option value="◆◆">◆◆ Two actions</option>
                    <option value="◆◆◆">◆◆◆ Three actions</option>
                    <option value="↺">↺ Reaction</option>
                    <option value="◇">◇ Free action</option>
                  </select>
                  <button onClick={() => delAb(a.id)} style={xBtn} title="Remove ability">✕</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  <div style={{ flex: '1 1 120px' }}><Label>Traits</Label><input style={inputStyle} value={a.traits} placeholder="aura, emotion, fear, mental" onChange={e => setAb(a.id, { traits: e.target.value })} /></div>
                  <div style={{ flex: '1 1 120px' }}><Label>Trigger (reactions)</Label><input style={inputStyle} value={a.trigger} placeholder="A creature ends its turn within 30 ft" onChange={e => setAb(a.id, { trigger: e.target.value })} /></div>
                </div>
                <Label>Description</Label>
                <textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} value={a.entries} placeholder="What the ability does. Inline dice like 2d6 become clickable rollers." onChange={e => setAb(a.id, { entries: e.target.value })} />
              </div>
            ))}
            <AddBtn onClick={addAb}>+ Add ability</AddBtn>
          </>
        )}

        {tab === 'description' && (
          <>
            <Label>Description / lore</Label>
            <textarea
              value={flavor} onChange={e => setFlavor(e.target.value)}
              placeholder="Flavor text for the creature's Description page — its lore, appearance, behaviour, ecology. Leave blank for none."
              style={{ ...inputStyle, minHeight: 220, resize: 'vertical', lineHeight: 1.6 }}
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 8 }}>
              Anything here becomes the creature's <span style={code}>Description</span> page — open it with the “Description” button next to Notes on the stat block. Recall Knowledge lines are stripped automatically (they already appear on the stat block).
            </p>
          </>
        )}

        {tab === 'hazard' && (
          <>
            <Field label="Stealth" w="100%"><Txt v={haz.stealth} on={v => setH({ stealth: v })} ph="+18 (or DC 28; trained)" /></Field>
            <Field label="Disable" w="100%"><Txt v={haz.disable} on={v => setH({ disable: v })} ph="DC 28 Thievery (expert) to disarm the trigger" /></Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text)', margin: '8px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={haz.complex} onChange={e => setH({ complex: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
              Complex hazard — rolls initiative and has a Routine
            </label>
            <Sec>Description</Sec>
            <textarea value={haz.description} onChange={e => setH({ description: e.target.value })} placeholder="What the hazard looks like and does (shown at the top of the hazard)." style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} />
            {haz.complex && (
              <>
                <Sec>Routine</Sec>
                <textarea value={haz.routine} onChange={e => setH({ routine: e.target.value })} placeholder="(2 actions) On each of its turns the hazard… (complex hazards only)." style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} />
              </>
            )}
            <Sec>Reset</Sec>
            <textarea value={haz.reset} onChange={e => setH({ reset: e.target.value })} placeholder="How the hazard resets after being triggered (optional)." style={{ ...inputStyle, minHeight: 48, resize: 'vertical' }} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 8 }}>
              Use the <span style={code}>Strikes</span> and <span style={code}>Abilities</span> tabs for the hazard's attacks and reactions (e.g. a Reactive Strike).
            </p>
          </>
        )}

      </div>
    </div>
  )
}
