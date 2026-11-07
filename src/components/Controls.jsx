// Controles compartidos por Ajustes y sus hojas.

export function Stepper({ value, onChange, step = 1, min = 0, max = 168, unit = '' }) {
  const clamp = (v) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  return (
    <div class="stepper">
      <button type="button" onClick={() => onChange(clamp(value - step))} aria-label="Menos">−</button>
      <input type="number" inputmode="decimal" value={value} step={step}
        onChange={(e) => { const v = parseFloat(e.currentTarget.value); if (!isNaN(v)) onChange(clamp(v)); }} />
      <span class="unit">{unit}</span>
      <button type="button" onClick={() => onChange(clamp(value + step))} aria-label="Más">+</button>
    </div>
  );
}

export function Toggle({ on, onChange }) {
  return <button type="button" class={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}><i /></button>;
}

export const Row = ({ label, hint, children }) => (
  <div class="set-row">
    <div class="set-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
    {children}
  </div>
);
