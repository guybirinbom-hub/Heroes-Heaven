import { useMemo, useState } from 'react';
import type { Character, ContentDatabase } from '../rules/types';
import { classFeatureDescription } from '../rules/featureText';
import { subclassFeatureIds } from '../rules/derive';
import { ActionGlyph, isActionCost } from './widgets';
import { FeatDetail, type FeatEntry } from './FeatDetail';
import { toPlainText } from './RichText';
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
  // "Choose one of N" picks, so a row can say WHICH option this character took (and why it matters).
  const picksOf = (recordId: string) => (character.effectPicks ?? []).filter((p) => p.recordId === recordId);
  const pickSuffix = (recordId: string) => {
    const p = picksOf(recordId);
    return p.length ? ` (${p.map((x) => x.label).join(', ')})` : '';
  };
  const withPicks = (recordId: string, description: string) => {
    const notes = picksOf(recordId).filter((p) => p.note);
    return notes.length ? `${description}<p><strong>Your choice:</strong> ${notes.map((p) => `${p.label} — ${p.note}`).join('; ')}</p>` : description;
  };
  for (const fc of character.feats) {
    const feat = content.feats[fc.featId];
    if (!feat) continue;
    entries.push({
      key: `feat:${fc.featId}:${fc.level}`,
      featId: fc.featId,
      name: (fc.choice ? `${feat.name} (${fc.choice.label})` : feat.name) + pickSuffix(fc.featId),
      level: fc.level,
      traits: feat.traits,
      actionCost: feat.actionCost,
      description: withPicks(fc.featId, feat.description),
      descRefs: feat.descRefs,
      isFeature: false,
      grantedBy: fc.grantedBy ? content.feats[fc.grantedBy]?.name ?? fc.grantedBy : undefined,
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
      const feature = content.classFeatures[f.featureId];
      if (!feature) continue;
      entries.push({
        key: `feature:${clsId}:${f.featureId}`,
        // Carried so a class feature printing "Frequency once per day" can draw use pips like a feat.
        // 21 class features have `limitedUses` and drew nothing, because the pip lookup only ever
        // consulted content.feats and a feature row had no id to look up with.
        featureId: f.featureId,
        name: feature.name + pickSuffix(f.featureId),
        level: f.level,
        traits: feature.traits,
        actionCost: feature.actionCost,
        // Strip class-specific addenda for OTHER classes (shared features like Reflex Expertise).
        description: withPicks(f.featureId, classFeatureDescription(feature.description, clsId, content)),
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
  const heritage = character.heritageId ? content.heritages[character.heritageId] : undefined;
  if (heritage) {
    entries.push({
      key: `heritage:${heritage.id}`,
      name: heritage.name,
      level: 1,
      traits: heritage.traits,
      description: heritage.description,
      descRefs: heritage.descRefs,
      isFeature: true,
      bucket: 'Ancestry & heritage',
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
                      {e.traits.slice(0, 3).map((t) => (
                        <span className="ff-trait" key={t}>
                          {t}
                        </span>
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
                          : undefined;
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
