import { buildSurface3d, deepStructureScan, stagedDepthScan, waterBlueScan, getAppSettings, setHints3dVisible } from "./api/tauri.js";
import { enableDualAnalysis, setModuleEnabled, getPackStatus } from "./hybrid/dualAnalysisPack.js";
import { setClipEnabled, setClipHeight } from "./viewer/scene.js";
import { setXray } from "./viewer/xray.js";
import { initDepthProfile, drawProfile, setProfileMode, getProfileMode, exportProfilePNG } from "./viewer/depthProfile.js";
import { setRotation, setRotationFree, toggleFlipX, toggleFlipZ, setScale, setOffset, autoFit, resetAlignment, getAlignmentStatus, setCompareMode, setBlendOpacity, setSplitPos, compareMode } from "./viewer/mapAlignment.js";
import { bindColorizer, bindColorizerCycle, applyColorizer, onPaletteChange } from "./viewer/colorizer.js";
import { initColorAnalysis, reanalyzeWithColor, saveOriginalResult, clearCache, getCacheStatus, renderCacheStatusHTML, setAnalysisFunction, getOriginalResult } from "./hybrid/colorBasedAnalysis.js";
import { compareResults, formatComparison } from "./hybrid/colorCompare.js";
import { applyStructureColors, resetStructureColors } from "./viewer/structureColors.js";
import { bindViewerKeys } from "./ui/viewerKeys.js";
import { $, state } from "./app/state.js";
import { setStatus } from "./app/status.js";
import { openNativeFileDialog, setPendingFile } from "./io/files.js";
import { buildMesh } from "./viewer/mesh.js";
import { showHints, clearHints, setHintsVisible } from "./viewer/hintEngine.js";
import { applyFreeDrawVisibility } from "./viewer/builders/freeDraw.js";
import { updatePreviewMarks } from "./ui/previewMarks.js";
import { bindMapRuler, redrawRuler } from "./ui/mapRuler.js";
import { selectedShotType, selectedTargetKind, targetKindLabel, updateShotHint } from "./ui/shotType.js";
import { formatSoilLine, selectedSoilProfile, startSoilMonitor, updateSoilHint } from "./ui/soilProfile.js";
import { startThroughRedMonitor, updateThroughRedHint } from "./ui/throughRed.js";
import { bindStructureKotApply, renderStructureList } from "./ui/structureList.js";
import { bindFreeDrawPanel, renderFreeDrawPanel } from "./ui/freeDrawPanel.js";
import { bindCsvPanel } from "./ui/csvPanel.js";
import { toggleAnalysisPanel, showAnalysisPanel } from "./ui/analysisPanel.js";
import { exportReport, exportSceneImage } from "./ui/reportExport.js";
import { exportToKml } from "./ui/kmlExport.js";
import { undo, redo, canUndo, canRedo, onHistoryChange, pushState } from "./ui/undoRedo.js";
import { saveSession, compareSessions, getSessionList, formatComparisonHTML } from "./ui/timeSeries.js";
import { bindRoutePlanner, setActive as setRouteActive } from "./viewer/routePlanner.js";
import { bindCompareMode, toggle as toggleCompare } from "./ui/compareMode.js";
import { bindAnnotations, toggleAnnotationMode, renderAnnotationPins } from "./ui/annotations.js";
import { renderIntelSummary, resetIntelSummary } from "./ui/intelSummary.js";
import { logLine } from "./ui/telemetry.js";
import { startScanSweep, stopScanSweep } from "./ui/scanFx.js";
import { bindModuleRail } from "./modules/rail.js";
import { initHeartbeat, heartbeatSet } from "./ui/heartbeat.js";
import { initTreeAnimations } from "./ui/treeAnimate.js";
import { applyDtaLinkStatus, refreshDtaLink, startDtaLinkMonitor } from "./ui/dtaLink.js";
import { logProbFromSurface, startProbEngineMonitor, refreshProbEngine } from "./ui/probEngine.js";
import { syncStageHudFromSurface } from "./ui/stageHud.js";
import { wireLicenseUi, refreshLicenseBadge } from "./ui/licenseBadge.js";
import { dismissBootSplash, setBootSplashMessage } from "./ui/bootSplash.js";
import { bindArchiveApply, bindArchiveUi, refreshArchiveList } from "./ui/archive.js";
import { bindMapHintsPanel, refreshMapHintsPanel } from "./ui/mapHints.js";
import { startUpdateMonitor, refreshUpdateStatus } from "./ui/updater.js";
import { initI18n, onLocaleChange, t, tPhrase, getLocale } from "./i18n/index.js";
import { focusBestValuableMetal } from "./viewer/labels.js";
import { initTheme } from "./ui/themeToggle.js";

await initI18n();
initTheme();
setBootSplashMessage(t("boot.ui"));

function applySurface(surface, minConfidenceFallback = 0.45, { resetKot = false, autoReport = false } = {}) {
  state.surfaceState = surface;
  if (resetKot) state.structureKotM = {};
  // Ana analiz tamamlandığında rapor panelini otomatik aç
  if (autoReport) {
    showAnalysisPanel();
  }
  const vertExag = (Number($("z-scale").value) || 10) / 10;
  const wire = $("wireframe").value === "1";
  const depScale = (Number($("depression-scale")?.value) || 10) / 10;
  buildMesh(surface, vertExag, wire, depScale);
  // 🎨 Renklendirmeyi yeniden uygula (yeni ground mesh ile)
  const cm = state.colorizerMode;
  if (cm && cm !== "none") {
    requestAnimationFrame(() => applyColorizer(cm));
  }
  // İpuçlarını göster (DTA/Image analizinden)
  try {
    showHints(state.scene, surface.structures, {
      mapW: surface.map_width_m || 30,
      mapD: surface.map_depth_m || 30,
      vertExag,
      source: "dta",
    });
  } catch (e) {
    console.warn('[Hints] İpucu hatası:', e);
  }
  renderStructureList(surface);
  renderFreeDrawPanel();
  renderIntelSummary(surface);
  syncStageHudFromSurface(surface);
  logProbFromSurface(surface);
  refreshMapHintsPanel();

  const cleaned = surface.cleanedPreviewBase64 || surface.cleaned_preview_base64;
  if (cleaned) {
    const prev = $("preview");
    prev.src = cleaned;
    prev.classList.add("visible");
    prev.addEventListener(
      "load",
      () => {
        updatePreviewMarks(surface);
        redrawRuler();
      },
      { once: true }
    );
    // Compact preview'ı da göster (üstteki mini harita)
    const compactPrev = $("preview-compact");
    if (compactPrev) {
      compactPrev.src = cleaned;
      const wrapCompact = $("preview-wrap-compact");
      if (wrapCompact) wrapCompact.style.display = '';
      compactPrev.addEventListener(
        "load",
        () => updateCompactMarks(surface),
        { once: true }
      );
    }
  } else {
    updatePreviewMarks(surface);
    redrawRuler();
  }

  const s = surface.structures || {};
  const chambers = s.chambers || [];
  const tunnels = s.tunnels || [];
  const metals = s.metals || [];
  const nRoom = chambers.filter((c) => c.kind === "room" || c.kind === "tomb").length;
  const nShaft = chambers.filter((c) => c.kind === "shaft").length;
  const viewLabel = (surface.viewMode || surface.view_mode) === "side" ? t("stats.side") : t("stats.top");
  const accepted =
    s.acceptedCount ?? s.accepted_count ?? nRoom + nShaft + tunnels.length + metals.length;
  const rejected = s.rejectedCount ?? s.rejected_count ?? 0;
  const thr = s.minConfidence ?? s.min_confidence ?? minConfidenceFallback;
  const soilLine = formatSoilLine(surface);
  $("surface-stats").textContent = t("stats.line", {
    view: viewLabel,
    accepted,
    rejected,
    thr: Number(thr).toFixed(2),
    rooms: nRoom,
    shafts: nShaft,
    tunnels: tunnels.length,
    metals: metals.length,
    soil: soilLine,
  });
  const deepBtn = $("btn-deep-scan");
  if (deepBtn) deepBtn.disabled = false;
  const stagedBtn = $("btn-staged-scan");
  if (stagedBtn) stagedBtn.disabled = false;
  const waterBtn = $("btn-water-scan");
  if (waterBtn) waterBtn.disabled = false;
  const shapeBtn = $("btn-shape-scan");
  if (shapeBtn) shapeBtn.disabled = false;
  return { viewLabel, accepted, rejected, nRoom, nShaft, tunnels, metals };
}
// CSV panelinin erişebilmesi için global'e ata
window.__applySurface = applySurface;
window.__ensureViewer = async () => {
  const { ensureViewer } = await import("./viewer/scene.js");
  ensureViewer();
};
window.__focusCsv = (csvData, mapW, mapD) => {
  if (!state.camera || !state.controls) return;
  const dist = Math.max(mapW, mapD) * 1.2;
  state.camera.position.set(dist * 0.7, dist * 0.5, dist * 0.8);
  state.controls.target.set(0, 0, 0);
  state.controls.update();
};

