import { useState, type FormEvent } from 'react';
import type { Session } from '../backend/types';
import { createKeys, signOut, type Identity } from '../app/auth';
import { deriveAuthSecret } from '../crypto/crypto';
import { backend } from '../backend';
import { t } from '../i18n';

interface Props {
  session: Session;
  password: string | null;
  onDone: (identity: Identity) => void;
  onCancel: () => void;
}

export function KeySetup({ session, password: given, onDone, onCancel }: Props) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState(given ?? '');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ identity: Identity; recoveryCode: string } | null>(null);
  const [stored, setStored] = useState(false);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t('Enter the name your colleagues will see.'));
    setBusy(true);
    setError(null);
    try {
      if (password.length < 10) throw new Error('Use at least 10 characters for the password.');
      if (backend.kind === 'github' && given && confirm !== password) throw new Error('The two passwords do not match.');
      if (!given && backend.kind !== 'github') {
        // Confirm the password really is the account password before deriving keys from it.
        await backend.signIn(session.email, await deriveAuthSecret(session.email, password));
      }
      setResult(await createKeys(session, password, name));
    } catch (err) {
      setError(t((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="centre-page">
        <div className="sheet">
          <h1>{t('Your recovery code')}</h1>
          <p>
            {t('Your recordings are encrypted with a key that only your password can open. If you forget the password, this code is the only way back in. Annotino cannot recover it for you.')}
          </p>
          <p className="recovery-code ipa" aria-label={t('Recovery code')}>{result.recoveryCode}</p>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await navigator.clipboard.writeText(result.recoveryCode);
                setCopied(true);
              }}
            >
              {copied ? t('Copied') : t('Copy code')}
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} />
            <span>{t('I have stored the code somewhere safe, away from this computer.')}</span>
          </label>
          <button type="button" className="btn primary" disabled={!stored} onClick={() => onDone(result.identity)}>
            {t('Continue to Annotino')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="centre-page">
      <form className="sheet" onSubmit={submit}>
        <h1>{t('Set up your account')}</h1>
        <p>{t('Annotino now creates your personal encryption key. It takes a few seconds.')}</p>
        <label className="field">
          <span>{t('Your name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('As it should appear on annotations')} autoFocus />
        </label>
        {backend.kind === 'github' && given && (
          <label className="field">
            <span>{t('Repeat your new Annotino password')}</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
        )}
        {!given && (
          <label className="field">
            <span>{t('Password')}</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? t('Creating key…') : t('Create my key')}</button>
          <button
            type="button"
            className="btn quiet"
            onClick={async () => {
              await signOut();
              onCancel();
            }}
          >
            {t('Sign out')}
          </button>
        </div>
      </form>
    </div>
  );
}
