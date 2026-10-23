import { fft, gaussianWindow, hannWindow, nextPow2 } from './fft';

/** A regularly sampled contour: value i belongs to time t0 + i * step. NaN means undefined. */
export interface Track {
  t0: number;
  step: number;
  values: Float32Array;
}

export interface FormantTracks {
  t0: number;
  step: number;
  /** count × maxFormants, NaN where a formant is missing. */
  freqs: Float32Array;
  bandwidths: Float32Array;
  count: number;
  maxFormants: number;
}

export interface SpeechRate {
  /** Times of detected syllable nuclei (seconds). */
  nuclei: number[];
  /** Local rate in syllables per second. */
  curve: Track;
  /** Nuclei per second of phonation (pauses excluded). */
  articulationRate: number;
  /** Nuclei per second of total duration. */
  speechRate: number;
}

// ---------------------------------------------------------------- spectrogram

export interface SpectrogramParams {
  t0: number;
  t1: number;
  columns: number;
  rows: number;
  windowLength: number; // seconds (Praat convention: physical window = 2 × this)
  maxFrequency: number;
  dynamicRange: number; // dB
  preEmphasis: boolean;
}

/** Returns columns × rows darkness values in 0..1 (row 0 = lowest frequency). */
export function spectrogram(samples: Float32Array, sampleRate: number, p: SpectrogramParams): Float32Array {
  const out = new Float32Array(p.columns * p.rows);
  const n = Math.max(16, Math.round(2 * p.windowLength * sampleRate));
  const nfft = Math.max(nextPow2(n), 512);
  const win = gaussianWindow(n);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const binHz = sampleRate / nfft;
  const maxF = Math.min(p.maxFrequency, sampleRate / 2);
  const alpha = p.preEmphasis ? Math.exp((-2 * Math.PI * 50) / sampleRate) : 0;
  const db = new Float32Array(p.columns * p.rows);
  let maxDb = -Infinity;
  const dt = (p.t1 - p.t0) / p.columns;

  for (let c = 0; c < p.columns; c++) {
    const centre = Math.round((p.t0 + (c + 0.5) * dt) * sampleRate);
    const start = centre - (n >> 1);
    re.fill(0);
    im.fill(0);
    let prev = start - 1 >= 0 && start - 1 < samples.length ? samples[start - 1] : 0;
    for (let i = 0; i < n; i++) {
      const k = start + i;
      const s = k >= 0 && k < samples.length ? samples[k] : 0;
      re[i] = (s - alpha * prev) * win[i];
      prev = s;
    }
    fft(re, im);
    for (let r = 0; r < p.rows; r++) {
      const f = ((r + 0.5) / p.rows) * maxF;
      const x = f / binHz;
      const b = Math.floor(x);
      const frac = x - b;
      const p0 = re[b] * re[b] + im[b] * im[b];
      const p1 = re[b + 1] * re[b + 1] + im[b + 1] * im[b + 1];
      const v = 10 * Math.log10(p0 * (1 - frac) + p1 * frac + 1e-20);
      db[c * p.rows + r] = v;
      if (v > maxDb) maxDb = v;
    }
  }
  for (let i = 0; i < db.length; i++) {
    const v = (db[i] - (maxDb - p.dynamicRange)) / p.dynamicRange;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

// ---------------------------------------------------------------- waveform

/** Min/max envelope with one pair per pixel column. */
export function waveformEnvelope(samples: Float32Array, sampleRate: number, t0: number, t1: number, columns: number): Float32Array {
  const out = new Float32Array(columns * 2);
  const spp = ((t1 - t0) * sampleRate) / columns;
  for (let c = 0; c < columns; c++) {
    const a = Math.max(0, Math.floor(t0 * sampleRate + c * spp));
    const b = Math.min(samples.length, Math.max(a + 1, Math.floor(t0 * sampleRate + (c + 1) * spp)));
    let lo = 0;
    let hi = 0;
    if (a < samples.length) {
      lo = Infinity;
      hi = -Infinity;
      for (let i = a; i < b; i++) {
        const s = samples[i];
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
    }
    out[2 * c] = lo;
    out[2 * c + 1] = hi;
  }
  return out;
}

// ---------------------------------------------------------------- intensity

/** Intensity contour in dB (re 2·10⁻⁵, treating sample values as pascal, as Praat does). */
export function intensity(samples: Float32Array, sampleRate: number, minPitch = 100, timeStep = 0.01): Track {
  const n = Math.round((3.2 / minPitch) * sampleRate);
  const win = hannWindow(n);
  let wsum = 0;
  for (let i = 0; i < n; i++) wsum += win[i];
  const duration = samples.length / sampleRate;
  const count = Math.max(0, Math.floor((duration - n / sampleRate) / timeStep));
  const t0 = n / sampleRate / 2;
  const values = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    const start = Math.round((t0 + f * timeStep) * sampleRate) - (n >> 1);
    let mean = 0;
    for (let i = 0; i < n; i++) mean += samples[start + i] * win[i];
    mean /= wsum;
    let e = 0;
    for (let i = 0; i < n; i++) {
      const s = samples[start + i] - mean;
      e += s * s * win[i];
    }
    e /= wsum;
    values[f] = e > 0 ? 10 * Math.log10(e / 4e-10) : NaN;
  }
  return { t0, step: timeStep, values };
}

// ---------------------------------------------------------------- pitch (autocorrelation, after Boersma 1993)

export interface PitchParams {
  minPitch: number;
  maxPitch: number;
  timeStep: number;
  silenceThreshold: number;
  voicingThreshold: number;
  octaveCost: number;
  octaveJumpCost: number;
  voicedUnvoicedCost: number;
}

export const defaultPitchParams: PitchParams = {
  minPitch: 75,
  maxPitch: 500,
  timeStep: 0.01,
  silenceThreshold: 0.03,
  voicingThreshold: 0.45,
  octaveCost: 0.01,
  octaveJumpCost: 0.35,
  voicedUnvoicedCost: 0.14,
};

interface Candidate {
  f: number; // 0 = unvoiced
  strength: number;
}

export function pitch(samples: Float32Array, sampleRate: number, params: Partial<PitchParams> = {}): Track {
  const p = { ...defaultPitchParams, ...params };
  const n = Math.round((3 / p.minPitch) * sampleRate);
  const nfft = nextPow2(2 * n);
  const win = hannWindow(n);
  const duration = samples.length / sampleRate;
  const count = Math.max(0, Math.floor((duration - n / sampleRate) / p.timeStep));
  const t0 = n / sampleRate / 2;
  const minLag = Math.max(2, Math.floor(sampleRate / p.maxPitch));
  const maxLag = Math.min(n - 1, Math.ceil(sampleRate / p.minPitch));
  const maxCandidates = 6;

  // Autocorrelation of the window, used to normalise each frame's autocorrelation.
  const wre = new Float64Array(nfft);
  const wim = new Float64Array(nfft);
  for (let i = 0; i < n; i++) wre[i] = win[i];
  fft(wre, wim);
  for (let i = 0; i < nfft; i++) {
    wre[i] = wre[i] * wre[i] + wim[i] * wim[i];
    wim[i] = 0;
  }
  ifftReal(wre, wim);
  const rw = new Float64Array(n);
  for (let i = 0; i < n; i++) rw[i] = wre[i] / wre[0];

  let globalPeak = 0;
  for (let i = 0; i < samples.length; i++) globalPeak = Math.max(globalPeak, Math.abs(samples[i]));
  if (globalPeak === 0) return { t0, step: p.timeStep, values: new Float32Array(count).fill(NaN) };

  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const frames: Candidate[][] = [];

  for (let f = 0; f < count; f++) {
    const start = Math.round((t0 + f * p.timeStep) * sampleRate) - (n >> 1);
    let mean = 0;
    for (let i = 0; i < n; i++) mean += samples[start + i];
    mean /= n;
    let localPeak = 0;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < n; i++) {
      const s = samples[start + i] - mean;
      localPeak = Math.max(localPeak, Math.abs(s));
      re[i] = s * win[i];
    }
    fft(re, im);
    for (let i = 0; i < nfft; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }
    ifftReal(re, im);
    const r0 = re[0];
    const cands: Candidate[] = [];
    const intensityRatio = localPeak / globalPeak;
    const unvoicedStrength =
      p.voicingThreshold +
      Math.max(0, 2 - intensityRatio / (p.silenceThreshold / (1 + p.voicingThreshold))) * (1 + p.voicingThreshold);
    cands.push({ f: 0, strength: unvoicedStrength });

    if (r0 > 0) {
      const r = (k: number) => re[k] / r0 / rw[k];
      for (let k = minLag; k <= maxLag; k++) {
        const a = r(k - 1);
        const b = r(k);
        const c = r(k + 1);
        if (b > a && b >= c && b > 0.5 * p.voicingThreshold) {
          const denom = a - 2 * b + c;
          const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
          const lag = k + shift;
          const peak = Math.min(1, b - 0.25 * (a - c) * shift);
          const freq = sampleRate / lag;
          const strength = peak - p.octaveCost * Math.log2(p.minPitch / freq);
          cands.push({ f: freq, strength });
        }
      }
    }
    cands.sort((x, y) => y.strength - x.strength);
    frames.push(cands.slice(0, maxCandidates));
  }

  // Viterbi path through the candidates.
  const scale = 0.01 / p.timeStep;
  const vuCost = p.voicedUnvoicedCost * scale;
  const jumpCost = p.octaveJumpCost * scale;
  const values = new Float32Array(count);
  if (count === 0) return { t0, step: p.timeStep, values };
  let prevScore = frames[0].map((c) => c.strength);
  const back: number[][] = [frames[0].map(() => -1)];
  for (let f = 1; f < count; f++) {
    const cur = frames[f];
    const prev = frames[f - 1];
    const score: number[] = [];
    const ptr: number[] = [];
    for (const c of cur) {
      let best = -Infinity;
      let bi = 0;
      for (let j = 0; j < prev.length; j++) {
        const q = prev[j];
        let cost = 0;
        if (q.f === 0 && c.f === 0) cost = 0;
        else if (q.f === 0 || c.f === 0) cost = vuCost;
        else cost = jumpCost * Math.abs(Math.log2(c.f / q.f));
        const s = prevScore[j] - cost;
        if (s > best) {
          best = s;
          bi = j;
        }
      }
      score.push(best + c.strength);
      ptr.push(bi);
    }
    prevScore = score;
    back.push(ptr);
  }
  let idx = prevScore.indexOf(Math.max(...prevScore));
  for (let f = count - 1; f >= 0; f--) {
    const c = frames[f][idx];
    values[f] = c.f > 0 ? c.f : NaN;
    idx = back[f][idx];
  }
  // Voiced stretches shorter than 40 ms are almost always octave or noise errors.
  const minRun = Math.max(2, Math.round(0.04 / p.timeStep));
  for (let f = 0; f < count; ) {
    if (!Number.isFinite(values[f])) {
      f++;
      continue;
    }
    let e = f;
    while (e < count && Number.isFinite(values[e])) e++;
    if (e - f < minRun) values.fill(NaN, f, e);
    else {
      // Trim octave jumps at the edges of a voiced stretch: a jump of more than
      // a quarter of an octave within one frame where voicing starts or stops.
      const edge = Math.round(0.08 / p.timeStep);
      for (let k = e - 1; k > Math.max(f, e - 1 - edge) && e - f > minRun; k--) {
        if (Math.abs(Math.log2(values[k] / values[k - 1])) > 0.25) {
          values.fill(NaN, k, e);
          e = k;
        }
      }
      for (let k = f; k < Math.min(e - 1, f + edge) && e - f > minRun; k++) {
        if (Math.abs(Math.log2(values[k + 1] / values[k])) > 0.25) {
          values.fill(NaN, f, k + 1);
          f = k + 1;
        }
      }
    }
    f = e + 1;
  }
  return { t0, step: p.timeStep, values };
}

/** Inverse FFT for spectra whose result is real. */
function ifftReal(re: Float64Array, im: Float64Array) {
  for (let i = 0; i < im.length; i++) im[i] = -im[i];
  fft(re, im);
  const n = re.length;
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

// ---------------------------------------------------------------- formants (Burg LPC)

/** LPC coefficients a[1..order] (a[0] = 1) using Burg's method. */
export function burg(x: Float64Array, order: number): Float64Array {
  const n = x.length;
  const a = new Float64Array(order + 1);
  a[0] = 1;
  const f = Float64Array.from(x);
  const b = Float64Array.from(x);
  for (let m = 0; m < order; m++) {
    let num = 0;
    let den = 0;
    for (let i = m + 1; i < n; i++) {
      num += f[i] * b[i - 1];
      den += f[i] * f[i] + b[i - 1] * b[i - 1];
    }
    const k = den > 0 ? (-2 * num) / den : 0;
    const prev = a.slice();
    for (let i = 1; i <= m + 1; i++) a[i] = prev[i] + k * prev[m + 1 - i];
    for (let i = n - 1; i > m; i--) {
      const fi = f[i];
      f[i] = fi + k * b[i - 1];
      b[i] = b[i - 1] + k * fi;
    }
  }
  return a;
}

/** Complex roots of the polynomial z^p + a1 z^(p-1) + … + ap (Durand–Kerner). */
export function polyRoots(a: Float64Array): { re: number; im: number }[] {
  const p = a.length - 1;
  const rr = new Float64Array(p);
  const ri = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    const ang = (2 * Math.PI * i) / p + 0.4;
    rr[i] = 0.9 * Math.cos(ang);
    ri[i] = 0.9 * Math.sin(ang);
  }
  for (let iter = 0; iter < 500; iter++) {
    let delta = 0;
    for (let i = 0; i < p; i++) {
      // evaluate polynomial at root i (Horner)
      let vr = 1;
      let vi = 0;
      for (let k = 1; k <= p; k++) {
        const nr = vr * rr[i] - vi * ri[i] + a[k];
        vi = vr * ri[i] + vi * rr[i];
        vr = nr;
      }
      let dr = 1;
      let di = 0;
      for (let j = 0; j < p; j++) {
        if (j === i) continue;
        const xr = rr[i] - rr[j];
        const xi = ri[i] - ri[j];
        const nr = dr * xr - di * xi;
        di = dr * xi + di * xr;
        dr = nr;
      }
      const m = dr * dr + di * di || 1e-30;
      const qr = (vr * dr + vi * di) / m;
      const qi = (vi * dr - vr * di) / m;
      rr[i] -= qr;
      ri[i] -= qi;
      delta = Math.max(delta, Math.abs(qr) + Math.abs(qi));
    }
    if (delta < 1e-10) break;
  }
  return Array.from(rr, (r, i) => ({ re: r, im: ri[i] }));
}

export interface FormantParams {
  maxFormants: number;
  windowLength: number; // seconds (physical Gaussian window = 2 × this)
  timeStep: number;
  maxFrequency: number; // the signal must already be sampled at 2 × this
}

export const defaultFormantParams: FormantParams = {
  maxFormants: 5,
  windowLength: 0.025,
  timeStep: 0.01,
  maxFrequency: 5500,
};

export function formants(samples: Float32Array, sampleRate: number, params: Partial<FormantParams> = {}): FormantTracks {
  const p = { ...defaultFormantParams, ...params };
  const order = 2 * p.maxFormants;
  const n = Math.round(2 * p.windowLength * sampleRate);
  const win = gaussianWindow(n);
  const duration = samples.length / sampleRate;
  const count = Math.max(0, Math.floor((duration - n / sampleRate) / p.timeStep));
  const t0 = n / sampleRate / 2;
  const freqs = new Float32Array(count * p.maxFormants).fill(NaN);
  const bandwidths = new Float32Array(count * p.maxFormants).fill(NaN);
  const alpha = Math.exp((-2 * Math.PI * 50) / sampleRate);
  const nyq = sampleRate / 2;
  const x = new Float64Array(n);

  for (let f = 0; f < count; f++) {
    const start = Math.round((t0 + f * p.timeStep) * sampleRate) - (n >> 1);
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const k = start + i;
      const s = k >= 0 && k < samples.length ? samples[k] : 0;
      const prev = k - 1 >= 0 && k - 1 < samples.length ? samples[k - 1] : 0;
      x[i] = (s - alpha * prev) * win[i];
      energy += x[i] * x[i];
    }
    if (energy < 1e-10) continue;
    const a = burg(x, order);
    const roots = polyRoots(a)
      .filter((z) => z.im > 0)
      .map((z) => {
        const r = Math.hypot(z.re, z.im);
        return { f: (Math.atan2(z.im, z.re) * sampleRate) / (2 * Math.PI), bw: (-Math.log(r) * sampleRate) / Math.PI };
      })
      .filter((c) => c.f > 50 && c.f < nyq - 50)
      .sort((u, v) => u.f - v.f);
    for (let i = 0; i < Math.min(p.maxFormants, roots.length); i++) {
      freqs[f * p.maxFormants + i] = roots[i].f;
      bandwidths[f * p.maxFormants + i] = roots[i].bw;
    }
  }
  return { t0, step: p.timeStep, freqs, bandwidths, count, maxFormants: p.maxFormants };
}

