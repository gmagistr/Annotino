import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AnnotationKind,
  AnnotationRow,
  VersionRow,
  Backend,
  MemberRow,
  ProfileRow,
  PublicProfile,
  RecordingRow,
  Role,
  Session,
  TeamRow,
} from './types';

const BUCKET = 'audio';

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/**
 * Hosted mode. Supabase stores ciphertext only; access is enforced by the
 * row-level security policies in supabase/schema.sql.
 */
export class SupabaseBackend implements Backend {
  readonly kind = 'supabase' as const;
  private sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  private async uid(): Promise<string> {
    const s = await this.session();
    if (!s) throw new Error('Not signed in.');
    return s.userId;
  }

  async signUp(email: string, authSecret: string): Promise<Session | null> {
    const { data, error } = await this.sb.auth.signUp({
      email,
      password: authSecret,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    if (error) throw new Error(error.message);
    return data.session ? { userId: data.session.user.id, email: data.session.user.email ?? email } : null;
  }

  async signIn(email: string, authSecret: string): Promise<Session> {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password: authSecret });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
    return { userId: data.user.id, email: data.user.email ?? email };
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async requestPasswordReset(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw new Error(error.message);
  }

  async session(): Promise<Session | null> {
    const { data } = await this.sb.auth.getSession();
    const u = data.session?.user;
    return u ? { userId: u.id, email: u.email ?? '' } : null;
  }

  async changeAuthSecret(newSecret: string) {
    const { error } = await this.sb.auth.updateUser({ password: newSecret });
    if (error) throw new Error(error.message);
  }

  async getMyProfile() {
    const id = await this.uid();
    return check(await this.sb.from('profiles').select('*').eq('id', id).maybeSingle()) as ProfileRow | null;
  }

  async saveMyProfile(row: ProfileRow) {
    check(await this.sb.from('profiles').upsert(row));
  }

  async findProfileByEmail(email: string) {
    const rows = check(await this.sb.rpc('find_profile_by_email', { lookup: email.trim().toLowerCase() })) as PublicProfile[];
    return rows[0] ?? null;
  }

  async teamProfiles(teamId: string) {
    return check(await this.sb.rpc('team_profiles', { team: teamId })) as PublicProfile[];
  }

  async listTeams() {
    const id = await this.uid();
    const rows = check(await this.sb.from('team_members').select('*, teams(*)').eq('user_id', id)) as (MemberRow & { teams: TeamRow })[];
    return rows
      .filter((r) => r.teams)
      .map(({ teams, ...membership }) => ({ team: teams, membership }))
      .sort((a, b) => a.team.created_at.localeCompare(b.team.created_at));
  }

  async createTeam(team: TeamRow, owner: MemberRow) {
    check(await this.sb.from('teams').insert(team));
    check(await this.sb.from('team_members').insert(owner));
  }

  async updateTeam(id: string, patch: Partial<Pick<TeamRow, 'name_enc' | 'settings'>>) {
    check(await this.sb.from('teams').update(patch).eq('id', id));
  }

  async deleteTeam(id: string) {
    const recs = await this.listRecordings(id);
    if (recs.length) await this.sb.storage.from(BUCKET).remove(recs.map((r) => r.storage_path));
    check(await this.sb.from('teams').delete().eq('id', id));
  }

  async listMembers(teamId: string) {
    return check(await this.sb.from('team_members').select('*').eq('team_id', teamId)) as MemberRow[];
  }

  async addMember(row: MemberRow) {
    check(await this.sb.from('team_members').insert(row));
  }

  async updateMemberRole(teamId: string, userId: string, role: Role) {
    check(await this.sb.from('team_members').update({ role }).eq('team_id', teamId).eq('user_id', userId));
  }

  async removeMember(teamId: string, userId: string) {
    check(await this.sb.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId));
  }

  async listRecordings(teamId: string) {
    return check(await this.sb.from('recordings').select('*').eq('team_id', teamId).order('created_at')) as RecordingRow[];
  }

  async createRecording(row: RecordingRow, encryptedAudio: Uint8Array<ArrayBuffer>) {
    const up = await this.sb.storage
      .from(BUCKET)
      .upload(row.storage_path, new Blob([encryptedAudio], { type: 'application/octet-stream' }), { upsert: false });
    if (up.error) throw new Error(up.error.message);
    const res = await this.sb.from('recordings').insert(row);
    if (res.error) {
      await this.sb.storage.from(BUCKET).remove([row.storage_path]);
      throw new Error(res.error.message);
    }
  }

  async downloadAudio(row: RecordingRow) {
    const { data, error } = await this.sb.storage.from(BUCKET).download(row.storage_path);
    if (error) throw new Error(error.message);
    return data.arrayBuffer();
  }

  async updateRecording(id: string, patch: Partial<Pick<RecordingRow, 'meta_enc' | 'blind_revealed'>>) {
    check(await this.sb.from('recordings').update(patch).eq('id', id));
  }

  async deleteRecording(row: RecordingRow) {
    check(await this.sb.from('recordings').delete().eq('id', row.id));
    await this.sb.storage.from(BUCKET).remove([row.storage_path]);
  }

  async listAnnotations(recordingId: string) {
    return check(await this.sb.from('annotations').select('*').eq('recording_id', recordingId)) as AnnotationRow[];
  }

  async listTeamAnnotations(teamId: string, kinds: AnnotationKind[]) {
    return check(await this.sb.from('annotations').select('*').eq('team_id', teamId).in('kind', kinds)) as AnnotationRow[];
  }

  async getAnnotation(id: string) {
    return check(await this.sb.from('annotations').select('*').eq('id', id).maybeSingle()) as AnnotationRow | null;
  }

  async listVersions(annotationId: string) {
    return check(
      await this.sb.from('annotation_versions').select('*').eq('annotation_id', annotationId).order('updated_at', { ascending: false }),
    ) as VersionRow[];
  }

  async upsertAnnotation(row: AnnotationRow) {
    // updated_by is set by the database from the caller's identity.
    // An upsert would apply the insert policy (author only) even when it updates,
    // so shared documents edited by other members go through a plain update.
    const { updated_by: _ignored, ...rest } = row;
    void _ignored;
    const updated = check(await this.sb.from('annotations').update(rest).eq('id', row.id).select('id')) as { id: string }[];
    if (updated.length === 0) check(await this.sb.from('annotations').insert(rest));
  }

  async deleteAnnotation(id: string) {
    check(await this.sb.from('annotations').delete().eq('id', id));
  }
}
