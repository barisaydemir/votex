/**
 * Dilim bazlı yapı analizi — saf hesap modülü (THREE bağımlılığı yok).
 *
 * Her derinlik dilimi için:
 *   1) Yeraltı filtresi + Y bandı bölme (sliceDepths)
 *   2) 2D manyetik/derinlik grid üretimi (IDW + yumuşatma)
 *   3) Connected-component yapı tespiti (oda / tünel / metal)
 */
import { computeBounds, sliceDepths, filterUnderground } from "./csvFilter.js";

/**
 * Manyetik + derinlik 2D grid üretir (XZ düzlemi).
 * Boş hücreler IDW ile doldurulur, opsiyonel Gaussian yumuşatma.
 *
 * @param {Array<{x,y,z,magnetic}>} points - zaten yer altı filtrelenmiş noktalar
 * @param {number} res - grid çözünürlüğü
 * @param {Object} bounds - { xMin, xMax, zMin, zMax }
 * @param {boolean} smooth - Gaussian yumuşatma uygula
 * @returns {{mGrid: Float32Array, yGrid: Float32Array, counts: Uint32Array, gridRes: number}}
 */
export function build2DGrid(points, res, boundsOpts = {}, smooth = false) {
  const resN = Math.max(8, Math.floor(res) || 64);
  const { xMin = -1, xMax = 1, zMin = -1, zMax = 1 } = boundsOpts;
  const xRange = Math.max(xMax - xMin, 1e-9);
  const zRange = Math.max(zMax - zMin, 1e-9);

  const mGrid = new Float32Array(resN * resN);
  const yGrid = new Float32Array(resN * resN);
  const counts = new Uint32Array(resN * resN);

  for (const p of points) {
    const gx = Math.floor(((p.x - xMin) / xRange) * resN);
    const gz = Math.floor(((p.z - zMin) / zRange) * resN);
    if (gx < 0 || gx >= resN || gz < 0 || gz >= resN) continue;
    const idx = gz * resN + gx;
    mGrid[idx] += p.magnetic;
    if (Number.isFinite(p.y)) yGrid[idx] += p.y;
    counts[idx]++;
  }
  for (let i = 0; i < resN * resN; i++) {
    if (counts[i] > 0) {
      mGrid[i] /= counts[i];
      if (yGrid[i] !== 0) yGrid[i] /= counts[i];
    }
  }

  // IDW ile boş hücreleri doldur
  const occCells = [];
  for (let i = 0; i < resN * resN; i++) {
    if (counts[i] > 0) {
      occCells.push({ gx: i % resN, gz: Math.floor(i / resN), m: mGrid[i], y: yGrid[i] });
    }
  }
  for (let gz = 0; gz < resN; gz++) {
    for (let gx = 0; gx < resN; gx++) {
      const idx = gz * resN + gx;
      if (counts[idx] > 0) continue;
      let wSum = 0, mSum = 0, ySum = 0;
      for (const c of occCells) {
        const dx = gx - c.gx, dz = gz - c.gz;
        const w = 1 / (dx * dx + dz * dz + 2);
        wSum += w; mSum += w * c.m; ySum += w * c.y;
      }
      if (wSum > 0) {
        mGrid[idx] = mSum / wSum;
        yGrid[idx] = ySum / wSum;
      }
      counts[idx] = 1;
    }
  }

  // Gaussian yumuşatma (sadece manyetik)
  if (smooth) {
    const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    const kSum = 16;
    const out = new Float32Array(resN * resN);
    for (let gz = 1; gz < resN - 1; gz++) {
      for (let gx = 1; gx < resN - 1; gx++) {
        let acc = 0, ki = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            acc += mGrid[(gz + dz) * resN + (gx + dx)] * kernel[ki];
            ki++;
          }
        }
        out[gz * resN + gx] = acc / kSum;
      }
    }
    for (let i = 0; i < resN * resN; i++) {
      if (out[i] !== 0) mGrid[i] = out[i];
    }
  }

  return { mGrid, yGrid, counts, gridRes: resN };
}

