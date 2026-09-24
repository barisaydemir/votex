import { describe, it, expect } from "vitest";
import {
  buildCoverageTrailSvg,
  buildLegacyFieldReportHtml,
  buildScanChecklist,
  legacyFieldReportFileName,
} from "./legacyFieldReport.js";

const coverage = {
  rows: 2,
  cols: 2,
  totalCells: 4,
  visitedCount: 3,
  unvisitedCount: 1,
  coverage: 0.75,
  cellCounts: [2, 0, 1, 3],
  unvisited: [{ row: 0, col: 1, index: 1 }],
  outOfFieldCount: 0,
  boundsFromField: true,
  fieldPx: { xMin: 0, xMax: 2e7, yMin: 0, yMax: 2e7 },
};

const scan = {
  matrixRows: 2,
  matrixCols: 2,
  fieldWidthM: 2,
  fieldLengthM: 2,
  pointCount: 18,
  messageCount: 20,
  droppedCount: 1,
};

describe("buildLegacyFieldReportHtml", () => {
  it("kapsama yüzdesini ve atlanan kareyi içerir", () => {
    const html = buildLegacyFieldReportHtml({ scan, coverage, targets: [] });
    expect(html).toContain("%75");
    expect(html).toContain("Atlanan kareler (1)");
    expect(html).toContain("Satır 1 · Sütun 2");
  });

  it("tam dolu matriste atlanan kare olmadığını yazar", () => {
    const html = buildLegacyFieldReportHtml({
      scan,
      coverage: { ...coverage, unvisited: [], unvisitedCount: 0, coverage: 1 },
      targets: [],
    });
    expect(html).toContain("Atlanan kare yok");
    expect(html).toContain("%100");
  });

  it("hedef listesini durum, derinlik ve güvenle yazar", () => {
    const html = buildLegacyFieldReportHtml({
      scan,
      coverage,
      targets: [
        {
          targetId: "legacy-target-1",
          detectionIds: ["a", "b"],
          depthTopM: 1.4,
          depthBottomM: 2,
          confidence: 0.87,
          status: "confirmed",
        },
      ],
    });
    expect(html).toContain("legacy-target-1");
    expect(html).toContain("1.40–2.00 m");
    expect(html).toContain("%87");
    expect(html).toContain("Doğrulandı");
  });

  it("alan tanımı yoksa dürüst uyarıyı düşer", () => {
    const html = buildLegacyFieldReportHtml({
      scan,
      coverage: { ...coverage, boundsFromField: false },
      targets: [],
    });
    expect(html).toContain("Alan tanımı yok");
  });

  it("kapsama yoksa matris uyarısını yazar, uydurma veri üretmez", () => {
    const html = buildLegacyFieldReportHtml({ scan: {}, coverage: null, targets: [] });
    expect(html).toContain("Kapsama hesaplanamadı");
    expect(html).toContain("Bu taramada birleşik hedef yok.");
  });

  it("3D sahne görüntüsünü ek olarak yerleştirir", () => {
    const html = buildLegacyFieldReportHtml({
      scan,
      coverage,
      targets: [],
      sceneImage: "data:image/png;base64,AAAA",
      sceneCaption: "Seçilen hedefler: legacy-target-1",
    });
    expect(html).toContain("3D sahne görüntüsü");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("Seçilen hedefler: legacy-target-1");
  });

  it("sahne görüntüsü yoksa dürüst not düşer", () => {
    const html = buildLegacyFieldReportHtml({ scan, coverage, targets: [] });
    expect(html).toContain("görüntü yakalama başarısız");
  });

  it("saha kontrol listesini ve yürüyüş izi diyagramını rapora yerleştirir", () => {
    const html = buildLegacyFieldReportHtml({
      scan,
      coverage,
      targets: [],
      trail: [
        { x: 1e6, y: 1e6 },
        { x: 1.5e7, y: 1.5e7 },
      ],
    });
    expect(html).toContain("Saha kontrol listesi");
    expect(html).toContain("KONTROL GEREKLİ"); // bozuk satır + atlanan kare uyarısı
    expect(html).toContain("<polyline");
    expect(html).toContain("Atlanan kareler (1)");
  });

  it("dosya adını güvenli kaçırır", () => {
    const html = buildLegacyFieldReportHtml({
      source: { fileName: "<img src=x>" },
      scan,
      coverage,
      targets: [],
    });
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
  });
});

