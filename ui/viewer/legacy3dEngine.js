import * as THREE from "three";
import { mergeLegacyShapes, normalizeLegacyResult } from "./legacyNormalize.js";
import { makeFriendlyScaleBar, makeFriendlyDepthStem } from "./legacyObjectView.js";

const DEFAULT_DEPTH_M = 10;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizePolygon(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([x, z]) => [finite(x, NaN), finite(z, NaN)])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
}

function polygonCenter(points) {
  if (!points.length) return { x: 0, z: 0 };
  let area = 0;
  let x = 0;
  let z = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    const cross = x1 * z2 - x2 * z1;
    area += cross;
    x += (x1 + x2) * cross;
    z += (z1 + z2) * cross;
  }
  if (Math.abs(area) < 1e-8) {
    const sum = points.reduce((acc, point) => ({ x: acc.x + point[0], z: acc.z + point[1] }), { x: 0, z: 0 });
    return { x: sum.x / points.length, z: sum.z / points.length };
  }
  return { x: x / (3 * area), z: z / (3 * area) };
}

function geometrySourceOf(shape) {
  const source = String(shape?.shapeSource || "inferred").toLowerCase();
  if (source === "signal-only" || source === "signal_only") return "signal_only";
  const hasPolygon = Array.isArray(shape?.polygon) && shape.polygon.length >= 3;
  if (hasPolygon && (source === "grid-contour" || shape.shapeType === "polygon" || shape.shapeType === "irregular")) {
    return "measured_contour";
  }
  return "template_inferred";
}

function normalizeShape(shape, rank) {
  const kind = String(shape?.kind || "anomaly").toLowerCase();
  const shapeType = String(shape?.shapeType || "irregular").toLowerCase();
  const top = Math.max(0, finite(shape?.depthTopM, 0.3));
  const bottomRaw = finite(shape?.depthBottomM, top + 0.5);
  const bottom = Math.max(top + 0.15, bottomRaw);
  const width = Math.max(0.12, finite(shape?.widthM, Math.abs(finite(shape?.rx, 0.35)) * 2));
  const length = Math.max(0.12, finite(shape?.lengthM, Math.abs(finite(shape?.ry, width * 0.5)) * 2));
  const strength = Math.max(0, finite(shape?.peakSigma, finite(shape?.strength, 0)));
  const confidence = clamp(finite(shape?.confidence, 0.35), 0, 1);
  const polarity = finite(shape?.polarity, 1) < 0 ? -1 : 1;
  return {
    raw: shape,
    rank,
    id: `legacy-dik-shape-${rank}`,
    kind,
    shapeType,
    label: String(shape?.label || `${kind} ${rank}`),
    cx: finite(shape?.cx),
    cz: finite(shape?.cy),
    width,
    length,
    topDepthM: top,
    bottomDepthM: bottom,
    heightM: bottom - top,
    strength,
    confidence,
    polarity,
    orientationDeg: finite(shape?.orientationDeg),
    shapeSource: String(shape?.shapeSource || "inferred").toLowerCase(),
    geometrySource: geometrySourceOf({
      ...shape,
      shapeType,
      shapeSource: String(shape?.shapeSource || "inferred").toLowerCase(),
      polygon: normalizePolygon(shape?.polygon),
    }),
    shapeFitError: clamp(finite(shape?.shapeFitError, 1), 0, 1),
    polygon: normalizePolygon(shape?.polygon),
    corePolygon: normalizePolygon(shape?.corePolygon),
  };
}

