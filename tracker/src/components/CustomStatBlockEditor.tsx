import { useState } from 'react'
import type { Creature, Attack, Ability } from '../types/pf2e'
import { saveCustomCreature } from '../data/dataStore'
import { useCombatStore } from '../store/combatStore'

let _id = 0
const uid = () => `custom-${Date.now()}-${++_id}`

// ── Help dialog ────────────────────────────────────────────────────────────
// Reachable from the "?" button at the bottom-left of the editor. Walks the
// user through the form fields AND shows a worked example of what the Text
// Converter expects so they can decide which workflow to use.
function CustomCharacterHelpModal({ onClose }: { onClose: () => void }) {
  const sec: React.CSSProperties = {
    fontFamily: 'var(--font-display)', fontVariationSettings: '"opsz" 72',
    fontWeight: 600, fontSize: 14, color: 'var(--accent)',
    marginTop: 16, marginBottom: 6, letterSpacing: '-0.01em',
  }
  const body: React.CSSProperties = {
    fontFamily: 'var(--font-ui)', fontSize: 12.5, lineHeight: 1.55,
    color: 'var(--text)',
  }
  const muted: React.CSSProperties = { ...body, color: 'var(--text-muted)' }
  const pre: React.CSSProperties = {
    background: 'var(--bg-elevated)',
    border: 'var(--app-bw) solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5, lineHeight: 1.6,
    color: 'var(--text)',
    whiteSpace: 'pre-wrap',
    overflowX: 'auto',
    marginTop: 6, marginBottom: 4,
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()} style={{ zIndex: 10001 }}>
      <div className="modal-box" style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', padding: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: 'var(--app-bw) solid var(--border)',
          background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
          position: 'sticky', top: 0, zIndex: 1,
        }}>
          <h2 style={{
            margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600,
            fontSize: 17, color: 'var(--text)', letterSpacing: '-0.01em',
          }}>Creating a Custom Character</h2>
          <button onClick={onClose} className="ico-btn" style={{ width: 28, height: 28 }}>✕</button>
        </div>

        <div style={{ padding: '4px 22px 22px' }}>
          <div style={sec}>Two ways to add a character</div>
          <p style={body}>
            You can <strong style={{ color: 'var(--text)' }}>fill out this form by hand</strong> for quick
            custom NPCs, or <strong style={{ color: 'var(--text)' }}>paste a full stat block</strong> into
            the Text Converter (the wand-icon button) and let the app parse
            it. The converter is faster when you already have a stat block
            from AoN or a published adventure.
          </p>

          <div style={sec}>Form fields</div>
          <ul style={{ ...body, marginLeft: 18, padding: 0 }}>
            <li><strong style={{ color: 'var(--accent)' }}>Name</strong> — required, the display name shown in the tracker.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Level</strong> — creature level (-1 to 25 supported).</li>
            <li><strong style={{ color: 'var(--accent)' }}>Traits</strong> — comma-separated, e.g. <em>Humanoid, Goblin, Small, CE</em>. Used for filtering and Monster Parts.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Ability modifiers</strong> — the standard PF2e -5 to +10 scale.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Perception / Speed</strong> — Perception is the bonus (Wisdom + proficiency). Speed is walk speed in feet.</li>
            <li><strong style={{ color: 'var(--accent)' }}>AC / Fort / Ref / Will / HP</strong> — defenses.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Attacks</strong> — one row per Strike. Damage uses dice notation: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>2d6+4</code>.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Abilities &amp; Actions</strong> — name + description for special abilities. Inline dice expressions like <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>1d6</code> will be clickable rollers in the stat block.</li>
          </ul>

          <div style={sec}>Cooldowns in ability text</div>
          <p style={body}>
            Phrasing matters: if your ability text says <em>"can't use again for 1d4 rounds"</em>, that <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>1d4</code> becomes a green cooldown roller. Clicking it auto-applies a condition named after the ability for the rolled number of rounds — and the condition's hover tooltip shows the ability text. Damage dice followed by other words (e.g. "1d6 fire damage") behave normally.
          </p>

          <div style={sec}>Text Converter format</div>
          <p style={muted}>
            The Converter recognizes the standard Paizo / AoN stat block
            layout. You can paste straight from a PDF or AoN — minor variations
            in spacing are tolerated. Here's a minimal example:
          </p>
          <pre style={pre}>{`Goblin Warrior CREATURE 1
CE SMALL GOBLIN HUMANOID
Perception +3; darkvision
Languages Goblin
Skills Acrobatics +5, Stealth +5
Str -1, Dex +3, Con +1, Int -1, Wis +0, Cha +0
Items dogslicer, leather armor

AC 16; Fort +6, Ref +8, Will +3
HP 12

Speed 25 feet

Melee [one action] dogslicer +7 (agile, finesse),
  Damage 1d6-1 slashing

Goblin Scuttle [reaction] Trigger An ally ends a move
  action adjacent to the goblin; Effect The goblin Steps.`}</pre>

          <div style={sec}>Format rules</div>
          <ul style={{ ...body, marginLeft: 18, padding: 0 }}>
            <li><strong style={{ color: 'var(--accent)' }}>First line</strong>: <code style={{ fontFamily: 'var(--font-mono)' }}>Name CREATURE &lt;level&gt;</code>. Level can be negative (e.g. <code style={{ fontFamily: 'var(--font-mono)' }}>CREATURE -1</code>).</li>
            <li><strong style={{ color: 'var(--accent)' }}>Second line</strong>: alignment + size + traits, all uppercase, space-separated. e.g. <code style={{ fontFamily: 'var(--font-mono)' }}>CE SMALL GOBLIN HUMANOID</code>.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Action glyphs</strong>: <code style={{ fontFamily: 'var(--font-mono)' }}>[one action]</code> / <code style={{ fontFamily: 'var(--font-mono)' }}>[two actions]</code> / <code style={{ fontFamily: 'var(--font-mono)' }}>[three actions]</code> / <code style={{ fontFamily: 'var(--font-mono)' }}>[reaction]</code> / <code style={{ fontFamily: 'var(--font-mono)' }}>[free action]</code>. Both the bracket form and the AoN single-glyph form (◆ ◆◆ ◆◆◆ ↺ ◇) are accepted.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Attacks</strong>: <code style={{ fontFamily: 'var(--font-mono)' }}>Melee [action] &lt;name&gt; +&lt;bonus&gt; (&lt;traits&gt;), Damage &lt;dice&gt; &lt;type&gt;</code>. <code style={{ fontFamily: 'var(--font-mono)' }}>Ranged</code> works the same way.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Abilities</strong>: <code style={{ fontFamily: 'var(--font-mono)' }}>Name [action] (&lt;traits&gt;) Trigger …; Effect …</code>. Trigger and Effect headers are detected automatically.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Spellcasting</strong>: lines like <code style={{ fontFamily: 'var(--font-mono)' }}>Arcane Innate Spells DC 19, attack +9; 3rd fireball; Cantrips (3rd) light, mage hand</code>.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Saving throws</strong> & damage types use the standard PF2e words: <em>fire, cold, acid, slashing, piercing, bludgeoning, mental, …</em></li>
          </ul>

          <div style={sec}>Tips</div>
          <ul style={{ ...body, marginLeft: 18, padding: 0 }}>
            <li>The Converter previews the parsed result before saving — verify the stat block looks right, then click <strong style={{ color: 'var(--text)' }}>Save</strong>.</li>
            <li>Custom creatures live in your local browser storage. They're searchable from the Add Creature dialog and survive app restarts. They can also be exported as part of an encounter.</li>
            <li>You can edit a custom creature later: open it from the search list, right-click → Edit.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

