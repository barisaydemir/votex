/**
 * Legacy 3D obje bakış modu — mühendis değil saha kullanıcısı için.
 * shape: net şekil · signal: manyetik bulut · both: ikisi
 * Hesap/tespit sonucunu değiştirmez; yalnız görünürlük ve vurgu.
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";

const SIGNAL_TYPES = new Set(["signal-shell", "magnetic-plume"]);
const SHAPE_TYPES = new Set([
  "measured-volume",
  "measured-volume-edge",
  "room-interior",
  "metal-core",
  "anomaly-core",
  "tunnel-body",
  "tunnel-edge",
  "shaft-body",
  "shaft-rim",
  "estimated-body",
  "estimated-body-edge",
  "arched-tunnel",
  "shaft",
]);
const GUIDE_TYPES = new Set([
  "surface-energy-ring",
  "friendly-scale",
  "friendly-depth-stem",
  "friendly-depth-cap",
  "estimated-footprint",
  "estimated-uncertainty",
  "step-detection-link",
]);

/** Tomografi dilimi ile obje derinlik bandı örtüşme yarı genişliği (m). */
const SLICE_BAND_HALF_M = 0.45;

export function getLegacyObjectViewMode() {
  const mode = String(state.legacyObjectViewMode || "shape").toLowerCase();
  if (mode === "signal" || mode === "both" || mode === "shape") return mode;
  return "shape";
}

export function visualRoleOf(object) {
  if (object?.userData?.legacyVisualRole) return object.userData.legacyVisualRole;
  const type = String(object?.userData?.legacyRealisticType || "");
  if (SIGNAL_TYPES.has(type)) return "signal";
  if (GUIDE_TYPES.has(type)) return "guide";
  if (SHAPE_TYPES.has(type) || type.startsWith("tunnel") || type.startsWith("shaft") || type.startsWith("room")) {
    return "shape";
  }
  if (object?.userData?.legacyRealisticDetail) return "shape";
  return null;
}

function modeShowsRole(mode, role) {
  if (!role) return true;
  if (mode === "both") return true;
  if (mode === "shape") return role === "shape" || role === "guide";
  if (mode === "signal") return role === "signal" || role === "guide";
  return true;
}

function ensureBaseOpacity(material) {
  if (!material) return;
  if (material.userData?.votexXrayShared) return;
  if (material.userData?.votexBaseOpacity == null && Number.isFinite(material.opacity)) {
    material.userData = material.userData || {};
    material.userData.votexBaseOpacity = material.opacity;
  }
}

function setMaterialOpacity(object, factor) {
  // X-Ray açıksa ortak ShaderMaterial'a yazma — orijinal malzemeyi güncelle.
  const target = object?.userData?._origMat || object?.material;
  if (!target) return;
  const materials = Array.isArray(target) ? target : [target];
  materials.forEach((material) => {
    if (material.userData?.votexXrayShared) return;
    ensureBaseOpacity(material);
    const base = material.userData?.votexBaseOpacity;
    if (!Number.isFinite(base)) return;
    material.opacity = Math.max(0.04, Math.min(0.95, base * factor));
  });
}

function depthBandOf(object) {
  let top = Number(object?.userData?.legacyDepthTopM);
  let bottom = Number(object?.userData?.legacyDepthBottomM);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
    const shape = object?.userData?.legacyShape;
    top = Number(shape?.depthTopM ?? shape?.topDepthM);
    bottom = Number(shape?.depthBottomM ?? shape?.bottomDepthM);
  }
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  if (bottom < top) {
    const swap = top;
    top = bottom;
    bottom = swap;
  }
  return { top, bottom };
}

/**
 * Tomografi dilimi açıkken: band içi parlak, dışı soluk.
 * Analiz sonucunu değiştirmez.
 */
export function sliceSyncFactorOf(object, sliceDepthM = null, halfBandM = SLICE_BAND_HALF_M) {
  const depth = Number.isFinite(Number(sliceDepthM))
    ? Number(sliceDepthM)
    : Number(state.legacyTomographyDepthM);
  if (!state.legacyTomographyVisible || !Number.isFinite(depth)) return 1;
  const band = depthBandOf(object);
  if (!band) return 1;
  const half = Math.max(0.2, Number(halfBandM) || SLICE_BAND_HALF_M);
  const low = depth - half;
  const high = depth + half;
  const overlaps = band.top <= high && band.bottom >= low;
  if (!overlaps) return 0.12;
  const center = (band.top + band.bottom) * 0.5;
  const dist = Math.abs(center - depth);
  if (dist <= half * 0.55) return 1.2;
  if (dist <= half) return 0.95;
  // Uzun yapı: dilim bandı gövdenin bir kısmını kesiyor
  return 0.72;
}