/**
 * Grid'den yapı tespiti — anomali bölgelerini connected-component ile bulur.
 * (csvOverlay.js'den taşındı — saf hesap, THREE yok.)
 *
 * @param {Float32Array} yGrid - derinlik gridi
 * @param {Float32Array} mGrid - manyetik gridi
 * @param {Uint32Array} counts - nokta sayıları
 * @param {number} gridRes - grid çözünürlüğü
 * @param {number} poolSizeM - havuz boyutu
 * @param {Object} mStats - manyetik istatistikler ({mean, stddev})
 * @param {Object} thresholds - { threshold, minStrength } (opsiyonel)
 * @returns {{chambers: Array, tunnels: Array, metals: Array}}
 */
export function detectStructuresFromTerrain(yGrid, mGrid, counts, gridRes, poolSizeM, mStats, thresholds = {}) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  // threshold: anomali haritası eşiği (büyürse daha az bölge bulunur)
  const THRESHOLD = clamp(thresholds.threshold ?? 0.9, 0.3, 2.0);
  // minStrength: bir bölgenin yapı sayılması için gereken min |z-skor|
  const MIN_STRENGTH = clamp(thresholds.minStrength ?? 0.45, 0.05, 1.0);
  const halfPool = poolSizeM / 2;
  const cellSize = poolSizeM / gridRes;

  // Bounds: build2DGrid'in kullandığı nokta sınırları
  // Yoksa grid→koordinat dönüşümü havuz-relative olur
  const b = thresholds.bounds || null;
  const xMin = b?.xMin ?? -halfPool, xMax = b?.xMax ?? halfPool;
  const zMin = b?.zMin ?? -halfPool, zMax = b?.zMax ?? halfPool;
  const xRange = (xMax - xMin) || 1;
  const zRange = (zMax - zMin) || 1;

  // 1) Manyetik istatistikler — medyan merkezli persentiller (outlier'a dayanıklı)
  //    (p10+p90)/2 yerine medyan kullan: verideki güçlü tepe/çukur dağılımı
  //    kaydırırsa taban hücreleri yanlışlıkla 'anomali' sayılmasın.
  const filledM = [];
  for (let i = 0; i < gridRes * gridRes; i++) {
    if (counts[i] > 0) filledM.push(mGrid[i]);
  }
  if (filledM.length === 0) return { chambers: [], tunnels: [], metals: [] };
  filledM.sort((a, b) => a - b);
  const p10 = filledM[Math.floor(filledM.length * 0.1)];
  const p50 = filledM[Math.floor(filledM.length * 0.5)];
  const p90 = filledM[Math.floor(filledM.length * 0.9)];
  const mMid = p50; // medyan — arka plan seviyesi
  const mSpread = Math.max(p90 - p50, p50 - p10, 1);

  // 2) Derinlik istatistikleri
  const filledY = [];
  for (let i = 0; i < gridRes * gridRes; i++) {
    if (counts[i] > 0) filledY.push(yGrid[i]);
  }
  filledY.sort((a, b) => a - b);
  const yP10 = filledY[Math.floor(filledY.length * 0.1)] || 0;
  const yP90 = filledY[Math.floor(filledY.length * 0.9)] || 1;
  const yMid = (yP90 + yP10) / 2;

  // 3) Anomali haritası (manyetik + derinlik sapması)
  const anomalyMap = new Float32Array(gridRes * gridRes);
  for (let gz = 0; gz < gridRes; gz++) {
    for (let gx = 0; gx < gridRes; gx++) {
      const idx = gz * gridRes + gx;
      if (counts[idx] === 0) continue;
      const mAnomaly = (mGrid[idx] - mMid) / mSpread;
      const yAnomaly = (yGrid[idx] - yMid) / ((yP90 - yP10) / 2 || 1);
      anomalyMap[idx] = Math.abs(mAnomaly) + Math.abs(yAnomaly) * 0.5;
    }
  }

  // 4) Connected component labeling — anomali bölgeleri
  // (düşük = zayıf anomaliyi de yakala, yüksek = sadece güçlü)
  const labelThreshold = THRESHOLD;
  const labels = new Int32Array(gridRes * gridRes);
  let nextLabel = 1;
  const labelAreas = new Map();

  for (let gz = 0; gz < gridRes; gz++) {
    for (let gx = 0; gx < gridRes; gx++) {
      const idx = gz * gridRes + gx;
      if (anomalyMap[idx] < labelThreshold || labels[idx] > 0) continue;

      const queue = [idx];
      labels[idx] = nextLabel;
      const cells = [];
      let ySum = 0, mSum = 0;

      while (queue.length > 0) {
        const ci = queue.shift();
        const cgx = ci % gridRes;
        const cgz = Math.floor(ci / gridRes);
        cells.push({ gx: cgx, gz: cgz });
        ySum += yGrid[ci];
        mSum += mGrid[ci];

        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cgx + dx, nz = cgz + dz;
          if (nx < 0 || nz < 0 || nx >= gridRes || nz >= gridRes) continue;
          const ni = nz * gridRes + nx;
          if (anomalyMap[ni] >= labelThreshold && labels[ni] === 0) {
            labels[ni] = nextLabel;
            queue.push(ni);
          }
        }
      }

      if (cells.length >= 4) {
        labelAreas.set(nextLabel, {
          cells,
          avgY: ySum / cells.length,
          avgM: mSum / cells.length,
          area: cells.length,
          minX: Math.min(...cells.map(c => c.gx)),
          maxX: Math.max(...cells.map(c => c.gx)),
          minZ: Math.min(...cells.map(c => c.gz)),
          maxZ: Math.max(...cells.map(c => c.gz)),
        });
      }
      nextLabel++;
    }
  }

  // 5) Bölgeleri türe dönüştür — manyetik İŞARET + şekil analizi:
  //    * Pozitif güçlü anomali → METAL (yoğun/iletken cisim, alan artırır)
  //    * Negatif güçlü anomali → ODA (boşluk/mağara, alanı zayıflatır)
  //    * Uzun-dar bölge       → TÜNEL (işaret farketmez)
  //    * Zayıf sinyal          → gürültü, rapora girmez
  const chambers = [];
  const tunnels = [];
  const metals = [];
  // MIN_STRENGTH yukarıda tanımlandı — |işaretli z-skor| altı gürültü sayılır

  for (const [label, region] of labelAreas) {
    // Grid hücresinden nokta koordinatına geri dönüşüm
    // build2DGrid: gx = ((p.x - xMin) / xRange) * gridRes
    // Tersi: pointX = xMin + (gx / gridRes) * xRange
    const cxVal = xMin + (((region.minX + region.maxX) / 2) / gridRes) * xRange;
    const czVal = zMin + (((region.minZ + region.maxZ) / 2) / gridRes) * zRange;
    const wM = ((region.maxX - region.minX + 1) / gridRes) * xRange;
    const dM = ((region.maxZ - region.minZ + 1) / gridRes) * zRange;
    const aspect = Math.max(wM, dM) / (Math.min(wM, dM) || 1e-9);

    // Bölgenin işaretli anomali şiddeti (persentil ortasına göre)
    const regionM = (region.avgM - mMid) / mSpread;
    const strength = Math.abs(regionM);
    if (strength < MIN_STRENGTH) continue; // zayıf — gürültü

    // Derinlik: yGrid ortalamasını derinlik olarak kullan
    const depthM = Math.abs(region.avgY);

    if (aspect > 2.2) {
      // Tünel: uzun ve dar
      const hw = wM / 2, hd = dM / 2;
      tunnels.push({
        x0: cxVal - hw, y0: czVal,
        x1: cxVal + hw, y1: czVal,
        floorFromSurfaceM: depthM,
        widthM: dM,
        heightM: 1.5,
        strength,
      });
    } else if (regionM > 0) {
      // Metal: güçlü pozitif anomali
      metals.push({
        cx: cxVal, cy: czVal,
        depthFromSurfaceM: depthM,
        widthM: wM,
        lengthM: dM,
        fieldStrength: Math.abs(region.avgM) / (p90 || 1),
        strength,
      });
    } else {
      // Oda: güçlü negatif anomali (manyetik zayıflama = boşluk)
      chambers.push({
        cx: cxVal, cy: czVal,
        topFromSurfaceM: depthM - 1,
        bottomFromSurfaceM: depthM + 1,
        widthM: wM,
        lengthM: dM,
        kind: 'chamber',
        strength,
      });
    }
  }

  // Güçlüden zayıfa sırala — rapor ve 3D rozet numaraları en güçlüden başlasın
  const byStrength = (a, b) => (b.strength || 0) - (a.strength || 0);
  chambers.sort(byStrength);
  tunnels.sort(byStrength);
  metals.sort(byStrength);

  console.log(`[CSV] Dilim yapı tespiti: ${chambers.length} oda, ${tunnels.length} tünel, ${metals.length} metal (${labelAreas.size} bölge)`);
  return { chambers, tunnels, metals };
}

