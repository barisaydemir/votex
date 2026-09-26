import { describe, expect, it } from "vitest";
import { formatLegacyMatrixProductStatus } from "../legacyMatrixValidate.js";

describe("formatLegacyMatrixProductStatus", () => {
  it("otomatik (0×0)", () => {
    const out = formatLegacyMatrixProductStatus({ matrixRows: 0, matrixCols: 0, scanStepCount: 0 }, 18);
    expect(out.status).toBe("auto");
  });

  it("etiket var, analiz yok", () => {
    const out = formatLegacyMatrixProductStatus({ matrixRows: 6, matrixCols: 3, scanStepCount: 18 }, null);
    expect(out.status).toBe("label");
    expect(out.text).toContain("18 adım");
  });

  it("eşleşme", () => {
    const out = formatLegacyMatrixProductStatus({ matrixRows: 6, matrixCols: 3, scanStepCount: 18 }, 18);
    expect(out.status).toBe("match");
    expect(out.text).toContain("eşleşti");
  });

  it("uyumsuzluk", () => {
    const out = formatLegacyMatrixProductStatus({ matrixRows: 6, matrixCols: 3, scanStepCount: 18 }, 3);
    expect(out.status).toBe("mismatch");
    expect(out.text).toContain("Etiket 18");
    expect(out.text).toContain("analiz 3");
  });
});
