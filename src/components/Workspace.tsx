import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { signOut, type Identity } from '../app/auth';
import {
  createTeam,
  loadGuide,
  loadRecordings,
  loadTeams,
  newAnnotationRow,
  saveAnnotation,
  type AnnotationDoc,
  type RecordingEntry,
  type TeamEntry,
} from '../app/teams';
import { loadNotices, markSeen, seenIds, type Notice } from '../app/notices';
import { backend, githubBackend } from '../backend';
import type { PublicProfile } from '../backend/types';
import { t } from '../i18n';
import { formatTime } from '../lib/format';
import { referenceFor } from '../lib/references';
import { anchorLabel, defaultGuide, TAG_COLORS, type Anchor, type Guide } from '../model';
import { AccountView } from './AccountView';
import { Editor, type EditorTarget } from './editor/Editor';
import { GuideView } from './GuideView';
import { InboxView } from './InboxView';
import { TeamView } from './TeamView';
import { BrandMark } from './Icon';

interface Props {
  identity: Identity;
  onIdentityChange: (identity: Identity) => void;
  onSignOut: () => void;
}

type View =
  | { kind: 'team' }
  | { kind: 'guide' }
  | { kind: 'inbox' }
  | { kind: 'account' }
  | { kind: 'recording'; recording: RecordingEntry; target: EditorTarget | null };

const NOTICE_POLL_MS = 60_000;

