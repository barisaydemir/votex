import { listArchive, loadArchive, loadLegacyArchive, deleteArchive, saveFileDialog, getAppSettings, pickLegacyDikJson } from "../api/tauri.js";
import { $, state } from "../app/state.js";
import { setStatus } from "../app/status.js";
import { logLine } from "./telemetry.js";
import { formatTrainingSetJsonl, trainingFileName } from "../viewer/legacyTrainingSet.js";
import { restoreSoilFromArchive } from "./soilProfile.js";
import { sensitivityPercentForMinConfidence } from "../hybrid/sensitivity.js";
import { updateShotHint } from "./shotType.js";
import { clearStructures, ensureViewer } from "../viewer/scene.js";
import {
  addLegacyDikShapesToScene,
  clearLegacySelection,
  setLegacySelectedStep,
} from "../viewer/legacyDikOverlay.js";
import { renderLegacyDikPanel, restoreLegacyFieldSession } from "./legacyDikPanel.js";
import { buildLegacyFieldModel, normalizeLegacyResult } from "../viewer/legacyDikModel.js";
import { createLegacyCase } from "../viewer/legacyCaseModel.js";
import {
  createLegacyCasePackage,
  legacyCasePackageFileName,
  legacyCasePackageArchiveStatus,
  parseLegacyCasePackageJson,
  restoreLegacyCasePackageState,
  serializeLegacyCasePackage,
} from "../viewer/legacyCasePackage.js";
import { showLegacyFieldReport } from "./fieldReportView.js";

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

