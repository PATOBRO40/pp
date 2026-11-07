import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../components/Icon.jsx';
import { Row, Stepper, Toggle } from '../components/Controls.jsx';
import { catById } from '../model.js';
import { fmtDM, fmtDur } from '../time.js';
import { addCategory, addGroup, resetSettings, set, setArchived, toast, updateCategory, updateGroup, useStore } from '../store.js';
import { exportBackup, parseBackup } from '../backup.js';
import { checkUpdate, isStandalone } from '../pwa.js';
import { biometricAvailable, enrollBiometric, removeBiometric, setGrace } from '../lock.js';

const VARIANTS = [['aurora', 'Aurora'], ['neon', 'Neón'], ['editorial', 'Editorial']];
const GRACES = [[0, 'Al salir'], [60000, '1 min'], [300000, '5 min']];

export function Settings() {
  const st = useStore();
  const fileRef = useRef(null);
  const [bio, setBio] = useState(false);
  useEffect(() => { biometricAvailable().then(setBio); }, []);
  const openCat = (id) => set({ sheet: { type: 'cat', id } });
  const openGroup = (id) => set({ sheet: { type: 'group', id } });
  const live = st.cats.filter((c) => !c.archived);
  const archived = st.cats.filter((c) => c.archived);
  const catSummary = (c) => [c.cap != null ? `Tope ${c.cap} h` : 'Sin tope propio', ...st.groups.filter((g) => g.cats.includes(c.id)).map((g) => g.name)].join(' · ');

  const onFile = async (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    const parsed = parseBackup(await f.text());
    if (parsed.error) toast(parsed.error, { kind: 'warn', long: true });
    else set({ sheet: { type: 'import', parsed } });
  };

  const toggleBio = async (on) => {
    try {
      if (on) { await enrollBiometric(); toast('Face ID activado', { kind: 'ok' }); }
      else { await removeBiometric(); toast('Face ID desactivado'); }
    } catch {
      toast('No se pudo activar Face ID. Revisa que el Llavero de iCloud esté activo.', { kind: 'warn', long: true });
    }
  };

  const last = st.meta.lastBackupAt;
  return (
    <div class="screen">
      <header class="top"><div><div class="eyebrow">Ajustes</div><h1>Configuración</h1></div></header>

      <h3 class="sec">Topes compartidos</h3>
      <section class="panel">
        {st.groups.map((g) => (
          <div class="set-row" key={g.id}>
            <button class="set-label tap" onClick={() => openGroup(g.id)}>
              <span>{g.name} <Icon name="right" size={13} /></span>
              <small>{g.cats.map((id) => catById(st, id).short).join(' + ') || 'Sin categorías'}</small>
            </button>
            <Stepper value={g.hours} step={0.5} unit="h" onChange={(v) => updateGroup(g.id, { hours: v })} />
          </div>
        ))}
        <button class="btn ghost wide" onClick={() => openGroup(addGroup())}><Icon name="plus" size={18} /> Añadir tope compartido</button>
      </section>

      <h3 class="sec">Topes propios</h3>
      <section class="panel">
        {live.filter((c) => c.cap != null).map((c) => (
          <div class="set-row" key={c.id}>
            <button class="set-label tap" onClick={() => openCat(c.id)}>
              <span><i class="dot" style={{ background: `var(--p${c.color})` }} /> {c.name}</span>
            </button>
            <Stepper value={c.cap} step={0.5} unit="h" onChange={(v) => updateCategory(c.id, { cap: v })} />
          </div>
        ))}
        <Row label="Avisar desde" hint="Ámbar a este porcentaje y rojo al superar cualquier tope">
          <Stepper value={st.warnPct} step={5} min={10} max={100} unit="%" onChange={(v) => set({ warnPct: v })} />
        </Row>
        <p class="fine">Para poner o quitar el tope propio de una categoría, ábrela en Categorías.</p>
      </section>

      <h3 class="sec">Categorías</h3>
      <section class="panel list">
        {live.map((c) => (
          <button class="cat-row" key={c.id} style={{ '--c': `var(--p${c.color})` }} onClick={() => openCat(c.id)}>
            <span class="ico"><Icon name={c.icon} size={18} /></span>
            <span class="cat-row-main"><b>{c.name}</b><small>{catSummary(c)}</small></span>
            <Icon name="right" size={16} />
          </button>
        ))}
        <button class="btn ghost wide add" onClick={() => openCat(addCategory())}><Icon name="plus" size={18} /> Añadir categoría</button>
      </section>

      {archived.length > 0 && (
        <>
          <h3 class="sec">Archivadas</h3>
          <section class="panel list">
            {archived.map((c) => (
              <div class="cat-row" key={c.id} style={{ '--c': `var(--p${c.color})` }}>
                <span class="ico"><Icon name={c.icon} size={18} /></span>
                <button class="cat-row-main" onClick={() => openCat(c.id)}><b>{c.name}</b><small>Oculta · conserva su historial</small></button>
                <button class="btn ghost sm" onClick={() => setArchived(c.id, false)}>Restaurar</button>
              </div>
            ))}
          </section>
        </>
      )}

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

      <h3 class="sec">Seguridad</h3>
      <section class="panel">
        <Row label="Bloqueo con contraseña" hint={st.lock ? 'Activado' : 'Pide contraseña para entrar a la app'}>
          <Toggle on={!!st.lock} onChange={() => set({ sheet: { type: 'lock', mode: st.lock ? 'off' : 'create' } })} />
        </Row>
        {st.lock && bio && (
          <Row label="Face ID" hint="Entrar sin escribir la contraseña">
            <Toggle on={!!st.lock.credId} onChange={toggleBio} />
          </Row>
        )}
        {st.lock && (
          <Row label="Bloquear" hint="Tras salir de la app">
            <div class="seg small">
              {GRACES.map(([ms, l]) => <button key={ms} class={st.lock.grace === ms ? 'on' : ''} onClick={() => setGrace(ms)}>{l}</button>)}
            </div>
          </Row>
        )}
        {st.lock && <button class="btn ghost wide" onClick={() => set({ sheet: { type: 'lock', mode: 'change' } })}>Cambiar contraseña</button>}
        {st.lock && !bio && <p class="fine">Face ID no está disponible en este navegador.</p>}
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
