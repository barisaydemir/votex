import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

vi.stubGlobal("requestAnimationFrame", () => 0);

import { state } from "../app/state.js";
import {
  addLegacySubsurfaceMap,
  getLegacySubsurfaceMapLayer,
  removeLegacySubsurfaceMap,
  setSubsurfaceMapOpacity,
  toggleLegacySubsurfaceMap,
} from "./legacySubsurfaceMap.js";

const result = {
  gridW: 3,
  gridH: 2,
  gridValues: [-3, -1, 0, 2, 4, 6],
  gridCoverage: [1, 1, 1, 2, 2, 2],
  anomalies: [{ cx: 1, cy: 1, kind: "anomaly", peakSigma: 3, depthTopM: 2, depthBottomM: 4, widthM: 1, lengthM: 1 }],
  metals: [],
};

afterEach(() => {
  removeLegacySubsurfaceMap();
  state.legacyDikGroup = null;
  state.legacyDikResult = null;
  state.legacySubsurfaceMapVisible = false;
  state.legacySubsurfaceMapOpacity = 0.28;
});

describe("legacySubsurfaceMap", () => {
  it("tüm dilimleri aynı anda görünür üretir", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    state.legacyDikGroup.userData.depthMapM = 10;
    const layer = addLegacySubsurfaceMap(result, { slices: 8 });

    expect(layer).toBeTruthy();
    expect(layer.name).toBe("legacySubsurfaceMapLayer");
    expect(layer.userData.usesDetections).toBe(false);
    const slices = layer.children.filter((object) => object.name.startsWith("legacySubsurfaceSlice-"));
    expect(slices).toHaveLength(8);
    expect(slices.every((slice) => slice.visible)).toBe(true);
    expect(state.legacySubsurfaceMapVisible).toBe(true);
  });

  it("aç/kapa toggle tespit listesini veya ana grubu bozmaz", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
    marker.userData.legacyDetectionId = "legacy-dik-shape-1";
    state.legacyDikGroup.add(marker);

    expect(toggleLegacySubsurfaceMap(result)).toBe(true);
    expect(getLegacySubsurfaceMapLayer()).toBeTruthy();
    expect(state.legacyDikGroup.children.some((child) => child === marker)).toBe(true);
    expect(marker.visible).toBe(true);

    expect(toggleLegacySubsurfaceMap(result)).toBe(false);
    expect(getLegacySubsurfaceMapLayer()).toBeNull();
    expect(state.legacyDikGroup.children.some((child) => child === marker)).toBe(true);
  });

  it("tespit peaking kullanmaz (usesDetections false)", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    const withDetections = addLegacySubsurfaceMap(result, { slices: 4 });
    const withoutDetections = addLegacySubsurfaceMap({
      gridW: 3,
      gridH: 2,
      gridValues: [-3, -1, 0, 2, 4, 6],
      gridCoverage: [1, 1, 1, 2, 2, 2],
      anomalies: [],
      metals: [],
    }, { slices: 4 });
    expect(withDetections.userData.usesDetections).toBe(false);
    expect(withoutDetections.userData.usesDetections).toBe(false);
    expect(withDetections.userData.measuredCells).toBe(withoutDetections.userData.measuredCells);
  });

  it("opaklık ayarı state ve malzemeye yazılır", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    addLegacySubsurfaceMap(result, { slices: 4 });
    expect(setSubsurfaceMapOpacity(0.4)).toBeCloseTo(0.4, 2);
    expect(state.legacySubsurfaceMapOpacity).toBeCloseTo(0.4, 2);
  });

  it("grid yoksa katman oluşturmaz", () => {
    state.legacyDikGroup = new THREE.Group();
    expect(addLegacySubsurfaceMap({ gridW: 0, gridH: 0, gridValues: [] })).toBeNull();
    expect(state.legacySubsurfaceMapVisible).toBe(false);
  });
});
