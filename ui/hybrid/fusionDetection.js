/**
 * fusionDetection.js — Fusion-Bazlı Yapı Tespiti
 *
 * Fusion haritasından (image + CSV birleşimi) yapı tespiti yapar.
 * Sadece CSV grid'iyle değil, iki kaynağın kesişimindeki yapıları bulur.
 *
 * avantajlar:
 *   - Tek kaynaktaki gürültü azalır
 *   - İki kaynakta da görünen yapılar yüksek öncelik kazanır
 *   - Sadece bir kaynaktaki yapılar düşük güvenle işaretlenir
 *
 * Geri dönüşümlü: enable(false) ile devre dışı.
 */

// ── Sabitler ──

const FUSION_GRID_RES = 64;          // Fusion grid çözünürlüğü
const FUSION_MIN_COUNT = 3;          // Hücrede minimum nokta sayısı
const FUSION_ANOMALY_THRESHOLD = 0.8; // Anomali eşiği (z-skoru)
const FUSION_MIN_STRENGTH = 0.40;    // Minimum yapı gücü
const MATCH_DISTANCE_M = 3.0;        // Eşleşme mesafesi (m)

let enabled = false;

/**
 * Fusion grid verisinden yapı tespiti yap.
 *
 * @param {Array} fusionGrid - fuseDataSources çıktısı [{gx,gy,fusedValue,confidence,csvOnly,imageOnly,both,...}]
 * @param {Object} options
 * @param {number} [options.gridRes=64] - Grid çözünürlüğü
 * @param {number} [options.poolSizeM=30] - Havuz boyutu (m)
 * @param {Array} [options.csvStructures] - Mevcut CSV yapıları (eşleşme kontrolü)
 * @returns {Object} { chambers, tunnels, metals, fusionStats }
 */
export function detectFromFusion(fusionGrid, options = {}) {
  if (!enabled || !fusionGrid || fusionGrid.length === 0) {
    return { chambers: [], tunnels: [], metals: [], fusionStats: { totalCells: 0 } };
  }

  const gridRes = options.gridRes || FUSION_GRID_RES;
  const poolSizeM = options.poolSizeM || 30;
  const csvStructures = options.csvStructures || { chambers: [], tunnels: [], metals: [] };

  // ── Fusion grid'den istatistikler ──
  const values = fusionGrid.map(c => c.fusedValue || 0);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) || 1;

  // ── Z-skoru haritası ──
  const zScoreMap = new Map();
  for (const cell of fusionGrid) {
    const z = Math.abs((cell.fusedValue - mean) / std);
    const key = `${cell.gx},${cell.gy}`;
    zScoreMap.set(key, { ...cell, zScore: z });
  }

  // ── Anomali bölgelerini bul (basit blob detection) ──
  const cells = Array.from(zScoreMap.values())
    .filter(c => c.zScore >= FUSION_ANOMALY_THRESHOLD)
    .sort((a, b) => b.zScore - a.zScore);

  // ── Blob birleştirme ──
  const blobs = mergeBlobs(cells, gridRes);

  // ── Her blob'u yapı olarak sınıflandır ──
  const cellSize = poolSizeM / gridRes;
  const chambers = [];
  const tunnels = [];
  const metals = [];

  const allCsvStructs = [
    ...csvStructures.chambers.map(s => ({ ...s, srcType: 'chamber' })),
    ...csvStructures.tunnels.map(s => ({ ...s, srcType: 'tunnel' })),
    ...csvStructures.metals.map(s => ({ ...s, srcType: 'metal' })),
  ];

  let fusionMatchCount = 0;

  for (const blob of blobs) {
    // Merkez koordinat
    const cx = (blob.avgGx / gridRes - 0.5) * poolSizeM;
    const cz = (blob.avgGy / gridRes - 0.5) * poolSizeM;
    const spread = Math.max(blob.width, blob.height) * cellSize;
    const avgZScore = blob.avgZScore;

    // Fusion güven skoru
    const fusionConfidence = Math.min(1, avgZScore / 3);
    const bothPresent = blob.bothCount / Math.max(blob.totalCount, 1);
    const fusionQuality = fusionConfidence * (0.5 + 0.5 * bothPresent);

    // CSV yapılarıyla eşleşme kontrolü
    let matchedCsv = null;
    for (const cs of allCsvStructs) {
      const dist = Math.hypot(cx - (cs.cx || 0), cz - (cs.cz || 0));
      if (dist < MATCH_DISTANCE_M) {
        matchedCsv = cs;
        break;
      }
    }

    // Sınıflandırma
    const aspectRatio = blob.width / Math.max(blob.height, 1);
    const fusedType = fusionType(blob, avgZScore, aspectRatio);

    const entry = {
      cx, cz,
      spread: spread.toFixed(1),
      depth: matchedCsv?.depth || (spread * 0.6).toFixed(1),
      magnetic: matchedCsv?.magnetic || Math.round(avgZScore * 200),
      confidence: fusionQuality,
      fusionScore: fusionQuality,
      source: matchedCsv ? "fusion+csv" : "fusion-only",
      matchedCsv: matchedCsv ? true : false,
      bothCount: blob.bothCount,
      totalCells: blob.totalCount,
    };

    if (matchedCsv) fusionMatchCount++;

    if (fusedType === 'chamber') chambers.push(entry);
    else if (fusedType === 'tunnel') tunnels.push(entry);
    else metals.push(entry);
  }

  const fusionStats = {
    totalCells: fusionGrid.length,
    anomalyCells: cells.length,
    blobs: blobs.length,
    chambers: chambers.length,
    tunnels: tunnels.length,
    metals: metals.length,
    matchedWithCsv: fusionMatchCount,
    uniqueToImage: blobs.length - fusionMatchCount,
  };

  console.log(`[FusionDetection] ${blobs.length} yapı: ${chambers.length} oda, ${tunnels.length} tünel, ${metals.length} metal`);
  return { chambers, tunnels, metals, fusionStats };
}

