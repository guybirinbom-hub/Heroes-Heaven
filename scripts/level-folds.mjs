/*
 * LEVEL FOLDS — the generator of scripts/data/level-folds.json (docs/card-design.md section 3, section 9
 * row 13a; owner ruling Q1 = A, section 13).
 *
 * A 'mine' card folds the parts of a page the character does not have yet under one closed, dimmed line
 * ("At higher levels (k)"). The card never decides that with a regex at run time: it reads THIS ledger,
 * which is generated here from the shipped page trees and reviewed in the diff of every change, and
 * which scripts/level-folds-check.mjs proves equal to this generator's output and to the trees (both
 * ways) on any clone.
 *
 * What it lists, read from each page's own STRUCTURE (never from prose):
 *   pages      every LEVEL-TITLED section: a level-2/3 title at the top of a page whose right badge
 *              reads "Level N" or "Nth" (champion causes, barbarian instincts, research fields, practices,
 *              ways, styles, hunter's edges, eidolons, implements, elements, innovations, class pages,
 *              class archetypes). Each: {i (index in the stored tree), title, level, hash, gate?}.
 *              `gate` comes from src/sheet/cardScope.ts gateOf: the thaumaturge implement tiers, the
 *              kineticist element sections (the single-gate impulse junction marked) and the inventor
 *              innovation sections — sections the BUILD owns or not, not only the level.
 *   impulses   every kineticist impulse "Level (+N)" / "Level (Nth)" paragraph (a top-level paragraph
 *              opening with that bold label), with the feat's own level: the card highlights the ones
 *              that apply; nothing is hidden.
 *   pointers   a class-feature row that only POINTS at the subclass text (champion relentless-reaction
 *              "listed in your cause", barbarian raging-resistance "based on your instinct"): a feature
 *              of a class whose name equals a level-titled section title on that class's subclass pages
 *              and whose own text has none of those sections' words. The card shows the matching section.
 *   subclassPages  "classId:subclassId" → the subclass's page key, for the pointers.
 *
 * Excluded by bucket (EXCLUDED_BUCKETS): pages whose level badges belong to a creature stat block, not
 * to the character. Only TOP-LEVEL titles count: a title nested in an aside is a sidebar's.
 *
 * Every hash is src/sheet/cardScope.ts sectionHash / paragraphHash — the functions the card matches
 * with, imported through jiti, so the generator, the check and the screen cannot drift.
 *
 *   npx jiti scripts/level-folds.mjs            # print what it would write (counts)
 *   npx jiti scripts/level-folds.mjs --write    # write scripts/data/level-folds.json
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { foldText, gateOf, isLevelTitle, levelOfRight, paragraphHash, sectionEnd, sectionHash } from '../src/sheet/cardScope.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LEDGER = 'scripts/data/level-folds.json';

/** Buckets whose level badges are a creature's, not the character's (measured 2026-10-03: sidebar
 *  sample-stat-block "Danphy Mollwether · Level 3"; rules influence-stat-blocks nests the same one in an
 *  aside, which the top-level rule already skips). */
export const EXCLUDED_BUCKETS = {
  sidebar: 'a sample creature stat block ("Level 3" is the NPC\'s level)',
  rules: 'rules pages: a level badge there titles a sample stat block, never a character benefit',
};

const squashWs = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const IMPULSE_LABEL = /^Level \((?:\+(\d+)|(\d+)(?:st|nd|rd|th))\)$/;

function firstNonBlank(p) {
  return (p.c || []).find((x) => !(x.t === 'text' && !foldText(x).trim()));
}

/** The shipped trees, every bucket. */
export function loadTrees(root = ROOT) {
  const trees = {};
  const dir = join(root, 'public/ast');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json.gz')).sort()) {
    trees[f.replace(/\.json\.gz$/, '')] = JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString('utf8'));
  }
  return trees;
}

/** core.json with its split-out descriptions merged back (they ship beside it). */
export function loadCore(root = ROOT) {
  const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
  const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));
  for (const [bucket, records] of Object.entries(desc)) {
    const target = core[bucket];
    if (!target) continue;
    for (const [id, v] of Object.entries(records)) if (target[id] && v.d !== undefined) target[id].description = v.d;
  }
  return core;
}

/** The level-titled sections of one tree, in page order. */
export function levelSections(tree) {
  const top = tree?.c ?? [];
  const url = String(tree?.url ?? '');
  const pageTitle = squashWs(foldText(top.find((n) => n.t === 'title' && Number(n.level ?? 1) <= 1)));
  const out = [];
  for (let j = 0; j < top.length; j++) {
    if (!isLevelTitle(top[j])) continue;
    const title = squashWs(foldText(top[j]));
    const entry = { i: j, title, level: levelOfRight(top[j].right), hash: sectionHash(top, j) };
    const gate = gateOf(url, pageTitle, title);
    if (gate) entry.gate = gate;
    out.push(entry);
  }
  return out;
}

