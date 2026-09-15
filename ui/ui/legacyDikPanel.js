/**
 * LEGACY3DMAG JSON paneli — dosya seçimi, arşiv açılışı, liste ve tomografi.
 * CSV panelinden bağımsız; ortak render yolu.
 */
import { $, state } from "../app/state.js";
import { setStatus } from "../app/status.js";
import {
  pickLegacyDikJson,
  analyzeLegacyDikJson,
  saveLegacyArchive,
  levelLegacyMagJson,
  getAppSettings,
  setLegacyDepthParams,
  setLegacyDepthCalibNotes,
  listArchive,
  loadLegacyArchive,
} from "../api/tauri.js";
import { ensureViewer } from "../viewer/scene.js";
import { removeCsvOverlay } from "../viewer/csvOverlay.js";
import { formatLegacyMatrixProductStatus } from "../viewer/legacyMatrixValidate.js";
import { applyLegacyNumberingToNormalized } from "../viewer/legacyGridTemplate.js";
import {
  exportLegacyDetectionsCsv,
  exportLegacyDetectionsGeoJson,
  exportLegacyFieldSummary,
} from "../viewer/legacyDikExport.js";
import {
  addLegacyDikShapesToScene,
  removeLegacyDikShapes,
  legacyDikSummary,
  selectLegacyAnomalies,
  setLegacySelectedStep,
  setLegacySelectedDetection,
  focusLegacyStep,
  focusLegacyDetection,
  clearLegacySelection,
  getLegacyLabelMode,
  setLegacyStepNumberingDirection,
  getLegacyStepNumberingDirection,
  getLegacySceneViewMode,
  setLegacySceneViewMode,
  applyLegacySceneViewMode,
  applyFocusSafeStepVisibility,
  isLegacyInvertProxyAvailable,
  toggleLegacyInvertProxy,
} from "../viewer/legacyDikOverlay.js";
import {
  toggleLegacyTomography,
  removeLegacyTomography,
  isLegacyTomographyAvailable,
  setTomographyDepthM,
  setTomographyOpacity,
  setTomographySigmaFloor,
  setTomographyPlaying,
  focusTomographyOnDetection,
  getTomographyControlsState,
} from "../viewer/legacyTomography.js";
import {
  toggleLegacySubsurfaceMap,
  removeLegacySubsurfaceMap,
  isLegacySubsurfaceMapAvailable,
} from "../viewer/legacySubsurfaceMap.js";
import {
  toggleLegacyGeothermalMap,
  removeLegacyGeothermalMap,
  isLegacyGeothermalMapAvailable,
} from "../viewer/legacyGeothermalMap.js";
import { interpretGeothermalWithAi } from "../viewer/legacyGeothermalAi.js";
import {
  toggleLegacyDepthMap,
  removeLegacyDepthMap,
  isLegacyDepthMapAvailable,
} from "../viewer/legacyDepthMap.js";
import {
  setLegacyObjectViewMode,
  getLegacyObjectViewMode,
  setLegacyObjectViewBlend,
  getLegacyObjectViewBlend,
} from "../viewer/legacyObjectView.js";
import { suggestDepthParamsWithAi } from "../viewer/legacyDepthCalibAi.js";
import {
  archiveSiteKey,
  groupArchiveEntriesBySite,
  depthSpreadByDetection,
} from "../viewer/legacyArchiveConsistency.js";
import {
  buildLegacyFieldModel,
  statusLabel,
  matchesLegacyListFilter,
  escapeLegacyHtml,
  normalizeLegacyResult,
  buildLegacyFieldBrief,
  formatLegacyFieldBriefHtml,
  residualScaleOf,
  magneticResponseOf,
} from "../viewer/legacyDikModel.js";
import { focusStructure } from "../viewer/labels.js";
import { dimensionsOf, volumeM3Of, formatVolumeM3 } from "../viewer/volume.js";

let lastSahaBriefText = "";
let lastSahaBriefHtml = "";
const GUIDE_STORAGE_KEY = "votex-legacy-dik-guide-v1";
/** @type {Array<object>} */
let calibNotesCache = [];

const DEFAULT_DEPTH_PARAMS = Object.freeze({
  sensorHeightM: 0.5,
  bipolarSepFactor: 1.85,
  dipoleBlend: 0.3,
});

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function readDepthParamsFromUi() {
  const sensorHeightM = DEFAULT_DEPTH_PARAMS.sensorHeightM;
  const bipolarSepFactor = clampNum($("legacy-param-bipolar")?.value, 0.5, 4, DEFAULT_DEPTH_PARAMS.bipolarSepFactor);
  const blendPct = clampNum($("legacy-param-dipole-blend")?.value, 0, 100, DEFAULT_DEPTH_PARAMS.dipoleBlend * 100);
  return {
    sensorHeightM,
    bipolarSepFactor,
    dipoleBlend: blendPct / 100,
  };
}

function writeDepthParamsToUi(params = DEFAULT_DEPTH_PARAMS) {
  const p = {
    sensorHeightM: DEFAULT_DEPTH_PARAMS.sensorHeightM,
    bipolarSepFactor: clampNum(
      params.bipolarSepFactor ?? params.bipolar_sep_factor,
      0.5,
      4,
      DEFAULT_DEPTH_PARAMS.bipolarSepFactor
    ),
    dipoleBlend: clampNum(params.dipoleBlend ?? params.dipole_blend, 0, 1, DEFAULT_DEPTH_PARAMS.dipoleBlend),
  };
  const h = $("legacy-param-sensor-height");
  const b = $("legacy-param-bipolar");
  const d = $("legacy-param-dipole-blend");
  if (h) {
    h.value = "0.50";
    h.readOnly = true;
  }
  if (b) b.value = String(Number(p.bipolarSepFactor.toFixed(2)));
  if (d) d.value = String(Math.round(p.dipoleBlend * 100));
  return p;
}

async function loadDepthParamsFromSettings() {
  try {
    const s = await getAppSettings();
    writeDepthParamsToUi(s?.legacyDepthParams || s?.legacy_depth_params || DEFAULT_DEPTH_PARAMS);
  } catch (error) {
    console.warn("[legacy-dik] depth params load:", error);
    writeDepthParamsToUi(DEFAULT_DEPTH_PARAMS);
  }
}

function readLegacyAnalyzeInputs() {
  const matrix = readLegacyMatrixInput();
  const rawStepSpacing = String($("legacy-dik-step-spacing")?.value ?? "0").trim();
  const scanStepSpacingM = rawStepSpacing === "" ? 0 : Number(rawStepSpacing);
  if (!Number.isFinite(scanStepSpacingM) || scanStepSpacingM < 0 || scanStepSpacingM > 1000) {
    throw new Error("Yatay adım ölçüsü 0–1000 metre arasında olmalıdır");
  }
  const effectiveStepSpacingM = matrix.scanStepCount > 0 ? 0 : scanStepSpacingM;
  return { matrix, effectiveStepSpacingM };
}

async function reanalyzeCurrentLegacyJson(depthParams) {
  const content = state.legacyDikRawContent;
  if (!content) return null;
  const fileName = state.legacyDikFileName || "scan.json";
  const { matrix, effectiveStepSpacingM } = readLegacyAnalyzeInputs();
  const result = await analyzeLegacyDikJson(
    content,
    fileName,
    matrix.scanStepCount,
    effectiveStepSpacingM,
    depthParams
  );
  const normalized = normalizeLegacyResult(result, matrix.hint);
  state.legacyMatrixHint = matrix.hint;
  applyLegacyNumberingToNormalized(normalized, {
    numberingDirection: state.legacyStepNumberingDirection,
  });
  const resultSteps = Array.isArray(normalized.scanSteps) ? normalized.scanSteps : [];
  if (!state.legacySelectedStepIndex && resultSteps.length) {
    state.legacySelectedStepIndex = Number(resultSteps[0].index) || 1;
  }
  await ensureViewer();
  try { removeLegacyDikShapes(); } catch (_) {}
  addLegacyDikShapesToScene(normalized);
  renderLegacyDikPanel(normalized, { fileName });
  return normalized;
}

