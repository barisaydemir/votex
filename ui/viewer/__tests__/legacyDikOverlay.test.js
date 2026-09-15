import { describe, it, expect, afterEach, vi } from "vitest";
import * as THREE from "three";
import { footprintPoints, createFootprintFill, polygonToWorldPoints, polygonToPlanPoints, formatLegacyObjectLabel, setLegacyLabelMode, getLegacyLabelMode, applyLegacyStepVisibility, setLegacySelectedStep } from "../legacyDikOverlay.js";
import { state } from "../../app/state.js";

vi.stubGlobal("requestAnimationFrame", () => 0);

describe("legacyDikOverlay.labels", () => {
  it("3D obje etiketinde derinlik, konum ve boyutu metre birimiyle açıkça yazar", () => {
    const label = formatLegacyObjectLabel(
      { kind: "metal", cx: 1.5, cy: 2.25, widthM: 1.2, lengthM: 0.8, depthTopM: 2.5, depthBottomM: 3.7, shapeConfidence: 0.9, peakSigma: 4.2 },
      1,
      { low: 2.4, high: 3.8, center: 3.1, fitError: 0.2 },
      true,
    );
    expect(label.depth).toContain("2.40–3.80 m");
    expect(label.depth).toMatch(/Ne kadar derin|orta/i);
    expect(label.position).toContain("1.50 m");
    expect(label.position).toContain("2.25 m");
    expect(label.dimensions).toMatch(/Yaklaşık boyut|1\.20/);
    expect(label.quality).toMatch(/%\d+/);
    expect(label.quality).toMatch(/4\.2σ|σ/);
    expect(label.geometry).toMatch(/ölçülmüş kontur|tahmini şekil|manyetik sinyal/i);
    expect(label.magnetic).toMatch(/metal-benzeri|pozitif|Manyetik|tepki/i);
    expect(label.magDisclaimer).toMatch(/χ|malzeme/i);
    expect(label.title).toMatch(/bulgu|Bulgu/i);
    const inferredLabel = formatLegacyObjectLabel({
      kind: "anomaly",
      shapeType: "circle",
      shapeSource: "inferred",
      cx: 0,
      cy: 0,
      widthM: 1,
      lengthM: 1,
      depthTopM: 1,
      depthBottomM: 2,
    }, 1, { low: 0.8, high: 2.2, center: 1.5, fitError: 0.4 }, true);
    expect(inferredLabel.geometry).toBe("Geometri: tahmini şekil");
  });

  it("signal-only geometri için gövde yerine yalnız sinyal katmanı üretilir", async () => {
    const { buildLegacyRealisticLayer } = await import("../legacy3dEngine.js");
    const layer = buildLegacyRealisticLayer({
      gridWidthM: 4,
      gridDepthM: 4,
      anomalies: [{ kind: "anomaly", shapeSource: "signal-only", cx: 2, cy: 2, depthTopM: 1, depthBottomM: 2, confidence: 0.5 }],
    });
    let bodies = 0;
    let shells = 0;
    layer.traverse((object) => {
      if (object.userData?.legacyRealisticType === "estimated-body") bodies += 1;
      if (object.userData?.legacyRealisticType === "signal-shell") shells += 1;
    });
    expect(bodies).toBe(0);
    expect(shells).toBeGreaterThan(0);
  });
});

