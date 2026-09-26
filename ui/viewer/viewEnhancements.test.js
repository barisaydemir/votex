import { describe, expect, it } from "vitest";
import { legacySelectionBadgeDataOf, verificationBadgeAccentOf } from "./viewEnhancements.js";

describe("viewEnhancements", () => {
  it("doğrulama durumuna göre rozet accent rengini seçer", () => {
    expect(verificationBadgeAccentOf("confirmed")).toBe("#3edc8c");
    expect(verificationBadgeAccentOf("rejected")).toBe("#e23a3a");
    expect(verificationBadgeAccentOf("reviewed")).toBe("#e8a020");
    expect(verificationBadgeAccentOf("unknown")).toBe("#9ca3af");
  });

  it("seçili Legacy obje için kısa bilgi rozeti verisi üretir", () => {
    const data = legacySelectionBadgeDataOf("legacy-dik-shape-12", { depthM: 1.2 }, {
      legacyFieldModel: {
        detections: [{
          detectionId: "legacy-dik-shape-12",
          confidence: 0.87,
          depthTopM: 1.4,
          depthBottomM: 2,
        }],
      },
      legacyFieldSessionController: {
        session: { targetChecks: { "legacy-dik-shape-12": { status: "confirmed" } } },
      },
    });

    expect(data).toEqual({
      title: "T-12",
      lines: ["%87 güven · 1.40–2.00 m", "Doğrulandı"],
      status: "confirmed",
    });
  });

  it("karar yoksa rozeti doğrulanmadı olarak gösterir", () => {
    const data = legacySelectionBadgeDataOf("legacy-dik-shape-3", null, {
      legacyFieldModel: { detections: [{ detectionId: "legacy-dik-shape-3", confidence: 0.4, depthTopM: 3, depthBottomM: 3.6 }] },
      legacyFieldSessionController: { session: { targetChecks: {} } },
    });

    expect(data.lines[1]).toBe("Doğrulanmadı");
    expect(data.status).toBe("unverified");
  });
});
