import { useEffect, useState } from 'react';
import type { AnnotationDoc } from '../../app/teams';
import type { PublicProfile } from '../../backend/types';
import { t } from '../../i18n';
import { formatDateTime, formatTime } from '../../lib/format';
import { anchorLabel, type Anchor, type Thread } from '../../model';
import { MentionInput, MessageText, mentionsIn } from './MentionInput';

interface Props {
  threads: AnnotationDoc<Thread>[];
  members: PublicProfile[];
  me: string;
  nameOf: (id: string) => string;
  target: { anchor: Anchor; description: string } | null;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onCreate: (text: string, mentions: string[]) => void;
  onReply: (id: string, text: string, mentions: string[]) => void;
  onStatus: (id: string, status: Thread['status']) => void;
  onGo: (anchor: Anchor) => void;
  onCite: (anchor: Anchor) => void;
}

type Filter = 'open' | 'resolved' | 'all';

export function ThreadsPanel(p: Props) {
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const list = p.threads
    .filter((d) => filter === 'all' || d.content.status === filter)
    .sort((a, b) => a.content.anchor.t0 - b.content.anchor.t0);
  const openCount = p.threads.filter((d) => d.content.status === 'open').length;

  const create = () => {
    if (!p.target) return;
    p.onCreate(draft.trim(), mentionsIn(draft, p.members));
    setDraft('');
    setFilter('open');
  };

  return (
    <div className="threads-panel">
      <section className="target-box">
        <h3>{t('Start a discussion')}</h3>
        {p.target ? (
          <>
            <p className="target-desc">{p.target.description}</p>
            <MentionInput
              members={p.members}
              me={p.me}
              value={draft}
              onChange={setDraft}
              onSubmit={create}
              label={t('Message')}
              placeholder={t('What should the team look at? Type @ to mention a colleague.')}
            />
            <div className="row wrap">
              <button type="button" className="btn small primary" onClick={create}>
                {draft.trim() ? t('Start discussion') : t('Flag for discussion')}
              </button>
              <button type="button" className="btn small quiet" onClick={() => p.onCite(p.target!.anchor)}>
                {t('Cite in the guidelines')}
              </button>
            </div>
          </>
        ) : (
          <p className="hint">{t('Select a stretch, an interval, a point or a drawing to discuss it or flag it for discussion.')}</p>
        )}
      </section>

      <div className="row space">
        <h3>{t('Discussions')}</h3>
        <div className="segmented" role="radiogroup" aria-label={t('Show')}>
          {(
            [
              ['open', t('Open ({n})', { n: openCount })],
              ['resolved', t('Resolved')],
              ['all', t('All')],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 && (
        <p className="muted">{filter === 'open' ? t('No open discussions on this recording.') : t('Nothing here yet.')}</p>
      )}
      <ul className="thread-list">
        {list.map((d) => (
          <ThreadCard key={d.row.id} doc={d} {...p} />
        ))}
      </ul>
    </div>
  );
}

function ThreadCard({ doc, members, me, nameOf, openId, setOpenId, onReply, onStatus, onGo }: Props & { doc: AnnotationDoc<Thread> }) {
  const [reply, setReply] = useState('');
  const open = openId === doc.row.id;
  const th = doc.content;
  const first = th.messages[0];
  const last = th.messages[th.messages.length - 1];

  useEffect(() => {
    if (open) document.getElementById(`thread-${doc.row.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, doc.row.id]);

  const send = () => {
    if (!reply.trim()) return;
    onReply(doc.row.id, reply.trim(), mentionsIn(reply, members));
    setReply('');
  };

  return (
    <li id={`thread-${doc.row.id}`} className={`thread ${th.status} ${open ? 'expanded' : ''}`}>
      <button
        type="button"
        className="thread-head"
        aria-expanded={open}
        onClick={() => {
          setOpenId(open ? null : doc.row.id);
          if (!open) onGo(th.anchor);
        }}
      >
        <span className="thread-where">{anchorLabel(th.anchor, (x) => formatTime(x, 2))}</span>
        <span className="thread-first">
          {first ? (
            <>
              <strong>{nameOf(first.author)}:</strong> {first.text || t('flagged this for discussion')}
            </>
          ) : (
            t('Flagged for discussion')
          )}
        </span>
        <span className="thread-meta">
          {th.messages.length > 1 && t('{n} replies', { n: th.messages.length - 1 })}
          {th.messages.length > 1 && ', '}
          {last && formatDateTime(last.at)}
          {th.status === 'resolved' && `, ${t('resolved')}`}
        </span>
      </button>
      {open && (
        <div className="thread-body">
          <ol className="messages">
            {th.messages.map((m) => (
              <li key={m.id} className={m.mentions.includes(me) ? 'mentions-me' : undefined}>
                <div className="msg-head">
                  <strong>{nameOf(m.author)}</strong>
                  <span className="muted">{formatDateTime(m.at)}</span>
                </div>
                {m.text ? (
                  <p>
                    <MessageText text={m.text} members={members} />
                  </p>
                ) : (
                  <p className="muted">{t('flagged this for discussion')}</p>
                )}
              </li>
            ))}
          </ol>
          <MentionInput
            members={members}
            me={me}
            value={reply}
            onChange={setReply}
            onSubmit={send}
            label={t('Reply')}
            placeholder={t('Reply. Type @ to mention a colleague; Ctrl+Enter sends.')}
          />
          <div className="row wrap">
            <button type="button" className="btn small primary" disabled={!reply.trim()} onClick={send}>
              {t('Reply')}
            </button>
            <button type="button" className="btn small quiet" onClick={() => onStatus(doc.row.id, th.status === 'open' ? 'resolved' : 'open')}>
              {th.status === 'open' ? t('Mark as resolved') : t('Reopen')}
            </button>
            <button type="button" className="btn small quiet" onClick={() => onGo(th.anchor)}>
              {t('Show')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
