import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { FEAT_CANTRIP_GRANTS } from '../src/rules/featCantripGrants';
import { serCantripSpec } from '../scripts/aon-verify/_ser';
import { OPEN_SOURCE_LABEL, openChoiceOptions } from '../src/rules/openChoice';
import { buildNeedsDeity, buildUsesDeity, emptyBuild, setupMissing, type BuildState } from '../src/rules/build';

/**
 * WHICH TRADITION AN INNATE SPELL IS CAST AT.
 *
 * One pooled `innate-casting` entry collects the heritage's spells, a background's, every invested
 * item's and every feat's, and its single `tradition` is a MAJORITY VOTE over them. When a grant
 * carried no tradition of its own, `buildCharacter` fell back to the SPELL's first listed tradition —
 * whichever one the importer happened to write first — so the vote was cast on a guess:
 *
 *   a sarangay's Awakened Jewel says "one cantrip from the OCCULT spell list" and the app said Arcane
 *   Awakened Magic says "as an primal innate spell"                            and the app said Arcane
 *   Bone Magic's own sentence allows only occult or primal                     and the app said Arcane
 *
 * The fix is a tradition on the grant (or the flag of the choice that asks for it), plus a per-spell
 * `spellTraditions` map so the entry can state the truth about each spell instead of about the vote.
 */
const db = content();
const innateOf = (ch: ReturnType<typeof build>) => ch.spellcasting.find((e) => e.type === 'innate');

describe('a pick-a-cantrip feat grants at the tradition its own sentence names', () => {
  const jewel = (pick: string) =>
    build('fighter', 20, {
      ancestryId: 'sarangay',
      featPicks: { '1:ancestry:0': 'awakened-jewel' },
      pickCantripChoices: { 'awakened-jewel': pick },
    });

  it("Awakened Jewel's cantrip is occult whichever one the player picks", () => {
    // Bullhorn resolves ARCANE from the spell's own list and Forbidding Ward resolves DIVINE, so this
    // fails two different ways without the fix — and neither is a tradition the feat allows.
    for (const pick of ['bullhorn', 'forbidding-ward']) {
      const e = innateOf(jewel(pick))!;
      expect(e.tradition, `${pick} entry tradition`).toBe('occult');
      expect(e.spellTraditions?.[pick], `${pick} per-spell tradition`).toBe('occult');
    }
  });

  it("Awakened Magic's is primal — \"you can cast this spell as an primal innate spell\"", () => {
    const ch = build('fighter', 20, {
      ancestryId: 'awakened-animal',
      featPicks: { '1:ancestry:0': 'awakened-magic' },
      pickCantripChoices: { 'awakened-magic': 'caustic-blast' },
    });
    const e = innateOf(ch)!;
    expect(e.tradition).toBe('primal'); // caustic-blast's own first tradition is arcane
    expect(e.spellTraditions?.['caustic-blast']).toBe('primal');
  });
});

describe("Bone Magic's Special clause — the tradition is the player's answer", () => {
  /* "Choose when you gain this feat whether your innate spells are primal or occult; this choice
   * applies to all innate spells you gain from lizardfolk ancestry feats that have Bone Magic as a
   * prerequisite." Measured: exactly two feats have that prerequisite (Bone Investiture, Fossil
   * Rider), and both are governed by the one answer. */
  const lizard = (answer: string) =>
    build('fighter', 13, {
      ancestryId: 'lizardfolk',
      featPicks: { '1:ancestry:0': 'bone-magic', '13:ancestry:0': 'bone-investiture' },
      featChoices: { '1:ancestry:0': answer },
      pickCantripChoices: { 'bone-magic': 'electric-arc' },
    });

  it('the record asks the question at all', () => {
    const ch = db.feats['bone-magic'].choice;
    expect(ch?.flag).toBe('boneMagicTradition');
    expect(ch?.options?.map((o) => o.value).sort()).toEqual(['occult', 'primal']);
  });

  it('the pick AND the prerequisite feat both follow that one answer', () => {
    for (const answer of ['occult', 'primal']) {
      const e = innateOf(lizard(answer))!;
      // Electric Arc's own first tradition is arcane and Bone Investiture's grant is authored primal,
      // so before the flag these two disagreed with each other AND the entry flipped on grant order.
      expect(e.spellTraditions?.['electric-arc'], `cantrip @ ${answer}`).toBe(answer);
      expect(e.spellTraditions?.['dinosaur-form'], `Dinosaur Form @ ${answer}`).toBe(answer);
      expect(e.tradition).toBe(answer);
    }
  });

  it('an unanswered lizardfolk still gets the grant, at its authored fallback', () => {
    const ch = build('fighter', 13, {
      ancestryId: 'lizardfolk',
      featPicks: { '13:ancestry:0': 'bone-investiture' },
    });
    expect(innateOf(ch)!.spellTraditions?.['dinosaur-form']).toBe('primal');
  });
});

