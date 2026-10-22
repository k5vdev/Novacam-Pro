use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::{Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Puerto base del bridge de la cámara; cada teléfono usa BASE_PORT + su ranura.
const BASE_PORT: u16 = 51789;
/// Máximo de teléfonos simultáneos (puertos y cámaras virtuales disponibles).
const MAX_DEVICES: usize = 8;

/// `Command` que nunca abre una ventana de consola (adb, taskkill, python, ffmpeg...).
fn hidden<S: AsRef<OsStr>>(program: S) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

// ---------------------------------------------------------------------------
// Logs de procesos (uno por módulo y ranura de dispositivo)
// ---------------------------------------------------------------------------

fn log_path(module: &str, slot: usize) -> PathBuf {
    std::env::temp_dir().join(format!("novacam_{}_{}.log", module, slot))
}

/// Envía stdout/stderr de un proceso a un log en %TEMP% para poder diagnosticar fallos.
fn attach_log(cmd: &mut Command, module: &str, slot: usize) {
    cmd.stdin(Stdio::null());
    if let Ok(f) = File::create(log_path(module, slot)) {
        if let Ok(f2) = f.try_clone() {
            cmd.stdout(Stdio::from(f2));
        }
        cmd.stderr(Stdio::from(f));
    }
}

fn log_tail(module: &str, slot: usize) -> String {
    let text = String::from_utf8_lossy(&std::fs::read(log_path(module, slot)).unwrap_or_default()).to_string();
    let lines: Vec<&str> = text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    // Preferir la última línea de error; si no hay, la última línea
    let line = lines.iter().rev().find(|l| l.contains("ERROR")).or(lines.last()).copied().unwrap_or("");
    let line = line.trim_start_matches("[server]").trim().trim_start_matches("ERROR:").trim();
    if line.is_empty() {
        "El proceso terminó inesperadamente.".to_string()
    } else {
        line.chars().take(180).collect()
    }
}

// ---------------------------------------------------------------------------
// Localización de herramientas
// ---------------------------------------------------------------------------

/// Busca un recurso relativo (p. ej. `bin/adb.exe`) subiendo por los directorios
/// padre del ejecutable y del directorio actual (cubre instalación y `cargo run`).
fn find_resource(rel: &[&str]) -> Option<PathBuf> {
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() { starts.push(dir.to_path_buf()); }
    }
    if let Ok(cwd) = std::env::current_dir() { starts.push(cwd); }
    for start in starts {
        for dir in start.ancestors() {
            let mut p = dir.to_path_buf();
            for part in rel { p.push(part); }
            if p.exists() { return Some(p); }
        }
    }
    None
}

fn command_works(name: &str, arg: &str) -> bool {
    hidden(name).arg(arg).output().map(|o| o.status.success()).unwrap_or(false)
}

fn get_bridge_path() -> PathBuf {
    find_resource(&["core", "bridge.py"]).unwrap_or_else(|| PathBuf::from("core/bridge.py"))
}

fn get_set_volume_path() -> PathBuf {
    find_resource(&["core", "set_volume.py"]).unwrap_or_else(|| PathBuf::from("core/set_volume.py"))
}

fn get_python_path() -> String {
    static PY: OnceLock<String> = OnceLock::new();
    PY.get_or_init(|| {
        if command_works("python", "--version") {
            return "python".to_string();
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            let p = PathBuf::from(pf).join("Python312").join("python.exe");
            if p.exists() { return p.to_string_lossy().to_string(); }
        }
        "python".to_string()
    }).clone()
}

fn get_scrcpy_path() -> String {
    if let Some(p) = find_resource(&["bin", "scrcpy.exe"]) { return p.to_string_lossy().to_string(); }
    "scrcpy".to_string()
}

fn get_adb_path() -> String {
    if let Some(p) = find_resource(&["bin", "adb.exe"]) { return p.to_string_lossy().to_string(); }
    "adb".to_string()
}