describe("legacyDikOverlay.labelMode", () => {
  afterEach(() => {
    state.legacyDikGroup = null;
    state.legacyLabelMode = "badge";
    state.legacySelectedDetectionId = null;
    state.legacySelectedStepIndex = null;
    state.structureTargets = {};
  });

  it("rozet modunda detay kartı yalnız seçili tespitte açılır", () => {
    const group = new THREE.Group();
    const badge = new THREE.Object3D();
    badge.userData.isBadge = true;
    badge.userData.legacyDetectionId = "legacy-dik-shape-1";
    badge.userData.legacyStepIndex = 2;
    const detail = new THREE.Object3D();
    detail.userData.legacyDetailCard = true;
    detail.userData.isDetailLabel = true;
    detail.userData.legacyRankLabel = true;
    detail.userData.legacyDetectionId = "legacy-dik-shape-1";
    detail.userData.focusId = "legacy-dik-shape-1";
    detail.userData.legacyStepIndex = 2;
    const otherDetail = new THREE.Object3D();
    otherDetail.userData.legacyDetailCard = true;
    otherDetail.userData.legacyRankLabel = true;
    otherDetail.userData.legacyDetectionId = "legacy-dik-shape-2";
    otherDetail.userData.focusId = "legacy-dik-shape-2";
    otherDetail.userData.legacyStepIndex = 3;
    const duplicate = new THREE.Object3D();
    duplicate.userData.isDetailLabel = true;
    duplicate.userData.legacyDetailCard = true;
    duplicate.userData.legacyDetectionId = "legacy-dik-shape-1";
    duplicate.userData.focusId = "legacy-dik-shape-1";
    group.add(badge, detail, otherDetail, duplicate);
    state.legacyDikGroup = group;
    state.structureTargets = {};

    setLegacyLabelMode("badge");
    applyLegacyStepVisibility(null, null);
    expect(badge.visible).toBe(true);
    expect(detail.visible).toBe(false);
    expect(otherDetail.visible).toBe(false);
    expect(duplicate.visible).toBe(false);

    applyLegacyStepVisibility(2, "legacy-dik-shape-1");
    expect(badge.visible).toBe(true);
    expect(detail.visible).toBe(true);
    expect(otherDetail.visible).toBe(false);
    expect(duplicate.visible).toBe(false);
  });

  it("tespit seçiliyken adım etiketleri ve işaretçileri görünür kalır", () => {
    const group = new THREE.Group();
    const stepLabel = new THREE.Object3D();
    stepLabel.userData.isDetailLabel = true;
    stepLabel.userData.legacyScanStepLabel = true;
    stepLabel.userData.legacyStepIndex = 1;
    stepLabel.userData.scanStepIndex = 1;
    const stepMarker = new THREE.Object3D();
    stepMarker.userData.scanStepIndex = 1;
    stepMarker.userData.legacyStepIndex = 1;
    const path = new THREE.Object3D();
    path.userData.legacyScanStepPath = true;
    const detection = new THREE.Object3D();
    detection.userData.legacyDetectionId = "legacy-dik-shape-1";
    detection.userData.legacyRankLabel = true;
    detection.userData.isDetailLabel = true;
    detection.userData.legacyDetailCard = true;
    group.add(stepLabel, stepMarker, path, detection);
    state.legacyDikGroup = group;
    state.structureTargets = {};
    setLegacyLabelMode("badge");
    applyLegacyStepVisibility(1, "legacy-dik-shape-1");
    expect(stepLabel.visible).toBe(true);
    expect(stepMarker.visible).toBe(true);
    expect(path.visible).toBe(true);
  });

  it("kapalı modda rozet ve detay gizlenir", () => {
    const group = new THREE.Group();
    const badge = new THREE.Object3D();
    badge.userData.isBadge = true;
    badge.userData.legacyDetectionId = "legacy-dik-shape-1";
    const detail = new THREE.Object3D();
    detail.userData.legacyDetailCard = true;
    detail.userData.legacyDetectionId = "legacy-dik-shape-1";
    group.add(badge, detail);
    state.legacyDikGroup = group;
    setLegacyLabelMode("off");
    expect(getLegacyLabelMode()).toBe("off");
    expect(badge.visible).toBe(false);
    expect(detail.visible).toBe(false);
  });

  it("tam kart modunda detaylar görünür", () => {
    const group = new THREE.Group();
    const detail = new THREE.Object3D();
    detail.userData.legacyDetailCard = true;
    detail.userData.legacyRankLabel = true;
    detail.userData.legacyDetectionId = "legacy-dik-shape-1";
    group.add(detail);
    state.legacyDikGroup = group;
    setLegacyLabelMode("full");
    applyLegacyStepVisibility(null, null);
    expect(detail.visible).toBe(true);
  });
  it("seçili adımda yalnız aynı adıma bağlı obje ve işaretler görünür", () => {
    const group = new THREE.Group();
    const selectedObject = new THREE.Object3D();
    selectedObject.userData.legacyRealisticDetail = true;
    selectedObject.userData.legacyDetectionId = "legacy-dik-shape-1";
    selectedObject.userData.legacyStepIndex = 2;
    const otherObject = new THREE.Object3D();
    otherObject.userData.legacyRealisticDetail = true;
    otherObject.userData.legacyDetectionId = "legacy-dik-shape-2";
    otherObject.userData.legacyStepIndex = 3;
    const selectedCell = new THREE.Object3D();
    selectedCell.userData.legacyGridCell = true;
    selectedCell.userData.legacyStepIndex = 2;
    const otherCell = new THREE.Object3D();
    otherCell.userData.legacyGridCell = true;
    otherCell.userData.legacyStepIndex = 3;
    group.add(selectedObject, otherObject, selectedCell, otherCell);
    state.legacyDikGroup = group;
    state.structureTargets = {};

    setLegacySelectedStep(2);
    expect(selectedObject.visible).toBe(true);
    expect(otherObject.visible).toBe(false);
    expect(selectedCell.visible).toBe(true);
    expect(otherCell.visible).toBe(false);

    setLegacySelectedStep(null);
    expect(selectedObject.visible).toBe(true);
    expect(otherObject.visible).toBe(true);
    expect(selectedCell.visible).toBe(true);
    expect(otherCell.visible).toBe(true);
  });
});

