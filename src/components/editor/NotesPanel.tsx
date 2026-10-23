import type { Visibility } from '../../backend/types';
import { t } from '../../i18n';
import { formatNumber, formatTime } from '../../lib/format';
import type { Shape, Sketch } from '../../model';
import type { SketchModel } from './types';

interface Props {
  sketches: SketchModel[];
  hidden: Set<string>;
  setHidden: (s: Set<string>) => void;
  selectedShape: string | null;
  onSelect: (id: string, shape: Shape) => void;
  onChange: (docId: string, sketch: Sketch) => void;
  onVisibility: (docId: string, v: Visibility) => void;
  locked: boolean;
}

const KIND: Record<Shape['kind'], string> = { ellipse: 'Circle', rect: 'Box', arrow: 'Arrow', freehand: 'Pen', text: 'Text' };

function describe(s: Shape): string {
  if (s.points.length === 1) return `${formatTime(s.points[0][0])} s, ${formatNumber(s.points[0][1], 0)} Hz`;
  const ts = s.points.map((p) => p[0]);
  const fs = s.points.map((p) => p[1]);
  return `${formatTime(Math.min(...ts))}–${formatTime(Math.max(...ts))} s, ${formatNumber(Math.min(...fs), 0)}–${formatNumber(Math.max(...fs), 0)} Hz`;
}

export function NotesPanel({ sketches, hidden, setHidden, selectedShape, onSelect, onChange, onVisibility, locked }: Props) {
  const total = sketches.reduce((n, s) => n + s.doc.content.shapes.length, 0);
  return (
    <div className="notes-panel">
      <p className="hint">
        {t('Choose Circle, Box, Arrow or Pen in the toolbar and draw on the spectrogram, or Text to write on it. Each drawing can carry a note. Select a drawing and click × to delete it.')}
      </p>
      {total === 0 && <p className="muted">{t('No drawings on this recording yet.')}</p>}
      {sketches.map((sk) => (
        <section key={sk.doc.row.id} className="sketch-group" style={{ ['--c' as string]: sk.color }}>
          <div className="row space">
            <h3>{sk.editable ? t('My drawings') : sk.author}</h3>
            <button
              type="button"
              className="btn small quiet"
              onClick={() => {
                const next = new Set(hidden);
                if (next.has(sk.doc.row.id)) next.delete(sk.doc.row.id);
                else next.add(sk.doc.row.id);
                setHidden(next);
              }}
            >
              {hidden.has(sk.doc.row.id) ? t('Show') : t('Hide')}
            </button>
          </div>
          {sk.editable && (
            <label className="field">
              <span>{t('Who can see my drawings')}</span>
              <select value={sk.doc.row.visibility} disabled={locked} onChange={(e) => onVisibility(sk.doc.row.id, e.target.value as Visibility)}>
                <option value="team">{t('Whole team')}</option>
                <option value="private">{t('Only me')}</option>
                <option value="blind">{t('Blind until revealed')}</option>
              </select>
            </label>
          )}
          <ul className="shape-list">
            {sk.doc.content.shapes.map((s, i) => (
              <li key={s.id} className={selectedShape === s.id ? 'selected' : undefined}>
                <button type="button" className="shape-head" onClick={() => onSelect(s.id, s)}>
                  <span>{t(KIND[s.kind])} {i + 1}</span>
                  <span className="muted">{describe(s)}</span>
                </button>
                {sk.editable ? (
                  <>
                    <textarea
                      rows={2}
                      data-shape={s.id}
                      value={s.note}
                      placeholder={s.kind === 'text' ? t('Text shown on the spectrogram') : t('Note, e.g. “creaky onset”, “F2 transition”')}
                      aria-label={t('Note')}
                      onFocus={() => onSelect(s.id, s)}
                      onChange={(e) => {
                        const shapes = sk.doc.content.shapes.map((x) => (x.id === s.id ? { ...x, note: e.target.value } : x));
                        onChange(sk.doc.row.id, { shapes });
                      }}
                    />
                    <button
                      type="button"
                      className="btn small quiet"
                      onClick={() => onChange(sk.doc.row.id, { shapes: sk.doc.content.shapes.filter((x) => x.id !== s.id) })}
                    >
                      {t('Delete')}
                    </button>
                  </>
                ) : (
                  s.note && <p className="note-text">{s.note}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
