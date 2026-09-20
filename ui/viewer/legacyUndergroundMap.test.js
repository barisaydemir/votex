import { describe, expect, it } from "vitest";
import { buildLegacyUndergroundVolume } from "./legacyUndergroundMap.js";

describe("legacyUndergroundMap", () => {
  const result = {
    gridW: 3,
    gridH: 3,
    gridWidthM: 3,
    gridDepthM: 3,
    gridValues: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    gridCoverage: [1, 1, 1, 1, 1, 1, 1, 1, 1],
  };

  it("creates depth layers from detections instead of only listing them", () => {
    const volume = buildLegacyUndergroundVolume(result, {
      detections: [{
        raw: { cx: 1.5, cy: 1.5, strength: 8, rx: 0.3, ry: 0.3 },
        depthTopM: 1,
        depthBottomM: 1.5,
        confidence: 0.9,
      }],
    }, { slices: 6, maxDepthM: 6 });
    expect(volume.slices).toBe(6);
    expect(volume.layers).toHaveLength(6);
    expect(Math.max(...volume.layers[0].values)).toBeGreaterThan(0);
    expect(volume.detectionCount).toBe(1);
  });

  it("combines multiple nearby detections into the same probability volume", () => {
    const volume = buildLegacyUndergroundVolume(result, {
      detections: [
        { raw: { cx: 1.4, cy: 1.5, strength: 5 }, depthTopM: 1, depthBottomM: 1.6, confidence: 0.7 },
        { raw: { cx: 1.6, cy: 1.5, strength: 6 }, depthTopM: 1.1, depthBottomM: 1.7, confidence: 0.8 },
      ],
    }, { slices: 8, maxDepthM: 8 });
    const peak = Math.max(...volume.layers.flatMap((layer) => layer.values));
    expect(peak).toBeGreaterThan(0.3);
    expect(volume.detectionCount).toBe(2);
  });

  it("returns null when there is no usable grid", () => {
    expect(buildLegacyUndergroundVolume({ gridW: 0, gridH: 0, gridValues: [] }, { detections: [] })).toBeNull();
  });
});