export function Workspace({ identity, onIdentityChange, onSignOut }: Props) {
  const me = identity.session.userId;
  const [teams, setTeams] = useState<TeamEntry[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(() => localStorage.getItem('annotino.team'));
  const [view, setView] = useState<View>({ kind: 'team' });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [guide, setGuide] = useState<AnnotationDoc<Guide> | null>(null);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [invitations, setInvitations] = useState<{ id: number; repo: string; from: string }[]>([]);
  const [joining, setJoining] = useState(false);
  const [repoName, setRepoName] = useState('');

  // GitHub mode: invitations to team repositories.
  useEffect(() => {
    backend.listInvitations?.().then(setInvitations).catch(() => {});
  }, []);

  // GitHub App: creating a team needs the app installed on the user's account.
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const checkInstall = useCallback(() => {
    if (backend.kind !== 'github') return;
    githubBackend().installNeeded().then(setInstallUrl).catch(() => {});
  }, []);
  useEffect(() => {
    // Coming back from GitHub's installation page.
    if (new URLSearchParams(location.search).has('setup_action')) history.replaceState(null, '', location.pathname + location.hash);
    checkInstall();
    window.addEventListener('focus', checkInstall);
    return () => window.removeEventListener('focus', checkInstall);
  }, [checkInstall]);

  const refresh = useCallback(async () => {
    const list = await loadTeams(identity);
    setTeams(list);
    setTeamId((cur) => (cur && list.some((x) => x.team.id === cur) ? cur : (list[0]?.team.id ?? null)));
    return list;
  }, [identity]);

  useEffect(() => {
    refresh().catch((e) => setError(String(e.message ?? e)));
  }, [refresh]);

  useEffect(() => {
    if (teamId) localStorage.setItem('annotino.team', teamId);
  }, [teamId]);

  const team = teams?.find((x) => x.team.id === teamId) ?? null;

  // The team's guide (rules and tag vocabulary) and member names.
  useEffect(() => {
    setGuide(null);
    setProfiles([]);
    if (!team) return;
    loadGuide(team).then(setGuide).catch(() => {});
    backend.teamProfiles(team.team.id).then(setProfiles).catch(() => {});
  }, [team]);

  // Notifications: mentions and replies across all teams.
  const refreshNotices = useCallback(async () => {
    if (!teams) return;
    const [list, s] = await Promise.all([loadNotices(teams, me), seenIds(me)]);
    setNotices(list);
    setSeen(s);
  }, [teams, me]);

  useEffect(() => {
    void refreshNotices().catch(() => {});
    const id = window.setInterval(() => void refreshNotices().catch(() => {}), NOTICE_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshNotices]);

  const unread = notices.filter((n) => !seen.has(n.messageId)).length;

  const onSeen = useCallback(
    async (ids: string[]) => {
      if (ids.every((id) => seen.has(id))) return;
      setSeen(await markSeen(me, ids));
    },
    [me, seen],
  );

  const guideContent: Guide = useMemo(() => guide?.content ?? defaultGuide(t), [guide]);

  const saveGuide = useCallback(
    async (content: Guide) => {
      if (!team) return;
      const row = guide?.row ?? newAnnotationRow(team, identity, null, 'guide', 'team');
      if (guide) {
        const latest = await backend.getAnnotation(guide.row.id);
        if (latest && latest.updated_at !== guide.row.updated_at) {
          setToast(t('A colleague changed the guidelines meanwhile. Your version is saved; theirs is in the history.'));
        }
      }
      const saved = await saveAnnotation(team, { row, content });
      setGuide({ row: { ...saved, updated_by: me }, content });
    },
    [team, guide, identity, me],
  );

  const addTagDef = (name: string) =>
    void saveGuide({
      ...guideContent,
      tags: [...guideContent.tags, { id: crypto.randomUUID(), name, color: TAG_COLORS[guideContent.tags.length % TAG_COLORS.length], description: '' }],
    }).catch((e) => setError(String(e.message ?? e)));

  const cite = (anchor: Anchor) => {
    if (view.kind !== 'recording') return;
    const name = view.recording.meta.name.replace(/\.[^.]+$/, '');
    const text = `${name} ${anchorLabel(anchor, (x) => formatTime(x, 2))}`;
    const line = `- ${referenceFor(anchor, text)}`;
    const body = guideContent.body.trim() ? `${guideContent.body.trimEnd()}\n${line}\n` : `${line}\n`;
    saveGuide({ ...guideContent, body })
      .then(() => setToast(t('Added to the annotation guidelines.')))
      .catch((e) => setError(String(e.message ?? e)));
  };

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const openAt = async (teamEntry: TeamEntry, recordingId: string, target: EditorTarget | null) => {
    const recs = await loadRecordings(teamEntry);
    const rec = recs.find((r) => r.row.id === recordingId);
    if (!rec) {
      setError(t('This recording no longer exists.'));
      return;
    }
    setTeamId(teamEntry.team.id);
    setView({ kind: 'recording', recording: rec, target });
  };

  const nameOf = (id: string) => (id === me ? t('You') : (profiles.find((p) => p.id === id)?.display_name ?? t('Former member')));

  const submitTeam = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await createTeam(identity, newName.trim());
      setNewName('');
      setCreating(false);
      await refresh();
    } catch (err) {
      setError(t((err as Error).message));
    }
  };

  const toastEl = toast && (
    <p className="toast" role="status">
      {toast}
    </p>
  );

  if (view.kind === 'recording' && team) {
    return (
      <>
        <Editor
          key={view.recording.row.id + (view.target ? JSON.stringify(view.target) : '')}
          identity={identity}
          team={team}
          recording={view.recording}
          target={view.target}
          tagDefs={guideContent.tags}
          onAddTagDef={addTagDef}
          onCite={cite}
          onSeen={onSeen}
          onClose={() => {
            setView({ kind: 'team' });
            void refreshNotices();
          }}
        />
        {toastEl}
      </>
    );
  }

  return (
    <div className="shell">
      <nav className="sidebar" aria-label={t('Teams')}>
        <div className="sidebar-brand">
          <BrandMark />
          <span className="wordmark small">Annotino</span>
          {backend.kind === 'local' && <span className="mode-tag">{t('local')}</span>}
        </div>
        <button
          type="button"
          className="nav-link"
          aria-current={view.kind === 'inbox' ? 'page' : undefined}
          onClick={() => setView({ kind: 'inbox' })}
        >
          <span>{t('Notifications')}</span>
          {unread > 0 && <span className="count">{unread}</span>}
        </button>
        <h2 className="sidebar-heading">{t('Teams')}</h2>
        <ul className="team-list">
          {teams?.map((x) => (
            <li key={x.team.id}>
              <button
                type="button"
                className="team-link"
                aria-current={x.team.id === teamId && view.kind === 'team' ? 'page' : undefined}
                onClick={() => {
                  setTeamId(x.team.id);
                  setView({ kind: 'team' });
                }}
              >
                <span>{x.name}</span>
                <span className="team-role">{t(x.membership.role)}</span>
              </button>
              {x.team.id === teamId && (
                <button
                  type="button"
                  className="sub-link"
                  aria-current={view.kind === 'guide' ? 'page' : undefined}
                  onClick={() => setView({ kind: 'guide' })}
                >
                  {t('Annotation guidelines')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {creating ? (
          <form className="new-team" onSubmit={submitTeam}>
            <input
              autoFocus
              value={newName}
              placeholder={t('Team name')}
              aria-label={t('Team name')}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
            />
            <div className="row">
              <button className="btn small primary" type="submit">{t('Create')}</button>
              <button className="btn small quiet" type="button" onClick={() => setCreating(false)}>{t('Cancel')}</button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn small" onClick={() => setCreating(true)}>{t('New team')}</button>
        )}
        {backend.joinRepository &&
          (joining ? (
            <form
              className="new-team"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await backend.joinRepository!(repoName);
                  setRepoName('');
                  setJoining(false);
                  await refresh();
                } catch (err) {
                  setError(t((err as Error).message));
                }
              }}
            >
              <input
                autoFocus
                value={repoName}
                placeholder="owner/annotino-team-…"
                aria-label={t('GitHub repository of the team')}
                onChange={(e) => setRepoName(e.target.value)}
              />
              <div className="row">
                <button className="btn small primary" type="submit">{t('Add')}</button>
                <button className="btn small quiet" type="button" onClick={() => setJoining(false)}>{t('Cancel')}</button>
              </div>
            </form>
          ) : (
            <button type="button" className="link subtle side-link" onClick={() => setJoining(true)}>
              {t('Open a team from its repository')}
            </button>
          ))}

        <div className="sidebar-foot">
          <button
            type="button"
            className="account-link"
            aria-current={view.kind === 'account' ? 'page' : undefined}
            onClick={() => setView({ kind: 'account' })}
          >
            <span className="account-name">{identity.profile.display_name}</span>
            <span className="account-email">{identity.session.email}</span>
          </button>
          <button
            type="button"
            className="link subtle"
            onClick={async () => {
              await signOut(identity.session.userId);
              onSignOut();
            }}
          >
            {t('Sign out')}
          </button>
        </div>
      </nav>

      <main className="main">
        {error && <p className="error banner" role="alert">{error}</p>}
        {installUrl && (
          <div className="note banner row space wrap">
            <span>{t('To create a team, install Annotino on your GitHub account. You do not need to if you only join colleagues’ teams.')}</span>
            <a className="btn small primary" href={installUrl} target="_blank" rel="noreferrer">
              {t('Install on GitHub')}
            </a>
          </div>
        )}
        {invitations.map((inv) => (
          <div key={inv.id} className="note banner row space wrap">
            <span>{t('{from} added you to a team on GitHub ({repo}).', { from: inv.from, repo: inv.repo })}</span>
            <button
              type="button"
              className="btn small primary"
              onClick={async () => {
                try {
                  await backend.acceptInvitation!(inv.id, inv.repo);
                  setInvitations((cur) => cur.filter((x) => x.id !== inv.id));
                  await refresh();
                } catch (e) {
                  setError(t((e as Error).message));
                }
              }}
            >
              {t('Join the team')}
            </button>
          </div>
        ))}
        {view.kind === 'account' ? (
          <AccountView identity={identity} onIdentityChange={onIdentityChange} />
        ) : view.kind === 'inbox' ? (
          <InboxView
            notices={notices}
            seen={seen}
            teams={teams ?? []}
            onOpen={async (n) => {
              setSeen(await markSeen(me, [n.messageId]));
              const entry = teams?.find((x) => x.team.id === n.teamId);
              if (entry) await openAt(entry, n.recordingId, { anchor: n.anchor, threadId: n.threadId });
            }}
            onMarkAll={async () => setSeen(await markSeen(me, notices.map((n) => n.messageId)))}
            onRefresh={refreshNotices}
          />
        ) : teams === null ? (
          <p className="muted pad">{t('Decrypting your teams…')}</p>
        ) : team && view.kind === 'guide' ? (
          <GuideView
            key={team.team.id}
            identity={identity}
            team={team}
            guide={guide}
            content={guideContent}
            onSave={saveGuide}
            onOpen={(recording, anchor) => setView({ kind: 'recording', recording, target: { anchor } })}
            nameOf={nameOf}
          />
        ) : team ? (
          <TeamView
            key={team.team.id}
            identity={identity}
            team={team}
            onChanged={async () => {
              await refresh();
            }}
            onOpen={(recording) => setView({ kind: 'recording', recording, target: null })}
            onGuide={() => setView({ kind: 'guide' })}
          />
        ) : (
          <div className="empty-state">
            <h1>{t('Start a team')}</h1>
            <p>
              {t('A team shares recordings and annotations. Create one, upload audio, then invite colleagues by the email they used to sign up.')}
            </p>
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>{t('New team')}</button>
          </div>
        )}
      </main>
      {toastEl}
    </div>
  );
}
