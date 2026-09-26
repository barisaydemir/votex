/**
 * Legacy3DMAG yeraltı tomografi katmanı.
 * Tek dilim inceleme, tespit odağı, sigma eşiği ve derinlik peaking.
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { selectedDetectionOf } from "./legacyTargetSession.js";
import { invalidate, refreshClipState } from "./scene.js";
import { normalizeLegacyResult, mergeLegacyShapes } from "./legacyNormalize.js";

const GROUP_NAME = "legacyTomographyLayer";
const DEFAULT_SLICES = 16;
const DEFAULT_OPACITY = 0.55;
const PLAY_MS = 420;

let playTimer = null;

function numberOf(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function refreshObjectSliceSync() {
  import("./legacyObjectView.js").then(({ applyLegacyObjectViewMode }) => {
    applyLegacyObjectViewMode();
  }).catch(() => {});
}

function gridOf(result) {
  const normalized = normalizeLegacyResult(result);
  let w = Math.round(numberOf(normalized.gridW, 0));
  let h = Math.round(numberOf(normalized.gridH, 0));
  let values = Array.isArray(normalized.gridValues) && normalized.gridValues.length >= 4
    ? normalized.gridValues
    : (Array.isArray(normalized.residualPreview) ? normalized.residualPreview : []);
  const coverage = Array.isArray(normalized.gridCoverage) ? normalized.gridCoverage : [];
  if (!Array.isArray(values) || values.length < 4) return null;

  if (w < 2 || h < 2 || values.length !== w * h) {
    const side = Math.round(Math.sqrt(values.length));
    if (side >= 2 && side * side === values.length) {
      w = side;
      h = side;
    } else {
      return null;
    }
  }
  return {
    w,
    h,
    values: values.map(Number),
    coverage: coverage.length === values.length ? coverage.map(Number) : values.map(() => 1),
    result: normalized,
  };
}

function colorFor(value, maxAbs) {
  const t = clamp(value / Math.max(maxAbs, 1e-6), -1, 1);
  if (t < 0) {
    const a = -t;
    return [Math.round(24 + 42 * (1 - a)), Math.round(138 + 82 * (1 - a)), Math.round(255 - 34 * a)];
  }
  return [255, Math.round(226 - 142 * t), Math.round(232 - 214 * t)];
}

function detectionsOf(result) {
  const shapes = mergeLegacyShapes(normalizeLegacyResult(result));
  return shapes.map((shape, index) => {
    const top = Math.max(0, numberOf(shape.depthTopM, 0.5));
    const bottom = Math.max(top + 0.15, numberOf(shape.depthBottomM, top + 1));
    return {
      detectionId: `legacy-dik-shape-${index + 1}`,
      cx: numberOf(shape.cx),
      cy: numberOf(shape.cy),
      depthTopM: top,
      depthBottomM: bottom,
      depthCenterM: (top + bottom) * 0.5,
      halfWidthM: Math.max(0.18, (bottom - top) * 0.28),
      rx: Math.max(0.15, numberOf(shape.widthM, numberOf(shape.rx, 0.4) * 2) * 0.5),
      ry: Math.max(0.15, numberOf(shape.lengthM, numberOf(shape.ry, 0.4) * 2) * 0.5),
      strength: Math.max(0.4, numberOf(shape.peakSigma, numberOf(shape.strength, 1))),
    };
  });
}

/**
 * Derinlik peaking ağırlığı — odak id varsa o tespiti güçlendirir.
 * @param {number} depthM
 * @param {number} xM
 * @param {number} zM
 * @param {object[]} detections
 * @param {number} maxDepthM
 * @param {string | null} [focusDetectionId]
 */
