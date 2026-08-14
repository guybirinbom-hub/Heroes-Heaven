import { useMemo, useState } from 'react';
import type { Character, ContentDatabase } from '../rules/types';
import { classFeatureDescription } from '../rules/featureText';
import { subclassFeatureIds } from '../rules/derive';
import { markNote, nameOfRecord, recordMarkersFor } from '../rules/explain';
import { ActionGlyph, isActionCost } from './widgets';
import { FeatDetail, type FeatEntry } from './FeatDetail';
import { toPlainText } from './RichText';
import { InfoTerm } from './InfoTerm';
import { traitDesc, traitLabel } from '../rules/glossary';
import { featUse, usesLabel, spendFeatUse, refundFeatUse, resetEncounterUses, isSubDaily } from '../rules/featUses';
import type { PlayUpdater } from '../rules/play';

const BUCKETS = ['Class', 'Archetype', 'Ancestry & heritage', 'Skill', 'General'];
const BUCKET_ICON: Record<string, string> = {
  Class: 'ti-shield-half',
  Archetype: 'ti-arrows-shuffle',
  'Ancestry & heritage': 'ti-user',
  Skill: 'ti-star',
  General: 'ti-medal',
};

function featBucket(category: string): string {
  switch (category) {
    case 'class':
      return 'Class';
    case 'ancestry':
    case 'heritage':
      return 'Ancestry & heritage';
    case 'skill':
      return 'Skill';
    case 'general':
      return 'General';
    default:
      return 'Class';
  }
}

/**
 * Everything the character owns, as rows.
 *
 * Exported and pure so the DISPLAY half of "every record is displayed and affects the sheet" can be
 * TESTED. It was previously inline in the component, which is precisely why 29 owned-and-correct
 * class features could be listed nowhere without a single test noticing.
 */