let deepBaseSurface = null;

async function runDeepScan() {
  if (!state.surfaceState) {
    setStatus(t("status.analyzeFirst"));
    return;
  }
  const btn = $("btn-deep-scan");
  const undo = $("btn-deep-undo");
  try {
    btn.disabled = true;
    setStatus(t("msg.deepRunning"));
    logLine(t("msg.deepStart"), "info");
    startScanSweep();
    // Geri alma için temel yüzeyi sakla (deep sonucu değilse)
    deepBaseSurface = state.surfaceState;
    const res = await deepStructureScan();
    if (!res?.ok || !res.surface) {
      logLine(tPhrase(res?.message) || t("msg.deepNoSession"), "warn");
      setStatus(tPhrase(res?.message) || t("msg.deepFail"));
      deepBaseSurface = null;
      return;
    }
    const stats = applySurface(res.surface);
    logLine(
      t("msg.deepDone", {
        accepted: stats.accepted,
        rooms: stats.nRoom,
        shafts: stats.nShaft,
        tunnels: stats.tunnels.length,
        metals: stats.metals.length,
      }),
      "ok"
    );
    setStatus(tPhrase(res.message) || t("msg.deepOk"));
    if (undo) undo.hidden = false;
    if (focusBestValuableMetal(res.surface)) logLine(t("msg.metalFocus"), "ok");
  } catch (e) {
    setStatus(t("status.error", { e }));
    logLine(t("msg.deepErr", { e }), "err");
    deepBaseSurface = null;
  } finally {
    stopScanSweep();
    $("btn-deep-scan").disabled = !state.surfaceState;
  }
}

function undoDeepScan() {
  if (!deepBaseSurface) return;
  applySurface(deepBaseSurface, undefined, { resetKot: false });
  deepBaseSurface = null;
  const undo = $("btn-deep-undo");
  if (undo) undo.hidden = true;
  logLine(t("msg.deepUndo"), "info");
  setStatus(t("msg.deepUndoStatus"));
}

let stagedBaseSurface = null;

async function runStagedScan() {
  if (!state.surfaceState) {
    setStatus(t("status.analyzeFirst"));
    return;
  }
  const btn = $("btn-staged-scan");
  const undo = $("btn-staged-undo");
  try {
    btn.disabled = true;
    setStatus(t("msg.stagedRunning"));
    logLine(t("msg.stagedStart"), "info");
    startScanSweep();
    // Geri alma için temel yüzeyi sakla
    stagedBaseSurface = state.surfaceState;
    const res = await stagedDepthScan();
    if (!res?.ok || !res.surface) {
      logLine(tPhrase(res?.message) || t("msg.stagedNoSession"), "warn");
      setStatus(tPhrase(res?.message) || t("msg.stagedFail"));
      stagedBaseSurface = null;
      return;
    }
    const stats = applySurface(res.surface);
    const t1 = Number(res.tier1 ?? 0);
    const t2 = Number(res.tier2 ?? 0);
    logLine(t("msg.stagedIntel", { t1, t2 }), t1 + t2 > 0 ? "ok" : "warn");
    logLine(
      t("msg.stagedTotal", {
        accepted: stats.accepted,
        rooms: stats.nRoom,
        shafts: stats.nShaft,
        tunnels: stats.tunnels.length,
      }),
      "info"
    );
    setStatus(tPhrase(res.message) || t("msg.stagedOk"));
    if (undo) undo.hidden = false;
    if (focusBestValuableMetal(res.surface)) logLine(t("msg.metalFocus"), "ok");
  } catch (e) {
    setStatus(t("status.error", { e }));
    logLine(t("msg.stagedErr", { e }), "err");
    stagedBaseSurface = null;
  } finally {
    stopScanSweep();
    $("btn-staged-scan").disabled = !state.surfaceState;
  }
}

function undoStagedScan() {
  if (!stagedBaseSurface) return;
  applySurface(stagedBaseSurface, undefined, { resetKot: false });
  stagedBaseSurface = null;
  const undo = $("btn-staged-undo");
  if (undo) undo.hidden = true;
  logLine(t("msg.stagedUndo"), "info");
  setStatus(t("msg.stagedUndoStatus"));
}

let waterBaseSurface = null;

async function runWaterScan() {
  if (!state.surfaceState) {
    setStatus(t("status.analyzeFirst"));
    return;
  }
  const btn = $("btn-water-scan");
  const undo = $("btn-water-undo");
  try {
    btn.disabled = true;
    setStatus(t("msg.waterRunning"));
    logLine(t("msg.waterStart"), "info");
    startScanSweep();
    waterBaseSurface = state.surfaceState;
    const res = await waterBlueScan();
    if (!res?.ok || !res.surface) {
      logLine(tPhrase(res?.message) || t("msg.waterNoSession"), "warn");
      setStatus(tPhrase(res?.message) || t("msg.waterFail"));
      waterBaseSurface = null;
      return;
    }
    applySurface(res.surface);
    const n = Number(res.waterCount ?? res.water_count ?? 0);
    logLine(t("msg.waterIntel", { n }), n > 0 ? "ok" : "warn");
    setStatus(tPhrase(res.message) || t("msg.waterOk"));
    if (undo) undo.hidden = false;
  } catch (e) {
    setStatus(t("status.error", { e }));
    logLine(t("msg.waterErr", { e }), "err");
    waterBaseSurface = null;
  } finally {
    stopScanSweep();
    $("btn-water-scan").disabled = !state.surfaceState;
  }
}

function undoWaterScan() {
  if (!waterBaseSurface) return;
  applySurface(waterBaseSurface, undefined, { resetKot: false });
  waterBaseSurface = null;
  const undo = $("btn-water-undo");
  if (undo) undo.hidden = true;
  logLine(t("msg.waterUndo"), "info");
  setStatus(t("msg.waterUndoStatus"));
}

function syncPoolButtons() {
  const undo = $("btn-shape-undo");
  const drain = $("btn-shape-pool");
  const on = !!state.useFootprintShape;
  if (undo) undo.hidden = !on;
  if (drain) {
    drain.hidden = !on;
    drain.textContent = state.poolFilled !== false ? t("ops.poolDrain") : t("ops.poolFill");
  }
}

