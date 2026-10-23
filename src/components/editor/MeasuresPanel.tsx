import { trackAt, type Track } from '../../dsp/analysis';
import type { Analysis } from '../../dsp/engine';
import { t } from '../../i18n';
import { formatNumber, formatTime } from '../../lib/format';
import { intervalsOf, type IntervalTier } from '../../model';
import type { Selection } from './types';

interface Props {
  analysis: Analysis | null;
  cursor: number;
  selection: Selection | null;
  duration: number;
}

function formantAt(a: Analysis, t0: number, k: number): number {
  const fm = a.formants;
  const i = Math.round((t0 - fm.t0) / fm.step);
  if (i < 0 || i >= fm.count) return NaN;
  return fm.freqs[i * fm.maxFormants + k];
}

function stats(track: Track, a: number, b: number) {
  const vals: number[] = [];
  for (let i = 0; i < track.values.length; i++) {
    const tt = track.t0 + i * track.step;
    if (tt >= a && tt <= b && Number.isFinite(track.values[i])) vals.push(track.values[i]);
  }
  if (!vals.length) return { mean: NaN, min: NaN, max: NaN, n: 0 };
  return { mean: vals.reduce((s, v) => s + v, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
}

function meanFormant(an: Analysis, a: number, b: number, k: number): number {
  const fm = an.formants;
  let s = 0;
  let n = 0;
  for (let i = 0; i < fm.count; i++) {
    const tt = fm.t0 + i * fm.step;
    const v = fm.freqs[i * fm.maxFormants + k];
    if (tt >= a && tt <= b && Number.isFinite(v)) {
      s += v;
      n++;
    }
  }
  return n ? s / n : NaN;
}

export function MeasuresPanel({ analysis, cursor, selection, duration }: Props) {
  if (!analysis) return <p className="muted">{t('Analysing pitch, formants and intensity…')}</p>;
  const hz = (v: number) => (Number.isFinite(v) ? `${formatNumber(v, 0)} Hz` : '–');
  const f0 = stats(analysis.pitch, selection?.a ?? 0, selection?.b ?? 0);
  const int = stats(analysis.intensity, selection?.a ?? 0, selection?.b ?? 0);
  const nuclei = selection ? analysis.rate.nuclei.filter((n) => n >= selection.a && n <= selection.b).length : 0;

  const pitchAt = trackAt(analysis.pitch, cursor);
  const intAt = trackAt(analysis.intensity, cursor);
  const rateAt = trackAt(analysis.rate.curve, cursor);

  return (
    <div className="measures">
      <h3>{t('At the cursor')}, {formatTime(cursor)} s</h3>
      <KV
        rows={[
          [t('Pitch'), hz(pitchAt)],
          ...[0, 1, 2, 3].map((k): [string, string] => [`F${k + 1}`, hz(formantAt(analysis, cursor, k))]),
          [t('Intensity'), Number.isFinite(intAt) ? `${formatNumber(intAt, 1)} dB` : '–'],
          [t('Local speech rate'), Number.isFinite(rateAt) ? t('{n} syll/s', { n: formatNumber(rateAt, 1) }) : '–'],
        ]}
      />

      {selection && (
        <>
          <h3>{t('Selection')}, {formatTime(selection.b - selection.a)} s</h3>
          <KV
            rows={[
              [t('Mean pitch'), hz(f0.mean)],
              [t('Pitch range'), f0.n ? `${formatNumber(f0.min, 0)}–${formatNumber(f0.max, 0)} Hz` : '–'],
              [t('Mean F1 / F2'), `${hz(meanFormant(analysis, selection.a, selection.b, 0))} / ${hz(meanFormant(analysis, selection.a, selection.b, 1))}`],
              [t('Mean intensity'), Number.isFinite(int.mean) ? `${formatNumber(int.mean, 1)} dB` : '–'],
              [t('Syllable nuclei'), `${nuclei} (${t('{n} syll/s', { n: formatNumber(nuclei / (selection.b - selection.a), 1) })})`],
            ]}
          />
        </>
      )}

      <h3>{t('Whole recording')}</h3>
      <KV
        rows={[
          [t('Duration'), `${formatTime(duration)} s`],
          [t('Speech rate'), t('{n} syll/s', { n: formatNumber(analysis.rate.speechRate, 2) })],
          [t('Articulation rate'), t('{n} syll/s', { n: formatNumber(analysis.rate.articulationRate, 2) })],
        ]}
      />
      <p className="hint">
        {t('Pitch by autocorrelation (Boersma 1993), formants by Burg LPC, syllable nuclei from intensity peaks in voiced stretches (de Jong & Wempe 2009). Check values against Praat before publishing.')}
      </p>
    </div>
  );
}

function KV({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const csvNum = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '');
const csvStr = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function measuresCsv(a: Analysis, duration: number): string {
  const rows = ['time_s,f0_hz,f1_hz,f2_hz,f3_hz,f4_hz,intensity_db,speech_rate_syll_s'];
  for (let tt = 0; tt <= duration; tt += 0.01) {
    rows.push(
      [
        tt.toFixed(3),
        csvNum(trackAt(a.pitch, tt), 1),
        ...[0, 1, 2, 3].map((k) => csvNum(formantAt(a, tt, k), 0)),
        csvNum(trackAt(a.intensity, tt), 1),
        csvNum(trackAt(a.rate.curve, tt), 2),
      ].join(','),
    );
  }
  return rows.join('\n');
}

export function intervalReportCsv(a: Analysis, tier: IntervalTier, duration: number): string {
  const rows = ['label,start_s,end_s,duration_ms,f0_mean_hz,f0_min_hz,f0_max_hz,f1_mid_hz,f2_mid_hz,f3_mid_hz,intensity_mean_db'];
  for (const iv of intervalsOf(tier, duration)) {
    if (!iv.label.trim()) continue;
    const f0 = stats(a.pitch, iv.start, iv.end);
    const mid = (iv.start + iv.end) / 2;
    rows.push(
      [
        csvStr(iv.label),
        iv.start.toFixed(4),
        iv.end.toFixed(4),
        ((iv.end - iv.start) * 1000).toFixed(1),
        csvNum(f0.mean, 1),
        csvNum(f0.min, 1),
        csvNum(f0.max, 1),
        csvNum(formantAt(a, mid, 0), 0),
        csvNum(formantAt(a, mid, 1), 0),
        csvNum(formantAt(a, mid, 2), 0),
        csvNum(stats(a.intensity, iv.start, iv.end).mean, 1),
      ].join(','),
    );
  }
  return rows.join('\n');
}