export function featEntries(character: Character, content: ContentDatabase): FeatEntry[] {
  const entries: FeatEntry[] = [];
  /** A record's display name from ANY collection a granter can live in. Falling back to the id shows
   *  a raw slug, which is what "Granted by cloistered-cleric" was. */
  const recordName = (id: string) =>
    content.feats[id]?.name ??
    content.classFeatures[id]?.name ??
    content.heritages[id]?.name ??
    content.items[id]?.name ??
    content.backgrounds[id]?.name ??
    // A subclass / extra-choice option is not in classFeatures under every id, so search the class defs.
    Object.values(content.classes)
      .flatMap((cl) => [...(cl.subclass?.options ?? []), ...(cl.extraChoices ?? []).flatMap((g) => g.options ?? [])])
      .find((o) => o.id === id)?.name ??
    id;
  // "Choose one of N" picks, so a row can say WHICH option this character took (and why it matters).
  const picksOf = (recordId: string) => (character.effectPicks ?? []).filter((p) => p.recordId === recordId);
  /**
   * `own` is the record's OWN `choice` label, which the caller has already printed.
   *
   * 23 records carry BOTH a `choice` and an `effectChoices` asking the same question — Elemental
   * Wrath, Nephilim Resistance, Draconic Resistance … — and both answers reached this line, so the
   * row read "Elemental Wrath (Fire) (Fire)". Where the `choice` has no consumer at all the picker
   * itself is deleted (scripts/apply-builder-choice-sets.mjs); where it grants something — Molten
   * Wit's skill, Hold Mark's — both lanes have to stay, and this is where the duplicate stops being
   * printed.
   */
  const pickSuffix = (recordId: string, own?: string) => {
    const same = (s: string) => s.trim().toLowerCase() === (own ?? "\u0000").trim().toLowerCase();
    const p = picksOf(recordId).filter((x) => !own || !same(x.label));
    return p.length ? ` (${p.map((x) => x.label).join(', ')})` : '';
  };
  const withPicks = (recordId: string, description: string) => {
    const notes = picksOf(recordId).filter((p) => p.note);
    let out = notes.length ? `${description}<p><strong>Your choice:</strong> ${notes.map((p) => `${p.label} — ${p.note}`).join('; ')}</p>` : description;
    /*
     * The record's OWN note — "this feat works; here is the part you apply yourself".
     *
     * Rendered nowhere until now, so every `note` authored on a feat was inert: the one Captivating
     * Intensity clause that is not tracked, where a Sanctified Relic's bonus actually lands, Caustic
     * Nectar's critical-hit rider. Distinct from `dataWarning`, which says something is BROKEN and
     * shows in the red "Missing data" panel.
     */
    /*
     * Marks another record put ON THIS ONE (Principle A / Principle C). The record's own `note`
     * below says "here is the part you apply yourself"; this says "something ELSE of yours changed
     * this", attributed to the source so the player can tell the two apart — which is exactly what
     * gold answer #1 asked for on Lay on Hands.
     *
     * `markNote` rather than `m.note`: 40 of the shipped marks open with their own record's name, and
     * this line prints that name itself, so the raw note would render "Weapon Supremacy: Weapon
     * Supremacy: …" for a third of the table.
     */
    for (const m of recordMarkersFor(character, content, 'feature', recordId)) {
      out += `<p><strong>${nameOfRecord(content, m.sourceId)}:</strong> ${markNote(content, m)}</p>`;
    }
    const own = (content.feats[recordId] ?? content.classFeatures[recordId])?.note;
    if (own) out += `<p><strong>Note:</strong> ${own}</p>`;
    return out;
  };
  for (const fc of character.feats) {
    const feat = content.feats[fc.featId];
    if (!feat) continue;
    entries.push({
      key: `feat:${fc.featId}:${fc.level}`,
      featId: fc.featId,
      name: (fc.choice ? `${feat.name} (${fc.choice.label})` : feat.name) + pickSuffix(fc.featId, fc.choice?.label),
      level: fc.level,
      traits: feat.traits,
      actionCost: feat.actionCost,
      description: withPicks(fc.featId, feat.description),
      descRefs: feat.descRefs,
      // The enhancement tier, if an augmentation is pointing at this feat.
      enhancedBy: (character.enhancements ?? []).find((e) => e.featId === fc.featId)?.from,
      isFeature: false,
      // build.ts sets `grantedBy` from heritages, class features, invested items and subclass /
      // extra-choice options as well as feats — so resolving the name through `content.feats` alone
      // showed a raw slug ("cloistered-cleric") for every granter that is not a feat.
      grantedBy: fc.grantedBy ? recordName(fc.grantedBy) : undefined,
      bucket: feat.traits.includes('archetype') ? 'Archetype' : featBucket(feat.category),
      rarity: feat.rarity,
      prerequisites: feat.prerequisites,
    });
  }
  // The character's class(es) — a second appears only under the Dual Class variant.
  const classPairs: [string, string | null | undefined][] = [];
  if (character.classId) classPairs.push([character.classId, character.subclassId]);
  if (character.variantRules?.dualClass && character.classId2) classPairs.push([character.classId2, character.subclassId2]);
  for (const [clsId, subId] of classPairs) {
    const cls = content.classes[clsId];
    if (!cls) continue;
    // A subclass can remove class features (cleric Battle Creed drops Resolute Faith + Miraculous
    // Spell) — and so can a CLASS ARCHETYPE. Only the subclass half was honoured here, so a class
    // archetype's replaced features stayed listed as owned while a "Replaced: …" note below claimed
    // otherwise, and the features it substitutes IN were listed nowhere at all.
    const subOpt = cls.subclass?.options.find((o) => o.id === subId);
    // A class archetype restructures ONE class; under Dual Class this loop runs twice, so both its
    // halves are scoped to the class it targets or the substituted features appear under both.
    const arch = character.classArchetype;
    const archHere = arch && (arch.classId ?? clsId) === clsId ? arch : undefined;
    const suppressed = new Set([...(subOpt?.suppressedFeatures ?? []), ...(archHere?.suppressedFeatures ?? [])]);
    const archAdded = (archHere?.addedFeatures ?? []).filter((a) => a.level <= character.level);
    for (const f of [...cls.features, ...archAdded]) {
      if (f.level > character.level) continue; // only features actually gained yet
      if (suppressed.has(f.featureId)) continue; // removed by the chosen subclass
      // Prefer the SUBCLASS's own variant of a shared feature. The class lists the generic prose
      // record (`field-discovery`, `first-doctrine`) and the variant carries the real text — so a
      // toxicologist's Field Discovery row read "You learn a discovery list…" instead of naming the
      // discovery, for all 12 cleric doctrines, 12 alchemist field discoveries and 3 ranger rows.
      // `ownedFeatureIds` already owns the variant; this is only which one the player is shown.
      const variantId = subId && content.classFeatures[`${f.featureId}-${subId}`] ? `${f.featureId}-${subId}` : f.featureId;
      const feature = content.classFeatures[variantId];
      if (!feature) continue;
      entries.push({
        key: `feature:${clsId}:${f.featureId}`,
        // Carried so a class feature printing "Frequency once per day" can draw use pips like a feat.
        // 21 class features have `limitedUses` and drew nothing, because the pip lookup only ever
        // consulted content.feats and a feature row had no id to look up with.
        // The VARIANT's id, so use pips and effect picks read the record actually being shown.
        featureId: variantId,
        name: feature.name + pickSuffix(variantId),
        level: f.level,
        traits: feature.traits,
        actionCost: feature.actionCost,
        // Strip class-specific addenda for OTHER classes (shared features like Reflex Expertise).
        description: withPicks(variantId, classFeatureDescription(feature.description, clsId, content)),
        descRefs: feature.descRefs,
        isFeature: true,
        bucket: 'Class',
        rarity: feature.rarity,
      });
    }
    // Class features the SUBCLASS hands over, which appear in no class feature list — an oracle
    // mystery brings its curse, a gunslinger way its three deeds. `ownedFeatureIds` reaches these so
    // their mechanics fire; this loop is the only thing that puts them in front of the player.
    // Without it 29 records were owned, correct, and listed nowhere.
    for (const fid of subclassFeatureIds(subOpt?.featureIds, character.level)) {
      if (suppressed.has(fid)) continue;
      const feature = content.classFeatures[fid];
      if (!feature || entries.some((e) => e.featureId === fid)) continue;
      entries.push({
        key: `feature:${clsId}:${fid}`,
        featureId: fid,
        name: feature.name + pickSuffix(fid),
        // The level the SUBCLASS hands it over at, not the record's own printed level — a gunslinger
        // way's greater deed is a 15th-level feature sitting on a 1st-level record.
        level: (subOpt?.featureIds ?? []).reduce<number>(
          (lv, e) => (typeof e !== 'string' && e.id === fid ? e.level : lv),
          feature.level ?? 1,
        ),
        traits: feature.traits,
        actionCost: feature.actionCost,
        description: withPicks(fid, classFeatureDescription(feature.description, clsId, content)),
        descRefs: feature.descRefs,
        isFeature: true,
        bucket: 'Class',
        groupLabel: subOpt?.name,
        rarity: feature.rarity,
      });
    }
  }
  // Subclass + extra-choice picks (bloodline, ikons, apparitions, elements, minds…).
  for (const c of character.classChoices ?? []) {
    entries.push({
      key: `choice:${c.group}:${c.name}`,
      name: c.name,
      level: c.level,
      // `c.group` is the builder card heading ("Bloodline", "Kinetic Gate (elements)"), not a trait.
      traits: [],
      groupLabel: c.group,
      description: c.description,
      // Without these every cross-reference inside a bloodline / mystery / implement / apparition
      // description rendered as plain text — 1,199 dead links across the choice options.
      descRefs: c.descRefs,
      isFeature: true,
      bucket: 'Class',
    });
  }
  // Inventor modifications (chosen innovation customizations — they ARE class features).
  if (character.inventor) {
    const m = character.inventor.modifications;
    for (const id of [m.initial, m.breakthrough, m.revolutionary]) {
      const f = id ? content.classFeatures[id] : undefined;
      if (!f) continue;
      entries.push({
        key: `mod:${f.id}`,
        name: f.name,
        level: f.level,
        traits: f.traits,
        actionCost: f.actionCost,
        description: f.description,
        descRefs: f.descRefs,
        isFeature: true,
        bucket: 'Class',
        rarity: f.rarity,
      });
    }
  }
  // Features force-granted via the creative Overrides section.
  for (const g of character.grantedFeatures ?? []) {
    entries.push({
      key: `granted:${g.featureId}:${g.level}`,
      name: g.name,
      level: g.level,
      traits: g.traits,
      actionCost: g.actionCost,
      description: g.description,
      descRefs: g.descRefs,
      isFeature: true,
      bucket: 'Class',
      rarity: g.rarity,
    });
  }
  // BOTH heritages. Late Awakener and Awakened Yaoguai Heritage give a character the mechanical
  // benefits of a second one, and those benefits already apply (derive.ts heritageRecords reads it) —
  // but only `heritageId` was ever listed, so the heritage doing half the work appeared nowhere.
  for (const hid of [character.heritageId, character.secondHeritageId]) {
    const heritage = hid ? content.heritages[hid] : undefined;
    if (!heritage) continue;
    entries.push({
      key: `heritage:${heritage.id}`,
      name: heritage.name,
      level: 1,
      traits: heritage.traits,
      description: heritage.description,
      descRefs: heritage.descRefs,
      isFeature: true,
      bucket: 'Ancestry & heritage',
      // Which of the two this is, so a player seeing two heritage rows knows why.
      ...(hid === character.secondHeritageId && hid !== character.heritageId
        ? { groupLabel: 'Second heritage' }
        : {}),
      // Four heritages print "once per day"; the pip lookup takes a feat or a class feature and a
      // heritage row has neither id, so all four drew nothing.
      usesRecord: heritage,
      rarity: heritage.rarity,
    });
  }
  return entries;
}

