// Registro del service worker y flujo de actualización.
// La versión nueva NO se activa sola: se avisa y el usuario decide (evita mezclar versiones).
import { set, toast } from './store.js';

let reg = null;
let updating = false;

function watch(r) {
  const waiting = () => {
    if (r.waiting && navigator.serviceWorker.controller) set({ updateReady: true });
  };
  waiting();
  r.addEventListener('updatefound', () => {
    const w = r.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed') waiting(); });
  });
}

export function registerSW() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  navigator.serviceWorker.register('./sw.js').then((r) => {
    reg = r;
    watch(r);
    // iOS no siempre revisa al abrir: revisamos al volver a primer plano.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) r.update().catch(() => {}); });
  }).catch(() => {});
  // controllerchange también salta en la primera instalación (clients.claim):
  // solo se recarga si el usuario aceptó actualizar.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updating) location.reload();
  });
}

export function applyUpdate() {
  updating = true;
  reg?.waiting?.postMessage('SKIP_WAITING');
}

export async function checkUpdate() {
  if (!reg) return toast(import.meta.env.PROD ? 'Sin conexión o sin service worker' : 'Solo disponible en la versión instalada');
  try {
    await reg.update();
    if (reg.waiting) toast('Hay una versión nueva de PP', { long: true, action: { label: 'Actualizar', fn: applyUpdate } });
    else if (reg.installing) toast('Descargando la versión nueva…'); // watch() avisará al terminar
    else toast('Ya tienes la última versión', { kind: 'ok' });
  } catch {
    toast('No se pudo comprobar (¿sin conexión?)');
  }
}

export const isStandalone = () =>
  window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
