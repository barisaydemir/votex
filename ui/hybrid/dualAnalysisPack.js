/**
 * dualAnalysisPack.js — Çift Analiz Tamamlayıcı Paket Orkestratörü
 *
 * 5 tamamlayıcı modülü tek bir anahtardan yönetir:
 *   1. feedbackLoop      — Geri besleme döngüsü
 *   2. consensusVisuals  — Konsensüs 3D görselleştirme
 *   3. unifiedConfidence — Birleşik güven skoru
 *   4. geometricCompare  — Geometrik karşılaştırma
 *   5. fusionDetection   — Fusion-bazlı yapı tespiti
 *
 * Tek enable/disable ile tüm paket açılıp kapatılabilir.
 * Her modül bağımsız olarak da açılıp kapatılabilir.
 *
 * GERİ DÖNÜŞÜMLÜ: disable() çağrıldığında tüm modüller pasife geçer,
 * orijinal analiz akışına geri dönülür.
 */

import { setFeedbackEnabled, updateThresholdsFromImage, updateThresholdsFromCsv, getCsvThresholds, getImageThresholds, getFeedbackStatus } from "./feedbackLoop.js";
import { showConsensus, clearConsensus, getConsensusStats } from "./consensusVisuals.js";
import { setUnifiedConfidenceEnabled, computeUnifiedConfidence, computeBatchConfidence, renderConfidenceReport, isUnifiedConfidenceEnabled } from "./unifiedConfidence.js";
import { setGeometricCompareEnabled, compareGeometric, batchGeometricCompare, isGeometricCompareEnabled } from "./geometricCompare.js";
import { setFusionDetectionEnabled, detectFromFusion, mergeWithCsvStructures, isFusionDetectionEnabled } from "./fusionDetection.js";

// ── Paket Durumu ──

const pack = {
  enabled: false,
  /** Modül bazlı kontrol */
  modules: {
    feedbackLoop: true,
    consensusVisuals: true,
    unifiedConfidence: true,
    geometricCompare: true,
    fusionDetection: true,
  },
  /** Son analiz sonuçları */
  lastResult: null,
};

/**
 * Tüm paketi aktifleştir veya devre dışı bırak.
 *
 * @param {boolean} enabled
 * @param {Object} [moduleOverrides] - { feedbackLoop: true, consensusVisuals: false, ... }
 */
export function enableDualAnalysis(enabled, moduleOverrides = {}) {
  pack.enabled = !!enabled;

  // Modül bazlı override
  for (const [key, val] of Object.entries(moduleOverrides)) {
    if (key in pack.modules) {
      pack.modules[key] = !!val;
    }
  }

  // Her modülü单独 aç/kapa
  setFeedbackEnabled(pack.enabled && pack.modules.feedbackLoop);
  setUnifiedConfidenceEnabled(pack.enabled && pack.modules.unifiedConfidence);
  setGeometricCompareEnabled(pack.enabled && pack.modules.geometricCompare);
  setFusionDetectionEnabled(pack.enabled && pack.modules.fusionDetection);

  // consensusVisuals zaten enable/disable değil, sadece göster/gizle
  if (!pack.enabled || !pack.modules.consensusVisuals) {
    clearConsensus();
  }

  console.log(`[DualAnalysisPack] ${pack.enabled ? 'AKTİF' : 'PASİF'}`, pack.modules);
}

/**
 * Analiz sonuçlarını tamamlayıcı paketle zenginleştir.
 *
 * HybridEngine'den gelen sonuçlara ek:
 *   - Geri besleme ile güncellenmiş eşikler
 *   - Konsensüs görselleştirme
 *   - Birleşik güven skoru
 *   - Geometrik karşılaştırma
 *   - Fusion tespitleri
 *
 * @param {Object} analysisResult - HybridEngine çıktısı
 * @returns {Object} Zenginleştirilmiş sonuç
 */
