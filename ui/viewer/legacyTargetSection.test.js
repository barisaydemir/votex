import { describe, expect, it } from "vitest";
import { buildLegacyTargetSection } from "./legacyTargetSection.js";

const result = (overrides = {}) => ({
  gridW: 4,
  gridH: 3,
  gridValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  gridCoverage: [1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1],
  gridOriginXM: 0,
  gridOriginYM: 0,
  gridWidthM: 4,
  gridDepthM: 3,
  ...overrides,
});

const detection = { raw: { cx: 1.5, cy: 1.5, widthM: 1, lengthM: 0.5 }, depthTopM: 0.8, depthBottomM: 1.4 };

describe("legacyTargetSection", () => {
  it("X kesitinde yalnız ölçülmüş hücreleri kullanır", () => {
    const section = buildLegacyTargetSection(result(), detection, "x");
    expect(section).toMatchObject({ available: true, axis: "x", measuredCount: 3, totalCount: 4 });
    expect(section.points.map((point) => point.value)).toEqual([5, 6, null, 8]);
    expect(section.depthTopM).toBe(0.8);
  });

  it("Y kesitinde hedefin X sütununu izler", () => {
    const section = buildLegacyTargetSection(result(), detection, "y");
    expect(section).toMatchObject({ available: true, axis: "y", measuredCount: 3, totalCount: 3 });
    expect(section.points.map((point) => point.value)).toEqual([2, 6, 10]);
  });

  it("grid kapsamı yoksa kesit oluşturmaz", () => {
    expect(buildLegacyTargetSection(result({ gridCoverage: [] }), detection, "x")).toMatchObject({
      available: false,
      reason: expect.stringContaining("kapsam bilgisi yok"),
    });
  });

  it("ölçülmemiş hücreleri sıfır sinyal gibi göstermez", () => {
    const section = buildLegacyTargetSection(result({ gridCoverage: [1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1] }), detection, "x");
    expect(section.available).toBe(true);
    expect(section.points[1].value).toBeNull();
  });
});