fn get_ffmpeg_path() -> String {
    if let Some(p) = find_resource(&["bin", "ffmpeg.exe"]) { return p.to_string_lossy().to_string(); }
    "ffmpeg".to_string()
}

/// Token aleatorio por sesión: solo la app lo conoce, así que ninguna página web
/// externa puede leer la cámara ni cambiar parámetros en el puerto local.
fn generate_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for i in 0..4u32 {
        let mut h = RandomState::new().build_hasher();
        h.write_u32(i);
        h.write_u32(std::process::id());
        if let Ok(d) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
            h.write_u128(d.as_nanos());
        }
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

// ---------------------------------------------------------------------------
// Estado: una sesión independiente por teléfono (serial de adb)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum Module {
    Camera,
    Screen,
    Audio,
}

impl Module {
    const ALL: [Module; 3] = [Module::Camera, Module::Screen, Module::Audio];

    fn key(self) -> &'static str {
        match self {
            Module::Camera => "camera",
            Module::Screen => "screen",
            Module::Audio => "audio",
        }
    }
}

#[derive(Default)]
struct Session {
    camera: Option<Child>,
    screen: Option<Child>,
    audio: Option<Child>,
}

impl Session {
    fn slot(&mut self, m: Module) -> &mut Option<Child> {
        match m {
            Module::Camera => &mut self.camera,
            Module::Screen => &mut self.screen,
            Module::Audio => &mut self.audio,
        }
    }

    fn has_any(&self) -> bool {
        self.camera.is_some() || self.screen.is_some() || self.audio.is_some()
    }
}

struct AppState {
    /// serial -> procesos en marcha de ese teléfono
    sessions: Mutex<HashMap<String, Session>>,
    /// serial -> ranura (decide el puerto del bridge y la cámara virtual de ese teléfono)
    slots: Mutex<HashMap<String, usize>>,
    token: String,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            sessions: Mutex::new(HashMap::new()),
            slots: Mutex::new(HashMap::new()),
            token: generate_token(),
        }
    }
}

fn port_for(slot: usize) -> u16 {
    BASE_PORT + slot as u16
}

/// Ranura estable del teléfono. Si se agotan, libera las de teléfonos sin procesos activos.
fn slot_for(state: &AppState, serial: &str) -> Result<usize, String> {
    let busy: HashSet<String> = state
        .sessions
        .lock()
        .map(|s| s.iter().filter(|(_, v)| v.has_any()).map(|(k, _)| k.clone()).collect())
        .unwrap_or_default();

    let mut slots = state.slots.lock().map_err(|e| e.to_string())?;
    if let Some(s) = slots.get(serial) {
        return Ok(*s);
    }
    let mut used: HashSet<usize> = slots.values().copied().collect();
    if used.len() >= MAX_DEVICES {
        slots.retain(|k, _| busy.contains(k));
        used = slots.values().copied().collect();
    }
    let free = (0..MAX_DEVICES)
        .find(|i| !used.contains(i))
        .ok_or_else(|| format!("Demasiados teléfonos a la vez (máximo {}).", MAX_DEVICES))?;
    slots.insert(serial.to_string(), free);
    Ok(free)
}

fn slot_snapshot(state: &AppState) -> HashMap<String, usize> {
    state.slots.lock().map(|s| s.clone()).unwrap_or_default()
}

fn take_child(state: &AppState, serial: &str, m: Module) -> Option<Child> {
    state.sessions.lock().ok()?.get_mut(serial)?.slot(m).take()
}

fn put_child(state: &AppState, serial: &str, m: Module, child: Child) {
    if let Ok(mut s) = state.sessions.lock() {
        *s.entry(serial.to_string()).or_default().slot(m) = Some(child);
    }
}

