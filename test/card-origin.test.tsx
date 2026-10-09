// @vitest-environment jsdom
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';
import { Builder } from '../src/builder/Builder';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { descId } from '../src/rules/play';
import type { PinnedDesc } from '../src/rules/types';
import { loadAstIndex, type AstNode } from '../src/sheet/astStore';
import { RecordCard } from '../src/sheet/RecordCard';
import { MultiPickRows, OriginPickers, PopupSelect, choiceOptionRecord, openOptionsWithRecords, type BuilderActions } from '../src/builder/shared';
import { emptyBuild, type BuildState } from '../src/rules/build';
import type { ContentDatabase, FeatChoiceDef } from '../src/rules/types';

/**
 * Card step 7b (docs/card-design.md section 9 row 7b; section 2 rule 2b "The builder's fake `origin`
 * bucket … becomes the real bucket. Every origin popup falls back today"; section 6: the builder's
 * picking screens are BROWSE — the whole page).
 *
 * Every builder picker option that names a record now says which one (`record: { bucket, id }`,
 * shared.tsx optionNode), so its description popup opens that record's own Archives page by bucket and
 * id. Before, the Background picker, every subclass / extra-choice / feat / spell PopupSelect and the
 * MultiPickRows opened as `key: 'origin'` (or a group name such as "Elements"): the card asked for
 * `ast/origin.json`, got a 404, and showed the old imported text.
 *
 * The pickers are rendered through the REAL OriginPickers (the level-0 origins page), never a bare
 * SearchSelect, so a call site that stops naming its record turns this red. The fetch stub records
 * every URL the popups ask for; the bucket cache lives per test file, so the origin-keyed case (the
 * option that is no record) runs LAST and the earlier cases see a cold cache.
 *
 * Every build is synthesized (name 't'); the homebrew background is synthesized too.
 *
 * MUTATION LINES (each measured red on 2026-10-06, then restored; shared.tsx sha1 checked each time):
 *  - shared.tsx Background option: `record: { bucket: 'backgrounds', id: b.id }` deleted → 3 red: the
 *    filled value and the row fell back to the old text (no page), and the popups had asked for
 *    /ast/origin.json.gz (the cumulative origin check in the Ancestry/Class/Deity case).
 *  - shared.tsx optionNode: `o.record ?` → `o.record && false ?` → 4 red: background value, background
 *    row, the subclass (Cloistered Cleric fell back) and the multi-pick row.
 *  - shared.tsx choiceOptionRecord: the `aon-` strip → `const id = value;` → the helper case red.
 *  - shared.tsx OptionDescModal: `… || root.key === legacyKey) return outer;` → `… || true) return outer;`
 *    → the never-overwrite case red (the old {key: 'origin'} pin read as not pinned).
 *
 * THE STANDING GUARD over every other call site (refuter round 1: PopupSelect keeps `record` optional
 * because CharacterSheet.tsx passes bare text, so tsc alone cannot catch a builder site that drops it):
 *  - the static scan below fails on any option-shaped literal in Builder.tsx / shared.tsx that carries a
 *    `description` and no `record`, and on any `record: null` not on its reasoned list;
 *  - two cases render through the real Builder: the level page's subclass card (Builder.tsx's own
 *    PopupSelect) and a picked feat's choice (pickerOption, shared by the slot and granted paths).
 * Mutations measured red on 2026-10-06, each restored (file sha1 compared):
 *  - Builder.tsx level-page subclass `, record: { bucket: 'classFeatures', id: o.id }` deleted → the scan
 *    and the level-page subclass case red.
 *  - Builder.tsx pickerOption `record,` → `record: null,` → the scan (an unlisted `record: null`) and the
 *    Basic Lesson case red.
 *  - shared.tsx Mythic Calling `, record: { bucket: 'classFeatures', id: f.id }` deleted → the scan red.
 *  - shared.tsx background embedded sub-choice `record: choiceOptionRecord(…)` deleted → the scan red.
 * THE BUCKET GUARD (refuter round 2: a present `record` naming the fake bucket passed everything).
 * Mutations measured red on 2026-10-06, tsc exit 0 each time, each restored (shared.tsx sha1 9e476c51):
 *  - shared.tsx runesmith rune `record: { bucket: 'runesmithRune', … }` → `bucket: 'origin'`, and
 *    OPEN_SOURCE_BUCKET `'own-item': 'items'` → `'item'` → the bucket-file case red, naming both by line.
 *  - shared.tsx openOptionsWithRecords `{ bucket, id }` → `{ bucket: bucket ?? 'origin', id }` → the
 *    dynamic-bucket list case red.
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
/** Every URL the popups requested, in order. */
const requested: string[] = [];