function archivedCasePackageOf(loaded) {
  if (!loaded?.casePackage) return null;
  if (["mismatch", "missing", "unverified"].includes(String(loaded.integrity?.status || ""))) {
    throw new Error(loaded.integrity.reason || "Case Package arşiv bütünlüğü doğrulanamadı");
  }
  const packageSnapshot = parseLegacyCasePackageJson(JSON.stringify(loaded.casePackage));
  const resultFingerprint = String(loaded.result?.fingerprint || "");
  const packageFingerprint = String(packageSnapshot.analysis?.fingerprint || "");
  if (resultFingerprint && packageFingerprint && resultFingerprint !== packageFingerprint) {
    throw new Error("Case Package analiz fingerprint'i arşiv sonucu ile eşleşmiyor");
  }
  return packageSnapshot;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Restores an already-built package through the same panel/overlay pipeline. */
async function restoreCasePackage(packageSnapshot, { fileName = null, rawContent = null, statusSuffix = "" } = {}) {
  const normalized = normalizeLegacyResult(packageSnapshot.analysis, state.legacyMatrixHint || null);
  const resolvedFileName = fileName || packageSnapshot.source.fileName || "legacy-vaka.json";
  restoreLegacyCasePackageState(state, packageSnapshot, {
    fileName: resolvedFileName,
    rawContent,
  });
  // Activate the fingerprint session for subsequent operator actions, then
  // re-apply the package so its derived model/config remains authoritative.
  await restoreLegacyFieldSession(normalized, resolvedFileName);
  restoreLegacyCasePackageState(state, packageSnapshot, {
    fileName: resolvedFileName,
    rawContent,
  });
  await ensureViewer();
  clearStructures();
  state.pendingFile = null;
  state.surfaceState = null;
  clearLegacySelection();
  addLegacyDikShapesToScene(normalized, {
    fieldModel: packageSnapshot.derived.fieldModel,
    casePackage: packageSnapshot,
  });
  const steps = Array.isArray(packageSnapshot.derived.fieldModel.steps)
    ? packageSnapshot.derived.fieldModel.steps
    : [];
  if (steps.length) setLegacySelectedStep(Number(steps[0].stepIndex) || 1);
  renderLegacyDikPanel(normalized, {
    fileName: resolvedFileName,
    statusSuffix: statusSuffix || "Case Package geri yüklendi",
    casePackage: packageSnapshot,
  });
  const fileLabel = $("file-name");
  if (fileLabel) fileLabel.textContent = `${resolvedFileName} (Case Package)`;
  return normalized;
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
        const safeName = escapeHtml(name);
        const when = fmtWhen(e.createdAt || e.created_at);
        const view = viewLabel(e.viewMode || e.view_mode);
        const rooms = e.rooms ?? 0;
        const tunnels = e.tunnels ?? 0;
        const metals = e.metals ?? 0;
        const accepted = e.accepted ?? 0;
        const sourceKind = e.sourceKind || e.source_kind || "image";
        const sourceLabel = sourceKind === "legacy_dik_json" ? "JSON dik" : view;
        const packageStatus = legacyCasePackageArchiveStatus(e);
        const packageBadge = packageStatus
          ? `<button type="button" class="archive-package-badge is-${packageStatus.kind}" title="${escapeHtml(packageStatus.title)}" data-archive-package-status="${packageStatus.kind}" data-source-fingerprint="${escapeHtml(e.sourceFingerprint || e.source_fingerprint || "")}" data-analysis-fingerprint="${escapeHtml(e.analysisFingerprint || e.analysis_fingerprint || "")}" data-package-rel="${escapeHtml(e.casePackageRel || e.case_package_rel || "")}" data-source-sha256="${escapeHtml(e.sourceSha256 || e.source_sha256 || "")}" data-analysis-sha256="${escapeHtml(e.analysisSha256 || e.analysis_sha256 || "")}" data-package-sha256="${escapeHtml(e.casePackageSha256 || e.case_package_sha256 || "")}">${escapeHtml(packageStatus.label)}</button>`
          : "";
        const hasReport = !!(e.fieldReportRel || e.field_report_rel);
        const reportButton = hasReport
          ? `<button type="button" class="mil compact archive-report" data-id="${id}" title="Saha raporunu yeniden görüntüle">📄 Rapor</button>`
          : "";
        return `<div class="archive-row" data-id="${id}" data-source-kind="${sourceKind}">

          <div class="archive-meta">
            <strong class="archive-name" title="${safeName}">${safeName}</strong>
            <span class="archive-sub">${when} · ${sourceLabel} · kabul ${accepted} · ${rooms} oda · ${tunnels} tünel · ${metals} metal</span>
            ${packageBadge}
          </div>
          <div class="archive-actions">
            ${reportButton}
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

/** Arşiv kaydındaki saha raporunu (field_report.html) yeniden görüntüler. */
async function openArchiveFieldReport(id) {
  try {
    const loaded = await loadLegacyArchive(id);
    const html = loaded?.fieldReport || loaded?.field_report || null;
    if (!html) {
      setStatus("Bu arşiv kaydında saha raporu yok");
      return;
    }
    showLegacyFieldReport(html);
  } catch (err) {
    setStatus(`Saha raporu açılamadı: ${err}`);
    logLine(`Saha raporu açma: ${err}`, "err");
  }
}

async function openLegacyEntry(id) {
  try {
    state.legacyArchiveEntryId = id;
    setStatus("JSON arşivi açılıyor…");
    const loaded = await loadLegacyArchive(id);
    if (!loaded?.result) throw new Error("JSON analiz sonucu eksik");
    ensureViewer();
    clearStructures();
    state.surfaceState = null;
    state.pendingFile = null;
    const fileName = loaded.meta?.fileName || loaded.meta?.file_name || "legacy_dik.json";
    const normalized = normalizeLegacyResult(loaded.result, state.legacyMatrixHint || null);
    state.legacyDikRawContent = loaded.content || null;
    let packageSnapshot = null;
    try {
      packageSnapshot = archivedCasePackageOf(loaded);
    } catch (packageError) {
      state.legacyCasePackage = null;
      console.warn("[legacy-dik] arşiv Case Package geçersiz:", packageError);
    }
    if (packageSnapshot) {
      await restoreCasePackage(packageSnapshot, {
        fileName,
        rawContent: loaded.content || null,
        statusSuffix: `${normalized.message || "arşivden yüklendi"}`,
      });
    } else {
      clearLegacySelection();
      const steps = Array.isArray(normalized.scanSteps) ? normalized.scanSteps : [];
      // Package yoksa eski arşiv fallback'i modelini yeniden üretir.
      await restoreLegacyFieldSession(normalized, fileName);
      addLegacyDikShapesToScene(normalized);
      if (steps.length) setLegacySelectedStep(Number(steps[0].index) || 1);
      renderLegacyDikPanel(normalized, {
        fileName,
        statusSuffix: `${normalized.message || "arşivden yüklendi"}`,
      });
    }
    const fileLabel = $("file-name");
    if (fileLabel) fileLabel.textContent = `${fileName} (${packageSnapshot ? "Case Package" : "JSON arşiv"})`;
    setStatus(`JSON arşivi yüklendi — ${fileName}`);
    logLine(`JSON arşivi açıldı · ${fileName}`, "ok");
  } catch (err) {
    setStatus(`JSON arşivi açılamadı: ${err}`);
    logLine(`JSON arşivi açma: ${err}`, "err");
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
    // Slider artık hassasiyeti gösterir. Kayıtlı hassasiyet (0–1) öncelikli;
    // eski kayıtlarda min güven ters eşlemesinden türetilir.
    // "votex:sensitivity-sync" render-only'dir; arşiv açılışında yeniden analiz tetiklemez.
    const sensStored = loaded.meta?.sensitivity ?? null;
    const sensEl = $("main-sensitivity-slider");
    if (sensEl) {
      const pct =
        sensStored != null && Number.isFinite(Number(sensStored))
          ? Math.round(Number(sensStored) * 100)
          : Number.isFinite(minConf)
            ? sensitivityPercentForMinConfidence(minConf)
            : null;
      if (pct != null) {
        sensEl.value = String(pct);
        sensEl.dispatchEvent(new Event("votex:sensitivity-sync"));
      }
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

/**
 * Legacy JSON arşiv kaydını eğitim örneği kaynaklarıyla toplar.
 * Operatör oturumu (fingerprint) ve saha notlarını yükler; hata olursa
 * örnek yine de ölçüm verisiyle üretilir (etiketsiz).
 */
async function collectTrainingCase(entry) {
  const loaded = await loadLegacyArchive(entry.id);
  let session = null;
  let notesByKey = {};
  try {
    const settings = await getAppSettings();
    const sessions = settings?.legacyFieldSessions || settings?.legacy_field_sessions || {};
    const fingerprint = loaded.result?.fingerprint || "";
    const candidates = [fingerprint, loaded.meta?.fileName, entry.id].filter(Boolean).map(String);
    const key = candidates.find((candidate) => sessions[candidate]);
    session = key ? sessions[key] : null;
  } catch { /* oturum yoksa örnek etiketsiz üretilir */ }
  try {
    const raw = localStorage.getItem("votex-detection-notes");
    if (raw) notesByKey = JSON.parse(raw) || {};
  } catch { /* notlar yoksa boş */ }
  const normalized = normalizeLegacyResult(loaded.result, state.legacyMatrixHint || null);
  const calibration = session?.lateralCalibration || {};
  const modelOptions = {
    mergeProfile: session?.mergePolicy || "normal",
    splitDetectionIds: session?.splitDetectionIds || [],
    fieldCalibrationReadings: calibration.readings || [],
    fieldCalibrationReferenceM: calibration.referenceDepthM ?? 1,
    fieldCalibrationAfterM: calibration.afterM,
    fieldCalibrationObservedM: calibration.observedM,
    fieldCalibrationDepthScale: calibration.depthScale,
    depthParams: session?.depthParams || null,
    scan: {
      matrixRows: Number(normalized.matrixRows) || 0,
      matrixCols: Number(normalized.matrixCols) || 0,
    },
  };
  const fieldModel = buildLegacyFieldModel(normalized, modelOptions);
  const caseModel = createLegacyCase({
    result: normalized,
    fileName: loaded.meta?.fileName || loaded.meta?.file_name || "legacy_dik.json",
    content: loaded.content || "",
    observations: session?.observations || {},
  });
  let casePackage = null;
  try {
    casePackage = archivedCasePackageOf(loaded);
  } catch (packageError) {
    logLine(`Case Package eşleşmedi · ${entry.fileName || entry.id} (${packageError})`, "info");
  }
  if (!casePackage) {
    casePackage = createLegacyCasePackage({
      caseModel,
      fieldModel,
      session,
      options: { ...modelOptions, notesByDetection: notesByKey },
    });
  } else {
    casePackage = {
      ...casePackage,
      operator: {
        ...casePackage.operator,
        notesByDetection: { ...(casePackage.operator?.notesByDetection || {}), ...notesByKey },
      },
    };
  }
  return { loaded, session, notesByKey, casePackage };
}

/**
 * Arşivdeki tüm Legacy JSON vakalarını operatör kararlarıyla etiketli
 * JSONL eğitim seti olarak kaydeder (kaydetme iletişim kutusu ile).
 */
async function exportLegacyTrainingSet() {
  try {
    setStatus("Eğitim seti hazırlanıyor…");
    const entries = await listArchive();
    const legacyEntries = (entries || []).filter((entry) => (entry.sourceKind || entry.source_kind) === "legacy_dik_json");
    if (!legacyEntries.length) {
      setStatus("Eğitim seti için arşivde Legacy JSON vakası yok");
      return;
    }
    const cases = [];
    for (const entry of legacyEntries) {
      try {
        cases.push(await collectTrainingCase(entry));
      } catch (err) {
        logLine(`Eğitim seti: ${entry.fileName || entry.id} atlandı (${err})`, "info");
      }
    }
    const { jsonl, exampleCount, caseCount } = formatTrainingSetJsonl(cases);
    if (!exampleCount) {
      setStatus("Eğitim seti üretilemedi — arşivdeki vakalar boş");
      return;
    }
    const savedPath = await saveFileDialog(jsonl, trainingFileName(), "JSONL eğitim seti", ["jsonl"]);
    if (!savedPath) {
      setStatus("Eğitim seti ihracı iptal edildi");
      return;
    }
    setStatus(`Eğitim seti kaydedildi — ${caseCount} vaka · ${exampleCount} örnek`);
    logLine(`JSONL eğitim seti dışa aktarıldı · ${caseCount} vaka · ${exampleCount} örnek`, "ok");
  } catch (err) {
    setStatus(`Eğitim seti ihracı başarısız: ${err}`);
    logLine(`Eğitim seti ihracı: ${err}`, "err");
  }
}

/** Exports the current canonical package as a portable .json case file. */
async function exportLegacyCasePackage() {
  const packageSnapshot = state.legacyCasePackage;
  if (!packageSnapshot) {
    setStatus("Case Package ihracı için önce Legacy JSON analiz edin");
    return;
  }
  try {
    const json = serializeLegacyCasePackage(packageSnapshot);
    const saved = await saveFileDialog(
      json,
      legacyCasePackageFileName(packageSnapshot),
      "VOTEX Case Package",
      ["json"],
    );
    if (!saved) {
      setStatus("Case Package ihracı iptal edildi");
      return;
    }
    setStatus("Case Package JSON kaydedildi");
    logLine("Case Package JSON dışa aktarıldı", "ok");
  } catch (err) {
    setStatus(`Case Package ihracı başarısız: ${err?.message || err}`);
    logLine(`Case Package ihracı: ${err}`, "err");
  }
}

/** Imports a portable package and restores its model, selections, and notes. */
async function importLegacyCasePackage() {
  try {
    setStatus("Case Package açılıyor…");
    const picked = await pickLegacyDikJson();
    if (!picked?.content) return;
    const packageSnapshot = parseLegacyCasePackageJson(picked.content);
    const fileName = packageSnapshot.source.fileName || picked.fileName || "legacy-vaka.json";
    await restoreCasePackage(packageSnapshot, {
      fileName,
      rawContent: null,
      statusSuffix: "Case Package içe aktarıldı",
    });
    setStatus(`Case Package yüklendi — ${fileName}`);
    logLine(`Case Package JSON içe aktarıldı · ${fileName}`, "ok");
  } catch (err) {
    setStatus(`Case Package açılamadı: ${err?.message || err}`);
    logLine(`Case Package açma: ${err}`, "err");
  }
}

function closeArchivePackageVerification() {
  document.querySelector("[data-archive-package-verification]")?.remove();
}

function showArchivePackageVerification(badge) {
  closeArchivePackageVerification();
  const status = badge.dataset.archivePackageStatus || "legacy";
  const labels = {
    verified: "Case Package · doğrulandı",
    mismatch: "Case Package · uyuşmazlık",
    missing: "Case Package · eksik",
    unverified: "Case Package · doğrulanmadı",
    matched: "Case Package · fingerprint eşleşti",
    present: "Case Package mevcut",
    legacy: "Eski format",
  };
  const panel = document.createElement("section");
  panel.dataset.archivePackageVerification = "1";
  panel.className = `archive-package-verification is-${status}`;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Case Package doğrulaması");
  const row = (label, value) => `<div class="archive-package-verification-row"><span>${escapeHtml(label)}</span><code>${escapeHtml(value || "—")}</code></div>`;
  panel.innerHTML = `<header><div><span class="archive-package-verification-kicker">ARŞİV DOĞRULAMASI</span><strong>${escapeHtml(labels[status] || labels.legacy)}</strong></div><button type="button" class="mil compact" data-archive-package-close aria-label="Doğrulama panelini kapat">✕</button></header>
    <div class="archive-package-verification-body">
      ${row("Kaynak fingerprint", badge.dataset.sourceFingerprint)}
      ${row("Analiz fingerprint", badge.dataset.analysisFingerprint)}
      ${row("Package yolu", badge.dataset.packageRel)}
      ${row("Source SHA-256", badge.dataset.sourceSha256)}
      ${row("Analysis SHA-256", badge.dataset.analysisSha256)}
      ${row("Package SHA-256", badge.dataset.packageSha256)}
    </div>`;
  document.body.appendChild(panel);
  panel.querySelector("[data-archive-package-close]")?.addEventListener("click", closeArchivePackageVerification);
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
    const packageBadge = e.target.closest(".archive-package-badge");
    if (packageBadge) {
      showArchivePackageVerification(packageBadge);
      return;
    }
    const reportBtn = e.target.closest(".archive-report");
    if (reportBtn) {
      void openArchiveFieldReport(reportBtn.getAttribute("data-id"));
      return;
    }
    const openBtn = e.target.closest(".archive-open");
    if (openBtn) {
      const row = openBtn.closest(".archive-row");
      const sourceKind = row?.getAttribute("data-source-kind") || "image";
      if (sourceKind === "legacy_dik_json") {
        openLegacyEntry(openBtn.getAttribute("data-id"));
      } else {
        openEntry(openBtn.getAttribute("data-id"));
      }
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
  $("btn-archive-export-training")?.addEventListener("click", () => {
    void exportLegacyTrainingSet();
  });
  $("btn-case-package-export")?.addEventListener("click", () => {
    void exportLegacyCasePackage();
  });
  $("btn-case-package-import")?.addEventListener("click", () => {
    void importLegacyCasePackage();
  });
  refreshArchiveList();
}
