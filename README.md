# bita-desktop

`bita` en la barra de menús de macOS: el tiempo que llevas corriendo, visible sin
abrir nada, y los cronómetros a un clic.

No sustituye al CLI, lo usa. Todo lo que ves aquí sale de `bita … --json`, así
que agrupar, redondear estimaciones y detectar solapes ocurre en un solo sitio y
no hay dos versiones de la verdad.

## Requisitos

**Node 24 o superior.** Es lo único que la app no puede resolver sola: el CLI de
bita corre `.ts` sin compilar y necesita `node:sqlite`.

```sh
node -v    # debe decir v24 o más
```

**El CLI no hace falta tenerlo instalado.** La app trae una copia dentro y
arranca con ella. Si lo tienes instalado, usa el tuyo.

## Instalación

Por ahora se compila en local; no hay releases.

### 1. Toolchain

```sh
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Reinicia la terminal después de instalar Rust.

### 2. Clonar

```sh
git clone --recurse-submodules git@github.com:KikeDeAlba/bita-desktop.git
cd bita-desktop
pnpm install
```

El `--recurse-submodules` importa: `vendor/bita` es el CLI que viaja dentro de la
app. Si ya clonaste sin él:

```sh
git submodule update --init --depth 1
```

### 3. Compilar

```sh
pnpm tauri build --bundles app
cp -R src-tauri/target/release/bundle/macos/bita.app /Applications/
open /Applications/bita.app
```

La primera compilación baja y construye unos 500 crates: entre cinco y quince
minutos. Las siguientes, un minuto.

El `.app` va firmado **ad hoc**, que es lo que evita el diálogo de «está dañada»
al moverlo. No está notarizado, así que en otro Mac habrá que abrirlo la primera
vez desde Ajustes → Privacidad y seguridad.

No hay icono en el Dock ni ventana: vive en la barra de arriba. Para cerrarlo,
clic derecho en el icono → **Salir de bita**.

## Qué hace

| Pestaña | Qué enseña |
|---|---|
| **Ahora** | Los cronómetros vivos con su segundero. Arrancar, parar, y nombrar un borrador |
| **Hoy** | Lo trabajado hoy o esta semana, por tarea, con su estimación y sus solapes |
| **Jira** | Lo que sigue sin registrar. Solo lectura |
| **Repos** | Las rutas que resuelven a cada proyecto, y el catálogo de proyectos |

Y una **ventana aparte** para leer las notas, que se abre con el icono de
documento de la barra o con «Ver nota» en la tarjeta del cronómetro.

Dos cosas del dominio que la interfaz intenta hacer evidentes:

- Un **borrador** es un cronómetro sin título. Arranca vacío y se va rellenando
  solo durante la sesión de Claude Code. Va punteado, no en rojo: es un estado
  normal, y mientras siga sin nombre no puede llegar a Jira.
- **Trabajado → estimado**, siempre en ese orden. Las dos cifras van a Jira, pero
  a campos distintos: lo trabajado es el worklog y lo redondeado es la estimación
  original. El redondeo sube a la media hora siguiente **por tarea**, así que el
  total del día es la suma de estimaciones ya redondeadas, nunca el redondeo de
  la suma.

## Desarrollo

```sh
pnpm tauri dev      # la app, con recarga del panel
pnpm typecheck      # el frontend
pnpm measure        # mide el panel en WebKit y falla si algo se sale
cargo test          # desde src-tauri/
```

`pnpm measure` existe porque un panel roto se veía igual de bien en el código
que en la revisión: `.bar` estaba declarada dos veces —la cabecera y la barra de
estimación de los grupos— y la segunda aplastaba la cabecera de 44 px a 4,
dejando el título medio fuera. Carga el `dist` en un WKWebView de 380x520, mide
las cajas y sale con error si alguna empieza por encima del panel o no mide lo
que debe.

**Nunca contra la base real.** `BITA_DB_PATH` apunta la app a una copia:

```sh
cp ~/.local/share/bita/bita.db /tmp/bita-dev.db
cp -R ~/.local/share/bita/docs /tmp/bita-dev-docs
BITA_DB_PATH=/tmp/bita-dev.db BITA_DOCS_DIR=/tmp/bita-dev-docs pnpm tauri dev
```

Los documentos van aparte porque la ventana de notas también lee de ahí.

| Variable | Para qué |
|---|---|
| `BITA_DB_PATH` | Usar otra base de datos |
| `BITA_NODE` | Forzar un binario de node concreto |
| `BITA_CLI` | Forzar un CLI concreto en vez de buscarlo |
| `BITA_DOCS_DIR` | Usar otro directorio de documentos; se le pasa al CLI como `--docs-dir` |
| `BITA_KEEP_PANEL` | Abre el panel al arrancar y evita que se esconda al perder el foco, para poder usar las devtools |
| `BITA_NO_OPEN_NOTES` | No abre la ventana de documentación al arrancar; deja solo el icono del tray |
| `BITA_KEEP_ACCESSORY` | No cambia la activation policy al abrir las notas: sin icono en el Dock ni barra de menús |
| `BITA_EDITOR` | Qué binario abre un `.md` en vez de dejárselo a `open` |

## Cómo habla con el CLI

Un subproceso por consulta, siempre con `--json`, y una sola línea de stdout que
se parsea entera:

```json
{ "schemaVersion": 3, "ok": true, "command": "current", "data": [], "meta": {} }
```

El error se detecta por `ok: false`, nunca por el código de salida. stderr es
diagnóstico y se ignora.

Tres decisiones que no son obvias y que están ahí a propósito:

**El reloj no se le pide al CLI.** Se lee `started_at` una vez y la cuenta la
lleva Rust contra el reloj de pared, que sobrevive a que el Mac se duerma. Tiene
que ser así de todas formas: macOS congela los timers de JavaScript cuando la
ventana está oculta, y el título de la barra tiene que seguir avanzando.

**Los subprocesos corren desde `/`.** Desde un repositorio git que no resuelve a
ningún proyecto, el CLI devuelve `REPO_NOT_MAPPED`; desde `/` no hay repo, así
que devuelve «sin proyecto» y el cronómetro en blanco es legal.

**node se busca, no se hereda.** Una app lanzada desde Finder recibe
`/usr/bin:/bin:/usr/sbin:/sbin` y nada más, así que un node de nvm o fnm es
invisible. Se sondean las rutas conocidas, de la versión más nueva a la más
vieja, y a cada candidato se le pregunta su propia versión.

## Cómo se entera de los cambios

FSEvents vigila el **directorio** de la base de datos, no el fichero: en modo WAL
las escrituras van a `bita.db-wal`, que SQLite borra y recrea, y un watch clavado
a un inodo perdería su objetivo.

Los eventos por sí solos se retroalimentarían, porque las lecturas de la propia
app también mueven el directorio. Por eso cada tanda se contrasta con el `mtime`
y el tamaño de `bita.db`, y solo una diferencia real dispara un refresco. Medido
contra el CLI: abre y cierra la base una vez por comando, así que **una lectura
deja el fichero intacto y toda escritura hace checkpoint al cerrar y mueve el
`mtime`**.

Como red de seguridad hay además un sondeo cada treinta segundos, porque FSEvents
pierde eventos cuando el equipo se suspende.

Los `.md` necesitan su propio vigilante. El de la base mira `dirname(db)` sin
recursión y descarta toda tanda que no mueva el fingerprint de `bita.db`; los
documentos viven tres niveles más abajo, así que no llegaban eventos. El segundo
vigilante es recursivo sobre el directorio de documentos, con rebote de 400 ms y
filtrando a extensión `.md`. No hay bucle de realimentación: la app nunca escribe
un `.md`, solo los lee a través del subproceso del CLI, y leer no mueve el
`mtime`.

## La ventana de notas

El panel mide 380×520 y no es redimensionable, así que un documento de siete
secciones no cabe. Las notas viven en una ventana propia de 960×640, de solo
lectura: escribir sigue siendo del CLI, que es quien tiene el lock cooperativo.

Se abre junto con la app, y `BITA_NO_OPEN_NOTES` lo suprime. Aun así se construye
desde Rust en vez de declararla en `tauri.conf.json`: una ventana declarada se
crea siempre, con lo que esa variable no podría evitarla, y el panel del tray
seguiría arrastrando un segundo webview en los arranques en los que no se quiere.
Al cerrarla se esconde en lugar de destruirse, así que reabrirla es inmediato.

Lleva su propio HTML (`notas.html`) y no una rama dentro de `index.html`, porque
`scripts/measure-panel.swift` carga `index.html` en un WKWebView pelado, sin IPC
de Tauri: una rama sobre `getCurrentWindow()` dejaría al test midiendo algo
indeterminado. Rollup comparte `dom`, `format` y `bita` entre los dos bundles.

Mientras está abierta, macOS pasa de `Accessory` a `Regular`. Sin eso la app no
tiene barra de menús —y por tanto no hay cmd+C nativo sobre una selección— ni se
puede recuperar la ventana con cmd+Tab. El menú son items predefinidos en
español, que es de donde salen cmd+W, cmd+C y cmd+A sin una línea de JavaScript.

El markdown se pinta con un renderizador propio de unas 250 líneas que construye
nodos con `element()`. No es por el peso: `marked` y `markdown-it` devuelven un
string de HTML, lo que obliga a `innerHTML` sobre contenido leído de ficheros, y
sanearlo bien exige una segunda dependencia. Construyendo nodos no hay nada que
escapar, porque el escapado es estructural. Lo que la gramática no reconoce se
emite como párrafo literal: nunca se pierde contenido. Las tablas GFM salen como
`<table>` de verdad por la misma vía, y cada celda pasa por el mismo paso en
línea, así que los enlaces y el resaltado de la búsqueda funcionan dentro.

## Los diagramas

Un cercado ` ```mermaid ` se dibuja con mermaid, que es **la única dependencia
que acaba dentro del bundle** además de `@tauri-apps/api`. Se carga con un
`import()` dinámico sólo cuando la página tiene uno, así que vive en un chunk
aparte y el arranque no lo paga: el bundle de la ventana pasa de 24 a 30 kB, y
el megabyte largo de mermaid sólo se descarga si hace falta.

