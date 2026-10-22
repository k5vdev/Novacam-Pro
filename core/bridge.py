import argparse
import hmac
import http.server
import msvcrt
import os
import signal
import subprocess
import sys
import threading
import time
import uuid
from urllib.parse import urlparse, parse_qs
import cv2
import numpy as np
import pyvirtualcam
import win32pipe
import win32file

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def run_bridge(
    scrcpy_path="scrcpy",
    ffmpeg_path="ffmpeg",
    port=51789,
    token="",
    vcam_index=0,
    video_source="camera",
    camera_id="0",
    width=1280,
    height=720,
    fps=30,
    bitrate="6M",
    zoom=1.0,
    brightness=0.0,
    mirror=False,
    rotate=0,
    device_serial=None,
    autofocus=True,
    focus_distance=50.0,
    audio=False,
    audio_source="mic",
    audio_buffer=20,
    audio_bitrate="128K"
):
    # Dimensiones de salida según orientación física
    out_width = height if rotate in (90, 270) else width
    out_height = width if rotate in (90, 270) else height

    # Estado mutable en tiempo real (Permite ajustar sin recargar la cámara ni reiniciar procesos)
    class LiveState:
        cur_zoom = zoom
        cur_brightness = brightness
        cur_contrast = 1.0
        cur_saturation = 1.0
        cur_warmth = 0
        cur_sharpness = 0.0
        cur_mirror = mirror
        cur_autofocus = autofocus
        cur_focus = focus_distance

    print("=" * 60)
    print("      NovaCam Virtual Camera Bridge (Unified Pro Engine)")
    print(f"      Fuente: {video_source.upper()} | Captura: {width}x{height} | Salida: {out_width}x{out_height} @ {fps} fps")
    print(f"      Audio Sincronizado: {'ACTIVO (' + audio_source + ')' if audio else 'DESACTIVADO'}")
    print("=" * 60)

    # 1. Crear Named Pipe exclusivo en Windows
    pipe_name = rf"\\.\pipe\novacam_{uuid.uuid4().hex[:8]}"
    pipe = win32pipe.CreateNamedPipe(
        pipe_name,
        win32pipe.PIPE_ACCESS_INBOUND,
        win32pipe.PIPE_TYPE_BYTE | win32pipe.PIPE_READMODE_BYTE | win32pipe.PIPE_WAIT,
        1, 1024 * 1024, 1024 * 1024, 0, None
    )

    # 3. Comando scrcpy (Video de ultra baja latencia dedicado)
    scrcpy_cmd = [
        scrcpy_path,
        f"--video-source={video_source}",
        f"--camera-size={width}x{height}",
        f"--camera-fps={fps}",
        f"--video-bit-rate={bitrate}",
        "--video-codec-options=i-frame-interval=1",
        "--no-window",
        "--no-audio",
        f"--record={pipe_name}",
        "--record-format=mkv",
    ]

    if device_serial:
        scrcpy_cmd.extend(["-s", device_serial])
    else:
        scrcpy_cmd.append("-d")

    if video_source == "camera":
        scrcpy_cmd.append(f"--camera-id={camera_id}")

    print("[2/3] Conectando con dispositivo Android (Video en tiempo real)...")
    p_scrcpy = subprocess.Popen(scrcpy_cmd, stderr=sys.stderr, creationflags=NO_WINDOW)

    # scrcpy ya está arrancando: se inicializa la cámara virtual mientras tanto (en paralelo)
    # 2. Inicializar cámara virtual en Windows
    print("\n[1/3] Inicializando NovaCam Virtual Camera en Windows...")
    # Cada teléfono usa su propia cámara virtual: "NovaCam Virtual Camera", "... #2", "... #3"...
    cam_kwargs = {}
    if vcam_index > 0:
        cam_kwargs["device"] = f"NovaCam Virtual Camera #{vcam_index + 1}"
    try:
        cam = pyvirtualcam.Camera(
            width=out_width,
            height=out_height,
            fps=fps,
            fmt=pyvirtualcam.PixelFormat.NV12,
            **cam_kwargs
        )
    except Exception as e:
        print(f"ERROR: no se pudo abrir la cámara virtual {vcam_index + 1}: {e}", flush=True)
        if vcam_index > 0:
            print("ERROR: registra más cámaras virtuales ejecutando driver/register_novacam.bat como administrador.", flush=True)
        try:
            p_scrcpy.terminate()
        except Exception:
            pass
        sys.exit(1)
    print(f"      OK: Dispositivo '{cam.device}' listo ({out_width}x{out_height}).")

    # Vigilante: si scrcpy muere antes de conectar (teléfono bloqueado, cámara ocupada...), se
    # abre el pipe como cliente para liberar ConnectNamedPipe y salir con un error claro.
    scrcpy_failed = [False]

    def watch_scrcpy():
        while p_scrcpy.poll() is None:
            time.sleep(0.2)
        scrcpy_failed[0] = True
        try:
            win32file.CreateFile(pipe_name, win32file.GENERIC_WRITE, 0, None, win32file.OPEN_EXISTING, 0, None)
        except Exception:
            pass

    threading.Thread(target=watch_scrcpy, daemon=True).start()

    # Esperar conexión de scrcpy al Named Pipe
    win32pipe.ConnectNamedPipe(pipe, None)
    if scrcpy_failed[0]:
        print("ERROR: scrcpy terminó sin conectar. Revisa que el teléfono esté desbloqueado y la cámara no esté en uso.", flush=True)
        try:
            cam.close()
        except Exception:
            pass
        sys.exit(1)
    pipe_fd = msvcrt.open_osfhandle(int(pipe), os.O_RDONLY)

    # 4. Filtros de orientación física en FFmpeg (Transpose)
    vf_filters = []
    if rotate == 90:
        vf_filters.append("transpose=1")
    elif rotate == 180:
        vf_filters.append("hflip,vflip")
    elif rotate == 270:
        vf_filters.append("transpose=2")

    ffmpeg_cmd = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel", "error",
        "-fflags", "nobuffer",
        "-flags", "low_delay",
        "-probesize", "65536",
        "-analyzeduration", "0",
        "-f", "matroska",
        "-i", "pipe:0",
        "-fps_mode", "passthrough",
        "-an",
    ]

    if vf_filters:
        ffmpeg_cmd.extend(["-vf", ",".join(vf_filters)])

    ffmpeg_cmd.extend([
        "-f", "rawvideo",
        "-pix_fmt", "nv12",
        "pipe:1"
    ])

    p_ffmpeg = subprocess.Popen(
        ffmpeg_cmd,
        stdin=pipe_fd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=NO_WINDOW
    )

    def ffmpeg_err_reader():
        for line in iter(p_ffmpeg.stderr.readline, b""):
            msg = line.decode(errors="ignore").strip()
            if msg:
                print(f"[FFmpeg] {msg}", file=sys.stderr)
    t_err = threading.Thread(target=ffmpeg_err_reader, daemon=True)
    t_err.start()

    frame_size = out_width * out_height * 3 // 2
    nv12_shape = (out_height * 3 // 2, out_width)

    print("[3/3] Camara Virtual ACTIVA en vivo!")
    print("      -> Selecciona 'NovaCam Virtual Camera' en tu navegador o Zoom.\n")

    running = [True]
    latest_jpeg = [None]
    latest_frame = [None]  # Último NV12 a resolución completa (para fotos)
    jpeg_counter = [0]
    active_preview_viewers = [0]
    last_preview_activity = [time.time()]

    # Servidor HTTP con soporte de parámetros dinámicos en tiempo real
    # Orígenes de la ventana de la app (WebView2 de Tauri); ningún otro sitio recibe CORS.
    ALLOWED_ORIGINS = ("http://tauri.localhost", "https://tauri.localhost", "tauri://localhost")

    class PreviewHTTPHandler(http.server.BaseHTTPRequestHandler):
        def _cors(self):
            origin = self.headers.get("Origin")
            if origin in ALLOWED_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")

        def _authorized(self, query):
            supplied = query.get("token", [""])[0]
            return bool(token) and hmac.compare_digest(supplied.encode(), token.encode())

        def do_GET(self):
            last_preview_activity[0] = time.time()
            parsed = urlparse(self.path)
            route = parsed.path
            query = parse_qs(parsed.query)
            if not self._authorized(query):
                self.send_response(403)
                self.end_headers()
                return
            if route == "/video":
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                self._cors()
                self.end_headers()
                active_preview_viewers[0] += 1
                local_counter = -1
                try:
                    while running[0]:
                        if jpeg_counter[0] == local_counter or latest_jpeg[0] is None:
                            time.sleep(0.02)
                            continue
                        local_counter = jpeg_counter[0]
                        jpg = latest_jpeg[0]
                        if jpg is not None:
                            header = (
                                b"--frame\r\n"
                                b"Content-Type: image/jpeg\r\n"
                                b"Content-Length: " + str(len(jpg)).encode() + b"\r\n\r\n"
                            )
                            self.wfile.write(header + jpg + b"\r\n")
                            self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, Exception):
                    pass
                finally:
                    active_preview_viewers[0] = max(0, active_preview_viewers[0] - 1)
            elif route == "/params":
                # Control en tiempo real: Actualiza parámetros sin reiniciar la cámara
                try:
                    if "zoom" in query:
                        LiveState.cur_zoom = max(1.0, min(3.0, float(query["zoom"][0])))
                    if "brightness" in query:
                        LiveState.cur_brightness = max(-0.3, min(0.3, float(query["brightness"][0])))
                    if "contrast" in query:
                        LiveState.cur_contrast = max(0.5, min(2.0, float(query["contrast"][0])))
                    if "sat" in query:
                        LiveState.cur_saturation = max(0.0, min(2.5, float(query["sat"][0])))
                    if "warmth" in query:
                        LiveState.cur_warmth = max(-35, min(35, int(float(query["warmth"][0]))))
                    if "sharp" in query:
                        LiveState.cur_sharpness = max(0.0, min(1.0, float(query["sharp"][0])))
                    if "mirror" in query:
                        LiveState.cur_mirror = query["mirror"][0] in ("1", "true", "True")
                    if "af" in query:
                        LiveState.cur_autofocus = query["af"][0] in ("1", "true", "True")
                    if "focus" in query:
                        LiveState.cur_focus = max(0.0, min(100.0, float(query["focus"][0])))
                    if "volume" in query:
                        try:
                            from set_volume import set_volume
                            set_volume(float(query["volume"][0]), device_serial)
                        except Exception:
                            pass

                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self._cors()
                    self.end_headers()
                    self.wfile.write(b'{"status":"ok"}')
                except Exception:
                    self.send_response(400)
                    self.end_headers()
            elif route == "/photo":
                frame = latest_frame[0]
                if frame is None:
                    self.send_response(503)
                    self.end_headers()
                    return
                try:
                    bgr_full = cv2.cvtColor(frame, cv2.COLOR_YUV2BGR_NV12)
                    ok, enc = cv2.imencode('.jpg', bgr_full, [cv2.IMWRITE_JPEG_QUALITY, 95])
                    if not ok:
                        raise RuntimeError("imencode")
                    jpg = enc.tobytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Content-Length", str(len(jpg)))
                    self.send_header("Cache-Control", "no-cache, no-store")
                    self._cors()
                    self.end_headers()
                    self.wfile.write(jpg)
                except Exception:
                    self.send_response(500)
                    self.end_headers()
            elif route == "/snapshot":
                jpg = latest_jpeg[0]
                if jpg is not None:
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Content-Length", str(len(jpg)))
                    self.send_header("Cache-Control", "no-cache, no-store")
                    self.send_header("X-Frame-Id", str(jpeg_counter[0]))
                    self.send_header("Access-Control-Expose-Headers", "X-Frame-Id")
                    self._cors()
                    self.end_headers()
                    self.wfile.write(jpg)
                else:
                    self.send_response(503)
                    self.end_headers()
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, *args):
            pass

    httpd = None
    try:
        class ReusableThreadingServer(http.server.ThreadingHTTPServer):
            allow_reuse_address = True
            daemon_threads = True

        httpd = ReusableThreadingServer(("127.0.0.1", port), PreviewHTTPHandler)
        t_http = threading.Thread(target=httpd.serve_forever, daemon=True)
        t_http.start()
        print(f"      [Preview] Servidor HTTP activo en http://127.0.0.1:{port}/video (protegido por token)")
    except Exception as e:
        print(f"      [Preview] Error iniciando servidor HTTP: {e}")

    def cleanup():
        print("\nCerrando recursos de forma segura...")
        running[0] = False
        if httpd:
            try:
                httpd.shutdown()
            except Exception:
                pass
        try:
            p_ffmpeg.terminate()
            p_ffmpeg.wait(timeout=0.5)
        except Exception:
            pass
        try:
            p_scrcpy.terminate()
            p_scrcpy.wait(timeout=0.5)
        except Exception:
            pass
        try:
            cam.close()
        except Exception:
            pass
        print("NovaCam detenido correctamente.")

    def sig_handler(signum, frame):
        cleanup()
        sys.exit(0)

    try:
        signal.signal(signal.SIGINT, sig_handler)
        signal.signal(signal.SIGTERM, sig_handler)
    except Exception:
        pass

    frame_count = 0
    t0 = time.time()
    prev_w = 360 if out_width < out_height else 640
    prev_h = 640 if out_width < out_height else 360

    ffmpeg_out_handle = msvcrt.get_osfhandle(p_ffmpeg.stdout.fileno())

    try:
        while running[0]:
            # Purgar cualquier acumulación de fotogramas en el buffer del pipe para CERO LATENCIA
            try:
                _, avail, _ = win32pipe.PeekNamedPipe(ffmpeg_out_handle, 0)
                if avail >= frame_size * 2:
                    skip_bytes = (avail // frame_size - 1) * frame_size
                    if skip_bytes > 0:
                        p_ffmpeg.stdout.read(skip_bytes)
            except Exception:
                pass

            raw = p_ffmpeg.stdout.read(frame_size)
            if not raw or len(raw) != frame_size:
                break

            arr = np.frombuffer(raw, dtype=np.uint8).reshape(nv12_shape).copy()

            # 1. Zoom digital en tiempo real (<1.5ms)
            cur_zoom = LiveState.cur_zoom
            if cur_zoom > 1.02:
                cw = int(out_width / cur_zoom)
                ch = int(out_height / cur_zoom)
                x1 = (out_width - cw) // 2
                y1 = (out_height - ch) // 2
                y_crop = arr[:out_height, :][y1:y1+ch, x1:x1+cw]
                y_zoom = cv2.resize(y_crop, (out_width, out_height), interpolation=cv2.INTER_LINEAR)
                uv_raw = arr[out_height:, :].reshape(out_height // 2, out_width // 2, 2)
                uv_crop = uv_raw[y1//2:(y1+ch)//2, x1//2:(x1+cw)//2]
                uv_zoom = cv2.resize(uv_crop, (out_width // 2, out_height // 2), interpolation=cv2.INTER_LINEAR).reshape(out_height // 2, out_width)
                arr = np.vstack((y_zoom, uv_zoom))

            # 2. Brillo y Contraste en tiempo real (<0.2ms directo en Luma Y)
            cur_bright = LiveState.cur_brightness
            cur_contrast = LiveState.cur_contrast
            if abs(cur_bright) > 0.01 or abs(cur_contrast - 1.0) > 0.01:
                beta = int(cur_bright * 128)
                cv2.convertScaleAbs(arr[:out_height], arr[:out_height], alpha=cur_contrast, beta=beta)

            # 3. Saturación y Balance de Temperatura / Tono en tiempo real (<0.2ms en UV)
            cur_sat = LiveState.cur_saturation
            if abs(cur_sat - 1.0) > 0.01:
                cv2.convertScaleAbs(arr[out_height:], arr[out_height:], alpha=cur_sat, beta=int(128 * (1.0 - cur_sat)))

            cur_warmth = LiveState.cur_warmth
            if cur_warmth != 0:
                uv = arr[out_height:, :].reshape(out_height // 2, out_width // 2, 2)
                if cur_warmth > 0:
                    uv[:, :, 1] = cv2.add(uv[:, :, 1], cur_warmth)
                    uv[:, :, 0] = cv2.subtract(uv[:, :, 0], cur_warmth // 2)
                else:
                    uv[:, :, 0] = cv2.add(uv[:, :, 0], -cur_warmth)
                    uv[:, :, 1] = cv2.subtract(uv[:, :, 1], (-cur_warmth) // 2)

            # 4. Nitidez en tiempo real (<0.8ms)
            cur_sharp = LiveState.cur_sharpness
            if cur_sharp > 0.05:
                blurred_y = cv2.GaussianBlur(arr[:out_height], (0, 0), 2.0)
                cv2.addWeighted(arr[:out_height], 1.0 + cur_sharp, blurred_y, -cur_sharp, 0, dst=arr[:out_height])

            # 5. Espejo en tiempo real (Flip horizontal sin recargas)
            if LiveState.cur_mirror:
                y_flip = np.ascontiguousarray(np.fliplr(arr[:out_height]))
                uv_flip = np.ascontiguousarray(np.flip(arr[out_height:].reshape(out_height // 2, out_width // 2, 2), axis=1).reshape(out_height // 2, out_width))
                arr = np.vstack((y_flip, uv_flip))

            # 6. Enfoque manual / regulación de profundidad en tiempo real
            if not LiveState.cur_autofocus:
                f_dist = LiveState.cur_focus
                if f_dist > 55:
                    sigma = ((f_dist - 50) / 50.0) * 1.5
                    y = arr[:out_height].astype(np.float32)
                    blurred = cv2.GaussianBlur(y, (0, 0), sigma)
                    sharp = cv2.addWeighted(y, 1.5, blurred, -0.5, 0)
                    arr[:out_height] = np.clip(sharp, 0, 255).astype(np.uint8)
                elif f_dist < 45:
                    ksize = int(((50 - f_dist) / 50.0) * 6) * 2 + 1
                    arr[:out_height] = cv2.GaussianBlur(arr[:out_height], (ksize, ksize), 0)

            cam.send(arr)
            latest_frame[0] = arr

            # Generar JPEG de colores 100% naturales para preview en vivo (<2.5 ms)
            try:
                bgr = cv2.cvtColor(arr, cv2.COLOR_YUV2BGR_NV12)
                small_bgr = cv2.resize(bgr, (prev_w, prev_h), interpolation=cv2.INTER_LINEAR)
                _, enc = cv2.imencode('.jpg', small_bgr, [cv2.IMWRITE_JPEG_QUALITY, 60])
                latest_jpeg[0] = enc.tobytes()
                jpeg_counter[0] += 1
            except Exception:
                pass

            frame_count += 1
            if frame_count % (fps * 3) == 0:
                elapsed = time.time() - t0
                actual_fps = frame_count / elapsed
                print(f"      [NovaCam Streaming] {frame_count} frames enviados (~{actual_fps:.1f} FPS)", flush=True)

    except KeyboardInterrupt:
        pass
    finally:
        cleanup()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NovaCam Virtual Camera Bridge")
    parser.add_argument("--source", default="camera", choices=["camera", "display"])
    parser.add_argument("--camera-id", default="0")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--bitrate", default="6M")
    parser.add_argument("--zoom", type=float, default=1.0)
    parser.add_argument("--brightness", type=float, default=0.0)
    parser.add_argument("--mirror", action="store_true")
    parser.add_argument("--rotate", type=int, default=0)
    parser.add_argument("--serial", default=None)
    parser.add_argument("--autofocus", action="store_true", default=True)
    parser.add_argument("--no-autofocus", dest="autofocus", action="store_false")
    parser.add_argument("--focus-distance", type=float, default=50.0)
    parser.add_argument("--scrcpy", default="scrcpy")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--port", type=int, default=51789)
    parser.add_argument("--token", default="")
    parser.add_argument("--vcam-index", type=int, default=0)
    parser.add_argument("--audio", action="store_true", default=False)
    parser.add_argument("--no-audio", dest="audio", action="store_false")
    parser.add_argument("--audio-source", default="mic")
    parser.add_argument("--audio-buffer", type=int, default=20)
    parser.add_argument("--audio-bitrate", default="128K")

    args = parser.parse_args()
    run_bridge(
        scrcpy_path=args.scrcpy,
        ffmpeg_path=args.ffmpeg,
        port=args.port,
        token=args.token,
        vcam_index=args.vcam_index,
        video_source=args.source,
        camera_id=args.camera_id,
        width=args.width,
        height=args.height,
        fps=args.fps,
        bitrate=args.bitrate,
        zoom=args.zoom,
        brightness=args.brightness,
        mirror=args.mirror,
        rotate=args.rotate,
        device_serial=args.serial,
        autofocus=args.autofocus,
        focus_distance=args.focus_distance,
        audio=args.audio,
        audio_source=args.audio_source,
        audio_buffer=args.audio_buffer,
        audio_bitrate=args.audio_bitrate
    )
