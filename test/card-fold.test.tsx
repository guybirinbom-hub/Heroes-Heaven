// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { StatDetailModal } from '../src/sheet/StatDetailModal';
import { FeatsTab } from '../src/sheet/FeatsTab';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Card step 13a (docs/card-design.md section 3, section 9 row 13a; owner ruling Q1 = A, section 13):
 * LEVEL FOLDS on the screen. Every case renders the REAL StatDetailModal with a synthesized character
 * (built here with test/_content's build, name 't' — never an owner's character), opens a situational
 * line's "Full text" (the 'mine' card), and reads the card off the DOM:
 *  - the parts the character does not have yet sit under ONE closed, dimmed line "At higher levels (k)"
 *    (a <details>; the folded text stays in the DOM, the line is ours);
 *  - an option the build does not have folds under "Other options (k)";
 *  - an unknown pick is shown; a pointer row shows its subclass section; an applying impulse "Level"
 *    entry is highlighted and nothing is hidden;
 *  - FUTURE_TREATMENT, the one switch: 'hide' leaves only a marker, 'grey' keeps the text in place, dimmed.
 *
 * MUTATION LINES (each measured red on 2026-10-03, then restored byte-exact from a scratch copy):
 *  - StatDetailModal.tsx: `scope={scopeOfCharacter(character)}` removed → the Justice / thaumaturge /
 *    impulse / pointer cases red (no scope, nothing folds).
 *  - AstRenderer.tsx CardFoldEl: `<details className="card-fold" …>` without the summary's `data-ours`
 *    → the "line is ours" assertion red.
 *  - AstRenderer.tsx renderBlock 'p': the `applies` branch removed → the impulse case red.
 *  - AstRenderer.tsx CardFoldEl: the 'hide' branch removed (falls through to the fold) → the hide case
 *    red; the 'grey' branch removed → the grey case red.
 *  - RecordCard.tsx: `withPointer(…)` unwrapped to the scoped tree alone → the pointer case red.
 *
 * Card step 13c (choose-one blocks on the FeatDetail card, opened from the real Feats tab; owner ruling
 * Q2 = A). MUTATION LINES, each measured red on 2026-10-07 in lane hh-lane-13c, restored byte-exact (cmp):
 *  - FeatDetail.tsx FeatCard: the pick passed to withPick → `undefined` → the Iruxi and Dragonet cases red.
 *  - RecordCard.tsx: scopeTree's record key `${cur.key}:${curSlug}` dropped → the same two cases red.
 *  - cardScope.ts scopeChoiceBlock: the picked list item also folded → the Iruxi case red.
 *  - cardScope.ts runFold: pick folds count sections again → the thaumaturge case red ("Other options (3)").
 *  - (fixer round 1) cardScope.ts scopeTree: the class-pick branch → `[]` → the Fencer and kineticist
 *    class-pick cases (StatDetailModal, no row pick) red.
 *  - (fixer round 2) cardScope.ts scopeOfCharacter: kinetic-gate's element picks read every owned element
 *    (not only the single gate's) → the dual-gate case red; classPicksOf: the element picks read on every
 *    classFeatures page → the elemental-eidolon case red.
 *
 * Card step 13b (prose gates on the mine card). MUTATION LINES, each measured red on 2026-10-08 in lane
 * hh-lane-13b, restored byte-exact from a scratch copy (cmp):
 *  - cardScope.ts scopeTree: the fold also takes the block after the gate paragraph → osteo at 7 and the
 *    Feats-tab Osteo Armaments row red.
 *  - cardScope.ts proseVerdict: `>=` → `>` (one level late) → osteo at 8, halfling-weapon-familiarity at 5
 *    and the 13c Iruxi (Claw) row at 5 red.
 *  - cardScope.ts scopeTree: a run-time "At Nth level" regex in place of the ledger hash → the
 *    breath-of-the-dragon case red (a partly gated paragraph folded).
 */
const noop = () => undefined;
const db: ContentDatabase = content();
const BUCKETS = ['feats', 'classFeatures', 'items'] as const;
const trees: Record<string, Record<string, AstNode>> = {};
let astIndex: Record<string, string> = {};

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const b of BUCKETS) trees[b] = JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8'));
  astIndex = JSON.parse(readFileSync('public/ast-index.json', 'utf8'));
  vi.stubGlobal('fetch', async (url: string) => {
    if (/ast-index\.json$/.test(String(url))) return { ok: true, json: async () => astIndex };
    const m = /ast\/(\w+)\.json$/.exec(String(url));
    return m && trees[m[1]] ? { ok: true, json: async () => trees[m[1]] } : { ok: false };
  });
  for (const b of BUCKETS) await loadBucketAst(b);
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

