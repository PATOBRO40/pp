// Hojas de Dinero: vista previa de extractos, detalle/registro de un movimiento e ingreso fijo.
import { useState } from 'preact/hooks';
import { Icon } from './Icon.jsx';
import { HIDE } from './Privacy.jsx';
import { newId, set, setFin, toast, useStore } from '../store.js';
import { ACCOUNTS, acctName, finCat, fmtMoney, fmtSigned, TYPES } from '../fin/model.js';
import { classified } from '../fin/classify.js';
import { applyCorrection, forgetParty, sameParty } from '../fin/actions.js';
import { commitStatements, preview, retryWithPassword } from '../fin/flow.js';
import { periodLabel, periodOf, todayISO } from '../fin/stats.js';
import { prettyDesc } from '../screens/Money.jsx';

const close = () => set({ sheet: null });
const BANK = { nequi: 'Nequi', nu: 'Nu' };

export function CatChips({ f, value, onPick, small }) {
  return (
    <div class={`chips ${small ? 'small' : ''}`}>
      {f.cats.map((c) => (
        <button key={c.id} type="button" class={value === c.id ? 'on' : ''} style={{ '--c': `var(--p${c.color})` }} onClick={() => onPick(c.id)}>
          <i class="dot" />{c.name}
        </button>
      ))}
    </div>
  );
}

function PasswordRow({ r, i }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form class="field" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await retryWithPassword(i, pw); setBusy(false); }}>
      <span>{r.wrong ? 'Contraseña incorrecta' : 'Este PDF tiene contraseña'}</span>
      <input type="password" placeholder="Contraseña del PDF" value={pw} onInput={(e) => setPw(e.currentTarget.value)} />
      <button class="btn ghost" disabled={!pw || busy}>Abrir</button>
    </form>
  );
}

/** Vista previa de los extractos antes de importarlos. */
export function StatementSheet({ results }) {
  const st = useStore();
  const ok = results.filter((r) => r.st);
  return (
    <div class="sheet-wrap" onClick={close}>
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <div class="grab" />
        <h2>Importar extractos</h2>
        {results.map((r, i) => {
          if (r.needsPassword) return <div class="panel" key={i}><b class="ellip">{r.name}</b><PasswordRow r={r} i={i} /></div>;
          if (r.error) return <div class="panel" key={i}><b class="ellip">{r.name}</b><p class="msg err">{r.error}</p></div>;
          const s = r.st;
          const p = preview(s);
          return (
            <div class="panel stmt" key={i}>
              <div class="stmt-top"><b>{BANK[s.bank]}</b><span>{periodLabel(periodOf(s.period.to, 1), 1)}</span></div>
              <div class="row-stat"><span>Movimientos</span><b>{s.rows.length}</b></div>
              <div class="row-stat"><span>Nuevos</span><b>{p.fresh}</b></div>
              {p.dup > 0 && <div class="row-stat"><span>Ya importados (se omiten)</span><b>{p.dup}</b></div>}
              <div class="row-stat"><span>Saldo al cierre</span><b>{fmtMoney(s.summary.closing || 0, HIDE())}</b></div>
              {s.check.ok
                ? <p class="msg ok">Cuadra con el resumen del extracto: entradas, salidas y saldo final.</p>
                : <p class="msg warn">{s.check.problems.join(' ')} Puedes importarlo igual y revisar.</p>}
            </div>
          );
        })}
        {ok.length > 0 && !st.fin.owner && ok[0].st.holder && (
          <p class="fine">Usaré el nombre del titular para reconocer tus transferencias entre cuentas. No se guardan tu cédula, dirección, correo ni números de cuenta, y el PDF no se conserva.</p>
        )}
        <div class="sheet-actions">
          <button class="btn ghost" onClick={close}>Cancelar</button>
          <button class="btn primary" disabled={!ok.length} onClick={() => commitStatements(ok.map((r) => r.st))}>Importar</button>
        </div>
      </div>
    </div>
  );
}

const typeOpts = [['gasto', 'Gasto'], ['ingreso', 'Ingreso'], ['propia', 'Entre cuentas'], ['anulado', 'No contar']];

/** Detalle de un movimiento (id) o registro manual nuevo (id null). */
export function MovSheet({ id }) {
  const st = useStore();
  const f = st.fin;
  const m = id ? f.movs.find((x) => x.id === id) : null;
  if (id && !m) return null;
  return m ? <MovDetail f={f} m={m} /> : <NewMov f={f} />;
}

