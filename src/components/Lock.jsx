import { useState } from 'preact/hooks';
import { Icon } from './Icon.jsx';
import { set, toast, useNow, useStore } from '../store.js';
import { MIN_LENGTH, removeLock, savePassword, tryPassword, unlock, verifyBiometric, wipeAndUnlock } from '../lock.js';

const fmtWait = (ms) => {
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
};

/** Pantalla de entrada. Sustituye a toda la app mientras esté bloqueada. */
export function LockScreen() {
  const st = useStore();
  const t = useNow();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [txt, setTxt] = useState('');
  const wait = Math.max(0, (st.lock?.until || 0) - t);
  const hasBio = !!st.lock?.credId;

  const submit = async (ev) => {
    ev.preventDefault();
    if (busy || wait || !pw) return;
    setBusy(true);
    setErr('');
    const ok = await tryPassword(pw);
    setBusy(false);
    setPw('');
    if (ok) unlock();
    else setErr('Contraseña incorrecta.');
  };

  const bio = async () => {
    setErr('');
    try {
      await verifyBiometric();
      unlock();
    } catch {
      setErr('No se pudo verificar con Face ID. Usa tu contraseña.');
    }
  };

  if (forgot) {
    return (
      <div class="lock">
        <div class="lock-box">
          <h1>¿Olvidaste la contraseña?</h1>
          <p>No se puede recuperar porque no hay servidor. {hasBio ? 'Entra con Face ID y cámbiala en Ajustes.' : ''}</p>
          <p>La otra opción es <b>borrar todas tus sesiones</b> y quitar el bloqueo. Luego podrás importar un respaldo.</p>
          <input type="text" placeholder="Escribe BORRAR" value={txt} autocapitalize="characters" onInput={(e) => setTxt(e.currentTarget.value)} />
          <button class="btn danger-solid" disabled={txt.trim().toUpperCase() !== 'BORRAR'} onClick={wipeAndUnlock}>Borrar sesiones y entrar</button>
          <button class="btn ghost" onClick={() => { setForgot(false); setTxt(''); }}>Volver</button>
        </div>
      </div>
    );
  }

  return (
    <div class="lock">
      <div class="lock-box">
        <div class="brand">PP</div>
        <h1>Entrar a PP</h1>
        {hasBio && <button class="btn primary" onClick={bio}><Icon name="face" size={20} /> Entrar con Face ID</button>}
        <form onSubmit={submit}>
          <input type="password" placeholder="Contraseña" aria-label="Contraseña" autocomplete="current-password"
            value={pw} disabled={wait > 0} onInput={(e) => setPw(e.currentTarget.value)} />
          <button class={`btn ${hasBio ? 'ghost' : 'primary'}`} type="submit" disabled={busy || wait > 0 || !pw}>Entrar</button>
        </form>
        {wait > 0 && <p class="msg warn">Demasiados intentos. Espera {fmtWait(wait)}.</p>}
        {err && !wait && <p class="msg err">{err}</p>}
        <button class="link" onClick={() => setForgot(true)}>Olvidé mi contraseña</button>
      </div>
    </div>
  );
}

const TITLES = { create: 'Activar bloqueo', change: 'Cambiar contraseña', off: 'Quitar bloqueo' };

/** mode: create | change | off. Cambiar o quitar exige la contraseña actual o Face ID. */
export function LockSheet({ mode }) {
  const st = useStore();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const needsCurrent = mode !== 'create' && !confirmed;
  const needsNew = mode !== 'off';
  const close = () => set({ sheet: null });

  const bio = async () => {
    setErr('');
    try {
      await verifyBiometric();
      setConfirmed(true);
    } catch {
      setErr('No se pudo verificar con Face ID.');
    }
  };

  const save = async (ev) => {
    ev.preventDefault();
    if (busy) return;
    if (needsNew && pw.length < MIN_LENGTH) return setErr(`Usa al menos ${MIN_LENGTH} caracteres.`);
    if (needsNew && pw !== pw2) return setErr('Las contraseñas no coinciden.');
    setBusy(true);
    setErr('');
    try {
      if (needsCurrent && !(await tryPassword(current))) {
        setErr(Date.now() < (st.lock.until || 0) ? 'Demasiados intentos. Espera un momento.' : 'La contraseña actual no es correcta.');
        setCurrent('');
        return;
      }
      if (mode === 'off') await removeLock();
      else await savePassword(pw);
      close();
      toast({ create: 'Bloqueo activado', change: 'Contraseña cambiada', off: 'Bloqueo quitado' }[mode], { kind: 'ok' });
    } catch {
      setErr('No se pudo guardar. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="sheet-wrap" onClick={close}>
      <form class="sheet" onClick={(ev) => ev.stopPropagation()} onSubmit={save}>
        <div class="grab" />
        <h2>{TITLES[mode]}</h2>

        {mode === 'create' && (
          <p class="msg warn">Si olvidas la contraseña y no tienes Face ID, la única forma de entrar será borrar tus sesiones. Exporta un respaldo antes.</p>
        )}
        {needsCurrent && (
          <label class="field"><span>Contraseña actual</span>
            <input type="password" autocomplete="current-password" value={current} onInput={(e) => setCurrent(e.currentTarget.value)} />
          </label>
        )}
        {needsCurrent && st.lock?.credId && (
          <button type="button" class="btn ghost" onClick={bio}><Icon name="face" size={18} /> Confirmar con Face ID</button>
        )}
        {confirmed && <p class="msg ok">Identidad confirmada con Face ID.</p>}
        {needsNew && (
          <>
            <label class="field"><span>Contraseña nueva</span>
              <input type="password" autocomplete="new-password" value={pw} onInput={(e) => setPw(e.currentTarget.value)} />
            </label>
            <label class="field"><span>Repite la contraseña</span>
              <input type="password" autocomplete="new-password" value={pw2} onInput={(e) => setPw2(e.currentTarget.value)} />
            </label>
          </>
        )}
        {err && <p class="msg err">{err}</p>}

        <div class="sheet-actions">
          <button type="button" class="btn ghost" onClick={close}>Cancelar</button>
          <button type="submit" class={`btn ${mode === 'off' ? 'danger-solid' : 'primary'}`} disabled={busy}>{mode === 'off' ? 'Quitar' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  );
}
