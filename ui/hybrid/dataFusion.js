/**
 * dataFusion.js — Veri Birleştirme Motoru (Fusion Engine)
 *
 * Proton ELIC image grid'i ile CSV sensör verisini birleştirir.
 * Ağırlıklı ortalama, güven skoru ve eksik veri doldurma sağlar.
 *
 * Fiziksel mantık:
 *   - CSV verisi: Doğrudan ölçülmüş, yüksek güvenilirlik
 *   - Image verisi: Renk dönüşümü ile approx, düşük güvenilirlik
 *   - İkisi de varsa → ağırlıklı ortalama
 *   - Sadece biri varsa → o kaynaktan, güven düşer
 */

// ── Sabitler ──

/** Varsayılan ağırlıklar */
export const DEFAULT_WEIGHTS = {
  csv: 0.70,    // CSV verisi %70 ağırlık
  image: 0.30,  // Image verisi %30 ağırlık
};

/** Güven eşiği */
export const CONFIDENCE_THRESHOLDS = {
  excellent: 0.85, // Her iki kaynak + tutarlı
  good: 0.65,      // İki kaynak veya güçlü tek kaynak
  fair: 0.40,      // Zayıf tek kaynak
  poor: 0.20,      // Çok az veri
};

// ── Yardımcılar ──

/** İki manyetik değer arasındaki fark (anomali boyutu) */
function magneticDiff(a, b) {
  return Math.abs(a - b);
}

/** Güven skoru hesapla */
function computeConfidence(cell) {
  const hasCsv = cell.csvCount > 0;
  const hasImage = cell.imageCount > 0;

  if (hasCsv && hasImage) {
    // Her iki kaynak da var
    const agreement = 1 - Math.min(1, magneticDiff(cell.csvMagnetic, cell.imageMagnetic) / 500);
    const density = Math.min(1, (cell.csvCount + cell.imageCount) / 20);
    return 0.5 + 0.3 * agreement + 0.2 * density;
  }

  if (hasCsv) {
    // Sadece CSV
    const density = Math.min(1, cell.csvCount / 10);
    return 0.3 + 0.4 * density;
  }

  if (hasImage) {
    // Sadece Image
    const density = Math.min(1, cell.imageCount / 10);
    return 0.1 + 0.25 * density;
  }

  return 0;
}

/** Hücreye en yakın CSV noktalarını bul (k-NN) */
function findNearestCsv(cellX, cellY, csvPoints, maxDist, maxCount) {
  const dists = [];
  for (const p of csvPoints) {
    const d = Math.hypot(p.x - cellX, p.y - cellY);
    if (d < maxDist) {
      dists.push({ point: p, dist: d });
    }
  }
  dists.sort((a, b) => a.dist - b.dist);
  return dists.slice(0, maxCount).map(d => d.point);
}

/** Hücreye en yakın image noktalarını bul */
function findNearestImage(cellX, cellY, imagePoints, maxDist, maxCount) {
  const dists = [];
  for (const p of imagePoints) {
    const d = Math.hypot(p.x - cellX, p.y - cellY);
    if (d < maxDist) {
      dists.push({ point: p, dist: d });
    }
  }
  dists.sort((a, b) => a.dist - b.dist);
  return dists.slice(0, maxCount).map(d => d.point);
}

/** Mesafe ağırlıklı ortalama */
function weightedAverageByDistance(points, distances) {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].magnetic || points[0].nT || 0;

  let totalWeight = 0;
  let totalValue = 0;

  for (let i = 0; i < points.length; i++) {
    const val = points[i].magnetic ?? points[i].nT ?? 0;
    const dist = distances[i] ?? 1;
    const w = 1 / (dist + 0.01); // Mesafeye ters orantılı
    totalWeight += w;
    totalValue += val * w;
  }

  return totalWeight > 0 ? totalValue / totalWeight : 0;
}

// ── Ana Fonksiyon ──

