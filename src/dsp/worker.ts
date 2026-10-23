/// <reference lib="webworker" />
import {
  formants,
  intensity,
  pitch,
  spectrogram,
  speechRate,
  type FormantParams,
  type PitchParams,
  type SpectrogramParams,
} from './analysis';

export type WorkerRequest =
  | { type: 'load'; samples: Float32Array; sampleRate: number }
  | {
      type: 'analyse';
      id: number;
      pitchSignal: Float32Array;
      pitchRate: number;
      formantSignal: Float32Array;
      formantRate: number;
      pitch: Partial<PitchParams>;
      formant: Partial<FormantParams>;
    }
  | { type: 'spectrogram'; id: number; params: SpectrogramParams };

let samples: Float32Array = new Float32Array(0);
let sampleRate = 44100;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      samples = msg.samples;
      sampleRate = msg.sampleRate;
    } else if (msg.type === 'spectrogram') {
      const data = spectrogram(samples, sampleRate, msg.params);
      ctx.postMessage({ id: msg.id, data, params: msg.params }, [data.buffer]);
    } else if (msg.type === 'analyse') {
      const duration = samples.length / sampleRate;
      const f0 = pitch(msg.pitchSignal, msg.pitchRate, msg.pitch);
      const int = intensity(samples, sampleRate, Math.max(msg.pitch.minPitch ?? 75, 50));
      const fm = formants(msg.formantSignal, msg.formantRate, msg.formant);
      // Hide formant estimates in silence and weak noise, as Praat's display effectively does.
      let maxDb = -Infinity;
      for (const v of int.values) if (v > maxDb) maxDb = v;
      for (let i = 0; i < fm.count; i++) {
        const k = Math.round((fm.t0 + i * fm.step - int.t0) / int.step);
        const db = int.values[Math.min(int.values.length - 1, Math.max(0, k))];
        if (!(db > maxDb - 30)) fm.freqs.fill(NaN, i * fm.maxFormants, (i + 1) * fm.maxFormants);
      }
      // Syllable nuclei use a 50 Hz floor, as in de Jong & Wempe's script.
      const rateInt = intensity(samples, sampleRate, 50);
      const rate = speechRate(rateInt, f0, duration);
      ctx.postMessage({ id: msg.id, pitch: f0, intensity: int, formants: fm, rate });
    }
  } catch (err) {
    ctx.postMessage({ id: 'id' in msg ? msg.id : -1, error: String(err) });
  }
};
