/*
 * Build the initiative tracker's bestiary FROM THE ARCHIVES.
 *
 * Until now public/data/bestiary/ was produced by pf2e-tracker/scripts/scrape-aon.mjs, which
 * scraped elasticsearch.aonprd.com live from a different repo on its own schedule. That made the
 * tracker a THIRD data source alongside core.json and the ast trees. This reads the local Archives
 * export instead, so the tracker's stat blocks and the character sheet come from one corpus.
 *
 * The record SHAPE is deliberately unchanged — the tracker's own layout, with attacks, abilities,
 * spellcasting and defenses split into editable fields. Only the source moves.
 *
 * The parsing lives in lib/creature-markdown.mjs, which carries the two silent-loss fixes measured
 * against this corpus (link-named abilities; action costs including ranges). Run
 * scripts/check-creature-parse.mjs after this to confirm every ability header in the markdown
 * survived into the output.
 *
 *   node scripts/build-bestiary.mjs --dry     # counts only, writes nothing
 *   node scripts/build-bestiary.mjs           # write public/data/bestiary + hazards + index
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseAonMarkdown } from './lib/creature-markdown.mjs';
import { appendCreatureTables } from './lib/aon-tables.mjs';

const EXPORT = 'C:/trying ai 2/hh-data-export/without-images/data';
const DATA = 'public/data';
const DRY = process.argv.includes('--dry');

const writeFile = async (p, s) => writeFileSync(p, s);
const mkdir = async (p, o) => mkdirSync(p, o);

function makeResWeak(name, amount) {
  return { name: String(name), amount: typeof amount === 'number' ? amount : num(amount) }
}

/** Parse AoN resistance/weakness field (object map) → array */
function parseResWeakObj(field) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return []
  return Object.entries(field)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([name, amount]) => makeResWeak(name, amount))
}

/*
 * Resistances and weaknesses from the MARKDOWN line rather than the object facet.
 *
 * The facet is lossy in two ways at once. For the Hellknight cavalry brigade AoN prints
 * "area damage 8, splash damage 8" and the facet is `{"area": 8}` — it TRUNCATES the name
 * ("area damage" -> "area") and DROPS the second entry outright, because both keys would collapse
 * to the same bucket. Measured: 621 creatures have more than one weakness.
 *
 * `weakness_markdown` / `resistance_markdown` carry the line verbatim, including notes AoN puts in
 * parentheses ("fire 10 (except cold iron)"), which the object facet has no room for at all.
 */
function parseResWeakMarkdown(md) {
  if (typeof md !== 'string' || !md.trim()) return null
  const out = []
  // Split on commas OUTSIDE parentheses so "(except cold iron)" stays with its entry.
  for (const part of splitTopLevel(stripLinks(md))) {
    const s = part.trim()
    if (!s) continue
    // "<name> <amount>" with an optional trailing "(note)"
    /* The closing paren is OPTIONAL because AoN drops it. Five ghost-type creatures write
     * "all damage 10 (except force, ghost touch, or positive" with no `)` at all, and the Bright
     * Walker closes it and then adds a stray ".". Requiring `\)$` made all five fail this pattern
     * AND the bare pattern below (which forbids parens outright), so parseResWeakMarkdown returned
     * null and the builder fell back to the object facet — which for the Stone Ghost expands one
     * resistance into 28 fake ones ("resists chaotic 5, lawful 5, orichalcum 5"). */
    const m = s.match(/^(.+?)\s+(\d+)\s*(?:\((.+?)\)?\.?)?$/)
    if (m) {
      const entry = { name: m[1].trim(), amount: num(m[2]) }
      if (m[3]) entry.note = m[3].trim()
      out.push(entry)
      continue
    }
    /* A WEAKNESS WITH NO NUMBER IS STILL A WEAKNESS. AoN writes "light vulnerability",
     * "vampire weaknesses", "axe vulnerability", "fear of crabs" — no value attached. Requiring a
     * digit dropped them, and where it was the creature's ONLY weakness the array shipped EMPTY, so
     * the stat block positively asserted "no weaknesses". The Shadow, every vampire, six arboreals
     * and the Berberoka all lost theirs that way (~110 creatures). */
    const bare = s.match(/^([^()]+?)\s*(?:\((.+)\))?$/)
    if (bare && /[A-Za-z]/.test(bare[1])) {
      const entry = { name: bare[1].trim(), amount: null }
      if (bare[2]) entry.note = bare[2].trim()
      out.push(entry)
    }
  }
  return out.length ? out : null
}

/*
 * A DEFENCE ROW THAT SWALLOWED THE NEXT ONE.
 *
 * AoN loses the bold markers that open a defence row, and the row before it then runs straight
 * into the row after with nothing at all between them:
 *
 *     **Weaknesses**                        **Will** +13        **HP** 15
 *     cold iron 15, Resistances fire 15     Immunities cold     (Weaknesses fire 2)
 *
 * Nothing downstream can tell, so the LABEL becomes part of the DATA. Measured over the 4,791
 * corpus: 20 creatures carry a defence row that is wrong or invented because of it. The Defaced
 * Naiad Queen ships a weakness literally named "Resistances fire" and no fire resistance at all;
 * Owb's save note reads "Immunities cold" while its immunity list is empty; the Leaf Leshy's fire
 * weakness — the one thing that kills a leaf leshy — is a parenthetical on its Hit Points; and
 * Raja-Krodha turns immunity to fear, fortune and misfortune into three weaknesses with no value,
 * which is the exact opposite of what the stat block says.
 *
 * A label is a row header only where AoN CAPITALISES it, and that is what separates it from
 * ordinary prose: "vampire weaknesses" (110 creatures), "mythic resistance 7" (24), "object
 * immunities" and "double resistance vs. non-magical" all stay put. HP additionally has to be
 * followed by a number or a one-word part name, so the Talos Gadgeteer's "plus 5 temporary HP
 * (from ablative armor plating)" survives; Fort/Ref/Will/AC count only in front of a modifier, so
 * the 942 real save notes ("+1 status bonus to Will saves vs. mental effects") are untouched
 * while Morlibint's note of "Will +9" — his own Will save, printed a second time — goes.
 *
 * The swallowed row is REAL data, so it moves to the field it names instead of being dropped. An
 * HP label starts a SECOND stat block (a hydra head's, Orochi's), so everything from there on
 * goes back onto the HP note the way AoN itself prints it for Prismhydra and Trighoul, rather
 * than crediting the body with a head's immunities.
 */