async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement, cdb: ContentDatabase = db, pin: PinDescApi | null = null): Promise<{ host: HTMLElement; stop: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={cdb}><PinContext.Provider value={pin}>{el}</PinContext.Provider></ContentContext.Provider>);
  });
  await settle();
  return { host, stop: () => { act(() => root.unmount()); host.remove(); } };
}
async function click(el: Element | null | undefined) {
  // batch card: #card-NOT-VACUOUS — the case measures something
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The popup's page body (the browse card's page lane), or null when it fell back. */
const pageText = (host: Element) => {
  const body = host.querySelector('.ast-modal .ast-body');
  return body ? txt(body) : null;
};
/** The browse card for {bucket, id}: the record's own page, the truth the picker popup must equal. */
async function browseText(bucket: string, id: string): Promise<string | null> {
  const m = await mount(<RecordCard record={{ bucket, id }} mode="browse" chrome="popup" onExit={noop} />);
  const t = pageText(m.host);
  m.stop();
  return t;
}
const originRequests = () => requested.filter((u) => /ast\/origin\.json/.test(u));

/** Every BuilderActions method a no-op: these cases only read popups. */
const actions = new Proxy({}, { get: () => noop }) as unknown as BuilderActions;
const DEITY = Object.keys(db.deities).filter((d) => treeOf('deities')?.[d]).sort()[0];
const SUBCLASS_CARD = db.classes.cleric.subclass!.name;
/** A synthesized level-1 cloistered cleric: every origin card filled. */
const cleric = (over: Partial<BuildState> = {}): BuildState =>
  ({ ...emptyBuild(), name: 't', level: 1, ancestryId: 'human', backgroundId: 'acolyte', classId: 'cleric', subclassId: 'cloistered-cleric', deityId: DEITY, ...over }) as BuildState;

/** Open the popup of a filled origin card (its value is the read-first button) and read it. */
async function filledPopup(card: string, build: BuildState, cdb: ContentDatabase = db) {
  const m = await mount(<OriginPickers build={build} actions={actions} content={cdb} />, cdb);
  const before = requested.length;
  await click(m.host.querySelector(`[data-setupcard="${card}"] .ss-filled-body`));
  const out = { page: pageText(m.host), all: txt(m.host.querySelector('.ast-modal, .picker.info-modal')), urls: requested.slice(before) };
  m.stop();
  return out;
}

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = noop;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    requested.push(u);
    if (/ast-index\.json$/.test(u)) return { ok: true, json: async () => astIndex };
    const m = /ast\/(\w+)\.json$/.exec(u);
    const t = m ? treeOf(m[1]) : undefined;
    return t ? { ok: true, json: async () => t } : { ok: false };
  });
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  await loadAstIndex();
}, 300_000);
afterAll(() => { vi.unstubAllGlobals(); });

