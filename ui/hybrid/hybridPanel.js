/**
 * hybridPanel.js — Hibrit Analiz Paneli Kontrolcüsü
 *
 * Proton ELIC image + CSV verisini birleştirerek hibrit analiz yapar.
 * Tüm modülleri orkestra eder:
 *   - imageProcessor.js → Görüntüden manyetik grid
 *   - coordinateAlignment.js → Koordinat hizalama
 *   - dataFusion.js → Veri birleştirme
 *   - depthAnalysis.js → Derinlik haritası
 */

import { $, state } from '../app/state.js';
import {
  loadImageFromFile,
  extractMagneticGrid,
  renderGridToCanvas,
  drawLutPreview,
} from './imageProcessor.js';
import { runHybridAnalysis, invalidateCache } from './hybridEngine.js';

// ── Durum ──

const hybridState = {
  imageLoaded: false,
  csvLoaded: false,
  imageGrid: null,
  imageLut: null,
  imageStats: null,
  aligner: null,
  fusionResult: null,
  depthResult: null,
};

// ── Image Yükleme ──

async function handleImagePick() {
  const input = document.getElementById('hybrid-image-input');
  if (!input) return;

  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const img = await loadImageFromFile(file);

      // Manyetik grid çıkar
      const { grid, lut, stats, canvas } = extractMagneticGrid(img, {
        stripWidth: 20,
        gridRes: 64,
        ntRange: 500,
        matchThreshold: 0.35,
      });

      hybridState.imageLoaded = true;
      hybridState.imageGrid = grid;
      hybridState.imageLut = lut;
      hybridState.imageStats = stats;

      // durum güncelle
      const statusEl = document.getElementById('hs-image-status');
      if (statusEl) {
        statusEl.textContent = `${grid.length} hücre · ${(stats.matchRate * 100).toFixed(0)}% eşleşme`;
        statusEl.style.color = '#3edc8c';
      }

      // Önizleme göster
      const preview = document.getElementById('hybrid-image-preview');
      if (preview) preview.style.display = '';

      // LUT çiz
      const lutCanvas = document.getElementById('hybrid-lut-canvas');
      if (lutCanvas) {
        const ctx = lutCanvas.getContext('2d');
        drawLutPreview(ctx, lut, 0, 0, lutCanvas.width, lutCanvas.height);
      }

      // Image haritasını çiz
      const imgCanvas = document.getElementById('hybrid-image-canvas');
      if (imgCanvas) {
        const drawn = renderGridToCanvas(grid, imgCanvas.width || 280, imgCanvas.height || 140, 500);
        const ctx = imgCanvas.getContext('2d');
        ctx.clearRect(0, 0, imgCanvas.width, imgCanvas.height);
        ctx.drawImage(drawn, 0, 0, imgCanvas.width, imgCanvas.height);
      }

      // Analiz butonunu kontrol et
      updateAnalyzeButton();

      console.log(`[Hybrid] Image yüklendi: ${grid.length} hücre, nT: ${stats.nTMin.toFixed(0)}..${stats.nTMax.toFixed(0)}`);
    } catch (err) {
      console.error('[Hybrid] Image hatası:', err);
      const statusEl = document.getElementById('hs-image-status');
      if (statusEl) {
        statusEl.textContent = 'Hata: ' + err.message;
        statusEl.style.color = '#ff6a4a';
      }
    }
  };

  input.click();
}

// ── CSV Durumunu Kontrol Et ──

function checkCsvStatus() {
  // Panel görünmüyorken periyodik kontrol boşa çalışmasın
  const panel = document.getElementById('hybrid-panel');
  if (!panel || panel.offsetParent === null) return false;

  const csvData = state.csvData;
  if (csvData && csvData.points && csvData.points.length > 0) {
    hybridState.csvLoaded = true;

    const statusEl = document.getElementById('hs-csv-status');
    if (statusEl) {
      statusEl.textContent = `${csvData.pointCount} nokta yüklü`;
      statusEl.style.color = '#3edc8c';
    }

    updateAnalyzeButton();
    return true;
  }
  return false;
}

// ── Analiz Butonu Durumu ──

function updateAnalyzeButton() {
  const btn = document.getElementById('btn-hybrid-analyze');
  if (!btn) return;

  const ready = hybridState.imageLoaded && hybridState.csvLoaded;
  btn.disabled = !ready;

  if (ready) {
    btn.textContent = '🔬 Hibrit Analiz Başlat';
    btn.style.opacity = '1';
  } else if (!hybridState.imageLoaded && !hybridState.csvLoaded) {
    btn.textContent = '📷 + 📊 Gerekli';
  } else if (!hybridState.imageLoaded) {
    btn.textContent = '📷 Image Gerekli';
  } else {
    btn.textContent = '📊 CSV Gerekli';
  }
}

// ── Ana Analiz (Tek Motor) ──

