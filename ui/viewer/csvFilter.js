/**
 * Yeraltı analiz motoru — manyetik anomali haritacılığı.
 *
 * Cihaz taraması, yüzeyin hem üstü hem altını ölçer. Biz yer altına
 * baktığımız için yalnızca yer altı verisi kullanılır:
 *
 *   Y = derinlik (negatif = yüzey altı)
 *   Z = ileri/geri konum (negatif = tarama hacmi içi)
 *
 * Kural: x < 0 VE y < 0 VE z < 0 olmayanlar elenir (üç eksen de negatif).
 * Manyetik değer (anomali) bu filtreye tabi tutulmaz — pozitif veya
 * negatif olabilir, çünkü anomali işareti cismin türünü belirtir
 * (pozitif = metal/yoğun, negatif = boşluk).
 */

/**
 * Nokta listesinden eksen sınırlarını hesaplar.
 * @param {Array<{x:number,y:number,z:number}>} points
 * @returns {{xMin:number,xMax:number,yMin:number,yMax:number,zMin:number,zMax:number}}
 */
export function computeBounds(points) {
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  for (const p of points) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
    if (p.z < zMin) zMin = p.z;
    if (p.z > zMax) zMax = p.z;
  }
  if (!isFinite(xMin)) {
    xMin = xMax = yMin = yMax = zMin = zMax = 0;
  }
  return { xMin, xMax, yMin, yMax, zMin, zMax };
}

/**
 * Yeraltı filtresi — anomali değeri hariç, x<0, y<0 VE z<0 olmayan noktaları eler.
 * @param {Array<{x:number,y:number,z:number,magnetic:number}>} points
 * @returns {{points:Array, filteredCount:number, keptCount:number}}
 */
export function filterUnderground(points) {
  if (!points || points.length === 0) {
    return { points: [], keptCount: 0, filteredCount: 0 };
  }
  const kept = [];
  for (const p of points) {
    if (p.x < 0 && p.y < 0 && p.z < 0) {
      kept.push(p);
    }
  }
  // Pozitif veya karma koordinatlı dosyalarda 0 nokta kalırsa tüm noktaları koru
  if (kept.length === 0) {
    return {
      points: points,
      keptCount: points.length,
      filteredCount: 0,
    };
  }
  return {
    points: kept,
    keptCount: kept.length,
    filteredCount: points.length - kept.length,
  };
}

/**
 * Derinlik dilimleme — yeraltı verisini Y ekseni boyunca böler.
 * Önce yeraltı filtresi uygulanır (x<0 && y<0 && z<0).
 *
 * @param {Array} points - ham noktalar (filtre içte uygulanır)
 * @param {number} slice - 0 = tümü, 1..sliceCount = o dilim (1 en yüzeye yakın)
 * @param {number} sliceCount - toplam dilim sayısı
 * @returns {{points:Array, yMin:number, yMax:number, count:number}}
 */
export function sliceDepths(points, slice, sliceCount) {
  const ug = filterUnderground(points).points;
  if (ug.length === 0) {
    return { points: ug, yMin: 0, yMax: 0, count: 0 };
  }
  let yMin = Infinity, yMax = -Infinity;
  for (const p of ug) {
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  if (sliceCount <= 1 || slice <= 0) {
    return { points: ug, yMin, yMax, count: ug.length };
  }
  const span = (yMax - yMin) || 1;
  const eps = span * 0.001;
  // Dilim 1 = en yüzeye yakın (y büyük), son dilim en derin (y küçük)
  const lo = yMax - (span * slice) / sliceCount;
  const hi = slice === 1 ? yMax + eps : yMax - (span * (slice - 1)) / sliceCount;
  const kept = ug.filter((p) => p.y >= lo && p.y < hi);
  // Dilimin kendi bandını döndür (etiket ve rapor için)
  if (kept.length > 0) {
    let outMin = Infinity, outMax = -Infinity;
    for (const p of kept) {
      if (p.y < outMin) outMin = p.y;
      if (p.y > outMax) outMax = p.y;
    }
    return { points: kept, yMin: outMin, yMax: outMax, count: kept.length };
  }
  return { points: kept, yMin, yMax, count: kept.length };
}

/**
 * Otomatik sığdırma — verinin (yer altı) dağılımına göre dikdörtgen hacim boyutu.
 * Kutu, verinin gerçek aralığının sığdırma payına bölünmüş hali: veri kutunun
 * %S'ini kaplaysın diye kutu = span / S. Böylece anomali kenar payıyla birlikte
 * hacim sınırının dışına taşmaz ve veri/kenar oranı slider ile aynı mantıkta kalır.
 *
 * @param {Array} points - ham CSV noktaları (yer altı filtresi içte uygulanır)
 * @param {number} fit - verinin kutuyu kaplama oranı (0.5..1, örn. 0.85)
 * @param {number} minM - eksen min boyutu
 * @param {number} maxM - eksen max boyutu
 * @returns {{w:number, h:number, d:number}|null}
 */
export function autoBoxFor(points, fit = 0.85, minM = 10, maxM = 100) {
  const ug = filterUnderground(points).points;
  if (ug.length === 0) return null;
  const b = computeBounds(ug);
  const fitC = Math.max(0.1, Math.min(1, Number(fit) || 0.85));
  const pad = 1 / fitC;
  const clamp = (v) => Math.max(minM, Math.min(maxM, v));
  return {
    w: clamp((b.xMax - b.xMin) * pad),
    h: clamp((b.yMax - b.yMin) * pad),
    d: clamp((b.zMax - b.zMin) * pad),
  };
}

/**
 * Dilim bandının havuz içi Y aralığını hesaplar (3D görselleştirme için).
 * Havuz Y ekseni +halfPool (yüzey) .. -halfPool (taban) şeklinde normalize edilir.
 * Dilim 1 yüzeye en yakın bant, son dilim tabana en yakın banttır.
 *
 * @param {number} slice - 1..sliceCount (0 = tümü → null)
 * @param {number} sliceCount
 * @param {number} poolSizeM
 * @param {number} usable - kullanılabilir dikey alan (fitFactor × poolSizeM); varsayılan poolSizeM
 * @returns {{top:number, bottom:number, center:number, thickness:number}|null}
 */
export function sliceBandY(slice, sliceCount, poolSizeM, usable) {
  const s = Math.floor(Number(slice) || 0);
  const sc = Math.max(1, Math.floor(Number(sliceCount) || 1));
  if (s <= 0 || s > sc) return null;
  const half = poolSizeM / 2;
  const u = Math.max(poolSizeM / sc, Math.min(poolSizeM, Number(usable) || poolSizeM));
  const bandH = u / sc;
  // Dilim 1 = en üst (yüzeye yakın: halfPool'dan aşağı), son dilim = en alt
  const top = half - bandH * (s - 1);
  const bottom = half - bandH * s;
  return { top, bottom, center: (top + bottom) / 2, thickness: top - bottom };
}