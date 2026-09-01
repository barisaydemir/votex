/**
 * hybridEngine.js — Tek Motorlu Hibrit Analiz
 *
 * Tüm analiz adımlarını tek seferde çalıştırır:
 *   1. Hizalama
 *   2. Birleştirme (fusion)
 *   3. Derinlik
 *   4. Çapraz doğrulama
 *   5. İpuçları
 *   6. 3D görselleştirme
 *
 * Önbellek ile aynı veri tekrar işlenmez.
 * Debounce ile çok sık tetikleme engellenir.
 */

import { CoordinateAligner } from './coordinateAlignment.js';
import { fuseDataSources } from './dataFusion.js';
import { analyzeDepth } from './depthAnalysis.js';
import { crossValidate } from './crossValidation.js';
import { generateHints, addHintsToScene, removeHintsFromScene } from './hybridHints.js';
import { diagnoseImageDetections } from './imageDiagnostics.js';
import { enrichAnalysis, checkReadiness } from './dualAnalysisPack.js';
import { state } from '../app/state.js';

// ── Motor Durumu ──

const engine = {
  /** Son analiz parametrelerinin hash'i (değişiklik kontrolü) */
  lastParamsHash: null,
  /** Son analiz sonuçları */
  lastResult: null,
  /** Çalışıyor mu */
  running: false,
  /** Debounce timer */
  timer: null,
  /** iptal bayrağı */
  cancelToken: 0,
};

// ── Parametre Hash ──

/**
 * Analiz parametrelerinden basit hash üret.
 * Aynı parametrelerle tekrar çalışmayı engeller.
 */
function hashParams(params) {
  const parts = [
    params.imageCount || 0,
    params.csvCount || 0,
    params.csvWeight || 70,
    params.alignMode || 'auto',
    params.soilType || 'loam',
    params.poolSizeM || 30,
    params.gridRes || 64,
    params.ntRange || 500,
  ];
  return parts.join('|');
}

// ── Tek Motorlu Analiz ──

/**
 * Hibrit analizi tek seferde çalıştır.
 *
 * @param {Object} params
 * @param {Array} params.imageGrid - Image manyetik grid
 * @param {Array} params.csvPoints - CSV noktaları
 * @param {Object} params.csvStructures - CSV yapı tespitleri
 * @param {number} [params.csvWeight=70] - CSV ağırlığı (%)
 * @param {string} [params.alignMode='auto'] - Hizalama modu
 * @param {string} [params.soilType='loam'] - Toprak profili
 * @param {number} [params.poolSizeM=30] - Havuz boyutu
 * @param {number} [params.gridRes=64] - Grid çözünürlüğü
 * @param {number} [params.ntRange=500] - nT aralığı
 * @param {THREE.Scene} [params.scene] - Three.js sahnesi
 * @returns {Promise<Object>} Analiz sonuçları
 */