describe('the eleven records the scan found, that nobody had read', () => {
  /* `npm run scan:traditions` reads every innate grant in every bucket. The audit named one record in
   * this shape; the scan found eleven more, five of which showed a tradition the record's own sentence
   * contradicts. These five are the ones a player would have seen wrong. */
  const CASES: [string, string, string, string][] = [
    ['heroes-call', 'heroism', 'occult', 'divine'],
    ['elemental-wrath', 'acid-splash', 'primal', 'arcane'],
    ['sense-thoughts', 'mind-reading', 'occult', 'arcane'],
    ['brilliant-vision', 'see-the-unseen', 'occult', 'arcane'],
    ['replicate', 'illusory-disguise', 'occult', 'arcane'],
  ];

  it.each(CASES)('%s casts %s as %s, not %s', (featId, spellId, right, wrong) => {
    expect(right).not.toBe(wrong); // the case is only meaningful because the two differ
    expect(db.spells[spellId].traditions?.[0], 'the fallback this replaces').toBe(wrong);
    const g = db.feats[featId].innateSpells?.find((x) => x.spellId === spellId);
    expect(g?.tradition).toBe(right);
    const ch = build('fighter', 20, { featPicks: { '1:ancestry:0': featId } });
    expect(innateOf(ch)!.spellTraditions?.[spellId]).toBe(right);
  });

  it('and the scan stays at zero, in both directions', async () => {
    const { audit } = await import('../scripts/scan-innate-traditions.mjs');
    const r = audit();
    expect(
      r.contradicts,
      'an authored tradition that contradicts the record\'s own printed sentence',
    ).toEqual([]);
    expect(
      r.todo.map((x: { key: string; spellId: string; tradition: string }) => `${x.key} ${x.spellId} -> ${x.tradition}`),
      'these print exactly one tradition and carry none.\nFix with: node scripts/apply-innate-tradition-sweep.mjs',
    ).toEqual([]);
    expect(r.cantripTodo, 'a FEAT_CANTRIP_GRANTS pick whose text names a tradition it does not carry').toEqual([]);
  });
});

