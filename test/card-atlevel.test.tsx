// @vitest-environment jsdom
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { FeatsTab, featEntries } from '../src/sheet/FeatsTab';
import { featPinNode, type FeatEntry } from '../src/sheet/FeatDetail';
import { PinnedDescCard } from '../src/sheet/MainTab';
import { pinOf } from '../src/rules/play';
import { atLevelLines } from '../src/sheet/cardAtLevel';
import { AT_LEVEL, atLevelFamilyOf } from '../src/sheet/cardScope';
import { atLevelProblems, oursInPage } from '../scripts/lib/card-scope.mjs';
import { deriveDefenses, deriveStrikes } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Card step 18 (docs/card-design.md section 3 row "Sentence that scales inside itself", section 4 kind
 * `atYourLevel`, section 9 row 18): "AT YOUR LEVEL" LINES FROM DERIVE.
 *
 * Where a record's page prints a value that scales with level inside its prose, the card keeps the printed
 * words whole and adds ONE ours line with the value src/rules/derive.ts computes for this character at its
 * level — read off derive's Strike output by src/sheet/cardAtLevel.ts, never computed by the card. The
 * records that may carry the line are cardScope.ts AT_LEVEL, checked both ways by
 * scripts/lib/card-scope.mjs atLevelProblems.
 *
 * Characters are synthesized through build() (name 't'); none is the owner's. The rendered case opens the
 * REAL FeatsTab row and card over the shipped page trees (public/ast/*.json.gz, served by a fetch stub).
 *
 * MUTATION LINES (each measured red on 2026-10-08 under scripts/vt.mjs, then the file restored byte-exact
 * from a scratch copy, sha1 checked):
 *  - cardAtLevel.ts: the lead `atLevelLead(c.level)` → `atLevelLead(c.level - 1)` (a line labelled with the
 *    wrong level) → 7 of 10 red.
 *  - cardAtLevel.ts strikesOf: `deriveStrikes(ch, db)` → `deriveStrikes({ ...ch, level: 1 }, db)` (derive
 *    read at the wrong level) → 7 of 10 red.
 *  - cardAtLevel.ts atLevelLines: the `holds` gate forced true (a line on a record the character lacks) → the
 *    "NO line" case red (the fury barbarian got a line on the Giant instinct).
 *  - cardScope.ts AT_LEVEL: `'feats:butterflys-sting': 'sneakAttack'` added (a line on a record whose page
 *    prints no scaling) → the "NO line" case and the ledger case red.
 *  - cardAtLevel.ts: the line's kind `'atYourLevel'` → `'note'` (not marked as the at-level kind) → 7 of 10 red.
 *  - RecordCard.tsx OursBox: `data-ours=""` dropped from the box (the line drawn unmarked) → the rogue 7 card
 *    case red (the line read as the page's own text).
 *  - scripts/lib/card-scope.mjs OURS_MARKERS: the at-level marker dropped → the OURS-LEAK case red.
 *  - scripts/lib/card-scope.mjs atLevelProblems: the barbarian-instinct two-way loop emptied → the ledger case red.
 * Fixer round 1 (2026-10-08, same method):
 *  - cardAtLevel.ts atLevelLines: the no-value branch `: []` → a guessed `1d6` line → the "LISTED record the
 *    character HOLDS gets NO line" case red (rogue 7 in a form with no Strikes got a Sneak Attack line).
 *  - cardAtLevel.ts defensesOf: `deriveDefenses(c, db)` → `deriveDefenses({ ...c, level: c.level - 1 }, db)`
 *    (derive read at the wrong level) → the Guardian's Armor and Fire Resistance cases red.
 *  - cardAtLevel.ts defenseValue: the `s.from === label` filter dropped (another source's value read) → the
 *    Fire Resistance case red (Arctic Elf's line took Bound in Ice's 7).
 *  - FeatsTab.tsx heritage row: `ours: atLevelLines(…'heritages'…)` → `ours: []` → the heritage card case red.
 *  - scripts/lib/card-scope.mjs atLevelProblems: the levelDefense reverse loop emptied → both ledger cases red.
 *  - cardScope.ts AT_LEVEL_DEFERRED: `'heritages:naari'` dropped → both ledger cases red.
 * Fixer round 2 (2026-10-08, same method):
 *  - FeatsTab.tsx inventor-modification row: `ours: [...atLevelLines(…), ...overrideOf(…)]` →
 *    `ours: [...overrideOf('classFeatures', f.id)]` → the inventor armour-modification case red.
 * Fixer round 3 (2026-10-08, same method):
 *  - cardAtLevel.ts defenseValue: `filter((s) => s.from === label && …)` → the first numbered entry of the
 *    key (`filter((s) => typeof s.value === 'number').slice(0, 1)`) → the Fire Resistance case red (Bound in
 *    Ice's row read "resistance 3 to cold; a higher resistance to the same type applies" — Arctic Elf's 3).
 *  - FeatDetail.tsx pinDescriptionOf: the `l.kind !== 'atYourLevel'` exclusion removed → the Dragon Instinct
 *    pin case red (the stored description carried the level-5 line).
 *  - MainTab.tsx PinnedDescCard: the live `atLevelLines(…)` → `[]` → the Dragon Instinct pin case red (no
 *    live line on the reopened pin).
 *  - cardAtLevel.ts valueOf: the Greater suffix dropped (`greater ? amounts : amounts`) → the rogue 15 case red.
 * Fixer round 4 (2026-10-08, same method):
 *  - MainTab.tsx PinnedDescCard: `[...(page ? ours : []), ...live]` → `[...(page ? ours : []), ...(page ? [] :
 *    live)]` (the live line kept off the page lane) → the PAGE-lane Sneak Attack pin case red (no line at 11).
 *  - MainTab.tsx PinnedDescCard: the `pin.mode === 'mine' &&` gate dropped → the browse-mode pin case red (a
 *    search pin drew an at-level line).
 */
const db: ContentDatabase = content();
const noop = () => undefined;
const trees: Record<string, Record<string, AstNode>> = {};
const astIndex = JSON.parse(readFileSync('public/ast-index.json', 'utf8')) as Record<string, string>;
function treeOf(b: string): Record<string, AstNode> | undefined {
  if (trees[b]) return trees[b];
  const p = `public/ast/${b}.json.gz`;
  if (!existsSync(p)) return undefined;
  trees[b] = JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));
  return trees[b];
}

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement): Promise<{ host: HTMLElement; stop: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={db}>{el}</ContentContext.Provider>);
  });
  await settle();
  return { host, stop: () => { act(() => root.unmount()); host.remove(); } };
}
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** FeatsTab for a character, the row named `name` clicked open: the card, its own text (every [data-ours]
 *  node removed) and its at-level lines. */