export async function runHybridAnalysis(params) {
  // 1) Aynı parametrelerle tekrar çalışma kontrolü
  const hash = hashParams(params);
  if (hash === engine.lastParamsHash && engine.lastResult) {
    console.log('[HybridEngine] Aynı parametreler — önbellek kullanılıyor');
    return engine.lastResult;
  }

  // 2) Çalışma kontrolü
  if (engine.running) {
    console.log('[HybridEngine] Zaten çalışıyor — atlanıyor');
    return null;
  }

  // 3) İptal et
  engine.cancelToken++;
  const myToken = engine.cancelToken;

  engine.running = true;
  const startTime = performance.now();

  try {
    console.log('[HybridEngine] Başlıyor...');

    // ── Adım 1: Hizalama ──
    const { imageGrid, csvPoints, csvStructures, alignMode, csvWeight, soilType, poolSizeM, gridRes, ntRange } = params;

    if (!imageGrid?.length || !csvPoints?.length) {
      throw new Error('Image veya CSV verisi yok');
    }

    if (myToken !== engine.cancelToken) return null; // İptal kontrolü

    const imgBounds = {
      xMin: Math.min(...imageGrid.map(p => p.x)),
      xMax: Math.max(...imageGrid.map(p => p.x)),
      yMin: Math.min(...imageGrid.map(p => p.y)),
      yMax: Math.max(...imageGrid.map(p => p.y)),
    };

    const csvBounds = {
      xMin: Math.min(...csvPoints.map(p => p.x)),
      xMax: Math.max(...csvPoints.map(p => p.x)),
      yMin: Math.min(...csvPoints.map(p => p.y)),
      yMax: Math.max(...csvPoints.map(p => p.y)),
    };

    const aligner = new CoordinateAligner();
    if (alignMode === 'auto') {
      aligner.autoAlign(imgBounds, csvBounds);
    } else {
      aligner.addControlPoint(0, 0, csvBounds.xMin, csvBounds.yMin);
      aligner.addControlPoint(1, 0, csvBounds.xMax, csvBounds.yMin);
      aligner.addControlPoint(0.5, 0.5, (csvBounds.xMin + csvBounds.xMax) / 2, (csvBounds.yMin + csvBounds.yMax) / 2);
    }

    const alignmentQuality = aligner.qualityCheck();
    console.log(`[HybridEngine] 1/5 Hizalama: ${alignmentQuality.quality} (${alignmentQuality.score}/100)`);

    if (myToken !== engine.cancelToken) return null;

    // ── Adım 2: Birleştirme (Fusion) ──
    const alignedImage = aligner.transformImageGrid(imageGrid);
    const cw = (csvWeight || 70) / 100;

    const fusionResult = fuseDataSources({
      imageGrid: alignedImage.map(p => ({ x: p.csvX, y: p.csvY, nT: p.nT, source: 'image' })),
      csvPoints: csvPoints.map(p => ({ x: p.x, y: p.y, magnetic: p.magnetic })),
      gridRes: gridRes || 64,
      csvWeight: cw,
      imageWeight: 1 - cw,
      searchRadius: 3,
      maxNeighbors: 8,
    });

    console.log(`[HybridEngine] 2/5 Fusion: ${fusionResult.stats.filledCells} hücre`);

    if (myToken !== engine.cancelToken) return null;

    // ── Adım 3: Derinlik ──
    const depthResult = analyzeDepth({
      fusionGrid: fusionResult.grid,
      gridRes: gridRes || 64,
      ntRange: ntRange || 500,
      soilType: soilType || 'loam',
      maxDepth: 30,
    });

    console.log(`[HybridEngine] 3/5 Derinlik: ${depthResult.stats.depthMin.toFixed(1)}..${depthResult.stats.depthMax.toFixed(1)}m`);

    if (myToken !== engine.cancelToken) return null;

    // ── Adım 4: Çapraz Doğrulama — her iki taraf da metre koordinatlarında ──
    let crossValResult = null;
    if (csvStructures) {
      // Image grid'den istatistikleri hesapla (imageStats henüz yok)
      const imgStats = {
        nTMin: Math.min(...imageGrid.map(g => g.nT)),
        nTMax: Math.max(...imageGrid.map(g => g.nT)),
        posCount: imageGrid.filter(g => g.nT > 0).length,
        negCount: imageGrid.filter(g => g.nT < 0).length,
      };
      // Image tespitlerini 0..1 normalize → metre koordinatına çevir
      // Gelişmiş: derinlik nT gradyanından, güven çok faktörlü
      const imgDiags = diagnoseImageDetections(imageGrid, gridRes || 64, poolSizeM || 30, imgStats, 150);
      const imgDets = imgDiags.map(d => {
        const csvCoord = aligner.imageToCsv(d.x, d.y);
        return {
          x: csvCoord.x, y: csvCoord.y,
          type: d.type,
          depth: d.depth,
          magnetic: d.nT,
          confidence: d.confidence,
          factors: d.factors,
        };
      });

      // CSV yapı tespitleri zaten metre koordinatlarında (detectStructuresFromTerrain)
      const csvDets = [
        ...(csvStructures.chambers || []).map(d => ({
          x: d.cx || 0, y: d.cy || 0,
          type: 'oda', depth: d.topFromSurfaceM || 5,
          magnetic: d.strength || 0, confidence: 0.8,
        })),
        ...(csvStructures.tunnels || []).map(d => ({
          x: ((d.x0 || 0) + (d.x1 || 0)) / 2,
          y: ((d.y0 || 0) + (d.y1 || 0)) / 2,
          type: 'tunnel', depth: d.floorFromSurfaceM || 5,
          magnetic: d.strength || 0, confidence: 0.75,
        })),
        ...(csvStructures.metals || []).map(d => ({
          x: d.cx || 0, y: d.cy || 0,
          type: 'metal', depth: d.depthFromSurfaceM || 3,
          magnetic: d.strength || 0, confidence: 0.85,
        })),
      ];

      if (imgDets.length > 0 && csvDets.length > 0) {
        crossValResult = crossValidate({ imageDetections: imgDets, csvDetections: csvDets });
        console.log(`[HybridEngine] 4/5 Çapraz: ${crossValResult.matches.length} uyumlu, ${crossValResult.mismatches.length} uyumsuz`);
      }
    }

    if (myToken !== engine.cancelToken) return null;

    // ── Adım 5: İpuçları ──
    const hints = generateHints(crossValResult, { minConfidence: 0.4, poolSizeM });

    // 3D'ye ekle
    if (params.scene) {
      removeHintsFromScene(params.scene);
      if (hints.length > 0) {
        addHintsToScene(params.scene, hints, { poolSizeM, yScale: 1 });
      }
    }

    console.log(`[HybridEngine] 5/5 İpuçları: ${hints.length} ipucu`);

    // ── Adım 5.5: Çift Analiz Tamamlayıcı Paket ──
    let enrichedResult = null;
    try {
      const rawResult = {
        aligner,
        alignmentQuality,
        fusionResult,
        depthResult,
        crossValResult,
        hints,
        csvDetections: csvDets || [],
        imageDetections: imgDets || [],
        csvStructures,
        fusionGrid: fusionResult?.grid,
      };
      enrichedResult = enrichAnalysis(rawResult);
      if (enrichedResult?.dualAnalysis) {
        console.log(`[HybridEngine] 5.5/5 Çift Analiz:`, Object.keys(enrichedResult.dualAnalysis).join(', '));
      }
    } catch (e) {
      console.warn('[HybridEngine] Dual analysis paketi hatası (atlanıyor):', e.message);
    }

    // ── Sonuç ──
    const elapsed = (performance.now() - startTime).toFixed(0);
    const result = enrichedResult || {
      aligner,
      alignmentQuality,
      fusionResult,
      depthResult,
      crossValResult,
      hints,
      elapsed: Number(elapsed),
      paramsHash: hash,
    };
    result.elapsed = Number(elapsed);
    result.paramsHash = hash;

    // Önbelleğe kaydet
    engine.lastParamsHash = hash;
    engine.lastResult = result;

    console.log(`[HybridEngine] Tamamlandı (${elapsed}ms)`);

    return result;
  } catch (err) {
    console.error('[HybridEngine] Hata:', err);
    throw err;
  } finally {
    engine.running = false;
  }
}

