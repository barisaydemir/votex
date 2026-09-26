import { describe, expect, it, afterEach } from "vitest";
import * as THREE from "three";
import { state } from "../app/state.js";

if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = () => 0;
}
import {
  lateralEvidenceSegmentsForModel,
  addLegacyLateralEvidenceLayer,
  applyLegacyLateralEvidenceVisibility,
  removeLegacyLateralEvidenceLayer,
} from "./legacyLateralEvidenceLayer.js";

afterEach(() => {
  if (state.legacyDikGroup) removeLegacyLateralEvidenceLayer(state.legacyDikGroup);
  state.legacyDikGroup = null;
  state.legacyFieldModel = null;
  state.legacyMergedTargetViewMode = "simple";
  state.legacySelectedMergedTargetId = null;
  state.legacyTargetSession = { detectionId: null };
});

const model = () => ({
  detections: [
    { detectionId: "a", depthTopM: 1, depthBottomM: 2, raw: { cx: 2, cy: 2 } },
    { detectionId: "b", depthTopM: 1.1, depthBottomM: 2.1, raw: { cx: 2.8, cy: 2 } },
  ],
  mergePresentation: { detectionToTarget: { a: "legacy-target-1", b: "legacy-target-1" } },
  mergedTargets: [{
    targetId: "legacy-target-1",
    detectionIds: ["a", "b"],
    footprints: [
      { detectionId: "a", x: 2, z: 2 },
      { detectionId: "b", x: 2.8, z: 2 },
    ],
  }],
  evidenceRelations: [{
    relationId: "r1",
    fromDetectionId: "a",
    toDetectionId: "b",
    score: 0.76,
    scorePct: 76,
    reasons: ["komşu tarama adımı"],
  }],
});

const group = () => {
  const value = new THREE.Group();
  value.userData.fieldModel = model();
  value.userData.gridWidthM = 10;
  value.userData.gridDepthM = 10;
  value.userData.gridOriginXM = 0;
  value.userData.gridOriginZM = 0;
  return value;
};

describe("legacyLateralEvidenceLayer", () => {
  it("relation modelini ölçülen footprint merkezlerinden dünya segmentine çevirir", () => {
    const value = lateralEvidenceSegmentsForModel(model(), group());
    expect(value).toHaveLength(1);
    expect(value[0].from.x).toBeCloseTo(-3);
    expect(value[0].to.x).toBeCloseTo(-2.2);
    expect(value[0].from.y).toBeCloseTo(-1.5);
    expect(value[0].to.y).toBeCloseTo(-1.6);
  });

  it("çizgiyi yalnız kanıt görünümünde seçili hedef için gösterir", () => {
    const root = group();
    state.legacyDikGroup = root;
    state.legacyFieldModel = model();
    addLegacyLateralEvidenceLayer(root);
    const layer = root.getObjectByName("legacyLateralEvidenceLayer");
    expect(layer).not.toBeNull();
    expect(layer.visible).toBe(false);

    state.legacyFieldModel = model();
    state.legacySelectedMergedTargetId = "legacy-target-1";
    state.legacyMergedTargetViewMode = "evidence";
    applyLegacyLateralEvidenceVisibility();
    expect(layer.visible).toBe(true);
    expect(layer.children[0].userData.legacyLateralScorePct).toBe(76);

    state.legacyMergedTargetViewMode = "simple";
    applyLegacyLateralEvidenceVisibility();
    expect(layer.visible).toBe(false);
  });
});
