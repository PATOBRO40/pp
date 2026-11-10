// Lectura de extractos mensuales en PDF (Nequi y Nu). Todo ocurre en el dispositivo.
// Entrada: los fragmentos de texto del PDF con su posición ({str, x, y, page}).
// Salida: periodo, titular, movimientos, resumen y saldos, más una verificación de cuadre.
// Solo se usa el nombre del titular (para reconocer tus propias transferencias):
// cédula, dirección, correo y número de cuenta se ignoran.

const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** "$-30,000.00" (Nequi) → -3000000 centavos */
const moneyEn = (s) => Math.round(parseFloat(s.replace(/[$\s,]/g, '')) * 100);
/** "+$1.750.000,00" / "-$346.200,00" (Nu) → centavos */
const moneyEs = (s) => {
  const neg = /-/.test(s);
  const v = Math.round(parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.')) * 100);
  return neg ? -v : v;
};

/** Agrupa los fragmentos en renglones (misma página y altura), de arriba abajo y de izquierda a derecha. */
export function toLines(items) {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= 3) last.items.push(it);
    else lines.push({ page: it.page, y: it.y, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.str.trim()).join('  ');
  }
  return lines;
}

/** Valor que aparece justo debajo de una etiqueta, en la misma columna (formato de Nu). */
function valueBelow(items, label, re = /^[+-]?\$[\d.]+,\d{2}$/) {
  const l = items.find((i) => i.str.trim() === label);
  if (!l) return null;
  const c = items
    .filter((i) => i.page === l.page && re.test(i.str.trim()) && Math.abs(i.x - l.x) < 30 && i.y < l.y && l.y - i.y < 30)
    .sort((a, b) => b.y - a.y)[0];
  return c ? moneyEs(c.str) : null;
}

export function detectBank(text) {
  if (/NEQUI S\.A\./i.test(text) && /dep[oó]sito de bajo monto/i.test(text)) return 'nequi';
  if (/Nu Colombia Compa[ñn][ií]a de Financiamiento/i.test(text) && /Movimientos/.test(text)) return 'nu';
  return null;
}

function parseNequi(lines) {
  const all = lines.map((l) => l.text).join('\n');
  const p = all.match(/per[ií]odo de:\s*(\d{4})\/(\d{2})\/(\d{2})\s*a\s*(\d{4})\/(\d{2})\/(\d{2})/i);
  if (!p) throw new Error('No encontré el periodo del extracto.');
  const holderLine = lines.findIndex((l) => /NEQUI S\.A\./i.test(l.text));
  const holder = lines[holderLine + 1]?.text.trim() || '';
  const sum = (label) => {
    const m = all.match(new RegExp(label + '\\s+(\\$-?[\\d,]+\\.\\d{2})', 'i'));
    return m ? moneyEn(m[1]) : null;
  };
  const rows = [];
  for (const l of lines) {
    const m = l.text.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+(\$-?[\d,]+\.\d{2})\s+(\$-?[\d,]+\.\d{2})$/);
    if (m) rows.push({ date: iso(m[3], m[2], m[1]), desc: m[4].replace(/\s+/g, ' ').trim(), amount: moneyEn(m[5]), balance: moneyEn(m[6]) });
  }
  rows.reverse(); // el extracto viene del más reciente al más antiguo
  const summary = { opening: sum('Saldo anterior'), in: sum('Total abonos'), out: sum('Total cargos'), closing: sum('Saldo actual') };
  return {
    bank: 'nequi', holder, rows, summary,
    period: { from: iso(p[1], p[2], p[3]), to: iso(p[4], p[5], p[6]) },
    balances: { nequi: summary.closing },
  };
}

function parseNu(lines, items) {
  const all = lines.map((l) => l.text).join('\n');
  const p = all.match(/(\d{2})\s*-\s*(\d{2})\s+([A-Z]{3})\s+(\d{4})/);
  if (!p) throw new Error('No encontré el periodo del extracto.');
  const month = MONTHS[p[3].toLowerCase()];
  const year = +p[4];
  const greet = items.findIndex((i) => /Lleg[oó] tu extracto/i.test(i.str));
  const holder = items[greet + 1]?.str.trim() || '';
  const sum = (label) => {
    const m = all.match(new RegExp(label + '\\s+([+-]?\\$[\\d.]+,\\d{2})', 'i'));
    return m ? moneyEs(m[1]) : null;
  };
  const rows = [];
  for (const l of lines) {
    const m = l.text.match(/^(\d{2})\s+([a-z]{3})\.?\s+(.+?)\s+([+-]\$[\d.]+,\d{2})$/i);
    if (m && MONTHS[m[2].toLowerCase()]) {
      const mm = MONTHS[m[2].toLowerCase()];
      // Un extracto de enero puede traer días de diciembre del año anterior
      const yy = mm > month ? year - 1 : year;
      rows.push({ date: iso(yy, mm, +m[1]), desc: m[3].replace(/\s+/g, ' ').trim(), amount: moneyEs(m[4]) });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date)); // ya vienen en orden; por si acaso
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const summary = {
    opening: sum('Tu dinero al inicio del mes'), in: sum('Lo que entró a tu cuenta'), out: -sum('Lo que salió de tu cuenta'),
    tax: -(sum('Impuesto del 4x1000') || 0), fees: -(sum('Costos por retiro') || 0),
    yield: sum('Rendimiento total de tu cuenta') || 0, closing: sum('Tu dinero a final del mes'),
  };
  return {
    bank: 'nu', holder, rows, summary,
    period: { from: iso(year, month, +p[1]), to: iso(year, month, Math.min(+p[2], lastDay)) },
    balances: {
      nu: valueBelow(items, 'Dinero en tu Cuenta Nu'),
      cajitas: valueBelow(items, 'Dinero en tus cajitas'),
      cdt: valueBelow(items, 'Invertido en CDT Nu'),
    },
  };
}

/** Comprueba que los movimientos leídos cuadran con el resumen del propio extracto. */
export function verify(st) {
  const s = st.summary;
  const ins = st.rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0);
  const outs = -st.rows.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0);
  const problems = [];
  if (!st.rows.length) problems.push('No encontré movimientos.');
  if (s.in != null && ins !== s.in) problems.push('Las entradas no suman lo que dice el resumen.');
  if (s.out != null && outs !== s.out) problems.push('Las salidas no suman lo que dice el resumen.');
  if (s.opening != null && s.closing != null) {
    const extra = st.bank === 'nu' ? s.yield - s.tax - s.fees : 0;
    if (s.opening + ins - outs + extra !== s.closing) problems.push('El saldo final no cuadra con los movimientos.');
  }
  return { ok: problems.length === 0, problems, ins, outs };
}

/** items: [{str, x, y, page}] de todas las páginas. */
export function parseStatement(items) {
  const lines = toLines(items);
  const bank = detectBank(lines.map((l) => l.text).join('\n'));
  if (!bank) throw new Error('No reconozco este PDF. Por ahora PP lee extractos mensuales de Nequi y de Nu.');
  const st = bank === 'nequi' ? parseNequi(lines) : parseNu(lines, items);
  st.check = verify(st);
  return st;
}
