import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";
import { setUndergroundSlicesVisible } from "./legacyVisibilityController.js";
import { normalizeLegacyResult } from "./legacyNormalize.js";

const GROUP_NAME = "legacyUndergroundMapLayer";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function gridInfo(result) {
  const normalized = normalizeLegacyResult(result);
  const values = Array.isArray(normalized.gridValues) ? normalized.gridValues.map(Number) : [];
  const coverage = Array.isArray(normalized.gridCoverage) && normalized.gridCoverage.length === values.length
    ? normalized.gridCoverage.map(Number)
    : values.map(() => 1);
  let cols = Math.round(finite(normalized.gridW));
  let rows = Math.round(finite(normalized.gridH));
  if (cols < 2 || rows < 2 || values.length !== cols * rows) {
    const side = Math.round(Math.sqrt(values.length));
    if (side < 2 || side * side !== values.length) return null;
    cols = side;
    rows = side;
  }
  return { normalized, values, coverage, cols, rows };
}

function detectionPoint(detection) {
  const raw = detection?.raw || {};
  return {
    x: finite(raw.cx, finite(detection?.stationM)),
    z: finite(raw.cy, finite(detection?.offsetM)),
    top: Math.max(0, finite(detection?.depthTopM, 0.4)),
    bottom: Math.max(0.5, finite(detection?.depthBottomM, finite(detection?.depthTopM, 0.4) + 0.5)),
    confidence: clamp(finite(detection?.confidence, 0.35), 0.05, 1),
    strength: Math.max(0.1, Math.abs(finite(detection?.raw?.peakSigma, finite(detection?.raw?.strength, 1)))),
  };
}

function maxSignal(detections) {
  return Math.max(1, ...detections.map((item) => detectionPoint(item).strength));
}

/**
 * Creates a stable, serializable underground volume. It combines residual grid
 * evidence with every detection in the same coordinate/depth space.
 */
export function buildLegacyUndergroundVolume(result, fieldModel = null, options = {}) {
  const info = gridInfo(result);
  if (!info) return null;
  const widthM = Math.max(0.5, finite(info.normalized.gridWidthM, 4));
  const depthM = Math.max(0.5, finite(info.normalized.gridDepthM, 5));
  const maxDepthM = Math.max(1, finite(options.maxDepthM, Math.max(10, ...((fieldModel?.detections || []).map((d) => detectionPoint(d).bottom)))));
  const slices = clamp(Math.round(finite(options.slices, 12)), 4, 24);
  const detections = Array.isArray(fieldModel?.detections) ? fieldModel.detections : [];
  const signalMax = maxSignal(detections);
  const originX = finite(info.normalized.gridOriginXM);
  const originZ = finite(info.normalized.gridOriginYM, finite(info.normalized.gridOriginZM));
  const layers = [];

  for (let slice = 0; slice < slices; slice += 1) {
    const depthCenterM = ((slice + 0.5) / slices) * maxDepthM;
    const values = new Array(info.values.length).fill(0);
    const confidence = new Array(info.values.length).fill(0);
    for (let row = 0; row < info.rows; row += 1) {
      for (let col = 0; col < info.cols; col += 1) {
        const index = row * info.cols + col;
        const x = ((col + 0.5) / info.cols - 0.5) * widthM;
        const z = ((row + 0.5) / info.rows - 0.5) * depthM;
        const base = Number.isFinite(info.values[index]) && info.coverage[index] > 0
          ? Math.abs(info.values[index]) / Math.max(...info.values.map((v) => Math.abs(Number(v)) || 0), 1)
          : 0;
        let score = base * 0.22;
        let certainty = info.coverage[index] > 0 ? 0.12 : 0;
        detections.forEach((detection) => {
          const point = detectionPoint(detection);
          point.x -= originX + widthM * 0.5;
          point.z -= originZ + depthM * 0.5;
          const horizontal = Math.hypot(x - point.x, z - point.z);
          const radius = Math.max(finite(detection.raw?.rx, 0.35), finite(detection.raw?.ry, 0.35), 0.3);
          const horizontalWeight = Math.exp(-((horizontal / (radius * 2.2)) ** 2));
          const depthWeight = point.top <= depthCenterM && point.bottom >= depthCenterM
            ? 1
            : Math.exp(-Math.abs(depthCenterM - (point.top + point.bottom) * 0.5) / Math.max((point.bottom - point.top) * 1.5, 0.35));
          const contribution = horizontalWeight * depthWeight * point.confidence * clamp(point.strength / signalMax, 0.1, 1);
          score += contribution;
          certainty += horizontalWeight * depthWeight * point.confidence;
        });
        values[index] = clamp(score, 0, 1);
        confidence[index] = clamp(certainty, 0, 1);
      }
    }
    layers.push({ depthCenterM, values, confidence });
  }
  return { widthM, depthM, maxDepthM, rows: info.rows, cols: info.cols, slices, layers, detectionCount: detections.length };
}

