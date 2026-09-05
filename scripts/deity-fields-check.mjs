/*
 * DEITY FIELDS vs THE ARCHIVES — the deity sweep's instrument (2026-09-05).
 *
 * Wanderer's Guide has no deity table, so the deity lane is a PRINT read: every structured field a
 * deity record carries is compared with the mirror document its own aonId names
 * (C:/wonderers guide/aon-2e-archive/data/by-category/deity/<aonId>.json — AoN stores each deity's
 * block as FIELDS, not prose: domain_primary, domain_alternate, favored_weapon, divine_font, skill,
 * cleric_spell, sanctification + sanctification_raw, rarity, edict, anathema, area_of_concern).
 *
 *   node scripts/deity-fields-check.mjs            report + exit 1 when a structured field differs
 *   node scripts/deity-fields-check.mjs --write    also emit work/.deity-rows.json (the applier's spec)
 *   node scripts/deity-fields-check.mjs --verbose  print every difference, not the first 12 per field
 *
 * What is repaired by the spec: a field whose printed value resolves to ids we ship (domains, alternate
 * domains, divine font, rarity, a single skill, favoured weapons when every name is an item we ship,
 * cleric spells when every name is a spell we ship). What is only REPORTED: a printed name nothing of
 * ours resolves (a hand read), a deity with several skills (our record holds one), sanctification
 * (its choice shape is the owner's UX — compared, listed, and repaired only where the mapping is
 * mechanical), edict/anathema prose absent from the description, and current mirror deities we do not
 * ship at all.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/deity';
const WRITE = process.argv.includes('--write');
const VERBOSE = process.argv.includes('--verbose');

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));
const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));
const itemIds = new Set(Object.keys(core.items ?? {}));
const spellIds = new Set(Object.keys(core.spells ?? {}));
const descOf = (id) => {
  const v = descs.deities?.[id];
  return typeof v === 'string' ? v : (v?.d ?? v?.description ?? '');
};
// NFD + strip combining marks so "Déjà Vu" slugs to deja-vu, not d-j-vu.
const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const norm = (s) => String(s ?? '').toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
const page = (aonId) => {
  const p = join(MIRROR, `${aonId}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

/*
 * LEGACY → REMASTER RENAMES, read off the mirror itself: a remaster page names its legacy twin in
 * `legacy_id`, so slug(legacy name) → slug(remaster name) for spells (True Strike → Sure Strike, Mage
 * Armor → Mystic Armor, Resilient Sphere → Containment …) and domains (Nothingness → Void). Our ids are
 * the remaster names wherever a remaster exists, while a deity page from a legacy-only book prints the
 * legacy names — without this map 16 deities read as "unresolved" and 33 more as wrong.
 */
const renameMap = (category) => {
  const dir = join(MIRROR, '..', category);
  const byId = new Map();
  const docs = [];
  for (const f of readdirSync(dir)) {
    if (!/^[a-z-]+-\d+\.json$/.test(f)) continue;
    const doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    byId.set(doc.id, doc);
    docs.push(doc);
  }
  const map = new Map();
  for (const doc of docs) for (const lid of arr(doc.legacy_id)) {
    const legacy = byId.get(lid);
    if (legacy && slug(legacy.name) !== slug(doc.name)) map.set(slug(legacy.name), slug(doc.name));
  }
  return map;
};
const SPELL_RENAME = renameMap('spell');
const DOMAIN_RENAME = renameMap('domain');
/* A printed spell name resolves through OUR spell names first (our id for "Déjà Vu" is de-ja-vu, which
 * no slug of the name produces), then the raw slug, then the legacy → remaster rename. */
const spellByName = new Map(Object.values(core.spells ?? {}).map((s) => [slug(s.name), s.id]));
const spellSlug = (name) => {
  const s = slug(name);
  if (spellByName.has(s)) return spellByName.get(s);
  if (spellIds.has(s)) return s;
  const r = SPELL_RENAME.get(s);
  return r ? (spellByName.get(r) ?? r) : s;
};
const domainSlug = (name) => { const s = slug(name); return DOMAIN_RENAME.get(s) ?? s; };

