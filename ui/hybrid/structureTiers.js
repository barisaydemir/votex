/**
 * structureTiers.js — z-skor tohumlama, küme birleştirme ve şekil sınıflandırma.
 *
 * Amaç: "hassasiyet çubuğu sadece silmesin, yüksek oranlı yapı ve anomalileri
 * açığa çıkarsın". Bunun için:
 *   1. Tohum eşiği manyetik **genlik z-skoruna** bağlı (sensParams.seedZ) —
 *      çubuk arttıkça zayıf ama tutarlı anomaliler de KEŞFEDİLİR.
 *   2. Bitişik tohumlar 8-bağlantılı kümelere BİRLEŞTİRİLİR — kırık parçalar
 *      tek yapı sayılır, alan filtresi birleşik yapı üzerinde uygulanır.
 *   3. Her küme şekil sınıflandırmasına girer: metal / oda / tünel / boşluk.
 *
 * Saf fonksiyonlar (THREE/DOM yok) — birim testlenebilir.
 */

const CONF_FLOOR = 0.05;
const CONF_CEIL = 0.99;

/**
 * Grid manyetik istatistikleri (z-skor için μ/σ).
 * @param {Array<{magnetic?: number}>} cells
 * @returns {{mean: number, std: number}}
 */
export function computeGridStats(cells = []) {
  const vals = cells.map((c) => c.magnetic || 0);
  const n = vals.length || 1;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance) || 1 };
}

/**
 * Değerin z-skoru (σ cinsinden manyetik genlik — "oranın" ham ölçüsü).
 */
export function zScoreOf(value, stats) {
  return ((value || 0) - stats.mean) / (stats.std || 1);
}

function cellGx(cell, gridRes) {
  if (Number.isFinite(cell.gx)) return cell.gx;
  return Math.round((cell.x || 0) * Math.max(1, (gridRes || 64) - 1));
}

function cellGy(cell, gridRes) {
  if (Number.isFinite(cell.gy)) return cell.gy;
  return Math.round((cell.y || 0) * Math.max(1, (gridRes || 64) - 1));
}

/**
 * |z| ≥ seedZ hücrelerini işaretine göre 8-bağlantılı kümelere birleştir.
 * @param {Array} cells — {x, y, gx?, gy?, magnetic, confidence?}
 * @param {{mean: number, std: number}} stats
 * @param {number} seedZ — keşif tohumu (σ)
 * @param {number} [gridRes=64]
 * @returns {Array} kümeler: {sign, cells, area, peakCell, peakZ, dataConf, cx, cy, minX, maxX, minY, maxY, aspect}
 */
export function clusterSeeds(cells = [], stats, seedZ = 1.75, gridRes = 64) {
  const byKey = new Map();
  for (const cell of cells) {
    const z = zScoreOf(cell.magnetic, stats);
    if (Math.abs(z) < seedZ) continue;
    const key = `${cellGx(cell, gridRes)},${cellGy(cell, gridRes)}`;
    byKey.set(key, { cell, z, sign: Math.sign(z) || 1 });
  }

  const clusters = [];
  const visited = new Set();
  for (const [key, seed] of byKey) {
    if (visited.has(key)) continue;
    // Sel doldurma (aynı işaretli 8-komşuluk)
    const members = [];
    const stack = [key];
    visited.add(key);
    while (stack.length) {
      const cur = stack.pop();
      const node = byKey.get(cur);
      if (!node) continue;
      members.push(node);
      const [gx, gy] = cur.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          const nk = `${gx + dx},${gy + dy}`;
          const neighbor = byKey.get(nk);
          if (!visited.has(nk) && neighbor && neighbor.sign === seed.sign) {
            visited.add(nk);
            stack.push(nk);
          }
        }
      }
    }

    let peak = members[0];
    let confSum = 0;
    let confN = 0;
    let cx = 0;
    let cy = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const m of members) {
      const mag = Math.abs(m.cell.magnetic || 0);
      if (mag > Math.abs(peak.cell.magnetic || 0)) peak = m;
      if (typeof m.cell.confidence === "number") {
        confSum += m.cell.confidence;
        confN++;
      }
      const x = m.cell.x || 0;
      const y = m.cell.y || 0;
      cx += x;
      cy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    clusters.push({
      sign: seed.sign,
      cells: members.map((m) => m.cell),
      area: members.length,
      peakCell: peak.cell,
      peakZ: Math.abs(peak.z),
      dataConf: confN > 0 ? confSum / confN : 0.6,
      cx: cx / members.length,
      cy: cy / members.length,
      minX,
      maxX,
      minY,
      maxY,
      aspect: Math.max(spanX, spanY) / Math.min(spanX, spanY),
    });
  }
  return clusters;
}

