// Modelo de categorías y topes (ajustes versión 2).
//   cats:   [{ id, name, short, color, icon, cap, archived }]  (el orden del array es el de la app)
//           cap = tope propio en horas por semana, o null.
//   groups: [{ id, name, hours, cats: [ids] }]  topes compartidos; una categoría puede estar en varios.

export const SETTINGS_VERSION = 2;

export const ICONS = ['ia', 'sin', 'chat', 'game', 'tv', 'proy', 'book', 'code', 'music', 'heart', 'star'];
const DEFAULT_ICON = { ia: 'ia', sin: 'sin', proy: 'proy', iarec: 'chat', juegos: 'game', series: 'tv' };

export const defaults = {
  settingsVersion: SETTINGS_VERSION,
  cats: [
    { id: 'ia', name: 'Ensoñaciones con IA', short: 'Con IA', color: 1, icon: 'ia', cap: null, archived: false },
    { id: 'sin', name: 'Ensoñaciones sin IA', short: 'Sin IA', color: 2, icon: 'sin', cap: null, archived: false },
    { id: 'iarec', name: 'Uso recreativo de IA', short: 'IA recreativa', color: 5, icon: 'chat', cap: 15, archived: false },
    { id: 'juegos', name: 'Videojuegos', short: 'Videojuegos', color: 4, icon: 'game', cap: 21, archived: false },
    { id: 'series', name: 'Series', short: 'Series', color: 6, icon: 'tv', cap: 21, archived: false },
    { id: 'proy', name: 'Proyectos', short: 'Proyectos', color: 3, icon: 'proy', cap: 10, archived: false },
  ],
  groups: [
    { id: 'sonar', name: 'Ensoñaciones', hours: 20, cats: ['ia', 'sin'] },
    { id: 'ent', name: 'Entretenimiento', hours: 30, cats: ['juegos', 'series'] },
    { id: 'iatot', name: 'Uso de IA', hours: 25, cats: ['ia', 'iarec'] },
  ],
  warnPct: 80,
  sound: true,
  forgetHours: 8,
  minSeconds: 5,
  theme: 'dark',
  variant: 'aurora',
};

const ORDER = defaults.cats.map((c) => c.id);

/**
 * Convierte ajustes de la versión 1 (cada categoría en un solo grupo) a la 2.
 * Conserva nombres, colores y horas del usuario. Un grupo de una sola categoría
 * pasa a ser su tope propio, y se añaden las categorías y topes nuevos.
 */
export function migrateSettings(s) {
  if (!s || s.settingsVersion >= SETTINGS_VERSION) return s;
  const oldCats = Array.isArray(s.cats) ? s.cats : [];
  let cats = oldCats.map((c) => ({
    id: c.id, name: c.name, short: c.short || c.name, color: c.color,
    icon: DEFAULT_ICON[c.id] || 'star', cap: null, archived: false,
  }));
  const groups = [];
  for (const g of Array.isArray(s.groups) ? s.groups : []) {
    const members = oldCats.filter((c) => c.group === g.id).map((c) => c.id);
    if (members.length === 1) cats = cats.map((c) => (c.id === members[0] ? { ...c, cap: g.hours } : c));
    else if (members.length > 1) groups.push({ id: g.id, name: g.name, hours: g.hours, cats: members });
  }
  for (const d of defaults.cats) if (!cats.some((c) => c.id === d.id)) cats.push({ ...d });
  for (const d of defaults.groups) {
    if (!groups.some((g) => g.id === d.id)) groups.push({ ...d, cats: d.cats.filter((id) => cats.some((c) => c.id === id)) });
  }
  const rank = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  cats.sort((a, b) => rank(a.id) - rank(b.id));
  return { ...s, settingsVersion: SETTINGS_VERSION, cats, groups };
}

/** Categoría por id; si ya no existe, un sustituto para no romper el historial. */
export function catById(st, id) {
  return st.cats.find((c) => c.id === id) || { id, name: 'Categoría eliminada', short: 'Eliminada', color: 0, icon: 'star', cap: null, archived: true };
}

/** Categorías activas (las que tienen tarjeta). */
export const liveCats = (st) => st.cats.filter((c) => !c.archived);

/** Activas más las archivadas que tengan tiempo en `totals`. */
export const catsWithData = (st, totals) => st.cats.filter((c) => !c.archived || (totals[c.id] || 0) > 0);

const groupCap = (g) => ({ key: 'g:' + g.id, name: g.name, hours: g.hours, cats: g.cats, shared: true });
const catCap = (c) => ({ key: 'c:' + c.id, name: c.short, hours: c.cap, cats: [c.id], shared: false });
const hasCap = (c) => c.cap != null && c.cap > 0;

/** Todos los topes (compartidos y propios): para alertas y estadísticas. */
export function allCaps(st) {
  return [...st.groups.map(groupCap), ...st.cats.filter(hasCap).map(catCap)];
}

/** Topes compartidos y los propios de categorías que no están en ninguno compartido. */
export function topLevelCaps(st) {
  const inGroup = new Set(st.groups.flatMap((g) => g.cats));
  return [...st.groups.map(groupCap), ...st.cats.filter((c) => hasCap(c) && !inGroup.has(c.id)).map(catCap)];
}

/** Avisos de topes que nunca se alcanzarían antes que los propios. */
export function groupHints(st, g) {
  const members = g.cats.map((id) => catById(st, id));
  const hints = [];
  for (const c of members) if (hasCap(c) && c.cap >= g.hours) hints.push(`El tope propio de «${c.short}» (${c.cap} h) no llega a contar: el común es de ${g.hours} h.`);
  if (members.length && members.every(hasCap)) {
    const total = members.reduce((a, c) => a + c.cap, 0);
    if (total <= g.hours) hints.push(`Este tope nunca se alcanzará: los topes propios suman ${total} h.`);
  }
  return hints;
}
