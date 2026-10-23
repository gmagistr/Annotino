import { useState, type FormEvent } from 'react';
import { t } from '../../i18n';
import { formatTime } from '../../lib/format';
import { anchorLabel, sameAnchor, type Anchor, type TagDef, type TagItem } from '../../model';

export interface TagEntry {
  item: TagItem;
  author: string;
  color: string;
  mine: boolean;
}

interface Props {
  defs: TagDef[];
  entries: TagEntry[];
  target: { anchor: Anchor; description: string } | null;
  onToggle: (tagId: string) => void;
  onAddDef: (name: string) => void;
  filter: Set<string>;
  setFilter: (s: Set<string>) => void;
  focus: boolean;
  setFocus: (f: boolean) => void;
  onPlayAll: (items: TagItem[]) => void;
  onGo: (anchor: Anchor, play: boolean) => void;
  onCite: (anchor: Anchor) => void;
  canEditDefs: boolean;
}

export function TagsPanel(p: Props) {
  const [newTag, setNewTag] = useState('');
  const defById = new Map(p.defs.map((d) => [d.id, d]));
  const onTarget = p.target ? p.entries.filter((e) => e.mine && sameAnchor(e.item.anchor, p.target!.anchor)).flatMap((e) => e.item.tags) : [];
  const matching = p.entries
    .filter((e) => p.filter.size === 0 || e.item.tags.some((x) => p.filter.has(x)))
    .sort((a, b) => a.item.anchor.t0 - b.item.anchor.t0);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!newTag.trim()) return;
    p.onAddDef(newTag.trim());
    setNewTag('');
  };

  return (
    <div className="tags-panel">
      <section className="target-box">
        <h3>{t('Tag the selection')}</h3>
        {p.target ? (
          <>
            <p className="target-desc">{p.target.description}</p>
            <div className="tag-chips" role="group" aria-label={t('Tags')}>
              {p.defs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="tag-chip"
                  aria-pressed={onTarget.includes(d.id)}
                  style={{ ['--tag' as string]: d.color }}
                  title={d.description}
                  onClick={() => p.onToggle(d.id)}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="hint">{t('Select a stretch, an interval, a point or a drawing, then choose its tags.')}</p>
        )}
        {p.canEditDefs && (
          <form className="row" onSubmit={add}>
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder={t('New tag')} aria-label={t('New tag')} />
            <button className="btn small" type="submit" disabled={!newTag.trim()}>
              {t('Add')}
            </button>
          </form>
        )}
      </section>

      <section className="filter-box">
        <h3>{t('Show and listen by tag')}</h3>
        <div className="tag-chips" role="group" aria-label={t('Filter by tag')}>
          {p.defs.map((d) => (
            <button
              key={d.id}
              type="button"
              className="tag-chip outline"
              aria-pressed={p.filter.has(d.id)}
              style={{ ['--tag' as string]: d.color }}
              onClick={() => {
                const next = new Set(p.filter);
                if (next.has(d.id)) next.delete(d.id);
                else next.add(d.id);
                p.setFilter(next);
              }}
            >
              {d.name}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={p.focus} onChange={(e) => p.setFocus(e.target.checked)} disabled={p.filter.size === 0} />
          <span>{t('Dim everything else on the timeline')}</span>
        </label>
        <button
          type="button"
          className="btn small primary"
          disabled={matching.length === 0}
          onClick={() => p.onPlayAll(matching.map((e) => e.item))}
        >
          {p.filter.size ? t('Play only these ({n})', { n: matching.length }) : t('Play all tagged parts ({n})', { n: matching.length })}
        </button>
      </section>

      <ul className="tagged-list">
        {matching.map((e) => (
          <li key={`${e.item.id}`} style={{ ['--c' as string]: e.color }}>
            <button type="button" className="tagged-head" onClick={() => p.onGo(e.item.anchor, true)}>
              <span className="ipa">{anchorLabel(e.item.anchor, (x) => formatTime(x, 2))}</span>
              <span className="muted">{e.author}</span>
            </button>
            <div className="row wrap">
              {e.item.tags.map((id) => {
                const d = defById.get(id);
                return (
                  <span key={id} className="tag-dot" style={{ ['--tag' as string]: d?.color ?? '#59626E' }}>
                    {d?.name ?? id}
                  </span>
                );
              })}
              <button type="button" className="link subtle" onClick={() => p.onCite(e.item.anchor)}>
                {t('Cite in the guidelines')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {p.entries.length === 0 && <p className="muted">{t('Nothing is tagged on this recording yet.')}</p>}
    </div>
  );
}
