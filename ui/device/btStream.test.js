import { describe, it, expect } from "vitest";
import {
  HEAT_PX_PER_M,
  LEGACY_STANDARD_COLUMNS,
  buildLegacyJsonFromMessages,
  computeScanCoverage,
  createBtJsonAssembler,
  createLiveHeatAccumulator,
  extractCompleteJsonValues,
  heatPointsToTrail,
  isPointMessage,
  legacyRowToHeatPoint,
  legacyRowsToHeatPoints,
  resolveLegacyFieldColumns,
} from "./btStream.js";

describe("computeScanCoverage", () => {
  const P = (xM, yM) => ({ x: xM * HEAT_PX_PER_M, y: yM * HEAT_PX_PER_M });

  it("matris tanımsızsa veya nokta yoksa null döner", () => {
    expect(computeScanCoverage([], { rows: 2, cols: 2, xMeters: 2, yMeters: 2 })).toBeNull();
    expect(computeScanCoverage([P(0.5, 0.5)], { rows: 0, cols: 2 })).toBeNull();
  });

  it("atlanan kenar kareleri listeler", () => {
    // 2×2 matris, 2×2 m alan; yalnızca sol-alt kare ölçülmüş.
    const cov = computeScanCoverage([P(0.4, 0.4), P(0.6, 0.6)], {
      rows: 2,
      cols: 2,
      xMeters: 2,
      yMeters: 2,
    });
    expect(cov.totalCells).toBe(4);
    expect(cov.visitedCount).toBe(1);
    expect(cov.unvisitedCount).toBe(3);
    expect(cov.boundsFromField).toBe(true);
    expect(cov.unvisited.map((c) => `${c.row},${c.col}`).sort()).toEqual(["0,1", "1,0", "1,1"]);
  });

  it("tam dolu matriste uyarı kalmaz", () => {
    const cov = computeScanCoverage([P(0.5, 0.5), P(1.5, 0.5), P(0.5, 1.5), P(1.5, 1.5)], {
      rows: 2,
      cols: 2,
      xMeters: 2,
      yMeters: 2,
    });
    expect(cov.visitedCount).toBe(4);
    expect(cov.unvisitedCount).toBe(0);
    expect(cov.coverage).toBe(1);
  });

  it("alan tanımı yoksa veri sınırlarına düşer ve dürüstçe bildirir", () => {
    const cov = computeScanCoverage([P(0, 0), P(1, 1)], { rows: 1, cols: 2 });
    expect(cov.boundsFromField).toBe(false);
    expect(cov.visitedCount).toBe(2);
    expect(cov.outOfFieldCount).toBe(0);
  });

  it("alan dışındaki noktaları raporlar, heatmap bounds'u genişletir", () => {
    const cov = computeScanCoverage([P(3, 3), P(0.5, 0.5)], {
      rows: 2,
      cols: 2,
      xMeters: 2,
      yMeters: 2,
    });
    expect(cov.outOfFieldCount).toBe(1);
    expect(cov.fieldPx.xMax).toBe(3 * HEAT_PX_PER_M);
  });

  it("heatmap bounds tüm alanı kapsar — atlanan kenar kare görünür kalır", () => {
    const cov = computeScanCoverage([P(1, 1)], { rows: 2, cols: 2, xMeters: 2, yMeters: 2 });
    expect(cov.fieldPx.xMin).toBe(0);
    expect(cov.fieldPx.xMax).toBe(2 * HEAT_PX_PER_M);
    expect(cov.fieldPx.yMin).toBe(0);
    expect(cov.fieldPx.yMax).toBe(2 * HEAT_PX_PER_M);
  });
});

describe("heatPointsToTrail", () => {
  const P = (xM, yM) => ({ x: xM * HEAT_PX_PER_M, y: yM * HEAT_PX_PER_M });

  it("aynı noktaya tekrar basılan ardışık örnekleri atar", () => {
    const trail = heatPointsToTrail([P(1, 1), P(1, 1), P(2, 2), P(2, 2), P(3, 3)]);
    expect(trail).toEqual([P(1, 1), P(2, 2), P(3, 3)]);
  });

  it("minStepPx yakın örnekleri son tutulan noktaya göre sıkıştırır", () => {
    const trail = heatPointsToTrail([P(0, 0), P(0.001, 0), P(1, 0)], HEAT_PX_PER_M * 0.01);
    expect(trail).toEqual([P(0, 0), P(1, 0)]);
  });

  it("geçersiz noktaları atar", () => {
    expect(heatPointsToTrail([null, { x: NaN, y: 1 }, P(1, 1)])).toEqual([P(1, 1)]);
  });
});

