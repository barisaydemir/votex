/**
 * Legacy3DMAG tahmini derinlik haritası (aç/kapa bakış katmanı).
 * Residual |σ| → derinlik proxy (güçlü=sığ, zayıf=derin).
 * Tespit / invert sonucunu değiştirmez; pick ışını yutmaz.
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";
import { normalizeLegacyResult } from "./legacyNormalize.js";

const GROUP_NAME = "legacyDepthMapLayer";
const DEFAULT_OPACITY = 0.72;
const MIN_DEPTH_M = 0.4;

/** Sığ (açık) → derin (koyu) derinlik paleti */
const DEPTH_STOPS = [
  { t: 0.0, r: 240, g: 236, b: 96 },
  { t: 0.28, r: 64, g: 200, b: 160 },
  { t: 0.55, r: 40, g: 110, b: 210 },
  { t: 0.78, r: 40, g: 50, b: 140 },
  { t: 1.0, r: 12, g: 14, b: 48 },
];

function numberOf(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function depthRgb(t01) {
  const t = clamp(t01, 0, 1);
  let lo = DEPTH_STOPS[0];
  let hi = DEPTH_STOPS[DEPTH_STOPS.length - 1];
  for (let i = 0; i < DEPTH_STOPS.length - 1; i += 1) {
    if (t >= DEPTH_STOPS[i].t && t <= DEPTH_STOPS[i + 1].t) {
      lo = DEPTH_STOPS[i];
      hi = DEPTH_STOPS[i + 1];
      break;
    }
  }
  const span = hi.t - lo.t || 1;
  const f = (t - lo.t) / span;
  return [
    Math.round(lo.r + (hi.r - lo.r) * f),
    Math.round(lo.g + (hi.g - lo.g) * f),
    Math.round(lo.b + (hi.b - lo.b) * f),
  ];
}

/**
 * Hücre başına tahmini derinlik (m). Invert değil; |σ| proxy.
 * @returns {{ depths: Float32Array, minDepthM: number, maxDepthM: number, measuredCells: number, maxAbs: number } | null}
 */
export function estimateDepthProxyGrid(result, options = {}) {
  const grid = gridOf(result);
  if (!grid) return null;

  const model = state.legacyDikGroup?.userData || {};
  const maxDepthCap = Math.max(
    2,
    numberOf(options.maxDepthM, numberOf(model.depthMapM, 10)),
  );
  const minDepthM = Math.max(0.2, numberOf(options.minDepthM, MIN_DEPTH_M));

  let maxAbs = 1e-6;
  let measuredCells = 0;
  for (let i = 0; i < grid.values.length; i += 1) {
    const value = Number(grid.values[i]);
    if (!(Number(grid.coverage[i]) > 0) || !Number.isFinite(value)) continue;
    measuredCells += 1;
    maxAbs = Math.max(maxAbs, Math.abs(value));
  }
  if (!measuredCells) return null;

  const depths = new Float32Array(grid.values.length);
  let depthMin = Infinity;
  let depthMax = -Infinity;

  for (let iy = 0; iy < grid.h; iy += 1) {
    for (let ix = 0; ix < grid.w; ix += 1) {
      const i = iy * grid.w + ix;
      const value = Number(grid.values[i]);
      if (!(Number(grid.coverage[i]) > 0) || !Number.isFinite(value)) {
        depths[i] = Number.NaN;
        continue;
      }
      const abs = Math.abs(value);
      // Komşu ortalama |σ| → yayılım: geniş/zayıf → biraz daha derin
      let neighborSum = abs;
      let neighborCount = 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = ix + dx;
          const ny = iy + dy;
          if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
          const ni = ny * grid.w + nx;
          const nv = Number(grid.values[ni]);
          if (!(Number(grid.coverage[ni]) > 0) || !Number.isFinite(nv)) continue;
          neighborSum += Math.abs(nv);
          neighborCount += 1;
        }
      }
      const localAbs = neighborSum / neighborCount;
      const strength = clamp(localAbs / maxAbs, 0, 1);
      // Güçlü → sığ; zayıf → derin
      const depth = minDepthM + (1 - strength) * (maxDepthCap - minDepthM);
      depths[i] = depth;
      depthMin = Math.min(depthMin, depth);
      depthMax = Math.max(depthMax, depth);
    }
  }

  return {
    grid,
    depths,
    minDepthM: Number.isFinite(depthMin) ? depthMin : minDepthM,
    maxDepthM: Number.isFinite(depthMax) ? depthMax : maxDepthCap,
    depthCapM: maxDepthCap,
    measuredCells,
    maxAbs,
  };
}