function runShapeScan() {
  if (!state.surfaceState) {
    setStatus(t("status.analyzeFirst"));
    return;
  }
  state.useFootprintShape = true;
  state.poolFilled = true;
  state.freeDrawBands = {};
  applySurface(state.surfaceState, undefined, { resetKot: false });
  syncPoolButtons();
  const n = Number(state.freeDrawGroup?.userData?.counts?.poolN || 0);
  const mid = Number(state.freeDrawGroup?.userData?.counts?.midN || 0);
  const walls = Number(state.freeDrawGroup?.userData?.counts?.wallN || 0);
  const reds = Number(state.freeDrawGroup?.userData?.counts?.redN || 0);
  const ct = Number(state.freeDrawGroup?.userData?.counts?.contactN || 0);
  logLine(t("msg.shapeIntel", { n, mid, walls, reds, ct }), "ok");
  setStatus(t("msg.shapeOk"));
}

function undoShapeScan() {
  state.useFootprintShape = false;
  state.poolFilled = true;
  state.freeDrawBands = {};
  if (state.surfaceState) {
    applySurface(state.surfaceState, undefined, { resetKot: false });
  }
  syncPoolButtons();
  logLine(t("msg.shapeUndo"), "info");
  setStatus(t("msg.shapeUndoStatus"));
}

function togglePoolFill() {
  if (!state.useFootprintShape) return;
  state.poolFilled = state.poolFilled === false;
  applyFreeDrawVisibility();
  syncPoolButtons();
  if (state.poolFilled) {
    logLine(t("msg.poolFilled"), "ok");
    setStatus(t("msg.poolFilled"));
  } else {
    logLine(t("msg.poolDrained"), "ok");
    setStatus(t("msg.poolDrained"));
  }
}

async function build3D() {
  if (!state.pendingFile) {
    setStatus(t("status.loadFirst"));
    logLine(t("msg.noFileReject"), "err");
    return;
  }
  try {
    setStatus(t("msg.computing"));
    $("btn-build-3d").disabled = true;
    const viewMode = selectedShotType();
    const targetKind = selectedTargetKind();
    const minConfidence = (Number($("min-confidence")?.value) || 45) / 100;
    const modeLabel = viewMode === "side" ? t("stats.side") : t("stats.top");
    const targetLabel = t("msg.targetBit", { label: targetKindLabel(targetKind) });
    logLine(t("msg.analyzeStart", { mode: modeLabel, target: targetLabel, thr: minConfidence.toFixed(2) }), "info");
    startScanSweep();

    const surface = await buildSurface3d({
      imageBase64: state.pendingFile.base64,
      fileName: state.pendingFile.name,
      lutStripPx: 24,
      minArea: 80,
      viewMode,
      minConfidence,
      targetKind,
      soilProfile: selectedSoilProfile(),
    });
    const stats = applySurface(surface, minConfidence, { resetKot: true, autoReport: true });
    // Yeni analiz → önceki derin tarama geri-al durumunu temizle
    deepBaseSurface = null;
    const undoBtn = $("btn-deep-undo");
    if (undoBtn) undoBtn.hidden = true;
    stagedBaseSurface = null;
    const stagedUndoBtn = $("btn-staged-undo");
    if (stagedUndoBtn) stagedUndoBtn.hidden = true;
    waterBaseSurface = null;
    const waterUndoBtn = $("btn-water-undo");
    if (waterUndoBtn) waterUndoBtn.hidden = true;
    state.useFootprintShape = false;
    state.poolFilled = true;
    state.freeDrawBands = {};
    const shapeUndoBtn = $("btn-shape-undo");
    if (shapeUndoBtn) shapeUndoBtn.hidden = true;
    const poolBtn = $("btn-shape-pool");
    if (poolBtn) poolBtn.hidden = true;
    logLine(
      t("msg.analyzeDone", {
        accepted: stats.accepted,
        rejected: stats.rejected,
        rooms: stats.nRoom,
        shafts: stats.nShaft,
        tunnels: stats.tunnels.length,
        metals: stats.metals.length,
      }),
      "ok"
    );
    logLine(t("msg.archived"), "ok");
    refreshArchiveList();
    if (stats.tunnels.length === 0 && targetKind === "well") {
      logLine(t("msg.wellHint"), "warn");
    }
    const gr = surface.structures?.geometryReport || surface.structures?.geometry_report || {};
    const meanSym = Number(gr.meanSymmetry ?? gr.mean_symmetry ?? 0);
    if (meanSym > 0) {
      logLine(
        t("msg.geoLine", {
          pct: (meanSym * 100).toFixed(0),
          hi: gr.highSymmetryCount ?? gr.high_symmetry_count ?? 0,
        }),
        "info"
      );
    }
    setStatus(t("msg.ready3d", { view: stats.viewLabel }));
    refreshDtaLink();
    if (focusBestValuableMetal(surface)) logLine(t("msg.metalFocus"), "ok");
  } catch (e) {
    setStatus(t("status.error", { e }));
    logLine(t("status.error", { e }), "err");
    console.error(e);
  } finally {
    stopScanSweep();
    $("btn-build-3d").disabled = !state.pendingFile;
  }
}

