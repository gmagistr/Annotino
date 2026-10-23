/**
 * GitHub mode: each team keeps its data in a private GitHub repository owned by
 * its creator. Annotino itself is only a static page; there is no Annotino
 * server at all.
 *
 * Repository layout (every file is ciphertext except ids and flags):
 *   annotino.json                         the team row (name encrypted)
 *   members/<userId>.json                 role, team key wrapped for that member, public key
 *   recordings/<recordingId>.json         the recording row (metadata encrypted)
 *   audio/<random>.bin                    the encrypted audio
 *   annotations/<recordingId|team>/<id>.json   annotation rows
 *
 * The user's own key pair lives in two gists: a secret one with the
 * password-protected private key and the list of teams, and a public one with
 * the public key, so that admins can add people by their GitHub username.
 *
 * Every collaborator of a repository can read all of it, so visibility cannot
 * be enforced by a server here. Private, blind and scheduled annotations are
 * therefore sealed: encrypted a second time with a key that only the author
 * holds. The author's browser removes the seal once the annotation may be
 * shown (a date has passed, an admin has revealed blind tiers, or the author
 * shares it), the next time the author opens Annotino.
 */

import { decryptBytes, encryptBytes, fromB64, toB64 } from '../crypto/crypto';
import { blobCache } from '../lib/idb';
import { githubInstallUrl, refreshGitHubTokens, type GitHubTokens } from './githubAuth';
import {
  SHARED_KINDS,
  type AnnotationKind,
  type AnnotationRow,
  type Backend,
  type MemberRow,
  type ProfileRow,
  type PublicProfile,
  type RecordingRow,
  type Role,
  type Session,
  type TeamRow,
  type VersionRow,
} from './types';

// Overridable for tests against a local stand-in of the GitHub API.
const API = (import.meta.env.VITE_GITHUB_API as string | undefined) ?? 'https://api.github.com';
const TOKEN_KEY = 'annotino.github.token';
const AUTH_KEY = 'annotino.github.auth';
const PROFILE_GIST = 'Annotino profile (encrypted key)';
const PROFILE_FILE = 'annotino-profile.json';
const PUBLIC_GIST = 'Annotino public key';
const PUBLIC_FILE = 'annotino-public-key.json';
const COMMIT_MESSAGE = 'Annotino update';

class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

interface StoredProfile extends ProfileRow {
  /** owner/repo of every team repository the user belongs to. */
  teams: string[];
}

interface StoredMember extends MemberRow {
  login: string;
  display_name: string;
  public_key: JsonWebKey;
}

/** A sealed row keeps its payload encrypted with a key wrapped for the author only. */
interface StoredAnnotation extends AnnotationRow {
  seal?: { author_key: string };
}

interface TreeEntry {
  path: string;
  sha: string;
  type: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64json = (v: unknown) => toB64(enc.encode(JSON.stringify(v, null, 2)));

function message(status: number, body: { message?: string }): string {
  if (status === 401) return 'GitHub did not accept the sign-in. Sign in with GitHub again.';
  if (status === 403 && /rate limit/i.test(body.message ?? '')) return 'GitHub’s request limit is reached. Wait a few minutes and try again.';
  if (status === 404) return 'Not found on GitHub, or the token has no access to it.';
  return body.message ? `GitHub: ${body.message}` : `GitHub error ${status}`;
}

function loadAuth(): GitHubTokens | null {
  try {
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored) return JSON.parse(stored) as GitHubTokens;
  } catch {
    // fall through to the older format
  }
  const legacy = localStorage.getItem(TOKEN_KEY);
  return legacy ? { access: legacy } : null;
}

export class GitHubBackend implements Backend {
  readonly kind = 'github' as const;
  readonly saveDelayMs = 4000;

  private auth: GitHubTokens | null = loadAuth();
  private refreshing: Promise<void> | null = null;
  private user: { id: string; login: string } | null = null;
  private profileGistId: string | null = null;
  private profileCache: StoredProfile | null = null;
  private repos = new Map<string, RepoRef>(); // teamId → repository
  private trees = new Map<string, { at: number; entries: Map<string, TreeEntry> }>();
  private teamKeys = new Map<string, CryptoKey>();
  private privateKey: CryptoKey | null = null;
  private publicKey: JsonWebKey | null = null;
  private logins = new Map<string, string>(); // userId → login, from lookups

