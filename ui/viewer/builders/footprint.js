import * as THREE from "three";
import { ShapeUtils } from "three";
import { state } from "../../app/state.js";
import { mapToWorld } from "../coords.js";

export function footprintEnabled() {
  return !!state.useFootprintShape;
}

function asPoint(p) {
  let x;
  let y;
  if (Array.isArray(p) && p.length >= 2) {
    x = Number(p[0]);
    y = Number(p[1]);
  } else if (p && typeof p === "object") {
    x = Number(p.x ?? p[0]);
    y = Number(p.y ?? p[1]);
  }
  if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
  return null;
}

function sanitizeRing(pts) {
  if (!pts || pts.length < 3) return null;
  const out = [];
  const eps = 1e-7;
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push(p);
  }
  if (out.length >= 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) out.pop();
  }
  if (out.length < 3) return null;
  let area = 0;
  for (let i = 0; i < out.length; i++) {
    const j = (i + 1) % out.length;
    area += out[i][0] * out[j][1] - out[j][0] * out[i][1];
  }
  if (Math.abs(area) < 1e-12) return null;
  if (area < 0) out.reverse();
  return out;
}

function inMap01([x, y]) {
  return x >= -0.05 && x <= 1.05 && y >= -0.05 && y <= 1.05;
}

/** DTO outline — 0–1 harita; piksel/ distorsion varsa yok say (elips yedek). */
export function readOutline(obj) {
  const raw = obj?.outline;
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const pts = [];
  for (const p of raw) {
    const q = asPoint(p);
    if (q) pts.push(q);
  }
  if (!pts.length || !pts.every(inMap01)) return null;
  return sanitizeRing(
    pts.map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))])
  );
}

function ellipseOutline(cx, cy, rx, ry, bearingDeg = 0, n = 24) {
  const ax = Math.max(Number(rx) || 0, 0.012);
  const ay = Math.max(Number(ry) || ax, 0.012);
  const rad = (Number(bearingDeg) || 0) * (Math.PI / 180);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const lx = Math.cos(a) * ax;
    const ly = Math.sin(a) * ay;
    pts.push([
      Math.min(1, Math.max(0, cx + lx * c - ly * s)),
      Math.min(1, Math.max(0, cy + lx * s + ly * c)),
    ]);
  }
  return sanitizeRing(pts);
}

function stadiumFromSegment(obj) {
  const x0 = Number(obj.x0);
  const y0 = Number(obj.y0);
  const x1 = Number(obj.x1);
  const y1 = Number(obj.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  if (![x0, y0, x1, y1].every((v) => v >= -0.05 && v <= 1.05)) return null;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const hw = Math.max(Number(obj.radius) || 0.02, 0.01);
  if (len < 1e-6) {
    return ellipseOutline((x0 + x1) * 0.5, (y0 + y1) * 0.5, hw, hw, 0, 20);
  }
  const theta = Math.atan2(dy, dx);
  const caps = 8;
  const pts = [];
  for (let i = 0; i <= caps; i++) {
    const a = theta + Math.PI / 2 + (i / caps) * Math.PI;
    pts.push([
      Math.min(1, Math.max(0, x0 + Math.cos(a) * hw)),
      Math.min(1, Math.max(0, y0 + Math.sin(a) * hw)),
    ]);
  }
  for (let i = 0; i <= caps; i++) {
    const a = theta - Math.PI / 2 + (i / caps) * Math.PI;
    pts.push([
      Math.min(1, Math.max(0, x1 + Math.cos(a) * hw)),
      Math.min(1, Math.max(0, y1 + Math.sin(a) * hw)),
    ]);
  }
  return sanitizeRing(pts);
}

export function planOutline(obj) {
  if (!obj) return null;
  const fromDto = readOutline(obj);
  if (fromDto) return fromDto;
  const x0 = Number(obj.x0);
  const y0 = Number(obj.y0);
  const x1 = Number(obj.x1);
  const y1 = Number(obj.y1);
  if ([x0, y0, x1, y1].every(Number.isFinite)) return stadiumFromSegment(obj);
  const cx = Number(obj.cx);
  const cy = Number(obj.cy);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const rx = Number(obj.rx);
  const ry = Number(obj.ry);
  const bearing = Number(obj.bearingDeg ?? obj.bearing_deg ?? 0);
  return ellipseOutline(
    cx,
    cy,
    Number.isFinite(rx) ? Math.min(Math.abs(rx), 0.45) : 0.03,
    Number.isFinite(ry) ? Math.min(Math.abs(ry), 0.45) : Number.isFinite(rx) ? Math.min(Math.abs(rx), 0.45) : 0.03,
    bearing,
    24
  );
}

function localRing(outline, origin, mapW, mapD, sideView) {
  const pts = [];
  for (const [nx0, ny0] of outline) {
    const nx = Math.min(1, Math.max(0, Number(nx0)));
    const ny = Math.min(1, Math.max(0, Number(ny0)));
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
    const w = mapToWorld(nx, ny, mapW, mapD, sideView);
    const lx = w.x - origin.x;
    const lz = w.z - origin.z;
    if (!Number.isFinite(lx) || !Number.isFinite(lz)) continue;
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(lx - last.x, lz - last.z) > 1e-5) pts.push({ x: lx, z: lz });
  }
  if (pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) <= 1e-5) pts.pop();
  }
  if (pts.length < 3) return null;
  let cx = 0;
  let cz = 0;
  pts.forEach((p) => {
    cx += p.x;
    cz += p.z;
  });
  cx /= pts.length;
  cz /= pts.length;
  let r = 0;
  pts.forEach((p) => {
    r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
  });
  if (r < 0.4) {
    const s = 0.4 / Math.max(r, 0.02);
    pts.forEach((p) => {
      p.x = cx + (p.x - cx) * s;
      p.z = cz + (p.z - cz) * s;
    });
  }
  return pts;
}

