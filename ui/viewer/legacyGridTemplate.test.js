import { describe, expect, it } from "vitest";
import {
  applyDisplayStepNumbering,
  buildLegacyGridTemplate,
  findLegacyGridCell,
} from "./legacyGridTemplate.js";

describe("legacyGridTemplate", () => {
  it("6×3 değerini 6 satır ve 3 sütun olarak 18 hücreye çevirir", () => {
    const template = buildLegacyGridTemplate({ rows: 6, cols: 3, widthM: 6, depthM: 12 });
    expect(template.rows).toBe(6);
    expect(template.cols).toBe(3);
    expect(template.cells).toHaveLength(18);
    expect(template.cellWidthM).toBe(2);
    expect(template.cellHeightM).toBe(2);
    expect(template.cells.every((cell) => cell.widthM === cell.heightM)).toBe(true);
  });

  it("dikdörtgen haritada hücreler kenara kadar uzanır (yan boşluk yok)", () => {
    // 9×3 matris, 3×6 m saha — eski kare zorlaması 2 m genişlik bırakırdı
    const template = buildLegacyGridTemplate({ rows: 9, cols: 3, widthM: 3, depthM: 6 });
    expect(template.cellWidthM).toBe(1);
    expect(template.cellHeightM).toBeCloseTo(6 / 9, 8);
    expect(template.cells).toHaveLength(27);
    const maxX = Math.max(...template.cells.map((cell) => cell.maxXM));
    const maxY = Math.max(...template.cells.map((cell) => cell.maxYM));
    expect(maxX).toBeCloseTo(3, 8);
    expect(maxY).toBeCloseTo(6, 8);
    expect(template.cells.every((cell) => cell.widthM === template.cellWidthM)).toBe(true);
    expect(template.cells.every((cell) => cell.heightM === template.cellHeightM)).toBe(true);
  });

  it("alt satırdan başlar ve satırlarda gidiş-dönüş yönünü korur", () => {
    const steps = Array.from({ length: 6 }, (_, index) => ({ index: index + 1 }));
    const template = buildLegacyGridTemplate({ rows: 2, cols: 3, widthM: 3, depthM: 2, scanSteps: steps });
    const byPosition = (row, col) => template.cells.find((cell) => cell.row === row && cell.col === col);
    expect(byPosition(0, 0).stepIndex).toBe(1);
    expect(byPosition(1, 0).stepIndex).toBe(2);
    expect(byPosition(0, 1).stepIndex).toBe(3);
    expect(byPosition(1, 1).stepIndex).toBe(4);
    expect(byPosition(0, 2).stepIndex).toBe(5);
    expect(byPosition(1, 2).stepIndex).toBe(6);
    expect(byPosition(0, 0).direction).toBe("forward");
    expect(byPosition(0, 1).direction).toBe("return");
  });

  it("sağdan sola seçeneğinde sütunları ters yönde numaralandırır", () => {
    const steps = Array.from({ length: 6 }, (_, index) => ({ index: index + 1 }));
    const template = buildLegacyGridTemplate({ rows: 2, cols: 3, widthM: 3, depthM: 2, scanSteps: steps, numberingDirection: "rtl" });
    const byPosition = (row, col) => template.cells.find((cell) => cell.row === row && cell.col === col);
    expect(byPosition(0, 2).stepIndex).toBe(1);
    expect(byPosition(1, 2).stepIndex).toBe(2);
    expect(byPosition(0, 0).stepIndex).toBe(5);
    expect(byPosition(1, 0).stepIndex).toBe(6);
  });

  it("LTR→RTL geçince aynı fiziksel noktada görünen adım no değişir", () => {
    const steps = [
      { index: 1, xCenterM: 0.5, yCenterM: 0.5 },
      { index: 2, xCenterM: 0.5, yCenterM: 1.5 },
      { index: 3, xCenterM: 1.5, yCenterM: 0.5 },
      { index: 4, xCenterM: 1.5, yCenterM: 1.5 },
      { index: 5, xCenterM: 2.5, yCenterM: 0.5 },
      { index: 6, xCenterM: 2.5, yCenterM: 1.5 },
    ];
    const ltr = applyDisplayStepNumbering(steps, {
      rows: 2, cols: 3, widthM: 3, depthM: 2, numberingDirection: "ltr",
    });
    const rtl = applyDisplayStepNumbering(steps, {
      rows: 2, cols: 3, widthM: 3, depthM: 2, numberingDirection: "rtl",
    });
    const leftLtr = ltr.find((step) => step.xCenterM === 0.5 && step.yCenterM === 0.5);
    const leftRtl = rtl.find((step) => step.xCenterM === 0.5 && step.yCenterM === 0.5);
    const rightLtr = ltr.find((step) => step.xCenterM === 2.5 && step.yCenterM === 0.5);
    const rightRtl = rtl.find((step) => step.xCenterM === 2.5 && step.yCenterM === 0.5);
    expect(leftLtr.index).toBe(1);
    expect(rightLtr.index).toBe(5);
    expect(leftRtl.index).toBe(5);
    expect(rightRtl.index).toBe(1);
  });
  it("hücrelerin metre sınırlarını üretir", () => {
    const template = buildLegacyGridTemplate({ rows: 3, cols: 2, widthM: 4, depthM: 6, originXM: 10, originYM: 20 });
    const cell = template.cells.find((item) => item.row === 1 && item.col === 1);
    expect(cell.minXM).toBe(12);
    expect(cell.maxXM).toBe(14);
    expect(cell.minYM).toBe(22);
    expect(cell.maxYM).toBe(24);
    expect(cell.centerXM).toBe(13);
    expect(cell.centerYM).toBe(23);
  });

  it("tespit koordinatını gerçek tarama hücresine bağlar", () => {
    const steps = [
      ...[0, 1, 2].map((y, index) => ({ index: index + 1, xCenterM: 0.5, yCenterM: y + 0.5 })),
      ...[2, 1, 0].map((y, index) => ({ index: index + 4, xCenterM: 1.5, yCenterM: y + 0.5 })),
    ];
    const template = buildLegacyGridTemplate({ rows: 3, cols: 2, widthM: 2, depthM: 3, scanSteps: steps });
    const cell = findLegacyGridCell(template, 1.5, 1.5);
    expect(cell.stepIndex).toBe(5);
    expect(cell.col).toBe(1);
    expect(cell.row).toBe(1);
  });
});