  // ------------------------------------------------------------ HTTP

  private get token(): string | null {
    return this.auth?.access ?? null;
  }

  private storeAuth(auth: GitHubTokens | null) {
    this.auth = auth;
    localStorage.removeItem(TOKEN_KEY);
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  }

  /** Renew an expiring app token through the sign-in bridge; one renewal at a time. */
  private renew(): Promise<void> {
    const refresh = this.auth?.refresh;
    if (!refresh) return Promise.reject(new GitHubError(401, message(401, {})));
    this.refreshing ??= refreshGitHubTokens(refresh)
      .then((t) => this.storeAuth(t))
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private async req<T>(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json', retried = false): Promise<T> {
    if (!this.token) throw new Error('Not signed in.');
    if (this.auth?.expiresAt && this.auth.refresh && Date.now() > this.auth.expiresAt - 120_000) await this.renew();
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (res.status === 401 && this.auth?.refresh && !retried) {
      await this.renew();
      return this.req<T>(method, path, body, accept, true);
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new GitHubError(res.status, message(res.status, data));
    }
    if (res.status === 204) return undefined as T;
    if (accept === 'application/vnd.github.raw') return (await res.arrayBuffer()) as T;
    return res.json() as Promise<T>;
  }

  // ------------------------------------------------------------ identity

  /**
   * Sign in with the tokens of the Annotino GitHub App, or with a personal
   * access token (scopes: repo, gist).
   */
  async connect(token: string | GitHubTokens): Promise<Session> {
    const previous = this.auth;
    this.auth = typeof token === 'string' ? { access: token.trim() } : token;
    try {
      const u = await this.req<{ id: number; login: string }>('GET', '/user');
      this.user = { id: `gh-${u.id}`, login: u.login };
      this.storeAuth(this.auth);
      return { userId: this.user.id, email: u.login };
    } catch (e) {
      this.auth = previous;
      throw e;
    }
  }

  /** The GitHub username of the signed-in person. */
  get login(): string | null {
    return this.user?.login ?? null;
  }

  /**
   * With the GitHub App, creating a team repository needs the app installed on
   * the user's account. Returns the page to install it from when it is not, or
   * null when nothing is needed (installed, or signed in with a personal token).
   */
  async installNeeded(): Promise<string | null> {
    if (!this.auth?.refresh && !this.auth?.expiresAt) return null;
    if (!githubInstallUrl) return null;
    try {
      const data = await this.req<{ installations: { account: { login: string } | null }[] }>('GET', '/user/installations');
      const mine = data.installations.some((i) => i.account?.login === this.user?.login);
      return mine ? null : githubInstallUrl;
    } catch {
      return null;
    }
  }

  setIdentity(privateKey: CryptoKey, publicKey: JsonWebKey) {
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  storageLabel(teamId: string): string | null {
    const r = this.repos.get(teamId);
    return r ? `${r.owner}/${r.repo}` : null;
  }

  setTeamKey(teamId: string, key: CryptoKey) {
    this.teamKeys.set(teamId, key);
  }

  private me(): { id: string; login: string } {
    if (!this.user) throw new Error('Not signed in.');
    return this.user;
  }

  async requestPasswordReset(): Promise<void> {
    throw new Error('With GitHub there is no password to reset by email: use your recovery code.');
  }

  async signUp(): Promise<Session | null> {
    throw new Error('Sign in with a GitHub token.');
  }

  async signIn(): Promise<Session> {
    throw new Error('Sign in with a GitHub token.');
  }

  async signOut() {
    this.storeAuth(null);
    this.user = null;
    this.profileCache = null;
    this.profileGistId = null;
    this.repos.clear();
    this.trees.clear();
    this.teamKeys.clear();
    this.privateKey = null;
  }

  async session(): Promise<Session | null> {
    if (!this.token) return null;
    if (!this.user) {
      try {
        const u = await this.req<{ id: number; login: string }>('GET', '/user');
        this.user = { id: `gh-${u.id}`, login: u.login };
      } catch {
        return null;
      }
    }
    return { userId: this.user.id, email: this.user.login };
  }

  async changeAuthSecret(): Promise<void> {
    // The password only protects the key stored in the profile gist; nothing to change on GitHub.
  }

  private async findGist(description: string, file: string): Promise<{ id: string; content: string } | null> {
    for (let page = 1; page <= 5; page++) {
      const list = await this.req<{ id: string; description: string; files: Record<string, unknown> }[]>('GET', `/gists?per_page=100&page=${page}`);
      const g = list.find((x) => x.description === description && file in x.files);
      if (g) {
        const full = await this.req<{ files: Record<string, { content: string }> }>('GET', `/gists/${g.id}`);
        return { id: g.id, content: full.files[file].content };
      }
      if (list.length < 100) break;
    }
    return null;
  }

  private async storedProfile(): Promise<StoredProfile | null> {
    if (this.profileCache) return this.profileCache;
    const g = await this.findGist(PROFILE_GIST, PROFILE_FILE);
    if (!g) return null;
    this.profileGistId = g.id;
    this.profileCache = JSON.parse(g.content) as StoredProfile;
    return this.profileCache;
  }

  private async writeProfile(p: StoredProfile) {
    const files = { [PROFILE_FILE]: { content: JSON.stringify(p, null, 2) } };
    if (this.profileGistId) await this.req('PATCH', `/gists/${this.profileGistId}`, { files });
    else {
      const g = await this.req<{ id: string }>('POST', '/gists', { description: PROFILE_GIST, public: false, files });
      this.profileGistId = g.id;
    }
    this.profileCache = p;
  }

  async getMyProfile(): Promise<ProfileRow | null> {
    const p = await this.storedProfile();
    if (!p) return null;
    const { teams: _t, ...row } = p;
    void _t;
    return row;
  }

  async saveMyProfile(row: ProfileRow): Promise<void> {
    const me = this.me();
    const current = await this.storedProfile();
    await this.writeProfile({ ...row, id: me.id, email: me.login, teams: current?.teams ?? [] });
    // Publish the public key so that admins can add this account by username.
    const pub = await this.findGist(PUBLIC_GIST, PUBLIC_FILE);
    const files = {
      [PUBLIC_FILE]: { content: JSON.stringify({ id: me.id, login: me.login, display_name: row.display_name, public_key: row.public_key }, null, 2) },
    };
    if (pub) await this.req('PATCH', `/gists/${pub.id}`, { files });
    else await this.req('POST', '/gists', { description: PUBLIC_GIST, public: true, files });
  }

  async findProfileByEmail(loginOrEmail: string): Promise<PublicProfile | null> {
    const login = loginOrEmail.trim().replace(/^@/, '');
    let gists: { id: string; description: string; files: Record<string, unknown> }[];
    try {
      gists = await this.req('GET', `/users/${encodeURIComponent(login)}/gists?per_page=100`);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) throw new Error('There is no GitHub account with this username.');
      throw e;
    }
    const g = gists.find((x) => x.description === PUBLIC_GIST && PUBLIC_FILE in x.files);
    if (!g) throw new Error('This GitHub user has not signed in to Annotino yet. Ask them to sign in once, then add them.');
    const full = await this.req<{ files: Record<string, { content: string }> }>('GET', `/gists/${g.id}`);
    const pub = JSON.parse(full.files[PUBLIC_FILE].content) as { id: string; login: string; display_name: string; public_key: JsonWebKey };
    this.logins.set(pub.id, pub.login);
    return { id: pub.id, email: pub.login, display_name: pub.display_name, public_key: pub.public_key };
  }

  // ------------------------------------------------------------ repository files

  private repoOf(teamId: string): RepoRef {
    const r = this.repos.get(teamId);
    if (!r) throw new Error('This team’s repository is not available. Reload Annotino.');
    return r;
  }

  private async tree(r: RepoRef, fresh = false): Promise<Map<string, TreeEntry>> {
    const key = `${r.owner}/${r.repo}`;
    const cached = this.trees.get(key);
    if (cached && !fresh && Date.now() - cached.at < 4000) return cached.entries;
    const data = await this.req<{ tree: TreeEntry[] }>('GET', `/repos/${key}/git/trees/${encodeURIComponent(r.branch)}?recursive=1`);
    const entries = new Map(data.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e]));
    this.trees.set(key, { at: Date.now(), entries });
    return entries;
  }

  private async blobText(r: RepoRef, sha: string): Promise<string> {
    const cached = await blobCache.get<string>(sha);
    if (cached !== undefined) return cached;
    const data = await this.req<{ content: string }>('GET', `/repos/${r.owner}/${r.repo}/git/blobs/${sha}`);
    const text = dec.decode(fromB64(data.content.replace(/\n/g, '')));
    // Blobs are content-addressed, so a cached copy never goes stale.
    await blobCache.put(sha, text);
    return text;
  }

  private async readJSON<T>(r: RepoRef, path: string): Promise<T | null> {
    const e = (await this.tree(r)).get(path);
    return e ? (JSON.parse(await this.blobText(r, e.sha)) as T) : null;
  }

  private async readDir<T>(r: RepoRef, prefix: string): Promise<T[]> {
    const entries = [...(await this.tree(r)).values()].filter((e) => e.path.startsWith(prefix) && e.path.endsWith('.json'));
    return Promise.all(entries.map(async (e) => JSON.parse(await this.blobText(r, e.sha)) as T));
  }

  private async writeFile(r: RepoRef, path: string, contentB64: string): Promise<void> {
    const key = `${r.owner}/${r.repo}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const sha = (await this.tree(r, attempt > 0)).get(path)?.sha;
      try {
        const res = await this.req<{ content: { sha: string } }>('PUT', `/repos/${key}/contents/${path}`, {
          message: COMMIT_MESSAGE,
          content: contentB64,
          branch: r.branch,
          ...(sha ? { sha } : {}),
        });
        this.trees.get(key)?.entries.set(path, { path, sha: res.content.sha, type: 'blob' });
        return;
      } catch (e) {
        // 409/422: someone else committed meanwhile; refresh the file's sha and retry.
        if (!(e instanceof GitHubError) || (e.status !== 409 && e.status !== 422) || attempt === 2) throw e;
      }
    }
  }

  private async writeJSON(r: RepoRef, path: string, value: unknown) {
    await this.writeFile(r, path, b64json(value));
  }

  private async deleteFile(r: RepoRef, path: string) {
    const key = `${r.owner}/${r.repo}`;
    const sha = (await this.tree(r, true)).get(path)?.sha;
    if (!sha) return;
    await this.req('DELETE', `/repos/${key}/contents/${path}`, { message: COMMIT_MESSAGE, sha, branch: r.branch });
    this.trees.get(key)?.entries.delete(path);
  }

  private async openRepo(fullName: string): Promise<RepoRef> {
    const info = await this.req<{ default_branch: string; owner: { login: string }; name: string }>('GET', `/repos/${fullName}`);
    return { owner: info.owner.login, repo: info.name, branch: info.default_branch };
  }

  // ------------------------------------------------------------ teams

  async listTeams() {
    const me = this.me();
    const profile = await this.storedProfile();
    if (!profile) return [];
    const out: { team: TeamRow; membership: MemberRow }[] = [];
    const keep: string[] = [];
    for (const full of profile.teams) {
      try {
        const r = await this.openRepo(full);
        const team = await this.readJSON<TeamRow>(r, 'annotino.json');
        const member = await this.readJSON<StoredMember>(r, `members/${me.id}.json`);
        keep.push(full);
        if (!team || !member) continue;
        this.repos.set(team.id, r);
        out.push({ team, membership: member });
      } catch (e) {
        // A repository that was deleted or that we lost access to is dropped from the list.
        if (!(e instanceof GitHubError && e.status === 404)) keep.push(full);
      }
    }
    if (keep.length !== profile.teams.length) await this.writeProfile({ ...profile, teams: keep });
    return out.sort((a, b) => a.team.created_at.localeCompare(b.team.created_at));
  }

  /** Repository invitations to Annotino team repositories. */
  async listInvitations(): Promise<{ id: number; repo: string; from: string }[]> {
    const list = await this.req<{ id: number; repository: { full_name: string; name: string }; inviter: { login: string } }[]>(
      'GET',
      '/user/repository_invitations',
    );
    return list.filter((i) => i.repository.name.startsWith('annotino-')).map((i) => ({ id: i.id, repo: i.repository.full_name, from: i.inviter.login }));
  }

  async acceptInvitation(id: number, repo: string) {
    await this.req('PATCH', `/user/repository_invitations/${id}`);
    await this.joinRepository(repo);
  }

  /** Add a team repository you already have access to (e.g. through an organisation). */
  async joinRepository(fullName: string) {
    const profile = await this.storedProfile();
    if (!profile) throw new Error('Set up your key first.');
    const r = await this.openRepo(fullName.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, ''));
    const full = `${r.owner}/${r.repo}`;
    if (!(await this.readJSON(r, 'annotino.json'))) throw new Error('This repository does not contain an Annotino team.');
    if (!profile.teams.includes(full)) await this.writeProfile({ ...profile, teams: [...profile.teams, full] });
  }

  async createTeam(team: TeamRow, owner: MemberRow) {
    const me = this.me();
    const profile = await this.storedProfile();
    if (!profile) throw new Error('Set up your key first.');
    // A neutral name: the team name itself stays encrypted.
    const name = `annotino-team-${team.id.slice(0, 8)}`;
    let created: { full_name: string };
    try {
      created = await this.req('POST', '/user/repos', {
        name,
        private: true,
        auto_init: true,
        description: 'Annotino team data. Everything here is end-to-end encrypted.',
        has_issues: false,
        has_wiki: false,
        has_projects: false,
      });
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 403 || e.status === 404)) {
        throw new Error(
          this.auth?.refresh || this.auth?.expiresAt
            ? 'GitHub did not let Annotino create a private repository. Install Annotino on your GitHub account first.'
            : 'GitHub did not let Annotino create a private repository. The token needs the “repo” scope.',
        );
      }
      throw e;
    }
    const r = await this.openRepo(created.full_name);
    this.repos.set(team.id, r);
    await this.writeJSON(r, 'annotino.json', team);
    const stored: StoredMember = { ...owner, login: me.login, display_name: profile.display_name, public_key: profile.public_key };
    await this.writeJSON(r, `members/${me.id}.json`, stored);
    await this.writeFile(
      r,
      'README.md',
      toB64(
        enc.encode(
          '# Annotino team data\n\nThis repository holds the recordings and annotations of an Annotino team.\nEverything is end-to-end encrypted: it can only be read in Annotino by the members of the team.\nDo not edit the files by hand.\n',
        ),
      ),
    );
    await this.writeProfile({ ...profile, teams: [...profile.teams, created.full_name] });
  }

  async updateTeam(id: string, patch: Partial<Pick<TeamRow, 'name_enc' | 'settings'>>) {
    const r = this.repoOf(id);
    const team = await this.readJSON<TeamRow>(r, 'annotino.json');
    if (team) await this.writeJSON(r, 'annotino.json', { ...team, ...patch });
  }

  async deleteTeam(id: string) {
    const r = this.repoOf(id);
    try {
      await this.req('DELETE', `/repos/${r.owner}/${r.repo}`);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 403) {
        throw new Error(`Delete the repository ${r.owner}/${r.repo} on GitHub (Settings, Danger zone); the token may not delete repositories.`);
      }
      throw e;
    }
    const profile = await this.storedProfile();
    if (profile) await this.writeProfile({ ...profile, teams: profile.teams.filter((x) => x !== `${r.owner}/${r.repo}`) });
  }

  async listMembers(teamId: string): Promise<MemberRow[]> {
    return this.readDir<StoredMember>(this.repoOf(teamId), 'members/');
  }

  async teamProfiles(teamId: string): Promise<PublicProfile[]> {
    const members = await this.readDir<StoredMember>(this.repoOf(teamId), 'members/');
    return members.map((m) => ({ id: m.user_id, email: m.login, display_name: m.display_name, public_key: m.public_key }));
  }

  async addMember(row: MemberRow) {
    const r = this.repoOf(row.team_id);
    const login = this.logins.get(row.user_id);
    if (!login) throw new Error('Look the person up by GitHub username first.');
    if (await this.readJSON(r, `members/${row.user_id}.json`)) throw new Error('This person is already in the team.');
    const pub = await this.findProfileByEmail(login);
    // GitHub sends them an invitation to the repository; Annotino shows it when they sign in.
    await this.req('PUT', `/repos/${r.owner}/${r.repo}/collaborators/${login}`, { permission: 'push' });
    const stored: StoredMember = { ...row, login, display_name: pub!.display_name, public_key: pub!.public_key, created_at: new Date().toISOString() };
    await this.writeJSON(r, `members/${row.user_id}.json`, stored);
  }

  async updateMemberRole(teamId: string, userId: string, role: Role) {
    const r = this.repoOf(teamId);
    const m = await this.readJSON<StoredMember>(r, `members/${userId}.json`);
    if (m) await this.writeJSON(r, `members/${userId}.json`, { ...m, role });
  }

  async removeMember(teamId: string, userId: string) {
    const r = this.repoOf(teamId);
    const m = await this.readJSON<StoredMember>(r, `members/${userId}.json`);
    await this.deleteFile(r, `members/${userId}.json`);
    if (m && userId !== this.me().id) {
      await this.req('DELETE', `/repos/${r.owner}/${r.repo}/collaborators/${m.login}`).catch(() => {});
    }
    if (userId === this.me().id) {
      const profile = await this.storedProfile();
      if (profile) await this.writeProfile({ ...profile, teams: profile.teams.filter((x) => x !== `${r.owner}/${r.repo}`) });
    }
  }

  // ------------------------------------------------------------ recordings

  async listRecordings(teamId: string) {
    const rows = await this.readDir<RecordingRow>(this.repoOf(teamId), 'recordings/');
    return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  private audioPath(row: RecordingRow) {
    return `audio/${row.storage_path.split('/').pop()}.bin`;
  }

  async createRecording(row: RecordingRow, encryptedAudio: Uint8Array<ArrayBuffer>) {
    const r = this.repoOf(row.team_id);
    await this.writeFile(r, this.audioPath(row), toB64(encryptedAudio));
    await this.writeJSON(r, `recordings/${row.id}.json`, row);
  }

  async downloadAudio(row: RecordingRow): Promise<ArrayBuffer> {
    const r = this.repoOf(row.team_id);
    const e = (await this.tree(r)).get(this.audioPath(row));
    if (!e) throw new Error('Audio file not found.');
    return this.req<ArrayBuffer>('GET', `/repos/${r.owner}/${r.repo}/git/blobs/${e.sha}`, undefined, 'application/vnd.github.raw');
  }

  async updateRecording(id: string, patch: Partial<Pick<RecordingRow, 'meta_enc' | 'blind_revealed'>>) {
    for (const r of this.repos.values()) {
      const row = await this.readJSON<RecordingRow>(r, `recordings/${id}.json`);
      if (row) return this.writeJSON(r, `recordings/${id}.json`, { ...row, ...patch });
    }
  }

  async deleteRecording(row: RecordingRow) {
    const r = this.repoOf(row.team_id);
    for (const e of [...(await this.tree(r, true)).values()].filter((x) => x.path.startsWith(`annotations/${row.id}/`))) {
      await this.deleteFile(r, e.path);
    }
    await this.deleteFile(r, this.audioPath(row));
    await this.deleteFile(r, `recordings/${row.id}.json`);
  }

  // ------------------------------------------------------------ annotations

  private annotationPath(row: Pick<AnnotationRow, 'id' | 'recording_id'>) {
    return `annotations/${row.recording_id ?? 'team'}/${row.id}.json`;
  }

  private mayReveal(row: AnnotationRow, recording: RecordingRow | null): boolean {
    if (row.visibility === 'team' || SHARED_KINDS.includes(row.kind)) return true;
    if (row.visibility === 'scheduled') return !!row.reveal_at && Date.parse(row.reveal_at) <= Date.now();
    if (row.visibility === 'blind') return !!recording?.blind_revealed;
    return false;
  }

  private async seal(row: AnnotationRow): Promise<StoredAnnotation> {
    if (!this.privateKey || !this.publicKey) throw new Error('Your key is locked.');
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const raw = await crypto.subtle.exportKey('raw', key);
    const pub = await crypto.subtle.importKey('jwk', this.publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const authorKey = toB64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw));
    const sealed = toB64(await encryptBytes(key, enc.encode(row.payload_enc)));
    return { ...row, payload_enc: sealed, seal: { author_key: authorKey } };
  }

  private async unseal(row: StoredAnnotation): Promise<AnnotationRow> {
    if (!row.seal) return row;
    if (!this.privateKey) throw new Error('Your key is locked.');
    const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, this.privateKey, fromB64(row.seal.author_key));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const payload = dec.decode(await decryptBytes(key, fromB64(row.payload_enc)));
    const { seal: _s, ...rest } = row;
    void _s;
    return { ...rest, payload_enc: payload };
  }

  /** Visible rows; the author's own sealed rows are opened, and unsealed in the repository once they may be shown. */
  private async visible(r: RepoRef, stored: StoredAnnotation[], recordings: Map<string, RecordingRow>): Promise<AnnotationRow[]> {
    const me = this.me().id;
    const out: AnnotationRow[] = [];
    for (const s of stored) {
      if (!s.seal) {
        out.push(s);
        continue;
      }
      if (s.author_id !== me) continue;
      const open = await this.unseal(s);
      out.push(open);
      if (this.mayReveal(open, s.recording_id ? (recordings.get(s.recording_id) ?? null) : null)) {
        await this.writeJSON(r, this.annotationPath(open), open).catch(() => {});
      }
    }
    return out;
  }

  private async recordingMap(r: RepoRef) {
    return new Map((await this.readDir<RecordingRow>(r, 'recordings/')).map((x) => [x.id, x]));
  }

  async listAnnotations(recordingId: string) {
    for (const r of this.repos.values()) {
      const recs = await this.recordingMap(r);
      if (!recs.has(recordingId)) continue;
      const stored = await this.readDir<StoredAnnotation>(r, `annotations/${recordingId}/`);
      return this.visible(r, stored, recs);
    }
    return [];
  }

  async listTeamAnnotations(teamId: string, kinds: AnnotationKind[]) {
    const r = this.repoOf(teamId);
    const recs = await this.recordingMap(r);
    const stored = (await this.readDir<StoredAnnotation>(r, 'annotations/')).filter((a) => kinds.includes(a.kind));
    return this.visible(r, stored, recs);
  }

  private async locate(id: string): Promise<{ r: RepoRef; path: string } | null> {
    for (const r of this.repos.values()) {
      const e = [...(await this.tree(r)).values()].find((x) => x.path.startsWith('annotations/') && x.path.endsWith(`/${id}.json`));
      if (e) return { r, path: e.path };
    }
    return null;
  }

  async getAnnotation(id: string) {
    const loc = await this.locate(id);
    if (!loc) return null;
    // Bypass the short tree cache: shared documents are merged against the latest version.
    const e = (await this.tree(loc.r, true)).get(loc.path);
    if (!e) return null;
    const s = JSON.parse(await this.blobText(loc.r, e.sha)) as StoredAnnotation;
    if (s.seal && s.author_id !== this.me().id) return null;
    return this.unseal(s);
  }

  async upsertAnnotation(row: AnnotationRow) {
    const me = this.me().id;
    const r = this.repoOf(row.team_id);
    const path = this.annotationPath(row);
    const existing = await this.readJSON<StoredAnnotation>(r, path);
    if (existing && existing.author_id !== me && !SHARED_KINDS.includes(existing.kind)) {
      throw new Error('You can only edit your own annotations.');
    }
    const recording = row.recording_id ? await this.readJSON<RecordingRow>(r, `recordings/${row.recording_id}.json`) : null;
    const full: AnnotationRow = { ...row, updated_by: me };
    await this.writeJSON(r, path, this.mayReveal(full, recording) ? full : await this.seal(full));
  }

  async deleteAnnotation(id: string) {
    const loc = await this.locate(id);
    if (loc) await this.deleteFile(loc.r, loc.path);
  }

  /** History from the repository's commits. */
  async listVersions(annotationId: string): Promise<VersionRow[]> {
    const loc = await this.locate(annotationId);
    if (!loc) return [];
    const { r, path } = loc;
    const commits = await this.req<{ sha: string; commit: { author: { date: string } }; author: { id: number } | null }[]>(
      'GET',
      `/repos/${r.owner}/${r.repo}/commits?path=${encodeURIComponent(path)}&per_page=40`,
    );
    const out: VersionRow[] = [];
    let lastKept = Infinity;
    // The newest commit is the current version; keep at most one version every three minutes.
    for (const c of commits.slice(1)) {
      const at = Date.parse(c.commit.author.date);
      if (lastKept - at < 3 * 60_000) continue;
      lastKept = at;
      const file = await this.req<{ content: string }>('GET', `/repos/${r.owner}/${r.repo}/contents/${path}?ref=${c.sha}`);
      const s = JSON.parse(dec.decode(fromB64(file.content.replace(/\n/g, '')))) as StoredAnnotation;
      if (s.seal && s.author_id !== this.me().id) continue;
      const open = await this.unseal(s);
      out.push({ annotation_id: annotationId, payload_enc: open.payload_enc, updated_at: c.commit.author.date, updated_by: c.author ? `gh-${c.author.id}` : null });
      if (out.length >= 30) break;
    }
    return out;
  }
}
