import { describe, expect, it } from "vitest";
import { mergeLegacyShapes, normalizeLegacyResult, orderScanStepsLeftFirst } from "../legacyNormalize.js";

describe("legacyNormalize", () => {
  it("snake_case arşiv alanlarını camelCase sözleşmeye çevirir", () => {
    const normalized = normalizeLegacyResult({
      grid_width_m: 4,
      grid_depth_m: 5,
      grid_origin_x_m: 1,
      grid_origin_y_m: 2,
      scan_steps: [{ index: 1, x_center_m: 0.5, y_center_m: 1.5, width_m: 0.2 }],
      grid_values: [1, 2, 3, 4],
      grid_coverage: [1, 1, 1, 1],
      residual_preview: [0, 1, 0, 1],
      meta: { device_code: "Legacy3DMagDevice", x_meters: 4, y_meters: 5 },
      anomalies: [{ cx: 1, cy: 2, kind: "anomaly", depth_top_m: 1, depth_bottom_m: 2, peak_sigma: 3 }],
      metals: [],
    });
    expect(normalized.gridWidthM).toBe(4);
    expect(normalized.gridDepthM).toBe(5);
    expect(normalized.gridOriginXM).toBe(1);
    expect(normalized.gridOriginYM).toBe(2);
    expect(normalized.scanSteps[0].xCenterM).toBe(0.5);
    expect(normalized.scanSteps[0].widthM).toBe(0.2);
    expect(normalized.gridValues).toEqual([1, 2, 3, 4]);
    expect(normalized.anomalies[0].depthTopM).toBe(1);
    expect(normalized.anomalies[0].peakSigma).toBe(3);
    expect(normalized.meta.deviceCode).toBe("Legacy3DMagDevice");
  });

  it("normalizeLegacyResult idempotent — normalize edilmiş DTO tekrar sıralanmaz", () => {
    const raw = {
      scan_steps: [
        { x_center_m: 0, y_center_m: 0 },
        { x_center_m: 1, y_center_m: 0 },
      ],
      anomalies: [{ cx: 0.5, cy: 0.5, kind: "anomaly" }],
    };
    const once = normalizeLegacyResult(raw);
    const twice = normalizeLegacyResult(once);
    expect(twice).toBe(once);
    expect(twice.scanSteps).toEqual(once.scanSteps);
    expect(twice.shapes).toEqual(once.shapes);
  });
  it("kaynak JSON sırasını korur; koordinata göre yeniden sıralamaz", () => {
    const normalized = normalizeLegacyResult({
      scan_steps: [
        { index: 1, x_center_m: 2, y_center_m: 1 },
        { index: 2, x_center_m: 0, y_center_m: 1 },
      ],
    });
    expect(normalized.scanSteps.map((step) => step.xCenterM)).toEqual([2, 0]);
    expect(normalized.scanSteps.map((step) => step.index)).toEqual([1, 2]);
  });

  it("gidiş-dönüş ve hat kaymasını kaynak sırasıyla korur", () => {
    const ordered = orderScanStepsLeftFirst([
      { xCenterM: 0, yCenterM: 0 },
      { xCenterM: 1, yCenterM: 0 },
      { xCenterM: 2, yCenterM: 0 },
      { xCenterM: 2, yCenterM: 1 },
      { xCenterM: 1, yCenterM: 1 },
      { xCenterM: 0, yCenterM: 1 },
      { xCenterM: 0.5, yCenterM: 2 },
      { xCenterM: 1.5, yCenterM: 2 },
    ]);
    expect(ordered.map((step) => [step.xCenterM, step.yCenterM])).toEqual([
      [0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0.5, 2], [1.5, 2],
    ]);
    expect(ordered.map((step) => step.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("kaynak sırası ikinci çağrıda da korunur", () => {
    const input = [
      { xCenterM: 0, yCenterM: 0 }, { xCenterM: 1, yCenterM: 0 },
      { xCenterM: 1, yCenterM: 1 }, { xCenterM: 0, yCenterM: 1 },
    ];
    const once = orderScanStepsLeftFirst(input);
    const twice = orderScanStepsLeftFirst(once);
    expect(twice.map((step) => [step.xCenterM, step.yCenterM])).toEqual(input.map((step) => [step.xCenterM, step.yCenterM]));
    expect(twice.map((step) => step.index)).toEqual([1, 2, 3, 4]);
  });

  it("matris ipucunda da fiziksel kaynak sırasını korur", () => {
    const input = [
      { xCenterM: 2, yCenterM: 1 }, { xCenterM: 0, yCenterM: 0 },
      { xCenterM: 2, yCenterM: 0 }, { xCenterM: 0, yCenterM: 1 },
    ];
    const ordered = orderScanStepsLeftFirst(input, { matrixRows: 2, matrixCols: 2 });
    expect(ordered.map((step) => [step.xCenterM, step.yCenterM])).toEqual(input.map((step) => [step.xCenterM, step.yCenterM]));
    expect(ordered[0].matrixRows).toBe(2);
    expect(ordered[0].matrixCols).toBe(2);
  });

  it("6'lı gidiş-dönüş örneğinde 1 adım kaymayı korur", () => {
    const input = [
      ...[0, 1, 2, 3, 4, 5].map((x) => ({ xCenterM: x, yCenterM: 0 })),
      ...[5, 4, 3, 2, 1, 0].map((x) => ({ xCenterM: x, yCenterM: 1 })),
      ...[0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((x) => ({ xCenterM: x, yCenterM: 2 })),
    ];
    const ordered = orderScanStepsLeftFirst(input);
    expect(ordered.map((step) => [step.xCenterM, step.yCenterM])).toEqual(input.map((step) => [step.xCenterM, step.yCenterM]));
    expect(ordered[0].index).toBe(1);
    expect(ordered[17].index).toBe(18);
  });

  it("matris yoksa da fiziksel kaynak sırasını korur", () => {
    const line = [
      { xCenterM: 3, yCenterM: 1 },
      { xCenterM: 0, yCenterM: 1.05 },
      { xCenterM: 1.5, yCenterM: 0.95 },
    ];
    const ordered = orderScanStepsLeftFirst(line);
    expect(ordered.map((step) => step.xCenterM)).toEqual([3, 0, 1.5]);
  });

  it("aynı konumda metal sonucunu önceliklendirir", () => {
    const shapes = mergeLegacyShapes({
      anomalies: [{ cx: 1, cy: 2, kind: "anomaly", peakSigma: 1 }],
      metals: [{ cx: 1, cy: 2, kind: "metal", peakSigma: 4 }],
    });
    expect(shapes).toHaveLength(1);
    expect(shapes[0].kind).toBe("metal");
    expect(shapes[0].peakSigma).toBe(4);
  });
});