describe("extractCompleteJsonValues", () => {
  it("tamamlanmış tek JSON değerini çıkarır", () => {
    const r = extractCompleteJsonValues('{"x":1}\n');
    expect(r.values).toEqual([{ x: 1 }]);
    expect(r.rest).toBe("");
    expect(r.dropped).toBe(0);
  });

  it("yarım kalan değeri tamponda bekletir", () => {
    const r = extractCompleteJsonValues('{"x":');
    expect(r.values).toEqual([]);
    expect(r.rest).toBe('{"x":');
    expect(r.dropped).toBe(0);
  });

  it("JSON dışı artıkları atar, sonraki değerleri yine bulur", () => {
    const r = extractCompleteJsonValues("OK\r\n[1,2,3]\nlog satiri\n{\"a\":9}");
    expect(r.values).toEqual([[1, 2, 3], { a: 9 }]);
    expect(r.rest).toBe("");
    expect(r.dropped).toBeGreaterThanOrEqual(2);
  });

  it("dizgi içindeki süslü parantezleri ayrıştırmayı bozmaz", () => {
    const r = extractCompleteJsonValues('{"s":"a}b {c","t":2}');
    expect(r.values).toEqual([{ s: "a}b {c", t: 2 }]);
    expect(r.rest).toBe("");
  });

  it("çok satırlı pretty-print belgeyi tek değer olarak çıkarır", () => {
    const doc = { metadata: { device_code: "X" }, scan: { columns: ["a"], data: [[1]] } };
    const r = extractCompleteJsonValues(JSON.stringify(doc, null, 2) + "\n");
    expect(r.values).toEqual([doc]);
    expect(r.dropped).toBe(0);
  });
});

describe("createBtJsonAssembler", () => {
  it("base64 parçalarını birleştirip JSON mesajlarına böler", () => {
    const full =
      JSON.stringify({ time: 1, x: 2, y: 3, z: 4 }) +
      "\n" +
      JSON.stringify({ time: 5, x: 6, y: 7, z: 8 }) +
      "\n";
    const cut = Math.floor(full.length / 2);
    const a = createBtJsonAssembler();
    a.pushBase64(btoa(full.slice(0, cut)));
    a.pushBase64(btoa(full.slice(cut)));
    expect(a.stats().messageCount).toBe(2);
    expect(a.stats().pointCount).toBe(2);
    expect(a.stats().byteCount).toBe(full.length);
    expect(a.values()).toEqual([
      { time: 1, x: 2, y: 3, z: 4 },
      { time: 5, x: 6, y: 7, z: 8 },
    ]);
  });

  it("flush tamamlanmamış JSON'u reddeder", () => {
    const a = createBtJsonAssembler();
    a.pushText('{"yarim":');
    a.flush();
    expect(a.stats().messageCount).toBe(0);
    expect(a.stats().droppedCount).toBe(1);
    expect(a.stats().bufferedChars).toBe(0);
  });

  it("reset akışı sıfırlar", () => {
    const a = createBtJsonAssembler();
    a.pushText('{"a":1}');
    a.reset();
    expect(a.stats().messageCount).toBe(0);
    expect(a.values()).toEqual([]);
  });
});

describe("isPointMessage", () => {
  it("sayı dizilerini ve düz kayıtları satır sayar", () => {
    expect(isPointMessage([0, 1, 2, 369])).toBe(true);
    expect(isPointMessage({ time: 0, x: 1 })).toBe(true);
  });

  it("belge ve sütun başlığı mesajlarını satır saymaz", () => {
    expect(isPointMessage({ metadata: {}, scan: {} })).toBe(false);
    expect(isPointMessage(["time", "x"])).toBe(false);
  });
});