function updateCompactMarks(surface) {
  // Compact preview — tam özellikli 2D harita: yapı noktaları + etiketler + derinlik skalası
  const img = $("preview-compact");
  const canvas = $("preview-marks-compact");
  if (!img || !canvas || !surface || !img.naturalWidth) return;

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w < 8 || h < 8) return;

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  const s = surface.structures || {};
  const marks = [];
  let idx = 1;
  (s.chambers || []).forEach(c => marks.push({ x: Number(c.cx), y: Number(c.cy), kind: "void", label: `Oda ${idx++}`, depth: c.depth || 0 }));
  (s.tunnels || []).forEach(t => marks.push({ x: (Number(t.x0) + Number(t.x1)) * 0.5, y: (Number(t.y0) + Number(t.y1)) * 0.5, kind: "tunnel", label: `Tünel ${idx++}`, depth: t.depth || 0 }));
  (s.metals || []).forEach(m => marks.push({ x: Number(m.cx), y: Number(m.cy), kind: "metal", label: `Metal ${idx++}`, depth: m.depth || 0 }));

  // Renk haritası
  const colors = { void: "#3aa8ff", tunnel: "#4ec0d4", metal: "#e23a3a" };
  const r = Math.max(4, Math.min(w, h) * 0.018);
  const fontSize = Math.max(10, Math.min(w, h) * 0.025);
  ctx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`;

  marks.forEach(m => {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    const px = Math.min(1, Math.max(0, m.x)) * w;
    const py = Math.min(1, Math.max(0, m.y)) * h;
    const color = colors[m.kind] || "#3aa8ff";

    // Dış halka (gölge)
    ctx.beginPath();
    ctx.arc(px, py, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fill();

    // Ana nokta
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Etiket
    if (m.label) {
      const text = m.depth > 0 ? `${m.label} · ${Math.round(m.depth)}m` : m.label;
      const tw = ctx.measureText(text).width;
      const lx = px + r + 4;
      const ly = py - fontSize * 0.3;
      // Arka plan
      ctx.fillStyle = "rgba(5,8,12,0.85)";
      ctx.fillRect(lx - 2, ly - fontSize + 2, tw + 6, fontSize + 4);
      // Kenarlık
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(lx - 2, ly - fontSize + 2, tw + 6, fontSize + 4);
      // Metin
      ctx.fillStyle = color;
      ctx.fillText(text, lx + 1, ly);
    }
  });

  // Derinlik skalası (sol kenar)
  const maxDepth = Math.max(...marks.map(m => m.depth || 0), 10);
  const scaleY = h * 0.7;
  const startY = h * 0.15;
  const barW = 6;
  const barX = w - 22;

  // Skala arka planı
  ctx.fillStyle = "rgba(5,8,12,0.8)";
  ctx.fillRect(barX - 16, startY - 4, 22, scaleY + 12);

  // Gradyan çiz
  const grad = ctx.createLinearGradient(0, startY, 0, startY + scaleY);
  grad.addColorStop(0, "#3edc8c");
  grad.addColorStop(0.5, "#eab308");
  grad.addColorStop(1, "#e23a3a");
  ctx.fillStyle = grad;
  ctx.fillRect(barX, startY, barW, scaleY);

  // Etiketler
  ctx.fillStyle = "rgba(230,237,242,0.7)";
  ctx.font = `${Math.max(8, fontSize * 0.7)}px 'Segoe UI', sans-serif`;
  const depthSteps = [0, Math.round(maxDepth / 2), Math.round(maxDepth)];
  depthSteps.forEach((d, i) => {
    const y = startY + (i / 2) * scaleY;
    ctx.fillText(`${d}m`, barX - 14, y + 4);
  });
}

function refreshMeshSettings() {
    if (!state.surfaceState) return;
    const vertExag = (Number($("z-scale").value) || 10) / 10;
    const wire = $("wireframe").value === "1";
    const depScale = (Number($("depression-scale")?.value) || 10) / 10;
    buildMesh(state.surfaceState, vertExag, wire, depScale);
    // Heatmap opacity'yi yeniden uygula (buildMesh sıfırlayabilir)
    const heatOpEl2 = $("heatmap-opacity");
    if (heatOpEl2) {
      const pct = (Number(heatOpEl2.value) || 82) / 100;
      if (state.groundPlane?.material) {
        state.groundPlane.material.opacity = pct;
        state.groundPlane.material.needsUpdate = true;
      }
      if (state.csvOverlay) {
        state.csvOverlay.traverse(obj => {
          if (obj.isMesh && obj.material && obj.material.transparent) {
            obj.material.opacity = pct;
            obj.material.needsUpdate = true;
          }
        });
      }
    }
  logLine(
    t("msg.viewChange", {
      exag: vertExag.toFixed(1),
      wire: wire ? t("msg.wireOn") : t("msg.wireOff"),
    }),
    "info"
  );
}

async function bindDtaGuide() {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen("dta-guide", (event) => {
      const payload = event.payload || {};
      const surface = payload.surface;
      if (!surface) {
        logLine(tPhrase(payload.message) || t("msg.dtaHints"), "info");
        refreshDtaLink();
        refreshMapHintsPanel();
        return;
      }
      const stats = applySurface(surface);
      const n = payload.hintCount ?? 0;
      logLine(
        t("msg.dtaGuided", {
          n,
          accepted: stats.accepted,
          rooms: stats.nRoom,
          tunnels: stats.tunnels.length,
        }),
        "ok"
      );
      setStatus(tPhrase(payload.message) || t("msg.dtaUpdated", { view: stats.viewLabel }));
      refreshMapHintsPanel();
      applyDtaLinkStatus({
        state: "linked",
        label: t("msg.dtaLinked", { n }),
        bridgeListening: true,
        hasSession: true,
        lastHintCount: n,
      });
    });
    await listen("dta-bridge", () => {
      refreshDtaLink();
    });
    logLine(t("msg.dtaBridge"), "info");
  } catch (e) {
    console.warn("DTA guide listen:", e);
  }
}

$("btn-browse").addEventListener("click", openNativeFileDialog);
$("btn-build-3d").addEventListener("click", build3D);
$("btn-deep-scan").addEventListener("click", runDeepScan);
$("btn-deep-undo").addEventListener("click", undoDeepScan);
$("btn-staged-scan").addEventListener("click", runStagedScan);
$("btn-staged-undo").addEventListener("click", undoStagedScan);
$("btn-water-scan").addEventListener("click", runWaterScan);
$("btn-water-undo").addEventListener("click", undoWaterScan);
$("btn-shape-scan").addEventListener("click", runShapeScan);
$("btn-shape-undo").addEventListener("click", undoShapeScan);
$("btn-shape-pool")?.addEventListener("click", togglePoolFill);

  // ── Çift Analiz Paketi Kontrolleri ──
  const dualToggle = $("dual-toggle");
  const dualModuleList = $("dual-module-list");
  const dualBadge = $("dual-pack-badge");
  const dualReport = $("dual-pack-report");

  if (dualToggle) {
    dualToggle.addEventListener("change", () => {
      const enabled = dualToggle.checked;
      if (dualModuleList) dualModuleList.style.display = enabled ? "block" : "none";
      if (dualBadge) dualBadge.style.display = enabled ? "inline" : "none";

      const overrides = {
        feedbackLoop: $("dual-mod-feedback")?.checked ?? true,
        consensusVisuals: $("dual-mod-consensus")?.checked ?? true,
        unifiedConfidence: $("dual-mod-confidence")?.checked ?? true,
        geometricCompare: $("dual-mod-geometric")?.checked ?? true,
        fusionDetection: $("dual-mod-fusion")?.checked ?? true,
      };
      enableDualAnalysis(enabled, overrides);
    });
  }

  // Modül bazlı açma/kapama
  ["feedback", "consensus", "confidence", "geometric", "fusion"].forEach(mod => {
    const el = $(`dual-mod-${mod}`);
    if (!el) return;
    el.addEventListener("change", () => {
      const moduleMap = {
        feedback: "feedbackLoop",
        consensus: "consensusVisuals",
        confidence: "unifiedConfidence",
        geometric: "geometricCompare",
        fusion: "fusionDetection",
      };
      setModuleEnabled(moduleMap[mod], el.checked);
    });
  });
$("btn-analysis-report")?.addEventListener("click", toggleAnalysisPanel);
  $("btn-export-report")?.addEventListener("click", exportReport);
  $("btn-export-png")?.addEventListener("click", exportSceneImage);
  $("btn-export-kml")?.addEventListener("click", exportToKml);
  $("btn-undo")?.addEventListener("click", () => {
    const entry = undo();
    if (entry) {
      applyUndoEntry(entry, false);
      setStatus(`Geri alındı: ${entry.label}`);
    }
  });
  $("btn-redo")?.addEventListener("click", () => {
    const entry = redo();
    if (entry) {
      applyUndoEntry(entry, true);
      setStatus(`İleri alındı: ${entry.label}`);
    }
  });
  // ── Zaman Serisi Kontrolleri ──
  function refreshTsSessionList() {
    const sessions = getSessionList();
    const countBadge = $("ts-session-count");
    if (countBadge) {
      countBadge.textContent = sessions.length;
      countBadge.style.display = sessions.length > 0 ? '' : 'none';
    }
    const listEl = $("ts-session-list");
    if (listEl) {
      listEl.innerHTML = sessions.map((s, i) =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.15rem 0;border-bottom:1px solid var(--line);">
          <span>${s.label}</span>
          <span style="color:var(--muted);">${s.structureCount} yapı</span>
        </div>`
      ).join('') || '<span>Kayıtlı oturum yok</span>';
    }
    // Select'leri güncelle
    ["ts-select-a", "ts-select-b"].forEach(id => {
      const sel = $(id);
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = '<option value="">— Seçin —</option>' +
        sessions.map((s, i) => `<option value="${i}">${s.label}</option>`).join('');
      sel.value = prev;
    });
    // Karşılaştır butonunu güncelle
    const compareBtn = $("ts-compare");
    if (compareBtn) {
      compareBtn.disabled = sessions.length < 2;
    }
  }

  $("ts-save")?.addEventListener("click", () => {
    const label = prompt('Oturum adı:', new Date().toLocaleDateString('tr-TR'));
    if (label === null) return;
    saveSession(label || new Date().toLocaleDateString('tr-TR'));
    refreshTsSessionList();
  });

  $("ts-compare")?.addEventListener("click", () => {
    const a = Number($("ts-select-a")?.value);
    const b = Number($("ts-select-b")?.value);
    if (isNaN(a) || isNaN(b) || a === b) {
      alert('İki farklı oturum seçin.');
      return;
    }
    const diff = compareSessions(a, b);
    const resultEl = $("ts-result");
    if (resultEl && diff) {
      resultEl.style.display = '';
      resultEl.innerHTML = formatComparisonHTML(diff);
    }
  });

  $("btn-route-planner")?.addEventListener("click", async () => {
    const mod = await import("./viewer/routePlanner.js");
    mod.setActive(!mod.isActive());
  });
  $("btn-compare")?.addEventListener("click", toggleCompare);  $("z-scale").addEventListener("input", refreshMeshSettings);
  $("wireframe").addEventListener("change", refreshMeshSettings);
  // İçe çökme slider'ı
  const depSlider = $("depression-scale");
  const depLabel = $("depression-scale-label");
  if (depSlider) {
    depSlider.addEventListener("input", () => {
      const val = (Number(depSlider.value) || 10) / 10;
      if (depLabel) depLabel.textContent = val.toFixed(1) + '×';
      refreshMeshSettings();
    });
  }
  // Kesit (clipping) modu: zemini yatay düzlemle kes
  const clipToggle = $("clip-enabled");
  const clipSlider = $("clip-height");
  const clipLabel = $("clip-height-label");
  clipToggle?.addEventListener("change", () => {
    pushState('clip-toggle', { enabled: !!clipToggle.checked, height: Number(clipSlider?.value) || 0 });
    if (clipSlider) clipSlider.disabled = !clipToggle.checked;
    setClipEnabled(clipToggle?.checked);
  });
  clipSlider?.addEventListener("input", () => {
    const v = Number(clipSlider.value) || 0;
    if (clipLabel) clipLabel.textContent = `${v} m`;
    setClipHeight(v);
  });
  // X-Ray / fresnel görünümü
  $("xray-toggle")?.addEventListener("change", (e) => {
    pushState('xray-toggle', { enabled: !!e.target?.checked });
    setXray(e.target?.checked);
  });
  // 🎨 Renklendirme paleti (colorizer.js — modüler, silinebilir)
  bindColorizer();
  bindColorizerCycle();
  // 🎨 Renk-bazlı analiz tekrarı — renk değişince analizi tekrar çalıştır
  initColorAnalysis();
  let _lastAnalysisFn = null; // son analiz fonksiyonu referansı
  // Otomatik tekrar analiz bayrağı + debounce
  let _autoReanalyze = false;
  let _autoReanalyzeTimer = null;

  // "Otomatik" checkbox bağla
  const autoCheckEl = $("color-auto-reanalyze");
  if (autoCheckEl) {
    autoCheckEl.addEventListener("change", () => {
      _autoReanalyze = !!autoCheckEl.checked;
      console.log(`[ColorAnalysis] Otomatik mod: ${_autoReanalyze ? "açık" : "kapalı"}`);
    });
  }

  onPaletteChange(async (newKey, oldKey) => {
    const statusEl = $("color-analysis-status");

    // Yapı renklerini güncelle
    if (newKey === "none") {
      resetStructureColors();
      // Orijinale dön — önbellekten yükle
      const cached = getCacheStatus().keys.includes("none");
      console.log(`[ColorAnalysis] none moduna dönüldü (önbellek: ${cached})`);
      // Karşılaştırmayı gizle
      const compareEl = $("color-compare-result");
      if (compareEl) compareEl.style.display = "none";
      if (statusEl) statusEl.innerHTML = renderCacheStatusHTML();
      return;
    }
    // Yapı renklerini şemaya göre ayarla
    applyStructureColors(newKey);

    if (statusEl) statusEl.innerHTML = renderCacheStatusHTML();

    // Otomatik mod açıksa ve analiz fonksiyonu kayıtlıysa
    if (_autoReanalyze) {
      const fn = _lastAnalysisFn || getAnalysisFunction();
      if (!fn) {
        console.log("[ColorAnalysis] Otomatik analiz için fonksiyon yok");
        return;
      }
      // Debounce — 500ms bekle
      if (_autoReanalyzeTimer) clearTimeout(_autoReanalyzeTimer);
      _autoReanalyzeTimer = setTimeout(async () => {
        setStatus(`🔄 Otomatik analiz: ${newKey}...`);
        const newResult = await reanalyzeWithColor(newKey, fn);
        if (statusEl) statusEl.innerHTML = renderCacheStatusHTML();
        // Karşılaştır
        if (newResult) {
          const orig = getOriginalResult();
          if (orig) {
            const diff = compareResults(orig, newResult);
            const compareEl = $("color-compare-result");
            if (compareEl) {
              compareEl.innerHTML = formatComparison(diff, newKey);
              compareEl.style.display = "block";
            }
          }
        }
        setStatus(`✅ Otomatik analiz tamamlandı: ${newKey}`);
      }, 500);
    }
  });
  // "Tekrar Analiz" butonu
  $("btn-color-reanalyze")?.addEventListener("click", async () => {
    const fn = _lastAnalysisFn || getAnalysisFunction();
    if (!fn) {
      setStatus("Analiz fonksiyonu henüz bağlanmadı — önce analiz çalıştırın");
      return;
    }
    const pal = state.colorizerMode || "none";
    setStatus(`"${pal}" şemasıyla yeniden analiz ediliyor...`);
    const newResult = await reanalyzeWithColor(pal, fn);
    const statusEl = $("color-analysis-status");
    if (statusEl) statusEl.innerHTML = renderCacheStatusHTML();
    // Karşılaştırma göster
    if (newResult && pal !== "none") {
      const orig = getOriginalResult();
      if (orig) {
        const diff = compareResults(orig, newResult);
        const compareEl = $("color-compare-result");
        if (compareEl) {
          compareEl.innerHTML = formatComparison(diff, pal);
          compareEl.style.display = "block";
        }
      }
    }
  });
  // "Önbelleği Temizle" butonu
  $("btn-color-clear-cache")?.addEventListener("click", () => {
    clearCache();
    setStatus("Renk analiz önbelleği temizlendi");
    const statusEl = $("color-analysis-status");
    if (statusEl) statusEl.innerHTML = renderCacheStatusHTML();
  });
  // Klavye kısayolları (K kesit · X X-Ray · ↑/↓ yükseklik)
  bindViewerKeys();

  // ── Undo/Redo Kısayolları ──
  function updateUndoRedoUI() {
    const undoBtn = $("btn-undo");
    const redoBtn = $("btn-redo");
    if (undoBtn) {
      undoBtn.disabled = !canUndo();
      undoBtn.style.opacity = canUndo() ? '1' : '0.4';
    }
    if (redoBtn) {
      redoBtn.disabled = !canRedo();
      redoBtn.style.opacity = canRedo() ? '1' : '0.4';
    }
  }
  onHistoryChange(updateUndoRedoUI);
  updateUndoRedoUI();

  document.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      const entry = undo();
      if (entry) {
        applyUndoEntry(entry);
        setStatus(`Geri alındı: ${entry.label}`);
      }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      const entry = redo();
      if (entry) {
        applyUndoEntry(entry, true);
        setStatus(`İleri alındı: ${entry.label}`);
      }
    }
  });

  // ── Undo/Redo Yardımcı Fonksiyonu ──
  function applyUndoEntry(entry, isRedo = false) {
    if (entry.label === 'alignment') {
      Object.assign(state.csvAlignment, entry.data);
      rebuildCsvIfNeeded();
      updateAlignSliderLabels();
      const a = state.csvAlignment;
      const angSlider = $("align-angle"); if (angSlider) angSlider.value = a.rotation;
      const sxSlider = $("align-scalex"); if (sxSlider) sxSlider.value = a.scaleX;
      const szSlider = $("align-scalez"); if (szSlider) szSlider.value = a.scaleZ;
      const oxSlider = $("align-offsetx"); if (oxSlider) oxSlider.value = a.offsetX;
      const ozSlider = $("align-offsetz"); if (ozSlider) ozSlider.value = a.offsetZ;
    } else if (entry.label === 'color-change') {
      applyColorizer(isRedo ? entry.data.next : entry.data.prev);
    } else if (entry.label === 'clip-toggle') {
      const ct = $("clip-enabled");
      if (ct) ct.checked = entry.data.enabled;
      setClipEnabled(entry.data.enabled);
    } else if (entry.label === 'clip-height') {
      setClipHeight(entry.data.height);
    } else if (entry.label === 'xray-toggle') {
      const xt = $("xray-toggle");
      if (xt) xt.checked = entry.data.enabled;
      setXray(entry.data.enabled);
    }
  }

  // Heatmap şeffaflık slider'ı — hem DTA ground hem CSV heatmap'i kontrol eder
  const heatOpEl = $("heatmap-opacity");
  const heatOpLabel = $("heatmap-opacity-label");
  if (heatOpEl) {
    const syncHeatmapOpacity = () => {
      const pct = Number(heatOpEl.value) || 82;
      if (heatOpLabel) heatOpLabel.textContent = pct + '%';
      // DTA ground plane
      if (state.groundPlane?.material) {
        state.groundPlane.material.opacity = pct / 100;
        state.groundPlane.material.needsUpdate = true;
      }
      // CSV heatmap group
      if (state.csvOverlay) {
        state.csvOverlay.traverse(obj => {
          if (obj.isMesh && obj.material && obj.material.transparent) {
            obj.material.opacity = pct / 100;
            obj.material.needsUpdate = true;
          }
        });
      }
    };
    heatOpEl.addEventListener('input', syncHeatmapOpacity);
    syncHeatmapOpacity();
  }