export function peakWeightAt(depthM, xM, zM, detections, maxDepthM, focusDetectionId = null) {
  if (!detections.length) {
    const t = clamp(depthM / Math.max(maxDepthM, 1e-6), 0, 1);
    return Math.max(0.12, 1 - t * 0.82);
  }
  const focusId = focusDetectionId || selectedDetectionOf(state.legacyTargetSession) || null;
  let best = 0.02;
  for (const detection of detections) {
    const dx = (xM - detection.cx) / Math.max(detection.rx, 0.15);
    const dz = (zM - detection.cy) / Math.max(detection.ry, 0.15);
    const radial = Math.exp(-(dx * dx + dz * dz) * 1.55);
    const depthTerm = Math.exp(
      -(((depthM - detection.depthCenterM) / Math.max(detection.halfWidthM, 0.15)) ** 2),
    );
    let w = radial * depthTerm * clamp(detection.strength / 3, 0.45, 1.4);
    if (focusId) {
      w *= detection.detectionId === focusId ? 1.4 : 0.25;
    }
    best = Math.max(best, w);
  }
  return best;
}

function cellToMeters(ix, iy, grid, originX, originZ, widthM, depthM) {
  const xM = originX + ((ix + 0.5) / grid.w) * widthM;
  const zM = originZ + ((iy + 0.5) / grid.h) * depthM;
  return { xM, zM };
}

/**
 * @param {object} grid
 * @param {{ depthM: number, sigmaFloor: number, detections: any[], maxDepthM: number, originX: number, originZ: number, widthM: number, depthPlanM: number }} opts
 */
function makeSliceTexture(grid, opts) {
  const finiteValues = grid.values
    .filter((value, index) => Number(grid.coverage[index]) > 0 && Number.isFinite(Number(value)))
    .map(Number);
  if (!finiteValues.length) return null;
  const maxAbs = Math.max(...finiteValues.map((value) => Math.abs(value)), 1e-6);
  const sigmaFloor = Math.max(0, numberOf(opts.sigmaFloor, 0));
  const data = new Uint8Array(grid.values.length * 4);

  for (let iy = 0; iy < grid.h; iy += 1) {
    for (let ix = 0; ix < grid.w; ix += 1) {
      const i = iy * grid.w + ix;
      const offset = i * 4;
      const value = Number(grid.values[i]);
      const measured = Number(grid.coverage[i]) > 0 && Number.isFinite(value);
      if (!measured) {
        data[offset] = 72;
        data[offset + 1] = 78;
        data[offset + 2] = 88;
        data[offset + 3] = 38;
        continue;
      }
      const { xM, zM } = cellToMeters(ix, iy, grid, opts.originX, opts.originZ, opts.widthM, opts.depthPlanM);
      const peak = peakWeightAt(
        opts.depthM,
        xM,
        zM,
        opts.detections,
        opts.maxDepthM,
        opts.focusDetectionId || null,
      );
      const scaled = value * peak;
      if (Math.abs(scaled) < sigmaFloor) {
        data[offset] = 90;
        data[offset + 1] = 96;
        data[offset + 2] = 104;
        data[offset + 3] = 28;
        continue;
      }
      const [r, g, b] = colorFor(scaled, maxAbs);
      const confidence = clamp(Number(grid.coverage[i]) / 3, 0, 1);
      const strength = clamp(Math.abs(scaled) / maxAbs, 0, 1);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = Math.round(90 + confidence * 90 + strength * 60);
    }
  }

  const texture = new THREE.DataTexture(data, grid.w, grid.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.needsUpdate = true;
  texture.userData = { maxAbs, measuredCells: finiteValues.length };
  return texture;
}

function disposeLayer(layer) {
  if (!layer) return;
  const textures = new Set();
  layer.traverse((object) => {
    if (object.geometry) object.geometry.dispose();
    if (object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material.map) textures.add(material.map);
        material.dispose?.();
      });
    }
  });
  textures.forEach((texture) => texture.dispose?.());
}

function stopPlayTimer() {
  if (playTimer != null) {
    clearInterval(playTimer);
    playTimer = null;
  }
  state.legacyTomographyPlaying = false;
}

function sliceMeshes(layer = getLegacyTomographyLayer()) {
  if (!layer) return [];
  return layer.children.filter((object) => object.name?.startsWith("legacyTomographySlice-"));
}