describe("buildLegacyJsonFromMessages", () => {
  it("nesne kayıtlarını sütun türeterek Legacy belgesine derler", () => {
    const r = buildLegacyJsonFromMessages(
      [
        { time: 0, x: 1, y: 2, z: 369 },
        { time: 1, x: 3, y: 4, z: 371 },
      ],
      { xMeters: 6, yMeters: 8 }
    );
    expect(r.ok).toBe(true);
    expect(r.pointCount).toBe(2);
    const out = JSON.parse(r.content);
    expect(out.scan.columns).toEqual(["time", "x", "y", "z"]);
    expect(out.scan.data).toEqual([
      [0, 1, 2, 369],
      [1, 3, 4, 371],
    ]);
    expect(out.metadata.x_meters).toBe(6);
    expect(out.metadata.y_meters).toBe(8);
  });

  it("tek tam belgeyi koruyarak geçirir (segment_ranges dahil)", () => {
    const doc = {
      metadata: { device_code: "Legacy3DMag", x_meters: 4, y_meters: 5 },
      scan: {
        columns: ["time", "x", "y", "z", "x_coords", "y_coords"],
        data: [
          [0, 0, 0, 369, 0, 0],
          [1, 0, 1, 371, 0, 1],
        ],
      },
      segment_ranges: [{ start: 0, end: 1 }],
    };
    const r = buildLegacyJsonFromMessages([doc]);
    expect(r.ok).toBe(true);
    const out = JSON.parse(r.content);
    expect(out.segment_ranges).toEqual(doc.segment_ranges);
    expect(out.scan.data.length).toBe(2);
    expect(out.metadata.x_meters).toBe(4);
    expect(r.pointCount).toBe(2);
  });

  it("6 sütunlu dizilere standart Legacy sütun adlarını verir", () => {
    const r = buildLegacyJsonFromMessages([
      [0, 0, 0, 369, 0, 0],
      [1, 0, 1, 371, 0, 1],
    ]);
    expect(r.ok).toBe(true);
    const out = JSON.parse(r.content);
    expect(out.scan.columns).toEqual(LEGACY_STANDARD_COLUMNS);
    expect(out.scan.data.length).toBe(2);
  });

  it("sütun başlığı mesajını sonraki dizilere uygular", () => {
    const r = buildLegacyJsonFromMessages([["time", "x", "y", "z"], [0, 1, 2, 369]]);
    expect(r.ok).toBe(true);
    const out = JSON.parse(r.content);
    expect(out.scan.columns).toEqual(["time", "x", "y", "z"]);
    expect(out.scan.data).toEqual([[0, 1, 2, 369]]);
  });

  it("veri yoksa dürüstçe hata döner (uydurma satır üretmez)", () => {
    expect(buildLegacyJsonFromMessages([]).ok).toBe(false);
    const metaOnly = buildLegacyJsonFromMessages([{ metadata: { device_code: "X" } }]);
    expect(metaOnly.ok).toBe(false);
    expect(metaOnly.pointCount).toBe(0);
  });

  it("ek satır gelen akışta segment_ranges bilinçli olarak düşer", () => {
    const doc = {
      metadata: { device_code: "Legacy3DMag" },
      scan: { columns: ["a"], data: [[1]] },
      segment_ranges: [{ start: 0, end: 0 }],
    };
    const r = buildLegacyJsonFromMessages([doc, { a: 2 }]);
    expect(r.ok).toBe(true);
    const out = JSON.parse(r.content);
    expect(out.segment_ranges).toBeUndefined();
    expect(out.scan.data.length).toBe(2);
  });
});

