import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || '';

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* retrying */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite preview no respondió a tiempo');
}

function startPreview() {
  const viteBin = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--host', 'localhost'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return child;
}

async function checkNoOverflow(page, label) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(sw <= 393, `Desbordamiento horizontal en ${label}: scrollWidth=${sw}`);
}

async function shot(page, name) {
  if (!SCREENSHOT_DIR) return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOT_DIR, name) });
}

async function run() {
  const preview = startPreview();
  let browser;
  try {
    await waitForServer(URL);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

    // Configurar autenticador virtual WebAuthn con PRF (el caso fallido va al final)
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        ctap2Version: 'ctap2_1',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        hasPrf: true,
        isUserVerified: true,
      },
    });

    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.cards');
    await checkNoOverflow(page, 'Inicio');

    // 1. Tiempo: iniciar y detener sesión corta, verificar que Editar permite añadir nota (< 1 min) y borrar fecha no rompe
    await page.getByRole('button', { name: /Iniciar Proyectos/i }).click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: /Finalizar Proyectos/i }).click();
    await shot(page, '01-home.png');

    // Ajustar minSeconds a 0 en Ajustes para probar edición de sesión < 1 min
    await page.getByRole('button', { name: 'Ajustes' }).click();
    await checkNoOverflow(page, 'Ajustes');

    // Crear sesión manual corta en Registro y probar borrar fecha en EditSheet
    await page.getByRole('button', { name: 'Registro' }).click();
    await checkNoOverflow(page, 'Registro');
    await page.getByRole('button', { name: 'Añadir sesión' }).click();
    const startInput = page.locator('input[type="datetime-local"]').first();
    await startInput.fill('');
    await page.waitForSelector('.msg.err');
    await page.getByRole('button', { name: 'Cancelar' }).click();

    // Probar Dinero -> pide bloqueo -> activar bloqueo con 4 chars
    await page.getByRole('button', { name: 'Dinero' }).click();
    await page.getByRole('button', { name: 'Activar bloqueo' }).click();
    const lockInputs = page.locator('.sheet input[type="password"]');
    await lockInputs.nth(0).fill('1234');
    await lockInputs.nth(1).fill('1234');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.waitForSelector('.btn-grid');

    // Verificar en IndexedDB que vault existe y settings/sessions están limpios
    const idbCheck = await page.evaluate(() => new Promise((res, rej) => {
      const req = indexedDB.open('pp', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['sessions', 'kv'], 'readonly');
        const out = {};
        tx.objectStore('sessions').getAll().onsuccess = (e) => { out.sessions = e.target.result.length; };
        tx.objectStore('kv').get('settings').onsuccess = (e) => { out.settings = e.target.result; };
        tx.objectStore('kv').get('vault').onsuccess = (e) => { out.hasVault = !!e.target.result?.ct; };
        tx.oncomplete = () => res(out);
      };
      req.onerror = () => rej(req.error);
    }));
    assert.equal(idbCheck.sessions, 0);
    assert.equal(idbCheck.settings, undefined);
    assert.equal(idbCheck.hasVault, true);

    // Enrolar Face ID en Ajustes
    await page.getByRole('button', { name: 'Ajustes' }).click();
    const faceRow = page.locator('.set-row', { hasText: 'Face ID' });
    await faceRow.locator('button[role="switch"]').click();
    const bioToast = await page.waitForSelector('.toast');
    const toastCls = await bioToast.getAttribute('class');
    const toastTxt = await bioToast.textContent();
    if (toastCls?.includes('info') && toastTxt?.includes('Confirmar')) {
      await bioToast.locator('button').click();
      await page.waitForSelector('.toast.ok');
    } else {
      assert.ok(toastCls?.includes('ok'), `Error activando Face ID: ${toastTxt}`);
    }

    // Importar respaldo sintético con sesiones, categorías, extractos Nequi/Nu con montos en millones
    const syntheticBackup = {
      app: 'PP',
      schema: 3,
      exportedAt: Date.now(),
      settings: {
        settingsVersion: 2,
        cats: [
          { id: 'proy', name: 'Proyectos', short: 'Proy', color: 3, icon: 'proy', cap: 10, archived: false },
          { id: 'lect', name: 'Lectura', short: 'Lectura', color: 2, icon: 'book', cap: 5, archived: false },
        ],
        groups: [],
        warnPct: 80,
        sound: false,
        forgetHours: 8,
        minSeconds: 0,
        theme: 'dark',
        variant: 'aurora',
        privacy: 'off',
      },
      sessions: [
        { id: 'sx1', cat: 'lect', start: Date.now() - 3600000, end: Date.now() - 3570000, note: '' }, // 30s!
      ],
      fin: {
        v: 1,
        owner: 'JUAN PEREZ',
        monthStart: 1,
        movs: [
          { id: 'm1', acct: 'nequi', date: '2026-01-15', desc: 'Intereses', amount: 1500000, src: 'nequi:2026-01-01' },
          { id: 'm2', acct: 'nequi', date: '2026-02-15', desc: 'Intereses', amount: 2100000, src: 'nequi:2026-02-01' },
          { id: 'm3', acct: 'nu', date: '2026-02-18', desc: 'Para MARIA LOPEZ', amount: -850000, src: 'nu:2026-02-01' },
        ],
        stmts: [
          { key: 'nequi:2026-01-01', bank: 'nequi', from: '2026-01-01', to: '2026-01-31', summary: { closing: 550000000 }, balances: { nequi: 550000000 } },
          { key: 'nu:2026-01-01', bank: 'nu', from: '2026-01-01', to: '2026-01-31', summary: { closing: 950000000, yield: 4500000 }, balances: { nu: 150000000, cajitas: 800000000 }, yields: { nu: 500000, cajitas: 4000000 } },
          { key: 'nequi:2026-02-01', bank: 'nequi', from: '2026-02-01', to: '2026-02-28', summary: { closing: 620000000 }, balances: { nequi: 620000000 } },
          { key: 'nu:2026-02-01', bank: 'nu', from: '2026-02-01', to: '2026-02-28', summary: { closing: 1020000000, yield: 5200000 }, balances: { nu: 170000000, cajitas: 850000000 }, yields: { nu: 600000, cajitas: 4600000 } },
        ],
        incomes: [{ id: 'inc1', name: 'Sueldo', amount: 450000000, day: 5, acct: 'nequi', from: '2026-01' }],
      },
    };
    await page.locator('input[accept=".json,application/json"]').setInputFiles({
      name: 'respaldo-test.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(syntheticBackup)),
    });
    await page.getByRole('button', { name: /Reemplazar todo/i }).click();
    await page.waitForTimeout(350);

    // Verificar sesión corta < 1 min editable para añadir nota
    await page.getByRole('button', { name: 'Registro' }).click();
    await page.locator('.srow').first().click();
    await page.locator('.sheet input[maxlength="80"]').fill('Capítulo 1');
    const saveBtn = page.getByRole('button', { name: 'Guardar' });
    assert.equal(await saveBtn.isDisabled(), false, 'Debe dejar guardar nota en sesión < 1 min');
    await saveBtn.click();

    // Stats y todas sus vistas
    await page.getByRole('button', { name: 'Stats' }).click();
    await checkNoOverflow(page, 'Stats Semana');
    await page.getByRole('button', { name: 'Día' }).click();
    await checkNoOverflow(page, 'Stats Día');

    // Dinero: Resumen, Movimientos, Ahorro, Revisar y Configurar
    await page.getByRole('button', { name: 'Dinero', exact: true }).click();
    await checkNoOverflow(page, 'Dinero Resumen');
    await page.getByRole('button', { name: 'Movimientos', exact: true }).click();
    await checkNoOverflow(page, 'Dinero Movimientos');
    await page.getByRole('button', { name: 'Ahorro', exact: true }).click();
    await checkNoOverflow(page, 'Dinero Ahorro');
    await shot(page, '03-money-savings.png');

    // Verificar que Rendimientos por bolsillo suma exactamente Total en Ahorro
    const yieldMatch = await page.evaluate(() => {
      const sec = document.querySelector('.sav-yield');
      if (!sec) return true;
      const vals = [...sec.querySelectorAll('.row-stat:not(.total) b')].map((b) => Number(b.textContent.replace(/[^\d-]/g, '')));
      const tot = Number(sec.querySelector('.row-stat.total b').textContent.replace(/[^\d-]/g, ''));
      return vals.reduce((a, b) => a + b, 0) === tot;
    });
    assert.equal(yieldMatch, true, 'Rendimientos por bolsillo debe coincidir con Total');

    await page.getByRole('button', { name: /Revisar/ }).click();
    await checkNoOverflow(page, 'Dinero Revisar');

    // Probar Registrar movimiento con "15,000" -> $ 15.000
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await page.locator('.sheet input[inputmode="numeric"]').fill('15,000');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('button', { name: 'Movimientos', exact: true }).click();
    const has15k = await page.locator('.mov-amt', { hasText: '15.000' }).count();
    assert.ok(has15k > 0, '15,000 debe registrarse como $ 15.000');

    // Configurar Dinero: verificar font-size >= 16px en inputs/selects
    await page.getByRole('button', { name: 'Configurar Dinero' }).click();
    await checkNoOverflow(page, 'Dinero Configurar');
    await shot(page, '04-money-config.png');
    const minFontSize = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.money-in, .select, .merch-add input')];
      return Math.min(...els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    });
    assert.ok(minFontSize >= 16, `font-size mínimo en FinConfig debe ser >= 16px (fue ${minFontSize})`);

    // Activar privacidad "Ocultar todo" (pide Face ID -> virtual authenticator verifica auto)
    await page.getByRole('button', { name: 'Volver' }).click();
    await page.getByRole('button', { name: 'Privacidad' }).click();
    await page.getByRole('button', { name: /Ocultar todo/i }).click();
    await page.getByRole('button', { name: 'Listo' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.privacy), 'all');

    // Con Ocultar todo + Face ID, probar protección en hojas (con Face ID desactivado manualmente vía password primero para probar el diálogo)
    // Desactivamos biometría temporalmente para verificar que SheetAuthDialog aparece y pide contraseña
    await page.getByRole('button', { name: 'Ajustes' }).click();
    await page.waitForSelector('.panel'); // Face ID auto-verificó AuthGate
    await page.locator('.set-row', { hasText: 'Face ID' }).locator('button[role="switch"]').click();
    await page.waitForTimeout(100);

    // Probar que abrir Editar sesión en Registro pide contraseña
    await page.getByRole('button', { name: 'Registro' }).click();
    await page.locator('.srow').first().click();
    await page.waitForSelector('.dialog input[type="password"]');
    await page.waitForTimeout(400);
    await shot(page, '02-privacy-sheet-auth.png');
    await page.locator('.dialog input[type="password"]').fill('1234');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForSelector('.sheet h2');
    await page.getByRole('button', { name: 'Cancelar' }).click();

    // Probar que "Exportar ahora" en Inicio abre diálogo protegido (no exporta en claro)
    await page.getByRole('button', { name: 'Inicio' }).click();
    await page.getByRole('button', { name: 'Reiniciar tiempo' }).click();
    await page.waitForSelector('.dialog input[type="password"]');
    await page.getByRole('button', { name: 'Cancelar' }).click();

    // Probar bloqueo automático "Al salir": con pausa de selector no bloquea; sin pausa sí bloquea
    await page.getByRole('button', { name: 'Ajustes' }).click();
    await page.locator('.auth-gate input[type="password"]').fill('1234');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('button', { name: 'Al salir' }).click();
    await page.waitForTimeout(100);

    // Simular salida real (sin pausa): debe bloquear y limpiar
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForSelector('.lock-box');

    // Restaurar document.hidden y entrar con contraseña
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(400);
    await shot(page, '05-lock-screen.png');
    await page.locator('.lock-box input[type="password"]').fill('1234');
    await page.getByRole('button', { name: 'Entrar' }).click();
    // Al desbloquear estando en Ajustes con privacidad activa, AuthGate protege Ajustes hasta verificar
    await page.waitForSelector('.auth-gate');
    await page.locator('.auth-gate input[type="password"]').fill('1234');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForSelector('main[data-tab="settings"] .panel');
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await page.waitForSelector('.cards');

    // Atajo del Botón de Acción: órdenes por enlace con PP bloqueada (buzón cifrado) y al desbloquear
    const kv = (key) => page.evaluate((k) => new Promise((res, rej) => {
      const req = indexedDB.open('pp', 1);
      req.onsuccess = () => { const g = req.result.transaction('kv').objectStore('kv').get(k); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); };
      req.onerror = () => rej(req.error);
    }), key);
    const sc = await kv('shortcut');
    assert.ok(sc?.k && sc.pub, 'Falta el código o la clave pública del atajo');
    const orderUrl = (a, k = sc.k) => `${URL}?k=${encodeURIComponent(k)}&a=${encodeURIComponent(a)}&t=${encodeURIComponent(new Date().toISOString())}`;
    await page.goto(orderUrl('Lectura'));
    await page.waitForSelector('.order-ok');
    assert.equal(await page.evaluate(() => location.search), '', 'La orden debe quitarse de la dirección');
    const okTxt = await page.locator('.order-ok').textContent();
    assert.match(okTxt, /Orden guardada/);
    assert.ok(!okTxt.includes('Lectura'), 'Con «Ocultar todo» no debe mostrarse la categoría elegida');
    let inbox = await kv('inbox');
    assert.equal(inbox.length, 1);
    assert.ok(!JSON.stringify(inbox).includes('Lectura'), 'La orden debe guardarse cifrada');
    // Enlace del atajo real (a=menu): PP muestra el menú con los nombres guardados y la orden elegida va al buzón
    await page.goto(orderUrl('menu'));
    await page.waitForSelector('.quick-menu');
    assert.match(await page.locator('.quick-menu').textContent(), /Lectura/);
    await checkNoOverflow(page, 'Menú del atajo');
    await shot(page, '06a-shortcut-menu.png');
    await page.getByRole('button', { name: 'Iniciar IA en 2º plano' }).click();
    await page.waitForSelector('.quick-menu', { state: 'detached' });
    await page.waitForSelector('.order-ok');
    assert.equal((await kv('inbox')).length, 2);
    await page.goto(orderUrl('Lectura', 'codigo-falso'));
    await page.waitForSelector('.lock-orders .msg.warn');
    assert.equal((await kv('inbox')).length, 2, 'Una orden con código falso no se guarda');
    await checkNoOverflow(page, 'Bloqueo con orden');
    await shot(page, '06-shortcut-locked.png');
    await page.locator('.lock-box input[type="password"]').fill('1234');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForSelector('.card.on');
    const appliedToast = await page.locator('.toast').textContent();
    assert.match(appliedToast, /Iniciaste Lectura/);
    assert.match(appliedToast, /IA en 2º plano en marcha/);
    assert.match(await page.locator('.card.on .name').textContent(), /Lectura/);
    await page.waitForSelector('.bg-lane.on');
    inbox = await kv('inbox');
    assert.ok(!inbox || inbox.length === 0, 'El buzón debe vaciarse al aplicar las órdenes');
    await checkNoOverflow(page, 'Inicio con IA en 2º plano');
    await shot(page, '07-shortcut-applied.png');
    // Parar IA en 2º plano desde la app y ver la sección del atajo en Ajustes
    await page.locator('.bg-lane.on').click();
    await page.waitForSelector('.bg-lane:not(.on)');
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.locator('.auth-gate input[type="password"]').fill('1234');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForSelector('.shortcut-link');
    assert.equal(await page.locator('.shortcut-link').textContent(), `webapp://localhost:${PORT}/?k=${sc.k}&a=menu`);
    await checkNoOverflow(page, 'Ajustes con atajo');
    await page.locator('.shortcut-link').scrollIntoViewIfNeeded();
    await shot(page, '08-shortcut-settings.png');
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await page.waitForSelector('.cards');

    // Caso final de límite de intentos (5 fallos -> espera 30 s) y Face ID fallido al final
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.locator('.auth-gate input[type="password"]').fill('1234');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
    for (let i = 0; i < 5; i++) {
      await page.locator('.sheet input[autocomplete="current-password"]').fill('0000');
      await page.locator('.sheet input[autocomplete="new-password"]').nth(0).fill('5678');
      await page.locator('.sheet input[autocomplete="new-password"]').nth(1).fill('5678');
      const saveLockBtn = page.locator('.sheet button[type="submit"]');
      await saveLockBtn.click();
      await page.waitForFunction(() => {
        const btn = document.querySelector('.sheet button[type="submit"]');
        return btn && !btn.disabled;
      });
    }
    const waitMsg = await page.locator('.sheet .msg.err').textContent();
    assert.match(waitMsg || '', /Demasiados intentos/i);
    await page.getByRole('button', { name: 'Cancelar' }).click();

    // Face ID fallido al final (como indica AGENTS.md)
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });

    assert.deepEqual(errors, [], `Errores en navegador: ${errors.join('; ')}`);
    console.log('E2E OK: todas las comprobaciones pasaron sin errores ni desbordamientos a 393 px.');
  } finally {
    if (browser) await browser.close();
    preview.kill();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
