// Flujo de importación: leer PDFs → mostrar vista previa → unir con los datos.
import { getState, set, setFin, toast } from '../store.js';
import { parseStatement } from './statements.js';
import { mergeStatement, previewImport } from './importer.js';
import { PdfPasswordError, pdfItems } from './pdf.js';
import { periodOf } from './stats.js';

/** Lee un archivo y devuelve {name, st} | {name, needsPassword, data} | {name, error}. */
async function readOne(name, data, password) {
  try {
    const items = await pdfItems(data.slice(0), password);
    return { name, st: parseStatement(items) };
  } catch (e) {
    if (e instanceof PdfPasswordError) return { name, needsPassword: true, wrong: !!password, data };
    return { name, error: e.message || 'No se pudo leer el archivo.' };
  }
}

/** Lee los PDF elegidos y abre la vista previa. */
export async function readStatements(files) {
  toast('Leyendo extracto…', { kind: 'info' });
  const results = [];
  for (const file of files) results.push(await readOne(file.name, new Uint8Array(await file.arrayBuffer())));
  set({ toast: null, sheet: { type: 'stmt', results } });
}

/** Reintenta un PDF con contraseña. */
export async function retryWithPassword(index, password) {
  const sh = getState().sheet;
  const r = sh.results[index];
  const next = await readOne(r.name, r.data, password);
  set({ sheet: { ...sh, results: sh.results.map((x, i) => (i === index ? next : x)) } });
}

export function preview(st) {
  return previewImport(getState().fin, st);
}

/** Une los extractos leídos y muestra el periodo importado. */
export function commitStatements(sts) {
  let f = getState().fin;
  let added = 0;
  for (const st of sts) {
    const before = f.movs.length;
    f = mergeStatement(f, st);
    added += f.movs.length - before;
  }
  const last = sts.map((s) => s.period.to).sort().at(-1);
  set({ fin: f, sheet: null, finView: 'resumen', finKey: periodOf(last, f.monthStart) });
  toast(added > 0 ? `Importados ${added} movimientos` : 'Sin movimientos nuevos: ya estaban importados', { kind: 'ok' });
}

export { setFin };
