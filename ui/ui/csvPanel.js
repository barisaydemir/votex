import { $, state } from "../app/state.js";
import { buildSurfaceFromCsv, pickCsvFile, analyzeCsvData, parseExcelData, deepStructureScan, getAppSettings, setCsvFilterPrefs } from "../api/tauri.js";
import { initMultiCsv, addFile, addFiles, addCsvContent, removeDataset, clearAll, selectDataset, setMergeMode, getMergedData, getDatasets, getDatasetCount, setDatasetVisible } from "./multiCsvLoader.js";
import { selectedShotType, selectedTargetKind } from "./shotType.js";
import { ensureViewer } from "../viewer/scene.js";
import { addCsvOverlayToScene, removeCsvOverlay, toggleCsvOverlay, anomalyStatsString, renderCsvHeatmap } from "../viewer/csvOverlay.js";
import { detectStructuresFromTerrain } from "../viewer/csvAnalysis.js";
import { filterUnderground, sliceDepths, autoBoxFor } from "../viewer/csvFilter.js";
import { analyzeDepthSlices } from "../viewer/csvAnalysis.js";
import { bindHeatmapPick } from "../viewer/csvHeatmap.js";
import { flyCameraTo } from "../viewer/labels.js";
import * as THREE from "three";
import { t } from "../i18n/index.js";

// Havuz boyutunu otomatik geçir — yapılar havuz-relative koordinatlarda
function _heatmap(csvData, opts = {}) {
  const poolSizeM = Number($("csv-pool-size")?.value) || 30;
  // Normalize dönüşüm parametreleri (yapıları normalize→CSV'ye çevirir)
  const np = state.csvOverlay ? {
    scale: state.csvOverlay.userData?.anomalyStats?.scale || null,
    center: state.csvOverlay.userData?.normCenter || null,
  } : null;
  renderCsvHeatmap(csvData, { ...opts, poolSizeM, normParams: np });
}

