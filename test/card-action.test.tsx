// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { ActionDetailModal, MainTab, actionOursLines, oursHeaderCost, printedHeaderCost, skillTierLine, type Act } from '../src/sheet/MainTab';
import { variantSection } from '../src/sheet/useAst';
import { recordTree } from '../src/sheet/astVisibility';
import { ACTIVITIES } from '../src/rules/actions';
import { isActionCost } from '../src/sheet/widgets';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { markNote, recordMarkersFor } from '../src/rules/explain';
import type { PlayState, PlayUpdater } from '../src/rules/play';
import type { BuildState } from '../src/rules/build';
import type { Character, ContentDatabase, ModeDef } from '../src/rules/types';
import { ModesPanel } from '../src/sheet/ModesPanel';

/**
 * Card step 9 (docs/card-design.md section 9 row 9, F1b; section 2 rules 4–5; section 4; owner rulings
 * section 13): the Main-tab action popup is the record's 'mine' card. (Card step 22 removed the switch
 * and the legacy popup; its turned-back case left with them.)
 *
 * Every action that names its record — curated activities (their content.actions / feat record), feat,
 * class-feature and granted actions, Commander tactics, runesmith runes — opens RecordCard mode 'mine'
 * for that record: the page's use lines (Trigger, Requirements, Frequency, Cost …) once each, in page
 * order, at full weight (this popup prints no stat rows: its printed set is empty), S-furniture dropped,
 * Source dimmed. The header keeps the page's printed glyph untouched; where it is not the chip's cost (the
 * MARKED cost where a record marker changes it) our glyph, marked data-ours, joins it. The header carries
 * the skill label, the prepare toggle and the action pin before Back / PinStar / close, on the action's
 * own page only (a page opened from a link inside the card is a browse card). The
 * ours box holds the marker notes (`actionMark`) and the skill-rank line (`skillTier`). Feat actions
 * left the markdown lane: Halfling Luck reads the same use lines here and in the search popup.
 *
 * Every character is synthesized through build() (name 't'); none is the owner's. Page trees: the
 * tracked public/ast buckets are served through a fetch stub and the caches warmed before any render,
 * the state the app is in once the buckets have loaded.
 *
 * MUTATION LINES (each measured red on 2026-10-06, then restored byte-exact from a scratch copy, sha1
 * checked):
 *  - MainTab.tsx ActionCard: `ours={[]}` → the Quick Jump, Black Powder Boost and trained Treat Wounds
 *    cases red (and card-strike-action's two mark cases).
 *  - MainTab.tsx featActions: `record: undefined && actionRecordOf(…)` (feat actions back on the
 *    markdown popup) → Shield Block, Halfling Luck, Rise Up! and the action-star cases red (and
 *    card-parity's agreement test).
 *  - RecordCard.tsx no-page lane: the controls slot never drawn → the no-page case red.
 *  - MainTab.tsx skillTierLine: the base-DC fallback removed → trained Treat Wounds and skillTierLine red.
 *  - MainTab.tsx ActionCard: the prepare toggle dropped from headerActions → the tactic case red (and two
 *    card-action-hoist cases).
 *  - MainTab.tsx ActionCard: our glyph only on the no-page lane (`{noPage &&`, not `{!page &&`) →
 *    skill-action-cost-assurance's Actions-list case red (a card whose page has not loaded showed no cost).
 *  - scripts/lib/card-scope.mjs: `actCard` forced undefined (the ledger models the legacy popup) →
 *    card-parity red (44 disagreements; 48 sample rows differ from the baseline) and card-truth-check
 *    red (S1-MISSING 10,462 vs baseline 8,724).
 *  - (card step 22, measured red then restored byte-exact) MainTab.tsx ActionDetailModal: a no-record
 *    action named Aid routed to ActionCard → the "never draws that page" case red.
 *
 * Fixer round 1 (refuter findings):
 *  - The chip's cost is always in the card header: 36 of 2,641 action pages print no title glyph (Flurry
 *    of Blows, Cast a Spell, Signature Weapon …) and the card showed no cost at all.
 *  - The runesmith rune and the camping activity cases (each removal of their record was green before).
 *  - The card block ran only while the switch was on (until card step 22 removed it); the cases true in
 *    both positions ran always.
 *  MUTATION LINES (measured red on 2026-10-06, restored from a scratch copy, sha1 matched):
 *  - runeActs without `record` → the rune case red (alone).
 *  - runeActs AND campingActs without `record` → the rune, camping and sweep cases red.
 *
 * Fixer round 2 (refuter findings):
 *  - The page's printed title glyph is never rewritten, added or removed (round 1 rewrote it to the stored
 *    cost: Sheltering Hand's printed "One Action to Two Actions" read ◆, Pick a Lock's printed ◆◆ was
 *    deleted, 35 glyphs were inserted into titles that print none — all unmarked, passing for print).
 *    Where the page's header does not print the chip's cost, OUR glyph (.card-ours-cost[data-ours]) joins
 *    it (oursHeaderCost). Guarded by the sweep (every chip: the chip's cost shows exactly once as print or
 *    as ours, ours always marked, never ours beside an equal print), the all-records check (the printed
 *    glyph in the tree is what the header reads; the records where print and the stored cost disagree are
 *    pinned by name), and the Quick Jump / Leap / no-glyph cases.
 *  - The header actions (our glyph, skill label, prepare toggle, action pin) stay on the action's own
 *    page: a page opened from a link inside the card is a browse card (section 6) and carries none.
 *  MUTATION LINES (measured red on 2026-10-06, restored from a scratch copy, sha1 matched):
 *  - RecordCard `{stack.length === 1 ? headerActions : null}` → `{headerActions}` → both linked-page
 *    cases red (2 of 23).
 *  - oursHeaderCost always false → Quick Jump, Flurry of Blows, no-page, sweep, all-records and both
 *    unit cases red (7 of 23).
 *  - oursHeaderCost always true → Aid, plain High Jump, Leap, sweep, all-records and both unit cases red
 *    (7 of 23).
 *  - ActionCard's glyph without `data-ours` → Quick Jump, Flurry of Blows and the sweep red (3 of 23).
 *
 * Fixer round 3 (refuter round 2):
 *  - skillTierLine shows the HIGHEST tier the rank unlocks: master and legendary Treat Wounds cases
 *    (DC 30 / DC 40, never the expert DC 20 line). The expert case alone could not tell first from last.
 *  - RecordCard's FALLBACK branch (a linked record whose page did not load) carries no headerActions
 *    either, like the page and loading branches.
 *  MUTATION LINES (measured red on 2026-10-06, restored from a scratch copy, sha1 matched):
 *  - skillTierLine `unlocked[unlocked.length - 1]` → `unlocked[0]` → the master/legendary case red
 *    (1 of 25).
 *  - RecordCard fallback `{stack.length === 1 ? headerActions : null}` → `{headerActions}` → the
 *    fallback-link case red (1 of 25).
 *  LEFT AS IS, by decision (not defects of this step):
 *  - The action card's header holds two star buttons side by side: the action's "Pin to top" (PinToggle,
 *    pins the action to the Pinned card) and the record's favorite PinStar (adds the page to Pinned
 *    descriptions). They are different features; the step-21 browser pass decides how they look.
 *  - test/skill-action-cost-assurance.test.tsx sees only the card's loading state (its file serves no
 *    page buckets), so it proves the cost glyph there, not on a loaded page — the sweep below does that.
 *  - DATA QUESTION FOR THE OWNER: 12 records whose stored action cost is not the cost their page prints;
 *    the card shows both (the page's print untouched, our marked glyph beside it) until the data is
 *    settled: actions:pick-a-lock, classFeatures:act-together, classFeatures:drain-life,
 *    classFeatures:for-talmandor-for-freedom, classFeatures:shadows-in-the-moonlight, feats:aon-dad-joke,
 *    feats:body-of-air, feats:bullet-and-a-broadside, feats:death-from-above-eternal-legend,
 *    feats:marine-jet, feats:riptide-undersea-privateer, feats:sheltering-hand (PRINT_DIFFERS below).
 *
 * Wording round 2 (2026-10-08): the Modes list's "Pin to top" (ModesPanel.tsx) wears the same pin.
 *  MUTATION LINE (measured red, ModesPanel.tsx restored from a scratch copy, sha1 matched): its icon back to
 *  `ti ti-star` → the Modes "Pin to top" case red (alone).
 */
