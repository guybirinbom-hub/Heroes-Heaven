// @vitest-environment jsdom
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { content } from './_content';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { ItemDetail, itemStatRows } from '../src/sheet/ItemDetail';
import { FeatDetail, featStatRows, type FeatEntry } from '../src/sheet/FeatDetail';
import { SpellDetail, spellStatRows } from '../src/sheet/SpellsTab';
import { spellCardModel } from '../src/sheet/spellCard';
import { splitHeightening } from '../src/rules/heightening';
import { ActionGlyph } from '../src/sheet/widgets';
import { ContentContext } from '../src/sheet/ContentContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { isNotOwnPage, pageSliceOf, recordTree } from '../src/sheet/astVisibility';
import type { ActionCost, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * Card step 1 (docs/card-design.md section 9, row 1, "G0"): a NO-BEHAVIOUR-CHANGE move.
 *
 * The tree-visibility predicates (META, isMetaP, isSourceP, STAT_LABELS, isMetaishBlock, from
 * AstRenderer.tsx) and the two tree cuts (variantSection, withoutItemLists, from useAst.ts) move into
 * src/sheet/astVisibility.ts — a plain .ts file, so the step-4 guard can import through jiti exactly
 * what the card renders with. The three surfaces' stat rows become exported pure functions
 * (itemStatRows, featStatRows, spellStatRows) that the popups themselves render from: ONE copy.
 *
 * What this file proves, on records drawn by mulberry32(20261002), 120 per bucket over feats,
 * classFeatures, items, actions and spells (600), plus 60 per stat-row surface:
 *
 *  1. ALWAYS: the sample is what it says it is.
 *  2. ALWAYS: each surface's stat rows on screen are the rows its exported function returns, so the
 *     component cannot grow a second copy.
 *  3. WITH A SNAPSHOT (env CARD_NOOP_SNAPSHOT=<json path>): byte-equal markup against the same renders
 *     produced by the pre-move code — the full DescriptionModal path for all 600, the three popups for
 *     60 each, and the stat rows the functions return equal today's rows. (Until card step 22 it also
 *     compared the held-record DescBody path and the bare hideMeta body for all 600; step 22 removed
 *     both paths — every held-record popup is its record's 'mine' card — so their snapshot entries are
 *     no longer rendered.) `CARD_NOOP_WRITE=1` writes the snapshot instead (run that on the
 *     pre-move tree). The snapshot is scratch: it pins one tree's output on one data stamp, so it is
 *     never committed; without the variable this block skips and says so.
 *
 * Every render is renderToStaticMarkup with the bucket caches warm, so useAstNode seeds synchronously
 * from getCachedAst (useAst.ts) and no effect or timer runs. Fixtures are the shipped records only.
 *
 * Measured 2026-10-02: snapshot written on HEAD a5b9d0b before any edit (600 × 3 tree renders, 180
 * popups, 465 stat rows), then compared after the move: 0 differences.
 *
 * MUTATION LINES (each measured red on 2026-10-02, then restored byte-exact):
 *  - astVisibility.ts META: `source` → `xsourcex` → block 3 red (feats:armor-regiment-training modal).
 *  - astVisibility.ts variantSection: always return the node → block 3 red (items:healing-potion-major).
 *  - ItemDetail.tsx: a second hard-coded Price <Stat> after the rows → block 2 red.
 *  - ItemDetail.tsx itemStatRows: drop the Bulk row → block 3 red (the popup follows the function).
 *  - FeatDetail.tsx: the Enhancement cell prints entry.enhancedBy instead of the row → block 2 red.
 *  - SpellsTab.tsx spellStatRows: drop the Duration row → block 3 red (spells gravity-weapon).
 *  - (card step 16, 2026-10-07) SpellsTab.tsx SpellDetail: spellCardModel(spell, undefined, …) — the popup
 *    ignores its page and prints the field rows → block 2 red (spell reinforced-rations, 3 rows vs 4).
 *  - (card step 16 re-baseline, 2026-10-07, with the snapshot) spellCard.ts stripPrintedPreamble returns
 *    its input → block 3 red (STEP16_CHANGED_NOOP: the 7 'preamble stripped' spells no longer match).
 *  - (same) SpellsTab.tsx SpellDetail: drop data-lane from .sd-stats → block 3 red (46 changed vs 60 pinned:
 *    the 14 lane-only spells become byte-equal again).
 */
const SEED = 20261002;
const BUCKETS = ['feats', 'classFeatures', 'items', 'actions', 'spells'] as const;
const PER_BUCKET = 120;
const PER_SURFACE = 60;
const SNAP = process.env.CARD_NOOP_SNAPSHOT;
const WRITE = process.env.CARD_NOOP_WRITE === '1';

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** `n` distinct members of `pool` (already sorted), drawn by a partial Fisher–Yates on a copy. */
function draw<T>(pool: T[], n: number, rng: () => number): T[] {
  const a = pool.slice();
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as Record<string, AstNode>;
const noop = () => undefined;
const db: ContentDatabase = content();
const recs = (bucket: string) => (db as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: unknown }>>)[bucket] ?? {};

