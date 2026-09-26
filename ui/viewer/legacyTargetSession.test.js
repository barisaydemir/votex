import { describe, expect, it } from "vitest";
import {
  createLegacyTargetSession,
  selectedStepOf,
  selectedDetectionOf,
  targetSessionForStep,
  targetSessionForDetection,
  clearLegacyTargetSession,
  moveDetectionTarget,
  workflowPhaseForAction,
  advanceWorkflowPhase,
  WORKFLOW_PHASES,
} from "./legacyTargetSession.js";

describe("legacy target session", () => {
  it("reads the canonical selection and rejects stale values", () => {
    const session = targetSessionForDetection("obj-7", "4");
    expect(selectedStepOf(session)).toBe(4);
    expect(selectedDetectionOf(session)).toBe("obj-7");
    expect(selectedStepOf({ stepIndex: 0 })).toBeNull();
    expect(selectedDetectionOf({ detectionId: null })).toBeNull();
  });

  it("normalizes an empty selection", () => {
    expect(createLegacyTargetSession()).toMatchObject({
      kind: "none",
      stepIndex: null,
      detectionId: null,
      view: "scene",
      visibility: "step",
    });
  });

  it("represents a selected step without inventing an object", () => {
    expect(targetSessionForStep("12", { source: "list" })).toMatchObject({
      kind: "step",
      stepIndex: 12,
      detectionId: null,
      source: "list",
      view: "scene",
    });
  });

  it("keeps target view when a step is selected in target mode", () => {
    expect(targetSessionForStep(12, { source: "list", view: "target" })).toMatchObject({
      kind: "step",
      stepIndex: 12,
      detectionId: null,
      view: "target",
      visibility: "step",
    });
  });

  it("represents an object as selected-only within its step", () => {
    expect(targetSessionForDetection("legacy-dik-shape-2", 12, { view: "target" })).toMatchObject({
      kind: "detection",
      stepIndex: 12,
      detectionId: "legacy-dik-shape-2",
      view: "target",
      visibility: "selected-only",
    });
  });

  it("navigates deterministically to the next detection", () => {
    const detections = [
      { detectionId: "a", stepIndex: 1 },
      { detectionId: "b", stepIndex: 2 },
      { detectionId: "c", stepIndex: 3 },
    ];
    expect(moveDetectionTarget(detections, "a", 1)).toMatchObject({ detectionId: "b", stepIndex: 2 });
    expect(moveDetectionTarget(detections, "c", 1)).toMatchObject({ detectionId: "c", stepIndex: 3 });
  });

  it("clears the session without changing view preference", () => {
    expect(clearLegacyTargetSession({ view: "target", source: "reset" })).toMatchObject({
      kind: "none",
      view: "target",
      source: "reset",
    });
  });

  it("derives the workflow phase from the selection action", () => {
    expect(targetSessionForStep(12, { source: "step-selection" }).workflowPhase).toBe(WORKFLOW_PHASES.step);
    expect(targetSessionForDetection("a", 1, { source: "detection-selection" }).workflowPhase).toBe(WORKFLOW_PHASES.target);
    expect(targetSessionForDetection("a", 1, { source: "camera-focus" }).workflowPhase).toBe(WORKFLOW_PHASES.focus);
    expect(targetSessionForDetection("a", 1, { source: "target-navigation" }).workflowPhase).toBe(WORKFLOW_PHASES.focus);
  });

  it("advances the workflow phase monotonically — an early action never demotes it", () => {
    const focused = targetSessionForDetection("a", 1, { source: "camera-focus" });
    expect(focused.workflowPhase).toBe(WORKFLOW_PHASES.focus);
    const backToStep = targetSessionForStep(2, { source: "step-selection", workflowPhase: focused.workflowPhase });
    expect(backToStep.workflowPhase).toBe(WORKFLOW_PHASES.focus);
    expect(advanceWorkflowPhase(WORKFLOW_PHASES.focus, WORKFLOW_PHASES.step)).toBe(WORKFLOW_PHASES.focus);
    expect(advanceWorkflowPhase(WORKFLOW_PHASES.step, WORKFLOW_PHASES.focus)).toBe(WORKFLOW_PHASES.focus);
    expect(advanceWorkflowPhase(null, WORKFLOW_PHASES.target)).toBe(WORKFLOW_PHASES.target);
    expect(advanceWorkflowPhase(WORKFLOW_PHASES.focus, "bogus")).toBe(WORKFLOW_PHASES.focus);
  });

  it("maps every action source to a phase", () => {
    expect(workflowPhaseForAction("detection", "camera-focus")).toBe(WORKFLOW_PHASES.focus);
    expect(workflowPhaseForAction("detection", "target-navigation")).toBe(WORKFLOW_PHASES.focus);
    expect(workflowPhaseForAction("detection", "detection-selection")).toBe(WORKFLOW_PHASES.target);
    expect(workflowPhaseForAction("detection", "")).toBe(WORKFLOW_PHASES.target);
    expect(workflowPhaseForAction("step", "step-selection")).toBe(WORKFLOW_PHASES.step);
    expect(workflowPhaseForAction("step", "")).toBe(WORKFLOW_PHASES.step);
    expect(workflowPhaseForAction("none", "")).toBeNull();
  });
});
