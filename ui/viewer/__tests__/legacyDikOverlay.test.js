import { describe, it, expect } from "vitest";
import { footprintPoints, createFootprintFill } from "../legacyDikOverlay.js";

describe("legacyDikOverlay.footprintPoints", () => {
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
