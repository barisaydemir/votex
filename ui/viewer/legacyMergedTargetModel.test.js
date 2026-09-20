import { describe, expect, it } from "vitest";
import { buildLegacyMergePresentation, buildLegacyTargetConfidenceChart, buildLegacyTargetTimeline, mergeLegacyDetections } from "./legacyMergedTargetModel.js";

const detection = (id, x, y, top, bottom, stepIndex, kind = "Metal anomali adayı", size = null) => ({
  detectionId: id,
  stepIndex,
  stationM: x,
  offsetM: y,
  depthTopM: top,
  depthBottomM: bottom,
  confidence: 0.7,
  type: kind,
  geometry: "ellipse",
  raw: {
    cx: x,
    cy: y,
    kind: kind.includes("Metal") ? "metal" : "anomaly",
    ...(size ? { rx: size / 2, ry: size / 2 } : {}),
  },
});

describe("legacyMergedTargetModel", () => {
  it("aynı fiziksel hedefin farklı adım kanıtlarını birleştirir", () => {
    const targets = mergeLegacyDetections([
      detection("a", 2, 1, 0.9, 1.3, 3),
      detection("b", 2.2, 1.05, 1.0, 1.4, 4),
      detection("c", 2.1, 0.95, 0.95, 1.35, 5),
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0].detectionIds).toEqual(expect.arrayContaining(["a", "b", "c"]));
    expect(targets[0].stepIndices).toEqual([3, 4, 5]);
    expect(targets[0].consistency.evidenceCount).toBe(3);
    expect(targets[0].confidence).toBeGreaterThan(0.7);
    expect(targets[0].footprints).toHaveLength(3);
    expect(targets[0].maxConnectorGapM).toBeGreaterThanOrEqual(0);
  });

  it("birleşik hedef zaman çizelgesini adım sırasına göre üretir", () => {
    const targets = mergeLegacyDetections([
      { ...detection("late", 2.2, 1, 1.1, 1.6, 8), analysisEvidence: { metrics: { anomalyConfidence: { value: 88 }, signalStrength: { value: 70 } } } },
      { ...detection("early", 2, 1, 0.9, 1.3, 4), analysisEvidence: { metrics: { anomalyConfidence: { value: 64 }, signalStrength: { value: 52 } } } },
    ]);
    const timeline = buildLegacyTargetTimeline(targets[0]);
    expect(timeline.map((item) => item.stepIndex)).toEqual([4, 8]);
    expect(timeline.map((item) => item.confidencePct)).toEqual([64, 88]);
    expect(timeline[0]).toMatchObject({ depthTopM: 0.9, depthBottomM: 1.3, signalPct: 52 });
    expect(targets[0].timeline).toEqual(timeline);
  });

  it("güven trend grafiğini ilk ve son adım değişimiyle üretir", () => {
    const chart = buildLegacyTargetConfidenceChart([
      { stepIndex: 2, confidencePct: 40 },
      { stepIndex: 5, confidencePct: 75 },
      { stepIndex: 8, confidencePct: 60 },
    ]);
    expect(chart.points).toHaveLength(3);
    expect(chart.polyline).toContain("12,");
    expect(chart.firstPct).toBe(40);
    expect(chart.lastPct).toBe(60);
    expect(chart.deltaPct).toBe(20);
    expect(chart.minPct).toBe(40);
    expect(chart.maxPct).toBe(75);
    expect(chart.points[0].stepIndex).toBe(2);
    expect(chart.points[2].stepIndex).toBe(8);
  });

  it("boş güven trendi grafiği üretmez", () => {
    const chart = buildLegacyTargetConfidenceChart([]);
    expect(chart.points).toEqual([]);
    expect(chart.deltaPct).toBeNull();
    expect(chart.polyline).toBe("");
  });

  it("uzak veya derinliği çelişen bulguları ayrı tutar", () => {
    const targets = mergeLegacyDetections([
      detection("near", 1, 1, 0.9, 1.3, 1),
      detection("far", 4, 1, 0.9, 1.3, 2),
      detection("deep", 1.1, 1.05, 4.0, 4.5, 3),
    ]);
    expect(targets).toHaveLength(3);
  });

  it("yatayda temas eden ayak izlerini merkezleri uzak olsa da birleştirir", () => {
    const targets = mergeLegacyDetections([
      detection("left", 1, 1, 1, 1.4, 1, "Metal anomali adayı", 1),
      detection("right", 2, 1, 1.05, 1.45, 2, "Metal anomali adayı", 1),
    ], { positionToleranceM: 0.25 });
    expect(targets).toHaveLength(1);
    expect(targets[0].detectionIds).toEqual(expect.arrayContaining(["left", "right"]));
  });

  it("yatayda arada belirgin boşluk varsa ayrı bırakır", () => {
    const targets = mergeLegacyDetections([
      detection("left", 1, 1, 1, 1.4, 1, "Metal anomali adayı", 0.5),
      detection("right", 2, 1, 1.05, 1.45, 2, "Metal anomali adayı", 0.5),
    ], { positionToleranceM: 0.25, horizontalGapToleranceM: 0.1 });
    expect(targets).toHaveLength(2);
  });

  it("kullanıcının ayırdığı kanıtları ayrı hedefler olarak korur", () => {
    const targets = mergeLegacyDetections([
      detection("a", 1, 1, 1, 1.4, 1),
      detection("b", 1.1, 1, 1, 1.4, 2),
    ], { splitDetectionIds: ["b"] });
    expect(targets).toHaveLength(2);
    expect(targets.every((target) => target.detectionIds.length === 1)).toBe(true);
  });

  it("canonical sunum aynı bağlantı ve politika çıktısını taşır", () => {
    const presentation = buildLegacyMergePresentation([
      detection("a", 1, 1, 1, 1.4, 1, "Metal anomali adayı", 1),
      detection("b", 1.7, 1, 1, 1.4, 2, "Metal anomali adayı", 1),
    ]);
    expect(presentation.policy.horizontalGapToleranceM).toBe(0.35);
    expect(presentation.targets[0].connectors).toHaveLength(1);
    expect(presentation.targets[0].connectors[0].from).toEqual({ x: 1, y: 1 });
    expect(presentation.targets[0].connectors[0].to).toEqual({ x: 1.7, y: 1 });
    expect(presentation.targets[0].connectors[0].widthM).toBeGreaterThan(0);
    expect(presentation.targets[0].mergeReasons.length).toBeGreaterThan(0);
    expect(presentation.detectionToTarget.a).toBe(presentation.targets[0].targetId);
  });

  it("tek metal kanıtında ölçüm boyutunu ve tek kaliteyi korur", () => {
    const [target] = mergeLegacyDetections([
      detection("metal", 1, 1, 1, 1.4, 1, "Metal anomali adayı", 0.4),
    ]);
    expect(target.evidenceQuality).toBe("single");
    expect(target.connectors).toHaveLength(0);
    expect(target.evidence[0].raw.rx).toBeCloseTo(0.2);
  });

  it("birleştirme deterministiktir", () => {
    const input = [detection("a", 1, 1, 1, 1.4, 1), detection("b", 1.1, 1, 1, 1.4, 2)];
    expect(mergeLegacyDetections(input)).toEqual(mergeLegacyDetections(input));
  });

  it("temkinli profil küçük boşluk dışındaki bulguları birleştirmez", () => {
    const input = [
      detection("left", 1, 1, 1, 1.4, 1, "Metal anomali adayı", 0.5),
      detection("right", 1.6, 1, 1, 1.4, 2, "Metal anomali adayı", 0.5),
    ];
    expect(mergeLegacyDetections(input, { mergeProfile: "cautious", positionToleranceM: 0.25 })).toHaveLength(2);
  });

  it("araştırma profili küçük yatay boşlukları aday bağlantı olarak korur", () => {
    const input = [
      detection("left", 1, 1, 1, 1.4, 1, "Metal anomali adayı", 0.5),
      detection("right", 1.6, 1, 1, 1.4, 2, "Metal anomali adayı", 0.5),
    ];
    const [target] = mergeLegacyDetections(input, { mergeProfile: "research", positionToleranceM: 0.25 });
    expect(target.detectionIds).toEqual(expect.arrayContaining(["left", "right"]));
    expect(target.connectors[0].gapM).toBeGreaterThan(0);
  });
});
