// Configuración de Dinero: todo lo que decide la clasificación automática es editable.
// Los cambios se aplican también a los meses ya importados (salvo lo que corregiste a mano).
import { useState } from 'preact/hooks';
import { Icon } from '../components/Icon.jsx';
import { Row, Stepper, Toggle } from '../components/Controls.jsx';
import { newId, set, setFin, toast, useStore } from '../store.js';
import { CONF, FIN_ICONS, acctName, defaultFin, finCat, fmtMoney } from '../fin/model.js';
import { periodLabel, periodOf } from '../fin/stats.js';

const P = 100;
const pesos = (s) => Math.max(0, Math.round(parseFloat(String(s).replace(/[^\d]/g, '')) || 0));

function CatSelect({ f, value, onChange }) {
  return (
    <select class="select" value={value} onChange={(e) => onChange(e.currentTarget.value)}>
      {f.cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

/** Campo de pesos que se guarda al salir del campo (evita reclasificar con cada tecla). */
function MoneyInput({ cents, onChange }) {
  return (
    <input class="money-in" type="text" inputmode="numeric" value={String(Math.round(cents / P))}
      onChange={(e) => onChange(pesos(e.currentTarget.value) * P)} />
  );
}

function Bands({ f }) {
  const bands = [...f.bands].sort((a, b) => a.from - b.from);
  const upd = (i, patch) => setFin((x) => ({ ...x, bands: bands.map((b, j) => (j === i ? { ...b, ...patch } : b)).sort((a, b) => a.from - b.from) }));
  const del = (i) => setFin((x) => ({ ...x, bands: bands.filter((_, j) => j !== i) }));
  const add = () => setFin((x) => ({ ...x, bands: [...bands, { from: (bands.at(-1)?.from || 0) + 10000 * P, cat: 'rest', conf: 'media' }] }));
  return (
    <section class="panel tight">
      {bands.map((b, i) => {
        const to = bands[i + 1] ? bands[i + 1].from - P : null;
        return (
          <div class="band" key={i}>
            <div class="band-range">
              {i === 0 ? <span>Desde $0</span> : <label>Desde $<MoneyInput cents={b.from} onChange={(v) => upd(i, { from: v })} /></label>}
              <small>{to != null ? `hasta ${fmtMoney(to)}` : 'en adelante'}</small>
            </div>
            <div class="band-opts">
              <CatSelect f={f} value={b.cat} onChange={(v) => upd(i, { cat: v })} />
              <select class="select" value={b.conf} onChange={(e) => upd(i, { conf: e.currentTarget.value })}>
                {Object.entries(CONF).map(([k, l]) => <option key={k} value={k}>{k === 'alta' ? 'Automático' : `Revisar (${l.toLowerCase()})`}</option>)}
              </select>
              {i > 0 && <button class="round xs" onClick={() => del(i)} aria-label="Quitar rango"><Icon name="trash" size={15} /></button>}
            </div>
          </div>
        );
      })}
      <button class="btn ghost wide add" onClick={add}><Icon name="plus" size={16} /> Añadir rango</button>
    </section>
  );
}

function Merchants({ f }) {
  const [text, setText] = useState('');
  const [cat, setCat] = useState('compras');
  const add = () => {
    if (!text.trim()) return;
    setFin((x) => ({ ...x, merchants: [{ text: text.trim().toUpperCase(), cat }, ...x.merchants] }));
    setText('');
  };
  return (
    <section class="panel tight">
      <p class="fine first">Si la descripción contiene el texto, va a esa categoría. Se revisan en orden.</p>
      <div class="merch-add">
        <input type="text" placeholder="Texto, ej. RAPPI" value={text} onInput={(e) => setText(e.currentTarget.value)} />
        <CatSelect f={f} value={cat} onChange={setCat} />
        <button class="round xs" onClick={add} aria-label="Añadir"><Icon name="plus" size={16} /></button>
      </div>
      {f.merchants.map((r, i) => (
        <div class="merch" key={r.text + i}>
          <code>{r.text}</code>
          <CatSelect f={f} value={r.cat} onChange={(v) => setFin((x) => ({ ...x, merchants: x.merchants.map((y, j) => (j === i ? { ...y, cat: v } : y)) }))} />
          <button class="round xs" onClick={() => setFin((x) => ({ ...x, merchants: x.merchants.filter((_, j) => j !== i) }))} aria-label="Quitar"><Icon name="trash" size={15} /></button>
        </div>
      ))}
    </section>
  );
}

function Memo({ f }) {
  const items = Object.entries(f.memo);
  if (!items.length) return <p class="fine first">Aún nada. Cuando corriges un movimiento para «todos los de este nombre», la regla aparece aquí.</p>;
  const label = (v) => (v.type === 'gasto' ? finCat(f, v.cat).name : { ingreso: 'Ingreso', propia: 'Entre tus cuentas', anulado: 'No contar' }[v.type] || v.type);
  return (
    <section class="panel tight">
      {items.map(([k, v]) => (
        <div class="merch" key={k}>
          <span class="ellip">{k.replace(/(^|\s)\S/g, (c) => c.toUpperCase())}</span>
          <small>{label(v)}</small>
          <button class="round xs" onClick={() => setFin((x) => { const memo = { ...x.memo }; delete memo[k]; return { ...x, memo }; })} aria-label="Olvidar"><Icon name="trash" size={15} /></button>
        </div>
      ))}
    </section>
  );
}

function CatEditor({ f }) {
  const [open, setOpen] = useState(null);
  const upd = (id, patch) => setFin((x) => ({ ...x, cats: x.cats.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const add = () => {
    const id = 'f' + newId();
    setFin((x) => ({ ...x, cats: [...x.cats.filter((c) => c.id !== 'rest'), { id, name: 'Nueva categoría', color: 1, icon: 'star' }, ...x.cats.filter((c) => c.id === 'rest')] }));
    setOpen(id);
  };
  const del = (id) => {
    const prev = f;
    setFin((x) => ({
      ...x,
      cats: x.cats.filter((c) => c.id !== id),
      bands: x.bands.map((b) => (b.cat === id ? { ...b, cat: 'rest' } : b)),
      merchants: x.merchants.map((m) => (m.cat === id ? { ...m, cat: 'rest' } : m)),
      memo: Object.fromEntries(Object.entries(x.memo).map(([k, v]) => [k, v.cat === id ? { ...v, cat: 'rest' } : v])),
      movs: x.movs.map((m) => (m.manual?.cat === id ? { ...m, manual: { ...m.manual, cat: 'rest' } } : m)),
      qrSmall: x.qrSmall.cat === id ? { ...x.qrSmall, cat: 'rest' } : x.qrSmall,
      unknownBuy: x.unknownBuy === id ? 'rest' : x.unknownBuy,
    }));
    setOpen(null);
    toast('Categoría eliminada: lo suyo pasa a Restante', { action: { label: 'Deshacer', fn: () => setFin(() => prev) } });
  };
  return (
    <section class="panel list">
      {f.cats.map((c) => (
        <div key={c.id} style={{ '--c': `var(--p${c.color})` }}>
          <button class="cat-row" onClick={() => setOpen(open === c.id ? null : c.id)}>
            <span class="ico"><Icon name={c.icon} size={18} /></span>
            <span class="cat-row-main"><b>{c.name}</b>{c.id === 'rest' && <small>Todo lo que no encaja en las demás</small>}</span>
            <Icon name={open === c.id ? 'down' : 'right'} size={16} />
          </button>
          {open === c.id && (
            <div class="cat-edit">
              <label class="field"><span>Nombre</span><input type="text" maxLength={40} value={c.name} onInput={(e) => upd(c.id, { name: e.currentTarget.value })} /></label>
              <div class="swatches">
                {[1, 2, 3, 4, 5, 6].map((n) => <button key={n} class={c.color === n ? 'on' : ''} style={{ background: `var(--p${n})` }} onClick={() => upd(c.id, { color: n })} aria-label={`Color ${n}`} />)}
              </div>
              <div class="icon-pick">
                {FIN_ICONS.map((n) => <button key={n} class={c.icon === n ? 'on' : ''} onClick={() => upd(c.id, { icon: n })} aria-label={n}><Icon name={n} size={20} /></button>)}
              </div>
              {c.id !== 'rest' && <button class="btn danger-outline" onClick={() => del(c.id)}><Icon name="trash" size={16} /> Eliminar categoría</button>}
            </div>
          )}
        </div>
      ))}
      <button class="btn ghost wide add" onClick={add}><Icon name="plus" size={16} /> Añadir categoría</button>
    </section>
  );
}

export function FinConfig({ back }) {
  const st = useStore();
  const f = st.fin;
  const [wipe, setWipe] = useState('');
  const stmts = [...f.stmts].sort((a, b) => b.to.localeCompare(a.to));
  const removeStmt = (key) => {
    const prev = f;
    setFin((x) => ({ ...x, stmts: x.stmts.filter((s) => s.key !== key), movs: x.movs.filter((m) => m.src !== key) }));
    toast('Extracto quitado', { action: { label: 'Deshacer', fn: () => setFin(() => prev) } });
  };
  return (
    <div class="screen">
      <header class="top">
        <button class="round sm" onClick={back} aria-label="Volver"><Icon name="left" size={18} /></button>
        <div class="grow"><div class="eyebrow">Dinero</div><h1>Configurar</h1></div>
      </header>
      <p class="fine first">Todo lo que cambies aquí se aplica también a los meses ya importados. Lo que corregiste a mano en un movimiento se respeta.</p>

      <h3 class="sec">General</h3>
      <section class="panel tight">
        <label class="field"><span>Tu nombre (para reconocer tus transferencias)</span>
          <input type="text" value={f.owner} onChange={(e) => setFin({ owner: e.currentTarget.value })} />
        </label>
        <Row label="El mes empieza el día" hint="Ej. tu día de pago">
          <Stepper value={f.monthStart} step={1} min={1} max={28} onChange={(v) => setFin({ monthStart: v })} />
        </Row>
        <Row label="Ocultar montos"><Toggle on={f.hide} onChange={(v) => setFin({ hide: v })} /></Row>
      </section>

      <h3 class="sec">Ingresos</h3>
      <section class="panel tight">
        <Row label="Recargas desde otro banco" hint="Ej. «Recarga desde Bancolombia»">
          <div class="seg small">
            <button class={f.recargas === 'propia' ? 'on' : ''} onClick={() => setFin({ recargas: 'propia' })}>Mías</button>
            <button class={f.recargas === 'ingreso' ? 'on' : ''} onClick={() => setFin({ recargas: 'ingreso' })}>Ingreso</button>
          </div>
        </Row>
        <p class="fine inline">«Mías»: es tu dinero que pasas de una cuenta a otra, no cuenta como ingreso. Cada movimiento se puede cambiar a mano.</p>
        <div class="field"><span>Ingresos fijos mensuales</span></div>
        {f.incomes.map((i) => (
          <button class="cat-row" key={i.id} onClick={() => set({ sheet: { type: 'income', id: i.id } })}>
            <span class="cat-row-main"><b>{i.name}</b><small>{fmtMoney(i.amount, f.hide)} · día {i.day} · {acctName(i.acct)} · desde {periodLabel(i.from, 1)}</small></span>
            <Icon name="right" size={16} />
          </button>
        ))}
        <button class="btn ghost wide add" onClick={() => set({ sheet: { type: 'income', id: null } })}><Icon name="plus" size={16} /> Añadir ingreso fijo</button>
      </section>

      <h3 class="sec">Pagos a personas según el monto</h3>
      <p class="fine first">Para los nombres que no hayas configurado. «Automático» asigna sin preguntar; «Revisar» asigna y lo deja en la lista de pendientes.</p>
      <Bands f={f} />

      <h3 class="sec">Pagos con QR</h3>
      <section class="panel tight">
        <Row label="QR pequeños a una categoría"><Toggle on={f.qrSmall.on} onChange={(v) => setFin({ qrSmall: { ...f.qrSmall, on: v } })} /></Row>
        {f.qrSmall.on && (
          <div class="merch">
            <label class="band-range">Menos de $<MoneyInput cents={f.qrSmall.below} onChange={(v) => setFin({ qrSmall: { ...f.qrSmall, below: v } })} /></label>
            <CatSelect f={f} value={f.qrSmall.cat} onChange={(v) => setFin({ qrSmall: { ...f.qrSmall, cat: v } })} />
          </div>
        )}
      </section>

      <h3 class="sec">Comercios</h3>
      <Merchants f={f} />
      <section class="panel tight" style={{ marginTop: 10 }}>
        <Row label="Compras sin regla van a"><CatSelect f={f} value={f.unknownBuy} onChange={(v) => setFin({ unknownBuy: v })} /></Row>
      </section>

      <h3 class="sec">Reglas por nombre</h3>
      <Memo f={f} />

      <h3 class="sec">Categorías de gasto</h3>
      <CatEditor f={f} />

      <h3 class="sec">Extractos importados</h3>
      <section class="panel tight">
        {!stmts.length && <p class="fine first">Ninguno todavía.</p>}
        {stmts.map((s) => (
          <div class="merch" key={s.key}>
            <span class="ellip"><b>{s.bank === 'nu' ? 'Nu' : 'Nequi'}</b> · {periodLabel(periodOf(s.to, 1), 1)}</span>
            <small>{f.movs.filter((m) => m.src === s.key).length} mov.</small>
            <button class="round xs" onClick={() => removeStmt(s.key)} aria-label="Quitar extracto"><Icon name="trash" size={15} /></button>
          </div>
        ))}
      </section>

      <h3 class="sec">Restablecer</h3>
      <section class="panel stack">
        <button class="btn ghost" onClick={() => {
          const prev = f;
          const d = defaultFin();
          setFin((x) => ({ ...x, cats: d.cats, bands: d.bands, merchants: d.merchants, qrSmall: d.qrSmall, recargas: d.recargas, unknownBuy: d.unknownBuy }));
          toast('Reglas restablecidas', { action: { label: 'Deshacer', fn: () => setFin(() => prev) } });
        }}>Restablecer reglas y categorías</button>
        <p class="fine inline">Borrar todo Dinero elimina movimientos, extractos y reglas de este teléfono. Exporta un respaldo antes.</p>
        <input type="text" placeholder="Escribe BORRAR" value={wipe} autocapitalize="characters" onInput={(e) => setWipe(e.currentTarget.value)} />
        <button class="btn danger-solid" disabled={wipe.trim().toUpperCase() !== 'BORRAR'} onClick={() => { setFin(() => defaultFin()); setWipe(''); back(); toast('Datos de Dinero borrados'); }}>Borrar todo Dinero</button>
      </section>
    </div>
  );
}
