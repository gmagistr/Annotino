import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { waveformEnvelope } from '../../dsp/analysis';
import type { Analysis, AudioEngine } from '../../dsp/engine';
import { intervalIndexAt, moveBoundary, addBoundary, intervalsOf, type Shape, type Tier } from '../../model';
import { t as tr } from '../../i18n';
import { TRACK } from '../colors';
import { VISIBILITY_LABEL } from '../visibility';
import type {
  AgreementStrip,
  Layers,
  PitchRange,
  Selected,
  Selection,
  SketchModel,
  SpectrogramSettings,
  TierModel,
  Tool,
  ViewRange,
} from './types';

export const GUTTER = 176;
const WAVE_H = 84;
const TIER_H = 50;
const RULER_H = 26;
const STRIP_H = 22;
const HIT = 5;

interface Props {
  engine: AudioEngine;
  analysis: Analysis | null;
  view: ViewRange;
  setView: (v: ViewRange) => void;
  cursor: number;
  setCursor: (t: number) => void;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  tiers: TierModel[];
  sketches: SketchModel[];
  selected: Selected | null;
  setSelected: (s: Selected | null) => void;
  selectedShape: string | null;
  setSelectedShape: (id: string | null) => void;
  tool: Tool;
  layers: Layers;
  spec: SpectrogramSettings;
  specHeight: number;
  pitchRange: PitchRange;
  onTierChange: (docId: string, tier: Tier) => void;
  onShapeCommit: (shape: Shape) => void;
  onLabelFocus: () => void;
  strip: AgreementStrip | null;
  playhead: RefObject<HTMLDivElement | null>;
  canvasRefs: RefObject<Map<string, HTMLCanvasElement>>;
  onShapeDelete: (id: string) => void;
  /** Called when an interval is clicked, to play it. */
  onPlayRange: (a: number, b: number) => void;
  tagLane: LaneItem[];
  threadLane: LaneItem[];
  onLaneClick: (item: LaneItem) => void;
  /** When set, everything outside these spans is dimmed. */
  focusSpans: [number, number][] | null;
}

/** A tagged or discussed span drawn in its own lane (and as a box on the spectrogram when it has a band). */
export interface LaneItem {
  id: string;
  t0: number;
  t1: number;
  f0?: number;
  f1?: number;
  color: string;
  title: string;
  highlighted: boolean;
}

function useWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(0, el.clientWidth - GUTTER)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function setupCanvas(c: HTMLCanvasElement | null, w: number, h: number): CanvasRenderingContext2D | null {
  if (!c || w <= 0) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (c.width !== pw) c.width = pw;
  if (c.height !== ph) c.height = ph;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

export function Timeline(props: Props) {
  const { engine, analysis, view, setView, cursor, selection, tiers, sketches, selected, layers, spec, pitchRange, strip } = props;
  const root = useRef<HTMLDivElement>(null);
  const W = useWidth(root);
  const duration = engine.duration;
  const span = view.t1 - view.t0;
  const xOf = (t: number) => ((t - view.t0) / span) * W;
  const tOf = (x: number) => view.t0 + (x / W) * span;
  const yOfF = (f: number) => props.specHeight * (1 - f / spec.maxFrequency);
  const fOfY = (y: number) => (1 - y / props.specHeight) * spec.maxFrequency;

  const waveRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const tierRefs = useRef(new Map<string, HTMLCanvasElement>());
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    void document.fonts.ready.then(() => setFontsReady(true));
  }, []);

  // Expose canvases for image export.
  useEffect(() => {
    const m = props.canvasRefs.current;
    m.clear();
    if (specRef.current) m.set('spec', specRef.current);
    if (overRef.current) m.set('over', overRef.current);
    if (waveRef.current) m.set('wave', waveRef.current);
    if (rulerRef.current) m.set('ruler', rulerRef.current);
    for (const [k, v] of tierRefs.current) m.set(`tier:${k}`, v);
  });

  // ------------------------------------------------------------ waveform
  const envelope = useMemo(
    () => (W > 0 ? waveformEnvelope(engine.samples, engine.sampleRate, view.t0, view.t1, Math.round(W)) : null),
    [engine, view.t0, view.t1, W],
  );

  useEffect(() => {
    const ctx = setupCanvas(waveRef.current, W, WAVE_H);
    if (!ctx || !envelope) return;
    const mid = WAVE_H / 2;
    let peak = 0;
    for (const v of envelope) peak = Math.max(peak, Math.abs(v));
    const scale = (WAVE_H / 2 - 4) / Math.max(peak, 1e-4);
    ctx.strokeStyle = '#CDCDC8';
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(W, mid + 0.5);
    ctx.stroke();
    ctx.fillStyle = '#2B3440';
    const cols = envelope.length / 2;
    for (let c = 0; c < cols; c++) {
      const lo = envelope[2 * c];
      const hi = envelope[2 * c + 1];
      const y0 = mid - hi * scale;
      const y1 = mid - lo * scale;
      ctx.fillRect(c, y0, 1, Math.max(1, y1 - y0));
    }
  }, [envelope, W]);

  // ------------------------------------------------------------ spectrogram
  const [specImage, setSpecImage] = useState<{ canvas: HTMLCanvasElement; t0: number; t1: number } | null>(null);

  useEffect(() => {
    if (W <= 0) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const columns = Math.min(2400, Math.round(W * dpr));
      const rows = Math.min(400, Math.round(props.specHeight * dpr * 0.8));
      const res = await engine.spectrogram({
        t0: view.t0,
        t1: view.t1,
        columns,
        rows,
        windowLength: spec.windowLength,
        maxFrequency: spec.maxFrequency,
        dynamicRange: spec.dynamicRange,
        preEmphasis: true,
      });
      if (cancelled) return;
      const img = new ImageData(columns, rows);
      const d = res.data;
      for (let x = 0; x < columns; x++) {
        for (let r = 0; r < rows; r++) {
          const v = 255 - Math.round(d[x * rows + r] * 235);
          const o = ((rows - 1 - r) * columns + x) * 4;
          img.data[o] = v - 3;
          img.data[o + 1] = v - 1;
          img.data[o + 2] = v;
          img.data[o + 3] = 255;
        }
      }
      const off = document.createElement('canvas');
      off.width = columns;
      off.height = rows;
      off.getContext('2d')!.putImageData(img, 0, 0);
      setSpecImage({ canvas: off, t0: view.t0, t1: view.t1 });
    }, 40);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [engine, view.t0, view.t1, W, spec.windowLength, spec.maxFrequency, spec.dynamicRange, props.specHeight]);

  useEffect(() => {
    const ctx = setupCanvas(specRef.current, W, props.specHeight);
    if (!ctx) return;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, props.specHeight);
    if (!specImage) return;
    // Reuse the previous image, stretched, while a new one is computed.
    const x0 = xOf(specImage.t0);
    const x1 = xOf(specImage.t1);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(specImage.canvas, x0, 0, x1 - x0, props.specHeight);
  }, [specImage, view.t0, view.t1, W, props.specHeight]);

  // ------------------------------------------------------------ contours
  useEffect(() => {
    const ctx = setupCanvas(overRef.current, W, props.specHeight);
    if (!ctx || !analysis) return;
    const H = props.specHeight;
    const i0 = (track: { t0: number; step: number }) => Math.max(0, Math.floor((view.t0 - track.t0) / track.step) - 1);
    const i1 = (track: { t0: number; step: number; length: number }) =>
      Math.min(track.length, Math.ceil((view.t1 - track.t0) / track.step) + 1);

    const line = (track: { t0: number; step: number; values: Float32Array }, y: (v: number) => number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false;
      const a = i0(track);
      const b = i1({ ...track, length: track.values.length });
      for (let i = a; i < b; i++) {
        const v = track.values[i];
        if (!Number.isFinite(v)) {
          pen = false;
          continue;
        }
        const x = xOf(track.t0 + i * track.step);
        const yy = y(v);
        if (pen) ctx.lineTo(x, yy);
        else ctx.moveTo(x, yy);
        pen = true;
      }
      ctx.stroke();
    };

    if (layers.formants) {
      const fm = analysis.formants;
      ctx.fillStyle = TRACK.formants;
      const a = i0(fm);
      const b = i1({ ...fm, length: fm.count });
      const dot = span < 2 ? 2.2 : 1.6;
      for (let i = a; i < b; i++) {
        const x = xOf(fm.t0 + i * fm.step);
        for (let k = 0; k < fm.maxFormants; k++) {
          const f = fm.freqs[i * fm.maxFormants + k];
          const bw = fm.bandwidths[i * fm.maxFormants + k];
          if (!Number.isFinite(f) || f > spec.maxFrequency || bw > 500) continue;
          ctx.beginPath();
          ctx.arc(x, yOfF(f), dot, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (layers.intensity) {
      const vals = Array.from(analysis.intensity.values).filter(Number.isFinite);
      const max = Math.max(...vals, 1);
      const min = Math.max(Math.min(...vals), max - 60);
      line(analysis.intensity, (v) => H - 6 - ((v - min) / (max - min)) * (H - 12), TRACK.intensity, 1.6);
    }
    if (layers.rate) {
      line(analysis.rate.curve, (v) => H - 6 - (Math.min(v, 10) / 10) * (H - 12), TRACK.rate, 1.8);
      ctx.fillStyle = TRACK.rate;
      for (const n of analysis.rate.nuclei) {
        if (n < view.t0 || n > view.t1) continue;
        const x = xOf(n);
        ctx.beginPath();
        ctx.moveTo(x - 4, 0);
        ctx.lineTo(x + 4, 0);
        ctx.lineTo(x, 7);
        ctx.fill();
      }
    }
    if (layers.pitch) {
      const y = (v: number) => H * (1 - (v - pitchRange.min) / (pitchRange.max - pitchRange.min));
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      line(analysis.pitch, y, 'rgba(255,255,255,0.9)', 4.5);
      ctx.restore();
      line(analysis.pitch, y, TRACK.pitch, 2.2);
    }

    // Right-hand scale labels for the contours that use their own scale.
    ctx.font = '500 11px "Public Sans", system-ui, sans-serif';
    ctx.textAlign = 'right';
    const label = (text: string, y: number, color: string) => {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const w = ctx.measureText(text).width;
      ctx.fillRect(W - w - 8, y - 9, w + 6, 13);
      ctx.fillStyle = color;
      ctx.fillText(text, W - 5, y + 1);
    };
    if (layers.pitch) {
      label(`${pitchRange.max} Hz`, 12, TRACK.pitch);
      label(`${pitchRange.min} Hz`, H - 6, TRACK.pitch);
    }
    if (layers.rate && !layers.pitch) {
      label(tr('{n} syll/s', { n: 10 }), 12, TRACK.rate);
    }
  }, [analysis, layers, view.t0, view.t1, W, spec.maxFrequency, pitchRange, props.specHeight]);

  // ------------------------------------------------------------ tiers
  useEffect(() => {
    for (const m of tiers) {
      const c = tierRefs.current.get(m.doc.row.id);
      const ctx = setupCanvas(c ?? null, W, TIER_H);
      if (!ctx) continue;
      const tier = m.doc.content;
      ctx.font = '17px "Charis SIL", "Doulos SIL", "Gentium Plus", serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      if (tier.type === 'interval') {
        const ivs = intervalsOf(tier, duration);
        ivs.forEach((iv, i) => {
          if (iv.end < view.t0 || iv.start > view.t1) return;
          const x0 = Math.max(0, xOf(iv.start));
          const x1 = Math.min(W, xOf(iv.end));
          const isSel = selected?.docId === m.doc.row.id && selected.type === 'interval' && selected.index === i;
          if (isSel) {
            ctx.fillStyle = 'rgba(30, 74, 114, 0.12)';
            ctx.fillRect(x0, 0, x1 - x0, TIER_H);
          }
          if (iv.label) {
            ctx.fillStyle = '#1B1C1E';
            const maxW = x1 - x0 - 4;
            if (maxW > 6) {
              // Shrink the type before cutting; when cut, keep the beginning of the label.
              let size = 17;
              ctx.font = `${size}px "Charis SIL", "Doulos SIL", "Gentium Plus", serif`;
              while (size > 11 && ctx.measureText(iv.label).width > maxW) {
                size -= 1;
                ctx.font = `${size}px "Charis SIL", "Doulos SIL", "Gentium Plus", serif`;
              }
              let text = iv.label;
              if (ctx.measureText(text).width > maxW) {
                const chars = Array.from(iv.label);
                let n = chars.length;
                while (n > 1 && ctx.measureText(chars.slice(0, n).join('') + '…').width > maxW) n--;
                text = chars.slice(0, n).join('') + '…';
              }
              ctx.fillText(text, (x0 + x1) / 2, TIER_H / 2 + 1);
              ctx.font = '17px "Charis SIL", "Doulos SIL", "Gentium Plus", serif';
            }
          }
        });
        tier.boundaries.forEach((b, i) => {
          if (b < view.t0 || b > view.t1) return;
          const x = Math.round(xOf(b)) + 0.5;
          const isSel = selected?.docId === m.doc.row.id && selected.type === 'boundary' && selected.index === i;
          ctx.strokeStyle = isSel ? TRACK.cursor : m.color;
          ctx.lineWidth = isSel ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, TIER_H);
          ctx.stroke();
        });
      } else {
        tier.points.forEach((p, i) => {
          if (p.t < view.t0 || p.t > view.t1) return;
          const x = Math.round(xOf(p.t)) + 0.5;
          const isSel = selected?.docId === m.doc.row.id && selected.type === 'point' && selected.index === i;
          ctx.strokeStyle = isSel ? TRACK.cursor : m.color;
          ctx.lineWidth = isSel ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 12);
          ctx.moveTo(x, TIER_H - 12);
          ctx.lineTo(x, TIER_H);
          ctx.stroke();
          if (p.label) {
            ctx.fillStyle = '#1B1C1E';
            ctx.fillText(p.label, x, TIER_H / 2 + 1);
          }
        });
      }
    }
  }, [tiers, selected, view.t0, view.t1, W, duration, fontsReady]);

  // ------------------------------------------------------------ agreement strip
  useEffect(() => {
    const ctx = setupCanvas(stripRef.current, W, STRIP_H);
    if (!ctx || !strip) return;
    // Upper band: label disagreement per frame.
    const a = Math.max(0, Math.floor(view.t0 / strip.step));
    const b = Math.min(strip.labels.length, Math.ceil(view.t1 / strip.step));
    for (let i = a; i < b; i++) {
      const v = strip.labels[i];
      if (!Number.isFinite(v) || v <= 0) continue;
      ctx.fillStyle = `rgba(142, 44, 58, ${0.2 + 0.8 * v})`;
      const x0 = xOf(i * strip.step);
      const x1 = xOf((i + 1) * strip.step);
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), STRIP_H - 7);
    }
    // Lower band: boundaries that only some annotators placed.
    ctx.fillStyle = '#1B1C1E';
    for (const bd of strip.boundaries) {
      if (bd.t < view.t0 || bd.t > view.t1) continue;
      const x = xOf(bd.t);
      ctx.beginPath();
      ctx.moveTo(x - 5, STRIP_H);
      ctx.lineTo(x + 5, STRIP_H);
      ctx.lineTo(x, STRIP_H - 7);
      ctx.fill();
      ctx.fillRect(x - 0.75, 0, 1.5, STRIP_H - 7);
    }
  }, [strip, view.t0, view.t1, W]);

  // ------------------------------------------------------------ ruler
  useEffect(() => {
    const ctx = setupCanvas(rulerRef.current, W, RULER_H);
    if (!ctx) return;
    const step = niceStep(span, Math.max(2, W / 90));
    const digits = Math.max(0, -Math.floor(Math.log10(step)));
    ctx.strokeStyle = '#5B5E63';
    ctx.fillStyle = '#5B5E63';
    ctx.font = '500 11px "Public Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let tt = Math.ceil(view.t0 / step) * step; tt <= view.t1; tt += step) {
      const x = Math.round(xOf(tt)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 5);
      ctx.stroke();
      if (x > 14 && x < W - 14) ctx.fillText(tt.toFixed(digits), x, 8);
    }
  }, [view.t0, view.t1, W, span]);

  // ------------------------------------------------------------ pointer: waveform & spectrogram
  const drag = useRef<{ x: number; t: number; moved: boolean; shape?: Shape } | null>(null);

  const localX = (e: ReactPointerEvent) => e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
  const localY = (e: ReactPointerEvent) => e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;

  const onSignalDown = (e: ReactPointerEvent, isSpec: boolean) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const x = localX(e);
    const t = tOf(x);
    if (isSpec && props.tool !== 'select') {
      const f = fOfY(localY(e));
      const points: [number, number][] = props.tool === 'text' ? [[t, f]] : [[t, f], [t, f]];
      drag.current = { x, t, moved: props.tool === 'text', shape: { id: crypto.randomUUID(), kind: props.tool, points, note: '' } };
      return;
    }
    drag.current = { x, t, moved: false };
  };

  const [draft, setDraft] = useState<Shape | null>(null);

  const onSignalMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const x = localX(e);
    if (Math.abs(x - d.x) > 3) d.moved = true;
    const t = Math.max(0, Math.min(duration, tOf(x)));
    if (d.shape) {
      const f = Math.max(0, Math.min(spec.maxFrequency, fOfY(localY(e))));
      if (d.shape.kind === 'text') d.shape = { ...d.shape, points: [[t, f]] };
      else if (d.shape.kind === 'freehand') d.shape = { ...d.shape, points: [...d.shape.points, [t, f]] };
      else d.shape = { ...d.shape, points: [d.shape.points[0], [t, f]] };
      if (Math.abs(localY(e) - yOfF(d.shape.points[0][1])) > 3) d.moved = true;
      setDraft(d.shape);
      return;
    }
    if (d.moved) {
      props.setSelection({ a: Math.min(d.t, t), b: Math.max(d.t, t) });
      // A new time range replaces the selected tier interval, so the label field targets the range.
      if (props.selected) props.setSelected(null);
    }
  };

  const onSignalUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.shape) {
      setDraft(null);
      if (d.moved) props.onShapeCommit(d.shape);
      return;
    }
    if (!d.moved) {
      props.setCursor(Math.max(0, Math.min(duration, tOf(localX(e)))));
      props.setSelection(null);
      props.setSelected(null);
      props.setSelectedShape(null);
    }
  };

  // ------------------------------------------------------------ pointer: tiers
  const tierDrag = useRef<{ docId: string; index: number; kind: 'boundary' | 'point' } | null>(null);

  const hitTest = (m: TierModel, x: number): Selected | null => {
    const tier = m.doc.content;
    if (tier.type === 'interval') {
      let best = -1;
      let bestD = HIT + 1;
      tier.boundaries.forEach((b, i) => {
        const dd = Math.abs(xOf(b) - x);
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      });
      if (best >= 0) return { docId: m.doc.row.id, type: 'boundary', index: best };
      return { docId: m.doc.row.id, type: 'interval', index: intervalIndexAt(tier, tOf(x)) };
    }
    let best = -1;
    let bestD = HIT + 1;
    tier.points.forEach((p, i) => {
      const dd = Math.abs(xOf(p.t) - x);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    return best >= 0 ? { docId: m.doc.row.id, type: 'point', index: best } : null;
  };

  const onTierDown = (e: ReactPointerEvent, m: TierModel) => {
    if (e.button !== 0) return;
    const x = localX(e);
    const hit = hitTest(m, x);
    props.setSelected(hit);
    if (!hit) {
      props.setCursor(tOf(x));
      return;
    }
    if (hit.type === 'interval' && m.doc.content.type === 'interval') {
      const iv = intervalsOf(m.doc.content, duration)[hit.index];
      props.setSelection({ a: iv.start, b: iv.end });
      props.setCursor(iv.start);
      props.onPlayRange(iv.start, iv.end);
    } else if (m.editable && (hit.type === 'boundary' || hit.type === 'point')) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      tierDrag.current = { docId: m.doc.row.id, index: hit.index, kind: hit.type };
    }
    if (hit.type === 'point' && m.doc.content.type === 'point') props.setCursor(m.doc.content.points[hit.index].t);
  };

  const onTierDouble = (e: ReactMouseEvent, m: TierModel) => {
    if (!m.editable) return;
    const t = tOf(e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left);
    const tier = m.doc.content;
    if (tier.type === 'interval') {
      const next = addBoundary(tier, t, duration);
      if (next === tier) return;
      props.onTierChange(m.doc.row.id, next);
      props.setSelected({ docId: m.doc.row.id, type: 'interval', index: next.boundaries.indexOf(t) + 1 });
    } else {
      const points = [...tier.points, { t, label: '' }].sort((a, b) => a.t - b.t);
      props.onTierChange(m.doc.row.id, { ...tier, points });
      props.setSelected({ docId: m.doc.row.id, type: 'point', index: points.findIndex((p) => p.t === t) });
    }
    props.onLabelFocus();
  };

  const onTierMove = (e: ReactPointerEvent, m: TierModel) => {
    const d = tierDrag.current;
    if (!d || d.docId !== m.doc.row.id) return;
    const t = Math.max(0, Math.min(duration, tOf(localX(e))));
    const tier = m.doc.content;
    if (tier.type === 'interval' && d.kind === 'boundary') {
      props.onTierChange(m.doc.row.id, moveBoundary(tier, d.index, t));
    } else if (tier.type === 'point' && d.kind === 'point') {
      const points = tier.points.slice();
      const lo = d.index > 0 ? points[d.index - 1].t + 1e-3 : 0;
      const hi = d.index < points.length - 1 ? points[d.index + 1].t - 1e-3 : duration;
      points[d.index] = { ...points[d.index], t: Math.min(hi, Math.max(lo, t)) };
      props.onTierChange(m.doc.row.id, { ...tier, points });
    }
  };

  const onTierUp = () => {
    tierDrag.current = null;
  };

  // ------------------------------------------------------------ wheel: zoom and scroll
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - GUTTER;
      if (x < 0) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(e.deltaY * 0.01);
        const anchor = view.t0 + (x / W) * span;
        let ns = Math.min(duration, Math.max(0.01, span * factor));
        let t0 = anchor - ((anchor - view.t0) / span) * ns;
        t0 = Math.max(0, Math.min(duration - ns, t0));
        if (ns >= duration) {
          ns = duration;
          t0 = 0;
        }
        setView({ t0, t1: t0 + ns });
      } else {
        const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / W * span;
        const t0 = Math.max(0, Math.min(duration - span, view.t0 + delta));
        setView({ t0, t1: t0 + span });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view, W, span, duration, setView]);

  // ------------------------------------------------------------ scrollbar
  const barDrag = useRef<{ x: number; t0: number } | null>(null);
  const thumbLeft = (view.t0 / duration) * 100;
  const thumbWidth = Math.max(1.5, (span / duration) * 100);

  // ------------------------------------------------------------ sketches
  const shapePath = (s: Shape): string => {
    const pts = s.points.map(([t, f]) => [xOf(t), yOfF(f)]);
    const [a, b] = [pts[0], pts[pts.length - 1]];
    switch (s.kind) {
      case 'rect':
        return `M${a[0]},${a[1]} L${b[0]},${a[1]} L${b[0]},${b[1]} L${a[0]},${b[1]} Z`;
      case 'ellipse': {
        const cx = (a[0] + b[0]) / 2;
        const cy = (a[1] + b[1]) / 2;
        const rx = Math.abs(b[0] - a[0]) / 2;
        const ry = Math.abs(b[1] - a[1]) / 2;
        return `M${cx - rx},${cy} A${rx},${ry} 0 1,0 ${cx + rx},${cy} A${rx},${ry} 0 1,0 ${cx - rx},${cy} Z`;
      }
      case 'arrow': {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const h = 10;
        const l = [b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45)];
        const r = [b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)];
        return `M${a[0]},${a[1]} L${b[0]},${b[1]} M${l[0]},${l[1]} L${b[0]},${b[1]} L${r[0]},${r[1]}`;
      }
      case 'text':
        return '';
      default:
        return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
    }
  };

  const noteAnchor = (s: Shape): [number, number] => {
    const xs = s.points.map((p) => xOf(p[0]));
    const ys = s.points.map((p) => yOfF(p[1]));
    return [Math.max(...xs) + 4, Math.min(...ys) - 4];
  };

  const selX = selection ? [xOf(selection.a), xOf(selection.b)] : null;
  const cursorX = xOf(cursor);
  const freqTicks = useMemo(() => {
    const step = niceStep(spec.maxFrequency, 5);
    const out: number[] = [];
    for (let f = 0; f <= spec.maxFrequency; f += step) out.push(f);
    return out;
  }, [spec.maxFrequency]);

  return (
    <div className="timeline" ref={root} style={{ ['--gutter' as string]: `${GUTTER}px` }}>
      <div className="tl-row">
        <div className="tl-gutter">
          <span className="tl-name">{tr('Waveform')}</span>
        </div>
        <div
          className="tl-track signal"
          onPointerDown={(e) => onSignalDown(e, false)}
          onPointerMove={onSignalMove}
          onPointerUp={onSignalUp}
        >
          <canvas ref={waveRef} />
        </div>
      </div>

      <div className="tl-row">
        <div className="tl-gutter axis" style={{ height: props.specHeight }}>
          {freqTicks.map((f) => (
            <span key={f} className="tick" style={{ top: yOfF(f) }}>
              {f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`}
            </span>
          ))}
        </div>
        <div
          className={`tl-track signal spec tool-${props.tool}`}
          style={{ height: props.specHeight }}
          onPointerDown={(e) => onSignalDown(e, true)}
          onPointerMove={onSignalMove}
          onPointerUp={onSignalUp}
        >
          <canvas ref={specRef} />
          <canvas ref={overRef} className="overlay" />
          <svg className="sketch-layer" width={W} height={props.specHeight} role="img" aria-label={tr('Drawings on the spectrogram')}>
            {[...props.tagLane, ...props.threadLane]
              .filter((it) => it.highlighted && it.f0 !== undefined && it.f1 !== undefined)
              .map((it) => (
                <rect
                  key={`band-${it.id}`}
                  className="band"
                  x={xOf(it.t0)}
                  y={yOfF(it.f1!)}
                  width={Math.max(2, xOf(it.t1) - xOf(it.t0))}
                  height={Math.max(2, yOfF(it.f0!) - yOfF(it.f1!))}
                  stroke={it.color}
                />
              ))}
            {sketches.map((sk) =>
              sk.doc.content.shapes.map((s) => {
                const isSel = props.selectedShape === s.id;
                const [nx, ny] = noteAnchor(s);
                if (s.kind === 'text') {
                  const [tx, ty] = [xOf(s.points[0][0]), yOfF(s.points[0][1])];
                  return (
                    <g key={s.id} className={isSel ? 'shape text selected' : 'shape text'}>
                      <text
                        x={tx}
                        y={ty}
                        fill={sk.color}
                        className={s.note ? 'free-text' : 'free-text empty'}
                        onPointerDown={(e) => {
                          if (props.tool !== 'select') return;
                          e.stopPropagation();
                          props.setSelectedShape(s.id);
                        }}
                      >
                        {s.note || tr('Text')}
                      </text>
                      {isSel && sk.editable && (
                        <DeleteHandle x={tx - 12} y={ty - 22} onDelete={() => props.onShapeDelete(s.id)} />
                      )}
                    </g>
                  );
                }
                const xs = s.points.map((p) => xOf(p[0]));
                const ys = s.points.map((p) => yOfF(p[1]));
                return (
                  <g key={s.id} className={isSel ? 'shape selected' : 'shape'}>
                    {isSel && sk.editable && (
                      <DeleteHandle x={Math.min(W - 12, Math.max(...xs) + 2)} y={Math.max(12, Math.min(...ys) - 2)} onDelete={() => props.onShapeDelete(s.id)} />
                    )}
                    <path
                      d={shapePath(s)}
                      stroke={sk.color}
                      strokeDasharray={sk.editable ? undefined : '6 4'}
                      fill={s.kind === 'freehand' || s.kind === 'arrow' ? 'none' : `${sk.color}14`}
                      onPointerDown={(e) => {
                        if (props.tool !== 'select') return;
                        e.stopPropagation();
                        props.setSelectedShape(s.id);
                      }}
                    />
                    {s.note && (
                      <text x={Math.min(nx, W - 4)} y={Math.max(14, ny)} fill={sk.color} textAnchor={nx > W - 120 ? 'end' : 'start'}>
                        {s.note.length > 40 ? `${s.note.slice(0, 39)}…` : s.note}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
            {draft && draft.kind !== 'text' && <path className="shape draft" d={shapePath(draft)} />}
          </svg>
        </div>
      </div>

      {tiers.map((m) => (
        <div className="tl-row tier-row" key={m.doc.row.id}>
          <div className="tl-gutter tier-gutter" style={{ ['--c' as string]: m.color }}>
            <span className="tl-name">{m.doc.content.name}</span>
            <span className="tl-meta">{m.author}</span>
            {m.editable && <span className="tl-vis">{tr(VISIBILITY_LABEL[m.doc.row.visibility])}</span>}
          </div>
          <div
            className={`tl-track tier ${m.editable ? 'editable' : 'readonly'}`}
            onPointerDown={(e) => onTierDown(e, m)}
            onPointerMove={(e) => onTierMove(e, m)}
            onPointerUp={onTierUp}
            onDoubleClick={(e) => onTierDouble(e, m)}
          >
            <canvas
              ref={(c) => {
                if (c) tierRefs.current.set(m.doc.row.id, c);
                else tierRefs.current.delete(m.doc.row.id);
              }}
            />
          </div>
        </div>
      ))}

      {props.tagLane.length > 0 && (
        <Lane label={tr('Tags')} items={props.tagLane} xOf={xOf} W={W} onClick={props.onLaneClick} kind="tag" />
      )}
      {props.threadLane.length > 0 && (
        <Lane label={tr('Discussions')} items={props.threadLane} xOf={xOf} W={W} onClick={props.onLaneClick} kind="thread" />
      )}

      {strip && (
        <div className="tl-row">
          <div className="tl-gutter">
            <span className="tl-meta">{tr('Disagreement')}</span>
          </div>
          <div className="tl-track strip">
            <canvas ref={stripRef} />
          </div>
        </div>
      )}

      <div className="tl-row">
        <div className="tl-gutter">
          <span className="tl-meta">{tr('Time (s)')}</span>
        </div>
        <div className="tl-track ruler">
          <canvas ref={rulerRef} />
        </div>
      </div>

      <div className="tl-row">
        <div className="tl-gutter" />
        <div
          className="tl-scroll"
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = (e.clientX - rect.left) / rect.width;
            const target = e.target as HTMLElement;
            if (!target.classList.contains('tl-thumb')) {
              const t0 = Math.max(0, Math.min(duration - span, frac * duration - span / 2));
              setView({ t0, t1: t0 + span });
            }
            e.currentTarget.setPointerCapture(e.pointerId);
            barDrag.current = { x: e.clientX, t0: view.t0 };
          }}
          onPointerMove={(e) => {
            const d = barDrag.current;
            if (!d) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const dt = ((e.clientX - d.x) / rect.width) * duration;
            const t0 = Math.max(0, Math.min(duration - span, d.t0 + dt));
            setView({ t0, t1: t0 + span });
          }}
          onPointerUp={() => (barDrag.current = null)}
        >
          <div className="tl-thumb" style={{ left: `${thumbLeft}%`, width: `${thumbWidth}%` }} />
        </div>
      </div>

      {/* Selection, cursor and playhead across all rows */}
      <div className="tl-overlay" aria-hidden="true">
        {selX && selX[1] > 0 && selX[0] < W && (
          <div className="tl-selection" style={{ left: Math.max(0, selX[0]), width: Math.min(W, selX[1]) - Math.max(0, selX[0]) }} />
        )}
        {props.focusSpans &&
          complement(props.focusSpans, view.t0, view.t1).map(([a, b]) => (
            <div key={a} className="tl-veil" style={{ left: xOf(a), width: Math.max(0, xOf(b) - xOf(a)) }} />
          ))}
        {cursorX >= 0 && cursorX <= W && <div className="tl-cursor" style={{ left: cursorX }} />}
        <div className="tl-playhead" ref={props.playhead} />
      </div>
    </div>
  );
}

function complement(spans: [number, number][], t0: number, t1: number): [number, number][] {
  const sorted = spans.slice().sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = t0;
  for (const [a, b] of sorted) {
    if (b <= cur) continue;
    if (a > cur) out.push([cur, Math.min(a, t1)]);
    cur = Math.max(cur, b);
    if (cur >= t1) break;
  }
  if (cur < t1) out.push([cur, t1]);
  return out;
}

function DeleteHandle({ x, y, onDelete }: { x: number; y: number; onDelete: () => void }) {
  return (
    <g
      className="delete-handle"
      transform={`translate(${x},${y})`}
      role="button"
      aria-label={tr('Delete drawing')}
      onPointerDown={(e) => {
        e.stopPropagation();
        onDelete();
      }}
    >
      <title>{tr('Delete drawing')}</title>
      <circle r="9" cx="9" cy="9" />
      <path d="M5.5 5.5 L12.5 12.5 M12.5 5.5 L5.5 12.5" />
    </g>
  );
}

function Lane({
  label,
  items,
  xOf,
  W,
  onClick,
  kind,
}: {
  label: string;
  items: LaneItem[];
  xOf: (t: number) => number;
  W: number;
  onClick: (it: LaneItem) => void;
  kind: 'tag' | 'thread';
}) {
  return (
    <div className="tl-row lane-row">
      <div className="tl-gutter">
        <span className="tl-meta">{label}</span>
      </div>
      <div className={`tl-track lane ${kind}`}>
        {items.map((it) => {
          const x0 = xOf(it.t0);
          const x1 = Math.max(x0 + 6, xOf(it.t1));
          if (x1 < 0 || x0 > W) return null;
          return (
            <button
              key={it.id}
              type="button"
              className={`lane-item ${it.highlighted ? 'on' : ''}`}
              style={{ left: Math.max(0, x0), width: Math.min(W, x1) - Math.max(0, x0), ['--tag' as string]: it.color }}
              title={it.title}
              onClick={() => onClick(it)}
            >
              {x1 - x0 > 60 ? it.title : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