/* Alternate domains: the field when AoN filled it; else the "**Alternate Domains** A, B" line of the
 * page's own markdown (Gozreh's field is empty while the block prints them); else the union minus the
 * primary list. */
const altDomains = (doc) => {
  const field = arr(doc.domain_alternate);
  if (field.length) return field;
  const m = String(doc.markdown ?? '').match(/\*\*Alternate Domains?\*\*\s*([^\n*]+)/i);
  if (m) return m[1].split(/\]\([^)]*\)|,/).map((s) => s.replace(/[\[\]]/g, '').trim()).filter((s) => s && !/^\(/.test(s));
  const primary = new Set(arr(doc.domain_primary).map(slug));
  return arr(doc.domain).filter((d) => !primary.has(slug(d)));
};

/* Sanctification: the raw phrase carries the semantics the list flattens away. */
const sanctFromRaw = (doc) => {
  const raw = norm(doc.sanctification_raw);
  const list = arr(doc.sanctification).map((s) => slug(s)).filter((s) => s === 'holy' || s === 'unholy');
  if (!list.length) return { options: [], mode: 'none', raw };
  if (/\bmust\b/.test(raw)) return { options: list, mode: 'must', raw };
  return { options: [...list, 'none'], mode: 'can', raw };
};
const ourSanct = (d) => {
  const ec = (d.effectChoices ?? []).find((e) => e.id === 'sanctification');
  return ec ? ec.options.map((o) => o.value) : [];
};

const FIELDS = ['domains', 'alternateDomains', 'divineFont', 'favoredWeapons', 'skill', 'spells', 'rarity', 'sanctification'];
const diffs = Object.fromEntries(FIELDS.map((f) => [f, []]));
const unresolved = { favoredWeapons: [], spells: [], skill: [] };
const multiSkill = [];
const printSilent = [];
const prose = { edict: [], anathema: [] };
const noPage = [];
const rows = [];
let checked = 0;

const KNOWN_SKILLS = new Set(['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery']);
const UNARMED = new Set(['fist', 'claw', 'jaws', 'bite', 'tail', 'horn', 'hoof', 'tentacle', 'wing']);

