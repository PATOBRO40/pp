// Extrae el texto de un PDF con pdf.js, que va incluido en la app: el archivo nunca sale del dispositivo.
// Se carga solo al importar un extracto.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

export class PdfPasswordError extends Error {}

/** Devuelve [{str, x, y, page}] de todas las páginas. Lanza PdfPasswordError si el PDF pide contraseña. */
export async function pdfItems(data, password) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data, password, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    task.destroy();
    if (e?.name === 'PasswordException') throw new PdfPasswordError(e.code === 2 ? 'Contraseña incorrecta' : 'El PDF tiene contraseña');
    throw new Error('No se pudo abrir el PDF.');
  }
  const items = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      for (const it of tc.items) if (it.str) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], page: p });
    }
  } finally {
    task.destroy();
  }
  return items;
}
