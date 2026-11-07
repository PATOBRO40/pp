// Capa de persistencia sobre IndexedDB.
//   sessions: una fila por sesión (keyPath "id")
//   kv:       ajustes ("settings") y metadatos ("meta")
// Safari iOS a veces cierra la conexión al pasar la app a segundo plano,
// por eso cada operación reabre la base y reintenta una vez si falla.

const NAME = 'pp';
const VERSION = 1;
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = () => {
        const d = req.result;
        d.onclose = d.onversionchange = () => { dbp = null; };
        resolve(d);
      };
      req.onerror = () => { dbp = null; reject(req.error); };
    });
  }
  return dbp;
}

async function run(stores, mode, fn, retry = true) {
  try {
    const d = await open();
    return await new Promise((resolve, reject) => {
      const tx = d.transaction(stores, mode);
      const out = fn(tx);
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    dbp = null;
    if (retry) return run(stores, mode, fn, false);
    throw e;
  }
}

/** Lee todo al arrancar. */
export async function loadAll() {
  const [sessions, settings, meta, lock] = await Promise.all([
    run(['sessions'], 'readonly', (tx) => tx.objectStore('sessions').getAll()),
    run(['kv'], 'readonly', (tx) => tx.objectStore('kv').get('settings')),
    run(['kv'], 'readonly', (tx) => tx.objectStore('kv').get('meta')),
    run(['kv'], 'readonly', (tx) => tx.objectStore('kv').get('lock')),
  ]);
  return { sessions: sessions || [], settings: settings || null, meta: meta || null, lock: lock || null };
}

/** Escribe y borra sesiones en una sola transacción. */
export function applySessions(puts, deletes) {
  if (!puts.length && !deletes.length) return Promise.resolve();
  return run(['sessions'], 'readwrite', (tx) => {
    const st = tx.objectStore('sessions');
    puts.forEach((s) => st.put(s));
    deletes.forEach((id) => st.delete(id));
  });
}

export function setKV(key, value) {
  return run(['kv'], 'readwrite', (tx) => { tx.objectStore('kv').put(value, key); });
}
