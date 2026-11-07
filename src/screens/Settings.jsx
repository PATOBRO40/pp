import { useRef } from 'preact/hooks';
import { Icon } from '../components/Icon.jsx';
import { fmtDM, fmtDur } from '../time.js';
import { resetSettings, set, toast, useStore } from '../store.js';
import { exportBackup, parseBackup } from '../backup.js';
import { checkUpdate, isStandalone } from '../pwa.js';

function Stepper({ value, onChange, step = 1, min = 0, max = 168, unit = '' }) {
  const clamp = (v) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  return (
    <div class="stepper">
      <button onClick={() => onChange(clamp(value - step))} aria-label="Menos">−</button>
      <input type="number" inputmode="decimal" value={value} step={step}
        onChange={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v)) onChange(clamp(v)); }} />
      <span class="unit">{unit}</span>
      <button onClick={() => onChange(clamp(value + step))} aria-label="Más">+</button>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return <button class={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}><i /></button>;
}

const Row = ({ label, hint, children }) => (
  <div class="set-row">
    <div class="set-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
    {children}
  </div>
);

const VARIANTS = [['aurora', 'Aurora'], ['neon', 'Neón'], ['editorial', 'Editorial']];

export function Settings() {
  const st = useStore();
  const fileRef = useRef(null);
  const setGroup = (id, patch) => set({ groups: st.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
  const setCat = (id, patch) => set({ cats: st.cats.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const onFile = async (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    const parsed = parseBackup(await f.text());
    if (parsed.error) toast(parsed.error, { kind: 'warn', long: true });
    else set({ sheet: { type: 'import', parsed } });
  };

  const last = st.meta.lastBackupAt;
  return (
    <div class="screen">
      <header class="top"><div><div class="eyebrow">Ajustes</div><h1>Configuración</h1></div></header>

      <h3 class="sec">Topes semanales</h3>
      <section class="panel">
        {st.groups.map((g) => (
          <Row key={g.id} label={g.name} hint={st.cats.filter((c) => c.group === g.id).map((c) => c.short).join(' + ')}>
            <Stepper value={g.hours} step={0.5} unit="h" onChange={(v) => setGroup(g.id, { hours: v })} />
          </Row>
        ))}
        <Row label="Avisar desde" hint="La barra se pone ámbar a este porcentaje y roja al superar el tope">
          <Stepper value={st.warnPct} step={5} min={10} max={100} unit="%" onChange={(v) => set({ warnPct: v })} />
        </Row>
      </section>

      <h3 class="sec">Categorías</h3>
      <section class="panel">
        {st.cats.map((c) => (
          <div class="cat-set" key={c.id}>
            <input class="name-input" type="text" value={c.name} maxLength={28}
              onInput={(e) => setCat(c.id, { name: e.currentTarget.value, short: e.currentTarget.value.replace(/^Ensoñaciones /, '') || c.short })} />
            <div class="swatches">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button key={n} class={c.color === n ? 'on' : ''} style={{ background: `var(--p${n})` }} onClick={() => setCat(c.id, { color: n })} aria-label={`Color ${n}`} />
              ))}
            </div>
            <div class="seg small">
              {st.groups.map((g) => <button key={g.id} class={c.group === g.id ? 'on' : ''} onClick={() => setCat(c.id, { group: g.id })}>Tope: {g.name}</button>)}
            </div>
          </div>
        ))}
      </section>

      <h3 class="sec">Sesiones</h3>
      <section class="panel">
        <Row label="Aviso de sesión olvidada" hint="Pregunta si una sesión lleva más de…">
          <Stepper value={st.forgetHours} step={1} min={1} max={24} unit="h" onChange={(v) => set({ forgetHours: v })} />
        </Row>
        <Row label="Descartar sesiones menores a" hint="Evita registros por toques accidentales">
          <Stepper value={st.minSeconds} step={1} min={0} max={120} unit="s" onChange={(v) => set({ minSeconds: v })} />
        </Row>
        <Row label="Sonido sutil" hint="Al iniciar, finalizar y avisos de tope">
          <Toggle on={st.sound} onChange={(v) => set({ sound: v })} />
        </Row>
      </section>

      <h3 class="sec">Apariencia</h3>
      <section class="panel">
        <Row label="Tema">
          <div class="seg small">
            {[['dark', 'Oscuro'], ['light', 'Claro'], ['auto', 'Auto']].map(([k, l]) => <button key={k} class={st.theme === k ? 'on' : ''} onClick={() => set({ theme: k })}>{l}</button>)}
          </div>
        </Row>
        <Row label="Estilo">
          <div class="seg small">
            {VARIANTS.map(([k, l]) => <button key={k} class={st.variant === k ? 'on' : ''} onClick={() => set({ variant: k })}>{l}</button>)}
          </div>
        </Row>
      </section>

      <h3 class="sec">Datos y respaldo</h3>
      <section class="panel">
        <p class="fine first">
          {last ? `Último respaldo: ${fmtDM(last)} (hace ${fmtDur(Date.now() - last)}).` : 'Aún no has exportado un respaldo.'}
          {' '}{st.sessions.length} sesiones guardadas en este dispositivo.
        </p>
        <div class="btn-grid">
          <button class="btn ghost" onClick={exportBackup}><Icon name="up" size={18} /> Exportar JSON</button>
          <button class="btn ghost" onClick={() => fileRef.current.click()}><Icon name="down" size={18} /> Importar JSON</button>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
        <button class="btn ghost wide" onClick={() => set({ sheet: { type: 'reset' } })}><Icon name="reset" size={18} /> Reiniciar tiempo</button>
        <button class="btn danger-outline wide" onClick={() => set({ sheet: { type: 'wipe' } })}><Icon name="trash" size={18} /> Borrar todo</button>
        <p class="fine">Los datos viven solo en este iPhone. Si borras la app o su almacenamiento, se pierden: exporta un respaldo con regularidad y guárdalo en Archivos o iCloud.</p>
      </section>

      <h3 class="sec">Acerca de</h3>
      <section class="panel">
        <Row label="Versión" hint={isStandalone() ? 'App instalada' : 'Abierta en el navegador'}>
          <button class="btn ghost sm" onClick={checkUpdate}>Buscar actualización</button>
        </Row>
        <Row label="Almacenamiento" hint={st.persisted ? 'Protegido contra limpieza automática' : 'Estándar (se protege al instalar la app)'}>
          <span class="fine inline">v{__APP_VERSION__}</span>
        </Row>
        <button class="btn ghost wide" onClick={() => { resetSettings(); toast('Ajustes restablecidos'); }}>Restablecer ajustes</button>
      </section>
    </div>
  );
}