function makeDepthTexture(estimate) {
  const { grid, depths, minDepthM, maxDepthM, measuredCells } = estimate;
  const span = Math.max(maxDepthM - minDepthM, 1e-6);
  const data = new Uint8Array(grid.values.length * 4);

  for (let i = 0; i < depths.length; i += 1) {
    const offset = i * 4;
    const depth = depths[i];
    if (!Number.isFinite(depth)) {
      data[offset] = 48;
      data[offset + 1] = 52;
      data[offset + 2] = 60;
      data[offset + 3] = 30;
      continue;
    }
    const t = clamp((depth - minDepthM) / span, 0, 1);
    const [r, g, b] = depthRgb(t);
    const confidence = clamp(Number(grid.coverage[i]) / 3, 0, 1);
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = Math.round(110 + confidence * 90 + (1 - t) * 40);
  }

  const texture = new THREE.DataTexture(data, grid.w, grid.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.needsUpdate = true;
  texture.userData = { measuredCells, minDepthM, maxDepthM };
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

function skipRaycast() {}

export function getLegacyDepthMapLayer() {
  return state.legacyDikGroup?.getObjectByName(GROUP_NAME) || null;
}

export function isLegacyDepthMapAvailable(result = state.legacyDikResult) {
  return !!gridOf(result);
}

export function removeLegacyDepthMap() {
  const layer = getLegacyDepthMapLayer();
  if (!layer) {
    state.legacyDepthMapVisible = false;
    return false;
  }
  layer.parent?.remove(layer);
  disposeLayer(layer);
  state.legacyDepthMapVisible = false;
  if (state.legacyDikGroup) state.legacyDikGroup.userData.depthMapLayer = null;
  invalidate();
  return true;
}

export function addLegacyDepthMap(result = state.legacyDikResult, options = {}) {
  removeLegacyDepthMap();
  const estimate = estimateDepthProxyGrid(result, options);
  if (!state.legacyDikGroup || !estimate) return null;

  const model = state.legacyDikGroup.userData;
  const widthM = Math.max(0.5, numberOf(model?.gridWidthM, 4));
  const depthPlanM = Math.max(0.5, numberOf(model?.gridDepthM, 5));
  const opacity = clamp(
    numberOf(options.opacity, numberOf(state.legacyDepthMapOpacity, DEFAULT_OPACITY)),
    0.2,
    0.95,
  );
  state.legacyDepthMapOpacity = opacity;

  const texture = makeDepthTexture(estimate);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(widthM, depthPlanM), material);
  plane.rotation.x = -Math.PI / 2;
  // Manyetik grid’in biraz üstünde — bakış katmanı, tespit kotlarını değiştirmez.
  plane.position.set(0, 0.07, 0);
  plane.name = "legacyDepthMapPlane";
  plane.renderOrder = 5;
  plane.raycast = skipRaycast;
  plane.userData.legacyDepthMap = true;
  plane.userData.legacyDepthPersistent = true;
  plane.userData.ignorePick = true;

  const layer = new THREE.Group();
  layer.name = GROUP_NAME;
  layer.userData.legacyDepthMap = true;
  layer.userData.legacyDepthPersistent = true;
  layer.userData.usesDetections = false;
  layer.userData.isDepthProxy = true;
  layer.userData.proxyNote = "Tahmini derinlik proxy (m) — invert sonucu değil";
  layer.userData.minDepthM = estimate.minDepthM;
  layer.userData.maxDepthM = estimate.maxDepthM;
  layer.userData.depthCapM = estimate.depthCapM;
  layer.userData.measuredCells = estimate.measuredCells;
  layer.userData.maxAbs = estimate.maxAbs;
  layer.userData.opacity = opacity;
  layer.userData.gridW = estimate.grid.w;
  layer.userData.gridH = estimate.grid.h;
  layer.add(plane);

  state.legacyDikGroup.add(layer);
  state.legacyDepthMapVisible = true;
  state.legacyDikGroup.userData.depthMapLayer = layer;
  invalidate();
  return layer;
}

export function toggleLegacyDepthMap(result = state.legacyDikResult) {
  if (getLegacyDepthMapLayer()) {
    removeLegacyDepthMap();
    return false;
  }
  return !!addLegacyDepthMap(result);
}

export function setDepthMapOpacity(opacity) {
  state.legacyDepthMapOpacity = clamp(numberOf(opacity, DEFAULT_OPACITY), 0.2, 0.95);
  const layer = getLegacyDepthMapLayer();
  if (!layer) return state.legacyDepthMapOpacity;
  layer.userData.opacity = state.legacyDepthMapOpacity;
  layer.traverse((object) => {
    if (object.material && object.name === "legacyDepthMapPlane") {
      object.material.opacity = state.legacyDepthMapOpacity;
    }
  });
  invalidate();
  return state.legacyDepthMapOpacity;
}
