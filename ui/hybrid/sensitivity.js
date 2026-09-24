/**
 * sensitivity.js — Yapı Tespit Hassasiyeti ve Eşik Dönüştürücü.
 *
 * Eşik katsayılarının TEK KAYNAĞI `shared/sensitivity.json` dosyasıdır;
 * Rust tarafı (`src-tauri/src/sensitivity.rs`) aynı dosyayı `include_str!`
 * ile okur. `golden` vektörleri iki taraftaki birim testlerle ortak doğrulanır.
 */
import spec from "../../shared/sensitivity.json";

const MATCH_MIN = spec.match_threshold.min;
const MATCH_RANGE = spec.match_threshold.range;
const AREA_MAX = spec.min_area.max;
const AREA_RANGE = spec.min_area.range;
const CONF_MAX = spec.min_confidence.max;
const CONF_RANGE = spec.min_confidence.range;

/**
 * Hassasiyet yüzdesini (%0 - %100) teknik analiz eşiklerine dönüştürür.
 * @param {number} percent — 0 ile 100 arasında hassasiyet değeri
 * @returns {{
 *   percent: number,
 *   normalized: number,
 *   matchThreshold: number,
 *   minArea: number,
 *   minConfidence: number,
 *   label: string,
 *   badgeColor: string,
 *   description: string
 * }}
 */
export function calculateSensitivityParameters(percent = 50) {
  const num = Number(percent);
  const p = Math.max(0, Math.min(100, Number.isFinite(num) ? num : 50));
  const norm = p / 100.0;

  // Renk/Sinyal Toleransı (0.15 katı .. 0.60 maksimum detay)
  const matchThreshold = Number((MATCH_MIN + norm * MATCH_RANGE).toFixed(3));

  // Min Yapı Piksel Alanı (250px kütlesel .. 15px ince detay)
  const minArea = Math.round(AREA_MAX - norm * AREA_RANGE);

  // Min Güven Skoru (%80 katı .. %15 hassas sinyaller)
  const minConfidence = Number((CONF_MAX - norm * CONF_RANGE).toFixed(2));

  let label = "Dengeli";
  let badgeColor = "#eab308";
  let description = "Standart anomali ve yapı tespiti";

  if (p <= 20) {
    label = "🔴 Katı (Düşük)";
    badgeColor = "#ef4444";
    description = "Sadece belirgin büyük kütleler (sıfır gürültü)";
  } else if (p <= 45) {
    label = "🟠 Düşük";
    badgeColor = "#f97316";
    description = "Büyük ve orta ölçekli yapı odakları";
  } else if (p <= 65) {
    label = "🟡 Dengeli";
    badgeColor = "#eab308";
    description = "Optimal sahil ve yapı analizi";
  } else if (p <= 85) {
    label = "🟢 Yüksek";
    badgeColor = "#3edc8c";
    description = "İnce zayıf anomali ve katman izleri";
  } else {
    label = "🔵 Maksimum (Detaylı)";
    badgeColor = "#3b82f6";
    description = "Hassas küçük detaylar ve renk sapmaları";
  }

  return {
    percent: p,
    normalized: norm,
    matchThreshold,
    minArea,
    minConfidence,
    label,
    badgeColor,
    description,
  };
}

/**
 * Tespit edilen anomalileri hassasiyet seviyesine göre filtreler.
 * @param {Array} anomalies — Tespit edilen anomali/yapı nesneleri listesi
 * @param {number} sensitivityPercent — %0 - %100 hassasiyet
 * @returns {Array} Filtrelenmiş anomali listesi
 */
export function filterDetectionsBySensitivity(anomalies = [], sensitivityPercent = 50) {
  if (!Array.isArray(anomalies)) return [];
  const params = calculateSensitivityParameters(sensitivityPercent);

  return anomalies.filter((a) => {
    // Area kontrolü
    if (typeof a.area === "number" && a.area < params.minArea) {
      return false;
    }
    // Confidence kontrolü (0-1 veya 0-100 formatında olabilir)
    if (typeof a.confidence === "number") {
      const confNorm = a.confidence > 1 ? a.confidence / 100 : a.confidence;
      if (confNorm < params.minConfidence) return false;
    }
    return true;
  });
}

/**
 * Min güven skorunu (0–1) tersine çevirip hassasiyet yüzdesine döndürür.
 * Arşiv geri yükleme gibi, kayıtlı min güven değerinden slider konumunu
 * yeniden kurmak için kullanılır. `calculateSensitivityParameters` içindeki
 * min güven formülünün tersidir ve 5'lik slider adımına yuvarlanır.
 * @param {number} minConfidence — 0.15 (hassas) ↔ 0.80 (katı)
 * @returns {number} 0–100 hassasiyet yüzdesi
 */
export function sensitivityPercentForMinConfidence(minConfidence = 0.45) {
  const raw = Number(minConfidence);
  const lo = CONF_MAX - CONF_RANGE;
  const mc = Math.max(lo, Math.min(CONF_MAX, Number.isFinite(raw) ? raw : 0.45));
  const pct = ((CONF_MAX - mc) / CONF_RANGE) * 100;
  return Math.max(0, Math.min(100, Math.round(pct / 5) * 5));
}
