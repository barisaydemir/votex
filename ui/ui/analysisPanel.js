/**
 * Analiz Raporu Paneli — her tespit için insancıl Türkçe rapor gösterir.
 * analysis_report.rs modülünün çıktısını UI'da sunar.
 */
import { state } from "../app/state.js";
import { dimensionsOf, volumeM3Of, formatVolumeM3 } from "../viewer/volume.js";

import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n/index.js";
import { focusStructure } from "../viewer/labels.js";
import { attachNoteButtons } from "./detectionNotes.js";
import { buildLegacyFieldModel, statusLabel, escapeLegacyHtml } from "../viewer/legacyDikModel.js";

let _panel = null;
let _currentReport = null;

/**
 * Analiz raporu panelini aç/kapat.
 */
export function toggleAnalysisPanel() {
  if (_panel && _panel.style.display !== "none") {
    _panel.style.display = "none";
    return;
  }
  showAnalysisPanel();
}

/**
 * Analiz raporu panelini göster.
 */
export async function showAnalysisPanel() {
  if (state.legacyDikResult) {
    renderLegacyFieldReport(state.legacyDikResult);
    return;
  }
  // Mevcut yapısal verileri al
  const surface = state.surfaceState;
  if (!surface) {
    showEmptyState("Önce bir analiz çalıştırın");
    return;
  }

  const structures = surface.structures || {};
  const { chambers = [], tunnels = [], metals = [] } = structures;

  if (chambers.length === 0 && tunnels.length === 0) {
    showEmptyState("Tespit edilen yapı yok");
    return;
  }

  // Backend'den rapor üret
  try {
    const report = await invoke("generate_analysis_reports", {
      chambers,
      tunnels,
      metals,
    });
    _currentReport = report;
    renderReport(report);
  } catch (err) {
    showEmptyState(`Rapor üretilemedi: ${err}`);
  }
}

function renderLegacyFieldReport(result) {
  ensurePanel();
  const model = state.legacyFieldModel || buildLegacyFieldModel(result);
  state.legacyFieldModel = model;
  const strong = model.detections.filter((detection) => detection.status === "strong");
  const first = strong[0] || model.detections[0];
  const safe = escapeLegacyHtml;
  const detectionCards = model.detections.map((detection, index) => `
    <article class="ap-field-detection" data-legacy-detection="${detection.detectionId}">
      <div class="ap-field-detection-head"><b>#${index + 1} · ${safe(detection.type)}</b><span class="ap-field-status ${detection.status}">${statusLabel(detection.status)}</span></div>
      <div>Adım ${detection.stepIndex ?? "—"} · Hat metresi <b>${detection.stationM.toFixed(2)} m</b> · Adım içi offset <b>${detection.offsetM >= 0 ? "+" : ""}${detection.offsetM.toFixed(2)} m</b></div>
      <div>Derinlik <b>${detection.depthTopM.toFixed(2)}–${detection.depthBottomM.toFixed(2)} m</b> · Güven <b>%${Math.round(detection.confidence * 100)}</b> · Güç ${detection.strength.toFixed(1)}σ</div>
      <div><b>Ölçü</b> ${detection.dimensions.width.toFixed(2)} × ${detection.dimensions.length.toFixed(2)} × ${detection.dimensions.height.toFixed(2)} m · <b>Yaklaşık hacim</b> ${formatVolumeM3(detection.volumeM3)}</div>
      <div class="ap-field-recommendation">Öneri: ${safe(detection.recommendation)}</div>
      <div class="ap-field-actions"><button type="button" class="mil" data-legacy-report-show="${detection.detectionId}">3D’de göster</button><button type="button" class="mil" data-legacy-report-only="${detection.detectionId}">Sadece bunu göster</button></div>
    </article>`).join("");
  _panel.innerHTML = `
    <div class="ap-header"><span class="ap-title">📊 Saha Sonucu · LEGACY3DMAG</span><button class="ap-close" onclick="this.closest('.ap-panel').style.display='none'">×</button></div>
    <div class="ap-summary"><b>${model.steps.length} adım</b> · <b>${model.detections.length} tespit</b> · <b>${strong.length} güçlü</b>${first ? `<br/><strong>${safe(first.type)}</strong> · Adım ${first.stepIndex ?? "—"} · ${first.stationM.toFixed(2)} m · ${first.depthTopM.toFixed(2)}–${first.depthBottomM.toFixed(2)} m · %${Math.round(first.confidence * 100)}<br/><span class="ap-field-recommendation">${safe(first.recommendation)}</span>` : "<br/>Önemli tespit bulunamadı."}</div>
    <div class="ap-section"><h3>🔍 Tespitler — ayrı ayrı incele</h3>${detectionCards || `<div class="ap-info">Tespit bulunamadı.</div>`}</div>`;
  _panel.style.display = "block";
  _panel.querySelectorAll("[data-legacy-report-show]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.legacyReportShow;
    const detection = model.detections.find((item) => item.detectionId === id);
    if (!detection) return;
    import("../viewer/legacyDikOverlay.js").then(({ focusLegacyDetection }) => focusLegacyDetection(id));
    if (!String(id).startsWith("legacy-dik-") && state.structureTargets[id]) focusStructure(id);
  }));
  _panel.querySelectorAll("[data-legacy-report-only]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.legacyReportOnly;
    import("../viewer/legacyDikOverlay.js").then(({ focusLegacyDetection }) => focusLegacyDetection(id));
    if (!String(id).startsWith("legacy-dik-") && state.structureTargets[id]) focusStructure(id);
  }));
}

