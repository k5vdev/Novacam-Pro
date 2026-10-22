function getInvoke() {
  if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === "function") {
    return window.__TAURI__.core.invoke;
  }
  return null;
}

// Puerto y token del bridge local de cada teléfono (los asigna el backend Rust)
const bridgeInfos = {};
async function bridgeUrl(path, params, serial = getSerial()) {
  if (!bridgeInfos[serial]) {
    const invoke = getInvoke();
    if (!invoke) throw new Error("Tauri no disponible");
    bridgeInfos[serial] = await invoke("get_bridge_info", { serial });
  }
  const info = bridgeInfos[serial];
  const q = new URLSearchParams(params || {});
  q.set("token", info.token);
  return `http://127.0.0.1:${info.port}${path}?${q.toString()}`;
}

// UI Elements - Modules
const camToggle = document.getElementById("camToggle");
const camBadge = document.getElementById("camBadge");
const camCard = document.getElementById("camCard");

const screenToggle = document.getElementById("screenToggle");
const screenBadge = document.getElementById("screenBadge");
const screenCard = document.getElementById("screenCard");

const micToggle = document.getElementById("micToggle");
const micBadge = document.getElementById("micBadge");
const micCard = document.getElementById("micCard");

// UI Elements - Tabs
const paneCamera = document.getElementById("paneCamera");
const paneScreen = document.getElementById("paneScreen");
const paneMic = document.getElementById("paneMic");

// UI Elements - Camera Config
const resSelect = document.getElementById("resSelect");
const lensSelect = document.getElementById("lensSelect");
const fpsSelect = document.getElementById("fpsSelect");
const rotSelect = document.getElementById("rotSelect");
const zoomRange = document.getElementById("zoomRange");
const zoomVal = document.getElementById("zoomVal");
const brightRange = document.getElementById("brightRange");
const brightVal = document.getElementById("brightVal");
const mirrorToggle = document.getElementById("mirrorToggle");
const autofocusToggle = document.getElementById("autofocusToggle");
const focusRange = document.getElementById("focusRange");
const focusVal = document.getElementById("focusVal");
const quickFocusBtn = document.getElementById("quickFocusBtn");

// UI Elements - Screen Config
const stayAwakeToggle = document.getElementById("stayAwakeToggle");
const turnOffScreenToggle = document.getElementById("turnOffScreenToggle");
const screenAudioToggle = document.getElementById("screenAudioToggle");

// UI Elements - Mic Config
const micIcon = document.getElementById("micIcon");
const micTitle = document.getElementById("micTitle");
const systemAudioToggle = document.getElementById("systemAudioToggle");
const micSourceSelect = document.getElementById("micSourceSelect");
const micBufferSelect = document.getElementById("micBufferSelect");
const micBitrateSelect = document.getElementById("micBitrateSelect");
const micVolRange = document.getElementById("micVolRange");
const micVolVal = document.getElementById("micVolVal");

// UI Elements - Preview & Toolbar
const previewCard = document.getElementById("previewCard");
const previewImg = document.getElementById("previewImg");
const previewPlaceholder = document.getElementById("previewPlaceholder");
const previewStatusMsg = document.getElementById("previewStatusMsg");
const togglePreviewBtn = document.getElementById("togglePreviewBtn");
const floatPreviewBtn = document.getElementById("floatPreviewBtn");
const fitToggleBtn = document.getElementById("fitToggleBtn");
const fitText = document.getElementById("fitText");
const aspectRatioSelect = document.getElementById("aspectRatioSelect");
const quickFlipLensBtn = document.getElementById("quickFlipLensBtn");
const quickFocusText = document.getElementById("quickFocusText");
const previewLiveBadge = document.getElementById("previewLiveBadge");
const previewPillText = document.getElementById("previewPillText");
const previewHint = document.getElementById("previewHint");
const connIconSvg = document.getElementById("connIconSvg");

// UI Elements - Bottom
const photoBtn = document.getElementById("photoBtn");
const stopAllBtn = document.getElementById("stopAllBtn");
const streamPulse = document.getElementById("streamPulse");
const statusText = document.getElementById("statusText");

// Connection & Battery
const wifiBtn = document.getElementById("wifiBtn");
const connIcon = document.getElementById("connIcon");
const connText = document.getElementById("connText");
const deviceStatus = document.getElementById("deviceStatus");
const statusDot = document.getElementById("statusDot");
const deviceBatteryWrap = document.getElementById("deviceBatteryWrap");
const deviceBattery = document.getElementById("deviceBattery");
const deviceModelBadge = document.getElementById("deviceModelBadge");
const deviceStrip = document.getElementById("deviceStrip");

// Image & Color Controls
const contrastRange = document.getElementById("contrastRange");
const contrastVal = document.getElementById("contrastVal");
const satRange = document.getElementById("satRange");
const satVal = document.getElementById("satVal");
const warmthRange = document.getElementById("warmthRange");
const warmthVal = document.getElementById("warmthVal");
const sharpRange = document.getElementById("sharpRange");
const sharpVal = document.getElementById("sharpVal");
const resetColorBtn = document.getElementById("resetColorBtn");

let isFitCover = false;

// ---------- Varios teléfonos: cada uno funciona por separado, todo en esta ventana ----------
let devices = [];          // teléfonos listos (adb "device")
let unauthorizedCount = 0; // teléfonos que aún no aceptaron la depuración USB
let selectedSerial = "";   // teléfono que se está controlando ahora
let pendingSelect = "";    // serial a seleccionar cuando aparezca (p. ej. tras activar Wi-Fi)
let restoring = false;
const devStatus = {};      // serial -> {camera, screen, audio} según el backend
const devSettings = {};    // serial -> ajustes de la interfaz de ese teléfono
const devBattery = {};     // serial -> %

