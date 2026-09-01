import * as THREE from "three";
import { $, state } from "../app/state.js";
import { makeChamber } from "./builders/chamber.js";
import { makeMetal, ensureMetalFocusTarget } from "./builders/metal.js";
import { makeTunnel } from "./builders/tunnel.js";
import { makeWater } from "./builders/water.js";
import { buildFreeDrawOverlay, applyFreeDrawVisibility } from "./builders/freeDraw.js";
import { buildGroundSurface } from "./ground.js";
import { depthRangeOf } from "./coords.js";
import { clearStructures, ensureViewer, invalidate, syncClipRange, refreshClipState, clipPlane } from "./scene.js";
import { applyXrayIfActive } from "./xray.js";
import { bindStructurePicking } from "./pick.js";

/** Gölge kamerasını sahne kutusuna göre daralt → keskin gölge. */
function fitSunToBox(box) {
  const sun = state.sunLight;
  if (!sun || box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 10) * 0.75;
  const sunDir = new THREE.Vector3(18, 28, 12).normalize();
  sun.position.copy(center).addScaledVector(sunDir, radius * 3);
  sun.target.position.copy(center);
  sun.target.updateMatrixWorld();
  const cam = sun.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = Math.max(0.5, radius * 0.5);
  cam.far = radius * 6;
  cam.updateProjectionMatrix();
}

