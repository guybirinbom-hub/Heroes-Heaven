import { useState, useCallback, useMemo } from 'react'
import type { Creature, Combatant } from '../types/pf2e'
import { parseStatBlockText } from '../utils/parseStatBlockText'
import { creatureToText } from '../utils/creatureToText'
import { saveCustomCreature, deleteCustomCreature, loadCustomCreatures } from '../data/dataStore'
import { readCustomCreaturesFromFilePicker } from '../utils/dataTransfer'
import { useCombatStore } from '../store/combatStore'
import { StatBlock } from './StatBlock'
import { StatBlockBuilder } from './StatBlockBuilder'

// ── Help dialog ────────────────────────────────────────────────────────────
// Opened by the "?" button in the bottom-left of the footer. Explains the
// expected paste format so users don't have to read parseStatBlockText
// source to figure out why their paste isn't recognized.
function TextConverterHelpModal({ onClose }: { onClose: () => void }) {
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
  const code: React.CSSProperties = { fontFamily: 'var(--font-mono)', color: 'var(--accent)' }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()} style={{ zIndex: 10001 }}>
      <div className="modal-box" style={{ maxWidth: 660, maxHeight: '90vh', overflowY: 'auto', padding: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: 'var(--app-bw) solid var(--border)',
          background: 'linear-gradient(180deg, var(--bg-header-top), var(--bg-header-bottom))',
          position: 'sticky', top: 0, zIndex: 1,
        }}>
          <h2 style={{
            margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600,
            fontSize: 17, color: 'var(--text)', letterSpacing: '-0.01em',
          }}>Using the Text Converter</h2>
          <button onClick={onClose} className="ico-btn" style={{ width: 28, height: 28 }}>✕</button>
        </div>

        <div style={{ padding: '4px 22px 22px' }}>
          <div style={sec}>What the converter does</div>
          <p style={body}>
            Paste a PF2e stat block on the left, click <strong style={{ color: 'var(--text)' }}>▶ Parse</strong>,
            and the converter extracts traits, defenses, attacks, abilities,
            spellcasting, and saves it as a JSON object on the right.
            Press <strong style={{ color: 'var(--text)' }}>Save to Homebrew</strong> (or <strong style={{ color: 'var(--text)' }}>Save &amp; Add to Encounter</strong>)
            and the result becomes a regular custom creature you can search,
            edit, or drop into the initiative tracker.
          </p>

          <div style={sec}>Two ways to fill it in</div>
          <p style={body}>
            The left pane has a <strong style={{ color: 'var(--text)' }}>Plain text / Builder</strong> toggle
            (mirroring the <strong style={{ color: 'var(--text)' }}>JSON / Preview</strong> toggle on the right):
          </p>
          <ul style={{ ...body, marginLeft: 18, padding: 0 }}>
            <li><strong style={{ color: 'var(--accent)' }}>Plain text</strong> — paste a stat block and press <strong style={{ color: 'var(--text)' }}>▶ Parse</strong>. Fastest when you already have the text from AoN or a PDF.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Builder</strong> — a guided form with tabs (Basics, Defense, Strikes, Spells, Abilities, Description). Fill in the fields and the preview updates live — no paste or PF2e formatting needed. A <strong style={{ color: 'var(--text)' }}>⚔ Creature / ⚠ Hazard</strong> toggle at the top switches the whole form to hazard fields (Stealth, Disable, Complexity, Routine, Reset, Hardness, Broken Threshold).</li>
          </ul>
          <p style={body}>Both modes feed the same JSON / Preview and Save buttons, so you can start in one and switch to the other at any time.</p>

          <div style={sec}>Where to copy stat blocks from</div>
          <ul style={{ ...body, marginLeft: 18, padding: 0 }}>
            <li><strong style={{ color: 'var(--accent)' }}>Archives of Nethys</strong> — open the creature page, select all the
                stat-block text (from the name down to Reset / Source), copy &amp; paste here.</li>
            <li><strong style={{ color: 'var(--accent)' }}>A Paizo PDF or adventure path</strong> — select the text in your
                PDF viewer and paste. Spacing variations are tolerated.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Foundry / pf2etools / community sites</strong> — typically work
                too as long as the structure (Perception line, AC/HP line, Melee/Ranged lines, ability blocks)
                stays in the canonical Paizo layout.</li>
          </ul>

          <div style={sec}>Minimum expected layout</div>
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

          <div style={sec}>Layout rules in detail</div>
          <ul style={{ ...body, marginLeft: 18, padding: 0 }}>
            <li><strong style={{ color: 'var(--accent)' }}>First line</strong>: <code style={code}>Name CREATURE &lt;level&gt;</code>.
                Level can be negative (e.g. <code style={code}>CREATURE -1</code>).</li>
            <li><strong style={{ color: 'var(--accent)' }}>Second line</strong>: alignment + size + traits, all UPPERCASE,
                space-separated. e.g. <code style={code}>CE SMALL GOBLIN HUMANOID</code>.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Perception</strong> on its own line with optional senses
                after a semicolon: <code style={code}>Perception +3; darkvision</code>.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Ability mods</strong>: one line, <code style={code}>Str -1, Dex +3, Con +1, Int -1, Wis +0, Cha +0</code> — case-insensitive labels.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Defenses</strong>: <code style={code}>AC 16; Fort +6, Ref +8, Will +3</code> on one
                line, <code style={code}>HP 12</code> on the next. Optional <code style={code}>Hardness</code> and
                <code style={code}>(BT 6)</code> are read if present.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Action glyphs</strong>: any of these are accepted:
                <code style={code}>[one action]</code> / <code style={code}>[two actions]</code> / <code style={code}>[three actions]</code> /
                <code style={code}>[reaction]</code> / <code style={code}>[free action]</code>, or the AoN single-glyph
                Unicode forms (◆ ◆◆ ◆◆◆ ↺ ◇).</li>
            <li><strong style={{ color: 'var(--accent)' }}>Attacks</strong>:
                <code style={code}>Melee [action] &lt;name&gt; +&lt;bonus&gt; (&lt;traits&gt;), Damage &lt;dice&gt; &lt;type&gt;</code>.
                <code style={code}>Ranged</code> uses the same syntax.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Abilities</strong>: <code style={code}>Name [action] (&lt;traits&gt;) Trigger …; Effect …</code>.
                <strong style={{ color: 'var(--text)' }}>Trigger</strong> and <strong style={{ color: 'var(--text)' }}>Effect</strong> headers
                are detected and split into separate fields automatically.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Spellcasting</strong>: lines like
                <code style={code}>Arcane Innate Spells DC 19, attack +9; 3rd fireball; Cantrips (3rd) light, mage hand</code>.</li>
            <li><strong style={{ color: 'var(--accent)' }}>Saving throws &amp; damage types</strong> use the standard PF2e words
                (<em>fire, cold, acid, slashing, piercing, bludgeoning, mental, …</em>).</li>
          </ul>

          <div style={sec}>After you click Parse</div>
          <ul style={{ ...body, marginLeft: 18, padding: 0 }}>
            <li>The right pane fills with the parsed <strong style={{ color: 'var(--text)' }}>JSON</strong>.
                You can edit it directly if anything is off.</li>
            <li>Click <strong style={{ color: 'var(--text)' }}>👁 Preview</strong> on the right header to render the
                parsed stat block — same look as it'll have in the initiative tracker.</li>
            <li>Errors during parsing show under the input pane in red; the JSON pane keeps the previous
                valid output until you fix the input and re-parse.</li>
          </ul>

          <div style={sec}>Adding a Description page</div>
          <p style={body}>
            A creature can have a <strong style={{ color: 'var(--text)' }}>Description</strong> — the lore blurb
            (appearance, behaviour, ecology) shown on its own page via the <strong style={{ color: 'var(--text)' }}>Description</strong> button
            next to Notes on the stat block. Add one in any of these ways:
          </p>
          <ul style={{ ...body, marginLeft: 18, padding: 0 }}>
            <li><strong style={{ color: 'var(--accent)' }}>Builder</strong> — open the <strong style={{ color: 'var(--text)' }}>Description</strong> tab and type the lore (it can be several paragraphs).</li>
            <li><strong style={{ color: 'var(--accent)' }}>Plain text</strong> — put a <code style={code}>Description</code> line at the very end, with the lore on the lines after it:</li>
          </ul>
          <pre style={{ ...pre, marginTop: 0 }}>{`Goblin Scuttle [reaction] Trigger … Effect …

Description
Goblins are short, scrappy humanoids with a
love of fire, dogslicers, and mischief…`}</pre>
          <ul style={{ ...body, marginLeft: 18, padding: 0 }}>
            <li><strong style={{ color: 'var(--accent)' }}>JSON</strong> — set the <code style={code}>"flavor"</code> field directly.</li>
          </ul>
          <p style={muted}>Recall Knowledge lines are removed from the description automatically — they already appear on the stat block.</p>

          <div style={sec}>Tips</div>
          <ul style={muted}>
            <li style={{ marginBottom: 4 }}>If the parser misses a field, you can hand-edit the JSON on the right — anything you change there flows into the preview and the saved creature.</li>
            <li style={{ marginBottom: 4 }}>Save Changes overwrites the existing creature in your homebrew. Save Asｊ→ "Save to Homebrew" gives it a new name.</li>
            <li style={{ marginBottom: 4 }}>Looking for a simpler workflow? The <strong style={{ color: 'var(--text)' }}>Custom Stat Block</strong> editor (the wrench-icon button) has a form-based UI for filling in fields one at a time — no paste required.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function mockCombatant(creature: Creature): Combatant {
  return {
    id: 'preview',
    name: creature.name,
    creature,
    isPC: false,
    isAlly: false,
    initiative: null,
    currentHP: creature.defenses.hp,
    maxHP: creature.defenses.hp,
    tempHP: 0,
    conditions: [],
    isElite: false,
    isWeak: false,
    notes: '',
    isDefeated: false,
  }
}