for (const [id, d] of Object.entries(core.deities ?? {})) {
  if (!/^deity-\d+$/.test(String(d.aonId ?? ''))) { noPage.push(id + ' (no aonId)'); continue; }
  const doc = page(d.aonId);
  if (!doc) { noPage.push(id + ' (' + d.aonId + ' not in the mirror)'); continue; }
  checked++;
  const why = (what) => `AoN ${d.aonId} (${doc.name}) prints ${what}`;
  const push = (field, value, what) => rows.push({ category: 'deities', id, field, value, why: why(what) });

  // domains / alternate domains — plain slug sets, every domain name is an id we hold.
  const pDom = arr(doc.domain_primary).map(domainSlug);
  const oDom = (d.domains ?? []).map(slug);
  if (!sameSet(pDom, oDom)) { diffs.domains.push(`${id}: ours ${oDom.join(',')} | print ${pDom.join(',')}`); if (pDom.length) push('domains', pDom, `domains ${pDom.join(', ')}`); }
  const pAlt = altDomains(doc).map(domainSlug);
  const oAlt = (d.alternateDomains ?? []).map(slug);
  if (!sameSet(pAlt, oAlt)) {
    // A page that lists NO alternate domains while ours does is AoN's optional list unfilled, not a
    // printed "none" (Gozreh, Arshea): reported, never deleted — the same "silence is no information"
    // rule the Foundry comparisons follow.
    if (!pAlt.length && oAlt.length) printSilent.push(`${id}: ours ${oAlt.join(',')} | page lists none`);
    else { diffs.alternateDomains.push(`${id}: ours ${oAlt.join(',') || '-'} | print ${pAlt.join(',') || '-'}`); push('alternateDomains', pAlt, `alternate domains ${pAlt.join(', ')}`); }
  }

  // divine font
  const pFont = arr(doc.divine_font).map(slug);
  const oFont = (d.divineFont ?? []).map(slug);
  if (!sameSet(pFont, oFont)) { diffs.divineFont.push(`${id}: ours ${oFont.join(',') || '-'} | print ${pFont.join(',') || '-'}`); push('divineFont', pFont, `divine font ${pFont.join(' or ')}`); }

  // rarity
  if (slug(doc.rarity || 'common') !== slug(d.rarity || 'common')) { diffs.rarity.push(`${id}: ours ${d.rarity} | print ${doc.rarity}`); push('rarity', slug(doc.rarity || 'common'), `rarity ${doc.rarity}`); }

  // favoured weapons — names → item ids
  const pWpn = arr(doc.favored_weapon).map(slug);
  const oWpn = (d.favoredWeapons ?? []).map(slug);
  if (!sameSet(pWpn, oWpn)) {
    diffs.favoredWeapons.push(`${id}: ours ${oWpn.join(',') || '-'} | print ${pWpn.join(',') || '-'}`);
    const bad = pWpn.filter((w) => !itemIds.has(w) && !UNARMED.has(w));
    if (bad.length) unresolved.favoredWeapons.push(`${id}: ${bad.join(', ')}`);
    else push('favoredWeapons', pWpn, `favored weapon ${arr(doc.favored_weapon).join(', ')}`);
  }

  // skill — one string on our side
  const pSkill = arr(doc.skill).map(slug);
  const oSkill = d.skill ? [slug(d.skill)] : [];
  if (pSkill.length > 1) multiSkill.push(`${id}: print ${pSkill.join(' or ')} | ours ${oSkill[0] ?? '-'}`);
  else if (!sameSet(pSkill, oSkill)) {
    diffs.skill.push(`${id}: ours ${oSkill[0] ?? '-'} | print ${pSkill[0] ?? '-'}`);
    if (pSkill.length && !KNOWN_SKILLS.has(pSkill[0])) unresolved.skill.push(`${id}: ${pSkill[0]}`);
    else push('skill', pSkill[0] ?? null, `divine skill ${arr(doc.skill).join(' or ') || 'none'}`);
  }

  // cleric spells — names → spell ids (the record's OWN page, so the edition's names)
  const pSp = arr(doc.cleric_spell).map(spellSlug);
  const oSp = (d.spells ?? []).map(slug);
  if (!sameSet(pSp, oSp)) {
    diffs.spells.push(`${id}: ours ${oSp.join(',') || '-'} | print ${pSp.join(',') || '-'}`);
    const bad = pSp.filter((s) => !spellIds.has(s));
    if (bad.length) unresolved.spells.push(`${id}: ${bad.join(', ')}`);
    else push('spells', pSp, `cleric spells ${arr(doc.cleric_spell).join(', ')}`);
  }

  // sanctification — compared through the raw phrase's semantics; reported, repaired only mechanically
  const ps = sanctFromRaw(doc);
  const os = ourSanct(d);
  // A page with NO sanctification phrase is a legacy-era printing (alignment, not sanctification):
  // ours may carry the remaster inference (Alocer, LE → unholy); print is silent, so ours is kept.
  if (!ps.raw && !arr(doc.sanctification).length && os.length) printSilent.push(`${id}: sanctification ${os.join('/')} | legacy page has no sanctification line`);
  else if (!sameSet(ps.options, os)) {
    diffs.sanctification.push(`${id}: ours ${os.join('/') || '-'} | print ${ps.options.join('/') || '-'} ("${ps.raw}")`);
    const label = (v) => (v === 'none' ? 'None' : v[0].toUpperCase() + v.slice(1));
    const others = (d.effectChoices ?? []).filter((e) => e.id !== 'sanctification');
    const choice = ps.options.length ? [{ id: 'sanctification', prompt: 'Sanctification', options: ps.options.map((v) => (v === 'none' ? { value: 'none', label: 'None', note: 'You take no sanctification.' } : { value: v, label: label(v) })) }] : [];
    const next = [...others, ...choice];
    push('effectChoices', next.length ? next : null, `sanctification "${ps.raw || 'none'}"`);
  }

  // prose presence — edicts and anathema reach the player through the description's stat block
  // ("**Edicts** …" / "**Anathema** …"). Wording differs between the Foundry-derived block and AoN
  // ("cherish, protect, respect" vs "cherish, protect, and respect"), so only a MISSING or EMPTY line
  // is a hole; a printed "none" is not owed.
  const desc = descOf(id);
  const line = (label) => (desc.match(new RegExp(`\\*\\*${label}\\*\\*\\s*([^\\n]*)`, 'i')) ?? [])[1]?.trim() ?? null;
  const owedEdict = doc.edict && norm(doc.edict) !== 'none' && !line('Edicts');
  const owedAnathema = doc.anathema && norm(doc.anathema) !== 'none' && !line('Anathema');
  if (owedEdict) prose.edict.push(`${id}: print "${String(doc.edict).slice(0, 80)}"`);
  if (owedAnathema) prose.anathema.push(`${id}: print "${String(doc.anathema).slice(0, 80)}"`);
  if ((owedEdict || owedAnathema) && desc) {
    // Append the missing stat-block line(s) to the CURRENT prose — never replace the description.
    const add = [owedEdict ? `**Edicts** ${String(doc.edict).trim()}` : '', owedAnathema ? `**Anathema** ${String(doc.anathema).trim()}` : ''].filter(Boolean);
    rows.push({ category: 'deities', id, field: 'description', value: desc.replace(/\s+$/, '') + '\n\n' + add.join('\n\n'), why: why(`${add.map((a) => a.split('**')[1]).join(' + ')} the description lacked`) });
  }
}

