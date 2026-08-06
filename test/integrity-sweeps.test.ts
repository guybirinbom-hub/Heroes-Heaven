import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { build, content } from './_content';
import { emptyBuild, levelGrants, type BuildState } from '../src/rules/build';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';

/**
 * Standing sweeps for the BUG CLASSES this codebase has actually produced, rather than for specific
 * records. Each one caught a real defect the first time it ran.
 */
const db = content();

describe('a feat slot nothing can fill', () => {
  // Deliberately exhaustive — 27 classes × 20 levels, each filtered over every shipped feat. It needs
  // more than the 5s default when the whole suite is running in parallel.
  it('every slot the level table grants has at least one eligible feat', { timeout: 60_000 }, () => {
    // The fighter's Combat and Improved Flexibility slots demanded a feat of category 'bonus' while
    // every fighter feat ships as category 'class' — both offered ZERO options at every level.
    const empty: string[] = [];
    for (const clsId of Object.keys(db.classes)) {
      const subclassId = db.classes[clsId].subclass?.options?.[0]?.id ?? null;
      const b = {
        ...emptyBuild(),
        classId: clsId,
        level: 20,
        ancestryId: 'human',
        heritageId: Object.values(db.heritages).find((h) => h.ancestryId === 'human')?.id ?? null,
        backgroundId: Object.keys(db.backgrounds)[0],
        subclassId,
      } as BuildState;
      for (let lvl = 1; lvl <= 20; lvl++) {
        const cats = levelGrants(lvl, clsId, db, subclassId, undefined, null, null, false, ['ultimate-flexibility']).featSlots;
        // One check per DISTINCT (category, level) — a second slot of the same kind at the same level
        // filters identically, and re-running it over every shipped feat is pure cost.
        for (const category of new Set(cats)) {
          const idx = cats.indexOf(category);
          if (eligibleFeatsForSlot(b, db, { level: lvl, category, idx }).length === 0) empty.push(`${clsId} ${category}@${lvl}`);
        }
      }
    }
    expect(empty).toEqual([]);
  });
});

describe('a record that grants the same thing twice', () => {
  it('no record carries BOTH a granting `choice` and granting `effectChoices`', () => {
    // Advanced Domain did: answering both pickers handed a cleric the INITIAL domain spell as well
    // as the advanced one.
    const both: string[] = [];
    for (const cat of ['feats', 'classFeatures', 'heritages', 'backgrounds'] as const) {
      for (const [id, r] of Object.entries(db[cat])) {
        const rec = r as { choice?: { kind?: string; options?: { grant?: unknown }[] }; effectChoices?: { options?: { grant?: unknown }[] }[] };
        const choiceGrants = !!rec.choice && (rec.choice.kind === 'domains' || (rec.choice.options ?? []).some((o) => o.grant));
        const ecGrants = (rec.effectChoices ?? []).some((ec) => (ec.options ?? []).some((o) => o.grant));
        if (choiceGrants && ecGrants) both.push(`${cat}/${id}`);
      }
    }
    expect(both).toEqual([]);
  });
});