const db: ContentDatabase = content();
const BUCKETS = ['actions', 'feats', 'classFeatures', 'runesmithRune'];
const diskTrees: Record<string, Record<string, AstNode>> = {};
/** One stored tree read from disk, for recordTree (src/sheet/astVisibility.ts): the tree a card reads —
 *  the record's slice of a bigger page, or its own page. */
const readTree = (b: string, s: string): AstNode | undefined => {
  const p = `public/ast/${b}.json.gz`;
  if (!(b in diskTrees)) diskTrees[b] = existsSync(p) ? JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) : {};
  return diskTrees[b][s];
};
beforeAll(async () => {
  const trees: Record<string, Record<string, AstNode>> = {};
  for (const b of BUCKETS) trees[b] = JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8'));
  const index = JSON.parse(readFileSync('public/ast-index.json', 'utf8'));
  vi.stubGlobal('fetch', async (url: string) => {
    if (/ast-index\.json$/.test(String(url))) return { ok: true, json: async () => index };
    const m = /ast\/(\w+)\.json$/.exec(String(url));
    return m && trees[m[1]] ? { ok: true, json: async () => trees[m[1]] } : { ok: false };
  });
  await loadAstIndex();
  for (const b of BUCKETS) await loadBucketAst(b);
});

const pin: PinDescApi = { has: () => false, toggle: () => undefined };
let stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops) s();
  stops = [];
});
function mount(el: ReactElement, cdb: ContentDatabase = db) {
  const r = renderDom(
    <ContentContext.Provider value={cdb}>
      <PinContext.Provider value={pin}>{el}</PinContext.Provider>
    </ContentContext.Provider>,
  );
  stops.push(r.stop);
  return r;
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
/** The labelled lines a page body draws ("Trigger …"), in order — the use lines a player reads. The
 *  mine card draws them as <p class="card-use">, the browse popup as <div class="ast-meta">. */
const useLines = (body: Element | null | undefined) =>
  [...(body?.querySelectorAll('p, .ast-meta') ?? [])].filter((p) => p.firstElementChild?.tagName === 'STRONG' && /^(Trigger|Requirements|Frequency|Cost|Prerequisites)$/.test(txt(p.firstElementChild))).map((p) => txt(p));

/* ------------------------------------------------------------------ the synthesized characters */

/** A level-2 halfling fighter with Halfling Luck and Quick Jump, trained in Medicine. */
const halfling = (extra: Partial<Character> = {}): Character => ({
  ...build('fighter', 2, { ancestryId: 'halfling', featPicks: { '1:ancestry': 'halfling-luck', '2:skill': 'quick-jump' }, classSkills: ['medicine'] } as never),
  ...extra,
});
const withFeats = (c: Character, ids: string[]): Character => ({
  ...c,
  feats: [...c.feats, ...ids.map((id) => ({ featId: id, level: db.feats[id]?.level ?? 1, category: (db.feats[id]?.category ?? 'general') as never }))],
});
const tactics = Object.values(db.actions)
  .filter((a) => a.traits?.includes('tactic') && (a.tacticTier ?? 'basic') === 'basic')
  .map((a) => a.id)
  .sort()
  .slice(0, 4);
const commander = (): Character => {
  const c = build('commander', 2, { commanderTactics: tactics } as Partial<BuildState>);
  return { ...c, commanderTactics: { ...c.commanderTactics!, prepared: c.commanderTactics!.folio.slice(0, 1) } };
};
/** A level-1 runesmith knowing four level-1 runes, the first one etched. */
const runesmith = (): Character => {
  const picks = Object.values(db.runesmithRune ?? {})
    .filter((r) => (r.level ?? 1) <= 1)
    .map((r) => r.id)
    .sort()
    .slice(0, 4);
  const c = build('runesmith', 1, { runesmithRunes: picks } as Partial<BuildState>);
  return { ...c, runicRepertoire: { ...c.runicRepertoire!, etched: c.runicRepertoire!.known.slice(0, 1) } };
};

/** MainTab on the Actions sub-tab (or another mode), and a function opening an action's card from its chip. */
function sheet(c: Character, onPlay: PlayUpdater | null = () => undefined, mode?: 'Exploration' | 'Downtime' | 'Camping') {
  const r = mount(<MainTab character={c} content={db} onPlay={onPlay ?? undefined} />);
  r.click([...r.host.querySelectorAll('.stab')].find((t) => txt(t) === 'Actions') ?? null);
  if (mode) r.click([...r.host.querySelectorAll('.seg-btn')].find((b) => txt(b) === mode) ?? null);
  const open = (name: string) => {
    const chip = [...r.host.querySelectorAll('.action-chip')].find((e) => txt(e.querySelector('.action-chip-name')) === name);
    if (!chip) throw new Error(`no action chip for ${name}`);
    r.click(chip);
    const card = r.host.querySelector('.picker-overlay .card-mine') as HTMLElement | null;
    if (!card) throw new Error(`no card for ${name}`);
    return card;
  };
  return { ...r, open };
}
const bodyOf = (card: Element) => card.querySelector('.ast-pop > .ast-body');
/** The page's printed header glyph (its words, AstRenderer's title attribute). */
const headGlyphs = (card: Element) => [...card.querySelectorAll('.ast-head .ast-ag.head')].map((g) => g.getAttribute('title'));
/** Our cost glyph in the header (ActionGlyph's labels), only ever inside a [data-ours] mark. */
const oursGlyphs = (card: Element) => [...card.querySelectorAll('.ast-head .card-ours-cost[data-ours] .pf2-action')].map((g) => g.getAttribute('aria-label'));

/* ------------------------------------------------------------------ the refuter cases */

describe('card step 9: the Main-tab action popup is the record\'s mine card', () => {
  // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
  it('Aid (an activity) shows its printed Trigger AND Requirements exactly once, at full weight, before the prose; Source dimmed', () => {
    const card = sheet(halfling()).open('Aid');
    expect(card.matches('.ast-modal.card-mine')).toBe(true);
    expect(headGlyphs(card)).toEqual(['Reaction']);
    expect(card.querySelector('.card-ours-cost'), 'the page prints the chip\'s cost: no glyph of ours').toBeNull();
    const body = bodyOf(card)!;
    // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
    expect(count(txt(body), 'Trigger')).toBe(1);
    expect(count(txt(body), 'Requirements')).toBe(1);
    expect(useLines(body)).toEqual([
      'Trigger An ally is about to use an action that requires a skill check or attack roll.',
      'Requirements The ally is willing to accept your aid, and you have prepared to help (see below).',
    ]);
    const kids = [...body.children];
    const at = (label: string) => kids.findIndex((k) => txt(k).startsWith(label));
    // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
    expect(at('Trigger')).toBeLessThan(kids.findIndex((k) => k.tagName === 'HR'));
    expect(kids[at('Trigger')].className).toBe('card-use');
    expect(kids[at('Requirements')].className).toBe('card-use');
    expect(kids[at('Source')].className).toBe('card-dim');
    // The legacy popup's shell and body are gone: no .action-detail-desc, no hideMeta drop.
    expect(card.querySelector('.action-detail-desc')).toBeNull();
  });

  // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
  it('Shield Block, as a FEAT action, shows its printed Trigger once (it was on the markdown lane)', () => {
    const c = withFeats(build('wizard', 2), ['shield-block']);
    const card = sheet(c).open('Shield Block');
    expect(txt(card.querySelector('.ast-badge'))).toBe('Feat 1');
    const body = bodyOf(card)!;
    expect(body, 'the page tree, not the description string').not.toBeNull();
    // batch card premise: feat-5212 "Trigger While you have your shield raised, you would take physical damage (bludgeoning, piercing"
    expect(useLines(body)).toEqual(['Trigger While you have your shield raised, you would take physical damage (bludgeoning, piercing, or slashing) from an attack.']);
    // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
    expect(count(txt(body), 'Trigger')).toBe(1);
  });

  // batch card: #card-OWNER-1 — Halfling Luck: Frequency and Trigger once
  it('Halfling Luck shows Frequency and Trigger once each — the same use lines as the search popup — and no "leads to"', () => {
    const card = sheet(halfling()).open('Halfling Luck');
    expect(headGlyphs(card)).toEqual(['Free Action']);
    const body = bodyOf(card)!;
    expect(count(txt(body), 'Frequency')).toBe(1);
    expect(count(txt(body), 'Trigger')).toBe(1);
    const main = useLines(body);
    // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
    expect(main).toEqual(['Frequency once per day', 'Trigger You fail a skill check or saving throw']);
    // batch card premise: feat-4458 "leads to"
    expect(txt(body)).not.toMatch(/leads to/);
    // The search popup (DescriptionModal, browse) for the same record draws the same use lines.
    const rec = db.feats['halfling-luck']!;
    const search = mount(<DescriptionModal root={{ title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs, key: 'feats', slug: 'halfling-luck' }} onClose={() => undefined} />);
    const browse = useLines(search.host.querySelector('.ast-modal .ast-pop > .ast-body'));
    // batch card: #card-OWNER-1 — Halfling Luck: Frequency and Trigger once
    expect(browse).toEqual(main);
  });

  // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
  it('Rise Up! (a feat action that was on the markdown lane) shows its printed Frequency and Prerequisites once each', () => {
    // The step row named "its Trigger"; MEASURED, feat-8914's page prints no Trigger — its use lines are
    // Frequency and Prerequisites, and those are what the card must now show (the string lane drew the
    // description's own text, not the page's).
    const c = withFeats(build('fighter', 12), ['rose-warden-dedication', 'rise-up'].filter((id) => !!db.feats[id]));
    const card = sheet(c).open('Rise Up!');
    const body = bodyOf(card)!;
    // batch card premise: feat-8914 "Prerequisites Rose Warden Dedication"
    expect(useLines(body)).toEqual(['Frequency once per day', 'Prerequisites Rose Warden Dedication']);
    // batch card: #card-PRINTED-SET — a line the stat block prints is not drawn twice
    expect(count(txt(body), 'Trigger')).toBe(0);
  });

  // batch card: #card-ORDER — the mine card's order and controls
  it('a tactic keeps its prepare toggle in the card header; toggling hands onPlay the tactic and closes the card', () => {
    const calls: ((p: PlayState) => PlayState)[] = [];
    const record: PlayUpdater = (fn) => void calls.push(fn);
    const c = commander();
    const s = sheet(c, record);
    const prepared = db.actions[c.commanderTactics!.prepared[0]]!.name;
    const card = s.open(prepared);
    const toggle = card.querySelector('.ast-head .ast-controls .prep-toggle') as HTMLButtonElement;
    // batch card: #card-ORDER — the mine card's order and controls
    expect(toggle, 'the prepare toggle is a header action').not.toBeNull();
    expect(toggle.classList.contains('on')).toBe(true);
    // headerActions sit before Back / PinStar / close: the toggle precedes the close button.
    expect(toggle.compareDocumentPosition(card.querySelector('.picker-close')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    s.click(toggle);
    expect(calls).toHaveLength(1);
    // MainTab's onPrepare: toggleTactic on the prepared list (play.ts) — the prepared tactic is unprepared.
    const before = { preparedTactics: [c.commanderTactics!.prepared[0]] } as unknown as PlayState;
    // batch card: #card-ORDER — the mine card's order and controls
    expect(calls[0](before).preparedTactics).toEqual([]);
    expect(s.host.querySelector('.picker-overlay'), 'the toggle closes the card, as the legacy popup did').toBeNull();
    // An unprepared tactic (one slot, already full) shows the toggle OFF and disabled.
    const other = c.commanderTactics!.folio.find((id) => !c.commanderTactics!.prepared.includes(id))!;
    const off = s.open(db.actions[other]!.name).querySelector('.prep-toggle') as HTMLButtonElement;
    expect(off.classList.contains('on')).toBe(false);
    // batch card: #card-ORDER — the mine card's order and controls
    expect(off.disabled).toBe(c.commanderTactics!.prepared.length >= c.commanderTactics!.preparedMax);
  });

  // batch card: #card-ORDER — the mine card's order and controls
  it('the action star (PinToggle) is a header action: ON for a pinned action, and it pins / unpins through onPlay', () => {
    const calls: ((p: PlayState) => PlayState)[] = [];
    const record: PlayUpdater = (fn) => void calls.push(fn);
    const s = sheet(halfling({ pinned: ['action:Aid'] }), record);
    const aid = s.open('Aid');
    const on = aid.querySelector('.ast-head .ast-controls .pin-star') as HTMLElement;
    // batch card: #card-ORDER — the mine card's order and controls
    expect(on.classList.contains('on')).toBe(true);
    expect(on.getAttribute('aria-label')).toBe('Unpin');
    s.click(on);
    expect(calls[0]({ pinned: ['action:Aid'] } as unknown as PlayState).pinned).toEqual([]);
    expect(s.host.querySelector('.picker-overlay'), 'the star does not close the card').not.toBeNull();
    s.click(s.host.querySelector('.card-mine .picker-close'));
    const off = s.open('Halfling Luck').querySelector('.ast-head .pin-star') as HTMLElement;
    // batch card: #card-ORDER — the mine card's order and controls
    expect(off.classList.contains('on')).toBe(false);
    s.click(off);
    expect(calls[1]({ pinned: [] } as unknown as PlayState).pinned).toEqual(['action:Halfling Luck']);
    // Read-only sheet: no star, no PinToggle.
    stops.forEach((x) => x());
    stops = [];
    // batch card: #card-ORDER — the mine card's order and controls
    expect(sheet(halfling(), null).open('Aid').querySelector('.pin-star')).toBeNull();
  });

  // batch card: #card-ORDER — the mine card's order and controls
  it('the header\'s two pin buttons differ at a glance: "Pin to top" is a pin, "Add to Pinned" the star — page lane and no-page lane', async () => {
    // The owner (2026-10-08): two identical stars side by side in the action card header read as one control.
    const icon = (b: Element | null) => b?.querySelector('i')?.className ?? '';
    const pair = (card: Element, head: string) => {
      const top = card.querySelector(`${head} [aria-label="Pin to top"]`);
      const fav = card.querySelector(`${head} [aria-label="Add to Pinned"]`);
      // batch card: #card-ORDER — the mine card's order and controls
      expect(top, `${head}: the Pin to top button`).not.toBeNull();
      expect(fav, `${head}: the Add to Pinned star (PinStar)`).not.toBeNull();
      expect(icon(top), `${head}: a pin glyph`).toBe('ti ti-pin');
      expect(icon(fav), `${head}: the PinStar keeps its star`).toBe('ti ti-star');
      expect(icon(top), `${head}: the two header buttons do not share an icon`).not.toBe(icon(fav));
    };
    pair(sheet(halfling()).open('Halfling Luck'), '.ast-head');
    // The no-page lane draws its header as .picker-head (a synthesized record the Archives do not have).
    const src = db.classFeatures['a-challenge-for-heroes']!;
    const id = 't-card-wording-no-page-action';
    const rec = { ...src, id, name: 'T Wording No Page Action' };
    const tdb = { ...db, classFeatures: { ...db.classFeatures, [id]: rec } } as ContentDatabase;
    const a: Act = { name: rec.name, cost: rec.actionCost as never, desc: rec.description, descRefs: rec.descRefs, traits: rec.traits, record: { bucket: 'classFeatures', id } };
    const r = mount(<ActionDetailModal detail={{ a, pinnable: true }} onClose={() => undefined} character={build('fighter', 2)} content={tdb} onPlay={() => undefined} pinned={new Set()} />, tdb);
    await settle();
    pair(r.host.querySelector('.picker.info-modal.card-mine')!, '.picker-head');
  });

  // batch card: #card-ORDER — the mine card's order and controls
  it('the Modes list\'s "Pin to top" is the same pin, never the PinStar\'s star', () => {
    // Our own control's glyph (no printed page involved): every "Pin to top" toggle on the sheet wears one icon.
    const mode: ModeDef = { id: 't-card-wording-mode', name: 'T Wording Mode', modifiers: [] };
    const { host, stop } = renderDom(<ModesPanel library={[mode]} predefined={[]} catalog={[]} activeIds={[]} onToggle={() => undefined} onSave={() => undefined} onDelete={() => undefined} />);
    try {
      const top = host.querySelector('.mode-row [aria-label="Pin to top"]');
      // batch card: #card-ORDER — the mine card's order and controls
      expect(top, 'the mode row\'s Pin to top button').not.toBeNull();
      const icon = top!.querySelector('i')?.className ?? '';
      expect(icon).toBe('ti ti-pin');
      expect(icon, 'Pin to top and the PinStar ("Add to Pinned", ti-star) do not share an icon').not.toBe('ti ti-star');
    } finally { stop(); }
  });

  // batch card: #card-N2 — an app addition is marked ours
  it('Quick Jump: the page\'s printed two actions stay; the marked cost (one action) is OUR glyph, marked, in the header; its note is an actionMark line in the ours box', () => {
    const card = sheet(halfling()).open('High Jump');
    expect(headGlyphs(card)).toEqual(['Two Actions']);
    expect(oursGlyphs(card)).toEqual(['One action']);
    expect(card.querySelector('.ast-head .card-ours-cost')!.getAttribute('title')).toBe('The cost on your sheet');
    expect(txt(card.querySelector('.ast-head .action-skill'))).toBe('Athletics');
    const line = card.querySelector('.ast-body > .card-ours[data-ours] .card-ours-actionMark') as HTMLElement;
    // batch card: #card-N2 — an app addition is marked ours
    expect(line).not.toBeNull();
    const mark = recordMarkersFor(halfling(), db, 'action', 'high-jump').find((m) => m.sourceId === 'quick-jump')!;
    expect(txt(line)).toBe(`Quick Jump: ${markNote(db, mark)}`);
    // The note sits in the box only — never in the page's lines.
    expect(useLines(bodyOf(card))).toEqual([]);
    expect([...bodyOf(card)!.querySelectorAll('p')].filter((p) => !p.closest('[data-ours]')).some((p) => txt(p).includes('Quick Jump'))).toBe(false);
  });

  // batch card: #card-N2 — an app addition is marked ours
  it('without Quick Jump High Jump keeps the printed two actions and has no ours box', () => {
    const card = sheet(build('fighter', 2)).open('High Jump');
    expect(headGlyphs(card)).toEqual(['Two Actions']);
    expect(card.querySelector('.card-ours-cost')).toBeNull();
    expect(card.querySelector('[data-ours-kind="actionMark"]')).toBeNull();
  });

  // batch card: #card-R1 — one card per record
  it('a mark whose value is not a cost (Black Powder Boost on Leap): the page\'s printed "Single Action" is the chip\'s ◆, so no glyph of ours; the note is an actionMark line', () => {
    const c = { ...build('fighter', 5), feats: [{ featId: 'black-powder-boost', level: 1, category: 'class' as never }] };
    const card = sheet(c).open('Leap');
    expect(headGlyphs(card)).toEqual(['Single Action']);
    expect(card.querySelector('.card-ours-cost')).toBeNull();
    expect(txt(card.querySelector('[data-ours-kind="actionMark"] .card-ours-from'))).toBe('Black Powder Boost:');
  });

  // batch card: #card-N2 — an app addition is marked ours
  it('a page whose title prints no glyph (Flurry of Blows) keeps it so; the chip\'s ◆ is our marked glyph', () => {
    const card = sheet(build('monk', 1)).open('Flurry of Blows');
    expect(headGlyphs(card)).toEqual([]);
    expect(oursGlyphs(card)).toEqual(['One action']);
  });

  // batch card: #card-R1 — one card per record
  it('a link inside the card opens a browse card: no skill label, no action pin, no glyph of ours there; Back brings them back', async () => {
    const s = sheet(halfling());
    const card = s.open('High Jump');
    expect(card.querySelector('.ast-head .action-skill')).not.toBeNull();
    expect(card.querySelector('.ast-body > .card-ours[data-ours] .card-ours-actionMark'), 'the action card itself carries the box').not.toBeNull();
    const link = card.querySelector('.ast-pop > .ast-body a.ast-lk') as HTMLElement;
    // batch card: #card-R1 — one card per record
    expect(link, 'High Jump\'s page links another record').not.toBeNull();
    s.click(link);
    const linked = s.host.querySelector('.picker-overlay')!.firstElementChild as HTMLElement;
    expect(linked.querySelector('.info-back'), 'a linked page is open (Back shows)').not.toBeNull();
    expect(txt(linked.querySelector('.ast-name'))).not.toBe('High Jump');
    expect(linked.querySelector('.action-skill')).toBeNull();
    // batch card: #card-R1 — one card per record
    expect(linked.querySelector('.pin-star')).toBeNull();
    expect(linked.querySelector('.card-ours-cost')).toBeNull();
    // The action's ours box (the Quick Jump note) belongs to the action, never to a page it links
    // (card step 9, refuter round 4: 24 of 24 linked popups carried it). The box is drawn only once the
    // linked page has landed, so this reads it after the load settles, not on the loading shell above.
    await settle();
    const landed = s.host.querySelector('.picker-overlay')!.firstElementChild as HTMLElement;
    // batch card: #card-R1 — one card per record
    expect(landed.querySelector('.ast-loading'), 'the linked page has landed').toBeNull();
    expect(landed.querySelector('.info-back')).not.toBeNull();
    expect(landed.querySelector('.card-ours')).toBeNull();
    expect(landed.querySelector('[data-ours]')).toBeNull();
    s.click(landed.querySelector('.info-back'));
    const back = s.host.querySelector('.picker-overlay .card-mine') as HTMLElement;
    // batch card: #card-R1 — one card per record
    expect(txt(back.querySelector('.ast-name'))).toBe('High Jump');
    expect(back.querySelector('.ast-head .action-skill')).not.toBeNull();
    expect(back.querySelector('.ast-head .pin-star')).not.toBeNull();
    expect(back.querySelector('.ast-body > .card-ours[data-ours] .card-ours-actionMark'), 'Back brings the box back').not.toBeNull();
  });

  // batch card: #card-R1 — one card per record
  it('a tactic\'s linked page carries no prepare toggle', async () => {
    const c = commander();
    const s = sheet(c);
    const card = s.open(db.actions[c.commanderTactics!.prepared[0]]!.name);
    expect(card.querySelector('.ast-head .prep-toggle')).not.toBeNull();
    const link = card.querySelector('.ast-pop > .ast-body a.ast-lk') as HTMLElement;
    // batch card: #card-R1 — one card per record
    expect(link, 'the tactic\'s page links another record').not.toBeNull();
    s.click(link);
    const linked = s.host.querySelector('.picker-overlay')!.firstElementChild as HTMLElement;
    expect(linked.querySelector('.info-back')).not.toBeNull();
    expect(linked.querySelector('.prep-toggle')).toBeNull();
    expect(linked.querySelector('.pin-star')).toBeNull();
    // Read again once the linked page has landed: no ours box of the tactic's there either.
    await settle();
    const landed = s.host.querySelector('.picker-overlay')!.firstElementChild as HTMLElement;
    // batch card: #card-R1 — one card per record
    expect(landed.querySelector('.ast-loading'), 'the linked page has landed').toBeNull();
    expect(landed.querySelector('.prep-toggle')).toBeNull();
    expect(landed.querySelector('.card-ours')).toBeNull();
    expect(landed.querySelector('[data-ours]')).toBeNull();
  });

  /** Clicks the card's page links one by one until one lands on RecordCard's FALLBACK branch (a linked
   *  record whose bucket did not load: this file's fetch stub serves only BUCKETS), and returns it.
   *  Measured 2026-10-06: on High Jump the first such link is the page's "Player Core" source link
   *  (source:player-core — the source bucket is not served). */
  async function openFallbackLink(s: ReturnType<typeof sheet>): Promise<HTMLElement> {
    const n = s.host.querySelectorAll('.picker-overlay .card-mine .ast-pop > .ast-body a.ast-lk').length;
    for (let i = 0; i < n; i++) {
      s.click(s.host.querySelectorAll('.picker-overlay .card-mine .ast-pop > .ast-body a.ast-lk')[i]);
      await settle();
      const pop = s.host.querySelector('.picker-overlay')!.firstElementChild as HTMLElement;
      if (pop.matches('.picker.info-modal:not(.card-mine)') && pop.querySelector('.info-back')) return pop;
      s.click(pop.querySelector('.info-back'));
    }
    throw new Error('no link on this card reaches the fallback branch');
  }

  // batch card: #card-S7 — no page: our text, marked
  it('a link to a page whose bucket fails to load opens the fallback popup with NONE of the action\'s header actions (no action pin, prepare toggle, skill label or glyph of ours)', async () => {
    const s = sheet(halfling());
    const card = s.open('High Jump');
    // The action's own card carries them (Quick Jump: our marked one-action glyph).
    expect(card.querySelector('.ast-head .action-skill')).not.toBeNull();
    expect(card.querySelector('.ast-head .pin-star')).not.toBeNull();
    // batch card: #card-S7 — no page: our text, marked
    expect(card.querySelector('.ast-head .card-ours-cost[data-ours]')).not.toBeNull();
    const fb = await openFallbackLink(s);
    expect(txt(fb.querySelector('.info-title'))).not.toBe('High Jump');
    expect(fb.querySelector('.action-skill')).toBeNull();
    expect(fb.querySelector('.pin-star')).toBeNull();
    expect(fb.querySelector('.card-ours-cost')).toBeNull();
    // batch card: #card-S7 — no page: our text, marked
    expect(fb.querySelector('.action-detail-cost')).toBeNull();
    expect(fb.querySelector('.prep-toggle')).toBeNull();
    // Nor the action's ours box (the Quick Jump note): the fallback branch draws the tail too.
    expect(fb.querySelector('.card-ours')).toBeNull();
    expect(fb.querySelector('[data-ours]')).toBeNull();

    const c = commander();
    const t = sheet(c);
    const tcard = t.open(db.actions[c.commanderTactics!.prepared[0]]!.name);
    // batch card: #card-S7 — no page: our text, marked
    expect(tcard.querySelector('.ast-head .prep-toggle')).not.toBeNull();
    const tfb = await openFallbackLink(t);
    expect(tfb.querySelector('.prep-toggle')).toBeNull();
    expect(tfb.querySelector('.pin-star')).toBeNull();
    expect(tfb.querySelector('.card-ours-cost')).toBeNull();
    expect(tfb.querySelector('.card-ours')).toBeNull();
    // batch card: #card-S7 — no page: our text, marked
    expect(tfb.querySelector('[data-ours]')).toBeNull();
  });

  // batch card: #card-N2 — an app addition is marked ours
  it('trained Treat Wounds shows "Your rank (trained): DC 15" in the ours box; the printed tier sentence stays whole', () => {
    const card = sheet(halfling(), () => undefined, 'Exploration').open('Treat Wounds');
    const line = card.querySelector('.card-ours[data-ours] .card-ours-skillTier');
    expect(txt(line)).toBe('Your rank (trained): DC 15');
    expect(txt(bodyOf(card))).toContain('If you\'re an expert in Medicine, you can instead attempt a DC 20 check');
    expect(useLines(bodyOf(card))).toEqual(['Requirements You\'re wearing or holding a healer\'s toolkit.']);
  });

  // batch card: #card-N2 — an app addition is marked ours
  it('skillTierLine: an expert gets the expert tier; an untrained character, a skill-less or tier-less action gets none', () => {
    const c = halfling();
    const tw = { name: 'Treat Wounds', skill: 'Medicine' };
    const expert = { ...c, proficiencies: { ...c.proficiencies, skills: { ...c.proficiencies.skills, medicine: 'expert' as const } } };
    expect(skillTierLine(expert, db, tw)?.text).toBe('Your rank (expert): You can instead attempt a DC 20 check to heal 10 more HP (e.g. 2d8+10).');
    const untrained = { ...c, proficiencies: { ...c.proficiencies, skills: { ...c.proficiencies.skills, medicine: 'untrained' as const } } };
    // batch card: #card-N2 — an app addition is marked ours
    expect(skillTierLine(untrained, db, tw)).toBeNull();
    expect(skillTierLine(c, db, { name: 'Aid' })).toBeNull();
    expect(skillTierLine(c, db, { name: 'High Jump', skill: 'Athletics' })).toBeNull();
    // Repair prints its trained tier itself.
    const crafter = { ...c, proficiencies: { ...c.proficiencies, skills: { ...c.proficiencies.skills, crafting: 'trained' as const } } };
    expect(skillTierLine(crafter, db, { name: 'Repair', skill: 'Crafting' })?.text).toBe('Your rank (trained): Restores 10 HP on a success (20 HP on a critical success).');
    // actionOursLines: the marks first, then the rank line.
    // batch card: #card-N2 — an app addition is marked ours
    expect(actionOursLines(c, db, tw).map((l) => l.kind)).toEqual(['skillTier']);
  });

  // batch card: #card-N2 — an app addition is marked ours
  it('master and legendary Treat Wounds: the ours box shows the HIGHEST tier the rank unlocks (DC 30 / DC 40), never the expert DC 20 line', () => {
    const at = (rank: 'master' | 'legendary'): Character => {
      const c = halfling();
      return { ...c, proficiencies: { ...c.proficiencies, skills: { ...c.proficiencies.skills, medicine: rank } } };
    };
    const WANT = {
      master: 'Your rank (master): You can instead attempt a DC 30 check to heal 30 more HP (e.g. 2d8+30).',
      legendary: 'Your rank (legendary): You can instead attempt a DC 40 check to heal 50 more HP (e.g. 2d8+50).',
    } as const;
    for (const rank of ['master', 'legendary'] as const) {
      const card = sheet(at(rank), () => undefined, 'Exploration').open('Treat Wounds');
      const lines = [...card.querySelectorAll('.card-ours[data-ours] .card-ours-skillTier')].map((l) => txt(l));
      // batch card: #card-N2 — an app addition is marked ours
      expect(lines, rank).toEqual([WANT[rank]]);
      const box = txt(card.querySelector('.card-ours[data-ours]'));
      expect(box, `${rank}: the expert tier is not the one that applies`).not.toContain('DC 20');
      expect(box).not.toContain('DC 15');
      if (rank === 'legendary') expect(box).not.toContain('DC 30');
    }
  });

  // batch card: #card-S7 — no page: our text, marked
  it('a record with no page opens the card\'s no-page lane: our glyph in the header, the trait chips above the old text, the no-page line', async () => {
    // This case used classFeatures:a-challenge-for-heroes until card step 12 gave it its block of the Mark of
    // the Sage page (src/data/page-slices.json, kind 'block'; section 13's raised bar).
    // batch card premise: feat-7185 "Transcendence—A Challenge for Heroes"
    // The shipped no-page action records left (Heavy is the Crown, Coiling Serpents, … measured 2026-10-06
    // through recordTree) are printed inside bigger Archives pages too (Heavy is the Crown in feat-7183) and
    // are owed slices, so the case reads a SYNTHESIZED record the Archives do not have at all — the record
    // section 13 keeps the old text for — shaped as that two-action class feature was.
    const src = db.classFeatures['a-challenge-for-heroes']!;
    const id = 't-card-step12-no-page-action';
    const rec = { ...src, id, name: 'T No Page Action' };
    const tdb = { ...db, classFeatures: { ...db.classFeatures, [id]: rec } } as ContentDatabase;
    // batch card: #card-S7 — no page: our text, marked
    expect(recordTree('classFeatures', src.id, readTree), 'a-challenge-for-heroes now reads its slice').toBeTruthy();
    expect(recordTree('classFeatures', id, readTree), `${id} reads no tree (no page, no slice)`).toBeUndefined();
    const a: Act = { name: rec.name, cost: rec.actionCost as never, desc: rec.description, descRefs: rec.descRefs, traits: rec.traits, record: { bucket: 'classFeatures', id } };
    const r = mount(<ActionDetailModal detail={{ a, pinnable: true }} onClose={() => undefined} character={build('fighter', 2)} content={tdb} onPlay={() => undefined} pinned={new Set()} />, tdb);
    await settle();
    const card = r.host.querySelector('.picker.info-modal.card-mine') as HTMLElement;
    // batch card: #card-S7 — no page: our text, marked
    expect(card).not.toBeNull();
    expect([...card.querySelectorAll('.picker-head .action-detail-cost .pf2-action')].map((g) => g.getAttribute('aria-label'))).toEqual(['Two actions']);
    expect(txt(card.querySelector('.picker-head .info-title'))).toBe(rec.name);
    expect([...card.querySelectorAll('.info-body > .card-controls .action-detail-traits .strike-trait')].map((t) => txt(t))).toEqual(rec.traits);
    expect(txt(card.querySelector('.info-body'))).toContain('You declare an enemy within 60 feet to be a heroic test.');
    // batch card: #card-FOOTER-WORDS — the owner (2026-10-08): the ours footer speaks player words, no "import".
    expect(txt(card.querySelector('[data-ours-kind="noPage"]'))).toBe('Not from the Archives — our text');
    expect(card.querySelector('.picker-head .pin-star'), 'the action pin rides the no-page header too').not.toBeNull();
  });

  // batch card: #card-R1 — the rune opens its record's card
  it('a runesmith rune opens its record\'s card: the Archives page, the etch toggle in the header, toggling hands onPlay the rune', () => {
    const calls: ((p: PlayState) => PlayState)[] = [];
    const record: PlayUpdater = (fn) => void calls.push(fn);
    const c = runesmith();
    const etched = c.runicRepertoire!.etched[0];
    const rec = db.runesmithRune![etched]!;
    const s = sheet(c, record);
    const card = s.open(rec.name);
    // batch card: #card-R1 — one card per record
    expect(txt(card.querySelector('.ast-head .ast-title')) || txt(card.querySelector('.ast-head'))).toContain(rec.name);
    const body = bodyOf(card)!;
    expect(body, 'the rune\'s page tree, not the description string').not.toBeNull();
    expect(card.querySelector('.action-detail-desc')).toBeNull();
    const toggle = card.querySelector('.ast-head .ast-controls .prep-toggle') as HTMLButtonElement;
    expect(toggle, 'the etch toggle is a header action').not.toBeNull();
    // batch card: #card-R1 — one card per record
    expect(toggle.classList.contains('on')).toBe(true);
    s.click(toggle);
    expect(calls).toHaveLength(1);
    expect(s.host.querySelector('.picker-overlay'), 'the toggle closes the card').toBeNull();
  });

  // batch card: #card-R1 — one card per record
  it('a camping activity (Kingmaker) opens its record\'s card with the Archives page', () => {
    const c: Character = { ...halfling(), kingmakerEnabled: true };
    const id = 'camouflage-campsite';
    const rec = db.actions[id]!;
    const card = sheet(c, () => undefined, 'Camping').open(rec.name);
    expect(card.matches('.ast-modal.card-mine')).toBe(true);
    // batch card: #card-R1 — one card per record
    expect(txt(card.querySelector('.ast-head'))).toContain(rec.name);
    expect(bodyOf(card), 'the camping page tree').not.toBeNull();
    expect(card.querySelector('.action-detail-desc')).toBeNull();
  });

  // batch card: #card-N2 — an app addition is marked ours
  it('every chip opens a card whose header shows the chip\'s cost exactly once — as the page\'s print or as our marked glyph, never ours beside an equal print (7 characters, every mode)', () => {
    /** One glyph slot read as digits: "1".."5" per action glyph, "H" for the activity hourglass, the
     *  words for a duration. A chip's slot is `.action-cost`; the card's printed one is the page title
     *  glyph (.ast-ag.head, "One Action to Three Actions" → "13"), ours is .action-detail-cost. */
    const DIG: Record<string, string> = { 'single action': '1', 'one action': '1', 'two actions': '2', 'three actions': '3', 'free action': '4', reaction: '5' };
    const ourSlot = (el: Element) =>
      el.querySelector('.action-activity-icon') ? 'H'
        : el.querySelector('.pf2-action-duration') ? txt(el.querySelector('.pf2-action-duration'))
          : [...el.querySelectorAll('.pf2-action')].map((g) => txt(g)).join('');
    const pageSlot = (el: Element) => (el.getAttribute('title') ?? '').toLowerCase().split(/\s+(?:to|or)\s+/).map((w) => DIG[w] ?? `?${w}`).join('');
    const cast: Character[] = [
      halfling(),
      build('monk', 1),
      build('wizard', 2),
      commander(),
      runesmith(),
      { ...withFeats(build('fighter', 8), ['sheltering-hand', 'signature-weapon', 'quick-recovery', 'body-of-air', 'riptide-undersea-privateer'].filter((f) => !!db.feats[f])), kingmakerEnabled: true },
      withFeats(build('cleric', 4), ['shield-block']),
    ];
    const bad: string[] = [];
    const seen = new Set<string>();
    const beside = new Set<string>();
    let cards = 0;
    for (const [ci, c] of cast.entries()) {
      for (const mode of [undefined, 'Exploration', 'Downtime', 'Camping'] as const) {
        const r = mount(<MainTab character={c} content={db} onPlay={() => undefined} />);
        r.click([...r.host.querySelectorAll('.stab')].find((t) => txt(t) === 'Actions') ?? null);
        if (mode) {
          const seg = [...r.host.querySelectorAll('.seg-btn')].find((b) => txt(b) === mode);
          if (!seg) continue;
          r.click(seg);
        }
        const n = r.host.querySelectorAll('.action-chip').length;
        for (let i = 0; i < n; i++) {
          const chip = r.host.querySelectorAll('.action-chip')[i];
          const name = txt(chip.querySelector('.action-chip-name'));
          const want = ourSlot(chip.querySelector('.action-cost')!);
          r.click(chip);
          const card = r.host.querySelector('.picker-overlay .card-mine');
          if (card) {
            cards++;
            seen.add(name);
            const head = card.querySelector('.ast-head, .picker-head')!;
            const printed = [...head.querySelectorAll('.ast-ag.head')].map(pageSlot);
            const oursEls = [...head.querySelectorAll('.action-detail-cost')];
            const ours = oursEls.map(ourSlot);
            const unmarked = oursEls.some((e) => !e.matches('.card-ours-cost[data-ours]'));
            const printOk = printed.length === 1 && printed[0] === want;
            const ok = !unmarked && printed.length <= 1 && (ours.length === 0 ? printOk : ours.length === 1 && ours[0] === want && !printOk);
            if (!ok) bad.push(`${ci}:${mode ?? 'Encounter'}:${name} chip=${want} printed=${JSON.stringify(printed)} ours=${JSON.stringify(ours)}${unmarked ? ' UNMARKED' : ''}`);
            if (ours.length && printed.length) beside.add(`${name} chip=${want} printed=${printed[0]}`);
          }
          const overlay = r.host.querySelector('.picker-overlay');
          if (overlay) r.click(overlay.querySelector('.picker-close') ?? overlay);
        }
      }
      stops.forEach((x) => x());
      stops = [];
    }
    // The refuter's named cases are in the sweep (each was a missing, a different or a rewritten cost).
    for (const name of ['Flurry of Blows', 'Cast a Spell', 'Sheltering Hand', 'Signature Weapon', 'Quick Recovery', 'Pick a Lock', 'High Jump', 'Camouflage Campsite']) {
      // batch card: #card-N2 — an app addition is marked ours
      expect(seen.has(name), `${name} opened a card in the sweep`).toBe(true);
    }
    expect(cards).toBeGreaterThan(300);
    expect(bad).toEqual([]);
    // Ours beside a different print: Quick Jump's marked High Jump / Long Jump, and the stored costs that
    // differ from print (a data question for the owner, shown both ways, decided nowhere here).
    // batch card: #card-N2 — an app addition is marked ours
    expect([...beside].sort()).toEqual(BESIDE_IN_SWEEP);
  }, 300_000);

  // batch card: #card-N2 — an app addition is marked ours
  it('oursHeaderCost over every action record with a page (2,641 trees): the page\'s printed glyph is what the header reads; ours is drawn exactly where print is not the stored cost', () => {
    const glyphs = (n: AstNode): string[] => {
      const top = n.c ?? [];
      const at = top.findIndex((x) => x.t === 'title' && Number(x.level || 1) <= 1);
      const ti = at >= 0 ? at : top.findIndex((x) => x.t === 'title');
      const out: string[] = [];
      if (ti >= 0) (function w(x: AstNode) { if (x.t === 'actions' && String(x.string || '').trim()) out.push(String(x.string)); (x.c ?? []).forEach(w); })(top[ti]);
      return out;
    };
    const DIG: Record<string, string> = { 'single action': '1', 'one action': '1', 'two actions': '2', 'three actions': '3', 'free action': '4', reaction: '5' };
    const digits = (s: string) => s.toLowerCase().split(/\s+(?:to|or)\s+/).map((w) => DIG[w] ?? `?${w}`).join('');
    const WORD: Record<string, string> = { 1: 'One Action', 2: 'Two Actions', 3: 'Three Actions' };
    const spell = (c: NonNullable<Act['cost']>): string | null =>
      c.type === 'actions' ? WORD[c.value] ?? null : c.type === 'free' ? 'Free Action' : c.type === 'reaction' ? 'Reaction' : c.type === 'variable' && WORD[c.min] && WORD[c.max] ? `${WORD[c.min]} to ${WORD[c.max]}` : null;
    const trees: Record<string, Record<string, AstNode>> = {};
    for (const b of ['actions', 'feats', 'classFeatures']) trees[b] = JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8'));
    const rows: [string, string, Act['cost']][] = [];
    for (const a of ACTIVITIES) {
      const id = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (db.actions[id]) rows.push(['actions', id, a.cost]);
    }
    for (const b of ['feats', 'classFeatures'] as const) for (const [id, r] of Object.entries(db[b])) if (isActionCost(r.actionCost)) rows.push([b, id, r.actionCost]);
    const bad: string[] = [];
    const differs: string[] = [];
    let checked = 0;
    let noGlyph = 0;
    for (const [b, id, cost] of rows) {
      const raw = trees[b][id];
      if (!raw) continue;
      checked++;
      const page = variantSection(raw, id);
      const before = JSON.stringify(page);
      const printed = glyphs(page)[0] ?? null;
      const want = cost ? spell(cost) : null;
      const same = !!printed && !!want && digits(printed) === digits(want);
      const ours = oursHeaderCost(cost, page);
      if (printedHeaderCost(page) !== printed) bad.push(`${b}:${id} printedHeaderCost=${printedHeaderCost(page)} tree=${printed}`);
      if (ours !== !same) bad.push(`${b}:${id} printed=${printed} stored=${want} ours=${ours}`);
      if (JSON.stringify(page) !== before) bad.push(`${b}:${id} the page tree was changed`);
      if (!printed) noGlyph++;
      else if (!same) differs.push(`${b}:${id} printed=${printed} stored=${want ?? 'none'}`);
    }
    // batch card: #card-N2 — an app addition is marked ours
    expect(checked).toBeGreaterThan(2600);
    expect(bad).toEqual([]);
    // Measured 2026-10-06: the pages whose title prints no glyph (ours drawn alone) …
    expect(noGlyph).toBe(NO_GLYPH_PAGES);
    // … and the records whose stored cost is not the printed one (ours drawn beside print). Each is a data
    // disagreement listed for the owner; a new one, or one fixed in the data, changes this list.
    // batch card: #card-N2 — an app addition is marked ours
    expect(differs.sort()).toEqual(PRINT_DIFFERS);
  });
});

/** Measured 2026-10-06 (fixer round 2): the sweep's cards with our glyph beside a different print. */
const BESIDE_IN_SWEEP: string[] = [
  'Body of Air chip=5 printed=52',
  'High Jump chip=1 printed=2',
  'Long Jump chip=1 printed=2',
  'Pick a Lock chip=H printed=2',
  'Riptide (Undersea Privateer) chip=1 printed=5',
  'Sheltering Hand chip=1 printed=12',
];
/** Measured 2026-10-06 (fixer round 2): action pages whose title prints no glyph. */
const NO_GLYPH_PAGES = 71;
/** Measured 2026-10-06 (fixer round 2): stored action cost ≠ the page's printed title glyph. */
const PRINT_DIFFERS: string[] = [
  'actions:pick-a-lock printed=Two Actions stored=none',
  'classFeatures:act-together printed=Single Action to Three Actions stored=One Action',
  'classFeatures:drain-life printed=Single Action stored=Two Actions',
  'classFeatures:for-talmandor-for-freedom printed=Two Actions stored=One Action',
  'classFeatures:shadows-in-the-moonlight printed=Single Action or Two Actions stored=One Action',
  'feats:aon-dad-joke printed=Single Action to Two Actions stored=One Action',
  'feats:body-of-air printed=Reaction or Two Actions stored=Reaction',
  'feats:bullet-and-a-broadside printed=Single Action or Two Actions stored=One Action',
  'feats:death-from-above-eternal-legend printed=Single Action stored=Two Actions',
  'feats:marine-jet printed=Two Actions or Three Actions stored=Two Actions',
  'feats:riptide-undersea-privateer printed=Reaction stored=One Action',
  'feats:sheltering-hand printed=Single Action or Two Actions stored=One Action',
];

describe('card step 9: an action that names no record', () => {
  // batch card: #card-S7 — no page: our text, marked
  it('an action that names no record (an item activation) opens the plain no-record popup, its text through DescBody', () => {
    const a: Act = { name: 'Synthetic Activation', cost: { type: 'actions', value: 1 }, desc: 'Body words of a synthetic activation.', traits: ['manipulate'] };
    const r = mount(<ActionDetailModal detail={{ a, pinnable: false }} onClose={() => undefined} character={build('fighter', 2)} content={db} pinned={new Set()} />);
    expect(r.host.querySelector('.card-mine')).toBeNull();
    expect(txt(r.host.querySelector('.picker.info-modal .action-detail-desc'))).toBe('Body words of a synthetic activation.');
  });

  // batch card premise: action-2292 "Requirements The ally is willing to accept your aid" — the page a name-slug lookup would land on; a no-record popup never draws it.
  it('a no-record action named like an action with a page never draws that page (no tree key, no page branch)', () => {
    // Card step 22: the no-record popup's DescBody has no page branch; an Act whose name slugs to a shipped
    // action page (Aid) but names no record draws its own words, never the page.
    const a: Act = { name: 'Aid', cost: { type: 'reaction' }, desc: 'Synthetic words standing in for Aid.', traits: [] };
    const r = mount(<ActionDetailModal detail={{ a, pinnable: false }} onClose={() => undefined} character={build('fighter', 2)} content={db} pinned={new Set()} />);
    expect(r.host.querySelector('.card-mine')).toBeNull();
    // batch card: #card-S7 — no page: our text, marked
    expect(r.host.querySelector('.ast-body'), 'no page tree is drawn').toBeNull();
    expect(txt(r.host.querySelector('.picker.info-modal .action-detail-desc'))).toBe('Synthetic words standing in for Aid.');
    expect(count(txt(r.host), 'Trigger')).toBe(0);
  });
});

describe('card step 9: oursHeaderCost reads the printed glyph and changes nothing', () => {
  const tree = (b: string, id: string) => (JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8')) as Record<string, AstNode>)[id];

  // batch card: #card-N2 — an app addition is marked ours
  it('High Jump prints "Two Actions": ours for a marked one action, none for two; the tree is not mutated', () => {
    const t = tree('actions', 'high-jump');
    const before = JSON.stringify(t);
    expect(printedHeaderCost(t)).toBe('Two Actions');
    expect(oursHeaderCost({ type: 'actions', value: 1 }, t)).toBe(true);
    expect(oursHeaderCost({ type: 'actions', value: 2 }, t)).toBe(false);
    // batch card: #card-N2 — an app addition is marked ours
    expect(JSON.stringify(t)).toBe(before);
  });

  // batch card: #card-N2 — an app addition is marked ours
  it('"Single Action" is the same glyph as one action; no cost, a duration, no page or a page with no glyph draws ours', () => {
    const leap = tree('actions', 'leap');
    expect(printedHeaderCost(leap)).toBe('Single Action');
    expect(oursHeaderCost({ type: 'actions', value: 1 }, leap)).toBe(false);
    expect(oursHeaderCost(undefined, leap)).toBe(true);
    expect(oursHeaderCost({ type: 'duration' } as never, leap)).toBe(true);
    // batch card: #card-N2 — an app addition is marked ours
    expect(oursHeaderCost({ type: 'actions', value: 1 }, null)).toBe(true);
    const flurry = tree('classFeatures', 'flurry-of-blows');
    expect(printedHeaderCost(flurry)).toBeNull();
    expect(oursHeaderCost({ type: 'actions', value: 1 }, flurry)).toBe(true);
  });
});
