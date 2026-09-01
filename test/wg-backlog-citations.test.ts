import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A SETTLE COMMENT MAY NOT CITE A BACKLOG ENTRY THAT DOES NOT EXIST.
 *
 * The three parity registries — VERIFIED_EQUIVALENT (wg-diff.mjs), SETTLED_VALUES (wg-values.mjs) and
 * the identity map (wg-identity.mjs) — are how a disagreement with the Wanderer's Guide dump gets
 * closed without fixing it: the reading that settled it is written above the key, and anything the
 * reading DEFERRED is supposed to be handed to `work/wg-lane-backlog.md` so a later pass can pick it
 * up. "Recorded in work/wg-lane-backlog.md" is therefore a promise, and the registry entry stops the
 * record being reported again — so a promise that was never kept doesn't just lose the note, it makes
 * the record permanently invisible to the very pass that would have found it.
 *
 * That happened. Both `merchants-scale` settles said "Recorded in work/wg-lane-backlog.md"; the
 * backlog had no entry for it, and the item's empty description had been silenced in two registries
 * at once. Nothing could have caught it, because the citation is prose and prose is not checked.
 *
 * This checks it. Cheap, structural, and it runs on every commit.
 */
const ROOT = join(__dirname, '..');
const BACKLOG = 'work/wg-lane-backlog.md';
const backlog = readFileSync(join(ROOT, BACKLOG), 'utf8');

/** A registry key line: `'merchants-scale': ['skill'],` or `alchemy: ['conditional'],`. */
const KEY_LINE = /^\s*'?([A-Za-z][\w-]*)'?:\s*\[/;
/** A line that is part of a block comment (or its close) — the only thing allowed between a
 *  citation and the key it belongs to. */
const COMMENT_LINE = /^\s*(\/?\*|\*\/)/;

type Citation = { file: string; line: number; id: string };

/**
 * Every citation of the backlog that sits inside a settle comment, paired with the record id the
 * comment is settling.
 *
 * A citation NOT immediately above a registry key is a policy mention rather than a promise about one
 * record — wg-diff.mjs's differ comment says the backlog "is where they go until a lane exists" — and
 * has no id to check. Those are skipped by construction: the walk stops at the first non-comment line.
 */
function citations(): { promises: Citation[]; policyMentions: number } {
  const promises: Citation[] = [];
  let policyMentions = 0;
  for (const f of readdirSync(join(ROOT, 'scripts')).filter((n) => /^wg-.*\.mjs$/.test(n))) {
    const lines = readFileSync(join(ROOT, 'scripts', f), 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      if (!text.includes(BACKLOG)) return;
      for (let j = i + 1; j < lines.length; j++) {
        const key = KEY_LINE.exec(lines[j]);
        if (key) { promises.push({ file: `scripts/${f}`, line: i + 1, id: key[1] }); return; }
        if (!COMMENT_LINE.test(lines[j]) && lines[j].trim() !== '') { policyMentions++; return; }
      }
      policyMentions++;
    });
  }
  return { promises, policyMentions };
}

describe('every settle comment that cites the parity backlog names a record the backlog holds', () => {
  it('or the record was silenced in a registry and handed to nobody', () => {
    const { promises } = citations();
    // Proves the walk found the settle comments rather than silently matching nothing — the failure
    // mode that makes a structural guard pass forever.
    expect(promises.length).toBeGreaterThanOrEqual(4);
    const broken = promises.filter((c) => !backlog.includes(c.id));
    expect(
      broken.length
        ? broken.map((c) => `${c.file}:${c.line} cites ${BACKLOG} for '${c.id}', which the backlog never mentions`).join('\n') +
          `\nEither write the entry, or drop the citation — the registry key already stops '${broken[0].id}' being reported again.`
        : 'every cited record has a backlog entry',
    ).toBe('every cited record has a backlog entry');
  });
});
