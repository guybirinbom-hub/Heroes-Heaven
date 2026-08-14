/*
 * WHICH INNATE GRANTS SAY WHICH TRADITION THEY ARE CAST AT — and which ones let the app guess.
 *
 *   npm run scan:traditions            # the counts
 *   npm run scan:traditions -- --list  # every record, in every bucket
 *
 * An innate spell is cast at a TRADITION, and the record's own sentence almost always names it
 * ("you can cast Mind Reading as an innate occult spell once per day"). When the grant carries no
 * `tradition`, `buildCharacter` falls back to the SPELL's first listed tradition — which for
 * multi-tradition spells is simply whichever one the importer wrote first. That is not a missing
 * value on the sheet; it is a WRONG one:
 *
 *   Sense Thoughts prints "innate occult spell"    → the app showed Arcane
 *   Heroes' Call    prints "innate occult spell"   → the app showed Divine
 *   Elemental Wrath prints "innate primal spell"   → the app showed Arcane
 *
 * and the pooled innate entry's header is a MAJORITY VOTE over those per-spell traditions, so one
 * wrong grant can also mislabel the whole entry.
 *
 * ── THE DETECTOR ──────────────────────────────────────────────────────────────────────────────
 *
 * Anchored on the OUTCOME the sentence states — "<tradition> … innate" / "<tradition> … spell list",
 * either order, within one sentence's worth of characters — never on a condition. Measured against
 * records already known to be correct: it AGREES with 401 of the 452 grants that already carry an
 * authored tradition and CONTRADICTS none of them, which is what makes its 11 findings trustworthy.
 *
 * ⚠ A BROADER detector was written and REJECTED, with the measurement: scoping to "a sentence that
 * grants a spell" and matching "<tradition> … spell" found ZERO extra records and dropped the
 * corroborating agreements from 401 to 247, i.e. weaker evidence for the same answer. Do not
 * re-broaden it without measuring both numbers again.
 *
 * ⚠ KNOWN FALSE NEGATIVE, deliberately left: `basic-skysage-divination` prints "You can Cast this
 * Spell as an occult Oatia skysage spell" — a tradition named without the word "innate" or "spell
 * list". Its pick already carries `tradition: 'occult'`, so nothing is lost; it is recorded here so
 * the next person does not re-derive it as a gap or widen the regex to catch one record.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));

export const TRADITIONS = ['arcane', 'divine', 'occult', 'primal'];

const strip = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');

/** A record's printed text — descriptions live in the SECOND file, so both are merged here. */
export const textOf = (bucket, id) => strip(desc[bucket]?.[id]?.d ?? core[bucket]?.[id]?.description ?? '');

/** The traditions a record's own text names as the one it grants a spell at. */
export function traditionsNamed(text) {
  const t = text.toLowerCase();
  const out = new Set();
  for (const tr of TRADITIONS) {
    if (new RegExp(`\\b${tr}\\b[^.]{0,24}\\b(innate|spell list)\\b`).test(t)) out.add(tr);
    if (new RegExp(`\\b(innate|spell list)\\b[^.]{0,24}\\b${tr}\\b`).test(t)) out.add(tr);
  }
  return [...out];
}

/** The sentence a report should quote, so a reader can judge the finding without opening the file. */
export const grantSentence = (text) =>
  (text.split(/(?<=\.)\s+/).find((s) => /\binnate\b|\bspell list\b/i.test(s)) ?? '').trim();

/**
 * @returns {{
 *   todo: {key:string,spellId:string,tradition:string,wrongToday:string|null,sentence:string}[],
 *   contradicts: {key:string,spellId:string,data:string,text:string[]}[],
 *   authored: number, silent: {key:string,spellId:string,sentence:string}[], ambiguous: {key:string,spellId:string,named:string[],sentence:string}[],
 *   cantripTodo: {id:string,tradition:string,sentence:string}[], cantripEntries: number,
 * }}
 */
