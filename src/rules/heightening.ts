/*
 * Spell heightening helpers (pure text parsing).
 *
 * A spell's description bundles its base effect with any "Heightened (...)" entries.
 * Two trigger forms: "(+N)" (relative — applies once the cast rank is N above the base)
 * and "(Nth)" (absolute — applies at cast rank N or higher). The sheet uses these to
 * highlight which heightened effects are active at a chosen cast rank.
 */

/** Split a description into its base text and any "Heightened (...)" entries.
 *  Tolerates the markdown-lite the importer emits: a "**Heightened (…)**" bold label and a
 *  trailing "---" divider that separated the base text from the heightening list. */
export function splitHeightening(desc: string): { base: string; heightening: string[] } {
  const re = /\*{0,2}Heightened\s*\(/;
  const idx = desc.search(re);
  if (idx === -1) return { base: desc.trim(), heightening: [] };
  return {
    // Drop a markdown divider (and surrounding blank lines) that fronted the heightening list.
    base: desc.slice(0, idx).replace(/(?:\n|\s)*-{3,}\s*$/, '').trim(),
    heightening: desc
      .slice(idx)
      .split(/(?=\*{0,2}Heightened\s*\()/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** Parse a heightening entry's trigger: "(+1)" → relative, "(2nd)" → absolute rank. */
export function heightenTrigger(entry: string): { type: 'rel' | 'abs'; n: number } | null {
  let m = entry.match(/^Heightened\s*\(\+(\d+)\)/);
  if (m) return { type: 'rel', n: Number(m[1]) };
  m = entry.match(/^Heightened\s*\((\d+)(?:st|nd|rd|th)\)/);
  if (m) return { type: 'abs', n: Number(m[1]) };
  return null;
}

/** Whether a heightening entry applies when a `base`-rank spell is cast at `rank`. */
export function heighteningApplies(entry: string, base: number, rank: number): boolean {
  const t = heightenTrigger(entry);
  if (!t) return false;
  return t.type === 'rel' ? rank >= base + t.n : rank >= t.n;
}
