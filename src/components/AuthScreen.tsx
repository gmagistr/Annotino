import { useEffect, useState, type FormEvent } from 'react';
import { availableModes, backend, githubBackend, setMode } from '../backend';
import { completeGitHubLogin, githubAppLogin, hasGitHubCallback, startGitHubLogin } from '../backend/githubAuth';
import type { BackendKind, Session } from '../backend/types';
import { signIn, signInWithGitHub, signUp, type Identity } from '../app/auth';
import { t } from '../i18n';
import { HeroSpectrogram } from './HeroSpectrogram';
import { LangSwitch } from './LangSwitch';
import { BrandMark } from './Icon';

interface Props {
  onReady: (identity: Identity) => void;
  onNeedsKeys: (session: Session, password: string) => void;
}

type Mode = 'sign-in' | 'sign-up' | 'reset';

const MODE_LABEL: Record<BackendKind, string> = {
  github: 'GitHub',
  supabase: 'Annotino server',
  local: 'This browser only',
};

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,gist&description=Annotino';

export function AuthScreen({ onReady, onNeedsKeys }: Props) {
  const [storage, setStorage] = useState<BackendKind>(backend.kind);
  const [token, setToken] = useState('');
  const [mode, setFormMode] = useState<Mode>('sign-in');
  const setMode_ = setFormMode;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Sign-in through the Annotino GitHub App: tokens and username once GitHub sent the user back.
  const [gh, setGh] = useState<{ login: string } | null>(null);
  const [useToken, setUseToken] = useState(!githubAppLogin);

  useEffect(() => {
    if (!hasGitHubCallback()) return;
    setMode('github');
    setStorage('github');
    setBusy(true);
    completeGitHubLogin()
      .then(async (tokens) => {
        if (!tokens) return;
        const session = await githubBackend().connect(tokens);
        setGh({ login: session.email });
      })
      .catch((e) => setError(t((e as Error).message)))
      .finally(() => setBusy(false));
  }, []);

  const githubSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await startGitHubLogin();
    } catch (e) {
      setError(t((e as Error).message));
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === 'sign-up') {
      if (password.length < 10) return setError(t('Use at least 10 characters for the password.'));
      if (password !== confirm) return setError(t('The two passwords do not match.'));
    }
    setBusy(true);
    try {
      if (storage === 'github') {
        if (!gh && !token.trim()) throw new Error('Paste your GitHub token.');
        if (password.length < 10) throw new Error('Use at least 10 characters for the password.');
        const r = await signInWithGitHub(gh ? null : token, password);
        if (r.status === 'ready') onReady(r.identity);
        else onNeedsKeys(r.session, password);
        return;
      }
      if (mode === 'reset') {
        await backend.requestPasswordReset(email);
        setNotice(t('If an account uses this email, a reset link is on its way. You will need your recovery code to unlock your data.'));
      } else if (mode === 'sign-up') {
        const r = await signUp(email, password);
        if (r.status === 'confirm-email') {
          setNotice(t('Check your inbox to confirm the address, then sign in.'));
          setMode_('sign-in');
        } else if (r.status === 'needs-keys') onNeedsKeys(r.session, password);
        else onReady(r.identity);
      } else {
        const r = await signIn(email, password);
        if (r.status === 'ready') onReady(r.identity);
        else onNeedsKeys(r.session, password);
      }
    } catch (err) {
      setError(t((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-intro">
        <header className="auth-brand">
          <BrandMark size={28} />
          <h1 className="wordmark">Annotino</h1>
          <p className="ipa auth-transcription">/anːoˈtiːno/</p>
        </header>
        <p className="auth-lead">{t('Transcribe and label speech together: spectrogram, pitch, formants, intensity and speech rate, with interval and point tiers in IPA.')}</p>
        <HeroSpectrogram />
        <div className="auth-facts">
          <p>{t('Recordings and annotations are encrypted in your browser before upload. Only the members of a team can open them, not the people who run the server.')}</p>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel-top">
          <LangSwitch />
        </div>
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="field">
            <span>{t('Where your team keeps its data')}</span>
            <div className="segmented wide" role="radiogroup" aria-label={t('Where your team keeps its data')}>
              {availableModes.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={storage === k}
                  onClick={() => {
                    setMode(k);
                    setStorage(k);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  {t(MODE_LABEL[k])}
                </button>
              ))}
            </div>
          </div>
          {storage === 'github' ? (
            <>
              <h2>{t('Sign in with GitHub')}</h2>
              <p className="lead-note">
                {t('Each team’s recordings and annotations go, encrypted, into a private repository of the person who creates the team. Annotino has no server of its own.')}
              </p>
              {gh ? (
                <p className="connected">
                  {t('Connected to GitHub as')} <strong>@{gh.login}</strong>.{' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setGh(null);
                      void githubBackend().signOut();
                    }}
                  >
                    {t('Use another account')}
                  </button>
                </p>
              ) : !useToken ? (
                <>
                  <button type="button" className="btn primary wide" onClick={githubSignIn} disabled={busy}>
                    {busy ? t('Working…') : t('Continue with GitHub')}
                  </button>
                  <p className="hint">
                    {t('GitHub asks you to authorise Annotino. Annotino can then reach only the repositories it creates for your teams and the repositories you install it on.')}
                  </p>
                  <button type="button" className="link subtle" onClick={() => setUseToken(true)}>
                    {t('Use a personal access token instead')}
                  </button>
                </>
              ) : (
              <>
              <label className="field">
                <span>{t('GitHub access token')}</span>
                <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" />
              </label>
              <p className="hint">
                {t('Create one on GitHub with the “repo” and “gist” permissions:')}{' '}
                <a href={TOKEN_URL} target="_blank" rel="noreferrer">github.com/settings/tokens</a>.{' '}
                {t('It stays in this browser and is sent only to GitHub.')}
              </p>
              {githubAppLogin && (
                <button type="button" className="link subtle" onClick={() => setUseToken(false)}>
                  {t('Sign in with the GitHub button instead')}
                </button>
              )}
              </>
              )}
              {(gh || useToken) && (
              <>
              <label className="field">
                <span>{t('Annotino password')}</span>
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <p className="hint">
                {t('It protects your encryption key and never leaves this computer. The first time, choose a new one; you will also receive a recovery code.')}
              </p>
              </>
              )}
            </>
          ) : (
          <>
          <h2>{mode === 'sign-in' ? t('Sign in') : mode === 'sign-up' ? t('Create an account') : t('Reset password')}</h2>
          {backend.kind === 'local' && (
            <p className="note">
              {t('Local mode: accounts and data are stored only in this browser. Configure a server to work with colleagues on other computers.')}
            </p>
          )}
          <label className="field">
            <span>{t('Email')}</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode !== 'reset' && (
            <label className="field">
              <span>{t('Password')}</span>
              <input
                type="password"
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {mode === 'sign-up' && (
            <>
              <label className="field">
                <span>{t('Repeat password')}</span>
                <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </label>
              <p className="hint">
                {t('Your password also protects your encryption key and is never sent to the server. Nobody can reset it for you; you will receive a recovery code instead.')}
              </p>
            </>
          )}
          </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="notice" role="status">{notice}</p>}
          {(storage !== 'github' || gh || useToken) && (
          <button className="btn primary wide" type="submit" disabled={busy}>
            {busy
              ? t('Working…')
              : storage === 'github'
                ? gh
                  ? t('Unlock Annotino')
                  : t('Continue with GitHub')
                : mode === 'sign-in'
                ? t('Sign in')
                : mode === 'sign-up'
                  ? t('Create account')
                  : t('Send reset link')}
          </button>
          )}
          {storage !== 'github' && (
          <div className="auth-switch">
            {mode === 'sign-in' ? (
              <>
                <button type="button" className="link" onClick={() => setMode_('sign-up')}>{t('Create an account')}</button>
                {backend.kind === 'supabase' && (
                  <button type="button" className="link" onClick={() => setMode_('reset')}>{t('Forgot your password?')}</button>
                )}
              </>
            ) : (
              <button type="button" className="link" onClick={() => setMode_('sign-in')}>{t('I already have an account')}</button>
            )}
          </div>
          )}
        </form>
        <p className="auth-foot">
          {storage === 'supabase'
            ? t('Data hosted in the EU, end-to-end encrypted.')
            : storage === 'github'
              ? t('Data in your team’s private GitHub repository, end-to-end encrypted.')
              : t('Nothing leaves this computer in local mode.')}
        </p>
      </section>
    </div>
  );
}