function getSerial() {
  return selectedSerial;
}
function deviceOf(serial) {
  return devices.find((d) => d.serial === serial);
}
function deviceName(serial) {
  const d = deviceOf(serial);
  return d ? d.model : serial;
}
function isLive(serial) {
  const st = devStatus[serial];
  return !!(st && (st.camera || st.screen || st.audio));
}

// Parámetros en tiempo real (Cero parpadeo, cero recargas de cámara)
let liveParamsTimer = null;
function sendLiveParams() {
  if (!camToggle.checked || restoring || !getSerial()) return;
  clearTimeout(liveParamsTimer);
  liveParamsTimer = setTimeout(async () => {
    const params = {
      zoom: zoomRange.value,
      brightness: brightRange.value,
      contrast: contrastRange ? contrastRange.value : "1.0",
      sat: satRange ? satRange.value : "1.0",
      warmth: warmthRange ? warmthRange.value : "0",
      sharp: sharpRange ? sharpRange.value : "0.0",
      mirror: mirrorToggle.checked ? "1" : "0",
      af: autofocusToggle ? (autofocusToggle.checked ? "1" : "0") : "1",
      focus: focusRange ? focusRange.value : "50"
    };
    try {
      fetch(await bridgeUrl("/params", params)).catch(() => {});
    } catch (_) {}
  }, 15);
}

// Live Sliders en tiempo real continuo
zoomRange.addEventListener("input", (e) => {
  zoomVal.textContent = parseFloat(e.target.value).toFixed(1) + "x";
  sendLiveParams();
});

brightRange.addEventListener("input", (e) => {
  const val = parseFloat(e.target.value);
  if (Math.abs(val) < 0.01) {
    brightVal.textContent = "Normal";
  } else if (val > 0) {
    brightVal.textContent = `+${Math.round(val * 100)}%`;
  } else {
    brightVal.textContent = `${Math.round(val * 100)}%`;
  }
  sendLiveParams();
});

if (contrastRange) {
  contrastRange.addEventListener("input", (e) => {
    if (contrastVal) contrastVal.textContent = parseFloat(e.target.value).toFixed(2) + "x";
    sendLiveParams();
  });
}

if (satRange) {
  satRange.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    if (satVal) satVal.textContent = Math.round(val * 100) + "%";
    sendLiveParams();
  });
}

if (warmthRange) {
  warmthRange.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    if (warmthVal) {
      if (val > 0) warmthVal.textContent = `+${val} (Cálido)`;
      else if (val < 0) warmthVal.textContent = `${val} (Frío)`;
      else warmthVal.textContent = "Neutro";
    }
    sendLiveParams();
  });
}

if (sharpRange) {
  sharpRange.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    if (sharpVal) sharpVal.textContent = Math.round(val * 100) + "%";
    sendLiveParams();
  });
}

if (resetColorBtn) {
  resetColorBtn.addEventListener("click", () => {
    if (brightRange) {
      brightRange.value = "0.0";
      brightVal.textContent = "Normal";
    }
    if (contrastRange) {
      contrastRange.value = "1.0";
      contrastVal.textContent = "1.0x";
    }
    if (satRange) {
      satRange.value = "1.0";
      satVal.textContent = "100%";
    }
    if (warmthRange) {
      warmthRange.value = "0";
      warmthVal.textContent = "Neutro";
    }
    if (sharpRange) {
      sharpRange.value = "0.0";
      sharpVal.textContent = "0%";
    }
    sendLiveParams();
  });
}

mirrorToggle.addEventListener("change", () => {
  sendLiveParams();
});

let micVolDebounce = null;
if (micVolRange) {
  micVolRange.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    if (micVolVal) micVolVal.textContent = val + "%";
    clearTimeout(micVolDebounce);
    micVolDebounce = setTimeout(async () => {
      const invoke = getInvoke();
      if (invoke) {
        try {
          await invoke("set_mic_volume", { volume: val, serial: getSerial() });
        } catch (err) {
          console.error("Error setting volume:", err);
        }
      }
    }, 40);
  });
}

// Tab Switching: la tarjeta del módulo abre sus ajustes
function switchTab(name) {
  const map = {
    camera: [camCard, paneCamera],
    screen: [screenCard, paneScreen],
    mic: [micCard, paneMic]
  };
  for (const [key, [card, pane]] of Object.entries(map)) {
    card.classList.toggle("selected", key === name);
    card.setAttribute("aria-selected", key === name ? "true" : "false");
    pane.classList.toggle("active", key === name);
  }
}

[camCard, screenCard, micCard].forEach((card) => {
  card.addEventListener("click", (e) => {
    if (e.target.closest(".switch")) return;
    switchTab(card.dataset.tab);
  });
  card.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === card) {
      e.preventDefault();
      switchTab(card.dataset.tab);
    }
  });
  // Al encender un módulo se muestran sus ajustes
  card.addEventListener("change", (e) => {
    if (e.target.matches(".module-row input") && e.target.checked) switchTab(card.dataset.tab);
  });
});

// Aspect Ratio & Fit Controls
if (aspectRatioSelect) {
  aspectRatioSelect.addEventListener("change", (e) => {
    previewCard.classList.remove("aspect-16-9", "aspect-4-3", "aspect-9-16");
    previewCard.classList.add(`aspect-${e.target.value}`);
  });
}

if (fitToggleBtn) {
  fitToggleBtn.addEventListener("click", () => {
    isFitCover = !isFitCover;
    if (isFitCover) {
      previewImg.classList.remove("fit-contain");
      previewImg.classList.add("fit-cover");
      if (fitText) fitText.textContent = "Llenar";
    } else {
      previewImg.classList.remove("fit-cover");
      previewImg.classList.add("fit-contain");
      if (fitText) fitText.textContent = "Ajustar";
    }
  });
}

// Instant Lens Flip (Front/Rear)
if (quickFlipLensBtn) {
  quickFlipLensBtn.addEventListener("click", async () => {
    const nextLens = lensSelect.value === "0" ? "1" : "0";
    lensSelect.value = nextLens;
    lensSelect.dispatchEvent(new Event("change")); // recarga la cámara si está activa y sincroniza el selector
  });
}