describe('a grant that points at nothing', () => {
  const has = (cat: string, id: string) => !!(db as never as Record<string, Record<string, unknown>>)[cat]?.[id];
  const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

  it('every granted spell, feat and class feature resolves', () => {
    const dead: string[] = [];
    for (const cat of ['feats', 'classFeatures', 'heritages', 'backgrounds', 'items', 'deities'] as const) {
      for (const [id, rec] of Object.entries(db[cat] ?? {})) {
        const r = rec as Record<string, never>;
        for (const add of asArray(r['spellListAdditions']))
          for (const s of (add as { spells?: string[] }).spells ?? []) if (!has('spells', s)) dead.push(`${cat}/${id} spell ${s}`);
        for (const f of asArray(r['grantsFeats'])) if (!has('feats', f)) dead.push(`${cat}/${id} feat ${f}`);
        for (const f of asArray(r['grantsClassFeatures'])) if (!has('classFeatures', f)) dead.push(`${cat}/${id} feature ${f}`);
        // A string OR an array — Eagle Hunter and Returned each grant a PAIR of feats.
        for (const f of asArray(r['grantedFeatId'])) if (!has('feats', f)) dead.push(`${cat}/${id} grantedFeatId ${f}`);
        for (const ch of asArray(r['effectChoices'])) {
          for (const o of (ch as { options?: { grant?: { focusSpells?: string[]; grantsFeats?: string[] } }[] }).options ?? []) {
            for (const s of o.grant?.focusSpells ?? []) if (!has('spells', s)) dead.push(`${cat}/${id} focusSpell ${s}`);
            for (const f of o.grant?.grantsFeats ?? []) if (!has('feats', f)) dead.push(`${cat}/${id} grant feat ${f}`);
          }
        }
      }
    }
    expect(dead).toEqual([]);
  });

  it('every mode names a real item and a real gate', () => {
    const dead: string[] = [];
    for (const [id, m] of Object.entries(db.modes ?? {})) {
      if (m.fromItemId && !has('items', m.fromItemId)) dead.push(`modes/${id} item ${m.fromItemId}`);
      for (const f of m.feats ?? []) if (!has('feats', f) && !has('classFeatures', f)) dead.push(`modes/${id} gate ${f}`);
    }
    expect(dead).toEqual([]);
  });

  it('every spellSlotBonus entryId names an entry the builder can produce', () => {
    // Without this, a bonus silently lands on the character's own class caster — or nowhere.
    const legal = new Set<string>(['animist-apparition-casting', 'innate-casting']);
    for (const c of Object.keys(db.classes)) legal.add(`${c}-casting`);
    for (const f of Object.keys(db.feats)) if (f.endsWith('-dedication')) legal.add(`${f}-casting`);
    const bad: string[] = [];
    for (const cat of ['feats', 'classFeatures', 'items'] as const) {
      for (const [id, rec] of Object.entries(db[cat] ?? {})) {
        const e = (rec as { spellSlotBonus?: { entryId?: string } }).spellSlotBonus?.entryId;
        if (e && !legal.has(e)) bad.push(`${cat}/${id} → ${e}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('a data field nothing reads', () => {
  it('every field the overlay writes has a reader in src', () => {
    // "Authored but dead" is this codebase's most common way for a fix to be wrong: the record looks
    // fixed, the audit records it fixed, and the engine never looks.
    let src = '';
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f.name)) src += readFileSync(p, 'utf8');
      }
    };
    walk('src');
    // Comments stripped: a field only NAMED in prose is not a reader.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const bf = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as { field?: string }[];
    const dead = [...new Set(bf.map((e) => e.field).filter(Boolean) as string[])].filter((f) => {
      const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`\\.\\s*${esc}\\b|\\b${esc}\\s*[,}:?)\\]]|['"\`]${esc}['"\`]`).test(code);
    });
    expect(dead).toEqual([]);
  });
});

describe('a cantrip grant that quietly grants slots', () => {
  it('a cantrips-only spellSlotBonus adds no spell slots', () => {
    // `perRank ?? 1` defaulted a bonus with no rank information to ONE SLOT AT EVERY RANK, so Cantrip
    // Expansion — among the most-taken feats in the game — and Cantrip Casting each handed their
    // owner a whole extra slot per rank on top of the cantrips they print.
    const cantripsOnly: string[] = [];
    for (const cat of ['feats', 'classFeatures', 'items', 'heritages'] as const) {
      for (const [id, rec] of Object.entries(db[cat] ?? {})) {
        const b = (rec as { spellSlotBonus?: Record<string, unknown> }).spellSlotBonus;
        if (b?.cantrips && !b.byRank && !b.byRankAt && b.perRank === undefined && !b.highestOnly && !b.restricted) cantripsOnly.push(id);
      }
    }
    expect(cantripsOnly.length, 'no cantrips-only record to test with').toBeGreaterThan(0);
    const slotsOf = (c: ReturnType<typeof build>) =>
      JSON.stringify(c.spellcasting.find((e) => e.type === 'prepared' || e.type === 'spontaneous')?.slots);
    const base = build('wizard', 12);
    for (const id of cantripsOnly) {
      // Level 12 so a class feat slot at 12 exists for any of them.
      const withIt = build('wizard', 12, { featPicks: { '12:class:0': id } } as never);
      expect(slotsOf(withIt), id).toEqual(slotsOf(base));
    }
  });
});