const trees: Record<string, Record<string, AstNode>> = {};
let sample: { bucket: string; slug: string }[] = [];
let itemIds: string[] = [];
let featRows: { bucket: 'feats' | 'classFeatures'; id: string }[] = [];
let spellIds: string[] = [];

beforeAll(async () => {
  for (const b of BUCKETS) trees[b] = readGz(`public/ast/${b}.json.gz`);
  // Warm the module cache through the loader's own raw-json fallback (the .gz fetch answers not-ok).
  vi.stubGlobal('fetch', async (url: string) => {
    const m = /ast\/(\w+)\.json$/.exec(String(url));
    return m && trees[m[1]] ? { ok: true, json: async () => trees[m[1]] } : { ok: false };
  });
  for (const b of BUCKETS) await loadBucketAst(b);
  // jsdom has no matchMedia; useIsMobile reads it on first render (desktop-shaped, as test/_render does).
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;

  const rng = mulberry32(SEED);
  sample = BUCKETS.flatMap((b) => {
    const pool = Object.keys(trees[b]).filter((s) => recs(b)[s]).sort();
    return draw(pool, PER_BUCKET, rng).map((slug) => ({ bucket: b, slug }));
  });
  itemIds = draw(Object.keys(db.items).sort(), PER_SURFACE, rng);
  const featPool = [
    ...Object.keys(db.feats).sort().map((id) => ({ bucket: 'feats' as const, id })),
    ...Object.keys(db.classFeatures).sort().map((id) => ({ bucket: 'classFeatures' as const, id })),
  ];
  featRows = draw(featPool, PER_SURFACE, rng);
  spellIds = draw(Object.keys(db.spells).sort(), PER_SURFACE, rng);
});

const wrap = (el: ReactElement) => renderToStaticMarkup(<ContentContext.Provider value={db}>{el}</ContentContext.Provider>);

/** Card step 12: the read every popup made BEFORE step 12 — variantSection as it stood at 9612a13 (the
 *  exact-slug key only; verbatim), no not-own-page list, no page slices. */
const flatRaw = (n: AstNode): string => (n.t === 'text' ? n.v ?? '' : (n.c ?? []).map(flatRaw).join(''));
const slugOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function preStep12Cut(node: AstNode, slug: string): AstNode {
  const isSection = (n: AstNode) => n.t === 'title' && Number(n.level ?? 1) === 2;
  const top = node.c ?? [];
  let sections = 0, first = -1, mine = -1;
  for (let i = 0; i < top.length; i++) {
    if (!isSection(top[i])) continue;
    sections++;
    if (first < 0) first = i;
    if (mine < 0 && slugOf(flatRaw(top[i])) === slug) mine = i;
  }
  if (mine < 0 || sections < 2) return node;
  let end = top.length;
  for (let i = mine + 1; i < top.length; i++) if (isSection(top[i])) { end = i; break; }
  const shared = top.slice(0, first).filter((n) => !(n.t === 'title' && Number(n.level ?? 1) <= 1));
  return { ...node, c: [{ ...top[mine], level: 1 }, ...shared, ...top.slice(mine + 1, end)] };
}
/** The "bucket:id" keys whose read step 12 changed, with why (on this file's loaded buckets). */
function step12Changed(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of new Set(keys)) {
    const [b, s] = k.split(':');
    const old = trees[b]?.[s] ? preStep12Cut(trees[b][s], s) : undefined;
    const now = recordTree(b, s, (x, y) => trees[x]?.[y]);
    if (JSON.stringify(old) === JSON.stringify(now)) continue;
    out[k] = pageSliceOf(b, s) ? 'F6b page slice' : isNotOwnPage(b, s) ? 'F6 not own page: own text' : 'F5 own section';
  }
  return out;
}
/** Measured 2026-10-06 in the step-12 lane on the shipped data (see the re-baseline block): 24 of the
 *  720 keys (25 until round 4 gave Oil (1 pint) its page back). Implement benefits and grade variants now show their own section of the family page (F5);
 *  doctrines, creeds, an alchemist research-field benefit and an inventor modification show their own
 *  bullet / section of the page they live in, and wand ranks their own section of the wand page (F6b);
 *  records whose family page holds no section of their own show their own text (F6). Before step 12 each
 *  drew the whole family page. */
