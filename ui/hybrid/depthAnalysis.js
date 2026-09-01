/**
 * depthAnalysis.js — Derinlik Analizi Modülü
 *
 * Fusion engine çıktısından (image + CSV birleşimi) derinlik haritası çıkarır.
 *
 * Fiziksel temel:
 *   - Manyetik gradyan (değişim hızı) ile derinlik ters orantılı
 *   - Güçlü sinyal → sığ anomali
 *   - Zayıf, geniş sinyal → derin anomali
 *   - Toprak türü derinlik çarpanını etkiler
 *
 * İki analiz modu:
 *   1. Basit: Gradyan tabanlı hızlı tahmin
 *   2. Gelişmiş: 3B potansiyel alanı inversiyonu
 */

// ── Toprak Profilleri ──

export const SOIL_PROFILES = {
  off:     { label: 'Kapalı (eski hesap)', factor: 1.00, desc: 'Legacy derinlik hesabı' },
  sand:    { label: 'Kum / çakıl',         factor: 1.10, desc: 'Kuru kum, manyetik yayılım geniş' },
  loam:    { label: 'Tın / nötr',          factor: 1.00, desc: 'Nötr referans' },
  clay:    { label: 'Nemli kil',           factor: 0.85, desc: 'Nemli kil, sinyal zayıflar' },
  laterite:{ label: 'Laterit / demirli',   factor: 0.70, desc: 'Demirli toprak, sinyal absorbe' },
  organic: { label: 'Organik / humus',     factor: 0.95, desc: 'Humus, hafif sinyal kaybı' },
};

// ── Yardımcılar ──

/** Hücredeki manyetik gradyanı hesapla (komşulara göre değişim) */
function computeGradient(gx, gy, grid, gridRes) {
  const neighbors = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || nx >= gridRes || ny < 0 || ny >= gridRes) continue;

      const cell = grid.find(c => c.gx === nx && c.gy === ny);
      if (cell) neighbors.push(cell);
    }
  }

  if (neighbors.length === 0) return { magnitude: 0, dirX: 0, dirY: 0 };

  // gradyan büyüklüğü ve yönü
  let sumDx = 0, sumDy = 0, count = 0;
  const source = grid.find(c => c.gx === gx && c.gy === gy);
  const centerMag = source ? source.magnetic : 0;

  for (const n of neighbors) {
    const dx = n.gx - gx;
    const dy = n.gy - gy;
    const diff = n.magnetic - centerMag;
    sumDx += diff * dx;
    sumDy += diff * dy;
    count++;
  }

  const mag = count > 0 ? Math.hypot(sumDx, sumDy) / count : 0;
  const dirX = count > 0 ? sumDx / count : 0;
  const dirY = count > 0 ? sumDy / count : 0;

  return { magnitude: mag, dirX, dirY };
}

/** Manyetik sinyal gücünden derinlik tahmini (basit model) */
function signalToDepth(signalStrength, ntRange, soilFactor) {
  // Model: Derinlik = (ntRange / |sinyal|) * çarpan
  // Güçlü sinyal (|nT| yüksek) → küçük derinlik (sığ)
  // Zayıf sinyal (|nT| düşük) → büyük derinlik (derin)
  const absSignal = Math.abs(signalStrength);
  if (absSignal < 1) return 30; // Maksimum derinlik

  const rawDepth = (ntRange / (absSignal + 1)) * 2;
  return Math.max(0.5, Math.min(30, rawDepth * soilFactor));
}

/** Genişlik tabanlı derinlik tahmini (anomalinin yayılımı) */
function spreadToDepth(cell, grid, gridRes, ntRange, soilFactor) {
  // Anomalinin etrafındaki benzer değere sahip hücre sayısı
  const threshold = Math.abs(cell.magnetic) * 0.5;
  let spread = 0;

  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      const nx = cell.gx + dx;
      const ny = cell.gy + dy;
      if (nx < 0 || nx >= gridRes || ny < 0 || ny >= gridRes) continue;
      if (dx === 0 && dy === 0) continue;

      const neighbor = grid.find(c => c.gx === nx && c.gy === ny);
      if (neighbor && Math.abs(neighbor.magnetic) >= threshold) {
        spread++;
      }
    }
  }

  // Geniş yayılım → derin, dar yayılım → sığ
  const spreadFactor = Math.max(0.3, Math.min(3, spread / 10));
  return signalToDepth(cell.magnetic, ntRange, soilFactor) * spreadFactor;
}

// ── Ana Analiz Fonksiyonları ──