// ---------------------------------------------------------------- speech rate (after de Jong & Wempe 2009)

export function speechRate(int: Track, f0: Track, duration: number, opts: { silenceDb?: number; minDip?: number; smoothing?: number } = {}): SpeechRate {
  const silenceDb = opts.silenceDb ?? -25;
  const minDip = opts.minDip ?? 2;
  const sigma = opts.smoothing ?? 0.3;
  const vals = Array.from(int.values).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const empty: SpeechRate = { nuclei: [], curve: { t0: 0, step: 0.02, values: new Float32Array(0) }, articulationRate: 0, speechRate: 0 };
  if (vals.length === 0) return empty;
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  const threshold = Math.max(q(0.99) + silenceDb, q(0.5));

  const voicedAt = (t: number) => {
    const i = Math.round((t - f0.t0) / f0.step);
    return i >= 0 && i < f0.values.length && Number.isFinite(f0.values[i]);
  };

  const iv = int.values;
  const peaks: number[] = [];
  for (let i = 1; i < iv.length - 1; i++) {
    if (iv[i] > threshold && iv[i] >= iv[i - 1] && iv[i] > iv[i + 1]) peaks.push(i);
  }
  // Keep a peak only if the dip between it and the previously kept peak is deep enough.
  const kept: number[] = [];
  for (const pk of peaks) {
    if (kept.length === 0) {
      kept.push(pk);
      continue;
    }
    const last = kept[kept.length - 1];
    let dip = Infinity;
    for (let i = last; i <= pk; i++) dip = Math.min(dip, iv[i]);
    if (iv[pk] - dip >= minDip && iv[last] - dip >= minDip) kept.push(pk);
    else if (iv[pk] > iv[last]) kept[kept.length - 1] = pk;
  }
  const nuclei = kept.map((i) => int.t0 + i * int.step).filter(voicedAt);

  let phonation = 0;
  for (let i = 0; i < iv.length; i++) if (iv[i] > threshold) phonation += int.step;

  const step = 0.02;
  const count = Math.max(1, Math.ceil(duration / step));
  const values = new Float32Array(count);
  const norm = 1 / (sigma * Math.sqrt(2 * Math.PI));
  for (let i = 0; i < count; i++) {
    const t = i * step;
    let s = 0;
    for (const nt of nuclei) {
      const d = (t - nt) / sigma;
      if (Math.abs(d) < 4) s += norm * Math.exp(-0.5 * d * d);
    }
    // Undefined inside long pauses so the curve does not sag to zero between phrases.
    const ii = Math.round((t - int.t0) / int.step);
    let speaking = false;
    for (let k = ii - 15; k <= ii + 15 && !speaking; k++) if (k >= 0 && k < iv.length && iv[k] > threshold) speaking = true;
    values[i] = speaking ? s : NaN;
  }
  return {
    nuclei,
    curve: { t0: 0, step, values },
    articulationRate: phonation > 0 ? nuclei.length / phonation : 0,
    speechRate: duration > 0 ? nuclei.length / duration : 0,
  };
}

export function trackAt(track: Track, t: number): number {
  const x = (t - track.t0) / track.step;
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= track.values.length) return NaN;
  const a = track.values[i];
  const b = track.values[i + 1];
  if (!Number.isFinite(a)) return Number.isFinite(b) && x - i > 0.5 ? b : NaN;
  if (!Number.isFinite(b)) return x - i < 0.5 ? a : NaN;
  return a + (b - a) * (x - i);
}
