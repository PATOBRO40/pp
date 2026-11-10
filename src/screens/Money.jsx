// Pestaña Dinero: resumen del mes, movimientos, ahorro, pendientes por revisar y configuración.
import { useRef } from 'preact/hooks';
import { Icon } from '../components/Icon.jsx';
import { AuthGate, HIDE, PrivacyButton, requestSettingsAuth, settingsNeedAuth } from '../components/Privacy.jsx';
import { set, setFin, toast, useStore } from '../store.js';
import { acctName, finCat, fmtMoney, fmtSigned, TYPES } from '../fin/model.js';
import { classified } from '../fin/classify.js';
import { SAV_ACCOUNTS, currentPeriod, latestPeriod, periodLabel, periodOf, periodStats, reviewList, savingsAt, savingsPeriods, savingsRow, savingsStats, shiftPeriod, trendBars, yieldsAt } from '../fin/stats.js';
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
            <div class="brk-top"><i class="dot" /><span>{c.name}</span><b>{fmtMoney(v, HIDE())}</b><em>{pct}%</em></div>
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
          <div><b>{fmtMoney(spent, HIDE())}</b><span>gastado</span></div>
          <div><b>{fmtMoney(income, HIDE())}</b><span>ingresos</span></div>
          <div><b>{fmtMoney(spent / bars.length, HIDE())}</b><span>gasto prom. por {unit}</span></div>
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
        <div class="hero-num money">{fmtMoney(s.spent, HIDE())}</div>
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
        <div class="kpi"><b>{fmtMoney(s.income, HIDE())}</b><span>ingresos</span></div>
        <div class="kpi"><b>{fmtMoney(s.yield, HIDE())}</b><span>rendimientos</span></div>
        <div class="kpi"><b class={s.balance >= 0 ? 'pos' : 'neg'}>{fmtSigned(s.balance, HIDE())}</b><span>balance</span></div>
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
            {s.top.map(([p, v]) => <div class="row-stat" key={p}><span class="ellip pn">{titleCase(p)}</span><b>{fmtMoney(v, HIDE())}</b></div>)}
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
      <span class={`mov-amt ${m.amount > 0 ? 'pos' : ''}`}>{fmtSigned(m.amount, HIDE())}</span>
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