// ── Debounced Çalıştırma ──

/**
 * Debounced analiz — çok sık tetiklemeyi engeller.
 *
 * @param {Object} params
 * @param {number} [delay=300] - Gecikme (ms)
 */
export function scheduleHybridAnalysis(params, delay = 300) {
  if (engine.timer) clearTimeout(engine.timer);
  engine.timer = setTimeout(() => {
    runHybridAnalysis(params);
  }, delay);
}

// ── Önbellek Temizleme ──

/**
 * Önbelleği temizle — bir sonraki analiz zorunlu çalışsın.
 */
export function invalidateCache() {
  engine.lastParamsHash = null;
  engine.lastResult = null;
  console.log('[HybridEngine] Önbellek temizlendi');
}

// ── Durum Sorgulama ──

/**
 * Motor durumunu döndür.
 */
export function getEngineStatus() {
  return {
    running: engine.running,
    cached: !!engine.lastResult,
    lastHash: engine.lastParamsHash,
  };
}

// ── Sonuçları UI'a Aktar ──

/**
 * Analiz sonuçlarını UI paneline aktar.
 *
 * @param {Object} result - runHybridAnalysis çıktısı
 */
export function applyResultsToUI(result) {
  if (!result) return;

  // Fusion canvas
  const { renderFusionCanvas } = require('./dataFusion.js');
  const { renderDepthCanvas, formatDepthStats } = require('./depthAnalysis.js');
  const { formatHintsList, generateCombinedReport } = require('./hybridHints.js');

  const canvasW = 300, canvasH = 140;

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
  if (compareCanvas && result.crossValResult) {
    const { renderComparisonMap } = require('./dataFusion.js');
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
    const { formatFusionStats } = require('./dataFusion.js');
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
  }

  // İpuçları
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
