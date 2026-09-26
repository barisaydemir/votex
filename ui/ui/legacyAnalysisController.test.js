import { describe, expect, it } from "vitest";
import {
  normalizeDepthParams,
  readAnalyzeInputs,
  readMatrixInput,
} from "./legacyAnalysisController.js";

describe("legacyAnalysisController", () => {
  it("derinlik parametrelerini güvenli sınırlar içinde tutar", () => {
    expect(normalizeDepthParams({ sensorHeightM: 3, bipolarSepFactor: -1, dipoleBlend: 4 })).toEqual({
      sensorHeightM: 0.2,
      bipolarSepFactor: 0.5,
      dipoleBlend: 1,
    });
  });

  it("6×3 tarama şablonunu 18 adım olarak üretir", () => {
    expect(readMatrixInput("6", "3")).toMatchObject({
      matrixRows: 6,
      matrixCols: 3,
      scanStepCount: 18,
      hint: { matrixRows: 6, matrixCols: 3 },
    });
  });

  it("matris ve açıklık hatalarını erken bildirir", () => {
    expect(() => readMatrixInput("6", "0")).toThrow();
    expect(() => readAnalyzeInputs({ rows: "0", cols: "0", spacing: "1001" })).toThrow();
    expect(readAnalyzeInputs({ rows: "6", cols: "3", spacing: "2" }).effectiveStepSpacingM).toBe(0);
  });
});
