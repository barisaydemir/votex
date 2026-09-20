import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";
import { mergePolicyOf } from "./legacyMergedTargetModel.js";
import { setUnifiedObjectMapVisible } from "./legacyVisibilityController.js";

const GROUP_NAME = "legacyUnifiedObjectMapLayer";

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function pointOf(evidence, group, canonicalFootprint = null) {
  const raw = evidence?.raw || {};
  if (canonicalFootprint) {
    const width = finite(canonicalFootprint.widthM, 0.25);
    const length = finite(canonicalFootprint.lengthM, 0.25);
    return {
      x: finite(canonicalFootprint.x) - (finite(group.userData.gridOriginXM) + finite(group.userData.gridWidthM, 4) * 0.5),
      z: finite(canonicalFootprint.z) - (finite(group.userData.gridOriginZM) + finite(group.userData.gridDepthM, 5) * 0.5),
      rx: Math.max(width * 0.5, 0.06),
      rz: Math.max(length * 0.5, 0.06),
      detectionId: String(evidence?.detectionId || canonicalFootprint.detectionId || ""),
      stepIndex: Number(canonicalFootprint.stepIndex ?? evidence?.stepIndex) || null,
    };
  }
  const width = finite(group.userData.gridWidthM, 4);
  const depth = finite(group.userData.gridDepthM, 5);
  const originX = finite(group.userData.gridOriginXM);
  const originZ = finite(group.userData.gridOriginZM);
  return {
    x: finite(raw.cx, finite(evidence?.stationM)) - (originX + width * 0.5),
    z: finite(raw.cy, finite(evidence?.offsetM)) - (originZ + depth * 0.5),
    rx: Math.max(finite(raw.rx, finite(raw.widthM, 0.25) * 0.5), 0.06),
    rz: Math.max(finite(raw.ry, finite(raw.lengthM, 0.25) * 0.5), 0.06),
    detectionId: String(evidence?.detectionId || ""),
    stepIndex: Number(evidence?.stepIndex) || null,
  };
}

function footprintPolygon(center) {
  return [
    { x: center.x - center.rx, z: center.z - center.rz },
    { x: center.x + center.rx, z: center.z - center.rz },
    { x: center.x + center.rx, z: center.z + center.rz },
    { x: center.x - center.rx, z: center.z + center.rz },
  ];
}

/**
 * Returns one measured footprint per evidence item. Connector decisions are
 * canonical model output; this renderer never re-runs the merge-distance rule.
 */
export function connectedFootprintsForTarget(target, group, options = {}) {
  const evidence = Array.isArray(target?.evidence) ? target.evidence : [];
  const footprints = new Map((Array.isArray(target?.footprints) ? target.footprints : []).map((item) => [String(item.detectionId), item]));
  const centers = evidence.map((item) => pointOf(item, group, footprints.get(String(item.detectionId))));
  const byId = new Map(centers.map((center) => [center.detectionId, center]));
  const policy = mergePolicyOf(options);
  const canonicalConnectors = Array.isArray(target?.connectors) ? target.connectors : [];
  const connectors = canonicalConnectors.flatMap((connector) => {
    const from = byId.get(String(connector.fromDetectionId));
    const to = byId.get(String(connector.toDetectionId));
    if (!from || !to) return [];
    return [{
      from,
      to,
      gapM: finite(connector.gapM, 0),
      widthM: Math.max(0.08, finite(connector.widthM, Math.min(...centers.map((item) => Math.min(item.rx, item.rz)), 0.35) * policy.connectorWidthRatio)),
    }];
  });
  return { footprints: centers.map(footprintPolygon), connectors, centers };
}

export function getLegacyUnifiedObjectMapLayer() {
  return state.legacyDikGroup?.getObjectByName(GROUP_NAME) || null;
}

export function isLegacyUnifiedObjectMapAvailable() {
  return !!state.legacyDikGroup?.userData?.fieldModel?.mergedTargets?.length;
}

function disposeLayer(layer) {
  layer?.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => {
      material.map?.dispose?.();
      material.dispose?.();
    });
  });
}

export function removeLegacyUnifiedObjectMap() {
  const layer = getLegacyUnifiedObjectMapLayer();
  if (!layer) {
    setUnifiedObjectMapVisible(state, false);
    return false;
  }
  layer.parent?.remove(layer);
  disposeLayer(layer);
  setUnifiedObjectMapVisible(state, false);
  invalidate();
  return true;
}

