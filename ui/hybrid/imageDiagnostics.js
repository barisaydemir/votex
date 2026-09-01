/**
 * imageDiagnostics.js — Image tespitleri için derinlik + güven hesaplama.
 *
 * Manyetik alan gradyanından derinlik tahmini:
 *   - Sığ kaynak → keskin gradyan (hızlı değişim)
 *   - Derin kaynak → yumuşak gradyan (yavaş değişim)
 *
 * Formül: depth ≈ k / gradient
 *   k = kalibrasyon sabiti (havuz boyutuna göre)
 *   gradient = komşu hücreler arasındaki ortalama nT farkı / hücre boyutu
 *
 * Çok faktörlü güven skoru:
 *   - Sinyal gücü (|nT| / max_nT)
 *   - Gradyan netliği (komşu farkı)
 *   - Piksel kapsamı (eşleşme yoğunluğu)
 *   - Anomali şekli (simetri, boyut)
 *   - Pickloudness (kaç komşu hücre benzer değerlerde)
 */

// ── Sabitler ──

/** Derinlik kalibrasyon sabiti (metre × gradyan) */
const DEPTH_K = 8.0;

/** Maksimum derinlik tahmini (metre) */
const MAX_DEPTH = 25;

/** Minimum derinlik tahmini (metre) */
const MIN_DEPTH = 0.3;

// ── Ana Fonksiyonlar ──

/**
 * Image grid'inden bir tespit için derinlik tahmini hesapla.
 *
 * Komşu hücrelerin nT değerlerinden gradyan hesaplanır.
 * Yüksek gradyan = sığ kaynak, düşük gradyan = derin kaynak.
 *
 * @param {Array} grid — extractMagneticGrid çıktısı
 * @param {Object} cell — { gx, gy, nT } — hedef hücre
 * @param {number} gridRes — grid çözünürlüğü
 * @param {number} poolSizeM — havuz boyutu (metre)
 * @returns {number} derinlik (metre)
 */
export function estimateDepthFromGradient(grid, cell, gridRes, poolSizeM) {
  const cellSizeM = poolSizeM / gridRes;

  // Hücrenin komşularını bul (3×3 pencere)
  const neighbors = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cell.gx + dx;
      const ny = cell.gy + dy;
      if (nx < 0 || nx >= gridRes || ny < 0 || ny >= gridRes) continue;

      // Grid'den bu hücreyi bul
      const neighbor = grid.find(g => g.gx === nx && g.gy === ny);
      if (neighbor) {
        const dist = Math.hypot(dx, dy) * cellSizeM;
        neighbors.push({ nT: neighbor.nT, dist, dx, dy });
      }
    }
  }

  if (neighbors.length === 0) return 5; // fallback

  // Ağırlıklı ortalama gradyan (yakın komşulara daha çok ağırlık)
  let weightedGradSum = 0;
  let weightSum = 0;

  for (const nb of neighbors) {
    const dt = Math.abs(cell.nT - nb.nT);
    const grad = dt / (nb.dist || cellSizeM);
    const weight = 1 / (nb.dist / cellSizeM + 0.5); // yakınlık ağırlığı
    weightedGradSum += grad * weight;
    weightSum += weight;
  }

  const avgGradient = weightSum > 0 ? weightedGradSum / weightSum : 1;

  // Derinlik = k / gradyan
  // Yüksek gradyan → sığ, düşük gradyan → derin
  const depth = DEPTH_K / (avgGradient + 0.1);

  return Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, depth));
}

/**
 * Image grid'inden bir tespit için çok faktörlü güven skoru hesapla.
 *
 * 0-1 arası skor:
 *   0.8-1.0 = Yüksek güven
 *   0.5-0.8 = Orta güven
 *   0.0-0.5 = Düşük güven
 *
 * @param {Array} grid — extractMagneticGrid çıktısı
 * @param {Object} cell — { gx, gy, nT, pixelCount }
 * @param {number} gridRes — grid çözünürlüğü
 * @param {Object} stats — imageGrid istatistikleri (nTMin, nTMax, posCount, negCount)
 * @returns {{ confidence: number, factors: Object }}
 */
