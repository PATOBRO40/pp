import { useState } from 'preact/hooks';
import { Icon } from '../components/Icon.jsx';
import { CapBar } from '../components/CapBar.jsx';
import { DAY, fmtDM, fmtDayShort, fmtDur, fmtTime, rangeTotals, splitByDay, startOfWeek } from '../time.js';
import { set, useNow, useStore } from '../store.js';
import { sum } from '../stats.js';

export function Log() {
  const st = useStore();
  const t = useNow();
  const [off, setOff] = useState(0);
  const ws = startOfWeek(t) + off * 7 * DAY;
  const we = ws + 7 * DAY;
  const week = rangeTotals(st.sessions, ws, we, t);
  const catIds = st.cats.map((c) => c.id);

  // Tramos por día (una sesión que cruza medianoche aparece en ambos días)
  const byDay = new Map();
  for (const s of st.sessions) {
    if (s.start >= we || (s.end ?? t) <= ws) continue;
    for (const g of splitByDay(s, t)) {
      if (g.dayStart < ws || g.dayStart >= we) continue;
      if (!byDay.has(g.dayStart)) byDay.set(g.dayStart, []);
      byDay.get(g.dayStart).push(g);
    }
  }
  const days = [...byDay.entries()].sort((a, b) => b[0] - a[0]);

  return (
    <div class="screen">
      <header class="top">
        <div>
          <div class="eyebrow">Registro</div>
          <h1>{off === 0 ? 'Esta semana' : `${fmtDM(ws)} – ${fmtDM(we - DAY)}`}</h1>
        </div>
        <button class="round" aria-label="Añadir sesión" onClick={() => set({ sheet: { type: 'edit', id: null } })}><Icon name="plus" /></button>
      </header>

      <div class="weeknav">
        <button class="round sm" aria-label="Semana anterior" onClick={() => setOff(off - 1)}><Icon name="left" size={18} /></button>
        <div class="weeknav-mid">
          <b>{fmtDM(ws)} – {fmtDM(we - DAY)}</b>
          <span>Total {fmtDur(sum(week, catIds))}</span>
        </div>
        <button class="round sm" aria-label="Semana siguiente" disabled={off >= 0} onClick={() => setOff(off + 1)}><Icon name="right" size={18} /></button>
      </div>

      <section class="panel stack">
        {st.groups.map((g) => {
          const cats = st.cats.filter((c) => c.group === g.id);
          return <CapBar compact key={g.id} group={g} cats={cats} perCat={week} used={sum(week, cats.map((c) => c.id))} warnPct={st.warnPct} />;
        })}
      </section>

      {days.length === 0 && <div class="empty"><Icon name="list" size={30} /><p>Sin sesiones esta semana.</p></div>}

      {days.map(([dayStart, segs]) => {
        const tot = segs.reduce((a, g) => a + (g.end - g.start), 0);
        const sorted = [...segs].sort((a, b) => b.start - a.start);
        return (
          <section class="day" key={dayStart}>
            <div class="day-head">
              <h3>{fmtDayShort(dayStart)}</h3>
              <b>{fmtDur(tot)}</b>
            </div>
            <div class="day-bar">
              {st.cats.map((c) => {
                const v = segs.filter((g) => g.cat === c.id).reduce((a, g) => a + (g.end - g.start), 0);
                return v ? <span key={c.id} style={{ flex: v, background: `var(--p${c.color})` }} /> : null;
              })}
            </div>
            <div class="panel list">
              {sorted.map((g) => {
                const c = st.cats.find((x) => x.id === g.cat);
                const running = g.s.end == null;
                const contFrom = g.s.start < g.dayStart;
                const contTo = (g.s.end ?? t) > g.dayStart + DAY;
                return (
                  <button class="srow" key={g.s.id + g.dayStart} style={{ '--c': `var(--p${c.color})` }}
                    onClick={() => set({ sheet: { type: 'edit', id: g.s.id } })}>
                    <i class="bar" />
                    <span class="srow-main">
                      <span class="srow-name">{c.name}{running && <em class="live">en curso</em>}</span>
                      <span class="srow-time">
                        {contFrom ? '↤ 00:00' : fmtTime(g.start)} – {contTo ? '24:00 ↦' : running ? 'ahora' : fmtTime(g.end)}
                        {g.s.note ? ` · ${g.s.note}` : ''}
                      </span>
                    </span>
                    <b class="srow-dur">{fmtDur(g.end - g.start)}</b>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
