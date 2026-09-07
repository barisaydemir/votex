import { describe, expect, it } from "vitest";
import { computeHeightfieldNormalData } from "./ground.js";

function decode(data, index) {
  const offset = index * 4;
  return [
    data[offset] / 255 * 2 - 1,
    data[offset + 1] / 255 * 2 - 1,
    data[offset + 2] / 255 * 2 - 1,
  ];
}

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
