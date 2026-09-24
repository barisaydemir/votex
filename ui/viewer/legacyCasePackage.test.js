import { describe, expect, it } from "vitest";
import rustResultFixture from "../../examples/legacy_dik_result_fixture.json";
import { buildLegacyFieldModel } from "./legacyDikModel.js";
import { createLegacyCase } from "./legacyCaseModel.js";
import {
  createLegacyCasePackage,
  legacyCasePackageKeyOf,
  legacyCasePackageMatches,
  refreshLegacyCasePackage,
  LEGACY_CASE_PACKAGE_SCHEMA_VERSION,
  LEGACY_CASE_PACKAGE_FILE_FORMAT,
  legacyCasePackageFileName,
  legacyCasePackageArchiveStatus,
  parseLegacyCasePackageJson,
  restoreLegacyCasePackageState,
  serializeLegacyCasePackage,
  validateLegacyCasePackage,
} from "./legacyCasePackage.js";

describe("legacyCasePackage", () => {
  const options = {
    mergeProfile: "cautious",
    splitDetectionIds: [],
    fieldCalibrationReadings: [0.49, 0.5, 0.51],
    fieldCalibrationReferenceM: 1,
    fieldCalibrationAfterM: 1.02,
    learnedThresholds: { decisionSampleCount: 4, confidenceStrong: 0.6 },
  };

  it("tek snapshot'ta analiz, türetilmiş model ve operatör durumunu taşır", () => {
    const fieldModel = buildLegacyFieldModel(rustResultFixture, options);
    const caseModel = createLegacyCase({ result: rustResultFixture, fileName: "fixture.json", content: "{}" });
    const snapshot = createLegacyCasePackage({
      caseModel,
      fieldModel,
      session: {
        targetChecks: { "legacy-dik-shape-1": { status: "confirmed" } },
        reportTargets: ["legacy-dik-shape-1"],
        lateralCalibration: { applied: true, observedM: 1.02 },
      },
      learnedThresholds: options.learnedThresholds,
      options,
    });

    expect(snapshot.schemaVersion).toBe(LEGACY_CASE_PACKAGE_SCHEMA_VERSION);
    expect(snapshot.analysis.fingerprint).toBe(rustResultFixture.fingerprint);
    expect(snapshot.derived.fieldModel).toBe(fieldModel);
    expect(snapshot.operator.targetChecks["legacy-dik-shape-1"].status).toBe("confirmed");
    expect(snapshot.operator.reportTargets).toEqual(["legacy-dik-shape-1"]);
    expect(snapshot.learning).toEqual(options.learnedThresholds);
  });

  it("model config değişince eski derived snapshot yeniden kullanılmaz", () => {
    const fieldModel = buildLegacyFieldModel(rustResultFixture, options);
    const snapshot = createLegacyCasePackage({ fieldModel, options });
    expect(snapshot.derived.key).toBe(legacyCasePackageKeyOf(fieldModel.result, options));
    expect(legacyCasePackageMatches(snapshot, rustResultFixture, options)).toBe(true);
    expect(legacyCasePackageMatches(snapshot, rustResultFixture, { ...options, mergeProfile: "research" })).toBe(false);
  });

  it("portable JSON round-trip ile modeli ve operatör etiketlerini korur", () => {
    const fieldModel = buildLegacyFieldModel(rustResultFixture, options);
    const snapshot = createLegacyCasePackage({
      caseModel: createLegacyCase({ result: rustResultFixture, fileName: "fixture.json" }),
      fieldModel,
      session: { reportTargets: ["legacy-dik-shape-1"] },
      options: { ...options, scan: { matrixRows: 1, matrixCols: 1 } },
    });
    const parsed = parseLegacyCasePackageJson(serializeLegacyCasePackage(snapshot));
    expect(parsed.source.fileName).toBe("fixture.json");
    expect(parsed.source.fingerprint).toBe(snapshot.source.fingerprint);
    expect(parsed.source.contentHash).toBe(snapshot.source.contentHash);
    expect(parsed.derived.fieldModel.detections[0].detectionId).toBe(fieldModel.detections[0].detectionId);
    expect(parsed.operator.reportTargets).toEqual(["legacy-dik-shape-1"]);
    expect(JSON.parse(serializeLegacyCasePackage(snapshot)).format).toBe(LEGACY_CASE_PACKAGE_FILE_FORMAT);
    expect(legacyCasePackageFileName(snapshot, new Date(2026, 8, 21, 9, 5))).toBe("fixture.votex-case-20260921-0905.json");
  });

  it("arşiv listesi için package ve fingerprint durumunu sınıflandırır", () => {
    expect(legacyCasePackageArchiveStatus({ sourceKind: "legacy_dik_json" })).toMatchObject({ kind: "legacy", label: "Eski format" });
    expect(legacyCasePackageArchiveStatus({ sourceKind: "legacy_dik_json", casePackageRel: "x/case_package.json" })).toMatchObject({ kind: "present", label: "Case Package mevcut" });
    expect(legacyCasePackageArchiveStatus({
      sourceKind: "legacy_dik_json",
      casePackageRel: "x/case_package.json",
      sourceFingerprint: "source-1",
      analysisFingerprint: "analysis-1",
    })).toMatchObject({ kind: "matched", label: "Case Package · fingerprint eşleşti" });
    expect(legacyCasePackageArchiveStatus({
      sourceKind: "legacy_dik_json",
      casePackageRel: "x/case_package.json",
      integrityStatus: "verified",
    })).toMatchObject({ kind: "verified", label: "Case Package · doğrulandı" });
    expect(legacyCasePackageArchiveStatus({
      sourceKind: "legacy_dik_json",
      casePackageRel: "x/case_package.json",
      integrityStatus: "mismatch",
    })).toMatchObject({ kind: "mismatch", label: "Case Package · uyuşmazlık" });
    expect(legacyCasePackageArchiveStatus({
      sourceKind: "legacy_dik_json",
      casePackageRel: "x/case_package.json",
      integrityStatus: "unverified",
    })).toMatchObject({ kind: "unverified", label: "Case Package · doğrulanmadı" });
    expect(legacyCasePackageArchiveStatus({ sourceKind: "image" })).toBeNull();
  });

  it("geçersiz portable package'i reddeder", () => {
    expect(() => parseLegacyCasePackageJson('{"schemaVersion":1}')).toThrow("source alanı eksik");
    expect(() => validateLegacyCasePackage({ schemaVersion: 99 })).toThrow("Desteklenmeyen Case Package schema sürümü");
  });

  it("restore pipeline'i package'ın derived modelini aynen korur", () => {
    const fieldModel = buildLegacyFieldModel(rustResultFixture, options);
    const packageSnapshot = createLegacyCasePackage({
      caseModel: createLegacyCase({ result: rustResultFixture, fileName: "restore.json" }),
      fieldModel,
      session: {
        reportTargets: ["legacy-dik-shape-1"],
        splitDetectionIds: ["legacy-dik-shape-1"],
        lateralCalibration: { mode: "field-stake", readings: [1.01], observedM: 1.01, depthScale: 0.99 },
      },
      options,
    });
    const state = {};
    const restored = restoreLegacyCasePackageState(state, packageSnapshot, {
      fileName: "restore.json",
      rawContent: "{\"raw\":true}",
    });
    expect(restored).toBe(packageSnapshot);
    expect(state.legacyFieldModel).toBe(packageSnapshot.derived.fieldModel);
    expect(state.legacyCasePackage).toBe(packageSnapshot);
    expect(state.legacyReportTargetIds).toEqual(["legacy-dik-shape-1"]);
    expect(state.legacyMergedSplitDetectionIds).toEqual(["legacy-dik-shape-1"]);
    expect(state.legacyFieldCalibrationDepthScale).toBe(0.99);
    expect(state.legacyDikRawContent).toBe("{\"raw\":true}");
  });

  it("state üzerindeki canonical package'i atomik olarak yeniler", () => {
    const fieldModel = buildLegacyFieldModel(rustResultFixture, options);
    const state = {
      legacyCase: createLegacyCase({ result: rustResultFixture, fileName: "fixture.json" }),
      legacyFieldModel: fieldModel,
      legacyLearnedThresholds: options.learnedThresholds,
      legacyFieldSessionController: { session: { targetChecks: {}, reportTargets: [] } },
    };
    const snapshot = refreshLegacyCasePackage(state, fieldModel, options);
    expect(state.legacyCasePackage).toBe(snapshot);
    expect(snapshot.derived.fieldModel).toBe(fieldModel);
    expect(snapshot.source.fingerprint).toBe(rustResultFixture.fingerprint);
  });
});
