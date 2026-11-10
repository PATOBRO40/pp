import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './components/Icon.jsx';
import { EditSheet, ImportDialog, ResetSheet, WipeDialog } from './components/Sheets.jsx';
import { LockScreen, LockSheet } from './components/Lock.jsx';
import { applyUpdate } from './pwa.js';
import { Home } from './screens/Home.jsx';
import { Log } from './screens/Log.jsx';
import { Stats } from './screens/Stats.jsx';
import { Settings } from './screens/Settings.jsx';
import { DAY, HOUR, fmtDur, rangeTotals, startOfWeek } from './time.js';
import { activeSession, getState, now, set, toast, useStore } from './store.js';
import { beep } from './audio.js';
import { sum } from './stats.js';
import { allCaps } from './model.js';
import { CategorySheet, GroupSheet } from './components/Config.jsx';
import { Money } from './screens/Money.jsx';
import { IncomeSheet, MovSheet, StatementSheet } from './components/FinSheets.jsx';
import { ExportSheet, ImportPasswordDialog } from './components/Sheets.jsx';

const TABS = [
  ['home', 'Inicio', 'home'],
  ['log', 'Registro', 'list'],
  ['stats', 'Stats', 'chart'],
  ['money', 'Dinero', 'wallet'],
  ['settings', 'Ajustes', 'gear'],
];

const BG = {
  aurora: { dark: '#0A0C12', light: '#F4F3FB' },
  neon: { dark: '#000000', light: '#F2F2EE' },
  editorial: { dark: '#14110E', light: '#F5EFE3' },
};

/** Avisa al cruzar el umbral o el tope mientras hay una sesión corriendo. */
function useCapAlerts() {
  const levels = useRef({});
  useEffect(() => {
    const id = setInterval(() => {
      const s = getState();
      if (!s.ready || s.locked) return;
      const t = now();
      const ws = startOfWeek(t);
      const week = rangeTotals(s.sessions, ws, ws + 7 * DAY, t);
      const act = activeSession(s);
      // Una sesión puede llenar varios topes a la vez: se avisa de todos en un solo mensaje.
      const msgs = [];
      let worst = 0;
      for (const cap of allCaps(s)) {
        if (!(cap.hours > 0)) continue;
        const used = sum(week, cap.cats);
        const pct = used / (cap.hours * HOUR);
        const lvl = pct > 1 ? 2 : pct >= s.warnPct / 100 ? 1 : 0;
        const prev = levels.current[cap.key];
        if (prev !== undefined && lvl > prev && act && cap.cats.includes(act.cat)) {
          msgs.push(lvl === 1 ? `${cap.name}: ${s.warnPct}% del tope, quedan ${fmtDur(cap.hours * HOUR - used)}` : `${cap.name}: superaste las ${cap.hours} h`);
          worst = Math.max(worst, lvl);
        }
        levels.current[cap.key] = lvl;
      }
      if (msgs.length) {
        toast(msgs.join(' · ') + (worst === 2 ? '. Es solo un aviso.' : '.'), { kind: worst === 2 ? 'over' : 'warn', long: true });
        if (s.sound) beep(worst === 2 ? 'over' : 'warn');
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);
}

function Toast({ t }) {
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => set({ toast: null }), t.long ? 7000 : t.action ? 6000 : 2600);
    return () => clearTimeout(h);
  }, [t?.id]);
  if (!t) return null;
  return (
    <div class={`toast ${t.kind}`} key={t.id} role="status">
      <Icon name={t.kind === 'ok' || t.kind === 'info' ? 'check' : 'warn'} size={18} />
      <span>{t.msg}</span>
      {t.action && <button onClick={() => { t.action.fn(); set({ toast: null }); }}>{t.action.label}</button>}
    </div>
  );
}

export function App() {
  const st = useStore();
  useCapAlerts();

  // Aplica variante y tema (con modo auto) al <html>
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = st.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : st.theme;
      const el = document.documentElement;
      el.dataset.v = st.variant;
      el.dataset.theme = theme;
      document.querySelector('meta[name=theme-color]').content = BG[st.variant][theme];
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [st.theme, st.variant]);

  // Aviso de versión nueva lista (la app no se actualiza sola)
  useEffect(() => {
    if (st.updateReady) toast('Hay una versión nueva de PP', { kind: 'info', long: true, action: { label: 'Actualizar', fn: applyUpdate } });
  }, [st.updateReady]);

  if (st.ready && st.locked) return <><div class="ambient" aria-hidden="true" /><LockScreen /></>;

  const Screen = { home: Home, log: Log, stats: Stats, money: Money, settings: Settings }[st.tab] || Home;

  return (
    <>
      <div class="ambient" aria-hidden="true" />
      {!st.ready ? <div class="splash"><div class="brand">PP</div></div> : <main key={st.tab}><Screen /></main>}
      {st.ready && <nav class="tabbar">
        {TABS.map(([id, label, icon]) => (
          <button key={id} class={st.tab === id ? 'on' : ''} onClick={() => { set({ tab: id }); window.scrollTo(0, 0); }}>
            <Icon name={icon} size={23} /><span>{label}</span>
          </button>
        ))}
      </nav>}
      <Toast t={st.toast} />
      {st.sheet?.type === 'edit' && <EditSheet id={st.sheet.id} />}
      {st.sheet?.type === 'reset' && <ResetSheet />}
      {st.sheet?.type === 'cat' && <CategorySheet id={st.sheet.id} />}
      {st.sheet?.type === 'group' && <GroupSheet id={st.sheet.id} />}
      {st.sheet?.type === 'lock' && <LockSheet key={st.sheet.mode} mode={st.sheet.mode} />}
      {st.sheet?.type === 'wipe' && <WipeDialog />}
      {st.sheet?.type === 'import' && <ImportDialog parsed={st.sheet.parsed} />}
      {st.sheet?.type === 'importpw' && <ImportPasswordDialog encrypted={st.sheet.encrypted} />}
      {st.sheet?.type === 'export' && <ExportSheet />}
      {st.sheet?.type === 'stmt' && <StatementSheet results={st.sheet.results} />}
      {st.sheet?.type === 'mov' && <MovSheet key={st.sheet.id || 'new'} id={st.sheet.id} />}
      {st.sheet?.type === 'income' && <IncomeSheet key={st.sheet.id || 'new'} id={st.sheet.id} />}
    </>
  );
}
