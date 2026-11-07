// Estado global. Los cambios en sesiones, ajustes y metadatos se guardan
// automáticamente en IndexedDB (ver set()).
import { useEffect, useState } from 'preact/hooks';
import * as db from './db.js';
import { beep } from './audio.js';
import { fmtDur } from './time.js';

export const now = () => Date.now();

export const SETTING_KEYS = ['cats', 'groups', 'warnPct', 'sound', 'forgetHours', 'minSeconds', 'theme', 'variant'];

export const defaults = {
  cats: [
    { id: 'ia', name: 'Ensoñaciones con IA', short: 'Con IA', group: 'sonar', color: 1 },
    { id: 'sin', name: 'Ensoñaciones sin IA', short: 'Sin IA', group: 'sonar', color: 2 },
    { id: 'proy', name: 'Proyectos', short: 'Proyectos', group: 'proy', color: 3 },
  ],
  groups: [
    { id: 'sonar', name: 'Ensoñaciones', hours: 20 },
    { id: 'proy', name: 'Proyectos', hours: 10 },
  ],
  warnPct: 80,
  sound: true,
  forgetHours: 8,
  minSeconds: 5,
  theme: 'dark',
  variant: 'aurora',
};

let state = {
  ...defaults,
  ready: false,        // ¿ya se leyó la base de datos?
  dbError: false,      // ¿falló un guardado?
  persisted: null,     // resultado de navigator.storage.persist()
  updateReady: false,  // hay una versión nueva del service worker esperando
  sessions: [],
  meta: { installedAt: Date.now(), lastBackupAt: null, backupSnoozedUntil: 0, installHintDismissed: false },
  tab: 'home',
  toast: null,
  sheet: null,
  dismissedForgot: null,
};
const subs = new Set();
const pick = (s) => Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]]));
let lastSettings = JSON.stringify(pick(state));
let settingsTimer = null;
let queue = Promise.resolve();

export const getState = () => state;

function syncSessions(prev, next) {
  const before = new Map(prev.map((s) => [s.id, s]));
  const ids = new Set();
  const puts = [];
  for (const s of next) {
    ids.add(s.id);
    if (before.get(s.id) !== s) puts.push(s);
  }
  const dels = prev.filter((s) => !ids.has(s.id)).map((s) => s.id);
  queue = queue
    .then(() => db.applySessions(puts, dels))
    .then(() => { if (state.dbError) apply({ dbError: false }); })
    .catch(() => apply({ dbError: true }));
}

function apply(patch) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

/** Actualiza el estado y persiste lo que haya cambiado. */
export function set(patch) {
  const prev = state;
  const p = typeof patch === 'function' ? patch(prev) : patch;
  apply(p);
  if (state.ready) {
    if (state.sessions !== prev.sessions) syncSessions(prev.sessions, state.sessions);
    const cur = JSON.stringify(pick(state));
    if (cur !== lastSettings) {
      lastSettings = cur;
      clearTimeout(settingsTimer);
      settingsTimer = setTimeout(() => {
        queue = queue.then(() => db.setKV('settings', pick(state))).catch(() => apply({ dbError: true }));
      }, 250);
    }
  }
}

export function setMeta(patch) {
  const meta = { ...state.meta, ...patch };
  apply({ meta });
  queue = queue.then(() => db.setKV('meta', meta)).catch(() => apply({ dbError: true }));
}

/** Carga los datos guardados. Se llama una vez al arrancar. */
export async function init() {
  try {
    const { sessions, settings, meta } = await db.loadAll();
    const m = { ...state.meta, ...(meta || {}) };
    apply({ ...defaults, ...(settings || {}), sessions, meta: m, ready: true });
    lastSettings = JSON.stringify(pick(state));
    if (!meta) setMeta({});
  } catch {
    apply({ ready: true, dbError: true });
  }
  try { navigator.storage?.persist?.().then((p) => apply({ persisted: p })); } catch { /* sin API */ }
}

export function useStore() {
  const [, force] = useState(0);
  const seen = state;
  useEffect(() => {
    const f = () => force((x) => x + 1);
    subs.add(f);
    // Los efectos corren después de pintar: si el estado cambió antes de suscribirse
    // (p. ej. init() terminó primero), hay que redibujar o ese cambio se perdería.
    if (state !== seen) f();
    return () => subs.delete(f);
  }, []);
  return state;
}

/** Re-renderiza cada segundo y al volver a la app; devuelve "ahora". */
export function useNow() {
  const [n, setN] = useState(now());
  useEffect(() => {
    const f = () => setN(now());
    const id = setInterval(f, 1000);
    document.addEventListener('visibilitychange', f);
    window.addEventListener('pageshow', f);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', f);
      window.removeEventListener('pageshow', f);
    };
  }, []);
  return n;
}

export const activeSession = (s = state) => s.sessions.find((x) => x.end == null);

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

let toastId = 0;
/** opts: kind (ok|info|warn|over), long, action {label, fn} */
export function toast(msg, opts = {}) {
  apply({ toast: { id: ++toastId, msg, kind: 'info', ...opts } });
}

/** Finaliza la sesión activa en `t`; la descarta si es más corta que el mínimo. */
function closeActive(list, t) {
  const a = list.find((x) => x.end == null);
  if (!a) return { list, closed: null, dropped: false };
  if (t - a.start < state.minSeconds * 1000) return { list: list.filter((x) => x !== a), closed: null, dropped: true };
  const closed = { ...a, end: t };
  return { list: list.map((x) => (x === a ? closed : x)), closed, dropped: false };
}

const catOf = (id) => state.cats.find((c) => c.id === id);

/** Tocar una categoría: inicia, o finaliza si ya estaba activa. Solo una activa a la vez. */
export function toggleCat(catId) {
  const t = now();
  const act = activeSession();
  const { list, closed, dropped } = closeActive(state.sessions, t);
  const cat = catOf(catId);
  if (act && act.cat === catId) {
    set({ sessions: list });
    if (state.sound) beep('stop');
    toast(dropped ? 'Sesión muy corta, descartada' : `Guardado · ${cat.short} · ${fmtDur(closed.end - closed.start)}`, { kind: dropped ? 'info' : 'ok' });
    return;
  }
  set({ sessions: [...list, { id: newId(), cat: catId, start: t, end: null, note: '' }], dismissedForgot: null });
  if (state.sound) beep('start');
  if (closed) toast(`Guardado · ${catOf(closed.cat).short} · ${fmtDur(closed.end - closed.start)}`, { kind: 'ok' });
}

export function saveSession(s) {
  const exists = state.sessions.some((x) => x.id === s.id);
  // Solo puede haber una sesión activa: si se deja esta en curso, cierra la otra.
  let base = state.sessions;
  if (s.end == null) base = base.map((x) => (x.end == null && x.id !== s.id ? { ...x, end: Math.max(x.start, s.start) } : x));
  const next = exists ? base.map((x) => (x.id === s.id ? s : x)) : [...base, s];
  set({ sessions: next.sort((a, b) => a.start - b.start) });
  toast('Sesión guardada', { kind: 'ok' });
}

export function deleteSession(id) {
  const prev = state.sessions;
  set({ sessions: prev.filter((x) => x.id !== id) });
  toast('Sesión eliminada', { action: { label: 'Deshacer', fn: () => set({ sessions: prev }) } });
}

export function resetSettings() {
  set(pick(defaults));
}
