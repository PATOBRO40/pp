import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './components/Icon.jsx';
import { EditSheet, ImportDialog, ResetSheet, WipeDialog } from './components/Sheets.jsx';
import { applyUpdate } from './pwa.js';
import { Home } from './screens/Home.jsx';
import { Log } from './screens/Log.jsx';
import { Stats } from './screens/Stats.jsx';
import { Settings } from './screens/Settings.jsx';
import { DAY, HOUR, fmtDur, rangeTotals, startOfWeek } from './time.js';
import { activeSession, getState, now, set, toast, useStore } from './store.js';
import { beep } from './audio.js';
import { sum } from './stats.js';

const TABS = [
  ['home', 'Inicio', 'home'],
  ['log', 'Registro', 'list'],
  ['stats', 'Stats', 'chart'],
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
      if (!s.ready) return;
      const t = now();
      const ws = startOfWeek(t);
      const week = rangeTotals(s.sessions, ws, ws + 7 * DAY, t);
      const act = activeSession(s);
      for (const g of s.groups) {
        const cats = s.cats.filter((c) => c.group === g.id);
        const used = sum(week, cats.map((c) => c.id));
        const pct = used / (g.hours * HOUR);
        const lvl = pct > 1 ? 2 : pct >= s.warnPct / 100 ? 1 : 0;
        const prev = levels.current[g.id];
        if (prev !== undefined && lvl > prev && act && cats.some((c) => c.id === act.cat)) {
          if (lvl === 1) toast(`${g.name}: llegaste al ${s.warnPct}% del tope. Quedan ${fmtDur(g.hours * HOUR - used)}.`, { kind: 'warn', long: true });
          else toast(`${g.name}: superaste el tope de ${g.hours} h. Puedes seguir, es solo un aviso.`, { kind: 'over', long: true });
          if (s.sound) beep(lvl === 1 ? 'warn' : 'over');
        }
        levels.current[g.id] = lvl;
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

  const Screen = { home: Home, log: Log, stats: Stats, settings: Settings }[st.tab];

  return (
    <>
      <div class="ambient" aria-hidden="true" />
      {!st.ready ? <div class="splash"><div class="brand">PP</div></div> : <main key={st.tab}><Screen /></main>}
      <nav class="tabbar">
        {TABS.map(([id, label, icon]) => (
          <button key={id} class={st.tab === id ? 'on' : ''} onClick={() => { set({ tab: id }); window.scrollTo(0, 0); }}>
            <Icon name={icon} size={23} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <Toast t={st.toast} />
      {st.sheet?.type === 'edit' && <EditSheet id={st.sheet.id} />}
      {st.sheet?.type === 'reset' && <ResetSheet />}
      {st.sheet?.type === 'wipe' && <WipeDialog />}
      {st.sheet?.type === 'import' && <ImportDialog parsed={st.sheet.parsed} />}
    </>
  );
}