fn kill_process_tree(child: &mut Option<Child>) {
    if let Some(mut c) = child.take() {
        let pid = c.id();
        let _ = hidden("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
        let _ = c.kill();
        let _ = c.wait();
    }
}

/// Detiene todos los procesos de un teléfono (`Some`) o de todos (`None`).
/// Devuelve los seriales que tenían algo en marcha.
fn stop_sessions(state: &AppState, only: Option<&str>) -> Vec<String> {
    let mut victims: Vec<(String, Child)> = Vec::new();
    if let Ok(mut sessions) = state.sessions.lock() {
        for (serial, session) in sessions.iter_mut() {
            if only.map_or(false, |o| o != serial) {
                continue;
            }
            for m in Module::ALL {
                if let Some(c) = session.slot(m).take() {
                    victims.push((serial.clone(), c));
                }
            }
        }
    }
    let mut serials: Vec<String> = Vec::new();
    for (serial, child) in victims {
        let mut slot = Some(child);
        kill_process_tree(&mut slot);
        if !serials.contains(&serial) {
            serials.push(serial);
        }
    }
    serials
}

// ---------------------------------------------------------------------------
// adb
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscoveredDevice {
    pub serial: String,
    pub model: String,
    pub connection_type: String,
    /// "device" (listo), "unauthorized" (falta aceptar la depuración USB) u "offline"
    pub status: String,
    /// Versión de Android (p. ej. "13") y nivel de API; 0 si no se pudo leer
    pub android: String,
    pub sdk: u32,
}

/// Versión de Android del teléfono (se lee una sola vez por teléfono).
fn android_info(serial: &str) -> (String, u32) {
    static CACHE: OnceLock<Mutex<HashMap<String, (String, u32)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(v) = cache.lock().ok().and_then(|c| c.get(serial).cloned()) {
        return v;
    }
    let prop = |name: &str| -> String {
        hidden(get_adb_path())
            .args(["-s", serial, "shell", "getprop", name])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    };
    let release = prop("ro.build.version.release");
    let sdk = prop("ro.build.version.sdk").parse::<u32>().unwrap_or(0);
    if sdk > 0 {
        if let Ok(mut c) = cache.lock() {
            c.insert(serial.to_string(), (release.clone(), sdk));
        }
    }
    (release, sdk)
}

fn adb_devices() -> Vec<DiscoveredDevice> {
    let mut list = Vec::new();
    if let Ok(out) = hidden(get_adb_path()).args(["devices", "-l"]).output() {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 2 { continue; }
            let status = parts[1];
            if !matches!(status, "device" | "unauthorized" | "offline") { continue; }
            let serial = parts[0].to_string();
            let mut model = "Dispositivo Android".to_string();
            for p in &parts[2..] {
                if let Some(m) = p.strip_prefix("model:") {
                    model = m.replace('_', " ");
                }
            }
            let connection_type = if serial.contains(':') { "Wi-Fi" } else { "USB" }.to_string();
            let (android, sdk) = if status == "device" { android_info(&serial) } else { (String::new(), 0) };
            list.push(DiscoveredDevice { serial, model, connection_type, status: status.to_string(), android, sdk });
        }
    }
    list
}

/// Serial a usar: el indicado, o el único teléfono conectado.
fn resolve_serial(serial: &str) -> Result<String, String> {
    if !serial.is_empty() {
        return Ok(serial.to_string());
    }
    let ready: Vec<DiscoveredDevice> = adb_devices().into_iter().filter(|d| d.status == "device").collect();
    match ready.len() {
        0 => Err("No hay ningún teléfono conectado.".to_string()),
        1 => Ok(ready[0].serial.clone()),
        _ => Err("Hay varios teléfonos conectados: elige uno en el selector.".to_string()),
    }
}

fn send_android_notification(serial: &str, action: &str) {
    let serial = serial.to_string();
    let action = action.to_string();
    // En segundo plano: no debe retrasar el arranque de cámara, pantalla o audio.
    std::thread::spawn(move || {
        let adb = get_adb_path();
        let (title, text) = match action.as_str() {
            "screen"     => ("NovaCam Pro", "Control de pantalla conectado"),
            "mic"        => ("NovaCam Pro", "Micrófono en vivo activo"),
            "disconnect" => ("NovaCam Pro", "Transmision finalizada"),
            _            => ("NovaCam Pro", "Cámara virtual conectada y transmitiendo"),
        };
        let script = format!(
            "input keyevent KEYCODE_WAKEUP; cmd vibrator_manager synced -f oneshot -a 600 200; \
             cmd notification post -S bigtext -t '{}' novacam '{}'; service call statusbar 1",
            title, text
        );
        let _ = hidden(&adb).args(["-s", &serial, "shell", &script]).output();
    });
}

