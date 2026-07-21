// ── Source / book helpers ───────────────────────────────────────────────────
// AoN source strings carry a page reference ("Core Rulebook pg. 316"); we key
// everything off the BOOK name, so strip the trailing page/volume reference.
// Kept in one place so the Sources setting, the creature filter, and the global
// search all normalise identically.
import { decodeEntities } from './tags'

export function cleanSource(s: string | undefined | null): string {
  return decodeEntities(s ?? '')
    .replace(/\s+pg\.?\s*\d+.*$/i, '')
    .replace(/\s+pp\.?\s*\d+.*$/i, '')
    .trim()
}

// Coarse grouping for the Sources settings list. Purely organisational (the
// search box does the real finding); the buckets just give tidy collapsible
// sections and per-group "turn all on/off" controls. Order is display order.
export type BookGroup =
  | 'Core Rulebooks'
  | 'Bestiaries & Monsters'
  | 'Rulebooks & Expansions'
  | 'Lost Omens'
  | 'Adventure Paths & Adventures'
  | 'Pathfinder Society'
  | 'Other Books'

export const BOOK_GROUP_ORDER: BookGroup[] = [
  'Core Rulebooks',
  'Bestiaries & Monsters',
  'Rulebooks & Expansions',
  'Lost Omens',
  'Adventure Paths & Adventures',
  'Pathfinder Society',
  'Other Books',
]

const CORE = new Set([
  'Core Rulebook', 'Player Core', 'Player Core 2', 'GM Core',
  'Monster Core', 'Monster Core 2', 'NPC Core', 'Gamemastery Guide',
])

export function categorizeBook(book: string): BookGroup {
  const b = book.trim()
  if (CORE.has(b)) return 'Core Rulebooks'
  // Adventure Path volumes ("Pathfinder #NNN: …") and anything explicitly named
  // an Adventure Path (e.g. "Kingmaker Adventure Path").
  if (/^Pathfinder\s*#\s*\d+/i.test(b) || /\bAdventure Path\b/i.test(b)) return 'Adventure Paths & Adventures'
  if (/\b(PFS|Pathfinder Society|Society Scenario|Quest|Bounty)\b/i.test(b)) return 'Pathfinder Society'
  // Lost Omens setting line — most volumes don't carry "Lost Omens" in the
  // source string, so match the well-known titles too.
  if (/lost omens|Travel Guide|Tian Xia|Impossible Lands|Firebrands|Highhelm|Knights of Lastwall|Mwangi Expanse|Shining Kingdoms|Divine Mysteries|World Guide|Character Guide|Ancestry Guide|Absalom/i.test(b)) return 'Lost Omens'
  if (/^Bestiary|Monster Core|NPC Core|Monsters of Myth|Draconic Codex/i.test(b)) return 'Bestiaries & Monsters'
  // Stand-alone hardcover adventures + well-known one-shots.
  if (/Hardcover|Crown of the Kobold King|Plaguestone|Otari|Rusthenge|Abomination Vaults|Gatewalkers|Malevolence|Seven Dooms|Sandpoint|Beginner Box/i.test(b)) return 'Adventure Paths & Adventures'
  if (/Advanced Player|Secrets of Magic|Guns & Gears|Book of the Dead|Dark Archive|Rage of Elements|Treasure Vault|War of Immortals|Battlecry|Gods & Magic|Howl of the Wild|Player['’]s Guide|Remaster|Grand Bazaar|Kingmaker/i.test(b)) return 'Rulebooks & Expansions'
  return 'Other Books'
}
