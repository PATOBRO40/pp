import { Icon } from '../components/Icon.jsx';
import { CapBar } from '../components/CapBar.jsx';
import { DAY, fmtClock, fmtDM, fmtDate, fmtWeekday, fmtDur, fmtTime, rangeTotals, startOfDay, startOfWeek } from '../time.js';
import { activeSession, set, setMeta, toggleCat, useNow, useStore } from '../store.js';
import { exportBackup } from '../backup.js';
import { isStandalone } from '../pwa.js';
import { sum } from '../stats.js';

export function Home() {
  const st = useStore();
  const t = useNow();
  const act = activeSession(st);
  const ds = startOfDay(t);
  const ws = startOfWeek(t);
  const today = rangeTotals(st.sessions, ds, ds + DAY, t);
  const week = rangeTotals(st.sessions, ws, ws + 7 * DAY, t);
  const forgotten = act && t - act.start > st.forgetHours * 3600000 && st.dismissedForgot !== act.id;
  const actCat = act && st.cats.find((c) => c.id === act.cat);
  const backupDue = st.sessions.length > 0 && t > (st.meta.lastBackupAt ?? st.meta.installedAt) + 7 * DAY && t > st.meta.backupSnoozedUntil;
  const installHint = import.meta.env.PROD && !isStandalone() && !st.meta.installHintDismissed;

  return (
    <div class="screen">
      <header class="top">
        <div>
          <div class="eyebrow">{fmtDM(t)} · semana {fmtDM(ws)} – {fmtDM(ws + 6 * DAY)}</div>
          <h1>{fmtWeekday(t)}</h1>
        </div>
        <div class="brand" aria-hidden="true">PP</div>
      </header>

      {st.dbError && (
        <div class="banner bad">
          <Icon name="warn" />
          <div>
            <b>No se pudo guardar en este dispositivo</b>
            <span>El almacenamiento no responde (¿modo privado?). Exporta un respaldo para no perder datos.</span>
            <div class="banner-actions"><button onClick={exportBackup}>Exportar ahora</button></div>
          </div>
        </div>
      )}

      {backupDue && (
        <div class="banner">
          <Icon name="down" />
          <div>
            <b>Toca hacer un respaldo</b>
            <span>{st.meta.lastBackupAt ? 'Hace más de 7 días que no exportas.' : 'Aún no has exportado ninguno.'} Guárdalo en Archivos o iCloud.</span>
            <div class="banner-actions">
              <button onClick={exportBackup}>Exportar ahora</button>
              <button class="quiet" onClick={() => setMeta({ backupSnoozedUntil: t + DAY })}>Mañana</button>
            </div>
          </div>
        </div>
      )}

      {installHint && (
        <div class="banner info">
          <Icon name="home" />
          <div>
            <b>Instala PP en tu iPhone</b>
            <span>Compartir → «Añadir a pantalla de inicio». Los datos de Safari y de la app instalada son independientes: usa solo la instalada.</span>
            <div class="banner-actions"><button class="quiet" onClick={() => setMeta({ installHintDismissed: true })}>Entendido</button></div>
          </div>
        </div>
      )}

      {forgotten && (
        <div class="banner">
          <Icon name="clock" />
          <div>
            <b>¿Olvidaste finalizar?</b>
            <span>Llevas {fmtDur(t - act.start)} en «{actCat.short}» desde las {fmtTime(act.start)}.</span>
            <div class="banner-actions">
              <button onClick={() => toggleCat(act.cat)}>Finalizar ahora</button>
              <button onClick={() => set({ sheet: { type: 'edit', id: act.id } })}>Corregir hora</button>
              <button class="quiet" onClick={() => set({ dismissedForgot: act.id })}>Sigue en curso</button>
            </div>
          </div>
        </div>
      )}

      <section class="cards">
        {st.cats.map((c) => {
          const on = act?.cat === c.id;
          return (
            <button key={c.id} class={`card ${on ? 'on' : ''}`} style={{ '--c': `var(--p${c.color})` }}
              onClick={() => toggleCat(c.id)} aria-pressed={on}>
              <span class="card-glow" />
              <span class="card-top">
                <span class="ico"><Icon name={c.id === 'ia' || c.id === 'sin' || c.id === 'proy' ? c.id : 'proy'} size={22} /></span>
                <span class="name">{c.name}</span>
                <span class="pill"><Icon name={on ? 'stop' : 'play'} size={14} />{on ? 'Finalizar' : 'Iniciar'}</span>
              </span>
              <span class="card-bottom">
                <span class="big">{on ? fmtClock(t - act.start) : fmtDur(today[c.id] || 0)}</span>
                <span class="sub">{on ? `En curso desde las ${fmtTime(act.start)}` : 'acumulado hoy'}</span>
              </span>
            </button>
          );
        })}
      </section>

      <button class="btn ghost" onClick={() => set({ sheet: { type: 'reset' } })}><Icon name="reset" size={18} /> Reiniciar tiempo</button>

      <h3 class="sec">Topes de la semana</h3>
      <section class="panel stack">
        {st.groups.map((g) => {
          const cats = st.cats.filter((c) => c.group === g.id);
          return <CapBar key={g.id} group={g} cats={cats} perCat={week} used={sum(week, cats.map((c) => c.id))} warnPct={st.warnPct} />;
        })}
      </section>

      <h3 class="sec">Totales</h3>
      <section class="grid2">
        <div class="panel">
          <div class="panel-title">Hoy</div>
          {st.cats.map((c) => (
            <div class="row-stat" key={c.id}><i class="dot" style={{ background: `var(--p${c.color})` }} /><span>{c.short}</span><b>{fmtDur(today[c.id] || 0)}</b></div>
          ))}
          <div class="row-stat total"><span>Total</span><b>{fmtDur(sum(today, st.cats.map((c) => c.id)))}</b></div>
        </div>
        <div class="panel">
          <div class="panel-title">Semana</div>
          {st.cats.map((c) => (
            <div class="row-stat" key={c.id}><i class="dot" style={{ background: `var(--p${c.color})` }} /><span>{c.short}</span><b>{fmtDur(week[c.id] || 0)}</b></div>
          ))}
          <div class="row-stat total"><span>Total</span><b>{fmtDur(sum(week, st.cats.map((c) => c.id)))}</b></div>
        </div>
      </section>
    </div>
  );
}
