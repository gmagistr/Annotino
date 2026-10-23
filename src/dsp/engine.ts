import type { FormantParams, FormantTracks, PitchParams, SpectrogramParams, SpeechRate, Track } from './analysis';
import type { WorkerRequest } from './worker';
import { decodeAudio } from './sniff';

export interface Analysis {
  pitch: Track;
  intensity: Track;
  formants: FormantTracks;
  rate: SpeechRate;
}

export interface SpectrogramResult {
  data: Float32Array;
  params: SpectrogramParams;
}

async function resample(buffer: AudioBuffer, rate: number): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * rate);
  const ctx = new OfflineAudioContext(1, length, rate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

function mono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / buffer.numberOfChannels;
  }
  return out;
}

/** A decoded recording: playback plus analysis in a background worker. */
export class AudioEngine {
  readonly duration: number;
  readonly sampleRate: number;
  readonly samples: Float32Array;
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, (v: unknown) => void>();
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private playStart = 0;
  private playFrom = 0;
  private playTo = 0;
  onPlaybackEnd: (() => void) | null = null;

  private constructor(readonly buffer: AudioBuffer) {
    this.duration = buffer.duration;
    this.sampleRate = buffer.sampleRate;
    this.samples = mono(buffer);
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<{ id: number }>) => {
      const cb = this.pending.get(e.data.id);
      if (cb) {
        this.pending.delete(e.data.id);
        cb(e.data);
      }
    };
    this.post({ type: 'load', samples: this.samples, sampleRate: this.sampleRate });
  }

  static async decode(bytes: ArrayBuffer): Promise<AudioEngine> {
    return new AudioEngine(await decodeAudio(bytes));
  }

  private post(msg: WorkerRequest) {
    this.worker.postMessage(msg);
  }

  private request<T>(build: (id: number) => WorkerRequest): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (v) => {
        const r = v as { error?: string };
        if (r.error) reject(new Error(r.error));
        else resolve(v as T);
      });
      this.post(build(id));
    });
  }

  async analyse(pitchParams: Partial<PitchParams> = {}, formantParams: Partial<FormantParams> = {}): Promise<Analysis> {
    const maxF = formantParams.maxFrequency ?? 5500;
    const [pitchSignal, formantSignal] = await Promise.all([resample(this.buffer, 16000), resample(this.buffer, maxF * 2)]);
    return this.request<Analysis>((id) => ({
      type: 'analyse',
      id,
      pitchSignal,
      pitchRate: 16000,
      formantSignal,
      formantRate: maxF * 2,
      pitch: pitchParams,
      formant: formantParams,
    }));
  }

  spectrogram(params: SpectrogramParams): Promise<SpectrogramResult> {
    return this.request<SpectrogramResult>((id) => ({ type: 'spectrogram', id, params }));
  }

  // ------------------------------------------------------------ playback

  get playing(): boolean {
    return this.source !== null;
  }

  play(from: number, to: number) {
    this.stop();
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.ctx.destination);
    const a = Math.max(0, Math.min(from, this.duration));
    const b = Math.max(a, Math.min(to, this.duration));
    src.start(0, a, b - a);
    src.onended = () => {
      if (this.source === src) {
        this.source = null;
        this.onPlaybackEnd?.();
      }
    };
    this.source = src;
    this.playStart = this.ctx.currentTime;
    this.playFrom = a;
    this.playTo = b;
  }

  stop() {
    if (this.source) {
      const s = this.source;
      this.source = null;
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
  }

  /** Current playback position in seconds, or null when stopped. */
  position(): number | null {
    if (!this.source || !this.ctx) return null;
    return Math.min(this.playTo, this.playFrom + (this.ctx.currentTime - this.playStart));
  }

  dispose() {
    this.stop();
    this.worker.terminate();
    void this.ctx?.close();
  }
}
