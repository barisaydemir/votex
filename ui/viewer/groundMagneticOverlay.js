/**
 * groundMagneticOverlay.js — 3D ground plane magnetic overlay.
 *
 * Displays the binned 2D magnetic field and can switch to gradient magnitude
 * (|∇B|) for edge detection. Gradient vectors are also rendered as arrows.
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";

const OVERLAY_GRID = 128;
const MAX_ADAPTIVE_GRID = 256;
const OVERLAY_Y_BIAS = 0.02;
const DEFAULT_OPACITY = 0.45;
const MAGNETIC_MODE = "magnetic";
const GRADIENT_MODE = "gradient";
const DEFAULT_CONTOUR_COUNT = 8;
const CONTOUR_Y_BIAS = 0.045;

const JET_STOPS = [
  { t: 0.00, r: 0,   g: 0,   b: 128 },
  { t: 0.12, r: 0,   g: 0,   b: 255 },
  { t: 0.30, r: 0,   g: 255, b: 255 },
  { t: 0.45, r: 0,   g: 255, b: 0   },
  { t: 0.55, r: 255, g: 255, b: 0   },
  { t: 0.75, r: 255, g: 128, b: 0   },
  { t: 1.00, r: 255, g: 0,   b: 0   },
];

function jetRgb(t) {
  const n = Math.max(0, Math.min(1, t));
  let lo = JET_STOPS[0], hi = JET_STOPS[JET_STOPS.length - 1];
  for (let i = 0; i < JET_STOPS.length - 1; i++) {
    if (n >= JET_STOPS[i].t && n <= JET_STOPS[i + 1].t) {
      lo = JET_STOPS[i];
      hi = JET_STOPS[i + 1];
      break;
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
 * Bin normalized CSV points into an XZ magnetic grid.
 */
export function binToGroundGrid(points, mapW, mapD, gridRes) {
  const n = gridRes * gridRes;
  const sums = new Float64Array(n);
  const counts = new Uint32Array(n);
  const halfW = mapW / 2;
  const halfD = mapD / 2;

  for (const p of points) {
    const gx = Math.floor(((p.x + halfW) / mapW) * (gridRes - 1));
    const gz = Math.floor(((p.z + halfD) / mapD) * (gridRes - 1));
    if (gx < 0 || gz < 0 || gx >= gridRes || gz >= gridRes) continue;
    const idx = gz * gridRes + gx;
    sums[idx] += Number(p.magnetic ?? p.anomaly ?? 0);
    counts[idx]++;
  }

  const grid = new Float32Array(n);
  for (let i = 0; i < n; i++) grid[i] = counts[i] > 0 ? sums[i] / counts[i] : NaN;
  return { grid, counts, gridRes };
}

/**
 * Choose a useful grid without making sparse surveys needlessly expensive.
 * Callers can still pass gridRes explicitly for reproducible exports/tests.
 */
export function chooseAdaptiveGridResolution(pointCount) {
  const count = Math.max(0, Number(pointCount) || 0);
  if (count >= 5000) return MAX_ADAPTIVE_GRID;
  if (count >= 800) return OVERLAY_GRID;
  return 64;
}
function validCell(grid, counts, idx) {
  return counts[idx] > 0 && Number.isFinite(grid[idx]);
}

function nearestValid(grid, counts, gridRes, gx, gz, dx, dz) {
  for (let distance = 1; distance < gridRes; distance++) {
    const x = gx + dx * distance;
    const z = gz + dz * distance;
    if (x < 0 || z < 0 || x >= gridRes || z >= gridRes) break;
    const idx = z * gridRes + x;
    if (validCell(grid, counts, idx)) return { value: grid[idx], distance };
  }
  return null;
}

function derivativeAt(grid, counts, gridRes, gx, gz, step, axis) {
  const idx = gz * gridRes + gx;
  const current = grid[idx];
  const negative = axis === "x"
    ? nearestValid(grid, counts, gridRes, gx, gz, -1, 0)
    : nearestValid(grid, counts, gridRes, gx, gz, 0, -1);
  const positive = axis === "x"
    ? nearestValid(grid, counts, gridRes, gx, gz, 1, 0)
    : nearestValid(grid, counts, gridRes, gx, gz, 0, 1);

  if (negative && positive) {
    return (positive.value - negative.value) / ((negative.distance + positive.distance) * step);
  }
  if (positive) return (positive.value - current) / (positive.distance * step);
  if (negative) return (current - negative.value) / (negative.distance * step);
  return 0;
}

/**
 * Compute finite-difference gradient vectors and |∇B| from a sparse 2D grid.
 * Missing cells use the nearest valid sample on each axis, while edge cells
 * naturally fall back to one-sided differences.
 */
