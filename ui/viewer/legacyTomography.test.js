import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

vi.stubGlobal("requestAnimationFrame", () => 0);
vi.stubGlobal("setInterval", () => 1);
vi.stubGlobal("clearInterval", () => {});

import { state } from "../app/state.js";
import {
  addLegacyTomography,
  focusTomographyOnDetection,
  getLegacyTomographyLayer,
  getTomographyControlsState,
  peakWeightAt,
  removeLegacyTomography,
  setTomographyDepthM,
  setTomographyOpacity,
  setTomographySigmaFloor,
  toggleLegacyTomography,
} from "./legacyTomography.js";

const result = {
  gridW: 3,
  gridH: 2,
  gridValues: [-3, -1, 0, 2, 4, 6],
  gridCoverage: [1, 1, 1, 2, 2, 2],
  anomalies: [{ cx: 1, cy: 1, kind: "anomaly", peakSigma: 3, depthTopM: 2, depthBottomM: 4, widthM: 1, lengthM: 1 }],
  metals: [],
};

afterEach(() => {
  removeLegacyTomography();
  state.legacyDikGroup = null;
  state.legacyDikResult = null;
  state.legacyTomographyDepthM = null;
  state.legacyTomographyPlaying = false;
  state.legacyTomographySigmaFloor = 0;
  state.legacyTomographyOpacity = 0.55;
});

describe("legacyTomography", () => {
  it("ölçülmüş grid'den katman ve çoklu derinlik dilimi üretir", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    state.legacyDikGroup.userData.depthMapM = 10;
    const layer = addLegacyTomography(result, { slices: 8 });

    expect(layer).toBeTruthy();
    expect(layer.name).toBe("legacyTomographyLayer");
    expect(layer.children.filter((object) => object.name.startsWith("legacyTomographySlice-")).length).toBe(8);
    expect(layer.userData.measuredCells).toBe(6);
    expect(layer.userData.maxAbs).toBe(6);
  });

  it("aynı buton ile aç/kapat yapılır ve ana Legacy grubu korunur", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    const first = toggleLegacyTomography(result);
    expect(first).toBe(true);
    expect(getLegacyTomographyLayer()).toBeTruthy();
    const second = toggleLegacyTomography(result);
    expect(second).toBe(false);
    expect(getLegacyTomographyLayer()).toBeNull();
    expect(state.legacyDikGroup).toBeTruthy();
  });

  it("eski kare residual önizlemesini grid boyutu olmadan da katmana çevirir", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    const legacyPreview = Array.from({ length: 16 }, (_, index) => index - 8);
    const layer = addLegacyTomography({ residual_preview: legacyPreview }, { slices: 4 });

    expect(layer).toBeTruthy();
    expect(layer.userData.gridW).toBe(4);
    expect(layer.userData.gridH).toBe(4);
    expect(layer.userData.measuredCells).toBe(16);
  });

  it("grid yoksa katman oluşturmadan güvenli şekilde kapanır", () => {
    state.legacyDikGroup = new THREE.Group();
    expect(addLegacyTomography({ gridW: 0, gridH: 0, gridValues: [] })).toBeNull();
    expect(state.legacyDikGroup.children).toHaveLength(0);
  });

  it("derinlik slider yalnız aktif dilimi gösterir", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    state.legacyDikGroup.userData.depthMapM = 8;
    addLegacyTomography(result, { slices: 8 });
    setTomographyDepthM(1.0);
    const visible = getLegacyTomographyLayer()
      .children
      .filter((object) => object.name?.startsWith("legacyTomographySlice-") && object.visible);
    expect(visible.length).toBeGreaterThanOrEqual(1);
    expect(visible.length).toBeLessThanOrEqual(2);
    expect(getTomographyControlsState().depthM).toBeCloseTo(1.0, 2);
  });

  it("tespit odağı derinlik aralığını ayarlar", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    state.legacyDikGroup.userData.depthMapM = 10;
    state.legacyDikResult = result;
    addLegacyTomography(result, { slices: 10 });
    focusTomographyOnDetection({ detectionId: "legacy-dik-shape-1", depthTopM: 2, depthBottomM: 4 });
    const layer = getLegacyTomographyLayer();
    expect(layer.userData.focusLowM).toBe(2);
    expect(layer.userData.focusHighM).toBe(4);
    expect(getTomographyControlsState().depthM).toBeCloseTo(3, 1);
  });

  it("opaklık ve sigma eşiği state'e yazılır", () => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 4;
    state.legacyDikGroup.userData.gridDepthM = 5;
    state.legacyDikResult = result;
    addLegacyTomography(result, { slices: 6 });
    expect(setTomographyOpacity(0.8)).toBeCloseTo(0.8, 2);
    expect(setTomographySigmaFloor(0.5)).toBeCloseTo(0.5, 2);
    expect(getTomographyControlsState().opacity).toBeCloseTo(0.8, 2);
    expect(getTomographyControlsState().sigmaFloor).toBeCloseTo(0.5, 2);
  });

  it("odak id varken peaking o tespiti güçlendirir", () => {
    const detections = [
      {
        detectionId: "legacy-dik-shape-1",
        cx: 1,
        cy: 1,
        depthCenterM: 3,
        halfWidthM: 0.4,
        rx: 0.5,
        ry: 0.5,
        strength: 3,
      },
      {
        detectionId: "legacy-dik-shape-2",
        cx: 3,
        cy: 3,
        depthCenterM: 3,
        halfWidthM: 0.4,
        rx: 0.5,
        ry: 0.5,
        strength: 3,
      },
    ];
    const focused = peakWeightAt(3, 1, 1, detections, 10, "legacy-dik-shape-1");
    const other = peakWeightAt(3, 3, 3, detections, 10, "legacy-dik-shape-1");
    expect(focused).toBeGreaterThan(other);
  });
});
