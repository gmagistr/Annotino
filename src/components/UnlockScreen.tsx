import { useState, type FormEvent } from 'react';
import type { ProfileRow, Session } from '../backend/types';
import { recover, signOut, unlock, type Identity } from '../app/auth';
import { t } from '../i18n';

interface Props {
  session: Session;
  profile: ProfileRow;
  onReady: (identity: Identity) => void;
  onSignOut: () => void;
}

/** The session is valid but this device does not hold the decrypted key. */
export function UnlockScreen({ session, profile, onReady, onSignOut }: Props) {
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'password') onReady(await unlock(session, profile, password));
      else {
        if (newPassword.length < 10) throw new Error('Use at least 10 characters for the password.');
        onReady(await recover(session, profile, code, newPassword));
      }
    } catch (err) {
      setError(mode === 'password' ? t('This password does not unlock your key.') : t((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centre-page">
      <form className="sheet" onSubmit={submit}>
        <h1>{t('Unlock your data')}</h1>
        <p>{t('Signed in as {email}. Enter your password to decrypt your key on this device.', { email: session.email })}</p>
        {mode === 'password' ? (
          <label className="field">
            <span>{t('Password')}</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
        ) : (
          <>
            <label className="field">
              <span>{t('Recovery code')}</span>
              <input className="ipa" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autoFocus />
            </label>
            <label className="field">
              <span>{t('New password')}</span>
              <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </label>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? t('Working…') : mode === 'password' ? t('Unlock') : t('Recover and set password')}
          </button>
          <button type="button" className="link" onClick={() => setMode(mode === 'password' ? 'recovery' : 'password')}>
            {mode === 'password' ? t('Use my recovery code') : t('Use my password')}
          </button>
        </div>
        <button
          type="button"
          className="link subtle"
          onClick={async () => {
            await signOut(session.userId);
            onSignOut();
          }}
        >
          {t('Sign out')}
        </button>
      </form>
    </div>
  );
}
