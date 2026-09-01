/**
 * imageProcessor.js — Proton ELIC Ekran Görüntüsü İşleyici
 *
 * PNG/JPG ekran görüntüsünü alır, sol renk şeridinden LUT oluşturur,
 * harita alanını manyetik nT değerlerine çevirir ve grid olarak döndürür.
 *
 * Proton ELIC renk paleti:
 *   Üst (sıcak) → +500 nT (beyaz/kırmızı)
 *   Orta         → 0 nT   (yeşil/sarı)
 *   Alt (soğuk)  → -500 nT (lacivert/mavi)
 */

// ── Yardımcı fonksiyonlar ──

/** RGB → HSV (0-360, 0-1, 0-1) */
export function rgbToHsv(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max;
  const s = max < 1e-6 ? 0 : d / max;
  let h = 0;
  if (d > 1e-6) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * (((bn - rn) / d) + 2);
    else h = 60 * (((rn - gn) / d) + 4);
  }
  if (h < 0) h += 360;
  return { h, s, v };
}

/** HSV mesafesi (ELIC paleti için optimize) */
export function hsvDist(a, b) {
  let dh = Math.abs(a.h - b.h);
  if (dh > 180) dh = 360 - dh;
  return (dh / 180) ** 2 + (a.s - b.s) ** 2 * 0.5 + (a.v - b.v) ** 2 * 0.35;
}

/** Yeşil zemin maskesi (ELIC arka plan) */
function isGreenish(h, s, v) {
  return s > 0.15 && v > 0.15 && h >= 70 && h <= 170;
}

/** HSV → +/-1.0 imzalı değer (LUT indeksinden) */
function lutIndexToSigned(idx, len) {
  if (len <= 1) return 0;
  return 1.0 - 2.0 * (idx / (len - 1));
}

/** En yakın LUT eşleşmesi */
function bestLutMatch(px, lut) {
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < lut.length; i++) {
    const d = hsvDist(px, lut[i]);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  return { index: bestI, dist: bestD };
}

// ── LUT Oluşturma ──

/**
 * Sol dikey renk şeridinden LUT oluştur.
 * Üst = +pozitif, alt = -negatif.
 *
 * @param {ImageData} imageData - Canvas image data
 * @param {number} stripWidth - Şerit genişliği (piksel, varsayılan 20)
 * @returns {Array<{h,s,v}>} LUT dizisi
 */
export function buildLut(imageData, stripWidth = 20) {
  const { data, width, height } = imageData;
  const strip = Math.max(1, Math.min(stripWidth, 40));
  const lut = [];

  for (let y = 0; y < height; y++) {
    let rSum = 0, gSum = 0, bSum = 0;
    for (let x = 0; x < strip; x++) {
      const i = (y * width + x) * 4;
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
    }
    const n = strip;
    lut.push(rgbToHsv(Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)));
  }

  return lut;
}

// ── Manyetik Grid Çıkarma ──

/**
 * Proton ELIC ekran görüntüsünden manyetik grid çıkar.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} source - Görüntü kaynağı
 * @param {Object} options
 * @param {number} [options.stripWidth=20] - Sol şerit genişliği (piksel)
 * @param {number} [options.gridRes=64] - Çıktı grid çözünürlüğü
 * @param {number} [options.ntRange=500] - nT aralığı (+/-500 varsayılan)
 * @param {number} [options.matchThreshold=0.35] - LUT eşik mesafesi
 * @param {number} [options.minArea=20] - Minimum anomali alanı (piksel)
 * @returns {Object} { grid, lut, stats, canvas }
 */