/**
 * Image ve CSV verisini birleştir.
 *
 * @param {Object} options
 * @param {Array} options.imageGrid - extractMagneticGrid çıktısı [{x,y,nT,...}]
 * @param {Array} options.csvPoints - CSV noktaları [{x,y,magnetic,...}]
 * @param {number} [options.gridRes=64] - Çıktı grid çözünürlüğü
 * @param {number} [options.csvWeight=0.70] - CSV ağırlığı (0-1)
 * @param {number} [options.imageWeight=0.30] - Image ağırlığı (0-1)
 * @param {number} [options.searchRadius=5] - Komşu arama yarıçapı (birim)
 * @param {number} [options.maxNeighbors=10] - Maksimum komşu sayısı
 * @returns {Object} { grid, stats, fusionMap }
 */
export function fuseDataSources(options) {
  const {
    imageGrid = [],
    csvPoints = [],
    gridRes = 64,
    csvWeight = DEFAULT_WEIGHTS.csv,
    imageWeight = DEFAULT_WEIGHTS.image,
    searchRadius = 5,
    maxNeighbors = 10,
  } = options;

  // Ağırlıkları normalize et
  const totalWeight = csvWeight + imageWeight;
  const normCsvWeight = csvWeight / totalWeight;
  const normImageWeight = imageWeight / totalWeight;

  // Sınırları hesapla
  const allPoints = [...csvPoints.map(p => ({ x: p.x, y: p.y }))];
  if (imageGrid.length > 0) {
    allPoints.push(...imageGrid.map(p => ({ x: p.x, y: p.y })));
  }

  if (allPoints.length === 0) {
    return { grid: [], stats: emptyStats(), fusionMap: new Map() };
  }

  const bounds = {
    xMin: Math.min(...allPoints.map(p => p.x)),
    xMax: Math.max(...allPoints.map(p => p.x)),
    yMin: Math.min(...allPoints.map(p => p.y)),
    yMax: Math.max(...allPoints.map(p => p.y)),
  };

  const rangeX = bounds.xMax - bounds.xMin || 1;
  const rangeY = bounds.yMax - bounds.yMin || 1;
  const cellW = rangeX / gridRes;
  const cellH = rangeY / gridRes;

  // Fusion grid'ini oluştur
  const grid = [];
  const fusionMap = new Map(); // gx,gy → hücre indeksi

  let csvOnlyCount = 0;
  let imageOnlyCount = 0;
  let bothCount = 0;
  let emptyCount = 0;
  let totalConfidence = 0;
  let nTMin = Infinity, nTMax = -Infinity;
  let agreementSum = 0, agreementCount = 0;

  for (let gy = 0; gy < gridRes; gy++) {
    for (let gx = 0; gx < gridRes; gx++) {
      const cellX = bounds.xMin + gx * cellW + cellW / 2;
      const cellY = bounds.yMin + gy * cellH + cellH / 2;

      // Bu hücredeki CSV noktalarını bul
      const csvNeighbors = findNearestCsv(cellX, cellY, csvPoints, searchRadius * cellW, maxNeighbors);
      const csvDists = csvNeighbors.map(p => Math.hypot(p.x - cellX, p.y - cellY));

      // Bu hücredeki image noktalarını bul
      const imageNeighbors = findNearestImage(cellX, cellY, imageGrid, searchRadius * cellH, maxNeighbors);
      const imageDists = imageNeighbors.map(p => Math.hypot(p.x - cellX, p.y - cellY));

      // Manyetik değerleri hesapla
      const csvMagnetic = weightedAverageByDistance(csvNeighbors, csvDists);
      const imageMagnetic = weightedAverageByDistance(imageNeighbors, imageDists);

      const hasCsv = csvNeighbors.length > 0;
      const hasImage = imageNeighbors.length > 0;

      // Birleştirilmiş manyetik değer
      let fusedMagnetic;
      if (hasCsv && hasImage) {
        fusedMagnetic = csvMagnetic * normCsvWeight + imageMagnetic * normImageWeight;
      } else if (hasCsv) {
        fusedMagnetic = csvMagnetic;
      } else if (hasImage) {
        fusedMagnetic = imageMagnetic;
      } else {
        emptyCount++;
        continue; // Boş hücreleri atla
      }

      // Güven skoru
      const cell = {
        csvMagnetic,
        imageMagnetic,
        csvCount: csvNeighbors.length,
        imageCount: imageNeighbors.length,
      };
      const confidence = computeConfidence(cell);
      totalConfidence += confidence;

      // Kaynak sayımı
      if (hasCsv && hasImage) bothCount++;
      else if (hasCsv) csvOnlyCount++;
      else imageOnlyCount++;

      // Uyum kontrolü (her iki kaynak da varsa)
      if (hasCsv && hasImage) {
        const diff = magneticDiff(csvMagnetic, imageMagnetic);
        agreementSum += Math.max(0, 1 - diff / 500);
        agreementCount++;
      }

      // nT aralığı
      if (fusedMagnetic < nTMin) nTMin = fusedMagnetic;
      if (fusedMagnetic > nTMax) nTMax = fusedMagnetic;

      const cellData = {
        gx, gy,
        x: (gx + 0.5) / gridRes, // Normalize 0-1
        y: (gy + 0.5) / gridRes,
        worldX: cellX,
        worldY: cellY,
        magnetic: fusedMagnetic,
        csvMagnetic,
        imageMagnetic,
        confidence,
        sources: hasCsv && hasImage ? ['csv', 'image'] : hasCsv ? ['csv'] : ['image'],
        csvCount: csvNeighbors.length,
        imageCount: imageNeighbors.length,
      };

      grid.push(cellData);
      fusionMap.set(`${gx},${gy}`, grid.length - 1);
    }
  }

  const filledCells = grid.length;
  const totalCells = gridRes * gridRes;

  const stats = {
    gridRes,
    totalCells,
    filledCells,
    emptyCells: totalCells - filledCells,
    fillRate: filledCells / totalCells,
    csvOnlyCells: csvOnlyCount,
    imageOnlyCells: imageOnlyCount,
    bothCells: bothCount,
    avgConfidence: filledCells > 0 ? totalConfidence / filledCells : 0,
    agreementRate: agreementCount > 0 ? agreementSum / agreementCount : 0,
    nTMin: nTMin === Infinity ? 0 : nTMin,
    nTMax: nTMax === -Infinity ? 0 : nTMax,
    csvPoints: csvPoints.length,
    imagePoints: imageGrid.length,
  };

  console.log(`[Fusion] Grid: ${gridRes}×${gridRes}, ${filledCells} hücre (${(stats.fillRate * 100).toFixed(0)}% dolu)`);
  console.log(`[Fusion] Kaynaklar: ${csvOnlyCount} sadece CSV, ${imageOnlyCount} sadece image, ${bothCount} her ikisi`);
  console.log(`[Fusion] Güven: ${(stats.avgConfidence * 100).toFixed(0)}%, Uyum: ${(stats.agreementRate * 100).toFixed(0)}%`);
  console.log(`[Fusion] nT aralığı: ${stats.nTMin.toFixed(0)}..${stats.nTMax.toFixed(0)}`);

  return { grid, stats, fusionMap };
}