export function computeGradientField(grid, counts, gridRes, mapW, mapD) {
  const gradientX = new Float32Array(grid.length);
  const gradientZ = new Float32Array(grid.length);
  const magnitude = new Float32Array(grid.length);
  const stepX = mapW / Math.max(1, gridRes - 1);
  const stepZ = mapD / Math.max(1, gridRes - 1);
  let maxMagnitude = 0;

  for (let gz = 0; gz < gridRes; gz++) {
    for (let gx = 0; gx < gridRes; gx++) {
      const idx = gz * gridRes + gx;
      if (!validCell(grid, counts, idx)) {
        gradientX[idx] = NaN;
        gradientZ[idx] = NaN;
        magnitude[idx] = NaN;
        continue;
      }
      const dx = derivativeAt(grid, counts, gridRes, gx, gz, stepX, "x");
      const dz = derivativeAt(grid, counts, gridRes, gx, gz, stepZ, "z");
      const mag = Math.hypot(dx, dz);
      gradientX[idx] = dx;
      gradientZ[idx] = dz;
      magnitude[idx] = mag;
      if (mag > maxMagnitude) maxMagnitude = mag;
    }
  }

  return { gradientX, gradientZ, magnitude, maxMagnitude };
}

function gridToTexture(grid, counts, gridRes, mode, scaleLow = null, scaleHigh = null) {
  const n = gridRes * gridRes;
  const data = new Uint8Array(n * 4);
  let min = mode === GRADIENT_MODE ? 0 : Infinity;
  let max = mode === GRADIENT_MODE ? 0 : -Infinity;

  for (let i = 0; i < n; i++) {
    if (!validCell(grid, counts, i)) continue;
    if (grid[i] < min) min = grid[i];
    if (grid[i] > max) max = grid[i];
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max) || max <= min) max = min + 1;
  if (Number.isFinite(scaleLow)) min = scaleLow;
  if (Number.isFinite(scaleHigh)) max = Math.max(min + 1e-9, scaleHigh);
  const range = max - min;

  for (let i = 0; i < n; i++) {
    const off = i * 4;
    if (!validCell(grid, counts, i)) continue;
    const [r, g, b] = jetRgb((grid[i] - min) / range);
    data[off] = r;
    data[off + 1] = g;
    data[off + 2] = b;
    data[off + 3] = 200;
  }

  const tex = new THREE.DataTexture(data, gridRes, gridRes, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Return evenly spaced iso-nT levels from the populated magnetic field.
 */
export function getMagneticContourLevels(grid, counts, contourCount = DEFAULT_CONTOUR_COUNT) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    if (!validCell(grid, counts, i)) continue;
    min = Math.min(min, grid[i]);
    max = Math.max(max, grid[i]);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const count = Math.max(1, Math.floor(contourCount));
  const levels = [];
  for (let i = 1; i <= count; i++) levels.push(min + ((max - min) * i) / (count + 1));
  return levels;
}

const MARCHING_SQUARE_PAIRS = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]],
  [[3, 0], [1, 2]], [[0, 2]], [[3, 2]], [[2, 3]],
  [[0, 2]], [[0, 1], [2, 3]], [[1, 2]], [[1, 3]],
  [[0, 1]], [[3, 0]], [],
];

function contourEdgePoint(edge, values, level, x0, z0, stepX, stepZ) {
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const [from, to] = edges[edge];
  const points = [
    [x0, z0],
    [x0 + stepX, z0],
    [x0 + stepX, z0 + stepZ],
    [x0, z0 + stepZ],
  ];
  const a = values[from];
  const b = values[to];
  const denominator = b - a;
  const t = Math.abs(denominator) > Number.EPSILON
    ? Math.max(0, Math.min(1, (level - a) / denominator))
    : 0.5;
  return [
    points[from][0] + (points[to][0] - points[from][0]) * t,
    points[from][1] + (points[to][1] - points[from][1]) * t,
  ];
}

/**
 * Build XZ line-segment vertices for iso-nT contours using marching squares.
 * Cells with missing samples are skipped to avoid inventing contours across gaps.
 */
