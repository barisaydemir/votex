import * as THREE from "three";
import { $, state } from "../app/state.js";
import { selectedDetectionOf } from "./legacyTargetSession.js";
import { invalidate } from "./scene.js";
import { flyCameraTo } from "./labels.js";

let guideGroup = null;
let bound = false;

function legacyDetectionIdOf(object) {
  let current = object;
  while (current) {
    const data = current.userData || {};
    const id = data.legacyDetectionId || data.focusId || null;
    if (id != null) return String(id);
    current = current.parent;
  }
  return null;
}
function visibleObjects() {
  const roots = [state.groundPlane, state.structureGroup, state.legacyDikGroup, state.csvOverlay, state.groundMagneticOverlay]
    .filter(Boolean);
  const objects = [];
  roots.forEach((root) => root.traverse((object) => {
    if (object.visible && (object.isMesh || object.isLine || object.isPoints)) objects.push(object);
  }));
  return objects;
}


function fitBox() {
  const box = new THREE.Box3();
  visibleObjects().forEach((object) => box.expandByObject(object));
  if (box.isEmpty()) return null;
  return box;
}

export function setCameraPreset(preset) {
  if (!state.camera || !state.controls) return false;
  const box = fitBox();
  if (!box) return false;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 4);
  const distance = span * 1.8;
  const positions = {
    top: center.clone().add(new THREE.Vector3(0, distance, 0.001)),
    front: center.clone().add(new THREE.Vector3(0, span * 0.45, distance)),
    side: center.clone().add(new THREE.Vector3(distance, span * 0.45, 0)),
    perspective: center.clone().add(new THREE.Vector3(distance * 0.75, distance * 0.58, distance * 0.82)),
  };
  const position = positions[preset] || positions.perspective;
  state.camera.position.copy(position);
  state.controls.target.copy(center);
  state.controls.update();
  invalidate();
  return true;
}

export function fitAllObjects() {
  return setCameraPreset("perspective");
}

export function focusSelectedObject() {
  const id = state.selectedStructureId || selectedDetectionOf(state.legacyTargetSession);
  const target = id && state.structureTargets?.[id];
  if (target) {
    flyCameraTo(target.position, target.radius || 3, target.title || id, { distScale: 2.8, heightScale: 0.7 });
    showDetectionGuides(target);
    return true;
  }
  return fitAllObjects();
}

function clearGuides() {
  if (!guideGroup) return;
  state.scene?.remove(guideGroup);
  guideGroup.traverse((object) => {
    object.geometry?.dispose?.();
    if (object.material) object.material.dispose?.();
  });
  guideGroup = null;
}

function line(a, b, color = 0xffd27a, opacity = 0.9) {
  const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
  const material = new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.14, gapSize: 0.08, depthTest: false });
  const result = new THREE.Line(geometry, material);
  result.computeLineDistances();
  result.renderOrder = 1200;
  return result;
}

function showDetectionGuides(target) {
  if (!state.scene || !target?.position) return;
  clearGuides();
  guideGroup = new THREE.Group();
  guideGroup.name = "selectedDetectionGuides";
  const p = target.position.clone();
  const surface = new THREE.Vector3(p.x, 0, p.z);
  guideGroup.add(line(surface, p, 0xffd27a, 0.95));
  guideGroup.add(line(new THREE.Vector3(p.x - 0.7, p.y, p.z), new THREE.Vector3(p.x + 0.7, p.y, p.z), 0x50dcff, 0.9));
  guideGroup.add(line(new THREE.Vector3(p.x, p.y, p.z - 0.7), new THREE.Vector3(p.x, p.y, p.z + 0.7), 0x50dcff, 0.9));
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(0.45, (target.radius || 1) * 0.7), Math.max(0.5, (target.radius || 1) * 0.78), 48),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(surface);
  ring.position.y = 0.08;
  ring.renderOrder = 1200;
  guideGroup.add(ring);
  state.scene.add(guideGroup);
  invalidate();
}