/** The impulse "Level" paragraphs of one feat tree, with the feat's own level. */
export function impulseEntries(tree) {
  const top = tree?.c ?? [];
  const head = top.find((n) => n.t === 'title' && Number(n.level ?? 1) <= 1);
  const fm = /^Feat\s+(\d+)$/i.exec(String(head?.right ?? '').trim());
  if (!fm) return [];
  const featLevel = Number(fm[1]);
  const out = [];
  for (let j = 0; j < top.length; j++) {
    if (top[j].t !== 'p') continue;
    const b = firstNonBlank(top[j]);
    if (!b || b.t !== 'b') continue;
    const m = IMPULSE_LABEL.exec(squashWs(foldText(b)));
    if (!m) continue;
    const entry = { i: j, hash: paragraphHash(top, j), featLevel };
    if (m[1]) entry.plus = Number(m[1]);
    else entry.at = Number(m[2]);
    out.push(entry);
  }
  return out;
}

/**
 * subclassPages: a class's subclass option → its page key. In order: the option's own class-feature
 * tree when it is a ledger page (classFeatures:justice); else a ledger page of the same Archives
 * category whose address carries the option record's aon id; else one whose title is the option's name,
 * with the subclass group's word dropped ("Dragon Instinct" → "Dragon"). Anything else stays unmapped
 * and is listed in the generator's output — never guessed.
 */
