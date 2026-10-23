import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RecordingRow } from '../backend/types';

// The blob cache lives in IndexedDB, which Node does not have.
vi.mock('../lib/idb', () => ({ blobCache: { get: async () => undefined, put: async () => {} } }));

// A minimal in-memory GitHub: blobs, trees, commits and one branch.
function fakeGitHub() {
  const blobs = new Map<string, Uint8Array>();
  const trees = new Map<string, Map<string, string>>(); // tree sha → path → blob sha
  const commits = new Map<string, string>(); // commit sha → tree sha
  let n = 0;
  const id = () => `sha${++n}`;
  trees.set('t0', new Map());
  commits.set('c0', 't0');
  let head = 'c0';
  let largestBody = 0;
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/repos/o/r', '');
    const body = init.body ? JSON.parse(init.body as string) : null;
    largestBody = Math.max(largestBody, (init.body as string | undefined)?.length ?? 0);
    const method = init.method ?? 'GET';
    if (method === 'POST' && path === '/git/blobs') {
      const sha = id();
      blobs.set(sha, Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)));
      return json({ sha }, 201);
    }
    if (method === 'GET' && path === '/git/ref/heads/main') return json({ object: { sha: head } });
    if (method === 'GET' && path.startsWith('/git/commits/')) return json({ tree: { sha: commits.get(path.split('/').pop()!) } });
    if (method === 'POST' && path === '/git/trees') {
      const t = new Map(trees.get(body.base_tree));
      for (const e of body.tree) t.set(e.path, e.sha);
      const sha = id();
      trees.set(sha, t);
      return json({ sha }, 201);
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = id();
      commits.set(sha, body.tree);
      return json({ sha }, 201);
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      head = body.sha;
      return json({});
    }
    if (method === 'GET' && path.startsWith('/git/trees/')) {
      const t = trees.get(commits.get(head)!)!;
      return json({ tree: [...t].map(([p, sha]) => ({ path: p, sha, type: 'blob' })) });
    }
    if (method === 'GET' && path.startsWith('/git/blobs/')) return new Response(blobs.get(path.split('/').pop()!)!.slice().buffer);
    return json({ message: `unexpected ${method} ${path}` }, 500);
  });
  return { fetch, files: () => [...trees.get(commits.get(head)!)!.keys()], largestBody: () => largestBody };
}

describe('GitHub audio storage', () => {
  beforeAll(() => {
    const store = new Map<string, string>([['annotino.github.auth', JSON.stringify({ access: 'x' })]]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
  });

  it('stores large audio in parts, in one commit, and reads it back intact', async () => {
    const gh = fakeGitHub();
    vi.stubGlobal('fetch', gh.fetch);
    const { GitHubBackend } = await import('../backend/github');
    const b = new GitHubBackend();
    const internals = b as unknown as { repos: Map<string, unknown> };
    internals.repos.set('team1', { owner: 'o', repo: 'r', branch: 'main' });

    const audio = new Uint8Array(20 * 1024 * 1024 + 123);
    for (let i = 0; i < audio.length; i++) audio[i] = (i * 31) & 0xff;
    const row = { id: 'rec1', team_id: 'team1', storage_path: 'team1/abc', created_at: '' } as unknown as RecordingRow;

    await b.createRecording(row, audio);
    expect(gh.files().sort()).toEqual(['audio/abc.bin.part0', 'audio/abc.bin.part1', 'audio/abc.bin.part2', 'recordings/rec1.json']);
    expect(gh.fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    // No request carries more than one 8 MB part (about 11 MB in base64).
    expect(gh.largestBody()).toBeLessThan(12 * 1024 * 1024);

    const back = new Uint8Array(await b.downloadAudio(row));
    expect(back.length).toBe(audio.length);
    expect(back.every((v, i) => v === audio[i])).toBe(true);
  });
});
