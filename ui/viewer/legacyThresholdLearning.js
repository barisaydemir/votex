/**
 * legacyThresholdLearning.js — Doğrulanmış hedeflerden eşik öğrenme (yerel, istatistiksel).
 *
 * Amaç: operatörün saha kararları (confirmed/rejected) biriktikçe GÜÇLÜ/DİKKAT
 * durum eşiklerini (güven %, σ) ve tip bazlı beklenen derinlik bandını ölçümden
 * güncellemek. Model eğitimi değildir; açık, sınırlı ve geri alınabilir bir
 * yerel istatistik kalibrasyonudur.
 *
 * Sözleşme kuralları:
 * - Saf modül: DOM/Three.js/Tauri bilmez; örnekler dışarıdan verilir.
 * - Sınırlar sabit ve geniştir: güven eşiği 0.40–0.70, σ eşiği 1.5–4.0,
 *   derinlik bantları ±%60 ile kırpılır. Aşırı öğrenme engellenir.
 * - Az örnek = varsayılan: minimum örnek sayısı altında katsayı 1.0 (etkisiz).
 * - Deterministik: aynı girdi → aynı çıktı.
 */

export const LEGACY_THRESHOLD_LEARNING_SCHEMA_VERSION = 1;

/** Öğrenmenin devreye girmesi için gereken en az doğrulanmış örnek sayısı (tip başına). */
export const MIN_SAMPLES_FOR_DEPTH = 3;
/** Güven/σ eşiği kayması için gereken en az onaylı+reddedilmiş örnek sayısı. */
export const MIN_DECISION_SAMPLES = 4;

const CONFIDENCE_STRONG_MIN = 0.40;
const CONFIDENCE_STRONG_MAX = 0.70;
const SIGMA_STRONG_MIN = 1.5;
const SIGMA_STRONG_MAX = 4.0;
const DEPTH_BAND_RATIO = 0.6;

function finiteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function median(values) {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/**
 * Sahadaki kararları öğrenme örneklerine çevirir.
 * @param {object} input
 * @param {object} input.fieldModel buildLegacyFieldModel çıktısı
 * @param {object} [input.session] legacyFieldSession (targetChecks: id → {status})
 * @returns {Array<{ detectionId, status, confidence, strength, depthTopM, depthBottomM }>}
 */
export function collectVerifiedSamples(input = {}) {
  const fieldModel = input.fieldModel || {};
  const session = input.session || {};
  const checks = session.targetChecks && typeof session.targetChecks === "object" ? session.targetChecks : {};
  const detections = Array.isArray(fieldModel.detections) ? fieldModel.detections : [];
  const samples = [];
  for (const detection of detections) {
    const check = checks[String(detection.detectionId || "")];
    const status = String(check?.status || "").toLowerCase();
    if (status !== "confirmed" && status !== "rejected") continue;
    samples.push({
      detectionId: String(detection.detectionId || ""),
      type: String(detection.type || detection.raw?.kind || "Anomali"),
      status,
      confidence: finiteNumber(detection.confidence),
      strength: finiteNumber(detection.strength ?? detection.peakSigma),
      depthTopM: finiteNumber(detection.depthTopM),
      depthBottomM: finiteNumber(detection.depthBottomM ?? detection.depthTopM),
    });
  }
  return samples;
}

/**
 * Örneklerden öğrenilmiş eşik modeli üretir (veya mevcut modeli günceller).
 * @param {Array<object>} samples collectVerifiedSamples çıktısı
 * @param {object} [previous] önceki öğrenilmiş model (birleştirme için)
 */
export function buildLearnedThresholds(samples, previous = null) {
  const list = Array.isArray(samples) ? samples : [];
  const confirmed = list.filter((s) => s.status === "confirmed");
  const rejected = list.filter((s) => s.status === "rejected");

  const decisionCount = confirmed.length + rejected.length;
  const prev = previous && typeof previous === "object" ? previous : {};

  // ── Güven eşiği: onaylı örneklerin alt sınırı ile reddedilenlerin üst sınırı arasına çekilir
  const confirmedConf = confirmed.map((s) => s.confidence).filter((v) => v != null);
  const rejectedConf = rejected.map((s) => s.confidence).filter((v) => v != null);
  let confidenceStrong;
  if (decisionCount >= MIN_DECISION_SAMPLES && confirmedConf.length && rejectedConf.length) {
    const confirmedMin = Math.min(...confirmedConf);
    const rejectedMax = Math.max(...rejectedConf);
    const mid = (confirmedMin + rejectedMax) / 2;
    confidenceStrong = clamp(mid, CONFIDENCE_STRONG_MIN, CONFIDENCE_STRONG_MAX);
  } else {
    confidenceStrong = clamp(finiteNumber(prev.confidenceStrong, 0.55), CONFIDENCE_STRONG_MIN, CONFIDENCE_STRONG_MAX);
  }

  // ── σ eşiği: aynı mantık
  const confirmedSig = confirmed.map((s) => s.strength).filter((v) => v != null);
  const rejectedSig = rejected.map((s) => s.strength).filter((v) => v != null);
  let sigmaStrong;
  if (decisionCount >= MIN_DECISION_SAMPLES && confirmedSig.length && rejectedSig.length) {
    const confirmedMin = Math.min(...confirmedSig);
    const rejectedMax = Math.max(...rejectedSig);
    const mid = (confirmedMin + rejectedMax) / 2;
    sigmaStrong = clamp(mid, SIGMA_STRONG_MIN, SIGMA_STRONG_MAX);
  } else {
    sigmaStrong = clamp(finiteNumber(prev.sigmaStrong, 3.0), SIGMA_STRONG_MIN, SIGMA_STRONG_MAX);
  }

  // ── Tip bazlı beklenen derinlik bandı: onaylı örneklerin medyanı ± %60
  const depthBands = {};
  const prevBands = prev.depthBands && typeof prev.depthBands === "object" ? prev.depthBands : {};
  const byType = new Map();
  for (const sample of confirmed) {
    const type = String(sample.type || "Anomali");
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(sample);
  }
  for (const [type, items] of byType) {
    const tops = items.map((s) => s.depthTopM).filter((v) => v != null);
    const bottoms = items.map((s) => s.depthBottomM).filter((v) => v != null);
    if (items.length < MIN_SAMPLES_FOR_DEPTH || !tops.length) continue;
    const prevBand = prevBands[type];
    const centerTop = median(tops);
    const centerBottom = median(bottoms.length ? bottoms : tops);
    // Eski bant varsa yumuşak birleştirme (bant zıplamasını önler)
    const blendedTop = prevBand?.centerTopM != null ? (centerTop + prevBand.centerTopM) / 2 : centerTop;
    const blendedBottom = prevBand?.centerBottomM != null ? (centerBottom + prevBand.centerBottomM) / 2 : centerBottom;
    const span = Math.max(0.1, blendedBottom - blendedTop);
    depthBands[type] = {
      sampleCount: items.length,
      centerTopM: Math.max(0, Math.round((blendedTop - span * DEPTH_BAND_RATIO) * 100) / 100),
      centerBottomM: Math.max(0, Math.round((blendedBottom + span * DEPTH_BAND_RATIO) * 100) / 100),
    };
  }

  return {
    schemaVersion: LEGACY_THRESHOLD_LEARNING_SCHEMA_VERSION,
    confidenceStrong,
    sigmaStrong,
    depthBands,
    decisionSampleCount: decisionCount,
    confirmedCount: confirmed.length,
    rejectedCount: rejected.length,
    updatedAt: new Date().toISOString().slice(0, 19),
  };
}

/**
 * Öğrenilmiş eşikleri tek bir tespitin durum ve yorumuna uygular.
 * Eşikler dışındaki her şey varsayılan davranışta kalır.
 * @param {object} detection tespit (confidence, strength, depthTopM/BottomM, type)
 * @param {object|null} learned buildLearnedThresholds çıktısı (null = öğrenme yok)
 * @param {{ status?: string, depthNote?: string|null }} [defaults] varsayılan durum/yorum
 */
export function applyLearnedThresholds(detection, learned, defaults = {}) {
  const base = {
    status: defaults.status || "normal",
    depthNote: defaults.depthNote ?? null,
  };
  if (!learned || typeof learned !== "object") return base;

  const confidence = finiteNumber(detection.confidence);
  const strength = finiteNumber(detection.strength ?? detection.peakSigma);

  // Güven/σ eşikleri: yalnız yeterli karar örneği varsa etkili
  if (Number(learned.decisionSampleCount) >= MIN_DECISION_SAMPLES) {
    const confStrong = finiteNumber(learned.confidenceStrong);
    const sigStrong = finiteNumber(learned.sigmaStrong);
    const confHit = confidence != null && confStrong != null && confidence >= confStrong;
    const sigHit = strength != null && sigStrong != null && strength >= sigStrong;
    if (confHit || sigHit) {
      base.status = "strong";
    } else if (confidence != null && confStrong != null && confidence >= confStrong * 0.75) {
      if (base.status === "normal") base.status = "attention";
    }
  }

  // Tip bazlı derinlik bandı: tespit bandın içindeyse not ekle
  const band = learned.depthBands?.[String(detection.type || "Anomali")];
  if (band && confidence != null) {
    const depthTop = finiteNumber(detection.depthTopM);
    if (depthTop != null && depthTop >= band.centerTopM && depthTop <= band.centerBottomM) {
      base.depthNote = `Bu tip doğrulanmış hedeflerde beklenen derinlik bandı ${band.centerTopM.toFixed(2)}–${band.centerBottomM.toFixed(2)} m (öğrenilmiş; ${band.sampleCount} onaylı örnek).`;
    }
  }

  return base;
}

/** Modeli settings'e yazılacak kompakt biçime indirger. */
export function serializeLearnedThresholds(learned) {
  if (!learned || typeof learned !== "object") return null;
  return {
    schemaVersion: LEGACY_THRESHOLD_LEARNING_SCHEMA_VERSION,
    confidenceStrong: Math.round(finiteNumber(learned.confidenceStrong, 0.55) * 1000) / 1000,
    sigmaStrong: Math.round(finiteNumber(learned.sigmaStrong, 3.0) * 1000) / 1000,
    depthBands: learned.depthBands && typeof learned.depthBands === "object" ? learned.depthBands : {},
    decisionSampleCount: Math.max(0, Math.floor(finiteNumber(learned.decisionSampleCount, 0))),
    confirmedCount: Math.max(0, Math.floor(finiteNumber(learned.confirmedCount, 0))),
    rejectedCount: Math.max(0, Math.floor(finiteNumber(learned.rejectedCount, 0))),
    updatedAt: String(learned.updatedAt || ""),
  };
}