// Update Master Status Display
function updateMasterStatus() {
  if (Object.values(MODS).some((m) => m.badge.classList.contains("loading"))) {
    statusText.textContent = "Iniciando…";
    streamPulse.classList.remove("active");
    streamPulse.classList.add("idle");
    return;
  }
  const active = [];
  if (camToggle.checked) active.push("Cámara");
  if (screenToggle.checked) active.push("Pantalla");
  if (micToggle.checked) {
    active.push(systemAudioToggle && systemAudioToggle.checked ? "Audio Sistema" : "Micrófono");
  }

  if (active.length > 0) {
    const others = devices.filter((d) => d.serial !== selectedSerial && isLive(d.serial)).length;
    statusText.textContent = `En vivo · ${active.join(" + ")}` + (others ? ` · +${others} teléfono${others > 1 ? "s" : ""}` : "");
    streamPulse.classList.remove("idle");
    streamPulse.classList.add("active");
  } else {
    const others = devices.filter((d) => d.serial !== selectedSerial && isLive(d.serial)).length;
    statusText.textContent = others
      ? `${others} teléfono${others > 1 ? "s" : ""} en vivo en segundo plano`
      : "Listo para transmitir";
    streamPulse.classList.toggle("active", others > 0);
    streamPulse.classList.toggle("idle", others === 0);
  }
}

// In-App Preview (Snapshot swapping de latencia CERO - Sin búferes de red en WebView2)
let previewRafId = null;
let previewActive = false;
let isFetchingSnapshot = false;
let lastFrameId = null;

async function loopSnapshotPreview() {
  if (!previewActive || !camToggle.checked) return;
  if (isFetchingSnapshot) {
    previewRafId = requestAnimationFrame(loopSnapshotPreview);
    return;
  }
  isFetchingSnapshot = true;
  try {
    const res = await fetch(await bridgeUrl("/snapshot", { t: Date.now() }), { cache: "no-store" });
    if (res.ok) {
      // Mismo fotograma que el anterior: no decodificar ni tocar el DOM
      const fid = res.headers.get("X-Frame-Id");
      if (fid !== null && fid === lastFrameId) {
        if (res.body) res.body.cancel().catch(() => {});
        await new Promise((r) => setTimeout(r, 12));
        return;
      }
      lastFrameId = fid;
      const blob = await res.blob();
      const newUrl = URL.createObjectURL(blob);
      const oldUrl = previewImg.src;
      previewImg.src = newUrl;
      previewImg.style.display = "block";
      previewPlaceholder.style.display = "none";
      if (oldUrl && oldUrl.startsWith("blob:")) {
        URL.revokeObjectURL(oldUrl);
      }
      if (previewLiveBadge && !previewLiveBadge.classList.contains("streaming")) {
        previewLiveBadge.classList.add("streaming");
        previewCard.classList.add("live");
        hidePreviewLoading();
        if (previewPillText) {
          previewPillText.textContent = "EN VIVO · " + (resSelect.value || "720") + "p";
        }
      }
    }
  } catch (e) {
    // Micro-corte temporal ignorado
  } finally {
    isFetchingSnapshot = false;
    if (previewActive && camToggle.checked) {
      previewRafId = requestAnimationFrame(loopSnapshotPreview);
    }
  }
}

function startInAppPreview() {
  if (!camToggle.checked) {
    previewStatusMsg.textContent = "Activa la Cámara primero";
    return;
  }

  stopInAppPreview();
  setIcon(togglePreviewBtn, "eye");
  previewActive = true;
  showPreviewLoading("Iniciando cámara…", "Conectando con el teléfono. Suele tardar unos segundos.");

  let attempts = 0;
  const initInterval = setInterval(async () => {
    if (!camToggle.checked || !previewActive) {
      clearInterval(initInterval);
      return;
    }
    attempts++;
    try {
      const res = await fetch(await bridgeUrl("/snapshot", { t: Date.now() }), { cache: "no-store" });
      if (res.ok) {
        clearInterval(initInterval);
        setModuleState("camera", "active", "En vivo");
        updateMasterStatus();
        loopSnapshotPreview();
        return;
      }
    } catch (e) {
      // el bridge aún no está escuchando
    }
    if (attempts === 1 || attempts % 4 === 0) {
      previewStatusMsg.textContent = attempts < 12 ? "Iniciando cámara…" : "Sigue conectando…";
    }
    if (attempts === 100) {
      clearInterval(initInterval);
      notify("Error: la cámara no responde. Desbloquea el teléfono y revisa que ninguna otra app use la cámara.");
      hidePreviewLoading();
      previewStatusMsg.textContent = "Sin señal de la cámara";
      setModuleState("camera", "loading", "Sin señal");
    }
  }, 250);
}

function stopInAppPreview() {
  previewActive = false;
  if (previewRafId) {
    cancelAnimationFrame(previewRafId);
    previewRafId = null;
  }
  isFetchingSnapshot = false;
  if (previewImg.src && previewImg.src.startsWith("blob:")) {
    URL.revokeObjectURL(previewImg.src);
  }
  previewImg.src = "";
  hidePreviewLoading();
  lastFrameId = null;
  previewCard.classList.remove("live");
  setIcon(togglePreviewBtn, "eye-off");
  previewImg.style.display = "none";
  previewPlaceholder.style.display = "flex";
  previewStatusMsg.textContent = "Vista previa apagada";
  if (previewLiveBadge) {
    previewLiveBadge.classList.remove("streaming");
    if (previewPillText) previewPillText.textContent = "OFFLINE";
  }
}

