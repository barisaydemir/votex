/**
 * Votex Mobile - Anomaly Overlay
 * Draws WASM-detected anomaly bounding boxes on the map preview with
 * color-coded classes, matching the desktop backend's overlay colors:
 *   positive (metal) → red, negative (void) → blue.
 *
 * Handles the object-fit:contain letterboxing so boxes align exactly
 * with the visible image area regardless of canvas/screen aspect ratio.
 */

// State
let _anomalies = [];
let _sourceSize = { width: 0, height: 0 };
let _visible = true;

// DOM
// Not: _previewImg adı colorizer.js tarafından kullanılıyor; klasik script
// global kapsamında çakışmayı önlemek için _ovPreview adı kullanılır.
let _canvas = null;
let _ctx = null;
let _ovPreview = null;
let _legend = null;
let _toggleBtn = null;

// Colors per anomaly class (same as Rust draw_overlay)
const CLASS_STYLE = {
  positive: { stroke: '#ff2828', fill: 'rgba(255, 40, 40, 0.14)', label: 'Pozitif (Metal)' },
  negative: { stroke: '#2850ff', fill: 'rgba(40, 80, 255, 0.14)', label: 'Negatif (Boşluk)' },
};

/**
 * Initialize overlay module
 */
function initOverlay() {
  _canvas = document.getElementById('anomaly-canvas');
  _ovPreview = document.getElementById('preview');
  _legend = document.getElementById('anomaly-legend');
  _toggleBtn = document.getElementById('btn-anomaly-toggle');

  if (!_canvas) return;
  _ctx = _canvas.getContext('2d');

  if (_toggleBtn) {
    _toggleBtn.addEventListener('click', toggleVisibility);
  }

  // Redraw on resize (letterbox geometry changes)
  window.addEventListener('resize', () => {
    if (_anomalies.length > 0) draw(_anomalies, _sourceSize);
  });
}

/**
 * Compute the on-screen image rect inside the preview-wrap,
 * accounting for object-fit:contain letterboxing.
 */
function computeImageRect() {
  const wrap = _canvas.parentElement; // preview-wrap
  const wrapW = wrap.clientWidth;
  const wrapH = wrap.clientHeight;
  const imgW = _sourceSize.width || wrapW;
  const imgH = _sourceSize.height || wrapH;

  const scale = Math.min(wrapW / imgW, wrapH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const offX = (wrapW - drawW) / 2;
  const offY = (wrapH - drawH) / 2;

  return { offX, offY, scale };
}

/**
 * Draw anomaly bounding boxes.
 *
 * @param {Array} anomalies — WASM result anomalies [{class,x,y,w,h,cx,cy,area,intensity}]
 * @param {object} sourceSize — { width, height } of the analyzed source image
 */
function draw(anomalies, sourceSize) {
  if (!_canvas || !_ctx) return;

  _anomalies = anomalies || [];
  _sourceSize = sourceSize || _sourceSize;

  // Size canvas to its on-screen CSS size (crisp on HiDPI)
  const dpr = window.devicePixelRatio || 1;
  const wrap = _canvas.parentElement;
  const cssW = wrap.clientWidth;
  const cssH = wrap.clientHeight;
  _canvas.width = Math.round(cssW * dpr);
  _canvas.height = Math.round(cssH * dpr);
  _canvas.style.width = cssW + 'px';
  _canvas.style.height = cssH + 'px';

  const { offX, offY, scale } = computeImageRect();

  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _ctx.clearRect(0, 0, cssW, cssH);
  if (_anomalies.length === 0) {
    updateLegend();
    return;
  }

  const lineWidth = Math.max(1.5, 2 * scale);

  for (const a of _anomalies) {
    const style = CLASS_STYLE[a.class] || CLASS_STYLE.positive;

    const x = offX + a.x * scale;
    const y = offY + a.y * scale;
    const w = a.w * scale;
    const h = a.h * scale;

    // Fill + stroke bbox
    _ctx.fillStyle = style.fill;
    _ctx.strokeStyle = style.stroke;
    _ctx.lineWidth = lineWidth;
    _ctx.fillRect(x, y, w, h);
    _ctx.strokeRect(x, y, w, h);

    // Center crosshair (like Rust draw_overlay)
    const cx = offX + a.cx * scale;
    const cy = offY + a.cy * scale;
    const arm = Math.max(4, 5 * scale);
    _ctx.beginPath();
    _ctx.moveTo(cx - arm, cy);
    _ctx.lineTo(cx + arm, cy);
    _ctx.moveTo(cx, cy - arm);
    _ctx.lineTo(cx, cy + arm);
    _ctx.stroke();

    // Label chip
    const label = `${a.class === 'positive' ? '+' : '−'} ${a.area}px`;
    _ctx.font = `${Math.max(10, Math.round(11 * Math.min(1, scale * 2)))}px -apple-system, sans-serif`;
    const tw = _ctx.measureText(label).width;
    const pad = 3;
    const chipH = 16;
    const chipY = y - chipH - 2 > 0 ? y - chipH - 2 : y + 2;
    _ctx.fillStyle = style.stroke;
    _ctx.fillRect(x, chipY, tw + pad * 2, chipH);
    _ctx.fillStyle = '#0a0e17';
    _ctx.fillText(label, x + pad, chipY + chipH - 4);
  }

  updateLegend();
}

/**
 * Clear the overlay.
 */
function clear() {
  _anomalies = [];
  if (_ctx && _canvas) {
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
  }
  updateLegend();
}

/**
 * Toggle overlay visibility.
 */
function toggleVisibility() {
  _visible = !_visible;
  if (_canvas) {
    _canvas.style.display = _visible ? 'block' : 'none';
  }
  if (_toggleBtn) {
    _toggleBtn.classList.toggle('active', _visible);
  }
}

/**
 * Show/hide legend with per-class counts.
 */
function updateLegend() {
  if (!_legend) return;

  const pos = _anomalies.filter(a => a.class === 'positive').length;
  const neg = _anomalies.filter(a => a.class === 'negative').length;

  if (_anomalies.length === 0) {
    _legend.classList.add('hidden');
    return;
  }

  _legend.classList.remove('hidden');
  _legend.innerHTML =
    (pos > 0 ? `<span class="legend-item legend-pos">■ ${pos} Pozitif</span>` : '') +
    (neg > 0 ? `<span class="legend-item legend-neg">■ ${neg} Negatif</span>` : '');
}

/**
 * Get current anomalies.
 */
function getAnomalies() {
  return _anomalies;
}

/**
 * Check overlay visibility.
 */
function isVisible() {
  return _visible;
}

// Export
window.VotexOverlay = {
  init: initOverlay,
  draw,
  clear,
  toggleVisibility,
  getAnomalies,
  isVisible,
};
