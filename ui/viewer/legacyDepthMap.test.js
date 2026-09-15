import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

vi.stubGlobal("requestAnimationFrame", () => 0);

import { state } from "../app/state.js";
import {
  addLegacyDepthMap,
  estimateDepthProxyGrid,
  getLegacyDepthMapLayer,
  removeLegacyDepthMap,
  setDepthMapOpacity,
  toggleLegacyDepthMap,
} from "./legacyDepthMap.js";

const result = {
  gridW: 3,
  gridH: 2,
  gridValues: [-6, -1, 0, 1, 2, 6],
  gridCoverage: [1, 1, 1, 2, 2, 2],
  anomalies: [{ cx: 1, cy: 1, kind: "anomaly", peakSigma: 3, depthTopM: 2, depthBottomM: 4 }],
  metals: [],
};

afterEach(() => {
  removeLegacyDepthMap();
  state.legacyDikGroup = null;
  state.legacyDikResult = null;
  state.legacyDepthMapVisible = false;
  state.legacyDepthMapOpacity = 0.72;
});

describe("legacyDepthMap", () => {
  it("güçlü residual hücreleri daha sığ tahmin eder", () => {
    const estimate = estimateDepthProxyGrid(result, { maxDepthM: 10, minDepthM: 0.5 });
    expect(estimate).toBeTruthy();
    expect(estimate.measuredCells).toBe(6);
    // index 0 = -6 (güçlü), index 2 = 0 (zayıf)
    expect(estimate.depths[0]).toBeLessThan(estimate.depths[2]);
    expect(estimate.minDepthM).toBeLessThan(estimate.maxDepthM);
  });

  it("plan katmanı üretir ve tespit peaking kullanmaz", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    state.legacyDikGroup.userData.depthMapM = 10;
    const layer = addLegacyDepthMap(result);
    expect(layer).toBeTruthy();
    expect(layer.name).toBe("legacyDepthMapLayer");
    expect(layer.userData.usesDetections).toBe(false);
    expect(layer.userData.isDepthProxy).toBe(true);
    expect(layer.getObjectByName("legacyDepthMapPlane")).toBeTruthy();
    expect(state.legacyDepthMapVisible).toBe(true);
  });

  it("aç/kapa tespit mesh’ini silmez", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
    marker.userData.legacyDetectionId = "legacy-dik-shape-1";
    state.legacyDikGroup.add(marker);

    expect(toggleLegacyDepthMap(result)).toBe(true);
    expect(getLegacyDepthMapLayer()).toBeTruthy();
    expect(state.legacyDikGroup.children.includes(marker)).toBe(true);

    expect(toggleLegacyDepthMap(result)).toBe(false);
    expect(getLegacyDepthMapLayer()).toBeNull();
    expect(state.legacyDikGroup.children.includes(marker)).toBe(true);
  });

  it("opaklık state’e yazılır", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    addLegacyDepthMap(result);
    expect(setDepthMapOpacity(0.5)).toBeCloseTo(0.5, 2);
    expect(state.legacyDepthMapOpacity).toBeCloseTo(0.5, 2);
  });

  it("grid yoksa katman oluşturmaz", () => {
    state.legacyDikGroup = new THREE.Group();
    expect(addLegacyDepthMap({ gridW: 0, gridH: 0, gridValues: [] })).toBeNull();
    expect(state.legacyDepthMapVisible).toBe(false);
  });
});