// ---------------------------------------------------------------------------
// Configuraciones que envía la interfaz
// ---------------------------------------------------------------------------

fn default_autofocus() -> bool { true }
fn default_focus_distance() -> f32 { 50.0 }

#[derive(Debug, Deserialize)]
pub struct CameraConfig {
    pub enabled: bool,
    pub resolution: u32,
    pub lens: String,
    pub fps: u32,
    pub rotate: u32,
    pub zoom: f32,
    pub brightness: f32,
    pub mirror: bool,
    pub serial: String,
    #[serde(default = "default_autofocus")]
    pub autofocus: bool,
    #[serde(default = "default_focus_distance")]
    pub focus_distance: f32,
}

#[derive(Debug, Deserialize)]
pub struct ScreenConfig {
    pub enabled: bool,
    pub stay_awake: bool,
    pub turn_screen_off: bool,
    pub serial: String,
    #[serde(default)]
    pub forward_audio: bool,
    /// Nombre del teléfono para el título de la ventana
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Deserialize)]
pub struct AudioConfig {
    pub enabled: bool,
    pub source: String,     // "mic", "mic-unprocessed", "playback", "voice-performance"
    pub buffer_ms: u32,     // 10, 20, 50
    pub bitrate: String,    // "64K", "128K", "192K"
    #[serde(default)]
    pub volume: Option<u32>, // 50 a 250 %
    pub serial: String,
}

#[derive(Serialize)]
pub struct DeviceInfo {
    pub model: String,
    pub battery: u32,
}

#[derive(Serialize)]
pub struct BridgeInfo {
    pub port: u16,
    pub token: String,
}

#[derive(Serialize)]
pub struct DeviceStatus {
    pub serial: String,
    pub camera: bool,
    pub screen: bool,
    pub audio: bool,
}

#[derive(Serialize)]
pub struct ExitInfo {
    pub serial: String,
    pub module: String,
    pub message: String,
    /// true si el proceso terminó con normalidad (sin error)
    pub ok: bool,
}

#[derive(Serialize)]
pub struct ModulesStatus {
    pub devices: Vec<DeviceStatus>,
    pub exited: Vec<ExitInfo>,
}

// ---------------------------------------------------------------------------
// Comandos: cámara / pantalla / audio (por teléfono)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cámaras virtuales (DirectShow): una por teléfono
// ---------------------------------------------------------------------------

const VCAM_NAME: &str = "NovaCam Virtual Camera";
const VCAM_COUNT: usize = 4;
const DSHOW_VIDEO_INPUTS: &str =
    r"HKLM\SOFTWARE\Classes\CLSID\{860BB310-5D01-11d0-BD3B-00A0C911CE86}\Instance";

fn vcam_label(slot: usize) -> String {
    if slot == 0 { VCAM_NAME.to_string() } else { format!("{} #{}", VCAM_NAME, slot + 1) }
}

/// ¿Está registrada la cámara virtual de esta ranura?
fn vcam_registered(slot: usize) -> bool {
    let out = hidden("reg").args(["query", DSHOW_VIDEO_INPUTS, "/s"]).output();
    match out {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            let want = vcam_label(slot);
            text.lines().any(|l| l.contains("FriendlyName") && l.trim_end().ends_with(&want))
        }
        Err(_) => false,
    }
}

