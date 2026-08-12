/*
 * Stage 2b — SUB-BLOCK EXTRACTION.
 *
 * 701 Heroes Heaven records (660 subblock + 22 derived + 19 table) have no archive document of their
 * own: they are a SECTION inside a bigger page. This pulls each section out of its parent's ast so a
 * record can carry its own renderable content while the one source of truth stays the parent doc.
 *
 * The archive marks a section one of THREE ways — each verified against real docs:
 *
 *   title(level>=2)   "Curse of Ancestral Meddling" inside the mystery "Ancestors";
 *                     "Adept Benefit" inside the implement "Amulet".
 *                     Section = that title and every following sibling until the next title of the
 *                     same or higher rank.
 *
 *   b (bold run)      "Familiar of Balanced Luck" inside the patron "Spinner of Threads";
 *                     "Accept Echo" inside the feat "Echo of the Fallen".
 *                     Section = the block the bold leads, plus the following blocks that carry only
 *                     stat-block continuation labels (Frequency, Trigger, Effect, …). The bold is NOT
 *                     always the block's first child — feat-3750 puts a whitespace text node ahead of
 *                     it — so leading empty text is skipped.
 *
 *   table row         "Agate" in the rules page "Gems"; "Elegant cloth doll" in "Art Objects".
 *                     The name is in the SECOND cell (the first is the d% roll range), so every cell
 *                     is checked. Section = the header row + the matching row.
 *
 * `derived` records are deliberately NOT extracted: Heroes Heaven generates them from a whole parent
 * feature (the four Kinetic Gate elements, the seven Deviant Classifications), so the parent page IS
 * their content. Including them in the extraction pass only produced noise.
 *
 * Read-only with respect to the app: writes only scripts/migration/out/sections.json. Nothing is
 * taken from Foundry; a section that cannot be found is reported, never invented.
 *
 * Re-runnable.  node scripts/migration/extract.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join as pjoin } from 'node:path';

const ARCHIVE = 'C:/trying ai 2/hh-data-export/without-images/data';
const OUT = 'scripts/migration/out';

/** All visible text under a node, flattened. */
function textOf(n, acc = { s: '' }) {
  if (!n) return acc.s;
  if (n.v) acc.s += n.v;
  for (const c of n.c ?? []) textOf(c, acc);
  return acc.s;
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Does this label text name the section we want?
 *
 * Deliberately not an exact match: HH names a section `Adept Benefit (Amulet)` where the implement
 * page says only `Adept Benefit`, and `Curse of the Living Death` where the mystery says
 * `Curse of the Living Death`. So the archive label may be a PREFIX of HH's name, or equal to it.
 * Never the reverse — a label longer than the name would be a different, more specific section.
 */
function labelMatches(labelText, wanted) {
  const b = norm(wanted);
  if (!b) return false;

  /*
   * Mythic ikons label their abilities with the game term first, separated by an em dash:
   * the feat "Shield of Stone" carries `Transcendence—Brandish the Gorgon's Gaze`, and HH stores that
   * ability under the bare name. An en dash or a colon does the same job elsewhere, so the text after
   * the LAST such separator is always tried as well.
   */
  const variants = [
    labelText,
    String(labelText).split(/[—–:]/).pop(),
    String(labelText).replace(/\([^)]*\)/g, ' '),   // "gold piece (gp)" -> "gold piece"
  ];

  for (const v of variants) {
    const a = norm(v);
    if (!a) continue;
    if (a === b) return true;
    /*
     * Label shorter than the name — "adept benefit" for "Adept Benefit (Amulet)". The label must also
     * cover most of the name, or a generic stat-block FIELD swallows a specific record: the bare
     * "Bloodline" field on a sorcerer spell was matching "Bloodline: Aberrant" and extracting a
     * section with no body. Those are real `bloodline` documents of their own.
     */
    if (b.startsWith(a) && a.length >= 6 && a.length > b.length * 0.6) return true;
    /*
     * The reverse direction — a label LONGER than the name — is deliberately absent. It let the gem
     * `Alabaster` match the feat title `Alabaster Eyes`, `Emerald` match `Emerald Grasshopper`, and
     * `Obsidian` match `Obsidian Edge`: seven gems filed as sections of unrelated items. No length
     * ratio separates those from the real cases, because `obsidian` is 62% of `obsidian edge`.
     * The legitimate case it used to serve — label `Blunt Shot (Ranged Only)` for the record
     * `Blunt Shot` — is already covered by the paren-stripped variant above.
     */
    if (sameTokens(a, b)) return true;
  }
  return false;
}

/**
 * Same words in any order, ignoring plurals. The archive trails the qualifier where Heroes Heaven
 * leads with it — `Arbor Wine (Aged)` vs `Aged Arbor Wine`, `Hag Eye (Frightful)` vs
 * `Frightful Hag Eye` — and singularises coins, `gold piece (gp)` vs `Gold Pieces`.
 *
 * Equality of the whole multiset, so it cannot match on a shared word the way a prefix rule can.
 */
