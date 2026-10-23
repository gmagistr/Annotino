import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Identity } from '../app/auth';
import {
  inviteMember,
  isAdmin,
  loadRecordings,
  renameTeam,
  uploadRecording,
  type RecordingEntry,
  type TeamEntry,
} from '../app/teams';
import { backend } from '../backend';
import type { MemberRow, PublicProfile, Role, Visibility } from '../backend/types';
import { fingerprint } from '../crypto/crypto';
import { ANNOTINO, encodeWav, synthesise } from '../dsp/synth';
import { t } from '../i18n';
import { formatBytes, formatDate, formatDuration } from '../lib/format';
import { VISIBILITY_LABEL } from './visibility';

interface Props {
  identity: Identity;
  team: TeamEntry;
  onChanged: () => Promise<void>;
  onOpen: (recording: RecordingEntry) => void;
  onGuide: () => void;
}

interface MemberView extends MemberRow {
  profile?: PublicProfile;
  fp?: string;
}

export function TeamView({ identity, team, onChanged, onOpen, onGuide }: Props) {
  const admin = isAdmin(team);
  const owner = team.membership.role === 'owner';
  const [recordings, setRecordings] = useState<RecordingEntry[] | null>(null);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('member');
  const [inviteNote, setInviteNote] = useState<string | null>(null);
  const [name, setName] = useState(team.name);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setRecordings(await loadRecordings(team));
    const [rows, profiles] = await Promise.all([backend.listMembers(team.team.id), backend.teamProfiles(team.team.id)]);
    const views: MemberView[] = [];
    for (const m of rows) {
      const profile = profiles.find((p) => p.id === m.user_id);
      views.push({ ...m, profile, fp: profile ? await fingerprint(profile.public_key) : undefined });
    }
    const order: Record<Role, number> = { owner: 0, admin: 1, member: 2 };
    setMembers(views.sort((a, b) => order[a.role] - order[b.role]));
  }, [team]);

  useEffect(() => {
    load().catch((e) => setError(String(e.message ?? e)));
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(t((err as Error).message));
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      // GitHub stores the audio in parts; Supabase's free plan stops at 50 MB a file.
      const maxMb = backend.kind === 'github' ? 100 : 50;
      if (file.size > maxMb * 1024 * 1024) {
        setError(t('{name} is larger than {mb} MB. Split the recording or convert it to FLAC.', { name: file.name, mb: maxMb }));
        continue;
      }
      setUploading(file.name);
      await run(async () => uploadRecording(team, identity, file.name, await file.arrayBuffer()));
    }
    setUploading(null);
    await load();
  };

  const addSample = () =>
    run(async () => {
      setUploading('annotino.wav');
      const wav = encodeWav(synthesise(ANNOTINO, 16000), 16000);
      await uploadRecording(team, identity, 'annotino (sample).wav', wav.buffer);
      setUploading(null);
      await load();
    });

  const invite = (e: FormEvent) => {
    e.preventDefault();
    setInviteNote(null);
    void run(async () => {
      const p = await inviteMember(team, inviteEmail, inviteRole);
      setInviteNote(t('{name} can now open this team.', { name: p.display_name }));
      setInviteEmail('');
      await load();
    });
  };

  const setSettings = (patch: Partial<TeamEntry['team']['settings']>) =>
    run(async () => {
      await backend.updateTeam(team.team.id, { settings: { ...team.team.settings, ...patch } });
      await onChanged();
    });

  return (
    <div className="team-view">
      <header className="page-head">
        <h1>{team.name}</h1>
        <p className="muted">
          {t('You are {role} of this team.', { role: t(team.membership.role) })}{' '}
          {t('Default visibility of new tiers: {v}.', { v: t(VISIBILITY_LABEL[team.team.settings.defaultVisibility]) })}
        </p>
        {backend.storageLabel?.(team.team.id) && (
          <p className="muted">
            {t('Data in the private GitHub repository')}{' '}
            <a href={`https://github.com/${backend.storageLabel(team.team.id)}`} target="_blank" rel="noreferrer">
              {backend.storageLabel(team.team.id)}
            </a>
            . {t('Its files are encrypted; only members can read them in Annotino.')}
          </p>
        )}
        <div>
          <button type="button" className="btn" onClick={onGuide}>
            {t('Annotation guidelines')}
          </button>
        </div>
      </header>
      {error && <p className="error banner" role="alert">{error}</p>}

      <section className="section" aria-labelledby="rec-h">
        <div className="section-head">
          <h2 id="rec-h">{t('Recordings')}</h2>
          {admin && (
            <div className="row">
              <input
                ref={fileInput}
                type="file"
                accept="audio/*,.wav,.flac,.mp3,.ogg,.m4a"
                multiple
                hidden
                onChange={(e) => {
                  void upload(e.target.files);
                  e.target.value = '';
                }}
              />
              <button type="button" className="btn primary" onClick={() => fileInput.current?.click()} disabled={!!uploading}>
                {uploading ? t('Uploading {name}…', { name: uploading }) : t('Upload audio')}
              </button>
            </div>
          )}
        </div>
        {recordings === null ? (
          <p className="muted">{t('Decrypting…')}</p>
        ) : recordings.length === 0 ? (
          <div className="empty-inline">
            <p>
              {admin
                ? t('No recordings yet. Upload WAV, FLAC, MP3 or OGG files; they are encrypted before they leave this computer.')
                : t('No recordings yet. An owner or admin of the team can upload them.')}
            </p>
            {admin && (
              <button type="button" className="btn" onClick={addSample} disabled={!!uploading}>
                {t('Add a sample recording')}
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('File')}</th>
                  <th scope="col" className="num">{t('Duration')}</th>
                  <th scope="col" className="num">{t('Sample rate')}</th>
                  <th scope="col" className="num">{t('Size')}</th>
                  <th scope="col">{t('Added')}</th>
                  <th scope="col"><span className="visually-hidden">{t('Actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {recordings.map((r) => (
                  <tr key={r.row.id}>
                    <td>
                      <button type="button" className="link strong" onClick={() => onOpen(r)}>{r.meta.name}</button>
                      {r.row.blind_revealed && <span className="tag">{t('blind tiers revealed')}</span>}
                    </td>
                    <td className="num">{formatDuration(r.meta.duration)}</td>
                    <td className="num">{(r.meta.sampleRate / 1000).toLocaleString()} kHz</td>
                    <td className="num">{formatBytes(r.meta.size)}</td>
                    <td>{formatDate(r.row.created_at)}</td>
                    <td className="actions">
                      <button type="button" className="btn small" onClick={() => onOpen(r)}>{t('Annotate')}</button>
                      {admin &&
                        (confirmDelete === r.row.id ? (
                          <>
                            <button
                              type="button"
                              className="btn small danger"
                              onClick={() =>
                                run(async () => {
                                  await backend.deleteRecording(r.row);
                                  setConfirmDelete(null);
                                  await load();
                                })
                              }
                            >
                              {t('Delete with all annotations')}
                            </button>
                            <button type="button" className="btn small quiet" onClick={() => setConfirmDelete(null)}>{t('Keep')}</button>
                          </>
                        ) : (
                          <button type="button" className="btn small quiet" onClick={() => setConfirmDelete(r.row.id)}>{t('Delete')}</button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="mem-h">
        <div className="section-head">
          <h2 id="mem-h">{t('Members')}</h2>
        </div>
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.user_id} className="member">
              <div>
                <span className="member-name">{m.profile?.display_name ?? t('Unknown')}</span>
                {m.user_id === identity.session.userId && <span className="tag">{t('you')}</span>}
                <span className="member-email">{m.profile?.email}</span>
              </div>
              <span className="member-fp" title={t('Key fingerprint. Compare it with your colleague to confirm you invited the right person.')}>
                {m.fp}
              </span>
              <div className="member-role">
                {owner && m.role !== 'owner' ? (
                  <select
                    aria-label={t('Role')}
                    value={m.role}
                    onChange={(e) =>
                      run(async () => {
                        await backend.updateMemberRole(team.team.id, m.user_id, e.target.value as Role);
                        await load();
                      })
                    }
                  >
                    <option value="admin">{t('admin')}</option>
                    <option value="member">{t('member')}</option>
                  </select>
                ) : (
                  <span>{t(m.role)}</span>
                )}
              </div>
              <div className="actions">
                {m.role !== 'owner' && (admin || m.user_id === identity.session.userId) && (
                  <button
                    type="button"
                    className="btn small quiet"
                    onClick={() =>
                      run(async () => {
                        await backend.removeMember(team.team.id, m.user_id);
                        if (m.user_id === identity.session.userId) await onChanged();
                        else await load();
                      })
                    }
                  >
                    {m.user_id === identity.session.userId ? t('Leave team') : t('Remove')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {admin && (
          <form className="invite" onSubmit={invite}>
            <label className="field grow">
              <span>{backend.kind === 'github' ? t('Add by GitHub username') : t('Invite by email')}</span>
              <input
                type={backend.kind === 'github' ? 'text' : 'email'}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={backend.kind === 'github' ? 'username' : 'nome@universita.it'}
              />
            </label>
            <label className="field">
              <span>{t('Role')}</span>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                <option value="member">{t('member')}</option>
                <option value="admin">{t('admin')}</option>
              </select>
            </label>
            <button className="btn" type="submit" disabled={!inviteEmail}>{t('Add to team')}</button>
          </form>
        )}
        {inviteNote && <p className="notice" role="status">{inviteNote}</p>}
        <p className="hint">
          {t('Members receive the team key encrypted for them alone. Admins can upload recordings and invite people; members annotate.')}
          {backend.kind === 'github' &&
            ` ${t('On GitHub they also become collaborators of the repository; they must have signed in to Annotino once before you add them.')}`}
        </p>
      </section>

      {owner && (
        <section className="section" aria-labelledby="set-h">
          <div className="section-head">
            <h2 id="set-h">{t('Team settings')}</h2>
          </div>
          <div className="settings-grid">
            <form
              className="field"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await renameTeam(team, name.trim());
                  await onChanged();
                });
              }}
            >
              <span>{t('Team name')}</span>
              <div className="row">
                <input value={name} onChange={(e) => setName(e.target.value)} />
                <button className="btn small" type="submit" disabled={!name.trim() || name === team.name}>{t('Rename')}</button>
              </div>
            </form>
            <label className="field">
              <span>{t('Default visibility of new tiers')}</span>
              <select
                value={team.team.settings.defaultVisibility}
                onChange={(e) => setSettings({ defaultVisibility: e.target.value as Visibility })}
              >
                {(['blind', 'team', 'private', 'scheduled'] as Visibility[]).map((v) => (
                  <option key={v} value={v}>{t(VISIBILITY_LABEL[v])}</option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={team.team.settings.lockVisibility}
                onChange={(e) => setSettings({ lockVisibility: e.target.checked })}
              />
              <span>{t('Members must use the default visibility (recommended while measuring agreement)')}</span>
            </label>
          </div>
          <DeleteTeam team={team} onDeleted={onChanged} />
        </section>
      )}
    </div>
  );
}

function DeleteTeam({ team, onDeleted }: { team: TeamEntry; onDeleted: () => Promise<void> }) {
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" className="btn quiet danger-text" onClick={() => setOpen(true)}>
        {t('Delete this team…')}
      </button>
    );
  return (
    <div className="danger-zone">
      <p>{t('This deletes every recording and annotation of the team for all members. Type the team name to confirm.')}</p>
      <div className="row">
        <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={t('Team name')} />
        <button
          type="button"
          className="btn danger"
          disabled={typed !== team.name}
          onClick={async () => {
            try {
              await backend.deleteTeam(team.team.id);
              await onDeleted();
            } catch (err) {
              setError(t((err as Error).message));
            }
          }}
        >
          {t('Delete team')}
        </button>
        <button type="button" className="btn quiet" onClick={() => setOpen(false)}>{t('Cancel')}</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
