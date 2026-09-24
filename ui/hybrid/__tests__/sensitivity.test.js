import { describe, it, expect } from "vitest";
import {
  calculateSensitivityParameters,
  filterDetectionsBySensitivity,
  sensitivityPercentForMinConfidence,
} from "../sensitivity.js";
import spec from "../../../shared/sensitivity.json";

describe("sensitivity.js — Yapı Hassasiyeti Birim Testleri", () => {
  it("0% hassasiyet için katı eşikleri doğru hesaplar", () => {
    const p = calculateSensitivityParameters(0);
    expect(p.matchThreshold).toBe(0.15);
    expect(p.minArea).toBe(250);
    expect(p.minConfidence).toBe(0.8);
    expect(p.label).toContain("Katı");
  });

  it("50% (Dengeli) hassasiyet için varsayılan eşikleri hesaplar", () => {
    const p = calculateSensitivityParameters(50);
    expect(p.matchThreshold).toBeCloseTo(0.375, 2);
    expect(p.minArea).toBe(133);
    expect(p.minConfidence).toBe(0.48);
    expect(p.label).toContain("Dengeli");
  });

  it("100% hassasiyet için detaylı eşikleri hesaplar", () => {
    const p = calculateSensitivityParameters(100);
    expect(p.matchThreshold).toBe(0.6);
    expect(p.minArea).toBe(15);
    expect(p.minConfidence).toBe(0.15);
    expect(p.label).toContain("Maksimum");
  });

  it("anomalileri minArea ve minConfidence kriterlerine göre süzer", () => {
    const sampleAnomalies = [
      { id: 1, area: 300, confidence: 0.85 },
      { id: 2, area: 100, confidence: 0.5 },
      { id: 3, area: 10, confidence: 0.2 },
    ];

    // %0 hassasiyette minArea=250, minConf=0.80 -> Sadece 1. eleman geçmeli
    const strict = filterDetectionsBySensitivity(sampleAnomalies, 0);
    expect(strict).toHaveLength(1);
    expect(strict[0].id).toBe(1);

    // %100 hassasiyette minArea=15, minConf=0.15 -> 1 ve 2 geçmeli (3. elemanın alanı 10 < 15)
    const maxDet = filterDetectionsBySensitivity(sampleAnomalies, 100);
    expect(maxDet).toHaveLength(2);
    expect(maxDet.map((a) => a.id)).toEqual([1, 2]);
  });

  it("min güven → hassasiyet yüzdesi ters eşlemesi 5'lik adıma yuvarlanır", () => {
    expect(sensitivityPercentForMinConfidence(0.8)).toBe(0);
    expect(sensitivityPercentForMinConfidence(0.15)).toBe(100);
    expect(sensitivityPercentForMinConfidence(0.45)).toBe(55);
  });

  it("birleşik panel yapılarını (confidence alanı) hassasiyete göre süzer", () => {
    const structures = [
      { type: "metal", confidence: 0.85, size: 1.5 },
      { type: "chamber", confidence: 0.45, size: 3 },
      { type: "void", confidence: 0.2, size: 2 },
    ];
    // %0 → min güven 0.80: yalnız güçlü metal
    expect(filterDetectionsBySensitivity(structures, 0)).toHaveLength(1);
    // %65 → min güven 0.38: metal + oda
    expect(filterDetectionsBySensitivity(structures, 65)).toHaveLength(2);
    // %100 → min güven 0.15: tümü
    expect(filterDetectionsBySensitivity(structures, 100)).toHaveLength(3);
  });

  it("hassasiyet yüzdesi → min güven → yüzdesi tur güvenilirliği", () => {
    for (const pct of [0, 15, 35, 50, 55, 65, 85, 100]) {
      const { minConfidence } = calculateSensitivityParameters(pct);
      expect(sensitivityPercentForMinConfidence(minConfidence)).toBe(pct);
    }
  });

  it("paylaşılan sensitivity.json golden vektörleriyle eşleşir (JS/Rust paritesi)", () => {
    expect(spec.golden.length).toBeGreaterThan(0);
    for (const g of spec.golden) {
      const p = calculateSensitivityParameters(g.percent);
      expect(Math.abs(p.matchThreshold - g.match_threshold)).toBeLessThanOrEqual(0.001);
      expect(p.minArea).toBe(g.min_area);
      expect(Math.abs(p.minConfidence - g.min_confidence)).toBeLessThanOrEqual(0.01);
    }
  });
});
