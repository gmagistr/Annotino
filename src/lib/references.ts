import type { Anchor } from '../model';

/**
 * References to a part of a recording, written in the guidelines as Markdown links:
 *   [text](annotino://<recordingId>/<t0>-<t1>)            a time span
 *   [text](annotino://<recordingId>/<t0>-<t1>/<f0>-<f1>)  a part of the spectrogram
 */
const REF = /\[([^\]]*)\]\(annotino:\/\/([0-9a-f-]{36})\/([\d.]+)-([\d.]+)(?:\/([\d.]+)-([\d.]+))?\)/;

export function referenceFor(anchor: Anchor, text: string): string {
  const r = (x: number, d: number) => String(Math.round(x * 10 ** d) / 10 ** d);
  const band = anchor.f0 !== undefined && anchor.f1 !== undefined ? `/${r(anchor.f0, 0)}-${r(anchor.f1, 0)}` : '';
  return `[${text.replace(/[[\]]/g, '')}](annotino://${anchor.recordingId}/${r(anchor.t0, 4)}-${r(anchor.t1, 4)}${band})`;
}

export type Inline = { kind: 'text'; text: string; bold?: boolean; italic?: boolean } | { kind: 'ref'; text: string; anchor: Anchor };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'para'; inline: Inline[] }
  | { kind: 'list'; items: Inline[][] };

function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const m = REF.exec(rest);
    const head = m ? rest.slice(0, m.index) : rest;
    out.push(...emphasis(head));
    if (!m) break;
    const [, label, recordingId, t0, t1, f0, f1] = m;
    const anchor: Anchor = { recordingId, t0: Number(t0), t1: Number(t1) };
    if (f0 && f1) {
      anchor.f0 = Number(f0);
      anchor.f1 = Number(f1);
    }
    out.push({ kind: 'ref', text: label, anchor });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function emphasis(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    const s = m[0];
    if (s.startsWith('**')) out.push({ kind: 'text', text: s.slice(2, -2), bold: true });
    else out.push({ kind: 'text', text: s.slice(1, -1), italic: true });
    last = m.index! + s.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** A small Markdown subset: #/##/### headings, "-" lists, paragraphs, **bold**, *italic*, references. */
export function parseGuide(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', inline: inline(para.join(' ')) });
    if (list.length) blocks.push({ kind: 'list', items: list.map(inline) });
    para = [];
    list = [];
  };
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3, inline: inline(h[2]) });
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (para.length) {
        blocks.push({ kind: 'para', inline: inline(para.join(' ')) });
        para = [];
      }
      list.push(line.replace(/^\s*[-*]\s+/, ''));
    } else if (!line.trim()) flush();
    else {
      if (list.length) {
        blocks.push({ kind: 'list', items: list.map(inline) });
        list = [];
      }
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}
