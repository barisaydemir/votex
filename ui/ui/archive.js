import { listArchive, loadArchive, deleteArchive } from "../api/tauri.js";
import { $, state } from "../app/state.js";
import { setStatus } from "../app/status.js";
import { logLine } from "./telemetry.js";
import { restoreSoilFromArchive } from "./soilProfile.js";
import { updateShotHint } from "./shotType.js";

/** @type {((surface: any, minConf?: number) => any) | null} */
let applySurfaceFn = null;

export function bindArchiveApply(fn) {
  applySurfaceFn = fn;
}

function fmtWhen(createdAt) {
  if (!createdAt) return "—";
  // "secs|HH:MM:SSUTC(+Nd)" veya düz string
  const pipe = String(createdAt).split("|");
  if (pipe.length >= 2) {
    const secs = Number(pipe[0]);
    if (Number.isFinite(secs) && secs > 0) {
      try {
        return new Date(secs * 1000).toLocaleString("tr-TR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        /* fallthrough */
      }
    }
    return pipe[1];
  }
  return String(createdAt).slice(0, 19);
}

function viewLabel(mode) {
  return mode === "top" || mode === "dik" ? "Dik" : "Yan";
}

export async function refreshArchiveList() {
  const host = $("archive-list");
  if (!host) return;
  try {
    const entries = await listArchive();
    if (!entries?.length) {
      host.innerHTML = `<p class="hint compact">Henüz arşiv yok — analiz otomatik kaydedilir.</p>`;
      return;
    }
    host.innerHTML = entries
      .map((e) => {
        const id = e.id;
        const name = e.fileName || e.file_name || "harita";
        const when = fmtWhen(e.createdAt || e.created_at);
        const view = viewLabel(e.viewMode || e.view_mode);
        const rooms = e.rooms ?? 0;
        const tunnels = e.tunnels ?? 0;
        const metals = e.metals ?? 0;
        const accepted = e.accepted ?? 0;
        return `<div class="archive-row" data-id="${id}">
          <div class="archive-meta">
            <strong class="archive-name" title="${name}">${name}</strong>
            <span class="archive-sub">${when} · ${view} · kabul ${accepted} · ${rooms} oda · ${tunnels} tünel · ${metals} metal</span>
          </div>
          <div class="archive-actions">
            <button type="button" class="mil compact archive-open" data-id="${id}">Aç</button>
            <button type="button" class="mil compact archive-del" data-id="${id}">Sil</button>
          </div>
        </div>`;
      })
      .join("");
  } catch (err) {
    host.innerHTML = `<p class="hint compact">Arşiv okunamadı: ${err}</p>`;
    console.warn("archive list:", err);
  }
}

async function openEntry(id) {
  try {
    setStatus("Arşiv açılıyor…");
    const loaded = await loadArchive(id);
    const name = loaded.fileName || loaded.file_name || loaded.meta?.fileName || "harita";
    const base64 = loaded.imageBase64 || loaded.image_base64;
    const surface = loaded.surface;
    if (!surface || !base64) {
      setStatus("Arşiv eksik");
      logLine("Arşiv açma: eksik veri", "err");
      return;
    }
    state.pendingFile = { name, base64 };
    $("file-name").textContent = `${name} (arşiv)`;
    $("btn-build-3d").disabled = false;
    const viewMode = loaded.meta?.viewMode || loaded.meta?.view_mode || surface.viewMode || surface.view_mode;
    if (viewMode) {
      const radio = document.querySelector(`input[name="shot-type"][value="${viewMode === "top" ? "top" : "side"}"]`);
      if (radio) radio.checked = true;
      updateShotHint();
    }
    restoreSoilFromArchive(loaded.meta, surface);
    const minConf = Number(
      loaded.meta?.minConfidence ?? loaded.meta?.min_confidence ?? surface.structures?.minConfidence ?? 0.45
    );
    const minEl = $("min-confidence");
    if (minEl && Number.isFinite(minConf)) {
      minEl.value = String(Math.round(minConf * 100));
      const lab = $("min-confidence-label");
      if (lab) lab.textContent = minConf.toFixed(2);
    }
    if (applySurfaceFn) {
      applySurfaceFn(surface, minConf, { resetKot: true });
    } else {
      state.surfaceState = surface;
    }
    logLine(`Arşiv açıldı · ${name}`, "ok");
    setStatus(`Arşiv yüklendi — ${name}`);
  } catch (err) {
    setStatus(`Arşiv açılamadı: ${err}`);
    logLine(`Arşiv açma: ${err}`, "err");
  }
}

async function deleteEntry(id) {
  if (!window.confirm("Bu arşiv kaydı silinsin mi?")) return;
  try {
    await deleteArchive(id);
    logLine("Arşiv silindi", "info");
    await refreshArchiveList();
  } catch (err) {
    setStatus(`Arşiv silinemedi: ${err}`);
    logLine(`Arşiv silme: ${err}`, "err");
  }
}

export function bindArchiveUi() {
  const host = $("archive-list");
  host?.addEventListener("click", (e) => {
    const openBtn = e.target.closest(".archive-open");
    if (openBtn) {
      openEntry(openBtn.getAttribute("data-id"));
      return;
    }
    const delBtn = e.target.closest(".archive-del");
    if (delBtn) {
      deleteEntry(delBtn.getAttribute("data-id"));
    }
  });
  $("btn-archive-refresh")?.addEventListener("click", () => {
    refreshArchiveList();
  });
  refreshArchiveList();
}