function geometryIsFinite(geo) {
  const pos = geo?.attributes?.position;
  if (!pos || pos.count < 3) return false;
  for (let i = 0; i < pos.count; i++) {
    if (![pos.getX(i), pos.getY(i), pos.getZ(i)].every(Number.isFinite)) return false;
  }
  return true;
}

function capTris(pts) {
  const n = pts.length;
  const contour = pts.map((p) => new THREE.Vector2(p.x, p.z));
  let raw = [];
  try {
    raw = ShapeUtils.triangulateShape(contour, []) || [];
  } catch {
    raw = [];
  }
  const faces = [];
  if (raw.length && Array.isArray(raw[0])) {
    for (const t of raw) {
      if (t && t.length >= 3) faces.push([t[0], t[1], t[2]]);
    }
  } else {
    for (let i = 0; i + 2 < raw.length; i += 3) {
      faces.push([raw[i], raw[i + 1], raw[i + 2]]);
    }
  }
  if (!faces.length) {
    for (let i = 1; i < n - 1; i++) faces.push([0, i, i + 1]);
  }
  return faces.filter((t) => t.every((i) => i >= 0 && i < n && Number.isInteger(i)));
}

/** Kapak + yan duvar prizma (ExtrudeGeometry yok — NaN/sis boş sahne üretmesin). */
function makePrismGeometry(pts, depth) {
  const n = pts.length;
  const d = Math.max(depth, 0.35);
  const positions = [];
  for (const p of pts) positions.push(p.x, 0, p.z);
  for (const p of pts) positions.push(p.x, -d, p.z);
  const indices = [];
  const faces = capTris(pts);
  for (const [a, b, c] of faces) {
    indices.push(a, b, c);
    indices.push(n + a, n + c, n + b);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, n + i, j);
    indices.push(j, n + i, n + j);
  }
  if (indices.length < 9) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  if (!geometryIsFinite(geo)) {
    geo.dispose();
    return null;
  }
  return geo;
}

function loopGeometry(pts, y) {
  const seq = pts.map((p) => new THREE.Vector3(p.x, y, p.z));
  seq.push(seq[0].clone());
  return new THREE.BufferGeometry().setFromPoints(seq);
}

/**
 * Manyetik ayakizi → XZ prizma (aşağı −Y). Başarısızsa null (şablon yedek).
 */
export function makeFootprintVolume({
  outline,
  mapW,
  mapD,
  sideView,
  cx,
  cy,
  topM,
  heightM,
  vertExag,
  wallColor,
  wireframe,
  wallSupport = 0,
  rimColor = 0x9ef6ff,
  opacity = 0.62,
  poolFill = false,
}) {
  const src = sanitizeRing(outline);
  if (!src) return null;
  const origin = mapToWorld(cx, cy, mapW, mapD, sideView);
  if (![origin.x, origin.z].every(Number.isFinite)) return null;
  const pts = localRing(src, origin, mapW, mapD, sideView);
  if (!pts) return null;
  const depth = Math.max(Number(heightM) || 0, 0.35) * Math.max(Number(vertExag) || 1, 0.15);
  const geo = makePrismGeometry(pts, depth);
  if (!geo) return null;

  const group = new THREE.Group();
  group.userData.poolFill = !!poolFill;
  group.position.set(origin.x, -Math.max(Number(topM) || 0.08, 0.04) * Math.max(Number(vertExag) || 1, 0.15), origin.z);

  const wallMat = new THREE.MeshStandardMaterial({
    color: wallColor,
    transparent: true,
    opacity: wireframe ? Math.min(0.4, opacity) : opacity,
    roughness: 0.55,
    metalness: 0.08,
    side: THREE.DoubleSide,
    wireframe: !!wireframe,
    depthWrite: !poolFill,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  group.add(new THREE.Mesh(geo, wallMat));

  const edgeMat = new THREE.LineBasicMaterial({
    color: rimColor,
    transparent: true,
    opacity: 0.95,
    fog: false,
    depthTest: true,
  });
  group.add(new THREE.Line(loopGeometry(pts, 0.04), edgeMat));
  group.add(new THREE.Line(loopGeometry(pts, -depth), edgeMat.clone()));

  if (wallSupport >= 0.15) {
    group.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({
          color: 0xf2f0e6,
          transparent: true,
          opacity: Math.min(0.95, 0.45 + wallSupport * 0.55),
          fog: false,
        })
      )
    );
  }

  const radius = pts.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.z)), 0.8);
  return { group, radius: Math.max(radius, depth * 0.35, 0.8), origin };
}

export function countFootprints(surface) {
  const s = surface?.structures || {};
  const chambers = s.chambers || [];
  const tunnels = s.tunnels || [];
  let n = 0;
  for (const c of chambers) {
    if (c?.kind === "cavity" && !footprintEnabled()) continue;
    if (planOutline(c)) n += 1;
  }
  for (const t of tunnels) {
    if (planOutline(t)) n += 1;
  }
  return n;
}
