import { describe, expect, it } from 'vitest';
import { cohenKappa, fleissKappa, intervalAgreement, krippendorffAlpha, pointAgreement, timingAgreement } from '../agreement/metrics';
import { formants, pitch, intensity, speechRate } from '../dsp/analysis';
import { nominalDistance, phoneticDistance, segment } from '../ipa/distance';
import { addBoundary, removeBoundary, type IntervalTier } from '../model';
import { parseTextGrid, writeTextGrid } from '../textgrid';
import { synthesise } from '../dsp/synth';

describe('Krippendorff alpha', () => {
  it('reproduces the nominal reliability example of Krippendorff (2011)', () => {
    const A = ['1', '2', '3', '3', '2', '1', '4', '1', '2', null, null, null];
    const B = ['1', '2', '3', '3', '2', '2', '4', '1', '2', '5', null, '3'];
    const C = [null, '3', '3', '3', '2', '3', '4', '2', '2', '5', '1', null];
    const D = ['1', '2', '3', '3', '2', '4', '4', '1', '2', '5', '1', null];
    const units = A.map((_, i) => [A[i], B[i], C[i], D[i]]);
    expect(krippendorffAlpha(units, nominalDistance)).toBeCloseTo(0.743, 3);
  });

  it('is 1 for perfect agreement', () => {
    expect(krippendorffAlpha([['a', 'a'], ['b', 'b'], ['a', 'a']], nominalDistance)).toBe(1);
  });
});

describe('kappas', () => {
  it('computes Cohen kappa', () => {
    // 50 items: agree yes 20, agree no 15, a yes/b no 5, a no/b yes 10 → κ = 0.4
    const a = [...Array(20).fill('y'), ...Array(15).fill('n'), ...Array(5).fill('y'), ...Array(10).fill('n')];
    const b = [...Array(20).fill('y'), ...Array(15).fill('n'), ...Array(5).fill('n'), ...Array(10).fill('y')];
    expect(cohenKappa(a, b)).toBeCloseTo(0.4, 5);
  });

  it('computes Fleiss kappa (Fleiss 1971 style check)', () => {
    expect(fleissKappa([['a', 'a', 'a'], ['b', 'b', 'b']])).toBe(1);
    expect(fleissKappa([['a', 'b'], ['b', 'a']])).toBeLessThan(0);
  });
});

describe('phonetic distance', () => {
  it('splits IPA into segments with diacritics and ties', () => {
    expect(segment('t͡ʃa̰ː').map((s) => s.text)).toEqual(['t͡ʃ', 'a̰ː']);
    expect(segment('ç')[0].base).toBe('ç');
  });

  it('penalises close variants less than distant sounds', () => {
    const near = phoneticDistance('e̞', 'e̝');
    const far = phoneticDistance('e̞', 'p');
    expect(near).toBeLessThan(0.25);
    expect(far).toBe(1);
    expect(phoneticDistance('e', 'ɛ')).toBeLessThan(phoneticDistance('e', 'a'));
    expect(phoneticDistance('p', 'b')).toBeLessThan(phoneticDistance('p', 'k'));
    expect(phoneticDistance('j', 'i')).toBeLessThan(0.5);
    expect(phoneticDistance('kasa', 'kaza')).toBeLessThan(0.1);
  });
});

describe('timing agreement', () => {
  it('matches boundaries one-to-one within the tolerance', () => {
    const r = timingAgreement([0.1, 0.5, 0.9], [0.11, 0.52, 1.5], 0.02);
    expect(r.matched).toBe(2);
    expect(r.f1).toBeCloseTo(2 / 3, 5);
  });

  it('reports interval and point agreement for n annotators', () => {
    const d = 2;
    let a: IntervalTier = { type: 'interval', name: 'a', boundaries: [], labels: [''] };
    a = addBoundary(a, 0.5, d);
    a = addBoundary(a, 1.0, d);
    a.labels = ['', 'ka', 'sa'];
    const b: IntervalTier = { ...a, boundaries: [0.51, 1.01], labels: ['', 'ka', 'za'] };
    const r = intervalAgreement([a, b, a], d, { tolerance: 0.02, frameStep: 0.01, gapsAsCategory: true, distance: phoneticDistance });
    expect(r.pairs).toHaveLength(3);
    expect(r.meanF1).toBe(1);
    expect(r.alpha).toBeGreaterThan(r.alphaNominal);
    const p = pointAgreement(
      [
        { type: 'point', name: 'x', points: [{ t: 0.3, label: 'H*' }, { t: 1.2, label: 'L%' }] },
        { type: 'point', name: 'y', points: [{ t: 0.31, label: 'H*' }, { t: 1.19, label: 'L%' }] },
      ],
      { tolerance: 0.05, frameStep: 0.01, gapsAsCategory: false, distance: nominalDistance },
    );
    expect(p.alphaNominal).toBe(1);
    expect(p.meanF1).toBe(1);
    expect(removeBoundary(a, 0).labels).toEqual(['ka', 'sa']);
  });
});

