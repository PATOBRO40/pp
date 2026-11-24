// Estado global. Los cambios en sesiones, ajustes y metadatos se guardan
// automáticamente en IndexedDB (ver set()).
import { useEffect, useState } from 'preact/hooks';
import * as db from './db.js';
import * as V from './vault.js';
import { beep } from './audio.js';
import { fmtDur } from './time.js';
import { catById, defaults, liveCats, migrateSettings } from './model.js';
import { clearClassifiedCache } from './fin/classify.js';
import { defaultFin, migrateFin } from './fin/model.js';
import { BG_NAME, applyOrders, closeLane, isMenu, orderTime, realEnd, resolveAction, trimOverdue } from './orders.js';
import { genKeys, newCode, openOrders, sealOrder } from './inbox.js';

export const now = () => Date.now();

export const SETTING_KEYS = ['settingsVersion', 'cats', 'groups', 'warnPct', 'sound', 'forgetHours', 'bgMax', 'minSeconds', 'theme', 'variant', 'privacy'];
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
  bg: [],              // IA en 2º plano: sesiones aparte {id, cat: 'bg', start, end}; no cuentan en topes
  shortcut: null,      // atajo del Botón de Acción: { k: código, pub: clave pública del buzón | null }
  inboxCount: 0,       // órdenes del atajo guardadas mientras PP está bloqueada
  inboxNotes: [],      // órdenes recibidas en esta apertura, para confirmarlas en la pantalla de bloqueo
  quickMenu: false,    // menú «¿Qué haces ahora?» abierto desde el atajo
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
let settingsDirty = false;
let finDirty = false;
let queue = Promise.resolve();
let inboxPriv = null; // clave privada del buzón (solo en memoria y dentro del vault)

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
  await db.setKV('vault', await V.seal(vaultData()));
}

const vaultData = () => ({ sessions: state.sessions, settings: pick(state), fin: state.fin, bg: state.bg, inboxKey: inboxPriv });

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

/** Fuerza el guardado inmediato si hay cambios de ajustes o Dinero pendientes. */
export function flushPending() {
  if (!state.ready || (sealed() && !V.isOpen())) return;
  if (settingsTimer == null && !settingsDirty && !finDirty) return;
  clearTimeout(settingsTimer);
  settingsTimer = null;
  settingsDirty = false;
  finDirty = false;
  persist(() => (sealed() ? writeVault() : db.setKV('settings', pick(state))));
}

/** Actualiza el estado y persiste lo que haya cambiado. */
export function set(patch, opts) {
  const prev = state;
  const p = typeof patch === 'function' ? patch(prev) : patch;
  apply(p);
  if (!state.ready) return;
  // Tema, estilo y modo de privacidad van también en claro: la pantalla de bloqueo los necesita antes de descifrar.
  if (state.theme !== prev.theme || state.variant !== prev.variant || state.privacy !== prev.privacy) syncUi();
  if (sealed() && !V.isOpen()) return; // bloqueada: no hay nada que guardar
  if (state.sessions !== prev.sessions) syncSessions(prev.sessions, state.sessions);
  if (state.bg !== prev.bg) { const bg = state.bg; persist(() => (sealed() ? writeVault() : db.setKV('bg', bg))); }
  if (state.cats !== prev.cats) syncMenu();
  const finChanged = state.fin !== prev.fin && sealed();
  const cur = JSON.stringify(pick(state));
  const settingsChanged = cur !== lastSettings;
  if (settingsChanged || finChanged) {
    lastSettings = cur;
    if (settingsChanged) settingsDirty = true;
    if (finChanged) finDirty = true;
    clearTimeout(settingsTimer);
    if (opts?.immediate) {
      settingsTimer = null;
      settingsDirty = false;
      finDirty = false;
      persist(() => (sealed() ? writeVault() : db.setKV('settings', pick(state))));
    } else {
      settingsTimer = setTimeout(() => {
        settingsTimer = null;
        settingsDirty = false;
        finDirty = false;
        persist(() => (sealed() ? writeVault() : db.setKV('settings', pick(state))));
      }, 250);
    }
  }
}

