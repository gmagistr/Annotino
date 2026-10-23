import { useEffect, useMemo, useRef, useState } from 'react';
import type { Identity } from '../app/auth';
import { fetchAudio, loadRecordings, loadTeamDocs, type AnnotationDoc, type RecordingEntry, type TeamEntry } from '../app/teams';
import { decodeAudio } from '../dsp/sniff';
import { t } from '../i18n';
import { formatDateTime, formatTime } from '../lib/format';
import { parseGuide, type Inline } from '../lib/references';
import { TAG_COLORS, anchorLabel, type Anchor, type Guide, type TagDef, type TagSet } from '../model';
import { HistoryDialog } from './HistoryDialog';

interface Props {
  identity: Identity;
  team: TeamEntry;
  guide: AnnotationDoc<Guide> | null;
  content: Guide;
  onSave: (content: Guide) => Promise<void>;
  onOpen: (recording: RecordingEntry, anchor: Anchor) => void;
  nameOf: (id: string) => string;
}

/** Plays short parts of encrypted recordings, decrypting each recording once. */
function useSnippets(team: TeamEntry) {
  const cache = useRef(new Map<string, Promise<AudioBuffer>>());
  const ctx = useRef<AudioContext | null>(null);
  const current = useRef<AudioBufferSourceNode | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const play = async (rec: RecordingEntry, anchor: Anchor, key: string) => {
    current.current?.stop();
    if (playing === key) {
      setPlaying(null);
      return;
    }
    let buf = cache.current.get(rec.row.id);
    if (!buf) {
      buf = fetchAudio(team, rec.row).then(decodeAudio);
      cache.current.set(rec.row.id, buf);
    }
    setPlaying(key);
    const audio = await buf;
    ctx.current ??= new AudioContext();
    const src = ctx.current.createBufferSource();
    src.buffer = audio;
    src.connect(ctx.current.destination);
    src.onended = () => setPlaying((k) => (k === key ? null : k));
    src.start(0, anchor.t0, Math.max(0.05, anchor.t1 - anchor.t0));
    current.current = src;
  };
  useEffect(() => () => void ctx.current?.close(), []);
  return { play, playing };
}

