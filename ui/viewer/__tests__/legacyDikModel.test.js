import { describe, expect, it } from "vitest";
import {
  buildLegacyFieldBrief,
  buildLegacyFieldModel,
  formatLegacyFieldBriefHtml,
  formatLegacyFieldLine,
  legacyStepsOf,
  magneticResponseOf,
  matchesLegacyListFilter,
  residualScaleOf,
  statusLabel,
} from "../legacyDikModel.js";

const result = {
  scanSteps: [
    { index: 1, xStartM: 0, xEndM: 0, xCenterM: 0, yStartM: 0, yEndM: 2, yCenterM: 1, widthM: 0, lengthM: 2 },
    { index: 2, xStartM: 1, xEndM: 1, xCenterM: 1, yStartM: 0, yEndM: 2, yCenterM: 1, widthM: 0, lengthM: 2 },
  ],
  anomalies: [{ kind: "anomaly", cx: 1, cy: 1, confidence: 0.96, peakSigma: 3.4, depthTopM: 1.2, depthBottomM: 1.8, shapeType: "ellipse" }],
  metals: [],
};

describe("legacyDikModel", () => {
  it("normalizes camelCase and snake_case scan step fields", () => {
    const steps = legacyStepsOf({ scan_steps: [{ index: 3, x_center_m: 2, y_center_m: 4, width_m: 1.5 }] });
    expect(steps[0].index).toBe(1); // sol-önce yeniden numaralandırma
    expect(steps[0].xCenterM).toBe(2);
    expect(steps[0].widthM).toBe(1.5);
  });

  it("binds a detection to its nearest step and exposes station/offset/depth", () => {
    const model = buildLegacyFieldModel(result);
    expect(model.detections).toHaveLength(1);
    expect(model.detections[0].stepIndex).toBe(2);
    expect(model.detections[0].stationM).toBeCloseTo(1, 5);
    expect(model.detections[0].offsetM).toBeCloseTo(0, 5);
    expect(model.detections[0].depthTopM).toBeCloseTo(1.2, 5);
    expect(model.detections[0].depthBottomM).toBeCloseTo(1.8, 5);
    expect(model.detections[0].status).toBe("strong");
    expect(formatLegacyFieldLine(model.detections[0])).toContain("Adım 2");
  });

  it("serpentine taramada panel adımı ile 3D adım numarası aynı kalır", () => {
    const scanSteps = [];
    for (let x = 0; x < 6; x += 1) {
      const ys = x % 2 === 0 ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
      for (const y of ys) {
        scanSteps.push({
          xStartM: x,
          xEndM: x,
          xCenterM: x,
          yStartM: y,
          yEndM: y,
          yCenterM: y,
          widthM: 0,
          lengthM: 0,
        });
      }
    }
    const raw = {
      scan_steps: scanSteps.map((s, i) => ({ ...s, index: i + 1 })),
      metals: [{ kind: "metal", cx: 1.5, cy: 4.43, confidence: 0.78, peak_sigma: 3.1, depth_top_m: 1, depth_bottom_m: 2 }],
      anomalies: [],
      meta: { x_meters: 6, y_meters: 5 },
      grid_width_m: 6,
      grid_depth_m: 5,
    };
    const model = buildLegacyFieldModel(raw);
    const metal = model.detections[0];
    const step = model.steps.find((entry) => entry.stepIndex === metal.stepIndex);
    expect(step).toBeTruthy();
    // 3D cetvel aynı normalize sırasını kullanır — raw.index panel ile birebir.
    expect(step.raw.index).toBe(metal.stepIndex);
    // Metal (1.5, 4.43) X=1 veya X=2 hattına oturmalı; ikinci sıralama kayması olmamalı.
    expect(Math.abs(step.raw.xCenterM - 1.5)).toBeLessThanOrEqual(0.5);
  });

  it("adım aralığını hat metresine göre ardışık bantlara böler", () => {
    const model = buildLegacyFieldModel(result);
    expect(model.steps[0].startM).toBeCloseTo(0, 5);
    expect(model.steps[0].endM).toBeCloseTo(0.5, 5);
    expect(model.steps[1].startM).toBeCloseTo(0.5, 5);
    expect(model.steps[1].endM).toBeCloseTo(2, 5);
  });

  it("filtreyi son kullanıcı etiketlerine göre eşleştirir", () => {
    expect(matchesLegacyListFilter("all", { isDetection: false })).toBe(true);
    expect(matchesLegacyListFilter("detections", { isDetection: true })).toBe(true);
    expect(matchesLegacyListFilter("detections", { isDetection: false, anomalyCount: 0 })).toBe(false);
    expect(matchesLegacyListFilter("strong", { status: "strong" })).toBe(true);
    expect(matchesLegacyListFilter("normal", { status: "attention" })).toBe(false);
  });

  it("seçili tespit için sade saha özeti üretir", () => {
    const model = buildLegacyFieldModel(result);
    const brief = buildLegacyFieldBrief(model.detections[0]);
    expect(brief.plainText).toContain("Ne kadar derin");
    expect(brief.plainText).toContain("güven");
    expect(brief.plainText).toMatch(/%\d+/);
    expect(brief.plainText).toMatch(/\d+\.\dσ|σ/);
    expect(brief.plainText).toContain("Manyetik tepki");
    expect(formatLegacyFieldBriefHtml(brief)).toContain("legacy-saha-brief-title");
  });

  it("manyetik tepki yorumu χ / ferro iddiası taşımaz", () => {
    const metal = magneticResponseOf({ kind: "metal", polarity: 1, peakSigma: 3.2 });
    expect(metal.classId).toBe("metal_like_positive");
    expect(metal.label).toMatch(/metal-benzeri|pozitif/i);
    expect(metal.label).not.toMatch(/Ferromanyetik/i);
    expect(metal.disclaimer).toMatch(/χ ölçülmedi/);
    const neg = magneticResponseOf({ kind: "anomaly", polarity: -1, peakSigma: 2.0 });
    expect(neg.classId).toBe("void_like_negative");
  });

  it("residual ölçeğini grid max |değer| ile verir", () => {
    const raw = residualScaleOf({ gridValues: [0, -2, 4, 1], residualPreview: [] });
    expect(raw.maxAbs).toBe(4);
    expect(raw.unit).toBe("residual");
    const scaled = residualScaleOf({ gridValues: [0, -2, 4, 1], magSigma: 2 });
    expect(scaled.maxAbsSigma).toBeCloseTo(2, 5);
    expect(scaled.unit).toBe("σ");
  });

  it("counts detections per step and labels empty steps normal", () => {
    const model = buildLegacyFieldModel(result);
    expect(model.steps[0].anomalyCount).toBe(0);
    expect(statusLabel(model.steps[0].status)).toBe("NORMAL");
    expect(model.steps[1].anomalyCount).toBe(1);
    expect(statusLabel(model.steps[1].status)).toBe("GÜÇLÜ");
  });
});
