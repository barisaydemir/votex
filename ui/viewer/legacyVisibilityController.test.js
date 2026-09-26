import { describe, expect, it } from "vitest";
import {
  legacyLayerStateOf,
  selectionTransition,
  setUnifiedObjectMapVisible,
} from "./legacyVisibilityController.js";

describe("legacyVisibilityController", () => {
  it("birleşik obje bayrağını eski dilim bayrağından ayırır", () => {
    const state = { legacyUnifiedObjectMapVisible: false, legacyUndergroundMapVisible: true };
    setUnifiedObjectMapVisible(state, true);
    expect(legacyLayerStateOf(state)).toEqual({ unifiedObjects: true, undergroundSlices: true });
  });

  it("adım seçimi yalnız adım görünürlüğü üretir", () => {
    const next = selectionTransition({}, { type: "SELECT_STEP", stepIndex: 4 });
    expect(next).toMatchObject({ kind: "step", stepIndex: 4, detectionId: null, visibility: "step" });
  });

  it("obje seçimi adım ve selected-only görünürlüğünü birlikte taşır", () => {
    const next = selectionTransition({}, { type: "SELECT_DETECTION", detectionId: "d-7", stepIndex: 4 });
    expect(next).toMatchObject({ kind: "detection", stepIndex: 4, detectionId: "d-7", visibility: "selected-only" });
  });

  it("geçersiz seçim mevcut sözleşmeyi bozmaz", () => {
    const previous = selectionTransition({}, { type: "SELECT_STEP", stepIndex: 2 });
    expect(selectionTransition(previous, { type: "SELECT_STEP", stepIndex: 0 })).toEqual(previous);
  });
});