/** JSON alanlarını prosedürel renderer'ın tek veri sözleşmesine çevirir. */
export function normalizeLegacy3DResult(result, options = {}) {
  const source = normalizeLegacyResult(result);
  const shapes = mergeLegacyShapes(source).map((shape, index) => normalizeShape(shape, index + 1));
  const widthM = Math.max(0.5, finite(source.gridWidthM, finite(source?.meta?.xMeters, finite(source?.mapSizeM, 4))));
  const depthM = Math.max(0.5, finite(source.gridDepthM, finite(source?.meta?.yMeters, finite(source?.mapDepthM, 5))));
  const reportedDepths = shapes.flatMap((shape) => [shape.topDepthM, shape.bottomDepthM]);
  return {
    widthM,
    depthM,
    maxDepthM: Math.max(DEFAULT_DEPTH_M, finite(options.maxDepthM, 0), ...reportedDepths),
    originXM: finite(source.gridOriginXM),
    originZM: finite(source.gridOriginYM),
    shapes,
  };
}

function fieldColor(shape) {
  // Saha kullanıcısı için türler net ayrılsın (mühendis paleti değil).
  if (shape.kind === "metal") return 0xff5a3c;
  if (shape.kind === "tunnel") return 0xf0b429;
  if (shape.kind === "room") return 0x3db8ff;
  if (shape.kind === "shaft") return 0x5ee0b5;
  return shape.polarity < 0 ? 0x5aa8ff : 0xff9a4a;
}

function standardMaterial(color, opacity = 0.3, options = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: options.emissive ?? color,
    emissiveIntensity: options.emissiveIntensity ?? 0.12,
    transparent: true,
    opacity,
    roughness: options.roughness ?? 0.55,
    metalness: options.metalness ?? 0.04,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.userData.votexBaseOpacity = opacity;
  return material;
}

function tag(object, shape, type, role = null) {
  object.userData.legacyRealisticDetail = true;
  object.userData.legacyRealisticType = type;
  object.userData.legacyDetectionId = shape.id;
  object.userData.focusId = shape.id;
  object.userData.legacyShape = shape.raw || shape;
  object.userData.legacyDepthTopM = shape.topDepthM;
  object.userData.legacyDepthBottomM = shape.bottomDepthM;
  object.userData.legacyGeometrySource = shape.geometrySource || "template_inferred";
  if (role) object.userData.legacyVisualRole = role;
  else if (type === "signal-shell" || type === "magnetic-plume") object.userData.legacyVisualRole = "signal";
  else if (type === "surface-energy-ring") object.userData.legacyVisualRole = "guide";
  else object.userData.legacyVisualRole = "shape";
  return object;
}

function makeShell(shape, center, scale, color, opacity, renderOrder) {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: true, side: THREE.DoubleSide, wireframe: true });
  material.userData.votexBaseOpacity = opacity;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material);
  shell.position.copy(center);
  shell.scale.set(scale.x, scale.y, scale.z);
  shell.renderOrder = renderOrder;
  return tag(shell, shape, "signal-shell", "signal");
}

function makeCore(shape, center, color, scale) {
  const geometry = shape.kind === "metal" ? new THREE.IcosahedronGeometry(1, 2) : new THREE.SphereGeometry(1, 20, 14);
  const opacity = shape.kind === "metal" ? 0.72 : 0.42;
  const core = new THREE.Mesh(
    geometry,
    standardMaterial(color, opacity, {
      emissiveIntensity: shape.kind === "metal" ? 0.55 : 0.22,
      roughness: 0.28,
      metalness: shape.kind === "metal" ? 0.65 : 0.05,
    }),
  );
  core.position.copy(center);
  core.scale.set(scale.x, scale.y, scale.z);
  core.renderOrder = 1080;
  return tag(core, shape, shape.kind === "metal" ? "metal-core" : "anomaly-core", "shape");
}

function makeTopEnergyRing(shape, x, z, topDepth, color) {
  const opacity = 0.4 + shape.confidence * 0.35;
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  material.userData.votexBaseOpacity = opacity;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 0.9, 48), material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, -topDepth - 0.015, z);
  ring.scale.set(Math.max(shape.width * 0.5, 0.16), Math.max(shape.length * 0.5, 0.16), 1);
  ring.renderOrder = 1075;
  return tag(ring, shape, "surface-energy-ring", "guide");
}

