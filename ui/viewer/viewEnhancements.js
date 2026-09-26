import * as THREE from "three";
import { $, state } from "../app/state.js";
import { selectedDetectionOf } from "./legacyTargetSession.js";
import { invalidate } from "./scene.js";
import { flyCameraTo, makeDetailSprite } from "./labels.js";

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

/**
 * Verilen hedefleri (rapor/seçim) tek karede çerçeveler; kamera konumunu geri
 * döndüren fonksiyon üretir. Rapor görüntüsü gibi anlık kare yakalama içindir —
 * kalıcı görünüm değiştirmez. Hedef pozisyonu bulunamazsa tüm sahneyi alır.
 *
 * @param {Array<string>} targetIds state.structureTargets anahtarları (tespit id'leri)
 * @returns {() => void} kamerayı eski konumuna döndüren fonksiyon
 */
export function frameTargetsForCapture(targetIds = []) {
  if (!state.camera || !state.controls) return () => {};
  const prevPosition = state.camera.position.clone();
  const prevTarget = state.controls.target.clone();
  const points = [];
  for (const id of Array.isArray(targetIds) ? targetIds : []) {
    const target = state.structureTargets?.[String(id)];
    if (target?.position) points.push(target.position);
  }
  if (points.length) {
    const box = new THREE.Box3();
    for (const p of points) box.expandByPoint(p);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 4);
    const distance = span * 1.8;
    state.controls.target.copy(center);
    state.camera.position.copy(
      center.clone().add(new THREE.Vector3(distance * 0.75, distance * 0.58, distance * 0.82))
    );
    state.controls.update();
    invalidate();
  } else {
    fitAllObjects();
  }
  return () => {
    state.camera.position.copy(prevPosition);
    state.controls.target.copy(prevTarget);
    state.controls.update();
    invalidate();
  };
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

function verificationLabelOf(status) {
  if (status === "confirmed") return "Doğrulandı";
  if (status === "rejected") return "Reddedildi";
  if (status === "reviewed") return "İncelendi";
  return "Doğrulanmadı";
}

export function verificationBadgeAccentOf(status) {
  if (status === "confirmed") return "#3edc8c";
  if (status === "rejected") return "#e23a3a";
  if (status === "reviewed") return "#e8a020";
  return "#9ca3af";
}

export function legacySelectionBadgeDataOf(id, target, appState = state) {
  const detection = appState.legacyFieldModel?.detections?.find((item) => String(item.detectionId) === String(id));
  const checks = appState.legacyFieldSessionController?.session?.targetChecks
    || appState.legacyCasePackage?.operator?.targetChecks
    || {};
  const status = String(checks[String(id)]?.status || "").toLowerCase();
  const match = String(id || "").match(/(?:shape|target)-(\d+)$/i);
  const ordinal = match?.[1] || String(detection?.stepIndex || "?");
  const confidence = Number(detection?.confidence ?? target?.confidence);
  const top = Number(detection?.depthTopM ?? target?.depthM);
  const bottom = Number(detection?.depthBottomM ?? top);
  const depthText = Number.isFinite(top)
    ? `${top.toFixed(2)}–${(Number.isFinite(bottom) ? bottom : top).toFixed(2)} m`
    : "derinlik —";
  return {
    title: `T-${ordinal}`,
    lines: [
      `${Number.isFinite(confidence) ? `%${Math.round(confidence * 100)} güven` : "güven —"} · ${depthText}`,
      verificationLabelOf(status),
    ],
    status: status || "unverified",
  };
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

  const id = state.selectedStructureId || selectedDetectionOf(state.legacyTargetSession);
  if (id && String(id).startsWith("legacy-dik-")) {
    const badgeData = legacySelectionBadgeDataOf(id, target, state);
    const badge = makeDetailSprite(badgeData.title, badgeData.lines, {
      accentHex: verificationBadgeAccentOf(badgeData.status),
    });
    badge.visible = true;
    badge.name = "selectedDetectionInfoBadge";
    badge.position.set(p.x, p.y + Math.max(0.75, (target.radius || 1) * 0.7), p.z);
    badge.scale.set(2.45, 0.72, 1);
    badge.renderOrder = 1300;
    badge.userData.selectedDetectionInfoBadge = true;
    badge.userData.legacyDetectionId = String(id);
    badge.userData.verificationStatus = badgeData.status;
    guideGroup.add(badge);
  }

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

let activeClippingPlane = null;

export function setSectionClippingPlane(axis = "none", ratio = 0.5) {
  if (!state.renderer) return null;
  const roots = [state.structureGroup, state.legacyDikGroup, state.csvOverlay, state.groundMagneticOverlay].filter(Boolean);
  if (axis === "none") {
    state.renderer.clippingPlanes = [];
    activeClippingPlane = null;
    invalidate();
    return { axis: "none", ratio: 0.5 };
  }

  const box = fitBox() || new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10));
  const min = box.min, max = box.max;
  const normalMap = {
    x: new THREE.Vector3(-1, 0, 0),
    y: new THREE.Vector3(0, -1, 0),
    z: new THREE.Vector3(0, 0, -1),
  };
  const normal = normalMap[axis] || normalMap.y;
  const val = axis === "x" ? min.x + (max.x - min.x) * ratio
            : axis === "y" ? min.y + (max.y - min.y) * ratio
            : min.z + (max.z - min.z) * ratio;

  const plane = new THREE.Plane(normal, val);
  state.renderer.clippingPlanes = [plane];
  activeClippingPlane = { axis, ratio, plane };
  invalidate();
  return activeClippingPlane;
}

export function exportGeoJSONReport() {
  const session = state.legacyTargetSession || {};
  const mergedTargets = session.mergedTargets || [];
  const features = mergedTargets.map((t, idx) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [t.cx || 0, t.cy || 0, -(t.topFromSurfaceM || t.depthM || 0)],
    },
    properties: {
      id: t.id || idx + 1,
      type: t.kind || t.type || "target",
      confidence: Math.round((t.confidence || 0.85) * 100),
      depth_m: t.topFromSurfaceM || t.depthM || 0,
      width_m: t.widthM || 1.2,
      length_m: t.lengthM || 1.2,
      footprints: t.footprints || [],
    }
  }));

  const geojson = {
    type: "FeatureCollection",
    metadata: {
      generatedBy: "VOTEX 0.4.115 AI Command Center",
      timestamp: new Date().toISOString(),
      mapId: session.mapId || "legacy_session",
    },
    features,
  };
  return geojson;
}
