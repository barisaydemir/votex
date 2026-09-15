import { describe, expect, it } from "vitest";
import { computeHeightfieldNormalData, lodLevelForDistance, multiOctaveTerrainNoise } from "./ground.js";

function decode(data, index) {
  const offset = index * 4;
  return [
    data[offset] / 255 * 2 - 1,
    data[offset + 1] / 255 * 2 - 1,
    data[offset + 2] / 255 * 2 - 1,
  ];
}


describe("deterministic multi-octave terrain relief", () => {
  it("is deterministic and stays within the normalized range", () => {
    const a = multiOctaveTerrainNoise(1.25, 2.5);
    const b = multiOctaveTerrainNoise(1.25, 2.5);

    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(-1);
    expect(a).toBeLessThanOrEqual(1);
  });
});
describe("terrain distance LOD", () => {
  it("selects progressively lighter geometry at distance", () => {
    expect(lodLevelForDistance(20, [60, 120])).toBe(0);
    expect(lodLevelForDistance(80, [60, 120])).toBe(1);
    expect(lodLevelForDistance(160, [60, 120])).toBe(2);
  });
});
describe("ground heightfield tangent-space normal map", () => {
  it("encodes an upward normal for a flat heightfield", () => {
    const data = computeHeightfieldNormalData([0, 0, 0, 0], 2, 2, 2, 2);
    const normal = decode(data, 0);

    expect(normal[0]).toBeCloseTo(0, 2);
    expect(normal[1]).toBeCloseTo(1, 2);
    expect(normal[2]).toBeCloseTo(0, 2);
    expect(data[3]).toBe(255);
  });

  it("tilts tangent-space normals opposite to an X slope", () => {
    const data = computeHeightfieldNormalData([0, 1, 0, 1], 2, 2, 1, 1);
    const normal = decode(data, 0);

    expect(normal[0]).toBeLessThan(-0.5);
    expect(normal[1]).toBeGreaterThan(0.5);
    expect(Math.abs(normal[2])).toBeLessThan(0.1);
  });

  it("tilts tangent-space normals opposite to the V/Z slope", () => {
    const data = computeHeightfieldNormalData([0, 0, 1, 1], 2, 2, 1, 1);
    const normal = decode(data, 0);

    expect(Math.abs(normal[0])).toBeLessThan(0.1);
    expect(normal[1]).toBeGreaterThan(0.5);
    expect(normal[2]).toBeLessThan(-0.5);
  });

  it("uses one-sided derivatives at heightfield edges", () => {
    const data = computeHeightfieldNormalData([0, 2, 4], 3, 1, 2, 1);
    const left = decode(data, 0);
    const right = decode(data, 2);

    expect(left[0]).toBeLessThan(-0.7);
    expect(right[0]).toBeLessThan(-0.7);
  });

  it("treats invalid samples as zero instead of emitting invalid texture data", () => {
    const data = computeHeightfieldNormalData([NaN, Infinity, 1, 1], 2, 2, 1, 1);

    expect(Array.from(data).every(Number.isFinite)).toBe(true);
    expect(data.every((value) => value >= 0 && value <= 255)).toBe(true);
  });
});
