// Estado global. Los cambios en sesiones, ajustes y metadatos se guardan
// automáticamente en IndexedDB (ver set()).
import { useEffect, useState } from 'preact/hooks';
import * as db from './db.js';
import * as V from './vault.js';
import { beep } from './audio.js';
import { fmtDur } from './time.js';
import { catById, defaults, liveCats, migrateSettings } from './model.js';
import { defaultFin, migrateFin } from './fin/model.js';

export const now = () => Date.now();

export const SETTING_KEYS = ['settingsVersion', 'cats', 'groups', 'warnPct', 'sound', 'forgetHours', 'minSeconds', 'theme', 'variant', 'privacy'];
export { defaults };

let state = {
  ...defaults,
  ready: false,        // ¿ya se leyó la base de datos?
  dbError: false,      // ¿falló un guardado?
  persisted: null,     // resultado de navigator.storage.persist()
  updateReady: false,  // hay una versión nueva del service worker esperando
  lock: null,          // configuración del bloqueo (ver lock.js); nunca va en los respaldos
  locked: false,       // ¿se está mostrando la pantalla de bloqueo? (con cifrado, los datos no están en memoria)
  sessions: [],
  fin: defaultFin(),   // Dinero: solo existe con el bloqueo activo (va dentro del cifrado)
  meta: { installedAt: Date.now(), lastBackupAt: null, backupSnoozedUntil: 0, installHintDismissed: false },
  tab: 'home',
  toast: null,
  sheet: null,
  dismissedForgot: null,
};
const subs = new Set();
const pick = (s) => Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]]));
const freshDefaults = () => ({ ...pick(defaults), cats: defaults.cats.map((c) => ({ ...c })), groups: defaults.groups.map((g) => ({ ...g, cats: [...g.cats] })) });
const VARIANTS = ['aurora', 'neon', 'editorial'];
const THEMES = ['auto', 'dark', 'light'];
let lastSettings = JSON.stringify(pick(state));
let settingsTimer = null;
let queue = Promise.resolve();

export const getState = () => state;

/** ¿Los datos van cifrados? (bloqueo activo en su formato actual) */
const sealed = () => state.lock?.v === 2;

/** Ejecuta en orden con las demás operaciones de disco. */
function serial(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
}

/** Como serial(), pero marca dbError si falla un guardado. */
function persist(fn) {
  return serial(fn).then(
    () => { if (state.dbError) apply({ dbError: false }); },
    () => apply({ dbError: true }),
  );
}

/** Guarda sesiones y ajustes cifrados, tal como estén al momento de escribir. */
async function writeVault() {
  if (!sealed() || !V.isOpen()) return;
  await db.setKV('vault', await V.seal({ sessions: state.sessions, settings: pick(state), fin: state.fin }));
}

function syncSessions(prev, next) {
  const before = new Map(prev.map((s) => [s.id, s]));
  const ids = new Set();
  const puts = [];
  for (const s of next) {
    ids.add(s.id);
    if (before.get(s.id) !== s) puts.push(s);
  }
  const dels = prev.filter((s) => !ids.has(s.id)).map((s) => s.id);
  persist(() => (sealed() ? writeVault() : db.applySessions(puts, dels)));
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
  if (!state.ready) return;
  // Tema y estilo van también en claro: la pantalla de bloqueo los necesita antes de descifrar.
  if (state.theme !== prev.theme || state.variant !== prev.variant) setMeta({ ui: { theme: state.theme, variant: state.variant } });
  if (sealed() && !V.isOpen()) return; // bloqueada: no hay nada que guardar
  if (state.sessions !== prev.sessions) syncSessions(prev.sessions, state.sessions);
  const finChanged = state.fin !== prev.fin && sealed();
  const cur = JSON.stringify(pick(state));
  if (cur !== lastSettings || finChanged) {
    lastSettings = cur;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      persist(() => (sealed() ? writeVault() : db.setKV('settings', pick(state))));
    }, 250);
  }
}

/** Cambia los datos de Dinero: setFin((f) => ({ ...f, ... })). */
export function setFin(fn) {
  set((s) => ({ fin: typeof fn === 'function' ? fn(s.fin) : { ...s.fin, ...fn } }));
}

export function setMeta(patch) {
  const meta = { ...state.meta, ...patch };
  apply({ meta });
  persist(() => db.setKV('meta', meta));
}

/** Guarda la configuración del bloqueo; solo cambia el estado si se escribió en disco. */
export function setLock(lock) {
  return serial(async () => {
    await db.setKV('lock', lock);
    apply({ lock });
  });
}