// Hot-Reload Camera (Reinicio imperceptible y limpio)
let reloadDebounceTimer = null;
async function reloadCamera() {
  if (!camToggle.checked) return;
  const invoke = getInvoke();
  if (!invoke) return;

  stopInAppPreview();
  setModuleState("camera", "loading", "Aplicando…");
  previewStatusMsg.textContent = "Aplicando ajustes…";
  if (previewLiveBadge) {
    previewLiveBadge.classList.remove("streaming");
    if (previewPillText) previewPillText.textContent = "ACTUALIZANDO...";
  }

  const rotVal = parseInt(rotSelect.value);
  // Adaptar relación de aspecto automáticamente si se rota a vertical
  if (rotVal === 90 || rotVal === 270) {
    previewCard.classList.remove("aspect-16-9", "aspect-4-3");
    previewCard.classList.add("aspect-9-16");
  } else {
    previewCard.classList.remove("aspect-9-16");
    const currentAr = (aspectRatioSelect && aspectRatioSelect.value !== "9-16") ? aspectRatioSelect.value : "16-9";
    previewCard.classList.add(`aspect-${currentAr}`);
  }

  const config = {
    enabled: true,
    resolution: parseInt(resSelect.value),
    lens: lensSelect.value,
    fps: parseInt(fpsSelect.value),
    rotate: rotVal,
    zoom: parseFloat(zoomRange.value),
    brightness: parseFloat(brightRange.value),
    mirror: mirrorToggle.checked,
    autofocus: autofocusToggle ? autofocusToggle.checked : true,
    focus_distance: focusRange ? parseFloat(focusRange.value) : 50.0,
    audio_enabled: micToggle.checked,
    audio_source: getActiveAudioSource(),
    audio_buffer_ms: parseInt(micBufferSelect.value),
    audio_bitrate: micBitrateSelect.value,
    serial: getSerial()
  };

  try {
    await invokeCamera(invoke, config);
    startInAppPreview();
  } catch (err) {
    console.error("Error al recargar cámara:", err);
    notify("Error con Cámara: " + err);
    setModuleState("camera", "idle");
  }
}

function scheduleCameraReload() {
  if (!camToggle.checked) return;
  clearTimeout(reloadDebounceTimer);
  reloadDebounceTimer = setTimeout(reloadCamera, 300);
}

// Controles estructurales -> Solo los cambios de lente, resolución, fps o rotación recargan la cámara
resSelect.addEventListener("change", reloadCamera);
lensSelect.addEventListener("change", reloadCamera);
fpsSelect.addEventListener("change", reloadCamera);
rotSelect.addEventListener("change", reloadCamera);

// Focus Controls & Feedback
function updateFocusUI() {
  if (!autofocusToggle) return;
  const isAF = autofocusToggle.checked;
  if (isAF) {
    if (focusRange) focusRange.disabled = true;
    if (focusVal) focusVal.textContent = "Automático (AF)";
    if (quickFocusText) quickFocusText.textContent = "AF: Auto";
  } else {
    if (focusRange) focusRange.disabled = false;
    const val = focusRange ? parseInt(focusRange.value) : 50;
    if (focusVal) {
      if (val < 40) {
        focusVal.textContent = `Macro (${val}%)`;
      } else if (val > 60) {
        focusVal.textContent = `Infinito (${val}%)`;
      } else {
        focusVal.textContent = `Estándar (${val}%)`;
      }
    }
    if (quickFocusText) quickFocusText.textContent = `MF: ${val}%`;
  }
}

if (autofocusToggle) {
  autofocusToggle.addEventListener("change", () => {
    updateFocusUI();
    sendLiveParams();
  });
}

if (focusRange) {
  focusRange.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    if (focusVal) {
      if (val < 40) {
        focusVal.textContent = `Macro (${val}%)`;
      } else if (val > 60) {
        focusVal.textContent = `Infinito (${val}%)`;
      } else {
        focusVal.textContent = `Estándar (${val}%)`;
      }
    }
    if (quickFocusText) quickFocusText.textContent = `MF: ${val}%`;
    sendLiveParams();
  });
}

if (quickFocusBtn) {
  quickFocusBtn.addEventListener("click", () => {
    if (autofocusToggle) {
      autofocusToggle.checked = !autofocusToggle.checked;
      updateFocusUI();
      sendLiveParams();
    }
  });
}

// Module 1: Camera Toggle
camToggle.addEventListener("change", async () => {
  const invoke = getInvoke();
  if (!invoke) return;

  const enabled = camToggle.checked;
  if (enabled && !getSerial()) {
    notify("Conecta un teléfono primero.");
    camToggle.checked = false;
    return;
  }
  const config = {
    enabled,
    resolution: parseInt(resSelect.value),
    lens: lensSelect.value,
    fps: parseInt(fpsSelect.value),
    rotate: parseInt(rotSelect.value),
    zoom: parseFloat(zoomRange.value),
    brightness: parseFloat(brightRange.value),
    mirror: mirrorToggle.checked,
    autofocus: autofocusToggle ? autofocusToggle.checked : true,
    focus_distance: focusRange ? parseFloat(focusRange.value) : 50.0,
    audio_enabled: micToggle.checked,
    audio_source: getActiveAudioSource(),
    audio_buffer_ms: parseInt(micBufferSelect.value),
    audio_bitrate: micBitrateSelect.value,
    serial: getSerial()
  };

  camToggle.disabled = true;
  setModuleState("camera", "loading", enabled ? "Iniciando…" : "Deteniendo…");
  if (enabled) showPreviewLoading("Iniciando cámara…", "Conectando con el teléfono. Suele tardar unos segundos.");
  try {
    await invokeCamera(invoke, config);
    if (enabled) {
      setModuleState("camera", "loading", "Conectando…");
      startInAppPreview(); // pasa a "En vivo" cuando llega el primer fotograma
    } else {
      setModuleState("camera", "idle");
      stopInAppPreview();
    }
  } catch (err) {
    notify("Error con Cámara: " + err);
    camToggle.checked = !enabled;
    setModuleState("camera", "idle");
    stopInAppPreview();
  } finally {
    camToggle.disabled = false;
  }
  updateMasterStatus();
});

