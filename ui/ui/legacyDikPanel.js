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
  setLegacyFieldSessions,
  setLegacyLearnedThresholds,
  listArchive,
  loadLegacyArchive,
} from "../api/tauri.js";
import { ensureViewer } from "../viewer/scene.js";
import { removeCsvOverlay } from "../viewer/csvOverlay.js";
import { formatLegacyMatrixProductStatus } from "../viewer/legacyMatrixValidate.js";
import { applyLegacyNumberingToNormalized } from "../viewer/legacyGridTemplate.js";
import { bindLegacyReportExports } from "./legacyReportController.js";
import { bindLegacyCalibrationControls } from "./legacyCalibrationController.js";
import { bindLegacyDataControls } from "./legacyDataController.js";
import { syncLegacyTargetModeView, syncSelectView, syncStepNumberInputView, applyLegacyListFilterView } from "./legacyDikView.js";
import { bindLegacyAiControls } from "./legacyAiController.js";
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
} from "../viewer/legacyDikOverlay.js";
import {
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
  removeLegacySubsurfaceMap,
  isLegacySubsurfaceMapAvailable,
} from "../viewer/legacySubsurfaceMap.js";
import {
  removeLegacyUndergroundMap,
} from "../viewer/legacyUndergroundMap.js";
import { isLegacyUnifiedObjectMapAvailable, refreshLegacyUnifiedObjectMapStyles } from "../viewer/legacyUnifiedObjectMap.js";
import { refreshLegacyLateralEvidenceLayer } from "../viewer/legacyLateralEvidenceLayer.js";
import {
  removeLegacyGeothermalMap,
  isLegacyGeothermalMapAvailable,
} from "../viewer/legacyGeothermalMap.js";
import { interpretGeothermalWithAi } from "../viewer/legacyGeothermalAi.js";
import {
  removeLegacyDepthMap,
  isLegacyDepthMapAvailable,
} from "../viewer/legacyDepthMap.js";
import {
  setLegacyObjectViewMode,
  getLegacyObjectViewMode,
  setLegacyObjectViewBlend,
  getLegacyObjectViewBlend,
} from "../viewer/legacyObjectView.js";
import { buildDepthCalibSummary, summarizeFieldStakeReadings, suggestDepthParamsWithAi } from "../viewer/legacyDepthCalibAi.js";
import { buildLegacyDtaCaseBrief, formatLegacyDtaCaseBriefText } from "../viewer/legacyDtaBridge.js";
import { findSimilarReviewedCases, formatSimilarReviewedCases } from "../viewer/legacyReviewedCaseSearch.js";
import {
  buildLearnedThresholds,
  collectVerifiedSamples,
  serializeLearnedThresholds,
} from "../viewer/legacyThresholdLearning.js";
import {
  createLegacyTargetSession,
  selectedDetectionOf,
  selectedStepOf,
  WORKFLOW_PHASES,
} from "../viewer/legacyTargetSession.js";
import { createLegacySelectionController } from "../viewer/legacySelectionController.js";
import { deriveLegacyWorkflow } from "../viewer/legacyWorkflowController.js";
import {
  isTargetInSessionReport,
  isTargetReviewed,
  recordVisit,
  toggleTargetInReport as toggleSessionReportTarget,
} from "../viewer/legacyFieldSession.js";
import { createLegacyFieldSessionController } from "./legacyFieldSessionController.js";
import {
  archiveSiteKey,
  groupArchiveEntriesBySite,
  depthSpreadByDetection,
} from "../viewer/legacyArchiveConsistency.js";
import { buildLegacyTargetConfidenceChart, buildLegacyTargetTimeline, rankLegacyTargetsForReview } from "../viewer/legacyMergedTargetModel.js";
import { renderLegacyTargetSection, setLegacyTargetSectionAxis } from "../viewer/legacyTargetSection.js";
import {
  buildLegacyFieldModel,
  statusLabel,
  matchesLegacyListFilter,
  escapeLegacyHtml,
  normalizeLegacyResult,
  buildLegacyFieldBrief,
  buildLegacyAnalysisEvidence,
  analysisEvidenceRowsOf,
  buildLegacyAnalysisTrace,
  formatLegacyFieldBriefHtml,
  residualScaleOf,
  magneticResponseOf,
} from "../viewer/legacyDikModel.js";
import { focusStructure } from "../viewer/labels.js";
import { getDetectionNotes, openDetectionNoteModal } from "./detectionNotes.js";
import { renderLegacyWorkflowView } from "./legacyWorkflowView.js";
import { bindLegacyVisualizationToggles } from "./legacyVisualizationController.js";
import { dimensionsOf, volumeM3Of, formatVolumeM3 } from "../viewer/volume.js";
import { unifiedObjectMapVisibleOf } from "../viewer/legacyVisibilityController.js";
import { createLegacyCase } from "../viewer/legacyCaseModel.js";
import { createLegacyCaseStore } from "../viewer/legacyCaseStore.js";
import { legacyCasePackageMatches, refreshLegacyCasePackage } from "../viewer/legacyCasePackage.js";
import {
  DEFAULT_DEPTH_PARAMS,
  clampNum,
  normalizeDepthParams,
  readDepthParams,
  readAnalyzeInputs,
} from "./legacyAnalysisController.js";

let lastSahaBriefText = "";
let lastSahaBriefHtml = "";
const GUIDE_STORAGE_KEY = "votex-legacy-dik-guide-v1";
/** @type {Array<object>} */
let calibNotesCache = [];
/**
 * Saha inceleme oturumu — fingerprint anahtarıyla kalıcı.
 * Tauri settings üzerinden kaydedilir; uygulama yeniden açıldığında geri yüklenir.
 * @type {object|null}
 */
const fieldSessionController = createLegacyFieldSessionController({
  getSettings: getAppSettings,
  saveSessions: setLegacyFieldSessions,
  getState: () => state,
});
state.legacyFieldSessionController = fieldSessionController;
// DTA paneli sohbetini aynı oturuma yazsın (import döngüsünü önlemek için enjekte edilir).
import("./dtaChatPanel.js").then(({ setDtaChatSessionController }) => {
  setDtaChatSessionController(fieldSessionController);
}).catch(() => { /* panel modülü yüklenemezse sohbet yalnız bellekte kalır */ });
const legacyCaseStore = createLegacyCaseStore(state);
// Overlay, panel ve sol liste aynı seçim komutlarını kullansın.
state.legacyCaseStore = legacyCaseStore;

function syncLegacyRuntimeContext() {
  const el = $("legacy-runtime-context");
  if (!el) return;
  const session = state.legacyTargetSession || {};
  const direction = String(state.legacyStepNumberingDirection || "rtl") === "rtl" ? "Sağdan sola" : "Soldan sağa";
  const view = state.legacySceneViewMode === "plan" ? "Saha planı" : state.legacySceneViewMode === "objects" ? "Objeler" : "Birleşik 3D";
  const profile = state.legacyMergeProfile === "cautious" ? "Temkinli" : state.legacyMergeProfile === "research" ? "Araştırma" : "Normal";
  const selection = session.detectionId ? `Obje ${session.detectionId.replace(/^legacy-dik-shape-/, "#")}` : session.stepIndex ? `Adım ${session.stepIndex}` : "Seçim yok";
  const calibration = state.legacyFieldCalibrationRestored && state.legacyFieldModel?.lateralCalibration?.applied
    ? " · ✓ kalibrasyon geri yüklendi"
    : "";
  el.textContent = `v${document.documentElement.dataset.votexVersion || "—"} · ${direction} · ${view} · ${profile} · ${selection}${calibration}`;
  el.title = `UI sözleşmesi: legacy-result-v1 · seçim: ${session.kind || "none"} · görünürlük: ${session.visibility || "step"}${calibration ? " · fingerprint oturumundan lateral kalibrasyon" : ""}`;
}

const activeFieldSession = () => fieldSessionController.session;
const persistActiveFieldSession = () => fieldSessionController.persist();
const loadFieldSessionForCurrentJson = () => fieldSessionController.loadCurrent();
const sessionProgressStatusText = () => fieldSessionController.progressText();

/**
 * Öğrenilmiş eşik modelini state'e yükler (uygulama açılışı / JSON açılışı).
 * Model yoksa öğrenme katmanı etkisiz kalır — davranış varsayılan eşiklerde.
 */
async function loadLearnedThresholdsFromSettings() {
  try {
    const s = await getAppSettings();
    const learned = s?.legacyLearnedThresholds || s?.legacy_learned_thresholds || null;
    state.legacyLearnedThresholds = learned && typeof learned === "object" ? learned : null;
  } catch {
    state.legacyLearnedThresholds = null;
  }
  return state.legacyLearnedThresholds;
}

/**
 * Güncel saha oturumu kararlarından eşik modelini güncelleyip kaydeder.
 * Sadece karar sayısı değiştiğinde anlamlı değişim olur; model sınırları
 * legacyThresholdLearning tarafından korunur.
 */
async function updateLearnedThresholdsFromSession() {
  try {
    const fieldModel = state.legacyFieldModel;
    const session = activeFieldSession();
    if (!fieldModel || !session) return null;
    const samples = collectVerifiedSamples({ fieldModel, session });
    if (!samples.length) return null;
    const learned = buildLearnedThresholds(samples, state.legacyLearnedThresholds);
    state.legacyLearnedThresholds = serializeLearnedThresholds(learned);
    await setLegacyLearnedThresholds(state.legacyLearnedThresholds);
    return state.legacyLearnedThresholds;
  } catch (error) {
    console.warn("[legacy-dik] threshold learning:", error);
    return null;
  }
}

/** Arşiv açılışında saha oturumunu yeni vaka sözleşmesiyle geri yükler. */
export async function restoreLegacyFieldSession(normalized, fileName) {
  if (normalized) state.legacyDikResult = normalized;
  state.legacyDikFileName = fileName || state.legacyDikFileName || null;
  await loadLearnedThresholdsFromSettings();
  await fieldSessionController.loadCurrent();
  const restored = fieldSessionController.restoreCase(normalized, fileName);
  // DTA panel sohbetini vaka anahtarıyla geri yükle (yeni vakada sıfırlanır).
  try {
    const { restoreDtaChatLog } = await import("./dtaChatPanel.js");
    restoreDtaChatLog({
      caseKey: restored?.key || fieldSessionController.sessionKey() || "",
      session: restored,
    });
  } catch { /* panel modülü yoksa sohbet geri yükleme atlanır */ }
  return restored;
}

function lateralCalibrationSnapshot() {
  const model = state.legacyFieldModel?.lateralCalibration;
  const readings = Array.isArray(state.legacyFieldCalibrationReadings)
    ? state.legacyFieldCalibrationReadings.map(Number).filter((value) => Number.isFinite(value) && value > 0).slice(0, 3)
    : [];
  if (!model?.applied && !readings.length
    && state.legacyFieldCalibrationBeforeM == null
    && state.legacyFieldCalibrationAfterM == null
    && state.legacyFieldCalibrationObservedM == null
    && state.legacyFieldCalibrationDepthScale == null) return null;
  return {
    schemaVersion: 1,
    mode: state.legacyDepthCalibrationMode === "field-stake" ? "field-stake" : "single-object",
    referenceDepthM: 1,
    readings,
    beforeM: state.legacyFieldCalibrationBeforeM == null ? null : Number(state.legacyFieldCalibrationBeforeM),
    afterM: state.legacyFieldCalibrationAfterM == null ? null : Number(state.legacyFieldCalibrationAfterM),
    observedM: model?.observedM ?? null,
    depthScale: model?.depthScale ?? null,
    quality: model?.quality || "",
    updatedAt: new Date().toISOString().slice(0, 19),
  };
}

async function persistLateralCalibrationSnapshot() {
  const session = activeFieldSession();
  if (!session) return null;
  fieldSessionController.setLateralCalibration(lateralCalibrationSnapshot());
  return fieldSessionController.persist();
}

