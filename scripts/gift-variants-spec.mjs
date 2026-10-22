// Writes the spec for scripts/apply-parity-fixes.mjs: one `giftVariants` row per variant bloodline.
// Every gift is read from print (the Archives mirror pages named in each `why`) and resolved to our spell id.
// usage: node scripts/gift-variants-spec.mjs <repo root> work/bloodline-gifts-spec.json
//   then: node scripts/apply-parity-fixes.mjs work/bloodline-gifts-spec.json --write  (3 rows, each `supersedes`)
// Sorcerer bloodline gifts per dragon / element / genie (the owner's screenshot, 2026-10-21).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const ROOT = process.argv[2];
const OUT = process.argv[3];
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const core = read(ROOT + '/public/core.json');
const norm = (n) => n.toLowerCase().replace(/[’']/g, "'").trim();
const byName = new Map(Object.entries(core.spells).map(([id, s]) => [norm(s.name), id]));
const spell = (name) => {
  const id = byName.get(norm(name));
  if (!id) throw new Error(`no spell named "${name}"`);
  return id;
};
const opt = (id) => core.classes.sorcerer.subclass.options.find((o) => o.id === id);

/* ---- draconic: one variant per printed exemplar (draconic-exemplar-1..44) ---- */
const dragonDocs = [];
const dragons = [];
for (const f of readdirSync(MIRROR + '/draconic-exemplar')) {
  if (!f.endsWith('.json') || f === '_index.json') continue;
  const j = read(`${MIRROR}/draconic-exemplar/${f}`);
  const t = String(j.text ?? '').replace(/\s+/g, ' ');
  const gifts = [...t.matchAll(/- (\d)(?:st|nd|rd|th) ([^-]+?)(?= - \d|$)/g)].map((m) => ({ id: spell(m[2]), rank: Number(m[1]) }));
  if (gifts.map((g) => g.rank).join() !== '2,5,8') throw new Error(`${f}: gifts ${JSON.stringify(gifts)}`);
  dragons.push({ slug: norm(j.name), label: j.name, gifts, doc: f.replace('.json', '') });
}
const dc = opt('bloodline-draconic').dragonChoice;
// Our dragon list's order (the Foundry choice set): every printed exemplar must be one of its slugs.
for (const d of dragons) if (!dc.some((c) => c.slug === d.slug)) throw new Error(`exemplar ${d.slug} is not a dragonChoice slug`);
for (const d of dragons) {
  const c = dc.find((x) => x.slug === d.slug);
  const page = read(`${MIRROR}/draconic-exemplar/${d.doc}.json`);
  if (String(page.tradition).toLowerCase() !== c.tradition) throw new Error(`${d.slug}: tradition ${page.tradition} vs ${c.tradition}`);
}
dragons.sort((a, b) => dc.findIndex((c) => c.slug === a.slug) - dc.findIndex((c) => c.slug === b.slug));
for (const d of dragons) dragonDocs.push(d.doc);

/* ---- elemental and genie: the record's OWN text (newest printing; "specification comes from our own
 * text"). The elemental rows are then held against the Archives page bloodline-24 as a cross-check; the
 * genie page in our mirror (bloodline-11) still prints the pre-remaster names (djinni, efreeti, marid,
 * shaitan) and spells, which our record's text and Wanderer's Guide both replace. ---- */
const descs = read(ROOT + '/public/core-descriptions.json');
const ownText = (id) => String(descs.classFeatures[id].d).replace(/<[^>]+>/g, ' ').replace(/\*\*/g, '').replace(/\s+/g, ' ');
const clean = (s) => s.replace(/\s*\(.*?\)\s*/g, '').trim();
const elemText = ownText('bloodline-elemental');
const ELEMENTS = ['air', 'earth', 'fire', 'metal', 'water', 'wood'];
const elements = ELEMENTS.map((el) => {
  const label = el.charAt(0).toUpperCase() + el.slice(1);
  const m = new RegExp(`- ${label}—Sorcerous Gifts cantrip:? ([^,;]+?)[,;] 1st:? ([^;]+?); 3rd:? ([^;]+?); 6th:? ([^;]+?); Blood Magic Damage`).exec(elemText);
  if (!m) throw new Error(`bloodline-elemental: no row for ${label} in "${elemText.slice(elemText.indexOf('Elemental Influences At'))}"`);
  return { slug: el, label, gifts: [0, 1, 3, 6].map((rank, i) => ({ id: spell(clean(m[i + 1])), rank })) };
});
{
  const page = String(read(`${MIRROR}/bloodline/bloodline-24.json`).text ?? '').replace(/\s+/g, ' ');
  for (const e of elements) {
    const m = new RegExp(`${e.label} cantrip:? ([^,;]+?) [,;] 1st: ([^;]+?) ; 3rd: ([^;]+?) ; 6th: (.+?) (?:slashing|bludgeoning|fire|piercing)`).exec(page);
    if (!m) throw new Error(`bloodline-24: no row for ${e.label}`);
    const printed = [1, 2, 3, 4].map((i) => spell(clean(m[i])));
    if (printed.join() !== e.gifts.map((g) => g.id).join()) throw new Error(`${e.label}: ours ${e.gifts.map((g) => g.id)} vs page ${printed}`);
  }
}

const genieText = ownText('bloodline-genie');
const GENIES = ['Janni', 'Jaathoom', 'Ifrit', 'Faydhaan', 'Jabali'];
const genies = GENIES.map((label) => {
  const m = new RegExp(`- ${label} 2nd:? ([^;]+?); 5th:? ([^;]+?); 8th:? (.+?)(?= - [A-Z]| *$)`).exec(genieText);
  if (!m) throw new Error(`bloodline-genie: no row for ${label} in "${genieText.slice(genieText.indexOf('Genie Type'))}"`);
  return { slug: label.toLowerCase(), label, gifts: [2, 5, 8].map((rank, i) => ({ id: spell(clean(m[i + 1])), rank })) };
});

/* ---- the shared list must not hold a variant's gift (optionGifts drops variant ids from it) ---- */
const check = (id, variants) => {
  const all = new Set(variants.flatMap((v) => v.gifts.map((g) => g.id)));
  const flat = opt(id).grantedSpells ?? [];
  const shared = flat.filter((s) => !all.has(s));
  return { shared, all: [...all] };
};
const report = {
  draconic: check('bloodline-draconic', dragons),
  elemental: check('bloodline-elemental', elements),
  genie: check('bloodline-genie', genies),
};
console.error(JSON.stringify(report, null, 1));

// supersedes: the second write of these three rows (2026-10-21 evening) drops `noun` and corrects the genie row's citation.
const row = (id, value, why) => ({ category: 'classes', id: 'sorcerer', path: ['subclass', 'options', `id=${id}`], field: 'giftVariants', value, why, supersedes: true });
const strip = (v) => ({ slug: v.slug, label: v.label, gifts: v.gifts });
const findings = [
  {
    id: 'bloodline-gift-variants',
    backfillRows: [
      row(
        'bloodline-draconic',
        { answeredBy: 'dragon', prompt: 'Dragon exemplar', options: dragons.map(strip) },
        `bloodline-23 (Draconic, Player Core 2): "Sorcerous Gifts ... 2nd: see Draconic Exemplars below; 5th: see Draconic Exemplars below; 8th: see Draconic Exemplars below" and "choose the tradition related to the dragon exemplar who influenced your bloodline ... this affects both your bloodline's features and your sorcerous gift spells". Each exemplar's own 2nd/5th/8th gifts are its page's "Sorcerous Gifts" line: ${dragonDocs.join(', ')} (Draconic Codex pg. 206; Player Core 2 pg. 150 for the four tradition rows). Keyed by our dragonChoice slug and answered by the Dragon exemplar question the builder already asks. The ten legacy dragons in that list (black ... white) have no page of their own and take their tradition's row. Before this row the option's flat grantedSpells listed all four Player Core 2 2nd-rank gifts at once and the app could not tell which was the character's.`,
      ),
      row(
        'bloodline-elemental',
        { answeredBy: 'choice', prompt: 'Elemental influence', options: elements.map(strip) },
        `bloodline-24 (Elemental, Player Core 2): "At 1st level, choose the type of elemental that influenced your bloodline: air, earth, fire, metal, water, or wood. You can't change this later. You are granted different spells at certain ranks according to this influence." Each element's cantrip, 1st, 3rd and 6th gifts are that page's own "Sorcerous Gifts" line. The builder never asked the question, so every element's gifts were drawn at once.`,
      ),
      row(
        'bloodline-genie',
        { answeredBy: 'choice', prompt: 'Genie type', options: genies.map(strip) },
        `Our record's own remaster text (the classFeatures/bloodline-genie description row of this overlay): "At 1st level, choose the type of genie that influenced your bloodline: faydhaan, ifrit, jaathoom, jabali or janni. You can't change your genie type later. This determines what granted spells you receive at 2nd, 5th, and 8th level", each type's 2nd, 5th and 8th spells on its own line. The Archives mirror's bloodline-11 is the legacy Advanced Player's Guide printing ("janni, djinni, efreeti, marid, or shaitan"); its rows map one to one after the remaster renames (djinni to jaathoom, efreeti to ifrit, marid to faydhaan, shaitan to jabali; glitterdust to revealing light, maze to quandary, horrid wilting to desiccate, scintillating pattern to confusing colors). The builder never asked the question, so every genie's spells were drawn at once.`,
      ),
    ],
  },
];
writeFileSync(OUT, JSON.stringify(findings, null, 2));
console.error(`wrote ${OUT}: draconic ${dragons.length}, elemental ${elements.length}, genie ${genies.length}`);