// Module 2: Screen Toggle
screenToggle.addEventListener("change", async () => {
  const invoke = getInvoke();
  if (!invoke) return;

  const enabled = screenToggle.checked;
  if (enabled && !getSerial()) {
    notify("Conecta un teléfono primero.");
    screenToggle.checked = false;
    return;
  }
  const config = {
    enabled,
    stay_awake: stayAwakeToggle.checked,
    turn_screen_off: turnOffScreenToggle.checked,
    forward_audio: screenAudioToggle ? screenAudioToggle.checked : true,
    label: deviceName(getSerial()),
    serial: getSerial()
  };

  screenToggle.disabled = true;
  setModuleState("screen", "loading", enabled ? "Iniciando…" : "Deteniendo…");
  try {
    await invoke("toggle_screen", { config });
    if (enabled) {
      settleActive("screen", screenToggle, "En vivo");
    } else {
      setModuleState("screen", "idle");
    }
  } catch (err) {
    notify("Error con Control de Pantalla: " + err);
    screenToggle.checked = !enabled;
    setModuleState("screen", "idle");
  } finally {
    screenToggle.disabled = false;
  }
  updateMasterStatus();
});

if (screenAudioToggle) {
  screenAudioToggle.addEventListener("change", async () => {
    if (!screenToggle.checked) return;
    const invoke = getInvoke();
    if (!invoke) return;
    const config = {
      enabled: true,
      stay_awake: stayAwakeToggle.checked,
      turn_screen_off: turnOffScreenToggle.checked,
      forward_audio: screenAudioToggle.checked,
      label: deviceName(getSerial()),
      serial: getSerial()
    };
    try {
      await invoke("toggle_screen", { config });
    } catch (err) {
      console.error("Error al actualizar audio de pantalla:", err);
    }
  });
}

// Module 3: Audio (Mic / Sistema)
function getActiveAudioSource() {
  if (systemAudioToggle && systemAudioToggle.checked) {
    return "playback";
  }
  return micSourceSelect.value;
}

function updateAudioUIState() {
  const isSysAudio = systemAudioToggle && systemAudioToggle.checked;
  if (isSysAudio) {
    if (micTitle) micTitle.textContent = "Audio Sistema";
    if (micIcon) micIcon.setAttribute("data-lucide", "volume-2");
    if (micBadge && micToggle.checked) micBadge.textContent = "Sistema";
  } else {
    if (micTitle) micTitle.textContent = "Audio / Mic";
    if (micIcon) micIcon.setAttribute("data-lucide", "mic");
    if (micBadge && micToggle.checked) micBadge.textContent = "Voz";
  }
  if (window.lucide) window.lucide.createIcons();
}

async function updateAudioStream() {
  updateAudioUIState();
  if (!micToggle.checked) return;
  const invoke = getInvoke();
  if (!invoke) return;

  const config = {
    enabled: true,
    source: getActiveAudioSource(),
    buffer_ms: parseInt(micBufferSelect.value),
    bitrate: micBitrateSelect.value,
    volume: parseInt(micVolRange.value),
    serial: getSerial()
  };

  try {
    await invoke("toggle_audio", { config });
  } catch (err) {
    console.error("Error al actualizar audio:", err);
  }
}

if (systemAudioToggle) {
  systemAudioToggle.addEventListener("change", async () => {
    updateAudioUIState();
    if (systemAudioToggle.checked && !micToggle.checked) {
      micToggle.checked = true;
      setModuleState("mic", "active", "Sistema");
    }
    await updateAudioStream();
    updateMasterStatus();
  });
}

micToggle.addEventListener("change", async () => {
  const invoke = getInvoke();
  if (!invoke) return;

  const enabled = micToggle.checked;
  if (enabled && !getSerial()) {
    notify("Conecta un teléfono primero.");
    micToggle.checked = false;
    return;
  }
  updateAudioUIState();

  micToggle.disabled = true;
  setModuleState("mic", "loading", enabled ? "Iniciando…" : "Deteniendo…");
  try {
    const config = {
      enabled,
      source: getActiveAudioSource(),
      buffer_ms: parseInt(micBufferSelect.value),
      bitrate: micBitrateSelect.value,
      volume: parseInt(micVolRange.value),
      serial: getSerial()
    };
    await invoke("toggle_audio", { config });

    if (enabled) {
      settleActive("mic", micToggle, (systemAudioToggle && systemAudioToggle.checked) ? "Sistema" : "Voz");
    } else {
      setModuleState("mic", "idle");
    }
  } catch (err) {
    notify("Error con Audio: " + err);
    micToggle.checked = !enabled;
    setModuleState("mic", "idle");
  } finally {
    micToggle.disabled = false;
  }
  updateMasterStatus();
});

micSourceSelect.addEventListener("change", updateAudioStream);
micBufferSelect.addEventListener("change", updateAudioStream);
micBitrateSelect.addEventListener("change", updateAudioStream);

// Floating Preview Window eliminada (ahora 100% integrado en la app principal)
if (floatPreviewBtn) {
  floatPreviewBtn.style.display = "none";
}

togglePreviewBtn.addEventListener("click", () => {
  if (!camToggle.checked) {
    notify("Activa el interruptor de Cámara primero.");
    return;
  }
  if (previewImg.style.display === "block") {
    stopInAppPreview();
    previewStatusMsg.textContent = "Vista previa pausada (Clic para ver)";
  } else {
    startInAppPreview();
  }
});

previewPlaceholder.addEventListener("click", () => {
  if (camToggle.checked) {
    startInAppPreview();
  }
});

