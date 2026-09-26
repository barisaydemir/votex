/**
 * Legacy3DMag — 3D ölçüm grid'i ve derinlik haritası.
 * Yapı, hesaplanan metre kotuna yerleştirilir (örtü → taban).
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { makeBadgeSprite, roundRect, flyCameraTo } from "./labels.js";
import { getMagneticContourLevels, computeMagneticContourSegments } from "./groundMagneticOverlay.js";
import { invalidate, refreshClipState, syncClipRange } from "./scene.js";
import { applyXrayIfActive } from "./xray.js";
import { buildLegacyFieldModel, magneticResponseOf } from "./legacyDikModel.js";
import { mergeLegacyShapes, normalizeLegacyResult, linkInvertProxiesToDetections } from "./legacyNormalize.js";
import { buildLegacyRealisticLayer } from "./legacy3dEngine.js";
import { applyLegacyObjectViewMode } from "./legacyObjectView.js";
import { dimensionsOf, volumeM3Of, formatVolumeM3 } from "./volume.js";
import { buildLegacyGridTemplate, findLegacyGridCell, applyLegacyNumberingToNormalized } from "./legacyGridTemplate.js";
import {
  clearLegacyTargetSession,
  targetSessionForDetection,
  targetSessionForStep,
  selectedDetectionOf,
  selectedStepOf,
} from "./legacyTargetSession.js";
import { selectionTransition } from "./legacyVisibilityController.js";
import { getLegacyUnifiedObjectMapLayer } from "./legacyUnifiedObjectMap.js";
import { refreshLegacyCasePackage } from "./legacyCasePackage.js";
import {
  addLegacyLateralEvidenceLayer,
  applyLegacyLateralEvidenceVisibility,
} from "./legacyLateralEvidenceLayer.js";

const GROUP_NAME = "legacyDikShapes";
/** Sabit dikey harita aralığı (metre) */
const DEPTH_MAX_M = 10;

function clearGroup() {
  const old = state.scene?.getObjectByName(GROUP_NAME);
  if (old) {
    state.scene.remove(old);
    old.traverse((o) => {
      // X-Ray açıkken paylaşılan shader'ı bırakmadan önce özgün materyali geri al.
      if (o.userData?._origMat) {
        o.material = o.userData._origMat;
        delete o.userData._origMat;
      }
      o.geometry?.dispose?.();
      if (o.material) {
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach((material) => {
          if (material.userData?.votexXrayShared) return;
          material.map?.dispose?.();
          material.dispose?.();
        });
      }
    });
  }
  if (state.selectedStructureId?.startsWith("legacy-dik-")) {
    state.selectedStructureId = null;
    if (state.selectionMarker && state.scene) {
      state.scene.remove(state.selectionMarker);
      state.selectionMarker.geometry?.dispose?.();
      state.selectionMarker.material?.dispose?.();
      state.selectionMarker = null;
    }
  }
}

function strengthOf(s) {
  return Number(s.peakSigma ?? s.strength) || 0;
}

function depthTopOf(s, maxDepth = DEPTH_MAX_M) {
  const v = Number(s.depthTopM);
  if (!Number.isFinite(v) || v < 0) return 0.3;
  return Math.min(v, Math.max(0.2, maxDepth - 0.2));
}

function depthBotOf(s, maxDepth = DEPTH_MAX_M) {
  const top = depthTopOf(s, maxDepth);
  let bot = Number(s.depthBottomM);
  if (!Number.isFinite(bot) || bot <= top) {
    const r = Math.max(Number(s.rx) || 0.2, 0.1);
    bot = top + Math.max(r * 1.4, 0.4);
  }
  return Math.min(Math.max(bot, top + 0.15), Math.max(top + 0.15, maxDepth));
}

function depthFitErrorOf(s) {
  const value = Number(s.depthFitError);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

function depthIntervalOf(s, maxDepth = DEPTH_MAX_M) {
  const top = depthTopOf(s, maxDepth);
  const bottom = depthBotOf(s, maxDepth);
  const center = (top + bottom) * 0.5;
  const fallback = Math.max((bottom - top) * 0.6, 0.45);
  const uncertainty = Number(s.depthUncertaintyM);
  const spread = Number.isFinite(uncertainty) && uncertainty > 0 ? uncertainty : fallback;
  const lowRaw = Number(s.depthIntervalLowM);
  const highRaw = Number(s.depthIntervalHighM);
  const low = Number.isFinite(lowRaw) && lowRaw > 0 ? lowRaw : center - spread;
  const high = Number.isFinite(highRaw) && highRaw > low ? highRaw : center + spread;
  const lo = Math.max(0.08, Math.min(low, maxDepth));
  const hi = Math.min(maxDepth, Math.max(high, lo + 0.08));
  return { low: lo, high: hi, center, uncertainty: Math.max(center - lo, hi - center), fitError: depthFitErrorOf(s) };
}

function depthFitColor(fitError) {
  if (fitError <= 0.2) return 0x55d98a;
  if (fitError <= 0.6) return 0xf2c14e;
  return 0xf06b6b;
}

function shapeTypeOf(shape) {
  return String(shape?.shapeType || "irregular").toLowerCase();
}

function shapeSourceOf(shape) {
  return String(shape?.shapeSource ?? "inferred").toLowerCase();
}

function shapeFitErrorOf(shape) {
  const value = Number(shape?.shapeFitError);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

function shapeLabelOf(shape) {
  const labels = {
    circle: "Daire",
    ellipse: "Elips",
    square: "Kare",
    rectangle: "Dikdörtgen",
    capsule: "Kapsül",
    polygon: "Çokgen",
    irregular: "Düzensiz",
  };
  return labels[shapeTypeOf(shape)] || "Düzensiz";
}

function shapeConfidenceOf(shape) {
  const value = Number(shape?.shapeConfidence);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

const TEMPLATE_NAMES = {
  room: "Kompakt aday",
  tunnel: "Uzun aday",
  shaft: "Dikey aday",
  metal: "Metal adayı",
  anomaly: "Belirsiz",
};

/** Şablon eşleştirme sonucu: "Tünel %78" — yoksa null. */
function templateLabelOf(shape) {
  const raw = shape?.templateKind;
  if (!raw) return null;
  const key = String(raw).toLowerCase();
  const name = TEMPLATE_NAMES[key] || String(raw);
  const score = Number(shape?.templateScore);
  return Number.isFinite(score) ? `${name} %${Math.round(score * 100)}` : name;
}

function shapeDimensionsOf(shape, rx, ry) {
  const width = Number(shape?.widthM);
  const length = Number(shape?.lengthM);
  return {
    width: Number.isFinite(width) && width > 0 ? width : rx * 2,
    length: Number.isFinite(length) && length > 0 ? length : ry * 2,
  };
}

function shapeOrientationOf(shape) {
  const degrees = Number(shape?.orientationDeg ?? shape?.orientation_deg);
  return Number.isFinite(degrees) ? degrees * Math.PI / 180 : 0;
}

function makeCapsuleShape(width, length) {
  const radius = Math.min(width, length) * 0.5;
  const half = Math.max((Math.max(width, length) - radius * 2) * 0.5, 0);
  const horizontal = width >= length;
  const shape = new THREE.Shape();
  if (horizontal) {
    shape.moveTo(-half, -radius);
    shape.lineTo(half, -radius);
    shape.absarc(half, 0, radius, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(-half, radius);
    shape.absarc(-half, 0, radius, Math.PI / 2, Math.PI * 1.5, false);
  } else {
    shape.moveTo(-radius, -half);
    shape.lineTo(-radius, half);
    shape.absarc(0, half, radius, Math.PI, 0, true);
    shape.lineTo(radius, -half);
    shape.absarc(0, -half, radius, 0, Math.PI, true);
  }
  return shape;
}

function polygonCentroid(points) {
  if (!points.length) return { x: 0, z: 0 };
  let area2 = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    const cross = x1 * z2 - x2 * z1;
    area2 += cross;
    cx += (x1 + x2) * cross;
    cz += (z1 + z2) * cross;
  }
  if (Math.abs(area2) < 1e-8) {
    const mean = points.reduce((acc, [x, z]) => ({ x: acc.x + x, z: acc.z + z }), { x: 0, z: 0 });
    return { x: mean.x / points.length, z: mean.z / points.length };
  }
  return { x: cx / (3 * area2), z: cz / (3 * area2) };
}

function polygonCoordinateSpaceOf(shape, polygon) {
  const explicit = String(
    shape?.polygonCoordinateSpace ?? shape?.polygon_coordinate_space ?? shape?.coordinateSpace ?? shape?.coordinate_space ?? "",
  ).toLowerCase();
  if (["normalized", "norm", "uv", "grid"].includes(explicit)) return "normalized";
  if (["meters", "meter", "m", "world", "metric"].includes(explicit)) return "meters";
  const points = Array.isArray(polygon) ? polygon : [];
  return points.length > 0 && points.every((point) => Array.isArray(point)
    && point.length >= 2
    && Number(point[0]) >= -0.001 && Number(point[0]) <= 1.001
    && Number(point[1]) >= -0.001 && Number(point[1]) <= 1.001)
    ? "normalized"
    : "meters";
}

// 2D plan konturu ile 3D gövdenin kullandığı tek fiziksel ayak izi dönüşümü.
// Backend'in yeni konturu grid'e göre global normalize gelir; bu konturu tekrar
// tespit merkezine taşımak 2D/3D arasında kayma üretir. Eski metre/local
// arşivlerde ise kontur merkezi ankraja taşınır.
function polygonToPlanPoints(shape, polygon, mapWidth, mapDepth, anchorX = null, anchorZ = null) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const space = polygonCoordinateSpaceOf(shape, polygon);
  const raw = polygon
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([x, z]) => [Number(x), Number(z)])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
  if (raw.length < 3) return [];
  if (space === "normalized") {
    const width = Math.max(Number(mapWidth) || 1, 0.5);
    const depth = Math.max(Number(mapDepth) || 1, 0.5);
    // Backend konturu grid'in tamamına göre normalize eder; 2D ile birebir
    // oturması için weighted tespit merkezine yeniden ankraj yapılmaz.
    return raw.map(([x, z]) => [x * width - width * 0.5, z * depth - depth * 0.5]);
  }
  if (Number.isFinite(anchorX) && Number.isFinite(anchorZ)) {
    // Eski lokal/metre arşivlerinde kontur merkezi ayrı tutulabildiği için
    // yalnızca bu sözleşmede güvenli bir merkez ankrajı uygula.
    const center = polygonCentroid(raw);
    const dx = Number(anchorX) - center.x;
    const dz = Number(anchorZ) - center.z;
    return raw.map(([x, z]) => [x + dx, z + dz]);
  }
  return raw;
}

function polygonToWorldPoints(polygon, mapWidth, mapDepth, anchorX = null, anchorZ = null) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const width = Math.max(Number(mapWidth) || 1, 0.5);
  const length = Math.max(Number(mapDepth) || 1, 0.5);
  const rawPoints = polygon
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([px, py]) => [Number(px), Number(py)])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
  if (rawPoints.length < 3) return [];

  // Yeni backend çıktısı 0–1 normalize koordinat kullanır. Eski arşivlerde
  // aynı poligon bazen metre cinsinden (lokal bbox veya global) kaydedilmiştir;
  // bu durumda değerleri tekrar harita genişliğiyle çarpmak şekli köşeye taşır.
  const normalized = rawPoints.every(([x, z]) => x >= -0.001 && x <= 1.001 && z >= -0.001 && z <= 1.001);
  const points = normalized
    ? rawPoints.map(([x, z]) => [x * width - width * 0.5, z * length - length * 0.5])
    : rawPoints;

  // Kontur hangi koordinat sözleşmesinden gelirse gelsin, gerçek tespit merkezi
  // tek ankrajdır. Alan ağırlıklı merkez, köşe/uzun poligonlarda ortalamadan daha
  // doğru sonuç verir.
  if (Number.isFinite(anchorX) && Number.isFinite(anchorZ)) {
    const center = polygonCentroid(points);
    const dx = Number(anchorX) - center.x;
    const dz = Number(anchorZ) - center.z;
    return points.map(([x, z]) => [x + dx, z + dz]);
  }
  return points;
}

function polygonToLocalPoints(polygon, mapWidth, mapDepth, anchorX, anchorZ) {
  const worldPoints = polygonToPlanPoints(null, polygon, mapWidth, mapDepth, anchorX, anchorZ);
  if (!worldPoints.length || !Number.isFinite(anchorX) || !Number.isFinite(anchorZ)) return worldPoints;
  return worldPoints.map(([x, z]) => [x - anchorX, z - anchorZ]);
}

