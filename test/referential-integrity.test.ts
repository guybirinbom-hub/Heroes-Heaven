import { describe, it, expect } from 'vitest';
import { content } from './_content';

const c = content();

/**
 * EVERY ID A RECORD POINTS AT MUST RESOLVE.
 *
 * A grant that names a record which does not exist fails SILENTLY: the feat looks wired, the test
 * suite is green, and the player gets nothing. That is the exact failure mode this whole audit keeps
 * finding, so it is worth an invariant rather than a spot-check — several passes this session leaned
 * on "does this spell id exist?" as their most important verification question.
 *
 * The database is clean today. This test is here so it stays that way through the next import.
 */
type Rec = {
  grantsFeats?: string[];
  grantedFeatId?: string | string[];
  focusSpells?: string[];
  innateSpells?: { spellId: string }[];
  usesUpgrade?: { featId: string };
  effectChoices?: { options?: { value?: string; grant?: { innateSpells?: { spellId: string }[]; focusSpells?: string[] } }[] }[];
};

type EC = { id?: string; prompt?: string; options?: { value?: string }[]; spellFilter?: unknown; openFrom?: unknown };

const COLLECTIONS = ['feats', 'classFeatures', 'items', 'heritages', 'backgrounds', 'ancestries'] as const;
const records = () =>
  COLLECTIONS.flatMap((col) =>
    Object.entries((c as unknown as Record<string, Record<string, Rec>>)[col] ?? {}).map(([id, rec]) => ({ where: `${col}/${id}`, rec })),
  );

describe('referential integrity', () => {
  it('every granted FEAT exists', () => {
    const bad: string[] = [];
    for (const { where, rec } of records()) {
      for (const f of rec.grantsFeats ?? []) if (!c.feats[f]) bad.push(`${where} -> ${f}`);
      for (const f of ([] as string[]).concat(rec.grantedFeatId ?? [])) if (f && !c.feats[f]) bad.push(`${where} -> ${f}`);
      if (rec.usesUpgrade && !c.feats[rec.usesUpgrade.featId]) bad.push(`${where} -> ${rec.usesUpgrade.featId}`);
    }
    expect(bad).toEqual([]);
  });

  it('every granted SPELL exists', () => {
    const bad: string[] = [];
    for (const { where, rec } of records()) {
      for (const s of rec.focusSpells ?? []) if (!c.spells[s]) bad.push(`${where} focus -> ${s}`);
      for (const s of rec.innateSpells ?? []) if (!c.spells[s.spellId]) bad.push(`${where} innate -> ${s.spellId}`);
      for (const e of rec.effectChoices ?? [])
        for (const o of e.options ?? []) {
          for (const s of o.grant?.innateSpells ?? []) if (!c.spells[s.spellId]) bad.push(`${where}/${o.value} -> ${s.spellId}`);
          for (const s of o.grant?.focusSpells ?? []) if (!c.spells[s]) bad.push(`${where}/${o.value} focus -> ${s}`);
        }
    }
    expect(bad).toEqual([]);
  });

  it('every class feature a class lists exists', () => {
    const bad: string[] = [];
    for (const [cid, cls] of Object.entries(c.classes)) {
      for (const f of cls.features ?? []) if (!c.classFeatures[f.featureId]) bad.push(`${cid} -> ${f.featureId}`);
    }
    expect(bad).toEqual([]);
  });

  it('every subclass and extra-choice option grants only real content', () => {
    const bad: string[] = [];
    for (const [cid, cls] of Object.entries(c.classes)) {
      const opts = [...(cls.subclass?.options ?? []), ...(cls.extraChoices ?? []).flatMap((g) => g.options)];
      for (const o of opts) {
        for (const f of o.grantedFeats ?? []) if (!c.feats[f]) bad.push(`${cid}/${o.id} -> ${f}`);
        for (const s of o.focusSpells ?? []) if (!c.spells[s]) bad.push(`${cid}/${o.id} focus -> ${s}`);
        for (const s of o.grantedSpells ?? []) if (!c.spells[s]) bad.push(`${cid}/${o.id} spell -> ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/**
 * `effectChoices` became a heavily-used lane this session (branch grants, spell filters, junction
 * menus). Its shape rules are all "obvious", which is exactly why they are worth asserting: a menu
 * with one option, a duplicate id, or neither an option list nor a filter renders as a broken or
 * empty picker rather than throwing.
 */
describe('effect choices are well-formed', () => {
  const all = COLLECTIONS.flatMap((col) =>
    Object.entries((c as unknown as Record<string, Record<string, { effectChoices?: EC[] }>>)[col] ?? {})
      .filter(([, r]) => r.effectChoices?.length)
      .map(([id, r]) => ({ where: `${col}/${id}`, ecs: r.effectChoices! })),
  );

  it('there are effect choices to check', () => expect(all.length).toBeGreaterThan(50));

  it('each carries a unique id and a prompt', () => {
    const bad: string[] = [];
    for (const { where, ecs } of all) {
      const seen = new Set<string>();
      for (const e of ecs) {
        if (!e.id || seen.has(e.id)) bad.push(`${where}: id '${e.id}'`);
        else seen.add(e.id);
        if (!e.prompt) bad.push(`${where}/${e.id}: no prompt`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('each has exactly one source of options — a list, a spell filter, or an open pool', () => {
    /* `openFrom` is the third source (Syncretism's second favored weapon: an open weapon list no
     * static `options` array could carry without printing 400 weapons into the record). Counted rather
     * than compared pairwise, so a fourth source cannot be added and quietly bypass this. */
    const bad: string[] = [];
    for (const { where, ecs } of all)
      for (const e of ecs) {
        const sources = [e.options, e.spellFilter, e.openFrom].filter(Boolean).length;
        if (sources > 1) bad.push(`${where}/${e.id}: ${sources} sources of options`);
        if (sources === 0) bad.push(`${where}/${e.id}: neither`);
      }
    expect(bad).toEqual([]);
  });

  it('an option list offers at least two distinct choices', () => {
    const bad: string[] = [];
    for (const { where, ecs } of all)
      for (const e of ecs) {
        if (!e.options) continue;
        if (e.options.length < 2) bad.push(`${where}/${e.id}: ${e.options.length} option(s)`);
        const vs = e.options.map((o) => o.value);
        if (new Set(vs).size !== vs.length) bad.push(`${where}/${e.id}: duplicate values`);
      }
    expect(bad).toEqual([]);
  });
});
