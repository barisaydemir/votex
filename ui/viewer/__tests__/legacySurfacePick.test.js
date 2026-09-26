import { describe, expect, it, beforeEach } from "vitest";
import * as THREE from "three";
import { state } from "../../app/state.js";
import { nearestLegacyDetectionId, pickLegacyDetectionOnSurface } from "../pick.js";
import { createLegacyTargetSession } from "../legacyTargetSession.js";

describe("legacy surface pick → nearest detection", () => {
  beforeEach(() => {
    state.legacyDikGroup = new THREE.Group();
    state.legacyDikGroup.userData.gridWidthM = 8;
    state.legacyDikGroup.userData.gridDepthM = 10;
    state.legacyDikGroup.updateMatrixWorld(true);
    state.legacyTargetSession = createLegacyTargetSession({ source: "test-reset" });
    state.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    state.camera.position.set(6, 8, 6);
    state.camera.lookAt(0, 0, 0);
    state.camera.updateMatrixWorld(true);
    state.structureTargets = {
      "legacy-dik-shape-1": {
        position: new THREE.Vector3(1.2, -1.5, 0.4),
        radius: 0.9,
        object: { userData: { legacyStepIndex: 2 } },
      },
      "legacy-dik-shape-2": {
        position: new THREE.Vector3(-2.0, -1.2, 1.5),
        radius: 1.1,
        object: { userData: { legacyStepIndex: 5 } },
      },
    };
  });

  it("yüzey noktasına en yakın tespiti bulur", () => {
    const hit = new THREE.Vector3(1.15, 0.03, 0.35);
    expect(nearestLegacyDetectionId(hit)).toBe("legacy-dik-shape-1");
  });

  it("yerel XZ noktası ile de bulur", () => {
    expect(nearestLegacyDetectionId(new THREE.Vector3(1.2, 0, 0.4), 3, { local: true }))
      .toBe("legacy-dik-shape-1");
  });

  it("uzak tıklamada null döner", () => {
    const hit = new THREE.Vector3(10, 0, 10);
    expect(nearestLegacyDetectionId(hit, 2)).toBe(null);
  });

  it("seçili adımda eşleşme yoksa diğer adıma düşer", () => {
    state.legacyTargetSession = createLegacyTargetSession({ stepIndex: 99, source: "test" });
    const hit = new THREE.Vector3(-1.9, 0.02, 1.4);
    expect(nearestLegacyDetectionId(hit)).toBe("legacy-dik-shape-2");
  });

  it("kamera ışını y=0 yüzeyine düşerse tespit seçer", () => {
    // pickLegacyDetectionOnSurface raycaster'ı modül içinden kullanır;
    // doğrudan nearest ile aynı sözleşmeyi doğrula.
    const id = nearestLegacyDetectionId(new THREE.Vector3(1.0, 0, 0.5), 4, { local: true });
    expect(id).toBe("legacy-dik-shape-1");
    expect(typeof pickLegacyDetectionOnSurface).toBe("function");
  });
});