function spillDefenceRow(text) {
  const s = String(text ?? '').replace(/<br\s*\/?>/gi, ' ')
  const re = /(?:\*\*)?\b(Immunit(?:y|ies)|Weakness(?:es)?|Resistances?|HP|Fort|Ref|Will|AC)\b(?:\*\*)?[:\s]+/g
  const cuts = []
  for (let m; (m = re.exec(s));) {
    const tail = s.slice(re.lastIndex)
    // "HP 35 (head)", "HP (head) 60", "HP (head)" — never "temporary HP (from ablative armor…)".
    if (m[1] === 'HP' && !/^\d|^\(\w+\)\s*(?:\d|$)/.test(tail)) continue
    if (/^(?:Fort|Ref|Will|AC)$/.test(m[1]) && !/^[+-]?\d/.test(tail)) continue
    cuts.push({ at: m.index, from: re.lastIndex, label: m[1] })
    if (m[1] === 'HP') break
  }
  if (!cuts.length) return null
  /* Splitting a row out of "HP 15 (Weaknesses fire 2)" leaves one half of AoN's parenthesis on
   * each side of the cut, so drop a bracket that has lost its partner. */
  const tidy = (t) => {
    let x = String(t).replace(/\*\*/g, '').replace(/\s+/g, ' ').replace(/^[\s;,]+|[\s;,]+$/g, '').trim()
    while (x.startsWith('(') && !x.includes(')')) x = x.slice(1).trim()
    while (x.endsWith(')') && !x.slice(0, -1).includes('(')) x = x.slice(0, -1).trim()
    return x
  }
  const ROW = { Immunity: 'immunities', Immunities: 'immunities', Weakness: 'weaknesses',
                Weaknesses: 'weaknesses', Resistance: 'resistances', Resistances: 'resistances' }
  const spills = []
  cuts.forEach((c, k) => {
    if (c.label === 'HP') spills.push(['hp', `HP ${tidy(s.slice(c.from))}`])
    else if (ROW[c.label]) spills.push([ROW[c.label], tidy(s.slice(c.from, k + 1 < cuts.length ? cuts[k + 1].at : s.length))])
  })
  return { own: tidy(s.slice(0, cuts[0].at)), spills: spills.filter(([, t]) => t) }
}

/** Give every swallowed defence row back to the field it names. Mutates `defenses`. */
function unmixDefenceRows(defenses) {
  const hp = defenses.hp?.[0]
  const asText = (e) => typeof e === 'string' ? e
    : [e.name, e.amount == null ? '' : e.amount, e.note ? `(${e.note})` : ''].filter((x) => x !== '').join(' ')
  const receive = (label, raw) => {
    const txt = String(raw).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
    if (!txt) return
    if (label === 'hp') { if (hp) hp.name = hp.name ? `${hp.name} ${txt}` : txt; return }
    /* AoN repeats itself: Orochi's resistance row is printed inside the HP note AND carried by the
     * facet, so a spill the row already holds is the same entry, not a second one. */
    for (const e of (label === 'immunities' ? splitList(txt) : parseResWeakMarkdown(txt) ?? []))
      if (!defenses[label].some((x) => JSON.stringify(x) === JSON.stringify(e))) defenses[label].push(e)
  }
  // The HP and save notes first, so a list spilling INTO them is never re-scanned.
  const note = spillDefenceRow(hp?.name)
  if (note && hp) {
    if (note.own) hp.name = note.own; else delete hp.name
    for (const [l, t] of note.spills) receive(l, t)
  }
  const save = spillDefenceRow(defenses.savingThrows?.note)
  if (save) {
    if (save.own) defenses.savingThrows.note = save.own; else delete defenses.savingThrows.note
    for (const [l, t] of save.spills) receive(l, t)
  }
  for (const label of ['immunities', 'resistances', 'weaknesses']) {
    const list = defenses[label]
    const at = list.findIndex((e) => spillDefenceRow(asText(e)))
    if (at < 0) continue
    const cut = spillDefenceRow(asText(list[at]))
    // AoN comma-split the row before we ever saw it, so everything after the label is the new row.
    const rest = list.slice(at + 1).map(asText).join(', ')
    defenses[label] = list.slice(0, at)
    receive(label, cut.own)
    if (cut.spills.length) cut.spills.forEach(([l, t], k) =>
      receive(l, k === cut.spills.length - 1 ? [t, rest].filter(Boolean).join(', ') : t))
    else receive(label, rest)
  }
}

/*
 * HAZARD LABELLED BLOCKS — Disable, Routine, Reset.
 *
 * AoN puts the label on its own line and the content on the NEXT one:
 *
 *     **Disable**
 *     [Thievery](/Skills.aspx?ID=17) DC 12 to remove the trapdoor
 *
 * The hazard builder hardcoded `disable: { entries: [] }`, `routine: []`, `reset: []` and never
 * looked. Measured: 660 of 663 hazards shipped with NO Disable text — which is the single thing a
 * party needs to beat a trap — and 294 with no Routine, which is what the trap does each round.
 */