export function enrichAnalysis(analysisResult) {
  if (!pack.enabled || !analysisResult) return analysisResult;

  const result = { ...analysisResult, dualAnalysis: {} };

  // 1) Geri besleme — eşikleri güncelle
  if (pack.modules.feedbackLoop) {
    const imgDets = analysisResult.imageDetections || [];
    const csvDets = analysisResult.csvDetections || [];

    updateThresholdsFromImage(imgDets);
    updateThresholdsFromCsv(csvDets);

    result.dualAnalysis.feedback = {
      csvThresholds: getCsvThresholds(),
      imageThresholds: getImageThresholds(),
      status: getFeedbackStatus(),
    };
  }

  // 2) Konsensüs görselleştirme
  if (pack.modules.consensusVisuals && analysisResult.crossValidation) {
    showConsensus(analysisResult.crossValidation);
    result.dualAnalysis.consensus = getConsensusStats();
  }

  // 3) Birleşik güven skoru
  if (pack.modules.unifiedConfidence && analysisResult.crossValidation) {
    const matches = analysisResult.crossValidation.matches || [];
    const enrichedMatches = matches.map(m => ({
      ...m.csv,
      csvConfidence: m.csv?.confidence || 0.8,
      imageConfidence: m.image?.confidence || 0.55,
      isConsistent: m.isConsistent,
      depthDiff: m.depthDiff,
      magneticDiff: m.magneticDiff,
    }));
    const confResult = computeBatchConfidence(enrichedMatches);
    result.dualAnalysis.confidence = confResult;
    result.dualAnalysis.confidenceHtml = renderConfidenceReport(confResult);
  }

  // 4) Geometrik karşılaştırma
  if (pack.modules.geometricCompare && analysisResult.crossValidation) {
    const geoResult = batchGeometricCompare(analysisResult.crossValidation.matches || []);
    result.dualAnalysis.geometric = geoResult;
  }

  // 5) Fusion tespiti
  if (pack.modules.fusionDetection && analysisResult.fusionGrid) {
    const fusionDets = detectFromFusion(analysisResult.fusionGrid, {
      gridRes: 64,
      poolSizeM: 30,
      csvStructures: analysisResult.csvStructures || { chambers: [], tunnels: [], metals: [] },
    });

    // Fusion tespitlerini CSV yapılarıyla birleştir
    if (analysisResult.csvStructures) {
      const merged = mergeWithCsvStructures(fusionDets, analysisResult.csvStructures);
      result.mergedStructures = merged;
    }

    result.dualAnalysis.fusion = fusionDets.fusionStats;
    result.fusionDetections = fusionDets;
  }

  pack.lastResult = result;
  return result;
}

/**
 * Paket durumunu döndür (UI + raporlama için).
 */
export function getPackStatus() {
  return {
    enabled: pack.enabled,
    modules: { ...pack.modules },
    moduleStatus: {
      feedbackLoop: pack.modules.feedbackLoop ? getFeedbackStatus() : null,
      consensus: pack.modules.consensusVisuals ? getConsensusStats() : null,
      confidence: pack.modules.unifiedConfidence,
      geometric: pack.modules.geometricCompare,
      fusion: pack.modules.fusionDetection,
    },
  };
}

/**
 * Tek bir modülü aç/kapa.
 *
 * @param {string} moduleName - 'feedbackLoop' | 'consensusVisuals' | 'unifiedConfidence' | 'geometricCompare' | 'fusionDetection'
 * @param {boolean} enabled
 */
export function setModuleEnabled(moduleName, enabled) {
  if (!(moduleName in pack.modules)) return;

  pack.modules[moduleName] = !!enabled;

  // İlgili modül fonksiyonunu çağır
  switch (moduleName) {
    case 'feedbackLoop':
      setFeedbackEnabled(pack.enabled && enabled);
      break;
    case 'consensusVisuals':
      if (!enabled) clearConsensus();
      break;
    case 'unifiedConfidence':
      setUnifiedConfidenceEnabled(pack.enabled && enabled);
      break;
    case 'geometricCompare':
      setGeometricCompareEnabled(pack.enabled && enabled);
      break;
    case 'fusionDetection':
      setFusionDetectionEnabled(pack.enabled && enabled);
      break;
  }

  console.log(`[DualAnalysisPack] ${moduleName} = ${enabled}`);
}

/**
 * Tüm paketi varsayılan ayarlara sıfırla.
 */
export function resetDualAnalysis() {
  enableDualAnalysis(false);
  clearConsensus();
  pack.lastResult = null;
  console.log('[DualAnalysisPack] SIFIRLANDI');
}

// ── Uygunluk kontrolü ──

/**
 * Paketin çalışması için gerekli verilerin mevcut olup olmadığını kontrol et.
 *
 * @param {Object} analysisResult
 * @returns {Object} { ready, missing }
 */
export function checkReadiness(analysisResult) {
  const missing = [];

  if (!analysisResult) {
    missing.push("analiz sonucu");
    return { ready: false, missing };
  }

  if (pack.modules.feedbackLoop || pack.modules.fusionDetection) {
    if (!analysisResult.csvDetections || analysisResult.csvDetections.length === 0) {
      missing.push("CSV tespitleri");
    }
  }

  if (pack.modules.feedbackLoop) {
    if (!analysisResult.imageDetections || analysisResult.imageDetections.length === 0) {
      missing.push("Image tespitleri");
    }
  }

  if (pack.modules.consensusVisuals || pack.modules.unifiedConfidence || pack.modules.geometricCompare) {
    if (!analysisResult.crossValidation) {
      missing.push("Cross-validation sonucu");
    }
  }

  if (pack.modules.fusionDetection) {
    if (!analysisResult.fusionGrid) {
      missing.push("Fusion grid");
    }
  }

  return { ready: missing.length === 0, missing };
}
