import { backend } from '../backend';
import { devicePrefs } from '../lib/idb';
import type { Anchor, Thread } from '../model';
import { loadRecordings, loadTeamDocs, type AnnotationDoc, type TeamEntry } from './teams';

/**
 * Notifications are computed in the browser from the (decrypted) discussions:
 * a message notifies you when it mentions you, or when it is a reply in a
 * discussion you started or took part in. Which ones you have seen is kept on
 * this device.
 */
export interface Notice {
  messageId: string;
  teamId: string;
  teamName: string;
  recordingId: string;
  recordingName: string;
  threadId: string;
  anchor: Anchor;
  author: string;
  authorName: string;
  text: string;
  at: string;
  reason: 'mention' | 'reply';
  resolved: boolean;
}

export async function loadNotices(teams: TeamEntry[], me: string): Promise<Notice[]> {
  const out: Notice[] = [];
  for (const team of teams) {
    const docs = (await loadTeamDocs(team, ['thread'])) as AnnotationDoc<Thread>[];
    if (!docs.length) continue;
    const [recs, profiles] = await Promise.all([loadRecordings(team), backend.teamProfiles(team.team.id)]);
    const recName = new Map(recs.map((r) => [r.row.id, r.meta.name]));
    const name = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? '';
    for (const d of docs) {
      let participated = false;
      for (const m of d.content.messages) {
        if (m.author === me) {
          participated = true;
          continue;
        }
        const mention = m.mentions.includes(me);
        if (!mention && !participated) continue;
        out.push({
          messageId: m.id,
          teamId: team.team.id,
          teamName: team.name,
          recordingId: d.row.recording_id!,
          recordingName: recName.get(d.row.recording_id!) ?? '',
          threadId: d.row.id,
          anchor: d.content.anchor,
          author: m.author,
          authorName: name(m.author),
          text: m.text,
          at: m.at,
          reason: mention ? 'mention' : 'reply',
          resolved: d.content.status === 'resolved',
        });
      }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

const key = (me: string) => `seen:${me}`;

export async function seenIds(me: string): Promise<Set<string>> {
  return new Set((await devicePrefs.get<string[]>(key(me))) ?? []);
}

export async function markSeen(me: string, ids: string[]): Promise<Set<string>> {
  const s = await seenIds(me);
  for (const id of ids) s.add(id);
  // Keep the list bounded.
  const list = [...s].slice(-5000);
  await devicePrefs.put(key(me), list);
  return new Set(list);
}
