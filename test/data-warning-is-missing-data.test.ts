import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedContent } from '../src/rules/seed';
import { build, content } from './_content';

/**
 * THE RED "MISSING DATA" BOX IS FOR MISSING DATA.
 *
 * `dataWarning` feeds the Feats tab's red box — "Missing data — N effects reference content not in the
 * current data" (FeatsTab.tsx, collected by build.ts into Character.effectWarnings). types.ts defines it
 * as a warning that a record "references content missing from the shipped data". `note` is the other
 * thing: "this record works; here is the part you apply yourself" (types.ts ContentBase.note).
 *
 * On 2026-10-14 the box held 20 warnings and ONE was missing data (Bright Fetchling's dancing lights).
 * Sixteen were table notes — "Not tracked: … apply it at the table", "your GM adjudicates the ask",
 * "Applied at the table: the app does not model flat checks" — filed as warnings because a background's
 * and an item's note had no reader (test/note-readers.test.tsx now proves they do). Three were stale:
 * the app had since gained what they said was missing (Beast Gunner's spellcasting, Executioner Weapon
 * Training's per-weapon proficiency, the Vampire Vulnerabilities sidebar). And Bright Fetchling's real
 * warning named another app in player-facing text.
 *
 * A stale warning going away must not take an UNDELIVERED clause with it (the checker's catch, fix
 * round 1): a wizard or druid with Beast Gunner Dedication still gets no extra class cantrip, and no
 * code applies the vampire's Revulsion or Sunlight. Those clauses are notes now, and the last describe
 * block ties each note to what the engine measurably does, both ways.
 *
 * Three rules, over public/core.json (and the seed it merges with) walked at ANY depth (a warning inside an
 * effectChoices option counts) AND over the overlay's dataWarning rows (scripts/data/effect-backfill.json, the only source that
 * survives `npm run data`), so a script that writes the old text back is caught either way:
 *  R1  a dataWarning may not use table-note wording (TABLE_NOTE below). Such a sentence is a `note`.
 *  R3  the records carrying a dataWarning are EXACTLY the keys of MISSING, an explicit map
 *      {record → the content id it says is missing}; every named id must be ABSENT from the data (core
 *      and seed), and the warning must name it. When the content ships, the entry fails and the warning
 *      must go — a warning expires instead of outliving what it warns about.
 *  R4  no dataWarning or note names Wanderer's Guide (the app never names it in player-facing text).
 *
 * PROOF (2026-10-14, lane B): pointed at the pre-fix core.json (CORE_PATH temporarily set to a scratch
 * copy of the shipped file before the move), this file went red on R1 (15 records), R3 (19 extra records)
 * and R4 (bright-fetchling); pointed back, green. The planted cases below are each rejected. Fix round 1:
 * pointed at the core.json holding the attack-roll-only Beast Gunner note and the Negative-Survival-only
 * vampire note, the last describe block went red on 4 tests (wizard cap 6 → 6, druid 5 → 5, vampire);
 * pointed back, green.
 */
const CORE_PATH = 'public/core.json';
const OVERLAY_PATH = 'scripts/data/effect-backfill.json';

/** R1: the wording of a table note — a clause the app leaves to the player or the GM, not content it lacks.
 *  "apply it manually" is deliberately NOT here: that is the true template for content the data lacks. */
