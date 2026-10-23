import { useState, type FormEvent } from 'react';
import type { Visibility } from '../../backend/types';
import { t } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { VISIBILITY_HELP, VISIBILITY_LABEL } from '../visibility';
import type { TierModel } from './types';

interface Props {
  models: TierModel[];
  hidden: Set<string>;
  setHidden: (s: Set<string>) => void;
  locked: boolean;
  defaultVisibility: Visibility;
  admin: boolean;
  blindRevealed: boolean;
  onAdd: (name: string, type: 'interval' | 'point') => void;
  onRename: (id: string, name: string) => void;
  onVisibility: (id: string, v: Visibility, revealAt: string | null) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onRevealBlind: (reveal: boolean) => Promise<void>;
  onRefresh: () => Promise<void>;
  onHistory: (id: string) => void;
}

function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 7 * 86400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TiersPanel(p: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'interval' | 'point'>('interval');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mine = p.models.filter((m) => m.editable);
  const others = p.models.filter((m) => !m.editable);

  const add = (e: FormEvent) => {
    e.preventDefault();
    p.onAdd(name.trim() || (type === 'interval' ? t('segments') : t('events')), type);
    setName('');
  };

  const toggle = (id: string) => {
    const next = new Set(p.hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    p.setHidden(next);
  };

  return (
    <div className="tiers-panel">
      <form className="add-tier" onSubmit={add}>
        <label className="field">
          <span>{t('New tier')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name, e.g. phones, words, tones')} />
        </label>
        <div className="row">
          <div className="segmented" role="radiogroup" aria-label={t('Tier type')}>
            <button type="button" role="radio" aria-checked={type === 'interval'} onClick={() => setType('interval')}>{t('Intervals')}</button>
            <button type="button" role="radio" aria-checked={type === 'point'} onClick={() => setType('point')}>{t('Points')}</button>
          </div>
          <button className="btn small primary" type="submit">{t('Add tier')}</button>
        </div>
        <p className="hint">{t('New tiers start as: {v}.', { v: t(VISIBILITY_LABEL[p.defaultVisibility]) })}</p>
      </form>

      <h3>{t('My tiers')}</h3>
      {mine.length === 0 && <p className="muted">{t('You have no tiers on this recording yet.')}</p>}
      <ul className="tier-list">
        {mine.map((m) => (
          <li key={m.doc.row.id} className="tier-item" style={{ ['--c' as string]: m.color }}>
            <div className="row">
              <input
                className="tier-name ipa"
                defaultValue={m.doc.content.name}
                aria-label={t('Tier name')}
                onBlur={(e) => e.target.value.trim() && e.target.value !== m.doc.content.name && p.onRename(m.doc.row.id, e.target.value.trim())}
              />
              <span className="tier-type">{m.doc.content.type === 'interval' ? t('intervals') : t('points')}</span>
            </div>
            <label className="field">
              <span>{t('Who can see it')}</span>
              <select
                value={m.doc.row.visibility}
                disabled={p.locked}
                onChange={(e) => {
                  const v = e.target.value as Visibility;
                  p.onVisibility(m.doc.row.id, v, v === 'scheduled' ? (m.doc.row.reveal_at ?? new Date(Date.now() + 7 * 86400_000).toISOString()) : null);
                }}
              >
                {(['private', 'blind', 'scheduled', 'team'] as Visibility[]).map((v) => (
                  <option key={v} value={v}>{t(VISIBILITY_LABEL[v])}</option>
                ))}
              </select>
            </label>
            {m.doc.row.visibility === 'scheduled' && (
              <label className="field">
                <span>{t('Visible from')}</span>
                <input
                  type="datetime-local"
                  disabled={p.locked}
                  value={toLocalInput(m.doc.row.reveal_at)}
                  onChange={(e) => e.target.value && p.onVisibility(m.doc.row.id, 'scheduled', new Date(e.target.value).toISOString())}
                />
              </label>
            )}
            <p className="hint">
              {p.locked ? t('The team owner fixed the visibility of tiers.') : t(VISIBILITY_HELP[m.doc.row.visibility])}
            </p>
            <div className="row">
              <button type="button" className="btn small quiet" onClick={() => toggle(m.doc.row.id)}>
                {p.hidden.has(m.doc.row.id) ? t('Show') : t('Hide')}
              </button>
              <button type="button" className="btn small quiet" onClick={() => p.onHistory(m.doc.row.id)}>
                {t('History')}
              </button>
              {confirmDelete === m.doc.row.id ? (
                <>
                  <button type="button" className="btn small danger" onClick={() => p.onDelete(m.doc.row.id)}>{t('Delete tier')}</button>
                  <button type="button" className="btn small quiet" onClick={() => setConfirmDelete(null)}>{t('Keep')}</button>
                </>
              ) : (
                <button type="button" className="btn small quiet" onClick={() => setConfirmDelete(m.doc.row.id)}>{t('Delete')}</button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="row space">
        <h3>{t('Colleagues’ tiers')}</h3>
        <button
          type="button"
          className="btn small quiet"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            await p.onRefresh().finally(() => setRefreshing(false));
          }}
        >
          {refreshing ? t('Refreshing…') : t('Refresh')}
        </button>
      </div>
      {others.length === 0 && (
        <p className="muted">{t('Nothing shared with you yet. Blind and private tiers of colleagues stay hidden.')}</p>
      )}
      <ul className="tier-list">
        {others.map((m) => (
          <li key={m.doc.row.id} className="tier-item" style={{ ['--c' as string]: m.color }}>
            <div className="row">
              <span className="tier-name ipa">{m.doc.content.name}</span>
              <span className="tier-type">{m.doc.content.type === 'interval' ? t('intervals') : t('points')}</span>
            </div>
            <p className="muted small-block">
              {m.author}, {t('updated {when}', { when: formatDateTime(m.doc.row.updated_at) })}
            </p>
            <div className="row">
              <button type="button" className="btn small quiet" onClick={() => toggle(m.doc.row.id)}>
                {p.hidden.has(m.doc.row.id) ? t('Show') : t('Hide')}
              </button>
              <button type="button" className="btn small quiet" onClick={() => p.onCopy(m.doc.row.id)}>{t('Copy to my tiers')}</button>
              <button type="button" className="btn small quiet" onClick={() => p.onHistory(m.doc.row.id)}>
                {t('History')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {p.admin && (
        <div className="blind-box">
          <h3>{t('Blind annotation')}</h3>
          <p className="hint">
            {p.blindRevealed
              ? t('Blind tiers on this recording are visible to the whole team.')
              : t('Blind tiers stay hidden from everyone but their author. Reveal them when all annotators have finished, then compute agreement.')}
          </p>
          <button type="button" className="btn small" onClick={() => p.onRevealBlind(!p.blindRevealed)}>
            {p.blindRevealed ? t('Hide blind tiers again') : t('Reveal blind tiers')}
          </button>
        </div>
      )}
    </div>
  );
}
