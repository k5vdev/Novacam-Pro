# NovaCam Pro

[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-blue?logo=windows)](https://microsoft.com)
[![Tauri](https://img.shields.io/badge/Tauri-v2-orange?logo=tauri)](https://tauri.app)
[![Python](https://img.shields.io/badge/Python-3.10%2B-green?logo=python)](https://python.org)
[![scrcpy](https://img.shields.io/badge/scrcpy-3.3%2B-red)](https://github.com/Genymobile/scrcpy)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

Convierte tu teléfono Android en una **cámara web virtual** para Windows, con ajustes de imagen en tiempo real, control de pantalla y audio del teléfono. La cámara aparece como `NovaCam Virtual Camera` en **OBS, Discord, Meet, Zoom, Teams** y el navegador.

Funciona con **varios teléfonos a la vez**, cada uno independiente, desde una sola ventana.

## Contenido

- [Características](#características)
- [Compatibilidad](#compatibilidad)
- [Instalación](#instalación)
- [Uso](#uso)
- [Varios teléfonos](#varios-teléfonos)
- [Solución de problemas](#solución-de-problemas)
- [Compilar desde el código](#compilar-desde-el-código)
- [Cómo funciona](#cómo-funciona)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Licencias](#licencias)

## Características

- **Cámara virtual DirectShow** con la cámara trasera, frontal o gran angular del teléfono, hasta 1080p y 30 FPS.
- **Ajustes en vivo, sin reiniciar:** zoom digital, brillo, contraste, saturación, temperatura, nitidez, espejo y enfoque (automático o manual simulado por software).
- **Control de pantalla:** ve y maneja el teléfono con ratón y teclado, con opción de mantenerlo despierto o apagar su pantalla.
- **Audio del teléfono:** micrófono o sonido del sistema Android, reproducido en tu PC, con ajuste de volumen.
- **USB o Wi-Fi:** pasa un teléfono a modo inalámbrico con un clic.
- **Foto a resolución completa** de la cámara, guardada en tu carpeta *Imágenes*.
- **Varios teléfonos a la vez** en una sola ventana (ver [más abajo](#varios-teléfonos)).
- **Estados claros:** indicadores de carga ("Iniciando…"), avisos de error con el motivo real y detección de desconexiones.
- **Segura por diseño:** el servidor de vista previa local solo responde con un token aleatorio que genera la app en cada sesión, y no acepta peticiones de páginas web externas.

## Compatibilidad

| Función | Android mínimo | Motivo |
| :--- | :---: | :--- |
| Control de pantalla | 5.0 | scrcpy |
| Audio del teléfono | **11** | límite de scrcpy |
| Cámara virtual | **12** | límite de scrcpy |

Si conectas un teléfono con Android más viejo, la app deja la cámara y el audio atenuados con el aviso "Requiere Android 12+" o "11+". La pantalla sigue funcionando.

**Requisitos del PC:** Windows 10/11 (64 bits) y Python 3.10 o superior (con "Add Python to PATH").
**Requisitos del teléfono:** Depuración USB activada.

## Instalación

1. Descarga el proyecto (o el `.zip` de *Releases*, si existe) y descomprímelo.
2. Descarga **FFmpeg** (no se incluye por su tamaño y su licencia, ~220 MB) y copia `ffmpeg.exe` a la carpeta `bin/`:
   ```bash
   winget install Gyan.FFmpeg
   ```
   También sirve tenerlo en el `PATH`, o bajar un build estático de [gyan.dev](https://www.gyan.dev/ffmpeg/builds/).
3. Haz doble clic en **`Instalar_NovaCam.bat`**. Pide permisos de administrador y:
   - instala las dependencias de Python (`requirements.txt`);
   - descarga **scrcpy y adb oficiales** desde GitHub a `bin/` (no vienen en el repositorio);
   - registra las cámaras virtuales de Windows;
   - crea accesos directos en el Escritorio y el Menú Inicio.
4. Abre **NovaCam Pro** desde el acceso directo, `NovaCam_Pro.exe` o `Iniciar_NovaCam.vbs` (sin consola).

> `NovaCam_Pro.exe` no está en el repositorio. Descárgalo de *Releases* o [compílalo](#compilar-desde-el-código).

### Preparar el teléfono

1. Ajustes → Acerca del teléfono → toca **Número de compilación** 7 veces.
2. Ajustes → Opciones de desarrollador → activa **Depuración USB**.
3. Conéctalo con un **cable de datos** y acepta *"¿Permitir depuración USB?"* (marca "Siempre permitir").
4. Si no aparece, cambia el modo USB a **Transferencia de archivos**.

## Uso

1. Abre la app: el teléfono aparece solo en la cabecera (con su batería).
2. Enciende el interruptor de **Cámara**. Verás "Iniciando…" y luego la vista previa en vivo (el primer fotograma tarda unos segundos).
3. En tu programa de videollamadas elige la cámara **NovaCam Virtual Camera**.
4. Ajusta imagen, lente, resolución y rotación desde el panel inferior; los cambios de imagen son instantáneos.

Cada tarjeta (Cámara, Pantalla, Audio) abre sus propios ajustes; el interruptor la enciende o apaga.

| Control | Qué hace |
| :--- | :--- |
| Lente / Resolución / FPS / Rotación | Reinician la cámara con la nueva configuración. |
| Zoom, brillo, contraste, saturación, temperatura, nitidez | Se aplican al instante sobre el video. |
| Autoenfoque / enfoque manual | El manual aplica desenfoque o nitidez por software, no mueve la lente. |
| Botón blanco (obturador) | Guarda una foto en tu carpeta *Imágenes*. |
| Wi-Fi | Pasa el teléfono seleccionado de USB a Wi-Fi (y viceversa). |
| Detener | Detiene el teléfono seleccionado ("Detener todo" si solo hay uno). |

## Varios teléfonos

- Con 2 o más teléfonos aparece una tira bajo la cabecera para elegir cuál controlas. Un punto verde indica que ese teléfono está transmitiendo.
- Cada teléfono tiene sus propios procesos, puerto, ajustes y estado: por ejemplo, la cámara de uno y la pantalla de otro a la vez.
- Cada teléfono usa **su propia cámara virtual**: `NovaCam Virtual Camera`, `#2`, `#3` y `#4` (hasta 4 cámaras a la vez; la app admite hasta 8 teléfonos para pantalla y audio).
- La primera vez que enciendas la cámara de un segundo teléfono, Windows pedirá permiso de administrador para registrar las cámaras extra. La app lo hace sola. También puedes ejecutar `driver\register_novacam.bat` como administrador.
- Un teléfono conectado por USB y por Wi-Fi aparece dos veces en la tira.

## Solución de problemas

| Síntoma | Qué revisar |
| :--- | :--- |
| No aparece el teléfono | Cable de datos, Depuración USB activa y aceptar el aviso en el teléfono. Si dice "Autoriza el teléfono", falta ese aviso. |
| "scrcpy terminó sin conectar" | Teléfono desbloqueado, cámara libre (otra app puede estar usándola) y Android 12 o superior. |
| La cámara no aparece en Zoom/OBS | Ejecuta `driver\register_novacam.bat` como administrador y reinicia el programa. |
| Falla al iniciar | Comprueba que `bin/ffmpeg.exe` existe (o `ffmpeg` está en el PATH) y que Python tiene las dependencias (`pip install -r requirements.txt`). |
| Cualquier otro error | Revisa los registros en `%TEMP%\novacam_*.log` (uno por módulo y teléfono). |

## Compilar desde el código

Requisitos: [Rust](https://www.rust-lang.org/tools/install) estable (edición 2024, Rust 1.90+) y las dependencias de [Tauri v2](https://tauri.app/start/prerequisites/) para Windows.

```bash
cd src-tauri
cargo run                # modo desarrollo
cargo build --release    # ejecutable final
```

El ejecutable queda en `src-tauri/target/release/app.exe`. Cópialo como `NovaCam_Pro.exe` junto a las carpetas `core/`, `bin/` y `driver/`, porque la app busca esos recursos junto al ejecutable.

La interfaz (`ui/`) se incrusta en el ejecutable al compilar: tras editarla, vuelve a compilar.

## Cómo funciona

```
Teléfono Android ──(adb: USB / Wi-Fi)── scrcpy ──► pipe con nombre ──► FFmpeg (NV12)
                                                                         │
                                                                   core/bridge.py
                                              (zoom, color, nitidez, espejo, vista previa)
                                                   │                          │
                                   NovaCam Virtual Camera            Vista previa en la app
                                  (DirectShow: OBS, Zoom...)        (HTTP local con token)
```

- **`src-tauri/src/lib.rs`** (Rust): ventana, sesión por teléfono, procesos hijos sin consola, registro de cámaras virtuales y comandos de la interfaz.
- **`core/bridge.py`** (Python): une scrcpy y FFmpeg, aplica los filtros y publica la cámara virtual y la vista previa. Hay un proceso por teléfono, con su propio puerto (`51789`+) y su cámara virtual.
- **`ui/`** (HTML/CSS/JS): interfaz con iconos [Lucide](https://lucide.dev).
- **`bin/`:** `scrcpy`, `adb` y sus DLL (los descarga el instalador) y `ffmpeg.exe` (lo pones tú). No se incluyen en el repositorio.
- **`driver/`:** filtro DirectShow [UnityCapture](https://github.com/schellingb/UnityCapture) y scripts de registro.

```
NovaCam-Pro/
├── core/        bridge.py, set_volume.py
├── driver/      UnityCaptureFilter32/64.dll, register/unregister_novacam.bat
├── bin/         scrcpy, adb, ffmpeg (se descargan; no van en el repo)
├── licenses/    textos de licencia de terceros
├── tools/       get_scrcpy.ps1 (descarga scrcpy oficial)
├── ui/          index.html, style.css, main.js, lucide.min.js
├── src-tauri/   backend Rust (Tauri v2)
├── requirements.txt
└── Instalar_NovaCam.bat, Iniciar_NovaCam.vbs
```

## Limitaciones conocidas

- **Sin flash/linterna:** scrcpy no lo permite y por `adb` no hay forma fiable.
- **No es un micrófono virtual:** el audio del teléfono se reproduce en tu PC; las apps de videollamada no lo ven como micrófono.
- **Enfoque manual simulado:** actúa sobre la imagen, no sobre la lente.
- **Arranque de la cámara:** unos 5 segundos hasta el primer fotograma (conexión de scrcpy).
- **Solo Windows.** El teléfono necesita Android 12+ para la cámara y 11+ para el audio.

## Licencias

NovaCam Pro se distribuye bajo licencia **MIT** (ver [`LICENSE`](LICENSE)).

Usa y descarga componentes de terceros con sus propias licencias, entre ellos **scrcpy** (Apache-2.0), **FFmpeg**, **libusb** (LGPL), **Unity Capture** (MIT) y **pyvirtualcam** (GPL-2.0). El detalle de qué se incluye, qué se descarga y qué obligaciones implica está en [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), con los textos en [`licenses/`](licenses/).

NovaCam Pro es un proyecto independiente y no está afiliado a Genymobile (scrcpy), Google ni Unity Technologies.