const RANGES = [[3, '3 meses'], [6, '6 meses'], [12, '12 meses'], [0, 'Todo']];
const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 1000) / 10).toLocaleString('es-CO')}%`;
const short = (k) => periodLabel(k, 1).slice(0, 3);

function Savings({ f, k, setK }) {
  const st = useStore();
  const periods = savingsPeriods(f);
  if (!periods.length) return <div class="empty"><Icon name="wallet" size={30} /><span>Importa un extracto para ver tus saldos.</span></div>;
  // Mes que se muestra: el elegido, o el último con extracto si el elegido es anterior a todos
  const sk = k < periods[0] ? periods.at(-1) : k;
  const at = savingsAt(f, sk);
  const prev = savingsAt(f, shiftPeriod(sk, -1));
  const focus = st.finAcct || null;
  const range = st.finSavRange ?? 6;
  const upto = periods.filter((p) => p <= sk);
  const keys = range === 0 ? upto : upto.slice(-range);
  const stats = savingsStats(f, keys);
  const series = keys.map((key) => ({ key, at: savingsAt(f, key) }));
  const val = (a, id) => a.rows.find((r) => r.id === id)?.value ?? 0;
  const max = Math.max(1, ...series.map((x) => (focus ? val(x.at, focus) : x.at.total)));
  const y = yieldsAt(f, sk);
  const row = savingsRow(f, sk);
  const hide = HIDE();
  const accts = SAV_ACCOUNTS.filter((a) => series.some((x) => x.at.rows.some((r) => r.id === a.id)));

  return (
    <>
      <PeriodNav k={sk} setK={setK} f={f} />
      <section class="hero">
        <div class="hero-num money">{fmtMoney(at.total, hide)}</div>
        <div class="hero-sub">
          en tus cuentas al cierre
          {row.growth != null && <em class={`delta ${row.growth >= 0 ? 'up' : 'down'}`}>{row.growth >= 0 ? '▲' : '▼'} {fmtMoney(Math.abs(row.growth), hide)} vs. mes anterior</em>}
        </div>
      </section>

      <div class="kpis three">
        <div class="kpi"><b>{fmtMoney(at.saved, hide)}</b><span>ahorrado (cajitas y CDT)</span></div>
        <div class="kpi"><b>{fmtMoney(y.total, hide)}</b><span>rendimientos del mes</span></div>
        <div class="kpi"><b>{row.rate != null ? `${Math.round(row.rate * 100)}%` : '—'}</b><span>tasa de ahorro</span></div>
      </div>

      <h3 class="sec">Por cuenta</h3>
      <section class="panel list">
        {at.rows.map((r) => {
          const p = prev.rows.find((x) => x.id === r.id);
          const d = p ? r.value - p.value : null;
          return (
            <button class={`acct ${focus === r.id ? 'on' : ''}`} key={r.id} style={{ '--c': `var(--p${r.color})` }}
              onClick={() => set({ finAcct: focus === r.id ? null : r.id })}>
              <i class="dot" />
              <span class="acct-main"><b>{r.name}</b><small>{r.stale ? `sin extracto de este mes · último al ${fmtDate(r.at)}` : `al ${fmtDate(r.at)}`}</small></span>
              <span class="acct-val"><b>{fmtMoney(r.value, hide)}</b>{d != null && d !== 0 && <small class={d > 0 ? 'pos' : 'neg'}>{fmtSigned(d, hide)}</small>}</span>
            </button>
          );
        })}
        <div class="row-stat total"><span>Total</span><b>{fmtMoney(at.total, hide)}</b></div>
      </section>
      <p class="fine">Toca una cuenta para ver solo su evolución.</p>

      <div class="sec-row">
        <h3 class="sec">Evolución</h3>
        <div class="seg small">{RANGES.map(([v, l]) => <button key={v} class={range === v ? 'on' : ''} onClick={() => set({ finSavRange: v })}>{l}</button>)}</div>
      </div>
      <section class="panel trend">
        <div class="panel-title">{focus ? SAV_ACCOUNTS.find((a) => a.id === focus).name : 'Saldo total por cuenta'}
          {focus && <button class="link sm" onClick={() => set({ finAcct: null })}>ver todas</button>}
        </div>
        <div class="tbars">
          {series.map((x) => (
            <button class="tcol btn-reset" key={x.key} onClick={() => setK(x.key)} aria-label={periodLabel(x.key, 1)}>
              <div class={`sstack ${x.key === sk ? 'cur' : ''}`} style={{ height: `${((focus ? val(x.at, focus) : x.at.total) / max) * 100}%` }}>
                {(focus ? accts.filter((a) => a.id === focus) : accts).map((a) => (val(x.at, a.id) > 0
                  ? <span key={a.id} style={{ flex: val(x.at, a.id), background: `var(--p${a.color})` }} /> : null))}
              </div>
            </button>
          ))}
        </div>
        <div class="taxis">{series.map((x) => <span key={x.key}>{short(x.key)}</span>)}</div>
        {!focus && <div class="legend">{accts.map((a) => <span key={a.id} style={{ '--c': `var(--p${a.color})` }}><i class="dot" />{a.name}</span>)}</div>}
      </section>

      <h3 class="sec">Estadísticas · {range === 0 ? 'todo el historial' : `${keys.length} ${keys.length === 1 ? 'mes' : 'meses'}`}</h3>
      <section class="panel tight">
        <div class="row-stat"><span>Crecimiento del saldo</span><b class={stats.growth >= 0 ? 'pos' : 'neg'}>{stats.growth != null ? `${fmtSigned(stats.growth, hide)}${stats.growthPct != null ? ` (${pct(stats.growthPct)})` : ''}` : '—'}</b></div>
        <div class="row-stat sub"><span>De tus ingresos menos gastos</span><b>{fmtSigned(stats.own, hide)}</b></div>
        <div class="row-stat sub"><span>De rendimientos</span><b>{fmtSigned(stats.yield, hide)}</b></div>
        <div class="row-stat"><span>Ahorro promedio por mes</span><b>{fmtSigned(stats.avgOwn, hide)}</b></div>
        <div class="row-stat"><span>Tasa de ahorro promedio</span><b>{stats.avgRate != null ? `${Math.round(stats.avgRate * 100)}%` : '—'}</b></div>
        {stats.best && keys.length > 1 && <div class="row-stat"><span>Mejor mes</span><b>{periodLabel(stats.best.key, 1)} · {fmtSigned(stats.best.growth, hide)}</b></div>}
        {stats.worst && keys.length > 1 && stats.worst.key !== stats.best?.key && <div class="row-stat"><span>Mes más flojo</span><b>{periodLabel(stats.worst.key, 1)} · {fmtSigned(stats.worst.growth, hide)}</b></div>}
      </section>

      {stats.covered < keys.length && <p class="fine">El crecimiento y su desglose empiezan en {periodLabel(keys[1] || keys[0], 1)}: del primer mes no hay saldo anterior con qué comparar.</p>}
      {stats.yieldBy.length > 0 && (
        <>
          <h3 class="sec">Rendimientos por bolsillo</h3>
          <section class="panel tight">
            {stats.yieldBy.map(([n, v]) => <div class="row-stat" key={n}><span>{n}</span><b>{fmtMoney(v, hide)}</b></div>)}
            <div class="row-stat total"><span>Total</span><b>{fmtMoney(stats.yield, hide)}</b></div>
          </section>
          <p class="fine">El CDT se mide por el crecimiento de su saldo mes a mes: el extracto muestra un rendimiento acumulado.</p>
        </>
      )}

      <h3 class="sec">Historial de extractos</h3>
      <section class="panel list">
        <div class="hist head"><span>Mes</span><span>Saldo</span><span>Cambio</span><span>Tasa</span></div>
        {[...periods].reverse().map((key) => {
          const r = savingsRow(f, key);
          return (
            <button class={`hist ${key === sk ? 'on' : ''}`} key={key} onClick={() => setK(key)}>
              <span>{periodLabel(key, 1)}{r.stale ? ' *' : ''}</span>
              <span>{fmtMoney(r.total || 0, hide)}</span>
              <span class={r.growth > 0 ? 'pos' : r.growth < 0 ? 'neg' : ''}>{r.growth != null ? fmtSigned(r.growth, hide) : '—'}</span>
              <span>{r.rate != null ? `${Math.round(r.rate * 100)}%` : '—'}</span>
            </button>
          );
        })}
      </section>
      {periods.some((p) => savingsRow(f, p).stale) && <p class="fine">* Falta el extracto de algún banco ese mes: se usa su último saldo conocido.</p>}
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
              <span class={`mov-amt ${m.amount > 0 ? 'pos' : ''}`}>{fmtSigned(m.amount, HIDE())}</span>
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
  const setView = (v) => {
    set({ finView: v, finCfgAuth: false });
    if (v === 'config') requestSettingsAuth('finCfgAuth');
    window.scrollTo(0, 0);
  };
  const setK = (x) => set({ finKey: x });
  if (st.lock?.v !== 2) return <Gate />;
  if (view === 'config') {
    if (settingsNeedAuth(st) && !st.finCfgAuth) return <AuthGate flag="finCfgAuth" title="Configurar Dinero" />;
    return <FinConfig back={() => setView('resumen')} />;
  }

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
          <PrivacyButton small />
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
      {view === 'ahorro' && <Savings f={f} k={k} setK={setK} />}
      {view === 'revisar' && <Review f={f} />}
    </div>
  );
}
