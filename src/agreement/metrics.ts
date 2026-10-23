/**
 * Inter-annotator agreement measures.
 *
 * Which measure fits depends on what is being compared:
 *  - Boundary placement (interval tiers): tolerance-window matching → precision,
 *    recall, F1 and timing deviation.
 *  - Labels over time (interval tiers): Krippendorff's α on time frames, with a
 *    nominal or a feature-based phonetic distance; Cohen's κ (2 annotators) and
 *    Fleiss' κ (n annotators) as nominal references.
 *  - Segments (interval tiers): interval matching by overlap → mean IoU and label
 *    agreement on matched segments.
 *  - Events (point tiers): tolerance-window matching → F1, timing deviation, and
 *    label agreement on matched points.
 */

import { intervalsOf, type Interval, type IntervalTier, type PointTier } from '../model';

export type Distance = (a: string, b: string) => number;

// ---------------------------------------------------------------- matching

export interface Match {
  a: number;
  b: number;
  delta: number;
}

/** One-to-one matching of time points within a tolerance, closest pairs first. */
export function matchTimes(a: number[], b: number[], tolerance: number): Match[] {
  const pairs: Match[] = [];
  let start = 0;
  const sb = b.map((t, i) => ({ t, i })).sort((x, y) => x.t - y.t);
  const sa = a.map((t, i) => ({ t, i })).sort((x, y) => x.t - y.t);
  for (const x of sa) {
    while (start < sb.length && sb[start].t < x.t - tolerance) start++;
    for (let k = start; k < sb.length && sb[k].t <= x.t + tolerance; k++) {
      pairs.push({ a: x.i, b: sb[k].i, delta: sb[k].t - x.t });
    }
  }
  pairs.sort((p, q) => Math.abs(p.delta) - Math.abs(q.delta));
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out: Match[] = [];
  for (const p of pairs) {
    if (usedA.has(p.a) || usedB.has(p.b)) continue;
    usedA.add(p.a);
    usedB.add(p.b);
    out.push(p);
  }
  return out.sort((p, q) => a[p.a] - a[q.a]);
}

export interface TimingAgreement {
  countA: number;
  countB: number;
  matched: number;
  precision: number;
  recall: number;
  f1: number;
  meanAbsDelta: number;
  rmse: number;
  matches: Match[];
}

/** Precision/recall of B against A (symmetric F1). */
export function timingAgreement(a: number[], b: number[], tolerance: number): TimingAgreement {
  const matches = matchTimes(a, b, tolerance);
  const m = matches.length;
  const precision = b.length ? m / b.length : a.length ? 0 : 1;
  const recall = a.length ? m / a.length : b.length ? 0 : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const meanAbsDelta = m ? matches.reduce((s, x) => s + Math.abs(x.delta), 0) / m : NaN;
  const rmse = m ? Math.sqrt(matches.reduce((s, x) => s + x.delta * x.delta, 0) / m) : NaN;
  return { countA: a.length, countB: b.length, matched: m, precision, recall, f1, meanAbsDelta, rmse, matches };
}

// ---------------------------------------------------------------- Krippendorff's alpha

/**
 * Krippendorff's α for any number of coders, missing values allowed.
 * `units[u][c]` is coder c's value for unit u, or null when missing.
 */
export function krippendorffAlpha(units: (string | null)[][], distance: Distance): number {
  const values = new Map<string, number>();
  const index = (v: string) => {
    let i = values.get(v);
    if (i === undefined) {
      i = values.size;
      values.set(v, i);
    }
    return i;
  };
  // Coincidence matrix, accumulated sparsely.
  const o = new Map<number, number>();
  const key = (i: number, j: number) => i * 1_000_003 + j;
  for (const unit of units) {
    const vs = unit.filter((v): v is string => v !== null);
    const m = vs.length;
    if (m < 2) continue;
    const counts = new Map<number, number>();
    for (const v of vs) {
      const i = index(v);
      counts.set(i, (counts.get(i) ?? 0) + 1);
    }
    for (const [i, ni] of counts) {
      for (const [j, nj] of counts) {
        const pairs = i === j ? ni * (ni - 1) : ni * nj;
        if (pairs) o.set(key(i, j), (o.get(key(i, j)) ?? 0) + pairs / (m - 1));
      }
    }
  }
  const labels = Array.from(values.keys());
  const k = labels.length;
  const nc = new Float64Array(k);
  for (const [kk, v] of o) nc[Math.floor(kk / 1_000_003)] += v;
  const n = nc.reduce((s, x) => s + x, 0);
  if (n <= 1) return NaN;
  const dist = new Float64Array(k * k);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) dist[i * k + j] = i === j ? 0 : distance(labels[i], labels[j]);
  let dObs = 0;
  for (const [kk, v] of o) {
    const i = Math.floor(kk / 1_000_003);
    const j = kk % 1_000_003;
    dObs += v * dist[i * k + j];
  }
  dObs /= n;
  let dExp = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) dExp += nc[i] * nc[j] * dist[i * k + j];
  dExp /= n * (n - 1);
  if (dExp === 0) return dObs === 0 ? 1 : NaN;
  return 1 - dObs / dExp;
}

