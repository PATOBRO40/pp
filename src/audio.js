// Sonidos sutiles (WebAudio). iOS solo permite audio tras un gesto del usuario
// y no suena con el interruptor de silencio activado.
let ctx;

function tone(freq, at, dur, vol = 0.05) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
  g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + at);
  o.stop(ctx.currentTime + at + dur + 0.05);
}

export function beep(kind) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (kind === 'start') { tone(523, 0, 0.14); tone(784, 0.09, 0.2); }
    else if (kind === 'stop') { tone(784, 0, 0.14); tone(523, 0.09, 0.22); }
    else if (kind === 'warn') { tone(660, 0, 0.12); tone(660, 0.18, 0.12); }
    else if (kind === 'over') { tone(440, 0, 0.16); tone(330, 0.2, 0.28); }
  } catch { /* sin audio: no pasa nada */ }
}