/** Tespit tepesi (cx/cy) — adım eşlemesi ile aynı plan noktası. */
function detectionPlanAnchor(shape, model) {
  return {
    x: Number(shape.cx) - (model.originXM + model.widthM * 0.5),
    z: Number(shape.cz) - (model.originZM + model.depthM * 0.5),
  };
}

/**
 * Ayak izi dünya planında kalır; yerel orijin tespit tepesidir.
 * Böylece gövde adım eşlemesinin kullandığı (cx,cy) altında durur.
 * Ölçülmüş kontura orientationDeg uygulanmaz (çift döndürme kaydırır).
 */
function localFootprint(shape, model) {
  const anchor = detectionPlanAnchor(shape, model);
  const raw = shape.polygon;
  if (!Array.isArray(raw) || raw.length < 3) {
    const angle = THREE.MathUtils.degToRad(shape.orientationDeg || 0);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const points = [
      [-shape.width * 0.5, -shape.length * 0.5],
      [shape.width * 0.5, -shape.length * 0.5],
      [shape.width * 0.5, shape.length * 0.5],
      [-shape.width * 0.5, shape.length * 0.5],
    ].map(([x, z]) => [x * c - z * s, x * s + z * c]);
    return { points, center: anchor, measured: false };
  }
  const normalized = raw.every(([x, z]) => x >= -0.001 && x <= 1.001 && z >= -0.001 && z <= 1.001);
  const worldPoints = raw.map(([x, z]) => normalized
    ? [x * model.widthM - model.widthM * 0.5, z * model.depthM - model.depthM * 0.5]
    : [x - (model.originXM + model.widthM * 0.5), z - (model.originZM + model.depthM * 0.5)]);
  return {
    points: worldPoints.map(([x, z]) => [x - anchor.x, z - anchor.z]),
    center: anchor,
    measured: true,
  };
}

function makeExtrudedFootprint(shape, model, color, typePrefix = "measured-volume") {
  const footprint = localFootprint(shape, model);
  const outline = new THREE.Shape();
  footprint.points.forEach(([x, z], index) => {
    const y = -z;
    if (index === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  });
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, { depth: shape.heightM, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 4 });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  const opacity = 0.22 + shape.confidence * 0.32;
  const mesh = new THREE.Mesh(geometry, standardMaterial(color, opacity, { roughness: 0.82 }));
  mesh.position.set(footprint.center.x, -shape.bottomDepthM, footprint.center.z);
  // Ölçüm konturu zaten plan koordinatında; orientation tekrar uygulanırsa adımın altına kayar.
  mesh.rotation.y = footprint.measured ? 0 : THREE.MathUtils.degToRad(shape.orientationDeg || 0);
  const edgeMat = shape.confidence < 0.45
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.7, dashSize: 0.12, gapSize: 0.08, depthWrite: false })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false });
  edgeMat.userData.votexBaseOpacity = edgeMat.opacity;
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMat);
  edge.position.copy(mesh.position);
  edge.rotation.copy(mesh.rotation);
  if (edge.computeLineDistances) edge.computeLineDistances();
  const container = new THREE.Group();
  container.add(tag(mesh, shape, typePrefix, "shape"));
  container.add(tag(edge, shape, `${typePrefix}-edge`, "shape"));
  container.userData.legacyRealisticType = typePrefix;
  container.userData.legacyDetectionId = shape.id;
  container.userData.focusId = shape.id;
  container.userData.legacyVisualRole = "shape";
  container.userData.legacyEstimatedBody = typePrefix === "estimated-body";
  container.userData.legacyDepthTopM = shape.topDepthM;
  container.userData.legacyDepthBottomM = shape.bottomDepthM;
  container.userData.legacyPlanAnchor = footprint.center;
  return container;
}

