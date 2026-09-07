/**
 * Legacy3DMag — 3D ölçüm grid'i ve derinlik haritası.
 * Yapı, hesaplanan metre kotuna yerleştirilir (örtü → taban).
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { makeBadgeSprite, makeDetailSprite, roundRect } from "./labels.js";
import { getMagneticContourLevels, computeMagneticContourSegments } from "./groundMagneticOverlay.js";
import { invalidate, refreshClipState, syncClipRange } from "./scene.js";
import { applyXrayIfActive } from "./xray.js";

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
  return Number(s.peakSigma ?? s.peak_sigma ?? s.strength) || 0;
}

function depthTopOf(s, maxDepth = DEPTH_MAX_M) {
  const v = Number(s.depthTopM ?? s.depth_top_m);
  if (!Number.isFinite(v) || v < 0) return 0.3;
  return Math.min(v, Math.max(0.2, maxDepth - 0.2));
}

function depthBotOf(s, maxDepth = DEPTH_MAX_M) {
  const top = depthTopOf(s, maxDepth);
  let bot = Number(s.depthBottomM ?? s.depth_bottom_m);
  if (!Number.isFinite(bot) || bot <= top) {
    const r = Math.max(Number(s.rx) || 0.2, 0.1);
    bot = top + Math.max(r * 1.4, 0.4);
  }
  return Math.min(Math.max(bot, top + 0.15), Math.max(top + 0.15, maxDepth));
}

function depthFitErrorOf(s) {
  const value = Number(s.depthFitError ?? s.depth_fit_error);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

function depthIntervalOf(s, maxDepth = DEPTH_MAX_M) {
  const top = depthTopOf(s, maxDepth);
  const bottom = depthBotOf(s, maxDepth);
  const center = (top + bottom) * 0.5;
  const fallback = Math.max((bottom - top) * 0.6, 0.45);
  const uncertainty = Number(s.depthUncertaintyM ?? s.depth_uncertainty_m);
  const spread = Number.isFinite(uncertainty) && uncertainty > 0 ? uncertainty : fallback;
  const lowRaw = Number(s.depthIntervalLowM ?? s.depth_interval_low_m);
  const highRaw = Number(s.depthIntervalHighM ?? s.depth_interval_high_m);
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
  const raw = shape?.shapeType ?? shape?.shape_type;
  return String(raw || "irregular").toLowerCase();
}

function shapeSourceOf(shape) {
  return String(shape?.shapeSource ?? shape?.shape_source ?? "inferred").toLowerCase();
}

function shapeFitErrorOf(shape) {
  const value = Number(shape?.shapeFitError ?? shape?.shape_fit_error);
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
  const value = Number(shape?.shapeConfidence ?? shape?.shape_confidence);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

const TEMPLATE_NAMES = { room: "Oda", tunnel: "Tünel", shaft: "Şaft", metal: "Metal", anomaly: "Belirsiz" };

/** Şablon eşleştirme sonucu: "Tünel %78" — yoksa null. */
function templateLabelOf(shape) {
  const raw = shape?.templateKind ?? shape?.template_kind;
  if (!raw) return null;
  const key = String(raw).toLowerCase();
  const name = TEMPLATE_NAMES[key] || String(raw);
  const score = Number(shape?.templateScore ?? shape?.template_score);
  return Number.isFinite(score) ? `${name} %${Math.round(score * 100)}` : name;
}

function shapeDimensionsOf(shape, rx, ry) {
  const width = Number(shape?.widthM ?? shape?.width_m);
  const length = Number(shape?.lengthM ?? shape?.length_m);
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

function polygonToWorldPoints(polygon, mapWidth, mapDepth) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];
  const width = Math.max(Number(mapWidth) || 1, 0.5);
  const length = Math.max(Number(mapDepth) || 1, 0.5);
  return polygon
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([px, py]) => [Number(px) * width - width * 0.5, Number(py) * length - length * 0.5])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
}

