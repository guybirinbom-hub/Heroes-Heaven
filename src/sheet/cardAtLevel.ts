import type { Character, ContentDatabase } from '../rules/types';
import { deriveDefenses, deriveStrikes, ownedFeatureIds, weaponSpecialization, type CharacterDefenses, type Strike } from '../rules/derive';
import { atLevelFamilyOf, atLevelLead, levelDefenseKeys, type AtLevelFamily } from './cardScope';
import type { OursLine } from './cardModel';

/**
 * Card step 18 — the "At your level" ours line (docs/card-design.md section 3 row "Sentence that scales
 * inside itself", section 4 kind `atYourLevel`, section 9 row 18).
 *
 * Where a record's page prints a value that scales with level inside its prose, the card keeps the
 * printed words whole and adds ONE line, marked ours, with the value the ENGINE computes for this
 * character at its level. This file never computes that value: it READS src/rules/derive.ts's existing
 * Strike output (deriveStrikes → `conditionalDamage` riders and `specDamage`) and Defenses output
 * (deriveDefenses → `sources`, the per-record attribution of each resistance / weakness) and prints what
 * it finds.
 * Mechanics are out of scope (section 13): a record not in cardScope.ts AT_LEVEL, a character without the
 * feature, or a derive output that carries no value for it gives NO line — never a guessed number.
 *
 * Two families derive pays only in a state the player switches on at the table (Rage, Hunt Prey): their
 * riders appear on the Strikes only while that state is on. The line reads derive's answer FOR that state
 * (the character with the resource on), so the card says what the engine adds when you rage or hunt —
 * the number is still derive's, the condition is said on the line.
 */

/** derive.ts strikePrecisionRiders' Sneak Attack note — the rider this file reads by. */
const SNEAK_NOTE = 'sneak attack when target is off-guard';
/** derive.ts strikePrecisionRiders' Precision note. */
const PREY_NOTE = '* first hit vs hunted prey';
/** derive.ts rageStrikeRider's notes all open with this ('* while raging (melee & unarmed)', '* while
 *  raging (thrown)', '* while raging with a larger weapon (Clumsy 1)'). */
const RAGE_NOTE = /^\* while raging/;

/** The class resource derive reads before it pays a family's rider (derive.ts rageStrikeRider:
 *  `classResources.rage`; strikePrecisionRiders: `classResources['hunt-prey']`). */
const STATE_OF: Partial<Record<AtLevelFamily, string>> = { rage: 'rage', precision: 'hunt-prey' };

/** deriveStrikes, once per (content, character, state): a character object is replaced, never mutated,
 *  when the player changes it, so the cache follows the character the surface was handed. */
const cache = new WeakMap<ContentDatabase, WeakMap<Character, Map<string, Strike[]>>>();
function strikesOf(c: Character, db: ContentDatabase, state: string | undefined): Strike[] {
  let byChar = cache.get(db);
  if (!byChar) cache.set(db, (byChar = new WeakMap()));
  let byState = byChar.get(c);
  if (!byState) byChar.set(c, (byState = new Map()));
  const key = state ?? '';
  let out = byState.get(key);
  if (!out) {
    const ch = state ? ({ ...c, classResources: { ...(c.classResources ?? {}), [state]: 1 } } as Character) : c;
    out = deriveStrikes(ch, db);
    byState.set(key, out);
  }
  return out;
}

/** Whether the character holds the record the line would sit on. Rage: the instinct derive scales Rage by
 *  (derive.ts rageStrikeRider reads `subclassId` for a barbarian only — an archetype barbarian rages for a
 *  flat 2, which the instinct's printed scaling does not describe). */
