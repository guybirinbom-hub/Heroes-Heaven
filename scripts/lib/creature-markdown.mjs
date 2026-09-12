/*
 * AoN creature-markdown parser — the bestiary's ONE source of structure.
 *
 * PORTED from pf2e-tracker/scripts/scrape-aon.mjs (lines 210-506), which built the shipped
 * bestiary by scraping AoN live. It now lives here and reads the local Archives instead, so the
 * tracker's stat blocks and the character sheet come from the same corpus.
 *
 * TWO MEASURED BUGS ARE FIXED HERE. Both were silent — the scraper reported success and shipped
 * incomplete stat blocks:
 *
 *  1. LINK-NAMED ABILITIES WERE SKIPPED OUTRIGHT. The original carried
 *         if (rawName.trim().startsWith('[')) { i++; continue }   // "skip if name looks like a link"
 *     but AoN writes every SHARED monster ability with the name as a link —
 *         **[Change Shape](/MonsterAbilities.aspx?ID=8)** <actions string="Single Action" /> (…)
 *     Measured over the 4,760 shipped creatures: 1,903 abilities across 1,215 creatures (26% of the
 *     corpus), 71 distinct, 0 captured. Attack of Opportunity ×295, Change Shape ×258, Constrict
 *     ×186, Reactive Strike ×186, Frightful Presence ×156, Swallow Whole ×153, Trample ×132.
 *     `Recall Knowledge - <type>` uses the same shape but is AoN's flavour sidebar, not an ability,
 *     so it stays excluded — deliberately, by name, not by dropping the whole pattern.
 *
 *  2. ACTION COSTS OUTSIDE FIVE EXACT STRINGS WERE DISCARDED. actionStringToRaw matched only
 *     'Single Action' / 'One Action' / 'Two Actions' / 'Three Actions' / 'Reaction' / 'Free Action'
 *     and returned undefined for everything else, so 1,003 abilities lost their cost — including
 *     153 written 'Single Action to Three Actions'. A range cannot be expressed by {number, unit}
 *     at all, which is why RawAbility.activity gained `to`/`sep` (see tracker/src/types/pf2e.ts).
 *
 * The `parseAonMarkdown` body below is otherwise the original, deliberately: it produced 4,748 of
 * 4,760 stat blocks that survived a byte-level diff, so it is the known-good baseline and the two
 * fixes above are the only intended behaviour change.
 */
// ─── AoN markdown parser ─────────────────────────────────────────────────────

/**
 * Parse the AoN ES markdown field into structured attacks, abilities, and
 * spellcasting blocks.  The markdown uses a bespoke XML-like syntax mixed
 * with standard Markdown bold / link notation.
 */