function footprintPoints(shape, rx, ry, mapWidth, mapDepth, polygonOverride = null) {
  const type = shapeTypeOf(shape);
  const polygon = polygonOverride || (Array.isArray(shape?.polygon) ? shape.polygon : []);
  const source = shapeSourceOf(shape);
  const fitError = shapeFitErrorOf(shape);
  // Ölçüm konturu, şekil sınıflandırması daire/elips olsa bile önceliklidir.
  const useMeasured = polygon.length >= 3 && (polygonOverride || source === "grid-contour" || type === "polygon" || type === "irregular" || fitError > 0.45);
  if (useMeasured) return polygonToWorldPoints(polygon, mapWidth, mapDepth);

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

function createFootprintOutline(shape, rx, ry, mapWidth, mapDepth, color, opacity = 0.8, polygonOverride = null) {
  const points = footprintPoints(shape, rx, ry, mapWidth, mapDepth, polygonOverride);
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

function createFootprintFill(shape, rx, ry, mapWidth, mapDepth, color, opacity = 0.16, polygonOverride = null) {
  const points = footprintPoints(shape, rx, ry, mapWidth, mapDepth, polygonOverride);
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

function createShapeGeometry(shape, rx, ry, height, mapWidth, mapDepth, preferMeasured = true) {
  const type = shapeTypeOf(shape);
  const polygon = Array.isArray(shape?.polygon) ? shape.polygon : [];
  const source = shapeSourceOf(shape);
  const fitError = shapeFitErrorOf(shape);
  const dimensions = shapeDimensionsOf(shape, rx, ry);
  const orientation = shapeOrientationOf(shape);
  const useMeasuredPolygon = preferMeasured && polygon.length >= 3 && (source === "grid-contour" || type === "polygon" || type === "irregular" || fitError > 0.45);

  if (useMeasuredPolygon) {
    const points = polygonToWorldPoints(polygon, mapWidth, mapDepth);
    if (points.length < 3) return { geometry: new THREE.BoxGeometry(dimensions.width, height, dimensions.length), rotationY: orientation, measured: false };
    const outline = new THREE.Shape();
    points.forEach(([x, z], i) => {
      if (i === 0) outline.moveTo(x, z);
      else outline.lineTo(x, z);
    });
    outline.closePath();
    const geometry = new THREE.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false });
    geometry.rotateX(Math.PI / 2);
    return { geometry, rotationY: 0, measured: true };
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

  const tag = makeRankedAnomalyLabel(shape, rank, interval, primary);
  const spread = Math.max(rx, ry, 0.25);
  const lane = primary ? 0 : ((rank - 1) % 3) - 1;
  const row = primary ? 0 : Math.floor((rank - 1) / 3) % 2;
  // Etiketler büyüdüğü için şerit/satır aralığı da genişletildi (üst üste binmesin).
  tag.position.set(
    cx + lane * Math.max(spread * 2.2, 1.9),
    -depthTopOf(shape, maxDepth) + (primary ? 0.58 : 0.22) + row * 0.36,
    cz + (primary ? 0 : row * Math.max(spread * 1.1, 0.8)),
  );
  tag.userData.legacyUncertainty = true;
  tag.userData.focusId = id;
  group.add(tag);

  return interval;
}

export function selectLegacyAnomalies(result) {
  return shapeListOf(result);
}

export function selectLegacyMetals(result) {
  let list = result?.metals?.length
    ? [...result.metals]
    : (result?.candidates || []).filter((s) => String(s.kind) === "metal");
  if (!list.length) return [];
  list.sort((a, b) => strengthOf(b) - strengthOf(a));
  // Tüm metal/anomali adaylarını göster; sıralama güçlüden zayıfa kalsın.
  // Böylece ilk öğe 3D'de "GÜÇLÜ ANOMALİ" olarak öne çıkarılır,
  // diğerleri küçük etiket ve ayrı seçim hedefi olarak korunur.
  return list;
}

function shapeListOf(result) {
  const source = result?.anomalies?.length ? result.anomalies : (result?.candidates || []);
  const byLocation = new Map();
  for (const shape of source) {
    const key = `${Number(shape.cx).toFixed(3)}:${Number(shape.cy).toFixed(3)}`;
    byLocation.set(key, shape);
  }
  // Metal sonucu aynı konumdaki genel anomaliyi daha açıklayıcı metal gövdesiyle değiştirir;
  // diğer anomaliler korunur ve birlikte render edilir.
  for (const metal of result?.metals || []) {
    const key = `${Number(metal.cx).toFixed(3)}:${Number(metal.cy).toFixed(3)}`;
    byLocation.set(key, metal);
  }
  return [...byLocation.values()].sort((a, b) => strengthOf(b) - strengthOf(a));
}

function finiteGrid(result) {
  const gw = Number(result?.gridW ?? result?.grid_w) || 0;
  const gh = Number(result?.gridH ?? result?.grid_h) || 0;
  const values = Array.isArray(result?.gridValues) ? result.gridValues : [];
  const coverage = Array.isArray(result?.gridCoverage) ? result.gridCoverage : [];
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
  texture.flipY = false;
  texture.needsUpdate = true;
  texture.userData = { min, max, measuredCells: grid.coverage.filter((n) => n > 0).length };
  return texture;
}

function addScanStepRuler(group, result, xMeters, zMeters, originX, originZ) {
  const steps = Array.isArray(result?.scanSteps)
    ? result.scanSteps
    : (Array.isArray(result?.scan_steps) ? result.scan_steps : []);
  if (!steps.length) return null;

  const toWorld = (step) => new THREE.Vector3(
    Number(step.xCenterM ?? step.x_center_m) - (originX + xMeters * 0.5),
    0.09,
    Number(step.yCenterM ?? step.y_center_m) - (originZ + zMeters * 0.5),
  );
  const points = steps.map(toWorld);
  const ruler = new THREE.Group();
  ruler.name = "legacyScanStepRuler";
  ruler.userData.scanSteps = steps;
  ruler.userData.averageSpacingM = Number(result.scanStepSpacingM ?? result.scan_step_spacing_m) || 0;

  if (points.length > 1) {
    const path = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    path.name = "legacyScanStepPath";
    path.userData.scanStepPath = true;
    ruler.add(path);
  }

  const addTick = (point, step) => {
    const tick = new THREE.Mesh(
      new THREE.RingGeometry(0.07, 0.12, 20),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
    );
    tick.rotation.x = -Math.PI / 2;
    tick.position.copy(point);
    tick.position.y = 0.1;
    tick.userData.scanStepIndex = Number(step.index) || 0;
    ruler.add(tick);

    const label = makeMeterLabel(`Adım ${Number(step.index) || ruler.children.length}`, "#ffe29a");
    label.scale.set(1.3, 0.28, 1);
    label.position.copy(point);
    label.position.y = 0.18;
    label.userData.scanStepIndex = Number(step.index) || 0;
    ruler.add(label);
  };

  steps.forEach((step, index) => addTick(points[index], step));
  for (let i = 1; i < steps.length; i += 1) {
    const step = steps[i];
    const midpoint = points[i - 1].clone().lerp(points[i], 0.5);
    const spacing = Number(step.spacingFromPreviousM ?? step.spacing_from_previous_m) || 0;
    if (spacing <= 0) continue;
    const spacingLabel = makeMeterLabel(`Δ ${spacing.toFixed(2)} m`, "#f4c875");
    spacingLabel.scale.set(1.15, 0.22, 1);
    spacingLabel.position.copy(midpoint);
    spacingLabel.position.y = 0.13;
    spacingLabel.userData.scanStepSpacingM = spacing;
    ruler.add(spacingLabel);
  }

  const average = Number(result.scanStepSpacingM ?? result.scan_step_spacing_m) || 0;
  const title = makeMeterLabel(
    average > 0 ? `Yatay tarama adımı · ort. ${average.toFixed(2)} m` : "Yatay tarama adımları",
    "#ffe29a",
  );
  title.scale.set(2.25, 0.3, 1);
  title.position.set(0, 0.22, zMeters * 0.5 + 0.35);
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

/** Basit metre etiketi (Sprite) */
function makeMeterLabel(text, color = "#9ab0c0") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = color;
  ctx.font = "bold 36px Segoe UI, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.4, 0.35, 1);
  spr.renderOrder = 998;
  return spr;
}

/**
 * Anomali sıralamasını görsel olarak açıklar: en güçlü sonuç büyük ve
 * merkez koordinatını taşıyan bir etiketle öne çıkar, diğerleri kompakt kalır.
 */
function makeRankedAnomalyLabel(shape, rank, interval, primary) {
  const width = primary ? 640 : 380;
  const height = primary ? 94 : 68;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  const color = depthFitColor(interval.fitError);
  const colorHex = `#${color.toString(16).padStart(6, "0")}`;
  ctx.fillStyle = primary ? "rgba(56, 10, 10, 0.94)" : "rgba(8, 16, 20, 0.8)";
  roundRect(ctx, 3, 3, width - 6, height - 6, primary ? 14 : 10);
  ctx.fill();
  // Güçlü anomali: yalnızca kırmızı-beyaz. Diğerleri: uyum rengi kenarlık.
  ctx.strokeStyle = primary ? "#ff4646" : colorHex;
  ctx.lineWidth = primary ? 4 : 2;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const strength = strengthOf(shape);
  // Etiket türünü ve yalnızca sıra numarasını gösterir — "Anomali" kelimesi yok.
  const kindText = String(shape.kind || "").toLowerCase() === "metal" ? "Metal" : shapeLabelOf(shape);
  const title = primary ? `GÜÇLÜ · #${rank} · ${kindText}` : `#${rank} · ${kindText}`;
  const shapeText = `şekil %${Math.round(shapeConfidenceOf(shape) * 100)}`;
  const tplText = templateLabelOf(shape);
  const templateSuffix = tplText ? ` · Şablon ${tplText}` : "";
  const detail = primary
    ? `merkez (${Number(shape.cx).toFixed(2)}, ${Number(shape.cy).toFixed(2)}) · ${strength.toFixed(1)}σ · ${interval.low.toFixed(2)}–${interval.high.toFixed(2)} m · RMS ${interval.fitError.toFixed(2)} · ${shapeText}`
    : `${strength.toFixed(1)}σ · ${interval.low.toFixed(2)}–${interval.high.toFixed(2)} m · ${shapeText}${templateSuffix}`;

  // Okunabilirlik: büyük punto. Güçlü anomali beyaz yazı + kırmızı çerçeve.
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${primary ? 32 : 25}px Segoe UI, sans-serif`;
  ctx.fillText(title, width / 2, primary ? 29 : 24);
  ctx.fillStyle = primary ? "#ffffff" : colorHex;
  ctx.font = `${primary ? 20 : 17}px Segoe UI, sans-serif`;
  ctx.fillText(detail, width / 2, primary ? 64 : 48);

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
  sprite.scale.set(primary ? 3.7 : 1.75, primary ? 0.543 : 0.313, 1);
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
  const height = Math.max(botM - topM, 0.2);
  const positive = Number(shape.polarity) >= 0;
  const kind = String(shape.kind || "anomaly").toLowerCase();
  const color = kind === "tunnel" ? 0xd09a4a : positive ? 0xe06a3b : 0x4f9dcc;
  const opacity = Math.min(0.64, Math.max(0.18, 0.22 + (Number(shape.confidence) || 0.35) * 0.42));
  const id = `legacy-dik-shape-${rank}`;
  const rx = Math.max(0.12, Math.min(Number(shape.rx) || 0.35, 6));
  const ry = Math.max(0.12, Math.min(Number(shape.ry) || rx, 6));
  const fit = createShapeGeometry(shape, rx, ry, height, mapWidth, mapDepth);
  const geometry = fit.geometry;
  const rotationY = fit.rotationY;
  const polygon = Array.isArray(shape.polygon) ? shape.polygon : [];
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
    fit.measured ? 0 : cx,
    fit.measured ? -topM : -(topM + height * 0.5),
    fit.measured ? 0 : cz,
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
  const fill = createFootprintFill(shape, rx, ry, mapWidth, mapDepth, color, 0.15);
  if (fill) {
    fill.position.set(fit.measured ? 0 : cx, 0.03, fit.measured ? 0 : cz);
    fill.renderOrder = 2;
    fill.userData.focusId = id;
    fill.userData.legacyProjection = true;
    fill.userData.contourLevel = "fill";
    group.add(fill);
  }
  const projection = createFootprintOutline(shape, rx, ry, mapWidth, mapDepth, color, 0.78);
  if (projection) {
    projection.position.set(fit.measured ? 0 : cx, 0.035, fit.measured ? 0 : cz);
    projection.userData.focusId = id;
    projection.userData.legacyProjection = true;
    projection.userData.contourLevel = "outer";
    group.add(projection);
  }
  const corePolygon = Array.isArray(shape.corePolygon)
    ? shape.corePolygon
    : (Array.isArray(shape.core_polygon) ? shape.core_polygon : []);
  const coreOutline = createFootprintOutline(shape, rx, ry, mapWidth, mapDepth, color, 0.96, corePolygon);
  if (coreOutline) {
    coreOutline.position.set(fit.measured ? 0 : cx, -topM + 0.04, fit.measured ? 0 : cz);
    coreOutline.scale.set(0.98, 1, 0.98);
    coreOutline.userData.focusId = id;
    coreOutline.userData.legacyProjection = true;
    coreOutline.userData.contourLevel = "core";
    group.add(coreOutline);
  }

  const guide = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(fit.measured ? 0 : cx, 0.02, fit.measured ? 0 : cz), new THREE.Vector3(fit.measured ? 0 : cx, -topM, fit.measured ? 0 : cz)]),
    new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.65 }),
  );
  guide.computeLineDistances();
  guide.userData.focusId = id;
  guide.userData.legacyProjection = true;
  group.add(guide);
  drawDepthUncertainty(group, shape, cx, cz, rx, ry, num, maxDepth, id, rank, primary);
  if (state.structureTargets) {
    state.structureTargets[id] = {
      position: new THREE.Vector3(cx, -(topM + botM) / 2, cz),
      object: mesh,
      radius: Math.max(rx, ry) * 1.25,
      title: shape.label || `Anomali ${num}`,
      depthM: topM,
    };
  }
}

function drawMetalAtDepth(group, shape, ox, oz, num, maxDepth = DEPTH_MAX_M, mapWidth = 4, mapDepth = 5, rank = 1, primary = false) {
  const cx = Number(shape.cx) - ox;
  const cz = Number(shape.cy) - oz;
  const strength = Math.max(strengthOf(shape), 0.5);
  const sNorm = Math.min(strength / 3.2, 1.5);

  let r0 = Number(shape.rx);
  if (!Number.isFinite(r0) || r0 <= 0) r0 = Number(shape.ry) || 0.2;
  r0 = Math.max(Math.min(r0, 1.2), 0.08);

  const rTop = r0;
  const rMid = rTop * 0.72;
  const rBot = rTop * 0.38;

  // Gerçek metre — abartısız 1:1
  const topM = depthTopOf(shape, maxDepth);
  const botM = depthBotOf(shape, maxDepth);
  const h = Math.max(botM - topM, 0.2);
  const midY = -(topM + botM) / 2;

  const col = 0xd44a38;
  const id = `legacy-dik-shape-${rank}`;
  const fitted = createShapeGeometry(shape, r0, r0, h, mapWidth, mapDepth);

  const profile = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(rTop, 0),
    new THREE.Vector2(rMid, h * 0.45),
    new THREE.Vector2(rBot, h * 0.95),
    new THREE.Vector2(0.001, h),
  ];
  const lathe = fitted.measured ? null : new THREE.LatheGeometry(profile, 36);
  if (lathe) lathe.scale(1, -1, 1);
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
  body.position.set(fitted.measured ? 0 : cx, fitted.measured ? -topM : -topM, fitted.measured ? 0 : cz);
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
  core.position.set(cx, -(topM + coreH * 0.5), cz);
  core.userData.focusId = id;
  core.userData.legacyShape = shape;
  group.add(core);

  // Yüzey projeksiyonu (0 m) — ölçüm kontürü (marching-squares) varsa gerçek
  // ayak izi dolumu + kontür çizgisi; yoksa daire yaklaşımı.
  const anchorX = fitted.measured ? 0 : cx;
  const anchorZ = fitted.measured ? 0 : cz;
  const disc = createFootprintFill(shape, r0, r0, mapWidth, mapDepth, 0xff8866, 0.22);
  if (disc) {
    disc.position.set(anchorX, 0.03, anchorZ);
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
  const groundContour = createFootprintOutline(shape, r0, r0, mapWidth, mapDepth, 0xffaa88, 0.9);
  if (groundContour) {
    groundContour.position.set(anchorX, 0.045, anchorZ);
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
  rim.position.set(anchorX, -topM + 0.02, anchorZ);
  rim.userData.focusId = id;
  group.add(rim);

  // Dikey referans: 0 m → örtü
  const drop = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(anchorX, 0, anchorZ),
      new THREE.Vector3(anchorX, -topM, anchorZ),
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

  const badge = makeBadgeSprite(num, "#ff8866");
  badge.position.set(anchorX, -topM + 0.5, anchorZ);
  badge.scale.set(0.4, 0.53, 1);
  badge.userData.focusId = id;
  group.add(badge);

  const interval = depthIntervalOf(shape, maxDepth);
  const detail = makeDetailSprite(shape.label || `Metal ${num}`, [
    `merkez X ${Number(shape.cx).toFixed(2)}  Y ${Number(shape.cy).toFixed(2)} m`,
    `orta derinlik ${((topM + botM) / 2).toFixed(2)} m · ${topM.toFixed(2)}–${botM.toFixed(2)} m`,
    `belirsizlik ${interval.low.toFixed(2)}–${interval.high.toFixed(2)} m · uyum RMS ${interval.fitError.toFixed(2)}`,
    `${shapeLabelOf(shape)} · şekil %${Math.round(shapeConfidenceOf(shape) * 100)} · RMS ${shapeFitErrorOf(shape).toFixed(2)}`,
    ...(templateLabelOf(shape) ? [`Şablon: ${templateLabelOf(shape)}`] : []),
    `Ø ${(rTop * 2).toFixed(2)} m · ${strength.toFixed(1)}σ · örtü≈0.85×r`,
  ]);
  detail.position.set(anchorX, -topM + 1.15, anchorZ);
  detail.userData.focusId = id;
  group.add(detail);
  drawDepthUncertainty(group, shape, anchorX, anchorZ, rTop, rTop, num, maxDepth, id, rank, primary);

  if (state.structureTargets) {
    state.structureTargets[id] = {
      position: new THREE.Vector3(anchorX, midY, anchorZ),
      object: body,
      detailLabel: detail,
      radius: rTop * 1.25,
      title: shape.label || "Metal",
      depthM: topM,
    };
  }
}

export function addLegacyDikShapesToScene(result) {
  if (!state.scene || !result) return null;
  clearGroup();

  if (state.structureTargets) {
    for (const k of Object.keys(state.structureTargets)) {
      if (k.startsWith("legacy-dik-")) delete state.structureTargets[k];
    }
  }

  const xMeters = Math.max(0.5, Number(result.gridWidthM ?? result.grid_width_m ?? result.meta?.xMeters ?? result.meta?.x_meters ?? result.mapSizeM ?? 4));
  const zMeters = Math.max(0.5, Number(result.gridDepthM ?? result.grid_depth_m ?? result.meta?.yMeters ?? result.meta?.y_meters ?? result.mapDepthM ?? 5));
  const originX = Number(result.gridOriginXM ?? result.grid_origin_x_m ?? 0);
  const originZ = Number(result.gridOriginYM ?? result.grid_origin_y_m ?? 0);
  // Dünya orijini grid dikdörtgeninin merkezidir; ham koordinat kayması korunur.
  const ox = originX + xMeters / 2;
  const oz = originZ + zMeters / 2;
  const reportedDepths = [...(result.anomalies || []), ...(result.candidates || []), ...(result.metals || [])]
    .flatMap((shape) => [Number(shape.depthTopM ?? shape.depth_top_m), Number(shape.depthBottomM ?? shape.depth_bottom_m)])
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
  group.userData.grid = finiteGrid(result);

  addDepthMapFrame(group, xMeters, zMeters, depthMax);
  addLegacyMeasuredGrid(group, result, xMeters, zMeters);
  addScanStepRuler(group, result, xMeters, zMeters, originX, originZ);

  const shapes = shapeListOf(result);
  let metalIndex = 0;
  let anomalyIndex = 0;
  shapes.forEach((shape, index) => {
    const rank = index + 1;
    const primary = index === 0;
    if (String(shape.kind).toLowerCase() === "metal") {
      metalIndex += 1;
      drawMetalAtDepth(group, shape, ox, oz, metalIndex, depthMax, xMeters, zMeters, rank, primary);
    } else {
      anomalyIndex += 1;
      drawAnomalyAtDepth(group, shape, ox, oz, anomalyIndex, depthMax, xMeters, zMeters, rank, primary);
    }
  });

  state.scene.add(group);
  state.legacyDikGroup = group;
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

export { footprintPoints, createFootprintFill };

export function removeLegacyDikShapes() {
  clearGroup();
  invalidate();
  state.legacyDikGroup = null;
  state.legacyDikResult = null;
  state.legacyDikRawContent = null;
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
  const passTxt = passes > 1 ? ` · ${passes}× birleşti` : "";
  const stepTxt = steps > 0 ? ` · ${steps} adım` : "";
  if (!m.length) return `${result.message || ""}${stepTxt}${passTxt} · derinlik haritası`;
  const s = m[0];
  return `${result.message || ""}${stepTxt}${passTxt} · ${depthTopOf(s).toFixed(2)}–${depthBotOf(s).toFixed(2)} m · derinlik haritası`;
}