/// Registra las cámaras virtuales pidiendo permiso de administrador (aparece el aviso de Windows).
#[tauri::command(async)]
fn install_virtual_cameras() -> Result<(), String> {
    let dll32 = find_resource(&["driver", "UnityCaptureFilter32.dll"]).ok_or("Falta driver/UnityCaptureFilter32.dll")?;
    let dll64 = find_resource(&["driver", "UnityCaptureFilter64.dll"]).ok_or("Falta driver/UnityCaptureFilter64.dll")?;

    let args = format!("\"/i:UnityCaptureName={}\" \"/i:UnityCaptureDevices={}\"", VCAM_NAME, VCAM_COUNT);
    let script = format!(
        "@echo off\r\nregsvr32 /s \"{}\" {}\r\nregsvr32 /s \"{}\" {}\r\n",
        dll32.display(), args, dll64.display(), args
    );
    let bat = std::env::temp_dir().join("novacam_register.bat");
    std::fs::write(&bat, script).map_err(|e| format!("No se pudo preparar el registro: {}", e))?;

    let ps = format!(
        "Start-Process -FilePath '{}' -Verb RunAs -Wait -WindowStyle Hidden",
        bat.display()
    );
    let out = hidden("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &ps])
        .output()
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&bat);
    if !out.status.success() {
        return Err("Se canceló el permiso de administrador; no se registraron las cámaras virtuales.".into());
    }
    if vcam_registered(1) {
        Ok(())
    } else {
        Err("Windows no registró cámaras virtuales adicionales. Prueba ejecutar driver/register_novacam.bat como administrador.".into())
    }
}

#[tauri::command(async)]
fn toggle_camera(config: CameraConfig, state: State<'_, AppState>) -> Result<bool, String> {
    let serial = resolve_serial(&config.serial)?;

    let mut old = take_child(&state, &serial, Module::Camera);
    kill_process_tree(&mut old);

    if !config.enabled {
        send_android_notification(&serial, "disconnect");
        return Ok(false);
    }

    let (android, sdk) = android_info(&serial);
    if sdk > 0 && sdk < 31 {
        return Err(format!(
            "Este teléfono tiene Android {}: la cámara requiere Android 12 o superior. La pantalla sí funciona.",
            android
        ));
    }

    let slot = slot_for(&state, &serial)?;
    if slot > 0 && !vcam_registered(slot) {
        // La interfaz instala las cámaras virtuales (con permiso de administrador) y reintenta
        return Err("VCAM_MISSING".to_string());
    }
    send_android_notification(&serial, "connect");

    let (width, height) = match config.resolution {
        1080 => ("1920", "1080"),
        _ => ("1280", "720"),
    };

    let mut cmd = hidden(get_python_path());
    cmd.arg("-u")
        .arg(get_bridge_path())
        .arg("--source").arg("camera")
        .arg("--camera-id").arg(&config.lens)
        .arg("--width").arg(width)
        .arg("--height").arg(height)
        .arg("--fps").arg(config.fps.to_string())
        .arg("--zoom").arg(config.zoom.to_string())
        .arg("--brightness").arg(config.brightness.to_string())
        .arg("--rotate").arg(config.rotate.to_string())
        .arg("--bitrate").arg(if config.resolution == 1080 { "8M" } else { "6M" })
        .arg("--scrcpy").arg(get_scrcpy_path())
        .arg("--ffmpeg").arg(get_ffmpeg_path())
        .arg("--port").arg(port_for(slot).to_string())
        .arg("--token").arg(&state.token)
        .arg("--vcam-index").arg(slot.to_string())
        .arg("--serial").arg(&serial)
        .arg("--no-audio")
        .env("NOVACAM_ADB", get_adb_path())
        .env("PYTHONIOENCODING", "utf-8");

    if config.mirror {
        cmd.arg("--mirror");
    }
    if config.autofocus {
        cmd.arg("--autofocus");
    } else {
        cmd.arg("--no-autofocus");
        cmd.arg("--focus-distance").arg(config.focus_distance.to_string());
    }

    attach_log(&mut cmd, "camera", slot);
    let child = cmd.spawn().map_err(|e| format!("Error al iniciar cámara: {}", e))?;
    put_child(&state, &serial, Module::Camera, child);
    Ok(true)
}

