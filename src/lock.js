// Bloqueo de entrada con cifrado: contraseña (PBKDF2) y, opcionalmente, Face ID (WebAuthn + PRF).
//
// Con el bloqueo activo, sesiones y ajustes se guardan cifrados (ver vault.js) y solo se
// descifran al entrar. No hay servidor: si se olvida la contraseña y no hay Face ID,
// los datos no se pueden recuperar.
// La configuración vive en la clave "lock" de IndexedDB y nunca entra en los respaldos:
//   { v: 2, kdf: {salt, iterations}, pw: clave maestra envuelta con la contraseña,
//     bio: {credId, salt, w} | null, grace, fails, until }
// Un registro sin "v" es de la versión 1.2–1.3 (solo un hash, datos en claro): se migra
// al entrar con la contraseña.
import * as V from './vault.js';
import { disableVault, enableVault, getState, lockApp, openVault, set, setLock, wipeData } from './store.js';

const ITERATIONS = 310000;
const MAX_FAILS = 5;
export const MIN_LENGTH = 4;
export const DEFAULT_GRACE = 60000;

const { toB64, fromB64, toB64Url, random, same } = V;

/** Bloqueo de una versión anterior, aún sin cifrado. */
export const isLegacy = (l) => !!l && l.v !== 2;
export const hasBiometric = (l) => !!l && l.v === 2 && !!l.bio;

async function legacyHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

async function passwordWrap(password, master) {
  const salt = random(16);
  const kek = await V.passwordKey(password, salt, ITERATIONS);
  return { kdf: { salt: toB64(salt), iterations: ITERATIONS }, pw: await V.wrap(kek, master) };
}

/** Guarda intentos fallidos; si la base falla, al menos cuentan en memoria. */
async function saveAttempts(patch) {
  const lock = { ...getState().lock, ...patch };
  try { await setLock(lock); } catch { set({ lock }); }
}

/**
 * Comprueba la contraseña. Tras 5 fallos impone una espera creciente (30 s a 15 min).
 * Devuelve la clave maestra, true (bloqueo antiguo correcto) o null.
 */
async function attempt(password) {
  const l = getState().lock;
  if (Date.now() < (l.until || 0)) return null;
  let out = null;
  if (isLegacy(l)) {
    if (same(await legacyHash(password, fromB64(l.salt), l.iterations), fromB64(l.hash))) out = true;
  } else {
    try {
      out = await V.unwrap(await V.passwordKey(password, fromB64(l.kdf.salt), l.kdf.iterations), l.pw);
    } catch { /* contraseña incorrecta: AES-GCM no autentica */ }
  }
  if (out) {
    if (l.fails) await saveAttempts({ fails: 0, until: 0 });
    return out;
  }
  const fails = (l.fails || 0) + 1;
  const until = fails >= MAX_FAILS ? Date.now() + Math.min(900000, 30000 * 2 ** (fails - MAX_FAILS)) : 0;
  await saveAttempts({ fails, until });
  return null;
}

/** Solo comprueba la contraseña (para confirmar cambios en Ajustes). */
export async function checkPassword(password) {
  const r = await attempt(password);
  if (r instanceof Uint8Array) r.fill(0);
  return !!r;
}

/**
 * Entrar con contraseña. Si el bloqueo es de una versión anterior, cifra los datos en ese momento.
 * Devuelve { ok, migrated, hadBio }.
 */
export async function unlockWithPassword(password) {
  const l = getState().lock;
  const r = await attempt(password);
  if (!r) return { ok: false };
  if (r === true) {
    const master = random(32);
    await enableVault({ v: 2, ...(await passwordWrap(password, master)), bio: null, grace: l.grace ?? DEFAULT_GRACE, fails: 0, until: 0 }, master);
    set({ locked: false });
    return { ok: true, migrated: true, hadBio: !!l.credId };
  }
  await openVault(r);
  return { ok: true };
}