describe('card step 7b: a builder origin popup opens the record\'s own page, by its real bucket', () => {
  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('Background (Acolyte): the filled value opens the backgrounds page — no request for ast/origin.json (T3)', async () => {
    const own = await browseText('backgrounds', 'acolyte');
    expect(own, 'Acolyte has a page').toBeTruthy();
    const p = await filledPopup('Background', cleric());
    expect(p.page, 'the popup draws the Archives page, not the old text').toBe(own);
    expect(p.urls.filter((u) => /ast\/origin\.json/.test(u))).toEqual([]);
  });

  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('Background: a row in the open picker opens THAT background\'s page (the first listed one with a unique name)', async () => {
    const m = await mount(<OriginPickers build={cleric()} actions={actions} content={db} />);
    await click(m.host.querySelector('[data-setupcard="Background"] .ss-replace'));
    const named = (n: string) => Object.values(db.backgrounds).filter((b) => b.name === n);
    const row = [...m.host.querySelectorAll('.pick-row')].find((r) => {
      const hits = named(txt(r.querySelector('.picker-name')));
      return hits.length === 1 && hits[0].id !== 'acolyte' && !!treeOf('backgrounds')?.[hits[0].id];
    });
    // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
    expect(row, 'the open picker lists a background with a page').toBeTruthy();
    const id = named(txt(row!.querySelector('.picker-name')))[0].id;
    await click(row!.querySelector('.pick-body'));
    const shown = pageText(m.host);
    m.stop();
    expect(shown, `${id}: the row opens its own page`).toBe(await browseText('backgrounds', id));
  });

  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('Ancestry, Class, Deity and the subclass (Cloistered Cleric) each open their own page', async () => {
    const cases: [string, string, string][] = [
      ['Ancestry', 'ancestries', 'human'],
      ['Class', 'classes', 'cleric'],
      ['Deity', 'deities', DEITY],
      [SUBCLASS_CARD, 'classFeatures', 'cloistered-cleric'],
    ];
    for (const [card, bucket, id] of cases) {
      const own = await browseText(bucket, id);
      // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
      expect(own, `${bucket}:${id} has a page`).toBeTruthy();
      const p = await filledPopup(card, cleric());
      expect(p.page, `${card}: the popup is ${bucket}:${id}'s page`).toBe(own);
    }
    expect(originRequests(), 'no origin popup so far asked for the bucket that does not exist').toEqual([]);
  });

  // batch card: #card-PIN — a pin reopens the record it was made from
  it('never-overwrite: a Background pinned before 7b ({key: "origin"}) shows pinned and its star removes THAT pin; a new pin stores the real bucket', async () => {
    const acolyte = db.backgrounds.acolyte;
    // Shaped like the Builder's pin API (Builder.tsx pinApi: descId match over build.pinnedDescs).
    const state: { list: PinnedDesc[] } = { list: [{ title: acolyte.name, description: acolyte.description ?? '', key: 'origin' }] };
    const pin: PinDescApi = {
      has: (n) => state.list.some((d) => descId(d) === descId(n)),
      toggle: (n) => {
        const id = descId(n);
        state.list = state.list.some((d) => descId(d) === id) ? state.list.filter((d) => descId(d) !== id) : [...state.list, { title: n.title, description: n.description, descRefs: n.descRefs, key: n.key }];
      },
    };
    const m = await mount(<OriginPickers build={cleric()} actions={actions} content={db} />, db, pin);
    await click(m.host.querySelector('[data-setupcard="Background"] .ss-filled-body'));
    const star = () => m.host.querySelector('.info-star');
    // batch card: #card-PIN — a pin reopens the record it was made from
    expect(star()?.classList.contains('on'), 'the old pin reads as pinned').toBe(true);
    await click(star());
    expect(state.list, 'the old pin was removed, nothing added').toEqual([]);
    await click(star());
    expect(state.list.map((d) => d.key), 'a new pin carries the real bucket').toEqual(['backgrounds']);
    m.stop();
  });

  // batch card: #card-S7 — no page: our text, marked
  it('a homebrew background named like an official one opens its OWN text, never the official page', async () => {
    const hbId = 'hb-card-origin-test';
    const hb = { ...db.backgrounds.acolyte, id: hbId, description: 'Synthetic homebrew background words.', descRefs: undefined, source: { book: 'Homebrew', license: 'homebrew' } };
    const hbDb = { ...db, backgrounds: { ...db.backgrounds, [hbId]: hb } } as unknown as ContentDatabase;
    const p = await filledPopup('Background', cleric({ backgroundId: hbId }), hbDb);
    expect(p.page, 'no page for a homebrew id').toBeNull();
    // batch card: #card-S7 — no page: our text, marked
    expect(p.all).toContain('Synthetic homebrew background words.');
    expect(p.all).not.toContain((await browseText('backgrounds', 'acolyte'))!.slice(0, 60));
  });

  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('a multi-pick option that names its record opens its page, not the group name as a bucket', async () => {
    const id = Object.keys(treeOf('classFeatures')!).filter((k) => db.classFeatures[k]?.description).sort()[0];
    const own = await browseText('classFeatures', id);
    const before = requested.length;
    const m = await mount(<MultiPickRows options={[{ id, name: db.classFeatures[id].name, description: db.classFeatures[id].description, record: { bucket: 'classFeatures', id } }]} selected={[]} max={2} onToggle={noop} keyName="Elements" />);
    await click(m.host.querySelector('.pick-body'));
    // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
    expect(pageText(m.host)).toBe(own);
    expect(requested.slice(before).filter((u) => /ast\/Elements\.json/.test(u))).toEqual([]);
    m.stop();
  });

  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('choiceOptionRecord: open choices by source bucket, ownsFeature by classFeature id (aon- matched bare), inline options none', () => {
    const cf = Object.keys(db.classFeatures).sort()[0];
    expect(choiceOptionRecord({ kind: 'open', from: { type: 'feat' } } as FeatChoiceDef, 'x', db)).toEqual({ bucket: 'feats', id: 'x' });
    expect(choiceOptionRecord({ kind: 'open', from: { type: 'background' } } as FeatChoiceDef, 'acolyte', db)).toEqual({ bucket: 'backgrounds', id: 'acolyte' });
    expect(choiceOptionRecord({ kind: 'open', from: { type: 'language' } } as FeatChoiceDef, 'common', db)).toBeNull();
    expect(choiceOptionRecord({ ownsFeature: true } as FeatChoiceDef, `aon-${cf}`, db)).toEqual({ bucket: 'classFeatures', id: cf });
    // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
    expect(choiceOptionRecord({} as FeatChoiceDef, cf, db)).toBeNull();
    expect(openOptionsWithRecords([{ id: 'acolyte', name: 'Acolyte' }], { type: 'background' })[0].record).toEqual({ bucket: 'backgrounds', id: 'acolyte' });
  });
});