// ── İstatistikler ──

function emptyStats() {
  return {
    gridRes: 0, totalCells: 0, filledCells: 0, emptyCells: 0,
    fillRate: 0, csvOnlyCells: 0, imageOnlyCells: 0, bothCells: 0,
    avgConfidence: 0, agreementRate: 0, nTMin: 0, nTMax: 0,
    csvPoints: 0, imagePoints: 0,
  };
}

// ── nT Haritası ──

/**
 * Fusion grid'ini renkli canvas'a çiz.
 *
 * @param {Array} grid - fuseDataSources çıktısı
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {Object} options
 * @param {number} [options.ntRange=500] - nT aralığı
 * @param {boolean} [options.showConfidence=true] - Güven skorunu opaklık olarak göster
 * @returns {HTMLCanvasElement}
 */
export function renderFusionCanvas(grid, canvasW, canvasH, options = {}) {
  const { ntRange = 500, showConfidence = true } = options;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // Siyah zemin
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, canvasW, canvasH);

  if (grid.length === 0) return canvas;

  const gridRes = Math.max(...grid.map(g => Math.max(g.gx, g.gy))) + 1;
  const cellW = canvasW / gridRes;
  const cellH = canvasH / gridRes;

  for (const cell of grid) {
    const normalized = cell.magnetic / ntRange; // -1..+1
    const abs = Math.abs(normalized);

    let r, g, b;
    if (normalized > 0) {
      // Pozitif → kırmızı/sarı/beyaz
      r = Math.round(80 + 175 * abs);
      g = Math.round(30 + 100 * abs * abs);
      b = Math.round(20 + 40 * abs * abs);
    } else {
      // Negatif → mavi/lacivert/beyaz
      r = Math.round(20 + 40 * abs * abs);
      g = Math.round(30 + 80 * abs * abs);
      b = Math.round(80 + 175 * abs);
    }

    // Opaklık: güven skoruna göre
    const alpha = showConfidence
      ? 0.3 + 0.7 * cell.confidence
      : 0.8;

    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.fillRect(cell.gx * cellW, cell.gy * cellH, cellW + 1, cellH + 1);
  }

  // Kenarlık çizgileri (hücre sınırları, opsiyonel)
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= gridRes; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cellW, 0);
    ctx.lineTo(i * cellW, canvasH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cellH);
    ctx.lineTo(canvasW, i * cellH);
    ctx.stroke();
  }

  return canvas;
}