function colorOf(value, confidence) {
  const t = clamp(value, 0, 1);
  const cool = [28, 95, 190];
  const hot = [255, 78, 46];
  const mix = t;
  return [
    Math.round(cool[0] + (hot[0] - cool[0]) * mix),
    Math.round(cool[1] + (hot[1] - cool[1]) * mix),
    Math.round(cool[2] + (hot[2] - cool[2]) * mix),
    Math.round(35 + clamp(confidence, 0, 1) * 190),
  ];
}

function textureFor(volume, layer) {
  const data = new Uint8Array(layer.values.length * 4);
  layer.values.forEach((value, index) => {
    const rgba = colorOf(value, layer.confidence[index]);
    data.set(rgba, index * 4);
  });
  const texture = new THREE.DataTexture(data, volume.cols, volume.rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}

function disposeLayer(layer) {
  layer?.traverse((object) => {
    object.geometry?.dispose?.();
    const material = object.material;
    (Array.isArray(material) ? material : [material]).filter(Boolean).forEach((item) => {
      item.map?.dispose?.();
      item.dispose?.();
    });
  });
}

export function getLegacyUndergroundMapLayer() {
  return state.legacyDikGroup?.getObjectByName(GROUP_NAME) || null;
}

export function isLegacyUndergroundMapAvailable(result = state.legacyDikResult) {
  return !!gridInfo(result);
}

export function removeLegacyUndergroundMap() {
  const layer = getLegacyUndergroundMapLayer();
  if (!layer) {
    setUndergroundSlicesVisible(state, false);
    return false;
  }
  layer.parent?.remove(layer);
  disposeLayer(layer);
  setUndergroundSlicesVisible(state, false);
  invalidate();
  return true;
}

export function addLegacyUndergroundMap(result = state.legacyDikResult, options = {}) {
  removeLegacyUndergroundMap();
  if (!state.legacyDikGroup) return null;
  const volume = buildLegacyUndergroundVolume(result, state.legacyFieldModel, options);
  if (!volume) return null;
  const layer = new THREE.Group();
  layer.name = GROUP_NAME;
  layer.userData.legacyUndergroundMap = true;
  layer.userData.legacySubsurfacePersistent = true;
  layer.userData.volume = volume;
  const centerX = 0;
  const centerZ = 0;
  volume.layers.forEach((item, index) => {
    const texture = textureFor(volume, item);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.34, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(volume.widthM, volume.depthM), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(centerX, -item.depthCenterM, centerZ);
    mesh.name = `legacyUndergroundSlice-${index + 1}`;
    mesh.userData.legacyUndergroundMap = true;
    mesh.userData.legacySubsurfacePersistent = true;
    mesh.userData.depthM = item.depthCenterM;
    mesh.userData.ignorePick = true;
    mesh.raycast = () => {};
    mesh.renderOrder = 20 + index;
    layer.add(mesh);
  });
  state.legacyDikGroup.add(layer);
  setUndergroundSlicesVisible(state, true);
  invalidate();
  return layer;
}

export function toggleLegacyUndergroundMap(result = state.legacyDikResult) {
  return getLegacyUndergroundMapLayer() ? !removeLegacyUndergroundMap() : !!addLegacyUndergroundMap(result);
}
