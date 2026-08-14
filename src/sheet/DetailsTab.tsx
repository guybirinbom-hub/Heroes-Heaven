import { Fragment, useRef, useState } from 'react';
import type { Character, ContentDatabase, ProficiencyRank, SenseEntry, CharacterDetails } from '../rules/types';
import { RankPill } from './widgets';
import { RANK_LABEL } from '../rules/explain';
import { InfoTerm } from './InfoTerm';
import { deriveDefenses, creatureTraitsOf, deriveSize } from '../rules/derive';
import { setAvatar, setDetail, setPortrait, type PlayUpdater } from '../rules/play';
import { proficiencyDesc, rankDesc, senseDesc, traitDesc, languageDesc, DAILY_LANGUAGE_NOTE } from '../rules/glossary';
import { useAvatar } from './usePortrait';
import { uploadImage } from './portraitUpload';
import { getSharpPortrait } from '../data/portraitStore';
import { useIsMobile } from './useIsMobile';
import { DefensesPills } from './DefensesPills';
import { AvatarCropModal } from './AvatarCropModal';
import { CharacterImages } from './CharacterImages';

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
  // Q13: a superseded rung of the vision ladder is held but not printed — see deriveDefenses.
  const senses = deriveDefenses(character, content).senses.filter((s) => !s.superseded);
  const shownSize = deriveSize(character, content);
  const creatureTraits = creatureTraitsOf(character, content);

  const bgName = background?.name ?? character.customBackground?.name;
  const bgDesc = background?.description ?? character.customBackground?.description;

  // Portrait import: clicking the slot opens a file picker, then the frame-the-avatar step. The image
  // is stored BEFORE the crop dialog, so cancelling the dialog keeps the upload (with a centre crop)
  // rather than throwing it away.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const portrait = character.appearance?.portrait;
  // The slot is a small rectangle, so it shows the square the player framed (see useAvatar).
  const shownPortrait = useAvatar(character.appearance);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const importPortrait = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // allow re-selecting the same file later
    if (!file || !onPlay) return;
    // Compressed copy → synced character data; sharp copy (installed app) → on-device store.
    uploadImage(file)
      .then(({ compressed, ref }) => {
        onPlay((p) => setPortrait(p, compressed, ref));
        setCropSrc((ref && getSharpPortrait(ref)) || compressed);
        // The replaced sharp copy (oldRef) is NOT deleted here — an eager delete would break undo (Ctrl+Z
        // reverts to oldRef but the sharp image would be gone). Orphaned sharp copies are reclaimed by the
        // startup GC (gcSharpPortraits) once no character references them.
      })
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
  // Group-wide familiarity ("treat bombs as simple weapons"), which is a rule rather than a list of
  // weapons — it would otherwise be invisible here while quietly raising 172 Strikes.
  const groupRanks: ProfRow[] = (character.proficiencies.weaponGroupRanks ?? []).map((r) => ({
    name: r.category ? `${cap(r.category)} ${r.group}s` : `${cap(r.group)}s`,
    rank: r.rank,
    desc: `Weapons in the ${r.group} group${r.category ? ` with the ${r.category} category` : ''} count as this proficiency, whichever is higher.`,
  }));
  /*
   * The two proficiency tracks that ARE the chassis of their class, and which this page never showed.
   *
   * `weaponGroups` is the alchemist's bombs and the fighter's chosen Weapon Mastery group;
   * `firearmProf` is the gunslinger's per-category firearms-and-crossbows rank. Both are computed by
   * the builder and consumed only by deriveStrike — so a gunslinger's Proficiencies page read
   * "Simple Trained / Martial Trained / Advanced Untrained" at every level from 1 to 20 while the
   * engine knew they were legendary with firearms.
   */
  const groupTracks: ProfRow[] = Object.entries(character.proficiencies.weaponGroups ?? {}).map(([group, rank]) => ({
    name: `${cap(group)} weapons`,
    rank,
    desc: `Your proficiency with weapons in the ${group} group, which advances on its own track — it beats the plain category rank whenever it is higher.`,
  }));
  const firearmRows: ProfRow[] = Object.entries(character.proficiencies.firearmProf ?? {}).map(([category, rank]) => ({
    name: `${cap(category)} firearms & crossbows`,
    rank: rank as ProfRow['rank'],
    desc: 'Your gunslinger proficiency with firearms and crossbows of this category. It advances separately from the plain weapon categories, so it can be higher than either.',
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
    { label: 'Attacks', rows: [...attacks, ...groupTracks, ...firearmRows, ...groupRanks, ...overrides] },
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
              <img className="portrait-img" src={shownPortrait} alt="Character portrait" />
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
            /* Two rows of two rather than a pair and then a column: Ancestry over Class on the left,
               Heritage over Background on the right. */
            <div className="origin-list">
              {[
                [
                  { icon: 'ti-user', label: 'Ancestry', name: ancestry?.name, desc: ancestry?.description, refs: ancestry?.descRefs },
                  { icon: 'ti-sparkles', label: 'Heritage', name: heritage?.name, desc: heritage?.description, refs: heritage?.descRefs },
                ],
                [
                  { icon: 'ti-shield-half', label: 'Class', name: cls?.name, desc: cls?.description, refs: cls?.descRefs },
                  { icon: 'ti-book-2', label: 'Background', name: bgName, desc: bgDesc, refs: background?.descRefs },
                ],
              ].map((row, i) => (
                <div className="orow pair" key={i}>
                  {row.map((o, j) => (
                    <Fragment key={o.label}>
                      {j > 0 && <div className="odiv" />}
                      <div className="ocell">
                        <i className={'ti ' + o.icon + ' olead'} aria-hidden="true" />
                        <div className="ocell-text">
                          <div className="olabel">{o.label}</div>
                          <InfoTerm className="oval" title={o.name ?? o.label} description={o.desc} descRefs={o.refs}>
                            {o.name ?? '—'}
                          </InfoTerm>
                        </div>
                      </div>
                    </Fragment>
                  ))}
                </div>
              ))}
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
              {/* The three spells the deity grants to clerics. They were absent from the import
                  entirely, so a worshipper had no way to see them and no record could name them. */}
              {!!deity?.spells?.length && (
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  Cleric spells:{' '}
                  {deity.spells.map((id, i) => (
                    <span key={id}>
                      {i > 0 && ', '}
                      <InfoTerm title={content.spells[id]?.name ?? id} description={content.spells[id]?.description} descRefs={content.spells[id]?.descRefs}>
                        {content.spells[id]?.name ?? id}
                      </InfoTerm>
                    </span>
                  ))}
                </div>
              )}
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
            {/* A BATTLE FORM replaces your size for as long as it runs (deriveSize) — a worm-form
                character is Huge, and this row said Medium until the field had a reader. The second
                pill always says where the size came from, so a size that changed never changes
                silently. */}
            <span className="lang-pill">{cap(shownSize.size)}</span>
            {shownSize.from ? (
              <span className="lang-pill" style={{ opacity: 0.7 }}>from {shownSize.from}</span>
            ) : (
              character.size && ancestry && character.size !== ancestry.size && (
                <span className="lang-pill" style={{ opacity: 0.7 }}>from {cap(ancestry.size)}</span>
              )
            )}
          </div>
        </div>
        {character.reach != null && character.reach !== 5 && (
          <div className="id-row">
            <span className="idl">Reach</span>
            <div className="idpills">
              <span className="lang-pill">{character.reach} ft</span>
            </div>
          </div>
        )}
        <div className="id-row">
          <span className="idl">Traits</span>
          <div className="idpills">
            {/* The ancestry's own traits AND any a record granted — one row, because they answer the
                same question: what can target me. A granted trait is accent-bordered and names its
                source in the popup, so "undead" reads as acquired next to a born "human". */}
            {creatureTraits.map((t) => (
              <InfoTerm
                className={`lang-pill${t.from === 'granted' ? ' granted-trait' : ''}`}
                key={t.trait}
                title={cap(t.trait)}
                description={[traitDesc(t.trait, content), t.source ? `Granted by ${t.source}.` : null].filter(Boolean).join(' ')}
              >
                {cap(t.trait)}
              </InfoTerm>
            ))}
          </div>
        </div>
        <div className="id-row">
          <span className="idl">Languages</span>
          <div className="idpills">
            {character.languages.length ? (
              character.languages.map((id) => {
                // A language RECALLED this morning is not one you know. It takes the same accent
                // border a granted creature trait uses — acquired, not native — and its popup carries
                // the feat's own caveat, which is the half the player must not miss.
                const today = character.dailyLanguages?.includes(id);
                const name = content.languages[id]?.name ?? cap(id);
                return (
                  <InfoTerm
                    className={'lang-pill' + (today ? ' granted-trait' : '')}
                    key={id}
                    title={today ? `${name} — recalled today` : name}
                    description={today ? `${languageDesc(id)} ${DAILY_LANGUAGE_NOTE}` : languageDesc(id)}
                  >
                    {name}
                  </InfoTerm>
                );
              })
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
        {/* Sits directly under Senses: both answer "what is this body like", and a player with
            resistances checks them constantly. Renders nothing when there are none. */}
        <DefensesPills character={character} content={content} />
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
                  {/* The RANK itself is explainable too. Tapping "Simple" already told you what a
                      simple weapon is; the Legendary pill beside it explained nothing, even though
                      the five blurbs (Expert is +4, Legendary is +8) have been in the codebase all
                      along with no call site. */}
                  <InfoTerm title={RANK_LABEL[row.rank]} description={rankDesc(row.rank)}>
                    <RankPill rank={row.rank} />
                  </InfoTerm>
                  <InfoTerm className="prof-name" title={row.name} description={row.desc}>
                    {row.name}
                  </InfoTerm>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* The character's pictures: the profile one shown whole, plus any others. Renders nothing for a
          read-only sheet with no images, and stays a single picture + a button row for the common case. */}
      <CharacterImages character={character} onPlay={onPlay} />

      {/* Framing the avatar after an upload from the Origin slot above. */}
      {cropSrc && onPlay && (
        <AvatarCropModal
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onDone={(avatar) => {
            onPlay((p) => setAvatar(p, avatar));
            setCropSrc(null);
          }}
        />
      )}
    </div>
  );
}
