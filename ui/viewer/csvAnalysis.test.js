import { describe, it, expect } from "vitest";
import { build2DGrid, detectStructuresFromTerrain, analyzeDepthSlices } from "./csvAnalysis.js";

describe("build2DGrid", () => {
  it("noktaları hücrelere toplar ve boş hücreleri IDW ile doldurur", () => {
    const pts = [
      { x: 1, y: -5, z: 1, magnetic: 100 },
      { x: 9, y: -5, z: 9, magnetic: 200 },
    ];
    const g = build2DGrid(pts, 10, { xMin: 0, xMax: 10, zMin: 0, zMax: 10 }, false);
    expect(g.gridRes).toBe(10);
    // Tüm hücreler dolu (counts > 0) — IDW doldurdu
    for (let i = 0; i < g.counts.length; i++) {
      expect(g.counts[i]).toBeGreaterThan(0);
    }
    // (1,1) noktası hücre 11'e düşer (gx=1, gz=1)
    expect(g.mGrid[11]).toBe(100);
    // Boş hücrelerde IDW dolgusu — 100..200 arası bir ara değer
    expect(g.mGrid[55]).toBeGreaterThan(99);
    expect(g.mGrid[55]).toBeLessThan(201);
  });

  it("yGrid derinlik ortalamasını tutar", () => {
    const pts = [
      { x: 1, y: -10, z: 1, magnetic: 5 },
      { x: 1, y: -20, z: 1, magnetic: 7 },
    ];
    const g = build2DGrid(pts, 10, { xMin: 0, xMax: 10, zMin: 0, zMax: 10 }, false);
    // İki nokta aynı hücreye (11) düşer → derinlik ortalaması -15
    expect(g.yGrid[11]).toBeCloseTo(-15, 1);
  });
});

describe("detectStructuresFromTerrain", () => {
  it("güçlü manyetik bölgeyi metal olarak bulur", () => {
    const res = 8;
    const yGrid = new Float32Array(res * res).fill(-5);
    const mGrid = new Float32Array(res * res).fill(300);
    const counts = new Uint32Array(res * res).fill(1);
    // 6 hücrelik aykırı manyetik tepe — persentil bandının ötesinde
    // (p90 indeksi 57 olduğundan son 6 hücre eşiğin üzerinde kalır)
    for (let gz = 3; gz <= 4; gz++) {
      for (let gx = 3; gx <= 5; gx++) {
        mGrid[gz * res + gx] = 2000;
      }
    }
    const found = detectStructuresFromTerrain(yGrid, mGrid, counts, res, 30, { mean: 300, stddev: 10 });
    expect(found.metals.length).toBeGreaterThan(0);
    expect(found.chambers.length + found.tunnels.length).toBe(0);
  });

  it("düz (anomalisiz) grid'de hiçbir yapı bulmaz", () => {
    const res = 8;
    const yGrid = new Float32Array(res * res).fill(-5);
    const mGrid = new Float32Array(res * res).fill(300);
    const counts = new Uint32Array(res * res).fill(1);
    const found = detectStructuresFromTerrain(yGrid, mGrid, counts, res, 30, { mean: 300, stddev: 1 });
    expect(found.metals.length + found.chambers.length + found.tunnels.length).toBe(0);
  });

  it("güçlü NEGATİF bölgeyi oda (boşluk) olarak bulur — metal değil", () => {
    const res = 8;
    const yGrid = new Float32Array(res * res).fill(-5);
    const mGrid = new Float32Array(res * res).fill(300);
    const counts = new Uint32Array(res * res).fill(1);
    // Negatif aykırı bölge (manyetik zayıflama = boşluk/mağara)
    for (let gz = 3; gz <= 4; gz++) {
      for (let gx = 3; gx <= 5; gx++) {
        mGrid[gz * res + gx] = -2000;
      }
    }
    const found = detectStructuresFromTerrain(yGrid, mGrid, counts, res, 30, { mean: 300, stddev: 10 });
    expect(found.chambers.length).toBeGreaterThan(0);
    expect(found.metals.length).toBe(0);
  });

  it("tespitler güçlüden zayıfa sıralanır", () => {
    const res = 16;
    const yGrid = new Float32Array(res * res).fill(-5);
    const mGrid = new Float32Array(res * res).fill(100);
    const counts = new Uint32Array(res * res).fill(1);
    // Güçlü bölge (solda)
    for (let gz = 4; gz <= 5; gz++) {
      for (let gx = 3; gx <= 5; gx++) mGrid[gz * res + gx] = 4000;
    }
    // Zayıf bölge (sağda, ayrık)
    for (let gz = 4; gz <= 5; gz++) {
      for (let gx = 11; gx <= 13; gx++) mGrid[gz * res + gx] = 900;
    }
    const found = detectStructuresFromTerrain(yGrid, mGrid, counts, res, 30, {}, {});
    expect(found.metals.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < found.metals.length; i++) {
      expect(found.metals[i - 1].strength).toBeGreaterThanOrEqual(found.metals[i].strength);
    }
  });

  it("eşik yükselince zayıf bölgeler artık bulunmaz", () => {
    const res = 8;
    const yGrid = new Float32Array(res * res).fill(-5);
    const mGrid = new Float32Array(res * res).fill(100);
    const counts = new Uint32Array(res * res).fill(1);
    // Orta güçlü bölge — p90'i da taşıyacak kadar büyük (~%%30 hücre)
    // arka plan 100, tepe 1500 → z-skor 1.0
    for (let gz = 3; gz <= 6; gz++) {
      for (let gx = 3; gx <= 7; gx++) {
        mGrid[gz * res + gx] = 1500;
      }
    }
    const low = detectStructuresFromTerrain(yGrid, mGrid, counts, res, 30, {}, {
      threshold: 0.8, minStrength: 0.3,
    });
    const high = detectStructuresFromTerrain(yGrid, mGrid, counts, res, 30, {}, {
      threshold: 1.8, minStrength: 0.9,
    });
    expect(low.metals.length + low.chambers.length + low.tunnels.length).toBeGreaterThan(0);
    expect(high.metals.length + high.chambers.length + high.tunnels.length).toBe(0);
  });

  it("uzun-dar bölgeyi tünel olarak bulur", () => {
    const res = 8;
    const yGrid = new Float32Array(res * res).fill(-5);
    const mGrid = new Float32Array(res * res).fill(100);
    const counts = new Uint32Array(res * res).fill(1);
    // 3x7 koridor — en/boy oranı 2.33 > 2.2 → tünel
    for (let gz = 2; gz <= 4; gz++) {
      for (let gx = 1; gx <= 7; gx++) {
        mGrid[gz * res + gx] = 2000;
      }
    }
    const found = detectStructuresFromTerrain(yGrid, mGrid, counts, res, 30, { mean: 100, stddev: 10 });
    expect(found.tunnels.length).toBeGreaterThan(0);
    // Koridor düzgün tek bölge olmalı (artık parça oluşmamalı)
    expect(found.tunnels.length).toBe(1);
  });
});

