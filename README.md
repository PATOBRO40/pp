# PP

PWA personal de seguimiento de tiempo y finanzas para iPhone. Categorías configurables, topes semanales propios y compartidos, registro, estadísticas y módulo opcional **Dinero** a partir de extractos en PDF de Nequi y Nu. Todo se guarda en el dispositivo: no hay backend ni cuentas.

Zona horaria: America/Bogota. La semana empieza el lunes.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173 y por la red local
npm run build      # genera dist/ (incluye sw.js)
npm run preview    # sirve dist/ en http://localhost:4173
npm run test:unit  # pruebas unitarias (datos sintéticos en tests/)
npm run test:e2e   # pruebas en Edge 393×852 con WebAuthn virtual
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
| `src/orders.js` | Órdenes del atajo del Botón de Acción, IA en 2º plano y recorte al máximo por sesión (lógica pura) |
| `src/inbox.js` | Buzón cifrado (RSA-OAEP) de órdenes recibidas con PP bloqueada |
| `src/vault.js` | Cifrado AES-GCM de sesiones, ajustes y Dinero; respaldos cifrados |
| `src/fin/` | Dinero: lectura de extractos (`statements.js`, `pdf.js`), clasificación (`classify.js`), cálculos (`stats.js`) |
| `src/pwa.js` | Registro del service worker y actualizaciones |
| `src/sw-template.js` | Service worker; `vite.config.js` le añade versión y lista de archivos |
| `src/screens/`, `src/components/` | Interfaz |
| `scripts/make-icons.mjs` | Regenera los íconos de `public/icons/` |

## Cómo funciona el tiempo

Cada sesión guarda `start` y `end` en milisegundos (`end: null` si está activa). No hay contadores: lo transcurrido siempre es `Date.now() - start`, así que cerrar la app o bloquear el teléfono no altera nada.

Una sesión que cruza la medianoche es un solo registro. Se reparte entre días y semanas al calcular, nunca al guardar.

**Máximo por sesión (recorte automático).** Cada categoría puede tener un máximo en horas (`max`; `null` = sin máximo). Si una sesión lo pasa sin que se pare, PP la cierra en inicio + máximo, la marca con `cut` y en Inicio pide revisarla: dejar el recorte, «era real» (hasta ahora o hasta la siguiente sesión) o elegir la hora de fin. Por defecto: Con IA 2 h, Sin IA 1 h, IA recreativa 2 h, Videojuegos 3 h, Series 3 h, Proyectos 4 h.

**IA en 2º plano.** Pista aparte (`bg`, sesiones `{id, cat: 'bg', start, end}`) para el tiempo en que la IA trabaja mientras haces otra cosa. Corre junto a cualquier categoría, cambiar de categoría no la cierra y **no cuenta en topes**; en Inicio se ve su tiempo de hoy y de la semana. Su máximo por sesión es `bgMax` (4 h por defecto).

## Atajo del Botón de Acción

El atajo de iOS tiene una sola acción, «Abrir URL», con el enlace que se copia en **Ajustes → Atajo del Botón de Acción**: `webapp://<host>/pp/?k=<código>&a=menu` (con `webapp://` iOS abre la app instalada y no el navegador). El enlace es `webapp://<host>/pp/?k=<código>&a=menu#menu`: si iOS descarta la consulta, la señal `#menu` hace que PP muestre el menú **«¿Qué haces ahora?»** (`QuickMenu`). Abrir PP normalmente no lo muestra, salvo que se active «Menú también al abrir PP» en Ajustes (`shortcut.openMenu`). Ajustes muestra la «Última apertura» de PP para diagnosticar qué llega desde el atajo. El menú ofrece: Parar, las categorías activas e iniciar o parar la IA en 2º plano. También acepta una opción directa en `a` (`⏹ Parar`, el nombre de una categoría, `▶ IA en 2º plano`, `⏹ IA en 2º plano`) con `t=<hora ISO>` opcional.

- Para mostrar el menú con PP bloqueada, los nombres y colores de las categorías activas se guardan **sin cifrar** en kv `shortcut.menu`. Los tiempos y sesiones siguen cifrados.

- Elegir otra categoría para la actual y empieza la nueva en el mismo instante; elegir la que ya está activa no hace nada.
- `k` es un código secreto (kv `shortcut`) para que una página web no pueda mandar órdenes. Se puede cambiar.
- PP lee la orden al arrancar y la quita de la dirección para que recargar no la repita.
- **Con PP bloqueada** la orden se cifra con una clave pública RSA-OAEP y se guarda en kv `inbox`; la clave privada vive dentro de `vault`. Al entrar se aplican todas con su hora (recortando antes lo que hubiera pasado su máximo) y se borran. La pantalla de bloqueo confirma la orden; con un modo de ocultar activo no muestra la categoría.

