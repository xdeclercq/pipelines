// Short texts for durations and ages, sized for a phone. Pure (tested in test/format.test.js).

const pad = (n) => String(n).padStart(2, '0');

// 45s, 3m05, 1h12.
export function shortDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${pad(s % 60)}`;
  return `${Math.floor(m / 60)}h${pad(m % 60)}`;
}

// 45 s, 3 min 5 s, 1 h 12 min: for the tooltips.
export function longDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

// From start to end, or to now while it runs; null without a start.
export function elapsed(start, end, now = Date.now()) {
  if (!start) return null;
  return (end ? Date.parse(end) : now) - Date.parse(start);
}

// How long ago: 2 min, 3 h, 5 j.
export function age(iso, now = Date.now()) {
  if (!iso) return '';
  const m = Math.floor((now - Date.parse(iso)) / 60_000);
  if (m < 1) return 'maint.';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  return `${Math.floor(m / 1440)} j`;
}
