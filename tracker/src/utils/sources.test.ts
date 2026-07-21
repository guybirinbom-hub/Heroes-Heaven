import { describe, it, expect } from 'vitest'
import {
  cleanSource,
  categorizeBook,
  BOOK_GROUP_ORDER,
  type BookGroup,
} from './sources'

describe('cleanSource', () => {
  it('returns empty string for null', () => {
    expect(cleanSource(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(cleanSource(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(cleanSource('')).toBe('')
  })

  it('trims surrounding whitespace', () => {
    expect(cleanSource('  Core Rulebook  ')).toBe('Core Rulebook')
  })

  it('leaves a clean book name untouched', () => {
    expect(cleanSource('Player Core')).toBe('Player Core')
  })

  it('strips a "pg." page reference', () => {
    expect(cleanSource('Core Rulebook pg. 316')).toBe('Core Rulebook')
  })

  it('strips a "pg" page reference without the dot', () => {
    expect(cleanSource('Core Rulebook pg 316')).toBe('Core Rulebook')
  })

  it('is case-insensitive about the "PG." marker', () => {
    expect(cleanSource('Bestiary PG. 12')).toBe('Bestiary')
  })

  it('strips everything after the page number too', () => {
    expect(cleanSource('Secrets of Magic pg. 200 (extra trailing text)')).toBe(
      'Secrets of Magic',
    )
  })

  it('tolerates no space between "pg." and the number', () => {
    // The regex is \s+pg\.?\s*\d+ so the digit can immediately follow "pg."
    expect(cleanSource('GM Core pg.42')).toBe('GM Core')
  })

  it('strips a "pp." multi-page reference', () => {
    expect(cleanSource('Lost Omens World Guide pp. 10-12')).toBe(
      'Lost Omens World Guide',
    )
  })

  it('strips a "pp" multi-page reference without the dot', () => {
    expect(cleanSource('NPC Core pp 5')).toBe('NPC Core')
  })

  it('requires whitespace before the page marker, so a glued "pg" is not stripped', () => {
    // \s+ at the start of the pattern means "Bookpg. 9" has no preceding
    // whitespace and is left untouched apart from the trim.
    expect(cleanSource('Bookpg. 9')).toBe('Bookpg. 9')
  })

  it('does not strip a "page" word that is not the "pg"/"pp" abbreviation', () => {
    // "page" -> after "pa" comes "ge", which is not pg/pp + digits, so nothing
    // is stripped.
    expect(cleanSource('The Front page 1')).toBe('The Front page 1')
  })

  it('trims after stripping the page reference', () => {
    expect(cleanSource('Monster Core    pg. 5')).toBe('Monster Core')
  })
})

describe('categorizeBook', () => {
  // Helper to keep the per-case expectations terse.
  const cases: Array<[string, BookGroup]> = [
    // ── Core Rulebooks ──
    ['Core Rulebook', 'Core Rulebooks'],
    ['Player Core', 'Core Rulebooks'],
    ['Player Core 2', 'Core Rulebooks'],
    ['GM Core', 'Core Rulebooks'],
    ['NPC Core', 'Core Rulebooks'],
    ['Gamemastery Guide', 'Core Rulebooks'],
    // Monster Core is in the CORE set, and that check runs before the
    // Bestiaries regex, so it lands in Core Rulebooks.
    ['Monster Core', 'Core Rulebooks'],
    ['Monster Core 2', 'Core Rulebooks'],

    // ── Adventure Paths & Adventures ──
    ['Pathfinder #150: Broken Promises', 'Adventure Paths & Adventures'],
    ['Pathfinder # 200: Something', 'Adventure Paths & Adventures'],
    // "Adventure Path" wording wins over the Kingmaker rulebook regex because
    // the AP check comes first.
    ['Kingmaker Adventure Path', 'Adventure Paths & Adventures'],
    ['Abomination Vaults', 'Adventure Paths & Adventures'],
    ['Beginner Box', 'Adventure Paths & Adventures'],
    ['The Slithering Hardcover', 'Adventure Paths & Adventures'],

    // ── Pathfinder Society ──
    ['PFS Scenario 1-01', 'Pathfinder Society'],
    ['Pathfinder Society Guide', 'Pathfinder Society'],
    ['Pathfinder Bounty 1', 'Pathfinder Society'],
    ['Quest 5: The Dragon', 'Pathfinder Society'],

    // ── Lost Omens ──
    ['Lost Omens World Guide', 'Lost Omens'],
    ['Tian Xia World Guide', 'Lost Omens'],
    ['Impossible Lands', 'Lost Omens'],
    ['Highhelm', 'Lost Omens'],
    ['Absalom, City of Lost Omens', 'Lost Omens'],
    ['Mwangi Expanse', 'Lost Omens'],

    // ── Bestiaries & Monsters ──
    ['Bestiary', 'Bestiaries & Monsters'],
    ['Bestiary 2', 'Bestiaries & Monsters'],
    ['Monsters of Myth', 'Bestiaries & Monsters'],
    ['Draconic Codex', 'Bestiaries & Monsters'],

    // ── Rulebooks & Expansions ──
    ['Advanced Player’s Guide', 'Rulebooks & Expansions'],
    ['Secrets of Magic', 'Rulebooks & Expansions'],
    ['Guns & Gears', 'Rulebooks & Expansions'],
    ['Book of the Dead', 'Rulebooks & Expansions'],
    ['Dark Archive', 'Rulebooks & Expansions'],
    ['Rage of Elements', 'Rulebooks & Expansions'],
    ['Treasure Vault', 'Rulebooks & Expansions'],
    ['Grand Bazaar', 'Rulebooks & Expansions'],

    // ── Other Books (fallback) ──
    ['Some Random Unlisted Book', 'Other Books'],
    ['', 'Other Books'],
  ]

  for (const [book, group] of cases) {
    it(`maps "${book}" -> ${group}`, () => {
      expect(categorizeBook(book)).toBe(group)
    })
  }

  it('trims the book name before matching', () => {
    expect(categorizeBook('   Core Rulebook   ')).toBe('Core Rulebooks')
  })

  it('falls back to Other Books for an unknown title', () => {
    expect(categorizeBook('Definitely Not A Real Paizo Book')).toBe(
      'Other Books',
    )
  })

  it('every produced group is present in BOOK_GROUP_ORDER', () => {
    const produced = new Set(cases.map(([book]) => categorizeBook(book)))
    for (const group of produced) {
      expect(BOOK_GROUP_ORDER).toContain(group)
    }
  })
})

describe('BOOK_GROUP_ORDER', () => {
  it('lists the seven groups in display order', () => {
    expect(BOOK_GROUP_ORDER).toEqual([
      'Core Rulebooks',
      'Bestiaries & Monsters',
      'Rulebooks & Expansions',
      'Lost Omens',
      'Adventure Paths & Adventures',
      'Pathfinder Society',
      'Other Books',
    ])
  })

  it('has no duplicate entries', () => {
    expect(new Set(BOOK_GROUP_ORDER).size).toBe(BOOK_GROUP_ORDER.length)
  })

  it('contains every BookGroup categorizeBook can produce', () => {
    // The full set of return values declared by the BookGroup union.
    const allGroups: BookGroup[] = [
      'Core Rulebooks',
      'Bestiaries & Monsters',
      'Rulebooks & Expansions',
      'Lost Omens',
      'Adventure Paths & Adventures',
      'Pathfinder Society',
      'Other Books',
    ]
    for (const g of allGroups) {
      expect(BOOK_GROUP_ORDER).toContain(g)
    }
  })
})
