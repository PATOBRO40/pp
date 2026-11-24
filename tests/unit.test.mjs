import test from 'node:test';
import assert from 'node:assert/strict';

import { DAY, HOUR, fmtTime, fromLocalInput, splitByDay, startOfDay, toLocalInput } from '../src/time.js';
import { BackupFormatError, open, openWithPassword, seal, sealWithPassword, unseal, close, random } from '../src/vault.js';
import { parseBackup } from '../src/backup.js';
import { parseStatement } from '../src/fin/statements.js';
import { classify } from '../src/fin/classify.js';
import { defaultFin, parsePesos } from '../src/fin/model.js';
import { savingsStats, trendBars } from '../src/fin/stats.js';

test('time.js: Bogotá sin horario de verano, medianoche, fmtTime y fromLocalInput', () => {
  // 2026-03-10 23:30:00 America/Bogota = 2026-03-11 04:30:00 UTC
  const start = Date.UTC(2026, 2, 11, 4, 30, 0);
  const end = start + 60 * 60 * 1000; // 00:30:00 del día siguiente
  const segs = splitByDay({ id: 's1', cat: 'proy', start, end }, end);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].key, '2026-03-10');
  assert.equal(segs[0].end - segs[0].start, 30 * 60 * 1000);
  assert.equal(segs[1].key, '2026-03-11');
  assert.equal(segs[1].end - segs[1].start, 30 * 60 * 1000);

  // Medianoche en fmtTime debe ser 00:05, nunca 24:05
  const afterMidnight = Date.UTC(2026, 2, 11, 5, 5, 0); // 00:05 Bogotá
  assert.equal(fmtTime(afterMidnight), '00:05');

  // fromLocalInput seguro ante vacío o inválido y redondeo inverso
  assert.ok(Number.isNaN(fromLocalInput('')));
  assert.ok(Number.isNaN(fromLocalInput('fecha-mala')));
  const inp = toLocalInput(start);
  assert.equal(inp, '2026-03-10T23:30');
  assert.equal(fromLocalInput(inp), start);
  assert.equal(startOfDay(afterMidnight), Date.UTC(2026, 2, 11, 5, 0, 0));
  assert.equal(DAY, 24 * HOUR);
});

test('vault.js: cifrado de vault y validación estricta de respaldos cifrados', async () => {
  const master = random(32);
  await open(master);
  const payload = { sessions: [{ id: '1', cat: 'proy', start: 1000, end: 2000 }], settings: { theme: 'dark' }, fin: defaultFin() };
  const rec = await seal(payload);
  const out = await unseal(rec);
  assert.deepEqual(out.sessions, payload.sessions);
  close();

  const sealed = await sealWithPassword(JSON.stringify({ ok: true }), 'clave123');
  const opened = JSON.parse(await openWithPassword(sealed, 'clave123'));
  assert.equal(opened.ok, true);

  await assert.rejects(
    () => openWithPassword({ ...sealed, kdf: { ...sealed.kdf, iterations: 99999999 } }, 'clave123'),
    BackupFormatError,
  );
  await assert.rejects(
    () => openWithPassword({ v: 1, iv: 'abc', ct: 'xyz', kdf: { salt: 'aa', iterations: 310000 } }, 'clave123'),
    BackupFormatError,
  );
});

test('backup.js: rechaza ajustes inválidos, topes <= 0 y repara bands vacío', () => {
  const base = {
    app: 'PP',
    schema: 3,
    exportedAt: 1700000000000,
    settings: {
      settingsVersion: 2,
      cats: [{ id: 'proy', name: 'Proyectos', short: 'Proy', color: 3, icon: 'proy', cap: 10, archived: true }],
      groups: [],
      theme: 'hacker',
      variant: 'inexistente',
      privacy: 'secret',
      warnPct: 999,
    },
    sessions: [{ id: 's1', cat: 'proy', start: 1000, end: 5000 }],
    fin: { ...defaultFin(), bands: [] },
  };
  const parsed = parseBackup(JSON.stringify(base));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.settings.theme, undefined);
  assert.equal(parsed.settings.variant, undefined);
  assert.equal(parsed.settings.privacy, undefined);
  assert.equal(parsed.settings.warnPct, undefined);
  assert.equal(parsed.settings.cats[0].archived, false);
  assert.ok(parsed.fin.bands.length > 0);

  // Grupo con tope 0 invalida settings
  const badGroup = { ...base, settings: { ...base.settings, groups: [{ id: 'g1', name: 'X', hours: 0, cats: ['proy'] }] } };
  assert.equal(parseBackup(JSON.stringify(badGroup)).settings, null);
});