/** Cambia los datos de Dinero: setFin((f) => ({ ...f, ... }), opts). */
export function setFin(fn, opts) {
  set((s) => ({ fin: typeof fn === 'function' ? fn(s.fin) : { ...s.fin, ...fn } }), opts);
}

export function setMeta(patch) {
  const meta = { ...state.meta, ...patch };
  apply({ meta });
  persist(() => db.setKV('meta', meta));
}

const syncUi = () => setMeta({ ui: { theme: state.theme, variant: state.variant, privacy: state.privacy } });

/**
 * Copia en claro de los nombres y colores de las categorías activas, para que el menú del atajo
 * se pueda mostrar con PP bloqueada. Solo nombres: tiempos y sesiones siguen cifrados.
 */
function syncMenu() {
  if (!state.shortcut || (sealed() && !V.isOpen())) return;
  const menu = liveCats(state).map((c) => ({ label: c.name, color: c.color }));
  if (JSON.stringify(menu) === JSON.stringify(state.shortcut.menu)) return;
  const rec = { ...state.shortcut, menu };
  apply({ shortcut: rec });
  persist(() => db.setKV('shortcut', rec));
}

/** ¿Están los datos descifrados en memoria? */
export const dataOpen = () => !sealed() || V.isOpen();

/** Guarda el registro del atajo (código y clave pública del buzón). */
function saveShortcut(rec) {
  apply({ shortcut: rec });
  return db.setKV('shortcut', rec);
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
    let shortcut;
    try {
      const keys = await genKeys();
      inboxPriv = keys.priv;
      shortcut = { ...state.shortcut, k: state.shortcut?.k || newCode(), pub: keys.pub };
      const vault = await V.seal(vaultData());
      await db.commit({ clearSessions: true, kv: { vault, settings: null, bg: null, inbox: null, lock, shortcut } });
    } catch (e) {
      V.close();
      inboxPriv = null;
      throw e;
    }
    apply({ lock, shortcut });
  }).then(syncUi);
}

/** Aplica las órdenes que el atajo dejó en el buzón mientras PP estaba bloqueada. Corre dentro de serial(). */
async function drainInbox() {
  const list = await db.getKV('inbox');
  if (!Array.isArray(list) || !list.length) { apply({ inboxCount: 0, inboxNotes: [] }); return; }
  const orders = inboxPriv ? await openOrders(inboxPriv, list) : [];
  const r = applyOrders({ ...state }, orders, now(), newId);
  apply({ sessions: r.sessions, bg: r.bg, inboxCount: 0, inboxNotes: [] });
  await writeVault();
  await db.commit({ kv: { inbox: null } });
  orderToast(r, 'Del atajo: ');
}

/** Un solo mensaje con lo que hicieron las órdenes y, si hubo, lo que se recortó. */
function orderToast(r, prefix = '') {
  const parts = [...r.msgs];
  if (r.cut.length) parts.push(cutText(r.cut));
  if (parts.length) toast(prefix + parts.join(' · '), { kind: r.cut.length ? 'warn' : 'ok', long: true, sensitive: true });
}

/** Descifra los datos guardados con la clave maestra y muestra la app. */
export function openVault(master) {
  return serial(async () => {
    clearClassifiedCache();
    await V.open(master);
    let data;
    try {
      const rec = await db.getKV('vault');
      data = rec ? await V.unseal(rec) : { sessions: [], settings: null };
    } catch (e) {
      V.close();
      throw e;
    }
    clearTimeout(settingsTimer);
    settingsTimer = null;
    settingsDirty = false;
    finDirty = false;
    const settings = migrateSettings(data.settings);
    inboxPriv = data.inboxKey || null;
    apply({
      ...freshDefaults(),
      ...(settings || {}),
      sessions: data.sessions || [],
      bg: Array.isArray(data.bg) ? data.bg : [],
      fin: migrateFin(data.fin),
      locked: false,
      settingsAuth: false,
      finCfgAuth: false,
      sheet: null,
      toast: null,
    });
    lastSettings = JSON.stringify(pick(state));
    let rewrite = settings !== data.settings;
    // Datos de versiones anteriores: crea el código del atajo y las claves del buzón
    if (!inboxPriv || !state.shortcut?.pub) {
      const keys = await genKeys();
      inboxPriv = keys.priv;
      await db.setKV('vault', await V.seal(vaultData()));
      await saveShortcut({ ...state.shortcut, k: state.shortcut?.k || newCode(), pub: keys.pub });
      rewrite = false;
    }
    if (rewrite) await writeVault();
    if (state.meta.ui?.privacy !== state.privacy) syncUi();
    syncMenu();
    await drainInbox();
  });
}