function sameTokens(a, b) {
  const set = (s) => s.split(' ').filter(Boolean).map((w) => w.replace(/s$/, '')).sort().join(' ');
  const sa = set(a);
  return sa.length > 0 && sa === set(b);
}

/**
 * PF2e stat blocks continue an activity across several bold-led blocks. These labels mean "still the
 * same activity"; any other bold run starts a new one and ends the section.
 */
const CONTINUATION = new Set([
  'frequency', 'trigger', 'requirements', 'requirement', 'effect', 'cost', 'prerequisites',
  'critical success', 'success', 'failure', 'critical failure', 'range', 'area', 'duration',
  'targets', 'target', 'special', 'level', 'activate', 'craft requirements', 'onset', 'saving throw',
]);

/** The bold run a block leads with, ignoring leading whitespace-only text. */
function leadingBold(block) {
  for (const c of block?.c ?? []) {
    if (!c) continue;
    if (c.t === 'b' || c.t === 'strong') return c;
    if (c.t && c.t !== 'text') return null;   // a real element that is not bold — not a labelled block
    if (String(c.v ?? '').trim()) return null; // visible text before any bold — not a labelled block
  }
  return null;
}

/**
 * Find the section named `wanted` inside `ast`.
 * Returns { kind, label, nodes } or null. `nodes` is a fresh array of ast nodes — the section itself.
 */
export function extractSection(ast, wanted, parentName = '') {
  if (!ast) return null;
  let best = null;

  /*
   * What the record's name adds to its parent's. `Black Dragon's Breath Potion (Adult)` inside
   * `Dragon's Breath Potion (Adult)` leaves `black` — and the table cell says "Black or copper",
   * because one row covers two dragons. Only used for table cells, where a bare word is unambiguous.
   */
  const residual = parentName ? norm(wanted).replace(norm(parentName), '').trim() : '';
  const cellMatches = (cell) => {
    const t = norm(textOf(cell));
    if (labelMatches(t, wanted)) return true;
    if (!residual) return false;
    return t.split(/\bor\b/).some((alt) => alt.trim() === residual);
  };

  // Walk every node that owns a child LIST, so we can take siblings from that list.
  (function walk(node) {
    const kids = node?.c;
    if (!Array.isArray(kids)) return;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (!k || best) break;

      // --- shape 1: a title that names the section ---
      if ((k.t === 'title' || k.t === 'heading') && labelMatches(textOf(k), wanted)) {
        const level = Number(k.level ?? 2);
        const nodes = [k];
        for (let j = i + 1; j < kids.length; j++) {
          const n = kids[j];
          const isTitle = n && (n.t === 'title' || n.t === 'heading');
          if (isTitle && Number(n.level ?? 2) <= level) break; // next section of the same or higher rank
          nodes.push(n);
        }
        best = { kind: 'title', label: textOf(k).trim(), nodes };
        return;
      }

      // --- shape 2: a block led by a bold run that names the section ---
      const lead = leadingBold(k);
      if (lead && labelMatches(textOf(lead), wanted)) {
        const nodes = [k];
        /*
         * Whether anything beyond the label itself has been collected. Some pages put the label in a
         * block of its own and the description in the NEXT, unlabelled block — the item "Tiger's-eye"
         * extracted as the bare string "Activate—Tiger's Eyes" until this was handled. An unlabelled
         * block still ends the section once a body exists, or every section would run to the page end.
         */
        const labelLen = norm(textOf(lead)).length;
        const hasBody = () => norm(nodes.map((n) => textOf(n)).join(' ')).length > labelLen + 4;

        for (let j = i + 1; j < kids.length; j++) {
          const n = kids[j];
          if (n && (n.t === 'title' || n.t === 'heading')) break;
          const b = leadingBold(n);
          if (b) {
            if (!CONTINUATION.has(norm(textOf(b)))) break;       // a new bold-led section
            nodes.push(n);
            continue;
          }
          if (hasBody()) break;                                  // unlabelled prose after a real body
          nodes.push(n);                                         // …but the body itself, if none yet
        }
        best = { kind: 'bold', label: textOf(lead).trim(), nodes };
        return;
      }

      /*
       * --- shape 4: a bold run inside a long paragraph ---
       * The inventor innovation pages put all 22 weapon modifications in ONE <p> with 131 children,
       * each introduced by a bold. There is no block to take, so the section runs from the bold to the
       * next bold that starts a new modification.
       */
      if ((k.t === 'b' || k.t === 'strong') && labelMatches(textOf(k), wanted)) {
        const nodes = [k];
        for (let j = i + 1; j < kids.length; j++) {
          const n = kids[j];
          if (n && (n.t === 'b' || n.t === 'strong') && !CONTINUATION.has(norm(textOf(n)))) break;
          nodes.push(n);
        }
        best = { kind: 'inline-bold', label: textOf(k).trim(), nodes };
        return;
      }

      // --- shape 3: a row of a table ---
      if (k.t === 'table') {
        const rows = [];
        (function rw(n) { if (!n) return; if (n.t === 'tr') rows.push(n); for (const c of n.c ?? []) rw(c); })(k);
        // The name is not always the first cell (Gems leads with a d% range), so check every cell.
        const hit = rows.find((r) => (r.c ?? []).some(cellMatches));
        if (hit) {
          const header = rows[0] !== hit ? [rows[0]] : [];
          best = { kind: 'table', label: wanted, nodes: [{ t: 'table', c: [...header, hit] }] };
          return;
        }
      }

      walk(k);
    }
  })(ast);

  return best;
}

