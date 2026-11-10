// Pestaña Dinero: resumen del mes, movimientos, ahorro, pendientes por revisar y configuración.
import { useRef } from 'preact/hooks';
import { Icon } from '../components/Icon.jsx';
import { set, setFin, toast, useStore } from '../store.js';
import { acctName, finCat, fmtMoney, fmtSigned, TYPES } from '../fin/model.js';
import { classified } from '../fin/classify.js';
import { currentPeriod, latestPeriod, periodLabel, periodOf, periodStats, reviewList, savings, savingsHistory, shiftPeriod, trendBars } from '../fin/stats.js';
import { readStatements } from '../fin/flow.js';
import { applyCorrection } from '../fin/actions.js';
import { FinConfig } from './FinConfig.jsx';


// Palabras TODO EN MAYÚSCULAS → inicial mayúscula ("Para JUAN PEREZ" → "Para Juan Perez").
const titleCase = (s) => s.replace(/[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9._*/-]+/g, (w) => w[0] + w.slice(1).toLowerCase());
export const prettyDesc = (m) => titleCase(m.desc);
const fmtDate = (d) => {
  const [y, mo, da] = d.split('-').map(Number);
  return new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, mo - 1, da));
};

function Gate() {
  return (
    <div class="screen">
      <header class="top"><div><div class="eyebrow">Dinero</div><h1>Tus finanzas</h1></div></header>
      <section class="panel stack">
        <div class="gate-ico"><Icon name="wallet" size={30} /></div>
        <p>Dinero guarda información financiera, así que <b>solo funciona con el bloqueo activado</b>: tus movimientos quedan cifrados en el teléfono y nunca salen de él.</p>
        <button class="btn primary" onClick={() => set({ sheet: { type: 'lock', mode: 'create' } })}>Activar bloqueo</button>
      </section>
    </div>
  );
}

function PeriodNav({ k, setK, f }) {
  const cur = currentPeriod(f);
  return (
    <div class="weeknav">
      <button class="round sm" onClick={() => setK(shiftPeriod(k, -1))} aria-label="Mes anterior"><Icon name="left" size={18} /></button>
      <div class="weeknav-mid"><b>{periodLabel(k, f.monthStart)}</b><span>{k === cur ? 'mes en curso' : ''}</span></div>
      <button class="round sm" disabled={k >= cur} onClick={() => setK(shiftPeriod(k, 1))} aria-label="Mes siguiente"><Icon name="right" size={18} /></button>
    </div>
  );
}

function CatBars({ f, s, onPick }) {
  const rows = f.cats.map((c) => ({ c, v: s.byCat[c.id] || 0 })).filter((x) => x.v !== 0).sort((a, b) => b.v - a.v);
  if (!rows.length) return <p class="fine first">Sin gastos en este periodo.</p>;
  return (
    <div class="panel">
      {rows.map(({ c, v }) => {
        const pct = s.spent > 0 ? Math.round((v / s.spent) * 100) : 0;
        return (
          <button class="brk btn-reset" key={c.id} style={{ '--c': `var(--p${c.color})` }} onClick={() => onPick(c.id)}>
            <div class="brk-top"><i class="dot" /><span>{c.name}</span><b>{fmtMoney(v, f.hide)}</b><em>{pct}%</em></div>
            <div class="brk-track"><div style={{ width: `${Math.max(0, pct)}%` }} /></div>
          </button>
        );
      })}
    </div>
  );
}

const TRENDS = [[1, '1 mes'], [3, '3 meses'], [6, '6 meses']];

