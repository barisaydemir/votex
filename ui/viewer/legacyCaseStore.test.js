import { beforeEach, describe, expect, it } from "vitest";
import { state } from "../app/state.js";
import { createLegacyCase } from "./legacyCaseModel.js";
import { createLegacyCaseStore } from "./legacyCaseStore.js";

function resetState() {
  state.legacyDikResult = { fingerprint: "engine-fp", scanSteps: [], shapes: [] };
  state.legacyDikRawContent = '{"scan":1}';
  state.legacyDikFileName = "scan.json";
  state.legacyCase = createLegacyCase({
    result: state.legacyDikResult,
    fileName: state.legacyDikFileName,
    content: state.legacyDikRawContent,
  });
  state.legacyTargetSession = { kind: "none", stepIndex: null, detectionId: null, view: "scene", visibility: "step" };
  state.legacyReportTargetIds = [];
  state.selectedStructureId = null;
  state.legacyFieldSessionController = null;
}

describe("legacyCaseStore", () => {
  beforeEach(resetState);

  it("selection commands use the shared target session", () => {
    const store = createLegacyCaseStore(state);
    expect(store.selectStep(4, { source: "step-selection" }).stepIndex).toBe(4);
    expect(store.snapshot.workflowPhase).toBe("step");
    expect(store.selectDetection("legacy-dik-shape-2", 4, { source: "detection-selection" })).toMatchObject({
      detectionId: "legacy-dik-shape-2",
      stepIndex: 4,
      visibility: "selected-only",
    });
    expect(store.snapshot.workflowPhase).toBe("target");
  });

  it("report and review commands update both case observations and report ids", () => {
    const store = createLegacyCaseStore(state);
    expect(store.toggleReport("target-1")).toBe(true);
    expect(state.legacyReportTargetIds).toEqual(["target-1"]);
    expect(store.snapshot.observations["target-1"]).toMatchObject({ reviewed: true, report: true });
    expect(store.toggleReport("target-1")).toBe(false);
    expect(state.legacyReportTargetIds).toEqual([]);
    expect(store.snapshot.observations["target-1"].report).toBe(false);
  });

  it("clear command removes the case-level selection and analysis", () => {
    const store = createLegacyCaseStore(state);
    store.selectDetection("target-1", 2);
    store.toggleReport("target-1");
    const snapshot = store.clearCase();
    expect(snapshot.analysis).toBeNull();
    expect(snapshot.observations).toEqual({});
    expect(state.legacyReportTargetIds).toEqual([]);
    expect(state.legacyDikFileName).toBeNull();
  });
});