function makeFootprintShape(points) {
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.z);
    else shape.lineTo(point.x, point.z);
  });
  shape.closePath();
  return shape;
}

function makeConnectorShape(from, to, width) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return null;
  const nx = -dz / length * width * 0.5;
  const nz = dx / length * width * 0.5;
  return makeFootprintShape([
    { x: from.x + nx, z: from.z + nz },
    { x: to.x + nx, z: to.z + nz },
    { x: to.x - nx, z: to.z - nz },
    { x: from.x - nx, z: from.z - nz },
  ]);
}

function addExtrudedPart(targetLayer, shape, top, height, color, metadata, name, opacity = 0.58) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.55,
    metalness: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  mesh.position.y = -top;
  mesh.name = name;
  Object.assign(mesh.userData, metadata);
  targetLayer.add(mesh);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  edge.position.copy(mesh.position);
  edge.name = `${name}-edge`;
  Object.assign(edge.userData, metadata);
  targetLayer.add(edge);
}

export function addLegacyUnifiedObjectMap() {
  removeLegacyUnifiedObjectMap();
  const group = state.legacyDikGroup;
  const targets = group?.userData?.fieldModel?.mergedTargets;
  if (!group || !Array.isArray(targets) || !targets.length) return null;

  const layer = new THREE.Group();
  layer.name = GROUP_NAME;
  layer.userData.legacyUnifiedObjectMap = true;
  layer.userData.legacySubsurfacePersistent = true;

  targets.forEach((target, index) => {
    const parts = connectedFootprintsForTarget(target, group);
    if (!parts.footprints.length) return;
    const top = Math.max(0.08, finite(target.depthTopM, 0.4));
    const bottom = Math.max(top + 0.18, finite(target.depthBottomM, top + 0.6));
    const height = Math.min(bottom - top, finite(group.userData.depthMapM, 10) - top);
    if (height <= 0) return;
    const color = String(target.type || "").toLowerCase().includes("metal") ? 0xff6b5e : 0xffc857;
    const connectorColor = 0x74c2ff;
    const metadata = {
      legacyUnifiedObject: true,
      legacyMergedTarget: true,
      legacyMergedTargetId: target.targetId,
      legacyDetectionIds: target.detectionIds.map(String),
      legacyStepIndices: target.stepIndices.map(Number),
      legacyEvidenceQuality: target.evidenceQuality || "single",
      legacyMergeReasons: target.mergeReasons || [],
    };
    const targetLayer = new THREE.Group();
    targetLayer.name = `legacyUnifiedObject-${index + 1}`;
    Object.assign(targetLayer.userData, metadata);
    layer.add(targetLayer);

    parts.footprints.forEach((footprint, footprintIndex) => {
      addExtrudedPart(
        targetLayer,
        makeFootprintShape(footprint),
        top,
        height,
        color,
        { ...metadata, legacyEvidenceFootprint: true, legacyEvidenceId: parts.centers[footprintIndex]?.detectionId || null, legacyEvidenceStepIndex: parts.centers[footprintIndex]?.stepIndex || null },
        `legacyUnifiedEvidence-${index + 1}-${footprintIndex + 1}`,
      );
    });

    // Koridor yalnızca ölçülen ayak izleri arasındaki küçük yatay boşluklarda
    // çizilir. Büyük boşluklar gerçek boşluk olarak görünür.
    parts.connectors.forEach((connector, connectorIndex) => {
      const shape = makeConnectorShape(connector.from, connector.to, connector.widthM);
      if (!shape) return;
      addExtrudedPart(
        targetLayer,
        shape,
        top,
        height,
        connectorColor,
        { ...metadata, legacyEvidenceConnector: true, legacyConnectorGapM: connector.gapM, legacyConnectorWidthM: connector.widthM },
        `legacyUnifiedConnector-${index + 1}-${connectorIndex + 1}`,
        0.42,
      );
    });
  });

  group.add(layer);
  setUnifiedObjectMapVisible(state, true);
  invalidate();
  return layer;
}

export function toggleLegacyUnifiedObjectMap() {
  return getLegacyUnifiedObjectMapLayer() ? !removeLegacyUnifiedObjectMap() : !!addLegacyUnifiedObjectMap();
}
