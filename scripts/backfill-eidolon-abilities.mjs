/*
 * Every eidolon type already printed its own abilities, and nothing structured them.
 *
 * Each of the 13 options carries "Eidolon Abilities *Initial* breath weapon; *Symbiosis* draconic
 * frenzy; *Transcendence* wyrm's breath" followed by a `## <name>` section with the full text of
 * each. The eidolon's block listed none of them, so Eidolon Symbiosis (7th) and Eidolon
 * Transcendence (17th) — two class features whose whole content is "you gain your eidolon type's
 * symbiosis/transcendence ability" — arrived empty.
 *
 * PARSED from each option's own description rather than typed in: 13 types x 3 tiers is exactly the
 * sort of list that goes stale silently, and a wording change should surface here as a failure.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

/** The level each tier arrives, from the class features that hand them over. */
const TIER_LEVEL = { initial: 1, symbiosis: 7, transcendence: 17 };

const core = JSON.parse(readFileSync(CORE, 'utf8'));
for (const [id, lvl] of Object.entries({ 'eidolon-symbiosis': 7, 'eidolon-transcendence': 17 })) {
  const f = core.classFeatures[id];
  if (!f) continue;
  if (f.level !== lvl) {
    console.error(`${id} is level ${f.level}, expected ${lvl} — the tier levels below would be wrong. Refusing to write.`);
    process.exit(1);
  }
}

const options = core.classes.summoner?.subclass?.options ?? [];
if (!options.length) {
  console.error('The summoner has no eidolon options — nothing to patch.');
  process.exit(1);
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/*
 * The app's own option description carries only the INITIAL ability's prose — the symbiosis and
 * transcendence sections are not in it, which is exactly why those two class features arrived empty.
 * The mirror's eidolon entries carry all three, so they are the source. Reading the app's text and
 * finding two thirds of it missing would have shipped 26 abilities that are a name and nothing else.
 */
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/eidolon';
if (!existsSync(MIRROR)) {
  console.error(`No AoN mirror at ${MIRROR} — refusing to write ability text from memory.`);
  process.exit(1);
}
/** eidolon type name → { initial|symbiosis|transcendence: {name, text} }. */
const fromMirror = new Map();
for (const f of readdirSync(MIRROR)) {
  if (f === '_index.json') continue;
  let j;
  try {
    j = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
  } catch {
    continue;
  }
  for (const r of Array.isArray(j) ? j : [j]) {
    const md = String(r.markdown ?? '');
    if (!r.name || !/Eidolon Abilities/.test(md)) continue;
    const head = md.replace(/\s+/g, ' ').match(/Eidolon Abilities\*{0,2}(.{0,220}?)<\/column>/);
    if (!head) continue;
    const names = {};
    for (const tier of Object.keys(TIER_LEVEL)) {
      const label = tier[0].toUpperCase() + tier.slice(1);
      const m = head[1].match(new RegExp(`\\*\\*${label}\\*\\*\\s*([^-<]+)`, 'i'));
      if (m) names[tier] = m[1].trim();
    }
    // Every `<title level="2">Name</title>` section and its prose. Links are unwrapped to their text.
    const sections = [...md.matchAll(/<title level="2"[^>]*>([^<]+)<\/title>([\s\S]*?)(?=<title level="2"|$)/g)].map(([, n, body]) => ({
      name: n.trim(),
      text: body
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }));
    const out = {};
    for (const [tier, want] of Object.entries(names)) {
      const sec = sections.find((s) => norm(s.name) === norm(want));
      if (sec) out[tier] = sec;
    }
    if (Object.keys(out).length === 3) fromMirror.set(norm(r.name), out);
  }
}
console.log(`[eidolons] ${fromMirror.size} eidolon types read from the mirror, all three tiers each`);

const entries = [];
const skipped = [];

for (const opt of options) {
  // The app names the option "Angel Eidolon"; the mirror names the type "Angel".
  const v = fromMirror.get(norm(opt.name)) ?? fromMirror.get(norm(String(opt.name).replace(/\s*eidolon$/i, '')));
  if (!v) {
    skipped.push(`${opt.id}: "${opt.name}" is not in the mirror with all three tiers`);
    continue;
  }
  const abilities = Object.keys(TIER_LEVEL).map((tier) => ({
    tier,
    level: TIER_LEVEL[tier],
    name: v[tier].name,
    text: v[tier].text,
  }));
  const empty = abilities.filter((a) => !a.text).map((a) => a.tier);
  if (empty.length) {
    skipped.push(`${opt.id}: ${empty.join('/')} has no prose — writing nothing for this type`);
    continue;
  }

  opt.eidolonAbilities = abilities;
  entries.push({
    category: 'classes',
    id: 'summoner',
    path: ['subclass', 'options', `id=${opt.id}`],
    field: 'eidolonAbilities',
    value: abilities,
  });
}

if (skipped.length) console.warn(`NOTES (${skipped.length}):\n  ` + skipped.join('\n  '));
if (entries.length !== options.length) {
  console.error(`only ${entries.length} of ${options.length} eidolon types resolved — refusing to write a partial set.`);
  process.exit(1);
}

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`wrote ${entries.length * 3} abilities across ${entries.length} eidolon types (backfill ${backfill.length} → ${next.length})`);
for (const e of entries) console.log(`  ${e.path[2]}: ${e.value.map((a) => a.name).join(' / ')}`);