function holds(c: Character, db: ContentDatabase, bucket: string, id: string, family: AtLevelFamily): boolean {
  if (family === 'rage') return c.classId === 'barbarian' && c.subclassId === id;
  if (bucket === 'feats') return (c.feats ?? []).some((f) => f.featId === id);
  if (bucket === 'classFeatures') return ownedFeatureIds(c, db).has(id);
  // Both heritages: derive.ts heritageRecords reads the second one (Late Awakener) as well.
  if (bucket === 'heritages') return c.heritageId === id || c.secondHeritageId === id;
  return false;
}

/** deriveDefenses, once per (content, character) — the same replace-never-mutate assumption as strikesOf. */
const defCache = new WeakMap<ContentDatabase, WeakMap<Character, CharacterDefenses>>();
function defensesOf(c: Character, db: ContentDatabase): CharacterDefenses {
  let byChar = defCache.get(db);
  if (!byChar) defCache.set(db, (byChar = new WeakMap()));
  let out = byChar.get(c);
  if (!out) byChar.set(c, (out = deriveDefenses(c, db)));
  return out;
}

/** The label deriveDefenses attributes a record's resistances to (its `push(name, record)` calls: a feat
 *  or class feature by `name ?? id`, a heritage by `name ?? 'Heritage'`). */
function deriveLabelOf(bucket: string, id: string, rec: { name?: string }): string {
  return rec.name ?? (bucket === 'heritages' ? 'Heritage' : id);
}

/** A type key as words: derive's slug types ("critical-hits", "cold-iron") read as the page says them. */
const typeWords = (t: string) => t.replace(/-/g, ' ');

/**
 * levelDefense: for each of the record's own level-sized resistance / weakness types (cardScope.ts
 * levelDefenseKeys), the ONE entry derive attributed to this record by its label. Not exactly one — derive
 * withheld it (a gate failed: armour off, a level not reached, a value of 0) or two records share the label —
 * and that type says nothing; nothing at all left means no line. Never a guessed number.
 */
function defenseValue(c: Character, db: ContentDatabase, bucket: string, id: string): string | null {
  const rec = (db as unknown as Record<string, Record<string, { name?: string }> | undefined>)[bucket]?.[id];
  if (!rec) return null;
  const label = deriveLabelOf(bucket, id, rec);
  const sources = defensesOf(c, db).sources ?? {};
  const items: { key: string; v: { kind: string; n: number; cond?: string; applied: boolean; type: string } }[] = [];
  for (const key of levelDefenseKeys(rec)) {
    const mine = (sources[key] ?? []).filter((s) => s.from === label && typeof s.value === 'number');
    if (mine.length !== 1) continue;
    const s = mine[0];
    const i = key.indexOf(':');
    const v = { kind: key.slice(0, i), type: key.slice(i + 1), n: s.value!, cond: s.condition, applied: s.applied };
    items.push({ key: `${v.kind}|${v.n}|${v.cond ?? ''}|${v.applied}`, v });
  }
  if (!items.length) return null;
  const groups = new Map<string, { v: (typeof items)[number]['v']; types: string[] }>();
  for (const it of items) {
    const g = groups.get(it.key);
    if (g) g.types.push(it.v.type);
    else groups.set(it.key, { v: it.v, types: [it.v.type] });
  }
  return [...groups.values()]
    .map(({ v, types }) => {
      // "custom" is derive's key for a type the record names only in its prose (Scholarly Defense): the page
      // says what it is, so the line gives the number alone rather than the word "custom".
      const named = types.filter((t) => t !== 'custom').map(typeWords);
      const head = `${v.kind} ${v.n}${named.length ? ` to ${named.join(', ')}` : ''}`;
      const cond = v.cond ? ` (${v.cond})` : '';
      // derive keeps a same-type source that lost (no stacking) with applied: false — say so, its words.
      const lost = v.applied ? '' : `; a higher ${v.kind} to the same type applies`;
      return `${head}${cond}${lost}`;
    })
    .join('; ');
}

/** The words of one rider note as the line says them: derive's leading "* " (its "only when" flag) dropped. */
const noteWords = (note: string) => note.replace(/^\*\s*/, '').trim();

