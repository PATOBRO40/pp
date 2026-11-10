// Cifrado de los datos en el dispositivo (AES-GCM de 256 bits, con WebCrypto).
//
// Una clave maestra aleatoria cifra sesiones y ajustes en un solo registro ("vault").
// Esa clave nunca se guarda en claro: se guarda envuelta (cifrada) dos veces,
//   - con una clave derivada de la contraseña (PBKDF2), y
//   - opcionalmente, con un secreto que entrega Face ID (extensión PRF de WebAuthn).
// Al bloquear, la clave maestra se borra de la memoria.

const enc = new TextEncoder();
const dec = new TextDecoder();
const AAD_KEY = enc.encode('pp-key-v1');
const AAD_VAULT = enc.encode('pp-vault-v1');

export const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
export const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const toB64Url = (bytes) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const random = (n) => crypto.getRandomValues(new Uint8Array(n));
export const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

let raw = null; // clave maestra en bytes (hace falta para volver a envolverla)
let key = null; // la misma, como CryptoKey no exportable

export const isOpen = () => !!key;
/** Copia de la clave maestra; quien la pida debe borrarla al terminar. */
export const masterCopy = () => (raw ? raw.slice() : null);

export async function open(master) {
  key = await crypto.subtle.importKey('raw', master, 'AES-GCM', false, ['encrypt', 'decrypt']);
  raw = master;
}

export function close() {
  raw?.fill(0);
  raw = null;
  key = null;
}

/** Cifra un objeto con la clave maestra. */
export async function seal(obj) {
  const iv = random(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD_VAULT }, key, enc.encode(JSON.stringify(obj)));
  return { v: 1, iv, ct };
}

export async function unseal(rec) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv, additionalData: AAD_VAULT }, key, rec.ct);
  return JSON.parse(dec.decode(pt));
}

/** Clave para envolver la maestra, derivada de la contraseña. */
export async function passwordKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Clave para envolver la maestra, derivada del secreto PRF de Face ID. */
export async function prfKey(secret) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('pp-faceid-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function wrap(kek, master) {
  const iv = random(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD_KEY }, kek, master);
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

// ---------- Respaldos cifrados con contraseña (independientes del bloqueo) ----------
const AAD_BACKUP = enc.encode('pp-backup-v1');
const BACKUP_ITER = 310000;

export async function sealWithPassword(text, password) {
  const salt = random(16);
  const iv = random(12);
  const k = await passwordKey(password, salt, BACKUP_ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD_BACKUP }, k, enc.encode(text)));
  return { v: 1, kdf: { salt: toB64(salt), iterations: BACKUP_ITER }, iv: toB64(iv), ct: toB64Big(ct) };
}

/** Lanza un error si la contraseña no es la correcta. */
export async function openWithPassword(e, password) {
  const k = await passwordKey(password, fromB64(e.kdf.salt), e.kdf.iterations);
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(e.iv), additionalData: AAD_BACKUP }, k, fromB64(e.ct)));
}

/** Base64 para datos grandes (sin desbordar la pila). */
function toB64Big(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Lanza un error si la clave no es la correcta (AES-GCM autentica). */
export async function unwrap(kek, w) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(w.iv), additionalData: AAD_KEY }, kek, fromB64(w.ct)));
}