export function computeImageConfidence(grid, cell, gridRes, stats) {
  const factors = {};

  // 1. Sinyal gücü (0-25 puan)
  // |nT| ne kadar yüksekse, sinyal o kadar güçlü
  const maxAbsNT = Math.max(Math.abs(stats.nTMin), Math.abs(stats.nTMax), 1);
  const signalStrength = Math.abs(cell.nT) / maxAbsNT;
  factors.signalStrength = signalStrength;
  const signalScore = Math.min(25, signalStrength * 25);

  // 2. Gradyan netliği (0-25 puan)
  // Komşularla fark ne kadar netse, anomali o kadar belirgin
  const gradScore = computeGradientClarity(grid, cell, gridRes);
  factors.gradientClarity = gradScore / 25;

  // 3. Piksel kapsamı (0-20 puan)
  // Hücredeki eşleşen piksel sayısı ne kadar fazlaysa, veri o kadar güvenilir
  const pixelRatio = Math.min(1, (cell.pixelCount || 0) / 50);
  factors.pixelCoverage = pixelRatio;
  const pixelScore = pixelRatio * 20;

  // 4. Anomali şekli (0-15 puan)
  // Simetrik ve kompakt anomali → yüksek güven
  const shapeScore = computeAnomalyShape(grid, cell, gridRes);
  factors.shapeQuality = shapeScore / 15;

  // 5. Komşu tutarlılığı (0-15 puan)
  // Yakın komşularda benzer işaretli anomali varsa → güçlü tespit
  const neighborScore = computeNeighborConsistency(grid, cell, gridRes);
  factors.neighborConsistency = neighborScore / 15;

  const totalScore = signalScore + gradScore + pixelScore + shapeScore + neighborScore;
  const confidence = Math.min(1, totalScore / 100);

  return { confidence, factors };
}

/**
 * Toplu hesaplama — tüm image tespitleri için derinlik + güven.
 *
 * @param {Array} grid — extractMagneticGrid çıktısı
 * @param {number} gridRes — grid çözünürlüğü
 * @param {number} poolSizeM — havuz boyutu
 * @param {Object} stats — imageGrid istatistikleri
 * @param {number} [threshold=150] — nT eşiği (bu değerin altındaki tespitler atlanır)
 * @returns {Array<{gx,gy,x,y,nT,depth,confidence,type,factors}>}
 */
export function diagnoseImageDetections(grid, gridRes, poolSizeM, stats, threshold = 150) {
  const detections = [];

  for (const cell of grid) {
    if (Math.abs(cell.nT) < threshold) continue;

    const depth = estimateDepthFromGradient(grid, cell, gridRes, poolSizeM);
    const { confidence, factors } = computeImageConfidence(grid, cell, gridRes, stats);

    // Tip sınıflandırması (gelişmiş)
    const type = classifyDetection(cell.nT, depth, confidence, factors);

    detections.push({
      gx: cell.gx,
      gy: cell.gy,
      x: cell.x,
      y: cell.y,
      nT: cell.nT,
      depth,
      confidence,
      type,
      factors,
      pixelCount: cell.pixelCount || 0,
    });
  }

  // Güvenilirliğe göre sırala (en yüksek önce)
  detections.sort((a, b) => b.confidence - a.confidence);

  return detections;
}

// ── Yardımcı Fonksiyonlar ──

/**
 * Gradyan netliği — komşularla ortalama fark.
 */
function computeGradientClarity(grid, cell, gridRes) {
  let totalDiff = 0;
  let count = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cell.gx + dx;
      const ny = cell.gy + dy;
      if (nx < 0 || nx >= gridRes || ny < 0 || ny >= gridRes) continue;

      const neighbor = grid.find(g => g.gx === nx && g.gy === ny);
      if (neighbor) {
        totalDiff += Math.abs(cell.nT - neighbor.nT);
        count++;
      }
    }
  }

  // Yüksek fark → net gradyan → yüksek skor
  const avgDiff = count > 0 ? totalDiff / count : 0;
  // Grid'den max nT'yi hesapla (stats parametresi yoksa)
  let maxAbs = 100;
  for (const g of grid) {
    if (Math.abs(g.nT) > maxAbs) maxAbs = Math.abs(g.nT);
  }
  return Math.min(25, (avgDiff / maxAbs) * 25);
}

