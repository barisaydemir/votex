import { describe, expect, it } from "vitest";
import {
  archiveSiteKey,
  depthSpreadByDetection,
  groupArchiveEntriesBySite,
  midDepthOfShape,
} from "../legacyArchiveConsistency.js";

describe("legacyArchiveConsistency", () => {
  it("site key strips pass / version suffixes", () => {
    expect(archiveSiteKey("saha_A_pass2.json")).toBe("saha_a");
    expect(archiveSiteKey("saha_A (2).json")).toBe("saha_a");
  });

  it("groups legacy archive entries by site", () => {
    const map = groupArchiveEntriesBySite([
      { fileName: "site_v1.json", sourceKind: "legacy_dik_json", id: "1" },
      { fileName: "site_v2.json", sourceKind: "legacy_dik_json", id: "2" },
      { fileName: "other.png", sourceKind: "image", id: "3" },
    ]);
    expect(map.get("site")?.length).toBe(2);
    expect(map.has("other")).toBe(false);
  });

  it("depth spread for nearby detections across sibling results", () => {
    const primary = [
      {
        detectionId: "legacy-dik-shape-1",
        raw: { cx: 1, cy: 2, depthTopM: 2, depthBottomM: 3 },
      },
    ];
    const siblings = [
      { metals: [{ cx: 1.1, cy: 2.0, depth_top_m: 2.2, depth_bottom_m: 3.1 }] },
      { anomalies: [{ cx: 0.95, cy: 2.05, depthTopM: 1.8, depthBottomM: 2.9 }] },
    ];
    const map = depthSpreadByDetection(primary, siblings);
    const info = map.get("legacy-dik-shape-1");
    expect(info.n).toBe(3);
    expect(info.spreadM).toBeGreaterThan(0);
    expect(midDepthOfShape({ depthTopM: 2, depthBottomM: 4 })).toBe(3);
  });
});