/** Yapı mesh'lerine gölge bayrağı (sprite/rozetler hariç). */
function enableShadows(root) {
  root?.traverse((o) => {
    if (o.isMesh && !o.userData?.isBadge && !o.userData?.isDetailLabel) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

/** mapW×mapD dikdörtgen 1 m ızgara. */
function makeRectMeterGrid(mapW, mapD) {
  const hw = mapW * 0.5;
  const hd = mapD * 0.5;
  const positions = [];
  const step = 1;
  for (let x = -hw; x <= hw + 1e-6; x += step) {
    positions.push(x, 0, -hd, x, 0, hd);
  }
  for (let z = -hd; z <= hd + 1e-6; z += step) {
    positions.push(-hw, 0, z, hw, 0, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x2eb456,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  return new THREE.LineSegments(geo, mat);
}

export function separateBadges(root) {
  const badges = [];
  root.traverse((obj) => {
    if (obj.userData?.isBadge) badges.push(obj);
  });
  const wa = new THREE.Vector3();
  const wb = new THREE.Vector3();
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < badges.length; i++) {
      for (let j = i + 1; j < badges.length; j++) {
        const a = badges[i];
        const b = badges[j];
        a.getWorldPosition(wa);
        b.getWorldPosition(wb);
        const dx = wb.x - wa.x;
        const dy = wb.y - wa.y;
        const dz = wb.z - wa.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 1.7) {
          const push = dist > 1e-6 ? (1.7 - dist) * 0.5 : 0.85;
          const nx = dist > 1e-6 ? dx / dist : 1;
          const nz = dist > 1e-6 ? dz / dist : 0;
          a.position.x -= nx * push * 0.5;
          a.position.z -= nz * push * 0.5;
          a.position.y += push * 0.18;
          b.position.x += nx * push * 0.5;
          b.position.z += nz * push * 0.5;
          b.position.y += push * 0.22;
        }
      }
    }
  }
}

export function buildMesh(surface, vertExag, wireframe, depressionScale) {
  ensureViewer();
  bindStructurePicking();
  $("placeholder").style.display = "none";
  clearStructures();

  const viewMode = surface.viewMode || surface.view_mode || "top";
  const sideView = viewMode === "side";

  const { mesh: ground, mapW, mapD } = buildGroundSurface(surface, wireframe, vertExag, depressionScale);
  state.groundPlane = ground;
  ground.userData.votexLayer = "dta";
  ground.receiveShadow = true;
  state.scene.add(state.groundPlane);

  // meterGrid — boyut değiştiyse yeniden kur, değilse mevcudu koru
  const existingGrid = state.scene.getObjectByName("meterGrid");
  if (!existingGrid) {
    const grid = makeRectMeterGrid(mapW, mapD);
    grid.name = "meterGrid";
    grid.userData.votexLayer = "dta";
    grid.position.y = 0.05;
    state.scene.add(grid);
  }

  state.structureGroup = new THREE.Group();
  state.structureGroup.userData.votexLayer = "dta";
  const structs = surface.structures || {};
  const chambers = structs.chambers || [];
  const tunnels = structs.tunnels || [];
  const metals = structs.metals || [];
  const waters = structs.waters || [];
  let num = 1;

  chambers.forEach((ch, i) => {
    if (ch.kind === "cavity") return;
    const id = `chamber-${i}`;
    try {
      const g = makeChamber(ch, mapW, mapD, vertExag, wireframe, id, num, sideView);
      if (g) {
        state.structureGroup.add(g);
        num += 1;
      }
    } catch {
      /* bir oda sahneyi boşaltmasın */
    }
  });
  tunnels.forEach((t, i) => {
    const id = `tunnel-${i}`;
    try {
      const tun = makeTunnel(t, mapW, mapD, vertExag, wireframe, id, num, sideView);
      if (tun) {
        state.structureGroup.add(tun);
        num += 1;
      }
    } catch {
      /* bir tünel sahneyi boşaltmasın */
    }
  });
  metals.forEach((m, i) => {
    const id = `metal-${i}`;
    const mesh = makeMetal(m, mapW, mapD, vertExag, wireframe, id, num, sideView);
    if (mesh) {
      state.structureGroup.add(mesh);
      num += 1;
    } else {
      ensureMetalFocusTarget(m, id, mapW, mapD, vertExag, sideView);
    }
  });
  waters.forEach((wtr, i) => {
    const id = `water-${i}`;
    const mesh = makeWater(wtr, mapW, mapD, vertExag, wireframe, id, num++, sideView);
    if (mesh) state.structureGroup.add(mesh);
  });

  separateBadges(state.structureGroup);
  enableShadows(state.structureGroup);
  // Kesit aktifse yeni yapılara uygula
  if (state.clipEnabled) {
    const planes = [clipPlane];
    state.structureGroup.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        obj.material.clippingPlanes = planes;
        obj.material.clipShadows = true;
        obj.material.needsUpdate = true;
      }
    });
  }

  state.scene.add(state.structureGroup);

  if (state.useFootprintShape) {
    try {
      state.freeDrawGroup = buildFreeDrawOverlay(
        surface,
        mapW,
        mapD,
        vertExag,
        wireframe,
        sideView
      );
    state.freeDrawGroup.userData.votexLayer = "dta";
    enableShadows(state.freeDrawGroup);
    state.scene.add(state.freeDrawGroup);
    } catch {
      state.freeDrawGroup = null;
    }
  }
  applyFreeDrawVisibility();

  // Kamera: tüm harita ayakizi — NaN / dev kutu sis boşluğu yapmasın
  const rangeM = depthRangeOf(surface);
  const yDeep = -(rangeM * Math.max(Number(vertExag) || 1, 0.15) + 1.5);
  const mapBox = new THREE.Box3(
    new THREE.Vector3(-mapW * 0.5, yDeep, -mapD * 0.5),
    new THREE.Vector3(mapW * 0.5, 2, mapD * 0.5)
  );
  const structBox = new THREE.Box3().setFromObject(state.structureGroup);
  const boxOk = (b) => {
    const c = b.getCenter(new THREE.Vector3());
    const s = b.getSize(new THREE.Vector3());
    return (
      [c.x, c.y, c.z, s.x, s.y, s.z].every(Number.isFinite) &&
      s.x < mapW * 6 &&
      s.z < mapD * 6 &&
      s.x + s.y + s.z > 0.01
    );
  };
  const useMapOnly = state.useFootprintShape && state.poolFilled !== false;
  const box = !useMapOnly && boxOk(structBox) ? mapBox.clone().union(structBox) : mapBox;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  fitSunToBox(box);
  // Kesit slider aralığını harita derinliğine göre güncelle (+3 m üst boşluk)
  syncClipRange(Math.floor(yDeep - 1), 3);
  state.controls.target.set(center.x, Math.min(center.y, -0.5), center.z);
  const dist = Math.max(size.x, size.z, size.y, 10) * 1.25;
  state.camera.position.set(
    center.x + dist * 0.65,
    Math.max(center.y + dist * 0.45, 4),
    center.z + dist * 0.7
  );
  state.controls.update();
  refreshClipState();
  applyXrayIfActive();
  invalidate();
}
