import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { openChoiceOptions } from '../src/rules/openChoice';

const c = content();

/**
 * APPLIED BUILD-TIME CHOICES.
 *
 * `record.choice` is what the builder renders as a picker (Builder.tsx reads def.kind, then either
 * resolves options from the deity/character or takes def.options). These assertions check the SHAPE
 * the builder actually consumes, so a malformed entry fails here rather than rendering an empty or
 * broken picker.
 */
describe('choice definitions are well-formed', () => {
  const collections = ['feats', 'classFeatures', 'items', 'heritages', 'backgrounds', 'ancestries'] as const;
  const all = collections.flatMap((col) =>
    Object.entries((c as unknown as Record<string, Record<string, { choice?: Record<string, unknown> }>>)[col] ?? {})
      .filter(([, r]) => r.choice)
      .map(([id, r]) => ({ col, id, choice: r.choice as Record<string, unknown> })),
  );

  it('there are choices to check', () => {
    expect(all.length).toBeGreaterThan(150);
  });

  it('every choice has a flag, a prompt and a kind the builder understands', () => {
    const KINDS = new Set(['array', 'skills', 'domains', 'text', 'open']);
    const bad = all.filter((x) => !x.choice.flag || !x.choice.prompt || !KINDS.has(String(x.choice.kind)));
    expect(bad.map((x) => `${x.id}(${x.choice.kind})`), 'malformed choice defs').toEqual([]);
  });

  it("every CONTENT-resolved 'open' choice offers a non-empty list", () => {
    for (const x of all.filter((y) => y.choice.kind === 'open')) {
      expect(x.choice.from, `${x.id} is open but carries no \`from\``).toBeTruthy();
      // `own-*` sources draw from the CHARACTER, so an empty list without one is correct — and even
      // with one, "you know no stances yet" is a legitimate state. Only content-resolved sources
      // must always offer something. Ghost Hunter nearly shipped an empty content picker: its printed
      // divination/enchantment/necromancy restriction matches ZERO spells post-Remaster.
      const from = x.choice.from as { type: string };
      if (String(from.type).startsWith('own-')) continue;
      const opts = openChoiceOptions(from as never, c);
      expect(opts.length, `${x.id} resolves to an EMPTY picker`).toBeGreaterThan(0);
    }
  });

  it("every 'array' choice offers at least two real options", () => {
    const bad = all
      .filter((x) => x.choice.kind === 'array')
      .filter((x) => {
        const opts = (x.choice.options ?? []) as { value?: string; label?: string }[];
        return opts.length < 2 || opts.some((o) => !o.value || !o.label);
      });
    // A one-option "choice" is not a choice, and a blank label renders an empty picker row.
    expect(bad.map((x) => x.id), 'array choices with <2 usable options').toEqual([]);
  });

  it("'skills'/'domains'/'text' choices carry NO baked option list", () => {
    // Those resolve against the character or the deity at build time; a stored list would go stale.
    const bad = all
      .filter((x) => x.choice.kind !== 'array')
      .filter((x) => ((x.choice.options ?? []) as unknown[]).length > 0);
    expect(bad.map((x) => x.id)).toEqual([]);
  });

  it('option values are unique within a choice', () => {
    const bad: string[] = [];
    for (const x of all) {
      const opts = (x.choice.options ?? []) as { value: string }[];
      const seen = new Set(opts.map((o) => o.value));
      if (seen.size !== opts.length) bad.push(x.id);
    }
    expect(bad, 'duplicate option values would make two rows indistinguishable').toEqual([]);
  });
});