/** Şablon ayak izi noktaları (metre, merkez orijin). */
function templateFootprintPoints(shape) {
  const w = Math.max(shape.width, 0.2);
  const l = Math.max(shape.length, 0.2);
  const type = String(shape.shapeType || "irregular").toLowerCase();
  if (type === "circle" || type === "metal") {
    const r = Math.max(w, l) * 0.5;
    return Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2;
      return [Math.cos(a) * r, Math.sin(a) * r];
    });
  }
  if (type === "ellipse" || type === "irregular" || type === "polygon") {
    return Array.from({ length: 32 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2;
      return [Math.cos(a) * w * 0.5, Math.sin(a) * l * 0.5];
    });
  }
  if (type === "capsule") {
    const r = Math.min(w, l) * 0.5;
    const half = Math.max(w, l) * 0.5 - r;
    const alongX = w >= l;
    const pts = [];
    for (let i = 0; i <= 12; i += 1) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      const x = alongX ? half + Math.cos(a) * r : Math.cos(a) * r;
      const z = alongX ? Math.sin(a) * r : half + Math.sin(a) * r;
      pts.push([x, z]);
    }
    for (let i = 0; i <= 12; i += 1) {
      const a = Math.PI / 2 + (i / 12) * Math.PI;
      const x = alongX ? -half + Math.cos(a) * r : Math.cos(a) * r;
      const z = alongX ? Math.sin(a) * r : -half + Math.sin(a) * r;
      pts.push([x, z]);
    }
    return pts;
  }
  // square / rectangle / default box
  const hw = w * 0.5;
  const hl = l * 0.5;
  return [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]];
}

/** Düşük güven → daha geniş belirsizlik kabuğu (görsel; sonucu değiştirmez). */
export function uncertaintyScaleOf(confidence) {
  const c = clamp(Number(confidence) || 0, 0, 1);
  return 1.06 + (1 - c) * 0.55;
}