// Detener: con varios teléfonos solo detiene el seleccionado; los demás siguen en vivo
stopAllBtn.addEventListener("click", async () => {
  const invoke = getInvoke();
  if (!invoke) return;
  const serial = getSerial();

  try {
    if (serial && devices.length > 1) {
      await invoke("stop_device", { serial });
    } else {
      await invoke("stop_all");
    }
  } catch (err) {
    console.error(err);
  }

  if (devices.length > 1 && serial) {
    devStatus[serial] = { serial, camera: false, screen: false, audio: false };
  } else {
    Object.keys(devStatus).forEach((k) => delete devStatus[k]);
  }
  stopInAppPreview();
  syncModulesFromStatus();
});

// Photo capture
photoBtn.addEventListener("click", async () => {
  const invoke = getInvoke();
  if (!invoke) return;
  if (!camToggle.checked) {
    notify("Activa la cámara primero para tomar una foto.");
    return;
  }
  photoBtn.disabled = true;
  try {
    const path = await invoke("take_photo", { serial: getSerial() });
    notify("¡Foto guardada en:\n" + path);
  } catch (err) {
    notify("Error al capturar foto: " + err);
  } finally {
    photoBtn.disabled = false;
  }
});

// Wi-Fi: actúa sobre el teléfono seleccionado (USB -> activa Wi-Fi, Wi-Fi -> vuelve a USB)
wifiBtn.addEventListener("click", async () => {
  const serial = getSerial();
  if (!serial) {
    notify("Conecta un teléfono primero.");
    return;
  }
  if (camToggle.checked || screenToggle.checked || micToggle.checked) {
    notify("Detén las transmisiones de este teléfono antes de cambiar de conexión.");
    return;
  }
  const invoke = getInvoke();
  if (!invoke) return;

  const dev = deviceOf(serial);
  const viaWifi = !!dev && dev.connection_type === "Wi-Fi";
  wifiBtn.disabled = true;
  connText.textContent = viaWifi ? "Cambiando…" : "Conectando…";
  try {
    if (!viaWifi) {
      const ip = await invoke("toggle_wifi", { serial, enable: true });
      pendingSelect = `${ip}:5555`;
      notify(`¡Wi-Fi activado en ${ip}! Ya puedes desconectar el cable USB.`);
    } else {
      await invoke("toggle_wifi", { serial, enable: false });
      notify("¡Teléfono de vuelta en modo USB!");
    }
  } catch (err) {
    notify("No se pudo cambiar la conexión: " + err);
  } finally {
    wifiBtn.disabled = false;
    renderDeviceUI();
  }
});

// ---------- Ajustes por teléfono ----------
const SETTING_VALUES = ["resSelect", "lensSelect", "fpsSelect", "rotSelect", "micSourceSelect", "micBufferSelect",
  "micBitrateSelect", "zoomRange", "brightRange", "contrastRange", "satRange", "warmthRange", "sharpRange",
  "focusRange", "micVolRange"];
const SETTING_CHECKS = ["mirrorToggle", "autofocusToggle", "stayAwakeToggle", "turnOffScreenToggle",
  "screenAudioToggle", "systemAudioToggle"];

function captureSettings() {
  const o = { values: {}, checks: {} };
  SETTING_VALUES.forEach((id) => { o.values[id] = document.getElementById(id).value; });
  SETTING_CHECKS.forEach((id) => { o.checks[id] = document.getElementById(id).checked; });
  return o;
}

function applySettings(o) {
  restoring = true;
  try {
    SETTING_VALUES.forEach((id) => { if (id in o.values) document.getElementById(id).value = o.values[id]; });
    SETTING_CHECKS.forEach((id) => { if (id in o.checks) document.getElementById(id).checked = o.checks[id]; });
    ["zoomRange", "brightRange", "contrastRange", "satRange", "warmthRange", "sharpRange", "focusRange"].forEach((id) => {
      document.getElementById(id).dispatchEvent(new Event("input")); // actualiza etiqueta y relleno
    });
    micVolVal.textContent = micVolRange.value + "%";
    fillRange(micVolRange);
    document.querySelectorAll(".seg").forEach((seg) => {
      const sel = document.getElementById(seg.dataset.for);
      if (sel) syncSeg(seg, sel);
    });
    updateFocusUI();
    updateAudioUIState();
  } finally {
    restoring = false;
  }
}

// Refleja en la interfaz lo que corre en el teléfono seleccionado
function syncModulesFromStatus() {
  const st = devStatus[selectedSerial] || {};
  camToggle.checked = !!st.camera;
  screenToggle.checked = !!st.screen;
  micToggle.checked = !!st.audio;
  if (st.camera) setModuleState("camera", "loading", "Conectando…"); else setModuleState("camera", "idle");
  if (st.screen) setModuleState("screen", "active", "En vivo"); else setModuleState("screen", "idle");
  if (st.audio) setModuleState("mic", "active", systemAudioToggle && systemAudioToggle.checked ? "Sistema" : "Voz"); else setModuleState("mic", "idle");
  if (st.camera) {
    startInAppPreview();
    sendLiveParams();
  } else {
    stopInAppPreview();
  }
  updateAudioUIState();
  updateMasterStatus();
}

function selectDevice(serial) {
  if (serial === selectedSerial) return;
  if (selectedSerial) devSettings[selectedSerial] = captureSettings();
  selectedSerial = serial;
  if (serial && devSettings[serial]) applySettings(devSettings[serial]);
  syncModulesFromStatus();
  refreshBattery();
  renderDeviceUI();
}

