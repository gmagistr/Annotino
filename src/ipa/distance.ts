/**
 * Feature-based phonetic distance between IPA transcriptions.
 *
 * Labels are split into segments (a base symbol with its diacritics and
 * modifier letters; tied symbols form one segment). Two segments are compared
 * through articulatory features, so [e̞] vs [e̝] costs little while [e] vs [p]
 * costs the maximum. Whole labels are compared with a weighted Levenshtein
 * distance normalised to 0..1.
 */

type Manner =
  | 'plosive' | 'nasal' | 'trill' | 'tap' | 'fricative' | 'lat-fricative'
  | 'approximant' | 'lat-approximant' | 'affricate' | 'click' | 'implosive' | 'lat-tap';

interface ConsonantF {
  kind: 'C';
  place: number; // 0 bilabial … 10 glottal (ordered front to back)
  manner: Manner;
  voiced: boolean;
}

interface VowelF {
  kind: 'V';
  height: number; // 0 close … 6 open
  back: number; // 0 front … 2 back
  round: boolean;
}

type Features = ConsonantF | VowelF;

// Places, front to back.
const BL = 0, LD = 1, DE = 2, AL = 3, PA = 4, RE = 5, AP = 5.5, PL = 6, VE = 7, UV = 8, PH = 9, GL = 10;

const C = (place: number, manner: Manner, voiced: boolean): ConsonantF => ({ kind: 'C', place, manner, voiced });
const V = (height: number, back: number, round: boolean): VowelF => ({ kind: 'V', height, back, round });

const FEATURES: Record<string, Features> = {
  // plosives
  p: C(BL, 'plosive', false), b: C(BL, 'plosive', true), t: C(AL, 'plosive', false), d: C(AL, 'plosive', true),
  ʈ: C(RE, 'plosive', false), ɖ: C(RE, 'plosive', true), c: C(PL, 'plosive', false), ɟ: C(PL, 'plosive', true),
  k: C(VE, 'plosive', false), ɡ: C(VE, 'plosive', true), g: C(VE, 'plosive', true), q: C(UV, 'plosive', false),
  ɢ: C(UV, 'plosive', true), ʔ: C(GL, 'plosive', false), ʡ: C(PH, 'plosive', false),
  // nasals
  m: C(BL, 'nasal', true), ɱ: C(LD, 'nasal', true), n: C(AL, 'nasal', true), ɳ: C(RE, 'nasal', true),
  ɲ: C(PL, 'nasal', true), ŋ: C(VE, 'nasal', true), ɴ: C(UV, 'nasal', true),
  // trills, taps
  ʙ: C(BL, 'trill', true), r: C(AL, 'trill', true), ʀ: C(UV, 'trill', true),
  ⱱ: C(LD, 'tap', true), ɾ: C(AL, 'tap', true), ɽ: C(RE, 'tap', true), ɺ: C(AL, 'lat-tap', true),
  // fricatives
  ɸ: C(BL, 'fricative', false), β: C(BL, 'fricative', true), f: C(LD, 'fricative', false), v: C(LD, 'fricative', true),
  θ: C(DE, 'fricative', false), ð: C(DE, 'fricative', true), s: C(AL, 'fricative', false), z: C(AL, 'fricative', true),
  ʃ: C(PA, 'fricative', false), ʒ: C(PA, 'fricative', true), ʂ: C(RE, 'fricative', false), ʐ: C(RE, 'fricative', true),
  ɕ: C(AP, 'fricative', false), ʑ: C(AP, 'fricative', true),
  ç: C(PL, 'fricative', false), ʝ: C(PL, 'fricative', true), x: C(VE, 'fricative', false), ɣ: C(VE, 'fricative', true),
  χ: C(UV, 'fricative', false), ʁ: C(UV, 'fricative', true), ħ: C(PH, 'fricative', false), ʕ: C(PH, 'fricative', true),
  ʜ: C(PH, 'fricative', false), ʢ: C(PH, 'fricative', true), h: C(GL, 'fricative', false), ɦ: C(GL, 'fricative', true),
  ɧ: C(PA, 'fricative', false), ʍ: C(VE, 'fricative', false),
  ɬ: C(AL, 'lat-fricative', false), ɮ: C(AL, 'lat-fricative', true), ꞎ: C(RE, 'lat-fricative', false),
  '\u{1DF04}': C(VE, 'lat-fricative', false), '\u{1DF05}': C(RE, 'lat-fricative', true), '\u{1DF06}': C(PL, 'lat-fricative', false),
  ʪ: C(AL, 'lat-fricative', false), ʫ: C(AL, 'lat-fricative', true),
  // approximants
  ʋ: C(LD, 'approximant', true), ɹ: C(AL, 'approximant', true), ɻ: C(RE, 'approximant', true), j: C(PL, 'approximant', true),
  ɰ: C(VE, 'approximant', true), w: C(VE, 'approximant', true), ɥ: C(PL, 'approximant', true),
  l: C(AL, 'lat-approximant', true), ɭ: C(RE, 'lat-approximant', true), ʎ: C(PL, 'lat-approximant', true), ʟ: C(VE, 'lat-approximant', true),
  // non-pulmonic
  ʘ: C(BL, 'click', false), ǀ: C(DE, 'click', false), ǃ: C(PA, 'click', false), ǂ: C(PL, 'click', false), ǁ: C(AL, 'click', false),
  ɓ: C(BL, 'implosive', true), ɗ: C(AL, 'implosive', true), ʄ: C(PL, 'implosive', true), ɠ: C(VE, 'implosive', true), ʛ: C(UV, 'implosive', true),
  // vowels
  i: V(0, 0, false), y: V(0, 0, true), ɨ: V(0, 1, false), ʉ: V(0, 1, true), ɯ: V(0, 2, false), u: V(0, 2, true),
  ɪ: V(1, 0.3, false), ʏ: V(1, 0.3, true), ʊ: V(1, 1.7, true),
  e: V(2, 0, false), ø: V(2, 0, true), ɘ: V(2, 1, false), ɵ: V(2, 1, true), ɤ: V(2, 2, false), o: V(2, 2, true),
  ə: V(3, 1, false), ɚ: V(3, 1, false),
  ɛ: V(4, 0, false), œ: V(4, 0, true), ɜ: V(4, 1, false), ɝ: V(4, 1, false), ɞ: V(4, 1, true), ʌ: V(4, 2, false), ɔ: V(4, 2, true),
  æ: V(5, 0, false), ɐ: V(5, 1, false),
  a: V(6, 0, false), ɶ: V(6, 0, true), ɑ: V(6, 2, false), ɒ: V(6, 2, true),
};

