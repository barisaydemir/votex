import { describe, expect, it } from "vitest";
import rustResultFixture from "../../examples/legacy_dik_result_fixture.json";
import { buildLegacyFieldModel } from "./legacyDikModel.js";
import { createLegacyCase } from "./legacyCaseModel.js";
import { createLegacyCasePackage } from "./legacyCasePackage.js";
import {
  buildTrainingExamplesForCase,
  formatTrainingSetJsonl,
  LEGACY_TRAINING_SET_SCHEMA_VERSION,
  trainingFileName,
} from "./legacyTrainingSet.js";

function loadedCase() {
  return {
    loaded: {
      meta: { id: "arch-1", fileName: "saha-a.json" },
      content: "{}",
      result: { ...rustResultFixture, fingerprint: "fp-saha-a" },
    },
    session: {
      key: "fp-saha-a",
      reportTargets: ["legacy-dik-shape-1"],
      targetChecks: {
        "legacy-dik-shape-1": { status: "reviewed", at: "" },
        "legacy-dik-shape-2": { status: "confirmed", at: "" },
      },
    },
    notesByKey: {
      "legacy-dik-shape-1": { notes: "Kazı yapıldı, metal uç bulundu.", photos: [{ name: "a.jpg" }] },
    },
  };
}

describe("legacyTrainingSet", () => {
  it("gerçek fixture vakasından operatör kararlı örnekler üretir", () => {
    const examples = buildTrainingExamplesForCase(loadedCase());
    expect(examples.length).toBeGreaterThan(0);

    const first = examples[0];
    expect(first.schemaVersion).toBe(LEGACY_TRAINING_SET_SCHEMA_VERSION);
    expect(first.source).toMatchObject({
      kind: "votex-legacy-dik",
      archiveId: "arch-1",
      fileName: "saha-a.json",
      fingerprint: "fp-saha-a",
      detectionId: "legacy-dik-shape-1",
    });
    // reportTargets içindeki tespit "report" etiketi alır.
    expect(first.kind).toBe("report");
    expect(first.operator).toMatchObject({ label: "report", note: "Kazı yapıldı, metal uç bulundu.", photoCount: 1 });
    expect(first.messages).toHaveLength(2);
    expect(first.messages[0].role).toBe("user");
    expect(first.messages[0].content).toContain("proxy");
    expect(first.messages[1].role).toBe("assistant");
    expect(first.messages[1].content).toContain("Operatör kararı: report");
    // Ölçüm alanları gerçek fixture değerlerinden gelir.
    expect(first.measurement.confidencePct).toBe(82);
  });

  it("Case Package detection kimliğini ve operatör etiketini korur", () => {
    const result = { ...rustResultFixture, fingerprint: "fp-package" };
    const model = buildLegacyFieldModel(result, { mergeProfile: "normal" });
    const casePackage = createLegacyCasePackage({
      caseModel: createLegacyCase({ result, fileName: "paket.json" }),
      fieldModel: model,
      session: {
        reportTargets: [model.detections[0].detectionId],
        targetChecks: { [model.detections[0].detectionId]: { status: "confirmed", reviewed: true } },
      },
    });
    const [example] = buildTrainingExamplesForCase({ casePackage, loaded: { meta: { id: "pkg-1" } } });
    expect(example.source.detectionId).toBe(model.detections[0].detectionId);
    expect(example.kind).toBe("report");
    expect(example.source.fileName).toBe("paket.json");
  });

  it("oturum kararı yoksa unreviewed işaretler", () => {
    const examples = buildTrainingExamplesForCase({
      loaded: {
        meta: { id: "arch-2", fileName: "saha-b.json" },
        content: "{}",
        result: rustResultFixture,
      },
    });
    expect(examples).toHaveLength(1);
    expect(examples[0].kind).toBe("unreviewed");
    expect(examples[0].operator.label).toBeNull();
    expect(examples[0].messages[1].content).toContain("incelemedi");
  });

  it("shapesiz vakada örnek üretmez", () => {
    const examples = buildTrainingExamplesForCase({
      loaded: { meta: { id: "x", fileName: "bos.json" }, content: "{}", result: { fingerprint: "fp" } },
    });
    expect(examples).toEqual([]);
  });

  it("24 tespitten fazlasını kırpar", () => {
    const shapes = Array.from({ length: 30 }, (_, index) => ({
      kind: "anomaly",
      cx: index,
      cy: 0,
      depthTopM: 1,
      depthBottomM: 2,
      confidence: 0.5,
    }));
    const examples = buildTrainingExamplesForCase({
      loaded: { meta: { id: "y", fileName: "buyuk.json" }, content: "{}", result: { fingerprint: "fp", anomalies: shapes } },
    });
    expect(examples).toHaveLength(24);
  });

  it("JSONL satırları geçerli JSON olur ve sayaçlar doğru çalışır", () => {
    const { jsonl, exampleCount, caseCount, skippedCases } = formatTrainingSetJsonl([
      loadedCase(),
      { loaded: { meta: { id: "bos", fileName: "bos.json" }, content: "{}", result: {} } },
    ]);
    const lines = jsonl.trim().split("\n");
    expect(lines.length).toBe(exampleCount);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.schemaVersion).toBe(LEGACY_TRAINING_SET_SCHEMA_VERSION);
      expect(parsed.messages).toHaveLength(2);
    }
    expect(caseCount).toBe(1);
    expect(skippedCases).toBe(1);
  });

  it("skipUnreviewed yalnız etiketli örnekleri bırakır", () => {
    const unlabeled = {
      loaded: { meta: { id: "z", fileName: "etiketsiz.json" }, content: "{}", result: rustResultFixture },
    };
    const labeled = loadedCase();
    const all = formatTrainingSetJsonl([unlabeled, labeled]);
    const filtered = formatTrainingSetJsonl([unlabeled, labeled], { skipUnreviewed: true });
    expect(all.exampleCount).toBeGreaterThan(filtered.exampleCount);
    expect(filtered.caseCount).toBe(1);
    const kinds = filtered.jsonl.trim().split("\n").map((line) => JSON.parse(line).kind);
    expect(kinds).not.toContain("unreviewed");
  });

  it("trainingFileName tarih damgalı ad üretir", () => {
    const name = trainingFileName(new Date(2026, 8, 20, 9, 5));
    expect(name).toBe("votex-egitim-20260920-0905.jsonl");
  });
});