async function openCard(ch: Character, name: string) {
  const m = await mount(<FeatsTab character={ch} content={db} />);
  const row = [...m.host.querySelectorAll('.ff-row')].find((r) => txt(r.querySelector('.ff-name')) === name);
  // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
  expect(row, `FeatsTab lists a row named ${name}`).toBeTruthy();
  await act(async () => { (row as HTMLElement).click(); });
  await settle();
  const card = (m.host.querySelector('.card-mine') ?? m.host.querySelector('.picker.spell-detail')) as HTMLElement | null;
  // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
  expect(card, `${name}: the row opened its popup`).toBeTruthy();
  const copy = card!.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-ours]').forEach((e) => e.remove());
  return { ...m, card: card!, own: txt(copy), lines: [...card!.querySelectorAll('.sd-ours.card-ours-atYourLevel')] };
}

/** The at-level lines featEntries puts on the row whose record id is `id`. */
const rowLines = (ch: Character, id: string) => {
  const e = featEntries(ch, db).find((x) => (x.featId ?? x.featureId ?? x.trustFeatureId ?? x.heritageId) === id);
  // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
  expect(e, `a row for ${id}`).toBeTruthy();
  return (e!.ours ?? []).filter((l) => l.kind === 'atYourLevel').map((l) => l.text);
};
/** The record id a row stands for (feat, class feature, choice option, heritage). */
const rowId = (e: FeatEntry) => e.featId ?? e.featureId ?? e.trustFeatureId ?? e.heritageId;
/** A rider derive puts on the character's Strikes, read the way a test reads the engine. */
const riderText = (ch: Character, note: (n: string) => boolean) =>
  deriveStrikes(ch, db).flatMap((s) => s.conditionalDamage ?? []).find((r) => note(r.note))?.text;
const withFeats = (ch: Character, ...featIds: string[]): Character => ({
  ...ch,
  feats: [...ch.feats, ...featIds.map((featId) => ({ featId, level: db.feats[featId]?.level ?? 1, source: 'class' as const }))],
} as Character);

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (/ast-index\.json$/.test(u)) return { ok: true, json: async () => astIndex };
    const m = /ast\/(\w+)\.json$/.exec(u);
    const t = m ? treeOf(m[1]) : undefined;
    return t ? { ok: true, json: async () => t } : { ok: false };
  });
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = noop;
  await loadAstIndex();
  for (const b of ['feats', 'classFeatures', 'heritages']) await loadBucketAst(b);
}, 300_000);
afterAll(() => { vi.unstubAllGlobals(); });

