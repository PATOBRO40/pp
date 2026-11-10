// Modo de privacidad global: ocultar cifras, u ocultar también nombres e íconos.
// Se guarda en los ajustes y sigue activo hasta que lo desactives. No aplica en Ajustes.
import { useState } from 'preact/hooks';
import { Icon } from './Icon.jsx';
import { checkPassword, confirmBiometric, hasBiometric } from '../lock.js';
import { getState, set, useStore } from '../store.js';

export const PRIVACY = [
  ['off', 'Mostrar todo', 'Cifras, nombres y categorías a la vista.'],
  ['data', 'Ocultar datos', 'Tapa tiempos, montos, porcentajes y horas. Las categorías se ven.'],
  ['all', 'Ocultar todo', 'Tapa también los nombres de categorías, personas y comercios, y sus íconos.'],
];

/** ¿Hay que ocultar montos? (Dinero los formatea como $ ••••) */
export const HIDE = () => getState().privacy === 'data' || getState().privacy === 'all';

// ---------- Ajustes protegidos ----------
// Con un modo de ocultar activo (y bloqueo configurado), entrar a Ajustes o a Dinero → Configurar
// exige Face ID o contraseña. La autorización dura hasta salir de esa pantalla.

/** ¿Hay que verificar para entrar a los ajustes? */
export const settingsNeedAuth = (s = getState()) => (s.privacy === 'data' || s.privacy === 'all') && s.lock?.v === 2;

/**
 * Llamar directamente en el toque que abre la pantalla protegida: así Face ID puede pedirse
 * enseguida (Safari exige un gesto). flag: 'settingsAuth' | 'finCfgAuth'.
 */
export function requestSettingsAuth(flag) {
  const s = getState();
  if (!settingsNeedAuth(s) || s[flag]) return;
  if (hasBiometric(s.lock)) confirmBiometric().then(() => set({ [flag]: true })).catch(() => {});
}

/** Pantalla que reemplaza a los ajustes hasta verificar la identidad. */
export function AuthGate({ flag, title }) {
  const st = useStore();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const bio = hasBiometric(st.lock);
  const ok = () => set({ [flag]: true });
  const tryBio = async () => {
    setErr('');
    try { await confirmBiometric(); ok(); } catch { setErr('No se pudo verificar con Face ID. Usa tu contraseña.'); }
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    const good = await checkPassword(pw);
    setBusy(false);
    setPw('');
    if (good) ok();
    else setErr(Date.now() < (getState().lock?.until || 0) ? 'Demasiados intentos. Espera un momento.' : 'Contraseña incorrecta.');
  };
  return (
    <div class="screen">
      <header class="top"><div><div class="eyebrow">Protegido</div><h1>{title}</h1></div></header>
      <section class="panel stack auth-gate">
        <div class="gate-ico"><Icon name="eyeoff" size={28} /></div>
        <p>Tienes activo un modo de ocultar. Para entrar a {title.toLowerCase()}, confirma que eres tú.</p>
        {bio && <button class="btn primary" onClick={tryBio}><Icon name="face" size={20} /> Usar Face ID</button>}
        <form onSubmit={submit}>
          <input type="password" placeholder="Contraseña" aria-label="Contraseña para entrar a los ajustes" autocomplete="current-password"
            value={pw} onInput={(e) => setPw(e.currentTarget.value)} />
          <button class={`btn ${bio ? 'ghost' : 'primary'}`} type="submit" disabled={!pw || busy}>{busy ? 'Verificando…' : 'Entrar'}</button>
        </form>
        {err && <p class="msg err">{err}</p>}
      </section>
    </div>
  );
}

