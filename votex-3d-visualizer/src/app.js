import { invoke } from "@tauri-apps/api/core";
import { init3DScene, renderDataset, updateOptions } from "./scene3d.js";
import { updateLegendBar } from "./heatmap.js";

let currentRawDataset = null;
let currentActiveDataset = null;

// DOM Elements
const btnOpenFile = document.getElementById("btn-open-file");
const btnLoadSample = document.getElementById("btn-load-sample");
const btnModeMesh = document.getElementById("btn-mode-mesh");
const btnModePoints = document.getElementById("btn-mode-points");

const selectColormap = document.getElementById("select-colormap");
const sliderZScale = document.getElementById("slider-z-scale");
const sliderPointSize = document.getElementById("slider-point-size");
const chkWireframe = document.getElementById("chk-wireframe");
const chkGridFloor = document.getElementById("chk-grid-floor");
const sliderMinCutoff = document.getElementById("slider-min-cutoff");

const valZScale = document.getElementById("val-z-scale");
const valPointSize = document.getElementById("val-point-size");
const valMinCutoff = document.getElementById("val-min-cutoff");

const legMin = document.getElementById("leg-min");
const legMid = document.getElementById("leg-mid");
const legMax = document.getElementById("leg-max");

const stCount = document.getElementById("st-count");
const stXRange = document.getElementById("st-x-range");
const stYRange = document.getElementById("st-y-range");
const stZRange = document.getElementById("st-z-range");
const stMinAnom = document.getElementById("st-min-anom");
const stMaxAnom = document.getElementById("st-max-anom");

const statusText = document.getElementById("status-badge");
const logList = document.getElementById("telemetry-log");
const fileInfoCard = document.getElementById("file-info-card");
const placeholderEl = document.getElementById("viewport-placeholder");

const selectUnitMultiplier = document.getElementById("select-unit-multiplier");
const selectAxisOrientation = document.getElementById("select-axis-orientation");

const fileInputFallback = document.getElementById("file-input-fallback");

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("viewport");
  init3DScene(container, onHoverPoint);
  setupEvents();
  logTelemetry("3D Visualizer modülleri hazır.", "ok");
});

function setupEvents() {
  btnLoadSample.addEventListener("click", loadSampleData);
  btnOpenFile.addEventListener("click", () => {
    logTelemetry("Dosya seç penceresi açılıyor...", "info");
    if (fileInputFallback) {
      fileInputFallback.value = "";
      fileInputFallback.click();
    } else {
      openFileDialog();
    }
  });

  if (fileInputFallback) {
    fileInputFallback.addEventListener("change", handleFileFallbackChange);
  }

  btnModeMesh.addEventListener("click", () => setRenderMode("mesh"));
  btnModePoints.addEventListener("click", () => setRenderMode("points"));

  selectColormap.addEventListener("change", (e) => {
    updateLegendBar(e.target.value);
    updateOptions({ colormap: e.target.value });
    logTelemetry(`Renk paleti değiştirildi: ${e.target.value}`, "info");
  });

  if (selectUnitMultiplier) {
    selectUnitMultiplier.addEventListener("change", () => {
      if (currentRawDataset) {
        refreshDatasetView();
        logTelemetry(`Birim çarpanı kalibre edildi: ${selectUnitMultiplier.value}`, "info");
      }
    });
  }

  if (selectAxisOrientation) {
    selectAxisOrientation.addEventListener("change", (e) => {
      if (currentRawDataset) {
        refreshDatasetView();
        updateOptions({ axisMode: e.target.value });
        logTelemetry(`Saha eksen düzeni fiziksel olarak değiştirildi: ${e.target.value}`, "info");
      }
    });
  }

  sliderZScale.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    valZScale.textContent = `${val.toFixed(1)}×`;
    updateOptions({ zScale: val });
  });

  sliderPointSize.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    valPointSize.textContent = val.toFixed(2);
    updateOptions({ pointSize: val });
  });

  chkWireframe.addEventListener("change", (e) => {
    updateOptions({ showWireframe: e.target.checked });
  });

  chkGridFloor.addEventListener("change", (e) => {
    updateOptions({ showGrid: e.target.checked });
  });

  sliderMinCutoff.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value) / 100.0;
    updateOptions({ minCutoffRatio: val });
  });
}

async function loadSampleData() {
  try {
    setStatus("Örnek veri yükleniyor...");
    const dataset = await invoke("get_sample_xyz_dataset");
    currentRawDataset = dataset;
    refreshDatasetView();
    setStatus("Hazır");
    logTelemetry("Sentetik anomali verisi başarıyla yüklendi.", "ok");
  } catch (err) {
    logTelemetry(`Örnek veri yükleme hatası: ${err}`, "err");
    setStatus("Hata");
  }
}

