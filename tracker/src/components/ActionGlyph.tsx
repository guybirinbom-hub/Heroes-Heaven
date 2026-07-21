// Maps unicode action symbols → Pathfinder2eActions font characters
// Font chars: A=single, D=double, T=triple, F=free, R=reaction
const GLYPH: Record<string, string> = {
  '◆◆◆': 'T',
  '◆◆':  'D',
  '◆':   'A',
  '◇':   'F',
  '↺':   'R',
}

const SPLIT_RE = /(◆◆◆|◆◆|◆|◇|↺)/g

// AoN often spells action costs out as words in prose ("Single Action",
// "Two Actions", "Reaction", "1 action", "3 actions"). Replace those with
// the unicode glyphs so TextWithGlyphs can render the proper font character.
//
// Order matters: longest phrases first so "Three Actions" matches before
// any sub-fragment. Word boundaries keep us out of the middle of other words.
const ACTION_PHRASE_RE = /\b(Three Actions|Two Actions|Single Action|Free Action|Reaction|3 actions|2 actions|1 action)\b/g
const ACTION_PHRASE_MAP: Record<string, string> = {
  'Three Actions':  '◆◆◆',
  'Two Actions':    '◆◆',
  'Single Action':  '◆',
  'Free Action':    '◇',
  'Reaction':       '↺',
  '3 actions':      '◆◆◆',
  '2 actions':      '◆◆',
  '1 action':       '◆',
}

// AoN's structured action markup: `<actions string="Reaction" />`,
// `<actions string="Single Action" />`, etc. Map the string to a unicode glyph
// (which then renders via the action font); strip anything we don't recognise.
const ACTION_TAG_RE = /<actions\b[^>]*?\bstring\s*=\s*"([^"]*)"[^>]*>/gi
const STRAY_ACTIONS_RE = /<\/?actions\b[^>]*>/gi
function actionTagSymbol(s: string): string {
  switch (s.trim().toLowerCase()) {
    case 'reaction': case 'r':                       return '↺'
    case 'free action': case 'free': case 'f': case '0': return '◇'
    case 'single action': case 'one action': case '1': case 'a': return '◆'
    case 'two actions': case 'two action': case '2': case 'd':    return '◆◆'
    case 'three actions': case 'three action': case '3': case 't': return '◆◆◆'
    default: return ''
  }
}

/** Turn AoN action markup (tags + wordy phrases) into the unicode glyphs that
 *  the action font renders. */
export function normalizeActionPhrases(text: string): string {
  return text
    .replace(ACTION_TAG_RE, (_m, s) => actionTagSymbol(s))
    .replace(STRAY_ACTIONS_RE, '')
    .replace(ACTION_PHRASE_RE, m => ACTION_PHRASE_MAP[m] ?? m)
}

/** Tidy other inline AoN markup that otherwise shows as literal text — chiefly
 *  the `((note))` double-parenthesis form, rendered as a plain `(note)`. */
export function cleanInlineMarkup(text: string): string {
  return normalizeActionPhrases(text).replace(/\(\(\s*([\s\S]*?)\s*\)\)/g, '($1)')
}

/** Renders an action cost as an AoN glyph. Accepts either the unicode symbol
 *  (◆ ◇ ↺) OR a wordy phrase ("Single Action", "Two Actions", "Reaction",
 *  "1 action"…) — the phrase is normalized to a glyph first, so callers never
 *  show the words by accident. Mixed strings fall back to TextWithGlyphs. */
export function ActionGlyph({ act, className = '' }: { act: string; className?: string }) {
  const trimmed = act.trim()
  const normalized = normalizeActionPhrases(trimmed)
  const g = GLYPH[normalized]
  if (g) return <span className={`pf2-action-glyph${className ? ' ' + className : ''}`}>{g}</span>
  return <TextWithGlyphs text={trimmed} className={className} />
}

/** Renders a string, converting embedded ◆◇↺ symbols to AoN font glyphs.
 *  Also normalizes wordy action phrases ("Single Action" / "Two Actions" /
 *  "Reaction") to glyphs first so they read as icons rather than text. */
export function TextWithGlyphs({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null
  const normalized = cleanInlineMarkup(text)
  const parts = normalized.split(SPLIT_RE)
  if (parts.length === 1 && !GLYPH[parts[0]]) return <span className={className}>{normalized}</span>
  return (
    <span className={className}>
      {parts.map((p, i) =>
        GLYPH[p]
          ? <span key={i} className="pf2-action-glyph">{GLYPH[p]}</span>
          : p ? <span key={i}>{p}</span> : null
      )}
    </span>
  )
}