/** The distinct names of a set of Strikes, in derive's order. */
const namesOf = (ss: Strike[]) => [...new Set(ss.map((s) => s.name))].join(', ');

/** Strikes grouped by a key, in the order derive lists them. */
function groupBy<T>(items: { key: string; strike: Strike; v: T }[]): { v: T; strikes: Strike[] }[] {
  const out = new Map<string, { v: T; strikes: Strike[] }>();
  for (const it of items) {
    const g = out.get(it.key);
    if (g) g.strikes.push(it.strike);
    else out.set(it.key, { v: it.v, strikes: [it.strike] });
  }
  return [...out.values()];
}

/** What the weaponSpec line adds when the character holds Greater Weapon Specialization too (orchestrator
 *  ruling, step 18 nit 3): derive folds BOTH features into one specDamage total, so the Weapon
 *  Specialization row and the Greater row show the same combined number — and say so, never a bare number
 *  neither record's own text explains. Ownership is derive's own reading (derive.ts weaponSpecialization). */
const SPEC_TOGETHER = ', Weapon Specialization and Greater together';

/** What derive computed for the family, as the line's words after the lead; null when it computed nothing.
 *  `greater`: derive's weaponSpecialization(c, db).greater, read only for the weaponSpec family. */
function valueOf(family: AtLevelFamily, strikes: Strike[], greater = false): string | null {
  const live = strikes.filter((s) => !s.fromBattleForm);
  if (family === 'sneakAttack' || family === 'precision') {
    const note = family === 'sneakAttack' ? SNEAK_NOTE : PREY_NOTE;
    const r = live.flatMap((s) => s.conditionalDamage ?? []).find((x) => x.note === note);
    if (!r) return null;
    return family === 'precision' ? `${r.text}, ${noteWords(r.note)}` : r.text;
  }
  if (family === 'rage') {
    const items = live.flatMap((s) => (s.conditionalDamage ?? []).filter((x) => RAGE_NOTE.test(x.note)).map((r) => ({ key: `${r.text}|${r.note}`, strike: s, v: r })));
    if (!items.length) return null;
    return groupBy(items).map((g) => `${namesOf(g.strikes)}: ${g.v.text}, ${noteWords(g.v.note)}`).join('; ');
  }
  // weaponSpec: the flat damage derive folded into each Strike, grouped by amount and the rank it pays for.
  const items = live.filter((s) => (s.specDamage ?? 0) > 0).map((s) => ({ key: `${s.specDamage}|${s.rank}`, strike: s, v: { n: s.specDamage!, rank: s.rank } }));
  if (!items.length) return null;
  const amounts = groupBy(items)
    .sort((a, b) => a.v.n - b.v.n)
    .map((g) => `${g.v.n} extra damage with ${namesOf(g.strikes)} (${g.v.rank})`)
    .join('; ');
  return greater ? `${amounts}${SPEC_TOGETHER}` : amounts;
}

/**
 * The at-level ours line for one record on this character's card: none, or exactly one `atYourLevel`
 * line ("At your level (7): 2d6 precision"). Total — never throws — so every row builder can call it.
 */
export function atLevelLines(c: Character | null | undefined, db: ContentDatabase | null | undefined, bucket: string, id: string | undefined): OursLine[] {
  if (!c || !db || !id) return [];
  const family = atLevelFamilyOf(bucket, id);
  if (!family || !holds(c, db, bucket, id, family)) return [];
  let value: string | null;
  try {
    value =
      family === 'levelDefense'
        ? defenseValue(c, db, bucket, id)
        : valueOf(family, strikesOf(c, db, STATE_OF[family]), family === 'weaponSpec' && weaponSpecialization(c, db).greater);
  } catch {
    return [];
  }
  return value ? [{ kind: 'atYourLevel', text: `${atLevelLead(c.level)} ${value}` }] : [];
}