#[tauri::command(async)]
fn toggle_screen(config: ScreenConfig, state: State<'_, AppState>) -> Result<bool, String> {
    let serial = resolve_serial(&config.serial)?;

    let mut old = take_child(&state, &serial, Module::Screen);
    kill_process_tree(&mut old);

    if !config.enabled {
        return Ok(false);
    }

    let slot = slot_for(&state, &serial)?;
    send_android_notification(&serial, "screen");

    let title = if config.label.is_empty() { serial.clone() } else { config.label.clone() };
    let mut cmd = hidden(get_scrcpy_path());
    cmd.arg("--video-source=display")
        .arg(format!("--window-title=NovaCam - Pantalla ({})", title))
        .arg("-s").arg(&serial);

    if config.forward_audio {
        cmd.arg("--audio-source=playback");
    } else {
        cmd.arg("--no-audio");
    }
    if config.stay_awake {
        cmd.arg("--stay-awake");
    }
    if config.turn_screen_off {
        cmd.arg("--turn-screen-off");
    }

    attach_log(&mut cmd, "screen", slot);
    let child = cmd.spawn().map_err(|e| format!("Error al iniciar pantalla: {}", e))?;
    put_child(&state, &serial, Module::Screen, child);
    Ok(true)
}

fn run_set_volume(vol: u32, serial: &str, pid: Option<u32>) {
    let mut cmd = hidden(get_python_path());
    cmd.env("NOVACAM_ADB", get_adb_path());
    cmd.arg(get_set_volume_path()).arg(vol.to_string()).arg(serial);
    if let Some(p) = pid {
        cmd.arg(p.to_string());
    }
    let _ = cmd.status();
}

#[tauri::command(async)]
fn toggle_audio(config: AudioConfig, state: State<'_, AppState>) -> Result<bool, String> {
    let serial = resolve_serial(&config.serial)?;

    let mut old = take_child(&state, &serial, Module::Audio);
    kill_process_tree(&mut old);

    if !config.enabled {
        return Ok(false);
    }

    let (android, sdk) = android_info(&serial);
    if sdk > 0 && sdk < 30 {
        return Err(format!(
            "Este teléfono tiene Android {}: el audio requiere Android 11 o superior.",
            android
        ));
    }

    let slot = slot_for(&state, &serial)?;
    send_android_notification(&serial, "mic");

    let mut cmd = hidden(get_scrcpy_path());
    cmd.arg("--no-video")
        .arg("--no-window") // 100 % en segundo plano
        .arg(format!("--audio-source={}", config.source))
        .arg(format!("--audio-buffer={}", config.buffer_ms))
        .arg(format!("--audio-bit-rate={}", config.bitrate))
        .arg("-s").arg(&serial);

    attach_log(&mut cmd, "audio", slot);
    let child = cmd.spawn().map_err(|e| format!("Error al iniciar micrófono: {}", e))?;
    let pid = child.id();
    put_child(&state, &serial, Module::Audio, child);

    // Volumen inicial, en segundo plano y solo para el proceso de este teléfono
    let vol = config.volume.unwrap_or(100);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        run_set_volume(vol, &serial, Some(pid));
    });
    Ok(true)
}

#[tauri::command(async)]
fn set_mic_volume(volume: u32, serial: String, state: State<'_, AppState>) -> Result<(), String> {
    let serial = resolve_serial(&serial)?;
    let pid = state
        .sessions
        .lock()
        .ok()
        .and_then(|mut s| s.get_mut(&serial).and_then(|x| x.audio.as_ref().map(|c| c.id())));
    std::thread::spawn(move || run_set_volume(volume, &serial, pid));
    Ok(())
}

