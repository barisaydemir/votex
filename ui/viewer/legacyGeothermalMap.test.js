import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

vi.stubGlobal("requestAnimationFrame", () => 0);

import { state } from "../app/state.js";
import {
  addLegacyGeothermalMap,
  getLegacyGeothermalMapLayer,
  removeLegacyGeothermalMap,
  setGeothermalMapOpacity,
  toggleLegacyGeothermalMap,
} from "./legacyGeothermalMap.js";

const result = {
  gridW: 3,
  gridH: 2,
  gridValues: [-3, -1, 0, 2, 4, 6],
  gridCoverage: [1, 1, 1, 2, 2, 2],
  anomalies: [{ cx: 1, cy: 1, kind: "anomaly", peakSigma: 3, depthTopM: 2, depthBottomM: 4, widthM: 1, lengthM: 1 }],
  metals: [],
};

afterEach(() => {
  removeLegacyGeothermalMap();
  state.legacyDikGroup = null;
  state.legacyDikResult = null;
  state.legacyGeothermalMapVisible = false;
  state.legacyGeothermalMapOpacity = 0.26;
});

describe("legacyGeothermalMap", () => {
  it("termal proxy hacim dilimlerini görünür üretir", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    state.legacyDikGroup.userData.depthMapM = 10;
    const layer = addLegacyGeothermalMap(result, { slices: 8 });

    expect(layer).toBeTruthy();
    expect(layer.name).toBe("legacyGeothermalMapLayer");
    expect(layer.userData.usesDetections).toBe(false);
    expect(layer.userData.isThermalProxy).toBe(true);
    const slices = layer.children.filter((object) => object.name.startsWith("legacyGeothermalSlice-"));
    expect(slices).toHaveLength(8);
    expect(slices.every((slice) => slice.visible)).toBe(true);
    expect(state.legacyGeothermalMapVisible).toBe(true);
  });

  it("aç/kapa tespit mesh’ini silmez", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
    marker.userData.legacyDetectionId = "legacy-dik-shape-1";
    state.legacyDikGroup.add(marker);

    expect(toggleLegacyGeothermalMap(result)).toBe(true);
    expect(getLegacyGeothermalMapLayer()).toBeTruthy();
    expect(state.legacyDikGroup.children.includes(marker)).toBe(true);

    expect(toggleLegacyGeothermalMap(result)).toBe(false);
    expect(getLegacyGeothermalMapLayer()).toBeNull();
    expect(state.legacyDikGroup.children.includes(marker)).toBe(true);
  });

  it("opaklık state’e yazılır", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    addLegacyGeothermalMap(result, { slices: 4 });
    expect(setGeothermalMapOpacity(0.35)).toBeCloseTo(0.35, 2);
    expect(state.legacyGeothermalMapOpacity).toBeCloseTo(0.35, 2);
  });

  it("grid yoksa katman oluşturmaz", () => {
    state.legacyDikGroup = new THREE.Group();
    expect(addLegacyGeothermalMap({ gridW: 0, gridH: 0, gridValues: [] })).toBeNull();
    expect(state.legacyGeothermalMapVisible).toBe(false);
  });
});
