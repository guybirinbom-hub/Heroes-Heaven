import { useRef } from 'react';
import type { Character, ContentDatabase, ProficiencyRank, SenseEntry, CharacterDetails } from '../rules/types';
import { RankPill } from './widgets';
import { InfoTerm } from './InfoTerm';
import { deriveDefenses } from '../rules/derive';
import { setDetail, setPortrait, type PlayUpdater } from '../rules/play';
import { proficiencyDesc, senseDesc, traitDesc, languageDesc } from '../rules/glossary';
import { downscaleImage } from './imageUtil';
import { useIsMobile } from './useIsMobile';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SENSE_LABEL: Record<string, string> = {
  normal: 'Normal vision',
  'low-light': 'Low-light vision',
  'low-light-vision': 'Low-light vision',
  darkvision: 'Darkvision',
  'greater-darkvision': 'Greater darkvision',
};
function senseLabel(s: SenseEntry): string {
  const base = SENSE_LABEL[s.name] ?? s.name.replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  const detail = [s.acuity, s.range ? `${s.range} ft` : null].filter(Boolean).join(' ');
  return detail ? `${base} (${detail})` : base;
}

interface ProfRow {
  name: string;
  rank: ProficiencyRank;
  desc?: string;
}

/** Short bio fields shown as single-line inputs; appearance/personality get textareas. */
const SHORT_FIELDS: { key: keyof CharacterDetails; label: string }[] = [
  { key: 'alignment', label: 'Alignment' },
  { key: 'age', label: 'Age' },
  { key: 'height', label: 'Height' },
  { key: 'weight', label: 'Weight' },
  { key: 'gender', label: 'Gender' },
  { key: 'pronouns', label: 'Pronouns' },
  { key: 'ethnicity', label: 'Ethnicity' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'birthplace', label: 'Birthplace' },
];
const AREA_FIELDS: { key: keyof CharacterDetails; label: string }[] = [
  { key: 'appearance', label: 'Appearance' },
  { key: 'personality', label: 'Personality' },
];

