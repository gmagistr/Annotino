import { backend } from '../backend';
import type { AnnotationKind, AnnotationRow, MemberRow, PublicProfile, RecordingRow, Role, TeamRow, TeamSettings, Visibility } from '../backend/types';
import { decryptBytes, decryptJSON, encryptBytes, encryptJSON, newTeamKey, unwrapTeamKey, wrapTeamKey } from '../crypto/crypto';
import { decodeAudio } from '../dsp/sniff';
import type { Guide, RecordingMeta, Sketch, TagSet, Thread, Tier } from '../model';
import type { Identity } from './auth';

export interface TeamEntry {
  team: TeamRow;
  membership: MemberRow;
  name: string;
  key: CryptoKey;
  raw: ArrayBuffer;
}

export interface RecordingEntry {
  row: RecordingRow;
  meta: RecordingMeta;
}

export type Content = Tier | Sketch | TagSet | Thread | Guide;

export interface AnnotationDoc<T = Content> {
  row: AnnotationRow;
  content: T;
}

export const DEFAULT_SETTINGS: TeamSettings = { defaultVisibility: 'blind', lockVisibility: false };

export function isAdmin(entry: TeamEntry): boolean {
  return entry.membership.role === 'owner' || entry.membership.role === 'admin';
}

export async function loadTeams(identity: Identity): Promise<TeamEntry[]> {
  const rows = await backend.listTeams();
  const out: TeamEntry[] = [];
  for (const { team, membership } of rows) {
    try {
      const { key, raw } = await unwrapTeamKey(membership.wrapped_key, identity.privateKey);
      backend.setTeamKey?.(team.id, key);
      const { name } = await decryptJSON<{ name: string }>(key, team.name_enc);
      out.push({ team: { ...team, settings: { ...DEFAULT_SETTINGS, ...team.settings } }, membership, name, key, raw });
    } catch {
      // A team whose key cannot be unwrapped is skipped rather than breaking the list.
    }
  }
  return out;
}

export async function createTeam(identity: Identity, name: string): Promise<void> {
  const { raw, key } = await newTeamKey();
  const id = crypto.randomUUID();
  const team: TeamRow = {
    id,
    name_enc: await encryptJSON(key, { name }),
    created_by: identity.session.userId,
    settings: DEFAULT_SETTINGS,
    created_at: new Date().toISOString(),
  };
  const owner: MemberRow = {
    team_id: id,
    user_id: identity.session.userId,
    role: 'owner',
    wrapped_key: await wrapTeamKey(raw, identity.profile.public_key),
  };
  await backend.createTeam(team, owner);
}

export async function renameTeam(entry: TeamEntry, name: string) {
  await backend.updateTeam(entry.team.id, { name_enc: await encryptJSON(entry.key, { name }) });
}

export async function inviteMember(entry: TeamEntry, email: string, role: Role): Promise<PublicProfile> {
  const profile = await backend.findProfileByEmail(email);
  if (!profile) throw new Error('No Annotino account uses this email. Ask your colleague to create one first.');
  await backend.addMember({
    team_id: entry.team.id,
    user_id: profile.id,
    role,
    wrapped_key: await wrapTeamKey(entry.raw, profile.public_key),
  });
  return profile;
}

// ---------------------------------------------------------------- recordings

export async function loadRecordings(entry: TeamEntry): Promise<RecordingEntry[]> {
  const rows = await backend.listRecordings(entry.team.id);
  return Promise.all(rows.map(async (row) => ({ row, meta: await decryptJSON<RecordingMeta>(entry.key, row.meta_enc) })));
}

export async function uploadRecording(entry: TeamEntry, identity: Identity, name: string, bytes: ArrayBuffer): Promise<void> {
  let buffer: AudioBuffer;
  try {
    buffer = await decodeAudio(bytes);
  } catch {
    throw new Error('This file could not be read as audio. Use WAV, FLAC, MP3 or OGG.');
  }
  const meta: RecordingMeta = {
    name,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    size: bytes.byteLength,
  };
  const id = crypto.randomUUID();
  const row: RecordingRow = {
    id,
    team_id: entry.team.id,
    meta_enc: await encryptJSON(entry.key, meta),
    storage_path: `${entry.team.id}/${crypto.randomUUID()}`,
    uploaded_by: identity.session.userId,
    blind_revealed: false,
    created_at: new Date().toISOString(),
  };
  await backend.createRecording(row, await encryptBytes(entry.key, bytes));
}

