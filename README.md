# bita-desktop

`bita` en la barra de menús de macOS: el tiempo que llevas corriendo, visible sin
abrir nada, y los cronómetros a un clic.

No sustituye al CLI, lo usa. Todo lo que ves aquí sale de `bita … --json`, así
que la lógica de dominio —agrupar, redondear estimaciones, detectar solapes—
vive en un solo sitio y no hay dos versiones de la verdad.

## Requisitos

**Node 24 o superior.** Es lo único que la app no puede resolver sola: el CLI de
bita corre `.ts` sin compilar y necesita `node:sqlite`.

```sh
node -v    # debe decir v24 o más
```

**El CLI de bita no hace falta tenerlo instalado.** La app trae una copia dentro
y arranca con ella. Si lo instalas, usa el tuyo.

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

El `--recurse-submodules` importa: `vendor/bita` es el CLI que se empaqueta
dentro de la app. Si ya clonaste sin él:

```sh
git submodule update --init --depth 1
```

### 3. Compilar

```sh
pnpm tauri build --bundles app
cp -R src-tauri/target/release/bundle/macos/bita.app /Applications/
```

La primera compilación baja y construye unos 500 crates: entre cinco y quince
minutos. Las siguientes son segundos.

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

## Cómo habla con el CLI

Un subproceso por consulta, siempre con `--json`, y una sola línea de stdout que
se parsea entera:

```json
{ "schemaVersion": 3, "ok": true, "command": "current", "data": [], "meta": {} }
```

El error se detecta por `ok: false`, nunca por el código de salida. stderr es
diagnóstico y se ignora.

El reloj **no** se le pide al CLI cada segundo: se lee `started_at` una vez y la
cuenta la lleva Rust. Solo se vuelve a consultar cuando cambia la base de datos,
que se vigila con FSEvents sobre su directorio.

## Estructura

```
src/            el panel: TypeScript, sin framework
src-tauri/      el backend: tray, estado, subprocesos, vigilancia
vendor/bita/    el CLI, como submódulo fijado
```
