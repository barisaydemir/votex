import {
  getAppSettings,
  getProbEngineStatus,
  launchProbEngine,
  setAutoLaunchProb,
  setProbFallback,
  setProbProfile,
} from "../api/tauri.js";
import { $ } from "../app/state.js";
import { setStatus } from "../app/status.js";
import { logLine } from "./telemetry.js";

export function applyProbEngineStatus(st) {
  const host = $("vpe-link");
  const label = $("vpe-link-label");
  if (!host || !label || !st) return;
  const online = !!st.online;
  const fallback = st.fallback !== false && !online;
  host.dataset.state = online ? "linked" : fallback ? "wait" : "down";
  label.textContent = st.label || (online ? "VPE" : "VPE kapalı");
  host.title = [
    st.addr || "127.0.0.1:18766",
    st.version ? `sürüm ${st.version}` : "",
    st.policyId || st.policy_id || "",
    st.phase || "",
    online ? "hesap motoru aktif" : "yerel legacy yedek",
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function refreshProbEngine() {
  try {
    const st = await getProbEngineStatus();
    applyProbEngineStatus(st);
    return st;
  } catch {
    applyProbEngineStatus({
      online: false,
      fallback: true,
      label: "Hesap motoru kapalı · yerel",
      addr: "127.0.0.1:18766",
    });
    return null;
  }
}

function fillProbSettings(s) {
  const profile = (s?.probProfile || s?.prob_profile || "standard").toLowerCase();
  const std = $("prob-profile-standard");
  const cor = $("prob-profile-corridor");
  if (std) std.checked = profile !== "corridor";
  if (cor) cor.checked = profile === "corridor";

  const auto = $("prob-auto-launch");
  if (auto) {
    const v = s?.autoLaunchProb ?? s?.auto_launch_prob;
    auto.checked = v !== false;
  }
  const fb = $("prob-fallback");
  if (fb) {
    const v = s?.probFallback ?? s?.prob_fallback;
    fb.checked = v !== false;
  }
}

export async function loadProbSettingsUi() {
  try {
    const s = await getAppSettings();
    fillProbSettings(s);
  } catch (e) {
    console.warn("VPE settings:", e);
  }
}

export async function runLaunchProb() {
  try {
    setStatus("VPE başlatılıyor…");
    const r = await launchProbEngine();
    const msg = r?.message || "VPE başlatıldı";
    logLine(msg, "ok");
    setStatus(msg);
    if (r?.status) applyProbEngineStatus(r.status);
    setTimeout(() => refreshProbEngine(), 800);
  } catch (e) {
    logLine(`VPE başlatma: ${e}`, "err");
    setStatus(`VPE açılamadı: ${e}`);
  }
}

/** Analiz sonrası geometryReport’tan motor etiketini logla */
export function logProbFromSurface(surface) {
  const gr = surface?.structures?.geometryReport || surface?.structures?.geometry_report || {};
  const label = gr.probEngineLabel || gr.prob_engine_label || "";
  const legacy = gr.probUsedLegacy ?? gr.prob_used_legacy;
  if (!label && legacy == null) return;
  if (legacy) {
    logLine(`Hesap: yerel legacy${label ? ` · ${label}` : ""}`, "info");
  } else {
    logLine(`Hesap: VPE birincil${label ? ` · ${label}` : ""}`, "ok");
  }
}

async function bindProbEngineEvent() {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen("prob-engine", (event) => {
      const p = event.payload || {};
      if (p.status) applyProbEngineStatus(p.status);
      const msg = p.message || "VPE";
      if (p.ok === false) {
        logLine(`VPE: ${msg}`, "err");
        return;
      }
      logLine(msg, "ok");
      setTimeout(() => refreshProbEngine(), 500);
    });
  } catch (e) {
    console.warn("prob-engine listen:", e);
  }
}

export function bindProbEngineControls() {
  $("btn-launch-vpe")?.addEventListener("click", () => runLaunchProb());
  $("btn-vpe-launch-ops")?.addEventListener("click", () => runLaunchProb());

  const onProfile = async (profile) => {
    try {
      await setProbProfile(profile);
      logLine(
        profile === "corridor"
          ? "VPE profil: Koridor-öncelikli"
          : "VPE profil: Standart",
        "ok"
      );
      setStatus(profile === "corridor" ? "Profil: Koridor" : "Profil: Standart");
      refreshProbEngine();
    } catch (e) {
      logLine(`Profil: ${e}`, "err");
    }
  };
  $("prob-profile-standard")?.addEventListener("change", (e) => {
    if (e.target.checked) onProfile("standard");
  });
  $("prob-profile-corridor")?.addEventListener("change", (e) => {
    if (e.target.checked) onProfile("corridor");
  });

  $("prob-auto-launch")?.addEventListener("change", async (e) => {
    const enabled = !!e.target.checked;
    try {
      await setAutoLaunchProb(enabled);
      logLine(
        enabled ? "VOTEX açılışında VPE başlatılacak" : "Otomatik VPE kapalı",
        "ok"
      );
    } catch (err) {
      e.target.checked = !enabled;
      logLine(`VPE ayar: ${err}`, "err");
    }
  });

  $("prob-fallback")?.addEventListener("change", async (e) => {
    const enabled = !!e.target.checked;
    try {
      await setProbFallback(enabled);
      logLine(
        enabled
          ? "VPE kopunca yerel legacy yedek açık"
          : "Legacy yedek kapalı — yalnız VPE",
        "ok"
      );
      setStatus(enabled ? "Fallback: açık" : "Fallback: kapalı (yalnız VPE)");
    } catch (err) {
      e.target.checked = !enabled;
      logLine(`Fallback ayar: ${err}`, "err");
    }
  });
}

export function startProbEngineMonitor() {
  refreshProbEngine();
  loadProbSettingsUi();
  bindProbEngineControls();
  bindProbEngineEvent();
  setInterval(() => {
    if (document.hidden) return; // arka planda Rust/IPC uyandırma
    refreshProbEngine();
  }, 5000);
}