test('fin/statements.js: extractos sintéticos de Nequi y Nu y mes sin movimientos', () => {
  // Nequi sintético
  const nequiItems = [
    { str: 'NEQUI S.A.', x: 10, y: 700, page: 1 },
    { str: 'JUAN PEREZ', x: 10, y: 685, page: 1 },
    { str: 'Depósito de bajo monto', x: 10, y: 670, page: 1 },
    { str: 'Período de: 2026/02/01 a 2026/02/28', x: 10, y: 650, page: 1 },
    { str: 'Saldo anterior', x: 10, y: 620, page: 1 }, { str: '$100,000.00', x: 150, y: 620, page: 1 },
    { str: 'Total abonos', x: 10, y: 605, page: 1 }, { str: '$50,000.00', x: 150, y: 605, page: 1 },
    { str: 'Total cargos', x: 10, y: 590, page: 1 }, { str: '$20,000.00', x: 150, y: 590, page: 1 },
    { str: 'Saldo actual', x: 10, y: 575, page: 1 }, { str: '$130,000.00', x: 150, y: 575, page: 1 },
    { str: '20/02/2026', x: 10, y: 500, page: 1 }, { str: 'Para MARIA LOPEZ', x: 80, y: 500, page: 1 }, { str: '$-20,000.00', x: 250, y: 500, page: 1 }, { str: '$130,000.00', x: 350, y: 500, page: 1 },
    { str: '10/02/2026', x: 10, y: 480, page: 1 }, { str: 'Recarga desde Bancolombia', x: 80, y: 480, page: 1 }, { str: '$50,000.00', x: 250, y: 480, page: 1 }, { str: '$150,000.00', x: 350, y: 480, page: 1 },
  ];
  const stNequi = parseStatement(nequiItems);
  assert.equal(stNequi.bank, 'nequi');
  assert.equal(stNequi.check.ok, true);
  assert.equal(stNequi.rows.length, 2);
  assert.equal(stNequi.summary.closing, 13000000);

  // Nu sintético con 0 movimientos pero resumen en cero que cuadra
  const nuZero = [
    { str: 'Nu Colombia Compañía de Financiamiento S.A.', x: 10, y: 720, page: 1 },
    { str: 'Llegó tu extracto', x: 10, y: 700, page: 1 },
    { str: '   ', x: 10, y: 695, page: 1 },
    { str: 'JUAN PEREZ', x: 10, y: 690, page: 1 },
    { str: '01 - 28 FEB 2026', x: 10, y: 670, page: 1 },
    { str: 'Movimientos', x: 10, y: 650, page: 1 },
    { str: 'Tu dinero al inicio del mes', x: 10, y: 620, page: 1 }, { str: '$500.000,00', x: 200, y: 620, page: 1 },
    { str: 'Lo que entró a tu cuenta', x: 10, y: 605, page: 1 }, { str: '+$0,00', x: 200, y: 605, page: 1 },
    { str: 'Lo que salió de tu cuenta', x: 10, y: 590, page: 1 }, { str: '-$0,00', x: 200, y: 590, page: 1 },
    { str: 'Rendimiento total de tu cuenta', x: 10, y: 575, page: 1 }, { str: '+$3.000,00', x: 200, y: 575, page: 1 },
    { str: 'Tu dinero a final del mes', x: 10, y: 560, page: 1 }, { str: '$503.000,00', x: 200, y: 560, page: 1 },
  ];
  const stNu = parseStatement(nuZero);
  assert.equal(stNu.bank, 'nu');
  assert.equal(stNu.holder, 'JUAN PEREZ');
  assert.equal(stNu.check.ok, true);
});