export function computeMagneticContourSegments(grid, counts, gridRes, mapW, mapD, levels) {
  const positions = [];
  const stepX = mapW / Math.max(1, gridRes - 1);
  const stepZ = mapD / Math.max(1, gridRes - 1);
  const halfW = mapW / 2;
  const halfD = mapD / 2;

  for (let gz = 0; gz < gridRes - 1; gz++) {
    for (let gx = 0; gx < gridRes - 1; gx++) {
      const indices = [
        gz * gridRes + gx,
        gz * gridRes + gx + 1,
        (gz + 1) * gridRes + gx + 1,
        (gz + 1) * gridRes + gx,
      ];
      if (indices.some((idx) => !validCell(grid, counts, idx))) continue;
      const values = indices.map((idx) => grid[idx]);
      const x0 = -halfW + gx * stepX;
      const z0 = -halfD + gz * stepZ;

      for (const level of levels) {
        if (!Number.isFinite(level)) continue;
        let mask = 0;
        for (let i = 0; i < 4; i++) if (values[i] >= level) mask |= 1 << i;
        const pairs = MARCHING_SQUARE_PAIRS[mask];
        for (const [edgeA, edgeB] of pairs) {
          const a = contourEdgePoint(edgeA, values, level, x0, z0, stepX, stepZ);
          const b = contourEdgePoint(edgeB, values, level, x0, z0, stepX, stepZ);
          positions.push(a[0], CONTOUR_Y_BIAS, a[1], b[0], CONTOUR_Y_BIAS, b[1]);
        }
      }
    }
  }
  return positions;
}

function buildMagneticContours(grid, counts, gridRes, mapW, mapD, visible) {
  const levels = getMagneticContourLevels(grid, counts);
  const group = new THREE.Group();
  group.name = "magneticIsoContours";
  group.visible = visible;
  group.userData.contourLevels = levels;

  levels.forEach((level, index) => {
    const positions = computeMagneticContourSegments(grid, counts, gridRes, mapW, mapD, [level]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const t = (index + 1) / (levels.length + 1);
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color().setHSL(0.08 + t * 0.55, 0.9, 0.68),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const line = new THREE.LineSegments(geometry, material);
    line.name = `magneticIsoContour-${index + 1}`;
    line.renderOrder = 2;
    line.userData.level = level;
    group.add(line);
  });
  return group;
}


function buildGradientArrows(gradient, counts, gridRes, mapW, mapD, visible) {
  const group = new THREE.Group();
  group.name = "magneticGradientArrows";
  group.visible = visible;
  const stepX = mapW / Math.max(1, gridRes - 1);
  const stepZ = mapD / Math.max(1, gridRes - 1);
  const halfW = mapW / 2;
  const halfD = mapD / 2;
  const stride = Math.max(1, Math.ceil(gridRes / 20));
  const maxMagnitude = gradient.maxMagnitude;
  if (!(maxMagnitude > 0)) return group;

  for (let gz = 0; gz < gridRes; gz += stride) {
    for (let gx = 0; gx < gridRes; gx += stride) {
      const idx = gz * gridRes + gx;
      const magnitude = gradient.magnitude[idx];
      if (!counts[idx] || !Number.isFinite(magnitude) || magnitude < maxMagnitude * 0.05) continue;
      const dx = gradient.gradientX[idx];
      const dz = gradient.gradientZ[idx];
      const length = Math.min(stepX, stepZ) * 0.8;
      const direction = new THREE.Vector3(dx, 0, dz).normalize();
      const arrow = new THREE.ArrowHelper(
        direction,
        new THREE.Vector3(-halfW + gx * stepX, OVERLAY_Y_BIAS * 2, -halfD + gz * stepZ),
        length,
        0xffffff,
        length * 0.3,
        length * 0.18,
      );
      arrow.line.material.transparent = true;
      arrow.cone.material.transparent = true;
      arrow.line.material.opacity = 0.9;
      arrow.cone.material.opacity = 0.9;
      group.add(arrow);
    }
  }
  return group;
}

/**
 * Build the magnetic ground overlay.
 * @param {THREE.Group} csvGroup
 * @param {Object} surface
 * @param {Object} opts - { opacity, gridRes, mode, showArrows, showContours }
 * @returns {THREE.Group|null}
 */
export function buildGroundMagneticOverlay(csvGroup, surface, opts = {}) {
  if (!csvGroup || !surface) return null;
  const normPoints = csvGroup.userData?.csvPoints;
  if (!normPoints || normPoints.length === 0) return null;

  const mapW = Number(surface.mapWidthM ?? surface.map_width_m ?? surface.mapSizeM ?? 24);
  const mapD = Number(surface.mapDepthM ?? surface.map_depth_m ?? mapW);
  const gridRes = opts.gridRes || chooseAdaptiveGridResolution(normPoints.length);
  const opacity = opts.opacity ?? state.magneticOverlayOpacity ?? DEFAULT_OPACITY;
  const mode = opts.mode === GRADIENT_MODE ? GRADIENT_MODE : MAGNETIC_MODE;
  const showArrows = opts.showArrows ?? state.magneticOverlayArrows ?? true;
  const showContours = opts.showContours ?? state.magneticOverlayContours ?? true;
  const { grid, counts } = binToGroundGrid(normPoints, mapW, mapD, gridRes);

  let filledCount = 0;
  for (const count of counts) if (count > 0) filledCount++;
  if (filledCount < 10) {
    console.log("[GroundMagOverlay] Not enough data, overlay skipped");
    return null;
  }

  const gradient = computeGradientField(grid, counts, gridRes, mapW, mapD);
  const displayGrid = mode === GRADIENT_MODE ? gradient.magnitude : grid;
  const texture = gridToTexture(
    displayGrid,
    counts,
    gridRes,
    mode,
    opts.scaleLow,
    opts.scaleHigh,
  );
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(mapW, mapD).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
  );
  mesh.name = "groundMagneticHeatmap";
  mesh.position.y = OVERLAY_Y_BIAS;
  mesh.renderOrder = 1;

  const overlay = new THREE.Group();
  overlay.name = "groundMagneticOverlay";
  overlay.userData.votexLayer = "csv";
  overlay.userData.gridRes = gridRes;
  overlay.userData.gradientField = gradient;
  overlay.userData.heatmap = mesh;
  overlay.userData.arrows = buildGradientArrows(gradient, counts, gridRes, mapW, mapD, showArrows);
  overlay.userData.contours = buildMagneticContours(grid, counts, gridRes, mapW, mapD, showContours);
  overlay.add(mesh);
  overlay.add(overlay.userData.contours);
  overlay.add(overlay.userData.arrows);

  console.log(`[GroundMagOverlay] Created: ${gridRes}×${gridRes}, ${filledCount} filled cells, mode=${mode}`);
  return overlay;
}

