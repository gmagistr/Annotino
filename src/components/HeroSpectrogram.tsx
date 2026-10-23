import { useEffect, useMemo, useRef, useState } from 'react';
import { pitch, spectrogram } from '../dsp/analysis';
import { ANNOTINO, synthesise } from '../dsp/synth';
import { t } from '../i18n';

const SR = 16000;
const MAX_F = 5000;

/** Segment labels for the synthetic /anːoˈtiːno/, aligned with ANNOTINO. */
const LABELS = ['', 'a', 'nː', 'o', 't', '', 'iː', 'n', 'o', ''];

/**
 * A real analysis of a synthesised recording of the app's name — the same
 * spectrogram, pitch and interval tier the editor draws.
 */
export function HeroSpectrogram() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [playing, setPlaying] = useState(false);
  const signal = useMemo(() => synthesise(ANNOTINO, SR), []);
  const f0 = useMemo(() => pitch(signal, SR, { minPitch: 100, maxPitch: 400 }), [signal]);
  const duration = signal.length / SR;

  const segments = useMemo(() => {
    let t0 = 0;
    const out: { start: number; end: number; label: string }[] = [];
    ANNOTINO.forEach((s, i) => {
      out.push({ start: t0, end: t0 + s.dur, label: LABELS[i] });
      t0 += s.dur;
    });
    // Merge the stop closure with its burst: [t] spans both.
    out[4] = { ...out[4], end: out[5].end };
    out.splice(5, 1);
    return out.filter((s) => s.label);
  }, []);

  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const h = 200;
    c.width = Math.round(width * dpr);
    c.height = Math.round(h * dpr);
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d')!;
    const cols = c.width;
    const rows = 180;
    const data = spectrogram(signal, SR, {
      t0: 0,
      t1: duration,
      columns: cols,
      rows,
      windowLength: 0.005,
      maxFrequency: MAX_F,
      dynamicRange: 48,
      preEmphasis: true,
    });
    const img = ctx.createImageData(cols, rows);
    for (let x = 0; x < cols; x++) {
      for (let r = 0; r < rows; r++) {
        const v = 255 - Math.round(data[x * rows + r] * 225);
        const o = ((rows - 1 - r) * cols + x) * 4;
        // Very slightly cool grey, to sit on the paper tone.
        img.data[o] = v - 3;
        img.data[o + 1] = v - 1;
        img.data[o + 2] = v;
        img.data[o + 3] = 255;
      }
    }
    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, c.width, c.height);

    // Pitch, on a 100–300 Hz scale.
    ctx.strokeStyle = '#1F5FA8';
    ctx.lineWidth = 2.2 * dpr;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    f0.values.forEach((v, i) => {
      const tt = f0.t0 + i * f0.step;
      if (!Number.isFinite(v) || v > 320) {
        pen = false;
        return;
      }
      const x = (tt / duration) * c.width;
      const y = c.height * (1 - (v - 100) / 200);
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    });
    ctx.stroke();
  }, [width, signal, f0, duration]);

  const play = async () => {
    if (playing) return;
    const ac = new AudioContext();
    const buf = ac.createBuffer(1, signal.length, SR);
    buf.copyToChannel(new Float32Array(signal), 0);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    setPlaying(true);
    src.onended = () => {
      setPlaying(false);
      void ac.close();
    };
    src.start();
  };

  return (
    <figure className="hero-spec">
      <button type="button" className="hero-spec-plot" onClick={play} aria-label={t('Play the recording')}>
        <canvas ref={canvas} />
        <span className="hero-spec-axis top">{MAX_F} Hz</span>
        <span className="hero-spec-axis bottom">0 Hz</span>
      </button>
      <div className="hero-tier" aria-hidden="true">
        {segments.map((s) => (
          <span
            key={s.start}
            className="hero-seg"
            style={{ left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%` }}
          >
            {s.label}
          </span>
        ))}
      </div>
      <figcaption>
        <strong>{t('Figure 1.')}</strong>{' '}
        {playing ? t('Playing…') : t('Synthesised in your browser and analysed with the same code as the editor. Click to listen.')}
      </figcaption>
    </figure>
  );
}