function makeUncertaintyShell(shape, model, color, basePoints) {
  const scale = uncertaintyScaleOf(shape.confidence);
  if (scale <= 1.08 && shape.confidence >= 0.75) return null;
  const points = (basePoints || templateFootprintPoints(shape)).map(([x, z]) => [x * scale, z * scale]);
  if (points.length < 3) return null;
  const center = {
    x: shape.cx - (model.originXM + model.widthM * 0.5),
    z: shape.cz - (model.originZM + model.depthM * 0.5),
  };
  const outline = new THREE.Shape();
  points.forEach(([x, z], index) => {
    const y = -z;
    if (index === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  });
  outline.closePath();
  const height = Math.max(shape.heightM, 0.2) * (1 + (1 - shape.confidence) * 0.12);
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 6,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  const opacity = 0.06 + (1 - shape.confidence) * 0.14;
  const mesh = new THREE.Mesh(
    geometry,
    standardMaterial(color, opacity, { roughness: 0.92, metalness: 0, emissiveIntensity: 0.04 }),
  );
  mesh.position.set(center.x, -shape.bottomDepthM - (height - shape.heightM) * 0.5, center.z);
  mesh.rotation.y = THREE.MathUtils.degToRad(shape.orientationDeg || 0);
  mesh.renderOrder = 1040;
  return tag(mesh, shape, "estimated-uncertainty", "guide");
}

/**
 * Her bulgu için tahmini gövde: polygon varsa onu, yoksa shapeType şablonunu derinliğe çıkarır.
 * Hesap sonucunu değiştirmez — yalnız bilgilendirici çizim.
 */
export function makeEstimatedBody(shape, model, color) {
  const group = new THREE.Group();
  group.name = `legacyEstimatedBody-${shape.id || shape.rank || 0}`;
  group.userData.legacyEstimatedBody = true;
  group.userData.legacyRealisticType = "estimated-body";
  group.userData.legacyVisualRole = "shape";
  group.userData.legacyDetectionId = shape.id;
  group.userData.focusId = shape.id;
  group.userData.legacyDepthTopM = shape.topDepthM;
  group.userData.legacyDepthBottomM = shape.bottomDepthM;

  const hasPolygon = Array.isArray(shape.polygon) && shape.polygon.length >= 3;
  const basePoints = hasPolygon
    ? localFootprint(shape, model).points
    : templateFootprintPoints(shape);
  let body;
  if (hasPolygon) {
    body = makeExtrudedFootprint(shape, model, color, "estimated-body");
  } else {
    const footprint = {
      points: basePoints,
      center: {
        x: shape.cx - (model.originXM + model.widthM * 0.5),
        z: shape.cz - (model.originZM + model.depthM * 0.5),
      },
    };
    const outline = new THREE.Shape();
    footprint.points.forEach(([x, z], index) => {
      const y = -z;
      if (index === 0) outline.moveTo(x, y);
      else outline.lineTo(x, y);
    });
    outline.closePath();
    const geometry = new THREE.ExtrudeGeometry(outline, {
      depth: Math.max(shape.heightM, 0.2),
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      curveSegments: 6,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    const opacity = 0.2 + shape.confidence * 0.38;
    const mesh = new THREE.Mesh(geometry, standardMaterial(color, opacity, { roughness: 0.78 }));
    mesh.position.set(footprint.center.x, -shape.bottomDepthM, footprint.center.z);
    mesh.rotation.y = THREE.MathUtils.degToRad(shape.orientationDeg || 0);
    const edgeMat = shape.confidence < 0.45
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.75, dashSize: 0.1, gapSize: 0.08, depthWrite: false })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });
    edgeMat.userData.votexBaseOpacity = edgeMat.opacity;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMat);
    edge.position.copy(mesh.position);
    edge.rotation.copy(mesh.rotation);
    if (edge.computeLineDistances) edge.computeLineDistances();
    body = new THREE.Group();
    body.add(tag(mesh, shape, "estimated-body", "shape"));
    body.add(tag(edge, shape, "estimated-body-edge", "shape"));
  }
  group.add(body);

  const uncertainty = makeUncertaintyShell(shape, model, color, basePoints);
  if (uncertainty) group.add(uncertainty);

  // Yüzey ayak izi — “burada, bu şekil”
  const footprint = hasPolygon ? localFootprint(shape, model) : {
    points: basePoints,
    center: {
      x: shape.cx - (model.originXM + model.widthM * 0.5),
      z: shape.cz - (model.originZM + model.depthM * 0.5),
    },
  };
  const ringPts = footprint.points.map(([x, z]) => new THREE.Vector3(
    footprint.center.x + x,
    -shape.topDepthM - 0.02,
    footprint.center.z + z,
  ));
  if (ringPts.length >= 2) {
    ringPts.push(ringPts[0].clone());
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    const ringMat = shape.confidence < 0.45
      ? new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, dashSize: 0.1, gapSize: 0.07, depthWrite: false })
      : new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65, depthWrite: false });
    ringMat.userData.votexBaseOpacity = ringMat.opacity;
    const ring = new THREE.Line(ringGeo, ringMat);
    if (ring.computeLineDistances) ring.computeLineDistances();
    group.add(tag(ring, shape, "estimated-footprint", "guide"));
  }

  return group;
}

