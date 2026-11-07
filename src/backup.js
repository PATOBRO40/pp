// Respaldo en JSON: exportar (hoja de compartir de iOS / descarga) e importar con validación.
import { SETTING_KEYS, getState, newId, set, setMeta, toast } from './store.js';
import { dayKey } from './time.js';

const SCHEMA = 1;

export function buildBackup() {
  const s = getState();
  return {
    app: 'PP',
    schema: SCHEMA,
    exportedAt: Date.now(),
    settings: Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]])),
    sessions: s.sessions,
  };
}

/** Debe llamarse directamente desde un toque (iOS exige gesto del usuario para compartir). */
export async function exportBackup() {
  const name = `PP-respaldo-${dayKey(Date.now())}.json`;
  const file = new File([JSON.stringify(buildBackup(), null, 1)], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Respaldo PP' });
      setMeta({ lastBackupAt: Date.now() });
      toast('Respaldo exportado', { kind: 'ok' });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return; // el usuario cerró la hoja de compartir
  }
  // Alternativa: descarga directa (en iOS se guarda en Archivos)
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  setMeta({ lastBackupAt: Date.now() });
  toast('Respaldo descargado', { kind: 'ok' });
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

function validSettings(s) {
  if (!s || typeof s !== 'object') return null;
  const okCats = Array.isArray(s.cats) && s.cats.length > 0 &&
    s.cats.every((c) => c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.group === 'string' && isNum(c.color));
  const okGroups = Array.isArray(s.groups) && s.groups.every((g) => g && typeof g.id === 'string' && typeof g.name === 'string' && isNum(g.hours));
  if (!okCats || !okGroups) return null;
  const out = {};
  for (const k of SETTING_KEYS) if (k in s) out[k] = s[k];
  return out;
}

/** Valida el texto de un respaldo. Devuelve {sessions, settings, exportedAt, skipped} o {error}. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { error: 'El archivo no es un JSON válido.' }; }
  if (!data || data.app !== 'PP' || !Array.isArray(data.sessions)) return { error: 'Este archivo no es un respaldo de PP.' };
  if (!isNum(data.schema) || data.schema > SCHEMA) return { error: 'El respaldo es de una versión más nueva de la app.' };

  const settings = validSettings(data.settings);
  const catIds = new Set((settings?.cats || getState().cats).map((c) => c.id));
  const exportedAt = isNum(data.exportedAt) ? data.exportedAt : Date.now();
  const seen = new Set();
  const sessions = [];
  let skipped = 0;
  for (const r of data.sessions) {
    const end = r?.end == null ? exportedAt : r.end; // una sesión activa se cierra al momento de exportar
    const good = r && catIds.has(r.cat) && isNum(r.start) && isNum(end) && end > r.start;
    if (!good) { skipped++; continue; }
    const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : newId();
    seen.add(id);
    sessions.push({ id, cat: r.cat, start: r.start, end, note: typeof r.note === 'string' ? r.note.slice(0, 80) : '' });
  }
  return { sessions, settings, exportedAt, skipped };
}

/** mode: 'merge' agrega lo que falta; 'replace' sustituye todo. Deja copia para deshacer. */
export function applyImport(parsed, mode) {
  const before = getState();
  const snapshot = { sessions: before.sessions, ...Object.fromEntries(SETTING_KEYS.map((k) => [k, before[k]])) };
  let sessions;
  if (mode === 'replace') {
    sessions = parsed.sessions;
    set({ ...(parsed.settings || {}), sessions });
  } else {
    const key = (s) => `${s.cat}|${s.start}`;
    const have = new Set(before.sessions.map(key));
    const ids = new Set(before.sessions.map((s) => s.id));
    const extra = parsed.sessions
      .filter((s) => !have.has(key(s)))
      .map((s) => (ids.has(s.id) ? { ...s, id: newId() } : s));
    sessions = [...before.sessions, ...extra].sort((a, b) => a.start - b.start);
    set({ sessions });
    toast(`Importadas ${extra.length} sesiones nuevas`, { kind: 'ok', action: { label: 'Deshacer', fn: () => set(snapshot) } });
    return;
  }
  toast(`Respaldo restaurado · ${parsed.sessions.length} sesiones`, { kind: 'ok', action: { label: 'Deshacer', fn: () => set(snapshot) } });
}
