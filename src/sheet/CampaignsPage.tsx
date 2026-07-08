import { useMemo, useState } from 'react';
import '../builder/builder.css';
import type { ContentDatabase, ModeDef } from '../rules/types';
import { emptyBuild, type BuildState } from '../rules/build';
import { sourceCatalog } from '../rules/sources';
import { useBuilderActions, VariantRulesCard, CampaignOptionsCard, SourcesCard } from '../builder/shared';
import {
  createCampaign,
  updateCampaign,
  deleteCampaign,
  fetchCampaignByCode,
  normalizeCode,
  type Campaign,
  type CampaignDefaults,
  type CampaignMembership,
} from '../data/campaigns';
import { loadCampaigns, saveCampaigns } from '../data/storage';
import { PageMenu } from './PageMenu';
import { WindowControls } from './WindowControls';
import { HeroesHeavenLogo } from './Logo';
import { confirmDialog } from './confirm';
import { useBackHandler } from './useEscapeClose';
import { useIsMobile } from './useIsMobile';

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; m: CampaignMembership } | { kind: 'created'; c: Campaign } | { kind: 'join' };

/** Build a BuildState carrying just the campaign-default fields, so the Setup cards can edit them. */
function buildFromDefaults(d?: CampaignDefaults): BuildState {
  return {
    ...emptyBuild(),
    variantRules: d?.variantRules ?? {},
    enabledSources: d?.enabledSources,
    mythicEnabled: d?.mythicEnabled ?? false,
    kingmakerEnabled: d?.kingmakerEnabled ?? false,
  };
}
function defaultsFromBuild(b: BuildState): CampaignDefaults {
  return {
    variantRules: b.variantRules,
    enabledSources: b.enabledSources,
    mythicEnabled: b.mythicEnabled,
    kingmakerEnabled: b.kingmakerEnabled,
  };
}

/** The GM defaults editor — the exact Setup cards from the character builder, over a throwaway build. */
function DefaultsEditor({ content, build, setBuild }: { content: ContentDatabase; build: BuildState; setBuild: React.Dispatch<React.SetStateAction<BuildState>> }) {
  const actions = useBuilderActions(setBuild, content);
  const catalog = useMemo(() => sourceCatalog(content), [content]);
  return (
    <div className="cmp-defaults">
      <div className="setup-note" style={{ marginBottom: 10 }}>
        Defaults new characters in this campaign can start from — the same options as a character&rsquo;s Setup page.
      </div>
      <VariantRulesCard build={build} actions={actions} content={content} />
      <CampaignOptionsCard build={build} actions={actions} content={content} />
      <SourcesCard build={build} actions={actions} catalog={catalog} />
    </div>
  );
}

interface CampaignsPageProps {
  content: ContentDatabase;
  onClose: () => void;
  onOpenRoster: () => void;
  onOpenHomebrew: () => void;
  characters: { id: string; name: string }[];
  modes: Record<string, ModeDef>;
  onSaveMode: (m: ModeDef) => void;
  onDeleteMode: (id: string) => void;
}