export function GuideView({ team, guide, content, onSave, onOpen, nameOf }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content.body);
  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [tagSets, setTagSets] = useState<AnnotationDoc<TagSet>[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const { play, playing } = useSnippets(team);

  useEffect(() => {
    loadRecordings(team).then(setRecordings).catch(() => {});
    loadTeamDocs(team, ['tags'])
      .then((d) => setTagSets(d as AnnotationDoc<TagSet>[]))
      .catch(() => {});
  }, [team]);

  useEffect(() => {
    if (!editing) setDraft(content.body);
  }, [content.body, editing]);

  const recById = useMemo(() => new Map(recordings.map((r) => [r.row.id, r])), [recordings]);
  const blocks = useMemo(() => parseGuide(content.body), [content.body]);

  const save = async (next: Guide) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setSaving(false);
    }
  };

  const updateTag = (id: string, patch: Partial<TagDef>) =>
    save({ ...content, tags: content.tags.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  const examples = (tagId: string) =>
    tagSets.flatMap((d) => d.content.items.filter((it) => it.tags.includes(tagId)).map((it) => ({ item: it, author: d.row.author_id })));

  const RefChip = ({ text, anchor, k }: { text: string; anchor: Anchor; k: string }) => {
    const rec = recById.get(anchor.recordingId);
    if (!rec) return <span className="ref-chip missing">{text || t('missing recording')}</span>;
    return (
      <span className="ref-chip">
        <button type="button" className="ref-play" aria-label={t('Listen')} onClick={() => play(rec, anchor, k)}>
          {playing === k ? '■' : '▶'}
        </button>
        <button type="button" className="ref-open ipa" onClick={() => onOpen(rec, anchor)} title={t('Open in the editor')}>
          {text || anchorLabel(anchor, (x) => formatTime(x, 2))}
        </button>
      </span>
    );
  };

  const renderInline = (items: Inline[], key: string) =>
    items.map((it, i) =>
      it.kind === 'ref' ? (
        <RefChip key={i} text={it.text} anchor={it.anchor} k={`${key}-${i}`} />
      ) : it.bold ? (
        <strong key={i}>{it.text}</strong>
      ) : it.italic ? (
        <em key={i}>{it.text}</em>
      ) : (
        <span key={i}>{it.text}</span>
      ),
    );

  return (
    <div className="guide-view">
      <header className="page-head">
        <h1>{t('Annotation guidelines')}</h1>
        <p className="muted">
          {guide
            ? t('Shared by the whole team. Last change by {name}, {when}.', {
                name: nameOf(guide.row.updated_by ?? guide.row.author_id),
                when: formatDateTime(guide.row.updated_at),
              })
            : t('Shared by the whole team. Nobody has written the guidelines yet.')}
        </p>
        <div className="row wrap">
          {!editing && (
            <button type="button" className="btn primary" onClick={() => setEditing(true)}>
              {t('Edit the guidelines')}
            </button>
          )}
          {guide && (
            <button type="button" className="btn quiet" onClick={() => setHistory(true)}>
              {t('History')}
            </button>
          )}
        </div>
      </header>
      {error && <p className="error banner">{error}</p>}

      <section className="section">
        {editing ? (
          <div className="guide-editor">
            <p className="hint">
              {t('Write with # headings, - lists, **bold** and *italic*. In the editor, “Cite in the guidelines” adds a reference to a part of a recording that colleagues can play from here.')}
            </p>
            <textarea className="guide-text" value={draft} onChange={(e) => setDraft(e.target.value)} rows={22} spellCheck />
            <div className="row">
              <button
                type="button"
                className="btn primary"
                disabled={saving}
                onClick={async () => {
                  await save({ ...content, body: draft });
                  setEditing(false);
                }}
              >
                {saving ? t('Encrypting and saving…') : t('Save the guidelines')}
              </button>
              <button
                type="button"
                className="btn quiet"
                onClick={() => {
                  setDraft(content.body);
                  setEditing(false);
                }}
              >
                {t('Cancel')}
              </button>
            </div>
          </div>
        ) : blocks.length === 0 ? (
          <div className="empty-inline">
            <p>
              {t('Write here how the team segments and labels: which symbols to use, where to put boundaries, how to treat uncertain cases. Cite examples from the recordings.')}
            </p>
          </div>
        ) : (
          <article className="guide-body">
            {blocks.map((b, i) => {
              if (b.kind === 'heading') {
                const H = (`h${b.level + 1}` as 'h2' | 'h3' | 'h4');
                return <H key={i}>{renderInline(b.inline, `b${i}`)}</H>;
              }
              if (b.kind === 'list')
                return (
                  <ul key={i}>
                    {b.items.map((it, j) => (
                      <li key={j}>{renderInline(it, `b${i}-${j}`)}</li>
                    ))}
                  </ul>
                );
              return <p key={i}>{renderInline(b.inline, `b${i}`)}</p>;
            })}
          </article>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t('Tags')}</h2>
        </div>
        <p className="hint">{t('The tags everyone can put on intervals, points and parts of the spectrogram. Describe when to use each one.')}</p>
        <ul className="tag-defs">
          {content.tags.map((d) => {
            const ex = examples(d.id);
            return (
              <li key={d.id} className="tag-def" style={{ ['--c' as string]: d.color }}>
                <div className="row wrap">
                  <input
                    className="tag-name"
                    defaultValue={d.name}
                    aria-label={t('Tag name')}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== d.name && updateTag(d.id, { name: e.target.value.trim() })}
                  />
                  <div className="swatches" role="radiogroup" aria-label={t('Colour')}>
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={d.color === c}
                        aria-label={c}
                        className="swatch-btn"
                        style={{ background: c }}
                        onClick={() => updateTag(d.id, { color: c })}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn small quiet"
                    onClick={() => save({ ...content, tags: content.tags.filter((x) => x.id !== d.id) })}
                  >
                    {t('Remove')}
                  </button>
                </div>
                <textarea
                  rows={2}
                  defaultValue={d.description}
                  placeholder={t('When to use this tag')}
                  aria-label={t('Description')}
                  onBlur={(e) => e.target.value !== d.description && updateTag(d.id, { description: e.target.value })}
                />
                {ex.length > 0 && (
                  <div className="examples">
                    <span className="muted">{t('{n} tagged in the recordings', { n: ex.length })}</span>
                    <div className="row wrap">
                      {ex.slice(0, 12).map(({ item, author }) => {
                        const rec = recById.get(item.anchor.recordingId);
                        return (
                          <RefChip
                            key={item.id}
                            k={`ex-${d.id}-${item.id}`}
                            anchor={item.anchor}
                            text={`${rec?.meta.name.replace(/\.[^.]+$/, '') ?? ''} ${anchorLabel(item.anchor, (x) => formatTime(x, 2))} (${nameOf(author)})`}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="btn small"
          onClick={() =>
            save({
              ...content,
              tags: [
                ...content.tags,
                { id: crypto.randomUUID(), name: t('new tag'), color: TAG_COLORS[content.tags.length % TAG_COLORS.length], description: '' },
              ],
            })
          }
        >
          {t('Add a tag')}
        </button>
      </section>

      {history && guide && (
        <HistoryDialog<Guide>
          team={team}
          annotationId={guide.row.id}
          title={t('History of the guidelines')}
          nameOf={nameOf}
          summarise={(c) => t('{n} words, {k} tags', { n: c.body.split(/\s+/).filter(Boolean).length, k: c.tags.length })}
          preview={(c) => <pre className="history-text">{c.body}</pre>}
          onRestore={(c) => void save(c)}
          onClose={() => setHistory(false)}
        />
      )}
    </div>
  );
}
