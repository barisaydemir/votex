import { describe, expect, it } from "vitest";
import rustResultFixture from "../../examples/legacy_dik_result_fixture.json";
import {
  buildLegacyDtaCaseBrief,
  formatLegacyDtaCaseBriefText,
  LEGACY_DTA_BRIDGE_SCHEMA_VERSION,
} from "./legacyDtaBridge.js";
import { buildLegacyFieldModel } from "./legacyDikModel.js";
import { createLegacyCase } from "./legacyCaseModel.js";
import { createLegacyCasePackage } from "./legacyCasePackage.js";

const fieldModel = buildLegacyFieldModel(rustResultFixture, {
  mergeProfile: "normal",
  fieldCalibrationReadings: [0.49, 0.5, 0.51],
  fieldCalibrationAfterM: 1.02,
});

describe("legacyDtaBridge", () => {
  it("gerçek fixture vaka modelinden kanonik brief üretir", () => {
    const brief = buildLegacyDtaCaseBrief({
      fieldModel,
      source: { fileName: "fixture.json", fingerprint: "legacy-result-fixture-v1" },
      scan: { matrixRows: 1, matrixCols: 1 },
      depthParams: { sensorHeightM: 0.1, bipolarSepFactor: 1.85, dipoleBlend: 0.3 },
      mergeProfile: "normal",
      reportTargetIds: ["legacy-dik-shape-1"],
      observations: { "legacy-dik-shape-1": { reviewed: true, status: "confirmed" } },
      getNotes: (id) => (id === "legacy-dik-shape-1" ? { notes: "Metal uç 1.0 m kazıkta bulundu", photos: [{ name: "kazik.jpg" }] } : { notes: "", photos: [] }),
    });

    expect(brief).toMatchObject({
      schemaVersion: LEGACY_DTA_BRIDGE_SCHEMA_VERSION,
      caseType: "legacy3dmag",
      source: { fileName: "fixture.json", fingerprint: "legacy-result-fixture-v1" },
    });
    expect(brief.scan.detectionCount).toBe(1);
    expect(brief.detections[0]).toMatchObject({
      id: "legacy-dik-shape-1",
      stepIndex: 1,
      confidencePct: 82,
    });
    expect(brief.detections[0].review).toMatchObject({
      reviewed: true,
      inReport: true,
      photoCount: 1,
    });
    expect(brief.detections[0].review.notePreview).toContain("kazık");
    expect(brief.calibration).toMatchObject({
      applied: true,
      readingCount: 3,
      observedM: 1.02,
    });
    expect(brief.observations).toMatchObject({ reviewedCount: 1, reportCount: 1, notesCount: 1 });
  });

  it("brief üretmez — boş vaka", () => {
    expect(buildLegacyDtaCaseBrief({
      fieldModel: { steps: [], detections: [], mergedTargets: [] },
    })).toBeNull();
  });

  it("kırpma limitlerini uygular ve truncated işaretler", () => {
    const detections = Array.from({ length: 30 }, (_, index) => ({
      detectionId: `d${index + 1}`,
      stepIndex: 1,
      depthTopM: 1,
      depthBottomM: 2,
      confidence: 0.5,
      stationM: index,
      offsetM: 0,
    }));
    const mergedTargets = Array.from({ length: 15 }, (_, index) => ({
      targetId: `t${index + 1}`,
      type: "Anomali",
      depthTopM: 1,
      depthBottomM: 2,
      confidence: 0.5,
      detectionIds: ["d1"],
      stepIndices: [1],
      connectors: [],
    }));
    const brief = buildLegacyDtaCaseBrief({ fieldModel: { steps: [], detections, mergedTargets } });
    expect(brief.detections).toHaveLength(24);
    expect(brief.mergedTargets).toHaveLength(12);
    expect(brief.scan.truncated).toBe(true);
  });

  it("Case Package içindeki kanonik kaynak ve operatör kararını tüketir", () => {
    const casePackage = createLegacyCasePackage({
      caseModel: createLegacyCase({ result: rustResultFixture, fileName: "package.json" }),
      fieldModel,
      session: { reportTargets: ["legacy-dik-shape-1"] },
      options: { mergeProfile: "research" },
    });
    const brief = buildLegacyDtaCaseBrief({ casePackage });
    expect(brief.source.fileName).toBe("package.json");
    expect(brief.source.fingerprint).toBe(casePackage.source.fingerprint);
    expect(brief.mergeProfile).toBe("research");
    expect(brief.detections[0].review.inReport).toBe(true);
  });

  it("metin özeti proxy dili ve operatör gözlemini taşır", () => {
    const brief = buildLegacyDtaCaseBrief({
      fieldModel,
      source: { fileName: "fixture.json", fingerprint: "legacy-result-fixture-v1" },
    });
    const text = formatLegacyDtaCaseBriefText(brief);
    expect(text).toContain("LEGACY3DMAG DİK ÇEKİM VAKA ÖZETİ");
    expect(text).toContain("legacy-dik-shape-1");
    expect(text).toContain("proxy");
    expect(text).toContain("Adım 1");
    expect(text).toContain("yalnızca Legacy3DMAG JSON dik taramasıdır");
    expect(text).toContain("termal sensör doğrulaması isteme/önerme");
    expect(text).toContain("termal dışındaki uygun takip/doğrulama adımlarını belirt");
  });
});