function MovDetail({ f, m }) {
  const c = classified(f).get(m.id);
  const isManual = m.src === 'manual';
  const same = sameParty(f, m.id);
  const [scope, setScope] = useState(same.key ? 'all' : 'one');
  const all = scope === 'all' && !!same.key;
  const upd = (patch) => setFin((x) => ({ ...x, movs: x.movs.map((y) => (y.id === m.id ? { ...y, ...patch } : y)) }));
  const choose = (type, cat) => {
    const val = { type, cat: type === 'gasto' ? cat || c.cat || 'rest' : null };
    const n = applyCorrection(m.id, val, all);
    if (all && n > 1) toast(`Aplicado a ${n} movimientos de «${c.party}», en todos los meses`, { kind: 'ok' });
  };
  const remove = () => {
    const prev = f.movs;
    setFin((x) => ({ ...x, movs: x.movs.filter((y) => y.id !== m.id) }));
    close();
    toast('Registro eliminado', { action: { label: 'Deshacer', fn: () => setFin((x) => ({ ...x, movs: prev })) } });
  };
  const hasRule = !!(same.key && f.memo[same.key]);
  return (
    <div class="sheet-wrap" onClick={close}>
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <div class="grab" />
        <div class="mov-head">
          <h2>{prettyDesc(m)}</h2>
          <div class={`mov-big ${m.amount > 0 ? 'pos' : ''}`}>{fmtSigned(m.amount, HIDE())}</div>
          <small>{m.date} · {acctName(m.acct)}{isManual ? ' · registro manual' : ''}</small>
        </div>

        {same.key && !isManual && (
          <div class="field"><span>Aplicar cambios a</span>
            <div class="seg small">
              <button class={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Todos los de este nombre ({same.count})</button>
              <button class={scope === 'one' ? 'on' : ''} onClick={() => setScope('one')}>Solo este</button>
            </div>
          </div>
        )}

        <div class="field"><span>Qué es</span>
          <div class="seg small">
            {typeOpts.map(([t, l]) => <button key={t} class={c.type === t ? 'on' : ''} onClick={() => choose(t)}>{l}</button>)}
          </div>
        </div>
        {c.type === 'gasto' && (
          <div class="field"><span>Categoría</span><CatChips f={f} value={c.cat} onPick={(cat) => choose('gasto', cat)} /></div>
        )}
        {c.type === 'rendimiento' && <p class="fine inline">Rendimiento: cuenta como ingreso de tu ahorro.</p>}

        <p class="fine inline">
          {c.manual ? 'Corregido solo en este movimiento.' : `${c.why} (confianza ${c.conf}).`}
          {all && ' Los cambios se aplican a todos sus movimientos, también en los meses ya importados y en los siguientes.'}
        </p>

        <label class="field"><span>Nota</span>
          <input type="text" maxLength={80} value={m.note || ''} onInput={(e) => upd({ note: e.currentTarget.value })} />
        </label>

        <div class="sheet-actions">
          {m.manual && !isManual && <button class="btn ghost" onClick={() => upd({ manual: undefined })}>Quitar corrección</button>}
          {hasRule && <button class="btn ghost" onClick={() => forgetParty(same.key)}>Quitar regla</button>}
          {isManual && <button class="btn ghost danger" onClick={remove}><Icon name="trash" size={18} /> Eliminar</button>}
          <button class="btn primary" onClick={close}>Listo</button>
        </div>
      </div>
    </div>
  );
}

function NewMov({ f }) {
  const [type, setType] = useState('gasto');
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState('cmin');
  const [acct, setAcct] = useState('efectivo');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const pesos = Math.round(parseFloat(String(amount).replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.')) || 0);
  const save = () => {
    const cents = pesos * 100 * (type === 'gasto' ? -1 : 1);
    const desc = note.trim() || (type === 'gasto' ? finCat(f, cat).name : 'Ingreso');
    setFin((x) => ({
      ...x,
      movs: [...x.movs, { id: 'man:' + newId(), acct, date, desc, amount: cents, src: 'manual', manual: { type, cat: type === 'gasto' ? cat : null } }]
        .sort((a, b) => a.date.localeCompare(b.date)),
    }));
    close();
    toast('Movimiento registrado', { kind: 'ok' });
  };
  return (
    <div class="sheet-wrap" onClick={close}>
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <div class="grab" />
        <h2>Registrar movimiento</h2>
        <div class="seg">
          <button class={type === 'gasto' ? 'on' : ''} onClick={() => setType('gasto')}>Gasto</button>
          <button class={type === 'ingreso' ? 'on' : ''} onClick={() => setType('ingreso')}>Ingreso</button>
        </div>
        <label class="field"><span>Monto (pesos)</span>
          <input type="text" inputmode="numeric" placeholder="15000" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
        </label>
        {type === 'gasto' && <div class="field"><span>Categoría</span><CatChips f={f} value={cat} onPick={setCat} /></div>}
        <div class="field"><span>Cuenta</span>
          <div class="seg small">{ACCOUNTS.map((a) => <button key={a.id} class={acct === a.id ? 'on' : ''} onClick={() => setAcct(a.id)}>{a.name}</button>)}</div>
        </div>
        <label class="field"><span>Fecha</span><input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>
        <label class="field"><span>Nota (opcional)</span><input type="text" maxLength={80} value={note} onInput={(e) => setNote(e.currentTarget.value)} /></label>
        {acct !== 'efectivo' && <p class="fine inline">Cuando importes el extracto de {acctName(acct)}, este registro se sustituye por el movimiento real del mismo valor (conserva tu categoría).</p>}
        <div class="sheet-actions">
          <button class="btn ghost" onClick={close}>Cancelar</button>
          <button class="btn primary" disabled={!(pesos > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)} onClick={save}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

/** Crear o editar un ingreso fijo mensual. */
export function IncomeSheet({ id }) {
  const st = useStore();
  const f = st.fin;
  const cur = f.incomes.find((i) => i.id === id);
  const [name, setName] = useState(cur?.name || 'Sueldo');
  const [amount, setAmount] = useState(cur ? String(cur.amount / 100) : '');
  const [day, setDay] = useState(cur?.day || 1);
  const [acct, setAcct] = useState(cur?.acct || 'nequi');
  const [from, setFrom] = useState(cur?.from || periodOf(todayISO(), f.monthStart));
  const pesos = Math.round(parseFloat(String(amount).replace(/[^\d]/g, '')) || 0);
  const save = () => {
    const rec = { id: cur?.id || 'inc' + newId(), name: name.trim() || 'Ingreso fijo', amount: pesos * 100, day: Math.min(28, Math.max(1, +day || 1)), acct, from };
    setFin((x) => ({ ...x, incomes: cur ? x.incomes.map((i) => (i.id === cur.id ? rec : i)) : [...x.incomes, rec] }));
    close();
  };
  const remove = () => { setFin((x) => ({ ...x, incomes: x.incomes.filter((i) => i.id !== id) })); close(); };
  return (
    <div class="sheet-wrap" onClick={close}>
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <div class="grab" />
        <h2>{cur ? 'Ingreso fijo' : 'Nuevo ingreso fijo'}</h2>
        <p class="fine inline">Se suma cada mes a tus ingresos, sin tener que registrarlo.</p>
        <label class="field"><span>Nombre</span><input type="text" maxLength={32} value={name} onInput={(e) => setName(e.currentTarget.value)} /></label>
        <label class="field"><span>Monto mensual (pesos)</span><input type="text" inputmode="numeric" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} /></label>
        <label class="field"><span>Día del mes</span><input type="number" min="1" max="28" value={day} onInput={(e) => setDay(e.currentTarget.value)} /></label>
        <div class="field"><span>Cuenta</span>
          <div class="seg small">{ACCOUNTS.map((a) => <button key={a.id} class={acct === a.id ? 'on' : ''} onClick={() => setAcct(a.id)}>{a.name}</button>)}</div>
        </div>
        <label class="field"><span>Desde (mes)</span><input type="month" value={from} onInput={(e) => setFrom(e.currentTarget.value)} /></label>
        <div class="sheet-actions">
          {cur && <button class="btn ghost danger" onClick={remove}><Icon name="trash" size={18} /></button>}
          <button class="btn ghost" onClick={close}>Cancelar</button>
          <button class="btn primary" disabled={!(pesos > 0)} onClick={save}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

export { TYPES };
