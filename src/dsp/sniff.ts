/** Read the native sample rate from a WAV or FLAC header, so decoding does not resample. */
export function sniffSampleRate(bytes: ArrayBuffer): number | null {
  const v = new DataView(bytes);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (bytes.byteLength < 44) return null;
  if (tag(0) === 'RIFF' && tag(8) === 'WAVE') {
    let o = 12;
    while (o + 8 <= bytes.byteLength) {
      const size = v.getUint32(o + 4, true);
      if (tag(o) === 'fmt ') return v.getUint32(o + 12, true);
      o += 8 + size + (size % 2);
    }
    return null;
  }
  if (tag(0) === 'fLaC') {
    // STREAMINFO: sample rate is the 20 bits starting at byte 18.
    return (v.getUint8(18) << 12) | (v.getUint8(19) << 4) | (v.getUint8(20) >> 4);
  }
  return null;
}

/** Decode without resampling when the native rate is known (browsers accept 8–96 kHz). */
export async function decodeAudio(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const sr = sniffSampleRate(bytes);
  const rate = sr && sr >= 8000 && sr <= 96000 ? sr : 48000;
  return new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes.slice(0));
}