async function openFileDialog() {
  try {
    setStatus("Dosya seçiliyor...");
    let dataset = null;
    try {
      dataset = await invoke("pick_and_parse_xyz");
    } catch (e) {
      console.warn("Tauri native file picker fallback:", e);
    }

    if (dataset) {
      currentRawDataset = dataset;
      refreshDatasetView();
      setStatus("Yüklendi");
      logTelemetry(`Dosya yüklendi: ${dataset.fileName} (${dataset.points.length} nokta).`, "ok");
    } else {
      if (fileInputFallback) {
        fileInputFallback.click();
      } else {
        setStatus("Hazır");
      }
    }
  } catch (err) {
    logTelemetry(`Dosya açma uyarısı: ${err}`, "info");
    if (fileInputFallback) {
      fileInputFallback.click();
    }
  }
}

async function handleFileFallbackChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  try {
    setStatus("Dosya okunuyor...");
    const content = await file.text();
    const dataset = await invoke("parse_xyz_text", { content, fileName: file.name });
    if (dataset) {
      currentRawDataset = dataset;
      refreshDatasetView();
      setStatus("Yüklendi");
      logTelemetry(`Dosya yüklendi: ${dataset.fileName} (${dataset.points.length} nokta).`, "ok");
    }
  } catch (err) {
    logTelemetry(`Dosya okuma hatası: ${err}`, "err");
    setStatus("Hata");
  }
}

function getUnitDivisor(unitMode) {
  if (unitMode === "cm") return 100.0;
  if (unitMode === "m") return 1.0;
  if (unitMode === "mm") return 1000.0;
  return 10.0; // Default dm
}

function getUnitLabel(unitMode) {
  if (unitMode === "cm") return "cm";
  if (unitMode === "m") return "m";
  if (unitMode === "mm") return "mm";
  return "dm";
}

/// Physically transposes X and Y spatial matrix data when user selects swap_xy
function getTransposedDataset(rawDataset, isSwapXY) {
  if (!rawDataset || !isSwapXY) return rawDataset;

  const oldSt = rawDataset.stats;
  const newStats = {
    ...oldSt,
    minX: oldSt.minY,
    maxX: oldSt.maxY,
    minY: oldSt.minX,
    maxY: oldSt.maxX,
  };

  const newPoints = rawDataset.points.map((p) => ({
    ...p,
    x: Math.abs(p.y),
    y: -Math.abs(p.x),
  }));

  let newSurface = null;
  if (rawDataset.surface) {
    const s = rawDataset.surface;
    const rows = s.rows;
    const cols = s.cols;

    const zMatrixTransposed = Array.from({ length: cols }, () => new Array(rows));
    const anomalyMatrixTransposed = Array.from({ length: cols }, () => new Array(rows));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        zMatrixTransposed[c][r] = s.zMatrix[r][c];
        anomalyMatrixTransposed[c][r] = s.anomalyMatrix[r][c];
      }
    }

    newSurface = {
      rows: cols,
      cols: rows,
      xCoords: s.yCoords,
      yCoords: s.xCoords,
      zMatrix: zMatrixTransposed,
      anomalyMatrix: anomalyMatrixTransposed,
    };
  }

  const newStructures = (rawDataset.structures || []).map((st) => ({
    ...st,
    centerX: st.centerY,
    centerY: st.centerX,
    widthDm: st.lengthDm,
    lengthDm: st.widthDm,
  }));

  return {
    ...rawDataset,
    stats: newStats,
    points: newPoints,
    surface: newSurface,
    structures: newStructures,
  };
}

function refreshDatasetView() {
  if (!currentRawDataset) return;
  const isSwapXY = selectAxisOrientation && selectAxisOrientation.value === "swap_xy";
  const processedDataset = getTransposedDataset(currentRawDataset, isSwapXY);
  applyDataset(processedDataset);
}