const minConfEl = $("min-confidence");
const minConfLabel = $("min-confidence-label");
if (minConfEl && minConfLabel) {
  const syncConf = () => {
    minConfLabel.textContent = ((Number(minConfEl.value) || 45) / 100).toFixed(2);
  };
  minConfEl.addEventListener("input", syncConf);
  syncConf();
}
document.querySelectorAll('input[name="shot-type"]').forEach((el) => {
  el.addEventListener("change", () => {
    updateShotHint();
    logLine(
      t("msg.shotLog", { mode: selectedShotType() === "side" ? t("msg.shotSide") : t("msg.shotTop") }),
      "info"
    );
  });
});
document.querySelectorAll('input[name="target-kind"]').forEach((el) => {
  el.addEventListener("change", () => {
    updateShotHint();
    logLine(t("msg.targetLog", { label: targetKindLabel() }), "info");
  });
});
updateShotHint();
// ── Derinlik Profili Kesiti ──
const depthCanvas = $("depth-profile-canvas");
if (depthCanvas) {
  initDepthProfile(depthCanvas);
  const btnH = $("btn-depth-profile-h");
  const btnV = $("btn-depth-profile-v");
  const infoEl = $("depth-profile-info");
  const setMode = (m) => {
    setProfileMode(m);
    if (btnH) btnH.classList.toggle("active", m === "horizontal");
    if (btnV) btnV.classList.toggle("active", m === "vertical");
  };
  if (btnH) btnH.addEventListener("click", () => setMode("horizontal"));
  if (btnV) btnV.addEventListener("click", () => setMode("vertical"));

  // 3D sahne üzerinde tıklama ile kesit noktası seç
  const viewerEl = document.getElementById("viewer");
  if (viewerEl) {
    const canvas3d = viewerEl.querySelector("canvas");
    if (canvas3d) {
      canvas3d.addEventListener("click", async (e) => {
        if (!state.camera || !state.scene) return;
        const rect = canvas3d.getBoundingClientRect();
        const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const THREE = await import("three");
        const rc = new THREE.Raycaster();
        const mouse = new THREE.Vector2(mx, my);
        rc.setFromCamera(mouse, state.camera);
        const hits = rc.intersectObjects(state.scene.children, true);
        if (hits && hits.length > 0) {
          const pt = hits[0].point;
          const grid = state.csvOverlay?.userData?.csvPoints
            || state.lastAnalysisResult?.fusionGrid
            || [];
          const poolEl = $("csv-pool-size");
          const pool = poolEl ? (Number(poolEl.value) || 30) : 30;
          drawProfile(grid, { x: pt.x, z: pt.z }, getProfileMode(), { poolSizeM: pool, gridRes: 64 });
          if (infoEl) infoEl.textContent = `Nokta: (${pt.x.toFixed(1)}, ${pt.z.toFixed(1)}) — ${getProfileMode() === "horizontal" ? "Yatay" : "Dikey"} kesit`;
        }
      });
    }
  }
}
// 3D ipuçları aç/kapa — tercih kayıtlı ayarlarda saklanır (yeniden başlasa da hatırlanır)
const hintsToggle = $("hints-3d-visible");
if (hintsToggle) {
  hintsToggle.addEventListener("change", async () => {
    const on = hintsToggle.checked;
    setHintsVisible(on);
    logLine(on ? t("msg.hintsShow") : t("msg.hintsHide"), "info");
    try {
      await setHints3dVisible(on);
    } catch (e) {
      console.warn("hints visibility setting:", e);
    }
  });
  // Başlangıç: kayıtlı tercihi uygula
  (async () => {
    try {
      const s = await getAppSettings();
      const on = s?.hints3dVisible ?? s?.hints_3d_visible;
      if (on != null) {
        hintsToggle.checked = !!on;
        setHintsVisible(!!on);
      }
    } catch (e) {
      console.warn("hints visibility load:", e);
    }
  })();
}
bindMapRuler();
bindRoutePlanner();
bindCompareMode();
bindAnnotations();
bindArchiveApply(applySurface);
bindFreeDrawPanel();
bindCsvPanel();