function makeRoom(shape, model, color) {
  const footprint = localFootprint(shape, model);
  const room = new THREE.Group();
  room.userData.legacyRoom = true;
  room.userData.legacyRealisticType = "measured-volume";
  room.userData.legacyDetectionId = shape.id;
  room.userData.focusId = shape.id;
  const body = makeExtrudedFootprint(shape, model, color, "measured-volume");
  const bodyMaterial = body.children?.[0]?.material;
  if (bodyMaterial) {
    bodyMaterial.opacity = 0.24 + shape.confidence * 0.16;
    bodyMaterial.userData.votexBaseOpacity = bodyMaterial.opacity;
  }
  room.add(body);

  // Odanın içini dış gövdeden ayıran koyu iç hacim ve taban düzlemi.
  const inner = makeExtrudedFootprint(shape, model, color, "measured-volume");
  inner.scale.set(0.88, 0.88, 0.88);
  inner.traverse((object) => {
    if (object.material) object.material = standardMaterial(0x10252a, 0.19, { emissive: 0x071114, emissiveIntensity: 0.12, roughness: 0.95 });
  });
  room.add(inner);
  const floor = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape().setFromPoints(footprint.points.map(([x, z]) => new THREE.Vector2(x, -z)))),
    new THREE.MeshStandardMaterial({ color: 0x142a2e, transparent: true, opacity: 0.42, roughness: 0.95, side: THREE.DoubleSide, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(footprint.center.x, -shape.bottomDepthM - 0.025, footprint.center.z);
  room.add(floor);
  room.traverse((object) => {
    if (object !== room) tag(object, shape, "room-interior");
  });
  return room;
}

function makeTunnelGeometry(width, height, length, segments = 16, rings = 8) {
  const positions = [];
  const indices = [];
  const radiusX = width * 0.5;
  const radiusY = height * 0.5;
  for (let ring = 0; ring <= rings; ring += 1) {
    const z = -length * 0.5 + (length * ring) / rings;
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * radiusX, Math.sin(a) * radiusY, z);
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      const a = ring * segments + i;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + next;
      const d = (ring + 1) * segments + i;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeTunnel(shape, model, color) {
  const width = Math.max(shape.width, 0.8);
  const height = Math.max(shape.heightM, Math.min(shape.width * 0.8, 2.2));
  const length = Math.max(shape.length, width * 1.8);
  const center = new THREE.Vector3(
    shape.cx - (model.originXM + model.widthM * 0.5),
    -(shape.topDepthM + shape.bottomDepthM) * 0.5,
    shape.cz - (model.originZM + model.depthM * 0.5),
  );
  const tunnel = new THREE.Group();
  tunnel.userData.legacyTunnel = true;
  tunnel.userData.legacyRealisticType = "arched-tunnel";
  tunnel.userData.legacyDetectionId = shape.id;
  tunnel.userData.focusId = shape.id;
  const geometry = makeTunnelGeometry(width, height, length);
  const mesh = new THREE.Mesh(geometry, standardMaterial(color, 0.32, { roughness: 0.75 }));
  mesh.position.copy(center);
  mesh.rotation.y = THREE.MathUtils.degToRad(shape.orientationDeg);
  tunnel.add(tag(mesh, shape, "arched-tunnel"));

  // İç kaplama: daha küçük ve koyu bir yüzey, tünel boşluğunun yönünü okutur.
  const innerGeometry = makeTunnelGeometry(width * 0.84, height * 0.82, length * 0.98, 16, 6);
  const inner = new THREE.Mesh(innerGeometry, standardMaterial(0x171b1d, 0.22, { emissive: 0x050607, emissiveIntensity: 0.08, roughness: 0.98 }));
  inner.position.copy(center);
  inner.rotation.y = mesh.rotation.y;
  tunnel.add(tag(inner, shape, "tunnel-interior"));

  // İki kesit halkası ve taban çizgisi tünelin uzunluğunu belirginleştirir.
  for (const z of [-length * 0.5, length * 0.5]) {
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 32 }, (_, index) => {
        const a = (index / 32) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * width * 0.5, Math.sin(a) * height * 0.5, z);
      })),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.58, depthWrite: false }),
    );
    ring.position.copy(center);
    ring.rotation.y = mesh.rotation.y;
    tunnel.add(tag(ring, shape, "tunnel-rim"));
  }
  return tunnel;
}

function makeShaft(shape, model, color) {
  const radius = Math.max(shape.width, shape.length) * 0.5;
  const center = new THREE.Vector3(shape.cx - (model.originXM + model.widthM * 0.5), -(shape.topDepthM + shape.bottomDepthM) * 0.5, shape.cz - (model.originZM + model.depthM * 0.5));
  const shaft = new THREE.Group();
  shaft.userData.legacyShaft = true;
  shaft.userData.legacyRealisticType = "shaft";
  shaft.userData.legacyDetectionId = shape.id;
  shaft.userData.focusId = shape.id;
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.94, shape.heightM, 32, 4, true);
  const mesh = new THREE.Mesh(geometry, standardMaterial(color, 0.3, { roughness: 0.68 }));
  mesh.position.copy(center);
  shaft.add(tag(mesh, shape, "shaft"));
  for (const y of [shape.topDepthM, shape.bottomDepthM]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.84, radius, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(center.x, -y, center.z);
    shaft.add(tag(ring, shape, "shaft-rim"));
  }
  return shaft;
}