// ---------------------------------------------------------------- run over the map
// No main-module guard: comparing import.meta.url to process.argv[1] is unreliable on Windows (the
// url is percent-encoded and triple-slashed, the argv path is not), and this file is only ever run
// directly. `extractSection` is still exported for a future importer.
{
  const { map } = JSON.parse(readFileSync(pjoin(OUT, 'map.json'), 'utf8'));

  // archive doc id -> doc (all 93 category files)
  const docs = new Map();
  for (const f of readdirSync(ARCHIVE).filter((x) => x.endsWith('.json'))) {
    let raw;
    try { raw = JSON.parse(readFileSync(pjoin(ARCHIVE, f), 'utf8')); } catch { continue; }
    // The export keys docs by their FULL id ("patron-2"), not the bare number — prefixing the
    // category again produced "patron-patron-2" and missed every lookup.
    for (const [id, d] of Object.entries(raw.docs ?? {})) {
      docs.set(id, d);
      if (d?.id) docs.set(String(d.id), d);
    }
  }
  console.log('archive docs loaded:', docs.size);

  // normalised label text -> doc ids that contain it as a bold / heading / table cell
  const labelIndex = new Map();
  for (const [id, d] of docs) {
    if (d?.id && d.id !== id) continue;                 // docs is double-keyed; index each doc once
    (function w(n) {
      if (!n) return;
      if (n.t === 'b' || n.t === 'strong' || n.t === 'title' || n.t === 'heading' || n.t === 'td') {
        const k = norm(textOf(n));
        if (k && k.length >= 3) {
          const arr = labelIndex.get(k);
          if (arr) { if (!arr.includes(id)) arr.push(id); } else labelIndex.set(k, [id]);
        }
      }
      for (const c of n.c ?? []) w(c);
    })(d.ast);
  }
  console.log('label index entries:', labelIndex.size);

  /*
   * `locate.py` kept up to 5 candidate parents per record but build-map.mjs only took the first, and
   * the first is often wrong: "Amber" was filed under the item "Eyes of the Eagle" (which mentions
   * amber) when it is really a row in the "Gems" rules table. Extraction is the arbiter — a candidate
   * that yields a section is the real parent — so try them all, best-first.
   */
  const candidates = new Map();   // "bucket|name" -> [docId, …]
  for (const [f, pick] of [['located.json', (j) => j.buckets], ['leftovers.json', null]]) {
    let j; try { j = JSON.parse(readFileSync(pjoin(OUT, f), 'utf8')); } catch { continue; }
    if (pick) {
      for (const [bucket, rows] of Object.entries(pick(j) ?? {})) {
        for (const r of rows) if (r.in?.length) candidates.set(`${bucket}|${r.name}`, r.in.map((x) => x.id));
      }
    } else {
      for (const r of j.found ?? []) {
        const key = `${r.bucket}|${r.name}`;
        const ids = (r.insideDocs ?? []).map((x) => x.id);
        candidates.set(key, [...(candidates.get(key) ?? []), ...ids]);
      }
    }
  }

  const out = {}, miss = [];
  // Records that turned out to BE a document rather than a section of one — see wholeDoc() below.
  const isTheDoc = [];
  let want = 0, got = 0, noParent = 0, viaAlt = 0;
  const byKind = {};

  for (const [bucket, records] of Object.entries(map)) {
    for (const [key, rec] of Object.entries(records)) {
      // `derived` is intentionally excluded — the parent page IS the content (see the header).
      if (!['subblock', 'table'].includes(rec.status)) continue;
      want++;

      // The mapped parent first, then every other candidate the stage-1 scans turned up.
      const tryIds = [rec.parentDocId, ...(candidates.get(`${bucket}|${rec.name}`) ?? [])]
        .filter((id, ix, all) => id && all.indexOf(id) === ix);

      /*
       * A section is only ACCEPTED if it carries a real body. A candidate that yields nothing but its
       * own label is a false match dressed as a success — `Lust` matched a stray bold in a background,
       * `Pride` one in an action — and it would ship as a page that looks migrated and renders blank.
       * Rejecting it lets the next candidate try; reporting not-found beats shipping an empty section.
       * 25 characters is comfortably below the smallest real section (a table row is ~49; median 290).
       */
      const bodied = (sec) => {
        const t = norm(sec.nodes.map((n) => textOf(n)).join(' '));
        return t.length >= 25 && t.length > norm(sec.label).length + 8;
      };

      /*
       * If the "section" is the WHOLE parent document, the record is not a section of anything — one of
       * two things is true, and the record's name against the parent's name tells them apart:
       *
       *   names near-equal   the record IS that document, under a slightly different spelling.
       *                      `Discomfiting Whispers` is the spell `Discomfiting Whisper` (spell-2139) —
       *                      the user confirmed this one by searching their own Archives app.
       *   names differ       the parent is simply wrong. The gem `Alabaster` is not the feat
       *                      `Alabaster Eyes`; it is a row in the Gems table.
       *
       * The first becomes a `doc`; the second is rejected so the next candidate gets a turn.
       */
      const wholeDoc = (sec, parent) => {
        const s = norm(sec.nodes.map((n) => textOf(n)).join(' ')).length;
        const p = norm(textOf(parent.ast)).length;
        return p > 0 && s / p > 0.9;
      };
      const namesAgree = (parent) => {
        const a = norm(rec.name).replace(/s$/, ''), b = norm(parent.name).replace(/s$/, '');
        return a === b || sameTokens(norm(rec.name), norm(parent.name));
      };

      /**
       * Walk a candidate list and return the first real section.
       * Returns {id, parent, sec}, the string 'doc' when the record turns out to BE one of the
       * candidates, or null. A candidate that fails any test is skipped so the next one gets a turn —
       * that is what lets the gems fall through their wrong parents and reach the Gems table.
       */
      const tryCandidates = (ids) => {
        for (const id of ids ?? []) {
          const parent = docs.get(id);
          if (!parent) continue;
          const sec = extractSection(parent.ast, rec.name, parent.name);
          if (!sec || !bodied(sec)) continue;
          if (wholeDoc(sec, parent)) {
            if (!namesAgree(parent)) continue;   // wrong parent — keep looking
            isTheDoc.push({ bucket, key, name: rec.name, docId: id, archiveName: parent.name });
            return 'doc';
          }
          return { id, parent, sec };
        }
        return null;
      };

      /*
       * The mapped parent and the stage-1 candidates first. Then, as a last resort, the label index:
       * `leftovers.py` capped its candidate list at 5 docs per name, which is why gems like `Garnet`
       * never got to try the `Gems` rules table that `Agate` extracted from. The label index knows
       * every doc carrying a matching bold / title / table cell, so ask it directly.
       */
      const hit = tryCandidates(tryIds) ?? tryCandidates(labelIndex.get(norm(rec.name)));

      if (hit === 'doc') continue;   // recorded in isTheDoc; build-map.mjs promotes it

      if (!hit) {
        const parent = docs.get(rec.parentDocId);
        if (!parent) noParent++;
        miss.push({
          bucket, key, name: rec.name, parentDocId: rec.parentDocId, parentName: parent?.name,
          tried: tryIds.length,
          why: parent ? 'no matching section in any candidate parent' : 'parent doc not in the export',
        });
        continue;
      }

      got++;
      if (hit.id !== rec.parentDocId) viaAlt++;
      byKind[hit.sec.kind] = (byKind[hit.sec.kind] ?? 0) + 1;
      (out[bucket] ??= {})[key] = {
        name: rec.name, parentDocId: hit.id, kind: hit.sec.kind, label: hit.sec.label,
        ...(hit.id !== rec.parentDocId ? { correctedFrom: rec.parentDocId } : {}),
        ast: { t: 'doc', c: hit.sec.nodes },
      };
    }
  }

  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  writeFileSync(pjoin(OUT, 'sections.json'), JSON.stringify(out, null, 1));
  writeFileSync(pjoin(OUT, 'sections-missing.json'), JSON.stringify(miss, null, 1));
  writeFileSync(pjoin(OUT, 'is-really-the-doc.json'), JSON.stringify(isTheDoc, null, 1));

  console.log(`\nsections wanted   ${want}`);
  console.log(`  extracted       ${got}  (${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  console.log(`    of which via a corrected parent: ${viaAlt}`);
  console.log(`  IS a doc, not a section: ${isTheDoc.length}  -> out/is-really-the-doc.json`);
  console.log(`  parent missing  ${noParent}`);
  console.log(`  not found       ${miss.length - noParent}`);
  console.log(`\nwrote ${OUT}/sections.json and sections-missing.json`);
}