// ---------- Cabecera y tira de teléfonos ----------
let stripKey = "";
function renderDeviceUI() {
  const dev = deviceOf(selectedSerial);
  const online = !!dev;

  deviceStatus.classList.toggle("online", online);
  deviceStatus.classList.toggle("offline", !online);
  statusDot.classList.toggle("online", online);
  statusDot.classList.toggle("offline", !online);
  deviceBatteryWrap.style.display = online ? "inline-flex" : "none";

  if (online) {
    deviceModelBadge.textContent = devices.length > 1 ? dev.model : "Conectado · " + dev.model;
    const b = devBattery[selectedSerial];
    deviceBattery.textContent = b > 0 ? `${b}%` : "--%";
  } else {
    deviceModelBadge.textContent = unauthorizedCount ? "Autoriza el teléfono" : "Sin teléfono";
  }

  // Conexión del teléfono seleccionado
  const viaWifi = online && dev.connection_type === "Wi-Fi";
  setIcon(document.getElementById("connIconSvg"), viaWifi ? "wifi" : "usb");
  connText.textContent = viaWifi ? "Wi-Fi" : "Modo USB";
  wifiBtn.classList.toggle("on", viaWifi);
  wifiBtn.title = viaWifi ? "Volver a modo USB" : "Pasar este teléfono a Wi-Fi (sin cables)";

  // Cámara: Android 12+, audio: Android 11+ (límite de scrcpy). La pantalla funciona desde Android 5.
  const sdk = online ? dev.sdk : 0;
  applySupport("camera", !sdk || sdk >= 31, `Requiere Android 12+ (este: ${online ? dev.android : "?"})`);
  applySupport("mic", !sdk || sdk >= 30, `Requiere Android 11+ (este: ${online ? dev.android : "?"})`);

  const label = stopAllBtn.querySelector("span");
  if (label) label.textContent = devices.length > 1 ? "Detener este" : "Detener todo";

  if (!camToggle.checked && previewHint && !previewActive) {
    previewHint.textContent = online
      ? "Enciende la cámara para ver tu imagen en vivo"
      : unauthorizedCount
        ? "Acepta la depuración USB en la pantalla del teléfono"
        : "Conecta tu teléfono por USB y activa la depuración USB";
  }

  // Tira con todos los teléfonos (solo si hay más de uno)
  const key = devices.map((d) => `${d.serial}|${isLive(d.serial) ? 1 : 0}|${d.serial === selectedSerial ? 1 : 0}`).join(",");
  deviceStrip.classList.toggle("hidden", devices.length < 2);
  if (devices.length >= 2 && key !== stripKey) {
    stripKey = key;
    deviceStrip.innerHTML = devices.map((d) =>
      `<button type="button" class="dev-chip${d.serial === selectedSerial ? " selected" : ""}" data-serial="${esc(d.serial)}" title="${esc(d.serial)} · Android ${esc(d.android)}">` +
      `<i data-lucide="${d.connection_type === "Wi-Fi" ? "wifi" : "usb"}"></i>` +
      `<span class="dev-name">${esc(d.model)}</span>` +
      (isLive(d.serial) ? '<span class="dev-live" title="Transmitiendo"></span>' : "") +
      `</button>`
    ).join("");
    if (window.lucide) window.lucide.createIcons();
  }
}

function applySupport(name, ok, why) {
  const m = MODS[name];
  m.card.classList.toggle("unsupported", !ok);
  m.card.title = ok ? "" : why;
  m.toggle.disabled = !ok;
  if (!ok) {
    m.badge.dataset.why = why;
    if (m.badge.classList.contains("idle")) m.badge.textContent = why.split(" (")[0];
  } else if (m.badge.dataset.why) {
    if (m.badge.classList.contains("idle")) m.badge.textContent = m.idle;
    delete m.badge.dataset.why;
  }
}

deviceStrip.addEventListener("click", (e) => {
  const b = e.target.closest(".dev-chip");
  if (b) selectDevice(b.dataset.serial);
});

async function refreshBattery() {
  const invoke = getInvoke();
  const serial = selectedSerial;
  if (!invoke || !serial) return;
  try {
    const info = await invoke("get_device_info", { serial });
    devBattery[serial] = info && info.battery > 0 ? info.battery : 0;
  } catch (_) {
    devBattery[serial] = 0;
  }
  if (serial === selectedSerial) renderDeviceUI();
}

// ---------- Sondeo: teléfonos conectados y procesos en marcha ----------
let pollTick = 0;
async function updateDevicesAndStatus() {
  if (document.hidden) return; // ventana minimizada: no gastar procesos adb
  const invoke = getInvoke();
  if (!invoke) return;

  // 0. Estado de los procesos de cada teléfono; avisar de los que se cerraron solos
  try {
    const st = await invoke("get_modules_status");
    Object.keys(devStatus).forEach((k) => delete devStatus[k]);
    (st.devices || []).forEach((d) => { devStatus[d.serial] = d; });
    (st.exited || []).forEach(handleModuleExit);
  } catch (_) {}

  // 1. Teléfonos conectados
  let list;
  try {
    list = await invoke("list_devices");
  } catch (_) {
    return;
  }
  const previous = devices;
  devices = list.filter((d) => d.status === "device");
  unauthorizedCount = list.filter((d) => d.status === "unauthorized").length;

  // Teléfono desconectado mientras transmitía: detener solo ese
  for (const serial of Object.keys(devStatus)) {
    if (isLive(serial) && !devices.some((d) => d.serial === serial)) {
      const gone = previous.find((d) => d.serial === serial);
      try { await invoke("stop_device", { serial }); } catch (_) {}
      devStatus[serial] = { serial, camera: false, screen: false, audio: false };
      notify("Error: se desconectó " + (gone ? gone.model : serial) + "; se detuvieron sus transmisiones.");
      if (serial === selectedSerial) {
        stopInAppPreview();
        previewStatusMsg.textContent = "Teléfono desconectado";
      }
    }
  }

  // Selección: respetar la actual, el pendiente (Wi-Fi) o, si desapareció, el mismo modelo / el primero
  if (pendingSelect && devices.some((d) => d.serial === pendingSelect)) {
    const target = pendingSelect;
    pendingSelect = "";
    selectDevice(target);
  } else if (!devices.some((d) => d.serial === selectedSerial)) {
    const lost = previous.find((d) => d.serial === selectedSerial);
    const twin = lost && devices.find((d) => d.model === lost.model);
    selectDevice((twin || devices[0] || { serial: "" }).serial);
  } else if (!selectedSerial) {
    selectDevice(devices[0].serial);
  }

  renderDeviceUI();
  updateMasterStatus();

  // 2. Batería del seleccionado (cambia despacio: ~cada 20 s)
  if (selectedSerial && pollTick++ % 14 === 0) refreshBattery();
}