function applySliceVisibility(layer = getLegacyTomographyLayer()) {
  if (!layer) return;
  const depthM = numberOf(state.legacyTomographyDepthM, layer.userData.activeDepthM || 1);
  const focusLow = numberOf(layer.userData.focusLowM, NaN);
  const focusHigh = numberOf(layer.userData.focusHighM, NaN);
  const hasFocus = Number.isFinite(focusLow) && Number.isFinite(focusHigh);
  const opacity = clamp(numberOf(state.legacyTomographyOpacity, DEFAULT_OPACITY), 0.12, 0.95);
  const step = numberOf(layer.userData.sliceStepM, 0.5);
  const half = Math.max(step * 0.55, 0.12);

  sliceMeshes(layer).forEach((slice) => {
    const sliceDepth = numberOf(slice.userData.depthM);
    const inActiveBand = Math.abs(sliceDepth - depthM) <= half;
    let visible = inActiveBand;
    let materialOpacity = opacity;
    if (hasFocus) {
      const inFocus = sliceDepth >= focusLow - half && sliceDepth <= focusHigh + half;
      if (inFocus && !inActiveBand) {
        visible = true;
        materialOpacity = opacity * 0.28;
      } else if (!inFocus && !inActiveBand) {
        visible = false;
      } else if (inFocus && inActiveBand) {
        materialOpacity = Math.min(0.95, opacity * 1.08);
      }
    }
    slice.visible = visible;
    if (slice.material) slice.material.opacity = materialOpacity;
  });
  layer.userData.activeDepthM = depthM;
  invalidate();
}

export function getLegacyTomographyLayer() {
  return state.legacyDikGroup?.getObjectByName(GROUP_NAME) || null;
}

export function getTomographyControlsState() {
  const layer = getLegacyTomographyLayer();
  const maxDepthM = numberOf(layer?.userData?.maxDepthM, numberOf(state.legacyDikGroup?.userData?.depthMapM, 10));
  return {
    visible: !!layer,
    depthM: numberOf(state.legacyTomographyDepthM, numberOf(layer?.userData?.activeDepthM, maxDepthM * 0.25)),
    maxDepthM,
    opacity: clamp(numberOf(state.legacyTomographyOpacity, DEFAULT_OPACITY), 0.12, 0.95),
    playing: !!state.legacyTomographyPlaying,
    sigmaFloor: clamp(numberOf(state.legacyTomographySigmaFloor, 0), 0, 4),
    sliceCount: numberOf(layer?.userData?.sliceCount, DEFAULT_SLICES),
    maxAbs: numberOf(layer?.userData?.maxAbs, 0),
  };
}

export function removeLegacyTomography() {
  stopPlayTimer();
  const layer = getLegacyTomographyLayer();
  if (!layer) {
    state.legacyTomographyVisible = false;
    refreshObjectSliceSync();
    return false;
  }
  layer.parent?.remove(layer);
  disposeLayer(layer);
  state.legacyTomographyVisible = false;
  if (state.legacyDikGroup) state.legacyDikGroup.userData.tomographyLayer = null;
  refreshObjectSliceSync();
  invalidate();
  return true;
}