let _invoke = null;
async function invoke(cmd, args) {
  if (!_invoke) {
    try {
      const mod = await import("@tauri-apps/api/core");
      _invoke = mod.invoke;
    } catch {
      _invoke = () => Promise.reject(new Error("Tauri API not available"));
    }
  }
  return _invoke(cmd, args);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * CSV dosyasını oku ve analiz et (önizleme).
 */
async function analyzeCsv(content, fileName) {
  try {
    const result = await analyzeCsvData({
      csvContent: content,
      fileName,
      viewMode: selectedShotType(),
    });
    return result;
  } catch (e) {
    console.error("CSV analiz hatası:", e);
    return null;
  }
}

/**
 * CSV verisinden 3D yüzey oluştur.
 */
async function buildFromCsv(content, fileName, options = {}) {
  const req = {
    csvContent: content,
    fileName,
    viewMode: options.viewMode || selectedShotType(),
    mapSizeM: options.mapSizeM || 24,
    depthRangeM: options.depthRangeM || 15,
  };
  return buildSurfaceFromCsv(req);
}

/**
 * CSV panelini render et.
 */

/**
 * Kullanıcı seçimli dilim sayısı (4-16).
 */
function getSliceCount() {
  const el = $("csv-slice-count");
  const v = Number(el?.value) || 8;
  return Math.max(4, Math.min(16, Math.floor(v)));
}

/**
 * Tespit eşiği slider'larını oku (sınırlarla kenetlenmiş).
 */
function getDetectionThresholds() {
  const thr = Number($("csv-threshold")?.value);
  const minStr = Number($("csv-min-strength")?.value);
  return {
    threshold: Number.isFinite(thr) ? Math.max(0.3, Math.min(2.0, thr)) : 0.9,
    minStrength: Number.isFinite(minStr) ? Math.max(0.05, Math.min(1.0, minStr)) : 0.45,
  };
}

/**
 * Dilim bandını etiket için format (ham koordinat birimleri).
 */
function fmtSlice(v) {
  const n = Number(v);
  if (n === 0 || !Number.isFinite(n)) return "Tümü";
  return n.toLocaleString();
}

/**
 * Büyük koordinatları kısa M biçiminde göster (örn. -262.5M).
 */
function fmtCoord(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const m = Math.abs(n) / 1e6;
  if (m >= 1) {
    return (n < 0 ? "-" : "") + (m >= 100 ? m.toFixed(0) : m.toFixed(1)) + "M";
  }
  return n.toLocaleString();
}

/**
 * Dilim bazlı yapı raporunu #csv-slice-report içine render et.
 */
function renderSliceReport() {
  const el = $("csv-slice-report");
  if (!el) return;
  const rep = state.csvSliceReport;
  if (!rep || !rep.slices || rep.slices.length === 0) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  const n = (a) => (a ? a.length : 0);
  // Görünürlük filtresi — durum state'te tutulur, onay kutularından değişir
  const filt = state.csvScanFilter || (state.csvScanFilter = { chamber: true, tunnel: true, metal: true });
  const visible = (kind) => filt[kind] !== false;
  // Bir tespitin boyut/güç özeti (çip tooltip'i ve detay satırı için)
  const detSummary = (kind, it) => {
    const g = it.strength != null ? `güç ${Number(it.strength).toFixed(2)} · ` : "";
    if (kind === "tunnel") {
      const len = Math.hypot(Number(it.x1 || 0) - Number(it.x0 || 0), Number(it.y1 || 0) - Number(it.y0 || 0)) / 1000;
      return `${g}boy ${len.toFixed(1)}m × gen ${Number(it.widthM || 0).toFixed(1)}m`;
    }
    const w = Number(it.widthM || 0);
    const l = Number(it.lengthM || it.widthM || 0);
    return `${g}${w.toFixed(1)} × ${l.toFixed(1)} m`;
  };
  const rowChips = (s) => {
    const chips = [];
    const push = (kind, items, label) => {
      if (!visible(kind)) return;
      const list = items || [];
      const shown = list.slice(0, 12); // çok kalabalık olmasın
      shown.forEach((it, i) => {
        chips.push(
          `<button class="det-chip det-${kind}" data-kind="${kind}" data-slice="${s.slice}" data-idx="${i}" title="${label} ${i + 1} · ${detSummary(kind, it)} — 3D'de odakla">${label} ${i + 1}</button>`
        );
      });
      if (list.length > 12) {
        chips.push(`<span class="det-more">+${list.length - 12}</span>`);
      }
    };
    push("chamber", s.chambers, "oda");
    push("tunnel", s.tunnels, "tünel");
    push("metal", s.metals, "metal");
    return chips.join("");
  };
  // Her tespit için güç + boyut satırı (güçlüden zayıfa — motor zaten sıralı)
  const rowDetails = (s) => {
    const lines = [];
    const push = (kind, items, label, cls) => {
      if (!visible(kind)) return;
      (items || []).slice(0, 12).forEach((it, i) => {
        lines.push(
          `<span class="sd-line ${cls}" data-kind="${kind}" data-slice="${s.slice}" data-idx="${i}"><b>${label} ${i + 1}</b> ${detSummary(kind, it)}</span>`
        );
      });
    };
    push("chamber", s.chambers, "oda", "sd-chamber");
    push("tunnel", s.tunnels, "tünel", "sd-tunnel");
    push("metal", s.metals, "metal", "sd-metal");
    return lines.join("");
  };
  const rows = [];
  const totals = { chamber: 0, tunnel: 0, metal: 0 };
  const allTotals = { chamber: 0, tunnel: 0, metal: 0 };
  for (const s of rep.slices) {
    const ch = visible("chamber") ? n(s.chambers) : 0;
    const tu = visible("tunnel") ? n(s.tunnels) : 0;
    const me = visible("metal") ? n(s.metals) : 0;
    allTotals.chamber += n(s.chambers);
    allTotals.tunnel += n(s.tunnels);
    allTotals.metal += n(s.metals);
    const found = ch + tu + me;
    if (found === 0) continue; // filtrelenmiş satırı hiç gösterme
    if (filt.chamber !== false) totals.chamber += ch;
    if (filt.tunnel !== false) totals.tunnel += tu;
    if (filt.metal !== false) totals.metal += me;
    rows.push(`<div class="slice-row">
      <span class="slice-idx">${s.slice}/${rep.slices.length}</span>
      <span class="slice-depth">${fmtCoord(s.yMin)}..${fmtCoord(s.yMax)}</span>
      <span class="slice-count">${s.count} nkt</span>
      <span class="slice-found"><span class="det-chips">${rowChips(s)}</span></span>
      <div class="slice-dets">${rowDetails(s)}</div>
    </div>`);
  }
  const presets = [
    { label: "Tümü", id: "all", chamber: true, tunnel: true, metal: true },
    { label: "Boşluk", id: "void", chamber: true, tunnel: true, metal: false },
    { label: "Metal", id: "metal", chamber: false, tunnel: false, metal: true },
    { label: "Oda", id: "room", chamber: true, tunnel: false, metal: false },
  ];
  const presetBtns = presets.map(p => {
    const active = filt.chamber === p.chamber && filt.tunnel === p.tunnel && filt.metal === p.metal;
    return `<button class="scan-preset${active ? " active" : ""}" data-preset="${p.id}">${p.label}</button>`;
  }).join("");
  const filterBar = `
    <div class="scan-filters">
      <span class="scan-filters-title">Göster:</span>
      <div class="scan-preset-row">${presetBtns}</div>
      <label class="scan-f-check sf-chamber"><input type="checkbox" class="scan-f" data-kind="chamber" ${visible("chamber") ? "checked" : ""} /> oda <em class="sf-count">(${allTotals.chamber})</em></label>
      <label class="scan-f-check sf-tunnel"><input type="checkbox" class="scan-f" data-kind="tunnel" ${visible("tunnel") ? "checked" : ""} /> tünel <em class="sf-count">(${allTotals.tunnel})</em></label>
      <label class="scan-f-check sf-metal"><input type="checkbox" class="scan-f" data-kind="metal" ${visible("metal") ? "checked" : ""} /> metal <em class="sf-count">(${allTotals.metal})</em></label>
    </div>
  `;
  const allOff = !visible("chamber") && !visible("tunnel") && !visible("metal");
  el.innerHTML = `
    <div class="slice-head"><span class="panel-tag">SCAN</span> Dilim Bazlı Yapı Analizi · ${rep.slices.length} dilim <em class="det-hint">(çip = 3D'de odakla)</em></div>
    ${filterBar}
    ${allOff ? `<div class="slice-none-row">Tüm türler gizli — bir filtreyi açın</div>` : `<div class="slice-rows">${rows.join("")}</div>`}
    ${allOff ? "" : `<div class="slice-total">Toplam: ${totals.chamber} oda · ${totals.tunnel} tünel · ${totals.metal} metal</div>`}
  `;
}

/**
 * Bir tespitin 3D dünya koordinatını overlay ölçeğiyle hesaplar
 * (buildStructuresInCube ile birebir aynı dönüşüm).
 */
function detectionWorldPos(kind, det, sc, dims) {
  const xzS = sc?.xz || 1;
  const yS = sc?.y || 1;
  if (kind === "tunnel") {
    const x0 = (Number(det.x0) || 0) * xzS * 0.001;
    const z0 = (Number(det.y0) || 0) * xzS * 0.001;
    const x1 = (Number(det.x1) || 0) * xzS * 0.001;
    const z1 = (Number(det.y1) || 0) * xzS * 0.001;
    const depth = Number(det.floorFromSurfaceM) || 2;
    const y = -depth * yS * 0.001;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const wM = Number(det.widthM) || 1.2;
    return {
      pos: new THREE.Vector3((x0 + x1) / 2, y, (z0 + z1) / 2),
      radius: Math.max(len / 2 + 1.5, wM * xzS * 0.5 + 1.5),
    };
  }
  const cx = (Number(det.cx) || 0) * xzS * 0.001;
  const cz = (Number(det.cy) || 0) * xzS * 0.001;
  if (kind === "metal") {
    const depth = Number(det.depthFromSurfaceM) || 1;
    const wM = Number(det.widthM) || 1.2;
    return {
      pos: new THREE.Vector3(cx, -depth * yS * 0.001, cz),
      radius: Math.max(wM * xzS * 0.5 + 1, 2.5),
    };
  }
  // chamber: top/bottom ortası
  const topM = Number(det.topFromSurfaceM ?? 0.4) || 0.4;
  const botM = Number(det.bottomFromSurfaceM ?? topM + 2.5) || topM + 2.5;
  const wM = Number(det.widthM) || 2;
  const lM = Number(det.lengthM) || wM;
  return {
    pos: new THREE.Vector3(cx, -((topM + botM) / 2) * yS * 0.001, cz),
    radius: Math.max(Math.max(wM, lM) * xzS * 0.5 + 1.5, 3),
  };
}

/**
 * Rapor çipinden tespite git: seçili dilime geçir, 3D'yi kur, kamerayı odakla.
 */
async function goToDetection(kind, slice, idx) {
  const rep = state.csvSliceReport;
  const s = rep?.slices?.[slice - 1];
  const det = s?.[kind]?.[idx];
  if (!det) return;
  ensureViewer();

  // Tespit hangi dilimdeyse o dilime geç (3D o bandı gösterecek);
  // build3dFromCsv aşağıda heatmap'i de güncellediği için burada sadece etiketi güncelle.
  const sliceSlider = $("csv-depth-slice");
  const sliceCount = getSliceCount();
  if (sliceSlider && slice > 0 && Number(sliceSlider.value) !== slice) {
    sliceSlider.max = String(sliceCount);
    sliceSlider.value = String(slice);
    const sd = sliceDepths(state.csvData?.points || [], slice, sliceCount);
    const lbl = $("csv-depth-slice-label");
    if (lbl) lbl.textContent = `${slice}/${sliceCount} (${fmtSlice(sd.yMin)}..${fmtSlice(sd.yMax)})`;
  }
  if (state.csvData) await build3dFromCsv(true);

  const overlay = state.csvOverlay;
  if (!overlay) {
    setStatus("Önce 3D oluşturun — tespit bulunamadı");
    return;
  }
  const stats = overlay.userData?.anomalyStats || {};
  const sc = stats.scale;
  const dims = stats.dims || { w: 30, h: 30, d: 30 };
  const { pos, radius } = detectionWorldPos(kind, det, sc, dims);
  const label = { chamber: "oda", tunnel: "tünel", metal: "metal" }[kind] || kind;
  flyCameraTo(pos, radius, `Tespit ${slice}/${rep.slices.length} · ${label} ${idx + 1}`);
}

/**
 * Dilim analizini çalıştırıp state + panel günceller.
 */
function runSliceAnalysis() {
  if (!state.csvData?.points?.length) {
    state.csvSliceReport = null;
    renderSliceReport();
    return;
  }
  const poolSizeM = Number($("csv-pool-size")?.value) || 30;
  const { threshold, minStrength } = getDetectionThresholds();
  try {
    state.csvSliceReport = analyzeDepthSlices(state.csvData.points, {
      sliceCount: getSliceCount(),
      poolSizeM,
      gridRes: 64,
      threshold,
      minStrength,
    });
    renderSliceReport();
  } catch (e) {
    console.warn("[CSV] Dilim analizi hatası:", e);
    state.csvSliceReport = null;
    renderSliceReport();
  }
}

export function renderCsvPanel() {
  const panel = $("csv-panel");
  if (!panel) return;

  const hasData = !!state.csvData;
  const preview = $("csv-preview");
  const buildBtn = $("btn-csv-build");

  // ── Buton durumlarını HEMEN ayarla (hata olsa bile) ──
  if (buildBtn) {
    buildBtn.disabled = !hasData;
    console.log('[CSV-BTN] buildBtn.disabled=', buildBtn.disabled, 'hasData=', hasData, 'csvData=', !!state.csvData, 'points=', state.csvData?.pointCount);
  } else {
    console.warn('[CSV-BTN] buildBtn NOT FOUND! id=btn-csv-build');
  }
  const toggleBtn = $("btn-csv-toggle");
  if (toggleBtn) {
    toggleBtn.disabled = !state.csvOverlay;
    toggleBtn.textContent = !!state.csvOverlay?.visible
      ? (t("csv.hideOverlay") || "Overlay Kapat")
      : (t("csv.showOverlay") || "Overlay Aç");
    console.log('[CSV-BTN] toggleBtn.disabled=', toggleBtn.disabled, 'overlay=', !!state.csvOverlay, 'visible=', state.csvOverlay?.visible);
  } else {
    console.warn('[CSV-BTN] toggleBtn NOT FOUND! id=btn-csv-toggle');
  }

  // Tümünü Gör butonu — yapı varsa aktif
  const zoomAllBtn = $("btn-csv-zoom-all");
  if (zoomAllBtn) {
    const hasStructs = !!(state.csvStructures && (
      (state.csvStructures.chambers || []).length +
      (state.csvStructures.tunnels || []).length +
      (state.csvStructures.metals || []).length
    ) > 0);
    zoomAllBtn.disabled = !hasStructs;
  }

  const ug = hasData ? filterUnderground(state.csvData.points || []) : { keptCount: 0 };

  if (preview) {
    if (hasData) {
      const stats = state.csvData;
      const total = Math.max(stats.pointCount || 0, 1);
      const keptPct = (ug.keptCount / total) * 100;
      const droppedPct = 100 - keptPct;
      const pct = (v) => `${(v).toFixed(v >= 10 ? 0 : 1)}%`;
      preview.innerHTML = `
        <div class="csv-stats">
          <span class="csv-stat"><strong>${stats.pointCount}</strong> nokta</span>
          <span class="csv-stat" style="color:#3edc8c;">Yer altı: <strong>${ug.keptCount}</strong> (${esc(
            stats.pointCount - ug.keptCount
          )} elendi)</span>
          <span class="csv-stat">X: ${esc(stats.xMin != null ? Number(stats.xMin).toLocaleString() : '—')} → ${esc(stats.xMax != null ? Number(stats.xMax).toLocaleString() : '—')}</span>
          <span class="csv-stat">Y: ${esc(stats.yMin != null ? Number(stats.yMin).toLocaleString() : '—')} → ${esc(stats.yMax != null ? Number(stats.yMax).toLocaleString() : '—')}</span>
          <span class="csv-stat">Z: ${esc(stats.zMin != null ? Number(stats.zMin).toLocaleString() : '—')} → ${esc(stats.zMax != null ? Number(stats.zMax).toLocaleString() : '—')}</span>
          <span class="csv-stat">Manyetik: ${esc(stats.magneticMin?.toFixed(1))}–${esc(stats.magneticMax?.toFixed(1))}</span>
        </div>
        <div class="csv-filter-bar">
          <div class="bar-row">
            <span>Yer altı</span>
            <div class="bar-track">
              <div class="bar-fill underground" style="width: ${pct(keptPct)}"></div>
            </div>
            <em>${pct(keptPct)}</em>
          </div>
          <div class="bar-row">
            <span>Elendi</span>
            <div class="bar-track">
              <div class="bar-fill dropped" style="width: ${pct(droppedPct)}"></div>
            </div>
            <em>${pct(droppedPct)}</em>
          </div>
        </div>
        <div class="csv-preview-table" id="csv-table"></div>
      `;
      renderCsvTable(stats.points?.slice(0, 20) || []);
    } else {
      preview.innerHTML = `<p class="hint compact" data-i18n="csv.emptyHint">CSV dosyası seçilmedi</p>`;
    }
  }

  // Derinlik dilimi slider — veri yüklüyse aktif
  const sliceSlider = $("csv-depth-slice");
  const sliceLabel = $("csv-depth-slice-label");
  const sliceCount = getSliceCount();
  if (sliceSlider && sliceLabel) {
    const has = hasData && ug.keptCount > 0;
    sliceSlider.disabled = !has;
    if (!has) {
      sliceSlider.max = "0";
      sliceSlider.value = "0";
      sliceLabel.textContent = "Tümü";
    } else {
      sliceSlider.max = String(sliceCount);
      const v = Number(sliceSlider.value) || 0;
      if (v > 0) {
        const sd = sliceDepths(state.csvData.points || [], v, sliceCount);
        sliceLabel.textContent = `${v}/${sliceCount} (${fmtSlice(sd.yMin)}..${fmtSlice(sd.yMax)})`;
      } else {
        sliceLabel.textContent = "Tümü";
      }
    }
  }

  // Dilim sayısı slider senkronu
  const scSlider = $("csv-slice-count");
  const scLabel = $("csv-slice-count-label");
  if (scSlider && scLabel) {
    scSlider.disabled = !hasData;
    scLabel.textContent = String(sliceCount);
  }

  // Tespit eşiği sliderları — veri yoksa devre dışı
  const thrSlider = $("csv-threshold");
  const thrLabel = $("csv-threshold-label");
  if (thrSlider && thrLabel) {
    thrSlider.disabled = !hasData;
    thrLabel.textContent = (Number(thrSlider.value) || 0.9).toFixed(2);
  }
  const msSlider = $("csv-min-strength");
  const msLabel = $("csv-min-strength-label");
  if (msSlider && msLabel) {
    msSlider.disabled = !hasData;
    msLabel.textContent = (Number(msSlider.value) || 0.45).toFixed(2);
  }

  // Anomali istatistikleri
  const statsEl = $("csv-anomaly-stats");
  if (statsEl && state.csvOverlay) {
    const stats = state.csvOverlay.userData?.anomalyStats;
    if (stats) {
      statsEl.innerHTML = `
        <div class="csv-anomaly-info">
          <span class="csv-stat anomaly-pos">+${stats.positive} pozitif</span>
          <span class="csv-stat anomaly-neg">−${stats.negative} negatif</span>
          <span class="csv-stat">Toplam: ${stats.total} anomali</span>
        </div>
        <div class="csv-anomaly-thresholds">
          Eşik: ${stats.lowThreshold?.toFixed(1)} — ${stats.highThreshold?.toFixed(1)}
        </div>
      `;
    }
  }

  // Multi-CSV listesini güncelle
  renderMultiCsvList();
}

/**
 * CSV önizleme tablosunu render et.
 */
function renderCsvTable(points) {
  const table = $("csv-table");
  if (!table || !points.length) return;

  const headers = ["X", "Y", "Z", "Manyetik"];
  const fmtM = (v) => v != null ? Number(v).toLocaleString() : "—";
  const rows = points.map((p) => [
    fmtM(p.x),
    fmtM(p.y),
    fmtM(p.z),
    p.magnetic?.toFixed(1) ?? "—",
  ]);

  table.innerHTML = `
    <table class="csv-table">
      <thead>
        <tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`
          )
          .join("")}
      </tbody>
    </table>
    ${points.length >= 20 ? `<p class="hint compact">… ve daha fazlası</p>` : ""}
  `;
}

/**
 * CSV dosyası seç (native dialog).
 */
async function pickCsv() {
  try {
    const result = await pickCsvFile();
    if (!result) return;

    const { fileName, content } = result;
    const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");
    
    setStatus(t("csv.loading", { name: fileName }) || `Yükleniyor: ${fileName}...`);

    let stats;
    if (isExcel) {
      // Excel dosyası — base64 olarak parse et
      stats = await parseExcelData(content);
    } else {
      // CSV dosyası
      stats = await analyzeCsv(content, fileName);
    }

    if (!stats) {
      setStatus(t("csv.parseError") || "Dosya ayrıştırma hatası");
      return;
    }

    state.csvData = stats;
    state.csvContent = content;
    state.csvFileName = fileName;

    // Multi-CSV listesine ekle (eğer tek dosya modunda)
    try {
      addCsvContent(content, fileName, fileName).then(() => renderMultiCsvList()).catch(() => {});
    } catch (_) {}

    // ── Butonu HEMEN enable et (heatmap hata verse bile çalışsın) ──
    const bBtn = $("btn-csv-build");
    if (bBtn) { bBtn.disabled = false; console.log('[CSV-BTN] pickCsv → buildBtn.enabled=true, points=', stats.pointCount); }
    const tBtn = $("btn-csv-toggle");
    if (tBtn) tBtn.disabled = false;

    // 2D heatmap'i hemen göster (hata olsa bile butonlar çalışmaya devam eder)
    try {
      _heatmap(stats, {});
      _bindHeatmapPick(stats);
    } catch (hmErr) {
      console.warn('[CSV] Heatmap çizim hatası (atlanıyor):', hmErr);
    }

    renderCsvPanel();
    renderMultiCsvList();
    runSliceAnalysis();
    setStatus(t("csv.loaded", { n: stats.pointCount }) || `${stats.pointCount} nokta yüklendi`);
  } catch (e) {
    console.error("Dosya seçim hatası:", e);
    setStatus(t("csv.error") || "Hata");
  }
}

/**
 * CSV'den 3D yüzey oluştur.
 */
async function build3dFromCsv(quiet = false) {
  console.log('[CSV-BUILD] START quiet=', quiet, 'csvContent=', !!state.csvContent, 'csvData=', !!state.csvData);
  if (!state.csvContent) {
    if (!quiet) setStatus(t("csv.noData") || "Önce CSV dosyası seçin");
    return;
  }

  try {
    if (!quiet) {
      setStatus(t("csv.building") || "3D oluşturuluyor...");
      const b = $("btn-csv-build");
      if (b) { b.disabled = true; console.log('[CSV-BUILD] buildBtn disabled=true'); }
    }

    const csvData = state.csvData;
    if (!csvData || !csvData.points || csvData.points.length === 0) {
      setStatus("Veri yok");
      return;
    }

    // 1) Three.js sahnesini başlat
    ensureViewer();
    console.log("[CSV] Viewer başlatıldı, scene:", !!state.scene);

    // 2) Eski CSV overlay'ı temizle
    removeCsvOverlay();

    // Parametreleri oku (önce tanımla!)
    const sigma = Math.max(1, Math.min(4, Number($("csv-sigma")?.value) || 2));
    const manualLow = $("csv-thresh-low")?.value ? Number($("csv-thresh-low").value) : undefined;
    const manualHigh = $("csv-thresh-high")?.value ? Number($("csv-thresh-high").value) : undefined;
    const poolSizeM = Number($("csv-pool-size")?.value) || 30;
    const pointSize = Number($("csv-point-size")?.value) || 0.2;
    const undergroundOnly = $("csv-underground-filter")?.checked !== false;
    const fitFactor = (Number($("csv-fit")?.value) || 85) / 100;

    // Otomatik sığdırma — kutu veri dağılımına göre boyutlandırılır (tüm eksenler ayrı)
    const autoBox = $("csv-auto-box")?.checked
      ? autoBoxFor(csvData.points || [], fitFactor)
      : null;
    if (autoBox) {
      console.log(`[CSV] Otomatik sığdırma: kutu ${autoBox.w.toFixed(1)} × ${autoBox.h.toFixed(1)} × ${autoBox.d.toFixed(1)} m`);
    }

    // Derinlik dilimi — seçilen dilim sayısına göre overlay sadece o bandın noktalarını kullanır
    const sliceEl = $("csv-depth-slice");
    const slice = sliceEl ? Number(sliceEl.value) || 0 : 0;
    const sliceCount = getSliceCount();
    const sliceActive = slice > 0 && sliceCount > 1;
    let fixedBounds = null;
    let cData = csvData;
    if (sliceActive) {
      const sd = sliceDepths(csvData.points || [], slice, sliceCount);
      if (sd.points.length > 0) {
        fixedBounds = {
          xMin: csvData.xMin, xMax: csvData.xMax,
          yMin: csvData.yMin, yMax: csvData.yMax,
          zMin: csvData.zMin, zMax: csvData.zMax,
        };
        cData = { ...csvData, points: sd.points, pointCount: sd.points.length };
      }
    }

    // 3) Yapıları tespit et (hata olursa overlay yine de çalışsın)
    let structures = null;
    try {
      const surface = await buildFromCsv(state.csvContent, state.csvFileName, {
        viewMode: selectedShotType(),
        mapSizeM: poolSizeM,
        depthRangeM: poolSizeM / 2,
      });
      console.log(`[CSV] Surface oluşturuldu: gridW=${surface?.gridW}, gridH=${surface?.gridH}`);
      try {
        const scanResult = await deepStructureScan();
        if (scanResult?.structures) {
          structures = scanResult.structures;
          console.log(`[CSV] Yapılar tespit edildi: ${(structures.chambers||[]).length} oda, ${(structures.tunnels||[]).length} tünel, ${(structures.metals||[]).length} metal`);
        }
      } catch (e2) {
        console.warn(`[CSV] deep_structure_scan hatası (atlanıyor):`, e2.message || e2);
      }
    } catch (e) {
      console.warn(`[CSV] buildFromCsv hatası (atlanıyor, overlay yine de oluşturulacak):`, e.message || e);
    }
    const gridN = Number($("csv-grid-res")?.value) || 32;
    const detThr = getDetectionThresholds();
    const overlay = addCsvOverlayToScene(cData, {
      sigma,
      manualLow,
      manualHigh,
      poolSizeM,
      pointSize,
      gridN,
      structures,
      undergroundOnly: sliceActive ? true : undergroundOnly,
      fixedBounds,
      bounds: fixedBounds,
      slice: sliceActive ? slice : 0,
      sliceCount: sliceActive ? sliceCount : 1,
      fitFactor,
      autoBox,
      threshold: detThr.threshold,
      minStrength: detThr.minStrength,
      structureFilter: state.csvScanFilter,
    });

    console.log("[CSV] Overlay oluşturuldu:", !!overlay, "scene children:", state.scene?.children?.length);
    if (!overlay) {
      setStatus("Overlay oluşturulamadı");
      return;
    }
    // Yapıları state'e kaydet — heatmap sembolleri için
    // deepStructureScan başarısız olursa overlay içinden Heatmap grid'den tespit et
    if (!structures && overlay) {
      try {
        const hm = overlay.children.find(c => c.name === 'magneticHeatmap');
        const gd = hm?.userData?.gridData;
        if (gd) {
          const detThr = getDetectionThresholds();
          const mGrid = gd.mGrid;
          let mMin = Infinity, mMax = -Infinity;
          for (let i = 0; i < mGrid.length; i++) {
            if (mGrid[i] < mMin) mMin = mGrid[i];
            if (mGrid[i] > mMax) mMax = mGrid[i];
          }
          const mMid = (mMax + mMin) / 2;
          const mHalf = Math.max(Math.abs(mMax - mMid), Math.abs(mMid - mMin), 1);
          const mStats = { mean: mMid, stddev: mHalf / 2, min: mMin, max: mMax, median: mMid };
          structures = detectStructuresFromTerrain(
            gd.yGrid, gd.mGrid, gd.counts, gd.gridRes, poolSizeM, mStats,
            { threshold: detThr.threshold, minStrength: detThr.minStrength, bounds: gd.gBounds || null }
          );
          console.log(`[CSV] Heatmap grid'den yapı tespiti: ${(structures.chambers||[]).length} oda, ${(structures.tunnels||[]).length} tünel, ${(structures.metals||[]).length} metal`);
        }
      } catch (e) {
        console.warn('[CSV] Heatmap grid yapı tespiti hatası:', e);
      }
    }
    state.csvStructures = structures;

    // Heatmap'i yapı sembolleriyle yeniden çiz
    if (structures && state.csvData) {
      const sd = sliceDepths(state.csvData.points || [], sliceActive ? slice : 0, sliceActive ? sliceCount : 1);
      const b = { xMin: state.csvData.xMin, xMax: state.csvData.xMax, yMin: state.csvData.yMin, yMax: state.csvData.yMax };
      _heatmap(
        { ...state.csvData, points: sd.points, pointCount: sd.points.length },
        { bounds: b, slice: sliceActive ? slice : 0, sliceCount: sliceActive ? sliceCount : 1, undergroundOnly: true, structures, structureFilter: state.csvScanFilter, highlight: state.csvHighlightDet || null }
      );
    }

    // Heatmap pick'i yapılarla yeniden bağla
    if (state.csvData) _bindHeatmapPick(state.csvData);

    // 4) Kamerayı yan açıdan ayarla (hacme göre)
    if (state.camera && state.controls) {
      const boxH = autoBox ? autoBox.h : poolSizeM;
      const boxW = autoBox ? autoBox.w : poolSizeM;
      const dist = Math.max(40, (autoBox ? Math.max(autoBox.w, autoBox.h, autoBox.d) : poolSizeM) * 2.7);
      state.camera.position.set(dist * 0.6, dist * 0.3, dist * 0.5);
      state.controls.target.set(0, boxH / 2, 0);
      state.controls.update();
      console.log("[CSV] Kamera ayarlandı, pozisyon:", state.camera.position.toArray());
    }

    if (!quiet) renderCsvPanel();
    runSliceAnalysis();
    if (!quiet) setStatus(t("csv.built") || "3D hazır — " + csvData.pointCount + " nokta");
    console.log("[CSV] Tamamlandı!");
  } catch (e) {
    console.error("CSV 3D hatası:", e);
    setStatus(t("csv.buildError") || "Hata: " + e.message);    } finally {
    if (!quiet) {
      const b = $("btn-csv-build");
      if (b) { b.disabled = false; console.log('[CSV-BUILD] FINALLY buildBtn disabled=false'); }
    }
  }
}

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg;
}