const STEP12_CHANGED_NOOP: Record<string, string> = {
  'classFeatures:adept-benefit-bell': 'F5 own section',
  'classFeatures:adept-benefit-lantern': 'F5 own section',
  'classFeatures:adept-benefit-regalia': 'F5 own section',
  'classFeatures:adept-benefit-weapon': 'F5 own section',
  'classFeatures:advanced-vials-mutagenist': 'F6b page slice',
  'classFeatures:camouflage-pigmentation': 'F6b page slice',
  'classFeatures:first-doctrine-cloistered-cleric': 'F6b page slice',
  'classFeatures:first-doctrine-warpriest': 'F6b page slice',
  'classFeatures:fourth-doctrine-warpriest': 'F6b page slice',
  'classFeatures:initiate-benefit-shield': 'F5 own section',
  'classFeatures:initiate-benefit-wand': 'F5 own section',
  'classFeatures:initiate-benefit-weapon': 'F5 own section',
  'classFeatures:major-creed': 'F6b page slice',
  'classFeatures:paragon-benefit-chalice': 'F5 own section',
  'classFeatures:perpetual-perfection-mutagenist': 'F6 not own page: own text',
  'classFeatures:second-doctrine-warpriest': 'F6b page slice',
  'classFeatures:third-doctrine-warpriest': 'F6b page slice',
  'items:bloodstone-doll-moderate': 'F5 own section',
  // batch card premise: equipment-1166 "Fire A massive explosion knocks the target back" — round 3:
  // the drake rifle reads the family page with only its own line of the variant list (F6b kind 'line').
  'items:drake-rifle-fire': 'F6b page slice',
  'items:toothy-knife-greater': 'F5 own section',
  'items:transmuting-ingot-silver': 'F5 own section',
  // Round 2: a wand rank reads its own "(Nth-Rank Spell)" section of the wand page (F6b, route R0), not old text.
  'items:wand-of-dazzling-rays-3rd-rank': 'F6b page slice',
  'items:wand-of-mercy-8th-rank': 'F6b page slice',
  'items:wand-of-teeming-ghosts-5th-rank': 'F6b page slice',
};

/** Card step 16 (spells phase A, docs/card-design.md section 9 row 16): what changed in a spell popup
 *  against the pre-move snapshot, as a "; "-joined list of classes, '' when nothing did.
 *   - 'lane marker': the stat block now says which lane its rows came from (data-lane="page" | "field");
 *     with that attribute taken out of today's markup the rest is compared.
 *   - 'page rows': the rows read off the DOM differ — they are the page's own labelled lines now, in
 *     printed order and the page's words (Saving Throw as Defense, a field-only row not printed).
 *   - 'preamble stripped': the body (from .sd-desc on) differs — the leading "**Area** …" / scraped
 *     "Name / Source … pg. N / Cast …" lines the rows now print came off the description string.
 *   - 'stats markup': the stat block's markup differs while its rows do not (never measured; pinned so it
 *     cannot appear unnoticed).
 *  Card step 17 (spells phase B, row 17): `treeBody` — the popup draws its body from the page tree
 *  (spellCardModel body 'tree'); its body differing is then 'tree body', never 'preamble stripped'. The
 *  body starts at the first `<div class="sd-desc"` (the tree body carries data-body="tree").
 *   - 'no-page footer' (step 17 fixer round 3, the orchestrator's decision on nit 7): an official spell with
 *     no page ends with section 7's ours footer "Not from the Archives — our text"; with that
 *     one line taken out the rest is compared. */
const LANE_ATTR = / data-lane="(?:page|field)"/;
// batch card: step17-nit7 — the no-page spell's section-7 footer is ours (data-ours-kind="noPage"), never print.
// batch card premise: spell-1530 "A roaring blast of fire detonates at a spot you designate" — the owner (2026-10-08): its words are player words, no "import".
const NOPAGE_FOOTER = '<p class="sd-ours card-nopage" data-ours="" data-ours-kind="noPage">Not from the Archives — our text</p>';
function step16SpellChange(now: { markup: string; rows: [string, string][] }, before: { markup: string; rows: [string, string][] }, treeBody = false): string {
  const out: string[] = [];
  const unfooted = now.markup.replace(NOPAGE_FOOTER, '');
  const bare = unfooted.replace(LANE_ATTR, '');
  if (bare !== unfooted) out.push('lane marker');
  if (unfooted !== now.markup) out.push('no-page footer');
  if (bare === before.markup) return out.join('; ');
  const rowsDiffer = JSON.stringify(now.rows) !== JSON.stringify(before.rows);
  // batch card premise: spell-1530 "A roaring blast of fire detonates at a spot you designate"
  const bodyAt = (m: string) => m.slice(m.indexOf('<div class="sd-desc"'));
  const bodyDiffer = bodyAt(bare) !== bodyAt(before.markup);
  if (rowsDiffer) out.push('page rows');
  if (bodyDiffer) out.push(treeBody ? 'tree body' : 'preamble stripped');
  if (!rowsDiffer && bare.slice(0, bare.length - bodyAt(bare).length) !== before.markup.slice(0, before.markup.length - bodyAt(before.markup).length)) out.push('stats markup');
  return out.join('; ');
}
/** Measured 2026-10-07 on main at c67ccd6 + the step-16 tree, against the 2026-10-02 pre-move snapshot:
 *  every one of the 60 sampled spell popups changed on purpose (all 60 stat blocks carry their lane, 14
 *  with nothing else changed); the rows of 46 differ because they are the page's own; 7 bodies lost the
 *  printed preamble the rows now show (all 7 also page rows). No 'stats markup' change. Every other
 *  surface (the 600 tree renders and the 60 item popups, before steps 11 and 14 made the feat and item
 *  popups cards) stays byte-equal.
 *  batch card premise: spell-2315 "Duration sustained up to 1 minute" — the page's own Duration line is the row.
 *  Card step 17, measured 2026-10-08 in the lane at ee517bc + step 17 against the same snapshot: 59 of the
 *  60 draw their body from the page ('tree body' added; the 7 step-16 'preamble stripped' bodies are the
 *  page's too, so that class is gone); rite-of-cleansing-flame has no page (field lane) and is unchanged
 *  but for section 7's no-page footer (fixer round 3, nit 7).
 *  batch card premise: spell-1530 "A roaring blast of fire detonates at a spot you designate" */