/// ¿Sigue vivo el proceso? Si murió solo, se libera y se informa (una vez) con la última línea de su log.
fn poll_slot(
    slot_ref: &mut Option<Child>,
    serial: &str,
    module: Module,
    port_slot: usize,
    exited: &mut Vec<ExitInfo>,
) -> bool {
    let state = match slot_ref.as_mut() {
        Some(c) => c.try_wait(),
        None => return false,
    };
    match state {
        Ok(None) => true,
        other => {
            // Código 0 = cierre normal (p. ej. cerraste la ventana de la pantalla): no es un error
            let ok = matches!(&other, Ok(Some(status)) if status.success());
            slot_ref.take();
            exited.push(ExitInfo {
                serial: serial.to_string(),
                module: module.key().to_string(),
                message: if ok { String::new() } else { log_tail(module.key(), port_slot) },
                ok,
            });
            false
        }
    }
}

#[tauri::command]
fn get_modules_status(state: State<'_, AppState>) -> ModulesStatus {
    let slots = slot_snapshot(&state);
    let mut devices = Vec::new();
    let mut exited = Vec::new();
    if let Ok(mut sessions) = state.sessions.lock() {
        for (serial, session) in sessions.iter_mut() {
            let s = slots.get(serial).copied().unwrap_or(0);
            let camera = poll_slot(&mut session.camera, serial, Module::Camera, s, &mut exited);
            let screen = poll_slot(&mut session.screen, serial, Module::Screen, s, &mut exited);
            let audio = poll_slot(&mut session.audio, serial, Module::Audio, s, &mut exited);
            devices.push(DeviceStatus { serial: serial.clone(), camera, screen, audio });
        }
    }
    ModulesStatus { devices, exited }
}

/// Detiene todo lo de un teléfono (p. ej. si se desconectó el cable).
#[tauri::command(async)]
fn stop_device(serial: String, state: State<'_, AppState>) -> Result<(), String> {
    for s in stop_sessions(&state, Some(&serial)) {
        send_android_notification(&s, "disconnect");
    }
    Ok(())
}

/// Detiene todos los teléfonos.
#[tauri::command(async)]
fn stop_all(state: State<'_, AppState>) -> Result<(), String> {
    for s in stop_sessions(&state, None) {
        send_android_notification(&s, "disconnect");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Wi-Fi, foto, información
// ---------------------------------------------------------------------------

/// Activa (serial USB) o desactiva (serial `ip:5555`) el modo inalámbrico de un teléfono concreto.
#[tauri::command(async)]
fn toggle_wifi(serial: String, enable: bool) -> Result<String, String> {
    let adb = get_adb_path();
    let serial = resolve_serial(&serial)?;

    if enable {
        if serial.contains(':') {
            return Err("Este teléfono ya está conectado por Wi-Fi.".into());
        }
        let ip_out = hidden(&adb)
            .args(["-s", &serial, "shell", "ip route | grep wlan0 | head -n 1"])
            .output()
            .map_err(|e| e.to_string())?;

        let ip_text = String::from_utf8_lossy(&ip_out.stdout).to_string();
        let tokens: Vec<&str> = ip_text.split_whitespace().collect();
        let ip = tokens
            .iter()
            .position(|t| *t == "src")
            .and_then(|i| tokens.get(i + 1))
            .or_else(|| tokens.last())
            .map(|s| s.trim().to_string())
            .ok_or("No se detectó IP Wi-Fi en el teléfono")?;

        if ip.is_empty() || ip.contains("error") {
            return Err("No se encontró una conexión Wi-Fi activa en el celular.".into());
        }

        let tcpip = hidden(&adb)
            .args(["-s", &serial, "tcpip", "5555"])
            .status()
            .map_err(|e| e.to_string())?;
        if !tcpip.success() {
            return Err("Fallo al poner ADB en modo TCP/IP.".into());
        }

        std::thread::sleep(std::time::Duration::from_millis(1500));

        let connect_out = hidden(&adb)
            .args(["connect", &format!("{}:5555", ip)])
            .output()
            .map_err(|e| e.to_string())?;
        let connect_text = String::from_utf8_lossy(&connect_out.stdout);
        if connect_text.contains("connected to") {
            Ok(ip)
        } else {
            Err(format!("Fallo al conectar: {}", connect_text.trim()))
        }
    } else {
        if !serial.contains(':') {
            return Err("Este teléfono ya está en modo USB.".into());
        }
        let _ = hidden(&adb).args(["-s", &serial, "usb"]).output();
        std::thread::sleep(std::time::Duration::from_millis(800));
        let _ = hidden(&adb).args(["disconnect", &serial]).output();
        Ok("USB".into())
    }
}

#[tauri::command]
fn get_bridge_info(serial: String, state: State<'_, AppState>) -> Result<BridgeInfo, String> {
    let serial = resolve_serial(&serial)?;
    let slot = slot_for(&state, &serial)?;
    Ok(BridgeInfo { port: port_for(slot), token: state.token.clone() })
}

/// GET mínimo HTTP/1.1 contra el bridge local; devuelve el cuerpo si el estado es 200.
fn bridge_http_get(port: u16, path_and_query: &str) -> Result<Vec<u8>, String> {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2))
        .map_err(|_| "La cámara de este teléfono no está activa. Enciéndela primero.".to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let req = format!(
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        path_and_query, port
    );
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;

    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).map_err(|e| e.to_string())?;

    let split = buf.windows(4).position(|w| w == b"\r\n\r\n")
        .ok_or("Respuesta inválida del bridge")?;
    let head = String::from_utf8_lossy(&buf[..split]);
    if !head.lines().next().unwrap_or("").contains(" 200") {
        return Err("La cámara aún no tiene imagen. Espera un momento e inténtalo otra vez.".into());
    }
    Ok(buf[split + 4..].to_vec())
}

