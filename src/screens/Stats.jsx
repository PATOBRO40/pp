import { useState } from 'preact/hooks';
import { Icon } from '../components/Icon.jsx';
import { DAY, HOUR, fmtDM, fmtDayLong, fmtDur, fmtTime, rangeTotals, startOfDay, startOfWeek } from '../time.js';
import { useNow, useStore } from '../store.js';
import { dayStats, sum, weekStats } from '../stats.js';

const LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function Stacked({ cats, totals }) {
  const total = sum(totals, cats.map((c) => c.id));
  return (
    <div class="stackbar">
      {cats.map((c) => (totals[c.id] ? <span key={c.id} style={{ flex: totals[c.id], background: `var(--p${c.color})` }} /> : null))}
      {!total && <span style={{ flex: 1, background: 'var(--line)' }} />}
    </div>
  );
}

function Breakdown({ cats, totals }) {
  const total = sum(totals, cats.map((c) => c.id));
  return (
    <div class="panel">
      {cats.map((c) => {
        const v = totals[c.id] || 0;
        const pct = total ? Math.round((v / total) * 100) : 0;
        return (
          <div class="brk" key={c.id} style={{ '--c': `var(--p${c.color})` }}>
            <div class="brk-top"><i class="dot" /><span>{c.name}</span><b>{fmtDur(v)}</b><em>{pct}%</em></div>
            <div class="brk-track"><div style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({ off, setOff }) {
  const st = useStore();
  const t = useNow();
  const ds = startOfDay(t) + off * DAY;
  const d = dayStats(st.sessions, ds, t);
  const ids = st.cats.map((c) => c.id);
  const maxH = Math.max(HOUR / 2, ...d.hourly.map((h) => sum(h, ids)));
  return (
    <>
      <div class="weeknav">
        <button class="round sm" onClick={() => setOff(off - 1)} aria-label="Día anterior"><Icon name="left" size={18} /></button>
        <div class="weeknav-mid"><b>{off === 0 ? 'Hoy' : fmtDayLong(ds)}</b><span>{off === 0 ? fmtDayLong(ds) : ''}</span></div>
        <button class="round sm" disabled={off >= 0} onClick={() => setOff(off + 1)} aria-label="Día siguiente"><Icon name="right" size={18} /></button>
      </div>

      <section class="hero">
        <div class="hero-num">{fmtDur(d.total)}</div>
        <div class="hero-sub">registrado en el día</div>
        <Stacked cats={st.cats} totals={d.totals} />
      </section>

      <div class="kpis">
        <div class="kpi"><b>{d.count}</b><span>sesiones</span></div>
        <div class="kpi"><b>{fmtDur(d.longest)}</b><span>más larga</span></div>
        <div class="kpi"><b>{fmtDur(d.avg)}</b><span>promedio</span></div>
        <div class="kpi"><b>{d.first ? fmtTime(d.first) : '—'}</b><span>primera</span></div>
      </div>

      <h3 class="sec">Por categoría</h3>
      <Breakdown cats={st.cats} totals={d.totals} />

      <h3 class="sec">Distribución por hora</h3>
      <section class="panel">
        <div class="hours">
          {d.hourly.map((h, i) => {
            const tot = sum(h, ids);
            return (
              <div class="hcol" key={i}>
                <div class="hstack" style={{ height: `${(tot / maxH) * 100}%` }}>
                  {st.cats.map((c) => (h[c.id] ? <span key={c.id} style={{ flex: h[c.id], background: `var(--p${c.color})` }} /> : null))}
                </div>
              </div>
            );
          })}
        </div>
        <div class="haxis"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
      </section>
    </>
  );
}

function WeekView({ off, setOff }) {
  const st = useStore();
  const t = useNow();
  const ws = startOfWeek(t) + off * 7 * DAY;
  const w = weekStats(st.sessions, ws, t);
  const prev = weekStats(st.sessions, ws - 7 * DAY, t);
  const ids = st.cats.map((c) => c.id);
  const maxD = Math.max(HOUR, ...w.days.map((x) => x.total));
  const delta = prev.total ? Math.round(((w.total - prev.total) / prev.total) * 100) : null;

  // Tendencia: últimas 8 semanas por grupo
  const trend = Array.from({ length: 8 }, (_, i) => {
    const s = startOfWeek(t) + (off - 7 + i) * 7 * DAY;
    return { s, totals: rangeTotals(st.sessions, s, s + 7 * DAY, t) };
  });

  return (
    <>
      <div class="weeknav">
        <button class="round sm" onClick={() => setOff(off - 1)} aria-label="Semana anterior"><Icon name="left" size={18} /></button>
        <div class="weeknav-mid"><b>{off === 0 ? 'Esta semana' : `${fmtDM(ws)} – ${fmtDM(ws + 6 * DAY)}`}</b><span>{off === 0 ? `${fmtDM(ws)} – ${fmtDM(ws + 6 * DAY)}` : ''}</span></div>
        <button class="round sm" disabled={off >= 0} onClick={() => setOff(off + 1)} aria-label="Semana siguiente"><Icon name="right" size={18} /></button>
      </div>

      <section class="hero">
        <div class="hero-num">{fmtDur(w.total)}</div>
        <div class="hero-sub">
          registrado en la semana
          {delta != null && <em class={`delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs. semana anterior</em>}
        </div>
        <Stacked cats={st.cats} totals={w.totals} />
      </section>

      <section class="panel">
        <div class="wbars">
          {w.days.map((d, i) => {
            const isToday = d.dayStart === startOfDay(t);
            return (
              <div class={`wcol ${isToday ? 'today' : ''}`} key={i}>
                <span class="wval">{d.total ? (d.total / HOUR).toFixed(1) : ''}</span>
                <div class="wtrack">
                  <div class="wstack" style={{ height: `${(d.total / maxD) * 100}%` }}>
                    {st.cats.map((c) => (d.totals[c.id] ? <span key={c.id} style={{ flex: d.totals[c.id], background: `var(--p${c.color})` }} /> : null))}
                  </div>
                </div>
                <span class="wlet">{LETTERS[i]}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div class="kpis">
        <div class="kpi"><b>{w.count}</b><span>sesiones</span></div>
        <div class="kpi"><b>{w.activeDays}/7</b><span>días activos</span></div>
        <div class="kpi"><b>{fmtDur(w.avgActive)}</b><span>prom. por día</span></div>
        <div class="kpi"><b>{w.best ? LETTERS[w.days.indexOf(w.best)] : '—'}</b><span>mejor día</span></div>
      </div>

      <h3 class="sec">Por categoría</h3>
      <Breakdown cats={st.cats} totals={w.totals} />

      <h3 class="sec">Tendencia · 8 semanas</h3>
      {st.groups.map((g) => {
        const gc = st.cats.filter((c) => c.group === g.id).map((c) => c.id);
        const cap = g.hours * HOUR;
        const max = Math.max(cap * 1.15, ...trend.map((x) => sum(x.totals, gc)));
        return (
          <section class="panel trend" key={g.id}>
            <div class="panel-title">{g.name} <span>tope {g.hours} h</span></div>
            <div class="tbars">
              <i class="tcap" style={{ bottom: `${(cap / max) * 100}%` }} />
              {trend.map((x, i) => {
                const v = sum(x.totals, gc);
                const cls = v > cap ? 'over' : v >= cap * (st.warnPct / 100) ? 'warn' : 'ok';
                return <div class="tcol" key={i}><div class={`tbar ${cls} ${i === 7 ? 'cur' : ''}`} style={{ height: `${(v / max) * 100}%` }} /></div>;
              })}
            </div>
            <div class="taxis">{trend.map((x, i) => <span key={i}>{fmtDM(x.s).replace(/ .*/, '')}</span>)}</div>
          </section>
        );
      })}
    </>
  );
}

export function Stats() {
  const [mode, setMode] = useState('week');
  const [dOff, setDOff] = useState(0);
  const [wOff, setWOff] = useState(0);
  return (
    <div class="screen">
      <header class="top"><div><div class="eyebrow">Estadísticas</div><h1>{mode === 'day' ? 'Diarias' : 'Semanales'}</h1></div></header>
      <div class="seg wide">
        <button class={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>Día</button>
        <button class={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>Semana</button>
      </div>
      {mode === 'day' ? <DayView off={dOff} setOff={setDOff} /> : <WeekView off={wOff} setOff={setWOff} />}
    </div>
  );
}
