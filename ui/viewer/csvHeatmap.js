/**
 * CSV Heatmap — 16K+ satır veriyi grid'e binning + 2D manyetik harita canvas.
 *
 * Ham CSV noktaları belirli bir grid boyutuna dağıtılır,
 * hücre başına ortalama manyetik değer hesaplanır.
 * Sonuç: hem 2D canvas önizleme hem de 3D overlay için binned grid.
 */

const DEFAULT_GRID_SIZE = 128;

/**
 * Ham CSV noktalarını grid'e binning yapar.
 * Hücre başına ortalama manyetik değer ve nokta sayısı döner.
 *
 * @param {Array} points - CsvDataPoint[] (x, y, magnetic)
 * @param {Object} bounds - { xMin, xMax, yMin, yMax }
 * @param {number} gridW - Grid genişliği (piksel/sütun)
 * @param {number} gridH - Grid yüksekliği (piksel/satır)
 * @returns {{ grid: Float32Array, counts: Uint32Array, gridW: number, gridH: number }}
 */
export function binCsvToGrid(points, bounds, gridW, gridH) {
  gridW = gridW || DEFAULT_GRID_SIZE;
  gridH = gridH || DEFAULT_GRID_SIZE;

  const { xMin, xMax, yMin, yMax } = bounds;
  const xRange = (xMax - xMin) || 1;
  const yRange = (yMax - yMin) || 1;

  const n = gridW * gridH;
  const grid = new Float32Array(n);      // ortalama manyetik
  const sums = new Float64Array(n);       // toplam (ortalama için)
  const counts = new Uint32Array(n);      // hücre başına nokta sayısı

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const gx = Math.round(((p.x - xMin) / xRange) * (gridW - 1));
    const gy = Math.round(((p.y - yMin) / yRange) * (gridH - 1));

    if (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH) continue;

    const idx = gy * gridW + gx;
    sums[idx] += (p.anomaly ?? p.magnetic);
    counts[idx]++;
  }

  // Ortalama hesapla
  for (let i = 0; i < n; i++) {
    grid[i] = counts[i] > 0 ? sums[i] / counts[i] : 0;
  }

  return { grid, counts, gridW, gridH };
}

/**
 * Binned grid'i manyetik harita canvas'a çizer.
 * Renk şeması: mavi (negatif) → yeşil (nötr) → kırmızı (pozitif)
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Float32Array} grid
 * @param {Uint32Array} counts
 * @param {number} gridW
 * @param {number} gridH
 * @param {Object} opts - { magneticMin, magneticMax, low, high, scaleUp }
 */
