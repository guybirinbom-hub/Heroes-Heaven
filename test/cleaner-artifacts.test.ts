import { describe, it, expect } from 'vitest';
import { content } from './_content';

/**
 * Guard against import text-mangling: the importer cleans Foundry HTML/markup (@UUID, @Damage,
 * @Check, [[/r …]] inline rolls, handlebars, @actor/@item getters) out of every description. When
 * that cleaning misses a token it leaves visible noise in prose — e.g. the healing potion once read
 * "you regain ] Hit Points." because @Damage[(2d8+5)[healing]]'s outer ] was stranded. This test
 * scans EVERY description in the bundle and fails listing the offenders, so such bugs can't ship.
 */

const db = content() as unknown as Record<string, unknown>;

/** Every `${collection}/${id}` whose entry carries a non-empty `description` string. */
function descriptions(): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const [coll, map] of Object.entries(db)) {
    if (!map || typeof map !== 'object') continue;
    for (const [id, entry] of Object.entries(map as Record<string, unknown>)) {
      const d = entry && typeof entry === 'object' ? (entry as { description?: unknown }).description : undefined;
      if (typeof d === 'string' && d) out.push({ id: `${coll}/${id}`, text: d });
    }
  }
  return out;
}

// Residual Foundry markup that must never reach prose.
const STRONG = /@(?:UUID|Compendium|Damage|Check|Template|Localize|AdjustDegree)\b|\]\]|\{\{|\}\}|@(?:item|actor)\./;

/** True when square brackets don't balance — a stray closer (the "] Hit Points" smell) or a left-open one. */
function bracketsUnbalanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '[') depth++;
    else if (ch === ']') {
      if (depth === 0) return true;
      depth--;
    }
  }
  return depth !== 0;
}

describe('imported descriptions are free of Foundry-markup artifacts', () => {
  const all = descriptions();

  it('scans a substantial body of descriptions', () => {
    expect(all.length).toBeGreaterThan(1000);
  });

  it('has no residual @-macros, inline-roll closers, handlebars, or leaked data getters', () => {
    const offenders = all.filter((d) => STRONG.test(d.text)).map((d) => d.id);
    expect(offenders).toEqual([]);
  });

  it('has no unmatched square brackets (the stray-"]" mangling smell)', () => {
    const offenders = all.filter((d) => bracketsUnbalanced(d.text)).map((d) => d.id);
    expect(offenders).toEqual([]);
  });

  it('has balanced bold markers — no unpaired "**" (renders as a stray asterisk)', () => {
    const offenders = all.filter((d) => ((d.text.match(/\*\*/g) ?? []).length % 2) !== 0).map((d) => d.id);
    expect(offenders).toEqual([]);
  });

  it('has no stray lone "*" tokens (a dangling emphasis/bullet marker)', () => {
    // Remove valid **bold** and *italic* spans, then a surviving whitespace-bounded "*" is an orphan.
    const stray = (s: string) => /(^|\s)\*(\s|$)/m.test(s.replace(/\*\*[\s\S]*?\*\*/g, '').replace(/\*[^*\n]+\*/g, ''));
    const offenders = all.filter((d) => stray(d.text)).map((d) => d.id);
    expect(offenders).toEqual([]);
  });
});
