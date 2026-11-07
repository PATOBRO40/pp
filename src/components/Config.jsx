// Hojas de Ajustes para editar una categoría o un tope compartido.
import { useState } from 'preact/hooks';
import { Icon } from './Icon.jsx';
import { Row, Stepper, Toggle } from './Controls.jsx';
import { ICONS, catById, groupHints } from '../model.js';
import { fmtDur } from '../time.js';
import { deleteCategory, deleteGroup, moveCategory, now, set, setArchived, updateCategory, updateGroup, useStore } from '../store.js';

const close = () => set({ sheet: null });

export function CategorySheet({ id }) {
  const st = useStore();
  const [confirm, setConfirm] = useState(false);
  const [txt, setTxt] = useState('');
  const c = st.cats.find((x) => x.id === id);
  if (!c) return null;
  const idx = st.cats.indexOf(c);
  const own = st.sessions.filter((s) => s.cat === id);
  const total = own.reduce((a, s) => a + ((s.end ?? now()) - s.start), 0);
  const upd = (patch) => updateCategory(id, patch);
  const toggleGroup = (g) => updateGroup(g.id, { cats: g.cats.includes(id) ? g.cats.filter((x) => x !== id) : [...g.cats, id] });
  const remove = () => { if (deleteCategory(id)) close(); };

  return (
    <div class="sheet-wrap" onClick={close}>
      <div class="sheet" onClick={(ev) => ev.stopPropagation()} style={{ '--c': `var(--p${c.color})` }}>
        <div class="grab" />
        <h2>{c.archived ? 'Categoría archivada' : 'Editar categoría'}</h2>

        <label class="field"><span>Nombre</span>
          <input type="text" value={c.name} maxLength={32} onInput={(e) => upd({ name: e.currentTarget.value })} />
        </label>
        <label class="field"><span>Nombre corto (barras y totales)</span>
          <input type="text" value={c.short} maxLength={16} onInput={(e) => upd({ short: e.currentTarget.value })} />
        </label>

        <div class="field"><span>Color</span>
          <div class="swatches">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button key={n} class={c.color === n ? 'on' : ''} style={{ background: `var(--p${n})` }} onClick={() => upd({ color: n })} aria-label={`Color ${n}`} />
            ))}
          </div>
        </div>

        <div class="field"><span>Ícono</span>
          <div class="icon-pick">
            {ICONS.map((n) => <button key={n} class={c.icon === n ? 'on' : ''} onClick={() => upd({ icon: n })} aria-label={n}><Icon name={n} size={20} /></button>)}
          </div>
        </div>

        <div class="panel tight">
          <Row label="Tope propio" hint="Horas por semana solo de esta categoría">
            <Toggle on={c.cap != null} onChange={(on) => upd({ cap: on ? 10 : null })} />
          </Row>
          {c.cap != null && (
            <Row label="Horas">
              <Stepper value={c.cap} step={0.5} unit="h" onChange={(v) => upd({ cap: v })} />
            </Row>
          )}
        </div>

        {st.groups.length > 0 && (
          <div class="field"><span>Topes compartidos</span>
            <div class="panel tight">
              {st.groups.map((g) => (
                <label class="check row" key={g.id}>
                  <input type="checkbox" checked={g.cats.includes(id)} onChange={() => toggleGroup(g)} />
                  <span>{g.name}</span><small>{g.hours} h</small>
                </label>
              ))}
            </div>
          </div>
        )}

        <div class="btn-grid">
          <button class="btn ghost" disabled={idx === 0} onClick={() => moveCategory(id, -1)}>↑ Subir</button>
          <button class="btn ghost" disabled={idx === st.cats.length - 1} onClick={() => moveCategory(id, 1)}>↓ Bajar</button>
        </div>

        {!confirm ? (
          <div class="btn-grid">
            <button class="btn ghost" onClick={() => { setArchived(id, !c.archived); close(); }}>{c.archived ? 'Restaurar' : 'Archivar'}</button>
            <button class="btn danger-outline" style={{ marginTop: 0 }} onClick={() => setConfirm(true)}><Icon name="trash" size={18} /> Eliminar</button>
          </div>
        ) : (
          <div class="panel tight danger-zone">
            <p>
              {own.length
                ? `Se borrarán también sus ${own.length} sesiones (${fmtDur(total)}). Si solo quieres ocultarla, archívala: conserva su historial.`
                : 'Esta categoría no tiene sesiones.'}
            </p>
            {own.length > 0 && <input type="text" placeholder="Escribe BORRAR" value={txt} autocapitalize="characters" onInput={(e) => setTxt(e.currentTarget.value)} />}
            <div class="btn-grid">
              <button class="btn ghost" onClick={() => { setConfirm(false); setTxt(''); }}>Cancelar</button>
              <button class="btn danger-solid" disabled={own.length > 0 && txt.trim().toUpperCase() !== 'BORRAR'} onClick={remove}>Eliminar</button>
            </div>
          </div>
        )}

        <button class="btn primary" onClick={close}>Listo</button>
      </div>
    </div>
  );
}

export function GroupSheet({ id }) {
  const st = useStore();
  const g = st.groups.find((x) => x.id === id);
  if (!g) return null;
  const upd = (patch) => updateGroup(id, patch);
  const toggle = (cid) => upd({ cats: g.cats.includes(cid) ? g.cats.filter((x) => x !== cid) : [...g.cats, cid] });
  const options = st.cats.filter((c) => !c.archived || g.cats.includes(c.id));
  const hints = groupHints(st, g);

  return (
    <div class="sheet-wrap" onClick={close}>
      <div class="sheet" onClick={(ev) => ev.stopPropagation()}>
        <div class="grab" />
        <h2>Tope compartido</h2>
        <label class="field"><span>Nombre</span>
          <input type="text" value={g.name} maxLength={24} onInput={(e) => upd({ name: e.currentTarget.value })} />
        </label>
        <div class="panel tight">
          <Row label="Horas por semana" hint="Suma de todas sus categorías">
            <Stepper value={g.hours} step={0.5} unit="h" onChange={(v) => upd({ hours: v })} />
          </Row>
        </div>
        <div class="field"><span>Categorías que cuentan</span>
          <div class="panel tight">
            {options.map((c) => (
              <label class="check row" key={c.id} style={{ '--c': `var(--p${c.color})` }}>
                <input type="checkbox" checked={g.cats.includes(c.id)} onChange={() => toggle(c.id)} />
                <i class="dot" /><span>{c.name}</span><small>{c.cap != null ? `propio ${c.cap} h` : ''}</small>
              </label>
            ))}
          </div>
        </div>
        {hints.map((h) => <p class="msg warn" key={h}>{h}</p>)}
        <div class="btn-grid">
          <button class="btn danger-outline" style={{ marginTop: 0 }} onClick={() => { deleteGroup(id); close(); }}><Icon name="trash" size={18} /> Eliminar tope</button>
          <button class="btn primary" onClick={close}>Listo</button>
        </div>
      </div>
    </div>
  );
}

export { catById };