/**
 * Multi-CSV dosya listesini render et.
 * #multi-csv-list container'ını günceller.
 */
function renderMultiCsvList() {
  const datasets = getDatasets();
  const container = $("multi-csv-list");
  const itemsEl = $("multi-csv-items");
  const countEl = $("multi-csv-count");
  if (!container || !itemsEl) return;

  if (datasets.length === 0) {
    container.style.display = "none";
    return;
  }

  container.style.display = "";
  if (countEl) countEl.textContent = `${datasets.length} dosya · ${datasets.reduce((s, d) => s + d.pointCount, 0).toLocaleString()} nkt`;

  const selectedId = state.multiCsv?.selectedId;
  itemsEl.innerHTML = datasets.map(ds => {
    const isSelected = ds.id === selectedId;
    const isActive = state.csvFileName === ds.fileName;
    return `<div class="multi-csv-item" style="display:flex;align-items:center;gap:0.3rem;padding:0.2rem 0.3rem;margin-bottom:0.15rem;border-radius:3px;cursor:pointer;font-size:0.6rem;background:${isActive ? 'rgba(62,220,140,0.1)' : 'transparent'};border-left:2px solid ${ds.color};" data-ds-id="${ds.id}">
      <span style="width:8px;height:8px;border-radius:50%;background:${ds.color};flex-shrink:0;"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${isActive ? '#fff' : 'var(--muted)'};">${esc(ds.name)}</span>
      <span style="color:${ds.color};font-size:0.55rem;flex-shrink:0;">${ds.pointCount.toLocaleString()}</span>
      <button class="multi-csv-vis" data-ds-id="${ds.id}" style="background:none;border:none;cursor:pointer;font-size:0.55rem;padding:0 0.15rem;color:${ds.visible ? ds.color : '#555'};">${ds.visible ? '👁' : '👁‍🗨'}</button>
      <button class="multi-csv-del" data-ds-id="${ds.id}" style="background:none;border:none;cursor:pointer;font-size:0.55rem;padding:0 0.15rem;color:#e85858;">✕</button>
    </div>`;
  }).join("");

  // Event listeners
  itemsEl.querySelectorAll(".multi-csv-item").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".multi-csv-vis") || e.target.closest(".multi-csv-del")) return;
      const id = el.dataset.dsId;
      const ds = datasets.find(d => d.id === id);
      if (ds) {
        selectDataset(id);
        state.csvData = ds.csvData;
        state.csvContent = ds.csvContent;
        state.csvFileName = ds.fileName;
        try {
          _heatmap(ds.csvData, {});
          _bindHeatmapPick(ds.csvData);
        } catch (err) {}
        renderCsvPanel();
        renderMultiCsvList();
        runSliceAnalysis();
        setStatus(`Seçildi: ${ds.name} (${ds.pointCount} nokta)`);
      }
    });
  });
  itemsEl.querySelectorAll(".multi-csv-vis").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.dsId;
      const ds = datasets.find(d => d.id === id);
      if (ds) {
        setDatasetVisible(id, !ds.visible);
        renderMultiCsvList();
      }
    });
  });
  itemsEl.querySelectorAll(".multi-csv-del").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.dsId;
      removeDataset(id);
      const remaining = getDatasets();
      if (remaining.length > 0) {
        const last = remaining[remaining.length - 1];
        state.csvData = last.csvData;
        state.csvContent = last.csvContent;
        state.csvFileName = last.fileName;
        try {
          _heatmap(last.csvData, {});
          _bindHeatmapPick(last.csvData);
        } catch (err) {}
      } else {
        state.csvData = null;
        state.csvContent = null;
        state.csvFileName = null;
      }
      renderCsvPanel();
      renderMultiCsvList();
      runSliceAnalysis();
    });
  });
}

