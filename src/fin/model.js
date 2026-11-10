// Modelo de Dinero. Todo vive en state.fin y se guarda solo dentro del cifrado (vault).
// Montos en centavos (enteros) para no acumular errores de redondeo.

export const FIN_VERSION = 1;
export const ACCOUNTS = [
  { id: 'nequi', name: 'Nequi' },
  { id: 'nu', name: 'Nu' },
  { id: 'efectivo', name: 'Efectivo' },
];
export const FIN_ICONS = ['bus', 'cup', 'food', 'box', 'tv', 'bag', 'dots', 'star', 'heart', 'book', 'game', 'music'];
export const CONF = { alta: 'Alta', media: 'Media', baja: 'Baja' };
export const TYPES = { gasto: 'Gasto', ingreso: 'Ingreso', propia: 'Entre tus cuentas', anulado: 'Anulado', rendimiento: 'Rendimiento' };

const P = 100; // pesos → centavos

export function defaultFin() {
  return {
    v: FIN_VERSION,
    owner: '',          // tu nombre según los extractos (para reconocer tus transferencias)
    monthStart: 1,      // día en que empieza tu mes
    hide: false,        // ocultar montos
    cats: [
      { id: 'transp', name: 'Transporte', color: 3, icon: 'bus' },
      { id: 'cmin', name: 'Consumo básico mínimo', color: 2, icon: 'cup' },
      { id: 'cmed', name: 'Consumo básico medio', color: 5, icon: 'bag' },
      { id: 'comida', name: 'Comida', color: 4, icon: 'food' },
      { id: 'domic', name: 'Domicilios', color: 6, icon: 'box' },
      { id: 'subs', name: 'Suscripciones y servicios digitales', color: 1, icon: 'tv' },
      { id: 'compras', name: 'Compras', color: 3, icon: 'bag' },
      { id: 'rest', name: 'Restante', color: 2, icon: 'dots' },
    ],
    // Pagos a personas según el monto. "from" en centavos, inclusive; cada rango llega hasta el siguiente.
    bands: [
      { from: 0, cat: 'cmin', conf: 'alta' },
      { from: 6000 * P, cat: 'transp', conf: 'alta' },
      { from: 8001 * P, cat: 'transp', conf: 'media' },
      { from: 9001 * P, cat: 'transp', conf: 'baja' },
      { from: 10001 * P, cat: 'cmed', conf: 'media' },
    ],
    qrSmall: { on: true, below: 6000 * P, cat: 'cmin' },  // pagos con QR pequeños
    recargas: 'ingreso', // "Recarga desde Bancolombia": ingreso (por defecto) | entre tus cuentas
    // Comercios: si la descripción contiene el texto, va a esa categoría (en orden).
    merchants: [
      { text: 'RAPPI', cat: 'domic' }, { text: 'DIDI FOOD', cat: 'domic' }, { text: 'IFOOD', cat: 'domic' },
      { text: 'SPOTIFY', cat: 'subs' }, { text: 'APPLE.COM', cat: 'subs' }, { text: 'GOOGLE', cat: 'subs' },
      { text: 'NETFLIX', cat: 'subs' }, { text: 'YOUTUBE', cat: 'subs' }, { text: 'DISNEY', cat: 'subs' },
      { text: 'PRIME VIDEO', cat: 'subs' }, { text: 'OPENAI', cat: 'subs' }, { text: 'ANTHROPIC', cat: 'subs' },
      { text: 'CLAUDE', cat: 'subs' }, { text: 'SERVICIOS WEB', cat: 'subs' },
      { text: 'UBER', cat: 'transp' }, { text: 'DIDI', cat: 'transp' }, { text: 'CABIFY', cat: 'transp' },
      { text: 'INDRIVE', cat: 'transp' }, { text: 'PICAP', cat: 'transp' },
      { text: 'FOOD', cat: 'comida' }, { text: 'RESTAURANTE', cat: 'comida' }, { text: 'PIZZA', cat: 'comida' },
      { text: 'BURGER', cat: 'comida' }, { text: 'FRISBY', cat: 'comida' }, { text: 'KFC', cat: 'comida' },
      { text: 'MCDONALD', cat: 'comida' }, { text: 'CORRAL', cat: 'comida' },
    ],
    unknownBuy: 'compras',   // compras en comercios sin regla
    memo: {},                // lo que recuerdas por persona o comercio: { clave: {type, cat} }
    movs: [],                // {id, acct, date 'AAAA-MM-DD', desc, amount, src, manual?: {type, cat}, note?}
    stmts: [],               // extractos importados: {key, bank, from, to, summary, balances, importedAt}
    incomes: [],             // ingresos fijos: {id, name, amount, day, acct, from 'AAAA-MM'}
  };
}

/** Acepta datos de Dinero guardados o importados y completa lo que falte. */
export function migrateFin(f) {
  const d = defaultFin();
  if (!f || typeof f !== 'object') return d;
  const out = { ...d, ...f, v: FIN_VERSION };
  for (const k of ['cats', 'bands', 'merchants', 'movs', 'stmts', 'incomes']) if (!Array.isArray(out[k])) out[k] = d[k];
  if (!out.memo || typeof out.memo !== 'object') out.memo = {};
  if (!out.qrSmall || typeof out.qrSmall !== 'object') out.qrSmall = d.qrSmall;
  if (!out.cats.length) out.cats = d.cats;
  if (!out.cats.some((c) => c.id === 'rest')) out.cats = [...out.cats, d.cats.find((c) => c.id === 'rest')];
  return out;
}

export const hasFinData = (f) => !!f && (f.movs.length > 0 || f.stmts.length > 0 || f.incomes.length > 0);
export const finCat = (f, id) => f.cats.find((c) => c.id === id) || f.cats.find((c) => c.id === 'rest') || f.cats[0];
export const acctName = (id) => ACCOUNTS.find((a) => a.id === id)?.name || id;

const MONEY = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
/** Centavos → "$ 12.345". Con hide, oculta el valor. */
export function fmtMoney(cents, hide = false) {
  if (hide) return '$ ••••';
  return MONEY.format(Math.round(cents / 100)).replace(/ /g, ' ');
}
export const fmtSigned = (c, hide) => (c > 0 ? '+' : c < 0 ? '−' : '') + fmtMoney(Math.abs(c), hide);
