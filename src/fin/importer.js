// Une un extracto leído con los datos de Dinero. Reimportar el mismo extracto no duplica nada
// y respeta lo que hayas corregido a mano.

const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** Ids estables: el mismo movimiento del mismo extracto siempre da el mismo id. */
export function rowIds(st) {
  const seen = {};
  return st.rows.map((r) => {
    const base = `${st.bank}|${r.date}|${r.amount}|${r.desc}`;
    seen[base] = (seen[base] || 0) + 1;
    return `${base}|${seen[base]}`;
  });
}

/** Cuántos movimientos son nuevos y cuántos ya estaban. */
export function previewImport(f, st) {
  const have = new Set(f.movs.map((m) => m.id));
  const ids = rowIds(st);
  const fresh = ids.filter((id) => !have.has(id)).length;
  const key = `${st.bank}:${st.period.from}`;
  return { fresh, dup: ids.length - fresh, replaces: f.stmts.some((s) => s.key === key) };
}

export function mergeStatement(f, st) {
  const have = new Set(f.movs.map((m) => m.id));
  const ids = rowIds(st);
  const src = `${st.bank}:${st.period.from}`;
  const add = st.rows
    .map((r, i) => ({ id: ids[i], acct: st.bank, date: r.date, desc: r.desc, amount: r.amount, src }))
    .filter((m) => !have.has(m.id));
  // Un registro manual del mismo valor en esa cuenta (±3 días) queda sustituido por el del extracto
  const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= 3 * 86400000;
  const used = new Set();
  const replaced = new Set();
  for (const r of add) {
    const m = f.movs.find((x) => x.src === 'manual' && x.acct === st.bank && !used.has(x.id) && x.amount === r.amount && near(x.date, r.date));
    if (m) { used.add(m.id); replaced.add(m.id); if (m.manual) r.manual = m.manual; if (m.note) r.note = m.note; }
  }
  const stmt = {
    key: src, bank: st.bank, from: st.period.from, to: st.period.to,
    summary: st.summary, balances: st.balances, importedAt: Date.now(),
  };
  return {
    ...f,
    owner: f.owner || (st.holder ? titleCase(st.holder) : ''),
    movs: [...f.movs.filter((m) => !replaced.has(m.id)), ...add].sort((a, b) => a.date.localeCompare(b.date)),
    stmts: [...f.stmts.filter((s) => s.key !== src), stmt],
  };
}
