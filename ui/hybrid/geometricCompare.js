/**
 * geometricCompare.js — Geometrik Karşılaştırma
 *
 * Image ve CSV tespitlerinin geometrik özelliklerini karşılaştırır:
 *   - Boyut (genişlik, uzunluk)
 *   - Derinlik
 *   - Yön / eğim
 *   - Alan gücü
 *
 * Her ölçü için tutarlılık skoru üretir:
 *   0.0 = tam uyumsuz → 1.0 = tam uyumlu
 *
 * Geri dönüşümlü: enable(false) ile pasif.
 */

// ── Sabitler ──

const DEPTH_TOLERANCE_M = 2.0;      // Derinlik toleransı (m)
const SIZE_TOLERANCE_RATIO = 0.40;   // Boyut toleransı (%40)
const MAGNETIC_TOLERANCE_NT = 100;   // Manyetik tolerans (nT)
const ORIENTATION_TOLERANCE_DEG = 30;// Yön toleransı (derece)

let enabled = false;

/**
 * Tek bir image tespiti ile CSV tespitini geometrik olarak karşılaştır.
 *
 * @param {Object} imageDet - {x, y, depth, magnetic, spread, width, length, orientation}
 * @param {Object} csvDet - {x, y, depth, magnetic, spread, width, length, orientation}
 * @returns {Object} { score, metrics, summary }
 */
export function compareGeometric(imageDet, csvDet) {
  if (!enabled) {
    return { score: 0, metrics: {}, summary: "Geometrik karşılaştırma pasif" };
  }

  const img = imageDet || {};
  const csv = csvDet || {};

  const metrics = {};

  // ── 1. Derinlik karşılaştırması ──
  const depthDiff = Math.abs((img.depth || 0) - (csv.depth || 0));
  metrics.depth = {
    image: img.depth || null,
    csv: csv.depth || null,
    diff: depthDiff,
    score: Math.max(0, 1 - depthDiff / Math.max(DEPTH_TOLERANCE_M * 2, 1)),
  };

  // ── 2. Boyut karşılaştırması ──
  const imgSize = (img.spread || img.width || 0);
  const csvSize = (csv.spread || csv.width || 0);
  const sizeDiff = Math.abs(imgSize - csvSize);
  const sizeAvg = (imgSize + csvSize) / 2 || 1;
  metrics.size = {
    image: imgSize,
    csv: csvSize,
    diff: sizeDiff,
    ratio: sizeDiff / sizeAvg,
    score: Math.max(0, 1 - (sizeDiff / sizeAvg) / SIZE_TOLERANCE_RATIO),
  };

  // ── 3. Manyetik yoğunluk karşılaştırması ──
  const magDiff = Math.abs((img.magnetic || 0) - (csv.magnetic || 0));
  metrics.magnetic = {
    image: img.magnetic || null,
    csv: csv.magnetic || null,
    diff: magDiff,
    score: Math.max(0, 1 - magDiff / (MAGNETIC_TOLERANCE_NT * 2)),
  };

  // ── 4. Yön karşılaştırması ──
  const imgOri = img.orientation || null;
  const csvOri = csv.orientation || null;
  if (imgOri !== null && csvOri !== null) {
    let oriDiff = Math.abs(imgOri - csvOri);
    if (oriDiff > 180) oriDiff = 360 - oriDiff;
    metrics.orientation = {
      image: imgOri,
      csv: csvOri,
      diff: oriDiff,
      score: Math.max(0, 1 - oriDiff / ORIENTATION_TOLERANCE_DEG),
    };
  } else {
    metrics.orientation = { score: null, diff: null, message: "Yön verisi eksik" };
  }

  // ── 5. Tip karşılaştırması ──
  metrics.type = {
    image: img.type || null,
    csv: csv.type || null,
    match: (img.type || '') === (csv.type || ''),
    score: (img.type || '') === (csv.type || '') ? 1.0 : 0.2,
  };

  // ── Ağırlıklı toplam skor ──
  const weights = {
    depth: 0.30,
    size: 0.20,
    magnetic: 0.25,
    orientation: 0.10,
    type: 0.15,
  };

  let totalWeight = 0;
  let weightedSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const m = metrics[key];
    if (m && m.score !== null && m.score !== undefined) {
      weightedSum += m.score * weight;
      totalWeight += weight;
    }
  }

  const score = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // ── Özet ──
  const strengths = [];
  const weaknesses = [];

  if (metrics.depth.score >= 0.7) strengths.push("derinlik tutarlı");
  else if (metrics.depth.score < 0.4) weaknesses.push(`derinlik farkı ${metrics.depth.diff.toFixed(1)}m`);

  if (metrics.size.score >= 0.7) strengths.push("boyut tutarlı");
  else if (metrics.size.score < 0.4) weaknesses.push(`boyut farkı %${(metrics.size.ratio * 100).toFixed(0)}`);

  if (metrics.magnetic.score >= 0.7) strengths.push("manyetik tutarlı");
  else if (metrics.magnetic.score < 0.4) weaknesses.push(`manyetik farkı ${metrics.magnetic.diff.toFixed(0)}nT`);

  if (metrics.type.match) strengths.push("tip uyumlu");
  else weaknesses.push("tip uyuşmazlığı");

  const summary = strengths.length > 0 && weaknesses.length === 0
    ? `Tutarlı (${strengths.join(', ')})`
    : weaknesses.length > 0
      ? `Kısmen tutarsız (${weaknesses.join(', ')})`
      : "Veri yetersiz";

  return { score, metrics, summary, strengths, weaknesses };
}