function footprintPoints(shape, rx, ry, mapWidth, mapDepth, polygonOverride = null, anchorX = null, anchorZ = null) {
  const type = shapeTypeOf(shape);
  const polygon = polygonOverride || (Array.isArray(shape?.polygon) ? shape.polygon : []);
  const source = shapeSourceOf(shape);
  const fitError = shapeFitErrorOf(shape);
  // Ölçüm konturu, şekil sınıflandırması daire/elips olsa bile önceliklidir.
  const useMeasured = polygon.length >= 3 && (polygonOverride || source === "grid-contour" || type === "polygon" || type === "irregular" || fitError > 0.45);
  if (useMeasured) return polygonToPlanPoints(shape, polygon, mapWidth, mapDepth, anchorX, anchorZ);

  const dimensions = shapeDimensionsOf(shape, rx, ry);
  let points;
  if (type === "circle" || type === "ellipse") {
    points = Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return [Math.cos(a) * dimensions.width * 0.5, Math.sin(a) * dimensions.length * 0.5];
    });
  } else if (type === "capsule") {
    points = makeCapsuleShape(dimensions.width, dimensions.length).getPoints(32).map((p) => [p.x, p.y]);
  } else {
    points = [
      [-dimensions.width * 0.5, -dimensions.length * 0.5],
      [dimensions.width * 0.5, -dimensions.length * 0.5],
      [dimensions.width * 0.5, dimensions.length * 0.5],
      [-dimensions.width * 0.5, dimensions.length * 0.5],
    ];
  }
  const angle = shapeOrientationOf(shape);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map(([x, z]) => [x * cos - z * sin, x * sin + z * cos]);
}

function footprintCenterOf(shape, rx, ry, mapWidth, mapDepth, fallbackX = 0, fallbackZ = 0, anchorX = null, anchorZ = null) {
  const points = footprintPoints(shape, rx, ry, mapWidth, mapDepth, null, anchorX, anchorZ);
  if (points.length >= 3) return polygonCentroid(points);
  return { x: fallbackX, z: fallbackZ };
}

function createFootprintOutline(shape, rx, ry, mapWidth, mapDepth, color, opacity = 0.8, polygonOverride = null, anchorX = null, anchorZ = null) {
  const points = footprintPoints(shape, rx, ry, mapWidth, mapDepth, polygonOverride, anchorX, anchorZ);
  if (points.length < 3) return null;
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const inferred = shapeSourceOf(shape) !== "grid-contour";
  const material = inferred
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.12, gapSize: 0.08, depthWrite: false })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const line = new THREE.LineLoop(geometry, material);
  if (material.isLineDashedMaterial) line.computeLineDistances();
  line.userData.inferredGeometry = inferred;
  return line;
}

function createFootprintFill(shape, rx, ry, mapWidth, mapDepth, color, opacity = 0.16, polygonOverride = null, anchorX = null, anchorZ = null) {
  const points = footprintPoints(shape, rx, ry, mapWidth, mapDepth, polygonOverride, anchorX, anchorZ);
  if (points.length < 3) return null;
  const outline = new THREE.Shape();
  points.forEach(([x, z], i) => {
    if (i === 0) outline.moveTo(x, z);
    else outline.lineTo(x, z);
  });
  outline.closePath();
  const geometry = new THREE.ShapeGeometry(outline);
  geometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.inferredGeometry = shapeSourceOf(shape) !== "grid-contour";
  return mesh;
}

function createShapeGeometry(shape, rx, ry, height, mapWidth, mapDepth, preferMeasured = true, anchorX = null, anchorZ = null) {
  const type = shapeTypeOf(shape);
  const polygon = Array.isArray(shape?.polygon) ? shape.polygon : [];
  const source = shapeSourceOf(shape);
  const fitError = shapeFitErrorOf(shape);
  const dimensions = shapeDimensionsOf(shape, rx, ry);
  const orientation = shapeOrientationOf(shape);
  const useMeasuredPolygon = preferMeasured && polygon.length >= 3 && (source === "grid-contour" || type === "polygon" || type === "irregular" || fitError > 0.45);

  if (useMeasuredPolygon) {
    const points = polygonToPlanPoints(shape, polygon, mapWidth, mapDepth, anchorX, anchorZ);
    if (points.length < 3) return { geometry: new THREE.BoxGeometry(dimensions.width, height, dimensions.length), rotationY: orientation, measured: false, center: { x: anchorX || 0, z: anchorZ || 0 } };
    // Yerel orijin tespit tepesi (anchor); poligon coğrafyası aynı kalır, adım hizası bozulmaz.
    const center = Number.isFinite(anchorX) && Number.isFinite(anchorZ)
      ? { x: anchorX, z: anchorZ }
      : polygonCentroid(points);
    const outline = new THREE.Shape();
    points.forEach(([x, z], i) => {
      const localX = x - center.x;
      const localZ = z - center.z;
      if (i === 0) outline.moveTo(localX, localZ);
      else outline.lineTo(localX, localZ);
    });
    outline.closePath();
    const geometry = new THREE.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false });
    geometry.rotateX(Math.PI / 2);
    return { geometry, rotationY: 0, measured: true, center };
  }

  if (type === "circle" || type === "ellipse") {
    const radius = Math.max(dimensions.width * 0.5, 0.08);
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
    if (type === "ellipse") geometry.scale(1, 1, Math.max(dimensions.length / dimensions.width, 0.2));
    return { geometry, rotationY: orientation, measured: false };
  }
  if (type === "capsule") {
    const geometry = new THREE.ExtrudeGeometry(makeCapsuleShape(dimensions.width, dimensions.length), {
      depth: height,
      bevelEnabled: false,
      curveSegments: 12,
    });
    geometry.rotateX(Math.PI / 2);
    return { geometry, rotationY: orientation, measured: false };
  }
  if (type === "square" || type === "rectangle") {
    return {
      geometry: new THREE.BoxGeometry(dimensions.width, height, dimensions.length),
      rotationY: orientation,
      measured: false,
    };
  }
  return {
    geometry: new THREE.BoxGeometry(Math.max(dimensions.width, rx * 2), height, Math.max(dimensions.length, ry * 2)),
    rotationY: orientation,
    measured: false,
  };
}

function placeLegacyAnomalyLabel(group, tag, cx, cz, topM, spread, primary, rank) {
  const width = primary ? 3.7 : 1.75;
  const height = primary ? 0.54 : 0.31;
  const step = Math.max(spread * 2.2, primary ? 2.8 : 1.9);
  const directions = primary
    ? [[0, 0]]
    : [
        [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [-1, 1], [1, -1], [-1, -1],
        [2, 0], [-2, 0], [0, 2], [0, -2],
      ];
  const layout = group.userData.legacyLabelLayout || (group.userData.legacyLabelLayout = []);
  const overlaps = (x, z) => layout.some((item) =>
    Math.abs(x - item.x) < (width + item.width) * 0.5 + 0.18 &&
    Math.abs(z - item.z) < (height + item.height) * 0.5 + 0.18
  );

  let x = cx;
  let z = cz;
  for (const [dx, dz] of directions) {
    const candidateX = cx + dx * step;
    const candidateZ = cz + dz * step * 0.72;
    if (!overlaps(candidateX, candidateZ) || primary) {
      x = candidateX;
      z = candidateZ;
      break;
    }
  }
  if (!primary && overlaps(x, z)) {
    // Son çare: sıralamaya göre ayrı bir dış halkaya taşı.
    const angle = ((rank * 137.5) * Math.PI) / 180;
    const radius = step * (2 + Math.floor(rank / 8));
    x = cx + Math.cos(angle) * radius;
    z = cz + Math.sin(angle) * radius * 0.72;
  }

  tag.position.set(x, -topM + (primary ? 0.58 : 0.22), z);
  layout.push({ x, z, width, height });
}

function stepIndexOf(step, fallback = 0) {
  const value = Number(step?.index);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nearestScanStepIndex(shape, steps) {
  if (!Array.isArray(steps) || !steps.length) return null;
  const x = Number(shape?.cx);
  const z = Number(shape?.cy);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return stepIndexOf(steps[0], 1);
  const point = { x, y: z };
  let best = null;
  steps.forEach((step, index) => {
    const sx = Number(step.xCenterM ?? step.x_center_m);
    const sz = Number(step.yCenterM ?? step.y_center_m);
    if (!Number.isFinite(sx) || !Number.isFinite(sz)) return;
    const ax = Number(step.xStartM ?? step.x_start_m ?? sx);
    const ay = Number(step.yStartM ?? step.y_start_m ?? sz);
    const bx = Number(step.xEndM ?? step.x_end_m ?? sx);
    const by = Number(step.yEndM ?? step.y_end_m ?? sz);
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    let segmentDistance;
    if (len2 < 1e-12) {
      segmentDistance = Math.hypot(x - sx, z - sz);
    } else {
      const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - ay) * aby) / len2));
      segmentDistance = Math.hypot(x - (ax + t * abx), z - (ay + t * aby));
    }
    const centerDistance = Math.hypot(x - sx, z - sz);
    const better = !best
      || segmentDistance < best.distance - 1e-9
      || (Math.abs(segmentDistance - best.distance) <= 1e-9 && centerDistance < best.centerDistance);
    if (better) {
      best = { index: stepIndexOf(step, index + 1), distance: segmentDistance, centerDistance };
    }
  });
  return best?.index ?? stepIndexOf(steps[0], 1);
}

function isLegacyObjectLabel(object) {
  return !!(
    object?.userData?.legacyRankLabel
    || object?.userData?.legacyDetailCard
    || object?.userData?.isBadge
    || object?.userData?.legacyScanStepLabel
    || object?.userData?.legacyScanStepTitle
  );
}

function labelModeOf() {
  const mode = String(state.legacyLabelMode || "badge").toLowerCase();
  if (mode === "off" || mode === "full" || mode === "badge") return mode;
  return "badge";
}

function legacySelectionMetadataOf(object) {
  let current = object;
  while (current) {
    const data = current.userData || {};
    const detectionId = data.legacyDetectionId || data.focusId || null;
    const stepIndex = data.legacyStepIndex;
    if (detectionId != null || stepIndex != null) return { detectionId, stepIndex };
    current = current.parent;
  }
  return { detectionId: null, stepIndex: null };
}

function resolveLabelVisibility(object, selectedStep, detectionId) {
  const mode = labelModeOf();
  const metadata = legacySelectionMetadataOf(object);
  const objectStep = metadata.stepIndex;
  const stepVisible = selectedStep == null
    ? true
    : objectStep != null && Number(objectStep) === Number(selectedStep);
  const objectDetection = metadata.detectionId;
  const detectionVisible = !detectionId || (objectDetection != null && String(objectDetection) === String(detectionId));
  const isBadge = !!object.userData?.isBadge;
  const isScanMeta = !!(object.userData?.legacyScanStepLabel || object.userData?.legacyScanStepTitle);
  // Yalnız tek kaynak: rank detay kartı. Eski makeDetailSprite yedekleri asla açılmaz.
  const isCanonicalDetail = !!(object.userData?.legacyDetailCard && object.userData?.legacyRankLabel);

  if (object.userData?.legacyDuplicateBadge || object.userData?.legacyDuplicateDetail) {
    return false;
  }

  if (object.userData?.legacyGridCell) {
    return stepVisible;
  }

  if (isScanMeta) {
    return mode !== "off" && stepVisible;
  }

  if (mode === "off") {
    return false;
  }

  if (isCanonicalDetail) {
    if (!stepVisible || !detectionVisible) return false;
    if (mode === "full") return true;
    return !!detectionId && String(objectDetection) === String(detectionId);
  }

  // Eski isDetailLabel / non-rank kartlar: her zaman kapalı (çift etiket önleme)
  if (object.userData?.isDetailLabel || object.userData?.legacyDetailCard || object.userData?.legacyRankLabel) {
    return false;
  }

  if (isBadge) {
    return stepVisible && detectionVisible;
  }

  return stepVisible && detectionVisible;
}

function isLegacyPlanSceneElement(object) {
  const data = object?.userData || {};
  if (data.legacyScanGridTemplate || data.legacyGridCell) return true;
  if (data.legacyScanStepPath || data.legacyScanStepTitle || data.legacyScanStepLabel) return true;
  if (data.legacyScanStepsVisible) return true;
  if (object?.name === "legacyScanGridTemplate" || object?.name === "legacyMagneticContours") return true;
  if (data.scanStepIndex != null && !data.legacyDetectionId && !data.legacyRealisticDetail && !data.isBadge) {
    return true;
  }
  return false;
}

