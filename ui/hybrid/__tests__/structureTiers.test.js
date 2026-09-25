import { describe, it, expect } from "vitest";
import {
  computeGridStats,
  zScoreOf,
  clusterSeeds,
  classifyCluster,
  buildStructureDetections,
} from "../structureTiers.js";

const STATS = { mean: 0, std: 100 };

describe("structureTiers.js — küme birleştirme + şekil sınıflandırma", () => {
  it("computeGridStats / zScoreOf temel z-skoru", () => {
    const stats = computeGridStats([{ magnetic: -10 }, { magnetic: 10 }]);
    expect(stats.mean).toBeCloseTo(0, 6);
    expect(zScoreOf(10, stats)).toBeCloseTo(1, 6);
    expect(zScoreOf(-10, stats)).toBeCloseTo(-1, 6);
  });

  it("bitişik tohumlar tek kümede birleşir (kırık parçalar tek yapı)", () => {
    const cells = [
      { x: 0.1, y: 0.1, gx: 0, gy: 0, magnetic: 400 },
      { x: 0.2, y: 0.1, gx: 1, gy: 0, magnetic: 420 },
      { x: 0.3, y: 0.1, gx: 2, gy: 0, magnetic: 380 },
      // uzak ve zayıf — tohum değil
      { x: 0.9, y: 0.9, gx: 9, gy: 9, magnetic: 50 },
    ];
    const clusters = clusterSeeds(cells, STATS, 2.5, 10);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].area).toBe(3);
    expect(clusters[0].sign).toBe(1);
    expect(clusters[0].peakZ).toBeCloseTo(4.2, 3);
  });

  it("keşif tohumu (seedZ) zayıf ama tutarlı anomalileri açığa çıkarır", () => {
    const cells = [
      { x: 0.1, y: 0.1, gx: 0, gy: 0, magnetic: 300 }, // z = 3.0 (güçlü)
      { x: 0.5, y: 0.5, gx: 5, gy: 5, magnetic: 150 }, // z = 1.5 (zayıf)
    ];
    // Katı tohum (2.5σ): yalnız güçlü anomali KEŞFEDİLİR
    expect(clusterSeeds(cells, STATS, 2.5, 10)).toHaveLength(1);
    // Hassas tohum (1.0σ): zayıf anomali de KEŞFEDİLİR — silme değil, keşif!
    expect(clusterSeeds(cells, STATS, 1.0, 10)).toHaveLength(2);
  });

  it("şekil sınıflandırma: metal / tünel / oda / boşluk", () => {
    expect(classifyCluster({ sign: 1, area: 20, aspect: 1.2 })).toBe("metal");
    expect(classifyCluster({ sign: -1, area: 6, aspect: 4.0 })).toBe("tunnel");
    expect(classifyCluster({ sign: -1, area: 12, aspect: 1.4 })).toBe("chamber");
    expect(classifyCluster({ sign: -1, area: 2, aspect: 1.1 })).toBe("void");
    // uzamış ama çok küçük → tünel değil
    expect(classifyCluster({ sign: -1, area: 3, aspect: 5.0 })).toBe("void");
  });

  it("buildStructureDetections budamasız üretir + alan/z-skor/güven alanları yazılır", () => {
    // 10×10 grid: gy=4 satırında 6 hücrelik güçlü negatif koridor (tünel)
    const fusionGrid = [];
    for (let gy = 0; gy < 10; gy++) {
      for (let gx = 0; gx < 10; gx++) {
        const inLine = gy === 4 && gx >= 2 && gx <= 7;
        fusionGrid.push({
          x: gx / 9,
          y: gy / 9,
          gx,
          gy,
          magnetic: inLine ? -400 : 0,
          confidence: 0.8,
        });
      }
    }
    const depthResult = { depthGrid: [{ gx: 2, gy: 4, depth: 7 }] };

    const dets = buildStructureDetections({
      fusionGrid,
      depthResult,
      poolSizeM: 30,
      gridRes: 10,
      sensitivityParams: { seedZ: 2.5 },
    });

    expect(dets).toHaveLength(1);
    const t = dets[0];
    expect(t.type).toBe("tunnel");
    expect(t.area).toBe(6);
    expect(t.zScore).toBeGreaterThan(2.5);
    expect(t.confidence).toBeGreaterThan(0);
    expect(t.confidence).toBeLessThanOrEqual(1);
    expect(t.depth).toBe(7);
    // tünel uçları koridor boyunca
    expect(Number.isFinite(t.x0)).toBe(true);
    expect(Number.isFinite(t.x1)).toBe(true);
  });

  it("pozitif küme metal olarak sınıflanır ve budanmadan çıkar", () => {
    // Tek hücre istatistiksel anomali olamaz (σ=0) — arka plan gürültüsü ekle
    const fusionGrid = [];
    for (let gx = 0; gx < 10; gx++) {
      fusionGrid.push({
        x: gx / 9,
        y: 0.5,
        gx,
        gy: 5,
        magnetic: gx === 5 ? 500 : 0,
        confidence: 0.6,
      });
    }
    const dets = buildStructureDetections({
      fusionGrid,
      poolSizeM: 30,
      gridRes: 10,
      sensitivityParams: { seedZ: 1.0 },
    });
    expect(dets).toHaveLength(1);
    expect(dets[0].type).toBe("metal");
  });
});
