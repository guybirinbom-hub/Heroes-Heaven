/*
 * THE PIPS A REPRINT TWIN SHOWS, AGAINST THE ACTIVATIONS ITS OWN PAGE PRINTS (package I, L6b, 2026-10-17).
 *
 * scripts/lib/reprint-twin-gaps.mjs asks whether a twin CARRIES each rule field its legacy half carries.
 * That is a presence test, and it passed while five Major spellhearts tracked one use a day (print gives two
 * separate "Frequency once per day" Cast a Spell activations) and two Gatewalkers spellhearts showed four pips
 * (an old overlay row said {max:3}, the frequency fill added the page's one more) where print gives two. This
 * asks for the VALUE: the pips an item shows, `itemCounters` over the record the player is handed (the trust
 * gate on), against what the twin's own Archives page prints.
 *
 * PRINTED. A family page prints every grade's activation blocks, so the twin's own are cut out first
 * (`ownActivationScope`): the page head (the base item's block, which every grade shares) plus the section
 * under the grade's own level-2 title. In that scope each `**Frequency**` line is one activation. "Once per
 * day" twice is two pips, never one pool restated: the dedup scripts/lib/aon-facets.mjs printedFrequencies
 * does is right for a whole family page and wrong for one grade's own block.
 *
 * SHOWN. The `freq*` counters of itemCounters (the ones a Frequency line made), their `max` summed. A staff's
 * `pool`, a consumable's `uses` or a hand-authored pool is not an activation's pip and is left out of both sides.
 *
 * `scripts/data/twin-pip-allow.json` names the twins whose page restates a number on purpose (a grade that
 * replaces the base block's frequency) with the print evidence, as twin-gap-allow.json does for fields; an entry
 * with no reason excuses nothing, and one that no longer differs is reported for removal.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printedFrequencyLines } from './aon-facets.mjs';

export const MIRROR_DIR = process.env.AON_MIRROR || 'C:/wonderers guide/aon-2e-archive/data/by-category';

/* A plain path, not a URL object (see scripts/lib/reprint-twin-gaps.mjs: jsdom's URL is not node:fs's). */
const ALLOW_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'twin-pip-allow.json');

/** scripts/data/twin-pip-allow.json as `Map<'items/<twin>', reason>` (empty when absent). */
export function loadTwinPipAllow(file = ALLOW_FILE) {
  const out = new Map();
  if (!existsSync(file)) return out;
  for (const [key, why] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) {
    if (key !== '_' && typeof why === 'string' && why.trim()) out.set(key, why);
  }
  return out;
}

/** The mirror page `equipment-5153-4636` is stored at, or null when this machine has no Archives mirror. */
export function pageOf(aonId, mirror = MIRROR_DIR) {
  const file = join(mirror, String(aonId).replace(/-\d.*$/, ''), `${aonId}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/<[^>]+>|\]\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** The page head plus the section under the page's own level-2 title: the text ONE grade's activations sit in. */
export function ownActivationScope(doc) {
  const md = String(doc?.markdown ?? '');
  const marks = [...md.matchAll(/<title\s+level="2"[^>]*>([\s\S]*?)<\/title>/g)];
  const head = marks.length ? md.slice(0, marks[0].index) : md;
  const at = marks.findIndex((m) => norm(m[1]) === norm(doc?.name));
  const own = at < 0 ? '' : md.slice(marks[at].index, marks[at + 1]?.index ?? md.length);
  return head + own;
}

/** What the page prints: every Frequency line in the twin's own scope, and the wordings that did not parse. */
export function printedPips(doc) {
  const { lines, unread } = printedFrequencyLines(ownActivationScope(doc));
  return { pips: lines.reduce((n, f) => n + f.max, 0), lines: lines.length, unread };
}

/** What the sheet shows for one item: the `freq*` counters itemCounters hands out, their max summed. */
export function shownPips(counters) {
  const freq = (counters ?? []).filter((c) => /^freq\d*$/.test(String(c.id ?? '')));
  return { pips: freq.reduce((n, c) => n + c.max, 0), counters: freq.length };
}

/**
 * One row per offered twin whose pips differ from its page, as
 * `{ key, aonId, printed, shown, printedLines, shownCounters, note }`; `missing` lists the twins with no page to
 * read (a machine without the mirror skips the check rather than failing it).
 *
 * `twins`        — the ids findHiddenTwins offers (`db.hiddenTwins.keys()`);
 * `items`        — the records the player is handed (db.items, trust gate applied);
 * `countersOf`   — `(item) => itemCounters(item, a fresh instance)`, passed in because this file is plain JS.
 */
export function twinPipGaps({ twins, items, countersOf, mirror = MIRROR_DIR, allow = loadTwinPipAllow() }) {
  const rows = [];
  const missing = [];
  const excused = new Set();
  for (const id of [...twins].sort()) {
    const rec = items[id];
    const doc = rec?.aonId ? pageOf(rec.aonId, mirror) : null;
    if (!rec || !doc) { missing.push(`items/${id}`); continue; }
    const printed = printedPips(doc);
    const shown = shownPips(countersOf(rec));
    const key = `items/${id}`;
    const note = printed.unread.length ? ` (unreadable Frequency wording: ${printed.unread.join(' | ')})` : '';
    if (printed.pips === shown.pips && !printed.unread.length) continue;
    if (allow.has(key)) { excused.add(key); continue; }
    rows.push({ key, aonId: rec.aonId, printed: printed.pips, shown: shown.pips, printedLines: printed.lines, shownCounters: shown.counters, note });
  }
  return { rows, missing, excused: [...excused], unusedAllow: [...allow.keys()].filter((k) => !excused.has(k)) };
}