function hazardBlock(md, label) {
  if (typeof md !== 'string' || !md) return []
  const re = new RegExp(String.raw`\*\*${label}\*\*\s*([\s\S]*?)(?=\n\s*\n|\*\*[A-Z])`, 'i')
  const m = md.split('\r\n').join('\n').match(re)
  if (!m) return []
  const txt = stripLinks(m[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  return txt ? [txt] : []
}

/*
 * Split a comma-separated AoN list on the commas that SEPARATE entries, not the ones inside an
 * entry's own parenthetical.
 *
 * The old lookahead `,(?![^(]*\))` asked "is there a `)` ahead before the next `(`?" — which is a
 * guess at nesting, not a measurement of it, and it is wrong in both directions. It keeps a
 * separator comma when a LATER entry closes a paren (Boss Skrawng's "Blowgun (10 darts), 2 with
 * spear frog poison)" arrives as one item), and it splits INSIDE a parenthetical the moment AoN
 * omits the closing paren — which AoN does: the Ghostly Guard's "all damage 15 (except force,
 * ghost touch, or positive" was torn into three, shipping "resists ghost touch" when ghost touch
 * is the one thing that BYPASSES the resistance.
 *
 * Counting depth is the same size and cannot be fooled. Measured over all 4,791 creatures: 5
 * resistance lines fixed (Ghostly Guard, Fionn, War Wraith, Bright Walker, Stone Ghost), 0
 * weakness / skill / immunity / sense lines changed.
 */
function splitTopLevel(str) {
  const out = []
  let depth = 0, cur = ''
  for (const ch of String(str)) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out
}

/* Split a comma-separated AoN list, keeping parenthetical qualifiers intact and normalising the
 * whitespace AoN's facets are riddled with. */
function splitList(raw) {
  return splitTopLevel(stripLinks(String(raw ?? '')))
    .map((t) => t.replace(/[_*]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/*
 * SENSES. `doc.sense` is not a list — it is ONE padded string:
 *
 *     " detect magic , greater darkvision , lifesense 120 feet , true seeing "
 *
 * `toArr()` therefore produced a single "sense" containing all four glued together, complete with
 * the stray spaces, and that is what the stat block rendered. 3,344 records carried a double-spaced
 * or padded value somewhere for the same reason. `sense_markdown` is the clean per-sense source.
 */
function parseSenses(doc) {
  const src = doc.sense_markdown ?? doc.sense
  const list = splitList(src)
  /* That same string ALSO LEADS WITH THE PERCEPTION QUALIFIER, because on the AoN page it sits
   * between the modifier and the first sense: "(+27 to detect lies); darkvision" on the Kolyarut,
   * "(32 to detect illusions) darkvision" on the Planetar, "(expert) low-light vision" on Jubilost
   * Narthropple, "(DC 19 against Stealing)" on the Tax Collector. splitList kept it, so 105 records
   * shipped a Perception note filed as a SENSE — and on 51 of them, every NPC whose only qualifier
   * is "(15 to Sense Motive)" (the Judge, the Burglar, the Toady), it was the ONLY entry in senses.
   * A real sense never starts with "(": all 105 leading parentheticals across the 4,791 records are
   * this qualifier and not one is a sense, so a leading "(...)" is the note, and whatever follows
   * it (after AoN's stray ";" or ",") is the first real sense. */
  let perceptionNote
  if (list.length && list[0].startsWith('(')) {
    const m = list[0].match(/^\(([^)]*)\)\s*[;,]?\s*(.*)$/)
    if (m) {
      perceptionNote = m[1].trim() || undefined
      if (m[2].trim()) list[0] = m[2].trim()
      else list.shift()
    }
  }
  return { senses: list.map((name) => ({ name })), perceptionNote }
}

/*
 * The FLAVOUR BLURB and CREATURE FAMILY.
 *
 * AoN opens a creature page with prose — what the thing is, how it behaves — followed by the Recall
 * Knowledge sidebar, and only then the `<title level="2">` that starts the stat block proper. Both
 * `RawCreature.flavor` and `RawCreature.family` are declared, and CreatureDescription.tsx is a
 * finished renderer for them wired into CombatantDetail... which never had anything to draw,
 * because the builder never produced either field. 4,776 creatures have a blurb; 2,682 name a family.
 *
 * The blurb is everything before the stat-block title, with AoN's own <title>/<traits>/<column>
 * scaffolding and the Recall Knowledge rows removed.
 */
function parseFlavor(md) {
  if (typeof md !== 'string' || !md) return undefined
  const cut = md.search(/<title\s+level="2"/i)
  if (cut <= 0) return undefined
  let head = md.slice(0, cut)
  head = head.replace(/<title[\s\S]*?<\/title>/gi, '')
  /* AoN's Recall Knowledge sidebar is a self-contained <column gap="tiny"> block: that is where all
   * 4,577 of them live, and nothing but Recall Knowledge / Unspecific Lore / Specific Lore rows is
   * ever inside one. The line filter below only catches rows that START with those words, so it
   * cannot catch the second line AoN wraps the skill list onto — 3,761 blurbs ended in an orphaned
   * "(Nature): DC 30", 4,088 such lines in all. Mari Lwyd's whole flavour was one sentence followed
   * by "(Nature): DC 30". Drop the block whole, while the tags are still there to identify it. */
  head = head.replace(/<column gap="tiny">(?:(?!<column)[\s\S])*?Recall Knowledge[\s\S]*?<\/column>/gi, '')
  head = head.replace(/<[^>]+>/g, ' ')
  head = stripLinks(head).replace(/\*\*/g, '')
  // Drop the Recall Knowledge sidebar rows; the stat block renders those itself.
  head = head
    .split('\n')
    .filter((l) => !/^\s*(Recall Knowledge|Unspecific Lore|Specific Lore)\b/i.test(l.trim()))
    .join('\n')
  head = head.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  /* Was `> 60`. That bar was set with the sidebar still padding every head; with the block gone, 42
   * real one-line blurbs fell under it — "Whiptail centipedes are sleek and swift tunnel predators."
   * (57 chars) would have been silently dropped by the fix above. Nothing but prose survives the
   * strip now: of the 873 heads at or under 60 chars, 825 are empty and the other 48 are all real
   * AoN text. So any non-empty head is a blurb. Net 3,960 -> 3,966, and Ixame — whose entire blurb
   * was three Recall Knowledge DCs and no prose — correctly drops out. */
  return head.length > 0 ? head : undefined
}

/*
 * The note AoN prints beside the AC — "all-around vision", "(19 when broken)", or a conditional
 * like "(+2 with shield raised)". 272 creatures. `doc.ac` is a bare integer with no room for it.
 */
function parseAcNote(md) {
  if (typeof md !== 'string' || !md) return undefined
  const m = md.match(/\*\*AC\*\*\s*\d+([^\r\n*]*)/)
  if (!m) return undefined
  const note = stripLinks(m[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().replace(/^[;,]+|[;,]+$/g, '').trim()
  return note && /[A-Za-z]/.test(note) ? note : undefined
}

/*
 * The note AoN prints beside the saves. TWO different things live there and they mean different
 * things to a GM:
 *
 *   1. free text after **Will**, which applies to all three saves —
 *      "+1 status to all saves vs. magic", "construct armor", "-1 status penalty vs. death effects";
 *   2. a parenthetical printed directly after ONE save's modifier, which applies to THAT save only —
 *      "**Fort** +10 (+12 vs. Grapple)".
 *
 * Only (1) was read. So (2) was dropped outright on the 20 creatures that carry it on Fort or Ref —
 * the Slurk's "+12 vs. Grapple or Shove", the Saboteur's "+11 vs. traps", the Clockwork Door
 * Warden's "+12 vs. Disarm", the Pathfinder Venture-Captain's "successes are instead critical
 * successes" — and mis-attributed on the 29 that carry it on Will, where the Unicorn shipped a bare
 * "(+2 vs. mental)" that reads as +2 on EVERY save when AoN means Will alone. Labelling each
 * parenthetical with the save it belongs to fixes both halves: 942 notes -> 961, none lost.
 *
 * It exists ONLY in the markdown. Every save facet on all 4,791 docs is a bare integer, and there
 * is no `*_save_raw` the way there is an `hp_raw`, so the builder — which reads only those integers
 * — has nothing else to carry.
 *
 * Links are stripped BEFORE matching, not after: AoN writes the qualifier as
 * "(+12 vs. [Grapple](/Actions.aspx?ID=235))", and a `\([^)]*\)` run over the raw markdown stops at
 * the LINK's closing paren, which cost the Slurk and Two Tusk their closing bracket.
 */
function parseSaveNote(md) {
  if (typeof md !== 'string' || !md) return undefined
  const flat = stripLinks(md)
  const tidy = (s) => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^[;,]+|[;,]+$/g, '').trim()

  const parts = []
  const perSave = (label, re) => {
    const m = flat.match(re)
    const t = m && tidy(m[1])
    if (t && /[A-Za-z]/.test(t)) parts.push(`${label} ${t}`)
  }
  perSave('Fort', /\*\*Fort(?:itude)?\*\*\s*[+-]?\d+\s*(\([^)\r\n]*\))/)
  perSave('Ref',  /\*\*Ref(?:lex)?\*\*\s*[+-]?\d+\s*(\([^)\r\n]*\))/)

  const m = flat.match(
    /\*\*Will\*\*\s*[+-]?\d+\s*([\s\S]*?)(?=\*\*HP\*\*|\*\*Immunities\*\*|\*\*Resistances\*\*|\*\*Weaknesses\*\*)/)
  let tail = m ? tidy(m[1]) : ''
  const will = tail.match(/^\([^)]*\)/)
  if (will && /[A-Za-z]/.test(will[0])) {
    parts.push(`Will ${will[0]}`)
    tail = tidy(tail.slice(will[0].length))
  }

  // labelled per-save notes first, then the all-saves tail behind a ';' so the two do not blur
  const note = [parts.join(', '), /[A-Za-z]/.test(tail) ? tail : ''].filter(Boolean).join('; ')
  return note || undefined
}

/*
 * Creatures whose body parts have their OWN Hit Point pool. `defenses.hp` is an array for exactly
 * this, but the builder only ever wrote one entry because `hp_raw` stops at the first pool. AoN
 * prints the rest as a second HP inside the defense block — the Hydra's
 * "**HP** 90 ((body), hydra regeneration)<br /> **HP** 15 ((head), head regrowth)" — so the head's
 * 15 HP ended up mashed into the note as prose, and a player who severs a head has no number to
 * subtract from. 10 creatures: Hydra (both printings), Stargut / Hooktongue / Prismhydra, Tyrafdir,
 * Mocking Chorus, Orochi, Mammoth Land Star (limb) and Trighoul (tentacle). The Mammoth Land Star's
 * 25 HP limb was lost outright — AoN prints it inside the Immunities block, so `hp_raw` never saw it.
 *
 * The parenthesised PART NAME is what makes it a pool, and it is the only thing that separates one
 * from the other numbers AoN writes an "HP" beside: Seldeg Bhedlis's summoned mount is printed
 * "**HP** 155; **AC** 42" inside an ability body, and the Talos Gadgeteer's "plus 5 temporary HP" is
 * a buff. Requiring the label leaves both out — over all 4,791 markdown strings this matches those
 * 10 and nothing else. AoN writes the pair in either order: "**HP** 15 ((head)…" and "**HP** (head) 15".
 */
function parseHpPools(md) {
  if (typeof md !== 'string') return null
  const first = md.indexOf('**HP**')
  if (first < 0) return null
  const pools = []
  const re = /HP\*{0,2}\s*(?:(\d+)\s*\(\(?\s*([a-z][a-z ]{2,19}?)\)|\(([a-z][a-z ]{2,19}?)\)\s*(\d+))/g
  // Start past the first "**HP**": pool one's number is `doc.hp`, which is authoritative.
  for (const m of md.slice(first + 6).matchAll(re)) {
    const hp = num(m[1] ?? m[4])
    if (hp > 0) pools.push({ hp, name: (m[2] ?? m[3]).trim() })
  }
  return pools.length ? pools : null
}

/** Parse AoN speed_raw string → speed object.
 *  Examples: "25 feet", "30 feet, fly 60 feet, swim 20 feet"
 */
function parseSpeedRaw(raw) {
  if (!raw) return {}
  const speed = {}
  const str = String(raw).toLowerCase()

  const walkM = str.match(/^(\d+)/)
  if (walkM) speed.walk = parseInt(walkM[1])

  const flyM   = str.match(/fly\s+(\d+)/)
  const swimM  = str.match(/swim\s+(\d+)/)
  const burrM  = str.match(/burrow\s+(\d+)/)
  const climbM = str.match(/climb\s+(\d+)/)
  if (flyM)   speed.fly     = parseInt(flyM[1])
  if (swimM)  speed.swim    = parseInt(swimM[1])
  if (burrM)  speed.burrow  = parseInt(burrM[1])
  if (climbM) speed.climb   = parseInt(climbM[1])

  return speed
}

/** Convert AoN `actions` string → symbol string */
function aonActionsToSymbol(s) {
  if (!s) return ''
  const l = String(s).toLowerCase().trim()
  if (l === 'reaction')          return '↺'
  if (l === 'free action')       return '◇'
  if (l.includes('three') || l === '3 actions') return '◆◆◆'
  if (l === 'two actions'  || l === '2 actions') return '◆◆'
  if (l === 'one action'   || l === '1 action' || l === 'single action') return '◆'
  if (l.match(/(\d+)\s+(?:to\s+\d+\s+)?minutes?/)) return `${l.match(/(\d+)/)[1]} min`
  if (l.match(/(\d+)\s+rounds?/)) return `${l.match(/(\d+)/)[1]} rd`
  if (l === 'varies') return 'varies'
  // Variable: "Single Action to Three Actions", "One to Three Actions", etc.
  if (l.includes(' to ') && l.includes('action')) {
    const lo = l.split(' to ')[0].trim()
    const hi = l.split(' to ')[1].trim()
    const loSym = aonActionsToSymbol(lo)
    const hiSym = aonActionsToSymbol(hi)
    if (loSym && hiSym) return `${loSym} to ${hiSym}`
  }
  return s
}

/** `[Hell Lore](/Skills.aspx?ID=41)` -> `Hell Lore`. The *_markdown facets keep AoN's links; the
 *  builder wants the display text. (parseAonMarkdown has its own copy, scoped inside itself.)
 *
 *  It also TIDIES what unwrapping leaves behind, because this is the one funnel every *_markdown
 *  facet passes through on its way into a stored string — items, senses, languages, skills, the
 *  resistance/weakness notes, the AC and save notes, the flavour blurb and the hazard
 *  Disable/Routine/Reset blocks all call it. Two kinds of residue were shipping:
 *
 *   - AoN's padding AROUND the link, now that the link is gone. Triton's items read "shell armor (
 *     hide armor )", Culdewen's "oar (functions as mace )", the Red Mantis Assassin's "shurikens
 *     (×5 with blightburn resin )". 152 item strings.
 *   - The link TEXT is often ITALICISED — `[_truespeech_](…)`, `[_ghost touch_](…)` — and the
 *     markers were stored as part of the value. 323 language abilities read "_truespeech_" or
 *     "_tongues_"; every Specter-family resistance note reads "except force, _ghost touch_, or
 *     vitality" (138); the Night Hag's save note hangs on her "_heartstone_"; 300 flavour blurbs
 *     carry an italicised ship name, quotation or "_Nethys Note: …_"; 191 hazard Disable lines
 *     name an italicised spell.
 *
 *  Measured over the 4,791 creatures and 663 hazards: 1,145 stored strings. `splitList` already
 *  did this for immunities and senses, which is why those two were clean and nothing else was.
 *
 *  Only HORIZONTAL whitespace is collapsed — parseFlavor's paragraph breaks are real `\r\n` and
 *  must survive — and only a PAIR of underscores on one line is dropped, so dice and identifiers
 *  keep theirs. `+`/`-` stay out of the punctuation set: "Athletics +18" and "-1 status penalty"
 *  need the space, and the skill parser matches on it. */
const stripLinks = (t) => String(t)
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/_([^_\n]+?)_/g, '$1')
  .replace(/[^\S\r\n]{2,}/g, ' ')
  .replace(/[^\S\r\n]+([,;.)])/g, '$1')
  .replace(/([([])[^\S\r\n]+/g, '$1')

/** Safely parse int, return fallback */
const num = (v, fb = 0) => { const n = parseInt(v); return isNaN(n) ? fb : n }

/** Coerce value to array */
const toArr = v => !v ? [] : Array.isArray(v) ? v : [v]

/**
 * Convert raw seconds (what AoN's `duration` field stores) into the human
 * phrase PF2e tables use — rounds / minutes / hours / days. Picks the largest
 * unit that divides evenly so 28800 → "8 hours", not "480 minutes".
 */
function secondsToDuration(v) {
  const secs = Number(v)
  if (!Number.isFinite(secs) || secs <= 0) return ''
  if (secs >= 86400 && secs % 86400 === 0) {
    const d = secs / 86400; return d === 1 ? '1 day' : `${d} days`
  }
  if (secs >= 3600 && secs % 3600 === 0) {
    const h = secs / 3600; return h === 1 ? '1 hour' : `${h} hours`
  }
  if (secs >= 60 && secs % 60 === 0) {
    const m = secs / 60; return m === 1 ? '1 minute' : `${m} minutes`
  }
  if (secs % 6 === 0) {
    const r = secs / 6; return r === 1 ? '1 round' : `${r} rounds`
  }
  return secs === 1 ? '1 second' : `${secs} seconds`
}

/** Best available source string from an AoN document */
function docSource(doc) {
  // primary_source_raw looks like "Bestiary pg. 178"
  if (doc.primary_source_raw) return doc.primary_source_raw
  if (Array.isArray(doc.source) && doc.source.length) return doc.source[0]
  if (typeof doc.source === 'string') return doc.source
  return ''
}

// ─── AoN markdown parser ─────────────────────────────────────────────────────

/**
 * Parse the AoN ES markdown field into structured attacks, abilities, and
 * spellcasting blocks.  The markdown uses a bespoke XML-like syntax mixed
 * with standard Markdown bold / link notation.
 */

function aonCreatureToRaw(doc) {
  // ── defenses ──────────────────────────────────────────────────────────────
  const hpVal  = typeof doc.hp === 'number' ? doc.hp
    : num(String(doc.hp_raw ?? '').match(/^(\d+)/)?.[1] ?? '0')
  /* Everything AoN prints AFTER the HP number: "(4 segments)", "(3 heads)", regeneration,
   * negative healing. 808 creatures carry one and the numeric facet has no room for it. */
  let hpNote = String(doc.hp_raw ?? '').replace(/^\s*\d+\s*/, '').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+/g, ' ').trim() || undefined
  /* REGENERATION and FAST HEALING live on the HP line but NOT in `hp_raw`, which stops at the
   * number. ~117 creatures lost them: the Pit Fiend prints "HP 335, regeneration 30 (deactivated by
   * good)" and shipped as plain 335 — so a GM has no reason to stop hitting the corpse and no idea
   * what switches the regeneration off. Jabberwock, Troll King and Jotund Troll are the same. */
  {
    const m = String(doc.markdown ?? '').match(
      /\*\*HP\*\*\s*[\s\S]{0,80}?((?:regeneration|fast healing)[^\r\n*]*)/i)
    if (m) {
      const reg = stripLinks(m[1]).replace(/\s+/g, ' ').trim().replace(/^[;,]+/, '').trim()
      if (reg) hpNote = hpNote ? `${hpNote} ${reg}`.replace(/\s+/g, ' ').trim() : reg
    }
  }

  const defenses = {
    ac: { std: num(doc.ac) },
    ...(parseAcNote(doc.markdown) ? { acNote: parseAcNote(doc.markdown) } : {}),
    savingThrows: {
      fort: { std: num(doc.fortitude_save) },
      ref:  { std: num(doc.reflex_save)   },
      will: { std: num(doc.will_save)     },
      ...(parseSaveNote(doc.markdown) ? { note: parseSaveNote(doc.markdown) } : {}),
    },
    hp: [{ hp: hpVal, ...(hpNote ? { name: hpNote } : {}) }],
    immunities:  toArr(doc.immunity).flatMap((x) => splitList(x)),
    resistances: parseResWeakMarkdown(doc.resistance_markdown) ?? parseResWeakObj(doc.resistance),
    weaknesses:  parseResWeakMarkdown(doc.weakness_markdown)   ?? parseResWeakObj(doc.weakness),
  }
  if (doc.hardness != null) defenses.hardness = { std: num(doc.hardness) }
  /* Re-home defence values that AoN's own markup spilled into the wrong row — see
   * unmixDefenceRows. This one fixes FABRICATED data rather than missing data, which is why it runs
   * even though everything above already "succeeded". */
  unmixDefenceRows(defenses)

  /* SEVERABLE PARTS get their own pool; see parseHpPools. 10 creatures. The Hydra shipped as a
   * single 90 HP entry with "HP 15 ((head), head regrowth)" stuffed into the note — text, not a
   * number a GM can knock down. Where AoN printed the extra pool inline it is also still sitting in
   * `hp_raw`, so cut the note back at that "HP" instead of carrying the head in both places; the 6
   * creatures that needed it are the inline printings, the other 4 already had a clean note. */
  const partPools = parseHpPools(doc.markdown)
  if (partPools) {
    const note = defenses.hp[0].name?.split(/\bHP\b/)[0].replace(/[\s;,]+$/, '')
    if (note) defenses.hp[0].name = note
    else delete defenses.hp[0].name
    defenses.hp.push(...partPools)
  }

  // ── ability mods ──────────────────────────────────────────────────────────
  const abilityMods = {
    str: num(doc.strength),
    dex: num(doc.dexterity),
    con: num(doc.constitution),
    int: num(doc.intelligence),
    wis: num(doc.wisdom),
    cha: num(doc.charisma),
  }

  // ── speed ─────────────────────────────────────────────────────────────────
  const speed = parseSpeedRaw(doc.speed_raw ?? doc.speed)
  /* AoN's Speed line is a SENTENCE, not five numbers: "40 feet; trailblazing stride, troop
   * movement". Everything after the ';' names movement abilities that change how the creature
   * moves, and the numeric speed object has nowhere to put them. 497 creatures.
   *
   * The COMMA-separated head is a sentence too. parseSpeedRaw only understands a bare
   * "<mode> N feet" there and silently dropped every other clause: the parenthetical saying WHEN
   * a mode works (Lava Otter "swim 40 feet (in lava only)", Lampad "climb 25 feet (on stone
   * only)", Manticore Paaridar "fly 20 feet (limited flight)"), a mode the five-key object has no
   * slot for (Quoppopak "water glide 30 feet", Blizzardborn "ice burrow 20 feet", Path Maiden
   * "limited flight 25 feet" — which parses to NO speed at all), and the movement abilities AoN
   * comma-joins instead of putting after the ';' (Syndara the Sculptor "air walk", Raw Nerve
   * "float", Skeleton Mob "troop movement"). Measured over the corpus: 86 such clauses on 80
   * creatures, and not one of them had a ';', so all 80 shipped with speedNote undefined and the
   * qualifier gone.
   *
   * So keep every head clause the numeric object did NOT swallow, in AoN's own words, ahead of
   * the ';' tail. A clause is dropped only when it is exactly "<known mode> N feet" — verified
   * across all 4,791 that every clause dropped this way has its number already in `speed`, and
   * that the 497 existing notes come out byte-identical. */
  const speedRaw = String(doc.speed_raw ?? '')
  const [speedHead, ...speedTail] = speedRaw.split(';')
  const speedKept = speedHead
    .split(/,(?![^(]*\))/)                       // commas OUTSIDE parens: "(in sand or loose soil)"
    .map((s) => s.replace(/\s+/g, ' ').trim())   // speed_raw keeps the gaps left by stripped links
    .filter((s) => s && !/^(?:walk|fly|swim|burrow|climb)?\s*\d+\s*(?:feet|ft)?\.?$/i.test(s))
  const speedNote = [
    speedKept.join(', '),
    speedTail.join(';').replace(/\s+/g, ' ').trim(),
  ].filter(Boolean).join('; ') || undefined

  /* ── skills ────────────────────────────────────────────────────────────────
   * `skill_mod` DROPS EVERY LORE. AoN's facet is keyed by canonical skill, and a Lore is not one —
   * "Hell Lore +12" is simply absent from skill_mod while sitting in plain sight in
   * `skill_markdown`. Measured: 1,118 creatures carry a named Lore (Warfare Lore x100, Legal Lore
   * x51, …) and 0 of the 4,791 shipped records had a single lore key.
   *
   * So parse the markdown line, which carries every skill WITH its bonus, and keep skill_mod only
   * as the fallback. Cross-checked over the corpus: for every non-Lore skill the two agree exactly,
   * 0 mismatches — so this adds the Lores without disturbing anything that already worked. */
  const skills = {}
  const skillModObj = (doc.skill_mod && typeof doc.skill_mod === 'object' && !Array.isArray(doc.skill_mod))
    ? doc.skill_mod
    : {}
  for (const [name, val] of Object.entries(skillModObj)) {
    skills[name.toLowerCase()] = num(val)
  }
  if (typeof doc.skill_markdown === 'string' && doc.skill_markdown.trim()) {
    // Split on commas OUTSIDE parentheses: "Athletics +18 (+20 to Climb), Stealth +14".
    const parts = splitTopLevel(stripLinks(doc.skill_markdown))
    for (const part of parts) {
      const m = part.trim().match(/^(.+?)\s*([+-]\d+)/)
      if (!m) continue
      const key = m[1].trim().toLowerCase()
      if (key) skills[key] = num(m[2])
    }
  }

  /* ── languages / senses ───────────────────────────────────────────────────
   * A SEMICOLON separates languages from language ABILITIES: "Common, Draconic; telepathy 100
   * feet". The flat `language` facet has already thrown that separator away, so the abilities were
   * being rendered as if they were languages — "Common, Draconic, telepathy 100 feet". No token was
   * missing; the MEANING was. 1,049 creatures, of which telepathy x345 and "(can't speak any
   * language)" x211. */
  let langs = toArr(doc.language)
  let langAbilities = []
  if (typeof doc.language_markdown === 'string' && doc.language_markdown.includes(';')) {
    const [lhs, ...rest] = stripLinks(doc.language_markdown).split(';')
    const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean)
    langs = split(lhs)
    langAbilities = split(rest.join(';'))
  }
  const { senses, perceptionNote } = parseSenses(doc)

  // ── traits + rarity ──────────────────────────────────────────────────────
  const traits = [...toArr(doc.trait)]
  // Rarity is a separate field; add it to traits if not already present
  if (doc.rarity && doc.rarity !== 'common') {
    const r = doc.rarity.charAt(0).toUpperCase() + doc.rarity.slice(1)
    if (!traits.some(t => t.toLowerCase() === doc.rarity)) traits.unshift(r)
  }
  // Size also not always in trait array — size can be an array like ["Medium"]
  const sizeName = Array.isArray(doc.size) ? doc.size[0] : doc.size
  if (sizeName && typeof sizeName === 'string' &&
      !traits.some(t => t.toLowerCase() === sizeName.toLowerCase())) {
    traits.unshift(sizeName.charAt(0).toUpperCase() + sizeName.slice(1))
  }

  // ── parse markdown for attacks, abilities, spellcasting ─────────────────
  const parsed = parseAonMarkdown(doc.markdown)
  // Recover any lore/aside tables that ability parsing dropped.
  appendCreatureTables(parsed.abilities, doc.markdown)

  // ── source ────────────────────────────────────────────────────────────────
  const src = docSource(doc)
  // Split "Bestiary pg. 178" → source="Bestiary", page=178
  const srcMatch = src.match(/^(.+?)\s+pg?\.\s*(\d+)$/i)
  const sourceName = srcMatch ? srcMatch[1].trim() : src
  const sourcePage = srcMatch ? parseInt(srcMatch[2]) : undefined

  return {
    name:       doc.name,
    source:     sourceName,
    page:       sourcePage,
    level:      num(doc.level),
    traits,
    perception: { std: num(doc.perception) },
    // The qualifier AoN prints on the Perception modifier, split back off the sense list by
    // parseSenses. 105 creatures; the Kolyarut's "+27 to detect lies" was rendering as a sense.
    ...(perceptionNote ? { perceptionNote } : {}),
    senses,
    languages:  { languages: langs, abilities: langAbilities },
    skills,
    abilityMods,
    items:      (Array.isArray(doc.item) ? doc.item : toArr(doc.item)).flatMap((x) => splitList(x)),
    speed,
    speedNote,
    attacks:     parsed.attacks,
    spellcasting: parsed.spellcasting,
    // 258 creatures cast rituals; RawCreature.rituals and StatBlock's `case 'rituals'`
    // renderer were both already in place, the parser simply never produced them.
    ...(parsed.rituals ? { rituals: parsed.rituals } : {}),
    abilities:    parsed.abilities,
    defenses,
    ...(parseFlavor(doc.markdown) ? { flavor: parseFlavor(doc.markdown) } : {}),
    ...(doc.creature_family ? { family: String(doc.creature_family) } : {}),
    // AoN-specific — preserved for stat block fallback display
    _aon: {
      id:       doc.id,
      url:      doc.url ? (doc.url.startsWith('http') ? doc.url : `https://2e.aonprd.com${doc.url}`) : undefined,
      markdown: doc.markdown ?? doc.text ?? '',
    },
  }
}

// ─── AoN hazard → RawHazard ──────────────────────────────────────────────────

function aonHazardToRaw(doc) {
  const hpVal = typeof doc.hp === 'number' ? doc.hp
    : num(String(doc.hp_raw ?? '').match(/^(\d+)/)?.[1] ?? '0')
  /* Everything AoN prints AFTER the HP number: "(4 segments)", "(3 heads)", regeneration,
   * negative healing. 808 creatures carry one and the numeric facet has no room for it. */
  let hpNote = String(doc.hp_raw ?? '').replace(/^\s*\d+\s*/, '').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+/g, ' ').trim() || undefined
  /* REGENERATION and FAST HEALING live on the HP line but NOT in `hp_raw`, which stops at the
   * number. ~117 creatures lost them: the Pit Fiend prints "HP 335, regeneration 30 (deactivated by
   * good)" and shipped as plain 335 — so a GM has no reason to stop hitting the corpse and no idea
   * what switches the regeneration off. Jabberwock, Troll King and Jotund Troll are the same. */
  {
    const m = String(doc.markdown ?? '').match(
      /\*\*HP\*\*\s*[\s\S]{0,80}?((?:regeneration|fast healing)[^\r\n*]*)/i)
    if (m) {
      const reg = stripLinks(m[1]).replace(/\s+/g, ' ').trim().replace(/^[;,]+/, '').trim()
      if (reg) hpNote = hpNote ? `${hpNote} ${reg}`.replace(/\s+/g, ' ').trim() : reg
    }
  }

  const defenses = {
    ac: { std: num(doc.ac) },
    ...(parseAcNote(doc.markdown) ? { acNote: parseAcNote(doc.markdown) } : {}),
    savingThrows: {
      fort: { std: num(doc.fortitude_save) },
      ref:  { std: num(doc.reflex_save)   },
      will: { std: num(doc.will_save)     },
      ...(parseSaveNote(doc.markdown) ? { note: parseSaveNote(doc.markdown) } : {}),
    },
    hp: [{ hp: hpVal, ...(hpNote ? { name: hpNote } : {}) }],
    immunities:  toArr(doc.immunity).flatMap((x) => splitList(x)),
    resistances: parseResWeakMarkdown(doc.resistance_markdown) ?? parseResWeakObj(doc.resistance),
    weaknesses:  parseResWeakMarkdown(doc.weakness_markdown)   ?? parseResWeakObj(doc.weakness),
  }
  if (doc.hardness != null) defenses.hardness = { std: num(doc.hardness) }

  const src = docSource(doc)
  const srcMatch = src.match(/^(.+?)\s+pg?\.\s*(\d+)$/i)

  return {
    name:    doc.name,
    source:  srcMatch ? srcMatch[1].trim() : src,
    page:    srcMatch ? parseInt(srcMatch[2]) : undefined,
    level:   num(doc.level),
    traits:  toArr(doc.trait),
    stealth: doc.stealth != null ? { bonus: num(doc.stealth) } : undefined,
    description: doc.text ? [doc.text] : [],
    disable: { entries: hazardBlock(doc.markdown, 'Disable') },
    routine: hazardBlock(doc.markdown, 'Routine'),
    reset: hazardBlock(doc.markdown, 'Reset'),
    complex: doc.complex ?? false,
    defenses,
    actions: [],
    _aon: {
      id:       doc.id,
      url:      doc.url ? (doc.url.startsWith('http') ? doc.url : `https://2e.aonprd.com${doc.url}`) : undefined,
      markdown: doc.markdown ?? doc.text ?? '',
    },
  }
}