function quickStats(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, stddev: 1 };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let v = 0;
  for (const x of values) v += (x - mean) ** 2;
  return { mean, stddev: Math.sqrt(v / n) };
}

/**
 * Tüm derinlik dilimlerini analiz edip dilim bazında yapı raporu üretir.
 *
 * @param {Array} points - ham CSV noktaları
 * @param {Object} opts - { sliceCount, poolSizeM, gridRes }
 * @returns {{slices: Array, totals: {chambers, tunnels, metals}, sliceCount}}
 */
export function analyzeDepthSlices(points, opts = {}) {
  const sliceCount = Math.max(1, Math.min(16, opts.sliceCount || 8));
  const gridRes = opts.gridRes || 64;
  const poolSizeM = opts.poolSizeM || 30;

  const ug = filterUnderground(points).points;
  if (ug.length === 0) {
    return { slices: [], totals: { chambers: 0, tunnels: 0, metals: 0 }, sliceCount };
  }

  const b = computeBounds(ug);

  const slices = [];
  const totals = { chambers: 0, tunnels: 0, metals: 0 };

  for (let s = 1; s <= sliceCount; s++) {
    const sd = sliceDepths(points, s, sliceCount);
    if (sd.points.length === 0) {
      slices.push({ slice: s, count: 0, yMin: sd.yMin, yMax: sd.yMax, chambers: [], tunnels: [], metals: [] });
      continue;
    }
    const gd = build2DGrid(sd.points, gridRes, {
      xMin: b.xMin, xMax: b.xMax, zMin: b.zMin, zMax: b.zMax,
    }, false);
    const mStats = quickStats(sd.points.map(p => p.magnetic));
    const found = detectStructuresFromTerrain(gd.yGrid, gd.mGrid, gd.counts, gd.gridRes, poolSizeM, mStats, {
      threshold: opts.threshold,
      minStrength: opts.minStrength,
      bounds: { xMin: b.xMin, xMax: b.xMax, zMin: b.zMin, zMax: b.zMax },
    });

    slices.push({
      slice: s,
      count: sd.points.length,
      yMin: sd.yMin,
      yMax: sd.yMax,
      chambers: found.chambers,
      tunnels: found.tunnels,
      metals: found.metals,
    });
    totals.chambers += found.chambers.length;
    totals.tunnels += found.tunnels.length;
    totals.metals += found.metals.length;
  }

  console.log(`[CSV] Dilim analizi: ${sliceCount} dilim → ${totals.chambers} oda, ${totals.tunnels} tünel, ${totals.metals} metal`);
  return { slices, totals, sliceCount };
}