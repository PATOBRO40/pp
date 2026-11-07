// Cálculo de estadísticas diarias y semanales.
import { DAY, HOUR, rangeTotals, splitByDay, startOfDay } from './time.js';

export const sum = (obj, ids) => ids.reduce((a, id) => a + (obj[id] || 0), 0);

/** Estadísticas de un día (dayStart = medianoche local). */
export function dayStats(sessions, dayStart, now) {
  const to = dayStart + DAY;
  const totals = rangeTotals(sessions, dayStart, to, now);
  const hourly = Array.from({ length: 24 }, () => ({}));
  const segs = [];
  for (const s of sessions) {
    if (s.start >= to || (s.end ?? now) <= dayStart) continue;
    for (const g of splitByDay(s, now)) {
      if (g.dayStart !== dayStart) continue;
      segs.push(g);
      let cur = g.start;
      while (cur < g.end) {
        const b = Math.floor((cur - dayStart) / HOUR);
        const e = Math.min(g.end, dayStart + (b + 1) * HOUR);
        hourly[b][g.cat] = (hourly[b][g.cat] || 0) + (e - cur);
        cur = e;
      }
    }
  }
  const lens = segs.map((g) => g.end - g.start);
  const total = lens.reduce((a, b) => a + b, 0);
  return {
    totals, total, hourly, segs,
    count: segs.length,
    longest: lens.length ? Math.max(...lens) : 0,
    avg: lens.length ? total / lens.length : 0,
    first: segs.length ? Math.min(...segs.map((g) => g.start)) : null,
    last: segs.length ? Math.max(...segs.map((g) => g.end)) : null,
  };
}

/** Estadísticas de una semana (weekStart = lunes 00:00). */
export function weekStats(sessions, weekStart, now) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const ds = weekStart + i * DAY;
    const t = rangeTotals(sessions, ds, ds + DAY, now);
    return { dayStart: ds, totals: t, total: Object.values(t).reduce((a, b) => a + b, 0) };
  });
  const totals = rangeTotals(sessions, weekStart, weekStart + 7 * DAY, now);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const active = days.filter((d) => d.total > 0);
  let best = null;
  for (const d of days) if (d.total > 0 && (!best || d.total > best.total)) best = d;
  const count = sessions.filter((s) => s.start < weekStart + 7 * DAY && (s.end ?? now) > weekStart).length;
  return {
    days, totals, total, count, best,
    avgActive: active.length ? total / active.length : 0,
    activeDays: active.length,
  };
}

export { startOfDay };
