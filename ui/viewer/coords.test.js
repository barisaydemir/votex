import { describe, expect, it } from "vitest";
import { mapToWorld, recordPointToWorld, recordSegmentToWorld } from "./coords.js";

describe("coords.recordPointToWorld", () => {
  it("normalleştirilmiş yapıyı harita merkezine göre çevirir", () => {
    expect(recordPointToWorld({ cx: 0, cy: 1 }, "cx", "cy", 20, 10)).toMatchObject({ x: -10, z: 5, mode: "normalized" });
    expect(recordPointToWorld({ cx: 0.5, cy: 0.5 }, "cx", "cy", 20, 10)).toMatchObject({ x: 0, z: 0 });
  });

  it("metre koordinatını normalize edip köşeye taşımaz", () => {
    expect(recordPointToWorld({ coordinateSpace: "meters", cx: 8, cy: -3 }, "cx", "cy", 20, 10)).toMatchObject({ x: 8, z: -3, mode: "meters" });
  });

  it("açık normalize sözleşmesi küçük değerleri metre sanmaz", () => {
    const point = recordPointToWorld({ coordinateSpace: "normalized", cx: 0.8, cy: 0.2 }, "cx", "cy", 20, 10);
    expect(point.x).toBeCloseTo(6, 10);
    expect(point.z).toBeCloseTo(-3, 10);
  });
});

describe("coords.recordSegmentToWorld", () => {
  it("normalize tünel uçlarını doğru dönüştürür", () => {
    const segment = recordSegmentToWorld({ x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.2 }, 20, 10);
    expect(segment.mode).toBe("normalized");
    expect(segment.a).toMatchObject(mapToWorld(0.1, 0.2, 20, 10));
    expect(segment.b).toMatchObject(mapToWorld(0.9, 0.2, 20, 10));
  });

  it("metre tünel uçlarını aynı koordinat sisteminde tutar", () => {
    const segment = recordSegmentToWorld({ coordinateSpace: "meters", x0: -8, y0: 2, x1: 8, y1: 2 }, 20, 10);
    expect(segment.mode).toBe("meters");
    expect(segment.a).toMatchObject({ x: -8, z: 2 });
    expect(segment.b).toMatchObject({ x: 8, z: 2 });
  });
});
