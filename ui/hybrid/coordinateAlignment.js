/**
 * coordinateAlignment.js — Koordinat Hizalama Modülü
 *
 * Proton ELIC ekran görüntüsü (piksel koordinatları) ile
 * CSV sensör verisi (X,Y,Z metre/piksel) arasında koordinat dönüşümü yapar.
 *
 * İki hizalama modu:
 *   1. Otomatik: Sınır kutularından (bounds) otomatik eşleme
 *   2. Manuel: 3 referans noktası ile projektif dönüşüm
 */

// ── Yardımcılar ──

/** Noktadan dikdörtgene uzaklık */
function pointToRectDist(px, py, rx, ry, rw, rh) {
  const dx = Math.max(rx - px, 0, px - (rx + rw));
  const dy = Math.max(ry - py, 0, py - (ry + rh));
  return Math.hypot(dx, dy);
}

/** Doğrusal regresyon: y = a*x + b */
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { a: 0, b: 0, r2: 0 };
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (const { x, y } of points) {
    sx += x; sy += y; sxy += x * y; sx2 += x * x; sy2 += y * y;
  }
  const denom = n * sx2 - sx * sx;
  if (Math.abs(denom) < 1e-10) return { a: 0, b: sy / n, r2: 0 };
  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;
  const ssRes = points.reduce((s, { x, y }) => s + (y - (a * x + b)) ** 2, 0);
  const ssTot = sy2 - sy * sy / n;
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { a, b, r2 };
}

// ── Ana Sınıf ──

/**
 * Koordinat hizalama motoru.
 *
 * İki veri kümesi arasındaki dönüşümü hesaplar:
 *   - Image grid: { x: 0..1, y: 0..1 } (normalize piksel)
 *   - CSV verisi: { x: metre, y: metre } (havuz-relative)
 */
export class CoordinateAligner {
  constructor() {
    /** @type {{ xMin,xMax,yMin,yMax }} Image sınırları (normalize) */
    this.imageBounds = null;
    /** @type {{ xMin,xMax,yMin,yMax }} CSV sınırları (metre) */
    this.csvBounds = null;
    /** @type {{ scaleX,scaleY,offsetX,offsetY }|null} Otomatik dönüşüm */
    this.transform = null;
    /** @type {Array<{imageX,imageY,csvX,csvY}>} Manuel referans noktaları */
    this.controlPoints = [];
    /** @type {'auto'|'manual'|null} Aktif mod */
    this.mode = null;
    /** @type {number} Hata (RMSE) */
    this.rmse = 0;
  }

  // ── 1. Otomatik Hizalama ──

  /**
   * Sınır kutularından otomatik hizalama.
   *
   * Image grid koordinatları (0-1 arası normalize) ile
   * CSV metre koordinatları arasında doğrusal dönüşüm kurar.
   *
   * @param {{ xMin,xMax,yMin,yMax }} imgBounds - Image grid sınırları
   * @param {{ xMin,xMax,yMin,yMax }} csvBounds - CSV metre sınırları
   * @returns {{ scaleX,scaleY,offsetX,offsetY,r2X,r2Y }}
   */
  autoAlign(imgBounds, csvBounds) {
    this.imageBounds = imgBounds;
    this.csvBounds = csvBounds;
    this.mode = 'auto';

    const imgW = imgBounds.xMax - imgBounds.xMin || 1;
    const imgH = imgBounds.yMax - imgBounds.yMin || 1;
    const csvW = csvBounds.xMax - csvBounds.xMin || 1;
    const csvH = csvBounds.yMax - csvBounds.yMin || 1;

    // Ölçek: 1 image birimi = ? metre
    const scaleX = csvW / imgW;
    const scaleY = csvH / imgH;

    // Ofset: image sol-üstü → CSV sol-üstü
    const offsetX = csvBounds.xMin - imgBounds.xMin * scaleX;
    const offsetY = csvBounds.yMin - imgBounds.yMin * scaleY;

    this.transform = { scaleX, scaleY, offsetX, offsetY };
    this.rmse = 0; // Otomatik modda hata tahmini yok

    console.log(`[CoordAlign] Otomatik: scaleX=${scaleX.toFixed(4)}, scaleY=${scaleY.toFixed(4)}`);
    console.log(`[CoordAlign] offsetX=${offsetX.toFixed(2)}, offsetY=${offsetY.toFixed(2)}`);

    return { ...this.transform, r2X: 1, r2Y: 1 };
  }