function applyDataset(dataset) {
  currentActiveDataset = dataset;
  placeholderEl.style.display = "none";

  const st = dataset.stats;
  const unitMode = selectUnitMultiplier ? selectUnitMultiplier.value : "dm";
  const divisor = getUnitDivisor(unitMode);
  const label = getUnitLabel(unitMode);

  const xSpanUnit = Math.abs(st.maxX - st.minX);
  const ySpanUnit = Math.abs(st.maxY - st.minY);
  const zSpanUnit = Math.abs(st.maxZ - st.minZ);

  stCount.textContent = st.count.toLocaleString("tr-TR");
  stXRange.textContent = `${xSpanUnit.toFixed(1)} ${label} (${(xSpanUnit / divisor).toFixed(2)} m)`;
  stYRange.textContent = `${ySpanUnit.toFixed(1)} ${label} (${(ySpanUnit / divisor).toFixed(2)} m)`;
  stZRange.textContent = `${zSpanUnit.toFixed(1)} ${label} (${(zSpanUnit / divisor).toFixed(2)} m)`;
  stMinAnom.textContent = st.minAnomaly.toFixed(1);
  stMaxAnom.textContent = st.maxAnomaly.toFixed(1);

  legMin.textContent = st.minAnomaly.toFixed(1);
  legMid.textContent = st.meanAnomaly.toFixed(1);
  legMax.textContent = st.maxAnomaly.toFixed(1);
  valMinCutoff.textContent = `>= ${st.minAnomaly.toFixed(1)}`;

  let rawLinesHtml = "";
  if (dataset.rawSampleLines && dataset.rawSampleLines.length > 0) {
    rawLinesHtml = `
      <div style="margin-top:0.4rem; padding-top:0.4rem; border-top:1px solid rgba(255,255,255,0.1); font-family:monospace; font-size:0.68rem; color:#64748b;">
        <strong>Ham Dosya Satırları (İlk ${dataset.rawSampleLines.length} Satır):</strong><br/>
        ${dataset.rawSampleLines.slice(0, 4).map((l) => `<code>${l}</code>`).join("<br/>")}
      </div>
    `;
  }

  fileInfoCard.innerHTML = `
    <strong>${dataset.fileName}</strong><br/>
    Saha Ölçüsü: ${xSpanUnit.toFixed(1)} × ${ySpanUnit.toFixed(1)} ${label} (${(xSpanUnit / divisor).toFixed(2)} × ${(ySpanUnit / divisor).toFixed(2)} m)<br/>
    Derinlik Aralığı: ${zSpanUnit.toFixed(1)} ${label} (${(zSpanUnit / divisor).toFixed(2)} m)<br/>
    Ortalama Anomali: ${st.meanAnomaly.toFixed(1)}
    ${rawLinesHtml}
  `;

  updateStructureReportUI(dataset.structures, unitMode);
  renderDataset(dataset);
}

function updateStructureReportUI(structures, unitMode = "dm") {
  const container = document.getElementById("structure-list-container");
  if (!container) return;

  if (!structures || structures.length === 0) {
    container.innerHTML = `<p class="struct-empty">Yeraltı yapı veya metal tespiti bulunamadı.</p>`;
    return;
  }

  const divisor = getUnitDivisor(unitMode);
  const label = getUnitLabel(unitMode);

  let html = "";
  structures.forEach((s) => {
    const kindClass = `kind-${s.kind}`;
    const badgeText = s.kind === "metal" ? "METAL ANOMALİSİ" : s.kind === "tomb" ? "MEZAR ODASI" : s.kind === "tunnel" ? "TÜNEL / KORİDOR" : s.kind === "shaft" ? "DİKEY ŞAFT" : "YAPI BOŞLUĞU";

    const wM = (s.widthDm / divisor).toFixed(2);
    const lM = (s.lengthDm / divisor).toFixed(2);
    const hM = (s.heightDm / divisor).toFixed(2);

    const roofM = (s.roofDepthDm / divisor).toFixed(2);
    const floorM = (s.floorDepthDm / divisor).toFixed(2);

    html += `
      <div class="struct-card ${kindClass}">
        <div class="struct-title">
          <span>${s.name}</span>
          <span class="struct-badge">${badgeText}</span>
        </div>
        <div class="struct-details">
          <div class="struct-row">
            <span>Metraj (GxUxY):</span>
            <strong>${s.widthDm.toFixed(1)} × ${s.lengthDm.toFixed(1)} × ${s.heightDm.toFixed(1)} ${label} (${wM} × ${lM} × ${hM} m)</strong>
          </div>
          <div class="struct-row">
            <span>Tavan / Ağız Derinliği:</span>
            <strong>${s.roofDepthDm.toFixed(1)} ${label} (${roofM} m Yüzey Altı)</strong>
          </div>
          <div class="struct-row">
            <span>Taban Derinliği:</span>
            <strong>${s.floorDepthDm.toFixed(1)} ${label} (${floorM} m)</strong>
          </div>
          <div class="struct-row">
            <span>Tahmini Hacim:</span>
            <strong>~${s.volumeM3.toFixed(3)} m³</strong>
          </div>
          <div class="struct-row">
            <span>Simetri / Güven:</span>
            <strong>%${s.symmetryPct.toFixed(0)} Simetri / %${s.confidencePct.toFixed(0)} Güven</strong>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function setRenderMode(mode) {
  if (mode === "mesh") {
    btnModeMesh.classList.add("active");
    btnModePoints.classList.remove("active");
  } else {
    btnModePoints.classList.add("active");
    btnModeMesh.classList.remove("active");
  }
  updateOptions({ mode });
}

function onHoverPoint(pt) {
  if (!pt) return;
  // Can be used for hover tooltip
}

function setStatus(text) {
  const el = statusText || document.getElementById("status-badge");
  if (el) el.textContent = text;
}

function logTelemetry(msg, type = "info") {
  if (!logList) return;
  const time = new Date().toLocaleTimeString("tr-TR");
  const li = document.createElement("li");
  li.className = `log-${type}`;
  li.innerHTML = `<span class="log-time">[${time}]</span> ${msg}`;
  logList.appendChild(li);
  logList.scrollTop = logList.scrollHeight;
}
