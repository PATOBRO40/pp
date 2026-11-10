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
| `src/model.js` | Categorías, topes compartidos y migración de ajustes |
| `src/stats.js` | Estadísticas diarias y semanales |
| `src/db.js` | IndexedDB (sesiones, ajustes, metadatos) |
| `src/store.js` | Estado global; guarda solo los cambios en IndexedDB |
| `src/backup.js` | Exportar e importar JSON |
| `src/lock.js` | Bloqueo de entrada: contraseña, Face ID y pantalla de privacidad |
| `src/vault.js` | Cifrado AES-GCM de sesiones, ajustes y Dinero; respaldos cifrados |
| `src/fin/` | Dinero: lectura de extractos (`statements.js`, `pdf.js`), clasificación (`classify.js`), cálculos (`stats.js`) |
| `src/pwa.js` | Registro del service worker y actualizaciones |
| `src/sw-template.js` | Service worker; `vite.config.js` le añade versión y lista de archivos |
| `src/screens/`, `src/components/` | Interfaz |
| `scripts/make-icons.mjs` | Regenera los íconos de `public/icons/` |

## Cómo funciona el tiempo

Cada sesión guarda `start` y `end` en milisegundos (`end: null` si está activa). No hay contadores: lo transcurrido siempre es `Date.now() - start`, así que cerrar la app o bloquear el teléfono no altera nada.

Una sesión que cruza la medianoche es un solo registro. Se reparte entre días y semanas al calcular, nunca al guardar.

## Categorías y topes

Cada categoría puede tener un **tope propio** (horas por semana) y estar en varios **topes compartidos**, que suman el tiempo de sus categorías. Por defecto:

| Tope compartido | Horas | Categorías |
| --- | --- | --- |
| Ensoñaciones | 20 | Ensoñaciones con IA, Ensoñaciones sin IA |
| Entretenimiento | 30 | Videojuegos (21), Series (21) |
| Uso de IA | 25 | Ensoñaciones con IA, Uso recreativo de IA (15) |

Proyectos tiene un tope propio de 10 h. Todo se edita en Ajustes; archivar oculta una categoría y conserva su historial, y eliminarla borra también sus sesiones.

Los ajustes de la versión anterior se migran solos (`migrateSettings`): un grupo con una sola categoría pasa a ser su tope propio.

## Respaldo

Los datos viven solo en el almacenamiento de la app instalada, que es independiente del de Safari. Si se borra la app, se borran los datos. Exporta desde **Ajustes → Datos y respaldo**; la app lo recuerda cada 7 días.

Formato: `{ app: "PP", schema: 2, exportedAt, settings, sessions }`. Si cambia la estructura, sube `schema` y añade la migración en `parseBackup`.

## Bloqueo y cifrado

Opcional, en **Ajustes → Seguridad**. Al activarlo, sesiones y ajustes se guardan **cifrados** (AES-GCM de 256 bits) en la clave `vault` de IndexedDB, y se borra la copia en claro.

- Una clave maestra aleatoria cifra los datos. Se guarda envuelta con la contraseña (PBKDF2-SHA256, 310 000 iteraciones) y, si Face ID está activo, con el secreto de la extensión PRF de WebAuthn (requiere iOS 18 o posterior).
- Al bloquear, la clave y los datos se borran de la memoria. En claro solo quedan el tema y el estilo (`meta.ui`), para dibujar la pantalla de bloqueo.
- La configuración está en la clave `lock` y no entra en los respaldos. Los respaldos JSON van **sin cifrar**.
- Sin servidor no hay recuperación: si se olvida la contraseña y no hay Face ID, entrar exige borrar sesiones y ajustes.
- Un bloqueo de la versión 1.2–1.3 (solo hash, datos en claro) se migra al entrar con la contraseña. Face ID hay que volver a activarlo.
- Al salir de la app, una pantalla de privacidad tapa el contenido para que la captura del selector de apps de iOS no muestre datos.

La credencial de Face ID depende del dominio. Si la app cambia de dirección, hay que volver a activarla.

## Dinero

