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
        weapons, armor, shields, Perception items, and skill items. Parts are tracked by <strong>value</strong> (in gp)
        and by the creature they came from. An item uses <em>either</em> this system <em>or</em> normal
        runes/precious materials — <strong>never both at once</strong>.
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
        The app tracks the numbers — banked parts by value + source tags, an item's refined level and each imbued
        property's level, and it applies the mechanical effects (item bonuses, striking dice, extra Strike damage,
        resistances, senses, apex boosts) to your sheet. It has no bestiary, so matching a part <em>requirement</em>{' '}
        to a source creature is <strong>trust-based</strong>: the requirement is shown as a reminder when you allocate
        parts.
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
        Salvaging an item recovers parts worth up to <strong>50%</strong> of its refinement + imbued value. You can
        transfer a refinement value or one imbued property to another item of the <strong>same type</strong> (with
        compatible part requirements) by spending parts equal to <strong>10% of the difference</strong> in values, then
        swapping the values.
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
        <strong>Paths.</strong> Weapon properties often have three paths — <strong>Magic</strong> (thematic spells),{' '}
        <strong>Might</strong> (direct damage), and <strong>Technique</strong> (special effects / damage over time). If
        a weapon can hold multiple imbued properties, you can apply the <em>same</em> property more than once as long as
        each use takes a different path; their effects stack. To use an activated ability of a held item, you must be
        wielding it.
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

function PropertyCard({ prop }: { prop: MpProperty }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mpr-prop">
      <button className="mpr-prop-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="mpr-prop-name">{prop.name}</span>
        <span className="mpr-prop-kinds">{prop.appliesTo.join(', ')}</span>
        <i className={'ti ' + (open ? 'ti-chevron-up' : 'ti-chevron-down')} aria-hidden="true" />
      </button>
      {open && (
        <div className="mpr-prop-body">
          <p className="mpr-req">
            <strong>Parts:</strong> {prop.requirement}
          </p>
          <p className="mpr-effect">{prop.effect}</p>
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
                  {path.name || 'Effect'}
                  {path.note ? <span className="mpr-path-note"> ({path.note})</span> : null}
                </div>
                <ul className="mpr-levels">
                  {riders.map((r, i) => (
                    <li key={i}>
                      <span className="mpr-lvl">{r.level}</span>
                      <span className="mpr-lvl-text">{r.text}</span>
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

function Properties() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<MpItemKind | 'all'>('all');
  const filtered = MONSTER_PART_PROPERTIES.filter((p) => {
    if (kind !== 'all' && !p.appliesTo.includes(kind)) return false;
    if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  return (
    <div className="mpr-section">
      <h3 className="mpr-h">Imbued property catalog</h3>
      <p>
        All {MONSTER_PART_PROPERTIES.length} imbued properties, rendered from the app's own data. Tap a property to
        expand its part requirement, effect, and per-path level entries.
      </p>
      <div className="mpr-propfilter">
        <input
          className="mpr-search"
          placeholder="Search properties…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="mpr-kindsel" value={kind} onChange={(e) => setKind(e.target.value as MpItemKind | 'all')}>
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
          <PropertyCard key={p.id} prop={p} />
        ))}
        {filtered.length === 0 && <p className="mpr-note">No properties match your filter.</p>}
      </div>
    </div>
  );
}

// ───────────────────────── Shell ─────────────────────────

export function MonsterPartsRules({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const [section, setSection] = useState<SectionId>('overview');
  const [mobileSection, setMobileSection] = useState<SectionId | null>(null);
  useBackHandler(true, onClose);
  useBackHandler(isMobile && mobileSection !== null, () => setMobileSection(null));

  const render = (id: SectionId) => (
    <>
      {id === 'overview' && <Overview />}
      {id === 'gathering' && <Gathering />}
      {id === 'refining' && <Refining />}
      {id === 'imbuing' && <Imbuing />}
      {id === 'tables' && <Tables />}
      {id === 'properties' && <Properties />}
    </>
  );

  const headTitle =
    isMobile && mobileSection ? SECTIONS.find((s) => s.id === mobileSection)?.label ?? 'Monster Parts' : 'Monster Parts';

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div
        className={'picker settings-modal mpr-modal' + (isMobile ? ' settings-page-m' : '')}
        role="dialog"
        aria-label="Monster Parts rules"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-head">
          {isMobile && mobileSection && (
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
          mobileSection === null ? (
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
          )
        ) : (
          <div className="settings-body">
            <nav className="settings-nav" aria-label="Monster Parts sections">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  className={'settings-navitem' + (section === s.id ? ' active' : '')}
                  onClick={() => setSection(s.id)}
                >
                  <i className={'ti ' + s.icon} aria-hidden="true" /> {s.label}
                </button>
              ))}
            </nav>
            <div className="settings-pane">{render(section)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
