// Clasificación automática de movimientos. Nunca se guarda: se recalcula a partir de las
// reglas, así que cambiar una regla corrige también los meses ya importados.
// Prioridad: lo que corregiste a mano > lo que recordaste por persona/comercio > reglas.

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Clave de una persona o comercio, igual en Nu y Nequi. */
export const partyKey = (s) => norm(s || '');

/** Qué es el movimiento según su descripción. */
export function describe(m) {
  const d = m.desc.trim();
  const out = m.amount < 0;
  let r;
  if (m.acct === 'efectivo' || m.src === 'manual') return { kind: 'manual', party: '' };
  if ((r = d.match(/^Recarga desde (.+)/i))) return { kind: 'recarga', party: r[1] };
  if ((r = d.match(/^RECIBI POR BRE-B DE:\s*(.+)/i))) return { kind: 'persona', party: r[1] };
  if ((r = d.match(/^ENVIO CON BRE-B A:\s*(.+)/i))) return { kind: 'persona', party: r[1] };
  if ((r = d.match(/^Recibiste de (.+)/i))) return { kind: 'persona', party: r[1] };
  if ((r = d.match(/^Enviaste a (.+)/i))) return { kind: 'persona', party: r[1] };
  if ((r = d.match(/^Para (.+)/i)) && out) return { kind: 'persona', party: r[1] };
  if ((r = d.match(/^De (.+)/i)) && !out) return { kind: 'persona', party: r[1] };
  if ((r = d.match(/^PAGO EN QR(?: BRE-B)?:?\s*(.+)/i))) return { kind: 'qr', party: r[1] };
  if ((r = d.match(/^(?:REVERSO|DEVOLUCI[OÓ]N)(?: (?:DE )?COMPRA EN)?\s*(.+)/i))) return { kind: 'reverso', party: r[1] };
  if (/intereses|rendimiento/i.test(d)) return { kind: 'interes', party: '' };
  if ((r = d.match(/^Compra en (.+?)(?: con tarjeta.*)?$/i))) return { kind: 'compra', party: r[1] };
  return { kind: 'comercio', party: d };
}

/** ¿El nombre es el tuyo? Basta con que todas sus palabras estén en tu nombre (Nequi a veces solo pone el primero). */
function isSelf(party, ownerTokens) {
  const t = norm(party).split(' ').filter(Boolean);
  return ownerTokens.size > 0 && t.length > 0 && t.every((w) => ownerTokens.has(w));
}

function merchantCat(f, text) {
  const up = text.toUpperCase();
  return f.merchants.find((r) => r.text && up.includes(r.text.toUpperCase()))?.cat || null;
}

function bandFor(f, cents) {
  const v = Math.abs(cents);
  const sorted = [...f.bands].sort((a, b) => a.from - b.from);
  let hit = sorted[0];
  for (const b of sorted) if (v >= b.from) hit = b;
  return hit;
}

const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

/**
 * Devuelve Map id → { type, cat, conf, why, kind, party, key, manual }.
 * type: gasto | ingreso | propia | anulado | rendimiento
 */
export function classify(f) {
  const owner = new Set(norm(f.owner).split(' ').filter((w) => w.length > 1));
  const res = new Map();
  const info = f.movs.map((m) => ({ m, ...describe(m) }));

  // 1. Transferencias propias: con tu nombre, y emparejadas con la otra cuenta (mismo monto, signo contrario)
  const selfs = info.filter((x) => x.kind === 'persona' && isSelf(x.party, owner));
  const paired = new Set();
  for (const a of selfs) {
    if (paired.has(a.m.id)) continue;
    const b = selfs.find((y) => !paired.has(y.m.id) && y.m.id !== a.m.id && y.m.acct !== a.m.acct &&
      y.m.amount === -a.m.amount && dayDiff(y.m.date, a.m.date) <= 1);
    if (b) { paired.add(a.m.id); paired.add(b.m.id); }
  }
  // 2. Reversos: anulan la compra del mismo valor en la misma cuenta
  const voided = new Set();
  for (const r of info.filter((x) => x.kind === 'reverso' && x.m.amount > 0)) {
    const w = norm(r.party).split(' ')[0];
    const c = info.find((x) => !voided.has(x.m.id) && x.m.acct === r.m.acct && x.m.amount === -r.m.amount &&
      x.kind !== 'reverso' && norm(x.m.desc).includes(w) && dayDiff(x.m.date, r.m.date) <= 15);
    if (c) { voided.add(c.m.id); voided.add(r.m.id); }
  }

  for (const x of info) {
    const { m, kind, party } = x;
    const key = partyKey(party);
    const out = m.amount < 0;
    let a;
    if (voided.has(m.id)) a = { type: 'anulado', cat: null, conf: 'alta', why: 'Compra y reverso se anulan' };
    else if (key && f.memo[key]) a = { ...f.memo[key], conf: 'alta', why: 'Tu regla para este nombre' };
    else if (kind === 'persona' && isSelf(party, owner)) {
      a = paired.has(m.id)
        ? { type: 'propia', cat: null, conf: 'alta', why: 'Entre tus cuentas (con su pareja en la otra cuenta)' }
        : { type: 'propia', cat: null, conf: 'media', why: 'Lleva tu nombre, pero no encontré la otra mitad' };
    } else if (kind === 'recarga') {
      a = f.recargas === 'ingreso'
        ? { type: 'ingreso', cat: null, conf: 'alta', why: 'Regla: recargas desde otro banco cuentan como ingreso' }
        : { type: 'propia', cat: null, conf: 'alta', why: 'Regla: recargas desde otro banco son dinero tuyo' };
    } else if (kind === 'interes') a = { type: 'rendimiento', cat: null, conf: 'alta', why: 'Intereses' };
    else if (kind === 'manual') a = { type: out ? 'gasto' : 'ingreso', cat: out ? 'rest' : null, conf: 'alta', why: 'Registro manual' };
    else if (!out) a = { type: 'ingreso', cat: null, conf: kind === 'persona' ? 'alta' : 'media', why: kind === 'persona' ? 'Te lo envió otra persona' : 'Entrada de dinero' };
    else if (kind === 'persona') {
      const b = bandFor(f, m.amount);
      a = { type: 'gasto', cat: b.cat, conf: b.conf, why: 'Regla por monto de pagos a personas' };
    } else if (kind === 'qr' && f.qrSmall.on && -m.amount < f.qrSmall.below) {
      a = { type: 'gasto', cat: f.qrSmall.cat, conf: 'alta', why: 'Pago con QR pequeño' };
    } else {
      const c = merchantCat(f, `${m.desc} ${party}`);
      a = c ? { type: 'gasto', cat: c, conf: 'alta', why: 'Regla de comercio' }
        : { type: 'gasto', cat: kind === 'comercio' ? 'rest' : f.unknownBuy, conf: 'baja', why: 'Comercio sin regla' };
    }
    if (a.type === 'gasto' && !f.cats.some((c) => c.id === a.cat)) a.cat = 'rest';
    const eff = m.manual ? { ...a, ...m.manual, conf: 'alta', why: 'Lo corregiste a mano' } : a;
    res.set(m.id, { ...eff, kind, party, key, auto: a, manual: !!m.manual });
  }
  return res;
}

// La clasificación se recalcula solo cuando cambian los datos de Dinero.
let memoF = null;
let memoR = null;
export function classified(f) {
  if (f !== memoF) { memoF = f; memoR = classify(f); }
  return memoR;
}
