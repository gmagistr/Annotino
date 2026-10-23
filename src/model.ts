/** Decrypted annotation content. */

export interface IntervalTier {
  type: 'interval';
  name: string;
  /** Interior boundaries, ascending, strictly inside (0, duration). */
  boundaries: number[];
  /** One label per interval: boundaries.length + 1 entries. */
  labels: string[];
}

export interface PointTier {
  type: 'point';
  name: string;
  points: { t: number; label: string }[];
}

export type Tier = IntervalTier | PointTier;

export type ShapeKind = 'ellipse' | 'rect' | 'freehand' | 'arrow' | 'text';

/** A mark drawn on the spectrogram, in time (s) × frequency (Hz) coordinates. */
export interface Shape {
  id: string;
  kind: ShapeKind;
  points: [number, number][];
  note: string;
}

export interface Sketch {
  shapes: Shape[];
}

/**
 * Where something points to in a recording: a time span, optionally a
 * frequency band (a part of the spectrogram), and what it was made from.
 */
export interface Anchor {
  recordingId: string;
  t0: number;
  t1: number;
  f0?: number;
  f1?: number;
  /** Set when the anchor is a tier interval or point. */
  tierName?: string;
  label?: string;
  /** Set when the anchor is a drawing. */
  shapeId?: string;
}

/** A flag from the team vocabulary, defined in the annotation guide. */
export interface TagDef {
  id: string;
  name: string;
  color: string;
  description: string;
}

export interface TagItem {
  id: string;
  anchor: Anchor;
  tags: string[];
}

/** One author's tags on one recording. */
export interface TagSet {
  items: TagItem[];
}

export interface Message {
  id: string;
  author: string;
  at: string;
  text: string;
  /** User ids mentioned with @. */
  mentions: string[];
}

/** A discussion about a part of a recording. Open threads mark zones that need discussion. */
export interface Thread {
  anchor: Anchor;
  status: 'open' | 'resolved';
  messages: Message[];
}

/** The team's annotation rules: free text with references, and the tag vocabulary. */
export interface Guide {
  body: string;
  tags: TagDef[];
}

export const TAG_COLORS = ['#8E2C3A', '#1E4A72', '#2F7D5B', '#A0740C', '#5B3F8C', '#24727E', '#9A4F1E', '#59626E'];

export function defaultGuide(t: (s: string) => string): Guide {
  return {
    body: '',
    tags: [
      { id: 'discuss', name: t('to discuss'), color: TAG_COLORS[0], description: t('The team should look at this together.') },
      { id: 'uncertain', name: t('uncertain'), color: TAG_COLORS[3], description: t('The annotator is not sure of the label or the boundaries.') },
      { id: 'example', name: t('example'), color: TAG_COLORS[2], description: t('A clear case to cite in the guidelines.') },
      { id: 'noise', name: t('noise or overlap'), color: TAG_COLORS[7], description: t('Background noise or overlapping speech.') },
    ],
  };
}

export function anchorLabel(a: Anchor, fmt: (x: number) => string): string {
  const time = `${fmt(a.t0)}–${fmt(a.t1)} s`;
  const band = a.f0 !== undefined && a.f1 !== undefined ? `, ${Math.round(a.f0)}–${Math.round(a.f1)} Hz` : '';
  return a.label ? `[${a.label}] ${time}${band}` : `${time}${band}`;
}

/** Two anchors denote the same target. */
export function sameAnchor(a: Anchor, b: Anchor): boolean {
  if (a.recordingId !== b.recordingId) return false;
  if (a.shapeId || b.shapeId) return a.shapeId === b.shapeId;
  return Math.abs(a.t0 - b.t0) < 1e-4 && Math.abs(a.t1 - b.t1) < 1e-4 && (a.tierName ?? '') === (b.tierName ?? '');
}

export interface RecordingMeta {
  name: string;
  duration: number;
  sampleRate: number;
  channels: number;
  size: number;
  speaker?: string;
  notes?: string;
}

export interface Interval {
  start: number;
  end: number;
  label: string;
}

export function intervalsOf(tier: IntervalTier, duration: number): Interval[] {
  const edges = [0, ...tier.boundaries, duration];
  return tier.labels.map((label, i) => ({ start: edges[i], end: edges[i + 1], label }));
}

export function emptyIntervalTier(name: string): IntervalTier {
  return { type: 'interval', name, boundaries: [], labels: [''] };
}

export function emptyPointTier(name: string): PointTier {
  return { type: 'point', name, points: [] };
}

/** Insert a boundary at t, splitting the interval that contains it (label stays on the left part). */
export function addBoundary(tier: IntervalTier, t: number, duration: number): IntervalTier {
  if (t <= 0 || t >= duration || tier.boundaries.some((b) => Math.abs(b - t) < 1e-4)) return tier;
  const i = tier.boundaries.findIndex((b) => b > t);
  const at = i === -1 ? tier.boundaries.length : i;
  const boundaries = [...tier.boundaries.slice(0, at), t, ...tier.boundaries.slice(at)];
  const labels = [...tier.labels.slice(0, at + 1), '', ...tier.labels.slice(at + 1)];
  return { ...tier, boundaries, labels };
}

/** Remove boundary i, merging the labels of the two intervals it separated. */
export function removeBoundary(tier: IntervalTier, i: number): IntervalTier {
  const left = tier.labels[i];
  const right = tier.labels[i + 1];
  const merged = left && right ? `${left} ${right}` : left || right;
  return {
    ...tier,
    boundaries: tier.boundaries.filter((_, k) => k !== i),
    labels: [...tier.labels.slice(0, i), merged, ...tier.labels.slice(i + 2)],
  };
}

export function moveBoundary(tier: IntervalTier, i: number, t: number): IntervalTier {
  const lo = i > 0 ? tier.boundaries[i - 1] + 1e-3 : 1e-3;
  const hi = i < tier.boundaries.length - 1 ? tier.boundaries[i + 1] - 1e-3 : Infinity;
  const boundaries = tier.boundaries.slice();
  boundaries[i] = Math.min(hi, Math.max(lo, t));
  return { ...tier, boundaries };
}

export function intervalIndexAt(tier: IntervalTier, t: number): number {
  const i = tier.boundaries.findIndex((b) => b > t);
  return i === -1 ? tier.boundaries.length : i;
}