test('fin/classify.js: reversos no anulan compras posteriores ni coinciden con preposiciones vacías', () => {
  const f = {
    ...defaultFin(),
    bands: [],
    movs: [
      { id: 'rev1', acct: 'nu', date: '2026-03-05', desc: 'DEVOLUCION DE', amount: 2500000, src: 'nu:2026-03-01' },
      { id: 'buy1', acct: 'nu', date: '2026-03-10', desc: 'Compra en CAFETERIA CENTRAL', amount: -2500000, src: 'nu:2026-03-01' },
      { id: 'buy2', acct: 'nu', date: '2026-03-01', desc: 'Compra en TIENDA SOL', amount: -1000000, src: 'nu:2026-03-01' },
      { id: 'rev2', acct: 'nu', date: '2026-03-03', desc: 'REVERSO COMPRA EN TIENDA SOL', amount: 1000000, src: 'nu:2026-03-01' },
      { id: 'pers1', acct: 'nequi', date: '2026-03-04', desc: 'Para ANA GOMEZ', amount: -500000, src: 'nequi:2026-03-01' },
    ],
  };
  const cls = classify(f);
  assert.notEqual(cls.get('buy1').type, 'anulado');
  assert.notEqual(cls.get('rev1').type, 'anulado');
  assert.equal(cls.get('buy2').type, 'anulado');
  assert.equal(cls.get('rev2').type, 'anulado');
  assert.equal(cls.get('pers1').cat, 'rest'); // bands vacío seguro
});

test('fin/stats.js y parsePesos: monthStart > 1, yieldBy === yield y formatos de pesos', () => {
  assert.equal(parsePesos('15.000'), 15000);
  assert.equal(parsePesos('15,000'), 15000);
  assert.equal(parsePesos('1500,50'), 1501);

  const f = {
    ...defaultFin(),
    monthStart: 15,
    incomes: [{ id: 'inc1', name: 'Sueldo', amount: 300000000, day: 5, acct: 'nequi', from: '2026-01' }],
    movs: [
      { id: 'm1', acct: 'nequi', date: '2026-01-20', desc: 'Intereses', amount: 1000000, src: 'nequi:2026-01-01' },
      { id: 'm2', acct: 'nequi', date: '2026-02-20', desc: 'Intereses', amount: 1200000, src: 'nequi:2026-02-01' },
    ],
    stmts: [
      { key: 'nu:2026-01-01', bank: 'nu', from: '2026-01-01', to: '2026-01-31', summary: { closing: 100000000, yield: 5000000 }, balances: { nu: 20000000, cajitas: 80000000 }, yields: { nu: 500000, cajitas: 4500000 } },
      { key: 'nu:2026-02-01', bank: 'nu', from: '2026-02-01', to: '2026-02-28', summary: { closing: 110000000, yield: 6000000 }, balances: { nu: 25000000, cajitas: 85000000 }, yields: { nu: 600000, cajitas: 5400000 } },
    ],
  };

  // En el periodo 2026-03 (15 mar - 14 abr), ingreso fijo del día 5 cae en abril 5 y suma en trendBars(1)
  const bars = trendBars(f, '2026-03', 1);
  const totalInc = bars.reduce((a, b) => a + b.income, 0);
  assert.equal(totalInc, 300000000);

  // En Ahorro, yieldBy debe cuadrar exactamente con stats.yield incluso empezando en el primer mes
  const st1 = savingsStats(f, ['2026-01']);
  assert.equal(st1.yield, 0);
  assert.equal(st1.yieldBy.reduce((a, [, v]) => a + v, 0), st1.yield);

  const st2 = savingsStats(f, ['2026-01', '2026-02']);
  assert.equal(st2.yieldBy.reduce((a, [, v]) => a + v, 0), st2.yield);
});

import { BG_OFF, BG_ON, STOP, applyOrders, menuLines, orderTime, parseOrder, realEnd, resolveAction, trimOverdue } from '../src/orders.js';
import { defaults, migrateSettings } from '../src/model.js';
import { genKeys, openOrders, sealOrder } from '../src/inbox.js';

const H = 3600000;
const CATS = defaults.cats.map((c) => ({ ...c }));
let seq = 0;
const nid = () => `n${++seq}`;
const base = (over = {}) => ({ sessions: [], bg: [], cats: CATS, bgMax: 4, minSeconds: 5, ...over });