## Categorías y topes

Cada categoría puede tener un **tope propio** (horas por semana) y estar en varios **topes compartidos**, que suman el tiempo de sus categorías. Por defecto:

| Tope compartido | Horas | Categorías |
| --- | --- | --- |
| Ensoñaciones | 20 | Ensoñaciones con IA, Ensoñaciones sin IA |
| Entretenimiento | 30 | Videojuegos (21), Series (21) |
| Uso de IA | 25 | Ensoñaciones con IA, Uso recreativo de IA (15) |

Proyectos tiene un tope propio de 10 h. Todo se edita en Ajustes; archivar oculta una categoría y conserva su historial, y eliminarla borra también sus sesiones.

Los ajustes de versiones anteriores se migran solos (`migrateSettings`): en la v2 un grupo con una sola categoría pasa a ser su tope propio, y en la v3 se añaden el máximo por sesión y `bgMax`.

## Respaldo

Los datos viven solo en el almacenamiento de la app instalada, que es independiente del de Safari. Si se borra la app, se borran los datos. Exporta desde **Ajustes → Datos y respaldo**; la app lo recuerda cada 7 días.

Formato: `{ app: "PP", schema: 3, exportedAt, settings, sessions, bg?, fin? }`. Si cambia la estructura, sube `schema` y añade la migración en `parseBackup`. Los respaldos pueden exportarse cifrados con contraseña (recomendado, AES-GCM + PBKDF2) o en claro; al importar se validan estructura, rangos y valores permitidos, y en modo «Combinar» se conservan también las categorías faltantes referenciadas.

## Bloqueo y cifrado

Opcional, en **Ajustes → Seguridad**. Al activarlo, sesiones, ajustes y Dinero se guardan **cifrados** (AES-GCM de 256 bits) en la clave `vault` de IndexedDB, y se borra la copia en claro.

- Una clave maestra aleatoria cifra los datos. Se guarda envuelta con la contraseña (PBKDF2-SHA256, 310 000 iteraciones) y, si Face ID está activo, con el secreto de la extensión PRF de WebAuthn (requiere iOS 18 o posterior).
- Al bloquear, la clave, los datos y la caché de clasificación se borran de la memoria. En claro solo quedan el tema, el estilo y el modo de privacidad (`meta.ui`), para dibujar la pantalla de bloqueo, y el código y la clave pública del atajo (`shortcut`).
- La configuración está en la clave `lock` y no entra en los respaldos.
- El guardado pendiente se vuelca antes de pasar a segundo plano o actualizar, y el bloqueo inmediato «Al salir» pausa brevemente mientras están abiertos el selector de archivos o la hoja de compartir de iOS.
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
  2. Reversos, que anulan su compra anterior del mismo monto.
  3. Lo recordado para esa persona o comercio (`memo`).
  4. Transferencias propias, que se emparejan entre cuentas y no cuentan.
  5. Recargas desde otro banco.
  6. Intereses y rendimientos.
  7. Rangos por monto para pagos a personas.
  8. QR pequeños.
  9. Comercios por texto (o categoría por defecto si no hay regla).
- **Rangos por defecto** para pagos a personas:
  - Menos de $6.000: consumo básico mínimo.
  - $6.000 a $8.000: transporte.
  - $8.001 a $9.000: transporte, para revisar.
  - $9.001 a $10.000: transporte, confianza baja.
  - Más de $10.000: consumo básico medio.
- **Recargas desde otro banco**: por defecto cuentan como **ingreso** (`recargas: 'ingreso'`), y pueden cambiarse a dinero propio en Dinero → Configurar. Los ingresos fijos se configuran aparte.
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
- **Ajustes, Dinero → Configurar y hojas sensibles quedan protegidos** mientras haya un modo de ocultar activo y bloqueo configurado: piden Face ID o la contraseña (incluyendo editar/añadir sesión, reiniciar tiempo, detalle/registro de movimiento, importar extractos y exportar respaldo, también desde el aviso de Inicio). Face ID se pide al tocar el botón o pestaña. En Ajustes y Dinero → Configurar la autorización dura hasta salir de esa pantalla (`settingsAuth` y `finCfgAuth`, que no se guardan); en las hojas sensibles se pide cada vez y siempre se retira al bloquear la app.
- Se implementa con CSS sobre `html[data-privacy]`: el texto sigue en el DOM pero no se ve. Es para que nadie lo lea de reojo, no es un cifrado.

## Publicar cambios

Cada `git push` a `main` despliega con `.github/workflows/deploy.yml`. La app detecta la versión nueva y ofrece **Actualizar**; también se puede buscar desde **Ajustes → Acerca de**.
