import { render } from 'preact';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/fraunces';
import './styles.css';
import { App } from './App.jsx';
import { init, receiveOrder, setLaunch, showMenuOnOpen } from './store.js';
import { parseOrder } from './orders.js';
import { registerSW } from './pwa.js';
import { initAutoLock } from './lock.js';

// Orden del atajo del Botón de Acción (?a=…&k=…): se lee y se quita de la dirección
// para que recargar la app no la repita.
// iOS puede descartar la consulta (?…): el enlace lleva además #menu como segunda señal.
const order = parseOrder(location.search);
const menuHash = location.hash === '#menu';
const receivedAt = Date.now();
setLaunch(location.href.replace(/k=[^&#]*/, 'k=…'), receivedAt); // diagnóstico (sin el código)
if (location.search || menuHash) history.replaceState(null, '', location.pathname);

render(<App />, document.getElementById('app'));
init().then(() => {
  if (order) receiveOrder(order, receivedAt);
  else if (menuHash) showMenuOnOpen(true);
  else showMenuOnOpen();
});
window.addEventListener('hashchange', () => {
  if (location.hash !== '#menu') return;
  history.replaceState(null, '', location.pathname);
  setLaunch('#menu (app ya abierta)', Date.now());
  showMenuOnOpen(true);
});
registerSW();
initAutoLock();