function addStructureGeometry(group, shape, model, color) {
  if (shape.geometrySource === "signal_only") return;
  const isRoom = shape.kind === "room" || shape.shapeType === "room" || (shape.shapeType === "rectangle" && shape.shapeSource === "grid-contour");
  const isTunnel = shape.kind === "tunnel" || shape.shapeType === "capsule";
  const isShaft = shape.kind === "shaft" || shape.shapeType === "shaft";
  if (isRoom) group.add(makeRoom(shape, model, color));
  else if (isTunnel) group.add(makeTunnel(shape, model, color));
  else if (isShaft) group.add(makeShaft(shape, model, color));
  else group.add(makeEstimatedBody(shape, model, color));
}

function makePlumePoints(shape, center, color) {
  const count = Math.round(20 + shape.confidence * 28 + Math.min(shape.strength, 8) * 3);
  const positions = [];
  // Deterministik dağılım: aynı JSON her açılışta aynı plume'u üretir.
  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    const a = i * 2.3999632297 + shape.rank * 0.71;
    const vertical = (t - 0.5) * 2;
    const spread = 0.45 + 0.8 * Math.sin(Math.PI * t);
    positions.push(
      center.x + Math.cos(a) * spread * Math.max(shape.width, 0.3) * (0.45 + t),
      center.y + vertical * Math.max(shape.heightM, 0.35) * 0.9,
      center.z + Math.sin(a) * spread * Math.max(shape.length, 0.3) * (0.45 + t),
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const opacity = 0.3 + shape.confidence * 0.3;
  const material = new THREE.PointsMaterial({ color, size: 0.075 + shape.confidence * 0.045, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  material.userData.votexBaseOpacity = opacity;
  const points = new THREE.Points(geometry, material);
  return tag(points, shape, "magnetic-plume", "signal");
}

function addSignalLayer(group, shape, model, fieldDetection, color) {
  const x = shape.cx - (model.originXM + model.widthM * 0.5);
  const z = shape.cz - (model.originZM + model.depthM * 0.5);
  const center = new THREE.Vector3(x, -(shape.topDepthM + shape.bottomDepthM) * 0.5, z);
  const intensity = clamp(0.6 + shape.strength * 0.08, 0.75, 1.8);
  const confidenceScale = 0.75 + shape.confidence * 0.45;
  const base = {
    x: Math.max(shape.width * 0.5, 0.18) * intensity * confidenceScale,
    y: Math.max(shape.heightM * 0.55, 0.22) * intensity,
    z: Math.max(shape.length * 0.5, 0.18) * intensity * confidenceScale,
  };
  const objects = [
    makeShell(shape, center, { x: base.x * 1.55, y: base.y * 1.35, z: base.z * 1.55 }, color, 0.08 + shape.confidence * 0.08, 1060),
    makeShell(shape, center, { x: base.x * 1.16, y: base.y * 1.08, z: base.z * 1.16 }, color, 0.13 + shape.confidence * 0.1, 1065),
    makeCore(shape, center, color, { x: base.x * 0.68, y: base.y * 0.72, z: base.z * 0.68 }),
    makeTopEnergyRing(shape, x, z, shape.topDepthM, color),
    ...(shape.kind === "metal" ? [makePlumePoints(shape, center, color)] : []),
  ];
  objects.forEach((object) => {
    object.userData.legacyStepIndex = fieldDetection?.stepIndex ?? null;
    object.userData.legacyDetectionId = shape.id;
    group.add(object);
  });
}

function makeStepDetectionLink(shape, model, fieldDetection, fieldModel) {
  const stepIndex = Number(fieldDetection?.stepIndex);
  if (!Number.isFinite(stepIndex) || stepIndex <= 0) return null;
  const stepEntry = fieldModel?.steps?.find((entry) => Number(entry.stepIndex) === stepIndex);
  const step = stepEntry?.raw;
  if (!step) return null;
  const ox = model.originXM + model.widthM * 0.5;
  const oz = model.originZM + model.depthM * 0.5;
  const stepX = Number(step.xCenterM) - ox;
  const stepZ = Number(step.yCenterM) - oz;
  const peak = detectionPlanAnchor(shape, model);
  const dist = Math.hypot(peak.x - stepX, peak.z - stepZ);
  if (!(dist > 0.08)) return null;

  const points = [
    new THREE.Vector3(stepX, 0.11, stepZ),
    new THREE.Vector3(peak.x, 0.06, peak.z),
    new THREE.Vector3(peak.x, -shape.topDepthM, peak.z),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineDashedMaterial({
    color: 0xffe29a,
    transparent: true,
    opacity: 0.75,
    dashSize: 0.12,
    gapSize: 0.08,
    depthWrite: false,
  });
  material.userData.votexBaseOpacity = 0.75;
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  line.renderOrder = 1088;
  line.name = `legacyStepLink-${shape.id}`;
  return tag(line, shape, "step-detection-link", "guide");
}

/**
 * Ölçüm konturunu oda/tünel/şaft hacmine, diğer sonuçları da kontrollü
 * sinyal/plume katmanına dönüştürür. Mevcut renderer'ın üst katmanıdır.
 */
export function buildLegacyRealisticLayer(result, options = {}) {
  const model = normalizeLegacy3DResult(result, options);
  const group = new THREE.Group();
  group.name = "legacyRealisticLayer";
  group.userData.votexLayer = "csv";
  group.userData.legacyRealistic = true;
  group.userData.geometrySources = model.shapes.reduce((sources, shape) => {
    sources[shape.geometrySource] = (sources[shape.geometrySource] || 0) + 1;
    return sources;
  }, {});
  group.userData.model = model;
  const fieldModel = options.fieldModel;

  model.shapes.forEach((shape, index) => {
    const fieldDetection = fieldModel?.detections?.[index];
    shape.id = fieldDetection?.detectionId || shape.id;
    const color = fieldColor(shape);
    addStructureGeometry(group, shape, model, color);
    // Metalda plume güçlü tutulur; oda/tünel/şaftta ise hacim ana görsel olur.
    if (shape.kind === "metal" || shape.kind === "anomaly" || shape.shapeType === "irregular") {
      addSignalLayer(group, shape, model, fieldDetection, color);
    }
    const worldX = shape.cx - (model.originXM + model.widthM * 0.5);
    const worldZ = shape.cz - (model.originZM + model.depthM * 0.5);
    const stepLink = makeStepDetectionLink(shape, model, fieldDetection, fieldModel);
    if (stepLink) {
      stepLink.userData.legacyStepIndex = fieldDetection?.stepIndex ?? null;
      group.add(stepLink);
    }
    // İlk 3 bulguya 1 m ölçek + derinlik oku (sahayı okunur kılar, mühendis dili yok).
    if (index < 3) {
      const scale = makeFriendlyScaleBar(shape, worldX, worldZ, shape.topDepthM);
      const stem = makeFriendlyDepthStem(shape, worldX, worldZ, shape.topDepthM, shape.bottomDepthM);
      scale.userData.legacyStepIndex = fieldDetection?.stepIndex ?? null;
      stem.userData.legacyStepIndex = fieldDetection?.stepIndex ?? null;
      group.add(scale);
      group.add(stem);
    }
    group.traverse((object) => {
      if (object.userData?.legacyDetectionId === shape.id && object.userData.legacyStepIndex == null) {
        object.userData.legacyStepIndex = fieldDetection?.stepIndex ?? null;
      }
    });
  });
  return group;
}

export { normalizeShape, localFootprint, makeTunnelGeometry, detectionPlanAnchor };
