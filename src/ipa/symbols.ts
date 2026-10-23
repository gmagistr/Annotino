/** Symbols offered by the IPA keyboard, grouped as on the IPA and extIPA charts. */

export interface IpaSymbol {
  char: string;
  name: string;
  /** True for combining marks, shown on a dotted circle. */
  combining?: boolean;
}

export interface IpaGroup {
  id: string;
  title: string;
  symbols: IpaSymbol[];
}

const s = (char: string, name: string): IpaSymbol => ({ char, name });
const c = (char: string, name: string): IpaSymbol => ({ char, name, combining: true });

export const IPA_GROUPS: IpaGroup[] = [
  {
    id: 'pulmonic',
    title: 'Consonants (pulmonic)',
    symbols: [
      s('p', 'voiceless bilabial plosive'), s('b', 'voiced bilabial plosive'),
      s('t', 'voiceless alveolar plosive'), s('d', 'voiced alveolar plosive'),
      s('ʈ', 'voiceless retroflex plosive'), s('ɖ', 'voiced retroflex plosive'),
      s('c', 'voiceless palatal plosive'), s('ɟ', 'voiced palatal plosive'),
      s('k', 'voiceless velar plosive'), s('ɡ', 'voiced velar plosive'),
      s('q', 'voiceless uvular plosive'), s('ɢ', 'voiced uvular plosive'),
      s('ʔ', 'glottal stop'),
      s('m', 'bilabial nasal'), s('ɱ', 'labiodental nasal'), s('n', 'alveolar nasal'),
      s('ɳ', 'retroflex nasal'), s('ɲ', 'palatal nasal'), s('ŋ', 'velar nasal'), s('ɴ', 'uvular nasal'),
      s('ʙ', 'bilabial trill'), s('r', 'alveolar trill'), s('ʀ', 'uvular trill'),
      s('ⱱ', 'labiodental flap'), s('ɾ', 'alveolar tap'), s('ɽ', 'retroflex flap'),
      s('ɸ', 'voiceless bilabial fricative'), s('β', 'voiced bilabial fricative'),
      s('f', 'voiceless labiodental fricative'), s('v', 'voiced labiodental fricative'),
      s('θ', 'voiceless dental fricative'), s('ð', 'voiced dental fricative'),
      s('s', 'voiceless alveolar fricative'), s('z', 'voiced alveolar fricative'),
      s('ʃ', 'voiceless postalveolar fricative'), s('ʒ', 'voiced postalveolar fricative'),
      s('ʂ', 'voiceless retroflex fricative'), s('ʐ', 'voiced retroflex fricative'),
      s('ç', 'voiceless palatal fricative'), s('ʝ', 'voiced palatal fricative'),
      s('x', 'voiceless velar fricative'), s('ɣ', 'voiced velar fricative'),
      s('χ', 'voiceless uvular fricative'), s('ʁ', 'voiced uvular fricative'),
      s('ħ', 'voiceless pharyngeal fricative'), s('ʕ', 'voiced pharyngeal fricative'),
      s('h', 'voiceless glottal fricative'), s('ɦ', 'voiced glottal fricative'),
      s('ɬ', 'voiceless alveolar lateral fricative'), s('ɮ', 'voiced alveolar lateral fricative'),
      s('ʋ', 'labiodental approximant'), s('ɹ', 'alveolar approximant'), s('ɻ', 'retroflex approximant'),
      s('j', 'palatal approximant'), s('ɰ', 'velar approximant'),
      s('l', 'alveolar lateral approximant'), s('ɭ', 'retroflex lateral approximant'),
      s('ʎ', 'palatal lateral approximant'), s('ʟ', 'velar lateral approximant'),
    ],
  },
  {
    id: 'nonpulmonic',
    title: 'Consonants (non-pulmonic)',
    symbols: [
      s('ʘ', 'bilabial click'), s('ǀ', 'dental click'), s('ǃ', 'postalveolar click'),
      s('ǂ', 'palatoalveolar click'), s('ǁ', 'alveolar lateral click'),
      s('ɓ', 'bilabial implosive'), s('ɗ', 'dental/alveolar implosive'), s('ʄ', 'palatal implosive'),
      s('ɠ', 'velar implosive'), s('ʛ', 'uvular implosive'), s('ʼ', 'ejective'),
    ],
  },
  {
    id: 'other',
    title: 'Other symbols',
    symbols: [
      s('ʍ', 'voiceless labial-velar fricative'), s('w', 'voiced labial-velar approximant'),
      s('ɥ', 'voiced labial-palatal approximant'), s('ʜ', 'voiceless epiglottal fricative'),
      s('ʢ', 'voiced epiglottal fricative'), s('ʡ', 'epiglottal plosive'),
      s('ɕ', 'voiceless alveolo-palatal fricative'), s('ʑ', 'voiced alveolo-palatal fricative'),
      s('ɺ', 'alveolar lateral flap'), s('ɧ', 'simultaneous ʃ and x'),
      c('͡', 'tie bar above'), c('͜', 'tie bar below'),
    ],
  },
  {
    id: 'vowels',
    title: 'Vowels',
    symbols: [
      s('i', 'close front unrounded'), s('y', 'close front rounded'), s('ɨ', 'close central unrounded'),
      s('ʉ', 'close central rounded'), s('ɯ', 'close back unrounded'), s('u', 'close back rounded'),
      s('ɪ', 'near-close near-front unrounded'), s('ʏ', 'near-close near-front rounded'), s('ʊ', 'near-close near-back rounded'),
      s('e', 'close-mid front unrounded'), s('ø', 'close-mid front rounded'), s('ɘ', 'close-mid central unrounded'),
      s('ɵ', 'close-mid central rounded'), s('ɤ', 'close-mid back unrounded'), s('o', 'close-mid back rounded'),
      s('ə', 'mid central (schwa)'), s('ɚ', 'rhotacised schwa'),
      s('ɛ', 'open-mid front unrounded'), s('œ', 'open-mid front rounded'), s('ɜ', 'open-mid central unrounded'),
      s('ɝ', 'rhotacised open-mid central'), s('ɞ', 'open-mid central rounded'), s('ʌ', 'open-mid back unrounded'),
      s('ɔ', 'open-mid back rounded'), s('æ', 'near-open front unrounded'), s('ɐ', 'near-open central'),
      s('a', 'open front unrounded'), s('ɶ', 'open front rounded'), s('ɑ', 'open back unrounded'), s('ɒ', 'open back rounded'),
    ],
  },
  {
    id: 'diacritics',
    title: 'Diacritics',
    symbols: [
      c('̥', 'voiceless'), c('̊', 'voiceless (above)'), c('̬', 'voiced'), s('ʰ', 'aspirated'),
      c('̹', 'more rounded'), c('̜', 'less rounded'), c('̟', 'advanced'), c('̠', 'retracted'),
      c('̈', 'centralised'), c('̽', 'mid-centralised'), c('̩', 'syllabic'), c('̍', 'syllabic (above)'),
      c('̯', 'non-syllabic'), s('˞', 'rhoticity'), c('̤', 'breathy voiced'), c('̰', 'creaky voiced'),
      c('̼', 'linguolabial'), s('ʷ', 'labialised'), s('ʲ', 'palatalised'), s('ˠ', 'velarised'),
      s('ˤ', 'pharyngealised'), c('̴', 'velarised or pharyngealised'), c('̝', 'raised'), c('̞', 'lowered'),
      c('̘', 'advanced tongue root'), c('̙', 'retracted tongue root'), c('̪', 'dental'), c('̺', 'apical'),
      c('̻', 'laminal'), c('̃', 'nasalised'), s('ⁿ', 'nasal release'), s('ˡ', 'lateral release'),
      c('̚', 'no audible release'), s('ᵊ', 'mid central vowel release'), s('ᶿ', 'voiceless dental fricative release'),
      s('ˣ', 'voiceless velar fricative release'),
    ],
  },
  {
    id: 'supra',
    title: 'Suprasegmentals',
    symbols: [
      s('ˈ', 'primary stress'), s('ˌ', 'secondary stress'), s('ː', 'long'), s('ˑ', 'half-long'),
      c('̆', 'extra-short'), s('|', 'minor (foot) group'), s('‖', 'major (intonation) group'),
      s('.', 'syllable break'), s('‿', 'linking'),
    ],
  },
  {
    id: 'tones',
    title: 'Tones and word accents',
    symbols: [
      c('̋', 'extra high'), c('́', 'high'), c('̄', 'mid'), c('̀', 'low'), c('̏', 'extra low'),
      s('˥', 'extra high (letter)'), s('˦', 'high (letter)'), s('˧', 'mid (letter)'), s('˨', 'low (letter)'), s('˩', 'extra low (letter)'),
      c('̌', 'rising'), c('̂', 'falling'), c('᷄', 'high rising'), c('᷅', 'low rising'), c('᷈', 'rising-falling'),
      s('ꜜ', 'downstep'), s('ꜛ', 'upstep'), s('↗', 'global rise'), s('↘', 'global fall'),
    ],
  },
  {
    id: 'extipa',
    title: 'extIPA',
    symbols: [
      s('ʩ', 'velopharyngeal fricative'), s('ʪ', 'voiceless lateral grooved fricative'), s('ʫ', 'voiced lateral grooved fricative'),
      s('ʬ', 'bilabial percussive'), s('ʭ', 'bidental percussive'), s('¡', 'sublaminal lower alveolar percussive'),
      s('ꞎ', 'voiceless retroflex lateral fricative'), s('\u{1DF04}', 'voiceless velar lateral fricative'),
      s('\u{1DF05}', 'voiced retroflex lateral fricative'), s('\u{1DF06}', 'voiceless palatal lateral fricative'),
      s('\u{1DF08}', 'retroflex lateral flap'), s('\u{1DF0A}', 'retroflex click'),
      c('͆', 'dentolabial'), c('͇', 'alveolar'), c('͈', 'strong articulation'), c('͉', 'weak articulation'),
      c('͊', 'denasal'), c('͋', 'nasal escape'), c('͌', 'velopharyngeal friction'), c('͍', 'labial spreading'),
      c('͎', 'whistled articulation'), c('̫', 'labialised (extIPA)'), s('↓', 'ingressive airflow'), s('↑', 'egressive airflow'),
      s('‼', 'reiterated articulation'), s('˭', 'unaspirated'), s('(', 'indeterminate start'), s(')', 'indeterminate end'),
      s('⸨', 'indistinguishable (open)'), s('⸩', 'indistinguishable (close)'), s('◯', 'indeterminate sound'),
    ],
  },
];

export function displaySymbol(sym: IpaSymbol): string {
  return sym.combining ? `◌${sym.char}` : sym.char;
}