export const TABLE_NOTE =
  /\b(?:not tracked|does(?: not|n['’]t)(?: yet)? (?:track|model|feed|enforce)|at the table|has no [\w-]+ model|cannot (?:enforce|run|express|track|model)|(?:your |the )?GM (?:adjudicates|applies|plays|decides|rules on)|campaign tracker|apply (?:it|them|this|that|the [\w-]+) (?:yourself|at the table|by hand)|(?:count|track) (?:them|it) by hand)\b/i;

/** R3: record → the content it says is missing (`bucket/id`). Each id must be ABSENT from the data. */
export const MISSING: Record<string, string> = {
  // heritage-120 prints "cast dancing lights and light as occult innate cantrips"; the remaster folded
  // dancing lights into light and spells['dancing-lights'] is not shipped, so only Light is granted.
  'heritages/bright-fetchling': 'spells/dancing-lights',
};

type Db = Record<string, Record<string, unknown> | unknown>;
type Row = { category?: string; id?: string; field?: string; value?: unknown; path?: unknown[] };
export interface Found { record: string; where: string; text: string }

/** Every `field` string in a core-shaped object, at any depth, attributed to its top-level record. */
export function fieldStrings(core: Db, field: string): Found[] {
  const out: Found[] = [];
  const walk = (v: unknown, record: string, where: string) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, record, `${where}[${i}]`)); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === field && typeof x === 'string') out.push({ record, where: `${where}.${k}`, text: x });
      walk(x, record, `${where}.${k}`);
    }
  };
  for (const [bucket, records] of Object.entries(core)) {
    if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
    for (const [id, rec] of Object.entries(records as Record<string, unknown>)) walk(rec, `${bucket}/${id}`, `${bucket}/${id}`);
  }
  return out;
}

/** The overlay's dataWarning rows that WRITE a warning (a `value: null` row removes one). */
export function overlayWarnings(rows: Row[]): Found[] {
  return rows
    .filter((r) => r.field === 'dataWarning' && typeof r.value === 'string')
    .map((r) => ({ record: `${r.category}/${r.id}`, where: `overlay ${r.category}/${r.id}${r.path?.length ? ` path ${JSON.stringify(r.path)}` : ''}`, text: r.value as string }));
}

/** R1 — every warning whose words are a table note's. */
export const r1 = (found: Found[]): string[] =>
  found.filter((f) => TABLE_NOTE.test(f.text)).map((f) => `${f.where}: "${f.text.match(TABLE_NOTE)![0]}" is table-note wording — this is a \`note\`, not a dataWarning`);

/** R3 — the warned set must equal the map, each named id absent from core AND seed, and named by the warning. */
export function r3(found: Found[], map: Record<string, string>, data: Db[]): string[] {
  const bad: string[] = [];
  const warned = new Set(found.map((f) => f.record));
  for (const r of warned) if (!(r in map)) bad.push(`${r} carries a dataWarning but names no missing content in MISSING — a table note belongs in \`note\`; a stale warning goes (value:null)`);
  for (const [r, target] of Object.entries(map)) {
    if (!warned.has(r)) bad.push(`MISSING lists ${r}, which carries no dataWarning — drop the entry`);
    const [b, id] = target.split('/');
    if (data.some((d) => (d[b] as Record<string, unknown> | undefined)?.[id] !== undefined)) bad.push(`${r} warns that ${target} is missing, but it ships now — the warning is stale: remove it (value:null) and the entry`);
    const words = id.replace(/-/g, ' ');
    for (const f of found.filter((x) => x.record === r)) if (!f.text.toLowerCase().includes(words)) bad.push(`${f.where} does not name the missing ${target} ("${words}")`);
  }
  return bad;
}

/** R4 — another app's name in player-facing text. */
export const r4 = (found: Found[]): string[] => found.filter((f) => /wanderer/i.test(f.text)).map((f) => `${f.where} names Wanderer's Guide in player-facing text`);

const core = JSON.parse(readFileSync(CORE_PATH, 'utf8')) as Db;
const overlay = JSON.parse(readFileSync(OVERLAY_PATH, 'utf8')) as Row[];
const seed = seedContent as unknown as Db;
// The seed (src/rules/seed.ts) merges under core.json at runtime, so a warning authored there reaches the
// box too: it is walked with core.json.
const coreWarnings = [...fieldStrings(core, 'dataWarning'), ...fieldStrings(seed, 'dataWarning')];
const rowWarnings = overlayWarnings(overlay);

