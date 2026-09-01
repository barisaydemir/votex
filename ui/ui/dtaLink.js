import {
  getAppSettings,
  getDtaLinkStatus,
  interpretVotexScreen,
  launchDta,
  pickDtaLaunchPath,
  setAutoLaunchDta,
  setDtaLaunchPath,
} from "../api/tauri.js";
import { $ } from "../app/state.js";
import { setStatus } from "../app/status.js";
import { logLine } from "./telemetry.js";

export function applyDtaLinkStatus(st) {
  const host = $("dta-link");
  const label = $("dta-link-label");
  if (!host || !label || !st) return;
  const state = st.state || "wait";
  host.dataset.state = state;
  label.textContent = st.label || "DTA";
  host.title = st.bridgeListening
    ? [
        `Köprü ${st.addr || "127.0.0.1:18765"}`,
        st.hasSession ? "VOTEX 3D oturumu var" : "henüz 3D yok",
        st.state === "linked"
          ? "DTA localhost köprüsü aktif (internet değil)"
          : "DTA henüz ping atmadı — VOTEX açıkken DTA bir süre sonra bağlanır",
      ].join(" · ")
    : "DTA köprüsü dinlemiyor";
}

export async function refreshDtaLink() {
  try {
    const st = await getDtaLinkStatus();
    applyDtaLinkStatus(st);
    return st;
  } catch {
    applyDtaLinkStatus({
      state: "down",
      label: "DTA köprü yok",
      bridgeListening: false,
      hasSession: false,
    });
    return null;
  }
}

function fillPathInput(path) {
  const input = $("dta-launch-path");
  const hint = $("dta-path-hint");
  if (input && path) input.value = path;
  if (hint && path) hint.textContent = `Kayıtlı: ${path}`;
}

function fillAutoLaunch(enabled) {
  const el = $("dta-auto-launch");
  if (el) el.checked = enabled !== false;
}

export async function loadDtaSettingsUi() {
  try {
    const s = await getAppSettings();
    fillPathInput(s?.dtaLaunchPath || s?.dta_launch_path || "");
    const auto =
      s?.autoLaunchDta ?? s?.auto_launch_dta;
    fillAutoLaunch(auto !== false);
  } catch (e) {
    console.warn("DTA settings:", e);
  }
}

export async function runLaunchDta() {
  try {
    setStatus("DTA başlatılıyor…");
    const r = await launchDta();
    const msg = r?.message || "DTA başlatıldı";
    logLine(msg, r?.skipped ? "info" : "ok");
    setStatus(msg);
    setTimeout(() => refreshDtaLink(), 2500);
  } catch (e) {
    const msg = String(e);
    logLine(`DTA başlatma: ${msg}`, "err");
    setStatus(`DTA açılamadı: ${msg}`);
  }
}

export async function runInterpretVotex() {
  const btn = $("btn-interpret-votex");
  try {
    if (btn) btn.disabled = true;
    setStatus("VOTEX ekranı yorumlanıyor…");
    logLine("Ekran yorumu başladı", "info");
    const r = await interpretVotexScreen();
    const msg = r?.message || "Yorum alındı";
    logLine(msg.slice(0, 500) + (msg.length > 500 ? "…" : ""), "ok");
    setStatus(r?.via === "python" ? "Ekran yorumu hazır (telemetri)" : "DTA kuyruğuna iletildi");
  } catch (e) {
    logLine(`Yorum hatası: ${e}`, "err");
    setStatus(`Yorum hatası: ${e}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function bindAutoLaunchEvent() {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen("dta-auto-launch", (event) => {
      const p = event.payload || {};
      const msg = p.message || "DTA otomatik başlatma";
      if (p.ok === false) {
        logLine(`Otomatik DTA: ${msg}`, "err");
        setStatus(`Otomatik DTA hatası: ${msg}`);
        return;
      }
      if (p.reason === "disabled") {
        logLine("Otomatik DTA atlandı (ayar kapalı)", "info");
        return;
      }
      if (p.reason === "already_running") {
        logLine("DTA zaten açıktı — yeniden başlatılmadı", "info");
        setStatus("DTA zaten açık");
        refreshDtaLink();
        return;
      }
      logLine(msg, "ok");
      setStatus(msg);
      setTimeout(() => refreshDtaLink(), 3000);
    });
  } catch (e) {
    console.warn("dta-auto-launch listen:", e);
  }
}

export function bindDtaLaunchControls() {
  $("btn-launch-dta")?.addEventListener("click", () => runLaunchDta());
  $("btn-dta-launch-ops")?.addEventListener("click", () => runLaunchDta());
  $("btn-interpret-votex")?.addEventListener("click", () => runInterpretVotex());

  $("dta-auto-launch")?.addEventListener("change", async (e) => {
    const enabled = !!e.target.checked;
    try {
      await setAutoLaunchDta(enabled);
      logLine(
        enabled ? "VOTEX açılışında DTA başlatılacak" : "Otomatik DTA kapatıldı",
        "ok"
      );
      setStatus(enabled ? "Otomatik DTA açık" : "Otomatik DTA kapalı");
    } catch (err) {
      logLine(`Ayar kaydı: ${err}`, "err");
      e.target.checked = !enabled;
    }
  });

  $("btn-dta-browse")?.addEventListener("click", async () => {
    try {
      const s = await pickDtaLaunchPath();
      if (s) {
        fillPathInput(s.dtaLaunchPath || s.dta_launch_path);
        fillAutoLaunch(s.autoLaunchDta ?? s.auto_launch_dta);
        logLine("DTA başlatıcı yolu kaydedildi", "ok");
      }
    } catch (e) {
      logLine(`Dosya seçilemedi: ${e}`, "err");
    }
  });

  $("btn-dta-save")?.addEventListener("click", async () => {
    const path = ($("dta-launch-path")?.value || "").trim();
    if (!path) {
      setStatus("Yol boş olamaz");
      return;
    }
    try {
      const s = await setDtaLaunchPath(path);
      const autoEl = $("dta-auto-launch");
      if (autoEl) {
        await setAutoLaunchDta(!!autoEl.checked);
      }
      fillPathInput(s.dtaLaunchPath || s.dta_launch_path || path);
      logLine("DTA ayarları kaydedildi", "ok");
      setStatus("DTA ayarları kaydedildi");
    } catch (e) {
      logLine(`Kayıt hatası: ${e}`, "err");
      setStatus(`Kayıt hatası: ${e}`);
    }
  });
}

export function startDtaLinkMonitor() {
  refreshDtaLink();
  loadDtaSettingsUi();
  bindDtaLaunchControls();
  bindAutoLaunchEvent();
  setInterval(() => {
    if (document.hidden) return; // arka planda Rust/IPC uyandırma
    refreshDtaLink();
  }, 4000);
}