/**
 * Birden fazla eşleşme için geometrik karşılaştırma yap.
 *
 * @param {Array} matches - crossValidate matches
 * @returns {Object} { comparisons, averageScore, detailedHtml }
 */
export function batchGeometricCompare(matches) {
  if (!enabled || !matches || matches.length === 0) {
    return { comparisons: [], averageScore: 0, detailedHtml: "" };
  }

  const comparisons = matches.map(m => ({
    image: m.image,
    csv: m.csv,
    ...compareGeometric(m.image, m.csv),
  }));

  const totalScore = comparisons.reduce((s, c) => s + c.score, 0);
  const averageScore = comparisons.length > 0 ? totalScore / comparisons.length : 0;

  // Detaylı HTML rapor
  let html = '<div class="geo-compare-report">';
  html += `<div class="geo-header">Geometrik Karşılaştırma: ${(averageScore * 100).toFixed(0)}% uyum</div>`;

  for (let i = 0; i < comparisons.length; i++) {
    const c = comparisons[i];
    const color = c.score >= 0.7 ? '#10b981' : c.score >= 0.4 ? '#f59e0b' : '#ef4444';
    html += `
      <div class="geo-item" style="border-left: 3px solid ${color}">
        <div class="geo-title">Tespit ${i + 1}: ${(c.score * 100).toFixed(0)}%</div>
        <div class="geo-detail">
          Derinlik: Image ${(c.metrics.depth.image || '?')}m vs CSV ${(c.metrics.depth.csv || '?')}m (fark: ${(c.metrics.depth.diff || 0).toFixed(1)}m)
        </div>
        <div class="geo-detail">
          Boyut: Image ${(c.metrics.size.image || '?')}m vs CSV ${(c.metrics.size.csv || '?')}m
        </div>
        <div class="geo-detail">
          Manyetik: Image ${(c.metrics.magnetic.image || '?')}nT vs CSV ${(c.metrics.magnetic.csv || '?')}nT
        </div>
        <div class="geo-summary">${c.summary}</div>
      </div>
    `;
  }

  html += '</div>';
  return { comparisons, averageScore, detailedHtml: html };
}

/**
 * Geometrik karşılaştırmayı aktifleştir/pasifleştir.
 */
export function setGeometricCompareEnabled(e) {
  enabled = !!e;
  console.log(`[GeometricCompare] ${enabled ? 'AKTİF' : 'PASİF'}`);
}

/**
 * Aktiflik durumunu döndür.
 */
export function isGeometricCompareEnabled() {
  return enabled;
}
