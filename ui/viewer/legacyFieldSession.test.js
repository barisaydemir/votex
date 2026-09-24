import { describe, expect, it } from "vitest";
import {
  createEmptyFieldSession,
  createFieldSessionStore,
  isTargetReviewed,
  isTargetInSessionReport,
  markTargetReviewed,
  normalizeFieldSession,
  pruneSessions,
  recordVisit,
  sessionKeyOf,
  sessionProgressOf,
  setTargetCheckStatus,
  setLateralCalibration,
  setMergeReview,
  toggleTargetInReport,
} from "./legacyFieldSession.js";

describe("legacyFieldSession", () => {
  it("fingerprint + dosya adından oturum anahtarı türetir", () => {
    expect(sessionKeyOf("abc123", "scan.json")).toBe("abc123");
    expect(sessionKeyOf("", "scan.json")).toBe("scan.json");
    expect(sessionKeyOf("", "")).toBe("");
  });

  it("markTargetReviewed hedefi idempotent ekler", () => {
    let session = createEmptyFieldSession("fp-1");
    session = markTargetReviewed(session, "legacy-dik-shape-1");
    session = markTargetReviewed(session, "legacy-dik-shape-1");
    session = markTargetReviewed(session, "legacy-dik-shape-2");
    expect(session.reviewedTargets).toEqual(["legacy-dik-shape-2", "legacy-dik-shape-1"]);
    expect(isTargetReviewed(session, "legacy-dik-shape-1")).toBe(true);
    expect(session.targetChecks["legacy-dik-shape-1"].status).toBe("reviewed");
  });

  it("rapor toggling ekler ve çıkarır", () => {
    let session = createEmptyFieldSession("fp-1");
    let result = toggleTargetInReport(session, "a");
    expect(result.added).toBe(true);
    session = result.session;
    result = toggleTargetInReport(session, "a");
    expect(result.added).toBe(false);
    expect(result.session.reportTargets).toEqual([]);
    expect(isTargetInSessionReport(result.session, "a")).toBe(false);
  });

  it("recordVisit son hedefi ve adımı kaydeder", () => {
    let session = createEmptyFieldSession("fp-1");
    session = recordVisit(session, { detectionId: "a", stepIndex: "3" });
    expect(session.lastTargetId).toBe("a");
    expect(session.lastStepIndex).toBe(3);
    expect(isTargetReviewed(session, "a")).toBe(true);
  });

  it("setTargetCheckStatus doğrulama durumu yazar", () => {
    let session = createEmptyFieldSession("fp-1");
    session = setTargetCheckStatus(session, "a", "confirmed");
    expect(session.targetChecks.a.status).toBe("confirmed");
    session = setTargetCheckStatus(session, "a", "reviewed");
    expect(session.reviewedTargets).toContain("a");
  });

  it("normalizeFieldSession bozuk girdiyi reddeder, geçerliyi temizler", () => {
    expect(normalizeFieldSession({})).toBeNull();
    const fixed = normalizeFieldSession({
      fingerprint: "fp-2",
      reviewedTargets: ["a", "a", "", 7],
      reportTargets: "b",
      lastStepIndex: "5",
      targetChecks: { a: "confirmed", bad: null },
    });
    expect(fixed.key).toBe("fp-2");
    expect(fixed.reviewedTargets).toEqual(["a", "7"]);
    expect(fixed.reportTargets).toEqual(["b"]);
    expect(fixed.lastStepIndex).toBe(5);
    expect(fixed.targetChecks).toEqual({ a: { status: "confirmed", at: "" } });
  });

  it("store kaydeder ve yeniden yükler — uygulama yeniden açılışı simülasyonu", async () => {
    const backing = {};
    const store = createFieldSessionStore({
      loadAll: async () => backing,
      saveAll: async (all) => Object.assign(backing, all),
    });

    let session = await store.load("fp-live", "scan.json");
    expect(session).toBeNull();
    session = markTargetReviewed(createEmptyFieldSession("fp-live"), "legacy-dik-shape-1");
    const saved = await store.save(toggleTargetInReport(session, "legacy-dik-shape-1").session);

    // Yeni "uygulama açılışı": tamamen yeni store, aynı kalıcı depo.
    const store2 = createFieldSessionStore({
      loadAll: async () => backing,
      saveAll: async () => {},
    });
    const restored = await store2.load("fp-live");
    expect(restored.reviewedTargets).toEqual(["legacy-dik-shape-1"]);
    expect(restored.reportTargets).toEqual(["legacy-dik-shape-1"]);
    expect(restored.key).toBe("fp-live");
    expect(saved.updatedAt).toBeTruthy();
  });

  it("pruneSessions en güncel oturumları korur", () => {
    const sessions = {
      old: { key: "old", updatedAt: "2026-01-01T00:00:00" },
      mid: { key: "mid", updatedAt: "2026-06-01T00:00:00" },
      new: { key: "new", updatedAt: "2026-09-16T00:00:00" },
    };
    const pruned = pruneSessions(sessions, 2);
    expect(Object.keys(pruned).sort()).toEqual(["mid", "new"]);
  });

  it("lateral kalibrasyon snapshot'ını normalize edip yeniden yüklenebilir tutar", () => {
    let session = createEmptyFieldSession("fp-calib");
    session = setLateralCalibration(session, {
      mode: "field-stake",
      referenceDepthM: 1,
      readings: [0.48, 0.51, 0.5, 9],
      beforeM: 0.5,
      afterM: 1.01,
      depthScale: 1.02,
      quality: "repeatable",
    });
    const restored = normalizeFieldSession(session);
    expect(restored.schemaVersion).toBe(3);
    expect(restored.lateralCalibration).toMatchObject({
      mode: "field-stake",
      readings: [0.48, 0.51, 0.5],
      beforeM: 0.5,
      afterM: 1.01,
      depthScale: 1.02,
      quality: "repeatable",
    });
  });

  it("ayırma kararı ve birleşme politikası oturumla birlikte kalır", () => {
    const session = setMergeReview(createEmptyFieldSession("fp-merge"), {
      splitDetectionIds: ["a", "a", "b"],
      mergePolicy: { horizontalGapToleranceM: 0.2 },
    });
    const restored = normalizeFieldSession(session);
    expect(restored.splitDetectionIds).toEqual(["a", "b"]);
    expect(restored.mergePolicy.horizontalGapToleranceM).toBe(0.2);
  });

  it("sessionProgressOf özet üretir", () => {
    let session = createEmptyFieldSession("fp-1");
    expect(sessionProgressOf(session)).toMatchObject({ hasSession: false });
    session = markTargetReviewed(session, "a");
    expect(sessionProgressOf(session)).toMatchObject({ reviewed: 1, hasSession: true });
  });
});