// batch card: step17-nit7 — rite-of-cleansing-flame (no page in the spells bucket) gains only the ours footer.
const L0 = 'lane marker; no-page footer';
const L = 'lane marker; tree body';
// batch card: step13b-merge — the dead LRP alias (the same string as LR since step 17) folded into LR.
const LR = 'lane marker; page rows; tree body';
const STEP16_CHANGED_NOOP: Record<string, string> = {
  'aberrant-form': L,
  'animus-mine': LR,
  'befitting-attire': LR,
  benediction: L,
  'blackfingers-blades': LR,
  'boots-on-the-ground': LR,
  'burning-blossoms': LR,
  'commanding-lash': LR,
  'confound-the-eye-and-confuse-the-mind': LR,
  'cutting-insult': LR,
  'dancing-blade': LR,
  'divine-aura': LR,
  'drain-planar-connection': LR,
  'draw-ire': LR,
  'embodied-font': LR,
  'embrace-the-pit': L,
  'ephemeral-hazards': LR,
  'extend-blood-magic': L,
  'false-nature': LR,
  'familiars-resurrection': LR,
  'flowing-strike': L,
  'foraging-friends': LR,
  'frenzied-revelry': L,
  'gale-blast': LR,
  'gentle-breeze': LR,
  'glimpse-weakness': LR,
  'gravity-weapon': L,
  'grim-tendrils': LR,
  'hand-of-the-apprentice': LR,
  'illusory-creature': LR,
  'implement-of-destruction': LR,
  'infectious-ennui': LR,
  'iron-gut': LR,
  knock: L,
  'lashing-rope': LR,
  'pack-attack': LR,
  'pillar-of-water': L,
  'planar-displacement': LR,
  pyrotechnics: LR,
  'qi-blast': LR,
  'reinforced-rations': LR,
  'remake-physiology': LR,
  'rite-of-cleansing-flame': L0,
  'rite-of-the-red-star': LR,
  'scouting-eye': LR,
  'shambling-horror': LR,
  'sky-laughs-at-waves': LR,
  'soothing-words': L,
  'spiritual-epidemic': LR,
  'subconscious-suggestion': LR,
  'telekinetic-maneuver': L,
  'teleportation-circle': LR,
  'tesseract-tunnel': LR,
  'time-jump': L,
  'unbreaking-wave-advance': LR,
  'wanderers-guide': L,
  'weapon-surge': LR,
  'wooden-double': LR,
  'word-of-truth': LR,
  'world-in-shadow': LR,
};

/** Card step 14b (docs/card-design.md section 2 rule 6), measured 2026-10-08 in the lane against a snapshot
 *  written on 3c7cca0 before any step-14b edit: 10 renders changed, every one only where a stub now draws.
 *  Seven are search popups (`modal`) of the 600 tree renders — two of them (initiate-benefit-wand
 *  "aon:action-1233", initiate-benefit-weapon "aon:action-1234", both name links) are STEP12_CHANGED_NOOP
 *  records, so they differ from the pre-move popup anyway; the five below are pinned. The other three are
 *  feat popups (kinetic-aura, master-strike, mature-trained-companion: their 'mine' card embeds the page),
 *  whose markup this block does not compare (the feat popup is the card since step 11). */