/** Press a level tab of the real Builder (its strip buttons are the bare level numbers). */
async function openLevel(host: HTMLElement, lvl: string) {
  await click([...host.querySelectorAll('button')].find((b) => txt(b) === lvl));
}

describe('card step 7b: through the real Builder, the level page\'s pickers open the record\'s page', () => {
  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('the level page\'s subclass card (Builder.tsx, not the Setup one) opens Cloistered Cleric\'s page', async () => {
    const own = await browseText('classFeatures', 'cloistered-cleric');
    expect(own, 'Cloistered Cleric has a page').toBeTruthy();
    const m = await mount(<Builder content={db} initial={cleric()} onCancel={noop} onCreate={noop} />);
    await openLevel(m.host, '1');
    const before = requested.length;
    await click(m.host.querySelector('.lvl-subsel .ss-filled-body'));
    const shown = pageText(m.host);
    const urls = requested.slice(before);
    m.stop();
    // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
    expect(shown, 'the level-page subclass popup is the Archives page').toBe(own);
    expect(urls.filter((u) => /ast\/origin\.json/.test(u))).toEqual([]);
  });

  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('a picked feat\'s choice (pickerOption): Basic Lesson\'s answer opens that lesson\'s class-feature page', async () => {
    // Basic Lesson (witch 2) is an ownsFeature choice whose answers are `aon-` lesson ids; the page is
    // the classFeature under the bare id (choiceOptionRecord). Synthesized witch, name 't'.
    const answer = 'aon-lesson-of-dreams';
    const own = await browseText('classFeatures', answer.replace(/^aon-/, ''));
    expect(own, 'Lesson of Dreams has a page').toBeTruthy();
    const witch: BuildState = { ...emptyBuild(), name: 't', level: 2, ancestryId: 'human', backgroundId: 'acolyte', classId: 'witch', featPicks: { '2:class:0': 'basic-lesson' }, featChoices: { '2:class:0': answer } } as BuildState;
    const m = await mount(<Builder content={db} initial={witch} onCancel={noop} onCreate={noop} />);
    await openLevel(m.host, '2');
    const card = m.host.querySelector('.lvl-subcard[data-subcard="Basic Lesson"]');
    // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
    expect(card, 'the Basic Lesson choice card is drawn').toBeTruthy();
    const before = requested.length;
    await click(card!.querySelector('.ss-filled-body'));
    const shown = pageText(m.host);
    const urls = requested.slice(before);
    m.stop();
    // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
    expect(shown, 'the feat-choice popup is the lesson\'s Archives page').toBe(own);
    expect(urls.filter((u) => /ast\/origin\.json/.test(u))).toEqual([]);
  });
});

/*
 * THE STATIC GUARD: every option-shaped literal (a `value`/`id`, a `label`/`name` and a `description`)
 * in the builder's two files names its record, or says `record: null` for a reason listed here.
 * PopupSelect's type cannot demand it (CharacterSheet.tsx's effect-choice picker passes bare text), so
 * without this a builder site that loses its `record` falls back to `ast/origin.json` with tsc and every
 * render test green.
 */