export function renderHeatmapCanvas(canvas, grid, counts, gridW, gridH, opts = {}) {
  if (!canvas || !grid) return;

  // Canvas iç çözünürlüğünü grid'den büyük tut — pikselli stretch olmasın
  // Panel genişliği ~300px, en az 200px yükseklik istiyoruz
  const displayW = opts.displayWidth || Math.max(gridW, 300);
  const displayH = opts.displayHeight || Math.max(gridH, Math.round(displayW * 0.65));
  canvas.width = displayW;
  canvas.height = displayH;
  // CSS: canvas tam genişlikte, otomatik yükseklik
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.imageRendering = 'auto';
  // Aspect-ratio: canvas iç çözünürlüğü displayW×displayH olarak korunur
  canvas.style.aspectRatio = `${displayW} / ${displayH}`;
  canvas.style.minHeight = '180px';

  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(displayW, displayH);
  const pixels = imageData.data;

  // Manyetik aralık
  let mMin = opts.magneticMin;
  let mMax = opts.magneticMax;
  if (mMin === undefined || mMax === undefined) {
    mMin = Infinity; mMax = -Infinity;
    for (let i = 0; i < grid.length; i++) {
      if (counts[i] > 0) {
        if (grid[i] < mMin) mMin = grid[i];
        if (grid[i] > mMax) mMax = grid[i];
      }
    }
    if (mMin === Infinity) { mMin = -100; mMax = 100; }
  }

  const mRange = (mMax - mMin) || 1;
  const mMid = (mMax + mMin) / 2;
  const mHalf = Math.max(Math.abs(mMax - mMid), Math.abs(mMid - mMin), 1);

  for (let y = 0; y < displayH; y++) {
    const gy = Math.min(gridH - 1, Math.floor(y * gridH / displayH));
    for (let x = 0; x < displayW; x++) {
      const gx = Math.min(gridW - 1, Math.floor(x * gridW / displayW));
      const idx = gy * gridW + gx;
      const pixIdx = (y * displayW + x) * 4;

      if (counts[idx] === 0) {
        // Boş hücre: koyu arka plan
        pixels[pixIdx] = 8;
        pixels[pixIdx + 1] = 12;
        pixels[pixIdx + 2] = 18;
        pixels[pixIdx + 3] = 255;
        continue;
      }

      const val = grid[idx];
      const color = magneticToRgb(val, mMid, mHalf);
      pixels[pixIdx] = color[0];
      pixels[pixIdx + 1] = color[1];
      pixels[pixIdx + 2] = color[2];
      pixels[pixIdx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Anomali eşiği çizgileri çiz
  if (opts.low !== undefined && opts.high !== undefined) {
    drawThresholdOverlay(ctx, grid, counts, gridW, gridH, displayW, displayH, opts.low, opts.high, mMin, mMax);
  }
}

/**
 * Anomali eşiği çizgilerini canvas üzerine çiz.
 */
function drawThresholdOverlay(ctx, grid, counts, gridW, gridH, displayW, displayH, low, high, mMin, mMax) {
  ctx.strokeStyle = 'rgba(226, 58, 58, 0.6)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  const mRange = (mMax - mMin) || 1;

  // Anomali piksel sayısını say
  let anomCount = 0;
  for (let y = 0; y < displayH; y++) {
    for (let x = 0; x < displayW; x++) {
      const gx = Math.min(gridW - 1, Math.floor(x * gridW / displayW));
      const gy = Math.min(gridH - 1, Math.floor(y * gridH / displayH));
      const idx = gy * gridW + gx;
      if (counts[idx] > 0 && (grid[idx] < low || grid[idx] > high)) {
        anomCount++;
      }
    }
  }

  ctx.setLineDash([]);
}

/**
 * Manyetik değeri RGB renge dönüştür (Proton ELIC uyumlu).
 */
function magneticToRgb(value, mid, half) {
  // Jet colormap: Mavi → Cyan → Yeşil → Sarı → Kırmızı
  const t = Math.max(-1, Math.min(1, (value - mid) / (half || 1)));
  const n = (t + 1) / 2; // 0..1

  const stops = [
    { t: 0.00, r: 0, g: 0, b: 128 },
    { t: 0.15, r: 0, g: 0, b: 255 },
    { t: 0.30, r: 0, g: 255, b: 255 },
    { t: 0.45, r: 0, g: 255, b: 0 },
    { t: 0.55, r: 255, g: 255, b: 0 },
    { t: 0.75, r: 255, g: 128, b: 0 },
    { t: 1.00, r: 255, g: 0, b: 0 },
  ];

  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (n >= stops[i].t && n <= stops[i + 1].t) {
      lo = stops[i]; hi = stops[i + 1]; break;
    }
  }
  const f = (hi.t - lo.t) > 0 ? (n - lo.t) / (hi.t - lo.t) : 0;
  return [
    Math.round(lo.r + (hi.r - lo.r) * f),
    Math.round(lo.g + (hi.g - lo.g) * f),
    Math.round(lo.b + (hi.b - lo.b) * f),
  ];
}

/**
 * Binned grid'den istatistik hesapla.
 */
export function computeGridStats(grid, counts, gridW, gridH) {
  let totalPoints = 0;
  let filledCells = 0;
  let magneticSum = 0;
  let magneticMin = Infinity;
  let magneticMax = -Infinity;

  for (let i = 0; i < gridW * gridH; i++) {
    if (counts[i] > 0) {
      totalPoints += counts[i];
      filledCells++;
      magneticSum += grid[i];
      if (grid[i] < magneticMin) magneticMin = grid[i];
      if (grid[i] > magneticMax) magneticMax = grid[i];
    }
  }

  const avg = filledCells > 0 ? magneticSum / filledCells : 0;
  let variance = 0;
  for (let i = 0; i < gridW * gridH; i++) {
    if (counts[i] > 0) {
      variance += (grid[i] - avg) ** 2;
    }
  }
  const stddev = filledCells > 1 ? Math.sqrt(variance / filledCells) : 1;

  if (magneticMin === Infinity) magneticMin = 0;
  if (magneticMax === -Infinity) magneticMax = 0;

  return {
    totalPoints,
    filledCells,
    emptyCells: gridW * gridH - filledCells,
    magneticMin,
    magneticMax,
    mean: avg,
    stddev,
  };
}

/**
 * Heatmap canvas üzerine tıklama/basma pick modu bağla.
 * Tıklanan pikselin en yakın ham CSV noktasını bulur ve tooltip gösterir.
 *
 * @param {HTMLCanvasElement} canvas - Heatmap canvas
 * @param {Array} points - Ham CSV noktaları (x, y, z, magnetic)
 * @param {Object} bounds - { xMin, xMax, yMin, yMax }
 * @param {HTMLDivElement} tooltip - Tooltip div elemanı
 * @param {Object} opts - { gridW, gridH }
 * @returns {Function} Cleanup fonksiyonu
 */
export function bindHeatmapPick(canvas, points, bounds, tooltip, opts = {}) {
  if (!canvas || !points?.length || !tooltip) return () => {};

  const { xMin, xMax, yMin, yMax } = bounds;
  const gridW = opts.gridW || 128;
  const gridH = opts.gridH || 128;
  const xRange = (xMax - xMin) || 1;
  const yRange = (yMax - yMin) || 1;
  const structures = opts.structures || null;
  const structureFilter = opts.structureFilter || null;
  const onStructureClick = opts.onStructureClick || null;
  const normParams = opts.normParams || null; // { scale: {xz, y, z}, center: {x, y, z} }

  // KDS: grid koordinatından en yakın 3-5 noktayı bulmak için noktaları grid hücresine göre grupla
  // Basit yaklaşım: her tıklamada en yakın 5 komşu noktayı bul
  let lastHoverIdx = -1;

  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;   // 0..1
    const py = (e.clientY - rect.top) / rect.height;    // 0..1

    // Canvas pikselinden grid hücresine
    const gx = Math.floor(px * gridW);
    const gy = Math.floor(py * gridH);
    if (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH) {
      tooltip.style.display = 'none';
      return;
    }

    // Grid hücresinden dünya koordinatı
    const cx = xMin + (gx + 0.5) / gridW * xRange;
    const cy = yMin + (gy + 0.5) / gridH * yRange;

    // En yakın 5 noktayı bul (brute-force ama hız yeterli)
    const k = 5;
    const dists = new Float32Array(k);
    const idxs = new Int32Array(k);
    dists.fill(Infinity);

    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - cx;
      const dy = points[i].y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < dists[k - 1]) {
        dists[k - 1] = d2;
        idxs[k - 1] = i;
        // Basit insert-sort
        for (let j = k - 2; j >= 0; j--) {
          if (dists[j] <= dists[j + 1]) break;
          let tmp = dists[j]; dists[j] = dists[j + 1]; dists[j + 1] = tmp;
          let ti = idxs[j]; idxs[j] = idxs[j + 1]; idxs[j + 1] = ti;
        }
      }
    }

    // En yakın noktayı al
    const nearest = idxs[0];
    if (nearest === lastHoverIdx) return; // Hala aynı nokta, güncelleme yok
    lastHoverIdx = nearest;

    const p = points[nearest];
    const rawX = p.x;
    const rawY = p.y;
    const rawZ = p.z;
    const mag = p.magnetic?.toFixed(1) ?? '—';

    // Piksel → metre dönüşümü: ilk 2 hane metre, sonrası ondalık (÷10⁷)
    const toM = (v) => (v / 1e7).toFixed(2);
    const meterInfo = `<span style="color:#88c8a8">  → ${toM(rawX)} × ${toM(rawY)} × ${toM(rawZ)} m</span>`;

    // Diğer komşu noktaları da göster
    let neighborInfo = '';
    for (let j = 1; j < k && idxs[j] >= 0; j++) {
      const q = points[idxs[j]];
      const d = Math.sqrt(dists[j]);
      neighborInfo += `  #${j + 1}  ${d.toFixed(1)}m uzaq · ${q.magnetic?.toFixed(1)} nT\n`;
    }

    tooltip.innerHTML = [
      `<strong style="color:#6aee88">◉ #${nearest + 1}</strong>`,
      `<span style="color:#aaa">X: ${rawX.toFixed(0)}  Y: ${rawY.toFixed(0)}  Z: ${rawZ.toFixed(0)}</span> <span style="color:#6aee88;font-size:0.65rem">(piksel)</span>`,
      meterInfo,
      `Manyetik: <span style="color:${p.magnetic > 0 ? '#e85858' : '#5888e8'}">${mag} nT</span>`,
      neighborInfo ? `<span style="color:#888">${neighborInfo.trim()}</span>` : '',
    ].filter(Boolean).join('\n');

    // Tooltip pozisyonu
    const tipW = tooltip.offsetWidth || 180;
    const tipH = tooltip.offsetHeight || 80;
    let tx = e.clientX + 12;
    let ty = e.clientY - tipH - 8;
    if (tx + tipW > window.innerWidth - 10) tx = e.clientX - tipW - 12;
    if (ty < 10) ty = e.clientY + 16;
    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';
    tooltip.style.display = '';
  }

  function onLeave() {
    tooltip.style.display = 'none';
    lastHoverIdx = -1;
  }

  /**
   * Tıklama: yakındaki en yakın yapıyı bul (oda/tünel/metal)
   */
  function onClick(e) {
    if (!structures || !onStructureClick) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const clickX = xMin + px * xRange;
    const clickZ = yMin + py * yRange;

    let best = null, bestDist = Infinity;

    // Oda
    if (!structureFilter || structureFilter.chamber !== false) {
      for (const ch of (structures.chambers || [])) {
        const cx = Number(ch.cx) || 0, cz = Number(ch.cy) || 0;
        const d = Math.hypot(cx - clickX, cz - clickZ);
        if (d < bestDist) { bestDist = d; best = { type: 'oda', data: ch, dist: d }; }
      }
    }
    // Tünel
    if (!structureFilter || structureFilter.tunnel !== false) {
      for (const t of (structures.tunnels || [])) {
        const x0 = Number(t.x0) || 0, z0 = Number(t.y0) || 0;
        const x1 = Number(t.x1) || 0, z1 = Number(t.y1) || 0;
        // Nokta → doğru aralıksal mesafe
        const dx = x1 - x0, dz = z1 - z0;
        const lenSq = dx * dx + dz * dz;
        let frac = lenSq > 0 ? Math.max(0, Math.min(1, ((clickX - x0) * dx + (clickZ - z0) * dz) / lenSq)) : 0;
        const projX = x0 + frac * dx, projZ = z0 + frac * dz;
        const d = Math.hypot(clickX - projX, clickZ - projZ);
        if (d < bestDist) { bestDist = d; best = { type: 'tünel', data: t, dist: d }; }
      }
    }
    // Metal
    if (!structureFilter || structureFilter.metal !== false) {
      for (const m of (structures.metals || [])) {
        const mx = Number(m.cx) || 0, mz = Number(m.cy) || 0;
        const d = Math.hypot(mx - clickX, mz - clickZ);
        if (d < bestDist) { bestDist = d; best = { type: 'metal', data: m, dist: d }; }
      }
    }

    // Eşik: canvas genişliğinin %15'inden yakınsa kabul et
    const thresholdM = Math.max(xRange, yRange) * 0.15;
    if (best && bestDist < thresholdM) {
      onStructureClick(best);
    } else {
      onStructureClick(null); // Boş alana tıklandı — paneli temizle
    }
  }

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);
  canvas.style.cursor = 'crosshair';

  return () => {
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseleave', onLeave);
    canvas.removeEventListener('click', onClick);
    canvas.style.cursor = '';
    tooltip.style.display = 'none';
  };
}