export function getLegacyObjectViewBlend() {
  const t = Number(state.legacyObjectViewBlend);
  return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.5;
}

export function setLegacyObjectViewBlend(value) {
  const t = Math.max(0, Math.min(1, Number(value) || 0));
  state.legacyObjectViewBlend = t;
  state.legacyObjectViewMode = "both";
  applyLegacyObjectViewMode();
  return t;
}

function selectionMetadataOf(object) {
  let current = object;
  while (current) {
    const data = current.userData || {};
    const detectionId = data.legacyDetectionId || data.focusId || null;
    const stepIndex = data.legacyStepIndex;
    if (detectionId != null || stepIndex != null) {
      return { detectionId, stepIndex };
    }
    current = current.parent;
  }
  return { detectionId: null, stepIndex: null };
}

/**
 * Görünüm modu + seçili tespit + tomografi dilim senkronu uygula.
 */
export function applyLegacyObjectViewMode(group = state.legacyDikGroup) {
  if (!group) return getLegacyObjectViewMode();
  const mode = getLegacyObjectViewMode();
  const blend = getLegacyObjectViewBlend();
  const selectedId = state.legacySelectedDetectionId || null;
  const selectedStep = state.legacySelectedStepIndex != null
    && Number.isFinite(Number(state.legacySelectedStepIndex))
    ? Number(state.legacySelectedStepIndex)
    : null;
  const layer = group.getObjectByName("legacyRealisticLayer") || group;
  const sliceDepth = Number(state.legacyTomographyDepthM);
  const sliceHalf = (() => {
    const tomo = group.getObjectByName("legacyTomographyLayer");
    const step = Number(tomo?.userData?.sliceStepM);
    return Number.isFinite(step) ? Math.max(step * 0.55, SLICE_BAND_HALF_M) : SLICE_BAND_HALF_M;
  })();

  const selectedTarget = selectedId && state.structureTargets?.[selectedId];
  const selectedTargetObject = selectedTarget?.object || null;
  if (selectedTargetObject) {
    // Görünürlük başka bir profil/katman tarafından kapatılmışsa seçilen
    // hedefin ebeveyn zincirini de aç. Aksi halde obje açık görünse bile
    // gizli bir container altında kalıp ekranda yalnız seçim halkası kalır.
    let parent = selectedTargetObject;
    while (parent && parent !== group) {
      parent.visible = true;
      parent = parent.parent;
    }
  }

  layer.traverse((object) => {
    const role = visualRoleOf(object);
    if (!role && !object.userData?.legacyRealisticDetail && !object.userData?.legacyFriendlyGuide) return;

    const showByMode = modeShowsRole(mode, role);
    if (!(object.userData?.legacyRealisticDetail || object.userData?.legacyFriendlyGuide)) return;

    const metadata = selectionMetadataOf(object);
    const detectionId = metadata.detectionId;
    const objectStep = Number(metadata.stepIndex);
    const detectionMatches = selectedId == null
      ? true
      : detectionId != null && String(detectionId) === String(selectedId);
    const stepMatches = selectedStep == null
      ? true
      : (selectedId != null && detectionMatches)
        || (Number.isFinite(objectStep) && objectStep === selectedStep);
    // Tespit seçimi adım filtresinden daha dardır: aynı adımdaki kardeş
    // objeler de görünmez; yalnız seçilen tespitin tüm görsel parçaları kalır.
    object.visible = showByMode && stepMatches && (selectedId == null || detectionMatches);
    if (!object.visible) return;

    const isSelected = selectedId && (
      String(detectionId) === String(selectedId) || object === selectedTargetObject
    );
    const isOther = selectedId && detectionId && String(detectionId) !== String(selectedId);
    const selectionFactor = isSelected ? 1.18 : isOther ? 0.5 : 1;
    const sliceFactor = sliceSyncFactorOf(object, sliceDepth, sliceHalf);
    let roleFactor = 1;
    if (mode === "both") {
      if (role === "shape") roleFactor = Math.max(0.35, 1 - blend);
      else if (role === "signal") roleFactor = Math.max(0.35, blend);
    }
    const combined = isSelected
      ? Math.max(selectionFactor * sliceFactor * roleFactor, 0.85)
      : Math.max(selectionFactor * sliceFactor * roleFactor, isOther ? 0.28 : 0.08);
    setMaterialOpacity(object, combined);
  });

  const invertLayer = group.getObjectByName("legacyInvertProxy");
  if (invertLayer && state.legacyInvertProxyVisible) {
    const invertFactor = mode === "both"
      ? 0.35 + 0.65 * (1 - Math.abs(blend - 0.5) * 2)
      : mode === "shape"
        ? 0.85
        : 0.25;
    invertLayer.traverse((object) => {
      if (!object.material) return;
      setMaterialOpacity(object, invertFactor);
    });
  }

  import("./xray.js").then(({ applyXrayIfActive }) => {
    applyXrayIfActive();
  }).catch(() => {});

  invalidate();
  return mode;
}