  // ── 2. Manuel Hizalama (3 Nokta) ──

  /**
   * Manuel referans noktaları ekle.
   * En az 2, en iyi 3-4 nokta ile projektif hizalama.
   *
   * @param {number} imageX - Image koordinatı X (piksel veya normalize)
   * @param {number} imageY - Image koordinatı Y
   * @param {number} csvX - CSV koordinatı X (metre)
   * @param {number} csvY - CSV koordinatı Y (metre)
   */
  addControlPoint(imageX, imageY, csvX, csvY) {
    // Mükerrer nokta kontrolü
    const existing = this.controlPoints.find(
      p => Math.abs(p.imageX - imageX) < 0.001 && Math.abs(p.imageY - imageY) < 0.001
    );
    if (existing) {
      existing.csvX = csvX;
      existing.csvY = csvY;
      console.log(`[CoordAlign] Referans güncellendi: (${imageX.toFixed(2)}, ${imageY.toFixed(2)}) → (${csvX.toFixed(1)}, ${csvY.toFixed(1)})`);
    } else {
      this.controlPoints.push({ imageX, imageY, csvX, csvY });
      console.log(`[CoordAlign] Referans eklendi: (${imageX.toFixed(2)}, ${imageY.toFixed(2)}) → (${csvX.toFixed(1)}, ${csvY.toFixed(1)})`);
    }

    // En az 2 nokta varsa hesapla
    if (this.controlPoints.length >= 2) {
      return this.computeManualTransform();
    }
    return null;
  }

  /**
   * Manuel referans noktalarını kaldır.
   */
  clearControlPoints() {
    this.controlPoints = [];
    this.transform = null;
    this.mode = null;
    this.rmse = 0;
  }

  /**
   * Referans noktalarından doğrusal dönüşüm hesapla.
   * xCSV = scaleX * xImg + offsetX
   * yCSV = scaleY * yImg + offsetY
   *
   * @returns {{ scaleX,scaleY,offsetX,offsetY,rmse,r2X,r2Y }}
   */
  computeManualTransform() {
    if (this.controlPoints.length < 2) return null;

    this.mode = 'manual';

    // X ekseni regresyonu
    const xPairs = this.controlPoints.map(p => ({ x: p.imageX, y: p.csvX }));
    const xReg = linearRegression(xPairs);

    // Y ekseni regresyonu
    const yPairs = this.controlPoints.map(p => ({ x: p.imageY, y: p.csvY }));
    const yReg = linearRegression(yPairs);

    this.transform = {
      scaleX: xReg.a,
      scaleY: yReg.a,
      offsetX: xReg.b,
      offsetY: yReg.b,
    };

    // RMSE hesapla
    let sumSqErr = 0;
    for (const p of this.controlPoints) {
      const predX = xReg.a * p.imageX + xReg.b;
      const predY = yReg.a * p.imageY + yReg.b;
      sumSqErr += (predX - p.csvX) ** 2 + (predY - p.csvY) ** 2;
    }
    this.rmse = Math.sqrt(sumSqErr / this.controlPoints.length);

    console.log(`[CoordAlign] Manuel: scaleX=${xReg.a.toFixed(4)}, scaleY=${yReg.a.toFixed(4)}`);
    console.log(`[CoordAlign] RMSE=${this.rmse.toFixed(3)}m, R²x=${xReg.r2.toFixed(4)}, R²y=${yReg.r2.toFixed(4)}`);

    return { ...this.transform, rmse: this.rmse, r2X: xReg.r2, r2Y: yReg.r2 };
  }

