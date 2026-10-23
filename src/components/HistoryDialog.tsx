import { useEffect, useState, type ReactNode } from 'react';
import { loadHistory, type Content, type HistoryEntry, type TeamEntry } from '../app/teams';
import { t } from '../i18n';
import { formatDateTime } from '../lib/format';

interface Props<T extends Content> {
  team: TeamEntry;
  annotationId: string;
  title: string;
  nameOf: (id: string) => string;
  /** Short description of a version, e.g. "12 intervals". */
  summarise: (c: T) => string;
  preview: (c: T) => ReactNode;
  onRestore: ((c: T) => void) | null;
  onClose: () => void;
}

/** Earlier versions of an annotation, newest first, with preview and restore. */
export function HistoryDialog<T extends Content>(p: Props<T>) {
  const [entries, setEntries] = useState<HistoryEntry<T>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    loadHistory(p.team, p.annotationId)
      .then((h) => setEntries(h as HistoryEntry<T>[]))
      .catch((e) => setError(String(e.message ?? e)));
  }, [p.team, p.annotationId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  return (
    <div className="dialog-backdrop" onClick={p.onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-head">
          <h2 id="history-title">{p.title}</h2>
          <button type="button" className="btn small quiet" onClick={p.onClose}>
            {t('Close')}
          </button>
        </header>
        <p className="hint">{t('A version is kept at most every three minutes of work; the latest 60 are available.')}</p>
        {error && <p className="error">{error}</p>}
        {entries === null && !error && <p className="muted">{t('Decrypting…')}</p>}
        {entries?.length === 0 && <p className="muted">{t('No earlier versions yet.')}</p>}
        <ol className="history-list">
          {entries?.map((e, i) => (
            <li key={e.at + i}>
              <div className="row space">
                <button type="button" className="history-head" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                  <strong>{formatDateTime(e.at)}</strong>
                  <span className="muted">
                    {[e.by ? p.nameOf(e.by) : null, p.summarise(e.content)].filter(Boolean).join(', ')}
                  </span>
                </button>
                {p.onRestore && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      p.onRestore!(e.content);
                      p.onClose();
                    }}
                  >
                    {t('Restore this version')}
                  </button>
                )}
              </div>
              {open === i && <div className="history-preview">{p.preview(e.content)}</div>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