/**
 * Binned grid'i canvas'a legend (renk çubuğu) çizer.
 */
export function renderLegend(canvas, mMin, mMax, width, height) {
  if (!canvas) return;
  canvas.width = width || 20;
  canvas.height = height || 200;
  const ctx = canvas.getContext('2d');
  const h = canvas.height;
  const mMid = (mMax + mMin) / 2;
  const mHalf = Math.max(Math.abs(mMax - mMid), Math.abs(mMid - mMin), 1);

  for (let y = 0; y < h; y++) {
    const t = 1 - y / h;
    const val = mMin + t * (mMax - mMin);
    const color = magneticToRgb(val, mMid, mHalf);
    ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    ctx.fillRect(0, y, canvas.width, 1);
  }
}

/**
 * Heatmap canvas üzerine yapı tespitlerini sembol + etiket olarak çiz.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D bağlamı (renderHeatmapCanvas sonrası)
 * @param {Object} structures - { chambers: [], tunnels: [], metals: [] }
 * @param {Object} bounds - { xMin, xMax, zMin, zMax } — harita sınırları
 * @param {number} displayW - Canvas genişliği (piksel)
 * @param {number} displayH - Canvas yüksekliği (piksel)
 * @param {Object} opts - { filter: { chamber, tunnel, metal } }
 */