export function updateGroundMagneticOverlay(csvGroup, surface) {
  const scene = state.scene;
  if (!scene) return;
  removeGroundMagneticOverlay();
  if (!state.showMagneticGround) return;

  const overlay = buildGroundMagneticOverlay(csvGroup, surface, {
    mode: state.magneticOverlayMode,
    opacity: state.magneticOverlayOpacity,
    showArrows: state.magneticOverlayArrows,
    showContours: state.magneticOverlayContours,
    scaleLow: state.magneticOverlayAutoScale ? null : state.magneticOverlayScaleLow,
    scaleHigh: state.magneticOverlayAutoScale ? null : state.magneticOverlayScaleHigh,
  });
  if (!overlay) return;
  scene.add(overlay);
  state.groundMagneticOverlay = overlay;
  invalidate();
}

function disposeOverlay(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((material) => material.dispose());
      else obj.material.dispose();
    }
  });
}

export function removeGroundMagneticOverlay() {
  const old = state.groundMagneticOverlay;
  if (!old) return;
  state.scene?.remove(old);
  disposeOverlay(old);
  state.groundMagneticOverlay = null;
}

export function setMagneticOverlayOpacity(value) {
  state.magneticOverlayOpacity = Math.max(0, Math.min(1, value));
  const overlay = state.groundMagneticOverlay;
  if (!overlay) return;
  overlay.traverse((obj) => {
    if (obj.material) obj.material.opacity = state.magneticOverlayOpacity;
  });
  invalidate();
}

export function setMagneticOverlayMode(mode) {
  state.magneticOverlayMode = mode === GRADIENT_MODE ? GRADIENT_MODE : MAGNETIC_MODE;
}

export function setMagneticOverlayContours(show) {
  state.magneticOverlayContours = !!show;
  const contours = state.groundMagneticOverlay?.userData?.contours;
  if (contours) {
    contours.visible = state.magneticOverlayContours;
    invalidate();
  }
}

export function setMagneticOverlayArrows(show) {
  state.magneticOverlayArrows = !!show;
  const arrows = state.groundMagneticOverlay?.userData?.arrows;
  if (arrows) {
    arrows.visible = state.magneticOverlayArrows;
    invalidate();
  }
}

export function toggleMagneticGround(show) {
  state.showMagneticGround = !!show;
  if (state.groundMagneticOverlay) {
    state.groundMagneticOverlay.visible = state.showMagneticGround;
    invalidate();
  }
}

export function syncMagneticOverlayClip() {
  const overlay = state.groundMagneticOverlay;
  if (!overlay) return;
  const planes = state.clipEnabled ? [state.clipPlane] : null;
  overlay.traverse((obj) => {
    if (obj.material) {
      obj.material.clippingPlanes = planes;
      obj.material.needsUpdate = true;
    }
  });
}

export { GRADIENT_MODE, MAGNETIC_MODE };
