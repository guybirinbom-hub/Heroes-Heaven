/*
 * GUARD: AN ITEM THAT CASTS A SPELL "AT Nth RANK" MUST STORE IT AT Nth RANK.
 *
 * `heldSpells` is a rank → spell-ids map, and the rank is not decoration: build.ts copies the key
 * straight into the spellcasting entry's `repertoire`, and the heightening code turns that rank into
 * dice. A Jyoti's Feather (Greater) printing *"You cast 5th-rank Vital Beacon"* but stored under key 4
 * heals 4d10/4d8/4d6/4d4 where the book says 5d10/5d8/5d6/5d4 — and nothing on the sheet looks wrong.
 *
 * WIDENED (residue pass, 2026-08-27) — the original read ONE storage carrier (heldSpells) against ONE
 * text shape ("Nth-rank <Spell>", forward only), and ~31 wrong ranks hid behind what it could not see:
 *   - NAME LANE: the graded wand family prints the rank in the VARIANT TITLE — "Wand of Teeming
 *     Ghosts (3rd-Rank Spell)" — while the shared body says only "of the indicated rank".
 *   - REVERSED PROSE: "You cast <Spell> at 5th rank" / "as a 4th-rank spell" / "heightened to 6th".
 *   - MORE CARRIERS: item.spellSlot.rank, item.innateSpells[].rank, item.resonant.innateSpells[].rank.
 *
 * ⚠ DIRECTION RULE (see the action-cost badge memory): for evidence drawn from DESCRIPTION PROSE,
 * only printed > stored is evidence. Graded variants share ONE description body in this corpus, so a
 * LOWER number in the text is usually the base variant's clause, not this record's (measured:
 * greater-trident-of-the-azarketis stores 6 and its shared .d also says "5th-rank hydraulic torrent").
 * Evidence drawn from the record's OWN NAME is per-record and counts in BOTH directions.
 *
 * Permanent false-positive guards (each measured before being written):
 *   - "at Nth rank or higher" is a conditional TRIGGER, not a cast rank (dragon-eye).
 *   - "2nd-rank or 4th-rank <Spell>" is a player CHOICE — satisfied if ANY listed rank is stored
 *     (the-mountain-man).
 *   - "you can cast it at Nth rank" is a later-boon-stage clause about a different casting
 *     (elder-seed) — reversed matches whose span crosses "cast it" are skipped.
 *
 *   node scripts/held-spell-rank-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');
/* A record whose rank question is OWNER-QUEUED is excused, checkably: the id must actually sit in
 * work/owner-questions.json's open list (the same rule as the batch gate's OWNER-QUEUED verdict).
 * mask-of-the-mantis-major is the case: its "heightened to 5th-rank" sentence prints in the GREATER
 * block and the Major block is silent — a print gap, not a data error we may settle. */