const STEP14B_CHANGED_NOOP: Record<string, string> = {
  'classFeatures:alchemical-sciences-methodology': 'embeds actions:quick-tincture',
  'classFeatures:alchemy': 'embeds classFeatures:quick-alchemy',
  'classFeatures:double-spellstrike': 'embeds actions:double-spellstrike',
  'classFeatures:explode': 'the name of aon:action-902',
  'classFeatures:first-implement-and-esoterica': 'embeds actions:exploit-vulnerability',
};
/** Wording merge (docs/card-design.md section 13, "A glyph sits in the line the page prints it in",
 *  2026-10-08): a glyph the page prints inside a line now draws inside that line, so a render whose glyph
 *  stood on a block of its own moves its <p>/<div> boundaries — accepted only when its inline content (every
 *  word, link and glyph span, in order) is the snapshot's (`inlineOf`). The search popup never gains or
 *  loses a word. (The four records that GAINED their activity header's use lines did so only on the
 *  held-record hideMeta body, which card step 22 removed with its snapshot renders.) */
/** How many of the 600 search popups moved only their block boundaries against card-step1-premove.json
 *  (the wording merge's 224 counted the three renders: 64 DescBody + 64 bare body + 96 search popup, as the
 *  base tree a19f00d's own dump splits them; card step 22 left the search popup alone). */