test('orders.js: lee la orden del enlace, la hora del toque y reconoce las opciones del menú', () => {
  const o = parseOrder('?k=abc&a=%E2%8F%B9%EF%B8%8F%20Parar&t=2026-11-24T14:32:05-05:00');
  assert.equal(o.k, 'abc');
  assert.equal(o.t, Date.UTC(2026, 10, 24, 19, 32, 5));
  assert.deepEqual(resolveAction(o.a, CATS), { type: 'stop' }); // con o sin el selector de emoji FE0F
  assert.equal(parseOrder('?k=abc'), null);
  assert.equal(parseOrder(''), null);
  // «+» de zona horaria que llega como espacio
  assert.equal(parseOrder('?a=Series&t=2026-11-24T19:32:05+00:00').t, Date.UTC(2026, 10, 24, 19, 32, 5));

  assert.deepEqual(resolveAction('series', CATS), { type: 'cat', id: 'series' });
  assert.deepEqual(resolveAction('Ensoñaciones con IA', CATS), { type: 'cat', id: 'ia' });
  assert.deepEqual(resolveAction(' ensoñaciones   CON ia ', CATS), { type: 'cat', id: 'ia' });
  assert.deepEqual(resolveAction(BG_ON, CATS), { type: 'bgOn' });
  assert.deepEqual(resolveAction(BG_OFF, CATS), { type: 'bgOff' });
  assert.equal(resolveAction('Redes sociales', CATS), null);
  const lines = menuLines(CATS);
  assert.equal(lines[0], STOP);
  assert.equal(lines.at(-1), BG_OFF);
  assert.equal(lines.length, CATS.length + 3);
  for (const l of lines) assert.ok(resolveAction(l, CATS), `sin acción para ${l}`);

  // Hora: se usa la del toque si es creíble; si viene del futuro o es muy vieja, la de llegada
  const now = 1_000_000_000_000;
  assert.equal(orderTime(now - 30000, now), now - 30000);
  assert.equal(orderTime(now + 5 * 60000, now), now);
  assert.equal(orderTime(now - 7 * H, now), now);
  assert.equal(orderTime(null, now), now);
});

test('orders.js: cambiar de categoría, repetir la activa, parar e IA en 2º plano en paralelo', () => {
  const t0 = 1_000_000_000_000;
  let st = base({ sessions: [{ id: 's0', cat: 'juegos', start: t0 - 80 * 60000, end: null, note: '' }] });
  let r = applyOrders(st, [{ a: 'Series', t: t0 }], t0, nid);
  assert.equal(r.sessions.length, 2);
  assert.equal(r.sessions[0].end, t0);
  assert.equal(r.sessions[1].cat, 'series');
  assert.equal(r.sessions[1].end, null);
  assert.match(r.msgs[0], /Iniciaste Series · paraste Videojuegos \(1 h 20 m\)/);

  st = { ...st, sessions: r.sessions };
  r = applyOrders(st, [{ a: 'Series', t: t0 + 60000 }], t0 + 60000, nid);
  assert.equal(r.sessions, st.sessions); // la misma: no cambia nada
  assert.match(r.msgs[0], /ya estaba en curso/);

  // IA en 2º plano no se cierra al cambiar de categoría
  r = applyOrders(st, [{ a: BG_ON, t: t0 + 60000 }, { a: 'Proyectos', t: t0 + 120000 }], t0 + 120000, nid);
  assert.equal(r.bg.length, 1);
  assert.equal(r.bg[0].end, null);
  assert.equal(r.sessions.find((s) => s.end == null).cat, 'proy');
  st = { ...st, sessions: r.sessions, bg: r.bg };
  r = applyOrders(st, [{ a: STOP, t: t0 + 180000 }, { a: BG_OFF, t: t0 + 240000 }], t0 + 240000, nid);
  assert.ok(r.sessions.every((s) => s.end != null));
  assert.equal(r.bg[0].end, t0 + 240000);

  // Orden repetida (misma categoría y misma hora) no duplica la sesión
  const once = applyOrders(base(), [{ a: 'Series', t: t0 }], t0, nid);
  const twice = applyOrders({ ...base(), sessions: once.sessions.map((s) => ({ ...s, end: t0 + H })) }, [{ a: 'Series', t: t0 }], t0 + 2 * H, nid);
  assert.equal(twice.sessions.length, 1);
  // Opción desconocida: aviso, sin cambios
  const bad = applyOrders(base(), [{ a: 'Redes sociales', t: t0 }], t0, nid);
  assert.equal(bad.sessions.length, 0);
  assert.match(bad.msgs[0], /No reconozco/);
});

