// Respaldo en JSON: exportar (hoja de compartir de iOS / descarga) e importar con validación.
// Puede ir cifrado con una contraseña propia del respaldo (AES-GCM, ver vault.js).
import { SETTING_KEYS, getState, newId, set, setMeta, toast } from './store.js';
import { pauseAutoLock, resumeAutoLock } from './lock.js';
import { dayKey } from './time.js';
import { migrateSettings } from './model.js';
import { defaultFin, hasFinData, migrateFin } from './fin/model.js';
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
    ...(s.bg?.length ? { bg: s.bg } : {}),
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
  pauseAutoLock();
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Respaldo PP' });
      setMeta({ lastBackupAt: Date.now() });
      toast('Respaldo exportado', { kind: 'ok' });
      return true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return false; // el usuario cerró la hoja de compartir
  } finally {
    resumeAutoLock();
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
  return true;
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const THEMES = new Set(['auto', 'dark', 'light']);
const VARIANTS = new Set(['aurora', 'neon', 'editorial']);
const PRIVACIES = new Set(['off', 'data', 'all']);

function validSettings(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = migrateSettings(raw); // acepta respaldos de versiones anteriores
  const okCats = Array.isArray(s.cats) && s.cats.length > 0 &&
    s.cats.every((c) => c && typeof c.id === 'string' && c.id && typeof c.name === 'string' && isNum(c.color) && (c.cap == null || (isNum(c.cap) && c.cap > 0)));
  const okGroups = Array.isArray(s.groups) &&
    s.groups.every((g) => g && typeof g.id === 'string' && g.id && typeof g.name === 'string' && isNum(g.hours) && g.hours > 0 &&
      Array.isArray(g.cats) && g.cats.every((id) => typeof id === 'string'));
  if (!okCats || !okGroups) return null;
  const out = {};
  for (const k of SETTING_KEYS) if (k in s) out[k] = s[k];
  if ('theme' in out && !THEMES.has(out.theme)) delete out.theme;
  if ('variant' in out && !VARIANTS.has(out.variant)) delete out.variant;
  if ('privacy' in out && !PRIVACIES.has(out.privacy)) delete out.privacy;
  if ('warnPct' in out && (!isNum(out.warnPct) || out.warnPct < 10 || out.warnPct > 100)) delete out.warnPct;
  if ('forgetHours' in out && (!isNum(out.forgetHours) || out.forgetHours < 1 || out.forgetHours > 24)) delete out.forgetHours;
  if ('minSeconds' in out && (!isNum(out.minSeconds) || out.minSeconds < 0 || out.minSeconds > 120)) delete out.minSeconds;
  if ('sound' in out && typeof out.sound !== 'boolean') delete out.sound;
  if ('bgMax' in out && (!isNum(out.bgMax) || out.bgMax < 0 || out.bgMax > 24)) delete out.bgMax;
  const okMax = (m) => isNum(m) && m > 0 && m <= 24;
  out.cats = s.cats.map((c) => ({ ...c, short: c.short || c.name, icon: c.icon || 'star', cap: c.cap ?? null, max: okMax(c.max) ? c.max : null, archived: !!c.archived }));
  if (!out.cats.some((c) => !c.archived)) out.cats[0] = { ...out.cats[0], archived: false };
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
  const d = defaultFin();
  const f = migrateFin(raw);
  f.owner = typeof f.owner === 'string' ? f.owner : '';
  f.monthStart = Number.isInteger(f.monthStart) && f.monthStart >= 1 && f.monthStart <= 28 ? f.monthStart : d.monthStart;
  f.recargas = f.recargas === 'propia' || f.recargas === 'ingreso' ? f.recargas : d.recargas;
  f.cats = f.cats.filter((c) => c && typeof c.id === 'string' && c.id && typeof c.name === 'string')
    .map((c) => ({ ...c, color: isNum(c.color) && c.color >= 1 && c.color <= 6 ? c.color : 1, icon: typeof c.icon === 'string' ? c.icon : 'star' }));
  if (!f.cats.length) f.cats = d.cats;
  if (!f.cats.some((c) => c.id === 'rest')) f.cats = [...f.cats, d.cats.find((c) => c.id === 'rest')];
  f.bands = f.bands.filter((b) => b && isNum(b.from) && b.from >= 0 && typeof b.cat === 'string' && ['alta', 'media', 'baja'].includes(b.conf));
  if (!f.bands.length) f.bands = d.bands;
  f.merchants = f.merchants.filter((m) => m && typeof m.text === 'string' && typeof m.cat === 'string');
  f.memo = Object.fromEntries(Object.entries(f.memo || {}).filter(([k, v]) => k && v && typeof v === 'object' && typeof v.type === 'string'));
  f.qrSmall = {
    on: !!f.qrSmall?.on,
    below: isNum(f.qrSmall?.below) && f.qrSmall.below >= 0 ? f.qrSmall.below : d.qrSmall.below,
    cat: typeof f.qrSmall?.cat === 'string' ? f.qrSmall.cat : d.qrSmall.cat,
  };
  f.unknownBuy = typeof f.unknownBuy === 'string' ? f.unknownBuy : d.unknownBuy;
  f.movs = f.movs.filter((m) => m && typeof m.id === 'string' && typeof m.acct === 'string' && DATE.test(m.date) &&
    Number.isInteger(m.amount) && typeof m.desc === 'string');
  f.stmts = f.stmts.filter((x) => x && typeof x.key === 'string' && ['nequi', 'nu'].includes(x.bank) &&
    DATE.test(x.from) && DATE.test(x.to));
  f.incomes = f.incomes.filter((i) => i && typeof i.id === 'string' && Number.isInteger(i.amount) && i.amount > 0);
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
  if (!isNum(data.schema) || data.schema < 1 || data.schema > SCHEMA) return { error: 'El respaldo es de una versión más nueva de la app.' };

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
  const bg = [];
  for (const r of Array.isArray(data.bg) ? data.bg : []) {
    const end = r?.end == null ? exportedAt : r.end;
    if (!r || !isNum(r.start) || !isNum(end) || end <= r.start) continue;
    const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : newId();
    seen.add(id);
    bg.push({ id, cat: 'bg', start: r.start, end });
  }
  return { sessions, bg, settings, fin: validFin(data.fin), exportedAt, skipped };
}

/** mode: 'merge' agrega lo que falta; 'replace' sustituye todo. Deja copia para deshacer. */
export function applyImport(parsed, mode) {
  const before = getState();
  const snapshot = { sessions: before.sessions, bg: before.bg, fin: before.fin, ...Object.fromEntries(SETTING_KEYS.map((k) => [k, before[k]])) };
  const pbg = parsed.bg || [];
  // Dinero solo se guarda cifrado: sin bloqueo activo no se importa
  const finOk = !!parsed.fin && before.lock?.v === 2;
  if (mode === 'replace') {
    set({ ...(parsed.settings || {}), sessions: parsed.sessions, bg: pbg, ...(finOk ? { fin: parsed.fin } : {}) }, { immediate: true });
    toast(`Respaldo restaurado · ${parsed.sessions.length} sesiones`, { kind: 'ok', action: { label: 'Deshacer', fn: () => set(snapshot, { immediate: true }) } });
    return;
  }
  let finMerge = null;
  if (finOk) {
    const f = before.fin;
    const ids = new Set(f.movs.map((m) => m.id));
    const keys = new Set(f.stmts.map((x) => x.key));
    const haveCats = new Set(f.cats.map((c) => c.id));
    const extraFinCats = parsed.fin.cats.filter((c) => !haveCats.has(c.id));
    const cats = extraFinCats.length
      ? [...f.cats.filter((c) => c.id !== 'rest'), ...extraFinCats, ...f.cats.filter((c) => c.id === 'rest')]
      : f.cats;
    finMerge = {
      ...f,
      cats,
      owner: f.owner || parsed.fin.owner,
      memo: { ...parsed.fin.memo, ...f.memo },
      movs: [...f.movs, ...parsed.fin.movs.filter((m) => !ids.has(m.id))].sort((a, b) => a.date.localeCompare(b.date)),
      stmts: [...f.stmts, ...parsed.fin.stmts.filter((x) => !keys.has(x.key))],
      incomes: f.incomes.length ? f.incomes : parsed.fin.incomes,
    };
  }
  const key = (s) => `${s.cat}|${s.start}`;
  const have = new Set(before.sessions.map(key));
  const ids = new Set(before.sessions.map((s) => s.id));
  const extra = parsed.sessions
    .filter((s) => !have.has(key(s)))
    .map((s) => (ids.has(s.id) ? { ...s, id: newId() } : s));
  const haveSessCats = new Set(before.cats.map((c) => c.id));
  const usedMissing = new Set(extra.map((s) => s.cat).filter((id) => !haveSessCats.has(id)));
  const extraCats = (parsed.settings?.cats || []).filter((c) => usedMissing.has(c.id));
  const sessions = [...before.sessions, ...extra].sort((a, b) => a.start - b.start);
  const bgStarts = new Set(before.bg.map((s) => s.start));
  const bgIds = new Set(before.bg.map((s) => s.id));
  const extraBg = pbg.filter((s) => !bgStarts.has(s.start)).map((s) => (bgIds.has(s.id) ? { ...s, id: newId() } : s));
  // Una sesión en curso de IA en 2º plano sigue siendo la única abierta
  const bg = extraBg.length ? [...before.bg, ...extraBg].sort((a, b) => a.start - b.start) : before.bg;
  set({
    ...(extraBg.length ? { bg } : {}),
    ...(extraCats.length ? { cats: [...before.cats, ...extraCats] } : {}),
    ...(finMerge ? { fin: finMerge } : {}),
    sessions,
  }, { immediate: true });
  toast(`Importadas ${extra.length} sesiones nuevas`, { kind: 'ok', action: { label: 'Deshacer', fn: () => set(snapshot, { immediate: true }) } });
}