export function updateLegacySahaBrief(detectionId = state.legacySelectedDetectionId) {
  const host = $("legacy-saha-brief");
  const body = $("legacy-saha-brief-body");
  if (!host || !body) return null;
  const id = detectionId ? String(detectionId) : null;
  const detection = id
    ? state.legacyFieldModel?.detections?.find((item) => item.detectionId === id)
    : null;
  const brief = buildLegacyFieldBrief(detection);
  if (!brief) {
    host.style.display = "none";
    body.innerHTML = "";
    lastSahaBriefText = "";
    lastSahaBriefHtml = "";
    return null;
  }
  host.style.display = "";
  body.innerHTML = formatLegacyFieldBriefHtml(brief);
  lastSahaBriefText = brief.plainText;
  lastSahaBriefHtml = body.innerHTML;
  return brief;
}

async function copyLegacySahaBrief() {
  if (!lastSahaBriefText) {
    setStatus("Önce bir tespit seçin");
    return;
  }
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(lastSahaBriefText);
      setStatus("Saha özeti panoya kopyalandı");
      return;
    }
  } catch {
    /* fallback below */
  }
  setStatus(lastSahaBriefText.split("\n")[0]);
}

async function refreshArchives() {
  const { refreshArchiveList } = await import("./archive.js");
  return refreshArchiveList();
}

function syncTomographyControlsUi() {
  const host = $("legacy-tomo-controls");
  const ctrls = getTomographyControlsState();
  if (host) host.style.display = ctrls.visible ? "" : "none";
  if (!ctrls.visible) return;
  const depth = $("legacy-tomo-depth");
  const depthLabel = $("legacy-tomo-depth-label");
  const opacity = $("legacy-tomo-opacity");
  const opacityLabel = $("legacy-tomo-opacity-label");
  const sigma = $("legacy-tomo-sigma");
  const sigmaLabel = $("legacy-tomo-sigma-label");
  const play = $("btn-legacy-tomo-play");
  if (depth) {
    depth.max = String(Math.max(0.5, ctrls.maxDepthM));
    depth.value = String(ctrls.depthM);
  }
  if (depthLabel) depthLabel.textContent = `${ctrls.depthM.toFixed(2)} m`;
  if (opacity) opacity.value = String(ctrls.opacity);
  if (opacityLabel) opacityLabel.textContent = `${Math.round(ctrls.opacity * 100)}%`;
  if (sigma) sigma.value = String(ctrls.sigmaFloor);
  if (sigmaLabel) sigmaLabel.textContent = ctrls.sigmaFloor.toFixed(2);
  if (play) {
    play.textContent = ctrls.playing ? "Durdur" : "Play";
    play.classList.toggle("accent", ctrls.playing);
  }
}

function syncSubsurfaceButtonUi(available = isLegacySubsurfaceMapAvailable(state.legacyDikResult)) {
  const button = $("btn-legacy-subsurface");
  if (!button) return;
  button.disabled = !available;
  const on = !!state.legacySubsurfaceMapVisible;
  button.textContent = on ? "▣ Yüzey altı: Açık" : "▣ Yüzey altı";
  button.classList.toggle("accent", on);
  button.setAttribute("aria-pressed", String(on));
}

function syncGeothermalButtonUi(available = isLegacyGeothermalMapAvailable(state.legacyDikResult)) {
  const button = $("btn-legacy-geothermal");
  if (!button) return;
  button.disabled = !available;
  const on = !!state.legacyGeothermalMapVisible;
  button.textContent = on ? "♨ Jeotermal: Açık" : "♨ Jeotermal";
  button.classList.toggle("accent", on);
  button.setAttribute("aria-pressed", String(on));
  syncGeothermalAiUi();
}

function syncGeothermalAiUi() {
  const host = $("legacy-geo-ai-controls");
  const aiBtn = $("btn-legacy-geo-ai");
  const resultEl = $("legacy-geo-ai-result");
  const on = !!state.legacyGeothermalMapVisible;
  if (host) host.style.display = on ? "" : "none";
  if (aiBtn) aiBtn.disabled = !on;
  if (resultEl) {
    if (state.legacyGeothermalAiText) {
      resultEl.hidden = false;
      resultEl.textContent = state.legacyGeothermalAiText;
    } else {
      resultEl.hidden = true;
      resultEl.textContent = "";
    }
  }
}

function syncDepthButtonUi(available = isLegacyDepthMapAvailable(state.legacyDikResult)) {
  const button = $("btn-legacy-depth");
  if (!button) return;
  button.disabled = !available;
  const on = !!state.legacyDepthMapVisible;
  button.textContent = on ? "▤ Derinlik: Açık" : "▤ Derinlik";
  button.classList.toggle("accent", on);
  button.setAttribute("aria-pressed", String(on));
  const legend = $("legacy-depth-legend");
  if (legend) legend.style.display = on ? "flex" : "none";
}

function syncInvertProxyButtonUi(available = isLegacyInvertProxyAvailable(state.legacyDikResult)) {
  const button = $("btn-legacy-invert");
  if (!button) return;
  button.disabled = !available;
  const on = !!state.legacyInvertProxyVisible;
  button.textContent = on ? "◇ Invert: Açık" : "◇ Invert proxy";
  button.classList.toggle("accent", on);
  button.setAttribute("aria-pressed", String(on));
  const legend = $("legacy-invert-legend");
  if (legend) legend.style.display = on ? "flex" : "none";
}

function syncLegacyExportUi(fieldModel = state.legacyFieldModel) {
  const row = $("legacy-export-row");
  const has = Array.isArray(fieldModel?.detections) && fieldModel.detections.length > 0;
  if (row) row.classList.toggle("is-visible", has);
  ["btn-legacy-export-csv", "btn-legacy-export-geojson", "btn-legacy-export-summary"].forEach((id) => {
    const button = $(id);
    if (button) button.disabled = !has;
  });
}

function syncObjectViewUi(fieldModel = state.legacyFieldModel) {
  const select = $("legacy-object-view");
  if (select) {
    select.value = getLegacyObjectViewMode();
    select.disabled = !state.legacyDikResult;
  }
  const blend = $("legacy-object-blend");
  const blendLabel = $("legacy-object-blend-label");
  const t = getLegacyObjectViewBlend();
  if (blend) {
    blend.value = String(Math.round(t * 100));
    blend.disabled = !state.legacyDikResult;
  }
  if (blendLabel) {
    if (t <= 0.15) blendLabel.textContent = "kontür";
    else if (t >= 0.85) blendLabel.textContent = "sinyal";
    else blendLabel.textContent = `karışım ${Math.round(t * 100)}%`;
  }
  const legend = $("legacy-object-legend");
  if (legend) legend.style.display = state.legacyDikResult ? "flex" : "none";
  const scaleEl = $("legacy-object-legend-scale");
  if (scaleEl) {
    const scale = fieldModel?.residualScale || residualScaleOf(state.legacyDikResult);
    scaleEl.textContent = scale?.display || "";
  }
}

function consistencyBadgeHtml(detectionId) {
  const info = state.legacyArchiveDepthSpread?.get?.(detectionId);
  if (!info || info.n < 2) return "";
  const spread = Number(info.spreadM);
  const cls = spread <= 0.5 ? "is-tight" : spread <= 1.5 ? "is-mid" : "is-loose";
  const label = spread <= 0.5 ? "tutarlı" : spread <= 1.5 ? "orta" : "dağınık";
  return `<div class="legacy-consist-badge ${cls}" title="Aynı saha adına göre ${info.n} çekimde mid-depth yayılımı">Δz ${spread.toFixed(2)} m · ${info.n} çekim · ${label}</div>`;
}

function patchConsistencyBadges() {
  const list = $("legacy-dik-list");
  if (!list) return;
  list.querySelectorAll(".legacy-anomaly-card").forEach((card) => {
    const id = card.dataset.legacyFocus;
    let badge = card.querySelector(".legacy-consist-badge");
    const html = consistencyBadgeHtml(id);
    if (!html) {
      badge?.remove();
      return;
    }
    if (!badge) {
      const mag = card.querySelector(".legacy-mag-response");
      const host = document.createElement("div");
      host.innerHTML = html;
      badge = host.firstElementChild;
      if (mag) mag.insertAdjacentElement("afterend", badge);
      else card.appendChild(badge);
    } else {
      const host = document.createElement("div");
      host.innerHTML = html;
      badge.replaceWith(host.firstElementChild);
    }
  });
}