Pestaña opcional que **solo funciona con el bloqueo activo**: sus datos viajan dentro del cifrado. Mientras haya datos de Dinero, el bloqueo no se puede quitar.

- **Importar extractos** mensuales en PDF de Nequi y Nu. pdf.js va incluido en la app y el archivo se lee en el teléfono: nunca se envía ni se conserva. Cada lector comprueba que los movimientos cuadren con el resumen del extracto. Reimportar no duplica nada.
- **Solo se guarda** fecha, descripción, valor y cuenta, más el nombre del titular para reconocer las transferencias propias. No se guardan cédula, dirección, correo ni números de cuenta.
- **Clasificación automática**, recalculada siempre a partir de reglas editables en Dinero → Configurar. El orden de prioridad es:
  1. Corrección manual del movimiento.
  2. Lo recordado para esa persona o comercio.
  3. Transferencias propias, que se emparejan entre cuentas y no cuentan.
  4. Reversos, que anulan su compra.
  5. Rangos por monto para pagos a personas.
  6. QR pequeños.
  7. Comercios por texto.
- **Rangos por defecto** para pagos a personas:
  - Menos de $6.000: consumo básico mínimo.
  - $6.000 a $8.000: transporte.
  - $8.001 a $9.000: transporte, para revisar.
  - $9.001 a $10.000: transporte, confianza baja.
  - Más de $10.000: consumo básico medio.
- **Recargas desde otro banco**: por defecto son dinero propio y no cuentan como ingreso. Los ingresos fijos se configuran aparte.
- **Montos** en centavos enteros. **Fechas** como `AAAA-MM-DD`. El mes puede empezar cualquier día.

**Ahorro.** Muestra los saldos al cierre de cada mes con extracto, navegables por mes. Si falta el extracto de un banco ese mes, se usa el último saldo conocido y se marca. También incluye:

- La evolución por cuenta (3, 6 o 12 meses, o todo).
- El crecimiento y su origen: ingresos menos gastos y rendimientos.
- La tasa de ahorro, el mejor mes y el historial.

Rendimientos:

- **Nu:** los extractos importados desde la 1.6 guardan aparte el de las cajitas y el de la cuenta; los anteriores muestran el total.
- **CDT:** se mide por el crecimiento de su saldo, porque el PDF trae un acumulado.

Respaldos: **Exportar** ofrece cifrado con contraseña (recomendado, AES-GCM + PBKDF2) o sin cifrar. El esquema 3 incluye `fin`.

La versión compilada lleva una política CSP en `index.html` (`vite.config.js`): solo recursos propios y ninguna conexión externa.

**Nunca subas extractos reales al repositorio:** `Extractos financieros/` y `*.pdf` están en `.gitignore`.

## Privacidad en pantalla

Con el ojo de cada pantalla, o en **Ajustes → Privacidad en pantalla**, hay tres modos:

| Modo | Qué tapa |
| --- | --- |
| Mostrar todo | Nada |
| Ocultar datos | Tiempos, montos, porcentajes y horas |
| Ocultar todo | Además, los nombres de categorías, personas y comercios, y sus íconos |

- Se guarda como ajuste (`privacy`) y sigue activo hasta cambiarlo.
- Cambiar de modo exige confirmar con Face ID (se pide al tocar la opción) o con la contraseña. Usa el mismo límite de intentos que la entrada. Sin bloqueo configurado, el cambio es directo.
- No aplica en Ajustes ni en Dinero → Configurar.
- **Ajustes y Dinero → Configurar quedan protegidos** mientras haya un modo de ocultar activo y bloqueo configurado: piden Face ID o la contraseña. Face ID se pide al tocar la pestaña o el engranaje. La autorización dura hasta salir de esa pantalla (`settingsAuth` y `finCfgAuth`, que no se guardan) y se retira al bloquear la app.
- Se implementa con CSS sobre `html[data-privacy]`: el texto sigue en el DOM pero no se ve. Es para que nadie lo lea de reojo, no es un cifrado.

## Publicar cambios

Cada `git push` a `main` despliega con `.github/workflows/deploy.yml`. La app detecta la versión nueva y ofrece **Actualizar**; también se puede buscar desde **Ajustes → Acerca de**.
