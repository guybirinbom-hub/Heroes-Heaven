import { useMemo, useState } from 'react';
import type { Character, ContentDatabase } from '../rules/types';
import { classFeatureDescription } from '../rules/featureText';
import { ActionGlyph, isActionCost } from './widgets';
import { FeatDetail, type FeatEntry } from './FeatDetail';
import { toPlainText } from './RichText';

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

export function FeatsTab({ character, content }: { character: Character; content: ContentDatabase }) {
  // Which type sections to show. EMPTY = "All" (everything); otherwise only the picked types.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<FeatEntry | null>(null);

  // Rebuilding this list is independent of the local query/filter state — memoize on
  // [character, content] so typing in the search box doesn't re-derive every feat/feature row.
  const entries = useMemo<FeatEntry[]>(() => {
  const entries: FeatEntry[] = [];
  for (const fc of character.feats) {
    const feat = content.feats[fc.featId];
    if (!feat) continue;
    entries.push({
      key: `feat:${fc.featId}:${fc.level}`,
      name: fc.choice ? `${feat.name} (${fc.choice.label})` : feat.name,
      level: fc.level,
      traits: feat.traits,
      actionCost: feat.actionCost,
      description: feat.description,
      descRefs: feat.descRefs,
      isFeature: false,
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
    // A subclass can remove class features (cleric Battle Creed drops Resolute Faith + Miraculous Spell).
    const subOpt = cls.subclass?.options.find((o) => o.id === subId);
    const suppressed = new Set(subOpt?.suppressedFeatures ?? []);
    for (const f of cls.features) {
      if (f.level > character.level) continue; // only features actually gained yet
      if (suppressed.has(f.featureId)) continue; // removed by the chosen subclass
      const feature = content.classFeatures[f.featureId];
      if (!feature) continue;
      entries.push({
        key: `feature:${clsId}:${f.featureId}`,
        name: feature.name,
        level: f.level,
        traits: feature.traits,
        actionCost: feature.actionCost,
        // Strip class-specific addenda for OTHER classes (shared features like Reflex Expertise).
        description: classFeatureDescription(feature.description, clsId, content),
        descRefs: feature.descRefs,
        isFeature: true,
        bucket: 'Class',
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
      traits: [c.group],
      description: c.description,
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
  }, [character, content]);

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
                      {e.traits.slice(0, 3).map((t) => (
                        <span className="ff-trait" key={t}>
                          {t}
                        </span>
                      ))}
                    </div>
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
