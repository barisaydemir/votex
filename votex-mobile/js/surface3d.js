/**
 * Votex Mobile - 3D Surface Preview
 * Renders the WASM-built heights grid as a shaded 2.5D terrain on a canvas.
 * Painter's algorithm (back-to-front rows) + simple lambert shading —
 * lightweight alternative to Three.js for the phone.
 *
 * Colors come from the analysis grid (source map colors), heights from
 * the same field pipeline as the desktop 3D view.
 */

// State
let _surface = null; // { gridW, gridH, zMin, zMax, heights, colors }
let _rotation = 0; // radians around Z
let _tilt = 0.9; // camera tilt (0 = top-down, ~1.2 = oblique)
let _zoom = 1.0;

// DOM
// Not: _canvas/_ctx adları overlay.js ile çakışır (klasik script global kapsam);
// bu modül _s3d_ öneki kullanır.
let _s3d_canvas = null;
let _s3d_ctx = null;
let _panel = null;

/**
 * Initialize the 3D preview panel
 */
function initSurface3D() {
  _s3d_canvas = document.getElementById('surface3d-canvas');
  _panel = document.getElementById('surface3d-panel');

  if (!_s3d_canvas) return;
  _s3d_ctx = _s3d_canvas.getContext('2d');

  const closeBtn = document.getElementById('btn-surface3d-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', hide);
  }

  // Drag to rotate
  let dragging = false;
  let lastX = 0;
  _s3d_canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    _s3d_canvas.setPointerCapture(e.pointerId);
  });
  _s3d_canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    _rotation += (e.clientX - lastX) * 0.01;
    lastX = e.clientX;
    render();
  });
  const stop = () => { dragging = false; };
  _s3d_canvas.addEventListener('pointerup', stop);
  _s3d_canvas.addEventListener('pointercancel', stop);

  // Wheel to zoom
  _s3d_canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    _zoom = Math.min(3, Math.max(0.5, _zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    render();
  }, { passive: false });
}

/**
 * Set surface data and show the panel
 */
function show(surface) {
  if (!surface || !_s3d_canvas) return;
  _surface = surface;
  _rotation = 0;
  _zoom = 1.0;
  if (_panel) _panel.classList.remove('hidden');
  // Size canvas to panel then render
  requestAnimationFrame(() => {
    const dpr = window.devicePixelRatio || 1;
    const rect = _s3d_canvas.parentElement.getBoundingClientRect();
    _s3d_canvas.width = Math.round(rect.width * dpr);
    _s3d_canvas.height = Math.round(Math.min(rect.width * 0.75, 420) * dpr);
    _s3d_canvas.style.width = rect.width + 'px';
    _s3d_canvas.style.height = Math.min(rect.width * 0.75, 420) + 'px';
    render();
  });
}

/**
 * Hide the panel
 */
function hide() {
  if (_panel) _panel.classList.add('hidden');
}

/**
 * Render the terrain
 */
function render() {
  if (!_surface || !_s3d_ctx) return;

  const { gridW, gridH, heights, colors } = _surface;
  const dpr = window.devicePixelRatio || 1;
  const W = _s3d_canvas.width;
  const H = _s3d_canvas.height;

  _s3d_ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = W / dpr;
  const h = H / dpr;

  // Background
  _s3d_ctx.fillStyle = '#0a0e17';
  _s3d_ctx.fillRect(0, 0, w, h);

  // Projection setup
  const cx = w / 2;
  const cy = h * 0.52;
  const scale = Math.min(w, h) / (Math.max(gridW, gridH) * 1.25) * _zoom;
  const zScale = Math.min(gridW, gridH) * 0.28 * scale; // height exaggeration
  const cosR = Math.cos(_rotation);
  const sinR = Math.sin(_rotation);
  const tiltC = Math.cos(_tilt);
  const tiltS = Math.sin(_tilt);

  const project = (gx, gy, gz) => {
    // Grid center → origin
    const x0 = (gx - gridW / 2) * scale;
    const y0 = (gy - gridH / 2) * scale;
    // Rotate around Z
    const xr = x0 * cosR - y0 * sinR;
    const yr = x0 * sinR + y0 * cosR;
    // Tilt (oblique view)
    const yT = yr * tiltC - gz * zScale * tiltS;
    const zT = yr * tiltS + gz * zScale * tiltC;
    return { x: cx + xr, y: cy + yT, depth: zT };
  };

  const zRange = Math.max(1e-6, _surface.zMax - _surface.zMin);

  // Painter's algorithm: draw rows back-to-front relative to rotation.
  // Simple approach: iterate gy from far to near (depends on rotation quadrant;
  // for the default view drawing gy ascending works, rotation is small).
  for (let gy = 0; gy < gridH - 1; gy++) {
    for (let gx = 0; gx < gridW - 1; gx++) {
      const i00 = gy * gridW + gx;
      const i10 = i00 + 1;
      const i01 = (gy + 1) * gridW + gx;
      const i11 = i01 + 1;

      const z00 = (heights[i00] - _surface.zMin) / zRange;
      const z10 = (heights[i10] - _surface.zMin) / zRange;
      const z01 = (heights[i01] - _surface.zMin) / zRange;
      const z11 = (heights[i11] - _surface.zMin) / zRange;

      const p00 = project(gx, gy, z00);
      const p10 = project(gx + 1, gy, z10);
      const p01 = project(gx, gy + 1, z01);
      const p11 = project(gx + 1, gy + 1, z11);

      // Color: source map color modulated by lambert-ish shading
      const ci = i00 * 3;
      let r = colors[ci];
      let g = colors[ci + 1];
      let b = colors[ci + 2];

      // Shade from height (higher = brighter)
      const shade = 0.55 + 0.45 * z00;
      r = Math.min(255, r * shade);
      g = Math.min(255, g * shade);
      b = Math.min(255, b * shade);

      _s3d_ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      _s3d_ctx.beginPath();
      _s3d_ctx.moveTo(p00.x, p00.y);
      _s3d_ctx.lineTo(p10.x, p10.y);
      _s3d_ctx.lineTo(p11.x, p11.y);
      _s3d_ctx.lineTo(p01.x, p01.y);
      _s3d_ctx.closePath();
      _s3d_ctx.fill();

      // Subtle grid wireframe on strong anomalies
      if (Math.abs(heights[i00]) > 0.45) {
        _s3d_ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        _s3d_ctx.lineWidth = 0.5;
        _s3d_ctx.stroke();
      }
    }
  }

  // Compass / rotation hint
  _s3d_ctx.fillStyle = 'rgba(232,234,237,0.6)';
  _s3d_ctx.font = '11px -apple-system, sans-serif';
  _s3d_ctx.fillText(`↻ ${(Math.round(_rotation * 180 / Math.PI) % 360 + 360) % 360}°  ·  sürükle: döndür  ·  tekerlek: yakınlaştır`, 10, h - 10);
}

/**
 * Check if panel is visible
 */
function isVisible() {
  return _panel && !_panel.classList.contains('hidden');
}

// Export
window.VotexSurface3D = {
  init: initSurface3D,
  show,
  hide,
  render,
  isVisible,
};