export function CampaignsPage({ content, onClose, onOpenRoster, onOpenHomebrew, characters, modes, onSaveMode, onDeleteMode }: CampaignsPageProps) {
  const [memberships, setMemberships] = useState<CampaignMembership[]>(() => loadCampaigns());
  const [view, setView] = useState<View>({ kind: 'list' });
  const isMobile = useIsMobile();
  useBackHandler(view.kind !== 'list', () => setView({ kind: 'list' }));

  const persist = (next: CampaignMembership[]) => {
    setMemberships(next);
    saveCampaigns(next);
  };
  const upsertMembership = (m: CampaignMembership) => persist([...memberships.filter((x) => x.id !== m.id), m]);

  const menu = (
    <PageMenu
      items={[
        { label: 'Characters', icon: 'ti-users', onClick: onOpenRoster },
        { label: 'Homebrew', icon: 'ti-flask', onClick: onOpenHomebrew },
      ]}
      modes={modes}
      characters={characters}
      onSaveMode={onSaveMode}
      onDeleteMode={onDeleteMode}
    />
  );

  return (
    <div className="hb-page cmp-page">
      <header className="chrome" data-tauri-drag-region>
        <div className="chrome-brand" data-tauri-drag-region>
          {/* Sub-views step back to the list; on the list, a back arrow leaves the page (desktop / where
              there's no hamburger to lean on). On a phone's list view you leave via the hamburger. */}
          {(view.kind !== 'list' || !isMobile) && (
            <button
              className="icon-btn hb-back"
              onClick={view.kind !== 'list' ? () => setView({ kind: 'list' }) : onClose}
              title="Back"
              aria-label={view.kind !== 'list' ? 'Back to campaigns' : 'Back'}
            >
              <i className="ti ti-arrow-left" aria-hidden="true" />
            </button>
          )}
          <HeroesHeavenLogo className="chrome-logo" />{' '}
          {view.kind === 'list' ? 'Campaigns' : view.kind === 'join' ? 'Join a campaign' : view.kind === 'created' ? 'Campaign created' : view.kind === 'edit' ? 'Edit campaign' : 'New campaign'}
        </div>
        <WindowControls />
        {menu}
      </header>

      <div className="cmp-body">
        {view.kind === 'list' && (
          <CampaignList
            memberships={memberships}
            onCreate={() => setView({ kind: 'create' })}
            onJoin={() => setView({ kind: 'join' })}
            onEdit={(m) => setView({ kind: 'edit', m })}
            onLeave={async (m) => {
              const ok = await confirmDialog({ title: `Leave “${m.name}”?`, message: 'It stays on the list until you rejoin with the code.', confirmLabel: 'Leave' });
              if (ok) persist(memberships.filter((x) => x.id !== m.id));
            }}
            onDelete={async (m) => {
              const ok = await confirmDialog({ title: `Delete “${m.name}”?`, message: 'This permanently deletes the campaign for everyone — players will no longer be able to open it. This cannot be undone.', confirmLabel: 'Delete', danger: true });
              if (!ok) return;
              const res = await deleteCampaign(m.id);
              if (res.ok) persist(memberships.filter((x) => x.id !== m.id));
              else await confirmDialog({ title: "Couldn't delete", message: res.error, confirmLabel: 'OK' });
            }}
          />
        )}

        {(view.kind === 'create' || view.kind === 'edit') && (
          <CampaignForm
            content={content}
            editing={view.kind === 'edit' ? view.m : undefined}
            onCancel={() => setView({ kind: 'list' })}
            onCreated={(c) => {
              upsertMembership({ id: c.id, code: c.code, role: 'gm', name: c.name, description: c.description });
              setView({ kind: 'created', c });
            }}
            onSaved={(c) => {
              upsertMembership({ id: c.id, code: c.code, role: 'gm', name: c.name, description: c.description });
              setView({ kind: 'list' });
            }}
          />
        )}

        {view.kind === 'created' && <CreatedView c={view.c} onDone={() => setView({ kind: 'list' })} />}

        {view.kind === 'join' && (
          <JoinForm
            already={new Set(memberships.map((m) => m.id))}
            onCancel={() => setView({ kind: 'list' })}
            onJoined={(c, useDefaults) => {
              upsertMembership({ id: c.id, code: c.code, role: 'player', name: c.name, description: c.description, useDefaults });
              setView({ kind: 'list' });
            }}
          />
        )}
      </div>
    </div>
  );
}

function CampaignList({ memberships, onCreate, onJoin, onEdit, onLeave, onDelete }: {
  memberships: CampaignMembership[];
  onCreate: () => void;
  onJoin: () => void;
  onEdit: (m: CampaignMembership) => void;
  onLeave: (m: CampaignMembership) => void;
  onDelete: (m: CampaignMembership) => void;
}) {
  return (
    <div className="cmp-list">
      <p className="cmp-intro">
        A <strong>campaign</strong> ties your group together. A GM creates one, sets its default rules, and shares the
        code; players join with that code. You can be in as many as you like.
      </p>
      {memberships.length === 0 ? (
        <div className="cmp-empty">No campaigns yet.</div>
      ) : (
        memberships.map((m) => (
          <div className="cmp-card" key={m.id}>
            <div className="cmp-card-main">
              <div className="cmp-card-name">
                {m.name}
                <span className={'cmp-role ' + m.role}>{m.role === 'gm' ? 'GM' : 'Player'}</span>
              </div>
              {m.description && <div className="cmp-card-desc">{m.description}</div>}
              <CodeChip code={m.code} />
            </div>
            <div className="cmp-card-actions">
              {m.role === 'gm' ? (
                <>
                  <button className="chip" onClick={() => onEdit(m)}><i className="ti ti-pencil" aria-hidden="true" /> Edit</button>
                  <button className="chip danger" onClick={() => onDelete(m)}><i className="ti ti-trash" aria-hidden="true" /> Delete</button>
                </>
              ) : (
                <button className="chip" onClick={() => onLeave(m)}><i className="ti ti-logout" aria-hidden="true" /> Leave</button>
              )}
            </div>
          </div>
        ))
      )}
      <div className="cmp-add-row">
        <button className="btn-primary" onClick={onCreate}><i className="ti ti-plus" aria-hidden="true" /> Create a campaign</button>
        <button className="btn" onClick={onJoin}><i className="ti ti-login" aria-hidden="true" /> Join with a code</button>
      </div>
    </div>
  );
}