const SCANNED = ['src/builder/Builder.tsx', 'src/builder/shared.tsx'];
/** Each `record: null`, by file and its `description` expression, with why it is no record. */
const RECORD_NULL: { file: string; description: string; why: string }[] = [
  { file: 'src/builder/Builder.tsx', description: 'o.note', why: 'an effect-choice note is the option\'s own text' },
  { file: 'src/builder/shared.tsx', description: 'content.classFeatures[`adept-benefit-${id}`]?.description', why: 'the adept-benefit tree is the whole implement page until step 12' },
  { file: 'src/builder/shared.tsx', description: 'content.classFeatures[`paragon-benefit-${id}`]?.description', why: 'the paragon-benefit tree is the whole implement page until step 12' },
  { file: 'src/builder/shared.tsx', description: 'o.note', why: 'an effect-choice note is the option\'s own text' },
];
type ScanHit = { file: string; line: number; props: string[]; description: string; recordNull: boolean; exempt: string | null };
function scanOptionLiterals(): ScanHit[] {
  const out: ScanHit[] = [];
  for (const file of SCANNED) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node) => {
      if (ts.isObjectLiteralExpression(n)) {
        const props = n.properties.map((p) => (p.name ? p.name.getText(sf) : ''));
        const shaped = props.includes('description') && (props.includes('value') || props.includes('id')) && (props.includes('label') || props.includes('name'));
        if (shaped) {
          const prop = (k: string) => n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === k);
          const rec = prop('record');
          const parent = n.parent;
          const exempt =
            ts.isCallExpression(parent) && parent.expression.getText(sf) === 'descNodeOf'
              ? 'builds a description node, offers no option'
              : props.includes('code') && props.includes('role')
                ? 'a campaign membership, no option'
                : null;
          out.push({
            file,
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            props,
            description: prop('description')?.initializer.getText(sf).replace(/\s+/g, ' ') ?? '',
            recordNull: !!rec && rec.initializer.kind === ts.SyntaxKind.NullKeyword,
            exempt,
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/*
 * THE BUCKET GUARD (refuter round 2): a `record` that is present but names a bucket that does not exist
 * — `record: { bucket: 'origin', id }`, the very bug this step removes — passes tsc, the presence scan
 * and every render case. So every bucket the builder's two files WRITE must be a page bucket that ships
 * (`public/ast/<bucket>.json.gz`, the file astStore.ts fetches):
 *  - every `bucket: '<x>'` string in any object literal (each `record: { bucket, id }`, and the
 *    `{ bucket: 'classFeatures', id }` choiceOptionRecord returns);
 *  - every `bucket="<x>"` string on a JSX element (TrustMarker / ChoiceDetails);
 *  - every value of OPEN_SOURCE_BUCKET (the open-choice source → bucket map);
 *  - a `bucket` written as anything but a string literal must be listed in DYNAMIC_BUCKET with the place
 *    its value comes from. A JSX `bucket={expr}` is a prop passed through, not a bucket written here.
 */
/** Each object-literal `bucket` that is not a string literal, by file and its source text. */
const DYNAMIC_BUCKET: { file: string; text: string; why: string }[] = [
  { file: 'src/builder/shared.tsx', text: 'bucket', why: 'choiceOptionRecord: the bucket is an OPEN_SOURCE_BUCKET value (checked below)' },
  { file: 'src/builder/shared.tsx', text: 'bucket', why: 'openOptionsWithRecords: the bucket is an OPEN_SOURCE_BUCKET value (checked below)' },
];
type BucketHit = { file: string; line: number; kind: 'literal' | 'jsx' | 'open-source' | 'dynamic'; value: string };
function scanBuckets(): BucketHit[] {
  const out: BucketHit[] = [];
  for (const file of SCANNED) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const visit = (n: ts.Node) => {
      if (ts.isObjectLiteralExpression(n)) {
        for (const p of n.properties) {
          if (!p.name || p.name.getText(sf) !== 'bucket') continue;
          if (ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer)) out.push({ file, line: at(p), kind: 'literal', value: p.initializer.text });
          else out.push({ file, line: at(p), kind: 'dynamic', value: ts.isPropertyAssignment(p) ? p.initializer.getText(sf) : p.getText(sf) });
        }
      }
      if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'bucket' && n.initializer && ts.isStringLiteral(n.initializer)) {
        out.push({ file, line: at(n), kind: 'jsx', value: n.initializer.text });
      }
      if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'OPEN_SOURCE_BUCKET' && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
        for (const p of n.initializer.properties) {
          // A value that is no string literal is recorded as such, so the existence check below names it.
          const v = ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer) ? p.initializer.text : `<not a string: ${p.getText(sf)}>`;
          out.push({ file, line: at(p), kind: 'open-source', value: v });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

describe('card step 7b: every bucket a builder site names is a page bucket that ships', () => {
  const hits = scanBuckets();
  // batch card: #card-NOT-VACUOUS — the case measures something
  it('the scan sees the builder\'s buckets (it is measuring something)', () => {
    expect(hits.filter((h) => h.kind === 'literal').length).toBeGreaterThan(40);
    expect(hits.filter((h) => h.kind === 'open-source').length, 'OPEN_SOURCE_BUCKET is found and read').toBeGreaterThan(5);
  });
  // batch card: #card-NOT-VACUOUS — the case measures something
  it('the check itself tells a real bucket from the fake one', () => {
    expect(existsSync('public/ast/backgrounds.json.gz')).toBe(true);
    expect(existsSync('public/ast/origin.json.gz')).toBe(false);
  });
  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('every string bucket (object literal, JSX prop, OPEN_SOURCE_BUCKET value) has public/ast/<bucket>.json.gz', () => {
    const bad = hits
      .filter((h) => h.kind !== 'dynamic' && !existsSync(`public/ast/${h.value}.json.gz`))
      .map((h) => `${h.file}:${h.line} ${h.kind} '${h.value}'`);
    expect(bad, 'a bucket with no page file opens no page (the old `origin` 404)').toEqual([]);
  });
  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('every bucket that is no string literal is on the reasoned list, and the list holds no stale entry', () => {
    const found = hits.filter((h) => h.kind === 'dynamic').map((h) => `${h.file} ${h.value}`).sort();
    expect(found).toEqual(DYNAMIC_BUCKET.map((d) => `${d.file} ${d.text}`).sort());
  });
});

describe('card step 7b: no builder option literal can quietly lose its record', () => {
  const hits = scanOptionLiterals();
  // batch card: #card-NOT-VACUOUS — the case measures something
  it('the scan sees the builder\'s option literals (it is measuring something)', () => {
    expect(hits.filter((h) => !h.exempt).length).toBeGreaterThan(40);
  });
  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('every option-shaped literal with a description says `record`', () => {
    const missing = hits.filter((h) => !h.exempt && !h.props.includes('record')).map((h) => `${h.file}:${h.line} {${h.props.join(', ')}}`);
    expect(missing, 'add `record: { bucket, id }` (or `record: null` listed in RECORD_NULL with its reason)').toEqual([]);
  });
  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('every `record: null` is on the reasoned list, and the list holds no stale entry', () => {
    const found = hits.filter((h) => h.recordNull).map((h) => `${h.file} ${h.description}`).sort();
    expect(found).toEqual(RECORD_NULL.map((r) => `${r.file} ${r.description}`).sort());
  });
  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('only the two known non-option literals are exempt', () => {
    expect(hits.filter((h) => h.exempt).map((h) => `${h.file} ${h.exempt}`).sort()).toEqual([
      'src/builder/shared.tsx a campaign membership, no option',
      'src/builder/shared.tsx builds a description node, offers no option',
    ]);
  });
});

/* LAST: this case opens on the 'origin' key on purpose, which caches that bucket for the file. */
describe('card step 7b: an option that is no record keeps its own text', () => {
  // batch card: #card-IDENTITY — resolved by {bucket, id}, never by name
  it('record: null opens the option\'s own words, never a same-named page ("Fire")', async () => {
    const m = await mount(<PopupSelect value="fire" title="t" options={[{ value: 'fire', label: 'Fire', description: 'Synthetic option note words.', record: null }]} onChange={noop} />);
    await click(m.host.querySelector('.ss-filled-body'));
    expect(pageText(m.host), 'no page drawn').toBeNull();
    expect(txt(m.host.querySelector('.picker.info-modal'))).toContain('Synthetic option note words.');
    m.stop();
  });
});
