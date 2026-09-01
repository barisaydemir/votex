/**
 * feedbackLoop.js — Geri Besleme Döngüsü (Feedback Loop)
 *
 * Çift analiz arasındaki geri beslemeyi yönetir:
 *   - Image'da güçlü tespit varsa → CSV eşiğini otomatik düşür
 *   - CSV'da güçlü tespit varsa → Image confidence eşiğini düşür
 *
 * Bu sayede tek kaynaktaki güçlü bilgi diğer kaynağı güçlendirir.
 *
 * Geri dönüşümlü: enable(false) ile orijinal eşiklere dönülür.
 */

// ── Orijinal eşik değerleri (değişmez referans) ──

const BASELINE = {
  csvThreshold: 0.9,          // detectStructuresFromTerrain threshold
  csvMinStrength: 0.45,       // detectStructuresFromTerrain minStrength
  imageConfidence: 0.4,       // generateHints minConfidence
  imageMagnetic: 200,         // generateHints min magnetic nT
};

// ── Durum ──

const state = {
  enabled: false,
  csvThreshold: BASELINE.csvThreshold,
  csvMinStrength: BASELINE.csvMinStrength,
  imageConfidence: BASELINE.imageConfidence,
  imageMagnetic: BASELINE.imageMagnetic,
};

/**
 * Image tespitlerinden CSV eşiklerini ayarla.
 * Güçlü image tespitleri varsa CSV eşiğini düşür (daha hassas).
 *
 * @param {Array} imageDetections - [{x,y,type,depth,magnetic,confidence,...}]
 * @returns {Object} Güncellenmiş CSV eşik değerleri
 */
export function updateThresholdsFromImage(imageDetections) {
  if (!state.enabled) return getCsvThresholds();

  const strongImage = imageDetections.filter(d =>
    (d.confidence || 0) >= 0.7 && Math.abs(d.magnetic || 0) > 300
  );

  const ratio = strongImage.length / Math.max(imageDetections.length, 1);

  // Güçlü image tespitleri fazlaysa CSV eşiğini düşür
  if (ratio > 0.3 && strongImage.length >= 2) {
    state.csvThreshold = Math.max(0.5, BASELINE.csvThreshold - ratio * 0.3);
    state.csvMinStrength = Math.max(0.2, BASELINE.csvMinStrength - ratio * 0.15);
  } else {
    state.csvThreshold = BASELINE.csvThreshold;
    state.csvMinStrength = BASELINE.csvMinStrength;
  }

  return getCsvThresholds();
}

/**
 * CSV tespitlerinden Image eşiklerini ayarla.
 * Güçlü CSV tespitleri varsa image eşiklerini düşür.
 *
 * @param {Array} csvDetections - [{x,y,type,depth,magnetic,...}]
 * @returns {Object} Güncellenmiş Image eşik değerleri
 */
export function updateThresholdsFromCsv(csvDetections) {
  if (!state.enabled) return getImageThresholds();

  const strongCsv = csvDetections.filter(d =>
    Math.abs(d.magnetic || 0) > 300 && (d.depth || 0) > 0
  );

  const ratio = strongCsv.length / Math.max(csvDetections.length, 1);

  if (ratio > 0.3 && strongCsv.length >= 2) {
    state.imageConfidence = Math.max(0.2, BASELINE.imageConfidence - ratio * 0.15);
    state.imageMagnetic = Math.max(100, BASELINE.imageMagnetic - ratio * 50);
  } else {
    state.imageConfidence = BASELINE.imageConfidence;
    state.imageMagnetic = BASELINE.imageMagnetic;
  }

  return getImageThresholds();
}

/**
 * Mevcut CSV eşiklerini döndür.
 */
export function getCsvThresholds() {
  return {
    threshold: state.csvThreshold,
    minStrength: state.csvMinStrength,
  };
}

/**
 * Mevcut Image eşiklerini döndür.
 */
export function getImageThresholds() {
  return {
    minConfidence: state.imageConfidence,
    minMagnetic: state.imageMagnetic,
  };
}

/**
 * Geri beslemeyi aktifleştir/kapat.
 * Kapatıldığında orijinel eşiklere dönülür.
 *
 * @param {boolean} enabled
 */
export function setFeedbackEnabled(enabled) {
  state.enabled = !!enabled;
  if (!enabled) {
    // Orijinal eşiklere dön
    state.csvThreshold = BASELINE.csvThreshold;
    state.csvMinStrength = BASELINE.csvMinStrength;
    state.imageConfidence = BASELINE.imageConfidence;
    state.imageMagnetic = BASELINE.imageMagnetic;
  }
  console.log(`[FeedbackLoop] ${enabled ? 'AKTİF' : 'PASİF'}`);
}

/**
 * Geri besleme durumunu döndür (raporlama için).
 */
export function getFeedbackStatus() {
  return {
    enabled: state.enabled,
    baseline: { ...BASELINE },
    current: {
      csvThreshold: state.csvThreshold,
      csvMinStrength: state.csvMinStrength,
      imageConfidence: state.imageConfidence,
      imageMagnetic: state.imageMagnetic,
    },
    delta: {
      csvThreshold: state.csvThreshold - BASELINE.csvThreshold,
      csvMinStrength: state.csvMinStrength - BASELINE.csvMinStrength,
      imageConfidence: state.imageConfidence - BASELINE.imageConfidence,
      imageMagnetic: state.imageMagnetic - BASELINE.imageMagnetic,
    },
  };
}
