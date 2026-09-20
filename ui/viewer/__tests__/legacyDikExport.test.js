import { describe, expect, it } from "vitest";
import {
  buildLegacyDetectionsCsv,
  buildLegacyDetectionsGeoJson,
  buildLegacyFieldSummaryHtml,
  detectionsToRows,
} from "../legacyDikExport.js";

const sample = [
  {
    detectionId: "legacy-dik-shape-1",
    stepIndex: 2,
    stationM: 1.5,
    depthTopM: 1.2,
    depthBottomM: 2.4,
    strength: 3.1,
    confidence: 0.8,
    type: "Metal adayı",
    dimensions: { width: 0.6, length: 0.5, height: 1.2 },
    status: "strong",
    raw: { cx: 1.1, cy: 2.2, peakSigma: 3.1, widthM: 0.6, lengthM: 0.5 },
  },
  {
    detectionId: "legacy-dik-shape-2",
    stepIndex: 5,
    stationM: 3.0,
    depthTopM: 2.0,
    depthBottomM: 3.5,
    strength: 1.4,
    confidence: 0.55,
    type: "Anomali",
    dimensions: { width: 1.0, length: 0.8, height: 1.5 },
    status: "attention",
    raw: { cx: 2.0, cy: 1.0 },
  },
];

describe("legacyDikExport", () => {
  it("CSV satır sayısı header + tespitler", () => {
    const csv = buildLegacyDetectionsCsv(sample, {
      sensorHeightM: 0.5,
      bipolarSepFactor: 1.85,
      dipoleBlend: 0.3,
    });
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("detectionId");
    expect(lines[1]).toContain("legacy-dik-shape-1");
  });

  it("GeoJSON Feature count", () => {
    const geo = buildLegacyDetectionsGeoJson(sample, { sensorHeightM: 0.5 });
    expect(geo.type).toBe("FeatureCollection");
    expect(geo.features).toHaveLength(2);
    expect(geo.features[0].geometry.coordinates).toEqual([1.1, 2.2]);
    expect(geo.properties.sensorHeightM).toBe(0.5);
  });

  it("detectionsToRows alanları", () => {
    const rows = detectionsToRows(sample);
    expect(rows[0].peakSigma).toBe(3.1);
    expect(rows[1].cx).toBe(2.0);
  });

  it("seçili hedefleri saha özetine ekler", () => {
    const html = buildLegacyFieldSummaryHtml({
      selectedTargetsHtml: "<div>Adım 2 · Metal adayı</div>",
    });
    expect(html).toContain("RAPORA EKLENEN HEDEFLER");
    expect(html).toContain("Adım 2 · Metal adayı");
  });

  it("saha özeti HTML yazdırılabilir içerik üretir", () => {
    const html = buildLegacyFieldSummaryHtml({
      fileName: "demo.json",
      briefText: "Metal · 2.0 m",
      residualNote: "residual σ",
      params: { sensorHeightM: 0.5, bipolarSepFactor: 1.85, dipoleBlend: 0.3 },
      fingerprint: "abc",
    });
    expect(html).toContain("VOTEX · Saha özeti");
    expect(html).toContain("demo.json");
    expect(html).toContain("window.print()");
    expect(html).toContain("0.5");
  });
});
