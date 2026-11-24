// Buzón de órdenes del atajo mientras PP está bloqueada.
//
// Con el bloqueo activo, los datos no se pueden leer sin la contraseña o Face ID. Para no
// pedirlos en cada toque del Botón de Acción, la orden se guarda cifrada con una clave
// pública (RSA-OAEP). Su clave privada vive dentro de los datos cifrados (vault), así que
// solo se puede leer al desbloquear PP, momento en que se aplican las órdenes y se borran.
//
// kv "shortcut": { k: código secreto del atajo, pub: clave pública (JWK) | null }  (en claro)
// kv "inbox":    [ texto cifrado en base64, ... ]                               (cifrado)
import { fromB64, random, toB64, toB64Url } from './vault.js';

const ALG = { name: 'RSA-OAEP', hash: 'SHA-256' };
const enc = new TextEncoder();
const dec = new TextDecoder();

export const newCode = () => toB64Url(random(9));

/** Crea un par de claves nuevo. Devuelve { pub, priv } en JWK. */
export async function genKeys() {
  const kp = await crypto.subtle.generateKey({ ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
  const [pub, priv] = await Promise.all([crypto.subtle.exportKey('jwk', kp.publicKey), crypto.subtle.exportKey('jwk', kp.privateKey)]);
  return { pub, priv };
}

/** Cifra una orden { a, t } con la clave pública. */
export async function sealOrder(pubJwk, order) {
  const key = await crypto.subtle.importKey('jwk', pubJwk, ALG, false, ['encrypt']);
  const data = enc.encode(JSON.stringify({ a: String(order.a).slice(0, 120), t: order.t }));
  return toB64(new Uint8Array(await crypto.subtle.encrypt(ALG, key, data)));
}

/** Descifra las órdenes del buzón; descarta las que estén dañadas. */
export async function openOrders(privJwk, list) {
  if (!Array.isArray(list) || !list.length) return [];
  const key = await crypto.subtle.importKey('jwk', privJwk, ALG, false, ['decrypt']);
  const out = [];
  for (const ct of list) {
    try {
      const o = JSON.parse(dec.decode(await crypto.subtle.decrypt(ALG, key, fromB64(ct))));
      if (o && typeof o.a === 'string' && Number.isFinite(o.t)) out.push({ a: o.a, t: o.t });
    } catch { /* orden dañada: se ignora */ }
  }
  return out;
}
