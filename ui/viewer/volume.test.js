import { describe, expect, it } from "vitest";
import { dimensionsOf, footprintAreaM2Of, formatVolumeM3, segmentLengthMOf, volumeM3Of } from "./volume.js";

describe("volume", () => {
  it("dikdörtgen ölçüsü ve derinlik aralığından hacim hesaplar", () => {
    const object = { kind: "room", widthM: 4, lengthM: 5, topFromSurfaceM: 1, bottomFromSurfaceM: 3 };
    expect(dimensionsOf(object)).toMatchObject({ width: 4, length: 5, height: 2 });
    expect(volumeM3Of(object)).toBeCloseTo(40, 6);
  });

  it("ölçüm kontur alanını grid boyutlarıyla metreye çevirir", () => {
    const object = {
      kind: "anomaly",
      shapeType: "polygon",
      shapeSource: "grid-contour",
      polygon: [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]],
      heightM: 2,
    };
    expect(footprintAreaM2Of(object, { mapWidthM: 8, mapDepthM: 8 })).toBeCloseTo(16, 6);
    expect(volumeM3Of(object, { mapWidthM: 8, mapDepthM: 8 })).toBeCloseTo(32, 6);
  });

  it("tünel uzunluğunu normalize veya metre uçlardan doğru hesaplar", () => {
    expect(segmentLengthMOf({ coordinateSpace: "normalized", x0: 0, y0: 0, x1: 0.5, y1: 0 }, { mapWidthM: 10, mapDepthM: 10 })).toBeCloseTo(5, 6);
    expect(segmentLengthMOf({ coordinateSpace: "meters", x0: 2, y0: 3, x1: 5, y1: 7 })).toBeCloseTo(5, 6);
  });

  it("hacmi kullanıcıya m³ formatında gösterir", () => {
    expect(formatVolumeM3(12.345)).toBe("12.3 m³");
  });
});