describe("legacyDikOverlay.polygonAnchoring", () => {
  it("ölçüm konturunu tespit merkezine alan ağırlıklı merkezle ankrajlar", () => {
    const polygon = [[0.05, 0.05], [0.25, 0.05], [0.25, 0.15], [0.05, 0.15]];
    const points = polygonToWorldPoints(polygon, 20, 20, 3, -2);
    const center = points.reduce((acc, [x, z]) => ({ x: acc.x + x, z: acc.z + z }), { x: 0, z: 0 });
    expect(center.x / points.length).toBeCloseTo(3, 5);
    expect(center.z / points.length).toBeCloseTo(-2, 5);
  });

  it("metre cinsinden eski konturu tekrar ölçeklemeden hedefe taşır", () => {
    const polygon = [[-0.4, -0.2], [0.4, -0.2], [0.4, 0.2], [-0.4, 0.2]];
    const points = polygonToWorldPoints(polygon, 20, 20, 7, 4);
    const center = points.reduce((acc, [x, z]) => ({ x: acc.x + x, z: acc.z + z }), { x: 0, z: 0 });
    expect(center.x / points.length).toBeCloseTo(7, 5);
    expect(center.z / points.length).toBeCloseTo(4, 5);
  });
  it("normalize konturu 3D gövde için global plan koordinatında bırakır", () => {
    const shape = { polygonCoordinateSpace: "normalized" };
    const points = polygonToPlanPoints(shape, [[0.7, 0.2], [0.8, 0.2], [0.8, 0.3]], 20, 10);
    expect(points[0]).toEqual([4, -3]);
    expect(points[2]).toEqual([6, -2]);
  });

  it("metre konturuna açık ankraj verildiğinde 3D merkezi korur", () => {
    const shape = { polygonCoordinateSpace: "meters" };
    const points = polygonToPlanPoints(shape, [[1, 1], [3, 1], [3, 2]], 20, 10, 4, 5);
    const center = points.reduce((acc, [x, z]) => ({ x: acc.x + x, z: acc.z + z }), { x: 0, z: 0 });
    expect(center.x / points.length).toBeCloseTo(4, 5);
    expect(center.z / points.length).toBeCloseTo(5, 5);
  });

    it("ölçüm kontürü (grid-contour) varsa poligonu birebir kullanır — elips yaklaşımına düşmez", () => {
    const shape = {
      shapeType: "circle",
      shapeSource: "grid-contour",
      shapeFitError: 0.08,
      polygon: [
        [0.4, 0.2], [0.55, 0.22], [0.62, 0.3], [0.6, 0.4],
        [0.5, 0.46], [0.42, 0.44], [0.38, 0.35], [0.39, 0.26],
      ],
    };
    const points = footprintPoints(shape, 0.5, 0.5, 20, 20);
    expect(points).toHaveLength(8);
    // İlk nokta: 0.4*20 - 10 = -2
    expect(points[0][0]).toBeCloseTo(-2, 5);
    expect(points[0][1]).toBeCloseTo(-6, 5);
  });

  it("ölçüm kontürü yoksa ve kaynak inferred ise daire/elips halkası üretir", () => {
    const shape = {
      shapeType: "circle",
      shapeSource: "inferred",
      shapeFitError: 0.35,
      polygon: [],
      widthM: 1.2,
      lengthM: 1.2,
    };
    const points = footprintPoints(shape, 0.6, 0.6, 10, 10);
    expect(points).toHaveLength(48);
  });

  it("inferred + çokgen/ düzensiz türde de poligonu kullanır", () => {
    const shape = {
      shapeType: "polygon",
      shapeSource: "inferred",
      shapeFitError: 0.5,
      polygon: [[0.1, 0.1], [0.9, 0.15], [0.5, 0.9]],
    };
    const points = footprintPoints(shape, 0.5, 0.5, 10, 10);
    expect(points).toHaveLength(3);
  });
});