function readDepthParamsFromUi() {
  return readDepthParams({
    sensorHeightM: $("legacy-param-sensor-height")?.value,
    bipolarSepFactor: $("legacy-param-bipolar")?.value,
    dipoleBlend: $("legacy-param-dipole-blend")?.value,
  });
}

function writeDepthParamsToUi(params = DEFAULT_DEPTH_PARAMS) {
  const p = normalizeDepthParams(params);
  const h = $("legacy-param-sensor-height");
  const b = $("legacy-param-bipolar");
  const d = $("legacy-param-dipole-blend");
  if (h) {
    h.value = Number(p.sensorHeightM.toFixed(2)).toFixed(2);
    h.readOnly = false;
    h.min = "0";
    h.max = "0.20";
    h.step = "0.01";
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
  return readAnalyzeInputs({
    rows: $("legacy-dik-matrix-rows")?.value,
    cols: $("legacy-dik-matrix-cols")?.value,
    spacing: $("legacy-dik-step-spacing")?.value,
  });
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
  const hadSelection = selectedStepOf(state.legacyTargetSession) != null
    || selectedDetectionOf(state.legacyTargetSession) != null;
  await ensureViewer();
  try { removeLegacyDikShapes(); } catch (_) {}
  addLegacyDikShapesToScene(normalized);
  if (!hadSelection && resultSteps.length) {
    setLegacySelectedStep(Number(resultSteps[0].index) || 1);
  }
  renderLegacyDikPanel(normalized, { fileName });
  refreshLegacyLateralEvidenceLayer();
  syncFieldStakeCalibrationUi();
  return normalized;
}

export function updateLegacySahaBrief(detectionId = selectedDetectionOf(state.legacyTargetSession)) {
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

/**
 * Legacy3DMAG vaka özetini DTA/Gemini bağlamına kopyalar.
 * Ölçüm ve karar verilerini okur; hiçbir hesabı değiştirmez.
 */
async function copyLegacyDtaCaseBrief() {
  const casePackage = state.legacyCasePackage;
  const fieldModel = casePackage?.derived?.fieldModel;
  if (!casePackage || !fieldModel || (!fieldModel.detections?.length && !fieldModel.steps?.length)) {
    setStatus("DTA özeti için önce Legacy JSON analiz edin");
    return;
  }
  const brief = buildLegacyDtaCaseBrief({
    casePackage,
    scan: {
      matrixRows: Number(state.legacyDikResult?.matrixRows) || 0,
      matrixCols: Number(state.legacyDikResult?.matrixCols) || 0,
    },
    depthParams: readDepthParamsFromUi(),
    mergeProfile: state.legacyMergeProfile || "normal",
  });
  if (!brief) {
    setStatus("DTA özeti üretilemedi — vaka verisi eksik");
    return;
  }
  let text = formatLegacyDtaCaseBriefText(brief);
  let similarCount = 0;
  const includeSimilar = $("legacy-dta-similar-cases")?.checked === true;
  if (includeSimilar) {
    try {
      setStatus("Arşivde doğrulanmış benzer vakalar aranıyor…");
      const [entries, settings] = await Promise.all([listArchive(), getAppSettings()]);
      const sessions = settings?.legacyFieldSessions || settings?.legacy_field_sessions || {};
      const currentDetectionId = selectedDetectionOf(state.legacyTargetSession);
      const currentDetection = fieldModel.detections.find((item) => String(item.detectionId) === String(currentDetectionId))
        || fieldModel.detections[0];
      const history = [];
      const legacyEntries = (entries || [])
        .filter((entry) => (entry.sourceKind || entry.source_kind) === "legacy_dik_json")
        .slice(0, 100);
      for (const entry of legacyEntries) {
        try {
          const loaded = await loadLegacyArchive(entry.id);
          const normalized = normalizeLegacyResult(loaded.result, state.legacyMatrixHint || null);
          const fingerprint = String(normalized.fingerprint || "");
          const fileName = String(loaded.meta?.fileName || loaded.meta?.file_name || entry.fileName || "");
          const sessionKey = [fingerprint, fileName, String(entry.id)].find((key) => key && sessions[key]);
          const session = sessionKey ? sessions[sessionKey] : null;
          const checks = session?.targetChecks || session?.observations || {};
          const model = buildLegacyFieldModel(normalized, {
            mergeProfile: session?.mergePolicy || "normal",
            splitDetectionIds: session?.splitDetectionIds || [],
            depthParams: session?.depthParams || null,
            scan: { matrixRows: Number(normalized.matrixRows) || 0, matrixCols: Number(normalized.matrixCols) || 0 },
          });
          for (const detection of model.detections || []) {
            const check = checks[String(detection.detectionId)] || {};
            const decision = String(check.status || "").toLowerCase();
            if (decision === "confirmed" || decision === "rejected") {
              history.push({ caseKey: String(entry.id), fingerprint, decision, detection });
            }
          }
        } catch { /* bozuk/erişilemeyen arşiv kaydı diğer vakaları engellemez */ }
      }
      const references = findSimilarReviewedCases({ fingerprint: brief.source.fingerprint, detection: currentDetection }, history);
      similarCount = references.length;
      text += formatSimilarReviewedCases(references);
      setStatus(references.length
        ? `${references.length} benzer, karar kayıtlı arşiv vakası özete eklendi`
        : "Yeterince yakın, karar kayıtlı arşiv vakası bulunamadı; temel özet hazırlanıyor");
    } catch (error) {
      logLine(`Benzer arşiv vakaları eklenemedi (${error})`, "info");
      setStatus("Arşiv karşılaştırması yapılamadı; temel DTA özeti kopyalanıyor");
    }
  }
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setStatus(similarCount
        ? `DTA özeti ve ${similarCount} benzer arşiv vakası panoya kopyalandı — DTA'ya yapıştırın`
        : "DTA/Gemini vaka özeti panoya kopyalandı — DTA'ya yapıştırın");
      return;
    }
  } catch {
    /* fallback below */
  }
  setStatus("DTA özeti üretildi ama panoya kopyalanamadı");
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

function syncUndergroundButtonUi(available = isLegacyUnifiedObjectMapAvailable()) {
  const buttons = [$("btn-legacy-underground-top"), $("btn-legacy-underground")].filter(Boolean);
  const on = unifiedObjectMapVisibleOf(state);
  buttons.forEach((button) => {
    button.disabled = !available;
    button.textContent = on ? "⬡ Birleşik objeler: Açık" : "⬡ Birleşik objeler";
    button.classList.toggle("accent", on);
    button.setAttribute("aria-pressed", String(on));
  });
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
  const sensorHeightM = clampNum(note.sensorHeightM ?? note.sensor_height_m, 0, 0.2, DEFAULT_DEPTH_PARAMS.sensorHeightM);
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

function applyLegacyMergeProfile(profile = "normal") {
  const allowed = ["cautious", "normal", "research"];
  state.legacyMergeProfile = allowed.includes(profile) ? profile : "normal";
  const select = $("legacy-merge-profile");
  if (select) select.value = state.legacyMergeProfile;
  if (state.legacyDikResult) {
    renderLegacyDikPanel(state.legacyDikResult, { fileName: state.legacyDikFileName });
    const policy = state.legacyFieldModel?.mergePresentation?.policy || null;
    fieldSessionController.setMergeReview({
      splitDetectionIds: state.legacyMergedSplitDetectionIds,
      mergePolicy: policy,
    });
    void fieldSessionController.persist();
  }
  const labels = { cautious: "Temkinli", normal: "Normal", research: "Araştırma" };
  setStatus(`Birleşme profili: ${labels[state.legacyMergeProfile]} · mevcut hedefler yeniden hesaplandı`);
}

function syncLegacyMergeProfileUi() {
  const select = $("legacy-merge-profile");
  if (select) select.value = ["cautious", "normal", "research"].includes(state.legacyMergeProfile)
    ? state.legacyMergeProfile
    : "normal";
}

function applyLegacyDepthProfile(profile = "normal") {
  const profiles = {
    normal: { sensorHeightM: 0.1, bipolarSepFactor: 1.85, dipoleBlend: 0.3 },
    deep: { sensorHeightM: 0.1, bipolarSepFactor: 2.1, dipoleBlend: 0.22 },
    stake: { sensorHeightM: 0.1, bipolarSepFactor: 1.85, dipoleBlend: 0.3 },
  };
  const next = profiles[profile] || profiles.normal;
  state.legacyDepthProfile = profiles[profile] ? profile : "normal";
  writeDepthParamsToUi(next);
  const select = $("legacy-depth-profile");
  if (select) select.value = state.legacyDepthProfile;
  if (state.legacyDepthProfile === "stake") {
    const mode = $("legacy-calibration-mode");
    if (mode) {
      mode.value = "field-stake";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  setStatus(`Profil seçildi: ${state.legacyDepthProfile === "deep" ? "Derin hedef" : state.legacyDepthProfile === "stake" ? "Saha kazığı" : "Normal"} · Uygula ile kaydedin`);
}

function syncLegacyUserModeUi() {
  const box = $("legacy-dik-box");
  const select = $("legacy-user-mode");
  const label = $("legacy-user-mode-label");
  const mode = state.legacyUserMode === "expert" ? "expert" : "simple";
  state.legacyUserMode = mode;
  if (box) box.classList.toggle("is-simple", mode === "simple");
  if (select) select.value = mode;
  if (label) label.textContent = mode === "expert" ? "Uzman ayarları" : "Basit kullanım";
}

function syncLegacyTargetModeUi() {
  syncLegacyTargetModeView({ get: (id) => $(id), state, createSession: createLegacyTargetSession });
}

function targetDetectionList() {
  return Array.isArray(state.legacyFieldModel?.detections) ? state.legacyFieldModel.detections : [];
}

function selectedTargetId() {
  return selectedDetectionOf(state.legacyTargetSession);
}

function legacyWorkflowState() {
  const id = selectedTargetId();
  const notes = id ? getDetectionNotes(id) : { notes: "", photos: [] };
  const hasNotes = !!String(notes.notes || "").trim() || (Array.isArray(notes.photos) && notes.photos.length > 0);
  // Faz eşlemesi saf controller'da; panel yalnız mevcut UI state'ini sağlar.
  const hasFocus = id != null && state.legacyTargetSession?.workflowPhase === WORKFLOW_PHASES.focus;
  return deriveLegacyWorkflow({
    hasJson: !!state.legacyDikResult,
    hasStep: selectedStepOf(state.legacyTargetSession) != null,
    hasTarget: !!id,
    hasFocus,
    hasNotes: hasNotes || isTargetInReport(id),
  }).steps;
}

function renderLegacyWorkflow() {
  renderLegacyWorkflowView({
    root: $("legacy-field-workflow"),
    enabled: state.legacyFieldWorkflowEnabled,
    steps: legacyWorkflowState(),
    onNext: advanceLegacyWorkflow,
  });
}

function advanceLegacyWorkflow() {
  const next = legacyWorkflowState().find((step) => !step.done);
  if (!next) return;
  if (next.key === "json") $("btn-legacy-dik-pick")?.click();
  else if (next.key === "step") {
    const first = state.legacyFieldModel?.steps?.[0]?.stepIndex;
    if (first != null) focusLegacyStep(first);
  } else if (next.key === "target") {
    const first = targetDetectionList()[0]?.detectionId;
    if (first) focusLegacyDetection(first);
  } else if (next.key === "focus") {
    const id = selectedTargetId();
    if (id) focusLegacyDetection(id);
  } else if (next.key === "notes") {
    const id = selectedTargetId();
    if (id) openDetectionNoteModal(id);
  }
  renderLegacyWorkflow();
}

function isTargetInReport(id) {
  const key = String(id || "");
  if (!key) return false;
  if (state.legacyReportTargetIds.map(String).includes(key)) return true;
  // Oturumdan geri yüklenen rapor seçimi de sayılır.
  const session = activeFieldSession();
  return session ? isTargetInSessionReport(session, key) : false;
}

function selectedTargetsReportHtml() {
  const selectedIds = new Set(state.legacyReportTargetIds.map(String));
  const merged = state.legacyFieldModel?.mergedTargets || [];
  const consumed = new Set();
  const mergedHtml = merged.map((target) => {
    const ids = target.detectionIds.filter((id) => selectedIds.has(String(id)));
    if (!ids.length) return "";
    ids.forEach((id) => consumed.add(String(id)));
    return `<div style="border-top:1px solid #ccd;padding:8px 0;"><b>${escapeLegacyHtml(target.targetId.replace("legacy-target-", "Hedef "))} · ${escapeLegacyHtml(target.type)}</b><p>Birleşik derinlik: ${Number(target.depthTopM).toFixed(2)}–${Number(target.depthBottomM).toFixed(2)} m · güven: %${Math.round(Number(target.confidence || 0) * 100)}</p><p>${target.detectionIds.length} kanıt · adımlar: ${escapeLegacyHtml(target.stepIndices.join(", "))}</p></div>`;
  }).join("");
  const individualHtml = targetDetectionList()
    .filter((item) => selectedIds.has(String(item.detectionId)) && !consumed.has(String(item.detectionId)))
    .map((item) => {
      const notes = getDetectionNotes(item.detectionId);
      const depth = `${Number(item.depthTopM || 0).toFixed(2)}–${Number(item.depthBottomM || item.depthTopM || 0).toFixed(2)} m`;
      const note = notes.notes ? `<p><b>Saha notu:</b> ${escapeLegacyHtml(notes.notes)}</p>` : "";
      const photos = Array.isArray(notes.photos) && notes.photos.length ? `<p>${notes.photos.length} saha fotoğrafı kaydedildi.</p>` : "";
      return `<div style="border-top:1px solid #ccd;padding:8px 0;"><b>${escapeLegacyHtml(item.type || "Anomali")} · Adım ${escapeLegacyHtml(item.stepIndex ?? "—")}</b><p>Derinlik: ${depth} · Güven: %${Math.round(Number(item.confidence || 0) * 100)}</p>${note}${photos}</div>`;
    }).join("");
  return mergedHtml + individualHtml;
}

function toggleTargetReport(id) {
  const key = String(id || "");
  if (!key) return false;
  const added = legacyCaseStore.toggleReport(key);
  updateLegacyTargetCard(key);
  setStatus(added ? "Hedef saha raporuna eklendi" : "Hedef rapordan çıkarıldı");
  return added;
}

function toggleMergedTargetReport(targetId) {
  const target = state.legacyFieldModel?.mergedTargets?.find((item) => item.targetId === targetId);
  if (!target) return;
  const selected = new Set(state.legacyReportTargetIds.map(String));
  const add = target.detectionIds.some((id) => !selected.has(String(id)));
  target.detectionIds.forEach((id) => {
    const inReport = selected.has(String(id));
    if (add && !inReport) legacyCaseStore.toggleReport(id);
    if (!add && inReport) legacyCaseStore.toggleReport(id);
  });
  renderLegacyDikPanel(state.legacyDikResult, { fileName: state.legacyDikFileName });
  setStatus(add ? "Birleşik hedef rapora eklendi" : "Birleşik hedef rapordan çıkarıldı");
}

function splitMergedTarget(targetId) {
  const target = state.legacyFieldModel?.mergedTargets?.find((item) => item.targetId === targetId);
  if (!target || target.detectionIds.length < 2) return;
  state.legacyMergedSplitDetectionIds = [...new Set([
    ...state.legacyMergedSplitDetectionIds,
    ...target.detectionIds,
  ])];
  fieldSessionController.setMergeReview({
    splitDetectionIds: state.legacyMergedSplitDetectionIds,
    mergePolicy: state.legacyFieldModel?.mergePresentation?.policy || null,
  });
  void fieldSessionController.persist();
  renderLegacyDikPanel(state.legacyDikResult, { fileName: state.legacyDikFileName });
  setStatus("Hedef ayrıldı · ham bulgular ayrı gösteriliyor");
}

function closeLegacySignalAnalysisWindow() {
  document.querySelector("[data-legacy-signal-analysis]")?.remove();
}

function legacyPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function openLegacySignalAnalysisWindow(detection) {
  closeLegacySignalAnalysisWindow();
  if (!detection) return;
  const repeat = state.legacyArchiveDepthSpread?.get?.(detection.detectionId);
  const analysis = buildLegacyAnalysisEvidence(detection, {
    repeatability: repeat,
    mergeProfile: state.legacyMergeProfile || "normal",
  });
  const signal = analysis?.metrics?.signalStrength?.value;
  const confidence = analysis?.metrics?.anomalyConfidence?.value;
  const compactness = analysis?.metrics?.compactness?.value;
  const repeatability = analysis?.metrics?.repeatability?.value;
  const strength = analysis?.inputs?.strengthSigma;
  const halo = compactness == null ? "Hesaplanmadı" : `${100 - compactness}% yayılım proxy`;
  const topM = Number(detection.depthTopM);
  const bottomM = Number(detection.depthBottomM ?? detection.depthTopM);
  const raw = detection.raw || {};
  const widthM = Number(detection.dimensions?.width ?? detection.widthM ?? (Number(raw.rx) || 0) * 2);
  const lengthM = Number(detection.dimensions?.length ?? detection.lengthM ?? (Number(raw.ry) || 0) * 2);
  const fmt = (value, suffix = "") => Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : "—";
  const repeatBasis = analysis?.metrics?.repeatability?.value != null
    ? `${analysis.inputs.repeatedScans} çekim · derinlik yayılımı ${fmt(analysis.inputs.depthSpreadM, " m")}`
    : "Aynı hedef için yeterli tekrar çekimi yok";
  const evidenceRows = analysisEvidenceRowsOf(analysis).map((row) => `<div style="display:grid;grid-template-columns:1.15fr .7fr 1.35fr;gap:.35rem;align-items:baseline;padding:.18rem 0;border-top:1px solid rgba(255,255,255,.06);"><span style="color:var(--text);">${escapeLegacyHtml(row.label)}</span><b style="color:var(--text);">${escapeLegacyHtml(row.value)}</b><span>${escapeLegacyHtml(row.source)}: ${escapeLegacyHtml(row.raw)}${row.reason ? ` · ${escapeLegacyHtml(row.reason)}` : ""}</span></div>`).join("");
  const overlay = document.createElement("div");
  overlay.dataset.legacySignalAnalysis = "1";
  // Modal değil: sahnenin ve sol/sağ panellerin tıklanmasını engellemeden sağda yüzer.
  overlay.style.cssText = "position:fixed;top:5.2rem;right:1rem;z-index:1200;background:transparent;display:block;padding:0;pointer-events:none;";
  overlay.innerHTML = `<section role="dialog" aria-modal="false" aria-labelledby="legacy-signal-title" style="pointer-events:auto;width:min(28rem,calc(100vw - 2rem));max-height:calc(100vh - 6.5rem);overflow:auto;background:var(--bg2);border:1px solid var(--glass-edge);border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,.42);padding:1rem;color:var(--text);">
    <header style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;border-bottom:1px solid var(--line);padding-bottom:.65rem;margin-bottom:.8rem;">
      <div><div style="font-size:.68rem;color:var(--muted);letter-spacing:.08em;">ANOMALİ ANALİZİ</div><h3 id="legacy-signal-title" style="margin:.2rem 0 0;font-size:1rem;">${escapeLegacyHtml(detection.type || "Metal anomalisi")} · Adım ${escapeLegacyHtml(detection.stepIndex ?? "—")}</h3></div>
      <button type="button" class="mil" data-legacy-signal-close aria-label="Pencereyi kapat">✕</button>
    </header>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem;">
      <div class="legacy-target-metric"><b>${signal == null ? "—" : `%${signal}`}</b><span>sinyal gücü</span></div>
      <div class="legacy-target-metric"><b>${confidence == null ? "—" : `%${confidence}`}</b><span>anomali güveni</span></div>
      <div class="legacy-target-metric"><b>${compactness == null ? "—" : `%${compactness}`}</b><span>kompaktlık proxy</span></div>
      <div class="legacy-target-metric"><b>${repeatability == null ? "—" : `%${repeatability}`}</b><span>tekrar edilebilirlik</span></div>
    </div>
    <div style="margin-top:.8rem;padding:.65rem;border:1px solid var(--line);border-radius:6px;font-size:.75rem;line-height:1.5;color:var(--muted);">
      <b style="color:var(--text);">Analiz dayanakları</b>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.25rem .7rem;margin-top:.35rem;">
        <span>Adım: <b style="color:var(--text);">${escapeLegacyHtml(analysis?.inputs?.stepIndex ?? "—")}</b></span>
        <span>Derinlik: <b style="color:var(--text);">${fmt(analysis?.inputs?.depthTopM, " m")}–${fmt(analysis?.inputs?.depthBottomM, " m")}</b></span>
        <span>Merkez: <b style="color:var(--text);">${fmt(analysis?.inputs?.stationM, " m")} / ${fmt(analysis?.inputs?.offsetM, " m")}</b></span>
        <span>Boyut proxy: <b style="color:var(--text);">${fmt(analysis?.inputs?.widthM, " m")} × ${fmt(analysis?.inputs?.lengthM, " m")}</b></span>
        <span>Sinyal: <b style="color:var(--text);">${fmt(analysis?.inputs?.strengthSigma, "σ")}</b></span>
        <span>Profil: <b style="color:var(--text);">${escapeLegacyHtml(analysis?.inputs?.mergeProfile || "normal")}</b></span>
      </div>
      <div style="margin-top:.45rem;"><b style="color:var(--text);">Tekrarlı ölçüm:</b> ${escapeLegacyHtml(repeatBasis)}</div>
      <div style="margin-top:.65rem;"><b style="color:var(--text);">Yüzde kaynakları</b><div style="margin-top:.25rem;font-size:.68rem;">${evidenceRows}</div></div>
      <div><b style="color:var(--text);">Yayılım:</b> ${escapeLegacyHtml(halo)}</div>
      <div style="margin-top:.45rem;"><b style="color:var(--text);">Yorum:</b> ${analysis?.interpretation === "strong-repeatable-candidate" ? "Güçlü ve incelenmeye değer sinyal." : analysis?.interpretation === "investigate-anomaly" ? "Orta seviyede metal/anomali sinyali." : "Zayıf veya belirsiz sinyal."}</div>
      <span>${escapeLegacyHtml(analysis?.disclaimer || "Bu analiz ölçümden türetilen tahminlerdir.")}</span>
    </div>
  </section>`;
  document.body.appendChild(overlay);
  overlay.querySelector("[data-legacy-signal-close]")?.addEventListener("click", closeLegacySignalAnalysisWindow);
  // Dış alan şeffaf ve pointer-events:none olduğu için ana ekran kilitlenmez.
  // Pencere yalnızca kapatma düğmesiyle kapanır.
}

function updateLegacyTargetCard(detectionId = selectedDetectionOf(state.legacyTargetSession)) {
  renderLegacyWorkflow();
  const mergedTarget = state.legacySelectedMergedTargetId
    ? state.legacyFieldModel?.mergedTargets?.find((item) => item.targetId === state.legacySelectedMergedTargetId)
    : null;
  if (mergedTarget && renderMergedTargetWorkspace(mergedTarget)) {
    closeLegacySignalAnalysisWindow();
    return;
  }
  const card = $("legacy-target-card");
  if (!card) return;
  const id = detectionId ? String(detectionId) : null;
  const detection = id ? targetDetectionList().find((item) => String(item.detectionId) === id) : null;
  const selectedStepIndex = selectedStepOf(state.legacyTargetSession);
  const selectedStep = selectedStepIndex == null
    ? null
    : state.legacyFieldModel?.steps?.find((item) => Number(item.stepIndex) === selectedStepIndex);
  // Hedef incelendi: oturuma kaydet (fingerprint anahtarıyla kalıcı).
  const currentSession = activeFieldSession();
  if (id && detection && currentSession) {
    legacyCaseStore.markReviewed(id, {
      stepIndex: detection.stepIndex ?? selectedStepIndex,
      status: state.legacyCase?.observations?.[id]?.status || "reviewed",
    });
  }
  if (!detection && !selectedStep) {
    renderLegacyTargetSection($("legacy-target-section-content"), state.legacyDikResult, null);
    closeLegacySignalAnalysisWindow();
    card.hidden = !state.legacyTargetMode;
    $("legacy-target-status")?.replaceChildren(document.createTextNode("Hedef seçilmedi"));
    $("legacy-target-title")?.replaceChildren(document.createTextNode("Adım veya obje seçin"));
    const metrics = $("legacy-target-metrics");
    if (metrics) metrics.innerHTML = "";
    const confidence = $("legacy-target-confidence");
    if (confidence) confidence.innerHTML = "";
    const notes = $("legacy-target-notes");
    if (notes) { notes.hidden = true; notes.textContent = ""; }
    ["btn-legacy-target-notes", "btn-legacy-target-report", "btn-legacy-target-prev", "btn-legacy-target-focus", "btn-legacy-target-next", "btn-legacy-target-only", "btn-legacy-target-calibrate", "btn-legacy-target-confirm", "btn-legacy-target-reject"].forEach((id) => { const button = $(id); if (button) button.disabled = true; });
    return;
  }
  if (!detection && selectedStep) {
    renderLegacyTargetSection($("legacy-target-section-content"), state.legacyDikResult, null);
    closeLegacySignalAnalysisWindow();
    card.hidden = false;
    $("legacy-target-status")?.replaceChildren(document.createTextNode("ADIM SEÇİLDİ"));
    $("legacy-target-title")?.replaceChildren(document.createTextNode(`Adım ${selectedStep.stepIndex} · ${selectedStep.anomalyCount || 0} obje`));
    const metrics = $("legacy-target-metrics");
    if (metrics) metrics.innerHTML = `<div class="legacy-target-metric"><b>${Number(selectedStep.stationM || 0).toFixed(2)} m</b><span>hat konumu</span></div><div class="legacy-target-metric"><b>${Number(selectedStep.startM || 0).toFixed(2)}–${Number(selectedStep.endM || 0).toFixed(2)} m</b><span>adım aralığı</span></div><div class="legacy-target-metric"><b>${selectedStep.anomalyCount || 0}</b><span>tespit sayısı</span></div>`;
    const confidence = $("legacy-target-confidence");
    if (confidence) confidence.innerHTML = "Adım seçildi; ayrıntılı güven için bir obje seçin.";
    const notes = $("legacy-target-notes");
    if (notes) { notes.hidden = true; notes.textContent = ""; }
    const focus = $("btn-legacy-target-focus");
    if (focus) focus.disabled = false;
    ["btn-legacy-target-notes", "btn-legacy-target-report", "btn-legacy-target-prev", "btn-legacy-target-next", "btn-legacy-target-only", "btn-legacy-target-calibrate", "btn-legacy-target-confirm", "btn-legacy-target-reject"].forEach((buttonId) => { const button = $(buttonId); if (button) button.disabled = true; });
    return;
  }
  card.hidden = false;
  renderLegacyTargetSection($("legacy-target-section-content"), state.legacyDikResult, detection);
  openLegacySignalAnalysisWindow(detection);
  const index = targetDetectionList().findIndex((item) => String(item.detectionId) === id);
  const depthTop = Number(detection.depthTopM) || 0;
  const depthBottom = Number(detection.depthBottomM) || depthTop;
  const mid = (depthTop + depthBottom) * 0.5;
  const confidence = Math.round((Number(detection.confidence) || 0) * 100);
  const strength = Number(detection.strength ?? detection.peakSigma) || 0;
  const title = `${detection.type || "Anomali"} · Adım ${detection.stepIndex ?? "—"}`;
  $("legacy-target-status")?.replaceChildren(document.createTextNode(`${index + 1}/${targetDetectionList().length} · ${statusLabel(detection.status)}`));
  $("legacy-target-title")?.replaceChildren(document.createTextNode(title));
  const metrics = $("legacy-target-metrics");
  if (metrics) {
    const stake = state.legacyDepthCalibrationMode === "field-stake" && state.legacyFieldCalibrationBeforeM != null
      ? `<div class="legacy-target-metric"><b>${Number(state.legacyFieldCalibrationBeforeM).toFixed(2)} → ${state.legacyFieldCalibrationAfterM == null ? "—" : Number(state.legacyFieldCalibrationAfterM).toFixed(2)} m</b><span>kalibrasyon önce → sonra</span></div>`
      : `<div class="legacy-target-metric"><b>${Number(readDepthParamsFromUi().bipolarSepFactor).toFixed(2)}</b><span>bipolar çarpan</span></div>`;
    metrics.innerHTML = `<div class="legacy-target-metric"><b>${depthTop.toFixed(2)}–${depthBottom.toFixed(2)} m</b><span>derinlik aralığı</span></div><div class="legacy-target-metric"><b>${mid.toFixed(2)} m</b><span>proxy orta</span></div><div class="legacy-target-metric"><b>%${confidence} · ${strength.toFixed(1)}σ</b><span>güven · güç</span></div>${stake}`;
  }
  const uncertainty = Number(detection.depthUncertaintyM ?? detection.depthFitError);
  const shapeError = Number(detection.shapeFitError);
  const confidenceHost = $("legacy-target-confidence");
  if (confidenceHost) {
    const reasons = [];
    if (strength >= 2.5) reasons.push("güçlü sinyal");
    if (confidence >= 70) reasons.push("yüksek güven");
    if (Number.isFinite(shapeError) && shapeError > 0.45) reasons.push("kontur belirsiz");
    if (Number.isFinite(uncertainty) && uncertainty > 0.6) reasons.push("derinlik aralığı geniş");
    confidenceHost.innerHTML = `<b>Güven nedeni:</b> ${reasons.length ? reasons.join(" · ") : "tek proxy ölçümü; saha doğrulaması önerilir"}${Number.isFinite(uncertainty) && uncertainty > 0 ? ` · belirsizlik yaklaşık ±${uncertainty.toFixed(2)} m` : ""}`;
  }
  const noteData = getDetectionNotes(id);
  const notesHost = $("legacy-target-notes");
  if (notesHost) {
    const noteText = String(noteData.notes || "").trim();
    const photoCount = Array.isArray(noteData.photos) ? noteData.photos.length : 0;
    const session = activeFieldSession();
    const sessionBadge = session && isTargetReviewed(session, id)
      ? (sessionProgressStatusText() ? " · ✓ önceki oturumda incelendi" : " · ✓ incelendi")
      : "";
    notesHost.hidden = !noteText && photoCount === 0 && !sessionBadge;
    notesHost.textContent = notesHost.hidden ? "" : `📝 ${noteText ? noteText.slice(0, 120) : "Not yok"}${noteText.length > 120 ? "…" : ""}${photoCount ? ` · 📷 ${photoCount} fotoğraf` : ""}${sessionBadge}`;
  }
  const notesButton = $("btn-legacy-target-notes");
  if (notesButton) notesButton.disabled = false;
  const reportButton = $("btn-legacy-target-report");
  if (reportButton) {
    reportButton.disabled = false;
    const inReport = isTargetInReport(id)
      || (session && isTargetInSessionReport(session, id));
    reportButton.classList.toggle("is-added", inReport);
    reportButton.textContent = inReport ? "✓ Rapordan çıkar" : "📋 Rapora ekle";
  }
  ["btn-legacy-target-prev", "btn-legacy-target-focus", "btn-legacy-target-next", "btn-legacy-target-only", "btn-legacy-target-calibrate"].forEach((buttonId) => { const button = $(buttonId); if (button) button.disabled = false; });
  const prev = $("btn-legacy-target-prev");
  const next = $("btn-legacy-target-next");
  if (prev) prev.disabled = index <= 0;
  if (next) next.disabled = index < 0 || index >= targetDetectionList().length - 1;
  syncVerifyButtons(id);
}

/** Doğrulama butonlarının durumunu ve öğrenme özetini senkronlar. */
function syncVerifyButtons(id) {
  const confirmBtn = $("btn-legacy-target-confirm");
  const rejectBtn = $("btn-legacy-target-reject");
  const learnEl = $("legacy-learn-summary");
  const session = activeFieldSession();
  const status = session?.targetChecks?.[String(id || "")]?.status || "";
  if (confirmBtn) {
    confirmBtn.disabled = !id;
    confirmBtn.classList.toggle("is-active", status === "confirmed");
  }
  if (rejectBtn) {
    rejectBtn.disabled = !id;
    rejectBtn.classList.toggle("is-active", status === "rejected");
  }
  if (learnEl) {
    const learned = state.legacyLearnedThresholds;
    learnEl.textContent = learned && Number(learned.decisionSampleCount) > 0
      ? `🎯 ${learned.decisionSampleCount} karar öğrendim · eşik %${Math.round(Number(learned.confidenceStrong) * 100)}`
      : "🎯 öğrenme: doğrulama bekleniyor";
  }
}

async function setTargetCheckStatusFromUi(status) {
  const id = selectedTargetId();
  if (!id) return;
  legacyCaseStore.setCheckStatus(id, status);
  refreshLegacyUnifiedObjectMapStyles(state);
  syncVerifyButtons(id);
  import("../viewer/viewEnhancements.js").then(({ refreshSelectedGuides }) => {
    refreshSelectedGuides();
  }).catch(() => {});
  const labels = { confirmed: "Sahada doğrulandı", rejected: "Sahada reddedildi" };
  setStatus(`${labels[status] || status} · hedef kararları eşik öğrenmesine eklendi`);
  const learned = await updateLearnedThresholdsFromSession();
  if (learned) {
    // Yeni eşiklerle mevcut modeli tazele (durum etiketleri yeniden hesaplanır).
    renderLegacyDikPanel(state.legacyDikResult, { fileName: state.legacyDikFileName });
    setStatus(`${labels[status] || status} · öğrenilmiş eşik güncellendi (güven ≥ %${Math.round(Number(learned.confidenceStrong) * 100)})`);
  }
}

function selectTargetByOffset(offset) {
  const controller = createLegacySelectionController({
    getSession: () => state.legacyTargetSession,
    setSession: (next) => { state.legacyTargetSession = next; },
  });
  const nextSession = controller.move(targetDetectionList(), offset, {
    view: state.legacyTargetMode ? "target" : "scene",
  });
  if (!nextSession.detectionId) return;
  focusLegacyDetection(nextSession.detectionId);
  updateLegacyTargetCard(nextSession.detectionId);
}

function calibrateSelectedTarget() {
  const detection = targetDetectionList().find((item) => String(item.detectionId) === String(selectedDetectionOf(state.legacyTargetSession)));
  if (!detection) return;
  const fold = $("legacy-depth-params-fold");
  if (fold) fold.open = true;
  const mode = $("legacy-calibration-mode");
  if (mode) { mode.value = "single-object"; mode.dispatchEvent(new Event("change", { bubbles: true })); }
  const label = $("legacy-param-label-depth");
  const depth = (Number(detection.depthTopM) + Number(detection.depthBottomM || detection.depthTopM)) * 0.5;
  if (label && Number.isFinite(depth) && depth > 0) label.value = depth.toFixed(1);
  setStatus(`Adım ${detection.stepIndex ?? "—"} hedefi kalibrasyona alındı · bilinen derinliği girin`);
  fold?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function syncSceneViewUi() {
  syncSelectView({ get: (id) => $(id), id: "legacy-scene-view", value: getLegacySceneViewMode(), disabled: !state.legacyDikResult });
}

function syncStepNumberingUi() {
  syncSelectView({ get: (id) => $(id), id: "legacy-step-numbering", value: getLegacyStepNumberingDirection(), disabled: !state.legacyDikResult });
}
function syncLabelModeUi() {
  syncSelectView({ get: (id) => $(id), id: "legacy-label-mode", value: getLegacyLabelMode(), disabled: !state.legacyDikResult });
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
  const count = Array.isArray(state.legacyDikResult?.scanSteps)
    ? state.legacyDikResult.scanSteps.length
    : Number(state.legacyFieldModel?.steps?.length) || 0;
  syncStepNumberInputView({
    get: (id) => $(id),
    state,
    selectedStep: selectedStepOf(state.legacyTargetSession),
    count,
  });
}

function maybeFocusTomography(detection) {
  if (!state.legacyTomographyVisible || !detection) return;
  focusTomographyOnDetection(detection);
  syncTomographyControlsUi();
}

function applyListFilter(list, filter) {
  applyLegacyListFilterView(list, filter, matchesLegacyListFilter);
}

function syncLegacyMapViewUi() {
  const select = $("legacy-map-view");
  if (!select) return;
  const mode = ["full", "merged", "both"].includes(state.legacyMapViewMode)
    ? state.legacyMapViewMode
    : "full";
  state.legacyMapViewMode = mode;
  select.value = mode;
}

function lateralRelationBadgeHtml(detectionId) {
  const relations = Array.isArray(state.legacyFieldModel?.evidenceRelations)
    ? state.legacyFieldModel.evidenceRelations.filter((item) => item.fromDetectionId === detectionId || item.toDetectionId === detectionId)
    : [];
  if (!relations.length) return "";
  const best = relations[0];
  const calibration = best.calibration?.applied ? ` · saha kalibrasyonu ${best.calibration.quality}` : "";
  const delta = Number(best.calibrationScoreDeltaPct) || 0;
  const deltaText = delta ? ` · kalibrasyon ${delta > 0 ? "+" : ""}${delta} puan` : "";
  return `<div class="legacy-lateral-relation-badge" title="${escapeLegacyHtml(best.reasons.join(" · "))}">↔ ${relations.length} lateral yanıt adayı · en yüksek %${best.scorePct}${calibration}${deltaText}</div>`;
}

function mergedTargetRows(targets = []) {
  return rankLegacyTargetsForReview(targets).map((target, index) => {
    const confidence = Math.round((Number(target.confidence) || 0) * 100);
    const steps = target.stepIndices.length ? target.stepIndices.join(", ") : "—";
    const consistency = target.consistency?.level === "tight"
      ? "tutarlı"
      : target.consistency?.level === "medium" ? "orta" : "dağınık";
    const connectorText = target.connectors?.length
      ? `${target.connectors.length} yatay bağlantı`
      : "bağlantı yok";
    const reviewHint = target.detectionIds.length > 1 && target.consistency?.level === "tight"
      ? "Birden fazla adımda tutarlı ölçüm"
      : target.detectionIds.length > 1
        ? "Birden fazla ölçüm · konum tutarlılığını kontrol edin"
        : "Tek ölçüm · çapraz taramayla doğrulayın";
    return `<div class="legacy-merged-target-card${index === 0 ? " is-review-first" : ""}${state.legacySelectedMergedTargetId === target.targetId ? " is-selected" : ""}" data-legacy-merged-target="${escapeLegacyHtml(target.targetId)}" tabindex="0" role="button">
      <div class="legacy-candidate-title"><span class="legacy-candidate-rank">${index === 0 ? "ÖNCE İNCELE" : `ADAY ${index + 1}`}</span><b>${escapeLegacyHtml(target.targetId.replace("legacy-target-", "Hedef "))}</b> · ${escapeLegacyHtml(target.type)}</div>
      <div class="legacy-candidate-hint">${reviewHint}</div>
      <div class="legacy-merged-target-meta">Derinlik ${Number(target.depthTopM).toFixed(2)}–${Number(target.depthBottomM).toFixed(2)} m · güven %${confidence}</div>
      <div class="legacy-merged-target-meta">${target.detectionIds.length} kanıt · adımlar: ${escapeLegacyHtml(steps)} · tutarlılık: ${consistency}</div>
      <div class="legacy-merged-target-meta legacy-merged-target-connection">↔ ${escapeLegacyHtml(connectorText)}</div>
      <div class="legacy-merged-target-meta">${target.detectionIds.length > 1 ? "Birleşik hedef" : "Tek kanıt"} · lateral yanıtlar kesin birleşme değildir</div>
      <button type="button" class="mil" data-legacy-merged-expand="${escapeLegacyHtml(target.targetId)}">İncelemeyi aç</button>
      <button type="button" class="mil" data-legacy-merged-report="${escapeLegacyHtml(target.targetId)}">Rapora ekle</button>
      ${target.detectionIds.length > 1 ? `<button type="button" class="mil" data-legacy-merged-split="${escapeLegacyHtml(target.targetId)}">Ayır</button>` : ""}
    </div>`;
  }).join("");
}

function renderMergedTargetWorkspace(target) {
  const card = $("legacy-target-card");
  if (!card || !target) return false;
  const confidence = Math.round((Number(target.confidence) || 0) * 100);
  const steps = target.stepIndices?.length ? target.stepIndices.join(", ") : "—";
  const mergedViewMode = ["simple", "evidence", "full"].includes(state.legacyMergedTargetViewMode)
    ? state.legacyMergedTargetViewMode
    : "simple";
  const connectors = Array.isArray(target.connectors) ? target.connectors : [];
  const evidence = Array.isArray(target.evidence) ? target.evidence : [];
  const sectionEvidence = evidence[0]
    ? { ...evidence[0], depthTopM: target.depthTopM, depthBottomM: target.depthBottomM }
    : null;
  renderLegacyTargetSection($("legacy-target-section-content"), state.legacyDikResult, sectionEvidence);
  const lateralRelations = Array.isArray(state.legacyFieldModel?.evidenceRelations)
    ? state.legacyFieldModel.evidenceRelations.filter((relation) => target.detectionIds.includes(relation.fromDetectionId) || target.detectionIds.includes(relation.toDetectionId))
    : [];
  const lateralCalibration = state.legacyFieldModel?.lateralCalibration;
  const reasons = Array.isArray(target.mergeReasons) ? target.mergeReasons : [];
  const timeline = Array.isArray(target.timeline) ? target.timeline : buildLegacyTargetTimeline(target);
  const confidenceChart = buildLegacyTargetConfidenceChart(timeline);
  const deltaLabel = confidenceChart.deltaPct == null
    ? "tek ölçüm"
    : `${confidenceChart.deltaPct >= 0 ? "+" : ""}${confidenceChart.deltaPct} puan`;
  const chartMarkup = confidenceChart.points.length
    ? `<div class="legacy-target-confidence-chart" aria-label="Adımlar arası güven değişimi"><div class="legacy-target-chart-head"><span>Adımlar arası güven</span><b>${escapeLegacyHtml(deltaLabel)}</b></div><svg viewBox="0 0 ${confidenceChart.width} ${confidenceChart.height}" role="img" aria-label="Güven yüzdesi trend grafiği"><line x1="12" y1="12" x2="12" y2="74" /><line x1="12" y1="74" x2="268" y2="74" /><polyline points="${confidenceChart.polyline}" />${confidenceChart.points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3"><title>Adım ${escapeLegacyHtml(point.stepIndex ?? "—")}: %${point.confidencePct} güven</title></circle>`).join("")}</svg><div class="legacy-target-chart-range">%${confidenceChart.minPct}–%${confidenceChart.maxPct} · ilk → son adım</div></div>`
    : "";
  card.hidden = false;
  $("legacy-target-status")?.replaceChildren(document.createTextNode("BİRLEŞİK HEDEF"));
  $("legacy-target-title")?.replaceChildren(document.createTextNode(`${target.targetId.replace("legacy-target-", "Hedef ")} · ${target.type || "Anomali"}`));
  const viewMode = $("legacy-target-view-mode");
  if (viewMode) viewMode.value = mergedViewMode;
  const metrics = $("legacy-target-metrics");
  if (metrics) metrics.innerHTML = `<div class="legacy-target-metric"><b>${Number(target.depthTopM || 0).toFixed(2)}–${Number(target.depthBottomM || 0).toFixed(2)} m</b><span>birleşik derinlik</span></div><div class="legacy-target-metric"><b>${evidence.length}</b><span>kaynak kanıt</span></div><div class="legacy-target-metric"><b>%${confidence}</b><span>birleşme güveni</span></div><div class="legacy-target-metric"><b>${connectors.length}</b><span>yatay bağlantı</span></div>`;
  const confidenceHost = $("legacy-target-confidence");
  if (confidenceHost) confidenceHost.innerHTML = `<b>İnceleme özeti:</b> adımlar ${escapeLegacyHtml(steps)} · ${escapeLegacyHtml(target.evidenceQuality || "single")} kanıt kalitesi${reasons.length ? `<div class="legacy-merged-reasons">${reasons.map((reason) => `<span>• ${escapeLegacyHtml(reason)}</span>`).join("")}</div>` : ""}${lateralRelations.length ? `<div class="legacy-lateral-evidence-note">↔ ${lateralRelations.length} lateral yanıt adayı. <b>Kanıt</b> görünümünde kesikli mavi çizgi, sensör yanıtı olasılığını gösterir; fiziksel bağlantı veya büyütülmüş obje değildir.${lateralCalibration?.applied ? ` Saha kalibrasyonu: 1 m referans / ${Number(lateralCalibration.observedM).toFixed(2)} m okuma · skor etkisi sınırlı ve yalnız lateral proxy içindir.` : ""}</div>` : ""}`;
  const notes = $("legacy-target-notes");
  if (notes) {
    notes.hidden = false;
    const timelineRows = timeline.length
      ? timeline.map((item) => `<div class="legacy-target-timeline-row"><span class="legacy-target-timeline-step">${item.stepIndex == null ? "—" : `Adım ${escapeLegacyHtml(item.stepIndex)}`}</span><span><b>%${escapeLegacyHtml(item.confidencePct)}</b> güven</span><span>${item.depthTopM == null ? "—" : `${item.depthTopM.toFixed(2)}–${item.depthBottomM.toFixed(2)} m`}</span>${item.signalPct == null ? "" : `<span>%${escapeLegacyHtml(item.signalPct)} sinyal</span>`}<button type="button" class="legacy-evidence-chip" data-legacy-merged-evidence="${escapeLegacyHtml(item.detectionId)}">Odaklan</button></div>`).join("")
      : `<div class="legacy-target-timeline-empty">Zaman çizelgesi için kaynak kanıt yok.</div>`;
    notes.innerHTML = `<b>Kaynak kanıtlar</b><div class="legacy-evidence-list">${evidence.map((item) => `<button type="button" class="legacy-evidence-chip" data-legacy-merged-evidence="${escapeLegacyHtml(item.detectionId)}">Adım ${escapeLegacyHtml(item.stepIndex ?? "—")} · ${escapeLegacyHtml(item.detectionId)}</button>`).join("")}</div><div class="legacy-target-timeline"><div class="legacy-target-timeline-title">Güven ve derinlik zaman çizelgesi</div><div class="legacy-target-timeline-subtitle">Tarama sırasındaki her kanıt · birleşik güven: %${confidence}</div>${chartMarkup}${timelineRows}</div>`;
  }
  ["btn-legacy-target-notes", "btn-legacy-target-report", "btn-legacy-target-prev", "btn-legacy-target-focus", "btn-legacy-target-next", "btn-legacy-target-only", "btn-legacy-target-calibrate"].forEach((id) => { const button = $(id); if (button) button.disabled = id.endsWith("notes") || id.endsWith("calibrate"); });
  return true;
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
  const modelOptions = {
    mergeProfile: state.legacyMergeProfile,
    splitDetectionIds: state.legacyMergedSplitDetectionIds,
    fieldCalibrationReadings: state.legacyFieldCalibrationReadings,
    fieldCalibrationReferenceM: 1,
    fieldCalibrationAfterM: state.legacyFieldCalibrationAfterM,
    fieldCalibrationObservedM: state.legacyFieldCalibrationObservedM,
    fieldCalibrationDepthScale: state.legacyFieldCalibrationDepthScale,
    learnedThresholds: state.legacyLearnedThresholds || null,
    depthParams: readDepthParamsFromUi(),
    scan: {
      matrixRows: Number(normalized.matrixRows) || 0,
      matrixCols: Number(normalized.matrixCols) || 0,
    },
  };
  const packageFieldModel = options.casePackage?.derived?.fieldModel;
  const fieldModel = packageFieldModel && typeof packageFieldModel === "object"
    ? packageFieldModel
    : legacyCasePackageMatches(state.legacyCasePackage, normalized, modelOptions)
      ? state.legacyCasePackage.derived.fieldModel
      : buildLegacyFieldModel(normalized, modelOptions);
  modelOptions.notesByDetection = Object.fromEntries(
    (fieldModel.detections || []).map((detection) => [detection.detectionId, getDetectionNotes(detection.detectionId)]),
  );
  state.legacyDikResult = normalized;
  state.legacyFieldModel = fieldModel;
  state.legacyDikFileName = fileName;
  legacyCaseStore.setAnalysis(normalized, {
    fileName,
    content: state.legacyDikRawContent || "",
    analysisParams: readDepthParamsFromUi(),
  });
  if (options.casePackage) {
    state.legacyCasePackage = options.casePackage;
  } else {
    refreshLegacyCasePackage(state, fieldModel, modelOptions);
  }

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
  syncLegacyMapViewUi();
  syncLegacyMergeProfileUi();
  syncUndergroundButtonUi(isLegacyUnifiedObjectMapAvailable());
  syncSubsurfaceButtonUi(isLegacySubsurfaceMapAvailable(normalized));
  syncGeothermalButtonUi(isLegacyGeothermalMapAvailable(normalized));
  syncDepthButtonUi(isLegacyDepthMapAvailable(normalized));
  syncInvertProxyButtonUi(isLegacyInvertProxyAvailable(normalized));
  syncLabelModeUi();
  syncStepNumberingUi();
  syncSceneViewUi();
  applyFocusSafeStepVisibility(selectedDetectionOf(state.legacyTargetSession));
  syncStepNumberInput();
  syncObjectViewUi(fieldModel);
  syncLegacyExportUi(fieldModel);
  syncLegacyCalibrationMode(state.legacyDepthCalibrationMode);
  syncFieldStakeCalibrationUi();
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
    const trace = buildLegacyAnalysisTrace(normalized, fieldModel, {
      inputPresent: !!state.legacyDikRawContent || !!normalized,
      fileName,
    });
    const traceRows = trace.stages.map((item) => {
      const icon = item.status === "complete" ? "✓" : "△";
      const count = item.count == null ? "" : `<b class="legacy-analysis-trace-count">${item.count}</b>`;
      return `<div class="legacy-analysis-trace-row is-${escapeLegacyHtml(item.status)}"><span class="legacy-analysis-trace-icon" aria-hidden="true">${icon}</span><span class="legacy-analysis-trace-label">${escapeLegacyHtml(item.label)}</span>${count}<span class="legacy-analysis-trace-detail">${escapeLegacyHtml(item.detail)}</span></div>`;
    }).join("");
    const traceHtml = `<details class="legacy-analysis-trace"><summary>Analiz akışı <span>${trace.status === "complete" ? "tamamlandı" : "uyarı var"}</span></summary><div class="legacy-analysis-trace-list">${traceRows}</div><div class="legacy-analysis-trace-foot">Sözleşme v${trace.schemaVersion}${trace.fingerprint ? ` · ${escapeLegacyHtml(trace.fingerprint)}` : ""}</div></details>`;
    summaryHost.innerHTML = `<div style="font-size:0.72rem;color:var(--text);margin-top:0.25rem;"><b>${fieldModel.steps.length}</b> adım · <b>${fieldModel.detections.length}</b> tespit · <b style="color:#ff7777;">${strong.length}</b> güçlü</div>${first ? `<div style="font-size:0.68rem;line-height:1.45;margin-top:0.3rem;color:#dce8ef;"><b>${escapeLegacyHtml(first.type)}</b><br/>Adım ${first.stepIndex ?? "—"} · hat ${first.stationM.toFixed(2)} m · derinlik ${first.depthTopM.toFixed(2)}–${first.depthBottomM.toFixed(2)} m · güven %${Math.round(first.confidence * 100)}<br/><span style="color:#8fe3ae;">${escapeLegacyHtml(first.recommendation)}</span></div>` : `<div style="font-size:0.66rem;color:var(--muted);margin-top:0.25rem;">Önemli tespit bulunamadı.</div>`}${traceHtml}`;
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
          return `<button type="button" class="legacy-step-card${idx === selectedStepOf(state.legacyTargetSession) ? " is-selected" : ""}" data-legacy-step="${idx}" data-legacy-status="${modelStep?.status || "normal"}" data-legacy-has-detection="${anomalyCount > 0 ? "1" : "0"}">
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
      const lateralBadge = lateralRelationBadgeHtml(detectionId);
      const volumeText = `<span class="legacy-volume-line"><b>Yaklaşık hacim</b> ${formatVolumeM3(volume)} · ${dims.width.toFixed(2)} × ${dims.length.toFixed(2)} × ${dims.height.toFixed(2)} m</span>`;
      return `<div class="legacy-anomaly-card" data-legacy-focus="${detectionId}" data-legacy-status="${detectionStatus}" style="display:block;width:100%;text-align:left;color:var(--text);${strong}"><button type="button" class="legacy-detection-main" data-legacy-focus="${detectionId}" style="display:block;width:100%;text-align:left;color:inherit;background:none;border:0;padding:0;cursor:pointer;"><span style="color:${kind === "metal" ? "#e85858" : "#f4c875"};">${i === 0 ? "★" : "◆"} #${i + 1}</span> <b>${kind === "metal" ? "Metal" : "Anomali"}</b> · ${shapeName} · ${source}<br/><span>Adım ${detection?.stepIndex ?? "—"} · hat ${detection?.stationM?.toFixed(2) ?? "—"} m · aralık ${stepRangeText} · derinlik ${top.toFixed(2)}–${bot.toFixed(2)} m · güven %${Math.round((detection?.confidence ?? Number(c.confidence) ?? 0) * 100)} · ${sig.toFixed(1)}σ</span><br/><span>şekil güveni %${shapeConfidence} · RMS ${Number.isFinite(shapeError) ? shapeError.toFixed(2) : "—"} · boyut ${width.toFixed(2)} × ${length.toFixed(2)} m · ${volumeText}</span></button>${magBadge}${consistBadge}${lateralBadge}<div style="display:flex;gap:0.25rem;margin-top:0.25rem;"><button type="button" class="mil" data-legacy-show="${detectionId}">3D’de göster</button><button type="button" class="mil" data-legacy-only="${detectionId}">Sadece bunu göster</button><button type="button" class="mil" data-legacy-section="${detectionId}">Kesiti aç</button></div>${recommendation}</div>`;
    });
      const relationSummary = fieldModel.evidenceRelations?.length
      ? `<div class="legacy-detection-heading"><span class="legacy-section-kicker">LATERAL YANIT ADAYLARI</span><span>${fieldModel.evidenceRelations.length} ilişki · proxy, kesin birleşme değil${fieldModel.lateralCalibration?.applied ? ` · saha kalibrasyonu ${fieldModel.lateralCalibration.quality}` : ""}</span></div>`
      : "";
    const mergedRows = fieldModel.mergedTargets?.length
      ? `<div class="legacy-detection-heading"><span class="legacy-section-kicker">BİRLEŞİK HEDEFLER</span><span>${fieldModel.mergedTargets.length} fiziksel hedef · ${fieldModel.detections.length} ham kanıt</span></div>${mergedTargetRows(fieldModel.mergedTargets)}`
      : "";
    const mapMode = state.legacyMapViewMode || "merged";
    const candidateIntro = `<div class="legacy-candidate-disclaimer">Öncelik sırası; tekrarlı ölçüm, konum tutarlılığı ve güven göstergelerine dayanır. Bir adayın gerçek hedef olduğunu kanıtlamaz.</div>`;
    const evidenceRows = rows.length
      ? `<div class="legacy-detection-heading"><span class="legacy-section-kicker">HAM KANITLAR</span><span>${rows.length} ayrı sonuç · güçlüden zayıfa</span></div>${rows.join("")}`
      : `<div class="legacy-empty-state">Analiz anomalisi bulunamadı · ${escapeLegacyHtml(fileName)} · ${escapeLegacyHtml(normalized.fingerprint || "")}</div>`;
    list.innerHTML = `${filterBar}${mapMode === "merged" ? candidateIntro : ""}${mapMode === "full" ? stepSummary : ""}${mapMode === "merged" ? `${relationSummary}${mergedRows}` : mapMode === "both" ? `${relationSummary}${mergedRows}${stepSummary}${evidenceRows}` : `${relationSummary}${evidenceRows}`}`;
    if (listFilter !== "all" && state.legacyMapViewMode !== "merged") applyListFilter(list, listFilter);
  }

  const clr = $("btn-legacy-dik-clear");
  if (clr) clr.disabled = false;
  updateLegacySahaBrief(selectedDetectionOf(state.legacyTargetSession));
  updateLegacyTargetCard(selectedDetectionOf(state.legacyTargetSession));
  syncLegacyUserModeUi();
  syncLegacyTargetModeUi();
  syncLegacyMatrixProductLabel();
  syncLegacyRuntimeContext();
}

