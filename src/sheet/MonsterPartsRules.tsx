/*
 * Monster Parts — in-app RULES REFERENCE page.
 *
 * A full-screen overlay (same shell as SettingsPage / HomebrewPage) rendering the play-facing ruleset:
 * the system-in-brief prose, the three GM variants, gathering/scavenging + the Monster Scavenger feat,
 * refining & imbuing rules, the numeric TABLES (treasure 1A–1C / 2, refinement-cost 3, benefits 4A–4E,
 * imbuing 5), and the full imbued-PROPERTY CATALOG.
 *
 * The tables and the property catalog are rendered FROM THE SAME DATA the subsystem computes with
 * (src/rules/monsterParts.ts + monsterPartsCatalog.ts) so the reference can't drift from the mechanics.
 * Only the prose is hand-written, paraphrased from C:\wonderers guide\Monster Parts - Remaster Conversion v2.md.
 */
import { useState } from 'react';
import {
  MP_ITEM_KINDS,
  MP_MODE_LABELS,
  MP_MODE_DESCRIPTIONS,
  MP_TREASURE_BY_LEVEL,
  MP_PARTS_PER_MONSTER,
  MONSTER_PART_PROPERTIES,
  refinementCost,
  refinementTable,
  resolvePath,
  type MpProperty,
  type MpItemKind,
} from '../rules/monsterParts';
import type { MonsterPartsMode } from '../rules/types';
import { useIsMobile } from './useIsMobile';
import { useBackHandler } from './useEscapeClose';
import { MpProse } from './MpProse';
import { MpPathTerm, MpPropertyTerm } from './MpTermLinks';
import { propertyMatchesQuery } from '../rules/monsterPartsGlossary';

type SectionId = 'overview' | 'gathering' | 'refining' | 'imbuing' | 'tables' | 'properties';
const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'ti-book-2' },
  { id: 'gathering', label: 'Gathering parts', icon: 'ti-bone' },
  { id: 'refining', label: 'Refining', icon: 'ti-hammer' },
  { id: 'imbuing', label: 'Imbuing', icon: 'ti-flame' },
  { id: 'tables', label: 'Tables', icon: 'ti-table' },
  { id: 'properties', label: 'Property catalog', icon: 'ti-list-details' },
];

const gp = (n: number) => `${n.toLocaleString()} gp`;
const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);
const MODES: MonsterPartsMode[] = ['light', 'hybrid', 'full'];

// ───────────────────────── Overview ─────────────────────────

