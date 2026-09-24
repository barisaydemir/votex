import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";

const GROUP_NAME = "legacyLateralEvidenceLayer";

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function depthCenterOf(detection) {
  const top = Number(detection?.depthTopM);
  const bottom = Number(detection?.depthBottomM ?? detection?.depthTopM);
  if (Number.isFinite(top) && Number.isFinite(bottom)) return Math.max(0.08, (top + bottom) * 0.5);
  if (Number.isFinite(top)) return Math.max(0.08, top);
  return 0.5;
}

function detectionFootprintOf(fieldModel, detectionId) {
  const targets = Array.isArray(fieldModel?.mergedTargets) ? fieldModel.mergedTargets : [];
  for (const target of targets) {
    const footprint = (Array.isArray(target?.footprints) ? target.footprints : [])
      .find((item) => String(item?.detectionId) === String(detectionId));
    if (footprint) return footprint;
  }
  return null;
}

function worldPointOf(fieldModel, group, detection) {
  const footprint = detectionFootprintOf(fieldModel, detection?.detectionId);
  const originX = finite(group?.userData?.gridOriginXM);
  const originZ = finite(group?.userData?.gridOriginZM);
  const width = finite(group?.userData?.gridWidthM, 4);
  const depth = finite(group?.userData?.gridDepthM, 5);
  const raw = detection?.raw || {};
  const x = footprint ? finite(footprint.x) : finite(raw.cx, finite(detection?.stationM));
  const z = footprint ? finite(footprint.z) : finite(raw.cy, finite(detection?.offsetM));
  return new THREE.Vector3(
    x - (originX + width * 0.5),
    -depthCenterOf(detection),
    z - (originZ + depth * 0.5),
  );
}

/**
 * Converts model-only lateral relations to world-space segments. This is an
 * explanatory sensor-response path; it never changes a measured footprint.
 */
export function lateralEvidenceSegmentsForModel(fieldModel, group) {
  const detections = new Map((Array.isArray(fieldModel?.detections) ? fieldModel.detections : [])
    .map((item) => [String(item.detectionId), item]));
  const detectionToTarget = fieldModel?.mergePresentation?.detectionToTarget || {};
  return (Array.isArray(fieldModel?.evidenceRelations) ? fieldModel.evidenceRelations : [])
    .map((relation) => {
      const from = detections.get(String(relation.fromDetectionId));
      const to = detections.get(String(relation.toDetectionId));
      if (!from || !to) return null;
      return {
        ...relation,
        from: worldPointOf(fieldModel, group, from),
        to: worldPointOf(fieldModel, group, to),
        fromTargetId: detectionToTarget[String(relation.fromDetectionId)] || null,
        toTargetId: detectionToTarget[String(relation.toDetectionId)] || null,
      };
    })
    .filter(Boolean);
}

export function getLegacyLateralEvidenceLayer(group = state.legacyDikGroup) {
  return group?.getObjectByName(GROUP_NAME) || null;
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

export function removeLegacyLateralEvidenceLayer(group = state.legacyDikGroup) {
  const layer = getLegacyLateralEvidenceLayer(group);
  if (!layer) return false;
  layer.parent?.remove(layer);
  disposeLayer(layer);
  invalidate();
  return true;
}

function addRelationVisual(layer, segment, index) {
  const relationGroup = new THREE.Group();
  relationGroup.name = `legacyLateralRelation-${index + 1}`;
  Object.assign(relationGroup.userData, {
    legacyLateralEvidence: true,
    legacyLateralRelationId: segment.relationId,
    legacyLateralDetectionIds: [segment.fromDetectionId, segment.toDetectionId],
    legacyLateralTargetIds: [segment.fromTargetId, segment.toTargetId].filter(Boolean),
    legacyLateralScore: segment.score,
    legacyLateralScorePct: segment.scorePct,
    legacyLateralBaseScorePct: segment.baseScorePct ?? segment.scorePct,
    legacyLateralCalibrationDeltaPct: segment.calibrationScoreDeltaPct ?? 0,
    legacyLateralCalibration: segment.calibration || null,
    legacyLateralReasons: segment.reasons || [],
    legacyLateralProxy: true,
  });

  const geometry = new THREE.BufferGeometry().setFromPoints([segment.from, segment.to]);
  const material = new THREE.LineDashedMaterial({
    color: 0x69c7ff,
    transparent: true,
    opacity: 0.82,
    dashSize: 0.12,
    gapSize: 0.08,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  line.name = `${relationGroup.name}-line`;
  line.userData.legacyLateralEvidence = true;
  relationGroup.add(line);

  const endpointMaterial = new THREE.MeshBasicMaterial({
    color: 0x9cddff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  [segment.from, segment.to].forEach((point, endpointIndex) => {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 6), endpointMaterial.clone());
    marker.position.copy(point);
    marker.name = `${relationGroup.name}-endpoint-${endpointIndex + 1}`;
    marker.userData.legacyLateralEvidence = true;
    relationGroup.add(marker);
  });

  layer.add(relationGroup);
}

export function addLegacyLateralEvidenceLayer(group = state.legacyDikGroup) {
  removeLegacyLateralEvidenceLayer(group);
  const fieldModel = group?.userData?.fieldModel;
  if (!group || !Array.isArray(fieldModel?.evidenceRelations) || !fieldModel.evidenceRelations.length) return null;

  const layer = new THREE.Group();
  layer.name = GROUP_NAME;
  layer.userData.legacyLateralEvidenceLayer = true;
  layer.userData.legacyLateralEvidencePersistent = true;
  const segments = lateralEvidenceSegmentsForModel(fieldModel, group);
  segments.forEach((segment, index) => addRelationVisual(layer, segment, index));
  if (!layer.children.length) return null;
  group.add(layer);
  applyLegacyLateralEvidenceVisibility();
  invalidate();
  return layer;
}

/**
 * Lateral lines are deliberately visible only in the selected target's
 * explanatory evidence view (or for a directly selected detection). The
 * default simple/full views never imply a physical connector.
 */
export function applyLegacyLateralEvidenceVisibility(options = {}) {
  const layer = getLegacyLateralEvidenceLayer(options.group || state.legacyDikGroup);
  if (!layer) return false;
  const mode = String(options.viewMode ?? state.legacyMergedTargetViewMode ?? "simple");
  const selectedTargetId = options.targetId ?? state.legacySelectedMergedTargetId ?? null;
  const selectedDetectionId = options.detectionId
    ?? state.legacyTargetSession?.detectionId
    ?? null;
  const selectedTarget = selectedTargetId
    ? state.legacyFieldModel?.mergedTargets?.find((target) => String(target.targetId) === String(selectedTargetId))
    : null;
  const selectedIds = new Set((selectedTarget?.detectionIds || []).map(String));
  if (selectedDetectionId != null) selectedIds.add(String(selectedDetectionId));

  layer.visible = mode === "evidence" && selectedIds.size > 0;
  layer.children.forEach((relationGroup) => {
    const ids = (relationGroup.userData?.legacyLateralDetectionIds || []).map(String);
    const matches = ids.some((id) => selectedIds.has(id));
    relationGroup.visible = layer.visible && matches;
  });
  invalidate();
  return layer.visible;
}

/** Rebuilds only the explanatory layer after calibration/model state changes. */
export function refreshLegacyLateralEvidenceLayer(group = state.legacyDikGroup) {
  if (!group) return null;
  if (state.legacyFieldModel) group.userData.fieldModel = state.legacyFieldModel;
  return addLegacyLateralEvidenceLayer(group);
}

export { GROUP_NAME as LEGACY_LATERAL_EVIDENCE_GROUP_NAME };