/** Approximant ↔ vowel pairs that are near-equivalent (glide vs high vowel). */
const GLIDES: Record<string, string> = { j: 'i', w: 'u', ɥ: 'y', ɰ: 'ɯ', ʋ: 'ʊ' };

/** Modifier letters that belong to the preceding segment. */
const MODIFIER_LETTERS = new Set(['ʰ', 'ʷ', 'ʲ', 'ˠ', 'ˤ', 'ⁿ', 'ˡ', '˞', 'ʼ', 'ː', 'ˑ', 'ᵊ', 'ᶿ', 'ˣ', '˭', '↓', '↑']);
const PROSODIC = new Set(['ˈ', 'ˌ', '.', '|', '‖', '‿', 'ꜜ', 'ꜛ', '↗', '↘']);
const TONE_LETTERS = new Set(['˥', '˦', '˧', '˨', '˩']);
const TIES = new Set(['͡', '͜']);

/** Diacritics weighted differently from the default. */
const MOD_WEIGHT: Record<string, number> = {
  'ː': 0.12, 'ˑ': 0.06, '̃': 0.15, '̥': 0.15, '̊': 0.15, '̬': 0.15, 'ʰ': 0.12, 'ʼ': 0.3,
  '̩': 0.15, '̍': 0.15, '̯': 0.12,
};
const DEFAULT_MOD_WEIGHT = 0.08;
const MAX_MOD_DISTANCE = 0.35;

export type SegmentKind = 'segment' | 'prosodic' | 'tone' | 'space';

export interface Segment {
  text: string;
  base: string;
  mods: string[];
  kind: SegmentKind;
}

function isCombining(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff)
  );
}

/** Split an IPA string into segments. */
export function segment(label: string): Segment[] {
  // Decompose so diacritics are compared one by one, but keep ç (a base letter in IPA) whole.
  const chars = Array.from(label.normalize('NFD').replace(/c\u0327/g, 'ç'));
  const out: Segment[] = [];
  let tieNext = false;
  for (const ch of chars) {
    const last = out[out.length - 1];
    if (TIES.has(ch)) {
      if (last && last.kind === 'segment') {
        last.text += ch;
        tieNext = true;
      }
      continue;
    }
    if (tieNext && last) {
      last.text += ch;
      last.base += ch;
      tieNext = false;
      continue;
    }
    if (isCombining(ch) || MODIFIER_LETTERS.has(ch)) {
      if (last && last.kind !== 'space') {
        last.text += ch;
        last.mods.push(ch);
        continue;
      }
    }
    if (/\s/.test(ch)) {
      if (last?.kind !== 'space') out.push({ text: ' ', base: ' ', mods: [], kind: 'space' });
      continue;
    }
    const kind: SegmentKind = PROSODIC.has(ch) ? 'prosodic' : TONE_LETTERS.has(ch) ? 'tone' : 'segment';
    out.push({ text: ch, base: ch, mods: [], kind });
  }
  return out;
}