function subclassPagesOf(core, trees, pages) {
  const out = {};
  const unmapped = [];
  const urlOf = (key) => {
    const [b, ...rest] = key.split(':');
    return String(trees[b]?.[rest.join(':')]?.url ?? '');
  };
  const typeOf = (url) => url.replace(/\?.*$/, '');
  const idOf = (url) => /\?ID=(\d+)/.exec(url)?.[1];
  for (const cls of Object.values(core.classes ?? {}).sort((a, b) => a.id.localeCompare(b.id))) {
    const opts = cls.subclass?.options ?? [];
    if (!opts.length) continue;
    const direct = opts.filter((o) => pages[`classFeatures:${o.id}`]).map((o) => typeOf(urlOf(`classFeatures:${o.id}`)));
    const type = direct[0];
    const group = squashWs(cls.subclass?.name ?? '');
    for (const o of opts) {
      const own = `classFeatures:${o.id}`;
      if (pages[own]) { out[`${cls.id}:${o.id}`] = own; continue; }
      if (!type) continue;
      const cands = Object.keys(pages).filter((k) => typeOf(urlOf(k)) === type);
      const rec = core.classFeatures?.[o.id];
      const aonNum = /-(\d+)$/.exec(String(rec?.aonId ?? ''))?.[1];
      let hit = aonNum ? cands.filter((k) => idOf(urlOf(k)) === aonNum) : [];
      if (!hit.length) {
        const name = squashWs(o.name);
        const bare = group ? squashWs(name.replace(new RegExp(`\\s+${group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '')) : name;
        hit = cands.filter((k) => {
          const [b, ...rest] = k.split(':');
          const t = squashWs(foldText((trees[b]?.[rest.join(':')]?.c ?? []).find((n) => n.t === 'title' && Number(n.level ?? 1) <= 1)));
          return t.toLowerCase() === name.toLowerCase() || t.toLowerCase() === bare.toLowerCase();
        });
      }
      // A page shared by several records: prefer the subclass-category bucket's own record, then by key.
      const pick = [...new Set(hit)].sort((a, b) => (a.startsWith('classFeatures:') ? 1 : 0) - (b.startsWith('classFeatures:') ? 1 : 0) || a.localeCompare(b))[0];
      if (pick) out[`${cls.id}:${o.id}`] = pick;
      else unmapped.push(`${cls.id}:${o.id}`);
    }
  }
  return { subclassPages: out, unmapped };
}

/**
 * pointers: a feature of class C whose name equals a level-titled section title on C's subclass pages,
 * whose own tree has no level-titled section of its own, and whose own text shares none of those
 * sections' words (it points at them; it does not print them).
 */
function pointersOf(core, trees, pages, subclassPages) {
  const out = {};
  const near = [];
  for (const cls of Object.values(core.classes ?? {}).sort((a, b) => a.id.localeCompare(b.id))) {
    const subPages = Object.entries(subclassPages).filter(([k]) => k.startsWith(`${cls.id}:`)).map(([, v]) => v);
    if (!subPages.length) continue;
    const titles = new Map();
    for (const pk of subPages) for (const s of pages[pk] ?? []) {
      const k = s.title.toLowerCase();
      if (!titles.has(k)) titles.set(k, []);
      titles.get(k).push({ pk, s });
    }
    for (const f of cls.features ?? []) {
      const rec = core.classFeatures?.[f.featureId];
      if (!rec) continue;
      const hits = titles.get(squashWs(rec.name).toLowerCase());
      if (!hits) continue;
      const key = `classFeatures:${f.featureId}`;
      if (pages[key]) { near.push(`${key}: has level sections of its own`); continue; }
      const own = squashWs(foldText(trees.classFeatures?.[f.featureId] ?? { t: 'doc', c: [] }) || rec.description || '');
      // The row prints the subclass text itself when any matched section's body is inside it.
      const prints = hits.some(({ pk, s }) => {
        const [b, ...rest] = pk.split(':');
        const top = trees[b]?.[rest.join(':')]?.c ?? [];
        const body = squashWs(top.slice(s.i + 1, sectionEnd(top, s.i)).map(foldText).join(' '));
        return body.length > 20 && own.includes(body.slice(0, 60));
      });
      if (prints) { near.push(`${key}: prints the subclass text itself`); continue; }
      out[key] = { classId: cls.id, title: hits[0].s.title, level: Number(f.level ?? rec.level ?? 0) };
    }
  }
  return { pointers: out, near };
}

/** The whole ledger, from the trees and core.json. Pure: the same inputs give the same object. */
export function generateLevelFolds(root = ROOT, loaded = undefined) {
  const trees = loaded?.trees ?? loadTrees(root);
  const core = loaded?.core ?? loadCore(root);
  const pages = {};
  const impulses = {};
  for (const b of Object.keys(trees).sort()) {
    if (EXCLUDED_BUCKETS[b]) continue;
    for (const slug of Object.keys(trees[b]).sort()) {
      const tree = trees[b][slug];
      const secs = levelSections(tree);
      if (secs.length) pages[`${b}:${slug}`] = secs;
      if (b === 'feats') {
        const imp = impulseEntries(tree);
        if (imp.length) impulses[`${b}:${slug}`] = imp;
      }
    }
  }
  const { subclassPages, unmapped } = subclassPagesOf(core, trees, pages);
  const { pointers, near } = pointersOf(core, trees, pages, subclassPages);
  const ledger = {
    _about: 'GENERATED by scripts/level-folds.mjs from public/ast/*.json.gz and public/core.json — do not edit by hand; scripts/level-folds-check.mjs checks it both ways. docs/card-design.md section 3.',
    pages,
    impulses,
    pointers,
    subclassPages,
  };
  return { ledger, report: { unmapped, near } };
}

/** The ledger as written: one page / one pointer per line, so a review reads the diff. */
export function serialize(ledger) {
  const block = (obj) => {
    const ks = Object.keys(obj);
    if (!ks.length) return '{}';
    return `{\n${ks.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(obj[k])}`).join(',\n')}\n }`;
  };
  return `{\n "_about": ${JSON.stringify(ledger._about)},\n "pages": ${block(ledger.pages)},\n "impulses": ${block(ledger.impulses)},\n "pointers": ${block(ledger.pointers)},\n "subclassPages": ${block(ledger.subclassPages)}\n}\n`;
}

/** Counts for the summary line. */
export function ledgerCounts(ledger) {
  const secs = Object.values(ledger.pages).flat();
  return {
    pages: Object.keys(ledger.pages).length,
    sections: secs.length,
    gated: secs.filter((s) => s.gate).length,
    impulseFeats: Object.keys(ledger.impulses).length,
    impulseEntries: Object.values(ledger.impulses).flat().length,
    pointers: Object.keys(ledger.pointers).length,
    subclassPages: Object.keys(ledger.subclassPages).length,
  };
}

const IS_MAIN = process.argv.some((a) => /(^|\/)level-folds\.mjs$/.test(String(a).replace(/\\/g, '/')));
if (IS_MAIN) {
  const { ledger, report } = generateLevelFolds();
  const c = ledgerCounts(ledger);
  console.log(`level folds: ${c.pages} pages, ${c.sections} level-titled sections (${c.gated} gated on ownership), ${c.impulseEntries} impulse entries on ${c.impulseFeats} feats, ${c.pointers} pointer rows, ${c.subclassPages} subclass pages.`);
  if (report.unmapped.length) console.log(`level folds: subclass options with no page (unmapped, never guessed): ${report.unmapped.join(', ')}`);
  if (process.argv.includes('--verbose')) for (const n of report.near) console.log(`   not a pointer: ${n}`);
  if (process.argv.includes('--write')) {
    writeFileSync(join(ROOT, LEDGER), serialize(ledger));
    console.log(`level folds: wrote ${LEDGER}.`);
  }
}
