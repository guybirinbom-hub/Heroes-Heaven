/*
 * THE DERIVED-SHEET SNAPSHOT — one implementation, shared.
 *
 * `scripts/feat-evidence.mjs` carried this inline; the WG experience harness
 * (test/wg-experience.harness.test.tsx) needs the identical snapshot for ANY record type, and two
 * copies of a measuring instrument drift — builder-evidence's hand mirror of Builder.tsx is the
 * standing example. So the snapshot, the flattener and the diff live here and both callers import them.
 *
 * ⚠ The sheet is NOT `buildCharacter`'s return value. That is the STORED character — feats,
 * proficiencies, hit points, languages. Senses, AC, resistances, speeds, strikes and every situational
 * note are computed from it by derive.ts and appear nowhere on it. Diffing the stored object reported
 * an empty diff for 18 of the first 20 feats, including one carrying a live `senses` field, which is
 * the harness lying rather than the app failing. Snapshot the DERIVED values.
 *
 * Imports TypeScript from src/rules — run callers with `npx jiti` (scripts) or under vitest (tests).
 */
import {
  deriveSave, derivePerception, deriveSkill, deriveClassDc, deriveMaxHp,
  deriveAc, deriveDefenses, deriveStrikes, deriveSpeeds, deriveShield, deriveBulk, ownedFeatureIds,
} from '../../src/rules/derive';
import { featSituationalFor } from '../../src/rules/situationalBonuses';
import { characterSituationalIds, sheetLoreKeys } from '../../src/rules/explain';
import { SKILLS } from '../../src/rules/types';

/* Inlined from src/sheet/widgets.tsx:63 — jiti cannot parse the TSX module from a script. This is the
 * exact gate MainTab uses to decide whether a record reaches the encounter action list. */
export const isActionCost = (c) => !!c && (c.type === 'actions' || c.type === 'reaction' || c.type === 'free' || c.type === 'variable');

/** Every derived value the sheet prints, plus the record-driven lists it renders (actions, uses, spells, stars). */
export const snapshot = (c, db) => {
  const s = { stored: c };
  const t = (fn, key, ...args) => { try { s[key] = fn(c, ...args); } catch (e) { s[key] = `ERR:${e.message}`; } };
  t(deriveMaxHp, 'maxHp', db);
  t(deriveAc, 'ac', db);
  t(deriveDefenses, 'defenses', db);
  t(deriveSpeeds, 'speeds', db);
  t(deriveStrikes, 'strikes', db);
  t(deriveShield, 'shield', db);
  t(derivePerception, 'perception', db);
  t(deriveClassDc, 'classDc');
  // Encumbrance thresholds — an armour rune or a feat can move them (WG: BULK_LIMIT_BONUS).
  t(deriveBulk, 'bulk', db);
  s.saves = {};
  for (const sv of ['fortitude', 'reflex', 'will']) { try { s.saves[sv] = deriveSave(c, sv, db); } catch (e) { s.saves[sv] = String(e.message); } }
  s.skills = {};
  for (const k of SKILLS) { try { s.skills[k] = deriveSkill(c, k, db); } catch (e) { s.skills[k] = String(e.message); } }
  /* The lists the SHEET renders from owned records — none of them appear in any derived number, so a
   * feat that only grants an action or a per-day resource shows an empty diff without these.
   * Mirrors MainTab.tsx:212-240 rather than re-deriving it, so the harness observes the real surface. */
  const featureIds = (() => { try { return [...ownedFeatureIds(c, db)]; } catch { return []; } })();
  s.ownedFeatures = featureIds;
  const records = [
    ...(c.feats ?? []).map((f) => db.feats[f.featId]),
    ...featureIds.map((id) => db.classFeatures[id]),
    c.heritageId ? db.heritages[c.heritageId] : undefined,
    c.backgroundId ? db.backgrounds[c.backgroundId] : undefined,
    // Worn / equipped / invested items reach the action list and the spells page too (MainTab.tsx:266-279).
    ...(c.inventory ?? []).filter((i) => i.worn || i.equipped || i.invested).map((i) => db.items?.[i.itemId]),
  ].filter(Boolean);
  s.actions = [
    ...records.filter((r) => isActionCost(r.actionCost)).map((r) => r.name),
    ...records.flatMap((r) => (r.grantsActions ?? []).map((id) => db.actions?.[id]?.name).filter(Boolean)),
  ].sort();
  s.limitedUses = records.filter((r) => r.limitedUses).map((r) => `${r.name}: ${JSON.stringify(r.limitedUses)}`).sort();
  s.grantedSpells = records.flatMap((r) => [
    ...(r.innateSpells ?? []).map((x) => `innate:${x.spellId ?? x}`),
    ...(r.focusSpells ?? []).map((x) => `focus:${x.spellId ?? x}`),
    ...(r.grantsRituals ?? []).map((x) => `ritual:${x.spellId ?? x}`),
  ]).sort();

  // Situational star-notes are a lane in their own right and invisible in every numeric total.
  // ⚠ EVERY source the sheet reads — feats, ancestry, heritage, background, class features, worn
  // items, runes — not feats alone: an item's star (loaded dice, a staff) was invisible here and every
  // item situational in the corpus read as "changes nothing". Lore rows are included beside SKILLS.
  let ids;
  try { ids = characterSituationalIds(c, db); } catch { ids = (c.feats ?? []).map((f) => f.featId); }
  // The sheet's lore rows: trained Lores plus an untrained row a star needs (sheetLoreKeys), same as MainTab.
  let loreKeys;
  try { loreKeys = sheetLoreKeys(c, db); } catch { loreKeys = Object.keys(c.proficiencies?.skills ?? {}).filter((k) => k.startsWith('lore:')); }
  s.situational = {};
  for (const ref of [{ kind: 'ac' }, { kind: 'perception' }, ...['fortitude', 'reflex', 'will'].map((save) => ({ kind: 'save', save })),
    ...[...SKILLS, ...loreKeys].map((skill) => ({ kind: 'skill', skill }))]) {
    try {
      const lines = featSituationalFor(ids, ref);
      if (lines.length) s.situational[ref.skill ?? ref.save ?? ref.kind] = lines;
    } catch { /* a ref shape this build doesn't support is not evidence of anything */ }
  }
  return s;
};

export const NOISE = new Set(['build', 'content', 'db', 'description', 'descRefs']);

/** Flatten to path -> primitive. Arrays of records are keyed by their own id, not by index (which shifts). */
export const flat = (v, path = '', out = {}) => {
  if (v === null || v === undefined) return out;
  if (Array.isArray(v)) {
    const keyed = v.every((x) => x && typeof x === 'object' && (x.featId || x.id || x.spellId));
    v.forEach((x, i) => flat(x, `${path}[${keyed ? (x.featId ?? x.id ?? x.spellId) : i}]`, out));
    return out;
  }
  if (typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) if (!NOISE.has(k)) flat(val, path ? `${path}.${k}` : k, out);
    return out;
  }
  out[path] = v;
  return out;
};

/** A generic path-by-path diff of two snapshots. Deliberately NOT a curated field list. */
export const diff = (a, b) => {
  const A = flat(a), B = flat(b);
  const changes = [];
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (A[k] === B[k]) continue;
    changes.push({ path: k, before: A[k] ?? null, after: B[k] ?? null });
  }
  return changes;
};