/* Current mirror deities we do not ship: a doc with a legacy_id is the remaster page, a doc with a
 * remaster_id is a legacy twin (skip), a doc with neither is single-edition. */
const ours = new Set(Object.values(core.deities ?? {}).map((d) => d.aonId));
const ourNames = new Set(Object.values(core.deities ?? {}).map((d) => slug(d.name)));
const missing = [];
for (const f of readdirSync(MIRROR)) {
  if (!/^deity-\d+\.json$/.test(f)) continue;
  const doc = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
  if (arr(doc.remaster_id).length) continue;
  if (ours.has(doc.id) || ourNames.has(slug(doc.name))) continue;
  missing.push(`${doc.id} ${doc.name} (${doc.deity_category ?? doc.type ?? ''}; ${doc.primary_source ?? ''})`);
}

const show = (label, list, limit = VERBOSE ? 1000 : 12) => {
  console.log(`\n--- ${label} (${list.length}) ---`);
  for (const l of list.slice(0, limit)) console.log('   ' + l);
  if (list.length > limit) console.log(`   … ${list.length - limit} more (--verbose)`);
};
console.log(`deity-fields: ${checked} deities compared with their own mirror page; ${noPage.length} without a page`);
for (const f of FIELDS) console.log(`   ${f.padEnd(17)} differs on ${String(diffs[f].length).padStart(3)} record(s)`);
console.log(`   edict prose absent from the description: ${prose.edict.length} · anathema absent: ${prose.anathema.length}`);
console.log(`   several printed skills (our record holds one): ${multiSkill.length}`);
console.log(`   printed names nothing of ours resolves — weapons ${unresolved.favoredWeapons.length}, spells ${unresolved.spells.length}, skills ${unresolved.skill.length}`);
console.log(`   current mirror deities we do not ship: ${missing.length}`);
for (const f of FIELDS) if (diffs[f].length) show(f, diffs[f]);
if (multiSkill.length) show('several skills', multiSkill);
if (printSilent.length) show('page lists no alternate domains, ours does (kept, not a diff)', printSilent);
for (const k of Object.keys(unresolved)) if (unresolved[k].length) show('unresolved ' + k, unresolved[k]);
if (prose.edict.length) show('edict absent', prose.edict);
if (prose.anathema.length) show('anathema absent', prose.anathema);
if (noPage.length) show('no page', noPage);
if (missing.length) show('not shipped', missing);

if (WRITE) {
  const byId = new Map();
  for (const r of rows) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
  const spec = { findings: [...byId].map(([id, rs]) => ({ id: `${id}#fields`, backfillRows: rs, note: 'deity sweep: structured fields aligned with the record\'s own AoN page' })) };
  writeFileSync(join(ROOT, 'work/.deity-rows.json'), JSON.stringify(spec, null, 1));
  console.log(`\nwrote work/.deity-rows.json — ${rows.length} row(s) on ${byId.size} deities`);
}
const hard = FIELDS.reduce((n, f) => n + diffs[f].length, 0);
process.exit(hard ? 1 : 0);