/** Crea el bloqueo (y cifra los datos) o cambia la contraseña, conservando Face ID y el tiempo de bloqueo. */
export async function savePassword(password) {
  const l = getState().lock;
  const master = V.masterCopy();
  if (!master || isLegacy(l)) {
    const m = random(32);
    await enableVault({ v: 2, ...(await passwordWrap(password, m)), bio: null, grace: l?.grace ?? DEFAULT_GRACE, fails: 0, until: 0 }, m);
    return;
  }
  try {
    await setLock({ ...l, ...(await passwordWrap(password, master)), fails: 0, until: 0 });
  } finally {
    master.fill(0);
  }
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

export class NoPrfError extends Error {}

/** Pide Face ID y devuelve el secreto PRF de la credencial. */
async function assertBio(id, salt) {
  const challenge = random(32);
  const a = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ type: 'public-key', id, transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const client = JSON.parse(new TextDecoder().decode(a.response.clientDataJSON));
  const verified = (new Uint8Array(a.response.authenticatorData)[32] & 4) !== 0; // flag UV
  const valid = same(new Uint8Array(a.rawId), id) && verified && client.type === 'webauthn.get' &&
    client.challenge === toB64Url(challenge) && client.origin === location.origin;
  if (!valid) throw new Error('Verificación no válida');
  const secret = a.getClientExtensionResults?.().prf?.results?.first;
  if (!secret) throw new NoPrfError('Face ID no entrega la clave de cifrado');
  return new Uint8Array(secret);
}

/**
 * Registra Face ID y envuelve con él la clave maestra (la app debe estar desbloqueada).
 * Debe llamarse directamente desde un toque (lo exige Safari).
 */
export async function enrollBiometric() {
  const master = V.masterCopy();
  if (!master) throw new Error('Bloqueada');
  const salt = random(32);
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
        extensions: { prf: { eval: { first: salt } } },
      },
    });
    const id = new Uint8Array(cred.rawId);
    const prf = cred.getClientExtensionResults?.().prf;
    if (!prf || prf.enabled === false) throw new NoPrfError('Sin PRF');
    // Algunos navegadores solo entregan el secreto al verificar, no al registrar.
    const secret = prf.results?.first ? new Uint8Array(prf.results.first) : await assertBio(id, salt);
    const w = await V.wrap(await V.prfKey(secret), master);
    secret.fill(0);
    await setLock({ ...getState().lock, bio: { credId: toB64(id), salt: toB64(salt), w } });
  } finally {
    master.fill(0);
    authBusy = false;
  }
}

/** Pide Face ID y devuelve la clave maestra; lanza un error si no se verifica. Debe llamarse desde un toque. */
export async function verifyBiometric() {
  const { bio } = getState().lock;
  authBusy = true;
  try {
    const secret = await assertBio(fromB64(bio.credId), fromB64(bio.salt));
    const master = await V.unwrap(await V.prfKey(secret), bio.w);
    secret.fill(0);
    if (getState().lock.fails) await saveAttempts({ fails: 0, until: 0 });
    return master;
  } finally {
    authBusy = false;
  }
}

/** Solo confirma la identidad con Face ID (para cambios en Ajustes). */
export async function confirmBiometric() {
  (await verifyBiometric()).fill(0);
}

export async function unlockWithBiometric() {
  await openVault(await verifyBiometric());
}

export function removeBiometric() {
  return setLock({ ...getState().lock, bio: null });
}

export function setGrace(grace) {
  return setLock({ ...getState().lock, grace });
}

/** Quita el bloqueo y deja los datos sin cifrar. */
export function removeLock() {
  return disableVault();
}

/** Última salida: sin contraseña ni Face ID, entrar exige borrar los datos. */
export function wipeAndUnlock() {
  return wipeData();
}

/**
 * Pantalla de privacidad y bloqueo automático.
 * Al salir de la app se tapa el contenido de inmediato (iOS guarda una captura para el
 * selector de apps); al volver se destapa, o se bloquea si pasó el tiempo elegido.
 */
export function initAutoLock() {
  let hiddenAt = null;
  const cover = (on) => document.documentElement.classList.toggle('covered', on);
  const onHide = () => {
    cover(true);
    const { lock, locked } = getState();
    if (!lock || locked || authBusy) { hiddenAt = null; return; }
    if (hiddenAt == null) hiddenAt = Date.now();
    if (lock.grace === 0) lockApp();
  };
  const onShow = () => {
    const { lock, locked } = getState();
    if (lock && !locked && !authBusy && hiddenAt != null && Date.now() - hiddenAt >= lock.grace) lockApp();
    hiddenAt = null;
    cover(false);
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? onHide() : onShow()));
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', () => { if (!document.hidden) onShow(); });
}
