import { frameUnits, type Distance } from './metrics';
import type { IntervalTier } from '../model';

/** Where interval tiers disagree, for drawing under the tiers. */
export interface DisagreementStrip {
  step: number;
  /** Per frame: mean pairwise label distance (0 = same label everywhere). */
  labels: Float32Array;
  /** Boundaries that not every annotator placed (none within the tolerance). */
  boundaries: { t: number; tier: number }[];
}

export function disagreementStrip(
  tiers: IntervalTier[],
  duration: number,
  opts: { frameStep: number; gapsAsCategory: boolean; distance: Distance; tolerance: number },
): DisagreementStrip {
  const units = frameUnits(tiers, duration, opts.frameStep, opts.gapsAsCategory);
  const labels = new Float32Array(units.length);
  units.forEach((u, i) => {
    let s = 0;
    let n = 0;
    for (let a = 0; a < u.length; a++)
      for (let b = a + 1; b < u.length; b++) {
        if (u[a] === null || u[b] === null) continue;
        s += opts.distance(u[a]!, u[b]!);
        n++;
      }
    labels[i] = n ? s / n : NaN;
  });
  const boundaries: DisagreementStrip['boundaries'] = [];
  tiers.forEach((tier, i) => {
    for (const t of tier.boundaries) {
      const everywhere = tiers.every((other, j) => j === i || other.boundaries.some((b) => Math.abs(b - t) <= opts.tolerance));
      if (!everywhere) boundaries.push({ t, tier: i });
    }
  });
  return { step: opts.frameStep, labels, boundaries };
}
