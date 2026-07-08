// Compact card data for the party page — computed by each owner at publish time (so teammates render
// a small summary without pulling the whole sheet). Everything is wrapped defensively: a partial or
// odd character must never throw the publish/sync path.
import type { Character, ContentDatabase } from '../rules/types';
import { deriveMaxHp, deriveAc, derivePerception } from '../rules/derive';

export interface PartySummary {
  name: string;
  ancestry?: string;
  className?: string;
  level: number;
  hpCur: number;
  hpMax: number;
  hpTemp?: number;
  ac: number;
  perception: number;
  conditions: { name: string; value?: number }[];
  modes: string[];
  /** Compressed portrait (synced copy) for the card avatar, when the character has one. */
  portrait?: string;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Build the small card summary from a live (play-applied) character. Never throws. */
export function computeSummary(c: Character, content: ContentDatabase): PartySummary {
  const safe = <T,>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const hpMax = safe(() => deriveMaxHp(c, content), c.hitPoints?.current ?? 0);
  return {
    name: c.name || 'Unnamed',
    ancestry: c.ancestryId ? content.ancestries[c.ancestryId]?.name : undefined,
    className: c.classId ? content.classes[c.classId]?.name : undefined,
    level: c.level ?? 0,
    hpCur: c.hitPoints?.current ?? hpMax,
    hpMax,
    hpTemp: c.hitPoints?.temp || undefined,
    ac: safe(() => deriveAc(c, content).value, 10),
    perception: safe(() => derivePerception(c).modifier, 0),
    conditions: (c.conditions ?? []).map((cond) => ({
      name: content.conditions?.[cond.id]?.name ?? cap(cond.id),
      value: cond.value,
    })),
    modes: (c.activeModes ?? []).map((m) => m.name).filter(Boolean),
    portrait: c.appearance?.portrait,
  };
}