const MOVED_MODAL = 96;
/** The inline content of a render: its <p>/<div> tags taken out, whitespace collapsed. */
const inlineOf = (markup: string) => markup.replace(/<\/?(?:p|div)\b[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
/** Its words, a glyph as ⟨g⟩. */
const wordsOf = (markup: string) => inlineOf(markup).replace(/<span class="ast-ag"[^>]*>[^<]*<\/span>/g, ' ⟨g⟩ ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean);
/** Every word of `before` is in `now`, in order (only gains). */
function keepsEveryWord(before: string, now: string): boolean {
  const a = wordsOf(before);
  let i = 0;
  for (const w of wordsOf(now)) if (i < a.length && w === a[i]) i++;
  return i === a.length;
}
/** The markup with every embedded stub element (page, compact list, name) taken out, through the DOM. */
function without14bStubs(markup: string): string {
  const host = document.createElement('div');
  host.innerHTML = markup;
  host.querySelectorAll('[data-stub-list], [data-stub]').forEach((e) => e.remove());
  return host.innerHTML;
}

/** The tree render for one record: the search popup (the real DescriptionModal). Card step 22 removed the
 *  two held-record renders this returned beside it — the real DescBody page branch and the bare hideMeta
 *  body — with the paths themselves (every held-record popup is its record's 'mine' card). */
function astRenders(bucket: string, slug: string) {
  const rec = recs(bucket)[slug];
  const modal = wrap(
    <DescriptionModal root={{ title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs as never, key: bucket, slug }} onClose={noop} />,
  );
  return { modal };
}

function featEntry(r: { bucket: 'feats' | 'classFeatures'; id: string }, i: number): FeatEntry {
  const f = (db[r.bucket] as Record<string, Record<string, unknown>>)[r.id] as {
    name: string; level?: number; traits?: string[]; actionCost?: ActionCost; description?: string; descRefs?: never;
    rarity?: string; prerequisites?: string[]; category?: string;
  };
  const isFeature = r.bucket === 'classFeatures';
  return {
    key: `${r.bucket}:${r.id}`,
    name: f.name,
    level: f.level ?? 1,
    traits: f.traits ?? [],
    actionCost: f.actionCost,
    description: f.description ?? '',
    descRefs: f.descRefs,
    isFeature,
    bucket: isFeature ? 'class' : (f.category ?? 'general'),
    rarity: f.rarity,
    prerequisites: f.prerequisites,
    ...(isFeature ? { featureId: r.id } : { featId: r.id }),
    // Every fourth row runs an enhancement tier, so the Enhancement stat row is exercised too.
    ...(i % 4 === 0 ? { enhancedBy: 'Synthesized Enhancer' } : {}),
  };
}

/** Rendered popups for the three stat-row surfaces. */
const itemPopup = (id: string) =>
  wrap(<ItemDetail inv={{ instanceId: `noop-${id}`, itemId: id, quantity: 1 } as InventoryItem} item={db.items[id]} content={db} onClose={noop} />);
const featPopup = (r: { bucket: 'feats' | 'classFeatures'; id: string }, i: number) => wrap(<FeatDetail entry={featEntry(r, i)} onClose={noop} />);
const spellPopup = (id: string) => wrap(<SpellDetail spell={db.spells[id]} onClose={noop} />);

/** The stat rows a popup's markup shows, read off the DOM: [label, value text]. The Activate line of
 *  a feat reads [Activate, its glyph markup]; a spell's heightened-area suffix is not part of the row. */
function shownRows(markup: string): [string, string][] {
  const host = document.createElement('div');
  host.innerHTML = markup;
  const out: [string, string][] = [];
  for (const el of host.querySelectorAll('.sd-activate, .sd-stats .sd-stat')) {
    if (el.matches('.sd-activate')) {
      out.push(['Activate', el.innerHTML]);
      continue;
    }
    const v = el.querySelector('.sd-stat-v')!.cloneNode(true) as HTMLElement;
    v.querySelectorAll('.up-heighten').forEach((s) => s.remove());
    out.push([el.querySelector('.sd-stat-k')!.textContent ?? '', v.textContent ?? '']);
  }
  return out;
}

/** Markup through the same DOM round trip shownRows reads with, so serializer details cannot differ. */
function viaDom(markup: string): string {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host.innerHTML;
}
/** What each exported stat-row function says the popup prints, in shownRows' shape. A spell's Cast row
 *  holds no value in the function (the popup draws the glyph), so its value is compared blank. */
const itemRowsFn = (id: string): [string, string][] => itemStatRows(db.items[id], db).map((r) => [r.k, String(r.v)]);
const featRowsFn = (r: { bucket: 'feats' | 'classFeatures'; id: string }, i: number): [string, string][] =>
  featStatRows(featEntry(r, i)).map((row) =>
    row.k === 'Activate'
      ? ['Activate', viaDom(renderToStaticMarkup(<><strong>Activate</strong> <ActionGlyph cost={row.cost} /></>))]
      : [row.k, row.v],
  );
// Card step 16 (spells phase A): the popup's rows come from the spell's own page through spellCardModel
// (src/sheet/spellCard.ts), falling back to spellStatRows only when there is no spell/ritual page — so the
// ONE copy the popup prints is spellCardModel's rows, judged here with the same warm tree it renders from.
// batch card premise: ritual-213 "Area 50-foot radius emanation centered on you"
const spellRowsFn = (id: string): [string, string][] =>
  blankCast(spellCardModel(db.spells[id], trees.spells[id], spellStatRows(db.spells[id])).rows);
const blankCast = (rows: [string, string][]): [string, string][] => rows.map(([k, v]) => [k, k === 'Cast' ? '' : v]);

describe('card step 1 (G0): the move changes no markup', () => {
  it('draws 600 records with a page, 120 per bucket, and 60 per stat-row surface', () => {
    expect(sample.length).toBe(BUCKETS.length * PER_BUCKET);
    expect(new Set(sample.map((s) => `${s.bucket}:${s.slug}`)).size).toBe(sample.length);
    for (const b of BUCKETS) expect(sample.filter((s) => s.bucket === b).length, b).toBe(PER_BUCKET);
    expect([itemIds.length, featRows.length, spellIds.length]).toEqual([PER_SURFACE, PER_SURFACE, PER_SURFACE]);
  });

  it('each popup prints exactly the rows its exported stat-row function returns (one copy)', () => {
    let rows = 0;
    for (const id of itemIds) {
      const want = itemRowsFn(id);
      expect(shownRows(itemPopup(id)), `item ${id}`).toEqual(want);
      rows += want.length;
    }
    // Card step 11: the row is the record's mine card, which prints NO stat rows over a page (its printed
    // set is empty, so the page's own use lines show) and, on the no-page lane, only the Prerequisites row
    // of the same function (the glyph sits in the header, the enhancement in the box). The seeded sample
    // need not hold a no-page row WITH prerequisites (on 2026-10-07 none of its rows did);
    // test/card-feat.test.tsx pins that lane on dedication-to-the-five ("Order of the Godclaw").
    // batch card premise: feat-928 "Prerequisites Charisma 14"
    featRows.forEach((r, i) => {
      const want = recordTree(r.bucket, r.id, (b, s) => trees[b]?.[s]) ? [] : featRowsFn(r, i).filter(([k]) => k === 'Prerequisites');
      // batch card premise: feat-928 "Prerequisites Charisma 14"
      expect(shownRows(featPopup(r, i)), `${r.bucket} ${r.id}`).toEqual(want);
      rows += want.length;
    });
    for (const id of spellIds) {
      const want = spellRowsFn(id);
      expect(blankCast(shownRows(spellPopup(id))), `spell ${id}`).toEqual(want);
      rows += want.length;
    }
    // Not vacuous: every surface draws rows, and each feat row kind appears at least once.
    expect(rows).toBeGreaterThan(3 * PER_SURFACE);
    const featKinds = new Set(featRows.flatMap((r, i) => featStatRows(featEntry(r, i)).map((x) => x.k)));
    expect([...featKinds].sort()).toEqual(['Activate', 'Enhancement', 'Prerequisites']);
  });

  it.skipIf(!SNAP)('byte-equal to the pre-move render (CARD_NOOP_SNAPSHOT)', () => {
    const now = {
      ast: Object.fromEntries(sample.map(({ bucket, slug }) => [`${bucket}:${slug}`, astRenders(bucket, slug)])),
      items: Object.fromEntries(itemIds.map((id) => { const m = itemPopup(id); return [id, { markup: m, rows: shownRows(m) }]; })),
      feats: Object.fromEntries(featRows.map((r, i) => { const m = featPopup(r, i); return [`${r.bucket}:${r.id}`, { markup: m, rows: shownRows(m) }]; })),
      spells: Object.fromEntries(spellIds.map((id) => { const m = spellPopup(id); return [id, { markup: m, rows: shownRows(m) }]; })),
    };
    if (WRITE) {
      writeFileSync(SNAP!, JSON.stringify(now));
      return;
    }
    expect(existsSync(SNAP!), `snapshot ${SNAP} missing — write it on the pre-move tree with CARD_NOOP_WRITE=1`).toBe(true);
    const before = JSON.parse(readFileSync(SNAP!, 'utf8')) as typeof now;
    expect(Object.keys(now.ast)).toEqual(Object.keys(before.ast));
    // Card step 12 re-baseline: a record whose READ step 12 changed (its own section cut out of a family
    // page, its own text in place of a page that is not its own, its slice of a bigger page) draws a
    // different body by design. Those are pinned with their reason in STEP12_CHANGED_NOOP and must differ
    // (the search popup; until card step 22 the DescBody and bare-body renders too); every other render
    // stays byte-equal.
    // batch card premise: doctrine-4 "Second Doctrine (3rd)" — the record's own bullet of the doctrine page is its page.
    const keys = [...sample.map(({ bucket, slug }) => `${bucket}:${slug}`), ...itemIds.map((id) => `items:${id}`), ...featRows.map((r) => `${r.bucket}:${r.id}`)];
    const changed = step12Changed(keys);
    expect(changed).toEqual(STEP12_CHANGED_NOOP);
    // Card step 14b re-baseline: the search popup (modal) of a non-item page whose stubs resolve from a loaded
    // bucket draws them (an embedded page, a name) — pinned in STEP14B_CHANGED_NOOP; with those elements
    // taken out it is the pre-move popup, byte for byte.
    // batch card premise: class-feature-1281 "You gain the Double Spellstrike activity"
    const drawsStubs = Object.keys(now.ast).filter((k) => !k.startsWith('items:') && !(k in changed) && /data-stub/.test(now.ast[k].modal));
    expect(drawsStubs.sort()).toEqual(Object.keys(STEP14B_CHANGED_NOOP).sort());
    let diffs = 0;
    let moved = 0;
    const gained: string[] = [];
    for (const k of Object.keys(now.ast)) {
      for (const f of ['modal'] as const) {
        if (now.ast[k][f] !== before.ast[k][f]) diffs++;
        if (k in changed) continue;
        if (f === 'modal' && k in STEP14B_CHANGED_NOOP) {
          // batch card premise: class-feature-479 "all at least know how to make their innovation Explode"
          expect(now.ast[k][f], `${k} modal (${STEP14B_CHANGED_NOOP[k]}) changed`).not.toBe(before.ast[k][f]);
          // Wording merge: with the stubs out, the pre-move popup — byte for byte, or with only its block
          // boundaries moved (inlineOf).
          // batch card premise: class-feature-1281 "You gain the Double Spellstrike activity"
          expect(inlineOf(without14bStubs(now.ast[k][f])), `${k} modal: only the stubs changed`).toBe(inlineOf(viaDom(before.ast[k][f])));
          continue;
        }
        if (now.ast[k][f] === before.ast[k][f]) continue;
        // batch card premise: class-feature-1281 "You gain the Double Spellstrike activity" — a glyph the
        // page prints in a line draws in it; the words, links and glyphs stay, in order.
        if (inlineOf(now.ast[k][f]) === inlineOf(before.ast[k][f])) { moved++; continue; }
        gained.push(`${k} ${f}`);
        expect(f, `${k} modal: only its block boundaries may move`).not.toBe('modal');
        expect(keepsEveryWord(before.ast[k][f], now.ast[k][f]), `${k} ${f} keeps every word it drew`).toBe(true);
      }
      // batch card premise: doctrine-4 "Second Doctrine (3rd)" — card step 22: the search popup is the render left to differ (the DescBody render left with its path).
      if (k in changed) expect(now.ast[k].modal, `${k} (${changed[k]}) changed`).not.toBe(before.ast[k].modal);
    }
    // Wording merge: no search popup gains or loses a word; the boundary moves counted.
    // batch card premise: feat-5019 "Frequency once per hour" — card step 22: the gains were the hideMeta body's alone.
    expect(gained).toEqual([]);
    // Measured 2026-10-08 on main (2f6ee78 + the wording round) against card-step1-premove.json: 224 over the
    // three renders. Card step 22 (measured 2026-10-09 in the lane at a19f00d): the search popup's own share.
    // batch card premise: class-feature-1281 "You gain the Double Spellstrike activity"
    expect(moved, 'renders whose block boundaries moved').toBe(MOVED_MODAL);
    // Card step 11: the feat popups are the mine card by design (60 of 60 differ from the pre-move popup);
    // their stat rows are checked against the function below. Items: the rows only (card step 14).
    // batch card premise: feat-928 "Prerequisites Charisma 14"
    // Card step 16: the spell popups changed on purpose — each is pinned with its classes in
    // STEP16_CHANGED_NOOP and must differ exactly so (below); the byte-equal loop runs over the rest.
    // batch card premise: spell-2315 "Duration sustained up to 1 minute"
    expect(Object.keys(now.spells)).toEqual(Object.keys(before.spells));
    // Card step 17: a spell on the tree body (spellCardModel body 'tree') draws the page's prose, so its
    // body differs from the pre-move string by design ('tree body', pinned per spell below).
    // batch card premise: spell-1530 "A roaring blast of fire detonates at a spot you designate"
    const treeBodyOf = (k: string) => spellCardModel(db.spells[k], trees.spells[k], spellStatRows(db.spells[k])).body === 'tree';
    const spellChanged = Object.fromEntries(
      Object.keys(now.spells).map((k) => [k, step16SpellChange(now.spells[k], before.spells[k], treeBodyOf(k))] as const).filter(([, why]) => why),
    );
    expect(spellChanged).toEqual(STEP16_CHANGED_NOOP);
    for (const k of Object.keys(now.spells)) {
      const why = STEP16_CHANGED_NOOP[k] ?? '';
      // The lane marker names the lane spellCardModel chose — the one the rows came from.
      const lane = spellCardModel(db.spells[k], trees.spells[k], spellStatRows(db.spells[k])).lane;
      expect(now.spells[k].markup.includes(`data-lane="${lane}"`), `spell ${k} carries data-lane="${lane}"`).toBe(why.includes('lane marker'));
      // Only a page-lane popup changes its rows; the field lane prints the pre-move rows.
      if (why.includes('page rows')) expect(lane, `spell ${k} rows changed only on the page lane`).toBe('page');
      const model = spellCardModel(db.spells[k], trees.spells[k], spellStatRows(db.spells[k]));
      // Card step 17: every tree-body spell's body is the page's; a string-body spell keeps step 16's rule
      // — a stripped preamble is exactly the model's body differing from the plain heightening split.
      // batch card premise: spell-1530 "A roaring blast of fire detonates at a spot you designate"
      if (model.body === 'tree') expect(why.includes('tree body'), `spell ${k} draws the page body`).toBe(true);
      else expect(model.base !== splitHeightening(db.spells[k].description || '').base, `spell ${k} body stripped`).toBe(why.includes('preamble stripped'));
      // batch card: step17-nit7 — the no-page footer exactly on an official spell the spells bucket holds no page for.
      expect(why.includes('no-page footer'), `spell ${k} no-page footer`).toBe(!trees.spells[k] && !!db.spells[k].source?.book);
    }
    // Card step 14: the item popup's description is the shown record's mine card by design (its page lines
    // by the printed-set rule, the embedded group page, the no-page line). Its STAT ROWS do not move: the
    // frame prints the same itemStatRows, checked against the pre-move rows here.
    // batch card premise: weapon-group-15 "becoming off-guard until the start of your next turn"
    expect(Object.keys(now.items)).toEqual(Object.keys(before.items));
    for (const k of Object.keys(now.items)) expect(now.items[k].rows, `items ${k} rows`).toEqual(before.items[k].rows);
    // batch card premise: methodology-5 "You gain the Quick Tincture action" — card step 22: the search popup alone.
    expect(diffs).toBe(Object.keys(now.ast).filter((k) => k in changed && now.ast[k].modal !== before.ast[k].modal).length + Object.keys(STEP14B_CHANGED_NOOP).length + moved + gained.length);
    // The exported functions reproduce TODAY's rows — the rows the pre-move popups printed.
    for (const id of itemIds) expect(itemRowsFn(id), `item ${id} vs pre-move`).toEqual(before.items[id].rows);
    featRows.forEach((r, i) => expect(featRowsFn(r, i), `${r.bucket} ${r.id} vs pre-move`).toEqual(before.feats[`${r.bucket}:${r.id}`].rows));
    // Card step 16: a spell whose rows step 16 did not change still prints the pre-move rows through the
    // ONE copy; a 'page rows' spell prints today's page rows through that same copy (they differ from the
    // pre-move rows by the classification above).
    // batch card premise: spell-2315 "Duration sustained up to 1 minute"
    for (const id of spellIds) {
      if ((STEP16_CHANGED_NOOP[id] ?? '').includes('page rows')) expect(spellRowsFn(id), `spell ${id} page rows`).toEqual(blankCast(now.spells[id].rows));
      else expect(spellRowsFn(id), `spell ${id} vs pre-move`).toEqual(blankCast(before.spells[id].rows));
    }
  });
});
