/**
 * unifiedConfidence.js — Birleşik Güven Skoru
 *
 * Image ve CSV güven skorlarını birleştirir:
 *   jointConfidence = CSV_conf × Image_conf × consistency
 *
 * Ek olarak:
 *   - Kaynak güvenilirliği ağırlığı
 *   - Derinlik tutarlılığı bonusu
 *   - Manyetik tutarlılığı bonusu
 *
 * Geri dönüşümlü: enable(false) ile pasif moda geçilir.
 */

// ── Sabitler ──

const CSV_BASE_CONFIDENCE = 0.80;     // CSV kendi başına %80 güvenilir
const IMAGE_BASE_CONFIDENCE = 0.55;   // Image kendi başına %55 güvenilir
const CONSISTENCY_BOOST = 0.15;       // Uyum varsa bonus
const DEPTH_CONSISTENCY_BONUS = 0.10; // Derinlik tutarsa bonus
const MAGNETIC_CONSISTENCY_BONUS = 0.05; // Manyetik tutarsa bonus

// ── Durum ──

let enabled = false;

/**
 * Tek bir tespit için birleşik güven skoru hesapla.
 *
 * @param {Object} detection - Ortak tespit nesnesi
 * @param {Object} [options]
 * @param {number} [options.csvConfidence] - CSV güveni (0-1)
 * @param {number} [options.imageConfidence] - Image güveni (0-1)
 * @param {boolean} [options.isConsistent] - Cross-val tutarlı mı?
 * @param {number} [options.depthDiff] - Derinlik farkı (m)
 * @param {number} [options.magneticDiff] - Manyetik fark (nT)
 * @returns {Object} { score, grade, details }
 */
export function computeUnifiedConfidence(detection, options = {}) {
  if (!enabled) {
    return {
      score: options.csvConfidence || 0.5,
      grade: "N/A",
      details: { message: "Birleşik güven pasif" },
    };
  }

  const det = detection || {};
  const csvConf = clamp01(options.csvConfidence ?? CSV_BASE_CONFIDENCE);
  const imgConf = clamp01(options.imageConfidence ?? IMAGE_BASE_CONFIDENCE);
  const isConsistent = !!options.isConsistent;
  const depthDiff = Math.abs(options.depthDiff || 0);
  const magneticDiff = Math.abs(options.magneticDiff || 0);

  // ── Temel güven ──
  // Geometrik ortalama (her iki kaynak da önemli)
  let baseConfidence = Math.sqrt(csvConf * imgConf);

  // ── Tutarlılık bonusu ──
  let bonus = 0;
  if (isConsistent) bonus += CONSISTENCY_BOOST;
  if (depthDiff < 2.0) bonus += DEPTH_CONSISTENCY_BONUS;
  if (magneticDiff < 50) bonus += MAGNETIC_CONSISTENCY_BONUS;

  // ── Final skoru ──
  const score = clamp01(baseConfidence + bonus);

  // ── Derecelendirme ──
  let grade;
  if (score >= 0.90) grade = "Mükemmel";
  else if (score >= 0.75) grade = "Güçlü";
  else if (score >= 0.60) grade = "Orta";
  else if (score >= 0.40) grade = "Zayıf";
  else grade = "Guvenilmez";

  return {
    score,
    grade,
    details: {
      csvConfidence: csvConf,
      imageConfidence: imgConf,
      baseConfidence,
      bonus,
      isConsistent,
      depthDiff,
      magneticDiff,
      sources: isConsistent ? ["image", "csv"] : ["tek kaynak"],
    },
  };
}

/**
 * Birden fazla tespit için toplu güven skorları hesapla.
 *
 * @param {Array} detections - [{...detection, csvConfidence, imageConfidence, ...}]
 * @returns {Object} { results, averageScore, gradeDistribution }
 */
export function computeBatchConfidence(detections) {
  if (!enabled || !detections || detections.length === 0) {
    return { results: [], averageScore: 0, gradeDistribution: {} };
  }

  const results = detections.map(det =>
    computeUnifiedConfidence(det, {
      csvConfidence: det.csvConfidence,
      imageConfidence: det.imageConfidence,
      isConsistent: det.isConsistent,
      depthDiff: det.depthDiff,
      magneticDiff: det.magneticDiff,
    })
  );

  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const averageScore = totalScore / results.length;

  const gradeDistribution = {};
  for (const r of results) {
    gradeDistribution[r.grade] = (gradeDistribution[r.grade] || 0) + 1;
  }

  return { results, averageScore, gradeDistribution };
}

/**
 * Birleşik güven raporu oluştur (HTML).
 *
 * @param {Object} batchResult - computeBatchConfidence çıktısı
 * @returns {string} HTML string
 */
export function renderConfidenceReport(batchResult) {
  if (!batchResult || batchResult.results.length === 0) {
    return '<div class="conf-report conf-empty">Birleşik güven verisi yok</div>';
  }

  const { averageScore, gradeDistribution, results } = batchResult;
  const avgPct = (averageScore * 100).toFixed(0);

  const gradeColors = {
    "Mükemmel": "#10b981",
    "Güçlü": "#3b82f6",
    "Orta": "#f59e0b",
    "Zayıf": "#f97316",
    "Guvenilmez": "#ef4444",
  };

  let distHtml = "";
  for (const [grade, count] of Object.entries(gradeDistribution)) {
    const color = gradeColors[grade] || "#888";
    distHtml += `<span style="color:${color};margin-right:8px">${grade}: ${count}</span>`;
  }

  return `
    <div class="conf-report">
      <div class="conf-header">
        <span class="conf-avg" style="color:${avgPct >= 75 ? '#10b981' : avgPct >= 50 ? '#f59e0b' : '#ef4444'}">
          ${avgPct}%
        </span>
        <span class="conf-label">Ortalama Güven</span>
      </div>
      <div class="conf-dist">${distHtml}</div>
      <div class="conf-count">${results.length} tespit değerlendirildi</div>
    </div>
  `;
}

/**
 * Birleşik güveni aktifleştir/pasifleştir.
 *
 * @param {boolean} e
 */
export function setUnifiedConfidenceEnabled(e) {
  enabled = !!e;
  console.log(`[UnifiedConfidence] ${enabled ? 'AKTİF' : 'PASİF'}`);
}

/**
 * Aktiflik durumunu döndür.
 */
export function isUnifiedConfidenceEnabled() {
  return enabled;
}

// ── Yardımcı ──

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}