export function addLegacyTomography(result = state.legacyDikResult, options = {}) {
  removeLegacyTomography();
  const grid = gridOf(result);
  if (!state.legacyDikGroup || !grid) return null;

  const model = state.legacyDikGroup.userData;
  const widthM = Math.max(0.5, numberOf(model?.gridWidthM, 4));
  const depthPlanM = Math.max(0.5, numberOf(model?.gridDepthM, 5));
  const originX = numberOf(model?.gridOriginXM, numberOf(grid.result.gridOriginXM, 0));
  const originZ = numberOf(model?.gridOriginZM, numberOf(grid.result.gridOriginYM, 0));
  const maxDepthM = Math.max(1, numberOf(options.maxDepthM, numberOf(model?.depthMapM, 10)));
  const slices = Math.max(4, Math.min(32, Math.round(numberOf(options.slices, DEFAULT_SLICES))));
  const opacity = clamp(
    numberOf(options.opacity, numberOf(state.legacyTomographyOpacity, DEFAULT_OPACITY)),
    0.12,
    0.95,
  );
  const sigmaFloor = clamp(numberOf(options.sigmaFloor, numberOf(state.legacyTomographySigmaFloor, 0)), 0, 4);
  const detections = detectionsOf(result || grid.result);
  const sliceStepM = maxDepthM / slices;
  const focusDetectionId = options.focusDetectionId
    ?? selectedDetectionOf(state.legacyTargetSession)
    ?? null;

  state.legacyTomographyOpacity = opacity;
  state.legacyTomographySigmaFloor = sigmaFloor;
  if (!Number.isFinite(Number(state.legacyTomographyDepthM))) {
    state.legacyTomographyDepthM = Math.max(0.2, Math.min(maxDepthM, detections[0]?.depthCenterM || maxDepthM * 0.25));
  } else {
    state.legacyTomographyDepthM = clamp(Number(state.legacyTomographyDepthM), 0.05, maxDepthM);
  }

  const layer = new THREE.Group();
  layer.name = GROUP_NAME;
  layer.userData.legacyTomography = true;
  layer.userData.legacyTomographyPersistent = true;
  layer.userData.sliceCount = slices;
  layer.userData.sliceStepM = sliceStepM;
  layer.userData.gridW = grid.w;
  layer.userData.gridH = grid.h;
  layer.userData.maxDepthM = maxDepthM;
  layer.userData.opacity = opacity;
  layer.userData.sigmaFloor = sigmaFloor;
  layer.userData.activeDepthM = state.legacyTomographyDepthM;
  layer.userData.detections = detections;
  layer.userData.focusDetectionId = focusDetectionId;
  layer.userData.originXM = originX;
  layer.userData.originZM = originZ;
  layer.userData.widthM = widthM;
  layer.userData.depthPlanM = depthPlanM;

  let measuredCells = 0;
  let maxAbs = 1e-6;
  for (let index = 0; index < slices; index += 1) {
    const depth = ((index + 0.5) / slices) * maxDepthM;
    const texture = makeSliceTexture(grid, {
      depthM: depth,
      sigmaFloor,
      detections,
      maxDepthM,
      originX,
      originZ,
      widthM,
      depthPlanM,
      focusDetectionId,
    });
    if (!texture) continue;
    measuredCells = texture.userData.measuredCells;
    maxAbs = Math.max(maxAbs, texture.userData.maxAbs);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    const slice = new THREE.Mesh(new THREE.PlaneGeometry(widthM, depthPlanM), material);
    slice.rotation.x = -Math.PI / 2;
    slice.position.set(originX + widthM * 0.5 - widthM * 0.5, -depth, originZ + depthPlanM * 0.5 - depthPlanM * 0.5);
    // Grid world frame already centered by parent legacy group; keep plane at group center.
    slice.position.set(0, -depth, 0);
    slice.name = `legacyTomographySlice-${index + 1}`;
    slice.renderOrder = 18 + index;
    slice.userData.legacyTomography = true;
    slice.userData.legacyTomographyPersistent = true;
    slice.userData.tomographySlice = index + 1;
    slice.userData.depthM = depth;
    slice.visible = false;
    layer.add(slice);
  }

  layer.userData.measuredCells = measuredCells;
  layer.userData.maxAbs = maxAbs;

  const gridLines = [];
  for (let index = 0; index <= slices; index += 1) {
    const depth = (index / slices) * maxDepthM;
    gridLines.push(-widthM / 2, -depth, -depthPlanM / 2, widthM / 2, -depth, -depthPlanM / 2);
  }
  const depthMarks = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(gridLines, 3)),
    new THREE.LineBasicMaterial({ color: 0x6cc8d8, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  depthMarks.name = "legacyTomographyDepthMarks";
  depthMarks.userData.legacyTomography = true;
  depthMarks.userData.legacyTomographyPersistent = true;
  depthMarks.renderOrder = 60;
  layer.add(depthMarks);

  state.legacyDikGroup.add(layer);
  state.legacyTomographyVisible = true;
  state.legacyDikGroup.userData.tomographyLayer = layer;
  applySliceVisibility(layer);
  refreshObjectSliceSync();
  refreshClipState();
  invalidate();
  return layer;
}

export function setTomographyDepthM(depthM) {
  const layer = getLegacyTomographyLayer();
  const maxDepthM = numberOf(layer?.userData?.maxDepthM, 10);
  state.legacyTomographyDepthM = clamp(numberOf(depthM, 0.5), 0.05, maxDepthM);
  if (layer) {
    layer.userData.activeDepthM = state.legacyTomographyDepthM;
    applySliceVisibility(layer);
  }
  refreshObjectSliceSync();
  return state.legacyTomographyDepthM;
}

export function setTomographyOpacity(opacity) {
  state.legacyTomographyOpacity = clamp(numberOf(opacity, DEFAULT_OPACITY), 0.12, 0.95);
  applySliceVisibility();
  return state.legacyTomographyOpacity;
}

export function setTomographySigmaFloor(sigmaFloor) {
  state.legacyTomographySigmaFloor = clamp(numberOf(sigmaFloor, 0), 0, 4);
  if (!state.legacyTomographyVisible || !state.legacyDikResult) return state.legacyTomographySigmaFloor;
  const depth = state.legacyTomographyDepthM;
  const opacity = state.legacyTomographyOpacity;
  addLegacyTomography(state.legacyDikResult, { sigmaFloor: state.legacyTomographySigmaFloor, opacity });
  setTomographyDepthM(depth);
  return state.legacyTomographySigmaFloor;
}

export function setTomographyPlaying(playing) {
  const want = !!playing;
  if (!want) {
    stopPlayTimer();
    return false;
  }
  const layer = getLegacyTomographyLayer();
  if (!layer) return false;
  stopPlayTimer();
  state.legacyTomographyPlaying = true;
  playTimer = setInterval(() => {
    const current = getLegacyTomographyLayer();
    if (!current) {
      stopPlayTimer();
      return;
    }
    const maxDepthM = numberOf(current.userData.maxDepthM, 10);
    const step = numberOf(current.userData.sliceStepM, maxDepthM / DEFAULT_SLICES);
    let next = numberOf(state.legacyTomographyDepthM, step) + step;
    if (next > maxDepthM + 1e-6) next = step * 0.5;
    setTomographyDepthM(next);
  }, PLAY_MS);
  return true;
}

export function focusTomographyOnDetection(detection) {
  if (!detection) return null;
  const top = Math.max(0, numberOf(detection.depthTopM, numberOf(detection.raw?.depthTopM, 0.5)));
  const bottom = Math.max(top + 0.1, numberOf(detection.depthBottomM, numberOf(detection.raw?.depthBottomM, top + 1)));
  const center = (top + bottom) * 0.5;
  const focusId = detection.detectionId || null;
  const opacity = state.legacyTomographyOpacity;
  const sigmaFloor = state.legacyTomographySigmaFloor;
  if (!addLegacyTomography(state.legacyDikResult, {
    focusDetectionId: focusId,
    opacity,
    sigmaFloor,
  })) {
    return null;
  }
  const layer = getLegacyTomographyLayer();
  if (!layer) return null;
  layer.userData.focusLowM = top;
  layer.userData.focusHighM = bottom;
  layer.userData.focusDetectionId = focusId;
  setTomographyDepthM(center);
  return getTomographyControlsState();
}

export function clearTomographyFocus() {
  const layer = getLegacyTomographyLayer();
  if (!layer) return;
  layer.userData.focusLowM = null;
  layer.userData.focusHighM = null;
  layer.userData.focusDetectionId = null;
  applySliceVisibility(layer);
}

export function toggleLegacyTomography(result = state.legacyDikResult) {
  if (getLegacyTomographyLayer()) {
    removeLegacyTomography();
    return false;
  }
  return !!addLegacyTomography(result);
}

export function isLegacyTomographyAvailable(result = state.legacyDikResult) {
  return !!gridOf(result);
}
