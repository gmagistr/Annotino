import type { AnnotationDoc } from '../../app/teams';
import type { Sketch, Tier } from '../../model';

export interface ViewRange {
  t0: number;
  t1: number;
}

export interface Selection {
  a: number;
  b: number;
}

export type Tool = 'select' | 'ellipse' | 'rect' | 'arrow' | 'freehand' | 'text';

export interface Selected {
  docId: string;
  /** Interval index, point index or boundary index. */
  type: 'interval' | 'point' | 'boundary';
  index: number;
}

export interface Layers {
  pitch: boolean;
  formants: boolean;
  intensity: boolean;
  rate: boolean;
}

export interface SpectrogramSettings {
  maxFrequency: number;
  windowLength: number;
  dynamicRange: number;
}

export interface PitchRange {
  min: number;
  max: number;
}

export interface TierModel {
  doc: AnnotationDoc<Tier>;
  editable: boolean;
  color: string;
  author: string;
}

export interface SketchModel {
  doc: AnnotationDoc<Sketch>;
  editable: boolean;
  color: string;
  author: string;
}

export type { DisagreementStrip as AgreementStrip } from '../../agreement/strip';

/** What the agreement panel compares; kept by the editor so results stay live while tiers change. */
export interface AgreementConfig {
  type: 'interval' | 'point';
  tierIds: string[];
  toleranceMs: number;
  frameMs: number;
  labelMode: 'nominal' | 'phonetic';
  gaps: boolean;
}