function Overview() {
  return (
    <div className="mpr-section">
      <h3 className="mpr-h">The system in brief</h3>
      <p>
        Player characters harvest <strong>monster parts</strong> from defeated foes and spend them to{' '}
        <strong>refine</strong> (improve an item's fundamentals) and <strong>imbue</strong> (add special properties)
        weapons, armor, shields, Perception items, and skill items. In this app, parts are tracked as{' '}
        <strong>inventory items</strong> (value = the item's Price, plus tags for what they offer). An item uses{' '}
        <em>either</em> this system <em>or</em> normal runes/precious materials — <strong>never both at once</strong>.
      </p>
      <ul className="mpr-ul">
        <li>
          <strong>Refining</strong> turns parts into a mundane item (pay its Price in parts), then raises its{' '}
          <strong>item level</strong> as you add value past the thresholds on Table 3, granting the benefits on Tables
          4A–4E. You can't refine above your own level.
        </li>
        <li>
          <strong>Imbuing</strong> unlocks once an item is refined high enough. Add parts matching the imbued
          property's requirement; the property levels up at the Table 5 thresholds. An imbued property can't exceed the
          item's level or your level, whichever is lower.
        </li>
        <li>
          Assign parts immediately and gain the benefit at your next daily preparations, rather than spending downtime
          — though a GM may instead route it through the <strong>Craft</strong> activity.
        </li>
      </ul>
      <p className="mpr-note">
        <strong>Identifying / investing / naming.</strong> Monster-part items are identified like any magic item.
        Worn ones are invested normally (10-item limit). When tracking, note the refining level and each imbued
        property's level, e.g. <em>+3 major striking fire might (16) cold technique (20) longsword (20)</em>.
      </p>

      <h3 className="mpr-h">The three GM variants</h3>
      <p>
        This app models a single character's refine/imbue math, which is <strong>identical</strong> across all three
        variants — the variant you pick only drives the treasure-by-level reference guidance under the Tables tab.
      </p>
      <div className="mpr-cards">
        {MODES.map((m) => (
          <div key={m} className="mpr-card">
            <div className="mpr-card-title">{MP_MODE_LABELS[m]}</div>
            <div className="mpr-card-body">{MP_MODE_DESCRIPTIONS[m]}</div>
          </div>
        ))}
      </div>

      <h3 className="mpr-h">This app vs. the table</h3>
      <p className="mpr-note">
        Harvested parts are tracked as ordinary <strong>inventory items</strong> — create a monster-part item (in the
        Materials group), tag what it offers, and its <strong>Price</strong> is its value. The refine/imbue editor sets
        each item's refined level and every imbued property's level <strong>freely</strong> (a reference tool, no parts
        are consumed) and applies the mechanical effects (item bonuses, striking dice, extra Strike damage, resistances,
        senses, apex boosts) to your sheet. It has no bestiary, so matching a part <em>requirement</em> to a source
        creature is <strong>trust-based</strong>: your held parts (total value + their tags) are shown as an
        informational reminder, never a gate.
      </p>
    </div>
  );
}

// ───────────────────────── Gathering + scavenging ─────────────────────────

function Gathering() {
  return (
    <div className="mpr-section">
      <h3 className="mpr-h">Gathering ingredients</h3>
      <p>
        After a fight, spend 10 minutes to gather parts (automatic success; huge or numerous foes may take several
        10-minute increments). Parts are bulky — roughly <strong>L</strong> for a Small creature, <strong>1</strong>{' '}
        for Medium, <strong>2</strong> for Large, <strong>4</strong> for Huge, <strong>8</strong> for Gargantuan — so
        it's usually wise to spend them quickly. Track parts by value + source creature (e.g. "12 gp of giant crab
        parts"); value can be split across items. Parts sell for half value if sold at all.
      </p>
      <p>
        A PC with a relevant <strong>Lore</strong> (or <strong>Survival</strong>, via the feat below) can spend
        downtime to <strong>Earn Income</strong> (task level = the monster's level) to scavenge more, up to double a
        corpse's value (a critical failure also ends the effort). A hazard with a physical manifestation can yield
        parts (a complex hazard counts as a creature of its level; a simple hazard gives ¼ that value).
      </p>
      <p className="mpr-note">
        <strong>What counts as a monster?</strong> Use whatever definition fits your table — usually PC ancestries and
        beings of pure goodness aren't harvested, though an ally might <em>give</em> shed scales or feathers that work
        just as well. Humanoid foes who aren't a parts source often carry refined items or loose parts the PCs can
        break down instead.
      </p>

      <h3 className="mpr-h">Monster Scavenger</h3>
      <div className="mpr-feat">
        <div className="mpr-feat-head">
          <span className="mpr-feat-name">Monster Scavenger</span>
          <span className="mpr-feat-type">Survival skill feat 1 · homebrew (Non-Paizo)</span>
        </div>
        <p className="mpr-feat-prereq">
          <strong>Prerequisite</strong> trained in Survival.
        </p>
        <p>
          You can use Survival to Earn Income scavenging monster parts. If you use an appropriate Lore instead, gain a{' '}
          <strong>+1 circumstance bonus</strong> to the check (<strong>+2</strong> if you're a master in Survival).
        </p>
      </div>

      <h3 className="mpr-h">Salvaging &amp; transferring</h3>
      <p>
        Salvaging an item recovers parts worth up to <strong>50%</strong> of its refinement + imbued value — in this
        app, that becomes a generic monster-part item added to your inventory. You can transfer a refinement value or
        one imbued property to another item of the <strong>same type</strong> (with compatible part requirements) by
        spending parts equal to <strong>10% of the difference</strong> in values, then swapping the values.
      </p>
    </div>
  );
}

// ───────────────────────── Refining ─────────────────────────

function RefineKindCard({ kind, label, requirement }: { kind: MpItemKind; label: string; requirement: string }) {
  const rows = refinementTable(kind);
  return (
    <div className="mpr-kind">
      <div className="mpr-kind-head">
        <span className="mpr-kind-name">{label}</span>
      </div>
      <p className="mpr-req">
        <strong>Parts:</strong> {requirement}
      </p>
      <div className="mpr-tablewrap">
        <table className="mpr-table">
          <thead>
            <tr>
              <th>Item&nbsp;Lvl</th>
              <th>Parts value</th>
              <th>Benefit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.level}>
                <td>{b.level}</td>
                <td>{gp(refinementCost(b.level, kind))}</td>
                <td>{b.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Refining() {
  return (
    <div className="mpr-section">
      <h3 className="mpr-h">Refining an item</h3>
      <p>
        First build the mundane item by paying its Price in matching parts, creating a level-0 part-item. Then add
        parts past the Table&nbsp;3 thresholds to raise its <strong>item level</strong>, gaining the fundamental-rune
        equivalents below. Weapons &amp; armor use the higher cost column; shields, Perception, and skill items use the
        cheaper column. You can never refine an item above your own level.
      </p>
      <p className="mpr-note">
        <strong>Refining vs. runes.</strong> An item is built and upgraded <em>either</em> with this system{' '}
        <em>or</em> with the normal magic-item rules (precious materials, fundamental runes, property runes) — never
        both at once. A refined shield uses steel-shield statistics by default (bucklers subtract 2 Hardness / 12 HP /
        6 BT; tower shields can't be refined this way). Refined armor and explorer's clothing gain the{' '}
        <strong>invested</strong> trait.
      </p>
      {MP_ITEM_KINDS.map((k) => (
        <RefineKindCard key={k.id} kind={k.id} label={k.label} requirement={k.requirement} />
      ))}
    </div>
  );
}

// ───────────────────────── Imbuing ─────────────────────────

function Imbuing() {
  return (
    <div className="mpr-section">
      <h3 className="mpr-h">Imbuing an item</h3>
      <p>
        Imbuing mirrors refining: add parts that meet the property's requirement, tracking each property's value
        separately. Properties level up at the Table&nbsp;5 thresholds (identical to Table&nbsp;3) and their benefits
        are cumulative. An imbued property can't exceed the item's level or your level, whichever is lower.
      </p>
      <p>
        Where a property grants a spell, the item gains a <strong>command</strong> and <strong>Interact</strong>{' '}
        activation with the same number of actions as the spell, casting that spell. The item's <strong>DC</strong> is
        based on its item level; its spell attack modifier is DC − 10.
      </p>
      <p className="mpr-note">
        <strong>Paths.</strong> Weapon properties often have three paths —{' '}
        <MpPathTerm pathId="magic">Magic</MpPathTerm> (thematic spells),{' '}
        <MpPathTerm pathId="might">Might</MpPathTerm> (direct damage), and{' '}
        <MpPathTerm pathId="technique">Technique</MpPathTerm> (special effects / damage over time). If a weapon can hold
        multiple imbued properties, you can apply the <em>same</em> property more than once as long as each use takes a
        different path; their effects stack. To use an activated ability of a held item, you must be wielding it.
      </p>
      <p>
        See the <strong>Property catalog</strong> tab for all {MONSTER_PART_PROPERTIES.length} imbued properties, each
        with its part requirement, effect, and per-path level entries.
      </p>
    </div>
  );
}

// ───────────────────────── Tables ─────────────────────────

function Tables() {
  const [mode, setMode] = useState<MonsterPartsMode>('hybrid');
  return (
    <div className="mpr-section">
      <h3 className="mpr-h">Refinement / imbuing cost (Tables 3 &amp; 5)</h3>
      <p>Parts value an item must hold to be refined or imbued at a given item level.</p>
      <div className="mpr-tablewrap">
        <table className="mpr-table">
          <thead>
            <tr>
              <th>Item Lvl</th>
              <th>Weapons &amp; Armor</th>
              <th>Shields / Perception / Skill</th>
            </tr>
          </thead>
          <tbody>
            {LEVELS.map((lvl) => (
              <tr key={lvl}>
                <td>{lvl}</td>
                <td>{gp(refinementCost(lvl, 'weapon'))}</td>
                <td>{gp(refinementCost(lvl, 'shield'))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mpr-h">Treasure by level (Tables 1A–1C)</h3>
      <p>Recommended monster-parts budget per party level, by GM variant.</p>
      <div className="mpr-modepick">
        {MODES.map((m) => (
          <button key={m} className={'mpr-modebtn' + (mode === m ? ' active' : '')} onClick={() => setMode(m)}>
            {MP_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <div className="mpr-tablewrap">
        <table className="mpr-table">
          <thead>
            <tr>
              <th>Party Lvl</th>
              <th>Monster parts ({MP_MODE_LABELS[mode]})</th>
            </tr>
          </thead>
          <tbody>
            {LEVELS.map((lvl) => (
              <tr key={lvl}>
                <td>{lvl}</td>
                <td>{gp(MP_TREASURE_BY_LEVEL[mode][lvl])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mpr-h">Parts per monster (Table 2)</h3>
      <p>
        A faster per-encounter estimate: parts a single part-granting monster of a given level yields, by variant. Aim
        for ~640 XP of part-granting monsters per level (~800 XP in Full).
      </p>
      <div className="mpr-tablewrap">
        <table className="mpr-table">
          <thead>
            <tr>
              <th>Creature Lvl</th>
              <th>Light</th>
              <th>Hybrid</th>
              <th>Full</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(MP_PARTS_PER_MONSTER.full)
              .map(Number)
              .sort((a, b) => a - b)
              .map((lvl) => (
                <tr key={lvl}>
                  <td>{lvl}</td>
                  <td>{gp(MP_PARTS_PER_MONSTER.light[lvl])}</td>
                  <td>{gp(MP_PARTS_PER_MONSTER.hybrid[lvl])}</td>
                  <td>{gp(MP_PARTS_PER_MONSTER.full[lvl])}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────── Property catalog ─────────────────────────

function PropertyCard({ prop, defaultOpen }: { prop: MpProperty; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="mpr-prop">
      <div className="mpr-prop-head">
        <span className="mpr-prop-name">
          <MpPropertyTerm prop={prop} />
        </span>
        <button
          className="mpr-prop-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${prop.name}` : `Expand ${prop.name}`}
        >
          <span className="mpr-prop-kinds">{prop.appliesTo.join(', ')}</span>
          <i className={'ti ' + (open ? 'ti-chevron-up' : 'ti-chevron-down')} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="mpr-prop-body">
          <p className="mpr-req">
            <strong>Parts:</strong> <MpProse text={prop.requirement} />
          </p>
          <p className="mpr-effect">
            <MpProse text={prop.effect} />
          </p>
          {prop.choicePrompt && (
            <p className="mpr-choice">
              <strong>Choose:</strong> {prop.choicePrompt}
              {prop.choiceOptions ? ` — ${prop.choiceOptions.join(', ')}` : ''}
            </p>
          )}
          {prop.reusesPathsOf && (
            <p className="mpr-choice">
              Uses the <strong>{prop.reusesPathsOf}</strong> property's paths and level entries.
            </p>
          )}
          {prop.paths.map((path) => {
            // Show the full ladder = resolve at level 20 to gather every rider in order.
            const riders = resolvePath(path, 20).riders;
            return (
              <div key={path.id} className="mpr-path">
                <div className="mpr-path-name">
                  <MpPathTerm pathId={path.id}>{path.name || 'Effect'}</MpPathTerm>
                  {path.note ? <span className="mpr-path-note"> ({path.note})</span> : null}
                </div>
                <ul className="mpr-levels">
                  {riders.map((r, i) => (
                    <li key={i}>
                      <span className="mpr-lvl">{r.level}</span>
                      <span className="mpr-lvl-text">
                        <MpProse text={r.text} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Properties({ query = '', kindFilter: kindProp }: { query?: string; kindFilter?: MpItemKind | 'all' }) {
  const [kindState, setKind] = useState<MpItemKind | 'all'>('all');
  const kind = kindProp ?? kindState;
  const q = query.trim();
  const filtered = MONSTER_PART_PROPERTIES.filter((p) => {
    if (kind !== 'all' && !p.appliesTo.includes(kind)) return false;
    if (q && !propertyMatchesQuery(p, q)) return false;
    return true;
  });
  return (
    <div className="mpr-section">
      <h3 className="mpr-h">Imbued property catalog</h3>
      <p>
        All {MONSTER_PART_PROPERTIES.length} imbued properties, rendered from the app's own data. Tap a property name to
        read its description, or expand a row for its part requirement, effect, and per-path level entries.
      </p>
      <div className="mpr-propfilter">
        <select
          className="mpr-kindsel"
          value={kind}
          onChange={(e) => setKind(e.target.value as MpItemKind | 'all')}
          aria-label="Filter by item type"
        >
          <option value="all">All item types</option>
          {MP_ITEM_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mpr-proplist">
        {filtered.map((p) => (
          <PropertyCard key={p.id} prop={p} defaultOpen={!!q} />
        ))}
        {filtered.length === 0 && (
          <p className="mpr-note">No properties match {q ? `“${q}”` : 'your filter'}.</p>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Shell ─────────────────────────

/** Keywords describing each prose section, so the page search can highlight / jump to matching sections
 *  (in addition to filtering the property catalog). */
const SECTION_KEYWORDS: Record<SectionId, string> = {
  overview: 'overview system in brief refine imbue variant light hybrid full identify invest name',
  gathering: 'gathering ingredients scavenge scavenger earn income lore survival salvage transfer bulk hazard',
  refining: 'refining refine item level potency striking resilient reinforcing fundamental rune shield armor weapon perception skill',
  imbuing: 'imbuing imbue property paths magic might technique spell command interact dc slots',
  tables: 'tables treasure by level cost thresholds parts per monster budget',
  properties: 'property catalog imbued properties fire acid cold sonic force poison mental void spirit vitality charisma bane apex',
};

/** How many catalog properties match the query — used to badge the Properties section during search. */
function propertyMatchCount(query: string): number {
  const q = query.trim();
  if (!q) return MONSTER_PART_PROPERTIES.length;
  return MONSTER_PART_PROPERTIES.filter((p) => propertyMatchesQuery(p, q)).length;
}

/** Which sections match a free-text query (by keywords + property matches for the catalog). */
function matchingSections(query: string): Set<SectionId> {
  const q = query.trim().toLowerCase();
  if (!q) return new Set(SECTIONS.map((s) => s.id));
  const hits = new Set<SectionId>();
  for (const s of SECTIONS) if (SECTION_KEYWORDS[s.id].includes(q) || s.label.toLowerCase().includes(q)) hits.add(s.id);
  if (propertyMatchCount(q) > 0) hits.add('properties');
  return hits;
}

export function MonsterPartsRules({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const [section, setSection] = useState<SectionId>('overview');
  const [mobileSection, setMobileSection] = useState<SectionId | null>(null);
  const [query, setQuery] = useState('');
  useBackHandler(true, onClose);
  useBackHandler(isMobile && mobileSection !== null, () => setMobileSection(null));

  const searching = query.trim().length > 0;
  const matched = matchingSections(query);
  const propMatches = propertyMatchCount(query);

  const render = (id: SectionId) => (
    <>
      {id === 'overview' && <Overview />}
      {id === 'gathering' && <Gathering />}
      {id === 'refining' && <Refining />}
      {id === 'imbuing' && <Imbuing />}
      {id === 'tables' && <Tables />}
      {id === 'properties' && <Properties query={query} />}
    </>
  );

  // While searching, jump the pane to whichever matching section is active; if the current section no
  // longer matches, fall back to the first matching one (Properties leads when it has hits).
  const orderedMatches = SECTIONS.filter((s) => matched.has(s.id)).map((s) => s.id);
  const activeSection: SectionId = searching
    ? matched.has(section)
      ? section
      : orderedMatches.includes('properties')
        ? 'properties'
        : orderedMatches[0] ?? 'properties'
    : section;

  const search = (
    <div className="src-search mpr-page-search">
      <i className="ti ti-search" aria-hidden="true" />
      <input
        type="text"
        placeholder="Search Monster Parts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search Monster Parts rules"
      />
      {query && (
        <button type="button" className="src-search-x" aria-label="Clear search" onClick={() => setQuery('')}>
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      )}
    </div>
  );

  const headTitle =
    isMobile && mobileSection ? SECTIONS.find((s) => s.id === mobileSection)?.label ?? 'Monster Parts' : 'Monster Parts';

  const noMatches = searching && orderedMatches.length === 0;

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div
        className={'picker settings-modal mpr-modal' + (isMobile ? ' settings-page-m' : '')}
        role="dialog"
        aria-label="Monster Parts rules"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-head">
          {isMobile && mobileSection && !searching && (
            <button className="icon-btn settings-back" aria-label="Back" onClick={() => setMobileSection(null)}>
              <i className="ti ti-arrow-left" aria-hidden="true" />
            </button>
          )}
          {headTitle}
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        {isMobile ? (
          <>
            <div className="mpr-search-wrap">{search}</div>
            {searching ? (
              noMatches ? (
                <div className="settings-pane">
                  <p className="mpr-note">Nothing matches “{query.trim()}”.</p>
                </div>
              ) : (
                <div className="settings-pane">
                  <nav className="mpr-jump" aria-label="Matching sections">
                    {orderedMatches.map((id) => {
                      const s = SECTIONS.find((x) => x.id === id)!;
                      return (
                        <button
                          key={id}
                          className={'mpr-jump-btn' + (activeSection === id ? ' active' : '')}
                          onClick={() => setSection(id)}
                        >
                          <i className={'ti ' + s.icon} aria-hidden="true" /> {s.label}
                          {id === 'properties' && <span className="mpr-jump-count">{propMatches}</span>}
                        </button>
                      );
                    })}
                  </nav>
                  {render(activeSection)}
                </div>
              )
            ) : mobileSection === null ? (
              <div className="settings-cards">
                {SECTIONS.map((s) => (
                  <button key={s.id} className="settings-card" onClick={() => setMobileSection(s.id)}>
                    <i className={'ti ' + s.icon} aria-hidden="true" />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="settings-pane">{render(mobileSection)}</div>
            )}
          </>
        ) : (
          <div className="settings-body">
            <nav className="settings-nav" aria-label="Monster Parts sections">
              {search}
              {SECTIONS.map((s) => {
                const dim = searching && !matched.has(s.id);
                return (
                  <button
                    key={s.id}
                    className={
                      'settings-navitem' + (activeSection === s.id ? ' active' : '') + (dim ? ' mpr-nav-dim' : '')
                    }
                    onClick={() => setSection(s.id)}
                    disabled={dim}
                  >
                    <i className={'ti ' + s.icon} aria-hidden="true" /> {s.label}
                    {searching && s.id === 'properties' && <span className="mpr-jump-count">{propMatches}</span>}
                  </button>
                );
              })}
            </nav>
            <div className="settings-pane">
              {noMatches ? (
                <p className="mpr-note">Nothing matches “{query.trim()}”.</p>
              ) : (
                render(activeSection)
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