let _cleanupPick = null;

/**
 * CSV yapı bilgi paneli — 2D heatmap sembolü veya 3D yapı kutusu tıklamasıyla açılır.
 * Panel ilk kullanımda oluşturulur (DTA paneliyle çakışmasın diye sol altta).
 */
function getCsvStructInfoPanel() {
  let el = document.getElementById('csv-struct-info');
  if (!el) {
    el = document.createElement('div');
    el.id = 'csv-struct-info';
    el.className = 'struct-info-panel';
    el.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:998;min-width:280px;max-width:360px;display:none;';
    document.body.appendChild(el);
  }
  return el;
}

export function renderCsvStructInfo(hit) {
  const panel = getCsvStructInfoPanel();
  if (!hit) {
    panel.style.display = 'none';
    // Vurguyu temizle
    state.csvHighlightDet = null;
    if (state.csvData) {
      const sd = sliceDepths(state.csvData.points || [], Number($("csv-depth-slice")?.value) || 0, getSliceCount());
      const b = { xMin: state.csvData.xMin, xMax: state.csvData.xMax, yMin: state.csvData.yMin, yMax: state.csvData.yMax };
      _heatmap(
        { ...state.csvData, points: sd.points, pointCount: sd.points.length },
        { bounds: b, slice: Number($("csv-depth-slice")?.value) || 0, sliceCount: getSliceCount(), undergroundOnly: true, structures: state.csvStructures, structureFilter: state.csvScanFilter, highlight: null }
      );
    }
    return;
  }
  const { type, data: d, dist } = hit;
  const num = d._num || '';
  let rows = '';
  if (type === 'oda') {
    const top = Number(d.topFromSurfaceM) || 0;
    const bot = Number(d.bottomFromSurfaceM) || (top + 2.5);
    const w = Number(d.widthM) || 0;
    const l = Number(d.lengthM) || 0;
    const strength = d.strength != null ? d.strength.toFixed(3) : '—';
    rows = [
      `<div class="si-row"><span class="si-label">Konum (X,Z)</span><span class="si-value">${Number(d.cx||0).toFixed(1)}m, ${Number(d.cy||0).toFixed(1)}m</span></div>`,
      `<div class="si-row"><span class="si-label">Derinlik</span><span class="si-value">${top.toFixed(1)}m – ${bot.toFixed(1)}m</span></div>`,
      `<div class="si-row"><span class="si-label">Boyut</span><span class="si-value">${w.toFixed(1)} × ${l.toFixed(1)} m</span></div>`,
      `<div class="si-row"><span class="si-label">Yükseklik</span><span class="si-value">${(bot - top).toFixed(1)} m</span></div>`,
      `<div class="si-row"><span class="si-label">Manyetik güç</span><span class="si-value" style="color:#7eb6ff">${strength}</span></div>`,
    ].join('');
  } else if (type === 'tünel') {
    const x0 = Number(d.x0)||0, z0 = Number(d.y0)||0;
    const x1 = Number(d.x1)||0, z1 = Number(d.y1)||0;
    const len = Math.hypot(x1-x0, z1-z0);
    const depth = Number(d.floorFromSurfaceM) || 0;
    const w = Number(d.widthM) || 0;
    const strength = d.strength != null ? d.strength.toFixed(3) : '—';
    rows = [
      `<div class="si-row"><span class="si-label">Başlangıç</span><span class="si-value">X:${x0.toFixed(1)} Z:${z0.toFixed(1)}</span></div>`,
      `<div class="si-row"><span class="si-label">Bitiş</span><span class="si-value">X:${x1.toFixed(1)} Z:${z1.toFixed(1)}</span></div>`,
      `<div class="si-row"><span class="si-label">Uzunluk</span><span class="si-value">${len.toFixed(1)} m</span></div>`,
      `<div class="si-row"><span class="si-label">Derinlik</span><span class="si-value">${depth.toFixed(1)} m</span></div>`,
      `<div class="si-row"><span class="si-label">Genişlik</span><span class="si-value">${w.toFixed(1)} m</span></div>`,
      `<div class="si-row"><span class="si-label">Manyetik güç</span><span class="si-value" style="color:#4ec0d4">${strength}</span></div>`,
    ].join('');
  } else if (type === 'metal') {
    const depth = Number(d.depthFromSurfaceM) || 0;
    const w = Number(d.widthM) || 0;
    const strength = d.strength != null ? d.strength.toFixed(3) : '—';
    rows = [
      `<div class="si-row"><span class="si-label">Konum (X,Z)</span><span class="si-value">${Number(d.cx||0).toFixed(1)}m, ${Number(d.cy||0).toFixed(1)}m</span></div>`,
      `<div class="si-row"><span class="si-label">Derinlik</span><span class="si-value">${depth.toFixed(1)} m</span></div>`,
      `<div class="si-row"><span class="si-label">Boyut</span><span class="si-value">${w.toFixed(1)} m</span></div>`,
      `<div class="si-row"><span class="si-label">Manyetik güç</span><span class="si-value" style="color:#ff6a4a">${strength}</span></div>`,
    ].join('');
  }
  const badgeCls = type === 'oda' ? 'oda' : type === 'tünel' ? 'tunel' : 'metal';
  const label = type.charAt(0).toUpperCase() + type.slice(1);

  // ── Yakın yapılar listesi ──
  let nearbyHtml = '';
  const structs = state.csvStructures;
  if (structs) {
    // Seçili yapının merkez koordinatını al
    let myX = 0, myZ = 0;
    if (type === 'oda' || type === 'metal') {
      myX = Number(d.cx) || 0; myZ = Number(d.cy) || 0;
    } else if (type === 'tünel') {
      myX = ((Number(d.x0)||0) + (Number(d.x1)||0)) / 2;
      myZ = ((Number(d.y0)||0) + (Number(d.y1)||0)) / 2;
    }
    const allStructs = [];
    (structs.chambers || []).forEach((s, i) => {
      allStructs.push({ kind: 'Oda', num: i + 1, x: Number(s.cx)||0, z: Number(s.cy)||0, strength: s.strength });
    });
    (structs.tunnels || []).forEach((s, i) => {
      allStructs.push({ kind: 'Tünel', num: allStructs.length + 1, x: ((Number(s.x0)||0)+(Number(s.x1)||0))/2, z: ((Number(s.y0)||0)+(Number(s.y1)||0))/2, strength: s.strength });
    });
    (structs.metals || []).forEach((s, i) => {
      allStructs.push({ kind: 'Metal', num: allStructs.length + 1, x: Number(s.cx)||0, z: Number(s.cy)||0, strength: s.strength });
    });
    const nearby = allStructs
      .map(s => ({ ...s, dist: Math.hypot(s.x - myX, s.z - myZ) }))
      .filter(s => s.dist > 0.05)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);
    if (nearby.length > 0) {
      const colorMap = { 'Oda': '#7eb6ff', 'Tünel': '#4ec0d4', 'Metal': '#ff6a4a' };
      nearbyHtml = `<div class="si-nearby">Yakın: ${nearby.map(s =>
        `<span style="color:${colorMap[s.kind]||'#aaa'}">${s.kind} #${s.num}</span> (${s.dist.toFixed(1)}m)`
      ).join(' · ')}</div>`;
    }
  }

  panel.innerHTML = [
    `<div class="si-header">`,
      `<span class="si-badge ${badgeCls}">${label}${num ? ' ' + num : ''}</span>`,
      `<span class="si-title">${label} Detayı</span>`,
      `<button class="si-close" id="si-close-btn">✕</button>`,
    `</div>`,
    rows,
    dist != null ? `<div class="si-nearby">Tıklama mesafesi: ${dist.toFixed(1)}m</div>` : '',
    nearbyHtml,
  ].join('');
  panel.style.display = '';

  // ── 2D heatmap senkronizasyonu: tıklanan yapıyı haritada vurgula ──
  if (state.csvData && state.csvStructures) {
    const kindMap = { oda: 'chamber', tunel: 'tunnel', metal: 'metal' };
    const structKind = kindMap[type];
    if (structKind && num) {
      state.csvHighlightDet = { type: structKind, idx: (Number(num) || 1) - 1 };
      const sd = sliceDepths(state.csvData.points || [], Number($("csv-depth-slice")?.value) || 0, getSliceCount());
      const b = { xMin: state.csvData.xMin, xMax: state.csvData.xMax, yMin: state.csvData.yMin, yMax: state.csvData.yMax };
      _heatmap(
        { ...state.csvData, points: sd.points, pointCount: sd.points.length },
        { bounds: b, slice: Number($("csv-depth-slice")?.value) || 0, sliceCount: getSliceCount(), undergroundOnly: true, structures: state.csvStructures, structureFilter: state.csvScanFilter, highlight: state.csvHighlightDet }
      );
    }
  }

  document.getElementById('si-close-btn')?.addEventListener('click', () => {
    panel.style.display = 'none';
    state.csvHighlightDet = null;
    if (state.csvData) {
      const sd = sliceDepths(state.csvData.points || [], Number($("csv-depth-slice")?.value) || 0, getSliceCount());
      const b = { xMin: state.csvData.xMin, xMax: state.csvData.xMax, yMin: state.csvData.yMin, yMax: state.csvData.yMax };
      _heatmap(
        { ...state.csvData, points: sd.points, pointCount: sd.points.length },
        { bounds: b, slice: Number($("csv-depth-slice")?.value) || 0, sliceCount: getSliceCount(), undergroundOnly: true, structures: state.csvStructures, structureFilter: state.csvScanFilter, highlight: null }
      );
    }
  });
}

function _bindHeatmapPick(csvData) {
  if (_cleanupPick) { _cleanupPick(); _cleanupPick = null; }
  if (!csvData?.points?.length) return;
  const canvas = document.getElementById('csv-heatmap-canvas');
  const tooltip = document.getElementById('csv-heatmap-tooltip');
  if (!canvas || !tooltip) return;

  const bounds = {
    xMin: csvData.xMin,
    xMax: csvData.xMax,
    yMin: csvData.yMin,
    yMax: csvData.yMax,
  };
  const gridW = Math.min(128, Math.max(32, Math.ceil(Math.sqrt(csvData.points.length) / 2)));
  // normParams: piksel→metre dönüşümü için overlay'den al
  const overlay = state.csvOverlay;
  const normParams = overlay?.userData?.normCenter
    ? { scale: overlay.userData.anomalyStats?.scale || null, center: overlay.userData.normCenter }
    : null;
  _cleanupPick = bindHeatmapPick(canvas, csvData.points, bounds, tooltip, {
    gridW, gridH: gridW,
    structures: state.csvStructures || null,
    structureFilter: state.csvScanFilter || null,
    onStructureClick: renderCsvStructInfo,
    normParams,
  });
}

// ── CSV filtre tercihlerini kaydet / yükle ──

let _csvPrefsLoaded = false;

/** Slider mevcut değerlerini AppSettings'e kaydet (debounce). */
let _persistTimer = null;
function persistCsvPrefs() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    setCsvFilterPrefs({
      poolSize: Number($("csv-pool-size")?.value) || 30,
      sigma: Number($("csv-sigma")?.value) || 2,
      fit: Number($("csv-fit")?.value) || 85,
      autoBox: !!$("csv-auto-box")?.checked,
      pointSize: Number($("csv-point-size")?.value) || 0.2,
      sliceCount: Number($("csv-slice-count")?.value) || 8,
      threshold: Number($("csv-threshold")?.value) || 0.9,
      minStrength: Number($("csv-min-strength")?.value) || 0.45,
      gridRes: Number($("csv-grid-res")?.value) || 32,
      undergroundOnly: $("csv-underground-filter")?.checked !== false,
    }).catch(e => console.warn('[CSV] Ayarlar kaydedilemedi:', e));
  }, 350);
}

/** AppSettings'ten CSV tercihlerini oku ve slider'lara uygula (bir kez). */
async function loadCsvPrefs() {
  if (_csvPrefsLoaded) return;
  _csvPrefsLoaded = true;
  try {
    const s = await getAppSettings();
    if (!s) return;
    const setSlider = (id, val, labelId, fmt) => {
      const el = $(id);
      if (el && val != null) { el.value = val; }
      if (labelId && el) {
        const lbl = $(labelId);
        if (lbl) lbl.textContent = fmt ? fmt(el.value) : el.value;
      }
    };
    setSlider("csv-pool-size", s.csvPoolSize ?? s.csv_pool_size, "csv-pool-size-label", v => v + 'm');
    setSlider("csv-sigma", s.csvSigma ?? s.csv_sigma, "csv-sigma-label", v => Number(v).toFixed(1));
    setSlider("csv-fit", s.csvFit ?? s.csv_fit, "csv-fit-label", v => v + '%');
    setSlider("csv-point-size", s.csvPointSize ?? s.csv_point_size, "csv-point-size-label", v => Number(v).toFixed(2));
    setSlider("csv-slice-count", s.csvSliceCount ?? s.csv_slice_count, "csv-slice-count-label", v => v);
    setSlider("csv-threshold", s.csvThreshold ?? s.csv_threshold, "csv-threshold-label", v => Number(v).toFixed(2));
    setSlider("csv-min-strength", s.csvMinStrength ?? s.csv_min_strength, "csv-min-strength-label", v => Number(v).toFixed(2));
    setSlider("csv-grid-res", s.csvGridRes ?? s.csv_grid_res, "csv-grid-res-label", v => v + '³');
    const autoBox = $("csv-auto-box");
    if (autoBox) autoBox.checked = !!(s.csvAutoBox ?? s.csv_auto_box);
    const ug = $("csv-underground-filter");
    if (ug) ug.checked = !!(s.csvUndergroundOnly ?? s.csv_underground_only ?? true);
    console.log('[CSV] Kayıtlı tercihler yüklendi');
  } catch (e) {
    console.warn('[CSV] Tercih yükleme hatası:', e);
  }
}

/**
 * Tüm CSV yapılarının sığıdığı bir kamera açısı hesapla ve flyTo ile oraya git.
 * Bounding box'ı XZ düzleminde (yatay) ve Y ekseninde (derinlik) hesaplar.
 */
function zoomToFitAll() {
  const structs = state.csvStructures;
  if (!structs) return;
  const allPts = [];
  (structs.chambers || []).forEach(ch => {
    if (ch.kind === 'cavity') return;
    const cx = Number(ch.cx) || 0;
    const cy = Number(ch.cy) || 0;
    const top = Number(ch.topFromSurfaceM) || 0.4;
    const bot = Number(ch.bottomFromSurfaceM) || (top + 2.5);
    const w = Number(ch.widthM) || 2;
    const l = Number(ch.lengthM) || 2;
    allPts.push(
      { x: cx - w / 2, y: -bot, z: cy - l / 2 },
      { x: cx + w / 2, y: -top, z: cy + l / 2 },
    );
  });
  (structs.tunnels || []).forEach(t => {
    const x0 = Number(t.x0) || 0, z0 = Number(t.y0) || 0;
    const x1 = Number(t.x1) || 0, z1 = Number(t.y1) || 0;
    const depth = Number(t.floorFromSurfaceM) || 2;
    const w = Number(t.widthM) || 1.2;
    allPts.push(
      { x: Math.min(x0, x1) - w / 2, y: -depth - 0.5, z: Math.min(z0, z1) - w / 2 },
      { x: Math.max(x0, x1) + w / 2, y: -depth + 0.5, z: Math.max(z0, z1) + w / 2 },
    );
  });
  (structs.metals || []).forEach(m => {
    const cx = Number(m.cx) || 0;
    const cy = Number(m.cy) || 0;
    const depth = Number(m.depthFromSurfaceM) || 1;
    const w = Number(m.widthM) || 1.2;
    allPts.push(
      { x: cx - w / 2, y: -depth - 0.3, z: cy - w / 2 },
      { x: cx + w / 2, y: -depth + 0.3, z: cy + w / 2 },
    );
  });
  if (allPts.length === 0) return;

  // Bounding box hesapla
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  for (const p of allPts) {
    if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
    if (p.z < zMin) zMin = p.z; if (p.z > zMax) zMax = p.z;
  }

  // Merkez ve yarıçap
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  const cz = (zMin + zMax) / 2;
  const dx = xMax - xMin;
  const dy = yMax - yMin;
  const dz = zMax - zMin;
  const radius = Math.max(dx, dy, dz, 2) * 0.7;

  const pos = new THREE.Vector3(cx, cy, cz);
  const nCh = (structs.chambers || []).length;
  const nTu = (structs.tunnels || []).length;
  const nMe = (structs.metals || []).length;
  flyCameraTo(pos, radius, `Tüm yapılar (${nCh} oda, ${nTu} tünel, ${nMe} metal)`,
    { duration: 700, distScale: 2.8, heightScale: 0.60 });
}

/**
 * CSV panel olaylarını bağla.
 */
export function bindCsvPanel() {
  const panel = $("csv-panel");
  if (!panel || panel.dataset.bound === "1") return;
  panel.dataset.bound = "1";

  // Multi-CSV modülünü başlat
  initMultiCsv();

  // Kayıtlı tercihleri slider'lara uygula (bir kez)
  loadCsvPrefs();

  // ── Toplu Yükle butonu ──
  const multiPickBtn = $("btn-csv-pick-multi");
  if (multiPickBtn) {
    multiPickBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".csv,.txt,.tsv,.xlsx,.xls";
      input.multiple = true;
      input.onchange = async () => {
        if (!input.files?.length) return;
        setStatus(`Toplu yükleme: ${input.files.length} dosya okunuyor...`);
        const datasets = await addFiles(input.files);
        if (datasets.length > 0) {
          // Son eklenen dataset'i aktif yap
          const last = datasets[datasets.length - 1];
          state.csvData = last.csvData;
          state.csvContent = last.csvContent;
          state.csvFileName = last.fileName;
          try {
            _heatmap(last.csvData, {});
            _bindHeatmapPick(last.csvData);
          } catch (e) { console.warn('[MultiCSV] Heatmap hatası:', e); }
          renderCsvPanel();
          renderMultiCsvList();
          runSliceAnalysis();
          setStatus(`${datasets.length} dosya yüklendi — toplam ${datasets.reduce((s,d) => s + d.pointCount, 0)} nokta`);
        }
      };
      input.click();
    });
  }

  // ── Birleştir / Ayrı / Temizle butonları ──
  $("btn-csv-merge-overlay")?.addEventListener("click", () => {
    setMergeMode("overlay");
    const merged = getMergedData();
    if (merged) {
      state.csvData = merged;
      state.csvContent = merged.points.map(p => `${p.x},${p.y},${p.z},${p.magnetic}`).join('\n');
      try {
        _heatmap(merged, {});
        _bindHeatmapPick(merged);
      } catch (e) {}
      renderCsvPanel();
      renderMultiCsvList();
      runSliceAnalysis();
      setStatus(`Birleştirildi: ${merged.pointCount} toplam nokta`);
    }
  });
  $("btn-csv-merge-separate")?.addEventListener("click", () => {
    setMergeMode("separate");
    renderMultiCsvList();
    setStatus("Ayrı mod: her dosya ayrı işleniyor");
  });
  $("btn-csv-clear-all")?.addEventListener("click", () => {
    clearAll();
    state.csvData = null;
    state.csvContent = null;
    state.csvFileName = null;
    renderCsvPanel();
    renderMultiCsvList();
    setStatus("Tüm CSV dosyaları temizlendi");
  });

  // ── Drop zone: çoklu dosya desteği ──
  const dropzone = $("csv-dropzone");
  if (dropzone) {
    dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      if (files.length === 1) {
        // Tek dosya — mevcut akış
        pickCsv();
      } else {
        // Çoklu dosya — yeni akış
        setStatus(`Toplu yükleme: ${files.length} dosya okunuyor...`);
        const datasets = await addFiles(files);
        if (datasets.length > 0) {
          const last = datasets[datasets.length - 1];
          state.csvData = last.csvData;
          state.csvContent = last.csvContent;
          state.csvFileName = last.fileName;
          try {
            _heatmap(last.csvData, {});
            _bindHeatmapPick(last.csvData);
          } catch (e) {}
          renderCsvPanel();
          renderMultiCsvList();
          runSliceAnalysis();
          setStatus(`${datasets.length} dosya yüklendi — toplam ${datasets.reduce((s,d) => s + d.pointCount, 0)} nokta`);
        }
      }
    });
  }

  console.log('[CSV-BIND] bindCsvPanel called, panel=', !!panel, 'bound=', panel.dataset.bound);
  const pickBtn = $("btn-csv-pick");
  const buildBtnEl = $("btn-csv-build");
  const toggleBtnEl = $("btn-csv-toggle");
  console.log('[CSV-BIND] pickBtn=', !!pickBtn, 'buildBtn=', !!buildBtnEl, 'toggleBtn=', !!toggleBtnEl);
  console.log('[CSV-BIND] pickBtn.disabled=', pickBtn?.disabled, 'buildBtn.disabled=', buildBtnEl?.disabled, 'toggleBtn.disabled=', toggleBtnEl?.disabled);
  pickBtn?.addEventListener("click", () => { console.log('[CSV-BTN] pickBtn CLICKED'); pickCsv(); });
  buildBtnEl?.addEventListener("click", () => { console.log('[CSV-BTN] buildBtn CLICKED, csvContent=', !!state.csvContent); build3dFromCsv(); });
  // Sigma slider label + 3D overlay otomatik yeniden oluşturma
  const sigmaSlider = $("csv-sigma");
  const sigmaLabel = $("csv-sigma-label");
  let _sigmaRebuildTimer = null;
  const SIGMA_MIN = 1;
  const SIGMA_MAX = 4;
  function clampSigma(v) {
    return Math.max(SIGMA_MIN, Math.min(SIGMA_MAX, v));
  }
  function getSigma() {
    return clampSigma(Number(sigmaSlider?.value) || 2);
  }
  if (sigmaSlider && sigmaLabel) {
    sigmaSlider.addEventListener("input", () => {
      const raw = Number(sigmaSlider.value) || 2;
      const val = clampSigma(raw);
      if (val !== raw) sigmaSlider.value = val;
      sigmaLabel.textContent = val.toFixed(1);
      // Dış sınırdayken renkli uyarı
      sigmaLabel.style.color = (val <= SIGMA_MIN || val >= SIGMA_MAX) ? '#e8a858' : '';
      if (state.csvData) {
        _heatmap(state.csvData, { sigma: val, structures: state.csvStructures, structureFilter: state.csvScanFilter, highlight: state.csvHighlightDet || null });
      }
      // 3D overlay varsa debounce ile yeniden oluştur
      if (state.csvData && state.csvOverlay) {
        if (_sigmaRebuildTimer) clearTimeout(_sigmaRebuildTimer);
        _sigmaRebuildTimer = setTimeout(() => {
          build3dFromCsv(true);
        }, 400);
      }
    });
  }

  // Havuz boyutu slider — label güncelle + 3D overlay'ı otomatik yeniden oluştur
  const poolSlider = $("csv-pool-size");
  const poolLabel = $("csv-pool-size-label");
  let _poolRebuildTimer = null;
  if (poolSlider && poolLabel) {
    poolSlider.addEventListener("input", () => {
      poolLabel.textContent = poolSlider.value + "m";
      // Overlay varsa debounce ile otomatik yeniden oluştur
      if (state.csvData && state.csvOverlay) {
        if (_poolRebuildTimer) clearTimeout(_poolRebuildTimer);
        _poolRebuildTimer = setTimeout(() => {
          build3dFromCsv(true);
        }, 300);
      }
    });
  }

  // Yeraltı filtresi — heatmap + 3D overlay otomatik yeniden oluştur
  const ufBox = $("csv-underground-filter");
  let _ufRebuildTimer = null;
  if (ufBox) {
    ufBox.addEventListener("change", () => {
      const on = ufBox.checked;
      if (state.csvData) _heatmap(state.csvData, { undergroundOnly: on, structures: state.csvStructures, structureFilter: state.csvScanFilter, highlight: state.csvHighlightDet || null });
      if (state.csvData && state.csvOverlay) {
        if (_ufRebuildTimer) clearTimeout(_ufRebuildTimer);
        _ufRebuildTimer = setTimeout(() => build3dFromCsv(true), 300);
      }
    });
  }

  // Derinlik dilimi slider — 2D heatmap'ı anında, 3D overlay'ı debounce ile güncelle
  const sliceSlider = $("csv-depth-slice");
  const sliceLabel = $("csv-depth-slice-label");
  let _sliceRebuildTimer = null;
  function refreshSliceView() {
    const v = Number(sliceSlider?.value) || 0;
    const total = getSliceCount();
    if (!state.csvData) return;
    const sd = sliceDepths(state.csvData.points || [], v, total);
    const labelText = v === 0
      ? "Tümü"
      : `${v}/${total} (${fmtSlice(sd.yMin)}..${fmtSlice(sd.yMax)})`;
    if (sliceLabel) sliceLabel.textContent = labelText;
    const bounds = {
      xMin: state.csvData.xMin,
      xMax: state.csvData.xMax,
      yMin: state.csvData.yMin,
      yMax: state.csvData.yMax,
    };
    _heatmap(
      { ...state.csvData, points: sd.points, pointCount: sd.points.length },
      { bounds, slice: v, sliceCount: total, undergroundOnly: true, structures: state.csvStructures, structureFilter: state.csvScanFilter, highlight: state.csvHighlightDet || null }
    );
  }
  if (sliceSlider && sliceLabel) {
    sliceSlider.addEventListener("input", () => {
      refreshSliceView();
      if (state.csvOverlay) {
        if (_sliceRebuildTimer) clearTimeout(_sliceRebuildTimer);
        _sliceRebuildTimer = setTimeout(() => build3dFromCsv(true), 350);
      }
    });
  }

  // Dilim sayısı — 4..16; aktif dilimi kenetler, rapor + heatmap + 3D günceller
  const scSlider = $("csv-slice-count");
  const scLabel = $("csv-slice-count-label");
  let _scRebuildTimer = null;
  if (scSlider && scLabel) {
    scSlider.addEventListener("input", () => {
      const sc = getSliceCount();
      if (scLabel) scLabel.textContent = String(sc);
      if (!state.csvData) return;
      // Aktif dilim yeni üst sınırı aşarsa kenarına çek
      if (sliceSlider) {
        const v = Number(sliceSlider.value) || 0;
        if (v > sc) sliceSlider.value = String(sc);
        if (v > 0) {
          // Slider max yeni sayıya ayarlansın
          sliceSlider.max = String(sc);
          refreshSliceView();
        }
      }
      runSliceAnalysis();
      if (state.csvOverlay) {
        if (_scRebuildTimer) clearTimeout(_scRebuildTimer);
        _scRebuildTimer = setTimeout(() => build3dFromCsv(true), 350);
      }
    });
  }

  // Tespit eşiği sliderları — rapor + 3D overlay canlı güncelle (debounce)
  let _thrTimer = null;
  function rebindThresholds() {
    const thrEl = $("csv-threshold");
    const msEl = $("csv-min-strength");
    const thrLabel = $("csv-threshold-label");
    const msLabel = $("csv-min-strength-label");
    if (thrLabel) thrLabel.textContent = (Number(thrEl?.value) || 0.9).toFixed(2);
    if (msLabel) msLabel.textContent = (Number(msEl?.value) || 0.45).toFixed(2);
    if (!state.csvData) return;
    runSliceAnalysis();
    if (state.csvOverlay) {
      if (_thrTimer) clearTimeout(_thrTimer);
      _thrTimer = setTimeout(() => build3dFromCsv(true), 350);
    }
  }
  const thrSlider = $("csv-threshold");
  if (thrSlider) {
    thrSlider.addEventListener("input", rebindThresholds);
  }
  const msSlider = $("csv-min-strength");
  if (msSlider) {
    msSlider.addEventListener("input", rebindThresholds);
  }

  // Sığdırma payı slider — 3D overlay'ı otomatik yeniden oluştur
  const fitSlider = $("csv-fit");
  const fitLabel = $("csv-fit-label");
  let _fitRebuildTimer = null;
  if (fitSlider && fitLabel) {
    fitSlider.addEventListener("input", () => {
      fitLabel.textContent = fitSlider.value + "%";
      if (state.csvData && state.csvOverlay) {
        if (_fitRebuildTimer) clearTimeout(_fitRebuildTimer);
        _fitRebuildTimer = setTimeout(() => build3dFromCsv(true), 300);
      }
    });
  }

  // Otomatik sığdırma onay kutusu — 3D overlay'ı yeniden oluştur
  const autoBoxEl = $("csv-auto-box");
  let _autoBoxRebuildTimer = null;
  if (autoBoxEl) {
    autoBoxEl.addEventListener("change", () => {
      if (state.csvData && state.csvOverlay) {
        if (_autoBoxRebuildTimer) clearTimeout(_autoBoxRebuildTimer);
        _autoBoxRebuildTimer = setTimeout(() => build3dFromCsv(true), 300);
      }
    });
  }

  // Nokta boyutu slider — live update (sadece material size, rebuild yok)
  const ptSizeSlider = $("csv-point-size");
  const ptSizeLabel = $("csv-point-size-label");
  if (ptSizeSlider && ptSizeLabel) {
    ptSizeSlider.addEventListener("input", () => {
      const val = Number(ptSizeSlider.value);
      ptSizeLabel.textContent = val.toFixed(2);
      // Overlay içindeki pointsMesh material'ını güncelle
      if (state.csvOverlay) {
        state.csvOverlay.traverse(obj => {
          if (obj.isPoints && obj.material) {
            obj.material.size = val;
            obj.material.needsUpdate = true;
          }
        });
      }
    });
  }

  // Grid çözünürlüğü slider — debounce ile 3D overlay'ı yeniden oluştur
  const gridResSlider = $("csv-grid-res");
  const gridResLabel = $("csv-grid-res-label");
  let _gridRebuildTimer = null;
  if (gridResSlider && gridResLabel) {
    gridResSlider.addEventListener("input", () => {
      const val = Number(gridResSlider.value) || 20;
      gridResLabel.textContent = val + "³";
      if (state.csvData && state.csvOverlay) {
        if (_gridRebuildTimer) clearTimeout(_gridRebuildTimer);
        _gridRebuildTimer = setTimeout(() => {
          build3dFromCsv(true);
        }, 400);
      }
    });
  }

  $("btn-csv-toggle")?.addEventListener("click", () => {
    if (!state.csvOverlay) return;
    const visible = !state.csvOverlay.visible;
    toggleCsvOverlay(visible);
    renderCsvPanel();
  });

  // Tümünü Gör — tüm CSV yapılarını sığdır
  $("btn-csv-zoom-all")?.addEventListener("click", () => {
    zoomToFitAll();
  });

  // Tespit çipleri / detay satırları — tıklayınca 3D'de o yapıya git + 2D heatmap'te vurgula
  const reportEl = $("csv-slice-report");
  if (reportEl) {
    reportEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".det-chip, .sd-line");
      if (!btn) return;
      const kind = btn.dataset.kind;
      const slice = Number(btn.dataset.slice) || 1;
      const idx = Number(btn.dataset.idx) || 0;

      // Heatmap vurgusu
      state.csvHighlightDet = { type: kind, idx };
      if (state.csvData) {
        const sd = sliceDepths(state.csvData.points || [], Number($("csv-depth-slice")?.value) || 0, getSliceCount());
        const b = { xMin: state.csvData.xMin, xMax: state.csvData.xMax, yMin: state.csvData.yMin, yMax: state.csvData.yMax };
        _heatmap(
          { ...state.csvData, points: sd.points, pointCount: sd.points.length },
          { bounds: b, slice: Number($("csv-depth-slice")?.value) || 0, sliceCount: getSliceCount(), undergroundOnly: true, structures: state.csvStructures, structureFilter: state.csvScanFilter, highlight: state.csvHighlightDet }
        );
      }

      // Bilgi paneli
      if (state.csvSliceReport) {
        const rep = state.csvSliceReport;
        const s = rep?.slices?.[slice - 1];
        const det = s?.[kind]?.[idx];
        if (det) {
          renderCsvStructInfo({ type: { chamber: 'oda', tunnel: 'tünel', metal: 'metal' }[kind] || kind, data: det, dist: null });
        }
      }

      goToDetection(kind, slice, idx);
    });

    // Rapor filtreleri (oda / tünel / metal onay kutuları) — görünürlük + 3D rebuild
    let _filterRebuildTimer = null;
    const scheduleFilterRebuild = () => {
      clearTimeout(_filterRebuildTimer);
      _filterRebuildTimer = setTimeout(() => {
        build3dFromCsv();
        // Heatmap sembollerini de güncelle
        if (state.csvData) {
          const sd = sliceDepths(state.csvData.points || [], Number(sliceSlider?.value) || 0, getSliceCount());
          const b = { xMin: state.csvData.xMin, xMax: state.csvData.xMax, yMin: state.csvData.yMin, yMax: state.csvData.yMax };
          _heatmap(
            { ...state.csvData, points: sd.points, pointCount: sd.points.length },
            { bounds: b, slice: Number(sliceSlider?.value) || 0, sliceCount: getSliceCount(), undergroundOnly: true, structures: state.csvStructures, structureFilter: state.csvScanFilter, highlight: state.csvHighlightDet || null }
          );
        }
      }, 300);
    };
    reportEl.addEventListener("change", (e) => {
      const cb = e.target.closest(".scan-f");
      if (!cb?.dataset?.kind) return;
      const filt = state.csvScanFilter || (state.csvScanFilter = { chamber: true, tunnel: true, metal: true });
      filt[cb.dataset.kind] = cb.checked;
      renderSliceReport();
      scheduleFilterRebuild();
    });

    // Hazır önayar butonları: tek tıkla filtre setleri
    reportEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".scan-preset");
      if (!btn?.dataset?.preset) return;
      const PRESETS = {
        all:   { chamber: true,  tunnel: true,  metal: true },
        void:  { chamber: true,  tunnel: true,  metal: false },
        metal: { chamber: false, tunnel: false, metal: true },
        room:  { chamber: true,  tunnel: false, metal: false },
      };
      const p = PRESETS[btn.dataset.preset];
      if (!p) return;
      const filt = state.csvScanFilter || (state.csvScanFilter = { chamber: true, tunnel: true, metal: true });
      filt.chamber = p.chamber;
      filt.tunnel = p.tunnel;
      filt.metal = p.metal;
      renderSliceReport();
      scheduleFilterRebuild();
    });
  }

  // ── Tüm CSV slider/checkbox değişimlerini yakala → kaydet ──
  panel.addEventListener("input", (e) => {
    if (e.target.matches('input[type=range]')) persistCsvPrefs();
  });
  panel.addEventListener("change", (e) => {
    if (e.target.matches('input[type=checkbox]')) persistCsvPrefs();
  });

}
