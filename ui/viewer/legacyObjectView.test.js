import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

vi.stubGlobal("requestAnimationFrame", () => 0);

import { state } from "../app/state.js";
import {
  applyLegacyObjectViewMode,
  getLegacyObjectViewMode,
  getLegacyObjectViewBlend,
  setLegacyObjectViewMode,
  setLegacyObjectViewBlend,
  sliceSyncFactorOf,
  visualRoleOf,
} from "./legacyObjectView.js";
import { buildLegacyRealisticLayer } from "./legacy3dEngine.js";

afterEach(() => {
  state.legacyDikGroup = null;
  state.legacyObjectViewMode = "shape";
  state.legacyObjectViewBlend = 0.5;
  state.legacySelectedDetectionId = null;
  state.legacyTomographyVisible = false;
  state.legacyTomographyDepthM = null;
});

describe("legacyObjectView", () => {
  it("varsayılan mod net şekildir", () => {
    expect(getLegacyObjectViewMode()).toBe("shape");
  });

  it("şekil modunda sinyal kabukları gizlenir, çekirdek kalır", () => {
    const layer = buildLegacyRealisticLayer({
      gridWidthM: 10,
      gridDepthM: 10,
      metals: [{ cx: 5, cy: 5, kind: "metal", widthM: 1, lengthM: 1, depthTopM: 1, depthBottomM: 2, peakSigma: 3, confidence: 0.8 }],
    });
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.add(layer);
    setLegacyObjectViewMode("shape");

    const shells = [];
    const cores = [];
    layer.traverse((object) => {
      if (object.userData?.legacyRealisticType === "signal-shell") shells.push(object);
      if (object.userData?.legacyRealisticType === "metal-core") cores.push(object);
    });
    expect(shells.length).toBeGreaterThan(0);
    expect(cores.length).toBeGreaterThan(0);
    expect(shells.every((object) => object.visible === false)).toBe(true);
    expect(cores.every((object) => object.visible === true)).toBe(true);
  });

  it("sinyal modunda kabuklar görünür", () => {
    const layer = buildLegacyRealisticLayer({
      gridWidthM: 10,
      gridDepthM: 10,
      metals: [{ cx: 5, cy: 5, kind: "metal", widthM: 1, lengthM: 1, depthTopM: 1, depthBottomM: 2, peakSigma: 3 }],
    });
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.add(layer);
    setLegacyObjectViewMode("signal");
    const shells = [];
    layer.traverse((object) => {
      if (object.userData?.legacyRealisticType === "signal-shell") shells.push(object);
    });
    expect(shells.every((object) => object.visible === true)).toBe(true);
  });

  it("visualRoleOf tip etiketinden rol çıkarır", () => {
    const shell = new THREE.Object3D();
    shell.userData.legacyRealisticType = "signal-shell";
    expect(visualRoleOf(shell)).toBe("signal");
    const core = new THREE.Object3D();
    core.userData.legacyRealisticType = "metal-core";
    expect(visualRoleOf(core)).toBe("shape");
  });

  it("applyLegacyObjectViewMode group yokken güvenli", () => {
    expect(applyLegacyObjectViewMode(null)).toBe("shape");
  });

  it("blend slider both moduna geçer ve 0..1 clamp eder", () => {
    expect(setLegacyObjectViewBlend(0.25)).toBe(0.25);
    expect(getLegacyObjectViewMode()).toBe("both");
    expect(getLegacyObjectViewBlend()).toBe(0.25);
    expect(setLegacyObjectViewBlend(2)).toBe(1);
    setLegacyObjectViewMode("shape");
    expect(getLegacyObjectViewBlend()).toBe(0);
  });

  it("seçili adımda yalnız o adıma bağlı objeleri gösterir", () => {
    const group = new THREE.Group();
    const layer = new THREE.Group();
    const selected = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 }));
    selected.userData.legacyRealisticDetail = true;
    selected.userData.legacyVisualRole = "shape";
    selected.userData.legacyStepIndex = 2;
    const other = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 }));
    other.userData.legacyRealisticDetail = true;
    other.userData.legacyVisualRole = "shape";
    other.userData.legacyStepIndex = 1;
    layer.name = "legacyRealisticLayer";
    layer.add(selected, other);
    group.add(layer);
    state.legacyDikGroup = group;
    state.legacySelectedStepIndex = 2;
    applyLegacyObjectViewMode(group);
    expect(selected.visible).toBe(true);
    expect(other.visible).toBe(false);
    state.legacySelectedStepIndex = null;
    applyLegacyObjectViewMode(group);
    expect(selected.visible).toBe(true);
    expect(other.visible).toBe(true);
  });
  it("seçili obje seçildiğinde aynı adımdaki diğer objeleri de tamamen gizler", () => {
    const group = new THREE.Group();
    const layer = new THREE.Group();
    layer.name = "legacyRealisticLayer";
    const selected = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 }));
    selected.userData.legacyRealisticDetail = true;
    selected.userData.legacyVisualRole = "shape";
    selected.userData.legacyStepIndex = 2;
    selected.userData.legacyDetectionId = "legacy-dik-shape-1";
    const selectedLabel = new THREE.Object3D();
    selectedLabel.userData.legacyRealisticDetail = true;
    selectedLabel.userData.legacyVisualRole = "guide";
    selectedLabel.userData.legacyStepIndex = 2;
    selectedLabel.userData.legacyDetectionId = "legacy-dik-shape-1";
    const other = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 }));
    other.userData.legacyRealisticDetail = true;
    other.userData.legacyVisualRole = "shape";
    other.userData.legacyStepIndex = 2;
    other.userData.legacyDetectionId = "legacy-dik-shape-2";
    layer.add(selected, selectedLabel, other);
    group.add(layer);
    state.legacyDikGroup = group;
    state.legacySelectedStepIndex = 2;
    state.legacySelectedDetectionId = "legacy-dik-shape-1";

    applyLegacyObjectViewMode(group);

    expect(selected.visible).toBe(true);
    expect(selectedLabel.visible).toBe(true);
    expect(other.visible).toBe(false);
  });
  it("tomografi dilimi dışındaki objeleri soluklaştırır", () => {
    state.legacyTomographyVisible = true;
    state.legacyTomographyDepthM = 1.5;
    const inBand = new THREE.Object3D();
    inBand.userData.legacyDepthTopM = 1;
    inBand.userData.legacyDepthBottomM = 2;
    const outBand = new THREE.Object3D();
    outBand.userData.legacyDepthTopM = 6;
    outBand.userData.legacyDepthBottomM = 7;
    expect(sliceSyncFactorOf(inBand, 1.5, 0.45)).toBeGreaterThan(1);
    expect(sliceSyncFactorOf(outBand, 1.5, 0.45)).toBeLessThan(0.3);
  });
});
