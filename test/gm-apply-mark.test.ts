import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * F1 (2026-10-09, round 7): the GM-edit apply MARKS what it wrote (GM_APPLIED) and the entry it was judged
 * over (GM_JUDGED) — src/App.tsx, at the top of the file. The after-commit effect reads the marks to tell
 * "his edit, or a player change composed on it" from "something replaced the entry" (race legs 41, 47, 48
 * in test/bug-gm-edit-race.test.tsx).
 *
 * Two promises rest on how JavaScript treats an enumerable symbol-keyed own property, and both are pinned
 * here: (1) object spread — the way every App updater composes on an entry — COPIES it, so a player's
 * change on top of his edit keeps the mark; (2) JSON — persistence, the cloud bundle, the publish payload —
 * and structuredClone DROP it, so the mark can never leak to disk, to another device or to the GM, and an
 * entry that was parsed, loaded, adopted or imported carries none. The source guard ties the rule to
 * App's own definitions: a mark written through `Object.defineProperty` (not enumerable: the spread drops
 * it) or a registered `Symbol.for` key (forgeable from parsed data) fails it.
 * MUTATION (run 2026-10-09, round 7): App marks the judged entry through
 * `Object.defineProperty(k.judged, GM_JUDGED, { value: mark, configurable: true })` — and this fails —
 *   AssertionError: the judged entry is marked by plain assignment: expected 'import { useEffect, useLayoutEffect, …' to match /\(k\.judged as GmMarked\)\[GM_JUDGED\…/
 */
const APP = readFileSync('src/App.tsx', 'utf8');

describe('the GM-apply mark (App.tsx GM_APPLIED / GM_JUDGED)', () => {
  it('App defines both marks as plain unregistered symbols and writes them as ordinary enumerable properties', () => {
    expect(APP, 'GM_APPLIED is a plain Symbol').toMatch(/const GM_APPLIED = Symbol\('hh\.gmApplied'\);/);
    expect(APP, 'GM_JUDGED is a plain Symbol').toMatch(/const GM_JUDGED = Symbol\('hh\.gmJudged'\);/);
    expect(APP, 'the written entry carries GM_APPLIED by a literal key').toMatch(/\{ \.\.\.k\.e\.sheet, id: c\.id, archived: c\.archived \?\? false, \[GM_APPLIED\]: mark \}/);
    expect(APP, 'the judged entry is marked by plain assignment').toMatch(/\(k\.judged as GmMarked\)\[GM_JUDGED\] = mark;/);
    expect(APP, 'never through defineProperty (non-enumerable — a spread would drop it)').not.toMatch(/defineProperty\([^)]*GM_(APPLIED|JUDGED)/);
    expect(APP, 'never a registered symbol').not.toMatch(/Symbol\.for\('hh\.gm/);
  });

  it('a spread copies the mark; JSON and structuredClone drop it', () => {
    const GM_APPLIED = Symbol('hh.gmApplied');
    const GM_JUDGED = Symbol('hh.gmJudged');
    type Marked = { id: string; character: { name: string }; play: { potions: number }; [GM_APPLIED]?: string; [GM_JUDGED]?: string };
    const mark = 'camp|c1|2026-10-09T09:01:00.000Z';
    const applied: Marked = { id: 'c1', character: { name: 'GM Version' }, play: { potions: 3 }, [GM_APPLIED]: mark };
    const judged: Marked = { id: 'c1', character: { name: 'Player Version' }, play: { potions: 3 } };
    judged[GM_JUDGED] = mark;

    // (1) App's updaters compose by spread: a tap, a Customize click, a zoom keep the mark.
    const tapped: Marked = { ...applied, play: { ...applied.play, potions: 4 } };
    const customized: Marked = { ...applied, character: { ...applied.character, name: 'Renamed' } };
    const onJudged: Marked = { ...judged, play: { ...judged.play, potions: 4 } };
    expect([tapped[GM_APPLIED], customized[GM_APPLIED], onJudged[GM_JUDGED]], 'a spread copies an enumerable symbol key').toEqual([mark, mark, mark]);

    // (2) Nothing serialised carries it: storage, the cloud bundle, the publish payload, a parsed adopt.
    const viaJson = JSON.parse(JSON.stringify(tapped)) as Marked;
    expect(viaJson[GM_APPLIED], 'JSON drops the mark').toBeUndefined();
    expect(JSON.stringify(tapped), 'the serialised entry is the same with or without the mark').toBe(JSON.stringify({ ...tapped, [GM_APPLIED]: undefined }));
    expect(Object.getOwnPropertySymbols(viaJson), 'a parsed entry has no symbol keys at all').toEqual([]);
    expect((structuredClone(tapped) as Marked)[GM_APPLIED], 'structuredClone drops the mark').toBeUndefined();
    expect((JSON.parse(JSON.stringify(onJudged)) as Marked)[GM_JUDGED], 'JSON drops the judged mark').toBeUndefined();
  });
});