/**
 * Küme → yapı tipi (şekil sınıflandırma):
 *   pozitif küme            → metal (güçlü manyetik anomali)
 *   negatif · uzamış        → tunnel (tünel/boşluk koridoru)
 *   negatif · kompakt geniş → chamber (oda)
 *   negatif · küçük         → void (küçük boşluk)
 */
export function classifyCluster(cluster) {
  if (cluster.sign > 0) return "metal";
  if (cluster.aspect >= 2.5 && cluster.area >= 5) return "tunnel";
  if (cluster.aspect < 2.5 && cluster.area >= 8) return "chamber";
  return "void";
}

/**
 * Fusion grid'den yapı tespitlerini üret — KADEME DOSTU: burada güven eşiğiyle
 * budama YOK; tek kesim noktası `filterDetectionsBySensitivity`'dir.
 *
 * @param {Object} input
 * @param {Array} input.fusionGrid — {x, y, gx?, gy?, magnetic, confidence?}
 * @param {Object} [input.depthResult] — {depthGrid: [{gx, gy, depth}]}
 * @param {number} [input.poolSizeM=30]
 * @param {number} [input.gridRes=64]
 * @param {Object} [input.sensitivityParams] — {seedZ}
 * @returns {Array} tespitler: {type, x, y, z, depth, magnetic, zScore, confidence, area, size, ...}
 */
export function buildStructureDetections({
  fusionGrid = [],
  depthResult = null,
  poolSizeM = 30,
  gridRes = 64,
  sensitivityParams = {},
} = {}) {
  const stats = computeGridStats(fusionGrid);
  const seedZ = Number.isFinite(sensitivityParams.seedZ) ? sensitivityParams.seedZ : 1.75;
  const clusters = clusterSeeds(fusionGrid, stats, seedZ, gridRes);

  return clusters.map((cl) => {
    const type = classifyCluster(cl);
    // Güven: manyetik güç (z-skor) + veri kaynağı güveni bileşimi
    const strength = Math.min(1, cl.peakZ / 4);
    const confidence = Math.max(
      CONF_FLOOR,
      Math.min(CONF_CEIL, 0.55 * strength + 0.45 * cl.dataConf)
    );

    // Derinlik: tepe hücresinin derinlik hücresi
    const rep = cl.peakCell;
    const depthCell = depthResult?.depthGrid?.find(
      (d) => d.gx === rep.gx && d.gy === rep.gy
    );
    const depth = depthCell?.depth || 5;

    const det = {
      type,
      x: (cl.cx - 0.5) * poolSizeM,
      y: -depth,
      z: (cl.cy - 0.5) * poolSizeM,
      depth,
      magnetic: cl.peakCell.magnetic || 0,
      zScore: Number(cl.peakZ.toFixed(3)),
      confidence: Number(confidence.toFixed(3)),
      area: cl.area,
      size: Math.max(1.2, Math.sqrt(cl.area) * 0.4),
    };

    // Tünel: uzun eksen boyunca uç noktalar (koridor çizgisi)
    if (type === "tunnel") {
      const horiz = cl.maxX - cl.minX >= cl.maxY - cl.minY;
      const midX = (cl.minX + cl.maxX) / 2;
      const midY = (cl.minY + cl.maxY) / 2;
      const [ax, az] = horiz ? [cl.minX, midY] : [midX, cl.minY];
      const [bx, bz] = horiz ? [cl.maxX, midY] : [midX, cl.maxY];
      det.x0 = (ax - 0.5) * poolSizeM;
      det.z0 = (az - 0.5) * poolSizeM;
      det.x1 = (bx - 0.5) * poolSizeM;
      det.z1 = (bz - 0.5) * poolSizeM;
    }

    return det;
  });
}