// ── Güven Haritası ──

/**
 * Güven skorlarını renkli harita olarak göster.
 * Yeşil = yüksek güven, Sarı = orta, Kırmızı = düşük.
 *
 * @param {Array} grid - fuseDataSources çıktısı
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {HTMLCanvasElement}
 */
export function renderConfidenceMap(grid, canvasW, canvasH) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvasW, canvasH);

  if (grid.length === 0) return canvas;

  const gridRes = Math.max(...grid.map(g => Math.max(g.gx, g.gy))) + 1;
  const cellW = canvasW / gridRes;
  const cellH = canvasH / gridRes;

  for (const cell of grid) {
    const c = cell.confidence;
    let r, g, b;

    if (c >= 0.7) {
      // Yüksek → yeşil
      r = Math.round(20 + 40 * (1 - c));
      g = Math.round(120 + 135 * c);
      b = Math.round(40 + 30 * c);
    } else if (c >= 0.4) {
      // Orta → sarı
      r = Math.round(180 + 75 * (c - 0.4));
      g = Math.round(140 + 60 * (c - 0.4));
      b = Math.round(20);
    } else {
      // Düşük → kırmızı
      r = Math.round(150 + 105 * (0.4 - c));
      g = Math.round(30 + 30 * c);
      b = Math.round(20);
    }

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(cell.gx * cellW, cell.gy * cellH, cellW + 1, cellH + 1);
  }

  return canvas;
}

// ── Kaynak Karşılaştırma ──

/**
 * Image ve CSV verilerini yan yana karşılaştır.
 * Uyumsuzlukları vurgular.
 *
 * @param {Array} grid - fuseDataSources çıktısı
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {number} [diffThreshold=200] - Fark eşiği (nT)
 * @returns {{ canvas, mismatches }}
 */