`mermaid.render()` devuelve una **cadena** de SVG. No se inyecta con
`innerHTML`: se parsea con `DOMParser` en modo `image/svg+xml`, que es inerte, se
le quitan `script`, `foreignObject`, los atributos `on*` y cualquier `href` que
no sea interno, y se adopta el nodo. La regla de no usar `innerHTML` sigue en
pie.

Va dentro de un `shadow root` porque los selectores de mermaid (`.node rect`,
`.edgePath path`) se filtrarían al CSS del lector. La CSP **no se toca**:
`style-src 'unsafe-inline'` ya estaba concedido, que es lo único que mermaid
necesita. `securityLevel: 'strict'` y `htmlLabels: false` cierran el resto, y
`theme: 'base'` es obligatorio y no preferencia, porque el tema por defecto ha
emitido `@import` de Google Fonts y aquí `font-src 'self'` lo bloquearía.

Un diagrama que no compila no puede tumbar el lector: cae al bloque de código
con el motivo. Hay tope de 20 KB de fuente y 20 diagramas por página.

## Dónde se coloca el panel

La vertical **no** sale del rectángulo del icono del tray, sale de
`NSScreen.visibleFrame`. La diferencia importa: en un MacBook con notch la barra
de menús mide 39 pt en vez de los 24 de siempre, y colocar el panel contando 24
lo mete media cabecera por debajo de la barra. `visibleFrame` es la única fuente
que sabe cuánto mide de verdad.

Del icono sale solo la horizontal, y va acotada a la pantalla para que un tray
pegado al borde derecho no empuje el panel fuera.

## Estructura

```
src/            el panel: TypeScript, sin framework
src/notes/      la ventana de notas: carril, lector, markdown
src-tauri/      el backend: tray, estado, subprocesos, vigilancia
vendor/bita/    el CLI, como submódulo fijado
```

## Lo que falta

**El panel roba el foco al abrirse.** Es una ventana normal de Tauri, así que
mostrarla activa la app y la que estuvieras usando lo pierde. Lo correcto es un
`NSPanel` con el estilo `nonactivating`, que es lo que hace `tauri-nspanel`; la
migración es casi mecánica pero cambia cómo se muestra el panel, así que quedó
fuera hasta poder comprobarla a ojo.
