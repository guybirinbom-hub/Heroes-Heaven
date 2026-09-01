import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { openChoiceOptions } from '../src/rules/openChoice';
import { featChoicePrompt } from '../src/rules/build';

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
    // 'ikons' resolves against the character's own exemplar picks, narrowed by the asking feat's
    // printed Usage line — see buildChoiceOptions and test/ikon-imbue.test.ts.
    const KINDS = new Set(['array', 'skills', 'domains', 'text', 'open', 'ikons']);
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

/**
 * NO RAW FOUNDRY PATHS IN A PICKER.
 *
 * The importer copied Foundry's ChoiceSet values verbatim, so eight records shipped options like
 * `system.skills.stealth.rank` and `Compendium.pf2e.feats-srd.Item.Pet`. Three used the path as the
 * LABEL too, which the player read in the picker; and the stored answer was unresolvable either way.
 */
describe('choice options use app ids, not import artifacts', () => {
  const collections = ['feats', 'classFeatures', 'items', 'heritages', 'backgrounds', 'ancestries'] as const;

  it('no option value or label is a Foundry path', () => {
    const bad: string[] = [];
    for (const col of collections) {
      for (const [id, r] of Object.entries(
        (c as unknown as Record<string, Record<string, { choice?: { options?: { value: string; label: string }[] } }>>)[col] ?? {},
      )) {
        for (const o of r.choice?.options ?? []) {
          if (/^(system\.|Compendium\.|@)/.test(String(o.value))) bad.push(`${col}/${id} value=${o.value}`);
          if (/^(system\.|Compendium\.|@)/.test(String(o.label))) bad.push(`${col}/${id} label=${o.label}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('the rewritten ids resolve to real records', () => {
    expect(c.feats['beast-trainer'].choice?.options?.map((o) => o.value)).toEqual(['pet', 'train-animal']);
    for (const v of c.feats['beast-trainer'].choice!.options!.map((o) => o.value)) expect(c.feats[v], v).toBeTruthy();
    expect(c.feats['second-blessing'].choice?.options?.map((o) => o.value)).toEqual(['blessed-armament', 'blessed-shield', 'blessed-swiftness']);
    for (const v of c.feats['second-blessing'].choice!.options!.map((o) => o.value)) expect(c.classFeatures[v], v).toBeTruthy();
  });

  it('skill and save options use the keys the app uses elsewhere', () => {
    /* Was Rogue Dedication; its `choice` was the inert half of a two-lane skill question and has been
     * removed (drop-inert-skill-choices.mjs). Bloodrager Dedication is the record that KEEPS a skill
     * `choice`, because its grant reads the answer through `choiceGrants`. */
    expect(c.feats['bloodrager-dedication'].choice?.options?.map((o) => o.value)).toEqual(['arcana', 'religion']);
    expect(c.feats['canny-acumen'].choice?.options?.map((o) => o.value)).toEqual(['fortitude', 'reflex', 'will', 'perception']);
  });
});

/**
 * A picker labelled "Choose an option" tells the player nothing.
 *
 * 30 records carry the importer's placeholder prompt ("Prompt"). featChoicePrompt used to turn every
 * one of them into the same generic label, throwing away the FLAG — which usually names the thing
 * being chosen.
 */
describe('choice prompts say what is being chosen', () => {
  it('a placeholder prompt falls back to the flag, humanised', () => {
    expect(featChoicePrompt('Prompt', 'terrain')).toBe('Terrain');
    expect(featChoicePrompt('Prompt', 'performanceType')).toBe('Performance type');
    expect(featChoicePrompt('Prompt', 'featCelestialResistance')).toBe('Celestial resistance');
  });

  it('a real prompt always wins', () => {
    expect(featChoicePrompt('Second weapon configuration', 'anything')).toBe('Second weapon configuration');
  });

  it('a flag that names nothing still degrades gracefully', () => {
    expect(featChoicePrompt('Prompt', 'choice')).toBe('Choose an option');
    expect(featChoicePrompt(undefined)).toBe('Choose an option');
  });

  it('no shipped picker would render the literal word "Prompt"', () => {
    const bad: string[] = [];
    for (const col of ['feats', 'classFeatures', 'items', 'heritages', 'backgrounds'] as const) {
      for (const [id, r] of Object.entries((c as unknown as Record<string, Record<string, { choice?: { prompt?: string; flag?: string } }>>)[col] ?? {})) {
        if (!r.choice) continue;
        if (/^prompt$/i.test(featChoicePrompt(r.choice.prompt, r.choice.flag))) bad.push(`${col}/${id}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