function isLegacyObjectSceneElement(object) {
  const data = object?.userData || {};
  if (data.legacyRealisticDetail || data.legacyFriendlyGuide || data.legacyInvertProxy) return true;
  if (data.legacyAnomaly || data.legacyShapeOutline || data.legacyProjection) return true;
  if (data.depthRuler || data.legacyUncertainty) return true;
  if (data.legacyShape && !isLegacyPlanSceneElement(object)) return true;
  return false;
}

export function getLegacySceneViewMode() {
  const mode = String(state.legacySceneViewMode || "combined").toLowerCase();
  return mode === "plan" || mode === "objects" ? mode : "combined";
}

/**
 * Saha görünümü: combined = plan+objeler · plan = ızgara/adım · objects = 3D hacimler.
 * Adım/tespit filtresi applyLegacyStepVisibility ile önce uygulanır; burada yalnız katman ayrımı yapılır.
 */
export function applyLegacySceneViewMode(mode = state.legacySceneViewMode, options = {}) {
  const next = String(mode || "combined").toLowerCase();
  state.legacySceneViewMode = next === "plan" || next === "objects" ? next : "combined";
  const view = state.legacySceneViewMode;
  const group = state.legacyDikGroup;
  if (!group) return view;

  if (!options.skipStepRefresh) {
    applyLegacyStepVisibility(
      selectedStepOf(state.legacyTargetSession),
      selectedDetectionOf(state.legacyTargetSession),
      { skipScene: true },
    );
  }

  if (view === "combined") {
    invalidate();
    return view;
  }

  group.traverse((object) => {
    if (!object || object === group) return;
    const planEl = isLegacyPlanSceneElement(object);
    const objectEl = isLegacyObjectSceneElement(object);

    if (view === "plan") {
      if (objectEl) object.visible = false;
      return;
    }

    if (view === "objects") {
      if (planEl) object.visible = false;
    }
  });

  // Invert katmanı plan modunda kapalı; diğer modlarda toggle durumuna bırak.
  const invertLayer = group.getObjectByName("legacyInvertProxy");
  if (invertLayer) {
    invertLayer.visible = view !== "plan" && !!state.legacyInvertProxyVisible;
  }

  invalidate();
  return view;
}

export function setLegacySceneViewMode(mode) {
  const active = applyLegacySceneViewMode(mode);
  // Plan görünümünde yüzey merkeze alınır; diğer modlarda normal 3D kadraj korunur.
  if (active === "plan" && state.camera && state.controls && state.legacyDikGroup) {
    const width = Number(state.legacyDikGroup.userData.gridWidthM) || 4;
    const depth = Number(state.legacyDikGroup.userData.gridDepthM) || 5;
    const span = Math.max(width, depth, 2);
    state.controls.target.set(0, 0, 0);
    state.camera.position.set(0, span * 1.35, 0.001);
    state.controls.update();
  }
  invalidate();
  return active;
}

export function applyFocusSafeStepVisibility(detectionId) {
  if (detectionId == null) return;
  applyLegacyStepVisibility(selectedStepOf(state.legacyTargetSession), detectionId);
}

export function setLegacyStepNumberingDirection(direction) {
  const next = String(direction || "rtl").toLowerCase() === "rtl" ? "rtl" : "ltr";
  state.legacyStepNumberingDirection = next;
  return next;
}

export function getLegacyStepNumberingDirection() {
  return String(state.legacyStepNumberingDirection || "rtl").toLowerCase() === "rtl" ? "rtl" : "ltr";
}

export function setLegacyLabelMode(mode) {
  const next = String(mode || "badge").toLowerCase();
  state.legacyLabelMode = next === "off" || next === "full" ? next : "badge";
  applyLegacyStepVisibility(selectedStepOf(state.legacyTargetSession), selectedDetectionOf(state.legacyTargetSession));
  invalidate();
  return state.legacyLabelMode;
}

export function getLegacyLabelMode() {
  return labelModeOf();
}

export function applyLegacyStepVisibility(stepIndex = null, detectionId = null, options = {}) {
  const group = state.legacyDikGroup;
  if (!group) return;
  const selected = Number.isFinite(Number(stepIndex)) && Number(stepIndex) > 0 ? Number(stepIndex) : null;
  const canonicalDetectionId = detectionId == null ? null : String(detectionId);
  const session = state.legacyTargetSession || {};
  if (selectedStepOf(session) !== selected || selectedDetectionOf(session) !== canonicalDetectionId) {
    state.legacyTargetSession = canonicalDetectionId
      ? targetSessionForDetection(canonicalDetectionId, selected, {
        ...session,
        source: session.source || "visibility-sync",
      })
      : selected == null
        ? clearLegacyTargetSession({ ...session, source: session.source || "visibility-sync" })
        : targetSessionForStep(selected, {
          ...session,
          source: session.source || "visibility-sync",
        });
  }
  group.userData.selectedStepIndex = selected;
  group.userData.selectedDetectionId = detectionId || null;

  // Seçili tespit için odak objectId üst üte afect. Bu, 3D tıklaması sonrası
  // obje ebeveyn container'ının kapanmasını önler ve "ekran boş" görünümünü
  // engeller. Sadece gerçek tespit secimi veya adim secimi durumunda calisir.
  const focusObjectId = detectionId ? String(detectionId) : null;
  const mergedTargetId = state.legacySelectedMergedTargetId ? String(state.legacySelectedMergedTargetId) : null;
  const mergedTarget = mergedTargetId
    ? state.legacyFieldModel?.mergedTargets?.find((item) => String(item.targetId) === mergedTargetId)
    : null;
  const mergedDetectionIds = new Set((mergedTarget?.detectionIds || []).map(String));
  const mergedViewMode = String(state.legacyMergedTargetViewMode || "simple");
  const focusedMergedTarget = !!mergedTarget && mergedViewMode !== "full";

  group.traverse((object) => {
    if (isLegacyObjectLabel(object) || object.userData?.isDetailLabel) {
      object.visible = resolveLabelVisibility(object, selected, detectionId || null);
      return;
    }
    if (focusedMergedTarget && !object.userData?.legacyUnifiedObject && !object.userData?.legacyUnifiedObjectMap) {
      const objectDetection = legacySelectionMetadataOf(object).detectionId;
      if (objectDetection != null) {
        // Sade görünümde ham kaynak gövdeleri gizlenir; kanıt görünümünde
        // yalnızca seçili birleşik hedefin kaynak anomalileri kalır.
        object.visible = mergedViewMode === "evidence" && mergedDetectionIds.has(String(objectDetection));
        return;
      }
    }
    if (object.userData?.legacyFallbackVisual) {
      // Bu nesne daha once adimsiz olarak isaretlenmis; sadece belirli
      // tespitler acikken gorunmesini sagliyoruz.
      const objId = object.userData?.legacyDetectionId || object.userData?.focusId || null;
      object.visible = !focusObjectId || (objId != null && String(objId) === focusObjectId);
      return;
    }
    if (object.userData?.legacyTomographyPersistent) {
      // Seçim dilimleri kapatmaz; peaking opacity ile yapılır.
      return;
    }
    if (object.userData?.legacySubsurfacePersistent) {
      return;
    }
    if (object.userData?.legacyGeothermalPersistent) {
      return;
    }
    if (object.userData?.legacyDepthPersistent) {
      return;
    }
    const objectStep = object.userData?.legacyStepIndex;
    const isGridCell = !!object.userData?.legacyGridCell;
    const isShared = object.userData?.legacyScanStepPath || object.userData?.legacyScanStepTitle;
    const isStepMarker = object.userData?.scanStepIndex != null
      && !object.userData?.legacyDetectionId
      && !isGridCell;
    if (isGridCell) {
      object.visible = selected == null || (objectStep != null && Number(objectStep) === selected);
    } else if (isShared || isStepMarker) {
      // Ortak tarama yolu/başlık (adımsız) her zaman kalır; adımlı işaretler süzülür.
      if (objectStep == null) {
        object.visible = true;
      } else {
        object.visible = selected == null || Number(objectStep) === selected;
      }
    } else if (objectStep != null) {
      const stepVisible = selected == null || Number(objectStep) === selected;
      const objectDetection = legacySelectionMetadataOf(object).detectionId;
      const detectionVisible = !detectionId
        || (objectDetection != null && String(objectDetection) === String(detectionId));
      object.visible = stepVisible && detectionVisible;
    } else if (detectionId) {
      // Yalnız başka tespitin parçalarını gizle. detectionId'siz katman kökleri
      // (legacyRealisticLayer, çerçeve, grid) açık kalsın — aksi halde tüm 3D boşalır.
      const objectDetection = legacySelectionMetadataOf(object).detectionId;
      if (objectDetection == null) return;
      object.visible = String(objectDetection) === String(detectionId);
    }
  });

  // Yapı hedef detay balonları: seçili tespit ile senkron
  if (state.structureTargets) {
    Object.entries(state.structureTargets).forEach(([key, target]) => {
      if (!target?.detailLabel) return;
      if (!String(key).startsWith("legacy-dik-")) return;
      target.detailLabel.visible = resolveLabelVisibility(target.detailLabel, selected, detectionId || null);
      if (target?.badge) {
        target.badge.visible = resolveLabelVisibility(target.badge, selected, detectionId || null);
      }
    });
  }
  applyLegacyObjectViewMode(group);
  if (!options.skipScene) applyLegacySceneViewMode(state.legacySceneViewMode, { skipStepRefresh: true });

  // Son güvenlik katmanı: profil/sahne modu tekrar görünürlük yazsa bile
  // seçilen tespitin gerçek gövde zinciri açık kalır. Aksi halde yalnızca
  // selection guide halkası görünür ve obje ekranda boş sanılır.
  if (detectionId && !focusedMergedTarget) {
    const selectedId = String(detectionId);
    group.traverse((object) => {
      const metadata = legacySelectionMetadataOf(object);
      const objectId = metadata.detectionId == null ? null : String(metadata.detectionId);
      if (objectId !== selectedId) return;
      if (isLegacyObjectLabel(object) || object.userData?.isDetailLabel) return;
      object.visible = true;
      let parent = object.parent;
      while (parent && parent !== group) {
        parent.visible = true;
        parent = parent.parent;
      }
    });
  }

  // Birleşik 3D görünümün tek sahibi legacyUnifiedObjectMap'tir. Eski kutu
  // katmanı artık üretilmez; burada yalnız canonical katmanın görünürlüğü ve
  // adım/tespit filtresi uygulanır.
  const unifiedLayer = getLegacyUnifiedObjectMapLayer();
  if (unifiedLayer) {
    unifiedLayer.visible = !!state.legacyUnifiedObjectMapVisible;
    unifiedLayer.traverse((object) => {
      if (!object.userData?.legacyMergedTarget) return;
      const ids = object.userData.legacyDetectionIds || [];
      const steps = object.userData.legacyStepIndices || [];
      const stepMatches = selected == null || steps.includes(Number(selected));
      const targetMatches = !mergedTargetId || object.userData.legacyMergedTargetId === mergedTargetId;
      const detectionMatches = !detectionId || ids.includes(String(detectionId));
      object.visible = stepMatches && targetMatches && (focusedMergedTarget ? true : detectionMatches);
    });
  }
  // Lateral çizgiler fiziksel bağlantı değildir; yalnızca seçili hedefin
  // Kanıt görünümünde, açıklayıcı proxy olarak açılır.
  applyLegacyLateralEvidenceVisibility({
    detectionId: canonicalDetectionId,
    targetId: mergedTargetId,
    viewMode: mergedViewMode,
  });
  invalidate();
}

export function setLegacySelectedStep(stepIndex) {
  const numeric = Number(stepIndex);
  const selected = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  const transition = selectionTransition(state.legacyTargetSession, {
    type: selected == null ? "CLEAR_SELECTION" : "SELECT_STEP",
    stepIndex: selected,
    source: "step-selection",
  });
  state.legacyTargetSession = selected == null
    ? (state.legacyCaseStore?.clearSelection({ source: "selection-reset", view: state.legacyTargetMode ? "target" : "scene" })
      || clearLegacyTargetSession({ ...transition, source: "selection-reset", view: state.legacyTargetMode ? "target" : "scene" }))
    : (state.legacyCaseStore?.selectStep(transition.stepIndex, {
      ...transition,
      source: "step-selection",
      view: state.legacyTargetMode ? "target" : "scene",
    }) || targetSessionForStep(transition.stepIndex, {
      ...transition,
      source: "step-selection",
      view: state.legacyTargetMode ? "target" : "scene",
    }));
  applyLegacyStepVisibility(selected, null);
  applyInvertProxySelection(null);
  return selected;
}

