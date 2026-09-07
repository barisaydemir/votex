/**
 * visualMetalDetector.js — Görselden Metal İmzası Tespiti
 *
 * Proton ELIC haritasındaki kırmızı/turuncu (pozitif manyetik) bölgeleri
 * doğrudan piksel analiziyle bulur. Backend analiz beklemeden anlık çalışır.
 *
 * Çıktı formatı metalAlarm ile uyumlu (cx/cy normalize 0-1).
 *
 * Tamamen bağımsız — silindiğinde hiçbir şey bozulmaz.
 *
 * Kullanım:
 *   import { detectVisualMetals, quickScan } from "./visualMetalDetector.js";
 *   const metals = detectVisualMetals(imageBase64);
 */

/* ── Eşikler ──────────────────────────────────────────── */

/** Metal imza HSV eşikleri — Proton ELIC pozitif bandı */
const THRESHOLDS = {
  redMinSat: 0.45,   // kırmızı doygunluk alt limiti
  redMinVal: 0.30,   // kırmızı parlaklık alt limiti
  minArea: 40,       // minimum blob alanı (alt-örneklenmiş piksel)
  maxBlobs: 24,      // en fazla rapor edilecek metal sayısı
  strongSat: 0.70,   // "güçlü metal" doygunluk eşiği
  strongVal: 0.50,   // "güçlü metal" parlaklık eşiği
};

/* ── HSV yardımcıları ──────────────────────────────────── */

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

/** Kırmızı/turuncu pozitif manyetik bandı mı? (hue 0-30° ve 330-360°) */
export function isMetalSignature(h, s, v) {
  const hueOk = h >= 330 || h <= 30;
  return hueOk && s > THRESHOLDS.redMinSat && v > THRESHOLDS.redMinVal;
}

/** Güçlü metal — yüksek doygunluk + parlaklık */
export function isStrongMetal(h, s, v) {
  return isMetalSignature(h, s, v) && s > THRESHOLDS.strongSat && v > THRESHOLDS.strongVal;
}

/* ── Blob Tespiti (Connected Components) ───────────────── */

/**
 * Maske üzerinde connected-component etiketleme (4-yönlü BFS).
 * @returns {Array<{cx, cy, width, height, area, avgSat, avgVal, intensity, strong}>}
 */
export function findMetalBlobs(mask, width, height, minArea = THRESHOLDS.minArea) {
  const visited = new Uint8Array(width * height);
  const blobs = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || !mask.signature[idx]) continue;

      // BFS genişletme
      const queue = [x, y];
      visited[idx] = 1;
      let count = 0, sumS = 0, sumV = 0, strongCount = 0;
      let minX = x, maxX = x, minY = y, maxY = y;

      while (queue.length > 0) {
        const cy = queue.pop();
        const cx = queue.pop();
        const cIdx = cy * width + cx;
        count++;
        sumS += mask.sat[cIdx];
        sumV += mask.val[cIdx];
        if (mask.strong[cIdx]) strongCount++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        // 4-yönlü komşular
        if (cx + 1 < width && mask.signature[cy * width + cx + 1] && !visited[cy * width + cx + 1]) {
          visited[cy * width + cx + 1] = 1;
          queue.push(cx + 1, cy);
        }
        if (cx - 1 >= 0 && mask.signature[cy * width + cx - 1] && !visited[cy * width + cx - 1]) {
          visited[cy * width + cx - 1] = 1;
          queue.push(cx - 1, cy);
        }
        if (cy + 1 < height && mask.signature[(cy + 1) * width + cx] && !visited[(cy + 1) * width + cx]) {
          visited[(cy + 1) * width + cx] = 1;
          queue.push(cx, cy + 1);
        }
        if (cy - 1 >= 0 && mask.signature[(cy - 1) * width + cx] && !visited[(cy - 1) * width + cx]) {
          visited[(cy - 1) * width + cx] = 1;
          queue.push(cx, cy - 1);
        }
      }

      if (count >= minArea) {
        const avgS = sumS / count;
        const avgV = sumV / count;
        blobs.push({
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          area: count,
          avgSat: avgS,
          avgVal: avgV,
          // Yoğunluk: doygunluk × parlaklık → 0-1 güç
          intensity: Math.min(1, avgS * avgV * 1.6),
          // Blob'un en az yarısı güçlü pikselse "güçlü metal"
          strong: strongCount >= count / 2,
          // Derinlik tahmini: doygun metal yüzeye yakın
          estimatedDepthM: Math.max(0.3, 2.5 - avgS * 2.0),
        });
      }
    }
  }
  return blobs;
}