/**
 * Boş durum göster.
 */
function showEmptyState(message) {
  ensurePanel();
  _panel.innerHTML = `
    <div class="ap-header">
      <span class="ap-title">📊 Analiz Raporu</span>
      <button class="ap-close" onclick="this.closest('.ap-panel').style.display='none'">×</button>
    </div>
    <div class="ap-empty">${message}</div>
  `;
  _panel.style.display = "block";
}

/**
 * Raporu panelde göster.
 */
function renderReport(report) {
  ensurePanel();

  const reliabilityColors = {
    high: "#22c55e",
    medium: "#eab308",
    low: "#f97316",
    rejected: "#ef4444",
  };

  const reliabilityLabels = {
    high: "✅ Yüksek",
    medium: "⚠ Orta",
    low: "❌ Düşük",
    rejected: "🚫 Reddedildi",
  };

  let html = `
    <div class="ap-header">
      <span class="ap-title">📊 Analiz Raporu</span>
      <button class="ap-close" onclick="this.closest('.ap-panel').style.display='none'">×</button>
    </div>
    <div class="ap-summary">${report.overall_summary}</div>
    ${report.vpe_used ? '<div style="padding:4px 12px;background:#0f3460;border-radius:6px;font-size:11px;color:#7ef0a8;margin-bottom:8px">🤖 VPE Faz B aktif — ML skorları güvenilirlikle harmanlandı</div>' : ''}
  `;

  // Öncelik sırası
  if (report.priority_list && report.priority_list.length > 0) {
    html += `<div class="ap-section"><h3>🎯 Öncelik Sırası</h3>`;
    for (const item of report.priority_list) {
      html += `<div class="ap-priority">${item}</div>`;
    }
    html += `</div>`;
  }

  // Oda raporları
  if (report.chamber_reports && report.chamber_reports.length > 0) {
    html += `<div class="ap-section"><h3>🏛️ Yapılar (${report.chamber_reports.length})</h3>`;
    for (let i = 0; i < report.chamber_reports.length; i++) {
      const r = report.chamber_reports[i];
      html += renderReportCard(r, reliabilityColors, reliabilityLabels, `chamber-${i}`);
    }
    html += `</div>`;
  }

  // Tünel raporları
  if (report.tunnel_reports && report.tunnel_reports.length > 0) {
    html += `<div class="ap-section"><h3>🚇 Tüller (${report.tunnel_reports.length})</h3>`;
    for (let i = 0; i < report.tunnel_reports.length; i++) {
      const r = report.tunnel_reports[i];
      html += renderReportCard(r, reliabilityColors, reliabilityLabels, `tunnel-${i}`);
    }
    html += `</div>`;
  }

  // Metal raporları
  if (report.metal_reports && report.metal_reports.length > 0) {
    html += `<div class="ap-section"><h3>🧲 Metaller (${report.metal_reports.length})</h3>`;
    for (let i = 0; i < report.metal_reports.length; i++) {
      const r = report.metal_reports[i];
      html += renderReportCard(r, reliabilityColors, reliabilityLabels, `metal-${i}`);
    }
    html += `</div>`;
  } else if (report.metal_count > 0) {
    html += `<div class="ap-section"><h3>🧲 Metaller</h3>`;
    html += `<div class="ap-info">${report.metal_count} metal tespit edildi</div>`;
    html += `</div>`;
  }

  _panel.innerHTML = html;
  _panel.style.display = "block";

  // Kartlara tıklama → kamera ilgili yapıya odaklanır
  _panel.querySelectorAll(".ap-card[data-focus-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.focusId;
      if (state.structureTargets[id]) {
        focusStructure(id);
      }
    });
  });

  // Her karta 📝 not/fotoğraf butonu ekle
  attachNoteButtons(_panel);
}

