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
import type { Character, ContentDatabase, Feat, LimitedUses } from './types';

export interface FeatUse {
  featId: string;
  name: string;
  /** Uses left right now. */
  current: number;
  max: number;
  /** 'day', 'hour', … — shown as "1/day" so the cadence is visible without opening the feat. */
  per: string;
  /** Period multiplier ("1 / 10 minutes"); absent means 1. */
  every?: number;
  /** Name of the feat that retuned this limit, when one did — so the pips can say why. */
  upgradedBy?: string;
}

/** The period label the sheet shows next to the pips. */
export const usesLabel = (u: { max: number; per: string; every?: number }) =>
  `${u.max}/${(u.every ?? 1) > 1 ? `${u.every} ${u.per}s` : u.per}`;

/**
 * The limit that actually applies, after any feat that RETUNES it.
 *
 * "You can use Cat's Luck once per hour, rather than once per day" is a second feat rewriting the
 * first one's frequency. Returns null when an upgrade removes the limit entirely (Eternal Wings:
 * "at all times") — an untracked ability, not a zero-use one.
 */
export function effectiveUses(c: Character, feat: Feat | undefined, db?: ContentDatabase): (LimitedUses & { upgradedBy?: string }) | null {
  if (!feat) return null;
  let lim = feat.limitedUses;
  if (!db) return lim ?? null;
  for (const f of c.feats ?? []) {
    const up = db.feats[f.featId]?.usesUpgrade;
    if (up?.featId !== feat.id) continue;
    if (up.unlimited) return null;
    // A partial upgrade keeps whatever it doesn't restate ("three times per day instead of once per
    // day" changes only the count), so fall back to the base limit field by field.
    lim = {
      max: up.max ?? lim?.max ?? 1,
      per: up.per ?? lim?.per ?? 'day',
      ...(up.every ?? lim?.every ? { every: up.every ?? lim?.every } : {}),
    };
    return { ...lim, upgradedBy: db.feats[f.featId]?.name };
  }
  return lim ?? null;
}

/** Live use state for one feat, or null when that feat has no trackable limit. */
export function featUse(c: Character, feat: Feat | undefined, db?: ContentDatabase): FeatUse | null {
  const lim = effectiveUses(c, feat, db);
  if (!feat || !lim || lim.max <= 0) return null;
  const spent = c.featUses?.[feat.id] ?? 0;
  return {
    featId: feat.id,
    name: feat.name,
    // Clamp: a stale spend count (feat retrained, data changed) must never show a negative pip count.
    current: Math.max(0, Math.min(lim.max, lim.max - spent)),
    max: lim.max,
    per: lim.per,
    ...(lim.every ? { every: lim.every } : {}),
    ...(lim.upgradedBy ? { upgradedBy: lim.upgradedBy } : {}),
  };
}

/** Every limited-use feat the character actually has, in feat order. */
export function featUses(c: Character, db: ContentDatabase): FeatUse[] {
  const out: FeatUse[] = [];
  const seen = new Set<string>();
  for (const f of c.feats ?? []) {
    if (seen.has(f.featId)) continue;
    seen.add(f.featId);
    const use = featUse(c, db.feats[f.featId], db);
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

/**
 * Periods shorter than a day. `rest()` refills everything, but a "once per round" feat that only came
 * back at daily preparations would be usable once per DAY — the tracker would be lying in the
 * restrictive direction. These refill on the encounter/round reset instead.
 */
const SUB_DAILY = new Set(['round', 'turn', 'minute', 'hour']);

/** Whether a feat's limit is shorter than a day, and so refills on the encounter reset. */
export const isSubDaily = (per: string | undefined) => SUB_DAILY.has(String(per));

/**
 * Clear the spend counts for every SUB-DAILY feat, leaving per-day/week/month uses alone.
 *
 * The app has no turn tracker, so this is a deliberate player action ("new encounter") rather than
 * something inferred. Returns a new map; per-day uses keep their spend so a single encounter reset
 * can't refill a daily power.
 */
export function resetEncounterUses(
  featUsesMap: Record<string, number> | undefined,
  featsById: Record<string, { limitedUses?: { per: string } } | undefined>,
  /** Pass the character + db so a RETUNED frequency counts: Reliable Luck makes Cat's Luck hourly,
   *  which is sub-daily and so refills here rather than only at rest. */
  ctx?: { character: Character; content: ContentDatabase },
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [featId, spent] of Object.entries(featUsesMap ?? {})) {
    const per = ctx
      ? effectiveUses(ctx.character, ctx.content.feats[featId], ctx.content)?.per
      : featsById[featId]?.limitedUses?.per;
    if (isSubDaily(per)) continue; // refilled
    next[featId] = spent;
  }
  return next;
}

/** Give one use back (never below zero spent) — the undo for a misclick. */
export function refundFeatUse(
  featUsesMap: Record<string, number> | undefined,
  featId: string,
): Record<string, number> {
  const spent = featUsesMap?.[featId] ?? 0;
  return { ...(featUsesMap ?? {}), [featId]: Math.max(0, spent - 1) };
}
