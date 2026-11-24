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