setInterval(updateDevicesAndStatus, 1500);
setTimeout(updateDevicesAndStatus, 400);

// Arranca la cámara; si falta la cámara virtual de este teléfono, la instala (pide permiso una vez) y reintenta
async function invokeCamera(invoke, config) {
  try {
    return await invoke("toggle_camera", { config });
  } catch (err) {
    if (!String(err).includes("VCAM_MISSING")) throw err;
    toast("Instalando cámaras virtuales: acepta el aviso de Windows (solo la primera vez).", "info", 20000);
    await invoke("install_virtual_cameras");
    return await invoke("toggle_camera", { config });
  }
}

// ---------- Utilidades de interfaz ----------
function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Cambia el icono Lucide de un botón/elemento (el <svg> ya renderizado o el <i> original)
function setIcon(host, name) {
  if (!host) return;
  const el = host.matches && host.matches("[data-lucide]") ? host : host.querySelector("[data-lucide]");
  if (!el || el.getAttribute("data-lucide") === name) return;
  el.setAttribute("data-lucide", name);
  if (window.lucide) window.lucide.createIcons();
}

const TOAST_ICONS = { ok: "circle-check", error: "circle-alert", info: "info" };
function toast(msg, type = "info", ms = 4200) {
  const box = document.getElementById("toasts");
  if (!box) return;
  while (box.children.length >= 3) box.firstChild.remove();
  const el = document.createElement("div");
  el.className = "toast " + type;
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", TOAST_ICONS[type] || "info");
  const text = document.createElement("span");
  text.textContent = msg;
  el.append(icon, text);
  box.appendChild(el);
  if (window.lucide) window.lucide.createIcons();
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

function notify(msg) {
  const text = String(msg);
  const type = /^(Error|No se pudo)/.test(text) ? "error" : /^¡/.test(text) ? "ok" : "info";
  toast(text.replace(/\n/g, " "), type);
}

// Controles segmentados enlazados a un <select> oculto
function syncSeg(seg, sel) {
  seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === sel.value));
}
function initSegments() {
  document.querySelectorAll(".seg").forEach((seg) => {
    const sel = document.getElementById(seg.dataset.for);
    if (!sel) return;
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || sel.value === b.dataset.v) return;
      sel.value = b.dataset.v;
      sel.dispatchEvent(new Event("change"));
    });
    sel.addEventListener("change", () => syncSeg(seg, sel));
    syncSeg(seg, sel);
  });
}

// Relleno de la barra de los deslizadores
function fillRange(r) {
  const min = parseFloat(r.min) || 0;
  const max = parseFloat(r.max) || 100;
  r.style.setProperty("--pct", ((parseFloat(r.value) - min) / (max - min)) * 100 + "%");
}
function initRanges() {
  const ranges = document.querySelectorAll("input.range");
  ranges.forEach((r) => {
    fillRange(r);
    r.addEventListener("input", () => fillRange(r));
  });
  if (resetColorBtn) resetColorBtn.addEventListener("click", () => ranges.forEach(fillRange));
}

const MODS = {
  camera: { card: camCard, badge: camBadge, idle: "Inactiva", label: "Cámara", toggle: camToggle },
  screen: { card: screenCard, badge: screenBadge, idle: "Inactiva", label: "Pantalla", toggle: screenToggle },
  mic: { card: micCard, badge: micBadge, idle: "Inactivo", label: "Audio", toggle: micToggle }
};

// Estados de un módulo: idle | loading | active
function setModuleState(name, state, text) {
  const m = MODS[name];
  if (!m) return;
  m.badge.className = "module-badge " + state;
  m.badge.textContent = text || (state === "idle" ? m.idle : "En vivo");
  m.card.classList.toggle("active", state === "active");
  m.card.classList.toggle("loading", state === "loading");
}

// Pantalla y audio no tienen "primer fotograma": se da por activo tras un instante si el proceso sigue vivo
function settleActive(name, toggle, text) {
  setTimeout(() => {
    const m = MODS[name];
    if (toggle.checked && m.badge.classList.contains("loading")) {
      setModuleState(name, "active", text);
      updateMasterStatus();
    }
  }, 1200);
}

function handleModuleExit(info) {
  const name = info.module === "audio" ? "mic" : info.module;
  const m = MODS[name];
  if (!m) return;
  if (info.serial !== selectedSerial) {
    if (info.ok) toast(m.label + " de " + deviceName(info.serial) + " cerrada.", "info");
    else notify("Error con " + m.label + " de " + deviceName(info.serial) + ": " + info.message);
    return;
  }
  if (!m.toggle.checked) return;
  m.toggle.checked = false;
  setModuleState(name, "idle");
  if (name === "camera") stopInAppPreview();
  if (!info.ok) notify("Error con " + m.label + ": " + info.message);
  updateMasterStatus();
}

function showPreviewLoading(title, sub) {
  previewPlaceholder.style.display = "flex";
  previewStatusMsg.textContent = title;
  if (previewHint && sub) previewHint.textContent = sub;
  const box = previewPlaceholder.querySelector(".placeholder-icon");
  if (box) {
    box.classList.add("loading");
    setIcon(box, "loader-circle");
  }
  if (previewPillText) previewPillText.textContent = "INICIANDO";
}

function hidePreviewLoading() {
  const box = previewPlaceholder.querySelector(".placeholder-icon");
  if (box && box.classList.contains("loading")) {
    box.classList.remove("loading");
    setIcon(box, "camera-off");
  }
}

initSegments();
initRanges();
switchTab("camera");

// Initialize Lucide Icons on start
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }
});
if (window.lucide) {
  window.lucide.createIcons();
}