/**
 * Fusion tespitlerini CSV yapılarıyla birleştir (öncelik CSV'de).
 *
 * @param {Object} fusionResult - detectFromFusion çıktısı
 * @param {Object} csvStructures - {chambers, tunnels, metals}
 * @returns {Object} Birleştirilmiş yapı listesi
 */
export function mergeWithCsvStructures(fusionResult, csvStructures) {
  if (!enabled) return csvStructures;

  const merged = {
    chambers: [...(csvStructures.chambers || [])],
    tunnels: [...(csvStructures.tunnels || [])],
    metals: [...(csvStructures.metals || [])],
  };

  const allCsv = [
    ...merged.chambers.map(s => ({ ...s, type: 'chamber' })),
    ...merged.tunnels.map(s => ({ ...s, type: 'tunnel' })),
    ...merged.metals.map(s => ({ ...s, type: 'metal' })),
  ];

  // Fusion-only yapıları ekle (eşleşmemiş olanları)
  for (const fType of ['chambers', 'tunnels', 'metals']) {
    for (const f of (fusionResult[fType] || [])) {
      if (!f.matchedCsv) {
        // CSV'de eşleşmesi olmayan fusion yapısı
        merged[fType].push({
          ...f,
          fusionOnly: true,
          confidence: f.fusionScore,
        });
      }
    }
  }

  return merged;
}

// ── Yardımcı Fonksiyonlar ──

function mergeBlobs(cells, gridRes) {
  const visited = new Set();
  const blobs = [];

  for (const cell of cells) {
    const key = `${cell.gx},${cell.gy}`;
    if (visited.has(key)) continue;

    // BFS ile komşu hücreleri birleştir
    const blob = { cells: [], avgGx: 0, avgGy: 0, avgZScore: 0, bothCount: 0, totalCount: 0 };
    const queue = [cell];

    while (queue.length > 0) {
      const c = queue.shift();
      const ck = `${c.gx},${c.gy}`;
      if (visited.has(ck)) continue;
      visited.add(ck);

      blob.cells.push(c);
      blob.avgGx += c.gx;
      blob.avgGy += c.gy;
      blob.avgZScore += c.zScore;
      if (c.both) blob.bothCount++;
      blob.totalCount++;

      // 8-yönlü komşular
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nk = `${c.gx + dx},${c.gy + dy}`;
          const nc = cells.find(cc => `${cc.gx},${cc.gy}` === nk);
          if (nc && !visited.has(nk)) queue.push(nc);
        }
      }
    }

    if (blob.cells.length < FUSION_MIN_COUNT) continue;

    blob.avgGx /= blob.totalCount;
    blob.avgGy /= blob.totalCount;
    blob.avgZScore /= blob.totalCount;

    // Genişlik ve yükseklik hesapla
    const gxs = blob.cells.map(c => c.gx);
    const gys = blob.cells.map(c => c.gy);
    blob.width = Math.max(...gxs) - Math.min(...gxs) + 1;
    blob.height = Math.max(...gys) - Math.min(...gys) + 1;

    blobs.push(blob);
  }

  return blobs;
}

function fusionType(blob, zScore, aspectRatio) {
  if (aspectRatio > 2.5 && blob.cells.length >= 4) return 'tunnel';
  if (zScore > 1.8 && blob.cells.length >= 6) return 'metal';
  return 'chamber';
}

/**
 * Fusion tespitini aktifleştir/pasifleştir.
 */
export function setFusionDetectionEnabled(e) {
  enabled = !!e;
  console.log(`[FusionDetection] ${enabled ? 'AKTİF' : 'PASİF'}`);
}

/**
 * Aktiflik durumunu döndür.
 */
export function isFusionDetectionEnabled() {
  return enabled;
}