describe('the red "Missing data" box holds only missing data', () => {
  it('the walk reaches the shipped warnings (not vacuous)', () => {
    expect(coreWarnings.length, 'at least the one real warning ships').toBeGreaterThan(0);
    expect(rowWarnings.length, 'the overlay writes it').toBeGreaterThan(0);
  });

  it('R1: no dataWarning uses table-note wording (core.json at any depth, and the overlay)', () => {
    expect(r1(coreWarnings)).toEqual([]);
    expect(r1(rowWarnings)).toEqual([]);
  });

  it('R3: the warned records are exactly MISSING, and every named content id is absent from the data', () => {
    expect(r3(coreWarnings, MISSING, [core, seed])).toEqual([]);
    expect(r3(rowWarnings, MISSING, [core, seed])).toEqual([]);
  });

  it('R4: no dataWarning or note names Wanderer\'s Guide', () => {
    expect(r4([...coreWarnings, ...fieldStrings(core, 'note'), ...fieldStrings(seed, 'note')])).toEqual([]);
    expect(r4(overlayWarnings(overlay).concat(overlay.filter((r) => r.field === 'note' && typeof r.value === 'string').map((r) => ({ record: `${r.category}/${r.id}`, where: `overlay ${r.category}/${r.id}.note`, text: r.value as string }))))).toEqual([]);
  });

  it('the moved table notes now ship as `note` (the box lost them; the record kept the words)', () => {
    const recs = core as Record<string, Record<string, { note?: string; dataWarning?: string }>>;
    // background-239 prints the DC 3 flat check; the words survive on the note the Background card draws.
    expect(recs.backgrounds['anti-magical'].note).toContain('DC 3 flat check');
    expect(recs.backgrounds['anti-magical'].dataWarning).toBeUndefined();
    for (const k of ['feats/miraculous-flight', 'feats/terrifying-mien', 'feats/exorcist-dedication', 'feats/enticing-dwelling', 'feats/dragonblood-paragon',
      'items/talisman-cord', 'items/talisman-cord-lesser', 'items/talisman-cord-greater', 'backgrounds/sally-guard-neophyte', 'backgrounds/energy-scarred',
      'backgrounds/tech-reliant', 'backgrounds/otherworldly-mission', 'backgrounds/royalty', 'backgrounds/cathedral-child', 'backgrounds/child-of-the-twin-village']) {
      const [b, id] = k.split('/');
      expect(typeof recs[b][id]?.note, `${k} note`).toBe('string');
    }
  });
});

