import { describe, expect, it } from "vitest";
import { connectedFootprintsForTarget } from "./legacyUnifiedObjectMap.js";

const group = {
  userData: {
    gridWidthM: 10,
    gridDepthM: 10,
    gridOriginXM: 0,
    gridOriginZM: 0,
  },
};

const evidence = (id, x, z, rx = 0.25, rz = 0.25) => ({
  detectionId: id,
  stationM: x,
  offsetM: z,
  raw: { cx: x, cy: z, rx, ry: rz },
});

describe("legacyUnifiedObjectMap", () => {
  it("koridoru yalnız küçük yatay boşluk için üretir", () => {
    const result = connectedFootprintsForTarget({
      evidence: [evidence("a", 2, 2), evidence("b", 2.7, 2)],
      connectors: [{ fromDetectionId: "a", toDetectionId: "b", gapM: 0.2, widthM: 0.12 }],
    }, group, { horizontalGapToleranceM: 0.35 });

    expect(result.footprints).toHaveLength(2);
    expect(result.connectors).toHaveLength(1);
    expect(result.connectors[0].gapM).toBeCloseTo(0.2);
    expect(result.connectors[0].widthM).toBeCloseTo(0.12);
  });

  it("belirgin yatay boşluğu dolu hacme çevirmez", () => {
    const result = connectedFootprintsForTarget({
      evidence: [evidence("a", 2, 2), evidence("b", 4, 2)],
    }, group, { horizontalGapToleranceM: 0.35 });

    expect(result.footprints).toHaveLength(2);
    expect(result.connectors).toHaveLength(0);
  });

  it("her kanıtın ölçülen ayak izini ayrı korur", () => {
    const result = connectedFootprintsForTarget({
      evidence: [evidence("a", 2, 2, 0.4, 0.2), evidence("b", 2.9, 2, 0.1, 0.15)],
    }, group, { horizontalGapToleranceM: 0.35 });

    const widths = result.footprints.map((polygon) => polygon[1].x - polygon[0].x);
    expect(widths[0]).toBeCloseTo(0.8, 8);
    expect(widths[1]).toBeCloseTo(0.2, 8);
  });
});