export function setLegacySelectedDetection(detectionId) {
  const group = state.legacyDikGroup;
  const id = detectionId ? String(detectionId) : null;
  const target = id && state.structureTargets?.[id];
  const step = target?.object?.userData?.legacyStepIndex
    ?? target?.badge?.userData?.legacyStepIndex
    ?? null;
  state.selectedStructureId = id;
  const transition = selectionTransition(state.legacyTargetSession, {
    type: id ? "SELECT_DETECTION" : "CLEAR_SELECTION",
    detectionId: id,
    stepIndex: step,
    source: "detection-selection",
  });
  state.legacyTargetSession = id
    ? (state.legacyCaseStore?.selectDetection(id, transition.stepIndex, { ...transition, source: "detection-selection", view: state.legacyTargetMode ? "target" : "scene" })
      || targetSessionForDetection(id, transition.stepIndex, { ...transition, source: "detection-selection", view: state.legacyTargetMode ? "target" : "scene" }))
    : (state.legacyCaseStore?.clearSelection({ ...transition, source: "selection-reset", view: state.legacyTargetMode ? "target" : "scene" })
      || clearLegacyTargetSession({ ...transition, source: "selection-reset", view: state.legacyTargetMode ? "target" : "scene" }));
  applyLegacyStepVisibility(selectedStepOf(state.legacyTargetSession), id);
  applyInvertProxySelection(id);
  if (id && state.legacyTomographyVisible) {
    const detection = state.legacyFieldModel?.detections?.find((item) => item.detectionId === id)
      || group?.userData?.fieldModel?.detections?.find((item) => item.detectionId === id);
    if (detection) {
      import("./legacyTomography.js").then(({ focusTomographyOnDetection }) => {
        focusTomographyOnDetection(detection);
      }).catch(() => {});
    }
  }
  import("../ui/legacyDikPanel.js").then(({ updateLegacySahaBrief }) => {
    updateLegacySahaBrief(id);
  }).catch(() => {});
  return id;
}

export function clearLegacySelection() {
  state.selectedStructureId = null;
  state.legacyTargetSession = state.legacyCaseStore?.clearSelection({ source: "clear-button", view: state.legacyTargetMode ? "target" : "scene" })
    || clearLegacyTargetSession({ source: "clear-button", view: state.legacyTargetMode ? "target" : "scene" });
  applyLegacyStepVisibility(null, null);
  applyInvertProxySelection(null);
  return null;
}

export function focusLegacyDetection(detectionId) {
  const id = detectionId ? String(detectionId) : null;
  const target = id && state.structureTargets?.[id];
  if (!target) return null;

  // Viewer hazır değilse / placeholder üstteyse odak boş ekran gibi görünür.
  try {
    const ph = typeof document !== "undefined" ? document.getElementById("placeholder") : null;
    if (ph) ph.style.display = "none";
  } catch {
    /* ignore */
  }

  const step = target.object?.userData?.legacyStepIndex
    ?? target.badge?.userData?.legacyStepIndex
    ?? null;
  state.selectedStructureId = id;
  const transition = selectionTransition(state.legacyTargetSession, {
    type: "SELECT_DETECTION",
    detectionId: id,
    stepIndex: step,
    source: "camera-focus",
  });
  state.legacyTargetSession = state.legacyCaseStore?.selectDetection(id, transition.stepIndex, { ...transition, source: "camera-focus", view: state.legacyTargetMode ? "target" : "scene" })
    || targetSessionForDetection(id, transition.stepIndex, { ...transition, source: "camera-focus", view: state.legacyTargetMode ? "target" : "scene" });
  applyLegacyStepVisibility(selectedStepOf(state.legacyTargetSession), selectedDetectionOf(state.legacyTargetSession));
  applyInvertProxySelection(id);

  // Seçili gövde + ebeveyn zinciri kesin açık kalsın.
  if (target.object) {
    let node = target.object;
    const root = state.legacyDikGroup;
    while (node && node !== root) {
      node.visible = true;
      node = node.parent;
    }
  }

  flyCameraTo(target.position, target.radius, target.title || id);
  try {
    window.dispatchEvent(new CustomEvent("votex:selection-change", { detail: { id } }));
  } catch {
    /* ignore */
  }
  import("./viewEnhancements.js").then(({ refreshSelectedGuides }) => {
    refreshSelectedGuides();
  }).catch(() => {});
  return id;
}

export function focusLegacyStep(stepIndex) {
  const selected = setLegacySelectedStep(stepIndex);
  const group = state.legacyDikGroup;
  const steps = group?.userData?.fieldModel?.steps || [];
  const step = steps.find((entry) => entry.stepIndex === selected)?.raw;
  if (!step || !state.camera || !state.controls) return selected;
  const originX = Number(group.userData.gridOriginXM) || 0;
  const originZ = Number(group.userData.gridOriginZM) || 0;
  const width = Number(group.userData.gridWidthM) || 1;
  const depth = Number(group.userData.gridDepthM) || 1;
  const x = Number(step.xCenterM ?? step.x_center_m) - (originX + width * 0.5);
  const z = Number(step.yCenterM ?? step.y_center_m) - (originZ + depth * 0.5);
  const target = new THREE.Vector3(x, -0.35, z);
  state.controls.target.copy(target);
  state.camera.position.set(x + 3.5, 2.2, z + 3.5);
  state.controls.update();
  invalidate();
  return selected;
}

function tagLegacyStepObjects(root, stepIndex, detectionId = null) {
  if (stepIndex == null || !root) return;
  root.traverse((child) => {
    child.userData.legacyStepIndex = stepIndex;
    child.userData.legacyFallbackVisual = true;
    if (detectionId) child.userData.legacyDetectionId = detectionId;
  });
}

function drawDepthUncertainty(group, shape, cx, cz, rx, ry, num, maxDepth, id, rank = 1, primary = false) {
  const interval = depthIntervalOf(shape, maxDepth);
  const bandHeight = Math.max(interval.high - interval.low, 0.08);
  const color = depthFitColor(interval.fitError);
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(rx * 2.3, 0.35), bandHeight, Math.max(ry * 2.3, 0.35)),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: interval.fitError <= 0.6 ? 0.16 : 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  band.position.set(cx, -(interval.low + interval.high) * 0.5, cz);
  band.name = `legacyDepthUncertainty-${num}`;
  band.userData.legacyUncertainty = true;
  band.userData.focusId = id;
  group.add(band);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(band.geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.82, depthWrite: false }),
  );
  outline.position.copy(band.position);
  outline.name = `legacyDepthUncertaintyEdge-${num}`;
  outline.userData.legacyUncertainty = true;
  outline.userData.focusId = id;
  group.add(outline);

  const topM = depthTopOf(shape, maxDepth);
  const accent = primary ? "#ff4646" : `#${color.toString(16).padStart(6, "0")}`;
  const badge = makeBadgeSprite(rank, accent);
  badge.name = `legacyDetectionBadge-${rank}`;
  badge.position.set(cx, -topM + 0.42, cz);
  badge.scale.set(primary ? 0.48 : 0.4, primary ? 0.64 : 0.53, 1);
  badge.userData.isBadge = true;
  badge.userData.focusId = id;
  badge.userData.legacyDetectionId = id;
  group.add(badge);

  const tag = makeRankedAnomalyLabel(shape, rank, interval, primary);
  const spread = Math.max(rx, ry, 0.25);
  // Detay kartı kenara kayar; varsayılan gizli (rozet modunda yalnız seçilince açılır).
  placeLegacyAnomalyLabel(group, tag, cx, cz, topM, spread, false, rank);
  tag.position.y = -topM + (primary ? 1.05 : 0.85);
  tag.visible = false;
  tag.userData.legacyUncertainty = true;
  tag.userData.legacyDetailCard = true;
  tag.userData.isDetailLabel = true;
  tag.userData.legacyRankLabel = true;
  tag.userData.focusId = id;
  tag.userData.legacyDetectionId = id;
  group.add(tag);

  if (state.structureTargets?.[id]) {
    state.structureTargets[id].detailLabel = tag;
    state.structureTargets[id].badge = badge;
  } else if (state.structureTargets) {
    state.structureTargets[id] = {
      ...(state.structureTargets[id] || {}),
      detailLabel: tag,
      badge,
    };
  }

  return interval;
}

export function selectLegacyAnomalies(result) {
  return shapeListOf(result);
}

export function selectLegacyMetals(result) {
  const normalized = normalizeLegacyResult(result);
  let list = normalized.metals?.length
    ? [...normalized.metals]
    : (normalized.candidates || []).filter((s) => String(s.kind) === "metal");
  if (!list.length) return [];
  list.sort((a, b) => strengthOf(b) - strengthOf(a));
  // Tüm metal/anomali adaylarını göster; sıralama güçlüden zayıfa kalsın.
  // Böylece ilk öğe 3D'de "GÜÇLÜ ANOMALİ" olarak öne çıkarılır,
  // diğerleri küçük etiket ve ayrı seçim hedefi olarak korunur.
  return list;
}

function shapeListOf(result) {
  return mergeLegacyShapes(normalizeLegacyResult(result));
}

function finiteGrid(result) {
  const normalized = normalizeLegacyResult(result);
  const gw = Number(normalized.gridW) || 0;
  const gh = Number(normalized.gridH) || 0;
  const values = Array.isArray(normalized.gridValues) ? normalized.gridValues : [];
  const coverage = Array.isArray(normalized.gridCoverage) ? normalized.gridCoverage : [];
  if (gw < 2 || gh < 2 || values.length !== gw * gh || coverage.length !== gw * gh) return null;
  return { gw, gh, values, coverage };
}

function residualRgb(value, min, max) {
  const span = Math.max(Math.abs(min), Math.abs(max), 1e-6);
  const t = Math.max(-1, Math.min(1, value / span));
  if (t >= 0) return [255, Math.round(235 - 150 * t), Math.round(235 - 235 * t)];
  const a = -t;
  return [Math.round(235 - 235 * a), Math.round(235 - 150 * a), 255];
}

function buildLegacyGridTexture(result, grid) {
  const data = new Uint8Array(grid.values.length * 4);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < grid.values.length; i++) {
    if (grid.coverage[i] > 0 && Number.isFinite(grid.values[i])) {
      min = Math.min(min, grid.values[i]);
      max = Math.max(max, grid.values[i]);
    }
  }
  if (!Number.isFinite(min)) min = -1;
  if (!Number.isFinite(max)) max = 1;
  for (let i = 0; i < grid.values.length; i++) {
    const off = i * 4;
    if (grid.coverage[i] <= 0 || !Number.isFinite(grid.values[i])) continue;
    const [r, g, b] = residualRgb(grid.values[i], min, max);
    const alpha = Math.min(225, 90 + Math.min(135, grid.coverage[i] * 30));
    data[off] = r;
    data[off + 1] = g;
    data[off + 2] = b;
    data[off + 3] = alpha;
  }
  const texture = new THREE.DataTexture(data, grid.gw, grid.gh, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  // Plan convention: polygon/contour satırı 0, dünya Z=-depth/2 kenarıdır.
  // PlaneGeometry.rotateX(-PI/2) UV eksenini ters çevirdiği için texture'ı
  // çevirmek gerekir; aksi halde 2D kontur ile 3D grid dikey eksende aynalanır.
  texture.userData = { min, max, measuredCells: grid.coverage.filter((n) => n > 0).length, planYFlipped: true };
  return texture;
}