// ─── App data builders ────────────────────────────────────────────────────────


async function buildCreaturesAndIndex(creatures, hazards) {
  console.log('\n  Building creature bestiary…')
  const bestiaryDir = join(DATA, 'bestiary')
  await mkdir(bestiaryDir, { recursive: true })

  // Group by source book → one file per source
  const bySource = {}
  for (const doc of creatures) {
    const raw = docSource(doc) || 'unknown'
    const srcMatch = raw.match(/^(.+?)\s+pg?\./i)
    const srcName = (srcMatch ? srcMatch[1] : raw).trim()
    const key = srcName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
    if (!bySource[key]) bySource[key] = []
    bySource[key].push(aonCreatureToRaw(doc))
  }

  /* A reprint's page — an adventure appendix, an NPC entry — often carries no blurb while the
   * creature's own page does (Vargouille: Bestiary 2186 has the prose, Pathfinder #157's 2477 does
   * not). The old scrape handed every same-name record the blurb by name, so the tracker showed one
   * for the reprint too, and the index dedupe may keep the reprint. Borrow it from a same-name,
   * SAME-LEVEL twin only: the level-18 Worm Prophet NPC is not the level-12 monster. Measured
   * 2026-09-12: 42 records gain a blurb; 780 have no twin with one and stay bare. */
  const blurbByNameLevel = new Map()
  for (const list of Object.values(bySource))
    for (const c of list) if (c.flavor) blurbByNameLevel.set(`${c.name.toLowerCase()}|${c.level}`, c.flavor)
  let borrowed = 0
  for (const list of Object.values(bySource))
    for (const c of list) {
      if (c.flavor) continue
      const twin = blurbByNameLevel.get(`${c.name.toLowerCase()}|${c.level}`)
      if (twin) { c.flavor = twin; borrowed++ }
    }
  if (borrowed) console.log(`    ✓ ${borrowed} blurbs borrowed from same-name, same-level twins`)

  for (const [key, list] of Object.entries(bySource)) {
    const fname = `creatures-${key}.json`
    await writeFile(join(bestiaryDir, fname), JSON.stringify({ creature: list }), 'utf8')
  }
  console.log(`    ✓ ${Object.keys(bySource).length} bestiary files, ${creatures.length} creatures`)

  // hazards.json
  const hazardList = hazards.map(aonHazardToRaw)
  await writeFile(join(DATA, 'hazards.json'), JSON.stringify({ hazard: hazardList }), 'utf8')
  console.log(`    ✓ ${hazardList.length} hazards`)

  // index.json — denormalized for fast client-side filtering (PF2eTools-style)
  const index = []

  // Helpers for extracting filter-friendly data from the AoN ES doc.
  // Some AoN entries contain leaked markdown / parenthetical noise / multi-clause
  // strings — drop those so the filter pill list stays clean.
  const cleanDefenseValue = (raw) => {
    if (raw == null) return null
    let s = String(raw).trim()
    // Collapse internal whitespace
    s = s.replace(/\s+/g, ' ').trim()
    if (!s) return null
    if (s.length > 40) return null
    // Drop strings that clearly leaked from raw markdown / parsing
    if (/[;{}<>]/.test(s)) return null
    if (/\b(immunit|weakness|resistance|hardness|hp\b|aura|see\b)/i.test(s)) return null
    if (/^and\s/i.test(s))                         return null   // "and unconscious"
    if ((s.match(/\(/g) ?? []).length !== (s.match(/\)/g) ?? []).length) return null
    // Title-case the first letter so "fire" and "Fire" don't become two pills
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  const cleanArr = (arr) => {
    if (!Array.isArray(arr)) return []
    const out = []
    const seen = new Set()
    for (const v of arr) {
      const c = cleanDefenseValue(v)
      if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c) }
    }
    return out
  }
  const objectKeys = v => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return []
    return cleanArr(Object.keys(v))
  }
  const speedTypesFromRaw = (raw) => {
    if (!raw) return []
    const out = []
    if (/\bfly\b/i.test(raw))    out.push('Fly')
    if (/\bswim\b/i.test(raw))   out.push('Swim')
    if (/\bburrow\b/i.test(raw)) out.push('Burrow')
    if (/\bclimb\b/i.test(raw))  out.push('Climb')
    if (/^\s*\d/.test(raw))      out.push('Walk')
    return out
  }
  const speedMaxFromObj = (s) => {
    if (!s || typeof s !== 'object') return 0
    return s.max ?? Math.max(0, ...Object.entries(s)
      .filter(([k]) => k !== 'max')
      .map(([, v]) => typeof v === 'number' ? v : 0))
  }
  // Highest spell level: prefer the structured `spellcasting` array (each
  // entry has a numeric `level`). Falls back to scanning the markdown for
  // "Xst/nd/rd/th rank" and "cantrips (N)" when no structured data is
  // available — covers older AoN docs that only carry the markdown.
  const extractHighestSpellLevel = (doc) => {
    let max = 0
    if (Array.isArray(doc?.spellcasting)) {
      for (const block of doc.spellcasting) {
        for (const v of Object.values(block?.entry ?? {})) {
          const lvl = parseInt(v?.level)
          if (!isNaN(lvl) && lvl > max) max = lvl
        }
      }
    }
    if (max > 0) return max
    const md = doc?.spell_markdown ?? doc?.markdown
    if (!md) return 0
    for (const m of md.matchAll(/(\d+)(?:st|nd|rd|th)\s+rank/gi)) max = Math.max(max, parseInt(m[1]))
    for (const m of md.matchAll(/cantrips\s*\((\d+)/gi))         max = Math.max(max, parseInt(m[1]))
    return max
  }
  // Spell types ("Innate Divine", "Prepared Arcane", "Focus") — same
  // primary/fallback pattern.
  const extractSpellTypes = (doc) => {
    const set = new Set()
    if (Array.isArray(doc?.spellcasting)) {
      for (const block of doc.spellcasting) {
        const name = (block?.name || '').toLowerCase()
        const tradRaw = (block?.tradition || '').toLowerCase()
        const trad = tradRaw === 'arcane' ? 'Arcane'
                   : tradRaw === 'divine' ? 'Divine'
                   : tradRaw === 'occult' ? 'Occult'
                   : tradRaw === 'primal' ? 'Primal' : ''
        const kind = /focus/.test(name) ? 'Focus'
                   : /innate/.test(name) ? 'Innate'
                   : /prepared/.test(name) ? 'Prepared'
                   : /spontaneous/.test(name) ? 'Spontaneous' : ''
        if (kind && trad) set.add(`${kind} ${trad}`)
        else if (kind)    set.add(kind)
        else if (trad)    set.add(trad)
      }
    }
    if (set.size) return [...set]
    const md = doc?.spell_markdown ?? doc?.markdown
    if (!md) return []
    for (const m of md.matchAll(/\*\*([^*]+?Spells?)\*\*/gi)) {
      const name = m[1].trim()
      const trad = /arcane/i.test(name) ? 'Arcane'
                 : /divine/i.test(name) ? 'Divine'
                 : /occult/i.test(name) ? 'Occult'
                 : /primal/i.test(name) ? 'Primal' : ''
      const kind = /focus/i.test(name) ? 'Focus'
                 : /innate/i.test(name) ? 'Innate'
                 : /prepared/i.test(name) ? 'Prepared'
                 : /spontaneous/i.test(name) ? 'Spontaneous' : ''
      if (kind && trad) set.add(`${kind} ${trad}`)
      else if (kind)    set.add(kind)
      else if (trad)    set.add(trad)
    }
    return [...set]
  }

  for (const doc of creatures) {
    const raw = docSource(doc) || 'unknown'
    const srcMatch = raw.match(/^(.+?)\s+pg?\./i)
    const srcName = (srcMatch ? srcMatch[1] : raw).trim()
    const key = srcName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')

    const immunities  = cleanArr(doc.immunity)
    const weaknesses  = objectKeys(doc.weakness)
    const resistances = objectKeys(doc.resistance)
    const speedTypes  = speedTypesFromRaw(doc.speed_raw)
    const maxSpeed    = speedMaxFromObj(doc.speed)
    const traditions  = Array.isArray(doc.tradition) ? doc.tradition : []
    const spellDC     = Array.isArray(doc.spell_dc) ? Math.max(0, ...doc.spell_dc) : (num(doc.spell_dc, 0) || 0)
    const spellLvl    = extractHighestSpellLevel(doc)
    const spellTypes  = extractSpellTypes(doc)

    index.push({
      name:   doc.name,
      level:  num(doc.level),
      traits: Array.isArray(doc.trait) ? doc.trait : [],
      source: srcName,
      file:   `creatures-${key}.json`,
      isNpc:  !!doc.npc,
      immunities, weaknesses, resistances,
      speedTypes, maxSpeed,
      traditions, spellDC, spellLvl, spellTypes,
    })
  }
  for (const doc of hazards) {
    const immunities  = cleanArr(doc.immunity)
    const weaknesses  = objectKeys(doc.weakness)
    const resistances = objectKeys(doc.resistance)
    index.push({
      name:     doc.name,
      level:    num(doc.level),
      traits:   Array.isArray(doc.trait) ? doc.trait : [],
      source:   docSource(doc),
      file:     '../hazards.json',
      isHazard: true,
      immunities, weaknesses, resistances,
      speedTypes: [], maxSpeed: 0,
      traditions: [], spellDC: 0, spellLvl: 0, spellTypes: [],
    })
  }
  // Dedupe: many creatures appear in multiple sources (pre-remaster Bestiary
  // + post-remaster Monster Core, adventure reprints, etc.). Keep only the
  // canonical version per name using a source-priority ranking — the same
  // policy as scripts/dedupe-creatures.cjs.
  const priorityRules = [
    [0,  /^Monster Core 2/i], [0,  /^Monster Core/i],
    [1,  /^NPC Core/i], [1, /^GM Core/i],
    [1,  /^Player Core 2/i], [1, /^Player Core/i],
    [10, /^Bestiary 3/i],
    [11, /^Battlecry/i], [11, /^Howl of the Wild/i],
    [11, /^Rage of Elements/i], [11, /^Tian Xia Bestiary/i],
    [12, /^Book of the Dead/i], [12, /^Dark Archive/i],
    [12, /^Secrets of Magic/i], [12, /^Guns ?(?:&|and) ?Gears/i],
    [20, /^Bestiary 2/i], [21, /^Bestiary\b/i],
    [22, /^Gamemastery Guide/i], [22, /^Core Rulebook/i],
    [22, /^Absalom, City of Lost Omens/i],
    [30, /^The Mwangi Expanse/i], [30, /^Lost Omens/i],
    [30, /^Impossible Lands/i],
  ]
  const priorityOf = s => {
    const t = String(s || '')
    for (const [r, re] of priorityRules) if (re.test(t)) return r
    if (/^Pathfinder #?\d/i.test(t)) return 60
    if (/(Hardcover|One-Shot|Adventure)/i.test(t)) return 70
    return 50
  }
  const byName = new Map()
  for (const e of index) {
    const k = e.name.toLowerCase().trim()
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push(e)
  }
  const deduped = []
  let dropped = 0
  for (const [, arr] of byName) {
    if (arr.length === 1) { deduped.push(arr[0]); continue }
    arr.sort((a, b) => {
      const pa = priorityOf(a.source), pb = priorityOf(b.source)
      return pa !== pb ? pa - pb : String(a.source).localeCompare(String(b.source))
    })
    deduped.push(arr[0])
    dropped += arr.length - 1
  }
  deduped.sort((a, b) => a.name.localeCompare(b.name))
  await writeFile(join(DATA, 'index.json'), JSON.stringify(deduped), 'utf8')
  console.log(`    ✓ index.json — ${deduped.length} total entries (deduped: dropped ${dropped} duplicate-name copies)`)
}


/* ---------------------------------------------------------------------------------------------
 * MAIN — read the Archives export instead of scraping AoN.
 *
 * The export nests the full elasticsearch payload under `data`; the flat facets the builders read
 * (trait, rarity, size, perception, markdown, …) live THERE, not at the top level. Falling back to
 * the doc itself keeps this working against the mirror's by-category files, which are already flat.
 * ------------------------------------------------------------------------------------------- */
function loadCategory(name) {
  const file = join(EXPORT, `${name}.json`);
  if (!existsSync(file)) throw new Error(`missing export file: ${file}`);
  const { docs } = JSON.parse(readFileSync(file, 'utf8'));
  return Object.values(docs).map((d) => ({ ...(d.data ?? {}), id: d.id ?? d.data?.id }));
}

const creatures = loadCategory('creature');
const hazards = loadCategory('hazard');

/* A doc with no markdown has no stat block to parse — it would emit a shell record with zero
 * attacks and zero abilities, which is exactly the silent-empty failure this rebuild exists to
 * end. Report them rather than shipping them. */
const withMd = (list) => list.filter((d) => (d.markdown ?? '').trim());
const cOk = withMd(creatures), hOk = withMd(hazards);
console.log(`creatures ${creatures.length} (${creatures.length - cOk.length} without markdown, skipped)`);
console.log(`hazards   ${hazards.length} (${hazards.length - hOk.length} without markdown, skipped)`);

if (DRY) {
  console.log('--dry: nothing written.');
} else {
  /* Clear the old shards first. They are named after SOURCE BOOKS, so a book that loses its last
   * creature would otherwise leave a stale file behind that index.json no longer references. */
  const dir = join(DATA, 'bestiary');
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(join(dir, f));
  await buildCreaturesAndIndex(cOk, hOk);
}
