/**
 * Votex Mobile - Analyzer Benchmark
 * Compares WASM (Rust core) vs JS analyzer performance on synthetic
 * large maps. Fair comparison: same algorithm domain (colormap anomaly
 * detection), same input, warm-up runs, median of N iterations.
 */

// ── Synthetic ELIC-style map generator ─────────────────────

/**
 * Generate a synthetic colormap map:
 * left LUT strip + green ground + random positive/negative blobs.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} blobCount
 * @param {number} lutStripPx
 * @returns {ImageData}
 */
function generateSyntheticMap(width, height, blobCount = 24, lutStripPx = 24) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Green ground
  ctx.fillStyle = 'rgb(34,180,70)';
  ctx.fillRect(0, 0, width, height);

  // LUT strip: red → white → blue vertical gradient
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, 'rgb(220,40,30)');
  grad.addColorStop(0.5, 'rgb(240,240,220)');
  grad.addColorStop(1, 'rgb(25,45,190)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, lutStripPx, height);

  // Random blobs (deterministic-ish via simple LCG for reproducibility)
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let i = 0; i < blobCount; i++) {
    const positive = rand() > 0.5;
    const bw = 20 + Math.floor(rand() * 80);
    const bh = 20 + Math.floor(rand() * 80);
    const bx = lutStripPx + 4 + Math.floor(rand() * Math.max(1, width - lutStripPx - 4 - bw));
    const by = Math.floor(rand() * Math.max(1, height - bh));
    ctx.fillStyle = positive ? 'rgb(220,40,30)' : 'rgb(25,45,190)';
    ctx.fillRect(bx, by, bw, bh);
  }

  return ctx.getImageData(0, 0, width, height);
}

// ── JS reference implementation (same algorithm as WASM) ───

/**
 * JS port of analyze_colormap — mirrors votex-wasm/src/lib.rs.
 * Kept here so both engines run identical work in the benchmark.
 */
function jsAnalyzeColormap(imageData, lutStripPx = 24, minArea = 80, matchThreshold = 0.35) {
  const rgba = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  if (width < 40 || height < 20) return null;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const strip = clamp(lutStripPx, 8, 40);

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    const v = max;
    const s = max <= 1e-6 ? 0 : d / max;
    let h = 0;
    if (d > 1e-6) {
      if (Math.abs(max - r) < 1e-6) h = 60 * (((g - b) / d) % 6);
      else if (Math.abs(max - g) < 1e-6) h = 60 * (((b - r) / d) + 2);
      else h = 60 * (((r - g) / d) + 4);
    }
    if (h < 0) h += 360;
    return { h, s, v };
  }

  function hsvDist(a, b) {
    let dh = Math.abs(a.h - b.h);
    if (dh > 180) dh = 360 - dh;
    return (dh / 180) ** 2 + (a.s - b.s) ** 2 * 0.5 + (a.v - b.v) ** 2 * 0.35;
  }

  const isGreenish = (h, s, v) => s > 0.15 && v > 0.15 && h >= 70 && h <= 170;

  // LUT
  const lut = new Array(height);
  for (let y = 0; y < height; y++) {
    let rs = 0, gs = 0, bs = 0;
    for (let x = 0; x < strip; x++) {
      const p = (y * width + x) * 4;
      rs += rgba[p]; gs += rgba[p + 1]; bs += rgba[p + 2];
    }
    const n = Math.max(1, strip);
    lut[y] = rgbToHsv(Math.round(rs / n), Math.round(gs / n), Math.round(bs / n));
  }

  const mapX0 = strip + 4;
  const nPx = width * height;
  const signed = new Float32Array(nPx);
  const maskPos = new Uint8Array(nPx);
  const maskNeg = new Uint8Array(nPx);

  for (let y = 0; y < height; y++) {
    for (let x = mapX0; x < width; x++) {
      const p = (y * width + x) * 4;
      const hsv = rgbToHsv(rgba[p], rgba[p + 1], rgba[p + 2]);
      if (isGreenish(hsv.h, hsv.s, hsv.v)) continue;
      let bestI = 0, bestD = Infinity;
      for (let i = 0; i < lut.length; i++) {
        const d = hsvDist(hsv, lut[i]);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestD > matchThreshold) continue;
      const sVal = lut.length <= 1 ? 0 : 1 - 2 * (bestI / (lut.length - 1));
      const i = y * width + x;
      signed[i] = sVal;
      if (sVal > 0.15) maskPos[i] = 1;
      else if (sVal < -0.15) maskNeg[i] = 1;
    }
  }

  // Connected components (4-neighborhood, iterative stack)
  function components(mask, cls) {
    const visited = new Uint8Array(nPx);
    const out = [];
    const stack = [];
    for (let y0 = 0; y0 < height; y0++) {
      for (let x0 = 0; x0 < width; x0++) {
        const start = y0 * width + x0;
        if (mask[start] === 0 || visited[start]) continue;
        stack.length = 0;
        stack.push([x0, y0]);
        visited[start] = 1;
        let cells = 0, sx = 0, sy = 0, sAbs = 0;
        let minX = x0, minY = y0, maxX = x0, maxY = y0;
        while (stack.length) {
          const [x, y] = stack.pop();
          const i = y * width + x;
          cells++; sx += x; sy += y; sAbs += Math.abs(signed[i]);
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          // 4 neighbors
          if (x > 0) { const ni = i - 1; if (mask[ni] && !visited[ni]) { visited[ni] = 1; stack.push([x - 1, y]); } }
          if (x < width - 1) { const ni = i + 1; if (mask[ni] && !visited[ni]) { visited[ni] = 1; stack.push([x + 1, y]); } }
          if (y > 0) { const ni = i - width; if (mask[ni] && !visited[ni]) { visited[ni] = 1; stack.push([x, y - 1]); } }
          if (y < height - 1) { const ni = i + width; if (mask[ni] && !visited[ni]) { visited[ni] = 1; stack.push([x, y + 1]); } }
        }
        if (cells < minArea) continue;
        out.push({
          class: cls,
          cx: sx / cells, cy: sy / cells,
          area: cells, intensity: sAbs / cells,
          x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
        });
      }
    }
    return out;
  }

  const anomalies = [
    ...components(maskPos, 'positive'),
    ...components(maskNeg, 'negative'),
  ];
  return { width, height, anomalies };
}