/** Bloquea la app. Con cifrado, guarda lo pendiente y borra de la memoria la clave y los datos. */
export function lockApp() {
  if (state.locked) return;
  apply({ locked: true, sheet: null, toast: null, settingsAuth: false, finCfgAuth: false, quickMenu: false });
  if (!sealed() || !V.isOpen()) return;
  if (settingsTimer != null || settingsDirty || finDirty) {
    clearTimeout(settingsTimer);
    settingsTimer = null;
    settingsDirty = false;
    finDirty = false;
    persist(writeVault);
  }
  serial(() => {
    V.close();
    inboxPriv = null;
    clearClassifiedCache();
    apply({
      ...freshDefaults(),
      theme: state.theme,
      variant: state.variant,
      sessions: [],
      bg: [],
      inboxNotes: [],
      fin: defaultFin(),
      dismissedForgot: null,
      finFilter: 'all',
      finKey: null,
      finAcct: null,
      finView: 'resumen',
    });
  });
}

/** Quita el bloqueo: vuelve a guardar todo en claro y borra lo cifrado, en una transacción. */
export function disableVault() {
  clearTimeout(settingsTimer);
  settingsTimer = null;
  settingsDirty = false;
  finDirty = false;
  return serial(async () => {
    const shortcut = { ...state.shortcut, k: state.shortcut?.k || newCode(), pub: null };
    await db.commit({ clearSessions: true, putSessions: state.sessions, kv: { settings: pick(state), bg: state.bg, vault: null, lock: null, inbox: null, shortcut } });
    V.close();
    inboxPriv = null;
    clearClassifiedCache();
    apply({ lock: null, locked: false, fin: defaultFin(), settingsAuth: false, finCfgAuth: false, shortcut, inboxCount: 0 });
  });
}

/** Contraseña olvidada: borra sesiones (y, si estaban cifrados, también los ajustes) y quita el bloqueo. */
export function wipeData() {
  clearTimeout(settingsTimer);
  settingsTimer = null;
  settingsDirty = false;
  finDirty = false;
  return serial(async () => {
    const settings = sealed() ? { ...freshDefaults(), theme: state.theme, variant: state.variant } : pick(state);
    const shortcut = { ...state.shortcut, k: state.shortcut?.k || newCode(), pub: null, menu: null };
    await db.commit({ clearSessions: true, kv: { settings, vault: null, lock: null, bg: null, inbox: null, shortcut } });
    V.close();
    inboxPriv = null;
    clearClassifiedCache();
    apply({ ...settings, sessions: [], bg: [], fin: defaultFin(), lock: null, locked: false, sheet: null, dismissedForgot: null, settingsAuth: false, finCfgAuth: false, shortcut, inboxCount: 0, inboxNotes: [] });
    lastSettings = JSON.stringify(pick(state));
  });
}