// ---------------------------------------------------------------- kappas

/** Cohen's κ for two coders over paired values; with a distance it is the weighted κ. */
export function cohenKappa(a: string[], b: string[], distance?: Distance): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return NaN;
  const d = distance ?? ((x: string, y: string) => (x === y ? 0 : 1));
  const ca = new Map<string, number>();
  const cb = new Map<string, number>();
  let obs = 0;
  for (let i = 0; i < n; i++) {
    ca.set(a[i], (ca.get(a[i]) ?? 0) + 1);
    cb.set(b[i], (cb.get(b[i]) ?? 0) + 1);
    obs += d(a[i], b[i]);
  }
  obs /= n;
  let exp = 0;
  for (const [x, nx] of ca) for (const [y, ny] of cb) exp += (nx / n) * (ny / n) * d(x, y);
  if (exp === 0) return obs === 0 ? 1 : NaN;
  return 1 - obs / exp;
}

/** Fleiss' κ; every unit must carry the same number (≥ 2) of ratings. */
export function fleissKappa(units: string[][]): number {
  const full = units.filter((u) => u.length >= 2);
  if (full.length === 0) return NaN;
  const r = full[0].length;
  if (full.some((u) => u.length !== r)) return NaN;
  const totals = new Map<string, number>();
  let pBar = 0;
  for (const u of full) {
    const counts = new Map<string, number>();
    for (const v of u) counts.set(v, (counts.get(v) ?? 0) + 1);
    let s = 0;
    for (const [v, c] of counts) {
      s += c * (c - 1);
      totals.set(v, (totals.get(v) ?? 0) + c);
    }
    pBar += s / (r * (r - 1));
  }
  pBar /= full.length;
  let pe = 0;
  for (const c of totals.values()) pe += (c / (full.length * r)) ** 2;
  if (pe === 1) return pBar === 1 ? 1 : NaN;
  return (pBar - pe) / (1 - pe);
}

// ---------------------------------------------------------------- frames

export const EMPTY = '∅';

/**
 * Sample each tier every `step` seconds. Unlabelled stretches become EMPTY when
 * `gapsAsCategory`, otherwise null (missing).
 */
export function frameUnits(tiers: IntervalTier[], duration: number, step: number, gapsAsCategory: boolean): (string | null)[][] {
  const count = Math.max(1, Math.floor(duration / step));
  const all = tiers.map((t) => intervalsOf(t, duration));
  const pos = all.map(() => 0);
  const units: (string | null)[][] = [];
  for (let f = 0; f < count; f++) {
    const t = (f + 0.5) * step;
    units.push(
      all.map((ivs, c) => {
        while (pos[c] < ivs.length - 1 && ivs[pos[c]].end <= t) pos[c]++;
        const label = ivs[pos[c]]?.label.trim() ?? '';
        return label ? label : gapsAsCategory ? EMPTY : null;
      }),
    );
  }
  return units;
}

// ---------------------------------------------------------------- segments

export interface SegmentAgreement {
  segmentsA: number;
  segmentsB: number;
  matched: number;
  meanIoU: number;
  exactLabel: number;
  meanLabelSimilarity: number;
  pairs: { a: Interval; b: Interval; iou: number; distance: number }[];
}

/** Match labelled intervals of two tiers by overlap (one-to-one, largest IoU first). */
export function segmentAgreement(a: IntervalTier, b: IntervalTier, duration: number, distance: Distance, minIoU = 0.1): SegmentAgreement {
  const A = intervalsOf(a, duration).filter((x) => x.label.trim());
  const B = intervalsOf(b, duration).filter((x) => x.label.trim());
  const cands: { i: number; j: number; iou: number }[] = [];
  let j0 = 0;
  for (let i = 0; i < A.length; i++) {
    while (j0 < B.length && B[j0].end <= A[i].start) j0++;
    for (let j = j0; j < B.length && B[j].start < A[i].end; j++) {
      const inter = Math.min(A[i].end, B[j].end) - Math.max(A[i].start, B[j].start);
      const union = Math.max(A[i].end, B[j].end) - Math.min(A[i].start, B[j].start);
      const iou = inter / union;
      if (iou >= minIoU) cands.push({ i, j, iou });
    }
  }
  cands.sort((x, y) => y.iou - x.iou);
  const ua = new Set<number>();
  const ub = new Set<number>();
  const pairs: SegmentAgreement['pairs'] = [];
  for (const c of cands) {
    if (ua.has(c.i) || ub.has(c.j)) continue;
    ua.add(c.i);
    ub.add(c.j);
    pairs.push({ a: A[c.i], b: B[c.j], iou: c.iou, distance: distance(A[c.i].label.trim(), B[c.j].label.trim()) });
  }
  pairs.sort((x, y) => x.a.start - y.a.start);
  const m = pairs.length;
  return {
    segmentsA: A.length,
    segmentsB: B.length,
    matched: m,
    meanIoU: m ? pairs.reduce((s, p) => s + p.iou, 0) / m : NaN,
    exactLabel: m ? pairs.filter((p) => p.a.label.trim() === p.b.label.trim()).length / m : NaN,
    meanLabelSimilarity: m ? 1 - pairs.reduce((s, p) => s + p.distance, 0) / m : NaN,
    pairs,
  };
}

