import { HOUR, fmtDur } from '../time.js';

/** Barra de tope semanal: verde/acento -> ámbar (>= umbral) -> rojo (> tope). */
export function capState(used, capMs, warnPct) {
  if (capMs <= 0) return 'none';
  const p = used / capMs;
  if (p > 1) return 'over';
  if (p >= warnPct / 100) return 'warn';
  return 'ok';
}

export function CapBar({ group, used, perCat, cats, warnPct, compact }) {
  const capMs = group.hours * HOUR;
  const state = capState(used, capMs, warnPct);
  const pct = capMs ? (used / capMs) * 100 : 0;
  const diff = capMs - used;
  const msg = state === 'over'
    ? `Te pasaste ${fmtDur(-diff)}`
    : `Quedan ${fmtDur(diff)}`;

  return (
    <div class={`cap ${state} ${compact ? 'compact' : ''}`}>
      <div class="cap-head">
        <span class="cap-name">{group.name}</span>
        <span class="cap-nums"><b>{fmtDur(used)}</b> / {group.hours} h</span>
      </div>
      <div class="cap-track" role="progressbar" aria-valuenow={Math.round(pct)}>
        <div class="cap-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
        <i class="cap-tick" style={{ left: `${warnPct}%` }} />
      </div>
      <div class="cap-split">
        {cats.map((c) => {
          const v = perCat[c.id] || 0;
          return v > 0 ? <span key={c.id} style={{ flex: v, background: `var(--p${c.color})` }} /> : null;
        })}
      </div>
      <div class="cap-foot">
        <span class="cap-msg">{state === 'over' ? '⚠ ' : ''}{msg}</span>
        <span class="cap-pct">{Math.round(pct)}%</span>
      </div>
    </div>
  );
}
