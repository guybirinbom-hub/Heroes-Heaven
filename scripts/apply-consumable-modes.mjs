// Turns the verified consumable extraction into item-attached modes.
//
// A consumable that changes you for a stated span of time is a MODE, not prose: drinking a
// bull's-strength mutagen has to move the Athletics number, and when it wears off the number has to
// come back. Modes already do exactly that, so the work here is data, not engine.
//
// Reads:  work/consumable-modes-raw.json   (extraction + adversarial verify pass)
//         work/consumable-display-only.json (timed states with no numbers, if present)
// Writes: scripts/data/consumable-modes.json  — the ONLY file the importer carries forward.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const raw = read('work/consumable-modes-raw.json');
const core = read('public/core.json');
const itemById = new Map(Object.entries(core.items));

// The verify pass returns a refutation with a `correction` holding the fixed record, so a refuted
// entry is a REVISION, not a rejection. Corrections win over the original extraction.
const merged = new Map();
for (const rec of raw.confirmed) merged.set(rec.id, rec);
let corrections = 0;
let uncorrected = [];
for (const ref of raw.refuted) {
  if (!ref.correction) { uncorrected.push(ref.id); continue; }
  try { merged.set(JSON.parse(ref.correction).id, JSON.parse(ref.correction)); corrections++; }
  catch { uncorrected.push(ref.id); }
}

// The three insight-coffee grades pick their skill when the coffee is BREWED, which is a crafting
// choice the app never records. A modifier with no `detail` would silently apply to every skill
// (modeMatches reads an absent detail as "all"), so they ship display-only with the number in the
// note — visible and honest, rather than wrong on eighteen skills.
const COFFEE = { 'insight-coffee-lesser': 2, 'insight-coffee-moderate': 3, 'insight-coffee-greater': 4 };
for (const [id, bonus] of Object.entries(COFFEE)) {
  if (!uncorrected.includes(id)) continue;
  merged.set(id, {
    id,
    verdict: 'display-only',
    duration: '1 hour',
    modeName: 'Insight Coffee',
    survivesRest: false,
    modifiers: [],
    note: `+${bonus} item bonus to checks with the single skill this coffee was brewed for (chosen when it was crafted). Apply it yourself — the app doesn't know which skill your cup is.`,
  });
  uncorrected = uncorrected.filter((x) => x !== id);
}

// Read from types.ts so the validator can never drift from the engine's own skill list.
const SKILL_IDS = new Set(
  fs.readFileSync(path.join(ROOT, 'src/rules/types.ts'), 'utf8')
    .match(/export const SKILLS = \[([\s\S]*?)\]/)[1]
    .match(/'[a-z]+'/g).map((s) => s.slice(1, -1)),
);
const SAVES = new Set(['fortitude', 'reflex', 'will']);

// A skill modifier with no `detail` normally means the extractor lost the skill's name, and
// modeMatches would then apply it to all sixteen. These six are the real exception: the text itself
// spans every skill and narrows by SITUATION instead ("checks to Recall Knowledge", "against hags"),
// so the detail is absent because there is nothing to put there. Allowlisted by id rather than by a
// pattern, so a new detail-less modifier from a later extraction gets flagged instead of waved through.
const CROSS_SKILL_OK = new Set([
  'hagbane-biscuit', 'cinnamon-seers',
  'drakeheart-mutagen-lesser', 'drakeheart-mutagen-moderate',
  'drakeheart-mutagen-greater', 'drakeheart-mutagen-major',
]);

const out = [];
const problems = [];
for (const rec of merged.values()) {
  const item = itemById.get(rec.id);
  if (!item) { problems.push(`${rec.id}: no such item`); continue; }
  if (rec.verdict === 'no-mode') continue;

  const mods = (rec.modifiers ?? []).filter((m) => {
    // An absent `detail` on a skill/save modifier means "every skill" / "every save" to
    // modeMatches. That is right for a blanket +1 to all saves and badly wrong for a bonus the text
    // pins to one skill, so a skill modifier without a detail is dropped rather than over-applied.
    if (m.target === 'skill' && !m.detail) {
      if (!CROSS_SKILL_OK.has(rec.id)) {
        problems.push(`${rec.id}: skill modifier with no detail — dropped`);
        return false;
      }
      if (!m.appliesWhen) {
        problems.push(`${rec.id}: allowlisted cross-skill modifier lost its condition — dropped`);
        return false;
      }
    }
    if (m.detail && m.target === 'skill' && !SKILL_IDS.has(m.detail)) {
      problems.push(`${rec.id}: unknown skill "${m.detail}" — dropped`);
      return false;
    }
    if (m.detail && m.target === 'save' && !SAVES.has(m.detail)) {
      problems.push(`${rec.id}: unknown save "${m.detail}" — dropped`);
      return false;
    }
    if (typeof m.value !== 'number' || !Number.isFinite(m.value) || m.value === 0) {
      problems.push(`${rec.id}: non-numeric value ${JSON.stringify(m.value)} — dropped`);
      return false;
    }
    return true;
  });

  out.push({
    id: `item-${rec.id}`,
    name: rec.modeName || item.name,
    fromItemId: rec.id,
    duration: rec.duration || undefined,
    survivesRest: rec.survivesRest || undefined,
    note: rec.note || undefined,
    modifiers: mods,
  });
}

out.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(ROOT, 'scripts/data/consumable-modes.json'), JSON.stringify(out, null, 1));

// Into core.json's `modes` bucket rather than a bundled JSON import: `modes` is already on the
// importer's CARRY_WHOLESALE list, so these survive a full `npm run data` regen, and core.json is
// fetched instead of bundled. Existing non-item modes in the bucket (if any) are left alone.
const CORE = path.join(ROOT, 'public/core.json');
core.modes = Object.fromEntries([
  ...Object.entries(core.modes ?? {}).filter(([, m]) => !m.fromItemId),
  ...out.map((m) => [m.id, m]),
]);
// MINIFIED — pretty-printing this file once added 4 MB for nothing.
fs.writeFileSync(CORE, JSON.stringify(core));

const withMods = out.filter((m) => m.modifiers.length > 0).length;
console.log(`${out.length} item modes (${withMods} move numbers, ${out.length - withMods} display-only)`);
console.log(`${corrections} verify-pass corrections applied`);
if (uncorrected.length) console.log(`uncorrected refutations: ${uncorrected.join(', ')}`);
if (problems.length) {
  console.log(`\n${problems.length} problems:`);
  for (const p of problems) console.log('  ' + p);
}