/**
 * Fusion grid'inden derinlik haritası çıkar (basit mod).
 *
 * @param {Object} options
 * @param {Array} options.fusionGrid - fuseDataSources çıktısı
 * @param {number} [options.gridRes=64] - Grid çözünürlüğü
 * @param {number} [options.ntRange=500] - nT aralığı
 * @param {string} [options.soilType='loam'] - Toprak türü
 * @param {number} [options.maxDepth=30] - Maksimum derinlik (m)
 * @param {number} [options.minDepth=0.5] - Minimum derinlik (m)
 * @returns {Object} { depthGrid, stats, depthCanvas }
 */
export function analyzeDepth(options) {
  const {
    fusionGrid = [],
    gridRes = 64,
    ntRange = 500,
    soilType = 'loam',
    maxDepth = 30,
    minDepth = 0.5,
  } = options;

  const soil = SOIL_PROFILES[soilType] || SOIL_PROFILES.loam;

  if (fusionGrid.length === 0) {
    return { depthGrid: [], stats: emptyDepthStats(), depthCanvas: null };
  }

  const depthGrid = [];
  let totalDepth = 0;
  let depthMin = Infinity, depthMax = -Infinity;
  let shallowCount = 0, midCount = 0, deepCount = 0;

  for (const cell of fusionGrid) {
    // Gradyan hesapla
    const gradient = computeGradient(cell.gx, cell.gy, fusionGrid, gridRes);

    // İki farklı derinlik tahmini
    const depthBySignal = signalToDepth(cell.magnetic, ntRange, soil.factor);
    const depthBySpread = spreadToDepth(cell, fusionGrid, gridRes, ntRange, soil.factor);

    // Ağırlıklı ortalama (sinyal %60, yayılım %40)
    const estimatedDepth = Math.max(minDepth, Math.min(maxDepth,
      depthBySignal * 0.6 + depthBySpread * 0.4
    ));

    // Güven skoru (gradient düşükse → daha güvenilir)
    const gradientConfidence = Math.max(0, 1 - gradient.magnitude / 200);
    const sourceConfidence = cell.confidence || 0.5;
    const depthConfidence = gradientConfidence * 0.4 + sourceConfidence * 0.6;

    // Derinlik bandı
    let band;
    if (estimatedDepth < 3) band = 'shallow';
    else if (estimatedDepth < 10) band = 'mid';
    else band = 'deep';

    if (band === 'shallow') shallowCount++;
    else if (band === 'mid') midCount++;
    else deepCount++;

    totalDepth += estimatedDepth;
    if (estimatedDepth < depthMin) depthMin = estimatedDepth;
    if (estimatedDepth > depthMax) depthMax = estimatedDepth;

    depthGrid.push({
      gx: cell.gx,
      gy: cell.gy,
      x: cell.x,
      y: cell.y,
      worldX: cell.worldX,
      worldY: cell.worldY,
      depth: estimatedDepth,
      depthBySignal,
      depthBySpread,
      confidence: depthConfidence,
      band,
      gradient: gradient.magnitude,
      gradientDir: { x: gradient.dirX, y: gradient.dirY },
      magnetic: cell.magnetic,
      sources: cell.sources,
    });
  }

  const stats = {
    gridRes,
    totalCells: depthGrid.length,
    avgDepth: depthGrid.length > 0 ? totalDepth / depthGrid.length : 0,
    depthMin: depthMin === Infinity ? 0 : depthMin,
    depthMax: depthMax === -Infinity ? 0 : depthMax,
    shallowCount,
    midCount,
    deepCount,
    avgConfidence: depthGrid.length > 0
      ? depthGrid.reduce((s, c) => s + c.confidence, 0) / depthGrid.length
      : 0,
    soilProfile: soil.label,
    soilFactor: soil.factor,
  };

  console.log(`[Depth] Grid: ${depthGrid.length} hücre, derinlik: ${stats.depthMin.toFixed(1)}..${stats.depthMax.toFixed(1)}m`);
  console.log(`[Depth] Ort: ${stats.avgDepth.toFixed(1)}m, Güven: ${(stats.avgConfidence * 100).toFixed(0)}%`);
  console.log(`[Depth] Sığ: ${shallowCount}, Orta: ${midCount}, Derin: ${deepCount}`);

  return { depthGrid, stats };
}

// ── Derinlik İstatistikleri ──

function emptyDepthStats() {
  return {
    gridRes: 0, totalCells: 0, avgDepth: 0,
    depthMin: 0, depthMax: 0,
    shallowCount: 0, midCount: 0, deepCount: 0,
    avgConfidence: 0, soilProfile: '', soilFactor: 1,
  };
}

// ── Derinlik Haritası Görselleştirme ──

/**
 * Derinlik grid'ini renkli canvas'a çiz.
 *
 * Renk paleti:
 *   Sığ (0-3m)   → Kırmızı/Sarı (sıcak)
 *   Orta (3-10m)  → Yeşil
 *   Derin (10+m)  → Mavi/Mor (soğuk)
 *
 * @param {Array} depthGrid - analyzeDepth çıktısı
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {Object} options
 * @param {number} [options.maxDepth=30]
 * @param {boolean} [options.showContours=true]
 * @returns {HTMLCanvasElement}
 */
