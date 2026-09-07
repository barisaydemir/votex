import { describe, expect, it } from "vitest";
import {
  computeGradientField,
  computeMagneticContourSegments,
  getMagneticContourLevels,
} from "./groundMagneticOverlay.js";

function field(values, gridRes) {
  return {
    grid: Float32Array.from(values),
    counts: new Uint32Array(values.map(() => 1)),
    gridRes,
  };
}

describe("ground magnetic gradient magnitude", () => {
  it("returns zero for a flat field", () => {
    const { grid, counts, gridRes } = field([7, 7, 7, 7, 7, 7, 7, 7, 7], 3);
    const result = computeGradientField(grid, counts, gridRes, 2, 2);

    expect(Array.from(result.magnitude)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.maxMagnitude).toBe(0);
  });

  it("computes a physical-unit gradient for a linear X field", () => {
    // x step = 1m; B changes by 2nT per metre.
    const { grid, counts, gridRes } = field([0, 2, 4, 0, 2, 4, 0, 2, 4], 3);
    const result = computeGradientField(grid, counts, gridRes, 2, 2);

    expect(result.gradientX[4]).toBeCloseTo(2);
    expect(result.gradientZ[4]).toBeCloseTo(0);
    expect(result.magnitude[4]).toBeCloseTo(2);
    expect(result.magnitude[1]).toBeCloseTo(2);
    expect(result.maxMagnitude).toBeCloseTo(2);
  });

  it("combines perpendicular X and Z slopes", () => {
    // B = 2x + 3z, with one-metre cells, so |∇B| = sqrt(13).
    const { grid, counts, gridRes } = field([0, 2, 4, 3, 5, 7, 6, 8, 10], 3);
    const result = computeGradientField(grid, counts, gridRes, 2, 2);

    expect(result.gradientX[4]).toBeCloseTo(2);
    expect(result.gradientZ[4]).toBeCloseTo(3);
    expect(result.magnitude[4]).toBeCloseTo(Math.sqrt(13));
  });

  it("uses one-sided differences at boundaries", () => {
    const { grid, counts, gridRes } = field([0, 1, 2, 0, 1, 2, 0, 1, 2], 3);
    const result = computeGradientField(grid, counts, gridRes, 2, 2);

    expect(result.gradientX[0]).toBeCloseTo(1);
    expect(result.gradientX[2]).toBeCloseTo(1);
    expect(result.magnitude[2]).toBeCloseTo(1);
  });

  it("keeps missing cells transparent while using available neighbors", () => {
    const values = [0, 1, 2, 0, NaN, 2, 0, 1, 2];
    const grid = Float32Array.from(values);
    const counts = new Uint32Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    const result = computeGradientField(grid, counts, 3, 2, 2);

    expect(Number.isNaN(result.magnitude[4])).toBe(true);
    expect(result.magnitude[1]).toBeCloseTo(1);
  });
});

describe("ground magnetic iso-nT contours", () => {
  it("generates evenly spaced levels inside the populated range", () => {
    const grid = Float32Array.from([0, 10, 20, 30]);
    const counts = new Uint32Array([1, 1, 1, 1]);

    expect(getMagneticContourLevels(grid, counts, 2)).toEqual([10, 20]);
  });

  it("creates interpolated line segments for a crossing level", () => {
    // 2x2 cell: one corner is above 5, producing one contour segment.
    const grid = Float32Array.from([0, 10, 0, 0]);
    const counts = new Uint32Array([1, 1, 1, 1]);
    const positions = computeMagneticContourSegments(grid, counts, 2, 2, 2, [5]);

    expect(positions).toHaveLength(6);
    // The contour connects the top and right edge midpoints.
    expect(positions[0]).toBeCloseTo(0);
    expect(positions[3]).toBeCloseTo(1);
    expect(positions[1]).toBeCloseTo(0.045);
    expect(positions[4]).toBeCloseTo(0.045);
    expect(positions[2]).toBeCloseTo(-1);
    expect(positions[5]).toBeCloseTo(0);
  });

  it("does not bridge missing grid cells", () => {
    const grid = Float32Array.from([0, 10, 10, 0]);
    const counts = new Uint32Array([1, 0, 1, 1]);

    expect(computeMagneticContourSegments(grid, counts, 2, 2, 2, [5])).toHaveLength(0);
  });
});