function featuresOf(base: string): Features | null {
  const chars = Array.from(base);
  if (chars.length === 1) return FEATURES[chars[0]] ?? null;
  // Tied sequence: affricate (stop + fricative) or double articulation.
  const a = FEATURES[chars[0]];
  const b = FEATURES[chars[chars.length - 1]];
  if (a?.kind === 'C' && b?.kind === 'C') {
    if (a.manner === 'plosive' && (b.manner === 'fricative' || b.manner === 'lat-fricative')) {
      return { kind: 'C', place: b.place, manner: 'affricate', voiced: a.voiced || b.voiced };
    }
    return a;
  }
  return a ?? b ?? null;
}

const MANNER_NEAR: Record<string, number> = {
  'tap|trill': 0.5, 'approximant|fricative': 0.6, 'lat-approximant|lat-fricative': 0.6,
  'fricative|lat-fricative': 0.5, 'approximant|lat-approximant': 0.6, 'lat-tap|tap': 0.4,
  'affricate|plosive': 0.5, 'affricate|fricative': 0.5, 'implosive|plosive': 0.6, 'nasal|plosive': 0.8,
  'click|plosive': 0.8, 'lat-approximant|lat-tap': 0.6,
};

function mannerDistance(a: Manner, b: Manner): number {
  if (a === b) return 0;
  const key = [a, b].sort().join('|');
  return MANNER_NEAR[key] ?? 1;
}

function baseDistance(a: string, b: string): number {
  if (a === b) return 0;
  const fa = featuresOf(a);
  const fb = featuresOf(b);
  if (!fa || !fb) return 1;
  if (fa.kind === 'V' && fb.kind === 'V') {
    const d = 0.6 * (Math.abs(fa.height - fb.height) / 6) + 0.3 * (Math.abs(fa.back - fb.back) / 2) + (fa.round !== fb.round ? 0.15 : 0);
    return Math.min(1, Math.max(0.05, d));
  }
  if (fa.kind === 'C' && fb.kind === 'C') {
    const place = 0.5 * Math.min(1, Math.abs(fa.place - fb.place) / 4);
    const manner = 0.45 * mannerDistance(fa.manner, fb.manner);
    const voice = fa.voiced !== fb.voiced ? 0.2 : 0;
    return Math.min(1, Math.max(0.05, place + manner + voice));
  }
  // Consonant vs vowel: only glide ↔ corresponding high vowel is close.
  const [cons, vow] = fa.kind === 'C' ? [a, b] : [b, a];
  const target = GLIDES[cons];
  if (target) return Math.min(1, 0.35 + 0.6 * baseDistance(target, vow));
  return 1;
}

function modDistance(a: string[], b: string[]): number {
  const ma = new Map<string, number>();
  for (const m of a) ma.set(m, (ma.get(m) ?? 0) + 1);
  for (const m of b) ma.set(m, (ma.get(m) ?? 0) - 1);
  let d = 0;
  for (const [m, n] of ma) if (n !== 0) d += Math.abs(n) * (MOD_WEIGHT[m] ?? DEFAULT_MOD_WEIGHT);
  return Math.min(MAX_MOD_DISTANCE, d);
}

/** Distance between two segments, 0 (identical) … 1 (unrelated). */
export function segmentDistance(a: Segment, b: Segment): number {
  if (a.kind !== b.kind) return 1;
  if (a.kind !== 'segment') return a.base === b.base ? 0 : 0.5;
  return Math.min(1, baseDistance(a.base, b.base) + modDistance(a.mods, b.mods));
}

function indelCost(s: Segment): number {
  switch (s.kind) {
    case 'space': return 0.2;
    case 'prosodic': return 0.3;
    case 'tone': return 0.5;
    default: return 1;
  }
}

/** Normalised weighted edit distance between two IPA labels (0 … 1). */
export function phoneticDistance(a: string, b: string): number {
  if (a === b) return 0;
  const sa = segment(a);
  const sb = segment(b);
  const totalA = sa.reduce((s, x) => s + indelCost(x), 0);
  const totalB = sb.reduce((s, x) => s + indelCost(x), 0);
  const norm = Math.max(totalA, totalB);
  if (norm === 0) return 0;
  let prev = new Float64Array(sb.length + 1);
  let cur = new Float64Array(sb.length + 1);
  for (let j = 1; j <= sb.length; j++) prev[j] = prev[j - 1] + indelCost(sb[j - 1]);
  for (let i = 1; i <= sa.length; i++) {
    cur[0] = prev[0] + indelCost(sa[i - 1]);
    for (let j = 1; j <= sb.length; j++) {
      const sub = prev[j - 1] + segmentDistance(sa[i - 1], sb[j - 1]);
      const del = prev[j] + indelCost(sa[i - 1]);
      const ins = cur[j - 1] + indelCost(sb[j - 1]);
      cur[j] = Math.min(sub, del, ins);
    }
    [prev, cur] = [cur, prev];
  }
  return Math.min(1, prev[sb.length] / norm);
}

export function nominalDistance(a: string, b: string): number {
  return a === b ? 0 : 1;
}