describe("legacyDikOverlay.createFootprintFill", () => {
  it("ölçüm kontüründen kapalı zemin dolumu üretir ve kaynağı işaretler", () => {
    const shape = {
      shapeType: "ellipse",
      shapeSource: "grid-contour",
      shapeFitError: 0.12,
      polygon: [
        [0.3, 0.3], [0.5, 0.28], [0.7, 0.34], [0.72, 0.5],
        [0.6, 0.66], [0.4, 0.68], [0.28, 0.52], [0.28, 0.4],
      ],
    };
    const fill = createFootprintFill(shape, 0.5, 0.5, 20, 20, 0xe06a3b, 0.15);
    expect(fill).not.toBeNull();
    expect(fill.geometry).toBeTruthy();
    expect(fill.material.opacity).toBeCloseTo(0.15, 5);
    expect(fill.userData.inferredGeometry).toBe(false);
    fill.geometry.dispose();
    fill.material.dispose();
  });

  it("ölçüm poligonu 3 noktadan azsa geometrik daireye düşer", () => {
    const shape = {
      shapeType: "circle",
      shapeSource: "grid-contour",
      polygon: [[0.2, 0.2], [0.8, 0.8]],
    };
    // 2 nokta useMeasured eşiğini geçemez → circle dalı 48 noktalı halka üretir.
    const fill = createFootprintFill(shape, 0.4, 0.4, 10, 10, 0x000000);
    expect(fill).not.toBeNull();
    fill.geometry.dispose();
    fill.material.dispose();
  });

  it("geçersiz (non-finite) ölçüm poligonu null döner", () => {
    const shape = {
      shapeType: "circle",
      shapeSource: "grid-contour",
      polygon: [[NaN, 0.5], [0.6, NaN], [Number.POSITIVE_INFINITY, 0.3]],
    };
    expect(createFootprintFill(shape, 0.4, 0.4, 10, 10, 0x000000)).toBeNull();
  });
});
