# PP

PWA personal de seguimiento de tiempo para iPhone. Tres categorías, topes semanales, registro y estadísticas. Todo se guarda en el dispositivo: no hay backend ni cuentas.

Zona horaria: America/Bogota. La semana empieza el lunes.

## Desarrollo

```bash
npm install
npm run dev       # http://localhost:5173 y por la red local
npm run build     # genera dist/ (incluye sw.js)
npm run preview   # sirve dist/ en http://localhost:4173
```

El service worker solo se registra en la versión compilada. Por `http://IP-local` no funciona: para probar instalación y modo sin conexión hace falta HTTPS (GitHub Pages).

## Estructura

| Archivo | Función |
| --- | --- |
| `src/time.js` | Límites de día y semana en Bogotá, división por medianoche, formatos |
| `src/stats.js` | Estadísticas diarias y semanales |
| `src/db.js` | IndexedDB (sesiones, ajustes, metadatos) |
| `src/store.js` | Estado global; guarda solo los cambios en IndexedDB |
| `src/backup.js` | Exportar e importar JSON |
| `src/pwa.js` | Registro del service worker y actualizaciones |
| `src/sw-template.js` | Service worker; `vite.config.js` le añade versión y lista de archivos |
| `src/screens/`, `src/components/` | Interfaz |
| `scripts/make-icons.mjs` | Regenera los íconos de `public/icons/` |

## Cómo funciona el tiempo

Cada sesión guarda `start` y `end` en milisegundos (`end: null` si está activa). No hay contadores: lo transcurrido siempre es `Date.now() - start`, así que cerrar la app o bloquear el teléfono no altera nada.

Una sesión que cruza la medianoche es un solo registro. Se reparte entre días y semanas al calcular, nunca al guardar.

## Respaldo

Los datos viven solo en el almacenamiento de la app instalada, que es independiente del de Safari. Si se borra la app, se borran los datos. Exporta desde **Ajustes → Datos y respaldo**; la app lo recuerda cada 7 días.

Formato: `{ app: "PP", schema: 1, exportedAt, settings, sessions }`. Si cambia la estructura, sube `schema` y añade la migración en `parseBackup`.

## Publicar cambios

Cada `git push` a `main` despliega con `.github/workflows/deploy.yml`. La app detecta la versión nueva y ofrece **Actualizar**; también se puede buscar desde **Ajustes → Acerca de**.