/* ── Maske Oluşturma ───────────────────────────────────── */

/**
 * ImageData → metal imza maskesi.
 * Test edilebilir saf fonksiyon.
 *
 * @param {Uint8ClampedArray} data - RGBA pikseller
 * @param {number} width
 * @param {number} height
 * @returns {{signature: Uint8Array, sat: Float32Array, val: Float32Array, strong: Uint8Array}}
 */
export function buildMetalMask(data, width, height) {
  const n = width * height;
  const signature = new Uint8Array(n);
  const strong = new Uint8Array(n);
  const sat = new Float32Array(n);
  const val = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const hsv = rgbToHsv(r, g, b);
    sat[i] = hsv.s;
    val[i] = hsv.v;
    if (isMetalSignature(hsv.h, hsv.s, hsv.v)) {
      signature[i] = 1;
      if (isStrongMetal(hsv.h, hsv.s, hsv.v)) strong[i] = 1;
    }
  }
  return { signature, sat, val, strong };
}

/* ── Hızlı Tarama ─────────────────────────────────────── */

/**
 * Hızlı önizleme — metal var mı, yaklaşık kaç tane, ortalama güç.
 * Büyük görsellerde tam taramadan önce kontrol için.
 *
 * @param {Object} maskInfo - buildMetalMask çıktısı
 * @returns {{ hasMetal: boolean, metalPixelCount: number, avgIntensity: number, estimatedCount: number }}
 */
export function quickScan(maskInfo) {
  const { signature, sat, val } = maskInfo;
  let metalPixels = 0, totalIntensity = 0;
  for (let i = 0; i < signature.length; i++) {
    if (signature[i]) {
      metalPixels++;
      totalIntensity += sat[i] * val[i];
    }
  }
  return {
    hasMetal: metalPixels > 12,
    metalPixelCount: metalPixels,
    avgIntensity: metalPixels > 0 ? totalIntensity / metalPixels : 0,
    estimatedCount: Math.min(THRESHOLDS.maxBlobs, Math.ceil(metalPixels / 150)),
  };
}

/* ── Ana Tespit Fonksiyonu ─────────────────────────────── */

/**
 * Proton ELIC görselinden metal imzalarını tespit et.
 *
 * @param {string} base64 - data URL veya ham base64
 * @param {Object} [options]
 * @param {number} [options.minArea=40] - minimum blob alanı (piksel)
 * @param {number} [options.maxBlobs=24] - maksimum rapor sayısı
 * @returns {Promise<Array>} normalize koordinatlı metal listesi
 */
export function detectVisualMetals(base64, options = {}) {
  const { minArea = THRESHOLDS.minArea, maxBlobs = THRESHOLDS.maxBlobs } = options;

  return new Promise((resolve) => {
    if (!base64) return resolve([]);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        // 640px alt-örnekleme — blob tespiti için bol bol yeterli
        const maxSide = 640;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(8, Math.round(img.naturalWidth * scale));
        const h = Math.max(8, Math.round(img.naturalHeight * scale));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);

        const mask = buildMetalMask(imageData.data, w, h);
        const blobs = findMetalBlobs(mask, w, h, minArea);

        // Yoğunluğa göre sırala, sınırla
        const sorted = blobs
          .sort((a, b) => b.intensity - a.intensity)
          .slice(0, maxBlobs);

        // Normalize 0-1 + metalAlarm uyumlu alanlar
        resolve(
          sorted.map((b, i) => ({
            cx: b.cx / w,
            cy: b.cy / h,
            intensity: b.intensity,
            strong: b.strong,
            estimatedDepthM: b.estimatedDepthM,
            pixelArea: b.area,
            widthPx: b.width,
            heightPx: b.height,
            id: `visual-${i}`,
            source: "visual",
          }))
        );
      } catch (e) {
        console.warn("[VisualMetal] Tespit hatası:", e);
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
  });
}
