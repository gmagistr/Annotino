/** Praat TextGrid import (long and short text formats) and export (long format). */

import { intervalsOf, type IntervalTier, type PointTier, type Tier } from './model';

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const num = (x: number) => String(Math.round(x * 1e9) / 1e9);

export function writeTextGrid(tiers: Tier[], duration: number): string {
  const lines = [
    'File type = "ooTextFile"',
    'Object class = "TextGrid"',
    '',
    'xmin = 0',
    `xmax = ${num(duration)}`,
    'tiers? <exists>',
    `size = ${tiers.length}`,
    'item []:',
  ];
  tiers.forEach((tier, i) => {
    lines.push(`    item [${i + 1}]:`);
    if (tier.type === 'interval') {
      const ivs = intervalsOf(tier, duration);
      lines.push('        class = "IntervalTier"', `        name = ${q(tier.name)}`, '        xmin = 0', `        xmax = ${num(duration)}`);
      lines.push(`        intervals: size = ${ivs.length}`);
      ivs.forEach((iv, k) => {
        lines.push(`        intervals [${k + 1}]:`, `            xmin = ${num(iv.start)}`, `            xmax = ${num(iv.end)}`, `            text = ${q(iv.label)}`);
      });
    } else {
      lines.push('        class = "TextTier"', `        name = ${q(tier.name)}`, '        xmin = 0', `        xmax = ${num(duration)}`);
      lines.push(`        points: size = ${tier.points.length}`);
      tier.points.forEach((p, k) => {
        lines.push(`        points [${k + 1}]:`, `            number = ${num(p.t)}`, `            mark = ${q(p.label)}`);
      });
    }
  });
  return lines.join('\n') + '\n';
}

/**
 * Tokenise a TextGrid: Praat's text format is a sequence of numbers and quoted
 * strings; everything else (keys, comments, flags) can be skipped.
 */
function tokens(text: string): (string | number)[] {
  const out: (string | number)[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let s = '';
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += text[i++];
      }
      out.push(s);
    } else if (ch === '!') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (/[-\d.]/.test(ch) && (i === 0 || /[\s=]/.test(text[i - 1]))) {
      let j = i;
      while (j < text.length && /[-+\d.eE]/.test(text[j])) j++;
      const v = Number(text.slice(i, j));
      if (Number.isFinite(v) && (j >= text.length || /\s/.test(text[j]))) out.push(v);
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

export function parseTextGrid(text: string): { duration: number; tiers: Tier[] } {
  const clean = text.replace(/^﻿/, '');
  const tk = tokens(clean);
  let p = 0;
  const next = () => tk[p++];
  const nextNum = () => {
    const v = next();
    if (typeof v !== 'number') throw new Error('This file is not a valid TextGrid.');
    return v;
  };
  const nextStr = () => {
    const v = next();
    if (typeof v !== 'string') throw new Error('This file is not a valid TextGrid.');
    return v;
  };
  if (nextStr() !== 'ooTextFile' || nextStr() !== 'TextGrid') throw new Error('This file is not a TextGrid.');
  nextNum(); // xmin
  const duration = nextNum();
  const size = nextNum();
  const tiers: Tier[] = [];
  for (let t = 0; t < size; t++) {
    const cls = nextStr();
    const name = nextStr();
    nextNum();
    nextNum();
    const n = nextNum();
    if (cls === 'IntervalTier') {
      const tier: IntervalTier = { type: 'interval', name, boundaries: [], labels: [] };
      for (let k = 0; k < n; k++) {
        const a = nextNum();
        nextNum();
        const label = nextStr();
        if (k > 0) tier.boundaries.push(a);
        tier.labels.push(label);
      }
      if (tier.labels.length === 0) tier.labels.push('');
      tiers.push(tier);
    } else {
      const tier: PointTier = { type: 'point', name, points: [] };
      for (let k = 0; k < n; k++) {
        const t0 = nextNum();
        tier.points.push({ t: t0, label: nextStr() });
      }
      tiers.push(tier);
    }
  }
  return { duration, tiers };
}
