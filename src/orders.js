// Órdenes que llegan desde el atajo de iOS (Botón de Acción) y recorte de sesiones olvidadas.
// Todo aquí es lógica pura (sin IndexedDB ni DOM), para poder probarla aparte.
//
// El atajo abre  webapp://<host>/pp/?k=<código>&a=<opción del menú>[&t=<hora ISO>]
//   a = una línea del menú: «⏹ Parar», el nombre de una categoría, «▶ IA en 2º plano» o «⏹ IA en 2º plano».
//   k = código secreto del atajo (evita que una página web mande órdenes falsas).
//   t = hora del toque (opcional); si falta, cuenta la hora en que PP recibe la orden.
import { HOUR, fmtDur } from './time.js';

export const STOP = '⏹ Parar';
export const BG_ON = '▶ IA en 2º plano';
export const BG_OFF = '⏹ IA en 2º plano';
export const BG_NAME = 'IA en 2º plano';
const MAX_LABEL = 120;
const MAX_AGE = 6 * HOUR; // una hora de toque más vieja que esto se ignora (se usa la de llegada)

const norm = (s) => String(s || '').normalize('NFC').replace(/️/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Líneas del menú del atajo, en el orden en que se muestran. */
export function menuLines(cats) {
  return [STOP, ...cats.filter((c) => !c.archived).map((c) => c.name), BG_ON, BG_OFF];
}

/** Lee la orden de la dirección con la que se abrió la app. null si no hay orden. */
export function parseOrder(search) {
  let p;
  try { p = new URLSearchParams(search || ''); } catch { return null; }
  const a = p.get('a');
  if (!a || !a.trim()) return null;
  return { a: a.trim().slice(0, MAX_LABEL), k: p.get('k') || '', t: parseTime(p.get('t')) };
}

function parseTime(raw) {
  if (!raw) return null;
  let t = Date.parse(raw);
  if (!Number.isFinite(t)) t = Date.parse(raw.replace(/ /g, '+')); // un «+» de zona horaria llega como espacio
  return Number.isFinite(t) ? t : null;
}

/** Hora que cuenta para la orden: la del toque si es creíble, si no la de llegada. */
export function orderTime(t, receivedAt) {
  if (t == null || t > receivedAt + 60000 || receivedAt - t > MAX_AGE) return receivedAt;
  return Math.min(t, receivedAt);
}

/** Traduce una opción del menú a una acción. null si no se reconoce. */
export function resolveAction(a, cats) {
  const n = norm(a);
  if (n === norm(STOP) || n === 'stop' || n === 'parar') return { type: 'stop' };
  if (n === norm(BG_ON) || n === 'bg-on') return { type: 'bgOn' };
  if (n === norm(BG_OFF) || n === 'bg-off') return { type: 'bgOff' };
  const live = cats.filter((c) => !c.archived);
  const c = live.find((x) => norm(x.name) === n) || live.find((x) => norm(x.short) === n) || live.find((x) => x.id === a);
  return c ? { type: 'cat', id: c.id } : null;
}

const maxOf = (cats, id) => {
  const m = cats.find((c) => c.id === id)?.max;
  return typeof m === 'number' && m > 0 ? m : null;
};

/**
 * Recorta la sesión activa (y la de IA en 2º plano) si ya pasó su máximo a la hora `t`.
 * La sesión queda cerrada en inicio + máximo y marcada con `cut` para revisarla.
 */
export function trimOverdue(st, t) {
  let { sessions, bg } = st;
  const cut = [];
  const a = sessions.find((x) => x.end == null);
  const max = a && maxOf(st.cats, a.cat);
  if (max && t - a.start > max * HOUR) {
    const s = { ...a, end: a.start + max * HOUR, cut: true };
    sessions = sessions.map((x) => (x === a ? s : x));
    cut.push(s);
  }
  const b = bg.find((x) => x.end == null);
  if (b && st.bgMax > 0 && t - b.start > st.bgMax * HOUR) {
    const s = { ...b, end: b.start + st.bgMax * HOUR, cut: true };
    bg = bg.map((x) => (x === b ? s : x));
    cut.push(s);
  }
  return { sessions, bg, cut };
}

/** Cierra la sesión en curso de una lista en `t`; la descarta si dura menos del mínimo. */
export function closeLane(list, t, minMs) {
  const a = list.find((x) => x.end == null);
  if (!a) return { list, closed: null, dropped: false };
  const end = Math.max(t, a.start);
  if (end - a.start < minMs) return { list: list.filter((x) => x !== a), closed: null, dropped: true };
  const closed = { ...a, end };
  return { list: list.map((x) => (x === a ? closed : x)), closed, dropped: false };
}

const shortOf = (cats, id) => cats.find((c) => c.id === id)?.short || 'Categoría eliminada';

/**
 * Aplica órdenes en orden de hora. st: { sessions, bg, cats, bgMax, minSeconds }.
 * orders: [{ a, t }] (t ya decidida con orderTime). Devuelve { sessions, bg, msgs, cut }.
 */
export function applyOrders(st, orders, now, newId) {
  let { sessions, bg } = st;
  const msgs = [];
  const cut = [];
  const minMs = (st.minSeconds || 0) * 1000;
  const trim = (t) => {
    const r = trimOverdue({ ...st, sessions, bg }, t);
    sessions = r.sessions;
    bg = r.bg;
    cut.push(...r.cut);
  };
  for (const o of [...orders].sort((x, y) => x.t - y.t)) {
    const act = resolveAction(o.a, st.cats);
    if (!act) { msgs.push(`No reconozco «${o.a}». Copia otra vez la lista del menú en tu atajo (Ajustes → Atajo).`); continue; }
    const t = o.t;
    trim(t);
    if (act.type === 'cat') {
      const cur = sessions.find((x) => x.end == null);
      if (cur?.cat === act.id) { msgs.push(`${shortOf(st.cats, act.id)} ya estaba en curso.`); continue; }
      if (sessions.some((x) => x.cat === act.id && x.start === t)) continue; // ya aplicada antes
      const r = closeLane(sessions, t, minMs);
      const start = Math.max(t, r.closed?.end ?? t);
      sessions = [...r.list, { id: newId(), cat: act.id, start, end: null, note: '' }].sort((x, y) => x.start - y.start);
      msgs.push(`Iniciaste ${shortOf(st.cats, act.id)}` + (r.closed ? ` · paraste ${shortOf(st.cats, r.closed.cat)} (${fmtDur(r.closed.end - r.closed.start)})` : ''));
    } else if (act.type === 'stop') {
      const r = closeLane(sessions, t, minMs);
      sessions = r.list;
      msgs.push(r.closed ? `Paraste ${shortOf(st.cats, r.closed.cat)} · ${fmtDur(r.closed.end - r.closed.start)}` : r.dropped ? 'Sesión muy corta, descartada.' : 'No había ninguna categoría en curso.');
    } else if (act.type === 'bgOn') {
      if (bg.some((x) => x.end == null)) { msgs.push(`${BG_NAME} ya estaba en marcha.`); continue; }
      if (bg.some((x) => x.start === t)) continue;
      bg = [...bg, { id: newId(), cat: 'bg', start: t, end: null }].sort((x, y) => x.start - y.start);
      msgs.push(`${BG_NAME} en marcha`);
    } else {
      const r = closeLane(bg, t, minMs);
      bg = r.list;
      msgs.push(r.closed ? `${BG_NAME} · ${fmtDur(r.closed.end - r.closed.start)}` : `${BG_NAME} no estaba en marcha.`);
    }
  }
  trim(now);
  return { sessions, bg, msgs, cut };
}

/** Fin «real» de una sesión recortada: hasta ahora, o hasta que empezó la siguiente de su lista. */
export function realEnd(list, s, now) {
  const next = list.filter((x) => x.id !== s.id && x.start > s.start).reduce((m, x) => Math.min(m, x.start), Infinity);
  return Math.max(s.end, Math.min(now, next));
}
