/**
 * "Sign in with GitHub" through the Annotino GitHub App.
 *
 * The page sends the user to GitHub, GitHub sends them back with a one-time
 * code, and the sign-in bridge (bridge/worker.js) turns that code into an
 * access token, because only it holds the app's client secret. The token
 * expires after eight hours and is renewed through the bridge with the refresh
 * token. PKCE ties the code to this browser, so an intercepted code is useless.
 */

const CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined;
const APP_SLUG = import.meta.env.VITE_GITHUB_APP_SLUG as string | undefined;
const BRIDGE = (import.meta.env.VITE_GITHUB_BRIDGE as string | undefined)?.replace(/\/+$/, '');
const AUTHORIZE_URL = (import.meta.env.VITE_GITHUB_AUTHORIZE as string | undefined) ?? 'https://github.com/login/oauth/authorize';
const PENDING_KEY = 'annotino.github.pending';

export interface GitHubTokens {
  access: string;
  refresh?: string;
  /** Milliseconds since the epoch; absent for tokens that do not expire. */
  expiresAt?: number;
}

/** True when this build is configured with a GitHub App and a bridge. */
export const githubAppLogin = Boolean(CLIENT_ID && BRIDGE);

/** Where an owner installs the app, so that Annotino may create team repositories. */
export const githubInstallUrl = APP_SLUG ? `https://github.com/apps/${APP_SLUG}/installations/new` : null;

function redirectUri(): string {
  return location.origin + location.pathname;
}

function randomString(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function startGitHubLogin(): Promise<void> {
  if (!CLIENT_ID) throw new Error('This copy of Annotino is not connected to a GitHub App.');
  const state = randomString(16);
  const verifier = randomString(48);
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ state, verifier, redirect: redirectUri() }));
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  });
  location.assign(`${AUTHORIZE_URL}?${q}`);
}

/** Does the address bar carry GitHub's answer to a sign-in? */
export function hasGitHubCallback(): boolean {
  const q = new URLSearchParams(location.search);
  return q.has('code') || (q.has('error') && q.has('state')) || q.get('setup_action') === 'install';
}

function tokensFrom(data: { access_token: string; refresh_token?: string; expires_in?: number }): GitHubTokens {
  return {
    access: data.access_token,
    refresh: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

async function callBridge(path: string, body: unknown): Promise<GitHubTokens> {
  if (!BRIDGE) throw new Error('This copy of Annotino is not connected to a GitHub App.');
  let res: Response;
  try {
    res = await fetch(`${BRIDGE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new Error('The GitHub sign-in service could not be reached. Try again in a moment.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    if (data.error === 'bad_refresh_token') throw new Error('Your GitHub session has ended. Sign in with GitHub again.');
    throw new Error('GitHub did not complete the sign-in. Try again.');
  }
  return tokensFrom(data);
}

let completing: Promise<GitHubTokens | null> | null = null;

/**
 * Finish a sign-in after GitHub redirected back here. Resolves to null when
 * there is nothing to finish (for instance after installing the app without
 * a new authorisation). Safe to call twice: the code is exchanged only once.
 */
export function completeGitHubLogin(): Promise<GitHubTokens | null> {
  completing ??= (async () => {
    const q = new URLSearchParams(location.search);
    const code = q.get('code');
    const state = q.get('state');
    const error = q.get('error');
    history.replaceState(null, '', location.pathname + location.hash);
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as { state: string; verifier: string; redirect: string } | null;
    sessionStorage.removeItem(PENDING_KEY);
    if (error) throw new Error(error === 'access_denied' ? 'The sign-in was cancelled on GitHub.' : 'GitHub did not complete the sign-in. Try again.');
    if (!code) return null;
    // A code that arrives without the sign-in this browser started (or from an
    // installation page) is not trusted: start again.
    if (!pending || pending.state !== state) return null;
    return callBridge('/token', { code, code_verifier: pending.verifier, redirect_uri: pending.redirect });
  })();
  return completing;
}

export function refreshGitHubTokens(refresh: string): Promise<GitHubTokens> {
  return callBridge('/refresh', { refresh_token: refresh });
}
