import { useEffect, useState, type FormEvent } from 'react';
import { changePassword, type Identity } from '../app/auth';
import { backend } from '../backend';
import { fingerprint } from '../crypto/crypto';
import { t } from '../i18n';
import { LangSwitch } from './LangSwitch';

interface Props {
  identity: Identity;
  onIdentityChange: (identity: Identity) => void;
}

export function AccountView({ identity, onIdentityChange }: Props) {
  const [fp, setFp] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [name, setName] = useState(identity.profile.display_name);
  const [msg, setMsg] = useState<{ kind: 'error' | 'notice'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fingerprint(identity.profile.public_key).then(setFp);
  }, [identity]);

  const submitPw = async (e: FormEvent) => {
    e.preventDefault();
    if (newPw.length < 10) return setMsg({ kind: 'error', text: t('Use at least 10 characters for the password.') });
    setBusy(true);
    try {
      onIdentityChange(await changePassword(identity, oldPw, newPw));
      setOldPw('');
      setNewPw('');
      setMsg({ kind: 'notice', text: t('Password changed. Your recovery code still works.') });
    } catch (err) {
      setMsg({ kind: 'error', text: t((err as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  const submitName = async (e: FormEvent) => {
    e.preventDefault();
    const profile = { ...identity.profile, display_name: name.trim() };
    await backend.saveMyProfile(profile);
    onIdentityChange({ ...identity, profile });
    setMsg({ kind: 'notice', text: t('Name updated.') });
  };

  return (
    <div className="account-view">
      <header className="page-head">
        <h1>{t('Account')}</h1>
        <p className="muted">{identity.session.email}</p>
      </header>
      {msg && <p className={`${msg.kind} banner`} role="status">{msg.text}</p>}

      <section className="section">
        <h2>{t('Profile')}</h2>
        <form className="row align-end" onSubmit={submitName}>
          <label className="field grow">
            <span>{t('Your name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="btn" type="submit" disabled={!name.trim() || name === identity.profile.display_name}>{t('Save')}</button>
        </form>
        <div className="field">
          <span>{t('Language')}</span>
          <LangSwitch />
        </div>
      </section>

      <section className="section">
        <h2>{t('Change password')}</h2>
        <form className="stack narrow" onSubmit={submitPw}>
          <label className="field">
            <span>{t('Current password')}</span>
            <input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('New password')}</span>
            <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </label>
          <div>
            <button className="btn" type="submit" disabled={busy || !oldPw || !newPw}>{busy ? t('Working…') : t('Change password')}</button>
          </div>
        </form>
      </section>

      <section className="section prose">
        <h2>{t('How your data is protected')}</h2>
        <p>
          {t('Audio, file names, team names, tiers and drawings are encrypted in this browser with AES-256-GCM before they are uploaded. Each team has its own key, which is stored only in a form that each member’s personal key can open.')}
        </p>
        <p>
          {t('Your personal key is protected by your password, which never leaves this device: the server receives a value derived from it, not the password itself. Whoever runs the server, including the developers of Annotino, sees encrypted data, email addresses and display names, and the time and size of uploads.')}
        </p>
        <p>
          {t('Annotation visibility is enforced by the server: a blind or private tier is never sent to other members until it is revealed.')}
        </p>
        <dl className="facts">
          <dt>{t('Your key fingerprint')}</dt>
          <dd className="fp">{fp}</dd>
          <dt>{t('Storage')}</dt>
          <dd>{backend.kind === 'supabase' ? t('Hosted server (EU region)') : t('This browser only (local mode)')}</dd>
        </dl>
      </section>
    </div>
  );
}