describe('card step 18: "At your level" lines read from derive', () => {
  // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
  it('a rogue 7\'s Sneak Attack card: the page\'s "1d6" prose untouched, ONE ours line "At your level (7): 2d6 precision" in [data-ours]; at 11 it reads 3d6', async () => {
    const r7 = build('rogue', 7);
    const v = await openCard(r7, db.classFeatures['sneak-attack'].name);
    // The printed paragraph is the page's own words, whole: its 1d6 and its level steps, never rewritten.
    expect(v.own).toContain('you deal an extra 1d6 precision damage');
    expect(v.own).toContain('Increase the number of dice by one at 5th, 11th, and 17th levels');
    // batch card premise: class-feature-743 "you deal an extra 1d6 precision damage"
    expect(v.own).not.toMatch(/2d6|At your level/);
    // Exactly one at-level line, marked ours (inside the card's [data-ours] box, kind atYourLevel).
    // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
    expect(v.lines.map(txt)).toEqual(['At your level (7): 2d6 precision']);
    expect(v.lines[0].closest('.card-ours[data-ours]'), 'the line sits in the ours box').toBeTruthy();
    expect(v.lines[0].getAttribute('data-ours-kind')).toBe('atYourLevel');
    // It is derive's number: the same words as the rider derive puts on the rogue's Strikes.
    // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
    expect(v.lines.map(txt)[0]).toBe(`At your level (7): ${riderText(r7, (n) => n === 'sneak attack when target is off-guard')}`);
    v.stop();
    const w = await openCard(build('rogue', 11), db.classFeatures['sneak-attack'].name);
    // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
    expect(w.own).toContain('you deal an extra 1d6 precision damage');
    expect(w.lines.map(txt)).toEqual(['At your level (11): 3d6 precision']);
    w.stop();
  });

  // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
  it('the line follows the engine at every step: rogue 4 / 5 / 17 read 1d6 / 2d6 / 4d6 (the row\'s level, never another)', () => {
    expect(rowLines(build('rogue', 4), 'sneak-attack')).toEqual(['At your level (4): 1d6 precision']);
    expect(rowLines(build('rogue', 5), 'sneak-attack')).toEqual(['At your level (5): 2d6 precision']);
    expect(rowLines(build('rogue', 17), 'sneak-attack')).toEqual(['At your level (17): 4d6 precision']);
  });

  // batch card premise: feat-5094 "it deals 1d4 damage, increasing to 1d6 at 6th level"
  it('Sneak Attacker (the feat\'s own printed step): 1d4 at 5, 1d6 at 6', () => {
    expect(rowLines(withFeats(build('fighter', 5), 'sneak-attacker'), 'sneak-attacker')).toEqual(['At your level (5): 1d4 precision']);
    expect(rowLines(withFeats(build('fighter', 6), 'sneak-attacker'), 'sneak-attacker')).toEqual(['At your level (6): 1d6 precision']);
  });

  // batch card premise: feat-2706 "You don't increase the number of dice as you gain levels"
  it('a record derive pays but whose page prints no scaling (Butterfly\'s Sting), and a character without the feature: NO line', () => {
    const f = withFeats(build('fighter', 9), 'butterflys-sting');
    // derive does pay this fighter a Sneak Attack rider — the page prints a fixed die, so no line is made.
    expect(riderText(f, (n) => n === 'sneak attack when target is off-guard')).toBeTruthy();
    expect(atLevelFamilyOf('feats', 'butterflys-sting')).toBeUndefined();
    expect(rowLines(f, 'butterflys-sting')).toEqual([]);
    // A fighter 7 owns no Sneak Attack: asked for that record, the builder gives nothing.
    // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
    expect(atLevelLines(build('fighter', 7), db, 'classFeatures', 'sneak-attack')).toEqual([]);
    // A fury barbarian asked for another instinct's record: nothing.
    // batch card premise: instinct-10 "Increase the additional damage from Rage from 2 to 3"
    expect(atLevelLines(build('barbarian', 7, { subclassId: 'fury-instinct' }), db, 'classFeatures', 'giant-instinct')).toEqual([]);
  });

  // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
  it('across five synthesized builds, every at-level line sits on a row whose record is in AT_LEVEL, one line at most per row, always kind atYourLevel', () => {
    const builds = [
      build('rogue', 7), build('rogue', 15), build('fighter', 15), build('wizard', 13),
      build('barbarian', 7, { subclassId: 'fury-instinct' }), build('ranger', 11, { subclassId: 'precision' }),
    ];
    let seen = 0;
    for (const ch of builds) {
      for (const e of featEntries(ch, db)) {
        const lines = (e.ours ?? []).filter((l) => /^At your level \(\d+\): /.test(l.text) && l.kind !== 'usesRetune');
        if (!lines.length) continue;
        seen += lines.length;
        // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
        expect(lines.length, `${e.name}: one line`).toBe(1);
        expect(lines[0].kind, `${e.name}: marked as the at-level kind`).toBe('atYourLevel');
        const id = rowId(e)!;
        // batch card premise: class-feature-1181 "This damage increases to 3 if you're a master"
        expect(Object.keys(AT_LEVEL).some((k) => k.endsWith(`:${id}`)), `${e.name} (${id}) is a listed record`).toBe(true);
        expect(lines[0].text.startsWith(`At your level (${ch.level}): `), `${e.name}: the character's own level`).toBe(true);
      }
    }
    // rogue 7 (Sneak Attack, Weapon Specialization), rogue 15 (Sneak Attack, both specializations), fighter 15
    // (both), wizard 13 (one), barbarian 7 (instinct, Weapon Specialization), ranger 11 (Precision, Weapon Specialization).
    // batch card premise: class-feature-1181 "This damage increases to 3 if you're a master"
    expect(seen).toBe(2 + 3 + 2 + 1 + 2 + 2);
  });

  // batch card premise: instinct-10 "Increase the additional damage from Rage from 2 to 3"
  it('a fury barbarian\'s instinct row: derive\'s Rage rider (read with Rage on), and it changes at 7', () => {
    const b1 = build('barbarian', 1, { subclassId: 'fury-instinct' });
    const b7 = build('barbarian', 7, { subclassId: 'fury-instinct' });
    const raging = (ch: Character) => ({ ...ch, classResources: { ...(ch.classResources ?? {}), rage: 1 } } as Character);
    const rider = (ch: Character) => deriveStrikes(raging(ch), db).find((s) => s.name === 'Fist')?.conditionalDamage?.find((r) => /^\* while raging/.test(r.note));
    expect(rider(b7)?.text, 'derive pays the Fist a Rage rider at 7').toBeTruthy();
    // batch card premise: instinct-10 "Increase the additional damage from Rage from 2 to 3"
    expect(rowLines(b7, 'fury-instinct')).toEqual([`At your level (7): Fist: ${rider(b7)!.text}, ${rider(b7)!.note.replace(/^\*\s*/, '')}`]);
    expect(rowLines(b7, 'fury-instinct')[0]).toContain('Fist: 3 bludgeoning');
    expect(rowLines(b1, 'fury-instinct')[0]).toContain('Fist: 1 bludgeoning');
    // Not raging, derive's Strikes carry no Rage rider — the line still says what Rage adds, and names the condition.
    // batch card premise: instinct-10 "Increase the additional damage from Rage from 2 to 3"
    expect(deriveStrikes(b7, db).flatMap((s) => s.conditionalDamage ?? []).some((r) => /while raging/.test(r.note))).toBe(false);
    expect(rowLines(b7, 'fury-instinct')[0]).toContain('while raging');
  });

  // batch card premise: hunters-edge-5 "At 11th level, the extra damage increases to 2d8 precision damage"
  it('a Precision ranger\'s hunter\'s edge row: 1d8 at 10, 2d8 at 11 — derive\'s rider read with Hunt Prey on', () => {
    expect(rowLines(build('ranger', 10, { subclassId: 'precision' }), 'precision')).toEqual(['At your level (10): 1d8 precision, first hit vs hunted prey']);
    expect(rowLines(build('ranger', 11, { subclassId: 'precision' }), 'precision')).toEqual(['At your level (11): 2d8 precision, first hit vs hunted prey']);
  });

  // batch card premise: class-feature-1181 "This damage increases to 3 if you're a master"
  it('Weapon Specialization: the specialization damage derive folds into each Strike, by rank — rogue 7 expert 2, rogue 13 master 3', () => {
    const r7 = build('rogue', 7);
    const r13 = build('rogue', 13);
    const spec = (ch: Character) => deriveStrikes(ch, db).find((s) => s.name === 'Fist')!;
    expect(rowLines(r7, 'weapon-specialization')).toEqual([`At your level (7): ${spec(r7).specDamage} extra damage with Fist (${spec(r7).rank})`]);
    expect(rowLines(r7, 'weapon-specialization')).toEqual(['At your level (7): 2 extra damage with Fist (expert)']);
    // batch card premise: class-feature-1181 "This damage increases to 3 if you're a master"
    expect(rowLines(r13, 'weapon-specialization')).toEqual(['At your level (13): 3 extra damage with Fist (master)']);
    // A rogue 5 owns no Weapon Specialization yet: no row, and the builder gives nothing for the record.
    // batch card premise: class-feature-1181 "This damage increases to 3 if you're a master"
    expect(atLevelLines(build('rogue', 5), db, 'classFeatures', 'weapon-specialization')).toEqual([]);
  });

  // batch card premise: class-feature-1190 "6 if you're a master, and 8 if you're legendary"
  it('a rogue 15 holds Greater Weapon Specialization too: BOTH rows show derive\'s combined total and say it is the two together', () => {
    const r15 = build('rogue', 15);
    const fist = deriveStrikes(r15, db).find((s) => s.name === 'Fist')!;
    // derive folds both features into one number on the Strike.
    // batch card premise: class-feature-1190 "6 if you're a master, and 8 if you're legendary"
    expect([fist.specDamage, fist.rank]).toEqual([6, 'master']);
    const line = 'At your level (15): 6 extra damage with Fist (master), Weapon Specialization and Greater together';
    // batch card premise: class-feature-1181 "This damage increases to 3 if you're a master"
    expect(rowLines(r15, 'weapon-specialization')).toEqual([line]);
    // batch card premise: class-feature-1190 "6 if you're a master, and 8 if you're legendary"
    expect(rowLines(r15, 'greater-weapon-specialization')).toEqual([line]);
    // Below 15 (Weapon Specialization alone) the line carries no such words.
    // batch card premise: class-feature-1181 "This damage increases to 3 if you're a master"
    expect(rowLines(build('rogue', 14), 'weapon-specialization')).toEqual(['At your level (14): 3 extra damage with Fist (master)']);
  });

  // batch card premise: instinct-9 "increase the additional damage from Rage from 2 to 4"
  it('a pinned at-level line is never frozen: a barbarian 5\'s Dragon Instinct pin (no page) stores no "At your level"; reopened at 7 the live line is drawn, marked ours', async () => {
    const opts = { subclassId: 'dragon-instinct' };
    const b5 = build('barbarian', 5, opts);
    const entry = featEntries(b5, db).find((x) => rowId(x) === 'dragon-instinct');
    // batch card premise: instinct-9 "increase the additional damage from Rage from 2 to 4"
    expect(entry, 'a Dragon Instinct row').toBeTruthy();
    // The row itself carries the at-level line (so the pin had one to freeze)…
    const rowLine = (entry!.ours ?? []).filter((l) => l.kind === 'atYourLevel').map((l) => l.text);
    expect(rowLine.length).toBe(1);
    expect(rowLine[0].startsWith('At your level (5): ')).toBe(true);
    // …and the record has no page, so a reopened pin draws the STORED description.
    expect(astIndex['dragon-instinct']).toBeUndefined();
    const pin = pinOf(featPinNode(entry!));
    // batch card premise: instinct-9 "increase the additional damage from Rage from 2 to 4"
    expect(pin.description).not.toMatch(/At your level/);
    expect((pin.ours ?? []).some((l) => l.kind === 'atYourLevel')).toBe(false);
    // Reopened from the Pinned list for the same character, now level 7: derive's CURRENT value, marked ours.
    const b7 = build('barbarian', 7, opts);
    const m = await mount(<PinnedDescCard pin={pin} content={db} character={b7} onClose={noop} />);
    const card = (m.host.querySelector('.card-mine') ?? m.host.querySelector('.picker.spell-detail')) as HTMLElement;
    // batch card premise: instinct-9 "increase the additional damage from Rage from 2 to 4"
    expect(card, 'the pin reopened its card').toBeTruthy();
    const lines = [...card.querySelectorAll('.sd-ours.card-ours-atYourLevel')];
    expect(lines.map(txt)).toEqual(rowLines(b7, 'dragon-instinct'));
    expect(txt(lines[0]).startsWith('At your level (7): ')).toBe(true);
    expect(lines[0].closest('.card-ours[data-ours]'), 'the live line sits in the ours box').toBeTruthy();
    expect(lines[0].getAttribute('data-ours-kind')).toBe('atYourLevel');
    // The card's own (unmarked) text carries no at-level words at all — no frozen level-5 line.
    const copy = card.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-ours]').forEach((e) => e.remove());
    // batch card premise: instinct-9 "increase the additional damage from Rage from 2 to 4"
    expect(txt(copy)).not.toMatch(/At your level/);
    m.stop();
    // A character who no longer holds the record: no live line.
    const other = await mount(<PinnedDescCard pin={pin} content={db} character={build('barbarian', 7, { subclassId: 'fury-instinct' })} onClose={noop} />);
    expect(other.host.querySelectorAll('.card-ours-atYourLevel').length).toBe(0);
    other.stop();
  });

  /** A rogue 7's Sneak Attack row pinned the way the row's star pins it (FeatDetail featPinNode → play.ts pinOf). */
  const sneakPin = () => {
    const entry = featEntries(build('rogue', 7), db).find((x) => rowId(x) === 'sneak-attack');
    // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
    expect(entry, 'a Sneak Attack row').toBeTruthy();
    return pinOf(featPinNode(entry!));
  };

  // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
  it('a PAGE-lane pin is never frozen either: a rogue 7\'s Sneak Attack pin reopened for the rogue at 11 draws the page whole and ONE live ours line "At your level (11): 3d6 precision"', async () => {
    const pin = sneakPin();
    expect(pin.mode).toBe('mine');
    // The record has a page, so the reopened pin draws the PAGE (not the stored description).
    expect(astIndex['sneak-attack']).toBeTruthy();
    expect((pin.ours ?? []).some((l) => l.kind === 'atYourLevel')).toBe(false);
    const m = await mount(<PinnedDescCard pin={pin} content={db} character={build('rogue', 11)} onClose={noop} />);
    const card = (m.host.querySelector('.card-mine') ?? m.host.querySelector('.picker.spell-detail')) as HTMLElement;
    // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
    expect(card, 'the pin reopened its card').toBeTruthy();
    const lines = [...card.querySelectorAll('.sd-ours.card-ours-atYourLevel')];
    // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
    expect(lines.map(txt)).toEqual(['At your level (11): 3d6 precision']);
    expect(lines[0].closest('.card-ours[data-ours]'), 'the live line sits in the ours box').toBeTruthy();
    expect(lines[0].getAttribute('data-ours-kind')).toBe('atYourLevel');
    // The page's own words, whole: its printed 1d6 and its level steps, and no at-level words outside the box.
    const copy = card.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-ours]').forEach((e) => e.remove());
    // batch card premise: class-feature-743 "you deal an extra 1d6 precision damage"
    expect(txt(copy)).toContain('you deal an extra 1d6 precision damage');
    expect(txt(copy)).toContain('Increase the number of dice by one at 5th, 11th, and 17th levels');
    expect(txt(copy)).not.toMatch(/At your level/);
    m.stop();
  });

  // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
  it('a pin made in browse mode (a search pin for the same record, no mode) reopened with the character shows NO at-level line', async () => {
    // pinOf keeps a mode only when one is given: this is the stored shape of a pin starred from browsing.
    const browse = pinOf({ ...sneakPin(), mode: undefined });
    expect('mode' in browse).toBe(false);
    const m = await mount(<PinnedDescCard pin={browse} content={db} character={build('rogue', 11)} onClose={noop} />);
    // batch card premise: class-feature-743 "you deal an extra 1d6 precision damage"
    expect(txt(m.host)).toContain('you deal an extra 1d6 precision damage');
    expect(m.host.querySelectorAll('.card-ours-atYourLevel').length).toBe(0);
    expect(txt(m.host)).not.toMatch(/At your level/);
    m.stop();
  });

  // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
  it('the ledger: AT_LEVEL agrees with the shipped data both ways; a missing record, an unlisted instinct and a page without the clause each show', () => {
    // The heritage pages too: a heritage's card draws its page (Naari's prints no sizing; its own text does).
    const t = { classFeatures: treeOf('classFeatures')!, feats: treeOf('feats')!, heritages: treeOf('heritages')! };
    expect(atLevelProblems(db, t)).toEqual([]);
    // An unlisted barbarian instinct (derive scales Rage by every one) is named.
    const barb = db.classes.barbarian;
    const synthDb = { ...db, classes: { ...db.classes, barbarian: { ...barb, subclass: { ...barb.subclass!, options: [...barb.subclass!.options, { id: 'synthesized-instinct', name: 'Synthesized' }] } } } } as unknown as ContentDatabase;
    // batch card premise: instinct-10 "Increase the additional damage from Rage from 2 to 3"
    expect(atLevelProblems(synthDb, t)).toEqual(['classFeatures:synthesized-instinct|a barbarian instinct derive scales Rage by, not listed']);
    // A listed record whose page loses its scaling clause is named.
    const sa = t.classFeatures['sneak-attack'];
    const flat = { ...t, classFeatures: { ...t.classFeatures, 'sneak-attack': { ...sa, c: [{ t: 'p', c: [{ t: 'text', v: 'Synthesized words with no dice.' }] }] } as AstNode } };
    // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
    expect(atLevelProblems(db, flat)).toEqual(['classFeatures:sneak-attack|its page prints no sneakAttack scaling clause']);
    // A listed record missing from the data is named.
    const feats = { ...db.feats };
    delete feats['sneak-attacker'];
    // batch card premise: feat-5094 "it deals 1d4 damage, increasing to 1d6 at 6th level"
    expect(atLevelProblems({ ...db, feats } as ContentDatabase, t)).toEqual(['feats:sneak-attacker|no record']);
  });

  // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
  it('the ledger knows the line is ours: its opening words inside a page are OURS-LEAK; the real Sneak Attack page carries none', () => {
    expect(oursInPage({ t: 'doc', c: [{ t: 'p', c: [{ t: 'text', v: 'At your level (7): 2d6 precision' }] }] })).toEqual([String(/\bAt your level \(\d+\):/)]);
    expect(oursInPage(treeOf('classFeatures')!['sneak-attack'])).toEqual([]);
  });

  /** A synthesized battle form (derive.ts activeBattleForm reads the first active mode carrying one). */
  const inForm = (ch: Character, battleForm: Record<string, unknown>): Character =>
    ({ ...ch, activeModes: [...(ch.activeModes ?? []), { id: 'synthesized-form', name: 'Synthesized form', battleForm }] } as unknown as Character);
  /** derive's own attribution of a resistance / weakness to a named source, the way a test reads the engine. */
  const attributed = (ch: Character, key: string, from: string) => (deriveDefenses(ch, db).sources?.[key] ?? []).filter((s) => s.from === from);

  // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
  it('a LISTED record the character HOLDS gets NO line when derive computes no value for it — never a guessed number', () => {
    // A rogue 7 in a form that cannot Strike: derive returns no Strikes, so no Sneak Attack rider exists.
    const r7 = build('rogue', 7);
    const noStrikes = inForm(r7, { noStrikes: true });
    expect(deriveStrikes(noStrikes, db)).toEqual([]);
    // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
    expect(atLevelLines(noStrikes, db, 'classFeatures', 'sneak-attack')).toEqual([]);
    expect(rowLines(noStrikes, 'sneak-attack')).toEqual([]);
    // A form with its own Strikes: derive prints the form's fixed damage, no Sneak Attack rider, no specialization.
    const jaws = inForm(r7, { strikes: [{ name: 'Synthesized jaws', damage: '2d8 piercing', traits: [] }] });
    // batch card premise: class-feature-743 "Increase the number of dice by one at 5th, 11th, and 17th levels"
    expect(riderText(jaws, (n) => n === 'sneak attack when target is off-guard')).toBeUndefined();
    expect(rowLines(jaws, 'sneak-attack')).toEqual([]);
    // batch card premise: class-feature-1181 "This damage increases to 3 if you're a master"
    expect(rowLines(jaws, 'weapon-specialization')).toEqual([]);
    // A guardian 5 holds Guardian's Armor but wears no armour: derive withholds the resistance, so no line.
    const g5 = build('guardian', 5);
    // batch card premise: class-feature-1115 "While wearing medium or heavy armor, you gain resistance to physical damage equal to 1 + half your level"
    expect(attributed(g5, 'resistance:physical', db.classFeatures['guardians-armor'].name)).toEqual([]);
    expect(rowLines(g5, 'guardians-armor')).toEqual([]);
    // A fighter 3 with Skeletal Resistance: derive resolves its value to 0 below 5th and pays nothing, so no line.
    const s3 = withFeats(build('fighter', 3), 'skeletal-resistance');
    // batch card premise: feat-3540 "This resistance increases to 3 at 13th level and 4 at 17th level"
    expect(attributed(s3, 'resistance:cold', db.feats['skeletal-resistance'].name)).toEqual([]);
    expect(rowLines(s3, 'skeletal-resistance')).toEqual([]);
  });

  // batch card premise: class-feature-1115 "While wearing medium or heavy armor, you gain resistance to physical damage equal to 1 + half your level"
  it('level-sized resistances: Guardian\'s Armor worn reads derive\'s 1 + half level, and follows the level', () => {
    const armoured = (lvl: number) => ({ ...build('guardian', lvl), inventory: [{ instanceId: 'synth-armor', itemId: 'full-plate', quantity: 1, worn: true }] } as unknown as Character);
    const v = (lvl: number) => attributed(armoured(lvl), 'resistance:physical', db.classFeatures['guardians-armor'].name)[0]?.value;
    // batch card premise: class-feature-1115 "While wearing medium or heavy armor, you gain resistance to physical damage equal to 1 + half your level"
    expect(v(5)).toBe(3);
    expect(rowLines(armoured(5), 'guardians-armor')).toEqual([`At your level (5): resistance ${v(5)} to physical`]);
    expect(rowLines(armoured(10), 'guardians-armor')).toEqual(['At your level (10): resistance 6 to physical']);
  });

  // batch card premise: feat-2973 "You gain fire resistance equal to half your level"
  it('a feat\'s level-sized resistance and weakness: Fire Resistance 3 at 7, 4 at 8; Skeletal Resistance\'s printed steps; a lower one says derive did not count it', () => {
    expect(rowLines(withFeats(build('fighter', 7), 'fire-resistance'), 'fire-resistance')).toEqual(['At your level (7): resistance 3 to fire']);
    expect(rowLines(withFeats(build('fighter', 8), 'fire-resistance'), 'fire-resistance')).toEqual(['At your level (8): resistance 4 to fire']);
    // batch card premise: feat-3540 "This resistance increases to 3 at 13th level and 4 at 17th level"
    expect(rowLines(withFeats(build('fighter', 13), 'skeletal-resistance'), 'skeletal-resistance')).toEqual(['At your level (13): resistance 3 to cold, electricity, fire, piercing, slashing']);
    expect(rowLines(withFeats(build('fighter', 17), 'skeletal-resistance'), 'skeletal-resistance')).toEqual(['At your level (17): resistance 4 to cold, electricity, fire, piercing, slashing']);
    // Two cold sources: derive keeps the lower one with applied: false (no stacking), and the line says so.
    const both = withFeats(build('fighter', 7, { ancestryId: 'elf', heritageId: 'arctic-elf' }), 'bound-in-ice');
    // batch card premise: heritage-240 "granting you cold resistance equal to half your level (minimum 1)"
    expect(attributed(both, 'resistance:cold', 'Arctic Elf')).toEqual([{ from: 'Arctic Elf', value: 3, applied: false }]);
    expect(rowLines(both, 'arctic-elf')).toEqual(['At your level (7): resistance 3 to cold; a higher resistance to the same type applies']);
    // The other source's own row reads ITS entries only (derive's attribution by label): Bound in Ice's 7 cold
    // and 3 fire — never the Arctic Elf's 3 cold, which shares the cold key.
    // batch card premise: feat-3419 "Your cold resistance increases to be equal to your level"
    expect(attributed(both, 'resistance:cold', 'Bound in Ice')).toEqual([{ from: 'Bound in Ice', value: 7, applied: true }]);
    expect(rowLines(both, 'bound-in-ice')).toEqual(['At your level (7): resistance 7 to cold; resistance 3 to fire']);
  });

  // batch card premise: heritage-240 "granting you cold resistance equal to half your level (minimum 1)"
  it('a heritage\'s card: Arctic Elf 7 keeps the page\'s "half your level" words and shows ONE ours line "resistance 3 to cold"', async () => {
    const e7 = build('fighter', 7, { ancestryId: 'elf', heritageId: 'arctic-elf' });
    const v = await openCard(e7, db.heritages['arctic-elf'].name);
    // batch card premise: heritage-240 "granting you cold resistance equal to half your level (minimum 1)"
    expect(v.own).toContain('cold resistance equal to half your level (minimum 1)');
    expect(v.own).not.toMatch(/At your level/);
    expect(v.lines.map(txt)).toEqual(['At your level (7): resistance 3 to cold']);
    expect(v.lines[0].closest('.card-ours[data-ours]'), 'the line sits in the ours box').toBeTruthy();
    // batch card premise: heritage-240 "granting you cold resistance equal to half your level (minimum 1)"
    expect(v.lines[0].getAttribute('data-ours-kind')).toBe('atYourLevel');
    v.stop();
    // A level-1 elf: derive's minimum 1.
    expect(rowLines(build('fighter', 1, { ancestryId: 'elf', heritageId: 'arctic-elf' }), 'arctic-elf')).toEqual(['At your level (1): resistance 1 to cold']);
  });

  // batch card premise: innovation-5 "You gain resistance equal to 3 + half your level to acid and electricity damage"
  it('an inventor\'s chosen armour modification row (the only row these records reach): Metallic Reactance 7 at 9, 8 at 10; Dense Plating only while the armour is worn', () => {
    const inventor = (lvl: number, worn: boolean) => {
      const ch = build('inventor', lvl, { subclassId: 'armor-innovation', inventorModifications: { initial: 'metallic-reactance', breakthrough: 'dense-plating' } });
      return (worn ? { ...ch, inventory: [...ch.inventory, { instanceId: 'synth-suit', itemId: 'half-plate', quantity: 1, worn: true }] } : ch) as Character;
    };
    /** The at-level lines on the modification row itself (key `mod:<id>`), not any other row naming the record. */
    const modLines = (ch: Character, id: string) => {
      const e = featEntries(ch, db).find((x) => x.key === `mod:${id}`);
      // batch card premise: innovation-5 "You gain resistance equal to 3 + half your level to acid and electricity damage"
      expect(e, `a modification row for ${id}`).toBeTruthy();
      return (e!.ours ?? []).filter((l) => l.kind === 'atYourLevel').map((l) => l.text);
    };
    const i9 = inventor(9, true);
    const mr = db.classFeatures['metallic-reactance'].name;
    // derive's own credited value, read the way a test reads the engine.
    // batch card premise: innovation-5 "You gain resistance equal to 3 + half your level to acid and electricity damage"
    expect(attributed(i9, 'resistance:acid', mr)).toEqual([{ from: mr, value: 7, applied: true }]);
    expect(modLines(i9, 'metallic-reactance')).toEqual(['At your level (9): resistance 7 to acid, electricity']);
    expect(modLines(inventor(10, true), 'metallic-reactance')).toEqual(['At your level (10): resistance 8 to acid, electricity']);
    // batch card premise: innovation-5 "While wearing your armor, you gain resistance to slashing damage equal to half your level"
    expect(modLines(i9, 'dense-plating')).toEqual(['At your level (9): resistance 4 to slashing']);
    // Armour off: derive withholds Dense Plating, so its row gets no line; Metallic Reactance prints no such gate.
    // batch card premise: innovation-5 "While wearing your armor, you gain resistance to slashing damage equal to half your level"
    expect(modLines(inventor(9, false), 'dense-plating')).toEqual([]);
    expect(modLines(inventor(9, false), 'metallic-reactance')).toEqual(['At your level (9): resistance 7 to acid, electricity']);
  });

  // batch card premise: heritage-240 "granting you cold resistance equal to half your level (minimum 1)"
  it('the levelDefense ledger: every record derive sizes a resistance / weakness by level is listed or deferred; an unlisted one, a deferral that no longer holds and a listed record without such a value each show', () => {
    const t = { classFeatures: treeOf('classFeatures')!, feats: treeOf('feats')!, heritages: treeOf('heritages')! };
    expect(atLevelProblems(db, t)).toEqual([]);
    expect(Object.values(AT_LEVEL).filter((f) => f === 'levelDefense').length).toBe(79);
    // A synthesized feat whose own resistance derive sizes by level, in neither table, is named.
    const synth = { id: 'synthesized-ward', name: 'Synthesized Ward', level: 1, traits: [], description: 'You gain resistance to cold equal to half your level.', resistances: [{ type: 'cold', value: 'floor(@actor.level/2)' }] };
    // batch card premise: heritage-240 "granting you cold resistance equal to half your level (minimum 1)"
    expect(atLevelProblems({ ...db, feats: { ...db.feats, 'synthesized-ward': synth } } as unknown as ContentDatabase, t)).toEqual(['feats:synthesized-ward|derive sizes its resistance / weakness by level, neither listed nor deferred']);
    // A listed record that loses its level-sized value is named.
    const fr = { ...db.feats['fire-resistance'], resistances: [{ type: 'fire', value: 2 }] };
    // batch card premise: feat-2973 "You gain fire resistance equal to half your level"
    expect(atLevelProblems({ ...db, feats: { ...db.feats, 'fire-resistance': fr } } as unknown as ContentDatabase, t)).toEqual(['feats:fire-resistance|listed, but derive sizes none of its resistances / weaknesses by level']);
  });
});