export function audit() {
  const todo = [];
  const contradicts = [];
  const silent = [];
  const ambiguous = [];
  let authored = 0;

  for (const bucket of Object.keys(core)) {
    const recs = core[bucket];
    if (!recs || typeof recs !== 'object') continue;
    for (const [id, rec] of Object.entries(recs)) {
      const grants = rec?.innateSpells;
      if (!Array.isArray(grants) || !grants.length) continue;
      const text = textOf(bucket, id);
      const named = traditionsNamed(text);
      const sentence = grantSentence(text);
      for (const g of grants) {
        if (!g?.spellId) continue;
        const key = `${bucket}/${id}`;
        // The tradition is the PLAYER's answer (Bone Magic's Special clause) — no static value can
        // state it and none should.
        if (g.traditionFromChoiceFlag) continue;
        if (g.tradition) {
          authored++;
          if (named.length && !named.includes(g.tradition))
            contradicts.push({ key, spellId: g.spellId, data: g.tradition, text: named });
          continue;
        }
        if (named.length === 1) {
          // What the app shows TODAY: the spell's own first tradition, which is what the fallback
          // picks. Recording it separates "missing, but right by luck" from "wrong on the sheet".
          const fallback = core.spells?.[g.spellId]?.traditions?.[0] ?? null;
          todo.push({ key, spellId: g.spellId, tradition: named[0], wrongToday: fallback === named[0] ? null : fallback, sentence });
        } else if (named.length) ambiguous.push({ key, spellId: g.spellId, named, sentence });
        else silent.push({ key, spellId: g.spellId, sentence });
      }
    }
  }

  /* The pick-a-cantrip half: FEAT_CANTRIP_GRANTS entries whose text names a tradition the spec omits.
   * Parsed from the registry's source rather than imported, so this stays a plain .mjs the guard test
   * and the applier can both load. */
  const reg = readFileSync(join(root, 'src/rules/featCantripGrants.ts'), 'utf8');
  const cantripTodo = [];
  let cantripEntries = 0;
  for (const m of reg.matchAll(/^ {2}'([^']+)': \{ prompt: (.*?), options:/gm)) {
    cantripEntries++;
    const [, id, head] = m;
    if (/\btradition(?:FromChoiceFlag|ByOption)?:/.test(head)) continue;
    const text = textOf('feats', id);
    const named = traditionsNamed(text);
    if (named.length === 1) cantripTodo.push({ id, tradition: named[0], sentence: grantSentence(text) });
  }

  return { todo, contradicts, authored, silent, ambiguous, cantripTodo, cantripEntries };
}

/* --- CLI ------------------------------------------------------------------------------------- */
const direct = process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);
if (direct) {
  const LIST = process.argv.includes('--list');
  const r = audit();
  console.log(`innate grants carrying a tradition        ${r.authored}`);
  console.log(`  …contradicting their own printed text   ${r.contradicts.length}   <- a WRONG value on the sheet`);
  console.log(`grants with NO tradition`);
  console.log(`  …whose text names exactly one           ${r.todo.length}   <- authorable now`);
  console.log(`     of those, WRONG on the sheet today   ${r.todo.filter((x) => x.wrongToday).length}`);
  console.log(`  …whose text names two (a player choice) ${r.ambiguous.length}`);
  console.log(`  …whose text names none                  ${r.silent.length}`);
  console.log(`FEAT_CANTRIP_GRANTS entries               ${r.cantripEntries}`);
  console.log(`  …bare, though their text names one      ${r.cantripTodo.length}`);

  for (const x of r.contradicts) console.log(`  CONTRADICTS ${x.key} ${x.spellId}: data ${x.data}, text ${x.text.join('/')}`);
  for (const x of r.todo) console.log(`  TODO ${x.key} ${x.spellId} -> ${x.tradition}${x.wrongToday ? `  (shows ${x.wrongToday} today)` : ''}`);
  for (const x of r.cantripTodo) console.log(`  TODO cantrip pick ${x.id} -> ${x.tradition}`);
  if (LIST) {
    console.log('\nnames TWO — the player chooses, which needs a choice, not a value:');
    for (const x of r.ambiguous) console.log(`  ${x.key} ${x.spellId} [${x.named.join('/')}]\n     ${x.sentence.slice(0, 150)}`);
    console.log('\nnames NONE — the book does not say, so neither do we:');
    for (const x of r.silent) console.log(`  ${x.key} ${x.spellId}\n     ${(x.sentence || '(no innate sentence)').slice(0, 150)}`);
  } else console.log('\n--list for the exempt records and why each is exempt.');
}