async function refreshLegacyArchiveConsistency(fileName, fieldModel) {
  try {
    const entries = await listArchive();
    const key = archiveSiteKey(fileName);
    const siblings = (groupArchiveEntriesBySite(entries).get(key) || [])
      .filter((entry) => {
        const name = entry.fileName || entry.file_name || "";
        return name !== fileName;
      })
      .slice(0, 5);
    if (!siblings.length || !fieldModel?.detections?.length) {
      state.legacyArchiveDepthSpread = new Map();
      patchConsistencyBadges();
      return;
    }
    const siblingResults = [];
    for (const entry of siblings) {
      try {
        const loaded = await loadLegacyArchive(entry.id);
        if (loaded?.result) siblingResults.push(normalizeLegacyResult(loaded.result));
      } catch {
        /* skip broken archive */
      }
    }
    const map = depthSpreadByDetection(fieldModel.detections, siblingResults);
    state.legacyArchiveDepthSpread = map;
    if (state.legacyDikFileName === fileName) patchConsistencyBadges();
  } catch (error) {
    console.warn("[legacy-dik] archive consistency:", error);
  }
}

function normalizeCalibNote(note) {
  if (!note || typeof note !== "object") return null;
  const labelDepthM = Number(note.labelDepthM ?? note.label_depth_m);
  const sensorHeightM = Number(note.sensorHeightM ?? note.sensor_height_m);
  const bipolarSepFactor = Number(note.bipolarSepFactor ?? note.bipolar_sep_factor);
  const dipoleBlend = Number(note.dipoleBlend ?? note.dipole_blend);
  if (![labelDepthM, sensorHeightM, bipolarSepFactor, dipoleBlend].every(Number.isFinite)) return null;
  return {
    labelDepthM,
    fileName: String(note.fileName ?? note.file_name ?? ""),
    sensorHeightM,
    bipolarSepFactor,
    dipoleBlend,
    savedAt: String(note.savedAt ?? note.saved_at ?? ""),
  };
}

function renderCalibNotesList(notes = calibNotesCache) {
  const host = $("legacy-calib-notes-list");
  if (!host) return;
  const list = (Array.isArray(notes) ? notes : []).map(normalizeCalibNote).filter(Boolean);
  calibNotesCache = list;
  if (!list.length) {
    host.innerHTML = `<div class="hint compact" style="margin:0;">Henüz not yok — saha etiketi girip Deftere kaydet.</div>`;
    return;
  }
  host.innerHTML = list
    .map((note, index) => {
      const when = note.savedAt ? note.savedAt.replace("T", " ").slice(0, 16) : "—";
      const file = note.fileName ? ` · ${escapeLegacyHtml(note.fileName)}` : "";
      return `<div class="legacy-calib-note" data-calib-index="${index}">
        <div class="legacy-calib-note-meta"><b>${note.labelDepthM.toFixed(1)} m</b> etiket · h=${note.sensorHeightM.toFixed(2)} · bip=${note.bipolarSepFactor.toFixed(2)} · dip=${Math.round(note.dipoleBlend * 100)}%<br/><span>${escapeLegacyHtml(when)}${file}</span></div>
        <div class="legacy-calib-note-actions">
          <button type="button" class="mil" data-calib-load="${index}" style="font-size:0.62rem;padding:0.12rem 0.3rem;">Yükle</button>
          <button type="button" class="mil" data-calib-del="${index}" style="font-size:0.62rem;padding:0.12rem 0.3rem;" title="Sil">✕</button>
        </div>
      </div>`;
    })
    .join("");
}

async function loadCalibNotesFromSettings() {
  try {
    const s = await getAppSettings();
    const raw = s?.legacyDepthCalibNotes || s?.legacy_depth_calib_notes || [];
    renderCalibNotesList(raw);
  } catch (error) {
    console.warn("[legacy-dik] calib notes load:", error);
    renderCalibNotesList([]);
  }
}

async function saveCalibNoteFromUi() {
  const labelRaw = String($("legacy-param-label-depth")?.value ?? "").trim();
  const labelDepthM = Number(labelRaw);
  if (!Number.isFinite(labelDepthM) || labelDepthM <= 0 || labelDepthM > 20) {
    setStatus("Defter için saha etiketi (m) girin");
    return;
  }
  const params = readDepthParamsFromUi();
  const note = {
    labelDepthM,
    fileName: state.legacyDikFileName || "",
    sensorHeightM: params.sensorHeightM,
    bipolarSepFactor: params.bipolarSepFactor,
    dipoleBlend: params.dipoleBlend,
    savedAt: new Date().toISOString().slice(0, 19),
  };
  const next = [note, ...calibNotesCache].slice(0, 20);
  try {
    const saved = await setLegacyDepthCalibNotes(next);
    const raw = saved?.legacyDepthCalibNotes || saved?.legacy_depth_calib_notes || next;
    renderCalibNotesList(raw);
    setStatus(`Kalibrasyon defterine kaydedildi · ${labelDepthM.toFixed(1)} m`);
  } catch (error) {
    setStatus(`Defter: ${error?.message || error}`);
  }
}

async function deleteCalibNoteAt(index) {
  const next = calibNotesCache.filter((_, i) => i !== index);
  try {
    const saved = await setLegacyDepthCalibNotes(next);
    const raw = saved?.legacyDepthCalibNotes || saved?.legacy_depth_calib_notes || next;
    renderCalibNotesList(raw);
    setStatus("Kalibrasyon notu silindi");
  } catch (error) {
    setStatus(`Defter: ${error?.message || error}`);
  }
}

function loadCalibNoteAt(index) {
  const note = calibNotesCache[index];
  if (!note) return;
  writeDepthParamsToUi(note);
  const label = $("legacy-param-label-depth");
  if (label) label.value = String(Number(note.labelDepthM.toFixed(1)));
  setStatus("Defter notu alanlara yazıldı — kaydetmek için Uygula");
}

function syncLegacyGuideUi() {
  const host = $("legacy-dik-guide");
  if (!host) return;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(GUIDE_STORAGE_KEY) === "1";
  } catch {
    dismissed = false;
  }
  host.hidden = dismissed;
}

