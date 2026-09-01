import { describe, it, expect } from "vitest";
import { computeBounds, filterUnderground, sliceDepths, sliceBandY, autoBoxFor } from "./csvFilter.js";

describe("csvFilter — yer altı analiz motoru", () => {
  const pts = [
    { x: -100, y: -300, z: -300, magnetic: 369887300 },  // üç eksen negatif ✓
    { x: -50, y: -150, z: -150, magnetic: 580346000 },   // üç eksen negatif ✓
    { x: 0, y: -300, z: -300, magnetic: 473015300 },     // x=0 → elenir
    { x: -300, y: 0, z: -300, magnetic: 117259800 },     // y=0 → elenir
    { x: -300, y: -300, z: 0, magnetic: 423456700 },     // z=0 → elenir
    { x: 0, y: 300, z: 0, magnetic: 270762500 },         // x,y,z ≥ 0 → elenir
  ];

  it("anomali hariç x<0, y<0 VE z<0 olmayan noktaları eler", () => {
    const res = filterUnderground(pts);
    expect(res.keptCount).toBe(2);
    expect(res.filteredCount).toBe(4);
    expect(res.points.every((p) => p.x < 0 && p.y < 0 && p.z < 0)).toBe(true);
  });

  it("manyetik değer işareti filtreyi etkilemez", () => {
    const mixed = [
      { x: -1, y: -10, z: -10, magnetic: -5000 },  // negatif anomali, yer altı ✓
      { x: -1, y: -10, z: -10, magnetic: 9000 },   // pozitif anomali, yer altı ✓
      { x: -1, y: 5, z: -10, magnetic: -9000 },    // y ≥ 0 → elenir
    ];
    const res = filterUnderground(mixed);
    expect(res.keptCount).toBe(2);
    expect(res.points.map((p) => p.magnetic).sort((a, b) => a - b)).toEqual([-5000, 9000].sort((a, b) => a - b));
  });

  it("boş liste güvenli sonuç döndürür", () => {
    const res = filterUnderground([]);
    expect(res.keptCount).toBe(0);
    expect(res.filteredCount).toBe(0);
  });

  it("computeBounds sınırları doğru hesaplar", () => {
    const b = computeBounds(pts);
    expect(b.xMin).toBe(-300);
    expect(b.xMax).toBe(0);
    expect(b.yMin).toBe(-300);
    expect(b.yMax).toBe(300);
    expect(b.zMin).toBe(-300);
    expect(b.zMax).toBe(0);
  });

  it("computeBounds boş listede sıfır döndürür", () => {
    const b = computeBounds([]);
    expect(b).toEqual({ xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 });
  });
});

describe("sliceDepths — derinlik dilimleme", () => {
  function makePoints() {
    const pts = [];
    for (let y = -300; y < 0; y += 10) {
      pts.push({ x: -1, y, z: -1, magnetic: 100 });
    }
    return pts; // y = -300..-10 → 30 nokta
  }

  it("yeraltı verisini 3 eşit dilime böler", () => {
    const all = makePoints();
    const s1 = sliceDepths(all, 1, 3);
    const s2 = sliceDepths(all, 2, 3);
    const s3 = sliceDepths(all, 3, 3);
    expect(s1.points.length + s2.points.length + s3.points.length).toBe(30);
    expect(s1.points.length).toBeGreaterThan(0);
    expect(s2.points.length).toBeGreaterThan(0);
    expect(s3.points.length).toBeGreaterThan(0);
    // Dilimler sıralı: 1 en yüzeye yakın (y büyük), 3 en derin (y küçük)
    expect(Math.max(...s1.points.map(p => p.y))).toBeGreaterThan(Math.max(...s3.points.map(p => p.y)));
  });

  it("en derin nokta son dilime dahil edilir (epsilon)", () => {
    const all = makePoints();
    const s3 = sliceDepths(all, 3, 3);
    expect(s3.points.some(p => p.y === -300)).toBe(true);
  });

  it("slice 0 tüm yeraltını döndürür", () => {
    const all = makePoints();
    const s0 = sliceDepths(all, 0, 8);
    expect(s0.points.length).toBe(30);
    expect(s0.yMin).toBe(-300);
    expect(s0.yMax).toBe(-10);
  });

  it("yeraltı kriterine uymayan noktalardan hiçbiri dilime girmez", () => {
    const mixed = [
      ...makePoints(),
      { x: 5, y: -50, z: -50 },   // x≥0 → elenir
      { x: -5, y: 50, z: -50 },   // y≥0 → elenir
    ];
    const s1 = sliceDepths(mixed, 1, 3);
    expect(s1.points.every(p => p.x < 0 && p.y < 0 && p.z < 0)).toBe(true);
  });
});