/** Activa el cifrado: cifra lo que hay y borra la copia en claro, todo en una transacción. */
export function enableVault(lock, master) {
  return serial(async () => {
    await V.open(master);
    try {
      const vault = await V.seal({ sessions: state.sessions, settings: pick(state), fin: state.fin });
      await db.commit({ clearSessions: true, kv: { vault, settings: null, lock } });
    } catch (e) {
      V.close();
      throw e;
    }
    apply({ lock });
  }).then(() => setMeta({ ui: { theme: state.theme, variant: state.variant } }));
}

/** Descifra los datos guardados con la clave maestra y muestra la app. */
export function openVault(master) {
  return serial(async () => {
    await V.open(master);
    let data;
    try {
      const rec = await db.getKV('vault');
      data = rec ? await V.unseal(rec) : { sessions: [], settings: null };
    } catch (e) {
      V.close();
      throw e;
    }
    const settings = migrateSettings(data.settings);
    apply({ ...freshDefaults(), ...(settings || {}), sessions: data.sessions || [], fin: migrateFin(data.fin), locked: false });
    lastSettings = JSON.stringify(pick(state));
    if (settings !== data.settings) persist(writeVault);
  });
}

/** Bloquea la app. Con cifrado, guarda lo pendiente y borra de la memoria la clave y los datos. */
export function lockApp() {
  if (state.locked) return;
  apply({ locked: true, sheet: null, toast: null, settingsAuth: false, finCfgAuth: false });
  if (!sealed() || !V.isOpen()) return;
  clearTimeout(settingsTimer);
  persist(writeVault);
  serial(() => {
    V.close();
    apply({ ...freshDefaults(), theme: state.theme, variant: state.variant, sessions: [], fin: defaultFin(), dismissedForgot: null });
  });
}

/** Quita el bloqueo: vuelve a guardar todo en claro y borra lo cifrado, en una transacción. */
export function disableVault() {
  return serial(async () => {
    await db.commit({ clearSessions: true, putSessions: state.sessions, kv: { settings: pick(state), vault: null, lock: null } });
    V.close();
    apply({ lock: null, locked: false });
  });
}

/** Contraseña olvidada: borra sesiones (y, si estaban cifrados, también los ajustes) y quita el bloqueo. */
export function wipeData() {
  return serial(async () => {
    const settings = sealed() ? { ...freshDefaults(), theme: state.theme, variant: state.variant } : pick(state);
    await db.commit({ clearSessions: true, kv: { settings, vault: null, lock: null } });
    V.close();
    apply({ ...settings, sessions: [], fin: defaultFin(), lock: null, locked: false, sheet: null, dismissedForgot: null });
    lastSettings = JSON.stringify(pick(state));
  });
}

