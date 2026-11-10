// Respaldo en JSON: exportar (hoja de compartir de iOS / descarga) e importar con validación.
// Puede ir cifrado con una contraseña propia del respaldo (AES-GCM, ver vault.js).
import { SETTING_KEYS, getState, newId, set, setMeta, toast } from './store.js';
import { dayKey } from './time.js';
import { migrateSettings } from './model.js';
import { hasFinData, migrateFin } from './fin/model.js';
import { openWithPassword, sealWithPassword } from './vault.js';

const SCHEMA = 3; // 2: topes compartidos · 3: Dinero y respaldos cifrados

export function buildBackup() {
  const s = getState();
  return {
    app: 'PP',
    schema: SCHEMA,
    exportedAt: Date.now(),
    settings: Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]])),
    sessions: s.sessions,
    ...(hasFinData(s.fin) ? { fin: s.fin } : {}),
  };
}

/** Prepara el archivo. Con contraseña, todo el contenido va cifrado. */
export async function makeBackupFile(password) {
  const day = dayKey(Date.now());
  if (!password) return new File([JSON.stringify(buildBackup(), null, 1)], `PP-respaldo-${day}.json`, { type: 'application/json' });
  const encrypted = await sealWithPassword(JSON.stringify(buildBackup()), password);
  return new File([JSON.stringify({ app: 'PP', schema: SCHEMA, encrypted })], `PP-respaldo-cifrado-${day}.json`, { type: 'application/json' });
}

/** Comparte o descarga un archivo ya preparado. Debe llamarse directamente desde un toque (lo exige iOS). */
export async function shareBackup(file) {
  const name = file.name;
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

function validSettings(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = migrateSettings(raw); // acepta respaldos de versiones anteriores
  const okCats = Array.isArray(s.cats) && s.cats.length > 0 &&
    s.cats.every((c) => c && typeof c.id === 'string' && typeof c.name === 'string' && isNum(c.color) && (c.cap == null || isNum(c.cap)));
  const okGroups = Array.isArray(s.groups) &&
    s.groups.every((g) => g && typeof g.id === 'string' && typeof g.name === 'string' && isNum(g.hours) && Array.isArray(g.cats));
  if (!okCats || !okGroups) return null;
  const out = {};
  for (const k of SETTING_KEYS) if (k in s) out[k] = s[k];
  out.cats = s.cats.map((c) => ({ ...c, short: c.short || c.name, icon: c.icon || 'star', cap: c.cap ?? null, archived: !!c.archived }));
  return out;
}

/** Respaldo sin cifrar, directo desde un toque. */
export async function exportBackup() {
  return shareBackup(await makeBackupFile());
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Valida los datos de Dinero de un respaldo. */
function validFin(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const f = migrateFin(raw);
  f.movs = f.movs.filter((m) => m && typeof m.id === 'string' && typeof m.acct === 'string' && DATE.test(m.date) &&
    Number.isInteger(m.amount) && typeof m.desc === 'string');
  f.stmts = f.stmts.filter((x) => x && typeof x.key === 'string' && DATE.test(x.to));
  f.incomes = f.incomes.filter((i) => i && typeof i.id === 'string' && Number.isInteger(i.amount));
  return f;
}

/** Descifra un respaldo cifrado. Devuelve el texto JSON o lanza un error si la contraseña no sirve. */
export function decryptBackup(encrypted, password) {
  return openWithPassword(encrypted, password);
}

/** Valida el texto de un respaldo. Devuelve {sessions, settings, fin, exportedAt, skipped}, {encrypted} o {error}. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { error: 'El archivo no es un JSON válido.' }; }
  if (data?.app === 'PP' && data.encrypted?.ct) return { encrypted: data.encrypted };
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
  return { sessions, settings, fin: validFin(data.fin), exportedAt, skipped };
}

/** mode: 'merge' agrega lo que falta; 'replace' sustituye todo. Deja copia para deshacer. */
export function applyImport(parsed, mode) {
  const before = getState();
  const snapshot = { sessions: before.sessions, fin: before.fin, ...Object.fromEntries(SETTING_KEYS.map((k) => [k, before[k]])) };
  // Dinero solo se guarda cifrado: sin bloqueo activo no se importa
  const finOk = !!parsed.fin && before.lock?.v === 2;
  let sessions;
  if (mode === 'replace') {
    sessions = parsed.sessions;
    set({ ...(parsed.settings || {}), sessions, ...(finOk ? { fin: parsed.fin } : {}) });
  } else {
    if (finOk) {
      const f = before.fin;
      const ids = new Set(f.movs.map((m) => m.id));
      const keys = new Set(f.stmts.map((x) => x.key));
      set({ fin: {
        ...f,
        owner: f.owner || parsed.fin.owner,
        memo: { ...parsed.fin.memo, ...f.memo },
        movs: [...f.movs, ...parsed.fin.movs.filter((m) => !ids.has(m.id))].sort((a, b) => a.date.localeCompare(b.date)),
        stmts: [...f.stmts, ...parsed.fin.stmts.filter((x) => !keys.has(x.key))],
        incomes: f.incomes.length ? f.incomes : parsed.fin.incomes,
      } });
    }
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
