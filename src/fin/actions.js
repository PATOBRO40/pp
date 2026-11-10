// Correcciones de clasificación. Por defecto se aplican a todos los movimientos de la misma
// persona o comercio, en todos los meses (pasados y futuros), guardándolas como regla (memo).
import { getState, setFin, toast } from '../store.js';
import { classify } from './classify.js';

/** Cuántos movimientos comparten la persona/comercio de este movimiento. */
export function sameParty(f, id) {
  const cls = classify(f);
  const key = cls.get(id)?.key;
  if (!key) return { key: null, count: 1 };
  return { key, count: f.movs.filter((m) => cls.get(m.id)?.key === key).length };
}

/**
 * val: {type, cat}. all: aplicar a todos los de esa persona/comercio (regla) o solo a este.
 * Devuelve cuántos movimientos quedaron afectados.
 */
export function applyCorrection(id, val, all = true) {
  const f = getState().fin;
  const cls = classify(f);
  const key = cls.get(id)?.key;
  if (all && key) {
    const n = f.movs.filter((m) => cls.get(m.id)?.key === key).length;
    setFin((x) => ({
      ...x,
      memo: { ...x.memo, [key]: val },
      // La regla manda: se quitan las correcciones sueltas de ese nombre
      movs: x.movs.map((m) => (cls.get(m.id)?.key === key && m.src !== 'manual' && m.manual ? { ...m, manual: undefined } : m)),
    }));
    return n;
  }
  setFin((x) => ({ ...x, movs: x.movs.map((m) => (m.id === id ? { ...m, manual: val } : m)) }));
  return 1;
}

/** Quita la regla de una persona/comercio: vuelve a la clasificación automática. */
export function forgetParty(key) {
  const prev = getState().fin;
  setFin((x) => { const memo = { ...x.memo }; delete memo[key]; return { ...x, memo }; });
  toast('Regla quitada', { action: { label: 'Deshacer', fn: () => setFin(() => prev) } });
}