export function refreshSelectedGuides() {
  const id = state.selectedStructureId || selectedDetectionOf(state.legacyTargetSession);
  const target = id && state.structureTargets?.[id];
  if (target) showDetectionGuides(target);
  else clearGuides();
}

export function setViewProfile(profile) {
  const value = ["simple", "technical", "field"].includes(profile) ? profile : "simple";
  state.viewProfile = value;
  const root = state.scene;
  if (!root) return value;
  root.traverse((object) => {
    if (object.userData?.selectedDetectionGuides) return;
    const name = object.name || "";
    // Basit profilde teknik referans çizgilerini sakla; manyetik ısı haritası
    // ve seçili tespit geometrisi görünür kalır.
    const isTomography = object.userData?.legacyTomography === true;
    const isGrid = name === "meterGrid"
      || name === "legacyMeasuredMagneticGrid"
      || name === "legacyMagneticContours"
      || name === "magneticIsoContours"
      || name === "magneticGradientArrows"
      || /^magneticIsoContour-/.test(name);
    const isLabel = object.userData?.isBadge || object.userData?.isDetailLabel || object.userData?.legacyRankLabel || object.userData?.legacyScanStepLabel;
    const selectedDetectionId = selectedDetectionOf(state.legacyTargetSession);
    const objectDetectionId = legacyDetectionIdOf(object);
    const belongsToSelectedLegacyDetection = selectedDetectionId != null
      && objectDetectionId != null
      && objectDetectionId === String(selectedDetectionId);
    if (belongsToSelectedLegacyDetection) {
      // Tespit kimliği alt mesh'te değil üst grup/container'da olabilir.
      // Kimliği ebeveynlerden çözerek Basit/Saha profili seçili objeyi kapatamaz.
      return;
    }

    if (value === "simple") {
      if (object.userData?.legacyScanStepPath) object.visible = false;
      if (object.userData?.legacyUncertainty && !isLabel) object.visible = false;
      // Obje/adım etiketleri basit görünümde de saha kimliği olarak kalır;
      // yalnızca teknik grid ve belirsizlik katmanları sadeleştirilir.
    } else if (value === "technical") {
      if (isGrid || object.userData?.legacyUncertainty) object.visible = true;
      if (isLabel && object.userData?.legacyPrimary === false) object.visible = true;
    } else {
      if (isGrid && !isTomography && object.name !== "groundMap") object.visible = false;
      if (object.userData?.legacyScanStepPath) object.visible = true;
      if (object.userData?.legacyUncertainty || isLabel) object.visible = true;
    }
  });
  refreshSelectedGuides();
  invalidate();
  return value;
}

function bindButton(id, fn) {
  $(id)?.addEventListener("click", fn);
}

export function init3DViewEnhancements() {
  if (bound) return;
  bound = true;
  bindButton("view-camera-top", () => setCameraPreset("top"));
  bindButton("view-camera-front", () => setCameraPreset("front"));
  bindButton("view-camera-side", () => setCameraPreset("side"));
  bindButton("view-camera-3d", () => setCameraPreset("perspective"));
  bindButton("view-camera-fit", fitAllObjects);
  bindButton("view-camera-focus", focusSelectedObject);
  $("view-profile")?.addEventListener("change", (event) => setViewProfile(event.target.value));
  window.addEventListener("votex:selection-change", (event) => {
    refreshSelectedGuides();
    // 2D heatmap mevcut seçimle aynı hedefi vurgulasın.
    if (event.detail?.id) {
      window.dispatchEvent(new CustomEvent("votex:highlight-detection", { detail: { id: event.detail.id } }));
    }
  });
  window.addEventListener("votex:surface-applied", () => {
    setTimeout(() => setViewProfile(state.viewProfile || "simple"), 0);
  });
  setViewProfile(state.viewProfile || "simple");
}