export function parseAonMarkdown(markdown) {
  if (!markdown) return { attacks: [], abilities: { top: [], mid: [], bot: [] }, spellcasting: [] }

  // ── helpers ──────────────────────────────────────────────────────────────
  const stripLinks   = t => t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  const stripBold    = t => t.replace(/\*\*/g, '')
  // Drop markdown italic underscores around inline phrases (`_gentle repose_`)
  // but keep underscores that aren't paired around a word (e.g. dice/identifier
  // tokens). Renderer treats these as plain text.
  const stripItalic  = t => t.replace(/_([^_\n]+?)_/g, '$1')
  /* WHAT LINK-STRIPPING LEAVES BEHIND. `clean` unwrapped the link and then stored the result
   * verbatim, so AoN's own padding around the link came with it: the Plated Python's Toxic Breath
   * ships "has a creature grabbed;  Effect The python's breath…" and the Charau-Ka Shrieker Crew's
   * charge ships "DC 23 basic   Reflex save". Measured over the 4,791 corpus: 182 ability bodies,
   * attack damage strings and triggers carry a doubled space or a space in front of the
   * punctuation the link used to sit before.
   *
   * Only HORIZONTAL whitespace is collapsed. `\n` is load-bearing here — the per-action damage
   * table below joins its rows with it — and `\r` belongs to the blurb's paragraph breaks.
   * `+` and `-` are deliberately NOT in the punctuation set: "dogslicer +7" needs that space and
   * the Melee/Ranged branch matches on it. Underscores are already handled by stripItalic, which
   * only fires on a PAIR on one line, so dice and identifiers are untouched. */
  const tidy = t => t
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/[^\S\r\n]+([,;.)])/g, '$1')
    .replace(/([([])[^\S\r\n]+/g, '$1')
  const clean        = t => tidy(stripItalic(stripBold(stripLinks(t)))).trim()

  /* Every `<actions string="…">` AoN actually uses, measured over the corpus rather than guessed.
   * The original matched five exact strings and returned undefined for the rest, dropping 1,003
   * costs. A RANGE ("Single Action to Three Actions", 153 of them) has no fixed number at all, so
   * it returns `to` as the upper bound and keeps AoN's own conjunction in `sep` rather than
   * normalising "or" into "to". An EMPTY string is meaningful and distinct from a missing tag: it
   * means the ability is passive, so it returns undefined like any other costless ability. */
  const ACTION_WORD = {
    'single action': 1, 'one action': 1, '1 action': 1,
    'two actions': 2, 'two action': 2, '2 actions': 2,
    'three actions': 3, 'three action': 3, '3 actions': 3,
  }
  function actionStringToRaw(s) {
    if (!s) return undefined
    const l = s.trim().toLowerCase()
    if (!l) return undefined
    if (l === 'reaction') return { number: 1, unit: 'reaction' }
    if (l === 'free action' || l === 'free') return { number: 1, unit: 'free' }
    if (ACTION_WORD[l] !== undefined) return { number: ACTION_WORD[l], unit: 'action' }

    // "<cost> to <cost>" / "<cost> or <cost>" — a variable cost.
    const range = l.match(/^(.+?)\s+(to|or)\s+(.+)$/)
    if (range) {
      const [, lo, sep, hi] = range
      const loRaw = actionStringToRaw(lo)
      const hiRaw = actionStringToRaw(hi)
      if (!loRaw) return undefined
      // "Free Action or One Action" mixes units; the low end carries the meaning, so keep it whole
      // rather than inventing a range across two different unit types.
      if (!hiRaw || hiRaw.unit !== loRaw.unit) return loRaw
      return { ...loRaw, to: hiRaw.number, sep }
    }
    return undefined
  }

  /* An <actions string> as the glyphs the tracker renders (see ActionGlyph). Local rather than
   * imported from the builder: the parser is deliberately pure string-to-object. */
  function costGlyph(str) {
    const a = actionStringToRaw(str)
    if (!a) return ''
    if (a.unit === 'reaction') return '↺'
    if (a.unit === 'free') return '◇'
    const pips = (n) => '◆'.repeat(Math.min(Math.max(n, 1), 3))
    return a.to && a.to !== a.number ? `${pips(a.number)} ${a.sep ?? 'to'} ${pips(a.to)}` : pips(a.number)
  }

  /* A spell's USAGE lives OUTSIDE the link brackets, and was being thrown away.
   *
   *     [Dominate](/Spells.aspx?ID=87) (x3), [Illusory Scene](/Spells.aspx?ID=161) (at will)
   *     [Fireball](/Spells.aspx?ID=1), [Haste](/Spells.aspx?ID=2) (4 slots)
   *
   * The three harvest branches below each did `spells.push({ name })` off the link text alone, so
   * "(at will)", "(x3)" and "(N slots)" vanished on 1,291 creatures. That is not merely missing
   * information: with `atWill` unset the tracker treats an at-will innate spell as SINGLE-USE and
   * greys it out after one cast, which is wrong at the table.
   *
   * Returns the per-spell annotations plus the rank-wide slot count (spontaneous casters share one
   * pool per rank, so "(4 slots)" trails the whole line rather than any one spell). */
  function harvestSpells(spellLine) {
    /* Not every link on a spell line points at a SPELL. AoN writes the usage note inside the
     * line and links whatever that note happens to mention:
     *
     *     [Plane Shift](/Spells.aspx?ID=222) (self only; to [Shadow Plane](/Planes.aspx?ID=11) only)
     *     [Fear](/Spells.aspx?ID=110) ([animals](/Traits.aspx?ID=9); [fungi](/Traits.aspx?ID=77) only)
     *
     * Harvesting every link made those castable: 115 phantom spells plus 1 phantom ritual name
     * shipped across 66 creature records — Astral Plane x16, Shadow Plane x15, Material Plane
     * x14, the Universe x11 — plus traits, monsters (phistophilus, Jin-Hae) and a deity
     * (Kugaptee). The Young Forest Dragon's 5th rank read Fear, animals, fungi, plants: four
     * entries where AoN gives one spell. So filter on the link TARGET, not on its text.
     *
     * MythicRituals.aspx is on the allowlist deliberately — it is where AoN keeps Freedom and
     * Imprisonment, and the Elder Wyrmwraith's only ritual is [Imprisonment](/MythicRituals.aspx).
     * Equipment.aspx is NOT: all 5 of its hits are AoN mis-linking "Astral Plane" on the djinn.
     * The no-link fallback below still keys off the RAW count, so a line whose links are all
     * rejected yields no spells instead of having its prose comma-split into invented names. */
    const raw = [...spellLine.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)]
    const links = raw.filter((m) => /^(?:https?:\/\/[^/]+)?\/?(?:Mythic)?(?:Spells|Rituals)\.aspx/i.test(m[2]))
    // "(N slots)" applies to the rank, not to the spell it happens to follow.
    const slotM = spellLine.match(/\((\d+)\s+slots?\)/i)
    if (!raw.length) {
      const names = clean(spellLine.replace(/\(\d+\s+slots?\)/i, '')).split(',').map(t => t.trim()).filter(Boolean)
      return { spells: names.map((name) => ({ name })), slots: slotM ? parseInt(slotM[1]) : undefined }
    }
    const spells = []
    for (let k = 0; k < links.length; k++) {
      const m = links[k]
      const from = m.index + m[0].length
      const to = k + 1 < links.length ? links[k + 1].index : spellLine.length
      const after = spellLine.slice(from, to)
      /* The link TEXT is what gets stored, and AoN italicises a spell inside its own link —
       * `[_acid arrow_](/Spells.aspx?ID=…)` — so the name shipped with the markers still on it.
       * 50 spell names across the corpus: the Ganzi Martial Artist's entire innate list, plus
       * Siabrae, King Merlokrep, Rinnarv Bontimar and Strigoi Progenitor. `clean` is the same
       * unwrap the rest of this file uses, so a name reads the way the stat block prints it. */
      const spell = { name: clean(m[1]) }
      /* The parenthetical is a SEMICOLON-SEPARATED LIST, not a single token:
       *
       *     [Invisibility](…) (at will; self only)
       *     [Summon Animal](…) (cave bear or woolly rhinoceros only)
       *     [Interplanar Teleport](…) (at will; Dimension of Time and Universe only)
       *
       * `atWill` only fired when the WHOLE parenthetical was "(at will)" and `amount` only on a
       * bare "(x3)", so every compound one lost BOTH halves — the restriction was never captured
       * and the at-will flag went with it. The Solar ships `{"name":"Invisibility"}` for
       * "(at will; self only)", so the tracker greys its unlimited Invisibility out after one
       * cast. Measured over the 4,791 shipped records: 594 spells on 397 creatures gain data —
       * 236 at-will flags recovered (1,368 → 1,604), 46 amounts (969 → 1,015), 584 notes.
       *
       * Tokens are walked WITH their original separator, because a semicolon is also AoN's list
       * comma — "animal; fungi; and plants only" is one restriction, not three. Only USAGE tokens
       * are consumed: "(N slots)" is rank-wide (slotM already reads it off the line) and a bare
       * "(*)" is a footnote marker with nothing to say. */
      for (const p of after.matchAll(/\(([^()]*)\)/g)) {
        const parts = p[1].split(/\s*([;,])\s*/)   // [tok, sep, tok, sep, …]
        const kept = []
        for (let t = 0; t < parts.length; t += 2) {
          const tok = parts[t].trim()
          if (!tok || /^\*+$/.test(tok)) continue
          if (/^at[-\s]?will$/i.test(tok)) { spell.atWill = true; continue }
          // "(2)" is AoN's prepared-twice shorthand for "(×2)" — same slot, missing the ×.
          const times = tok.match(/^[x×]?\s*(\d+)$/i)
          if (times) { spell.amount = parseInt(times[1]); continue }
          if (/^\*?\d+\s+slots?$/i.test(tok)) continue
          kept.push({ tok, sep: parts[t + 1] ?? '' })
        }
        const note = clean(kept.map((x, n) => n < kept.length - 1 ? x.tok + (x.sep || ';') + ' ' : x.tok).join(''))
        if (note) spell.note = spell.note ? `${spell.note}; ${note}` : note
      }
      spells.push(spell)
    }
    return { spells, slots: slotM ? parseInt(slotM[1]) : undefined }
  }

  const ordSuffix = (n) => (n % 100 >= 11 && n % 100 <= 13) ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'

  function extractActionsStr(line) {
    const m = line.match(/<actions\s+string="([^"]+)"\s*\/>/)
    return m ? m[1] : ''
  }

  // ── preprocess ───────────────────────────────────────────────────────────
  let text = markdown
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<traits>[\s\S]*?<\/traits>/gi, '')
    .replace(/<column[^>]*>/gi, '')
    .replace(/<\/column>/gi, '')
    .replace(/<row[^>]*>/gi, '')
    .replace(/<\/row>/gi, '')
    .replace(/<image[^>]*\/>/gi, '')
    .replace(/<document[^>]*\/>/gi, '')
    /* AoN ships some documents with UNSUBSTITUTED cross-reference templates, and in the creature
     * markdown they arrive HTML-ESCAPED (a few DOUBLE-escaped), which is why the runtime's
     * cleanAonTemplate — written for the raw `<%TRAITS%358%%>x<%END>` form — never caught them:
     *
     *     **Harmonizing Aura** ([ <%TRAITS%542%%> aura](/Traits.aspx?ID=542) <%END>, …)
     *
     * Nothing downstream decodes entities, so the markers walked through clean() and shipped
     * verbatim on 45 creatures: 37 ability traits over 16 of them (Angelic Chorus's Harmonizing
     * Aura lists its traits as `<%TRAITS%542%%> aura <%END>`), 18 ability bodies (the
     * Silent Stalker's Silent Aura reads "makes no sound <%END>, preventing…") and 3 names.
     * Stripped before the split, so names, traits and bodies are all covered once.
     *
     * The shape is spelled out rather than matched as `%…>` because AoN emits ONE unterminated
     * marker — the Giant Aukashungi's Roll Up ends `<%END trait).` with no closer — and a
     * run-to-the-next-`>` pattern eats across the line break from there, taking the whole
     * `**[Swallow Whole](…)** <actions …/>` header after it with it. 143 markers in the corpus,
     * every one of them END or TAG%NNN%%; the leading ` ?` is AoN's own spacing around the
     * marker, which would otherwise leave "makes no sound , preventing". */
    .replace(/ ?(?:<|&(?:amp;)?lt;)%(?:END|[A-Z.]+%\d+%%)(?:&(?:amp;)?gt;|>)?/g, '')
    // Normalize <br /> into real line breaks BEFORE splitting on \n —
    // otherwise the next ability heading after a <br /> gets glued onto
    // the prior ability's description as plain text.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/br>/gi, '\n')
    /* <ul>/<li> option lists were never normalised, so a whole list arrived as ONE line, matched no
     * branch and fell out at the terminal `i++`. ~130 creatures lost every option: Saint Fang's
     * Dragon Breath keeps "He breathes in one of two ways" and neither way; the Clockwork
     * Fabricator lost SIX Strikes. Some <li> items ARE Strikes, so they have to reach the attack
     * branch too — hence a newline rather than a bullet character. */
    .replace(/<li\b[^>]*>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '\n')
    /* A SPELL LIST HARD-WRAPPED MID-LIST. AoN's source for Rinnarv Bontimar breaks four of his rank
     * lines after the first spell and resumes the next line with the comma:
     *
     *     - **7th**
     *     [_blade barrier_](/Spells.aspx?ID=24)*
     *     , [Dimensional Lock](…), [_divine decree_](…), … (4 slots)
     *
     * The rank walker takes exactly ONE line per rank bullet, so the remainder matched no slot
     * pattern and hit the walker's terminal "not a slot line — stop" break, which abandons the
     * whole rest of the block. Rinnarv shipped rank 7 with one spell of ten and ranks 8, 9 and 10
     * — the top of a 20th-level cleric's list, Sunburst and Miracle included — not at all. The
     * orphaned text then fell through to the prose branch and was glued onto Attack of Opportunity,
     * 509 characters of spell names inside an ability body.
     *
     * A line that RESUMES with a comma continues the line above it and never starts a new entry, so
     * it is stitched back before the split. Measured over the 4,791 corpus this touches 4 records
     * (+32 spells, +3 rank buckets, the other three a stray space before a comma) and 0 of the 663
     * hazards. A BLANK line before the comma is a real paragraph break — the Marut's "regeneration
     * 15" note is written `**HP** 230\n\n, regeneration 15 …` — so it is deliberately not matched. */
    .replace(/\r?\n[ \t]*,/g, ',')

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // ── parser state ─────────────────────────────────────────────────────────
  const attacks     = []
  const abilities   = []
  const spellcasting = []
  let rituals

  const SKIP = new Set([
    'AC','HP','Fort','Ref','Will','Speed','Source','Perception','Languages',
    'Skills','Items','Str','Dex','Con','Int','Wis','Cha',
    'Immunities','Resistances','Weaknesses','Damage','Melee','Ranged',
    // Sub-headings of AoN's Recall Knowledge sidebar. Same bold shape as an ability, but they are
    // the "which skill identifies this creature" note, not something the creature can do.
    'Unspecific Lore','Specific Lore',
    /* A stat-block field AoN prints for anything that occupies more than one square: "**Space**
     * 100 feet long, 20 feet wide, 25 feet high" (the Bone Ship). Exactly the row shape as Speed,
     * listed two lines above; it was simply never added. 2 instances. */
    'Space',
    /* AoN'S DEITY SIDEBAR, PRINTED INSIDE THE CREATURE PAGE. Treerazer, Lorthact and Caeto
     * Vulaunex carry the whole blurb; the cleric NPCs (Sepoko, Zorek, Ordwi, Satinder Morne, …)
     * carry its Divine Font row. Every row is a bold label followed by a comma list, so all of them
     * came out as abilities — Treerazer shipped EIGHT, and his stat block listed "Favored Weapon
     * greataxe" and "Domains destruction, nature, nightmares, tyranny" among the things he can DO.
     * They describe the faith, not the monster. 25 instances across 11 creatures. */
    'Areas of Concern','Edicts','Anathema','Domains',
    'Divine Font','Divine Skill','Divine Attribute','Favored Weapon','Follower Alignments',
    /* THE ICONIC-NPC CHARACTER SHEET. The Kingmaker and Mwangi Expanse NPCs (Amiri, Ekundayo,
     * Jubilost, Linzi, Nok-Nok, Tristian, Valerie, Ekene, Muruwa, …) are printed as PC sheets, so
     * the entry ends in the build rows a player would fill in. Each became an ability whose body is
     * a comma list of feat names: Amiri (Level 11) shipped "Skill Feats — Forager, Intimidating
     * Glare, Intimidating Prowess, …" as a monster ability. That is what the NPC picked at
     * level-up, not something they can do at the table, and the feats that MATTER are already
     * printed above as their own bold rows. 88 instances across 21 creatures.
     * AoN's own copy is inconsistently spaced ("**Skill  Feats**"), hence the collapse below. */
    'Ancestry Feat','Ancestry Feats','Class Feat','Class Feats','General Feat','General Feats',
    'Skill Feat','Skill Feats','Class Abilities','Formula Book','Research Field',
    'Patron','Bloodline',
  ])

  /* Bolded lines that CONTINUE the ability above rather than starting a new one. Every one of these
   * is a labelled clause of a single stat-block entry; see the fold below for why they are merged
   * instead of dropped. */
  const CONTINUATION = new Set([
    'Critical Success','Success','Failure','Critical Failure',
    'Requirements','Frequency','Prerequisites','Special','Onset','Maximum Duration',
    /* 'Saving Throw' is the first clause of an AFFLICTION, not an ability of its own. AoN usually
     * writes it inline, but three creatures put a <br /> in front of it, so the preprocessor gave it
     * its own line and it matched the ability-header pattern: Equendia's "Blackfrost Rot" shipped
     * with only its flavour text, beside a detached "Saving Throw" ability holding the DC and all
     * three stages. Same for the Bloom of Lamashtu's "Bloom Curse" and the Sporeborn Myceloid's
     * "Purple Pox", whose Stage lines then folded into the orphan rather than into the disease.
     * 3 of 4,791 — the whole corpus. */
    'Saving Throw',
    'Stage 1','Stage 2','Stage 3','Stage 4','Stage 5','Stage 6','Stage 7',
    /* An affliction's save line is the same clause chain as the Stage rows already listed here —
     * "**Saving Throw** DC 30 Fortitude; **Stage 1** …" — and belongs to the affliction above it.
     * It was splitting off into its own ability instead, so Equendia's Blackfrost Rot shipped with
     * no DC and no stages, next to a phantom "Saving Throw". 3 instances. */
    'Saving Throw',
  ])

  /* AN ABILITY AoN FORGOT TO BOLD.
   *
   * Draconic Codex and a long tail of Adventure Path stat blocks print some entries with no bold
   * marker at all, sitting in the same column as the bolded ones:
   *
   *     **Cha** +6
   *
   *     Magic Sense (arcane) The rune dragon is aware of any active magical abilities…
   *     Ironsense The dragon can detect the presence of iron and other ferrous metals…
   *     Canceling Rune <actions string="Reaction" /> **Trigger** … **Effect** …
   *
   * Nothing there starts with '**', so the header branch never sees it, and with no ability open
   * yet the continuation branch refuses it too — the line falls out at the terminal `i++`.
   * Measured over the 4,791 corpus: 111 paragraphs on 79 creatures, and they are whole ABILITIES,
   * not asides. The Rune Archdragon lost Magic Sense, Runic Scales, Canceling Rune AND Retributive
   * Rune; every brine dragon lost Aquatic Echolocation; the Sandpoint Devil and the Frost Troll
   * lost Attack of Opportunity.
   *
   * The name is 1-5 Title-Case words, joiners allowed after the first. */
  const UNBOLD_ABILITY = /^([A-Z][A-Za-z'’!-]*(?:\s(?:[A-Z][A-Za-z'’!-]*|of|the|and|or|with|from|by|to)){0,4})\s+\S/

  /* A word that opens a SENTENCE is prose, not a name. Without this the blurb's own paragraphs
   * ship as abilities: "The Eldest have sometimes altered…" as "The Eldest", "Kapoacinths dwell
   * not amid cliffs…" as "Kapoacinths". 2,526 such junk abilities before the list, 79 real ones
   * after. The run is trimmed from the RIGHT too, so "Ironsense The dragon can…" is named
   * Ironsense rather than "Ironsense The". */
  const SENTENCE_OPENER = new Set([
    'a','an','the','this','these','those','he','she','it','they','their','its','his','her','you','your',
    'when','whenever','while','if','once','each','every','any','all','as','on','in','at','for','to','from',
    'with','most','many','some','such','after','before','upon','unlike','there','both','during','because',
    'although','though','creature','creatures','other','others','no','not','only','even','since','by','of',
    'and','or',
  ])

  /* Where the stat block starts. **Source** is its first line and occurs exactly once in every one
   * of the 4,791 markdowns, which makes it a safer boundary than the <title level="2"> the
   * preprocessor above has already thrown away: 168 creatures open the blurb with a level-2
   * sub-heading of their own (Sinspawn's "Sinspawn Sins", the Jabberwock's variants). Prose ABOVE
   * this line is the flavour blurb — RawCreature.flavor's job, not an ability. */
  const statBlockAt = lines.findIndex((l) => l.startsWith('**Source**'))

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    /* ── Strikes ─────────────────────────────────────────────────────────
     * AoN prints a Strike in TWO layouts, and this branch tested `line === '**Melee**'` by exact
     * equality, so only the vertical one was ever seen:
     *
     *     **Melee**                            |  **Melee** <actions string="Single Action" />
     *     <actions string="Single Action" />   |  jaws +10 ([agile](…)), **Damage** 1d6+5 …
     *     jaws +10 ([agile](…)),               |
     *     **Damage** 1d6+5 bludgeoning         |
     *
     * The one-line layout is what AoN uses inside a <li> ("…and the following Strikes" — Stone Lion,
     * Stone Lion Cub) and inside a <br />-separated variant table (Tehialai-Thief-Of-Ships prints
     * SEVEN Strikes and shipped two). The preprocessor turns both into their own lines, so all 43 of
     * them fell through to the ability branch, where "Melee" is in SKIP and the entire Strike — name,
     * bonus, traits, damage, cost — was discarded. 16 creatures; Stone Lion, Stone Lion Cub,
     * Sinspawn, Taljjae and Clockwork Fabricator each shipped `attacks: []`. */
    const strikeM = line.match(/^\*\*(Melee|Ranged)\*\*\s*(.*)$/)
    if (strikeM) {
      const range  = strikeM[1]
      const inline = strikeM[2].trim()
      i++

      let actionStr = '', nameLine = '', damage = ''
      if (inline) {
        /* Sarcovalt Swarm writes the damage label unbolded, so the split is on the word rather than
         * on `**Damage**` — case-sensitively, because "damage" also occurs inside the damage text
         * itself ("plus 1 persistent bleed damage"). */
        const cut = inline.search(/\*{0,2}Damage\*{0,2}\s/)
        nameLine = cut === -1 ? inline : inline.slice(0, cut).replace(/[,\s]+$/, '')
        if (cut !== -1) damage = clean(inline.slice(cut).replace(/\*{0,2}Damage\*{0,2}\s/, '')).trim()
        actionStr = extractActionsStr(inline)
      } else {
        // optional action string line
        if (i < lines.length && lines[i].includes('<actions')) {
          actionStr = extractActionsStr(lines[i])
          i++
        }
        // name + bonus line: "dogslicer +7 ([Agile](...), [Backstabber](...)),"
        if (i < lines.length) {
          nameLine = lines[i]
          i++
        }
        // damage line
        if (i < lines.length && lines[i].startsWith('**Damage**')) {
          damage = clean(lines[i].slice('**Damage**'.length)).trim()
          i++
        }
      }

      /* Stone Lion spells the cost as the bracket token `[one-action]` rather than an <actions> tag.
       * It has to come off the name line either way — otherwise it is read as part of the weapon
       * name — so the cost is taken from it instead of being thrown away. */
      const BRACKET_COST = /\[((?:one|two|three|free)[-\s]actions?|reaction)\]/i
      const bracketM = nameLine.match(BRACKET_COST)
      if (bracketM && !actionStr) actionStr = bracketM[1].replace('-', ' ')

      /* `^(.+?)\s+([+-]\d+)` demanded exactly one space before the sign and none after it, so AoN's
       * other spacings failed to match and the `if (name)` guard below then dropped the whole
       * Strike: "pseudopod + 14" (Mimic, which shipped `attacks: []`), "claw+17" (Vampire Count),
       * "_rapier_+24" (Scarlet Triad Agent), "mandibles + 12" (Giant Mantis). 15 Strikes. */
      let name = '', bonus = 0, traits = []
      const cleaned = clean(nameLine.replace(/<actions\b[^>]*\/>/g, '').replace(BRACKET_COST, ''))
      const nm = cleaned.match(/^(.+?)\s*([+-]\s*\d+)/)
      if (nm) {
        name  = nm[1].trim()
        bonus = parseInt(nm[2].replace(/\s+/g, ''))
      }
      // extract traits from the ([Name](url), ...) section of the raw line
      // find the paren block that starts with ([
      const traitBlockM = nameLine.match(/\((\[.+)\),?\s*$/)
      if (traitBlockM) {
        // extract each [Name](url) link and strip to just the name
        const traitMatches = [...traitBlockM[1].matchAll(/\[([^\]]+)\]\([^)]+\)/g)]
        traits = traitMatches.map(m => m[1].trim()).filter(Boolean)
      }

      if (name) {
        /* The strike's ACTION COST. `actionStr` was read from the <actions> line above and then
         * never used again, so every Melee/Ranged line lost the ◆ AoN prints beside it — 9,487
         * strikes across 4,546 creatures. 9,451 are Single Action, 7 are Two Actions, and 29 carry
         * a deliberately EMPTY string; the empty ones must stay costless rather than defaulting to
         * one action, which is why this passes actionStr through unchanged. */
        attacks.push({
          range, name, attack: bonus, traits, damage, types: [], effects: [],
          activity: actionStringToRaw(actionStr),
        })
      }
      continue
    }

    /* ── Rituals ────────────────────────────────────────────────────────
     * AoN writes them exactly like a spell block but under its own header:
     *
     *     **Rituals** DC 32
     *     - **2nd**
     *     [Create Undead](/Rituals.aspx?ID=10)
     *
     * "Rituals" does not end in "Spells", so the spell-header branch never saw it and 258 creatures
     * shipped with none — even though RawCreature.rituals and a finished renderer
     * (StatBlock.tsx `case 'rituals'`) have been waiting for them all along. */
    /* AoN prefixes the block with the tradition — `**Divine Rituals** DC 26`, `**Occult
     * Rituals**` — and anchoring on `**Rituals**` alone missed all of them. ~51 creatures lost
     * every ritual AND gained a junk ability whose whole body was "DC 26": Balisse lost
     * Angelic Messenger/Geas/Atone, Mengkare six including Imprisonment, and Kepgeda the
     * Create Undead its entire encounter is built around. */
    const ritualHeaderM = line.match(/^\*\*(?:[A-Za-z]+\s+)?Rituals?\*\*\s*(?:DC\s*(\d+))?/i)
    if (ritualHeaderM) {
      const ritualDc = ritualHeaderM[1] ? parseInt(ritualHeaderM[1]) : undefined
      i++
      const casts = []
      while (i < lines.length) {
        const rl = lines[i]
        const rankM = rl.match(/^-\s+\*\*(\d+)(?:st|nd|rd|th)?(?:\s+rank)?\*\*/i)
        if (!rankM) break
        const lvl = parseInt(rankM[1])
        i++
        const names = []
        if (i < lines.length && !lines[i].match(/^-\s+\*\*/) && !lines[i].match(/^\*\*/)) {
          names.push(...harvestSpells(lines[i]).spells.map((sp) => sp.name))
          i++
        }
        if (names.length) casts.push({ rank: `${lvl}${ordSuffix(lvl)}`, level: lvl, names })
      }
      if (casts.length) rituals = { ...(ritualDc ? { dc: ritualDc } : {}), casts }
      continue
    }

    // ── Spellcasting detection ──────────────────────────────────────────
    /* The header may carry a FOCUS POOL after the word Spells:
     *
     *     **Cleric Domain Spells 1 Focus Point,** DC 21
     *
     * The old pattern demanded `**` immediately after "Spells", so a header like this matched
     * NOTHING and the entire spellcasting block was skipped — not just the pool size. 185 creatures
     * lost a whole block of spells that way. The tail is now captured so the pool can be read out
     * of it, but it accepts ONLY that suffix: a permissive `[^*]*?` let `.+?Spell` run deep into
     * AoN also writes the word order BOTH ways — `**Divine Spells Prepared**`, `**Occult Spells
     * Known**` — so "Spells" is not always the last word. Abstalar Zantus lost all 20 of his
     * prepared cleric spells to that alone. Hence the optional Prepared/Known tail.
     *
     * The line and turned 307 abilities into bogus spellcasting blocks named things like
     * `Hellish Revenge** <actions string="Reaction" />`.
     *
     * The name is `[^*]+?` rather than `.+?` for the same reason, and that part is a PRE-EXISTING
     * fix: `.` matches `*`, so `**Enkaar, the Malformed Prisoner**: …spell…` let the name run
     * through the closing `**` and on to a later "spell", inventing 15 spellcasting blocks out of
     * deity blurbs and reaction abilities on 6 creatures. */
    /* The FOCUS POOL and the DC float freely around this header; only one arrangement was read.
     * Across the 251 creatures whose markdown says "Focus Point", AoN writes it five ways:
     *
     *     **Cleric Domain Spells** DC 24, 1 Focus Point             pool after the bold (majority)
     *     **Cleric Domain Spells** 2 Focus Points, DC 25            pool before the DC
     *     **Monk Focus Spells** DC 32, attack +25, (3 Focus Points) parenthesised
     *     **Druid Order Spells, 1 Focus Point** DC 28               comma before an in-bold pool
     *     **Cleric Domain Spells (2 Focus Points),** DC 29          parenthesised in-bold pool
     *
     * Only `Spells 1 Focus Point,` was accepted, so 183 blocks lost their pool size: Champion
     * Devotion Spells on the Aasimar Redeemer, Bard Composition Spells on the Advisor, every
     * "DC nn, n Focus Point" caster in the corpus. The two shapes that put the pool between the
     * closing `**` and the DC also cost the DC, because the DC was only read when it sat
     * immediately after the `**` — the Deathless Hierophant of Urgathoa's `2 Focus Points, DC 25`
     * came out with no DC at all. And the two in-bold shapes above matched NOTHING, so the whole
     * block was dropped and re-emitted as an ability; Raja-Krodha and Nilak lost their focus
     * spells that way. So: tolerate `(` / `,` around an in-bold pool, and hunt the pool and the DC
     * anywhere in the rest of the line rather than demanding one fixed order. 12 DCs and 183 pools
     * recovered, 4 whole blocks restored, no DC or pool changed.
     *
     * AoN never writes the pool on a FOLLOWING line in this corpus (measured: zero standalone
     * pool lines over 4,791 creatures), so nothing here looks past the header line. */
    const spellHeaderM = line.match(/^\*\*([^*]+?Spells?(?:\s+(?:Prepared|Known))?)((?:[,\s(]*\d+\s+Focus\s+Points?\)?)?[,\s]*)\*\*\s*(.*)/i)
    if (spellHeaderM) {
      const scName = spellHeaderM[1].trim()
      const headerTail = `${spellHeaderM[2] ?? ''} ${spellHeaderM[3] ?? ''}`
      const focusM = headerTail.match(/(\d+)\s*Focus\s*Points?/i)
      const focusPoints = focusM ? parseInt(focusM[1]) : undefined
      const dcM = headerTail.match(/DC\s*(\d+)/i)
      const dcVal  = dcM ? parseInt(dcM[1]) : undefined

      /* AN ABILITY MAY SIMPLY BE CALLED "…Spell".
       *
       * This branch runs BEFORE the ability branch and fires on any bold ending in Spell/Spells, so
       * genuine abilities — Counterspell, Reach Spell, Absorb Spell, Soul Spells, Overambitious
       * Spell — were parsed as spellcasting blocks with no rank lines. Since empty blocks are now
       * dropped, they vanished outright: 83 abilities across 73 creatures, rules text and all.
       *
       * A real caster block always announces itself: a DC, a tradition or class in the name, a
       * casting-type word, or a `- **Nth**` rank bullet on the very next line. Absent every one of
       * those this is an ability, so DON'T `continue` — fall out of the branch and let the ability
       * branch below claim the same line. */
      const CASTER_WORD = /\b(?:arcane|divine|occult|primal|innate|prepared|spontaneous|focus|cantrips?|ritual|bloodline|domain|devotion|hex|ki|warden|composition|school|apparition)\b/i
      const isCasterBlock = dcVal !== undefined
        || CASTER_WORD.test(scName)
        || /^-\s+\*\*/.test(lines[i + 1] ?? '')
      if (isCasterBlock) {

      // parse tradition + type from name
      const words = scName.toLowerCase().split(/\s+/)
      const TRADITIONS = new Set(['arcane','divine','occult','primal'])
      const tradition = TRADITIONS.has(words[0]) ? words[0] : ''

      let type = 'Innate'
      if (/innate/i.test(scName))       type = 'Innate'
      else if (/prepared/i.test(scName)) type = 'Prepared'
      else if (/spontaneous/i.test(scName)) type = 'Spontaneous'
      else if (/focus/i.test(scName))    type = 'Focus'
      else if (/cantrips/i.test(scName)) type = 'Cantrips'

      // check for "Attack +N" on same line
      let attack
      const atkM = line.match(/Attack\s+([+-]\d+)/i)
      if (atkM) attack = parseInt(atkM[1])

      i++

      // collect slot lines
      const entry = {}
      while (i < lines.length) {
        const sl = lines[i]
        // stop if we hit a new bold header that isn't a slot line
        if (sl.match(/^\*\*[^*]+\*\*/) && !sl.startsWith('- **')) {
          break
        }

        // slot header: "- **Cantrips (Nth)**" or "- **Nth**" or "- **Nth rank**" or "- **Constant (Nth)**"
        const cantripM  = sl.match(/^-\s+\*\*Cantrips\s*\((\d+)(?:st|nd|rd|th)?\)\*\*/i)
        const constantM = sl.match(/^-\s+\*\*Constant\s*\((\d+)(?:st|nd|rd|th)?\)\*\*/i)
        const rankM     = sl.match(/^-\s+\*\*(\d+)(?:st|nd|rd|th)?(?:\s+rank)?\*\*/i)

        if (cantripM) {
          const lvl = parseInt(cantripM[1])
          i++
          // next line has spells
          const spells = []
          let rankSlots
          if (i < lines.length && !lines[i].match(/^-\s+\*\*/) && !lines[i].match(/^\*\*[^*]+\*\*[^(]/)) {
            const spellLine = lines[i]
            const got = harvestSpells(spellLine)
            spells.push(...got.spells)
            rankSlots = got.slots
            i++
          }
          entry['0'] = { level: lvl, spells, ...(rankSlots ? { slots: rankSlots } : {}) }
          continue
        }

        if (constantM) {
          const lvl = parseInt(constantM[1])
          i++
          const spells = []
          let rankSlots
          if (i < lines.length && !lines[i].match(/^-\s+\*\*/)) {
            const spellLine = lines[i]
            const got = harvestSpells(spellLine)
            spells.push(...got.spells)
            rankSlots = got.slots
            i++
          }
          entry[`constant-${lvl}`] = { level: lvl, spells, ...(rankSlots ? { slots: rankSlots } : {}) }
          continue
        }

        if (rankM) {
          const lvl = parseInt(rankM[1])
          i++
          const spells = []
          let rankSlots
          if (i < lines.length && !lines[i].match(/^-\s+\*\*/) && !lines[i].match(/^\*\*[^*]+\*\*[^(]/)) {
            const spellLine = lines[i]
            const got = harvestSpells(spellLine)
            spells.push(...got.spells)
            rankSlots = got.slots
            i++
          }
          entry[String(lvl)] = { level: lvl, spells, ...(rankSlots ? { slots: rankSlots } : {}) }
          continue
        }

        // not a slot line — stop
        break
      }

      /* A block with NO spells is noise, not data. AoN's "Dragon Spellcasters" sidebar prints a
       * variant table — "**Young Magma Dragon** <br /> **Primal Prepared Spells** DC 28 … " — whose
       * ranks are written INLINE rather than as bullets, so the rank walker finds nothing and the
       * block comes out empty. Those belong to OTHER creatures anyway (the Ancient's record was
       * carrying three phantom "Primal Prepared Spells" headers describing the Young and Adult), so
       * attaching their spells here would be worse than dropping them. 170 empty blocks on 108
       * creatures. A block that legitimately has no list has nothing to render either way. */
      if (!Object.keys(entry).length && !focusPoints) {
        /* `**Signature Spells**  Jesseri can heighten heal and lightning bolt to any level for which
         * she has an available spell slot.` is an ABILITY, not a caster block. It is AoN's legend for
         * the mark it prints beside a spontaneous caster's signature spells — a superscript S on King
         * Merlokrep, an asterisk on Harmony in Agony. It ends in "Spells", so the header pattern above
         * claimed it, found no `- **Nth**` bullets under it, and the empty-block drop threw the whole
         * sentence out with the block: 0 of 9 captured, in the shipped data and in this parser alike.
         *
         * The marks themselves are deliberately NOT carried onto the individual spells. `<sup>S</sup>`
         * occurs on ONE creature in 4,791, so a `signature` flag would have to thread through
         * RawSpellcasting, parseCreature and StatBlock to render for King Merlokrep alone — while this
         * sentence names the spells outright on 8 of the 9. The <sup> wrapper is stripped so his S
         * survives as text instead of leaking raw markup into the body. AoN's separate legend ROW,
         * `**<sup>S</sup> Signature spell <sup>E</sup> emotion spell**`, also ends in "spell", so it
         * still lands here with an empty block and is still dropped — which is what it deserves. */
        if (/^Signature Spells?$/i.test(scName)) {
          const legend = clean(line.slice(spellHeaderM[0].length).replace(/<[/]?sup>/gi, '')).trim()
          if (legend) abilities.push({ name: scName, activity: undefined, traits: [], trigger: undefined, entries: [legend] })
        }
        continue
      }

      spellcasting.push({
        name:      scName,
        tradition,
        type,
        DC:        dcVal,
        ...(focusPoints ? { focusPoints } : {}),
        attack,
        entry,
      })
      continue
      } // end isCasterBlock — a bold merely ENDING in "Spell" falls through to the ability branch
    }

    // ── Ability detection ───────────────────────────────────────────────
    /* AoN writes an ability name FOUR ways, and only the first was accepted:
     *
     *     **Name**                         plain
     *     **[Name](url)**                  link inside the bold   (fixed earlier)
     *     [**Name**](url)                  bold inside the LINK
     *     **[Name](url) (aura, olfactory)**  bold wrapping link + suffix
     *
     * The third and fourth start with `[` or carry a trailing suffix, so `^\*\*([^*]+)\*\*`
     * never matched and the whole ability vanished — ~270 creatures. The Ofalth Stampede lost
     * `[**Stench**](…) (aura, olfactory) 30 feet, DC 33` outright; the Despair Archdragon lost
     * Frightful Presence, Consume Fear and Unbidden Thoughts. */
    const abilityM = line.match(/^\*\*([\s\S]+?)\*\*\s*(.*)/)
      || line.match(/^\[\*\*([^*\]]+)\*\*\]\([^)]*\)\s*(.*)/)
    if (abilityM) {
      /* AoN LEAVES THE NAME'S BOLD UNCLOSED, so the lazy `**…**` above runs past the end of the
       * name and swallows the whole header:
       *
       *     **Guardian Spirit <actions string="Reaction" /> **Trigger** The taiga giant has …
       *
       * 28 abilities on 26 creatures shipped a name like `Guardian Spirit <actions
       * string="Reaction" />` — Taiga Giant, Grendel, Warden, Kasesh, Lacridaemon, Desert Drake,
       * Vehanezhad — which no search matches, and the reaction glyph went with it because
       * extractActionsStr only ever reads `rest`. An ability name never contains an action tag,
       * so cut there and hand the remainder back to `rest`, which recovers the action cost (+28)
       * and the trait parenthesis as well. */
      const cut     = abilityM[1].search(/<actions\b/i)
      const rawName = cut === -1 ? abilityM[1] : abilityM[1].slice(0, cut)
      const rest    = (cut === -1 ? '' : abilityM[1].slice(cut) + ' ') + (abilityM[2] ?? '')

      /* AoN writes shared monster abilities as `**[Change Shape](/MonsterAbilities.aspx?ID=8)**`.
       * The original skipped anything starting with '[', which silently discarded 1,903 of them.
       * Unwrap the link to its display text instead — that IS the ability name. */
      const unlinked = rawName.trim().replace(/^\[([^\]]+)\]\([^)]*\)$/, '$1').trim()

      // skip SKIP set names. AoN double-spaces some labels ("**Skill  Feats**" on Ekundayo Level
      // 6), so collapse runs of whitespace before the lookup rather than listing every spelling.
      if (SKIP.has(unlinked.replace(/\s+/g, ' '))) { i++; continue }
      /* `Recall Knowledge - Humanoid` uses the same link shape but is AoN's flavour sidebar, not an
       * ability. Excluded by name, so the pattern itself stays available to real abilities. */
      if (unlinked.toLowerCase().startsWith('recall knowledge')) { i++; continue }
      // a link we could not unwrap is not a name we can trust
      if (unlinked.startsWith('[')) { i++; continue }
      // skip empty names
      if (!unlinked) { i++; continue }
      /* skip spellcasting headers (already handled above but guard here too) — EXCEPT when an
       * action tag was just cut off the name. A spellcasting block never carries one, so a name
       * that does is an ability, and this guard would otherwise delete the two the cut above
       * finally made readable: Vehanezhad's `Reflect Spell` and the Mythic Lich's `Counterspell`,
       * both of which only survived before because the un-cut name ended in `/>`. */
      /* NO LONGER a blanket skip. The spellcasting branch above now claims a line only when it
       * shows a caster tell (a DC, a tradition/class word, or a rank bullet on the next line), so
       * anything ending in "Spell" that reaches HERE has already been judged not to be a caster
       * block — it is an ability called Counterspell, Reach Spell, Absorb Spell, Soul Spells.
       * Discarding it here would undo that judgement and lose all 83 of them again. */

      // extract action string
      const actionStr = extractActionsStr(rest)
      const activity  = actionStringToRaw(actionStr)

      // remove action tag from rest, then strip markdown links so trait URLs don't break paren parsing
      let restClean = stripLinks(rest.replace(/<actions\s+string="[^"]+"\s*\/>/g, '').trim())

      // extract traits from leading (...)
      let traits = []
      const traitParenM = restClean.match(/^\(([^)]+)\)/)
      if (traitParenM) {
        traits = traitParenM[1].split(',').map(t => clean(t).trim()).filter(Boolean)
        restClean = restClean.slice(traitParenM[0].length).trim()
      }

      // extract trigger
      let trigger
      /* AoN writes "**Trigger** X. **Effect** Y" at least as often as it uses a semicolon, but this
       * terminated ONLY on ';' or end-of-line — so the Effect was swallowed into the trigger and
       * `entries` shipped as [""]. StatBlock hides `trigger` in compact style, so ~190 abilities
       * rendered completely BLANK: the Magma Dragon's "Wing Deflection" loses its +2 AC, the
       * Basilisk's "Petrifying Glance" ships entries [";"]. Stop at **Effect** too. */
      const triggerM = restClean.match(/\*\*Trigger\*\*\s*([\s\S]+?)(?:;|(?=\*\*Effect\*\*)|$)/)
      if (triggerM) {
        trigger = clean(triggerM[1]).trim()
        // remove from restClean
        restClean = restClean.replace(/\*\*Trigger\*\*\s*[\s\S]+?(?:;|(?=\*\*Effect\*\*)|$)/, '').trim()
      }

      /* AoN writes an ability's labelled clauses in one chain:
       *
       *     **Frequency** once per round; **Effect** The brigade engages in a coordinated…
       *
       * The original kept only what followed **Effect**, by replacing a GREEDY "dot-star, then the
       * bolded word Effect, then whitespace" pattern with the empty string.
       *
       * Dot-star runs to the LAST **Effect** and everything before it is deleted — so Frequency,
       * Requirements, Cost, Prerequisites and Saving Throw were destroyed. Measured over the 4,791
       * corpus: 2,571 clauses across 1,827 creatures, 347,819 characters of rules text.
       *
       * The clauses are now simply left in place. `clean()` strips the bold markers, and
       * ABILITY_LINE_MARKERS in StatBlock.tsx already colour-codes "Frequency" and "Requirements"
       * when it meets them in a body — so this renders the way AoN prints it with no UI change.
       *
       * They are deliberately NOT hoisted into RawAbility.requirements/frequency: the runtime
       * `Ability` type has neither field, so parseCreature would drop them again, and StatBlock
       * derives its live "uses remaining" chip by reading Frequency OUT of `entries`. Hoisting
       * would have silently killed 1,057 of those chips. */
      /* A CLAUSE LABEL WELDS ONTO THE CLAUSE BEFORE IT. AoN separates an ability's labelled
       * clauses with the bold markers alone and no punctuation —
       *
       *     **Frequency** once per day **Effect** Drawing upon the power of their grogrisant…
       *
       * — and clean() strips those markers, so the delimiter is gone by the time StatBlock sees
       * the text. ABILITY_LINE_MARKERS can only break after ". " or "; ", so the label stayed
       * inline and the ability rendered as one unlabelled run: the Grisantian Lion's Blinding
       * Mane read "Frequency once per day Effect Drawing upon…", and the Maftet Guardian's
       * Paired Strike hid its Effect behind its Requirements. 116 run-on lines, 103 creatures.
       *
       * The bold IS the delimiter, so it becomes a real newline HERE rather than being guessed
       * at from punctuation downstream — both StatBlock prose renderers already split on \n, and
       * a renderer-side rule would have to fire on any capitalised "Effect" in open prose.
       * Restricted to the labels StatBlock colour-codes; affliction clauses (Saving Throw /
       * Maximum Duration / Stage N, 8 more) stay inline because AoN prints an affliction as one
       * paragraph, and breaking only some of its clauses reads worse than breaking none. */
      const description = clean(restClean.replace(
        /(?!^)\*\*\s*(Critical Success|Critical Failure|Success|Failure|Effect|Trigger|Requirements?|Frequency|Routine|Reset)\s*\*\*/g,
        '\n**$1**')).trim()

      /* A DEGREE OF SUCCESS BELONGS TO THE ABILITY ABOVE IT.
       *
       * AoN puts each outcome of a saving throw on its own bolded line:
       *
       *     **Cacophonous Roar** <actions string="Two Actions" /> … DC 34 Will save …
       *     **Critical Success** The creature is unaffected.
       *     **Success** The creature is frightened 1.
       *     **Failure** The creature is frightened 2 …
       *
       * Those match the ability-header pattern exactly, so the parser emitted FIVE abilities where
       * the stat block has one — the Jotund Troll shipped with `Critical Success`, `Success`,
       * `Failure` and `Critical Failure` listed as abilities in their own right, detached from the
       * roar that causes them.
       *
       * They are FOLDED IN rather than skipped: skipping is what loses the outcome text entirely,
       * which is the other half of the same bug. With no preceding ability to attach to they fall
       * through and are kept as-is, so nothing is silently dropped either way. */
      if (CONTINUATION.has(unlinked) && abilities.length) {
        const prev = abilities[abilities.length - 1]
        /* JOINED WITH A NEWLINE, NOT A SPACE. StatBlock.tsx re-splits the folded body on
         * ABILITY_LINE_MARKERS, whose lookbehind is `(?<=\.\s|\;\s|^)` — a clause only opens a new
         * rendered line when the clause BEFORE it happened to end in a period, and Stage/Onset/
         * Maximum Duration are not in that marker list at all. AoN routinely omits the period
         * ("...takes half damage Failure The creature takes full damage"), so those outcomes
         * rendered as one unreadable run-on. Measured over the 4,791 corpus: 30 folds in 24
         * abilities across 22 creatures — the Divine Warden of Nethys's "Divine Destruction" ran
         * Failure into Critical Failure, the Boggard Cultist's "Gogunta's Croak" ran Success into
         * Failure, and the Sporeborn Myceloid's purple pox printed Onset and Stages 1-3 as a single
         * paragraph. A real newline splits regardless of punctuation, matches the per-action damage
         * table fold below, and is faithful to AoN, which wrote these as separate bolded lines.
         * parseCreature.splitMergedAbility tests AB_SUBHEADER_RE first and every CONTINUATION label
         * is in it, so none of the 20,257 runtime abilities is carved back apart. */
        prev.entries = [[...prev.entries, `${unlinked} ${description}`.trim()].join('\n').trim()]
        i++
        continue
      }

      abilities.push({
        name:     unlinked,
        activity,
        traits,
        trigger,
        entries:  [description],
      })
      i++
      continue
    }

    /* Re-bold an entry AoN left unbolded (see UNBOLD_ABILITY) and re-run the line, so its traits,
     * <actions> cost and Trigger/Effect are read by the header branch above exactly the way a
     * bolded one is, instead of a second copy of that parsing living down here.
     *
     * Only while no ability is open: once one is, the continuation branch below owns the leftover
     * prose, and stealing "While raised in this way…" out of the Resurrection Archdragon's Arise!
     * would invent an ability called "While". And never on the line directly under a BARE bold
     * header — "**Skills**", "**Items**" and "**Immunities**" put their value on the next line, and
     * "up to 3 runes of 18th level or lower etched upon their scales" is the same shape as
     * "Ironsense The dragon can…". */
    const unbolded = (statBlockAt >= 0 && i > statBlockAt && !abilities.length &&
                      !/^\*\*[^*]+\*\*$/.test(lines[i - 1] ?? ''))
      ? line.match(UNBOLD_ABILITY) : null
    if (unbolded) {
      const words = unbolded[1].split(/\s+/)
      while (words.length > 1 && SENTENCE_OPENER.has(words[words.length - 1].toLowerCase())) words.pop()
      if (!SENTENCE_OPENER.has(words[0].toLowerCase())) {
        lines[i] = `**${words.join(' ')}**${line.slice(words.join(' ').length)}`
        continue
      }
    }

    /* A SUB-BLOCK HEADING OPENS AN ENTRY; IT DOES NOT CONTINUE THE ONE ABOVE IT.
     *
     * AoN titles the sections of an aside with an ATX heading:
     *
     *     ### The General
     *      Carved scars mark the face of this severe mask…
     *
     * A '#' line is not bold, '- ' or '<', so it fell past every branch into the prose fold below
     * and was glued — hashes and all — onto whatever ability came last. Each of Taljjae's seven
     * masks therefore landed inside the PREVIOUS mask's entry ("…once per day. ### The Grandmother
     * The kind eyes of this mask…"), filing every description under the wrong mask, and Lorthact's
     * "Follower Alignments" shipped as "LE, NE ### Devotee Benefits". 8 headings, 2 creatures —
     * the whole corpus.
     *
     * Pushed as an entry of its own so the prose under it attaches to the section it names. The
     * body starts empty and the fold below fills it, exactly as for a bold ability header. */
    const headingM = line.match(/^#{1,6}\s+(\S.*?)\s*#*$/)
    if (headingM) {
      const headingName = clean(headingM[1]).trim()
      if (headingName) {
        abilities.push({ name: headingName, activity: undefined, traits: [], trigger: undefined, entries: [''] })
        i++
        continue
      }
    }

    /* PROSE THAT CONTINUES THE ABILITY ABOVE IT.
     *
     * The loop ends in a bare `i++`: any line that is not a bold header, a rank bullet, an
     * <actions> row or Melee/Ranged was simply DISCARDED. AoN routinely breaks an ability across
     * paragraphs, and it hard-wraps mid-sentence, so ~350 creatures shipped an ability whose text
     * stops partway. Lerritan's "Tenacious Flames" reads "100 feet. Creatures in the emanation" and
     * then nothing — the aura has no effect at all. The Cassisian's "Eye Beams" ends at "releases
     * beams of heat or", losing the damage, the DC, the area and the recharge.
     *
     * So anything left over is appended to the ability it follows. Guarded three ways: there must
     * BE a preceding ability (otherwise this is still the stat-block header region), and lines
     * starting `**`, `- ` or `<` belong to the branches above and must not be stolen from them. */
    /* AoN spells a per-action row TWO ways, and only one of them is a tag. Five creatures write
     * the cost as a bare text token — `[two-actions] 3d8+14 piercing damage` — and `[` is not on the
     * exclusion list, so this branch swallows the row before the per-action damage table below can
     * see it. Worse, its `\s+` collapse also flattens the newline that branch had already put in
     * front of the tagged row above, so the whole table ships as one run-on sentence: the Archon
     * Bastion's "Smiting Lances" ends "◆ 1d8+4 piercing damage [two-actions] 3d8+14 piercing damage
     * [three-actions] 4d8+19 piercing damage". Excluded here for the same reason as `**`, `- ` and
     * `<`: the row belongs to a branch below and must not be stolen from it. The `(?!\()` keeps a
     * real markdown link such as `[reaction](/Traits.aspx?ID=…)` out of the token shape. */
    const ACTION_TOKEN_ROW = /^\[((?:single|one|two|three|free)[-\s]actions?|reaction)\](?!\()\s*(.+)$/i

    if (abilities.length && !ACTION_TOKEN_ROW.test(line) && !line.startsWith('**') && !line.startsWith('- ') && !line.startsWith('<')) {
      const prev = abilities[abilities.length - 1]
      const extra = clean(line)
      /* Collapses spaces and tabs, NOT newlines. \s+ also flattened the line breaks the two folds
       * above had already placed, so one trailing paragraph of flavour text undid them: 10 of the
       * 30 fused degree lines were split correctly by the fold and then re-welded here — the Path
       * River Peeler's "Otherworldly Cry" lost three of its four degrees, the Waxen Effigy's
       * "Enervating Howl" and the Gauntling's "Soul Ravage" one each. Hard-wrapped prose still
       * rejoins with a space via the join(' ') beside it. */
      if (extra) prev.entries = [[...prev.entries, extra].join(' ').replace(/[^\S\n]+/g, ' ').trim()]
      i++
      continue
    }

    /* A PER-ACTION DAMAGE TABLE belongs to the ability above it.
     *
     * A variable-cost ability spells out what each number of actions actually does, written as
     * <br />-separated rows that carry only an action tag and a value:
     *
     *     **Stab from the Saddle** <actions string="Single Action to Three Actions" /> … <br />
     *       <actions string="Single Action" /> 1d6+3 piercing damage<br />
     *       <actions string="Two Actions" /> 2d6+10 piercing damage<br />
     *       <actions string="Three Actions" /> 3d6+14 piercing damage
     *
     * The preprocessor turns each <br /> into a newline, so these arrive as their own lines. They
     * match no header pattern — no bold, no Melee/Ranged — so they fell through to the bare `i++`
     * below and vanished, taking the ONLY statement of what the ability does with them: the body
     * says "The damage depends on the number of actions" and then never says how. 132 creatures.
     *
     * Appended to the preceding ability with the cost rendered as its glyph, so the table reads the
     * way AoN prints it. */
    /* Both spellings feed this one branch. The token's hyphen is normalised away so costGlyph's
     * ACTION_WORD lookup resolves "two-actions" the same way it resolves a tag's "Two Actions". */
    const tokM = line.match(ACTION_TOKEN_ROW)
    const contM = tokM ? [tokM[0], tokM[1].replace('-', ' '), tokM[2]]
                       : line.match(/^<actions\b[^>]*string="([^"]*)"[^>]*>\s*(.+)$/i)
    if (contM && abilities.length) {
      const prev = abilities[abilities.length - 1]
      const row = `${costGlyph(contM[1])} ${clean(contM[2])}`.trim()
      if (row) prev.entries = [[...prev.entries, row].join('\n').trim()]
      i++
      continue
    }

    i++
  }

  return {
    attacks,
    abilities: { top: [], mid: abilities, bot: [] },
    spellcasting,
    ...(rituals ? { rituals } : {}),
  }
}

