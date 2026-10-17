import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { isPageLink, subPageRef, SUBPAGE_BUCKET } from '../scripts/lib/ast-link-ref.mjs';
import { buildReprintMap } from '../scripts/lib/reprint.mjs';

/**
 * PACKAGE M (2026-10-16): the swashbuckler's "Confident Evasion" auto-links "Evasion" to class-feature-25,
 * which is classFeatures/evasion's own page — and the shipped tree said `ref: 'classes:alchemist'`, so the
 * word opened the Alchemist class. The AST link resolver (resolveTo, scripts/import-core-v2.mjs) followed
 * class-feature-25's `superseded_by: 'class-56'` as if it were the feature's reprint; it is the reprint of
 * the PAGE the feature is printed on. The rule now lives in scripts/lib/ast-link-ref.mjs and is pinned here
 * on synthetic documents; the shipped half is the last describe block, and scripts/ast-link-carrier-check.mjs
 * (npm run verify) guards every link of every tree.
 *
 * The resolver below is resolveTo's shape in miniature (steps 1-3 of its comment, plus the new sub-page
 * rule), because the importer is a top-level script that cannot be imported. `usePageRule: false` is the
 * resolver as it was: the mutation the first `it` proves the rule is load-bearing against.
 */

type Doc = { id: string; category: string; name: string; superseded_by?: string; release_date?: string; url?: string; data?: { legacy_id?: string[]; remaster_id?: string[] } };
const docs = new Map<string, Doc>();
const add = (d: Doc) => docs.set(d.id, d);
add({ id: 'class-1', category: 'class', name: 'Alchemist', release_date: '2019-08-01', url: '/Classes.aspx?ID=1' });
add({ id: 'class-56', category: 'class', name: 'Alchemist', release_date: '2024-08-01', url: '/Classes.aspx?ID=56', data: { legacy_id: ['class-1'] } });
add({ id: 'class-feature-25', category: 'class-feature', name: 'Evasion', superseded_by: 'class-56', release_date: '2019-08-01', url: '/Classes.aspx?ID=1', data: { remaster_id: ['class-56'] } });
// a legacy feature the class hop DOES pair (the reprint's legacy_id names the old class; one feature of that name)
add({ id: 'class-feature-4', category: 'class-feature', name: 'Formula Book', superseded_by: 'class-56', release_date: '2019-08-01', url: '/Classes.aspx?ID=1', data: { remaster_id: ['class-56'] } });
add({ id: 'class-feature-900', category: 'class-feature', name: 'Formula Book', release_date: '2024-08-01', url: '/Classes.aspx?ID=56', data: { legacy_id: ['class-1'] } });
// a feature with no record of its own anywhere
add({ id: 'class-feature-1209', category: 'class-feature', name: 'Ability Boost', superseded_by: 'class-56', release_date: '2019-08-01', url: '/Classes.aspx?ID=1' });
// a spell replaced by a ritual: a page of its own, not a sub-page
add({ id: 'spell-377', category: 'spell', name: 'Wish', superseded_by: 'ritual-125', release_date: '2019-08-01' });
add({ id: 'ritual-125', category: 'ritual', name: 'Wish', release_date: '2023-08-01', data: { legacy_id: ['spell-377'] } });
// a sidebar whose prose was reprinted as a rules page OF THE SAME NAME (sidebar-2312 "Building an Infiltration")
add({ id: 'sidebar-2312', category: 'sidebar', name: 'Building an Infiltration', superseded_by: 'rules-9', release_date: '2020-01-01' });
add({ id: 'rules-9', category: 'rules', name: 'Building an Infiltration', release_date: '2024-01-01' });

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/* idMap holds the documents that were NOT pruned, as import-core-v2 builds it. */
const idMap: Record<string, { bucket: string; slug: string }> = {
  'class-56': { bucket: 'classes', slug: 'alchemist' },
  'class-feature-900': { bucket: 'classFeatures', slug: 'formula-book-player-core' },
  'ritual-125': { bucket: 'spells', slug: 'wish' },
  'rules-9': { bucket: 'rules', slug: 'building-an-infiltration' },
};
const BUCKET: Record<string, string> = { ...SUBPAGE_BUCKET, spell: 'spells', ritual: 'spells', class: 'classes', rules: 'rules' };
/* the records that ship */
const db: Record<string, Record<string, object>> = {
  classes: { alchemist: {} },
  classFeatures: { evasion: {}, 'formula-book': {}, 'formula-book-player-core': {} },
  spells: { wish: {} },
  rules: { 'building-an-infiltration': {} },
};
const live = (h: { bucket: string; slug: string }) => !!db[h.bucket]?.[h.slug];
const supIdInfo = (id: string) => {
  const d = docs.get(id);
  return d?.superseded_by ? { id, bucket: BUCKET[d.category], slug: slug(d.name), by: d.superseded_by } : undefined;
};
const reprints = buildReprintMap(docs);

