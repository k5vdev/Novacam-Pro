# Avisos de terceros

NovaCam Pro es software propio bajo licencia **MIT** (ver [`LICENSE`](LICENSE)). Se apoya en proyectos de terceros, cada uno con su licencia. Este documento indica **qué se incluye en el repositorio, qué se descarga aparte y bajo qué licencia**.

> No soy abogado ni esto es asesoría legal. Si vas a distribuir NovaCam Pro comercialmente, revisa las licencias originales.

## 1. Incluido en este repositorio

| Componente | Archivos | Licencia | Texto |
| :--- | :--- | :--- | :--- |
| [Unity Capture](https://github.com/schellingb/UnityCapture) (filtro DirectShow) © 2018 Bernhard Schelling, basado en UnityCam © 2016 MHD Yamen Saraiji | `driver/UnityCaptureFilter32.dll`, `driver/UnityCaptureFilter64.dll` | MIT | [`licenses/UnityCapture-MIT.txt`](licenses/UnityCapture-MIT.txt) |
| [Lucide](https://lucide.dev) (iconos) | `ui/lucide.min.js` | ISC (el archivo trae su propia cabecera de licencia) | cabecera del propio archivo |

Los DLL de Unity Capture se incluyen **sin modificar**, tal como los publica su autor.

## 2. Se descarga aparte (no se redistribuye aquí)

El instalador (`Instalar_NovaCam.bat` → `tools/get_scrcpy.ps1`) descarga **directamente del proyecto original** la versión oficial de scrcpy para Windows y la deja en `bin/`. Así NovaCam Pro no redistribuye esos binarios.

| Componente | Origen | Licencia | Texto |
| :--- | :--- | :--- | :--- |
| [scrcpy](https://github.com/Genymobile/scrcpy) © 2018 Genymobile, © 2018-2026 Romain Vimont (`scrcpy.exe`, `scrcpy-server`) | Release oficial de GitHub | Apache-2.0 | [`licenses/scrcpy-Apache-2.0.txt`](licenses/scrcpy-Apache-2.0.txt) |
| `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll` ([Android Platform-Tools](https://developer.android.com/tools/releases/platform-tools)) | Vienen dentro del release oficial de scrcpy | Apache-2.0 (código AOSP) y términos del Android SDK | ver [términos del SDK](https://developer.android.com/studio/terms) |
| Bibliotecas FFmpeg (`avcodec`, `avformat`, `avutil`, `swresample`) | Vienen dentro del release oficial de scrcpy | LGPL-2.1 o posterior (según indican los propios DLL) | [`licenses/LGPL-2.1.txt`](licenses/LGPL-2.1.txt), código en <https://ffmpeg.org> |
| [libusb](https://libusb.info) | Dentro del release de scrcpy | LGPL-2.1 | [`licenses/LGPL-2.1.txt`](licenses/LGPL-2.1.txt) |
| [SDL2](https://libsdl.org) | Dentro del release de scrcpy | zlib | <https://libsdl.org/license.php> |
| [FFmpeg](https://ffmpeg.org) `ffmpeg.exe` | El usuario lo instala (p. ej. `winget install Gyan.FFmpeg`) | LGPL o GPL según el build que elija | del build elegido |

NovaCam Pro **ejecuta** estos programas como procesos separados; no los modifica ni los enlaza a su código.

## 3. Dependencias de Python (se instalan con `pip`, no se redistribuyen)

| Paquete | Licencia |
| :--- | :--- |
| [pyvirtualcam](https://github.com/letmaik/pyvirtualcam) | **GPL-2.0** |
| OpenCV (`opencv-python`), NumPy, pycaw, pywin32, comtypes | Apache-2.0 / BSD / MIT / PSF (ver cada paquete) |

**Sobre pyvirtualcam (GPL-2.0):** `core/bridge.py` lo importa en tiempo de ejecución. El código de NovaCam Pro sigue siendo MIT y **no incluye** pyvirtualcam, pero si alguien redistribuye NovaCam Pro **junto con** pyvirtualcam (por ejemplo, empaquetándolos en un instalador único), el conjunto resultante debe cumplir también la GPL-2.0, incluida la entrega del código fuente. Si necesitas evitarlo, sustituye pyvirtualcam por otra forma de enviar fotogramas a la cámara virtual.

## 4. Aplicación de escritorio

[Tauri](https://tauri.app) y sus dependencias de Rust se enlazan al compilar bajo MIT / Apache-2.0 (ver `src-tauri/Cargo.lock`). Si publicas un ejecutable compilado, puedes listar sus licencias con [`cargo-about`](https://github.com/EmbarkStudios/cargo-about) o `cargo license`.

## 5. Marcas

scrcpy, Android, Unity, FFmpeg y los demás nombres pertenecen a sus respectivos dueños. **NovaCam Pro es un proyecto independiente, sin afiliación ni respaldo** de Genymobile, Google, Unity Technologies ni de los autores de los demás proyectos.