describe('the rules reject what they exist to reject (planted cases)', () => {
  const found = (text: string, record = 'feats/planted'): Found[] => [{ record, where: record, text }];

  it.each([
    'Not tracked: roll it at the table.',
    'Your GM adjudicates the ask.',
    'Applied at the table: the app does not model flat checks.',
    'The engine cannot enforce this — apply it at the table.',
    'a campaign tracker your GM applies, not a sheet number.',
    'Each purification spends one. Count them by hand.',
    'The app does not track connections.',
    'The app has no shoddy model — apply the penalty by hand.',
    'The app does not yet feed this into the pervasive-magic feat ladder; apply the tradition yourself.',
    "The app doesn't track it; your GM plays the twin.",
  ])('R1 rejects the table note %j', (text) => {
    expect(r1(found(text))).toHaveLength(1);
  });

  it.each([
    'This grants “Foo Bar”, which isn\'t in the current data — apply it manually.',
    'Print grants two occult innate cantrips, dancing lights and light. The remaster folded dancing lights into light and it is not in this app\'s spell data, so only Light is granted here.',
  ])('R1 accepts the missing-data sentence %j', (text) => {
    expect(r1(found(text))).toEqual([]);
  });

  it('R3 rejects a warning on a record the map does not list — even worded as missing data (the dragonblood template)', () => {
    const text = 'Part of this effect references content missing from the current data — apply it manually.';
    expect(r1(found(text))).toEqual([]); // R1 cannot see it…
    expect(r3(found(text, 'feats/dragonblood-paragon'), MISSING, [{}])).toContainEqual(expect.stringContaining('feats/dragonblood-paragon carries a dataWarning'));
  });

  it('R3 rejects a map entry whose content ships (a stale warning expires)', () => {
    const shipped: Db = { spells: { 'dancing-lights': { id: 'dancing-lights' } } };
    const warn = found('dancing lights is not in this app\'s spell data', 'heritages/bright-fetchling');
    expect(r3(warn, MISSING, [shipped]).some((m) => /ships now/.test(m))).toBe(true);
  });

  it('R3 rejects a map entry with no warning, and a warning that does not name its missing content', () => {
    expect(r3([], MISSING, [{}])).toEqual([expect.stringContaining('carries no dataWarning')]);
    expect(r3(found('Something else entirely is missing.', 'heritages/bright-fetchling'), MISSING, [{}])).toEqual([expect.stringContaining('does not name')]);
  });

  it('the walk finds a warning nested inside an option, attributed to its record', () => {
    const nested: Db = { feats: { 'x-feat': { id: 'x-feat', effectChoices: [{ options: [{ value: 'a', dataWarning: 'Not tracked: planted.' }] }] } } };
    const f = fieldStrings(nested, 'dataWarning');
    expect(f).toEqual([{ record: 'feats/x-feat', where: 'feats/x-feat.effectChoices[0].options[0].dataWarning', text: 'Not tracked: planted.' }]);
    expect(r1(f)).toHaveLength(1);
    expect(r3(f, MISSING, [{}])).toContainEqual(expect.stringMatching(/feats\/x-feat carries a dataWarning/));
  });

  it('R4 rejects another app\'s name', () => {
    expect(r4(found('the same single cantrip Wanderer\'s Guide grants'))).toHaveLength(1);
  });
});

/*
 * A REMOVED WARNING'S UNDELIVERED CLAUSE LIVES ON AS A NOTE — and the note expires when the engine
 * delivers it. Each check measures the engine, not the note's words alone, so it fails both ways: the
 * clause dropped while the sheet still lacks it, or the "the sheet does not …" sentence kept after the
 * sheet gained it.
 */

/** The class spellcasting entry's cantrip allowance for a level-6 `cls`, with or without Beast Gunner Dedication. */
const classCantripCap = (cls: string, take: boolean) =>
  build(cls, 6, take ? { featPicks: { '6:class:0': 'beast-gunner-dedication' } } : {}).spellcasting.find((e) => e.id === `${cls}-casting`)
    ?.cantripCap;

/**
 * feat-3229: "If you already cast arcane or primal spells from spell slots, you learn one additional
 * cantrip from that tradition." While the class entry's cap is unchanged by the feat, the note must say
 * so; once the engine raises it, the note's "does not add" sentence is false.
 */
export function beastGunnerSlotCasterNote(note: string | undefined, caps: Record<string, { without?: number; with?: number }>): string[] {
  const bad: string[] = [];
  const says = /additional cantrip/i.test(note ?? '') && /spell slots/i.test(note ?? '') && /does not add/i.test(note ?? '');
  for (const [cls, c] of Object.entries(caps)) {
    if (c.without === undefined || c.with === undefined) bad.push(`${cls}: no ${cls}-casting cantripCap — the measurement is vacuous`);
    else if (c.with === c.without && !says) bad.push(`${cls}: the class cantrip cap stays ${c.without} with Beast Gunner Dedication, and its note does not tell a slot caster about the additional cantrip`);
    else if (c.with !== c.without && says) bad.push(`${cls}: the class cantrip cap now moves ${c.without} → ${c.with} with Beast Gunner Dedication; the note's "does not add" sentence is false — drop it`);
  }
  return bad;
}

