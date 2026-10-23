/**
 * A small cascade formant synthesiser (after Klatt 1980, much simplified).
 * Used for the sample recording and for tests of the analysis code.
 */

export type SynthSegment =
  | { kind: 'vowel'; dur: number; f: [number, number, number]; f0: [number, number]; amp?: number }
  | { kind: 'nasal'; dur: number; f0: [number, number] }
  | { kind: 'fricative'; dur: number; centre: number; voiced?: boolean; f0?: [number, number] }
  | { kind: 'burst'; dur: number; centre: number }
  | { kind: 'silence'; dur: number };

const BW = [80, 100, 140];

class Resonator {
  private y1 = 0;
  private y2 = 0;
  step(x: number, f: number, bw: number, sr: number): number {
    const c = -Math.exp((-2 * Math.PI * bw) / sr);
    const b = 2 * Math.exp((-Math.PI * bw) / sr) * Math.cos((2 * Math.PI * f) / sr);
    const a = 1 - b - c;
    const y = a * x + b * this.y1 + c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function smooth(x: Float32Array, width: number): Float32Array {
  const half = Math.max(1, Math.floor(width / 2));
  const prefix = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) prefix[i + 1] = prefix[i] + x[i];
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(x.length, i + half + 1);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

export function synthesise(segments: SynthSegment[], sr: number, seed = 7): Float32Array {
  const total = Math.round(segments.reduce((s, x) => s + x.dur, 0) * sr);
  const f0 = new Float32Array(total);
  const voice = new Float32Array(total);
  const noise = new Float32Array(total);
  const noiseF = new Float32Array(total).fill(4000);
  const F = [new Float32Array(total), new Float32Array(total), new Float32Array(total)];

  let pos = 0;
  let lastF: [number, number, number] = [500, 1500, 2500];
  for (const seg of segments) {
    const n = Math.round(seg.dur * sr);
    for (let i = 0; i < n && pos + i < total; i++) {
      const k = pos + i;
      const frac = n > 1 ? i / (n - 1) : 0;
      switch (seg.kind) {
        case 'vowel':
          f0[k] = seg.f0[0] + (seg.f0[1] - seg.f0[0]) * frac;
          voice[k] = seg.amp ?? 1;
          F.forEach((arr, j) => (arr[k] = seg.f[j]));
          lastF = seg.f;
          break;
        case 'nasal':
          f0[k] = seg.f0[0] + (seg.f0[1] - seg.f0[0]) * frac;
          voice[k] = 0.3;
          F[0][k] = 260;
          F[1][k] = 1150;
          F[2][k] = 2350;
          break;
        case 'fricative':
          f0[k] = seg.f0 ? seg.f0[0] + (seg.f0[1] - seg.f0[0]) * frac : 0;
          voice[k] = seg.voiced ? 0.15 : 0;
          noise[k] = 0.25;
          noiseF[k] = seg.centre;
          F.forEach((arr, j) => (arr[k] = lastF[j]));
          break;
        case 'burst':
          noise[k] = 0.6 * Math.exp(-i / (0.004 * sr));
          noiseF[k] = seg.centre;
          F.forEach((arr, j) => (arr[k] = lastF[j]));
          break;
        case 'silence':
          F.forEach((arr, j) => (arr[k] = lastF[j]));
          break;
      }
    }
    pos += n;
  }
  // Smooth formant targets into transitions and voicing into gentle onsets.
  const Fs = F.map((x) => smooth(x, Math.round(0.04 * sr)));
  const vs = smooth(voice, Math.round(0.012 * sr));

  const out = new Float32Array(total);
  const res = [new Resonator(), new Resonator(), new Resonator()];
  const nres = new Resonator();
  let phase = 0;
  let prevG = 0;
  let rnd = seed;
  const random = () => {
    rnd = (rnd * 1103515245 + 12345) & 0x7fffffff;
    return rnd / 0x7fffffff - 0.5;
  };
  let lastF0 = 150;
  for (let k = 0; k < total; k++) {
    const pitch = f0[k] > 0 ? f0[k] : lastF0;
    lastF0 = pitch;
    phase += pitch / sr;
    if (phase >= 1) phase -= 1;
    // Rosenberg glottal pulse; its derivative approximates lip radiation.
    let g = 0;
    if (phase < 0.4) g = 0.5 * (1 - Math.cos((Math.PI * phase) / 0.4));
    else if (phase < 0.6) g = Math.cos((Math.PI * (phase - 0.4)) / 0.4);
    const src = (g - prevG) * vs[k] * 20 + random() * 0.02 * vs[k];
    prevG = g;
    let y = src;
    for (let j = 0; j < 3; j++) y = res[j].step(y, Fs[j][k], BW[j], sr);
    const fr = nres.step(random() * noise[k], noiseF[k], 1800, sr) * 2;
    out[k] = y + fr;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let k = 0; k < total; k++) out[k] = (out[k] / peak) * 0.8;
  return out;
}

/** /anːoˈtiːno/, the name of the app, as a sample recording. */
export const ANNOTINO: SynthSegment[] = [
  { kind: 'silence', dur: 0.18 },
  { kind: 'vowel', dur: 0.13, f: [760, 1280, 2550], f0: [195, 205] },
  { kind: 'nasal', dur: 0.15, f0: [205, 200] },
  { kind: 'vowel', dur: 0.12, f: [470, 880, 2450], f0: [200, 205] },
  { kind: 'silence', dur: 0.07 },
  { kind: 'burst', dur: 0.025, centre: 4200 },
  { kind: 'vowel', dur: 0.19, f: [300, 2250, 2950], f0: [235, 185] },
  { kind: 'nasal', dur: 0.07, f0: [180, 170] },
  { kind: 'vowel', dur: 0.22, f: [460, 860, 2400], f0: [165, 120], amp: 0.8 },
  { kind: 'silence', dur: 0.25 },
];

/** 16-bit PCM WAV encoder. */
export function encodeWav(samples: Float32Array, sr: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(buf);
}