  // ── 3. Dönüşüm Fonksiyonları ──

  /**
   * Image koordinatını CSV (metre) koordinatına çevir.
   *
   * @param {number} imgX - Image X (0-1 normalize veya piksel)
   * @param {number} imgY - Image Y
   * @returns {{ x: number, y: number }} Metre koordinatı
   */
  imageToCsv(imgX, imgY) {
    if (!this.transform) {
      console.warn('[CoordAlign] Dönüşüm henüz hesaplanmadı');
      return { x: imgX, y: imgY };
    }
    return {
      x: this.transform.scaleX * imgX + this.transform.offsetX,
      y: this.transform.scaleY * imgY + this.transform.offsetY,
    };
  }

  /**
   * CSV (metre) koordinatını image koordinatına çevir.
   *
   * @param {number} csvX - Metre X
   * @param {number} csvY - Metre Y
   * @returns {{ x: number, y: number }} Image koordinatı
   */
  csvToImage(csvX, csvY) {
    if (!this.transform) {
      console.warn('[CoordAlign] Dönüşüm henüz hesaplanmadı');
      return { x: csvX, y: csvY };
    }
    const { scaleX, scaleY, offsetX, offsetY } = this.transform;
    return {
      x: (csvX - offsetX) / (scaleX || 1),
      y: (csvY - offsetY) / (scaleY || 1),
    };
  }

  // ── 4. Toplu Dönüşüm ──

  /**
   * Tüm image grid noktalarını CSV koordinatına çevir.
   *
   * @param {Array<{x,y,...}>} imageGrid - Image grid noktaları
   * @returns {Array<{csvX,csvY,...}>} CSV koordinatlı noktalar
   */
  transformImageGrid(imageGrid) {
    return imageGrid.map(p => {
      const csv = this.imageToCsv(p.x, p.y);
      return { ...p, csvX: csv.x, csvY: csv.y };
    });
  }

  /**
   * Tüm CSV noktalarını image koordinatına çevir.
   *
   * @param {Array<{x,y,...}>} csvPoints - CSV noktaları
   * @returns {Array<{imgX,imgY,...}>} Image koordinatlı noktalar
   */
  transformCsvPoints(csvPoints) {
    return csvPoints.map(p => {
      const img = this.csvToImage(p.x, p.y);
      return { ...p, imgX: img.x, imgY: img.y };
    });
  }

  // ── 5. Kalite Metrikleri ──

  /**
   * Hizalama kalitesini değerlendir.
   *
   * @returns {{ quality: 'iyi'|'orta'|'kötü', score: number, details: string }}
   */
  qualityCheck() {
    if (!this.transform) {
      return { quality: 'kötü', score: 0, details: 'Dönüşüm hesaplanmadı' };
    }

    let score = 0;
    const details = [];

    // 1. Referans nokta sayısı
    const cpCount = this.controlPoints.length;
    if (this.mode === 'auto') {
      score += 60; // Otomatik mod varsayılan güvenilir
      details.push('Otomatik mod (sınır bazlı)');
    } else if (cpCount >= 4) {
      score += 40;
      details.push(`${cpCount} referans noktası (yeterli)`);
    } else if (cpCount >= 2) {
      score += 20;
      details.push(`${cpCount} referans noktası (minimum)`);
    } else {
      details.push(`${cpCount} referans noktası (yetersiz)`);
    }

    // 2. RMSE (manuel modda)
    if (this.mode === 'manual' && this.rmse > 0) {
      if (this.rmse < 0.5) { score += 40; details.push(`RMSE=${this.rmse.toFixed(2)}m (mükemmel)`); }
      else if (this.rmse < 2) { score += 25; details.push(`RMSE=${this.rmse.toFixed(2)}m (iyi)`); }
      else if (this.rmse < 5) { score += 10; details.push(`RMSE=${this.rmse.toFixed(2)}m (orta)`); }
      else { details.push(`RMSE=${this.rmse.toFixed(2)}m (kötü)`); }
    } else if (this.mode === 'auto') {
      score += 40; // Otomatik modda RMSE yok
    }

    // 3. Ölçek tutarlılığı
    if (this.transform) {
      const ratio = this.transform.scaleX / (this.transform.scaleY || 1);
      if (ratio > 0.8 && ratio < 1.2) {
        score += 20;
        details.push(`Ölçek oranı=${ratio.toFixed(2)} (tutarlı)`);
      } else {
        details.push(`Ölçek oranı=${ratio.toFixed(2)} (tutarlı değil)`);
      }
    }

    // 100'yi aşmaması için sınırla
    score = Math.min(score, 100);

    const quality = score >= 70 ? 'iyi' : score >= 40 ? 'orta' : 'kötü';

    console.log(`[CoordAlign] Kalite: ${quality} (${score}/100) — ${details.join(', ')}`);

    return { quality, score, details: details.join(' · ') };
  }

