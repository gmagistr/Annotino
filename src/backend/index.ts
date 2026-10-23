import { GitHubBackend } from './github';
import { LocalBackend } from './local';
import { SupabaseBackend } from './supabase';
import type { Backend, BackendKind } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const MODE_KEY = 'annotino.mode';

/** Where data can be kept in this build: GitHub and this browser always; a Supabase server when configured. */
export const availableModes: BackendKind[] = url && key ? ['supabase', 'github', 'local'] : ['github', 'local'];

const instances: Partial<Record<BackendKind, Backend>> = {};
function instance(kind: BackendKind): Backend {
  instances[kind] ??= kind === 'supabase' ? new SupabaseBackend(url!, key!) : kind === 'github' ? new GitHubBackend() : new LocalBackend();
  return instances[kind]!;
}

function initialMode(): BackendKind {
  const stored = localStorage.getItem(MODE_KEY) as BackendKind | null;
  if (stored && availableModes.includes(stored)) return stored;
  // Someone already signed in locally before modes existed keeps working locally.
  if (localStorage.getItem('annotino.local.session')) return 'local';
  return availableModes[0];
}

let current: Backend = instance(initialMode());

export function setMode(kind: BackendKind) {
  localStorage.setItem(MODE_KEY, kind);
  current = instance(kind);
}

export function githubBackend(): GitHubBackend {
  return instance('github') as GitHubBackend;
}

/** The active backend; the mode is chosen on the sign-in screen and remembered. */
export const backend: Backend = new Proxy({} as Backend, {
  get(_, prop) {
    const v = (current as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof v === 'function' ? v.bind(current) : v;
  },
});
