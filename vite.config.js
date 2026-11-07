import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PUBLIC = ['manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

/** Genera dist/sw.js con la lista exacta de archivos y una versión que cambia con el contenido. */
function swPlugin() {
  return {
    name: 'pp-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const hash = createHash('md5');
      for (const f of files) hash.update(f + String(bundle[f].code ?? bundle[f].source ?? ''));
      for (const f of PUBLIC) hash.update(readFileSync(`public/${f}`));
      // index.html se añade a mano: puede no estar aún en el bundle en este punto
      const assets = [...new Set(['./', './index.html', ...files.map((f) => './' + f), ...PUBLIC.map((f) => './' + f)])];
      const head = `const VERSION = ${JSON.stringify(hash.digest('hex').slice(0, 10))};\nconst ASSETS = ${JSON.stringify(assets)};\n`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: head + readFileSync('src/sw-template.js', 'utf8') });
    },
  };
}

// base './' permite desplegar en GitHub Pages (subruta /repo/) sin cambios.
export default defineConfig({
  plugins: [preact(), swPlugin()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: true, port: 5173 },
});