function resolve(to: string, { usePageRule = true, withReprints = true } = {}): string | null {
  const hit = idMap[to];
  if (hit) return `${hit.bucket}:${hit.slug}`;
  const pageLink = (i: { id: string; by: string }) => usePageRule && isPageLink(docs.get(i.id), docs.get(i.by));
  const mine = supIdInfo(to);
  if (mine && pageLink(mine)) return subPageRef(to, mine, { idMap, live, reprints: withReprints ? reprints : undefined });
  let info = supIdInfo(to), guard = 0;
  while (info && guard++ < 8 && !pageLink(info)) {
    const win = idMap[info.by];
    if (win && live(win)) return `${win.bucket}:${win.slug}`;
    info = supIdInfo(info.by);
  }
  const own = supIdInfo(to);
  return own && live(own) ? `${own.bucket}:${own.slug}` : null;
}

describe('a link to a class feature opens the feature, not the class it is printed in', () => {
  it('Evasion (class-feature-25 -> class-56) opens classFeatures/evasion; the old resolver opened the Alchemist class', () => {
    expect(resolve('class-feature-25')).toBe('classFeatures:evasion');
    // the mutation: the resolver without the sub-page rule is exactly the shipped bug
    expect(resolve('class-feature-25', { usePageRule: false })).toBe('classes:alchemist');
  });

  it('the newest printing of the feature itself wins over its own legacy record (R12 + the class-hop ruling)', () => {
    expect(resolve('class-feature-4')).toBe('classFeatures:formula-book-player-core');
    // with no reprint pairing at all, the legacy record of the same slug is what opens
    expect(resolve('class-feature-4', { withReprints: false })).toBe('classFeatures:formula-book');
    // and the old resolver sent both to the class
    expect(resolve('class-feature-4', { usePageRule: false })).toBe('classes:alchemist');
  });

  it('a feature with no record of its own opens nothing (inert text), never the page it is printed on', () => {
    // class-feature-1209 is the inventor's legacy Ability Boost: 119 background/class links opened the Inventor class
    expect(resolve('class-feature-1209')).toBeNull();
    expect(resolve('class-feature-1209', { usePageRule: false })).toBe('classes:alchemist');
  });

  it('a real cross-category reprint and a same-named sidebar reprint are still followed', () => {
    expect(isPageLink(docs.get('spell-377'), docs.get('ritual-125'))).toBe(false); // not a sub-page
    expect(resolve('spell-377')).toBe('spells:wish');
    expect(isPageLink(docs.get('sidebar-2312'), docs.get('rules-9'))).toBe(false); // same name = its own prose reprinted
    expect(resolve('sidebar-2312')).toBe('rules:building-an-infiltration');
  });

  it('isPageLink: only a sub-page, only another category, only another name, only a known target', () => {
    const cf = { category: 'class-feature', name: 'Evasion' };
    expect(isPageLink(cf, { category: 'class', name: 'Alchemist' })).toBe(true);
    expect(isPageLink(cf, { category: 'class-feature', name: 'Evasion' })).toBe(false);
    expect(isPageLink(cf, { category: 'class-feature', name: 'Juggernaut' })).toBe(false);
    expect(isPageLink(cf, undefined)).toBe(false);
    expect(isPageLink({ category: 'item-bonus', name: "Sage's Lash" }, { category: 'equipment', name: 'Staff of the Sage' })).toBe(true);
    expect(isPageLink({ category: 'feat', name: 'Evasion' }, { category: 'class', name: 'Alchemist' })).toBe(false);
  });

  it('subPageRef: null when nothing of its own ships', () => {
    expect(subPageRef('class-feature-1209', { bucket: 'classFeatures', slug: 'ability-boost' }, { idMap, live, reprints })).toBeNull();
  });
});

describe('the shipped trees (the repair, scripts/repair-subpage-link-refs.mjs)', () => {
  const ROOT = join(__dirname, '..');
  const AST = process.env.AST_DIR || join(ROOT, 'public/ast');
  const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
  const classes = JSON.parse(gunzipSync(readFileSync(join(AST, 'classes.json.gz'))).toString('utf8'));
  const links: { to: string; ref: string | null; text: string }[] = [];
  const text = (n: any): string => (n?.t === 'text' ? n.v ?? '' : (n?.c ?? []).map(text).join(''));
  (function walk(n: any) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.to != null) links.push({ to: n.to, ref: n.ref ?? null, text: text(n) });
    if (n.c) walk(n.c);
  })(classes.swashbuckler);

  // package I L8: I10c — the resolver above still sends class-feature-25 to classFeatures/evasion, never the
  // Alchemist class; the shipped auto-link is then made inert because classFeatures/evasion is in no class table
  // and its page (class-feature-25) is the ALCHEMIST's Evasion: an auto-link sending one word to another class's
  // feature from the swashbuckler's page is plain text (scripts/lib/ast-link-ref.mjs classWordInert).
  it("the swashbuckler's \"Evasion\" never opens the Alchemist class; since package I it is plain text (the Alchemist's feature is another class's page)", () => {
    const evasion = links.filter((l) => l.to === 'class-feature-25');
    expect(evasion.map((l) => l.text)).toEqual(['Evasion']);
    expect(evasion[0].ref).toBeNull();
    expect(core.classFeatures.evasion.aonId).toBe('class-feature-25');
  });

  it("no link on the swashbuckler's page to a class feature opens a class page (its \"ability boost\" opened the Inventor)", () => {
    const toClass = links.filter((l) => /^class-feature-/.test(l.to) && String(l.ref).startsWith('classes:'));
    expect(toClass).toEqual([]);
    expect(links.filter((l) => l.to === 'class-feature-1209').every((l) => l.ref === null)).toBe(true);
  });
});