// ── Hizalama Kontrolleri ──
function rebuildCsvIfNeeded() {
  if (!state.csvData) return;
  import("./viewer/csvOverlay.js").then(({ addCsvOverlayToScene, renderCsvHeatmap }) => {
    addCsvOverlayToScene(state.csvData, {
      poolSizeM: Number(($("csv-pool-size") || {}).value) || 30,
      fitFactor: (Number(($("csv-fit") || {}).value) || 85) / 100,
      gridRes: Number(($("csv-grid-res") || {}).value) || 32,
      sigma: Number(($("csv-sigma") || {}).value) || 2,
      slice: Number(($("csv-depth-slice") || {}).value) || 0,
      sliceCount: Number(($("csv-slice-count") || {}).value) || 8,
      threshold: Number(($("csv-threshold") || {}).value) || 0.9,
      minStrength: Number(($("csv-min-strength") || {}).value) || 0.45,
      undergroundOnly: ($("csv-underground-filter") || {}).checked !== false,
      structures: state.csvStructures,
      surface: state.surface,
    });
    renderCsvHeatmap(state.csvData);
  }).catch(() => {});
}

function updateAlignSliderLabels() {
  const a = state.csvAlignment || {};
  const angEl = $("align-angle-label");
  if (angEl) angEl.textContent = (a.rotation || 0) + "°";
  const sxEl = $("align-scalex-label");
  if (sxEl) sxEl.textContent = (a.scaleX || 1).toFixed(2);
  const szEl = $("align-scalez-label");
  if (szEl) szEl.textContent = (a.scaleZ || 1).toFixed(2);
  const oxEl = $("align-offsetx-label");
  if (oxEl) oxEl.textContent = (a.offsetX || 0).toFixed(1) + "m";
  const ozEl = $("align-offsetz-label");
  if (ozEl) ozEl.textContent = (a.offsetZ || 0).toFixed(1) + "m";
  const statusEl = $("align-status");
  if (statusEl) statusEl.textContent = getAlignmentStatus();
}