export function clearLegacyDikPanel() {
  removeLegacyTomography();
  removeLegacySubsurfaceMap();
  removeLegacyUndergroundMap();
  removeLegacyGeothermalMap();
  removeLegacyDepthMap();
  removeLegacyDikShapes();
  clearLegacySelection();
  legacyCaseStore.clearCase();
  state.legacyDikRawContent = null;
  state.legacyDikFileName = null;
  state.legacySelectedMergedTargetId = null;
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
  syncUndergroundButtonUi(false);
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
  syncLegacyRuntimeContext();
}

function readLegacyMatrixInput() {
  return readAnalyzeInputs({
    rows: $("legacy-dik-matrix-rows")?.value,
    cols: $("legacy-dik-matrix-cols")?.value,
    spacing: "0",
  }).matrix;
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
    await analyzeLegacyContent(picked.content, picked.fileName || picked.file_name || "scan.json");
  } catch (e) {
    console.warn("[legacy-dik]", e);
    const message = e instanceof Error ? e.message : String(e);
    setStatus(`Dik çekim: ${message}`);
  }
}

/**
 * Legacy JSON içeriğini mevcut analiz hattından geçirir (dosya seçimi olmadan).
 * Bluetooth canlı akışı gibi dış kaynaklar bu giriş noktasını kullanır.
 */
