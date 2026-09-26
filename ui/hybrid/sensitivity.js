/**
 * sensitivity.js — Yapı Tespit Hassasiyeti ve Kademe Dönüştürücü.
 *
 * Eşik katsayılarının TEK KAYNAĞI `shared/sensitivity.json` dosyasıdır;
 * Rust tarafı (`src-tauri/src/sensitivity.rs`) aynı dosyayı `include_str!`
 * ile okur. `golden` vektörleri iki taraftaki birim testlerle ortak doğrulanır.
 *
 * Kademe modeli:
 *   - ONAYLI (confirmed): yüksek oranlı tespitler (z-skor ≥ confirmedZ VEYA
 *     güven ≥ confirmedConf) hassasiyet eşiğinden MUAFTIR — çubuk kısalsa da
 *     asla silinmezler. Amaç: yüksek oranlı yapı ve anomalileri açığa çıkarmak.
 *   - ADAY (candidate): min_confidence / min_area aday eşiğini geçenler.
 *   - GÜRÜLTÜ (noise): kalanlar — listeden düşer, 3D'de soluk gösterilir.
 *
 * Çubuk ayrıca keşif tohumunu (seed_z) sürer: yüksek hassasiyet zayıf ama
 * tutarlı anomalileri de KEŞFEDER, düşük hassasiyet yalnız güçlü sinyali.
 */
import spec from "../../shared/sensitivity.json";

const MATCH_MIN = spec.match_threshold.min;
const MATCH_RANGE = spec.match_threshold.range;
const AREA_MAX = spec.min_area.max;
const AREA_RANGE = spec.min_area.range;
const CONF_MAX = spec.min_confidence.max;
const CONF_RANGE = spec.min_confidence.range;
const SEED_Z_MAX = spec.seed_z.max;
const SEED_Z_RANGE = spec.seed_z.range;
const CONFIRMED_Z = spec.confirmed.z;
const CONFIRMED_CONF = spec.confirmed.confidence;

/** Güven alanı 0–1'e normalize (0–100 ölçeğinde gelmiş olabilir). */
function confNorm(a) {
  if (typeof a?.confidence !== "number") return null;
  return a.confidence > 1 ? a.confidence / 100 : a.confidence;
}

/**
 * Hassasiyet yüzdesini (%0 - %100) teknik analiz eşiklerine dönüştürür.
 * @param {number} percent — 0 ile 100 arasında hassasiyet değeri
 * @returns {{
 *   percent: number,
 *   normalized: number,
 *   matchThreshold: number,
 *   minArea: number,
 *   minConfidence: number,
 *   seedZ: number,
 *   confirmedZ: number,
 *   confirmedConf: number,
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

  // ADAY güven eşiği (%80 katı .. %15 hassas sinyaller) — ONAYLI kademe muaf
  const minConfidence = Number((CONF_MAX - norm * CONF_RANGE).toFixed(2));

  // Keşif tohumu (σ): 2.5σ yalnız güçlü .. 1.0σ zayıf ama tutarlı anomaliler
  const seedZ = Number((SEED_Z_MAX - norm * SEED_Z_RANGE).toFixed(3));

  let label = "Dengeli";
  let badgeColor = "#eab308";
  let description = "Dengeli keşif · yüksek oranlılar ONAYLI, zayıflar ADAY";

  if (p <= 20) {
    label = "🔴 Katı (Düşük)";
    badgeColor = "#ef4444";
    description = "Katı aday eşiği · ONAYLI yüksek oranlı yapılar her koşulda görünür";
  } else if (p <= 45) {
    label = "🟠 Düşük";
    badgeColor = "#f97316";
    description = "Yalnız güçlü-orta yapılar aday olur · ONAYLI kademe muaf";
  } else if (p <= 65) {
    label = "🟡 Dengeli";
    badgeColor = "#eab308";
    description = "Dengeli keşif · yüksek oranlılar ONAYLI, zayıflar ADAY";
  } else if (p <= 85) {
    label = "🟢 Yüksek";
    badgeColor = "#3edc8c";
    description = "Zayıf anomali keşfi açık · tohum eşiği düşer, yeni yapılar açığa çıkar";
  } else {
    label = "🔵 Maksimum (Detaylı)";
    badgeColor = "#3b82f6";
    description = "Maksimum keşif · en zayıf tutarlı sinyaller bile aday kademeye girer";
  }

  return {
    percent: p,
    normalized: norm,
    matchThreshold,
    minArea,
    minConfidence,
    seedZ,
    confirmedZ: CONFIRMED_Z,
    confirmedConf: CONFIRMED_CONF,
    label,
    badgeColor,
    description,
  };
}

/**
 * Tespitin "oran" skoru (0–1): manyetik güç (z-skor) + güven bileşimi.
 * Yüksek oranlı tespitlerin sıralanması ve vurgulanması için kullanılır.
 * @param {Object} a — tespit nesnesi ({zScore, magnetic, confidence, area})
 * @returns {number} 0–1 arası oran skoru
 */