test('orders.js: recorte al máximo por sesión, también con órdenes guardadas que llegan tarde', () => {
  const t0 = 1_000_000_000_000;
  // Series (máximo 3 h) quedó abierta 7 h: se recorta a 3 h y se marca para revisar
  const st = base({ sessions: [{ id: 's1', cat: 'series', start: t0, end: null, note: '' }] });
  const tr = trimOverdue(st, t0 + 7 * H);
  assert.equal(tr.cut.length, 1);
  assert.equal(tr.sessions[0].end, t0 + 3 * H);
  assert.equal(tr.sessions[0].cut, true);
  assert.equal(trimOverdue(st, t0 + 2 * H).cut.length, 0);
  // Sin máximo (null) no se recorta
  const noMax = base({ cats: CATS.map((c) => ({ ...c, max: null })), sessions: st.sessions });
  assert.equal(trimOverdue(noMax, t0 + 30 * H).cut.length, 0);

  // Orden guardada a las t0+5h (Proyectos) aplicada horas después: primero se recorta Series a t0+3h
  const r = applyOrders(st, [{ a: 'Proyectos', t: t0 + 5 * H }], t0 + 6 * H, nid);
  const series = r.sessions.find((s) => s.cat === 'series');
  const proy = r.sessions.find((s) => s.cat === 'proy');
  assert.equal(series.end, t0 + 3 * H);
  assert.equal(series.cut, true);
  assert.equal(proy.start, t0 + 5 * H);
  assert.equal(proy.end, null);

  // «Era real»: hasta ahora, o hasta que empezó la siguiente sesión
  assert.equal(realEnd(r.sessions, series, t0 + 6 * H), t0 + 5 * H);
  assert.equal(realEnd(tr.sessions, tr.sessions[0], t0 + 7 * H), t0 + 7 * H);

  // IA en 2º plano con su propio máximo
  const b = trimOverdue(base({ bg: [{ id: 'b1', cat: 'bg', start: t0, end: null }] }), t0 + 5 * H);
  assert.equal(b.bg[0].end, t0 + 4 * H);
  assert.equal(trimOverdue(base({ bgMax: 0, bg: [{ id: 'b1', cat: 'bg', start: t0, end: null }] }), t0 + 50 * H).cut.length, 0);
});

test('model.js e inbox.js: migración a ajustes v3 y buzón cifrado de órdenes', async () => {
  const v2 = { settingsVersion: 2, cats: [{ id: 'series', name: 'Series', short: 'Series', color: 6, icon: 'tv', cap: 21, archived: false }, { id: 'cx', name: 'Otra', short: 'Otra', color: 1, icon: 'star', cap: null, archived: false }], groups: [] };
  const v3 = migrateSettings(v2);
  assert.equal(v3.settingsVersion, 3);
  assert.equal(v3.cats[0].max, 3);
  assert.equal(v3.cats[1].max, null);
  assert.equal(v3.bgMax, 4);
  assert.equal(migrateSettings(v3), v3);

  const { pub, priv } = await genKeys();
  const ct = await sealOrder(pub, { a: 'Series', t: 123 });
  assert.ok(!ct.includes('Series'));
  const other = await genKeys();
  assert.deepEqual(await openOrders(priv, [ct, 'basura']), [{ a: 'Series', t: 123 }]);
  assert.deepEqual(await openOrders(other.priv, [ct]), []); // otra clave no la abre
});

test('backup.js: IA en 2º plano y máximo por sesión viajan en el respaldo', () => {
  const parsed = parseBackup(JSON.stringify({
    app: 'PP', schema: 3, exportedAt: 5000,
    settings: { ...defaults, cats: defaults.cats.map((c) => ({ ...c, max: c.id === 'series' ? 99 : c.max })), bgMax: 3 },
    sessions: [],
    bg: [{ id: 'b1', cat: 'bg', start: 1000, end: 2000 }, { id: 'b2', start: 3000, end: null }, { start: 9, end: 1 }],
  }));
  assert.equal(parsed.bg.length, 2);
  assert.equal(parsed.bg[1].end, 5000);
  assert.equal(parsed.settings.bgMax, 3);
  assert.equal(parsed.settings.cats.find((c) => c.id === 'series').max, null); // 99 h no es válido
});