/** Carga los datos guardados. Se llama una vez al arrancar. */
export async function init() {
  try {
    const { sessions, settings, meta, lock } = await db.loadAll();
    const [bg, sc, inbox] = await Promise.all([db.getKV('bg'), db.getKV('shortcut'), db.getKV('inbox')]);
    const m = { ...state.meta, ...(meta || {}) };
    let shortcut = sc && typeof sc.k === 'string' ? sc : null;
    if (!shortcut) {
      shortcut = { k: newCode(), pub: null };
      persist(() => db.setKV('shortcut', shortcut));
    }
    if (lock?.v === 2) {
      // Cifrado: no hay nada que leer hasta que se desbloquee.
      const ui = m.ui || {};
      apply({
        ...freshDefaults(),
        theme: THEMES.includes(ui.theme) ? ui.theme : defaults.theme,
        variant: VARIANTS.includes(ui.variant) ? ui.variant : defaults.variant,
        sessions: [], bg: [], meta: m, lock, locked: true, ready: true, shortcut,
        inboxCount: Array.isArray(inbox) ? inbox.length : 0,
      });
      return;
    }
    const loaded = migrateSettings(settings); // ajustes de versiones anteriores
    apply({ ...defaults, ...(loaded || {}), sessions, bg: Array.isArray(bg) ? bg : [], meta: m, lock, locked: !!lock, ready: true, shortcut });
    lastSettings = JSON.stringify(pick(state));
    if (loaded !== settings) persist(() => db.setKV('settings', pick(state)));
    if (!meta) setMeta({});
    syncMenu();
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

// ---------- IA en 2º plano, atajo del Botón de Acción y recorte ----------

/** Inicia o para la IA en 2º plano (pista aparte: no cierra ni la cierra la categoría en curso). */
export function toggleBg() {
  const t = now();
  if (state.bg.some((x) => x.end == null)) {
    const r = closeLane(state.bg, t, state.minSeconds * 1000);
    set({ bg: r.list });
    if (state.sound) beep('stop');
    toast(r.closed ? `Guardado · ${BG_NAME} · ${fmtDur(r.closed.end - r.closed.start)}` : 'Sesión muy corta, descartada', { kind: r.closed ? 'ok' : 'info', sensitive: !!r.closed });
    return;
  }
  set({ bg: [...state.bg, { id: newId(), cat: 'bg', start: t, end: null }] });
  if (state.sound) beep('start');
  toast(`${BG_NAME} en marcha`, { kind: 'ok' });
}

function cutText(cut) {
  const names = cut.map((s) => (s.cat === 'bg' ? BG_NAME : catOf(s.cat).short)).join(' y ');
  return `Recorté ${names} a su máximo por sesión. Revísalo en Inicio.`;
}

const cutToast = (cut) => toast(cutText(cut), { kind: 'warn', long: true, sensitive: true });

/** Recorta lo que pasó su máximo por sesión. Se llama cada segundo con la app abierta. */
export function checkOverdue() {
  if (!state.ready || state.locked) return;
  const r = trimOverdue(state, now());
  if (!r.cut.length) return;
  set({ sessions: r.sessions, bg: r.bg });
  cutToast(r.cut);
}

/** Revisión de una sesión recortada. how: 'keep' (deja el recorte) | 'real' (duró hasta ahora o hasta la siguiente). */
export function resolveCut(lane, id, how) {
  const list = state[lane];
  const s = list.find((x) => x.id === id);
  if (!s) return;
  const { cut, ...rest } = s;
  const end = how === 'real' ? realEnd(list, s, now()) : s.end;
  set({ [lane]: list.map((x) => (x.id === id ? { ...rest, end } : x)) });
  toast(`Guardado · ${s.cat === 'bg' ? BG_NAME : catOf(s.cat).short} · ${fmtDur(end - s.start)}`, { kind: 'ok', sensitive: true });
}

/** Aviso sobre una orden del atajo: en la pantalla de bloqueo si está bloqueada, si no como mensaje. */
function orderNote(n) {
  if (state.locked) apply({ inboxNotes: [...state.inboxNotes, n] });
  else toast(n.error, { kind: 'warn', long: true });
}

/**
 * Recibe una orden del atajo ({a, k, t} de parseOrder). Con los datos a mano la aplica ya;
 * con PP bloqueada (datos cifrados) la guarda cifrada en el buzón hasta el próximo desbloqueo.
 */
export function receiveOrder(raw, receivedAt = now()) {
  const sc = state.shortcut;
  if (!sc || raw.k !== sc.k) {
    orderNote({ label: raw.a, t: receivedAt, error: 'El atajo tiene un código antiguo o incorrecto. En PP, ve a Ajustes → Atajo del Botón de Acción y copia otra vez el enlace.' });
    return Promise.resolve();
  }
  if (isMenu(raw.a)) {
    apply({ quickMenu: true });
    return Promise.resolve();
  }
  const t = orderTime(raw.t, receivedAt);
  if (!sealed() || V.isOpen()) {
    if (!state.ready) return Promise.resolve();
    if (!resolveAction(raw.a, state.cats)) {
      orderNote({ label: raw.a, t, error: `No reconozco «${raw.a}». Copia otra vez la lista del menú en tu atajo (Ajustes → Atajo del Botón de Acción).` });
      return Promise.resolve();
    }
    const r = applyOrders({ ...state }, [{ a: raw.a, t }], now(), newId);
    set({ sessions: r.sessions, bg: r.bg, dismissedForgot: null }, { immediate: true });
    if (state.sound) beep('start');
    orderToast(r);
    return Promise.resolve();
  }
  if (!sc.pub) {
    orderNote({ label: raw.a, t, error: 'Entra a PP una vez para activar el atajo y vuelve a intentarlo.' });
    return Promise.resolve();
  }
  return serial(async () => {
    const ct = await sealOrder(sc.pub, { a: raw.a, t });
    const list = await db.getKV('inbox');
    const next = [...(Array.isArray(list) ? list : []), ct].slice(-200);
    await db.setKV('inbox', next);
    apply({ inboxCount: next.length, inboxNotes: [...state.inboxNotes, { label: raw.a, t }] });
  }).catch(() => orderNote({ label: raw.a, t, error: 'No se pudo guardar la orden. Inténtalo de nuevo.' }));
}

/**
 * Al abrir PP (o volver a ella) muestra el menú «¿Qué haces ahora?», si está activado.
 * iOS abre la app instalada pero descarta lo que va tras la dirección (?a=menu), así que
 * el atajo del Botón de Acción solo abre PP y el menú sale por esta vía.
 */
export function showMenuOnOpen(fromShortcut = false) {
  const s = state;
  if (!s.ready || s.quickMenu || s.sheet || (!fromShortcut && s.shortcut?.openMenu !== true)) return;
  if (s.locked && !(sealed() ? s.shortcut?.menu?.length : true)) return;
  apply({ quickMenu: true });
}

/** Dirección con la que se abrió PP la última vez (diagnóstico del atajo, solo en memoria). */
export function setLaunch(url, t) {
  apply({ launch: { url, t } });
}

/** Activa o desactiva el menú al abrir PP (se guarda en claro: hace falta antes de desbloquear). */
export function setOpenMenu(on) {
  const rec = { ...(state.shortcut || { k: newCode(), pub: null }), openMenu: on };
  apply({ shortcut: rec });
  persist(() => db.setKV('shortcut', rec));
}

/** Opción elegida en el menú «¿Qué haces ahora?»: cuenta la hora del toque. */
export function chooseQuick(label) {
  apply({ quickMenu: false });
  return receiveOrder({ a: label, k: state.shortcut?.k }, now());
}

/** Cambia el código secreto del atajo (el enlace anterior deja de funcionar). */
export function newShortcutCode() {
  const rec = { ...(state.shortcut || { pub: null }), k: newCode() };
  apply({ shortcut: rec });
  persist(() => db.setKV('shortcut', rec));
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
  const removed = state.sessions.find((x) => x.id === id);
  if (!removed) return;
  set({ sessions: state.sessions.filter((x) => x.id !== id) });
  toast('Sesión eliminada', {
    action: {
      label: 'Deshacer',
      fn: () => {
        const cur = getState().sessions;
        if (cur.some((x) => x.id === removed.id)) return;
        let list = cur;
        if (removed.end == null && cur.some((x) => x.end == null)) {
          list = cur.map((x) => (x.end == null ? { ...x, end: Math.max(x.start, now()) } : x));
        }
        set({ sessions: [...list, removed].sort((a, b) => a.start - b.start) });
      },
    },
  });
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
  const affected = [];
  const createdIds = new Set();
  for (const s of prev) {
    const hit = (catId === 'all' || s.cat === catId) && (s.end ?? t) > from;
    if (!hit) { next.push(s); continue; }
    affected.push(s);
    if (s.start < from) {
      const trimmed = { ...s, end: from };
      next.push(trimmed);
      createdIds.add(trimmed.id);
    }
    if (s.end == null) {
      const restarted = s.start < from ? { ...s, id: newId(), start: t } : { ...s, start: t };
      next.push(restarted);
      createdIds.add(restarted.id);
    }
  }
  set({ sessions: next.sort((a, b) => a.start - b.start), dismissedForgot: null });
  toast('Tiempo reiniciado', {
    kind: 'ok',
    action: {
      label: 'Deshacer',
      fn: () => {
        const cur = getState().sessions.filter((x) => !createdIds.has(x.id));
        const have = new Set(cur.map((x) => x.id));
        const hasActiveNew = cur.some((x) => x.end == null);
        const restore = affected
          .filter((x) => !have.has(x.id))
          .map((x) => (hasActiveNew && x.end == null ? { ...x, end: Math.max(x.start, now()) } : x));
        set({ sessions: [...cur, ...restore].sort((a, b) => a.start - b.start) });
      },
    },
  });
}

/** Restablece ajustes y categorías por defecto, conservando las categorías propias (tienen historial). */
export function resetSettings() {
  const extra = state.cats.filter((c) => !defaults.cats.some((d) => d.id === c.id));
  set({ ...pick(defaults), cats: [...defaults.cats.map((c) => ({ ...c })), ...extra], groups: defaults.groups.map((g) => ({ ...g, cats: [...g.cats] })) });
}

// ---------- Categorías y topes ----------

export function updateCategory(id, patch) {
  set({ cats: state.cats.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

export function addCategory() {
  const used = new Set(liveCats(state).map((c) => c.color));
  const color = [1, 2, 3, 4, 5, 6].find((n) => !used.has(n)) || 1;
  const c = { id: 'c' + newId(), name: 'Nueva categoría', short: 'Nueva', color, icon: 'star', cap: null, max: null, archived: false };
  set({ cats: [...state.cats, c] });
  return c.id;
}

export function moveCategory(id, dir) {
  const cats = [...state.cats];
  const i = cats.findIndex((c) => c.id === id);
  if (i < 0) return;
  const arch = !!cats[i].archived;
  let j = i + dir;
  while (j >= 0 && j < cats.length && !!cats[j].archived !== arch) j += dir;
  if (j < 0 || j >= cats.length) return;
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
  const catIdx = state.cats.findIndex((c) => c.id === id);
  const removedCat = state.cats[catIdx];
  if (!removedCat) return false;
  const removedSessions = state.sessions.filter((s) => s.cat === id);
  const groupIds = state.groups.filter((g) => g.cats.includes(id)).map((g) => g.id);
  set({
    cats: state.cats.filter((c) => c.id !== id),
    groups: state.groups.map((g) => ({ ...g, cats: g.cats.filter((x) => x !== id) })),
    sessions: state.sessions.filter((s) => s.cat !== id),
  });
  toast('Categoría eliminada', {
    action: {
      label: 'Deshacer',
      fn: () => {
        const cur = getState();
        const cats = cur.cats.some((c) => c.id === id)
          ? cur.cats
          : [...cur.cats.slice(0, catIdx), removedCat, ...cur.cats.slice(catIdx)];
        const groups = cur.groups.map((g) => (groupIds.includes(g.id) && !g.cats.includes(id) ? { ...g, cats: [...g.cats, id] } : g));
        const have = new Set(cur.sessions.map((s) => s.id));
        const hasActive = cur.sessions.some((s) => s.end == null);
        const restoreSess = removedSessions
          .filter((s) => !have.has(s.id))
          .map((s) => (hasActive && s.end == null ? { ...s, end: Math.max(s.start, now()) } : s));
        set({ cats, groups, sessions: [...cur.sessions, ...restoreSess].sort((a, b) => a.start - b.start) });
      },
    },
  });
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
  const idx = state.groups.findIndex((g) => g.id === id);
  const removed = state.groups[idx];
  if (!removed) return;
  set({ groups: state.groups.filter((g) => g.id !== id) });
  toast('Tope eliminado', {
    action: {
      label: 'Deshacer',
      fn: () => {
        const cur = getState().groups;
        if (cur.some((g) => g.id === id)) return;
        set({ groups: [...cur.slice(0, idx), removed, ...cur.slice(idx)] });
      },
    },
  });
}