const mounted: (() => void)[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!(); });
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
type Ctx = { Provider: typeof ContentContext.Provider };
async function mount(el: ReactElement, ctx: Ctx = ContentContext): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<ctx.Provider value={db}>{el}</ctx.Provider>); });
  await settle();
  mounted.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}
async function click(el: Element | null | undefined) {
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const squash = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The real StatDetailModal for `ch` with one situational line from `bucket:id`, its Full text opened. */
async function openCard(ch: Character, bucket: string, id: string, Modal: typeof StatDetailModal = StatDetailModal, ctx: Ctx = ContentContext) {
  const breakdown = { title: 'Stat', totalText: '+0', parts: [], timeline: [], situational: [{ text: 'a situational line', sourceId: id, sourceCollection: bucket as never }] };
  const host = await mount(<Modal breakdown={breakdown} character={ch} content={db} onClose={noop} />, ctx);
  await click(host.querySelector('.sd-sit-more'));
  const modal = host.querySelector('.ast-modal.card-mine') as HTMLElement | null;
  expect(modal, `${bucket}:${id} opens the mine card, page lane`).toBeTruthy();
  return modal!;
}
/** What a reader sees without opening anything: the card's text with every CLOSED fold's body removed. */
function openText(modal: HTMLElement): string {
  const copy = modal.cloneNode(true) as HTMLElement;
  for (const d of copy.querySelectorAll('details:not([open])')) for (const k of [...d.children]) if (k.tagName !== 'SUMMARY') k.remove();
  return squash(copy.textContent);
}
const folds = (modal: HTMLElement) => [...modal.querySelectorAll('details.card-fold')] as HTMLDetailsElement[];

describe('card step 13a: level folds on the mine card', () => {
  it('a Justice champion at 5: no Relentless Reaction open, ONE closed "At higher levels (2)" line, the text inside it', async () => {
    const modal = await openCard(build('champion', 5, { subclassId: 'justice' }), 'classFeatures', 'justice');
    const f = folds(modal);
    expect(f.length).toBe(1);
    expect(f[0].open).toBe(false);
    expect(f[0].dataset.fold).toBe('future');
    const line = f[0].querySelector(':scope > summary');
    expect(squash(line?.textContent)).toBe('At higher levels (2)');
    expect(line?.hasAttribute('data-ours'), 'the line is ours, not print').toBe(true);
    expect(openText(modal)).not.toMatch(/Relentless Reaction|Exalted Reaction|persistent spirit damage/);
    // Folded, never deleted: the words are in the DOM, inside the fold.
    expect(squash(f[0].textContent)).toMatch(/Relentless Reaction.*persistent spirit damage.*Exalted Reaction/);
    // The rest of the page stays open.
    expect(openText(modal)).toMatch(/Champion's Reaction/);
  });

  it('the fold opens on a tap (a native <summary>, so the keyboard opens it too) and closes again', async () => {
    const modal = await openCard(build('champion', 5, { subclassId: 'justice' }), 'classFeatures', 'justice');
    const f = folds(modal)[0];
    const line = f.querySelector(':scope > summary') as HTMLElement;
    expect(line.tagName).toBe('SUMMARY');
    await click(line);
    expect(f.open).toBe(true);
    expect(openText(modal)).toMatch(/Relentless Reaction/);
    await click(line);
    expect(f.open).toBe(false);
  });

  it('at 9 Relentless Reaction is open and Exalted Reaction is folded, its text inside the fold', async () => {
    const modal = await openCard(build('champion', 9, { subclassId: 'justice' }), 'classFeatures', 'justice');
    expect(openText(modal)).toMatch(/Relentless Reaction.*persistent spirit damage/);
    expect(openText(modal)).not.toMatch(/Exalted Reaction/);
    const f = folds(modal);
    expect(f.map((d) => squash(d.querySelector(':scope > summary')?.textContent))).toEqual(['At higher levels (1)']);
    expect(squash(f[0].textContent)).toMatch(/Exalted Reaction.*Each ally in your champion.s aura/);
  });

  it('a pointer row: relentless-reaction at 9 shows the Justice cause\'s section; at 5 that section is folded', async () => {
    const m9 = await openCard(build('champion', 9, { subclassId: 'justice' }), 'classFeatures', 'relentless-reaction');
    const ptr = m9.querySelector('.card-pointer[data-pointer="classFeatures:justice"]');
    expect(ptr, 'the subclass section is drawn').toBeTruthy();
    expect(squash(ptr!.textContent)).toMatch(/Relentless Reaction.*persistent spirit damage/);
    expect(ptr!.closest('details'), 'open at 9').toBeNull();
    const m5 = await openCard(build('champion', 5, { subclassId: 'justice' }), 'classFeatures', 'relentless-reaction');
    const ptr5 = m5.querySelector('.card-pointer');
    expect(ptr5?.closest('details.card-fold:not([open])'), 'folded at 5').toBeTruthy();
  });

  it('a thaumaturge 11 with one implement at adept: only the owned Adept open; another implement\'s benefits fold as other options', async () => {
    const ch = build('thaumaturge', 11, { extraChoices: { implement: ['amulet'] } });
    const amulet = await openCard(ch, 'classFeatures', 'amulet');
    expect(openText(amulet)).toMatch(/Adept Benefit.*Intensify Benefit/);
    expect(openText(amulet)).not.toMatch(/Paragon Benefit/);
    expect(folds(amulet).map((d) => [d.dataset.fold, squash(d.querySelector(':scope > summary')?.textContent)])).toEqual([['future', 'At higher levels (1)']]);
    const bell = await openCard(ch, 'classFeatures', 'bell');
    expect(openText(bell)).not.toMatch(/Adept Benefit|Paragon Benefit|Intensify Benefit/);
    const f = folds(bell);
    // Card step 13c: the line counts OPTIONS — the bell's three benefits are ONE other implement.
    // batch card premise: implement-18 "Your bell resonates powerfully, causing the effect to last longer"
    expect(f.map((d) => [d.dataset.fold, squash(d.querySelector(':scope > summary')?.textContent)])).toEqual([['pick', 'Other options (1)']]);
    expect(squash(f[0].textContent)).toMatch(/Adept Benefit.*Intensify Benefit.*Paragon Benefit/);
  });

  it('an unknown pick is shown: a thaumaturge 11 with no implement on record sees the adept benefit open', async () => {
    const bell = await openCard(build('thaumaturge', 11, { extraChoices: {} }), 'classFeatures', 'bell');
    expect(openText(bell)).toMatch(/Adept Benefit.*Intensify Benefit/);
    expect(folds(bell).map((d) => squash(d.querySelector(':scope > summary')?.textContent))).toEqual(['At higher levels (1)']);
  });

  it('a kineticist impulse: the applying "Level (+2)" entry is highlighted and nothing is hidden', async () => {
    const at3 = await openCard(build('kineticist', 3, { extraChoices: { element: ['air-gate'] } }), 'feats', 'aerial-boomerang');
    const hi = [...at3.querySelectorAll('.card-applies')];
    expect(hi.map((p) => squash(p.textContent))).toEqual(['Level (+2) The damage increases by 1d4.']);
    expect(hi[0].closest('[data-ours]'), 'the highlight is a class on the page\'s own paragraph').toBeNull();
    expect(at3.querySelector('[data-fold]'), 'an impulse folds nothing').toBeNull();
    const at2 = await openCard(build('kineticist', 2, { extraChoices: { element: ['air-gate'] } }), 'feats', 'aerial-boomerang');
    expect(at2.querySelector('.card-applies')).toBeNull();
    expect(openText(at2)).toMatch(/Level \(\+2\) The damage increases by 1d4\./);
  });
});

/** A synthesized character (test/_content build, name 't') holding one feat with its choice answered. */
function withPickedFeat(featId: string, label: string): Character {
  const ch = build('fighter', 5, {});
  return { ...ch, feats: [{ featId, level: 1, category: 'ancestry', choice: { value: label.toLowerCase(), label } }] } as Character;
}
/** The real Feats tab for `ch`, its row `name` opened: the FeatDetail 'mine' card, page lane. */
async function openFeatRow(ch: Character, name: string): Promise<HTMLElement> {
  const host = await mount(<FeatsTab character={ch} content={db} />);
  const row = [...host.querySelectorAll('.ff-row')].find((r) => squash(r.querySelector('.ff-name')?.textContent) === name);
  expect(row, `the Feats tab lists ${name}`).toBeTruthy();
  await click(row);
  const modal = host.querySelector('.ast-modal.card-mine') as HTMLElement | null;
  expect(modal, `${name} opens the mine card, page lane`).toBeTruthy();
  return modal!;
}

describe('card step 13c: choose-one blocks on the FeatDetail card (owner ruling Q2 = A)', () => {
  it('Iruxi Armaments (Claw): Claws open and highlighted; Fangs and Tail under ONE closed "Other options (2)" line', async () => {
    const modal = await openFeatRow(withPickedFeat('iruxi-armaments', 'Claw'), 'Iruxi Armaments (Claw)');
    const hi = [...modal.querySelectorAll('.card-applies')];
    expect(hi.map((p) => squash(p.textContent))).toEqual(['Claws Your claw attack deals 1d6 slashing damage instead of 1d4 and gains the versatile P trait.']);
    expect(hi[0].closest('li'), 'the highlight sits on the list item the page prints').toBeTruthy();
    expect(hi[0].closest('details'), 'the picked option is never folded').toBeNull();
    const f = folds(modal);
    expect(f.map((d) => [d.dataset.fold, d.open, squash(d.querySelector(':scope > summary')?.textContent)])).toEqual([['pick', false, 'Other options (2)']]);
    expect(f[0].querySelector(':scope > summary')?.hasAttribute('data-ours'), 'the line is ours').toBe(true);
    // Folded, never deleted: the other options are in the DOM, inside the fold, still a list.
    expect([...f[0].querySelectorAll('li')].map((li) => squash(li.textContent).split(' ')[0])).toEqual(['Fangs', 'Tail']);
    expect(openText(modal)).not.toMatch(/Fangs You gain|Tail You gain/);
    expect(openText(modal)).toMatch(/Choose one of the following options: Claws Your claw attack/);
    expect(openText(modal)).toMatch(/At 5th level, whenever you get a critical hit/);
  });

  it('a pick whose label holds its own parentheses (the row reads "Dragonet Breath (Fey Dragonet (arcane, poison))") still names its option', async () => {
    const modal = await openFeatRow(withPickedFeat('dragonet-breath', 'Fey Dragonet (arcane, poison)'), 'Dragonet Breath (Fey Dragonet (arcane, poison))');
    expect([...modal.querySelectorAll('.card-applies')].map((p) => squash(p.textContent).split(' ').slice(0, 2).join(' '))).toEqual(['Fey Dragonet']);
    expect(folds(modal).map((d) => squash(d.querySelector(':scope > summary')?.textContent))).toEqual(['Other options (4)']);
  });

  it('dragon-disciple-dedication: a pick the page prints only in a group falls back to the whole text — no fold, no highlight', async () => {
    const modal = await openFeatRow(withPickedFeat('dragon-disciple-dedication', 'Red (fire)'), 'Dragon Disciple Dedication (Red (fire))');
    expect(folds(modal)).toEqual([]);
    expect(modal.querySelector('.card-applies')).toBeNull();
    expect(openText(modal)).toMatch(/Black, Brine\*, or Copper Acid.*Brass, Gold, Magma\*, Red, or Underworld\* Fire.*Silver or White Cold/);
  });
});

describe('card step 13c: class picks on a classFeatures card (StatDetailModal, no row pick)', () => {
  it('a Fencer swashbuckler: exemplary-finisher shows Fencer open and highlighted, the five other styles under "Other options (5)"', async () => {
    const modal = await openCard(build('swashbuckler', 9, { subclassId: 'fencer' }), 'classFeatures', 'exemplary-finisher');
    const hi = [...modal.querySelectorAll('.card-applies')];
    expect(hi.map((p) => squash(p.textContent).split(' ')[0])).toEqual(['Fencer:']);
    expect(hi[0].closest('details'), 'the picked style is never folded').toBeNull();
    const f = folds(modal);
    expect(f.map((d) => [d.dataset.fold, d.open, squash(d.querySelector(':scope > summary')?.textContent)])).toEqual([['pick', false, 'Other options (5)']]);
    expect(squash(f[0].textContent)).toMatch(/Battledancer.*Braggart.*Gymnast.*Rascal.*Wit/);
    expect(openText(modal)).not.toMatch(/Battledancer:|Braggart:|Gymnast:|Rascal:|Wit:/);
  });

  it('a single-gate air kineticist: kinetic-gate shows Air\'s impulse junction highlighted, the other five under ONE line', async () => {
    // batch card premise: class-feature-596 "In addition, you gain an impulse junction"
    const modal = await openCard(build('kineticist', 5, { extraChoices: { element: ['air-gate'] } }), 'classFeatures', 'kinetic-gate');
    expect([...modal.querySelectorAll('.card-applies')].map((p) => squash(p.textContent).split(' ')[0])).toEqual(['Air']);
    expect(folds(modal).map((d) => squash(d.querySelector(':scope > summary')?.textContent))).toEqual(['Other options (5)']);
  });

  it('an air + fire DUAL-gate kineticist: kinetic-gate whole (no junction owned); elemental-blast shows both blasts, the other four under ONE line', async () => {
    // batch card premise: class-feature-596 "In addition, you gain an impulse junction" (printed under Single Gate only)
    const ch = build('kineticist', 1, { extraChoices: { element: ['air-gate', 'fire-gate'] } });
    const gate = await openCard(ch, 'classFeatures', 'kinetic-gate');
    expect(folds(gate)).toEqual([]);
    expect(gate.querySelector('.card-applies')).toBeNull();
    // batch card premise: action-2125 "Choose one of your kinetic elements"
    const blast = await openCard(ch, 'classFeatures', 'elemental-blast');
    expect([...blast.querySelectorAll('.card-applies')].map((p) => squash(p.textContent).split(' ')[0])).toEqual(['Air', 'Fire']);
    expect(folds(blast).map((d) => squash(d.querySelector(':scope > summary')?.textContent))).toEqual(['Other options (4)']);
  });

  it('a kineticist opening elemental-eidolon (another class\'s Air … Wood) sees it whole', async () => {
    // batch card premise: eidolon-12 "Your eidolon is formed from elemental air"
    const modal = await openCard(build('kineticist', 5, { extraChoices: { element: ['air-gate'] } }), 'classFeatures', 'elemental-eidolon');
    expect(folds(modal).filter((d) => d.dataset.fold === 'pick')).toEqual([]); // (its level folds, step 13a, are another matter)
    expect(openText(modal)).toMatch(/Air: Your eidolon is formed from elemental air.*Fire: Your eidolon is formed from elemental fire/);
    expect(modal.querySelector('.card-applies')).toBeNull();
  });

  it('a swashbuckler with no style on record sees exemplary-finisher whole', async () => {
    const ch = build('swashbuckler', 9, { subclassId: 'fencer' });
    const modal = await openCard({ ...ch, subclassId: null, classChoices: [] } as Character, 'classFeatures', 'exemplary-finisher');
    expect(folds(modal)).toEqual([]);
    expect(modal.querySelector('.card-applies')).toBeNull();
  });
});

/** A synthesized character (test/_content build, name 't') at `level` holding one feat with no choice. */
function withFeat(featId: string, level: number): Character {
  const ch = build('fighter', level, {});
  return { ...ch, feats: [{ featId, level: 1, category: 'class' }] } as Character;
}

describe('card step 13b: prose gates fold WHOLE on the mine card', () => {
  // batch card premise: feat-9110 "If you do, the action gains the thrall trait"
  it('osteo-armaments at 7: ONE closed "At higher levels (2)" line holds both gated paragraphs; no orphan "If you do" is open', async () => {
    const modal = await openCard(build('fighter', 7, {}), 'feats', 'osteo-armaments');
    const f = folds(modal);
    expect(f.map((d) => [d.dataset.fold, d.open, squash(d.querySelector(':scope > summary')?.textContent)])).toEqual([['future', false, 'At higher levels (2)']]);
    expect(f[0].querySelector(':scope > summary')?.hasAttribute('data-ours'), 'the line is ours').toBe(true);
    expect(squash(f[0].textContent)).toMatch(/At 8th level, you can destroy an adjacent thrall as part of using this action\. If you do, the action gains the thrall trait.*At 10th level, the weapon improves to a \+2 striking weapon/);
    expect(openText(modal)).not.toMatch(/If you do|At 8th level|At 10th level/);
    expect(openText(modal)).toMatch(/whichever comes first\./);
  });
  it('osteo-armaments at 8: the 8th-level paragraph is open whole, "If you do" with it; only the 10th-level one folds', async () => {
    const modal = await openCard(build('fighter', 8, {}), 'feats', 'osteo-armaments');
    expect(openText(modal)).toMatch(/At 8th level, you can destroy an adjacent thrall as part of using this action\. If you do, the action gains the thrall trait/);
    expect(openText(modal)).not.toMatch(/At 10th level/);
    expect(folds(modal).map((d) => squash(d.querySelector(':scope > summary')?.textContent))).toEqual(['At higher levels (1)']);
  });
  it('a hand-checked ancestry feat: halfling-weapon-familiarity folds its 5th-level paragraph at 4 and shows it at 5', async () => {
    // batch card premise: feat-4459 "At 5th level, whenever you get a critical hit with one of these weapons"
    const m4 = await openCard(build('fighter', 4, {}), 'feats', 'halfling-weapon-familiarity');
    expect(folds(m4).map((d) => squash(d.querySelector(':scope > summary')?.textContent))).toEqual(['At higher levels (1)']);
    expect(openText(m4)).not.toMatch(/critical specialization/);
    expect(openText(m4)).toMatch(/You favor traditional halfling weapons/);
    const m5 = await openCard(build('fighter', 5, {}), 'feats', 'halfling-weapon-familiarity');
    expect(folds(m5)).toEqual([]);
    expect(openText(m5)).toMatch(/At 5th level, whenever you get a critical hit with one of these weapons, you get its critical specialization effect\./);
  });
  it('a partly gated paragraph is never folded: breath-of-the-dragon at 1 shows its 3rd-level paragraph whole (the breath\'s shape and save are level-1 rules)', async () => {
    const modal = await openCard(build('fighter', 1, {}), 'feats', 'breath-of-the-dragon');
    expect(folds(modal)).toEqual([]);
    expect(openText(modal)).toMatch(/At 3rd level and every 2 levels thereafter, the damage increases by 1d4\. The shape of the breath, the damage type, and the saving throw match/);
  });
});

describe('card step 13b: the sheet\'s own feat row (FeatsTab → FeatDetail card)', () => {
  it('a level-7 character\'s Osteo Armaments row folds both gated paragraphs under one line', async () => {
    const modal = await openFeatRow(withFeat('osteo-armaments', 7), 'Osteo Armaments');
    expect(folds(modal).map((d) => [d.dataset.fold, squash(d.querySelector(':scope > summary')?.textContent)])).toEqual([['future', 'At higher levels (2)']]);
    expect(openText(modal)).not.toMatch(/If you do/);
  });
});

/** The same Justice-at-5 card with FUTURE_TREATMENT switched — a fresh module graph with the constant
 *  mocked, so the switch is proved to be the ONE constant every part reads. */
async function justiceAt5With(treatment: 'hide' | 'grey') {
  vi.resetModules();
  vi.doMock('../src/sheet/cardScope', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/sheet/cardScope')>()), FUTURE_TREATMENT: treatment }));
  try {
    const { StatDetailModal: Modal } = await import('../src/sheet/StatDetailModal');
    const { ContentContext: Fresh } = await import('../src/sheet/ContentContext');
    const store = await import('../src/sheet/astStore');
    for (const b of BUCKETS) await store.loadBucketAst(b);
    return await openCard(build('champion', 5, { subclassId: 'justice' }), 'classFeatures', 'justice', Modal, Fresh);
  } finally {
    vi.doUnmock('../src/sheet/cardScope');
  }
}

describe('card step 13a: FUTURE_TREATMENT is the one switch', () => {
  it('"hide" removes the folded text from the DOM and leaves only a marker', async () => {
    const modal = await justiceAt5With('hide');
    expect(folds(modal)).toEqual([]);
    expect(squash(modal.textContent)).not.toMatch(/Relentless Reaction|Exalted Reaction|persistent spirit damage/);
    const marker = modal.querySelector('[data-fold="future"]') as HTMLElement | null;
    expect(marker, 'a marker stays where the run was').toBeTruthy();
    expect(marker!.hidden).toBe(true);
    expect(squash(marker!.textContent)).toBe('');
    expect(squash(modal.textContent)).toMatch(/Champion's Reaction/);
  });

  it('"grey" keeps the text in place, dimmed', async () => {
    const modal = await justiceAt5With('grey');
    expect(folds(modal)).toEqual([]);
    const grey = modal.querySelector('.card-fold-grey.card-dim[data-fold="future"]');
    expect(grey, 'the run is drawn dimmed').toBeTruthy();
    expect(squash(grey!.textContent)).toMatch(/Relentless Reaction.*persistent spirit damage.*Exalted Reaction/);
    expect(openText(modal)).toMatch(/Relentless Reaction/);
  });
});