// ── Timing helpers ──────────────────────────────────────────

function now() {
  return performance.now();
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Run fn `reps` times after `warmup` runs; return median ms.
 */
function timeRun(fn, warmup = 1, reps = 5) {
  for (let i = 0; i < warmup; i++) fn();
  const times = [];
  for (let i = 0; i < reps; i++) {
    const t0 = now();
    fn();
    times.push(now() - t0);
  }
  return median(times);
}

// ── Benchmark orchestration ─────────────────────────────────

/**
 * Default test sizes: 1 MP, 4 MP, 12 MP ("large maps").
 */
const DEFAULT_SIZES = [
  { label: '1 MP', width: 1200, height: 850 },
  { label: '4 MP', width: 2400, height: 1700 },
  { label: '12 MP', width: 4600, height: 2600 },
];

/**
 * Run the full benchmark suite.
 *
 * @param {object} opts — { sizes, warmup, reps, onProgress }
 * @returns {Promise<object>} results
 */
async function runBenchmark(opts = {}) {
  const sizes = opts.sizes || DEFAULT_SIZES;
  const warmup = opts.warmup ?? 1;
  const reps = opts.reps ?? 5;
  const onProgress = opts.onProgress || (() => {});

  const wasmAvailable = await VotexWasm.init();
  const rows = [];

  for (const size of sizes) {
    onProgress(`${size.label} harita oluşturuluyor...`);
    // Yield to UI before each heavy step
    await new Promise(r => setTimeout(r, 0));

    const imageData = generateSyntheticMap(size.width, size.height);
    const pixels = size.width * size.height;

    onProgress(`${size.label} JS analiz ediliyor...`);
    await new Promise(r => setTimeout(r, 0));
    const jsMs = timeRun(() => jsAnalyzeColormap(imageData), warmup, reps);

    let wasmMs = null;
    let wasmAnomalies = null;
    if (wasmAvailable) {
      onProgress(`${size.label} WASM analiz ediliyor...`);
      await new Promise(r => setTimeout(r, 0));
      wasmMs = timeRun(() => {
        const r = VotexWasm.analyzeColormap(imageData, { lutStripPx: 24, minArea: 80, threshold: 0.35 });
        wasmAnomalies = r ? r.anomalies.length : null;
      }, warmup, reps);
    }

    // Sanity: same anomaly counts (deterministic input)
    const jsAnomalies = jsAnalyzeColormap(imageData).anomalies.length;

    rows.push({
      label: size.label,
      pixels,
      jsMs: +jsMs.toFixed(1),
      wasmMs: wasmMs != null ? +wasmMs.toFixed(1) : null,
      speedup: wasmMs != null ? +(jsMs / wasmMs).toFixed(1) : null,
      jsAnomalies,
      wasmAnomalies,
      match: wasmAnomalies != null ? jsAnomalies === wasmAnomalies : null,
    });
  }

  return {
    rows,
    wasmAvailable,
    userAgent: navigator.userAgent,
    deviceMemory: navigator.deviceMemory || null,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Render benchmark results into the panel.
 */
function renderBenchmark(results) {
  const panel = document.getElementById('benchmark-panel');
  const body = document.getElementById('benchmark-rows');
  if (!panel || !body) return;

  const envBits = [
    results.wasmAvailable ? 'WASM ✓' : 'WASM ✗',
    results.hardwareConcurrency ? `${results.hardwareConcurrency} çekirdek` : null,
  ].filter(Boolean).join(' · ');

  const rowsHtml = results.rows.map(r => `
    <div class="bench-row">
      <div class="bench-size">${r.label}</div>
      <div class="bench-cell">${r.jsMs} ms<span class="bench-sub">JS</span></div>
      <div class="bench-cell">${r.wasmMs != null ? r.wasmMs + ' ms' : '—'}<span class="bench-sub">WASM</span></div>
      <div class="bench-cell bench-speed ${r.speedup >= 1 ? 'bench-win' : 'bench-lose'}">${r.speedup != null ? r.speedup + '×' : '—'}<span class="bench-sub">hız</span></div>
      <div class="bench-cell bench-match" title="JS: ${r.jsAnomalies}, WASM: ${r.wasmAnomalies}">${r.match == null ? '—' : (r.match ? '✓' : '✗')}</div>
    </div>
  `).join('');

  body.innerHTML = `
    <div class="bench-env">${envBits}</div>
    <div class="bench-row bench-head">
      <div class="bench-size">Harita</div>
      <div class="bench-cell">JS</div>
      <div class="bench-cell">WASM</div>
      <div class="bench-cell">Kazanç</div>
      <div class="bench-cell">Eş</div>
    </div>
    ${rowsHtml}
  `;

  panel.classList.remove('hidden');
}

// Export
window.VotexBenchmark = {
  runBenchmark,
  renderBenchmark,
  generateSyntheticMap,
  jsAnalyzeColormap,
  DEFAULT_SIZES,
};
