// Utilidades de tiempo. Todo en milisegundos epoch; los límites de día/semana
// se calculan en la zona America/Bogota (UTC-5 fijo, sin horario de verano).

export const TZ = 'America/Bogota';
export const MIN = 60000;
export const HOUR = 3600000;
export const DAY = 86400000;

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function parts(ms) {
  const o = {};
  for (const p of partsFmt.formatToParts(ms)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}

/** Desfase de la zona respecto a UTC en ms (negativo para Bogotá). */
export function tzOffset(ms) {
  const p = parts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

export function startOfDay(ms) {
  const p = parts(ms);
  const utc = Date.UTC(p.y, p.m - 1, p.d);
  return utc - tzOffset(utc);
}

/** 0 = lunes … 6 = domingo */
export function weekdayIndex(ms) {
  const p = parts(ms);
  return (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
}

export function startOfWeek(ms) {
  return startOfDay(ms) - weekdayIndex(ms) * DAY;
}

export function dayKey(ms) {
  const p = parts(ms);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Divide una sesión en tramos por día (una sesión puede cruzar la medianoche). */
export function splitByDay(s, now) {
  const end = s.end ?? now;
  const out = [];
  let cur = s.start;
  while (cur < end) {
    const dayStart = startOfDay(cur);
    const segEnd = Math.min(end, dayStart + DAY);
    out.push({ key: dayKey(cur), dayStart, start: cur, end: segEnd, cat: s.cat, s });
    cur = segEnd;
  }
  return out;
}

/** Suma por categoría del tiempo que cae dentro de [from, to). */
export function rangeTotals(sessions, from, to, now) {
  const t = {};
  for (const s of sessions) {
    const a = Math.max(s.start, from);
    const b = Math.min(s.end ?? now, to);
    if (b > a) t[s.cat] = (t[s.cat] || 0) + (b - a);
  }
  return t;
}

// ---------- Formato (es-CO) ----------
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n) => String(n).padStart(2, '0');
const timeFmt = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const longFmt = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const dmFmt = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, day: 'numeric', month: 'short' });

const wdFmt = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, weekday: 'long' });
const dateFmt = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, day: 'numeric', month: 'long' });
export const fmtWeekday = (ms) => cap(wdFmt.format(ms));
export const fmtDate = (ms) => dateFmt.format(ms);
export const fmtTime = (ms) => timeFmt.format(ms);
export const fmtDayLong = (ms) => cap(longFmt.format(ms));
export const fmtDayShort = (ms) => cap(shortFmt.format(ms).replace('.', ''));
export const fmtDM = (ms) => dmFmt.format(ms).replace('.', '');

/** "2 h 05 m", "14 m", "35 s" */
export function fmtDur(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} h ${pad(m)} m`;
  if (m > 0) return `${m} m`;
  return total > 0 ? `${total} s` : '0 m';
}

/** Cronómetro "01:02:03" */
export function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

// ---------- Entradas datetime-local (hora de Bogotá) ----------
export function toLocalInput(ms) {
  const p = parts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

export function fromLocalInput(str) {
  const [d, t] = str.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const utc = Date.UTC(y, m - 1, dd, h, mi);
  return utc - tzOffset(utc);
}