fn pictures_dir() -> PathBuf {
    if let Ok(home) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(home).join("Pictures");
        if p.is_dir() { return p; }
    }
    std::env::temp_dir()
}

/// Captura un fotograma a resolución completa de la cámara de ese teléfono (con los filtros aplicados).
#[tauri::command(async)]
fn take_photo(serial: String, state: State<'_, AppState>) -> Result<String, String> {
    let serial = resolve_serial(&serial)?;
    let slot = slot_for(&state, &serial)?;
    let jpg = bridge_http_get(port_for(slot), &format!("/photo?token={}", state.token))?;
    if jpg.len() < 4 || jpg[0] != 0xFF || jpg[1] != 0xD8 {
        return Err("El bridge no devolvió una imagen válida".into());
    }
    let target = pictures_dir().join(format!("NovaCam_{}.jpg", timestamp_name()));
    std::fs::write(&target, &jpg).map_err(|e| format!("Error guardando la foto: {}", e))?;
    Ok(target.to_string_lossy().to_string())
}

/// Fecha y hora UTC como YYYYMMDD_HHMMSS (sin dependencias externas).
fn timestamp_name() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{:04}{:02}{:02}_{:02}{:02}{:02}", y, m, d, rem / 3600, (rem % 3600) / 60, rem % 60)
}

#[tauri::command(async)]
fn get_device_info(serial: String) -> Result<DeviceInfo, String> {
    let adb = get_adb_path();
    let serial = resolve_serial(&serial)?;

    let model = hidden(&adb)
        .args(["-s", &serial, "shell", "getprop", "ro.product.model"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Dispositivo Android".to_string());

    let mut battery = 0u32;
    if let Ok(out) = hidden(&adb).args(["-s", &serial, "shell", "dumpsys", "battery"]).output() {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            if let Some(val) = line.trim().strip_prefix("level:") {
                if let Ok(v) = val.trim().parse::<u32>() {
                    battery = v;
                    break;
                }
            }
        }
    }
    Ok(DeviceInfo { model, battery })
}

#[tauri::command(async)]
fn list_devices() -> Vec<DiscoveredDevice> {
    adb_devices()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = hidden(get_adb_path()).arg("start-server").output();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(AppState::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                if let Some(state) = app.try_state::<AppState>() {
                    stop_sessions(&state, None);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            toggle_camera,
            toggle_screen,
            toggle_audio,
            set_mic_volume,
            stop_all,
            stop_device,
            list_devices,
            toggle_wifi,
            take_photo,
            get_device_info,
            get_bridge_info,
            get_modules_status,
            install_virtual_cameras
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
