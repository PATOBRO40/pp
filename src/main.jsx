import { render } from 'preact';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/fraunces';
import './styles.css';
import { App } from './App.jsx';
import { init } from './store.js';
import { registerSW } from './pwa.js';
import { initAutoLock } from './lock.js';

render(<App />, document.getElementById('app'));
init();
registerSW();
initAutoLock();