export function drawStructuresOnHeatmap(ctx, structures, bounds, displayW, displayH, opts = {}) {
  if (!ctx || !structures || !bounds) {
    console.log('[CSV Heatmap] drawStructuresAtlanıyor:', { ctx: !!ctx, structures: !!structures, bounds: !!bounds });
    return;
  }
  const filter = opts.filter;
  const hl = opts.highlight || null;
  const chCount = (structures.chambers || []).length;
  const tuCount = (structures.tunnels || []).length;
  const meCount = (structures.metals || []).length;
  console.log(`[CSV Heatmap] Yapılar çiziliyor: ${chCount} oda, ${tuCount} tünel, ${meCount} metal, canvas: ${displayW}×${displayH}`);

  // Yapılar normalize uzayda (gBounds), heatmap CSV uzayında.
  // Ters dönüşüm: csvX = normX / scale.xz + center.x
  const np = opts.normParams || null; // { scale: {xz}, center: {x, z} }
  const xRange = (bounds.xMax - bounds.xMin) || 1;
  const zRange = (bounds.zMax - bounds.zMin) || 1;

  const toPixel = (cx, cz) => {
    // Normalize → CSV dönüşümü
    let csvX = cx, csvZ = cz;
    if (np && np.scale && np.center) {
      csvX = cx / (np.scale.xz || 1) + (np.center.x || 0);
      csvZ = cz / (np.scale.z || np.scale.xz || 1) + (np.center.z || 0);
    }
    const px = ((csvX - bounds.xMin) / xRange) * displayW;
    const py = ((csvZ - bounds.zMin) / zRange) * displayH;
    return { px, py };
  };

  // Boyutları da normalize → metre çevir
  const toMeters = (v) => np?.scale?.xz ? v / np.scale.xz : v;

  let num = 1;

  // ── ODA (mavi kare) ──
  if (!filter || filter.chamber !== false) {
    for (const ch of (structures.chambers || [])) {
      if (ch.kind === 'cavity') continue;
      const cx = Number(ch.cx) || 0;
      const cz = Number(ch.cy) || 0;
      const wM = toMeters(Number(ch.widthM) || 2);
      const lM = toMeters(Number(ch.lengthM) || wM);
      const topM = Number(ch.topFromSurfaceM) || 0.4;
      const botM = Number(ch.bottomFromSurfaceM) || topM + 2.5;
      const { px, py } = toPixel(cx, cz);

      // Boyutu piksele çevir
      const sw = Math.max(10, (wM / xRange) * displayW);
      const sh = Math.max(10, (lM / zRange) * displayH);

      // Doldurulmuş kare
      ctx.fillStyle = 'rgba(100, 160, 255, 0.55)';
      ctx.fillRect(px - sw / 2, py - sh / 2, sw, sh);

      // Kenar
      ctx.strokeStyle = '#7eb6ff';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(px - sw / 2, py - sh / 2, sw, sh);

      // Vurgu halkası
      if (hl && hl.type === 'chamber' && hl.idx === num - 1) {
        drawHighlightRing(ctx, px, py, Math.max(sw, sh) * 0.8, '#7eb6ff');
      }

      // Etiket
      const label = `O${num}`;
      const depthLabel = `${topM.toFixed(1)}–${botM.toFixed(1)}m`;
      drawLabel(ctx, px, py - sh / 2 - 20, label, '#7eb6ff', depthLabel);
      num++;
    }
  }

  // ── TÜNEL (camgöbeği çizgi) ──
  if (!filter || filter.tunnel !== false) {
    for (const t of (structures.tunnels || [])) {
      const x0 = Number(t.x0) || 0, z0 = Number(t.y0) || 0;
      const x1 = Number(t.x1) || 0, z1 = Number(t.y1) || 0;
      const depth = Number(t.floorFromSurfaceM) || 2;
      const wM = toMeters(Number(t.widthM) || 1.2);
      const p0 = toPixel(x0, z0);
      const p1 = toPixel(x1, z1);

      // Kalın çizgi
      ctx.beginPath();
      ctx.moveTo(p0.px, p0.py);
      ctx.lineTo(p1.px, p1.py);
      ctx.strokeStyle = '#4ec0d4';
      ctx.lineWidth = Math.max(4, (wM / xRange) * displayW);
      ctx.stroke();

      // Uç noktaları daire
      for (const p of [p0, p1]) {
        ctx.beginPath();
        ctx.arc(p.px, p.py, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#4ec0d4';
        ctx.fill();
      }

      // Vurgu halkası
      if (hl && hl.type === 'tunnel' && hl.idx === num - 1) {
        const mx = (p0.px + p1.px) / 2;
        const my = (p0.py + p1.py) / 2;
        drawHighlightRing(ctx, mx, my, 16, '#4ec0d4');
      }

      // Etiket orta noktada
      const mx = (p0.px + p1.px) / 2;
      const my = (p0.py + p1.py) / 2;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const label = `T${num}`;
      const depthLabel = `${depth.toFixed(1)}m · ${len.toFixed(1)}m`;
      drawLabel(ctx, mx, my - 16, label, '#4ec0d4', depthLabel);
      num++;
    }
  }

  // ── METAL (kırmızı elmas) ──
  if (!filter || filter.metal !== false) {
    for (const m of (structures.metals || [])) {
      const cx = Number(m.cx) || 0;
      const cz = Number(m.cy) || 0;
      const depth = Number(m.depthFromSurfaceM) || 1;
      const wM = toMeters(Number(m.widthM) || 1.2);
      const { px, py } = toPixel(cx, cz);
      const sz = Math.max(8, (wM / xRange) * displayW * 0.8);

      // Elmas (döndürülmüş kare)
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(220, 80, 60, 0.6)';
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
      ctx.strokeStyle = '#ff6a4a';
      ctx.lineWidth = 2;
      ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
      ctx.restore();

      // Vurgu halkası
      if (hl && hl.type === 'metal' && hl.idx === num - 1) {
        drawHighlightRing(ctx, px, py, sz * 0.9, '#ff6a4a');
      }

      // Etiket
      const label = `M${num}`;
      const depthLabel = `${depth.toFixed(1)}m`;
      drawLabel(ctx, px + sz * 0.9, py - sz * 0.5 - 8, label, '#ff6a4a', depthLabel);
      num++;
    }
  }
}

/**
 * Vurgu halkası çiz — seçili yapının etrafında parlayan halka.
 */
function drawHighlightRing(ctx, x, y, radius, color) {
  ctx.save();
  // Dış halo
  ctx.beginPath();
  ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.25;
  ctx.stroke();
  // İç halka
  ctx.beginPath();
  ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.7;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Yapı etiketi çiz: başlık + alt bilgi (derinlik/boyut).
 */
function drawLabel(ctx, x, y, title, color, sub) {
  ctx.save();
  const titleSize = 14;
  const subSize = 11;
  ctx.font = `bold ${titleSize}px monospace`;
  ctx.textAlign = 'center';
  const tw = ctx.measureText(title).width;
  const sw = sub ? ctx.measureText(sub).width : 0;
  const bgW = Math.max(tw, sw) + 8;
  const bgH = sub ? titleSize + subSize + 6 : titleSize + 4;
  // Arka plan pill
  ctx.fillStyle = 'rgba(18, 18, 26, 0.82)';
  const rx = x - bgW / 2, ry = y - titleSize - 2;
  ctx.beginPath();
  ctx.roundRect(rx, ry, bgW, bgH, 4);
  ctx.fill();
  // Kenar
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // Başlık
  ctx.fillStyle = color;
  ctx.fillText(title, x, y);
  if (sub) {
    ctx.font = `${subSize}px monospace`;
    ctx.fillStyle = 'rgba(220, 230, 220, 0.9)';
    ctx.fillText(sub, x, y + subSize + 1);
  }
  ctx.restore();
}
