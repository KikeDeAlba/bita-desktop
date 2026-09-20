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
cargo test          # desde src-tauri/
```

**Nunca contra la base real.** `BITA_DB_PATH` apunta la app a una copia:

```sh
cp ~/.local/share/bita/bita.db /tmp/bita-dev.db
BITA_DB_PATH=/tmp/bita-dev.db pnpm tauri dev
```

| Variable | Para qué |
|---|---|
| `BITA_DB_PATH` | Usar otra base de datos |
| `BITA_NODE` | Forzar un binario de node concreto |
| `BITA_CLI` | Forzar un CLI concreto en vez de buscarlo |
| `BITA_KEEP_PANEL` | Que el panel no se esconda al perder el foco, para poder usar las devtools |

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

## Estructura

```
src/            el panel: TypeScript, sin framework
src-tauri/      el backend: tray, estado, subprocesos, vigilancia
vendor/bita/    el CLI, como submódulo fijado
```

## Lo que falta

**El panel roba el foco al abrirse.** Es una ventana normal de Tauri, así que
mostrarla activa la app y la que estuvieras usando lo pierde. Lo correcto es un
`NSPanel` con el estilo `nonactivating`, que es lo que hace `tauri-nspanel`; la
migración es casi mecánica pero cambia cómo se muestra el panel, así que quedó
fuera hasta poder comprobarla a ojo.
