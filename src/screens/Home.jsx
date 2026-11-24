import { Icon } from '../components/Icon.jsx';
import { PrivacyButton, openProtectedSheet } from '../components/Privacy.jsx';
import { CapBar } from '../components/CapBar.jsx';
import { DAY, fmtClock, fmtDM, fmtWeekday, fmtDur, fmtTime, rangeTotals, startOfDay, startOfWeek } from '../time.js';
import { activeSession, resolveCut, set, setMeta, toggleBg, toggleCat, useNow, useStore } from '../store.js';
import { BG_NAME, realEnd } from '../orders.js';
import { isStandalone } from '../pwa.js';
import { sum } from '../stats.js';
import { catById, catsWithData, liveCats, topLevelCaps } from '../model.js';

export function Home() {
  const st = useStore();
  const t = useNow();
  const act = activeSession(st);
  const ds = startOfDay(t);
  const ws = startOfWeek(t);
  const today = rangeTotals(st.sessions, ds, ds + DAY, t);
  const week = rangeTotals(st.sessions, ws, ws + 7 * DAY, t);
  const bgAct = st.bg.find((x) => x.end == null);
  const bgToday = rangeTotals(st.bg, ds, ds + DAY, t).bg || 0;
  const bgWeek = rangeTotals(st.bg, ws, ws + 7 * DAY, t).bg || 0;
  const cuts = [...st.sessions.filter((s) => s.cut).map((s) => ['sessions', s]), ...st.bg.filter((s) => s.cut).map((s) => ['bg', s])];
  const forgotten = act && t - act.start > st.forgetHours * 3600000 && st.dismissedForgot !== act.id;
  const actCat = act && catById(st, act.cat);
  const backupDue = st.sessions.length > 0 && t > (st.meta.lastBackupAt ?? st.meta.installedAt) + 7 * DAY && t > st.meta.backupSnoozedUntil;
  const installHint = import.meta.env.PROD && !isStandalone() && !st.meta.installHintDismissed;

  return (
    <div class="screen">
      <header class="top">
        <div>
          <div class="eyebrow">{fmtDM(t)} · semana {fmtDM(ws)} – {fmtDM(ws + 6 * DAY)}</div>
          <h1>{fmtWeekday(t)}</h1>
        </div>
        <PrivacyButton />
      </header>

      {st.dbError && (
        <div class="banner bad">
          <Icon name="warn" />
          <div>
            <b>No se pudo guardar en este dispositivo</b>
            <span>El almacenamiento no responde (¿modo privado?). Exporta un respaldo para no perder datos.</span>
            <div class="banner-actions"><button onClick={() => openProtectedSheet({ type: 'export' }, 'Exportar respaldo')}>Exportar ahora</button></div>
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
              <button onClick={() => openProtectedSheet({ type: 'export' }, 'Exportar respaldo')}>Exportar ahora</button>
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
            <span class="pv">Llevas {fmtDur(t - act.start)} en «{actCat.short}» desde las {fmtTime(act.start)}.</span>
            <div class="banner-actions">
              <button onClick={() => toggleCat(act.cat)}>Finalizar ahora</button>
              <button onClick={() => openProtectedSheet({ type: 'edit', id: act.id }, 'Editar sesión')}>Corregir hora</button>
              <button class="quiet" onClick={() => set({ dismissedForgot: act.id })}>Sigue en curso</button>
            </div>
          </div>
        </div>
      )}

      {cuts.map(([lane, s]) => {
        const name = lane === 'bg' ? BG_NAME : catById(st, s.cat).short;
        const real = realEnd(st[lane], s, t);
        return (
          <div class="banner" key={s.id}>
            <Icon name="clock" />
            <div>
              <b class="pv">Revisa: {name} se recortó a {fmtDur(s.end - s.start)}</b>
              <span class="pv">Empezó a las {fmtTime(s.start)} y pasó su máximo por sesión sin que la pararas, así que PP la cerró a las {fmtTime(s.end)}.</span>
              <div class="banner-actions">
                <button onClick={() => resolveCut(lane, s.id, 'keep')}>Dejar {fmtDur(s.end - s.start)}</button>
                {real > s.end + 60000 && <button class="pv" onClick={() => resolveCut(lane, s.id, 'real')}>Era real: hasta las {fmtTime(real)}</button>}
                {lane === 'sessions' && <button class="quiet" onClick={() => { resolveCut(lane, s.id, 'keep'); openProtectedSheet({ type: 'edit', id: s.id }, 'Editar sesión'); }}>Elegir hora de fin</button>}
              </div>
            </div>
          </div>
        );
      })}

      <section class="cards">
        {liveCats(st).map((c) => {
          const on = act?.cat === c.id;
          return (
            <button key={c.id} class={`card ${on ? 'on' : ''}`} style={{ '--c': `var(--p${c.color})` }}
              onClick={() => toggleCat(c.id)} aria-pressed={on} aria-label={`${on ? 'Finalizar' : 'Iniciar'} ${c.name}`}>
              <span class="card-glow" />
              <span class="card-top">
                <span class="ico"><Icon name={c.icon} size={20} /></span>
                <span class="pill"><Icon name={on ? 'stop' : 'play'} size={14} /></span>
              </span>
              <span class="name">{c.name}</span>
              <span class="big">{on ? fmtClock(t - act.start) : fmtDur(today[c.id] || 0)}</span>
              <span class="sub">{on ? `desde las ${fmtTime(act.start)}` : 'hoy'}</span>
            </button>
          );
        })}
      </section>

      {bgAct ? (
        <button class="bg-lane on" onClick={toggleBg} aria-label={`Parar ${BG_NAME}`}>
          <i class="bg-dot" />
          <span class="bg-name">IA trabajando en 2º plano<small>desde las <span class="pv">{fmtTime(bgAct.start)}</span> · no cuenta en topes</small></span>
          <b class="pv">{fmtClock(t - bgAct.start)}</b>
          <span class="pill"><Icon name="stop" size={13} /></span>
        </button>
      ) : (
        <button class="bg-lane" onClick={toggleBg} aria-label={`Iniciar ${BG_NAME}`}>
          <i class="bg-dot" />
          <span class="bg-name">{BG_NAME}<small>Mientras la IA trabaja y tú haces otra cosa · no cuenta en topes</small></span>
          <span class="pill"><Icon name="play" size={13} /></span>
        </button>
      )}

      <button class="btn ghost" onClick={() => openProtectedSheet({ type: 'reset' }, 'Reiniciar tiempo')}><Icon name="reset" size={18} /> Reiniciar tiempo</button>

      <h3 class="sec">Topes de la semana</h3>
      <section class="screen-caps">
        {st.groups.map((g) => {
          const members = g.cats.map((id) => catById(st, id)).filter((c) => !c.archived || week[c.id]);
          return (
            <div class="panel" key={g.id}>
              <CapBar group={g} cats={members} perCat={week} used={sum(week, g.cats)} warnPct={st.warnPct} />
              <div class="capsubs">
                {members.map((c) => (c.cap != null
                  ? <CapBar compact key={c.id} group={{ name: c.short, hours: c.cap }} cats={[c]} perCat={week} used={week[c.id] || 0} warnPct={st.warnPct} />
                  : <div class="caprow" key={c.id}><i class="dot" style={{ background: `var(--p${c.color})` }} /><span>{c.short}</span><b>{fmtDur(week[c.id] || 0)}</b></div>))}
              </div>
            </div>
          );
        })}
        {topLevelCaps(st).filter((cap) => !cap.shared).map((cap) => {
          const c = catById(st, cap.cats[0]);
          if (c.archived && !week[c.id]) return null;
          return (
            <div class="panel" key={cap.key}>
              <CapBar group={{ name: c.name, hours: cap.hours }} cats={[c]} perCat={week} used={week[c.id] || 0} warnPct={st.warnPct} />
            </div>
          );
        })}
      </section>

      <h3 class="sec">Totales</h3>
      <section class="grid2">
        {[['Hoy', today], ['Semana', week]].map(([label, totals]) => (
          <div class="panel" key={label}>
            <div class="panel-title">{label}</div>
            {catsWithData(st, totals).map((c) => (
              <div class="row-stat" key={c.id}><i class="dot" style={{ background: `var(--p${c.color})` }} /><span>{c.short}</span><b>{fmtDur(totals[c.id] || 0)}</b></div>
            ))}
            <div class="row-stat total"><span>Total</span><b>{fmtDur(Object.values(totals).reduce((x, y) => x + y, 0))}</b></div>
            {(label === 'Hoy' ? bgToday : bgWeek) > 0 && (
              <div class="row-stat aside"><i class="dot bg" /><span>IA en 2º plano</span><b>{fmtDur(label === 'Hoy' ? bgToday : bgWeek)}</b></div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
