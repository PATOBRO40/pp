// Modo de privacidad global: ocultar cifras, u ocultar también nombres e íconos.
// Se guarda en los ajustes y sigue activo hasta que lo desactives. No aplica en Ajustes.
import { Icon } from './Icon.jsx';
import { getState, set, useStore } from '../store.js';

export const PRIVACY = [
  ['off', 'Mostrar todo', 'Cifras, nombres y categorías a la vista.'],
  ['data', 'Ocultar datos', 'Tapa tiempos, montos, porcentajes y horas. Las categorías se ven.'],
  ['all', 'Ocultar todo', 'Tapa también los nombres de categorías, personas y comercios, y sus íconos.'],
];

/** ¿Hay que ocultar montos? (Dinero los formatea como $ ••••) */
export const HIDE = () => getState().privacy === 'data' || getState().privacy === 'all';

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

export function PrivacyChoice() {
  const st = useStore();
  const cur = ['data', 'all'].includes(st.privacy) ? st.privacy : 'off';
  return (
    <div class="priv-opts">
      {PRIVACY.map(([v, l, d]) => (
        <button key={v} class={`priv-opt ${cur === v ? 'on' : ''}`} onClick={() => set({ privacy: v })}>
          <Icon name={v === 'off' ? 'eye' : 'eyeoff'} size={20} />
          <span><b>{l}</b><small>{d}</small></span>
          {cur === v && <Icon name="check" size={18} />}
        </button>
      ))}
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
