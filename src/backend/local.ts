import { openDB, Store } from '../lib/idb';
import { toB64 } from '../crypto/crypto';
import {
  canSee,
  SHARED_KINDS,
  type AnnotationKind,
  type AnnotationRow,
  type VersionRow,
  type Backend,
  type MemberRow,
  type ProfileRow,
  type PublicProfile,
  type RecordingRow,
  type Role,
  type Session,
  type TeamRow,
} from './types';

/**
 * Local mode: an in-browser stand-in for the server, backed by IndexedDB.
 * It stores exactly what the real server would store (ciphertext only) and
 * applies the same access rules, so several accounts can be tried on one
 * computer — useful for evaluation, teaching and offline work.
 */

interface Account {
  id: string;
  email: string;
  secretHash: string;
}

const db = openDB('annotino-local-server', ['accounts', 'profiles', 'teams', 'members', 'recordings', 'audio', 'annotations', 'versions'], 2);
const accounts = new Store(db, 'accounts');
const profiles = new Store(db, 'profiles');
const teams = new Store(db, 'teams');
const members = new Store(db, 'members');
const recordings = new Store(db, 'recordings');
const audio = new Store(db, 'audio');
const annotations = new Store(db, 'annotations');
const versions = new Store(db, 'versions');

/** A new history entry is kept at most every few minutes, as on the server. */
const VERSION_INTERVAL_MS = 3 * 60_000;
const MAX_VERSIONS = 60;

const SESSION_KEY = 'annotino.local.session';