function addLegacyGridTemplate(group, result, xMeters, zMeters, originX, originZ) {
  const normalized = normalizeLegacyResult(result);
  const rows = Number(normalized.matrixRows);
  const cols = Number(normalized.matrixCols);
  if (!(rows > 0 && cols > 0)) return null;
  const template = buildLegacyGridTemplate({
    rows,
    cols,
    widthM: xMeters,
    depthM: zMeters,
    originXM: originX,
    originYM: originZ,
    scanSteps: normalized.scanSteps,
    numberingDirection: state.legacyStepNumberingDirection,
  });
  if (!template) return null;

  const layer = new THREE.Group();
  layer.name = "legacyScanGridTemplate";
  layer.userData.legacyScanGridTemplate = true;
  layer.userData.template = template;
  template.cells.forEach((cell) => {
    const centerX = cell.centerXM - (originX + xMeters * 0.5);
    const centerZ = cell.centerYM - (originZ + zMeters * 0.5);
    const material = new THREE.MeshBasicMaterial({
      color: cell.direction === "return" ? 0x79b7d9 : 0x8fe3ae,
      transparent: true,
      opacity: 0.035,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    material.userData.votexBaseOpacity = material.opacity;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(cell.widthM, cell.heightM), material);
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(centerX, 0.075, centerZ);
    fill.userData.legacyGridCell = true;
    fill.userData.legacyStepIndex = cell.stepIndex;
    fill.userData.scanStepIndex = cell.stepIndex;
    fill.userData.legacyScanDirection = cell.direction;
    fill.userData.legacyVisualRole = "guide";

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: cell.direction === "return" ? 0x79b7d9 : 0x8fe3ae,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    edgeMaterial.userData.votexBaseOpacity = edgeMaterial.opacity;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(cell.widthM, cell.heightM)), edgeMaterial);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(centerX, 0.085, centerZ);
    edge.userData.legacyGridCell = true;
    edge.userData.legacyStepIndex = cell.stepIndex;
    edge.userData.scanStepIndex = cell.stepIndex;
    edge.userData.legacyScanDirection = cell.direction;
    edge.userData.legacyVisualRole = "guide";
    layer.add(fill, edge);

    const label = makeMeterLabel(`Adım ${cell.stepIndex}`, cell.direction === "return" ? "#b9e5ff" : "#c5ffd5");
    label.scale.set(0.48, 0.13, 1);
    label.position.set(centerX, 0.18, centerZ);
    label.userData.legacyGridCell = true;
    label.userData.scanStepIndex = cell.stepIndex;
    label.userData.legacyStepIndex = cell.stepIndex;
    label.userData.legacyScanStepLabel = true;
    label.userData.legacyScanDirection = cell.direction;
    layer.add(label);
  });
  group.add(layer);
  group.userData.legacyGridTemplate = template;
  return layer;
}

function addScanStepRuler(group, result, xMeters, zMeters, originX, originZ) {
  const normalized = normalizeLegacyResult(result);
  const steps = Array.isArray(normalized.scanSteps) ? normalized.scanSteps : [];
  if (!steps.length) return null;

  const toWorld = (step) => new THREE.Vector3(
    Number(step.xCenterM) - (originX + xMeters * 0.5),
    0.09,
    Number(step.yCenterM) - (originZ + zMeters * 0.5),
  );
  const points = steps.map(toWorld);
  const ruler = new THREE.Group();
  ruler.name = "legacyScanStepRuler";
  ruler.userData.scanSteps = steps;
  ruler.userData.averageSpacingM = Number(normalized.scanStepSpacingM) || 0;
  ruler.userData.legacyScanStepsVisible = true;

  if (points.length > 1) {
    // Serpantin yol: sütun içi kısa bağlar; sütunlar arası uzun atlama çizilmez.
    const spacings = [];
    for (let i = 1; i < points.length; i += 1) {
      spacings.push(points[i].distanceTo(points[i - 1]));
    }
    const sortedSp = [...spacings].sort((a, b) => a - b);
    const medianSp = sortedSp[Math.floor(sortedSp.length / 2)] || 0;
    const jumpLimit = Math.max(1.2, medianSp * 1.2);

    let segment = [points[0]];
    const flushSegment = () => {
      if (segment.length < 2) {
        segment = [];
        return;
      }
      const path = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(segment),
        new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85, depthWrite: false }),
      );
      path.name = "legacyScanStepPath";
      path.userData.scanStepPath = true;
      path.userData.legacyScanStepPath = true;
      path.renderOrder = 70;
      ruler.add(path);
      segment = [];
    };

    for (let i = 1; i < points.length; i += 1) {
      const d = points[i].distanceTo(points[i - 1]);
      if (d > jumpLimit) {
        flushSegment();
        segment = [points[i]];
      } else {
        segment.push(points[i]);
      }
    }
    flushSegment();
  }

  steps.forEach((step, index) => {
    const point = points[index];
    const stepIndex = Number(step.index) || index + 1;
    const marker = new THREE.Group();
    marker.userData.scanStepIndex = stepIndex;
    marker.userData.legacyStepIndex = stepIndex;

    // Yüzey halkası
    const tick = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.22, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffd166,
        transparent: true,
        opacity: 0.98,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    tick.rotation.x = -Math.PI / 2;
    tick.position.copy(point);
    tick.position.y = 0.12;
    tick.userData.scanStepIndex = stepIndex;
    tick.userData.legacyStepIndex = stepIndex;
    marker.add(tick);

    // Kısa dikey sap — 3D’de adım konumu okunur
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.55, 10),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    stem.position.set(point.x, -0.15, point.z);
    stem.userData.scanStepIndex = stepIndex;
    stem.userData.legacyStepIndex = stepIndex;
    marker.add(stem);

    // Etiket halkanın hemen üstünde — yan offset yanlış adım algısı yaratıyordu.
    const label = makeMeterLabel(`Adım ${stepIndex}`, "#ffe29a");
    label.scale.set(0.58, 0.15, 1);
    label.position.set(point.x, 0.32, point.z);
    label.userData.scanStepIndex = stepIndex;
    label.userData.legacyStepIndex = stepIndex;
    label.userData.legacyScanStepLabel = true;
    marker.add(label);
    ruler.add(marker);
  });

  const average = Number(result.scanStepSpacingM ?? result.scan_step_spacing_m) || 0;
  const title = makeMeterLabel(
    average > 0 ? `Yatay tarama · ${steps.length} adım · ort. ${average.toFixed(2)} m` : `Yatay tarama · ${steps.length} adım`,
    "#ffe29a",
  );
  title.scale.set(1.35, 0.2, 1);
  title.position.set(0, 0.32, zMeters * 0.5 + 0.35);
  title.userData.legacyScanStepTitle = true;
  ruler.add(title);
  group.add(ruler);
  group.userData.scanStepRuler = ruler;
  return ruler;
}

function addLegacyMeasuredGrid(group, result, xMeters, zMeters) {
  const grid = finiteGrid(result);
  if (!grid) return null;
  const texture = buildLegacyGridTexture(result, grid);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(xMeters, zMeters).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = "legacyMeasuredMagneticGrid";
  mesh.position.y = 0.035;
  mesh.renderOrder = 3;
  mesh.userData.coverage = grid.coverage;
  mesh.userData.measuredCells = texture.userData.measuredCells;
  mesh.userData.mapTexture = texture;
  group.add(mesh);

  const levels = getMagneticContourLevels(grid.values, grid.coverage, 8);
  const positions = computeMagneticContourSegments(grid.values, grid.coverage, grid.gw, xMeters, zMeters, levels);
  const contourGeometry = new THREE.BufferGeometry();
  contourGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const contours = new THREE.LineSegments(contourGeometry, new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  }));
  contours.name = "legacyMagneticContours";
  contours.position.y = 0.055;
  contours.renderOrder = 4;
  contours.userData.contourLevels = levels;
  group.add(contours);
  group.userData.grid = mesh;
  group.userData.contours = contours;
  group.userData.gridValues = grid.values;
  group.userData.gridCoverage = grid.coverage;
  group.userData.contourLevels = levels;
  return mesh;
}

/** Basit metre etiketi (Sprite) — ince, küçük punto. */
function makeMeterLabel(text, color = "#9ab0c0") {
  const fontSize = 24;
  const canvas = document.createElement("canvas");
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = `400 ${fontSize}px Segoe UI, sans-serif`;
  const textW = Math.ceil(measure.measureText(String(text)).width);
  const width = Math.max(48, textW + 10);
  const height = fontSize + 8;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.font = `400 ${fontSize}px Segoe UI, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(String(text), 5, height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(Math.max(0.55, width / 220), 0.2, 1);
  spr.renderOrder = 998;
  return spr;
}

function geometrySourceLabelOf(shape) {
  const source = String(shape?.shapeSource ?? "inferred").toLowerCase();
  const polygon = Array.isArray(shape?.polygon) && shape.polygon.length >= 3;
  if (polygon && (source === "grid-contour" || shapeTypeOf(shape) === "polygon" || shapeTypeOf(shape) === "irregular")) {
    return "Geometri: ölçülmüş kontur";
  }
  if (source === "signal-only" || source === "signal_only") return "Geometri: yalnız manyetik sinyal";
  return "Geometri: tahmini şekil";
}

/**
 * 3D obje etiketlerinde fiziksel ölçüleri birim adıyla açıkça göster.
 * Özellikle derinlik tek bir sayı gibi okunmasın: üst–alt aralığı ve merkez
 * derinliği ayrı yazılır; plan koordinatları da metre olarak belirtilir.
 */
export function formatLegacyObjectLabel(shape, rank, interval, primary = false) {
  const numberText = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "—";
  const width = Number(shape.widthM ?? (Number(shape.rx) * 2));
  const length = Number(shape.lengthM ?? (Number(shape.ry) * 2));
  const top = Number(shape.depthTopM);
  const bottom = Number(shape.depthBottomM);
  const height = Number.isFinite(top) && Number.isFinite(bottom) && bottom > top ? bottom - top : NaN;
  const kindText = String(shape.kind || "").toLowerCase() === "metal" ? "Metal" : shapeLabelOf(shape);
  const title = primary ? `Önemli bulgu #${rank} · ${kindText}` : `Bulgu #${rank} · ${kindText}`;
  const depth = `Ne kadar derin: ${numberText(interval.low)}–${numberText(interval.high)} m (orta ${numberText(interval.center)} m)`;
  const position = `Haritada nerede: X ${numberText(shape.cx)} m · Y ${numberText(shape.cy)} m`;
  const dimensions = `Yaklaşık boyut: ${numberText(width)} × ${numberText(length)} × ${numberText(height)} m`;
  const confRaw = Number(shape.confidence);
  const conf = Math.round((Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : shapeConfidenceOf(shape)) * 100);
  const confWord = conf >= 70 ? "yüksek" : conf >= 45 ? "orta" : "düşük";
  const strength = strengthOf(shape);
  const strengthWord = strength >= 3 ? "çok belirgin" : strength >= 1.5 ? "belirgin" : "zayıf";
  const sigmaText = strength > 0 ? `${strength.toFixed(1)}σ` : "—";
  const quality = `Ne kadar net: ${strengthWord} · güven ${confWord} (%${conf}) · ${sigmaText}`;
  const mag = magneticResponseOf(shape);
  const magnetic = `Manyetik tepki: ${mag.label}`;
  const geometry = geometrySourceLabelOf(shape);
  return { title, depth, position, dimensions, quality, magnetic, geometry, magDisclaimer: mag.disclaimer };
}