describe("buildScanChecklist", () => {
  const P = (xM, yM) => ({ x: xM * 1e7, y: yM * 1e7 });

  it("tam taramada tüm maddeler geçer ve TARAMA TAM der", () => {
    const r = buildScanChecklist({
      coverage: {
        ...coverage,
        unvisited: [],
        unvisitedCount: 0,
        coverage: 1,
        cellCounts: [1, 1, 1, 1],
      },
      scan: { ...scan, droppedCount: 0 },
      targets: [
        {
          targetId: "legacy-target-1",
          detectionIds: ["a", "b"],
          status: "confirmed",
          confidence: 0.9,
        },
      ],
      trail: [P(0.5, 0.5), P(1.5, 0.5), P(1.5, 1.5)],
    });
    expect(r.verdict).toBe("tam");
    expect(r.verdictLabel).toBe("TARAMA TAM");
    expect(r.items.every((i) => i.status === "ok")).toBe(true);
  });

  it("atlanan kare ve bozuk satır uyarısı üretir", () => {
    const r = buildScanChecklist({ coverage, scan, targets: [], trail: [P(0.5, 0.5)] });
    expect(r.verdict).toBe("dikkat");
    expect(r.items.some((i) => i.status === "warn" && i.text.includes("kare atlandı"))).toBe(true);
    expect(r.items.some((i) => i.text.includes("bozuk satır"))).toBe(true);
    expect(r.items.some((i) => i.text.includes("Yürüyüş izi tek örnek"))).toBe(true);
  });

  it("yarıdan az kapsama 'eksik' verir", () => {
    const r = buildScanChecklist({
      coverage: {
        ...coverage,
        coverage: 0.25,
        visitedCount: 1,
        unvisitedCount: 3,
        unvisited: [
          { row: 0, col: 1, index: 1 },
          { row: 1, col: 0, index: 2 },
          { row: 1, col: 1, index: 3 },
        ],
      },
      scan,
      targets: [],
      trail: [],
    });
    expect(r.verdict).toBe("eksik");
    expect(r.verdictLabel).toBe("TARAMA EKSİK");
  });

  it("matris yoksa kapsam denetlenemedi der", () => {
    const r = buildScanChecklist({ coverage: null, scan, targets: [], trail: [] });
    expect(r.items.some((i) => i.text.includes("Kapsama denetlenemedi"))).toBe(true);
  });

  it("karar bekleyen ve tek kanıtlı hedefleri raporlar", () => {
    const r = buildScanChecklist({
      coverage: { ...coverage, unvisited: [], unvisitedCount: 0, coverage: 1 },
      scan: { ...scan, droppedCount: 0 },
      targets: [
        { targetId: "t1", detectionIds: ["a"], status: "unverified", confidence: 0.5 },
        { targetId: "t2", detectionIds: ["b", "c"], status: "confirmed", confidence: 0.9 },
      ],
      trail: [P(0.5, 0.5), P(1.5, 1.5)],
    });
    expect(r.items.some((i) => i.text.includes("karar bekliyor"))).toBe(true);
    expect(r.items.some((i) => i.text.includes("tek kanıtta"))).toBe(true);
    expect(r.verdict).toBe("dikkat");
  });
});

describe("buildCoverageTrailSvg", () => {
  const P = (xM, yM) => ({ x: xM * 1e7, y: yM * 1e7 });

  it("ızgarayı, atlanan × işaretlerini ve yürüyüş izini çizer", () => {
    const svg = buildCoverageTrailSvg(coverage, [P(0.5, 0.5), P(1.5, 1.5)]);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<polyline");
    expect(svg.match(/class="cell"/g) || []).toHaveLength(4); // 2×2 hücre
    expect(svg.match(/class="miss"/g) || []).toHaveLength(1); // 1 atlanan kare
  });

  it("kapsama yoksa boş döner", () => {
    expect(buildCoverageTrailSvg(null, [])).toBe("");
  });
});

describe("legacyFieldReportFileName", () => {
  it("tarih damgalı HTML adı üretir", () => {
    expect(legacyFieldReportFileName(new Date(2026, 8, 21, 9, 5))).toBe(
      "votex-saha-raporu-20260921-0905.html"
    );
  });
});

describe("hassasiyet altbilgisi", () => {
  it("hassasiyet verilince eşikleri altbilgiye yazar", () => {
    const html = buildLegacyFieldReportHtml({ sensitivityPercent: 55 });
    expect(html).toContain("Hassasiyet: %55 (Dengeli)");
    expect(html).toContain("min güven 0.44");
    expect(html).toContain("min alan 121 px");
  });

  it("hassasiyet verilmeyince satır yoktur", () => {
    const html = buildLegacyFieldReportHtml({});
    expect(html).not.toContain("Hassasiyet:");
  });
});
