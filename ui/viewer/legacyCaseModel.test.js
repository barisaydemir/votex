import { describe, expect, it } from "vitest";
import {
  analysisRevisionOf,
  contentFingerprint,
  createLegacyCase,
  migrateLegacyCase,
  setObservation,
} from "./legacyCaseModel.js";

describe("legacyCaseModel", () => {
  it("aynı JSON için içerik tabanlı ve dosya adından bağımsız anahtar üretir", () => {
    expect(contentFingerprint('{"x":1}', "a.json")).toBe(contentFingerprint('{"x":1}', "b.json"));
    expect(contentFingerprint('{"x":2}', "a.json")).not.toBe(contentFingerprint('{"x":1}', "a.json"));
  });

  it("analiz ve saha gözlemini ayrı tutar", () => {
    const model = createLegacyCase({
      result: { fingerprint: "engine-fp", message: "ok", scanSteps: [] },
      fileName: "scan.json",
      content: "raw",
    });
    const next = setObservation(model, "target-1", { reviewed: true, status: "confirmed", report: true });
    expect(next.analysis.message).toBe("ok");
    expect(next.observations["target-1"].status).toBe("confirmed");
    expect(next.source.fingerprint).toMatch(/^json-v2-/);
    expect(next.analysis.revision.id).toMatch(/^analysis-/);
    expect(next.analysisRevisions).toHaveLength(1);
    expect(next.source.legacyKeys).toContain("engine-fp");
  });

  it("eski/eksik vaka kaydını güvenli biçimde migrate eder", () => {
    const migrated = migrateLegacyCase({ observations: { a: { status: "suspect" } } }, { fileName: "x.json" });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.observations.a.reviewed).toBe(false);
    expect(migrated.source.fileName).toBe("x.json");
    expect(migrated.migration.fromSchemaVersion).toBe(1);
    expect(migrated.source.legacyKeys).toContain("x.json");
  });

  it("aynı analiz ve parametreler için kararlı revision üretir", () => {
    const result = { fingerprint: "engine", algorithmVersion: "v3", analyzedAt: "2026-09-17T10:00:00" };
    expect(analysisRevisionOf(result, { rows: 6, cols: 3 })).toEqual(
      analysisRevisionOf(result, { cols: 3, rows: 6 }),
    );
    expect(analysisRevisionOf(result, { rows: 5, cols: 3 }).id).not.toBe(
      analysisRevisionOf(result, { rows: 6, cols: 3 }).id,
    );
  });
});
