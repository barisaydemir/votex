import { describe, expect, it } from "vitest";
import { findSimilarReviewedCases, formatSimilarReviewedCases } from "./legacyReviewedCaseSearch.js";

const current = {
  fingerprint: "current",
  detection: { type: "Metal anomali adayı", depthTopM: 1, depthBottomM: 2, confidence: 0.8, strength: 3 },
};

describe("legacyReviewedCaseSearch", () => {
  it("yalnız farklı vakalardaki yakın ve açık operatör kararlarını döndürür", () => {
    const matches = findSimilarReviewedCases(current, [
      { caseKey: "a", fingerprint: "a", decision: "confirmed", detection: current.detection },
      { caseKey: "b", fingerprint: "b", decision: "rejected", detection: { ...current.detection, confidence: 0.78 } },
      { caseKey: "c", fingerprint: "c", decision: "reviewed", detection: current.detection },
      { caseKey: "same", fingerprint: "current", decision: "confirmed", detection: current.detection },
      { caseKey: "far", fingerprint: "far", decision: "confirmed", detection: { type: "Anomali", depthTopM: 9, depthBottomM: 10, confidence: 0.1, strength: 0.1 } },
    ]);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ decision: "confirmed", similarityPct: 100 });
    expect(matches[1].decision).toBe("rejected");
  });

  it("aynı arşiv vakasından yalnız en yakın adayı ve en çok üç vakayı tutar", () => {
    const matches = findSimilarReviewedCases(current, Array.from({ length: 5 }, (_, index) => ({
      caseKey: `case-${Math.floor(index / 2)}`,
      decision: "confirmed",
      detection: current.detection,
    })));
    expect(matches).toHaveLength(3);
  });

  it("özet vaka kimliği veya dosya adı sızdırmaz ve kanıtın sınırını belirtir", () => {
    const text = formatSimilarReviewedCases([{
      archiveId: "private-id", fileName: "site-location.json", decision: "confirmed", similarityPct: 88,
      type: "Anomali", depthTopM: 1, depthBottomM: 2, confidencePct: 80, strengthSigma: 3,
    }]);
    expect(text).toContain("karşılaştırma bağlamı");
    expect(text).toContain("teşhis değildir");
    expect(text).not.toContain("private-id");
    expect(text).not.toContain("site-location");
  });
});