let _uid = 0
const uid = () => `custom-${Date.now()}-${++_uid}`

interface Props {
  onClose: () => void
  existing?: Creature
}

const PLACEHOLDER = `Paste a PF2e stat block here, then click Parse.

Example format:
Goblin Warrior CREATURE 1
CE SMALL GOBLIN HUMANOID
Perception +3; darkvision
Languages Goblin
Skills Acrobatics +5, Stealth +5
Str -1, Dex +3, Con +1, Int -1, Wis +0, Cha +0
Items dogslicer, leather armor

AC 16; Fort +6, Ref +8, Will +3
HP 12

Speed 25 feet

Melee [one action] dogslicer +7 (agile, finesse), Damage 1d6-1 slashing

Goblin Scuttle [reaction] Trigger An ally ends a move action adjacent to the goblin; Effect The goblin Steps.`

type SaveStep = 'idle' | 'confirm' | 'saveas' | 'confirmdelete' | 'confirmDupName'

export function TextConverter({ onClose, existing }: Props) {
  const { addCombatant } = useCombatStore()
  const [showHelp, setShowHelp] = useState(false)
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  // Imported creatures awaiting review: one shown in the editor, the rest queued.
  const [importQueue, setImportQueue] = useState<Creature[]>([])
  const [isImportDraft, setIsImportDraft] = useState(false)

  const [inputText, setInputText] = useState(() => existing ? creatureToText(existing) : '')
  const [outputJson, setOutputJson] = useState(
    existing ? JSON.stringify(existing, null, 2) : ''
  )
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [jsonError, setJsonError] = useState('')
  const [saveStep, setSaveStep] = useState<SaveStep>('idle')
  const [newName, setNewName] = useState('')
  const [preview, setPreview] = useState(false)

  // Input-side authoring mode: paste plain text, or fill out the form builder.
  // Both write the same `outputJson`, so the right pane (JSON / Preview) and the
  // save flow are identical regardless of how the creature was authored.
  const [inputMode, setInputMode] = useState<'text' | 'builder'>('text')
  const [builderSeed, setBuilderSeed] = useState<Creature | null>(null)
  // Bumped each time we enter builder mode so the builder remounts and re-seeds
  // from the latest output (rather than holding stale form state).
  const [builderKey, setBuilderKey] = useState(0)

  const previewCombatant = useMemo(() => {
    if (!preview || !outputJson.trim()) return null
    try { return mockCombatant(JSON.parse(outputJson) as Creature) }
    catch { return null }
  }, [preview, outputJson])

  const getCreature = useCallback((): Creature | null => {
    try {
      const c = JSON.parse(outputJson) as Creature
      setJsonError('')
      return c
    } catch (e) {
      setJsonError(`Invalid JSON: ${(e as Error).message}`)
      return null
    }
  }, [outputJson])

  const handleParse = () => {
    if (!inputText.trim()) return
    const { creature, errors } = parseStatBlockText(inputText)
    setParseErrors(errors)
    if (creature) {
      if (existing) {
        creature.id = existing.id
        // Preserve the existing source — re-parsing should never silently
        // move an edited stat block into "Homebrew". The user can change the
        // source by editing the JSON directly if they want.
        creature.source = existing.source
      }
      setOutputJson(JSON.stringify(creature, null, 2))
    }
  }

  // ── Builder mode ───────────────────────────────────────────────────────────
  // The builder emits a fresh Creature on every edit; mirror it into outputJson
  // so the right pane and the save flow stay in sync (live, no Parse step).
  const onBuilderChange = useCallback((c: Creature) => {
    setOutputJson(JSON.stringify(c, null, 2))
    setJsonError('')
  }, [])

  const enterBuilder = () => {
    if (inputMode === 'builder') return
    // Seed the form from whatever we already have: the current JSON if valid,
    // otherwise parse the pasted text as a convenience so nothing is lost.
    let seed: Creature | null = null
    if (outputJson.trim()) {
      try { seed = JSON.parse(outputJson) as Creature } catch { seed = null }
    }
    if (!seed && inputText.trim()) {
      const { creature } = parseStatBlockText(inputText)
      if (creature) seed = creature
    }
    setBuilderSeed(seed)
    setBuilderKey(k => k + 1)
    setInputMode('builder')
  }

  const enterText = () => {
    if (inputMode === 'text') return
    // Reflect what was built into the text box if it's empty, so flipping back
    // shows the equivalent plain-text stat block instead of a blank textarea.
    if (!inputText.trim() && outputJson.trim()) {
      try { setInputText(creatureToText(JSON.parse(outputJson) as Creature)) } catch { /* keep as-is */ }
    }
    setInputMode('text')
  }

  const hasOutput = outputJson.trim().length > 0

  // ── Save flow ────────────────────────────────────────────────────────────

  // Locate an existing custom creature with the same name (case-insensitive)
  // — used to warn the user before silently creating a duplicate.
  const findDupByName = (name: string): Creature | null => {
    const all = loadCustomCreatures()
    return all.find(x => x.name.toLowerCase() === name.toLowerCase()) ?? null
  }

  // Track the conflict so the confirmation step knows what to overwrite vs. add as new.
  const [dupConflict, setDupConflict] = useState<{ existing: Creature; pending: Creature; alsoAdd: boolean } | null>(null)

  // ── Import review ──────────────────────────────────────────────────────────
  // Load a parsed creature into the editor (text + JSON + live preview) so the
  // user can check/edit it before saving. Nothing is written to the database
  // until they press Save.
  const loadCreatureIntoEditor = useCallback((c: Creature) => {
    setInputText(creatureToText(c))
    setOutputJson(JSON.stringify(c, null, 2))
    setParseErrors([])
    setJsonError('')
    setSaveStep('idle')
    setPreview(true)
  }, [])

  const handleImportJson = useCallback(async () => {
    const r = await readCustomCreaturesFromFilePicker()
    if (!r.ok) { setImportMsg({ kind: 'err', text: r.error ?? 'Import failed.' }); return }
    const [first, ...rest] = r.creatures
    loadCreatureIntoEditor(first)
    setImportQueue(rest)
    setIsImportDraft(true)
    setImportMsg({
      kind: 'ok',
      text: `Loaded "${first.name}" for review${rest.length ? ` — ${rest.length} more queued` : ''}. ` +
        'Check it over and edit if needed, then Save to add it to your homebrew.',
    })
  }, [loadCreatureIntoEditor])

  // After saving an imported draft, move on to the next queued creature instead
  // of closing the panel. A normal (non-import) save just closes.
  const advanceOrClose = () => {
    if (importQueue.length > 0) {
      const [next, ...rest] = importQueue
      setImportQueue(rest)
      setDupConflict(null)
      setIsImportDraft(true)
      loadCreatureIntoEditor(next)
      setImportMsg({ kind: 'ok', text: `Saved. Now reviewing "${next.name}"${rest.length ? ` — ${rest.length} more after this.` : ' (last one).'}` })
    } else {
      onClose()
    }
  }

  // Discard the creature currently under review without saving it.
  const handleSkipImport = () => {
    if (importQueue.length > 0) {
      const [next, ...rest] = importQueue
      setImportQueue(rest)
      loadCreatureIntoEditor(next)
      setImportMsg({ kind: 'ok', text: `Skipped. Now reviewing "${next.name}"${rest.length ? ` — ${rest.length} more after this.` : ' (last one).'}` })
    } else {
      setIsImportDraft(false)
      setInputText('')
      setOutputJson('')
      setPreview(false)
      setImportMsg(null)
    }
  }

  const handleSaveClick = () => {
    const c = getCreature()
    if (!c) return
    if (existing) {
      setSaveStep('confirm')
      return
    }
    // New creature — check for a name conflict against existing custom creatures.
    const dup = findDupByName(c.name)
    if (dup) {
      setDupConflict({ existing: dup, pending: c, alsoAdd: false })
      setSaveStep('confirmDupName')
      return
    }
    if (!c.id) c.id = uid()
    saveCustomCreature(c)
    advanceOrClose()
  }

  const handleSaveAndAddClick = () => {
    const c = getCreature()
    if (!c) return
    // Same name-conflict guard as plain Save.
    if (!existing) {
      const dup = findDupByName(c.name)
      if (dup) {
        setDupConflict({ existing: dup, pending: c, alsoAdd: true })
        setSaveStep('confirmDupName')
        return
      }
    }
    if (!c.id) c.id = uid()
    saveCustomCreature(c)
    addCombatant(c)
    advanceOrClose()
  }

  // Resolve the duplicate-name conflict by overwriting the existing entry.
  const handleDupOverwrite = () => {
    if (!dupConflict) return
    const c = dupConflict.pending
    c.id = dupConflict.existing.id
    saveCustomCreature(c)
    if (dupConflict.alsoAdd) addCombatant(c)
    setDupConflict(null)
    advanceOrClose()
  }

  // Resolve the duplicate-name conflict by saving as a new entry (different id).
  const handleDupKeepBoth = () => {
    if (!dupConflict) return
    const c = dupConflict.pending
    c.id = uid()
    saveCustomCreature(c)
    if (dupConflict.alsoAdd) addCombatant(c)
    setDupConflict(null)
    advanceOrClose()
  }

  const handleOverwrite = () => {
    const c = getCreature()
    if (!c || !existing) return
    c.id = existing.id
    saveCustomCreature(c)
    onClose()
  }

  const handleSaveAs = () => {
    const c = getCreature()
    if (!c || !newName.trim()) return
    c.id = uid()
    c.name = newName.trim()
    saveCustomCreature(c)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        style={{
          background: 'var(--bg-panel)',
          border: 'var(--app-bw) solid var(--border-strong)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          width: '92vw',
          height: '90vh',
          maxWidth: 1300,
          overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header — display font */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px',
          borderBottom: 'var(--app-bw) solid var(--border)',
          flexShrink: 0,
        }}>
          <h2 className="page-title-display" style={{
            fontSize: 20, fontWeight: 500, fontVariationSettings: '"opsz" 72',
            color: 'var(--text)', margin: 0, letterSpacing: '-0.015em',
          }}>
            {existing ? <>Edit <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>{existing.name}</em></> : 'Text Converter'}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!existing && (
              <button onClick={handleImportJson} className="btn btn-secondary btn-sm"
                title="Import custom stat block(s) from a JSON file">
                Import JSON
              </button>
            )}
            <button onClick={onClose} className="ico-btn" style={{ width: 30, height: 30, fontSize: 16 }}>✕</button>
          </div>
        </div>
        {/* Import feedback / review banner */}
        {importMsg && (
          <div style={{
            padding: '8px 22px', fontSize: 12, lineHeight: 1.5,
            background: 'var(--bg-elevated)', borderBottom: 'var(--app-bw) solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 12,
            color: importMsg.kind === 'ok' ? 'var(--hp-full)' : 'var(--danger)',
          }}>
            <span style={{ flex: 1, minWidth: 0 }}>{importMsg.text}</span>
            {isImportDraft && (
              <button onClick={handleSkipImport} className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
                {importQueue.length > 0 ? 'Skip this one' : 'Discard'}
              </button>
            )}
          </div>
        )}

        {/* Two-panel body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

          {/* ── Left: text input ─────────────────────────────────────────── */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            borderRight: 'var(--app-bw) solid var(--border)', minWidth: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 14px',
              minHeight: 42,
              background: 'var(--bg-elevated)',
              flexShrink: 0,
              borderBottom: 'var(--app-bw) solid var(--border)',
            }}>
              <span className="pf-label" style={{ marginBottom: 0 }}>
                Input — {inputMode === 'builder' ? 'Builder' : 'Plain Text'}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {inputMode === 'text' && (
                  <button
                    onClick={handleParse}
                    disabled={!inputText.trim()}
                    className="btn btn-primary btn-sm"
                  >
                    ▶ Parse
                  </button>
                )}
                {/* Authoring-mode toggle — mirrors the right pane's JSON/Preview
                    switch. Plain text = paste + Parse; Builder = fill a form. */}
                <div style={{ display: 'inline-flex', border: 'var(--app-bw) solid var(--border-strong)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                  <button onClick={enterText} style={segStyle(inputMode === 'text')}>Plain text</button>
                  <button onClick={enterBuilder} style={segStyle(inputMode === 'builder')}>Builder</button>
                </div>
              </div>
            </div>

            {inputMode === 'builder' ? (
              <StatBlockBuilder key={builderKey} initial={builderSeed} onChange={onBuilderChange} />
            ) : (
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder={PLACEHOLDER}
                spellCheck={false}
                className="themed-placeholder"
                style={{
                  flex: 1, resize: 'none', background: 'var(--bg-base)', border: 'none', outline: 'none',
                  color: 'var(--text)', fontFamily: 'monospace', fontSize: 12,
                  lineHeight: 1.6, padding: '10px 12px',
                }}
              />
            )}

            {inputMode === 'text' && parseErrors.length > 0 && (
              <div style={{
                padding: '6px 12px', background: 'var(--danger-soft)',
                borderTop: 'var(--app-bw) solid var(--border)', flexShrink: 0, fontSize: 11,
              }}>
                {parseErrors.map((e, i) => (
                  <div key={i} style={{ color: 'var(--danger)' }}>✗ {e}</div>
                ))}
              </div>
            )}
          </div>

          {/* ── Right: JSON output / Preview ─────────────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 14px',
              minHeight: 42,
              background: 'var(--bg-elevated)',
              flexShrink: 0,
              borderBottom: 'var(--app-bw) solid var(--border)',
            }}>
              <span className="pf-label" style={{ marginBottom: 0 }}>
                {preview ? 'Preview — Stat Block' : 'Output — JSON'}
              </span>
              <button
                onClick={() => setPreview(v => !v)}
                disabled={!hasOutput}
                className="btn btn-sm"
                style={preview ? {
                  background: 'var(--accent-soft)',
                  borderColor: 'var(--accent-line)',
                  color: 'var(--accent)',
                } : undefined}
              >
                {preview ? '{ } JSON' : '👁 Preview'}
              </button>
            </div>

            {preview ? (
              <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-base)' }}>
                {previewCombatant
                  ? <StatBlock combatant={previewCombatant} />
                  : <div style={{ padding: 16, color: 'var(--danger)', fontSize: 12 }}>Invalid JSON — cannot preview</div>
                }
              </div>
            ) : (
              <textarea
                value={outputJson}
                onChange={e => { setOutputJson(e.target.value); setJsonError('') }}
                placeholder="Parsed JSON will appear here. You can also type or paste JSON directly."
                spellCheck={false}
                className="themed-placeholder"
                style={{
                  flex: 1, resize: 'none', background: 'var(--bg-base)', border: 'none', outline: 'none',
                  color: 'var(--linked)', fontFamily: 'monospace', fontSize: 12,
                  lineHeight: 1.6, padding: '10px 12px',
                }}
              />
            )}

            {!preview && jsonError && (
              <div style={{
                padding: '5px 12px', background: 'var(--danger-soft)',
                borderTop: 'var(--app-bw) solid var(--border)', flexShrink: 0,
                color: 'var(--danger)', fontSize: 11,
              }}>
                ✗ {jsonError}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px',
          background: 'var(--bg-elevated)',
          borderTop: 'var(--app-bw) solid var(--border)',
          flexShrink: 0,
        }}>
          {/* Bottom-left "?" help button — explains the expected paste
              format so users can self-serve when something doesn't parse. */}
          <button
            onClick={() => setShowHelp(true)}
            title="How to use the Text Converter"
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
          {/* Spacer pushes the action buttons to the right of the row. */}
          <div style={{ flex: 1 }} />
          {saveStep === 'idle' && (
            <>
              <button onClick={onClose} style={btnStyle('ghost')}>Cancel</button>
              {existing && (
                <button
                  onClick={() => setSaveStep('confirmdelete')}
                  style={{ ...btnStyle('ghost'), borderColor: 'var(--danger)', color: 'var(--danger)' }}
                >
                  🗑 Delete
                </button>
              )}
              {!existing && (
                <button
                  onClick={handleSaveAndAddClick}
                  disabled={!hasOutput}
                  style={btnStyle('primary', !hasOutput)}
                >
                  Save &amp; Add to Encounter
                </button>
              )}
              <button
                onClick={handleSaveClick}
                disabled={!hasOutput}
                style={btnStyle('gold', !hasOutput)}
              >
                {existing ? 'Save Changes…' : 'Save to Homebrew'}
              </button>
            </>
          )}

          {saveStep === 'confirmdelete' && existing && (
            <>
              <span style={{ color: 'var(--danger)', fontSize: 12, marginRight: 4 }}>
                Delete "{existing.name}" permanently?
              </span>
              <button
                onClick={() => { deleteCustomCreature(existing.id); onClose() }}
                style={{ ...btnStyle('ghost'), borderColor: 'var(--danger)', color: 'var(--danger)' }}
              >
                Yes, Delete
              </button>
              <button onClick={() => setSaveStep('idle')} style={btnStyle('ghost')}>Cancel</button>
            </>
          )}

          {saveStep === 'confirm' && existing && (
            <>
              <span style={{ color: 'var(--accent)', fontSize: 12, marginRight: 4 }}>Save as:</span>
              <button onClick={handleOverwrite} style={btnStyle('primary')}>
                Overwrite "{existing.name}"
              </button>
              <button onClick={() => { setSaveStep('saveas'); setNewName(existing.name) }} style={btnStyle('gold')}>
                Save As New…
              </button>
              <button onClick={() => setSaveStep('idle')} style={btnStyle('ghost')}>Back</button>
            </>
          )}

          {saveStep === 'saveas' && (
            <>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveAs()}
                placeholder="New creature name"
                style={{
                  background: 'var(--bg-base)', border: 'var(--app-bw) solid #6b4a1a', borderRadius: 4,
                  color: 'var(--text)', fontSize: 12, padding: '4px 8px', width: 200,
                }}
              />
              <button
                onClick={handleSaveAs}
                disabled={!newName.trim()}
                style={btnStyle('gold', !newName.trim())}
              >
                Save As New
              </button>
              <button onClick={() => setSaveStep('confirm')} style={btnStyle('ghost')}>Back</button>
            </>
          )}

          {saveStep === 'confirmDupName' && dupConflict && (
            <>
              <span style={{ color: 'var(--accent)', fontSize: 12, marginRight: 4 }}>
                A custom stat block named "{dupConflict.existing.name}" already exists.
              </span>
              <button onClick={handleDupOverwrite} style={btnStyle('primary')}>
                Overwrite
              </button>
              <button onClick={handleDupKeepBoth} style={btnStyle('gold')}>
                Keep Both
              </button>
              <button onClick={() => { setSaveStep('idle'); setDupConflict(null) }} style={btnStyle('ghost')}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
      {showHelp && <TextConverterHelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}

// Segmented "Plain text | Builder" toggle button (left-pane header).
function segStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'var(--accent-soft)' : 'transparent',
    border: 'none',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    fontFamily: 'var(--font-ui)',
    fontSize: 11.5,
    fontWeight: active ? 600 : 500,
    padding: '4px 11px',
    cursor: 'pointer',
    transition: 'all 0.12s',
  }
}

function btnStyle(variant: 'primary' | 'gold' | 'ghost', disabled = false): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: 'var(--font-ui)',
    border: 'var(--app-bw) solid',
    borderRadius: 'var(--radius-sm)',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 12.5,
    fontWeight: 500,
    padding: '6px 14px',
    opacity: disabled ? 0.4 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    transition: 'all 0.15s ease',
  }
  if (variant === 'primary') return { ...base, background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--text-on-accent)', fontWeight: 600 }
  if (variant === 'gold')    return { ...base, background: 'transparent', borderColor: 'var(--border-strong)', color: 'var(--accent)' }
  return { ...base, background: 'none', borderColor: 'transparent', color: 'var(--text-muted)' }
}
