import { describe, it, expect } from "vitest";
import { computeContourSegments, jetColor, valueToPaletteColor } from "./csvHeatmap.js";

describe("valueToPaletteColor", () => {
  it("device paleti doğrusal gökkuşağı: min mavi, max kırmızı", () => {
    expect(valueToPaletteColor(0, 0, 100, "device")).toEqual([0, 0, 128]);
    expect(valueToPaletteColor(100, 0, 100, "device")).toEqual([255, 0, 0]);
  });

  it("votex paleti orta değeri yeşil yapar (simetrik)", () => {
    const c = valueToPaletteColor(50, 0, 100, "votex");
    expect(c[1]).toBeGreaterThan(c[0]);
    expect(c[1]).toBeGreaterThan(c[2]);
  });

  it("jetColor 0..1 aralığına kırpılır", () => {
    expect(jetColor(-1)).toEqual(jetColor(0));
    expect(jetColor(2)).toEqual(jetColor(1));
  });
});

describe("computeContourSegments", () => {
  it("tek hücrelik bölge dört kenarla çevrelenir", () => {
    const mask = new Uint8Array(9); // 3×3
    mask[4] = 1; // merkez
    expect(computeContourSegments(mask, 3, 3)).toHaveLength(4);
  });

  it("komşu hücrelerin paylaştığı kenar kontura girmez", () => {
    const mask = new Uint8Array(9);
    mask[4] = 1;
    mask[5] = 1; // merkez + sağ
    // 8 dış kenar: iki hücrenin toplam 8 kenarından paylaşılan 2'si düşer.
    expect(computeContourSegments(mask, 3, 3)).toHaveLength(6);
  });

  it("ızgara kenarındaki bölge dış sınırdan da çevrelenir", () => {
    const mask = new Uint8Array(9).fill(1); // tam dolu 3×3
    // Çevre kenarları: üst 3 + alt 3 + sol 3 + sağ 3 = 12
    expect(computeContourSegments(mask, 3, 3)).toHaveLength(12);
  });

  it("boş maske kontur üretmez", () => {
    expect(computeContourSegments(new Uint8Array(9), 3, 3)).toHaveLength(0);
  });
});