export function detectionScore(a = {}) {
  const strength =
    typeof a.zScore === "number"
      ? Math.min(1, Math.abs(a.zScore) / 4)
      : Math.min(1, Math.abs(a.magnetic || 0) / 500);
  const conf = confNorm(a) ?? 0.5;
  return Math.max(0, Math.min(1, 0.65 * strength + 0.35 * conf));
}

/**
 * Tek tespiti kademele: 'confirmed' | 'candidate' | 'noise'.
 * ONAYLI tespitler hassasiyet eşiğinden muaftır.
 * @param {Object} a — tespit nesnesi
 * @param {Object} params — calculateSensitivityParameters çıktısı
 * @returns {'confirmed'|'candidate'|'noise'}
 */
export function tierDetection(a, params) {
  const conf = confNorm(a);
  const zs = Math.abs(a.zScore || 0);
  if (zs >= params.confirmedZ || (conf != null && conf >= params.confirmedConf)) {
    return "confirmed";
  }
  const areaOk = typeof a.area !== "number" || a.area >= params.minArea;
  const judged = conf != null || typeof a.zScore === "number";
  if (!judged) return areaOk ? "candidate" : "noise";
  if (conf != null && conf >= params.minConfidence && areaOk) return "candidate";
  return "noise";
}

/**
 * Tespit listesini kademeleyip `tier` ve `score` alanlarıyla zenginleştirir.
 * @param {Array} anomalies
 * @param {number} sensitivityPercent — %0 - %100
 * @returns {Array} tier/score eklenmiş yeni liste (orijinal sıra korunur)
 */
export function annotateTiers(anomalies = [], sensitivityPercent = 50) {
  if (!Array.isArray(anomalies)) return [];
  const params = calculateSensitivityParameters(sensitivityPercent);
  return anomalies.map((a) => ({
    ...a,
    tier: tierDetection(a, params),
    score: detectionScore(a),
  }));
}

/**
 * Kademe kırılımı: {confirmed, candidate, noise, kept}.
 */
export function summarizeTiers(anomalies = [], sensitivityPercent = 50) {
  const tiers = annotateTiers(anomalies, sensitivityPercent);
  const counts = { confirmed: 0, candidate: 0, noise: 0, kept: 0 };
  for (const t of tiers) {
    counts[t.tier] += 1;
    if (t.tier !== "noise") counts.kept += 1;
  }
  return counts;
}

/**
 * Tespitleri hassasiyet seviyesine göre süzer — TEK KESİM NOKTASI.
 * ONAYLI (yüksek oranlı) tespitler her koşulda geçer; çubuk yalnız ADAY
 * eşiğini (min güven / min alan) uygular.
 * @param {Array} anomalies — Tespit edilen anomali/yapı nesneleri listesi
 * @param {number} sensitivityPercent — %0 - %100 hassasiyet
 * @returns {Array} ONAYLI + ADAY tespitler (kademe/score alanlarıyla)
 */
export function filterDetectionsBySensitivity(anomalies = [], sensitivityPercent = 50) {
  return annotateTiers(anomalies, sensitivityPercent).filter((t) => t.tier !== "noise");
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
