import { getLang } from '../i18n';

const locale = () => (getLang() === 'it' ? 'it-IT' : 'en-GB');

export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return '–';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m > 0 ? `${m}:${sec.toFixed(1).padStart(4, '0')}` : `${sec.toFixed(2)} s`;
}

export function formatTime(s: number, digits = 3): string {
  return s.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatNumber(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return '–';
  return x.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