export function FeatsTab({ character, content, onPlay }: { character: Character; content: ContentDatabase; onPlay?: PlayUpdater }) {
  // Which type sections to show. EMPTY = "All" (everything); otherwise only the picked types.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<FeatEntry | null>(null);

  // Rebuilding this list is independent of the local query/filter state — memoize on
  // [character, content] so typing in the search box doesn't re-derive every feat/feature row.
  const entries = useMemo<FeatEntry[]>(() => featEntries(character, content), [character, content]);

  const q = query.trim().toLowerCase();
  // EMPTY picked = show every type; otherwise only the picked ones.
  const showAll = picked.size === 0;
  // Only offer a type chip when the character actually has entries of that type (e.g. no Archetype
  // feats → no Archetype filter). Based on all entries, independent of the search box.
  const presentBuckets = BUCKETS.filter((b) => entries.some((e) => e.bucket === b));
  const filtered = entries.filter(
    (e) =>
      (showAll || picked.has(e.bucket)) &&
      (!q ||
        e.name.toLowerCase().includes(q) ||
        e.traits.some((t) => t.toLowerCase().includes(q)) ||
        // Keep the group heading searchable — it used to match via the fake trait entry.
        (e.groupLabel ?? '').toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.rarity ?? '').includes(q)),
  );

  function toggle(b: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(b)) n.delete(b);
      else n.add(b);
      return n;
    });
  }

  return (
    <div className="maincol">
      {character.effectWarnings?.length ? (
        <div className="ff-warnings" role="note">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <div>
            <strong>Missing data</strong> — {character.effectWarnings.length} effect{character.effectWarnings.length === 1 ? '' : 's'} reference content not in the current data:
            <ul>
              {character.effectWarnings.map((w, i) => (
                <li key={i}>
                  <b>{w.source}</b>: {w.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {character.classArchetype?.notes.length ? (
        <div className="ff-arch" role="note">
          <i className="ti ti-replace" aria-hidden="true" />
          <div>
            <strong>Class archetype</strong> — your class works differently:
            <ul>
              {character.classArchetype.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
              {character.classArchetype.suppressedFeatures.length ? (
                <li>
                  <b>Replaced</b>: {character.classArchetype.suppressedFeatures.map((id) => content.classFeatures[id]?.name ?? id).join(', ')}
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}
      <div className="ff-bar">
        <div className="search">
          <i className="ti ti-search" aria-hidden="true" />
          <input placeholder="Search feats & features" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="ff-filters" role="group" aria-label="Show feat & feature types">
          <button className={'fchip' + (showAll ? ' on' : '')} onClick={() => setPicked(new Set())} title="Show every type">
            All
          </button>
          {presentBuckets.map((b) => (
            <button key={b} className={'fchip' + (picked.has(b) ? ' on' : '')} onClick={() => toggle(b)} title={`Show only ${b}${picked.size ? ' (and other picked types)' : ''}`}>
              {b}
            </button>
          ))}
        </div>
      </div>

      <section className="card">
        {BUCKETS.filter((b) => showAll || picked.has(b)).map((b) => {
          const rows = filtered.filter((e) => e.bucket === b).sort((a, c) => a.level - c.level);
          if (rows.length === 0) return null;
          return (
            <div key={b}>
              <div className="ff-sec">
                <i className={'ti ' + BUCKET_ICON[b]} aria-hidden="true" />
                {b}
                <span className="ff-count">{rows.length}</span>
              </div>
              {rows.map((e) => (
                <div
                  className="ff-row clickable"
                  key={e.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetail(e)}
                  onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), setDetail(e))}
                >
                  <div className="ff-lvl" title={'Gained at level ' + e.level}>
                    {e.level}
                  </div>
                  <div className="ff-body">
                    <div className="ff-name-line">
                      {isActionCost(e.actionCost) && (
                        <span className="ff-cost">
                          <ActionGlyph cost={e.actionCost} />
                        </span>
                      )}
                      <span className="ff-name">{e.name}</span>
                      {e.isFeature && <span className="ff-tag">Feature</span>}
                      {e.groupLabel && <span className="ff-tag" title={`Chosen for ${e.groupLabel}`}>{e.groupLabel}</span>}
                      {e.grantedBy && <span className="ff-tag ff-tag-granted" title={`Granted by ${e.grantedBy}`}>Granted</span>}
                      {/* Clickable right here in the list. These used to be inert text, so reading what
                          "manipulate" means took opening the feat first and clicking the chip in its
                          popup — two steps to reach a page one step away. InfoTerm stops the click from
                          also opening the row's feat detail. */}
                      {e.traits.slice(0, 3).map((t) => (
                        <InfoTerm key={t} className="ff-trait" descKey="trait" title={traitLabel(t)} description={traitDesc(t, content)}>
                          {t}
                        </InfoTerm>
                      ))}
                    </div>
                    {/* A feat printing "Frequency once per day" used to be text the player had to
                        remember; items have had use pips for a while, so match that control here.
                        stopPropagation because the whole row opens the feat detail. */}
                    {(() => {
                      // `content` is passed so a feat that RETUNES this one's frequency (Reliable
                      // Luck → Cat's Luck once per hour) changes the pips it draws.
                      // Class features are looked up too: Flurry of Blows, Tactics and 19 others
                      // carry `limitedUses`, and gating this on `featId` alone left all of them
                      // drawing nothing — the data was there, the row just had nowhere to read it.
                      const rec = e.featId
                        ? content.feats[e.featId]
                        : e.featureId
                          ? (content.classFeatures[e.featureId] as unknown as typeof content.feats[string])
                          : (e.usesRecord as typeof content.feats[string] | undefined);
                      const use = featUse(character, rec, content);
                      if (!use || !onPlay) return null;
                      const stop = (ev: React.MouseEvent) => ev.stopPropagation();
                      return (
                        <span className="ff-uses" title={`${usesLabel(use)} — refills on daily preparations`}>
                          <i className="ti ti-battery-2" aria-hidden="true" />
                          <button
                            aria-label={`Spend a use of ${use.name}`}
                            disabled={use.current <= 0}
                            onClick={(ev) => {
                              stop(ev);
                              onPlay((p) => ({ ...p, featUses: spendFeatUse(p.featUses, use.featId, use.max) }), `featuses:${use.featId}`);
                            }}
                          >
                            <i className="ti ti-minus" aria-hidden="true" />
                          </button>
                          <span className="ff-uses-n">
                            {use.current}/{use.max}
                          </span>
                          <button
                            aria-label={`Restore a use of ${use.name}`}
                            disabled={use.current >= use.max}
                            onClick={(ev) => {
                              stop(ev);
                              onPlay((p) => ({ ...p, featUses: refundFeatUse(p.featUses, use.featId) }), `featuses:${use.featId}`);
                            }}
                          >
                            <i className="ti ti-plus" aria-hidden="true" />
                          </button>
                          <span className="ff-uses-per">per {use.per}</span>
                          {isSubDaily(use.per) && (
                            <button
                              type="button"
                              className="ff-uses-reset"
                              aria-label={`Reset ${use.name} for a new encounter`}
                              title="New encounter — refill every per-round/turn/minute/hour use"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onPlay((p) => ({
                                  ...p,
                                  featUses: resetEncounterUses(p.featUses, content.feats, { character, content }),
                                }));
                              }}
                            >
                              <i className="ti ti-refresh" aria-hidden="true" />
                            </button>
                          )}
                        </span>
                      );
                    })()}
                    <div className="ff-desc">{toPlainText(e.description)}</div>
                  </div>
                  <i className="ti ti-chevron-right ff-chev" aria-hidden="true" />
                </div>
              ))}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="ff-empty">No feats or features found.</div>}
      </section>

      {detail && <FeatDetail entry={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