/** Every .ts/.tsx file under src/rules and src/sheet whose text matches `re`. */
function srcFilesMatching(re: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && re.test(readFileSync(p, 'utf8'))) out.push(p.replace(/\\/g, '/'));
    }
  };
  walk('src/rules');
  walk('src/sheet');
  return out;
}

/**
 * feat-3545: "You gain revulsion and sunlight vulnerabilities detailed in the Vampire Vulnerabilities
 * sidebar". While no sheet code mentions revulsion, the note must carry both; once some does, re-measure
 * and drop the sentence if the sheet applies them.
 */
export function vampireVulnerabilitiesNote(note: string | undefined, codeMentioning: string[]): string[] {
  const n = note ?? '';
  const bad: string[] = [];
  if (!n.includes('Negative Survival')) bad.push('vampire-dedication lost its Negative Survival note');
  const says = /Revulsion/.test(n) && /Sunlight/.test(n) && /does not apply/i.test(n);
  if (!codeMentioning.length && !says) bad.push('no sheet code applies Revulsion or Sunlight, and the vampire-dedication note does not say so');
  if (codeMentioning.length && says) bad.push(`${codeMentioning.join(', ')} now mention revulsion — re-measure; if the sheet applies the vulnerabilities, drop the note's "does not apply" sentence`);
  return bad;
}

describe('a removed warning\'s undelivered clause lives on as a note, until the engine delivers it', () => {
  const recs = core as Record<string, Record<string, { note?: string }>>;
  const OLD_BEAST_GUNNER_NOTE = 'Your cantrip must be one that requires a spell attack roll. The spell picker does not narrow the list to those, so choose one yourself.';
  const OLD_VAMPIRE_NOTE = 'Negative Survival: you are knocked out and begin dying at 0 HP like the living, but stabilize and similar methods that bring someone back from dying don’t benefit you, and when you would die you are destroyed rather than dead.';
  const measure = () => Object.fromEntries(['wizard', 'druid'].map((cls) => [cls, { without: classCantripCap(cls, false), with: classCantripCap(cls, true) }]));

  it('Beast Gunner Dedication: a slot caster is told about the additional cantrip the sheet does not add', () => {
    const note = recs.feats['beast-gunner-dedication'].note;
    expect(note, 'the attack-roll clause stays').toContain('requires a spell attack roll');
    expect(beastGunnerSlotCasterNote(note, measure())).toEqual([]);
  });

  it('planted: the attack-roll-only note (the round the checker caught) is rejected', () => {
    expect(beastGunnerSlotCasterNote(OLD_BEAST_GUNNER_NOTE, measure())).toHaveLength(2);
  });

  it('planted: once the engine adds the cantrip, the "does not add" sentence is rejected', () => {
    const rec = content().feats['beast-gunner-dedication'] as { spellSlotBonus?: unknown };
    const had = rec.spellSlotBonus;
    rec.spellSlotBonus = { cantrips: 1 };
    try {
      const planted = measure();
      expect(planted.wizard.with, 'the planted bonus reaches the class cap').toBe((planted.wizard.without ?? 0) + 1);
      expect(beastGunnerSlotCasterNote(recs.feats['beast-gunner-dedication'].note, planted)).toHaveLength(2);
    } finally {
      if (had === undefined) delete rec.spellSlotBonus;
      else rec.spellSlotBonus = had;
    }
  });

  it('Vampire Dedication: Revulsion and Sunlight are on the note while no sheet code applies them', () => {
    expect(vampireVulnerabilitiesNote(recs.feats['vampire-dedication'].note, srcFilesMatching(/revulsion/i))).toEqual([]);
  });

  it('planted: the Negative-Survival-only note is rejected, and so is the sentence once code mentions revulsion', () => {
    expect(vampireVulnerabilitiesNote(OLD_VAMPIRE_NOTE, [])).toHaveLength(1);
    expect(vampireVulnerabilitiesNote(recs.feats['vampire-dedication'].note, ['src/rules/planted.ts'])).toHaveLength(1);
  });
});