/** Carga los datos guardados. Se llama una vez al arrancar. */
export async function init() {
  try {
    const { sessions, settings, meta, lock } = await db.loadAll();
    const m = { ...state.meta, ...(meta || {}) };
    if (lock?.v === 2) {
      // Cifrado: no hay nada que leer hasta que se desbloquee.
      const ui = m.ui || {};
      apply({
        ...freshDefaults(),
        theme: THEMES.includes(ui.theme) ? ui.theme : defaults.theme,
        variant: VARIANTS.includes(ui.variant) ? ui.variant : defaults.variant,
        sessions: [], meta: m, lock, locked: true, ready: true,
      });
      return;
    }
    const loaded = migrateSettings(settings); // ajustes de versiones anteriores
    apply({ ...defaults, ...(loaded || {}), sessions, meta: m, lock, locked: !!lock, ready: true });
    lastSettings = JSON.stringify(pick(state));
    if (loaded !== settings) persist(() => db.setKV('settings', pick(state)));
    if (!meta) setMeta({});
  } catch {
    apply({ ready: true, dbError: true });
  } finally {
    try { navigator.storage?.persist?.().then((p) => apply({ persisted: p })); } catch { /* sin API */ }
  }
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

const catOf = (id) => catById(state, id);

/** Tocar una categoría: inicia, o finaliza si ya estaba activa. Solo una activa a la vez. */
export function toggleCat(catId) {
  const t = now();
  const act = activeSession();
  const { list, closed, dropped } = closeActive(state.sessions, t);
  const cat = catOf(catId);
  if (act && act.cat === catId) {
    set({ sessions: list });
    if (state.sound) beep('stop');
    toast(dropped ? 'Sesión muy corta, descartada' : `Guardado · ${cat.short} · ${fmtDur(closed.end - closed.start)}`, { kind: dropped ? 'info' : 'ok', sensitive: !dropped });
    return;
  }
  set({ sessions: [...list, { id: newId(), cat: catId, start: t, end: null, note: '' }], dismissedForgot: null });
  if (state.sound) beep('start');
  if (closed) toast(`Guardado · ${catOf(closed.cat).short} · ${fmtDur(closed.end - closed.start)}`, { kind: 'ok', sensitive: true });
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

/**
 * Pone a cero el tiempo desde `from` hasta ahora (-Infinity = todo), de una categoría o de 'all'.
 * Lo anterior a `from` se conserva: una sesión que cruza ese límite se recorta.
 * Si la sesión activa entra en el reinicio, su cronómetro vuelve a 0 y sigue corriendo.
 */
export function resetTime(catId, from) {
  const t = now();
  const prev = state.sessions;
  const next = [];
  for (const s of prev) {
    const hit = (catId === 'all' || s.cat === catId) && (s.end ?? t) > from;
    if (!hit) { next.push(s); continue; }
    if (s.start < from) next.push({ ...s, end: from });
    if (s.end == null) next.push(s.start < from ? { ...s, id: newId(), start: t } : { ...s, start: t });
  }
  set({ sessions: next.sort((a, b) => a.start - b.start), dismissedForgot: null });
  toast('Tiempo reiniciado', { kind: 'ok', action: { label: 'Deshacer', fn: () => set({ sessions: prev }) } });
}

/** Restablece ajustes y categorías por defecto, conservando las categorías propias (tienen historial). */
export function resetSettings() {
  const extra = state.cats.filter((c) => !defaults.cats.some((d) => d.id === c.id));
  set({ ...pick(defaults), cats: [...defaults.cats.map((c) => ({ ...c })), ...extra], groups: defaults.groups.map((g) => ({ ...g })) });
}

// ---------- Categorías y topes ----------

export function updateCategory(id, patch) {
  set({ cats: state.cats.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

export function addCategory() {
  const used = new Set(liveCats(state).map((c) => c.color));
  const color = [1, 2, 3, 4, 5, 6].find((n) => !used.has(n)) || 1;
  const c = { id: 'c' + newId(), name: 'Nueva categoría', short: 'Nueva', color, icon: 'star', cap: null, archived: false };
  set({ cats: [...state.cats, c] });
  return c.id;
}

export function moveCategory(id, dir) {
  const cats = [...state.cats];
  const i = cats.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cats.length) return;
  [cats[i], cats[j]] = [cats[j], cats[i]];
  set({ cats });
}

const lastLive = (id) => liveCats(state).filter((c) => c.id !== id).length === 0;

/** Archivar oculta la tarjeta pero conserva el historial. Finaliza su sesión si estaba en curso. */
export function setArchived(id, archived) {
  if (archived && lastLive(id)) return toast('Debe quedar al menos una categoría activa', { kind: 'warn' });
  let sessions = state.sessions;
  if (archived && activeSession()?.cat === id) sessions = closeActive(sessions, now()).list;
  set({ sessions, cats: state.cats.map((c) => (c.id === id ? { ...c, archived } : c)) });
  toast(archived ? 'Categoría archivada' : 'Categoría restaurada', { kind: 'ok' });
}

/** Elimina la categoría con todas sus sesiones (se puede deshacer unos segundos). */
export function deleteCategory(id) {
  if (lastLive(id) && !catOf(id).archived) {
    toast('Debe quedar al menos una categoría activa', { kind: 'warn' });
    return false;
  }
  const prev = { cats: state.cats, groups: state.groups, sessions: state.sessions };
  set({
    cats: state.cats.filter((c) => c.id !== id),
    groups: state.groups.map((g) => ({ ...g, cats: g.cats.filter((x) => x !== id) })),
    sessions: state.sessions.filter((s) => s.cat !== id),
  });
  toast('Categoría eliminada', { action: { label: 'Deshacer', fn: () => set(prev) } });
  return true;
}

export function updateGroup(id, patch) {
  set({ groups: state.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
}

export function addGroup() {
  const g = { id: 'g' + newId(), name: 'Nuevo tope', hours: 10, cats: [] };
  set({ groups: [...state.groups, g] });
  return g.id;
}

export function deleteGroup(id) {
  const prev = state.groups;
  set({ groups: prev.filter((g) => g.id !== id) });
  toast('Tope eliminado', { action: { label: 'Deshacer', fn: () => set({ groups: prev }) } });
}
