// Cálculos de Dinero: periodos (meses que pueden empezar cualquier día), totales, ahorro y pendientes.
import { classified } from './classify.js';

const pad = (n) => String(n).padStart(2, '0');
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** 'AAAA-MM' del periodo al que pertenece una fecha 'AAAA-MM-DD'. */
export function periodOf(date, start = 1) {
  let [y, m, d] = date.split('-').map(Number);
  if (d < start) { m -= 1; if (m === 0) { m = 12; y -= 1; } }
  return `${y}-${pad(m)}`;
}

export function shiftPeriod(key, n) {
  let [y, m] = key.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${pad(m)}`;
}

export function periodLabel(key, start = 1) {
  const [y, m] = key.split('-').map(Number);
  if (start === 1) return `${MES[m - 1]} ${y}`;
  const [y2, m2] = shiftPeriod(key, 1).split('-').map(Number);
  return `${start} ${MES3[m - 1]} – ${start - 1} ${MES3[m2 - 1]}${y2 !== y ? ` ${y2}` : ''}`;
}

export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
export const currentPeriod = (f) => periodOf(todayISO(), f.monthStart);

/** Periodo más reciente con datos (o el actual). */
export function latestPeriod(f) {
  const ps = f.movs.map((m) => periodOf(m.date, f.monthStart));
  return ps.sort().at(-1) || currentPeriod(f);
}

/** Ingresos fijos que tocan en un periodo (no se guardan como movimientos). */
export function fixedIncomes(f, key) {
  return f.incomes.filter((i) => i.amount > 0 && (!i.from || i.from <= key)).map((i) => ({
    id: `fix:${i.id}:${key}`, acct: i.acct, date: `${key}-${pad(Math.min(i.day || 1, 28))}`, desc: i.name || 'Ingreso fijo', amount: i.amount, fixed: true,
  }));
}

/** Totales de un periodo. Montos en centavos (gastos en positivo). */
export function periodStats(f, key) {
  const cls = classified(f);
  const byCat = {};
  const byParty = {};
  let spent = 0;
  let income = 0;
  let yieldT = 0;
  let moved = 0;
  let count = 0;
  let pending = 0;
  for (const m of f.movs) {
    if (periodOf(m.date, f.monthStart) !== key) continue;
    const c = cls.get(m.id);
    count++;
    if (!c.manual && c.conf !== 'alta') pending++;
    if (c.type === 'gasto') {
      const v = -m.amount; // un reembolso (positivo) resta
      spent += v;
      byCat[c.cat] = (byCat[c.cat] || 0) + v;
      const p = c.party || m.desc;
      if (m.amount < 0 && p) byParty[p] = (byParty[p] || 0) + v;
    } else if (c.type === 'ingreso') income += m.amount;
    else if (c.type === 'rendimiento') yieldT += m.amount;
    else if (c.type === 'propia' && m.amount > 0) moved += m.amount;
  }
  const fixed = fixedIncomes(f, key);
  for (const x of fixed) income += x.amount;
  // Rendimientos que Nu solo muestra en el resumen del extracto
  for (const s of f.stmts) if (s.bank === 'nu' && periodOf(s.to, f.monthStart) === key) yieldT += s.summary?.yield || 0;
  const top = Object.entries(byParty).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { key, spent, income, yield: yieldT, balance: income + yieldT - spent, byCat, top, moved, count, pending, fixed };
}

/** Primer y último día ('AAAA-MM-DD') de un periodo. */
export function periodRange(key, start = 1) {
  const [y, m] = key.split('-').map(Number);
  const from = `${y}-${pad(m)}-${pad(start)}`;
  const [y2, m2] = shiftPeriod(key, 1).split('-').map(Number);
  const end = new Date(Date.UTC(y2, m2 - 1, start) - 86400000);
  return { from, to: end.toISOString().slice(0, 10) };
}

const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

/** Gasto e ingresos entre dos fechas (inclusive). No incluye ingresos fijos ni rendimientos de resumen. */
export function rangeTotals(f, from, to) {
  const cls = classified(f);
  let spent = 0;
  let income = 0;
  for (const m of f.movs) {
    if (m.date < from || m.date > to) continue;
    const c = cls.get(m.id);
    if (c.type === 'gasto') spent -= m.amount;
    else if (c.type === 'ingreso') income += m.amount;
  }
  return { spent, income };
}

/**
 * Barras de tendencia que terminan en el periodo `key`.
 * n = 1: semanas del mes · n = 3 o 6: meses.
 */
export function trendBars(f, key, n) {
  if (n === 1) {
    const { from, to } = periodRange(key, f.monthStart);
    const out = [];
    for (let d = from, i = 1; d <= to; d = addDays(d, 7), i++) {
      const end = addDays(d, 6) < to ? addDays(d, 6) : to;
      const fixed = fixedIncomes(f, key).filter((x) => x.date >= d && x.date <= end).reduce((a, x) => a + x.amount, 0);
      const t = rangeTotals(f, d, end);
      out.push({ id: d, label: `S${i}`, spent: t.spent, income: t.income + fixed, from: d, to: end });
    }
    return out;
  }
  return Array.from({ length: n }, (_, i) => {
    const k = shiftPeriod(key, i - n + 1);
    const s = periodStats(f, k);
    return { id: k, label: periodLabel(k, 1).slice(0, 3), spent: s.spent, income: s.income, key: k };
  });
}

/** Saldos según el último extracto de cada banco. */
export function savings(f) {
  const last = {};
  for (const s of f.stmts) if (!last[s.bank] || s.to > last[s.bank].to) last[s.bank] = s;
  const rows = [];
  if (last.nequi) rows.push({ id: 'nequi', name: 'Nequi', value: last.nequi.balances.nequi, at: last.nequi.to });
  if (last.nu) {
    const b = last.nu.balances;
    if (b.nu != null) rows.push({ id: 'nu', name: 'Cuenta Nu', value: b.nu, at: last.nu.to });
    if (b.cajitas != null) rows.push({ id: 'cajitas', name: 'Cajitas Nu', value: b.cajitas, at: last.nu.to, saving: true });
    if (b.cdt != null) rows.push({ id: 'cdt', name: 'CDT Nu', value: b.cdt, at: last.nu.to, saving: true });
  }
  const total = rows.reduce((a, r) => a + (r.value || 0), 0);
  const saved = rows.filter((r) => r.saving).reduce((a, r) => a + (r.value || 0), 0);
  return { rows, total, saved };
}

/** Total de saldos al cierre de cada periodo (con los extractos de ese periodo). */
export function savingsHistory(f, keys) {
  return keys.map((k) => {
    const ss = f.stmts.filter((s) => periodOf(s.to, f.monthStart) === k);
    const v = ss.reduce((a, s) => a + Object.values(s.balances || {}).reduce((x, y) => x + (y || 0), 0), 0);
    return { key: k, value: ss.length ? v : null };
  });
}

/** Movimientos que conviene revisar: asignados con confianza media o baja y sin corregir. */
export function reviewList(f) {
  const cls = classified(f);
  return f.movs
    .filter((m) => { const c = cls.get(m.id); return !c.manual && c.conf !== 'alta'; })
    .sort((a, b) => b.date.localeCompare(a.date) || a.amount - b.amount);
}
