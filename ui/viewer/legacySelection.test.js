import { describe, expect, it, beforeEach } from "vitest";
import * as THREE from "three";
import { state } from "../app/state.js";
import {
  clearLegacySelection,
  applyLegacyStepVisibility,
} from "./legacyDikOverlay.js";
import {
  createLegacyTargetSession,
  targetSessionForStep,
  selectedStepOf,
  selectedDetectionOf,
} from "./legacyTargetSession.js";
import { createLegacyCaseStore } from "./legacyCaseStore.js";

describe("legacy ortak seçim filtresi", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((callback) => callback(performance.now()));
    const group = new THREE.Group();
    const stepOne = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    stepOne.userData.legacyStepIndex = 1;
    const stepTwo = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    stepTwo.userData.legacyStepIndex = 2;
    const untagged = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    group.add(stepOne, stepTwo, untagged);
    state.legacyDikGroup = group;
    state.legacyTargetSession = targetSessionForStep(1, { source: "test" });
    state.selectedStructureId = null;
  });

  it("seçili adımda etiketsiz katmanı da güvenli biçimde gizler", () => {
    const [stepOne, stepTwo, untagged] = state.legacyDikGroup.children;
    applyLegacyStepVisibility(1, null);
    expect(stepOne.visible).toBe(true);
    expect(stepTwo.visible).toBe(false);
    expect(untagged.visible).toBe(true);
  });

  it("Tümü ortak seçim durumunu sıfırlar", () => {
    clearLegacySelection();
    expect(state.legacyTargetSession.stepIndex).toBeNull();
    expect(state.legacyTargetSession.detectionId).toBeNull();
    expect(selectedStepOf(state.legacyTargetSession)).toBeNull();
    expect(selectedDetectionOf(state.legacyTargetSession)).toBeNull();
    expect(state.selectedStructureId).toBeNull();
    expect(state.legacyDikGroup.children.every((child) => child.visible)).toBe(true);
  });

  it("panel ve overlay için ortak case store seçim komutları aynı sözleşmeyi üretir", () => {
    const localState = { legacyTargetSession: null, selectedStructureId: null };
    const store = createLegacyCaseStore(localState);
    const step = store.selectStep(4, { source: "test" });
    expect(step).toMatchObject({ kind: "step", stepIndex: 4, detectionId: null, visibility: "step" });
    const detection = store.selectDetection("legacy-dik-shape-7", 4, { source: "test" });
    expect(detection).toMatchObject({ kind: "detection", stepIndex: 4, detectionId: "legacy-dik-shape-7", visibility: "selected-only" });
    const cleared = store.clearSelection({ source: "test" });
    expect(cleared).toMatchObject({ kind: "none", stepIndex: null, detectionId: null });
  });

  it("panel ve overlay için ortak case store seçim komutları aynı sözleşmeyi üretir", () => {
    const localState = { legacyTargetSession: null, selectedStructureId: null };
    const store = createLegacyCaseStore(localState);
    const step = store.selectStep(4, { source: "test" });
    expect(step).toMatchObject({ kind: "step", stepIndex: 4, detectionId: null, visibility: "step" });
    const detection = store.selectDetection("legacy-dik-shape-7", 4, { source: "test" });
    expect(detection).toMatchObject({ kind: "detection", stepIndex: 4, detectionId: "legacy-dik-shape-7", visibility: "selected-only" });
    const cleared = store.clearSelection({ source: "test" });
    expect(cleared).toMatchObject({ kind: "none", stepIndex: null, detectionId: null });
  });

  it("tespit seçimi detectionId’siz katman kökünü gizlemez", () => {
    const group = state.legacyDikGroup;
    const layer = new THREE.Group();
    layer.name = "legacyRealisticLayer";
    layer.userData.legacyRealistic = true;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    body.userData.legacyRealisticDetail = true;
    body.userData.legacyDetectionId = "legacy-dik-shape-1";
    body.userData.focusId = "legacy-dik-shape-1";
    body.userData.legacyVisualRole = "shape";
    layer.add(body);
    const other = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    other.userData.legacyRealisticDetail = true;
    other.userData.legacyDetectionId = "legacy-dik-shape-2";
    other.userData.focusId = "legacy-dik-shape-2";
    other.userData.legacyVisualRole = "shape";
    layer.add(other);
    group.add(layer);
    state.structureTargets = {
      "legacy-dik-shape-1": {
        object: body,
        position: body.position.clone(),
        radius: 1,
        title: "Test",
      },
    };
    state.legacyTargetSession = createLegacyTargetSession({ detectionId: "legacy-dik-shape-1", source: "test" });
    applyLegacyStepVisibility(null, "legacy-dik-shape-1");
    expect(layer.visible).toBe(true);
    expect(body.visible).toBe(true);
    expect(other.visible).toBe(false);
  });
});