function makeRankedAnomalyLabel(shape, rank, interval, primary) {
  // Kenar boşluğu minimum; yazı punto aynı kalır, kart yazıya sıkı sığar.
  const padX = 14;
  const padY = 6;
  const lineGap = primary ? 22 : 20;
  const titleSize = primary ? 30 : 23;
  const bodySize = primary ? 18 : 16;
  const magSize = primary ? 16 : 14;
  const noteSize = primary ? 13 : 12;
  const lines = 8;
  const label = formatLegacyObjectLabel(shape, rank, interval, primary);
  const measure = document.createElement("canvas").getContext("2d");
  const measureLine = (text, size, bold = false) => {
    measure.font = `${bold ? "bold " : ""}${size}px Segoe UI, sans-serif`;
    return Math.ceil(measure.measureText(String(text)).width);
  };
  const contentW = Math.max(
    measureLine(label.title, titleSize, true),
    measureLine(label.depth, bodySize),
    measureLine(label.position, bodySize),
    measureLine(label.dimensions, bodySize),
    measureLine(label.quality, bodySize),
    measureLine(label.geometry, bodySize),
    measureLine(label.magnetic, magSize),
    measureLine(label.magDisclaimer, noteSize),
  );
  const width = Math.max(primary ? 420 : 360, contentW + padX * 2);
  const height = padY * 2 + titleSize + lineGap * (lines - 1) + 4;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  const color = depthFitColor(interval.fitError);
  const colorHex = `#${color.toString(16).padStart(6, "0")}`;
  ctx.fillStyle = primary ? "rgba(56, 10, 10, 0.94)" : "rgba(8, 16, 20, 0.9)";
  roundRect(ctx, 1, 1, width - 2, height - 2, primary ? 8 : 6);
  ctx.fill();
  ctx.strokeStyle = primary ? "#ff4646" : colorHex;
  ctx.lineWidth = primary ? 3 : 2;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let y = padY + titleSize * 0.55;
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${titleSize}px Segoe UI, sans-serif`;
  ctx.fillText(label.title, width / 2, y);
  y += lineGap;
  ctx.fillStyle = primary ? "#ffffff" : colorHex;
  ctx.font = `${bodySize}px Segoe UI, sans-serif`;
  ctx.fillText(label.depth, width / 2, y);
  y += lineGap;
  ctx.fillText(label.position, width / 2, y);
  y += lineGap;
  ctx.fillText(label.dimensions, width / 2, y);
  y += lineGap;
  ctx.fillText(label.quality, width / 2, y);
  y += lineGap;
  ctx.fillStyle = "#f4c875";
  ctx.font = `${bodySize}px Segoe UI, sans-serif`;
  ctx.fillText(label.geometry, width / 2, y);
  y += lineGap;
  ctx.fillStyle = "#9ad4ff";
  ctx.font = `${magSize}px Segoe UI, sans-serif`;
  ctx.fillText(label.magnetic, width / 2, y);
  y += lineGap * 0.95;
  ctx.fillStyle = "rgba(180,200,210,0.85)";
  ctx.font = `${noteSize}px Segoe UI, sans-serif`;
  ctx.fillText(label.magDisclaimer, width / 2, y);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(mat);
  // Dünya ölçeği: yazı punto canvas’ta aynı; genişlik içeriğe göre (kenar boşluğu yok).
  const worldW = (width / (primary ? 178 : 195)) * (primary ? 1.0 : 0.92);
  sprite.scale.set(worldW, primary ? (height / 178) * 1.02 : (height / 156) * 0.78, 1);
  sprite.renderOrder = primary ? 1102 : 1095;
  sprite.userData.legacyRankLabel = true;
  sprite.userData.legacyPrimary = primary;
  return sprite;
}

/**
 * 0 m (yüzey) → dinamik taban 3D harita kutusu + metre katmanları
 */
function addDepthMapFrame(group, xMeters, zMeters, depthMax = DEPTH_MAX_M) {
  const hw = xMeters / 2;
  const hd = zMeters / 2;
  const deep = Math.max(1, Number(depthMax) || DEPTH_MAX_M);

  // Yüzey 0 m
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(xMeters, zMeters),
    new THREE.MeshStandardMaterial({
      color: 0x1a2228,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0;
  group.add(surface);

  const surfaceEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(xMeters, zMeters)),
    new THREE.LineBasicMaterial({ color: 0xa8c0d0, transparent: true, opacity: 0.85 })
  );
  surfaceEdge.rotation.x = -Math.PI / 2;
  surfaceEdge.position.y = 0.01;
  group.add(surfaceEdge);

  // Taban 10 m
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(xMeters, zMeters),
    new THREE.MeshStandardMaterial({
      color: 0x0c1014,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -deep;
  group.add(floor);

  // Dikey köşe direkleri
  const cornerMat = new THREE.LineBasicMaterial({ color: 0x5a7080, transparent: true, opacity: 0.7 });
  const corners = [
    [-hw, -hd],
    [hw, -hd],
    [-hw, hd],
    [hw, hd],
  ];
  for (const [x, z] of corners) {
    const pts = [new THREE.Vector3(x, 0, z), new THREE.Vector3(x, -deep, z)];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cornerMat));
  }

  // Sol kenarda 0 → 10 m dikey ölçü cetveli. Metre işaretleri
  // yarı şeffaf; santimetre işaretleri daha ince, farklı renkli ve noktalıdır.
  const rulerX = -hw - 0.16;
  const rulerZ = -hd - 0.08;
  const rulerGroup = new THREE.Group();
  rulerGroup.name = "legacyDepthRuler";
  rulerGroup.userData.depthRuler = true;

  const rulerLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(rulerX, 0.02, rulerZ),
      new THREE.Vector3(rulerX, -deep - 0.02, rulerZ),
    ]),
    new THREE.LineBasicMaterial({ color: 0x9bdcff, transparent: true, opacity: 0.72, depthWrite: false })
  );
  rulerGroup.add(rulerLine);

  const meterTickPositions = [];
  const centimeterTickPositions = [];
  const centimeterDots = [];
  const centimeters = Math.round(deep * 100);
  for (let cm = 0; cm <= centimeters; cm += 1) {
    const y = -(cm / 100);
    const isMeter = cm % 100 === 0;
    const isDecimeter = cm % 10 === 0;
    const tickLength = isMeter ? 0.42 : isDecimeter ? 0.25 : 0.13;
    const target = isMeter ? meterTickPositions : centimeterTickPositions;
    target.push(rulerX, y, rulerZ, rulerX + tickLength, y, rulerZ);
    if (!isMeter) centimeterDots.push(rulerX - 0.015, y, rulerZ);
  }

  const meterTicks = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(meterTickPositions, 3)),
    new THREE.LineBasicMaterial({ color: 0xb9e7ff, transparent: true, opacity: 0.82, depthWrite: false })
  );
  rulerGroup.add(meterTicks);

  const centimeterTicks = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(centimeterTickPositions, 3)),
    new THREE.LineBasicMaterial({ color: 0xf08cff, transparent: true, opacity: 0.42, depthWrite: false })
  );
  rulerGroup.add(centimeterTicks);

  const centimeterDotMaterial = new THREE.PointsMaterial({
    color: 0xff8fe5,
    size: 0.045,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const centimeterDotGeometry = new THREE.BufferGeometry();
  centimeterDotGeometry.setAttribute("position", new THREE.Float32BufferAttribute(centimeterDots, 3));
  rulerGroup.add(new THREE.Points(centimeterDotGeometry, centimeterDotMaterial));
  group.add(rulerGroup);

  // Her 1 m yatay derinlik düzlemi + etiket (sol kenar)
  const labelX = -hw - 0.15;
  const labelZ = -hd;
  for (let d = 0; d <= deep; d += 1) {
    const y = -d;
    const isMajor = d % 2 === 0;
    const plane = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(xMeters, zMeters)),
      new THREE.LineBasicMaterial({
        color: d === 0 ? 0xc8dce8 : isMajor ? 0x4a6070 : 0x2a3840,
        transparent: true,
        opacity: d === 0 ? 0.9 : isMajor ? 0.45 : 0.22,
      })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = y;
    group.add(plane);

    const lbl = makeMeterLabel(`${d} m`, d === 0 ? "#d0e4f0" : "#7a90a0");
    lbl.position.set(labelX - 0.6, y, labelZ);
    group.add(lbl);
  }

  // "0 m / 10 m" başlık
  const title = makeMeterLabel(`0 → ${deep.toFixed(1)} m harita`, "#b8d0e0");
  title.scale.set(2.2, 0.4, 1);
  title.position.set(0, 0.45, hd + 0.3);
  group.add(title);
}

/**
 * Yapıyı gerçek metre kotuna koy (örtü…taban, dinamik max derinlik).
 */
function drawAnomalyAtDepth(group, shape, ox, oz, num, maxDepth, mapWidth, mapDepth, rank = 1, primary = false) {
  const cx = Number(shape.cx) - ox;
  const cz = Number(shape.cy) - oz;
  const topM = depthTopOf(shape, maxDepth);
  const botM = depthBotOf(shape, maxDepth);
  const depthHeight = Math.max(botM - topM, 0.2);
  const rx = Math.max(0.12, Math.min(Number(shape.rx) || 0.35, 6));
  const ry = Math.max(0.12, Math.min(Number(shape.ry) || rx, 6));
  const dimensions = dimensionsOf(shape, { width: rx * 2, length: ry * 2, height: depthHeight });
  const height = Math.max(dimensions.height || depthHeight, 0.2);
  const volumeM3 = volumeM3Of(shape, { mapWidthM: mapWidth, mapDepthM: mapDepth, height });
  const positive = Number(shape.polarity) >= 0;
  const kind = String(shape.kind || "anomaly").toLowerCase();
  const color = kind === "tunnel" ? 0xd09a4a : positive ? 0xe06a3b : 0x4f9dcc;
  const opacity = Math.min(0.64, Math.max(0.18, 0.22 + (Number(shape.confidence) || 0.35) * 0.42));
  const id = `legacy-dik-shape-${rank}`;
  const fit = createShapeGeometry(shape, rx, ry, height, mapWidth, mapDepth, true, cx, cz);
  const geometry = fit.geometry;
  const rotationY = fit.rotationY;
  const measuredCenter = fit.measured ? fit.center : { x: cx, z: cz };
  // Ölçülmüş geometri, aynı yerel plan koordinatında üretildiği için mesh
  // konumu ile projeksiyon konumu ayrıştırılır; ikisi de aynı ankraja bakar.
  const polygon = Array.isArray(shape.polygon) ? shape.polygon : [];
  const measuredPolygonAnchorX = fit.measured && polygonCoordinateSpaceOf(shape, polygon) === "meters" ? cx : null;
  const measuredPolygonAnchorZ = fit.measured && polygonCoordinateSpaceOf(shape, polygon) === "meters" ? cz : null;
  const projectionAnchorX = fit.measured ? measuredPolygonAnchorX : null;
  const projectionAnchorZ = fit.measured ? measuredPolygonAnchorZ : null;
  const projectionPositionX = fit.measured ? 0 : cx;
  const projectionPositionZ = fit.measured ? 0 : cz;
  const anchorX = projectionPositionX;
  const anchorZ = projectionPositionZ;
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: positive ? 0.12 : 0.04,
    transparent: true,
    opacity,
    depthWrite: false,
    roughness: 0.72,
    metalness: kind === "metal" ? 0.35 : 0.04,
    side: THREE.DoubleSide,
  }));
  mesh.position.set(
    fit.measured ? measuredCenter.x : cx,
    fit.measured ? -topM : -(topM + height * 0.5),
    fit.measured ? measuredCenter.z : cz,
  );
  mesh.rotation.y = rotationY;
  mesh.userData.focusId = id;
  mesh.userData.legacyShape = shape;
  mesh.userData.legacyAnomaly = true;
  group.add(mesh);
  const edgeMaterial = fit.measured || shapeSourceOf(shape) === "grid-contour"
    ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: Math.min(0.95, opacity + 0.2) })
    : new THREE.LineDashedMaterial({ color, transparent: true, opacity: Math.min(0.95, opacity + 0.2), dashSize: 0.12, gapSize: 0.08 });
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
  edge.position.copy(mesh.position);
  edge.rotation.copy(mesh.rotation);
  if (edgeMaterial.isLineDashedMaterial) edge.computeLineDistances();
  edge.userData.focusId = id;
  edge.userData.legacyShapeOutline = true;
  group.add(edge);

  const footprintType = shapeTypeOf(shape);
  // Zemin dolumu: marching-squares ölçüm kontürünün kapladığı alanı haritada
  // görünür kılar (2D kalite doğrulaması için).
  const fill = createFootprintFill(shape, rx, ry, mapWidth, mapDepth, color, 0.15, null, projectionAnchorX, projectionAnchorZ);
  if (fill) {
    fill.position.set(projectionPositionX, 0.03, projectionPositionZ);
    fill.renderOrder = 2;
    fill.userData.focusId = id;
    fill.userData.legacyProjection = true;
    fill.userData.contourLevel = "fill";
    group.add(fill);
  }
  const projection = createFootprintOutline(shape, rx, ry, mapWidth, mapDepth, color, 0.78, null, projectionAnchorX, projectionAnchorZ);
  if (projection) {
    projection.position.set(projectionPositionX, 0.035, projectionPositionZ);
    projection.userData.focusId = id;
    projection.userData.legacyProjection = true;
    projection.userData.contourLevel = "outer";
    group.add(projection);
  }
  const corePolygon = Array.isArray(shape.corePolygon)
    ? shape.corePolygon
    : (Array.isArray(shape.core_polygon) ? shape.core_polygon : []);
  const coreOutline = createFootprintOutline(shape, rx, ry, mapWidth, mapDepth, color, 0.96, corePolygon, projectionAnchorX, projectionAnchorZ);
  if (coreOutline) {
    coreOutline.position.set(projectionPositionX, -topM + 0.04, projectionPositionZ);
    coreOutline.scale.set(0.98, 1, 0.98);
    coreOutline.userData.focusId = id;
    coreOutline.userData.legacyProjection = true;
    coreOutline.userData.contourLevel = "core";
    group.add(coreOutline);
  }

  const guide = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(measuredCenter.x, 0.02, measuredCenter.z), new THREE.Vector3(measuredCenter.x, -topM, measuredCenter.z)]),
    new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.65 }),
  );
  guide.computeLineDistances();
  guide.userData.focusId = id;
  guide.userData.legacyProjection = true;
  group.add(guide);
  drawDepthUncertainty(group, shape, measuredCenter.x, measuredCenter.z, dimensions.width * 0.5, dimensions.length * 0.5, num, maxDepth, id, rank, primary);
  if (state.structureTargets) {
    const previous = state.structureTargets[id] || {};
    state.structureTargets[id] = {
      ...previous,
      position: new THREE.Vector3(measuredCenter.x, -(topM + botM) / 2, measuredCenter.z),
      object: mesh,
      radius: Math.max(dimensions.width, dimensions.length) * 0.65,
      title: shape.label || `Anomali ${num}`,
      depthM: topM,
      dimensions,
      volumeM3,
      detailLabel: previous.detailLabel || null,
      badge: previous.badge || null,
    };
  }
}

function drawMetalAtDepth(group, shape, ox, oz, num, maxDepth = DEPTH_MAX_M, mapWidth = 4, mapDepth = 5, rank = 1, primary = false) {
  const cx = Number(shape.cx) - ox;
  const cz = Number(shape.cy) - oz;
  const strength = Math.max(strengthOf(shape), 0.5);
  const sNorm = Math.min(strength / 3.2, 1.5);

  // Gerçek ölçüler kullanılır; yalnızca eksikse rx/ry tahminine düşülür.
  const topM = depthTopOf(shape, maxDepth);
  const botM = depthBotOf(shape, maxDepth);
  const depthHeight = Math.max(botM - topM, 0.2);
  let r0 = Number(shape.rx);
  if (!Number.isFinite(r0) || r0 <= 0) r0 = Number(shape.ry) || 0.2;
  r0 = Math.max(Math.min(r0, 1.2), 0.08);
  const dimensions = dimensionsOf(shape, { width: r0 * 2, length: r0 * 2, height: depthHeight });
  const h = Math.max(dimensions.height || depthHeight, 0.2);
  const volumeM3 = volumeM3Of(shape, { mapWidthM: mapWidth, mapDepthM: mapDepth, height: h });
  const rTop = Math.max(dimensions.width * 0.5, 0.04);
  const rMid = rTop * 0.72;
  const rBot = rTop * 0.38;
  const midY = -(topM + botM) / 2;

  const col = 0xd44a38;
  const id = `legacy-dik-shape-${rank}`;
  const fitted = createShapeGeometry(shape, dimensions.width * 0.5, dimensions.length * 0.5, h, mapWidth, mapDepth, true, cx, cz);
  const measuredCenter = fitted.measured ? fitted.center : { x: cx, z: cz };

  const profile = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(rTop, 0),
    new THREE.Vector2(rMid, h * 0.45),
    new THREE.Vector2(rBot, h * 0.95),
    new THREE.Vector2(0.001, h),
  ];
  const lathe = fitted.measured ? null : new THREE.LatheGeometry(profile, 36);
  if (lathe) {
    lathe.scale(1, -1, 1);
    lathe.scale.z = dimensions.length / Math.max(dimensions.width, 0.01);
  }
  const body = new THREE.Mesh(
    fitted.measured ? fitted.geometry : lathe,
    new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 0.22 + 0.2 * Math.min(sNorm, 1),
      transparent: true,
      opacity: 0.7,
      metalness: 0.5,
      roughness: 0.3,
      side: THREE.DoubleSide,
    })
  );
  // Üst yüzey tam örtü kotunda (−topM)
  body.position.set(
    fitted.measured ? measuredCenter.x : cx,
    fitted.measured ? -topM : -topM,
    fitted.measured ? measuredCenter.z : cz,
  );
  body.rotation.y = fitted.rotationY;
  body.userData.focusId = id;
  body.userData.legacyShape = shape;
  group.add(body);

  const coreH = h * 0.65;
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop * 0.35, rTop * 0.2, coreH, 20, 1),
    new THREE.MeshStandardMaterial({
      color: 0xff6644,
      emissive: 0xff4422,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.88,
      metalness: 0.55,
      roughness: 0.25,
    })
  );
  core.position.set(
    fitted.measured ? measuredCenter.x : cx,
    -(topM + coreH * 0.5),
    fitted.measured ? measuredCenter.z : cz,
  );
  core.userData.focusId = id;
  core.userData.legacyShape = shape;
  group.add(core);

  // Yüzey projeksiyonu (0 m) — ölçüm kontürü (marching-squares) varsa gerçek
  // ayak izi dolumu + kontür çizgisi; yoksa daire yaklaşımı.
  const measuredPolygonAnchorX = fitted.measured && polygonCoordinateSpaceOf(shape, shape.polygon) === "meters" ? cx : null;
  const measuredPolygonAnchorZ = fitted.measured && polygonCoordinateSpaceOf(shape, shape.polygon) === "meters" ? cz : null;
  const projectionAnchorX = fitted.measured ? measuredPolygonAnchorX : null;
  const projectionAnchorZ = fitted.measured ? measuredPolygonAnchorZ : null;
  const projectionPositionX = fitted.measured ? 0 : cx;
  const projectionPositionZ = fitted.measured ? 0 : cz;
  const anchorX = projectionPositionX;
  const anchorZ = projectionPositionZ;
  const disc = createFootprintFill(shape, r0, r0, mapWidth, mapDepth, 0xff8866, 0.22, null, projectionAnchorX, projectionAnchorZ);
  if (disc) {
    disc.position.set(projectionPositionX, 0.03, projectionPositionZ);
    disc.renderOrder = 2;
    disc.userData.focusId = id;
    disc.userData.legacyProjection = true;
    group.add(disc);
  } else {
    const disc0 = new THREE.Mesh(
      new THREE.CircleGeometry(rTop, 40),
      new THREE.MeshBasicMaterial({
        color: 0xff8866,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    disc0.rotation.x = -Math.PI / 2;
    disc0.position.set(anchorX, 0.02, anchorZ);
    disc0.userData.focusId = id;
    group.add(disc0);
  }
  const groundContour = createFootprintOutline(shape, r0, r0, mapWidth, mapDepth, 0xffaa88, 0.9, null, projectionAnchorX, projectionAnchorZ);
  if (groundContour) {
    groundContour.position.set(projectionPositionX, 0.045, projectionPositionZ);
    groundContour.userData.focusId = id;
    groundContour.userData.legacyProjection = true;
    groundContour.userData.contourLevel = "outer";
    group.add(groundContour);
  }

  // Örtü kotu halkası
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(rTop * 0.9, rTop * 1.08, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffaa88,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(fitted.measured ? measuredCenter.x : anchorX, -topM + 0.02, fitted.measured ? measuredCenter.z : anchorZ);
  rim.userData.focusId = id;
  group.add(rim);

  // Dikey referans: 0 m → örtü
  const drop = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(fitted.measured ? measuredCenter.x : anchorX, 0, fitted.measured ? measuredCenter.z : anchorZ),
      new THREE.Vector3(fitted.measured ? measuredCenter.x : anchorX, -topM, fitted.measured ? measuredCenter.z : anchorZ),
    ]),
    new THREE.LineDashedMaterial({
      color: 0x88aacc,
      dashSize: 0.12,
      gapSize: 0.08,
      transparent: true,
      opacity: 0.75,
    })
  );
  drop.computeLineDistances();
  drop.userData.focusId = id;
  group.add(drop);

  // Rozet + detay kartı drawDepthUncertainty içinde tek kez üretilir.
  drawDepthUncertainty(group, shape, measuredCenter.x, measuredCenter.z, dimensions.width * 0.5, dimensions.length * 0.5, num, maxDepth, id, rank, primary);

  if (state.structureTargets) {
    const previous = state.structureTargets[id] || {};
    state.structureTargets[id] = {
      ...previous,
      position: new THREE.Vector3(measuredCenter.x, -(topM + botM) / 2, measuredCenter.z),
      object: body,
      dimensions,
      volumeM3,
      radius: Math.max(dimensions.width, dimensions.length) * 0.65,
      title: shape.label || "Metal",
      depthM: topM,
      detailLabel: previous.detailLabel || null,
      badge: previous.badge || null,
    };
  }
}

function addInvertProxyLayer(group, normalized, mapWidth, mapDepth, originX, originZ, fieldModel = null) {
  const linked = linkInvertProxiesToDetections(
    Array.isArray(normalized?.invertProxies) ? normalized.invertProxies : [],
    fieldModel?.detections,
  );
  const layer = new THREE.Group();
  layer.name = "legacyInvertProxy";
  layer.userData.legacyInvertProxy = true;
  layer.visible = !!state.legacyInvertProxyVisible;

  const ox = originX + mapWidth / 2;
  const oz = originZ + mapDepth / 2;

  linked.forEach((proxy, index) => {
    const poly = Array.isArray(proxy.polygon) ? proxy.polygon : [];
    if (poly.length < 3) return;
    const world = polygonToWorldPoints(poly, mapWidth, mapDepth);
    if (world.length < 3) return;

    const detectionId = proxy.detectionId || null;
    const bundle = new THREE.Group();
    bundle.name = `legacyInvertProxy-${index + 1}`;
    bundle.userData.legacyInvertProxy = true;
    bundle.userData.legacyDetectionId = detectionId;
    bundle.userData.invertProxy = proxy;

    const tag = (object) => {
      object.userData.legacyInvertProxy = true;
      object.userData.legacyDetectionId = detectionId;
      return object;
    };

    const groundPts = world.map(([x, z]) => new THREE.Vector3(x, 0.02, z));
    const groundLoop = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(groundPts),
      new THREE.LineDashedMaterial({
        color: 0x5ec8ff,
        transparent: true,
        opacity: 0.95,
        dashSize: 0.14,
        gapSize: 0.09,
        depthWrite: false,
      }),
    );
    groundLoop.computeLineDistances();
    groundLoop.userData.inferredGeometry = true;
    bundle.add(tag(groundLoop));

    const depth = Math.max(0.2, Number(proxy.depthM) || 1);
    const misfit = Math.max(0, Number(proxy.misfitRms) || 0);
    const halfBand = Math.min(
      Math.max(0.25 + misfit * depth, 0.2),
      depth * 0.45,
    );
    const zLow = Math.max(0.12, depth - halfBand);
    const zHigh = depth + halfBand;

    const addDepthLoop = (y, color, opacity) => {
      const pts = world.map(([x, z]) => new THREE.Vector3(x, -y, z));
      const loop = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({
          color,
          transparent: true,
          opacity,
          dashSize: 0.1,
          gapSize: 0.08,
          depthWrite: false,
        }),
      );
      loop.computeLineDistances();
      bundle.add(tag(loop));
    };
    addDepthLoop(depth, 0x8fd3ff, 0.75);
    addDepthLoop(zLow, 0x5ec8ff, 0.45);
    addDepthLoop(zHigh, 0x5ec8ff, 0.45);

    const cx = Number(proxy.cx) - ox;
    const cz = Number(proxy.cy) - oz;
    if (Number.isFinite(cx) && Number.isFinite(cz)) {
      const stemLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(cx, 0.02, cz),
          new THREE.Vector3(cx, -zHigh, cz),
        ]),
        new THREE.LineBasicMaterial({ color: 0x5ec8ff, transparent: true, opacity: 0.55, depthWrite: false }),
      );
      bundle.add(tag(stemLine));
    }

    const badge = makeBadgeSprite(index + 1, "#5ec8ff");
    if (badge) {
      badge.position.set(
        Number.isFinite(cx) ? cx : world[0][0],
        0.35,
        Number.isFinite(cz) ? cz : world[0][1],
      );
      badge.userData.isBadge = true;
      badge.userData.title = `Invert proxy · z ${depth.toFixed(2)} m (±${halfBand.toFixed(2)}) · misfit ${misfit.toFixed(2)}`;
      bundle.add(tag(badge));
    }

    layer.add(bundle);
  });

  group.add(layer);
  group.userData.hasInvertProxy = linked.length > 0;
  group.userData.invertProxies = linked;
  applyInvertProxySelection(selectedDetectionOf(state.legacyTargetSession));
  return layer;
}

export function applyInvertProxySelection(detectionId = selectedDetectionOf(state.legacyTargetSession)) {
  const group = state.legacyDikGroup;
  const layer = group?.getObjectByName("legacyInvertProxy");
  if (!layer) return;
  const selected = detectionId ? String(detectionId) : null;
  layer.children.forEach((bundle) => {
    if (!bundle.userData?.legacyInvertProxy) return;
    const id = bundle.userData.legacyDetectionId || null;
    // Seçim yoksa tüm proxy'ler; obje seçiliyken yalnız bağlı proxy görünür.
    bundle.visible = !selected || (id != null && String(id) === String(selected));
  });
  invalidate();
}

export function isLegacyInvertProxyAvailable(result = state.legacyDikResult) {
  const normalized = result ? normalizeLegacyResult(result) : null;
  return Array.isArray(normalized?.invertProxies) && normalized.invertProxies.length > 0;
}

export function setLegacyInvertProxyVisible(visible) {
  const on = !!visible;
  state.legacyInvertProxyVisible = on;
  const group = state.legacyDikGroup;
  if (group) {
    const layer = group.getObjectByName("legacyInvertProxy");
    if (layer) layer.visible = on;
  }
  applyInvertProxySelection(selectedDetectionOf(state.legacyTargetSession));
  invalidate();
  return on;
}

export function toggleLegacyInvertProxy() {
  if (!isLegacyInvertProxyAvailable()) return false;
  return setLegacyInvertProxyVisible(!state.legacyInvertProxyVisible);
}


export function addLegacyDikShapesToScene(result, options = {}) {
  if (!state.scene || !result) return null;
  clearGroup();

  if (state.structureTargets) {
    for (const k of Object.keys(state.structureTargets)) {
      if (k.startsWith("legacy-dik-")) delete state.structureTargets[k];
    }
  }

  const normalized = normalizeLegacyResult(result);
  const xMeters = Math.max(0.5, Number(normalized.gridWidthM ?? normalized.meta?.xMeters ?? normalized.mapSizeM ?? 4));
  const zMeters = Math.max(0.5, Number(normalized.gridDepthM ?? normalized.meta?.yMeters ?? normalized.mapDepthM ?? 5));
  const originX = Number(normalized.gridOriginXM ?? 0);
  const originZ = Number(normalized.gridOriginYM ?? 0);
  applyLegacyNumberingToNormalized(normalized, {
    widthM: xMeters,
    depthM: zMeters,
    originXM: originX,
    originYM: originZ,
    numberingDirection: state.legacyStepNumberingDirection,
  });
  const modelOptions = {
    mergeProfile: options.mergeProfile ?? state.legacyMergeProfile,
    splitDetectionIds: state.legacyMergedSplitDetectionIds,
    fieldCalibrationReadings: options.fieldCalibrationReadings ?? state.legacyFieldCalibrationReadings,
    fieldCalibrationReferenceM: options.fieldCalibrationReferenceM ?? 1,
    fieldCalibrationAfterM: options.fieldCalibrationAfterM ?? state.legacyFieldCalibrationAfterM,
    fieldCalibrationObservedM: options.fieldCalibrationObservedM ?? state.legacyFieldCalibrationObservedM,
    fieldCalibrationDepthScale: options.fieldCalibrationDepthScale ?? state.legacyFieldCalibrationDepthScale,
    learnedThresholds: options.learnedThresholds ?? state.legacyLearnedThresholds ?? null,
  };
  const fieldModel = options.fieldModel && typeof options.fieldModel === "object"
    ? options.fieldModel
    : buildLegacyFieldModel(normalized, modelOptions);
  const steps = fieldModel.steps.map((entry) => entry.raw);
  const selectedStep = selectedStepOf(state.legacyTargetSession);
  if (selectedStep != null) {
    state.legacyTargetSession = targetSessionForStep(selectedStep, {
      ...state.legacyTargetSession,
      source: "scene-default-step",
    });
  }

  // Dünya orijini grid dikdörtgeninin merkezidir; ham koordinat kayması korunur.
  const ox = originX + xMeters / 2;
  const oz = originZ + zMeters / 2;
  const reportedDepths = [...(normalized.anomalies || []), ...(normalized.candidates || []), ...(normalized.metals || [])]
    .flatMap((shape) => [Number(shape.depthTopM), Number(shape.depthBottomM)])
    .filter(Number.isFinite);
  const depthMax = Math.max(DEPTH_MAX_M, ...reportedDepths, 1);

  const group = new THREE.Group();
  group.name = GROUP_NAME;
  group.userData.votexLayer = "csv";
  group.userData.legacyDik = true;
  group.userData.depthMapM = depthMax;
  group.userData.gridWidthM = xMeters;
  group.userData.gridDepthM = zMeters;
  group.userData.gridOriginXM = originX;
  group.userData.gridOriginZM = originZ;
  group.userData.grid = finiteGrid(normalized);

  group.userData.fieldModel = fieldModel;
  group.userData.legacyLabelLayout = [];
  addDepthMapFrame(group, xMeters, zMeters, depthMax);
  addLegacyMeasuredGrid(group, normalized, xMeters, zMeters);
  const gridTemplateLayer = addLegacyGridTemplate(group, normalized, xMeters, zMeters, originX, originZ);
  const gridTemplate = group.userData.legacyGridTemplate;
  if (gridTemplate) {
    fieldModel.detections.forEach((detection) => {
      const cell = findLegacyGridCell(gridTemplate, detection.raw?.cx, detection.raw?.cy);
      if (cell?.stepIndex != null) detection.stepIndex = cell.stepIndex;
    });
  }
  if (!(Number(normalized.matrixRows) > 0 && Number(normalized.matrixCols) > 0)) {
    addScanStepRuler(group, normalized, xMeters, zMeters, originX, originZ);
  }

  const shapes = shapeListOf(normalized);
  let metalIndex = 0;
  let anomalyIndex = 0;
  shapes.forEach((shape, index) => {
    const rank = index + 1;
    const primary = index === 0;
    const detectionId = fieldModel.detections[index]?.detectionId || `legacy-dik-shape-${rank}`;
    const stepIndex = fieldModel.detections[index]?.stepIndex ?? nearestScanStepIndex(shape, steps);
    const childStart = group.children.length;
    if (String(shape.kind).toLowerCase() === "metal") {
      metalIndex += 1;
      drawMetalAtDepth(group, shape, ox, oz, metalIndex, depthMax, xMeters, zMeters, rank, primary);
    } else {
      anomalyIndex += 1;
      drawAnomalyAtDepth(group, shape, ox, oz, anomalyIndex, depthMax, xMeters, zMeters, rank, primary);
    }
    for (let i = childStart; i < group.children.length; i += 1) {
      const child = group.children[i];
      tagLegacyStepObjects(child, stepIndex, detectionId);
      // Eski gövde gizlenir; rozetler korunur, detay kartları varsayılan kapalı.
      child.visible = !!child.userData?.isBadge && !child.userData?.legacyDuplicateBadge;
    }
  });

  // Yeni prosedürel hacim katmanı tek görsel tespit kaynağıdır. Eski geometri
  // selection hedeflerini ezmemesi için yukarıda yalnızca şekil çocukları
  // gizlenir; çerçeve, cetvel ve ölçüm grid'i korunur.
  const realisticLayer = buildLegacyRealisticLayer(normalized, { maxDepthM: depthMax, fieldModel });
  // Prosedürel 3D nesneleri de paneldeki aynı tarama hücresine bağla.
  // Aksi halde seçim yalnız grid'i filtreler, bütün objeler görünür kalır.
  realisticLayer.traverse((object) => {
    const detectionId = object.userData?.legacyDetectionId || object.userData?.focusId;
    if (!detectionId) return;
    const detection = fieldModel.detections.find((entry) => entry.detectionId === detectionId);
    if (detection?.stepIndex != null) {
      object.userData.legacyStepIndex = Number(detection.stepIndex);
    }
  });
  group.add(realisticLayer);
  // Birleşik hedef geometrisi kullanıcı katmanını açtığında yalnızca
  // legacyUnifiedObjectMap tarafından üretilir; eski kutu katmanı eklenmez.

  addInvertProxyLayer(group, normalized, xMeters, zMeters, originX, originZ, fieldModel);

  // Seçim/focus sistemi için görünür prosedürel nesneleri gerçek hedef olarak
  // kaydet. Böylece görünmeyen eski etiket veya uncertainty kutusu seçilemez.
  const realisticTargets = new Map();
  realisticLayer.traverse((object) => {
    const id = object.userData?.focusId || object.userData?.legacyDetectionId;
    if (id && !realisticTargets.has(id) && (object.isMesh || object.isLine || object.isPoints)) {
      realisticTargets.set(id, object);
    }
  });
  shapes.forEach((shape, index) => {
    const detection = fieldModel.detections[index];
    const id = detection?.detectionId || `legacy-dik-shape-${index + 1}`;
    const visual = realisticTargets.get(id);
    if (!visual || !state.structureTargets) return;
    const topM = depthTopOf(shape, depthMax);
    const bottomM = depthBotOf(shape, depthMax);
    const previous = state.structureTargets[id] || {};
    state.structureTargets[id] = {
      ...previous,
      position: new THREE.Vector3(Number(shape.cx) - ox, -(topM + bottomM) * 0.5, Number(shape.cy) - oz),
      object: visual,
      radius: Math.max(Number(shape.widthM ?? shape.rx * 2) || 1, Number(shape.lengthM ?? shape.ry * 2) || 1) * 0.7,
      title: shape.label || `Tespit ${index + 1}`,
      depthM: topM,
      detailLabel: previous.detailLabel || null,
      badge: previous.badge || null,
    };
  });
  state.scene.add(group);
  state.legacyDikGroup = group;
  state.legacyFieldModel = fieldModel;
  if (options.casePackage) {
    state.legacyCasePackage = options.casePackage;
  } else {
    refreshLegacyCasePackage(state, fieldModel, modelOptions);
  }
  addLegacyLateralEvidenceLayer(group);
  try {
    const ph = typeof document !== "undefined" ? document.getElementById("placeholder") : null;
    if (ph) ph.style.display = "none";
  } catch {
    /* ignore */
  }
  applyLegacyStepVisibility(selectedStep, selectedDetectionOf(state.legacyTargetSession));
  applyLegacySceneViewMode(state.legacySceneViewMode);
  syncClipRange(-depthMax, 3);
  refreshClipState();
  applyXrayIfActive();
  refreshClipState();
  invalidate();

  if (state.camera && state.controls) {
    const span = Math.max(xMeters, zMeters, 4);
    const focus = shapes[0];
    const fx = focus ? Number(focus.cx) - ox : 0;
    const fz = focus ? Number(focus.cy) - oz : 0;
    const fy = focus ? -((depthTopOf(focus, depthMax) + depthBotOf(focus, depthMax)) / 2) : -depthMax * 0.35;
    state.controls.target.set(fx, fy, fz);
    state.camera.position.set(
      fx + span * 1.05,
      Math.max(2.5, Math.abs(fy) * 0.4 + span * 0.55),
      fz + span * 1.05
    );
    state.controls.update();
  }

  return group;
}

export { polygonToPlanPoints, polygonToWorldPoints, footprintPoints, createFootprintFill };

export function removeLegacyDikShapes() {
  clearGroup();
  invalidate();
  state.legacyDikGroup = null;
  state.legacyTomographyVisible = false;
  state.legacySubsurfaceMapVisible = false;
  state.legacyGeothermalMapVisible = false;
  state.legacyDepthMapVisible = false;
  state.legacyInvertProxyVisible = false;
  state.legacyFieldModel = null;
  state.legacyTargetSession = clearLegacyTargetSession({ source: "scene-clear" });
  state.legacyDikResult = null;
  if (state.structureTargets) {
    for (const k of Object.keys(state.structureTargets)) {
      if (k.startsWith("legacy-dik-")) delete state.structureTargets[k];
    }
  }
}

export function legacyDikSummary(result) {
  if (!result) return "";
  const m = selectLegacyMetals(result);
  const passes = Number(result.passEstimate ?? result.pass_estimate ?? 0);
  const steps = Number(result.scanStepCount ?? result.scan_step_count ?? 0);
  const invertN = Array.isArray(result.invertProxies)
    ? result.invertProxies.length
    : (Array.isArray(result.invert_proxies) ? result.invert_proxies.length : 0);
  const passTxt = passes > 1 ? ` · ${passes}× birleşti` : "";
  const stepTxt = steps > 0 ? ` · ${steps} adım` : "";
  const invertTxt = invertN > 0 ? ` · invert proxy` : "";
  if (!m.length) return `${result.message || ""}${stepTxt}${passTxt}${invertTxt} · derinlik haritası`;
  const s = m[0];
  return `${result.message || ""}${stepTxt}${passTxt}${invertTxt} · ${depthTopOf(s).toFixed(2)}–${depthBotOf(s).toFixed(2)} m · derinlik haritası`;
}