describe("sliceBandY — 3D dilim bandı", () => {
  it("dilim 1 yüzeyde başlar (top = +halfPool)", () => {
    const b = sliceBandY(1, 8, 30);
    expect(b.top).toBe(15);
    expect(b.bottom).toBeCloseTo(15 - 30 / 8);
    expect(b.center).toBeCloseTo(15 - 30 / 16);
    expect(b.thickness).toBeCloseTo(30 / 8);
  });

  it("son dilim tabanda biter (bottom = -halfPool)", () => {
    const b = sliceBandY(8, 8, 30);
    expect(b.bottom).toBe(-15);
    expect(b.top).toBeCloseTo(-15 + 30 / 8);
  });

  it("slice 0 veya geçersizde null döner", () => {
    expect(sliceBandY(0, 8, 30)).toBeNull();
    expect(sliceBandY(9, 8, 30)).toBeNull();
    expect(sliceBandY(-3, 4, 30)).toBeNull();
  });

  it("havuz boyutu değişince orantılı ölçeklenir", () => {
    const b = sliceBandY(3, 4, 40);
    expect(b.top).toBe(20 - 10 * 2);  // 0
    expect(b.bottom).toBe(20 - 10 * 3); // -10
    expect(b.center).toBe(-5);
  });

  it("usable (fit payı) verilince bant daralır — yüzeyden aşağı iner", () => {
    const b = sliceBandY(1, 8, 30, 25.5); // fit %85 → 30×0.85
    expect(b.top).toBe(15);
    expect(b.bottom).toBeCloseTo(15 - 25.5 / 8);
    expect(b.thickness).toBeCloseTo(25.5 / 8);
  });

  it("son dilim fit alanının dibinde biter", () => {
    const b = sliceBandY(8, 8, 30, 25.5);
    expect(b.bottom).toBeCloseTo(15 - 25.5); // -10.5 → fit alanının tabanı
  });
});

describe("autoBoxFor — otomatik dikdörtgen hacim", () => {
  const pts = [
    { x: -300, y: -300, z: -20, magnetic: 100 },
    { x: -100, y: -100, z: -200, magnetic: 200 },
    { x: -50, y: -30, z: -60, magnetic: 150 },
  ];

  it("her ekseni ayrı hesaplar ve sığdırma payına böler", () => {
    // X span 250, Y span 270, Z span 180; fit 0.8 → boyut = span/0.8
    const b = autoBoxFor(pts, 0.8, 1, 10000);
    expect(b.w).toBeCloseTo(250 / 0.8, 5);
    expect(b.h).toBeCloseTo(270 / 0.8, 5);
    expect(b.d).toBeCloseTo(180 / 0.8, 5);
  });

  it("yer altı kriterine uymayan noktaları yok sayar", () => {
    const mixed = [...pts, { x: 5, y: -300, z: -300 }, { x: -300, y: 5, z: -300 }];
    const b = autoBoxFor(mixed, 1, 1, 10000);
    // fit 1 → boyut = span; yüzey noktaları dahil edilmez
    expect(b.h).toBeCloseTo(270, 5);
    expect(b.d).toBeCloseTo(180, 5);
  });

  it("min/max sınırlarına kenetlenir", () => {
    const big = [{ x: -1e9, y: -1e9, z: -1e9 }, { x: -100, y: -100, z: -100 }];
    const b = autoBoxFor(big, 0.85, 10, 100);
    expect(b.w).toBe(100);
    expect(b.d).toBe(100);

    const tiny = [{ x: -2, y: -2, z: -2 }, { x: -1, y: -1, z: -1 }];
    const t = autoBoxFor(tiny, 0.85, 10, 100);
    expect(t.w).toBe(10);
    expect(t.h).toBe(10);
  });

  it("boş veri null döndürür", () => {
    expect(autoBoxFor([], 0.85)).toBeNull();
  });
});