const _oq = read('work/owner-questions.json') ?? {};
const ownerQueued = new Set([...(_oq.open ?? []), ...(_oq.deferred ?? [])].map((q) => q.id));

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const isCantrip = (sid) => (core.spells?.[sid]?.traits ?? []).includes('cantrip');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Forward: "5th-rank Vital Beacon", "4th rank Wall of Wind", "3rd-level Fear spell (DC 38)". */
const RANKED = /\b(\d+)(?:st|nd|rd|th)[- ](?:rank|level)\s+\*{0,2}_?([A-Za-z][A-Za-z' -]{2,40}?)_?\*{0,2}(?:\s+(?:spell|cantrip|ritual))?(?=[.,;)(—–]|\s+(?:as|and|from|with|at|on|or)\b|$)/g;
/** The record's own name/id carries the rank — per-record, so valid in BOTH directions. */
const NAME_RANK = /\((\d+)(?:st|nd|rd|th)[- ]Rank(?: Spell)?\)\s*$/i;
const ID_RANK = /-(\d+)(?:st|nd|rd|th)-rank(?:-spell)?$/;

const bad = [];
let checked = 0;
const flag = (id, spellId, printed, stored, lane) =>
  bad.push({ id, spellId, printed, stored: [...stored].sort((a, b) => a - b).join('/'), lane });

for (const [id, item] of Object.entries(core.items ?? {})) {
  if (ownerQueued.has(id)) continue;
  const text = String(descs.items?.[id]?.d ?? '').replace(/\s+/g, ' ');

  /* spellId → EVERY stored rank (a Set — the Fan of Soothing Winds casts Heal at 4th/3rd/2nd). */
  const storedAt = new Map();
  for (const [rank, ids] of Object.entries(item?.heldSpells ?? {})) {
    for (const s of ids ?? []) {
      if (!storedAt.has(s)) storedAt.set(s, new Set());
      storedAt.get(s).add(Number(rank));
    }
  }
  /* spellSlot: one held spell cast from a slot of a stated rank (144 items). */
  if (item?.spellSlot?.rank != null && item?.heldSpell) {
    if (!storedAt.has(item.heldSpell)) storedAt.set(item.heldSpell, new Set());
    storedAt.get(item.heldSpell).add(Number(item.spellSlot.rank));
  }
  /* innate grants, the item's own and the resonant power's. A grant whose rank is level-dependent
   * (heightenAt / heightenHalfLevel / heightenBySkill / heightenIfTradition) has no single printed
   * answer, and an at-will cantrip is rank 0 by design — both skipped. */
  for (const g of [...(item?.innateSpells ?? []), ...(item?.resonant?.innateSpells ?? [])]) {
    if (!g?.spellId || g.heightenAt || g.heightenHalfLevel || g.heightenBySkill || g.heightenIfTradition) continue;
    if (isCantrip(g.spellId)) continue;
    const eff = g.rank ?? core.spells?.[g.spellId]?.rank;
    if (eff == null) continue;
    if (!storedAt.has(g.spellId)) storedAt.set(g.spellId, new Set());
    storedAt.get(g.spellId).add(Number(eff));
  }
  if (!storedAt.size) continue;

  /* NAME LANE — both directions. The printed rank binds every non-cantrip spell the record casts.
   * When it fires it also SUPERSEDES the prose lanes for those spells: a graded variant's .d is the
   * whole family page, so its prose carries the SIBLINGS' rank clauses too (wand-of-pernicious-poison
   * (1st-Rank Spell) shares a page that also says "6th-rank spider sting" — the 6 belongs to the
   * 6th-rank sibling, and the name is the per-record truth). */
  const nameBound = new Set();
  const nm = NAME_RANK.exec(String(item?.name ?? '')) ?? ID_RANK.exec(id);
  if (nm) {
    const printed = Number(nm[1]);
    for (const [sid, ranks] of storedAt) {
      if (isCantrip(sid)) continue;
      checked++;
      nameBound.add(sid);
      if (!ranks.has(printed)) flag(id, sid, printed, ranks, 'name');
    }
  }

  if (!text) continue;

  /* CHOICE LISTS — "2nd-rank or 4th-rank Enlarge": satisfied when ANY listed rank is stored. */
  const choiceSatisfied = new Set();
  for (const m of text.matchAll(/\b(\d+)(?:st|nd|rd|th)[- ](?:rank|level)\s+or\s+(\d+)(?:st|nd|rd|th)[- ](?:rank|level)\s+\*{0,2}_?([A-Za-z][A-Za-z' -]{2,40}?)_?\*{0,2}\b/g)) {
    const sid = slug(m[3]);
    if (!storedAt.has(sid)) continue;
    if (storedAt.get(sid).has(Number(m[1])) || storedAt.get(sid).has(Number(m[2]))) choiceSatisfied.add(sid);
  }

  /* FORWARD PROSE — printed > stored only (the direction rule). */
  for (const m of text.matchAll(RANKED)) {
    const printed = Number(m[1]);
    const spellId = slug(m[2]);
    if (!storedAt.has(spellId) || choiceSatisfied.has(spellId) || nameBound.has(spellId)) continue;
    /* "at Nth rank or higher" is a conditional trigger, not a cast rank. */
    if (/^\s*or\s+(?:higher|lower)/.test(text.slice(m.index + m[0].length))) continue;
    checked++;
    if (isCantrip(spellId)) continue;
    const ranks = storedAt.get(spellId);
    if (![...ranks].some((r) => r >= printed)) flag(id, spellId, printed, ranks, 'prose');
  }

  /* REVERSED PROSE — "<Spell> … at 5th rank" / "heightened to 6th" — printed > stored only. */
  for (const [sid, ranks] of storedAt) {
    if (isCantrip(sid) || choiceSatisfied.has(sid) || nameBound.has(sid)) continue;
    const name = core.spells?.[sid]?.name;
    if (!name) continue;
    const re = new RegExp(
      esc(name) + String.raw`(?:\s+(?:spell|cantrip))?([^.;]{0,60}?)(?:(?:at|as an?)\s+(\d+)(?:st|nd|rd|th)[- ]?(?:rank|level)|heightened to (?:the )?(\d+)(?:st|nd|rd|th)[- ]?(?:rank|level)?)`,
      'gi',
    );
    for (const m of text.matchAll(re)) {
      /* "you can cast it at 4th rank" is a later-boon clause about a different casting. */
      if (/\bcast it\b/i.test(m[1] ?? '')) continue;
      /* The matched name may be the SUFFIX of a longer spell's name — the Oculus of Abaddon's
       * "subconscious suggestion (heightened to 8th level)" is a drawback casting of Subconscious
       * Suggestion, and the Suggestion matcher bites its tail. If the preceding word + the name
       * normalize to a DIFFERENT shipped spell, the clause is that spell's, not this one's. */
      const before = /([A-Za-z']+)\s*$/.exec(text.slice(0, m.index))?.[1];
      if (before && [...Object.values(core.spells ?? {})].some((s) => s?.name && slug(s.name) === slug(before + ' ' + name) && slug(s.name) !== slug(name))) continue;
      const printed = Number(m[2] ?? m[3]);
      if (!Number.isFinite(printed)) continue;
      if (/^\s*or\s+(?:higher|lower)/.test(text.slice(m.index + m[0].length))) continue;
      checked++;
      if (![...ranks].some((r) => r >= printed)) flag(id, sid, printed, ranks, 'prose-rev');
    }
  }
}

console.log(`${checked} item spell(s) carry an explicit printed-rank qualifier (name or prose).`);
if (!bad.length) {
  console.log('held-spell-rank: ok — every one is stored at the rank its record prints.');
  process.exit(0);
}
console.log(`\nheld-spell-rank: FAIL — ${bad.length} spell(s) are stored at a rank their record contradicts:\n`);
for (const b of bad.slice(0, 40)) console.log(`   ${b.id.padEnd(40)} ${b.spellId.padEnd(24)} printed ${b.printed}, stored ${b.stored}  [${b.lane}]`);
if (bad.length > 40) console.log(`   …and ${bad.length - 40} more`);
console.log(`\nThe rank becomes the spell's repertoire rank, so this is dice, not decoration.`);
process.exit(1);