describe('the cantrip-pick registry', () => {
  const TRADITIONS = ['arcane', 'divine', 'occult', 'primal'];

  it('every tradition it names is a real one', () => {
    const bad: string[] = [];
    for (const [id, spec] of Object.entries(FEAT_CANTRIP_GRANTS)) {
      if (spec.tradition && !TRADITIONS.includes(spec.tradition)) bad.push(`${id}: ${spec.tradition}`);
      for (const [opt, t] of Object.entries(spec.traditionByOption ?? {})) {
        if (!TRADITIONS.includes(t)) bad.push(`${id}.${opt}: ${t}`);
        if (!spec.options.includes(opt)) bad.push(`${id}.${opt} is not one of its options`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('survives the serialiser that rewrites its file whole', () => {
    /* `scripts/aon-verify/apply-clear.ts` regenerates featCantripGrants.ts from this serialiser, so a
     * field it does not emit is deleted at that script's next run — with no error and no diff. Its own
     * version emitted `prompt` and `options` only, which would have stripped the tradition from 44 of
     * the 51 entries this lane depends on. */
    for (const [id, spec] of Object.entries(FEAT_CANTRIP_GRANTS)) {
      const out = serCantripSpec(spec);
      expect(JSON.parse(JSON.stringify(eval(`(${out})`))), id).toEqual(JSON.parse(JSON.stringify(spec)));
      if (spec.tradition) expect(out, id).toContain(`tradition: '${spec.tradition}'`);
    }
  });
});

describe('every open choice names a source the resolver actually implements', () => {
  /**
   * THE GUARD FOR A SHIPPED DEFECT. Blessed Blood's picker was authored `from.type: 'deity-spell'`
   * while `openChoiceOptions` implements `'own-deity-spell'`. The switch has no default beyond `[]`,
   * so the picker resolved EMPTY: the player could never answer, and because the engine adds only the
   * answered spells once a deity grants more than the printed cap, a Nethys sorcerer ended up with
   * none of the three the feat gives them.
   *
   * Nothing failed loudly — an unimplemented case and a legitimately empty list look identical — so
   * this checks the NAMES, at every depth, against the resolver's own cases.
   */
  // The resolver's cases, read from its source: a hand-copied list here would be the second registry
  // that drifts from the first, which is the bug being guarded against.
  const implemented = new Set<string>();
  for (const m of readFileSync('src/rules/openChoice.ts', 'utf8').matchAll(/case '([a-z-]+)':/g)) implemented.add(m[1]);

  const found: { where: string; type: string }[] = [];
  const walk = (node: unknown, where: string) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${where}[${i}]`));
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'from' && v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string')
        found.push({ where, type: (v as { type: string }).type });
      walk(v, `${where}.${k}`);
    }
  };
  for (const [bucket, recs] of Object.entries(db as unknown as Record<string, Record<string, unknown>>)) {
    if (!recs || typeof recs !== 'object') continue;
    for (const [id, rec] of Object.entries(recs)) walk(rec, `${bucket}/${id}`);
  }

  it('finds the choices at all — a walk that matches nothing would pass vacuously', () => {
    expect(implemented.size).toBeGreaterThan(5);
    expect(found.length).toBeGreaterThan(20);
  });

  it('and every one of them resolves to a real case', () => {
    const bad = found.filter((f) => !implemented.has(f.type)).map((f) => `${f.where} → from.type '${f.type}'`);
    expect(bad, 'these render an empty picker and no error').toEqual([]);
  });

  it('and has a name a player can read, not its slug', () => {
    // The picker's placeholder printed `from.type` raw, so sixteen records said "Search
    // own-deity-spell…" / "Search own-item…" to the player.
    expect([...implemented].filter((t) => !OPEN_SOURCE_LABEL[t])).toEqual([]);
  });

  it('and a sorcerer who takes Blessed Blood is ASKED for a deity at all', () => {
    /* The picker was gated on `buildNeedsDeity`, which is a class/subclass question — a sorcerer's
     * class and bloodline ask for no deity, so the card never rendered, `deityId` stayed null and the
     * feat could not work for anybody. Its own note pointed at a control that did not exist.
     *
     * The narrow predicate must STAY narrow: it also grants the deity's favored weapon, which is a
     * cleric benefit, not something a sorcerer feat hands out. */
    const plain = { ...emptyBuild(), classId: 'sorcerer', subclassId: 'draconic', level: 2 };
    const withIt = { ...plain, featPicks: { '2:class:0': 'blessed-blood-sorcerer' } };
    expect(buildUsesDeity(plain, db)).toBe(false);
    expect(buildUsesDeity(withIt, db)).toBe(true);
    expect(buildNeedsDeity(withIt, db), 'the favored-weapon predicate must not widen').toBe(false);
    expect(setupMissing(withIt, db)).toContain('Deity');
    expect(setupMissing({ ...withIt, deityId: 'nethys' }, db)).not.toContain('Deity');
    // …and the same dead end existed for every `domains` choice taken by a non-cleric.
    expect(buildUsesDeity({ ...plain, featPicks: { '2:class:0': 'domain-initiate' } }, db)).toBe(true);
  });

  it("Blessed Blood's picker offers this character's deity's spells, and nobody else's", () => {
    const from = db.feats['blessed-blood-sorcerer'].choice?.from;
    const nethys = build('sorcerer', 20, { deityId: 'nethys' } as Partial<BuildState>);
    const ids = openChoiceOptions(from, db, { character: nethys }).map((o) => o.id);
    expect(ids.sort()).toEqual([...db.deities.nethys!.spells!].sort());
    const godless = build('sorcerer', 20, { deityId: null } as Partial<BuildState>);
    expect(openChoiceOptions(from, db, { character: godless })).toEqual([]);
  });
});