interface Props { onClose: () => void; existing?: Creature }

export function CustomStatBlockEditor({ onClose, existing }: Props) {
  const { addCombatant } = useCombatStore()
  const [showHelp, setShowHelp] = useState(false)
  // Pick mode at the top of the form. Hazards have a different set of
  // relevant fields (stealth, disable, hardness, BT, complex) and skip the
  // creature-only ones (ability mods, skills, languages, items).
  const [type, setType] = useState<'creature' | 'hazard'>(existing?.isHazard ? 'hazard' : 'creature')
  const isHaz = type === 'hazard'
  const [name, setName] = useState(existing?.name ?? '')
  const [level, setLevel] = useState(existing?.level ?? 1)
  const [traits, setTraits] = useState(existing?.traits.join(', ') ?? '')
  const [perception, setPerception] = useState(existing?.perception ?? 0)
  const [ac, setAc] = useState(existing?.defenses.ac ?? 10)
  const [fort, setFort] = useState(existing?.defenses.fort ?? 0)
  const [ref, setRef] = useState(existing?.defenses.ref ?? 0)
  const [will, setWill] = useState(existing?.defenses.will ?? 0)
  const [hp, setHp] = useState(existing?.defenses.hp ?? 10)
  const [speed, setSpeed] = useState(existing?.speed.walk ?? 25)
  const [str, setStr] = useState(existing?.str ?? 0)
  const [dex, setDex] = useState(existing?.dex ?? 0)
  const [con, setCon] = useState(existing?.con ?? 0)
  const [int, setInt] = useState(existing?.int ?? 0)
  const [wis, setWis] = useState(existing?.wis ?? 0)
  const [cha, setCha] = useState(existing?.cha ?? 0)

  // Hazard-only fields
  const [stealth, setStealth] = useState(existing?.hazardData?.stealth ?? '')
  const [disable, setDisable] = useState(existing?.hazardData?.disable ?? '')
  const [description, setDescription] = useState(existing?.hazardData?.description ?? '')
  const [routine, setRoutine] = useState(existing?.hazardData?.routine ?? '')
  const [reset, setReset] = useState(existing?.hazardData?.reset ?? '')
  const [complex, setComplex] = useState(existing?.hazardData?.complex ?? false)
  const [hardness, setHardness] = useState(existing?.defenses.hardness ?? 0)
  const [bt, setBt] = useState(existing?.defenses.bt ?? 0)

  // Attacks
  const [attacks, setAttacks] = useState<Attack[]>(existing?.attacks ?? [])
  const [newAtk, setNewAtk] = useState({ range:'Melee' as 'Melee'|'Ranged', name:'', attack:0, damage:'', traits:'', types:'' })

  // Abilities
  const [abilities, setAbilities] = useState<Ability[]>(existing?.abilities ?? [])
  const [newAb, setNewAb] = useState({ name:'', entries:'' })

  const addAttack = () => {
    if (!newAtk.name) return
    setAttacks(prev => [...prev, {
      range: newAtk.range, name: newAtk.name, attack: newAtk.attack,
      traits: newAtk.traits ? newAtk.traits.split(',').map(s=>s.trim()) : [],
      damage: newAtk.damage, types: newAtk.types ? newAtk.types.split(',').map(s=>s.trim()) : [],
      effects: [], isAgile: newAtk.traits.toLowerCase().includes('agile'),
    }])
    setNewAtk({ range:'Melee', name:'', attack:0, damage:'', traits:'', types:'' })
  }

  const addAbility = () => {
    if (!newAb.name) return
    setAbilities(prev => [...prev, { name: newAb.name, traits:[], entries: newAb.entries }])
    setNewAb({ name:'', entries:'' })
  }

  const buildCreature = (): Creature => ({
    id: existing?.id ?? uid(),
    name, source: 'Custom', level,
    traits: traits ? traits.split(',').map(s => s.trim()) : [],
    perception: isHaz ? 0 : perception,
    senses: [], languages: [], skills: {},
    str: isHaz ? 0 : str, dex: isHaz ? 0 : dex, con: isHaz ? 0 : con,
    int: isHaz ? 0 : int, wis: isHaz ? 0 : wis, cha: isHaz ? 0 : cha,
    items: [],
    speed: isHaz ? {} : { walk: speed },
    attacks, spellcasting: [], abilities,
    defenses: {
      ac, fort, ref, will, hp,
      hardness: isHaz && hardness > 0 ? hardness : undefined,
      bt: isHaz && bt > 0 ? bt : undefined,
      immunities: [], resistances: [], weaknesses: [],
    },
    isHazard: isHaz,
    hazardData: isHaz ? {
      stealth: stealth.trim() || '—',
      description: description.trim(),
      disable: disable.trim(),
      routine: routine.trim(),
      reset: reset.trim(),
      complex,
    } : undefined,
    raw: {} as Creature['raw'],
  })

  const handleSave = () => {
    if (!name.trim()) return
    const creature = buildCreature()
    saveCustomCreature(creature)
    alert(`"${name}" saved to Custom creatures!`)
    onClose()
  }

  const handleSaveAndAdd = () => {
    if (!name.trim()) return
    const creature = buildCreature()
    saveCustomCreature(creature)
    addCombatant(creature)
    onClose()
  }

  const field = (label: string, node: React.ReactNode) => (
    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
      <label className="text-pf-gold text-xs w-20 shrink-0">{label}</label>
      {node}
    </div>
  )
  const ni = (val: number, set: (v:number) => void, width='w-16') => (
    <input type="number" value={val} onChange={e => set(parseInt(e.target.value)||0)} className={`input-dark ${width} text-xs`} />
  )

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth:580, maxHeight:'90vh', overflowY:'auto' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-pf-gold font-bold">{existing ? 'Edit' : 'Create'} Custom {isHaz ? 'Hazard' : 'Stat Block'}</h2>
          <button className="text-pf-border hover:text-pf-cream" onClick={onClose}>✕</button>
        </div>

        {/* Creature / Hazard toggle — switches which sections are shown. */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 14, border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          {(['creature', 'hazard'] as const).map(t => (
            <button key={t} onClick={() => setType(t)}
              style={{
                flex: 1, padding: '7px 12px',
                background: type === t ? 'var(--accent-soft)' : 'transparent',
                border: 'none',
                color: type === t ? 'var(--accent)' : 'var(--text-muted)',
                fontFamily: 'var(--font-ui)',
                fontSize: 12, fontWeight: 700, letterSpacing: '.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >{t === 'creature' ? '⚔ Creature' : '⚠ Hazard'}</button>
          ))}
        </div>

        <div className="text-xs font-bold text-pf-gold mb-2 uppercase">Basic Info</div>
        {field('Name', <input value={name} onChange={e=>setName(e.target.value)} className="input-dark flex-1 min-w-32 text-xs" placeholder={isHaz ? "Hazard name" : "Creature name"} />)}
        {field('Level', ni(level, setLevel))}
        {field('Traits', <input value={traits} onChange={e=>setTraits(e.target.value)} className="input-dark flex-1 text-xs" placeholder={isHaz ? "trap, mechanical, ..." : "humanoid, undead, ..."} />)}

        {/* Hazard-only: stealth, disable, complexity, description */}
        {isHaz && (
          <>
            <div className="text-xs font-bold text-pf-gold mb-2 mt-3 uppercase">Hazard Properties</div>
            {field('Stealth', <input value={stealth} onChange={e=>setStealth(e.target.value)} className="input-dark flex-1 text-xs" placeholder="DC 18 (trained)" />)}
            {field('Disable', <input value={disable} onChange={e=>setDisable(e.target.value)} className="input-dark flex-1 text-xs" placeholder="Thievery DC 18 (trained) to ..." />)}
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-pf-gold text-xs w-20 shrink-0">Complexity</label>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs" style={{ color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={complex} onChange={e=>setComplex(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                Complex (rolls initiative; has Routine)
              </label>
            </div>
            <div className="flex items-start gap-2 mb-1.5">
              <label className="text-pf-gold text-xs w-20 shrink-0 mt-1">Description</label>
              <textarea value={description} onChange={e=>setDescription(e.target.value)} rows={2}
                className="input-dark flex-1 text-xs" placeholder="Flavor description shown at the top of the stat block" />
            </div>
          </>
        )}

        {/* Creature-only: ability modifiers + perception + speed */}
        {!isHaz && (
          <>
            <div className="text-xs font-bold text-pf-gold mb-2 mt-3 uppercase">Ability Modifiers</div>
            <div className="flex gap-2 flex-wrap mb-2">
              {([['STR',str,setStr],['DEX',dex,setDex],['CON',con,setCon],['INT',int,setInt],['WIS',wis,setWis],['CHA',cha,setCha]] as [string,number,(v:number)=>void][]).map(([lbl,val,fn]) => (
                <div key={lbl} className="flex flex-col items-center gap-0.5">
                  <span className="text-pf-border text-xs">{lbl}</span>
                  {ni(val,fn,'w-14')}
                </div>
              ))}
            </div>

            <div className="text-xs font-bold text-pf-gold mb-2 mt-3 uppercase">Perception & Speed</div>
            {field('Perception', ni(perception, setPerception))}
            {field('Speed (ft)', ni(speed, setSpeed))}
          </>
        )}

        <div className="text-xs font-bold text-pf-gold mb-2 mt-3 uppercase">Defenses</div>
        {field('AC', ni(ac, setAc))}
        {field('Fort / Ref / Will', <>{ni(fort, setFort)} / {ni(ref, setRef)} / {ni(will, setWill)}</>)}
        {field('HP', ni(hp, setHp, 'w-20'))}
        {isHaz && field('Hardness', ni(hardness, setHardness))}
        {isHaz && field('BT', ni(bt, setBt))}

        <div className="text-xs font-bold text-pf-gold mb-2 mt-3 uppercase">Attacks</div>
        {attacks.map((a, i) => (
          <div key={i} className="flex items-center gap-2 mb-1 text-xs">
            <span className="text-pf-cream">{a.range} {a.name} +{a.attack} {a.damage}</span>
            <button className="text-red-400 hover:text-red-300 font-bold" onClick={() => setAttacks(prev => prev.filter((_,j)=>j!==i))}>×</button>
          </div>
        ))}
        <div className="flex gap-1 flex-wrap mb-1">
          <select className="input-dark text-xs" value={newAtk.range} onChange={e=>setNewAtk(p=>({...p,range:e.target.value as 'Melee'|'Ranged'}))}>
            <option>Melee</option><option>Ranged</option>
          </select>
          <input placeholder="Name" className="input-dark text-xs w-24" value={newAtk.name} onChange={e=>setNewAtk(p=>({...p,name:e.target.value}))} />
          <input placeholder="Bonus" type="number" className="input-dark text-xs w-16" value={newAtk.attack} onChange={e=>setNewAtk(p=>({...p,attack:parseInt(e.target.value)||0}))} />
          <input placeholder="Damage (e.g. 2d6+4)" className="input-dark text-xs w-28" value={newAtk.damage} onChange={e=>setNewAtk(p=>({...p,damage:e.target.value}))} />
          <input placeholder="Types (slashing,...)" className="input-dark text-xs w-28" value={newAtk.types} onChange={e=>setNewAtk(p=>({...p,types:e.target.value}))} />
          <input placeholder="Traits (agile,...)" className="input-dark text-xs w-24" value={newAtk.traits} onChange={e=>setNewAtk(p=>({...p,traits:e.target.value}))} />
          <button className="btn-secondary btn btn-sm" onClick={addAttack}>+ Add</button>
        </div>

        <div className="text-xs font-bold text-pf-gold mb-2 mt-3 uppercase">Abilities & Actions</div>
        {abilities.map((a, i) => (
          <div key={i} className="flex items-center gap-2 mb-1 text-xs">
            <span className="text-pf-cream font-bold">{a.name}:</span>
            <span className="text-pf-cream opacity-70 truncate">{a.entries.slice(0,50)}...</span>
            <button className="text-red-400 hover:text-red-300 font-bold ml-auto shrink-0" onClick={() => setAbilities(prev => prev.filter((_,j)=>j!==i))}>×</button>
          </div>
        ))}
        <div className="flex gap-1 flex-wrap mb-1">
          <input placeholder="Ability name" className="input-dark text-xs flex-1 min-w-24" value={newAb.name} onChange={e=>setNewAb(p=>({...p,name:e.target.value}))} />
          <input placeholder="Description" className="input-dark text-xs flex-1 min-w-40" value={newAb.entries} onChange={e=>setNewAb(p=>({...p,entries:e.target.value}))} />
          <button className="btn-secondary btn btn-sm" onClick={addAbility}>+ Add</button>
        </div>

        {/* Hazard-only: Routine (complex only) + Reset, at the end. */}
        {isHaz && (
          <>
            {complex && (
              <>
                <div className="text-xs font-bold text-pf-gold mb-2 mt-3 uppercase">Routine</div>
                <textarea value={routine} onChange={e=>setRoutine(e.target.value)}
                  rows={3}
                  className="input-dark text-xs"
                  style={{ width: '100%', resize: 'vertical' }}
                  placeholder="What the hazard does on each of its turns (e.g. '(2 actions) The trap …')." />
              </>
            )}
            <div className="text-xs font-bold text-pf-gold mb-2 mt-3 uppercase">Reset</div>
            <textarea value={reset} onChange={e=>setReset(e.target.value)}
              rows={2}
              className="input-dark text-xs"
              style={{ width: '100%', resize: 'vertical' }}
              placeholder="How the hazard resets after being triggered (optional)." />
          </>
        )}

        <div className="flex items-center gap-2 mt-4">
          {/* Bottom-left "?" help button — opens a dialog explaining the form
              fields and showing the Text Converter format. */}
          <button
            onClick={() => setShowHelp(true)}
            title="How to create a custom character"
            style={{
              flexShrink: 0,
              width: 28, height: 28,
              display: 'grid', placeItems: 'center',
              background: 'transparent',
              border: 'var(--app-bw) solid var(--border-strong)',
              borderRadius: '50%',
              color: 'var(--accent)',
              fontFamily: 'var(--font-display)',
              fontWeight: 700, fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--accent-soft)'
              e.currentTarget.style.borderColor = 'var(--accent)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.borderColor = 'var(--border-strong)'
            }}
          >?</button>
          <button className="btn-primary btn" onClick={handleSaveAndAdd} disabled={!name.trim()}>Save & Add to Encounter</button>
          <button className="btn-secondary btn" onClick={handleSave} disabled={!name.trim()}>Save Only</button>
          <button className="btn-secondary btn ml-auto" onClick={onClose}>Cancel</button>
        </div>
      </div>
      {showHelp && <CustomCharacterHelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}