async function hash(s: string): Promise<string> {
  return toB64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

const memberKey = (teamId: string, userId: string) => `${teamId}:${userId}`;

export class LocalBackend implements Backend {
  readonly kind = 'local' as const;

  private current(): Session {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) throw new Error('Not signed in.');
    return JSON.parse(raw) as Session;
  }

  private async role(teamId: string): Promise<Role | null> {
    const m = await members.get<MemberRow>(memberKey(teamId, this.current().userId));
    return m?.role ?? null;
  }

  private async requireAdmin(teamId: string) {
    const r = await this.role(teamId);
    if (r !== 'owner' && r !== 'admin') throw new Error('Only team owners and admins can do this.');
  }

  async signUp(email: string, authSecret: string): Promise<Session> {
    const key = email.trim().toLowerCase();
    if (await accounts.get(key)) throw new Error('An account with this email already exists.');
    const account: Account = { id: crypto.randomUUID(), email: key, secretHash: await hash(authSecret) };
    await accounts.put(key, account);
    return this.signIn(email, authSecret);
  }

  async signIn(email: string, authSecret: string): Promise<Session> {
    const key = email.trim().toLowerCase();
    const account = await accounts.get<Account>(key);
    if (!account || account.secretHash !== (await hash(authSecret))) throw new Error('Email or password is incorrect.');
    const s: Session = { userId: account.id, email: account.email };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  }

  async signOut() {
    localStorage.removeItem(SESSION_KEY);
  }

  async requestPasswordReset() {
    throw new Error('Password reset by email is not available in local mode.');
  }

  async session() {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  }

  async changeAuthSecret(newSecret: string) {
    const s = this.current();
    const account = await accounts.get<Account>(s.email);
    if (!account) throw new Error('Account not found.');
    await accounts.put(s.email, { ...account, secretHash: await hash(newSecret) });
  }

  async getMyProfile() {
    return (await profiles.get<ProfileRow>(this.current().userId)) ?? null;
  }

  async saveMyProfile(row: ProfileRow) {
    if (row.id !== this.current().userId) throw new Error('Cannot write another user’s profile.');
    await profiles.put(row.id, row);
  }

  async findProfileByEmail(email: string): Promise<PublicProfile | null> {
    const all = await profiles.all<ProfileRow>();
    const p = all.find((x) => x.email === email.trim().toLowerCase());
    return p ? { id: p.id, email: p.email, display_name: p.display_name, public_key: p.public_key } : null;
  }

  async teamProfiles(teamId: string): Promise<PublicProfile[]> {
    if (!(await this.role(teamId))) return [];
    const ms = await this.listMembers(teamId);
    const out: PublicProfile[] = [];
    for (const m of ms) {
      const p = await profiles.get<ProfileRow>(m.user_id);
      if (p) out.push({ id: p.id, email: p.email, display_name: p.display_name, public_key: p.public_key });
    }
    return out;
  }

  async listTeams() {
    const me = this.current().userId;
    const mine = (await members.all<MemberRow>()).filter((m) => m.user_id === me);
    const out: { team: TeamRow; membership: MemberRow }[] = [];
    for (const m of mine) {
      const t = await teams.get<TeamRow>(m.team_id);
      if (t) out.push({ team: t, membership: m });
    }
    return out.sort((a, b) => a.team.created_at.localeCompare(b.team.created_at));
  }

  async createTeam(team: TeamRow, owner: MemberRow) {
    await teams.put(team.id, team);
    await members.put(memberKey(owner.team_id, owner.user_id), { ...owner, created_at: new Date().toISOString() });
  }

  async updateTeam(id: string, patch: Partial<Pick<TeamRow, 'name_enc' | 'settings'>>) {
    if ((await this.role(id)) !== 'owner') throw new Error('Only the team owner can change team settings.');
    const t = await teams.get<TeamRow>(id);
    if (t) await teams.put(id, { ...t, ...patch });
  }

  async deleteTeam(id: string) {
    if ((await this.role(id)) !== 'owner') throw new Error('Only the team owner can delete the team.');
    for (const r of await this.listRecordings(id)) await this.deleteRecording(r);
    for (const m of await this.listMembers(id)) await members.delete(memberKey(id, m.user_id));
    await teams.delete(id);
  }

  async listMembers(teamId: string) {
    return (await members.all<MemberRow>()).filter((m) => m.team_id === teamId);
  }

  async addMember(row: MemberRow) {
    await this.requireAdmin(row.team_id);
    if (await members.get(memberKey(row.team_id, row.user_id))) throw new Error('This person is already in the team.');
    await members.put(memberKey(row.team_id, row.user_id), { ...row, created_at: new Date().toISOString() });
  }

  async updateMemberRole(teamId: string, userId: string, role: Role) {
    if ((await this.role(teamId)) !== 'owner') throw new Error('Only the team owner can change roles.');
    const m = await members.get<MemberRow>(memberKey(teamId, userId));
    if (m) await members.put(memberKey(teamId, userId), { ...m, role });
  }

  async removeMember(teamId: string, userId: string) {
    if (userId !== this.current().userId) await this.requireAdmin(teamId);
    await members.delete(memberKey(teamId, userId));
  }

  async listRecordings(teamId: string) {
    if (!(await this.role(teamId))) return [];
    return (await recordings.all<RecordingRow>())
      .filter((r) => r.team_id === teamId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async createRecording(row: RecordingRow, encryptedAudio: Uint8Array<ArrayBuffer>) {
    await this.requireAdmin(row.team_id);
    await audio.put(row.storage_path, encryptedAudio);
    await recordings.put(row.id, row);
  }

  async downloadAudio(row: RecordingRow) {
    if (!(await this.role(row.team_id))) throw new Error('You are not a member of this team.');
    const data = await audio.get<Uint8Array>(row.storage_path);
    if (!data) throw new Error('Audio file not found.');
    return data.slice().buffer;
  }

  async updateRecording(id: string, patch: Partial<Pick<RecordingRow, 'meta_enc' | 'blind_revealed'>>) {
    const r = await recordings.get<RecordingRow>(id);
    if (!r) return;
    await this.requireAdmin(r.team_id);
    await recordings.put(id, { ...r, ...patch });
  }

  async deleteRecording(row: RecordingRow) {
    await this.requireAdmin(row.team_id);
    for (const a of (await annotations.all<AnnotationRow>()).filter((x) => x.recording_id === row.id)) await annotations.delete(a.id);
    await audio.delete(row.storage_path);
    await recordings.delete(row.id);
  }

  async listAnnotations(recordingId: string) {
    const rec = await recordings.get<RecordingRow>(recordingId);
    if (!rec || !(await this.role(rec.team_id))) return [];
    const me = this.current().userId;
    return (await annotations.all<AnnotationRow>()).filter((a) => a.recording_id === recordingId && canSee(a, me, rec));
  }

  async listTeamAnnotations(teamId: string, kinds: AnnotationKind[]) {
    if (!(await this.role(teamId))) return [];
    const me = this.current().userId;
    const recs = new Map((await recordings.all<RecordingRow>()).map((r) => [r.id, r]));
    return (await annotations.all<AnnotationRow>()).filter(
      (a) => a.team_id === teamId && kinds.includes(a.kind) && canSee(a, me, a.recording_id ? (recs.get(a.recording_id) ?? null) : null),
    );
  }

  async getAnnotation(id: string) {
    const a = await annotations.get<AnnotationRow>(id);
    if (!a || !(await this.role(a.team_id))) return null;
    const rec = a.recording_id ? ((await recordings.get<RecordingRow>(a.recording_id)) ?? null) : null;
    return canSee(a, this.current().userId, rec) ? a : null;
  }

  async listVersions(annotationId: string) {
    if (!(await this.getAnnotation(annotationId))) return [];
    return ((await versions.get<VersionRow[]>(annotationId)) ?? []).slice().reverse();
  }

  async upsertAnnotation(row: AnnotationRow) {
    const me = this.current().userId;
    const shared = SHARED_KINDS.includes(row.kind);
    if (row.author_id !== me && !shared) throw new Error('You can only edit your own annotations.');
    const existing = await annotations.get<AnnotationRow>(row.id);
    if (existing && existing.author_id !== me && !SHARED_KINDS.includes(existing.kind)) {
      throw new Error('You can only edit your own annotations.');
    }
    if (existing && existing.author_id !== row.author_id) throw new Error('The author of an annotation cannot change.');
    if (!(await this.role(row.team_id))) throw new Error('You are not a member of this team.');
    if (existing && existing.payload_enc !== row.payload_enc) {
      const list = (await versions.get<VersionRow[]>(row.id)) ?? [];
      const last = list[list.length - 1];
      if (!last || Date.parse(existing.updated_at) - Date.parse(last.updated_at) >= VERSION_INTERVAL_MS) {
        list.push({ annotation_id: row.id, payload_enc: existing.payload_enc, updated_at: existing.updated_at, updated_by: existing.updated_by ?? existing.author_id });
        await versions.put(row.id, list.slice(-MAX_VERSIONS));
      }
    }
    await annotations.put(row.id, { ...row, updated_by: me });
  }

  async deleteAnnotation(id: string) {
    const existing = await annotations.get<AnnotationRow>(id);
    if (existing && existing.author_id !== this.current().userId) throw new Error('You can only delete your own annotations.');
    await annotations.delete(id);
    await versions.delete(id);
  }
}
