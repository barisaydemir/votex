import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildLegacyRealisticLayer,
  localFootprint,
  makeTunnelGeometry,
  normalizeLegacy3DResult,
  uncertaintyScaleOf,
} from "./legacy3dEngine.js";

describe("legacy3dEngine", () => {
  it("snake_case JSON'u normalize eder ve metal sonucu aynı konumda önceliklendirir", () => {
    const model = normalizeLegacy3DResult({
      grid_width_m: 4,
      grid_depth_m: 5,
      anomalies: [{ cx: 1, cy: 2, kind: "anomaly", strength: 1, depth_top_m: 1, depth_bottom_m: 2 }],
      metals: [{ cx: 1, cy: 2, kind: "metal", peak_sigma: 4, depth_top_m: 1.2, depth_bottom_m: 1.8 }],
    });
    expect(model.widthM).toBe(4);
    expect(model.depthM).toBe(5);
    expect(model.shapes).toHaveLength(1);
    expect(model.shapes[0].kind).toBe("metal");
    expect(model.shapes[0].strength).toBe(4);
  });

  it("ölçüm konturunu normalize eder ve derinlik aralığını korur", () => {
    const model = normalizeLegacy3DResult({
      gridWidthM: 10,
      gridDepthM: 8,
      anomalies: [{
        cx: 5,
        cy: 4,
        kind: "room",
        polygon: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.6], [0.2, 0.6]],
        depthTopM: 2,
        depthBottomM: 4,
      }],
    });
    expect(model.shapes[0].polygon).toHaveLength(4);
    expect(model.shapes[0].heightM).toBe(2);
    expect(model.maxDepthM).toBe(10);
  });

  it("kemerli tünel geometry'si geçerli vertex/index üretir", () => {
    const geometry = makeTunnelGeometry(2, 1.5, 6);
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(geometry.index.count).toBeGreaterThan(0);
    geometry.dispose();
  });

  it("room, tunnel, shaft ve metal için gerçekçi katman üretir", () => {
    const layer = buildLegacyRealisticLayer({
      gridWidthM: 10,
      gridDepthM: 10,
      anomalies: [
        { cx: 2, cy: 2, kind: "room", shapeType: "rectangle", widthM: 2, lengthM: 3, depthTopM: 1, depthBottomM: 3, confidence: 0.8 },
        { cx: 6, cy: 3, kind: "tunnel", shapeType: "capsule", widthM: 1, lengthM: 4, depthTopM: 2, depthBottomM: 3, confidence: 0.7 },
        { cx: 4, cy: 7, kind: "shaft", shapeType: "shaft", widthM: 1, lengthM: 1, depthTopM: 1, depthBottomM: 5, confidence: 0.9 },
      ],
      metals: [{ cx: 8, cy: 8, kind: "metal", widthM: 0.5, lengthM: 0.5, depthTopM: 1, depthBottomM: 2, peakSigma: 4 }],
    });
    const hasType = (type) => {
      let found = false;
      layer.traverse((object) => {
        if (object.userData.legacyRealisticType === type) found = true;
      });
      return found;
    };
    expect(hasType("measured-volume")).toBe(true);
    expect(hasType("arched-tunnel")).toBe(true);
    expect(hasType("shaft")).toBe(true);
    expect(hasType("metal-core")).toBe(true);
    expect(hasType("estimated-body")).toBe(true);
    layer.traverse((object) => {
      object.geometry?.dispose?.();
      if (object.material) object.material.dispose?.();
    });
  });

  it("polygon yoksa shapeType şablonundan tahmini gövde üretir", () => {
    const layer = buildLegacyRealisticLayer({
      gridWidthM: 8,
      gridDepthM: 8,
      anomalies: [{
        cx: 4,
        cy: 4,
        kind: "anomaly",
        shapeType: "ellipse",
        widthM: 2,
        lengthM: 1.2,
        depthTopM: 1,
        depthBottomM: 2.5,
        confidence: 0.6,
        peakSigma: 2,
      }],
    });
    let estimated = 0;
    let footprint = 0;
    layer.traverse((object) => {
      if (object.userData.legacyRealisticType === "estimated-body") estimated += 1;
      if (object.userData.legacyRealisticType === "estimated-footprint") footprint += 1;
    });
    expect(estimated).toBeGreaterThan(0);
    expect(footprint).toBeGreaterThan(0);
  });

  it("düşük güvende belirsizlik kabuğu üretir", () => {
    expect(uncertaintyScaleOf(0.2)).toBeGreaterThan(uncertaintyScaleOf(0.9));
    const layer = buildLegacyRealisticLayer({
      gridWidthM: 8,
      gridDepthM: 8,
      anomalies: [{
        cx: 4,
        cy: 4,
        kind: "anomaly",
        shapeType: "rectangle",
        widthM: 1.5,
        lengthM: 1,
        depthTopM: 1,
        depthBottomM: 2,
        confidence: 0.25,
      }],
    });
    let shells = 0;
    layer.traverse((object) => {
      if (object.userData.legacyRealisticType === "estimated-uncertainty") shells += 1;
    });
    expect(shells).toBeGreaterThan(0);
  });

  it("ölçüm poligonu tespit tepesine ankrajlanır ve orientation uygulanmaz", () => {
    const model = normalizeLegacy3DResult({
      gridWidthM: 10,
      gridDepthM: 10,
      anomalies: [{
        cx: 5,
        cy: 5,
        kind: "metal",
        orientationDeg: 40,
        polygon: [[0.35, 0.45], [0.7, 0.45], [0.7, 0.7], [0.35, 0.7]],
        depthTopM: 1,
        depthBottomM: 2,
        confidence: 0.7,
        peakSigma: 3,
      }],
    });
    const shape = model.shapes[0];
    const footprint = localFootprint(shape, model);
    expect(footprint.measured).toBe(true);
    expect(footprint.center.x).toBeCloseTo(0, 5);
    expect(footprint.center.z).toBeCloseTo(0, 5);
    // Tepe (0,0) ayak izinin içinde kalmalı
    const insideX = footprint.points.some(([x]) => x < 0) && footprint.points.some(([x]) => x > 0);
    const insideZ = footprint.points.some(([, z]) => z < 0) && footprint.points.some(([, z]) => z > 0);
    expect(insideX).toBe(true);
    expect(insideZ).toBe(true);

    const layer = buildLegacyRealisticLayer({
      gridWidthM: 10,
      gridDepthM: 10,
      scanSteps: [
        { index: 1, xCenterM: 5, yCenterM: 5, xStartM: 5, xEndM: 5, yStartM: 4, yEndM: 6 },
        { index: 2, xCenterM: 7, yCenterM: 5, xStartM: 7, xEndM: 7, yStartM: 4, yEndM: 6 },
      ],
      metals: [{
        cx: 5,
        cy: 5,
        kind: "metal",
        orientationDeg: 40,
        polygon: [[0.35, 0.45], [0.7, 0.45], [0.7, 0.7], [0.35, 0.7]],
        depthTopM: 1,
        depthBottomM: 2,
        confidence: 0.7,
        peakSigma: 3,
      }],
    }, {
      fieldModel: {
        steps: [
          { stepIndex: 1, raw: { index: 1, xCenterM: 5, yCenterM: 5 } },
          { stepIndex: 2, raw: { index: 2, xCenterM: 7, yCenterM: 5 } },
        ],
        detections: [{ detectionId: "legacy-dik-shape-1", stepIndex: 1 }],
      },
    });
    let bodyX = null;
    let bodyRot = null;
    let hasLink = false;
    layer.traverse((object) => {
      if (object.userData.legacyRealisticType === "estimated-body" && object.isMesh) {
        bodyX = object.position.x;
        bodyRot = object.rotation.y;
      }
      if (object.userData.legacyRealisticType === "step-detection-link") hasLink = true;
    });
    expect(bodyX).toBeCloseTo(0, 5);
    expect(bodyRot).toBeCloseTo(0, 5);
    expect(hasLink).toBe(false); // tepe adımın üstünde → link yok
  });
});