export async function updateRecordingMeta(entry: TeamEntry, rec: RecordingEntry, patch: Partial<RecordingMeta>) {
  await backend.updateRecording(rec.row.id, { meta_enc: await encryptJSON(entry.key, { ...rec.meta, ...patch }) });
}

export async function fetchAudio(entry: TeamEntry, row: RecordingRow): Promise<ArrayBuffer> {
  return decryptBytes(entry.key, await backend.downloadAudio(row));
}

// ---------------------------------------------------------------- annotations

export async function loadAnnotations(entry: TeamEntry, recordingId: string): Promise<AnnotationDoc[]> {
  const rows = await backend.listAnnotations(recordingId);
  const out: AnnotationDoc[] = [];
  for (const row of rows) {
    try {
      out.push({ row, content: await decryptJSON<Content>(entry.key, row.payload_enc) });
    } catch {
      /* unreadable row: skip */
    }
  }
  return out.sort((a, b) => a.row.created_at.localeCompare(b.row.created_at));
}

export function newAnnotationRow(
  entry: TeamEntry,
  identity: Identity,
  recordingId: string | null,
  kind: AnnotationKind,
  visibility: Visibility,
): AnnotationRow {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    recording_id: recordingId,
    team_id: entry.team.id,
    author_id: identity.session.userId,
    kind,
    visibility,
    reveal_at: null,
    payload_enc: '',
    created_at: now,
    updated_at: now,
  };
}

export async function saveAnnotation(entry: TeamEntry, doc: AnnotationDoc): Promise<AnnotationRow> {
  const row: AnnotationRow = {
    ...doc.row,
    payload_enc: await encryptJSON(entry.key, doc.content),
    updated_at: new Date().toISOString(),
  };
  await backend.upsertAnnotation(row);
  return row;
}

/** Visible documents of some kinds across the team (for notifications, tag examples, the guide). */
export async function loadTeamDocs(entry: TeamEntry, kinds: AnnotationKind[]): Promise<AnnotationDoc[]> {
  const rows = await backend.listTeamAnnotations(entry.team.id, kinds);
  const out: AnnotationDoc[] = [];
  for (const row of rows) {
    try {
      out.push({ row, content: await decryptJSON<Content>(entry.key, row.payload_enc) });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => a.row.created_at.localeCompare(b.row.created_at));
}

/** The team guide (the oldest one, should two members have created it at the same time). */
export async function loadGuide(entry: TeamEntry): Promise<AnnotationDoc<Guide> | null> {
  const docs = await loadTeamDocs(entry, ['guide']);
  return (docs[0] as AnnotationDoc<Guide> | undefined) ?? null;
}

/**
 * Save a discussion without losing replies that colleagues posted meanwhile:
 * messages are merged by id with the latest version on the server.
 */
export async function saveThread(entry: TeamEntry, doc: AnnotationDoc<Thread>): Promise<AnnotationDoc<Thread>> {
  const latest = await backend.getAnnotation(doc.row.id);
  let content = doc.content;
  if (latest) {
    const remote = await decryptJSON<Thread>(entry.key, latest.payload_enc);
    const byId = new Map(remote.messages.map((m) => [m.id, m]));
    for (const m of content.messages) byId.set(m.id, m);
    content = { ...content, messages: [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)) };
  }
  const row = await saveAnnotation(entry, { row: doc.row, content });
  return { row, content };
}

export interface HistoryEntry<T = Content> {
  at: string;
  by: string | null;
  content: T;
}

export async function loadHistory(entry: TeamEntry, annotationId: string): Promise<HistoryEntry[]> {
  const versions = await backend.listVersions(annotationId);
  const out: HistoryEntry[] = [];
  for (const v of versions) {
    try {
      out.push({ at: v.updated_at, by: v.updated_by, content: await decryptJSON<Content>(entry.key, v.payload_enc) });
    } catch {
      /* skip */
    }
  }
  return out;
}
