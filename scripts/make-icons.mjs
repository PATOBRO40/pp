// Genera los íconos PNG (sin dependencias). Uso: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) rgb.copy(raw, y * stride + 1, y * size * 3, (y + 1) * size * 3);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Forma en coordenadas unitarias: una "P" clara y un punto turquesa (el "cronómetro")
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
function glyph(x, y) {
  if (inRect(x, y, 0.33, 0.25, 0.45, 0.75)) return 1; // asta
  if (inRect(x, y, 0.33, 0.25, 0.5, 0.37)) return 1;  // barra superior
  if (inRect(x, y, 0.33, 0.47, 0.5, 0.59)) return 1;  // barra media
  const dx = x - 0.5, dy = y - 0.42, d = Math.hypot(dx, dy);
  if (dx >= 0 && d <= 0.17 && d >= 0.05) return 1;    // panza
  if (Math.hypot(x - 0.69, y - 0.71) <= 0.05) return 2; // punto
  return 0;
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function render(size) {
  const buf = Buffer.alloc(size * size * 3);
  const SS = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
          const t = Math.min(1, Math.max(0, (x + y) / 2));
          let col = mix([52, 42, 128], [10, 12, 18], Math.pow(t, 0.8)); // fondo violeta -> noche
          const g = Math.max(0, 1 - Math.hypot(x - 0.3, y - 0.25) / 0.6); // resplandor
          col = mix(col, [143, 123, 255], g * g * 0.35);
          const k = glyph(x, y);
          if (k === 1) col = [242, 243, 248];
          if (k === 2) col = [53, 216, 192];
          acc = acc.map((v, i) => v + col[i]);
        }
      }
      const o = (py * size + px) * 3;
      for (let i = 0; i < 3; i++) buf[o + i] = Math.round(acc[i] / (SS * SS));
    }
  }
  return buf;
}

mkdirSync('public/icons', { recursive: true });
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(`public/icons/${name}`, png(size, render(size)));
  console.log('ok', name);
}
