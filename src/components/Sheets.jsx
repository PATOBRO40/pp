import { useState } from 'preact/hooks';
import { Icon } from './Icon.jsx';
import { HOUR, fmtDM, fmtDur, fromLocalInput, rangeTotals, startOfDay, startOfWeek, toLocalInput } from '../time.js';
import { activeSession, deleteSession, newId, now, resetTime, saveSession, set, useNow, useStore } from '../store.js';
import { applyImport } from '../backup.js';

/** Hoja inferior para crear/editar una sesión. */
export function EditSheet({ id, defaults }) {
  const st = useStore();
  const existing = id ? st.sessions.find((s) => s.id === id) : null;
  const t = now();
  const base = existing || defaults || { cat: st.cats[0].id, start: t - HOUR, end: t, note: '' };
  const [cat, setCat] = useState(base.cat);
  const [start, setStart] = useState(toLocalInput(base.start));
  const [end, setEnd] = useState(base.end == null ? toLocalInput(t) : toLocalInput(base.end));
  const [running, setRunning] = useState(base.end == null && !!existing);
  const [note, setNote] = useState(base.note || '');

  const s = fromLocalInput(start);
  const e = running ? null : fromLocalInput(end);
  let error = '';
  if (!start || (!running && !end)) error = 'Completa las fechas.';
  else if (e != null && e <= s) error = 'El fin debe ser posterior al inicio.';
  else if (e != null && e > t) error = 'El fin no puede estar en el futuro.';
  else if (s > t) error = 'El inicio no puede estar en el futuro.';
  const clash = !error && st.sessions.some((o) => o.id !== (existing?.id) && o.start < (e ?? t) && (o.end ?? t) > s);

  const close = () => set({ sheet: null });
  const save = () => {
    if (error) return;
    saveSession({ id: existing?.id || newId(), cat, start: s, end: e, note: note.trim() });
    close();
  };

  return (
    <div class="sheet-wrap" onClick={close}>
      <div class="sheet" onClick={(ev) => ev.stopPropagation()}>
        <div class="grab" />
        <h2>{existing ? 'Editar sesión' : 'Añadir sesión olvidada'}</h2>

        <div class="seg seg-cats">
          {st.cats.map((c) => (
            <button key={c.id} class={cat === c.id ? 'on' : ''} style={{ '--c': `var(--p${c.color})` }} onClick={() => setCat(c.id)}>
              <i class="dot" />{c.short}
            </button>
          ))}
        </div>

        <label class="field"><span>Inicio</span>
          <input type="datetime-local" value={start} onInput={(ev) => setStart(ev.currentTarget.value)} />
        </label>
        <label class="field"><span>Fin</span>
          <input type="datetime-local" value={end} disabled={running} onInput={(ev) => setEnd(ev.currentTarget.value)} />
        </label>
        {existing && existing.end == null && (
          <label class="check"><input type="checkbox" checked={running} onChange={(ev) => setRunning(ev.currentTarget.checked)} />
            <span>Sigue en curso</span></label>
        )}
        <label class="field"><span>Nota (opcional)</span>
          <input type="text" placeholder="¿En qué trabajaste?" value={note} maxLength={80} onInput={(ev) => setNote(ev.currentTarget.value)} />
        </label>

        {error && <p class="msg err">{error}</p>}
        {clash && <p class="msg warn">Se solapa con otra sesión: el tiempo se contará dos veces.</p>}

        <div class="sheet-actions">
          {existing && <button class="btn danger" onClick={() => { deleteSession(existing.id); close(); }}><Icon name="trash" size={18} /></button>}
          <button class="btn ghost" onClick={close}>Cancelar</button>
          <button class="btn primary" disabled={!!error} onClick={save}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

/** Confirmación de borrado total: hay que escribir BORRAR. */
export function WipeDialog() {
  const [txt, setTxt] = useState('');
  const close = () => set({ sheet: null });
  return (
    <div class="sheet-wrap center" onClick={close}>
      <div class="dialog" onClick={(ev) => ev.stopPropagation()}>
        <h2>¿Borrar todo?</h2>
        <p>Se eliminarán todas las sesiones de este dispositivo (tus ajustes se conservan). No se puede deshacer. Antes te conviene exportar un respaldo.</p>
        <input type="text" placeholder="Escribe BORRAR" value={txt} autocapitalize="characters" onInput={(ev) => setTxt(ev.currentTarget.value)} />
        <div class="sheet-actions">
          <button class="btn ghost" onClick={close}>Cancelar</button>
          <button class="btn danger-solid" disabled={txt.trim().toUpperCase() !== 'BORRAR'}
            onClick={() => { set({ sessions: [], sheet: null }); }}>Borrar todo</button>
        </div>
      </div>
    </div>
  );
}

const PERIODS = [['day', 'Hoy'], ['week', 'Esta semana'], ['all', 'Todo']];

/** Reinicia el tiempo de una categoría o de todas, en el periodo elegido. */
export function ResetSheet() {
  const st = useStore();
  const t = useNow();
  const act = activeSession(st);
  const [cat, setCat] = useState(act?.cat || 'all');
  const [period, setPeriod] = useState('day');
  const from = period === 'day' ? startOfDay(t) : period === 'week' ? startOfWeek(t) : -Infinity;
  const totals = rangeTotals(st.sessions, from, Infinity, t);
  const amount = cat === 'all' ? Object.values(totals).reduce((a, b) => a + b, 0) : totals[cat] || 0;
  const running = act && (cat === 'all' || act.cat === cat);
  const close = () => set({ sheet: null });

  return (
    <div class="sheet-wrap" onClick={close}>
      <div class="sheet" onClick={(ev) => ev.stopPropagation()}>
        <div class="grab" />
        <h2>Reiniciar tiempo</h2>

        <div class="seg seg-cats">
          <button class={cat === 'all' ? 'on' : ''} style={{ '--c': 'var(--text)' }} onClick={() => setCat('all')}>Todas</button>
          {st.cats.map((c) => (
            <button key={c.id} class={cat === c.id ? 'on' : ''} style={{ '--c': `var(--p${c.color})` }} onClick={() => setCat(c.id)}>
              <i class="dot" />{c.short}
            </button>
          ))}
        </div>

        <div class="seg">
          {PERIODS.map(([k, l]) => <button key={k} class={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}
        </div>

        <p class="msg warn">
          {amount > 0 ? `Se quitarán ${fmtDur(amount)} de los totales, topes y estadísticas.` : 'No hay tiempo que reiniciar aquí.'}
          {running && ' La sesión en curso volverá a 0 y seguirá corriendo.'}
        </p>

        <div class="sheet-actions">
          <button class="btn ghost" onClick={close}>Cancelar</button>
          <button class="btn danger-solid" disabled={amount <= 0} onClick={() => { resetTime(cat, from); close(); }}>Reiniciar</button>
        </div>
      </div>
    </div>
  );
}

/** Pregunta cómo aplicar un respaldo ya validado. */
export function ImportDialog({ parsed }) {
  const st = useStore();
  const close = () => set({ sheet: null });
  const n = parsed.sessions.length;
  const first = n ? Math.min(...parsed.sessions.map((s) => s.start)) : null;
  const last = n ? Math.max(...parsed.sessions.map((s) => s.start)) : null;
  const go = (mode) => { applyImport(parsed, mode); close(); };
  return (
    <div class="sheet-wrap center" onClick={close}>
      <div class="dialog" onClick={(ev) => ev.stopPropagation()}>
        <h2>Importar respaldo</h2>
        <p>
          {n} sesiones{first ? ` · del ${fmtDM(first)} al ${fmtDM(last)}` : ''}.
          {parsed.skipped > 0 && ` Se omitieron ${parsed.skipped} registros inválidos.`}
          {parsed.settings && ' Incluye ajustes.'}
        </p>
        <p>Actualmente tienes {st.sessions.length} sesiones. Podrás deshacer justo después.</p>
        <button class="btn primary" onClick={() => go('merge')} disabled={!n}>Combinar (agrega lo que falta)</button>
        <button class="btn danger-outline" style={{ marginTop: 0 }} onClick={() => go('replace')}>Reemplazar todo</button>
        <button class="btn ghost" onClick={close}>Cancelar</button>
      </div>
    </div>
  );
}
