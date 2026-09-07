/**
 * Votex Mobile - WASM Bridge
 * Loads the Rust analysis core (votex-wasm) with graceful JS fallback.
 *
 * The WASM module is the same algorithm as the desktop Tauri backend
 * (vision.rs): HSV → LUT match → connected-component anomaly detection.
 * If WASM fails to load (old browser, missing file), the JS analyzer
 * in analyzer.js is used instead.
 */

// State
let _wasmModule = null;
let _wasmReady = false;
let _wasmFailed = false;
let _initPromise = null;

/**
 * Initialize WASM module (idempotent, safe to call multiple times)
 */
async function initWasm() {
  if (_wasmReady) return true;
  if (_wasmFailed) return false;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      // Resolve relative to document base — dynamic import inside /js/ would
      // otherwise resolve against the module's own directory (/js/wasm/...) and 404.
      const wasmUrl = new URL('wasm/votex_wasm.js', document.baseURI).href;
      const wasm = await import(wasmUrl);
      await wasm.default();
      _wasmModule = wasm;
      _wasmReady = true;
      console.log('[VotexWASM] Ready — version', wasm.version());
      return true;
    } catch (err) {
      _wasmFailed = true;
      console.warn('[VotexWASM] Load failed, using JS fallback:', err?.message || err);
      return false;
    }
  })();

  return _initPromise;
}

/**
 * Check if WASM is available
 */
function isWasmReady() {
  return _wasmReady;
}

/**
 * Run colormap anomaly analysis.
 * Uses WASM when available; returns null so the caller can fall back to JS.
 *
 * @param {ImageData} imageData — from canvas getImageData()
 * @param {object} opts — { lutStripPx, minArea, threshold }
 * @returns {object|null} — { width, height, anomalies: [...] } or null
 */
function analyzeColormap(imageData, opts = {}) {
  if (!_wasmReady || !_wasmModule) return null;

  try {
    const result = _wasmModule.analyze_colormap(
      imageData.data,
      imageData.width,
      imageData.height,
      opts.lutStripPx ?? 24,
      opts.minArea ?? 80,
      opts.threshold ?? 0.35
    );
    return JSON.parse(result.json);
  } catch (err) {
    console.warn('[VotexWASM] analyze_colormap failed:', err?.message || err);
    return null;
  }
}

/**
 * Run fast image statistics via WASM. Returns null on failure.
 *
 * @param {ImageData} imageData
 * @returns {object|null} — { mean, min, max, stdDev, entropy } or null
 */
function imageStats(imageData) {
  if (!_wasmReady || !_wasmModule) return null;

  try {
    return JSON.parse(_wasmModule.image_stats(imageData.data));
  } catch (err) {
    console.warn('[VotexWASM] image_stats failed:', err?.message || err);
    return null;
  }
}

/**
 * Build the 3D surface field (heights + colors grid) via WASM.
 * Same core as desktop `colormap_to_surface` field stage.
 * Returns null so the caller can fall back gracefully.
 *
 * @param {ImageData} imageData — cleaned image (no LUT strip)
 * @param {object} opts — { gridW, gridH } (default 96×96, clamped 16..256)
 * @returns {object|null} — { gridW, gridH, zMin, zMax, heights: Float32Array, colors: Uint8Array }
 */
function buildSurfaceField(imageData, opts = {}) {
  if (!_wasmReady || !_wasmModule) return null;

  try {
    const result = _wasmModule.build_surface_field(
      imageData.data,
      imageData.width,
      imageData.height,
      opts.gridW ?? 96,
      opts.gridH ?? 96
    );
    const parsed = JSON.parse(result.json);
    return {
      gridW: parsed.gridW,
      gridH: parsed.gridH,
      zMin: parsed.zMin,
      zMax: parsed.zMax,
      heights: Float32Array.from(parsed.heights),
      colors: Uint8Array.from(parsed.colors)
    };
  } catch (err) {
    console.warn('[VotexWASM] build_surface_field failed:', err?.message || err);
    return null;
  }
}

/**
 * Convert WASM anomalies to the JS analyzer's structure format
 * so renderResults can display them uniformly.
 */
function anomaliesToStructures(wasmResult) {
  if (!wasmResult || !Array.isArray(wasmResult.anomalies)) return null;

  return wasmResult.anomalies.map((a) => ({
    type: a.class === 'positive' ? 'Pozitif Anomali (Metal)' : 'Negatif Anomali (Boşluk)',
    class: a.class,
    cx: a.cx,
    cy: a.cy,
    area: a.area,
    intensity: a.intensity,
    bbox: { x: a.x, y: a.y, w: a.w, h: a.h },
  }));
}

/**
 * Classify WASM anomalies into structure types for 3D markers.
 * Uses bbox aspect ratio — same heuristic as the desktop Tauri parser.
 *
 * Classification rules (from src-tauri parser + structures/classify.rs):
 *   aspect ratio > 2.0  → tunnel (elongated corridor)
 *   h / w > 1.6         → shaft  (vertical well/vent)
 *   otherwise            → room   (compact chamber/tomb)
 *
 * @param {object|null} wasmResult — from analyzeColormap()
 * @param {object|null} imageDims  — { width, height } of source image
 * @returns {Array|null} — [{ kind, label, cx, cy, rx, ry, intensity, bbox }]
 */
function classifyStructures(wasmResult, imageDims) {
  if (!wasmResult || !Array.isArray(wasmResult.anomalies) || !imageDims) return null;

  const imgW = imageDims.width || 1;
  const imgH = imageDims.height || 1;

  return wasmResult.anomalies.map((a, i) => {
    const bw = Math.max(a.w, 1);
    const bh = Math.max(a.h, 1);
    const aspect = bw / bh;
    const invAspect = bh / bw;

    let kind, label;
    if (aspect > 2.0) {
      kind = 'tunnel';
      label = `${i + 1}. Tünel / Koridor`;
    } else if (invAspect > 1.6) {
      kind = 'shaft';
      label = `${i + 1}. Şaft / Kuyu`;
    } else {
      kind = a.class === 'positive' ? 'metal' : 'room';
      label = a.class === 'positive'
        ? `${i + 1}. Metal Anomali`
        : `${i + 1}. Oda / Mezar`;
    }

    return {
      kind,
      label,
      class: a.class,
      // Normalized center (0–1 relative to image)
      cx: a.cx / imgW,
      cy: a.cy / imgH,
      // Normalized half-extents (0–1)
      rx: (bw / 2) / imgW,
      ry: (bh / 2) / imgH,
      intensity: a.intensity,
      bbox: { x: a.x, y: a.y, w: a.w, h: a.h },
    };
  });
}

/**
 * Detect wall cues and extract green-line tunnel segments via WASM.
 * Same core as desktop `preprocess.rs::detect_wall_cues` +
 * `extract_green_line_segments`.
 *
 * @param {ImageData} imageData
 * @returns {object|null} — { cues: [...], segments: [...] } or null
 */
function detectWallCues(imageData) {
  if (!_wasmReady || !_wasmModule) return null;

  try {
    const result = _wasmModule.detect_wall_cues(
      imageData.data,
      imageData.width,
      imageData.height
    );
    return JSON.parse(result.json);
  } catch (err) {
    console.warn('[VotexWASM] detect_wall_cues failed:', err?.message || err);
    return null;
  }
}

// Export
window.VotexWasm = {
  init: initWasm,
  isReady: isWasmReady,
  analyzeColormap,
  imageStats,
  buildSurfaceField,
  anomaliesToStructures,
  classifyStructures,
  detectWallCues,
};