export function extractMagneticGrid(source, options = {}) {
  const {
    stripWidth = 20,
    gridRes = 64,
    ntRange = 500,
    matchThreshold = 0.35,
    minArea = 20,
  } = options;

  // 1) Görüntüyü canvas'a çiz
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = source.naturalWidth || source.width;
  canvas.height = source.naturalHeight || source.height;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // 2) LUT oluştur (sol şerit)
  const lut = buildLut(imageData, stripWidth);
  console.log(`[ImageProc] LUT oluşturuldu: ${lut.length} renk, şerit=${stripWidth}px`);

  // 3) Harita alanını imzalı değere çevir
  const { data, width, height } = imageData;
  const mapX0 = stripWidth + 4; // Harita şeridin sağında başlar
  const signedMap = new Float32Array(width * height);
  const maskPos = new Uint8Array(width * height);
  const maskNeg = new Uint8Array(width * height);

  let matchCount = 0, skipCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = mapX0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const hsv = rgbToHsv(r, g, b);

      // Yeşil zemin → atla
      if (isGreenish(hsv.h, hsv.s, hsv.v)) continue;

      const { index, dist } = bestLutMatch(hsv, lut);

      if (dist < matchThreshold) {
        const signed = lutIndexToSigned(index, lut.length);
        signedMap[y * width + x] = signed;

        if (signed > 0) maskPos[y * width + x] = 1;
        else if (signed < 0) maskNeg[y * width + x] = 1;

        matchCount++;
      } else {
        skipCount++;
      }
    }
  }

  console.log(`[ImageProc] Piksel eşleşme: ${matchCount} eşleşti, ${skipCount} atlandı`);

  // 4) Grid'e indirge (ortalama)
  const cellW = (width - mapX0) / gridRes;
  const cellH = height / gridRes;
  const grid = [];
  let nTMin = Infinity, nTMax = -Infinity;
  let posCount = 0, negCount = 0;

  for (let gy = 0; gy < gridRes; gy++) {
    for (let gx = 0; gx < gridRes; gx++) {
      const x0 = Math.floor(mapX0 + gx * cellW);
      const y0 = Math.floor(gy * cellH);
      const x1 = Math.floor(mapX0 + (gx + 1) * cellW);
      const y1 = Math.floor((gy + 1) * cellH);

      let sum = 0, count = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const v = signedMap[y * width + x];
          if (v !== 0) {
            sum += v;
            count++;
          }
        }
      }

      if (count > 0) {
        const avgSigned = sum / count;
        const nT = avgSigned * ntRange; // -1..+1 → -ntRange..+ntRange
        grid.push({
          gx, gy,
          x: (gx + 0.5) / gridRes, // Normalize 0-1
          y: (gy + 0.5) / gridRes,
          signed: avgSigned,
          nT,
          source: 'image',
          pixelCount: count,
        });

        if (nT < nTMin) nTMin = nT;
        if (nT > nTMax) nTMax = nT;
        if (nT > 0) posCount++;
        else if (nT < 0) negCount++;
      }
    }
  }

  // 5) İstatistikler
  const stats = {
    gridRes,
    totalCells: gridRes * gridRes,
    filledCells: grid.length,
    nTMin: nTMin === Infinity ? 0 : nTMin,
    nTMax: nTMax === -Infinity ? 0 : nTMax,
    posCount,
    negCount,
    matchRate: matchCount / (matchCount + skipCount + 1),
    lutColors: lut.length,
  };

  console.log(`[ImageProc] Grid: ${gridRes}×${gridRes}, ${grid.length} hücre, nT: ${stats.nTMin.toFixed(0)}..${stats.nTMax.toFixed(0)}`);

  return { grid, lut, stats, canvas };
}

// ── Görüntü Yükleme ──

/**
 * Dosyadan görüntü yükle.
 *
 * @param {File} file - PNG/JPG dosyası
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.match(/^image\/(png|jpe?g|gif|webp)$/)) {
      reject(new Error(`Desteklenmeyen dosya tipi: ${file.type}. Sadece PNG/JPG.`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        console.log(`[ImageProc] Görüntü yüklendi: ${img.width}×${img.height}, ${file.name}`);
        resolve(img);
      };
      img.onerror = () => reject(new Error('Görüntü yüklenemedi'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Dosya okunamadı'));
    reader.readAsDataURL(file);
  });
}

// ── LUT Önizleme Çizimi ──

/**
 * LUT'u canvas üzerine dikey şerit olarak çiz (kalibrasyon kontrolü için).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} lut
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
export function drawLutPreview(ctx, lut, x, y, w, h) {
  const step = Math.max(1, Math.floor(lut.length / h));
  for (let py = 0; py < h; py++) {
    const idx = Math.min(Math.floor(py * lut.length / h), lut.length - 1);
    const { h: hue, s, v } = lut[idx];
    // HSV → RGB (basit dönüşüm)
    const c = v * s;
    const xc = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = v - c;
    let r, g, b;
    if (hue < 60) { r = c; g = xc; b = 0; }
    else if (hue < 120) { r = xc; g = c; b = 0; }
    else if (hue < 180) { r = 0; g = c; b = xc; }
    else if (hue < 240) { r = 0; g = xc; b = c; }
    else if (hue < 300) { r = xc; g = 0; b = c; }
    else { r = c; g = 0; b = xc; }

    ctx.fillStyle = `rgb(${Math.round((r + m) * 255)},${Math.round((g + m) * 255)},${Math.round((b + m) * 255)})`;
    ctx.fillRect(x, y + py, w, 1);
  }

  // Etiketler
  ctx.fillStyle = '#fff';
  ctx.font = '10px monospace';
  ctx.fillText('+nT', x + w + 4, y + 12);
  ctx.fillText('0', x + w + 4, y + h / 2 + 4);
  ctx.fillText('-nT', x + w + 4, y + h - 4);
}

// ── nT Renk Haritası (Grid → Canvas) ──

/**
 * Manyetik grid'i renkli canvas olarak çiz.
 * Kırmızı = pozitif, Mavi = negatif, Yeşil = nötr.
 *
 * @param {Array} grid - extractMagneticGrid çıktısı
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} [ntRange=500]
 * @returns {HTMLCanvasElement}
 */
export function renderGridToCanvas(grid, canvasWidth, canvasHeight, ntRange = 500) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');

  // Siyah zemin
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const gridRes = Math.max(...grid.map(g => Math.max(g.gx, g.gy))) + 1;
  const cellW = canvasWidth / gridRes;
  const cellH = canvasHeight / gridRes;

  for (const cell of grid) {
    const normalized = cell.nT / ntRange; // -1..+1
    let r, g, b;

    if (normalized > 0) {
      // Pozitif → kırmızı/beyaz
      r = Math.round(128 + 127 * normalized);
      g = Math.round(50 * normalized);
      b = Math.round(50 * normalized);
    } else {
      // Negatif → mavi/lacivert
      const abs = Math.abs(normalized);
      r = Math.round(30 * abs);
      g = Math.round(50 * abs);
      b = Math.round(128 + 127 * abs);
    }

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(cell.gx * cellW, cell.gy * cellH, cellW + 1, cellH + 1);
  }

  return canvas;
}
