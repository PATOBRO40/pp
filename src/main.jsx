import { render } from 'preact';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/fraunces';
import './styles.css';
import { App } from './App.jsx';
import { init, receiveOrder } from './store.js';
import { parseOrder } from './orders.js';
import { registerSW } from './pwa.js';
import { initAutoLock } from './lock.js';

// Orden del atajo del Botón de Acción (?a=…&k=…): se lee y se quita de la dirección
// para que recargar la app no la repita.
const order = parseOrder(location.search);
const receivedAt = Date.now();
if (location.search) history.replaceState(null, '', location.pathname + location.hash);

render(<App />, document.getElementById('app'));
init().then(() => { if (order) receiveOrder(order, receivedAt); });
registerSW();
initAutoLock();