describe('a warning that outlived the thing it warns about', () => {
  it('no record warns about a mechanic it now carries', () => {
    // `dataWarning` renders as a "Missing data — N effects reference content not in the current data"
    // banner. Five of seventeen were describing mechanics the engine had since gained, so a psychic,
    // an alchemist, a Cathartic Mage, a Second-Chance Champion and a captivator were each being told
    // something was broken that works. Two of those five came back from a harvest of an older
    // core.json, which cannot tell a field that was LOST from one that was deliberately removed.
    //
    // The rule: carrying a warning AND a structured mechanical field is a contradiction unless the
    // warning is about a DIFFERENT clause of the same record, in which case it is listed here with
    // its reason.
    const MECHANICAL = ['spellSlotBonus', 'skillSubstitutions', 'focusSpells', 'focusPoolBonus', 'innateSpells', 'grantsClassFeatures', 'grantedFeatId', 'trainedSkill'];
    const PARTIAL: Record<string, string> = {
      'items/talisman-cord': 'the effectChoices pick the cord’s TALISMAN; the warning is about its magic-school attunement, which the Remaster deleted',
      'items/talisman-cord-lesser': 'same as talisman-cord',
      'items/talisman-cord-greater': 'same as talisman-cord',
      'backgrounds/verduran-city-folk': 'the grants are present; the warning is about the second skill FEAT, whose name is missing from the source data',
    };
    const bad: string[] = [];
    for (const cat of ['feats', 'classFeatures', 'heritages', 'backgrounds', 'items', 'ancestries'] as const) {
      for (const [id, rec] of Object.entries(db[cat] ?? {})) {
        const r = rec as Record<string, unknown>;
        if (!r.dataWarning) continue;
        const has = MECHANICAL.filter((f) => r[f] !== undefined);
        if (has.length && !PARTIAL[`${cat}/${id}`]) bad.push(`${cat}/${id} warns but carries ${has.join(', ')}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('content that a data regen would silently delete', () => {
  it('every mode in core.json exists in a source file', () => {
    // `npm run data` carries hand-authored buckets from the FROZEN Foundry backup, which has no modes
    // at all. Anything living only in core.json is deleted by the next regen and nothing says so: all
    // 428 modes vanished exactly that way, and fourteen of them had no source file to come back from.
    const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as { modes?: Record<string, unknown> };
    const consumable = JSON.parse(readFileSync('scripts/data/consumable-modes.json', 'utf8')) as { id: string }[];
    const toggle = JSON.parse(readFileSync('scripts/data/toggle-modes.json', 'utf8')) as Record<string, unknown>;
    const sourced = new Set([...consumable.map((m) => m.id), ...Object.keys(toggle)]);
    expect(Object.keys(core.modes ?? {}).filter((id) => !sourced.has(id))).toEqual([]);
  });

  it('…and the shipped bucket is not empty', () => {
    // The failure mode above is silent, so assert the floor too: a regen that wipes the bucket leaves
    // every toggle, consumable and IWR-granting mode gone with no other symptom.
    expect(Object.keys(db.modes ?? {}).length).toBeGreaterThan(400);
  });
});

describe('the character still builds', () => {
  it('every class builds at level 20 without throwing', () => {
    for (const clsId of Object.keys(db.classes)) {
      expect(() => build(clsId, 20), clsId).not.toThrow();
    }
  });
});