describe("resolveLegacyFieldColumns", () => {
  it("standart Legacy sütunlarını çözer (x/y/z manyetik, *_coords konum)", () => {
    expect(resolveLegacyFieldColumns(LEGACY_STANDARD_COLUMNS)).toEqual({
      bx: 1,
      by: 2,
      bz: 3,
      xm: 4,
      ym: 5,
    });
  });

  it("Bx/By/Bz + konum takma adlarını tanır (Rust parse_outer_and_table ile aynı)", () => {
    expect(resolveLegacyFieldColumns(["time", "bx", "by", "bz", "x_coords", "y_coords"])).toEqual({
      bx: 1,
      by: 2,
      bz: 3,
      xm: 4,
      ym: 5,
    });
    expect(resolveLegacyFieldColumns(["mag_x", "mag_y", "mag_z", "pos_x", "pos_y"])).toEqual({
      bx: 0,
      by: 1,
      bz: 2,
      xm: 3,
      ym: 4,
    });
  });

  it("B bileşenleri varsa konum x/y'ye düşer (bx/by/bz + x/y metre)", () => {
    expect(resolveLegacyFieldColumns(["bx", "by", "bz", "x", "y"])).toEqual({
      bx: 0,
      by: 1,
      bz: 2,
      xm: 3,
      ym: 4,
    });
  });

  it("konum veya manyetik sütun eksikse sessiz tahmin üretmez (null)", () => {
    expect(resolveLegacyFieldColumns(["x", "y", "z"])).toBeNull(); // konum yok
    expect(resolveLegacyFieldColumns(["x_coords", "y_coords"])).toBeNull(); // manyetik yok
    expect(resolveLegacyFieldColumns(["col_0", "col_1"])).toBeNull(); // bilinmeyen adlar
  });
});

describe("legacyRowToHeatPoint / legacyRowsToHeatPoints", () => {
  it("satırı metre→piksel ölçeğinde noktaya çevirir, ısı = |B| (analizle aynı)", () => {
    const cols = resolveLegacyFieldColumns(LEGACY_STANDARD_COLUMNS);
    const p = legacyRowToHeatPoint([0, 3, 4, 0, 1.5, 2.5], cols);
    expect(p.x).toBeCloseTo(1.5 * HEAT_PX_PER_M);
    expect(p.y).toBeCloseTo(2.5 * HEAT_PX_PER_M);
    expect(p.z).toBeCloseTo(2.5 * HEAT_PX_PER_M);
    expect(p.magnetic).toBeCloseTo(Math.hypot(3, 4, 0));
  });

  it("sayısal olmayan hücreli satırları atlar (uydurma nokta üretmez)", () => {
    const cols = resolveLegacyFieldColumns(LEGACY_STANDARD_COLUMNS);
    expect(legacyRowToHeatPoint([0, "bozuk", 4, 0, 1, 2], cols)).toBeNull();
    expect(legacyRowToHeatPoint([0, 1, 2, 3], cols)).toBeNull(); // kısa satır → NaN
    expect(legacyRowsToHeatPoints(LEGACY_STANDARD_COLUMNS, [[0, 1, 2, 3, 4, 5]])).toHaveLength(1);
  });
});

describe("createLiveHeatAccumulator", () => {
  it("mesajlar geldikçe nokta üretir, değişmeyen akışta önbelleği kullanır", () => {
    const acc = createLiveHeatAccumulator();
    expect(acc.update([])).toEqual([]);
    const a = acc.update([[0, 3, 4, 0, 1, 2]]);
    expect(a).toHaveLength(1);
    expect(a[0].magnetic).toBeCloseTo(5);
    expect(acc.update([[0, 3, 4, 0, 1, 2]])).toBe(a); // aynı referans → önbellek
    const b = acc.update([[0, 3, 4, 0, 1, 2], [1, 0, 0, 3, 2, 3]]);
    expect(b).toHaveLength(2);
  });

  it("geç gelen sütun başlığı geriye dönük uygulanır", () => {
    const acc = createLiveHeatAccumulator();
    // 5 sütunlu dizi — başlıksız: col_* → çözümlenemez, nokta üretilmez
    expect(acc.update([[1, 2, 3, 4, 5]])).toEqual([]);
    // Başlık mesajı gelince aynı satır geriye dönük eşlenir
    const pts = acc.update([[1, 2, 3, 4, 5], ["x", "y", "z", "x_coords", "y_coords"]]);
    expect(pts).toHaveLength(1);
    expect(pts[0].magnetic).toBeCloseTo(Math.hypot(1, 2, 3));
    expect(pts[0].x).toBeCloseTo(4 * HEAT_PX_PER_M);
  });

  it("reset birikimi sıfırlar", () => {
    const acc = createLiveHeatAccumulator();
    acc.update([[0, 3, 4, 0, 1, 2]]);
    acc.reset();
    expect(acc.update([])).toEqual([]);
  });
});