// Döndürme butonları
$("align-90")?.addEventListener("click", () => { setRotation(90); rebuildCsvIfNeeded(); updateAlignSliderLabels(); });
$("align-180")?.addEventListener("click", () => { setRotation(180); rebuildCsvIfNeeded(); updateAlignSliderLabels(); });
$("align-270")?.addEventListener("click", () => { setRotation(270); rebuildCsvIfNeeded(); updateAlignSliderLabels(); });
// Ters çevirme butonları
$("align-flip-x")?.addEventListener("click", () => { toggleFlipX(); rebuildCsvIfNeeded(); updateAlignSliderLabels(); });
$("align-flip-z")?.addEventListener("click", () => { toggleFlipZ(); rebuildCsvIfNeeded(); updateAlignSliderLabels(); });
// Serbest açı sliderı
$("align-angle")?.addEventListener("input", (e) => {
  setRotationFree(Number(e.target.value));
  rebuildCsvIfNeeded();
  updateAlignSliderLabels();
});
// Ölçek sliderları
$("align-scalex")?.addEventListener("input", (e) => {
  const sz = Number(($("align-scalez") || {}).value) || 1;
  setScale(Number(e.target.value), sz);
  rebuildCsvIfNeeded();
  updateAlignSliderLabels();
});
$("align-scalez")?.addEventListener("input", (e) => {
  const sx = Number(($("align-scalex") || {}).value) || 1;
  setScale(sx, Number(e.target.value));
  rebuildCsvIfNeeded();
  updateAlignSliderLabels();
});
// Kaydırma sliderları
$("align-offsetx")?.addEventListener("input", (e) => {
  const oz = Number(($("align-offsetz") || {}).value) || 0;
  setOffset(Number(e.target.value), oz);
  rebuildCsvIfNeeded();
  updateAlignSliderLabels();
});
$("align-offsetz")?.addEventListener("input", (e) => {
  const ox = Number(($("align-offsetx") || {}).value) || 0;
  setOffset(ox, Number(e.target.value));
  rebuildCsvIfNeeded();
  updateAlignSliderLabels();
});
// Otomatik sığdırma
$("align-auto-fit")?.addEventListener("click", () => {
  if (!state.csvData) return;
  const bounds = state.csvData.bounds;
  const poolSize = Number(($("csv-pool-size") || {}).value) || 30;
  autoFit(bounds, poolSize, (Number(($("csv-fit") || {}).value) || 85) / 100);
  rebuildCsvIfNeeded();
  updateAlignSliderLabels();
  // Slider'ları güncelle
  const a = state.csvAlignment;
  const angSlider = $("align-angle"); if (angSlider) angSlider.value = a.rotation;
  const sxSlider = $("align-scalex"); if (sxSlider) sxSlider.value = a.scaleX;
  const szSlider = $("align-scalez"); if (szSlider) szSlider.value = a.scaleZ;
});
// Sıfırla
$("align-reset")?.addEventListener("click", () => {
  resetAlignment();
  rebuildCsvIfNeeded();
  updateAlignSliderLabels();
  // Slider'ları sıfırla
  const angSlider = $("align-angle"); if (angSlider) angSlider.value = 0;
  const sxSlider = $("align-scalex"); if (sxSlider) sxSlider.value = 1;
  const szSlider = $("align-scalez"); if (szSlider) szSlider.value = 1;
  const oxSlider = $("align-offsetx"); if (oxSlider) oxSlider.value = 0;
  const ozSlider = $("align-offsetz"); if (ozSlider) ozSlider.value = 0;
});

// ── Karşılaştırma Kontrolleri ──
function updateCompareUI() {
  const st = $("compare-status");
  if (st) {
    st.textContent = compareMode.enabled ? `Aktif: ${compareMode.type}` : 'Kapali';
    st.style.color = compareMode.enabled ? '#3edc8c' : '';
  }
  // Buton vurguları
  ['compare-split','compare-blend','compare-grid','compare-off'].forEach(id => {
    const btn = $(id);
    if (btn) btn.style.borderColor = '';
  });
  if (compareMode.enabled) {
    const activeBtn = $(`compare-${compareMode.type}`);
    if (activeBtn) activeBtn.style.borderColor = '#3edc8c';
  }
}

$("compare-split")?.addEventListener("click", () => {
  setCompareMode('split'); rebuildCsvIfNeeded(); updateCompareUI();
});
$("compare-blend")?.addEventListener("click", () => {
  setCompareMode('blend'); rebuildCsvIfNeeded(); updateCompareUI();
});
$("compare-grid")?.addEventListener("click", () => {
  setCompareMode('grid'); rebuildCsvIfNeeded(); updateCompareUI();
});
$("compare-off")?.addEventListener("click", () => {
  setCompareMode(null); rebuildCsvIfNeeded(); updateCompareUI();
});
$("compare-opacity")?.addEventListener("input", (e) => {
  setBlendOpacity(Number(e.target.value) / 100);
  $("compare-opacity-label").textContent = e.target.value + '%';
  rebuildCsvIfNeeded();
});
$("compare-split-slider")?.addEventListener("input", (e) => {
  setSplitPos(Number(e.target.value) / 100);
  $("compare-split-label").textContent = e.target.value + '%';
  rebuildCsvIfNeeded();
});

// ── DEBUG: Start-up button state ──
console.log('[STARTUP] === ALL CSV BUTTONS ===');
['btn-csv-pick','btn-csv-build','btn-csv-toggle'].forEach(id => {
  const el = document.getElementById(id);
  console.log(`[STARTUP] ${id}: exists=${!!el} disabled=${el?.disabled} display=${el ? getComputedStyle(el).display : 'N/A'}`);
});
console.log('[STARTUP] csvData=', !!state.csvData, 'csvOverlay=', !!state.csvOverlay, 'scene=', !!state.scene);
bindStructureKotApply((id, kotM) => {
  if (!state.surfaceState) return;
  refreshMeshSettings();
  logLine(t("msg.kotLog", { id, sign: kotM >= 0 ? "+" : "", m: kotM.toFixed(1) }), "ok");
  setStatus(t("msg.kotStatus", { id, sign: kotM >= 0 ? "+" : "", m: kotM.toFixed(1) }));
  renderStructureList(state.surfaceState);
});
bindMapHintsPanel({
  onSurface: (surface) => applySurface(surface),
  onLog: (msg, kind) => {
    logLine(msg, kind || "info");
    setStatus(msg);
  },
});
bindArchiveUi();
refreshMapHintsPanel();
startUpdateMonitor();
bindDtaGuide();
startDtaLinkMonitor();
startSoilMonitor();
startThroughRedMonitor({
  onSurface: (surface) => applySurface(surface),
});
startProbEngineMonitor();

