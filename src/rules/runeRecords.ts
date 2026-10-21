import type { ContentDatabase, InventoryItem } from './types';

/**
 * The runes etched on an inventory row, each with the item record that IS that rune — so a rune named on
 * the thing it sits on opens its own description (Guy, 2026-10-21: "clicking the runes on a thing they
 * are attached to should open the description of that rune").
 *
 * A row stores its fundamental runes as numbers and tiers (`potency: 2`, `striking: 'greater'`,
 * `reinforcing: 3`) and its property runes by id. Every rune ships as an item record whose id is the one
 * the rune records use (content.runes, the same ids — every one of them has an item record); the
 * fundamental ids follow the records' own naming, read off the data:
 *   weapon potency +1..+3   weapon-potency-1..3        mythic (4)  mythic-weapon-potency
 *   armor potency  +1..+3   armor-potency-1..3         mythic (4)  mythic-armor-potency
 *   striking               striking / striking-greater / striking-major / mythic-striking
 *   resilient              resilient / resilient-greater / resilient-major / mythic-resilient
 *   reinforcing 1..6       reinforcing-rune-minor / -lesser / -moderate / -greater / -major / -supreme
 * An id is handed out only when the item record exists in the content the caller passed; otherwise (no
 * content, a potency rune on something that is neither weapon nor armor, a record this build does not
 * ship) the rune is a plain label, as it always was.
 */
export interface RuneEntry {
  /** What the chip says ("+1 potency", "Greater striking", "Flaming"). */
  label: string;
  /** The rune's item record (content.items key), when it ships. */
  id?: string;
}

const REINFORCING = ['', 'minor', 'lesser', 'moderate', 'greater', 'major', 'supreme'] as const;
const REINFORCING_LABEL = ['', 'Minor', 'Lesser', 'Moderate', 'Greater', 'Major', 'Supreme'] as const;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A tiered fundamental rune's record id: the base tier is the bare name, mythic leads, others trail. */
function tierId(base: 'striking' | 'resilient', tier: string): string {
  if (tier === base) return base;
  if (tier === 'mythic') return `mythic-${base}`;
  return `${base}-${tier}`;
}
/** "Striking" for the base tier (never "Striking striking"), else "Greater striking". */
function tierLabel(base: 'striking' | 'resilient', tier: string): string {
  return tier === base ? cap(base) : `${cap(tier)} ${base}`;
}

export function runeEntries(inv: InventoryItem, itemType?: string, content?: ContentDatabase | null): RuneEntry[] {
  const r = inv.runes as
    | { potency?: number; striking?: string; resilient?: string; reinforcing?: number; property?: string[] }
    | undefined;
  if (!r) return [];
  const has = (id: string | undefined) => (id && content?.items?.[id] ? id : undefined);
  const out: RuneEntry[] = [];
  if (r.potency) {
    const kind = itemType === 'weapon' ? 'weapon' : itemType === 'armor' ? 'armor' : undefined;
    const id = kind ? (r.potency >= 4 ? `mythic-${kind}-potency` : `${kind}-potency-${r.potency}`) : undefined;
    out.push({ label: `+${r.potency} potency`, id: has(id) });
  }
  if (r.striking) out.push({ label: tierLabel('striking', r.striking), id: has(tierId('striking', r.striking)) });
  if (r.resilient) out.push({ label: tierLabel('resilient', r.resilient), id: has(tierId('resilient', r.resilient)) });
  if (r.reinforcing) {
    const tier = REINFORCING[r.reinforcing];
    out.push({ label: `${REINFORCING_LABEL[r.reinforcing] ?? ''} reinforcing`.trim(), id: has(tier ? `reinforcing-rune-${tier}` : undefined) });
  }
  for (const p of r.property ?? []) out.push({ label: cap(p.replace(/-/g, ' ')), id: has(p) });
  return out;
}