// ---------------------------------------------------------------- reports

export interface PairReport {
  a: number;
  b: number;
  timing: TimingAgreement;
  /** Interval tiers only. */
  segments?: SegmentAgreement;
  /** Label agreement on matched points (point tiers) or on frames (interval tiers). */
  kappa: number;
  weightedKappa: number;
  exactLabel: number;
}

export interface AgreementReport {
  type: 'interval' | 'point';
  annotators: number;
  alpha: number;
  alphaNominal: number;
  fleiss: number;
  meanF1: number;
  pairs: PairReport[];
  frames: number;
}

export interface AgreementOptions {
  tolerance: number; // seconds
  frameStep: number; // seconds
  gapsAsCategory: boolean;
  distance: Distance;
}

export function intervalAgreement(tiers: IntervalTier[], duration: number, opts: AgreementOptions): AgreementReport {
  const nominal: Distance = (x, y) => (x === y ? 0 : 1);
  const units = frameUnits(tiers, duration, opts.frameStep, opts.gapsAsCategory);
  const pairs: PairReport[] = [];
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const both = units.filter((u) => u[i] !== null && u[j] !== null);
      const la = both.map((u) => u[i]!);
      const lb = both.map((u) => u[j]!);
      pairs.push({
        a: i,
        b: j,
        timing: timingAgreement(tiers[i].boundaries, tiers[j].boundaries, opts.tolerance),
        segments: segmentAgreement(tiers[i], tiers[j], duration, opts.distance),
        kappa: cohenKappa(la, lb),
        weightedKappa: cohenKappa(la, lb, opts.distance),
        exactLabel: la.length ? la.filter((x, k) => x === lb[k]).length / la.length : NaN,
      });
    }
  }
  const complete = units.filter((u) => u.every((v) => v !== null)) as string[][];
  return {
    type: 'interval',
    annotators: tiers.length,
    alpha: krippendorffAlpha(units, opts.distance),
    alphaNominal: krippendorffAlpha(units, nominal),
    fleiss: tiers.length >= 2 ? fleissKappa(complete) : NaN,
    meanF1: pairs.length ? pairs.reduce((s, p) => s + p.timing.f1, 0) / pairs.length : NaN,
    pairs,
    frames: units.length,
  };
}

/**
 * Point tiers: events are clustered across annotators (each event of the first
 * annotator that others matched forms a unit), then labels are compared within units.
 */
export function pointAgreement(tiers: PointTier[], opts: AgreementOptions): AgreementReport {
  const nominal: Distance = (x, y) => (x === y ? 0 : 1);
  const pairs: PairReport[] = [];
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const ta = tiers[i].points.map((p) => p.t);
      const tb = tiers[j].points.map((p) => p.t);
      const timing = timingAgreement(ta, tb, opts.tolerance);
      const la = timing.matches.map((m) => tiers[i].points[m.a].label.trim() || EMPTY);
      const lb = timing.matches.map((m) => tiers[j].points[m.b].label.trim() || EMPTY);
      pairs.push({
        a: i,
        b: j,
        timing,
        kappa: cohenKappa(la, lb),
        weightedKappa: cohenKappa(la, lb, opts.distance),
        exactLabel: la.length ? la.filter((x, k) => x === lb[k]).length / la.length : NaN,
      });
    }
  }
  // Build units by single-linkage clustering of all points within the tolerance.
  const all = tiers.flatMap((t, c) => t.points.map((p) => ({ t: p.t, c, label: p.label.trim() || EMPTY }))).sort((x, y) => x.t - y.t);
  const units: (string | null)[][] = [];
  let cur: typeof all = [];
  const flush = () => {
    if (!cur.length) return;
    const unit: (string | null)[] = tiers.map(() => null);
    for (const p of cur) if (unit[p.c] === null) unit[p.c] = p.label;
    units.push(unit);
    cur = [];
  };
  for (const p of all) {
    if (cur.length && (p.t - cur[cur.length - 1].t > opts.tolerance || cur.some((q) => q.c === p.c))) flush();
    cur.push(p);
  }
  flush();
  const complete = units.filter((u) => u.every((v) => v !== null)) as string[][];
  return {
    type: 'point',
    annotators: tiers.length,
    alpha: krippendorffAlpha(units, opts.distance),
    alphaNominal: krippendorffAlpha(units, nominal),
    fleiss: fleissKappa(complete),
    meanF1: pairs.length ? pairs.reduce((s, p) => s + p.timing.f1, 0) / pairs.length : NaN,
    pairs,
    frames: units.length,
  };
}

/** Landis & Koch (1977) verbal scale, for orientation only. */
export function interpretKappa(v: number): string {
  if (!Number.isFinite(v)) return 'not defined';
  if (v < 0) return 'poor';
  if (v <= 0.2) return 'slight';
  if (v <= 0.4) return 'fair';
  if (v <= 0.6) return 'moderate';
  if (v <= 0.8) return 'substantial';
  return 'almost perfect';
}