describe('acoustic analysis', () => {
  const sr = 16000;

  it('tracks the pitch of a synthetic vowel', () => {
    const x = synthesise([{ kind: 'vowel', dur: 0.6, f: [700, 1200, 2600], f0: [180, 180] }], sr);
    const p = pitch(x, sr);
    const voiced = Array.from(p.values).filter(Number.isFinite);
    expect(voiced.length).toBeGreaterThan(30);
    const median = voiced.sort((a, b) => a - b)[Math.floor(voiced.length / 2)];
    expect(median).toBeGreaterThan(170);
    expect(median).toBeLessThan(190);
  });

  it('estimates the first two formants of a synthetic vowel', () => {
    const fsr = 11000;
    const x = synthesise([{ kind: 'vowel', dur: 0.5, f: [700, 1200, 2600], f0: [120, 120] }], fsr);
    const fm = formants(x, fsr);
    const mid = Math.floor(fm.count / 2);
    expect(fm.freqs[mid * 5]).toBeGreaterThan(600);
    expect(fm.freqs[mid * 5]).toBeLessThan(800);
    expect(fm.freqs[mid * 5 + 1]).toBeGreaterThan(1050);
    expect(fm.freqs[mid * 5 + 1]).toBeLessThan(1350);
  });

  it('counts syllable nuclei', () => {
    const segs = [] as Parameters<typeof synthesise>[0];
    for (let i = 0; i < 4; i++) {
      segs.push({ kind: 'silence', dur: 0.08 });
      segs.push({ kind: 'vowel', dur: 0.16, f: [700, 1200, 2600], f0: [150, 140] });
    }
    segs.push({ kind: 'silence', dur: 0.1 });
    const x = synthesise(segs, sr);
    const p = pitch(x, sr);
    const r = speechRate(intensity(x, sr, 50), p, x.length / sr);
    expect(r.nuclei.length).toBe(4);
  });
});

describe('TextGrid', () => {
  it('round-trips interval and point tiers', () => {
    const tiers = [
      { type: 'interval' as const, name: 'phones', boundaries: [0.3, 0.7], labels: ['', 'ˈka', 'sa "x"'] },
      { type: 'point' as const, name: 'tones', points: [{ t: 0.5, label: 'H*' }] },
    ];
    const text = writeTextGrid(tiers, 1.2);
    const back = parseTextGrid(text);
    expect(back.duration).toBeCloseTo(1.2);
    expect(back.tiers).toEqual(tiers);
  });
});

describe('guideline references', () => {
  it('round-trips a reference to a part of the spectrogram', async () => {
    const { referenceFor, parseGuide } = await import('../lib/references');
    const anchor = { recordingId: '0f8fad5b-d9cb-469f-a165-70867728950e', t0: 1.23456, t1: 1.5, f0: 300, f1: 2500 };
    const body = `# Vocali\n\nLe vocali **lunghe** si segnano con ː, per esempio ${referenceFor(anchor, '[iː] lunga')}.\n\n- primo\n- secondo`;
    const blocks = parseGuide(body);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'para', 'list']);
    const para = blocks[1];
    if (para.kind !== 'para') throw new Error();
    const ref = para.inline.find((x) => x.kind === 'ref');
    expect(ref && ref.kind === 'ref' && ref.anchor).toEqual({ ...anchor, t0: 1.2346 });
    expect(para.inline.some((x) => x.kind === 'text' && x.bold && x.text === 'lunghe')).toBe(true);
  });
});

describe('disagreement strip', () => {
  it('flags a boundary that only one annotator placed, even with equal labels', async () => {
    const { disagreementStrip } = await import('../agreement/strip');
    const a: IntervalTier = { type: 'interval', name: 'w', boundaries: [0.5, 1.0], labels: ['un', 'ehm', 'un'] };
    const b: IntervalTier = { type: 'interval', name: 'w', boundaries: [0.5, 0.7, 1.0], labels: ['un', 'ehm', 'ehm', 'uno'] };
    const s = disagreementStrip([a, b], 1.5, { frameStep: 0.01, gapsAsCategory: true, distance: nominalDistance, tolerance: 0.02 });
    expect(s.boundaries).toEqual([{ t: 0.7, tier: 1 }]);
    expect(s.labels[60]).toBe(0); // ehm / ehm
    expect(s.labels[120]).toBe(1); // un / uno
  });
});