export function PrivacyButton({ small }) {
  const st = useStore();
  const on = st.privacy === 'data' || st.privacy === 'all';
  return (
    <button class={`round ${small ? 'sm' : ''} ${on ? 'priv-on' : ''}`} onClick={() => set({ sheet: { type: 'privacy' } })}
      aria-label={on ? `Privacidad: ${st.privacy === 'all' ? 'ocultar todo' : 'ocultar datos'}` : 'Privacidad'}>
      <Icon name={on ? 'eyeoff' : 'eye'} size={small ? 19 : 21} />
      {st.privacy === 'all' && <i class="priv-badge" />}
    </button>
  );
}

/**
 * Cambiar de modo exige confirmar la identidad: Face ID (si está activo) o la contraseña.
 * Sin bloqueo configurado no hay con qué confirmar, así que el cambio es directo.
 */
export function PrivacyChoice() {
  const st = useStore();
  const cur = ['data', 'all'].includes(st.privacy) ? st.privacy : 'off';
  const [pending, setPending] = useState(null);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = st.lock?.v === 2;
  const bio = hasBiometric(st.lock);
  // Quien acaba de confirmar su identidad puede seguir en la pantalla donde está (p. ej. Ajustes)
  const apply = (v) => { set({ privacy: v, settingsAuth: true, finCfgAuth: true }); setPending(null); setPw(''); setErr(''); };

  const tryBio = async (v) => {
    setErr('');
    try {
      await confirmBiometric();
      apply(v);
    } catch {
      setErr('No se pudo verificar con Face ID. Usa tu contraseña.');
    }
  };
  // El toque en la opción cuenta como gesto: Face ID se puede pedir de inmediato
  const pick = (v) => {
    if (v === cur) return;
    if (!locked) return apply(v);
    setPending(v);
    setPw('');
    setErr('');
    if (bio) tryBio(v);
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    const ok = await checkPassword(pw);
    setBusy(false);
    if (ok) apply(pending);
    else {
      setPw('');
      setErr(Date.now() < (getState().lock?.until || 0) ? 'Demasiados intentos. Espera un momento.' : 'Contraseña incorrecta.');
    }
  };

  return (
    <div class="priv-opts">
      {PRIVACY.map(([v, l, d]) => (
        <button key={v} class={`priv-opt ${cur === v ? 'on' : ''} ${pending === v ? 'pending' : ''}`} onClick={() => pick(v)}>
          <Icon name={v === 'off' ? 'eye' : 'eyeoff'} size={20} />
          <span><b>{l}</b><small>{d}</small></span>
          {cur === v && <Icon name="check" size={18} />}
        </button>
      ))}
      {pending && (
        <form class="priv-auth" onSubmit={submit}>
          <p class="fine inline">Confirma que eres tú para cambiar a «{PRIVACY.find((p) => p[0] === pending)[1]}».</p>
          {bio && <button type="button" class="btn ghost" onClick={() => tryBio(pending)}><Icon name="face" size={18} /> Usar Face ID</button>}
          <input type="password" placeholder="Contraseña" aria-label="Contraseña para cambiar la privacidad" autocomplete="current-password"
            value={pw} onInput={(e) => setPw(e.currentTarget.value)} />
          {err && <p class="msg err">{err}</p>}
          <div class="sheet-actions">
            <button type="button" class="btn ghost" onClick={() => { setPending(null); setErr(''); }}>Cancelar</button>
            <button type="submit" class="btn primary" disabled={!pw || busy}>{busy ? 'Verificando…' : 'Confirmar'}</button>
          </div>
        </form>
      )}
      {!locked && <p class="fine inline">Activa el bloqueo con contraseña para que cambiar este modo pida Face ID o contraseña.</p>}
    </div>
  );
}

export function PrivacyDialog() {
  const close = () => set({ sheet: null });
  return (
    <div class="sheet-wrap center" onClick={close}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Privacidad</h2>
        <PrivacyChoice />
        <p class="fine inline">Se mantiene hasta que lo cambies, también al cerrar la app. Ajustes siempre se ve completo.</p>
        <button class="btn primary" onClick={close}>Listo</button>
      </div>
    </div>
  );
}
