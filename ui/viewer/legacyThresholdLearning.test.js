import { describe, expect, it } from "vitest";
import {
  applyLearnedThresholds,
  buildLearnedThresholds,
  collectVerifiedSamples,
  LEGACY_THRESHOLD_LEARNING_SCHEMA_VERSION,
  MIN_SAMPLES_FOR_DEPTH,
  serializeLearnedThresholds,
} from "./legacyThresholdLearning.js";

function sample(id, status, { confidence, strength, depthTopM = 1, depthBottomM = 1.5, type = "Metal anomali adayı" } = {}) {
  return { detectionId: id, status, confidence, strength, depthTopM, depthBottomM, type };
}

describe("legacyThresholdLearning", () => {
  it("collectVerifiedSamples yalnız confirmed/rejected kararları toplar", () => {
    const samples = collectVerifiedSamples({
      fieldModel: {
        detections: [
          { detectionId: "d1", confidence: 0.9, strength: 3.5, depthTopM: 1, depthBottomM: 2, type: "Metal" },
          { detectionId: "d2", confidence: 0.4, strength: 1.2, depthTopM: 3, depthBottomM: 4, type: "Metal" },
          { detectionId: "d3", confidence: 0.6, strength: 2, depthTopM: 1, depthBottomM: 1, type: "Metal" },
        ],
      },
      session: { targetChecks: { d1: { status: "confirmed" }, d2: { status: "rejected" }, d3: { status: "reviewed" } } },
    });
    expect(samples.map((s) => s.detectionId)).toEqual(["d1", "d2"]);
    expect(samples.map((s) => s.type)).toEqual(["Metal", "Metal"]);
  });

  it("yeterli karar örneğiyle güven ve σ eşiği onaylı/reddedilmiş arasına çekilir", () => {
    const samples = [
      sample("a", "confirmed", { confidence: 0.8, strength: 3.2 }),
      sample("b", "confirmed", { confidence: 0.9, strength: 4.0 }),
      sample("c", "confirmed", { confidence: 0.85, strength: 3.6 }),
      sample("d", "rejected", { confidence: 0.5, strength: 2.0 }),
      sample("e", "rejected", { confidence: 0.45, strength: 1.8 }),
    ];
    const learned = buildLearnedThresholds(samples);
    expect(learned.schemaVersion).toBe(LEGACY_THRESHOLD_LEARNING_SCHEMA_VERSION);
    expect(learned.decisionSampleCount).toBe(5);
    // onaylı min 0.8, reddedilen max 0.5 → orta 0.65
    expect(learned.confidenceStrong).toBeCloseTo(0.65, 5);
    // onaylı min 3.2, reddedilen max 2.0 → orta 2.6
    expect(learned.sigmaStrong).toBeCloseTo(2.6, 5);
    // sınırlar içinde
    expect(learned.confidenceStrong).toBeGreaterThanOrEqual(0.4);
    expect(learned.confidenceStrong).toBeLessThanOrEqual(0.7);
    expect(learned.sigmaStrong).toBeGreaterThanOrEqual(1.5);
    expect(learned.sigmaStrong).toBeLessThanOrEqual(4.0);
  });

  it("az örnekle önceki eşikleri korur (etkisiz öğrenme)", () => {
    const learned = buildLearnedThresholds(
      [sample("a", "confirmed", { confidence: 0.9, strength: 3.5 })],
      { confidenceStrong: 0.55, sigmaStrong: 3.0 },
    );
    expect(learned.decisionSampleCount).toBeLessThan(4);
    expect(learned.confidenceStrong).toBeCloseTo(0.55, 5);
    expect(learned.sigmaStrong).toBeCloseTo(3.0, 5);
  });

  it("tip bazlı derinlik bandı en az 3 onaylı örnekle üretilir", () => {
    const samples = [
      sample("a", "confirmed", { confidence: 0.8, strength: 3, depthTopM: 1.0, depthBottomM: 1.4 }),
      sample("b", "confirmed", { confidence: 0.9, strength: 3, depthTopM: 1.2, depthBottomM: 1.6 }),
      sample("c", "confirmed", { confidence: 0.7, strength: 3, depthTopM: 1.1, depthBottomM: 1.5 }),
    ];
    const learned = buildLearnedThresholds(samples);
    const band = learned.depthBands["Metal anomali adayı"];
    expect(band).toBeDefined();
    expect(band.sampleCount).toBe(MIN_SAMPLES_FOR_DEPTH);
    // medyan üst 1.1, alt 1.5 → ±%60 span bant
    expect(band.centerTopM).toBeLessThan(1.1);
    expect(band.centerBottomM).toBeGreaterThan(1.5);
  });

  it("applyLearnedThresholds yüksek güveni güçlü yapar ve bant notu ekler", () => {
    const learned = buildLearnedThresholds([
      sample("a", "confirmed", { confidence: 0.8, strength: 3.2 }),
      sample("b", "confirmed", { confidence: 0.9, strength: 4.0 }),
      sample("c", "confirmed", { confidence: 0.85, strength: 3.6 }),
      sample("d", "rejected", { confidence: 0.5, strength: 2.0 }),
      sample("e", "rejected", { confidence: 0.45, strength: 1.8 }),
      ...[1.0, 1.1, 1.2].map((t, i) => sample(`p${i}`, "confirmed", { confidence: 0.8, strength: 3, depthTopM: t, depthBottomM: t + 0.4 })),
    ]);
    const strong = applyLearnedThresholds(
      { detectionId: "x", confidence: 0.75, strength: 2.4, depthTopM: 1.1, depthBottomM: 1.5, type: "Metal anomali adayı" },
      learned,
      { status: "normal" },
    );
    expect(strong.status).toBe("strong");
    expect(strong.depthNote).toContain("beklenen derinlik bandı");

    const weak = applyLearnedThresholds(
      { detectionId: "y", confidence: 0.3, strength: 1.0, depthTopM: 5, depthBottomM: 6, type: "Metal anomali adayı" },
      learned,
      { status: "normal" },
    );
    expect(weak.status).toBe("normal");
    expect(weak.depthNote).toBeNull();
  });

  it("learned null ise varsayılan davranış korunur", () => {
    const result = applyLearnedThresholds({ confidence: 0.9, strength: 4 }, null, { status: "normal" });
    expect(result.status).toBe("normal");
    expect(result.depthNote).toBeNull();
  });

  it("serializeLearnedThresholds deterministik kompakt çıktı verir", () => {
    const learned = buildLearnedThresholds([
      sample("a", "confirmed", { confidence: 0.8, strength: 3.2 }),
      sample("b", "confirmed", { confidence: 0.9, strength: 4.0 }),
      sample("c", "confirmed", { confidence: 0.85, strength: 3.6 }),
      sample("d", "rejected", { confidence: 0.5, strength: 2.0 }),
      sample("e", "rejected", { confidence: 0.45, strength: 1.8 }),
    ]);
    const serialized = serializeLearnedThresholds(learned);
    expect(serialized.confidenceStrong).toBeCloseTo(0.65, 3);
    expect(serialized.decisionSampleCount).toBe(5);
    expect(Object.keys(serialized)).toEqual([
      "schemaVersion",
      "confidenceStrong",
      "sigmaStrong",
      "depthBands",
      "decisionSampleCount",
      "confirmedCount",
      "rejectedCount",
      "updatedAt",
    ]);
  });
});