async function handleAnalyze() {
  if (!hybridState.imageLoaded || !hybridState.csvLoaded) return;

  const btn = document.getElementById('btn-hybrid-analyze');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analiz yapılıyor...'; }

  try {
    // Parametreleri topla
    const params = {
      imageGrid: hybridState.imageGrid,
      csvPoints: state.csvData?.points || [],
      csvStructures: state.csvStructures || null,
      csvWeight: Number(document.getElementById('hybrid-csv-weight')?.value) || 70,
      alignMode: document.querySelector('input[name="hybrid-align"]:checked')?.value || 'auto',
      soilType: document.querySelector('input[name="soil-profile"]:checked')?.value || 'loam',
      poolSizeM: Number(document.getElementById('csv-pool-size')?.value) || 30,
      gridRes: 64,
      ntRange: 500,
      scene: state.scene,
    };

    // Tek motorla çalıştır
    const result = await runHybridAnalysis(params);

    if (result) {
      // Sonuçları UI'a aktar
      applyResultsToUI(result);

      // Renk-bazlı analiz için orijinal sonucu sakla
      try {
        const { saveOriginalResult, setAnalysisFunction } = await import('../hybrid/colorBasedAnalysis.js');
        saveOriginalResult(result);
        setAnalysisFunction(async (_paletteKey) => {
          return await runHybridAnalysis(params);
        });
      } catch (e) {
        console.warn('[Hybrid] colorBasedAnalysis hook hatası:', e);
      }

      console.log(`[Hybrid] Tamamlandı (${result.elapsed}ms)`);
    }
  } catch (err) {
    console.error('[Hybrid] Analiz hatası:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔬 Hibrit Analiz Başlat'; }
  }
}

// ── Sonuçları UI'a Aktar ──

function applyResultsToUI(result) {
  const { renderFusionCanvas, formatFusionStats, renderComparisonMap } = require('./dataFusion.js');
  const { renderDepthCanvas, formatDepthStats } = require('./depthAnalysis.js');
  const { formatHintsList, generateCombinedReport } = require('./hybridHints.js');

  const canvasW = 300;
  const canvasH = 140;

  // Fusion haritası
  const fusionCanvas = document.getElementById('hybrid-fusion-canvas');
  if (fusionCanvas && result.fusionResult) {
    const drawn = renderFusionCanvas(result.fusionResult.grid, canvasW, canvasH, { ntRange: 500, showConfidence: true });
    const ctx = fusionCanvas.getContext('2d');
    fusionCanvas.width = canvasW;
    fusionCanvas.height = canvasH;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(drawn, 0, 0);
  }

  // Derinlik haritası
  const depthCanvas = document.getElementById('hybrid-depth-canvas');
  if (depthCanvas && result.depthResult) {
    const drawn = renderDepthCanvas(result.depthResult.depthGrid, canvasW, canvasH, { maxDepth: 30, showContours: true });
    const ctx = depthCanvas.getContext('2d');
    depthCanvas.width = canvasW;
    depthCanvas.height = canvasH;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(drawn, 0, 0);
  }

  // Karşılaştırma haritası
  const compareCanvas = document.getElementById('hybrid-compare-canvas');
  if (compareCanvas && result.crossValResult && result.fusionResult) {
    const { canvas: drawn } = renderComparisonMap(result.fusionResult.grid, canvasW, canvasH, 200);
    const ctx = compareCanvas.getContext('2d');
    compareCanvas.width = canvasW;
    compareCanvas.height = canvasH;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(drawn, 0, 0);
  }

  // Fusion istatistikleri
  const fusionStatsEl = document.getElementById('hybrid-fusion-stats');
  if (fusionStatsEl && result.fusionResult) {
    fusionStatsEl.innerHTML = formatFusionStats(result.fusionResult.stats);
  }

  // Derinlik istatistikleri
  const depthStatsEl = document.getElementById('hybrid-depth-stats');
  if (depthStatsEl && result.depthResult) {
    depthStatsEl.innerHTML = formatDepthStats(result.depthResult.stats);
  }

  // Çapraz doğrulama raporu
  const cvEl = document.getElementById('hybrid-cv-report');
  if (cvEl && result.crossValResult) {
    cvEl.innerHTML = result.crossValResult.report;
    cvEl.style.display = '';
  } else if (cvEl) {
    cvEl.style.display = 'none';
  }

  // İpuçları raporu + liste
  const hintsSection = document.getElementById('hybrid-hints-section');
  const hintsReport = document.getElementById('hybrid-hints-report');
  const hintsList = document.getElementById('hybrid-hints-list');
  if (hintsSection && result.hints?.length > 0) {
    hintsSection.style.display = '';
    if (hintsReport) hintsReport.innerHTML = generateCombinedReport(result.crossValResult, result.hints);
    if (hintsList) hintsList.innerHTML = formatHintsList(result.hints);
  } else if (hintsSection) {
    hintsSection.style.display = 'none';
  }

  // Sonuçları göster
  const resultsEl = document.getElementById('hybrid-results');
  if (resultsEl) resultsEl.style.display = '';
}

// ── Başlatma ──

export function bindHybridPanel() {
  const panel = document.getElementById('hybrid-panel');
  if (!panel || panel.dataset.bound === '1') return;
  panel.dataset.bound = '1';

  console.log('[Hybrid] Panel bağlandı');

  // Image seç butonu
  document.getElementById('btn-hybrid-image')?.addEventListener('click', handleImagePick);

  // Ağırlık slider'ı
  const weightSlider = document.getElementById('hybrid-csv-weight');
  const weightLabel = document.getElementById('hybrid-csv-weight-val');
  if (weightSlider && weightLabel) {
    weightSlider.addEventListener('input', () => {
      weightLabel.textContent = `%${weightSlider.value}`;
    });
  }

  // Analiz butonu
  document.getElementById('btn-hybrid-analyze')?.addEventListener('click', handleAnalyze);

  // CSV durumunu kontrol et (periyodik)
  checkCsvStatus();
  setInterval(checkCsvStatus, 2000);
}