/** Tendencia de gastos e ingresos: 1 mes (por semana), 3 o 6 meses (por mes). */
function Trend({ f, k, n, setN }) {
  const bars = trendBars(f, k, n);
  const max = Math.max(1, ...bars.map((x) => Math.max(x.spent, x.income)));
  const spent = bars.reduce((a, x) => a + Math.max(0, x.spent), 0);
  const income = bars.reduce((a, x) => a + x.income, 0);
  const unit = n === 1 ? 'semana' : 'mes';
  return (
    <>
      <div class="sec-row">
        <h3 class="sec">Tendencia</h3>
        <div class="seg small">{TRENDS.map(([v, l]) => <button key={v} class={n === v ? 'on' : ''} onClick={() => setN(v)}>{l}</button>)}</div>
      </div>
      <section class="panel trend">
        <div class="panel-title">{n === 1 ? 'Por semana' : 'Por mes'} <span><i class="dot" style={{ '--c': 'var(--over)' }} /> gasto <i class="dot" style={{ '--c': 'var(--ok)' }} /> ingreso</span></div>
        <div class="tbars">
          {bars.map((x, i) => (
            <div class="tcol pair" key={x.id}>
              <div class={`tbar over ${n > 1 && i === bars.length - 1 ? 'cur' : ''}`} style={{ height: `${(Math.max(0, x.spent) / max) * 100}%` }} />
              <div class="tbar" style={{ height: `${(x.income / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div class="taxis">{bars.map((x) => <span key={x.id}>{x.label}</span>)}</div>
        <div class="trend-sum">
          <div><b>{fmtMoney(spent, f.hide)}</b><span>gastado</span></div>
          <div><b>{fmtMoney(income, f.hide)}</b><span>ingresos</span></div>
          <div><b>{fmtMoney(spent / bars.length, f.hide)}</b><span>gasto prom. por {unit}</span></div>
        </div>
      </section>
    </>
  );
}

function Summary({ f, k, setK, go, n, setN }) {
  const s = periodStats(f, k);
  const prev = periodStats(f, shiftPeriod(k, -1));
  const delta = prev.spent > 0 ? Math.round(((s.spent - prev.spent) / prev.spent) * 100) : null;
  return (
    <>
      <PeriodNav k={k} setK={setK} f={f} />
      <section class="hero">
        <div class="hero-num money">{fmtMoney(s.spent, f.hide)}</div>
        <div class="hero-sub">
          gastado en {periodLabel(k, f.monthStart)}
          {delta != null && <em class={`delta ${delta <= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs. mes anterior</em>}
        </div>
        <div class="stackbar">
          {f.cats.map((c) => (s.byCat[c.id] > 0 ? <span key={c.id} style={{ flex: s.byCat[c.id], background: `var(--p${c.color})` }} /> : null))}
          {!(s.spent > 0) && <span style={{ flex: 1, background: 'var(--line)' }} />}
        </div>
      </section>

      <div class="kpis three">
        <div class="kpi"><b>{fmtMoney(s.income, f.hide)}</b><span>ingresos</span></div>
        <div class="kpi"><b>{fmtMoney(s.yield, f.hide)}</b><span>rendimientos</span></div>
        <div class="kpi"><b class={s.balance >= 0 ? 'pos' : 'neg'}>{fmtSigned(s.balance, f.hide)}</b><span>balance</span></div>
      </div>

      {s.count > 0 && !f.incomes.length && f.recargas === 'propia' && (
        <button class="notice info" onClick={() => go('config')}>
          <Icon name="down" size={18} /><span>Tus recargas desde otro banco no cuentan como ingreso. Añade tus ingresos fijos para ver un balance real.</span><Icon name="right" size={16} />
        </button>
      )}
      {s.pending > 0 && (
        <button class="notice" onClick={() => go('revisar')}>
          <Icon name="warn" size={18} /><span>{s.pending} movimientos con clasificación dudosa. Revísalos cuando quieras.</span><Icon name="right" size={16} />
        </button>
      )}

      <h3 class="sec">Por categoría</h3>
      <CatBars f={f} s={s} onPick={(id) => { set({ finFilter: id }); go('movs'); }} />

      {s.top.length > 0 && (
        <>
          <h3 class="sec">A quién y dónde más gastas</h3>
          <section class="panel tight">
            {s.top.map(([p, v]) => <div class="row-stat" key={p}><span class="ellip">{titleCase(p)}</span><b>{fmtMoney(v, f.hide)}</b></div>)}
          </section>
        </>
      )}

      <Trend f={f} k={k} n={n} setN={setN} />

      {s.count === 0 && (
        <p class="fine center">Importa los extractos de Nequi y Nu de este mes, o registra movimientos a mano.</p>
      )}
    </>
  );
}

export function MovRow({ f, m, c }) {
  const cat = c.type === 'gasto' ? finCat(f, c.cat) : null;
  const color = cat ? `var(--p${cat.color})` : c.type === 'ingreso' || c.type === 'rendimiento' ? 'var(--ok)' : 'var(--text3)';
  const icon = cat ? cat.icon : c.type === 'propia' ? 'swap' : c.type === 'anulado' ? 'reset' : 'down';
  const label = cat ? cat.name : TYPES[c.type];
  const dim = c.type === 'propia' || c.type === 'anulado';
  return (
    <button class={`mov ${dim ? 'dim' : ''}`} style={{ '--c': color }} onClick={() => set({ sheet: { type: 'mov', id: m.id } })}>
      <span class="ico"><Icon name={icon} size={18} /></span>
      <span class="mov-main">
        <b>{prettyDesc(m)}</b>
        <small>{label} · {acctName(m.acct)}{!c.manual && c.conf !== 'alta' ? <em class={`conf ${c.conf}`}> · revisar</em> : ''}</small>
      </span>
      <span class={`mov-amt ${m.amount > 0 ? 'pos' : ''}`}>{fmtSigned(m.amount, f.hide)}</span>
    </button>
  );
}

function Movements({ f, k, setK, filter }) {
  const cls = classified(f);
  const pick = (x) => set({ finFilter: x });
  const list = f.movs.filter((m) => periodOf(m.date, f.monthStart) === k).filter((m) => {
    const c = cls.get(m.id);
    if (filter === 'all') return c.type !== 'propia';
    if (filter === 'propia') return c.type === 'propia';
    if (filter === 'ingreso') return c.type === 'ingreso' || c.type === 'rendimiento';
    return c.type === 'gasto' && c.cat === filter;
  }).sort((a, b) => b.date.localeCompare(a.date));
  const days = [];
  for (const m of list) {
    if (days.at(-1)?.date !== m.date) days.push({ date: m.date, items: [] });
    days.at(-1).items.push(m);
  }
  const chips = [['all', 'Todos'], ['ingreso', 'Ingresos'], ...f.cats.map((c) => [c.id, c.name, c.color]), ['propia', 'Entre tus cuentas']];
  return (
    <>
      <PeriodNav k={k} setK={setK} f={f} />
      <div class="chips">
        {chips.map(([id, l, color]) => (
          <button key={id} class={filter === id ? 'on' : ''} style={color ? { '--c': `var(--p${color})` } : null} onClick={() => pick(id)}>
            {color && <i class="dot" />}{l}
          </button>
        ))}
      </div>
      {!days.length && <div class="empty"><Icon name="list" size={30} /><span>Nada por aquí.</span></div>}
      {days.map((d) => (
        <section key={d.date}>
          <h3 class="sec">{fmtDate(d.date)}</h3>
          <div class="panel list">{d.items.map((m) => <MovRow key={m.id} f={f} m={m} c={cls.get(m.id)} />)}</div>
        </section>
      ))}
    </>
  );
}

function Savings({ f, k }) {
  const sv = savings(f);
  const keys = Array.from({ length: 6 }, (_, i) => shiftPeriod(k, i - 5));
  const hist = savingsHistory(f, keys);
  const max = Math.max(1, ...hist.map((h) => h.value || 0));
  const s = periodStats(f, k);
  if (!sv.rows.length) return <div class="empty"><Icon name="wallet" size={30} /><span>Importa un extracto para ver tus saldos.</span></div>;
  return (
    <>
      <section class="hero">
        <div class="hero-num money">{fmtMoney(sv.total, f.hide)}</div>
        <div class="hero-sub">en tus cuentas según los últimos extractos</div>
      </section>
      <div class="kpis three">
        <div class="kpi"><b>{fmtMoney(sv.saved, f.hide)}</b><span>ahorrado (cajitas y CDT)</span></div>
        <div class="kpi"><b>{fmtMoney(s.yield, f.hide)}</b><span>rendimientos del mes</span></div>
        <div class="kpi"><b>{s.income > 0 ? `${Math.round((s.balance / (s.income + s.yield || 1)) * 100)}%` : '—'}</b><span>tasa de ahorro</span></div>
      </div>
      <h3 class="sec">Por cuenta</h3>
      <section class="panel tight">
        {sv.rows.map((r) => <div class="row-stat" key={r.id}><span>{r.name}<small class="muted"> · al {fmtDate(r.at)}</small></span><b>{fmtMoney(r.value || 0, f.hide)}</b></div>)}
        <div class="row-stat total"><span>Total</span><b>{fmtMoney(sv.total, f.hide)}</b></div>
      </section>
      <h3 class="sec">Saldo al cierre · 6 meses</h3>
      <section class="panel trend">
        <div class="tbars">
          {hist.map((h, i) => <div class="tcol" key={h.key}><div class={`tbar ${i === 5 ? 'cur' : ''}`} style={{ height: `${((h.value || 0) / max) * 100}%` }} /></div>)}
        </div>
        <div class="taxis">{keys.map((x) => <span key={x}>{periodLabel(x, 1).slice(0, 3)}</span>)}</div>
      </section>
      <p class="fine">El efectivo no aparece aquí: solo lo que muestran los extractos.</p>
    </>
  );
}

function Review({ f }) {
  const cls = classified(f);
  const list = reviewList(f);
  const confirm = (ids) => setFin((x) => ({
    ...x,
    movs: x.movs.map((m) => {
      if (!ids.includes(m.id)) return m;
      const c = cls.get(m.id);
      return { ...m, manual: { type: c.type, cat: c.cat } };
    }),
  }));
  // Elegir una categoría aquí crea una regla para ese nombre: cambia todos sus movimientos, de todos los meses.
  const choose = (m, cat) => {
    const c = cls.get(m.id);
    const n = applyCorrection(m.id, { type: 'gasto', cat }, true);
    if (n > 1) toast(`Aplicado a ${n} movimientos de «${c.party}»`, { kind: 'ok' });
  };
  if (!list.length) return <div class="empty"><Icon name="check" size={30} /><span>Todo clasificado.</span></div>;
  return (
    <>
      <p class="fine first">Estos movimientos se asignaron con confianza media o baja. Al elegir una categoría, se aplica a todos los movimientos de ese nombre, en todos los meses. Para cambiar solo uno, ábrelo.</p>
      <button class="btn ghost wide" style={{ marginTop: 0 }} onClick={() => { confirm(list.map((m) => m.id)); toast(`${list.length} confirmados`, { kind: 'ok' }); }}>
        <Icon name="check" size={18} /> Confirmar todas las sugerencias ({list.length})
      </button>
      {list.map((m) => {
        const c = cls.get(m.id);
        return (
          <section class="panel rev" key={m.id}>
            <div class="rev-top">
              <button class="btn-reset rev-main" onClick={() => set({ sheet: { type: 'mov', id: m.id } })}>
                <b>{prettyDesc(m)}</b><small>{fmtDate(m.date)} · {acctName(m.acct)} · {c.why}</small>
              </button>
              <span class={`mov-amt ${m.amount > 0 ? 'pos' : ''}`}>{fmtSigned(m.amount, f.hide)}</span>
            </div>
            {c.type === 'gasto' ? (
              <div class="chips small">
                {f.cats.map((cat) => (
                  <button key={cat.id} class={c.cat === cat.id ? 'on sug' : ''} style={{ '--c': `var(--p${cat.color})` }} onClick={() => choose(m, cat.id)}>
                    <i class="dot" />{cat.name}{c.cat === cat.id ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            ) : (
              <div class="chips small"><button class="on sug" onClick={() => confirm([m.id])}>{TYPES[c.type]} ✓</button></div>
            )}
          </section>
        );
      })}
    </>
  );
}

export function Money() {
  const st = useStore();
  const f = st.fin;
  const fileRef = useRef(null);
  const view = st.finView || 'resumen';
  const k = st.finKey || latestPeriod(f);
  const setView = (v) => { set({ finView: v }); window.scrollTo(0, 0); };
  const setK = (x) => set({ finKey: x });
  if (st.lock?.v !== 2) return <Gate />;
  if (view === 'config') return <FinConfig back={() => setView('resumen')} />;

  const pending = reviewList(f).length;
  const onFiles = async (e) => {
    const files = [...(e.currentTarget.files || [])];
    e.currentTarget.value = '';
    if (files.length) await readStatements(files);
  };
  const VIEWS = [['resumen', 'Resumen'], ['movs', 'Movimientos'], ['ahorro', 'Ahorro'], ['revisar', pending ? `Revisar · ${pending}` : 'Revisar']];

  return (
    <div class="screen">
      <header class="top">
        <div><div class="eyebrow">Dinero</div><h1>Tus finanzas</h1></div>
        <div class="top-actions">
          <button class="round sm" onClick={() => setFin({ hide: !f.hide })} aria-label={f.hide ? 'Mostrar montos' : 'Ocultar montos'}><Icon name={f.hide ? 'eyeoff' : 'eye'} size={19} /></button>
          <button class="round sm" onClick={() => setView('config')} aria-label="Configurar Dinero"><Icon name="gear" size={19} /></button>
        </div>
      </header>

      <div class="btn-grid">
        <button class="btn primary" onClick={() => fileRef.current.click()}><Icon name="file" size={18} /> Importar extracto</button>
        <button class="btn ghost" onClick={() => set({ sheet: { type: 'mov', id: null } })}><Icon name="plus" size={18} /> Registrar</button>
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={onFiles} />

      <div class="seg small scroll">
        {VIEWS.map(([id, l]) => <button key={id} class={view === id ? 'on' : ''} onClick={() => setView(id)}>{l}</button>)}
      </div>

      {view === 'resumen' && <Summary f={f} k={k} setK={setK} go={setView} n={st.finTrend || 6} setN={(v) => set({ finTrend: v })} />}
      {view === 'movs' && <Movements f={f} k={k} setK={setK} filter={st.finFilter || 'all'} />}
      {view === 'ahorro' && <Savings f={f} k={k} />}
      {view === 'revisar' && <Review f={f} />}
    </div>
  );
}
