/**
 * Legacy3DMAG yüzey altı 3D renk haritası.
 * Aç/kapa görüntü katmanı — tespit peaking, seçim ve pick’e bağlı değil.
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";
import { normalizeLegacyResult } from "./legacyNormalize.js";

const GROUP_NAME = "legacySubsurfaceMapLayer";
const DEFAULT_SLICES = 14;
const DEFAULT_OPACITY = 0.28;

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

function colorFor(value, maxAbs) {
  const t = clamp(value / Math.max(maxAbs, 1e-6), -1, 1);
  if (t < 0) {
    const a = -t;
    return [Math.round(24 + 42 * (1 - a)), Math.round(138 + 82 * (1 - a)), Math.round(255 - 34 * a)];
  }
  return [255, Math.round(226 - 142 * t), Math.round(232 - 214 * t)];
}

/** Yalnızca derinlik zayıflaması — tespit merkezi kullanılmaz. */
function depthAttenuation(depthM, maxDepthM) {
  const t = clamp(depthM / Math.max(maxDepthM, 1e-6), 0, 1);
  return Math.max(0.22, 1 - t * 0.72);
}

function makeVolumeSliceTexture(grid, depthFactor) {
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
      data[offset] = 72;
      data[offset + 1] = 78;
      data[offset + 2] = 88;
      data[offset + 3] = 28;
      continue;
    }
    const scaled = value * depthFactor;
    const [r, g, b] = colorFor(scaled, maxAbs);
    const confidence = clamp(Number(grid.coverage[i]) / 3, 0, 1);
    const strength = clamp(Math.abs(scaled) / maxAbs, 0, 1);
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = Math.round(70 + confidence * 70 + strength * 50);
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

function skipRaycast() {
  // Pick’in tespit mesh’lerine ulaşması için harita dilimleri ışını yutmaz.
}

export function getLegacySubsurfaceMapLayer() {
  return state.legacyDikGroup?.getObjectByName(GROUP_NAME) || null;
}

export function isLegacySubsurfaceMapAvailable(result = state.legacyDikResult) {
  return !!gridOf(result);
}

export function removeLegacySubsurfaceMap() {
  const layer = getLegacySubsurfaceMapLayer();
  if (!layer) {
    state.legacySubsurfaceMapVisible = false;
    return false;
  }
  layer.parent?.remove(layer);
  disposeLayer(layer);
  state.legacySubsurfaceMapVisible = false;
  if (state.legacyDikGroup) state.legacyDikGroup.userData.subsurfaceMapLayer = null;
  invalidate();
  return true;
}

export function addLegacySubsurfaceMap(result = state.legacyDikResult, options = {}) {
  removeLegacySubsurfaceMap();
  const grid = gridOf(result);
  if (!state.legacyDikGroup || !grid) return null;

  const model = state.legacyDikGroup.userData;
  const widthM = Math.max(0.5, numberOf(model?.gridWidthM, 4));
  const depthPlanM = Math.max(0.5, numberOf(model?.gridDepthM, 5));
  const maxDepthM = Math.max(1, numberOf(options.maxDepthM, numberOf(model?.depthMapM, 10)));
  const slices = Math.max(4, Math.min(24, Math.round(numberOf(options.slices, DEFAULT_SLICES))));
  const opacity = clamp(
    numberOf(options.opacity, numberOf(state.legacySubsurfaceMapOpacity, DEFAULT_OPACITY)),
    0.08,
    0.55,
  );

  state.legacySubsurfaceMapOpacity = opacity;

  const layer = new THREE.Group();
  layer.name = GROUP_NAME;
  layer.userData.legacySubsurfaceMap = true;
  layer.userData.legacySubsurfacePersistent = true;
  layer.userData.sliceCount = slices;
  layer.userData.maxDepthM = maxDepthM;
  layer.userData.opacity = opacity;
  layer.userData.gridW = grid.w;
  layer.userData.gridH = grid.h;
  layer.userData.usesDetections = false;

  let measuredCells = 0;
  let maxAbs = 1e-6;

  for (let index = 0; index < slices; index += 1) {
    const depth = ((index + 0.5) / slices) * maxDepthM;
    const depthFactor = depthAttenuation(depth, maxDepthM);
    const texture = makeVolumeSliceTexture(grid, depthFactor);
    if (!texture) continue;
    measuredCells = texture.userData.measuredCells;
    maxAbs = Math.max(maxAbs, texture.userData.maxAbs);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: opacity * (0.55 + 0.45 * depthFactor),
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    const slice = new THREE.Mesh(new THREE.PlaneGeometry(widthM, depthPlanM), material);
    slice.rotation.x = -Math.PI / 2;
    slice.position.set(0, -depth, 0);
    slice.name = `legacySubsurfaceSlice-${index + 1}`;
    slice.renderOrder = 8 + index;
    slice.raycast = skipRaycast;
    slice.userData.legacySubsurfaceMap = true;
    slice.userData.legacySubsurfacePersistent = true;
    slice.userData.depthM = depth;
    slice.userData.ignorePick = true;
    slice.visible = true;
    layer.add(slice);
  }

  layer.userData.measuredCells = measuredCells;
  layer.userData.maxAbs = maxAbs;

  state.legacyDikGroup.add(layer);
  state.legacySubsurfaceMapVisible = true;
  state.legacyDikGroup.userData.subsurfaceMapLayer = layer;
  invalidate();
  return layer;
}

export function toggleLegacySubsurfaceMap(result = state.legacyDikResult) {
  if (getLegacySubsurfaceMapLayer()) {
    removeLegacySubsurfaceMap();
    return false;
  }
  return !!addLegacySubsurfaceMap(result);
}

export function setSubsurfaceMapOpacity(opacity) {
  state.legacySubsurfaceMapOpacity = clamp(numberOf(opacity, DEFAULT_OPACITY), 0.08, 0.55);
  const layer = getLegacySubsurfaceMapLayer();
  if (!layer) return state.legacySubsurfaceMapOpacity;
  const maxDepthM = numberOf(layer.userData.maxDepthM, 10);
  const base = state.legacySubsurfaceMapOpacity;
  layer.userData.opacity = base;
  layer.children.forEach((slice) => {
    if (!slice.material || !slice.name?.startsWith("legacySubsurfaceSlice-")) return;
    const depthFactor = depthAttenuation(numberOf(slice.userData.depthM), maxDepthM);
    slice.material.opacity = base * (0.55 + 0.45 * depthFactor);
  });
  invalidate();
  return state.legacySubsurfaceMapOpacity;
}
