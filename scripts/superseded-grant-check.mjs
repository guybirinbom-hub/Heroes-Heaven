/*
 * GUARD: NOTHING GRANTS OR OFFERS A SUPERSEDED SPELL.
 *
 * A record stamped `edition: 'superseded'` is the LEGACY printing, kept so archive links resolve — it
 * is not what a character receives. Pointing a grant or a pick list at one hands the player the wrong
 * spell: Acid Splash's single-target attack instead of Caustic Blast's burst, Ghost Sound instead of
 * Figment.
 *
 * The parity read found ONE record doing this. Asking the question corpus-wide found thirteen options
 * across seven pick lists, plus a feat granting one outright. That gap between "one reported" and
 * "thirteen present" is why this is a guard and not a fix.
 *
 * Covers every route a spell reaches a player: `innateSpells`, `focusSpells`, `grantedSpells`,
 * `heldSpells`, an effect-choice option's grant, and the pick lists in featCantripGrants.ts.
 *
 *   node scripts/superseded-grant-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

/*
 * ⚠ TWO SPELLINGS OF THE SAME FACT, and the second one is why this line is not `=== 'superseded'`.
 *
 * Desk #158 (2026-09-12) re-marked every record whose reprint already ships beside it from
 * `superseded` to `edition: 'legacy'` + `remasteredAs`, so the hide-legacy toggle owns the pre/post
 * axis. That moved 27 of the corpus's 27 superseded SPELLS — acid-splash, ghost-sound, ray-of-frost,
 * the lot — out of the value this guard used to key on, which would have left it passing on an empty
 * set while every route it was written to catch went unprotected. `remasteredAs` is the durable
 * statement of "this is the old printing and the new one ships"; it is what the guard reads now.
 */
const isSuperseded = (id) => {
  const s = core.spells?.[id];
  return !!s && (s.edition === 'superseded' || !!s.remasteredAs);
};

/*
 * …AND ONE FIELD IS EXEMPT FROM THE WIDER HALF: `heldSpells`.
 *
 * A staff's or talisman's held spell is the item's OWN PRINTED LINE, copied from its page — not a
 * route we chose. Read from the live Archives on 2026-09-12, the REMASTERED printing of Judgement
 * Thurible (Major), equipment-2232-1952, Treasure Vault (Remastered) pg. 126:
 *
 *     **Activate** Cast a Spell; **Frequency** once per day;
 *     **Effect** You cast [_summon deific herald_](/Spells.aspx?ID=1007).
 *
 * A remaster page, naming the legacy spell and linking spell-1007 outright. Six routes read that way
 * (the Ghostcaller's Planchette, Wyrm Spindle, Wyrm Claw and Dragonprism Staff families with it), and
 * repointing them at the Incarnate reprints would make the record contradict the page — against the
 * owner's standing rule that the live page is the authority. `superseded` stays refused even here,
 * because those records the app hides unconditionally, so a printed line pointing at one is still a
 * dead end on the player's screen.
 *
 * The thirteen pick-list options and the outright feat grant this guard was written for are in the
 * other fields, and they keep the full desk-158 set.
 */
const refuses = (field, id) => (field === 'heldSpells' ? core.spells?.[id]?.edition === 'superseded' : isSuperseded(id));
/* Some of these fields hold a map or a single object rather than a list — `heldSpells` on an item is
 * keyed by rank, and a lone grant is sometimes written bare. Normalising here keeps the walk honest
 * instead of throwing on the first record that uses a different shape. */
const asList = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v).flat() : []);
const bad = [];

/* 1. Every record field that names spells. */
const SPELL_FIELDS = ['innateSpells', 'focusSpells', 'grantedSpells', 'heldSpells', 'grantedRepertoire'];
for (const bucket of Object.keys(core)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    if (!rec || typeof rec !== 'object') continue;
    for (const f of SPELL_FIELDS) {
      for (const g of asList(rec[f])) {
        const sid = typeof g === 'string' ? g : g?.spellId;
        if (sid && refuses(f, sid)) bad.push(`${bucket}/${id}.${f} → ${sid}`);
      }
    }
    /* 2. …and the same fields nested under an effect-choice option's grant. */
    for (const ec of rec.effectChoices ?? []) {
      for (const o of ec.options ?? []) {
        for (const f of SPELL_FIELDS) {
          for (const g of asList(o?.grant?.[f])) {
            const sid = typeof g === 'string' ? g : g?.spellId;
            if (sid && refuses(f, sid)) bad.push(`${bucket}/${id}.effectChoices[${ec.id}].${o.value}.${f} → ${sid}`);
          }
        }
      }
    }
    /* 3. …and a plain `choice` whose options carry grants. */
    for (const o of rec.choice?.options ?? []) {
      for (const f of SPELL_FIELDS) {
        for (const g of asList(o?.grant?.[f])) {
          const sid = typeof g === 'string' ? g : g?.spellId;
          if (sid && refuses(f, sid)) bad.push(`${bucket}/${id}.choice.${o.value}.${f} → ${sid}`);
        }
      }
    }
  }
}

/* 4. The pick lists, which are code rather than data. */
const src = readFileSync(join(ROOT, 'src/rules/featCantripGrants.ts'), 'utf8');
for (const m of src.matchAll(/^\s*'([a-z0-9-]+)':\s*\{[^\n]*options:\s*\[([^\]]*)\]/gm)) {
  for (const om of m[2].matchAll(/'([a-z0-9-]+)'/g)) {
    if (isSuperseded(om[1])) bad.push(`FEAT_CANTRIP_GRANTS['${m[1]}'] → ${om[1]}`);
  }
}

const supersededCount = Object.values(core.spells ?? {}).filter((s) => s.edition === 'superseded' || s.remasteredAs).length;
console.log(`${supersededCount} legacy-printing spell record(s) in the corpus (edition 'superseded', or 'legacy' + remasteredAs).`);
if (!bad.length) {
  console.log('superseded-grant: ok — nothing grants or offers one.');
  process.exit(0);
}
console.log(`\nsuperseded-grant: FAIL — ${bad.length} route(s) hand a player the legacy printing:\n`);
for (const b of bad) console.log(`   ${b}`);
console.log('\nRepoint each at the current printing. The legacy AoN page names it in `remaster_id`;');
console.log('scripts/fix-superseded-picks.mjs does this for the pick lists.');
process.exit(1);