export async function analyzeLegacyContent(content, fileName = "scan.json") {
  try {
    setStatus("Dik çekim analiz ediliyor…");
    await ensureViewer();
    try { removeCsvOverlay(); } catch (_) {}
    try { removeLegacyDikShapes(); } catch (_) {}
    const { matrix, effectiveStepSpacingM } = readLegacyAnalyzeInputs();
    const depthParams = readDepthParamsFromUi();
    const result = await analyzeLegacyDikJson(
      content,
      fileName,
      matrix.scanStepCount,
      effectiveStepSpacingM,
      depthParams
    );
    const normalized = normalizeLegacyResult(result, matrix.hint);
    state.legacyDikRawContent = content;
    state.legacyCase = createLegacyCase({
      result: normalized,
      fileName,
      content,
      observations: {},
    });
    state.legacyDepthCalibSuggestion = null;
    state.legacyDepthCalibBaseParams = null;
    state.legacyFieldCalibrationRestored = false;
    state.legacyFieldCalibrationObservedM = null;
    state.legacyFieldCalibrationDepthScale = null;
    state.legacyReportTargetIds = [];
    clearLegacySelection();
    state.legacyMatrixHint = matrix.hint;
    // Önce fingerprint oturumunu ve öğrenilmiş eşikleri yükle; kalibrasyon ve
    // eşik geri geldikten sonra 3D katmanı aynı snapshot ile üretilecek.
    await loadLearnedThresholdsFromSettings();
    await loadFieldSessionForCurrentJson();
    fieldSessionController.restoreCase(normalized, fileName);
    addLegacyDikShapesToScene(normalized);
    const session = activeFieldSession();
    if (session) {
      state.legacyReportTargetIds = [...session.reportTargets];
    }
    renderLegacyDikPanel(normalized, { fileName });
    try {
      const savedEntry = await saveLegacyArchive(fileName, content, normalized, state.legacyCasePackage);
      state.legacyArchiveEntryId = savedEntry?.id || null;
      await refreshArchives();
    } catch (archiveError) {
      console.warn("[legacy-dik] arşiv kaydı yapılamadı:", archiveError);
    }
    const progressNote = sessionProgressStatusText();
    setStatus(`${normalized.message || "Dik çekim hazır"}${progressNote ? ` — ${progressNote.replace(/^ · önceki oturum: /, "")} geri yüklendi` : ""}`);
  } catch (e) {
    console.warn("[legacy-dik]", e);
    const message = e instanceof Error ? e.message : String(e);
    setStatus(`Dik çekim: ${message}`);
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
    if (state.legacyDepthCalibrationMode === "field-stake") {
      const readings = Array.isArray(state.legacyFieldCalibrationReadings) ? state.legacyFieldCalibrationReadings : [];
      if (readings.length) {
        state.legacyFieldCalibrationBeforeM = readings.reduce((sum, value) => sum + Number(value), 0) / readings.length;
      }
      state.legacyFieldCalibrationAfterM = null;
    }
    state.legacyDepthCalibSuggestion = null;
    state.legacyDepthCalibBaseParams = null;
    writeDepthParamsToUi(params);
    const saved = await setLegacyDepthParams(params);
    writeDepthParamsToUi(saved?.legacyDepthParams || saved?.legacy_depth_params || params);
    if (state.legacyDikRawContent) {
      setStatus("Parametre kaydedildi · yeniden analiz…");
      const normalized = await reanalyzeCurrentLegacyJson(params);
      if (state.legacyDepthCalibrationMode === "field-stake") {
        const after = buildDepthCalibSummary(1.0, params, normalized);
        state.legacyFieldCalibrationAfterM = after?.votexMidM == null ? null : Number(after.votexMidM);
        refreshLegacyLateralEvidenceLayer();
        void persistLateralCalibrationSnapshot();
        syncFieldStakeCalibrationUi();
      }
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
    state.legacyDepthCalibSuggestion = null;
    state.legacyDepthCalibBaseParams = null;
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

function sameDepthParams(a, b) {
  if (!a || !b) return false;
  return Math.abs(Number(a.sensorHeightM) - Number(b.sensorHeightM)) < 0.0001
    && Math.abs(Number(a.bipolarSepFactor) - Number(b.bipolarSepFactor)) < 0.0001
    && Math.abs(Number(a.dipoleBlend) - Number(b.dipoleBlend)) < 0.0001;
}

function syncLegacyCalibrationRestoreUi() {
  const el = $("legacy-calibration-restore-status");
  if (!el) return;
  const calibration = state.legacyFieldModel?.lateralCalibration;
  const restored = !!state.legacyFieldCalibrationRestored && !!calibration?.applied;
  if (!restored) {
    el.hidden = true;
    el.textContent = "";
    el.title = "";
    return;
  }
  const count = Number(calibration.readingCount) || 0;
  const observed = Number(calibration.observedM);
  const mode = calibration.quality === "after-reanalysis" ? "yeniden analiz" : "oturum";
  el.hidden = false;
  el.textContent = `✓ Kalibrasyon geri yüklendi · ${count ? `${count} okuma` : "snapshot"} · 1 m referans${Number.isFinite(observed) ? ` / ${observed.toFixed(2)} m` : ""}`;
  el.title = `Fingerprint oturumundan ${mode} geri yüklendi; lateral yanıt proxy’si bu snapshot ile hesaplandı.`;
}

function syncFieldStakeCalibrationUi() {
  const host = $("legacy-field-stake-controls");
  syncLegacyCalibrationRestoreUi();
  const mode = state.legacyDepthCalibrationMode === "field-stake";
  if (host) host.hidden = !mode;
  if (!mode) return;
  const readings = Array.isArray(state.legacyFieldCalibrationReadings)
    ? state.legacyFieldCalibrationReadings.map(Number).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const stakeSummary = summarizeFieldStakeReadings(readings, state.legacyFieldCalibrationAfterM);
  const average = stakeSummary.averageM;
  const count = $("legacy-stake-reading-count");
  const list = $("legacy-stake-readings");
  const comparison = $("legacy-stake-comparison");
  if (count) count.textContent = `${readings.length}/3 okuma`;
  if (list) list.textContent = readings.length ? readings.map((value, index) => `${index + 1}: ${value.toFixed(2)} m`).join(" · ") : "Henüz kayıt yok";
  const beforeError = stakeSummary.beforeErrorM;
  const current = buildDepthCalibSummary(1.0, readDepthParamsFromUi(), state.legacyDikResult);
  const currentM = current?.votexMidM == null ? null : Number(current.votexMidM);
  const afterM = state.legacyFieldCalibrationAfterM ?? (state.legacyFieldCalibrationBeforeM != null ? currentM : null);
  const afterSummary = summarizeFieldStakeReadings(readings, afterM);
  const afterError = afterSummary.afterErrorM;
  if (comparison) {
    comparison.innerHTML = average == null
      ? "Önce aynı kazığı okuyup <b>Okumayı kaydet</b> ile en fazla 3 tekrar ekleyin."
      : `<b>Önce</b> ${average.toFixed(2)} m · hata ${beforeError.toFixed(2)} m${afterM == null ? "" : ` &nbsp;→&nbsp; <b>Sonra</b> ${afterM.toFixed(2)} m · hata ${afterError.toFixed(2)} m`}`;
  }
}

function recordFieldStakeReading() {
  if (state.legacyDepthCalibrationMode !== "field-stake") {
    setStatus("Önce saha cihazı · 1 m referans kazığı modunu seçin");
    return;
  }
  const summary = buildDepthCalibSummary(1.0, readDepthParamsFromUi(), state.legacyDikResult);
  const measured = Number(summary?.votexMidM);
  if (!Number.isFinite(measured) || measured <= 0) {
    setStatus("Okuma kaydedilemedi · analiz sonucu içinde metal tespiti bulunamadı");
    return;
  }
  const readings = Array.isArray(state.legacyFieldCalibrationReadings) ? state.legacyFieldCalibrationReadings : [];
  if (readings.length >= 3) {
    setStatus("En fazla 3 tekrar okuması kaydedilebilir");
    return;
  }
  state.legacyFieldCalibrationReadings = [...readings, measured];
  state.legacyFieldCalibrationBeforeM = state.legacyFieldCalibrationReadings.reduce((sum, value) => sum + Number(value), 0) / state.legacyFieldCalibrationReadings.length;
  state.legacyFieldCalibrationAfterM = null;
  void persistLateralCalibrationSnapshot();
  syncFieldStakeCalibrationUi();
  setStatus(`Saha kazığı okuması ${readings.length + 1}/3 kaydedildi · ${measured.toFixed(2)} m`);
}

function syncLegacyCalibrationMode(modeOverride = null) {
  const selectedMode = modeOverride === "field-stake" || modeOverride === "single-object"
    ? modeOverride
    : $("legacy-calibration-mode")?.value;
  const mode = selectedMode === "field-stake" ? "field-stake" : "single-object";
  state.legacyDepthCalibrationMode = mode;
  const modeSelect = $("legacy-calibration-mode");
  if (modeSelect) modeSelect.value = mode;
  const label = $("legacy-param-label-depth");
  const labelText = $("legacy-label-depth-text");
  const labelHelp = $("legacy-label-depth-help");
  const modeHelp = $("legacy-calibration-mode-help");
  if (mode === "field-stake") {
    if (label && label.value && label.value !== "1.00") label.dataset.singleObjectDepth = label.value;
    if (label) {
      label.value = "1.00";
      label.readOnly = true;
      label.title = "Metal uçlu referans kazığının bilinen uç derinliği: 1,00 m";
    }
    if (labelText) labelText.textContent = "Referans uç derinliği (m)";
    if (labelHelp) labelHelp.textContent = "1 m mihenk noktası · saha cihaz kalibrasyonu";
    if (modeHelp) modeHelp.textContent = "İlk okutmayı 1 m metal uçlu referans kazığıyla yapın";
  } else {
    if (label) {
      label.value = label.dataset.singleObjectDepth || "";
      label.readOnly = false;
      label.title = "Bilinen gömü derinliği (kalibrasyon)";
    }
    if (labelText) labelText.textContent = "Bilinen derinlik (m)";
    if (labelHelp) labelHelp.textContent = "tek obje kalibrasyonu";
    if (modeHelp) modeHelp.textContent = "Seçili objenin bilinen derinliğini girin";
  }
  const ai = $("btn-legacy-params-ai");
  syncFieldStakeCalibrationUi();
  syncLegacyCalibrationRestoreUi();
  if (ai) {
    ai.textContent = mode === "field-stake" ? "🤖 Saha kalibrasyonu öner" : "🤖 AI öner";
    ai.title = mode === "field-stake"
      ? "1 m referans kazığıyla cihazın saha derinlik ölçeğini kalibre et"
      : "Bilinen tek obje derinliğine göre Parametre öner";
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
    const visibleParams = readDepthParamsFromUi();
    // Öneri sonucu alanlara yazılır; tekrar tıklanınca aynı öneriyi yeniden
    // başlangıç kabul edip çarpanları katlamamak için ilk parametreleri koru.
    const suggestionWasDisplayed = !!state.legacyDepthCalibSuggestion;
    const repeatedSameSuggestion = suggestionWasDisplayed
      && sameDepthParams(visibleParams, state.legacyDepthCalibSuggestion);
    if (!repeatedSameSuggestion || !state.legacyDepthCalibBaseParams) {
      state.legacyDepthCalibBaseParams = { ...visibleParams };
    }
    const params = repeatedSameSuggestion
      ? state.legacyDepthCalibBaseParams
      : visibleParams;
    const out = await suggestDepthParamsWithAi(labelM, params, {
      baselineParams: params,
      calibrationMode: state.legacyDepthCalibrationMode,
    });
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
    state.legacyDepthCalibBaseParams = null;
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

    const mergedExpand = event.target.closest("[data-legacy-merged-expand]");
    const mergedReport = event.target.closest("[data-legacy-merged-report]");
    const mergedSplit = event.target.closest("[data-legacy-merged-split]");
    const mergedCard = event.target.closest("[data-legacy-merged-target]");
    if (mergedReport) {
      toggleMergedTargetReport(mergedReport.dataset.legacyMergedReport);
      return;
    }
    if (mergedSplit) {
      splitMergedTarget(mergedSplit.dataset.legacyMergedSplit);
      return;
    }
    if (mergedExpand) {
      const targetId = mergedExpand.dataset.legacyMergedExpand;
      state.legacySelectedMergedTargetId = targetId || null;
      state.legacyMergedTargetViewMode = "simple";
      state.legacyMapViewMode = "both";
      const target = state.legacyFieldModel?.mergedTargets?.find((item) => item.targetId === targetId);
      const evidenceId = target?.detectionIds?.[0];
      if (evidenceId && state.structureTargets?.[evidenceId]) focusLegacyDetection(evidenceId);
      renderLegacyDikPanel(state.legacyDikResult, { fileName: state.legacyDikFileName });
      setStatus(target ? `${target.targetId.replace("legacy-target-", "Hedef ")} inceleme alanı açıldı` : "Birleşik hedef seçilemedi");
      return;
    }
    if (mergedCard) {
      const target = state.legacyFieldModel?.mergedTargets?.find((item) => item.targetId === mergedCard.dataset.legacyMergedTarget);
      state.legacySelectedMergedTargetId = target?.targetId || null;
      state.legacyMergedTargetViewMode = "simple";
      const evidenceId = target?.detectionIds?.[0];
      if (evidenceId && state.structureTargets?.[evidenceId]) focusLegacyDetection(evidenceId);
      updateLegacyTargetCard(evidenceId);
      setStatus(target ? `${target.targetId.replace("legacy-target-", "Hedef ")} seçildi · ${target.detectionIds.length} kanıt` : "Birleşik hedef seçilemedi");
      return;
    }
    const sectionButton = event.target.closest("[data-legacy-section]");
    if (sectionButton) {
      const id = sectionButton.dataset.legacySection;
      state.legacySelectedMergedTargetId = null;
      if (id && state.structureTargets?.[id]) {
        focusLegacyDetection(id);
        updateLegacySahaBrief(id);
        updateLegacyTargetCard(id);
        const sectionDetails = $("legacy-target-section");
        if (sectionDetails) sectionDetails.open = true;
        sectionDetails?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      return;
    }
    const mergedEvidence = event.target.closest("[data-legacy-merged-evidence]");
    if (mergedEvidence) {
      const id = mergedEvidence.dataset.legacyMergedEvidence;
      state.legacySelectedMergedTargetId = null;
      if (id && state.structureTargets?.[id]) focusLegacyDetection(id);
      updateLegacySahaBrief(id);
      updateLegacyTargetCard(id);
      return;
    }

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
      state.legacySelectedMergedTargetId = null;
      const id = showButton.dataset.legacyShow;
      if (id && state.structureTargets?.[id]) {
        focusLegacyDetection(id);
        const detection = state.legacyFieldModel?.detections?.find((item) => item.detectionId === id);
        maybeFocusTomography(detection);
        updateLegacySahaBrief(id);
        updateLegacyTargetCard(id);
      }
      return;
    }
    const onlyButton = event.target.closest("[data-legacy-only]");

    if (onlyButton) {
      state.legacySelectedMergedTargetId = null;
      const id = onlyButton.dataset.legacyOnly;
      if (id && state.structureTargets?.[id]) {
        focusLegacyDetection(id);
        const detection = state.legacyFieldModel?.detections?.find((item) => item.detectionId === id);
        maybeFocusTomography(detection);
        updateLegacySahaBrief(id);
        updateLegacyTargetCard(id);
        legacyList.querySelectorAll(".legacy-anomaly-card").forEach((el) => {
          el.style.opacity = el.dataset.legacyFocus === id ? "1" : "0.45";
        });
      }
      return;
    }
    const stepCard = event.target.closest("[data-legacy-step]");
    if (stepCard) {
      state.legacySelectedMergedTargetId = null;
      const rawStep = stepCard.dataset.legacyStep;
      if (rawStep === "all") {
        clearLegacySelection();
        const stepInput = $("legacy-step-number-input");
        if (stepInput) stepInput.value = "";
        updateLegacyTargetCard(null);
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
        updateLegacyTargetCard(selectedDetectionOf(state.legacyTargetSession));
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
      updateLegacyTargetCard(id);
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  $("legacy-target-section-content")?.addEventListener("click", (event) => {
    const axisButton = event.target.closest("[data-target-section-axis]");
    if (!axisButton) return;
    setLegacyTargetSectionAxis(axisButton.dataset.targetSectionAxis);
    const mergedTarget = state.legacySelectedMergedTargetId
      ? state.legacyFieldModel?.mergedTargets?.find((item) => item.targetId === state.legacySelectedMergedTargetId)
      : null;
    if (mergedTarget) {
      renderMergedTargetWorkspace(mergedTarget);
      return;
    }
    const selectedId = selectedDetectionOf(state.legacyTargetSession);
    const detection = state.legacyFieldModel?.detections?.find((item) => String(item.detectionId) === String(selectedId));
    renderLegacyTargetSection($("legacy-target-section-content"), state.legacyDikResult, detection);
  });

  legacyList?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.closest("#legacy-step-number-input")) {
      event.preventDefault();
      focusLegacyStepFromInput();
    }
  });

  $("legacy-map-view")?.addEventListener("change", (event) => {
    state.legacyMapViewMode = ["full", "merged", "both"].includes(event.target.value) ? event.target.value : "full";
    if (state.legacyDikResult) renderLegacyDikPanel(state.legacyDikResult, { fileName: state.legacyDikFileName });
  });
  $("legacy-depth-profile")?.addEventListener("change", (event) => {
    applyLegacyDepthProfile(event.target.value);
  });
  $("legacy-merge-profile")?.addEventListener("change", (event) => {
    applyLegacyMergeProfile(event.target.value);
  });
  $("legacy-user-mode")?.addEventListener("change", (event) => {
    state.legacyUserMode = event.target.value === "expert" ? "expert" : "simple";
    syncLegacyUserModeUi();
    setStatus(state.legacyUserMode === "expert" ? "Uzman ayarları açıldı" : "Basit kullanım açıldı");
  });
  // Workflow view kendi click handler'ını renderLegacyWorkflowView üzerinden bağlar.
  $("legacy-target-view-mode")?.addEventListener("change", (event) => {
    const mode = ["simple", "evidence", "full"].includes(event.target.value) ? event.target.value : "simple";
    state.legacyMergedTargetViewMode = mode;
    if (mode === "full") {
      applyLegacyStepVisibility(null, null);
    } else {
      applyLegacyStepVisibility(selectedStepOf(state.legacyTargetSession), selectedDetectionOf(state.legacyTargetSession));
    }
    updateLegacyTargetCard(selectedDetectionOf(state.legacyTargetSession));
    setStatus(mode === "simple" ? "Sade hedef görünümü" : mode === "evidence" ? "Kanıt görünümü" : "Tam saha görünümü");
  });
  $("btn-legacy-target-mode")?.addEventListener("click", () => {
    state.legacyTargetMode = !state.legacyTargetMode;
    syncLegacyTargetModeUi();
    updateLegacyTargetCard();
    setStatus(state.legacyTargetMode ? "Hedef modu açık · yalnızca seçili hedef" : "Hedef modu kapalı");
  });
  $("btn-legacy-target-prev")?.addEventListener("click", () => selectTargetByOffset(-1));
  $("btn-legacy-target-next")?.addEventListener("click", () => selectTargetByOffset(1));
  $("btn-legacy-target-focus")?.addEventListener("click", () => {
    const mergedTarget = state.legacySelectedMergedTargetId
      ? state.legacyFieldModel?.mergedTargets?.find((item) => item.targetId === state.legacySelectedMergedTargetId)
      : null;
    if (mergedTarget?.detectionIds?.[0]) {
      state.legacySelectedMergedTargetId = null;
      focusLegacyDetection(mergedTarget.detectionIds[0]);
      return;
    }
    const selectedDetectionId = selectedDetectionOf(state.legacyTargetSession);
    const selectedStepIndex = selectedStepOf(state.legacyTargetSession);
    if (selectedDetectionId) focusLegacyDetection(selectedDetectionId);
    else if (selectedStepIndex != null) focusLegacyStep(selectedStepIndex);
  });
  $("btn-legacy-target-only")?.addEventListener("click", () => {
    const selectedDetectionId = selectedDetectionOf(state.legacyTargetSession);
    if (selectedDetectionId) focusLegacyDetection(selectedDetectionId);
  });
  $("btn-legacy-target-calibrate")?.addEventListener("click", calibrateSelectedTarget);
  $("btn-legacy-target-confirm")?.addEventListener("click", () => { void setTargetCheckStatusFromUi("confirmed"); });
  $("btn-legacy-target-reject")?.addEventListener("click", () => { void setTargetCheckStatusFromUi("rejected"); });
  $("legacy-target-card")?.addEventListener("click", (event) => {
    const evidence = event.target.closest("[data-legacy-merged-evidence]");
    if (!evidence) return;
    const id = evidence.dataset.legacyMergedEvidence;
    state.legacySelectedMergedTargetId = null;
    if (id && state.structureTargets?.[id]) focusLegacyDetection(id);
    updateLegacySahaBrief(id);
    updateLegacyTargetCard(id);
  });
  $("btn-legacy-target-notes")?.addEventListener("click", () => {
    const id = selectedTargetId();
    if (id) openDetectionNoteModal(id);
  });
  $("btn-legacy-target-report")?.addEventListener("click", () => {
    const id = selectedTargetId();
    if (id) toggleTargetReport(id);
  });
  window.addEventListener("votex:detection-notes-change", (event) => {
    updateLegacyTargetCard(event.detail?.focusId || selectedTargetId());
  });
  window.addEventListener("votex:runtime-version", () => {
    syncLegacyRuntimeContext();
  });
  window.addEventListener("votex:selection-change", (event) => {
    updateLegacyTargetCard(event.detail?.id || selectedDetectionOf(state.legacyTargetSession));
    syncLegacyRuntimeContext();
  });

  $("btn-legacy-saha-copy")?.addEventListener("click", () => {
    copyLegacySahaBrief();
  });
  $("btn-legacy-dta-brief-copy")?.addEventListener("click", () => {
    void copyLegacyDtaCaseBrief();
  });

  bindLegacyReportExports({
    get: (id) => $(id),
    state,
    readParams: readDepthParamsFromUi,
    residualScaleOf,
    selectedTargetsHtml: selectedTargetsReportHtml,
    getBrief: () => ({ html: lastSahaBriefHtml, text: lastSahaBriefText }),
    setStatus,
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

  bindLegacyDataControls({
    get: (id) => $(id),
    run: runLegacyDik,
    level: runLegacyLeveling,
    clear: clearLegacyDikPanel,
    setStatus,
  });
  $("legacy-dik-matrix-rows")?.addEventListener("input", syncLegacyMatrixProductLabel);
  $("legacy-dik-matrix-cols")?.addEventListener("input", syncLegacyMatrixProductLabel);
  syncLegacyMatrixProductLabel();
  bindLegacyVisualizationToggles({
    get: (id) => $(id),
    state,
    sync: {
      tomography: syncTomographyControlsUi,
      subsurface: syncSubsurfaceButtonUi,
      underground: syncUndergroundButtonUi,
      geothermal: syncGeothermalButtonUi,
      depth: syncDepthButtonUi,
      invert: syncInvertProxyButtonUi,
    },
    setStatus,
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
  bindLegacyAiControls({
    get: (id) => $(id),
    state,
    interpretGeothermal: interpretGeothermalWithAi,
    syncGeothermalUi: syncGeothermalAiUi,
    setStatus,
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

  bindLegacyCalibrationControls({
    get: (id) => $(id),
    state,
    apply: applyLegacyDepthParams,
    reset: resetLegacyDepthParams,
    suggest: runDepthCalibAiSuggest,
    recordStake: recordFieldStakeReading,
    fillSuggestion: fillDepthParamsFromSuggestion,
    syncMode: syncLegacyCalibrationMode,
    syncAi: syncDepthCalibAiUi,
  });
  syncLegacyCalibrationMode();
  syncLegacyUserModeUi();
  syncLegacyTargetModeUi();
  syncLegacyGuideUi();
  syncLegacyRuntimeContext();
  void loadDepthParamsFromSettings();
  void loadCalibNotesFromSettings();
  void loadLearnedThresholdsFromSettings();
}