  // ── 6. JSON Serileştirme ──

  toJSON() {
    return {
      mode: this.mode,
      transform: this.transform,
      imageBounds: this.imageBounds,
      csvBounds: this.csvBounds,
      controlPoints: this.controlPoints,
      rmse: this.rmse,
    };
  }

  static fromJSON(data) {
    const aligner = new CoordinateAligner();
    aligner.mode = data.mode;
    aligner.transform = data.transform;
    aligner.imageBounds = data.imageBounds;
    aligner.csvBounds = data.csvBounds;
    aligner.controlPoints = data.controlPoints || [];
    aligner.rmse = data.rmse || 0;
    return aligner;
  }
}

// ── Kolaylık Fonksiyonları ──

/**
 * Image grid ve CSV verisinden otomatik hizalama oluştur.
 *
 * @param {Array} imageGrid - extractMagneticGrid çıktısı
 * @param {Array} csvPoints - CSV noktaları [{x,y,magnetic}]
 * @returns {CoordinateAligner}
 */
export function autoAlignFromData(imageGrid, csvPoints) {
  const aligner = new CoordinateAligner();

  // Image sınırları
  const imgBounds = {
    xMin: Math.min(...imageGrid.map(p => p.x)),
    xMax: Math.max(...imageGrid.map(p => p.x)),
    yMin: Math.min(...imageGrid.map(p => p.y)),
    yMax: Math.max(...imageGrid.map(p => p.y)),
  };

  // CSV sınırları
  const csvBounds = {
    xMin: Math.min(...csvPoints.map(p => p.x)),
    xMax: Math.max(...csvPoints.map(p => p.x)),
    yMin: Math.min(...csvPoints.map(p => p.y)),
    yMax: Math.max(...csvPoints.map(p => p.y)),
  };

  aligner.autoAlign(imgBounds, csvBounds);
  return aligner;
}

/**
 * Image canvas üzerinde referans noktalarını göster.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{imageX,imageY,csvX,csvY}>} points
 * @param {number} canvasW
 * @param {number} canvasH
 */
export function drawControlPoints(ctx, points, canvasW, canvasH) {
  ctx.save();

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const px = p.imageX * canvasW;
    const py = p.imageY * canvasH;

    // Nokta
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(62, 220, 140, 0.8)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Etiket
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`P${i + 1}`, px + 10, py - 4);
    ctx.font = '9px monospace';
    ctx.fillStyle = '#3edc8c';
    ctx.fillText(`→ ${p.csvX.toFixed(1)}, ${p.csvY.toFixed(1)}m`, px + 10, py + 8);
  }

  // Çizgiler (noktalar arası)
  if (points.length >= 2) {
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(62, 220, 140, 0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const px = p.imageX * canvasW;
      const py = p.imageY * canvasH;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  ctx.restore();
}