export function renderComparisonMap(grid, canvasW, canvasH, diffThreshold = 200) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, canvasW, canvasH);

  const mismatches = [];

  if (grid.length === 0) return { canvas, mismatches };

  const gridRes = Math.max(...grid.map(g => Math.max(g.gx, g.gy))) + 1;
  const cellW = canvasW / gridRes;
  const cellH = canvasH / gridRes;

  for (const cell of grid) {
    const hasBoth = cell.sources.includes('csv') && cell.sources.includes('image');
    let r, g, b;

    if (hasBoth) {
      const diff = Math.abs(cell.csvMagnetic - cell.imageMagnetic);
      if (diff < diffThreshold) {
        // Uyumlu → yeşil tonları
        const match = 1 - diff / diffThreshold;
        r = Math.round(20 + 40 * match);
        g = Math.round(100 + 155 * match);
        b = Math.round(40 + 40 * match);
      } else {
        // Uyumsuz → kırmızı
        r = 200;
        g = Math.round(50 + 30 * Math.min(1, diff / 500));
        b = Math.round(40);
        mismatches.push({
          gx: cell.gx, gy: cell.gy,
          csvMagnetic: cell.csvMagnetic,
          imageMagnetic: cell.imageMagnetic,
          diff,
        });
      }
    } else if (cell.sources.includes('csv')) {
      // Sadece CSV → mavi
      r = 30; g = 60; b = 150;
    } else if (cell.sources.includes('image')) {
      // Sadece Image → sarı
      r = 150; g = 130; b = 30;
    } else {
      continue;
    }

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(cell.gx * cellW, cell.gy * cellH, cellW + 1, cellH + 1);
  }

  // Legend
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(8, canvasH - 60, 140, 55);
  ctx.font = '10px monospace';
  ctx.fillStyle = '#3edc8c'; ctx.fillText('■ Uyumlu', 14, canvasH - 46);
  ctx.fillStyle = '#ff4040'; ctx.fillText('■ Uyumsuz', 14, canvasH - 34);
  ctx.fillStyle = '#3060ff'; ctx.fillText('■ Sadece CSV', 14, canvasH - 22);
  ctx.fillStyle = '#ff9620'; ctx.fillText('■ Sadece Image', 14, canvasH - 10);

  return { canvas, mismatches };
}

// ── İstatistik Paneli ──

/**
 * Fusion istatistiklerini HTML olarak formatla.
 *
 * @param {Object} stats - fuseDataSources.stats
 * @returns {string} HTML
 */
export function formatFusionStats(stats) {
  return `
    <div class="fusion-stats">
      <div class="fs-row">
        <span class="fs-label">Grid</span>
        <span class="fs-value">${stats.gridRes}×${stats.gridRes} = ${stats.totalCells} hücre</span>
      </div>
      <div class="fs-row">
        <span class="fs-label">Doluluk</span>
        <span class="fs-value">${stats.filledCells}/${stats.totalCells} (${(stats.fillRate * 100).toFixed(0)}%)</span>
      </div>
      <div class="fs-row">
        <span class="fs-label">Kaynaklar</span>
        <span class="fs-value">
          <span class="fs-csv">${stats.csvOnlyCells} CSV</span> ·
          <span class="fs-img">${stats.imageOnlyCells} Image</span> ·
          <span class="fs-both">${stats.bothCells} Her ikisi</span>
        </span>
      </div>
      <div class="fs-row">
        <span class="fs-label">Ort. Güven</span>
        <span class="fs-value ${stats.avgConfidence > 0.7 ? 'good' : stats.avgConfidence > 0.4 ? 'fair' : 'poor'}">
          ${(stats.avgConfidence * 100).toFixed(0)}%
        </span>
      </div>
      <div class="fs-row">
        <span class="fs-label">Uyum</span>
        <span class="fs-value">${(stats.agreementRate * 100).toFixed(0)}%</span>
      </div>
      <div class="fs-row">
        <span class="fs-label">nT Aralığı</span>
        <span class="fs-value">${stats.nTMin.toFixed(0)}..${stats.nTMax.toFixed(0)} nT</span>
      </div>
      <div class="fs-row">
        <span class="fs-label">Noktalar</span>
        <span class="fs-value">${stats.csvPoints} CSV + ${stats.imagePoints} Image</span>
      </div>
    </div>
  `;
}