function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="cmp-code"
      title="Copy code"
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      <i className="ti ti-hash" aria-hidden="true" />
      <span className="cmp-code-val">{code}</span>
      <i className={'ti ' + (copied ? 'ti-check' : 'ti-copy')} aria-hidden="true" />
    </button>
  );
}

function CampaignForm({ content, editing, onCancel, onCreated, onSaved }: {
  content: ContentDatabase;
  editing?: CampaignMembership;
  onCancel: () => void;
  onCreated: (c: Campaign) => void;
  onSaved: (c: Campaign) => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [build, setBuild] = useState<BuildState>(() => buildFromDefaults());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // When editing, pull the campaign's current defaults so the cards reflect them.
  const [loadedDefaults, setLoadedDefaults] = useState(!editing);
  if (editing && !loadedDefaults) {
    void fetchCampaignByCode(editing.code).then((res) => {
      if (res.ok) setBuild(buildFromDefaults(res.value.defaults));
      setLoadedDefaults(true);
    });
  }

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const defaults = defaultsFromBuild(build);
    const res = editing
      ? await updateCampaign(editing.id, { name, description, defaults })
      : await createCampaign(name, description, defaults);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (editing) onSaved(res.value);
    else onCreated(res.value);
  };

  return (
    <div className="cmp-form">
      <label className="cmp-field">
        <span className="cmp-label">Name</span>
        <input className="hb-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fall of Plaguestone" autoFocus />
      </label>
      <label className="cmp-field">
        <span className="cmp-label">Description</span>
        <textarea className="hb-input cmp-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What&rsquo;s this campaign about? (optional)" rows={3} />
      </label>
      {editing && !loadedDefaults ? (
        <div className="setup-note">Loading current defaults…</div>
      ) : (
        <DefaultsEditor content={content} build={build} setBuild={setBuild} />
      )}
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className="cmp-form-actions">
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
          {busy ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes' : 'Create campaign'}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function CreatedView({ c, onDone }: { c: Campaign; onDone: () => void }) {
  return (
    <div className="cmp-created">
      <i className="ti ti-circle-check cmp-created-icon" aria-hidden="true" />
      <h2 className="cmp-created-title">“{c.name}” is ready</h2>
      <p className="cmp-created-sub">Share this code with your players so they can join:</p>
      <CodeChip code={c.code} />
      <p className="cmp-created-hint">Players open <strong>Campaigns → Join with a code</strong> and enter it.</p>
      <button className="btn-primary" onClick={onDone}>Done</button>
    </div>
  );
}

function JoinForm({ already, onCancel, onJoined }: {
  already: Set<string>;
  onCancel: () => void;
  onJoined: (c: Campaign, useDefaults: boolean) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState<Campaign | null>(null);

  const find = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const res = await fetchCampaignByCode(code);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (already.has(res.value.id)) {
      setError("You're already in this campaign.");
      return;
    }
    setFound(res.value);
  };

  if (found) {
    return (
      <div className="cmp-join">
        <div className="cmp-found">
          <div className="cmp-card-name">{found.name}</div>
          {found.description && <div className="cmp-card-desc">{found.description}</div>}
        </div>
        <div className="cmp-defaults-ask">
          <div className="cmp-ask-title">Use this campaign&rsquo;s default setup?</div>
          <p className="cmp-ask-sub">The GM picked default rules for this campaign. Start your characters from them, or set your own.</p>
          <div className="cmp-ask-actions">
            <button className="btn-primary" onClick={() => onJoined(found, true)}>Yes, use the defaults</button>
            <button className="btn" onClick={() => onJoined(found, false)}>No, I&rsquo;ll set up my own</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cmp-join">
      <label className="cmp-field">
        <span className="cmp-label">Campaign code</span>
        <input
          className="hb-input cmp-code-input"
          value={code}
          autoFocus
          placeholder="ABC234"
          maxLength={12}
          onChange={(e) => { setCode(normalizeCode(e.target.value)); if (error) setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void find(); }}
        />
      </label>
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className="cmp-form-actions">
        <button className="btn-primary" disabled={busy || !code.trim()} onClick={() => void find()}>{busy ? 'Finding…' : 'Find campaign'}</button>
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