// ── Manyetik Zemin Haritası Kontrolleri ──
import("./viewer/groundMagneticOverlay.js").then((mod) => {
  const chk = document.getElementById("mag-ground-toggle");
  const slider = document.getElementById("mag-ground-opacity");
  const valLabel = document.getElementById("mag-ground-opacity-val");
  const opRow = document.getElementById("mag-ground-opacity-row");
  if (chk) {
    chk.addEventListener("change", () => {
      const on = chk.checked;
      mod.toggleMagneticGround(on);
      if (opRow) opRow.style.display = on ? "flex" : "none";
      // CSV yüklüyse yeniden oluştur
      if (on && state.csvOverlay) {
        mod.updateGroundMagneticOverlay(state.csvOverlay, state.surface || state.surfaceState);
      }
    });
  }
  if (slider) {
    slider.addEventListener("input", () => {
      const v = Number(slider.value) / 100;
      mod.setMagneticOverlayOpacity(v);
      if (valLabel) valLabel.textContent = slider.value + "%";
    });
  }
  // CSV yüklendiğinde kontrolleri göster
  const origShow = mod.updateGroundMagneticOverlay;
  const origRemove = mod.removeGroundMagneticOverlay;
  const ctrlEl = document.getElementById("mag-ground-controls");
  if (ctrlEl) {
    // CSV yüklendiğinde göster, kaldırınd gizle
    const observer = new MutationObserver(() => {
      if (state.csvOverlay) ctrlEl.style.display = "block";
      else ctrlEl.style.display = "none";
    });
    // Basit polling — state.csvOverlay değişimi için
    const checkCsv = setInterval(() => {
      const hasCsv = !!state.csvOverlay;
      if (ctrlEl.style.display !== (hasCsv ? "block" : "none")) {
        ctrlEl.style.display = hasCsv ? "block" : "none";
      }
    }, 1000);
    // Cleanup için sayfadan ayrılınca
    window.addEventListener("beforeunload", () => clearInterval(checkCsv));
  }
}).catch(() => {});

// ── GPS Koordinat Desteği ──
import("./viewer/gpsTransform.js").then((gpsMod) => {
  const btnSet = document.getElementById("btn-gps-set");
  const btnClear = document.getElementById("btn-gps-clear");
  const latInput = document.getElementById("gps-lat");
  const lonInput = document.getElementById("gps-lon");
  const localXInput = document.getElementById("gps-local-x");
  const localZInput = document.getElementById("gps-local-z");
  const statusEl = document.getElementById("gps-status");
  const resultEl = document.getElementById("gps-result");

  function updateGpsStatus() {
    const s = gpsMod.getGpsState();
    if (s.active) {
      statusEl.innerHTML = `✅ Referans aktif: <b>${s.gpsRef.lat.toFixed(6)}°N, ${s.gpsRef.lon.toFixed(6)}°E</b>`;
      statusEl.style.color = "#3edc8c";
    } else {
      statusEl.innerHTML = "⚠ GPS referansı ayarlanmadı";
      statusEl.style.color = "#e85858";
    }
  }

  if (btnSet) {
    btnSet.addEventListener("click", () => {
      const lat = parseFloat(latInput?.value);
      const lon = parseFloat(lonInput?.value);
      if (isNaN(lat) || isNaN(lon)) {
        statusEl.innerHTML = "❌ Geçerli enlem/boylam girin";
        statusEl.style.color = "#e85858";
        return;
      }
      const localX = parseFloat(localXInput?.value) || 0;
      const localZ = parseFloat(localZInput?.value) || 0;
      gpsMod.setGpsReference({ lat, lon }, { x: localX, z: localZ });
      window.__gpsMod = gpsMod;
      updateGpsStatus();
      // Sonuç göster
      if (resultEl) {
        resultEl.style.display = "block";
        const testLocal = gpsMod.localToGps(localX, localZ);
        const dms = gpsMod.toDMS;
        resultEl.innerHTML = [
          `📍 <b>${dms(lat, 'lat')}, ${dms(lon, 'lon')}</b>`,
          `Lokal: X=${localX}m, Z=${localZ}m`,
          `Google Maps: <a href="${gpsMod.googleMapsUrl(lat, lon)}" target="_blank" style="color:#7ec8e8;"> Aç</a>`,
        ].join("<br>");
      }
    });
  }
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      gpsMod.clearGpsReference();
      updateGpsStatus();
      if (resultEl) resultEl.style.display = "none";
    });
  }
}).catch(() => {});

// Tree section animasyonlu açılış/kapanış
initTreeAnimations();

// Touch cihazlarda panel scroll iyileştirmesi
initTouchScroll();

const dropzone = $("dropzone");
// Sadece butona tıklayınca dosya dialogu açılır — dropzone'a tıklama devre dışı
["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) setPendingFile(file);
});

logLine(t("msg.sysReady"), "ok");
setStatus(t("status.readyHint"));
initHeartbeat();
heartbeatSet("GÖRÜNTÜ · DTA");
bindModuleRail(); // modül raynı + heartbeat + lazy modül yükleri
dismissBootSplash(t("boot.ready"));
wireLicenseUi();

onLocaleChange(() => {
  logLine(t("msg.langSet", { lang: getLocale().toUpperCase() }), "ok");
  updateShotHint();
  updateSoilHint();
  updateThroughRedHint();
  refreshLicenseBadge();
  refreshDtaLink();
  refreshProbEngine?.();
  syncPoolButtons();
  refreshArchiveList();
  refreshMapHintsPanel();
  refreshUpdateStatus?.();
  const fn = $("file-name");
  if (fn && !state.pendingFile) fn.textContent = t("ops.noFile");
  if (state.surfaceState) {
    applySurface(state.surfaceState, undefined, { resetKot: false });
  } else {
    resetIntelSummary();
    const host = $("structure-list");
    if (host) host.innerHTML = `<p class="hint">${t("list.empty")}</p>`;
    const stats = $("surface-stats");
    if (stats) stats.textContent = "—";
    renderFreeDrawPanel();
  }
  setStatus(state.surfaceState ? t("msg.ready3d", { view: (state.surfaceState.viewMode || state.surfaceState.view_mode) === "side" ? t("stats.side") : t("stats.top") }) : t("status.readyHint"));
});

/**
 * Touch cihazlarda panel scroll zincirleme engelleme
 * ve overscroll-glow efekti.
 */
function initTouchScroll() {
  // Sadece touch cihazlarda aktif
  if (!window.matchMedia("(pointer: coarse)").matches) return;

  const panels = [".panel-intel", ".panel-ops"].map((sel) => $(sel)).filter(Boolean);

  for (const panel of panels) {
    // Scroll zincirleme: panel dolduğunda üst element kaymasın
    panel.addEventListener("touchmove", (e) => {
      const { scrollTop, scrollHeight, clientHeight } = panel;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 2;
      const scrollingUp = e.touches[0]?.clientY > (panel._lastTouchY || e.touches[0].clientY);
      const scrollingDown = !scrollingUp;

      // Üstte yukarı kaydırma veya altta aşağı kaydırma → zinciri kes
      if ((atTop && scrollingUp) || (atBottom && scrollingDown)) {
        e.preventDefault();
      }

      panel._lastTouchY = e.touches[0]?.clientY || 0;
    }, { passive: false });

    // Touch başlangıç konumunu kaydet
    panel.addEventListener("touchstart", (e) => {
      panel._lastTouchY = e.touches[0]?.clientY || 0;
    }, { passive: true });
  }
}
