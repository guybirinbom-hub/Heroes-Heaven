/*
 * Restricted spell slots — extra slots that may hold only certain spells.
 *
 * Four records need this and all four were previously either unbuilt or shipped as ordinary slots
 * plus a warning, which over-grants: Conscious Spell Specialization handed a 14th-level psychic four
 * unrestricted casts a day that it does not have.
 *
 * The resolver lives here rather than in build.ts because two callers need it. Feats, class features
 * and invested items grant these at BUILD time; a Candle of Invocation is a consumable you light, so
 * its grant rides on a toggleable mode and is applied by the PLAY overlay instead.
 */
import type { RestrictedSlot, RestrictedSlotGrant, SpellcastingEntry } from './types';

/**
 * Turn a grant into one object per actual slot.
 *
 * `groupKey` must be stable across rebuilds — it is what play state keys prepared spells and
 * expended flags against. Derive it from the grant's position among the character's grants, never
 * from the slot's position in a rendered list.
 */
export function resolveRestrictedSlots(
  grant: RestrictedSlotGrant,
  entry: Pick<SpellcastingEntry, 'id' | 'type' | 'slots' | 'prepared' | 'grantedRepertoire'>,
  level: number,
  groupKey: string,
): RestrictedSlot[] {
  const castable = Object.keys(entry.slots ?? entry.prepared ?? {})
    .map(Number)
    .filter((r) => r > 0)
    .sort((a, b) => a - b);
  const highest = castable[castable.length - 1] ?? 0;

  const counts: Record<number, number> = {};
  const allowed = [...(grant.spells ?? [])];
  for (const [rank, n] of Object.entries(grant.byRank ?? {})) if (n > 0) counts[Number(rank)] = n;
  // Ranks that ADD at a later level ("at 18th level, you ALSO gain a 5th-rank slot").
  for (const step of grant.byRankAt ?? [])
    if (level >= step.level) for (const [rank, n] of Object.entries(step.byRank)) if (n > 0) counts[Number(rank)] = (counts[Number(rank)] ?? 0) + n;

  // The ladder REPLACES rather than accumulates: Creed Magic's two slots become 3rd rank at 10th and
  // 4th at 14th — it never has six. Only the highest step reached sets the ranks…
  const reached = (grant.ladder ?? []).filter((s) => level >= s.level).sort((a, b) => a.level - b.level);
  if (reached.length) {
    for (const k of Object.keys(counts)) delete counts[Number(k)];
    for (const [rank, n] of Object.entries(reached[reached.length - 1].byRank)) if (n > 0) counts[Number(rank)] = n;
  }
  // …while its `addSpells` accumulate across every step passed: the allowed list grows even though
  // the slot count does not.
  for (const step of reached) for (const s of step.addSpells ?? []) if (!allowed.includes(s)) allowed.push(s);

  if (grant.halfHighest && highest > 0) {
    const half = Math.floor(highest / 2);
    if (half > 0) counts[half] = (counts[half] ?? 0) + grant.halfHighest;
  }

  // A player-chosen rank still needs somewhere to sit before the player picks: the highest it may
  // legally reach, which is the choice they would almost always make.
  const rankOptions = grant.rankChoice ? castable.filter((r) => r <= highest - grant.rankChoice!.belowHighest) : undefined;
  if (grant.rankChoice && rankOptions?.length) {
    const top = rankOptions[rankOptions.length - 1];
    counts[top] = (counts[top] ?? 0) + grant.rankChoice.count;
  }

  // "Whatever your subclass granted" — a psychic's conscious mind, which ships a real id list. A
  // wizard's curriculum does NOT, so Sin Reservoir sets neither and keeps its restriction as prose.
  if (grant.from === 'subclass-granted')
    for (const ids of Object.values(entry.grantedRepertoire ?? {})) for (const s of ids) if (!allowed.includes(s)) allowed.push(s);

  const spontaneous = entry.type === 'spontaneous';
  const out: RestrictedSlot[] = [];
  let i = 0;
  for (const rank of Object.keys(counts).map(Number).sort((a, b) => a - b)) {
    // A slot at a rank the caster cannot reach is not a slot. A Candle held by a 3rd-rank caster
    // resolves to 1st, but Creed Magic's 4th-rank step must not arrive before 4th-rank slots do.
    if (rank <= 0 || (highest > 0 && rank > highest)) continue;
    for (let n = 0; n < counts[rank]; n++, i++) {
      out.push({
        id: `${entry.id}:rs:${groupKey}:${i}`,
        label: grant.label,
        ...(grant.note ? { note: grant.note } : {}),
        rank,
        ...(rankOptions && rankOptions.length > 1 ? { rankOptions } : {}),
        ...(allowed.length ? { allowed } : {}),
        spellId: null,
        expended: false,
        ...(spontaneous ? { spontaneous: true } : {}),
      });
    }
  }
  return out;
}
