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

// Export
window.VotexWasm = {
  init: initWasm,
  isReady: isWasmReady,
  analyzeColormap,
  imageStats,
  anomaliesToStructures,
};
