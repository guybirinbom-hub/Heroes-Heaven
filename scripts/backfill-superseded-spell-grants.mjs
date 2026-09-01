/*
 * REPOINT EVERY GRANT THAT NAMES A SUPERSEDED SPELL at the current printing.
 *
 * A record stamped `edition: 'superseded'` is the LEGACY printing, kept so archive links resolve. It is
 * not what a character receives — so a staff whose spell list names one hands the player the old spell:
 * Spiritual Weapon instead of Spiritual Armament, Shocking Grasp instead of Thunderstrike.
 *
 * The parity read found ONE such record (a pick list offering Ghost Sound). The guard built from it
 * found 48 routes, almost all of them items' `heldSpells`.
 *
 * ⚠ THE SUCCESSOR COMES FROM THE MIRROR, NEVER FROM A HAND-TYPED TABLE. Each legacy AoN page carries
 * `remaster_id` naming its replacement. Our corpus records that a spell IS superseded but not BY WHAT,
 * so any mapping written here would be a guess dressed as data. A legacy spell whose page names no
 * successor — or whose successor we do not ship — is REPORTED and left alone.
 *
 *   node scripts/backfill-superseded-spell-grants.mjs           # report
 *   node scripts/backfill-superseded-spell-grants.mjs --write
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/spell';
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
if (!existsSync(MIRROR)) { console.error(`no spell mirror at ${MIRROR}`); process.exit(2); }

const byAon = new Map(Object.entries(core.spells).map(([id, s]) => [String(s.aonId ?? ''), id]));
const cache = new Map();
function successorOf(spellId) {
  if (cache.has(spellId)) return cache.get(spellId);
  let out = null;
  const aon = String(core.spells[spellId]?.aonId ?? '');
  if (aon) {
    try {
      const page = JSON.parse(readFileSync(join(MIRROR, `${aon}.json`), 'utf8'));
      const to = [].concat(page.remaster_id ?? [])[0];
      const ours = to ? byAon.get(String(to)) : null;
      if (ours && core.spells[ours]?.edition !== 'superseded') out = ours;
    } catch { /* no page — leave null */ }
  }
  cache.set(spellId, out);
  return out;
}

/** Keep the FIRST option for each value — a list that offered both printings collapses to one. */
const dedupeByValue = (opts) => {
  const seen = new Set();
  return opts.filter((o) => { const k = String(o?.value ?? ''); if (seen.has(k)) return false; seen.add(k); return true; });
};

const SPELL_FIELDS = ['innateSpells', 'focusSpells', 'grantedSpells', 'heldSpells', 'grantedRepertoire'];
const ROWS = [];
const refused = [];

for (const bucket of Object.keys(core)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    if (!rec || typeof rec !== 'object') continue;
    for (const field of SPELL_FIELDS) {
      const v = rec[field];
      if (!v) continue;
      let touched = false;
      const remap = (g) => {
        const sid = typeof g === 'string' ? g : g?.spellId;
        if (!sid || core.spells[sid]?.edition !== 'superseded') return g;
        const to = successorOf(sid);
        if (!to) { refused.push(`${bucket}/${id}.${field}: ${sid} has no usable successor`); return g; }
        touched = true;
        return typeof g === 'string' ? to : { ...g, spellId: to };
      };
      /* `heldSpells` on an item is a map keyed by rank; the rest are arrays. Both shapes are rebuilt
       * in place so nothing else on the record is disturbed. */
      const next = Array.isArray(v)
        ? v.map(remap)
        : Object.fromEntries(Object.entries(v).map(([k, list]) => [k, Array.isArray(list) ? list.map(remap) : remap(list)]));
      if (touched) ROWS.push({ category: bucket, id, field, value: next });
    }

    /*
     * …and the SAME fields nested inside an option's grant, which the top-level walk cannot see. Most
     * of the remaining routes were here: a heritage offering a choice of cantrips grants each one from
     * inside its own option.
     *
     * ⚠ THE OPTION'S `value` IS OFTEN THE SPELL ID TOO. Repointing the grant alone leaves an option
     * labelled and keyed by the legacy spell while granting the current one — a record that looks fixed
     * and reads wrong. Both move together, and the label is refreshed from the new spell's name.
     */
    for (const listField of ['effectChoices', 'choice']) {
      const groups = listField === 'choice' ? (rec.choice ? [rec.choice] : []) : (rec.effectChoices ?? []);
      let touchedGroup = false;
      const nextGroups = groups.map((g) => ({
        ...g,
        /*
         * ⚠ DEDUPE AFTER REPOINTING. Several of these lists offered BOTH printings of the same spell —
         * the legacy record and its remaster replacement — so repointing collapsed two options onto one
         * id and left the picker showing the same choice twice. Caught by the referential-integrity
         * test ("an option list offers at least two distinct choices"), which is what that test is for.
         */
        options: dedupeByValue((g.options ?? []).map((o) => {
          let opt = o;
          for (const f of SPELL_FIELDS) {
            const list = opt?.grant?.[f];
            if (!Array.isArray(list)) continue;
            let hit = false;
            const mapped = list.map((x) => {
              const sid = typeof x === 'string' ? x : x?.spellId;
              if (!sid || core.spells[sid]?.edition !== 'superseded') return x;
              const to = successorOf(sid);
              if (!to) { refused.push(`${bucket}/${id}.${listField}.${o.value}.${f}: ${sid} has no usable successor`); return x; }
              hit = true;
              return typeof x === 'string' ? to : { ...x, spellId: to };
            });
            if (!hit) continue;
            touchedGroup = true;
            const movedTo = mapped.map((x) => (typeof x === 'string' ? x : x?.spellId)).find(Boolean);
            opt = {
              ...opt,
              grant: { ...opt.grant, [f]: mapped },
              /* Only when the option was KEYED by the spell — a value like 'acid' or 'yes' is its own
               * answer and must not be rewritten. */
              ...(opt.value === (typeof list[0] === 'string' ? list[0] : list[0]?.spellId)
                ? { value: movedTo, label: core.spells[movedTo]?.name ?? opt.label }
                : {}),
            };
          }
          return opt;
        })),
      }));
      if (touchedGroup) ROWS.push({ category: bucket, id, field: listField, value: listField === 'choice' ? nextGroups[0] : nextGroups });
    }
  }
}

console.log(`${ROWS.length} record(s) repointed:`);
const byWhat = {};
for (const r of ROWS) byWhat[`${r.category}.${r.field}`] = (byWhat[`${r.category}.${r.field}`] ?? 0) + 1;
for (const [k, n] of Object.entries(byWhat)) console.log(`  ${String(n).padStart(3)}  ${k}`);
for (const r of ROWS.slice(0, 8)) console.log(`     e.g. ${r.category}/${r.id}.${r.field}`);

if (refused.length) {
  const uniq = [...new Set(refused)];
  console.log(`\n${uniq.length} left alone (no usable successor):`);
  for (const r of uniq.slice(0, 10)) console.log(`   ${r}`);
}

if (!ROWS.length) process.exit(0);
if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`\nwrote ${added} new, ${replaced} replaced (${rows.length} rows).`);
