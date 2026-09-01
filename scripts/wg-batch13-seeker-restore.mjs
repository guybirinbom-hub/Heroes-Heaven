/*
 * Restore Seeker of Truths' domain choice, which an earlier pass in this session destroyed.
 *
 * The record was modelled TWICE — `featFeatGrants['seeker-of-truths'] = ['domain-initiate']` rendered
 * Domain Initiate's own picker (offering the DEITY's domains) while the record's own
 * `effectChoices[domain]` asked the same question restricted to the three printed domains and granted
 * the spell. Removing the duplicate was right; removing THIS half was not, and the parity gate caught
 * it on the next run — the feat then granted nothing at all.
 *
 * ⚠ The mistake worth remembering: the overwrite was silent. The row-writer matches on
 * (category, id, field) and REPLACES, so authoring `{field:'effectChoices', value:null}` did not add a
 * deletion beside the original — it overwrote the only copy of it. Recovered from git HEAD.
 *
 * The duplicate that actually had to go is commented out in src/rules/featFeatGrants.ts.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const edit = {
  category: 'feats',
  id: 'seeker-of-truths',
  field: 'effectChoices',
  value: [
    {
      id: 'domain',
      prompt: 'Choose your domain (knowledge, secrecy, or truth) — you gain its domain spell',
      options: [
        { value: 'knowledge', label: 'Knowledge — Scholarly Recollection', grant: { focusSpells: ['scholarly-recollection'] } },
        { value: 'secrecy', label: 'Secrecy — Whispering Quiet', grant: { focusSpells: ['whispering-quiet'] } },
        { value: 'truth', label: 'Truth — Word of Truth', grant: { focusSpells: ['word-of-truth'] } },
      ],
    },
  ],
};

const rows = readBackfill(ROOT);
const at = rows.findIndex((r) => r.category === edit.category && r.id === edit.id && r.field === edit.field);
if (at >= 0) rows[at] = edit; else rows.push(edit);
writeBackfill(ROOT, rows);
console.log(`seeker-of-truths effectChoices restored (${at >= 0 ? 'replaced' : 'added'}; ${rows.length} rows).`);