/**
 * Anomali şekli — simetri ve kompaktlık.
 */
function computeAnomalyShape(grid, cell, gridRes) {
  // Hücre etrafındaki pozitif/negatif hücre sayısını say
  let sameSignCount = 0;
  let totalCount = 0;
  const sign = Math.sign(cell.nT);

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cell.gx + dx;
      const ny = cell.gy + dy;
      if (nx < 0 || nx >= gridRes || ny < 0 || ny >= gridRes) continue;

      const neighbor = grid.find(g => g.gx === nx && g.gy === ny);
      if (neighbor) {
        totalCount++;
        if (Math.sign(neighbor.nT) === sign) sameSignCount++;
      }
    }
  }

  // Kompakt = etrafındaki hücrelerin çoğu aynı işaretle → yüksek skor
  const compactness = totalCount > 0 ? sameSignCount / totalCount : 0;
  return Math.min(15, compactness * 15);
}

/**
 * Komşu tutarlılığı — yakındaki benzer tespitler.
 */
function computeNeighborConsistency(grid, cell, gridRes) {
  let consistentNeighbors = 0;
  let totalNeighbors = 0;

  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cell.gx + dx;
      const ny = cell.gy + dy;
      if (nx < 0 || nx >= gridRes || ny < 0 || ny >= gridRes) continue;

      const neighbor = grid.find(g => g.gx === nx && g.gy === ny);
      if (neighbor && Math.abs(neighbor.nT) > 100) {
        totalNeighbors++;
        // Aynı işaret + güçlü sinyal → tutarlı
        if (Math.sign(neighbor.nT) === Math.sign(cell.nT)
            && Math.abs(neighbor.nT) > Math.abs(cell.nT) * 0.3) {
          consistentNeighbors++;
        }
      }
    }
  }

  const consistency = totalNeighbors > 0 ? consistentNeighbors / totalNeighbors : 0;
  return Math.min(15, consistency * 15);
}

/**
 * Gelişmiş tip sınıflandırması.
 *
 * Basit kurall:
 *   - Güçlü pozitif + yüksek güven + sığ → Metal
 *   - Güçlü negatif + yüksek güven → Oda (boşluk)
 *   - Uzun-dar negatif/pozitif → Tünel
 *   - Düşük güven → Belirsiz
 *
 * @param {number} nT — manyetik değer
 * @param {number} depth — tahmini derinlik
 * @param {number} confidence — güven skoru
 * @param {Object} factors — güven faktörleri
 * @returns {string} 'metal' | 'oda' | 'tunnel' | 'belirsiz'
 */
function classifyDetection(nT, depth, confidence, factors) {
  const absNT = Math.abs(nT);
  const isPositive = nT > 0;

  // Düşük güven → belirsiz
  if (confidence < 0.3) return 'belirsiz';

  // Güçlü pozitif anomali → metal olasılığı yüksek
  if (isPositive && absNT > 200 && confidence > 0.5) {
    // Sığ + çok güçlü → kesin metal
    if (depth < 3 && absNT > 350) return 'metal';
    // Orta derinlik + güçlü → muhtemel metal
    if (depth < 8 && absNT > 250) return 'metal';
    return 'metal';
  }

  // Güçlü negatif anomali → boşluk/oda
  if (!isPositive && absNT > 150 && confidence > 0.4) {
    return 'oda';
  }

  // Orta güçte negatif → tünel olasılığı
  if (!isPositive && absNT > 100 && absNT < 300 && factors?.shapeQuality > 0.5) {
    return 'tunnel';
  }

  // Zayıf sinyal → belirsiz
  if (absNT < 200) return 'belirsiz';

  // Varsayılan: işaretine göre
  return isPositive ? 'metal' : 'oda';
}

// ── Dışa Aktarılan Sabitler ──
export { DEPTH_K, MAX_DEPTH, MIN_DEPTH };
