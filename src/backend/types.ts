/**
 * Rows as the server stores them. Everything sensitive is an opaque ciphertext
 * (`*_enc` fields, wrapped keys, the audio blob). The server only ever sees ids,
 * timestamps, roles and visibility flags — the minimum needed to enforce access.
 */

export type Role = 'owner' | 'admin' | 'member';

export type Visibility =
  | 'private' // only the author
  | 'team' // every team member, now
  | 'scheduled' // every team member, from reveal_at
  | 'blind'; // hidden until an admin reveals blind annotations for the recording

export interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  public_key: JsonWebKey;
  enc_private_key: string;
  kdf_salt: string;
  recovery_private_key: string;
  recovery_salt: string;
}

export type PublicProfile = Pick<ProfileRow, 'id' | 'email' | 'display_name' | 'public_key'>;

export interface TeamSettings {
  /** Visibility pre-selected for new tiers. */
  defaultVisibility: Visibility;
  /** When set, members cannot choose a different visibility. */
  lockVisibility: boolean;
}

export interface TeamRow {
  id: string;
  name_enc: string;
  created_by: string;
  settings: TeamSettings;
  created_at: string;
}

export interface MemberRow {
  team_id: string;
  user_id: string;
  role: Role;
  wrapped_key: string;
  created_at?: string;
}

export interface RecordingRow {
  id: string;
  team_id: string;
  meta_enc: string;
  storage_path: string;
  uploaded_by: string;
  blind_revealed: boolean;
  created_at: string;
}

/**
 * tier, sketch and tags belong to one author. thread (a discussion) and guide
 * (the team's annotation rules) are shared: any member may update them.
 */
export type AnnotationKind = 'tier' | 'sketch' | 'tags' | 'thread' | 'guide';

export const SHARED_KINDS: AnnotationKind[] = ['thread', 'guide'];

export interface AnnotationRow {
  id: string;
  /** null for team-level documents (the guide). */
  recording_id: string | null;
  team_id: string;
  author_id: string;
  kind: AnnotationKind;
  visibility: Visibility;
  reveal_at: string | null;
  payload_enc: string;
  created_at: string;
  updated_at: string;
  /** Who saved this version (differs from author_id for shared kinds). */
  updated_by?: string | null;
}

/** A previous version of an annotation, kept for its history. */
export interface VersionRow {
  annotation_id: string;
  payload_enc: string;
  updated_at: string;
  updated_by: string | null;
}

export interface Session {
  userId: string;
  email: string;
}

export type BackendKind = 'local' | 'supabase' | 'github';

export interface Backend {
  readonly kind: BackendKind;
  /** How long edits wait before being saved (GitHub commits are batched more). */
  readonly saveDelayMs?: number;
  /** GitHub mode: the unlocked key, needed to seal and open private annotations. */
  setIdentity?(privateKey: CryptoKey, publicKey: JsonWebKey): void;
  /** GitHub mode: team keys, after they are unwrapped. */
  setTeamKey?(teamId: string, key: CryptoKey): void;
  /** GitHub mode: repository invitations to Annotino teams. */
  listInvitations?(): Promise<{ id: number; repo: string; from: string }[]>;
  acceptInvitation?(id: number, repo: string): Promise<void>;
  joinRepository?(fullName: string): Promise<void>;
  /** GitHub mode: where a team's data lives, e.g. "owner/annotino-team-1a2b3c4d". */
  storageLabel?(teamId: string): string | null;
  /** Sends a password-reset link (hosted mode only). */
  requestPasswordReset(email: string): Promise<void>;
  /** Creates the account. Returns a session when the user is signed in immediately. */
  signUp(email: string, authSecret: string): Promise<Session | null>;
  signIn(email: string, authSecret: string): Promise<Session>;
  signOut(): Promise<void>;
  session(): Promise<Session | null>;
  changeAuthSecret(newSecret: string): Promise<void>;

  getMyProfile(): Promise<ProfileRow | null>;
  saveMyProfile(row: ProfileRow): Promise<void>;
  findProfileByEmail(email: string): Promise<PublicProfile | null>;
  teamProfiles(teamId: string): Promise<PublicProfile[]>;

  listTeams(): Promise<{ team: TeamRow; membership: MemberRow }[]>;
  createTeam(team: TeamRow, owner: MemberRow): Promise<void>;
  updateTeam(id: string, patch: Partial<Pick<TeamRow, 'name_enc' | 'settings'>>): Promise<void>;
  deleteTeam(id: string): Promise<void>;
  listMembers(teamId: string): Promise<MemberRow[]>;
  addMember(row: MemberRow): Promise<void>;
  updateMemberRole(teamId: string, userId: string, role: Role): Promise<void>;
  removeMember(teamId: string, userId: string): Promise<void>;

  listRecordings(teamId: string): Promise<RecordingRow[]>;
  createRecording(row: RecordingRow, encryptedAudio: Uint8Array<ArrayBuffer>): Promise<void>;
  downloadAudio(row: RecordingRow): Promise<ArrayBuffer>;
  updateRecording(id: string, patch: Partial<Pick<RecordingRow, 'meta_enc' | 'blind_revealed'>>): Promise<void>;
  deleteRecording(row: RecordingRow): Promise<void>;

  /** Only the rows the current user is allowed to see. */
  listAnnotations(recordingId: string): Promise<AnnotationRow[]>;
  /** Visible rows of the given kinds across the whole team (threads for notifications, the guide, tags). */
  listTeamAnnotations(teamId: string, kinds: AnnotationKind[]): Promise<AnnotationRow[]>;
  getAnnotation(id: string): Promise<AnnotationRow | null>;
  /** Earlier versions, newest first. */
  listVersions(annotationId: string): Promise<VersionRow[]>;
  upsertAnnotation(row: AnnotationRow): Promise<void>;
  deleteAnnotation(id: string): Promise<void>;
}

/** The visibility rule, mirrored by the row-level security policy in supabase/schema.sql. */
export function canSee(row: AnnotationRow, userId: string, recording: Pick<RecordingRow, 'blind_revealed'> | null, now = Date.now()): boolean {
  if (row.author_id === userId) return true;
  if (SHARED_KINDS.includes(row.kind)) return true;
  switch (row.visibility) {
    case 'team':
      return true;
    case 'scheduled':
      return row.reveal_at !== null && Date.parse(row.reveal_at) <= now;
    case 'blind':
      return recording?.blind_revealed ?? false;
    default:
      return false;
  }
}
