/*
 * WHAT A CREATED BACKGROUND PRINTS THAT ITS RECORD DOES NOT APPLY — the `partly` list of
 * scripts/trust-ledger.mjs, which src/sheet/TrustMarker.tsx turns into "shown, partly applied".
 *
 * Refuted 2026-09-24: the 25 created backgrounds took their boosts, skill, Lore and skill feat through
 * `backgroundFacets`, which took them off the ledger's `unencoded` list — and with it the marker, off
 * all 25. Seven print more than those four things (Azlanti Researcher's Azlant Lore and Azlanti
 * language, the Bastion of Blasphemies backgrounds' special rules), and that part still does nothing,
 * silently. Only the print can say what is missing, so this reads it.
 *
 * A background's rules follow its "Choose two attribute boosts" paragraph. The clauses a field carries
 * are checked against that field:
 *   · "You're trained in the X skill"           -> trainedSkill / trainedSkillChoice
 *   · "the Y Lore skill", "a Lore skill …"      -> trainedLore / trainedLoreOptions / trainedLoreByChoice
 *                                                  (an unnamed one also by trainedLoreChoice / choice)
 *   · "You gain the Z skill feat"               -> grantedFeatId / grantedFeatByChoice
 *   · "Add L to your list of known languages"   -> grantsLanguages
 * Every other sentence is read for the KIND of rule it prints — a named reaction or action, a
 * daily-preparation choice, a bonus or penalty, a resistance, extra damage. Those have no one field, so
 * they count as applied once the record carries any field beyond the clause fields (`otherRulesEncoded`,
 * which the generator works out): the parity batch encodes a record whole. A sentence naming none of
 * them is the page's prose and adds nothing.
 *
 * Returns the unapplied parts in the player's words, joined — '' when the record applies everything it
 * prints, or when there is no boosts paragraph to anchor on (then there is nothing to compare).
 */

/** The fields the clause checks below read. Anything else on a record is an encoded "other rule". */
export const CLAUSE_FIELDS = new Set([
  'trainedSkill', 'trainedSkillChoice', 'trainedLore', 'trainedLoreOptions', 'trainedLoreChoice',
  'trainedLoreByChoice', 'grantedFeatId', 'grantedFeatByChoice', 'grantsLanguages', 'languageChoicesBonus', 'choice',
]);

const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const NAME = "[A-Z][\\w'’-]*(?: [A-Z][\\w'’-]*)*";
const ABILITY = /^([A-Z][^()\n]{1,40}?) \((reaction|free action|one action|two actions|three actions|\d actions?)\)/;
/* Print order of the kinds, and their words. `situational` reuses TrustMarker's own phrase. */
const KINDS = [
  ['daily', /\b(?:daily preparations|every morning)\b/i, 'its daily-preparation choice'],
  ['situational', /\b(?:bonus|penalty)\b/i, 'its situational bonuses'],
  ['resistance', /\bresistance\b/i, 'its resistances'],
  ['damage', /\b(?:additional|extra) damage\b/i, 'its extra damage'],
];

export function backgroundUnapplied(rec, text, { otherRulesEncoded = false } = {}) {
  const paras = String(text ?? '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const at = paras.findIndex((p) => /^Choose two attribute boosts\b/i.test(p));
  if (at < 0) return '';
  // …up to the page's "---" / "## Background details" summary, which restates the same rules.
  const end = paras.findIndex((p, i) => i > at && /^(?:-{3,}|#)/.test(p));
  const rules = paras.slice(at + 1, end < 0 ? undefined : end);
  const block = rules.join('\n');
  const out = [];
  // A picked answer ("Guild Lore or Heraldry Lore", "Multilingual or Assurance") lives in `choice`.
  const picks = (rec.choice?.options ?? []).flatMap((o) => [o?.value, o?.label]).map(slug);
  const picked = (s) => picks.includes(s) || picks.includes(`${s}-lore`);

  const skill = new RegExp(`You['’]re trained in the (${NAME}) skill`).exec(block);
  if (skill && !/ Lore$/.test(skill[1]) && rec.trainedSkill !== slug(skill[1]) && !(rec.trainedSkillChoice ?? []).includes(slug(skill[1]))) {
    out.push(`${skill[1]} training`);
  }

  const lores = new Set([rec.trainedLore, rec.trainedLoreOptions, Object.values(rec.trainedLoreByChoice ?? {})].flat(2).filter(Boolean).map(slug));
  for (const m of block.matchAll(new RegExp(`\\bthe (${NAME}) Lore skill(?! feat)`, 'g'))) {
    if (!lores.has(slug(m[1])) && !picked(slug(m[1])) && !rec.trainedLoreChoice) out.push(`${m[1]} Lore`);
  }
  if (/\ba Lore skill\b(?! feat)/.test(block)) {
    // "a Lore skill focused on all fiends … This Fiend Lore skill" names it a sentence later.
    const named = new RegExp(`\\bThis (${NAME}) Lore skill`).exec(block)?.[1];
    const has = rec.trainedLoreChoice || rec.choice || (named ? lores.has(slug(named)) : lores.size > 0);
    if (!has) out.push(named ? `${named} Lore` : 'a Lore skill of your choice');
  }

  const feat = new RegExp(`You gain the (${NAME}) skill feat`).exec(block);
  if (feat && !rec.grantedFeatId && !rec.grantedFeatByChoice && !picked(slug(feat[1]))) out.push(`the ${feat[1]} skill feat`);

  for (const m of block.matchAll(/\bAdd ([A-Z][\w'’-]*) to your list of known languages/g)) {
    if (!(rec.grantsLanguages ?? []).includes(slug(m[1]))) out.push(`the ${m[1]} language`);
  }

  if (!otherRulesEncoded) {
    const abilities = [];
    const kinds = new Set();
    let penalty = false;
    let optionsOf = false;   // the "•" options under a daily-preparation sentence belong to it
    for (const p of rules) {
      if (/^[•·]/.test(p) && optionsOf) continue;
      optionsOf = false;
      const ab = ABILITY.exec(p);
      if (ab) { abilities.push(`the ${ab[1].trim()} ${ab[2] === 'reaction' || ab[2] === 'free action' ? ab[2] : 'action'}`); continue; }
      for (const s of p.split(/(?<=[.!?])\s+/)) {
        const k = KINDS.find(([, re]) => re.test(s));
        if (!k) continue;
        kinds.add(k[0]);
        if (k[0] === 'daily') optionsOf = true;
        if (/\bpenalty\b/i.test(s)) penalty = true;
      }
    }
    out.push(...abilities);
    for (const [k, , words] of KINDS) {
      if (kinds.has(k)) out.push(k === 'situational' && penalty ? 'its situational bonuses and penalties' : words);
    }
  }
  return out.join(', ');
}
