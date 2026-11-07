// Bloqueo de entrada: contraseña (PBKDF2) y, opcionalmente, Face ID (WebAuthn).
// Es un bloqueo de acceso a la interfaz: los datos no se cifran y no hay servidor,
// así que una contraseña olvidada no se puede recuperar.
// Vive en la clave "lock" de IndexedDB y nunca entra en los respaldos.
import { getState, set, setLock } from './store.js';

const ITERATIONS = 310000;
const MAX_FAILS = 5;
export const MIN_LENGTH = 4;
export const DEFAULT_GRACE = 60000;

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64Url = (bytes) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n) => crypto.getRandomValues(new Uint8Array(n));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** Guarda intentos fallidos; si la base falla, al menos cuentan en memoria. */
async function saveAttempts(lock) {
  try { await setLock(lock); } catch { set({ lock }); }
}

/** Crea o cambia la contraseña, conservando Face ID y el tiempo de bloqueo. */
export async function savePassword(password) {
  const salt = random(16);
  const hash = await derive(password, salt, ITERATIONS);
  const prev = getState().lock;
  await setLock({
    salt: toB64(salt), hash: toB64(hash), iterations: ITERATIONS,
    credId: prev?.credId || null, grace: prev?.grace ?? DEFAULT_GRACE, fails: 0, until: 0,
  });
}

/** Comprueba la contraseña. Tras 5 fallos impone una espera creciente (30 s a 15 min). */
export async function tryPassword(password) {
  const l = getState().lock;
  if (Date.now() < (l.until || 0)) return false;
  const hash = await derive(password, fromB64(l.salt), l.iterations);
  if (same(hash, fromB64(l.hash))) {
    if (l.fails) await saveAttempts({ ...l, fails: 0, until: 0 });
    return true;
  }
  const fails = (l.fails || 0) + 1;
  const until = fails >= MAX_FAILS ? Date.now() + Math.min(900000, 30000 * 2 ** (fails - MAX_FAILS)) : 0;
  await saveAttempts({ ...l, fails, until });
  return false;
}

export async function biometricAvailable() {
  try {
    return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// El diálogo de Face ID puede ocultar la página: no debe contar como "salir de la app".
let authBusy = false;

/** Registra Face ID. Debe llamarse directamente desde un toque (lo exige Safari). */
export async function enrollBiometric() {
  authBusy = true;
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        rp: { name: 'PP' },
        user: { id: random(16), name: 'PP', displayName: 'PP' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        attestation: 'none',
        timeout: 60000,
      },
    });
    await setLock({ ...getState().lock, credId: toB64(new Uint8Array(cred.rawId)) });
  } finally {
    authBusy = false;
  }
}

/** Pide Face ID y lanza un error si no se verifica. Debe llamarse desde un toque. */
export async function verifyBiometric() {
  const l = getState().lock;
  const id = fromB64(l.credId);
  const challenge = random(32);
  authBusy = true;
  try {
    const a = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id, transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    const client = JSON.parse(new TextDecoder().decode(a.response.clientDataJSON));
    const verified = (new Uint8Array(a.response.authenticatorData)[32] & 4) !== 0; // flag UV
    const valid = same(new Uint8Array(a.rawId), id) && verified && client.type === 'webauthn.get' &&
      client.challenge === toB64Url(challenge) && client.origin === location.origin;
    if (!valid) throw new Error('Verificación no válida');
    if (l.fails) await saveAttempts({ ...l, fails: 0, until: 0 });
  } finally {
    authBusy = false;
  }
}

export function removeBiometric() {
  return setLock({ ...getState().lock, credId: null });
}

export function setGrace(grace) {
  return setLock({ ...getState().lock, grace });
}

export async function removeLock() {
  await setLock(null);
  set({ locked: false });
}

/** Última salida: sin contraseña ni Face ID, entrar exige borrar las sesiones. */
export async function wipeAndUnlock() {
  set({ sessions: [], sheet: null });
  await removeLock();
}

export function unlock() {
  set({ locked: false });
}

/** Vuelve a bloquear al regresar a la app si pasó el tiempo elegido. */
export function initAutoLock() {
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    const { lock, locked } = getState();
    if (!lock || locked || authBusy) { hiddenAt = null; return; }
    if (document.hidden) {
      hiddenAt = Date.now();
      if (lock.grace === 0) set({ locked: true }); // antes de que iOS capture la vista previa
    } else if (hiddenAt != null) {
      if (Date.now() - hiddenAt >= lock.grace) set({ locked: true });
      hiddenAt = null;
    }
  });
}
