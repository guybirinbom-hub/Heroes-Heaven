/*
 * Per-period feat uses.
 *
 * ITEMS have had trackable uses for a while (item.frequency / item.counters → pips on the inventory
 * row, see itemUses.ts). FEATS had nothing: a feat printing "Frequency once per day" was text the
 * player had to remember unaided, and ~900 records in core.json say exactly that.
 *
 * A feat opts in with `limitedUses: { max, per }`. Spent uses live in PlayState.featUses keyed by feat
 * id — play state, not build state, because they change during a session and refill at rest.
 */
import type { Character, ContentDatabase, Feat } from './types';

export interface FeatUse {
  featId: string;
  name: string;
  /** Uses left right now. */
  current: number;
  max: number;
  /** 'day', 'hour', … — shown as "1/day" so the cadence is visible without opening the feat. */
  per: string;
}

/** The period label the sheet shows next to the pips. */
export const usesLabel = (u: { max: number; per: string }) => `${u.max}/${u.per}`;

/** Live use state for one feat, or null when that feat has no trackable limit. */
export function featUse(c: Character, feat: Feat | undefined): FeatUse | null {
  const lim = feat?.limitedUses;
  if (!feat || !lim || lim.max <= 0) return null;
  const spent = c.featUses?.[feat.id] ?? 0;
  return {
    featId: feat.id,
    name: feat.name,
    // Clamp: a stale spend count (feat retrained, data changed) must never show a negative pip count.
    current: Math.max(0, Math.min(lim.max, lim.max - spent)),
    max: lim.max,
    per: lim.per,
  };
}

/** Every limited-use feat the character actually has, in feat order. */
export function featUses(c: Character, db: ContentDatabase): FeatUse[] {
  const out: FeatUse[] = [];
  const seen = new Set<string>();
  for (const f of c.feats ?? []) {
    if (seen.has(f.featId)) continue;
    seen.add(f.featId);
    const use = featUse(c, db.feats[f.featId]);
    if (use) out.push(use);
  }
  return out;
}

/** Spend one use (never below zero remaining). Returns the new spent-count map. */
export function spendFeatUse(
  featUsesMap: Record<string, number> | undefined,
  featId: string,
  max: number,
): Record<string, number> {
  const spent = featUsesMap?.[featId] ?? 0;
  return { ...(featUsesMap ?? {}), [featId]: Math.min(max, spent + 1) };
}

/** Give one use back (never below zero spent) — the undo for a misclick. */
export function refundFeatUse(
  featUsesMap: Record<string, number> | undefined,
  featId: string,
): Record<string, number> {
  const spent = featUsesMap?.[featId] ?? 0;
  return { ...(featUsesMap ?? {}), [featId]: Math.max(0, spent - 1) };
}
