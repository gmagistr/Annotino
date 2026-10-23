import { useState } from 'react';
import type { Notice } from '../app/notices';
import type { TeamEntry } from '../app/teams';
import { t } from '../i18n';
import { formatDateTime, formatTime } from '../lib/format';
import { anchorLabel } from '../model';

interface Props {
  notices: Notice[];
  seen: Set<string>;
  teams: TeamEntry[];
  onOpen: (n: Notice) => void;
  onMarkAll: () => void;
  onRefresh: () => Promise<void>;
}

export function InboxView({ notices, seen, onOpen, onMarkAll, onRefresh }: Props) {
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = onlyUnread ? notices.filter((n) => !seen.has(n.messageId)) : notices;
  const unread = notices.filter((n) => !seen.has(n.messageId)).length;

  return (
    <div className="inbox">
      <header className="page-head">
        <h1>{t('Notifications')}</h1>
        <p className="muted">{t('Messages that mention you, and replies in discussions you took part in.')}</p>
        <div className="row wrap">
          <label className="check">
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
            <span>{t('Only unread ({n})', { n: unread })}</span>
          </label>
          <button type="button" className="btn small quiet" disabled={unread === 0} onClick={onMarkAll}>
            {t('Mark all as read')}
          </button>
          <button
            type="button"
            className="btn small quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onRefresh().finally(() => setBusy(false));
            }}
          >
            {busy ? t('Refreshing…') : t('Refresh')}
          </button>
        </div>
      </header>
      {list.length === 0 ? (
        <div className="empty-inline">
          <p>
            {onlyUnread
              ? t('You are up to date.')
              : t('No notifications yet. When a colleague writes @ and your name in a discussion, it appears here.')}
          </p>
        </div>
      ) : (
        <ul className="notice-list">
          {list.map((n) => (
            <li key={n.messageId} className={seen.has(n.messageId) ? 'notice-item' : 'notice-item unread'}>
              <button type="button" onClick={() => onOpen(n)}>
                <span className="notice-head">
                  <strong>{n.authorName || t('A colleague')}</strong>{' '}
                  {n.reason === 'mention' ? t('mentioned you') : t('replied in a discussion')}
                  <span className="muted"> {formatDateTime(n.at)}</span>
                </span>
                <span className="notice-text">{n.text || t('flagged this for discussion')}</span>
                <span className="notice-where muted">
                  {n.teamName}, {n.recordingName}, <span className="ipa">{anchorLabel(n.anchor, (x) => formatTime(x, 2))}</span>
                  {n.resolved && `, ${t('resolved')}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