describe("analyzeDepthSlices", () => {
  function makePoints() {
    const pts = [];
    for (let y = -300; y < 0; y += 10) {
      pts.push({ x: -100, y, z: -100, magnetic: 500 });
    }
    return pts;
  }

  it("her dilim için yapı tespiti çalıştırır ve toplamları döndürür", () => {
    const pts = makePoints();
    const rep = analyzeDepthSlices(pts, { sliceCount: 4, poolSizeM: 30, gridRes: 16 });
    expect(rep.sliceCount).toBe(4);
    expect(rep.slices.length).toBe(4);
    // Tüm noktalar dilimlere dağılmış olmalı (boş dilim yok)
    const totalCount = rep.slices.reduce((a, s) => a + s.count, 0);
    expect(totalCount).toBe(pts.length);
    // Toplam doğru
    expect(rep.totals.chambers).toBe(rep.slices.reduce((a, s) => a + s.chambers.length, 0));
    expect(rep.totals.tunnels).toBe(rep.slices.reduce((a, s) => a + s.tunnels.length, 0));
    expect(rep.totals.metals).toBe(rep.slices.reduce((a, s) => a + s.metals.length, 0));
    // Her dilimin kendi bandı: 1 yüzeye yakın, son dilim en derin
    expect(rep.slices[0].yMax).toBeGreaterThan(rep.slices[rep.slices.length - 1].yMax);
    expect(rep.slices[0].yMin).toBeGreaterThan(rep.slices[rep.slices.length - 1].yMin);
  });

  it("yer altı kriterine uymayan noktalardan dilim üretmez", () => {
    const pts = [...makePoints(), { x: 5, y: -50, z: -50 }, { x: -5, y: 50, z: -50 }];
    const rep = analyzeDepthSlices(pts, { sliceCount: 2 });
    const total = rep.slices.reduce((a, s) => a + s.count, 0);
    expect(total).toBe(makePoints().length);
  });

  it("boş/uygunsuz veride boş rapor döndürür", () => {
    const rep = analyzeDepthSlices([], { sliceCount: 4 });
    expect(rep.slices).toHaveLength(0);
    expect(rep.totals).toEqual({ chambers: 0, tunnels: 0, metals: 0 });
  });
});