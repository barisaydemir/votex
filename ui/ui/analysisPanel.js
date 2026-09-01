/**
 * Analiz Raporu Paneli — her tespit için insancıl Türkçe rapor gösterir.
 * analysis_report.rs modülünün çıktısını UI'da sunar.
 */
import { state } from "../app/state.js";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n/index.js";
import { focusStructure } from "../viewer/labels.js";
import { attachNoteButtons } from "./detectionNotes.js";

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
      width: 380px;
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
      padding: 12px 16px;
      background: #16213e;
      font-size: 13px;
      color: #aaa;
      border-bottom: 1px solid #333;
    }
    .ap-section {
      padding: 12px 16px;
      border-bottom: 1px solid #222;
    }
    .ap-section h3 {
      margin: 0 0 8px 0;
      font-size: 13px;
      color: #888;
    }
    .ap-priority {
      padding: 6px 10px;
      margin: 4px 0;
      background: #0f3460;
      border-radius: 6px;
      font-size: 12px;
    }
    .ap-card {
      margin: 8px 0;
      padding: 10px 12px;
      background: #16213e;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s, transform 0.15s;
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
      align-items: center;
      margin-bottom: 8px;
    }
    .ap-card-title {
      font-size: 13px;
      font-weight: 500;
    }
    .ap-card-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      color: #000;
      font-weight: 600;
    }
    .ap-card-details {
      font-size: 12px;
      color: #aaa;
    }
    .ap-detail {
      padding: 2px 0;
    }
    .ap-card-warnings {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #333;
    }
    .ap-warning {
      font-size: 12px;
      color: #f59e0b;
      padding: 2px 0;
    }
    .ap-card-recommendations {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #333;
    }
    .ap-recommendation {
      font-size: 12px;
      color: #22c55e;
      padding: 2px 0;
    }
    .ap-empty {
      padding: 24px;
      text-align: center;
      color: #666;
    }
    .ap-info {
      font-size: 12px;
      color: #aaa;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Mevcut analiz verilerini al (state'den).
 */
export function getAnalysisData() {
  return _currentReport;
}