export function renderDepthCanvas(depthGrid, canvasW, canvasH, options = {}) {
  const { maxDepth = 30, showContours = true } = options;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // Koyu zemin
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, canvasW, canvasH);

  if (depthGrid.length === 0) return canvas;

  const gridRes = Math.max(...depthGrid.map(g => Math.max(g.gx, g.gy))) + 1;
  const cellW = canvasW / gridRes;
  const cellH = canvasH / gridRes;

  // Renk paleti: derinlik → RGB
  const depthToColor = (depth) => {
    const t = Math.min(1, depth / maxDepth); // 0..1

    let r, g, b;
    if (t < 0.1) {
      // Çok sığ → beyaz/kırmızı
      r = 255; g = Math.round(200 - 150 * t); b = Math.round(200 - 150 * t);
    } else if (t < 0.33) {
      // Sığ → kırmızı/sarı
      const s = (t - 0.1) / 0.23;
      r = 255; g = Math.round(50 + 200 * s); b = Math.round(50);
    } else if (t < 0.66) {
      // Orta → yeşil
      const s = (t - 0.33) / 0.33;
      r = Math.round(50 + 50 * (1 - s)); g = Math.round(200 - 50 * s); b = Math.round(50 + 150 * s);
    } else {
      // Derin → mavi/mor
      const s = (t - 0.66) / 0.34;
      r = Math.round(50 + 100 * s); g = Math.round(50 + 30 * (1 - s)); b = Math.round(200 + 55 * s);
    }

    return { r, g, b };
  };

  // Hücreleri çiz
  for (const cell of depthGrid) {
    const { r, g, b } = depthToColor(cell.depth);
    const alpha = 0.4 + 0.6 * cell.confidence;

    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.fillRect(cell.gx * cellW, cell.gy * cellH, cellW + 1, cellH + 1);
  }

  // Kontur çizgileri (derinlik eşitleri)
  if (showContours) {
    const contourDepths = [1, 2, 3, 5, 8, 10, 15, 20, 25];
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.8;

    for (const targetDepth of contourDepths) {
      for (const cell of depthGrid) {
        if (Math.abs(cell.depth - targetDepth) < 0.5) {
          ctx.strokeRect(cell.gx * cellW, cell.gy * cellH, cellW, cellH);
        }
      }
    }
  }

  // Legend
  drawDepthLegend(ctx, canvasW, canvasH, maxDepth);

  return canvas;
}

/** Derinlik legend'ı çiz */
function drawDepthLegend(ctx, canvasW, canvasH, maxDepth) {
  const legendX = canvasW - 60;
  const legendY = 10;
  const legendW = 12;
  const legendH = 120;

  // Arka plan
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(legendX - 8, legendY - 5, 55, legendH + 30);

  // Renk çubuğu
  for (let i = 0; i < legendH; i++) {
    const depth = (i / legendH) * maxDepth;
    const t = depth / maxDepth;
    let r, g, b;
    if (t < 0.1) { r = 255; g = 200; b = 200; }
    else if (t < 0.33) { r = 255; g = 150; b = 50; }
    else if (t < 0.66) { r = 100; g = 150; b = 100; }
    else { r = 100; g = 50; b = 220; }

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(legendX, legendY + i, legendW, 1);
  }

  // Etiketler
  ctx.fillStyle = '#fff';
  ctx.font = '9px monospace';
  ctx.fillText('0m', legendX + legendW + 4, legendY + 8);
  ctx.fillText(`${(maxDepth / 2).toFixed(0)}m`, legendX + legendW + 4, legendY + legendH / 2 + 4);
  ctx.fillText(`${maxDepth}m`, legendX + legendW + 4, legendY + legendH - 2);
  ctx.fillText('Derinlik', legendX - 4, legendY + legendH + 14);
}

// ── Derinlik Profili (Kesit) ──

/**
 * Belirli bir çizgi boyunca derinlik profili çıkar.
 *
 * @param {Array} depthGrid
 * @param {{ x1,y1,x2,y2 }} line - Çizgi başlangıç/bitiş (normalize 0-1)
 * @param {number} [samples=50] - Örnek sayısı
 * @returns {Array<{t,depth,x,y,magnetic,confidence}>}
 */
