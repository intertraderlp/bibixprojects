// Helpers for the time-tracking column. The cell value is a JSON string:
// { seconds, running, startedAt }. A legacy plain-number value is read as
// that many stored seconds.

export interface TT {
  seconds: number;        // accumulated, not counting the current run
  running: boolean;
  startedAt: number | null; // epoch ms when the current run started
}

export function parseTT(v: string | null): TT {
  if (!v) return { seconds: 0, running: false, startedAt: null };
  try {
    const o = JSON.parse(v);
    return {
      seconds: Number(o.seconds) || 0,
      running: !!o.running,
      startedAt: o.startedAt != null ? Number(o.startedAt) : null,
    };
  } catch {
    const n = Number(v);
    return { seconds: isNaN(n) ? 0 : n, running: false, startedAt: null };
  }
}

export function totalSeconds(t: TT, now: number = Date.now()): number {
  const live = t.running && t.startedAt ? Math.floor((now - t.startedAt) / 1000) : 0;
  return t.seconds + Math.max(0, live);
}

export function totalSecondsFromRaw(v: string | null): number {
  return totalSeconds(parseTT(v));
}

export function formatHMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
