import {
  getUpdateStatus,
  pickUpdatePackage,
  applySuiteUpdate,
  getAppVersion,
} from "../api/tauri.js";
import { $ } from "../app/state.js";
import { setStatus } from "../app/status.js";
import { logLine } from "./telemetry.js";
import { t, tPhrase } from "../i18n/index.js";

function paintStatus(st) {
  const badge = $("update-badge");
  const ver = $("update-current-ver");
  const avail = $("update-available-ver");
  const msg = $("update-msg");
  const notes = $("update-notes");
  const pathEl = $("update-package-path");
  const btnApply = $("btn-update-apply");

  const cur = st?.currentVersion || st?.current_version || "—";
  const av = st?.availableVersion || st?.available_version || null;
  const ready = !!(st?.updateAvailable ?? st?.update_available);
  const path = st?.packagePath || st?.package_path || "";
  const noteList = st?.notes || [];

  if (ver) ver.textContent = cur;
  if (avail) avail.textContent = av || "—";
  if (msg) msg.textContent = st?.message || "—";
  if (pathEl) pathEl.textContent = path || t("upd.noPackage");
  if (notes) {
    notes.innerHTML = noteList.length
      ? `<ul>${noteList.map((n) => `<li>${n}</li>`).join("")}</ul>`
      : "";
  }
  if (btnApply) btnApply.disabled = !ready;
  if (badge) {
    badge.hidden = !ready;
    badge.textContent = ready ? `${t("header.update")} ${av}` : "";
    badge.dataset.state = ready ? "ready" : "idle";
  }
}

export async function refreshUpdateStatus() {
  try {
    const st = await getUpdateStatus();
    paintStatus(st);
    return st;
  } catch (e) {
    console.warn("update status:", e);
    paintStatus({
      currentVersion: "—",
      message: String(e),
      updateAvailable: false,
      notes: [],
    });
    return null;
  }
}

async function onPick() {
  try {
    setStatus("Güncelleme paketi seçiliyor…");
    const st = await pickUpdatePackage();
    paintStatus(st);
    logLine(st?.message || "Paket seçildi", st?.updateAvailable ? "ok" : "info");
    setStatus(st?.message || "Paket");
  } catch (e) {
    logLine(`Paket seçim: ${e}`, "err");
    setStatus(`Paket seçilemedi: ${e}`);
  }
}

async function onApply() {
  if (!window.confirm(t("upd.confirm"))) {
    return;
  }
  try {
    setStatus("Güncelleme uygulanıyor…");
    logLine("Suite güncelleme başlatıldı", "info");
    const r = await applySuiteUpdate(null);
    logLine(r?.message || "Güncelleme", r?.ok ? "ok" : "warn");
    setStatus(r?.message || "—");
    if (r?.restartRequired || r?.restart_required) {
      setTimeout(async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().close();
        } catch {
          window.close();
        }
      }, 600);
    } else {
      refreshUpdateStatus();
    }
  } catch (e) {
    logLine(`Güncelleme hatası: ${e}`, "err");
    setStatus(`Güncelleme başarısız: ${e}`);
  }
}

const UI_CONTRACT_VERSION = "legacy-result-v1";

export async function startUpdateMonitor() {
  $("btn-update-pick")?.addEventListener("click", onPick);
  $("btn-update-apply")?.addEventListener("click", onApply);
  $("btn-update-refresh")?.addEventListener("click", () => refreshUpdateStatus());
  $("update-badge")?.addEventListener("click", () => {
    const fold = $("update-fold");
    if (fold) fold.open = true;
  });
  try {
    const v = await getAppVersion();
    const runtimeVersion = v == null ? "" : String(v);
    const el = $("app-version-label");
    if (runtimeVersion) {
      // Runtime sürümünü başlıkta da göster: eski executable çalışıyorsa kullanıcı
      // kaynak sürüm ile çalışan binary arasındaki farkı hemen görür.
      document.documentElement.dataset.votexVersion = runtimeVersion;
      document.documentElement.dataset.uiContract = UI_CONTRACT_VERSION;
      document.title = `Votex ${runtimeVersion} — Magnetic Anomaly Analysis`;
      if (el) {
        el.textContent = `v${runtimeVersion}`;
        el.dataset.uiContract = UI_CONTRACT_VERSION;
        el.title = `Çalışan sürüm: ${runtimeVersion} · UI sözleşmesi: ${UI_CONTRACT_VERSION}`;
      }
      try {
        window.dispatchEvent(new CustomEvent("votex:runtime-version", { detail: { version: runtimeVersion, contract: UI_CONTRACT_VERSION } }));
      } catch {
        /* UI bağlanmadan önce çalışan test/runtime ortamları */
      }
    }
  } catch {
    /* ignore */
  }
  await refreshUpdateStatus();
  // USB takılınca fark etmek için seyrek tarama
  setInterval(() => refreshUpdateStatus(), 45000);
}