export function setLegacyObjectViewMode(mode) {
  const next = String(mode || "shape").toLowerCase();
  state.legacyObjectViewMode = next === "signal" || next === "both" ? next : "shape";
  if (state.legacyObjectViewMode === "shape") state.legacyObjectViewBlend = 0;
  else if (state.legacyObjectViewMode === "signal") state.legacyObjectViewBlend = 1;
  else if (!Number.isFinite(Number(state.legacyObjectViewBlend))) state.legacyObjectViewBlend = 0.5;
  applyLegacyObjectViewMode();
  return state.legacyObjectViewMode;
}

/**
 * Kullanıcıya “bu 1 metre” referansı — tespit yanında küçük çubuk.
 */
export function makeFriendlyScaleBar(shape, worldX, worldZ, topM) {
  const group = new THREE.Group();
  group.name = `legacyFriendlyScale-${shape.id || shape.rank || 0}`;
  group.userData.legacyFriendlyGuide = true;
  group.userData.legacyVisualRole = "guide";
  group.userData.legacyRealisticType = "friendly-scale";
  group.userData.legacyDetectionId = shape.id;
  group.userData.focusId = shape.id;
  group.userData.legacyDepthTopM = shape.topDepthM ?? topM;
  group.userData.legacyDepthBottomM = shape.bottomDepthM ?? (topM + 1);

  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 1, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  bar.position.set(worldX + Math.max(shape.width || 0.5, 0.4) * 0.65, -topM - 0.5, worldZ);
  bar.userData.legacyFriendlyGuide = true;
  bar.userData.legacyVisualRole = "guide";
  bar.userData.legacyRealisticType = "friendly-scale";
  bar.userData.legacyDetectionId = shape.id;
  group.add(bar);

  const tickTop = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.04, 0.04),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  tickTop.position.set(bar.position.x, -topM, worldZ);
  tickTop.userData.legacyFriendlyGuide = true;
  tickTop.userData.legacyVisualRole = "guide";
  tickTop.userData.legacyRealisticType = "friendly-scale";
  group.add(tickTop);

  const tickBot = tickTop.clone();
  tickBot.position.y = -topM - 1;
  group.add(tickBot);

  // "1 m" yazısı basit sprite (tarayıcı dışında atlanır)
  if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 48;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, 128, 48);
      ctx.fillStyle = "rgba(8,16,24,0.75)";
      ctx.fillRect(4, 8, 120, 32);
      ctx.fillStyle = "#e8f0ff";
      ctx.font = "bold 22px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("1 m", 64, 24);
      const tex = new THREE.CanvasTexture(canvas);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }));
      spr.scale.set(0.7, 0.26, 1);
      spr.position.set(bar.position.x + 0.35, -topM - 0.5, worldZ);
      spr.userData.legacyFriendlyGuide = true;
      spr.userData.legacyVisualRole = "guide";
      spr.userData.legacyRealisticType = "friendly-scale";
      spr.userData.isBadge = false;
      group.add(spr);
    }
  }

  return group;
}

/**
 * Yüzeyden bulguya inen sade derinlik oku (bilgilendirici).
 */
export function makeFriendlyDepthStem(shape, worldX, worldZ, topM, bottomM) {
  const group = new THREE.Group();
  group.name = `legacyFriendlyDepth-${shape.id || shape.rank || 0}`;
  group.userData.legacyFriendlyGuide = true;
  group.userData.legacyVisualRole = "guide";
  group.userData.legacyRealisticType = "friendly-depth-stem";
  group.userData.legacyDetectionId = shape.id;
  group.userData.focusId = shape.id;
  group.userData.legacyDepthTopM = topM;
  group.userData.legacyDepthBottomM = bottomM;

  const mid = (topM + bottomM) * 0.5;
  const h = Math.max(bottomM - topM, 0.2);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, h, 8),
    new THREE.MeshBasicMaterial({ color: 0x9ad4ff, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  stem.position.set(worldX, -mid, worldZ);
  stem.userData.legacyFriendlyGuide = true;
  stem.userData.legacyVisualRole = "guide";
  stem.userData.legacyRealisticType = "friendly-depth-stem";
  stem.userData.legacyDetectionId = shape.id;
  group.add(stem);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
  );
  cap.position.set(worldX, -topM, worldZ);
  cap.userData.legacyFriendlyGuide = true;
  cap.userData.legacyVisualRole = "guide";
  cap.userData.legacyRealisticType = "friendly-depth-cap";
  cap.userData.legacyDetectionId = shape.id;
  group.add(cap);

  return group;
}
