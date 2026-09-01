/*
 * wg-item — print the Wanderer's Guide ITEM a `giveItem` operation points at.
 *
 * `giveItem` is how their side models anything that is mechanically an item, including things the book
 * does not call items at all: a heritage's unarmed attack, a stance's improvised weapon, a granted
 * shield. wg-show prints "giveItem" and stops, which tells you nothing — the whole encoding lives in
 * the item row it references, and that is precisely what a parity read has to compare against ours.
 *
 * Hooded Nagaji is the case that prompted this: their heritage is a bare `giveItem`, and the question
 * that mattered — does their venomous spit carry a weapon GROUP, when the printed text says it has
 * none? — is only answerable by opening item 13638.
 *
 *   node scripts/wg-item.mjs 13638
 *   node scripts/wg-item.mjs "Venomous Spit"
 *
 * NOTE ON LICENCE — work/wg/ is GPL-3.0 and this app ships proprietary. This script READS it to
 * describe a difference; nothing it prints may be copied into the repo as data. The printed rules
 * (Paizo/ORC, via the AoN mirror) remain the authority for content.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { untsv, parseOps, flattenOps } from './lib/wg-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DUMP = join(ROOT, 'work/wg/wg-data.sql');
if (!existsSync(DUMP)) { console.error('No dump at work/wg/wg-data.sql (gitignored on purpose).'); process.exit(2); }

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
if (!wanted) { console.error('usage: node scripts/wg-item.mjs <their item id | item name>'); process.exit(2); }

const sql = readFileSync(DUMP, 'utf8');
const start = sql.indexOf('COPY public.item (');
if (start < 0) { console.error('no public.item table in the dump'); process.exit(2); }
const header = sql.slice(start, sql.indexOf('\n', start));
const cols = header.slice(header.indexOf('(') + 1, header.lastIndexOf(')')).split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
const body = sql.slice(sql.indexOf('\n', start) + 1);
const end = body.indexOf('\n\\.');

const byId = wanted === String(Number(wanted));
let found = 0;
for (const line of body.slice(0, end).split('\n')) {
  if (!line) continue;
  const cells = line.split('\t');
  const row = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  const name = untsv(row.name ?? '');
  if (byId ? row.id !== wanted : name.toLowerCase() !== wanted.toLowerCase()) continue;
  found++;

  console.log(`=== ${name}  (their item id ${row.id}, level ${row.level}, rarity ${untsv(row.rarity ?? '')})`);
  /* `group` is the field the Hooded Nagaji question turns on — printed as-is, including when it is
   * empty, because "they set no group" is exactly as much of an answer as a group name would be. */
  for (const k of ['group', 'hands', 'bulk', 'price', 'usage', 'size', 'traits', 'availability']) {
    const v = untsv(row[k] ?? '');
    console.log(`  ${k.padEnd(12)} ${v === '\\N' || v === '' ? '(none)' : v}`);
  }

  const meta = untsv(row.meta_data ?? '');
  if (meta && meta !== '\\N') {
    try {
      const m = JSON.parse(meta);
      console.log('  meta_data:');
      for (const [k, v] of Object.entries(m)) {
        if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
        console.log(`    ${k} = ${JSON.stringify(v)}`);
      }
    } catch { console.log(`  meta_data (unparsed): ${meta.slice(0, 400)}`); }
  }

  const ops = parseOps(row.operations);
  if (ops.length) {
    console.log('  operations:');
    const out = [];
    for (const op of ops) flattenOps(op, out);
    for (const o of out) console.log(`    ${typeof o === 'string' ? o : JSON.stringify(o)}`);
  }
  const desc = untsv(row.description ?? '').replace(/\s+/g, ' ').trim();
  if (desc && desc !== '\\N') console.log(`\n  text: ${desc.slice(0, 500)}`);
  console.log('');
}
if (!found) console.error(`no item matched ${JSON.stringify(wanted)}`);