export function DetailsTab({
  character,
  content,
  onPlay,
}: {
  character: Character;
  content: ContentDatabase;
  onPlay?: PlayUpdater;
}) {
  const isMobile = useIsMobile();
  const ancestry = character.ancestryId ? content.ancestries[character.ancestryId] : undefined;
  const heritage = character.heritageId ? content.heritages[character.heritageId] : undefined;
  const background = character.backgroundId ? content.backgrounds[character.backgroundId] : undefined;
  const cls = character.classId ? content.classes[character.classId] : undefined;
  const d = character.details;
  const deity = d.deityId ? content.deities[d.deityId] : undefined;
  const senses = deriveDefenses(character, content).senses;

  const bgName = background?.name ?? character.customBackground?.name;
  const bgDesc = background?.description ?? character.customBackground?.description;

  // Portrait import: clicking the slot opens a file picker; the chosen image is read as a
  // data URL and stored in the in-play appearance overlay (persists with the character).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const portrait = character.appearance?.portrait;
  const importPortrait = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // allow re-selecting the same file later
    if (!file || !onPlay) return;
    // Downscale before storing — uncapped photos blow the localStorage quota.
    downscaleImage(file)
      .then((url) => onPlay((p) => setPortrait(p, url)))
      .catch(() => {});
  };

  const attacks: ProfRow[] = (['simple', 'martial', 'advanced', 'unarmed'] as const).map((c) => ({
    name: cap(c),
    rank: character.proficiencies.attacks[c],
    desc: proficiencyDesc(c),
  }));
  const overrides: ProfRow[] = Object.entries(character.proficiencies.weaponOverrides ?? {}).map(([id, rank]) => ({
    name: content.items[id]?.name ?? cap(id),
    rank,
    desc: content.items[id]?.description,
  }));
  const defenses: ProfRow[] = (['unarmored', 'light', 'medium', 'heavy'] as const).map((c) => ({
    name: cap(c),
    rank: character.proficiencies.defenses[c],
    desc: proficiencyDesc(c),
  }));
  const spellRows: ProfRow[] = character.spellcasting.map((e) => ({
    name: e.type === 'focus' ? `${cap(e.tradition)} focus` : `${cap(e.tradition)} spellcasting`,
    rank: e.proficiency,
    desc: proficiencyDesc('spellcasting'),
  }));

  const groups: { label: string; rows: ProfRow[] }[] = [
    { label: 'Attacks', rows: [...attacks, ...overrides] },
    { label: 'Defenses', rows: defenses },
    { label: 'Spellcasting', rows: spellRows },
    { label: 'Class', rows: [{ name: 'Class DC', rank: character.proficiencies.classDc, desc: proficiencyDesc('classDc') }] },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="maincol">
      <section className="card">
        <div className="ct">
          <i className="ti ti-id-badge-2" aria-hidden="true" />
          Origin
        </div>
        <div className="origin-wrap">
          <div
            className={'portrait-slot' + (onPlay ? ' importable' : '') + (portrait ? ' has-image' : '')}
            aria-label={onPlay ? 'Import a character portrait' : 'Character portrait'}
            role={onPlay ? 'button' : undefined}
            tabIndex={onPlay ? 0 : undefined}
            title={onPlay ? 'Click to import an image' : undefined}
            onClick={onPlay ? () => fileInputRef.current?.click() : undefined}
            onKeyDown={
              onPlay
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }
                : undefined
            }
          >
            {portrait ? (
              <img className="portrait-img" src={portrait} alt="Character portrait" />
            ) : (
              <span className="portrait-initials">{character.name.slice(0, 2).toUpperCase() || '—'}</span>
            )}
            {onPlay && (
              <span className="portrait-hint">
                <i className="ti ti-camera" aria-hidden="true" /> {portrait ? 'Change' : 'Add image'}
              </span>
            )}
            {onPlay && (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="portrait-file"
                onChange={importPortrait}
              />
            )}
          </div>
          {isMobile ? (
            <div className="origin-boxes">
              {[
                { icon: 'ti-user', label: 'Ancestry', name: ancestry?.name, title: ancestry?.name ?? 'Ancestry', desc: ancestry?.description, refs: ancestry?.descRefs },
                { icon: 'ti-sparkles', label: 'Heritage', name: heritage?.name, title: heritage?.name ?? 'Heritage', desc: heritage?.description, refs: heritage?.descRefs },
                { icon: 'ti-book-2', label: 'Background', name: bgName, title: bgName ?? 'Background', desc: bgDesc, refs: background?.descRefs },
                { icon: 'ti-shield-half', label: 'Class', name: cls?.name, title: cls?.name ?? 'Class', desc: cls?.description, refs: cls?.descRefs },
              ].map((o) => (
                <div className="obox" key={o.label}>
                  <i className={'ti ' + o.icon + ' olead'} aria-hidden="true" />
                  <div className="olabel">{o.label}</div>
                  <InfoTerm className="oval" title={o.title} description={o.desc} descRefs={o.refs}>
                    {o.name ?? '—'}
                  </InfoTerm>
                </div>
              ))}
            </div>
          ) : (
            <div className="origin-list">
              <div className="orow pair">
                <div className="ocell">
                  <i className="ti ti-user olead" aria-hidden="true" />
                  <div className="ocell-text">
                    <div className="olabel">Ancestry</div>
                    <InfoTerm className="oval" title={ancestry?.name ?? 'Ancestry'} description={ancestry?.description} descRefs={ancestry?.descRefs}>
                      {ancestry?.name ?? '—'}
                    </InfoTerm>
                  </div>
                </div>
                <div className="odiv" />
                <div className="ocell">
                  <i className="ti ti-sparkles olead" aria-hidden="true" />
                  <div className="ocell-text">
                    <div className="olabel">Heritage</div>
                    <InfoTerm className="oval" title={heritage?.name ?? 'Heritage'} description={heritage?.description} descRefs={heritage?.descRefs}>
                      {heritage?.name ?? '—'}
                    </InfoTerm>
                  </div>
                </div>
              </div>
              <div className="orow">
                <i className="ti ti-book-2 olead" aria-hidden="true" />
                <div className="ocell-text">
                  <div className="olabel">Background</div>
                  <InfoTerm className="oval" title={bgName ?? 'Background'} description={bgDesc} descRefs={background?.descRefs}>
                    {bgName ?? '—'}
                  </InfoTerm>
                </div>
              </div>
              <div className="orow">
                <i className="ti ti-shield-half olead" aria-hidden="true" />
                <div className="ocell-text">
                  <div className="olabel">Class</div>
                  <InfoTerm className="oval" title={cls?.name ?? 'Class'} description={cls?.description} descRefs={cls?.descRefs}>
                    {cls?.name ?? '—'}
                  </InfoTerm>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {character.customBackground && (
        <section className="card">
          <div className="ct">
            <i className="ti ti-book-2" aria-hidden="true" />
            Custom background{character.customBackground.name ? ` — ${character.customBackground.name}` : ''}
          </div>
          {character.customBackground.description && (
            <div className="gen-field" style={{ marginBottom: 8 }}>
              <div className="fv">{character.customBackground.description}</div>
            </div>
          )}
          <div className="gen-grid">
            <div className="gen-field">
              <div className="fl">Ability boosts</div>
              <div className="fv">{character.customBackground.boosts.filter(Boolean).map((b) => cap(b!)).join(', ') || '—'}</div>
            </div>
            <div className="gen-field">
              <div className="fl">Trained skill</div>
              <div className="fv">{character.customBackground.trainedSkill ? cap(character.customBackground.trainedSkill) : '—'}</div>
            </div>
            <div className="gen-field">
              <div className="fl">Lore</div>
              <div className="fv">{character.customBackground.loreSubject ? `${cap(character.customBackground.loreSubject)} Lore` : '—'}</div>
            </div>
            <div className="gen-field">
              <div className="fl">Skill feat</div>
              <div className="fv">
                {(character.customBackground.skillFeatId && content.feats[character.customBackground.skillFeatId]?.name) || '—'}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="ct">
          <i className="ti ti-user" aria-hidden="true" />
          General
        </div>
        {(deity || d.deityId) && (
          <div className="gen-field" style={{ marginBottom: 8 }}>
            <div className="fl">Deity</div>
            <div className="fv">
              <InfoTerm title={deity?.name ?? 'Deity'} description={deity?.description} descRefs={deity?.descRefs}>
                {deity?.name ?? d.deityId}
              </InfoTerm>
            </div>
          </div>
        )}
        {onPlay ? (
          <>
            <div className="gen-grid">
              {SHORT_FIELDS.map((f) => (
                <label className="gen-field" key={f.key}>
                  <div className="fl">{f.label}</div>
                  <input
                    className="gen-input"
                    value={d[f.key] ?? ''}
                    // Writes per keystroke — coalesce so typing a value is one undo step, not one per key.
                    onChange={(e) => onPlay((p) => setDetail(p, f.key, e.target.value), `detail:${f.key}`)}
                  />
                </label>
              ))}
            </div>
            {AREA_FIELDS.map((f) => (
              <label className="gen-field" key={f.key} style={{ marginTop: 8 }}>
                <div className="fl">{f.label}</div>
                <textarea
                  className="gen-textarea"
                  rows={2}
                  value={d[f.key] ?? ''}
                  onChange={(e) => onPlay((p) => setDetail(p, f.key, e.target.value), `detail:${f.key}`)}
                />
              </label>
            ))}
          </>
        ) : (
          <>
            {!d.appearance && !d.personality && !SHORT_FIELDS.some((f) => d[f.key]) && (
              <div className="gen-empty">No general details recorded.</div>
            )}
            {d.appearance && (
              <div className="gen-field" style={{ marginBottom: 8 }}>
                <div className="fl">Appearance</div>
                <div className="fv">{d.appearance}</div>
              </div>
            )}
            {d.personality && (
              <div className="gen-field">
                <div className="fl">Personality</div>
                <div className="fv">{d.personality}</div>
              </div>
            )}
            <div className="gen-grid">
              {SHORT_FIELDS.filter((f) => d[f.key]).map((f) => (
                <div className="gen-field" key={f.key}>
                  <div className="fl">{f.label}</div>
                  <div className="fv">{d[f.key]}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="ct">
          <i className="ti ti-tags" aria-hidden="true" />
          Traits &amp; size
        </div>
        <div className="id-row">
          <span className="idl">Size</span>
          <div className="idpills">
            <span className="lang-pill">{ancestry ? cap(ancestry.size) : '—'}</span>
          </div>
        </div>
        <div className="id-row">
          <span className="idl">Traits</span>
          <div className="idpills">
            {(ancestry?.traits ?? []).map((t) => (
              <InfoTerm className="lang-pill" key={t} title={cap(t)} description={traitDesc(t, content)}>
                {cap(t)}
              </InfoTerm>
            ))}
          </div>
        </div>
        <div className="id-row">
          <span className="idl">Languages</span>
          <div className="idpills">
            {character.languages.length ? (
              character.languages.map((id) => (
                <InfoTerm className="lang-pill" key={id} title={content.languages[id]?.name ?? cap(id)} description={languageDesc(id)}>
                  {content.languages[id]?.name ?? cap(id)}
                </InfoTerm>
              ))
            ) : (
              <span className="lang-pill">—</span>
            )}
          </div>
        </div>
        {senses.length > 0 && (
          <div className="id-row">
            <span className="idl">Senses</span>
            <div className="idpills">
              {senses.map((s) => (
                <InfoTerm className="lang-pill" key={s.name} title={senseLabel(s)} description={senseDesc(s.name)}>
                  {senseLabel(s)}
                </InfoTerm>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="ct">
          <i className="ti ti-award" aria-hidden="true" />
          Proficiencies
        </div>
        {groups.map((g) => (
          <div key={g.label}>
            <div className="prof-group-label">{g.label}</div>
            <div className="prof-grid">
              {g.rows.map((row, i) => (
                <div className="prof-cell" key={g.label + ':' + i}>
                  <RankPill rank={row.rank} />
                  <InfoTerm className="prof-name" title={row.name} description={row.desc}>
                    {row.name}
                  </InfoTerm>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
