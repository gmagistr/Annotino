import { useEffect, useMemo, useState } from 'react';
import {
  interpretKappa,
  intervalAgreement,
  pointAgreement,
  type AgreementReport,
  type Distance,
} from '../../agreement/metrics';
import { nominalDistance, phoneticDistance } from '../../ipa/distance';
import type { IntervalTier, PointTier } from '../../model';
import { t } from '../../i18n';
import { formatNumber } from '../../lib/format';
import { downloadText } from '../../lib/download';
import type { AgreementConfig, TierModel } from './types';

interface Props {
  tiers: TierModel[];
  duration: number;
  preferredName: string | null;
  /** The comparison in force (null until computed); results follow the tiers while they are edited. */
  config: AgreementConfig | null;
  onConfig: (c: AgreementConfig | null) => void;
}

type LabelMode = AgreementConfig['labelMode'];

export function AgreementPanel({ tiers, duration, preferredName, config, onConfig }: Props) {
  const [type, setType] = useState<'interval' | 'point'>(config?.type ?? 'interval');
  const candidates = tiers.filter((m) => m.doc.content.type === type);
  const [chosen, setChosen] = useState<Set<string>>(() => {
    if (config) return new Set(config.tierIds);
    const name = preferredName ?? tiers[0]?.doc.content.name;
    return new Set(tiers.filter((m) => m.doc.content.name === name).map((m) => m.doc.row.id));
  });
  const [toleranceMs, setToleranceMs] = useState(config?.toleranceMs ?? 20);
  const [frameMs, setFrameMs] = useState(config?.frameMs ?? 10);
  const [labelMode, setLabelMode] = useState<LabelMode>(config?.labelMode ?? 'phonetic');
  const [gaps, setGaps] = useState(config?.gaps ?? true);

  const selected = candidates.filter((m) => chosen.has(m.doc.row.id));
  const active = config !== null;

  // Once computed, any change of options or selection updates the results at once.
  const current: AgreementConfig = {
    type,
    tierIds: selected.map((m) => m.doc.row.id),
    toleranceMs,
    frameMs,
    labelMode,
    gaps,
  };
  const key = JSON.stringify(current);
  useEffect(() => {
    if (active && key !== JSON.stringify(config)) onConfig(current.tierIds.length >= 2 ? current : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const report = useMemo(() => {
    if (!config || config.tierIds.length < 2) return null;
    const models = config.tierIds.map((id) => tiers.find((m) => m.doc.row.id === id)).filter((m): m is TierModel => !!m);
    if (models.length < 2) return null;
    const distance: Distance = config.labelMode === 'phonetic' ? phoneticDistance : nominalDistance;
    const opts = { tolerance: config.toleranceMs / 1000, frameStep: config.frameMs / 1000, gapsAsCategory: config.gaps, distance };
    const r =
      config.type === 'interval'
        ? intervalAgreement(models.map((m) => m.doc.content as IntervalTier), duration, opts)
        : pointAgreement(models.map((m) => m.doc.content as PointTier), opts);
    return { report: r, models };
  }, [config, tiers, duration]);

  const compute = () => onConfig(current);

  const names = useMemo(() => {
    const byName = new Map<string, number>();
    for (const m of candidates) byName.set(m.doc.content.name, (byName.get(m.doc.content.name) ?? 0) + 1);
    return byName;
  }, [candidates]);

  const exportCsv = () => {
    if (!report) return;
    const who = (i: number) => `${report.models[i].doc.content.name} (${report.models[i].author})`;
    const rows = [
      ['annotator_a', 'annotator_b', 'boundaries_a', 'boundaries_b', 'matched', 'precision', 'recall', 'f1', 'mean_abs_delta_ms', 'rmse_ms', 'kappa', 'weighted_kappa', 'exact_label', 'mean_iou', 'segment_label_similarity'],
      ...report.report.pairs.map((p) => [
        who(p.a),
        who(p.b),
        p.timing.countA,
        p.timing.countB,
        p.timing.matched,
        p.timing.precision,
        p.timing.recall,
        p.timing.f1,
        p.timing.meanAbsDelta * 1000,
        p.timing.rmse * 1000,
        p.kappa,
        p.weightedKappa,
        p.exactLabel,
        p.segments?.meanIoU ?? '',
        p.segments?.meanLabelSimilarity ?? '',
      ]),
      [],
      ['krippendorff_alpha', report.report.alpha],
      ['krippendorff_alpha_nominal', report.report.alphaNominal],
      ['fleiss_kappa', report.report.fleiss],
      ['label_distance', labelMode],
      ['tolerance_ms', toleranceMs],
      ['frame_ms', frameMs],
    ];
    const csv = rows.map((r) => r.map((v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v))).join(',')).join('\n');
    downloadText(csv, 'agreement.csv', 'text/csv');
  };

  return (
    <div className="agreement">
      <div className="segmented" role="radiogroup" aria-label={t('Tier type')}>
        {(['interval', 'point'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={type === k}
            onClick={() => {
              setType(k);
              onConfig(null);
            }}
          >
            {k === 'interval' ? t('Interval tiers') : t('Point tiers')}
          </button>
        ))}
      </div>

      {candidates.length < 2 ? (
        <p className="muted">
          {t('At least two visible tiers of this type are needed. Blind tiers appear once an admin reveals them.')}
        </p>
      ) : (
        <>
          <fieldset className="tier-pick">
            <legend>{t('Compare')}</legend>
            {candidates.map((m) => (
              <label key={m.doc.row.id} className="check">
                <input
                  type="checkbox"
                  checked={chosen.has(m.doc.row.id)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(m.doc.row.id);
                    else next.delete(m.doc.row.id);
                    setChosen(next);
                  }}
                />
                <span className="swatch" style={{ background: m.color }} />
                <span>
                  <span className="ipa">{m.doc.content.name}</span>
                  <span className="muted small-block">{m.author}</span>
                </span>
              </label>
            ))}
            {names.size > 1 && (
              <div className="row wrap">
                {[...names.entries()].filter(([, n]) => n > 1).map(([name]) => (
                  <button
                    key={name}
                    type="button"
                    className="btn small quiet"
                    onClick={() => setChosen(new Set(candidates.filter((m) => m.doc.content.name === name).map((m) => m.doc.row.id)))}
                  >
                    {t('All “{name}” tiers', { name })}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <div className="options">
            <label className="field inline">
              <span>{type === 'interval' ? t('Boundary tolerance') : t('Point tolerance')}</span>
              <span className="unit-input">
                <input type="number" min={1} max={500} value={toleranceMs} onChange={(e) => setToleranceMs(Number(e.target.value))} />
                ms
              </span>
            </label>
            {type === 'interval' && (
              <label className="field inline">
                <span>{t('Frame step')}</span>
                <span className="unit-input">
                  <input type="number" min={1} max={100} value={frameMs} onChange={(e) => setFrameMs(Number(e.target.value))} />
                  ms
                </span>
              </label>
            )}
            <label className="field">
              <span>{t('Compare labels')}</span>
              <select value={labelMode} onChange={(e) => setLabelMode(e.target.value as LabelMode)}>
                <option value="phonetic">{t('By phonetic similarity (IPA features)')}</option>
                <option value="nominal">{t('As exact categories')}</option>
              </select>
            </label>
            {type === 'interval' && (
              <label className="check">
                <input type="checkbox" checked={gaps} onChange={(e) => setGaps(e.target.checked)} />
                <span>{t('Count unlabelled stretches as a category')}</span>
              </label>
            )}
          </div>

          {active ? (
            <div className="row wrap">
              <p className="hint grow">{t('Results update as the tiers change.')}</p>
              <button type="button" className="btn small quiet" onClick={() => onConfig(null)}>
                {t('Stop comparing')}
              </button>
            </div>
          ) : (
            <button type="button" className="btn primary" disabled={selected.length < 2} onClick={compute}>
              {t('Compute agreement')}
            </button>
          )}
        </>
      )}

      {report && <Results report={report.report} models={report.models} labelMode={labelMode} onExport={exportCsv} />}
    </div>
  );
}

function Results({ report, models, labelMode, onExport }: { report: AgreementReport; models: TierModel[]; labelMode: LabelMode; onExport: () => void }) {
  const fmt = (v: number) => formatNumber(v, 3);
  return (
    <div className="results">
      <dl className="figures">
        <div>
          <dt>{labelMode === 'phonetic' ? t('Krippendorff’s α, phonetic distance') : t('Krippendorff’s α')}</dt>
          <dd>
            <strong>{fmt(report.alpha)}</strong>
            <span className="muted"> {t(interpretKappa(report.alpha))}</span>
          </dd>
        </div>
        {labelMode === 'phonetic' && (
          <div>
            <dt>{t('Krippendorff’s α, exact labels')}</dt>
            <dd>{fmt(report.alphaNominal)}</dd>
          </div>
        )}
        <div>
          <dt>{t('Fleiss’ κ')}</dt>
          <dd>{fmt(report.fleiss)}</dd>
        </div>
        <div>
          <dt>{report.type === 'interval' ? t('Boundary F1, mean of pairs') : t('Point F1, mean of pairs')}</dt>
          <dd>{fmt(report.meanF1)}</dd>
        </div>
      </dl>
      <p className="hint">
        {report.type === 'interval'
          ? t('α and κ are computed on {n} time frames; F1 counts boundaries placed within the tolerance of each other.', { n: report.frames })
          : t('Points within the tolerance form {n} events; labels are compared within events.', { n: report.frames })}
      </p>

      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              <th scope="col">{t('Pair')}</th>
              <th scope="col" className="num">F1</th>
              <th scope="col" className="num">|Δt| ms</th>
              <th scope="col" className="num">κ</th>
              <th scope="col" className="num">{t('κ weighted')}</th>
              {report.type === 'interval' && <th scope="col" className="num">IoU</th>}
              <th scope="col" className="num">{t('Same label')}</th>
            </tr>
          </thead>
          <tbody>
            {report.pairs.map((p) => (
              <tr key={`${p.a}-${p.b}`}>
                <td>
                  <span className="swatch" style={{ background: models[p.a].color }} />
                  <span className="swatch" style={{ background: models[p.b].color }} />
                  <span className="pair-names">
                    {models[p.a].author} / {models[p.b].author}
                  </span>
                </td>
                <td className="num">{formatNumber(p.timing.f1, 2)}</td>
                <td className="num">{formatNumber(p.timing.meanAbsDelta * 1000, 1)}</td>
                <td className="num">{formatNumber(p.kappa, 2)}</td>
                <td className="num">{formatNumber(p.weightedKappa, 2)}</td>
                {report.type === 'interval' && <td className="num">{formatNumber(p.segments?.meanIoU ?? NaN, 2)}</td>}
                <td className="num">{formatNumber(p.exactLabel * 100, 0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.type === 'interval' && (
        <div className="strip-legend">
          <span className="legend-labels" aria-hidden="true" />
          <span>{t('Labels that differ: the darker, the more different.')}</span>
          <span className="legend-boundary" aria-hidden="true" />
          <span>{t('A boundary that not every annotator placed (within the tolerance).')}</span>
        </div>
      )}
      <button type="button" className="btn small" onClick={onExport}>{t('Export as CSV')}</button>
    </div>
  );
}