function dismissLegacyGuide() {
  try {
    localStorage.setItem(GUIDE_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
  const host = $("legacy-dik-guide");
  if (host) host.hidden = true;
}

function syncSceneViewUi() {
  const select = $("legacy-scene-view");
  if (!select) return;
  select.value = getLegacySceneViewMode();
  select.disabled = !state.legacyDikResult;
}

function syncStepNumberingUi() {
  const select = $("legacy-step-numbering");
  if (!select) return;
  select.value = getLegacyStepNumberingDirection();
  select.disabled = !state.legacyDikResult;
}
function syncLabelModeUi() {
  const select = $("legacy-label-mode");
  if (!select) return;
  select.value = getLegacyLabelMode();
  select.disabled = !state.legacyDikResult;
}

function focusLegacyStepFromInput() {
  const input = $("legacy-step-number-input");
  const raw = String(input?.value ?? "").trim();
  const stepCount = Array.isArray(state.legacyDikResult?.scanSteps)
    ? state.legacyDikResult.scanSteps.length
    : Number(state.legacyFieldModel?.steps?.length) || 0;
  const step = Number(raw);
  if (!Number.isInteger(step) || step < 1 || (stepCount > 0 && step > stepCount)) {
    setStatus(stepCount > 0 ? `Adım numarası 1–${stepCount} arasında olmalıdır` : "Önce tarama analizi yapın");
    input?.focus();
    return null;
  }
  focusLegacyStep(step);
  if (input) input.value = String(step);
  const list = $("legacy-dik-list");
  list?.querySelectorAll("[data-legacy-step]").forEach((el) => {
    const active = Number(el.dataset.legacyStep) === step;
    el.classList.toggle("is-selected", active);
    el.style.borderColor = active ? "#f4c875" : "var(--line)";
    el.style.background = active ? "rgba(244,200,117,0.14)" : "rgba(255,255,255,0.025)";
  });
  setStatus(`Adım ${step} seçildi · yalnız bu adımdaki objeler gösteriliyor`);
  return step;
}

function syncStepNumberInput() {
  const input = $("legacy-step-number-input");
  const button = $("btn-legacy-step-go");
  const count = Array.isArray(state.legacyDikResult?.scanSteps)
    ? state.legacyDikResult.scanSteps.length
    : Number(state.legacyFieldModel?.steps?.length) || 0;
  if (input) {
    input.disabled = !state.legacyDikResult;
    input.max = String(Math.max(count, 1));
    input.value = state.legacySelectedStepIndex == null ? "" : String(state.legacySelectedStepIndex);
  }
  if (button) button.disabled = !state.legacyDikResult || count < 1;
}

function maybeFocusTomography(detection) {
  if (!state.legacyTomographyVisible || !detection) return;
  focusTomographyOnDetection(detection);
  syncTomographyControlsUi();
}

function applyListFilter(list, filter) {
  const showSteps = filter !== "detections";
  list.querySelectorAll(".legacy-step-summary, .legacy-step-list, .legacy-step-list + div").forEach((el) => {
    el.style.display = showSteps ? "" : "none";
  });
  list.querySelectorAll(".legacy-step-card").forEach((el) => {
    const matches = matchesLegacyListFilter(filter, {
      status: el.dataset.legacyStatus,
      anomalyCount: el.dataset.legacyHasDetection === "1",
      isDetection: false,
    });
    el.style.display = matches && showSteps ? "block" : "none";
  });
  list.querySelectorAll(".legacy-anomaly-card").forEach((el) => {
    el.style.display = matchesLegacyListFilter(filter, {
      status: el.dataset.legacyStatus,
      isDetection: true,
    })
      ? "block"
      : "none";
  });
}

/**
 * Sol panel + özet + tomografi butonu — dosya seçimi ve arşiv aynı yolu kullanır.
 * @param {object} result Ham veya normalize LegacyDikResult
 * @param {{ fileName?: string, statusSuffix?: string }} [options]
 */
export function renderLegacyDikPanel(result, options = {}) {
  const normalized = normalizeLegacyResult(result, state.legacyMatrixHint || null);
  applyLegacyNumberingToNormalized(normalized, {
    numberingDirection: state.legacyStepNumberingDirection,
  });
  const fileName = options.fileName || state.legacyDikFileName || "legacy_dik.json";
  const fieldModel = buildLegacyFieldModel(normalized);
  state.legacyDikResult = normalized;
  state.legacyFieldModel = fieldModel;
  state.legacyDikFileName = fileName;

  const tomographyButton = $("btn-legacy-tomography");
  if (tomographyButton) {
    tomographyButton.disabled = !isLegacyTomographyAvailable(normalized);
    if (!state.legacyTomographyVisible) {
      tomographyButton.textContent = "▦ Tomografi";
      tomographyButton.classList.remove("accent");
      tomographyButton.setAttribute("aria-pressed", "false");
    }
  }
  syncTomographyControlsUi();
  syncSubsurfaceButtonUi(isLegacySubsurfaceMapAvailable(normalized));
  syncGeothermalButtonUi(isLegacyGeothermalMapAvailable(normalized));
  syncDepthButtonUi(isLegacyDepthMapAvailable(normalized));
  syncInvertProxyButtonUi(isLegacyInvertProxyAvailable(normalized));
  syncLabelModeUi();
  syncStepNumberingUi();
  syncSceneViewUi();
  applyFocusSafeStepVisibility(state.legacySelectedDetectionId);
  syncStepNumberInput();
  syncObjectViewUi(fieldModel);
  syncLegacyExportUi(fieldModel);
  void refreshLegacyArchiveConsistency(fileName, fieldModel);

  const st = $("legacy-dik-status");
  if (st) {
    const fp = normalized.fingerprint || "";
    const suffix = options.statusSuffix || legacyDikSummary(normalized);
    st.textContent = `${fileName} · ${suffix}${fp ? ` · ${fp}` : ""}`;
  }

  const summaryHost = $("legacy-field-summary-content");
  const summarySection = $("legacy-field-summary");
  if (summaryHost && summarySection) {
    const strong = fieldModel.detections.filter((detection) => detection.status === "strong");
    const first = strong[0] || fieldModel.detections[0];
    summarySection.style.display = fieldModel.steps.length || fieldModel.detections.length ? "" : "none";
    summaryHost.innerHTML = `<div style="font-size:0.72rem;color:var(--text);margin-top:0.25rem;"><b>${fieldModel.steps.length}</b> adım · <b>${fieldModel.detections.length}</b> tespit · <b style="color:#ff7777;">${strong.length}</b> güçlü</div>${first ? `<div style="font-size:0.68rem;line-height:1.45;margin-top:0.3rem;color:#dce8ef;"><b>${escapeLegacyHtml(first.type)}</b><br/>Adım ${first.stepIndex ?? "—"} · hat ${first.stationM.toFixed(2)} m · derinlik ${first.depthTopM.toFixed(2)}–${first.depthBottomM.toFixed(2)} m · güven %${Math.round(first.confidence * 100)}<br/><span style="color:#8fe3ae;">${escapeLegacyHtml(first.recommendation)}</span></div>` : `<div style="font-size:0.66rem;color:var(--muted);margin-top:0.25rem;">Önemli tespit bulunamadı.</div>`}`;
  }

  const list = $("legacy-dik-list");
  if (list) {
    const anomalies = selectLegacyAnomalies(normalized);
    const scanSteps = Array.isArray(normalized.scanSteps) ? normalized.scanSteps : [];
    const averageSpacing = Number(normalized.scanStepSpacingM) || 0;
    const inputSpacing = Number(normalized.scanStepInputM) || 0;
    const modelById = new Map(fieldModel.detections.map((detection) => [detection.detectionId, detection]));
    const listFilter = state.legacyListFilter || "all";
    const filterLabels = [
      ["all", "Tümü"],
      ["detections", "Sadece tespitler"],
      ["strong", "Güçlü"],
      ["attention", "Dikkat"],
      ["normal", "Normal"],
    ];
    const filterBar = `<div class="legacy-list-filters" role="toolbar" aria-label="Tespit filtreleri"><span class="legacy-filter-label">Filtre</span>${filterLabels.map(([id, label]) => `<button type="button" class="legacy-filter-button${listFilter === id ? " is-active" : ""}" data-legacy-filter="${id}">${label}</button>`).join("")}</div>`;
    const matrixLabel = Number(result.matrixRows) > 0 && Number(result.matrixCols) > 0
      ? `${Number(result.matrixRows)}×${Number(result.matrixCols)} matris`
      : null;
    const stepSummary = scanSteps.length
      ? `<div class="legacy-step-summary"><span class="legacy-section-kicker">TARAMA ADIMLARI</span><span class="legacy-step-total">${scanSteps.length} adım${matrixLabel ? ` · ${matrixLabel}` : ""}</span><span class="legacy-step-spacing">Adım aralığı: <b>${inputSpacing > 0 ? `${inputSpacing.toFixed(2)} m` : averageSpacing > 0 ? `${averageSpacing.toFixed(2)} m` : "otomatik"}</b></span><label class="legacy-step-jump"><span>Adım no</span><input id="legacy-step-number-input" type="number" min="1" max="${scanSteps.length}" step="1" placeholder="no" aria-label="Adım numarası" /><button type="button" id="btn-legacy-step-go" class="mil">Git</button></label><button type="button" class="mil legacy-step-all" data-legacy-step="all">Tümü</button></div><div class="legacy-step-list">${scanSteps.map((step, index) => {
          const idx = Number(step.index) || index + 1;
          const x = Number(step.xCenterM);
          const spacing = Number(step.spacingFromPreviousM) || 0;
          const width = Number(step.widthM) || 0;
          const length = Number(step.lengthM) || 0;
          const modelStep = fieldModel.steps.find((entry) => entry.stepIndex === idx);
          const stepStatus = modelStep ? statusLabel(modelStep.status) : "NORMAL";
          const anomalyCount = modelStep?.anomalyCount || 0;
          const stationM = modelStep?.stationM;
          const stationText = Number.isFinite(stationM) ? stationM.toFixed(2) : (Number.isFinite(x) ? x.toFixed(2) : "—");
          return `<button type="button" class="legacy-step-card${idx === state.legacySelectedStepIndex ? " is-selected" : ""}" data-legacy-step="${idx}" data-legacy-status="${modelStep?.status || "normal"}" data-legacy-has-detection="${anomalyCount > 0 ? "1" : "0"}">
                <span class="legacy-step-topline"><span class="legacy-step-number">${String(idx).padStart(2, "0")}</span><span class="legacy-step-title">Adım ${idx}</span><span class="legacy-step-station">${stationText} m</span><span class="legacy-step-status ${stepStatus === "GÜÇLÜ" ? "is-strong" : stepStatus === "DİKKAT" ? "is-attention" : "is-normal"}">${stepStatus}</span></span>
                <span class="legacy-step-meta"><span><b>Hat</b> ${stationText} m</span><span><b>Aralık</b> ${Number.isFinite(stationM) && modelStep ? `${Math.max(0, modelStep.startM).toFixed(2)}–${modelStep.endM.toFixed(2)} m` : "—"}</span></span>
                <span class="legacy-step-meta legacy-step-submeta"><span><b>Tespit</b> ${anomalyCount}</span><span><b>Açıklık</b> ${width.toFixed(2)} × ${length.toFixed(2)} m</span>${idx > 1 ? `<span><b>Önceki</b> ${spacing.toFixed(2)} m</span>` : ""}</span>
              </button>`;
        }).join("")}</div><div style="color:var(--muted);margin-bottom:0.25rem;">Seçili adımın işareti ve anomalileri 3D'de gösteriliyor.</div>`
      : "";
    const rows = anomalies.map((c, i) => {
      const top = Number(c.depthTopM ?? 0);
      const bot = Number(c.depthBottomM ?? top);
      const sig = Number(c.peakSigma ?? c.strength) || 0;
      const shapeNames = { circle: "daire", ellipse: "elips", square: "kare", rectangle: "dikdörtgen", capsule: "kapsül", polygon: "çokgen", irregular: "düzensiz" };
      const shapeType = String(c.shapeType ?? "irregular").toLowerCase();
      const shapeName = shapeNames[shapeType] || "düzensiz";
      const shapeConfidence = Math.round((Number(c.shapeConfidence) || 0) * 100);
      const shapeError = Number(c.shapeFitError);
      const width = Number(c.widthM ?? c.rx * 2) || 0;
      const length = Number(c.lengthM ?? c.ry * 2) || 0;
      const source = String(c.shapeSource ?? "inferred") === "grid-contour" ? "ölçüm konturu" : "tahmini şekil";
      const strong = i === 0 ? "border-color:#f4c875;background:rgba(244,200,117,0.10);" : "";
      const kind = String(c.kind || "anomali").toLowerCase();
      const detectionId = `legacy-dik-shape-${i + 1}`;
      const detection = modelById.get(detectionId);
      const detectionStep = detection ? fieldModel.steps.find((step) => step.stepIndex === detection.stepIndex) : null;
      const stepRangeText = detectionStep ? `${detectionStep.startM.toFixed(2)}–${detectionStep.endM.toFixed(2)} m` : "—";
      const detectionStatus = detection?.status || "normal";
      const dims = dimensionsOf(c, { height: Math.max(bot - top, 0.2) });
      const volume = detection?.volumeM3 ?? volumeM3Of(c, {
        mapWidthM: Number(normalized.gridWidthM) || dims.width,
        mapDepthM: Number(normalized.gridDepthM) || dims.length,
        height: dims.height,
      });
      const recommendation = detection?.recommendation
        ? `<div style="color:#8fe3ae;margin-top:0.2rem;">Öneri: ${escapeLegacyHtml(detection.recommendation)}</div>`
        : "";
      const mag = detection?.magneticResponse || magneticResponseOf(detection || c);
      const magBadge = `<div class="legacy-mag-response" title="${escapeLegacyHtml(mag.disclaimer)}">${escapeLegacyHtml(mag.label)}</div>`;
      const consistBadge = consistencyBadgeHtml(detectionId);
      const volumeText = `<span class="legacy-volume-line"><b>Yaklaşık hacim</b> ${formatVolumeM3(volume)} · ${dims.width.toFixed(2)} × ${dims.length.toFixed(2)} × ${dims.height.toFixed(2)} m</span>`;
      return `<div class="legacy-anomaly-card" data-legacy-focus="${detectionId}" data-legacy-status="${detectionStatus}" style="display:block;width:100%;text-align:left;color:var(--text);${strong}"><button type="button" class="legacy-detection-main" data-legacy-focus="${detectionId}" style="display:block;width:100%;text-align:left;color:inherit;background:none;border:0;padding:0;cursor:pointer;"><span style="color:${kind === "metal" ? "#e85858" : "#f4c875"};">${i === 0 ? "★" : "◆"} #${i + 1}</span> <b>${kind === "metal" ? "Metal" : "Anomali"}</b> · ${shapeName} · ${source}<br/><span>Adım ${detection?.stepIndex ?? "—"} · hat ${detection?.stationM?.toFixed(2) ?? "—"} m · aralık ${stepRangeText} · derinlik ${top.toFixed(2)}–${bot.toFixed(2)} m · güven %${Math.round((detection?.confidence ?? Number(c.confidence) ?? 0) * 100)} · ${sig.toFixed(1)}σ</span><br/><span>şekil güveni %${shapeConfidence} · RMS ${Number.isFinite(shapeError) ? shapeError.toFixed(2) : "—"} · boyut ${width.toFixed(2)} × ${length.toFixed(2)} m · ${volumeText}</span></button>${magBadge}${consistBadge}<div style="display:flex;gap:0.25rem;margin-top:0.25rem;"><button type="button" class="mil" data-legacy-show="${detectionId}">3D’de göster</button><button type="button" class="mil" data-legacy-only="${detectionId}">Sadece bunu göster</button></div>${recommendation}</div>`;
    });
    list.innerHTML = `${filterBar}${stepSummary}${rows.length
      ? `<div class="legacy-detection-heading"><span class="legacy-section-kicker">TESPİTLER</span><span>${rows.length} ayrı sonuç · güçlüden zayıfa</span></div>${rows.join("")}`
      : `<div class="legacy-empty-state">Analiz anomalisi bulunamadı · ${escapeLegacyHtml(fileName)} · ${escapeLegacyHtml(normalized.fingerprint || "")}</div>`}`;
    if (listFilter !== "all") applyListFilter(list, listFilter);
  }

  const clr = $("btn-legacy-dik-clear");
  if (clr) clr.disabled = false;
  updateLegacySahaBrief(state.legacySelectedDetectionId);
  syncLegacyMatrixProductLabel();
}

export function clearLegacyDikPanel() {
  removeLegacyTomography();
  removeLegacySubsurfaceMap();
  removeLegacyGeothermalMap();
  removeLegacyDepthMap();
  removeLegacyDikShapes();
  state.legacyDikResult = null;
  state.legacyFieldModel = null;
  state.legacySelectedDetectionId = null;
  state.legacyDikRawContent = null;
  state.legacyDikFileName = null;
  state.legacyArchiveDepthSpread = null;
  const summary = $("legacy-field-summary");
  if (summary) summary.style.display = "none";
  const st = $("legacy-dik-status");
  if (st) st.textContent = "";
  const list = $("legacy-dik-list");
  if (list) list.innerHTML = "";
  const clr = $("btn-legacy-dik-clear");
  if (clr) clr.disabled = true;
  const tomographyButton = $("btn-legacy-tomography");
  if (tomographyButton) {
    tomographyButton.disabled = true;
    tomographyButton.textContent = "▦ Tomografi";
    tomographyButton.classList.remove("accent");
    tomographyButton.setAttribute("aria-pressed", "false");
  }
  const tomoHost = $("legacy-tomo-controls");
  if (tomoHost) tomoHost.style.display = "none";
  syncSubsurfaceButtonUi(false);
  syncGeothermalButtonUi(false);
  syncDepthButtonUi(false);
  syncInvertProxyButtonUi(false);
  syncLabelModeUi();
  syncObjectViewUi();
  syncLegacyExportUi(null);
  state.legacyGeothermalAiText = null;
  syncGeothermalAiUi();
  updateLegacySahaBrief(null);
  syncLegacyMatrixProductLabel();
}

function readLegacyMatrixInput() {
  const rowsRaw = String($("legacy-dik-matrix-rows")?.value ?? "0").trim();
  const colsRaw = String($("legacy-dik-matrix-cols")?.value ?? "0").trim();
  const matrixRows = rowsRaw === "" ? 0 : Number(rowsRaw);
  const matrixCols = colsRaw === "" ? 0 : Number(colsRaw);
  if (!Number.isInteger(matrixRows) || matrixRows < 0 || matrixRows > 500) {
    throw new Error("Satır sayısı 0–500 arasında tam sayı olmalıdır");
  }
  if (!Number.isInteger(matrixCols) || matrixCols < 0 || matrixCols > 500) {
    throw new Error("Sütun sayısı 0–500 arasında tam sayı olmalıdır");
  }
  if ((matrixRows > 0) !== (matrixCols > 0)) {
    throw new Error("Satır ve sütunu birlikte girin (ör. 6×3), ya da ikisini de 0 bırakın");
  }
  const scanStepCount = matrixRows > 0 && matrixCols > 0 ? matrixRows * matrixCols : 0;
  if (scanStepCount > 10000) {
    throw new Error("Matris çarpımı (satır×sütun) 10000’den büyük olamaz");
  }
  return {
    matrixRows,
    matrixCols,
    scanStepCount,
    hint: scanStepCount > 0 ? { matrixRows, matrixCols } : null,
  };
}

function syncLegacyMatrixProductLabel() {
  const el = $("legacy-dik-matrix-product");
  if (!el) return;
  try {
    const matrix = readLegacyMatrixInput();
    const analyzed = Array.isArray(state.legacyDikResult?.scanSteps)
      ? state.legacyDikResult.scanSteps.length
      : (Number(state.legacyDikResult?.scanStepCount) || null);
    const { text, status } = formatLegacyMatrixProductStatus(matrix, analyzed);
    el.textContent = text;
    el.classList.toggle("is-mismatch", status === "mismatch");
    el.classList.toggle("is-match", status === "match");
    el.classList.toggle("is-label", status === "label" || status === "auto");
  } catch (_) {
    el.textContent = "satır × sütun";
    el.classList.remove("is-mismatch", "is-match", "is-label");
  }
}

async function runLegacyDik() {
  try {
    const picked = await pickLegacyDikJson();
    if (!picked?.content) return;
    setStatus("Dik çekim analiz ediliyor…");
    await ensureViewer();
    try { removeCsvOverlay(); } catch (_) {}
    try { removeLegacyDikShapes(); } catch (_) {}
    const fileName = picked.fileName || picked.file_name || "scan.json";
    const { matrix, effectiveStepSpacingM } = readLegacyAnalyzeInputs();
    const depthParams = readDepthParamsFromUi();
    const result = await analyzeLegacyDikJson(
      picked.content,
      fileName,
      matrix.scanStepCount,
      effectiveStepSpacingM,
      depthParams
    );
    const normalized = normalizeLegacyResult(result, matrix.hint);
    state.legacyDikRawContent = picked.content;
    state.legacySelectedDetectionId = null;
    state.legacyMatrixHint = matrix.hint;
    const resultSteps = Array.isArray(normalized.scanSteps) ? normalized.scanSteps : [];
    state.legacySelectedStepIndex = null;
    addLegacyDikShapesToScene(normalized);
    renderLegacyDikPanel(normalized, { fileName });
    try {
      await saveLegacyArchive(fileName, picked.content, normalized);
      await refreshArchives();
    } catch (archiveError) {
      console.warn("[legacy-dik] arşiv kaydı yapılamadı:", archiveError);
    }
    setStatus(normalized.message || "Dik çekim hazır");
  } catch (e) {
    console.warn("[legacy-dik]", e);
    setStatus(`Dik çekim: ${e}`);
  }
}

async function runLegacyLeveling() {
  try {
    const content = state.legacyDikRawContent;
    if (!content) {
      setStatus("Önce bir Legacy JSON yükleyin");
      return;
    }
    setStatus("Median leveling uygulanıyor…");
    const leveled = await levelLegacyMagJson(content);
    if (!leveled?.leveledJson && !leveled?.leveled_json) {
      throw new Error(leveled?.message || "Leveling sonucu boş");
    }
    const leveledJson = leveled.leveledJson || leveled.leveled_json;
    const fileName = state.legacyDikFileName || "leveled.json";
    const { matrix, effectiveStepSpacingM } = readLegacyAnalyzeInputs();
    const depthParams = readDepthParamsFromUi();
    const result = await analyzeLegacyDikJson(
      leveledJson,
      fileName,
      matrix.scanStepCount,
      effectiveStepSpacingM,
      depthParams
    );
    const normalized = normalizeLegacyResult(result, matrix.hint);
    state.legacyDikRawContent = leveledJson;
    state.legacyMatrixHint = matrix.hint;
    await ensureViewer();
    try { removeLegacyDikShapes(); } catch (_) {}
    addLegacyDikShapesToScene(normalized);
    renderLegacyDikPanel(normalized, {
      fileName,
      statusSuffix: `${legacyDikSummary(normalized)} · leveled`,
    });
    setStatus(leveled.message || "Leveling uygulandı ve yeniden analiz edildi");
  } catch (e) {
    console.warn("[legacy-level]", e);
    setStatus(`Leveling: ${e}`);
  }
}

async function applyLegacyDepthParams() {
  try {
    const params = readDepthParamsFromUi();
    writeDepthParamsToUi(params);
    const saved = await setLegacyDepthParams(params);
    writeDepthParamsToUi(saved?.legacyDepthParams || saved?.legacy_depth_params || params);
    if (state.legacyDikRawContent) {
      setStatus("Parametre kaydedildi · yeniden analiz…");
      const normalized = await reanalyzeCurrentLegacyJson(params);
      setStatus(normalized?.message || "Parametre uygulandı");
    } else {
      setStatus("Parametre kaydedildi");
    }
  } catch (e) {
    console.warn("[legacy-dik] params apply", e);
    setStatus(`Parametre: ${e}`);
  }
}

async function resetLegacyDepthParams() {
  try {
    writeDepthParamsToUi(DEFAULT_DEPTH_PARAMS);
    const saved = await setLegacyDepthParams({ ...DEFAULT_DEPTH_PARAMS });
    writeDepthParamsToUi(saved?.legacyDepthParams || saved?.legacy_depth_params || DEFAULT_DEPTH_PARAMS);
    if (state.legacyDikRawContent) {
      setStatus("Parametre sıfırlandı · yeniden analiz…");
      const normalized = await reanalyzeCurrentLegacyJson(DEFAULT_DEPTH_PARAMS);
      setStatus(normalized?.message || "Parametre sıfırlandı");
    } else {
      setStatus("Parametre varsayılana alındı");
    }
  } catch (e) {
    console.warn("[legacy-dik] params reset", e);
    setStatus(`Parametre: ${e}`);
  }
}

function syncDepthCalibAiUi(text = state.legacyDepthCalibAiText) {
  const resultEl = $("legacy-params-ai-result");
  const fillBtn = $("btn-legacy-params-ai-fill");
  if (resultEl) {
    const body = String(text || "").trim();
    resultEl.hidden = !body;
    resultEl.textContent = body;
  }
  if (fillBtn) {
    fillBtn.disabled = !state.legacyDepthCalibSuggestion;
  }
}

async function runDepthCalibAiSuggest() {
  const button = $("btn-legacy-params-ai");
  const labelRaw = String($("legacy-param-label-depth")?.value ?? "").trim();
  const labelM = Number(labelRaw);
  if (!Number.isFinite(labelM) || labelM <= 0 || labelM > 20) {
    setStatus("Saha etiketi (m) girin — örn. 3.4");
    return;
  }
  if (!state.legacyDikResult && !state.legacyDikRawContent) {
    setStatus("Önce Legacy JSON yükleyin");
    return;
  }
  try {
    if (button) button.textContent = "…";
    const params = readDepthParamsFromUi();
    const out = await suggestDepthParamsWithAi(labelM, params);
    state.legacyDepthCalibAiText = out.text || "";
    state.legacyDepthCalibSuggestion = out.suggested || null;
    syncDepthCalibAiUi(out.text);
    if (out.ok && out.suggested) {
      writeDepthParamsToUi(out.suggested);
      setStatus(
        out.source === "ai"
          ? "AI önerisi Parametre alanlarına yazıldı — kaydetmek için Uygula"
          : "Yerel öneri Parametre alanlarına yazıldı — kaydetmek için Uygula",
      );
    } else {
      setStatus(
        out.ok
          ? (out.source === "ai" ? "AI kalibrasyon önerisi hazır" : "Yerel kalibrasyon önerisi hazır")
          : "Kalibrasyon önerisi üretilemedi",
      );
    }
  } catch (e) {
    console.warn("[legacy-dik] depth calib ai", e);
    state.legacyDepthCalibAiText = `Öneri başarısız: ${e?.message || e}`;
    state.legacyDepthCalibSuggestion = null;
    syncDepthCalibAiUi(state.legacyDepthCalibAiText);
    setStatus("Kalibrasyon önerisi başarısız");
  } finally {
    if (button) button.textContent = "🤖 AI öner";
  }
}

function fillDepthParamsFromSuggestion() {
  const suggested = state.legacyDepthCalibSuggestion;
  if (!suggested) {
    setStatus("Önce AI öner çalıştırın");
    return;
  }
  writeDepthParamsToUi(suggested);
  setStatus("Öneri alanlara yazıldı — kaydetmek için Uygula");
}

let _bound = false;

export function bindLegacyDikPanel() {
  if (_bound) return;
  _bound = true;

  const legacyList = $("legacy-dik-list");
  legacyList?.addEventListener("click", (event) => {
    if (event.target.closest("#btn-legacy-step-go")) {
      focusLegacyStepFromInput();
      return;
    }
    const input = event.target.closest("#legacy-step-number-input");
    if (input) return;

    const filterButton = event.target.closest("[data-legacy-filter]");
    if (filterButton) {
      const filter = filterButton.dataset.legacyFilter || "all";
      state.legacyListFilter = filter;
      legacyList.querySelectorAll("[data-legacy-filter]").forEach((el) => {
        el.classList.toggle("is-active", el === filterButton);
      });
      applyListFilter(legacyList, filter);
      return;
    }
    const showButton = event.target.closest("[data-legacy-show]");
    if (showButton) {
      const id = showButton.dataset.legacyShow;
      if (id && state.structureTargets?.[id]) {
        focusLegacyDetection(id);
        const detection = state.legacyFieldModel?.detections?.find((item) => item.detectionId === id);
        maybeFocusTomography(detection);
        updateLegacySahaBrief(id);
      }
      return;
    }
    const onlyButton = event.target.closest("[data-legacy-only]");
    if (onlyButton) {
      const id = onlyButton.dataset.legacyOnly;
      if (id && state.structureTargets?.[id]) {
        focusLegacyDetection(id);
        const detection = state.legacyFieldModel?.detections?.find((item) => item.detectionId === id);
        maybeFocusTomography(detection);
        updateLegacySahaBrief(id);
        legacyList.querySelectorAll(".legacy-anomaly-card").forEach((el) => {
          el.style.opacity = el.dataset.legacyFocus === id ? "1" : "0.45";
        });
      }
      return;
    }
    const stepCard = event.target.closest("[data-legacy-step]");
    if (stepCard) {
      const rawStep = stepCard.dataset.legacyStep;
      if (rawStep === "all") {
        clearLegacySelection();
        const stepInput = $("legacy-step-number-input");
        if (stepInput) stepInput.value = "";
        legacyList.querySelectorAll("[data-legacy-step]").forEach((el) => {
          el.classList.toggle("is-selected", el === stepCard);
          el.style.borderColor = el === stepCard ? "#f4c875" : "var(--line)";
          el.style.background = el === stepCard ? "rgba(244,200,117,0.14)" : "rgba(255,255,255,0.025)";
        });
        return;
      }
      const stepIndex = Number(rawStep);
      if (Number.isFinite(stepIndex)) {
        // Adim secimi sadece 3D gorunurluk filtresini ayarlar; obje kartlari
        // tespit secimine gore ayrı ayrı degistirilebilir, bu yuzden burada
        // kart opakligini degistirmiyoruz.
        focusLegacyStep(stepIndex);
        const stepInput = $("legacy-step-number-input");
        if (stepInput) stepInput.value = String(stepIndex);
        legacyList.querySelectorAll("[data-legacy-step]").forEach((el) => {
          const active = Number(el.dataset.legacyStep) === stepIndex;
          el.classList.toggle("is-selected", active);
          el.style.borderColor = active ? "#f4c875" : "var(--line)";
          el.style.background = active ? "rgba(244,200,117,0.14)" : "rgba(255,255,255,0.025)";
        });
      }
      return;
    }
    const card = event.target.closest("[data-legacy-focus]");
    if (!card) return;
    const id = card.dataset.legacyFocus;
    if (id && state.structureTargets?.[id]) {
      focusLegacyDetection(id);
      const detection = state.legacyFieldModel?.detections?.find((item) => item.detectionId === id);
      maybeFocusTomography(detection);
      updateLegacySahaBrief(id);
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  legacyList?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.closest("#legacy-step-number-input")) {
      event.preventDefault();
      focusLegacyStepFromInput();
    }
  });

  $("btn-legacy-saha-copy")?.addEventListener("click", () => {
    copyLegacySahaBrief();
  });

  $("btn-legacy-export-csv")?.addEventListener("click", async () => {
    const detections = state.legacyFieldModel?.detections;
    if (!detections?.length) {
      setStatus("Dışa aktarılacak tespit yok");
      return;
    }
    try {
      await exportLegacyDetectionsCsv(detections, readDepthParamsFromUi());
      setStatus(`CSV: ${detections.length} tespit dışa aktarıldı`);
    } catch (e) {
      setStatus(`CSV: ${e?.message || e}`);
    }
  });

  $("btn-legacy-export-geojson")?.addEventListener("click", async () => {
    const detections = state.legacyFieldModel?.detections;
    if (!detections?.length) {
      setStatus("Dışa aktarılacak tespit yok");
      return;
    }
    try {
      await exportLegacyDetectionsGeoJson(detections, readDepthParamsFromUi());
      setStatus(`GeoJSON: ${detections.length} tespit dışa aktarıldı`);
    } catch (e) {
      setStatus(`GeoJSON: ${e?.message || e}`);
    }
  });

  $("btn-legacy-export-summary")?.addEventListener("click", async () => {
    const detections = state.legacyFieldModel?.detections;
    if (!detections?.length) {
      setStatus("Özet için önce tespit yükleyin");
      return;
    }
    try {
      const scale = state.legacyFieldModel?.residualScale || residualScaleOf(state.legacyDikResult);
      await exportLegacyFieldSummary({
        fileName: state.legacyDikFileName || "legacy.json",
        briefHtml: lastSahaBriefHtml || "",
        briefText: lastSahaBriefText || "",
        residualNote: scale?.display || "residual σ · kalibre nT değil",
        params: readDepthParamsFromUi(),
        fingerprint: state.legacyDikResult?.fingerprint || "",
      });
      setStatus("Saha özeti HTML kaydedildi — Yazdır / PDF");
    } catch (e) {
      setStatus(`Saha özeti: ${e?.message || e}`);
    }
  });

  $("legacy-step-number-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      focusLegacyStepFromInput();
    }
  });
  $("btn-legacy-step-go")?.addEventListener("click", () => focusLegacyStepFromInput());

  $("legacy-step-numbering")?.addEventListener("change", async (event) => {
    const direction = setLegacyStepNumberingDirection(event.target.value);
    syncStepNumberingUi();
    if (!state.legacyDikResult && !state.legacyDikRawContent) {
      setStatus(direction === "rtl" ? "Adım yönü: sağdan sola" : "Adım yönü: soldan sağa");
      return;
    }
    try {
      let matrixHint = state.legacyMatrixHint;
      try {
        const matrix = readLegacyMatrixInput();
        matrixHint = matrix.hint || matrixHint;
        state.legacyMatrixHint = matrixHint;
      } catch {
        /* matris boşsa mevcut hint */
      }
      const normalized = normalizeLegacyResult(state.legacyDikResult || {}, matrixHint);
      if (!normalized?.scanSteps?.length && state.legacyDikRawContent) {
        await reanalyzeCurrentLegacyJson(readDepthParamsFromUi());
      } else {
        applyLegacyNumberingToNormalized(normalized, { numberingDirection: direction });
        await ensureViewer();
        try { removeLegacyDikShapes(); } catch (_) {}
        addLegacyDikShapesToScene(normalized);
        renderLegacyDikPanel(normalized, { fileName: state.legacyDikFileName || "legacy.json" });
      }
      setStatus(direction === "rtl" ? "Adımlar sağdan sola numaralandırıldı" : "Adımlar soldan sağa numaralandırıldı");
    } catch (error) {
      console.warn("[legacy-dik] step numbering:", error);
      setStatus(`Adım yönü: ${error?.message || error}`);
    }
  });
  $("legacy-scene-view")?.addEventListener("change", (event) => {
    const mode = setLegacySceneViewMode(event.target.value);
    event.target.value = mode;
    setStatus(mode === "plan" ? "Saha planı görünümü" : mode === "objects" ? "Objeler görünümü" : "Birleşik 3D görünüm");
  });

  $("btn-legacy-dik-pick")?.addEventListener("click", () => runLegacyDik());
  $("legacy-dik-matrix-rows")?.addEventListener("input", syncLegacyMatrixProductLabel);
  $("legacy-dik-matrix-cols")?.addEventListener("input", syncLegacyMatrixProductLabel);
  syncLegacyMatrixProductLabel();
  $("btn-legacy-tomography")?.addEventListener("click", () => {
    const enabled = toggleLegacyTomography(state.legacyDikResult);
    const button = $("btn-legacy-tomography");
    if (button) {
      button.textContent = enabled ? "▦ Tomografi: Açık" : "▦ Tomografi";
      button.classList.toggle("accent", enabled);
      button.setAttribute("aria-pressed", String(enabled));
    }
    syncTomographyControlsUi();
  });
  $("btn-legacy-subsurface")?.addEventListener("click", () => {
    toggleLegacySubsurfaceMap(state.legacyDikResult);
    syncSubsurfaceButtonUi();
  });
  $("btn-legacy-geothermal")?.addEventListener("click", () => {
    toggleLegacyGeothermalMap(state.legacyDikResult);
    if (!state.legacyGeothermalMapVisible) {
      state.legacyGeothermalAiText = null;
    }
    syncGeothermalButtonUi();
  });
  $("btn-legacy-depth")?.addEventListener("click", () => {
    toggleLegacyDepthMap(state.legacyDikResult);
    syncDepthButtonUi();
  });
  $("btn-legacy-invert")?.addEventListener("click", () => {
    const on = toggleLegacyInvertProxy();
    syncInvertProxyButtonUi();
    setStatus(
      on
        ? "Invert proxy açık — uydurma ayak izi (CAD değil)"
        : "Invert proxy kapalı",
    );
  });
  $("legacy-label-mode")?.addEventListener("change", (event) => {
    setLegacyLabelMode(event.target.value);
    syncLabelModeUi();
    setStatus(`3D etiket: ${getLegacyLabelMode() === "off" ? "kapalı" : getLegacyLabelMode() === "full" ? "tam kart" : "rozet"}`);
  });
  $("legacy-object-view")?.addEventListener("change", (event) => {
    setLegacyObjectViewMode(event.target.value);
    syncObjectViewUi();
    const mode = getLegacyObjectViewMode();
    setStatus(`3D çizim: ${mode === "signal" ? "sinyal bulutu" : mode === "both" ? "kontür + sinyal" : "anomali kontürü"}`);
  });
  $("legacy-object-blend")?.addEventListener("input", (event) => {
    const pct = Number(event.target.value);
    setLegacyObjectViewBlend((Number.isFinite(pct) ? pct : 50) / 100);
    const select = $("legacy-object-view");
    if (select) select.value = "both";
    syncObjectViewUi();
  });
  $("btn-legacy-guide-dismiss")?.addEventListener("click", () => dismissLegacyGuide());
  $("btn-legacy-calib-save")?.addEventListener("click", () => {
    void saveCalibNoteFromUi();
  });
  $("legacy-calib-notes-list")?.addEventListener("click", (event) => {
    const loadBtn = event.target.closest("[data-calib-load]");
    if (loadBtn) {
      loadCalibNoteAt(Number(loadBtn.dataset.calibLoad));
      return;
    }
    const delBtn = event.target.closest("[data-calib-del]");
    if (delBtn) {
      void deleteCalibNoteAt(Number(delBtn.dataset.calibDel));
    }
  });
  $("btn-legacy-geo-ai")?.addEventListener("click", async () => {
    const button = $("btn-legacy-geo-ai");
    const resultEl = $("legacy-geo-ai-result");
    if (!state.legacyGeothermalMapVisible) return;
    if (button) {
      button.disabled = true;
      button.textContent = "🤖 Yorumlanıyor…";
    }
    if (resultEl) {
      resultEl.hidden = false;
      resultEl.textContent = "Jeotermal proxy özeti hazırlanıyor…";
    }
    try {
      const out = await interpretGeothermalWithAi(state.legacyDikResult);
      state.legacyGeothermalAiText = out.text;
      setStatus(out.source === "ai" ? "Jeotermal AI yorumu hazır" : "Jeotermal yerel özet hazır (AI yok)");
    } catch (error) {
      state.legacyGeothermalAiText = `Yorum başarısız: ${error?.message || error}`;
      setStatus("Jeotermal AI yorumu başarısız");
    } finally {
      if (button) button.textContent = "🤖 AI yorumla";
      syncGeothermalAiUi();
    }
  });
  $("legacy-tomo-depth")?.addEventListener("input", (event) => {
    setTomographyDepthM(event.target.value);
    syncTomographyControlsUi();
  });
  $("legacy-tomo-opacity")?.addEventListener("input", (event) => {
    setTomographyOpacity(event.target.value);
    syncTomographyControlsUi();
  });
  $("legacy-tomo-sigma")?.addEventListener("change", (event) => {
    setTomographySigmaFloor(event.target.value);
    syncTomographyControlsUi();
  });
  $("btn-legacy-tomo-play")?.addEventListener("click", () => {
    const next = !state.legacyTomographyPlaying;
    setTomographyPlaying(next);
    if (next) {
      const tick = setInterval(() => {
        if (!state.legacyTomographyPlaying) {
          clearInterval(tick);
          syncTomographyControlsUi();
          return;
        }
        syncTomographyControlsUi();
      }, 200);
    }
    syncTomographyControlsUi();
  });
  $("btn-legacy-dik-clear")?.addEventListener("click", () => {
    clearLegacyDikPanel();
    setStatus("Dik çekim şekilleri temizlendi");
  });
  $("btn-legacy-dik-level")?.addEventListener("click", () => runLegacyLeveling());
  $("btn-legacy-params-apply")?.addEventListener("click", () => applyLegacyDepthParams());
  $("btn-legacy-params-reset")?.addEventListener("click", () => resetLegacyDepthParams());
  $("btn-legacy-params-ai")?.addEventListener("click", () => runDepthCalibAiSuggest());
  $("btn-legacy-params-ai-fill")?.addEventListener("click", () => fillDepthParamsFromSuggestion());
  syncLegacyGuideUi();
  void loadDepthParamsFromSettings();
  void loadCalibNotesFromSettings();
}