/**
 * Tek bir rapor kartı oluştur.
 * focusId: state.structureTargets anahtarı (chamber-N / tunnel-N).
 */
function renderReportCard(report, reliabilityColors, reliabilityLabels, focusId) {
  const color = reliabilityColors[report.reliability] || "#666";
  const label = reliabilityLabels[report.reliability] || report.reliability;

  let html = `
    <div class="ap-card" data-focus-id="${focusId || ""}" style="border-left: 4px solid ${color}">
      <div class="ap-card-header">
        <span class="ap-card-title">${report.summary}</span>
        <span class="ap-card-badge" style="background: ${color}">${label}</span>
      </div>
  `;

  // Detaylar
  if (report.details && report.details.length > 0) {
    html += `<div class="ap-card-details">`;
    for (const d of report.details) {
      html += `<div class="ap-detail">${d}</div>`;
    }
    html += `</div>`;
  }

  // Uyarılar
  if (report.warnings && report.warnings.length > 0) {
    html += `<div class="ap-card-warnings">`;
    for (const w of report.warnings) {
      html += `<div class="ap-warning">${w}</div>`;
    }
    html += `</div>`;
  }

  // Öneriler
  if (report.recommendations && report.recommendations.length > 0) {
    html += `<div class="ap-card-recommendations">`;
    for (const rec of report.recommendations) {
      html += `<div class="ap-recommendation">${rec}</div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Panel DOM'unu oluştur.
 */
function ensurePanel() {
  if (_panel) return;

  _panel = document.createElement("div");
  _panel.className = "ap-panel";
  _panel.innerHTML = `
    <div class="ap-header">
      <span class="ap-title">📊 Analiz Raporu</span>
      <button class="ap-close" onclick="this.closest('.ap-panel').style.display='none'">×</button>
    </div>
    <div class="ap-empty">Yükleniyor...</div>
  `;
  document.body.appendChild(_panel);

  // Stilleri ekle
  addStyles();
}

/**
 * Panel stillerini ekle.
 */
function addStyles() {
  if (document.getElementById("ap-styles")) return;

  const style = document.createElement("style");
  style.id = "ap-styles";
  style.textContent = `
    .ap-panel {
      position: fixed;
      top: 60px;
      right: 20px;
      width: min(720px, calc(100vw - 40px));
      max-height: calc(100vh - 80px);
      background: #1a1a2e;
      border: 1px solid #333;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 10000;
      overflow-y: auto;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      color: #e0e0e0;
      display: none;
    }
    .ap-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #333;
      background: #16213e;
      border-radius: 12px 12px 0 0;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .ap-title {
      font-size: 14px;
      font-weight: 600;
    }
    .ap-close {
      background: none;
      border: none;
      color: #888;
      font-size: 20px;
      cursor: pointer;
      padding: 0 4px;
    }
    .ap-close:hover { color: #fff; }
    .ap-summary {
      padding: 14px 18px;
      background: #16213e;
      font-size: 14px;
      line-height: 1.5;
      color: #c7d0da;
      border-bottom: 1px solid #333;
      overflow-wrap: anywhere;
    }
    .ap-section {
      padding: 14px 18px;
      border-bottom: 1px solid #222;
    }
    .ap-section h3 {
      margin: 0 0 8px 0;
      font-size: 13px;
      color: #888;
    }
    .ap-priority {
      padding: 8px 12px;
      margin: 5px 0;
      background: #0f3460;
      border-radius: 6px;
      font-size: 13px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .ap-card {
      margin: 10px 0;
      padding: 13px 15px;
      background: #16213e;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s, transform 0.15s;
      overflow-wrap: anywhere;
    }
    .ap-card:hover {
      background: #1b2a4a;
      transform: translateX(2px);
    }
    .ap-card:active {
      background: #22335a;
    }
    .ap-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 9px;
    }
    .ap-card-title {
      min-width: 0;
      font-size: 14px;
      line-height: 1.4;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .ap-card-badge {
      flex: 0 0 auto;
      white-space: nowrap;
      font-size: 12px;
      padding: 3px 9px;
      border-radius: 10px;
      color: #000;
      font-weight: 600;
    }
    .ap-card-details {
      font-size: 13px;
      line-height: 1.5;
      color: #b8c2cc;
      overflow-wrap: anywhere;
    }
    .ap-detail {
      padding: 3px 0;
    }
    .ap-card-warnings {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #333;
    }
    .ap-warning {
      font-size: 13px;
      line-height: 1.45;
      color: #f59e0b;
      padding: 3px 0;
      overflow-wrap: anywhere;
    }
    .ap-card-recommendations {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #333;
    }
    .ap-recommendation {
      font-size: 13px;
      line-height: 1.45;
      color: #22c55e;
      padding: 3px 0;
      overflow-wrap: anywhere;
    }
    .ap-empty {
      padding: 30px;
      text-align: center;
      color: #666;
    }
    @media (max-width: 760px) {
      .ap-panel {
        top: 12px;
        right: 12px;
        width: calc(100vw - 24px);
        max-height: calc(100vh - 24px);
      }
      .ap-card-header {
        flex-direction: column;
        gap: 7px;
      }
      .ap-card-badge {
        align-self: flex-start;
      }
    }
    .ap-info {
      font-size: 12px;
      color: #aaa;
    }
    .ap-field-detection {
      margin: 10px 0;
      padding: 12px 14px;
      border: 1px solid #334155;
      border-left: 4px solid #64748b;
      border-radius: 8px;
      background: #101a2c;
      font-size: 13px;
      line-height: 1.55;
      overflow-wrap: anywhere;
    }
    .ap-field-detection-head { display:flex; justify-content:space-between; gap:10px; margin-bottom:5px; }
    .ap-field-status { flex:0 0 auto; font-size:11px; font-weight:700; padding:2px 7px; border-radius:10px; color:#07110c; background:#94a3b8; }
    .ap-field-status.strong { background:#fb7185; }
    .ap-field-status.attention { background:#facc15; }
    .ap-field-recommendation { color:#86efac; margin-top:5px; }
    .ap-field-actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
  `;
  document.head.appendChild(style);
}

/**
 * Mevcut analiz verilerini al (state'den).
 */
export function getAnalysisData() {
  return _currentReport;
}
