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
let _structures = null; // [{ kind, label, cx, cy, rx, ry, intensity }]
let _wallCues = null; // { cues: [...], segments: [{ x0,y0,x1,y1,strength,length }] }
let _rotation = 0; // radians around Z
let _tilt = 0.9; // camera tilt (0 = top-down, ~1.2 = oblique)
let _zoom = 1.0;

// Structure marker colors (matches desktop viewer/ui/viewer/colors.js)
const _structColors = {
  room:   { fill: 'rgba(60,140,255,0.72)', stroke: 'rgba(60,140,255,0.95)' },  // blue
  tomb:   { fill: 'rgba(170,68,255,0.72)',  stroke: 'rgba(170,68,255,0.95)' },  // purple
  tunnel: { fill: 'rgba(255,200,30,0.72)',  stroke: 'rgba(255,200,30,0.95)' },  // yellow/gold
  shaft:  { fill: 'rgba(255,170,30,0.72)',  stroke: 'rgba(255,170,30,0.95)' },  // orange
  metal:  { fill: 'rgba(255,34,0,0.72)',    stroke: 'rgba(255,34,0,0.95)' },    // red
};
const _structEmoji = { room: '🟦', tomb: '🟪', tunnel: '🟢', shaft: '🟠', metal: '🔴' };

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

  // Export heightmap button
  const exportBtn = document.getElementById('btn-export-heightmap');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportHeightmap());
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
 * Set surface data and show the panel.
 * @param {object} surface    — { gridW, gridH, zMin, zMax, heights, colors }
 * @param {Array}  [structures] — classified structure markers (from classifyStructures)
 * @param {object} [wallCues] — { cues: [...], segments: [...] } from detectWallCues
 */
function show(surface, structures, wallCues) {
  if (!surface || !_s3d_canvas) return;
  _surface = surface;
  _structures = Array.isArray(structures) && structures.length > 0 ? structures : null;
  _wallCues = wallCues && Array.isArray(wallCues.segments) && wallCues.segments.length > 0 ? wallCues : null;
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

  // ── Structure markers ─────────────────────────────────────
  if (_structures) {
    drawStructures(project, zRange, scale);
  }

  // ── Tunnel line segments (from green-line wall cues) ──────
  if (_wallCues) {
    drawTunnelLines(project, zRange);
  }

  // Compass / rotation hint
  _s3d_ctx.fillStyle = 'rgba(232,234,237,0.6)';
  _s3d_ctx.font = '11px -apple-system, sans-serif';
  _s3d_ctx.fillText(`↻ ${(Math.round(_rotation * 180 / Math.PI) % 360 + 360) % 360}°  ·  sürükle: döndür  ·  tekerlek: yakınlaştır`, 10, h - 10);

  // ── Structure legend ──────────────────────────────────────
  if (_structures && _structures.length > 0) {
    drawStructLegend(w, h);
  }
}

/**
 * Sample terrain height at a normalized (0–1) position by bilinear interpolation.
 * Returns normalized z in 0..1 range.
 */
function sampleHeightNxNy(nx, ny) {
  if (!_surface) return 0;
  const { gridW, gridH, heights, zMin, zMax } = _surface;
  const zRange = Math.max(1e-6, zMax - zMin);

  const fx = nx * (gridW - 1);
  const fy = ny * (gridH - 1);
  const ix = Math.min(Math.floor(fx), gridW - 2);
  const iy = Math.min(Math.floor(fy), gridH - 2);
  const tx = fx - ix;
  const ty = fy - iy;

  const i00 = iy * gridW + ix;
  const i10 = i00 + 1;
  const i01 = (iy + 1) * gridW + ix;
  const i11 = i01 + 1;

  const z00 = (heights[i00] - zMin) / zRange;
  const z10 = (heights[i10] - zMin) / zRange;
  const z01 = (heights[i01] - zMin) / zRange;
  const z11 = (heights[i11] - zMin) / zRange;

  return (1 - tx) * (1 - ty) * z00
       + tx * (1 - ty) * z10
       + (1 - tx) * ty * z01
       + tx * ty * z11;
}