export function extractDepthProfile(depthGrid, line, samples = 50) {
  const profile = [];

  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const px = line.x1 + (line.x2 - line.x1) * t;
    const py = line.y1 + (line.y2 - line.y1) * t;

    // En yakın hücreyi bul
    let bestDist = Infinity;
    let bestCell = null;
    for (const cell of depthGrid) {
      const d = Math.hypot(cell.x - px, cell.y - py);
      if (d < bestDist) {
        bestDist = d;
        bestCell = cell;
      }
    }

    if (bestCell) {
      // Değer interpolasyonu (inverse distance weighting)
      const nearbyCells = depthGrid
        .filter(c => Math.hypot(c.x - px, c.y - py) < 0.1)
        .sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py))
        .slice(0, 4);

      let totalWeight = 0, totalDepth = 0, totalMag = 0, totalConf = 0;
      for (const c of nearbyCells) {
        const w = 1 / (Math.hypot(c.x - px, c.y - py) + 0.001);
        totalWeight += w;
        totalDepth += c.depth * w;
        totalMag += c.magnetic * w;
        totalConf += c.confidence * w;
      }

      profile.push({
        t,
        x: px,
        y: py,
        depth: totalWeight > 0 ? totalDepth / totalWeight : 0,
        magnetic: totalWeight > 0 ? totalMag / totalWeight : 0,
        confidence: totalWeight > 0 ? totalConf / totalWeight : 0,
      });
    }
  }

  return profile;
}

/**
 * Derinlik profilini canvas'a çiz.
 *
 * @param {Array} profile - extractDepthProfile çıktısı
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {number} [maxDepth=30]
 * @returns {HTMLCanvasElement}
 */
export function renderDepthProfile(profile, canvasW, canvasH, maxDepth = 30) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // Zemin
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, canvasW, canvasH);

  if (profile.length === 0) return canvas;

  // Yüzey çizgisi
  const surfaceY = 30;
  ctx.strokeStyle = '#3edc8c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, surfaceY);
  ctx.lineTo(canvasW, surfaceY);
  ctx.stroke();

  // Yüzey etiketi
  ctx.fillStyle = '#3edc8c';
  ctx.font = '10px monospace';
  ctx.fillText('YÜZEY', 5, surfaceY - 5);

  // Derinlik eğrisi
  const scaleY = (canvasH - surfaceY - 20) / maxDepth;

  ctx.beginPath();
  ctx.strokeStyle = '#ff6a4a';
  ctx.lineWidth = 2;

  for (let i = 0; i < profile.length; i++) {
    const x = (i / (profile.length - 1)) * canvasW;
    const y = surfaceY + profile[i].depth * scaleY;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Doldurulmuş alan
  ctx.lineTo(canvasW, surfaceY);
  ctx.lineTo(0, surfaceY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 106, 74, 0.15)';
  ctx.fill();

  // Derinlik eksen etiketleri
  ctx.fillStyle = '#666';
  ctx.font = '9px monospace';
  for (let d = 0; d <= maxDepth; d += 5) {
    const y = surfaceY + d * scaleY;
    ctx.fillText(`${d}m`, 5, y + 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(30, y);
    ctx.lineTo(canvasW, y);
    ctx.stroke();
  }

  return canvas;
}

// ── İstatistik Formatlama ──

/**
 * Derinlik istatistiklerini HTML olarak formatla.
 *
 * @param {Object} stats - analyzeDepth.stats
 * @returns {string} HTML
 */
export function formatDepthStats(stats) {
  const shallowPct = stats.totalCells > 0 ? (stats.shallowCount / stats.totalCells * 100).toFixed(0) : 0;
  const midPct = stats.totalCells > 0 ? (stats.midCount / stats.totalCells * 100).toFixed(0) : 0;
  const deepPct = stats.totalCells > 0 ? (stats.deepCount / stats.totalCells * 100).toFixed(0) : 0;

  return `
    <div class="depth-stats">
      <div class="ds-row">
        <span class="ds-label">Derinlik Aralığı</span>
        <span class="ds-value">${stats.depthMin.toFixed(1)} – ${stats.depthMax.toFixed(1)} m</span>
      </div>
      <div class="ds-row">
        <span class="ds-label">Ortalama</span>
        <span class="ds-value">${stats.avgDepth.toFixed(1)} m</span>
      </div>
      <div class="ds-row">
        <span class="ds-label">Toprak</span>
        <span class="ds-value">${stats.soilProfile} (×${stats.soilFactor})</span>
      </div>
      <div class="ds-row">
        <span class="ds-label">Güven</span>
        <span class="ds-value">${(stats.avgConfidence * 100).toFixed(0)}%</span>
      </div>
      <div class="ds-band-bar">
        <div class="ds-band shallow" style="width:${shallowPct}%">Sığ ${shallowPct}%</div>
        <div class="ds-band mid" style="width:${midPct}%">Orta ${midPct}%</div>
        <div class="ds-band deep" style="width:${deepPct}%">Derin ${deepPct}%</div>
      </div>
      <div class="ds-row">
        <span class="ds-label">Hücre</span>
        <span class="ds-value">${stats.totalCells}</span>
      </div>
    </div>
  `;
}
