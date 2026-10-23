/** Contour colours follow Praat's conventions, muted to sit on paper. */
export const TRACK = {
  pitch: '#1F5FA8',
  formants: '#B0303F',
  intensity: '#A0740C',
  rate: '#2F7D5B',
  selection: 'rgba(30, 74, 114, 0.13)',
  cursor: '#8E2C3A',
};

/** One colour per annotator, distinguishable in tiers and drawings. */
export const ANNOTATOR_COLORS = ['#1E4A72', '#8E2C3A', '#2F7D5B', '#7A5A12', '#5B3F8C', '#24727E', '#9A4F1E', '#4D5A2A'];

export function annotatorColor(userId: string, order: string[]): string {
  const i = order.indexOf(userId);
  return ANNOTATOR_COLORS[(i < 0 ? 0 : i) % ANNOTATOR_COLORS.length];
}
