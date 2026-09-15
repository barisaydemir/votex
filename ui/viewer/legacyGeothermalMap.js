/**
 * Legacy3DMAG jeotermal 3D proxy haritası.
 * Aç/kapa katman — |σ| tabanlı ısı anomalisi skoru + termal LUT.
 * Gerçek °C ölçümü değil; tespit peaking / seçim / pick’e bağlı değil.
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";
import { normalizeLegacyResult } from "./legacyNormalize.js";

const GROUP_NAME = "legacyGeothermalMapLayer";
const DEFAULT_SLICES = 14;
const DEFAULT_OPACITY = 0.26;

/** colorizer.js “Termal” paleti ile uyumlu stops */
const THERMAL_STOPS = [
  { t: 0.0, r: 0, g: 0, b: 40 },
  { t: 0.2, r: 40, g: 0, b: 120 },
  { t: 0.4, r: 180, g: 0, b: 120 },
  { t: 0.6, r: 240, g: 60, b: 0 },
  { t: 0.8, r: 255, g: 200, b: 0 },
  { t: 1.0, r: 255, g: 255, b: 200 },
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

function thermalRgb(heat01) {
  const t = clamp(heat01, 0, 1);
  let lo = THERMAL_STOPS[0];
  let hi = THERMAL_STOPS[THERMAL_STOPS.length - 1];
  for (let i = 0; i < THERMAL_STOPS.length - 1; i += 1) {
    if (t >= THERMAL_STOPS[i].t && t <= THERMAL_STOPS[i + 1].t) {
      lo = THERMAL_STOPS[i];
      hi = THERMAL_STOPS[i + 1];
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

/** Sığ dilimler daha “sıcak” proxy alır; tespit merkezi kullanılmaz. */
function depthHeatBias(depthM, maxDepthM) {
  const t = clamp(depthM / Math.max(maxDepthM, 1e-6), 0, 1);
  return Math.max(0.28, 1 - t * 0.65);
}

function makeGeothermalSliceTexture(grid, depthBias) {
  const finiteValues = grid.values
    .filter((value, index) => Number(grid.coverage[index]) > 0 && Number.isFinite(Number(value)))
    .map(Number);
  if (!finiteValues.length) return null;
  const maxAbs = Math.max(...finiteValues.map((value) => Math.abs(value)), 1e-6);
  const data = new Uint8Array(grid.values.length * 4);

  for (let i = 0; i < grid.values.length; i += 1) {
    const offset = i * 4;
    const value = Number(grid.values[i]);
    const measured = Number(grid.coverage[i]) > 0 && Number.isFinite(value);
    if (!measured) {
      data[offset] = 18;
      data[offset + 1] = 16;
      data[offset + 2] = 28;
      data[offset + 3] = 24;
      continue;
    }
    // Isı proxy: |σ| oranı × derinlik bias — °C değil.
    const heat = clamp((Math.abs(value) / maxAbs) * depthBias, 0, 1);
    const [r, g, b] = thermalRgb(heat);
    const confidence = clamp(Number(grid.coverage[i]) / 3, 0, 1);
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = Math.round(55 + confidence * 55 + heat * 90);
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

function skipRaycast() {}

export function getLegacyGeothermalMapLayer() {
  return state.legacyDikGroup?.getObjectByName(GROUP_NAME) || null;
}

export function isLegacyGeothermalMapAvailable(result = state.legacyDikResult) {
  return !!gridOf(result);
}

export function removeLegacyGeothermalMap() {
  const layer = getLegacyGeothermalMapLayer();
  if (!layer) {
    state.legacyGeothermalMapVisible = false;
    return false;
  }
  layer.parent?.remove(layer);
  disposeLayer(layer);
  state.legacyGeothermalMapVisible = false;
  if (state.legacyDikGroup) state.legacyDikGroup.userData.geothermalMapLayer = null;
  invalidate();
  return true;
}

export function addLegacyGeothermalMap(result = state.legacyDikResult, options = {}) {
  removeLegacyGeothermalMap();
  const grid = gridOf(result);
  if (!state.legacyDikGroup || !grid) return null;

  const model = state.legacyDikGroup.userData;
  const widthM = Math.max(0.5, numberOf(model?.gridWidthM, 4));
  const depthPlanM = Math.max(0.5, numberOf(model?.gridDepthM, 5));
  const maxDepthM = Math.max(1, numberOf(options.maxDepthM, numberOf(model?.depthMapM, 10)));
  const slices = Math.max(4, Math.min(24, Math.round(numberOf(options.slices, DEFAULT_SLICES))));
  const opacity = clamp(
    numberOf(options.opacity, numberOf(state.legacyGeothermalMapOpacity, DEFAULT_OPACITY)),
    0.08,
    0.55,
  );

  state.legacyGeothermalMapOpacity = opacity;

  const layer = new THREE.Group();
  layer.name = GROUP_NAME;
  layer.userData.legacyGeothermalMap = true;
  layer.userData.legacyGeothermalPersistent = true;
  layer.userData.sliceCount = slices;
  layer.userData.maxDepthM = maxDepthM;
  layer.userData.opacity = opacity;
  layer.userData.gridW = grid.w;
  layer.userData.gridH = grid.h;
  layer.userData.usesDetections = false;
  layer.userData.isThermalProxy = true;
  layer.userData.proxyNote = "Isı anomalisi proxy (|σ|) — gerçek °C değil";

  let measuredCells = 0;
  let maxAbs = 1e-6;

  for (let index = 0; index < slices; index += 1) {
    const depth = ((index + 0.5) / slices) * maxDepthM;
    const depthBias = depthHeatBias(depth, maxDepthM);
    const texture = makeGeothermalSliceTexture(grid, depthBias);
    if (!texture) continue;
    measuredCells = texture.userData.measuredCells;
    maxAbs = Math.max(maxAbs, texture.userData.maxAbs);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: opacity * (0.5 + 0.5 * depthBias),
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    const slice = new THREE.Mesh(new THREE.PlaneGeometry(widthM, depthPlanM), material);
    slice.rotation.x = -Math.PI / 2;
    slice.position.set(0, -depth, 0);
    slice.name = `legacyGeothermalSlice-${index + 1}`;
    slice.renderOrder = 6 + index;
    slice.raycast = skipRaycast;
    slice.userData.legacyGeothermalMap = true;
    slice.userData.legacyGeothermalPersistent = true;
    slice.userData.depthM = depth;
    slice.userData.ignorePick = true;
    slice.visible = true;
    layer.add(slice);
  }

  layer.userData.measuredCells = measuredCells;
  layer.userData.maxAbs = maxAbs;

  state.legacyDikGroup.add(layer);
  state.legacyGeothermalMapVisible = true;
  state.legacyDikGroup.userData.geothermalMapLayer = layer;
  invalidate();
  return layer;
}

export function toggleLegacyGeothermalMap(result = state.legacyDikResult) {
  if (getLegacyGeothermalMapLayer()) {
    removeLegacyGeothermalMap();
    return false;
  }
  return !!addLegacyGeothermalMap(result);
}

export function setGeothermalMapOpacity(opacity) {
  state.legacyGeothermalMapOpacity = clamp(numberOf(opacity, DEFAULT_OPACITY), 0.08, 0.55);
  const layer = getLegacyGeothermalMapLayer();
  if (!layer) return state.legacyGeothermalMapOpacity;
  const maxDepthM = numberOf(layer.userData.maxDepthM, 10);
  const base = state.legacyGeothermalMapOpacity;
  layer.userData.opacity = base;
  layer.children.forEach((slice) => {
    if (!slice.material || !slice.name?.startsWith("legacyGeothermalSlice-")) return;
    const depthBias = depthHeatBias(numberOf(slice.userData.depthM), maxDepthM);
    slice.material.opacity = base * (0.5 + 0.5 * depthBias);
  });
  invalidate();
  return state.legacyGeothermalMapOpacity;
}
