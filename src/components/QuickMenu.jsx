// Menú «¿Qué haces ahora?» que se abre con el atajo del Botón de Acción.
// Con PP bloqueada usa la copia en claro de los nombres de las categorías (shortcut.menu)
// y la orden se guarda cifrada hasta el próximo desbloqueo.
import { Icon } from './Icon.jsx';
import { activeSession, chooseQuick, dataOpen, set, useStore } from '../store.js';
import { BG_OFF, BG_ON, STOP } from '../orders.js';
import { liveCats } from '../model.js';

export function QuickMenu() {
  const st = useStore();
  const open = dataOpen();
  const act = open ? activeSession(st) : null;
  const bgOn = open ? st.bg.some((x) => x.end == null) : null;
  const cats = open
    ? liveCats(st).map((c) => ({ label: c.name, color: c.color, on: act?.cat === c.id }))
    : (st.shortcut?.menu || []).map((c) => ({ ...c, on: false }));
  const close = () => set({ quickMenu: false });
  const opt = (label, extra = {}) => (
    <button key={label} class={`qm-opt ${extra.cls || ''} ${extra.on ? 'on' : ''}`} onClick={() => chooseQuick(label)}
      style={extra.color ? { '--c': `var(--p${extra.color})` } : undefined}>
      {extra.icon ? <Icon name={extra.icon} size={16} /> : <i class="qm-dot" />}
      <span>{extra.text || label}</span>
      {extra.on && <small>en curso</small>}
    </button>
  );
  return (
    <div class="sheet-wrap quick-menu" onClick={close}>
      <div class="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="¿Qué haces ahora?">
        <h2>¿Qué haces ahora?</h2>
        {!cats.length && <p class="msg info">Entra a PP una vez para cargar tus categorías en este menú.</p>}
        <div class="qm-list">
          {(!open || act) && opt(STOP, { icon: 'stop', cls: 'stop', text: 'Parar' })}
          {cats.map((c) => opt(c.label, { color: c.color, on: c.on }))}
          {bgOn !== true && opt(BG_ON, { icon: 'play', cls: 'bg', text: 'Iniciar IA en 2º plano' })}
          {bgOn !== false && opt(BG_OFF, { icon: 'stop', cls: 'bg', text: 'Parar IA en 2º plano' })}
        </div>
        <button class="btn ghost" onClick={close}>Cancelar</button>
      </div>
    </div>
  );
}