/**
 * Draw a 3D box marker at a normalized (0–1) grid position.
 * kind determines the shape:
 *   room/tomb  → low flat box
 *   tunnel     → elongated bar along the long axis
 *   shaft      → tall thin column
 *   metal      → diamond / peak
 */
function drawBox3D(project, gridW, gridH, nx, ny, hw, hh, zBase, zTop, color) {
  // Grid coords (center ± half-width)
  const cx = nx * (gridW - 1);
  const cy = ny * (gridH - 1);
  const dx = hw * (gridW - 1);
  const dy = hh * (gridH - 1);

  const x0 = cx - dx;
  const x1 = cx + dx;
  const y0 = cy - dy;
  const y1 = cy + dy;

  const p00 = project(x0, y0, zBase);
  const p10 = project(x1, y0, zBase);
  const p01 = project(x0, y1, zBase);
  const p11 = project(x1, y1, zBase);
  const t00 = project(x0, y0, zTop);
  const t10 = project(x1, y0, zTop);
  const t01 = project(x0, y1, zTop);
  const t11 = project(x1, y1, zTop);

  // Draw back faces first (painter's order — skip front face, it overlaps terrain)
  const ctx = _s3d_ctx;
  ctx.fillStyle = color.fill;
  ctx.strokeStyle = color.stroke;
  ctx.lineWidth = 1.2;

  // Top face
  ctx.beginPath();
  ctx.moveTo(t00.x, t00.y);
  ctx.lineTo(t10.x, t10.y);
  ctx.lineTo(t11.x, t11.y);
  ctx.lineTo(t01.x, t01.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Left wall
  ctx.beginPath();
  ctx.moveTo(t00.x, t00.y);
  ctx.lineTo(p00.x, p00.y);
  ctx.lineTo(p01.x, p01.y);
  ctx.lineTo(t01.x, t01.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Right wall
  ctx.beginPath();
  ctx.moveTo(t10.x, t10.y);
  ctx.lineTo(p10.x, p10.y);
  ctx.lineTo(p11.x, p11.y);
  ctx.lineTo(t11.x, t11.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/**
 * Draw all structure markers on the terrain.
 * Sorted back-to-front by depth for correct painter's order.
 */
function drawStructures(project, zRange, scale) {
  const ctx = _s3d_ctx;
  const { gridW, gridH, heights, zMin } = _surface;

  // Pre-compute depth for each marker and sort back-to-front
  const markers = _structures.map((s) => {
    const zBase = sampleHeightNxNy(s.cx, s.cy);
    // Use the project function to get depth for sorting
    const gx = s.cx * (gridW - 1);
    const gy = s.cy * (gridH - 1);
    const p = project(gx, gy, zBase);
    return { ...s, zBase, depth: p.depth };
  });

  // Sort: highest depth first (farthest = drawn first)
  markers.sort((a, b) => b.depth - a.depth);

  for (const s of markers) {
    const color = _structColors[s.kind] || _structColors.room;
    const zBase = s.zBase;

    if (s.kind === 'room' || s.kind === 'tomb' || s.kind === 'metal') {
      // Compact box — low height proportional to intensity
      const height = 0.08 + s.intensity * 0.18;
      drawBox3D(project, gridW, gridH, s.cx, s.cy, s.rx, s.ry, zBase, zBase + height, color);

      // Metal: draw a peaked diamond on top
      if (s.kind === 'metal') {
        drawPeak(project, gridW, gridH, s.cx, s.cy, s.rx * 0.6, zBase + height, color);
      }
    } else if (s.kind === 'tunnel') {
      // Elongated bar along the wider axis
      const barH = 0.06 + s.intensity * 0.12;
      drawBox3D(project, gridW, gridH, s.cx, s.cy, s.rx, s.ry, zBase, zBase + barH, color);
    } else if (s.kind === 'shaft') {
      // Tall thin column
      const colH = 0.25 + s.intensity * 0.35;
      const narrowRx = Math.min(s.rx, 0.015);
      const narrowRy = Math.min(s.ry, 0.015);
      drawBox3D(project, gridW, gridH, s.cx, s.cy, narrowRx, narrowRy, zBase, zBase + colH, color);
    }

    // Label above marker
    const lblGx = s.cx * (gridW - 1);
    const lblGy = s.cy * (gridH - 1);
    const lblZ = zBase + (s.kind === 'shaft' ? 0.3 : s.kind === 'metal' ? 0.2 : 0.12);
    const lp = project(lblGx, lblGy, lblZ);

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = 'bold 10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(_structEmoji[s.kind] || '⬜', lp.x, lp.y - 4);
    ctx.font = '9px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(232,234,237,0.8)';
    ctx.fillText(s.label, lp.x, lp.y + 6);
    ctx.textAlign = 'left';
  }
}

/**
 * Draw a peaked diamond (for metal markers).
 */
function drawPeak(project, gridW, gridH, nx, ny, halfW, zBase, color) {
  const cx = nx * (gridW - 1);
  const cy = ny * (gridH - 1);
  const dx = halfW * (gridW - 1);
  const dy = halfW * (gridH - 1);
  const peak = zBase + 0.15;

  const ctx = _s3d_ctx;
  const pCenter = project(cx, cy, peak);
  const pLeft   = project(cx - dx, cy, zBase);
  const pRight  = project(cx + dx, cy, zBase);
  const pFront  = project(cx, cy - dy, zBase);
  const pBack   = project(cx, cy + dy, zBase);

  ctx.fillStyle = color.fill;
  ctx.strokeStyle = color.stroke;
  ctx.lineWidth = 1;

  // 4 triangular faces
  const faces = [
    [pCenter, pLeft,  pFront],
    [pCenter, pLeft,  pBack],
    [pCenter, pRight, pFront],
    [pCenter, pRight, pBack],
  ];
  for (const [a, b, c] of faces) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * Draw structure type legend in the bottom-right corner.
 */
function drawStructLegend(w, h) {
  const ctx = _s3d_ctx;
  const used = new Set(_structures.map(s => s.kind));
  const kinds = ['room', 'tunnel', 'shaft', 'metal'];
  const labels = { room: 'Oda/Mezar', tunnel: 'Tünel', shaft: 'Şaft', metal: 'Metal' };

  const legendX = w - 110;
  let legendY = h - 14;

  // Draw from bottom up
  for (let i = kinds.length - 1; i >= 0; i--) {
    if (!used.has(kinds[i])) continue;
    const c = _structColors[kinds[i]];
    ctx.fillStyle = c.fill;
    ctx.fillRect(legendX, legendY - 9, 9, 9);
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY - 9, 9, 9);
    ctx.fillStyle = 'rgba(232,234,237,0.7)';
    ctx.font = '9px -apple-system, sans-serif';
    ctx.fillText(labels[kinds[i]], legendX + 13, legendY - 1);
    legendY -= 14;
  }
}

/**
 * Export the surface heights as a standard grayscale heightmap PNG.
 *
 * Output convention (Blender / QGIS / World Machine / Unity compatible):
 *   black (0)   = lowest point (zMin)
 *   white (255) = highest point (zMax)
 *
 * The PNG is downloaded via a temporary <a> click.
 *
 * @param {number} [outW=512]  — output width  in pixels
 * @param {number} [outH=512]  — output height in pixels
 */
function exportHeightmap(outW = 512, outH = 512) {
  if (!_surface) {
    if (typeof VotexColorizer !== 'undefined') {
      VotexColorizer.showToast('Dışa aktarılacak yüzey yok', 'error');
    }
    return;
  }

  const { gridW, gridH, heights, zMin, zMax } = _surface;
  const zRange = Math.max(1e-6, zMax - zMin);

  // Offscreen canvas at the requested resolution
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(outW, outH);
  const px = imgData.data; // Uint8ClampedArray, RGBA

  for (let py = 0; py < outH; py++) {
    // Normalized Y (0 top → 1 bottom, heightmap row 0 = north/top)
    const ny = py / (outH - 1);
    const fy = ny * (gridH - 1);
    const iy = Math.min(Math.floor(fy), gridH - 2);
    const ty = fy - iy;

    for (let pxi = 0; pxi < outW; pxi++) {
      const nx = pxi / (outW - 1);
      const fx = nx * (gridW - 1);
      const ix = Math.min(Math.floor(fx), gridW - 2);
      const tx = fx - ix;

      // Bilinear interpolation of raw heights
      const i00 = iy * gridW + ix;
      const i10 = i00 + 1;
      const i01 = (iy + 1) * gridW + ix;
      const i11 = i01 + 1;

      const h00 = heights[i00];
      const h10 = heights[i10];
      const h01 = heights[i01];
      const h11 = heights[i11];

      const h = (1 - tx) * (1 - ty) * h00
              + tx * (1 - ty) * h10
              + (1 - tx) * ty * h01
              + tx * ty * h11;

      // Map zMin..zMax → 0..255
      const gray = Math.round(((h - zMin) / zRange) * 255);
      const clamped = Math.max(0, Math.min(255, gray));

      const pi = (py * outW + pxi) * 4;
      px[pi]     = clamped; // R
      px[pi + 1] = clamped; // G
      px[pi + 2] = clamped; // B
      px[pi + 3] = 255;    // A
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Trigger PNG download
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `votex_heightmap_${gridW}x${gridH}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (typeof VotexColorizer !== 'undefined') {
      VotexColorizer.showToast(
        `Heightmap dışa aktarıldı — ${outW}×${outH} px, ${gridW}×${gridH} grid, z=[${zMin.toFixed(3)}, ${zMax.toFixed(3)}]`,
        'success'
      );
    }
  }, 'image/png');
}

/**
 * Draw tunnel line segments from green-line wall cues.
 * Each segment is rendered as a raised line on the terrain surface.
 */
function drawTunnelLines(project, zRange) {
  if (!_wallCues || !_surface) return;
  const ctx = _s3d_ctx;
  const { gridW, gridH, heights, zMin } = _surface;

  const segs = _wallCues.segments;

  // Draw each segment as a raised line on the terrain
  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si];
    const strength = seg.strength;

    // Sample terrain height at both endpoints
    const z0 = sampleHeightNxNy(seg.x0, seg.y0);
    const z1 = sampleHeightNxNy(seg.x1, seg.y1);

    // Slight raise above terrain so the line is visible
    const raise = 0.03 + strength * 0.05;

    // Project endpoints
    const gx0 = seg.x0 * (gridW - 1);
    const gy0 = seg.y0 * (gridH - 1);
    const gx1 = seg.x1 * (gridW - 1);
    const gy1 = seg.y1 * (gridH - 1);

    const p0 = project(gx0, gy0, z0 + raise);
    const p1 = project(gx1, gy1, z1 + raise);

    // Line color: green tint (green-line) or white (near-void wall)
    const alpha = (0.35 + strength * 0.55).toFixed(2);
    ctx.strokeStyle = `rgba(100,220,120,${alpha})`;
    ctx.lineWidth = 1.5 + strength * 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();

    // Glow effect for strong segments
    if (strength > 0.5) {
      ctx.strokeStyle = `rgba(100,220,120,${(strength * 0.2).toFixed(2)})`;
      ctx.lineWidth = 4 + strength * 3;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }

  // Draw near-void wall cue points as small dots
  const cues = _wallCues.cues;
  if (cues && cues.length > 0) {
    for (const cue of cues) {
      if (!cue.nearVoid || cue.greenLine) continue; // skip green-line cues (drawn as segments)
      const z = sampleHeightNxNy(cue.x, cue.y);
      const gx = cue.x * (gridW - 1);
      const gy = cue.y * (gridH - 1);
      const p = project(gx, gy, z + 0.02);
      const alpha = (0.2 + cue.strength * 0.5).toFixed(2);
      ctx.fillStyle = `rgba(180,200,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5 + cue.strength, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
  exportHeightmap,
};
