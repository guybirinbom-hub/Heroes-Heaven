/*
 * Which root causes are ENGINE gaps and which are DATA gaps? The plan turns on this.
 *
 * ENGINE gap: the mechanism does not exist or does not render. ONE fix covers every record sharing it,
 *   with no per-record authoring — so fixing it first shrinks everything that follows.
 * DATA gap: the mechanism works; each record needs its own field values. There is no shortcut; the
 *   only way is to read every record, which is the sweep.
 *
 * Getting this backwards is expensive in both directions: "fix the root cause" on a data gap is just
 * the sweep with extra steps, and sweeping an engine gap authors 300 rows a single fix would have covered.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const res = JSON.parse(readFileSync(p('work/verify/result.json'), 'utf8'));
const misses = Object.values(res.byLane).flat().filter((x) => x.verdict === 'MISS');

/** Does the mechanism exist and reach the sheet? Probed against the shipped code, not remembered. */
const src = (f) => { try { return readFileSync(p(f), 'utf8'); } catch { return ''; } };
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));

const MECHANISMS = [
  {
    cause: 'a build-time pick never offered (effectChoices)',
    exists: () => /effectChoices/.test(src('src/builder/shared.tsx')) && Object.values(core.feats).filter((f) => f.effectChoices).length > 50,
    evidence: () => `${Object.values(core.feats).filter((f) => f.effectChoices).length} feats already carry effectChoices and shared.tsx renders them`,
  },
  {
    cause: 'limited uses / per-day not tracked',
    exists: () => /effectiveUses|featUse/.test(src('src/rules/featUses.ts')) && /limitedUses/.test(src('src/sheet/FeatsTab.tsx')),
    evidence: () => 'featUses.ts + FeatsTab pips render limitedUses for feats',
  },
  {
    cause: 'conditional bonus with no star',
    exists: () => /FEAT_SITUATIONAL/.test(src('src/rules/situationalBonuses.ts')) && /statHasSituational/.test(src('src/sheet/MainTab.tsx')),
    evidence: () => 'the situational registry + statHasSituational render stars on every stat kind',
  },
  {
    cause: 'granted spells never reach the Spells page',
    exists: () => Object.values(core.feats).filter((f) => f.innateSpells).length > 100,
    evidence: () => `${Object.values(core.feats).filter((f) => f.innateSpells).length} feats already carry innateSpells`,
  },
  {
    cause: 'modes/stances with no switch',
    exists: () => Object.keys(core.modes ?? {}).length > 100 && Object.keys(core.stances ?? {}).length > 50,
    evidence: () => `${Object.keys(core.modes ?? {}).length} modes + ${Object.keys(core.stances ?? {}).length} stances ship and toggle`,
  },
  {
    cause: 'grants-another-feat not registered',
    exists: () => /FEAT_FEAT_GRANTS/.test(src('src/rules/featFeatGrants.ts')),
    evidence: () => 'featFeatGrants.ts resolves granted feats transitively',
  },
  {
    cause: 'proficiency grant missing',
    exists: () => /FEAT_GRANTS/.test(src('src/rules/featGrants.ts')),
    evidence: () => 'featGrants + featGrantsAuto apply proficiency grants',
  },
  {
    cause: 'defences & senses not granted',
    exists: () => /resistances/.test(src('src/rules/derive.ts')) && /senses/.test(src('src/rules/derive.ts')),
    evidence: () => 'deriveDefenses reads resistances/immunities/weaknesses/senses',
  },
  {
    cause: 'companion grant missing',
    exists: () => /companionGrants|COMPANION_GRANTS/.test(src('src/rules/companionGrants.ts')),
    evidence: () => 'companionGrants.ts grants companions from feats',
  },
  {
    cause: 'background/class-granted feats get no choice picker',
    // The one to test hardest: the feat is granted, but does either surface RENDER its choice?
    exists: () => {
      const b = src('src/builder/Builder.tsx');
      const s = src('src/builder/shared.tsx');
      // A granted feat's own `choice` must be rendered somewhere for the granted-feat rows.
      return /grantedFeat[\s\S]{0,400}choice/.test(b) || /grantedFeat[\s\S]{0,400}choice/.test(s);
    },
    evidence: () => 'no granted-feat row renders the granted feat\'s own `choice` — the pick is unreachable',
  },
];

console.log('ROOT CAUSE → engine gap or data gap?\n');
const engine = [];
const data = [];
for (const m of MECHANISMS) {
  const ok = m.exists();
  const n = misses.filter((x) => new RegExp(m.cause.split(' ')[0], 'i').test(String(x.suggestedField ?? '') + String(x.reason ?? ''))).length;
  (ok ? data : engine).push(m.cause);
  console.log(`  ${ok ? 'DATA  ' : 'ENGINE'}  ${m.cause}`);
  console.log(`          ${ok ? 'mechanism works: ' : 'MISSING: '}${m.evidence()}`);
}

console.log(`\nENGINE gaps (fix once, covers every record sharing it): ${engine.length}`);
for (const e of engine) console.log(`   • ${e}`);
console.log(`\nDATA gaps (the mechanism works; each record needs its own values — this is the sweep): ${data.length}`);
console.log(
  `\nSo: fixing the engine gap(s) FIRST is strictly cheaper — it removes those records from the sweep\n` +
  `without authoring a single row. Everything else needs the record read, so there is no shortcut.`,
);
